# Pre-registration: <run-id>

**Campaign**: <campaign-id>
**Run**: <run-id>
**Author**: <name>
**Committed at**: <iso-timestamp>
**Tag**: prereg/<run-id>

## Primary metric

<one sentence — e.g., "PASS rate on the 40-probe held-out split, where PASS = answerability='full' per eval/agent-read-workflows/metrics.js">

## Hypothesis

<one sentence — e.g., "T9 (worked-examples-only) achieves higher PASS than T1 (question-shape router)">

## Secondary metrics

- file recall, symbol recall, fact recall, line overlap, file precision
- token cost (mean), tool-call count (median)
- per-stratum PASS deltas (language × query-type × repo-size)

## Statistical tests

- Paired permutation test, 10K iterations, seed=42, on PASS rate
  (`core/prompt-optimization/stats/paired-permutation.mjs`)
- Paired bootstrap 95% CI, 10K iterations, seed=42, on absolute and relative deltas
  (`core/prompt-optimization/stats/bootstrap-ci.mjs`)
- Per-stratum Cliff's δ (computed inline; report magnitude bands ≤0.147 negligible /
  ≤0.33 small / ≤0.474 medium / >0.474 large per Romano 2006)
- Multiple-comparison correction: Holm
- Variant ranking (when comparing ≥3 variants): Plackett-Luce with bootstrap CIs
  (`core/prompt-optimization/stats/plackett-luce.mjs`)

## Sample size justification

<paragraph — power analysis with assumed variance. Default reference: paired-bootstrap
variance ≈ 4.5pp from May 2026 60-probe runs; n ≥ 50 paired probes detect a 5pp PASS-rate
difference at α=0.05, β=0.2. The 60-dev / 40-heldout split is barely sufficient; FreshStack-30
is the headline-claim cap.>

## Stop rules

- Halt if <kill criterion specific to this phase — see §13.7 phase table for defaults>
- Halt at hard budget cap of $<X> marginal API spend (§13.7 cap is $25 aggregate)
- Halt if subscription rate-limit pause exceeds <Y> hours and re-running is no longer
  cheaper than promoting the current best candidate

## Pre-committed analysis decisions

- <list — e.g., "If T9 wins on dev but loses on held-out, treat as overfit, do NOT publish T9">
- <e.g., "If LLM judge IAA α < 0.6 vs human gold, fall back to human-only on rubric items
  scoring below the threshold">
- <e.g., "Flag any probe×evaluatee pair where probe.created_at > evaluatee.training_cutoff
  and exclude from headline metrics; report contamination-free numbers separately">

## Decontamination plan

- N-gram filter: 50-char window against <corpus shards listed here>
- Embedding filter: CodeRankEmbed at threshold 0.92
- LLM filter: <judge model> with confidence floor 0.6
- Removed-items list: `core/prompt-optimization/data/contaminated/<run-id>.json`
- Pre/post-decontamination scores reported side-by-side per MBPP/HumanEval convention

## Reproducibility manifest

- `core/prompt-optimization/data/manifest.json` — pinned repo SHAs, evaluatees, splits
- `core/prompt-optimization/data/splits/{dev_60,heldout_40,freshstack_30}.json` — split id lists
- `core/prompt-optimization/data/seeds/<variant-id>.md` — variant prompts (immutable per run)
- `core/prompt-optimization/data/results/<run-id>/run-config.toml` — overrides for this run
- `core/prompt-optimization/data/results/<run-id>/budget.jsonl` — append-only cost telemetry
- `core/prompt-optimization/data/results/<run-id>.jsonl` — raw per-probe records
- One-shot reproducer: `npm run eval:prompt -- --run <run-id>`
