// Presets for configtool — loaded before logic.js.
//
// Also exposes `window.LLAMA_CPP_DEFAULTS`: the real `llama-server` cmd-line
// defaults (taken from `llama-server --help`), restricted to fields this tool
// already has — it adds no new options. This table is the single source of
// truth for (a) the "llamacpp_defaults" preset, (b) cmd-line omission in
// logic.js (options at these values — or empty — are not emitted), (c) the
// watermark placeholders shown when a field sits at its llama.cpp default,
// and (d) fallbacks in logic_memory.js (no magic numbers are duplicated in
// code). "" means: unset / auto / loaded-from-model (no switch emitted).
//
// Also exposes `window.LLAMA_CPP_DESCRIPTIONS`: per-field tooltip text
// condensed from `llama-server --help` (flags, allowed values, defaults,
// env vars). Mapping keys are the same field ids as the presets; logic.js
// applies them as `title` tooltips on the controls ("tool: ..." marks
// tool-only fields that have no server flag).
//
// Exposes `window.CONFIG_PRESETS`: a map of preset name → state object whose
// keys are field ids (see FIELD_IDS in logic.js). The "default" entry is
// special: it is the tool's **default preset** — applied on startup, restored
// by Reset. configtool.html therefore carries no value/checked/selected
// attributes at all. It is also selectable in the "Apply preset…" dropdown,
// so you can always get back to a clean slate without hitting Reset. The
// "llamacpp_defaults" entry (built from LLAMA_CPP_DEFAULTS) is likewise
// selectable; cmd-line omission is derived from LLAMA_CPP_DEFAULTS, not from
// "default".
//
// Values are strings for inputs/selects, booleans for checkboxes. Fields
// missing from a preset are left untouched when it is applied (built-ins are
// partial diffs; "default" is complete). Kept as a .js file (not fetched
// .json) because file:// fetches are blocked in browsers.
(function (global) {
    "use strict";

    // ----------------------------------------------------------------------
    // Real llama-server cmd-line defaults for exactly the field ids this
    // tool exposes (see FIELD_IDS in logic.js), from `llama-server --help`.
    // "" = no standalone default / auto / unset (e.g. -m, -c = loaded from
    // model, -t = -1 auto). Numeric fields that do have a real default carry
    // it (batch 2048, temp 0.8, ...). The trailing est*/overhead entries are
    // not server flags but the tool-side memory-estimator factors; they live
    // here so their fallbacks exist exactly once (used by logic_memory.js).
    // sysVramManual/sysRamManual are detection guesses, not defaults — they
    // are intentionally NOT part of this table.
    // ----------------------------------------------------------------------
    global.LLAMA_CPP_DEFAULTS = {
        "modelPath": "",            // -m: unset (no default model)
        "modelAlias": "",           // --alias: unset (also drives the memory estimate)
        "ctxSize": "",              // -c: 0 = loaded from model
        "ngl": "",                  // -ngl: auto
        "ncpuMoe": "0",             // --n-cpu-moe: 0
        "cpuMoe": false,            // --cpu-moe: off (tool forces it on at MoE VRAM 0 %)
        "threads": "",              // -t: -1 = auto
        "loadMode": "auto",         // -lm: auto
        "lazyMode": "auto",         // -lzm: auto (tool only emits it with mmap)
        "cacheK": "f16",            // -ctk: f16
        "cacheV": "f16",            // -ctv: f16
        "batchSize": "2048",        // -b: 2048
        "ubatchSize": "512",        // -ub: 512
        "host": "127.0.0.1",        // --host
        "port": "8080",             // --port
        "parallel": "",             // -np: -1 = auto
        "mainGpu": "0",             // -mg: 0
        "tensorSplit": "",          // -ts: unset
        "overrideTensor": "",       // -ot: unset
        "binaryPath": "llama-server", // tool-only: binary name
        "envVars": "",              // tool-only
        "flashAttn": true,          // -fa: auto ≈ on
        "jinja": true,              // --jinja: enabled
        "noKvOffload": false,       // -kvo: KV offload enabled by default
        "noMmprojOffload": false,   // mmproj offload enabled by default
        "promptCache": false,       // tool-only wrapper (server has no default cache file)
        "promptCachePath": "",
        "verbose": false,           // -lv: 3 (info); -v off
        "loraPath": "",             // --lora: unset
        "extraArgs": "",            // tool-only
        "temp": "0.8",              // --temp: 0.80
        "topP": "0.95",             // --top-p: 0.95
        "topK": "40",               // --top-k: 40
        "minP": "0.05",             // --min-p: 0.05
        "presPen": "0",             // --presence-penalty: 0.00
        "repPen": "1",              // --repeat-penalty: 1.00
        "freqPen": "0",             // --frequency-penalty: 0.00
        "repLastN": "64",           // --repeat-last-n: 64
        "maxTokens": "",            // -n: -1 = infinity (tool: 0/-1/empty all mean unset)
        "seed": "",                 // -s: -1 = random
        "grammarFile": "",          // --grammar: unset
        "reasoningBudget": "",      // --reasoning-budget: -1 unrestricted
        "reasoningPreserve": false, // template default (off unless template enables)
        "chatKwargs": "",           // --chat-template-kwargs: unset
        "specType": "",             // --spec-type: none (the select spells this "none"; see LLAMA_CPP_DEFAULT_UNSET)
        "draftModel": "",           // -md: unused
        "specDraftNMax": "3",       // --spec-draft-n-max: 3
        "specDraftPMin": "0",       // --spec-draft-p-min: 0.00
        "specTypeK": "",            // draft KV types: unset here (server default f16)
        "specTypeV": "",
        "specDraftGB": "0",         // tool: drafter size in GB (0 = estimate from the model name)
        // Tool-side memory-estimator factors (no server-flag equivalents) —
        // kept in this table so every estimator fallback exists exactly once.
        "moeExperts": "0",          // tool: total expert count (0 = derive from name)
        "moeExpertGB": "0",         // tool: GB per expert (0 = derive from name)
        "estLayersPct": "100",
        "estMoePct": "100",
        "estOtherPct": "100",
        "estCtxPct": "100",
        "estImgLoc": "vram",
        "osOverhead": "0.25",
        "cublasOverhead": "0.35",
        "scratchFactor": "0.025"
    };

    // "Unset" spellings per field: values that mean the same as empty (the
    // server/tool default) and therefore also suppress the switch. maxTokens:
    // 0 (tool convention) and -1 (llama.cpp) both mean "no limit"; seed /
    // reasoningBudget likewise spell their default as -1.
    global.LLAMA_CPP_DEFAULT_UNSET = {
        specType: ["none"],   // the select has no empty option; "none" is the unset spelling
        maxTokens: ["0", "-1"],
        seed: ["-1"],
        reasoningBudget: ["-1"]
    };

    // ----------------------------------------------------------------------
    // Tooltip descriptions condensed from `llama-server --help` — same keys
    // as the presets (field ids). Tool-only fields are prefixed "tool:".
    // ----------------------------------------------------------------------
    global.LLAMA_CPP_DESCRIPTIONS = {
        "modelPath": "-m, --model FNAME — model path to load (env: LLAMA_ARG_MODEL)",
        "modelAlias": "--alias STRING — model name aliases, comma-separated (to be used by API, env: LLAMA_ARG_ALIAS); tool: drives the memory estimate when set (fallback: filename)",
        "ctxSize": "-c, --ctx-size N — size of the prompt context (default: 0, 0 = loaded from model)",
        "ngl": "-ngl, --gpu-layers N — max. number of layers to store in VRAM: exact number, 'auto', or 'all' (default: auto)",
        "ncpuMoe": "-ncmoe, --n-cpu-moe N — keep the MoE weights of the first N layers in the CPU; 0 = all on GPU; kept in sync with the MoE placement slider while the expert count is known (clamped to it, supressed by --cpu-moe) (env: LLAMA_ARG_N_CPU_MOE)",
        "cpuMoe": "--cpu-moe — keep all MoE expert weights in the CPU (env: LLAMA_ARG_CPU_MOE); tool: always toggleable — ticking it moves every expert to the CPU (slider to its minimum, count to the total); moving the slider or lowering the cpu count unticks it",
        "threads": "-t, --threads N — CPU threads during generation (default: -1 = auto)",
        "loadMode": "-lm, --load-mode MODE — model loading mode: auto (mmap unless device lacks it) | none | mmap | mlock | mmap+mlock | dio (default: auto)",
        "lazyMode": "-lzm, --lazy-mode MODE — on-demand reading of certain tensors (e.g. per-layer embeddings): on | auto (on only for tensors > 4 GiB) | off; requires mmap (default: auto)",
        "cacheK": "-ctk, --cache-type-k TYPE — KV cache data type for K: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1 (default: f16)",
        "cacheV": "-ctv, --cache-type-v TYPE — KV cache data type for V: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1 (default: f16)",
        "batchSize": "-b, --batch-size N — logical maximum batch size (default: 2048); must be a multiple of --ubatch-size",
        "ubatchSize": "-ub, --ubatch-size N — physical maximum batch size (default: 512); multiple of 32",
        "host": "--host HOST — ip address to listen, or UNIX socket if ending in .sock (default: 127.0.0.1)",
        "port": "--port PORT — port to listen (default: 8080)",
        "parallel": "-np, --parallel N — number of server slots (default: -1 = auto)",
        "mainGpu": "-mg, --main-gpu INDEX — GPU for the model (split-mode none) or for intermediate results and KV (split-mode row) (default: 0)",
        "tensorSplit": "-ts, --tensor-split N0,N1,N2,... — fraction of the model to offload to each GPU, e.g. 3,1",
        "overrideTensor": "-ot, --override-tensor <tensor name pattern>=<buffer type>,... — override tensor buffer type (env: LLAMA_ARG_OVERRIDE_TENSOR)",
        "binaryPath": "tool: path to the llama-server binary (not a server flag); default: llama-server",
        "envVars": "tool: environment variables, KEY=VALUE per line, set before launching the server (not server flags)",
        "flashAttn": "-fa, --flash-attn [on|off|auto] — use Flash Attention (default: auto ≈ on)",
        "jinja": "--jinja, --no-jinja — use jinja template engine for chat (default: enabled)",
        "noKvOffload": "-nkvo, --no-kv-offload — disable KV cache offloading (-kvo, --kv-offload default: enabled)",
        "noMmprojOffload": "--no-mmproj-offload — disable GPU offloading for the multimodal projector (default: enabled)",
        "promptCache": "tool: emits '--prompt-cache <path>' (not in the current help; server-side prompt caching --cache-prompt is enabled by default)",
        "promptCachePath": "tool: cache file path for the --prompt-cache switch (default: cache.bin)",
        "verbose": "-v, --verbose — set verbosity level to infinity, log all (default threshold: -lv 3 info)",
        "loraPath": "--lora FNAME — path to LoRA adapter; comma-separated for multiple adapters",
        "extraArgs": "tool: any additional llama-server flags, appended verbatim (not parsed)",
        "temp": "--temp, --temperature N — temperature (default: 0.80)",
        "topP": "--top-p N — top-p sampling (default: 0.95, 1.0 = disabled)",
        "topK": "--top-k N — top-k sampling (default: 40, 0 = disabled)",
        "minP": "--min-p N — min-p sampling (default: 0.05, 0.0 = disabled)",
        "presPen": "--presence-penalty N — repeat alpha presence penalty (default: 0.00, 0.0 = disabled)",
        "repPen": "--repeat-penalty N — penalize repeat sequence of tokens (default: 1.00, 1.0 = disabled)",
        "freqPen": "--frequency-penalty N — repeat alpha frequency penalty (default: 0.00, 0.0 = disabled)",
        "repLastN": "--repeat-last-n N — last n tokens to consider for penalize (default: 64, 0 = disabled)",
        "maxTokens": "-n, --predict N — number of tokens to predict (default: -1 = infinity); tool: 0/empty also mean unset",
        "seed": "-s, --seed SEED — RNG seed (default: -1 = random)",
        "grammarFile": "--grammar-file FNAME — file to read grammar from (BNF-like grammar to constrain generations)",
        "reasoningBudget": "--reasoning-budget N — token budget for thinking: -1 unrestricted (default) | 0 immediate end | N>0 budget",
        "reasoningPreserve": "--reasoning-preserve — preserve reasoning trace in the full history, not just the last assistant message (default: template default)",
        "chatKwargs": "--chat-template-kwargs STRING — additional params for the json template parser, must be a valid json object string, e.g. {\"key1\":\"value1\"}",
        "specType": "--spec-type TYPE — speculative decoding type(s): none (default), draft-simple, draft-eagle3, draft-mtp, draft-dflash, draft-dspark, ngram-simple, ngram-map-k, ngram-map-k4v, ngram-mod, ngram-cache; the drafter takes VRAM only while a type other than none is selected (its size: see the GB field)",
        "specDraftGB": "tool: size of the speculative drafter in GB used by the memory estimator — counts as a VRAM area while a spec type other than none is selected; 0 = estimate from the model name (≈ 5% of the active weights for MTP models) instead",
        "draftModel": "-md, --model-draft FNAME — draft model for speculative decoding (default: unused)",
        "specDraftNMax": "--spec-draft-n-max N — number of tokens to draft for speculative decoding (default: 3)",
        "specDraftPMin": "--spec-draft-p-min P — minimum speculative decoding probability (greedy) (default: 0.00)",
        "specTypeK": "-ctkd, --cache-type-k-draft TYPE — KV cache data type for K for the draft model (default: f16)",
        "specTypeV": "-ctvd, --cache-type-v-draft TYPE — KV cache data type for V for the draft model (default: f16)",
        "estLayersPct": "tool: VRAM/RAM split of the non-MoE layers area (memory estimator only)",
        "moeExperts": "tool: total number of experts in the model — together with the per-expert size this is what makes the expert area (and therefore --n-cpu-moe / --cpu-moe) computable; while > 0 the MoE VRAM slider is re-based to 0…n (experts in VRAM) and kept in sync with --n-cpu-moe; 0 = estimate from the model name instead",
        "moeExpertGB": "tool: size of ONE expert in GB (quantised) — experts area = n x this; 0 = estimate from the model name instead",
        "sysSsdManual": "tool: disk space reserved for llama.cpp in GB — capacity of the SSD bar; the 'other layers' area spills onto it (nothing about disk can be detected from the browser, so this is typed in)",
        "estOtherPct": "tool: placement of the 'other layers' area — sized as model size − main layers − experts (ngram/embedding tensors): +100 = all VRAM, 0 = all RAM, −100 = all on SSD; offloading fills RAM first and only then spills to disk (memory estimator only)",
        "estMoePct": "tool: VRAM/RAM split of the MoE experts area — while the expert count is known the slider reads experts in VRAM (0…n) instead of a percent and stays in sync with --n-cpu-moe (memory estimator only)",
        "estCtxPct": "tool: VRAM/RAM split of the KV cache area (memory estimator only)",
        "estImgLoc": "tool: placement of the image/mmproj area, VRAM or RAM (memory estimator only)",
        "osOverhead": "tool: OS / driver VRAM overhead in GB shown on the memory bar (not a server flag)",
        "cublasOverhead": "tool: cuBLAS workspace VRAM overhead in GB shown on the memory bar (not a server flag)",
        "scratchFactor": "tool: scratchpad factor in GB per billion params that are resident in VRAM (main layers + MoE experts) — offloading weights to RAM shrinks the scratchpad (not a server flag)"
    };

    global.CONFIG_PRESETS = {

        // Full state — the tool's default preset (startup + Reset).
        "default": {
            "modelPath": "Qwen3.8-27B-NVFP4-MTP-VERY-LOW.gguf",
            "modelAlias": "",
            "ctxSize": "64000",
            "ngl": "all",
            "ncpuMoe": "0",
            "cpuMoe": false,
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
            "specType": "none",     // the select has no empty option — "none" is spelled explicitly
            "draftModel": "",
            "specDraftNMax": "6",
            "specDraftPMin": "0.75",
            "specTypeK": "",
            "specTypeV": "",
            "specDraftGB": "0",
            "estLayersPct": "100",
            "moeExperts": "0",
            "moeExpertGB": "0",
            "estMoePct": "100",
            "estOtherPct": "100",
            "estCtxPct": "100",
            "estImgLoc": "vram",
            "osOverhead": "0.25",
            "cublasOverhead": "0.35",
            "scratchFactor": "0.025"
        },

        // Real llama-server defaults: every tracked field is empty or at its
        // `--help` default, so cmd generation emits only what the user sets
        // on top of stock llama.cpp behaviour (see LLAMA_CPP_DEFAULTS).
        // Text/number inputs and gated selects are left EMPTY with the
        // default shown as watermark (logic.js fills placeholders from
        // LLAMA_CPP_DEFAULTS when this preset is applied); sliders carry the
        // numeric default because they cannot show a watermark. lazyMode
        // "auto" is the server default but gets snapped to "off" unless
        // Load Mode is mmap (lazyGate), and is only ever emitted with mmap.
        "llamacpp_defaults": (function () {
            var d = global.LLAMA_CPP_DEFAULTS, p = {}, k;
            for (k in d) p[k] = d[k];
            // Selects cannot render a watermark, so they keep their default
            // option selected (the HTML lists the default first: loadMode
            // auto, cacheK/cacheV f16, specType none, estImgLoc VRAM,
            // lazyMode auto — snapped by lazyGate). Only the gated selects
            // are emptied here when the empty value has an option.
            p.loadMode = "auto";      // -lm auto
            p.specType = "none";      // --spec-type none (unset spelling; never emitted)
            p.cacheK = "f16"; p.cacheV = "f16";
            p.threads = ""; p.parallel = ""; p.ctxSize = ""; p.ngl = "";
            p.host = ""; p.port = ""; // 127.0.0.1 / 8080 watermarks (bind addr is per-machine, always emitted when set)
            p.modelPath = "";
            p.maxTokens = ""; p.seed = ""; p.reasoningBudget = "";
            p.lazyMode = "auto";      // gated; snaps to off unless load mode is mmap
            return p;
        })(),

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
