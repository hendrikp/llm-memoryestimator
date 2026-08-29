# configtool — llama.cpp Server Config Generator

A single-page HTML tool that builds `llama-server` launch scripts (.bat / .ps1 / .sh / JSON)
from a form, plus a rough VRAM/RAM memory-usage estimator with **two stacked distribution
bars** (VRAM on top, RAM below).

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
| `configtool.html` | Markup only. All form fields, the system panel, the memory panel, the output tabs. Links `style.css`, loads `logic_memory.js` then `logic.js` (order matters — `logic.js` calls `MemEst.*`). |
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
- `DEFAULTS` — map of field id → default value. A field equal to its default is
  **omitted** from the command line (keeps output clean).
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
- `kvBytesFactor(cacheType)` — KV-cache size factor per cache type.
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
  `noKvOffload` checkbox sit above the KV cache slider. These were moved out of the
  Model & Server / Advanced panels so the user sees them in context.
- **`noKvOffload` interaction:** when `--no-kv-offload` is checked, the KV cache is
  forced to 100 % RAM (0 % VRAM) regardless of `estCtxPct`, and the `estCtxPct` slider
  is disabled (greyed out, snapped to 0 %). Unchecking `noKvOffload` re-enables the
  slider (it retains its last value, which was forced to 0 while checked).
- `updateMemBar()` — renders **two separate bars stacked vertically**: `memBarVram`
  (VRAM=blue) above `memBarRam` (RAM=green), each scaled to its own capacity, each with
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
- `collectState` / `applyState` — snapshot / restore all fields.
- `savePreset` / `loadPresetFile` — download / read a `.json` preset via file selection.
- `applyPreset(name)` — built-in presets (myconfig / chat / fast / quality / embed).
- `resetAll` / `clearAll` — restore defaults / wipe everything.

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
- **`ncpuMoe` is clamped to ≥ 0 at every use site** (`buildArgs`, `genJson`):
  the input has `min="0"` but users can still type negative values, and `num()` returns
  them raw. Never read `num("ncpuMoe")` without clamping.
- **`noKvOffload` gates `estCtxPct`:** checking `--no-kv-offload` disables the
  `estCtxPct` slider and forces the KV split to 100 % RAM (0 % VRAM) in
  `updateMemBar()`. The event handler in `bindEvents` toggles `estCtxPct.disabled`
  and snaps it to 0; `resetAll()` re-enables it. If you add a new flag that
  constrains a slider, follow the same pattern (disable in the input handler,
  re-enable in `resetAll`).
- **String/number precedence trap:** the VRAM readout is built as
  `"VRAM: " + vramUsed.toFixed(1) + " / " + vramCap + " GB"`. A stray `/ 1` after the
  `toFixed(1)` used to make the whole expression `"VRAM: X" / 1` → `NaN`. Keep the
  readout strings in separate concatenations; don't divide a partially-built string.
