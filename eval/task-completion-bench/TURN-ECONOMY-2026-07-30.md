# Turn economy — research note, harness verification, and proposed instruction block

**Date**: 2026-07-30 · **Status**: drafted, pending paid validation · **Spend so far**: $0

Context: the retired Grok-4.5/OpenCode held-out run cost +15.2% in the sweet arm, and **94.7%
of that gap is re-send tax from turn inflation** (PLAN.md §4). Sweet used **+18.1% more turns**
than native (5,908 v 5,003).

The headline framing of *why* — "sweet issues 1.14 tool calls per turn against native's 1.76" — is
**mostly a measurement artifact and is corrected in §3.3**. The harness counts tool *envelopes*,
and sweet fuses several operations into one shell envelope where native issues them separately. At
operation level the per-turn gap is **−8.4%, not −35.8%**: sweet 1.725 v native 1.883. Of sweet's
+18.1% extra turns, roughly 8.2% is doing more retrieval operations and ~9% is packing them less
densely — and only the second half is what this block acts on. Likewise "85.7% of sweet turns carry
a single tool call" means a single *envelope*, and those envelopes average 1.45 operations.

This note covers: (1) what the state of the art says about fixing that with prompt wording,
(2) two harness facts verified for free, (3) the block we propose, (4) the validation design.

**This reopens the earlier "no prompt edits" decision.** PLAN.md §6 struck the cost levers on
2026-07-29 (P1 MCP, P2 anti-thrash) and recorded "no remaining lever closes a +15.2% cost gap on
the Grok/OpenCode backbone". The turn-economy lever is a *different mechanism* from either struck
lever — it changes when already-planned probes are issued, not what is retrieved or how it is
transported — and it is reopened by explicit user instruction.

---

## 1. Research note (Phase 1)

### 1.1 The strongest primary evidence

**W&D: Scaling Parallel Tool Calling for Efficient Deep Research Agents** (Lin, Liew, Savarese,
Li — Salesforce AI Research, arXiv:2602.07359, 2026-02-07) is the closest thing to a direct
ablation of our exact lever. On BrowseComp with GPT-5-Medium at a 100-iteration cap:

| tools/turn | accuracy | avg turns | cost / 100 tasks | wall-clock |
|---|---|---|---|---|
| 1 (baseline) | 66% | 45.7 | $102.5 | 1522.6 s |
| **3** | **68%** | **23.8** | **$65.7 (−35.9%)** | **904.2 s (−40.6%)** |
| 5 | 64% | 18.4 | — | — |
| 8 | 63% | 15.2 | — | — |

Turns nearly halve; cost falls 35.9%; accuracy does not degrade. This is the same mechanism we
measured — fewer turns → less re-sent prefix — reproduced independently on a different backbone
and benchmark, with the direction and rough magnitude we predicted (our counterfactual at native's
calls/turn was −14.2%).

Three further results from the same paper matter to how we word the block:

- **Width has an optimum, and it is low.** 3 tools/turn beats 5 and 8 at high turn limits
  (68 / 64 / 63). Unbounded "parallelize everything" is measurably *worse* than a modest cap.
  This is the quantified form of our anti-shotgun requirement.
- **Explore-then-exploit beats a flat rate.** A *Descending* schedule (3 calls early → 1 late)
  scored 74% in 23.5 turns, against 66%/45.7 for constant-1 and 68%/23.8 for constant-3.
  *Ascending* was the worst tested (63%). More batching early, less late.
- **Letting the model choose the width underperformed a fixed schedule.** The "Automatic"
  scheduler reached 72%/26.6 turns — better than constant-1, worse than Descending.

**Why accuracy did not drop** (their §4, from manual trace inspection): parallel calls broaden
source coverage, cross-check each other against unreliable tool output, and decompose an
over-constrained query into several clean ones. None of these transfer automatically to code
search over a local index — they are properties of noisy web retrieval — so we should expect the
efficiency result to transfer and treat any accuracy gain as unclaimed.

### 1.2 Wording patterns with the best deployment evidence

**Pattern A — "batch independent calls in one message" (Anthropic, Claude Code).** Verbatim from
the leaked Claude Code system prompt: *"You have the capability to call multiple tools in a single
response. When multiple independent pieces of information are requested, batch your tool calls
together for optimal performance."* and, for bash specifically, *"When making multiple bash tool
calls, you MUST send a single message with multiple tools calls to run the calls in parallel."*
The `MUST send a single message` framing is the most directly transferable phrasing we found for
our failure mode, which is precisely one-bash-call-per-message.

**Pattern B — "default to parallel unless dependent" (Cursor).** *"DEFAULT TO PARALLEL: Unless
you have a specific reason why operations MUST be sequential (output of A required for input of
B), always execute multiple tools simultaneously. This is not just an optimization - it's the
expected behavior."* Two useful properties: it inverts the default (our model's default is
serial), and it defines the exception operationally (A's output feeds B's input) rather than
leaving "independent" undefined.

**Pattern C — the explicit dependency carve-out (Anthropic platform guidance).** *"If some tool
calls depend on previous calls to inform dependent values like the parameters, you should not call
these tools in parallel and instead call them sequentially."* Every vendor prompt we read pairs
the batching instruction with this carve-out. Omitting it is the documented route to breakage.

**Pattern D — chain dependent shell steps in one command (Claude Code).** *"When issuing multiple
commands, use the ';' or '&&' operator to separate them. DO NOT use newlines."* This is the safe
route for dependent steps and is already at 67.8% of our `ss-*` calls.

**Pattern E — a numeric bound, stated as a floor AND a ceiling (W&D).** The instruction they
found reliable was *"you MUST make at least m but not more than m+1 function calls in a single
response to gather information extensively."* The ceiling is load-bearing: it is what stops the
instruction from degenerating into shotgun width, which their own Table 1 shows is harmful.

### 1.3 What does NOT work

- **System/persistent-message delivery is the weaker channel.** W&D tested exactly two placements
  — an instruction in the system message, versus a user message injected before each LLM call —
  and chose the per-turn user message "for its superior performance and more reliable tool-call
  consistency". **This is a direct risk to our design**: our block ships via `AGENTS.md`, which is
  the persistent channel, not the per-turn channel. The paper's headline numbers were obtained
  with the delivery mechanism we are *not* using. We cannot adopt theirs without a harness change
  and without violating the memory-file delivery rule, so the honest expectation is a *smaller*
  effect than the paper's −35.9%. This is the single largest reason to validate rather than ship.
- **Speculative-batch phrasing is wrong for us.** Claude Code also says *"It is always better to
  speculatively perform multiple searches as a batch that are potentially useful."* That
  instruction deliberately *raises* call volume. Our guardrail is that total calls must stay flat
  (sweet's −23.3% call advantage must survive), so this phrasing is excluded by design.
- **"Let the model decide how wide to go" underperformed** a fixed schedule (72% vs 74%).
- **Ascending width (narrow early, wide late) was the worst tested schedule** (63%).
- **Open-weight models gain much less.** Qwen3-235B-Thinking 8%→11% and DeepSeek-V3.2 38%→39% on
  BrowseComp, versus much larger gains for GPT-5/Gemini-3/Claude-4.5 — the paper attributes this
  to weaker intrinsic parallel-calling. Grok-4.5 is not in their model set, so its position on
  that spectrum is unmeasured.

### 1.4 Model-specific: does Grok-4.5 batch?

xAI documents `parallel_tool_calls` defaulting to `true` and describes Grok "often invoking
multiple tools in parallel", but the Grok-4.5 model page carries **no** guidance on tool-call
width, per-turn limits, or prompting for it. There is no published Grok-specific ablation.

Our own run data is the better evidence and it is unambiguous: 383 sweet-arm and 481 native-arm
assistant messages already carried ≥2 parallel bash calls. **The serial habit is a habit, not a
harness or model limit.** The gap is between what Grok can do and what it does by default when
every tool is routed through one shell.

### 1.5 Risk findings

1. **Shotgun spam is the documented failure mode** and it is real at width ≥5 (§1.1). Mitigated by
   the explicit cap and by "never a probe you had not planned".
2. **Wider turns can cancel the win.** Our guardrail is that the cost sign lives in
   context-width-per-turn as much as in turn count. W&D reports turns and cost but not
   context-per-turn, so it does not clear this risk for us — hence ctx/turn is a measured metric
   in the validation, not an assumption.
3. **Delivery-channel mismatch** (§1.3) — expect an attenuated effect.
4. **Our lever is a strictly narrower claim than the paper's.** W&D's cost win came *with more
   total tool calls* (3 × 23.8 = 71.4 calls vs 1 × 45.7 = 45.7): they reduced cost by trading
   calls for turns. Our guardrail forbids that trade — we require calls to stay flat and only
   collapse turns. **The paper does not isolate that subset**, so it supports our mechanism but
   not our exact constrained form. That is what the dev A/B is for.

### Sources

- [W&D: Scaling Parallel Tool Calling for Efficient Deep Research Agents (arXiv:2602.07359)](https://arxiv.org/pdf/2602.07359)
- [Anthropic — Parallel tool use (platform docs)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use)
- [Claude Code system prompt (leaked, wong2 gist)](https://gist.github.com/wong2/e0f34aac66caf890a332f7b6f9e2ba8f)
- [Cursor Agent CLI prompt](https://howworks.trendz-ai.com/system-prompts-and-models-of-ai-tools/cursor_prompt/agent-cli-prompt)
- [OpenAI Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)
- [xAI — Grok 4.5 docs](https://docs.x.ai/developers/grok-4-5) · [xAI — Function calling](https://docs.x.ai/docs/guides/function-calling)
- [Learning Adaptive Parallel Execution for Efficient Code Localization (arXiv:2601.19568)](https://arxiv.org/pdf/2601.19568)
- [Parallel Tool Calling and Execution Optimization in AI Agent Systems (Zylos, 2026-04)](https://zylos.ai/research/2026-04-23-parallel-tool-calling-optimization-ai-agents)

---

## 2. Harness verification (Phase 2) — free, no spend

### 2.1 ORDERING — OpenCode does NOT guarantee in-order execution. **The edit+test clause is cut.**

Two independent methods, both read-only, both agreeing.

**Source (OpenCode 1.18.4, `opencode-linux-x64/bin/opencode`).** In the streaming tool-call
handler, each `tool-call` chunk fires its own execution the moment it is parsed off the stream,
and the call is **not awaited**:

```js
case"tool-call":{ … if(M.set(T.toolCallId,T.input), d.execute!=null && T.providerExecuted!==!0){
  let BK=L(); N.add(BK);
  GZ({toolCall:T,tools:K,…})          // ← executeTool, NOT awaited
    .then(g=>{j.enqueue(g)})
    .catch(g=>{j.enqueue({type:"error",error:g})})
    .finally(()=>{N.delete(BK),_()})
}}
```

Pending executions are tracked in a set (`N`) and drained at flush. There is **no completion
barrier between tool calls in the same assistant message**. The AI-SDK layer beneath does the
same thing explicitly elsewhere: `await Promise.all(x.map(async RK => … GZ({toolCall: RK.toolCall …})))`.

**Run data (retired held-out run DB, `/root/.local/share/opencode/opencode.db`, copied read-only).**
429 eval sessions, 10,911 messages carrying tool parts, 2,997 with ≥2 tool parts. Each tool part
records wall-clock `state.time.{start,end}`.

- The blunt overlap count (73/2,997) **understates** concurrency badly, because most tools finish
  in milliseconds while stream arrivals are ~800 ms apart (median inter-call gap 797 ms, p90
  9.2 s) — they don't overlap simply because they are too fast to.
- The correct denominator is messages containing a **slow non-final call** (≥1 s), where a
  serializing harness would visibly force later calls to wait. There are 30 such messages, and in
  **23 of 30 a later call started before the earlier one finished**. Example
  (`kubernetes-sigs__security-profiles-operator-1278`): `run_tests` ran `[0 → 180,121 ms]` while
  `grep` ran at `[710 → 732 ms]` and `read` at `[1,363 → 1,376 ms]` — fully inside it.
- Independently: in **445 of 2,996** multi-call messages a *later-declared* call started before an
  earlier-declared one. (Declaration order was validated as `part.id` order == `part.time_created`
  order in 2,996/2,996 messages.)

**Verdict: an edit and its test in the same message may run concurrently.** The draft's
"after an edit, run the targeted test in the same message" clause is **removed**. Dependent steps
are expressible only as `&&` inside a single bash call — which the block now says explicitly, with
the reason.

**Consequence for the expected effect size — the reachable opportunity is smaller than the
headline 797 turns.** Of the 797 greedily-collapsible sweet turns (13.8%, ≈$11.4), the **292
edit → `run_tests` pairs are now out of reach**: an edit goes through the harness edit tool and
`run_tests` through bash, so the pair cannot be `&&`-chained into one call, and putting them in one
message is exactly what §2.1 shows is unsafe. That removes ~37% of the greedy count. What remains
directly addressable is the 38 independent adjacent single-`ss` turns plus whatever share of the
551 search → read pairs have a read path known in advance.

**Correction (§3.3).** An earlier version of this note argued the greedy count understated the
opportunity because the broader calls-per-turn gap (1.14 v 1.76) was a far larger pool. That was
wrong: 77% of that gap is packaging, and the real per-turn deficit is 8.2%. The honest position:
**the ≈$11.4 figure is an overestimate of what this block reaches, the envelope gap is not
evidence of a larger pool, and no dollar figure should be quoted until the pilot measures one.**
"Permanently" unreachable also overstated the edit → test case — those pairs are out of reach for a
prompt-only treatment on this tool surface, not in principle.

Scripts (read-only, kept for audit): `ordercheck.py`, `ordercheck2.py`, `bundlescan.py`,
`bundlescan2.py` in this session's scratchpad; the DB was copied to `/tmp/oc_ro.db` and opened
`mode=ro`. Nothing in the retired run was modified.

### 2.2 VARIANT PLUMBING — already supported; zero code change needed

`harness/run-pilot.mjs:68`:

```js
const MPP = process.env.MPP || path.join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
```

`:371` strips the YAML frontmatter and `:455/:460` thread `mppText` to the runner;
`agent-runner-shared.mjs:155` wraps it as `FRAME_OPEN + mppText + FRAME_CLOSE` and
`opencode-task-runner.mjs:106` writes it to **`AGENTS.md`** in the rollout dir — the memory-file
delivery path, unchanged.

`run-pilot.mjs:69` already has the arm filter, with a comment naming this exact use case:

```js
const ARMS = (process.env.ARMS || 'native,sweet').split(',') // arm filter (e.g. ARMS=sweet) for prompt-variant smokes
```

**Mechanism for the A/B**: two runs, both `ARMS=sweet`, identical `INSTANCES`/`TASKS_FILE` and
identical everything else, differing only in `MPP` and `RUN_ID`; pair by task id. The frozen files
are never read by the variant arm and never written by either.

**One gap, not fixed here**: `rows.json` records no prompt provenance — nothing stamps which `MPP`
produced a row. Adding a stamp is a harness change and out of scope for this session, so
provenance is carried by `RUN_ID` naming plus the sha256 recorded in §4. Worth stamping before any
future prompt A/B becomes routine.

---

## 3. Proposed block (Phase 3)

**Revised twice on 2026-07-30 after two external-review rounds (Codex).** Drafts at 99 and 69 tok are superseded; §3.1 and §3.3
records why. Current block:

**CLI (`ss-*`) form — 306 chars = 77 tokens** (repo `estimateTokens` = chars/4):

```markdown
## Turn economy
Independent probes you already intend go in ONE message — usually two or three, never a probe you had not planned. Join them in a single bash call separated by `;` (`&&` only when a later step should be skipped if an earlier fails). A probe needing another's result goes in a later message.
```

**MCP form — 212 chars = 53 tokens** (identical first and last sentences; the `&&` sentence has no
meaning against a non-shell tool surface, so parallel calls become the stated mechanism):

```markdown
## Turn economy
Independent probes you already intend go in ONE message, as parallel tool calls — usually two or three, never a probe you had not planned. A probe needing another's result goes in a later message.
```

### 3.1 What the first draft got wrong

Three defects, all real; two were violations of requirements this note had already written down.

1. **It contradicted the prompt's own stop discipline.** The draft said *"A turn spending one
   search or read is wasted unless it is your last."* But M± prescribes single-probe turns as
   *correct* in its most common routing case — *"ONE `ss-grep` on that literal … Trust the top hit
   and stop"*, *"one `ss-search`"*, *"confirm with at most one narrow `ss-read`"*. The
   "unless it is your last" hedge does not cover the multi-file chain, where each hop is single and
   dependent and none is last. The sentence also invites padding, which is the anti-goal. **Cut
   entirely** rather than hedged: the block is now purely conditional and says nothing about turns
   that legitimately carry one probe.
2. **The worked example taught the wrong lesson.** `ss-grep "sym" && ss-read src/x.rs 40 120` has a
   hardcoded read path, so the two probes are *independent* — by the block's own rule they should
   have been batched, not serialized. The example illustrated the opposite of the sentence it was
   attached to. **Removed.** No example is better than a wrong one; if the pilot shows dependency
   confusion, a correct example is a cheap follow-up variant.
3. **"EVERY … about three" was not a limit.** *"carries EVERY independent call you already
   intend"* and *"about three"* disagree whenever more than three are intended. Now a single
   bound: *"usually two or three"*.

Also dropped: the parenthetical explaining concurrency. The model does not need the harness's
execution semantics, only the resulting rule.

### 3.2 Where the review's recommendation was not adopted, and why

The review recommended a 46-token form ending *"keep dependent calls sequential"*, with the `&&`
guidance dropped, and a bash-aware alternative that reserved `&&` for order-only dependencies.
Both would push the model from `&&` chaining toward separate parallel calls. **Under this bench's
guardrail that is a regression, not a simplification:**

| two independent probes | tool calls | turns |
|---|---|---|
| chained `&&` in one bash call | **1** | 1 |
| two parallel bash calls | **2** | 1 |

Both collapse the turn identically; only the first keeps call count flat. The hard guardrail is
that total calls must not rise (sweet's −23.3% call advantage must survive), and `&&` is already
**67.8% of `ss-*` calls** — the established idiom. An instruction that converts existing chains
into separate calls raises calls with no turn benefit and would trip our own revert gate for a
wording reason rather than a mechanism one. So the block keeps `&&` as the *preferred* mechanism
and treats parallel calls as the fallback for work that cannot share one command (e.g. a shell
probe alongside a harness read or edit).

The rest of the first review is adopted: brevity, the conditional trigger, the single numeric
bound, and one wording only in the pilot — the 36 pairs are not split across variants.

### 3.3 Second review round — the packaging correction

A second review challenged both §3.2's reasoning and the opportunity estimate. It is right on
every load-bearing point, and the correction is larger than it argued.

**(a) The §3.2 table omitted the baseline, so its conclusion was overstated.** The full picture:

| execution | tool envelopes | model turns | underlying probes |
|---|---|---|---|
| serial, separate messages (the status quo) | 2 | 2 | 2 |
| parallel calls, one message | 2 | 1 | 2 |
| fused bash command | 1 | 1 | 2 |

Against the *serial baseline*, parallel calls do not raise call count — they hold envelopes at 2
and halve turns. So "only `&&` keeps calls flat" was **false as stated**. The defensible claim is
narrower: naming shell fusion explicitly reduces the risk that *already-fused* commands get
decomposed into separate envelopes. That is a reason to retain fusion guidance, not a proof that
parallel calls are disallowed. Corrected.

**(b) The harness counts envelopes, not operations — verified in code.**
`opencode-task-runner.mjs:178` is literally `const calls = toolCalls.length`. Worse than the
review supposed, `classifyShell` (`:22`) is **prefix-anchored**, so `ss-grep A && ss-grep B &&
ss-read C` scores as ONE `ss` call, and `ls && ss-grep A` scores as ONE `bash` call with the probe
invisible. A treatment could therefore add probes, fuse them, and pass a calls/task gate defined on
envelopes. The anti-shotgun clause would be prompted but not measured. Conceded in full; the fix is
§3.4.

**(c) The 1.14 v 1.76 gap is mostly packaging — measured, not argued.** Recomputing both arms of
the retired run from the shared DB, at envelope level and at operation level (fused shell strings
split on `;`/`&&`/`||`/newline, counting the same buckets `classifyShell` uses, so sweet's
`ss-read` and native's `cat`/`sed` count alike):

| arm | turns | envelopes | operations | ops/envelope | **envelopes/turn** | **operations/turn** |
|---|---|---|---|---|---|---|
| native | 5,003 | 9,248 | 9,419 | 1.02 | **1.848** | **1.883** |
| sweet | 5,908 | 7,009 | 10,193 | 1.45 | **1.186** | **1.725** |
| sweet vs native | +18.1% | — | +8.2% | — | **−35.8%** | **−8.4%** |

(The envelope ratio 0.642 reproduces the plan's 1.140/1.763 = 0.647, so this is the same quantity,
recomputed.) **77% of the apparent calls/turn gap is packaging.** Sweet already does nearly as many
retrieval operations per turn as native — 1.73 v 1.88 — and fuses far more (2,746 multi-operation
bash envelopes v native's 1,557). The claim that the envelope gap establishes a large addressable
pool was wrong; it is withdrawn.

The corrected decomposition of sweet's +18.1% turn inflation: **~8.2% is doing more retrieval
operations** and **~9% is packing them less densely**. Only the second half is what this block
acts on.

**A first-order caveat this raises for PLAN.md §4.3.** The −14.2% counterfactual ("6,468 calls at
native's 1.76 calls/turn → 3,675 turns") is computed on *envelopes*. It implicitly assumes sweet
could pack envelopes like native, but sweet's envelopes already carry 1.45 operations against
native's 1.02, so the counterfactual asks sweet to do something it is largely already doing.
**That number should be treated as unreliable until recomputed at operation level.** It is cited in
the plan as motivation for the cost levers, so this is a correction to an existing figure, not only
to this proposal. Not rewritten here — flagged for the plan owner.

**(d) `&&` is the wrong separator for independent probes — confirmed empirically.** `&&` runs the
next command only if the previous succeeded. Measured exit codes for the shipped wrappers:

| case | exit |
|---|---|
| `ss-grep` no match | **0** (safe) |
| `ss-read` missing file | 1 |
| `ss-grep` malformed regex | 1 |
| `ss-semantic` missing file | 1 |
| **`ss-trace` unknown symbol** | **1** |

The common no-match path is safe, but `ss-trace` on an unknown symbol exits 1 — and M± treats an
empty trace as a *normal outcome* ("if a trace is sparse or empty, anchor the downstream symbol
with `ss-find`/`ss-search`"). So `ss-trace X && ss-grep Y` silently drops the grep exactly when the
trace fails to find anything, which is when the follow-up matters most. The block now specifies
`;` for independent probes and reserves `&&` for genuine skip-on-failure. Adopted.

**(e) "Only if they cannot share a command" was vacuous for the CLI, and the framing was wrong.**
Practically any shell commands can share one command string, so that clause carried no
information; it is removed. More importantly, the CLI treatment is therefore **serial shell-command
fusion, not concurrent tool calling**. It compresses turns and re-sent context by the same
mechanism, but it is *not* a replication of W&D's parallel tool calling, and a CLI result does
**not** validate the MCP wording (which genuinely is parallel calls). Any write-up must say
"turn compression via shell-command fusion" for the CLI arm. Adopted.

**(f) "Waits" was underspecified** — it could be read as co-issued execution that the harness
orders. Now "goes in a later message", which is the operational rule given §2.1. Adopted.

**(g) "Permanently unreachable" was too strong** for the 292 edit → test pairs. They are out of
reach *for a prompt-only treatment on this tool surface*; a composite edit-and-test tool would
reach them. Corrected.

### 3.4 Predeclared diagnostic: `stats/probe-count.mjs`

Because the envelope metric cannot validate "never a probe you had not planned" (§3.3b), the A/B
**predeclares** an operation-level count as a required diagnostic, fixed before the run:

- **envelopes/task** — what the harness reports today
- **operations/task** — `ss-*`, `run_tests`, and native retrieval, after splitting fused shell
  strings on `;`, `&&`, `||` and newlines (quote- and paren-aware)
- **turns/task**

`stats/probe-count.mjs` implements this. It is READ-ONLY: it copies each rollout's private
OpenCode store (db + WAL + shm) to a scratch dir and reads the copy, so no run artifact is opened
for write and no harness code changes. Validated on the existing 5-rollout smoke
(`l3-dedup-smoke-20260730`): 377 envelopes → 621 operations, **1.65 operations per envelope**,
1.05 envelopes/turn but **1.73 operations/turn** — i.e. the envelope view understates work per turn
by ~65% on that sample.

**The calls-flat gate is redefined on operations/task, not envelopes/task.** An envelope-level
gate is gameable by fusion and would not detect added probes.

### Requirement check

| requirement | how it is met |
|---|---|
| ≤100 tokens | **77** (CLI) / **53** (MCP) |
| tool-agnostic core | first and last sentences identical across both forms |
| one bash-specific element | the `&&`-in-one-bash-call preference (CLI form only). **A literal command example was dropped** — the draft's was wrong (§3.1) and a wrong example is worse than none. Flagged as a cheap follow-up variant if the pilot shows dependency confusion |
| anti-shotgun clause | "usually two or three, never a probe you had not planned" — the numeric bound is from W&D Table 1 (§1.1), where width 5 and 8 score *worse* than 3 |
| no contradiction of stop-discipline / sufficiency | the block is now purely conditional and says nothing about turns that carry one probe, so it cannot fight *"ONE `ss-grep` … trust the top hit and stop"*. "Never a probe you had not planned" restates the existing no-corroboration rule. The block changes *grouping*, never *how many* |
| edit+test clause | **cut** per §2.1 |
| "when, not more" framing | "probes **you already intend**" |
| calls-flat guardrail | shell fusion retained as the CLI mechanism (§3.2), and **measured** at operation level by the predeclared diagnostic (§3.4) rather than assumed |

### Placement

Appended as a new final section in both files. It disturbs no existing ordering and reads as an
operational addendum after the search-discipline sections, keeping the stop rules undiluted.

### Files

- `core/prompt-optimization/data/p7-turn-economy/sweet-search-system-prompt.turn-economy.md`
  — 1307 → **1384** tokens (+77, +5.9%) · `variant_id: p7-v1-mppppp-fs-te3`
- `core/prompt-optimization/data/p7-turn-economy/sweet-search-system-prompt-mcp.turn-economy.md`
  — 1336 → **1390** tokens (+54, +4.0%) · `variant_id: p7-v1-mppppp-fs-mcp-te3`

Both are byte-identical to their frozen source except for the appended block. Their frontmatter
deliberately **omits** the champion's `score_sonnet` / `joint_maximin` / `vault_*` gates — those
attest the frozen body and would be false here — and carries
`benchmarked: false`, `status: PROPOSAL`.

**Diff against both frozen files** = the appended block and nothing else:

```diff
--- a/core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md
+++ b/core/prompt-optimization/data/p7-turn-economy/sweet-search-system-prompt.turn-economy.md
@@ (end of file)
 Before editing a symbol with visible siblings … Single-site edits skip this.
+
+## Turn economy
+Independent probes you already intend go in ONE message — usually two or three, never a probe you had not planned. Join them in a single bash call separated by `;` (`&&` only when a later step should be skipped if an earlier fails). A probe needing another's result goes in a later message.
```

(plus the frontmatter replacement described above; the MCP diff is the same shape with the MCP form
of the block.)

---

## 4. Validation plan (Phase 4) — **NOT LAUNCHED, awaiting explicit go**

Design of record:

- **Tasks**: 36 drawn from the 168 gold-valid dev-200 tasks, stratified by language,
  `seed = 20260730`, selection outcome-blind (uses only ledger validity + language).
  Never held-out 1, never held-out 2. List sha256 prefix `2926a0d096c0062f`; also at
  `/tmp/ab_tasks.json` on the box.

  ```
  analysis-dev__diktat-1206, argoproj__argo-3371, dashbitco__nimble_options-43,
  dmitrysoshnikov__regexp-tree-153, dtolnay__cxx-585, epiforecasts__scoringutils-229,
  facelessuser__wcmatch-46, fatiando__verde-44, foolip__mdn-bcd-collector-1813,
  googleapis__java-storage-390, googleapis__python-bigquery-1989,
  graphql-java-kickstart__graphql-java-tools-593, jlongster__prettier-561,
  k0sproject__k0sctl-556, kayak__pypika-170, martin-helmich__typo3-typoscript-lint-117,
  meggart__diskarrays.jl-232, microsoft__kiota-4328, migorithm__duva-683,
  mransan__ocaml-protoc-202, nuxt__nuxt.js-8792, nvim-lua__plenary.nvim-348,
  oliyh__martian-75, preactjs__preact-render-to-string-246, randombit__botan-2738,
  rsteube__carapace-463, sage__carbon-6796, salsita__node-pg-migrate-622,
  sashabaranov__go-openai-609, scalameta__scalameta-3606, scoutapp__scout_apm_python-526,
  spoonlabs__gumtree-spoon-ast-diff-88, swiftlang__swift-syntax-1170, timothycrosley__isort-775,
  unidata__netcdf-c-1528, verygoodopensource__very_good_cli-611
  ```

  Language mix: python 6 · go 4 · ts 4 · js 3 · java 2 · kotlin 2 · rust 2 · one each of
  c, clojure, cpp, csharp, dart, elixir, julia, lua, ocaml, php, r, scala, swift.
- **Config**: Grok-4.5 / OpenCode / OpenRouter, `ARMS=sweet`, `REPS=1`, `CONCURRENCY=1`,
  isolation jail ON, `run_tests` dedup ON, `TASK_FRAME` ON, `REASONING=standard`.
- **Design**: paired, same 36 tasks both sides; arm A `MPP` = frozen champion, arm B `MPP` =
  turn-economy variant. Two `RUN_ID`s, paired by task id.
- **Metrics**: solve rate (PRIMARY; hard revert on a dip beyond paired noise), calls/task (must
  stay ~flat), turns/task (win condition ≥10% drop), ctx/turn (~flat), cache-normalized
  `idealCostUsd` (never realized $).

### Pre-checks (run 2026-07-30, results below)

| check | state |
|---|---|
| box idle | **OK** — 0 running containers, no active rollout; load ~1.1 from 5 orphaned `agent-jail-init.mjs` (≈27 h) + `egress-guard.mjs serve`. Worth clearing before the run |
| green ledger | **OK** — `/root/env-ledger/dev200/ledger.jsonl`: 200 tasks, **168 gold-valid / grade FULL**, all with `f2pFrac == 1.0` and `p2pFails == 0`; 32 excluded |
| goldens staged | **BLOCKING — 0/168 dev goldens on the box.** The box currently holds the **retired held-out 200** goldens (200/200). A `golden-vault.sh push` of the chosen dev tasks is required first; vault has 239 keys, box disk 168G/225G used (48G free) |
| set-build coordination | **must confirm with the user** — held-out 2 was pre-registered on 2026-07-29 (commit 9be3169) and its build may want the box for ledger sweeps. Never two things on the box at once |

Sha256 of the two prompt bodies used for the run is recorded at launch time, since `rows.json`
carries no prompt provenance (§2.2).

### Expected cost

72 rollouts (36 tasks × 2 prompt arms × 1 rep), sweet arm only — no native rollouts.

Grounded in the retired Grok-4.5/OpenCode held-out run, whose sweet arm is the same backbone,
harness, and prompt-delivery path: **$118.058 / 200 = $0.590 per rollout** (PLAN.md §4.2). The raw
DB agrees: 214 sweet sessions, $123.75 total, **mean $0.578**.

- **Central estimate: 72 × $0.59 ≈ $42.**
- **Plausible range $32–$58.** The per-rollout distribution is heavily right-skewed — median
  $0.337, p75 $0.695, p90 $1.383, max $5.025 — so a 36-task draw containing two or three
  long-runner tasks moves the total several dollars. The estimate is mean-driven, and the mean is
  the noisy statistic here.
- Not included because they cost no API spend: the golden vault push, indexing, and grading.
- If the lever works, **arm B costs less than arm A** and the total lands nearer the bottom of
  the range.

### Gates

| gate | metric | rule |
|---|---|---|
| **REVERT (hard)** | solve rate | any dip beyond paired noise → revert, no tuning |
| **REVERT** | **operations/task** (`stats/probe-count.mjs`) | a rise beyond noise → revert. **This, not envelopes/task, is the anti-shotgun gate** — an envelope gate is gameable by fusion (§3.3b) |
| **REVERT** | ctx/turn | a material rise → revert (the win must be fewer turns, not wider ones) |
| **WIN** | turns/task | ≥10% drop |
| **report** | envelopes/task, operations/envelope | packaging shift, so the result can be read correctly |
| **report** | cache-normalized `idealCostUsd` | never realized $ |

**On the ≥10% win threshold.** It is deliberately set above what mere native-parity would give.
Sweet is 8.4% below native on operations/turn, so closing that alone yields ~8% fewer turns —
under the gate. The block asks for more than parity ("usually two or three" against sweet's current
1.73), so a ≥10% drop is achievable, but the threshold is demanding.

**A 5–9% result is reported as "directionally positive but below the predeclared threshold" —
nothing more.** It is *not* "the mechanism works, the dose is too small": that phrasing asserts a
dose-response relationship this design never tests, and it is an invitation to tune to a dev
result. Such a result becomes evidence for the mechanism only if the paired uncertainty is
controlled, retrieval-and-test operations stayed flat, and solve behaviour shows no concerning
discordance — and even then it licenses a larger confirmatory run, not an adoption.

**The estimator and decision rule are fixed in code before launch**: `stats/turn-economy-ab.mjs`,
tested by `tests/turn-economy-ab.mjs` (17 assertions on synthetic runs, offline).
**Admission first**: it REFUSES to adjudicate unless both runs carry exactly the expected task set,
identical on both sides, one sweet row per task, and every gated metric present and finite — a
crashed or partial run gets `INVALID`, never a verdict on a selected subset. A missing
`agent-state` dir or a `source:"aggregate"` turn log is also `INVALID`, because neither can be
gated. **The operations gate is wired, not pending**: a fixture that cuts turns 20% while
doubling probes returns REVERT.
`ctx/turn` uses **`in` alone** — `in` is the full input context and already includes `cached`
(`harness/turn-log.mjs` field contract), so adding them would double-count the cached prefix.
Primary estimator = ratio of aggregate totals B/A (re-send cost tracks the TOTAL turn count, and
the per-task distribution is too skewed for a mean-of-ratios); secondary = mean paired % change;
**if the two disagree in sign the result is INCONCLUSIVE** and neither is cherry-picked.
Uncertainty = paired bootstrap, 10,000 resamples, seed 20260730, percentile 95% CI — deterministic,
same inputs → same verdict. Thresholds: WIN turns ratio ≤ 0.90 with upper bound < 1.00; REVERT if
operations ratio upper bound > 1.05, or ctx/turn upper bound > 1.10, or solve losses − gains ≥ 3.
Running the script IS the decision; there is no post-hoc estimator choice.

**Power, stated honestly**: at n=36 pairs, turns/task and calls/task are continuous paired
metrics with reasonable sensitivity to a 10% shift. **Solve rate at n=36 is not powered** to
detect a small regression — it is a revert *tripwire*, not a parity test. A clean result here
licenses a larger confirmatory run, not a publishable claim.
