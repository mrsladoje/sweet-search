# Incremental Indexing TODO

> Status: **Incomplete — needs exploration and architectural planning**

## Problem

All search indices (lexical, embeddings, late interaction, graph) currently require
a full rebuild when files change. Users editing files after indexing see **stale
results with no warning** until they re-index. The "dirty overlay" described in
INDEXED_GREP.md Phase 2 was designed but never implemented.

## Model Backend for Incremental Runs (decided 2026-04-17)

**Incremental indexing always uses ORT CPU models — never GPU.** Rationale:

- The GPU lifecycle (kill CPU → load native → warmup forward → index → kill
  native → reload CPU → warm CPU) costs 5–15s on M3-class hardware.
- A typical incremental run touches 1–5 files and takes well under 1 second
  on ORT CPU. Paying the GPU round-trip would be a 10–30x regression.
- Queries always use ORT CPU, so the CPU pipelines are already warm from
  `session-warmup.js`. Incremental runs reuse them directly — zero cold-start
  cost for small edits.
- For large incremental changesets (≥20 files, i.e. big refactors or post-pull
  catchup), the current indexer already arms GPU — see
  `indexer-phases.js::shouldArmGpu` and the `GPU_ARMING_MIN_FILES` constant
  in `core/indexing/model-pool.js`. Full reindexes always arm GPU regardless
  of file count.

Implication for the incremental path being designed here: the dirty-overlay
code path inherits the CPU dispatch automatically — no model-pool calls
needed. It uses `callLocalModelCpu` / `encodeDocumentsCpu` directly, which
route through the same ORT sessions that serve queries. The only
coordination required is to **not** call `teardownAllModels` / `initIndexGpuPool`
from the incremental code path.

Follow-up TODO for when the incremental path lands:

- [ ] Verify the dirty-overlay entry point (watcher, file-save hook, or
  lazy-rebuild trigger) does NOT touch `model-pool.js`.
- [ ] Confirm `session-warmup.js` runs the ORT CPU embed + LI warmup before
  any incremental dispatch attempt — the warmup step is already in place
  as of 2026-04-17, but document the dependency here so it doesn't get
  removed by someone tracing "what uses this?"
- [ ] Benchmark a representative incremental run (5 files, LI enabled) with
  warm ORT CPU models to set the <100ms target claimed in the
  "Performance budget" section below.

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

## Exclusion List — shared `loadProjectConfig()`

Both the embed indexer (`core/indexing/indexer-utils.js` via `fast-glob`) and
the LI skip policy (`core/indexing/li-skip-policy.js` via `minimatch`) now
pull their skip list from the same unified source:
`loadProjectConfig(projectRoot).exclude` in
`core/infrastructure/config/search.js`. That list merges the ~190 built-in
patterns (node_modules, lock files, secrets, minified, binaries, snapshots,
…) with any user extensions from `.sweet-search.config.json`. Unification
landed in `bde9b26` → `3fa180c` → `acd5804` and is now the authoritative
source of truth.

Incremental indexing must preserve this invariant across every phase,
otherwise the two indices drift again under config change and the refactor
that produced the unified list becomes incomplete for anyone who edits
their config between runs.

### Requirements

1. **Single source of truth.** Incremental change-detection, file discovery,
   and LI skip policy must all resolve excludes through the same
   `loadProjectConfig(projectRoot)` call. No ad-hoc ignore lists in
   incremental code paths.
2. **Thread `projectRoot` through every phase.** Already done for the full
   pipeline (`indexer-phases.js` passes `PROJECT_ROOT`); repeat for the
   incremental path and for any new daemon/watch entrypoints.
3. **Config change counts as dirty state.** A mutated `.sweet-search.config.json`
   must trigger an exclude-diff and targeted reindex — not be silently
   ignored by mtime-based change detection.
4. **Exclude diff drives bidirectional reindex.**
   - `added` globs → delete matching files from all four indices (lexical,
     embeddings, LI, graph).
   - `removed` globs → full index of files that now match the include set
     but were previously excluded. Treat as "new files" in the dirty overlay.
5. **Cross-index atomicity.** An exclude change that half-lands (e.g. embed
   re-filtered, LI still has old chunks) must not ship. Either gate the
   LI/graph updates behind embed's completion or run them in one transaction.

### Open Questions

1. **Config change detection**: hash `.sweet-search.config.json` (+ merged
   `.gitignore`?) and compare against the previous manifest? Or do we
   diff the resolved exclude list itself? Hashing is simpler; list diff
   lets us skip work when the user edits a comment.
2. **Stale cache eviction.** The LI skip policy caches excludes keyed by
   projectRoot (`_excludesByRoot` Map). Incremental runs in a long-lived
   process (watch mode, MCP daemon) must either invalidate the cache on
   config change or key it by `(projectRoot, configHash)`.
3. **Ordering under concurrent readers.** Can the exclude-diff run while a
   search is in flight? The indices may briefly present inconsistent views
   (embed filtered, LI not yet). Copy-on-write artifact swap protects the
   full-rebuild case; incremental needs equivalent guarantees.
4. **`.gitignore` interaction.** `respectGitignore: true` layers gitignore on
   top of the config excludes. When `.gitignore` changes, does that also
   count as a config change? Currently yes in spirit (file discovery re-runs),
   but the manifest does not track gitignore hash.

### Plan Items (Deferred — this doc is planning only)

- [ ] Extend the incremental manifest to include a content hash of
  `.sweet-search.config.json` and (if `respectGitignore`) of `.gitignore`.
- [ ] Implement an exclude-list diff: given old vs new resolved excludes,
  return `{ added: string[], removed: string[] }`.
- [ ] On `added` globs: walk current index artifacts, delete rows whose
  file paths match any added glob. All four indices.
- [ ] On `removed` globs: re-run file discovery with ONLY the removed-glob
  scope as an include filter, push matching files into the dirty overlay
  as "new files", let the normal incremental path re-index them.
- [ ] Thread `projectRoot` through the incremental entry points (dirty
  overlay, lazy-rebuild path) the same way the full pipeline does.
- [ ] Invalidate `_excludesByRoot` on detected config change — either via
  an explicit `resetCache()` hook or by keying the Map on a composite
  `(projectRoot, configHash)` tuple.
- [ ] Add an integration test: (a) build index, (b) edit
  `.sweet-search.config.json` to add `**/fixtures/**`, (c) run incremental
  update, (d) assert no fixture entries in lexical / embeddings / LI / graph.
  Then reverse: remove the exclude, run incremental, assert all four
  indices now contain fixture entries.
- [ ] Decide explicit semantics for "exclude change during in-flight
  search" and document the atomicity guarantee (or lack thereof).

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
