# Competing code-context products: mechanisms, claims, and what transfers to sweet

Research task "competitor-mechanisms", Slate C, 2026-09-02.
Scope: **products**, not papers. The three existing research documents
(`05-research-editing-interfaces.md`, `06-research-cost-mechanics.md`,
`07-research-resolution-levers.md`) cover edit interfaces, harness cost internals, and the
academic resolution literature. This document covers what shipping competitors do, with the
version or date of every claim. Overlap is stated explicitly wherever it exists.

---

## 0. Verdict

**Every competitor that publishes a large saving from a code index measured it on
comprehension questions, not on repair tasks. The one product benchmark with a full public
method — CodeGraph, 2026-08-05 — is seven architecture questions, one per repository, and it
reports 62% fewer tokens and 44% lower cost. Our benchmark asks agents to fix issues, and on
that shape the same class of tool buys us +0.3% / +3.3% / −3.9%. The gap is the task shape,
not the index.** [W][M]

Five results follow, and they change what Slate C should and should not chase.

1. **Two of our three harnesses already ship a retrieval subagent, and neither arm ever used
   it.** OpenCode 1.18.4 has a built-in `explore` subagent whose permission set is
   `"*": "deny"` with `grep`, `glob`, `list`, `read` **and `bash`** allowed [C]. Claude Code
   2.1.218 has a built-in `Explore` agent whose model resolves to `inherit` [C]. Across the
   whole fresh pool, codex and opencode delegated **0 times in 261 rollouts** [M]. This is the
   largest unexploited harness affordance we have found, and `bash: allow` means `ss-*` tools
   run inside it.
2. **Our own tool guide taxes sweet's delegation.** The guide orders that "Any sub-agent you
   delegate to must use these `ss-*` tools, with this system prompt verbatim" [C]. On
   claude-code the measured consequence is a subagent first request of 8,542 median tokens for
   sweet against 6,108 for native [M, `06` §5.4], and sweet delegated in 9 of 66 rollouts
   against native's 28 of 66 [M]. We made our own subagents dearer and then observed sweet
   delegating less.
3. **Index-selected regression tests have no resolution headroom on this pool.** Of 153
   graded losses in the fresh pool, 132 (86.3%) never made the required failing test pass and
   only 7 (4.6%) passed every required test and still failed [M]. Those 7 land on two tasks
   that the programme has already classified as wrong-location and wrong-layer edits. The best
   published result for the mechanism (TDAD, arXiv 2603.17973v2, 2026-03-19) cuts
   pass-to-pass failures by 72% and moves resolution from **31% to 29%** [W]. Register item
   E13 should move from OPEN to effectively DEAD for resolution.
4. **An external, independent replication of our strongest resolution finding exists.** TDAD
   measured that adding procedural test-first instructions *without* a computed artifact made
   things **worse** — pass-to-pass failures rose from 562 to 799, which the paper calls "42%
   more P2P failures than vanilla", and the regression rate rose from 6.08% to 9.94% — while
   the same instructions plus a graph-derived `test_map.txt` cut failures to 155 and the rate
   to 1.82% [W]. That is our hint ladder result in another laboratory: the value is the
   computation, not the rule (F9).
5. **The canonical precomputed repo map has no published ablation and its own vendor warns it
   harms weaker models.** Aider's FAQ says the map is disabled for some models because "weaker
   models get easily overwhelmed and confused by the content of the repo map. They sometimes
   mistakenly try to edit the code in the repo map." [W] That is our B11 and B12 results,
   stated by the incumbent.

---

## 1. What is new here, against the three existing documents

I read the section headers and Verdict sections of all three documents first, and grepped all
three for every product name in my brief. Coverage found:

| existing document | product coverage it already has |
|---|---|
| `05-research-editing-interfaces.md` | §1.9 Cline (order-invariant diff apply, >10% `diffEditSuccess`) and Cursor (separate apply model). §1.5 aider **edit formats** only. §1.10 contract table. All **edit-side**. |
| `06-research-cost-mechanics.md` | one link to an Augment Code cost guide. No product mechanisms. |
| `07-research-resolution-levers.md` | academic papers only (L1–L11). No products. |

Everything in sections 2–6 below is outside that coverage, except where I say "extends" or
"corrects". I do not restate Cline's apply-side fix, Cursor's apply model, the tokeniser
study, the caching contract, or the L1–L11 paper ranking.

---

## 2. The mechanism catalogue

One row per mechanism, per product. "Measured?" asks whether the vendor published a method a
reader could check, not whether a number exists.

### 2.1 Retrieval subagents (the largest cluster, and the one with live headroom)

| product | mechanism | claim | measured? | date / version |
|---|---|---|---|---|
| **Windsurf / Devin Fast Context** (Cognition) | A retrieval **subagent** running `SWE-grep` / `SWE-grep-mini`, restricted to `grep`, `read`, `glob`; "up to 8 parallel tool calls per turn over a maximum of 4 turns" (3 exploration + 1 answer) | "up to 20x faster than traditional agentic search"; mini "over 2,800 tokens per second"; SWE-grep "over 650 tokens/second"; "4.5x faster than Haiku 4.5 at 140 tokens/second"; on SWE-Bench Verified the main agent "accomplishes the same number of tasks in significantly lower end-to-end time" | **Partly.** The published win is **wall-clock**, not tokens and not solve rate. No token or dollar figure anywhere. | blog 2025-10-16; product doc live 2026-09 |
| **Claude Code** `Explore` agent | Built-in read-only search agent. Description [C]: "Fast read-only search agent for locating code… it reads excerpts rather than whole files and will miss content past its read window. When calling, specify search breadth: `quick`, `medium`, or `very thorough`." Model resolution: `inherit`, capped at `opus` only when the provider is first-party; `CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP` overrides | none published | no | read from the deployed 2.1.218 binary on the evidence box [C] |
| **OpenCode** `explore` agent | Built-in subagent. Permissions [C]: `{"*":"deny", grep:allow, glob:allow, list:allow, bash:allow, webfetch:allow, websearch:allow, read:allow}`. Description [C]: "Fast agent specialized for exploring codebases… specify the desired thoroughness level: `quick`, `medium`, `very thorough`" | none published | no | read from the deployed 1.18.4 binary on the evidence box [C] |
| **Sourcegraph Amp** | `Task` subagents with isolated context; an `oracle` planning subagent; a `Librarian` search agent for dependency and upstream code; thread forking; thread compaction | none published | no | guide repo, live 2026 |
| **Codebuff** | Multi-agent with a dedicated **file-selection** agent | BuffBench 61% vs Claude Code 53% | **No.** BuffBench is self-authored, LLM-judged, and grades "correctness, code quality, and task efficiency" together | 2025-09-09 |

**Reading.** Every fast-context product converges on the same shape: move retrieval into a
separate context, restrict its tools, cap its turns, and return a conclusion rather than file
dumps. Two of our three harnesses already implement it, with a `quick` / `medium` /
`very thorough` breadth parameter that is nearly word-for-word identical across two vendors.

### 2.2 Precomputed repo maps and symbol outlines

| product | mechanism | claim | measured? | date |
|---|---|---|---|---|
| **aider** repo map | tree-sitter parse, file-dependency graph, graph ranking, signatures of the highest-ranked symbols, packed to `--map-tokens` (**default 1k**) | none | **No ablation exists.** The FAQ states the map is disabled for some models because "weaker models get easily overwhelmed and confused by the content of the repo map. They sometimes mistakenly try to edit the code in the repo map." | docs live 2026-09 |
| **Continue** `repo-map` provider | "a list of files and the call signatures of top-level classes, functions, and methods"; `includeSignatures` toggle. Separate `@Codebase` provider: `nRetrieve` 25 → rerank → `nFinal` 5, `useReranking` true | none | no | docs live 2026-09 |
| **Windsurf Codemaps** | agent scans the repo, resolves symbols and call paths, emits a clickable hierarchical map plus a pasteable text description | onboarding speed, no numbers | no | 2026 |
| **CodeGraph** (open source, MCP) | Rust kernel with compiled tree-sitter grammars, 20 languages direct, SQLite + FTS5 store, OS file-watcher incremental re-index with a 2 s debounce | **88% fewer tool calls, 62% fewer tokens, 44% lower cost, 53% faster, "zero file reads on all seven repos"** | **Yes, and the method is disclosed** — see 2.2.1 | re-measured 2026-08-05 |
| **DeepWiki** (Cognition) | precomputed code graph + generated wiki; "Fast mode answers immediately from a precomputed code graph with sub-second latency", Deep Research mode 20–60 s multi-hop | latency only | no | MCP at `mcp.deepwiki.com`, live 2026 |

#### 2.2.1 CodeGraph is the only product benchmark whose shape we can compare to ours

Method, verbatim from the project README [W]: **architecture questions answered by Claude Opus
4.8, one question per repository, median of 4 runs per arm**; seven repositories (VS Code
~11k files, Excalidraw ~640, Django ~3k, Tokio ~790, OkHttp ~645, Gin ~110, Alamofire ~110);
baseline is the same model "running headless with built-in Read/Grep/Bash tools available,
CodeGraph CLI blocked in both arms via a `PreToolUse` hook".

Per-repo, with and without (time / cost / tokens) [W]:

| repo | with CodeGraph | without |
|---|---|---|
| VS Code | 58 s / $0.53 / 155k | 2m10s / $1.80 / 670k |
| Excalidraw | 45 s / $0.54 / 156k | 2m42s / $2.43 / 991k |
| Django | 54 s / $0.55 / 183k | 1m23s / $0.63 / 309k |
| Tokio | 1m03s / $0.66 / 201k | 2m43s / $1.83 / 573k |
| OkHttp | 33 s / $0.39 / 107k | 58 s / $0.50 / 230k |
| Gin | 28 s / $0.31 / 87k | 46 s / $0.31 / 180k |
| Alamofire | 54 s / $0.54 / 209k | 2m22s / $1.27 / 505k |

**What this means for us, stated plainly.** The workload is one broad comprehension question
per repository with **n=1 question and 4 runs**. There is no edit, no test, no hidden
assertion, and no solve criterion. On Gin the cost is identical ($0.31 both arms) and on
Django and OkHttp the saving is small; the large savings are on the two largest and the two
Swift/Rust repositories where the baseline burned 500k–991k tokens sweeping files. Our fresh
pool never exceeded a 100,624-token context [M, `06` §0]. **A product that saves 62% of tokens
by preventing a 991k-token sweep cannot save us anything, because our agents never sweep.**
This is the cleanest external confirmation of `07`'s verdict that retrieval is a cost lever on
comprehension and not a resolution lever on repair, and it prices the cost lever: it is worth
a lot only when the baseline is unbounded reading.

### 2.3 Language-server-backed tools

| product | mechanism | claim | measured? | date |
|---|---|---|---|---|
| **Serena** (MCP) | LSP-backed symbol tools: `find_symbol`, `symbol_overview` (a file outline without the source), `find_referencing_symbols`, `find_declaration`, `find_implementations`, plus **symbolic edits** `replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol`, `safe_delete`, and LSP `rename`. 40+ languages; a JetBrains plugin adds `search_in_project_dependencies`, `type_hierarchy`, `move`, `inline` | agents report "8–12 careful, error-prone steps" collapsed into "one atomic call"; "burns noticeably fewer tokens" | **No.** No benchmark, no token number, no sample size | live 2026-09 |
| **JetBrains Junie** | uses the IDE's own semantic index: "your IDE's semantic index, build configurations, test runners, and debugger, not its own approximation of them"; symbol-aware search and rename across scopes and overloads | **61.6% resolved, 72.7% pass@5 on SWE-Rebench**, quoted to a Nebius research lead; a secondary source adds **$0.81 per problem** and 61.8% ±0.54% | **Partly** — SWE-Rebench is an independent third-party leaderboard, but the retrieval mechanism is not ablated | GA post 2026-06 |

**Relevance and the caution.** Our own task population is drawn from SWE-rebench V2 + V1
[memory `task-population`], so Junie's leaderboard is the closest external comparison we have.
But its score is a whole-product number: model routing (plan on a strong model, implement on a
cheap one), IDE index, debugger, and test runner together. It is not evidence that the index
did the work. `07`'s own primary source on this exact question (arXiv 2608.13568, full tables
fetched there) already answers it and I do not repeat it.

### 2.4 Read-with-outline and addressable continuation

This is the one place where a competitor's shipped contract is directly comparable to a
sweet-search surface, so I read both.

**Claude Code 2.1.218 `Read` truncation footer** [C, from the deployed binary]:

> `<file>: showing lines 1-<N> of <TOTAL> total (<T> tokens, cap <C>). Call <Read> with
> offset=<N+1> limit=<N> for the next page, or <Grep> to find a specific section. Do NOT
> answer from this page alone if the answer may be further in the file.`

and for files it cannot paginate by line:

> `showing the first <A> of <B> characters (<T> tokens, cap <C>); this file has very long
> lines and cannot be paginated by line.`

**sweet-search `ss-read` already has a richer version of this** [C,
`core/search/search-read.js:562-590`, `renderUnreadBelow`]:

> `# unread below (<start>-<end>): sym1, sym2 +N more — continue: ss-read <file> <start> <end>`

Ours names the symbols in the unread remainder; theirs does not. The 2026-07 design note in
the source says why: "A bare `(lines a-b of N)` marker is provably ignored by agents… naming
the symbols is what makes the remainder actionable."

**The one real difference.** Ours fires only when the *caller* asked for a range that stops
before end of file (`wantsRange && sliced.endLine < sliced.totalLines`) [C]. Theirs fires when
the *tool's own token cap* truncates. Sweet has no cap-aware trailer, so when codex's ~2,500
token output cap cuts an `ss-read` middle-out, the agent gets `…N tokens truncated…` and no
address to continue from. That is exactly register item **C9**, and this is external evidence
that the design is a shipped competitor contract rather than an invention.

**No competitor ships a whole-file symbol outline as a read mode.** Serena's
`symbol_overview` is the closest, and it is a separate tool, not a flag on read.

### 2.5 Context pruning and harness-side compaction

| product | mechanism | claim | measured? | date |
|---|---|---|---|---|
| **Anthropic API context editing** (`clear_tool_uses_20250919`) | clears old tool results server-side, after cache lookup and before token counting. Parameters: `trigger` (**default 100,000 input tokens**), `keep` (default 3 tool uses), `clear_at_least`, `exclude_tools`, `clear_tool_inputs` | the docs publish **no evaluation numbers**; secondary write-ups quote 29% / 39% / 84% but the vendor page does not | **No, at the vendor.** Treat 29/39/84 as unsourced | docs live 2026-09, beta |
| **Anthropic Tool Search Tool** | tool *definitions* are retrieved on demand instead of all being loaded into the prefix | "85% reduction in token usage"; "~77K tokens before any work begins" becomes "~8.7K tokens, preserving 95% of context window"; Opus 4.5 MCP eval **79.5% → 88.1%** | **Yes, with named evals** | 2025-11-24 |
| **Anthropic Programmatic Tool Calling** | the model writes code that calls tools in a sandbox; only the result enters context | "Average usage dropped from 43,588 to 27,297 tokens, a 37% reduction on complex research tasks"; GIA 46.5% → 51.2% | **Yes** | 2025-11-24 |
| **Cline** | Focus Chain (a todo list re-injected every 6 messages), Auto Compact, `/smol` manual compaction, `/newtask` clean handoff, Memory Bank | "a task that requires 5 million tokens of interaction can be completed using a 200k context window"; summarisation "costs about the same as any other tool call" because the prefix is already cached | **No numbers with a method** | blog 2025-08-19, v3.25 |
| **Amp** | thread forking, thread compaction, multi-level `AGENT.md` | none | no | live 2026 |

**Three things this settles at `$0`.**

1. **The vendor's own default trigger is 100,000 input tokens.** Our largest context anywhere
   in the fresh pool was 100,624 tokens and the largest claude-code context was 95,712 [M,
   `06` §0, §5.3]. Register B5 said compaction is untestable here; this makes the statement
   sharper — we sit *just under* the industry's default trigger, so no competitor's compaction
   result can transfer, and any that we build would fire on approximately one rollout.
2. **Anthropic documents the cache cost of clearing**: "Tool result clearing invalidates
   cached prompt prefixes… You'll incur cache write costs each time content is cleared." That
   is the same mechanism our own eviction gate priced and the reason the break-priced column
   (G2) exists. Our B1 conclusion is now vendor-confirmed rather than only self-measured.
3. **Programmatic Tool Calling is `ss-batch` (A2) as a provider feature.** A2 died because
   luna never called our batching CLI: deployed, called 0 times in 198 opencode rollouts. The
   same idea works when the *model provider* implements it. It is not available to
   `openai/gpt-5.6-luna` over OpenRouter, so it is dead for this bench, but it means A2's
   revival condition ("per-backbone re-screen") is a real one, not a formality.

### 2.6 "Context engine" APIs

| product | mechanism | claim | measured? | date |
|---|---|---|---|---|
| **Augment Context Engine** | semantic index over the whole codebase, real-time sync, "traces call graphs, identifies dependents across service boundaries, and surfaces cross-repo relationships"; shipped as a standalone MCP server at `https://api.augmentcode.com/mcp` usable by Claude Code, Cursor, Codex, Zed, Kilo, Roo | **SWE-Bench Pro: Auggie 51.80% (731 problems); Cursor 50.21%; Claude Code 49.75%; Codex 46.47%; SWE-Agent 45.89%** — all but Codex on Claude Opus 4.5. "Auggie solved approximately 15 more problems than Cursor and 17 more than Claude Code". **The two statements do not reconcile**: 1.59 percentage points of 731 is 11.6 problems, not 15 | **Partly.** Third-party benchmark, real problem count, but **four different whole harnesses**, not a retrieval ablation. No cost or token figures | posted 2026-02-04, updated 2026-06-18 |
| **Augment Context Lineage** | indexes recent commits on the branch — message, author, timestamp, changed files — and LLM-summarises diffs so the index stays compact | none | no | 2026 |
| **Cursor semantic search** | a **custom embedding model trained on their own agent session traces**: an LLM ranks what should have been retrieved at each step, and the embedding model is trained to match that ranking | **"on average 12.5% higher accuracy in answering questions (6.5%–23.5% depending on the model)"**; code-retention A/B **+0.3% overall, +2.6% in codebases over 1,000 files**; **"2.2% increase in dissatisfied follow-up user requests when semantic search was not available"** | **Yes** — a named internal eval set (Cursor Context Bench, size undisclosed) plus a live A/B | 2025-11-06 |
| **Nia** | vector-chunk index over codebase, docs, dependencies; 150M+ pre-indexed documents | "improves their performance by 27%" | **No.** No benchmark, no baseline, no sample size, no date. Do not cite this number | live 2026 |
| **Greptile** | agentic code review over a codebase index | 66.2% precision; 82% bug catch rate; v4 "74% more addressed comments per PR" | Third-party (Martian) leaderboard, but the product is **code review, not agent context** | 2026 |
| **Exa** `get_code_context_exa` | index over public repos, docs, StackOverflow; "token-efficient context" | none numeric | no | live 2026 |
| **Vercel Grep** (`grep.app`) | regex index over 1M+ public repositories, exposed by MCP | none | no | acquired 2024-11; "any public repo" changelog 2026 |
| **Roo Code / Kilo** codebase indexing | tree-sitter AST chunking (100–1,000 characters, large functions split at logical boundaries), embeddings from any of 8 providers, **Qdrant** store, `codebase_search` with a score threshold defaulting to **0.4** | third-party blogs claim "cuts token usage by 60–80%"; **the official docs state no number** | **No.** The 60–80% is a blog figure with no method | docs last updated 2026-05-15 |

**Two notes.** First, **Cursor's is the highest-quality context number in this whole survey**,
because it is an accuracy delta on a fixed eval plus a live A/B on real users, and it is
honest about size: the retention effect is +0.3% overall and only reaches +2.6% above 1,000
files. Their own summary is "our agent makes heavy use of grep as well as semantic search, and
the combination of these two leads to the best outcomes" — which is our own `E8` result
(semantic search as a general grep replacement is NEGATIVE) with the sign made explicit.
Second, **Augment's Context Lineage is structurally dead on our bench**: the goldens are
one-commit repositories. I verified it — `git log --oneline | wc -l` returns `1` on the first
golden checkout, and the single commit is titled `base` [M].

### 2.7 Test selection

**No shipping coding-agent product implements index-selected regression tests.** I searched
for it directly and found only QA-industry "agentic regression testing" marketing and academic
work. The relevant academic result is new and is not in `07`:

**TDAD** (arXiv:2603.17973v2, 2026-03-19). Builds a code–test dependency graph — nodes
File / Function / Class / Test, edges CONTAINS / CALLS / IMPORTS / TESTS / INHERITS, extracted
by AST analysis — and scores impacted tests by four parallel strategies (direct 0.95,
transitive 0.70, coverage 0.80, imports 0.50). It exports a **grep-able `test_map.txt`** plus
a 20-line agent skill file. Phase 1, SWE-bench Verified, 100 instances, Qwen3-Coder 30B [W,
tables fetched]:

| metric | vanilla | test-first prompt only | graph + test-first |
|---|---|---|---|
| resolution rate | 31% | 31% | **29%** |
| generation rate | 86% | 75% | 74% |
| pass-to-pass failures | 562 | **799** | **155** |
| test regression rate | 6.08% | **9.94%** | **1.82%** |

Phase 2, 25 instances, OpenCode agent, Qwen3.5-35B: resolution 24% → 32%, generation 40% →
68%, regression 0% in both arms. An auto-improvement loop on 10 instances reports that
**shortening the skill file from 107 lines to 20 quadrupled resolution, 12% → 50%**.

---

## 3. Does it transfer to us? The `$0` tests I ran

### 3.1 Test selection has no resolution headroom on this pool [M]

I classified every graded fresh-pool rollout by *how* it lost, using recorded outcome fields
only (`gradeable`, `resolved`, `f2pFrac`). No grading log was opened and no test name is
reported.

Script (run on the box, read-only, output to `/tmp/wf-slatec/competitor-mechanisms/`):
reads `results/{fp-codex-tab,fp-opencode-tab,fp-claudecode-tab}-20260826/rows.json`.

| population | count | share of losses |
|---|---:|---:|
| gradeable rollouts, three harnesses, both arms | 393 | — |
| resolved | 240 | — |
| **losses** | **153** | 100% |
| never made the required failing test pass (`f2pFrac == 0`) | 132 | **86.3%** |
| partial (`0 < f2pFrac < 1`) | 14 | 9.2% |
| **passed every required failing test and still unresolved** (`f2pFrac == 1`) | **7** | **4.6%** |

By arm: sweet 195 gradeable / 115 resolved / 3 of the 7; native 198 / 125 / 4 of the 7. The
7 collapse onto **two tasks**: six are `accenture__sfmc-devtools-1974` and one is
`awslabs__aws-embedded-metrics-node-21`. The brief already classifies both as edit-location
failures — "edit landed in the wrong method; ambiguous anchor" and "wrong layer" — not as
regressions.

**Conclusion.** A tool that eliminated every pass-to-pass regression on this pool could recover
at most 7 of 153 losses (4.6%), it would help both arms, and inspection says the true figure
is near zero. TDAD, the only measurement of the mechanism, moved resolution **down** 31% → 29%
at n=100. **Register E13 / `07` L1 should be re-verdicted: DEAD for resolution on this pool;
surviving only as a possible `run_tests` wall-clock lever, which is shared and therefore
carries zero head-to-head differential.**

### 3.2 Neither codex nor opencode ever delegated [M]

`sidechainTurns` summed over `rows.json`:

| run | arm | rollouts | rollouts with a subagent |
|---|---|---:|---:|
| `fp-codex-tab-20260826` | sweet / native | 66 / 66 | **0 / 0** |
| `fp-opencode-tab-20260826` | sweet / native | 63 / 66 | **0 / 0** |
| `fp-claudecode-tab-20260826` | sweet | 66 | 9 |
| `fp-claudecode-tab-20260826` | native | 66 | 28 |

Codex has no subagent tool, so its zero is structural. **OpenCode's zero is not**: the harness
ships an `explore` subagent, reachable through the `Task` tool's `subagent_type` parameter,
and its permission map allows `bash`, which is how every `ss-*` tool is invoked.

### 3.3 The opencode request penalty, re-measured [M]

From `fp-opencode-tab-20260826/rows.json`:

| arm | n | $/rollout | requests/rollout | tool calls/rollout | calls per request | `ss-*` calls/rollout |
|---|---:|---:|---:|---:|---:|---:|
| sweet | 63 | 0.009201 | 18.98 | 21.79 | 1.148 | 10.65 |
| native | 66 | 0.008968 | 16.32 | 25.23 | 1.546 | 0 |

Sweet does **13.6% fewer tool calls** and pays **16.3% more requests**. The published
per-rollout figure for sweet including the repair pass is $0.009265 [brief §1]; my n=63 read
is $0.009201, consistent. Average cost of one opencode sweet request: **$0.000485** [I].

### 3.4 Sweet's guide makes sweet's subagents dearer than native's [M][C]

The tool guide contains this sentence [C,
`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`]:

> "Any sub-agent you delegate to must use these `ss-*` tools, with this system prompt
> verbatim."

Measured consequence on claude-code [M, `06` §5.4]: sweet's subagent first request has a median
of **8,542** tokens against native's **6,108** — 2,434 tokens more, which is larger than the
guide itself. A subagent's first request is a fresh, uncached prefix billed at the full
$0.10/M rate. Sweet delegated in 9 of 66 rollouts; native in 28 of 66. **We wrote a rule that
raises the price of the one mechanism every fast-context competitor is built on, and then
observed our arm using it a third as often.** I am not claiming the rule caused the gap — that
is not measurable from these traces — but the price effect is measured and it is ours.

---

## 4. For each mechanism: has sweet got it, is it a flag, or is it a new tool?

`[C]` marks a claim read from our source tree.

| mechanism | sweet today | cheapest route | register nearest |
|---|---|---|---|
| Semantic + lexical hybrid retrieval | **has it** — `ss-search`, `ss-find`, `ss-grep` | — | E8 |
| Call-graph navigation (callers / callees / impact) | **has it** — `ss-trace`, `core/search/search-trace.js` [C] | — | E7 |
| Working-tree freshness (index sees uncommitted edits) | **has it**; this is Augment's headline "real-time sync" | — | E3 |
| Addressable continue span after a truncated read | **has it, but only for caller-requested ranges** — `renderUnreadBelow` [C] | **flag on `ss-read`**: make the trailer fire against the harness output cap, not only against a caller range | **C9** (DEFERRED) |
| Whole-file **symbol outline** as a read mode | **absent.** No `outline` symbol anywhere in `core/search/` [C] | **flag on `ss-read` (`--outline`)** — the index already stores per-chunk `symbol`, `type`, `startLine`, which the unread-below trailer consumes today [C]. No new indexing work | B7 (banned class) unless it changes *which* lines |
| Repository-level precomputed map (aider / Continue / Codemaps) | absent | would be a new surface | **B11 DEAD**, **B12 INVERTED**, and aider's own vendor warning |
| LSP-backed go-to-definition / find-references / rename | absent; `ss-trace` is index-derived, not language-server-derived | new tool | E7 open defect; `07` covers the measurement |
| **Symbol-level editing** (`replace_symbol_body`, `insert_after_symbol`) | absent | new tool | **D1** (`ss-edit`, owner no-new-tools rule) |
| Retrieval subagent with capped turns and a breadth parameter | absent, and **the harness already provides one on 2 of 3 harnesses** | guide text (sweet-only) or an arm-specific agent definition | **E10 DEAD live**, **F15 REJECTED on claude-code**, A4 OWNER-EXCLUDED |
| Server-side context editing / tool-result clearing | absent | not buildable by us; it is a provider feature | **B1 DEAD**, **B5 UNTESTABLE** |
| Programmatic tool calling / structural batching | **had it** — `ss-batch`, called 0 times [M] | provider feature, not ours | **A2 DEAD** |
| Commit-history corpus (Context Lineage) | absent | **structurally impossible here**: goldens are one-commit repos [M] | not on the register — add it as dead-by-construction |
| Dependency-source corpus | built and gated | — | **E5 PASSED, PARKED** |
| Index-selected regression tests | absent | — | **E13 → DEAD for resolution** (§3.1) |
| Trained retrieval embeddings from agent traces (Cursor) | absent | would be a research programme, not a lever | E8 |

---

## 5. Candidate seeds

Three, ordered by how much of the gap they could close. Each states the vehicle, the ceiling
arithmetic, the `$0` falsifier, and the register entry that most nearly kills it.

### Seed 1 — Delegate `ss-*` retrieval to opencode's built-in `explore` subagent

- **Mechanism.** OpenCode 1.18.4 ships `explore` with `bash: allow` [C]. Moving a run of
  locate-only `ss-*` calls into it removes them from the main thread, where every one of them
  is its own request because a Bash call cannot be parallel-emitted.
- **Harness.** opencode only. Codex has no subagent; claude-code already delegates and F15
  rejected more of it there.
- **Vehicle and differential.** Sweet-only if delivered through the tool guide (M±), which only
  the sweet arm receives. Sweet-only but arm-asymmetric if delivered as an opencode agent
  definition in the runner's config — that needs an owner decision.
- **Ceiling [I], from §3.3 and `06` §8.** One delegation pays opencode's 6,744-token preamble
  uncached: `6,744 × $0.10/M = $0.000674`, which is **7.3%** of sweet's $0.009201 rollout.
  Add roughly four subagent turns re-sending a small context: about `$0.00036`. Total per
  delegation ≈ `$0.00103`, i.e. **11.2%** of the rollout, so break-even is **2.1 main-thread
  requests removed**. Sweet issues 10.65 `ss-*` calls per opencode rollout. One delegation that
  absorbed five of them nets `5 × $0.000485 − $0.00103 = $0.00139`, which is **15.1%** of the
  rollout. The gap to close is +3.3%. **Ceiling ≈ 15%, plausible ≈ 5%, and it goes negative
  if the model delegates more than twice.**
- **`$0` falsifier, and its kill condition.** Replay the opencode sweet traces and count, per
  rollout, the maximal run of consecutive `ss-*` calls whose output is never quoted back into a
  later assistant message or an `apply_patch` hunk — those are the delegable, locate-only
  calls. **Kill if the median run is under 3.** Second gate: count how many rollouts contain
  two or more such runs; **kill if over 30%**, because each run is a new delegation and two
  delegations already erase the win.
- **Register check.** Nearest is **E10** (ephemeral causal coprocessor, DEAD live: calls 6.8 →
  12.5, re-derivations 0 → 1.33/rollout, cost +79%) and **F15**. Different in three ways: the
  subagent already exists so no tool is built, the main thread's context is not reset, and the
  harness is opencode rather than claude-code. **Same in the way that matters**: the
  subagent returns a conclusion, not the file text, so the main thread may re-derive. E10 is
  the killing prior and this seed should not be run before the replay above.
- **Build cost.** Guide text: hours. Agent definition: a day.
- Flags: `new_tool: false`. `needs_user_decision: true` (an arm-specific harness config is an
  asymmetry the owner has excluded for MCP; and A1/A6 say luna ignores guide instructions it
  does not already follow).

### Seed 2 — Cap-aware unread trailer on `ss-read` and `ss-search` (codex)

- **Mechanism.** Claude Code's `Read` reports `showing lines 1-N of TOTAL (T tokens, cap C)`
  and names the exact next call [C]. Sweet's `renderUnreadBelow` produces a better trailer but
  only when the *caller* asked for a partial range [C]. On codex, the harness truncates
  `ss-*` output middle-out at about 2,500 tokens and the agent gets no address.
- **Harness.** codex. Sweet-only (product code).
- **Ceiling.** The programme already priced this at about **2%, correctness not cost**
  [register C9, `04-resolution-codex.md` L4].
- **`$0` falsifier.** From `12-truncation-census.md`, count truncated `ss-*` outputs whose cut
  span later gets re-fetched by a second call. **Kill if under 5% of truncations are
  followed by a re-fetch**, because then the cut span was never wanted.
- **Register check.** This *is* C9. My contribution is that a competitor harness ships the
  exact contract, with the exact string, so the design does not need inventing. **Novelty:
  extends, not new.**
- Flags: `new_tool: false`, `needs_user_decision: false`.

### Seed 3 — `ss-read --outline`: a symbol skeleton of one file

- **Mechanism.** Serena's `symbol_overview` and Continue's `repo-map` both return signatures
  without bodies. Sweet has no outline surface [C], but the index already stores `symbol`,
  `type` and `startLine` per chunk and `renderUnreadBelow` already reads them [C]. A
  per-file outline is a formatting change over data we already hold.
- **Harness.** all three; strongest on claude-code, where native `Read` runs 19.4 calls per
  rollout at 3.1 kB [brief §1.1].
- **Vehicle.** Sweet-only, a flag on an existing tool.
- **Admissibility, stated honestly.** An outline that renders the same file smaller is the
  **banned class** (B7). It is admissible only if it changes *which* lines the agent then
  reads — that is, if the agent reads one narrow span after an outline where it would
  otherwise have read a wide one.
- **Ceiling.** Unknown, and probably small: `07` and our own rotate20 screen both put retrieval
  headroom near zero, and B12 measured that giving the agent *more* file made it do *more*
  work and cost 4.8–19.8% more live.
- **`$0` falsifier.** From the claude-code and codex sweet traces, count `ss-read` calls that
  are immediately followed by a second `ss-read` of a **different, non-adjacent** span of the
  same file. That pattern is the only one an outline can shorten. **Kill if under 10% of
  `ss-read` calls have that shape.**
- **Register check.** Nearest are **B7** (banned) and **B13** (payload budgeting by lifetime,
  PARKED). Different only if the falsifier above passes.
- Flags: `new_tool: false`, `needs_user_decision: false`.

**One seed I am deliberately not proposing.** A repository-level precomputed map. Three
independent facts say no: our B11 turn-0 dossier is DEAD, our B12 whole-file expansion
INVERTED live, and the incumbent implementation's own documentation says weaker models get
confused by it and try to edit it. There is also no published ablation for it anywhere.

---

## 6. Corrections and extensions to the register and to the three existing documents

| item | change | basis |
|---|---|---|
| **E13** index-selected regression tests | **OPEN → DEAD for resolution on this pool.** At most 7/153 losses (4.6%) have the shape, they sit on 2 tasks already classified as wrong-location edits, and the only n=100 measurement of the mechanism moved resolution 31% → 29% | §3.1 [M]; TDAD [W] |
| **F8 / F10** prose rules and tests-first prompts | **externally replicated.** TDAD: procedural test-first instructions without a computed artifact raised pass-to-pass failures 42% (6.08% → 9.94%); the same instructions plus a computed `test_map.txt` cut them to 1.82% | TDAD Table 4 [W] |
| **F9** delivered computed certificate | **externally corroborated by the same table.** "The value is the computation, not the rule" now has a second laboratory | TDAD [W] |
| **B1** eviction / cache-break | **vendor-confirmed.** Anthropic's context-editing docs state that clearing invalidates the cached prefix and incurs cache-write cost, and expose `clear_at_least` precisely to amortise it. Our break-priced column (G2) is the right instrument | Anthropic docs [W] |
| **B5** compaction untestable | **sharpened.** The industry default trigger is 100,000 input tokens; our largest context was 100,624 and our largest claude-code context 95,712. We sit under the trigger, not merely far from a 1.05M window | Anthropic docs [W]; `06` §0, §5.3 [M] |
| **A2** `ss-batch` | **revival condition is real.** The same idea works as a provider feature (Programmatic Tool Calling, 43,588 → 27,297 tokens, 37%), so "per-backbone re-screen" is a live condition, not a formality | Anthropic engineering post 2025-11-24 [W] |
| **A4** MCP surface, "a new tool schema changes the cached prefix" | **the industry has an answer to that objection**: Tool Search Tool takes ~77K of definitions down to ~8.7K. It does not change our arithmetic, because our guide is 1,457 tokens, but the objection is no longer categorical | Anthropic engineering post [W] |
| **new register row** | **commit-history corpus (Augment Context Lineage): DEAD BY CONSTRUCTION.** Goldens are one-commit repositories; `git log --oneline` returns 1, titled `base` | [M] on the box |
| **new register row** | **built-in harness retrieval subagents: OPEN.** opencode `explore` (bash allowed) and claude-code `Explore` exist; codex/opencode delegation is 0/261 rollouts | [C][M] |
| `05` §1.10 contract table | **extend**: Claude Code 2.1.218's `Read` also emits a cap-aware paging footer naming the exact next call, and a separate footer for files with very long lines. The table records the numbering format but not this affordance | [C] |
| `07` §6 L1 | **correct the direction**: L1 is ranked as the one sweet-only lever with a published effect at low cost. TestPrune's figure is a *cost* figure; the resolution figure for the mechanism is 31% → 29% | TDAD [W]; §3.1 [M] |

---

## 7. Traps this research walked into, recorded so the next agent does not

1. **Latency claims read as cost claims.** Windsurf's "20x faster", SWE-grep's "2,800 tokens
   per second", and DeepWiki's "sub-second" are all **wall-clock**. Cognition publishes no
   token or dollar figure for Fast Context, and its SWE-Bench Verified statement is
   explicitly "the same number of tasks in significantly lower end-to-end time". Our objective
   is dollars at equal solves. None of these numbers is evidence for it.
2. **Benchmark shape decides everything.** CodeGraph's 62%-tokens result is seven
   comprehension questions with no edit. Roo's "60–80%" appears only in third-party blogs and
   not in the official documentation. Nia's "27%" has no method at all. Only Cursor's number
   comes with an eval set and a live A/B, and Cursor's own retention effect is +0.3%.
3. **Whole-product leaderboards are not retrieval ablations.** Augment 51.80% vs Claude Code
   49.75% on SWE-Bench Pro compares four different harnesses. Junie's 61.6% on SWE-Rebench
   bundles the IDE index with model routing, a debugger, and a test runner.
4. **Secondary sources invent numbers for vendors.** The "29% / 39% / 84%" context-editing
   figures circulate widely; the Anthropic context-editing documentation publishes none of
   them. Do not carry them forward.
5. **`toolCounts` in `rows.json` has a fixed schema** — `{ss, nativeGrep, nativeRead, edit,
   bash, test}` — and contains **no** field for the `Task`/subagent tool. Delegation must be
   read from `sidechainTurns`, which is claude-code-specific instrumentation. A zero in
   `toolCounts` is not evidence of anything about delegation.
6. **`usage` in `rows.json` is `{turns: N}` only** on these runs — no token split. Token
   decomposition must come from the `turns/` files or the raw transcripts, with the rep-overwrite
   trap from the brief.
7. **`f2pFrac == 1` with `resolved == false` is *consistent with* a pass-to-pass regression but
   does not prove one.** On this pool, inspection of the task ids showed both such tasks were
   already classified as wrong-location edits. I report it as an upper bound.

---

## 8. What I could not finish, and why

- **I did not price the opencode `explore` subagent from traces**, because the fresh pool
  contains zero delegations on opencode. The 11.2%-per-delegation figure in Seed 1 is
  arithmetic over `06`'s measured opencode preamble size, not a measurement of a real opencode
  subagent. It should not be quoted as measured.
- **I did not recover Serena's addressing syntax or any Serena benchmark.** The project
  publishes tool names and a qualitative "8–12 steps into one atomic call" quote and no
  numbers. If a Serena number is wanted, the source is `07`'s LSP paper, not the product.
- **I did not verify Junie's `$0.81 per problem`** at a primary source. The JetBrains post
  quotes 61.6% resolved and 72.7% pass@5 and no cost; the $0.81 comes from a secondary
  comparison article. Treat it as unverified.
- **Amp's `oracle` and `Librarian` are documented only in third-party write-ups.** The
  official context-engineering guide in `ampcode/amp-examples-and-guides` names subagents,
  thread forking and compaction, and does not mention either by name.
- **I did not check whether codex 0.146.1 has any subagent capability at the binary level.**
  `/usr/bin/codex` is a 178-string Node launcher; the real implementation is elsewhere in the
  package. The claim "codex has no subagent" rests on `05`/`06`'s tool-surface reading and on
  the measured 0/132 delegation rate, not on a fresh binary read.
- **I did not read the Cursor Context Bench size**, which is undisclosed, so the 12.5% accuracy
  figure has no sample size attached.
- **`grep.app`, Exa, Kiro, Zed and Jules produced no mechanism that is both new and relevant.**
  Kiro's steering files and Jules's `AGENTS.md` handling are the repository-context-file
  mechanism `07` §5.1 already priced at 20–23% cost for −0.5 to −2% resolution. Zed's 2026
  contribution is the Agent Client Protocol, co-developed with JetBrains, which is a transport,
  not a retrieval mechanism. `grep.app` and Exa index *public* repositories, which is the
  dependency-source corpus question (E5), already gated.

---

## 9. Reproduction

Everything below is read-only. Scratch on the box lives in
`/tmp/wf-slatec/competitor-mechanisms/`.

```bash
# 1. Built-in retrieval subagents, read from the deployed binaries
ssh root@167.233.69.121
mkdir -p /tmp/wf-slatec/competitor-mechanisms
strings -n 6 /root/.local/share/claude/versions/2.1.218 \
  > /tmp/wf-slatec/competitor-mechanisms/cc.strings
grep -o "iay=.\{0,900\}" /tmp/wf-slatec/competitor-mechanisms/cc.strings   # Explore description
sed -n '381625,381645p' /tmp/wf-slatec/competitor-mechanisms/cc.strings    # agent registry
grep -o "showing lines.\{0,700\}" /tmp/wf-slatec/competitor-mechanisms/cc.strings  # Read footer

strings -n 8 /usr/lib/node_modules/opencode-ai/bin/opencode.exe \
  > /tmp/wf-slatec/competitor-mechanisms/oc.strings
grep -o 'name:"explore".\{0,600\}' /tmp/wf-slatec/competitor-mechanisms/oc.strings

# 2. Loss taxonomy (§3.1) and delegation census (§3.2), rows.json only
cd /root/sweet-search-private/eval/task-completion-bench/results
node -e 'for (const R of ["fp-codex-tab-20260826","fp-opencode-tab-20260826","fp-claudecode-tab-20260826"]) {
  const rows = require(process.cwd()+"/"+R+"/rows.json");
  let g=0,res=0,f0=0,part=0,p2p=0,sc=0;
  for (const r of rows) { if (!r.gradeable) continue; g++;
    if (r.sidechainTurns) sc++;
    if (r.resolved) { res++; continue; }
    const f = r.f2pFrac || 0;
    if (f >= 1) p2p++; else if (f > 0) part++; else f0++; }
  console.log(R, {g,res,f0,part,p2p,rowsWithSidechain:sc}); }'

# 3. Goldens are one-commit repositories
cd "$(ls -d /root/.ss-eval/golden/*/ | head -1)" && git log --oneline | wc -l
```

Local, in the repo:

```bash
grep -rn "outline" core/search/*.js                 # returns nothing: no outline surface
sed -n '560,592p' core/search/search-read.js        # renderUnreadBelow, the continue trailer
sed -n '446,470p' core/search/search-read.js        # the wantsRange condition (why it is not cap-aware)
grep -n "sub-agent you delegate" core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md
```

---

## 10. Sources

Every URL fetched or searched, with the date shown on the page or the date of the claim.

**Retrieval subagents and fast context**
- Cognition — Introducing SWE-grep and SWE-grep-mini, 2025-10-16 — <https://cognition.com/blog/swe-grep>
- Devin / Windsurf — Fast Context product doc, live 2026-09 — <https://docs.devin.ai/desktop/context-awareness/fast-context>
- Amp — Context Engineering guide, live 2026 — <https://github.com/ampcode/amp-examples-and-guides/blob/main/guides/context-management/Context%20Engineering%20-%20Amp.md>
- Codebuff — open-source launch and BuffBench, 2025-09-09 — <https://news.codebuff.com/p/codebuff-goes-open-source-beats-claude>
- OpenCode — agents documentation, live 2026 — <https://opencode.ai/docs/agents> · custom-subagent limitation issue #29616 — <https://github.com/anomalyco/opencode/issues/29616>
- Claude Code 2.1.218 `Explore` agent and `Read` footer — read from the deployed binary on the evidence box [C]
- OpenCode 1.18.4 `explore` agent — read from the deployed binary on the evidence box [C]

**Context engines and indexes**
- Cursor — Improving agent with semantic search, 2025-11-06 — <https://cursor.com/blog/semsearch>
- Augment Code — Auggie tops SWE-Bench Pro, published 2026-02-04, updated 2026-06-18 — <https://www.augmentcode.com/blog/auggie-tops-swe-bench-pro>
- Augment Code — Context Engine — <https://www.augmentcode.com/context-engine> · Context Engine as MCP, 2026-02-06 — <https://www.augmentcode.com/blog/context-engine-mcp-now-live> · Context Lineage — <https://www.augmentcode.com/blog/announcing-context-lineage>
- CodeGraph — README with the seven-repo benchmark, re-measured 2026-08-05 — <https://github.com/colbymchenry/codegraph>
- DeepWiki — Devin documentation, live 2026 — <https://docs.devin.ai/work-with-devin/deepwiki>
- Roo Code — Codebase Indexing docs, updated 2026-05-15 — <https://roocodeinc.github.io/Roo-Code/features/codebase-indexing>
- Continue — repo-map and codebase context providers, live 2026 — <https://docs.continue.dev/customize/deep-dives/custom-providers>
- Nia — product page and repository, live 2026 (27% claim carries no method) — <https://github.com/nozomio-labs/nia>
- Greptile — MCP overview, live 2026 — <https://www.greptile.com/docs/mcp/overview>
- Exa — MCP reference (`get_code_context_exa`), live 2026 — <https://docs.exa.ai/reference/exa-mcp>
- Vercel — Grep acquisition, 2024-11 — <https://vercel.com/blog/vercel-acquires-grep> · Grep MCP over a million repos — <https://vercel.com/blog/grep-a-million-github-repositories-via-mcp>
- Sourcegraph — How Cody understands your codebase (embeddings retired in favour of Sourcegraph Search) — <https://sourcegraph.com/blog/how-cody-understands-your-codebase>

**Repo maps, outlines, and language servers**
- aider — Repository map, `--map-tokens` default 1k — <https://aider.chat/docs/repomap.html> · FAQ, "weaker models get easily overwhelmed and confused by the content of the repo map" — <https://aider.chat/docs/faq.html>
- aider — Building a better repository map with tree sitter, 2023-10-22 — <https://aider.chat/2023/10/22/repomap.html>
- Serena — MCP toolkit, tool list, live 2026 — <https://github.com/oraios/serena>
- JetBrains — Junie leaves beta, 2026-06 (SWE-Rebench 61.6% resolved, 72.7% pass@5) — <https://blog.jetbrains.com/junie/2026/06/junie-coding-agent-out-of-beta/>
- Windsurf Codemaps coverage, 2026 — <https://www.azkytech.com/post/windsurfs-code-maps-feature>

**Context pruning and compaction**
- Anthropic — Context editing, live 2026-09, beta (default trigger 100,000 input tokens; cache invalidation stated) — <https://platform.claude.com/docs/en/build-with-claude/context-editing>
- Anthropic — Introducing advanced tool use, 2025-11-24 (Tool Search Tool 79.5% → 88.1%, 85% token reduction; Programmatic Tool Calling 43,588 → 27,297 tokens) — <https://www.anthropic.com/engineering/advanced-tool-use>
- Cline — How to think about context engineering in Cline, 2025-08-19 — <https://cline.bot/blog/how-to-think-about-context-engineering-in-cline>
- Cline — Auto Compact docs — <https://docs.cline.bot/features/auto-compact>

**Test selection**
- TDAD: Test-Driven Agentic Development — Reducing Code Regressions in AI Coding Agents via Graph-Based Impact Analysis, arXiv:2603.17973v2, 2026-03-19 (tables fetched) — <https://arxiv.org/html/2603.17973>

**Repository-context files** — already priced in `07` §5.1; listed only so the next reader does
not re-fetch: Kiro steering docs <https://kiro.dev/docs/steering/>, Jules changelog
<https://jules.google/docs/changelog/>.
