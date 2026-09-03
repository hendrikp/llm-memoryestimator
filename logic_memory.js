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

    // Single source of truth for defaults (see presets.js): whenever a UI
    // field is empty, the value resolves to its llamacpp_defaults entry —
    // no magic numbers are duplicated here. The detection guesses for VRAM/
    // RAM capacity are NOT defaults, so they stay as explicit fallbacks at
    // their call sites.
    var LLD = window.LLAMA_CPP_DEFAULTS || {};
    function lldNum(id) { return parseFloat(LLD[id]); }
    // UI number with fallback to the defaults table.
    function gvNum(id) {
        var v = parseFloat(gv(id));
        return isNaN(v) ? lldNum(id) : v;
    }

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

    // Bytes per KV value for each -ctk/-ctv type (order-of-magnitude, incl.
    // per-block scale overhead; unknown values fall back to f16).
    function kvBytesFactor(cacheType) {
        switch (cacheType) {
            case "f32": return 4;
            case "f16":
            case "bf16": return 2;
            case "q8_0": return 1.0625; // 32 int8 + 1 scale byte per 32 values
            case "q4_0": return 0.5625; // 16 nibbles + 1 scale byte per 32
            case "q4_1": return 0.625;  // 16 nibbles + delta/min scales per 32
            case "iq4_nl": return 0.5;   // 16 nibbles, no scales per 32
            case "q5_0": return 0.6875;  // 16 nibbles + 4 high bits + scale per 32
            case "q5_1": return 0.75;    // 16 nibbles + 4 high bits + delta/min per 32
            default: return 2;           // f16
        }
    }

    // Model name driving the estimate: the --alias value when set (it
    // carries the param-count / quant tags), else the filename.
    function estName() { return gv("modelAlias") || gv("modelPath"); }

    function computeEstimates() {
        var model = parseModel(estName());
        var bytes = quantBytesPerWeight(estName());
        var totalGB = model.totalB * bytes;
        var activeGB = (model.isMoE ? model.activeB : model.totalB) * bytes;
        var moeGB = model.isMoE ? Math.max(0, totalGB - activeGB) : 0;

        // Expert geometry from the MoE card. `--n-cpu-moe N` / `--cpu-moe` and the
        // MoE placement slider can only be costed when the total expert count
        // and the size of ONE expert are known: with both filled in, the experts
        // area is exactly n × size and `cpu` costs N × size. With either empty
        // the area falls back to the name-derived remainder above (order of
        // magnitude only). "0" counts as unset here — per-model geometry cannot
        // be a real default.
        var expertCount = Math.max(0, parseInt(gv("moeExperts"), 10) || 0);
        var expertSize = Math.max(0, parseFloat(gv("moeExpertGB")) || 0);
        var expertSized = expertCount > 0 && expertSize > 0;
        if (expertSized) moeGB = expertCount * expertSize;
        // Experts kept in CPU RAM: --cpu-moe means "all of them", otherwise the
        // --n-cpu-moe count (clamped to the model's expert count).
        var cpuExperts = ck("cpuMoe") ? expertCount
            : Math.max(0, Math.min(expertCount, parseInt(gv("ncpuMoe"), 10) || 0));

        // Whatever the model file still accounts for once the main (active)
        // layers and the experts are subtracted is other model tensors —
        // per-layer ngram / embedding buffers. Only measurable when the experts
        // are sized explicitly; with the name-derived experts remainder the
        // subtraction would always be 0 by construction.
        var otherGB = expertSized ? Math.max(0, totalGB - activeGB - moeGB) : 0;

        // Empty ctxSize = "loaded from model" (llamacpp default, unknown) →
        // the KV area simply stays 0 until the user sets a number.
        var ctx = parseInt(gv("ctxSize")) || 0;
        var layers = estimateLayers(model.totalB || 8);
        var kvDim = estimateKVDim(); // n_kv_heads × head_dim (GQA), not full hidden dim
        // Empty cache types resolve to the LLAMA_CPP_DEFAULTS entry (f16).
        var ctk = gv("cacheK") || LLD.cacheK;
        var ctv = gv("cacheV") || LLD.cacheV;
        var ctxGB = ctx > 0
            ? (layers * kvDim * ctx * (kvBytesFactor(ctk) + kvBytesFactor(ctv))) / 1e9
            : 0;

        // Drafter (MTP head or external draft model) only counts when a spec/draft
        // type other than "none" is actually selected. Its size is the GB value
        // entered under the spec-type dropdown; with that field empty it falls
        // back to the name-derived guess (≈ 5 % of the active weights for MTP
        // models, order of magnitude only) — mirroring how the MoE card uses the
        // expert geometry when typed in, the model name otherwise.
        var specType = gv("specType");
        var specActive = specType !== "" && specType !== "none";
        var specManual = parseFloat(gv("specDraftGB"));
        var specSized = !isNaN(specManual) && specManual > 0;
        var mtpGB = specActive
            ? (specSized ? specManual : (/MTP/i.test(estName()) ? activeGB * 0.05 : 0))
            : 0;
        var imgGB = /mmproj/i.test(estName()) ? 1.5 : 0;

        return {
            totalB: model.totalB,
            activeB: model.activeB,
            isMoE: model.isMoE,
            totalGB: totalGB,
            bytesPerWeight: bytes,
            expertCount: expertCount,
            expertSize: expertSize,
            expertSized: expertSized,
            cpuExperts: cpuExperts,
            specActive: specActive,
            specSized: specSized,
            layers: { vram: activeGB, ram: 0 },
            moe: { vram: moeGB, ram: 0 },
            other: { vram: otherGB, ram: 0 },
            ctx: { vram: ctxGB, ram: 0 },
            mtp: { vram: mtpGB, ram: 0 },
            img: { vram: imgGB, ram: 0 }
        };
    }

    // UI number with fallback: explicit `fallback` arg if given, else the
    // field's LLAMA_CPP_DEFAULTS entry (single source of truth).
    function getCap(id, fallback) {
        var v = parseFloat(gv(id));
        if (!isNaN(v)) return v;
        if (fallback !== undefined) return fallback;
        var d = parseFloat(LLD[id]);
        return isNaN(d) ? 0 : d;
    }

    // ------------------------------------------------------------------
    // Area definitions — the single source of truth for how each area
    // looks. `cls` is used both for the bar segment (`.mem-seg.<cls>`) and
    // the legend swatch (`.swatch.<cls>`), so the color is defined exactly
    // once in the CSS. The legend is generated from this table; no separate
    // per-area legend definitions exist.
    // Color is per-area: an area looks the same in the VRAM and RAM bars.
    // ------------------------------------------------------------------
    var AREAS = {
        layers:  { short: "MODEL",  cls: "layers", legend: "Model" },
        moe:     { short: "MOE",    cls: "moe",    legend: "MoE Experts" },
        other:   { short: "OTHER",  cls: "other",  legend: "Other layers (ngram)" },
        ctx:     { short: "KV",     cls: "ctx",    legend: "KV Cache" },
        mtp:     { short: "Drafter",cls: "mtp",    legend: "Drafter (spec)" },
        img:     { short: "IMG",    cls: "img",    legend: "Image proj." },
        os:      { short: "OS",     cls: "os",     legend: "OS (override)" },
        scratch: { short: "SCR",    cls: "rt",     legend: "Scratch (F×P)" },
        cublas:  { short: "cuBLAS", cls: "cublas", legend: "cuBLAS (override)" },
        ubatch:  { short: "UBatch", cls: "buf",    legend: "UBatch (VRAM)" },
        batch:   { short: "BATCH",  cls: "batch",  legend: "Batch (RAM)" }
    };
    // Single order shared by the bars and the legend: segments appear in the
    // same order in the VRAM bar, the RAM bar, and the legend below them.
    var BAR_ORDER = ["os", "scratch", "cublas", "ubatch", "batch", "layers", "moe", "other", "ctx", "mtp", "img"];

    function makeSwatch(cls) {
        // Carries the `mem-seg <cls>` classes so the swatch picks up the exact
        // same color definition as the bar segment (single source of truth).
        var s = document.createElement("span");
        s.className = "swatch mem-seg " + cls;
        return s;
    }

    function buildLegend() {
        var lg = el("memLegend");
        if (!lg) return;
        lg.innerHTML = "";
        BAR_ORDER.forEach(function(k) {
            var a = AREAS[k];
            var item = document.createElement("span");
            item.className = "item";
            item.appendChild(makeSwatch(a.cls));
            item.appendChild(document.createTextNode(a.legend));
            lg.appendChild(item);
        });
        // Non-area entries (bar state, not an area).
        [["empty", "free"], ["over", "over budget"]].forEach(function(e) {
            var item = document.createElement("span");
            item.className = "item";
            item.appendChild(makeSwatch(e[0]));
            item.appendChild(document.createTextNode(e[1]));
            lg.appendChild(item);
        });
    }

    function updateMemBar() {
        var auto = computeEstimates();

        // Placement is controlled by simple per-area sliders: the slider value
        // is the % of the (auto-estimated) area size that goes to VRAM, the
        // remainder to RAM.
        function pct(id) {
            return Math.max(0, Math.min(100, gvNum(id))) / 100;
        }
        function split(a, p) {
            var t = a.vram + a.ram;
            return { vram: t * p, ram: t * (1 - p) };
        }
        // MoE VRAM share, honoring the rebased slider: while the expert count is
        // known, logic.js (moeSync) keeps estMoePct on a 0…n scale reading
        // "experts in VRAM", so the share is value / n — otherwise it is a plain
        // percentage. Keep in sync with moeSync() in logic.js.
        function moeVramShare(auto) {
            if (auto.expertCount > 0) {
                var v = parseFloat(gv("estMoePct"));
                if (isNaN(v)) v = 0;
                return Math.max(0, Math.min(1, v / auto.expertCount));
            }
            return pct("estMoePct");
        }

        // Three-stage placement (used by the "other layers" area): +100…0 walks
        // VRAM→RAM, 0…−100 walks RAM→SSD. Offloading therefore fills RAM first and
        // only spills to disk once nothing is left in RAM — it never jumps straight
        // from VRAM to SSD.
        function threeWay(a, p) {
            var t = a.vram + a.ram;
            p = Math.max(-100, Math.min(100, isNaN(p) ? 100 : p));
            var v = Math.max(0, p) / 100;   // share resident in VRAM
            var s = Math.max(0, -p) / 100;  // share on SSD (disk-backed)
            return { vram: t * v, ram: t * (1 - v - s), ssd: t * s };
        }

        var areas = {
            layers: split(auto.layers, pct("estLayersPct")),
            moe: split(auto.moe, moeVramShare(auto)),
            other: threeWay(auto.other, gvNum("estOtherPct")),
            ctx: split(auto.ctx, ck("noKvOffload") ? 0 : pct("estCtxPct")),
            mtp: { vram: auto.mtp.vram + auto.mtp.ram, ram: 0 }, // Drafter always in VRAM
            img: (gv("estImgLoc") === "ram" || ck("noMmprojOffload"))
                ? { vram: 0, ram: auto.img.vram + auto.img.ram }
                : { vram: auto.img.vram + auto.img.ram, ram: 0 }
        };

        var vramUsed = 0, ramUsed = 0, ssdUsed = 0;
        Object.keys(areas).forEach(function(k) {
            vramUsed += areas[k].vram;
            ramUsed += areas[k].ram;
            ssdUsed += areas[k].ssd || 0;   // only the three-stage areas have one
        });

        var vramCap = getCap("sysVramManual", 16);
        var ramCap = getCap("sysRamManual", 64);
        // Third tier: the disk space the user reserved for llama.cpp (model files,
        // KV/prompt caches, anything offloaded to SSD). Same bar treatment as the
        // other two; nothing but the `other` area currently lands here.
        var ssdCap = getCap("sysSsdManual", 100);

        // Reserve slices of VRAM for OS/driver, llama.cpp scratchpad, cuBLAS
        // workspace, and compute buffers. OS and cuBLAS are constant but
        // user-overridable (osOverhead / cublasOverhead inputs).
        var osVram = getCap("osOverhead");             // GB – OS / driver (default from LLAMA_CPP_DEFAULTS)
        var scratchFactor = getCap("scratchFactor");   // GB per B params – scratchpad scale
        // Scratchpad scales with the weights that are actually resident in VRAM —
        // the main (non-MoE) layers plus the MoE experts placed there — not with
        // the whole model: weights streamed from RAM don't get evaluated, so they
        // need no compute buffer. The GB in the two areas are converted back to a
        // param count with the quant's bytes/weight, so the factor keeps the same
        // meaning as the old "× totalB" form (dense model fully offloaded ⇒ the
        // same value as before).
        var vramWeightsGB = areas.layers.vram + areas.moe.vram;
        var vramWeightsB = vramWeightsGB / (auto.bytesPerWeight || 0.5); // billions of params
        var scratchVram = scratchFactor * vramWeightsB;                  // GB – llama.cpp scratchpad
        var cublasVram = getCap("cublasOverhead");     // GB – cuBLAS workspace
        var batchSize = gvNum("batchSize");             // empty → llama.cpp default (-b)
        var ubatchSize = gvNum("ubatchSize");           // empty → llama.cpp default (-ub)
        // The ubatch is what actually lives on the GPU at once, so compute
        // buffers scale with ubatch and sit in VRAM; the batch size only
        // buffers work in RAM.
        var bufVram = (ubatchSize / 1024) * 0.25;  // GB – compute buffers (scales with ubatch, VRAM)
        var batchRam = (batchSize / 1024) * 0.25;  // GB – batch buffers (scales with batch, always RAM)
        vramUsed += osVram + scratchVram + cublasVram + bufVram;
        ramUsed += batchRam;

        var vScale = Math.max(vramCap, vramUsed, 0.001);
        var rScale = Math.max(ramCap, ramUsed, 0.001);
        var sScale = Math.max(ssdCap, ssdUsed, 0.001);

        var vBar = el("memBarVram");
        var rBar = el("memBarRam");
        var sBar = el("memBarSsd");
        vBar.innerHTML = "";
        rBar.innerHTML = "";
        if (sBar) sBar.innerHTML = "";

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

        // Per-area tooltip details (the legend text is prepended to the title below).
        var details = {
            os: "overridable",
            scratch: scratchFactor.toFixed(3) + "×" + vramWeightsB.toFixed(1) + "B in VRAM (of " + (auto.totalB || 0) + "B)",
            cublas: "overridable",
            ubatch: "ubatch " + ubatchSize,
            batch: "batch " + batchSize + ", always in RAM"
        };
        // Model areas: say where the size came from, and what the CPU-expert
        // count costs when the expert geometry is known.
        details.moe = auto.expertSized
            ? (auto.expertCount + " experts \u00d7 " + auto.expertSize + " GB"
               + (ck("cpuMoe") ? ", all on CPU (--cpu-moe)"
                  : auto.cpuExperts > 0 ? ", " + auto.cpuExperts + " on CPU (--n-cpu-moe)" : ", all on GPU"))
            : "estimated from the model name";
        details.other = auto.expertSized
            ? (auto.totalGB.toFixed(1) + " GB model \u2212 main layers \u2212 experts")
            : "set the expert count + size to measure this";
        details.mtp = auto.specActive
            ? (auto.specSized ? "entered drafter size"
                              : "estimated \u2014 enter the GB under the spec type to override")
            : "no spec type selected";
        // Resolve the GB amounts for every area, for both destinations.
        function segGB(k) {
            if (k in areas) return areas[k];
            switch (k) {
                case "os":      return { vram: osVram, ram: 0 };
                case "scratch": return { vram: scratchVram, ram: 0 };
                case "cublas":  return { vram: cublasVram, ram: 0 };
                case "ubatch":  return { vram: bufVram, ram: 0 };
                case "batch":   return { vram: 0, ram: batchRam };
                default:        return { vram: 0, ram: 0, ssd: 0 };
            }
        }
        // Both bars and the legend follow BAR_ORDER, so the segment order in
        // the bars matches the legend order.
        BAR_ORDER.forEach(function(k) {
            var a = AREAS[k];
            var s = segGB(k);
            var extra = details[k] ? " (" + details[k] + ")" : "";
            if (s.vram > 0.001) {
                makeSeg(vBar, s.vram, vScale, a.cls, a.short, a.legend + " in VRAM: " + s.vram.toFixed(1) + " GB" + extra);
            }
            if (s.ram > 0.001) {
                makeSeg(rBar, s.ram, rScale, a.cls, a.short, a.legend + " in RAM: " + s.ram.toFixed(1) + " GB" + extra);
            }
            if (sBar && s.ssd > 0.001) {
                makeSeg(sBar, s.ssd, sScale, a.cls, a.short, a.legend + " on SSD: " + s.ssd.toFixed(1) + " GB" + extra);
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
        var sFree = Math.max(0, sScale - ssdUsed);
        if (sBar && sFree > 0.001) {
            makeSeg(sBar, sFree, sScale, "empty", "free", "SSD headroom: " + sFree.toFixed(1) + " GB");
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
        if (sBar) addOverOverlay(sBar, ssdUsed, sScale, ssdCap, "SSD");

        var vOver = vramUsed > vramCap;
        var rOver = ramUsed > ramCap;
        el("memVramCap").innerHTML = "VRAM: " + vramUsed.toFixed(1) + " / " + vramCap + " GB" + (vOver ? ' <span class="over">OVER</span>' : "");
        el("memRamCap").innerHTML = "RAM: " + ramUsed.toFixed(1) + " / " + ramCap + " GB" + (rOver ? ' <span class="over">OVER</span>' : "");
        // Third tier readout (only when the bar exists).
        var elSsdCap = el("memSsdCap");
        if (elSsdCap) {
            elSsdCap.innerHTML = "SSD: " + ssdUsed.toFixed(1) + " / " + ssdCap + " GB"
                + (ssdUsed > ssdCap ? ' <span class="over">OVER</span>' : "");
        }

        var badge = el("memModelBadge");
        if (auto.totalB > 0) {
            badge.textContent = auto.isMoE
                ? (auto.totalB + "B MoE / " + auto.activeB + "B active")
                : (auto.totalB + "B dense");
        } else {
            badge.textContent = "no model";
        }

        el("autoLayers").textContent = (auto.layers.vram + auto.layers.ram).toFixed(1) + " GB";
        // MoE card readout: total GB plus the gpu/cpu split of the experts when
        // their count is known (the same numbers the slider and the cpu field
        // are synced to).
        var moeTxt = (auto.moe.vram + auto.moe.ram).toFixed(1) + " GB";
        if (auto.expertCount > 0) {
            moeTxt += auto.cpuExperts > 0
                ? " \u00b7 " + auto.cpuExperts + " on CPU ("
                  + (ck("cpuMoe") ? "--cpu-moe" : "--n-cpu-moe") + ")"
                : " \u00b7 all on GPU";
        }
        el("autoMoe").textContent = moeTxt;
        // "VRAM 60% / RAM 40% / SSD ..." — non-zero tiers only.
        function tierText(a) {
            var p = [], parts = [["VRAM", a.vram], ["RAM", a.ram], ["SSD", a.ssd || 0]];
            parts.forEach(function(x) {
                if (x[1] > 0.0005) p.push(x[0] + " " + Math.round(x[1] / (a.vram + a.ram + (a.ssd || 0)) * 100) + "%");
            });
            return p.length ? " \u00b7 " + p.join(" / ") : "";
        }
        el("autoOther").textContent = (auto.other.vram + auto.other.ram + (auto.other.ssd || 0)).toFixed(1)
            + " GB" + tierText(areas.other);
        el("autoCtx").textContent = (auto.ctx.vram + auto.ctx.ram).toFixed(1) + " GB";
        // Show the context length (in tokens) that corresponds to the VRAM share
        // of the KV cache — handy for reducing ctxSize so it fully fits in VRAM.
        var ctxTokens = parseInt(gv("ctxSize")) || 0; // empty = model default, unknown → 0
        var ctxTotalGB = auto.ctx.vram + auto.ctx.ram;
        var ctxTokensInVram = ctxTotalGB > 0.0001 ? Math.round(ctxTokens * (areas.ctx.vram / ctxTotalGB)) : 0;
        el("ctxVramAmt").textContent = "\u2192 " + ctxTokensInVram.toLocaleString("en-US") + " tokens in VRAM";
        // Drafter state lives in this readout (its Loc row was dropped): the head
        // is always in VRAM when a spec type is active.
        var mtpGB = auto.mtp.vram + auto.mtp.ram;
        el("autoMtp").textContent = mtpGB.toFixed(1) + " GB"
            + (mtpGB > 0.0005 ? (auto.specSized ? " \u00b7 VRAM \u00b7 entered" : " \u00b7 VRAM \u00b7 estimated") : " \u00b7 inactive");
        el("autoImg").textContent = (auto.img.vram + auto.img.ram).toFixed(1) + " GB";

        // Keep the slider readouts in sync. The MoE slider reads a number of
        // experts (in VRAM) while the expert count is known, plain % otherwise.
        [["estLayersPct", "%"],
         ["estCtxPct", "%"]].forEach(function(e) {
            el(e[0] + "Val").textContent = gv(e[0]) + e[1];
        });
        // MoE slider: experts in VRAM once the count is known (see moeSync in
        // logic.js), plain percent otherwise.
        if (auto.expertCount > 0) {
            var gpuN = parseFloat(gv("estMoePct"));
            if (isNaN(gpuN)) gpuN = auto.expertCount;
            el("estMoePctVal").textContent = gpuN + " of " + auto.expertCount
                + " experts in VRAM (" + Math.round(gpuN / auto.expertCount * 100) + "%)";
        } else {
            el("estMoePctVal").textContent = gv("estMoePct") + "%";
        }
        // The "other layers" slider runs −100…+100 (see threeWay): the readout next
        // to it shows the signed position, the card readout spells the split.
        var otherP = gvNum("estOtherPct");
        el("estOtherPctVal").textContent = (otherP > 0 ? "+" : "") + otherP + "%";


    }

    // Only the bar renderer is needed by logic.js; the other functions are
    // exposed for completeness / debugging.
    window.MemEst = {
        updateMemBar: updateMemBar,
        buildLegend: buildLegend,
        computeEstimates: computeEstimates,
        parseModel: parseModel,
        getCap: getCap
    };
})();
