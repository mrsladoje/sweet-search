# Grep Indexing Strategy

How sweet-search's indexed grep engine works, why it's faster than ripgrep,
and the architecture behind it.

---

## Performance

353 realistic queries across 5 repos (2026-04-07):

| Repo         | Files | p50 Speedup vs rg | p50 Latency |
|--------------|-------|--------------------|-------------|
| sweet-search | 558   | **17.7x**          | 1ms         |
| fastify      | 356   | **11.5x**          | 1ms         |
| flask        | 216   | **9.1x**           | 1ms         |
| ripgrep      | 215   | **9.7x**           | 1ms         |
| gin          | 118   | **8.5x**           | 1ms         |
| **ALL**      | —     | **10.2x**          | 1ms         |

**353 wins, 0 losses, 0 ties** (>5% margin).

Match counts are identical to ripgrep on every query (e.g., rg=334 ss=334).
Per-match field-level parity (column, matchText, content) is not yet validated
— the benchmark validator's file:line join key has a path format mismatch that
prevents per-match comparison. Match count parity across 353 diverse queries is
strong evidence of correctness but not a substitute for field-level verification.

---

## Architecture

The grep engine uses a sparse n-gram index to skip files that provably cannot
match the regex, then verifies candidates with native Rust regex. The pipeline:

```
regex string
    |
    v
Literal extraction (Rust: regex-syntax crate)
  -> extract required literal substrings from the regex AST
  -> e.g., /class\s+Auth\w+Service/ -> AND("class", "Auth", "Service")
    |
    v
Sparse gram lookup (Rust: mmap'd binary index)
  -> decompose literals into sparse n-grams using per-codebase weight table
  -> intersect posting lists -> candidate file IDs (typically 0.1-5% of corpus)
    |
    v
Native grep verification (Rust: regex crate + rayon parallelism)
  -> run full regex on candidate files only
  -> return file/line/column/matchText/content
```

When the gram index can't narrow (too broad, no extractable literals), the
engine falls back to native grep on all indexed files — still faster than
ripgrep because it avoids fork/exec/pipe/JSON overhead.

### Two query routes

| Route               | When used                          | Strategy                        |
|---------------------|------------------------------------|---------------------------------|
| `unified_gram_grep` | Regex has extractable literals     | Gram lookup -> native grep      |
| `unified_grep_all`  | Regex too broad for gram narrowing | Native grep on all indexed files|

---

## Key Design Decisions

### Sparse n-grams (not plain trigrams or bigrams)

Plain trigrams (`for`, `int`, `var`) appear in nearly every file, producing
huge posting lists. Sparse n-grams use per-codebase character-pair frequency
weights to create variable-length grams where boundaries form at rare bigrams.
Common trigrams get absorbed into longer, more selective grams (`format`,
`interface`, `variable`).

Algorithm: GitHub Blackbird / ClickHouse approach. Reference implementation:
`danlark1/sparse_ngrams` (Boost License 1.0). Weight table is built per-codebase
at index time (single-pass byte scan counting `counts[prev_byte][next_byte]`)
with a static fallback for cold start (<1000 LOC codebases).

Weight semantics are **inverse frequency** — common bigrams (`fo`, `or`, `in`)
get LOW weight; rare bigrams (`t_`, `zz`, `q(`) get HIGH weight. N-gram
boundaries form where the boundary bigram's weight exceeds all interior bigrams.

Validated by Zhang et al. 2025 ("An Evaluation of N-Gram Selection Strategies
for Regular Expression Indexing", CMU/Microsoft), which found frequency-based
selection (their "FREE" strategy) optimal for large, diverse code workloads.

### Why not other approaches

- **Plain trigrams** (Zoekt/livegrep): Poor selectivity on code — `for`, `int`,
  `var` appear in nearly every file. Sparse n-grams subsume this.
- **Plain bigrams** (fff/fastgrep): 4,761 case-insensitive ASCII bigrams with
  bounded key space. Simpler but lower selectivity than sparse n-grams on large
  repos (>200K files). fff's hybrid posting format informed our design (see below).
- **Suffix arrays** (livegrep): Can't do incremental updates. Requires
  concatenating the entire corpus into one string. Wrong for local, evolving
  codebases.
- **FTS5 trigram on source text**: The existing `entities_trigram` table only
  indexes entity names. Extending to full source is impractical — SQLite's
  trigram tokenizer is a substring/LIKE accelerator, not a regex engine.
- **Roaring bitmaps** (Lemire et al. 2017): Mature compressed bitmap library,
  but container dispatch overhead per operation exceeds our simple isDense flag.
  Custom flat mmap'd format guarantees zero-copy access. Roaring is a known
  fallback if profiling shows the custom format insufficient.
- **Elias-Fano encoding** (Vigna 2012): More space-efficient than delta+varint
  for very sparse, high-gap posting lists. O(1) random access. Considered as
  future optimization if sparse list intersection becomes a bottleneck.

### Regex literal extraction

The `regex-syntax` Rust crate (by the author of ripgrep) provides a complete
HIR (high-level IR) for any regex. The literal extraction walk maps AST nodes
to a boolean formula of required substrings:

- **Concatenation** -> AND (all literals required)
- **Alternation** -> OR (any literal sufficient)
- **Character classes** (`\s`, `\w`, `[a-z]`) -> break (no extractable literal)
- **Repetition** (`*`, `+`, `?`) -> break (variable length)
- **Groups** -> transparent (recurse into child)
- **Anchors, lookahead** -> skip (no effect on literals)

When extraction yields nothing (e.g., `.*`, `[a-z]+`, `\d{3}-\d{4}`), the
engine falls back to native grep on all indexed files. Case-insensitive patterns
(`(?i)`) are handled conservatively — `regex-syntax` may produce `Class` nodes
for case-folded ranges, which the walk treats as breaks. No false negatives.

This is a well-studied technique: Russ Cox's `codesearch` (2012), Go's
`regexp/syntax`, and ripgrep's own `grep-regex` crate all implement variants.

### Hybrid posting storage

Each gram's posting list uses one of two representations, chosen at build time:

- **Dense bitset** (gram appears in >D% of files): one bit per file, intersected
  with bitwise AND. SIMD-accelerated on ARM NEON and x86 SSE2.
- **Sparse posting list** (gram appears in <=D% of files): sorted file IDs,
  delta+varint encoded. Intersected with merge or galloping search.

Density threshold D adapts to corpus size using fff's adaptive formula:
`popcount * 4 bytes >= ceil(file_count/64) * 8 bytes` (~3.1% for large corpora).

Intersection dispatch:

| Left    | Right   | Algorithm                              |
|---------|---------|----------------------------------------|
| Dense   | Dense   | Bitwise AND (SIMD)                     |
| Dense   | Sparse  | Iterate sparse, probe bit in dense     |
| Sparse  | Sparse  | SIMD 4-wide block merge or galloping   |

SIMD intersection uses platform-specific intrinsics:
- **aarch64 (Apple Silicon)**: NEON `vceqq_u32` + `vextq_u32` rotations for
  exhaustive 4x4 comparison (Clausecker & Lemire 2024).
- **x86_64**: SSE2 `_mm_cmpeq_epi32` + `_mm_shuffle_epi32` rotations +
  `_mm_movemask_ps` (Schmidbauer 2022).
- **Galloping search**: exponential + binary search when one side is >=8x
  smaller — O(n*log m) beats O(n+m) for skewed intersections (Lemire &
  Boytsov 2014).
- **Scalar merge fallback** for small inputs (<16 elements) and unsupported
  platforms.

### Native Rust grep (not ripgrep subprocess)

The engine uses Rust's `regex` crate with rayon parallelism for verification,
not a ripgrep subprocess. This eliminates fork/exec, pipe I/O, and JSON
serialization overhead. The native grep returns structured results directly
across the NAPI boundary.

For fixed-string queries without globs, `native_grep_files_with_matches_fixed`
uses `str::contains()` with rayon — no regex compilation at all.

### Combined gram+grep NAPI call

Gram lookup and regex verification run in a single NAPI call (`query_and_grep_full`).
Candidate file IDs never cross the Rust/JS boundary — paths are resolved from
the internal file table and grepped directly in Rust. Single-clause fast path
(the common case) skips HashSet — `Vec<u32>` flows straight from gram query to
grep. Multi-clause OR union uses HashSet for dedup.

### Correctness invariant

The prefilter must never produce false negatives. The benchmark contract:

- Same matching-file set as raw ripgrep over the indexed corpus
- `bareGrep()` same line matches as raw ripgrep over the same file set
- False positives before verification are acceptable; false negatives are not

---

## Index Files

All stored in `.sweet-search/`:

| File                          | Contents                                    |
|-------------------------------|---------------------------------------------|
| `codebase-sparse-grams.idx`  | Sparse gram index (header + posting lists)  |
| `codebase.db`                | SQLite with file table, chunk metadata       |
| `codebase-hnsw.usearch`      | HNSW vector index (for semantic search)      |
| `codebase-late-interaction.db`| Late interaction embeddings (for ColGrep)   |

The sparse gram index is a compact binary file, memory-mapped at load time.
Format: header (version, gram count, file count) + gram lookup table (sorted
by gram, binary search) + dense bitset blocks + sparse varint posting lists +
bigram weight table (128x128 f32 = 64KB).

---

## Optimization History

The engine evolved through 10 optimization steps, each building on the previous:

### Step 1: Loosen bailout gates

Raised thresholds so the gram index is trusted for broader queries
(`maxGramCandidateFiles` 512->2048, `maxGramCandidateRatio` 5%->30%, etc.).

### Step 2: Native grep for bareGrep

Added `native_grep_full` Rust NAPI function returning structured match results.
Decoupled from `lightweightParse` — bareGrep routes through native grep for
all strategies. **Impact: p50 speedup 1.3x -> ~10x.**

### Step 3: Zero-copy posting list reads

`bitand_dense_from_le_bytes` and `filter_sparse_with_dense_bytes` read dense
posting bitmaps directly from mmap'd byte slices, avoiding `Vec<u64>` allocation.

### Step 4: All-in-one gram query + native grep

`query_and_grep_full` combines gram lookup + extension filtering + threshold
checks + regex verification in a single NAPI call. Candidate file paths never
cross the boundary. Single-clause fast path skips HashSet — `Vec<u32>` flows
straight from gram query to grep.

### Step 5: Allocation-free `extract_covering_grams`

Thread-local `CoveringScratch` with reusable buffers. Return type changed from
`Vec<String>` to `Vec<&str>` — zero-copy slices into the input span. Internal
`HashSet<String>` replaced with `HashSet<&str>`.

### Step 6: Sorted binary search gram table

Replaced `HashMap<String, GramDescriptor>` with `SortedGramTable` — struct-of-arrays
with O(log n) binary search. Eliminates hash computation on the query hot path.
**Impact: p50 speedup ~6.4x -> ~9.9x** on large gram tables (128K+ grams).

### Step 7: SIMD sparse-sparse posting intersection

Three dispatch strategies:
1. **Galloping search** when one side is >=8x smaller — O(n*log m)
2. **SIMD 4-wide block merge** for balanced sets >=16 elements (NEON on aarch64,
   SSE2 on x86_64)
3. **Scalar merge** fallback for small inputs

### Step 8: Aho-Corasick literal fast path — SKIPPED

The trigram index already handles literals efficiently. Rust's `regex` crate
internally optimizes pure literals to `memchr`. Not worth the added complexity.

### Step 9: Per-stage timing instrumentation

Added `performance.now()` checkpoints and Rust `Instant` at each stage boundary.
Identified literal prefilter (rg -F spawn) as the dominant loss source at
12-35ms p50.

### Step 10: Eliminate literal prefilter + native grep all

Two changes that removed the last rg subprocess spawn from the hot path:
- **10A**: `native_grep_files_with_matches_fixed` — fixed-string AND-match with
  rayon parallelism, no regex compilation.
- **10B**: `unified_grep_all` strategy — when grams can't narrow, run native grep
  on all indexed files instead of spawning rg. One I/O pass instead of two.
  **Impact: gin 1.1x -> 4.4x, overall 334W/19L -> 353W/0L.**

---

## Future Directions

These are potential next steps, not yet implemented.

### Step 11: End-to-end Rust query pipeline

Unify the remaining JS planner logic into a single `query_and_verify(regex, options)`
NAPI function that does everything in Rust: literal extraction, gram lookup,
posting intersection, regex verification. The JS side becomes: call Rust once,
format results.

### Step 12: Keep index resident / stateful

Pre-load the index at SweetSearch init time. Share mmap'd file table and newline
offset tables between the gram index and native grep. Keep hot file content in a
bounded LRU cache.

### Step 13: Tune bailout gate thresholds

Sweep each threshold across a range and measure win/loss ratio. Do this last —
every optimization changes the cost model.

---

## Benchmarking

Benchmark infrastructure: `eval/scripts/grep-latency-bench.js` with 353 queries
across 5 repos (sweet-search, ripgrep, gin, flask, fastify). Query files in
`eval/data/grep-bench/`.

```bash
# Full speed + accuracy benchmark
node eval/scripts/grep-latency-bench.js --validate --verbose

# Specific repos
node eval/scripts/grep-latency-bench.js --repos=gin,flask

# Pattern benchmark (includes ColGrep ranking metrics)
node eval/run_pattern_benchmark.js --concurrency=12
```

### What the benchmark measures

- **Speed**: wall-clock latency for every query through both sweet-search grep
  and raw ripgrep. Reports p50, p95, avg, min, max per repo and per regex family.
- **Accuracy**: `--validate` flag compares match counts and field-level parity
  (file, line, column, matchText, content) between sweet-search and ripgrep.
- **Per-stage timing**: literal extraction, gram query, regex build, grep verify,
  NAPI overhead, result materialization.
- **Planner route distribution**: how many queries take `unified_gram_grep` vs
  `unified_grep_all`.

---

## References

### Architecture and algorithms

| Source | What we used from it |
|--------|----------------------|
| [GitHub: Technology Behind Code Search](https://github.blog/engineering/the-technology-behind-githubs-new-code-search/) (2023) | Sparse n-gram algorithm, covering gram query strategy |
| [Cursor: Fast Regex Search](https://cursor.com/blog/fast-regex-search) (2026) | Indexed base + fresh overlay architecture, sparse gram visualization |
| [Russ Cox: Regex Matching with a Trigram Index](https://swtch.com/~rsc/regexp/regexp4.html) (2012) | Foundational trigram-to-regex literal extraction technique |
| [sparse_ngrams](https://github.com/danlark1/sparse_ngrams) (Boost License 1.0) | C++ reference for sparse gram extraction and weight table construction |
| [fff/fastgrep](https://dev.to/dmtrkovalenko/benchmark-oriented-development-is-a-road-to-nowhere-1518) (2026) | Hybrid dense/sparse posting storage, adaptive density threshold formula |
| [danieldk bigram gist](https://gist.github.com/danieldk/00a2dd05c8a012b7b049a25f23e23062) | Character-level bigram frequencies across programming languages (seed data for weight table) |
| [regex-syntax crate](https://docs.rs/regex-syntax) | Rust regex AST parser for literal extraction (by BurntSushi/ripgrep author) |
| [HN: GitHub engineer on sparse grams](https://news.ycombinator.com/item?id=34682472) (2023) | Confirms follow masks abandoned, covering sparse grams used instead |

### SIMD and posting list intersection

| Source | What we used from it |
|--------|----------------------|
| [Lemire & Boytsov 2014](https://arxiv.org/abs/1401.6399) | SIMD integer list compression and intersection (galloping search with SIMD) |
| [Clausecker & Lemire 2024](https://arxiv.org/abs/2412.16370) | Positional population counts for AVX2/AVX-512/ARM ASIMD — applied to dense x dense intersection |
| [Schmidbauer 2022](https://arxiv.org/abs/2112.06342) | Faster-than-native VP2INTERSECT alternatives using basic AVX512F — software outperforms hardware |
| [Zhang et al. 2025](https://arxiv.org/abs/2504.12251) | N-gram selection strategy evaluation (CMU/Microsoft) — validates frequency-based selection for code |

### Considered and rejected

| Source | Why rejected |
|--------|--------------|
| [Roaring bitmaps](https://arxiv.org/abs/1709.07821) (Lemire et al. 2017) | Container dispatch overhead; custom flat mmap'd format simpler for our key space |
| [Elias-Fano encoding](https://arxiv.org/abs/1206.4300) (Vigna 2012) | More space-efficient for high-gap sparse lists; reserved as future optimization |
| [Iakovlev et al. 2024](https://arxiv.org/abs/2403.03751) | Delta-based persistent trigram index across git revisions (ITMO/Huawei) — our mtime-based approach is simpler |
| [Zoekt](https://github.com/sourcegraph/zoekt) | Positional trigrams + shard format — sparse n-grams supersede plain trigrams |
| [Moderne Trigrep](https://www.moderne.ai/blog/from-grep-to-moderne-trigrep-code-search-for-agents) (2026) | Zoekt-compatible + LST symbol awareness — we get equivalent via existing tree-sitter chunker metadata |
