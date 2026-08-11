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

**STATUS: STOPPED. Operator chose all three harnesses at REPS=2, then asked for it to be free.
Those two are incompatible. Awaiting the design choice (A / B / C).**
