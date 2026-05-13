# Stage 0.5 — Behavioural-rewrite parallel benchmark

**Date**: 2026-05-13
**Status**: Shipped — 38 behavioural rewrites authored, sweep run, side-by-side
comparison computed. Both benchmarks now available for Stage 4 fix validation.

---

## What we did

Per the Stage 0 conclusion (stop-rule tripped: 72.7% of dev FAILs returned a
span containing the gold), authored a parallel behavioural benchmark to
calibrate Stage 4 fix wins. A fix that improves only one benchmark is
suspicious; a fix that improves both is real.

| step | output |
|---|---|
| Re-run v1 sweep w/ corrected preprocess | `tracks/track-a-phase6-redo-ss-semantic-v2.jsonl` |
| Author rewrite system prompt | `scripts/ss-semantic/probe-rewrite-system-prompt.md` |
| Author script (DeepSeek V4-Flash, seed=42, T=0.3) | `scripts/ss-semantic/author-behavioural-rewrites.mjs` |
| Generate 39 stratified rewrites | `eval/ast-tester-probes/gold-behavioral/<lang>.json` (16 langs) |
| Run behavioural sweep | `tracks/track-behavioural-stage05-v1.jsonl` |
| Side-by-side comparison script | `scripts/ss-semantic/compare-benchmarks.mjs` |

Cost: ~$0.04 DeepSeek API. Wall time: ~3 min total.

## Authoring outcome

- 39 golds sampled stratified by family (seed=42): 8 OO + 6 Systems + 7 C + 8 JS + 10 Scripting.
- 38/39 rewrites produced (97%). 1 infeasibility: **EL-002 (Jason.Encoder)** — `expectedSymbolAnyOf` includes "encode", which is impossible to avoid in any synonym for "JSON encoding". Honest infeasibility, correctly logged.
- **0 symbol-leaks** under corrected validator (validates length 4-15 + symbol verbatim + symbol-sub-token stem 5b + path-token leak + behavioural-verb regex).
- One bug caught + fixed mid-run: my original validator delegated symbol-leak rules to `validateVariant(parsed, 'V5', input)` which short-circuits on length tier (V5 = 9-15, our rewrites = 4-15) — so 4-8-token rewrites skipped the leak checks. Fixed by calling the validator's exported leak helpers (`detectQueryStemLeak`, `detectPathTokenLeak`) directly. KT-001 "cancellation" (vs cancel/AndJoin sub-tokens) was the canary that surfaced this.

## Headline comparison (DEV only, n=23 paired)

| benchmark | PASS | PARTIAL | FAIL |
|---|---|---|---|
| strict ast-tester (best-shape) | 8 (34.8%) | 8 (34.8%) | 7 (30.4%) |
| behavioural rewrites | 6 (26.1%) | 8 (34.8%) | 9 (39.1%) |

Aggregate is slightly worse on behavioural (PASS rate -8.7pp). This is **expected and informative** — behavioural NL queries are inherently harder on this tool than symbol-anchored ones, because removing the symbol removes the strongest lexical anchor in the RRF fusion.

## The flip table (where strict ≠ behavioural on dev)

| flip | count | examples |
|---|---|---|
| FAIL → PASS | 2 | PY-004 (click `command` decorator), ZG-005 (Zig `Response` builder) |
| FAIL → PARTIAL | 2 | PY-006 (`convert` method), SC-005 (`RequestFailedException`) |
| PASS → FAIL | 3 | C-008 (linked list node), RB-008 (Rack middleware), TSL-008 (variance modifiers) |
| PASS → PARTIAL | 2 | CPP-002, RS-001 |
| PARTIAL → PASS | 1 | LU-008 (Lua `isalpha`-style check) |
| PARTIAL → FAIL | 3 | C-004, GO-003, JV-005 |
| same | 10 | — |

GO-004 also flipped (PASS→PARTIAL, top1 0.97→0.21). Total **13 of 23 dev pairs flipped**.

## What the flips tell us

**FAIL → PASS / PARTIAL (4 cases)**: confirms benchmark-shape on some golds. For golds with generic symbols like `command`, `convert`, `Response`, the symbol-anchored query is hurt by the symbol being ambiguous in lexical match — multiple chunks contain `command` literal. The behavioural rewrite ("find the decorator that registers a CLI command") lexically/semantically pins the right chunk better.

**PASS → FAIL (3 cases)**: the more interesting signal. These golds have symbols (`redisCallback`, `ServeMux`, `interface OutVariant`) whose verbatim presence in the V1 query gave a strong lexical/symbol-score boost; removing the symbol moved the right chunk down the ranking. **A Stage 4 fix that wins on strict ONLY may be improving symbol-verbatim signal only, not the bi-encoder side.** A real win shows up on both.

**Same-verdict (10 cases, 43%)**: where both benchmarks agree, the verdict is robust to query shape. These are the "fair" cases.

## Implications for Stage 4 fix work

1. **Fix 1 (file-header-as-top-1, 3 dev FAILs)** is a structural ranker bug — file-header chunks have no business being top-1 for *any* query shape. Should win on both benchmarks. If it doesn't win on behavioural, the diagnosis was wrong.

2. **Fix 2 (wrong-chunk-wins, ~6 dev FAILs)** is where the calibration matters most. Cases like KT-005 cancelAndJoin (strict: PARTIAL/FAIL with top1=0; right span at #3) are the meaty cases. If a fix lifts KT-005 on strict but not on behavioural, it's measuring symbol-verbatim alignment, not chunk-rank quality.

3. **Reporting discipline**: every Stage 4 fix MUST report deltas on both benchmarks. Commit messages should follow the pattern `strict: ΔPASS=+X, ΔFAIL=-Y / behavioural: ΔPASS=+A, ΔFAIL=-B`.

## Held-out untouched

Of the 38 behavioural rewrites, the dev/held-out split (inherited from `splits/manifest.json`, seed=42) puts 23 on dev and 15 on held-out. **Held-out behavioural rows have NOT been inspected per-query** — aggregate metrics only, available at Stage 5 milestones.

## Next steps (next session or continuation)

1. **Fix 1**: investigate why file-header chunks win top-1 (JV-002, RB-001, RB-004). Likely candidates: lexical regex catches package/import keywords; MaxSim score is structurally inflated for short text chunks; or the chunker emits an over-large file-header chunk that lexical query terms hit cumulatively.
2. **Fix 2**: dump signals (verbose: true) on KT-005, RB-006, TSL-006 to see whether right chunk lost at lexical, symbol, or MaxSim layer. Diagnose before fixing.
3. Each fix shipped as a single commit with format-gated changes (per CLAUDE.md ranking signal rules). Validate on strict + behavioural + retrieval-probes (zero PASS→FAIL) + GCSN MRR@10 = 86.93% + unit tests.

## Artifacts

| path | description |
|---|---|
| `eval/ast-tester-probes/gold-behavioral/<lang>.json` | 38 behavioural rewrites, 16 languages |
| `tracks/track-behavioural-stage05-v1.jsonl` | 38 sweep rows |
| `failure-analysis/stage05-comparison.json` | Side-by-side strict-vs-behavioural |
| `scripts/ss-semantic/probe-rewrite-system-prompt.md` | System prompt spec |
| `scripts/ss-semantic/author-behavioural-rewrites.mjs` | Authoring script |
| `scripts/ss-semantic/track-behavioural-runner.mjs` | Behavioural sweep runner |
| `scripts/ss-semantic/compare-benchmarks.mjs` | Comparison script |
