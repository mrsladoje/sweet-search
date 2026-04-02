# Agent-Facing Context Packaging for ColGrep Pattern Search

**Status**: Planning
**Priority**: HIGH (this is the product value — agents save tokens and search steps)
**Prerequisites**: Pattern search MVP (done), multi-repo benchmark (done)
**References**: COLGREP_PLAN.md, ContextBench (arXiv 2602.05892), Context as a Tool
(arXiv 2512.22087), RepoCoder (EMNLP 2023), CodeRAG (EMNLP 2025), LightOn ColGrep blog,
"What to Retrieve for Effective RAG Code Generation" (arXiv 2503.20589),
CodeScout (arXiv 2603.17829), Sourcegraph Cody (arXiv 2408.05344),
Google "Sufficient Context" (ICLR 2025)
**SOTA Review**: 2026-04-02 — Verified against ContextBench, LightOn ColGrep, Cursor,
Claude Code, Copilot, Windsurf, and Sourcegraph Cody. No product publicly documents
explicit token-budget allocation across ranked results or calibrated confidence signals —
this plan innovates in both areas. Core architecture (symbol-complete expansion, tiered
presentation, header context) validated by AST-aware chunking research and the "What to
Retrieve" empirical study.

---

## 1. Problem Statement

Pattern search currently returns chunk metadata (file, startLine, endLine, score).
The caller must issue separate file reads to see the actual code. For agents, this
means:

- Extra round trips (Read tool calls per result)
- Wasted context window on tool call overhead
- Agent must decide what to read and how much
- Chunks are often too small (signature-only) or too large (whole file)

LightOn's ColGrep evaluation showed **56% fewer search operations** and **15.7% token
savings** when agents got better results upfront. Our goal: one pattern search returns
**self-contained, actionable context** so the agent doesn't need follow-up reads.

---

## 2. Design Principles

### 2.1 Two Modes, One Pipeline

The ranking pipeline is identical. Only the **post-ranking presentation** differs.

```
                     ┌─ benchmark mode → chunk IDs + scores (for eval)
regex + semantic ──→ │
  → ripgrep          │  ranking is
  → chunk mapping    │  IDENTICAL
  → MaxSim rerank   ─┤
                     │
                     └─ agent mode → context packages (for agents)
```

**Benchmark mode** (`format: 'benchmark'`): Returns the current structure —
`{ id, file, startLine, endLine, score, metadata }`. No code content. Used by
`eval/run_pattern_benchmark.js` and `eval/scripts/multirepo-bench.js`.

**Agent mode** (`format: 'agent'`): Returns symbol-complete context blocks with
code, metadata, and confidence signals. Used by MCP tool, CLI, and warm server.

### 2.2 The Unit is "Actionable Code Region", Not "Index Chunk"

An index chunk is an artifact of the chunking algorithm. An actionable code region
is what a developer (or agent) needs to understand the code. These are different:

| Chunk | Actionable Region |
|-------|-------------------|
| Function signature (3 lines) | Full function with body |
| Middle of a class (50 lines) | The specific method the query targets |
| Import block (10 lines) | The import + the module it references |
| Config constant (5 lines) | The constant + its type/documentation |

The expansion logic must produce actionable regions, not bigger chunks.

### 2.3 Token Budget, Not Line Count

Agents operate under token budgets, not line budgets. A 50-line Python function
costs fewer tokens than a 50-line Rust function with lifetime annotations.

The response must respect a total token budget (default: 4000 tokens for all
results combined) and allocate it smartly:
- Top-1 gets the most budget (up to 60%)
- Top-2 and Top-3 get compressed previews (up to 20% each)
- Remaining results get one-line summaries only

**Precision-recall tradeoff warning** (from ContextBench, arXiv 2602.05892):
Agents that aggressively expand context achieve higher recall but significantly
lower precision — and lower overall F1 — than agents with balanced retrieval
strategies. GPT-5 retrieves broadly and scores worse than Claude Sonnet 4.5,
which uses moderate retrieval rounds and moderate context sizes. The token
budget and per-result caps (§4.4) are the primary defense against over-retrieval.
The 60%/20%/20% allocation is an initial heuristic — instrument deployments to
empirically validate these ratios against agent task success rates.

---

## 3. Agent Mode Output Schema

```javascript
{
  // Metadata (same as benchmark mode, always present)
  query: "authentication service",
  regex: "class\\s+\\w+",
  mode: "pattern",
  totalResults: 5,
  latencyMs: 28,

  // Agent-specific
  format: "agent",
  tokenBudget: 4000,
  tokensUsed: 3200,
  confidence: "high",        // "high" | "medium" | "low"
  confidenceReason: "clear_winner",  // or "close_top2", "many_candidates", "low_recall"

  results: [
    {
      rank: 1,
      file: "core/sweet-search.js",
      startLine: 86,
      endLine: 140,
      symbol: "SweetSearch",
      symbolType: "class",
      score: 0.82,
      expanded: true,          // true if chunk was expanded beyond ranked boundaries
      expandedFrom: "88-116",  // original chunk line range
      presentation: "full",    // "full" | "preview" | "summary"
      stale: false,            // true if file modified since last index (dirty overlay)
      indexedAt: "2026-04-01T12:00:00Z",  // when this file was last indexed

      // The actual code — this is what the agent reads
      code: "export class SweetSearch {\n  constructor(options = {}) {\n    ...",
      codeTokens: 1800,

      // Optional: minimal header context (imports that matter for this symbol)
      headerContext: "import { LateInteractionIndex } from './late-interaction-index.js';",
      headerTokens: 45,
    },
    {
      rank: 2,
      file: "core/query-router.js",
      startLine: 62,
      endLine: 91,
      symbol: "QueryRouter",
      symbolType: "class",
      score: 0.45,
      expanded: false,
      presentation: "preview",  // compressed view
      code: "export class QueryRouter {\n  constructor() { ... }\n  route(query) { ... }\n}",
      codeTokens: 120,
    },
    {
      rank: 3,
      // ... summary only (one line)
      presentation: "summary",
      summary: "translation/alias-lookup.js:248 — AliasLookup class constructor",
      codeTokens: 0,
    }
  ]
}
```

---

## 4. Expansion Logic

### 4.1 Decision Tree

```
Is chunk a complete symbol (function/class/method)?
  YES → return as-is
  NO  → Is chunk a signature-only fragment (<10 lines)?
          YES → Look up enclosing symbol from chunk metadata
                → If found: expand to full symbol (up to per-result cap)
                → If not found: merge with next contiguous chunk
          NO  → Is chunk part of a known parent symbol?
                  YES → Include parent name + chunk as "method of X"
                  NO  → Return chunk as-is with a note
```

### 4.2 Symbol Expansion Sources

1. **Chunk metadata** (`metadata.symbol`, `metadata.chunk_type`): Already stored
   in the LI index. Tells us if the chunk is a function, class, method, etc.

2. **Code graph** (`code-graph.db`): Has entity definitions with exact line ranges.
   Query: given file + line range, find the enclosing entity.

3. **Sibling chunks**: The chunk location map has sorted intervals per file.
   Adjacent chunks in the same file are likely parts of the same symbol.

4. **AST parent links**: The cAST chunker stores hierarchical parent/child
   relationships. A method chunk knows its parent class.

**Industry precedent**: Sourcegraph Cody (arXiv 2408.05344) combines local IDE
context with remote search, ranking file snippets by relevance and supplementing
with SCIP/LSIF symbol data for compiler-accurate cross-repo navigation. Our
expansion sources (chunk metadata, code graph, sibling chunks, AST parents) are
a superset of what Cody uses, with the addition of the code graph entity lookup
that enables expansion to full symbol boundaries.

### 4.3 Priority Order for Expansion

1. Check if chunk already covers a full symbol → done
2. Look up enclosing entity in code graph → expand to entity boundaries
3. Merge contiguous sibling chunks in the same file → stop at next symbol boundary
4. Fall back: return chunk as-is

### 4.4 Per-Result Token Cap

Each result has a soft cap (default: 2000 tokens for rank 1, 800 for rank 2,
400 for rank 3). If the expanded symbol exceeds the cap:
- Truncate at the end with `// ... (N more lines)`
- Prefer keeping the beginning (signature + first N lines of body)
- Never truncate mid-statement

**Expansion vs precision** (from ContextBench, arXiv 2602.05892): Expansion
beyond the matched chunk region improves recall (more of the relevant code is
included) but can hurt precision if the expanded region contains unrelated code
(other methods in the same class, unrelated imports). The per-result token cap
is the primary defense: it forces expansion to stop before the region becomes
too broad. ContextBench also identified a "context usage drop" — agents
successfully retrieve 30-50% more relevant context than they actually use in
their final outputs. This means over-expanding wastes tokens that the agent
ignores. The tiered presentation (full/preview/summary) partially addresses
this by concentrating budget on top-1 where usage is highest.

---

## 5. Confidence Signals

The agent mode response includes confidence indicators so the agent can decide
whether to trust the results or search again.

| Signal | Value | Meaning |
|--------|-------|---------|
| `confidence: "high"` | Top-1 score > 2× top-2 | Clear winner, agent should trust it |
| `confidence: "medium"` | Top-1 and top-2 within 20% | Ambiguous, agent may want both |
| `confidence: "low"` | Candidate recall was low or many ties | Agent should consider a different query |
| `confidenceReason` | String | Human-readable explanation |

Confidence is computed from:
- Score gap between top-1 and top-2
- Candidate recall (from pipeline diagnostics)
- Number of regex matches (low = very selective regex, likely correct)

**Calibration plan**: The thresholds above (2× gap for "high", within 20% for
"medium") are initial heuristics. No published standard exists for confidence
signals in code search results — the Tavily industry survey (April 2026)
confirmed that Cursor, Copilot, Cody, and Windsurf do not expose calibrated
confidence to agents. This plan innovates here.

To validate: instrument deployments to log confidence predictions alongside
binary correctness labels (did the agent use the top-1 result without
follow-up reads?). After collecting ~500 data points, fit a simple calibration
model (isotonic regression or logistic) and adjust thresholds. Report
calibration error (ECE) in Track B2 evaluation.

**Sufficiency signal** (inspired by Google's "Sufficient Context" work, ICLR
2025): Beyond "is top-1 clearly better than top-2", consider a sufficiency
heuristic: does the returned context likely contain enough information to
answer the query? Signals include: (a) the expanded region contains a complete
symbol (not truncated), (b) header context resolves all referenced imports,
(c) the score gap suggests the match is specific, not generic. If all three
hold, the agent can trust the result without follow-up reads.

---

## 6. Header Context

For the top-1 result, optionally include a minimal "header" — the imports or
declarations that help the agent understand the code without reading the whole file.

Rules:
- Only for top-1 result
- Maximum 200 tokens
- Include only imports that are referenced in the returned code
- Include the class/module declaration line if the result is a method

This is NOT the full file header. It's the minimal set of declarations needed
to understand the returned code block.

Implementation: scan the result code for identifiers, cross-reference with the
file's import block, return only matching imports.

**Research validation** (arXiv 2503.20589, "What to Retrieve for Effective
RAG Code Generation", Sun Yat-Sen/Huawei, 2025): This empirical study found
that **contextual code + API information are the two most valuable retrieval
types** for code generation, improving Pass@1 by up to 20%. Critically, it
found that **similar code snippets can degrade performance by up to 15%** —
they introduce noise and excessive input length that hurts the model.

This directly validates our header context design (contextual imports + API
declarations) and our §16 decision to NOT do cross-file expansion (which would
bring in "similar code" from other files).

---

## 7. Token Estimation

Use the existing `codebase.db` token estimation or a fast approximation:
- Code: ~3.5 characters per token (empirical average for code)
- Comments: ~4.5 characters per token
- Whitespace-heavy: ~5 characters per token

Don't use the tokenizer on the hot path — character-based estimation is sufficient
for budget management.

---

## 8. Integration Points

### 8.1 CLI (`search-cli.js`)

```bash
# Current (benchmark-style output)
ss -e "class.*Service" "authentication"

# Agent mode (returns code blocks)
ss -e "class.*Service" "authentication" --agent
ss -e "class.*Service" "authentication" --agent --budget=6000
```

### 8.2 MCP Tool (`mcp/server.js`)

The MCP search tool should support agent mode as an explicit opt-in parameter.
Do not default to agent mode — validate with Track B2 eval first, then promote
if proven. The tool description should explain what the agent gets back.

```json
{
  "name": "search",
  "parameters": {
    "query": "authentication service",
    "regex": "class.*Service",
    "format": "agent",
    "tokenBudget": 4000
  }
}
```

### 8.3 Warm Server (`search-server.js`)

```
GET /search?q=authentication&regex=class.*Service&format=agent&budget=4000
```

### 8.4 Programmatic

```javascript
const { results } = await searcher.search("authentication", {
  mode: "pattern",
  regex: "class.*Service",
  format: "agent",
  tokenBudget: 4000,
});
// results[0].code contains the full class definition
```

---

## 9. Implementation Phases

### Phase 1: Basic Agent Mode (Simplest Useful Version)

Return the top-k results with code content loaded, no expansion.
This is just `readFileRange()` applied to each result.

**Files**: `core/search-pattern.js` (add format option to patternSearch)
**Effort**: 0.5 day
**Value**: Agents get code without follow-up reads

### Phase 2: Symbol-Complete Expansion

Expand signature-only chunks to full symbols using code graph entity lookup.
Merge contiguous sibling chunks.

**Files**: `core/search-pattern.js`, new `core/context-expander.js`
**Effort**: 1-2 days
**Value**: Results are self-contained, not fragments

### Phase 3: Token Budget Management

Add token estimation, per-result caps, and presentation tiers
(full/preview/summary). Total budget allocation across results.

**Files**: `core/context-expander.js`, `core/search-pattern.js`
**Effort**: 1 day
**Value**: Predictable context window usage

### Phase 4: Header Context

Add minimal import/declaration context for top-1 result.
Scan code for references, cross-reference with file imports.

**Files**: `core/context-expander.js`
**Effort**: 0.5 day
**Value**: Agent understands the code without reading the full file

### Phase 5: Confidence Signals

Compute confidence from score gaps, candidate recall, regex selectivity.
Include in response for agent decision-making.

**Files**: `core/search-pattern.js`
**Effort**: 0.5 day
**Value**: Agent knows when to trust results vs search again

---

## 10. Benchmark Compatibility

**No ranking-quality regression by design.** The benchmark always uses
`format: 'benchmark'` (the default for eval scripts). The agent format is a
post-ranking presentation layer that does not affect:
- Ripgrep candidate generation
- Chunk mapping
- MaxSim scoring
- Result ranking order

The ranking is frozen before the format switch. Agent mode only transforms
how the already-ranked results are presented.

**Still requires measurement:** Latency overhead from expansion, content-loading
bugs, and schema drift between modes are possible. After implementation, verify:
- Run benchmark in both modes, assert identical ranking order
- Measure latency delta (target: <5ms overhead for expansion)
- Run existing eval suite to catch any accidental coupling

---

## 11. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Token savings vs rg+read | >30% | Agent-in-the-loop eval (Track B2) |
| Search operations saved | >50% | Count tool calls in agent workflow |
| Self-containment rate | >80% | % of queries where agent doesn't need follow-up reads |
| Context relevance | >90% | % of returned code that agent actually uses |
| Latency overhead | <5ms | Timer around expansion logic |

### Evaluation Plan

Run Track B2 (agent-in-the-loop) from COLGREP_PLAN.md:
1. Generate code questions for each benchmark repo
2. Run agent with pattern search (agent mode) vs agent with rg+read
3. Measure: answer quality, token usage, search operations, turn count
4. This is the definitive test of whether agent mode helps

---

## 12. Agent Sub-Modes

Two agent presentation tiers, selectable by the caller:

| Mode | Top-1 | Top-2/3 | Budget | Use Case |
|------|-------|---------|--------|----------|
| `agent_preview` | Full expanded code | Compressed (signature + first 5 lines) | 4000 tokens | Default for MCP/CLI — fast, bounded |
| `agent_full` | Full expanded code | Full expanded code | 8000 tokens | When agent explicitly requests more context |

Both modes share the same ranking. The difference is only how many results
get full expansion vs compression.

---

## 13. Fallback Behavior When Expansion Fails

Expansion can fail when:
- Code graph has no entity for the chunk's file/line range
- Sibling chunks are not contiguous (gap in line ranges)
- File was modified since indexing (content mismatch)

Fallback chain:
1. Try code graph entity lookup → if fails:
2. Try sibling chunk merge (contiguous only) → if fails:
3. Try raw `readFileRange` with ±20 lines padding → if fails:
4. Return chunk metadata only (no code), set `expanded: false, fallbackReason: "..."`

The agent receives `expanded: false` and knows it may need a follow-up read.
This is strictly better than the current behavior (always no code).

---

## 14. Ranking Identity Verification

After implementing agent mode, add a CI-level assertion:

```javascript
// In test suite: verify ranking identity between modes
const benchResult = await search.search(query, { mode: 'pattern', regex, format: 'benchmark' });
const agentResult = await search.search(query, { mode: 'pattern', regex, format: 'agent' });

// Ranking order must be identical
assert.deepEqual(
  benchResult.results.map(r => r.id),
  agentResult.results.map(r => r.id),
);
```

This test runs on every CI build to prevent accidental coupling between
the presentation layer and the ranking pipeline.

---

## 15. Track B2: Agent-in-the-Loop Evaluation Protocol

### 15.1 Overview

A head-to-head comparison: an agent answers code questions using ColGrep
pattern search (agent mode) vs the same agent using standard rg+read.
Measures answer quality, token savings, and search efficiency.

This is the definitive test of whether ColGrep actually helps agents.

### 15.2 Setup

- **Agent model**: Claude Sonnet (via API with tool use)
- **Judge model**: Claude Opus (separate evaluation pass, blind to system labels)
- **Repos**: Same 5 benchmark repos (sweet-search, ripgrep, gin, flask, fastify)
- **Questions**: 30 per repo (150 total) at 3 difficulty levels (10 each)

### 15.3 Question Generation

Questions are generated by Claude Opus, one-shot, per repo:

```
Given the {repo} codebase, generate 30 code questions at 3 difficulty levels:

EASY (10): "Where is X defined?" / "What does function Y do?"
  - Answers require finding one specific entity
  - Example: "Where is the SweetSearch class constructor defined?"

MEDIUM (10): "How does X work?" / "What calls Y?"
  - Answers require understanding a module or data flow
  - Example: "How does the query router decide between lexical and semantic search?"

HARD (10): "How would I change X to do Y?" / "What's the relationship between X and Z?"
  - Answers require cross-file understanding or architectural knowledge
  - Example: "How would I add a new search mode to Sweet Search?"

Each question must have:
- A clear, unambiguous answer findable in the codebase
- A difficulty level
- A list of key files the answer involves (for judge reference)
```

Questions are frozen before any baseline runs. Stored in
`eval/data/agent-eval/{repo}/questions.jsonl`.

### 15.4 Baselines

Three systems, each given the same questions:

| System | Tools Available | Description |
|--------|----------------|-------------|
| **rg+read** | `grep(regex, dir)` → file:line matches, `read(file, start, end)` → code | Standard agent workflow. Agent greps, reads files, builds understanding. |
| **pattern+meta** | `pattern_search(regex, query)` → ranked chunk metadata (no code) | ColGrep ranking but agent must still Read to see code. |
| **pattern+agent** | `pattern_search(regex, query, format=agent)` → ranked code blocks | ColGrep with full context packages. Agent gets code directly. |

Each system runs the same agent model on the same questions with the same
system prompt. Only the available tools differ.

**Future baseline**: CodeScout (arXiv 2603.17829, March 2026) uses
reinforcement learning to train code search agents for code localization,
achieving better search strategies than static tools. If CodeScout or similar
RL-trained search agents become available as tools, they should be added as a
fourth baseline to measure whether learned search strategies outperform our
static ranking + context packaging approach.

### 15.5 Agent Execution

Each question is answered in an isolated conversation:

```javascript
// Pseudocode for one question evaluation
const conversation = await runAgent({
  model: 'claude-sonnet-4-6',
  systemPrompt: SYSTEM_PROMPT,  // same for all baselines
  tools: baselineTools[system],  // different per system
  userMessage: question.text,
  maxTurns: 10,
  tokenLimit: 50000,
});

// Record
const record = {
  questionId: question.id,
  system: system,
  answer: conversation.finalAnswer,
  totalTokens: conversation.totalTokens,
  inputTokens: conversation.inputTokens,
  outputTokens: conversation.outputTokens,
  toolCalls: conversation.toolCalls.length,
  searchCalls: conversation.toolCalls.filter(t => t.name.includes('search') || t.name.includes('grep')).length,
  readCalls: conversation.toolCalls.filter(t => t.name === 'read').length,
  turns: conversation.turns,
  elapsedMs: conversation.elapsedMs,
};
```

### 15.6 Judging

Each answer is evaluated by Claude Opus in a separate, blind pass:

```
You are judging the quality of a code question answer.

Question: {question.text}
Expected key files: {question.keyFiles}
Answer: {answer}

Rate the answer on these dimensions (1-5 each):

1. CORRECTNESS: Is the answer factually correct about the codebase?
   1=wrong, 3=partially correct, 5=fully correct

2. COMPLETENESS: Does the answer cover all relevant aspects?
   1=missing major parts, 3=covers main points, 5=comprehensive

3. SPECIFICITY: Does the answer reference specific files/functions/lines?
   1=vague, 3=mentions some specifics, 5=precise references

4. ACTIONABILITY: Could a developer act on this answer immediately?
   1=needs more research, 3=mostly actionable, 5=ready to implement

Overall quality (1-5): weighted average (correctness × 2 + completeness +
specificity + actionability) / 5
```

The judge does NOT see which system produced the answer. Answers are
shuffled and anonymized.

### 15.7 Metrics

| Metric | How Measured | Target for pattern+agent |
|--------|-------------|-------------------------|
| **Answer quality** | Judge overall score (1-5) | ≥ rg+read average |
| **Win rate** | % questions where pattern+agent scores higher | >60% |
| **Total tokens** | Sum of input + output tokens | <80% of rg+read (>20% savings) |
| **Input tokens** | Tokens consumed by tool results | <60% of rg+read (>40% savings) |
| **Search operations** | grep/search tool calls | <50% of rg+read |
| **Read operations** | file read tool calls | <30% of rg+read |
| **Turn count** | Agent conversation turns | ≤ rg+read |
| **Self-containment** | % questions answered without Read calls | >80% |
| **Time to answer** | Wall clock (agent + tools) | <75% of rg+read |
| **Context precision** | ContextBench-style: proportion of returned code agent actually uses | >60% |
| **Context recall** | Proportion of gold-standard code locations included in search results | >70% |
| **Confidence calibration** | ECE (expected calibration error) of confidence signals | <0.15 |

### 15.8 Pass/Fail Criteria

| Verdict | Criteria |
|---------|----------|
| **SHIP** | Quality ≥ baseline AND token savings >20% AND self-containment >80% AND win rate >55% |
| **CONDITIONAL** | Quality ≥ baseline AND token savings 10-20% OR self-containment 60-80% |
| **NO-SHIP** | Quality < baseline OR self-containment <60% OR win rate <45% |

### 15.9 Protocol

1. **Generate questions**: Opus generates 30 questions per repo (frozen before baselines)
2. **Implement tool adapters**: Create tool wrappers for each of the 3 systems
3. **Run rg+read baseline**: All 150 questions, record answers + metrics
4. **Run pattern+meta baseline**: Same questions, pattern search without code
5. **Run pattern+agent treatment**: Same questions, pattern search with code packages
6. **Blind judging**: Opus rates all 450 answers (150 × 3 systems), shuffled
7. **Compute metrics**: Per-repo + aggregate, with bootstrap confidence intervals
8. **Manual audit (mandatory)**: Review 20% of cases where judge scores diverge
   by >2 points — Claude-as-judge can be biased on architectural questions
9. **Decision**: Apply pass/fail criteria, decide whether to ship agent mode as default

### 15.10 Implementation

```
eval/
  agent-eval/
    questions/              # Frozen question sets
      sweet-search.jsonl
      ripgrep.jsonl
      gin.jsonl
      flask.jsonl
      fastify.jsonl
    tools/                  # Tool adapters per baseline
      grep-read-tools.js
      pattern-meta-tools.js
      pattern-agent-tools.js
    run-agent-eval.js       # Main runner
    judge-answers.js        # Blind judging script
    report.js               # Metrics computation
    results/                # Raw results (gitignored)
```

### 15.11 Controlled Experiment Requirements

All 3 systems MUST have identical:
- Turn limit (10)
- System prompt (same text, only tool definitions differ)
- Repo snapshot (same pinned SHAs)
- Timeout per question (120s)
- Tool schema style (same parameter naming convention)
- Token limit per conversation (50K)

### 15.12 Statistical Rigor

Report paired bootstrap confidence intervals (95%) on all metrics, not just
averages. Use 1000 bootstrap samples. Since each question is answered by all
3 systems, pair by question ID for the bootstrap.

The judge should receive a brief **reference answer** (2-3 sentences describing
the expected code locations and key facts) alongside the agent's answer. This
prevents mushy scoring on architectural questions where the judge lacks context.

**LLM-as-Judge best practices** (from arXiv 2510.24367, "LLM-as-a-Judge for
Software Engineering: Literature Review"):
- Run 2-3 judge evaluations per answer to measure inter-judge consistency.
  If agreement is low (>1 point divergence), flag for manual review.
- Report performance separately on high-agreement vs low-agreement questions —
  this exposes whether the system excels on clear-cut cases but struggles on
  ambiguous ones, a distinction that aggregate scores hide.
- Acknowledge subjectivity in SE tasks: treat the range of judge opinions as
  signal, not noise. Distribution-aware metrics (e.g., variance of scores per
  question) are more informative than bare means.

**Process-level metrics** (inspired by ContextBench, arXiv 2602.05892): Beyond
final answer quality, instrument the agent's search calls during Track B2 to
measure intermediate context retrieval behavior:
- **Context precision**: what proportion of returned code did the agent actually
  reference in its answer? (Measures whether we're over-delivering context.)
- **Context recall**: what proportion of gold-standard code locations appeared
  in search results? (Measures whether the search found the right code.)
- **Context usage drop**: what proportion of relevant retrieved context was
  NOT used in the final answer? ContextBench found this is 30-50% for SOTA
  agents — a key inefficiency the tiered presentation aims to reduce.

**Estimated effort**: 2-3 days for implementation, 1 day for running all baselines,
0.5 day for judging and analysis.

### 15.13 Cost Estimate

- 150 questions × 3 systems × ~20K tokens/conversation = ~9M agent tokens
- 450 answers × ~2K tokens/judgment = ~900K judge tokens
- Total: ~10M tokens ≈ $30-50 at Sonnet/Opus pricing
- Wall time: ~4-6 hours for all baselines (sequential)

---

## 16. What NOT to Build (unchanged)

1. **Full-file context**: Never return an entire file. That defeats the purpose.
2. **Cross-file expansion**: Don't follow imports to other files. That's a
   different search, not expansion. Research confirms this: the "What to
   Retrieve" study (arXiv 2503.20589) found that retrieving similar code from
   other files can **degrade** code generation performance by up to 15% —
   the noise from irrelevant cross-file content outweighs any benefit.
3. **Summarization**: Don't use an LLM to summarize the code. Return the code
   itself — the agent IS an LLM and can read it directly.
4. **Speculative pre-fetching**: Don't guess what the agent might need next.
   Return what was asked for, with confidence signals for whether more is needed.

---

## 17. Priority Order

| # | Phase | Effort | Impact |
|---|-------|--------|--------|
| 1 | Basic agent mode (code in results) | 0.5 day | HIGH — eliminates follow-up reads |
| 2 | Symbol-complete expansion | 1-2 days | HIGH — self-contained results |
| 3 | Token budget management | 1 day | MEDIUM — predictable context usage |
| 4 | Header context | 0.5 day | MEDIUM — better code understanding |
| 5 | Confidence signals | 0.5 day | MEDIUM — agent decision support |
| 6 | Agent-in-the-loop eval (Track B2) | 2-3 days | HIGH — validates the whole approach |

**Critical path**: Phases 1-2, then Track B2 evaluation. Phases 3-5 are
refinements that can ship incrementally.
