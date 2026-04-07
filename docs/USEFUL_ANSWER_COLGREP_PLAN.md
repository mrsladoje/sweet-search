# Agent-Facing Context Packaging for ColGrep Pattern Search

**Status**: Planning
**Priority**: HIGH (this is the product value — agents save tokens, latency, AND search steps)
**Prerequisites**: Pattern search MVP (done), multi-repo benchmark (done)
**References**: COLGREP_PLAN.md, ContextBench (arXiv 2602.05892), Context as a Tool
(arXiv 2512.22087), RepoCoder (EMNLP 2023), CodeRAG (arXiv 2509.16112),
LightOn ColGrep blog (Feb 2026), Reason-ModernColBERT (LightOn, March 2026),
"What to Retrieve for Effective RAG Code Generation" (arXiv 2503.20589),
CodeScout (arXiv 2603.17829), ToolTrain (arXiv 2508.03012),
Sourcegraph Cody (arXiv 2408.05344, RecSys 2024),
"LLM-as-a-Judge for Software Engineering" (arXiv 2510.24367),
SWE-ContextBench (arXiv 2602.08316), Theory of Code Space (arXiv 2603.00601),
Evaluating AGENTS.md (arXiv 2602.11988), FastCode (arXiv 2603.01012),
Beyond Localization (arXiv 2603.29067),
Improving Code Localization with Repository Memory (ICLR 2026)
**SOTA Review**: 2026-04-07 — Full re-verification against ContextBench, LightOn ColGrep
+ Reason-ModernColBERT, Cursor, Claude Code, Copilot, Windsurf, Sourcegraph Cody, and
8 new 2026 papers. No product publicly documents explicit token-budget allocation across
ranked results or calibrated confidence signals — this plan innovates in both areas.
Core architecture validated by AST-aware chunking research and the "What to Retrieve"
empirical study. Counter-evidence from ToCS, AGENTS.md evaluation, and ContextBench
"Bitter Lesson" finding engaged in new §4.5.
**Prior reference removed**: "Google Sufficient Context (ICLR 2025)" — extensive search
across Semantic Scholar, OpenAlex, arXiv, and DBLP found no matching paper. The
sufficiency heuristic in §5 is retained as original design, not attributed to a paper.

---

## 1. Problem Statement

Pattern search currently returns chunk metadata (file, startLine, endLine, score).
The caller must issue separate file reads to see the actual code. For agents, this
means:

- **Extra latency**: each follow-up Read is a full tool-call round trip (agent
  generates call → tool executes → response streams back → agent resumes reasoning).
  For top-3 results that's 3 sequential round trips before the agent can even start
  thinking about the answer.
- **Wasted tokens**: each Read tool call costs ~50-100 tokens of overhead (tool name,
  parameters, response framing) on top of the code content itself.
- **Agent must decide what to read and how much**: the agent burns reasoning tokens
  deciding which results to Read, and often reads too much or too little.
- **Chunks are often too small (signature-only) or too large (whole file)**

The critical insight: **returning code in the search result eliminates the Read
round-trip entirely**. The agent gets ranked, self-contained code blocks in a single
tool response. No follow-up calls. No wasted reasoning on "should I read this file?"
The speed gain is not just token savings — it's wall-clock latency from removing
sequential tool calls from the agent's critical path.

LightOn's ColGrep evaluation (Feb 2026) showed **56% fewer search operations** and
**15.7% token savings** when agents got better results upfront. Their follow-up work,
Reason-ModernColBERT (March 2026), took #1 on BrowseComp-Plus with 87.59% accuracy
using only 149M parameters — outperforming retrievers 54× its size. This validates
the late-interaction (MaxSim) architecture our own ranking pipeline uses.

Our goal: one pattern search returns **self-contained, actionable context** — the
agent reads the code directly from the search response and proceeds to reason,
with zero follow-up reads.

**Caution — context overload risk** (ContextBench "Bitter Lesson", arXiv 2602.05892;
Theory of Code Space, arXiv 2603.00601; Evaluating AGENTS.md, arXiv 2602.11988):
Three independent 2026 studies found that delivering MORE context upfront can hurt
agent performance. ContextBench found LLMs favor recall over precision, and
"substantial gaps exist between explored and utilized context." ToCS found GPT-5.3
actually performs better with active exploration than receiving the full codebase at
once (information overload). The AGENTS.md evaluation found that repository context
files "generally reduce task success rates while increasing inference cost." These
findings reinforce the plan's per-result token caps (§4.4) and tiered presentation
(§2.3) as essential guardrails — the goal is NOT to return as much code as possible,
but to return the **right** code at the **right** granularity. See §4.5 for detailed
engagement with this counter-evidence.

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
strategies. On the ContextBench leaderboard, Claude Sonnet 4.5 ranks #1 (53.0%
Pass@1, 0.344 Line F1) while GPT-5 ranks #2 (47.2%, 0.312 Line F1) — GPT-5
retrieves broadly and scores worse. The paper's headline finding — "The Bitter
Lesson" of coding agents: more scaffolding does NOT mean better context
retrieval — reinforces that the value is in precision of what we return, not
volume. The token budget and per-result caps (§4.4) are the primary defense
against over-retrieval. The 60%/20%/20% allocation is an initial heuristic —
instrument deployments to empirically validate these ratios against agent task
success rates.

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
      file: "core/search/sweet-search.js",
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
      file: "core/query/query-router.js",
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

**DDD constraint**: After the domain boundary refactor, all database access
(code graph, codebase) goes through `core/infrastructure/codebase-repository.js`.
Expansion logic MUST call repository methods, not query `.sweet-search/code-graph.db`
or `.sweet-search/codebase.db` directly.

1. **Chunk metadata** (`metadata.symbol`, `metadata.chunk_type`): Already stored
   in the LI index. Tells us if the chunk is a function, class, method, etc.

2. **Code graph** (via `CodebaseRepository`): Has entity definitions with exact
   line ranges. Query: given file + line range, find the enclosing entity.

3. **Sibling chunks**: The chunk location map has sorted intervals per file.
   Adjacent chunks in the same file are likely parts of the same symbol.

4. **AST parent links**: The cAST chunker stores hierarchical parent/child
   relationships. A method chunk knows its parent class.

**Industry precedent**: Sourcegraph Cody (arXiv 2408.05344, RecSys 2024) combines
local IDE context with remote search, ranking file snippets by relevance and
supplementing with SCIP/LSIF symbol data for compiler-accurate cross-repo
navigation. Our expansion sources (chunk metadata, code graph, sibling chunks,
AST parents) are a superset of what Cody uses, with the addition of the code
graph entity lookup that enables expansion to full symbol boundaries.

**Newer approach — structural scouting**: FastCode (arXiv 2603.01012, March 2026)
decouples repository exploration from content consumption. A lightweight structural
scout navigates the repository, then full content is consumed only for relevant
regions. This validates our two-phase approach (ranking → expansion) over monolithic
"retrieve everything" strategies.

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

### 4.5 Counter-Evidence: When More Context Hurts

Three independent 2026 papers converge on a warning that must shape this design:

1. **ContextBench "Bitter Lesson"** (arXiv 2602.05892): "Sophisticated agent
   scaffolding yields only marginal gains in context retrieval." Better search
   tools help, but the model's intrinsic ability dominates. This means our
   expansion logic should be **precise**, not **generous** — the model won't
   magically use extra context just because we deliver it.

2. **Theory of Code Space** (arXiv 2603.00601, Feb 2026): Found an "Active-
   Passive Gap" — GPT-5.3-Codex actually performs BETTER when actively exploring
   a codebase than when receiving the entire codebase at once. Information
   overload from seeing 27-30 files simultaneously "overwhelms the model's
   ability to identify dependency relationships." This directly supports our
   tiered presentation: deliver the top-1 result in full, compress the rest.

3. **Evaluating AGENTS.md** (arXiv 2602.11988, ETH Zurich, Feb 2026):
   Repository-level context files "generally reduce task success rates compared
   to providing no repository context while increasing inference cost." Broad
   context injection hurts more than it helps.

4. **Beyond Localization** (arXiv 2603.29067, March 2026): Studies what
   happens after localization is strengthened in RAG-based program repair.
   Found that improved localization does translate to better end-to-end
   results, but with diminishing returns — the "residual frontier" of
   post-localization improvement is bounded. This validates focusing on the
   top-1 result quality rather than exhaustively expanding all results.

5. **Context as a Tool (CAT)** (arXiv 2512.22087, Dec 2025, 7 citations):
   Formalizes structured context workspaces for SWE agents with stable task
   semantics, condensed long-term memory, and high-fidelity short-term
   interactions. SWE-Compressor achieves 57.6% on SWE-Bench-Verified under
   bounded context budgets. Validates our bounded-budget approach — even the
   best context management system enforces strict token limits.

**What this means for us**: The latency win from eliminating Read round-trips
is unambiguous — fewer tool calls is always faster. But the content we return
must be **surgical**. The per-result caps (§4.4) and tiered presentation (§2.3)
are not nice-to-haves — they are essential guardrails validated by independent
research. The default budget (4000 tokens total across all results) should err
on the side of too little rather than too much. An agent that needs more can
always issue a follow-up Read — but an agent drowning in irrelevant context
has no recourse.

**Design rule**: when in doubt, return less code at higher precision. The
expansion logic should prefer returning a complete function over a complete
class, and a complete method over a complete file section.

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

**Sufficiency signal**: Beyond "is top-1 clearly better than top-2", consider
a sufficiency heuristic: does the returned context likely contain enough
information to answer the query? Signals include: (a) the expanded region
contains a complete symbol (not truncated), (b) header context resolves all
referenced imports, (c) the score gap suggests the match is specific, not
generic. If all three hold, the agent can trust the result without follow-up
reads. This is our own design — no published product or paper documents an
equivalent sufficiency signal for code search results as of April 2026.

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

Use the existing token estimation (via `CodebaseRepository`) or a fast approximation:
- Code: ~3.5 characters per token (empirical average for code)
- Comments: ~4.5 characters per token
- Whitespace-heavy: ~5 characters per token

Don't use the tokenizer on the hot path — character-based estimation is sufficient
for budget management.

---

## 8. Integration Points

### 8.1 CLI (`core/search/search-cli.js`)

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

### 8.3 Warm Server (`core/search/search-server.js`)

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

**Files**: `core/search/search-pattern.js` (add format option to patternSearch)
**Effort**: 0.5 day
**Value**: Agents get code in the search response — zero Read tool calls needed.
This is the single biggest latency win: eliminates 1-3 sequential round trips.

### Phase 2: Symbol-Complete Expansion

Expand signature-only chunks to full symbols using code graph entity lookup
(via `CodebaseRepository`). Merge contiguous sibling chunks.

**Files**: `core/search/search-pattern.js`, new `core/search/context-expander.js`
**Effort**: 1-2 days
**Value**: Results are self-contained, not fragments

### Phase 3: Token Budget Management

Add token estimation, per-result caps, and presentation tiers
(full/preview/summary). Total budget allocation across results.
This phase is critical for avoiding the context overload problem
identified in §4.5 — budget discipline is what makes agent mode
an improvement over "just return more stuff."

**Files**: `core/search/context-expander.js`, `core/search/search-pattern.js`
**Effort**: 1 day
**Value**: Predictable context window usage

### Phase 4: Header Context

Add minimal import/declaration context for top-1 result.
Scan code for references, cross-reference with file imports.

**Files**: `core/search/context-expander.js`
**Effort**: 0.5 day
**Value**: Agent understands the code without reading the full file

### Phase 5: Confidence Signals

Compute confidence from score gaps, candidate recall, regex selectivity.
Include in response for agent decision-making.

**Files**: `core/search/search-pattern.js`
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

That separation is necessary, but it is not enough. This plan needs a benchmark-first
program with two layers:

### 10.1 Ranking identity and schema invariants

Still measure the basic invariants after every agent-mode change:
- Run pattern benchmark in both modes, assert identical ranking order
- Measure latency delta between `format: 'benchmark'` and `format: 'agent'`
- Run existing eval suite to catch accidental coupling or schema drift

These are CI gates, not optional checks.

### 10.2 Track B1.5: Intrinsic context-quality benchmark

Before relying on agent-in-the-loop results, add an intrinsic benchmark pass to
`eval/run_pattern_benchmark.js` (or a sibling harness) that evaluates the presentation
layer without an LLM in the loop.

Report cache state explicitly in any latency numbers:
- **Warm packaging latency** is the primary metric for Track B1.5 because it isolates
  the presentation-layer cost after search state is already resident.
- If the intrinsic harness measures end-to-end search + packaging, publish **cold** and
  **warm** separately. Do not mix first-query startup costs with steady-state tool
  latency.

For each benchmark query, run the same ranked results through both formats and measure:

| Metric | What it proves | Measurement |
|--------|----------------|-------------|
| Symbol completeness | Result contains a full function/class/method, not a fragment | Parse returned region and verify complete AST/entity boundaries |
| Expansion accuracy | Expansion added the right code, not adjacent noise | Compare expanded range to gold symbol or frozen chunk-boundary annotations |
| Header correctness | Header context is useful and not dangling | Imported identifiers or referenced symbols resolve inside the returned block |
| Token efficiency | Packaging reduces agent context cost instead of inflating it | Compare delivered tokens against metadata mode plus simulated follow-up reads |
| Staleness accuracy | Dirty overlay metadata is trustworthy | Modify indexed files and verify `stale` is set correctly |
| Latency overhead | Packaging is cheap enough for default use | `agent_ms - benchmark_ms`, target `<5ms` p50 |
| Round-trip savings | Agent mode eliminates Read calls entirely | Simulate: metadata-mode agent needs N Reads vs agent-mode needs 0 — measure total wall-clock including tool-call overhead |
| Context overload risk | Expanded results don't exceed useful size | Flag results where codeTokens > 1500 and presentation is "full" — these risk the overload documented in §4.5 |

This is the missing bridge between "format-only change" and the full Track B2 study.
It is cheap, deterministic, and gives fast feedback while the packaging logic evolves.

**New external benchmarks to cross-reference** (added 2026-04-07):
- **ContextBench** (arXiv 2602.05892): provides gold-context annotations and
  retrieval precision/recall metrics. Our Track B1.5 symbol completeness and
  expansion accuracy metrics should be comparable to their Line F1.
- **SWE-ContextBench** (arXiv 2602.08316): evaluates context reuse across
  related tasks. If we freeze a set of related queries from our benchmark repos,
  we can measure whether agent mode enables context reuse without re-searching.
- **Theory of Code Space** (arXiv 2603.00601): their "Active-Passive Gap"
  metric measures whether agents do better with delivered context vs. self-
  explored context. We should report this for our agent mode vs. metadata mode.

### 10.3 Track B2 remains the ship gate

Track B2 is still the final product benchmark because only an agent-in-the-loop setup
can prove savings in turns, tool calls, and final answer quality. But Track B2 should
not be the first time we discover that expansion is bloated, incomplete, or slow.

---

## 11. Success Metrics

Use separate gates for intrinsic quality and agent outcome. Otherwise the plan can pass
on answer quality while still delivering noisy or wasteful context.

### 11.1 Intrinsic metrics (Track B1.5)

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Ranking identity | 100% identical result IDs/order | Compare `benchmark` vs `agent` output on same query |
| Symbol completeness | >85% top-1 full-symbol coverage | AST/entity-boundary check on returned top result |
| Expansion accuracy | >90% of top-1 expansions hit intended symbol | Gold boundary or frozen annotation comparison |
| Header correctness | >90% | Resolution check for header imports/references |
| Staleness accuracy | 100% on synthetic dirty-file test cases | Modify file after index, assert `stale=true` |
| Latency overhead | <5ms p50, <10ms p95 | Timer around packaging only |
| Token efficiency | Agent packaging better than metadata+read baseline on median query | Compare delivered tokens for equivalent usable code |
| Round-trip savings | Agent mode eliminates 1-3 Read calls per query | Simulate metadata-mode agent Read count vs agent-mode (target: 0 Reads) |
| Context overload risk | <10% of top-1 results exceed 1500 tokens in `full` mode | Flag oversized expansions that risk §4.5 overload |

### 11.2 Outcome metrics (Track B2)

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Token savings vs rg+read | >30% | Agent-in-the-loop eval (Track B2) |
| Search operations saved | >50% | Count tool calls in agent workflow |
| Self-containment rate | >80% | % of queries where agent doesn't need follow-up reads |
| Context relevance | >90% | % of returned code that agent actually uses |
| Answer quality | ≥ rg+read baseline | Blind judged agent answers |

### Evaluation Plan

Run the benchmark program in this order:
1. Ranking identity checks on every implementation change
2. Track B1.5 intrinsic benchmark on the frozen pattern benchmark set
3. Track B2 agent-in-the-loop evaluation on frozen repo question sets

Track B2 remains the definitive product test, but B1.5 is the fast gate that keeps the
formatting work honest during implementation.

---

## 12. Agent Sub-Modes

Two agent presentation tiers, selectable by the caller:

| Mode | Top-1 | Top-2/3 | Budget | Use Case |
|------|-------|---------|--------|----------|
| `agent_preview` | Full expanded code | Compressed (signature + first 5 lines) | 4000 tokens | Default for MCP/CLI — fast, bounded |
| `agent_full` | Full expanded code | Full expanded code | 8000 tokens | When agent explicitly requests more context |

Both modes share the same ranking. The difference is only how many results
get full expansion vs compression.

**Caution on `agent_full`**: The 8000 token budget approaches the territory
where §4.5 counter-evidence warns of context overload. Use `agent_full` only
when the agent explicitly requests more context (e.g., after an initial
`agent_preview` search returned a "medium" confidence result). Default to
`agent_preview` — it delivers the latency win while staying in the safe
budget zone.

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

**RL-trained baselines to consider**: Two recent papers train code search
agents with reinforcement learning, achieving strong results with minimal
tool scaffolding:
- **CodeScout** (arXiv 2603.17829, March 2026, CMU/Neubig): RL-trained
  agents with only a Unix terminal. Competitive with Claude Sonnet on
  SWE-Bench Verified/Pro/Lite, using 2-18× fewer parameters than baselines.
  Models and code publicly released.
- **ToolTrain** (arXiv 2508.03012, Aug 2025): Two-stage training
  (rejection-sampled SFT + tool-integrated RL) for issue localization.
  Their 32B model surpasses Claude-3.7 on function-level localization.

If either becomes available as a tool, add as a fourth baseline to measure
whether learned search strategies outperform static ranking + context
packaging. The key question: does an RL agent's dynamic exploration beat our
pre-computed ranking + surgical expansion? SWE-ContextBench (arXiv 2602.08316)
provides a framework for comparing experience-reuse approaches that could
inform this comparison.

**Repository memory baseline**: Wang et al. "Improving Code Localization with
Repository Memory" (ICLR 2026 Poster) augments localization agents with
commit-history memory. If their approach is reproducible, it would be a
valuable fifth baseline measuring whether historical context outperforms
our query-time context packaging.

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

Add one more measurement that is worth the annotation cost:
- **Gold-context block F1**: compare the blocks returned by `pattern+agent` against a
  manually annotated minimal sufficient context for a subset of questions. This gives a
  ground-truth context-quality score independent of final-answer variability.

### 15.8 Pass/Fail Criteria

| Verdict | Criteria |
|---------|----------|
| **SHIP** | Quality ≥ baseline AND token savings >20% AND self-containment >80% AND win rate >55% AND time-to-answer <75% of rg+read |
| **CONDITIONAL** | Quality ≥ baseline AND token savings 10-20% OR self-containment 60-80% |
| **NO-SHIP** | Quality < baseline OR self-containment <60% OR win rate <45% OR time-to-answer ≥ rg+read (no latency win) |

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

## 16. What NOT to Build

1. **Full-file context**: Never return an entire file. That defeats the purpose.
   ToCS (arXiv 2603.00601) found that dumping 27-30 files at once overwhelms
   models. Same principle applies at file level.
2. **Cross-file expansion**: Don't follow imports to other files. That's a
   different search, not expansion. Research confirms this: the "What to
   Retrieve" study (arXiv 2503.20589, 11 citations) found that retrieving
   similar code from other files can **degrade** code generation performance
   by up to 15% — the noise from irrelevant cross-file content outweighs
   any benefit.
3. **Summarization**: Don't use an LLM to summarize the code. Return the code
   itself — the agent IS an LLM and can read it directly.
4. **Speculative pre-fetching**: Don't guess what the agent might need next.
   Return what was asked for, with confidence signals for whether more is needed.
5. **Broad context injection**: Don't return AGENTS.md, README, or other
   repository-level context alongside search results. The AGENTS.md evaluation
   (arXiv 2602.11988) found this hurts more than it helps. Let the agent
   request that context separately if needed.

---

## 17. Priority Order

| # | Phase | Effort | Impact |
|---|-------|--------|--------|
| 1 | Ranking identity tests + intrinsic benchmark harness (Track B1.5) | 1 day | CRITICAL — establishes measurement before iteration |
| 2 | Basic agent mode (code in results) | 0.5 day | **HIGHEST** — eliminates Read round-trips = latency + token win |
| 3 | Symbol-complete expansion | 1-2 days | HIGH — self-contained results |
| 4 | Token budget management | 1 day | HIGH — prevents context overload (§4.5) |
| 5 | Header context | 0.5 day | MEDIUM — better code understanding |
| 6 | Confidence signals | 0.5 day | MEDIUM — agent decision support |
| 7 | Agent-in-the-loop eval (Track B2) | 2-3 days | HIGH — validates the whole approach |

**Critical path**: land ranking identity tests and the Track B1.5 harness first, then
build Phases 2-3, then run a full Track B1.5 pass, then ship the remaining refinements,
then run Track B2 as the ship gate. The main correction to the original plan is that
Track B2 is too expensive and too late to be the first serious benchmark. The intrinsic
benchmark should catch packaging regressions before the full agent eval.

**Note on Phase 4 priority upgrade**: Token budget management was previously MEDIUM.
The §4.5 counter-evidence (ContextBench Bitter Lesson, ToCS, AGENTS.md) elevates it
to HIGH — without budget discipline, agent mode could actively harm performance by
over-delivering context. Phase 4 is the guardrail that makes Phases 2-3 safe.
