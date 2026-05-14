# Pre-PHASE7 baseline snapshot

**Locked at**: 2026-05-14 (commit `77fb437`)
**Frozen by tag**: `prereg/p7-v1-pre-probe`
**Purpose**: the "before" reference every PHASE7 milestone compares against. Do NOT regenerate during the GEPA run — this file is committed and never edited.

---

## §1 Per-tool recommendation-v2 artifact SHAs

| Artifact | Path | Blob SHA at `77fb437` |
|---|---|---|
| ss-search | `core/prompt-optimization/data/query-shapes/recommendations-v2.json` | `97a714e9c9acb48adc0bed553df7fe4d20ff26a4` |
| ss-find | `core/prompt-optimization/data/query-shapes/recommendations-v2-ss-find.json` | `126e7641ca547df8c938a74d0c8ab6beda3ea484` |
| ss-semantic | `core/prompt-optimization/data/query-shapes/recommendations-v2-ss-semantic.json` | `5a3958cb47ac4cff7b26905a7ebfec63fb3c3cb8` |
| ss-trace | `core/prompt-optimization/data/query-shapes/recommendations-v2-ss-trace.json` | `79c9b5a5941f2e89eea6a677496f0d1c03cd4f68` |

Verify with `git rev-parse 77fb437:<path>`.

## §2 Per-tool headline metrics (from each artifact's `simple_global` / `default`)

These are the baseline `instruction_text` numbers shipped at PHASE6_REDO. PHASE7 GEPA's win condition is to evolve a single unified agent prompt whose Maximin task score (`min(score_sonnet, score_gpt5.5)` per probe, weighted-mean across dev) **does not regress** these per-tool primary metrics, and ideally improves the user-facing joint score.

| Tool | Primary metric | Cell / shape | Headline value | n | Source |
|---|---|---|---|---|---|
| ss-search | `symbolRecallAt1` (macro) | V7 (medium + symbol + declarative) | `weighted=0.5125`, `macro=0.5404` | 144 ast-tester golds | `recommendations-v2.json:default` |
| ss-find | `symbolRecallAt1` | R2 × Q3 (word-bounded literal × short imperative + symbol) | `symbol_recall_at_1=0.6503`, `file_recall_at_1=0.8182` | 144 ast-tester golds | `recommendations-v2-ss-find.json:strategies.simple_global` |
| ss-semantic | `top1_iou` | V1 (very-short + symbol + imperative) | `iou_score=0.3315` | 144 ast-tester golds | `recommendations-v2-ss-semantic.json:strategies.simple_global` |
| ss-trace | `recall_at_5` | canonical options (`maxDepth=3, k=5`) | callers `0.7145`, callees `0.9447`, impact `0.5464` | 105 dev probes | `recommendations-v2-ss-trace.json:strategies.simple_global.by_relationship_type` |

**Secondary metrics** (per `feedback_heldout_discipline_strict` + the cross-tool meta-finding in `project_gold_rubric_under_credits_correct_behavior.md`): each artifact ALSO publishes a `secondary_metrics` block with at least `relaxed_def_recall_at_1` and `file_recall_at_5` (ss-search, ss-find), IoU re-grading (ss-semantic), and `production_recall_at_5` (ss-trace). PHASE7 evaluators that touch tool-level rubrics must NEVER score strict alone; they must always credit the secondary side-by-side.

## §3 Locked retrieval-probes (post-perf-60)

| Field | Value |
|---|---|
| Path | `eval/retrieval-probes/post-perf-60.json` |
| n probes | 60 |
| PASS / PARTIAL / FAIL | `46 / 4 / 10` |
| Locked at | commit `b965435` (fix(ranking): preserve leading $ in extractIdentifierMentions) |

## §4 Locked benchmark numbers (CLAUDE.md methodology)

| Benchmark | Value | Notes |
|---|---|---|
| GCSN MRR@10 (heldout, dev) | `86.93%` | 6000-query GenCodeSearchNet, 60/40 stratified split, seed=42; locked since pre-Phase 6 |
| Stratified split | seed=42 | 60% dev / 40% held-out; per CLAUDE.md `Benchmark Methodology` |

## §5 Unit test counts (pre-PHASE7 green state)

| Test area | Path | Count |
|---|---|---|
| Ranking | `tests/ranking/` | 347 passed |
| Search | `tests/search/` | 823 passed (5 skipped) |
| Prompt-optimization | `tests/unit/prompt-optimization/` | 292 passed |
| **Total** | — | **1462 passed (5 skipped)** |

Re-verify with `npx vitest run tests/ranking tests/search tests/unit/prompt-optimization`.

## §6 Per-tool failure-analysis program completion

| Tool | Program-complete commit | Memory pin | Headline aggregates (dev / heldout) |
|---|---|---|---|
| ss-search | `b965435` (fix(ranking): preserve leading $) + `53aa935` (failure-analysis audit scripts) | [[project_ss_search_failure_analysis_2026_05_14]] | dev 55/18/17; heldout 28/18/8 |
| ss-find | (PHASE6_REDO ss-find session) | [[project_ssfind_phase6_v2_audit_2026_05_13]] | see artifact `recommendations-v2-ss-find.json` |
| ss-semantic | (PHASE6_REDO ss-semantic Stage 0+0.5+1A+2+3) | [[project_sssemantic_phase6_v2_stage0_2026_05_13]] | dev 31/48/11 (post-Stage 0 fixes) |
| ss-trace | `d70259b` | [[project_ss_trace_phase6_redo_complete_2026_05_14]] | callers heldout R@5=0.81, callees 0.94, impact 0.75 production-only |

## §7 Pre-PHASE7 housekeeping commits (this session)

| Commit | Subject |
|---|---|
| `8ded4bc` | fix(prompt-opt): isolate sweep.test.js output from canonical recommendations.json |
| `2937079` | docs(phase7): regenerate §4.2 ss-trace bullet from recommendations-v2-ss-trace.json |
| `47fde08` | chore(recs): align ss-trace family taxonomy to canonical Scripting-dynamic |
| `77fb437` | docs(phase7): pre-flight prereg audit — schema divergence, probe status, baseline ref |
| (next) | (this baseline snapshot artifact + closeout commit) |

## §8 Known open issues at lock time (informational; not blockers for PHASE7 tag)

1. **ss-search schema divergence** — `recommendations-v2.json` ships a flat top-level `{default, family_overrides, popular_weighted}` while the other three artifacts use a nested `{strategies: {simple_global, family_conditioned, popular_weighted_agentic}}`. PHASE7 consumer code must abstract on read. Schema migration deferred to a focused session post-PHASE7.

2. **Probe records NOT yet authored** — `p7-dev-probes.json`, `frozen/p7-heldout-probes.json`, `p7-rotation-pool.json`, `frozen/p7-adversarial-counter-probes.json` are spec'd in PHASE7.md §5.1–§5.7 but not written. Authoring is the gating workstream before moving `prereg/p7-v1-pre-probe` → `prereg/p7-v1`.

3. **API keys for PHASE7 targets/reflector/judges** — current `~/.zshrc` exports:
    - `GEMINI_API_KEY` ✓ (200 OK)
    - `DEEPSEEK_API_KEY` ✓ (200 OK)
    - `OPENAI_API_KEY` ✗ (missing — needed for GPT-5.5 Target B per §2.1)
    - `MOONSHOT_API_KEY` ✗ (missing — needed for Kimi K2.6 reflector + merge synthesizer)
    - `MINIMAX_API_KEY` ✗ (missing — needed for MiniMax M2.7 Judge 3)
    Three keys must be added before launching GEPA round 1.

4. **Stale Gemini preview model refs in P6-era config files** — `core/prompt-optimization/data/run-config.toml`, `manifest.json`, `judge-prompts/disjoint-panel.toml` all reference `gemini-3-flash-preview`. PHASE7.md §2.1 correctly specifies `Gemini-3.1-Flash-Lite` (GA) per `feedback_gemini_preview_throttling`. These P6 configs are not consumed by PHASE7's GEPA flow, but the stale refs are an audit liability — clean up at PHASE7 launch time.

---

**Discipline**: this snapshot freezes the state at commit `77fb437`. Any future PHASE7 milestone delta is computed against THIS file's numbers, not against re-measurements. If any number above is found to be wrong, fix the underlying issue and re-tag — don't edit the snapshot in-place.
