# Turn-fix Phase-0 replay RESULTS — 2026-08-03

Executed on the Mac against read-only copies of box data. $0 — no model call was made. All inputs
and outputs are development data (`DEV-RET`, Stage 1, the fragmented discovery baseline). No HO2
path was read; both replay tools enforce HO2-path refusal by construction.

**Provenance.** Inputs pulled from box `root@167.233.69.121`: global OpenCode DB
(`/root/.local/share/opencode/opencode.db`, 1.8G + 79M WAL), retired run dirs
(`heldout200-grok45-opencode-p7fs-{c1,c2rest}-20260726`), Stage-1 dirs
(`te-s1-{control,variant}-20260731`), the paired-19 aggregate
(`turnfix-discovery20-paired19-aggregate-20260803-v1`), and the full egress denial log
(2,292 rows since 07-29). Tools: `stats/edit-thrash-replay.mjs`, `stats/search-read-replay.mjs`
at working tree of `c1f972a` **plus the uncommitted ss-batch changes** — the "current version" in
§6 includes the dirty tree. An independent timing counter was written fresh for cross-checking.

## 1. The escape≠0 "gate failure" is instrumentation, not agent behavior

Per-task decomposition of the paired-19 escape counters plus the recorded examples:

- **Sweet (698 = 693 net-denied + 5 probes):** the denials are overwhelmingly
  `huggingface.co` dns/dns/tls triplets — machine retry signatures. Sweet's own
  model-fetcher (`core/infrastructure/config/platform.js:212` defaults
  `hfEndpoint: https://huggingface.co`) attempts revalidation from inside the jail; the jail
  env sets **no offline flag** (verified: no `OFFLINE`/`HF_` vars in
  opencode-task-runner/agent-jail). ~693/3 ≈ 231 connection attempts ≈ 12/task.
- **Native (186 = mostly net-denied):** `registry.npmjs.org` triplets — OpenCode's own
  npm-distribution chatter. Native has no sweet tooling; a .NET task (moq) has no reason to
  reach npm.
- The audit's `HARNESS_HOSTS` exclusion already covers `models.dev`/telemetry/sentry but not
  these two hosts. Neither arm's counts reflect model escape attempts.
- **Real agent attempts survive underneath, and the jail held all of them:** sweet 5 probes
  (incl. `ls .../results/turnfix-direct-d20-sweet…` and a `find` over bench results); native
  includes `rg -n "1259"` hunting for the issue number with a "vault manifest" comment.
  0 successful escapes, 0 leaks, 0 tripwire hits — unchanged.

**Verdict:** the written `escape=0` gate failed on polluted attempt counters. The baseline is
not behaviorally dirty; the counter is.

**Fixes required before the gate is re-armed:**
1. **Product/harness:** sweet must run fully offline when its model cache is complete — set
   `SWEET_SEARCH_HF_ENDPOINT` to an offline sentinel in the jail env, or add an explicit
   offline mode to model-fetcher. This is also a per-call latency suspect (denied dns+tls per
   invocation) — plausibly related to the historical unexplained ~7s eval-side `ss-grep`
   latency observation. Measure before/after.
2. **Egress guard:** log a per-jail/namespace source identifier per denial. Attribution today
   is wall-clock windowing over ONE global log while other box work (heldout2 ledger sweeps)
   runs concurrently — cross-attribution is structural.
3. Do **not** blanket-exclude `registry.npmjs.org`/`huggingface.co` in the audit: on JS/ML
   tasks those hosts can be genuine agent fetch attempts. Exclusion is safe only after
   per-jail attribution (fix 2) or an in-jail offline fix (fix 1) removes the infra source.

## 2. devlooped__moq-1259 — the tail, live, on native

Both arms **solved** it. Sweet: $1.69, 98 calls. Native: $5.38, 206 calls, 145 turns —
toolCounts: 35 edits, 26 test runs, 44 greps, 56 reads, exit `model_stopped`, with long
edit→test alternation runs late in the trajectory. This is the completion-tail pattern the
controller targets, demonstrated on the native arm — direct evidence the controller is
arm-symmetric in value, and the single task that carries the 19-pair aggregate cost win.

## 3. Stage-1 re-verifications — Codex's numbers confirmed

- **Timing (repair-starvation hypothesis):** three independent counters now agree — Codex
  (92%/75%, reads incl.), this session's fresh counter (91.7%/75.0%, post-edit retrieval
  10 v **30**), and edit-thrash-replay's classifier (115/10 v 92/30, fractions 0.92/0.754).
  The variant did 3× more post-edit retrieval and still thrashed. **Repair starvation stays
  rejected.**
- **Warning incidence:** **8/14 rollouts confirmed** (4 tasks per cell: nvim-bufferline,
  parcels, emittery, thelounge). New, stronger finding: on variant thelounge, tests 2-6 are
  ALL `trustworthy: false` — after the first test, the warning/tail interaction destroyed the
  authoritative baseline state on **5 of 6 test cycles**. The agent repaired blind. Same on
  control's second test. This upgrades the Phase-0a footer fix from "amplifier removal" to
  "restores the test signal at all".

## 4. Threshold fitting — honest null; enforcement stays OFF

`edit-thrash-replay` over 414 rollouts (400 retired + 14 Stage-1), 180 comparable cycles:

| H | exposed tasks | cycles | eventually solved | triggered before first passing patch | post-trigger unresolved $ |
|---|---|---|---|---|---|
| 2 | 14 | 16 | 6 | **1** | $1.21 |
| 3 | 2 | 2 | 1 | 0 | $0.02 |
| 4 | 0 | 0 | 0 | 0 | $0 |

- `advisoryThreshold: null` — selection is **not stable across folds**; exposure is far too
  thin. Composition: `failure_state_repeat` 68 dominates (same failures, different patch —
  the expected signature); oscillation detected only 1×, but the tool's own limitations
  apply: no retained intermediate diff hashes/patches in historical runs, so exact-state and
  A↔B detection are floors, and truncated outputs starve failure-signature extraction.
- **Decisions:** (a) historical data cannot fit H — the T0 telemetry ledger on fresh runs is
  the only path to a fitted threshold, exactly as the plan's staged design assumed;
  (b) advisory default stays H=2, live behavior selected only after T0 data;
  (c) **enforcement stays OFF** — 14 exposures with 1 premature trigger (7.1%) versus the
  required 59 zero-regression exposures.

## 5. Provisional budget candidates (replay priors, superseded by fresh baseline)

Pooled (n=414): turns p50 **19** / p75 **35**; test executions p50 **3** / p75 **6**.
Pre-frame native p50 19 / p75 32; pre-frame sweet p50 22 / p75 38. These are priors for
sanity-checking the fresh post-fix DISCOVERY-20 baseline, which remains the budget source of
record (pre-frame era is cost-contaminated; post-frame n=14 only).

## 6. The 551 search→read pairs — reproduced exactly; current-version elimination measured

Reproduction from the retired DB: **551 loose candidates — exact match** to the historical
count; 467 pass the strict all-targets rule; 294 envelopes contain multiple reads; all 551
safely replayable. Current-version elimination (`--execute-current` against 539 vaulted
pre-indexed goldens, strict criterion: the union of re-executed search outputs must contain
every historical read payload verbatim-normalized):

Final verdicts over all 551 candidates:

| verdict | n | share of decidable (432) |
|---|---|---|
| eliminated | 2 | 0.5% |
| partial | 7 | 1.6% |
| not_eliminated | 423 | **97.9%** |
| uncertain | 119 | (excluded from denominator) |

The 119 `uncertain` decompose into ~51 command-execution failures (historically malformed agent
regexes that fail under any version, plus a few `[ss] unrecognised option "--regex"` rows —
RESOLVED: the historical agent passed `--regex` to ss-grep, which never took that flag
(ss-find owns it); correctly rejected then and now, no current-version drift) and ~68
payload-extraction failures (older `ss-read` output format). Both are tool conservatism, not
signal.

**Interpretation:** under the strict payload-containment criterion, the current version
eliminates ~0.5% of the historical search→read pairs. The server-side fusion lever
(sufficiency-triggered full-span return, TURN_FIX_PLAN §4.4) has its addressable pool
essentially intact — the shipped within-file affordances did not, by themselves, make the
follow-up reads redundant at the payload level. Caveats: the criterion is strict (verbatim
payload containment); affordances may still reduce re-read *behavior* without containing the
payload — that is a live-run question, not an offline one. And the "current version" here is
the dirty working tree (uncommitted ss-batch changes).

## 7. FOLLOW-UP FINDING — the box model cache was missing during the fragmented baseline

Root-causing §1's HF traffic exposed something bigger: `/root/.cache/sweet-search` did **not
exist** on the box (verified 2026-08-03). Timeline evidence: the retired run (07-26) predates
the jail and had near-open egress, so sweet could self-download at runtime; the denial log
shows only 15 huggingface entries in the Stage-1 window (07-30) but 324 during the Aug-02
baseline fragments. The likely eraser is the Aug-01 disk-space emergency cleanup. Consequences:

1. **The Aug 1-3 sweet baseline arm ran without its model cache.** In-jail HF fetches were
   denied per invocation. A live cold `ss-search` on the box took **38.9s wall / 0.2s CPU**
   (network-timeout-bound); warm 4.0s. Inside 90-minute task limits this is a material latency
   tax on the sweet arm — and search ranking may have been degraded (the query still returned
   `routed=hybrid` ranked results, so the degradation mode/quality impact needs one focused
   check before the fresh baseline). The paired-19 diagnostic gains ANOTHER asterisk.
2. This is the strongest candidate yet for the historical "~7s eval ss-grep latency" mystery.
3. **Actions taken (2026-08-03, disclosed):** the diagnostic query itself partially populated
   the cache (config.json + one optimized artifact — host egress is open; only jail egress is
   denied). I then restored the full model cache from the Mac
   (`rsync ~/.cache/sweet-search/models/ → box`, minus the Apple-only coreml-cascade — same
   recipe as the RunPod golden-build setup).
4. **Product fix shipped:** `SWEET_SEARCH_OFFLINE=1` in model-fetcher — fails fast on a
   cache miss with no network attempt, wins over `allowDownload`; cached files serve normally
   (tests: model-fetcher suite 13/13).
5. **Pending (frozen-surface reopen required):** one env line exporting
   `SWEET_SEARCH_OFFLINE=1` into the rollout jail (opencode-task-runner/agent-jail), and
   per-jail source tagging in the egress guard. Both need the explicit unfreeze the frame
   clause and shim received. Any harness change re-sweeps the ledger (green-ledger invariant).
6. **Standing rule this implies:** box preflight must assert model-cache presence + a warm
   sub-second probe query before any paid run — the golden-staging blind spot, but for models.

## 8. Box housekeeping observed (no action taken)

- Leaked `agent-jail-init.mjs` process (PID 3382655, since Aug 01, idle) + three leftover
  `/root/.ss-eval/runs/` rollout dirs (apigee, helidon, simdjson).
- The denial log is global and shared across concurrent box workloads — see §1 fix 2.

## 9. Addendum — a second latency lead (post-restore)

After the model restore, wrapper queries still take exactly **4.007s** wall (three separate
invocations, ~0.07s CPU), with **no persistent search-server process** on the box between
calls. A fixed ~4-second startup/poll constant in the wrapper→server auto-start path is the
next latency suspect, independent of the HF-timeout issue. Also note: identical result +
identical score across pre- and post-restore queries means the ranking-degradation question
(§7.1) is NOT yet settled by the live probes — settle it with a controlled Mac A/B (same
golden, models present vs `SWEET_SEARCH_OFFLINE=1` + masked cache) before the fresh baseline.

## 10. Clean-baseline trace forensics (2026-08-04, 18 pairs)

Phase decomposition (locate = before first edit; repair = after; per-turn ledger pricing):

| metric | native | sweet |
|---|---|---|
| turns | 394 | 509 (+29%) |
| tool calls (envelopes) | 705 | 592 (−16%) |
| calls/turn (median per rollout) | **1.64** | **0.98** |
| median context in/turn | 49,230 tok | **44,106 tok** |
| median context growth/turn | 1,672 tok | **1,254 tok** |
| steps to first edit (median) | 17.5 | **8.0** |
| locate-phase retrieval ops | 292 | 194 (−34%) |
| repair-phase retrieval ops | 255 | 245 (flat) |
| edits / tests | 96 / 62 | 84 / 69 |
| locate / repair cost share | $2.47 / $12.35 | $3.51 / $15.32 |
| zero-call turns | 9% | 7% |

**Findings.** (1) Retrieval superiority is confirmed in-run: sweet reaches its first edit in half
the steps with a third fewer locate probes, edits less, and solves one more task. (2) The WIDTH
hypothesis is REFUTED: sweet's context is narrower and grows slower — packed results beat native
file dumps, as designed. (3) The entire cost gap is TURN STRUCTURE: sweet runs ~1 call per turn
vs native's 1.64, paying +29% full-context re-sends at ~44k tokens each. First-order
counterfactual: at native's call density sweet's 592 calls need ~361 turns — fewer than native's
394 — flipping +24% cost into roughly −10% at equal solve. (4) Repair is ~80% of spend on BOTH
arms; sweet does not thrash more in aggregate, but on moq it localized late (turn 16 vs 5) and
repaired messy (30 edits/23 tests vs 15/7) — tail variance decides signs, third run running.
Consequence for the program: the packing cell (ss-batch, adoption 8/8) is now the FIRST paid
priority; the controller second; no width work needed.

## 11. Packing-lever verdict (2026-08-04): DEAD on Grok-4.5, twice-tested

Screen c (original guard): ss-batch adoption 8/8 eligible, result tokens −41%, but 4/4
dependency traps packed. Screen e (hardened explicit argument-visibility guard + tolerant
subset broker matching): adoption 8/8 again, tokens −33%, operations ratio 1.03 — and **3/4
traps still packed under maximal instruction**. Total spend across both screens: $1.73.

Conclusion: Grok-4.5 eagerly adopts batch surfaces but speculatively includes operations whose
arguments it cannot yet know, and prompting does not fix it. An adopted-but-unsafe batch tool
on real tasks produces invented-argument probes; the paid packing cell is therefore cancelled
for this backbone, permanently, per the pre-registered stop rule. The adoption and token
evidence is preserved: re-screen ss-batch per backbone (~$0.80) before any future packing cell
elsewhere. The turn-structure cost gap (§10) remains real; the surviving levers are the
advisory controller (T1 cell launched 2026-08-04) and server-side structural turn reduction
that needs no model cooperation (dependent search→read fusion; pool 97.9% intact per §6).

## 12. Footer cell (T1) verdict — 2026-08-04: first treatment WIN, beats native on all axes

Advisory progress controller (telemetry+advisory, H=2), sweet arm, single variable vs the clean
baseline, $8.67 realized:

| paired vs | pairs | cost | solve | calls |
|---|---|---|---|---|
| untreated sweet | 19 | **$8.67 vs $13.72 (−36.8%)** | **7 vs 6** | 496 vs 646 (−23%) |
| native | 18 | **$7.49 vs $10.34 (−27.6%)** | **6 vs 5** | 436 vs 705 (−38%) |

Solves went UP under the controller — the over-stop failure mode did not materialize; kompendium
(untreated-sweet fail) now solves. Tail collapse as designed: moq $7.00/254c → $1.36/71c. Caveats:
n=18/19, one rep, tail-enriched dev cohort, behavior-gate/ledger analysis pending; CONFIRM-28
remains the confirmation stage. This is the first configuration in program history where sweet
beats native on cost, solves, and calls simultaneously under clean counters.

### 12.1 Outlier-excluded correction (user-demanded, same discipline as prior runs)

| paired vs | ALL tasks | excluding moq |
|---|---|---|
| untreated sweet | −36.8% cost, solve +1 | **+8.8% cost**, solve +1 (6v5), cheaper on 7/18 |
| native | −27.6% cost, solve +1 | **+6.0% cost**, solve +1 (5v4), cheaper on 6/17 |

Without moq the cost win disappears: the footer adds a small overhead (~$0.1-0.5) on non-tail
tasks (its own appended text/turns) and the aggregate saving is one capped tail. Fourth
consecutive run where a single trajectory decides the aggregate sign. Interpretive tension,
stated honestly: tail-capping IS the controller's mechanism — excluding the tail excludes the
treatment target, and the plan's confirmation statistics deliberately use untrimmed sums for
exactly this reason — but ONE capped tail is one observation, the footer also MISSED a tail
(bfgroup ran $2.48/59c under treatment), and the non-tail overhead is real. Verdict: mechanism
demonstrated, reliability and overhead unproven; NOT ready for CONFIRM-28. Next: $0 ledger
analysis (trigger precision, bfgroup miss, overhead source), then footer-variant micro-smokes
on the exact failure sites (moq=cap, bfgroup=miss, apigee/py-cov=overhead) per the trap-first
protocol.

### 12.2 REVERSAL — the footer run was an accidental A/A test; the "win" is the noise floor

Ledger forensics on all 21 sessions / 94 invocations: **guidance = 'none' on every invocation.
The advisory never rendered; the model never saw the controller.** Model-visible config was
therefore identical to the baseline run. Every §12 delta — the −37%, the moq collapse, the +1
solve — measures RUN-TO-RUN VARIANCE at identical config, not a treatment effect.

Why the controller was structurally inert on this cohort:
1. **Trust starvation (moq-class):** every moq invocation had `trustworthy:false` (baseline-diff
   null on all 15 test calls) — untrusted cycles pause the streak by design, so the thrashiest
   task is precisely the one the controller cannot see. Investigate moq's baseline classification
   (volatile .NET signatures suspected).
2. **Stop-when-green was never implemented:** `advisoryGuidance` has no pass-state branch;
   bfgroup PASSed 5 trusted times and ground on for 59 calls with no rule existing to catch it —
   an unimplemented spec item (EDIT_THRASHING §6.3), not a tuning miss.
3. On trusted, non-tail tasks, no streak ever reached H=2 — tasks finish first. The advisory's
   addressable surface on this cohort was ~empty.

**The silver lining is paper-grade:** an accidental A/A at n=19 quantifies the bench noise
floor — aggregate cost ±37%, one task (moq) at $1.69 / $7.00 / $1.36 across three
identical-config runs, solve ±1. No single-rep n≈19 run can support a cost claim on this bench;
REPS≥2 or larger cohorts are mandatory for every future stage, including CONFIRM-28's design.

Defect-driven iteration list (micro-smoke protocol): D1 relax/repair baseline trust on
volatile-signature tasks; D2 implement the pass-state rule; D3 re-test on the three named sites
(moq=trust, bfgroup=green-grind, apigee=overhead) with ≥2 reps per site before any full cell.

### 12.3 Controller v2 + the exposure preflight that was missing (2026-08-04)

Both defects fixed and tested (rt-progress-v2, 16/16): count-summary trust fallback (D1 —
moq-class suites get a stable counts comparable, controller-only, checkpoints stay names-only)
and the pass-state green rule (D2 — review-then-submit from the second consecutive trusted
PASS). Offline exposure replay over the footer run's own ledgers: **v1 fired 0 times; v2 would
have fired 10 times on 5 of 19 tasks** (bfgroup green×4 — the 59-call grinder; luigi
recovery+restore; stingray recovery×2; cedar recovery; tablib green). moq would still not have
fired — its cheap footer run was genuine luck (state changed every cycle), reinforcing its
exclusion from live smokes. STANDING RULE, now satisfied for the first time: no treatment cell
launches without a $0 ledger-replay demonstrating nonzero trigger exposure on the target tasks.
Fingerprint v2 changed configHash → ledger re-sweep required before the next live run. Proposed
micro-smoke set (moq EXCLUDED per user): bfgroup + luigi + stingray + cedar — exactly the
would-fire tasks — ≥2 reps each (~$3-5), awaiting explicit authorization.

### 12.4 Advisory micro-smoke (4 tasks × 2 reps, moq excluded) — mechanism PROVEN live

$2.35, 7/8 rollouts (bfgroup rep0 died at OpenCode preflight, $0). **First live advisory
renders in program history:** bfgroup rep1 saw green.review-then-submit at test-calls 2/3/4 and
finished at 32 agent calls vs 59 in the footer run (−46% on the exact green-grind case);
stingray saw green at 5/6, one retest, done. Solves 0/7 — identical to this quartet's history
in both prior runs (never sweet-solved); no over-stop evidence. Recovery/restore paths did not
fire live this run (cycle variance) — still unexercised. Finding for the next wording
iteration: the model SEES a bare token (`action=green.streak-2.review-then-submit`), not the
spec's imperative sentence — it retested twice after the first nudge before stopping. Next:
render guidance as a short imperative sentence, rerun the quartet (~$2.50) until green AND
recovery each show ≥2 live fires with compliant next-actions, then the full 18-task footer
re-run (real T1, moq excluded).

### 12.5 Micro-round 2 (sentence-rendered advisory) — compliance REFUTED on Grok-4.5

$1.40 ($4.85 across both rounds). Rendering verified end-to-end in the OpenCode transcript: the
model saw `note="...submit now - further edits are not improving anything"` on consecutive
passes. Behavior: bfgroup received the imperative FIVE times and produced its longest grind
ever — 62 calls/$1.72 (vs 32c round 1, 59c unadvised, 33c baseline); stingray edited after
being told to submit. Quartet economics across four runs bounce inside noise regardless of
advisory version. Also: 3 rollouts died at OpenCode boot ("pinned 1.18.4 unavailable") — a
concurrency-2 boot race; micro-cohorts run CONCURRENCY=1 from now on.

**Cross-mechanism finding, now 3-for-3:** Grok-4.5 ignores mid-task behavioral instructions
regardless of channel — memory-file packing prose (inert), tool-description dependency guard
(3/4 traps violated), tool-output imperative advisory (5× ignored). This is a backbone property,
not a wording deficiency; the wording-iteration curve has enough points. Cooperation-DEPENDENT
levers are closed on Grok-4.5. Remaining live levers are cooperation-FREE: (a) runner-enforced
hard turn budget (EDIT_THRASHING §7 — the runner stops at the cap; budget_exhausted is a scored
outcome; no compliance involved), (b) server-side search→read fusion (97.9% pool, zero model
involvement), (c) backbone change (Luna re-screen $0.80). Advisory mode remains harmless
telemetry; enforcement was never enabled.

## 13. Hard turn budget (cooperation-free lever) — retro analysis and implementation

**Implementation:** `SS_HARD_TURN_CAP` → OpenCode `agent.build.maxSteps` (the loop owner enforces;
no model cooperation involved). Env-gated, absent-by-default config is byte-identical; rows carry
`hardTurnCap` + `budgetExhausted`. 17/17 tests.

**Retro preflight over all 68 recorded rollouts** (pooled turns p50=18, p75=32, p90=54, max=184):

| cap | rollouts cut | ledger cost saved (of $38.05) | solved rollouts over cap |
|---|---|---|---|
| 32 (p75) | 14 | ~$24.76 (65%) | 6 |
| 45 | 8 | ~$19.00 (50%) | 4 |
| 60 (~p90) | 4 | ~$14.61 (38%) | 4 |

**Last-edit refinement (grade-at-cut):** a cut rollout keeps its solve when its final source edit
landed before the cap. At cap=60: helidon (last edit 38), raml (27), kompendium (59), and the
footer-run moq (45) all KEEP their solves; only the ultra-deep moq runs die (sweet last edit 177,
native 117). moq's own solve depth is stochastic (45 vs 177 across identical-config runs) — under
a cap it becomes a coin flip instead of a guaranteed deep grind. Recommendation: **cap ≈ p90 (≈60
on this tail-enriched cohort; recompute pooled p90 on any new cohort), grade-at-cut, both arms,
same numeric cap** — trades moq-class coin-flip solves for capping the exact runs that decide
every aggregate sign. On a true 20%-tail population both the saving and the risk shrink
proportionally. p75 caps fail solve non-inferiority outright on this cohort and are rejected.

Operational smoke (deterministic cap-hit at cap=10 on luigi + no-op parity at cap=200) validates
the stop/grade path; statistics come later from a properly-powered cell with REPS≥2, per the
noise-floor rule.

### 13.1 Operational validation (2026-08-04, $0.51) — the lever is live

Cap-hit half (luigi, cap=10): OpenCode stopped at exactly 10 turns; `budgetExhausted:true`,
`hardTurnCap:10` recorded; row gradeable and graded; cost mechanically cut ($0.16 vs ~$0.25
typical). No-op half (cap=200): 18 turns / 22 calls / $0.35 — inside luigi's historical band;
`budgetExhausted:false`. The hard turn budget is fully operational end-to-end. Pending one human
decision: the powered capped cell — cap = pooled p90 recomputed on the target cohort,
grade-at-cut, both arms, REPS=2, moq's interpretation pre-registered (its deep solves are the
known intentional casualty class).

## 14. PRE-REGISTRATION — capped cell + Luna probe (written before any outcome, 2026-08-04)

**Capped cell** (`turnfix-capcell44-20260804`): 18 tasks (discovery cohort minus moq — excluded
per standing user instruction; its deep-solve casualty class is already characterized), both
arms, REPS=2, CONCURRENCY=2, `SS_HARD_TURN_CAP=44` (pooled p90 over all 55 moq-free rollouts:
p50/p75/p90/p95 = 17/32/44/54 — the p90 rule was fixed in §13 before this computation),
telemetry on (model-invisible, A/A-proven), fresh v4 ledger sweep. Predeclared analysis:
paired vs the clean baseline and vs same-run native; primary = cost per assigned task
(untrimmed sums) + solve non-inferiority; budgetExhausted rollouts scored, never excluded;
known risk = kompendium-class solves with last edits past turn 44. Expected from retro:
~25-35% cost reduction class. Boot-race repairs (if any) rerun identically, once.

**Luna probe** (`turnfix-luna-probe-20260804`): 3 historically-sweet-solved tasks
(cccl/camel-k/tablib), sweet arm, 1 rep, ~$0.10 total at Luna's $0.10/$0.60 rates.
CAPABILITY PROBE ONLY — Luna-on-OpenCode contradicts the multi-harness routing policy
(GPT→codex), so nothing here is a bench claim. Readouts: does it run at all, calls/turn
profile (does it parallelize bash where Grok won't), cost/task, qualitative
instruction-following. Decides whether dev iteration moves to a 10-20× cheaper backbone.

### 14.1 Luna probe result (capability only, $0.014 total)

3/3 SOLVED on historically-sweet-solved tasks, sane trajectories, healthy ss usage (4-7
calls/task): cccl $0.0052 (Grok $0.122), camel-k $0.0046 ($0.042), tablib $0.0039 ($0.175) —
**9-45× cheaper per solved task at equal outcomes.** Calls/turn 0.85-1.15: Luna does NOT
parallelize bash either, so the turn-structure gap likely persists — but at $0.10/M input the
re-send tax is financially negligible, which makes the entire turn-economy problem nearly moot
on this backbone. Implication (decision for the user): move dev iteration/micro-smokes to Luna
(pennies per round), keep Grok for the redemption-story confirmations. Caveats: 3 easy tasks,
1 rep, Luna-on-OpenCode contradicts the routing policy — a proper Luna arm needs the codex
harness per policy, or a policy amendment.

### 14.2 Capped cell FINAL (35/36 pairs, 2 reps, ~$25.5) — NULL on cost; the cap needs the tail it excluded

| paired (n=35) | sweet+cap44 | native+cap44 |
|---|---|---|
| cost | $12.58 | $12.01 (ratio 1.047) |
| solve | 8 | 11 |
| calls | 780 (−32%) | 1144 |
| median cost | **$0.175** | $0.188 (sweet cheaper — first time; 16/35 tasks) |
| budgetExhausted | 5 | 1 |

Sweet-capped vs sweet-uncapped, same 18 tasks (rep-avg): cost $6.75 vs $6.72 (FLAT), solve 4.5
vs 5 (raml lost 0/2 vs solved uncapped; kompendium gained 1/2). **Interpretation: with moq
excluded per standing instruction, the moq-free p90 cap (44) binds on only 6/70 rollouts and
truncates runs near their natural end — the treatment's target WAS the excluded task. The cap
is a null treatment on a tail-free cohort, with a real casualty risk when it does bind (raml).
Same lesson as the outlier-cut correction, from the other side: the tail is both the noise AND
the treatment effect; excluding it excludes both.** Solve reading across both clean 2-rep-era
runs: baseline sweet +1, this run native +3 — pooled, solve parity within the ±1-2 noise band;
neither arm has a demonstrated solve advantage on this cohort.

**PROGRAM VERDICT on Grok-4.5 turn-economy levers, all tested:** prompt packing DEAD; ss-batch
DEAD (unsafe speculation); advisory DEAD (instruction-deaf); hard cap NULL-to-risky on
tail-free cohorts, only pays where moq-class tails are in scope. The defensible clean-data
claim stands unchanged: **cost parity, solve parity, −16 to −32% calls, 2× faster
localization, narrower context.** The wide-margin cost win does not exist on Grok-4.5 via
turn economics. Remaining paths: (a) Luna-class pricing makes the re-send tax financially
irrelevant (9-45× cheaper per solve, probe-verified); (b) server-side search→read fusion
(pool intact, model-free); (c) run headline comparisons WITH moq-class tasks in scope, capped,
where the cap provably pays.

## 15. Solve-divergence forensics (workflow, 3 agents, $0 bench spend) — why sweet solved less

The entire 3-solve gap = three rollouts, fully diagnosed from complete transcripts:

**raml (2 of the 3):** retrieval PERFECT in all runs — sweet found NumberTypeRule.java at turn
2-3 every time. The solved sweet run ran `ss-trace` (fan-out=1) and scoped the edit to the one
gold file. Failed rep0 skipped the trace, shotgun-edited 5 rule files before first test, then
misread a reformatted target-failure as a new regression and chased it into the cap. Failed
rep1 made ZERO edits in 31 calls — read-only analysis paralysis, aggravated by ~6 turns lost
to `ss-read` (start,count) argument errors [product fix shipped]. **The M± discipline, when
followed (trace-then-scope), was exactly what solved the task; the failures deviated from it.**

**express (the 3rd; sweet 0-for-3 lifetime):** retrieval perfect again (prepareOutput.js,
sufficient=YES). Sweet declared its fix shape BEFORE any evidence ("I'll ... with a sync
fallback"), then searched only to rubber-stamp arity/callback dispatch; native checked repo
conventions and shipped the gold Promise/thenable shape. Sweet's own tests passed — wrong
contract, graded fail. **Premature closure on a design-shaped task: the speed that wins locate
tasks becomes anchoring on design tasks.**

**Research (sourced):** OpenAI GPT-4.1 guide — persistence + plan/reflect instructions ≈ +20%
SWE-bench Verified combined (planning alone +4%); ContextBench (2602.05892) — retrieval-step
count correlates positively with Pass@1; aggressive search minimization measurably degrades
solve rate; recommended consolidation-not-truncation wording. Anchoring literature warns naive
"consider alternatives" nudges can backfire — test, never assume.

**THE deep answer to "why don't we solve more":** sweet's prompt optimizes the locate phase and
is silent about the design/repair phase. Retrieval is never the failure site — commitment
quality after retrieval is. This is finally a lever Grok CAN respond to: system-prompt-level
guidance demonstrably steers this model (the whole ss-* discipline proves it); only MID-TASK
injected instructions are ignored.

### 15.1 Micro-smoke design (user's method; launched)

Variants as M± file variants (production M± untouched), config identical to the capped cell
(cap=44, telemetry on) so the cell's own sweet rows are the free 2-rep control:
- **V1 completion-discipline:** persistence + plan/reflect block (GPT-4.1-sourced, adapted) —
  targets raml-rep1 give-up.
- **V2 fix-shape-discipline:** locate-vs-design carve-out + repo-convention check before shims +
  contract re-read + trace-before-multi-file-edit — targets express anchoring + raml-rep0
  shotgun.
Tasks: express + raml (treatment targets), tablib + camel-k (controls, sweet always solves).
2 reps each, CONCURRENCY=1, ~$4 total. Gates: a variant must flip a target task without
breaking a control; winners then face the full 18-task screen before any confirmation claim.

### 15.2 Micro-smoke results (V1 + V2, $4.96) — BOTH variants hit their targets; controls intact

| task | control (capped cell) | V1 completion | V2 fix-shape |
|---|---|---|---|
| express (design-anchor target) | 0/2 | 0/2 (not its target) | **1/2 — first sweet solve EVER (0-for-3 lifetime)** |
| raml (give-up/shotgun target) | 0/2 | **2/2** | 1/2 |
| tablib (control) | 2/2 | 2/2 | 2/2 |
| camel-k (control) | 2/2 | 2/2 | 2/2 |
| total | 4/8 | **6/8** | **6/8** |

Signature is textbook: each variant flipped the failure mode it targets, V1 left the
design-task alone exactly as predicted, no control broke, cost per task ~flat. Both effects
match the forensic diagnoses (persistence fixes the zero-edit stall; convention-check +
trace-scoping fixes anchoring/shotgun). Small n (2 reps/cell) — treatment-target flips of
0/2→2/2 and 0-for-3-lifetime→1/2 are strong signals but not confirmations.

Next ladder rungs (in order): (1) V1 content migrates to the FRAME (both arms — bench-specific
per the M±-generality rule; frozen-surface reopen + both-arms rerun); (2) V2 (bench-agnostic
wording) advances to the full 18-task screen as an M± candidate; (3) a V1+V2 combined cell;
(4) only a screen winner faces CONFIRM-28. Luna after, per user sequence.

## 16. Fusion-v1 interim (2026-08-05): implementation sound, aim likely under-scoped

SWEET_SEARCH_FUSE_TOP=1 (top-1 cap 2000→8000, floor 4000) verified functional end-to-end
(deploy hash matched; no crash — an early 0-byte result was a server race). But offline
evidence says the binding site is narrow: test queries use a fraction of budget (top-1 rarely
truncated), the resumed 551-replay showed 0/59 early eliminations, and §6 already recorded
294/551 pairs as MULTI-file reads that top-1 fusion cannot cover. Offline replay abandoned
(low information per minute; also SIGKILLed once on the Mac). **The live fusion micro-smoke
(read-heavy tasks, running) is the arbiter: if sweet's ss-read counts and cost do not drop,
fusion-v2 = reference-batching (LLMCompiler-style server-resolved refs) or top-3 fusion —
pre-registered here before the smoke's outcome is known.**

## 17. Ladder results (2026-08-05, ~$18): fusion-v1 RETIRED, frame-reflect mild, V2 SCREEN POSITIVE

**Fusion smoke — NULL, exactly as the §16 pre-registration feared.** ss-call counts unchanged on
the read-heavy targets (py-cov 39 v 35, cedar 24 v 21), cost and solves identical. Per the
pre-registered arbiter: fusion-v1 (top-1 cap raise) retires; fusion-v2 = reference-batching
stays designed-but-unscheduled. Top-1 truncation is not why agents re-read.

**Frame-reflect smoke — directionally positive, mild.** sweet raml 0/2→1/2 (weaker than
V1-as-M±'s 2/2 — note the content differed: the frame clause dropped the persistence sentences
the frame already had), native unchanged at 7/8 (no harm, raml cost −44%), controls intact.

**V2 screen (18 tasks, 2 reps) — the best full-cohort sweet result to date:** solves 10 v 9,
cost **$11.51 v $13.50 (−15%)**, avgCalls 19.5. Flips: raml 0→2 (trace-scoping works at scale),
tablib 2→1 (one control rep lost — within the known per-rep coin-flip range; tablib solves 2/2
everywhere else). Express did not flip at screen scale (its micro 1/2 was one rep). Honest
read: +1 solve is inside solve noise; the −15% cost with a solve gain is the strongest joint
signal any variant has produced. V2 is the standing champion candidate.

Next decision menu: (a) V1(frame)+V2 combined 18-task cell (~$12); (b) CONFIRM-28 with V2
(pre-registered stage, ~$25, 2 reps now mandatory → ~$50 — needs budget sign-off);
(c) Luna track. Spend this ladder ≈ $18.

## 18. Cost-thrash forensics (workflow, 5 agents, $0 bench) — where the 72% goes

72% of V2-screen sweet spend was on FAILED rollouts. Four costliest failures traced vs their
native counterparts. **The cost sink is NOT one phase — it splits three ways:**

| task | verdict | mechanism |
|---|---|---|
| registry-994 | RETRIEVAL (2° repair) | toured 10 of 14 sibling rule-packages in full before writing (27 of 43 turns pre-write); then post-PASS re-exploration to the cap |
| b2-259 | RETRIEVAL (pure) | 30 calls reading 5 interlocking .jam files, **never edited, never tested** — analysis paralysis |
| kompendium-208 | TOOL FRICTION | 3 chained `ss-read`s in one bash call → combined output truncated → file 2/3 unseen → **blind edit at call 6**, then thrash |
| py-cov | REPAIR (Coherence Collapse) | produced a passing fix, then `git checkout -- file` **discarded its own passing edit** — native did the identical self-revert |

**Cross-cutting product bug in 3 of 4: `ss-read` friction.** (a) chained multi-file reads
truncate silently → blind edits (kompendium); (b) arg-semantics flip between count and end
depending on end<start vs end>start, so the agent can't predict slice size (registry); (c)
unfollowed `# unread below` pagination trailers leave files partially read (registry, b2). This
is a sweet-ONLY product surface — fixing it is a pure win, no both-arms cost, no model
cooperation.

**Verdict on the two proposed optimizations, from the traces:**
- **Drop rank 2/3 bodies (adaptive budget):** RISKY, not a clear win. 2 tasks neutral (agent
  never read rank 2/3), 1 would-help (kompendium), 1 would-HURT (registry — rank 2 was
  load-bearing and top-1 never dominated: every search returned `confidence=low
  (many_candidates)`). Only safe under a strict dominance+sufficiency gate that, by construction,
  rarely fires on the hard tasks where cost actually concentrates. Low priority; ship behind a
  flag with pointer-lines (not deletion) if at all.
- **Line-numbered ss-read:** supported but secondary. The real ss-read damage is truncation +
  arg-semantics, not missing line numbers. Line numbers help the edit phase; fix truncation
  first.

**Research (Coherence Collapse 2603.24631):** 60-69% of capable-model failures reach and edit
the right code then corrupt it; the py-cov self-revert is this exact mode; the paper's
edit-checkpoint (freeze a test-passing state so a later edit can't destroy it) recovered 5/5 —
mechanism promising, n small.

### 18.1 Targeted micro-smoke slate (ranked; awaiting go)
1. **P (product, $0 build + ~$2 smoke):** ss-read fixes — never truncate a chained/multi-file
   read (auto-split or loud per-file flag), make arg-semantics deterministic, surface unread
   trailers harder. Sweet-only, zero risk to native. Targets kompendium + registry + b2.
2. **V3 (M± retrieval discipline, ~$2 smoke):** "once you have 1-2 exemplars of a pattern, stop
   reading siblings and start writing; scan the pack you already have before a new search."
   Targets registry + b2 retrieval-tour. General, ships in M±.
3. **C (frame checkpoint clause OR harness checkpoint, ~$2 smoke):** "once tests pass, do not
   discard or rewrite the passing change." Targets py-cov. Bench-completion content → frame.
Controls: tablib + camel-k. All 2 reps, CONCURRENCY=1. A fix must flip a target without
breaking a control before it earns the 18-task screen.

## 19. Cost-thrash micro-smoke batch (2026-08-05, ~$18): P & V3 clean, C half, STACK regressed

| variant | cost vs ctrl | solves | verdict |
|---|---|---|---|
| P (line-numbered ss-read, SS_READ_LINENUMS) | −16% | held | CLEAN WIN — advance |
| V3 (exemplar-stop M±) | −13% | held, retrieval-tour cut | CLEAN WIN — advance |
| C v1 (checkpoint frame) | ~flat | killed self-revert (1→0) but kept-editing-past-green still failed py-cov | half; v2/v3 wordings testing |
| STACK (P+V3+C) | −14% | **kompendium 1/2→0/2 REGRESSION** | do NOT ship as-is |

**Key finding — the clauses interact.** P and V3 each hold solves alone; combined (+C) they
over-constrained kompendium and lost its solve. Champion is **P+V3, not the full stack**, and
even P+V3 needs a clean-combination smoke before trust.

**Packing measurement that redirects the turn lever (§18 follow-up):** 84% of sweet's
ss-bearing bash calls ALREADY pack 2+ ops (&&/; chains); 92% of assistant messages are
single-envelope but each is a fat chain. There is almost no independent-op headroom for
wording — the residual turns are DEPENDENT hops (search→read→edit). Wording cannot pack a step
that needs the prior step's output. Turn lever = server-side fusion of the dependent
search→read hop (fusion-v2, multi-file — v1 only did top-1), NOT packing prompts. Also queued
(user): OpenCode enforces parallel tool calls on its FIRST-CLASS tools (native grep/read/edit);
sweet's ss-* are bash-hidden so likely invisible to that machinery — explains native 1.64 vs
sweet 0.98 calls/turn. Test: mimic OpenCode's batch wording in frame, or expose ss-* as
first-class tools (MCP path). Both after current smokes.

### 19.1 C-wording round (v2 stop-at-green, v3 fragile-state) — py-cov is a POISONED target
Both wordings: py-cov 0/4, camel-k control full. py-cov's run_tests shows AUTHORITATIVE PASS
(banner present) that does not match gold grading — a false-pass / grader-suite mismatch no
"stop at green" wording can fix (submitting green submits a gold-FAIL state). C's true verdict:
UNTESTED on a clean self-revert task, not disproven. Re-test C on a task where run_tests
PASS == gold before any judgement. Checkpoint as a HARNESS feature (freeze/grade the
passing intermediate, Coherence-Collapse style) remains the non-prompt path.

## 20. OpenCode batching prompt (user hypothesis) — RESOLVED: the calls/turn gap is a counting artifact

OpenCode's embedded system prompt (both arms use it) mandates verbatim: "When making multiple
bash tool calls, you MUST send a single message with multiple tool calls to run the calls in
parallel." So batching is ALREADY instructed on both arms. Native satisfies it with multiple
bash/grep ENVELOPES per message; sweet satisfies it with one bash envelope that &&-CHAINS
several ss-* ops (the measured 84%). Both = ONE model turn. The native-1.64 vs sweet-0.98
calls/turn "gap" is therefore substantially a COUNTING artifact (envelopes vs chained-ops), not
a real turn deficit — sweet already obeys the same batching instruction native gets. Mimicking
native's envelope form changes how packing is COUNTED, not the turn count or cost. **Packing
lever closed for the 3rd time, now with the mechanism: nothing to pack that isn't packed; the
metric was miscounting.** Real cost levers remain: P (line-numbers, shipped), V3 (exemplar-stop,
shipped), server-side fusion-v2 of dependent search→read hops, and killing failed-task thrash
(72% of spend). MCP first-class ss-* tools would only change counting, not turns — deprioritized.

## 21. Overnight generalization loop (2026-08-06)

### Wave gen — champion (P+V3) on 6 FRESH (never-tuned) tasks
Solves 4/12 vs control 4/12 — IDENTICAL, no solve regression on fresh tasks (clean generalization
of the no-harm property). Cost $2.97 vs $2.35 (+26%) but **CONFOUNDED**: overnight cap=60,
control cap=44. helidon (only task long enough to reach either cap) ran 60 vs 44 turns → +$0.66,
the entire aggregate delta. Cap-irrelevant short tasks (php-scoper/node-convict/ta4j/tslint) are
flat-to-better (tslint −32%). Honest verdict: P+V3 do NOT regress solves or cost on fresh tasks;
the cost win seen on TUNING tasks (−13/−16%) did NOT reproduce as a clear win on fresh tasks —
champion is roughly NEUTRAL on cost when generalized (helidon confound removed). METHODOLOGY
NOTE: overnight cap should have matched control cap; treat all overnight cost deltas as
cap-confounded for any task that can reach 60 turns; solve deltas are clean.

### Wave thrash — champion (P+V3) on 4 costly failures
Solves 0/8 vs control 1/8 — champion LOST kompendium (1/2→0/2, SAME regression as STACK but now
WITHOUT C). registry/b2/py-cov stay 0/2 (retrieval-tour + false-pass — champion doesn't target
these). Cost cap-confounded. **KEY: P+V3 COMBINED regresses kompendium consistently (STACK + this
wave) — the two clean individual wins (P −16%, V3 −13%) do NOT compose cleanly. V3's
stop-reading-siblings + P interact to cut kompendium's multi-file fix short. Champion should be
P-ALONE or V3-ALONE, not both. Overnight is de-risking the combination the tuning tasks made
look safe.**

### Wave ptr — champion + budget-pointer (rank2/3 pointers on 3x dominance) read-heavy
Solves 3/8 vs control 5/8 — LOST helidon (2/2→1/2). Not cap-confounded (cap60>44 gives more
room; the pointer HID rank2/3 content helidon needed → a rep failed to recover it under budget).
registry/b2/cccl unchanged solves. ss-counts mixed (cccl 10→6 fewer, registry 57→64 more). No
cost win. VERDICT: budget-pointer trades a bit of retrieval for a solve regression — same shape
as every other lever this overnight. Even the strict 3x-dominance gate wasn't safe enough; ship
only OFF by default, do not enable.

### Wave v4 — thrash-fix prompt (V3 + read-the-pack + always-validate) on 4 failures
Solves 1/8 vs control 1/8 — registry/b2/py-cov unmoved (retrieval-tour + false-pass NOT
prompt-fixable), but kompendium HELD 1/2 (V4's read-the-pack prose offset V3's sibling-stop
regression — so V3+read-the-pack is safer on kompendium than V3 alone). No failure fixed, no
cost win (cap-confounded). Confirms: registry/b2 retrieval-tour and py-cov false-pass are NOT
reachable by prompting.

### Wave ptrgen — budget-pointer on 6 FRESH tasks
Solves 4/12 vs control 4/12 — neutral, helidon HELD 2/2 (vs 1/2 in the ptr wave → the ptr-wave
"helidon regression" was largely rep NOISE, not a clean pointer fault). No cost win (confounded).

### 21.X OVERNIGHT SYNTHESIS (5 waves, 48 rollouts, $29.10, cap-60)

| wave | config | tasks | solves champ/ctrl | note |
|---|---|---|---|---|
| gen | P+V3 | 6 fresh | 4/4 | neutral, no solve regression |
| thrash | P+V3 | 4 failures | 0/1 | LOST kompendium (P+V3 don't compose) |
| ptr | +pointer | 4 read-heavy | 3/5 | helidon 1/2 (later shown noise) |
| v4 | +thrash-fix prompt | 4 failures | 1/1 | no failure fixed; read-the-pack offsets V3 kompendium regression |
| ptrgen | +pointer | 6 fresh | 4/4 | neutral; helidon 2/2 (noise-corrects ptr) |

**BOTTOM LINE (honest):**
1. NO lever produced a clean generalizing cost win. The tuning-task wins (P −16%, V3 −13%) went
   NEUTRAL on rotation — they were partly overfit to the 6 tuning tasks. (User's rotation
   instinct correctly exposed this.)
2. P+V3 COMBINED regresses kompendium (thrash + STACK, twice) — V3's stop-reading-siblings + P
   interact. The "read-the-pack" clause (V4) offsets it. So a safe champion is P-alone, or
   V3+read-the-pack, NOT bare P+V3.
3. Budget-pointer (user's rank2/3 idea) = NEUTRAL (helidon apparent-regression was rep noise).
   Safe to keep OFF-by-default as a shipped option; not a win to enable.
4. The costly failures are NOT prompt-reachable: registry/b2 retrieval-tour and py-cov false-pass
   survived every prompt/format lever (thrash + v4).
5. ALL cost deltas cap-confounded (overnight 60 vs control 44) — solve deltas are the clean signal.
6. **Real remaining levers = server-side fusion-v2 (dependent read-hop, no model cooperation) +
   harness-level failed-task-thrash reduction. NOT more prompt/format variants — that space is
   now exhausted with consistent evidence.**

## 22. W0.b — fusion feasibility mining (partial, $0, 2026-08-06)

**Scope reached at $0 today:** the DB-independent half of W0.b is answered from the §6 prior
box-DB run; the economics half (p_hit, R span size, distinct-file share) is DB-blocked. The Mac's
local `~/.local/share/opencode/opencode.db` (720M) holds only Mac dev-probe sessions — zero
retired `/runs/*__sweet__r0__*` rollouts (verified: 0 sessions in the retired window). The box DB
(`/root/.local/share/opencode/opencode.db`, 1.8G) is the only source of the 551-pair traces and
is NOT mirrored on the Mac. So the two remaining W0.b numbers need one read-only box pull ($0
model spend; a copy operation).

**Two mechanisms, separated (rev 1.1 accounting):**

- **Mechanism A — proactive span containment (turn-collapsing via WIDER search spans).**
  Current-version elimination-or-partial = **2.1% of decidable (9/432)**; the ≥20% build bar is
  NOT met by CURRENT output. IMPORTANT read: "97.9% not_eliminated" is the addressable pool being
  INTACT — for 97.9% of pairs the follow-up read fetched something current search did NOT return,
  so those reads are genuine, not redundant. That is *headroom for* fusion, not evidence against
  it. What is unproven offline: whether fusion-v2's WIDER spans (owning-symbol / full-span) would
  CONTAIN those payloads. That is the R (span token size) question → DB-blocked. So Mechanism A
  is neither GO nor NO-GO yet; its build bar is a build-then-replay test, not answerable pre-build.

- **Mechanism B — inline forward-reference co-issue (`ss-search Q --then-read hit:1..2`,
  turn-collapsing, server resolves the reference).** Availability = **84.8% (467/551)**: the read
  target was NAMED in the immediately-preceding search output, so a server-side resolver can find
  it without the model inventing a path. This is the strongest signal in W0.b and it is the
  turn-collapser that needs NO payload containment. Feasible on availability grounds. Its GO/NO-GO
  still needs the §2 economics gate (p_hit·turnCost vs R·resend-tax), which needs p_hit and R from
  the box DB.

**Still DB-blocked (need the box pull to close W0.b):**
1. **Distinct-file share of the 294 multi-read envelopes** (§1.2b). The 294 counter counts read
   COMMANDS, not distinct files; same-file multi-range → wider-span fusion; distinct-file →
   multi-file fusion. This decides how much multi-FILE return capability matters.
2. **p_hit** — rank of the read target under a top-1 / top-3 resolver over the search result.
3. **R** — token size of the span each read actually consumed → feeds the break-even bound.

**Partial verdict:** Mechanism B is availability-feasible (85%) and is the turn-collapsing lever;
Mechanism A has an intact addressable pool but unsized economics. Neither is refuted. The build
decision (W1) stays gated on the economics gate, which needs one $0 read-only box DB pull. No
paid work is unblocked or blocked by today's result.

**Next $0 step:** read-only `scp` of the box `opencode.db` (+ WAL) to a Mac scratch path, then
extend `stats/search-read-replay.mjs` to emit per-pair {namedRank, distinctFiles, spanTokens}
and run the economics gate. Awaiting user go on the box pull.

## 23. W0.b — economics gate CLOSED (box DB pulled, $0, 2026-08-06)

Pulled the box `opencode.db` (1.86G, read-only) → 200 retired sweet rollouts, 551 candidates
reproduced exactly. New tool `stats/w0b-fusion-economics.mjs` computes the three DB-blocked
numbers + an empirical economics gate. **Coefficients fit by OLS on 11,339 real turns recovered
the exact Grok/openrouter list rates ($2 / $0.30 / $6 per M input/cached/output)** — a strong
validation that the model is correct, not guessed.

### 23.1 §1.2b RESOLVED — multi-FILE share
| distinct files/envelope | n | | metric | value |
|---|---|---|---|---|
| 1 (same-file multi-range) | 283 | | multi-READ envelopes | 301 (54.6%) |
| 2 | 168 | | **multi-FILE envelopes** | **268 (48.6%)** |
| 3 | 70 | | multi-file capability matters for | ~half the pairs |
| 4 | 21 | | the other half | wider same-file spans |

The 294 "multi-read" count was NOT all multi-file: ~49% are genuinely distinct-file (need
multi-file returns), ~51% are same-file multi-range (coverable by a wider single span).

### 23.2 Mechanism B resolver strength (read target's rank in the preceding search)
p_hit@1 = **47.9%**, @3 = **68.6%**, @5 = **76.4%**; 93.5% of targets are rankable hits.
The server can resolve the dependent read from the search result ~69% of the time at top-3.

### 23.3 Span sizes and turn model
R (read payload tokens): median **994**, p75 1778, p90 **2893**, mean 1348.
turnCost = **$0.0130**/turn (W_resident median 38,715 ≈ the known ~44k; output median 233).
T_remaining after the hop: mean **32**, median 26 (candidates drawn from the longest session/task).

### 23.4 ECONOMICS GATE — conditional NO-GO
net = p_hit·turnCost − R·(c_new + c_cached·Trem), bootstrap 90% LCB over 551 pairs:

| scenario | net mean | net lcb90 | gate |
|---|---|---|---|
| **baseline top-1** | −$0.0097 | −$0.0112 | **NO-GO** |
| **baseline top-3** | −$0.0070 | −$0.0085 | **NO-GO** |
| + eviction (W4 pairing) | +$0.0064 | **+$0.0060** | **GO** |
| + span cap 600 | +$0.0031 | +$0.0027 | GO* |
| + span cap 400 | +$0.0048 | +$0.0044 | GO* |
| late hops (Trem=8) | +$0.0033 | +$0.0028 | GO |
| late hops (Trem=4) | +$0.0049 | +$0.0044 | GO |

Break-even span R_max1 = **1122 tokens**. Median R (994) sits just under it; the mean (1348) and
p90 (2893) sit over — the fat-tail spans drag net negative.

**Verdict: fusion as naively specified (fat, persistent spans) LOSES money.** The turn saving is
one-shot and probabilistic ($0.013 × 0.69); the resend tax is paid on every fused payload,
whether or not it saved a turn, and re-sent ~32 more turns at the cached rate. This is the §2
design-law warning made concrete: a fused result is re-sent forever, so the bar is high.

**But the gate FLIPS positive (positive 90% LCB) under any one of three levers:**
1. **Eviction pairing (W4) — the clean flip, +$0.0060 LCB.** Drop the fused payload from resident
   context after the read consumes it → tax collapses to one injection. No effect on payload
   usefulness. This economically JOINS W1 and W4 exactly as §2/§6b predicted; W1 should NOT be
   built standalone.
2. **Span cap — the optimistic flip.** Capping R helps, but the model assumes the capped payload
   still contains what the read needed (hit unchanged) — an UPPER bound. A break-even cap (~1122)
   clips only the top quartile and leaves the median span intact; this is product-side (no
   frozen-surface change) and the safest near-term move. Needs a joint (cap, containment) re-check
   before trusting.
3. **Late-session hops only.** Restricting fusion to low-Trem hops is positive but leaves most of
   the pool (early-localization hops) unaddressed.

### 23.5 W0.b bottom line
- Mechanism A (proactive span containment, current ver): still 2.1% eliminated (§22) — dead alone.
- Mechanism B (forward-ref co-issue): availability-feasible (69% top-3) BUT net-negative at
  measured Trem with fat persistent spans.
- **The build decision: DO NOT ship W1 fusion standalone.** Ship it span-capped at break-even AND
  paired with eviction, or not at all. The single highest-value next study is therefore W4
  (context eviction) feasibility on this harness — it is what makes fusion pay AND it is the
  strongest standalone re-send lever (−84% tokens external). Fusion without eviction is a
  measured money-loser on Grok at these session lengths.
