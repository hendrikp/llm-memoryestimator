# configtool — llama.cpp Memory Distribution Estimator

A single-page tool whose **main purpose** is a rough VRAM/RAM memory-usage estimator with **two stacked distribution bars** (VRAM on top, RAM below).

## Usage

Static site — no build step, no dependencies. Just open `configtool.html` in a browser.

## Features

- **Memory estimator** — order-of-magnitude VRAM/RAM breakdown per area (model layers, MoE experts, KV cache, MTP head, vision layer) with per-area VRAM/RAM split sliders and fixed overhead segments (OS, scratchpad, cuBLAS, ubatch/batch buffers). Estimates are heuristics, not exact.
- **Launch-script builder** — generates `llama-server` commands for Windows batch, PowerShell, Bash, or JSON, with defaults omitted to keep output clean.
- **Presets** — built-in presets plus save/load your own as `.json`.
- **System detection** — WebGL-based GPU name lookup (display only); VRAM/RAM capacity via manual inputs.
