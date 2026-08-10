# Handoff — autonomous overnight micro-smoke loop: FAILED-TASK THRASH reduction

You are a fresh session. The operator is ASLEEP and has given explicit trust: **work autonomously,
try everything in the portfolio, do not give up on a lever after one neutral result — try 2-3
variations first, then file it.** Backbone: **gpt-5.6-luna via the codex ChatGPT-Max subscription on
the box** (flat-rate → NO metered dollars). Discipline: the `/microsmoke` skill (installed) +
the loop invariants below. This is the direct successor to `OVERNIGHT-LOOP-2026-08-07.md`; read that
file first for the house style, then run this portfolio.

**The prime directive: $0 gate FIRST for every lever. No live cell until a $0 replay proves the
trigger fires on a progress signal AND clears its pre-registered bar.** The last three levers (#1
shipped, #2/#3 no-go) all resolved correctly by obeying this. Two of them died for $0. That is the
method working, not failing.

---

## 1. Where we are, and why this is the last cost frontier

sweet-search is a code-retrieval engine given to a coding agent as CLI tools (`ss-search`, `ss-grep`,
`ss-semantic`, `ss-read`, …). Bench: SWE-rebench repair tasks — edit repo SOURCE so hidden
FAIL_TO_PASS tests pass, PASS_TO_PASS stay green. Two arms drive the SAME agent (codex harness,
`openai/gpt-5.6-luna`): **native** (rg/grep + sed/cat) and **sweet** (ss-* tools + a general M± fix-
discipline block delivered via the memory file, never the prompt).

Established, load-bearing facts (do not re-derive):
- **Resolution is floor-limited by a UNIVERSAL, retrieval-independent wrong-fix class** (~64-67% of
  losses both arms). Better retrieval cannot fix it. The honest headline is COST, not resolution.
  Memory `project_resolution_floor_universal_wrongfix`.
- **The context-side cost levers are exhausted.** Polls removed (#1 shipped, −71%). Eviction/fusion/
  preamble all NO-GO for $0 (#3). Memory `project_eviction_nogo_cachebreak_gate`.
- **A break-priced cost column is now in the default analyzer** (`costFromTurns` →
  `breakPricedCostUsd`). For append-only trajectories it equals idealCost by construction. Read every
  A/B on it anyway — it is the honest column. Same memory.
- **Spend concentrates in FAILED tasks.** GPT forensics: dart + mransan + litestar = **45.7% of
  failed spend**; the five costliest failed tasks = **65.6%**. That tail is the remaining target.

### The key insight that makes this safe
A task that fails on the universal wrong-fix floor **fails no matter how long it runs**. Every token
spent after the trajectory is doomed is pure waste. Cutting it short lowers cost with **zero solve
change** — the task was lost either way. The ENTIRE risk is a false positive: cutting a trajectory
that WOULD have solved, which submits its pre-solve patch and LOSES the solve. So every lever here
has one veto, measured identically: **on solved trajectories, the trigger must never fire before the
turn that wrote the solving patch.** That false-positive rate must be 0. This is the exact analogue
of eviction's refetch-rate gate.

### The one design rule GPT's caveat forces
Aggregate failed-call counts are **difficulty-confounded** — a task with 24 calls may just be hard
(mransan r1 thrashed 24 distinct searches and failed; but so might a genuinely hard legit task).
**Therefore never trigger on an absolute call/turn count. Trigger only on a PROGRESS signal** (no new
file surfaced, no diff change, no test-status change). A progress signal is difficulty-agnostic: a
hard task still makes progress; a doomed task stops making it. This rule is what keeps the lever
honest and is non-negotiable.

## 2. The portfolio (ranked; $0-gate each in order)

| # | Lever | Kind | Trigger (progress signal) | $0 gate replayable now? |
|---|---|---|---|---|
| T1 | Retrieval novelty-stall nudge | **sweet-specific, format-gated** | N consecutive ss-* searches surface 0 new files | YES (raw rollouts) |
| T3 | No-progress global abort | arm-symmetric harness | X consecutive turns: no diff change ∧ no new file ∧ no test-status change | YES (raw rollouts) |
| T2 | Repeated-failed-edit streak | arm-symmetric harness | K run_tests FAILs with no new file touched between them | PARTIAL (coarse only — see note) |

Run T1 first (it is both the strongest positive site — mransan is literally retrieval-thrash — AND a
real sweet product feature, not just harness scaffolding). Then T3 (clean backstop). Then T2 (coarse
$0 only; the fine-grained per-patch replay needs retained intermediate patches the luna run did not
capture — the same instrumentation gap that blocked lever #2; do NOT build that tonight).

### T1 — Retrieval novelty-stall nudge (sweet feature, FORMAT-GATED)
sweet-only: native has no ss-search, so this differentiates the sweet arm. After N consecutive ss-*
searches that surface **zero new file paths** vs. everything already returned this task, the tool
appends a short trailer: "N searches returned no new files — commit to the best candidate or read
it; further searching is unlikely to help." This targets mransan-class thrash directly.
- **CLAUDE.md rule: this is a structured-query-aware ranking/response signal → it MUST be
  format-gated on `opts._isAgentFormat` / `format==='agent*'` by default.** NL search traffic must
  never see the trailer. Verify the gate in a unit render ($0) before anything else — this is the
  same discipline that saved GCSN MRR twice.
- Cost-primary, solve-neutral-or-better. Do not claim a solve bump; mransan's extra tour was
  difficulty-confounded (both reps failed). Frame as: stops the agent burning searches on a saturated
  retrieval, small chance of solve upside if thrash was blocking a commit.

### T3 — No-progress global abort (arm-symmetric harness backstop)
Harness-enforced in the progress controller: if X consecutive agent turns produce no diff change AND
no new file read/edited AND no test-status change, stop the task and submit the current diff. Arm-
symmetric → apply to BOTH arms, report as an ablation (like eviction). Not a sweet feature; a bench-
efficiency backstop. X is chosen from data (see gate) to sit strictly ABOVE the longest no-progress
run any SOLVED task exhibits before solving.

### T2 — Repeated-failed-edit streak (coarse only)
The raw rollout holds ordered `run_tests` verdicts + `apply_patch` inputs (the #2 session confirmed
this join). A coarse "K run_tests FAILs with no new file touched between them" IS reconstructable at
$0. The fine-grained "was an intermediate patch grader-green" is NOT (no retained intermediate
patches). Measure only the coarse tail; do not build patch retention.

## 3. The loop (follow /microsmoke gates in order, per lever)

### Gate 0 ($0, no model calls) — shared replay
Reuse the raw-rollout parser from `stats/poll-census.mjs` (marker `===TASKARM:<key>:R<rep>===`, one
JSON event per line, `token_count.last_token_usage` per request) and the novelty logic from the #5
census. Build `stats/thrash-census.mjs` computing, per trajectory:
- the progress timeline: per turn, did a NEW file surface / did the diff change / did test-status
  change.
- **recoverable tail**: spend AFTER the last progress event, as % of that task's spend, summed over
  FAILED tasks (the win) — on the break-priced column.
- **false-positive check**: for every SOLVED trajectory, the turn index of the solving patch vs. the
  turn the trigger would fire. Any fire-before-solve = a lost solve.
Positive site: **mransan** (T1), **dart/litestar** (T3). Controls that must show FP=0: **statamic,
oceanparcels, redboltz, scoringutils** (all clean 2/2 solves).

**Pre-registered bar (write it in the run ledger BEFORE running):** a lever proceeds to a live smoke
only if (a) recoverable tail ≥ ~15% of failed-task spend on its positive site, AND (b) false-positive
rate on solved tasks = 0. If FP>0 at the material threshold, RAISE the threshold (N/X/K) until FP=0
and re-measure the tail. If the tail then collapses below 15%, the lever is DEAD for $0 — file it and
move on. Try at least 2-3 thresholds before filing (Gate 4: neutral-on-rotation ≠ refuted).

### Gate 1 — diagnostics + controls (DEV-RET only; HO2 FROZEN)
Diagnostics: mransan (T1), dart + litestar (T3). Controls (must not regress): statamic, oceanparcels,
redboltz, scoringutils.

### Gate 2 — live smoke (only if Gate 0 clears; Luna via codex subscription)
Both arms (T3/T2) or sweet arm + a native control (T1), REPS≥2, CONCURRENCY=1, matched cap 60. Gate
each treatment behind a NEW env flag so the $0 render check proves it fires (anti-A/A):
- T1: `SS_STOP_NOVELTY_N=<n>` (tool trailer; assert format-gate in the render).
- T3: `SS_NOPROGRESS_CAP=<x>` (harness abort).
- T2: `SS_FAILEDIT_STREAK=<k>`.
Read **solve NON-regression FIRST** (the veto — zero control regressions, zero diagnostic solve
loss), THEN break-priced cost delta both arms. idealCost / break-priced, never realized.

### Implementation form — pick DETERMINISTIC, because this backbone is instruction-deaf
Prior turnfix work proved Luna ignores prose behavioural instructions (prose turn-packing CLOSED as
backbone-instruction-deaf). So do NOT rely on a FRAME sentence telling the agent to stop:
- T1: implement as a real tool-side trailer (deterministic), format-gated. Not a prompt request.
- T3/T2: implement as a harness hard-stop in the progress controller (deterministic).
**Ledger consequence:** if you touch any of the 4 rt-shim files hashed by the env-ledger fingerprint
(`rt-condense-lib.mjs`, `rt-shim-runtime.mjs`, `rt-dedup.mjs`, `rt-progress-controller.mjs` — T3/T2
live here), the fingerprint CHANGES → you MUST re-sweep the ledger with
`node harness/env-ledger-sweep.mjs --tasks <specs> --out <dir>` ($0, grades gold/empty, no model
calls) before trusting any number. T1 (tool-side, in the ss-* engine, not an rt-shim file) does NOT
change the fingerprint → current ledger `ledger-postfix-20260807` stays valid. Confirm which bucket
your change lands in and re-sweep if in doubt.

### Gate 3-5 — read (solve non-regression + break-priced cost), rotate on fresh DEV-RET tasks, promote.

## 4. Box run recipe (verified 2026-08-07)
Runner `/root/smoke.sh` on the box (root@167.233.69.121). Memory `project_codex_subscription_run_gotchas`.
- `MODEL=openai/gpt-5.6-luna` (FULL string — pricing key; bare id aborts every rollout at the pricing
  guard, $0 spent).
- `REASONING=medium`; `EGRESS_ALLOW=chatgpt.com,openai.com`; `DOCKER_HOST=unix:///var/run/docker.sock`;
  `CODEX_SUBSCRIPTION=1`; `HARNESS=codex`; codex CLI ≥0.146.
- `ENV_LEDGER=/root/.ss-eval/ledger-postfix-20260807/ledger.jsonl` (valid for T1; re-sweep for T3/T2).
  Preflight `PREFLIGHT_ONLY=1` first ($0). One pilot at a time (uid-501 dubious-ownership bug).
  Per-task image GC (no pre-pull). Disk guard: abort if `df / avail` < ~12G.
```
RUN_ID=thrash-preflight INSTANCES=mransan-<id>,redboltz__mqtt_cpp-466 \
  ENV_LEDGER=<ledger> PREFLIGHT_ONLY=1 /root/smoke.sh
RUN_ID=thrash-t1-smoke INSTANCES=<diag>,<control> ARMS=sweet,native REPS=2 CONCURRENCY=1 \
  MAX_TOOL_CALLS=60 ENV_LEDGER=<ledger> SS_STOP_NOVELTY_N=<n> /root/smoke.sh
```

## 5. Do NOT redo / out of scope
- Polls (#1) SHIPPED; eviction/fusion/preamble (#3) NO-GO; checkpoint-on-green (#2) NO-GO; dedup (#5)
  DEAD. Do not reopen. See `OVERNIGHT-LOOP-2026-08-07.md` + `handoffs/lever2-checkpoint/`,
  `handoffs/lever3-eviction/`.
- Do NOT trigger on absolute call/turn counts (difficulty-confounded). Progress signal only.
- Do NOT build per-turn patch retention (that is the #2 gap; T2 stays coarse).
- Do NOT prose-instruct the backbone to stop (instruction-deaf); implement deterministically.
- Never touch HO2. Smokes use DEV-RET tasks only.
- Solve-safety veto is absolute: never ship a cut that plausibly costs a solve (FP must be 0).

## 6. References
- `OVERNIGHT-LOOP-2026-08-07.md` — house style + the 6-lever triage.
- `handoffs/luna-rotate18/GPT-SOL-REPLY.md` — GPT portfolio; §5 (novelty/early-termination), the
  45.7%/65.6% failed-spend figures, the mransan r1 thrash example + difficulty-confound caveat.
- `stats/poll-census.mjs` — raw-rollout parser to copy; `stats/resend-census.mjs`,
  `stats/eviction-grid-replay.mjs` — progress/token attribution patterns from #3.
- `EDIT_THRASHING.md` — the edit-loop selector-safety protocol (T2 background).
- `.claude/skills/microsmoke/SKILL.md` — the gate protocol.
- Memory: `project_resolution_floor_universal_wrongfix`, `project_eviction_nogo_cachebreak_gate`,
  `project_cost_forensics_2026_07_08`, `project_poll_await_lever`, `project_codex_subscription_run_gotchas`,
  `feedback_mpm_vs_frame_content_rule`, CLAUDE.md format-gating rule (T1).

## 7. Run ledger (append per step — this is your working log)
Record every $0 gate result, the pre-registered bar, each threshold tried, and every verdict, in the
`OVERNIGHT-LOOP-2026-08-07.md` style. Deliverable by morning: a ranked go/no-go on T1/T3/T2, each with
its recoverable-tail %, its false-positive rate on solved tasks, and — for any that cleared Gate 0 —
the live-smoke solve non-regression + break-priced cost delta both arms. Kill cheaply at Gate 0 where
the tail is small or FP>0 and unfixable. Leave production unchanged unless a lever passes every gate.
