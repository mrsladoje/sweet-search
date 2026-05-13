# PHASE6_REDO `structural` — Held-out validation report

**Date**: 2026-05-14
**Track**: `core/prompt-optimization/data/query-shapes/structural/tracks/track-a-phase6-redo-structural-v1.jsonl`
**Split source**: `eval/ast-tester-probes/splits/manifest.json` (seed=42, stratified by language)
**Discipline**: aggregate-only — no per-probe inspection on held-out (CLAUDE.md §0.5 + `feedback_heldout_discipline_strict`).

## Headline

The 2026-05-14 structural-redo finding **replicates on held-out**: phrasing is rank-equivalent within a relationship type once the parser fires. **65/65 held-out probes show zero variance across the 5 phrasings** (matches the 105/105 dev result; full sweep: 170/170 probes). The recommendation (P3 declarative for each of callers / callees / impact) holds on held-out by construction — all phrasings tie, so the tie-break to P3 is invariant.

## Aggregate metrics (held-out, n=65 probes / 390 rows / no P_baseline)

| Relationship | n probes | avg R@5 | PASS rate |
|---|---|---|---|
| callers | 26 | 0.398 | ~38% |
| callees | 13 | 0.403 | ~38% |
| impact | 26 | 0.414 | ~38% |

Dev/held-out comparison (avg Recall@5 on the chosen P3 cell):

| Relationship | Dev (n=105) | Held-out (n=65) | Δ |
|---|---|---|---|
| callers | 0.298 | 0.398 | +10.0pp |
| callees | 0.579 | 0.403 | −17.6pp |
| impact | 0.242 | 0.414 | +17.2pp |

The dev/held-out delta is not a "gain that should generalize" — there's no prompt change to generalize, since phrasings tie. The delta is per-probe variance from the small heldout sets (especially callees n=13 vs dev n=42). The held-out impact set being **higher** than dev rules out the dev set being a phrasing-favored cherry-pick, which is the discipline's primary concern.

## Per-family × relationship coverage (held-out)

| Family | callers | callees | impact |
|---|---|---|---|
| JS-mobile | 9 probes, R@5=0.500 | 6 probes, R@5=0.752 | 9 probes, R@5=0.667 |
| OO-monolithic | 7 probes, R@5=0.401 | 2 probes, R@5=0.000 | 7 probes, R@5=0.246 |
| Scripting-dynamic | 8 probes, R@5=0.304 | 2 probes, R@5=0.000 | 8 probes, R@5=0.304 |
| Systems-modular-terse | 2 probes, R@5=0.312 | 3 probes, R@5=0.242 | 2 probes, R@5=0.312 |
| C-family | **0 probes** | **0 probes** | **0 probes** |

**C-family thin data**: 0 held-out structural probes. The 60/40 manifest split was stratified by language, not by graph-coverage, so the held-out slice of C/CPP/Zig has no probes with non-empty graphNeighbors. This is a documented limitation, not a methodology gap; the dev set has 5 C-family probes (still descriptive-only by the §9-G2 thresholds).

## Impact 1-hop vs 2-hop diagnostic (held-out)

- Held-out impact 1-hop average Recall@5: **0.585**
- Held-out impact 2-hop average Recall@5: **0.601**
- Δ (2-hop − 1-hop): **+1.62pp** (n=98 rows with non-empty 2-hop data)

Dev was +2.60pp. Both are well under the 15pp escalation threshold — the tool is NOT doing transitive expansion that would invalidate the 1-hop direct-callers-as-proxy ground truth.

## Findings that don't replicate (or anti-findings)

None. The "phrasings tie" finding holds on every held-out probe. The 0 family-override emission is invariant under the data split.

## Per-family family-conditioned override gate check on held-out

For each (family, relationship) pair in the held-out, the family-best phrasing equals the simple-global pick (P3) by tie-break. No override would fire under the 8pp delta gate even if we let it run on held-out. Consistent with dev.

## What this confirms for PHASE7 / GEPA

1. The recommendation surface for structural is **stable under data split**. PHASE7 §4.2 `[[structural]]` instruction_text need not be hedged or rotated across splits.
2. The 28%/44%/32% PASS rates (callers/callees/impact on dev) and 38%/38%/38% on held-out are **tool-quality numbers, not prompt-quality numbers** — improving them requires changes to `findCallers` SQL (exact-match preference), graph-coverage densification (especially C-family), or symbol-disambiguation, all of which are independent of prompt evolution.
3. The artifact (`recommendations-v2-structural.json`) ships dev-derived figures because dev is iteratable. Held-out figures live in this report only.

## Stage 4 stop-rule status (held-out)

- [x] No rubric flip on held-out (argmax under R@5 / P@5 / F1@5 all pick P3 — same as dev).
- [x] Impact 2-hop ≤ 15pp gap on held-out (+1.62pp; under threshold).
- [x] No language has held-out family-best beating simple-global by ≥ 8pp (phrasings tie).
- [x] Parser fires 390/390 held-out rows.

Sweep is complete. The structural redo is shippable as published.
