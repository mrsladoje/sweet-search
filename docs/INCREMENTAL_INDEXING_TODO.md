# Incremental Indexing TODO

> Status: **Incomplete — needs exploration and architectural planning**

## Problem

All search indices (lexical, embeddings, late interaction, graph) currently require
a full rebuild when files change. Users editing files after indexing see **stale
results with no warning** until they re-index. The "dirty overlay" described in
INDEXED_GREP.md Phase 2 was designed but never implemented.

## Scope

Incremental indexing must cover **every search modus**, not just the grep engine:

### 1. Lexical (Sparse Gram Index)

- Detect files modified since last index build (mtime comparison)
- Remove stale file entries from the gram posting lists
- Append new/modified file grams without full rebuild
- Handle deleted files (remove from file table + clear posting bits)

### 2. Embeddings (Vector Index)

- Track which chunks correspond to which source file + line ranges
- When a file changes: invalidate affected chunks, re-embed, upsert vectors
- Handle chunk boundary shifts (file edits that move line numbers)
- Consider partial re-embedding (only changed hunks, not full file)

### 3. Late Interaction (ColBERT-style Token Index)

- Same chunk-tracking problem as embeddings, but token-level
- LI documents map to file:startLine:endLine — all three can shift
- Must invalidate and re-encode affected documents
- Streaming index load must handle mixed fresh/stale documents

### 4. Graph (Entity/Relationship Index)

- Entities and relationships extracted from source files
- File changes can add/remove/rename entities
- Cross-file relationships must be re-evaluated
- Graph consistency requires transactional updates

## Initial State / Cold Start

Incremental update assumes a prior index exists to diff against. Several boundary
cases break that assumption and must be handled explicitly:

- **No prior index**: first run on a project that has never been indexed — must
  fall through to a full build, not crash looking for a baseline manifest.
- **Empty codebase**: user runs `sweet-search index` in a directory with zero
  matching source files (e.g. brand-new repo, or one fully covered by excludes).
  All index artifacts must still be created in a well-formed *empty* state so
  subsequent searches return "no results" instead of failing to open the index.
- **Empty → non-empty transition**: the common flow where a user indexes an
  empty project, then adds files and re-runs. The change detection layer must
  treat "baseline = empty, current = N files" as N additions, not as a no-op.
- **Non-empty → empty transition**: all source files deleted between runs. The
  index must drop to an empty-but-valid state, not leave stale postings behind.
- **Corrupt or partial prior index**: previous run crashed mid-build. Detect
  and fall back to a full rebuild rather than incremental-patching garbage.

## Existing Logic

There is some old index maintenance logic in the codebase (tracker-based dirty
file detection), but it predates the current native Rust index architecture and
does not integrate with any of the current index formats. It should be evaluated
for reusable ideas but not assumed to be correct or complete.

## Key Design Questions (Unresolved)

1. **Change detection**: mtime vs content hash vs git diff? mtime is fast but
   unreliable across filesystems. Git diff is precise but requires a git repo.
2. **Granularity**: file-level vs chunk-level invalidation? Chunk-level is more
   precise but requires maintaining a chunk-to-file mapping that survives edits.
3. **Atomicity**: how to handle concurrent index reads during incremental update?
   Copy-on-write? WAL? Double-buffering?
4. **Consistency**: how to ensure all indices (gram, vector, LI, graph) are
   consistent with each other after partial updates?
5. **Performance budget**: incremental update must be fast enough to run on save
   or at least on search (lazy rebuild). Full rebuild of gram index takes ~2s for
   500 files — incremental should be <100ms for single-file changes.

## Next Steps

- [ ] Define and test cold-start / empty-codebase semantics for every index type
- [ ] Audit existing tracker/dirty-file logic for reusable patterns
- [ ] Design a unified change detection layer shared by all index types
- [ ] Prototype mtime-based dirty overlay for the sparse gram index (simplest case)
- [ ] Define consistency model for cross-index updates
- [ ] Benchmark incremental vs full rebuild cost to set the performance target
