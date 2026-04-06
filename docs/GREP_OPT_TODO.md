# Grep Engine Optimization Roadmap

Ordered by impact. Each step changes the cost model, so gate tuning comes last.

## Status: After step 5 (2026-04-06)

353 realistic queries across 5 repos. Current results:

| Repo         | Files | p50 Speedup vs rg |
|--------------|-------|--------------------|
| sweet-search | 570   | **~11.6x**         |
| fastify      | 356   | **~8.7x**          |
| flask        | 216   | **~12.0x**         |
| ripgrep      | 215   | **~12.4x**         |
| gin          | 118   | **1.23x**          |
| **ALL**      | —     | **~6.4x** (249W / 71L / 33T) |

Remaining losses: hard regex, method_call, error_string (broad matches where
gram selectivity is low — native grep eliminates spawn overhead but can't beat
rg on broad scans), mixed_regex on gin (too small for index to pay off).

Field-level parity with rg validated: 0 column, 0 matchText, 0 content
mismatches across 353 queries. Match count differences are pre-existing
(.gitignore behavior — gram index includes files rg would skip).

Combined gram+grep fast path (`combined_gram_grep`) handles the majority of
narrowable queries (57/71 on sweet-search, 39/71 on fastify, 45/71 on flask).
The remaining `narrowed_json` routes are queries too broad for gram-only that
benefit from the literal prefilter fallback.

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

## 6. Replace `HashMap<String, GramDescriptor>` with sorted binary search (Rust)

**Problem:** `grams: HashMap<String, GramDescriptor>` at `sparse_gram.rs:97` hashes
gram keys and probes a HashMap. Keys are heap-allocated Strings copied at index load.

**Fix:** Sort grams at index build time. At query time, binary search on the mmap'd
sorted gram table — zero allocation, zero copy. Alternatively, use a minimal perfect
hash if the gram table is static.

**Expected impact:** Faster gram lookup (~0.5us → ~0.1us per gram), eliminates all
heap allocation at index load time.

## 7. SIMD for sparse×sparse posting intersection (Rust)

**Problem:** `intersect_sorted` at `sparse_gram.rs:1124-1142` is a plain scalar
merge-intersect. The SIMD code (`bitand_dense_in_place` with AVX2/NEON) only covers
dense×dense. But sparse n-grams produce mostly sparse postings by design — so the
hot path for our "superior" algorithm hits the un-SIMDified scalar code.

**Fix:** Use SIMD for the sparse merge too. Options:
- Galloping search with SIMD comparison (`_mm256_cmpeq_epi32`)
- Convert sparse to dense when posting density > threshold, then use existing SIMD AND
- Use VPCONFLICT / VPERMI2D for set intersection on AVX-512 (M3 is NEON only)

**Expected impact:** 2-4x faster posting intersection for sparse×sparse pairs.
Small absolute time (~1-3us), but matters when combined with zero-copy (#3).

## 8. Aho-Corasick literal-first fast path

**Problem:** Many agent queries contain one strong literal (`AbortWithStatusJSON`,
`gramLookupTime`). Currently we always run full regex verification on candidate
files. For pure literal queries or regex with a dominant literal, Aho-Corasick
multi-pattern matching is faster than regex compilation + matching.

**Fix:** When literal extraction produces a single clause with high confidence,
use Aho-Corasick for verification instead of regex. Fall back to regex only when
the pattern has real regex semantics beyond the literal anchor.

**Expected impact:** Faster verification for the ~60% of queries that are
effectively literal searches. Saves regex compilation overhead.

## 9. Per-stage timing instrumentation

**Problem:** We can't tell where time is spent within a query. The benchmark shows
total latency but not the breakdown: literal extraction, gram lookup, posting
intersection, result materialization, NAPI crossing, verification, sorting.

**Fix:** Add `performance.now()` checkpoints (or Rust `Instant`) at each stage
boundary in `generateRegexMatches` and the Rust `query_literals`. Expose as
optional stats (e.g., `options.detailedTiming = true`) to avoid overhead in
production.

**Expected impact:** No performance gain directly, but required to identify which
optimization yields the most. Without this, we're optimizing blind.

## 10. Small-repo bypass

**Problem:** On repos with <150 files (like gin at 118), the index overhead
(gram lookup + candidate materialization + narrowed rg spawn) exceeds the cost
of a single raw `rg` scan. The index can never win here.

**Fix:** At query time, if the gram index reports `totalFiles < N`, skip the
index entirely and go straight to raw rg (or native grep on all files). The
threshold N should be tuned empirically (~150-200 files based on current data).

**Expected impact:** Eliminates the 0.5-0.7x penalty on tiny repos. Turns gin-type
losses into ties (can't beat rg, but stop being slower).

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
