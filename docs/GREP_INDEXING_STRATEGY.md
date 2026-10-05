# Grep Indexing Strategy

How `ss-grep` works: the sparse n-gram index, the native Rust engine, the daemon path an agent's
call takes, and how the output is ranked and shaped. Updated 2026-10-05.

---

## Performance

### End to end, as an agent calls it (2026-10-04)

Each call is timed from process start until all output is read from a pipe, for `ss-grep` and
for `rg -n` with the same intent. 7 interleaved repetitions per query; the median counts.

- **Queries:** 1,600, drawn from each repo's own text. The mix of query shapes (scoped, glob,
  `-i`, `-C`, flood, zero-hit, ...) follows 19,762 real agent greps.
- **Repos:** 13, pinned to fixed commits: gin, flask, ripgrep, fastify, vue, tokio, redis,
  rails, django, react, go, kubernetes, rust (130 to 63,416 files).
- **Split:** stratified by repo and query class, 60% dev / 40% held-out, seed 42. The tables
  below are held-out (638 queries).
- **Setup:** Apple M3 Max, ripgrep 15.1.0, sweet-search `59e72df1`, warm daemon. Median 1-minute
  load 5.8.

**Held-out result: median 2.06x faster than ripgrep** (`ss-grep` 3.59 ms, ripgrep 7.29 ms).
542 wins, 44 losses, 52 ties (5% margin). Dev: 2.01x (3.54 ms vs 7.24 ms).

| Repo size | Queries | Median speedup | `ss-grep` ms | ripgrep ms |
|-----------|---------|----------------|--------------|------------|
| small     | 162     | 2.00x          | 3.04         | 6.18       |
| medium    | 157     | 2.29x          | 3.60         | 7.60       |
| large     | 159     | 2.18x          | 3.46         | 7.48       |
| xlarge    | 160     | 1.76x          | 4.98         | 8.01       |

By query class (held-out; classes with at least 20 queries):

| Class              | Queries | Median speedup |
|--------------------|---------|----------------|
| `-w` word          | 26      | 6.45x          |
| `-F` fixed string  | 25      | 5.28x          |
| path-like          | 26      | 4.48x          |
| flood (very common token) | 26 | 3.28x       |
| multi-token regex  | 71      | 2.29x          |
| `-i`               | 45      | 2.19x          |
| zero hits          | 53      | 2.18x          |
| regex class        | 21      | 2.14x          |
| `-g` glob          | 134     | 2.13x          |
| `--in` scope       | 172     | 1.11x          |
| `-C` context       | 31      | 1.04x          |

**Why about 2x and not more:** both tools pay a process start, and `ss-grep` also pays one round
trip to the daemon. The search itself is about 1 ms, so these fixed costs set the floor on small
repos. Scoped and context greps read few files, where ripgrep is fast too.

**Hit counts:** on the same file list, `ss-grep` and ripgrep report the same hit count for 1,583
of 1,600 queries. The 17 differences come from the check: its file list missed files changed
after the index build, and ripgrep searches some binary files that the index skips.

### In-process engine (2026-04-07, historical)

This earlier benchmark timed the engine inside the process (about 1 ms per query) against a
spawned `rg --json` whose output was parsed in JavaScript. It leaves out the process start and
the daemon round trip that an agent pays for `ss-grep`, so its 10.2x is **not** an end-to-end
speedup. 353 queries across 5 repos:

| Repo         | Files | p50 speedup vs rg | p50 latency |
|--------------|-------|-------------------|-------------|
| sweet-search | 558   | 17.7x             | 1 ms        |
| fastify      | 356   | 11.5x             | 1 ms        |
| flask        | 216   | 9.1x              | 1 ms        |
| ripgrep      | 215   | 9.7x              | 1 ms        |
| gin          | 118   | 8.5x              | 1 ms        |
| **ALL**      | —     | **10.2x**         | 1 ms        |

---

## Architecture

The engine uses a sparse n-gram index to skip files that cannot match the regex, then verifies
the candidates with native Rust regex. The pipeline:

```
regex string
    |
    v
Literal extraction (Rust: regex-syntax crate)
  -> required literal substrings, as an OR of AND clauses
  -> e.g., /class\s+Auth\w+Service/ -> AND("class", "Auth", "Service")
    |
    v
Sparse gram lookup (Rust: mmap'd binary index + delta overlay)
  -> cover each literal with sparse n-grams from the per-codebase weight table
  -> intersect posting lists -> candidate files (typically 0.1-5% of the corpus)
    |
    v
Native grep verification (Rust: regex crate + rayon)
  -> run the full regex on the candidate files only
  -> return file/line/column/matchText/content, packed for the trip to JavaScript
```

When the grams cannot narrow (no extractable literal, or every file is a candidate), native grep
runs on all indexed files.

### The call path

1. **`ss-grep` binary:** a thin native Rust client (`crates/sweet-search-cli`). It sends the call
   over a Unix socket to the project's daemon (`/agent-tool`), and starts the daemon if no socket
   answers. Without a daemon it runs the tool in-process.
2. **Daemon:** a long-lived Node process (`core/search/search-server.js`). It keeps the index
   loaded, runs the query planner (`core/search/search-pattern-planner.js`), and calls its own
   search handler directly, without a second socket round trip.
3. **Native addon:** gram lookup, intersection and grep run in one NAPI call where possible.
   Matches come back as typed arrays plus two strings, not one object per match.

### Query routes

| Route               | When used | What runs |
|---------------------|-----------|-----------|
| `unified_gram_grep` | No delta overlay, no `--in` scope, no fixed-string or glob option; the grams narrow | One NAPI call: gram lookup, then native grep on candidates |
| `unified_grep_all`  | Same, but the grams do not narrow | One NAPI call: native grep on every indexed file |
| planner routes      | A delta overlay or an `--in` scope is present | Gram candidates from base + overlay, filtered by scope; native grep on what is left |

`unified_*` are planner labels for one NAPI call, the unified search (`search_full_packed`, or
`search_lines` for line-only callers). A scope holding at most 512 indexed files is grepped
whole, without a gram lookup. When the grams prove that no file can match, the planner skips the
grep. ripgrep runs only as a fallback, when the native addon cannot serve a call (or for library
callers that pass fixed-string or glob options to the planner; `ss-grep` turns `-F` into an
escaped regex and applies `-g` globs after the engine).

### What the index covers

The grep corpus is what `rg` would search: in a git worktree, every tracked file plus every
untracked file that is not ignored (`git ls-files --cached --others --exclude-standard`); without
git, every file under the root except dependency and cache directories. Embedding-indexed files
are always included. Still excluded: sweet-search's own state, secret and env-file patterns,
`.sweet-search-ignore`, symlinks, empty files, files over 10 MB, and minified bundles. Binary
files are dropped by the native builder (not valid UTF-8) and by native grep (a NUL byte in the
first 8 KiB). See `core/indexing/grep-corpus.js`.

### Freshness: the delta overlay

Edits after the index build reach the grep through delta segments in
`codebase-sparse-grams.idx.deltas/` (`{epoch}-{seq}.ssgrmdelta`), written by the incremental
reconciler and overlaid on the base index at query time. The daemon reads only bytes appended
since its last read, and does not reopen a segment whose file status is unchanged.

On zero hits, `ss-grep` also greps git's modified and untracked files, which the index may not
yet hold. The daemon keeps that list current from file events, so a true zero stays fast.

---

## Key Design Decisions

### Sparse n-grams (not plain trigrams or bigrams)

Plain trigrams (`for`, `int`, `var`) appear in nearly every file, producing huge posting lists.
Sparse n-grams use per-codebase character-pair weights to cut variable-length grams (3 to 12
bytes) whose boundaries fall at rare bigrams. Common trigrams get absorbed into longer, more
selective grams (`format`, `interface`, `variable`).

The weight table is built at index time in one byte scan counting `counts[prev][next]`. Weights
are inverse frequency, `ln((total + 16384) / (count + 1))`: common bigrams (`fo`, `or`, `in`) get
low weight, rare ones (`t_`, `zz`, `q(`) high weight. A span is a gram when both its boundary
bigrams outweigh every interior bigram. A corpus with fewer than 4,096 bigrams uses a built-in
table of common code bigrams instead.

The algorithm follows GitHub Blackbird and Cursor's fast regex search. Zhang et al. 2025 ("An
Evaluation of N-Gram Selection Strategies for Regular Expression Indexing", CMU/Microsoft) found
frequency-based selection (their "FREE" strategy) best for large, diverse code workloads.

### Why not other approaches

- **Plain trigrams** (Zoekt/livegrep): Poor selectivity on code — `for`, `int`, `var` appear in
  nearly every file. Sparse n-grams subsume this.
- **Plain bigrams** (fff/fastgrep): 4,761 case-insensitive ASCII bigrams with bounded key space.
  Simpler but lower selectivity than sparse n-grams on large repos (>200K files). fff's hybrid
  posting format informed our design (see below).
- **Suffix arrays** (livegrep): Can't do incremental updates. Requires concatenating the entire
  corpus into one string. Wrong for local, evolving codebases.
- **FTS5 trigram on source text**: The `entities_trigram` table only indexes entity names.
  Extending it to full source is impractical — SQLite's trigram tokenizer is a substring/LIKE
  accelerator, not a regex engine.
- **Roaring bitmaps** (Lemire et al. 2017): Mature compressed bitmap library, but container
  dispatch overhead per operation exceeds our simple dense flag. The custom flat mmap'd format
  guarantees zero-copy access.
- **Elias-Fano encoding** (Vigna 2012): More space-efficient than delta+varint for very sparse,
  high-gap posting lists, with O(1) random access. Not needed so far.

### Regex literal extraction

The `regex-syntax` Rust crate (by the author of ripgrep) gives a complete HIR (high-level IR) for
any regex. The walk in `regex_literals.rs` maps it to an OR of AND clauses of required substrings:

- **Concatenation** -> AND (all literals required)
- **Alternation** -> OR (any literal sufficient); if one branch has no literal, the whole
  alternation gives no clause
- **Character classes** (`\s`, `\w`, `[a-z]`) -> no literal; a concatenation keeps the literals
  around them
- **Repetition** (`*`, `+`, `?`, `{n}`) -> no literal (the child is not used)
- **Groups** -> transparent (recurse into the child)
- **Anchors, look-around** -> skip (no effect on literals)

Extraction is capped at 64 clauses and 4,096 regex characters. When it yields nothing (e.g.,
`.*`, `[a-z]+`, `\d{3}-\d{4}`), native grep runs on all indexed files. Case-insensitive searches
pass a case flag to the gram query and to the grep; the extractor itself does not fold case. No
false negatives either way.

This is a well-studied technique: Russ Cox's `codesearch` (2012), Go's `regexp/syntax`, and
ripgrep's own `grep-regex` crate all implement variants.

### Hybrid posting storage

Each gram's posting list uses one of two representations, chosen at build time:

- **Dense bitset**: one bit per file, intersected with bitwise AND (SIMD: NEON, SSE2, AVX2).
- **Sparse posting list**: sorted file IDs, delta+varint encoded. Intersected with merge or
  galloping search.

A list is dense when `popcount * 4 bytes >= ceil(file_count / 64) * 8 bytes`, fff's adaptive
rule (~3.1% of files for large corpora).

| Left    | Right   | Algorithm                              |
|---------|---------|----------------------------------------|
| Dense   | Dense   | Bitwise AND (SIMD)                     |
| Dense   | Sparse  | Iterate sparse, probe bit in dense     |
| Sparse  | Sparse  | Galloping, SIMD 4-wide block merge, or scalar merge |

Sparse-sparse dispatch (`simd_intersect.rs`):
- **Galloping search** when one side is >=8x smaller — O(n log m) beats O(n+m) for skewed
  intersections (Lemire & Boytsov 2014).
- **SIMD 4-wide block merge** otherwise, when the smaller list has at least 16 elements.
  aarch64: NEON `vceqq_u32` + `vextq_u32` rotations for an exhaustive 4x4 comparison.
  x86_64: SSE2 `_mm_cmpeq_epi32` + `_mm_shuffle_epi32` rotations + `_mm_movemask_ps`
  (Schmidbauer 2022).
- **Scalar merge** for smaller inputs and unsupported platforms.

### Native Rust grep (not a ripgrep subprocess)

Verification uses Rust's `regex` crate with rayon, not a ripgrep subprocess: no fork/exec, pipe
I/O or JSON serialization. The fixed-text prefilter (`native_grep_files_with_matches_fixed`)
uses `memchr::memmem` (ASCII-lowercased bytes for case-insensitive text) with rayon, no regex.
Compiled regexes are cached in the addon.

The daemon keeps file bytes between greps (`grep_file_cache.rs`): a file is served again while a
fresh stat shows the same device, inode, size, mode, mtime and ctime. Files changed in the last
2 seconds are never kept (git's "racily clean" rule). The cache stops taking files at its cap
(64 MB, `SWEET_SEARCH_GREP_CACHE_MB`, 0 = off) instead of evicting. On macOS an open costs
~11 µs and a stat ~2 µs.

### Combined gram+grep NAPI call

The unified search runs gram lookup and regex verification in one NAPI call. Candidate file
IDs never cross the Rust/JS boundary — paths come from the internal file table and are grepped
directly in Rust. The single-clause path (the common case) passes a `Vec<u32>` straight from the
gram query to the grep; multi-clause OR unions use a HashSet for dedup.

### Correctness invariant

The prefilter must never produce false negatives:

- Same matching-file set as raw ripgrep over the indexed corpus
- Same line matches as raw ripgrep over the same file set
- False positives before verification are acceptable; false negatives are not

---

## Agent output (`ss-grep`)

Flags: `-i`, `-w`, `-F`, `--in <path>` (repeatable), `-g '<glob>'` / `-g '!<glob>'` (also
`--include`, `--exclude`, `--exclude-dir`), `-k N` (default 20 hit lines), `-A/-B/-C N`.

**Shape.** Hits are grouped by file: the path once, then `LINE:text` rows, like `rg --heading`.
There is no header and no legend. A hit line prints whole, whitespace-collapsed, up to 140
characters; when a grep has 50 or more matches, each line shows an 80-character window around the
match. Every hidden hit is counted: `(+N more)` after a file's last shown hit,
`# +N more files with M hits: ...` for files that did not fit, and one
`# hidden hits: raise -k or use --in <file>` line when anything is hidden.

**Ranking** (`core/search/grep-output-shaping.js`, `grep-allocation-rules.js`). When the hits do
not all fit in `-k` lines:
1. Each file gets a weight, `hits / (hits + 2) x prior`. The prior is 1 for source, 0.5 for
   tests, specs and fixtures, and 0.25 for generated, vendored and minified files. Package
   lockfiles and files whose hit lines are all hash or base64 blobs count as generated.
2. The highest-weight files are kept and printed in weight order.
3. Each kept file gets one line before any file gets a second; the remaining lines are shared by
   the Sainte-Laguë method.
4. Inside a file, lines that declare a symbol come first, and each enclosing symbol gets one line
   before any symbol gets a second.
5. A file with the same name and the same hit text as an earlier one (line numbers aside) prints
   as one line that names the original and its own hit lines.

We replayed 1,036 real agent grep calls with known answers through the engine, with steps 1-4 as
shipped on 2026-10-03. On the 154 calls whose hits overflowed, the answer file was shown in 88%
of calls (alphabetical order: 82%), and the line that declares the answer in 64% (alphabetical
order: 34%).

**Help for the next step.** A regex that does not parse is repaired once (only the broken
alternatives are escaped), and a zero-hit search is retried once case-insensitively; both are
announced in one line. A grep with 8 or fewer hits names the implementing class when a hit line,
or one of the 3 lines below it, calls through an interface. A grep with 1-3 hits, all in one file,
gets one `# siblings:` line: the declarations in that file that share name parts with the
enclosing symbols, plus the fields their bodies use.

**Tokens.** Path once per file, no header and no legend cut the output by a third (5,978 ->
3,995 tokens on 20 real agent calls), with no hit, line number or count lost.

---

## Index Files

In `.sweet-search/`:

| File                                   | Contents                                        |
|----------------------------------------|-------------------------------------------------|
| `codebase-sparse-grams.idx`            | Sparse gram index, memory-mapped at load time   |
| `codebase-sparse-grams.idx.deltas/`    | Delta segments for files changed since the build |

The index file starts with a header (magic `SSGRMIDX`, version 2, flags, counts and section
offsets). Its sections are the file table (path and per-file symbol mask), the sorted gram table
(binary search), dense bitset blocks, sparse varint posting lists, and the 128x128 f32 bigram
weight table (64 KB).

---

## Optimization History

### April 2026: the in-process engine (steps 1-10)

#### Step 1: Loosen bailout gates

Raised thresholds so the gram index is trusted for broader queries (`maxGramCandidateFiles`
512->2048, `maxGramCandidateRatio` 5%->30%, etc.). Today these gates are fully open (100,000
files, ratio 1.0); the 2,048-file / 40% limits now apply only to the literal prefilter.

#### Step 2: Native grep for bareGrep

Added the `native_grep_full` Rust NAPI function returning structured match results.
**Impact: p50 speedup 1.3x -> ~10x (in-process).**

#### Step 3: Zero-copy posting list reads

`bitand_dense_from_le_bytes` and `filter_sparse_with_dense_bytes` read dense posting bitmaps
directly from mmap'd byte slices, avoiding `Vec<u64>` allocation.

#### Step 4: All-in-one gram query + native grep

`query_and_grep_full` combined gram lookup, extension filtering, threshold checks and regex
verification in one NAPI call. Candidate file paths never cross the boundary. The unified search
(`search_full`, `search_lines`, later `search_full_packed`) grew out of it and is what the planner
calls today.

#### Step 5: Allocation-free `extract_covering_grams`

Thread-local `CoveringScratch` with reusable buffers. The return type changed from `Vec<String>`
to `Vec<&str>` — zero-copy slices into the input span.

#### Step 6: Sorted binary search gram table

Replaced `HashMap<String, GramDescriptor>` with `SortedGramTable` — struct-of-arrays with
O(log n) binary search. **Impact: p50 speedup ~6.4x -> ~9.9x (in-process)** on large gram tables
(128K+ grams).

#### Step 7: SIMD sparse-sparse posting intersection

Galloping search, SIMD 4-wide block merge (NEON, SSE2), and scalar merge, as described above.

#### Step 8: Aho-Corasick literal fast path — SKIPPED

Rust's `regex` crate already optimizes pure literals to `memchr`. Not worth the complexity.

#### Step 9: Per-stage timing instrumentation

`performance.now()` and Rust `Instant` checkpoints at each stage boundary. Found the literal
prefilter (an `rg -F` spawn) as the main loss, at 12-35 ms p50.

#### Step 10: Remove the literal prefilter spawn + native grep on all files

- **10A**: `native_grep_files_with_matches_fixed` — fixed-text AND-match with rayon, no regex.
- **10B**: `unified_grep_all` — when grams can't narrow, native grep on all indexed files instead
  of spawning rg. **Impact: gin 1.1x -> 4.4x, overall 334W/19L -> 353W/0L (in-process).**

### October 2026: the end-to-end path

Every step below kept the printed answer byte for byte (checked on frozen indexes against the
previous commit).

- **Grep corpus = what rg searches** (`d013b492`): every git-visible file, not only code
  extensions, so `vendor/`, READMEs, Makefiles and configs are greppable. Grams that prove
  absence answer without a grep.
- **Faster engine round trip** (`398200a2`): matches cross into JavaScript packed (typed arrays +
  two strings); the engine stores at most a per-file cap of matches and counts the rest; the
  file-byte cache; the delta overlay reads only new bytes (a 48 MB delta was parsed 2-3x per
  call, ~3.4 s; now ~0.2 ms warm).
- **Lower fixed costs** (`0c38b3ed`): the zero-hit fallback uses a changed-files list kept
  current from file events (a full `git ls-files` cost 0.1-0.5 s per zero-hit grep);
  extensionless files are gram-narrowed; compiled regexes are cached; the client no longer probes
  the socket before a call.
- **No socket round trip inside the daemon** (`7de25310`): the agent tool calls the daemon's
  search handler directly.
- **Scoped greps** (72% of 4,552 native agent greps are scoped; 27% name one file):
  - `4f95cfc1`: the `--in` scope reaches the engine, so only in-scope candidates are read.
    kubernetes `'Initial' --in CHANGELOG`: 710 ms -> ~30-45 ms.
  - `4b7c9f38`: a scope of at most 512 indexed files is grepped whole. kubernetes one-file
    scope: ~34 ms -> ~5-7 ms.
  - `59e72df1`: a root-anchored scope finds its files by path prefix in a sorted list.
  - `4c27d7d5`: the scope test rejects by substring first (30k kubernetes paths: 14.6 -> 2.6 ms).

---

## Known slow cases and open work

- **Scoped (`--in`) and context (`-C`) greps** are only ~1.1x faster end to end: they read few
  files, and the fixed costs dominate.
- **A regex with no fixed text** (e.g. `\w+\d`) cannot use the index and scans every indexed file.
- **The planner is still JavaScript.** Moving literal extraction, gram lookup, intersection and
  verification behind one Rust call would remove the remaining JS planning time per call.

---

## Benchmarking

The end-to-end harness (2026-10) and its raw results are kept outside this repository. Its method
is the one described under Performance.

The in-process benchmark (2026-04) is in the repo: `eval/scripts/grep-latency-bench.js`, with 353
queries across 5 repos in `eval/data/grep-bench/`.

```bash
# Speed + accuracy, in-process
node eval/scripts/grep-latency-bench.js --validate --verbose

# Specific repos
node eval/scripts/grep-latency-bench.js --repos=gin,flask

# Pattern benchmark (includes ColGrep ranking metrics)
node eval/run_pattern_benchmark.js --concurrency=12
```

It reports p50/p95/avg/min/max per repo and per regex family, match-count parity with ripgrep
(`--validate`), per-stage timing, and the route each query took.

---

## References

### Architecture and algorithms

| Source | What we used from it |
|--------|----------------------|
| [GitHub: Technology Behind Code Search](https://github.blog/engineering/the-technology-behind-githubs-new-code-search/) (2023) | Sparse n-gram algorithm, covering gram query strategy |
| [Cursor: Fast Regex Search](https://cursor.com/blog/fast-regex-search) (2026) | Indexed base + fresh overlay architecture, sparse gram visualization |
| [Russ Cox: Regex Matching with a Trigram Index](https://swtch.com/~rsc/regexp/regexp4.html) (2012) | Foundational trigram-to-regex literal extraction technique |
| [sparse_ngrams](https://github.com/danlark1/sparse_ngrams) (Boost License 1.0) | C++ reference for sparse gram extraction and weight tables |
| [fff/fastgrep](https://dev.to/dmtrkovalenko/benchmark-oriented-development-is-a-road-to-nowhere-1518) (2026) | Hybrid dense/sparse posting storage, adaptive density threshold formula |
| [danieldk bigram gist](https://gist.github.com/danieldk/00a2dd05c8a012b7b049a25f23e23062) | Character bigram frequencies across programming languages (background for the weights) |
| [regex-syntax crate](https://docs.rs/regex-syntax) | Rust regex HIR parser for literal extraction (by the ripgrep author) |
| [HN: GitHub engineer on sparse grams](https://news.ycombinator.com/item?id=34682472) (2023) | Confirms follow masks abandoned, covering sparse grams used instead |
| [Webster/Sainte-Laguë method](https://en.wikipedia.org/wiki/Webster/Sainte-Lagu%C3%AB_method) | Proportional sharing of output lines across files |

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
| [Elias-Fano encoding](https://arxiv.org/abs/1206.4300) (Vigna 2012) | More space-efficient for high-gap sparse lists; not needed so far |
| [Iakovlev et al. 2024](https://arxiv.org/abs/2403.03751) | Delta-based persistent trigram index across git revisions (ITMO/Huawei) — our delta overlay is simpler |
| [Zoekt](https://github.com/sourcegraph/zoekt) | Positional trigrams + shard format — sparse n-grams supersede plain trigrams |
| [Moderne Trigrep](https://www.moderne.ai/blog/from-grep-to-moderne-trigrep-code-search-for-agents) (2026) | Zoekt-compatible + LST symbol awareness — we get the equivalent from tree-sitter chunker metadata |
