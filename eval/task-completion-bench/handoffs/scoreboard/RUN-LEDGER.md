# RUN-LEDGER — honest sweet-vs-native scoreboard (Luna, rotated DEV-RET tasks)

## Phase 0 — feasibility + money safety (2026-08-11) — COMPLETE, STOPPED FOR APPROVAL

Total spend this phase: **~$0.006** (three reachability probes, all sanctioned by handoff §1.1
"$0 / near-$0"). No task rollouts run. No approval-gated money spent.

### Feasibility table

| Harness | Luna runs? | Money | Cache-normalized cost column | Full-rollout track record | Verdict |
|---|---|---|---|---|---|
| codex | YES — ChatGPT subscription | **$0** flat rate | YES — per-turn `token_count`, ideal + break-priced | 68-rollout runs 2026-08-06/07 | **RUN** |
| opencode | YES — OpenRouter | metered, **~$0.31** / 68 rollouts | YES — real per-step `tokens{input,output,cache}` | Luna probe 3/3 solved + whole turnfix program | **RUN** |
| claude-code | YES — OpenRouter Anthropic skin | metered, **~$2–8** est. / 68 rollouts | **NO** — per-turn usage zeroed; `idealCost = realized` | **never produced a single row** | **RISKY** |

Evidence:
- codex: `results/postfix-screen17` — 68 rollouts, mean idealCost $0.0079, $0.550 total, 1.9h wall.
- opencode: `results/turnfix-luna-probe-20260804` — 3/3 solved, mean idealCost $0.0045/rollout.
- claude-code: `POST https://openrouter.ai/api/v1/messages` with `openai/gpt-5.6-luna` → HTTP 200,
  cost $0.0000085. CLI smoke (`claude -p --model openai/gpt-5.6-luna` + skin env) made a real Read
  tool call and answered correctly, `is_error:false`, `terminal_reason:completed`.

### Four corrections to HANDOFF-SCOREBOARD.md

1. **claude-code is NOT infeasible.** The handoff assumed OpenRouter's Anthropic skin serves only
   Anthropic models. It serves Luna. Both the raw API and the Claude Code CLI were verified working.
2. **The config fingerprint is harness-agnostic.** `taskConfigHash` (env-ledger.mjs:49-77) covers
   instance/image/imageId/testCmd/net/excludeP2P/excludeF2P/presed/rtHarness only. `HARNESS` is not
   in it. One ledger therefore serves all three harnesses; no per-harness sweep is needed.
   Verified: `ledger-postfix-20260807` passes preflight **17/17 gold-FULL** under `HARNESS=codex`,
   `HARNESS=opencode` and `HARNESS=claudecode`. ($0, three preflight runs.)
3. **`MAX_TOOL_CALLS` does not apply to any CLI harness.** It is threaded only into the bareapi
   runner (run-pilot.mjs:512 → api-task-runner.mjs:349). codex / opencode / claude-code are all
   uncapped. Caps are matched by being absent. The real bound is `AGENT_TIMEOUT_MS` (30 min default)
   — that is the value that must be held identical across arms and harnesses.
4. **17 qualifying tasks, not 15.** The pool file `select/.cache/tasks_full_luna_rotate20.json`
   holds 18 tasks. `litestar-org__polyfactory-405` is excluded by `task-overrides.json` as unfixable
   in the shim. The remaining 17 all hold green gold ledger rows.

### The claude-code cost defect (why it is "risky", not "feasible")

`claude-code-task-runner.mjs:105-130` sets `idealCostUsd = costRealizedUsd` on the OpenRouter route,
because the skin zeroes per-assistant-message usage. The smoke confirmed it: intermediate and final
assistant messages both carried `"input_tokens":0,"output_tokens":0`; only the aggregate `result`
event held real counts. Consequences: no cache-normalized cost, no break-priced column, and the only
available cost number is realized — the column this program forbids reading in an A/B
(`ideal-cache-cost` invariant). A claude-code cell can report **solve rate** honestly. It cannot
report cost honestly.

### Qualifying task set (17, green ledger `/root/.ss-eval/ledger-postfix-20260807/ledger.jsonl`)

redboltz__mqtt_cpp-466 (cpp), dotnet__yarp-2825 (csharp), dart-lang__http-1114 (dart),
dashbitco__nimble_options-43 (elixir), ontodev__robot-710 (java), codeception__codeceptjs-367 (js),
akinsho__nvim-bufferline.lua-173 (lua), mransan__ocaml-protoc-202 (ocaml), statamic__cms-9029 (php),
epiforecasts__scoringutils-229 (r), apple__swift-nio-http2-145 (swift), joshuakgoldberg__bingo-274
(ts), jashkenas__underscore-2757 (js), pytask-dev__pytask-210 (python),
rstudio-education__gradethis-161 (r), oceanparcels__parcels-617 (python),
teleporthq__teleport-code-generators-291 (ts)

Excluded: litestar-org__polyfactory-405 — `excludeFromAgentRuns`, unfixable in the shim (2026-08-07).

### Box state at Phase 0

Reachable. Uptime 16 days. `/` 65G available (disk guard needs ~12G). No pilot running. Stale idle
tmux session `p0smoke` and one orphan `until ! pgrep -f run-pilot` waiter (pid 3786111) — harmless,
no CPU. CLIs: codex-cli 0.146.1, opencode 1.18.4, Claude Code 2.1.218.

### Cost and time estimate per cell (17 tasks x 2 arms x REPS 2 = 68 rollouts)

| Cell | Money | Wall time |
|---|---|---|
| codex | $0 | ~2h (measured: 1.2–1.9h) |
| opencode | ~$0.31 (3x margin: ~$1) | ~2–3h |
| claude-code | ~$2–8 (unproven) | ~2–4h |

### Phase 0b — can the ChatGPT subscription drive all three harnesses? (operator question, 2026-08-11)

**No — not without building a bridge this session is forbidden to build.** Measured facts:

- `/root/.codex/auth.json` holds `auth_mode: "chatgpt"`, `OPENAI_API_KEY: null`, and an OAuth
  access token (`aud: https://api.openai.com/v1`, plan `prolite`, expires 2026-08-16T12:47Z).
  **There is no API key to hand to another harness.**
- The token WORKS against the codex backend: `POST https://chatgpt.com/backend-api/codex/responses`
  with `model: gpt-5.6-luna` → **HTTP 200**, free. It requires the OpenAI *Responses* format plus
  codex headers (`chatgpt-account-id`, `OpenAI-Beta: responses=experimental`, `originator`,
  `session_id`).
- The same token is REJECTED by the standard API: `POST https://api.openai.com/v1/chat/completions`
  → **HTTP 429 `credit_balance_exhausted`**, "You have no credits remaining."

Consequences per harness:
- **opencode** hardcodes OpenRouter in the runner (opencode-task-runner.mjs:98 config,
  :178/:264 `--model openrouter/<slug>`). Pointing it at the ChatGPT backend requires EDITING the
  runner — a build. It would also need the Responses API and codex headers to survive opencode's
  provider layer, which is unproven.
- **claude-code** speaks Anthropic Messages; the subscription endpoint speaks OpenAI Responses.
  No configuration bridges those. It needs a translating proxy — a substantial build.

### Serving-path confound (raised by Phase 0b)

The free codex cell reaches Luna through the **ChatGPT backend**. Any opencode / claude-code cell
reaches Luna through **OpenRouter**. Same model name, different serving stack. In a matrix whose
whole purpose is to isolate the harness, harness would be confounded with serving path.

Fix: run the codex cell through OpenRouter too (`PROVIDER=openrouter`, no `CODEX_SUBSCRIPTION`),
so all three cells share one endpoint and harness becomes the only variable. Added cost ~$0.54.

### Revised money estimate (17 tasks x 2 arms x REPS 2 = 68 rollouts per cell)

| Design | codex | opencode | claude-code | Total metered |
|---|---|---|---|---|
| A — free only | $0 (subscription) | — | — | **$0** |
| B — free codex + metered rest | $0 (ChatGPT backend) | ~$0.31 | ~$1.7 | **~$2** (serving path confounded) |
| C — all three via OpenRouter | ~$0.54 | ~$0.31 | ~$1.7 | **~$2.6** (clean isolation) |

claude-code estimate derived from its measured smoke: 3 trivial turns cost $0.0026 at Luna
OpenRouter rates (17.9k cache-write + 31.4k cache-read + 103 out).

**DECISION (operator, 2026-08-11): design B** — free codex on the subscription, opencode and
claude-code metered via OpenRouter, REPS=2, all three harnesses. Serving-path confound accepted
and recorded here so the write-up states it.

---

## Phase 0c — instrumentation repair (operator: "all harnesses must report all metrics")

Two defects would have made the cross-harness cost table dishonest. Both fixed, committed
`eff752d`, tests added (`tests/claude-code-cost.mjs`), harness re-synced to the box.

**Defect 1 — the box was running stale harness code.** Five files predated the break-priced
commit (a80c577, 2026-08-10): `ideal-cost.mjs`, `codex-task-runner.mjs`, `api-task-runner.mjs`,
`analyze-run.mjs`, `analyze-ab-smoke.mjs`. So `breakPricedCostUsd` did **not exist on the box for
any harness** — the handoff's "read the break-priced column, it is default in the analyzers now"
was not true of the machine the runs happen on. Mac was a strict superset (every diff was an
addition); pushed all five. Harness now byte-identical across all 40 files. No `rt-*.mjs` differed,
so the green ledger stayed valid (re-verified 17/17 after the push).

**Defect 2 — `costsFromTurns` dropped two columns.** It computed `breakPricedUsd` and
`contextRewrites` and then returned neither, so **opencode** never published break-priced cost
either. Only codex did.

**Defect 3 — claude-code had no turn distribution.** The OpenRouter Anthropic skin zeroes usage on
streamed assistant events, so the adapter fell back to ONE synthetic aggregate turn, published
`idealCost = realized`, and emitted no break-priced column. Recovered by reading Claude Code's own
session transcript (`<claude-home>/projects/<slug>/<session>.jsonl`), deduped by message id.
Validated against the provider: each transcript row's (input + cache_read + cache_creation) equals
OpenRouter's `native_tokens_prompt` for the matching generation, and `output_tokens` equals
`native_tokens_completion` (reasoning already folded in — not re-added).

Verified on real rollouts, same task and arm, after the fix:

| harness | turns | ideal | breakPriced | real | naive | content | rewrites |
|---|---|---|---|---|---|---|---|
| codex | 10 | 0.005555 | 0.005555 | 0.005276 | 0.020344 | 0.003912 | 0 |
| opencode | 13 | 0.007465 | 0.007465 | 0.007469 | 0.030142 | 0.004946 | 0 |
| claude-code | 10 | 0.006158 | 0.006158 | 0.006296 | 0.025581 | 0.004000 | 0 |

claude-code was 1 synthetic turn with `ideal == real` and no break-priced column before this.
breakPriced == ideal in all three because these trajectories are append-only (`rewrites = 0`) —
correct by construction, not a coincidence.

Also proven in Phase 0c: **claude-code runs a full rollout end-to-end** (13 calls, ss-* tools used,
graded) — it had never produced a single row before today.

---

## Phase 1 — the measurement

Config held IDENTICAL across all three cells (`/root/sb-run.sh`): 17 tasks, ARMS=native,sweet,
REPS=2 (68 rollouts/cell), CONCURRENCY=1, AGENT_TIMEOUT_MS=1800000, MODEL=openai/gpt-5.6-luna,
ENV_LEDGER=ledger-postfix-20260807. No tool-call cap on any CLI harness (`MAX_TOOL_CALLS` is
bareapi-only), so caps are matched by absence.

| Cell | RUN_ID | Status | Wall | Spend |
|---|---|---|---|---|
| codex (free) | sb-codex-20260811 | COMPLETE 68/68 | 2.2h | $0 (subscription) |
| opencode (metered) | sb-opencode-20260811 | COMPLETE 68/68 | 2.0h | $0.49 |
| claude-code (metered) | sb-claudecode-20260811 | RUNNING (from 17:05Z, ETA ~3.9h) | — | ~$0.57 proj. |

### Results so far (DEV-RET rotated tasks — dev data, NOT publishable)

**Solve — native never beats sweet on either harness.**

| Harness | native | sweet | both | native-only | sweet-only | neither |
|---|---|---|---|---|---|---|
| codex | 9/17 | 10/17 | 9 | **0** | 1 | 7 |
| opencode | 9/17 | 9/17 | 8 | 1 | 1 | 7 |

**Cost — break-priced, paired, sweet vs native** (negative = sweet cheaper; %CI is the saving):

| Harness | Both-solved | 95% CI | p | All 17 paired | 95% CI | p |
|---|---|---|---|---|---|---|
| codex | −9.6% (n=9) | [−3.1%, +22.7%] | 0.138 | −6.5% | [−5.3%, +17.2%] | 0.275 |
| opencode | **−15.7%** (n=8) | [+9.1%, +21.9%] | **0.000** | **−17.8%** | [+10.6%, +27.6%] | **0.000** |

breakPriced == idealCost in every cell, both arms: context is append-only, so no cache break
hides inside the cheaper column. The instrumentation repair is doing its job.

---

## FINAL SCOREBOARD — 204 rollouts, 3 harnesses, model held at Luna (COMPLETE 2026-08-11 20:09Z)

Metered spend **$1.31** (opencode $0.49 + claude-code $0.82); codex $0 on the subscription.
Under the $2 estimate. All 204 rollouts carry a non-null `breakPricedCostUsd`; `contextRewrites`
is 0 everywhere, so breakPriced == ideal by construction and no cache break hides in any column.

### Solve

| Harness | native | sweet | both | native-only | sweet-only | neither |
|---|---|---|---|---|---|---|
| codex | 9/17 | 10/17 | 9 | **0** | 1 | 7 |
| opencode | 9/17 | 9/17 | 8 | 1 | 1 | 7 |
| claude-code | 9/17 | 9/17 | 8 | 1 | 1 | 7 |

### Cost — break-priced, paired (negative = sweet cheaper)

| Harness | Both-solved | 95% CI | p | All 17 paired | 95% CI | p |
|---|---|---|---|---|---|---|
| codex | −9.6% (n=9) | [−3.1%, +22.7%] | 0.138 | −6.5% | [−5.3%, +17.2%] | 0.275 |
| opencode | **−15.7%** (n=8) | [+9.1%, +21.9%] | **0.000** | **−17.8%** | [+10.6%, +27.6%] | **0.000** |
| claude-code | +0.2% (n=8) | [−12.7%, +17.5%] | 0.909 | +2.4% | [−15.5%, +11.4%] | 0.784 |

### ANSWER 1 — is a cost win real on this backbone?

**Yes, but it is harness-dependent, not a property of sweet alone.** Significant on opencode
(−15.7% at exact solve parity, CI excludes zero). Directionally present but not significant on
codex. Exactly zero on claude-code. Any published cost claim must name the harness.

### ANSWER 2 — is "native solves more" a property of sweet or of the harness?

**Neither. It is a single task, and a coin flip.** 13 of 17 tasks are invariant to BOTH arm and
harness: 7 solved by every arm on every harness, 6 solved by nobody anywhere. Only 4 tasks vary,
and the entire arm-level solve difference across all three harnesses reduces to ONE task,
`pytask-dev__pytask-210`, whose winner flips by harness (sweet on codex, native on the other two).

Per-rep detail kills the "native solves more" reading outright:

| Harness | native reps solved | sweet reps solved |
|---|---|---|
| codex | 0/2 | **2/2** |
| opencode | **1/2** | 0/2 |
| claude-code | **1/2** | 0/2 |

Native's two "wins" are 1-of-2 reps each — variance. Sweet's win is 2-of-2 — consistent. The
other three varying tasks are also single-rep flips, except `jashkenas__underscore-2757`, which is
a pure HARNESS effect (both arms solve it on codex and opencode, neither arm on claude-code).

## Phase 2 — discordant-pair mining

Only two native-solved-sweet-did-not pairs exist in 204 rollouts, and both are the same task.

**`pytask-dev__pytask-210` — classed AGENT-BOUND (generation incompleteness), not retrieval-starved.**

Evidence, from patches (not trajectory files — those truncate tool results at 600 chars):
- Every sweet rollout on all three harnesses edited exactly ONE file, `src/_pytask/traceback.py`,
  which is the correct location. Sweet never mis-localized.
- The task requires supporting a CALLABLE `__tracebackhide__`, which must receive `exc_info`.
- Sweet on codex (SOLVED, 3 hunks) threaded `exc_info` through the whole chain: added the
  parameter to both helpers, updated the call site, and invoked `is_hidden(exc_info)`.
- Sweet on opencode (FAILED, 1 hunk) reached the SAME insight — it wrote `if callable(is_hidden)`
  — but called `is_hidden()` with no argument and never propagated the parameter.

So the deciding fact was PRESENT in sweet's context on every harness: sweet found the function and
modified it every time. The failure is the depth of the generated edit, not what was retrieved.
There is no retrieval gap to close here. This is the fourth independent analysis to land on the
same conclusion — consistent with [[project_resolution_floor_universal_wrongfix]].

### Ranked improvement hypotheses (all agent-bound; none is a retrieval lever)

1. **Call-chain completeness after a signature change** (evidence: direct, 1 task, 4 rollouts).
   When an edit adds a parameter, nothing forces the agent to update every caller and definition.
   Sweet did this correctly on codex and not on the other two. This is a completion-discipline
   candidate, not a retrieval one, and prior completeness levers have died at the $0 gate.
2. **Harness-level capability gap** (evidence: direct, 1 task, 4 rollouts).
   `jashkenas__underscore-2757` is solved by BOTH arms on codex and opencode and by NEITHER on
   claude-code. That is a pure harness effect worth understanding before any claude-code numbers
   are published.
3. **The 7-task floor** (evidence: strong, 42 rollouts). Seven tasks were solved by no arm on any
   harness. They bound the achievable score and are, by construction, retrieval-independent.

**Do NOT build any of these here.** Each must pass the normal $0-exposure microsmoke gate first.

## Caveats that must travel with these numbers

1. **DEV-RET rotated dev tasks. Not publishable.** HO2 was never touched.
2. **n=17 per cell.** The codex and claude-code cost intervals both span zero.
3. **Serving-path confound (operator-accepted design B):** codex reached Luna through the ChatGPT
   backend; opencode and claude-code through OpenRouter. Harness is therefore confounded with
   serving path in any codex-vs-other comparison. The opencode-vs-claude-code contrast is clean.
4. The prior "native solves more" result (Grok, hardened heldout, 81v93) does not reproduce here,
   but that used a different model AND task set — this contrasts with it, it does not overturn it.

**Program status: the scoreboard is closed. Ready for the single, final, aggregate-only HO2 pass.**
