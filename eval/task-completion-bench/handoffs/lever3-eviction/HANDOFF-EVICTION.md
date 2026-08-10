# Handoff — microsmoke lever #3: phase-aware context eviction (+ span-capped fusion)

You are a fresh session picking up the sweet-search task-completion-bench program. Your job:
**microsmoke "phase-aware eviction" starting with its $0 gate** — the residual re-send tail lever.
Follow the `/microsmoke` skill exactly (it is installed). Do NOT skip the $0 gate. Do NOT touch the
frozen held-out set (HO2). Use Luna via the codex subscription on the box (flat-rate → no real money).

**The single most important instruction: this is a $0 measurement first, a build second.** Do not
build an eviction engine or run any live cell until the $0 gate says the residual tail is large
enough to be worth it. The gate may kill the lever for $0 — that is a success, not a failure.

---

## 1. Context — what sweet is, and why #3 is a COST lever

sweet-search is a code-retrieval engine exposed to a coding agent as CLI tools (`ss-search`,
`ss-grep`, `ss-semantic`, `ss-read`, …). The benchmark: SWE-rebench-style repair tasks — edit repo
SOURCE so the hidden FAIL_TO_PASS tests pass and PASS_TO_PASS stay green. Two arms drive the SAME
agent (codex harness, model `openai/gpt-5.6-luna` via a ChatGPT subscription):
- **native**: raw `rg`/grep + `sed`/cat reads.
- **sweet**: the ss-* tools + an M± "fix discipline" prompt block (delivered via the memory file, not
  the prompt).

**Why cost, not resolution.** The run_tests-verdict-defect arc (commits 2b80ee3 fix + 0862215
payoff) proved with the loss taxonomy that resolution is FLOOR-LIMITED by a UNIVERSAL, retrieval-
INDEPENDENT wrong-fix class (native ~67% / sweet ~64% of losses = "agent satisfies the visible base
tests, misses the hidden assertion the grader adds"). Better retrieval cannot reveal an assertion
that is not in the repo. So the honest publishable headline is the **COST story** (sweet is the
cheaper arm at parity), not resolution. Lever #3 attacks cost directly. See memory
`project_resolution_floor_universal_wrongfix`.

## 2. The lever

As a task runs, the agent's context fills with old search results and old test logs that get
**re-sent every turn** (the "resident prefix re-send tax"). Phase-aware eviction deterministically
drops stale tool-result BODIES at edit/test boundaries, leaving a short refetchable placeholder, and
keeps only current-state information. "Span-capped fusion" then bundles a search and its follow-up
read into one payload — which only pays off WITH eviction, because otherwise the fused bundle itself
gets re-sent forever. GPT-Sol ranked this the top remaining COST lever. Its full write-up is
`handoffs/luna-rotate18/GPT-SOL-REPLY.md` §"Phase-aware tool-result eviction" (grep `eviction`).

## 3. The number you must NOT trust blindly (why the $0 gate exists)

GPT's evidence was: resident re-send = **33.4% of all ideal spend** and **48.8% of dart rep0**, with
replayed cap ceilings of ~11–22% direct tail savings on dart-like traces. **That number PREDATES
lever #1.** Lever #1 (auto-await run_tests, SS_RT_LONGYIELD, SHIPPED default-on) already removed the
POLL part of that tail — poll turns were 23.1% of requests / 15.9% of spend, cut −71%. GPT's 33.4%
double-counts the polls we already eliminated.

**So the whole question is: how much re-send tail remains AFTER #1?** If polls were most of it, #3 is
already banked and you drop it for $0. If the old-search-body / old-test-log re-send is still large,
#3 is a justified build. You cannot know which without measuring the NON-poll tail. That is Gate 0.

## 4. The microsmoke plan (follow /microsmoke gates in order)

### Gate 0 ($0, no model calls) — measure the residual re-send tail, then trigger-grid it

There is NO ready-made tool for this on the Luna data. The existing replay tools
(`stats/search-read-replay.mjs`, `stats/w0b-fusion-economics.mjs`) operate on the **retired Grok
551-pair `opencode.db`**, NOT the Luna codex rollouts — reuse them ONLY for the fusion-economics
sensitivity in Gate 0c, never as the Luna tail measurement. Build a small parser instead:

- **0a — residual tail census (build `stats/resend-census.mjs`).** Parse the raw Luna codex rollout
  dumps in the SAME format `stats/poll-census.mjs` reads (`===TASKARM:<key>:R<rep>===` markers, then
  one JSON event per line; `token_count.last_token_usage` carries `input_tokens` incl.
  `cached_input_tokens`). For each model request, attribute its `cached_input_tokens` to the resident
  re-send tax and split it by what is being re-sent: (i) prior tool-result BODIES (search/read/test
  output), (ii) the agent's own edits/state, (iii) system+frame. **Subtract poll turns** (reuse
  poll-census's `classify()` — a `write_stdin` turn is a poll) so you measure only the tail #1 did
  NOT remove. Output: residual re-send $ and % of ideal spend, per arm, both post-#1. This is the
  headline gate number.
- **0b — trigger-grid replay.** For dart + mransan (the two blow-up tasks), replay a **24 / 32 / 40 /
  48K resident-cap grid**: at each edit/test boundary, evict tool-result bodies older than the cap,
  keep a placeholder, and recompute input tokens. Report input-tokens-avoided and cached-rate floor
  at each cap. CRITICAL solve-safety measurement: for every evicted body, check whether a LATER turn
  re-reads or depends on it (a refetch). High refetch rate at a cap = that cap is unsafe (it would
  starve a solve). Report the refetch rate per cap — this decides whether eviction is solve-safe or
  lossy.
- **0c — fusion economics (reuse existing tool).** Run `stats/w0b-fusion-economics.mjs <opencode.db>`
  for the sensitivity showing fusion flips negative→positive only with eviction. This is a prior-
  distribution sensitivity, NOT a Luna measurement — cite it as supporting, not as the gate.

**Pre-registered bar (write it down before you run):** #3 proceeds to a live smoke ONLY if the
residual non-poll tail is ≥ ~15% of ideal spend AND at least one cap in the grid avoids material
input (≥ ~10%) at a LOW refetch rate. If the residual tail is small (polls were most of it) or every
material cap has a high refetch rate (eviction would cost solves), **DROP #3 for $0** and move to
lever #4's cheap taxonomy pass instead.

### Gate 1 — diagnostic + control tasks (DEV-RET only; HO2 is frozen)
- Diagnostics (context blow-up): `dart-http`-class task, `mransan`. These carry the tail #3 targets.
- Controls (must NOT regress): `teleport`, `scoringutils`, `redboltz`. Eviction must never turn a
  clean solve into a loss (solve-safety veto — accuracy is non-negotiable).

### Gate 2 — live smoke (only if Gate 0 clears the bar; Luna via codex subscription)
Both arms, REPS≥2, CONCURRENCY=1, matched cap (60). Eviction is arm-symmetric — apply it to BOTH
native and sweet and report as an ablation; a sweet-only cost win is an unfair number. Read SOLVE
FLIPS first (must be zero control regressions), THEN cost. idealCost (cache-normalized), never
realized. Gate the treatment behind a NEW env flag (e.g. `SS_EVICT_CAP=<tokens>`) so the $0 render
check proves it fires and the A/B is not an accidental A/A.

### Gate 3–5 — read (cost delta + zero solve regression), rotate on fresh DEV-RET tasks, then promote.
Neutral-on-rotation is NOT dead — re-smoke with more reps before discarding.

## 5. Box run recipe (verified 2026-08-07)

Runner: `/root/smoke.sh` on the box (root@167.233.69.121). Sets the codex-subscription env. GOTCHAS
that WILL bite you (memory `project_codex_subscription_run_gotchas`):
- `MODEL=openai/gpt-5.6-luna` (FULL string — the pricing key in ideal-cost.mjs). The bare id aborts
  every rollout at the pricing guard ($0 spent, caught pre-agent).
- `REASONING=medium`; `EGRESS_ALLOW=chatgpt.com,openai.com`; `DOCKER_HOST=unix:///var/run/docker.sock`;
  `CODEX_SUBSCRIPTION=1`; `HARNESS=codex`; codex CLI ≥0.146.
- **Green ledger:** the eviction flag does NOT change the env-ledger fingerprint (only image/testCmd/
  net + the 4 rt-shim files are hashed — see memory `project_poll_await_lever`), so the CURRENT ledger
  `ledger-postfix-20260807` (18/18 gold-valid) stays valid. Point `ENV_LEDGER` at it. Preflight with
  `PREFLIGHT_ONLY=1` first ($0). If you touch any rt-shim file, re-sweep with `env-ledger-sweep.mjs`.
- One pilot at a time on the box (dubious-ownership uid-501 bug). Per-task image GC (no pre-pull).
  Disk guard: abort if `df / avail` < ~12G.

Example (only after Gate 0 clears):
```
RUN_ID=evict-preflight INSTANCES=dart-http-<id>,redboltz__mqtt_cpp-466 \
  ENV_LEDGER=/root/.ss-eval/ledger-postfix-20260807/ledger.jsonl PREFLIGHT_ONLY=1 /root/smoke.sh
RUN_ID=evict-smoke-v1 INSTANCES=<diag>,<control> ARMS=native,sweet REPS=2 CONCURRENCY=1 \
  MAX_TOOL_CALLS=60 ENV_LEDGER=/root/.ss-eval/ledger-postfix-20260807/ledger.jsonl \
  SS_EVICT_CAP=32000 /root/smoke.sh
```

## 6. Do NOT redo (closed / out of scope)
- **Poll turns (lever #1)** — SHIPPED default-on (SS_RT_LONGYIELD). Do not re-litigate; SUBTRACT them
  from your tail measurement so you do not double-count.
- **Standalone fusion (no eviction)** — GPT verdict: never; the fused bundle re-sends forever without
  eviction. Fusion is only in scope AS A RIDER on eviction.
- **Retrieval dedup (#5)** — DEAD ($0: 0 dup ss-* calls, 3% repeat).
- **Checkpoint-on-green (#2)** — NO-GO (0/119 exposure, 2/5 selector regressions, over-edit-past-green
  0% in all four taxonomy cells). See `handoffs/lever2-checkpoint/`.
- **Global hard turn/retrieval caps, disabling canonical tests** — GPT verdict: never (solve risk).
- **Completeness card (#4), 2-candidate gen (#6)** — separate levers, not this handoff. #4 is the
  fallback if #3 dies at Gate 0.

## 7. References in-repo
- `handoffs/luna-rotate18/GPT-SOL-REPLY.md` — GPT's ranked portfolio; §eviction has the cap ceilings.
- `stats/poll-census.mjs` — the raw-rollout parser to copy for `resend-census.mjs`; its `classify()`
  identifies poll turns to subtract.
- `stats/w0b-fusion-economics.mjs`, `stats/search-read-replay.mjs` — fusion economics on the RETIRED
  Grok db only (Gate 0c sensitivity, not the Luna tail).
- `OVERNIGHT-LOOP-2026-08-07.md` — the full 6-lever triage; §"Lever #3" is the scoped-out note.
- `.claude/skills/microsmoke/SKILL.md` — the gate protocol you must follow.
- Memory: `project_poll_await_lever`, `project_resolution_floor_universal_wrongfix`,
  `project_codex_subscription_run_gotchas`, `project_cost_forensics_2026_07_08` (resident re-send =
  driver, thrash taxonomy, levers L1–L5).

Deliverable: a go/no-go on eviction with (1) the residual NON-poll re-send tail as % of ideal spend
per arm, (2) the trigger-grid input-avoided + refetch-rate table on dart + mransan, (3) if it clears
the bar, the live-smoke solve flips (zero control regression) + cost delta both arms, (4) the
publishability framing (arm-symmetric cost ablation, not a retrieval win). Kill it at Gate 0 if the
tail is small or eviction is lossy — that is the cheap win the method is for.
