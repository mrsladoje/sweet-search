# Coding-agent trajectory efficiency, 2025–2026: what the 07 document did not cover

Research task `agent-efficiency-2026`, Slate C, 2026-09-02. `$0` spent. No rollouts were run.
Evidence box touched read-only. Scratch: `/tmp/wf-slatec/agent-efficiency-2026/` (box) and the
local scratchpad.

Tags: `[M]` measured by me, with the command named · `[C]` read from code · `[W]` web source with
URL · `[I]` inferred by arithmetic from tagged inputs.

---

## 0. Verdict

**The 2025–2026 efficiency literature is written for a cost model we do not have, and its single
largest family — tool-result pruning and observation masking — is arithmetically dead on this
benchmark before any policy runs.** Every published pruning result prices re-sent tokens at the
full input rate. Our benchmark prices them at one tenth, with a measured 99.3–100% cache hit. That
alone halves the addressable share. The prefix-cache break then turns the remainder negative,
which our own eviction gate already measured. Two 2026 sources now say the same thing in words
without doing the arithmetic, so this document supplies the arithmetic.

Five results are new and actionable.

1. **Observation masking cannot transfer.** Published agents carry 84–85% of their context as tool
   observations. Ours carry 35.5%, because our fixed preamble is 58.6% of the re-sent context and
   our trajectories are 19–23 requests, not 31–500 turns. [W][M]
2. **Progressive disclosure of the tool guide loses 1.7× to 2.0× on every harness.** One deferred
   fetch costs more than keeping 1,457 tokens resident for the whole rollout. This kills, at `$0`,
   the most obvious idea a reader of Anthropic's 2025 tool-search work would propose. [W][M][I]
3. **A harness-conditional tool guide is a real, unrecorded, sweet-only lever.** The guide costs
   about one request per rollout. On claude-code it buys a measured 7.5% by suppressing delegation.
   On codex it buys zero requests and on opencode it buys minus 3.4. [M][I]
4. **On claude-code, native's search surface is not `Grep`. It is an `Explore` subagent that leaves
   no transcript and no usage record at all.** In the fresh pool, native launched `Explore` 60
   times and sweet 12 times. Only `Agent` launches are accounted. Native's cost lower bound is
   therefore looser than the register states, and it is loose in native's favour. [M]
5. **The only controlled A/B of semantic search ever published (Cursor, 2025-11-06) found its
   effect concentrated in repositories with 1,000 files or more. Two of our 21 fresh-pool
   repositories clear that line.** Median repository size in the pool is 310 tracked files. [W][M]

Two candidate seeds survive: a harness-conditional guide, and a precision-gated search-to-read
prefetch whose closure was fitted on a different backbone. Two more need an owner decision:
content-hash edit anchors on claude-code only, and reopening the excluded structured-tool surface.

---

## 1. Scope: what is already covered, and what this adds

I read the section headers and verdicts of all three prior research documents before searching.

| document | covers | this document does not repeat |
|---|---|---|
| `05-research-editing-interfaces.md` | gutter forms, tokeniser study, Claude Code / codex / opencode edit contracts, Aider, SWE-agent ACI, Diff-XYZ, SWE-Fixer, Cline order-invariant apply, EDIT-Bench | any delimiter comparison; any `N\|` versus `N<TAB>` claim |
| `06-research-cost-mechanics.md` | OpenAI and OpenRouter caching contracts, codex 0.146.1, opencode 1.18.4, claude-code 2.1.218 internals, quadratic-turn cost literature, the price vector | the price vector; the harness internals |
| `07-research-resolution-levers.md` | L1–L11, localisation ceiling, LSP-versus-grep (2608.13568), grep-versus-vector (2605.15184), SWE-Pruner, RepoGraph, LocAgent, context files (2602.11988, 2607.27250), verification levers | the resolution ranking; those eleven levers |

Everything below is either absent from all three, or corrects one of them.

---

## 2. Tool-result pruning and observation masking

### 2.1 What the field has published

| work | id / date | what it does | headline number |
|---|---|---|---|
| The Complexity Trap | arXiv 2508.21433, v1 2025-08-29, v3 2025-10-27, DL4C @ NeurIPS'25 | replaces observations older than a window of M turns with a placeholder | "halves cost relative to the raw agent while matching, and sometimes slightly exceeding, the solve rate of LLM summarization" [W] |
| AgentDiet | arXiv 2509.23586, 2025-09-28, FSE 2026 | reflection module deletes useless, redundant and expired trajectory spans | input tokens −39.9% to −59.7%; cost −21.1% to −35.9%; pass rate −1.0 to +2.0 points [W] |
| ACON | arXiv 2510.00615, 2025-10-01, Microsoft | optimises compression guidelines in natural language for observations and history | peak memory −26% to −54%; >95% accuracy retained when distilled [W] |
| Context-Folding | arXiv 2510.11967, 2025-10, ICLR 2026 submission | agent folds finished sub-tasks out of its own working context, trained with RL | matches baselines with an active context up to 10× smaller [W] |
| AgentFold | arXiv 2510.24699, 2025-10 | proactive multi-scale folding for web agents | — [W] |
| Context as a Tool | arXiv 2512.22087, 2025-12-26 | compression exposed as a callable tool the agent invokes at task boundaries | 57.6% solved versus 49.8% ReAct; context stable below 32k over 500 rounds [W] |
| CoACT | arXiv 2607.02911, 2026-07 | action-preserving observation compression at append time | numbers are in image-embedded tables I could not read [W] |
| Masking Stale Observations | arXiv 2606.00408, 2026-05-29 | regime map for when masking helps | +6 to +7 points under weak retrievers, +11.7 points at the sweet spot, **≤0 points for saturated models** [W] |
| CommitKV | arXiv 2608.07855, 2026-08-08 | lifecycle-aware KV-cache compression keyed on tool-call commits | abstract carries no numbers [W] |

### 2.2 The three measured gaps that stop all of it

**Gap 1 — the price vector.** The Complexity Trap computed cost from Alibaba API pricing, which
"does not distinguish between cache hit and miss input tokens" [W]. AgentDiet notes that "modifying
a token in the trajectory invalidates the cache for all following tokens" but runs no sensitivity
analysis on it [W]. Our benchmark charges `$0.10/M` for newly ingested tokens and `$0.01/M` for
re-sent tokens, and the provider cache hit on re-sends is 99.3–100% [M, `resend-census.mjs`, 68
rollouts].

Work the difference out. Codex sweet on the fresh pool splits 28% ingest, 45% re-sent prefix, 27%
output [M, brief §1.1]. The composition of the re-send tax is frame 18.0 points of ideal spend,
agent output 1.8 points, tool bodies 10.9 points — so tool bodies are 35.5% of the tax [M,
`resend-census.mjs`]. Applied to the 45% prefix share, tool bodies are about 16.0% of the codex
sweet bill [I]. Now re-price the re-sends at the uncached rate, as the papers do: the bill becomes
`28 + 450 + 27 = 505` relative units and the tool-body term becomes 160 units, or **31.7%** [I].

**Prompt caching alone halves the prize before any policy runs.** [I on M inputs]

**Gap 2 — the observation share.** Masking Stale Observations measures its own corpus directly:
environment observations are 376.4M of 441.9M content tokens, **85.2%** [W, Figure 2]. The
Complexity Trap reports "around 84% of an average SWE-agent turn" [W]. On our benchmark tool bodies
are **35.5% of the re-sent context**, and the fixed preamble is **58.6%** [M, `resend-census.mjs`].
The preambles are large: codex 14,210 tokens, opencode 6,744, claude-code 17,518 [C, doc 06 §8].

**Gap 3 — trajectory length.** The Complexity Trap triggers its first summary at turn 31 (N=21,
M=10) [W]. Context as a Tool runs to 500 rounds [W]. Our rollouts run 19.6 / 19.0 / 23.4 requests
[C, doc 06 §8], never compact, and reach a largest context of 100,624 tokens against a 1,050,000
window [M, doc 06 §0].

### 2.3 What our own gate already measured, and why it is the answer to this literature

Lever #3's Gate 0 evicted oldest tool bodies at every edit or test boundary and priced the
prefix-cache break [M, `stats/eviction-grid-replay.mjs`]:

| resident cap | input avoided | ideal-`$` saved | **net `$` saved** | refetch |
|---|---:|---:|---:|---:|
| 24K | 23.6% | +10.6% | **+1.5%** | 27% (lossy) |
| 32K | 15.2% | +7.7% | **−12.3%** | 23% |
| 40K | 8.5% | +4.1% | **−15.1%** | 11% |
| 48K | 2.7% | +1.5% | **−6.6%** | 0% |

Across all 17 tasks every cap is net-negative. The cache-normalised column reports a clean win for
a policy that loses money. **This is exactly the failure mode the published pruning results are
exposed to, and none of them price it.**

Two 2026 sources now state the mechanism without the arithmetic. "Don't Break the Cache"
(arXiv 2601.06007, PricewaterhouseCoopers, v2 2026-01-31) writes: *"Techniques such as summarizing
or pruning old tool calls break cached representations, making tool call caching counterproductive.
The emerging pattern is to maintain a stable system prompt that benefits from caching while treating
tool calls as dynamic content"* [W]. Masking Stale Observations notes in related work that
*"ReSum requires rolling summarization that increases intermediate computation and can reduce
KV-cache reuse"* [W].

"Don't Break the Cache" also **independently confirms our preamble finding**. Over 500 agent
sessions on DeepResearch Bench with 10,000-token system prompts, four flagship models, n=40 per
condition, caching cut cost by 41–80% and time-to-first-token by 6–31%. Their Table 2 shows the
three cache strategies within 2–4 percentage points of each other, and they conclude *"the system
prompt, which is cached in all strategies, drives the majority of cost savings"* [W]. Our
`resend-census` found the same shape from the other side: 59% of the re-send tax is the fixed
preamble and it is un-evictable by construction [M].

### 2.4 The regime map says our backbone is in the wrong corner

Masking Stale Observations sweeps backbones from 4B to 284B parameters and three retrievers, and
finds an asymmetric inverted-U [W]:

- weak retriever → a plateau, +6 to +7 points;
- strong retriever with a mid-capacity model → the sweet spot, +11.7 points;
- **saturated model → collapse, ≤0 points.**

Their explanation is mechanical, not hand-waved. Self-generated reasoning takes 53.7% of the
per-step attention budget against 25.6% for tool observations. Observation attention reaches 65% of
its total inside the most recent 10% of past turns, then pins near 0.7% [W]. Their conclusion:
*"Future engineering should therefore pivot from aggressive heuristic pruning toward high-fidelity
retrieval."*

That sentence is a literature endorsement of what sweet-search is, and a warning against what the
pruning family sells.

### 2.5 The one admissible residue

The whole family is **retroactive**: it deletes content that is already in the prefix. Under our
price vector that is always a cache break. The **prospective** form — deciding how much to append
*before* the tool result enters the context — carries no break at all. That form is already on the
register as B13 (payload budgeting by lifetime, PARKED) and B14 (adaptive query-conditioned read
budgeting, OPEN). CoACT (2607.02911) is the first paper I found that operates at append time [W],
which makes it the right citation for B14 rather than SWE-Pruner.

**Register verdict: this section does not revive B1, B5 or B7. It explains why they died and
supplies the citation that stops the next agent from re-proposing them.**

---

## 3. Agentic search for agents: grep, semantic search, LSP, and delegation

Doc 07 covered the papers. It did not cover the industry evidence, and the industry evidence points
the other way on one axis.

### 3.1 The only controlled online A/B of semantic search

Cursor, *"Improving agent with semantic search"*, 2025-11-06, by Stefan Heule, Emily Jia and Naman
Jain [W]. Two measurements:

- **Offline**, on their own Cursor Context Bench: semantic search plus grep beats grep alone by
  **12.5% higher accuracy on average, 6.5% to 23.5% depending on the model.**
- **Online A/B**, same model both arms, one arm grep-only: **code retention +0.3% overall, rising
  to +2.6% on codebases with 1,000 files or more**, and **2.2% more dissatisfied follow-up requests**
  when semantic search was absent.

They report no cost or latency numbers. They state that semantic search complements grep rather
than replacing it.

This qualifies doc 07 §2.1 and register E8. E8 records semantic search as NEGATIVE with a "+6% to
+118% token premium". Cursor's result is not a contradiction; it is a *conditioning variable*. The
effect is small in general and material only above about 1,000 files.

### 3.2 New measurement — our pool sits below that line

I counted git-tracked files in the golden checkout of every fresh-pool repository [M,
`git -C <golden> ls-files | wc -l` on the box, 2026-09-02].

The 22 fresh-pool tasks use 21 distinct repositories (`bfgroup__b2` supplies two tasks). Counts:

```
19  22  26  57  62  63  75  194  231  273  310  317  377  444  555  600  897  951  972  1326  1475
```

- median **310** tracked files
- mean **440**
- **2 of 21 (9.5%)** reach 1,000 files: `locationtech__jts` (1,475) and `mathnet__mathnet-numerics` (1,326)
- 7 of 21 (33%) reach 500 files

**Implication.** On the only published controlled A/B, the retrieval advantage sweet sells is worth
+0.3% of code retention at our pool's size and +2.6% at ten times it. That is consistent with our
own null (120/198 against 125/198, `p ≥ 0.72`) and it means the pool, not the product, may be the
binding constraint on ever measuring a retrieval win. This is a pool-design finding, not a lever.

### 3.3 Cognition's SWE-grep — the shape that actually pays

Cognition, *"Introducing SWE-grep and SWE-grep-mini"*, 2025-10-16, by Ben Pan, Carlo Baronio, Albert
Tam, Pietro Marsella, Mokshit Jain, Daniel Chiu, Swyx and Silas Alberti [W]. Facts with numbers:

- *"agent trajectories were often spending >60% of their first turn just retrieving context"*
- the retrieval model issues **8 parallel tool calls per turn in a maximum of 4 turns** (3 explore, 1 answer)
- SWE-grep-mini runs at **>2,800 tokens/second**, SWE-grep at **>650**, against Haiku 4.5 at 140 — **20× and 4.5×**
- they deliberately do **not** use embeddings: results *"can be inaccurate, especially for complex queries"* and can be *"counterproductive, as the agent can give too much weight to irrelevant information"*

Two things follow for us. First, the industry's answer to retrieval cost is **to move retrieval off
the main thread**, not to compress the main thread. Second, the parallel-call count is the lever
they bought with reinforcement learning, which is exactly the axis our register closed for
prompt-steering (A1, dead four times; A2 `ss-batch` called 0 times in 198 opencode rollouts).
SWE-grep is evidence that A1's kill is backbone-scoped, not universal, and that the revival
condition already written on A1 — "a backbone trained for parallel emission" — is the right one.

### 3.4 New measurement — claude-code native does not use `Grep` at all

I ran a tool-name histogram over every transcript of the primary claude-code fresh-pool run
[M, `fp-claudecode-tab-20260826`, 182 transcript files, 132 rows = 22 tasks × 3 reps × 2 arms].

| tool | native | sweet |
|---|---:|---:|
| `Bash` | 931 | 1,524 |
| `Read` | 1,299 | 143 |
| `Edit` | 308 | 284 |
| `Explore` | **60** | **12** |
| `Agent` | 33 | 11 |
| `Grep` | **0** | **0** |
| `Glob` | **0** | **0** |
| `Write` | 8 | 6 |

The runner recognises `Grep` and `Glob` and maps them to its `nativeGrep` counter [C,
`claude-code-task-runner.mjs:150`]. The model never called them. Native's structured search surface
in this run is `Explore`, which is Claude Code's delegated search agent — the same shape as
Cognition's SWE-grep. Its result is a short prose finding with `path:line` pointers; I read two
verbatim bodies to confirm the shape [M].

**`Explore` leaves no transcript and no usage record.** Total `Agent` tool calls across both arms:
44. Total `subagents/*.jsonl` transcript files: 44. Sessions where the two counts differ: **0** [M,
per-session comparison on the box]. `isSidechain:true` records appear 0 times in main transcripts
and 2,888 / 1,497 times inside subagent transcripts (native / sweet) [M]. The accounting reads
sidechain turns only from `<session>/subagents` [C, `claude-code-accounting.mjs:220`]. Sidechain
accounting is marked complete on **38 of 66** native rows and **57 of 66** sweet rows [M,
`rows.json`].

**Implication for sweet on claude-code.** The register's G6 says native's cost is a lower bound
because 205 delegated requests carry no usage. That understates the problem. Sixty `Explore`
launches produce no record of any kind, against sweet's twelve, so the omission is arm-asymmetric
by 5:1 in native's favour. The published claude-code figure (sweet `−3.9%`) is therefore
conservative: counting native's hidden search spend can only widen sweet's lead. This does not
change a solve count and it is not a lever. It is a correction to the ledger's disclosure.

### 3.5 The LSP question has moved since doc 07

Claude Code shipped a **native Language Server Protocol tool in v2.0.74 (December 2025)** with
go-to-definition, find-references and hover, across 11 languages, previously behind
`ENABLE_LSP_TOOL=1` [W]. Doc 07 treats LSP-versus-grep purely as a paper (2608.13568). It is now a
shipped native affordance on one of our three harnesses.

I found **zero** occurrences of any LSP tool name, `language server`, `goToDefinition`,
`findReferences` or `ENABLE_LSP` in the whole claude-code fresh-pool transcript tree [M]. So the
tool was not exercised in our run. That is worth recording, because sweet's `ss-trace` competes
with it in principle and did not compete with it in fact.

Supporting industry position: *"Why Coding Agents Still Use grep as Their Search Backbone"*
(yage.ai, 2026-03-27) records Cursor observing single ripgrep calls exceeding 15 seconds in large
monorepos, and responding with sparse n-gram indexing rather than semantic search; and Anthropic's
Boris Cherny stating that Claude Code's agentic search "is really just glob and grep, and it
outperformed RAG" [W]. Zach Nussbaum's *"On the Lost Nuance of Grep vs. Semantic Search"*
(2025-11-14) reports that grep plus LLM-generated keywords gave nearly a 10× improvement over grep
alone on Natural Questions [W].

---

## 4. Speculative and predictive prefetch of the next tool call

### 4.1 Three 2026 systems, and what they buy

| work | id / date | claim |
|---|---|---|
| PASTE — Act While Thinking | arXiv 2603.18897, 2026-03-19 | mines control-flow patterns, pre-executes predicted tool calls on slack resources: average task time **−48.5%**, p95/p99 tool latency −59.3% / −60.6%, tool-wait −67%, Top-1 accuracy 27.8%, Top-3 recall 43.9%, overall hit rate 93.8% [W] |
| Speculate While You Reason | arXiv 2607.25816, 2026-07 | one model acts and predicts its own next call; joint agent-speculator RL lifts next-call Hit@1 from 44.1 to 61.2 (Qwen3-4B) and 48.9 to 66.3 (Qwen3.5-4B) [W] |
| SPORK | arXiv 2607.03333, 2026-07 | self-speculative forking to accelerate agentic inference [W] |

**All three buy wall-clock latency and none buys tokens.** PASTE states that tool execution is 35%
to 61% of total request time and that speculation hides that idle time; the model requests and token
counts are unchanged [W]. Speculate While You Reason requires joint reinforcement learning on the
backbone, which we do not control.

**Conclusion: prefetch as published is inadmissible here. Our metric is dollars, and the solve is
the veto. Latency is neither.**

### 4.2 The one cost-relevant form, and the arithmetic nobody has done

A prefetch pays in dollars only if it **removes a request**: the wrapper predicts the next call and
returns both results in one tool output. That is search-to-read fusion, register A3, marked
RETIRED / CLOSED.

Two facts make the closure worth re-reading, not re-opening on my own authority.

**Fact 1 — A3's economics were fitted on a different backbone.** `stats/w0b-fusion-economics.mjs`
says in its own header that coefficients are *"fit EMPIRICALLY from the DB's per-turn token/cost
ledger (Grok-4.5 via openrouter)"* [C]. The Gate 0 report says the same in words: *"retired Grok DB,
NOT a Luna measurement"* [M]. That distribution has a resident median of 38,715 tokens and 26 turns
remaining, against luna's 24,554-token mean over about 11.6 requests [M, Gate 0]. Remaining turns is
precisely the axis that prices a *wrong* fusion, because the useless body is re-sent for every one
of them. **The closure is scoped to a backbone whose wrong-fusion penalty is roughly twice ours.**

**Fact 2 — the break-even is low.** Saving one request is worth `$0.00063` on codex, `$0.00048` on
opencode and `$0.00070` on claude-code [M, doc 06 §8]. A wrongly fused 1,500-token body appended
with 10 turns remaining costs `1500 × ($0.10 + 10 × $0.01) / 10^6 = $0.00030` [I]. Break-even
precision is `waste / (saving + waste)`: **32% on codex, 38% on opencode, 25% on claude-code** [I].

A predictor that is right one time in three pays on codex. Nobody has measured our search-to-read
precision on luna. `stats/search-read-replay.mjs` already reproduces the adjacency and is `$0`.

**Register check.** This is A3 with a gate in front of it, priced on the current backbone. It is not
A2 (`ss-batch`), because nothing is asked of the model. Re-opening a CLOSED class needs the owner's
call.

---

## 5. Edit-tool design: content-hash anchors

### 5.1 The measurement doc 05 does not have

Can Bölük, *"We improved 15 LLMs at coding in one afternoon. Only the harness changed."*,
2026-02-12 [W]. Benchmark: React Edit Benchmark, **180 tasks per run, 3 runs per model, 16 models**,
mutations injected into the React codebase (operator swaps, boolean flips, off-by-one) that the
model must repair. Total spend `~$300`, training compute `$0`.

Three edit formats: OpenAI-style **patch**, **str_replace**, and **hashline**.

Hashline read side, literally:

```
1:a3|function hello() {
2:f1|  return "world";
3:0e|}
```

Write side: the model names anchors — replace line `2:f1`, or replace the range `1:a3` through
`3:0e`. It never reproduces the old text. Hashes are computed after whitespace normalisation, so
tab-versus-space differences do not break them, and a changed file rejects the edit before it
touches disk.

Results [W]: hashline beats patch on **14 of 16 models**, average **+15 points**. Largest gains:
Grok Code Fast 1 **6.7% → 68.3%**, GPT-5.1 Codex Mini **60.0% → 77.5%**. Output tokens fall by
17% to 61% on nine models. **The two exceptions are the two strongest models in the set**: GPT-5.2
Codex gains only +4.6 with output tokens **+26%**, and DeepSeek V3.2 loses **−5** with output tokens
**+20%**.

Independent industry statement of the same mechanism: Robert James Kaes, *"Claude Code's Edit Tool
Wastes Your Most Expensive Tokens"* (2026-03-04), announcing the trueline MCP server. Claim:
*"For a typical 15-line edit, that's ~200 wasted output tokens"* echoing `old_string`, plus
ambiguity padding, plus re-read cycles after a failed match [W]. No controlled benchmark.

**No harness has adopted this natively.** As of the Claude Code changelog through 2026-08-31, hash
anchors exist only as third-party MCP servers and skills (`quangdang46/hashline`, `trueline`,
`hex-line`), and as an open feature request on `anthropics/claude-code` [W].

### 5.2 The arithmetic for us

**Prize.** Fumbled edit turns, measured whole-episode [M, `W0-P7-GATE-RESULTS.md` F4]:

| harness | arm | turns lost | cost | share of arm |
|---|---|---:|---:|---:|
| codex | sweet | 0 | `$0.000000` | 0.0% |
| opencode | sweet | 4 | `$0.002451` | 1.2% |
| claude-code | sweet | **32** | **`$0.056597`** | **13.4%** |
| claude-code | native | 15 | `$0.028661` | 7.0% |

Of claude sweet's 32 fumbles, 28 are addressing failures (20 string-not-found, 6 wrong path, 2
degenerate payload) [M]. Ceiling: `13.4% × 28/32 = 11.7%` of the claude-code sweet arm [I].

**Cost.** A hashline read gutter is not free. Measured per-line token overheads on the 3,052-line
corpus [M, doc 05 §3.1]: none 8.516 tokens/line; `N<TAB>` +1.481; `N:` +2.187. Hashline adds a
two-character hash and a pipe on top of `N:`, which I estimate at **+3.9 to +4.5 tokens per line**,
that is **2.6× to 3.0× the shipped tab** [I — I had no tokeniser available locally, see §10]. The
tab gutter costs 0.75% / 1.56% / 0.90% of a rollout on codex / opencode / claude-code [M, doc 05
§3.5]. So the incremental read-side cost is:

| harness | prize | hashline read-side cost | **net** |
|---|---:|---:|---:|
| codex | 0.0% | +1.2 to +1.5 pp | **−1.2 to −1.5 pp** |
| opencode | 1.2% | +2.5 to +3.1 pp | **−1.3 to −1.9 pp** |
| claude-code | 11.7% | +1.4 to +1.8 pp | **+9.9 to +10.3 pp** |

**Content-hash anchors are a pure loss on codex and opencode and are worth about ten percent of the
arm on claude-code.** That asymmetry is not a delimiter choice, so register C3's overturn does not
apply: a hash carries information the tab does not. C4's cost bound does apply, and it is the reason
the two cheap harnesses lose.

**Two vetoes.** First, hashline's gains concentrate in weak models, and the two strongest models in
Bölük's set lost. Our backbone already fails anchors at 5.9% (TAB) against native's 7.4% [M, brief
§1.1], which is the low-headroom corner. Second, the write side is harness-owned. Reaching it needs
either a new `ss-edit` tool (owner rule 11) or an MCP server (owner decision of 2026-07-31). Both
need a user decision. This is register D1, with a new mechanism and new arithmetic attached.

---

## 6. Where agent cost goes: vendor harness-engineering reports

### 6.1 Anthropic's three 2025 posts, and the regime they are written for

| post | date | number |
|---|---|---|
| Effective context engineering for AI agents | 2025-09 | qualitative: just-in-time context, compaction, structured note-taking, sub-agents [W] |
| Code execution with MCP | 2025-11-04, Adam Jones and Conor Kelly | one workflow **150,000 → 2,000 tokens, −98.7%** [W] |
| Introducing advanced tool use | 2025-11-24, Bin Wu et al. | Tool Search Tool: **−85% tokens** on 50+ MCP tools worth ~72,000 tokens; accuracy 49% → 74% (Opus 4) and 79.5% → 88.1% (Opus 4.5). Programmatic tool calling: **43,588 → 27,297 tokens, −37%**; accuracy 25.6% → 28.5% and 46.5% → 51.2%. Tool use examples: accuracy 72% → 90% [W] |

**The regime is 50 to 100 times ours.** Anthropic's tool definitions weigh about 72,000 tokens. Our
tool guide weighs **1,457 tokens** [M]. The ratio is 49×.

### 6.2 New kill — progressive disclosure of the tool guide loses on every harness

The obvious transfer of Anthropic's Tool Search idea is: put a two-line pointer in `AGENTS.md`, and
let the agent fetch the full guide when it wants it. That loses, and the arithmetic is `$0`.

Inputs, all measured: the guide costs `$0.000417` (codex, 3.4% of the rollout), `$0.000408`
(opencode, 4.4%) and `$0.000511` (claude-code, 3.1%) when resident for the whole rollout [M, doc 06
§8]. One request costs `$0.00063`, `$0.00048` and `$0.00070` on the same three [M, doc 06 §8].

A deferred fetch pays one extra request **plus** the guide's tokens resident from the fetch turn
onward, which is about half the always-on cost:

| harness | always resident | deferred: 1 request + half-resident | ratio |
|---|---:|---:|---:|
| codex | `$0.000417` | `$0.00063 + $0.000209 = $0.000839` | **2.0×** |
| opencode | `$0.000408` | `$0.00048 + $0.000204 = $0.000684` | **1.7×** |
| claude-code | `$0.000511` | `$0.00070 + $0.000256 = $0.000956` | **1.9×** |

**Progressive disclosure costs 1.7 to 2.0 times what always-resident costs, on every harness, even
if the guide is fetched exactly once.** [I on M inputs] It is dead. This entry did not exist on the
register; it is the nearest neighbour of B2 (trim, CLOSED) and B3 (drop, PROPOSED-NOT-RUN).

### 6.3 New candidate — the guide is worth exactly one request, so deliver it per harness

The same two numbers give a sharper framing of B3 than "drop it and measure".

**The tool guide costs about one request per rollout.** `$0.000417` against `$0.00063`;
`$0.000408` against `$0.00048`; `$0.000511` against `$0.00070`. So the guide pays for itself only if
it removes at least one request. Measured:

- **claude-code:** the guide's no-delegation behaviour is worth `$0.001529 = 7.5%` of a rollout [M,
  doc 06 §8], and sweet delegates in 6 of 22 cells against native's 15 [M]. The guide pays about
  three times over. **Keep it.**
- **codex:** sweet issues the **same number of requests** as native [M, brief §1.1]. The guide buys
  no requests. It costs 3.4% for nothing measured.
- **opencode:** sweet issues **+3.4 requests, +10.2%** against native [M, brief §1.1]. The guide is
  a 4.4% surcharge on an arm that is already losing requests.

**A harness-conditional guide is sweet-only, changes which content is delivered, and is not on the
register.** It is not B2 (that trimmed redundancy inside the guide, netting 23 tokens) and not B3
(that dropped it everywhere). Vehicle: `scripts/inject-agent-instructions.js` at `init` time, which
already knows the harness. Production also has `detectAgentEnv()` in
`core/search/output-policy.js` [C]. Flags: `needs_user_decision` — the owner protects the guidance
block, and B3's conflict with owner scope applies to any removal.

### 6.4 Cognition on delegation, against our F15

Cognition, *"Don't Build Multi-Agents"* (2025) [W]: *"running multiple agents in collaboration only
results in fragile systems because the decision-making ends up being too dispersed and context isn't
able to be shared thoroughly enough between the agents"*, with a recommendation for a
single-threaded linear agent. That is the industry statement of our register F15, which rejected
delegation for sweet because native's delegation is native's problem and sweet's win is not needing
it. Doc 06 §8 prices that win at 7.5% of a claude-code rollout [M]. **No change; a supporting
citation.**

### 6.5 OpenAI

`https://openai.com/index/unrolling-the-codex-agent-loop/` returned HTTP 403 to my fetch. Secondary
coverage reports the same two mechanisms doc 06 already documents from the binary: compaction above
a token threshold, and strict prefix caching on the Responses API where *"the old prompt must be an
exact prefix of the new prompt"* [W, secondary]. I did not rely on it. See §10.

---

## 7. Bash-only agents against tool-rich agents

This is the axis our two arms actually differ on. Sweet is Bash-only `ss-*` wrappers; native on
opencode and claude-code has structured tools that can be emitted in parallel.

### 7.1 mini-SWE-agent

`SWE-agent/mini-swe-agent`, README as of 2026-09 [W]: *"Does not have any tools other than bash — it
doesn't even need to use the tool-calling interface of the LMs"*, every action runs through
`subprocess.run`, the history is strictly linear, and it *"scores >74% on the SWE-bench verified
benchmark"*. The project's stated reason is that models got good enough that scaffolding stopped
paying.

### 7.2 The controlled crossed ablation, which is new since doc 07

*"When Does Restricting a Coding Agent to `execute_code` Help? A Regime × Agent-Design Ablation"*,
Hong Yang, Qi Yu, Travis Desell (Rochester Institute of Technology), arXiv 2607.10569, 2026-07-12,
SE 3.0 workshop at KDD 2026 [W]. This is the first study I found that crosses tool surface with task
regime on **our two harnesses**.

Arms: baseline default tools; bash-only (shell plus read/grep/glob, no Edit/Write); code-only (a
single `execute_code` MCP tool). Harnesses: **Claude Code 2.1.139 with claude-sonnet-4-6, and
OpenAI Codex CLI with gpt-5.5**. Tasks: 93 computation tasks and 100 SWE-bench Mini instances, three
seeds per cell.

Results that matter to us [W]:

| cell | pass-rate delta | cache-adjusted cost delta | note |
|---|---:|---:|---|
| SWE-bench / Codex | +0.33 pp (p=0.697) | **−19.91% (p=2.0×10⁻⁹)** | input tokens −24.80%; tool calls 22.9 → 17.1 |
| SWE-bench / Claude | −1.67 pp (p=0.465) | **+14.44% (p=0.120)** | output tokens **+39.86% (p<10⁻⁹)** |
| Artifact / Claude | −0.00 pp | −24.60% (p=7.4×10⁻¹⁴) | |
| Artifact / Codex | +2.51 pp | −6.70% (NS) | |

Their two mechanisms are, word for word, our two measured per-harness drivers.

- **Batching.** *"execute_code issues 17.1 calls per run vs. 22.9 for baseline"* on codex — one
  envelope carrying several operations. Our codex arm does the same: doc 05 and the fresh-pool
  report both note codex packs several shell operations into one envelope.
- **Edit friction.** On Claude, *"every file modification must be expressed as a Python script"*,
  and the per-instance correlation between edit volume and cost is ρ=0.488 (p<10⁻⁶). Cost rises with
  output volume, not with a fixed overhead.

They also report **capability invariance**: *"Pass rates differ by less than three percentage points
across all four cells"* and unanimous-outcome instances are ≥91% of every cell. **Tool surface
changes the path and the cost, not the answer.**

### 7.3 What this predicts for sweet, per harness

- **codex:** a Bash-only surface that batches is where the published win is, and it is large
  (−19.9%). Our codex sweet arm already lives there and still reads `+0.3%`. The difference is that
  our Bash arm carries a 3.4% guide and a 0.75% gutter it does not earn back. That is consistent
  with §6.3.
- **claude-code:** their code-only arm *lost* 14.4% on SWE-bench, driven by +39.9% output tokens
  from expressing edits as scripts. Our sweet arm on claude-code keeps the native `Edit` tool, so it
  avoids that penalty — and this is a concrete reason not to route claude-code edits through a Bash
  `ss-edit` unless it is anchor-based rather than script-based. It is an argument for §5's hashline
  form and against a generic shell editor.
- **opencode:** not covered by their study. Our own measurement stands: native emits 1.55 tool calls
  per request against sweet's 1.11, so sweet pays +3.4 requests = +10.2% [M, brief §1.1].

**Register check.** This does not revive A1 or A2. It supplies the missing external evidence that a
Bash-only surface is *cost-competitive when it batches* and *cost-negative when it turns edits into
scripts*. It also strengthens the motivation recorded against A4 (structured tool surface,
OWNER-EXCLUDED), because parallel emission is the opencode driver and A4 is the only vehicle for it.

---

## 8. Candidate seeds

Each states mechanism, harnesses, vehicle, whether it is sweet-only, ceiling with arithmetic, the
cheapest `$0` falsifier with a pre-registered kill condition, build cost, and register check.

### S1 — Harness-conditional tool guide

- **Mechanism.** Deliver the 1,457-token tool guide only on claude-code. On codex and opencode,
  write `ss-*` onto PATH without the guide.
- **Harnesses.** codex, opencode (removal); claude-code unchanged.
- **Vehicle.** `scripts/inject-agent-instructions.js` at `init`. Sweet-only: native never sees the
  guide.
- **Ceiling.** −3.4% of a codex sweet rollout and −4.4% of an opencode sweet rollout [M, doc 06 §8].
  That is larger than the whole measured sweet-versus-native gap on both (+0.3% codex, +3.3%
  opencode).
- **`$0` falsifier.** In the codex and opencode fresh-pool traces, count `ss-*` invocations that use
  a flag or a form taught only by the guide (`--in`, `--json`, span arguments, `sufficient=`
  reading). **Kill if more than 20% of `ss-*` calls depend on guide-taught syntax**, because removal
  would then break tool use rather than save tokens.
- **Solve risk.** Real. The guide carries measured behaviour. Any live test must be paired and must
  read solves first.
- **Build cost.** Small: one conditional at init.
- **Register check.** Nearest are B2 (trim, CLOSED) and B3 (drop everywhere, PROPOSED-NOT-RUN).
  Different because the vehicle is per-harness and the claude-code delivery, which is the only one
  with a measured payoff, is kept.
- `new_tool: false` · `needs_user_decision: true`.

### S2 — Precision-gated search-to-read prefetch

- **Mechanism.** When `ss-search` or `ss-grep` returns and a predictor says the next call is a read
  of the top result, append that span to the same tool output. One request disappears.
- **Harnesses.** all three; largest on codex, where a request is `$0.00063`.
- **Vehicle.** the `ss-*` wrapper. Sweet-only.
- **Ceiling.** Break-even precision 32% codex, 38% opencode, 25% claude-code [I, §4.2]. At 60%
  precision on codex the expected value per fused search is
  `0.6 × $0.00063 − 0.4 × $0.00030 = +$0.00026`, which is 2.1% of a rollout if it fires twice.
- **`$0` falsifier.** `stats/search-read-replay.mjs` on the fresh-pool luna traces: measure
  `P(next ss call is a read of a path in the previous search's top-1)`. **Kill if precision < 40%**,
  which leaves no margin above the break-even.
- **Build cost.** Moderate; the fusion code from A3 v2 exists.
- **Register check.** This is A3, CLOSED. It differs in two ways: a precision gate, and a break-even
  computed on luna rather than on the retired Grok distribution the original economics were fitted
  to [C, `w0b-fusion-economics.mjs` header].
- `new_tool: false` · `needs_user_decision: true` (re-opening a CLOSED class).

### S3 — Content-hash edit anchors on claude-code only

- **Mechanism.** `ss-read` emits `N:hh|` on claude-code; a new `ss-edit` accepts anchor ranges and
  rejects stale anchors. The model never reproduces old text.
- **Harnesses.** claude-code only. It is a measured loss on codex and opencode (§5.2).
- **Vehicle.** `core/search/search-read.js` plus a new CLI. Sweet-only.
- **Ceiling.** +9.9 to +10.3 percentage points of the claude-code sweet arm [I on M inputs].
- **`$0` falsifier.** Two parts. (a) Tokenise the hashline gutter on the same 3,052-line corpus doc
  05 used, and replace my estimate with a measurement. **Kill if the overhead exceeds 5.0
  tokens/line**, which erases the prize. (b) Replay the 20 string-not-found failures and check that
  a normalised content hash of the intended anchor was present in the preceding `ss-read` output.
  **Kill if fewer than 14 of 20 (70%) are recoverable.**
- **Build cost.** Large. A new tool, plus a stale-anchor protocol.
- **Register check.** D1 (`ss-edit`, DEAD as C-9, OPEN as hygiene) with a specific mechanism and an
  external effect size. C4 bounds its cost. C3 does not apply, because a hash is new information,
  not a delimiter.
- `new_tool: true` · `needs_user_decision: true`.

### S4 — Repository-size stratification of the task pool

- **Mechanism.** Recruit the next pool so that repositories above 1,000 tracked files are
  represented, instead of 2 of 21.
- **Harnesses.** all three. Not a product change.
- **Vehicle.** admission. Arm-symmetric, so it is **not** a lever; it is statistical power.
- **Ceiling.** Cursor measured code retention +0.3% overall and +2.6% above 1,000 files [W]. Our
  pool median is 310 files [M].
- **`$0` falsifier.** Count candidate SWE-rebench repositories above 1,000 tracked files. **Kill if
  fewer than 30 exist**, because a stratified 22-task pool would then be unbuildable without
  repeating repositories.
- **Register check.** Nothing on the register covers pool size as a power variable. G3 covers
  admission screens for vacuity and naming lotteries, not size.
- `new_tool: false` · `needs_user_decision: true` (it changes the population the headline describes).

### S5 — Account for `Explore` in the claude-code ledger

- **Mechanism.** Capture the spend of Claude Code's `Explore` delegation, which currently produces
  no transcript.
- **Harnesses.** claude-code.
- **Vehicle.** the runner. Arm-symmetric measurement, **not a lever** — but it corrects an
  arm-asymmetric omission (60 native launches against 12 sweet).
- **`$0` falsifier.** Check whether the runner retains provider-side generation identifiers that can
  be reconciled against OpenRouter usage. **If not, this needs a paid re-run and is out of scope for
  Slate C.**
- **Register check.** Extends G6, which counts 205 unrecorded delegated requests but does not name
  `Explore` or its 5:1 asymmetry.
- `new_tool: false` · `needs_user_decision: false`.

---

## 9. Corrections to existing documents

1. **Doc 05 §3.5 used tool calls where it says turns.** It cites "turns per rollout from the
   fresh-pool report §3 (12.5 / 21.8 / 29.9)". Fresh-pool §3 is headed *"Tool calls per rollout"*
   [M, `FRESH-POOL-RESULTS.md:85–93`]. Requests per rollout are 19.6 / 19.0 / 23.4 [C, doc 06 §8].
   The gutter price on codex is therefore understated and on claude-code overstated. **The
   conclusion is unaffected**: the gutter stays under 1.6% of a rollout on every harness.
2. **Doc 07 L9 needs a size condition.** "Semantic code search as a general replacement for grep —
   NEGATIVE" is right in general and incomplete. The only published controlled online A/B finds the
   benefit conditional on repository size, and our pool sits below the threshold [W][M].
3. **Register G6 understates the claude-code accounting gap.** The unrecorded surface is not only
   205 requests; it is a whole tool, `Explore`, launched 60 times by native and 12 by sweet, with
   zero transcripts [M].
4. **Register A3's closure is backbone-scoped.** Its economics were fitted on the retired Grok
   opencode database [C]. The same scoping note that B1 carries should be attached to A3.
5. **Doc 06's tool-guide ranking is right and can be sharpened.** The guide is worth about one
   request per rollout, and only claude-code has a measured behaviour that earns it back [I].

---

## 10. Traps for the next agent

1. **Never quote a published pruning number without asking how re-sent tokens were priced.** The
   Complexity Trap's cost model treats cache hits and misses identically [W]. Halving a no-cache
   bill is not halving ours.
2. **`idealCost` is blind to cache breaks.** Any lever that deletes, reorders or rewrites context
   must be read on `breakPricedCostUsd`. Gate 0 reported +10.6% on the cache-normalised column for a
   policy that loses 12.3% [M].
3. **A tool the model never calls is not the same as a tool it does not have.** `Grep` and `Glob`
   were available on claude-code and were called zero times [M][C].
4. **Counting subagent transcript files does not count delegation.** `Agent` writes a file;
   `Explore` does not [M].
5. **Web summarisers invent numbers for PDFs.** The first fetch of arXiv 2606.00408 returned round
   figures ("~5-15%", "~10-25%") that do not appear in the paper. The paper's real numbers are +6 to
   +7, +11.7 and ≤0 points [W, read from the PDF]. Read the pages.
6. **Hashline's effect size is inversely proportional to baseline edit reliability.** The two
   strongest models in Bölük's set gained nothing and spent 20–26% more output tokens [W]. Our
   anchor-failure rate is already low.
7. **`Explore` returns a prose finding, not a payload.** Comparing sweet's byte counts against
   native's on claude-code without accounting for `Explore` compares different things [M].

---

## 11. What I could not finish

- **The hashline gutter cost is an estimate, not a measurement.** No tokeniser is installed locally:
  `import tiktoken` fails and `gpt-tokenizer` is absent from `node_modules` [M]. Doc 05's
  `scripts/r1-gutter-tokens.py` and its five fixture files live on the box. The `+3.9 to +4.5
  tokens/line` figure in §5.2 is bracketed by measured neighbours (`N:` at +2.187) and should be
  replaced before anyone spends against it.
- **`https://openai.com/index/unrolling-the-codex-agent-loop/` returned HTTP 403.** I used only
  secondary coverage and relied on nothing from it.
- **CoACT (2607.02911) numbers are in image-embedded tables.** I could not extract the token or cost
  reductions. It is cited for its append-time mechanism only.
- **CommitKV (2608.07855) publishes no numbers in its abstract.** Listed for completeness.
- **I could not verify a widely repeated claim** that mini-SWE-agent matched or beat native harnesses
  at comparable token cost on a small task slice (quoted as 50% versus 40% for one model, 40% versus
  40% for a second, 40% versus 20% for a third). No primary source surfaced in four searches. **Do
  not cite it.** The verified bash-only evidence is mini-SWE-agent's own >74% claim and arXiv
  2607.10569's crossed ablation.
- **I did not price `Explore`.** Its spend is absent from the results tree, so the size of the
  claude-code lower-bound gap remains unknown.
- **I did not open HO2 and did not read any grading log.** No hidden test name or gold patch content
  appears above.

---

## 12. Sources

Every item carries the date or version I read.

**Papers**

| topic | work | id | date read as | URL |
|---|---|---|---|---|
| observation masking | The Complexity Trap | 2508.21433 | v1 2025-08-29, v3 2025-10-27, DL4C @ NeurIPS'25 | https://arxiv.org/abs/2508.21433 |
| trajectory reduction | AgentDiet — Improving the Efficiency of LLM Agent Systems through Trajectory Reduction | 2509.23586 | v1 2025-09-28, FSE 2026 | https://arxiv.org/html/2509.23586v1 |
| context compression | ACON | 2510.00615 | 2025-10-01 | https://arxiv.org/abs/2510.00615 |
| context folding | Scaling Long-Horizon LLM Agent via Context-Folding | 2510.11967 | 2025-10 | https://arxiv.org/abs/2510.11967 |
| context folding | AgentFold | 2510.24699 | 2025-10 | https://arxiv.org/abs/2510.24699 |
| SWE-agent context | Context as a Tool | 2512.22087 | 2025-12-26 | https://arxiv.org/html/2512.22087v1 |
| observation compression | CoACT | 2607.02911 | 2026-07 | https://arxiv.org/pdf/2607.02911 |
| masking regime map | Masking Stale Observations Helps Search Agents — Until It Doesn't | 2606.00408 | v1 2026-05-29 | https://arxiv.org/pdf/2606.00408 |
| cache-aware compression | CommitKV | 2608.07855 | 2026-08-08 | https://arxiv.org/abs/2608.07855 |
| prompt caching economics | Don't Break the Cache | 2601.06007 | v2 2026-01-31, preprint 2026-02-03, PricewaterhouseCoopers | https://arxiv.org/pdf/2601.06007 |
| tool-surface ablation | When Does Restricting a Coding Agent to `execute_code` Help? | 2607.10569 | 2026-07-12, SE 3.0 @ KDD 2026 | https://arxiv.org/html/2607.10569v1 |
| speculative tool execution | PASTE — Act While Thinking | 2603.18897 | 2026-03-19 | https://arxiv.org/html/2603.18897v1 |
| speculative tool prediction | Speculate While You Reason | 2607.25816 | 2026-07 | https://arxiv.org/abs/2607.25816 |
| speculative forking | SPORK | 2607.03333 | 2026-07 | https://arxiv.org/html/2607.03333v1 |
| survey index | Awesome-Agent-Context-Compression | — | read 2026-09-02 | https://github.com/YerbaPage/Awesome-Agent-Context-Compression |

**Industry and vendor**

| topic | source | date | URL |
|---|---|---|---|
| semantic search A/B | Cursor — Improving agent with semantic search (Heule, Jia, Jain) | 2025-11-06 | https://cursor.com/blog/semsearch |
| parallel agentic retrieval | Cognition — Introducing SWE-grep and SWE-grep-mini | 2025-10-16 | https://cognition.com/blog/swe-grep |
| delegation | Cognition — Don't Build Multi-Agents | 2025 | https://cognition.com/blog/dont-build-multi-agents |
| tool-definition cost | Anthropic — Code execution with MCP (Jones, Kelly) | 2025-11-04 | https://www.anthropic.com/engineering/code-execution-with-mcp |
| tool search / programmatic calling | Anthropic — Introducing advanced tool use (Wu et al.) | 2025-11-24 | https://www.anthropic.com/engineering/advanced-tool-use |
| context engineering | Anthropic — Effective context engineering for AI agents | 2025-09 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| edit-format benchmark | Can Bölük — We improved 15 LLMs at coding in one afternoon. Only the harness changed. | 2026-02-12 | https://stencil.so/blog/the-harness-problem |
| edit output tokens | Robert James Kaes — Claude Code's Edit Tool Wastes Your Most Expensive Tokens (trueline) | 2026-03-04 | https://www.wormbytes.ca/2026/03/04/trueline-mcp-announcement/ |
| hash-anchor ecosystem | hashline MCP server | read 2026-09-02 | https://github.com/quangdang46/hashline |
| bash-only agent | mini-swe-agent README | read 2026-09-02 | https://github.com/SWE-agent/mini-swe-agent/blob/main/README.md |
| grep as backbone | Why Coding Agents Still Use grep as Their Search Backbone | 2026-03-27 | https://yage.ai/share/why-coding-agents-still-use-grep-en-20260327.html |
| caching as harness constraint | Prompt Caching as a First-Class Constraint in Harness Engineering | 2026-04-04 | https://yage.ai/share/prompt-caching-harness-constraint-en-20260404.html |
| grep vs semantic nuance | Zach Nussbaum — On the Lost Nuance of Grep vs. Semantic Search | 2025-11-14 | https://www.nuss-and-bolts.com/p/on-the-lost-nuance-of-grep-vs-semantic |
| Claude Code LSP | Claude Code v2.0.74 changelog coverage | 2025-12 | https://news.ycombinator.com/item?id=46355165 |
| hash anchors, not adopted | anthropics/claude-code issue 25775 | read 2026-09-02 | https://github.com/anthropics/claude-code/issues/25775 |
| not reachable | OpenAI — Unrolling the Codex agent loop | HTTP 403 on 2026-09-02 | https://openai.com/index/unrolling-the-codex-agent-loop/ |

**Local and box evidence used**

- `eval/task-completion-bench/handoffs/lever3-eviction/GATE0-RESULTS.md` — re-send census and the
  cap grid with the cache-break-priced net column.
- `eval/task-completion-bench/handoffs/improve/W0-P7-GATE-RESULTS.md` §F4 — fumbled-edit turns and
  the cause table.
- `eval/task-completion-bench/handoffs/improve/FRESH-POOL-RESULTS.md` §2–3 — cost table and tool
  calls per rollout.
- `eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/05-…md` §3.1, §3.5 and
  `06-…md` §8 — per-line token costs, gutter dollars, per-turn cost and guide cost.
- `eval/task-completion-bench/stats/w0b-fusion-economics.mjs` header [C] — fusion coefficients fitted
  on Grok-4.5.
- `eval/task-completion-bench/harness/claude-code-task-runner.mjs:150` and
  `claude-code-accounting.mjs:220` [C] — `Grep`/`Glob` recognition, subagent discovery path.
- Box, read-only: `results/fp-claudecode-tab-20260826/agent-state/**` (tool histogram, `Agent`
  versus subagent-file equality, `isSidechain` counts), `results/fp-claudecode-tab-20260826/rows.json`
  (task list, sidechain completeness), `/root/.ss-eval/golden/*` (`git ls-files` counts).

**Reproduction of my own measurements**

```bash
# tool-name histogram, claude-code fresh pool (both arms)
R=/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/agent-state
for a in native sweet; do
  find $R -path "*-$a/*" -name '*.jsonl' | xargs grep -oh '"name": *"[A-Za-z_]*"' \
    | sort | uniq -c | sort -rn | head -12
done

# Agent calls versus subagent transcript files, per session
tot_a=0; tot_f=0; mism=0
for f in $(find $R -name '*.jsonl' -not -path '*subagents*'); do
  a=$(grep -o '"name":"Agent"' $f | wc -l); d="${f%.jsonl}/subagents"; n=0
  [ -d "$d" ] && n=$(ls $d/*.jsonl 2>/dev/null | wc -l)
  tot_a=$((tot_a+a)); tot_f=$((tot_f+n)); [ "$a" -ne "$n" ] && mism=$((mism+1))
done
echo "$tot_a $tot_f $mism"      # -> 44 44 0

# repository size, fresh-pool goldens
cd /root/.ss-eval/golden
for d in <the 21 golden dirs>; do echo "$d $(git -C $d ls-files | wc -l)"; done
```
