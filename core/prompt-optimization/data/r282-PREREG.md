# Retrieval matrix on sweet-search 2.8.2 — pre-registration

Written 2026-09-30, before any full-cell rollout. Runner: `scripts/retrieval-bench-282.mjs`.
Rows: `core/prompt-optimization/data/results/r282-<cell>/runs.jsonl`.

## Cells (agreed with the owner 2026-09-30)

| Cell | Harness (pinned) | Model | Effort | Billing |
|---|---|---|---|---|
| `cc-sonnet55-high` | Claude Code 2.1.281 | claude-sonnet-5-5 | `--effort high` | subscription |
| `cc-opus55-medium` | Claude Code 2.1.281 | claude-opus-5-5 | `--effort medium` | subscription |
| `codex-sol61-high` | Codex 0.159.2 | gpt-6.1-sol | `model_reasoning_effort=high` | subscription |
| `oc-sol61-high` | opencode 1.18.4 | openrouter/openai/gpt-6.1-sol | `--variant high` | OpenRouter API |
| `oc-dsflash41` | opencode 1.18.4 | deepseek/deepseek-flash (= DeepSeek-V4.1-Flash, direct API) | API default: thinking on, high | DeepSeek API |

opencode stays on 1.18.4 because the shipped opencode trim edits and the preflight are pinned to its text.

## Arms

- **native** — the stock harness. No ss-* on PATH, no sweet-search files.
- **sweet** — the 2.8.2 product harness, as `sweet-search init` installs it, through the task-bench helpers:
  - Claude Code: `.claude/rules/sweet-search.md` + the lean harness (agent files, settings, manifest).
  - Codex: `model_instructions_file` (conflict + yt3batch2) + `developer_instructions` (rules).
  - opencode: conflict3+todo3eff3k (prompts + tool-description plugin; grep and explore off) + rules as an `instructions` file.
  - ss-* wrappers from `eval/agent-read-workflows/bin` on PATH.

Both arms get the same frame in the user message (the `FRAME` constant in the runner): work read-only, use only the repository, and answer with file paths + symbols + one to three sentences, or "No match found."

## Probes

vault (60) + held-out (30) + OOD (40) = **130 per arm, merged**. The whole pool is treated as held-out: aggregates only, and no per-probe inspection. A probe that needs debugging is reproduced on the dev set (`p7-dev-probes.json`). The connection checks (`--smoke`) used dev probe `go-005` only.

## Isolation

- Each cell runs on fresh APFS clones of the 18 repos under `~/.ss-eval/r282-repos/<cell>/`. The clones keep ancestor instruction files out (see "Found during preparation"). They also give every cell the same starting index, and they catch agent writes (`[DRIFT]` lines in the log).
- Harness state is private for each cell: `CLAUDE_CONFIG_DIR`, `CODEX_HOME` + `HOME`, and the opencode XDG dirs under `~/.ss-eval/r282/<cell>/`. The operator's `~/.claude`, `~/.codex` and `~/.config/opencode` are not loaded.
- Concurrency is 3 rollouts. Cells run one after another. The arms run one after another inside a cell (native, then sweet).

## Metrics

Primary, reported for each cell as sweet − native, paired by probe:
1. **Accuracy.** Judge-panel correctness in [0,1]. The panel is deepseek-v4-flash (direct), gemini-3.1-flash-lite (direct) and MiniMax via OpenRouter, taking the median of the judges that returned a score.
2. **Cost.** Token counts × list price, cache-aware, with the cache-write 1.25x basis (`ideal-cost.mjs` MODEL_PRICES). The same basis applies to every cell, whatever the billing. Claude Code cost includes subagent transcripts (sidechain-inclusive).
3. **Tool calls.**
4. **Useful content per response** (USD `content`, the June definition).

Secondary: wall time, USD_noC, and the sweet-arm ss-* adoption rate.

Analysis: a paired bootstrap stratified by set (vault / held-out / OOD), B = 20000, seed 42, with a 95% percentile interval. The pooled result is the headline. The per-set results are secondary, aggregate only. Benjamini–Hochberg at q = 0.05 applies across the 5 cells × 4 primary metrics.

Exclusions:
- A probe counts only when both arms finished (exit 0, no runner error).
- Timeouts (15 min) and errors are reported for each arm.
- An account-level failure (usage limit, login) stops the cell. It never becomes a row.

## Known limits (disclose with any result)

- Codex and opencode cost come from the main-session usage events only. Delegated subagent turns are not priced there (Claude Code's are).
- The engine, the ss-* wrappers and the harness prompts all changed since June, so no cell is comparable with a June cell.
- One repetition per probe.

## Found during preparation (2026-09-30)

- **Ancestor instruction-file leak.** Claude Code 2.1.281 loaded this project's root `AGENTS.md` into both arms when the run started inside `eval/repos/`. opencode 1.18.4 does the same for the five `eval/repos` checkouts, because their `.git` folder is empty and opencode walks past them (proved with a sentinel `AGENTS.md`). Codex stopped at the repo. The June matrix ran in the same folders, so June's Claude Code and opencode cells may have carried this file. This is not verified for June's CLI versions.
- The June runner renamed the user's global `~/.claude/CLAUDE.md` during Claude Code cells. This runner uses a private config dir instead.
