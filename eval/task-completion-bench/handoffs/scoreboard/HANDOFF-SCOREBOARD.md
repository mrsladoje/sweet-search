# Handoff — the honest scoreboard: sweet vs native, 15 rotated tasks, model held constant (Luna)

You are a fresh session. Goal: **establish the true head-to-head — cost AND solve — for sweet vs
native on 15 rotated DEV-RET tasks, with the model held constant at Luna, across as many of three
harnesses (codex / opencode / claude-code) as are actually feasible.** This is a MEASUREMENT, not a
lever. There is no treatment to invent. The deliverable is a trustworthy scoreboard plus a mined set
of improvement hypotheses from the full traces.

**Why this exists:** the GPT-Sol lever portfolio is exhausted (#1 shipped; #2/#3/#5/thrash/#4 dead).
We have iterated retrieval and harness cost levers to closure, but we have **never measured the clean
sweet-vs-native total-cost and solve delta on this backbone with the corrected instrument.** The
operator is (rightly) unsure we even have a cost win. Mixed prior evidence: −20% on a both-solved
Grok slice, but +15.2% (sweet MORE expensive) and a solve loss on the hardened Grok heldout. On Luna
we have internal token *shares*, never the straight head-to-head. Close that gap before HO2.

Open scientific question this run answers: **is "native solves more" a property of sweet, or of the
codex harness?** Holding the model fixed and varying the harness isolates it. If sweet wins on
opencode and loses on codex, the harness drives the result, not the retrieval.

---

## 0. MONEY SAFETY — read before doing anything

The operator's free Luna is a flat-rate ChatGPT subscription that works **only through the codex
harness** (`CODEX_SUBSCRIPTION=1` → ChatGPT login via auth.json; codex-task-runner.mjs:399-522).
Verified facts about the other two harnesses:
- **opencode** drives models via `provider=openrouter` — Luna there is **METERED real money**
  (openrouter pricing key `openai/gpt-5.6-luna`). No subscription path exists in
  opencode-task-runner.mjs.
- **claude-code** drives models via `claude -p` against OpenRouter's Anthropic-compatible skin
  (claude-code-task-runner.mjs defaults `anthropic/claude-sonnet-5`). That skin serves ANTHROPIC
  models; an OpenAI model like Luna **likely cannot run there at all**. Treat as infeasible until
  proven otherwise.

**Therefore the operator's stated plan — "Luna from my codex subscription across all three harnesses"
— is not possible as written.** Only the codex cell is free. Do NOT spend metered money or run a
broken/confounded cell without EXPLICIT operator approval. Your Phase 0 job is to characterize the
options and STOP for that approval.

## 1. Phase 0 — feasibility + green ledger ($0, no task rollouts)

1. **Reachability probe per harness ($0 / near-$0).** For each of codex / opencode / claude-code,
   confirm whether Luna (`openai/gpt-5.6-luna`) actually runs, and at what cost, with a single
   trivial invocation (1 task, PREFLIGHT or a 1-call smoke). Record: works? free or metered? if
   metered, the per-task cost estimate from ideal-cost.mjs.
2. **Confounding rule.** The comparison is only valid if the MODEL is identical across harnesses. If
   Luna cannot run on a harness, do NOT substitute that harness's native model (Grok/Sonnet) — that
   confounds harness with model and destroys the isolation. A harness that cannot run Luna is simply
   dropped from the matrix; say so.
3. **Green ledger per surviving harness.** The harness is part of the config fingerprint, so each
   harness needs its own gold/empty sweep: `node harness/env-ledger-sweep.mjs --tasks <specs>
   --out <dir-per-harness>` ($0, no model calls). No run without a green ledger (invariant).
4. **Task set: the 15.** Use DEV-RET rotated tasks (source pool box-side:
   `select/.cache/tasks_full_luna_rotate20.json`; the recent screens used rotate18). A task qualifies
   only if it holds a GREEN gold ledger on EVERY harness in the run — comparability requires it. Take
   the intersection; if fewer than 15 qualify across all surviving harnesses, report the count and
   proceed with the intersection rather than forcing 15.

**STOP after Phase 0 and report to the operator:** the feasibility table (harness × works/free/metered
/cost), the qualifying task count, and the resulting options — e.g. (a) codex-only, fully free, clean
scoreboard on the trusted backbone but no harness comparison; (b) codex + opencode, ~$X metered on
opencode, answers the harness-effect question; (c) drop claude-code if Luna won't run there. Let the
operator pick which cells to spend on. Do not proceed to Phase 1 on any metered cell without approval.

## 2. Phase 1 — the measurement (approved cells only)

For each approved harness, run BOTH arms (native, sweet) on the qualifying rotated tasks.
- REPS≥2, CONCURRENCY=1, **matched `MAX_TOOL_CALLS`/caps across arms and across harnesses** (60). A
  cap mismatch confounds every cost delta — hold it identical everywhere.
- Read on the **break-priced cost column** (default in the analyzers now), never realized cost. These
  runs are append-only so break==ideal, but read the honest column by habit.
- Headline metrics, per harness, per arm: **solve rate** (and per-task solved/not) and **total
  break-priced cost** (per task and aggregate). Compute the paired sweet−native delta on both.
- One pilot at a time on the box (uid-501 dubious-ownership bug). Per-task image GC. Disk guard:
  abort if `df / avail` < ~12G.

Read the result correctly (microsmoke Gate 3):
- **Solve is the primary dimension.** At n=15×reps the cost delta has a wide noise band (±37% at tiny
  n); trust per-task solved/not-solved flips and the aggregate solve count first.
- The cost claim is only meaningful **at parity or with the gap stated**: if sweet solves fewer, do
  not report a raw cost win as if comparable — report cost AND solve together, and compute cost on the
  both-solved subset (apples-to-apples) alongside the full-set aggregate.
- If sweet is cheaper at similar solve on a harness → that harness supports the headline. If sweet is
  both more expensive and lower-solving → that is the hard truth; record it plainly.

## 3. Phase 2 — mine the full traces for improvement hypotheses ($0)

The operator wants to keep improving the product from these traces. After the scoreboard:
1. **Discordant pairs are the gold.** For every task where native solved and sweet did not (same
   harness, same reps), diff the trajectories: what did native have in context that sweet lacked, or
   what did sweet have and mis-use? Reuse `stats/loss-taxonomy.mjs` (wrong-fix / incompleteness /
   wrong-location) and the raw-rollout parser (`stats/poll-census.mjs` pattern). Classify each loss.
2. **Retrieval-starved vs generation-variance**, per the #4 discipline: was the deciding fact ABSENT
   from sweet's context but present in the repo (a retrieval gap sweet could close), or present and
   ignored (agent-bound, unreachable)? Re-derive absence from raw JSONL / opencode SQLite — NEVER from
   trajectory files, which truncate tool results at 600 chars and fake "never in context" (a trap the
   #4 session hit).
3. **Cross-harness flips.** If a task's sweet-vs-native outcome flips between harnesses, that is a
   harness-effect finding — flag it; it is more valuable than any single-harness number.
4. Output a ranked list of candidate hypotheses with the evidence class. Do NOT build anything —
   improvement candidates go through the normal $0-gate-first microsmoke discipline in a later
   session. Expect most losses to be agent-bound (generation-variance); the honest prior from four
   prior analyses is that retrieval is not the resolution constraint on this backbone.

## 4. Box run recipe
Runner `/root/smoke.sh` (root@167.233.69.121). Memory `project_codex_subscription_run_gotchas`.
- codex free cell: `HARNESS=codex MODEL=openai/gpt-5.6-luna PROVIDER=openai CODEX_SUBSCRIPTION=1
  REASONING=medium EGRESS_ALLOW=chatgpt.com,openai.com DOCKER_HOST=unix:///var/run/docker.sock`.
- opencode metered cell (only if approved): `HARNESS=opencode MODEL=openai/gpt-5.6-luna
  PROVIDER=openrouter` + `OPENROUTER_API_KEY`; EGRESS must allow openrouter.ai. Confirm ideal-cost
  prices `openai/gpt-5.6-luna` before spend.
- `ENV_LEDGER=<per-harness ledger dir>/ledger.jsonl`; `PREFLIGHT_ONLY=1` first ($0).
- `MODEL=openai/gpt-5.6-luna` is the FULL pricing key — the bare id aborts every rollout at the
  pricing guard ($0 spent, caught pre-agent).

## 5. Guardrails
- **No metered spend without explicit operator approval** (Phase 0 stop is mandatory).
- Never touch HO2 — DEV-RET rotated tasks only.
- Matched caps across arms AND harnesses; break-priced cost; idealCost never realized.
- Model held constant (Luna) — never substitute a harness's native model into the comparison.
- Green ledger per harness before its cells run.
- Solve is the veto dimension — report cost only with solve stated alongside.
- Build nothing in this session — measure and mine only.

## 6. References
- `harness/run-pilot.mjs` (harness routing), `harness/codex-task-runner.mjs` (subscription path),
  `harness/opencode-task-runner.mjs`, `harness/claude-code-task-runner.mjs`.
- `stats/loss-taxonomy.mjs`, `stats/poll-census.mjs` — Phase 2 mining tools.
- `.claude/skills/microsmoke/SKILL.md` — Gate-3 read discipline.
- Memory: `project_resolution_floor_universal_wrongfix`, `project_eviction_nogo_cachebreak_gate`
  (break-priced column), `project_grok_opencode_heldout_run` (the +15.2% / solve-loss prior + the
  ground-truth-assisted caveat), `project_multi_harness_routing`, `project_codex_subscription_run_gotchas`,
  `feedback_full200_rebaseline` (the −20.1% both-solved Grok prior), `project_task_completion_bench_design`
  (headline = efficiency-at-parity).

## 7. Deliverable
A per-harness scoreboard — solve rate and break-priced cost, sweet vs native, both on the full set and
the both-solved subset, with the paired deltas and the qualifying-task count — plus the Phase 0
feasibility table, plus a ranked list of improvement hypotheses from the discordant-pair mining with
each loss classed retrieval-starved vs agent-bound. State plainly whether a cost win exists on this
backbone, and whether the solve gap is harness-specific. Record everything in a RUN-LEDGER in this
folder. Then the program is ready for the single, final, aggregate-only HO2 pass.
