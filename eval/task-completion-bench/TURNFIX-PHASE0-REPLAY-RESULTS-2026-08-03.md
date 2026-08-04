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
