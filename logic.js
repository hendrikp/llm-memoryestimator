(function () {
    "use strict";

    var currentTab = "bat";

    function gv(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
    function ck(id) { var e = document.getElementById(id); return e ? e.checked : false; }
    function el(id) { return document.getElementById(id); }
    function num(id) { var v = parseFloat(gv(id)); return isNaN(v) ? null : v; }

    // ------------------------------------------------------------------
    // Defaults: a param equal to its default is omitted from the cmd line.
    // ------------------------------------------------------------------
    var DEFAULTS = {
        "ctxSize": "64000",
        "ngl": "all",
        "ncpuMoe": "0",
        "threads": "8",
        "loadMode": "mlock",
        "cacheK": "q4_0",
        "cacheV": "q4_0",
        "batchSize": "2048",
        "ubatchSize": "512",
        "parallel": "1",
        "mainGpu": "0",
        "specDraftNMax": "6",
        "specDraftPMin": "0.75",
        "temp": "0.6",
        "topP": "0.95",
        "topK": "20",
        "minP": "0",
        "presPen": "0",
        "repPen": "1.0",
        "freqPen": "0",
        "repLastN": "64",
        "maxTokens": "0",
        "seed": "-1",
        "reasoningBudget": "1024",
        "specType": "",
        "osOverhead": "0.25",
        "cublasOverhead": "0.35",
        "scratchFactor": "0.025"
    };

    function isDefault(id) {
        return gv(id) === DEFAULTS[id];
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
            if (isNaN(v)) v = DEFAULTS.ubatchSize;
            e.value = roundToMultiple(v, 32, 32);
            // Keep the batch input and its value consistent with the new ubatch.
            var b = el("batchSize");
            b.min = e.value;
            b.step = e.value;
            var bv = parseFloat(b.value);
            b.value = isNaN(bv) ? DEFAULTS.batchSize : roundToMultiple(bv, parseInt(e.value, 10), parseInt(e.value, 10));
            return;
        }
        // batchSize: multiple of the (already clamped) ubatch size.
        var u = getUbatch();
        if (isNaN(v)) v = DEFAULTS.batchSize;
        e.value = roundToMultiple(v, u, u);
    }

    // ------------------------------------------------------------------
    // Build the argument list. Params at default are omitted.
    // ------------------------------------------------------------------
    function buildArgs() {
        var args = [];
        var envLines = gv("envVars") ? gv("envVars").split("\n").filter(function(l) { return l.trim(); }) : [];

        if (gv("modelPath")) args.push("-m " + gv("modelPath"));
        if (!isDefault("ctxSize")) args.push("-c " + gv("ctxSize"));
        if (!isDefault("ngl")) args.push("-ngl " + gv("ngl"));
        var ncpuMoe = Math.max(0, num("ncpuMoe") || 0);
        if (ncpuMoe > 0) args.push("-ncpu-moe");
        if (!isDefault("threads")) args.push("-t " + gv("threads"));
        if (!isDefault("loadMode")) args.push("--load-mode " + gv("loadMode"));
        if (!isDefault("cacheK")) args.push("--cache-type-k " + gv("cacheK"));
        if (!isDefault("cacheV")) args.push("--cache-type-v " + gv("cacheV"));
        if (!isDefault("batchSize")) args.push("--batch-size " + gv("batchSize"));
        if (!isDefault("ubatchSize")) args.push("--ubatch-size " + gv("ubatchSize"));
        if (!isDefault("host")) args.push("--host " + gv("host"));
        if (!isDefault("port")) args.push("--port " + gv("port"));
        if (!isDefault("parallel")) args.push("--parallel " + gv("parallel"));
        if (!isDefault("mainGpu")) args.push("--main-gpu " + gv("mainGpu"));
        if (gv("tensorSplit")) args.push("--tensor-split " + gv("tensorSplit"));

        if (ck("flashAttn")) args.push("--flash-attn on");
        if (ck("jinja")) args.push("--jinja");
        if (ck("noKvOffload")) args.push("--no-kv-offload");
        if (ck("noMmprojOffload")) args.push("--no-mmproj-offload");
        if (ck("promptCache")) args.push("--prompt-cache " + (gv("promptCachePath") || "cache.bin"));
        if (ck("verbose")) args.push("-v");
        if (gv("loraPath")) args.push("--lora " + gv("loraPath"));
        if (gv("grammarFile")) args.push("--grammar " + gv("grammarFile"));

        if (!isDefault("specType")) args.push("--draft " + gv("specType") + (gv("draftModel") ? " " + gv("draftModel") : ""));
        if (gv("draftModel") && isDefault("specType")) args.push("--draft " + gv("draftModel"));
        if (!isDefault("specDraftNMax")) args.push("--draft-n-max " + gv("specDraftNMax"));
        if (!isDefault("specDraftPMin")) args.push("--draft-p-min " + gv("specDraftPMin"));
        if (gv("specTypeK")) args.push("--draft-type-k " + gv("specTypeK"));
        if (gv("specTypeV")) args.push("--draft-type-v " + gv("specTypeV"));

        if (!isDefault("temp")) args.push("--temp " + gv("temp"));
        if (!isDefault("topP")) args.push("--top-p " + gv("topP"));
        if (!isDefault("topK")) args.push("--top-k " + gv("topK"));
        if (!isDefault("minP")) args.push("--min-p " + gv("minP"));
        if (!isDefault("presPen")) args.push("--presence-penalty " + gv("presPen"));
        if (!isDefault("repPen")) args.push("--repeat-penalty " + gv("repPen"));
        if (!isDefault("freqPen")) args.push("--frequency-penalty " + gv("freqPen"));
        if (!isDefault("repLastN")) args.push("--repeat-last-n " + gv("repLastN"));
        if (!isDefault("maxTokens")) args.push("-n " + gv("maxTokens"));
        if (!isDefault("seed")) args.push("--seed " + gv("seed"));

        if (!isDefault("reasoningBudget")) args.push("--reasoning-budget " + gv("reasoningBudget"));
        if (ck("reasoningPreserve")) args.push("--reasoning-preserve");

        if (gv("extraArgs")) args.push(gv("extraArgs"));

        var kwargs = [];
        if (gv("chatKwargs")) kwargs.push(gv("chatKwargs"));

        return { args: args, envLines: envLines, kwargs: kwargs };
    }

    // ------------------------------------------------------------------
    // Script generators. Each returns the full text for one tab.
    // ------------------------------------------------------------------
    function shellQuote(s) {
        s = s.replace(/'/g, "'\\''");
        return "'" + s + "'";
    }

    function genBat(binary, args, envLines, kwargs) {
        var lines = ["@echo off", "REM generated by configtool — " + new Date().toISOString().slice(0, 10), ""];
        envLines.forEach(function(l) { lines.push("set " + l); });
        if (envLines.length) lines.push("");
        lines.push(binary + " " + args.join(" ") + (kwargs.length ? " --chat-template-kwargs " + kwargs.join(" ") : ""));
        lines.push("");
        lines.push("pause");
        return lines.join("\r\n");
    }

    function genPs1(binary, args, envLines, kwargs) {
        var lines = ["# generated by configtool — " + new Date().toISOString().slice(0, 10), ""];
        envLines.forEach(function(l) {
            var eq = l.indexOf("=");
            lines.push("$env:" + l.slice(0, eq) + " = " + l.slice(eq + 1));
        });
        if (envLines.length) lines.push("");
        lines.push("& " + binary + " " + args.join(" ") + (kwargs.length ? " --chat-template-kwargs " + kwargs.join(" ") : ""));
        return lines.join("\r\n");
    }

    function genSh(binary, args, envLines, kwargs) {
        var lines = ["#!/usr/bin/env bash", "# generated by configtool — " + new Date().toISOString().slice(0, 10), "set -euo pipefail", ""];
        envLines.forEach(function(l) { lines.push("export " + l); });
        if (envLines.length) lines.push("");
        lines.push(binary + " " + args.join(" ") + (kwargs.length ? " --chat-template-kwargs " + kwargs.join(" ") : ""));
        lines.push("");
        lines.push("# chmod +x run-server.sh && ./run-server.sh");
        return lines.join("\n");
    }

    function genJson(binary, args, envLines, kwargs) {
        var cfg = {
            binary: binary,
            model: gv("modelPath") || null,
            context: parseInt(gv("ctxSize")) || null,
            gpu_layers: gv("ngl") || null,
            ncpu_moe_experts: Math.max(0, num("ncpuMoe") || 0),
            threads: parseInt(gv("threads")) || null,
            server: {
                host: gv("host") || null,
                port: parseInt(gv("port")) || null,
                parallel: parseInt(gv("parallel")) || null
            },
            sampling: {
                temperature: parseFloat(gv("temp")),
                top_p: parseFloat(gv("topP")),
                top_k: parseInt(gv("topK")),
                min_p: parseFloat(gv("minP")),
                presence_penalty: parseFloat(gv("presPen")),
                repeat_penalty: parseFloat(gv("repPen")),
                frequency_penalty: parseFloat(gv("freqPen")),
                repeat_last_n: parseInt(gv("repLastN")),
                max_tokens: parseInt(gv("maxTokens")) || null,
                seed: parseInt(gv("seed"))
            },
            env: envLines,
            extra_args: args.slice(1)
        };
        if (kwargs.length) cfg.chat_template_kwargs = kwargs[0];
        return JSON.stringify(cfg, null, 2);
    }

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
        // Slider value displays.
        el("tempVal").textContent = parseFloat(gv("temp")).toFixed(2);
        el("topPVal").textContent = parseFloat(gv("topP")).toFixed(2);
        el("minPVal").textContent = parseFloat(gv("minP")).toFixed(2);
        el("presPenVal").textContent = parseFloat(gv("presPen")).toFixed(2);
        el("repPenVal").textContent = parseFloat(gv("repPen")).toFixed(2);
        el("freqPenVal").textContent = parseFloat(gv("freqPen")).toFixed(2);

        var built = buildArgs();
        var binary = gv("binaryPath") || "llama-server";
        var text = "";
        if (currentTab === "bat") text = genBat(binary, built.args, built.envLines, built.kwargs);
        else if (currentTab === "ps1") text = genPs1(binary, built.args, built.envLines, built.kwargs);
        else if (currentTab === "sh") text = genSh(binary, built.args, built.envLines, built.kwargs);
        else text = genJson(binary, built.args, built.envLines, built.kwargs);
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
        "modelPath", "ctxSize", "ngl", "ncpuMoe", "threads", "loadMode", "cacheK", "cacheV",
        "batchSize", "ubatchSize", "host", "port", "parallel", "mainGpu", "tensorSplit",
        "binaryPath", "envVars",
        "flashAttn", "jinja", "noKvOffload", "noMmprojOffload", "promptCache", "promptCachePath", "verbose",
        "loraPath", "extraArgs",
        "temp", "topP", "topK", "minP", "presPen", "repPen", "freqPen", "repLastN",
        "maxTokens", "seed", "grammarFile",
        "reasoningBudget", "reasoningPreserve", "chatKwargs",
        "specType", "draftModel", "specDraftNMax", "specDraftPMin", "specTypeK", "specTypeV",
        "sysGpuArchManual", "sysVramManual", "sysRamManual",
        "estLayersPct", "estMoePct", "estCtxPct", "estImgLoc",
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

    function applyState(state) {
        FIELD_IDS.forEach(function(id) {
            var e = el(id);
            if (!e || !(id in state)) return;
            if (e.type === "checkbox") e.checked = !!state[id];
            else e.value = state[id];
        });
        updateOutput();
    }

    var PRESETS = {
        chat: {
            "ctxSize": "32000", "threads": "16", "batchSize": "4096", "ubatchSize": "1024",
            "temp": "0.7", "topP": "0.95", "topK": "40", "repPen": "1.1", "repLastN": "64",
            "maxTokens": "4096", "chatKwargs": "{\"reasoning_effort\":\"medium\"}"
        },
        fast: {
            "ctxSize": "16000", "threads": "32", "batchSize": "8192", "ubatchSize": "2048",
            "temp": "0.6", "topP": "0.9", "topK": "20", "maxTokens": "2048"
        },
        quality: {
            "ctxSize": "64000", "threads": "16", "batchSize": "4096", "ubatchSize": "1024",
            "temp": "0.5", "topP": "0.95", "topK": "30", "repPen": "1.05", "maxTokens": "8192",
            "cacheK": "q8_0", "cacheV": "q8_0"
        },
        embed: {
            "ctxSize": "32000", "threads": "16", "batchSize": "8192", "ubatchSize": "2048",
            "temp": "0", "topP": "1", "topK": "1", "maxTokens": "0"
        }
    };

    function applyPreset(name) {
        if (name === "myconfig") {
            showToast("Use “Load preset” to restore your saved config");
            return;
        }
        var p = PRESETS[name];
        if (!p) return;
        applyState(p);
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
                applyState(JSON.parse(reader.result));
                showToast("Preset loaded");
            } catch (e) {
                showToast("Invalid preset file");
            }
        };
        reader.readAsText(file);
    }

    function resetAll() {
        el("modelPath").value = "Qwen3.8-27B-NVFP4-MTP-VERY-LOW.gguf";
        el("ctxSize").value = "64000";
        el("ngl").value = "all";
        el("ncpuMoe").value = "0";
        el("threads").value = "8";
        el("loadMode").value = "mlock";
        el("cacheK").value = "q4_0";
        el("cacheV").value = "q4_0";
        el("batchSize").value = "2048";
        el("ubatchSize").value = "512";
        el("host").value = "192.168.2.105";
        el("port").value = "8080";
        el("parallel").value = "1";
        el("mainGpu").value = "0";
        el("tensorSplit").value = "";
        el("binaryPath").value = "llama-server.exe";
        el("envVars").value = "";
        el("flashAttn").checked = true;
        el("jinja").checked = true;
        el("noKvOffload").checked = false;
        el("noMmprojOffload").checked = false;
        el("promptCache").checked = false;
        el("promptCachePath").value = "";
        el("verbose").checked = false;
        el("loraPath").value = "";
        el("extraArgs").value = "";
        el("temp").value = "0.6";
        el("topP").value = "0.95";
        el("topK").value = "20";
        el("minP").value = "0";
        el("presPen").value = "0";
        el("repPen").value = "1.0";
        el("freqPen").value = "0";
        el("repLastN").value = "64";
        el("maxTokens").value = "0";
        el("seed").value = "-1";
        el("grammarFile").value = "";
        el("reasoningBudget").value = "1024";
        el("reasoningPreserve").checked = true;
        el("chatKwargs").value = "{\"reasoning_effort\":\"medium\"}";
        el("specType").value = "";
        el("draftModel").value = "";
        el("specDraftNMax").value = "6";
        el("specDraftPMin").value = "0.75";
        el("specTypeK").value = "";
        el("specTypeV").value = "";
        ["estLayersPct", "estMoePct", "estCtxPct"].forEach(function(id) { el(id).value = "100"; el(id).disabled = false; });
        el("estImgLoc").value = "vram";
        el("estImgLoc").disabled = false;
        el("osOverhead").value = "0.25";
        el("cublasOverhead").value = "0.35";
        el("scratchFactor").value = "0.025";
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
                if (ev.target.id === "noKvOffload") {
                    var slider = el("estCtxPct");
                    if (ev.target.checked) {
                        slider.disabled = true;
                        slider.value = "0";
                    } else {
                        slider.disabled = false;
                    }
                }
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
