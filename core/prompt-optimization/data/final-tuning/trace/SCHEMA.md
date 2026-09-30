# r282 trace schema (final tuning, 2026-10-01)

One normaliser per harness writes one file per cell:
`core/prompt-optimization/data/results/final-tuning-trace/<cell>.trace.jsonl` in the worktree
`/Users/admin/Projects/sweet-search-final-tuning` (gitignored folder; the scripts are committed).

Sources are read-only:
- rows: `/Users/admin/Projects/sweet-search-private/core/prompt-optimization/data/results/r282-<cell>/runs.jsonl`
- captures: same folder, `captures/<arm>.<id>.json` (answer, rawResponse, calls[] with command + textChars)
- sessions: `~/.ss-eval/r282/<cell>/` (live; do not write) — archive copy:
  `/Users/admin/Projects/sweet-search-private/core/prompt-optimization/data/results/r282-sessions-20260930.tgz`

## Record = one model REQUEST (one assistant response)

```jsonc
{
  "cell": "oc-dsflash41", "arm": "sweet" | "native", "id": "<probe id>", "set": "vault|heldout|ood",
  "lang": "...", "stratum": "...",
  "sessionId": "...",            // harness session / thread id
  "thread": "main" | "side:<n>", // Claude Code sidechains (subagents); others always "main"
  "req": 0,                      // 0-based request index within the thread
  "model": "...",
  "tok": {
    "inUncached": 0,             // input tokens billed at full input price
    "cacheRead": 0,
    "cacheWrite": 0,             // Anthropic only; 0 elsewhere
    "inTotal": 0,                // = inUncached + cacheRead + cacheWrite
    "out": 0,                    // output tokens as billed (Codex: output_tokens already includes reasoning)
    "reasoning": null            // count if the harness reports it; null if unknown (Claude Code)
  },
  "costUsd": 0,                  // this request's cost, same price table + basis as the runner
  "textOutChars": 0,             // visible assistant text in this response
  "thinkingChars": 0,            // visible thinking / reasoning text chars (0 when encrypted/absent)
  "reasoningText": null,         // DeepSeek only: full raw reasoning text; else null
  "calls": [                     // tool calls EMITTED by this request, in order
    {
      "callId": "...",
      "tool": "ss-search",       // see naming rules
      "sub": null,               // shell: first command word (rg, grep, cat, sed, find, ls, head, ...)
      "argChars": 0,
      "argText": "...",          // the command / arguments (truncate at 2000 chars)
      "resultChars": 0,
      "resultTokensEst": 0,      // ceil(resultChars / 4) unless the harness gives a real count
      "resultText": "...",       // FULL result text (needed for rank-usage + metadata-share analysis)
      "isError": false
    }
  ]
}
```

Plus one summary record per rollout, `{"type":"rollout", cell, arm, id, sessionId, requests, turns,
calls, costUsdSum, runnerCostUsd, reconDiffPct, prefixTokens, answer}` where
`prefixTokens` = fixed prefix (system prompt + tool definitions + injected rules/context) of the
first request, measured from the first request's input minus the user message, or from the
request body if the store has it; state the method.

## Tool naming rules (FINAL_TUNING.md §2.2)

- Sweet tools: the **basename** of the executable that is invoked (`ss-search`, `ss-read`, `ss-grep`,
  `ss-find`, `ss-semantic`, `ss-trace`, `ss-batch`). Match the basename of the first command word
  (after `cd …&&`, env assignments, `timeout`), never the first `ss-` substring: the path
  contains `.ss-eval`, which a naive regex reads as a tool.
- Native tools: the harness tool name (`Read`, `Grep`, `Glob`, `Bash`, `Task`, `TodoWrite`,
  `read`, `grep`, `glob`, `bash`, `list`, `shell`, `apply_patch`, `update_plan`, …).
  For shell-like tools set `tool` to the harness tool and `sub` to the first command word;
  if the shell command invokes an ss-* tool, set `tool` to that ss-* name and `sub` to "shell".
- A piped / chained shell command: `sub` = first command word; note pipelines in `argText`.

## Validation (mandatory before trusting a cell)

- Every runner row joins exactly one session (key: cwd/clone path + arm + first user message
  containing the question text + start time). A row that joins 0 or ≥2 sessions is an error.
- `reconDiffPct` = (Σ request costUsd − runner costRealizedUsd) / runner cost. Report the
  distribution; |diff| ≤ 2% on ≥ 98% of rollouts, and the pooled sum within 2%.
- Hand-check 3 rollouts per cell (one native, two sweet): print them and compare to the raw store.
