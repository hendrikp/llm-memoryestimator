# configtool — llama.cpp Memory Distribution Estimator

A single-page HTML tool whose **main purpose** is a rough VRAM/RAM memory-usage
estimator with **two stacked distribution bars** (VRAM on top, RAM below),
plus a `llama-server` launch-script builder (.bat / .ps1 / .sh / JSON) from a form.

Static site — no build step, no dependencies. Open `configtool.html` in a browser
(`file://` works; serving over `http://` only matters for clipboard on some setups).

> **Note (reconstruction):** `logic.js` was accidentally destroyed and rebuilt from
> `agents.md`, `configtool.html`, and partial fragments. The function map below and all
> element ids are faithful, but *internal* details that were not documented here (exact
> preset values, estimate coefficients, script-comment wording) are best-effort
> reconstructions — sanity-check generated output after editing.

## File layout

| File | Role |
|------|------|
| `configtool.html` | Markup only. All form fields (bare — no `value`/``checked`/`selected` attributes; tooltips are applied from JS), the system panel, the memory panel, the output tabs. Links `style.css`, loads `logic_memory.js`, then `presets.js`, then `logic_cmdgenerator.js`, then `logic.js` (order matters — `logic.js` calls `MemEst.*` / `CmdGen.*` and reads `window.CONFIG_PRESETS`). |
| `presets.js` | `window.LLAMA_CPP_DEFAULTS` + `window.LLAMA_CPP_DEFAULT_UNSET` + `window.LLAMA_CPP_DESCRIPTIONS` (per-field `--help` tooltip texts, same field-id keys as the presets) + `window.CONFIG_PRESETS`: the **default preset** (`"default"`, full state), the **llamacpp_defaults preset** (real `llama-server --help` defaults, built from `LLAMA_CPP_DEFAULTS`) and the built-in partial presets (`chat` / `fast` / `quality` / `embed`). All selectable from the Apply-preset dropdown ("default" included). Kept as `.js` (not fetched `.json`) because `file://` fetches are blocked; downloading a preset gives you the same JSON. |
| `style.css` | All styling. CSS variables live in `:root`. Memory-bar classes are prefixed `mem-*`, system-panel `sys-*`. |
| `logic_memory.js` | Memory size estimation + VRAM/RAM bar rendering, wrapped in an IIFE. Exposes `window.MemEst` (`updateMemBar`, `computeEstimates`, `parseModel`, `getCap`). Owns its own `gv`/`ck`/`el` DOM helpers. |
| `logic_cmdgenerator.js` | All command-line logic, wrapped in an IIFE, exposed as `window.CmdGen` (`buildArgs`, `genBat`, `genPs1`, `genSh`, `genJson`). Long flag spellings only, reference emission order, one option per line in the rendered scripts (flag and value together), omission against `LLAMA_CPP_DEFAULTS`. Reads form state directly by id (like `logic_memory.js`). |
| `logic.js` | All other behavior (presets, watermarks, gates, tabs, clipboard), wrapped in an IIFE. See function map below. Calls `MemEst.updateMemBar()` and `CmdGen.*` from `updateOutput()`. |

## How the pieces connect

- Every form control has a stable `id`. JS reads/writes **only** by id (helpers `gv`, `ck`, `el`).
  When adding a field: add the `id` in `configtool.html`, then register it in `logic.js`
  (`DEFAULTS`, `FIELD_IDS`, `resetAll`, `clearAll`, and `buildArgs` where it affects output).
- Any `input`/`change` on a form control fires `updateOutput()`, which regenerates the
  active tab's script **and** re-renders the memory bars via `MemEst.updateMemBar()`. That
  is the single refresh path.
- `currentTab` selects which generator runs (`bat` / `ps1` / `sh` / `json`).

## Main functions (logic.js)

**Argument building & script generation** (`logic_cmdgenerator.js`, `window.CmdGen`)
- `CmdGen.buildArgs()` — assembles the ordered arg list + env lines + chat kwargs;
  the single source of truth for what gets emitted. Rules (see the file header):
  **long flag spellings only** (`--threads`, `--model`, `--n-gpu-layers`, `--cpu-moe`,
  `--ncpu-moe`,
  `--n-predict`, `--grammar-file`, `--model-draft`, …; `--flash-attn` carries the
  explicit value `on`); emission order follows the reference cmd line (model/alias,
  host/port, sampling, jinja/reasoning, slots/threads, ctx/offload/caches/load-mode,
  batch, misc switches, speculative, extras); entries are raw token strings or
  `[flag, value]` pairs (`arg()`).
- `CmdGen.genBat/genPs1/genSh` — **one option per line**, flag and its value always
  on the *same* line (`--model "path"`, never the value alone on the next line), via
  `renderCmd()` with the proper continuation (` ^\r\n` bat / ` `\n` ps1 / ` \\\n` sh,
  trailing `\` for sh).
  Pair values are quoted with the style's quote char (`"` bat/ps1, `'` sh) when they
  contain whitespace — never nested; a value already containing `"…` (user batch
  syntax) gets single quotes; raw token strings (extraArgs) pass through verbatim.
  The binary is always quoted (`"%~dp0\...\llama-server.exe"`). `--chat-template-kwargs`
  is appended last, its JSON value quoted as one token.
- `CmdGen.genJson` — structured config; `extra_args` only lists raw token strings
  (pairs live in their own keys), plus `alias` next to `model`.
- `isAtLld(id)` / `isUnset(id)` / `sameVal` / `numR` / `q` / `arg` — helpers inside
  `logic_cmdgenerator.js` (not exported; logic.js keeps its own small `lld()` for
  placeholders/batch clamping).

**Presets & defaults** (logic.js)
- `PRESETS` / `DEFAULT_PRESET` — read from `window.CONFIG_PRESETS` (defined in
  **`presets.js`**). `"default"` is the full-state **default preset**: `init()` applies it
  on startup, `resetAll()` restores it, it is selectable in the Apply-preset dropdown,
  and "Save preset" writes exactly this shape. `configtool.html` carries **no**
  `value`/`checked`/`selected` attributes — controls only get values from presets.
  Alongside it sits the **`llamacpp_defaults`** preset (real `llama-server --help`
  defaults, built from `window.LLAMA_CPP_DEFAULTS`) — also selectable.
- `DEFAULT_PRESET` — `PRESETS["default"]`, applied on startup and by Reset. Cmd-line
  omission is **not** based on it (the old `DEFAULTS`-based omit was replaced by `LLD`).
- `LLD` / `LLD_UNSET` — `window.LLAMA_CPP_DEFAULTS` / `window.LLAMA_CPP_DEFAULT_UNSET`
  from `presets.js`: the real `llama-server --help` defaults for exactly the tool's
  field ids (plus the tool-side estimator factors, so `logic_memory.js` has no
  magic-number fallbacks). `""` = unset/auto. `LLD_UNSET` lists per-field
  "unset" spellings (maxTokens `0`/`-1`, seed `-1`, reasoningBudget `-1`).
- `roundToMultiple` / `clampBatch` — `ubatchSize` snaps to a multiple of 32 (min 32);
  `batchSize` must be an exact multiple of the current `ubatchSize` (min = ubatch).
  Clamping ubatch also re-clamps batch and updates the batch input's `min`/`step`
  attributes to track the ubatch value. Empty inputs resolve via the LLD table.
  Note `ncpuMoe` is a **count of experts** (not GB) and lives in the MoE Experts
  card of the memory panel (like `ctxSize` in the KV cache card), not in the Model
  panel; `genJson` clamps it to ≥ 0 (see gotchas).

**Memory estimation + distribution bars** (all in `logic_memory.js`, exposed as `window.MemEst`)
- `estName()` — the model name driving the estimate: the `--alias` value
  (`modelAlias` input) when set, else the filename (`modelPath`). All name-based
  reads below go through it.
- `quantBytesPerWeight(model)` — bytes/weight from the quant tag in the name
  (NVFP4/FP4, Q2–Q8, F16/BF16). Drives the scale-down of total size.
- `parseModel(name)` — extracts `{ totalB, activeB, isMoE }` from the name.
  `27B` → 27B dense; `A8B` → 8B-active MoE; `30B-A3B` → 30B total / 3B active.
- `estimateLayers`, `estimateEmbDim` — rough structural guesses from param count.
- `kvBytesFactor(cacheType)` — KV-cache size factor per cache type. Covers all
  `-ctk`/`-ctv` types (`f32`, `f16`, `bf16`, `q8_0`, `q4_0`, `q4_1`, `iq4_nl`,
  `q5_0`, `q5_1`); unknown values fall back to f16 (2 bytes).
- `computeEstimates()` — returns per-area `{ vram, ram }` in GB for the six model areas:
  `layers` (non-MoE / active params), `moe` (experts), `other` (leftover model tensors,
  e.g. per-layer ngram/embeddings), `ctx` (KV cache), `mtp` (MTP head), `img` (vision),
  plus the raw inputs (`totalGB`, `expertCount`, `expertSize`, `expertSized`,
  `cpuExperts` — `--cpu-moe` implies *all*) that bar tooltips and the card readouts
  use to explain where a number came from.
- **Expert geometry drives the MoE area:** `moeExperts` (total expert count) and
  `moeExpertGB` (size of ONE expert, GB) in the MoE Experts card. With **both** filled
  in, the experts area is exactly `n × size` (this is what makes `-ncpu-moe N` /
  `--cpu-moe` and the MoE slider costable), the `autoMoe` readout appends
  `· C on CPU (--ncpu-moe|--cpu-moe)` (or `· all on GPU`), and the leftover
  `totalGB − activeGB − n×size` becomes the **other** area (0 when the geometry is not
  filled in — with name-derived experts the subtraction would be 0 by construction).
  With either field empty/0 the experts area falls back to the name-derived
  `total − active` remainder. A positive expert count on a *dense* name (no `-AxB`
  tag) just adds the expert area on top — the tool cannot infer the active size.
- VRAM/RAM placement is now controlled by **per-area sliders** (`estLayersPct`,
  `estMoePct`, `estCtxPct`, 0–100 % to VRAM, default 100; **`estOtherPct` is the
  exception** — a three-stage −100…+100 scale, see *Three-stage placement* below):
  the slider splits the
  auto-estimated area size proportionally between VRAM and RAM. The MTP head is
  **always fully in VRAM** (no control) but only when a spec/draft type is selected
  (`specType` non-empty); with spec type "none" it takes **no space**. The
  image/vision layer is **all-or-nothing** via the `estImgLoc` select (`vram` /
  `ram`). The old `placeAreas()` (ngl/ncpu-moe based) and the `est*Vram`/`est*Ram`
  GB override boxes were removed; `-ngl` still only affects the generated command
  line, but the MoE expert placement **does** feed the bars: with the expert count
  known, `-ncpu-moe` and the MoE slider are synced and both drive the experts split —
  and through it the scratchpad (see the SCR formula below).
- **Fixed overhead segments on the VRAM bar:** OS/driver (`osOverhead` input,
  default 0.25 GB), scratchpad SCR = `scratchFactor × <params in VRAM>` where the
  param count is rebuilt from the VRAM side of the two weight areas —
  `(layers.vram + moe.vram) / bytesPerWeight` (`computeEstimates` returns the quant's
  bytes/weight as `bytesPerWeight`) — so streaming weights to RAM shrinks the
  scratchpad instead of leaving it at the full-model value (weights in RAM are never
  evaluated, so they need no compute buffer; a dense model fully offloaded gives the
  same number as the old `× totalB` form). Default factor 0.025 GB per B params.
  Only the two **weight** areas count — `other` (ngram/embedding tensors) is
  deliberately excluded — and the SCR tooltip shows both numbers
  (`0.025×7.6B in VRAM (of 27B)`). cuBLAS workspace (`cublasOverhead` input,
  default 0.35 GB),
  and compute buffers BUF = `(ubatchSize / 1024) × 0.25` GB — the **ubatch** is
  what actually lives on the GPU at once, so the VRAM buffer segment scales with
  `ubatchSize`. In addition, a **BATCH** segment = `(batchSize / 1024) × 0.25` GB
  is **always in RAM** (batch size only buffers work in system RAM, never VRAM).
  OS, cuBLAS and the
  scratchpad factor are **user-overridable** via the `osOverhead` /
  `cublasOverhead` / `scratchFactor` number inputs in the "Overheads & Factors"
  card (`getCap` falls back to the default when empty). The non-MoE layers
  segment is labeled **MODEL** on the bar (key `layers`). Below the KV cache
  slider, `ctxVramAmt` shows the context length **in tokens** that corresponds
  to the VRAM share of the KV cache at the current `estCtxPct` split (e.g.
  `→ 25,600 tokens in VRAM`) — so the user can reduce `ctxSize` to that number
  to make the KV cache fully fit in VRAM.
- **Three-stage placement for the `other` area (`threeWay()` in `updateMemBar`):**
  `estOtherPct` runs from **+100 (all VRAM)** through **0 (all RAM)** to **−100 (all
  on SSD)**: `vram = max(0,p)/100`, `ssd = max(0,−p)/100`, `ram = 1 − vram − ssd`. So
  offloading fills **RAM first and only then spills to disk** — a direct VRAM→SSD
  jump is impossible by construction. That is why its area carries a third destination
  (`{ vram, ram, ssd }`) while every other area stays `{ vram, ram }`: the totals loop
  adds `areas[k].ssd || 0`, `segGB()` defaults to `ssd: 0`, and the bar renderer
  ignores the extra key. `autoOther` spells the split (`12.4 GB · VRAM 60% / RAM 40%`)
  and `estOtherPctVal` the signed slider position (`+60%`, `−40%`).
- **SSD bar (third tier):** `#memBarSsd` + `#memSsdCap` live in `.mem-rows` under RAM,
  with a steel label chip (`.mem-row-label.ssd`). Its capacity is the
  **`sysSsdManual` input in the system panel** (“SSD reserved (GB)”,
  `getCap("sysSsdManual", 100)` — call-site fallback like the 16/64 GB VRAM/RAM ones,
  since it is not a server flag); disk size cannot be detected in a browser, so the
  value is typed and there is no “detected” line for it. The bar gets the identical
  treatment as the other two: area segments, a `free` headroom segment and the striped
  over-budget overlay with the `OVER` tag. `sysSsdManual` is in `FIELD_IDS` (saved with
  presets) and is emptied by `resetAll()` along with the other system inputs. Panel
  header: “Memory Distribution (VRAM / RAM / SSD)”.
- **Slider readouts go below the track, never beside it:** the four placement sliders'
  value elements (`estLayersPctVal`, `estMoePctVal`, `estOtherPctVal`, `estCtxPctVal`)
  are `<div class="slider-val">` lines *after* the slider row (`.mem-est .row label`
  is 34 px, so they indent 40 px to line up with the track) — beside the slider they
  stole width from it, and the slider must have the full card size (the old
  `.mem-est .row .unit` class is gone). Descriptive readouts may therefore be wordy
  (`36 of 48 experts in VRAM (75%)`, `+100%`). The sampling sliders (`temp`, `topP`, …)
  keep their
  value in the field's label line — that is above the track, not beside it, and costs
  the slider nothing.
- **UI convention — state under its own control, descriptions in tooltips:** *state*
  (the `auto*` estimate lines, `ctxVramAmt`) goes directly below the slider/control it
  belongs to; purely *descriptive* text goes into that control's
  `LLAMA_CPP_DESCRIPTIONS` tooltip — never as extra info rows stacked in a card and
  never as text after the whole slider grid. Removed on those grounds: the
  “model − layers − experts” size row and the `VRAM · RAM · SSD` hint row in the Other
  Layers card (both folded into the `estOtherPct` tooltip) and the MTP card's
  `Loc | VRAM (only when drafter active)` row (in the `specType` tooltip; the state
  itself is now stated by `autoMtp`: `0.8 GB · VRAM` / `0.0 GB · inactive`).
- **Layout inside the mem-est grid:** each area card now contains its related controls
  inline: `ngl` sits above the Model Layers slider; the MoE Experts card holds the
  expert geometry (`moeExperts` = n, `moeExpertGB` = size of one expert) above the
  `ncpuMoe` count, the `cpuMoe` checkbox and the MoE slider — the card carries
  `.eq-inputs`, which pins the hint column to a fixed 46 px so the three number fields
  are exactly the same (wider) width; the hints are one word each (`total` / `each` /
  `experts`) because the flag spellings live in the tooltips; the **Other Layers
  (ngram, embed)** card holds only the three-stage `estOtherPct` slider (label `loc`)
  plus its `autoOther` state line — the area size is derived (`model size − layers −
  experts`, stated in the tooltip), so it has no size input; it sits between the MoE and
  the KV card; `cacheK`/`cacheV` selects and the
  `noKvOffload` checkbox sit above the KV cache slider; the `specType` select sits in
  the MTP Head card (its `autoMtp` state line below) — it was moved out of the Speculative
  Decoding / MTP section of the Model panel so the spec choice is visible right next
  to where the MTP head is placed. The `noMmprojOffload` checkbox sits in the
  Image Layer (vision) card (below the Loc row). The `batchSize` / `ubatchSize` inputs sit at the
  top of the Overheads & Factors card. All of these were moved out of the
  Model & Server / Advanced panels so the user sees them in context. (The MTP Head
  card is the placement area for the MTP head: `specType` select, a Loc row showing
  it is always in VRAM when a spec type is active, and the `autoMtp` estimate.)
- **Area appearance is defined once, in the `AREAS` table at the top of
  `logic_memory.js`** (`short` = inline segment label, `cls` = CSS class,
  `legend` = legend label). The same `cls` is used for the bar segment
  (`.mem-seg.<cls>`) and the legend swatch (swatch elements carry the
  `mem-seg <cls>` classes), so each area color is defined exactly once in
  `style.css`. Colors are **per-area, not per-destination**: an area looks
  the same in the VRAM and RAM bars (MODEL=blue, MOE=green, KV=cyan,
  Drafter/mtp=orange, OTHER=steel grey, IMG=pink). The legend is **generated** by
  `MemEst.buildLegend()` (called once from `init()` in `logic.js`) into
  `#memLegend` — the HTML contains no per-area legend markup, and there are
  no separate `.mem-legend .swatch.<area>` color rules. There is **no separate
  legend order**: the `BAR_ORDER` array in `logic_memory.js` is the single
  order shared by the VRAM bar, the RAM bar, and the legend (OS, Scratch,
  cuBLAS, UBatch, Model, MoE, Other, KV, Drafter, IMG, Batch). Bar tooltips use the
  `legend` text (not the raw key or `short` label) followed by an "in VRAM" /
  "in RAM" postfix and the GB amount (e.g. "Model in VRAM: 12.3 GB").
- **`noKvOffload` interaction:** when `--no-kv-offload` is checked, the KV cache is
  forced to 100 % RAM (0 % VRAM) regardless of `estCtxPct`, and the `estCtxPct` slider
  is disabled (greyed out, snapped to 0 %). Unchecking `noKvOffload` re-enables the
  slider (it retains its last value, which was forced to 0 while checked).
- **`noMmprojOffload` interaction:** when `--no-mmproj-offload` is checked (checkbox in
  the Image Layer (vision) card), the image/mmproj area is forced to 100 % RAM
  (0 % VRAM) regardless of `estImgLoc`, and the `estImgLoc` select is disabled
  (greyed out, snapped to `ram`). Unchecking `noMmprojOffload` re-enables the select.
- `updateMemBar()` — renders **two separate bars stacked vertically**: `memBarVram`
  `memBarVram` above `memBarRam`, each scaled to its own capacity, each with
  a trailing headroom segment and an OVER warning in its used/cap readout
  (`memVramCap` / `memRamCap`, e.g. `VRAM: 12.3 / 24 GB`). When a bar exceeds
  its capacity, the over-budget portion (from the cap mark to the end of the
  used region) gets a striped red overlay (`.mem-seg.over`, absolutely
  positioned inside the bar). Also renders
  the model badge, the auto-estimate labels (total size per area) and the slider %
  readouts (`est*PctVal`).

**System detection**
- `detectSystem()` — WebGL-only GPU name lookup (display only, **not overridable**).
  VRAM/architecture are not exposed by the browser, so the panel shows manual input
  boxes (`sysVramManual`, `sysRamManual`, etc.) that the memory bars read via `getCap`.
  WebGPU was removed.

**Preset apply / save / load** (logic.js)
- `FIELD_IDS` — list of every persisted field id.
- `collectState` / `applyPresetState` — snapshot / restore all fields
  (`applyPresetState` does **not** call `updateOutput`; callers do).
- `savePreset` / `loadPresetFile` — download / read a `.json` preset via file selection.
- `applyPreset(name)` — built-in presets (default / **llamacpp_defaults** / myconfig /
  chat / fast / quality / embed); `myconfig` only shows a toast (presets load via file),
  `default` applies the full default preset like Reset does (system-detection inputs
  keep their values). Applying `llamacpp_defaults` sets `lldMode = "lld"` (watermarks on).
- `applyLldDescriptions()` — applies `window.LLAMA_CPP_DESCRIPTIONS` (presets.js, same
  keys as the presets; tool-only fields prefixed `tool:`) as `title` tooltips on every
  control, appending `— default: <LLD value>` (checkboxes: `— default (checked):
  <bool>`) only when the description does not already state a default. Runs
  once from `init()`; it **overwrites** any hand-written `title` in the HTML, which is
  why `configtool.html` now carries no `title` attributes on tracked fields (single
  source of truth). Controls without a map entry keep theirs.
- `updateLldHints(mode)` — placeholder (watermark) switching, values untouched. In
  `"lld" mode"` every LLD-tracked text/number input shows its llama.cpp default as
  placeholder (empty defaults get spellings from `LLD_WATERMARKS`, e.g. `"loaded from
  model"`, `"inf (-1)"`); in `"tool" mode` the stock placeholders (captured once by
  `capturePlaceholders()` in `init()`) are restored. Checkboxes, selects and sliders are
  skipped — selects cannot show a watermark, so they keep their default option selected
  and the HTML lists the default **first** (loadMode `auto`, cacheK/V `f16`, estImgLoc
  VRAM, lazyMode `auto`); sliders carry numeric values (readouts resolve empty → LLD).
- `resetAll` / `clearAll` — restore the default preset / wipe everything.
- `globalPresets()` — grabs `window.CONFIG_PRESETS`, toasts an error if `presets.js`
  failed to load (tool then runs with bare, empty controls).
- `lazyGate()` — disables `lazyMode` and snaps it to `off` unless
  `loadMode === "mmap"`.
- `syncGates()` — re-syncs **all** dependent controls after a bulk state change
  (`init`, `resetAll`, `clearAll`, `applyPreset`, `loadPresetFile`): `lazyGate()`,
  `moeSync("gate")` (rebases the MoE slider, mirrors `ncpuMoe`, then `cpuMoeReflect()`),
  plus the `estCtxPct` slider (disable + snap to 0 when `noKvOffload`) and `estImgLoc`
  select (disable + snap to `ram` when `noMmprojOffload`) — checkbox change handlers
  don't fire programmatically, so presets must re-apply the gates themselves.

**Misc**
- `updateOutput()` — refresh val-displays, regenerate the active tab, redraw the memory bars.
- `copyOutput` / `fallbackCopy` / `showToast` — clipboard + toast.
- `downloadConfig` / `downloadText` / `switchTab` — output download + tab switching.
- `bindEvents` / `init` — wire up listeners; `init` runs on DOM ready.

## Conventions / gotchas

- `file://` still works for everything except browser clipboard (falls back to `execCommand`).
- The memory estimates are **order-of-magnitude** heuristics, not exact. Don't treat
  `computeEstimates` numbers as precise. Placement (VRAM vs RAM) is user-controlled via
  the per-area sliders; KV-cache size assumes GQA (~512-dim KV state per layer) and a
  ~40-layer / `sqrt(totalB/(12·40))` hidden-dim guess.
- `parseModel` uses a lookbehind regex (`(?<![A0-9.])`), which needs a modern browser.
- The VRAM and RAM bars are independent: each is scaled to its own capacity (not a shared
  scale), so a bar that is full always spans the full width.
- Adding a new field that affects the command line: update `buildArgs()` **and**
  `LLAMA_CPP_DEFAULTS` in `presets.js` (its real `--help` default, `""` if unset/auto —
  this drives both omission and the watermark) **and** `FIELD_IDS` (so it round-trips in
  presets). If its default is spelled differently in the tool (e.g. `0` vs `-1`), add a
  `LLAMA_CPP_DEFAULT_UNSET` entry.
- **No magic-number fallbacks:** defaults live only in `LLAMA_CPP_DEFAULTS`. UI reads
  resolve through `isAtLld`/`numR` (logic.js) or `getCap`/`gvNum` (logic_memory.js),
  which fall back to the table when the field is empty. The VRAM/RAM capacity guesses
  (`sysVramManual` 16 / `sysRamManual` 64) are detection fallbacks, not defaults, and
  stay at their call sites.
- **`lazyMode`** (`--lazy-mode`, select `auto`/`on`/`off`, default `off` → omitted) sits
  next to `loadMode` in the Model & Server panel; on-demand reading of large tensors
  (e.g. per-layer token embeddings). **`lazyMode` is gated on `loadMode === "mmap"`**
  (it requires mmap) via `lazyGate()` — disabled + snapped to `off` otherwise — and
  `buildArgs` only emits `--lazy-mode` when the load mode is mmap. Same disable/snap
  pattern as `noKvOffload` → `estCtxPct`. **`overrideTensor`**
  (`--override-tensor <pattern>=<buffer type>,...`, free text, default empty → omitted)
  sits below `tensorSplit`; e.g. `per_layer_token_embd=CPU` offloads the ngram/embedding
  tensors to CPU. Both flow into the JSON config via `extra_args` like the other flags.
- **`ncpuMoe` is clamped to ≥ 0 at every use site** (`buildArgs`, `genJson`):
  the input has `min="0"` but users can still type negative values, and `num()` returns
  them raw. Never read `num("ncpuMoe")` without clamping (`moeSync` additionally
  clamps it to `0…moeExperts`). It no longer drives `--cpu-moe` — a positive count
  emits `--ncpu-moe N`, and `--cpu-moe` comes from the `cpuMoe` checkbox (never both).
- **Expert count known ⇒ slider ⇄ `ncpuMoe` sync (`moeSync(from)` in logic.js):**
  as soon as `moeExperts > 0`, the MoE slider is re-based to `0…n, step 1` and
  **reads as the number of experts in VRAM** (`gpu = n − cpu`), because experts are
  discrete and a % scale cannot express "12 of 48"; `estMoePctVal` shows
  `36 of 48 experts in VRAM (75%)` instead of a percent, and the `autoMoe` line below
  states the size and what the CPU share costs (`11.5 GB · 12 on CPU (--ncpu-moe)`).
  **Three controls, one state.** Each pass has exactly one source and rewrites the
  others (counts clamped to `0…n`), so they can never disagree:

  | `from` | source | effect |
  |---|---|---|
  | `"slider"` | slider position | `cpu = n − gpu`, count rewritten |
  | `"ncpuMoe"` / `"experts"` / `"gate"` | count field | slider rebases to `n − cpu` |
  | `"cpuMoe"` | the switch | on ⇒ `cpu = n` (slider to its minimum); off ⇒ `cpu = n − 1` (one expert back on the GPU, else the box would snap straight back on) |

  Clearing `moeExperts` converts the position back to the nearest 5 % and restores
  `min/max/step = 0/100/5`; `ncpuMoe` is then simply left alone (no total to divide by,
  so it cannot be mirrored in the slider — it still emits `-ncpu-moe N` on the command
  line), i.e. **nothing in the card is ever disabled**. `MemEst.moeVramShare()` reads the
  same convention (`value / n` when the count is known) — **keep the two in step**.
  `bindEvents` calls `moeSync` for `estMoePct`, `cpuMoe`, `ncpuMoe` and `moeExperts`;
  `syncGates` calls it with `"gate"` so presets rebase the slider.
- **`cpuMoeReflect()` — the `--cpu-moe` box is never disabled:** it is free to toggle
  in every state and is kept equal to *"everything is on the CPU"* — slider at its
  minimum (0 experts in VRAM, or 0 % while the count is unknown; unchecking there nudges
  one slider step, 5 %, to make the switch actually come off). Old `cpuMoeGate()`
  disabled/forced it, which made it feel dead — do not reintroduce that. The box only
  ever *sets* the placement (slider → minimum), it is never the thing being clamped;
  `CmdGen.buildArgs` still reads only the checkbox.
- **`noKvOffload` gates `estCtxPct`:** checking `--no-kv-offload` disables the
  `estCtxPct` slider and forces the KV split to 100 % RAM (0 % VRAM) in
  `updateMemBar()`. The event handler in `bindEvents` toggles `estCtxPct.disabled`
  and snaps it to 0; `resetAll()` re-enables it. If you add a new flag that
  constrains a slider, follow the same pattern (disable in the input handler,
  re-enable in `resetAll`).
- **`noMmprojOffload` gates `estImgLoc`:** checking `--no-mmproj-offload` disables the
  `estImgLoc` select and forces the image/mmproj area to 100 % RAM (0 % VRAM) in
  `updateMemBar()`. The event handler in `bindEvents` toggles `estImgLoc.disabled`
  and snaps it to `ram`; `resetAll()` re-enables it. Same pattern as `noKvOffload`.
- **String/number precedence trap:** the VRAM readout is built as
  `"VRAM: " + vramUsed.toFixed(1) + " / " + vramCap + " GB"`. A stray `/ 1` after the
  `toFixed(1)` used to make the whole expression `"VRAM: X" / 1` → `NaN`. Keep the
  readout strings in separate concatenations; don't divide a partially-built string.
