# Harness-prompt hill-climb (overnight loop, started 2026-09-27 03:40)

Goal (owner): cheaper at equal or better solves, by editing ONLY each harness's own system prompt /
tool descriptions / config, sweet arm only. Must generalise across task types — do not overfit to
the smoke tasks. Never change the product (`scripts/`), the sweet-search rules file, the frame, the
ss-* engine or native. No held-out-2 task, ever. Do not push the box; nothing here ships.

## Method

- Micro-smoke = one run-pilot per variant, distinct tasks x 1 rollout, all tasks at once
  (`scripts/hc-smoke.sh`, concurrency = task count), fresh baseline first in every cell.
- Validity fixes ON in every cell since round 2 (`BENCH_INCLUDE_UNTRACKED=1`,
  `RT_ATTACH_REQUIRE_SAME_DIFF=1`, ledger `results/bsmoke-ledger-fix/ledger.jsonl`). Never pool
  with round-1 (fix off) numbers.
- Variant texts: `harness/trim/batch-variants.mjs` (switches `CODEX_TRIM_BATCH`,
  `OC_HARNESS_TRIM=batch-*`, `CC_TRIM_BATCH`). Unset = byte-identical to the shipped form.
- $0 check before a new variant's first paid cell (instruction-file diff or request capture).
- Read: solves first (no variant may lose a solve the baseline has, in aggregate), then cost vs the
  SAME-cell baseline, then turns. One rollout per task is noisy (+-25% Codex baseline cost between
  identical runs), so:
  - **lead** = beats its same-cell baseline once;
  - **candidate** = beats it in 2 of 2 cells on rotation A;
  - **champion** = candidate that ALSO beats the baseline on a fresh rotation B (tasks it was not
    developed on). Only champions are promoted; the next climb starts from the champion.
- Rotations (confirm10 set, all DEV-RET, all gold-valid under the fixed code):
  - A = zlint-299 (go), super_editor-2516 (dart), eslint-plugin-ember-551 (js), bingo-271 (ts)
  - B = svgr-10 (js), maxgraph-365 (ts), brighterscript-1050 (ts), node-datadog-metrics-73 (js),
        fastify-cors-285 (js), jupytext-360 (python)
  - C (later) = new DEV-RET tasks need images + ledger; only if A/B are exhausted.
- Queue: `results/hc-queue.txt` run by `scripts/hc-queue.sh` (status `results/hc-queue.txt.status`).
- Next ideas come from (1) trace analysis by an Opus subagent over the latest cells, (2) web
  research. Keep lines general (no task, repo or benchmark wording).

## Current state (update every loop tick)

| harness | shipped/base | champion | candidates | leads | dead |
|---|---|---|---|---|---|
| Codex (v3, Luna code mode) | v3 | — | **pall** (r2 −11% 3/4 v 2/4; r3 −13% 3/4 v 2/4) | yield (r2 −7%) | unchain, dep, two, plan, yieldedit, yieldeditpall |
| opencode (untrimmed, Luna) | untrimmed | — | **todoall** (r2 −10%, r3 −24%, 3/4=3/4); combo (r2 −12%, r3 −15%) | comboall (r3 −16%) | unchain, dep, two, plan, todo, tododesc |
| Claude Code (product, Opus 5.5) | product (max-batch) | — | — | amp (r1 −2%, r2 −15%), ssread (r2 −14%) | two, plan, ampssread |

## Results log (cost vs same-cell baseline; solves variant/baseline)

- R1 (fix OFF, 22:04-00:22): no batching line helped anywhere. Generic "batch" wording made agents
  read more (opencode two +41%, plan +60%).
- R2 (fix ON): Codex pall −11% (3/4 v 2/4), yield −7%, yieldedit −9% (2/4), all3 +5%.
  opencode todo +4% (turns −15%), tododesc −4%, todoall −10%, combo −12% (turns −35%).
  Claude Code amp −15%, ssread −14%, ampssread +9% (baseline had a degenerate re-run).
- R3: Codex pall −13% (3/4 v 2/4). opencode todoall −24%, combo −15%, comboall −16%.

## Queue plan

1. (running) Claude Code R3 base/amp/ssread -> Codex R4 base/pall/pallyield -> opencode R4
   base/todoall/todoallfit (todoallfit = todoall + opencode's "prefer Glob and Grep" bullet replaced
   by an ss-* line: sweet-search fit).
2. Rotation B promotion cells for each harness's candidate (6 tasks, concurrency 6).
3. New trace analysis on R2-R4 to find the next lines per harness; climb from the champions.
