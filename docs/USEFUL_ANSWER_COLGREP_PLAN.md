# Agent-Facing Context Packaging for ColGrep Pattern Search

**Status**: Planning
**Priority**: HIGH (this is the product value — agents save tokens and search steps)
**Prerequisites**: Pattern search MVP (done), multi-repo benchmark (done)
**References**: COLGREP_PLAN.md, ContextBench (arXiv 2602.05892), Context as a Tool
(arXiv 2512.22087), RepoCoder (EMNLP 2023), CodeRAG (EMNLP 2025), LightOn ColGrep blog

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
| Token savings vs grep+read | >30% | Agent-in-the-loop eval (Track B2) |
| Search operations saved | >50% | Count tool calls in agent workflow |
| Self-containment rate | >80% | % of queries where agent doesn't need follow-up reads |
| Context relevance | >90% | % of returned code that agent actually uses |
| Latency overhead | <5ms | Timer around expansion logic |

### Evaluation Plan

Run Track B2 (agent-in-the-loop) from COLGREP_PLAN.md:
1. Generate code questions for each benchmark repo
2. Run agent with pattern search (agent mode) vs agent with grep+read
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

### Setup
- **Agent**: Claude (via Claude Code or API)
- **Judge**: Claude (separate evaluation pass, blind to which system produced results)
- **Repos**: Same 5 benchmark repos
- **Questions**: 50 per repo (250 total), generated at 3 difficulty levels

### Baselines
1. **grep+read**: Agent uses grep/glob + Read tool (standard Claude Code workflow)
2. **pattern+benchmark**: Pattern search returning metadata only (agent must Read)
3. **pattern+agent**: Pattern search returning context packages (no follow-up reads needed)

### Metrics
| Metric | Description | Target |
|--------|-------------|--------|
| Answer quality | Judge rates 1-5 | pattern+agent ≥ grep+read |
| Token usage | Total tokens consumed | pattern+agent < grep+read by >20% |
| Search operations | Tool calls for search/read | pattern+agent < grep+read by >40% |
| Turn count | Conversation turns to answer | pattern+agent ≤ grep+read |
| Self-containment | % where agent answered without follow-up reads | >80% |

### Pass/Fail Criteria
- **PASS**: Answer quality ≥ baseline AND token savings >20% AND self-containment >80%
- **CONDITIONAL**: Answer quality ≥ baseline BUT token savings 10-20%
- **FAIL**: Answer quality < baseline OR self-containment <60%

### Protocol
1. Generate questions (use Claude to create realistic code questions per repo)
2. Freeze question set before running any baseline
3. Run each baseline blind (judge doesn't see system labels)
4. Manual audit 20% of judge disagreements
5. Report per-repo and aggregate

---

## 16. What NOT to Build (unchanged)

1. **Full-file context**: Never return an entire file. That defeats the purpose.
2. **Cross-file expansion**: Don't follow imports to other files. That's a
   different search, not expansion.
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
