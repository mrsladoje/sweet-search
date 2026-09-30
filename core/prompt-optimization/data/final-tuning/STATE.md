# FINAL TUNING — loop state

Read this first on every wake-up. Update it before every sleep. Newest entries on top in each
section.

## Now

- Phase: **3 — retrieval screens** (Phase 0 exit gate met: worktree + sentinel, TRIED-LEVERS.md, noise floor. Phase 1 exit gate met: reconciliation exact in all 5 cells, ranked waste list in `r282-TRACE-ANALYSIS.md`. Phase 2 exit gate met: 3 candidates in `LEVERS.md`).
- Next step: read test-retest (ds-base-a2 vs ds-base-b2; cx-base-a vs cx-base-b) → V1 verdict on Opus train (cc-base-a vs cc-rp-a) → V2 verdicts (Codex, DeepSeek) → queue V3 (SEARCH_DEDUPE) → validation runs for passers.
- Compare: `node core/prompt-optimization/data/final-tuning/scripts/compare.mjs <cell> <baseTag> <variantTag> [--base2 <tag>] [--native-r282]`
- Queues (sequential per harness; `scripts/queue.sh`, logs `~/.ss-eval/final-tuning-logs/queue-*.log` + `<tag>.log`):
  - cc-opus: `cc-base-a` (running) → `cc-rp-a` (V1)
  - codex: waits for `cx-base-a` → `cx-prune3-a` (V2) → `cx-base-b` (retest)
  - deepseek: `ds-base-b2` (retest) → `ds-prune3-a` (V2)
- Done runs: `ds-base-a2` (78/78), `smoke-rulesprompt` (Opus, 4 Zig questions, V1 mechanism smoke).

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
| bench fix | `SS_BENCH_STABLE_RULES_PATH=1` | opencode prefix cache broken by random rules path (waste #2) | DeepSeek vs r282 native: +7.9% (CI crosses 0), was +54.6% | — | n/a | n/a | **adopted for all new runs (measurement fix, not a product change)** |
| V1 | `SS_VARIANT_CC_RULES_IN_PROMPT=1` | CC rules re-written each rollout (waste #1) | running | | | | screening |
| V2 | `SS_VARIANT_PRUNE3=1` | drop ss-find/semantic/trace (owner hyp. 2) | queued | | | | |
| V3 | `SS_VARIANT_SEARCH_DEDUPE=1` | repeated ss-search entries/lines (waste #5) | not queued | | | | |

## Decisions log

- 00:12 **Bench fix confirmed:** DeepSeek sweet with the stable rules path (`ds-base-a2`, train 78) vs r282 native on the same ids: cost +7.9% [−$0.00010, +$0.00033] (was +54.6% in r282), accuracy 0.969 vs 0.964, native search calls −79%. — `compare.mjs oc-dsflash41 ds-base-a2 ds-base-a2 --native-r282`
- 00:08 V1 mechanism smoke (Opus, 4 Zig train questions, conc 1): warm rollouts wrote 5,856 / 4,881 cache tokens vs r282 8,164 / 7,123; cost −22% per warm rollout. → full train screen queued.
- 00:05 Codex queue started a second Codex run while `cx-base-a` was running (bad wait pattern). Killed it within ~1 min and deleted its partial results (`cx-prune3-a.aborted.log`); requeued with an anchored pattern.

- 23:58 **Bench fix `SS_BENCH_STABLE_RULES_PATH=1`** (runner; default off keeps r282 reproducible). The r282 opencode sweet arm wrote the rules file into a random per-rollout temp dir; opencode prints "Instructions from: <absolute path>" into the system prompt, so the provider prefix cache broke on every sweet rollout. Evidence: DeepSeek req-0 cache hit sweet 2029/8384 tokens (24%) vs native 6254/7235 (86%); prefix = 43% of sweet cost vs 14% native; the prefix gap ($0.00077/q) ≈ the whole r282 DeepSeek cost gap ($0.00079/q). The product (`init`) uses the stable project path `.opencode/sweet-search.md`, so the stable path is production-faithful. **All new opencode runs use it; r282's opencode cost deltas (DeepSeek +55%, oc-Sol +6.8%) are inflated by this artifact.** Killed `ds-base-a` (old setting) and restarted as `ds-base-a2`.
- 23:57 Phase 1 draft: prefix = 44–73% of cost in every cell and arm; ss-search results 7–12%; ss-read 4–8%. → caching/prefix levers first, output shaping second. — `trace/analyze-traces.mjs`

- 00:12 Codex/Sol (subscription) becomes the main screen cell; DeepSeek runs are rationed (balance $2.18). — balance API
- 00:10 Baseline runs started before Phase 1/2 finish: they do not depend on any lever and the wall time is the bottleneck. — this file
- 00:05 Runner `--tag` added (commit on this branch). — `scripts/retrieval-bench-282.mjs`

## Owner decisions (picked conservatively, owner to review)

- 2026-10-01 00:00 — owner message: "if for the best results we require more than until 9AM please take more time … I don't have more than 24h". **End time changed from 09:00 to: when Phase 7 is done or the cash is spent, hard stop ~23:00 on 2026-10-01.**

## Problems

- none yet
