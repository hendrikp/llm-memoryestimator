// Presets for configtool — loaded before logic.js.
//
// Exposes `window.CONFIG_PRESETS`: a map of preset name → state object whose
// keys are field ids (see FIELD_IDS in logic.js). The "default" entry is
// special: it is the tool's **default preset** — applied on startup, restored
// by Reset, and the source `DEFAULTS` (at-default cmd-line omission) is
// derived from. configtool.html therefore carries no value/checked/selected
// attributes at all. It is also selectable in the "Apply preset…" dropdown,
// so you can always get back to a clean slate without hitting Reset.
//
// Values are strings for inputs/selects, booleans for checkboxes. Fields
// missing from a preset are left untouched when it is applied (built-ins are
// partial diffs; "default" is complete). Kept as a .js file (not fetched
// .json) because file:// fetches are blocked in browsers.
(function (global) {
    "use strict";

    global.CONFIG_PRESETS = {

        // Full state — the tool's default preset (startup + Reset).
        "default": {
            "modelPath": "Qwen3.8-27B-NVFP4-MTP-VERY-LOW.gguf",
            "ctxSize": "64000",
            "ngl": "all",
            "ncpuMoe": "0",
            "threads": "8",
            "loadMode": "mlock",
            "lazyMode": "off",
            "cacheK": "q4_0",
            "cacheV": "q4_0",
            "batchSize": "2048",
            "ubatchSize": "512",
            "host": "192.168.2.105",
            "port": "8080",
            "parallel": "1",
            "mainGpu": "0",
            "tensorSplit": "",
            "overrideTensor": "",
            "binaryPath": "llama-server.exe",
            "envVars": "",
            "flashAttn": true,
            "jinja": true,
            "noKvOffload": false,
            "noMmprojOffload": false,
            "promptCache": false,
            "promptCachePath": "",
            "verbose": false,
            "loraPath": "",
            "extraArgs": "",
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
            "grammarFile": "",
            "reasoningBudget": "1024",
            "reasoningPreserve": true,
            "chatKwargs": "{\"reasoning_effort\":\"medium\"}",
            "specType": "",
            "draftModel": "",
            "specDraftNMax": "6",
            "specDraftPMin": "0.75",
            "specTypeK": "",
            "specTypeV": "",
            "estLayersPct": "100",
            "estMoePct": "100",
            "estCtxPct": "100",
            "estImgLoc": "vram",
            "osOverhead": "0.25",
            "cublasOverhead": "0.35",
            "scratchFactor": "0.025"
        },

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
})(window);
