# Fix 2 + Fix 3 — final session summary (2026-05-13 evening)

**Production code touched**: `core/search/search-read-semantic.js` only
(`readSemantic` function). All changes are structurally gated to ss-semantic
by code path — verified by grep that no caller in core/search,
core/ranking, core/query, core/retrieval, or eval/gencodesearchnet imports
this module outside `eval/agent-read-workflows/` and `eval/read-workflows/`
(the read-tool benchmark surfaces).

## Dev-set trajectory (90 dev rows, best-shape slice, all v* tracks)

| sweep | what changed | PASS | PARTIAL | FAIL |
|---|---|---|---|---|
| v1 | initial (line-first top-1, stale preprocess) | 28 | 38 | 24 |
| v2 | preprocess Mode A fix re-applied | 29 | 39 | 22 |
| v3 | + Fix 1A `gradeSpans` rubric (max-score top-1) | 30 | 46 | 14 |
| v4 | rejected — Fix 2 OR-rule regressed typescript-lib by 3 | 28 | 46 | 16 |
| v5 | + Fix 2 (intersection: null-sym AND ≤5L demote 0.7225x) | 30 | 47 | 13 |
| **v6** | **+ Fix 3 (`_scoreSymbol` word-boundary on raw-query match)** | **31** | **48** | **11** |

**Cumulative session gain**: −13 FAIL (24 → 11), +3 PASS, +10 PARTIAL.

## Per-fix attribution

| fix | dev flips | structural rule |
|---|---|---|
| Fix 1A (rubric) | 8 FAILs → 7 PARTIAL + 1 PASS | gradeSpans uses max-score, not first-by-line |
| Fix 2 (intersection demote) | 1 FAIL → PARTIAL (RB-001 ruby) | demote 0.7225x when chunk is null-sym AND ≤5 lines |
| Fix 3 (word-boundary) | 2 FAILs → 1 PASS (LU-001) + 1 PARTIAL (JV-004) | _scoreSymbol's +2 raw-query-mention requires word boundary, not substring |

## Why I tried OR-rule for Fix 2 and rejected it

First Fix-2 attempt used `(null-sym OR ≤5L)` (UNION). On v4 sweep this
regressed typescript-lib from 0 FAIL to 3 FAIL because TS interface
declarations are legitimately small (≤5L) AND symboled — the small-chunk
rule was demoting them. Intersection (`AND`) targets exactly the
RB-001 pattern: tiny unnamed code fragments that win MaxSim by
concentrated literal-token presence (e.g., 3-line `module Sinatra`
declaration). Zero typescript-lib regression on v5.

## Validation table

| signal | result | notes |
|---|---|---|
| dev (90 rows, strict) | 31/48/11 (gained 13 PASS+PART from v1) | structurally targeted, no regressions |
| behavioural benchmark dev (n=23 paired) | unchanged from v3 → v6 | LU-001, JV-004 not in paired set; aggregate stable |
| locked retrieval-probes (post-perf-60) | 47/4/9 (vs 46/4/10 baseline) | +1 PASS predates this session (Mode E/F2); readSemantic unaffected by code path |
| GCSN MRR@10 | not run | SweetSearch.search doesn't invoke readSemantic — cannot move this number |
| unit tests | 16/16 search-read-semantic-* pass | |

## Remaining 11 dev FAILs after v6

| pattern | count | examples | next-session work |
|---|---|---|---|
| ~~OverlayRequired (chunker bug)~~ **RETRACTED — ranker problem** | 4 | CPP-003 ChosenTarget, LU-004 List, PY-006 convert, ZG-005 Response | `verify-chunker.mjs` proved the chunker DOES emit chunks at the gold ranges (see stage3-taxonomy.md update). Pure ranker fixes needed — no chunker / reindex work |
| wider-span-contains-gold | 4 | C-005 redisConnect, CPP-002 FunctionCache, DR-008 HeadersWithSplitValues, PY-004 command | harder ranker work; null-sym demote insufficient |
| sym-collision (genuine NL ambiguity) | 2 | ZG-001 / ZG-004 (V2 query "Request parse query parameters?" — `query` chunk matches "query" as a real word) | hard — would need capitalization-aware symbol matching |
| topK boundary | 1 | LU-003 deepcopy (top-1 in topK=8 audit, FAIL in topK=5 audit) | investigate fused vs LI re-rank ordering |

## Memory + commit trail

| commit | scope |
|---|---|
| `0deed31` | Stage 0 + 0.5 — benchmark audit, 38 behavioural rewrites, Fix 1A rubric |
| `72881b4` | Stage 2 + 3 — per-language summary, failure-mode taxonomy |
| `ccc264d` | Fix 2 — intersection demote |
| `6df2d9e` | Fix 3 — word-boundary `_scoreSymbol` |

## Discipline applied (per CLAUDE.md + user feedback)

- All fixes scoped to ss-semantic by code path (verified by grep)
- Structural rules with no per-language signal, no stopword growth
- Rejected OR-rule for Fix 2 when typescript-lib regressed
- Word-boundary fix preserves genuine word matches (ZG-001 "query" still scores correctly)
- Locked baselines (retrieval-probes 47/4/9, GCSN by code path) preserved
