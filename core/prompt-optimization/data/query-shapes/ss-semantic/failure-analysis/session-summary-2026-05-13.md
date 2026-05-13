# ss-semantic Phase 6 v2 — Session summary (2026-05-13)

## Deliverables landed

| stage | output | code touched |
|---|---|---|
| Stage 0 audit | escalated benchmark-shape concern; surfaced 6 stale-goldRange dev rows | none (analysis only) |
| v2 sweep re-run | clean dev baseline after preprocess Mode A fix landed | none |
| Stage 0.5 behavioural-rewrite system prompt | spec doc | none |
| Stage 0.5 38 behavioural rewrites authored | 0 leaks; 1 honest infeasibility (EL-002) | none (new script) |
| Stage 0.5 behavioural sweep | parallel benchmark | none (new script) |
| Side-by-side comparison | calibration anchor | none (new script) |
| **Fix 1A: gradeSpans top-1 = max-score** | rubric fix | **track-a-runner-ss-semantic.mjs** |
| Sweep re-runs after Fix 1A | clean v3 strict + stage05-v2 behavioural | none |
| Fix 1B diagnosis | RB-001-type real ranker bug isolated, not yet fixed | none |

Production code (`core/search/search-read-semantic.js`) is unchanged — all rubric work happened in the runner. Score field now plumbed through to JSONL rows so re-grading is no-cost in the future.

## Dev-set verdict trajectory

| sweep | rubric | PASS | PARTIAL | FAIL | benchmark-shape % of FAILs |
|---|---|---|---|---|---|
| v1 | line-first top-1, stale preprocess | 28 (31.1%) | 38 (42.2%) | 24 (26.7%) | 58.3% |
| v2 | line-first top-1, fresh preprocess | 29 (32.2%) | 39 (43.3%) | 22 (24.4%) | 72.7% |
| **v3** | **max-score top-1, fresh preprocess** | **30 (33.3%)** | **46 (51.1%)** | **14 (15.6%)** | **57.1%** |

Net: 8 fewer dev FAILs from v1 → v3 (24 → 14). All gains were instrumentation/rubric fixes; production ranker untouched.

## Behavioural-benchmark deltas (Stage 0.5)

DEV (n=23 paired golds, behavioural rewrites of same ast-tester golds):

| benchmark | PASS | PARTIAL | FAIL |
|---|---|---|---|
| strict v3 | 8 (34.8%) | 11 (47.8%) | 4 (17.4%) |
| behavioural v2 | 3 (13.0%) | 11 (47.8%) | 9 (39.1%) |

Behavioural is materially harder than strict (PASS rate -22pp). 3 dev PASS→FAIL flips when going strict→behavioural (CS-002, DR-001, TSL-008) confirm the strict benchmark's symbol-verbatim signal is doing real work — a Stage 4 fix that wins only on strict is suspect.

## Fix 1B candidate — RB-001 type real ranker bug

After Fix 1A landed, **1 of 14 dev FAILs still has top-1 = file-header chunk** (down from 4). That's RB-001 ("show Sinatra::Base"):
- File-header-adjacent `module Sinatra` chunk (lines 28-30, 3L) — MaxSim score 0.569
- Gold class body (lines 971-994, 24L) — MaxSim score 0.531

The tiny module-decl chunk genuinely outscored the actual class body. Bi-encoder rewards concentrated literal-token presence in a 3-line window over a fuller class body. Format-gated demotion proposal in `fix1-diagnosis.md` §"Fix 1b".

## Per-language FAIL shifts v2 → v3 (informative)

| lang | v2 FAIL | v3 FAIL | Δ | note |
|---|---|---|---|---|
| scala | 4 | 0 | -4 | all became PARTIAL (2-line golds, IoU still low but ≥ 0) |
| csharp | 2 | 0 | -2 | rubric fix |
| kotlin | 1 | 0 | -1 | rubric fix |
| rust | 1 | 0 | -1 | rubric fix |
| typescript-lib | 1 | 0 | -1 | rubric fix |
| zig | 1 | 3 | **+2** | rubric fix exposed real ranker issues |
| lua | 2 | 3 | **+1** | rubric fix exposed real ranker issue |

The +3 net regressions on zig/lua are new diagnostic targets for Fix 2. They were previously masked because the line-first-by-accident span happened to contain the gold; under score-correct grading, the highest-confidence span is wrong.

## Suggested next session work

1. **Fix 2 deep-dive (~6 dev FAILs)**: use `diagnose-file-header.mjs` as a template (rename to `diagnose-ranker.mjs`) and dump verbose signals on the 14 remaining dev FAILs. Pattern-match to fixable causes (MaxSim small-chunk inflation, lexical regex overscoring, symbol-score under-weighting on without-symbol-in-query cases).
2. **Fix 1B (RB-001 small-chunk MaxSim demotion)**: format-gated, ss-semantic-only; validate on dev + behavioural + retrieval-probes + GCSN.
3. **The new zig/lua FAILs**: probably also small-chunk MaxSim inflation. If Fix 1B's mechanism generalizes, these get a free ride.
4. **Stage 4 reporting discipline established**: every fix reports `strict Δ` AND `behavioural Δ`. Strict-only wins go in `not_promoted` for review.

## Open items not yet addressed

- Scala 2-line-gold cluster (now PARTIAL not FAIL, but IoU < 0.5 mathematically forced). Could be fixed by widening gold's `containingChunk` boundaries OR by using `max_iou` as the verdict-determining metric. Behavioural benchmark gives a different read on these golds (e.g., SC-005 strict PARTIAL 0.13 vs behav PARTIAL 0.29).
- Held-out (n=54) has NOT been graded against v3. Per BEIR discipline: aggregate-only inspection, at a milestone. Defer until after Fix 1B / Fix 2 land.

## Artifacts directory

`core/prompt-optimization/data/query-shapes/ss-semantic/`:
- `tracks/track-a-phase6-redo-ss-semantic-v3.jsonl` — score-correct strict
- `tracks/track-behavioural-stage05-v2.jsonl` — score-correct behavioural
- `failure-analysis/stage0-benchmark-audit.md` — Stage 0 conclusion + escalation
- `failure-analysis/stage05-summary.md` — Stage 0.5 calibration writeup
- `failure-analysis/fix1-diagnosis.md` — verbose signal dump + fix 1A/1B split
- `failure-analysis/stage0-summary.json` + `stage0-failures.jsonl` — v3 audit data
- `failure-analysis/stage05-comparison.json` — strict-vs-behavioural row pairs

`eval/ast-tester-probes/gold-behavioral/<lang>.json` — 38 behavioural rewrites (16 langs).

`core/prompt-optimization/scripts/ss-semantic/`:
- `track-a-runner-ss-semantic.mjs` (TOUCHED: gradeSpans + score in row spans)
- `track-behavioural-runner.mjs` (TOUCHED: score in row spans)
- `stage0-audit.mjs`, `compare-benchmarks.mjs`, `author-behavioural-rewrites.mjs`,
  `probe-rewrite-system-prompt.md`, `diagnose-file-header.mjs` (NEW)
