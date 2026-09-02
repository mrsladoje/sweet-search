# Structured tools versus one shell call: what the vendors, the harnesses and our own traces say about parallel emission

Author: research agent `structured-vs-shell-parallelism`. Date 2026-09-02. Cost: $0 (trace
reading, binary string reading, arithmetic, web).

---

## 0. Verdict

**Parallel tool emission is set by the harness's request construction first, by the shape of the
task second, and by the tool's structured-versus-shell identity third. The same model, on the same
day, emitted 1.549 calls per request on opencode, 1.303 on claude-code and exactly 1.000 on codex.
That ordering is a harness fact, not a model fact, and no vendor document or study in the
literature measures it.** [M]

Five results follow, and they change what a structured `ss-*` surface is worth per harness.

1. **Codex has zero headroom and zero risk.** Across 132 codex sessions and 2,406 tool calls in
   `fp-codex-tab-20260826`, **every single request carried exactly one tool call, in both arms**
   [M]. Codex 0.146.1 is capable of parallel calls — it ships `core/src/tools/parallel.rs` and a
   bundled model catalogue in which every model carries `"supports_parallel_tool_calls": true` [C]
   — but the run's model string was `openai/gpt-5.6-luna`, which does not match the catalogue slug
   `gpt-5.6-luna`, and the recorded `turn_context` shows `multi_agent_version: "v1"` where the
   catalogue entry says `"v2"` [M]. The catalogue was not applied. Codex therefore built its
   requests without the parallel affordance for both arms. **The opencode +3.4-request driver does
   not exist on codex, and a structured surface cannot collect anything there today.**
2. **The mechanism is not "one bash call per request".** That claim, on our own register, is
   false. Opencode's sweet arm emitted **two or more bash calls in one request 119 times**, and
   claude-code did it 67 times [M]. Bash is batchable. It is simply batched less often.
3. **The confound-free measurement is a per-tool companion rate inside one arm.** In the opencode
   **native** arm alone — same model, same prompt, same tasks — `read` sat in a multi-call request
   84.5% of the time, `glob` 90.1%, `grep` 75.2%, and `bash` **37.3%**. In the **sweet** arm,
   `bash` sat in a multi-call request **36.1%** [M]. **Bash's batching propensity is a constant of
   the tool, identical across arms to within 1.2 points. The whole arm-level gap is the tool mix.**
   This is a stronger form of the grok-era within-native regression (`calls/turn ≈ 0.48 + 2.32 ×
   structured-share`, R² = 0.42) because it needs no regression and no cross-rollout pooling.
4. **Instruction is not the missing ingredient, and this is now measured on the vendor's own
   text.** Claude Code 2.1.218's deployed `Bash` tool description says, verbatim: *"When issuing
   multiple commands: If the commands are independent and can run in parallel, make multiple Bash
   tool calls in a single message."* Its `Read` description says nothing about parallelism at all
   [C]. Measured companion rates in the claude-code native main thread run the other way: `Read`
   35.1%, `Bash` 13.5% [M]. **The tool that is told to batch batches least.** This is the cleanest
   $0 refutation of "prompt it to pack" the programme has, and it costs nothing to re-check.
5. **The literature's remedies do not fit our shape, and the vendors say so themselves.**
   Anthropic's Tool Search Tool is documented as *"Less beneficial when: Small tool library (<10
   tools) … Tool definitions are compact"*; Programmatic Tool Calling is *"Less beneficial when:
   Making simple single-tool invocations, Working on tasks where Claude should see and reason about
   all intermediate results"* [W]. We have six `ss-*` tools with compact definitions, and every
   result changes the next decision. Both named features are explicitly out of scope for us.

**What the literature predicts for a structured `ss-*` surface, in one sentence:** it would raise
emission rate on opencode (ceiling **−3.43 requests per rollout**, 18.1% of the sweet arm's
requests, worth **−10% to −18%** of the sweet cell) and on the claude-code main thread (ceiling
**−2.82 requests per rollout**, 11.0% of requests, worth **−6% to −9%**), it would collect nothing
on codex, and every published mechanism for actually realising it is either owner-excluded (MCP,
register A4), dead on our record (prompting, A1/A6), or explicitly disclaimed by its own vendor for
tool sets of our size.

**What would have to be true for it to work** is stated in section 7. The short version: the
emission rate has to be a property of the *tool*, not of the *task shape*. Anthropic's own
Fable 5.1 guidance says it is the task shape — batching degrades *"in coding and computer-use loops
where the next independent calls are implied by the task rather than explicitly requested"* — and
our claude-code numbers agree: the same `Bash` tool goes from 3.5% companion rate in a sweet main
thread to 41.3% inside a sweet subagent, a 12× swing with the tool held constant [M].

---

## 1. What is already on the record, and what this document adds

Read first, do not re-derive:

- `DEAD-LEVER-REGISTER-DRAFT.md` A1 (prompt-steered packing, DEAD ×4), A2 (`ss-batch`, DEAD),
  A4 (MCP surface, OWNER-EXCLUDED and UNBENCHMARKED), A6 (mid-task advisories, REFUTED).
- `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §5.1 C4 (call packing on opencode, dead) and
  row 1 of the driver table (native 1.546 vs sweet 1.106 calls per request, +3.38 requests,
  +$0.000914, +10.2%).
- `FORENSICS-heldout200-grok-opencode-2026-07-28-OPUS-5.md` §C5 and `PLAN.md` §4.3 — the grok-era
  within-native regression and the −14.2% counterfactual.
- The three 08-28 research documents. `05` covers gutters, edit contracts and the tokeniser; `06`
  covers caching, preambles, harness internals and cost levers; `07` covers resolution levers
  L1–L11. **None of the three contains a single measurement of tool calls per request.** The word
  "parallel" appears in `05` only inside a field list, and in `06` only in the title of a
  compaction paper [M `grep -n -i parallel 0{5,6,7}-*.md`].

New here: per-harness and per-tool emission-rate measurements on the fresh pool; the codex
1.000 result and its mechanism; the deployed harness tool-description evidence; the vendor
statements about coding loops and about when the MCP-side features do not help; and the
per-harness ceiling arithmetic with a $0 falsifier.

---

## 2. Measurement 1 — calls per request, all three harnesses, fresh pool

Run: `fp-{codex,opencode,claudecode}-tab-20260826` on `root@167.233.69.121`, read-only. Scripts I
wrote live in `/tmp/wf-slatec/structparallel/` on the box: `codex-parallel.py`, `oc-parallel.py`,
`cc-parallel.py`, `cc-parallel2.py`, `pertool.py`, `cf.py`, `cf2.py`, `cfcc.py`, `runs.py`,
`ops.py`, `ops2.py`, `rows.py`. Local copies of each were staged from `/tmp/*.py`.

Request definition per harness:
- **codex**: a run of consecutive `response_item.function_call` records not interrupted by a
  `function_call_output`, in `codex-home/sessions/**/rollout-*.jsonl`.
- **opencode**: the `tool_use` events between two `step_finish` events in
  `opencode-retained/*/attempt-1.stdout.ndjson`.
- **claude-code**: `tool_use` blocks grouped by `message.id` in
  `claude-home/projects/*/*.jsonl` (and `.../subagents/agent-*.jsonl`), deduplicated by
  `tool_use.id`, which handles the ~2.46-records-per-request split.

| harness | arm | sessions | requests | tool calls | **calls / request** | requests with ≥2 calls |
|---|---|---:|---:|---:|---:|---:|
| codex | native | 66 | 1,178 | 1,178 | **1.000** | **0** |
| codex | sweet | 66 | 1,228 | 1,228 | **1.000** | **0** |
| opencode | native | 67 | 1,093 | 1,693 | **1.549** | 276 (25.3%) |
| opencode | sweet | 63 | 1,196 | 1,373 | **1.148** | 120 (10.0%) |
| claude-code | native (main) | 67 | 1,632 | 1,784 | **1.093** | 108 (6.6%) |
| claude-code | native (subagents) | — | 519 | 1,019 | **1.963** | 203 (39.1%) |
| claude-code | sweet (main) | 71 | 1,688 | 1,637 | **0.970** | 18 (1.1%) |
| claude-code | sweet (subagents) | — | 364 | 490 | **1.346** | 60 (16.5%) |

All [M]. Session-file counts exceed row counts on claude-code (71 sweet files against 66 rows), so
per-rollout figures below divide by rows, not by session files.

Three things to notice.

- **Codex's zero is exact, not approximate.** 2,406 calls, 2,406 tool-bearing requests, histogram
  `{1: N}` with no other bucket, both arms [M `codex-parallel.py`]. The register's statement that
  sweet and native use "the same number of requests" on codex now has a mechanism.
- **Claude-code's parallel emission lives almost entirely in subagents.** The main thread of the
  *native* arm is at 1.093 — barely above serial. The gap the fresh pool sees on claude-code is a
  delegation gap wearing a parallelism costume, and delegation for sweet is already REJECTED
  (register F15).
- **Opencode is the only harness where the main thread genuinely batches** (25.3% of native
  requests carry 2–6 calls).

---

## 3. Measurement 2 — the confound-free per-tool companion rate

For every tool, the share of its calls that sat in a request carrying two or more calls. This is
computed **inside one arm**, so model, prompt, tasks, harness and pricing are all held constant
[M `pertool.py`].

**opencode `fp-opencode-tab-20260826`**

| arm | tool | calls | share in multi-call requests |
|---|---|---:|---:|
| native | `read` | 606 | **84.5%** |
| native | `glob` | 141 | **90.1%** |
| native | `grep` | 246 | **75.2%** |
| native | `bash` | 319 | **37.3%** |
| native | `todowrite` | 263 | 0.0% |
| native | `apply_patch` | 118 | 0.0% |
| sweet | `bash` | 975 | **36.1%** |
| sweet | `todowrite` | 237 | 0.0% |
| sweet | `apply_patch` | 122 | 0.0% |

**claude-code `fp-claudecode-tab-20260826`**

| arm / thread | tool | calls | share in multi-call requests |
|---|---|---:|---:|
| native main | `Read` | 709 | **35.1%** |
| native main | `Bash` | 584 | **13.5%** |
| native main | `Edit` | 308 | 0.0% |
| native subagents | `Read` | 590 | **80.0%** |
| native subagents | `Bash` | 347 | **76.1%** |
| sweet main | `Bash` | 1,139 | **3.5%** |
| sweet main | `Edit` | 284 | 0.0% |
| sweet subagents | `Bash` | 385 | **41.3%** |
| sweet subagents | `Read` | 87 | 43.7% |

What this settles.

1. **The tool-mix explanation is right for opencode.** Bash batches at 37.3% in native and 36.1%
   in sweet. The arm difference in calls per request is produced entirely by native's mix being
   84.5%/90.1%/75.2% tools and sweet's being 71% bash.
2. **The tool-mix explanation is wrong for claude-code.** Sweet main-thread `Bash` batches at
   **3.5%** while native main-thread `Bash` batches at **13.5%** — the *same tool*, a 3.9× gap.
   And sweet subagent `Bash` batches at 41.3%, 12× the sweet main thread. **On claude-code the
   emission rate tracks the context and the task shape, not the tool.** Any claim that a structured
   `ss-*` surface would fix claude-code has to explain that 3.5%-versus-41.3% swing first.
3. **Editing never batches anywhere** (`apply_patch` 0.0%, `Edit` 0.0%). Edit-side levers cannot be
   sold as request savers.

---

## 4. Measurement 3 — the ceiling, with the arithmetic

### 4.1 opencode

Define the retrieval surface as `read`+`grep`+`glob` for native, and bash envelopes containing an
`ss-*` verb for sweet [M `cf2.py`].

| arm | retrieval calls | requests carrying them | density (calls per request) |
|---|---:|---:|---:|
| native | 993 | 419 | **2.370** |
| sweet | 673 | 500 | **1.346** |

Counterfactual: sweet's 673 `ss-*` calls at native's 2.370 density need **284 requests instead of
500**. Saving: **216 requests over 63 rows = 3.43 requests per rollout = 18.1% of the sweet arm's
requests** [M]. This independently reproduces the register's `+3.38 requests` figure from a
different definition, which is a useful cross-check on both.

A structural upper bound, computed without assuming anything about packing quality: count maximal
runs of consecutive requests that contain only retrieval calls, and ask how many could merge
[M `runs.py`]. Sweet leaves **4.05 requests per rollout** on the table by that ideal; native leaves
**3.34**. So "pack as well as native does" (3.43) is close to "pack perfectly" (4.05) for sweet,
and native is itself far from perfect. The ceiling is bounded above by 4.05.

Price. One marginal opencode request is $0.000341 in re-sent context plus output
[M `10-panel-cost.md` claim 7]; the Shapley turn term implies a more conservative
$0.000914 / 3.38 = $0.00027 [M register row 1]. Sweet's opencode cell in this run is $0.009201 per
rollout and native's is $0.008968 [M `rows.json`, my `rows.py`; the BRIEF's pooled figures are
$0.009265 / $0.008968].

- 3.43 × $0.00027 = **$0.00093 per rollout = −10.1%** of the sweet cell [I].
- 3.43 × $0.000341 = **$0.00117 per rollout = −12.7%** [I].
- At the arm's average $/request ($0.000485) it would be −18.1%, which is an over-estimate because
  a marginal request does not re-pay the preamble.

Sweet is currently +2.6% dearer than native on this run's rows (+3.3% in the BRIEF's pooled
figures). **Collecting even the conservative end of this ceiling flips opencode from +3.3% to about
−7%.** That is the single largest identified opencode lever in the programme.

### 4.2 claude-code, main thread only

Delegation is excluded because sweet delegating is rejected (F15) and native's subagent spend is a
lower bound (G6).

| arm (main thread) | retrieval calls | requests carrying them | density |
|---|---:|---:|---:|
| native `Read`/`Grep`/`Glob` | 709 | 541 | **1.311** |
| sweet `ss-*` | 848 | 833 | **1.018** |

Counterfactual: 848 calls at 1.311 need **647 requests instead of 833**, saving **186 requests over
66 rows = 2.82 per rollout = 11.0% of the sweet arm's requests** [M `cfcc.py`].

Price. Using the BRIEF's sweet cell of $0.020727 per rollout and 31.1 requests per rollout
(25.6 main + 5.5 subagent), the average is $0.000667 per request; applying opencode's
marginal-to-average ratio (0.70) gives about $0.00047 marginal.

- 2.82 × $0.00047 = **$0.00133 = −6.4%** of the sweet cell [I].
- 2.82 × $0.000667 = **$0.00188 = −9.1%** [I].

Caveat: `rows.json` for `fp-claudecode-tab-20260826` reports `costRealizedUsd` of $0.005853 native
and $0.013065 sweet with `costSidechainUsd` zero, which is not the ledger the BRIEF publishes
($0.021558 / $0.020727). I used the BRIEF's numbers and did **not** reconcile the difference. Flag
this before any claude-code dollar claim is repeated.

### 4.3 codex

Zero. Native and sweet are both at exactly 1.000 calls per request. There is no packing differential
to collect, in either direction [M].

---

## 5. Measurement 4 — three claims in our own record that need correcting

1. **"A Bash `ss-*` call is one per request."** False. Opencode sweet emitted ≥2 bash calls in
   **119** requests; 114 of its 120 multi-call requests were pure bash. Claude-code sweet did it 17
   times in the main thread and 50 times in subagents [M].
2. **"20.8% of sweet's bash envelopes chain two or more `ss-*` calls with `&&`."** Measured on this
   run with the regex `(?<![\w./-])ss-(search|read|grep|find|semantic|trace|batch)\b`: of 673
   `ss-*`-bearing envelopes, **43 (6.4%)** contain two or more `ss-*` operations, and 44 (6.5%)
   contain `&&` at all. **166 (24.7%)** contain any shell operator (`&&`, `;` or `|`) — which is
   close to 20.8% and is probably what that figure counted [M `ops2.py`]. Total `ss-*` operations
   are 739 in 673 envelopes: **1.098 operations per envelope**. The "we already batch inside the
   shell" defence is therefore much weaker than recorded, which *raises* the packing ceiling rather
   than lowering it.
3. **"Codex fell back to a per-model policy that truncated at about 2,500 tokens"** (`05` §1.3).
   The deployed catalogue in codex 0.146.1 gives every listed model
   `"truncation_policy": {"mode": "tokens", "limit": 10000}`, including `gpt-5.6-luna` [C]. The
   ~2,500-token cap the programme measured therefore comes from the *unmatched-slug default*, not
   from a per-model policy. Same root cause as the parallel finding: the catalogue was never
   applied, because the run's model string carries the `openai/` provider prefix.

Reliability side note, because someone will ask whether parallel bash is riskier: in opencode
sweet, `ss-*` envelopes that sat in a multi-call request had a **0.4%** flagged-error rate against
**0.7%** for envelopes in single-call requests [M `ops.py`]. Parallel bash is not less reliable here.

---

## 6. What the primary sources actually say

### 6.1 Anthropic — the API contract, and a named regression in exactly our setting

- *Parallel tool use* (platform.claude.com, fetched 2026-09-02): *"By default, Claude may call
  multiple tools in a single response … Claude 4 and later models make parallel tool calls by
  default when a request benefits from multiple tools."* Turning it off is
  `tool_choice: {type: "auto", disable_parallel_tool_use: true}` — a `tool_choice` field, not a
  top-level parameter [W].
- The same page carries a model-specific note: *"Claude Fable 5.1 may issue fewer parallel tool
  calls than earlier models, most noticeably in long agent loops where the next reads are only
  implied (custom coding agents, bash and text editor harnesses, computer use)."* [W]
- *Prompting Claude Fable 5.1 → Batch independent tool calls in agent loops* states the mechanism
  precisely: *"The exception is coding and computer-use loops where the next independent calls are
  implied by the task rather than explicitly requested (custom coding agents, bash-and-editor
  harnesses, computer use): there it may issue them one per turn instead."* The remedy is a
  **per-turn** nudge, not a system-prompt clause: *"First privately list what you need next; then
  request every item that doesn't depend on another's result in this one response."* It must be
  appended after each tool-result message as a turn-scoped system message
  (`clear_at: "next_user_message"`, beta header `mid-conversation-system-clear-at-2026-08-21`), and
  the page warns that rewriting earlier copies restarts the prompt cache [W].
- The static system-prompt form Anthropic recommends for older models is the
  `<use_parallel_tool_calls>` block: *"Err on the side of maximizing parallel tool calls rather than
  running too many tools sequentially."* [W]

**Why this matters to us.** The vendor's own diagnosis is *implied versus explicitly requested*,
not *structured versus shell*. Our claude-code numbers are the same diagnosis: 3.5% in a main
thread whose next reads are implied, 41.3% in a subagent whose brief names what to fetch.

### 6.2 OpenAI — the parameter exists; codex is where it is decided

- Function calling guide (developers.openai.com, fetched 2026-09-02): *"The model may choose to
  call multiple functions in a single turn. You can prevent this by setting `parallel_tool_calls`
  to `false`, which ensures exactly zero or one tool is called."* and *"On supported models
  beginning with GPT-5, functions can be called in parallel when built-in tools are also
  available."* [W]
- OpenRouter documents `parallel_tool_calls` as an optional boolean defaulting to **true**, passed
  through to providers [W]. So the wire default was not the blocker; codex's request construction
  was.
- **openai/codex issue #32503**, opened 2026-07-12, titled *"GPT-5.6 Sol rarely parallelizes
  programmatic tool calls, multiplying model turns and quota usage"*: the reporter measured
  `Promise.all` in **5 of 739** `exec` cells (0.7%), **~5.3× more model round trips per tool-bearing
  turn** (87.0 against 16.5 requests) and ~7.9× the tokens. The issue's own diagnosis: GPT-5.5 gets
  explicit parallelisation instructions and native top-level batching, while GPT-5.6 Sol runs
  *"code-only mode with Responses Lite (which disables top-level parallel calls)"* [W]. This is an
  independent, upstream, third-party reproduction of our exact codex result, on a sibling model.
- **openai/codex PR #38499**, merged **2026-08-14**: *"Set `parallel_tool_calls` for regular and
  remote compaction prompts without consulting model metadata"*, and it **removed
  `supports_parallel_tool_calls` from `ModelInfo` and the bundled model catalogue**, while
  *"preserv[ing] the existing Responses Lite behavior that disables parallel tool calls at request
  construction"* [W]. Our binary is dated 2026-08-06 and is 0.146.1, so it predates that change and
  still consulted the catalogue. **A codex upgrade past 0.146.1 would enable parallel tool calls for
  our provider path — and would do so for both arms.**
- **openai/codex PR #17667**, merged **2026-04-13**: adds `supports_parallel_tool_calls` to MCP
  server config. *"MCP calls remain serial by default. Only tools from opted-in servers are eligible
  to run in parallel."* Config: `[mcp_servers.docs] supports_parallel_tool_calls = true` [W]. **An
  MCP `ss-*` surface on codex is serial unless we set that flag.**
- Codex 0.146.1's own bundled prompting guide, on OpenAI's code-mode equivalent: *"Multiple,
  parallel, or dependent calls alone do not justify Programmatic Tool Calling … Prefer direct tool
  calls when: one call is sufficient; intermediate outputs are already small; **each result may
  change the next decision**; … the workflow requires semantic judgment between calls."* [C, string
  in the deployed binary]. Our search → read → edit loop is that workflow.

### 6.3 The harnesses' own tool text — the headwind nobody has recorded

Read out of the deployed binaries on the box [C]:

| harness | text | measured effect |
|---|---|---|
| opencode 1.18.4, `read` description | *"Call this tool in parallel when you know there are multiple files you want to read."* | `read` companion rate **84.5%** |
| opencode 1.18.4, `bash` description | lists *"File search: Use Glob (NOT find or ls) · Content search: Use Grep (NOT grep or rg) · Read files: Use Read (NOT cat/head/tail) · Edit files: Use Edit (NOT sed/awk)"* | — |
| claude-code 2.1.218, `Bash` description | *"When issuing multiple commands: If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. If the commands depend on each other … chain them in a single Bash call."* plus the same "use the dedicated tool, not the shell" list | `Bash` companion rate **13.5%** native main, **3.5%** sweet main |
| claude-code 2.1.218, `Read` description | no parallelism sentence at all | `Read` companion rate **35.1%** native main |
| claude-code 2.1.218, system prompt, Harness section | *"Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response."* | — |
| sweet tool guide (M±), `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` | **no mention of parallelism, batching, `&&` chaining, or emitting several calls at once** in 64 lines | — |

Two consequences.

- **Both harnesses ship a standing instruction to prefer their own structured file and search tools
  over the shell.** The `ss-*` surface is delivered on the shell, so on every rollout the sweet
  guide argues against the harness's own system prompt and bash tool description. This is a
  sweet-only headwind that is not in any prior document and is not priced anywhere.
- **The instruction-to-behaviour mapping is inverted on claude-code**: the tool that is told to
  batch batches least. Whatever raises emission rate, it is not the presence of a sentence.

### 6.4 The MCP-versus-CLI literature measures the wrong quantity

- Anthropic, *Code execution with MCP*, published **2025-11-04**: the headline is 150,000 → 2,000
  tokens (98.7%) on a Google-Drive-to-Salesforce transcript task, achieved by **not loading all
  tool definitions up front** and by filtering results before they enter context. The post
  concedes the cost: *"code execution introduces its own complexity"* and needs *"a secure execution
  environment with appropriate sandboxing"* [W].
- Anthropic, *Advanced tool use*, published **2025-11-24**: Tool Search Tool cuts context on a
  **50+ MCP tool** set by ~85% and lifts accuracy 79.5% → 88.1% on Opus 4.5; Programmatic Tool
  Calling cuts average usage 43,588 → 27,297 tokens (37%) on complex research tasks and *"eliminates
  19+ inference passes"* when 20+ tool calls fit in one code block [W].
- The *Programmatic tool calling* doc names the weak fit explicitly: *"Strictly sequential workflows
  where each call depends on Claude reasoning over the previous result, because the script cannot
  skip the model round-trip in that case."* And: *"Requests whose tools array contains 10 to 49 tool
  definitions see typical token savings of 20% to 40%."* [W]
- The 2026 CLI-versus-MCP blog corpus (Scalekit's "4–32×", Jannik Reinhard's "35×", the "TES 202 vs
  152" figure) all measure **tool-definition context**, on single hand-built tasks, with no model
  named, no date, and **no turn or call count**. I fetched the Reinhard piece directly: 145,000 vs
  4,150 tokens on one Intune task, different tool chains on each side [W]. **Do not cite any of
  these as evidence about emission rate. None of them measure it.**

**The gap in the literature is exactly our question.** I found no study — vendor, academic or
industry — that measures tool calls per assistant message for the same capability delivered as a
shell command versus as a structured tool. Our fresh-pool numbers appear to be the only such
measurement in existence.

### 6.5 The one academic result that is on-topic

*W&D: Scaling Parallel Tool Calling for Efficient Deep Research Agents*, Lin, Liew, Savarese, Li
(Salesforce AI Research), arXiv:2602.07359v1, **2026-02-07** [W]. Tested on GPT-5, Gemini 3.0 Pro,
Claude 4.5 Sonnet, DeepSeek-V3.2, Qwen-3-235B. Parallel tool calling at 3 calls per turn gave 68%
accuracy at $65.7 per 100 tasks and 904.2 s wall clock, a **40.6% latency reduction** and a
**35.9% cost reduction** against single tool calling. Two findings matter more than the headline:

1. **Models do not do it spontaneously.** The authors had to insert *"a user message before each
   LLM call that specif[ies] the required number of function calls"*, and found this **more
   effective than system-level instructions**.
2. **Width saturates.** With a 100-turn budget, the best result came from a *moderate* number of
   parallel calls, not the maximum.

Both agree with Anthropic's Fable 5.1 guidance: the effective vehicle is a **per-request** nudge,
not a standing rule. Our register kills the standing-rule form (A1, F8) and the mid-task-advisory
form on Grok (A6). **The per-request form on luna has never been tested.**

### 6.6 Resolution is not at stake either way

`mini-swe-agent` scores **>74% on SWE-bench Verified** and *"does not have any tools other than
bash — it doesn't even need to use the tool-calling interface of the LMs"*, with *"every action …
completely independent"* [W]. A shell-only surface is not a resolution handicap. That is consistent
with our own 120/198 against 125/198 at p ≥ 0.72, and it means the whole structured-surface question
is a cost question, subject to the solve veto.

---

## 7. What the literature predicts for a structured `ss-*` surface, and what would have to be true

### 7.1 Prediction, per harness

| harness | predicted effect of a structured `ss-*` surface | why |
|---|---|---|
| **codex** | **Nothing today. Possibly a sweet-only win after a codex upgrade.** | Both arms are at 1.000. Codex 0.146.1 built requests without the parallel affordance for our provider path. After PR #38499 (2026-08-14) parallel is set for all prompts — and then codex becomes the *only* harness where native has **no structured retrieval tools to batch** (native is `exec_command` only), so a structured sweet surface would create a differential in sweet's favour. But codex MCP tools are **serial by default** (PR #17667) and need `supports_parallel_tool_calls = true` per server, and Responses Lite disables top-level parallel calls at request construction. |
| **opencode** | **Largest ceiling: −3.43 requests per rollout, −10% to −18% of the sweet cell.** Would flip the arm. | Native already batches at 2.370 retrieval calls per request; `read`/`glob`/`grep` sit in multi-call requests 75–90% of the time; opencode executes regular tool calls concurrently via `Promise.all` [W issue #14195, 2026-02-18]. |
| **claude-code** | **Moderate ceiling on the main thread: −2.82 requests per rollout, −6% to −9%.** Weakest causal case. | Native main-thread density is only 1.311. The same `Bash` tool swings 3.5% → 41.3% between sweet main and sweet subagents, so structure is demonstrably not the controlling variable here. |

### 7.2 What would have to be true

Five conditions. Each has a $0 or near-$0 test, and each is falsifiable now.

1. **Emission rate must be a property of the tool, not of the task shape.** *Currently contradicted.*
   Claude-code sweet `Bash` moves 3.5% → 41.3% with the tool fixed and the context changed [M]; and
   Anthropic names task shape as the cause [W]. **Falsifier already run and failed for claude-code.**
   It has not been run for opencode: the $0 test is to check whether opencode sweet's multi-bash
   requests cluster in the same exploration phase as native's multi-read requests. If they do, the
   ceiling is task-shape-limited on opencode too.
2. **The parallelism must survive the harness's request construction.** Codex 0.146.1 proves it may
   not. Any structured plan must state the exact codex version, whether Responses Lite is in play,
   and — for an MCP delivery — that `supports_parallel_tool_calls = true` is set on the server.
3. **The independent work must exist.** Sweet performs **739 `ss-*` operations per 63 rollouts
   (11.7 per rollout)** against native's **993 structured retrieval calls per 67 rollouts (14.8 per
   rollout)** [M]. Sweet does **21% fewer** retrieval operations and needs **27% more** retrieval
   requests (7.94 per rollout against native's 6.25). So the work is there and it is being serialised — this condition currently **holds** on
   opencode. It is the strongest single argument for the lever.
4. **The new tool schemas must not eat the saving.** Tool definitions live inside the cached prefix
   [W `06` §2.1]. Six `ss-*` schemas would add roughly the same order as the 1,457-token guide
   (2.6–4.5% of the sweet cell). Against a −10% ceiling that is survivable; against the −6% end on
   claude-code it is not, unless the guide shrinks in exchange. **Neither Anthropic feature that
   would offset it applies**: Tool Search is disclaimed below 10 tools, Programmatic Tool Calling is
   disclaimed for sequential reasoning workflows [W].
5. **Solve must not move.** Bash-only agents score >74% on SWE-bench Verified [W], so the direction
   of risk is neutral, but W&D's saturation result means over-widening wastes calls, and our own A2
   record shows a model asked to batch will pack *dependent* operations with invented arguments
   (3 of 4 traps). Any structured surface has to keep dependent calls apart.

### 7.3 The two vehicles, and their status

- **MCP / structured tool registration.** Register A4: OWNER-EXCLUDED (2026-07-31, Bash/CLI only),
  UNBENCHMARKED, and the `-mcp.md` guide variant has never been run. This document supplies the
  measurement that A4's revival condition asks for — the per-harness ceiling — and adds three facts
  A4 did not have: the codex zero, the codex MCP serial-by-default rule, and the claude-code
  same-tool 12× swing that undercuts the causal story. **`needs_user_decision`, `new_tool: true`.**
- **A per-request batching nudge carried on `ss-*` tool output.** Every `ss-*` result is a tool
  result whose text sweet controls, so a trailer is sweet-only and touches neither the shared FRAME
  nor the shared shim. This is the exact form Anthropic recommends for Fable 5.1 and the exact form
  W&D found to beat system-level instructions. **Register A6 marks mid-task advisories REFUTED**,
  but on Grok, in a footer whose "win" was an accidental A/A, and never in the "name the number of
  calls" form. It is also a payload change that adds bytes to every result, so it must be priced
  against the 7–10% sweet-only constant before anyone builds it. I record it as a seed, not a
  recommendation.

---

## 8. Cheapest $0 falsifiers

| # | question | test | kill condition |
|---|---|---|---|
| F1 | Is opencode's ceiling task-shape-limited? | For each opencode sweet rollout, mark the request index of the first successful edit. Compare the `ss-*` companion rate before and after it with native's `read` companion rate over the same phases. Scripts already staged in `/tmp/wf-slatec/structparallel/`. | If sweet's pre-edit `ss-*` companion rate is already ≥ 70% of native's pre-edit `read` rate, the remaining gap is phase mix and the ceiling drops below 1.5 requests per rollout. |
| F2 | Would the schemas eat the win? | Token-count six `ss-*` JSON schemas with the same tokeniser used in `05` §3, and subtract from the guide any lines a schema would make redundant. | Kill if net added prefix exceeds 500 tokens without an equal cut to the guide. |
| F3 | Does codex still emit 1.000 after PR #38499? | Re-run the `codex-parallel.py` counter against any newer codex run in `results/`; if none exists, this stays open. | If a post-0.146.1 codex run also shows 1.000 in both arms, the codex branch of the lever is dead permanently. |
| F4 | Are dependent `ss-*` calls being packed already? | In the 43 envelopes with ≥2 `ss-*` operations and the 119 multi-bash requests, count how many second calls use a path or symbol that appears only in the first call's output. | If >25% are dependent, packing more will produce wasted calls, matching the A2 trap rate. |

---

## 9. What I could not finish

- **Opencode phase analysis (F1).** I built the request sequences but did not classify them by
  phase against the first edit. That is the single most valuable remaining $0 measurement, because
  it decides whether the opencode ceiling is real or an artefact of exploration versus repair.
- **Claude-code cost reconciliation.** `rows.json` for `fp-claudecode-tab-20260826` gives
  `costRealizedUsd` $0.005853 native / $0.013065 sweet with `costSidechainUsd` zero, against the
  BRIEF's $0.021558 / $0.020727. I used the BRIEF's figures and flagged the gap; I did not find the
  accounting path that produces them.
- **The opencode GPT-5 system prompt.** Doc `06` §4.1 says opencode picks `beast.txt` /
  `codex_header.txt` for GPT models. The `"**Parallelism:** Execute multiple independent tool calls
  in parallel when feasible"` string I found in the binary sits in a Gemini-flavoured prompt, so I
  do **not** claim it was in our run's system prompt. The `read` tool description, which is always
  sent, is the citation I rely on.
- **Whether codex's request actually carried `parallel_tool_calls: false`.** The literal field name
  is a substring of `supports_parallel_tool_calls` and the linker may dedupe them, so string
  evidence cannot separate the two. The mechanism is [I]; the 1.000 measurement is [M]; the
  catalogue-not-applied evidence (`multi_agent_version: "v1"` against the catalogue's `"v2"`) is [M].
- **`fp-opencode` sweet is 63 of 66 rows.** The three missing rollouts live in the repair pass
  `rp-oc-tab-20260827`, which I did not fold in. Ratios are unlikely to move; absolute counts would.

---

## 10. Sources

Vendor documentation, fetched 2026-09-02 unless dated otherwise:

- Anthropic, *Parallel tool use* — <https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use>
- Anthropic, *Prompting Claude Fable 5.1*, §"Batch independent tool calls in agent loops" — <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1>
- Anthropic, *Programmatic tool calling* — <https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling>
- Anthropic Engineering, *Code execution with MCP*, published 2025-11-04 — <https://www.anthropic.com/engineering/code-execution-with-mcp>
- Anthropic Engineering, *Advanced tool use*, published 2025-11-24 — <https://www.anthropic.com/engineering/advanced-tool-use>
- OpenAI, *Function calling* — <https://developers.openai.com/api/docs/guides/function-calling>
- OpenRouter, *API Parameters* (`parallel_tool_calls`, default true) — <https://openrouter.ai/docs/api_reference/parameters>

Harness source and issues:

- openai/codex issue **#32503**, *"GPT-5.6 Sol rarely parallelizes programmatic tool calls, multiplying model turns and quota usage"*, opened 2026-07-12, codex 26.707.41301 / CLI 0.144.0-alpha.4 — <https://github.com/openai/codex/issues/32503>
- openai/codex PR **#17667**, *"Add `supports_parallel_tool_calls` flag to included mcps"*, merged 2026-04-13 — <https://github.com/openai/codex/pull/17667>
- openai/codex PR **#38499**, *"Enable parallel tool calls for all model prompts"*, merged 2026-08-14 — <https://github.com/openai/codex/pull/38499>
- openai/codex `codex-rs/core/src/tools/parallel.rs` (main) — <https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/parallel.rs>
- anomalyco/opencode issue **#14195**, *"Multiple Task tool calls in a single LLM response execute sequentially instead of in parallel"*, 2026-02-18, cites `packages/opencode/src/session/prompt.ts` and states regular tool calls run in parallel via `Promise.all` — <https://github.com/anomalyco/opencode/issues/14195>
- anomalyco/opencode issues #24764, #29638, #31235 (parallel execution engine; sequential subagents; parallel MCP tool hang) — <https://github.com/anomalyco/opencode/issues/24764>

Research:

- Lin, Liew, Savarese, Li, *W&D: Scaling Parallel Tool Calling for Efficient Deep Research Agents*, arXiv:2602.07359v1, 2026-02-07 — <https://arxiv.org/html/2602.07359>
- SWE-agent, *mini-swe-agent* (bash-only, >74% SWE-bench Verified) — <https://github.com/SWE-agent/mini-swe-agent>
- Jannik Reinhard, *Why CLI tools are beating MCP for AI agents*, 2026-02-22 — <https://jannikreinhard.com/2026/02/22/why-cli-tools-are-beating-mcp-for-ai-agents/> — **cited only as an example of the low-rigour CLI-versus-MCP corpus; no model, no date, one task, no turn count.**

Deployed binaries read on `root@167.233.69.121` [C]:

- `/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex` — `codex-cli 0.146.1`, file dated 2026-08-06.
- `/usr/lib/node_modules/opencode-ai/bin/opencode.exe` — `opencode 1.18.4`.
- `/root/.local/share/claude/versions/2.1.218` — Claude Code 2.1.218.

Run data read (read-only) under `/root/sweet-search-private/eval/task-completion-bench/results/`:
`fp-codex-tab-20260826`, `fp-opencode-tab-20260826`, `fp-claudecode-tab-20260826` — `rows.json`,
`agent-state/<task>-<arm>/…`.

Local repo files read: `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`;
`eval/task-completion-bench/handoffs/improve/HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md`;
`.../harness-gutter-cost-20260828/0{5,6,7}-research-*.md`;
`eval/task-completion-bench/PLAN.md`;
`eval/task-completion-bench/FORENSICS-heldout200-grok-opencode-2026-07-28-OPUS-5.md`.
