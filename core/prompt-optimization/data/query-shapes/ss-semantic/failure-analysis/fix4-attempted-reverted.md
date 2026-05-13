# Fix 4 attempted and reverted — candidate-pool union with maxsim-top-K

**Date**: 2026-05-13 evening
**Status**: REVERTED. Production code (`core/search/search-read-semantic.js`) restored to post-Fix-3 (v6) state.

## Motivation

Stage 3 diagnose-maxsim-rank.mjs analysis (per-FAIL gold-chunk ranking
in the full candidate pool) showed:

| case | gold finalRank/of | gold fusedRank/of | gold maxsimRank/of | gold maxsim |
|---|---|---|---|---|
| C-005 | 2/17 | 1/17 | 3/17 | 0.569 |
| CPP-002 | 2/3 | 1/3 | 2/3 | 0.450 |
| CPP-003 | 10/10 | 10/10 | 10/10 | null |
| DR-008 | 3/3 | 3/3 | 3/3 | null |
| **LU-003** | **1/68** | **13/68** | **1/68** | **0.587** |
| LU-004 | 33/45 | 29/45 | 33/45 | null |
| PY-004 | 6/10 | 6/10 | 6/10 | null |
| PY-006 | 13/42 | 12/42 | 13/42 | null |
| ZG-001 | 6/44 | 2/44 | 7/44 | 0.467 |
| ZG-004 | 5/44 | 2/44 | 6/44 | 0.457 |
| ZG-005 | 16/25 | 7/25 | 16/25 | null |

**LU-003 stood out**: the chunk at the gold range is rank 1 by MaxSim
but rank 13/68 by fused score. The audit's `topK=5` selects only top
`5*2=10` chunks by fused, dropping the gold chunk before the LI re-rank
stage. Other cases had the gold either already in fused-top or out of
the LI-scored set entirely (maxsim=null).

## Hypothesis

Change candidate-pool selection from `top-(topK*2) by fused` to
`top-(topK*2) by fused ∪ top-(topK*2) by maxsim`. Expected to clean-fix
LU-003 without affecting cases where the gold is already in fused-top.

## Implementation

```js
const poolSize = Math.max(topK * 2, topK);
const byFused = [...fused.entries()].sort(...).slice(0, poolSize).map(([id]) => id);
const byMaxSim = liRan
  ? [...maxsimScores.entries()].sort(...).slice(0, poolSize).map(([id]) => id)
  : [];
const poolIds = new Set([...byFused, ...byMaxSim]);
const fusedTop = [...poolIds].map((id) => [id, fused.get(id) ?? 0]);
```

## Result (v7 sweep)

Net dev: 31 PASS / 48 PARTIAL / 11 FAIL — **same headline as v6** but with 4 verdict flips (CHURN):

| flip | direction | top1 v6 → v7 |
|---|---|---|
| LU-003 | FAIL → **PASS** ✓ | 0.00 → 0.60 |
| C-005 | FAIL → PARTIAL ✓ | 0.00 → 0.27 |
| RB-001 | PARTIAL → **FAIL** ✗ (Fix 2's win undone) | 0.29 → 0.00 |
| TSL-004 | PASS → **FAIL** ✗ | 0.85 → 0.00 |

Behavioural benchmark on the n=38 paired set:
- v6 strict: 11 PASS / 19 PART / 8 FAIL
- v7 strict: 10 PASS / 20 PART / 8 FAIL (-1 PASS — TSL-004 dropped on the paired set too)

The +2 wins are real (LU-003 was a clean target, C-005 partially recovered)
but the -2 regressions reveal an unintended consequence: chunks that
previously stayed OUT of the candidate pool because their fused score was
low (no lex/sym hits, weak MaxSim) are now PULLED IN via the MaxSim-union,
where Fix 2's null-sym demote (only -0.7225x for `null AND ≤5L`) doesn't
catch them and they outscore the previously-winning chunks.

## Why I reverted

- Net dev numbers unchanged
- Real verdict churn (4 cases shifted)
- Lost one independent test case (TSL-004) that wasn't in Stage 3's
  failure target — a genuine regression
- RB-001 was a hard-won Fix 2 case; undoing it for a different win is
  trading sand
- Per user's "don't overfit, fixes must generalize": this fix doesn't
  cleanly generalize. It pulls in different chunks than the diagnostic
  predicted because the candidate-pool expansion has emergent effects
  with the Fix 2 demotion logic that aren't predictable from the
  isolated case analysis.

## What this teaches us about the remaining 10 FAILs

Looking at the table above:
- **6 cases (CPP-003, DR-008, LU-004, PY-004, PY-006, ZG-005)** have
  `maxsim=null` on the gold chunk — the chunk wasn't in the LI index.
  Idea 4 doesn't help; the gold isn't in the LI candidate set at all.
- **4 cases (C-005, CPP-002, ZG-001, ZG-004)** have the gold ALREADY
  in fused-top-10 (finalRank 2-6). They lose at the LI re-rank because
  the wrong chunk genuinely scores higher on MaxSim — concentrated
  literal-token presence in a small chunk beats diffuse presence in a
  large struct/class definition. This is fundamental bi-encoder behavior.
- **1 case (LU-003)** is uniquely fixed by candidate-pool union.

No clean structural fix targets the cluster. Each candidate fix I
considered (size-preference, type-preference, capital-initial-match-boost,
common-word-filter) had a clear overfitting risk for some PASS case.

## Decision

Accept v6 as the final state for this session:
- v1 (initial): 28 PASS / 38 PARTIAL / 24 FAIL
- v6 (final): 31 PASS / 48 PARTIAL / 11 FAIL
- Net: **−13 FAIL** from a starting position over Stage 0 audit + Fix 1A
  rubric + Fix 2 intersection demote + Fix 3 word-boundary

The remaining 11 cases are the residue of:
- Chunker symbol-extraction gaps (separate workstream, requires reindex)
- Fundamental bi-encoder small-chunk concentration bias
- Genuine NL ambiguity (ZG-001/004 "query")

These are not addressable by safe ranker rules alone. Future leverage is
either in chunker work or in query-side intent parsing — both larger
workstreams.
