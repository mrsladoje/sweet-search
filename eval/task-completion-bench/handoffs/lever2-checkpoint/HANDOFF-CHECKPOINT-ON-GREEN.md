# Handoff — microsmoke lever #2: verified checkpoint-on-green (the top RESOLUTION lever)

You are a fresh session picking up the sweet-search task-completion-bench program. Your job:
**microsmoke "checkpoint-on-green" end-to-end** — the highest-value remaining lever for closing
the sweet arm's SOLVE gap. Follow the `/microsmoke` skill exactly (it is installed). Do NOT skip
the $0 gates. Do NOT touch the frozen held-out set. Use Luna via the codex subscription on the box
(flat-rate → no real money).

---

## 1. What sweet-search is, and how the sweet arm loses (context)

sweet-search is a code-retrieval engine exposed to a coding agent as CLI tools (`ss-search`,
`ss-grep`, `ss-semantic`, `ss-read`, …). The benchmark: SWE-rebench-style repair tasks — edit repo
SOURCE so the hidden FAIL_TO_PASS (F2P) tests pass and PASS_TO_PASS (P2P) stay green. Two arms drive
the SAME agent (codex harness, model gpt-5.6-luna via a ChatGPT subscription):
- **native**: raw `rg`/grep + `sed`/cat reads.
- **sweet**: the ss-* tools + an M± "fix discipline" prompt block.

On the Luna-rotate18 run, sweet solved **less** than native (screen: sweet 7/18 vs native 10/18;
the earlier 2-rep run: sweet 15/36 vs native 19/36). Cost is NOT the problem — sweet is already
cheaper. **Resolution is the problem.** A recurring failure shape: the agent finds the right place,
writes a fix its own `run_tests` verifies GREEN, then keeps editing (second-guessing / over-
engineering) and submits a BROKEN final patch. The clearest example is `jashkenas__underscore-2757`:
the failing rep started correct, then rewrote into an internally inconsistent patch (a broken
`_.has(result, [key])` form). Checkpoint-on-green catches exactly this.

## 2. The lever

Keep every candidate patch the agent produces during a task. Whenever the agent's `run_tests` shows
the FULL suite green, freeze that state. If a later edit regresses it, SUBMIT the frozen verified
patch instead of the broken final one. This is best-verified-trajectory selection (cf. Agentless,
SWE-agent reranking). GPT-Sol ranked it #2 overall and #1 among resolution levers.

## 3. VALIDITY — read this before building (it is publishable, with guardrails)

The linchpin: **does the agent's `run_tests` expose the same tests the grader uses?** VERIFIED
2026-08-07: `run_tests` (harness/rt-shim-runtime.mjs:67) applies ONLY the agent's own diff
(`git apply /patch/agent.diff`) then runs `install_config.test_cmd` on the BASE-commit tests. It
does NOT apply the hidden `test_patch`. The grader (sr-eval / SWE-rebench-V2) applies `test_patch` +
agent diff and runs F2P/P2P. So the agent's "green" is its OWN in-loop validation, NOT the grader's
tests → checkpoint-on-green is legitimate, not oracle access.

**Re-confirm this yourself as $0 Gate 0a** — it is task-dependent (some tasks' F2P tests pre-exist
in the base repo and are exercised by test_cmd; some are only added by test_patch). Characterize:
for each smoke task, does `run_tests` green imply grader green, or can they disagree? The disagreement
rate is the whole ballgame.

**Three guardrails that keep it publishable:**
1. "Green" = FULL suite green (target test PASS **and** pre-existing tests still pass) — never
   checkpoint on a target-only pass that breaks P2P regressions.
2. Apply SYMMETRICALLY to BOTH arms. Report with/without as an ablation on native AND sweet. A
   sweet-only application is an unfair number.
3. The zero-grader-regression gate (already specified — `EDIT_THRASHING.md §4.2`): grade BOTH the
   final and the selected-best patch with the REAL evaluator; the selector must NEVER submit a patch
   the grader scores worse than the final. Required before enabling any auto-restore:
   **zero observed grader regressions AND enough trigger exposures that the one-sided 95% upper
   bound on regression risk < 5%** (≈59 clean exposures).
4. Disclosure for any writeup: the agent iterates against the repo test suite (standard agentic
   SWE-bench). Frame #2 as a SCAFFOLDING ablation, not a retrieval win.

If Gate 0a finds `run_tests` == grader tests on most tasks, the lever still works but you MUST
disclose target-test access and lean harder on guardrail 3 (measure selector safety).

## 4. The microsmoke plan (follow /microsmoke gates in order)

### Gate 0a ($0) — characterize run_tests vs grader test identity
Pick 3-4 smoke tasks. For each, run the gold patch and a deliberately-broken variant through BOTH
`run_tests` (agent path) and the grader (sr-eval), and record whether green/red agree. Output: the
run_tests↔grader disagreement rate. This decides framing (§3).

### Gate 0b ($0 to design, one instrumented run to capture) — per-turn patch retention
The current harness keeps only the FINAL patch (results/.../patches.json). You must retain EVERY
intermediate patch + the `run_tests` verdict at each edit/test boundary. Two options:
- (preferred) add a retention hook in the codex run path: after each `run_tests`, snapshot the
  current `git diff` + the parsed PASS/FAIL. Write to results/<run>/checkpoints/<task>-<arm>.jsonl.
- (cheaper, no harness change) RECONSTRUCT from existing raw sessions: the codex rollout jsonl holds
  the ordered `apply_patch` inputs and `run_tests` outputs. Replay them onto a clean checkout to get
  each intermediate diff, and read the run_tests verdict from the trajectory. `stats/poll-census.mjs`
  shows how to parse the raw sessions; the trajectories/*.json hold ordered `{name,kind,input,result}`
  steps. This is $0 (no model calls) but needs box compute to grade each intermediate.

### Gate 0c ($0 replay) — best-vs-final selector safety
Use `stats/edit-thrash-replay.mjs` (it already implements checkpoint / best-vs-final / exact-state
replay; args: --db --c1 --c2 --stage1-control --stage1-variant --stage1-db-root — read
parseEditReplayArgs). Feed it the retained intermediate patches. Report, per EDIT_THRASHING.md §4.2:
best-wins / ties / losses vs final; how often the selector chose a grader-WORSE patch; whether any
successful final trajectory would have been interrupted before its first passing patch. GATE: zero
grader regressions before any live auto-restore.

### Gate 1 — diagnostic + control tasks (DEV-RET only; HO2 is frozen)
- Diagnostics (over-edit past green): `jashkenas__underscore-2757`, `rstudio-education__gradethis-161`
  (both 1/2 variance — good candidates for "verified-good-then-broke"). Add a failing task where the
  agent likely reached green mid-run (inspect trajectories to confirm a green→red transition exists).
- Controls (must NOT regress): clean 2/2 tasks — `redboltz__mqtt_cpp-466`, `epiforecasts__scoringutils-229`,
  `statamic__cms-9029`, `oceanparcels__parcels-617`. The lever must never turn a clean solve into a loss.

### Gate 2 — live smoke (Luna via codex subscription; both arms; REPS≥2; CONCURRENCY=1; matched cap 60)
Only after Gate 0c shows zero grader regressions. Run treatment (checkpoint-on-green ON) vs baseline,
BOTH arms. Read SOLVE FLIPS, not aggregate cost (cost may rise slightly — acceptable for a resolution
lever). idealCost, never realized.

### Gate 3-5 — read (solve flips + zero control regressions), rotate on fresh DEV tasks, then promote.
Neutral-on-rotation is NOT dead — re-smoke with more reps before discarding.

## 5. Box run recipe (verified 2026-08-07)

Runner: `/root/smoke.sh` on the box (root@167.233.69.121). It sets the codex-subscription env.
GOTCHAS that WILL bite you (see memory project_codex_subscription_run_gotchas):
- `MODEL=openai/gpt-5.6-luna` (FULL string — the pricing key in ideal-cost.mjs). The bare id aborts
  every rollout at the pricing guard.
- `REASONING=medium` (ChatGPT enum, not "standard"); `EGRESS_ALLOW=chatgpt.com,openai.com`;
  `DOCKER_HOST=unix:///var/run/docker.sock`; codex CLI ≥0.146; `CODEX_SUBSCRIPTION=1`.
- Green ledger: run1 ran with the ledger skipped, so harness/env-ledger.jsonl is EMPTY. Establish a
  ledger with `node harness/env-ledger-sweep.mjs --tasks <specs> --out <dir>` (grades gold/empty, NO
  model calls = $0; GCs images), then pass `ENV_LEDGER=<dir>/ledger.jsonl`. Full-spec tasks (box-only):
  `select/.cache/tasks_full_luna_rotate20.json`. Preflight with `PREFLIGHT_ONLY=1` first ($0).
- One pilot at a time on the box (dubious-ownership uid-501 bug). Per-task image GC (no pre-pull).
  Disk guard: abort if `df / avail` < ~12G. 18 images GC 2-at-a-time fit ~69G.

Example (preflight then smoke):
```
RUN_ID=chk-preflight INSTANCES=jashkenas__underscore-2757,redboltz__mqtt_cpp-466 \
  ENV_LEDGER=/root/.ss-eval/ledger-<dir>/ledger.jsonl PREFLIGHT_ONLY=1 /root/smoke.sh
RUN_ID=chk-smoke-v1 INSTANCES=<diag>,<control> ARMS=native,sweet REPS=2 \
  ENV_LEDGER=/root/.ss-eval/ledger-<dir>/ledger.jsonl <CHECKPOINT_FLAG>=1 /root/smoke.sh
```
Gate the treatment behind a new env flag (e.g. `SS_CHECKPOINT_GREEN`) so the $0 render check proves
the treatment fires and the A/B is not accidentally A/A. Grading is inline; rows.json carries
`resolved`, `idealCostUsd`, `goldTripwire` (verify landed=0).

## 6. Do NOT redo (closed / out of scope)
- Prose turn-packing, mid-task advisories, M± format tuning — CLOSED (backbone instruction-deaf).
- Retrieval dedup — DEAD ($0: 0 dup ss-* calls, 3% repeat). Retrieval-thrash ≠ redundant retrieval.
- Auto-await run_tests (lever #1) — SHIPPED default-on (SS_RT_LONGYIELD); do not re-litigate.
- Completeness card (#4) — build-NO-GO until a 2nd "lean-retrieval-starved-repair" example appears.
- 2-candidate generation (#6) — needs explicit user approval (raises cost); not this handoff.

## 7. References in-repo
- `eval/task-completion-bench/EDIT_THRASHING.md` §4.2 — the selector-safety protocol + gate.
- `eval/task-completion-bench/stats/edit-thrash-replay.mjs` — the $0 checkpoint/best-vs-final replay.
- `eval/task-completion-bench/stats/poll-census.mjs` — how to parse raw codex rollout sessions.
- `eval/task-completion-bench/OVERNIGHT-LOOP-2026-08-07.md` — the full 6-lever triage + evidence.
- `eval/task-completion-bench/handoffs/luna-rotate18/GPT-SOL-REPLY.md` — GPT's ranked portfolio (#2 detail).
- `.claude/skills/microsmoke/SKILL.md` — the gate protocol you must follow.

Deliverable: a ranked go/no-go on checkpoint-on-green with the run_tests↔grader disagreement rate,
the selector-safety numbers (best wins/ties/losses, grader-worse rate), the solve flips on
diagnostics+controls both arms, and the publishability framing. Do not enable auto-restore until the
zero-grader-regression gate passes.
