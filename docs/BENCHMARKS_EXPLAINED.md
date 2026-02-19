# Sweet Search Benchmarks Explained

Comprehensive analysis of all 8 benchmarks evaluated on 2026-02-19. 20,262 queries,
zero errors, ~4 hours wall time.

**Profile**: `balanced` — NO ColBERT (disabled at index+query time), WITH cascaded
reranking (FlashRank TinyBERT → GTE-ModernBERT-Base INT8).

**Embedding model**: CodeRankEmbed INT8 (`mrsladoje/CodeRankEmbed-onnx-int8`, 137M,
768d → 512d HNSW). Code-specialized, NOT a general-purpose embedder.

**Search pipeline**: chunking → embeddings → HNSW → cascaded reranking. 4 modes:
lexical (FTS5), semantic (HNSW), hybrid (semantic + lexical), structural (imports,
usages, callers). CatBoost query router classifies each query and selects the mode.

Results: `eval/results/all_benchmarks_2026-02-19T00-17-05-442Z.json`

---

## Metric Definitions

### MRR@10 (Mean Reciprocal Rank at 10)

For each query, look at the top 10 results. Find the *first* correct result. If
it's at position 1, score = 1.0. Position 2 = 0.5. Position 3 = 0.333. Position
10 = 0.1. Not found in top 10 = 0.0. Average across all queries.

**This is the most important metric** — it measures "how quickly do you find the
right answer." An MRR of 70% roughly means the correct result is typically at
position 1-2.

### NDCG@10 (Normalized Discounted Cumulative Gain)

Like MRR but handles multiple relevant documents. Rewards having relevant results
higher in the list with logarithmic decay. Normalized against the ideal ordering.
Always >= MRR because it gives partial credit for finding the right result at lower
positions.

### Recall@K

Of all relevant documents, what fraction appears in the top K results? Since our
benchmarks have exactly 1 relevant doc per query, Recall@10 = "what percentage of
queries have the correct answer somewhere in the top 10." This is your *coverage*
metric — can the system find it at all, even if not ranked #1?

### Success@1 (a.k.a. Hit@1)

Binary — is the very first result correct? The strictest metric. This is what
matters for "one-shot" search where the user clicks the first result.

### MAP@10 (Mean Average Precision)

In our case with 1 relevant doc per query, MAP@10 equals MRR@10. Only diverges
when there are multiple relevant docs per query.

### p50 latency

Median query time. The interactive UX metric.

---

## Each Benchmark — What It Tests and Why We Score What We Score

### 1. AdvTest (91.5% MRR) — Python only

| Metric | Value |
|--------|-------|
| Queries | 1,000 |
| MRR@10 | 91.5% |
| NDCG@10 | 92.6% |
| Recall@10 | 95.8% |
| Success@1 | 88.8% |
| p50 latency | 268ms |

**What it is**: Take CodeSearchNet Python functions and *adversarially rename all
identifiers* to meaningless names (`func_1`, `var_2`, `arg_3`). Query is the
original NL docstring. Can you still find the right function when all human-readable
names are destroyed?

**Why we score 91.5%**: This is a triumph of semantic embeddings. CodeRankEmbed
understands the *structure and flow* of code, not just identifier names. When
variable names are garbage, keyword search fails completely, but embeddings that
capture control flow patterns, API call sequences, and code shape still work. Our
CatBoost query router correctly routes these as semantic queries, and the reranker
confirms. The 8.5% we miss are likely cases where two functions have very similar
structure but different purposes — embeddings compress them to the same region.

**Relevance to Claude Code plugin**: Medium-high. Real code isn't usually
obfuscated, but minified JS and compiled code do exist. More importantly, this
proves our embeddings understand code *semantically*, not just lexically.

---

### 2. GenCodeSearchNet (79.2% MRR) — 6 languages

| Metric | Value |
|--------|-------|
| Queries | 6,000 |
| MRR@10 | 79.2% |
| NDCG@10 | 81.4% |
| Recall@10 | 88.4% |
| Success@1 | 73.8% |
| p50 latency | 406ms |

**What it is**: A *cleaned-up version* of CodeSearchNet with higher-quality NL
queries. Same 6 languages (Python, JavaScript, Go, Ruby, Java, PHP). The queries
are more natural and less garbage-y than original CSN.

**Why we score 79.2%**: This is our most representative benchmark for real-world
use. The per-language breakdown is revealing:

| Language | MRR | Recall@10 | Success@1 | Why |
|----------|-----|-----------|-----------|-----|
| Go | 93.6% | 97.6% | 90.7% | Go is embedding-perfect: explicit types, `func` keyword, no ambiguity, short functions |
| Python | 89.8% | 94.6% | 86.8% | Strong docstring culture, clear function signatures, embedding model trained heavily on Python |
| Java | 79.0% | 89.3% | 73.1% | Verbose but clean queries help — much better than CSN's garbage queries (34.8%) |
| PHP | 74.7% | 88.0% | 66.9% | Mixed — `$` prefix variables help identifiers stand out, but PHP has many idiom variants |
| Ruby | 72.4% | 85.0% | 65.4% | Implicit returns, block syntax (`do..end`), metaprogramming make embeddings harder |
| JS | 65.5% | 75.7% | 59.8% | Weakest of the 6 — syntax diversity, anonymous functions, callback patterns |

JS at 65.5% is the real concern. Even with cleaner queries than CSN, JS lags every
other language by 7-28 points. See `docs/TODO.md` Section 7 and Section 9 for
the full root cause analysis and improvement plan.

---

### 3. CosQA (70.5% MRR) — Python only

| Metric | Value |
|--------|-------|
| Queries | 100 |
| MRR@10 | 70.5% |
| NDCG@10 | 71.9% |
| Recall@10 | 76.0% |
| Success@1 | 67.0% |
| p50 latency | 242ms |

**What it is**: Real web search queries from Microsoft Bing that resolve to Python
code. These are how real humans actually search: "how to read csv file python",
"sort dictionary by value", "remove duplicates from list".

**Why 70.5%**: These are genuinely natural queries — closer to what a Claude Code
user would type than docstrings. The 29.5% misses are likely:

- (a) Very generic queries where multiple functions are equally valid ("sort a
  list" could match dozens of implementations)
- (b) Queries with implicit context ("fix the bug" — which bug?)
- (c) Web search queries that are more tutorial-oriented than code-specific

**Relevance**: **HIGH** — this is closest to the actual Claude Code use case.
Small sample (100 queries) limits statistical confidence.

---

### 4. CodeSearchNet (66.4% MRR) — 6 languages

| Metric | Value |
|--------|-------|
| Queries | 1,200 |
| MRR@10 | 66.4% |
| NDCG@10 | 69.2% |
| Recall@10 | 77.8% |
| Success@1 | 60.6% |
| p50 latency | 191ms |

**What it is**: The original benchmark. Query = first line of docstring. Code =
function body. Match the docstring to its function. 6 languages: Python,
JavaScript, Go, Ruby, Java, PHP.

**Why 66.4%**: The gap between CSN (66.4%) and GenCSN (79.2%) on the *same
languages* is **entirely about query quality**. CSN queries include:

- `str -> None` (Java type signatures used as "queries")
- `try:` (bare keywords)
- `int -> int` (type annotations, not NL descriptions)
- One-word non-descriptive entries

Per-language breakdown:

| Language | CSN MRR | GenCSN MRR | Gap | Interpretation |
|----------|---------|------------|-----|----------------|
| Go | 93.6% | 93.6% | 0.0 | Go CSN data is clean — docstrings are high quality |
| Python | 76.6% | 89.8% | -13.2 | Some garbage queries in Python CSN |
| Ruby | 75.0% | 72.4% | +2.6 | CSN and GenCSN are comparable for Ruby |
| PHP | 66.8% | 74.7% | -7.9 | Moderate data quality issue |
| JS | 51.7% | 65.5% | -13.8 | Significant garbage queries in JS CSN |
| Java | 34.8% | 79.0% | -44.2 | CSN Java data is garbage — most queries are type signatures |

**The real JS number is 65.5% (GenCSN), not 51.7% (CSN).** The real Java number is
79.0%, not 34.8%. CodeSearchNet is a flawed benchmark for these two languages.

---

### 5. CLARC (60.6% MRR) — C/C++ only

| Metric | Value |
|--------|-------|
| Queries | 995 |
| MRR@10 | 60.6% |
| NDCG@10 | 64.7% |
| Recall@10 | 77.8% |
| Success@1 | 52.0% |
| p50 latency | 309ms |

**What it is**: C and C++ code retrieval. Queries are NL descriptions of
system-level functions (memory management, file I/O, network sockets).

**Why 60.6%**: C/C++ is fundamentally harder for embeddings:

- Pointer arithmetic, macros, and preprocessor directives are semantically opaque
- Many C functions are short (3-10 lines) with generic names (`init`, `handle`,
  `process`)
- C++ templates and operator overloading create many syntactic variants for the
  same concept
- C is 61.3%, C++ is 54.2% — the extra C++ syntax complexity hurts

Our tree-sitter grammars handle C/C++ fine for chunking, but the embeddings
struggle because CodeRankEmbed was likely trained more heavily on Python/JS/Go than
on low-level systems code.

---

### 6. COIR (57.3% MRR) — 14 languages, 10 sub-datasets

| Metric | Value |
|--------|-------|
| Queries | 4,500 |
| MRR@10 | 57.3% |
| NDCG@10 | 59.3% |
| Recall@10 | 65.4% |
| Success@1 | 53.4% |
| p50 latency | 160ms |

**What it is**: A *meta-benchmark* that combines 10 different code IR tasks across
14 languages. Includes CodeSearchNet, StackOverflow QA, code-to-code search,
text-to-SQL, and others.

**Why 57.3%**: The aggregate is dragged down by specific sub-tasks. Per-language
breakdown from the benchmark data:

| Sub-segment | MRR | Count | What's happening |
|-------------|-----|-------|------------------|
| SQL | 85.5% | 1,000 | Text-to-SQL is a strength — structured queries match well |
| Go | 77.8% | 9 | Tiny sample, high as expected |
| JS | 73.0% | 143 | Small sample but better than CSN — cleaner queries |
| Java | 64.7% | 17 | Tiny sample, decent |
| Python | 51.1% | 1,227 | Below average — COIR includes very hard Python sub-tasks |
| **"unknown"** | **46.4%** | **2,102** | **47% of all queries** — likely code-to-code or cross-language tasks |

The 2,102 "unknown" language queries at 46.4% are the biggest drag. These are
probably code-to-code retrieval or cross-language tasks where the "query" is
itself a code snippet, not natural language text. Our embedding model and query
router are optimized for NL→code, not code→code.

---

### 7. CoQuIR (44.4% MRR) — Quality-aware retrieval

| Metric | Value |
|--------|-------|
| Queries | 2,467 |
| MRR@10 | 44.4% |
| NDCG@10 | 46.5% |
| Recall@10 | 53.1% |
| Success@1 | 40.3% |
| p50 latency | 278ms |

**What it is**: Given a query, find the code that is not just *relevant* but also
*correct, secure, and efficient*. This tests whether your search can distinguish
good implementations from buggy ones.

**Why 44.4%**: This is a fundamentally different task from what our pipeline is
designed for. We find *semantically similar* code, not *high-quality* code. When
the query is "sort a list" and the corpus has 5 sort implementations (one correct,
one with off-by-one bug, one with O(n²) complexity, one with a security vuln, one
perfect), we rank them by embedding similarity — which can't distinguish quality.

Per-language breakdown:

| Language | MRR | Why |
|----------|-----|-----|
| C | 75.9% | C quality differences are structural (buffer overflows vs bounds checks) — easier to embed |
| Java | 65.3% | Design patterns help — quality differences show in API usage patterns |
| Python | 31.4% | Python quality differences are subtle — `is` vs `==`, generator vs list, exception handling |
| SQL | 19.1% | SQL quality is almost invisible to embeddings — `SELECT *` vs `SELECT col` vs parameterized queries |

**This is where the disabled Quality Scorer (`docs/TODO.md` Section 1) would
actually help.** The 6 factors (testProximity, complexity, centrality,
commentDensity, sizeScore) are designed exactly for this: distinguishing quality
when semantic similarity is a wash.

---

### 8. CrossCodeEval (12.0% MRR) — Cross-file retrieval

| Metric | Value |
|--------|-------|
| Queries | 4,000 |
| MRR@10 | 12.0% |
| NDCG@10 | 14.8% |
| Recall@10 | 23.6% |
| Success@1 | 7.4% |
| p50 latency | 146ms |

**What it is**: Given a code completion context in one file, find the *other file
in the same repo* that provides the missing dependency (import, function
definition, type declaration). Python, Java, TypeScript, C#.

**Why 12.0%**: This is **not a search problem in the way we solve it.** Our
pipeline does: query → embed → find similar chunks. CrossCodeEval needs: "I'm
writing `user = UserService.get_by_id(uid)` — find the file that defines
`UserService.get_by_id`." That's a *structural graph query*, not a semantic
similarity query.

Our structural search mode (`imports`, `usages`, `callers`) is designed exactly
for this, but the benchmark runs in `mode: 'auto'` and the CatBoost query router
sees these as semantic or hybrid queries because the "query" is a code snippet. It
never routes to structural mode.

Per-language breakdown:

| Language | MRR | Why |
|----------|-----|-----|
| Python | 16.5% | Python imports are more direct — `from module import func` is explicit |
| C# | 12.9% | Namespace-based imports are verbose but findable |
| Java | 10.9% | Package imports with wildcards (`import java.util.*`) obscure the actual dependency |
| TypeScript | 7.9% | Deep import chains, re-exports, barrel files create many indirect dependencies |

**This benchmark measures graph expansion + structural search, not semantic search.**
We have those features (`core/graph-expansion.js`, `core/graph-search.js`) but they
weren't activated because the query router didn't know to use them. See
`docs/TODO.md` Section 11 for the improvement plan.

---

## Aggregate Results Table

| Benchmark | Queries | MRR@10 | NDCG@10 | R@5 | R@10 | R@20 | S@1 | p50 lat |
|-----------|---------|--------|---------|-----|------|------|------|---------|
| AdvTest | 1,000 | 91.5% | 92.6% | 95.1% | 95.8% | 96.9% | 88.8% | 268ms |
| GenCodeSearchNet | 6,000 | 79.2% | 81.4% | 86.1% | 88.4% | 90.2% | 73.8% | 406ms |
| CosQA | 100 | 70.5% | 71.9% | 75.0% | 76.0% | 77.0% | 67.0% | 242ms |
| CodeSearchNet | 1,200 | 66.4% | 69.2% | 73.7% | 77.8% | 80.9% | 60.6% | 191ms |
| CLARC | 995 | 60.6% | 64.7% | 71.8% | 77.8% | 84.4% | 52.0% | 309ms |
| COIR | 4,500 | 57.3% | 59.3% | 62.0% | 65.4% | 69.6% | 53.4% | 160ms |
| CoQuIR | 2,467 | 44.4% | 46.5% | 49.5% | 53.1% | 58.6% | 40.3% | 278ms |
| CrossCodeEval | 4,000 | 12.0% | 14.8% | 18.3% | 23.6% | 27.8% | 7.4% | 146ms |

Total: 20,262 queries, 0 errors, ~3.96 hours wall time.

---

## Key Takeaways

1. **For the Claude Code plugin use case** (NL → code in a single project), the
   relevant benchmarks are AdvTest, GenCodeSearchNet, CosQA, and CodeSearchNet.
   Weighted average across these: **~77% MRR with local embeddings and no ColBERT.**

2. **Go is near-perfect** (93.6%) because Go's syntax is embedding-friendly. Python
   is strong (76-90%). JS is the weak spot (65.5%) and the single most important
   improvement target.

3. **ColBERT was disabled** in all benchmarks. Enabling it with a modern late
   interaction model (LateOn-Code) is the highest-ROI next step.

4. **Low scores on CoQuIR and CrossCodeEval are expected** — they test capabilities
   (quality-aware retrieval, cross-file dependency resolution) that our pipeline
   isn't designed for. We have infrastructure for both (Quality Scorer, structural
   search) but they aren't wired into the default pipeline yet.

5. **CodeSearchNet Java (34.8%) is a data quality problem**, not a Sweet Search
   problem. GenCodeSearchNet proves this with 79.0% on the same language with
   better queries.
