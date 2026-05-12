# Pre-registration: qshape-v2 (PHASE6_REDO — `ss-search` only)

**Campaign**: prompt-evolution-2026-05
**Run**: qshape-v2
**Author**: sweet-search core team
**Committed at**: 2026-05-12
**Tag**: prereg/qshape-v2
**Supersedes**: `preregistration.md` (qshape-v1) for the `ss-search` shape claim space only

> Plan reference: `docs/PHASE6_REDO.md`. This pre-registration narrows the
> Phase 6 work to a single tool (`ss-search`) on the 18-language AST-tester
> probe set. The other three tools (`ss-find`, `ss-semantic`, `structural`)
> are addressed by separate Phase 6 redoes when their probe-authoring
> rubrics stabilise (PHASE6_REDO.md §12.1).
>
> Discipline: any deviation from this plan after the sweep starts is
> exploratory and MUST be labelled as such in `recommendations-v2.json`.

---

## 1. Scope

| Element | Value |
|---|---|
| Tool | `ss-search` only |
| Probe set | `eval/ast-tester-probes/gold/<lang>.json` for the 18 covered languages + `eval/ast-tester-probes/gold/doc-positive.json` (68 probes) |
| Excluded | `swift` (in `eval/ast-tester-probes/splits/manifest.json` but not enumerated in PHASE6_REDO §4 — no assigned family) |
| Variants | K=7 per AST-tester gold (V1-V7); K=3 per doc-positive gold (V3/V5/V6 only) per PHASE6_REDO §5.1 |
| Total variants | 144 × 7 + 68 × 3 = **1,212** (down from the obsolete 1,484 cited in earlier drafts) |
| Authoring model | DeepSeek V4-Flash (model id `deepseek-v4-flash`) — non-reasoning, direct API per PHASE6_REDO §5.5.4 |
| Sweep tool | Deterministic Track A on `SweetSearch.search(query, { format:'agent', k:5, graphExpand:'2hop', adaptiveHop2:true })` |

Track B (agent-in-loop) is **deferred**, scoped to ≤ 24 (gold, shape) pairs if it runs, cost cap $80, judged via Gemini 3 Flash + GPT-5.5 (NOT DeepSeek — judge must be disjoint from authoring entity per PHASE6_REDO §5.4).

---

## 2. Dev / Held-out split

| Item | Value |
|---|---|
| Method | Stratified random shuffle within each language pack |
| Seed | **42** |
| Existing source | `eval/ast-tester-probes/splits/manifest.json` (per CLAUDE.md "Benchmark Methodology") |
| Dev count (per language) | 5 of 8 |
| Held-out count (per language) | 3 of 8 |
| Held-out per family (pooled) | 6-12 |
| Discipline | Per-query held-out inspection is FORBIDDEN during dev. Aggregate-only at milestones; Thresholdout oracle for ≤ 1 candidate-shape query per (family, shape) decision. |

Per-language claims at n=3 held-out are descriptive-only. Promotion-eligible claims are at the family level (PHASE6_REDO §3.1).

---

## 3. Language families (PHASE6_REDO §4)

| Family | Languages | n AST-tester probes | Weight pool (Σ tier weights) |
|---|---|---|---|
| **OO-monolithic** | java, csharp, kotlin, scala | 32 | 3+2+2+1 = 8 |
| **Systems-modular-terse** | rust, go | 16 | 3+2 = 5 |
| **C-family** | c, cpp, zig | 24 | 2+2+1 = 5 |
| **JS-mobile** | javascript, typescript, typescript-lib, dart | 32 | 3+3+2+2 = 10 (typescript-lib is a probe-pack alias; weight tier follows typescript) |
| **Scripting-dynamic** | python, ruby, php, lua, elixir | 40 | 3+2+2+1+1 = 9 |

Total 18 languages × 8 probes = 144 AST-tester + 68 doc-positive = 212 probes.

The mapping is committed at `core/prompt-optimization/data/query-shapes/family-map.mjs` — **single source of truth** for the sweep scripts AND for PHASE7 T_i runtime family detection.

---

## 4. Shape grid (PHASE6_REDO §5)

| ID | Shape label | Length | Symbol | Framing | Density |
|---|---|---|---|---|---|
| V1 | very-short+with-symbol+narrow-regex+imperative+high-density | ≤ 3 | yes | imperative | high |
| V2 | short+with-symbol+narrow-regex+interrogative+high-density | 4-8 | yes | interrogative | high |
| V3 | short+without-symbol+medium-regex+declarative+high-density | 9-15 | no | declarative | high |
| V4 | medium+with-symbol+medium-regex+interrogative+high-density | 9-15 | yes | interrogative | high |
| V5 | medium+without-symbol+broad-regex+interrogative+low-density | 9-15 | no | interrogative | low |
| V6 | long-NL+without-symbol+broad-regex+interrogative+low-density | ≥ 16 | no | interrogative | low |
| V7 | medium+with-symbol+narrow-regex+declarative+high-density | 9-15 | yes | declarative | high |

V7 is the descriptive-with-symbol cell added per PHASE6_REDO §5; it matches the existing AST-tester probe phrasing ("X struct that does Y") that V4 (interrogative) does not cover.

Length tier bound is **whitespace-split tokens**, not BPE.

For-doc-positive golds: eligibleShapes = [V3, V5, V6] only (§5.1 scope rule). V1/V2/V4/V7 are semantically ill-defined for a non-code gold and are skipped.

---

## 5. Popularity weights (PHASE6_REDO §7)

Three tiers, multiplicative at the per-language-mean → weighted-aggregate step.

| Tier | Weight | Languages |
|---|---|---|
| Tier-1 | 3 | javascript, typescript, python, rust, java |
| Tier-2 | 2 | typescript-lib, csharp, cpp, go, kotlin, ruby, php, c, dart |
| Tier-3 | 1 | scala, lua, elixir, zig |

Aggregations reported side-by-side: **macro-average** (uniform across 18 languages) AND **weighted-aggregate** (Tier weights). The decision rule (§6 below) uses weighted-aggregate for the global default and uniform-within-family for family overrides.

Weights are pre-registered BEFORE the sweep; the macro vs weighted split is reported transparently in `recommendations-v2.json` regardless of which one chooses the winner, so downstream consumers can re-weight.

---

## 6. Decision rules (PHASE6_REDO §8)

### 6.1 Global default — §8.1

A shape `S_default` is promoted iff:
- (a) wins the weighted-aggregate `file_recall@1` across all 18 languages
- (b) within 3pp of the family-best shape for every family
- (c) per-family `recall@1` not more than 5pp below any family's family-best
- (d) at least one family's cell for this shape survives BH-FDR at q=0.10 across the 35-cell space (5 families × 7 shapes)

### 6.2 Family override — §8.2

A shape `S_override(F)` is promoted as a per-family override for family `F` iff:
- (a) beats `S_default` on family `F` macro-average `file_recall@1` by ≥ 8pp
- (b) does not regress any OTHER family by > 3pp vs `S_default`
- (c) ≥ 2 languages within `F` show consistent direction (no Simpson reversal)
- (d) survives BH-FDR at q=0.10 in the 35-cell space

### 6.3 Tie / no-winner — §8.3

If no shape satisfies §6.1, the artifact reports `default: null, family_overrides: {}` and Phase 7 receives a **negative** recommendation: "no shape preference detected; T_i variants rely on internal routing logic, not shape instruction".

This is a real possible outcome — pre-registered so we don't reach for a winner that's not there.

---

## 7. Promotion gates (PHASE6_REDO §9)

Every promoted shape (default OR family override) must pass ALL five gates:

| Gate | Criterion | Source of truth |
|---|---|---|
| **G1: BH-FDR** | q=0.10 across 7-shape × 5-family = 35-cell space; paired permutation p-value vs §5.5.8 baseline (gold's original AST-tester `query` field) | `aggregate-track-a.mjs` (10K permutations, seed=42) |
| **G2: Thresholdout** | Per SYSTEM_PROMPT_OPT_PLAN.md §11.4.2. Each candidate consumes 1 of ≤ 30 Thresholdout queries from the campaign budget; promote only if oracle returns AGREE or DIFFER-in-candidate's-favour. | `core/prompt-optimization/...promote.mjs`; budget tracker at `core/prompt-optimization/data/thresholdout-budget.json` |
| **G3: Token-overlap leakage** | Zero non-whitelist ≥ 3-grams from Dev probe symbols/paths/queries appear in the candidate `instruction_text` | `aggregate-track-a.mjs:checkLeakage`; whitelist at `core/prompt-optimization/data/query-shapes/leakage-whitelist.json` |
| **G4: Independent-author check** | `instruction_text` reviewed by **Codex** (parallel-collaborator session — disjoint from gold author `sweet-search-core` AND variant author DeepSeek) | Manual; user pastes candidate texts into a fresh Codex session and records `independent_author_review: { reviewer, verdict, note }` back into `recommendations-v2.json` before the artifact is unsealed |
| **G5: Per-language stability within family** | For a family override, worst-language `recall@1` within the family must be ≥ 0.6 × best-language's | `aggregate-track-a.mjs:checkIntrafamilyStability` |

**Doc-negative regression check** (PHASE6_REDO §3 + §9): independent of G1-G5, a shape is auto-rejected if it converts any currently-PASSing doc-negative probe to FAIL. Asymmetric: we never trade demotion correctness for shape gain.

A shape that's statistically significant in isolation but fails BH-FDR is logged under `not_promoted_due_to_fdr` for transparency; its `instruction_text` is NOT baked into Phase 7.

---

## 8. Pre-registered expectations (FOR ERROR-ANALYSIS USE ONLY)

These are the team's prior expectations, committed BEFORE the sweep runs.
They are NOT used to filter or weight results; they exist so the
`recommendations-v2.json:preregistration_diff` field can report where the
data falsified intuition without confirmation-bias toward the prior.

| Item | Pre-registered expectation |
|---|---|
| Default shape | **V2** (`short+with-symbol+narrow-regex+interrogative+high-density`) |
| OO-monolithic override | V4 (verbose Javadoc/KDoc/XML doc-comments reward descriptive interrogative queries) |
| Scripting-dynamic override | V7 (narrative docstrings reward declarative-NL forms) |
| Systems-modular-terse override | none (V2 default wins) |
| C-family override | none (V2 default wins) |
| JS-mobile override | none (V2 default wins) |

If `actual_default != V2` OR `actual_overrides != predicted_overrides` for ≥ 2 families, the lessons paragraph in `recommendations-v2.json` MUST diagnose what intuition was wrong about — do not rationalise the prior.

---

## 9. Statistical tests

- Track A: paired permutation test, 10K iterations, seed=42, two-sided, on per-(family, shape) `file_recall@1` against the §5.5.8 baseline (gold's original probe phrasing). Implementation: `core/prompt-optimization/stats/paired-permutation.mjs`.
- Track A: paired bootstrap 95% CI on absolute deltas, 10K iter, seed=42.
- BH-FDR at q=0.10 across the 35-cell shape × family claim space. Implementation: `core/prompt-optimization/stats/bh-fdr.mjs`.
- Cells with < 5 paired observations are excluded from BH-FDR (matches the existing `recommendations.json` convention) and reported descriptively only.
- Minimum-detectable effect (MDE): at family-pooled n=16-40 dev probes × 7 shapes, σ ≈ 4-5pp, α=0.05, β=0.2 → MDE ≈ 8-12pp. We refuse to claim family overrides below 8pp (matches §6.2 gate (a)).

---

## 10. Authoring infrastructure pin

| Component | Path | Notes |
|---|---|---|
| Preprocess | `core/prompt-optimization/scripts/preprocess.mjs` | reads AST-tester + doc-positive gold; writes `inputs/<lang>-<probe-id>.json` per PHASE6_REDO §5.5.2 |
| LLM client | `core/prompt-optimization/scripts/deepseek-client.mjs` | direct DeepSeek HTTP; `deepseek-v4-flash` model, response_format json_object, seed=42, temperature=0.3, max_tokens=512 |
| Variant authoring | `core/prompt-optimization/scripts/author-variants.mjs` | iterates `eligibleShapes`; max 2 validator retries per (input, shape); concurrency 20-30 |
| Validator | `core/prompt-optimization/scripts/validator.mjs` | six checks per §5.3 + §5.5.6 path-token rules |
| Track A runner | `core/prompt-optimization/scripts/track-a-runner.mjs` | mirrors `eval/retrieval-probes/run-probes.mjs:140-145` SweetSearch surface |
| Aggregator | `core/prompt-optimization/scripts/aggregate-track-a.mjs` | paired permutation + BH-FDR + §8 promotion + §9 G1/G3/G5; emits `recommendations-v2.json` |
| Family map | `core/prompt-optimization/data/query-shapes/family-map.mjs` | extension/language → family — SAME mapping consumed by PHASE7 at agent runtime |
| Leakage whitelist | `core/prompt-optimization/data/query-shapes/leakage-whitelist.json` | language + framework + cell-label tokens only; additions require documented PR |

Mandatory preflight before unlocking the sweep: `curl -s -H "Authorization: Bearer $DEEPSEEK_API_KEY" https://api.deepseek.com/v1/models | jq '.data[].id'` must include `deepseek-v4-flash`. The author-variants script exposes a `--preflight` mode that performs this check.

---

## 11. Reproducibility manifest

- `eval/ast-tester-probes/repos.json` — pinned repo SHAs (LOCKED)
- `eval/ast-tester-probes/gold/<lang>.json` — 144 AST-tester probes (8 per language × 18 covered languages)
- `eval/ast-tester-probes/gold/doc-positive.json` — 68 doc-positive probes
- `eval/ast-tester-probes/splits/manifest.json` — seed=42 dev/held-out split
- `core/prompt-optimization/data/query-shapes/inputs/<lang>-<probe-id>.json` — preprocess output (regenerable)
- `core/prompt-optimization/data/query-shapes/variants/<lang>-<probe-id>-<shape>.json` — authored variants (regenerable; outputSha256 for drift detection)
- `core/prompt-optimization/data/query-shapes/tracks/track-a-<runId>.jsonl` — per-(gold, shape) sweep rows
- `core/prompt-optimization/data/query-shapes/recommendations-v2.json` — final artifact

End-to-end wall time after the §13 step-3 baseline is locked: ~12-20 min for variant authoring + ~5 min for Track A sweep = **~17-25 min** for the `ss-search` redo.

---

## 12. Stop rules

Per PHASE6_REDO.md §14 risk 5 + SYSTEM_PROMPT_OPT_PLAN §13.7 P6.* stop table:

- Halt the variant authoring if the §13 step-5 spot-check shows < 70% V5/V6 paraphrase quality; fall back to manual authoring of 144 × 3 + 68 × 3 = 636 without-symbol variants, OR drop to the 4-shape reduced grid (V1/V2/V4/V7, AST-tester only).
- Halt the Track A sweep if best-shape `recall@1` < 0.5 across all families (the variant grid is misframed; reauthor variants).
- Halt at hard budget cap of **$5 marginal API spend** for variant authoring (DeepSeek direct API, ~$0.25 expected — Track B is gated separately at ≤ $80).
- Halt if Thresholdout 30-query allocation is exhausted before all candidate shapes have been queried.

---

## 13. Pre-committed analysis decisions

- If `actual_default = null` (§6.3 tie path), do NOT promote any shape; Phase 7 receives the negative recommendation. Log under `recommendations-v2.json:default = null` with the reason in `promotion_note`.
- If a family override survives §6.2 but fails G5 (intrafamily stability), log under `not_promoted_due_to_intrafamily_instability` and ship the per-language descriptive table for that family instead.
- If the leakage gate (G3) trips on the final `instruction_text`, hard-block ship and re-author; do NOT widen the whitelist.
- If Codex review (G4) returns "rejected" with the diagnosis "leaks gold-specific knowledge", treat as a G3 failure regardless of the n-gram check verdict — Codex sees what the static gate may miss.
- If `predicted_default != actual_default`, write a paragraph in `lessons` rather than rationalising the prior.

---

## 14. Relationship to existing artifacts

- **Supersedes**: SYSTEM_PROMPT_OPT_PLAN.md Part 7 (Query-Shape Discovery) for the `ss-search` shape claim space.
- **Feeds**: docs/PHASE7.md §4.1 / §4.2 / §4.3 — the family-conditioned `instruction_text[family]` becomes the load-bearing input to T1-T15 variant bodies.
- **Compatible with**: SYSTEM_PROMPT_OPT_PLAN.md §0.5 dual-layer overfit-control framework — all five gates of §7 are subsumed under that framework.
- **Out of scope but planned**: separate Phase 6 redoes for `ss-find`, `ss-semantic`, `structural` (PHASE6_REDO §12.1).
