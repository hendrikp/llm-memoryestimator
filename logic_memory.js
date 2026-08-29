// ----------------------------------------------------------------------
// Memory estimation & VRAM/RAM bar rendering.
// Order-of-magnitude heuristics, not exact. Exposed as window.MemEst so
// logic.js can call MemEst.updateMemBar() without sharing internals.
// ----------------------------------------------------------------------
(function () {
    "use strict";

    function gv(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
    function ck(id) { var e = document.getElementById(id); return e ? e.checked : false; }
    function el(id) { return document.getElementById(id); }

    // ------------------------------------------------------------------
    // Size estimation (order-of-magnitude heuristics, not exact).
    // ------------------------------------------------------------------
    function parseModel(name) {
        var out = { totalB: 0, activeB: 0, isMoE: false };
        if (!name) return out;
        var m = name.match(/(\d+(?:\.\d+)?)B(?:-A(\d+(?:\.\d+)?)B)?/);
        if (m) {
            out.totalB = parseFloat(m[1]);
            if (m[2]) { out.activeB = parseFloat(m[2]); out.isMoE = true; }
        }
        return out;
    }

    function quantBytesPerWeight(name) {
        if (!name) return 0.5;
        if (/NVFP4|FP4/i.test(name)) return 0.5;
        if (/\bF16|BF16/i.test(name)) return 2;
        var m = name.match(/Q(\d+)(_K(_M|S)?)?/);
        if (m) {
            var q = parseInt(m[1]);
            if (m[2] === "_K_M") return (q + 16) / 32; // K-quants carry 16-bit scales
            if (m[2] === "_K_S") return (q + 8) / 32;
            return q / 8;
        }
        return 0.5;
    }

    // Rough: assume ~40 layers (typical for 7B-32B class), ~12d² params per
    // layer (attention ~4d² + FFN ~8d²), so d ≈ sqrt(totalB / (12·n)).
    // (The old cbrt heuristic overshot: cbrt(27e9) ≈ 13.9k vs ~4-5k real.)
    function estimateEmbDim(totalB) {
        var n = 40;
        var d = Math.round(Math.sqrt((totalB * 1e9) / (12 * n)) / 128) * 128;
        return Math.max(512, Math.min(16384, d));
    }

    function estimateLayers(totalB) {
        // Rough: ~12d² params per layer (attention + FFN).
        var d = estimateEmbDim(totalB);
        var n = Math.round((totalB * 1e9) / (12 * d * d));
        return Math.max(1, Math.min(512, n));
    }

    // KV heads: modern LLMs use GQA (≈4 KV heads, 128-dim heads) rather than
    // full MHA, so per-layer KV state is ~512 values, not the full hidden dim.
    function estimateKVDim() {
        return 512;
    }

    function kvBytesFactor(cacheType) {
        switch (cacheType) {
            case "f16": return 2;
            case "q8_0": return 1.0625;
            case "q4_0":
            default: return 0.5625;
        }
    }

    function computeEstimates() {
        var model = parseModel(gv("modelPath"));
        var bytes = quantBytesPerWeight(gv("modelPath"));
        var totalGB = model.totalB * bytes;
        var activeGB = (model.isMoE ? model.activeB : model.totalB) * bytes;
        var moeGB = model.isMoE ? Math.max(0, totalGB - activeGB) : 0;

        var ctx = parseInt(gv("ctxSize")) || 0;
        var layers = estimateLayers(model.totalB || 8);
        var kvDim = estimateKVDim(); // n_kv_heads × head_dim (GQA), not full hidden dim
        var ctxGB = ctx > 0
            ? (2 * layers * kvDim * ctx * kvBytesFactor(gv("cacheK"))) / 1e9
            : 0;

        // MTP head only counts when a MTP spec/draft is actually selected;
        // with spec type "none" it takes no space in this estimate.
        var mtpGB = (gv("specType") && /MTP/i.test(gv("modelPath"))) ? activeGB * 0.05 : 0;
        var imgGB = /mmproj/i.test(gv("modelPath")) ? 1.5 : 0;

        return {
            totalB: model.totalB,
            activeB: model.activeB,
            isMoE: model.isMoE,
            layers: { vram: activeGB, ram: 0 },
            moe: { vram: moeGB, ram: 0 },
            ctx: { vram: ctxGB, ram: 0 },
            mtp: { vram: mtpGB, ram: 0 },
            img: { vram: imgGB, ram: 0 }
        };
    }

    function getCap(id, fallback) {
        var v = parseFloat(gv(id));
        return isNaN(v) ? fallback : v;
    }

    function updateMemBar() {
        var auto = computeEstimates();

        // Placement is controlled by simple per-area sliders: the slider value
        // is the % of the (auto-estimated) area size that goes to VRAM, the
        // remainder to RAM.
        function pct(id) {
            var v = parseFloat(gv(id));
            if (isNaN(v)) v = 100;
            return Math.max(0, Math.min(100, v)) / 100;
        }
        function split(a, p) {
            var t = a.vram + a.ram;
            return { vram: t * p, ram: t * (1 - p) };
        }

        var areas = {
            layers: split(auto.layers, pct("estLayersPct")),
            moe: split(auto.moe, pct("estMoePct")),
            ctx: split(auto.ctx, ck("noKvOffload") ? 0 : pct("estCtxPct")),
            mtp: { vram: auto.mtp.vram + auto.mtp.ram, ram: 0 }, // MTP head always in VRAM
            img: gv("estImgLoc") === "ram"
                ? { vram: 0, ram: auto.img.vram + auto.img.ram }
                : { vram: auto.img.vram + auto.img.ram, ram: 0 }
        };

        var vramUsed = 0, ramUsed = 0;
        Object.keys(areas).forEach(function(k) {
            vramUsed += areas[k].vram;
            ramUsed += areas[k].ram;
        });

        var vramCap = getCap("sysVramManual", 16);
        var ramCap = getCap("sysRamManual", 64);

        // Reserve slices of VRAM for OS/driver, llama.cpp scratchpad, cuBLAS
        // workspace, and compute buffers. OS and cuBLAS are constant but
        // user-overridable (osOverhead / cublasOverhead inputs).
        var osVram = getCap("osOverhead", 0.25);       // GB – OS / driver
        var scratchFactor = getCap("scratchFactor", 0.025); // GB per PB – scratchpad scale
        var scratchVram = scratchFactor * (auto.totalB || 0); // GB – llama.cpp scratchpad
        var cublasVram = getCap("cublasOverhead", 0.35); // GB – cuBLAS workspace
        var batchSize = parseInt(gv("batchSize")) || 2048;
        var ubatchSize = parseInt(gv("ubatchSize")) || 512;
        // The ubatch is what actually lives on the GPU at once, so compute
        // buffers scale with ubatch and sit in VRAM; the batch size only
        // buffers work in RAM.
        var bufVram = (ubatchSize / 1024) * 0.25;  // GB – compute buffers (scales with ubatch, VRAM)
        var batchRam = (batchSize / 1024) * 0.25;  // GB – batch buffers (scales with batch, always RAM)
        vramUsed += osVram + scratchVram + cublasVram + bufVram;
        ramUsed += batchRam;

        var vScale = Math.max(vramCap, vramUsed, 0.001);
        var rScale = Math.max(ramCap, ramUsed, 0.001);

        var vBar = el("memBarVram");
        var rBar = el("memBarRam");
        vBar.innerHTML = "";
        rBar.innerHTML = "";

        // Shorthand names shown directly on the segments (not just tooltips).
        var SHORT = { layers: "MODEL", moe: "MOE", ctx: "KV", mtp: "MTP", img: "IMG" };
        function makeSeg(bar, gb, scale, cls, label, title) {
            var pct = gb / scale * 100;
            var d = document.createElement("div");
            d.className = "mem-seg " + cls;
            d.style.width = pct + "%";
            d.title = title;
            // Only show the inline label when the segment is wide enough for it.
            if (pct > 8) d.textContent = label;
            bar.appendChild(d);
            return d;
        }

        makeSeg(vBar, osVram, vScale, "os", "OS", "OS / driver: " + osVram.toFixed(2) + " GB (overridable)");
        makeSeg(vBar, scratchVram, vScale, "rt", "SCR", "Scratchpad: " + scratchVram.toFixed(2) + " GB (" + scratchFactor.toFixed(2) + "×" + (auto.totalB || 0) + "B)");
        makeSeg(vBar, cublasVram, vScale, "cublas", "cuBLAS", "cuBLAS workspace: " + cublasVram.toFixed(2) + " GB (overridable)");
        makeSeg(vBar, bufVram, vScale, "buf", "BUF", "Buffers: " + bufVram.toFixed(2) + " GB (ubatch " + ubatchSize + ")");
        makeSeg(rBar, batchRam, rScale, "batch", "BATCH", "Batch buffers: " + batchRam.toFixed(2) + " GB (batch " + batchSize + ", always in RAM)");
        Object.keys(areas).forEach(function(k) {
            if (areas[k].vram > 0.001) {
                makeSeg(vBar, areas[k].vram, vScale, "vram", SHORT[k], k + " in VRAM: " + areas[k].vram.toFixed(1) + " GB");
            }
            if (areas[k].ram > 0.001) {
                makeSeg(rBar, areas[k].ram, rScale, "ram", SHORT[k], k + " in RAM: " + areas[k].ram.toFixed(1) + " GB");
            }
        });

        var vFree = Math.max(0, vScale - vramUsed);
        if (vFree > 0.001) {
            makeSeg(vBar, vFree, vScale, "empty", "free", "VRAM headroom: " + vFree.toFixed(1) + " GB");
        }
        var rFree = Math.max(0, rScale - ramUsed);
        if (rFree > 0.001) {
            makeSeg(rBar, rFree, rScale, "empty", "free", "RAM headroom: " + rFree.toFixed(1) + " GB");
        }

        // Striped red overlay on the part of a bar that exceeds its capacity.
        function addOverOverlay(bar, used, scale, cap, name) {
            if (used <= cap) return;
            var d = document.createElement("div");
            d.className = "mem-seg over";
            d.style.left = (cap / scale * 100) + "%";
            d.style.width = ((used - cap) / scale * 100) + "%";
            d.title = name + " over budget by " + (used - cap).toFixed(1) + " GB";
            bar.appendChild(d);
        }
        addOverOverlay(vBar, vramUsed, vScale, vramCap, "VRAM");
        addOverOverlay(rBar, ramUsed, rScale, ramCap, "RAM");

        var vOver = vramUsed > vramCap;
        var rOver = ramUsed > ramCap;
        el("memVramCap").innerHTML = "VRAM: " + vramUsed.toFixed(1) + " / " + vramCap + " GB" + (vOver ? ' <span class="over">OVER</span>' : "");
        el("memRamCap").innerHTML = "RAM: " + ramUsed.toFixed(1) + " / " + ramCap + " GB" + (rOver ? ' <span class="over">OVER</span>' : "");

        var badge = el("memModelBadge");
        if (auto.totalB > 0) {
            badge.textContent = auto.isMoE
                ? (auto.totalB + "B MoE / " + auto.activeB + "B active")
                : (auto.totalB + "B dense");
        } else {
            badge.textContent = "no model";
        }

        el("autoLayers").textContent = (auto.layers.vram + auto.layers.ram).toFixed(1) + " GB";
        el("autoMoe").textContent = (auto.moe.vram + auto.moe.ram).toFixed(1) + " GB";
        el("autoCtx").textContent = (auto.ctx.vram + auto.ctx.ram).toFixed(1) + " GB";
        // Show the context length (in tokens) that corresponds to the VRAM share
        // of the KV cache — handy for reducing ctxSize so it fully fits in VRAM.
        var ctxTokens = parseInt(gv("ctxSize")) || 0;
        var ctxTotalGB = auto.ctx.vram + auto.ctx.ram;
        var ctxTokensInVram = ctxTotalGB > 0.0001 ? Math.round(ctxTokens * (areas.ctx.vram / ctxTotalGB)) : 0;
        el("ctxVramAmt").textContent = "\u2192 " + ctxTokensInVram.toLocaleString("en-US") + " tokens in VRAM";
        el("autoMtp").textContent = (auto.mtp.vram + auto.mtp.ram).toFixed(1) + " GB";
        el("autoImg").textContent = (auto.img.vram + auto.img.ram).toFixed(1) + " GB";

        // Keep the slider % readouts in sync.
        ["estLayersPct", "estMoePct", "estCtxPct"].forEach(function(id) {
            el(id + "Val").textContent = gv(id) + "%";
        });
    }

    // Only the bar renderer is needed by logic.js; the other functions are
    // exposed for completeness / debugging.
    window.MemEst = {
        updateMemBar: updateMemBar,
        computeEstimates: computeEstimates,
        parseModel: parseModel,
        getCap: getCap
    };
})();
