# Overnight autonomous micro-smoke loop — 2026-08-07

Operator: Claude (autonomous, user asleep, explicit trust + "try everything, try variations,
don't give up early"). Backbone: **gpt-5.6-luna via codex ChatGPT-Max subscription on the box**
(flat-rate → NO metered dollars). Discipline: `/microsmoke` skill + GPT-Sol's ranked portfolio.

## Hard invariants (external, deterministic — the guardrails)
1. **$0 gate FIRST for every lever.** No live cell until a $0 replay/census proves the treatment
   fires and clears a pre-registered bar. (Anti-A/A rule; GPT's rule #7.)
2. **One pilot at a time on the box** (dubious-ownership uid-501 bug). Serialize. Never 2 concurrent.
3. **REPS>=2, CONCURRENCY=1** for micro-cohorts (boot-race poisons small n). Matched caps both arms.
4. **Green ledger reused:** rotate18 tasks already graded green under this exact config — reuse them
   as diagnostics/controls; no new ledger sweep unless the treatment changes the fingerprint.
5. **Box env:** DOCKER_HOST=unix:///var/run/docker.sock, EGRESS_ALLOW includes chatgpt.com,openai.com,
   CODEX_SUBSCRIPTION=1, MODEL=gpt-5.6-luna, HARNESS=codex. Per-task image GC (NO pre-pull).
6. **Read solve FLIPS, not aggregate cost** at tiny n (±37% noise floor). idealCost, never realized.
7. **A win = flips a target WITHOUT regressing any control.** Then rotate on fresh DEV-RET tasks.
8. **Never touch HO2.** Smokes use DEV-RET rotate18 tasks only.
9. **Solve-safety veto:** never ship a cost lever that plausibly costs a solve (accuracy non-negotiable).

## Task roster (all rotate18, ledger-green)
- Diagnostics: teleport (completeness), dart-http (context blow-up), mransan (retrieval-thrash),
  underscore + gradethis (generation variance).
- Solved controls (must NOT regress): redboltz, statamic, scoringutils, oceanparcels.

## GPT-Sol ranked portfolio → loop plan
| # | Lever | $0 gate | Live? | Overnight verdict |
|---|---|---|---|---|
| 1 | Auto-await authoritative tests (run_tests waits, returns final in one call) | poll-census over 72 raw rollouts | YES (solve-neutral by construction) | HIGHEST EV |
| 2 | Verified checkpoint-on-green | edit-thrash-replay selector-safety (EDIT_THRASHING.md 4.2) | maybe | protects solves |
| 3 | Phase-aware eviction + span-capped fusion | 24/32/40/48K trigger-grid replay on dart+mransan | gated (needs ledger sweep) | tail cost |
| 4 | Bounded repair-completeness card (200-400 tok, evict after) | teleport $0 replay: does card recall dropped `fileType` operand? | YES if $0 passes (format-gated!) | targets THE solve gap |
| 5 | Retrieval novelty accounting + lossless dedup | novelty curves over 72 trajectories | dedup-only (no forced stop) | modest, near-zero risk |
| 6 | Conditional 2-candidate gen + deterministic select | offline retained-patch analysis ONLY | NO — needs explicit user approval | $0 analysis only |

## CLAUDE.md constraint on lever #4
Any new ss-* affordance that surfaces structural signal (usages, call-sites, predicates) MUST be
format-gated on `opts._isAgentFormat`/`format==='agent*'` by default. NL traffic must not see it.

## Run ledger (append per step)

### [$0 GATE] Lever #1 auto-await — poll-census over 72 raw rollouts — PASSED (strong)
- 228 poll turns = **23.1% of all model requests**; ideal cost **$0.111 = 15.9% of spend**.
- Symmetric: native 16.2% / sweet 15.6% of spend → harness-wide waste, NOT arm-specific.
  (Helps both arms equally; reduces absolute cost, A/B-neutral. Solve-neutral by construction.)
- ~3x GPT's 4-trace lower bound (8.2%). Verdict: **GO to live confirm smoke.**
- ROOT CAUSE (verified in raw): agent launches `run_tests` via
  `exec_command({cmd:"run_tests", yield_time_ms:1000})` — codex yields after 1s with the shim
  still running, forcing 1-N `write_stdin({yield_time_ms:120000})` polls. The shim itself already
  blocks; codex's early yield is the cause. Fix = make the launch call use a long yield
  (config default if available, else a targeted FRAME line). NOT M± prose.
- Bar for the live smoke: poll turns drop toward ~0 AND solves unchanged on diagnostics+controls.
- Impl: gated FRAME line (SS_RT_LONGYIELD=1) — launch run_tests with yield_time_ms=300000 so it
  returns complete in one call. NOT in configHash (only image/testCmd/net + 4 rt-shim files are),
  so ledger stays valid. Gotcha found + fixed: MODEL must be `openai/gpt-5.6-luna` (pricing key),
  not bare id — bare id aborts every rollout at the pricing guard ($0 spent, caught pre-agent).
- LIVE smoke: RUN_ID=luna-poll-longyield-v1, tasks scoringutils+redboltz+dart, 12 rollouts. RUNNING.

### [LIVE WIN] Lever #1 auto-await — SS_RT_LONGYIELD=1 — solve-neutral, 62% fewer polls
- RUN_ID=luna-poll-longyield-v1, 12 rollouts, 0 errors, tripwire clean (landed=0).
- SOLVES held in BOTH arms: scoringutils 2/2, redboltz 2/2, dart 0/2 (identical to baseline).
- Matched poll census (same 3 tasks, both arms, 2 reps) baseline→treatment:
  poll turns 60→23 (**−62%**), poll$ $0.0266→$0.0071 (−73%), total spend $0.1279→$0.1086 (−15.1%).
- Poll-turn drop is a DIRECT mechanistic count (robust), not noisy aggregate cost.
- 23 polls remain (very-long suites exceed the 300s window / habitual short launches) → headroom
  for a V2 push, but 62% + solve-neutral is already shippable.
- NEXT: Gate-4 rotation on statamic+oceanparcels (fresh solved controls) + mransan (poll diag) to
  confirm generalization + solve-safety before committing the default.

### [GATE-4 ROTATION] Lever #1 — CONFIRMED + generalized (fresh tasks, 0 errors, tripwire clean)
- RUN_ID=luna-poll-longyield-rot; statamic+oceanparcels+mransan, both arms, 2 reps.
- SOLVES held in BOTH arms: statamic 2/2, oceanparcels 2/2, mransan 0/2 (identical to baseline).
- Matched poll census: poll turns **27→2 (−93%)**, poll-spend 13.8%→1.2%, total −23.1%.
- COMBINED (6 tasks, 24 rollouts, 2 cohorts): poll turns **87→25 (−71%)**; 4/4 solved controls
  held across both arms. Total-spend deltas (−15%, −23%) are small-n/partly noise; the poll-turn
  COUNTS are the robust mechanistic signal.
- V2 (push polls→0) NOT pursued: rotation already reached 93%; residual 2 polls = 1.2% of spend,
  marginal value negligible. V1 essentially solved it.

### [18-TASK SCREEN] Lever #1 — confirmed at scale (RUN_ID=luna-poll-screen18, 36 rollouts, 0 err)
- REPS=1 across all 18 tasks / 13 languages, both arms, SS_RT_LONGYIELD=1, ledger all-18 gold-valid.
- Poll rate (rep-independent): **23.1% → 10.8% of requests (−53% relative)**; poll-spend 15.9%→7.1%.
- SOLVE REGRESSION CHECK vs run1 baseline: PASSED. Every run1-2/2 task held 1/1 in BOTH arms
  (native + sweet: mqtt, robot, nvim, cms, scoringutils, parcels, gradethis; native also underscore,
  pytask, teleport). Sweet's only drops — underscore 1/2→0/1, pytask 1/2→0/1 — were ALREADY variance
  tasks (1/2) in baseline; 0/1 is within their coin-flip, not a treatment regression.
- Screen native 10/18 vs sweet 7/18 mirrors the pre-existing product gap (identical FRAME both arms —
  the treatment does not touch the A/B). Screen's 53% < micro-smokes' 62%/93% because the full set
  dilutes with low-poll tasks + averages partial model compliance. Robust at-scale confirmation.

## VERDICT
- **Lever #1 auto-await (SS_RT_LONGYIELD) = the night's win.** Solve-neutral, general, −71% poll
  turns. Committed GATED (not silently default-on — flipping default changes all future bench
  economics = user's call). Recommend: default-on in bench harness after one broader confirmation.
- Levers #2/#3/#4/#5/#6: $0-gated out tonight (dead / blocked / build-NO-GO / needs-approval).
  Method worked: cheap gates concentrated all live spend on the one lever that paid.

### [$0 GATE] Lever #5 retrieval-dedup — FAILED (killed for $0)
- Novelty census over 243 sweet ss-* calls: **0 exact-dup calls, 3% repeat-hit share, 124KB total
  payload.** No redundancy to remove; GPT's "modest savings" are ~zero here. DROP.
- Nuance: mransan r1's 24 ss-calls are 24 DISTINCT searches (0 dups) — a convergence/stop-policy
  problem, not a dedup one. Retrieval-thrash != redundant retrieval.

### [$0 GATE] Lever #4 repair-completeness card — mechanism CONFIRMED, build DEFERRED
- Ground truth (teleport injectFilesToPath in utils.ts): sweet matched existing files by
  `name` only; native+gold match by `name` AND `fileType`. Disambiguator = `GeneratedFile.fileType`
  (teleport-types/src/generators.ts:133 `fileType?: string`). A type-aware card for the edited
  symbol's operands WOULD surface it → mechanism sound.
- BUT: `findFileInFolder` (the name+fileType predicate) does NOT pre-exist — gold introduces it;
  the only in-repo signal is the TYPE. And it's 1/18 tasks (in-sample ceiling +2/36), needs
  format-gating (CLAUDE.md) to avoid NL regression. Matches GPT: research-GO, product-build NO-GO.
- DEFER build: no generalization cohort (Run #1 already proved underscore/gradethis are variance,
  not completeness). Revisit only if fresh DEV tasks show a second diet-starves-repair failure.

### [BLOCKED] Lever #2 verified checkpoint-on-green — needs instrumentation, not a tonight $0 gate
- edit-thrash-replay needs RETAINED INTERMEDIATE candidate patches (per-turn diffs graded); the
  luna run kept only FINAL patches. The $0 replay (EDIT_THRASHING.md 4.2) can't run on this data.
- Requires: add per-turn patch retention to the harness + a fresh run to capture replayable states.
  Larger than a micro-smoke; defer. (Trajectories DO hold apply_patch sequence — a future replay
  could reconstruct+grade intermediates on the box, but that's box-compute per edit, not $0.)

### [SUBSUMED/SCOPED-OUT] Lever #3 phase-aware eviction + span-capped fusion
- Dart's resident re-send is partly the run_tests poll/output tax → lever #1 attacks it directly.
- GPT already produced the $0 eviction ceilings (24-42% input avoided at 24-40K caps on dart) and
  the fusion-flips-positive-with-eviction economics. Full eviction engine + arm-symmetric live test
  + new ledger sweep is out of tonight's scope. Re-open after #1 lands (measure residual tail).

### [NO-GO tonight] Lever #6 conditional 2-candidate gen — needs explicit user approval (GPT + me agree)
- Compute-heavy, raises immediate generation/test cost, broad self-consistency NO-GO. $0 offline only.
