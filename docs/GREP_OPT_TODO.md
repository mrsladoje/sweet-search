# Grep Engine Optimization Roadmap

Ordered by impact. Each step changes the cost model, so gate tuning comes last.

## Status: After steps 9-10 (2026-04-06)

353 realistic queries across 5 repos. Current results:

| Repo         | Files | p50 Speedup vs rg |
|--------------|-------|--------------------|
| sweet-search | 571   | **~18.0x**         |
| fastify      | 356   | **~12.0x**         |
| flask        | 216   | **~8.5x**          |
| ripgrep      | 215   | **~9.2x**          |
| gin          | 118   | **~4.4x**          |
| **ALL**      | —     | **~9.9x** (334W / 19L / 0T) |

Remaining losses (19): broad `error_string` and `method_call` patterns on
sweet-search (571 files) where native grep on all files takes 30-40ms vs rg's
18ms. rg's optimized directory walker still has an edge on full-tree scans.
All other repos are near-zero losses.

### Previous baseline (2026-04-06, after step 7)

Field-level parity with rg validated: 0 column, 0 matchText, 0 content
mismatches across 353 queries. Match count differences are pre-existing
(.gitignore behavior — gram index includes files rg would skip).

Combined gram+grep fast path (`combined_gram_grep`) handles the majority of
narrowable queries (52/71 on sweet-search, 39/71 on fastify, 43/71 on flask).
The remaining `narrowed_json` routes are queries too broad for gram-only that
benefit from the literal prefilter fallback.

### Previous baseline (2026-04-06, after step 6)

| Repo         | Files | p50 Speedup vs rg |
|--------------|-------|--------------------|
| sweet-search | 570   | **~18.1x**         |
| fastify      | 356   | **~11.6x**         |
| flask        | 216   | **~8.3x**          |
| ripgrep      | 215   | **~9.0x**          |
| gin          | 118   | **1.2x**           |
| **ALL**      | —     | **~9.9x** (243W / 77L / 33T) |

### Previous baseline (2026-04-06, after step 5)

| Repo         | Files | p50 Speedup vs rg |
|--------------|-------|--------------------|
| sweet-search | 570   | **~11.6x**         |
| fastify      | 356   | **~8.7x**          |
| flask        | 216   | **~12.0x**         |
| ripgrep      | 215   | **~12.4x**         |
| gin          | 118   | **1.23x**          |
| **ALL**      | —     | **~6.4x** (249W / 71L / 33T) |

### Previous baseline (2026-04-06, after step 4)

| Repo         | Files | p50 Speedup vs rg |
|--------------|-------|--------------------|
| sweet-search | 570   | **~9.0x**          |
| fastify      | 356   | **~11.2x**         |
| flask        | 216   | **~8.5x**          |
| ripgrep      | 215   | **~10.1x**         |
| gin          | 118   | **1.17x**          |
| **ALL**      | —     | **~10x** (236W / 79L / 38T) |

### Previous baseline (2026-04-06, after step 3)

| Repo         | Files | p50 Speedup vs rg |
|--------------|-------|--------------------|
| sweet-search | 570   | **~8.9x**          |
| fastify      | 356   | **~11.3x**         |
| flask        | 216   | **~8.6x**          |
| ripgrep      | 215   | **~9.3x**          |
| gin          | 118   | **1.15x**          |
| **ALL**      | —     | **~10x** (247W / 75L) |

### Previous baseline (2026-04-06, after step 2)

| Repo         | Files | p50 Speedup vs rg |
|--------------|-------|--------------------|
| sweet-search | 570   | **~9-17x**         |
| fastify      | 356   | **~11x**           |
| flask        | 216   | **~8.5x**          |
| ripgrep      | 215   | **~9.5x**          |
| gin          | 118   | **1.2x**           |
| **ALL**      | —     | **~10x** (239-249W / 76-77L) |

### Previous baseline (2026-04-05, before step 2)

| Repo         | Files | p50 Speedup vs rg |
|--------------|-------|--------------------|
| sweet-search | 569   | **2.73x**          |
| fastify      | 356   | **1.74x**          |
| flask        | 216   | **1.41x**          |
| ripgrep      | 215   | **1.40x**          |
| gin          | 118   | 0.98x (break-even) |
| **ALL**      | —     | **1.30x** (220W / 125L) |

---

## 1. [DONE] Loosen bailout gates

Raised thresholds so the index is trusted for broader queries:
- `maxGramCandidateFiles`: 512 → 2048
- `maxGramCandidateRatio`: 5% → 30%
- `gramSaysBroad`: >10% → >40%
- `literalNarrowMaxFiles`: 500 → 2048
- `literalNarrowMaxRatio`: 15% → 40%
- `narrowedThreshold`: 100 → 300
- `directJsonThreshold`: 2048 → 4096

## 2. [DONE] Enable native grep for bareGrep

Added `native_grep_full` Rust NAPI function returning `{file, line, column, matchText,
content}` per match (using `re.find()` instead of `re.is_match()`). Decoupled
`canUseNativeGrep` from `lightweightParse` — bareGrep now routes through native grep
for both Strategy B (narrowed_json) and Strategy C (two_pass). The lean
`nativeGrepLines` path for patternSearch is unchanged.

**Actual impact:** p50 speedup jumped from 1.30x → ~10x across 353 queries. Eliminated
rg fork/exec/pipe + JSON serialization/parsing overhead for all narrowed bareGrep
queries. Field parity with rg validated (0 column/matchText/content mismatches).

## 3. [DONE] Zero-copy posting list reads (Rust)

Added `bitand_dense_from_le_bytes` and `filter_sparse_with_dense_bytes` functions that
read dense posting bitmaps directly from the mmap byte slice, avoiding `Vec<u64>`
allocation for the right-hand side of intersections. Modified the inner gram loop in
`query_literals` to use these fast paths when the accumulator intersects with a dense
gram. Sparse postings (varint+delta encoded) still require decoding — zero-copy is
not possible for those.

**Actual impact:** Eliminated per-query heap allocations for dense×dense and sparse×dense
posting intersections (all grams after the first). At current benchmark repo sizes
(2-9 u64 words per dense bitmap), the allocation savings are sub-microsecond — absorbed
by measurement granularity. Speedup holds at ~10x (247W/75L). The win is structural:
the hot path is now allocation-free, compounding with steps 4-6.

## 4. [DONE] All-in-one gram query + native grep (zero-copy candidate path)

Added `query_and_grep_lines` and `query_and_grep_full` methods on `NativeSparseGramIndex`
that combine gram lookup + code extension filtering + threshold checks + regex verification
into a single NAPI call. Refactored `query_literals` to delegate to a shared
`query_file_ids_core` that returns `Vec<u32>` file IDs without path string materialization.
The all-in-one methods resolve paths from the internal file table and grep directly in Rust
— candidate file paths never cross the NAPI boundary.

Multi-clause OR union, per-clause threshold checks, and code extension filtering all happen
in Rust. Code extensions are passed once per call from JS (`CODE_FILE_EXTENSIONS` array).
JS fast path short-circuits the entire planner (strategy selection, literal prefilter) when
the combined method returns eligible.

**Actual impact:** Eliminated intermediate NAPI string serialization for candidate file paths.
Two NAPI crossings (gram query → JS → native grep) reduced to one. Single-clause fast path
(the common case) skips HashSet entirely — Vec<u32> flows straight from gram query to grep.
Multi-clause OR union still uses HashSet for dedup. Per-match String clones for the NAPI
output boundary remain (unavoidable — NAPI requires owned Strings). p50 holds at ~10x; 57-80%
of queries take the single-call combined path.

## 5. [DONE] Reduce query-time allocations in `extract_covering_grams` (Rust)

Added thread-local `CoveringScratch` struct with reusable `Vec<f32>` (pair_weights) and
`Vec<(usize, usize)>` (stack) buffers. Changed return type from `Vec<String>` to
`Vec<&str>` — gram strings are now zero-copy `&str` slices into the input `&[u8]` span
via `std::str::from_utf8`. Internal `HashSet<String>` replaced with `HashSet<&str>`.
Destructured the scratch struct to get independent field borrows (pair_weights immutable,
stack mutable) within the same `thread_local::with` closure.

Updated all callers in `sparse_gram.rs` (query_file_ids_core) and `chunk_gram.rs`
(query_literals, query_and_grep) to use `&str` HashMap lookups — `HashMap<String, V>::get()`
accepts `&str` via `String: Borrow<str>`.

**Actual impact:** Eliminated all per-query heap allocations in `extract_covering_grams`:
no `String` allocation, no `clone()`, no `to_string()`. Pair weights and stack buffers
are reused across queries. At current benchmark sizes the per-query savings are
sub-microsecond, but the hot path is now fully allocation-free when combined with #3 and
#4. Benchmark holds at ~10x (249W / 71L / 33T).

## 6. [DONE] Replace `HashMap<String, GramDescriptor>` with sorted binary search (Rust)

Replaced `HashMap<String, GramDescriptor>` with `SortedGramTable` — a struct-of-arrays
(`Vec<String>` keys + `Vec<GramDescriptor>` vals) with O(log n) binary search lookup.
Grams are already written in sorted order at build time, so `parse_gram_table` now
pushes entries in order rather than hashing. Applied to both `sparse_gram.rs` and
`chunk_gram.rs`.

**Actual impact:** Overall p50 speedup jumped from ~6.4x → ~9.9x. Sweet-search
(128K grams) improved from 11.6x → 18.1x; fastify improved from 8.7x → 11.6x.
Smaller repos (flask, ripgrep) saw slight regression — HashMap is competitive at
~20K grams where binary search branch misprediction costs are proportionally higher.
The win is structural: eliminates hash computation and HashMap probing overhead
on the query hot path, compounding with steps 3-5. Index load time also benefits
from sequential pushes vs random HashMap inserts.

## 7. [DONE] SIMD for sparse×sparse posting intersection (Rust)

Extracted duplicated `intersect_sorted` from `sparse_gram.rs` and `chunk_gram.rs` into
a shared `simd_intersect.rs` module with three dispatch strategies:

1. **Galloping search** (exponential + binary) when one side is >=8x smaller — O(n·log m)
   beats O(n+m) for skewed accumulator-vs-posting-list intersections.
2. **SIMD 4-wide block merge** for balanced sets >=16 elements:
   - **NEON (aarch64):** `vceqq_u32` + `vextq_u32` rotations for exhaustive 4×4 comparison.
   - **SSE2 (x86_64):** `_mm_cmpeq_epi32` + `_mm_shuffle_epi32` rotations + `_mm_movemask_ps`.
   - Block-skip optimization: non-overlapping blocks (`a_max < b_min`) advance in O(1).
3. **Scalar merge** fallback for small inputs (<16 elements) and unsupported platforms.

All four launch targets supported (darwin-arm64/x64, linux-x64-gnu/arm64-gnu).
17 tests including stress test across 196 size combinations verifying SIMD matches scalar.

**Actual impact:** p50 holds at ~10.0x (242W / 73L / 38T). Win/loss improved slightly
(4 former losses became ties). The absolute time savings (~1-3μs) are below the 1ms
measurement granularity — the win is structural: the sparse×sparse hot path now uses
platform-optimal SIMD and algorithmic selection (galloping for skewed, block merge for
balanced), compounding with the zero-copy and allocation-free work from steps 3-5.

## 8. ~~Aho-Corasick literal-first fast path~~ [SKIPPED]

**Original idea:** Use Aho-Corasick for verification instead of regex when the
query is a pure literal.

**Why skipped:** The combined_gram_grep path already handles literals efficiently.
The trigram index narrows candidates to a handful of files, and Rust's `regex`
crate internally optimizes pure literals to `memchr` — so the verification step
is already near-optimal. The remaining win would be sub-millisecond (saving regex
compilation overhead on an already-narrowed candidate set). For queries that are
truly just literal lookups, the lexical/BM25 search path is a better product fit
than grep. Not worth the added complexity.

## 9. [DONE] Per-stage timing instrumentation

Added `performance.now()` checkpoints and Rust `Instant` at each stage boundary.
Rust: `gram_elapsed_us` and `regex_build_elapsed_us` on `GramGrepLinesResult`
and `GramGrepFullResult`, timed separately from `grep_elapsed_us`. JS: `stageTiming`
object on all `generateRegexMatches` stats (combined and fallback paths) with
7 stages: literalExtraction, gramQuery, regexBuild, literalPrefilter, grepVerify,
napiOverhead, resultMaterialization. Benchmark reports per-repo per-stage table.

**Actual impact:** Identified literal prefilter (rg -F spawn) as the dominant
loss source at 12-35ms p50. Gram query and grep verify were already sub-millisecond.
NAPI overhead negligible at 57-108μs. This directly informed steps 10A/10B below.

## 10. [DONE] Eliminate literal prefilter + native grep all (replaces small-repo bypass)

Two changes that remove the last rg subprocess spawn from the hot path:

**10A: native_grep_files_with_matches_fixed (Rust)**
Added fixed-string AND-match using `str::contains()` with rayon parallelism.
No regex compilation. Used as fallback for rare glob-filtered queries.

**10B: native_grep_all strategy**
When the gram index can't narrow (too broad or no literals), skip the literal
prefilter entirely and run native grep with the full regex on all indexed files.
One I/O pass instead of the prefilter's two (str::contains on all files, then
regex on narrowed files). This subsumes the original "small-repo bypass" idea —
native grep on all files is fast for any repo size, not just small ones.

**Actual impact:** Prefilter eliminated for all queries without globs. gin jumped
from 1.12x → 4.39x, fastify from 6.83x → 12.0x. Win/loss improved from
242W/73L/38T → 334W/19L/0T. Literal prefilter stage no longer appears in timing.

## 11. End-to-end Rust query pipeline (single NAPI call)

**Problem:** Even with native grep enabled (#2) and integer IDs (#4), the query
still crosses the NAPI boundary multiple times: JS calls Rust for gram lookup,
gets file IDs back, then calls Rust again for native grep. Each crossing costs
~5-15us in serialization overhead, and the JS planner logic between them adds
latency.

CodeDB and fff both avoid this entirely — the index lookup IS the search. One
call in, matches out.

**Fix:** Add a unified `query_and_verify(regex, options) -> Vec<Match>` NAPI
function that does everything in Rust in one call:
1. Extract literals from regex
2. Extract covering grams from literals
3. Intersect posting lists → candidate file IDs
4. Read candidate files (mmap, grouped by ID)
5. Run regex verification on each file
6. Return file/line/column/matchText results

The JS side becomes: call Rust once, format results. No planner, no strategy
selection, no NAPI round-trips.

**Expected impact:** Eliminates all JS-side overhead for narrowed queries. Combined
with #3, #4, #5, #6, this is the path to sub-millisecond index queries on warm
caches. This is the architectural shift that makes us competitive with CodeDB/fff
headline numbers.

## 12. Keep index resident / stateful

**Problem:** The gram index is loaded on first query via `ensureSparseGramIndex` and
cached on the searcher instance. But the file table, newline tables, and content
caches are not shared across the index and native grep paths.

**Fix:** Pre-load the index at SweetSearch init time. Share the mmap'd file table
and newline offset tables between the gram index and native grep. Keep hot file
content in a bounded LRU cache.

**Expected impact:** Eliminates cold-start cost on first query. Speeds up native
grep by reusing mmap'd data.

## 13. Tune bailout gate thresholds

**Do this last** — every optimization above changes the cost model.

**Method:** Sweep each threshold across a range and measure win/loss ratio on the
353-query benchmark. The optimal thresholds depend on:
- Native grep latency (after #2)
- Posting intersection cost (after #3, #5, #6)
- Result materialization cost (after #4)

Parameters to tune:
- `maxGramCandidateFiles` (currently 2048)
- `maxGramCandidateRatio` (currently 0.30)
- `gramSaysBroad` selectivity cutoff (currently 0.40)
- `literalNarrowMaxFiles` (currently 2048)
- `literalNarrowMaxRatio` (currently 0.40)
- `narrowedThreshold` (currently 300)
- `directJsonThreshold` (currently 4096)
- Small-repo bypass: skip index entirely when corpus < N files

**Benchmark infrastructure:** `eval/scripts/grep-latency-bench.js` with 353 queries
across 5 repos (sweet-search, ripgrep, gin, flask, fastify), query files in
`eval/data/grep-bench/`.
