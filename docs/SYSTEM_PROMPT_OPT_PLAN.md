# System Prompt Optimization Plan

**Created**: 2026-05-03  
**Status**: Draft  
**Depends on**: implemented `read` / `read-semantic` tools, agent read-workflow benchmarks

---

## Problem Statement

AI coding agents default to native `rg` + broad `Read` workflows for code exploration. When
sweet-search is installed, that default is no longer optimal:

1. **Search routing is under-specified** — agents are not naturally aware of indexed grep,
   ColGrep, structural search, semantic read, or exact range reads.
2. **Replacement rules are too weak** — "use sweet-search instead of Grep/Read" does not teach
   the model which sweet-search tool to choose, how to phrase queries, when to read, or when to stop.
3. **Query shape matters** — `sweet-search` auto/hybrid, indexed grep, ColGrep, structural mode,
   `read`, and `read-semantic` likely each have different optimal query styles.
4. **Prompt quality is a product surface** — agent benchmarks showed that tool behavior improved
   materially when the system prompt taught a decision tree, citation rules, and stopping rules.

The read tools are now implemented. This plan focuses only on system prompt optimization, tool-use
guidance, enforcement, query-shape benchmarking, and GEPA/DSPy-based prompt evolution.

---

## Current Baseline

Implemented and available:

- `sweet-search read` — exact filesystem-grounded reads, ranges, batching, indexed metadata.
- `sweet-search read-semantic` — hybrid lexical/symbol/late-interaction span selection followed by
  exact disk re-read.
- `eval/read-workflows/` — deterministic retrieval/read workflow benchmark.
- `eval/agent-read-workflows/` — agent-in-the-loop benchmark comparing native `rg + Read` against
  sweet-search-only workflows under audited policies.

Recent benchmark findings:

- A strict sweet-search policy produced better answerability and citation precision than native
  workflows on the Fastify 10-task run.
- The largest behavior improvements came from prompt instructions, not tool implementation changes.
- The policy needed a concrete decision tree, allowed-command discipline, citation shape rules, and
  stop rules.
- Token/cost savings were useful but not universally huge, which means the next leverage point is
  teaching agents the optimal query grammar per tool.

---

## Part 1: Agent Instruction Placement

### 1A — CLAUDE.md / AGENTS.md Injection

**Goal**: Tell agents to use sweet-search tools instead of native `rg`, Grep, broad Read, and Glob
for code-understanding workflows.

**Mechanism**: During `sweet-search init`, inject standardized guidance into the project's
instruction files.

**Canonical source for Claude Code**:

- `CLAUDE.md` is the Claude Code source of truth.
- If sweet-search writes `.claude/rules/sweet-search.md`, `CLAUDE.md` should import it via
  `@.claude/rules/sweet-search.md`.
- If `AGENTS.md` exists and the user wants a shared instruction body across tools, inject the
  sweet-search block into `AGENTS.md` and add `@AGENTS.md` near the top of `CLAUDE.md`.
- If only `CLAUDE.md` exists, inject there directly.
- If both exist and are independent, inject into both.
- If one is a symlink to the other, edit only the real source file.
- If neither file exists, create `CLAUDE.md` only.

**Injection logic**:

- If the marker block already exists, replace it in-place.
- If the file exists but has no marker, prepend the block before the first `#` heading.
- If no instruction file exists yet, create `CLAUDE.md` with the block and a minimal project header.
- Never modify content outside the marker block.

Marker format:

```markdown
<!-- sweet-search:agent-instructions:begin -->
... managed sweet-search instructions ...
<!-- sweet-search:agent-instructions:end -->
```

### 1B — `.claude/rules/sweet-search.md`

**Goal**: Keep Claude-specific sweet-search tool-routing instructions in a dedicated file while
relying only on documented Claude Code memory/import behavior.

Important constraint:

- Do not assume `.claude/rules/*.md` is auto-loaded unless independently verified.
- Treat `.claude/rules/sweet-search.md` as a support file loaded through a documented
  `CLAUDE.md` import.

Lifecycle:

- `sweet-search init` creates `.claude/rules/sweet-search.md`.
- `sweet-search init` ensures `CLAUDE.md` imports it.
- Re-running init overwrites the rules file idempotently.
- `sweet-search uninstall` removes the rules file and its `CLAUDE.md` import if they were created
  by sweet-search.

### 1C — UserPromptSubmit Reminder Hook

**Goal**: Keep sweet-search tool selection fresh in the agent's active context on every prompt.

Why this matters:

- It operates before the first tool call, where most bad routing starts.
- It helps prevent drift back to native `rg + Read`.
- The token cost is small relative to avoided bad exploration loops.

Reminder content should be concise and generated from the optimized policy:

- use indexed grep for exact identifiers/literals
- use ColGrep for behavior questions with a regex anchor
- use structural mode for callers/callees/impact
- use `read` for exact ranges
- use `read-semantic` when a file is known but the relevant span is unclear
- stop after enough evidence is gathered

### 1D — Optional Tool Enforcement

**Goal**: Add Claude-specific guardrails where supported, without assuming impossible tool swaps.

Important constraint:

- Repo-local Claude hooks cannot transform a `Grep` tool call into a `Bash` call running
  `sweet-search`.
- PreToolUse can allow, deny, hint, or rewrite same-tool inputs; it cannot change tool type.
- True transparent rerouting requires an external wrapper or SDK-based control loop.

Recommended enforcement:

- Deny native Grep only in opt-in strict mode.
- Hint on native Read for code-understanding reads, but do not fully block Read because edit
  workflows often require a prior Read.
- Keep `--enforce-tools` opt-in because strict enforcement is Claude-specific and opinionated.

---

## Part 2: Optimized Agent Search Policy

**Goal**: Ship a real tool-routing policy, not only replacement rules.

Enforcement answers: "which tools are allowed?"

The optimized search policy answers: "which sweet-search tool should I choose, what query shape
should I use, how many results should I inspect, when should I read, and when should I stop?"

### Default Tool-Routing Decision Tree

```markdown
## sweet-search Tool Routing

Use sweet-search for code discovery and code reading. Pick the narrowest tool that can answer the
question.

1. Exact symbol, constant, error code, log string, config key, or literal:
   - Use indexed grep.
   - CLI: `sweet-search grep "<regex>" --agent`
   - Agent wrapper: `ss-grep "<regex>" -k 5`
   - Query shape: short, literal-heavy regex. Escape punctuation. Prefer the rarest identifier.

2. Behavioral or semantic question where a literal exists but intent matters:
   - Use ColGrep / patternSearch: regex candidate pool + semantic re-rank.
   - Agent wrapper: `ss-find "<natural-language question>" --regex "<broad-but-relevant-regex>" -k 5`
   - Query shape: natural-language intent + a broad regex anchor.

3. General conceptual search with no obvious literal:
   - Use `sweet-search "<short intent query>" --agent` in hybrid/auto mode.
   - Query shape: one concise sentence naming the concept and likely domain words.

4. Callers, callees, implementations, impact, inheritance, or dependency questions:
   - Use structural search.
   - CLI: `sweet-search "who calls <symbol>" --mode structural --agent`
   - Query shape: include the exact symbol plus relationship word.

5. Path/name discovery:
   - Use path search once implemented.
   - CLI: `sweet-search files "<glob-or-path-pattern>"`

6. Exact file/range already known:
   - Use exact read.
   - CLI: `sweet-search read <file> --lines <start-end>`
   - Agent wrapper: `ss-read <file> <start> <end>`

7. File is known but relevant span is unclear:
   - Use semantic read once for that file.
   - CLI: `sweet-search read-semantic <file> "<question>" --max-tokens 800`
   - Agent wrapper: `ss-semantic <file> "<question>" --max-tokens 800`
   - Do not call semantic read on multiple files unless the task is explicitly multi-file.
```

### Stopping Rules

```markdown
## Stopping Rules

- Inspect only the top 3-5 discovery results.
- If a discovery result already returns a tight chunk/range that answers the question, cite it and stop.
- If the first discovery call returns nothing, broaden once. If still empty, report no match.
- Do not re-search merely to double-check.
- Do not read broad files after a tight chunk already answers the task.
- Prefer 1-3 high-confidence citations over long citation lists.
```

### CRITICAL: STOP-on-good-results discipline

**Observed failure mode (2026-05-04 agent benchmark):** even when the
sweet-search response carries `sufficient=YES`, a tight top-1 chunk that
literally contains the gold symbol body, a resolved imports header, and
a graph-neighbour tier, agents still keep doing follow-up searches and
narrow reads. Examples from the haiku run on n=5/repo:

- `gin:radix-route-insertion` — sweet did **10 turns** for an answer
  that was complete after turn 1; tokens 8398 vs native 3230.
- `gin:panic-recovery` — sweet did **6 turns** for the same Recovery()
  walkthrough that native solved in 2.
- `ripgrep:locate-line-bounds` — sweet did **6 turns / 9548 tok** for a
  function-bound answer.

Everywhere this happened, sweet-search's first response already
carried a `full`-tier chunk + a header + neighbours + `sufficient=YES`
+ `confidence ∈ {medium, high}`. The agent ignored those signals.

The decision tree MUST teach this explicitly. Suggested wording for
the policy text:

```markdown
## STOP rules — read these before EVERY follow-up call

The sweet-search response trailer carries explicit stop signals.
**Honour them.** A second call costs more tokens than it saves.

Stop after one search and answer immediately when ALL of:
- the response says `sufficient=YES`
- the top-1 result is `presentation=full` with `expansionKind` in
  `{full, sandwich, chunk}` and the gold symbol/file is named
- the response includes a `### related (1-hop graph, ...)` block
  OR a `### imports` block that resolves the body's referenced names
- you can defend the answer by pointing at the visible code

Do NOT call a second time merely because:
- you want to "double-check" the line range
- the first answer was unexpectedly short  → it is short BECAUSE the
  pack is tight, not because evidence is missing
- you noticed a helper function named in the chunk that is also in
  the pack as a `summary` row → its file:line in the rank list
  is sufficient citation; do not read it

Single counter-rule: the question explicitly asks for multi-file
flow ("how does X flow from A to B", "trace from entry to exit",
"all places that ..."). In that case, take ONE follow-up reading
or sub-search to fill the gap, then stop.
```

This stopping discipline is the largest remaining gap between
sweet-search-auto agent runs and frontier-quality output (May-2026).
The packaging is SOTA-class; the agent needs to *trust* it.

### Budget escalation rules

The CLI exposes three budget tiers:

| Mode | Token budget | When to use |
|------|--------------|-------------|
| `ss-search "<q>"` (default) | 4k preview | Lookup tasks: exact symbol, file location, simple function behaviour. Top-1 gets ~60% of budget; ranks 2-3 get preview. |
| `ss-search "<q>" --full`    | 8k full     | Behaviour explanations spanning 2-3 symbols; "how does X work" with cross-references; cases where the agent expects to cite ≥2 files. Top-1 + competitive ranks 2-3 get `full` presentation. |
| `ss-search "<q>" --xl`      | 12k stretch | "Trace through the entire pipeline" / multi-file flow. Gated on top-1 dominance (top-1 score ≥ 2× top-2); falls back to `--full` when the gate fails. |

Decision tree for budget choice (add to the policy):

```markdown
## Choosing the search budget

Default to `ss-search "<q>"` (4k). Switch tiers only when the question
shape demands it:

- Use `--full` (8k) when the question:
  - mentions multiple steps / phases / stages explicitly
  - asks for a "pipeline", "flow", "lifecycle", "dispatch", "sequence"
  - asks "how does X handle ..." where X involves several cooperating
    functions
  - asks "what calls/where is X used" AND you expect ≥2 callers

- Use `--xl` (12k) ONLY when:
  - the question is explicitly multi-file / cross-cutting
  - one strong dominant answer is plausible (the gate will fall back
    to `--full` if not)

NEVER chain searches at increasing budgets. If the default 4k pack
already says `sufficient=YES`, do not "re-run with --full to be sure"
— that just wastes budget.
```

The 4k → 8k jump roughly doubles top-1's room for full presentation
of the symbol AND ranks 2-3 (which get `full` instead of `preview`
when their score is competitive). For typical multi-symbol questions,
`--full` is a better bet than chaining a default search with a
narrow follow-up.

### Citation Rules

```markdown
## Citation Rules

- Every distinct source file that supports the answer must appear as its own citation.
- If the prose names a file, imports from it, relies on a function in it, or cites behavior from it,
  that file must be cited with a line range.
- For multi-file flows, cite one range per required file.
- Do not mention supporting files only in prose or notes.
```

---

## Part 3: Query-Shape Benchmarking

**Goal**: Learn the optimal query grammar for each sweet-search tool before evolving the general
agent system prompt.

The system prompt should not assume one optimal query style. Each tool likely has a different
query distribution:

| Tool | Query-shape questions to benchmark |
|------|------------------------------------|
| `sweet-search` auto/hybrid | short keyword vs long natural-language vs symbol+intent; CatBoost routing accuracy |
| indexed grep / `ss-grep` | literal regex specificity, top-k, context lines, rare-token anchoring |
| ColGrep / `ss-find` | query length, symbol inclusion, broad vs narrow regex anchor, regex family, k |
| structural mode | relationship words, exact symbol requirements, multi-hop wording |
| `read-semantic` | question length, symbol inclusion, max tokens, threshold, context lines, topK |
| `read` | range size, batching, chunk metadata usefulness |
| `files` | glob-like patterns vs basename terms vs natural path descriptions |

### Why This Comes Before Prompt Evolution

System prompts encode rules. If the rules are wrong, optimization will make the agent more
consistent at using the wrong strategy. Query-shape benchmarking isolates each tool and answers
lower-level questions first:

- What query strings maximize recall?
- What query strings maximize precision?
- What query strings minimize follow-up reads?
- Which query styles cause CatBoost to route correctly?
- Which query styles cause `read-semantic` to return enough evidence without overfetch?

Only after this should the global policy be evolved.

### Benchmark Structure

Create `eval/query-shapes/` as a deterministic, non-agent benchmark over pinned repos and gold
tasks. It should run tool/query variants directly, without Claude agent variance.

For each task, generate multiple query variants:

```json
{
  "taskId": "fastify:server-protocol-selection",
  "tool": "ss-find",
  "variants": [
    {
      "name": "short-intent",
      "query": "server protocol selection",
      "regex": "server|http2|https"
    },
    {
      "name": "long-natural-language",
      "query": "how does Fastify decide whether to create HTTP HTTPS or HTTP2 server",
      "regex": "server|http2|https|getServerInstance"
    },
    {
      "name": "symbol-plus-intent",
      "query": "getServerInstance choose http2 https http",
      "regex": "getServerInstance|http2|https"
    }
  ]
}
```

Score each variant using deterministic retrieval metrics:

- expected file recall
- expected symbol recall
- gold line overlap
- returned-line precision
- chars/tokens returned
- latency
- whether output is answerable without follow-up reads
- whether the query routed to the intended search path
- number of follow-up reads needed in a simulated workflow

### DSPy Role In Query-Shape Optimization

DSPy is useful before GEPA. Model each query generator as a small DSPy program:

```python
class MakeAutoSearchQuery(dspy.Signature):
    task = dspy.InputField()
    repo_language = dspy.InputField()
    query = dspy.OutputField()

class MakeColGrepQuery(dspy.Signature):
    task = dspy.InputField()
    semantic_query = dspy.OutputField()
    regex_anchor = dspy.OutputField()

class MakeReadSemanticQuery(dspy.Signature):
    task = dspy.InputField()
    file = dspy.InputField()
    symbol_hint = dspy.InputField()
    query = dspy.OutputField()
```

Use DSPy optimizers such as MIPROv2 or BootstrapFewShot to learn instructions and examples for
these query generators against the deterministic query-shape benchmark. The output is not yet the
final agent prompt; it is a measured set of query-shape rules and examples.

### Promotion Artifact

The query-shape benchmark should produce a machine-readable report:

```json
{
  "tool": "read-semantic",
  "recommendations": [
    "include exact symbol when known",
    "use one behavior phrase, not multi-sentence task text",
    "default maxTokens=800 for code-understanding tasks",
    "increase maxTokens only for multi-branch error paths"
  ],
  "evidence": { "tasks": 120, "avgRecallGain": 0.12, "avgTokenReduction": 0.31 }
}
```

These recommendations become seed material for global prompt evolution.

---

## Part 4: GEPA Prompt Evolution Over Agent Traces

**Goal**: Evolve the sweet-search policy text until it consistently improves agent behavior over
native Claude Code workflows.

DSPy remains useful for structured metrics and evaluation programs, but the primary object we need
to optimize is textual: the tool-routing policy, examples, tool descriptions, query-shape guidance,
and stop criteria. GEPA is a better fit for that layer because it can read full execution traces and
mutate text artifacts based on concrete failures.

### Candidate Artifact

Treat the following as a versioned candidate:

- `.claude/rules/sweet-search.md` contents
- `CLAUDE.md` / `AGENTS.md` injected summary block
- `UserPromptSubmit` reminder text
- MCP tool descriptions
- agent wrapper help text (`ss-grep`, `ss-find`, `ss-read`, `ss-semantic`)
- query-shape examples for each tool

### Evaluator

Use the agent-in-the-loop benchmark (`eval/agent-read-workflows/`) as the primary evaluator:

- real pinned repos
- native `rg + Read` baseline
- sweet-search-only policy with audited tool usage
- deterministic metrics: file recall, symbol recall, fact recall, evidence success, precision,
  answerability, policy violations
- cost metrics: tool-output tokens, Claude usage tokens, tool calls
- optional blind judge for qualitative preference

The retrieval-only benchmark (`eval/read-workflows/`) remains a regression suite for tool mechanics
and query-shape experiments, but it is not sufficient for final prompt promotion.

### Objective

Optimize a Pareto frontier rather than a single scalar. A policy is promotable only if it satisfies:

1. zero policy violations on the validation split
2. equal-or-better answerability than the current shipped policy
3. no regression on no-match tasks
4. no regression on multi-file citation tasks
5. equal-or-better evidence success / file precision
6. lower or equal tool-output tokens at comparable quality
7. no large increase in tool-call count

Latency should be tracked but not used as the main objective during local runs, because LI/model
contention and cold-start effects can dominate measurements.

### GEPA Loop

1. Seed with the hand-written benchmark-derived policy plus query-shape findings.
2. Run a small training split of agent tasks.
3. Feed GEPA the full traces: prompts, tool calls, tool outputs, final answers, audit violations,
   deterministic scores, and judge comments.
4. Ask GEPA to mutate the policy text, examples, and stop rules.
5. Re-run candidates on the training split.
6. Keep Pareto-efficient candidates.
7. Validate on held-out repos/tasks.
8. Promote only if the policy beats the current shipped policy under the criteria above.

### DSPy Role After Adding GEPA

DSPy should not be the only prompt optimization mechanism. Its role is:

- define structured task signatures and metrics
- provide adapters around the Claude CLI / agent benchmark
- run deterministic evaluation and candidate comparison
- optionally host `dspy.GEPA` or other optimizers
- export final artifacts into JS/Markdown files consumed by `sweet-search init`

GEPA's role is:

- reflective mutation of the policy text
- learning from trace-level failures
- discovering better query instructions, examples, and stopping rules

---

## Part 5: Init Integration

All system-prompt optimization output integrates into `scripts/init.js` after the existing runtime
setup and index-maintainer hook installation.

Updated init flow:

```text
1.  Check Node.js version                          (existing)
2.  Detect project root                             (existing)
3.  Create .sweet-search/ directory                 (existing)
4.  Resolve profile                                 (existing)
5.  Verify runtime assets                           (existing)
6.  Check native status                             (existing)
7.  Download models                                 (existing)
8.  Write config                                    (existing)
9.  Run verification                                (existing)
10. Install index-maintainer daemon hook             (existing)
11. Write .claude/rules/sweet-search.md              (NEW)
12. Inject/import agent instructions in CLAUDE.md/AGENTS.md   (NEW)
13. Install UserPromptSubmit reminder hook            (NEW, default-on)
14. Install tool-enforcement settings/hooks          (NEW, only with --enforce-tools)
15. Print report                                     (existing, updated)
```

Init flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--enforce-tools` | `false` | Install Claude-specific deny/settings enforcement for native Grep plus Read hints |
| `--no-agent-instructions` | `false` | Skip `.claude/rules/sweet-search.md`, its `CLAUDE.md` import, and CLAUDE.md/AGENTS.md injection |
| `--no-prompt-reminders` | `false` | Skip the `UserPromptSubmit` sweet-search reminder hook |

---

## Implementation Order

| Phase | What | Effort | Depends on |
|-------|------|--------|------------|
| **P1** | `.claude/rules/sweet-search.md` + `CLAUDE.md` import + CLAUDE.md/AGENTS.md injection in init | 2-3h | read tools + tool names finalized |
| **P2** | `UserPromptSubmit` reminder hook | 1-2h | P1 |
| **P3** | strict Claude enforcement mode (`permissions` + Read hint hook) | 2-3h | P1 |
| **P4** | MCP/tool description rewrite | 30-60m | current MCP tools |
| **P5** | uninstall cleanup for all init-owned instruction/settings mutations | 1-2h | P1-P3 |
| **P6** | query-shape benchmark suite for `sweet-search`, indexed grep, ColGrep, structural, `read`, and `read-semantic` | 8-12h | agent benchmarks |
| **P7** | GEPA/DSPy prompt evolution over agent traces | 12-24h + model budget | P6 |
| **P8** | Wire promoted policy artifacts into init injection + hooks + MCP, regression test vs shipped baseline | 2-3h | P7 |

---

## Files To Create

| File | Purpose |
|------|---------|
| `scripts/hooks/intercept-read.mjs` | PreToolUse hook: hint on native Read |
| `scripts/hooks/remind-tools.mjs` | `UserPromptSubmit` reminder hook |
| `scripts/inject-agent-instructions.js` | CLAUDE.md/AGENTS.md injection logic |
| `scripts/write-claude-rules.js` | `.claude/rules/sweet-search.md` write + `CLAUDE.md` import/cleanup logic |
| `tests/init/agent-instructions.test.js` | Tests for injection + symlink handling |
| `tests/init/prompt-reminders.test.js` | Tests for `UserPromptSubmit` integration |
| `eval/query-shapes/` | Benchmarks for optimal query wording per sweet-search tool |
| `eval/prompt-evolution/` | GEPA/DSPy prompt-policy optimization harness |

## Files To Modify

| File | Change |
|------|--------|
| `scripts/init.js` | Add rules file + CLAUDE.md import + agent instructions + prompt reminders + optional enforcement |
| `scripts/uninstall.js` | Remove `.claude/rules/sweet-search.md`, its `CLAUDE.md` import, injected instructions, and sweet-search-managed settings entries |
| `mcp/server.js` | Improve tool descriptions using optimized replacement/intent wording |
| `docs/INIT_STRATEGY.md` | Update uninstall contract to include init-owned instruction/settings reversal |

---

## Deferred Follow-Up: `INIT_STRATEGY.md`

Do not edit `docs/INIT_STRATEGY.md` as part of this plan unless explicitly requested. When it is
updated later, make the following changes so it matches finalized init and uninstall behavior:

1. Add `.claude/rules/sweet-search.md` writing/importing to the init flow.
2. Add agent instruction injection into `CLAUDE.md` / `AGENTS.md`.
3. Add default-on `UserPromptSubmit` reminder hook.
4. Add opt-in Claude-specific enforcement via `.claude/settings.json`.
5. Update init flags for `--enforce-tools`, `--no-agent-instructions`, and
   `--no-prompt-reminders`.
6. Update uninstall behavior so it removes sweet-search-managed instruction/settings mutations,
   not only `.sweet-search/` and runtime assets.
7. Clarify that `.claude/rules/sweet-search.md` is loaded through a documented `CLAUDE.md` import.
8. Clarify that repo-local Claude hooks cannot transparently convert a `Grep` tool call into a
   `Bash` tool call.

---

## Design Decisions

### Why System Prompt Optimization First?

The agent benchmark showed that the same tools perform materially better when the prompt teaches a
decision tree, stop rules, and citation discipline. Tool implementation is necessary but not
sufficient; the prompt is the control surface that makes agents use the tools well.

### Why Query-Shape Benchmarking Before GEPA?

GEPA can evolve policy text, but it should not evolve from guesses. Tool-specific query-shape
benchmarks produce measured recommendations that seed the global prompt. Otherwise, optimization
may reinforce bad assumptions.

### Why CLI-First Guidance?

MCP is useful, but agents increasingly execute shell commands. The CLI is the universal interface:
Claude Code, Codex, Cursor, Windsurf, and future agents can all use it through shell execution.
MCP remains a convenience layer that delegates to the same implementation.

### Why Not Fully Block Read?

Claude Code edit workflows often require a prior native Read. Blocking Read would break editing.
Instead, instructions discourage Read for code understanding, enforcement hints on native Read, and
`read` / `read-semantic` provide better alternatives for exploration.

### Why Not Redirect Grep With A Hook?

Repo-local Claude hooks cannot change the tool type from `Grep` to `Bash`. True transparent
rerouting requires an external wrapper around Claude or an SDK-based control loop.

### Why Prompt Reminders?

Prompt reminders operate before tool selection and keep the sweet-search workflow active in the
model's short-term context. The token cost is low relative to repeated bad `rg + Read` behavior.

### Why GEPA + DSPy?

DSPy provides structured programs, metrics, and repeatable evaluation. GEPA-style reflective prompt
evolution mutates the textual artifacts using full execution traces. Sweet Search needs both:
measured query-generation rules and evolved global agent policy.
