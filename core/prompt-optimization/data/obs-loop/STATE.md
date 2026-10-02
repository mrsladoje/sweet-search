# OBSERVATIONS.md loop — state (started 2026-10-02)

Owner request: implement every OBSERVATIONS.md entry; each must pass a micro-smoke A/B (few reps); on-par but
mechanistically sound → integrate. Owner answers (2026-10-02): chunker = build + GCSN dev MRR on a temp index,
NO reindex, no A/B until end-of-tuning reindex; A/B models = Claude Code + Opus 5.5 medium (Max plan) and
Codex + GPT-6.1 Sol high (ChatGPT plan); own worktree (this one, branch obs-loop) — a Cursor agent edits main.
No back-compat code, no migrations (hard rule).

## Design
- Retrieval A/B: r3-hard DEV, 11 questions (smoke-ids.txt: highest ss-grep use + the 4 replay diagnostics),
  REPS=2. Codex interleaved (ab.sh cx), Claude Code ABBA sequential (ab.sh cc). Read with analyze.mjs.
- Gutter: task-bench micro-smoke, Claude Code + Opus, TAB vs NONE, 3 tasks x 2 reps (gutter-smoke.sh, prep agent).

## Items
| # | Entry | Status |
|---|---|---|
| 1 | ss-grep full hit line (SS_FIX_GREP_FULLLINE=0 = old) | implementing (agent impl-grep-fullline, this worktree) |
| 2+3 | rules flag line + file-name search + harness prompt halves (SS_FIX_RULES_V2=0 = old) | implementing (agent, own worktree; merge into obs-loop) |
| 4 | ss-read gutter NONE vs TAB on Claude Code | prep (agent prep-gutter); after 1-3 land |
| 5 | chunker C/D (namespace, export macro) | implementing (agent, own worktree), GCSN dev MRR |
| 6 | chunker large-function split | same agent as 5 |

## Log
