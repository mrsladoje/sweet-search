# FINAL TUNING — loop state

Read this first on every wake-up. Update it before every sleep. Newest entries on top in each
section.

## Now

- Phase: **3 (screens) + 4 (task guard ready) + 5 (r3 frozen)**.
- Running: `cx-il-prune3` (V2 interleaved, Codex train, 156 rollouts, ~1 h left); cc-sonnet2 A-B-A (`sb-rp-a` running → `sb-base-b`).
- Next, in order (each needs a quiet machine — no overlap):
  1. **index r3** — LAUNCHED 02:10, waits by itself until no retrieval-bench/queue process, stops OUR daemons (cwd in the worktree or ~/.ss-eval/r282-repos), then indexes serially (log `index-r3.log`, per repo `index-r3-<repo>.log`);
  2. **task guard V1** — CHAINED: starts automatically 60 s after `index-r3.log` says ALL DONE (log `task-guard.log`); dry run OK (8 legs, interleaved) (Opus, `TASK-GUARD.md`, `GUARD_STAMP=$(date +%Y%m%d-%H%M) bash core/prompt-optimization/data/final-tuning/scripts/task-guard.sh both`, ~1 h);
  3. **r3 dev pilot / 2.8.2 baseline**: native vs sweet on r3 dev (Codex, Opus) → headroom check; then champion vs 2.8.2 on dev; then held-out once (Phase 7).
- Judge route: OpenRouter DeepSeek (`SS_JUDGE_DEEPSEEK_VIA_OPENROUTER=1`), USD panel off (`SS_BENCH_NO_USD=1`), decisions on `accOR`.
- r3: frozen `r3/r3-probes.json` sha256 ba49df55…, 163 = held-out 103 + dev 60 (train 36 / val 24); `r3/r3-PREREG.md`.


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
| 00:50 | DeepSeek direct: 5 DeepSeek runs + all judges of all cells until now | 2.05 | 2.06 |
| 01:28 | OpenRouter since start (judges, USD panel, rescore, r3 verifier) | 8.56 | 10.62 |
| 01:28 | Gemini direct (judge + r3 verifier), estimate | ~1 | ~11.6 |

Cash limit: $40 (effective limit lower: DeepSeek $2.18 balance).

## Variants

| Variant | Switch | Targets | Train | Validation | Opus confirm | Task guard | Status |
|---|---|---|---|---|---|---|---|
| sentinel | `SS_VARIANT_SENTINEL=1` | proof the bench runs the worktree | — | — | — | — | infra only |
| bench fix | `SS_BENCH_STABLE_RULES_PATH=1` | opencode prefix cache broken by random rules path (waste #2) | DeepSeek vs r282 native: +7.9% (CI crosses 0), was +54.6% | — | n/a | n/a | **adopted for all new runs (measurement fix, not a product change)** |
| V1 | `SS_VARIANT_CC_RULES_IN_PROMPT=1` | CC rules re-written each rollout (waste #1) | **PASS** Opus: cost −15.8% (CI < 0), acc +0.2 | **PASS** Opus: −11.6% (CI < 0), accOR −0.1 | Opus train+val PASS; Sonnet A-B-A −9.6..−12.7% (CI < 0) | queued after r3 index | **champion candidate (Claude Code)** |
| V2 | `SS_VARIANT_PRUNE3=1` | drop ss-find/semantic/trace (owner hyp. 2) | DS seq −9.9..−17% (CI < 0); **Codex interleaved: cost −5% (ns), accOR −1.9 pt (sig harm)** | — | — | — | **REJECTED** | | | | |
| V3 | `SS_VARIANT_SEARCH_DEDUPE=1` | repeated ss-search entries/lines (waste #5) | $0 replay: ss-search −9.1% chars → ≈ −1% cost (below MDE); not screened live | | | | |

## Decisions log

- 03:05 **V2 (PRUNE3) REJECTED.** Codex interleaved train (78 pairs): accOR −1.9 pt [−3.8, −0.1] (significant harm), cost −5.0% [−17.4%, +6.9%] (ns), calls +1%, ss-search tokens −14%. The earlier DeepSeek saving (sequential) does not transfer; cross-cell rule fails. Switch kept, default off. Answer to owner hypothesis 2: on Codex the three tools carry accuracy; removing them saves little.

- 02:25 **V1 confirmed on Sonnet (A-B-A, train 78):** vs base A cost −12.7% [−17.7%, −8.1%], vs base B −9.6% [−13.1%, −6.2%]; drift A→B −3.4% (ns); cache write −22..−27%; accuracy +0.9 / 0.0 pt; calls equal. Sonnet validation skipped (subscription; Opus train+val already passed, Sonnet is a confirmation cell). Accuracy re-score (accOR) for the 3 runs in progress.
- 02:25 OpenRouter DeepSeek judge fails on ~9% of rows (31/354 missing `deepseek-api`); rescore.mjs re-tries incomplete panels; decisions use complete panels only.

- 02:05 **V3 (SEARCH_DEDUPE) not screened live**: $0 replay of 60 r282 ss-search calls (Codex, Opus, DeepSeek) in their r282 clones: output −9.1% chars, entries −18% (572 → 467). ss-search results are 7–13% of cost → expected cost effect ≈ −1%, below every MDE (even interleaved). Kept as an optional low-risk hygiene switch for the owner; cancelled `cx-il-dedupe` to free the machine for r3 indexing + task guard. — `variants/replay-dedupe.json`
- 02:00 **r3 frozen**: audits kept 163 (jj 28, dgraph 28, tortoise-orm 26, typedoc 29, zipkin 24, ocelot 28), fixed 48 facts/queries, dropped 2 (tortoise-orm-34 negative exists as a pre-save hook; typedoc-27 ambiguous mode). Split seed 42 stratified (repo, stratum). Pre-registration written before any r3 run.

- 01:30 **V1 passes validation on Opus** (52, aggregates only): cost −11.6% [−15.5%, −8.0%], cache write −18%, accOR −0.1 pt [−1.0, +0.8], calls +8.4% [0.00, +0.33] (borderline, watch on Sonnet). → V1 confirmed on the priority cell; Sonnet A-B-A confirm queued; Phase 4 task guard being prepared.
- 01:28 Cash: OpenRouter fell from $24.07 to $15.51 (MiniMax judge + USD content panel + GLM verifier on jj ≈ $2.9). Actions: new runs skip the USD/content panel (`SS_BENCH_NO_USD=1`; content is secondary and its CC drop is a gutter artifact); r3 second verifier switched from z-ai/glm-5.3 to deepseek/deepseek-v4-pro-0813 (OpenRouter, ~half the price) for dgraph (partly), tortoise-orm, typedoc, zipkin; ocelot + jj were verified with glm-5.3.

- 01:10 **Codex sequential A/B is invalid.** Test-retest `cx-base-b` vs `cx-base-a` (identical code, 25 min apart): cost −24.5% [−35.9%, −13.6%], naive −14.0% (both significant). V2 vs base A −13.2%, vs base B +15.0% (sig) → the Codex V2 train result is time drift, not the variant. Killed the sequential Codex jobs (`cx-dedupe-a`, codex4 validations). **New runner mode `--interleave --armB-env K=V`**: arms `sweet` and `sweetB` alternate per probe in one queue (order flipped on odd probes), so both see the same drift. Codex screens rerun interleaved. Claude Code cannot interleave (per-repo installed files) → A-B-A design for Sonnet; Opus is stable (fresh baseline reproduced r282 within 0.2 pt of cost %).
- 01:10 DeepSeek V2 with one grader (accOR): vs base A cost −9.9% (CI < 0), accOR +0.2 pt [−1.3, +1.9]. DeepSeek sequential noise (+8.5%, ns) is smaller than Codex's, but the DeepSeek cell is paused (balance).

- 00:55 **V2 (PRUNE3) → validation despite a borderline train result** — Codex: cost −13.2% [−27.1%, +0.3%], acc −0.6 pt [−2.6, +1.3]; DeepSeek vs base A: cost −9.9% (CI < 0), calls −11.5% (CI < 0), acc +0.7 [−1.0, +2.7]; vs base B: cost −17.0% (CI < 0), acc −1.1 [−2.4, +0.1]. The strict rule (acc lower CI > −2 pt) fails by 0.4–0.6 pt on 2 of 3 comparisons, but identical baselines differ by 1.9 pt (sig) → the accuracy CI at n=78 is inside test-retest noise. Validation decides (aggregate only); final call needs both cells.
- 00:55 **V1 passes train** (Opus, n=78): cost −15.8% [−18.5%, −13.1%], cache write −1,867 tokens/rollout (−22%), naive −4.5%, acc +0.2 pt [−1.7, +2.0], calls −4% (ns).
- 00:52 DeepSeek direct balance exhausted ($0.13) → judge route switched to OpenRouter for all new jobs; accuracy re-judged for finished runs (one grader per comparison).

- 00:35 **Test-retest DeepSeek** (`ds-base-b2` vs `ds-base-a2`, identical code, train 78): cost +8.5% [−$0.00001, +$0.00029], accuracy +1.9 pt [+0.001, +0.038] (!), calls +6%. → DeepSeek screens need effects well above ~10% cost; an accuracy CI alone can move 2 points by chance. Recorded in noise-floor terms: real paired noise ≈ the pessimistic MDE.
- 00:35 V1 partial (Opus, 45/78 train): cost −13.9% [−17.2%, −10.6%], cache write −1,686 tokens/rollout (−20%), accuracy 0.980 vs 0.979, calls equal, 0 native searches. Validation queued.

- 00:27 Opus fresh baseline `cc-base-a` (train 78) reproduces r282: vs r282 native cost +22.2% [+$0.0093, +$0.0138], cache write +2,550 tokens/rollout (+43%), accuracy 0.975 vs 0.976. Opus is stable over time → clean cell for V1.
- 00:14 Codex fresh baseline `cx-base-a` vs r282 native: cost +2.4% [−$0.0037, +$0.0052] (r282 said sweet −10.5%) → Codex cost drifts with time; only fresh paired baselines count.

- 00:12 **Bench fix confirmed:** DeepSeek sweet with the stable rules path (`ds-base-a2`, train 78) vs r282 native on the same ids: cost +7.9% [−$0.00010, +$0.00033] (was +54.6% in r282), accuracy 0.969 vs 0.964, native search calls −79%. — `compare.mjs oc-dsflash41 ds-base-a2 ds-base-a2 --native-r282`
- 00:08 V1 mechanism smoke (Opus, 4 Zig train questions, conc 1): warm rollouts wrote 5,856 / 4,881 cache tokens vs r282 8,164 / 7,123; cost −22% per warm rollout. → full train screen queued.
- 00:05 Codex queue started a second Codex run while `cx-base-a` was running (bad wait pattern). Killed it within ~1 min and deleted its partial results (`cx-prune3-a.aborted.log`); requeued with an anchored pattern.

- 23:58 **Bench fix `SS_BENCH_STABLE_RULES_PATH=1`** (runner; default off keeps r282 reproducible). The r282 opencode sweet arm wrote the rules file into a random per-rollout temp dir; opencode prints "Instructions from: <absolute path>" into the system prompt, so the provider prefix cache broke on every sweet rollout. Evidence: DeepSeek req-0 cache hit sweet 2029/8384 tokens (24%) vs native 6254/7235 (86%); prefix = 43% of sweet cost vs 14% native; the prefix gap ($0.00077/q) ≈ the whole r282 DeepSeek cost gap ($0.00079/q). The product (`init`) uses the stable project path `.opencode/sweet-search.md`, so the stable path is production-faithful. **All new opencode runs use it; r282's opencode cost deltas (DeepSeek +55%, oc-Sol +6.8%) are inflated by this artifact.** Killed `ds-base-a` (old setting) and restarted as `ds-base-a2`.
- 23:57 Phase 1 draft: prefix = 44–73% of cost in every cell and arm; ss-search results 7–12%; ss-read 4–8%. → caching/prefix levers first, output shaping second. — `trace/analyze-traces.mjs`

- 00:12 Codex/Sol (subscription) becomes the main screen cell; DeepSeek runs are rationed (balance $2.18). — balance API
- 00:10 Baseline runs started before Phase 1/2 finish: they do not depend on any lever and the wall time is the bottleneck. — this file
- 00:05 Runner `--tag` added (commit on this branch). — `scripts/retrieval-bench-282.mjs`

## Owner decisions (picked conservatively, owner to review)

- 2026-10-01 00:15 — owner message: "you can switch to using deepseek via openrouter when normal expires". **Authorized override of the memory rule "DeepSeek never OpenRouter", for this plan only, once the direct DeepSeek balance is spent.** Rule for use: a baseline and its variant must run on the SAME provider route; never pool or compare direct-API rows with OpenRouter rows (provider change = new cell, fresh baseline).
- 2026-10-01 00:14 — owner read the preliminary report (chat) and went back to sleep; the loop continues.

- 2026-10-01 00:00 — owner message: "if for the best results we require more than until 9AM please take more time … I don't have more than 24h". **End time changed from 09:00 to: when Phase 7 is done or the cash is spent, hard stop ~23:00 on 2026-10-01.**

## Problems

- 01:45 Second count-only slip: the task-guard prep agent ran a `grep -l` whose glob included `tasks_heldout2*.jsonl` (output filtered, no content viewed). No HO2 data entered any decision.

- 00:20 The r3 repo-selection agent ran a COUNT-ONLY grep (`grep -c zipkin`) over `.cache/tasks_full_heldout2_reserve.json` while checking freshness. No content was read or printed (3 case-insensitive matches of the word, 0 of `openzipkin/`). Recorded as a breach of the "never touch HO2" rule by a subagent; no HO2 data entered any decision. Later agent prompts name the forbidden files explicitly.
