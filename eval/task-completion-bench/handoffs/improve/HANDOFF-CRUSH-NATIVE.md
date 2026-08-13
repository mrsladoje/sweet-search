# Handoff — find how sweet CRUSHES native on cost AND resolution, on ALL THREE harnesses

You are a fresh session. Read this whole file, then go read **real rollout traces** before you
propose anything.

**The goal, stated by the operator, verbatim in intent:** sweet must be **cheaper AND resolve more
than native on every harness**. Not parity. Not "cheaper on one harness." Domination. A lever that
helps one harness is a partial answer; say so and keep going.

**If you are told you are SESSION A**, lead with COST and cover resolution second.
**If you are SESSION B**, lead with RESOLUTION and cover cost second. Both must address both. You
are one of two independent sessions; do not try to guess what the other is doing.

---

## Orientation — assume you know nothing about this project

**sweet-search** is a local code-retrieval tool. It indexes a repository and exposes CLI commands an
AI coding agent can call: `ss-search` (hybrid semantic + lexical), `ss-grep` (regex + rerank),
`ss-read` (read a span), `ss-find`, `ss-trace`, `ss-semantic`. Source is on the Mac at
`/Users/admin/Projects/sweet-search-private` (this repo). The claim under test is that an agent given
these tools solves real software issues **more cheaply and more often** than the same agent using
plain shell tools.

**The benchmark** (`eval/task-completion-bench`) is SWE-bench-style. Each task hands a coding agent a
real GitHub issue and a repository checked out at the commit before the fix. The agent edits source
until it believes it is done. Grading is by **hidden tests** the agent never sees: a `test_patch` is
applied afterwards and the task counts SOLVED only if the specified failing tests now pass
(`FAIL_TO_PASS`) without breaking others (`PASS_TO_PASS`). The agent can run the real suite during
the rollout via a `run_tests` shim.

**The two arms, which is the whole comparison:**
- **`native`** — the agent gets only plain tools: shell `grep`, file `Read`, `bash`. No sweet-search.
- **`sweet`** — the agent gets the `ss-*` commands instead, plus a small fixed instruction prefix.
Everything else is held identical: same model, same task, same time limit, same grading. Any
difference in cost or solve rate is attributable to the retrieval tooling.

**Three harnesses** run the agent loop: `codex` (OpenAI CLI), `opencode`, and `claude-code`. The same
task/arm is run on all three because harness behaviour differs a lot. **Backbone model for every
rollout here: `gpt-5.6-luna`.**

**Vocabulary used throughout:** a *rollout* is one (task, arm, rep) run. A *cell* is one (task, arm,
harness). *Solve* / *resolution* = the hidden tests pass. *Cost* is USD of model tokens.
*break-priced cost* is the cost metric that stays honest when a prefix cache is broken.
*M±* is a block of general agent guidance delivered to the sweet arm through a memory file
(`CLAUDE.md` / `AGENTS.md`). The *FRAME* is task framing given to **both** arms.
*DEV-RET* is the development task set; *HO2* is a frozen held-out set you must never touch.

---

## 0. Why you exist: the previous session failed, and here is exactly how

A three-model-family panel (Opus 5, Fable 5, GPT-5.6) generated **30 levers** and killed all 30.
The killing was rigorous. The **generating was not**, and the root cause is diagnosable:

> **The previous session reasoned almost entirely from AGGREGATES** — cost tables, taxonomy counts,
> exposure tallies, per-task means. It built a 460 KB `evidence-pack.json` of *summary statistics*
> and fed that to every agent. Agents proposed levers against summary rows.
>
> **Every genuinely new finding in that session came from the rare moments an agent opened a full
> raw trace and read it.** That is where `Enum.map(@basic_types -- [:integer], &inspect/1)` came
> from — an agent adding `:integer` to a list and subtracting it right back to keep a stale
> assertion green. That is where the `:integer`-inserted-after-`:boolean` positional bug came from.
> That is where the off-ledger subagent spend came from. **Aggregates produced nothing. Traces
> produced everything.**

**Your mandate: READ THE TRACES. Full rollouts, end to end, many of them.** The aggregate work is
already done and is handed to you below so you never have to redo it. Your job is the part that was
skipped: *watch sweet actually work, and find what it does badly.*

**Do not spend the session screening.** Thirty levers have already been killed by a three-family
adversarial panel. The marginal value of another kill is near zero. The marginal value of one real,
trace-grounded observation about sweet's behaviour is very high.

---

## 0.5 THE SHAPE OF EVERY FAILURE SO FAR — read this before you have a single idea

Do not just read the dead list as 30 items. Read it as **one shape**. Here is every killed candidate,
classified:

| class | count | examples |
|---|---|---|
| retrieval expansion / sibling-finding | 7 | sibling echo, semantic closure, structural closure, public-facade closure, caller-set-inline, dep-source reach, reverse-import pack |
| result rendering / compaction | 6 | envelope density, run_tests compaction, duplicate-span elision, symbol-complete read, per-turn ceiling, tool retirement |
| prompt / memory doctrine | 5 | stale-oracle override, look-before-api, tests-first, completeness card, checkpoint-on-green |
| verification / annotation | 5 | stale-assertion arbitration, stale-test annotation, diff-vs-evidence, type-contract verifier, match-judge |
| guards / limits | 4 | edit-scope guard, zero-edit floor, no-progress abort, thrash reduction |
| ranking tweaks | 2 | test-to-source reranker, scope-honest retrieval |
| cache / prefix | 2 | static-prefix alignment, preamble trim |

**THE SHAPE: all 30 are an incremental modification to an existing pipeline stage.** Every single one
takes the system as given and adjusts one knob — what gets retrieved, how it is rendered, what the
prompt says, what gets checked, what gets capped.

**Not one proposed a new capability. Not one changed what the agent is asked to DO. Not one
questioned the premise. Zero.**

Three model families at maximum reasoning effort, six independent generators, and the entire output
occupied seven small buckets. That is not because those are the only options. It is because everyone
was handed a summary of the existing pipeline and asked to improve it, so everyone proposed a
slightly better version of what already exists.

**If your candidate fits one of those seven rows, you must explicitly justify why it is not dead for
the same reason the other 30 were.** The prior is strongly against you. Assume the incremental
surface has been swept clean — because it has been, twice.

**What is actually in play — a non-exhaustive widening, not a menu:**
what `ss-*` fundamentally *returns* (not how it is formatted); when retrieval happens at all;
capabilities that do not exist today; changing what the agent is asked to produce; the interaction
model between agent and index; anything that makes the model *verify* instead of *guess*; attacking
the wrong-fix directly; exploiting something native structurally cannot do. Also fair game:
**arguing that the benchmark measures the wrong thing** and saying what should be measured instead —
if you can support it from traces.

---

## 1. WHERE THE FULL TRACES ARE (verified 2026-08-12 — this is the part that matters)

Everything is on the box: **`ssh root@167.233.69.121`**. Read-only. **Never launch a rollout, never
spend money, never mutate `results/`.** Another agent may be using the box; do not run a pilot.

Base: `/root/sweet-search-private/eval/task-completion-bench/results/<RUN_ID>/`
`RUN_ID ∈ {sb-codex-20260811, sb-opencode-20260811, sb-claudecode-20260811}`

Each run = 17 tasks x 2 arms (`native`, `sweet`) x 2 reps = 68 rollouts. 204 rollouts total.

**Confirm your access before anything else** — this should print 68, 68, 68, 14, 104:

```bash
ssh root@167.233.69.121 'cd /root/sweet-search-private/eval/task-completion-bench/results
 ls sb-codex-20260811/agent-state/*/codex-home/sessions/*/*/*/rollout-*.jsonl | wc -l
 ls sb-opencode-20260811/agent-state/*/opencode-retained/*/attempt-1.stdout.ndjson | wc -l
 ls sb-claudecode-20260811/agent-state/*/claude-home/projects/*/*.jsonl | wc -l
 ls sb-claudecode-20260811/agent-state/*/claude-home/projects/*/*/subagents/*.jsonl | wc -l
 ls sb-*/[ns]*/logs/*_log.txt | wc -l'
```

### START HERE: a working transcript reader is already built and tested for you

**`/root/dump-trace.mjs` on the box** (also committed at
`eval/task-completion-bench/handoffs/improve/dump-trace.mjs`). It renders a full, readable
transcript — every message, every tool call with its real shell command, every tool result
**untruncated** — for any harness/task/arm. It was written and verified against all three harnesses
on 2026-08-12. **Use it. Do not hand-parse three different JSON schemas.**

```bash
ssh root@167.233.69.121
cd /root

node dump-trace.mjs --list                                    # all 17 task ids

# full transcript, everything untruncated (default: --max-result 0 = unlimited)
node dump-trace.mjs dashbitco__nimble_options-43 sweet --harness codex

# just the tool calls + their results, clipped for skimming
node dump-trace.mjs dart-lang__http-1114 sweet --harness claude-code --tools-only --max-result 800

# claude-code, including the subagent (isSidechain) sessions
node dump-trace.mjs dart-lang__http-1114 native --harness claude-code --subagents

# one rep only
node dump-trace.mjs joshuakgoldberg__bingo-274 sweet --harness opencode --rep 0
```

Flags: `--harness codex|opencode|claude-code` (default codex) · `--rep N` · `--max-result N`
(0 = unlimited, the default) · `--tools-only` · `--subagents` · `--list`.

**The single most valuable thing you can do in this session** is run the same task through
`dump-trace.mjs` for `sweet` and for `native`, side by side, and read both end to end.

### The raw files, and the three schemas — if you need to go past the reader

~700 MB total, one trace per rollout, 204 rollouts.

| harness | path | schema you must know |
|---|---|---|
| **codex** | `agent-state/<task>-<arm>/codex-home/sessions/YYYY/MM/DD/rollout-*.jsonl` (443 MB; absolute path also in `rows.json` → `rolloutFile`) | Records are `{timestamp, type, payload}`. `type:"response_item"` with `payload.type` ∈ `message` (role/content[].text), `custom_tool_call` (`.name`, `.call_id`, `.input`), `custom_tool_call_output` (`.call_id`, `.output[]` = **full untruncated result**), `reasoning`. `type:"event_msg"` with `payload.type` ∈ `user_message` (the issue), `agent_message` (assistant text), `token_count`, `patch_apply_end`. Also `session_meta`, `turn_context` (model, effort). **Trap: the real shell command is buried inside a JS snippet** — `custom_tool_call.input` looks like `const r = await tools.exec_command({cmd:"ss-search ...", ...})`; you must regex `cmd:"..."` out of it. **Trap: `reasoning` is ENCRYPTED** (`encrypted_content`, empty `summary`) — codex chain-of-thought is NOT readable. |
| **opencode** | `agent-state/<task>-<arm>/opencode-retained/session-*/attempt-1.stdout.ndjson` (237 MB) | Records are `{type, timestamp, sessionID, part}`. `type:"tool_use"` → `part.tool` (name), `part.callID`, `part.state.input` (object), `part.state.output` (**full result**), `part.state.status`. `type:"text"` → `part.text` (assistant). `type:"step_finish"` → `part.tokens`, `part.cost`. |
| **opencode (alt)** | `agent-state/<task>-<arm>/opencode-data/opencode.db` | SQLite. Tables include `session`, `message`, `part`, `todo`, `permission`, `event`. Query `part` for tool calls. |
| **claude-code** | `agent-state/<task>-<arm>/claude-home/projects/<slug>/<sessionId>.jsonl` (23 MB) | Records are `{type, requestId, isSidechain, message:{role, content[], usage}}`. Content blocks: `text`, `tool_use` (`.name`, `.id`, `.input.command`), `tool_result` (`.tool_use_id`, `.content`), **`thinking` (READABLE on this harness — the only one where it is)**, `redacted_thinking`. **Trap: the same assistant message is streamed repeatedly, each copy growing.** If you dedupe whole records by `requestId` you will keep the first copy and silently LOSE its `tool_use` blocks. Dedupe individual BLOCKS (by `tool_use.id` / `tool_result.tool_use_id`), not records. This bug bit the tool author; the shipped reader handles it. |
| **claude-code subagents** | `.../<sessionId>/subagents/agent-*.jsonl` | Subagent sessions, `isSidechain:true`. **Excluded from the cost ledger — see §3.** Reach them with `--subagents`. |

### The derived/summary artifacts (already built — use, don't rebuild)

| artifact | contains |
|---|---|
| `rows.json` | 68 rollouts: `taskId, arm, rep, resolved, f2pFrac, calls, ss, nativeGrep, toolCounts{}, patchHunks, patchFiles, stepsToFirstEdit, nudges, exitReason, usage{}, breakPricedCostUsd, idealCostUsd, contextRewrites, idealTurns, wallMs, gradeable, goldSimilarity` |
| `preds-<arm>.jsonl` | `model_patch` — the FULL final diff, untruncated |
| `turns/<task>-<arm>.jsonl` | per-turn `{t, in, cached, out}` + `meta.price` |
| `<arm>/logs/<task>_log.txt` | **full test output** — compiler errors, assertion failures, stack traces |
| `rt-dedup/<task>-<arm>.jsonl` | repeat-`run_tests` audit |
| `trajectories/` | tool-call ORDER only — **tool results truncate at 600 chars and `input` at 200. NEVER infer "was not in context" from these. Use the raw traces above.** |

Gold patches: `select/.cache/tasks_full_luna_rotate20.json` — fields `patch`, `test_patch`,
`FAIL_TO_PASS`, `problem_statement` are **top-level, not under `spec`**.

**Pre-built, on the Mac, and worth reading first** (in
`eval/task-completion-bench/handoffs/improve/`): `EVIDENCE-DIGEST.md` (~560 lines, Section I holds 11
derived findings), `evidence-pack.json` (cells[204], loc[102], turns[102], paired[51], gold{17}),
`RUN-LEDGER.md` (the previous session's conclusions and every kill).

---

## 2. WHERE WE ACTUALLY ARE

"sweet" = the arm with the `ss-*` retrieval tools. "native" = plain grep/read/bash. Backbone: Luna
(`openai/gpt-5.6-luna`). 17 rotated DEV-RET tasks. **HO2 is frozen — never touch it.**

### Cost, paired break-priced (negative = sweet cheaper)

| harness | both-solved | p | all 17 | p |
|---|---|---|---|---|
| codex | −9.6% (n=9) | 0.138 | −6.5% | 0.275 |
| opencode | **−15.7%** (n=8) | **0.000** | −17.8% | 0.000 |
| claude-code | +0.2% (n=8) | 0.909 | +2.4% | 0.784 |

### Solve — this is the real problem, and it has barely moved

| harness | native | sweet | both | native-only | sweet-only | neither |
|---|---|---|---|---|---|---|
| codex | 9/17 | **10/17** | 9 | 0 | 1 | 7 |
| opencode | 9/17 | 9/17 | 8 | 1 | 1 | 7 |
| claude-code | 9/17 | 9/17 | 8 | 1 | 1 | 7 |

**Sweet's entire net solve advantage across 204 rollouts is ONE task on ONE harness.** Three of the
four apparent differences are single-rep coin flips. **Resolution is where domination has to come
from, and nothing has moved it yet.**

### Statistical reality — a constraint, NOT permission to stop

The claude-code cost gap is **not statistically distinguishable from zero**: per-task SD $0.003567,
SE $0.000865, 95% interval about −$0.0264 to +$0.0359, sign-flip p ≈ 0.79. Rep 0 alone puts sweet at
+26.24%; rep 1 at −17.28%.

**What this means for you:** a 1-2% cost lever is unprovable at n=17 and is therefore not worth
proposing. **Aim for effects big enough to see** — a solve flip, or a cost effect of 15%+. The
previous session wasted itself on 1-2% levers. Do not repeat that. *"Too small to measure" is a
reason to aim bigger, not a reason to stop.*

---

## 3. VERIFIED FINDINGS — do not re-derive these, build on them

All eleven were derived from artifacts and independently checked. Section I of `EVIDENCE-DIGEST.md`
has full detail.

1. **The gold file set is NOT the pass criterion.** 25 of 51 solved-or-partial cells resolved while
   touching a strict subset of gold files, or none. `ontodev__robot-710` SOLVES in all 6 cells hitting
   **0 of 3** gold files. Gold patches bundle CHANGELOG/docs/.gitignore that no test needs. **Measure
   test-relevant files, never gold files.**
2. **`joshuakgoldberg__bingo-274` is not a retrieval problem.** Three of its six code files
   (`isFile.ts`, `handlebarsDirectory.ts`, `handlebarsFile.ts`) are **`new file mode` — they do not
   exist at base**, as are all three F2P test files. Every one of the 6 cells found only the +1/-1
   change in `handlebars.ts` and missed the rest. It is an **authoring** task.
3. **`dart-lang__http-1114` is scope control, not localization.** All 6 cells found the right
   substantive file (`base_response.dart`, +68/-1) and then added **5-8 wrong files**. On claude-code
   sweet spends 21 edit calls to land 10.5 hunks; native spends 10 to land 25.
4. **Three never-solved tasks sit at PERFECT localization** (`apple__swift-nio-http2-145`,
   `dotnet__yarp-2825`, `dashbitco__nimble_options-43`): both arms touched every gold file and failed.
   Their logs contain **no compiler errors** — `apple`'s 9 `error:` lines are XCTest behavioural
   assertions, and sweet and native emit **byte-identical** failures.
5. **`codeception__codeceptjs-367` is arm-universal noise.** 5 of 6 cells (both arms) edited the same
   wrong file `lib/helper.js`; the one cell that hit a gold file **still failed**.
6. **`mransan__ocaml-protoc-202` has a ZERO-CHARACTER problem statement**, 19 gold files, 33 hunks.
   Opencode sweet made **0 tool calls in 1 turn on both reps** and produced no patch — a refusal, not
   efficiency. It is ~26% of opencode's headline advantage. Excluding it: −13.8%, not −17.8%.
7. **The fixed sweet prefix** is exactly **+1457 tokens** (codex/opencode) and **1,585-1,590**
   (claude-code). Full carrying cost on claude-code $0.00721; only $0.00243 recoverable. Ceiling ~3.9%.
8. **claude-code's bill is 43% cached input, 29% output.** Sweet HALVES claude-code output
   (105,834 → 53,996 tokens) and still doesn't win, because cached input moves only −6%.
9. **Sweet reaches its first edit much sooner** — claude-code 11.4 steps vs native's 20.2 (−44%),
   opencode 17.0 vs 22.8 — **and converts none of that head start into a win.** Nobody has explained
   this. It may be your best thread.
10. **Sweet displaces READ and GREP completely** (opencode `nativeRead` 247→0, `nativeGrep` 191→4)
    **but does NOT displace BASH or TEST** (bash 251→219, test 86→74).
11. **There is no doomed tail.** All 204 rollouts exit `model_stopped`; none hits a cap.
    `contextRewrites` is 0 in all 204, so break-priced cost **equals** ideal cost on this dataset.

**Plus one accounting defect, verified:** the claude-code ledger **excludes subagent spend**. Native
spawns subagents in 8 of 17 cells (121 requests, $0.0319 off-ledger); sweet in 2 (35 requests,
$0.0098). Sweet's subagents correctly used `ss-*` only; native's used `Read`. Folding it in moves
claude-code +2.2% → −3.0%. **This is a scoreboard fix, not a product win. Do not count it as a lever.**

---

## 4. THE DEAD LIST — proposing any of these is an automatic failure

### 4a. Killed in the 2026-08-12 hunt (30 levers, three families, all dead)

**Opus 5 / Fable 5 proposals:**

| lever | why it died |
|---|---|
| Stale-Oracle Override | *Strongest lever found.* Its +2-task ceiling rested on two sweet cells that "would be gold minus one hunk". **They would not** — gold inserts `:integer` after `:atom`; codex/sweet inserts after `:boolean`, and the test asserts the rendered list as an exact ordered string. Also: if classified as completion discipline it goes in the FRAME for BOTH arms and the differential collapses to zero. |
| Sibling-Site Echo | The sibling was **already in context** — `ss-read underscore.js 400 470` returned both lines 445 and 458; the cell edited 445 only. Native, reading the whole file, produced a byte-identical patch. |
| Look-Before-API | Its own pre-registered falsifier fired: pre-edit test consultation has **p = 1.000**, and inverts once the supporting task is removed (0/12 with consultation solved vs 6/24 without). It is tests-first prompting renamed. |
| Stale-Assertion Arbitration | Trigger fires **0 of 11 times** — the losing agents keep the visible suite GREEN, so there is no failing assertion to arbitrate. |
| Diff-vs-Evidence Review | Unsupported-file trigger fires in **1 of 102** sweet rollouts. Completeness-card relabel. |
| Atomic same-file edits | Premise reversed in traces: native has 85 same-file edits to sweet's 81; MultiEdit used **0 times**. |
| Stale-Test Annotation in run_tests | exposure 211 but no differential |
| Caller Set Inline | exposure 0 |
| Dep-Source Reach · Zero-Edit Floor Guard · Delegation retrieval brief · Scope and flag honesty · Scope-Honest Retrieval | all below the 3% / 1-task bar |
| Coalesced independent lookups (multi-target ss calls + batching) | **Genuinely dead-listed.** Both vehicles individually closed in `TURN_PACKING_FINAL.md`: free-argument `ss-batch` batching and prose packing prompts. Exposure was the largest in the hunt (583 adjacent ss-call pairs) and it still dies on mechanism. |
| Duplicate-span elision (rt-dedup for ss-read) | Content-hash trigger fires **0 times** on the 117 verifiable claude-code results; the 126 "re-reads" request *different spans* of the same file. 0.43%. |
| Symbol-complete first read | Required forward widening is 153-273 lines median — 3-6 whole symbols. Ceiling collapses. |
| Per-turn output ceiling | **Zero differential** — FRAME-level, both arms. |
| run_tests result compaction | **Zero differential** — FRAME-level, both arms. Worth 6-8% absolute and 0% head-to-head. |
| Redundant-tool retirement | A refuter **captured the exact API request** claude-code 2.1.218 sends: **Grep and Glob schemas do not exist in it** (24-tool roster). Removable set is 758 tokens. Applied fairly to both arms it moves claude-code the **wrong way** (+2.38% → +2.92%), because native runs more turns. |
| Envelope density pass | *Closest to surviving.* Replayed over all 1,204,262 recorded ss-* output chars: 5.7% raw → **1.9%** once doc comments are preserved (61.3% of collapsible comment mass carries `///`, `/**`, `@param`). Below the bar, and 38.8% of the saving sits on never-solved tasks. |

**GPT-5.6 proposals:**

| lever | why it died |
|---|---|
| Claude static edit-scope guard | Exposure **3 cells, all one task**. Native adds *more* wrong files overall (31 vs 27). |
| Public-facade closure (Dart) | claude-code native reached **both** source files and still failed. |
| Agent-format semantic sibling closure · structural sibling closure | **The bingo files do not exist at base.** Nothing can retrieve them. |
| Static-prefix cache-key alignment | Max recoverable $0.00243 = 1.19%; and turn-1 cannot read a cache it is creating. |
| Test-to-source primary-locus reranker · Reverse-import package-contract pack | The one correctly-localized codeception cell **still failed**. |
| Source-anchored test-witness (pytask) | Both native successes are **one rep of two** — coin flips. |
| Schema-to-consumer closure (teleport) | Proposer conceded: sweet already solves it; ceiling under one task. |
| Post-edit type-contract verifier | **Zero exposure** — the three target tasks produce no compiler diagnostics at all. |

### 4b. Killed earlier (do not re-propose)

Turn/context **PACKING** (closed 2026-08-06) · context **EVICTION** incl. 32K-cap replay (measured
+7.7% saved on idealCost while actually **LOSING 12.3%** break-priced) · tool-result **FUSION** ·
**PREAMBLE trimming** (netted 23 tokens — the ss-* doc block is dense, ~40 tokens/rule) · **THRASH
reduction in all three forms** (novelty-stall, no-progress abort, failed-edit retry limiting — there
is no doomed tail) · **COMPLETENESS CARD** · **CHECKPOINT-ON-GREEN** · **TESTS-FIRST prompting**
(rejected twice) · **MATCH-JUDGE trust gating** · five further GPT-sourced cost levers.

**Already SHIPPED — not new ideas:** memory-file delivery of the M-rules + verdict-gated trust,
`SS_RT_LONGYIELD`, P2 fix-surface, ss-grep round-robin diversity + `--in`, span map + unread trailer
+ result diet, trace trust gates, L1 condenser / L2 run-tests authority, rt-dedup.

**Infrastructure dead ends:** bareapi 60-call-cap harness, Muse Spark (403, US-only), mimo backbone,
INT4 quantization, float HNSW.

### 4c. Two screening lessons — do not repeat them

1. **A blunt regex dead-list screen killed 9 of 30 proposals, and 8 were FALSE POSITIVES** — the
   regex matched text where the proposer was *disclaiming* the dead idea ("this is NOT the dead
   preamble-trim lever" matched `/preamble/`). **The screen punished the most careful proposals.**
   If you screen at all, strip negated clauses first, or screen semantically.
2. **Judging every lever alone against "3% of total cost" was miscalibrated.** Levers can stack. But
   note the counter-lesson: when the stacked portfolio was finally checked, the target itself
   (claude-code's gap) turned out to be statistically insignificant. **Check that your target is real
   before optimising against it.**

---

## 5. FORCING FUNCTIONS — these are requirements, not encouragement

The previous session was *asked* to be creative and produced 30 variations on the same seven ideas.
Asking does not work. These are hard constraints on your output.

### 5a. Do the inversion FIRST, before you generate anything

Write this down before you propose a single candidate:

> **"I am a smart engineer hired to make NATIVE crush SWEET. I have the same 204 traces. What do I
> exploit?"**

Native currently ties sweet on solve on two harnesses and beats it on one task. It is cheaper on
claude-code as measured. Find native's real structural advantages — there are some, and the traces
show them. **Then invert each one into a candidate.** Attacking your own side first is the single
most reliable way to escape the incremental trap, because it forces you to see the system as an
opponent would rather than as a pipeline to tune.

### 5b. Class quotas — a slate that violates these is a failed deliverable

- **At most 2 candidates from any one class in the §0.5 table.** If you have three "make retrieval
  find more related things" ideas, you have one idea and two duplicates.
- **At least 4 candidates that fit NO row in the §0.5 table.** If everything you have fits an
  existing row, you have not left the swept surface. Go back to the traces.
- **At least 2 candidates in a MOONSHOT tier** (see 5c).
- **At least 3 candidates that no aggregate could have produced** — things learnable only by watching
  a rollout happen, with quoted turns.

### 5c. The moonshot tier is mandatory and exempt from the feasibility bar

Label at least 2 candidates `MOONSHOT`. For these, and only these, **suspend** the "is it
implementable this quarter", "does it fit the current architecture", and "would it survive a $0 gate"
filters. Requirements: it must be **mechanically coherent**, it must plausibly deliver a **solve flip
or a 15%+ cost move**, and you must state honestly what it would cost to build and what would have to
be true for it to work.

The reason this tier exists: every feasibility filter applied at generation time is a creativity
filter. The previous session applied them at generation time and generated nothing new. **Generate
first, filter later, and put the filtering in a clearly-marked box.**

### 5d. Two banned moves

1. **No candidate whose mechanism is "present the same information more compactly."** Six of the 30
   dead levers were exactly that, including the closest survivor. That surface is swept.
2. **No candidate that only works because of how this benchmark grades.** If it depends on hidden
   test patches, stale-assertion stripping, or the any-rep rule, it is a scoring artifact, not a
   product improvement. The operator wants sweet to be genuinely better, not to score better.

### 5e. Say what you looked at and what you rejected

Report how many full rollouts you read end to end, which ones, and **at least three promising-looking
ideas you generated and then discarded, with the trace fact that discarded them.** A slate with no
discards means you were not generating enough to have any to discard.

---

## 6. METHODOLOGY — binding

1. **$0 first.** Every claim must be checkable against existing artifacts. **You may not launch a
   rollout or spend money.** If a candidate needs a paid run, that is a recommendation for a later
   session.
2. **Solve is the veto dimension.** Report cost only with solve beside it. A cost win that costs a
   solve is a loss.
3. **Aim big.** At n=17, anything under ~15% cost or under a full task of solve is unmeasurable.
   Do not bring 1-2% levers.
4. **Check per-REP before believing any flip.** Three of four apparent differences in this dataset
   are single-rep coin flips.
5. **Never infer "was not in context" from `trajectories/`** — results truncate at 600 chars, inputs
   at 200. Use the raw traces in §1.
6. **M± is delivered via the memory file** (CLAUDE.md / AGENTS.md), never in-prompt, and stays
   **general**. Bench-specific content (run_tests usage, completion discipline) goes in the FRAME —
   **and the FRAME goes to BOTH arms, so anything you put there yields ZERO differential.** State
   which vehicle your lever uses and therefore whether it can move the head-to-head at all.
7. **Ranking-signal trap:** any new ranking signal detecting structured-query patterns MUST be gated
   on `opts._isAgentFormat`. Ungated it has regressed the GCSN retrieval benchmark twice: −0.07pp,
   then **−27.57pp**.
8. **HO2 is frozen.** DEV-RET rotated tasks only.

---

## 7. DELIVERABLE

Write to `eval/task-completion-bench/handoffs/improve/SLATE-<your-session-letter>.md`, in this order:

**1. The inversion (§5a)** — how a smart engineer would make native crush sweet, from the traces.

**2. Trace log (§5e)** — how many full rollouts you read end to end, which ones, and 3+ ideas you
generated and discarded with the trace fact that killed each.

**3. The slate**, ranked, each candidate with:
- **Class** — which §0.5 row it occupies, or `NEW CLASS` with a name. Enforce the quotas in §5b.
- **Tier** — `GATED` (must survive a $0 gate) or `MOONSHOT` (exempt, per §5c).
- **Trace evidence** — task, harness, arm, rep, specific turns. **Quote what the model actually did.**
  An unquoted claim is worth nothing here.
- **Mechanism** — what changes and where, specific enough to implement.
- **Vehicle and differential** — sweet-only, or both arms? FRAME-level means the differential is
  **zero**; say so.
- **Quantified ceiling** with arithmetic, in dollars and/or solved tasks out of 17.
- **Cheapest $0 falsifier.**
- **Effect on BOTH solve and cost**, honestly.

**4. Self-audit** — state your class distribution and confirm the §5b quotas are met. If you could
not meet them, say which one you missed and why; do not quietly pad the slate to fit.

### The bar

A slate of seven small, safe, plausible tweaks is a **failed deliverable** — that is precisely what
the previous session produced, thirty times over, and every one died. A slate with three genuinely
strange ideas, two of which are probably wrong, is a **success**. The operator does not want another
sweep of the incremental surface; that surface is swept.

**Do not build anything. Do not screen yourself to death. Generate.**

---

## APPENDIX A — threads already noticed (read LAST, or not at all)

**These are LOW-VALUE and are listed so you do not waste time rediscovering them. A slate consisting
mainly of these is a failed slate — you are expected to beat them.** They are unexplained
observations, not candidate ideas, and none of them has been turned into a mechanism.

1. **Sweet reaches its first edit 44% sooner on claude-code and wins nothing with it.** What does it
   do with the head start? Read those traces side by side against native. This is the single most
   suggestive unexplained fact in the dataset.
2. **Why does sweet make MORE tool calls than native on codex** (9.3 vs 7.5) while making far fewer
   on opencode (17.0 vs 22.8) and claude-code (19.7 vs 29.5)? The harness inverts sweet's behaviour
   and nobody knows why.
3. **Sweet displaces read/grep entirely but not bash/test.** What are those 219 opencode bash calls
   doing? Is there a whole class of work `ss-*` could absorb that nobody has looked at?
4. **Why did opencode sweet REFUSE `mransan`** (0 tool calls, 1 turn) where native tried 14-22 calls?
   A retrieval tool should not make a model give up. If sweet's tooling or prompt causes surrender on
   a vague issue, that is a real defect worth finding — and it is currently *flattering* our cost
   number.
5. **7 tasks are never solved on any harness, and 6 never by anyone.** Read every failing trace for
   the three at PERFECT localization. The information was all there; the model still got it wrong.
   **What would have had to be in front of it?** This is the resolution frontier and it is not
   retrieval.
6. **The wrong-fix is arm-universal.** Both arms write the same wrong patches. If sweet can make the
   model *verify* rather than *guess*, that is worth more than any retrieval improvement. What
   evidence does a model need to stop guessing? Look at the `dashbitco` cells where agents wrote the
   complete correct fix and then **added a destructive hunk** to keep a stale assertion green.
7. **Nobody has compared a sweet trace and a native trace of the SAME task side by side, turn by
   turn, end to end.** Do that for at least 5 tasks — including one both solve, one neither solves,
   and the one sweet wins. Watch where they diverge.

---
