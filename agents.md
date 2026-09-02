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
| `configtool.html` | Markup only. All form fields (bare — no `value`/``checked`/`selected` attributes), the system panel, the memory panel, the output tabs. Links `style.css`, loads `logic_memory.js`, then `presets.js`, then `logic.js` (order matters — `logic.js` calls `MemEst.*` and reads `window.CONFIG_PRESETS`). |
| `presets.js` | `window.CONFIG_PRESETS`: the **default preset** (`"default"`, full state) plus the built-in partial presets (`chat` / `fast` / `quality` / `embed`). All selectable from the Apply-preset dropdown ("default" included). Kept as `.js` (not fetched `.json`) because `file://` fetches are blocked; downloading a preset gives you the same JSON. |
| `style.css` | All styling. CSS variables live in `:root`. Memory-bar classes are prefixed `mem-*`, system-panel `sys-*`. |
| `logic_memory.js` | Memory size estimation + VRAM/RAM bar rendering, wrapped in an IIFE. Exposes `window.MemEst` (`updateMemBar`, `computeEstimates`, `parseModel`, `getCap`). Owns its own `gv`/`ck`/`el` DOM helpers. |
| `logic.js` | All other behavior, wrapped in an IIFE. See function map below. Calls `MemEst.updateMemBar()` from `updateOutput()`. |

## How the pieces connect

- Every form control has a stable `id`. JS reads/writes **only** by id (helpers `gv`, `ck`, `el`).
  When adding a field: add the `id` in `configtool.html`, then register it in `logic.js`
  (`DEFAULTS`, `FIELD_IDS`, `resetAll`, `clearAll`, and `buildArgs` where it affects output).
- Any `input`/`change` on a form control fires `updateOutput()`, which regenerates the
  active tab's script **and** re-renders the memory bars via `MemEst.updateMemBar()`. That
  is the single refresh path.
- `currentTab` selects which generator runs (`bat` / `ps1` / `sh` / `json`).

## Main functions (logic.js)

**Argument building**
- `PRESETS` / `DEFAULT_PRESET` — read from `window.CONFIG_PRESETS` (defined in
  **`presets.js`**). `"default"` is the full-state **default preset**: `init()` applies it
  on startup, `resetAll()` restores it, it is selectable in the Apply-preset dropdown,
  and "Save preset" writes exactly this shape. `configtool.html` carries **no**
  `value`/`checked`/`selected` attributes — controls only get values from presets.
- `DEFAULTS` — derived from `DEFAULT_PRESET` (`JSON.parse(JSON.stringify(...))`). A field
  equal to its default is **omitted** from the command line (keeps output clean).
  Exception: `--host`/`--port` are emitted whenever non-empty (they are per-machine
  bind addresses, not omittable tuning params).
- `isDefault(id)` — compares current value against `DEFAULTS`.
- `buildArgs()` — assembles the ordered arg list + env lines + chat kwargs. This is the
  single source of truth for what gets emitted.
- `roundToMultiple` / `clampBatch` — `ubatchSize` snaps to a multiple of 32 (min 32);
  `batchSize` must be an exact multiple of the current `ubatchSize` (min = ubatch).
  Clamping ubatch also re-clamps batch and updates the batch input's `min`/`step`
  attributes to track the ubatch value.

**Script generators** (each returns the full text for the active tab)
- `genBat`, `genPs1`, `genSh`, `genJson` — format `buildArgs()` output. Python was removed.
  `genJson` clamps `ncpu_moe_experts` to ≥ 0 (see gotchas). Note `ncpuMoe`
  is a **count of experts** (not GB) and lives in the MoE Experts card of the
  memory panel (like `ctxSize` in the KV cache card), not in the Model panel.

**Memory estimation + distribution bars** (all in `logic_memory.js`, exposed as `window.MemEst`)
- `quantBytesPerWeight(model)` — bytes/weight from the quant tag in the filename
  (NVFP4/FP4, Q2–Q8, F16/BF16). Drives the scale-down of total size.
- `parseModel(name)` — extracts `{ totalB, activeB, isMoE }` from the filename.
  `27B` → 27B dense; `A8B` → 8B-active MoE; `30B-A3B` → 30B total / 3B active.
- `estimateLayers`, `estimateEmbDim` — rough structural guesses from param count.
- `kvBytesFactor(cacheType)` — KV-cache size factor per cache type. Covers all
  `-ctk`/`-ctv` types (`f32`, `f16`, `bf16`, `q8_0`, `q4_0`, `q4_1`, `iq4_nl`,
  `q5_0`, `q5_1`); unknown values fall back to f16 (2 bytes).
- `computeEstimates()` — returns per-area `{ vram, ram }` in GB for the five areas:
  `layers` (non-MoE), `moe` (experts), `ctx` (KV cache), `mtp` (MTP head), `img` (vision).
- VRAM/RAM placement is now controlled by **per-area sliders** (`estLayersPct`,
  `estMoePct`, `estCtxPct`, 0–100 % to VRAM, default 100): the slider splits the
  auto-estimated area size proportionally between VRAM and RAM. The MTP head is
  **always fully in VRAM** (no control) but only when a spec/draft type is selected
  (`specType` non-empty); with spec type "none" it takes **no space**. The
  image/vision layer is **all-or-nothing** via the `estImgLoc` select (`vram` /
  `ram`). The old `placeAreas()` (ngl/ncpu-moe based) and the `est*Vram`/`est*Ram`
  GB override boxes were removed; `-ngl`/`-ncpu-moe` still affect the generated
  command line but no longer the memory bars.
- **Fixed overhead segments on the VRAM bar:** OS/driver (`osOverhead` input,
  default 0.25 GB), scratchpad SCR = `scratchFactor × totalB` (default factor
  0.025 GB per PB), cuBLAS workspace (`cublasOverhead` input, default 0.35 GB),
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
- **Layout inside the mem-est grid:** each area card now contains its related controls
  inline: `ngl` sits above the Model Layers slider; `cacheK`/`cacheV` selects and the
  `noKvOffload` checkbox sit above the KV cache slider; the `specType` select sits in
  the MTP Head card (above the Loc row) — it was moved out of the Speculative
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
  Drafter/mtp=orange, IMG=pink). The legend is **generated** by
  `MemEst.buildLegend()` (called once from `init()` in `logic.js`) into
  `#memLegend` — the HTML contains no per-area legend markup, and there are
  no separate `.mem-legend .swatch.<area>` color rules. There is **no separate
  legend order**: the `BAR_ORDER` array in `logic_memory.js` is the single
  order shared by the VRAM bar, the RAM bar, and the legend (OS, Scratch,
  cuBLAS, UBatch, Model, MoE, KV, Drafter, IMG, Batch). Bar tooltips use the
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

**Presets**
- `FIELD_IDS` — list of every persisted field id.
- `collectState` / `applyPresetState` — snapshot / restore all fields
  (`applyPresetState` does **not** call `updateOutput`; callers do).
- `savePreset` / `loadPresetFile` — download / read a `.json` preset via file selection.
- `applyPreset(name)` — built-in presets (default / myconfig / chat / fast / quality /
  embed); `myconfig` only shows a toast (presets load via file), `default` applies the
  full default preset like Reset does (system-detection inputs keep their values).
- `resetAll` / `clearAll` — restore the default preset / wipe everything.
- `globalPresets()` — grabs `window.CONFIG_PRESETS`, toasts an error if `presets.js`
  failed to load (tool then runs with bare, empty controls).
- `lazyGate()` — disables `lazyMode` and snaps it to `off` unless
  `loadMode === "mmap"`.
- `syncGates()` — re-syncs **all** dependent controls after a bulk state change
  (`init`, `resetAll`, `clearAll`, `applyPreset`, `loadPresetFile`): `lazyGate()` plus
  the `estCtxPct` slider (disable + snap to 0 when `noKvOffload`) and `estImgLoc`
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
- Adding a new field that affects the command line: update `buildArgs()` **and** `DEFAULTS`
  (so it's omitted when at default) **and** `FIELD_IDS` (so it round-trips in presets).
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
  them raw. Never read `num("ncpuMoe")` without clamping.
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
