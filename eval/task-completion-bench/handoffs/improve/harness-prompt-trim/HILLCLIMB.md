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
| Codex (v3, Luna code mode) | v3 | **pallyt** (A −3%, −16%; rotB −28%, 0/6=0/6) — replaces pall (6 cells avg ≈ −7%) | pall (r2 −11% 3/4 v 2/4; r3 −13% 3/4 v 2/4; r4 −3% 3/4=3/4) | **pallyt candidate** (r5 −3%, r6 −16%; cheaper than pall both times), yield (r2 −7%) | unchain, dep, two, plan, yieldedit, yieldeditpall, pallyield (r4 +10%), pallfind (r5 +15%) |
| opencode (untrimmed, Luna) | untrimmed | **todoall** (rotB −18%, turns −38%, 0/6=0/6: cost-only on B) | todoall (r2 −10%, r3 −24%, r4 +1%; turns −25..−37% every time; 3/4=3/4); combo (r2 −12%, r3 −15%) | todoall2 (r5 −23%, 43 v 81 turns), comboall (r3 −16%) | unchain, dep, two, plan, todo, tododesc, todoallfit (r4 = todoall: Luna already uses ss-* almost only), todoall2find (r5, ss-find lines add cost) |
| Claude Code (product, Opus 5.5) | product (max-batch) | — | **amp** (r2 −15%, r3 −12%, 3/4=3/4; r1 −2% fix off; rotB +8% but 2/6 v 1/6 — not promoted) | ampsaferange (r5 −15%, 29 v 36 turns), ampsafe (r5 −6%), ssread (r2 −14%, r3 −4%) | two, plan, ampssread |

## Results log (cost vs same-cell baseline; solves variant/baseline)

- R1 (fix OFF, 22:04-00:22): no batching line helped anywhere. Generic "batch" wording made agents
  read more (opencode two +41%, plan +60%).
- R2 (fix ON): Codex pall −11% (3/4 v 2/4), yield −7%, yieldedit −9% (2/4), all3 +5%.
  opencode todo +4% (turns −15%), tododesc −4%, todoall −10%, combo −12% (turns −35%).
  Claude Code amp −15%, ssread −14%, ampssread +9% (baseline had a degenerate re-run).
- R3: Codex pall −13% (3/4 v 2/4). opencode todoall −24%, combo −15%, comboall −16%.
  Claude Code amp −12%, ssread −4% (bingo flagged degenerate in every Claude Code baseline: noise, both sides).
- Rotation B ledger: all 10 confirm10 tasks gold-valid under the fixed code (04:00).
- R4: Codex pall −3% (3/4 = 3/4; stronger baseline). Codex totals R2-R4: pall 9/12 v base 7/12, never dearer.
- R4 opencode: todoall +1% (turns 49 v 68), todoallfit +2%. Codex pallyield +10% (pragma without write_stdin does not help).
- rotB-codex-1: pall −11% ($0.086 v $0.097), 0/6 = 0/6 (Luna solves none of rotation B under Codex; cost evidence only), turns 91 v 103. -> Codex CHAMPION = pall.
- rotB-opencode-1: todoall −18% ($0.066 v $0.080), turns 58 v 93, fewer turns on all 6 tasks, 0/6 = 0/6. -> opencode CHAMPION = todoall.
- rotB-claudecode-1: amp 2/6 v 1/6 (gained svgr), cost +8% ($0.885 v $0.816; brighterscript +$0.09), turns 44 = 44. Cost saving did NOT transfer -> amp NOT promoted; Claude Code champion stays the shipped product prompt. amp remains a candidate (R5 tests amp+safe lines).
- R5 Codex (rotation A): base $0.078 (72 turns); pall $0.084 (+8%); pallyt $0.076 (−3%, 66 turns, waits 6 v 13, template used in 9 test cells); pallfind $0.090 (+15%); pallytfind $0.076 (65 turns). All 3/4. The wait-safe test-cell template is the only line that helps; ss-find/alternation lines add nothing. pall over 5 cells: −11, −13, −3, +8 (A), −11 (B) — small, likely real, noisy.
- Queue: r6-codex (base pall pallyt), rotB-codex-2 (base pallyt).
- R5 opencode (rotation A): base $0.087 (81 turns); todoall $0.086 (72); **todoall2 $0.067 (−23%, 43 turns)**; todoall2find $0.076 (49). All 3/4. The ss-find/alternation lines cost money in BOTH Luna harnesses -> dead. todoall over 5 cells: −10, −24, +1, −1 (A), −18 (B).
- Queue: r6-opencode (base todoall todoall2), rotB-opencode-2 (base todoall2).
- R5 Claude Code (rotation A): base $0.792 (36 turns); amp $0.731 (−8%); ampsafe $0.743 (−6%); **ampsaferange $0.672 (−15%, 29 turns; super_editor −40%)**. All 3/4. amp on A with fix on: −15, −12, −8 (3/3), rotB +8% (2/6 v 1/6).
- Queue: rotB-claudecode-2 (base ampsaferange), r6-claudecode (base amp ampsaferange).
- R6 Codex (A): base $0.099 (109 turns); pall $0.088 (−11%, 89); **pallyt $0.083 (−16%, 75)**. All 3/4. pallyt is a CANDIDATE (cheaper than base and pall in 2/2 cells); rotB-codex-2 decides champion.
- rotB-codex-2: pallyt $0.078 v $0.109 (−28%), turns 77 v 101, cheaper on 4/6 tasks (longest test suite $0.046 -> $0.018), 0/6 = 0/6. -> Codex CHAMPION = pallyt.
- Trace analysis 3 (08:20): pallyt's template returns the verdict in 1 turn in 15/15 cells that use it, but 0/14 FIRST test cells use it (the agent copies yield_time_ms onto exec_command). todoall2: solo todo turns 17 -> 1; post-test review turns remain (10-13% of cost). amp lost rotB because 'work out every read' makes read batches bigger; ampsaferange's A gain is mostly one large whole-file read (super_editor), so it may not generalise. No removals proposed for Codex/opencode (past trims lost solves).
- R6 opencode (A): base $0.074 (70 turns); todoall $0.062 (−16%, 45); todoall2 $0.072 (−3%, 45). All 3/4. todoall2 v todoall: −22% (r5), +16% (r6) -> no consistent gain; todoall stays champion (7 cells, avg ≈ −11%, never lost a solve).
- rotB-opencode-2: todoall2 $0.071 v $0.082 (−13%), turns 57 v 93, 0/6 = 0/6. todoall (−18% on B) stays champion: simpler, better record.
- rotB-claudecode-2: ampsaferange $0.855 v $0.787 (+9%), 2/6 = 2/6 (jupytext +$0.09). Same pattern as amp on B -> not promoted. Claude Code champion stays the shipped prompt; saferange (no 'work out every read') tests the fix in R7 + rotB-3.
- Round 7 queued: Codex pallyt1 (template for EVERY test run), pallyt1open (+ first tests and searches in one cell); opencode todoall2diff (git diff in parallel with the final test run); Claude Code saferange (ampsaferange minus 'work out every read' — a removal), saferangefinal (+ short final message); rotB for the two Claude Code variants. r6-claudecode folded into r7.
- Trace analysis 2 (04:40): opencode todoall acts as intended (solo todo turns 31 -> 12, todo calls unchanged);
  Codex pall mostly NOT via Promise.all (baseline already used it) — saving is fewer lost-verdict relaunches;
  Claude Code amp shows no behaviour change (saving mostly on the unsolved bingo). Remaining sinks: Codex
  test cell without write_stdin loses the verdict; opencode opener/closing solo todo turns; Claude Code
  whole-file reads (35-40% of a task's cost), `cd subdir; ss-read relative` ENOENT (12 in 28 rollouts),
  `run_tests | grep` lost the verdict 4/16 (`| tail` 0/51). Round 5 lines built from these.
- Queue: rotB-codex-1 (base pall), rotB-opencode-1 (base todoall), rotB-claudecode-1 (base amp), then R5 on
  rotation A: Codex pall/pallyt/pallfind/pallytfind, opencode todoall/todoall2/todoall2find, Claude Code
  amp/ampsafe/ampsaferange.

## Queue plan

1. (running) Claude Code R3 base/amp/ssread -> Codex R4 base/pall/pallyield -> opencode R4
   base/todoall/todoallfit (todoallfit = todoall + opencode's "prefer Glob and Grep" bullet replaced
   by an ss-* line: sweet-search fit).
2. Rotation B promotion cells for each harness's candidate (6 tasks, concurrency 6).
3. New trace analysis on R2-R4 to find the next lines per harness; climb from the champions.
