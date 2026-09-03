(function () {
    "use strict";

    var currentTab = "bat";

    function gv(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
    function ck(id) { var e = document.getElementById(id); return e ? e.checked : false; }
    function el(id) { return document.getElementById(id); }
    function num(id) { var v = parseFloat(gv(id)); return isNaN(v) ? null : v; }

    // ------------------------------------------------------------------
    // Presets live in presets.js (window.CONFIG_PRESETS), including the
    // "default" preset: the single source of truth for the tool's initial
    // state. It is applied on startup, restored by Reset, selectable in the
    // Apply-preset dropdown — configtool.html carries no value/checked/
    // selected attributes at all. Cmd-line omission is NOT based on this
    // preset but on `LLD` (window.LLAMA_CPP_DEFAULTS): only options whose
    // value differs from the real llama-server default are emitted.
    // ------------------------------------------------------------------
    var PRESETS = globalPresets();
    var DEFAULT_PRESET = PRESETS["default"] || {};

    // Real llama-server cmd-line defaults (presets.js). Here they drive the
    // watermark placeholders, slider readouts and batch-clamp fallbacks; the
    // omission logic and script rendering live in logic_cmdgenerator.js
    // (CmdGen). "tool" = tool-default preset state (plain placeholder).
    var LLD = window.LLAMA_CPP_DEFAULTS || {};
    var LLD_DESC = window.LLAMA_CPP_DESCRIPTIONS || {};
    var PLACEHOLDERS = {};
    var lldMode = "tool";

    function globalPresets() {
        if (!window.CONFIG_PRESETS || !window.CONFIG_PRESETS["default"]) {
            // presets.js failed to load — keep the tool usable with bare controls.
            setTimeout(function() { showToast("presets.js failed to load"); }, 0);
            return {};
        }
        return window.CONFIG_PRESETS;
    }

    function lld(id) { return LLD[id]; }

    // Placeholder (watermark) ids: text/number inputs only - selects keep
    // their default option selected (no empty option / no watermark possible),
    // sliders show their value in the label.
    var LLD_PLACEHOLDER_IDS = [
        "ctxSize", "ngl", "threads", "parallel", "host", "port",
        "repLastN", "maxTokens", "seed", "reasoningBudget",
        "specDraftNMax", "specDraftPMin"
    ];

    // Remember the stock placeholders once, before any preset touches them.
    function capturePlaceholders() {
        FIELD_IDS.concat(LLD_PLACEHOLDER_IDS).forEach(function(id) {
            var e = el(id);
            if (e && !(id in PLACEHOLDERS)) PLACEHOLDERS[id] = e.placeholder || "";
        });
    }

    // Watermark spellings for defaults that are "auto / unset" (stored as
    // "" in the table) and therefore not self-explanatory.
    var LLD_WATERMARKS = {
        ctxSize: "loaded from model",
        ngl: "auto",
        threads: "auto (-1)",
        parallel: "auto (-1)",
        maxTokens: "inf (-1)",
        seed: "random (-1)",
        reasoningBudget: "unrestricted (-1)"
    };

    // Switch watermark placeholders on/off. In "lld" mode (the
    // llamacpp_defaults preset is applied) tracked inputs show their llama.cpp
    // default as watermark; in "tool" mode the stock placeholders are
    // restored. Values are never rewritten here — only placeholders.
    function updateLldHints(mode) {
        lldMode = mode;
        var map = {};
        Object.keys(LLD).forEach(function(k) { map[k] = String(LLD[k]); });
        Object.keys(LLD_WATERMARKS).forEach(function(k) {
            if (map[k] === "" || map[k] === undefined) map[k] = LLD_WATERMARKS[k];
        });
        FIELD_IDS.concat(LLD_PLACEHOLDER_IDS).forEach(function(id) {
            var e = el(id);
            if (!e || e.type === "checkbox" || e.tagName === "SELECT" || e.type === "range") return;
            if (mode === "lld" && id in map && map[id] !== "") e.placeholder = map[id];
            else if (id in PLACEHOLDERS) e.placeholder = PLACEHOLDERS[id];
        });
    }

    // Apply the help-derived descriptions (presets.js,
    // window.LLAMA_CPP_DESCRIPTIONS — same keys as the presets) as `title`
    // tooltips on every control. The resolved default from LLAMA_CPP_DEFAULTS
    // is appended only when the description does not state one already.
    // Overwrites any hand-written title in the HTML (the table is the
    // single source of truth); controls without an entry keep theirs.
    function applyLldDescriptions() {
        Object.keys(LLD_DESC).forEach(function(id) {
            var e = el(id);
            if (!e) return;
            var title = LLD_DESC[id];
            var d = LLD[id];
            if (title.indexOf("default") === -1) {
                if (e.type === "checkbox") {
                    if (d !== undefined) title += " — default (checked): " + (!!d);
                } else if (d !== undefined && d !== "") {
                    title += " — default: " + d;
                }
            }
            e.title = title;
        });
    }

    // Sliders cannot be blanked (a range input always holds a value), so
    // applying a numeric preset must also snap any slider it leaves empty
    // back to its default position. Drives both the temp/top-P/... value
    // labels and the est* placement sliders via updateOutput().
    function restoreSliderPositions(state) {
        Object.keys(state || {}).forEach(function(id) {
            var e = el(id);
            if (!e || e.type !== "range" || gv(id) !== "") return;
            var d = parseFloat(state[id]);
            if (!isNaN(d)) e.value = state[id];
        });
    }

    // Batch sizing rules: ubatchSize snaps to a multiple of 32 (min 32);
    // batchSize must be an exact multiple of the current ubatchSize.
    function roundToMultiple(v, m, min) {
        if (isNaN(v)) return min;
        var r = Math.round(v / m) * m;
        if (r < min) r = min;
        return r;
    }
    function getUbatch() {
        var v = parseInt(el("ubatchSize").value, 10);
        return (isNaN(v) || v < 32) ? 32 : v;
    }
    function clampBatch(id) {
        var e = el(id);
        var v = parseFloat(e.value);
        if (id === "ubatchSize") {
            if (isNaN(v)) v = parseFloat(lld("ubatchSize"));
            e.value = roundToMultiple(v, 32, 32);
            // Keep the batch input and its value consistent with the new ubatch.
            var b = el("batchSize");
            b.min = e.value;
            b.step = e.value;
            var bv = parseFloat(b.value);
            b.value = isNaN(bv) ? parseFloat(lld("batchSize")) : roundToMultiple(bv, parseInt(e.value, 10), parseInt(e.value, 10));
            return;
        }
        // batchSize: multiple of the (already clamped) ubatch size.
        var u = getUbatch();
        if (isNaN(v)) v = parseFloat(lld("batchSize"));
        e.value = roundToMultiple(v, u, u);
    }

    // (Cmd-line generation lives in logic_cmdgenerator.js — window.CmdGen:
    // buildArgs + genBat / genPs1 / genSh / genJson, called from
    // updateOutput().)

    // ------------------------------------------------------------------
    // System detection (WebGL GPU name only — display, not overridable).
    // ------------------------------------------------------------------
    var GPU_ARCHS = [
        [/RTX 50|GeForce 50/i, "Blackwell"],
        [/RTX 40|GeForce 40/i, "Ada"],
        [/RTX 30|GeForce 30/i, "Ampere"],
        [/RTX 20|GeForce 20/i, "Turing"],
        [/RTX|GeForce (?!40|30|20)/i, "Ampere"],
        [/H100|H800|H200/i, "Hopper"],
        [/A100/i, "Ampere"],
        [/Radeon RX 79|RX 78/i, "RDNA3"],
        [/Radeon RX (6|7)/i, "RDNA"],
        [/Arc /i, "Intel Xe"],
        [/Apple/i, "Metal"]
    ];

    function detectSystem() {
        var gpuName = "unknown";
        try {
            var canvas = document.createElement("canvas");
            var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
            if (gl) {
                var ext = gl.getExtension("WEBGL_debug_renderer_info");
                gpuName = ext
                    ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                    : gl.getParameter(gl.RENDERER);
            }
        } catch (e) { /* WebGL unavailable */ }

        var arch = "";
        for (var i = 0; i < GPU_ARCHS.length; i++) {
            if (GPU_ARCHS[i][0].test(gpuName)) { arch = GPU_ARCHS[i][1]; break; }
        }

        el("sysGpu").textContent = gpuName;
        el("sysGpuDetected").textContent = gpuName === "unknown" ? "WebGL unavailable" : "via WebGL";
        el("sysGpuArch").textContent = arch || "—";
        if (arch && gv("sysGpuArchManual") === "") el("sysGpuArchManual").value = arch;

        el("sysCores").textContent = navigator.hardwareConcurrency || "—";
        el("sysRam").textContent = (navigator.deviceMemory || "—") + " GB";
    }

    // ------------------------------------------------------------------
    // Output tabs.
    // ------------------------------------------------------------------
    function updateOutput() {
        // Slider value displays — an empty slider reads as its llama.cpp
        // default (resolved from LLD, no hardcoded numbers here).
        [["tempVal", "temp"], ["topPVal", "topP"], ["minPVal", "minP"],
         ["presPenVal", "presPen"], ["repPenVal", "repPen"], ["freqPenVal", "freqPen"]]
        .forEach(function(p) {
            var v = gv(p[1]);
            if (v === "") v = lld(p[1]);
            el(p[0]).textContent = parseFloat(v).toFixed(2);
        });

        updateLldHints(lldMode);
        // Cmd-line assembly & rendering: logic_cmdgenerator.js (CmdGen).
        var built = CmdGen.buildArgs();
        // Empty binary resolves to the defaults table (LLD.binaryPath).
        var binary = gv("binaryPath") || lld("binaryPath") || "llama-server";
        var text = "";
        if (currentTab === "bat") text = CmdGen.genBat(binary, built.args, built.envLines, built.kwargs);
        else if (currentTab === "ps1") text = CmdGen.genPs1(binary, built.args, built.envLines, built.kwargs);
        else if (currentTab === "sh") text = CmdGen.genSh(binary, built.args, built.envLines, built.kwargs);
        else text = CmdGen.genJson(binary, built.args, built.envLines, built.kwargs);
        el("outputContent").textContent = text;

        MemEst.updateMemBar();
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll(".output-tab").forEach(function(t) {
            t.classList.toggle("active", t.getAttribute("data-tab") === tab);
        });
        updateOutput();
    }

    // ------------------------------------------------------------------
    // Clipboard / download / toast.
    // ------------------------------------------------------------------
    function showToast(msg) {
        var t = el("toast");
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(showToast._t);
        showToast._t = setTimeout(function() { t.classList.remove("show"); }, 2000);
    }

    function fallbackCopy(text) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return ok;
    }

    function copyOutput() {
        var text = el("outputContent").textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(function() { showToast("Copied to clipboard"); })
                .catch(function() { showToast(fallbackCopy(text) ? "Copied to clipboard" : "Copy failed"); });
        } else {
            showToast(fallbackCopy(text) ? "Copied to clipboard" : "Copy failed");
        }
    }

    function downloadText(name, text) {
        var blob = new Blob([text], { type: "text/plain" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    }

    function downloadConfig() {
        var names = { bat: "run-server.bat", ps1: "run-server.ps1", sh: "run-server.sh", json: "config.json" };
        downloadText(names[currentTab], el("outputContent").textContent);
    }

    // ------------------------------------------------------------------
    // Presets: collect / apply / save / load.
    // ------------------------------------------------------------------
    var FIELD_IDS = [
        "modelPath", "modelAlias", "ctxSize", "ngl", "ncpuMoe", "cpuMoe", "moeExperts", "moeExpertGB", "threads", "loadMode", "lazyMode", "cacheK", "cacheV",
        "batchSize", "ubatchSize", "host", "port", "parallel", "mainGpu", "tensorSplit", "overrideTensor",
        "binaryPath", "envVars",
        "flashAttn", "jinja", "noKvOffload", "noMmprojOffload", "promptCache", "promptCachePath", "verbose",
        "loraPath", "extraArgs",
        "temp", "topP", "topK", "minP", "presPen", "repPen", "freqPen", "repLastN",
        "maxTokens", "seed", "grammarFile",
        "reasoningBudget", "reasoningPreserve", "chatKwargs",
        "specType", "draftModel", "specDraftNMax", "specDraftPMin", "specTypeK", "specTypeV",
        "sysGpuArchManual", "sysVramManual", "sysRamManual", "sysSsdManual",
        "estLayersPct", "estMoePct", "estOtherPct", "estCtxPct", "estImgLoc",
        "osOverhead", "cublasOverhead", "scratchFactor"
    ];

    function collectState() {
        var state = {};
        FIELD_IDS.forEach(function(id) {
            var e = el(id);
            if (!e) return;
            if (e.type === "checkbox") state[id] = e.checked;
            else state[id] = e.value;
        });
        return state;
    }

    // Shared applier (no updateOutput — callers decide when to refresh).
    function applyPresetState(state) {
        FIELD_IDS.forEach(function(id) {
            var e = el(id);
            if (!e || !(id in state)) return;
            if (e.type === "checkbox") e.checked = !!state[id];
            else e.value = state[id];
        });
    }

    // PRESETS (default / llamacpp_defaults / chat / fast / quality / embed)
    // come from presets.js. Presets other than "default" are partial diffs —
    // fields they omit are left untouched. "default" is a full preset, so
    // applying it is the same as Reset (minus clearing the system-detection
    // inputs); "llamacpp_defaults" is also full and switches on the
    // llama.cpp-default watermarks (updateLldHints).
    function applyPreset(name) {
        if (name === "myconfig") {
            showToast("Use “Load preset” to restore your saved config");
            return;
        }
        var p = PRESETS[name];
        if (!p) return;
        applyPresetState(p);
        restoreSliderPositions(p);
        syncGates();
        // The llamacpp_defaults preset switches on the llama.cpp-default
        // watermarks; every other preset restores the stock placeholders.
        updateLldHints(name === "llamacpp_defaults" ? "lld" : "tool");
        updateOutput();
        showToast("Preset applied: " + name);
    }

    function savePreset() {
        downloadText("configtool-preset.json", JSON.stringify(collectState(), null, 2));
        showToast("Preset downloaded");
    }

    function loadPresetFile(file) {
        var reader = new FileReader();
        reader.onload = function() {
            try {
                applyPresetState(JSON.parse(reader.result));
                syncGates();
                updateLldHints("tool"); // a loaded file is tool-state, not lld-watermarks
                updateOutput();
                showToast("Preset loaded");
            } catch (e) {
                showToast("Invalid preset file");
            }
        };
        reader.readAsText(file);
    }

    // lazyMode requires mmap: keep the select disabled and snapped to "off"
    // whenever the load mode is not mmap (see CmdGen.buildArgs, which also
    // refuses to emit --lazy-mode in that case).
    function lazyGate() {
        var lzm = el("lazyMode");
        if (gv("loadMode") !== "mmap") {
            lzm.disabled = true;
            lzm.value = "off";
        } else {
            lzm.disabled = false;
        }
    }

    // MoE placement: once the expert count (`moeExperts`) is known, the VRAM
    // slider and the `-ncpu-moe` count are two spellings of the same thing, so
    // the slider is re-based to 0…n and **reads as the number of experts in
    // VRAM** (left-to-right stays "in VRAM" like every other slider, and
    // experts are discrete, so a percent scale would only obscure it):
    // gpu = n − cpu. `moeSync(from)` mirrors whichever side the user moved;
    // with an unknown count the slider falls back to the plain 0–100 % scale
    // and `estMoePct` keeps being the single source of truth. `moeSliderN` is
    // the n the slider is currently rebased to (0 = percent scale); MemEst
    // reads the same convention (`moeVramShare` in logic_memory.js).
    var moeSliderN = 0;

    function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // Slider position as a CPU-expert count (the slider reads experts **in VRAM**).
    function moeSliderCpu(n) {
        var v = parseFloat(el("estMoePct").value);
        if (isNaN(v)) v = 0;
        return n - clampInt(Math.round(v), 0, n);
    }

    // Three controls, one state: the `cpuMoe` switch (--cpu-moe = every expert in
    // CPU RAM), the `ncpuMoe` count (-ncpu-moe N) and the VRAM slider. Invariant:
    // **checked ⇔ cpu == n** (all experts on the CPU, i.e. the slider at its
    // minimum). Checking the box pulls the slider to the minimum and fills the
    // count; unchecking it pushes exactly one expert back to the GPU (otherwise
    // cpu would still be n and the box would snap straight back on); moving the
    // slider or editing the count rewrites the others and clears the box as soon
    // as the count drops below n. The box is **never disabled** — it is always
    // free to toggle, `cpuMoeReflect()` just keeps it honest after bulk changes.
    function moeSync(from) {
        var slider = el("estMoePct"), cnt = el("ncpuMoe");
        if (!slider) return;
        var n = parseInt(gv("moeExperts"), 10);
        n = isNaN(n) ? 0 : Math.max(0, n);
        if (n > 0) {
            // Count known: slider = experts in VRAM (0…n, step 1); both fields are
            // rewritten on every pass, so they can never disagree.
            slider.min = "0"; slider.max = String(n); slider.step = "1";
            moeSliderN = n;
            var cpu;
            if (from === "cpuMoe") {
                // The switch is the source: on = all of them, off = one back on GPU.
                cpu = ck("cpuMoe") ? n : n - 1;
            } else if (from === "slider") {
                cpu = moeSliderCpu(n);          // the slider is the source
            } else {
                // `ncpuMoe` edited, expert count (re)entered, or a bulk gate pass:
                // the count field wins (slider rebases to it).
                cpu = parseInt(cnt ? cnt.value : "", 10);
                if (isNaN(cpu)) cpu = moeSliderCpu(n);
            }
            cpu = clampInt(isNaN(cpu) ? 0 : cpu, 0, n);
            if (cnt) cnt.value = String(cpu);   // also clamps what was typed
            slider.value = String(n - cpu);
        } else {
            // Count unknown: plain 0–100 % scale (converting back from the last
            // rebased position so the placement fraction survives).
            if (moeSliderN > 0) {
                var frac = parseFloat(slider.value);
                var pctBack = isNaN(frac) ? 0 : Math.round((frac / moeSliderN) * 100 / 5) * 5;
                slider.min = "0"; slider.max = "100"; slider.step = "5";
                slider.value = String(Math.max(0, Math.min(100, pctBack)));
                moeSliderN = 0;
            }
            if (from === "cpuMoe" && !ck("cpuMoe") && parseFloat(slider.value) === 0) {
                // No expert count to count with, so "one step back to the GPU" is
                // one slider step (5 %) — otherwise the switch could never come off.
                slider.value = "5";
            }
            // ncpuMoe is left alone here: with no total there is nothing to divide
            // by, so it cannot be reflected in the slider — it still flows to the
            // command line as -ncpu-moe N (see CmdGen.buildArgs), which is why the
            // field stays enabled instead of being zeroed or locked.
        }
        cpuMoeReflect();
    }

    // Keep the switch equal to "everything is on the CPU" — slider at its minimum
    // (0 experts in VRAM, or 0 % when the count is unknown). Never touches
    // `disabled`: the box stays clickable in every state.
    function cpuMoeReflect() {
        var cb = el("cpuMoe");
        if (cb) cb.checked = parseFloat(gv("estMoePct")) === 0;
    }

    // Re-sync all dependent-control gates after a bulk state change
    // (init / preset apply / preset load / reset / clear) — checkbox
    // handlers don't fire programmatically, so the estCtxPct slider and
    // estImgLoc select must be re-enabled/snapped here.
    function syncGates() {
        lazyGate();
        moeSync("gate");      // rebases the MoE slider + mirrors ncpu-moe
        var slider = el("estCtxPct");
        slider.disabled = ck("noKvOffload");
        if (ck("noKvOffload")) slider.value = "0";
        var loc = el("estImgLoc");
        loc.disabled = ck("noMmprojOffload");
        if (ck("noMmprojOffload")) loc.value = "ram";
    }

    // Restore the default preset (system-detection inputs are emptied,
    // not restored — they were detected or typed, not part of the preset).
    function resetAll() {
        applyPresetState(DEFAULT_PRESET);
        ["sysGpuArchManual", "sysVramManual", "sysRamManual", "sysSsdManual"].forEach(function(id) {
            if (el(id)) el(id).value = "";
        });
        syncGates();
        updateLldHints("tool");
        updateOutput();
    }

    function clearAll() {
        FIELD_IDS.forEach(function(id) {
            var e = el(id);
            if (!e) return;
            if (e.type === "checkbox") e.checked = false;
            else e.value = "";
        });
        el("ncpuMoe").value = "0";
        syncGates();
        updateLldHints("tool");
        updateOutput();
    }

    // ------------------------------------------------------------------
    // Wiring.
    // ------------------------------------------------------------------
    function bindEvents() {
        var form = document.querySelector(".container");
        form.addEventListener("input", function(ev) {
            if (ev.target && ev.target.closest && ev.target.closest(".field, .check-row, .sys-panel, .mem-est")) {
                if (ev.target.id === "batchSize") clampBatch("batchSize");
                if (ev.target.id === "ubatchSize") clampBatch("ubatchSize");
                if (ev.target.id === "loadMode") lazyGate();
                if (ev.target.id === "noKvOffload") {
                    var slider = el("estCtxPct");
                    if (ev.target.checked) {
                        slider.disabled = true;
                        slider.value = "0";
                    } else {
                        slider.disabled = false;
                    }
                }
                if (ev.target.id === "estMoePct") moeSync("slider");
                if (ev.target.id === "cpuMoe") moeSync("cpuMoe");
                if (ev.target.id === "ncpuMoe") moeSync("ncpuMoe");
                if (ev.target.id === "moeExperts") moeSync("experts");
                if (ev.target.id === "noMmprojOffload") {
                    var loc = el("estImgLoc");
                    if (ev.target.checked) {
                        loc.disabled = true;
                        loc.value = "ram";
                    } else {
                        loc.disabled = false;
                    }
                }
                updateOutput();
            }
        });

        el("presetSelect").addEventListener("change", function() {
            if (this.value) applyPreset(this.value);
            this.value = "";
        });
        el("btnSavePreset").addEventListener("click", savePreset);
        el("btnLoadPreset").addEventListener("click", function() { el("presetFile").click(); });
        el("presetFile").addEventListener("change", function() {
            if (this.files && this.files[0]) loadPresetFile(this.files[0]);
            this.value = "";
        });
        el("btnReset").addEventListener("click", resetAll);
        el("btnClear").addEventListener("click", clearAll);
        el("btnDetect").addEventListener("click", detectSystem);

        el("btnCopy").addEventListener("click", copyOutput);
        el("btnDownload").addEventListener("click", downloadConfig);

        document.querySelectorAll(".output-tab").forEach(function(t) {
            t.addEventListener("click", function() { switchTab(t.getAttribute("data-tab")); });
        });
    }

    function init() {
        // Capture stock placeholders before any preset/preset-mode touches them.
        capturePlaceholders();
        // Help-derived tooltips (window.LLAMA_CPP_DESCRIPTIONS, presets.js).
        applyLldDescriptions();
        // Load the default preset on startup: the JSON above is the single
        // source of truth for initial state (the HTML ships bare controls).
        applyPresetState(DEFAULT_PRESET);
        syncGates();
        bindEvents();
        detectSystem();
        MemEst.buildLegend(); // static: generated once from the AREAS table
        updateOutput();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
