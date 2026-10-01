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
| V1b | `SS_VARIANT_CC_RULES_IN_PROMPT=2` | V1 + 60-token pointer rules file (restores the tool-choice reminder) | **PASS** Opus −12.6% (CI < 0), acc +0.6; r3 dev −13.2% | **PASS** −8.3% (CI < 0), accOR +0.8; calls +12.6% (borderline) | (train = Opus) | **PASS** solves 9/20 vs 8/20, ss share 0.54 vs 0.53, cost −2..−7% | **CHAMPION (Claude Code)** |
| V1 | `SS_VARIANT_CC_RULES_IN_PROMPT=1` | CC rules re-written each rollout (waste #1) | **PASS** Opus: cost −15.8% (CI < 0), acc +0.2 | **PASS** Opus: −11.6% (CI < 0), accOR −0.1 | Opus train+val PASS; Sonnet A-B-A −9.6..−12.7% (CI < 0) | **FAIL**: solves 8/20 = 8/20, cost −6%, but ss-* share 0.53 → 0.32 | **replaced by V1b** |
| V2 | `SS_VARIANT_PRUNE3=1` | drop ss-find/semantic/trace (owner hyp. 2) | DS seq −9.9..−17% (CI < 0); **Codex interleaved: cost −5% (ns), accOR −1.9 pt (sig harm)** | — | — | — | **REJECTED** | | | | |
| V4 | `SS_VARIANT_RULES_FILE=…/rules-v4-complete.md` | Codex r3 partial answers (stop after one place) | Codex r3 dev-train interleaved: acc −4.0 pt (ns), cost −0.4% | — | — | — | **REJECTED** |
| V3 | `SS_VARIANT_SEARCH_DEDUPE=1` | repeated ss-search entries/lines (waste #5) | $0 replay: ss-search −9.1% chars → ≈ −1% cost (below MDE); not screened live | | | | |

## Decisions log

- 09:40 **Held-out Opus with complete panels (rescored, 100–101 pairs):** V1b vs 2.8.2 cost −14.1% [−18.1, −10.3] (q<0.001), accuracy −1.0 pt [−2.7, +0.6] (ns; non-inferiority at −2 pt NOT formally shown); V1b vs native cost +3.0% (ns), accuracy −0.3 (ns); 2.8.2 vs native cost +19.9% (q<0.001). The interim "−1.9 pt sig" came from incomplete judge panels. Codex rescore pending.
- 09:35 Swarm results in (6 of 9): ss-trace mostly not useful (56% of calls return nothing usable; works only in callers mode with --in on the real definition); ss-semantic useful when fetching a known function in a big file; ss-search: agents never use score / confidence / sufficient / trailers / gutter, rank 3 rarely, summaries mostly unused, -k is not a cap → 24–34% cut proposed; ss-grep prints fragments not lines, test files 33% of hits; ss-find ~85% waste, misunderstood regex/query split, 41% re-shown code → fold into ss-search --regex or drop from the exact-token rule; first ss-search clearly useful ≈44%, fix file at rank 1 in 61%.

- 09:35 **Forensics Stage A done** (`forensics/STATS.md`): 1,141 task rollouts, 10,442 ss-* calls (claudecode-opus 492 rollouts, claudecode-luna 78, codex-luna 210, opencode-luna 361). ss-search: 78% of entries are one-line summaries, 99.9% of which only restate their header; DEDUPE would drop 11.5% of ss-search chars on tasks; 10.4% of ss-* code chars were already shown earlier in the same rollout (ss-find 31.5%); ss-read = largest amplified token share (Opus 20%, luna 43–48%); first ss-search success 34.3% [30.5, 38.3]; ss-find empty 12.4%, ss-trace 11.6%. Opus sweet arm also makes many native cat/grep calls. **Stage B: 9 Sonnet readers launched** (ss-search ×3 harnesses, ss-find, ss-trace+semantic, ss-read, ss-grep, native fallbacks, first-call success) → `forensics/swarm/`.
- 09:30 Forensic task batch armed (`scripts/forensic-chain.sh`): starts when the Sonnet held-out queue ends → pull/stage/sweep/plan → claudecode → codex → opencode legs.

- 09:05 **Held-out r3 (103), interim (live judges; 90–96 complete panels per comparison)** — `r3/RESULTS-HELDOUT-opus-codex.md`: Opus 2.8.2 vs native cost +19.9% (q<0.001), acc 0.0; **Opus V1b vs 2.8.2 cost −14.1% (q<0.001) but accuracy −1.9 pt [−3.2, −0.3] (q 0.027)**; V1b vs native cost +3.0% (ns), acc −1.6 (ns); Codex 2.8.2 vs native cost −15.2% (q<0.001), acc −1.8 (ns). Re-scoring all held-out rows on the same route (complete panels) before the final read. Held-out is NOT inspected per question.

- 08:15 Grader consistency (pre-registered): 49 dev rows re-judged on the same route: 12 scores moved (mean |Δ| 0.015), **0 verdict flips** across 0.5. Read 5 scored dev answers by hand: 0.7 scores = one gold file missing (fair partial credit), 1.0 = complete chain. Grader trusted. r3 dev read-out (BH over 12 tests): `r3/RESULTS-DEV.md`.

- 08:05 **Task guard V1b PASSES** (`tg-20261001-0657-v2`, Opus, 10 tasks × 2, interleaved): solves base 8/20, **V1b 9/20** (svgr +1, all else equal); ideal $ −2.0% [−9.7, +6.4], real $ −7.0%; calls −5.6%, turns −2.4%; **ss-* share 0.53 → 0.54 (V1's native-fallback drop is gone)**; request-1 cache write 10,498 → 9,134. Flags at noise level: zlint V1b edited 2 files in one rep (still solved), jupytext patch-count differs (unsolved both arms), degenerate re-runs 1 → 2. → **V1b = Claude Code champion**; held-out arm queued.

- 06:55 **V1b passes validation** (Opus r282 validation 52, aggregates): cost −8.3% [−12.6%, −4.3%], cache write −15%, accOR +0.8 pt [−0.6, +2.6], calls +12.6% [+0.02, +0.46 per q] (borderline rise; train −4.6%, r3 dev +0.6% → pooled over 190 questions ≈ +0.03 calls/q). Pass with this disclosed.
- 06:55 **V4 REJECTED** (Codex r3 dev-train, interleaved 36): accuracy −4.0 pt [−9.9, +1.4], cost −0.4%, calls +1.5% — the wording does not make the agent explore further. Killed its r282 cost check. The Codex r3 accuracy deficit stays an open item (cause: answers stop after one place; a prompt line does not fix it).
- 06:57 Guard V1b first launch refused (maintainers still exiting); stopped own daemons, waited to 0, relaunched 06:57.

- 06:40 **V1b passes train** (Opus r282 train 78 vs `cc-base-a`): cost −12.6% [−15.9%, −9.1%], cache write −17.6%, accuracy +0.6 pt, ss-* calls −5% (ns), native search 0. vs V1: +3.8% (pointer ≈ +0.4k cache-write tokens). **On r3 dev (Opus, 60): V1b vs 2.8.2 −13.2% [−18.0%, −8.6%], acc +1.0 pt; V1b vs native +8.8% (was +25.4% for 2.8.2).** Validation `cc-rp2-v` queued; task guard V1b chained (waits for a quiet machine).
- 06:40 **opencode/Sol, corrected** (stable rules path, interleaved native/sweet, r282 train 77 pairs): sweet vs native cost +3.9% [−6.9%, +15.0%] (ns), naive +14.4% (sig), accuracy −0.3 pt, calls −18%. → the bench fix does not make oc-Sol cheaper; r282's +6.8% (ns) stands as "no significant difference". Cause (forensics): +1.1k-token prefix, provider cache misses in both arms, calls cut but turns not.
- 06:40 Codex r3 dev final (60 pairs): sweet vs native accuracy −4.9 pt [−8.3, −1.8] (sig), cost −9.4% [−20.0%, +1.8%].

- 06:25 **V4 `SS_VARIANT_RULES_FILE=…/variants/rules-v4-complete.md`** (one sentence of the rules changed: stop when EVERY part is answered; flows / check+effect / several behaviours need each place named). Targets the Codex r3 dev accuracy loss: dev-train failures (5 with native ≥ sweet + 0.3) are all partial answers that stop after one place (ocelot-18 misses where the duplicate-route failure stops startup; tortoise-orm-26 names one of two files with the same logic; ocelot-03 cites docs instead of the second hop). Opposite direction from the dead "stop earlier" levers. Queued interleaved on Codex: r3 dev-train (36) and r282 train (78, cost check).
- 06:20 **r3 dev, Opus (sequential, 60):** native acc 0.952, sweet 0.942 (Δ −1.0 pt [−4.0, +1.8]); **cost sweet +25.4% [+19.0, +32.3]** (cache write +57%); calls −17%. File recall native 0.950 / sweet 0.910; negatives "No match found" 0.92 / 1.00. **Headroom FAIL for Opus** (native 95.2% ≥ the pre-registered 95% "too easy" line); per pre-registration the held-out questions are NOT edited; r3 is reported as near ceiling for Opus.
- 06:20 **r3 dev, Codex (interleaved, interim 52):** native acc 0.937, **sweet 0.884 (Δ −5.3 pt [−9.0, −2.0], significant)**; cost −6.2% (ns). r3 exposes a sweet accuracy deficit on Codex that r282 (ceiling) could not.

- 05:50 **Task guard V1 (tg-20261001-0440, Opus, 10 tasks × 2 reps, interleaved): solves 8/20 = 8/20 (same tasks); ideal $ −6.3% [−14.5, +3.4], real $ −11.7%; turns −10%, calls −15%; request-1 cache write 10,993 → 8,948. RED FLAG: ss-* share of search/read calls 0.53 → 0.32 (ss 42 → 21, native grep 13 → 23).** HANDOFF §4 Phase 4 lists "more native fallbacks" as a new failure mode → **V1 FAILS the guard.** Mechanism guess: the rules as a first-user-message reminder are more salient on long tasks than the same text in the system prompt (retrieval questions are too short to show it: ss calls equal there). → back to Phase 2: **V1b** = rules in the cached agent prompt + a short pointer rules file (~60 tokens re-written per session instead of ~1.4k). Implemented in installer, retrieval runner and task runner (`=2`); $0 check PASS for off/1; guard dry run shows `=2` on the 4 var legs.

- 04:40 r3 indexing DONE (jj 33 min, dgraph 26, tortoise-orm 8, typedoc 12, zipkin 11, ocelot 13; all exit 0, `INDEXING COMPLETE (FULL)`). Task guard V1 launched 04:40 (`tg-20261001-0440-*`, 8 legs interleaved base/var, REPS 2); ETA ~05:40. No retrieval run until it ends (daemon eviction risk).

- 03:40 Residual Opus gap after V1 (est. +6..+8% vs native) is tool-result size: ss-read is NOT fatter than native `sed -n` (median span 35 vs 31 lines, 52 vs 53 chars/line, 107 vs 89 calls); the extra bytes come from ss-search/ss-find code blocks replacing grep lines. The shape lever for that (pointer tail) is in TRIED-LEVERS (no win) → no new variant; recorded as an open item for the owner.
- 03:30 r3 indexing: jj done in 33 min (11k chunks); dgraph running; ETA all six ≈ 04:50, then the task guard (~1 h).

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

- 2026-10-01 ~08:50 — owner awake; critique accepted: retrieval questions are too short (2–3 calls) to tune on; early tokens are amplified by cache reads over long tasks; the 3 tools were judged without reading what the agent did with them. **New plan (owner-approved answers):** forensic study on TASK trajectories = existing runs (tonight's 80 Opus guard rollouts + 09-29/30 hill-climb runs on 3 harnesses) + NEW runs (~20 longer dev tasks × 3 harnesses, sweet arm, after the Sonnet held-out); deterministic layer (Stage A agent: dossiers + STATS.md) + a swarm of 8–10 Sonnet agents reading the actual trajectories per tool group; fixes validated by a task guard per fix (+ $0 replay for token effects). Sonnet held-out runs continue.
- 2026-10-01 ~08:55 — owner: OpenRouter has auto-refill, but keep judge cost low. Measured per judge call (8 r3 answers): deepseek-v4-flash via OR $0.00104 (807 reasoning output tokens; 60% of panel cost), MiniMax M2.7 $0.00050, gemini-3.1-flash-lite $0.00019 → panel ≈ $0.0017 per row. Decision: keep the pre-registered panel for this held-out round (no grader mixing); proposal for the next round: DeepSeek judge → `deepseek/deepseek-v4.1-flash` (out $0.60/M vs $1.28/M) with a ~50-row consistency check against the old panel.

- 2026-10-01 00:15 — owner message: "you can switch to using deepseek via openrouter when normal expires". **Authorized override of the memory rule "DeepSeek never OpenRouter", for this plan only, once the direct DeepSeek balance is spent.** Rule for use: a baseline and its variant must run on the SAME provider route; never pool or compare direct-API rows with OpenRouter rows (provider change = new cell, fresh baseline).
- 2026-10-01 00:14 — owner read the preliminary report (chat) and went back to sleep; the loop continues.

- 2026-10-01 00:00 — owner message: "if for the best results we require more than until 9AM please take more time … I don't have more than 24h". **End time changed from 09:00 to: when Phase 7 is done or the cash is spent, hard stop ~23:00 on 2026-10-01.**

## Problems

- 01:45 Second count-only slip: the task-guard prep agent ran a `grep -l` whose glob included `tasks_heldout2*.jsonl` (output filtered, no content viewed). No HO2 data entered any decision.

- 00:20 The r3 repo-selection agent ran a COUNT-ONLY grep (`grep -c zipkin`) over `.cache/tasks_full_heldout2_reserve.json` while checking freshness. No content was read or printed (3 case-insensitive matches of the word, 0 of `openzipkin/`). Recorded as a breach of the "never touch HO2" rule by a subagent; no HO2 data entered any decision. Later agent prompts name the forbidden files explicitly.
