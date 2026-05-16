# Sweet Search TODO

Surviving items from the prior TODO.md after a 2026-05-16 prune.
Everything else was either shipped, superseded by the May-2026 retrieval
overhaul, or no longer applicable (CE rescue, HCGS, Voyage, CatBoost
intent router, lateon-code default, etc.). Section numbers preserved
from the original doc for cross-reference with git history.

---

## 10. MinCut Graph Partitioning

**Status**: Not started. No MinCut implementation exists in the codebase.

MinCut (minimum edge cut) finds the smallest set of edges whose removal disconnects
two vertex sets in a graph. In code search, this enables principled graph
partitioning and importance scoring across multiple pipeline stages.

### 10.1 Use Case: AST Chunking Boundaries

When splitting a large file into chunks, we currently use line-based boundaries
with tree-sitter node detection. MinCut on the **intra-file dependency graph**
(which functions call which, which variables reference which) would find natural
"seam" points where cutting severs the fewest cross-references.

Example: a 500-line file with 3 classes. MinCut identifies the gaps between classes
as optimal chunk boundaries because cross-class references are minimal compared to
intra-class references.

**Integration point**: `core/document-chunker.js` — as an alternative boundary
strategy alongside the existing regex and tree-sitter boundary detection.

**Expected benefit**: Better-aligned chunks → better embeddings → higher MRR,
especially for large files with complex internal structure. Most impactful for
Java (deep class hierarchies in single files) and C++ (header+impl patterns).

### 10.2 Use Case: Graph Expansion Pruning (Query Time)

When doing 2-hop graph expansion, we now use PathRAG-style per-edge-type alpha
decay with degree normalization. MinCut could further improve this by identifying
the **most important bridge edges** — if removing a single edge disconnects a
large subgraph from the query seed, that edge (and the entity it connects to) is
critical context that must be included.

MinCut-based edge importance would complement the current SOTA scoring (which uses
per-edge-type alpha decay + degree normalization) with structural importance that
is independent of edge type or weight.

**Integration point**: `core/graph-expansion.js` — specifically
`expandSecondHopAdaptive()` which already has token budgets, per-edge-type alpha
decay, and degree normalization. MinCut would add a structural importance signal.

**Expected benefit**: More relevant 2-hop expansions, fewer irrelevant context
entities consuming token budget.

### 10.3 Use Case: Module Boundary Detection (Index Time)

Compute MinCut on the full project's dependency graph at index time to identify
natural module boundaries. Code within a module is tightly connected; code across
modules has few edges (the MinCut edges).

Benefits:

- **Scope search results** to the right module when a query is ambiguous (e.g.,
  two `UserService` classes in different modules — MinCut tells you they're in
  different clusters)
- **Structural search**: When the query router selects structural mode, knowing
  module boundaries helps filter results to the relevant code neighborhood

**Integration point**: `core/graph-extractor.js` (build module graph at extraction
time) or new file `core/module-detector.js`. Store module assignments in the
`entities` table as a column.

**Expected benefit**: Improves structural search quality. Moderate impact on
overall MRR but significant for navigation-oriented queries.

### 10.4 Use Case: CrossCodeEval (Cross-File Retrieval)

Cross-file dependency queries — "I'm calling `UserService.get_by_id`, find where
it's defined." MinCut analysis on the repo's import graph at index time would
pre-compute which files are **bridge files** (high betweenness centrality, on
many MinCut paths).

When a cross-file query comes in, bridge files are strong candidates because they
connect different parts of the codebase. Combined with structural search mode
routing, this could significantly improve cross-file queries.

**Integration point**: Pre-computed during indexing in `core/graph-extractor.js`,
stored as metadata, queried during structural search in `core/graph-search.js`.

### 10.5 Implementation Approach

Algorithm options:

- **Stoer-Wagner** for global MinCut (undirected graphs): O(VE + V² log V). Good
  for module detection (10.3).
- **Max-flow/min-cut (Ford-Fulkerson / Dinic's)** for s-t MinCut: O(V²E). Good
  for expansion pruning (10.2) where you have a source (query seed) and sink (rest
  of graph).
- **Karger's randomized**: O(V² log³ V). Good for approximate module boundaries
  when exact solution is too slow on large codebases.

For a typical project (1000-5000 entities, 5000-20000 edges), any of these run in
under 100ms. No performance concern.

### 10.6 Action Items

- Implement MinCut (Stoer-Wagner for global, Dinic's for s-t) as a shared
  utility in `core/graph-algorithms.js`
- **10.2 first**: Integrate s-t MinCut into `expandSecondHopAdaptive()` for
  principled expansion scoring — highest near-term impact
- **10.3 second**: Module boundary detection at index time using global MinCut
  on the file-level dependency graph
- **10.1 later**: Intra-file MinCut for chunking boundaries (requires building
  per-file reference graphs from tree-sitter, more work)
- **10.4 later**: Bridge file detection for cross-file queries
- Benchmark each integration independently against eval harness baseline
- Consider Karger's for large monorepos where exact MinCut is too slow

### 10.7 Priority

**MEDIUM** — High potential but requires new algorithmic infrastructure.
Start with 10.2 (graph expansion, direct A/B testable) and 10.3 (module
detection, enriches structural search). Defer 10.1 and 10.4 until the
simpler integrations prove value. No urgency.

---

## 13. FTS5 Tokenizer: Code-Aware camelCase/snake_case Splitting

**Status**: Not started. Requires discussion before implementation.

### 13.1 The Problem

Our FTS5 index uses `tokenize='porter unicode61'`. This treats `getUserById` as
a single token. A lexical search for "user" won't match it via FTS5 — only the
trigram fallback catches it, which is slower and has lower precision.

Similarly, `parse_json_response` is tokenized as `parse_json_response` (unicode61
splits on `_` but porter-stems each part). The `_` splitting works, but camelCase
doesn't get split at all.

This means our lexical search mode systematically underperforms on identifier-based
queries in camelCase languages (Java, JS/TS, Go, C#).

### 13.2 Discussion Points

- Should we add a **custom FTS5 tokenizer** that splits camelCase, or is trigram
  fallback sufficient? Custom tokenizers in SQLite FTS5 require C extensions or
  creative SQL workarounds.
- Alternative: **pre-process entity names** at index time — store both the original
  (`getUserById`) and the split form (`get user by id`) in the FTS5 index. No
  custom tokenizer needed, just an extra column or concatenated field.
- Alternative: **dual FTS5 tables** — one with porter (for NL text) and one with
  a split-name field (for identifier matching). Query both and merge.
- Risk: Over-splitting may hurt precision. `HttpURLConnection` → `http url connection`
  could match irrelevant results containing "connection".
- What about **acronyms**? `XMLParser` should split to `XML Parser`, not
  `x m l parser`.

### 13.3 Action Items

- **Discuss approach** before implementing — pre-processing vs custom tokenizer
  vs dual tables
- Prototype the simplest approach (pre-process at index time) and measure
  lexical search MRR delta on GenCodeSearchNet
- Consider interaction with trigram table — if trigram already catches these
  cases, the improvement may be marginal

---

## 23. Path-Level Scoring for 2-Hop Graph Expansion

**Status**: Code-side DONE per the original doc (2026-03-02), benchmark
sweep pending. Should verify against current `core/graph/graph-expansion.js`
before assuming it's still wired correctly through the May-2026 overhaul.

### 23.1 The Problem

A hop-2 entity reached via:

- `seed → (extends, hop1_score=0.8) → hop1 → (extends) → hop2`

scores identically to:

- `seed → (uses, hop1_score=0.2) → hop1 → (extends) → hop2`

Both use the same `effectiveAlpha^2` for the hop-2 edge type. The first path is
far stronger evidence but the signal is lost.

### 23.2 Fix

Pass hop-1 scores into `expandSecondHopAdaptive` and include them in the formula:

```
path_score = hop1_score × effectiveAlpha(hop2_edge_type) × weight / sqrt(outDegree)
```

`expandOneHop` currently returns `Map<entityId, {via, direction}>` — extend it to
also carry the hop-1 entity's score.

### 23.3 Expected Impact

**Medium-low**. Current per-edge-type alpha already captures most of the signal.
The missing piece matters most when hop-1 entities have widely varying relevance,
which is only common when original search results are themselves mixed in quality.
**Zero latency addition** — pure data plumbing, no new computation.

### 23.4 Action Items

- Verify the original 2026-03-02 wiring survived the May-2026 retrieval overhaul
  (`project_retrieval_overhaul_2026_05_05.md`, mega-envelope cap,
  ss-trace P6 redo)
- Benchmark MRR delta on GenCodeSearchNet (dev split, full profile) — the
  original commit shipped without a delta measurement

---

## 24. Query-Dependent Graph Expansion Scoring

**Status**: Code-side DONE per the original doc (2026-03-01), benchmark
sweep pending. Same caveat as §23 — verify against current
`core/graph/graph-expansion.js` first.

### 24.1 The Problem

An entity can be graph-connected to a seed but semantically unrelated to the query.
Example:

- Query: "handle null pointer exception"
- Seed: `UserService.getUser()`
- Hop-2 A: `NullPointerExceptionHandler` — graph score 0.3 (weak calls path),
  query similarity 0.85 → combined 0.52
- Hop-2 B: `UserPreferences` — graph score 0.5 (strong uses path),
  query similarity 0.1 → combined 0.34

Without query-dependent scoring B wins. With it, A wins — correctly.

### 24.2 Fix

Blend graph score with cosine similarity between query embedding and entity embedding:

```js
final_score = 0.6 × graph_score + 0.4 × cosine(query_embedding, entity_embedding)
```

Entity embeddings are already stored in the HNSW index. The query embedding is already
computed in the semantic search step — it needs to be threaded into `expandResults()`.

### 24.3 Expected Impact

**HIGH** — single highest-ROI improvement to graph expansion. Directly attacks false
positives (graph-connected but semantically irrelevant entities). No training data,
no new indexes, minimal code change. **~2ms latency addition**: 20 SQLite lookups +
20 dot products on 512-dim vectors.

### 24.4 Action Items

- Verify the original 2026-03-01 wiring (query embedding threaded through,
  min-max normalized graph scores blended with cosine sim, `semanticWeight: 0.4`
  default) still applies in current `graph-expansion.js`
- Benchmark MRR delta on GenCodeSearchNet (dev split, full profile)
- Sweep `semanticWeight ∈ {0.2, 0.3, 0.4, 0.5, 0.6}` on dev split before
  locking the default

---

## 29. MCP Inline Code Snippet: Eliminate Read Tool Round-Trip

**Status**: Not started. Requires further discussion before implementation.
Identified 2026-03-03. Should verify current `tool-handlers.js` shape
before authoring — the MCP handler has changed shape and some of the
plumbing described below may have shifted.

### 29.0 Open Questions (Needs Discussion)

- **Small chunks**: If result #1's chunk is only 5-10 lines (e.g., a short helper),
  the snippet alone may lack context. Should we expand to include surrounding code
  (N lines above/below)? How many? Should expansion respect function/class boundaries
  (tree-sitter-aware expansion) or be line-based?
- **Chunk ≠ useful unit**: A chunk boundary may cut mid-function or mid-class. The
  inline snippet could show a truncated function that confuses the LLM more than
  a file:line reference would.
- **Multiple small results**: If results #1-#3 are all 10-line functions in the same
  file, should we inline all three instead of just #1? Or merge them into a single
  file excerpt with `...` gaps?
- **Token budget vs value**: Inlining a 150-line chunk costs ~1500 tokens. If the
  LLM would have skipped this result after seeing the signature, we wasted tokens.
  Should inlining be opt-in (MCP parameter) or always-on?
- **Backward compatibility**: Renaming `line` → `startLine` and adding `endLine`
  changes the schema. Existing MCP clients may depend on `line`. Migration strategy?
- **Graph-expanded results**: Expanded entities (from 2-hop graph expansion) have
  file/line info but no chunk in `codebase.db`. Should we fall back to reading from
  disk for these, or only inline HNSW-sourced results?
- **How many results get inline code?** The current proposal inlines only result #1.
  But if the top 3 results are all short (10-20 lines each), inlining all three
  costs ~300-600 tokens total and saves up to 3 Read calls. Options:
  - **Only #1** — simplest, predictable token cost, covers the most common case.
  - **Top 3** — covers "compare implementations" use cases where the LLM needs to
    see several candidates. Higher token cost but eliminates most Read calls.
  - **All results** — maximum convenience, but a 10-result response with 100-line
    chunks each = ~10,000 tokens. Likely too expensive for the default.
  - **Adaptive** — inline results until a token budget is hit (e.g., 2000 tokens
    of code total). Small chunks: many get inlined. Large chunks: only #1.
- **File path + lines are always required**: Even when code is inlined, the response
  MUST always include `file:startLine-endLine` for every result. The LLM needs the
  location to: (a) open the file in an editor, (b) make edits via the Edit tool
  targeting exact lines, (c) understand which file the code belongs to, (d) read
  surrounding context if the chunk isn't enough. The inline code is a convenience
  that supplements the location — it never replaces it.

### 29.1 The Problem

When an LLM calls our MCP `search` tool, it gets back a list of locations:

```
Found 5 results (142ms, hybrid):

1. src/auth/validate.js:42 (score: 0.891)
   async function validateCredentials(username, password)

2. src/auth/session.js:15 (score: 0.823)
   class SessionManager

3. src/auth/token.js:88 (score: 0.756)
   function refreshToken(token, secret)
```

To actually **see the code**, the LLM must then call the `Read` tool on the file.
This Read round-trip is slow — 500ms-2s per file depending on tool overhead,
file size, and network latency in hosted environments. For the most common case
(result #1 IS the answer), this is a mandatory extra tool call that delays every
search-driven task.

Additionally, the MCP response is missing critical information:

- **No end line.** The schema has `line: number` (singular). The LLM doesn't know
  whether the result is a 5-line function or a 500-line class, so it can't do a
  targeted Read with `offset`/`limit` — it has to guess or read the whole file.
- **No code content.** The `snippet` field falls through to `r.signature || r.name`
  which is just the function signature, not the implementation.

### 29.2 Proposed Design

**Result #1 (top result):** Return the full code chunk inline. The LLM gets the
answer immediately — no Read tool call needed.

**Results #2-N:** Return file path, **start line AND end line**, score, and
signature. The LLM can make an informed decision about which to read and can do
a precise `Read` with exact `offset`/`limit` instead of guessing.

Example MCP response:

```
Found 5 results (142ms, hybrid):

1. src/auth/validate.js:42-67 (score: 0.891)
   async function validateCredentials(username, password)

   async function validateCredentials(username, password) {
     const user = await db.query('SELECT * FROM users WHERE username = ?', [username]);
     if (!user) return { valid: false, reason: 'not_found' };
     const match = await bcrypt.compare(password, user.password_hash);
     if (!match) return { valid: false, reason: 'bad_password' };
     if (user.locked_until && user.locked_until > Date.now()) {
       return { valid: false, reason: 'locked' };
     }
     return { valid: true, user: { id: user.id, role: user.role } };
   }

2. src/auth/session.js:15-48 (score: 0.823)
   class SessionManager

3. src/auth/token.js:88-112 (score: 0.756)
   function refreshToken(token, secret)
```

The LLM can now:

- Use result #1's code directly (no Read call, saving 500ms-2s)
- Decide whether to read result #2 knowing it's 33 lines (worth it) vs a tiny
  14-line result (maybe skip it)
- Do targeted reads: `Read src/auth/session.js offset=15 limit=33` instead of
  reading the entire file

### 29.3 Data Availability

Everything needed is already in `codebase.db`:

- `vectors.text` column: chunk content, up to 2000 chars (indexed at build time)
- `vectors.metadata` JSON: contains `startLine`, `endLine`, `file`, `name`,
  `type`, `language`

The MCP handler currently reads `r.file`, `r.startLine`, `r.score`, `r.signature`
but ignores `r.endLine` (present on the result object from graph-search and
semantic paths) and `r.content`/`r.text` (present on HNSW results that carry
the `vectors.text` field).

### 29.4 Schema Changes

Current `SearchOutputSchema`:

```js
results: z.array(z.object({
  file: z.string(),
  line: z.number().int().optional(),          // start line only
  score: z.number(),
  snippet: z.string(),                        // signature or name
  signature: z.string().optional(),
  language: z.string().optional(),
}))
```

Proposed:

```js
results: z.array(z.object({
  file: z.string(),
  startLine: z.number().int().optional(),     // renamed from `line`
  endLine: z.number().int().optional(),       // NEW
  score: z.number(),
  snippet: z.string(),                        // signature for #2-N, code for #1
  signature: z.string().optional(),
  language: z.string().optional(),
}))
```

The `snippet` field for result #1 contains the full chunk text; for results #2-N
it remains the signature. The `line` → `startLine` rename is breaking — gate on
a major version bump or keep `line` as a deprecated alias.

### 29.5 Token Budget Consideration

A typical code chunk is 30-150 lines (300-1500 tokens). Including the top result's
code adds ~300-1500 tokens to the MCP response. This is well within reason — the
alternative (a Read tool call) returns the same content plus the overhead of an
entire tool round-trip.

**Cap at 200 lines / ~2000 tokens.** If result #1's chunk exceeds 200 lines (rare —
our chunker targets 50-150 lines), truncate and append
`... (truncated, 312 lines total — use Read src/file.js:42-354 for full code)`.
This prevents pathological cases (e.g., a single 800-line file indexed as one
chunk) from bloating the MCP response.

### 29.6 Implementation Steps

- **Verify current handler shape first** — `tool-handlers.js` has been touched
  during the May-2026 agent-mode and read-tools work; line numbers cited in the
  original doc are likely stale.
- **Add `endLine` to MCP handler**: Map `r.endLine || r.end_line || r.metadata?.endLine`.
  Update `SearchOutputSchema`. Update text formatting to show `file:startLine-endLine`.
- **Add chunk text for result #1**: Load `r.content || r.text` for the top result.
  If not already on the result object, do a single `SELECT text FROM vectors WHERE id = ?`
  lookup from `codebaseDb` (lazy-opened). Cap at 200 lines.
- **Keep `line` as alias**: For backward compatibility, keep `line` in the schema
  as an alias for `startLine` until the next major version.
- **Update text format**: Show `file:startLine-endLine` and append code block for
  result #1.
- **Test**: Verify MCP response includes code for #1, line ranges for all,
  truncation for large chunks. Add test in `tests/mcp-tool-handlers.test.js`.

### 29.7 Expected Impact

**Latency**: Eliminates 1 Read tool round-trip (500ms-2s) for the most common case
(top result is the answer). Net effect: **~40-60% faster search-to-answer for LLM
agents.** The LLM saves one full tool call cycle.

**Accuracy**: No change to search quality. But the LLM gets better information to
decide which additional results to read (line ranges show chunk size), which may
improve downstream task completion.

---

## 30. Block-Level Role Demotion (extends file-kind ranker)

**Status**: Not started. Cheapest of the three SOTA upgrades distilled from
the deleted `docs/SOTA_RESEARCH_2026_FIXES.md`.

### 30.1 The Problem

Our current file-kind demotion (Dockerfile, Cargo.lock, settings.yaml, etc.)
operates at the file level. Mixed-content files like `settings.rs` contain
both declarative blocks AND real implementation — they get penalized as a
whole even though their impl blocks are legitimate code. Sourcegraph Cody
(RecSys 2024, arXiv 2408.05344) and cAST (CMU 2025, arXiv 2506.15655) both
argue demotion should happen at the **AST block level** — function /
method / type definition / config block — not the file level.

### 30.2 Fix

Extend `core/ranking/file-kind-ranking.js` to read chunk-level metadata
(`chunk.role` or equivalent — declaration vs impl vs config) from the
existing cAST chunker rather than just `chunk.file_kind`. Demote
declaration/config blocks while leaving impl blocks at full score.

Required:

- Verify the cAST chunker exports role/kind metadata at the block level
- Thread that metadata through to the file-kind ranker
- Decide per-language what counts as a "demotable" block (Rust derive impls,
  Python stubs, etc.)
- Gate on `format == 'agent'` per CLAUDE.md ranking-signal policy

### 30.3 Expected Impact

Low-to-medium. Smaller absolute upside than §31 or §32 but cheapest
implementation — mostly plumbing on existing infrastructure. Biggest
beneficiary is mixed-content files (Rust `mod.rs`, `lib.rs`, `settings.rs`)
where file-level demotion is too coarse.

### 30.4 References

- Sourcegraph Cody (RecSys 2024, arXiv 2408.05344) — block-level priors
- cAST (CMU 2025, arXiv 2506.15655) — AST-aware chunking

---

## 31. Proper BM25F Multi-Field Indexing

**Status**: Not started. Our current symbol-exact boost is a post-hoc
multiplicative cousin of real BM25F.

### 31.1 The Problem

We do a 1.30× post-hoc multiplicative boost when `chunk.symbol` matches
the query's target identifier. Sourcegraph's "Keeping it boring (and
relevant) with BM25F" (April 2025) reports **+20% on real code-search
workloads** by indexing symbols/filenames/contents as separate BM25 fields
and weighting them inside the scoring math (~3× weight on the symbol
field). The post-hoc multiplier captures the direction but not the
magnitude.

### 31.2 Fix

Re-index with a multi-field BM25F schema:

- field `contents` (existing body text)
- field `symbol` (chunk name / function name)
- field `filename` (file basename)
- per-field length normalization (k1, b) tuned per field
- weighted sum inside the FTS5 scoring

Coordinate with downstream dense + LI fusion so the BM25F score replaces
the current BM25-on-contents score cleanly.

### 31.3 Format Gating (Required)

Per CLAUDE.md "Ranking Signal Format-Gating" and memory
`feedback_format_gate_boosts`: BM25F-style signals hurt GCSN NL queries by
~0.07pp if ungated. Sourcegraph's +20% claim is specifically on code-search
workloads (developer queries with identifier shape), which is exactly what
`format == 'agent'` captures. Gate on agent format from day one.

### 31.4 Expected Impact

Up to +20% on agent-format / code-shaped queries (per Sourcegraph). Zero
impact on NL queries by construction (gated off). Significant work — full
re-index with new schema — but the gain is the largest measured win in
the SOTA literature for this class of fix.

### 31.5 References

- Sourcegraph "Keeping it boring (and relevant) with BM25F"
  (April 2025) — +20% on code search
- Robertson & Zaragoza (2009) "The Probabilistic Relevance Framework: BM25 and Beyond"
- Pérez-Iglesias et al. "BM25/BM25F in Lucene" (arXiv 0911.5046)

---

## 32. Contextual Retrieval (Anthropic-style, ~49% claimed gain)

**Status**: Not started. Highest claimed gain in the SOTA literature, but
also the biggest implementation commitment of the three.

### 32.1 The Problem

Standard chunk embeddings see only the chunk text. A 30-line function
embedded in isolation loses all surrounding context (parent class, file
purpose, module-level intent). For code search this hurts disambiguation
between e.g. two `parse()` functions in different modules.

### 32.2 Fix (Anthropic Contextual Retrieval)

At index time, for every chunk, generate a short context paragraph via a
small LLM (Haiku-class) describing the chunk's role within its parent
file/module. Prepend that context to the chunk text before embedding. The
retrieved chunk then carries its situational metadata inside its embedding.

Anthropic's announcement reports **~49% reduction in failure rate** on
their evals when adding context. Independent users have corroborated
substantial gains, though magnitude varies by corpus.

### 32.3 Implementation Sketch

- One LLM call per chunk at index time (Haiku-class is sufficient)
- Cache contexts keyed by `chunk_id` so re-indexing is idempotent
- Prepend context to the embedding input only — do NOT change the stored
  chunk text (so display + tools see the real code, not the LLM-generated
  context)
- Re-index entire corpus once; incremental indexing reuses cached contexts
  for unchanged chunks
- Provide a `SWEET_SEARCH_CONTEXTUAL_RETRIEVAL=0` kill switch for users
  who don't want the indexing cost

### 32.4 Cost Considerations

- ~10k LLM calls per full re-index of a medium codebase. At Haiku pricing
  that's on the order of $1-3 per codebase per full re-index — cheap.
- Indexing latency adds non-trivially — likely 2-3× current index time on
  cold start. Cached contexts amortize this for incremental indexing.
- Quality risk: if the LLM generates wrong/garbage context, the embedding
  learns wrong signal. Need a sanity gate (length, format) on context
  output before accepting it.

### 32.5 Expected Impact

Largest claimed gain in the SOTA literature (~49% failure-rate reduction).
Has not been validated on Sweet Search's actual benchmarks. Worth a formal
A/B against current state, but only after deciding it's worth the
indexing-time hit.

### 32.6 References

- Anthropic "Contextual Retrieval" (2024) — original announcement,
  +49% failure-rate reduction figure
- Voyage AI's "Contextualized Chunk Embeddings" is the same idea via a
  managed API; we'd implement the local-LLM version since Voyage was
  rejected as an embedding provider (March 2026, no quality improvement
  over CodeRankEmbed on GCSN).

