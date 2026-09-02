// ----------------------------------------------------------------------
// Command-line generation — the single place that knows how to turn form
// state into llama-server arguments and how to render them per script
// style. Exposed as window.CmdGen (buildArgs / genBat / genPs1 / genSh /
// genJson); logic.js only calls these from updateOutput(). Loaded after
// presets.js (reads window.LLAMA_CPP_DEFAULTS / _UNSET), before logic.js.
//
// Rules:
//  - Long flag spellings only (--threads, never -t).
//  - Emission order follows the reference cmd line: model/alias, bind
//    addr, sampling, jinja/reasoning, slots, threads, context & offload,
//    cache types, load mode, overrides, batch, extras, speculative.
//  - One option per line in the generated scripts — a flag and its value
//    always share a line (bat uses " ^", ps1 "`", sh "\" continuations).
//  - Omission: a tunable option is emitted only when it holds a value
//    that differs from LLAMA_CPP_DEFAULTS (empty counts as at-default;
//    LLAMA_CPP_DEFAULT_UNSET lists per-field "unset" spellings).
//  - Quoting: pair values are quoted with the style's quote char (" for
//    bat/ps1, ' for sh) when they contain whitespace — never nested. The
//    binary path is always quoted (e.g. "%~dp0\llama-server.exe"). Raw
//    token strings (free text like extraArgs) are emitted verbatim.
// ----------------------------------------------------------------------
(function (global) {
    "use strict";

    function gv(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
    function ck(id) { var e = document.getElementById(id); return e ? e.checked : false; }
    function num(id) { var v = parseFloat(gv(id)); return isNaN(v) ? null : v; }

    var LLD = global.LLAMA_CPP_DEFAULTS || {};
    var LLD_UNSET = global.LLAMA_CPP_DEFAULT_UNSET || {};

    function lld(id) { return LLD[id]; }

    // Numeric value of a field, resolved to the llama.cpp default when
    // empty. Non-numeric defaults ("", "auto", booleans) → null.
    function numR(id) {
        var v = parseFloat(gv(id));
        if (isNaN(v)) {
            var d = parseFloat(lld(id));
            if (isNaN(d)) return null;
            v = d;
        }
        return v;
    }

    // Numeric-aware equality ("1.0" === "1", "0.80" === "0.8").
    function sameVal(a, b) {
        if (a === b) return true;
        var x = parseFloat(a), y = parseFloat(b);
        return !isNaN(x) && !isNaN(y) && x === y;
    }

    // True when the field carries a value meaning "unset, server default
    // applies": empty, or one of LLAMA_CPP_DEFAULT_UNSET's spellings (e.g.
    // maxTokens "0"/"-1"). Such fields never produce a switch.
    function isUnset(id) {
        var v = gv(id);
        if (v === "") return true;
        var alts = LLD_UNSET[id];
        if (alts) {
            for (var i = 0; i < alts.length; i++) if (sameVal(v, alts[i])) return true;
        }
        return false;
    }

    // Omission check: emit a tunable option only when it holds a set value
    // that is NOT at the llama.cpp default. Empty counts as at-default
    // (watermark-only state in the form).
    function isAtLld(id) {
        if (isUnset(id)) return true;
        var d = lld(id);
        return d !== undefined && d !== "" && sameVal(gv(id), String(d));
    }

    // Quote a cmd-line token with the style's quote char when it contains
    // whitespace, escaping inner quotes. A token that already contains a
    // double quote (user-typed batch/PowerShell syntax like
    // KEY="a b" in extra args) is wrapped in single quotes instead — the
    // style char is never nested.
    function q(v, qch) {
        var s = String(v == null ? "" : v);
        var re = new RegExp(qch, "g");
        if (/\s/.test(s)) return qch + s.replace(re, "\\" + qch) + qch;
        if (/"\S/.test(s)) return "'" + s + "'";
        return s;
    }

    // An argument entry is a string (raw token, emitted verbatim) or an
    // [flag, value] pair (rendered on one line, value quoted by q()).
    function arg(flag, value) { return [flag, value]; }

    // ------------------------------------------------------------------
    // The ordered argument list + env lines + chat kwargs — single source
    // of truth for what gets emitted (see file header for the rules).
    // ------------------------------------------------------------------
    function buildArgs() {
        var args = [];
        var envLines = gv("envVars") ? gv("envVars").split("\n").filter(function(l) { return l.trim(); }) : [];

        // Model & alias (alias also drives the memory estimate).
        if (gv("modelPath")) args.push(arg("--model", gv("modelPath")));
        if (gv("modelAlias")) args.push(arg("--alias", gv("modelAlias")));

        // Bind address — emitted whenever set (per-machine, not omittable).
        if (gv("host")) args.push(arg("--host", gv("host")));
        if (gv("port")) args.push(arg("--port", gv("port")));

        // Sampling.
        if (!isAtLld("temp")) args.push(arg("--temperature", gv("temp")));
        if (!isAtLld("topP")) args.push(arg("--top-p", gv("topP")));
        if (!isAtLld("topK")) args.push(arg("--top-k", gv("topK")));
        if (!isAtLld("minP")) args.push(arg("--min-p", gv("minP")));
        if (!isAtLld("presPen")) args.push(arg("--presence-penalty", gv("presPen")));
        if (!isAtLld("repPen")) args.push(arg("--repeat-penalty", gv("repPen")));
        if (!isAtLld("freqPen")) args.push(arg("--frequency-penalty", gv("freqPen")));
        if (!isAtLld("repLastN")) args.push(arg("--repeat-last-n", gv("repLastN")));
        if (!isAtLld("maxTokens")) args.push(arg("--n-predict", gv("maxTokens")));
        if (!isAtLld("seed")) args.push(arg("--seed", gv("seed")));

        // Chat template & reasoning.
        if (ck("jinja")) args.push("--jinja");
        if (ck("reasoningPreserve")) args.push("--reasoning-preserve");
        if (!isAtLld("reasoningBudget")) args.push(arg("--reasoning-budget", gv("reasoningBudget")));

        // Slots & threads.
        if (!isAtLld("parallel")) args.push(arg("--parallel", gv("parallel")));
        if (!isAtLld("threads")) args.push(arg("--threads", gv("threads")));

        // Context, offload & caches (reference order).
        if (!isAtLld("ctxSize")) args.push(arg("--ctx-size", gv("ctxSize")));
        if (!isAtLld("ngl")) args.push(arg("--n-gpu-layers", gv("ngl")));
        var ncpuMoe = Math.max(0, num("ncpuMoe") || 0);
        if (ncpuMoe > 0) args.push("--cpu-moe");
        if (ck("flashAttn")) args.push(arg("--flash-attn", "on"));
        if (!isAtLld("cacheK")) args.push(arg("--cache-type-k", gv("cacheK")));
        if (!isAtLld("cacheV")) args.push(arg("--cache-type-v", gv("cacheV")));
        if (!isAtLld("loadMode")) args.push(arg("--load-mode", gv("loadMode")));
        if (gv("loadMode") === "mmap" && !isAtLld("lazyMode")) args.push(arg("--lazy-mode", gv("lazyMode")));
        if (gv("tensorSplit")) args.push(arg("--tensor-split", gv("tensorSplit")));
        if (gv("overrideTensor")) args.push(arg("--override-tensor", gv("overrideTensor")));
        if (!isAtLld("batchSize")) args.push(arg("--batch-size", gv("batchSize")));
        if (!isAtLld("ubatchSize")) args.push(arg("--ubatch-size", gv("ubatchSize")));

        // Remaining opt-in switches (checked = non-default behaviour).
        if (!isAtLld("mainGpu")) args.push(arg("--main-gpu", gv("mainGpu")));
        if (ck("noKvOffload")) args.push("--no-kv-offload");
        if (ck("noMmprojOffload")) args.push("--no-mmproj-offload");
        if (ck("promptCache")) args.push(arg("--prompt-cache", gv("promptCachePath") || "cache.bin"));
        if (ck("verbose")) args.push("--verbose");
        if (gv("loraPath")) args.push(arg("--lora", gv("loraPath")));
        if (gv("grammarFile")) args.push(arg("--grammar-file", gv("grammarFile")));

        // Speculative decoding (current help: --spec-type / --spec-draft-*;
        // --draft, --draft-n-max, --draft-p-min are removed upstream).
        if (!isAtLld("specType")) args.push(arg("--spec-type", gv("specType")));
        if (gv("draftModel")) args.push(arg("--model-draft", gv("draftModel")));
        if (!isAtLld("specDraftNMax")) args.push(arg("--spec-draft-n-max", gv("specDraftNMax")));
        if (!isAtLld("specDraftPMin")) args.push(arg("--spec-draft-p-min", gv("specDraftPMin")));
        if (gv("specTypeK")) args.push(arg("--spec-draft-type-k", gv("specTypeK")));
        if (gv("specTypeV")) args.push(arg("--spec-draft-type-v", gv("specTypeV")));

        // Free-text extras (raw tokens, emitted verbatim).
        if (gv("extraArgs")) args.push(gv("extraArgs"));

        var kwargs = [];
        if (gv("chatKwargs")) kwargs.push(gv("chatKwargs"));

        return { args: args, envLines: envLines, kwargs: kwargs };
    }

    // ------------------------------------------------------------------
    // Renderers — one option per line, flag and value together. `qch` is
    // the style's quote char, `joiner` the line continuation (kept
    // compatible with each file's newline style), `cont` an optional
    // trailing continuation.
    // ------------------------------------------------------------------
    function renderCmd(binary, args, kwargs, qch, joiner, cont) {
        // One entry per option: "--flag value" (value quoted) or, for raw
        // token strings, the text verbatim.
        var toks = [];
        args.forEach(function(a) {
            if (Array.isArray(a)) toks.push((a[1] == null || a[1] === "") ? a[0] : a[0] + " " + q(a[1], qch));
            else toks.push(a);
        });
        if (kwargs.length) toks.push("--chat-template-kwargs " + q(kwargs.join(" "), qch));
        var head = toks.length ? q(binary, qch) + " " + toks[0] : q(binary, qch);
        var rest = toks.slice(1).map(function(t) { return "  " + t; });
        // Trailing continuation only when more lines actually follow.
        return [head].concat(rest).join(joiner) + (rest.length && cont ? cont : "");
    }

    function genBat(binary, args, envLines, kwargs) {
        var lines = ["@echo off", "REM generated by configtool — " + new Date().toISOString().slice(0, 10), ""];
        envLines.forEach(function(l) { lines.push("set " + l); });
        if (envLines.length) lines.push("");
        lines.push(renderCmd(binary, args, kwargs, '"', " ^\r\n", ""));
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
        lines.push("& " + renderCmd(binary, args, kwargs, '"', " `\n", ""));
        return lines.join("\r\n");
    }

    function genSh(binary, args, envLines, kwargs) {
        var lines = ["#!/usr/bin/env bash", "# generated by configtool — " + new Date().toISOString().slice(0, 10), "set -euo pipefail", ""];
        envLines.forEach(function(l) { lines.push("export " + l); });
        if (envLines.length) lines.push("");
        lines.push(renderCmd(binary, args, kwargs, "'", " \\\n", "\\"));
        lines.push("");
        lines.push("# chmod +x run-server.sh && ./run-server.sh");
        return lines.join("\n");
    }

    function genJson(binary, args, envLines, kwargs) {
        // Values resolve through the llama.cpp defaults table when empty
        // (no hardcoded fallbacks here).
        var lldN = function(id) { var v = numR(id); return v === null ? null : (v % 1 === 0 ? parseInt(v, 10) : v); };
        var maxTok = isUnset("maxTokens") ? null : lldN("maxTokens");
        var cfg = {
            binary: binary,
            model: gv("modelPath") || null,
            alias: gv("modelAlias") || null,
            context: lldN("ctxSize"),
            gpu_layers: gv("ngl") || null,
            ncpu_moe_experts: Math.max(0, num("ncpuMoe") || 0),
            threads: lldN("threads"),
            server: {
                host: gv("host") || null,
                port: lldN("port"),
                parallel: lldN("parallel")
            },
            sampling: {
                temperature: numR("temp"),
                top_p: numR("topP"),
                top_k: lldN("topK"),
                min_p: numR("minP"),
                presence_penalty: numR("presPen"),
                repeat_penalty: numR("repPen"),
                frequency_penalty: numR("freqPen"),
                repeat_last_n: lldN("repLastN"),
                max_tokens: maxTok,
                seed: isUnset("seed") ? null : lldN("seed")
            },
            env: envLines,
            extra_args: args.filter(function(a) { return typeof a === "string"; })
        };
        if (kwargs.length) cfg.chat_template_kwargs = kwargs[0];
        return JSON.stringify(cfg, null, 2);
    }

    global.CmdGen = {
        buildArgs: buildArgs,
        genBat: genBat,
        genPs1: genPs1,
        genSh: genSh,
        genJson: genJson
    };
})(window);
