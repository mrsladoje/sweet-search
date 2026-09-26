# HO2 admitted-200 — Claude Code 2.1.281 + Claude Opus 5.5, effort HIGH, subscription

Run `ho2-opus55high-20260925-a1`, 2026-09-25 13:06 → 2026-09-26 14:44 UTC (rollouts 21.3 h + grading),
box. 200 tasks × 2 arms × 1 rep = 400 rollouts, one run, one attempt. Prediction sealed before launch:
`PREDICTION-HO2-OPUS55-HIGH.md` (commit `f41c489`). Medium-effort counterpart: `RESULT-HO2-OPUS55-200.md`.

Raw rows retrieved to `results/ho2-opus55high-20260925-a1/` (untracked). `rows-costfilled.json` fills the
one empty cost (see below).

## Configuration

Identical to the medium leg except `REASONING=high` → `--effort high`: same 200 tasks
(`/root/ho2-admitted200.txt`), same harness code (runner/pilot/ideal-cost sha1 929e6656 / 82d307da /
991dcdbd), Claude Code 2.1.281 on all 400 rows, `claude-opus-5-5`, owner's Max subscription via
`claude auth login` (login renewed and written back several times mid-run), egress
`api.anthropic.com,platform.claude.com`, claude.ai connectors off, env ledger `luna-ho2-fp5` 200/200 green.

## Data quality

- 400 rows, 0 duplicates, 0 zero-call rollouts, `resolved` on every row.
- **1 native rollout hit the 30-min agent timeout** → no final result event → `costRealizedUsd` and
  `idealCostUsd` empty. Recovered from its single session transcript at list price: **$0.3399**, no
  subagents (same task, sweet $0.3491). The method reproduces clean rows exactly
  (e.g. $1.4845 = $1.4845) except where a degeneration re-run left two session files (the row
  counts only the kept attempt). The ideal-cache figures below exclude that task.
- Subagent spend $0 on both arms.

## Result (aggregate only — held-out)

| | native | sweet-search | Δ sweet vs native |
|---|---|---|---|
| **resolved** | 110/200 | 113/200 | +3; only-native 4, only-sweet 7; exact McNemar p = 0.549 |
| **cost, list, all 200** | $55.56 | $55.71 | **+0.3%**, 95% CI [−4.7, +5.3], p = 0.917; sweet cheaper on 83/200 |
| cost, ideal-cache, all (n=199) | $58.33 | $58.16 | −0.3%, CI [−4.8, +4.2], p = 0.896 |
| **cost, list, both-solved (n=106)** | $26.58 | $26.39 | **−0.7%**, CI [−7.5, +6.4], p = 0.844 |
| cost, ideal-cache, both-solved | $28.46 | $28.08 | −1.3%, CI [−7.4, +4.9] |
| cost per solved task, list | $0.505 | $0.493 | −2.4% |
| tool calls | 2,044 | 1,959 | −4.2%, CI [−9.5, +1.4], p = 0.153 |
| wall time | 8.47 h | 8.11 h | −4.2%, n.s. |
| cost per task | $0.278 | $0.279 | |

CIs: paired bootstrap over tasks, 10,000 resamples, seed 42. p for cost/calls/time: two-sided paired sign-flip, 20,000 draws.

### Phase split at the first edit (`harness-prompt-trim/scripts/phase_split.py`)

| phase | native | sweet | Δ | 95% CI |
|---|---|---|---|---|
| retrieval, up to the first edit | $30.89 | $33.47 | +8.4% | +2.3..+14.8 |
| fix + verify, after the first edit | $24.27 | $22.63 | −6.8% | −16.0..+3.3 |

(Transcript totals $55.16 / $56.11 v rows $55.22 / $55.72 — the gap is degeneration re-runs whose
discarded attempt stays on disk.) The sweet first-turn context is again **exactly +2,305 tokens** on every task.

## Medium v high

| | medium (`RESULT-HO2-OPUS55-200.md`) | high |
|---|---|---|
| solves sweet v native | 107 v 103 | 113 v 110 |
| cost Δ, all tasks | **+8.5%** (CI +4.0..+13.3) | **+0.3%** (CI −4.7..+5.3) |
| cost Δ, both-solved | +9.5% | −0.7% |
| retrieval-phase Δ | +13.4% | +8.4% |
| fix-phase Δ | 0.0% | −6.8% |
| native cost per task | $0.192 | $0.278 (+45%) |
| subagent requests | 0 v 0 | 0 v 0 |

Reading: the fixed prompt overhead (+2,305 tokens) is a smaller share of a larger bill at high effort,
and sweet now recovers part of it in the fix phase. At high effort sweet-search is cost-neutral with
+3 solves; at medium it was 8.5% dearer with +4 solves. Neither solve gap is significant.

## Sealed prediction — outcome

| # | prediction | result | verdict |
|---|---|---|---|
| P1 | cost Δ +3% to +12% (falsified if ≤ 0% or ≥ +20%) | +0.3% | **not falsified by its own rule, but below the predicted range — the prediction overstated the gap** |
| P2 | ≤ 10 subagent requests per arm | 0 and 0 | confirmed |
| P3 | solves within ±8, not significant | +3, p = 0.549 | confirmed |
| P4 | tool calls within ±10% | −4.2% | confirmed |
| P5 | cost per task +≥25% v medium on both arms | native +45%, sweet +34% | confirmed |

## Caveats

- One repetition. Dollars are list-price models (subscription, no per-token bill).
- The `ss` counter under-counts (`cd dir; ss-grep`); use transcript counts for tool mix.
- The single timeout is native; its cost is recovered, its ideal cost is not.
