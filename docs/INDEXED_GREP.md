# Indexed Grep: Sub-Linear Regex Search for Pattern Mode

**Status**: Planning
**Priority**: HIGH (correctness fixes), MEDIUM (scope restriction), LOW (trigram index)
**Prerequisites**: Pattern mode MVP (done), late interaction index (done)
**References**: COLGREP_PLAN.md, Cursor "Fast Regex Search" blog (2026-03-23)
**Motivation**: On the warm server path, `encodeQuery()` is ~6ms (model preheated at
startup). Ripgrep at 21-26ms is the latency floor. At enterprise scale (>1GB repos),
ripgrep grows to seconds. This plan makes Stage A sub-linear.

---

## 1. Problem Statement

Pattern search currently runs ripgrep against the entire project root on every query
(`search-pattern.js:329`). This has three problems:

1. **Silent truncation**: `maxMatches=1000` hard cap (`search-pattern.js:64-65`) kills
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
**Files**: `core/search-pattern.js` (modify `runRipgrep`, `patternSearch`)

---

## 4. Phase 2: Restrict Search to Indexed Corpus + Dirty Overlay

**Problem**: `patternSearch()` always searches `PROJECT_ROOT` (`search-pattern.js:329`).
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

These matches go into the "unindexed" bucket (existing lazy fallback, `search-pattern.js`
already handles this). But now they're explicitly identified rather than mixed in with
indexed matches.

Detection should reuse the existing incremental tracker instead of Git state:
- Load the tracker state (`lastIndex`, stored `size`/`mtime_ns`)
- Compare current filesystem metadata against stored entries
- Files whose metadata changed since `lastIndex` go to the dirty overlay
- Files absent from tracker state are treated as untracked/unindexed

This works outside Git, and it correctly answers "changed since last index" instead of
"different from HEAD."

### 4.3 Expected latency improvement

| Scenario | Current (full scan) | Phase 2 (indexed + overlay) |
|----------|--------------------|-----------------------------|
| 5K indexed files in 50K-file repo | ~25ms | ~5ms |
| 10K indexed files in 200K-file monorepo | ~500ms+ | ~15ms |
| Indexed files only, no dirty | Same | Same (no overlay cost) |

**Effort**: 1 day
**Files**: `core/search-pattern.js` (modify `runRipgrep`, `patternSearch`),
           `core/indexer-ann.js` (expose indexed file list)

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
rg --files-with-matches -F "Auth" fileA.ts fileB.ts ... | \
  xargs rg --files-with-matches -F "Service" | \
  xargs rg --json "class\s+Auth\w+Service"
```

Downsides: multiple spawns, pipe overhead, and `xargs` portability concerns. In the
actual implementation we should do the same thing inside Node with batched `rg -F -l`
invocations rather than shell pipelines. The important part is that ripgrep still does
the literal prefiltering and the final regex verification.

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

**Effort**: 1-2 days
**Files**: `core/search-pattern.js` (new `extractLiterals()` function, modified search
path)

---

## 6. Phase 4: Sparse Gram Index (Enterprise Scale)

**When to build this**: Only after Phase 3 is shipped and profiling shows that literal
extraction still isn't enough — typically when indexed corpus exceeds ~50K chunks or
agent workflows trigger >5 concurrent pattern searches.

**Why not plain trigrams**: Plain trigrams (3-character subsequences) have a selectivity
problem on code. `for`, `int`, `var`, `the`, `ret`, `urn`, `fun` appear in nearly every
file. The posting lists for these trigrams are huge, so intersecting them barely reduces
candidates.

### 6.1 Sparse N-grams (GitHub Blackbird / ClickHouse approach)

Assign a deterministic weight to each character bigram based on frequency in a large code
corpus. Extract variable-length n-grams where the boundary bigram weights exceed all
interior bigram weights.

**Effect**: Common trigrams like `for` have low-weight boundaries and get absorbed into
longer grams like `for_each` or `format`. Rare trigrams like `zig` keep their short form.
Result: fewer grams, much more selective posting lists.

**Character-pair weight table**: Pre-computed from a large open-source corpus (GitHub's
used terabytes of code). Can also be built from the user's own codebase at index time.

### 6.2 Phrase-Aware Masks (GitHub Blackbird "3.5-grams")

Each posting entry stores two 8-bit masks alongside the document ID:

```
posting entry: [docId: uint32, locMask: uint8, nextMask: uint8]
                                  │                    │
                  position mod 8 ─┘     bloom(next char)─┘
```

- **locMask**: Bitset of (offset mod 8) positions where the trigram appears. Enables
  checking that two trigrams appear at compatible distances.
- **nextMask**: Bloom filter of the character following the trigram. Effectively gives
  quadgram-level selectivity without storing quadgrams.

**Space overhead**: 2 bytes per posting vs 4 bytes for docId alone = 50% more space, but
dramatically fewer candidate documents pass the filter.

### 6.3 Index structure

```
┌─────────────────────────────┐
│ Sparse Gram Lookup Table    │  Memory-mapped, hash → offset
│ (sorted by gram hash)       │  Binary search for lookup
├─────────────────────────────┤
│ Posting Lists               │  Sequential on disk
│ [docId, locMask, nextMask]  │  Delta-encoded docIds
│ per sparse gram             │  Read at offset from lookup
└─────────────────────────────┘
```

Built during indexing alongside the LI index. Stored as a compact binary file
(e.g., `.sweet-search/sparse-grams.idx`). Memory-mapped at load time.

### 6.4 Query pipeline with sparse gram index

```
regex "class\s+Auth\w+Service"
  │
  ▼
Extract sparse grams from required literals: ["cla","las","las","Aut","uth","Ser","erv","rvi","vic","ice"]
  │
  ▼
Look up posting lists, intersect with phrase masks
  │
  ▼
Candidate files (typically 0.1-5% of corpus)
  │
  ▼
Run full regex on candidates only
  │
  ▼
Map to chunks → MaxSim rerank (unchanged)
```

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

**Effort**: 3-5 days
**Files**: New `core/sparse-gram-index.js`, modifications to `core/indexer-ann.js` (build
grams during indexing), `core/search-pattern.js` (use gram index for candidate generation)

---

## 7. What NOT to Build

1. **Suffix arrays** (livegrep). Can't do incremental updates. Requires concatenating
   the entire corpus into one string. Wrong for local, evolving codebases.

2. **Full FTS5 trigram on source text**. The existing `entities_trigram` table in
   `graph-extractor.js:150` only indexes entity names and signatures. Extending it to
   full source text would bloat the SQLite database enormously, and SQLite's trigram
   tokenizer is primarily a substring / `MATCH` / `LIKE` / `GLOB` accelerator, not a
   general regex engine. Wrong tool for pattern-mode verification.

3. **PLAID/SPLATE/WARP for this problem**. Those are about semantic candidate generation
   and multi-vector retrieval. They don't help with "make regex faster." They're listed
   in COLGREP_PLAN.md for the semantic ranking side, which is a separate concern.

4. **Custom binary postings format (premature)**. Use simple flat files or SQLite for
   the sparse gram index until profiling shows the format matters. Cursor's mmap'd
   postings file is optimized for concurrent agent access — evaluate that only after
   seeing bursty workload patterns.

---

## 8. Priority Order

| # | Phase | Effort | Impact | Depends On |
|---|-------|--------|--------|------------|
| 1 | Fix silent truncation (Phase 1) | 0.5 day | CRITICAL (correctness) | Nothing |
| 2 | Restrict to indexed corpus + overlay (Phase 2) | 1 day | HIGH | Nothing |
| 3 | Add telemetry for grep component timing | 0.25 day | HIGH (data) | Nothing |
| 4 | Regex literal extraction fast path (Phase 3) | 1-2 days | MEDIUM | Phase 2 |
| 5 | Sparse gram index (Phase 4) | 3-5 days | HIGH (at scale) | Phase 3, scale evidence |

Items 1-3 should ship immediately. Phase 3 is the sweet spot of effort vs impact.
Phase 4 is triggered by scale evidence or enterprise users.

---

## 9. Measurement

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

Add these to the `patternStats` object returned by `patternSearch()` so they flow into
`eval/run_pattern_benchmark.js` Track C reporting automatically.

---

## 10. References

| Source | Relevance |
|--------|-----------|
| [Cursor: Fast Regex Search](https://cursor.com/blog/fast-regex-search) (2026) | Trigram + sparse gram architecture for agent tools |
| [Russ Cox: Regex Matching with a Trigram Index](https://swtch.com/~rsc/regexp/regexp4.html) (2012) | Foundational trigram-to-regex compilation |
| [GitHub: Technology Behind Code Search](https://github.blog/engineering/the-technology-behind-githubs-new-code-search/) (2023) | Sparse grams, phrase masks, scale architecture |
| [Zoekt](https://github.com/sourcegraph/zoekt) | Positional trigrams, shard format, ctags ranking |
| [Moderne Trigrep](https://www.moderne.ai/blog/from-grep-to-moderne-trigrep-code-search-for-agents) (2026) | 13.5x faster than ripgrep via semantic-tree trigrams |
| [sparse_ngrams](https://github.com/danlark1/sparse_ngrams) | C++ reference for sparse gram extraction |
| [ripgrep RFC #1497](https://github.com/BurntSushi/ripgrep/issues/1497) | BurntSushi's design for indexed ripgrep |
| [fastgrep](https://github.com/awnion/fastgrep) | Lazy trigram index, mtime invalidation |
| COLGREP_PLAN.md | Parent plan for pattern mode (semantic ranking side) |
