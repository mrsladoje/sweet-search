# File-kind intent-aware ranking — validation report

Generated: 2026-05-03 (final).

Numbers below combine the live guard-set runs from this session (the rule active in production code) with the cached graph-2hop rerank evidence that motivated the rule.

Default factor: 0.7 (`SWEET_SEARCH_FILE_KIND_FACTOR=0.7`, conservative — captures ~94 % of blanket-demote's gain on graph-2hop). Rule fires only when query intent is `implementation`; doc / test / type intents leave the result list untouched.

## Guard set (live search via `eval/miss-analysis/test_file_kind_intent_ranking.js`)

93 hand-validated queries across fastify / flask / ripgrep. Every gold path was checked to exist on disk and (where feasible) verified to contain the claimed symbol via `grep -l`. The guard runner uses `use3Stage:false` because some test repos still carry stale 768-d float vectors in SQLite that fail Stage 2.5's dimension check; the file-kind question is independent of which retrieval path runs. Cold-start errors (~11 fastify queries) reproduce with the rule disabled, so they are independent of this change.

### implementation intent (n = 20)

| ranker | R@1 | R@10 |
|---|---:|---:|
| baseline       | 30.00 % | 90.00 % |
| blanket demote | 35.00 % | 90.00 % |
| **intent-aware** | **35.00 %** | **90.00 %** |

### docs intent (n = 20)

| ranker | R@1 | R@10 |
|---|---:|---:|
| baseline       | 60.00 % | 90.00 % |
| blanket demote | **15.00 %** ⚠️ | 85.00 % |
| **intent-aware** | **60.00 %** | **90.00 %** |

### tests intent (n = 20)

| ranker | R@1 | R@10 |
|---|---:|---:|
| baseline       | 60.00 % | 80.00 % |
| blanket demote | 55.00 % | 85.00 % |
| **intent-aware** | **60.00 %** | **80.00 %** |

### types intent (n = 22)

| ranker | R@1 | R@10 |
|---|---:|---:|
| baseline       | 45.45 % | 81.82 % |
| blanket demote | **27.27 %** ⚠️ | 86.36 % |
| **intent-aware** | **45.45 %** | **81.82 %** |

### Headline guard finding

Blanket demotion lost the top-10 hit on **1** guard query and dropped doc R@1 by **45 pp**, types R@1 by **18 pp**. Intent-aware ranking lost the top-10 hit on **0** guard queries and preserved every doc / test / type baseline R@1 number exactly.

The single blanket-harmed example: `docs-flask-004` "flask deployment guide" — baseline rank 5, blanket rank 11, intent-aware rank 5.

## Graph-2hop benchmark (cached top-10 rerank, n = 295)

Same data set used to motivate the rule. Rerank applied offline to the post-reindex top-10 lists in `graph2hop_records.json`.

| ranker | R@1 | R@10 | rescue@10 | harm@10 |
|---|---:|---:|---:|---:|
| baseline    | 47.46 % | 82.37 % | — | — |
| blanket     | 65.42 % | 82.37 % | 0 | 0 |
| **intent-aware** | **64.41 %** | **82.37 %** | 0 | 0 |

Intent-aware retains **94 % of blanket's R@1 gain** (16.95 / 17.96 pp), R@10 unchanged, zero harm at the top-10 boundary.

## GCSN dense (no rule applies)

Verified empirically: of 1000 GCSN queries, 975 (97.5 %) classify as `implementation` intent, but the GCSN corpus contains zero docs / tests / types files — every entry is a single source-code chunk (`emitFiles_57fa9c6b.js`, `_integrate_plugins_215869e2.py`, etc.). Therefore `applyFileKindRanking` is a **structural no-op** on this benchmark. The rule cannot affect GCSN headline numbers and does not need a benchmark-specific switch.

## Decision

All four production-readiness criteria pass:

1. ✓ Implementation guard R@1 lifts from 30 → 35 %, matching blanket exactly.
2. ✓ Docs / tests / types guard R@10 not worse than baseline (preserved exactly).
3. ✓ Graph-2hop R@1 lift preserved within 1 pp of blanket (64.41 vs 65.42).
4. ✓ Graph-2hop and guard harm@10 both zero.

**Recommendation: ship default-on with the kill-switch wired.** Default factor 0.7. The soft-factor sweep showed saturation at ≤ 0.7 and even factor 0.99 produces measurable MRR lift, so a more conservative factor (e.g. 0.85) would be a safe future option if telemetry warrants.

## Operational notes

- **Disable**: `SWEET_SEARCH_FILE_KIND_RANKING=0` (or `=false`).
- **Tune factor**: `SWEET_SEARCH_FILE_KIND_FACTOR=0.85` (range `(0, 1]`).
- **Telemetry**: every `search()` response now carries `stats.fileKindRanking = { intent, applied, top1Changed }`.
- **Per-call override**: pass `{ intent: '...' }` directly to `applyFileKindRanking` to bypass the keyword classifier (useful if upstream has a richer intent signal).
- **Both retrieval paths**: rule applies in cascade and legacy-LI paths because it sits in `search-postprocess.js` after both branches converge.
