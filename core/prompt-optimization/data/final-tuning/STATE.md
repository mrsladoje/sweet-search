# FINAL TUNING — loop state

Read this first on every wake-up. Update it before every sleep. Newest entries on top in each
section.

## Now

- Phase: **0 — setup and inventory** (in progress); Phase 1 agents and Phase 3 baselines started early (independent work, saves wall time).
- Next step: when agents report → review TRIED-LEVERS.md + 3 normalisers (validate 3 rollouts myself) → common analyser (per-tool share, attribution, follow-up, rank usage, metadata share) → r282-TRACE-ANALYSIS.md.
- Runs in flight (logs in `~/.ss-eval/final-tuning-logs/`):
  - `ds-base-a` — oc-dsflash41 sweet, train 78, variant OFF (test-retest run A) — started 00:10
  - `cx-base-a` — codex-sol61-high sweet, train 78, variant OFF — started 00:10
- Background agents: TRIED-LEVERS sweep; trace normalisers opencode / Codex / Claude Code.

## Baseline

- Product: sweet-search 2.8.2, main @ 0e128ac6. Branch `final-tuning` in worktree `../sweet-search-final-tuning` (created from 0e128ac6).
- Worktree runtime pieces are symlinks to the main checkout (gitignored, excluded in `.git/info/exclude`): `node_modules`, `eval/repos`, `eval/ast-tester-probes/_repos`, `crates/sweet-search-cli/target`, `crates/sweet-search-native/sweet-search-native.darwin-arm64.node`.
- Sentinel check PASSED (2026-10-01 00:05): `SS_VARIANT_SENTINEL=1` + the worktree `ss-search` in a tagged clone prints `# variant-sentinel: final-tuning worktree`; switch off → no line. ss-search result blocks are printed client-side in `_ss-helpers.mjs` (the daemon only selects/packs), so output-shape switches read the env directly. Runner `--tag` gives each run its own results dir, state dir and clone root (= fresh daemons with the run's env).
- All final-tuning runs use `SWEET_SEARCH_MAX_DAEMONS=8` (infra only; two cells run side by side on different harnesses). Same for baselines and variants.
- Baseline numbers: `core/prompt-optimization/data/r282-RESULTS.md`
- r282 train / validation split: `final-tuning/r282-split.json`, train 78 (vault 36, held-out 18, OOD 24) / validation 52 (24/12/16), seed 42, **sha256 aafba591edcf5089587f3a9edec9c4576fd30224004d9f946f71d597fa828507**. Script: `final-tuning/scripts/noise-and-split.mjs`.
- Noise floor / MDE: `final-tuning/noise-floor.md`. Pessimistic paired MDE for cost at n=78: DeepSeek 15–23%, oc-Sol 15–20%, Codex 24–26%, Sonnet 7–13%, Opus 7–12%. Calls 16–38%. Accuracy 2–5 points. Test-retest (DeepSeek, 2 runs) will replace these.

## Spend

DeepSeek balance at start: **$2.18** (hard ceiling for DeepSeek agent runs + DeepSeek judge; cannot be topped up tonight). OpenRouter credit at start: $24.07.

| When | What | Cash $ | Running total $ |
|---|---|---|---|
| 00:05 | sentinel smoke (1 DeepSeek rollout + judges) | ~0.01 | 0.01 |

Cash limit: $40 (effective limit lower: DeepSeek $2.18 balance).

## Variants

| Variant | Switch | Targets | Train | Validation | Opus confirm | Task guard | Status |
|---|---|---|---|---|---|---|---|
| sentinel | `SS_VARIANT_SENTINEL=1` | proof the bench runs the worktree | — | — | — | — | infra only |

## Decisions log

- 00:12 Codex/Sol (subscription) becomes the main screen cell; DeepSeek runs are rationed (balance $2.18). — balance API
- 00:10 Baseline runs started before Phase 1/2 finish: they do not depend on any lever and the wall time is the bottleneck. — this file
- 00:05 Runner `--tag` added (commit on this branch). — `scripts/retrieval-bench-282.mjs`

## Owner decisions (picked conservatively, owner to review)

- 2026-10-01 00:00 — owner message: "if for the best results we require more than until 9AM please take more time … I don't have more than 24h". **End time changed from 09:00 to: when Phase 7 is done or the cash is spent, hard stop ~23:00 on 2026-10-01.**

## Problems

- none yet
