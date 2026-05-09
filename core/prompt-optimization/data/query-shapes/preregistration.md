# Pre-registration: qshape-v1

**Campaign**: prompt-evolution-2026-05
**Run**: qshape-v1
**Author**: sweet-search core team
**Committed at**: 2026-05-09T00:00:00Z
**Tag**: prereg/qshape-v1

> Plan reference: `docs/SYSTEM_PROMPT_OPT_PLAN.md` Part 7 (Query-Shape Discovery — FOUNDATIONAL,
> precedes Part 6) and §0.5 dual-layer overfit-control framework. This pre-registration is the
> single most important artifact in the campaign — Part 7's findings seed every subsequent
> step (Part 6, 8, 10). Any deviation from this plan after the run starts is exploratory and
> labelled as such in the recommendations artifact.

## Primary metric

For each tool × shape cell, **`agent_e2e_success`** (Track B end-to-end PASS rate, judged by
the disjoint-family panel per §11.6) is the headline. Track A's deterministic
`file_recall@1` is the cheap proxy used for sample-size planning and stratification, but the
authoritative claim is the agent-in-loop result.

## Reporting metric (NOT optimisation target)

`shipping_score` = mean(`agent_e2e_success` | Opus 4.7 + GPT-5.5 + Gemini 3.1 Pro), reported
only at the §7.6 promotion gate. The Track B sweep itself runs on Sonnet 4.6 for breadth;
Opus 4.7 replays a pre-registered subsample of the top shapes before §7.6 freezes
`recommendations.json`.

## Hypothesis

For tools whose query has a semantic / NL component, **a short keyword query that includes
the gold symbol when known beats long natural-language paraphrase** for `ss-find` and
`ss-search`; **a question-form NL paraphrase beats keyword form** for `ss-semantic` (single-
file scope where the agent already has the file path); **structural mode** prefers a
relationship verb plus the symbol over a bare NL question. Each prediction is logged
per-gold in `golds.json:predicted_winning_tool` / `predicted_winning_shape`.

## Secondary metrics

- file recall @1 / @3 / @5, symbol recall @1, gold-line overlap (where line ranges are gold)
- returned-token count (mean), follow-up-read need (Boolean per probe)
- per-stratum PASS deltas across the four query-type bands (literal-lookup / behavioral /
  structural / multi-file-flow)
- per-stratum PASS deltas across language (JS / Go / Python / Rust)
- judge IAA: Krippendorff α across the disjoint-family panel + adversarial judge
- threshold-sensitivity rank stability (§11.10) on Track A metrics

## Tools in scope

| Tool | Semantic component | In scope? | Sweep regex anchor too? |
|---|---|---|---|
| `ss-search` (sweet-search auto/hybrid) | NL query | yes | n/a |
| `ss-find` (ColGrep / patternSearch) | NL query + regex anchor | yes | yes |
| `ss-semantic` (read-semantic) | NL question scoped to ONE file | yes | n/a |
| structural mode (`ss-search --mode hybrid` + relationship word) | NL query + relationship word | yes | n/a |
| `ss-grep` (indexed bare grep) | literal regex only | no — measured as side analysis only | n/a |
| `ss-read` (exact range) | no query | no | n/a |
| `files` (path discovery) | glob | no | n/a |

`ss-grep` regex specificity is reported as a separate side analysis but is **not** part of
the shape claim space (it's a regex-engineering finding, not an instructable shape).

## Agent-instructable shape grid

| Dimension | Levels | Tool applicability |
|---|---|---|
| **Length tier** | very-short (≤3 tokens), short (4–8), medium (9–15), long-NL (16+) | all |
| **Symbol presence** | with-symbol, without-symbol | all |
| **Intent verb** | present ("how does X work", "find X", "where is X defined"), absent (noun phrase) | all |
| **Q framing** | declarative noun-phrase, interrogative ("how/where/what"), imperative ("find/show/trace") | all |
| **Domain-term density** | high (multiple domain identifiers), low (generic terms) | all |
| **Regex anchor breadth** | narrow (1 literal), medium (2–3 alternation), broad (5+ alternation) | `ss-find` only |

We **do not** test the full 4×2×2×3×2×3 = 288 cells. We sample K=6 variants per gold along
the orthogonal main-effects grid; the cell labels (e.g. `short+with-symbol+narrow-regex`)
are written into `variants.json:shape` per variant.

## Probe-set construction (§7.3)

| Set | Repos | Goldsize | Variants per gold | Total |
|---|---|---|---|---|
| **Q-shape dev** | fastify, gin, ripgrep, flask, vercel/ai-chatbot | 12 × 5 = 60 | 6 | ~1,080 query-tool pairs |
| **Q-shape held-out** | uv (post-cutoff, FreshStack discipline) | 30 | 6 | ~540 query-tool pairs |

`vercel/ai-chatbot` was added 2026-05-09 to close the TS / React / component-search shape
gap that the four prior backend / CLI repos leave open. Of its 12 golds, ≥6 must be
component- or hook-shaped (`useFoo`, `<Component>`, route-handler-by-path) so the new
repo stresses TS/React shape coverage rather than redundantly testing function-name
lookup. Per §7.6 gate-5 we additionally require per-repo cross-shape stability — see
"Promotion gates" below.

Pinned commits (single source of truth: `eval/read-workflows/repo-manifest.json` for dev,
`core/prompt-optimization/data/manifest.json:freshstack` for uv):

| Repo | Commit |
|---|---|
| fastify | `39f0f24233cf6da2fef48551f51be2f589f7d5d0` |
| gin | `d3ffc9985281dcf4d3bef604cce4e662b1a327a6` |
| flask | `7ef2946fb5151b745df30201b8c27790cac53875` |
| ripgrep | `4519153e5e461527f4bca45b042fff45c4ec6fb9` |
| ai-chatbot (vercel/ai-chatbot) | `107a43a8039bb4f19d0ced4ff3445e2523d14305` |
| uv | `bb8109a3c4e57b76acaa319981911e68f4098aa6` |

### Tool-affinity prediction — pre-registered before sweep

Every gold record in `golds.json` carries `predicted_winning_tool` and
`predicted_winning_shape`. This pre-registered prediction is the **dev-only error analysis
input**: at the end of the sweep we measure where intuition was wrong (`actual_winner ≠
predicted_winner`), we do **not** confirm-bias toward the intuition. The
`recommendations.json:preregistration_diff` field reports the per-gold delta.

#### Predicted-shape vocabulary (alias-aware)

The `predicted_winning_shape` strings use a coarse vocabulary scoped to the four
agent-instructable dimensions the prereg author can reason about ahead of the sweep:

| Coarse token | Variant tokens it aliases to |
|---|---|
| `short` | `short`, `very-short` |
| `medium` | `medium` |
| `long` | `long-NL` |
| `with-symbol` / `without-symbol` | identical |
| `narrow-regex` / `medium-regex` / `broad-regex` | identical |

The variant grid carries the finer tier (`very-short` / `short` / `medium` / `long-NL`).
`promote.mjs:preregistration_diff` reports BOTH the strict `exact_token_match` flag (every
predicted token literally in the actual variant label) AND the alias-aware `alias_match`
flag using the table above; the alias-aware count is the primary signal.

### Stratification (3:3:3:3 within each repo's 12 dev golds)

| Query type | Per-repo count |
|---|---|
| literal-lookup (config/symbol lookup, exact phrase) | 3 |
| behavioral (function logic, dispatch) | 3 |
| structural (data structure, type relationship) | 3 |
| multi-file-flow (lifecycle, cross-file dispatch) | 3 |

`taskType` field in the existing `eval/agent-read-workflows/tasks.js` schema maps to the
strata directly. For ai-chatbot (added 2026-05-09) the 12 golds also satisfy a shape-
balance constraint: ≥6 must be component- or hook-shaped — concretely, the current set
ships 3 hook-shaped (`useArtifact`, `useChatVisibility`, `useAutoResume`), 3 component-
shaped (`<ChatHeader>`, `<VisibilitySelector>`, `<MultimodalInput>`), and 1 hybrid
multi-file flow that crosses both surfaces.

### Independent-author check

Variants are authored by an engineer who is **not** the primary author of the gold tasks for
that tool's sweep, per §11.2 probe-author-independence and §7.6 four-gate promotion #4.
Provenance is recorded in `variants.json:authoredBy` and `golds.json:goldAuthoredBy`.

## Claim-space enumeration (§11.4.1) — required for BH-FDR

| Claim space | Implicit comparisons | BH-FDR q |
|---|---|---|
| Layer A shape × tool grid (this run) | ≈ 12 shape cells × 4 tools = 48 (cap 72) | 0.10 |
| Track A regex-anchor side-analysis (`ss-find` only) | 3 anchor × 4 strata = 12 | 0.10 |
| Per-stratum × shape interaction tests | 4 strata × ≤6 shapes = 24 | 0.10 |
| Tool-affinity prereg-vs-actual delta tally | per-gold; not multiple-comparison-controlled (descriptive) | n/a |

Apply BH-FDR per claim space — never compound across claim spaces.
`stats/bh-fdr.mjs:benjaminiHochberg` is the only legitimate computation site.

## Thresholdout query budget (§0.5.4) — required for Sealed-1 reads

This run is **inside the Q-shape held-out boundary** (uv 30-probe set), not the campaign-
wide Sealed-1. Per the §7.6 four-gate promotion criterion #2: **3 Thresholdout queries**
(one per in-scope tool: `ss-search`, `ss-find`, `ss-semantic`) drawn from the campaign-wide
`totalBudget=26` envelope per `data/manifest.json:thresholdout`. Allocation entry under
"Layer A `instruction_text` Thresholdout check (3 tools × 1)".

structural mode is queried using the same Sealed-1 envelope only if its winning shape is
genuinely distinct from `ss-search`'s; otherwise its recommendation defers to ss-search's
oracle decision (no extra budget).

Once consumed, no further Q-shape held-out reads are permitted at qshape-v1. A re-run
requires a NEW pre-registration tag.

## Statistical tests

- Track A: paired permutation test (10K iter, seed=42) on per-shape-cell mean
  `file_recall@1`, against the per-gold within-tool baseline (variant-1 ordered shape).
  (`core/prompt-optimization/stats/paired-permutation.mjs`)
- Track A: paired bootstrap 95% CI on absolute and relative deltas, 10K iter, seed=42.
  (`core/prompt-optimization/stats/bootstrap-ci.mjs`)
- Track B: paired permutation on `agent_e2e_success` per shape × tool cell, with
  per-stratum decomposition.
- Per-shape-cell BH-FDR at q=0.10 across the Layer A claim space (48 cells; capped 72).
- Plackett-Luce ranking with bootstrap CIs across the 6 shape variants per tool, with
  pairs failing BH-FDR reported as ties.
- **Minimum-detectable effect (MDE)** declared: at n=90 dev golds × 6 variants = 540
  Track A trials per tool × shape, σ ≈ 4.5pp, α=0.05, β=0.2 → MDE ≈ 5pp. We refuse to
  claim shape wins below MDE.

## Sample size justification

Track A: 90 golds × 6 variants × 4 tools = 2,160 deterministic trials. At per-tool-shape
n ≥ 15 dev golds per stratum, σ ≈ 4.5pp from May 2026 60-probe runs gives MDE ≈ 5pp at
α=0.05 / β=0.2.

Track B subsample: 20–25 golds (4–5 per dev repo across 5 repos; uv excluded by default
as held-out), 6 shapes, 4 tools ≈ 480–600 agent runs. At per-cell n ≥ 20, σ ≈ 6pp (judge
variance), MDE ≈ 7pp. The ai-chatbot subsample MUST include ≥1 component-search and ≥1
hook-search task per §13.7 P6.3.

The 30-probe uv held-out is below the §11.3 power requirement for primary publication
claims, so it serves Thresholdout confirmation only. Headline numbers are from the 60-gold
dev set.

## Judge panel (§11.6) — mandatory

Active 3-of-5 disjoint-family jury for Track B (reflector lineage forbidden; reflector for
this campaign is **DSv4-Pro** so DeepSeek/Qwen are forbidden in the active panel):

| Slot | Lineage | Model | Subscription |
|---|---|---|---|
| 1 | Anthropic | sonnet-4-6 (cheap-side judge) | Claude Max |
| 2 | OpenAI | gpt-5-5 | Codex Pro |
| 3 | Google | gemini-3-1-pro | Gemini Pro |

Reserve: Llama 4 / Mistral. Adversarial judge: Opus 4.7 with
`judge-prompts/adversarial-v1.md`.

IAA validation: ≥30-probe human-labelled subset prior to full sweep; Krippendorff α targets:
≥0.6 individual, ≥0.7 majority. Track B halts and falls back to humans-only on any metric
where α < 0.6 individual after one rubric rewrite (per §13.7 P6.3 stop rule).

## Threshold-sensitivity sweep (§11.10)

Track A `file_recall@1` is metric-stable (binary), but the agent-e2e PASS thresholds
(token-cap, fact-coverage, citation-presence) are tunable. We run the 27-cell fractional-
factorial at -20%/registered/+20% on:

1. Track A top-1 vs top-3 cutover for `follow_up_reads` count.
2. Track B fact-coverage threshold (default 0.7).
3. Track B token-cap (default per-tool budget).

Promotion criterion: rank-stability of the winning shape — median rank ≤ 3 AND 90% quantile
range ≤ 5 ranks. Shapes that win only at registered thresholds are logged
`proposal_class: threshold-game` and **not** promoted.

## MDL / prompt-length penalty (§11.10.4)

`instruction_text` strings authored at §7.6 promotion are penalised at λ = 0.0017 (a +500-
token bloat costs ~1pp dev score). At promotion, the top-3 candidate `instruction_text`
strings per tool are re-evaluated truncated to the median seed-instruction length; > 2pp
held-out drop after truncation rejects the bloated original.

## Held-out model panel (§11.11)

Q-shape findings are **not** subject to HOMP at this run. HOMP runs once at campaign end
across the full `recommendations.json` artifact baked into Layer B variants. The §0.5
control we satisfy here is the four-gate `recommendations.json` discipline.

## Token-overlap leakage gate (§11.9)

Hard reject any `instruction_text` whose ≥3-grams overlap Q-shape dev probe symbols, paths,
gold answers, or queries (`decontamination/leakage-gate.mjs`). Whitelist:
`decontamination/leakage-whitelist.txt` — DO NOT add repo-specific identifiers; if a
generic phrase trips the gate, audit the gold corpus, don't grow the whitelist.

Gate runs at:
1. Variant authoring (variants.json) — per-variant query string vs gold-query corpus.
2. `instruction_text` promotion (recommendations.json) — per-string vs full Q-shape dev
   gold corpus.
3. Final shipped Layer B seeds (T1–T14) — confirmed at P7.

## Promotion gates (§7.6)

A candidate "best shape" per tool must survive **all five** gates before its
`instruction_text` is baked into Layer B. Gates 1–4 were defined at qshape-v1 scaffolding;
gate 5 was added 2026-05-09 with vercel/ai-chatbot.

1. **BH-FDR at q=0.10** across the Layer A shape × tool claim space.
2. **Thresholdout** confirmation on Q-shape held-out (uv 30-probe set).
3. **Token-overlap leakage gate** on the candidate `instruction_text`.
4. **Independent-author check** — instruction author ≠ gold-task author.
5. **Per-repo cross-shape stability** — for the candidate, compute per-repo
   `recall@1` across the 5 dev repos (uv excluded; held-out). Reject promotion if
   either (a) worst-repo `recall@1` < 0.6 × best-repo `recall@1`, OR (b) ai-chatbot's
   `recall@1` is more than 2σ below the cross-repo mean. Failures recorded under
   `recommendations.json:not_promoted_due_to_repo_instability` with diagnosis
   (TS-only win / backend-only win / genuinely repo-confounded).

The artifact MUST include `per_repo_breakdown` (5 repos × `recall@1` + n) and a
`repo_stability_gate` field for every promoted shape, per §7.4 schema.

## Stop rules

Per docs/SYSTEM_PROMPT_OPT_PLAN.md §13.7 P6.\* stop table:

- **P6.0**: halt if < 50 distinct golds within 17h (scaled from <40/14h after
  ai-chatbot added a 5th repo) or missing tool-affinity preregs, or if < 6 of the 12
  ai-chatbot golds are component- or hook-shaped (per §7.3 stratification rule).
- **P6.2**: halt if best-shape `recall@1` < 0.5 across all 4 tools (variant grid is
  misframed; reauthor variants).
- **P6.3**: halt if judge IAA α < 0.5 even after one rubric rewrite (humans-only on the
  affected metric).
- Halt if Thresholdout 3-query allocation exhausted before all four gates pass for any
  candidate winner.
- Halt at hard budget cap of $5 marginal API spend for this run (Track B Sonnet via Claude
  Max → $0; only DSv4-Pro judge calls accrue marginal cost).

## Pre-committed analysis decisions

- If a shape wins Track A but loses Track B by > 8pp, attribute to **presentation, not
  retrieval**, and DO NOT promote. Log under `recommendations.json:not_promoted_due_to_e2e_drop`.
- If `predicted_winner ≠ actual_winner` for ≥ 1/3 of golds in any tool, write a paragraph
  in `recommendations.json:lessons` rather than rationalising the prediction.
- If the leakage gate trips on the final `instruction_text`, hard-block ship and re-author;
  do **not** widen the whitelist.
- If Thresholdout returns DIFFER unfavourably for the candidate winner of a tool, demote to
  `not_promoted_due_to_thresholdout` and re-run on the second-best candidate.
- If threshold-sensitivity median rank > 3 for the chosen winner, treat the win as a
  Goodhart artefact and re-run synthesis at lower λ.
- If a variant author and a gold author overlap, recuse the variant from the corresponding
  tool's sweep (not just flag — recuse).

## Decontamination plan

- N-gram leakage gate: 3-gram window against Q-shape dev probe corpus
  (`decontamination/leakage-gate.mjs`).
- Embedding filter: not applied at qshape-v1 (variants are hand-authored from a fixed grid;
  no auto-generation pass).
- Whitelist: `decontamination/leakage-whitelist.txt` — generic English / programming
  n-grams only. Repo-specific identifiers MUST trip the gate.
- Removed-items list: `core/prompt-optimization/data/contaminated/qshape-v1.json`.

## Reproducibility manifest

- `core/prompt-optimization/data/manifest.json` — pinned repo SHAs, Thresholdout config,
  judge panel config, leakage-gate config.
- `core/prompt-optimization/data/query-shapes/golds.json` — 90 hand-authored golds
  (60 dev + 30 held-out; pinned via repo commit hashes; line ranges fingerprinted at
  sweep run).
- `core/prompt-optimization/data/query-shapes/variants.json` — 6 shape variants per gold
  with shape-coordinate labels and authoredBy provenance.
- `core/prompt-optimization/data/results/qshape-v1/track-a.jsonl` — raw per-(gold,
  variant, tool) records.
- `core/prompt-optimization/data/results/qshape-v1/track-b.jsonl` — agent-in-loop traces
  + judge panel decisions.
- `core/prompt-optimization/data/results/qshape-v1/thresholdout-log.jsonl` — Sealed-1
  query log (shared with the campaign-wide budget tracker).
- `core/prompt-optimization/data/results/qshape-v1/bh-fdr-summary.json` — per-claim-space
  BH-FDR survival table.
- One-shot reproducer (planned at P6.2): `node core/prompt-optimization/sweep/track-a.mjs
  --run qshape-v1 --tool all`.
