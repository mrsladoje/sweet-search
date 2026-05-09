# Pre-registration: <run-id>

**Campaign**: <campaign-id>
**Run**: <run-id>
**Author**: <name>
**Committed at**: <iso-timestamp>
**Tag**: prereg/<run-id>

> Plan reference: `docs/SYSTEM_PROMPT_OPT_PLAN.md` §0.5 (dual-layer overfit-control framework),
> §11.4–11.11 (BEIR/CoIR-grade benchmark rigor). Updated 2026-05-09 to encode Thresholdout
> budget, BH-FDR claim space, disjoint-family judge panel, threshold-sensitivity sweep, HOMP,
> and leakage gate as **mandatory** sections.

## Primary metric (GEPA optimisation target)

<one sentence — `robustness_score = min(answerability)` over the cheap pool, on Dev tier
(`splits/dev_60.json`); Sealed-1 (`splits/heldout_40.json`) queried only via the Thresholdout
oracle, never raw.>

## Reporting metric (NOT optimisation target)

<one sentence — `shipping_score = mean(answerability | Opus 4.7 + GPT-5.5 + Gemini 3.1 Pro)`
at milestone gates only; `homp_min_pass` at campaign-end Vault gate via `run-homp.mjs`.>

## Hypothesis

<one sentence — e.g., "T9 (worked-examples-only) achieves higher robustness_score than T1
(question-shape router) on the cheap pool, with shipping_score regression ≤ 3pp.">

## Secondary metrics

- file recall, symbol recall, fact recall, line overlap, file precision
- **graded NDCG@10, MRR, MAP** (per §11.10.3 — required alongside binary PASS for sensitivity check)
- token cost (mean), tool-call count (median), prompt-length tokens
- per-stratum PASS deltas (language × query-type × repo-size)
- paired portability stats (`aux_median`, `aux_p25`, `aux_min`, `aux_min_four`) per §8.9.1

## Claim-space enumeration (§11.4.1) — required for BH-FDR

| Claim space | Implicit comparisons | BH-FDR q |
|---|---|---|
| Layer A shape grid (Part 7) | <e.g., 6 dims × 4 levels × 3 tools = 72 cells> | 0.10 |
| Layer B variant pairwise (14×14) | 91 | 0.10 |
| Layer B failure-mode tally (14×8) | 112 | 0.10 |
| Cross-harness regression (§9.3) | <e.g., 4 metrics × 5 harnesses = 20> | 0.10 |
| <add others> | <…> | 0.10 |

Apply BH-FDR per claim space — never compound across claim spaces.

## Thresholdout query budget (§0.5.4) — required for Sealed-1 reads

Total budget: **26** queries (under the ~30-query theoretical envelope at n=40, σ=0.03).
Allocation:

| Allocation | Budget |
|---|---|
| Layer A `instruction_text` Thresholdout check (3 tools × 1) | 3 |
| Layer B Phase A spike-test leader confirmation | 3 |
| Layer B GEPA generation milestones (every 25 generations) | 6 |
| Layer B uber-tree gates G1–G5 | 5 |
| §9.3 cross-harness promotion (1/harness × 4) | 4 |
| Reserve for re-runs after rejected synthesis | 5 |
| **Total** | **26** |

Once consumed, no further Sealed-1 reads are permitted. Subsequent gates run on Dev only or
escalate to Vault (which terminates the campaign).

## Statistical tests

- Paired permutation test, 10K iterations, seed=42, on PASS rate
  (`core/prompt-optimization/stats/paired-permutation.mjs`)
- Paired bootstrap 95% CI, 10K iterations, seed=42, on absolute and relative deltas
  (`core/prompt-optimization/stats/bootstrap-ci.mjs`)
- Per-stratum Cliff's δ (computed inline; report magnitude bands ≤0.147 negligible /
  ≤0.33 small / ≤0.474 medium / >0.474 large per Romano 2006)
- **Multiple-comparison correction: BH-FDR at q=0.10** per claim space (§11.4.3)
  (`core/prompt-optimization/stats/bh-fdr.mjs`) — replaces Bonferroni/Holm at our scale
- **Minimum-detectable effect (MDE)** declared: <e.g., "6pp PASS at n=40, σ ≈ 4.5pp,
  α=0.05, β=0.2"; refuse to claim wins below MDE>
- Variant ranking (when comparing ≥3 variants): Plackett-Luce with bootstrap CIs
  (`core/prompt-optimization/stats/plackett-luce.mjs`); pairs that fail BH-FDR are reported
  as ties even if PL worth parameters disagree

## Sample size justification

<paragraph — power analysis with assumed variance σ ≈ 4.5pp from May 2026 60-probe runs.
At n=40 (Sealed-1) the MDE for 5pp at α=0.05/β=0.2 is barely met; report MDE explicitly. The
60-dev / 40-heldout / 30-freshstack split is internally sufficient with §0.5 controls; the
30-50-probe Vault Tier-3b on bun/deno/zig is required for any external publication claim.>

## Judge panel (§11.6) — mandatory

Active 3-of-5 jury (reflector lineage forbidden):

| Slot | Lineage | Model | Subscription |
|---|---|---|---|
| 1 | Google | gemini-3-flash-preview | Pay-per-use ($0.15/$0.60 per 1M) |
| 2 | OpenAI | gpt-5-5 | Codex Pro |
| 3 | Google | gemini-3-1-pro | Gemini Pro |

Reserve: <Llama 4 / Qwen / Mistral>. Reflector forbidden lineage: <e.g., DeepSeek/Qwen if
DSv4-Pro is reflector>.

Adversarial judge: <e.g., Opus 4.7 with `judge-prompts/adversarial-v1.md`>.

IAA validation: ≥100-probe human-labeled set at campaign-start / midpoint / campaign-end.
Krippendorff α targets: ≥0.6 individual, ≥0.7 majority, conditional-α tracked per Yang 2026.

Pre-registered judge config: `data/judge-prompts/disjoint-panel.toml`.

## Threshold-sensitivity sweep (§11.10) — required

27-cell fractional-factorial of the 5 PASS thresholds at -20%/registered/+20%
(`stats/threshold-sensitivity.mjs`). Promotion criterion: **rank-stability** — median rank ≤ 3
AND 90% quantile range ≤ 5 ranks. Variants that are rank-1 only at registered thresholds and
rank ≥ 6 elsewhere are logged `proposal_class: threshold-game`.

## MDL / prompt-length penalty (§11.10.4)

GEPA selection metric is `score − λ · log(prompt_tokens)` with λ = <e.g., 0.0017 default;
calibrated so a +500-token bloat costs 1pp dev score>. At promotion gates, top-3 candidates are
re-evaluated after truncation to median seed length; > 2pp Sealed-1 drop after truncation
indicates overfit and rejects the bloated original (`stats/mdl-length-penalty.mjs`).

## Held-out model panel (§11.11) — required for publication claim

Pinned in `manifest.json` under `heldOutModels`:

| Slot | Model | Lineage |
|---|---|---|
| 1 | <llama-4-instruct-70b> | meta |
| 2 | <command-r-plus-2026 / phi-5-multimodal> | cohere/microsoft |

Hard rule: NO call to these models permitted before the `release/<run-id>` git tag exists
(enforced by `scripts/check-vault-lock.mjs --runId <run-id>`).

Transfer-gap target: ≤ 5pp on Vault probes. > 5pp invalidates the "robustness" claim;
campaign result must be labelled "in-panel only" without HOMP confirmation.

## Token-overlap leakage gate (§11.9) — required

Hard reject any optimised prompt whose ≥3-grams overlap Dev-tier probe symbols, paths, gold
answers, or queries (`decontamination/leakage-gate.mjs`). Whitelist:
`decontamination/leakage-whitelist.txt` — DO NOT add repo-specific identifiers; if a generic
phrase trips the gate, audit the probe corpus, don't grow the whitelist.

Gate runs at: Layer A `instruction_text` promotion, T_i seed authoring, GEPA candidate
selection, T_uber synthesis output, and final shipped AGENTS.md. Same gate runs against
Sealed-1 tokens before §9.3 promotion and against Vault tokens before publication.

## Stop rules

- Halt if <kill criterion specific to this phase — see §13.7 phase table for defaults>
- Halt at hard budget cap of $<X> marginal API spend (§13.7 cap is $25 aggregate)
- Halt if subscription rate-limit pause exceeds <Y> hours and re-running is no longer
  cheaper than promoting the current best candidate
- **Halt if Thresholdout budget exhausted (`BudgetExhaustedError`) before passing G1–G5**
- **Halt if judge majority IAA α drops below 0.7 at midpoint check** — fall back to human-only
  on the affected metrics, or invalidate the campaign

## Pre-committed analysis decisions

- <list — e.g., "If T9 wins on Dev but Thresholdout returns DIFFER on Sealed-1 unfavourably,
  do NOT publish T9">
- <e.g., "If `transfer_gap` > 5pp on HOMP, do NOT use the word 'robust' in any external claim">
- <e.g., "If threshold-sensitivity median rank > 3 for the chosen winner, treat the win as a
  Goodhart artefact and re-run synthesis">
- <e.g., "If LLM judge majority IAA α < 0.7 vs human gold, fall back to human-only on rubric
  items scoring below the threshold">
- <e.g., "Flag any probe×evaluatee pair where probe.created_at > evaluatee.training_cutoff
  and exclude from headline metrics; report contamination-free numbers separately">
- <e.g., "If the leakage gate trips on the final AGENTS.md, hard-block ship and re-author">

## Decontamination plan

- N-gram filter: 50-char window against <corpus shards listed here>
- Embedding filter: CodeRankEmbed at threshold 0.92
- LLM filter: <judge model> with confidence floor 0.6
- **Token-overlap leakage gate** (§11.9): whitelist + ≥3-gram check vs Dev corpus
- Removed-items list: `core/prompt-optimization/data/contaminated/<run-id>.json`
- Pre/post-decontamination scores reported side-by-side per MBPP/HumanEval convention

## Reproducibility manifest

- `core/prompt-optimization/data/manifest.json` — pinned repo SHAs, evaluatees, splits, **HOMP**,
  Thresholdout config, judge panel config, leakage-gate config
- `core/prompt-optimization/data/splits/{dev_60,heldout_40,freshstack_30,vault_50}.json`
  (heldout_40 = Sealed-1 via Thresholdout; freshstack_30 + vault_50 = Vault, lock enforced)
- `core/prompt-optimization/data/seeds/<variant-id>.md` — variant prompts (immutable per run)
- `core/prompt-optimization/data/judge-prompts/{prp-pairwise-v1,adversarial-v1}.md` (frozen)
- `core/prompt-optimization/data/judge-prompts/disjoint-panel.toml` (frozen)
- `core/prompt-optimization/data/results/<run-id>/run-config.toml` — overrides for this run
- `core/prompt-optimization/data/results/<run-id>/budget.jsonl` — append-only cost telemetry
- `core/prompt-optimization/data/results/<run-id>/thresholdout-log.jsonl` — Sealed-1 query log
- `core/prompt-optimization/data/results/<run-id>/bh-fdr-summary.json` — per-claim-space survival
- `core/prompt-optimization/data/results/<run-id>.jsonl` — raw per-probe records
- One-shot reproducer: `npm run eval:prompt -- --run <run-id>`
