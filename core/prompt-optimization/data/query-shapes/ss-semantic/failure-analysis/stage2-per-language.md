# Stage 2 — Per-language failure rate (dev only, v3 + Fix 1A)

**Date**: 2026-05-13
**Sweep**: `track-a-phase6-redo-ss-semantic-v3.jsonl` (post Fix 1A: gradeSpans top-1 = max-score)
**Discipline**: DEV ONLY (held-out untouched per CLAUDE.md BEIR methodology)
**Best-shape per family**: V2 for C-family, V1 elsewhere

## Headline

| metric | value |
|---|---|
| dev rows (best-query slice) | 90 (5 per language × 18 langs) |
| PASS | 30 (33.3%) |
| PARTIAL | 46 (51.1%) |
| FAIL | 14 (15.6%) |

## Per-language ranking (FAIL rate ascending)

| lang | family | PASS | PARTIAL | FAIL | FAIL% | new failures from Fix 1A |
|---|---|---|---|---|---|---|
| csharp | OO-monolithic | 3 | 2 | 0 | 0% | -2 (CS-001/CS-005 false PASSes earlier; CS-002 corrected) |
| elixir | Scripting-dynamic | 3 | 2 | 0 | 0% | — |
| go | Systems-modular-terse | 1 | 4 | 0 | 0% | — |
| javascript | JS-mobile | 2 | 3 | 0 | 0% | — |
| kotlin | OO-monolithic | 2 | 3 | 0 | 0% | -1 (KT was 1 FAIL in v2) |
| php | Scripting-dynamic | 1 | 4 | 0 | 0% | — |
| rust | Systems-modular-terse | 1 | 4 | 0 | 0% | -1 (RS was 1 FAIL in v2) |
| **scala** | OO-monolithic | 0 | 5 | 0 | 0% | **-4 (all 5 Scala dev are now PARTIAL, mostly IoU < 0.5 from 2-line golds)** |
| typescript | JS-mobile | 2 | 3 | 0 | 0% | — |
| typescript-lib | JS-mobile | 4 | 1 | 0 | 0% | -1 |
| c | C-family | 2 | 2 | 1 | 20% | — |
| dart | JS-mobile | 4 | 0 | 1 | 20% | +1 (DR-008 newly exposed by rubric fix) |
| java | OO-monolithic | 0 | 4 | 1 | 20% | — |
| ruby | Scripting-dynamic | 2 | 2 | 1 | 20% | — |
| cpp | C-family | 2 | 1 | 2 | 40% | — |
| python | Scripting-dynamic | 0 | 3 | 2 | 40% | — |
| **lua** | Scripting-dynamic | 1 | 1 | **3** | **60%** | +1 (LU-001 newly exposed) |
| **zig** | C-family | 0 | 2 | **3** | **60%** | +2 (ZG-001 + ZG-004 newly exposed) |

## Per-family roll-up

| family | n | PASS | PARTIAL | FAIL | FAIL% |
|---|---|---|---|---|---|
| OO-monolithic | 20 | 5 | 14 | 1 | 5.0% |
| JS-mobile | 20 | 12 | 7 | 1 | 5.0% |
| Systems-modular-terse | 10 | 2 | 8 | 0 | 0% |
| Scripting-dynamic | 25 | 7 | 12 | 6 | 24.0% |
| C-family | 15 | 4 | 5 | 6 | 40.0% |

C-family is the worst family at 40% FAIL. Scripting-dynamic is second at 24%. JS-mobile and OO-monolithic are at 5%. Systems-modular-terse has 0 dev FAILs.

## Stage-3 focus targets per handoff (FAIL > 40%)

- **lua** (60% FAIL): LU-001 `_class`, LU-003 `tablex.deepcopy`, LU-004 `List`
- **zig** (60% FAIL): ZG-001 `Request`, ZG-004 `Request` (same gold, different probe IDs), ZG-005 `Response`

## At the 40% borderline

- **cpp** (40% FAIL): CPP-002 `FunctionCache`, CPP-003 `ChosenTarget`
- **python** (40% FAIL): PY-004 `command`, PY-006 `convert`

## Notable Fix-1A-exposed regressions

The rubric fix (line-first top-1 → max-score top-1) flipped 3 dev rows from "lucky PASS by line-order" to FAIL:

| gold | lang | v2 verdict | v3 verdict | reason |
|---|---|---|---|---|
| DR-008 | dart | PARTIAL or PASS | FAIL | HeadersWithSplitValues; wrong chunk (118-171, sym=unknown) outscored gold (15-64, BaseResponse) |
| LU-001 | lua | likely PASS | FAIL | `_class`; wrong chunk (220-237, sym=class) outscored gold (128-185, _class) |
| ZG-001/004 | zig | likely PASS | FAIL | Request struct; wrong chunk (140-147, sym=query) outscored gold (22-83, Request) |

These are NOT regressions in tool behaviour — the tool always behaved this way. The rubric fix just makes them visible. Stage 3 fixes target these specifically.

## Notable Fix-1A-exposed PASSes (the inverse)

Several v2 FAILs became PARTIAL or PASS under v3 because the highest-score span genuinely contained the gold:

| gold | lang | v2 → v3 |
|---|---|---|
| Multiple in OO-monolithic | many | FAIL → PARTIAL (now graded by score-top span, not first-by-line file-header) |
| scala SC-001/004/005/008 | scala | FAIL → PARTIAL (still IoU < 0.5 due to 2-line golds; Fix 1A doesn't help here) |

## Next step

Stage 3 deep-dive on the 14 dev FAILs. Diagnostic data in
`failure-analysis/stage3-diagnosis.jsonl`. Failure-mode taxonomy at
`failure-analysis/stage3-taxonomy.md`.
