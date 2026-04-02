# Indexed Grep: Sub-Linear Regex Search for Pattern Mode

**Status**: Planning
**Priority**: HIGH (correctness fixes), MEDIUM (scope restriction), LOW (trigram index)
**Prerequisites**: Pattern mode MVP (done), late interaction index (done)
**References**: COLGREP_PLAN.md, Cursor "Fast Regex Search" blog (2026-03-23),
USEFUL_ANSWER_COLGREP_PLAN.md (agent context packaging, composes with Phase 4.1/5),
INIT_STRATEGY.md (native binary packaging for Phase 4 Rust crate)
**SOTA Review**: 2026-04-02 — Verified against Cursor, GitHub Blackbird, Moderne Trigrep,
fff/fastgrep, and academic literature (Zhang et al. 2025 n-gram selection evaluation,
Lemire et al. 2024 pospopcnt for AVX2/AVX-512/ASIMD). Plan is SOTA with hybrid postings
(fff), SIMD intersection, AST metadata (Moderne-equivalent via existing tree-sitter
chunker), per-codebase frequency weights (validated by Zhang et al. FREE strategy).
**Motivation**: On the warm server path, `encodeQuery()` is ~6ms (model preheated at
startup). Ripgrep at 21-26ms is the latency floor. At enterprise scale (>1GB repos),
ripgrep grows to seconds. This plan makes Stage A sub-linear.

---

## 1. Problem Statement

Pattern search currently runs ripgrep against the entire project root on every query
(`core/search/search-pattern.js:450`). This has three problems:

1. **Silent truncation**: `maxMatches=1000` hard cap (`core/search/search-pattern.js:92-97`) kills
   ripgrep after 1000 matching lines. This directly violates the 100% regex recall goal
   (`COLGREP_PLAN.md:607`). For broad patterns like `function\s+\w+`, the first 1000
   matches are arbitrary — the best semantic match may be #1001.

2. **O(corpus) per query**: Ripgrep must scan every file regardless of how selective the
   regex is. On small repos (~100MB), this costs 5-20ms. On 1GB+ repos, this costs
   seconds. Cursor reports 15+ seconds on enterprise monorepos.

3. **Redundant work**: We already know which files are indexed (the LI index has metadata
   for every chunk). Searching unindexed files produces matches we can't semantically rank
   anyway — they just get appended at the bottom with score=0.

The goal: make regex candidate generation **sub-linear** in corpus size, while preserving
100% recall over the indexed corpus.

---

## 2. Architecture Overview

Four phases, each independently shippable:

```
Phase 1: Fix correctness (remove silent truncation)
Phase 2: Restrict search scope (indexed files + dirty overlay)
Phase 3: Regex literal extraction (fast path for selective patterns)
Phase 4: Sparse gram index (sub-ms candidate generation at any scale)
```

Each phase reduces Stage A latency and can be benchmarked independently using
Track C component profiling from `eval/run_pattern_benchmark.js`.

**Non-goal**: Phases 1-3 do not change pattern-mode regex semantics. Ripgrep remains
the source of truth for regex parsing and final match verification. We may add
prefilters, but we do not switch the hot path to JavaScript `RegExp`.

---

## 3. Phase 1: Fix Silent Truncation

**Problem**: `runRipgrep()` kills the process at 1000 matches. Common patterns like
`class\s+\w+` or `import\s+` easily exceed this on any non-trivial codebase. The user
sees no warning. MaxSim then ranks only the first 1000 matches, which are in filesystem
traversal order — not relevance order.

**Fix**:

```
Option A: Remove the cap entirely. Let ripgrep return all matches.
          Risk: unbounded memory on pathological patterns.

Option B: Raise cap to 10K with a warning flag in stats output.
          Risk: still truncates on huge repos.

Option C: Two-pass approach — first pass counts matches. If under cap,
          use them all. If over cap, switch to file-level dedup (one
          match per file) and re-run with --files-with-matches + targeted
          per-file matching on chunks we have indexed.

Option D: Cap at file level, not line level. Use rg --files-with-matches
          to get all matching files (much cheaper than full output), then
          map to chunks. Only read line-level matches for chunks that
          need content snippets.
```

**Recommendation**: Two-pass ripgrep, with ripgrep preserved as the verifier.
First pass: `rg --files-with-matches` to get the full candidate file set without line
explosion. Second pass: rerun `rg --json` against only those candidate files, in
batches, to recover line numbers for chunk mapping. This removes the silent truncation
while preserving regex semantics.

**Pipeline change**:

```
Current:  rg --json <regex> <dir>  →  file:line matches  →  chunk mapping
Proposed: rg --files-with-matches <regex> <dir>  →  matching files
          → intersect with indexed-file set
          → rg --json <regex> <candidate-file-batch...>
          → file:line matches for candidate files only
          → chunk mapping
          → MaxSim rerank
```

This eliminates the silent truncation problem without redefining regex behavior. The
first pass is bounded by number of matching files; the second pass only emits line-level
matches for files already proven to match. No assumption is made that chunk text is
resident in the LI index.

**Effort**: 0.5 day
**Files**: `core/search/search-pattern.js` (modify `runRipgrep`, `patternSearch`)

---

## 4. Phase 2: Restrict Search to Indexed Corpus + Dirty Overlay

**Problem**: `patternSearch()` always searches `PROJECT_ROOT` (`core/search/search-pattern.js:450`).
This scans files we've never indexed (node_modules, build artifacts, media, etc. — even
though ripgrep has type filters, it still traverses the tree). More importantly, it scans
every indexed file even when the regex can only match a subset.

**Insight** (from Cursor): The strongest architectural idea is not trigrams per se — it's
**indexed base + fresh overlay**. Search the indexed corpus first (we know exactly which
files are in it), then layer dirty/untracked files on top.

**Implementation**:

### 4.1 Indexed-file list

At index load time, build a Set of all files in the LI index:

```javascript
// Built from LI index metadata (already has file paths)
const indexedFiles = new Set(
  [...liIndex.documents.values()].map(doc => doc.metadata.file)
);
```

Pass this to ripgrep as explicit positional file paths, batched to stay under `ARG_MAX`.
The installed `rg` in our environment does not expose `--files-from` / `--paths-from`,
so the implementation needs to own batching itself:

```bash
# Option A: batched file argv (primary)
rg --json <regex> fileA.ts fileB.ts fileC.ts ...

# Option B: coarse glob restriction (fallback, less precise)
rg --glob '!node_modules' --json <regex> <dir>
```

Option A is ideal in this codebase: ripgrep does not traverse the whole tree for each
query, and we keep file-list control in-process. For a 5K-file indexed corpus in a
50K-file monorepo, this is a 10x reduction in I/O before any regex matching happens.

### 4.2 Dirty overlay

After searching indexed files, also search files that are:
- Modified since last index (mtime > index time)
- Untracked by the index (new files)

These matches go into the "unindexed" bucket (existing lazy fallback,
`core/search/search-pattern.js` already handles this). But now they're explicitly identified rather than mixed in with
indexed matches.

Detection should reuse the existing incremental tracker instead of Git state:
- Load the tracker state (`lastIndex`, stored `size`/`mtime_ns`)
- Compare current filesystem metadata against stored entries
- Files whose metadata changed since `lastIndex` go to the dirty overlay
- Files absent from tracker state are treated as untracked/unindexed

This works outside Git, and it correctly answers "changed since last index" instead of
"different from HEAD."

This approach is validated by Iakovlev et al. 2024 ("Trigram-Based Persistent IDE
Indices with Quick Startup", ITMO/Huawei, arXiv:2403.03751), which demonstrated
delta-based version tracking for trigram indices across git revisions. Their checkout
between recent versions takes ~0.1ms. Our mtime-based approach is simpler (no revision
tree) but achieves the same goal: avoid full re-scan by tracking what changed.

### 4.3 Expected latency improvement

| Scenario | Current (full scan) | Phase 2 (indexed + overlay) |
|----------|--------------------|-----------------------------|
| 5K indexed files in 50K-file repo | ~25ms | ~5ms |
| 10K indexed files in 200K-file monorepo | ~500ms+ | ~15ms |
| Indexed files only, no dirty | Same | Same (no overlay cost) |

**Effort**: 1 day
**Files**: `core/search/search-pattern.js` (modify `runRipgrep`, `patternSearch`),
           `core/indexing/indexer-ann.js` (expose indexed file list)

---

## 5. Phase 3: Regex Literal Extraction (Fast Path)

**Problem**: Even when searching only indexed files, ripgrep must test every file against
the regex. For a highly selective regex like `AuthenticationServiceFactory`, ripgrep still
opens and reads every file. Most files can be eliminated just by checking if they contain
the required literals.

**Insight** (Russ Cox, 2012): Statically analyze the regex to extract required literal
substrings. Any file that doesn't contain ALL required literals provably cannot match the
regex. Pre-filter files using fast literal search, then run the full regex only on
candidates.

### 5.1 Literal extraction algorithm

Given a regex, extract a boolean formula of required literals:

```
/class\s+Auth\w+Service/  →  AND("class", "Auth", "Service")
/foo|bar/                 →  OR("foo", "bar")
/\bimport\s+{[^}]+}\s+from\s+'react'/  →  AND("import", "from", "react")
/[a-z]+_handler/          →  AND("_handler")
/(get|set)Config/         →  AND("Config") AND OR("get", "set")
```

Rules:
- Concatenation → AND (all literals required)
- Alternation → OR (any literal sufficient)
- Character classes → skip unless small (expand `[abc]` but not `[a-z]`)
- Quantifiers (`*`, `+`, `?`) → the literal before/after is still required if fixed
- Anchors, lookahead → ignore for literal extraction

This is a well-studied problem. Russ Cox's `codesearch` tool, Go's `regexp/syntax`
package, and ripgrep's own literal extraction (`grep-regex` crate) all implement variants.

### 5.2 Using extracted literals for pre-filtering

Two options for fast literal matching:

**A. ripgrep fixed-string prefilter** (recommended first):
```bash
# Extract literals, search only files matching ALL of them
# Option A1: single invocation using --and (ripgrep 14+)
rg --files-with-matches -F "Auth" --and -F "Service" fileA.ts fileB.ts ...
# Then verify full regex on candidates:
rg --json "class\s+Auth\w+Service" <candidate-files...>

# Option A2: chained invocations (fallback if --and unavailable)
rg --files-with-matches -F "Auth" fileA.ts fileB.ts ... | \
  xargs rg --files-with-matches -F "Service" | \
  xargs rg --json "class\s+Auth\w+Service"
```

Prefer A1 (`rg --and`) where available — it eliminates multi-spawn overhead by doing
boolean AND of multiple fixed-string patterns in a single ripgrep invocation. Fall back
to A2 (batched `rg -F -l` from Node, not shell pipes) when `--and` is unavailable.
The important part is that ripgrep still does the literal prefiltering and final regex
verification.

**B. In-process literal scan using a dedicated text cache**:

If we later add a compact chunk-text cache or a memory-mapped text sidecar, we can test
required literals with `String.includes()` before invoking ripgrep on the reduced file
set. This is promising, but it is not free today because the LI index only stores token
embeddings plus metadata, not chunk bodies.

```javascript
// Pseudocode
const requiredLiterals = extractLiterals(regex);
const candidateChunks = cachedChunks.filter(chunk =>
  requiredLiterals.every(lit => chunk.content.includes(lit))
);
// Final regex verification still goes through ripgrep, not JS RegExp
const matchingFiles = candidateChunks.map(c => c.file);
const matches = await runRipgrepOnFiles(regex, matchingFiles);
```

**Recommendation**: Option A now, Option B only after we have an explicit text cache.
The current codebase does not keep chunk bodies in the LI index, so "pure JS, no spawn
overhead" is not true yet. The first useful step is extracting literals, using ripgrep's
fixed-string mode to shrink the file set, then rerunning the full regex on that reduced
set.

### 5.3 When literal extraction fails

Some regexes yield no extractable literals: `.*`, `[a-z]+`, `\d{3}-\d{4}`. In these
cases, fall back to the Phase 2 approach (scan all indexed files). This is the correct
behavior — the regex is so broad that no pre-filtering is possible.

Track the extraction hit rate in stats so we can see how often this fallback triggers.

### 5.4 Case-insensitive patterns

When the regex contains a `(?i)` flag or is globally case-insensitive, literal extraction
must handle case folding. For example, `(?i)auth` requires matching "Auth", "AUTH",
"auth", etc. Two options:

- **Expand literals**: generate all case variants of extracted literals. For short
  literals this is fine; for long ones it's exponential. Cap at some length (e.g., 8
  chars) and fall back to no-prefilter for longer case-insensitive literals.
- **Use ripgrep's `-i` flag**: pass `-i` to the `rg -F` prefilter invocation so ripgrep
  handles case-insensitive matching natively. This is simpler and correct.

Recommend option 2. This avoids the case-expansion bug class documented in ripgrep
issue #93 and the coregex project.

### 5.5 Implementation: JS parser or Rust binary?

Phase 3 runs before Phase 4's Rust crate exists. Two approaches for `extractLiterals()`:

- **A. JS regex parser**: Use `regexp-tree` or `regjsparser` npm package to parse the
  regex into an AST, then walk it to extract literals. Pros: no native dependency.
  Cons: reimplements logic that Phase 4 will redo in Rust via `regex-syntax`.
- **B. Rust binary subcommand**: Add a `--extract-literals` flag to the existing native
  CLI binary that calls `regex-syntax` and outputs the boolean formula as JSON. Phase 3
  calls this from Node. Pros: single implementation carries through to Phase 4; correct
  handling of all regex features including Unicode and case folding. Cons: requires the
  native binary to exist.

**Recommendation**: Option B if the native crate is already shipping (it is, for MaxSim).
Add a lightweight `--extract-literals <regex>` subcommand that returns JSON. This avoids
writing a JS regex parser that will be discarded when Phase 4 ships, and it gives us
correct case-folding and Unicode handling from day one via `regex-syntax`.

If the native binary is unavailable (e.g., unsupported platform), fall back to a simple
JS heuristic: split the regex string on obvious non-literal metacharacters (`\s`, `\w`,
`\d`, `.`, `*`, `+`, `?`, `[`, `]`, `(`, `)`, `|`, `{`, `}`) and use the surviving
fixed substrings longer than 2 characters as AND-required literals. This handles ~80% of
common patterns without a full parser.

**Effort**: 1-2 days
**Files**: `core/search/search-pattern.js` (new `extractLiterals()` function, modified
search path), Rust crate (add `--extract-literals` subcommand)

---

## 6. Phase 4: Sparse Gram Index (Enterprise Scale)

**When to build this**: Only after Phase 3 is shipped and profiling shows that literal
extraction still isn't enough — typically when indexed corpus exceeds ~50K chunks or
agent workflows trigger >5 concurrent pattern searches.

**Why not plain trigrams**: Plain trigrams (3-character subsequences) have a selectivity
problem on code. `for`, `int`, `var`, `the`, `ret`, `urn`, `fun` appear in nearly every
file. The posting lists for these trigrams are huge, so intersecting them barely reduces
candidates.

**Why not plain bigrams (fff approach)**: fff/fastgrep uses all 4,761 case-insensitive
ASCII bigrams with hybrid column storage and achieves <1ms prefiltering on Chromium
(487K files). Bigrams are simpler to implement (byte-pair splitting, no weight function)
and their bounded key space (69² = 4,761) avoids hashing. For repos under ~100K files,
bigrams are likely sufficient — fff's empirical data shows trigrams already reduce
candidates to <1K for most queries at that scale. However, bigrams have lower selectivity
than sparse n-grams on very large repos (>200K files) because more files share the same
bigram. We choose sparse n-grams for enterprise scale, but an implementer could start
with bigrams as a simpler Phase 4a and add sparse n-gram support later. The hybrid
posting format (§6.3) and SIMD intersection (§6.1 item 6) work identically for both.

This choice is validated by Zhang et al. 2025 ("An Evaluation of N-Gram Selection
Strategies for Regular Expression Indexing", CMU/Microsoft Gray Systems Lab), which
found that frequency-based n-gram selection (their "FREE" strategy) — equivalent to our
per-codebase inverse-frequency weights — is optimal for large, diverse code workloads.
Their query-aware strategies (BEST, LPMS) are better for structured log data but have
quadratic build cost that makes them impractical at code search scale.

### 6.1 Sparse N-grams (GitHub Blackbird / ClickHouse approach)

Assign a deterministic weight to each character bigram based on frequency in a large code
corpus. Extract variable-length n-grams where the boundary bigram weights exceed all
interior bigram weights.

**Effect**: Common trigrams like `for` have low-weight boundaries and get absorbed into
longer grams like `for_each` or `format`. Rare trigrams like `zig` keep their short form.
Result: fewer grams, much more selective posting lists.

**Character-pair weight table**: The weight function is the most important component of
the sparse gram index. It determines n-gram boundaries and therefore the selectivity of
every posting list. Getting it wrong makes the entire index useless.

**Implementation requirements**:

1. **Must be built in Rust.** The weight table construction is a single-pass byte scan
   over the indexed corpus — counting `counts[prev_byte][next_byte]` for every adjacent
   pair. This is L1-cache-bound (128×128 × 4 bytes ≈ 64KB), not compute-bound. On a
   50MB corpus (~1M LOC), Rust completes this in ~50ms. Even in JS it's under 500ms.
   Because the sparse gram index itself will be Rust (mmap'd binary, no GC pauses), the
   weight table builder must also be Rust — same binary, same build step.

2. **Must be built per-codebase.** A React frontend, a Linux kernel module, and a Go
   microservice have radically different bigram distributions. A generic table will
   produce poor boundaries for all of them. The weight table is rebuilt at index time
   alongside the LI embeddings (where it adds negligible cost). Weights are stored in
   the `.sweet-search/` index directory alongside the sparse gram postings file.

3. **Must ship a built-in fallback for cold start.** When the user adds sweet-search to
   an empty or tiny codebase (< 1000 LOC), the per-codebase table has insufficient data.
   In this case, fall back to a static weight table compiled into the Rust binary.

   **Source for the fallback table**: The `danlark1/sparse_ngrams` C++ reference
   implementation (Boost License 1.0, by the GitHub code search engineer) contains the
   weight computation algorithm used in GitHub Blackbird. Additionally, Daniel de Kok's
   `danieldk` gist on GitHub provides measured character-level bigram frequencies across
   multiple programming languages (Rust, Go, Python, etc.), which can serve as seed data.
   Either source can be used to pre-compute a "generic code" weight table shipped as a
   const array in the Rust binary.

   **Note**: GitHub's blog post describes the algorithm ("assume you have some function
   that given a bigram gives a weight") but does NOT publish their production weight
   table. Cursor's blog also withholds their weights. Both are proprietary. The algorithm
   itself is fully open via `danlark1/sparse_ngrams`.

4. **Weight semantics**: Weights are **inverse frequency** — common bigrams like `fo`,
   `or`, `in` get LOW weight. Rare bigrams like `t_`, `zz`, `q(` get HIGH weight.
   N-gram boundaries form where the boundary bigram's weight exceeds all interior
   bigrams. This causes common trigrams (`for`, `int`, `var`) to be absorbed into longer,
   more selective grams (`format`, `interface`, `variable`).

5. **Must live in the existing native binary.** The sparse gram builder, weight table
   computation, and posting list intersection are added to the **same Rust crate** as the
   MaxSim napi-rs addon (`@sweet-search/native-<platform>`). No new package. The existing
   per-platform packaging model from INIT_STRATEGY.md applies unchanged:

   ```
   @sweet-search/native-darwin-arm64    ← already ships maxsim.node + Rust CLI
   @sweet-search/native-darwin-x64
   @sweet-search/native-linux-x64-gnu
   @sweet-search/native-linux-arm64-gnu
   ```

   The CLI dispatch logic (`bin/sweet-search.js` → `native-resolver.js` → Rust binary)
   already handles native-vs-JS fallback. The sparse gram index is native-only — there is
   no JS fallback for Phase 4. If the native binary is absent, Phase 4 is skipped and the
   search pipeline falls back to Phase 3 (literal extraction in JS) or Phase 2 (indexed
   file scan).

6. **Must use SIMD for posting list intersection.** The hot path is intersecting posting
   lists across multiple grams. With hybrid storage (see §6.3), dense bitset intersection
   is bitwise AND — trivially SIMD-able:

   - **x86-64 (AVX2)**: 256-bit registers = 256 files per AND instruction
   - **ARM (Apple Silicon NEON)**: 128-bit registers = 128 files per AND instruction
   - **Fallback**: plain `u64` bitwise AND = 64 files per instruction

   Use Rust's `std::simd` (portable-simd, stabilizing) for cross-platform code with
   `std::arch` specializations for hot paths. Runtime feature detection via
   `is_x86_feature_detected!` / compile-time `#[cfg(target_arch)]`. Same pattern
   usearch uses for HNSW distance computation in this codebase.

   Key SIMD references for the implementer:
   - Lemire & Boytsov 2014 (arXiv:1401.6399): foundational SIMD integer list compression
     and intersection (SIMD-BP128). Covers galloping search with SIMD acceleration.
   - Clausecker & Lemire 2024 (arXiv:2412.16370): faster positional population counts
     for AVX2, AVX-512, AND ARM ASIMD. Directly applicable to dense×dense bitwise AND +
     popcount. Provides Apple Silicon ASIMD implementations.
   - Schmidbauer 2022 (arXiv:2112.06342): faster-than-native VP2INTERSECT alternatives
     using basic AVX512F instructions. For sparse×sparse, software implementations
     outperform the native VP2INTERSECT instruction.

   SIMD also applies to:
   - Weight table build (byte pair counting across a buffer)
   - Dense bitset population count (for density threshold decisions)

   Gram extraction itself is a sequential scan with weight comparisons — harder to
   vectorize, but it's cache-bound anyway and not on the query hot path (only index
   build time).

### 6.2 ~~Phrase-Aware Masks~~ — NOT USED (GitHub confirmed ineffective)

An earlier version of this plan proposed position masks and next-character bloom filters
on posting entries (the "3.5-gram" idea). **GitHub's own engineer confirmed on HN that
they tried follow masks and they "saturate too quickly to be useful."** (HN thread:
`news.ycombinator.com/item?id=34682472`, user `100k`, Feb 2023.)

GitHub Blackbird uses covering sparse grams to produce candidate documents, then searches
the actual content for verification — no positional posting metadata. We follow the same
approach: sparse gram postings contain only document IDs (delta-encoded), and final match
verification is done by ripgrep on the candidate file set.

### 6.3 Index structure — Hybrid posting storage

Not all grams are created equal. Some appear in 80% of files (`in`, `re`, `th`), others
in 0.1% (`zq`, `q(`). Storing both the same way wastes either space or speed.

**Hybrid column storage** (adapted from fff/fastgrep): each gram's posting list uses
one of two representations, chosen at index build time based on density:

```
Dense bitset (gram appears in >D% of files, where D = density threshold):
┌──────────────────────────────────────────────────┐
│ bit 0  bit 1  bit 2  bit 3  ...  bit N           │  ← one bit per file
└──────────────────────────────────────────────────┘
Size: numFiles / 8 bytes.  For 20K files = 2.5KB per dense column.
Intersection: bitwise AND — one CPU instruction per 64 files (SIMD: 256+).

Sparse posting list (gram appears in ≤D% of files):
┌──────────────────────────────────────────────┐
│ fileId₀  fileId₁  ...  fileIdₖ               │  ← sorted, delta+varint encoded
└──────────────────────────────────────────────┘
Size: k × ~2 bytes (varint).  For 12 matching files = ~24 bytes.
Intersection: merge-intersect two sorted lists — O(smaller list).

Alternative sparse encoding: Elias-Fano (Vigna 2012, arXiv:1206.4300) can be more
space-efficient than delta+varint for very sparse, high-gap posting lists by encoding
the high bits of each integer in a unary stream and the low bits in a fixed-width
array. This enables O(1) random access and efficient intersection without full
decompression. Start with delta+varint (simpler, well-understood); consider Elias-Fano
as an optimization if profiling shows sparse list intersection is a bottleneck.
```

**Density threshold D**: Use fff's adaptive formula instead of a fixed percentage:
a gram switches from sparse posting list to dense bitset when
`popcount × 4 bytes ≥ ⌈file_count/64⌉ × 8 bytes`. This yields ~3.1% for large corpora
(Chromium-scale), automatically adapting to corpus size. fff uses 1,280 dense + 3,481
sparse for Chromium (487K files) with this formula.

**Why not Roaring bitmaps?** Roaring (Lemire et al. 2017, arXiv:1709.07821) is a mature
compressed bitmap library that automatically handles the dense/sparse transition via
container types (array, bitset, run-length). However, for our use case: (1) the flat
mmap'd format is simpler and requires no library dependency, (2) Roaring's container
dispatch adds overhead per operation that we avoid with a single isDense flag per gram,
and (3) our key space is small enough (thousands of grams, not millions of terms) that
Roaring's space-saving features provide negligible benefit. The custom format also
guarantees zero-copy mmap access, which Roaring's library doesn't natively support.
If profiling shows the custom format is insufficient, Roaring is a known fallback via
the `roaring` Rust crate.

**Intersection dispatch** (three cases, chosen at query time):

| Left | Right | Algorithm |
|------|-------|-----------|
| Dense | Dense | Bitwise AND (SIMD) — fastest |
| Dense | Sparse | Iterate sparse, probe bit in dense — O(sparse size) |
| Sparse | Sparse | Merge-intersect sorted lists — O(min list size) |

**Full index layout:**

```
┌─────────────────────────────┐
│ Header                      │  Version, gram count, file count, density threshold
├─────────────────────────────┤
│ Sparse Gram Lookup Table    │  Memory-mapped, gram hash → column descriptor
│ (sorted by gram hash)       │  Column descriptor: offset + length + isDense flag
├─────────────────────────────┤
│ Dense Columns               │  Contiguous bitset blocks
│ [bit₀ bit₁ ... bitₙ]       │  One block per dense gram
├─────────────────────────────┤
│ Sparse Columns              │  Delta+varint encoded posting lists
│ [delta₀ delta₁ ... deltaₖ] │  One list per sparse gram
├─────────────────────────────┤
│ Bigram Weight Table         │  128×128 f32 array (64KB)
│ (built per-codebase)        │  Fallback: static generic table
└─────────────────────────────┘
```

Built during indexing alongside the LI index. Stored as a compact binary file
(e.g., `.sweet-search/sparse-grams.idx`). Memory-mapped at load time. The Rust
binary owns both build and query; JS never touches this file directly.

### 6.4 Query pipeline with sparse gram index

Two stages: regex → required literals (boolean formula), then literals → sparse grams
→ posting list intersection.

```
regex string
    │
    ▼
 ┌────────────────────────────────────────────────────────┐
 │ Stage A: Regex → AST → Required Literals               │
 │                                                        │
 │  Parse regex into syntax tree (Rust: `regex-syntax`    │
 │  crate by BurntSushi). Walk tree, extract boolean      │
 │  formula of required literal substrings.               │
 └────────────────────────────────────────────────────────┘
    │
    │  e.g., AND("class", "Auth", "Service")
    ▼
 ┌────────────────────────────────────────────────────────┐
 │ Stage B: Literals → Sparse Grams → Posting Intersection│
 │                                                        │
 │  Apply weight function to each literal to decompose    │
 │  into sparse grams. Look up posting lists. Intersect   │
 │  (AND) or union (OR) per the boolean formula.          │
 └────────────────────────────────────────────────────────┘
    │
    │  candidate file IDs (typically 0.1-5% of corpus)
    ▼
  ripgrep verifies full regex on candidate files only
    │
    ▼
  Map to chunks → MaxSim rerank (unchanged)
```

#### Stage A: Regex AST walk for literal extraction

The `regex-syntax` crate (by the author of ripgrep) provides a complete `Hir`
(high-level IR) for any regex. The literal extraction walk maps each AST node to a
boolean formula:

| AST Node | Rule | Example |
|----------|------|---------|
| `Literal("abc")` | Emit the string | `"abc"` |
| `Concat(a, b)` | AND — both sides required | `ab` → AND(a, b) |
| `Alternation(a, b)` | OR — either side sufficient | `a\|b` → OR(a, b) |
| `Class(\s, \w, [a-z])` | **Break** — no extractable literal | yields empty |
| `Repetition(*, +, ?)` | **Break** — variable length splits chain | yields empty |
| `Group(child)` | Transparent — recurse into child | unwrap |
| `Anchor(^, $), Lookahead` | Ignore — no effect on literals | skip |

Walk example — `class\s+Auth\w+Service`:

```
Concat
├─ Literal("class")      → "class"
├─ \s+                    → BREAK (variable-length, splits literal chain)
├─ Literal("Auth")        → "Auth"
├─ \w+                    → BREAK
└─ Literal("Service")     → "Service"

Result: AND("class", "Auth", "Service")
```

Walk example — `(get|set)Config`:

```
Concat
├─ Alternation
│  ├─ Literal("get")     → "get"
│  └─ Literal("set")     → "set"
│  → OR("get", "set")
└─ Literal("Config")     → "Config"

Result: AND(OR("get", "set"), "Config")
```

**When extraction yields nothing**: Regexes like `.*`, `[a-z]+`, `\d{3}-\d{4}` produce
an empty formula (no required literals). The Rust binary returns "no candidates could be
eliminated" and the search falls back to Phase 2/3. This is correct — the regex is too
broad for any prefilter.

The extraction walk is ~100 lines of Rust on top of `regex-syntax::Hir`. It does NOT
reimplement regex parsing — it delegates entirely to the battle-tested `regex-syntax`
crate.

```rust
use regex_syntax::hir::{Hir, HirKind};

// NOTE: targets regex-syntax 0.8+ (shipped with regex 1.10+).
// In 0.7+, HirKind::Group was removed — use HirKind::Capture instead.
// HirKind::Look (lookahead/lookbehind) should be skipped (no effect on literals).
fn extract_literals(hir: &Hir) -> BoolFormula {
    match hir.kind() {
        HirKind::Literal(lit)       => Formula::Lit(lit.0.clone()),
        HirKind::Concat(subs)       => Formula::And(subs.iter().map(extract_literals).collect()),
        HirKind::Alternation(subs)  => Formula::Or(subs.iter().map(extract_literals).collect()),
        HirKind::Repetition(_)
        | HirKind::Class(_)         => Formula::Empty,
        HirKind::Capture(cap)       => extract_literals(&cap.sub),
        HirKind::Look(_)            => Formula::Empty,  // anchors, lookahead
        _                           => Formula::Empty,
    }
}
```

**Case-insensitive handling**: When `hir.properties().is_utf8()` and the pattern has
case-insensitive flags, `regex-syntax` normalizes `Literal` nodes to their folded form
but may produce `Class` nodes for case-insensitive character ranges. The walk above
correctly treats those as `Empty` (no extractable literal), which causes a fallback to
Phase 2/3. This is conservative but correct — no false negatives.

#### Stage B: Literals → Sparse Grams → Posting Intersection

Each literal in the boolean formula is decomposed into its constituent sparse grams
using the weight function (§6.1). For example, `"Service"` with boundary weights might
produce grams `["Ser", "rvic", "ice"]`.

Intersection follows the boolean formula structure:

- **AND**: intersect posting lists (all grams must match) — uses hybrid dispatch from §6.3
- **OR**: union posting lists (any gram sufficient)
- **Nested**: evaluate bottom-up, materializing intermediate candidate sets

#### Gram extraction from text (index build time)

The complementary operation to Stage A/B is extracting sparse grams from document text
at index build time. This is the core of the sparse gram algorithm (from GitHub Blackbird
/ ClickHouse / Cursor). Two modes:

**build_all** (indexing): extract ALL sparse grams from a text. Walk the text, compute
bigram weights for each adjacent pair. An n-gram boundary forms where the boundary
bigram weight exceeds all interior bigram weights. Recurse until the minimum gram length
(trigram) is reached.

**build_covering** (querying): extract only the MINIMAL covering set of grams needed to
match the query in the index. Because weights are deterministic, the covering grams at
query time are a subset of the grams generated at index time.

```rust
/// Extract all sparse grams from `text` using the weight function `w`.
/// Each gram is a (start, end) byte range in the text.
fn extract_all_grams(text: &[u8], w: &WeightTable) -> Vec<(usize, usize)> {
    let mut grams = Vec::new();
    extract_recursive(text, 0, text.len(), w, &mut grams);
    grams
}

fn extract_recursive(
    text: &[u8], start: usize, end: usize,
    w: &WeightTable, out: &mut Vec<(usize, usize)>,
) {
    if end - start <= 3 {
        // Minimum gram length reached (trigram). Emit as-is.
        if end - start >= 2 { out.push((start, end)); }
        return;
    }
    // Find the interior bigram with maximum weight.
    let mut max_w = 0u32;
    let mut max_pos = start + 1;
    for i in (start + 1)..(end - 1) {
        let bw = w.weight(text[i], text[i + 1]);
        if bw > max_w { max_w = bw; max_pos = i; }
    }
    // Check if boundary weights exceed the interior max.
    let left_w = w.weight(text[start], text[start + 1]);
    let right_w = w.weight(text[end - 2], text[end - 1]);
    if left_w > max_w && right_w > max_w {
        // This entire span is one gram (boundaries dominate interior).
        out.push((start, end));
    } else {
        // Split at the max interior weight and recurse.
        extract_recursive(text, start, max_pos + 1, w, out);
        extract_recursive(text, max_pos, end, w, out);
    }
}

/// Extract covering grams from a query literal (query time).
/// Only returns the minimal set needed to match in the index.
fn extract_covering_grams(text: &[u8], w: &WeightTable) -> Vec<(usize, usize)> {
    // At query time, only emit grams at the boundary positions
    // (where boundary weight > all interior weights). These are
    // guaranteed to exist in the index for any matching document.
    // See danlark1/sparse_ngrams for the full algorithm.
    let all = extract_all_grams(text, w);
    // The covering set is the subset of grams whose boundaries
    // align with the global minima of the weight landscape.
    // For a complete implementation, see the Cursor blog visualization
    // or the danlark1/sparse_ngrams C++ reference.
    all // Simplified — production code should filter to covering set
}
```

This pseudocode illustrates the core recursive boundary detection. For a complete,
production-quality implementation, see the `danlark1/sparse_ngrams` C++ reference
(Boost License 1.0) and the interactive visualization in Cursor's blog post.

The entire Stage A + Stage B pipeline runs inside the Rust binary. Node calls it as a
single napi-rs function or subprocess invocation: pass regex string in, get candidate
file IDs out. JS never parses the regex or touches posting lists.

### 6.5 Expected performance at scale

| Corpus Size | Phase 2 (indexed scan) | Phase 3 (literal filter) | Phase 4 (sparse gram) |
|-------------|----------------------|-------------------------|----------------------|
| 100MB / 2K files | ~5ms | ~2ms | ~1ms |
| 1GB / 20K files | ~15ms | ~5ms | ~1ms |
| 10GB / 200K files | ~150ms | ~20ms | ~1ms |
| 100GB / 2M files | seconds | ~200ms | ~2ms |

The sparse gram index is O(result_set), not O(corpus). At any scale, lookup is constant
time per gram, and intersection is proportional to the smallest posting list.

### 6.6 Incremental updates

Two strategies:

**A. Append-only overlay** (Cursor's approach):
- Base index built at index time
- New/modified files get their grams added to an in-memory overlay
- Overlay merged into base on next full re-index
- Simple, fast updates, slight memory cost

**B. Content-hash dedup** (GitHub's approach):
- Index by file content hash (or chunk content hash)
- Unchanged content is never re-indexed
- Only new content hashes get new posting entries
- More complex, better for large-scale incremental

**Recommendation**: Start with A. Our index is local and re-indexes are fast. The overlay
approach matches our existing incremental indexing model.

### 6.7 AST-aware gram postings (Phase 4.1 enhancement)

The LI index already stores `chunk_type` (class, function, method, import) and `symbol`
(the entity name) per document, populated by the AST chunker:

```javascript
// core/indexing/indexer-ann.js:136-140 (existing code)
await index.add(chunk.id, truncatedEmbedding, {
  file: chunk.file,
  name: chunk.metadata?.symbol,      // e.g., "SweetSearch"
  type: chunk.metadata?.chunk_type,   // e.g., "class", "function", "method"
});
```

The sparse gram index can carry the same metadata. During index build, the gram
builder receives chunks with their AST metadata already attached (from the same
indexing pipeline). Each posting entry can optionally include a compact symbol-type
tag (1 byte: function=1, class=2, method=3, import=4, type=5, other=0).

**What this enables:**

- Bare grep (Phase 5) can filter results by symbol type without reading files:
  `sweet-search grep 'auth.*handler' --type=function` returns only function matches
- Agent mode context packaging (USEFUL_ANSWER_COLGREP_PLAN.md) can apply symbol-
  complete expansion to bare grep results, not just ColGrep ranked results
- Eliminates the grep-then-read-to-confirm cycle that Moderne Trigrep solves with
  LSTs — we get the same benefit from our existing AST chunker metadata

**Composition with USEFUL_ANSWER plan:**

```
INDEXED_GREP (this plan):  regex → sparse gram candidates → matches + symbol metadata
USEFUL_ANSWER (next plan): matches → symbol expansion → token-budgeted context packages

Combined pipeline:
  regex → sub-linear candidates → matches with chunk_type/symbol
        → agent mode expansion → self-contained code blocks
```

The two plans compose naturally. No DDD violation: the indexing domain builds grams +
metadata, the search domain queries them, the agent presentation layer (USEFUL_ANSWER)
is post-ranking and works on either pipeline's output.

**Effort**: +0.5 day on top of Phase 4 (metadata is already in the pipeline; this is
wiring it into the posting format and adding a filter flag to the query API)

**Not required for Phase 4 MVP.** Ship the gram index without symbol tags first,
add them as a follow-up. The posting format should reserve a byte per entry for the
tag from day one to avoid a format migration.

---

**Effort**: 3-5 days (Phase 4 core), +0.5 day (Phase 4.1 AST metadata)
**Files**: Rust code in `@sweet-search/native-<platform>` crate (gram builder, index
format, query intersection, SIMD kernels), JS bridge in `core/search/sparse-gram-index.js`
(calls native binary or napi-rs addon), modifications to `core/indexing/indexer-ann.js`
(trigger gram build during indexing), `core/search/search-pattern.js` (use gram index
for candidate generation)

---

## 7. Phase 5: Bare Grep Mode (No Semantic Ranking)

**Motivation**: Phases 1-4 build a fast, sub-linear regex search engine. But the only way
to use it today is through `patternSearch()`, which always runs MaxSim reranking, query
encoding, and late interaction scoring. Many use cases — developer grep, CI lint checks,
refactoring tools, symbol renaming, dead-code detection — need *all matches* with *zero
semantic overhead*. They want ripgrep speed with our index-awareness, not a ranked top-K.

Exposing the optimized grep pipeline as a standalone mode gives users the best code search
tool on the planet for exact-match workloads, without paying for embedding inference or
MaxSim scoring they don't need.

### 7.1 What "bare grep" means

```
Full ColGrep pipeline:
  regex → [Phase 1-4 candidate gen] → chunk mapping → encodeQuery() → MaxSim rerank → top-K

Bare grep pipeline:
  regex → [Phase 1-4 candidate gen] → file:line matches → done
```

No query encoding (~6ms saved). No MaxSim scoring. No top-K truncation. All matches
returned, ordered by file path and line number (deterministic, reproducible). The result
is a flat list of `{file, line, column, matchText, context}` — the same shape ripgrep
returns, but produced sub-linearly.

### 7.2 API surface

```javascript
// New export alongside existing patternSearch()
const { bareGrep } = require('./core/search/search-pattern');

const results = await bareGrep(regex, {
  projectRoot: '/path/to/repo',
  // Optional: use indexed-file scope (Phase 2). Default: true if index exists.
  useIndex: true,
  // Optional: include dirty overlay (Phase 2). Default: true.
  includeDirty: true,
  // Optional: use literal extraction (Phase 3). Default: true.
  useLiteralFilter: true,
  // Optional: use sparse gram index (Phase 4). Default: true if index exists.
  useSparseGrams: true,
  // Optional: context lines around each match (like rg -C).
  contextLines: 0,
  // Optional: glob filters (like rg --glob).
  globs: ['!node_modules', '*.ts'],
  // Optional: max matches (0 = unlimited). Default: 0.
  maxMatches: 0,
});

// results: Array<{ file, line, column, matchText, contextBefore?, contextAfter? }>
```

This is intentionally a low-level API. It does not depend on the LI index being loaded
for semantic data — only for the file list (Phase 2) and sparse grams (Phase 4). If
neither index exists, it falls back to a full ripgrep scan with Phase 1 correctness fixes
applied.

### 7.3 CLI entry point

```bash
# Bare grep via sweet-search CLI
sweet-search grep 'class\s+Auth\w+Service' --context 2

# Equivalent to ripgrep, but uses indexed file scope + literal prefilter
sweet-search grep -F 'TODO' --glob '*.ts'

# Force full-scan (ignore index)
sweet-search grep 'pattern' --no-index
```

The CLI should feel like `rg` with the same flag vocabulary where possible (`-F`, `-l`,
`-C`, `--glob`, `--type`). Users who know ripgrep should feel at home. The difference is
invisible: searches are scoped to indexed files and pre-filtered by extracted literals or
sparse grams, making them faster on large repos without the user doing anything.

### 7.4 Use cases unlocked

| Use Case | Why bare grep, not ColGrep |
|----------|---------------------------|
| Symbol renaming / refactoring | Need ALL matches, not top-K ranked |
| Dead code detection | Searching for zero references — ranking is meaningless |
| CI lint / policy checks | Exact pattern enforcement, no fuzzy |
| `grep -c` style counting | Just need counts, not semantic similarity |
| IDE "find all references" backend | Deterministic, complete results expected |
| Agent tool: precise code search | When an agent needs exact regex, not "similar code" |
| Migration scripts | Find all usages of deprecated API |

### 7.5 Performance characteristics

Bare grep inherits all Phase 1-4 optimizations but skips the two most expensive stages
of the ColGrep pipeline:

| Component | ColGrep | Bare Grep | Saved |
|-----------|---------|-----------|-------|
| Query encoding (model inference) | ~6ms | 0ms | 6ms |
| MaxSim reranking | ~2-8ms (scales with candidates) | 0ms | 2-8ms |
| Chunk mapping | ~1ms | 0ms (line-level output) | 1ms |
| Total overhead removed | — | — | **~9-15ms** |

On a warm server, bare grep on an indexed repo should return in **<5ms** for selective
patterns and **<15ms** even for broad patterns on large repos — competitive with raw
ripgrep on small repos, but dramatically faster on large ones.

### 7.6 Implementation notes

- `bareGrep()` should share the candidate generation pipeline with `patternSearch()`.
  Extract the Phase 1-4 logic into a shared `generateCandidates(regex, opts)` function
  that both code paths call. `patternSearch()` feeds candidates into MaxSim;
  `bareGrep()` returns them directly.
- The ripgrep invocation in the final verification step should use `--json` output for
  structured results, same as today. The only difference is that we return the parsed
  ripgrep JSON as-is instead of mapping to chunks.
- Stats reporting should still work: `bareGrep()` returns a `stats` object with timing
  breakdown (candidate gen time, ripgrep verify time, total matches, files searched,
  files skipped). This feeds into benchmarking and telemetry.

### 7.7 Relationship to existing grep tools

This is NOT a ripgrep replacement for general terminal use. It's a **project-aware grep**
that leverages sweet-search's index for speed. The value proposition:

```
ripgrep alone:       O(corpus) — scans everything, every time
bare grep mode:      O(result_set) — uses index to skip non-matching files
ColGrep:             O(result_set) + semantic ranking — for "find similar code"
```

All three have a place. Bare grep is the middle ground for users who want index-backed
speed but don't need semantic ranking.

**Effort**: 0.5-1 day (after Phases 1-3 are done — mostly wiring, since the hard parts
are the candidate generation phases)
**Files**: `core/search/search-pattern.js` (extract shared pipeline, add `bareGrep()`
export), new CLI command in `cli/` or `bin/`

---

## 8. What NOT to Build

1. **Suffix arrays** (livegrep). Can't do incremental updates. Requires concatenating
   the entire corpus into one string. Wrong for local, evolving codebases.

2. **Full FTS5 trigram on source text**. The existing `entities_trigram` table in
   `core/graph/graph-extractor.js:150` only indexes entity names and signatures. Extending it to
   full source text would bloat the SQLite database enormously, and SQLite's trigram
   tokenizer is primarily a substring / `MATCH` / `LIKE` / `GLOB` accelerator, not a
   general regex engine. Wrong tool for pattern-mode verification.

3. **PLAID/SPLATE/WARP for this problem**. Those are about semantic candidate generation
   and multi-vector retrieval. They don't help with "make regex faster." They're listed
   in COLGREP_PLAN.md for the semantic ranking side, which is a separate concern.

4. **~~Custom binary postings format (premature)~~** — Superseded. §6.3 now specifies a
   hybrid mmap'd binary format with dense bitsets and sparse posting lists. This is
   justified by the SIMD intersection requirement (§6.1 item 6) — you can't do bitwise
   AND on SQLite rows. The format is simple (header + bitsets + varint lists), not a
   premature abstraction.

---

## 9. Priority Order

| # | Phase | Effort | Impact | Depends On |
|---|-------|--------|--------|------------|
| 1 | Fix silent truncation (Phase 1) | 0.5 day | CRITICAL (correctness) | Nothing |
| 2 | Restrict to indexed corpus + overlay (Phase 2) | 1 day | HIGH | Nothing |
| 3 | Add telemetry for grep component timing | 0.25 day | HIGH (data) | Nothing |
| 4 | Regex literal extraction fast path (Phase 3) | 1-2 days | MEDIUM | Phase 2 |
| 5 | Sparse gram index with hybrid postings + SIMD (Phase 4) | 3-5 days | HIGH (at scale) | Phase 3, native crate |
| 5a | AST metadata on gram postings (Phase 4.1) | +0.5 day | MEDIUM (agent UX) | Phase 4 |
| 6 | Bare grep mode (Phase 5) | 0.5-1 day | MEDIUM (new use cases) | Phase 1-3 |

Items 1-3 should ship immediately. Phase 3 is the sweet spot of effort vs impact.
Phase 4 lives in the existing `@sweet-search/native-<platform>` Rust crate alongside
MaxSim — no new package, same per-platform binary packaging from INIT_STRATEGY.md.
Phase 4.1 (AST metadata) is a follow-up that enables symbol-type filtering in bare grep
and composes with the agent mode context packaging from USEFUL_ANSWER_COLGREP_PLAN.md.
Phase 5 can ship any time after Phase 3 — it's mostly wiring the candidate generation
pipeline into a standalone API and CLI.

---

## 10. Measurement

Each phase should be validated with Track C component profiling on at least two repos:
- A small well-named repo (~500 files) — baseline where ripgrep is already fast
- A large repo (~10K+ files) — where improvements should be measurable

Key metrics per phase:
- **Phase 1**: Number of queries where truncation was triggered (should drop to 0)
- **Phase 2**: Ripgrep scan time reduction (ms), files scanned vs files skipped
- **Phase 3**: Literal extraction hit rate (% of queries with extractable literals),
  candidate reduction ratio (files before/after literal filter)
- **Phase 4**: Gram index lookup time, posting list intersection time, false positive
  rate (candidates that pass gram filter but fail regex)
- **Phase 5**: Bare grep latency vs raw ripgrep (end-to-end), throughput (queries/sec),
  completeness (bare grep matches == ripgrep matches on same corpus)

Add these to the `patternStats` object returned by `patternSearch()` (and the new
`bareGrep()` stats object) so they flow into `eval/run_pattern_benchmark.js` Track C
reporting automatically.

---

## 11. References

| Source | Relevance |
|--------|-----------|
| [Cursor: Fast Regex Search](https://cursor.com/blog/fast-regex-search) (2026) | Trigram + sparse gram architecture for agent tools |
| [Russ Cox: Regex Matching with a Trigram Index](https://swtch.com/~rsc/regexp/regexp4.html) (2012) | Foundational trigram-to-regex compilation |
| [GitHub: Technology Behind Code Search](https://github.blog/engineering/the-technology-behind-githubs-new-code-search/) (2023) | Sparse grams, phrase masks, scale architecture |
| [Zoekt](https://github.com/sourcegraph/zoekt) | Positional trigrams, shard format, ctags ranking |
| [Moderne Trigrep](https://www.moderne.ai/blog/from-grep-to-moderne-trigrep-code-search-for-agents) (2026) | Zoekt-compatible trigram index + LST symbol awareness; "13.5x" is token efficiency for agents, not raw grep speed |
| [sparse_ngrams](https://github.com/danlark1/sparse_ngrams) | C++ reference for sparse gram extraction |
| [ripgrep RFC #1497](https://github.com/BurntSushi/ripgrep/issues/1497) | BurntSushi's design for indexed ripgrep |
| [fastgrep](https://github.com/awnion/fastgrep) | Lazy trigram index, mtime invalidation |
| [fff/fastgrep](https://dev.to/dmtrkovalenko/benchmark-oriented-development-is-a-road-to-nowhere-1518) (2026) | Bigram hybrid column storage (dense bitset + sparse list), SIMD extraction |
| [danieldk bigram gist](https://gist.github.com/danieldk/00a2dd05c8a012b7b049a25f23e23062) | Character-level bigram frequencies across programming languages |
| [regex-syntax crate](https://docs.rs/regex-syntax) | Rust regex AST parser by BurntSushi — used for literal extraction (§6.4) |
| [HN: GitHub engineer on sparse grams](https://news.ycombinator.com/item?id=34682472) (2023) | Confirms follow masks abandoned, covering sparse grams used instead |
| [Zhang et al.: N-Gram Selection Strategies for Regex Indexing](https://arxiv.org/abs/2504.12251) (2025) | CMU/Microsoft evaluation of FREE/BEST/LPMS — validates frequency-based selection for code search |
| [Lemire et al.: Faster Positional-Population Counts](https://arxiv.org/abs/2412.16370) (2024) | AVX2/AVX-512/ASIMD pospopcnt — directly applicable to dense×dense intersection |
| [Lemire & Boytsov: SIMD Compression and Intersection of Sorted Integers](https://arxiv.org/abs/1401.6399) (2014) | Foundational SIMD integer list intersection (SIMD-BP128) |
| [Schmidbauer: Faster-Than-Native VP2INTERSECT Alternatives](https://arxiv.org/abs/2112.06342) (2022) | AVX512F outperforms native VP2INTERSECT for set intersection |
| [Lemire et al.: Roaring Bitmaps](https://arxiv.org/abs/1709.07821) (2017) | Compressed bitmap library — considered and rejected for this use case (see §6.3) |
| [Iakovlev et al.: Trigram-Based Persistent IDE Indices](https://arxiv.org/abs/2403.03751) (2024) | ITMO/Huawei — delta-based persistent trigram index across git revisions |
| [Vigna: Quasi-Succinct Indices](https://arxiv.org/abs/1206.4300) (2012) | Elias-Fano encoding for sparse posting lists — potential alternative to delta+varint |
| COLGREP_PLAN.md | Parent plan for pattern mode (semantic ranking side) |
| USEFUL_ANSWER_COLGREP_PLAN.md | Agent context packaging — composes with Phase 4.1/5 |
| INIT_STRATEGY.md | Native binary packaging model for `@sweet-search/native-<platform>` |
