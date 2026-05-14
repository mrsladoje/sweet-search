# Incremental Indexing Plan

> **Status:** Design proposal (2026-05-14). Supersedes the architectural
> sections of `INCREMENTAL_INDEXING_TODO.md`; the TODO file remains the
> canonical list of edge-case requirements (cold-start, empty-codebase,
> exclude-list diff). This document focuses on the **reconcile architecture**
> that the TODO defers.
>
> **Research basis:** parallel SOTA review across HNSW, BM25/trigram,
> ColBERT/PLAID, tree-sitter/symbol indexing, and production AI-coding tool
> architectures (Cursor, Cody, Continue, Copilot, Windsurf, Aider, Claude
> Code, Tabby, JetBrains, Zoekt). See `## References` for citation list.
>
> **Post-review:** A SOTA gap analysis was performed by Gemini 3.1 Pro
> (deep-think) on 2026-05-15 and folded in. See § 35 for the diff log.
>
> **Constraint anchor:** CPU-only for the incremental path; GPU reserved for
> cold full reindex and watermark-triggered async rebuilds.
> See `INCREMENTAL_INDEXING_TODO.md` § "Model Backend for Incremental Runs".
>
> **Portability:** No part of this design is tied to specific hardware.
> Where the original draft cited M3-class numbers, the plan now uses
> **hardware tiers** (see § 34) with adaptive defaults derived from
> detected resources at daemon startup. Sweet-search must work on a
> 4-core laptop with a SATA SSD and on a 64-core workstation with NVMe
> with the same correctness contract; the only thing that varies is the
> tick budget and watermark cadence.

---

## 1. Executive Summary

Sweet-search ships six search tools (`auto`, `structural`, `read`,
`read-semantic`, `colgrep`, `indexed-grep`) backed by five physical indices:
Float HNSW (`codebase-hnsw.idx`), Binary HNSW + int8 sidecar
(`codebase-binary-hnsw.idx*`), late-interaction SSLX segments
(`codebase-late-interaction.db.segments/`), sparse-gram artifact
(`codebase-sparse-grams.idx`), and the code-graph SQLite database
(`code-graph.db`, includes `entities_trigram` FTS5). Each currently
requires a full rebuild on any file change; the partial daemon at
`core/indexing/index-maintainer.mjs` provides the scaffolding but does
not yet drive the five indices lock-step.

The plan is a **single 60-second reconcile tick** that:

1. Maintains an in-memory dirty set fed by an optional Rust `notify` watcher,
   a JSONL queue, and a periodic mtime backstop scan;
2. Coalesces by **per-file content hash** and **per-chunk content hash**,
   so format-on-save and import-shuffle storms become near no-ops;
3. CPU-encodes only the survivors, bounded by a per-tick CPU budget;
4. Updates all five indices in lock-step with atomic per-tier swaps;
5. Tracks **per-tier rebuild watermarks** (tombstone fraction, dead-doc
   ratio, segment stale percentage) and schedules **async full rebuilds**
   when crossed — these are the only paths permitted to use GPU.

This shape matches the cross-industry SOTA (Cursor's 10-min Merkle reconcile,
Zoekt's pull-poll + scheduled merge, JetBrains' VFS-driven incremental,
Aider's per-prompt repo-map). Sweet-search has one structural advantage worth
preserving: **per-token int4 quantization with no shared codebook**, which
makes incremental late-interaction safe in a way that PLAID/EMVB are not.

The user-visible staleness contract is **<60 seconds for any edit** on a
running system, with a deterministic fallback to full rebuild whenever a
watermark crosses or the config fingerprint invalidates.

---

## 2. Goals & Non-Goals

### Goals

- **Staleness ≤ 60 s** for any single-file edit on a watched repo, measured
  from `write(2)` return to next search query seeing the new content.
- **No MRR regression** on GCSN dev set or any locked baseline probe pack.
  This is the gating quality criterion; any reconcile change that regresses
  aggregate MRR by more than the per-test noise floor is reverted.
- **CPU budget bounded** by an adaptive cap. The default is roughly
  `min(2, physical_cores / 4)` cores worth of wallclock per tick during
  normal editing; bursts (branch switch, generated-code commit) tolerated
  as one-time catch-up. The cap is recomputed at daemon start from
  detected resources (§ 34) and may be overridden via
  `SWEET_SEARCH_RECONCILE_CPU_BUDGET_MS`.
- **All five indices kept in lock-step**: an observer must never see, for
  example, the trigram index showing a function that the LI index does not.
- **Deterministic correctness backstop**: even if every watcher event is
  missed, the periodic mtime sweep guarantees consistency within one tick.
- **Reuse what works**: the existing `index-maintainer.mjs`,
  `incremental-tracker.js`, `incremental-parser.js`, and the
  `entities.stale_since` soft-delete column are already shaped correctly.
  The plan extends them, it does not replace them.

### Non-Goals

- **Sub-second freshness** in the editor. Cursor at 10 min and Continue at
  "once per day" sit comfortably above sweet-search's 60-s target; pursuing
  100 ms freshness would force per-keystroke encoding, which is incompatible
  with the CPU-only incremental constraint and not actually requested.
- **Cross-machine index sync.** No fleet, no shared cache, no CDN of
  prebuilt indices. Single workstation.
- **Embedding model migration.** A future encoder upgrade
  (e.g. CodeSage-Small-v2, see `memory/project_encoder_upgrade_scoping.md`)
  is its own workstream. The reconcile model will need a dual-read window
  during migration; out of scope here.
- **A new ranking signal.** This is plumbing. No new boosts, demotions, or
  format-gated signals are introduced. Per CLAUDE.md, any future signal
  that piggybacks on freshness state (e.g. "recency boost") will be gated
  on `_isAgentFormat` and validated on held-out — separate proposal.
- **Replacing the chunker, the encoder, or any ranking layer.** Reconcile
  consumes their outputs unchanged.

---

## 3. Constraints (Non-Negotiable)

1. **CPU-only incremental path.** GPU lifecycle round-trips dominate
   small-batch work on every platform we target (5–15 s on Apple Silicon,
   similar on CUDA — see TODO § Model Backend). A typical incremental
   tick touches 1–5 files and finishes in well under 1 s of CPU work
   on a modern laptop. The reconcile path must not call `teardownAllModels`
   or `initIndexGpuPool`. Only the **async rebuild scheduler** is
   permitted to arm GPU, and only after the existing `shouldArmGpu` /
   `GPU_ARMING_MIN_FILES` policy fires. Machines without a usable GPU
   (most user laptops, CI runners, headless servers) skip the GPU path
   entirely and run rebuilds on CPU low-priority — see § 34.
2. **Per-token int4 quantization preserved.** Sweet-search's late-interaction
   index uses per-token min/scale (no shared centroid codebook). This is
   the structural reason incremental LI is safe; do not introduce a global
   codebook for storage savings without an explicit, held-out-validated
   regression budget.
3. **Format-gating rule.** No new ranking signal that piggybacks on the
   freshness mechanism may run on NL queries (`format` ≠ `agent*`) until
   held-out evidence shows no regression. See CLAUDE.md § "Ranking Signal
   Format-Gating".
4. **Exclude-list unification.** All change detection, file discovery, and
   LI skip policy must resolve excludes through `loadProjectConfig(projectRoot)`
   in `core/infrastructure/config/search.js`. No ad-hoc ignore lists in any
   new code path. (See TODO § Exclude List.)
5. **DDD boundaries.** Domain logic stays in the owning bounded context;
   SQL and file I/O stay behind repositories/adapters; no direct cross-context
   database access from scripts, daemons, or new watcher code.
6. **No GPU + CPU model coexistence.** Per
   `memory/feedback_no_model_coexistence.md`, the reconcile tick must
   never be running while a GPU model is loaded for batch encoding,
   and vice versa. Synchronize through the existing model-pool epoch.

---

## 4. Current State Map

This section is the ground truth the plan is built against. File paths and
line numbers are accurate as of 2026-05-14.

### Indexer entry points

| Concern | Location | Notes |
|---|---|---|
| Top-level CLI | `package.json:76-77`, `core/cli.js:35-48` | `npm run index` → `core/indexing/index-codebase-v21.js::main` |
| Phase orchestration | `core/indexing/indexer-phases.js` | 5 phases: discover → determine-changed → build-graph → build-vectors → update-state |
| Build hot path | `core/indexing/indexer-build.js` | Code graph build, vector schema, embed + insert |
| ANN builders | `core/indexing/indexer-ann.js` | `buildHNSWIndex:444`, `incrementalUpdateHNSW:345`, `buildLateInteractionIndex:618` |
| Background daemon | `core/indexing/index-maintainer.mjs` | 30 s queue poll + 45 s merkle scan, JSONL queue, lockfile |

### Per-tier storage

| Tier | Path under `.sweet-search/` | Format / library |
|---|---|---|
| Float HNSW | `codebase-hnsw.idx` + `.meta.json` | USearch (mmap-friendly) |
| Binary HNSW | `codebase-binary-hnsw.idx` + 4 sidecars | Custom JS, popcount distance |
| int8 stage-2 sidecar | `codebase-binary-hnsw.idx.int8.json` | Companion to binary HNSW |
| Late-interaction | `codebase-late-interaction.db` stub + `.segments/*.bin` | SSLX v3 binary, 10 K docs/segment, per-token int4 |
| Sparse gram | `codebase-sparse-grams.idx` | Rust artifact, `SSGRMIDX` magic, version 2 |
| Code graph | `code-graph.db` | SQLite — entities, relationships, `entities_fts`, `entities_trigram` |
| Vectors | `codebase.db` | SQLite — vectors table (BLOB) |
| Incremental state | `merkle-state.json` | Per-file SHA-256 + size + mtime_ns + config fingerprint |
| Rebuild gates | `artifact-rebuild-state.json` | Accumulated-change threshold for binary HNSW + int8 |
| HCGS summaries | `code-summaries.json` | Cache, regenerated on demand |
| Daemon state | `index-maintainer-queue.jsonl` (+ lock, dead-letter) | JSONL append-only |

### Existing incremental primitives

| Primitive | Location | What it does today |
|---|---|---|
| Content-hash tracker | `core/indexing/incremental-tracker.js:163` | SHA-256 (16-char) per file + size + mtime_ns; `STATE_VERSION='2.3'` |
| Config fingerprint | `incremental-tracker.js:42-158` | provider + model + dim + hnswDim; mismatch forces full rebuild |
| Tree-sitter incremental parse | `core/indexing/incremental-parser.js` | `getChangedRanges` + line-diff fallback; emits invalidated chunk + entity IDs |
| HNSW remove-and-readd | `indexer-ann.js:345` | `index.remove(key)` then re-insert by file_path |
| Entity tombstone | `core/graph/graph-extractor.js:1738-1777` | `stale_since INTEGER` column; daemon prunes after 30 d |
| LI atomic swap | `indexer-phases.js:108` | `*-stage.segments` → live atomic rename |
| Daemon queue + lock | `index-maintainer.mjs:148-150, 617` | `atomicAcquireQueue`, single-instance lockfile |

### Gap analysis (what is missing)

1. The daemon polls the queue but **does not drive all five indices in one
   transactional pass**; per-tier updates are interleaved without a global
   epoch.
2. **No per-chunk content hash**, so whitespace-only or import-shuffle edits
   still trigger encoding of unchanged chunks.
3. **No watermark scheduler** — the binary-HNSW threshold in
   `artifact-rebuild-state.json` is the only one wired up; Float HNSW,
   LI segments, and sparse-gram have no rebuild trigger beyond "user runs
   `npm run index`".
4. **No CPU budget cap per tick.** A large branch switch can saturate
   encoding and noticeably slow searches that share the encoder pool.
5. **No optional file watcher.** Daemon polls every 30 s, which is fine
   as a backstop but leaves a worst-case 30-s latency for a hint to arrive.

---

## 5. SOTA Findings (Synthesis)

Citations resolve to the full reference list in § References.

1. **Production code-search converged on hybrid watcher + periodic
   reconcile.** Cursor reconciles a Merkle tree every 10 min, Zoekt polls
   on a schedule + optional push webhook, JetBrains uses VFS events but
   coalesces into batches, Continue defers to "once per day". Pure-watcher
   indexing is rare and fragile — VS Code itself falls back to 5-s polling
   on macOS due to FSEvents weirdness, and Linux's default 524 288 inotify
   limit is routinely exhausted by `node_modules`.
2. **Per-file content hash beats mtime for dedupe.** Cursor's
   content-addressed Merkle tree absorbs branch switches and save-all
   storms transparently. Sweet-search already implements this in
   `incremental-tracker.js`.
3. **HNSW at ≤500 K vectors: insertion is essentially free
   (0.3–1 ms/vec).** The dominant failure mode is **deletion damage**:
   ~3-4 % unreachable points after ~3 000 mixed delete/insert cycles
   (arXiv:2407.07871), and graph quality drift past ~10–20 % tombstones.
   Lazy tombstone + filter at top-k + async full rebuild on watermark
   crossing is the production-validated playbook (Qdrant, Weaviate,
   Cosmos DB DiskANN).
4. **Do NOT adopt Lucene segment-per-graph at this scale.** It adds a
   per-segment query tax that is pure latency loss when the corpus fits
   in one mutable graph. The 2026 HNSW-Merger result (SIGMOD '26) makes
   segmented rebuilds 9.6–11.5× cheaper, but only matters once you have
   segments — and sweet-search does not need them.
5. **Late interaction should be a reranker, not first-stage retriever,
   when freshness matters.** Vespa, Qdrant, LanceDB, and Pinecone all
   converged on this. The reason is PLAID's centroid-drift problem
   (Stanford ColBERT issue #181, PLAID-SHIRTTT SIGIR'24): static k-means
   centroids degrade as new tokens land far from existing clusters.
   **Sweet-search sidesteps this entirely** because TurboQuant int4 is
   per-token min/scale, not a shared codebook — append and recompact are
   safe by construction. Preserve this property at all costs.
6. **Trigram + BM25 incremental is well-trodden.** Lucene
   TieredMergePolicy, Tantivy LogMergePolicy, Zoekt compound-shard
   merging, GitHub Blackbird's content-addressed Kafka pipeline — all
   variants of the same pattern (immutable segments + tombstone bitset +
   background merge). On NVMe-class storage with ≥ 8 cores, the
   sparse-gram artifact rebuilds in 1–3 s for 10 MLOC, which on the
   "fast" hardware tier collapses the merge-policy debate to "just
   rebuild it". On slower hardware tiers the design falls back to the
   delta-segment + merge pattern (§ 7.6).
7. **Tree-sitter incremental parse is <1 ms/edit.** rust-analyzer's
   salsa framework demonstrates the broader pattern: per-file isolated
   extraction, cross-file resolution at query time, content-hash early
   cutoff so whitespace edits invalidate nothing downstream. Sweet-search's
   code-graph schema already supports this — entities are per-file,
   relationships join at query time.
8. **Cursor's 10-min cadence + Merkle hash is the industry reference
   point.** Sweet-search's 60-s target is six times tighter, which is
   feasible because (a) we're on a single workstation, not a multi-tenant
   server; (b) we already have content hashing; (c) the codebase is
   typically smaller than Cursor's average customer.

---

## 6. Proposed Architecture

### 6.1 High-level pipeline

```
┌─────────────────┐
│ Rust notify     │── (optional, opt-in via SWEET_SEARCH_WATCH=1)
│ watcher         │
└────────┬────────┘
         │ fsevent → path
         ▼
┌─────────────────┐
│ In-memory dirty │◄──── JSONL queue (index-maintainer-queue.jsonl)
│ set             │◄──── CLI hint (sweet-search index --add <path>)
│ (path → flag)   │◄──── 60-s mtime backstop sweep
└────────┬────────┘
         │
         ▼  every 60 s (configurable via SWEET_SEARCH_RECONCILE_INTERVAL)
┌──────────────────────────────────────────────────────────────────┐
│  Reconcile tick                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 1. Drain dirty set ∪ mtime-advanced paths                  │  │
│  │ 2. Apply unified excludes (loadProjectConfig)              │  │
│  │ 3. Hash each candidate; drop unchanged (content-stable)    │  │
│  │ 4. CPU budget gate: take up to N files / M chunks per tick │  │
│  │ 5. Per file: tree-sitter parse → chunk → entity diff       │  │
│  │ 6. Chunk-content-hash; drop unchanged chunks                │  │
│  │ 7. CPU encode (dense + LI tokens) — ORT CPU only           │  │
│  │ 8. Begin global epoch ε+1; apply per-tier writes:          │  │
│  │      a. code-graph.db: UPSERT entities, mark stale_since   │  │
│  │      b. codebase.db: UPSERT vectors                        │  │
│  │      c. Float HNSW: remove(old keys) + add(new vectors)    │  │
│  │      d. Binary HNSW: tombstone old, append new             │  │
│  │      e. LI: append to growing segment, tombstone old docs  │  │
│  │      f. sparse-gram: queue for rebuild trigger             │  │
│  │ 9. Atomic state commit: merkle-state.json with epoch ε+1   │  │
│  │ 10. Check watermarks → maybe schedule rebuild              │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼  watermark crossing only
┌──────────────────────────────────────────────────────────────────┐
│  Async rebuild scheduler (background, low priority)              │
│  — Tier: Float HNSW / Binary HNSW / LI segment / sparse-gram     │
│  — Mode: GPU when shouldArmGpu() && idle, else CPU low-pri       │
│  — Output: staged artifact → fsync → atomic rename → swap        │
│  — Coordination: model-pool epoch; no concurrent CPU + GPU       │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 The five freshness tiers

Each index has a different cost-to-rebuild and a different acceptable
staleness profile. Treating them uniformly under one schedule is the
mistake that has made every "just throw it in the watcher" design fail.

Rebuild costs are listed as **ranges spanning hardware tiers low → high**
(see § 34 for tier definitions: roughly low = 4-core SATA-SSD laptop;
mid = 8-core NVMe developer machine; high = 16+-core NVMe workstation).

| Tier | Refresh policy | Watermark trigger | Rebuild cost (10 MLOC, low → high) |
|---|---|---|---|
| code-graph entities + FTS5 | live UPSERT + `('merge', 16)` per tick | `fts5_segment_count > 64` → `('optimize')` | seconds (`merge`) / 30 s – 5 min (`optimize`) |
| codebase.db vectors | live UPSERT every tick | none | n/a |
| Float HNSW (USearch) | live `add()` + tombstone bitmap (no `remove()`) | `tombstone_fraction > 0.15` | 5–30 min at 500 K vectors, M=16 |
| Binary HNSW + int8 sidecar | tombstone + append every tick | `dead_doc_ratio > 0.30` (existing) | 30 s – 5 min |
| LI segments (SSLX v3) | append to growing segment; tombstone in sealed | per-segment `stale_doc_ratio > 0.20` → recompact that one segment | per-segment, 1–30 s |
| Sparse-gram artifact | adaptive: fast-rebuild OR delta-merge by tier | fast: `dirty_files > 0`; slow: `delta_size_ratio > 0.10` | 1–30 s |

Critical property: **every tier has both a synchronous "edit-time" path
(cheap) and an asynchronous "rebuild-time" path (expensive).** No tier is
allowed to block the reconcile tick on its expensive path.

### 6.3 Why one schedule, not one timer per tier

Earlier drafts considered a per-tier cadence (e.g. HNSW every 60 s, LI every
5 min, sparse-gram every 10 min). Rejected because:

- Searches read all tiers together; if they disagree about "is this function
  still here?", ranking signals diverge and MRR jitters.
- A single global epoch makes the "did the index see this commit?" question
  answerable from `merkle-state.json` alone.
- Per-tier scheduling tempts per-tier hotfixes that drift away from the
  unified design (the failure mode that caused this plan to be written).

---

## 7. Per-Tier Reconcile Specs

### 7.1 Code graph (code-graph.db)

**Existing.** `core/graph/graph-extractor.js`. Entities keyed by
`sha256(file:type:name).slice(0,16)`. Soft delete via `stale_since`.
FTS5 `entities_trigram` updates trigger automatically on row changes.

**New behavior.**

1. Each reconcile tick walks every changed file's tree-sitter parse,
   produces the new entity set, and DIFFs against rows whose `file_path`
   matches:
   - **Existing & content-stable** (id matches, signature_hash matches):
     no-op.
   - **Existing but signature changed**: UPDATE row; clear `stale_since`.
   - **New**: INSERT.
   - **Removed**: SET `stale_since = epoch_now` (do not DELETE; the
     30-day prune in the daemon eventually reaps).
2. Relationships re-extracted per file, written into `relationships`
   table after entity diff. Cross-file references resolve at query time
   (existing pattern in `core/graph/graph-search.js`), so we never
   recompute global cross-file state on edit.
3. Wrap each file's diff in a `BEGIN IMMEDIATE` transaction; commit per file
   (not per tick) so a partial-tick crash leaves a consistent DB.
4. **PRAGMA synchronous=NORMAL** in WAL mode. Default `synchronous=FULL`
   forces an fsync on every commit, costing 10–30 ms per file on macOS
   APFS and similar on Linux ext4 (much worse on rotational disks). At 50
   files/tick that's 0.5–1.5 s of pure IO wait — enough to blow the CPU
   budget on its own. `NORMAL` in WAL mode loses at most the last
   committed transaction to an OS crash, which is acceptable for a local
   cache that can rebuild from disk content.
5. **Explicit FTS5 compaction.** SQLite's FTS5 is an internal LSM that
   tombstones on DELETE/UPDATE and **does not reclaim space without
   explicit instruction**. A naive reconcile loop would silently bloat
   `code-graph.db` to multiple gigabytes within a week of editing and
   degrade `indexed-grep` BM25 latency 3–5×. Mitigation:
   - End of every reconcile tick: run
     `INSERT INTO entities_trigram(entities_trigram, rank) VALUES('merge', 16);`
     to merge up to 16 segments. Cheap (sub-100 ms typically).
   - During the rebuild scheduler: run
     `INSERT INTO entities_trigram(entities_trigram, rank) VALUES('merge', 500);`
     when watermark `fts5_segment_count > 64` is crossed. **Do not** use
     `('optimize')` — it rewrites the entire FTS5 index in a single
     transaction, instantly producing a WAL frame on the order of the
     FTS5 index size (often 200–800 MB) and tripping the 256 MiB WAL
     bloat alarm in § 8.4. The bounded `'merge', 500` performs the same
     compaction work incrementally without single-transaction WAL
     blowup. Repeat the bounded merge on successive ticks until segment
     count stabilises below the watermark.
   - The same dual-cadence applies to `entities_fts` (porter unicode61
     tokenizer); both FTS5 tables need explicit merging.
   - Track via `SELECT * FROM entities_trigram_data WHERE id < 10` to
     read the internal segment count (FTS5 introspection).
6. **`epoch_written INTEGER NOT NULL` column** on `entities` (and on
   `vectors` per § 7.2). Every UPSERT writes the current reconcile
   epoch. This is the **replay log the LSM rebase in § 10.3 reads
   from** — without it the rebase has no way to ask "what changed
   between ε₀ and ε_now" because SQLite's internal WAL is not
   queryable for row-level change extraction. Index on `epoch_written`
   to make the range scan cheap.

**Verification.** Add a snapshot test: index → edit one file → reconcile →
all OTHER files' entity rows must hash-equal their pre-reconcile state.
This is the structural test that catches "phantom invalidation". Add a
soak test that exercises the FTS5 merge: 1000 edit-reconcile cycles →
assert `code-graph.db` size < 2× cold-build size.

### 7.2 codebase.db vectors

**Existing.** Vectors table `(rowid, id, file_path, embedding BLOB, metadata)`
in `core/indexing/indexer-build.js`. Chunks emitted by `ast-chunker.js`
currently carry `chunk_id = "rx-p${parentCounter}-${childCounter}"` —
**positional** integers across the file pass (see lines 814, 885, 904).

**The positional-ID trap.** A naive plan that UPSERTs keyed on
`(file_path, chunk_id)` and dedupes by chunk-text hash silently fails the
common case: inserting one function at the top of a file shifts
`parentCounter` for every subsequent chunk → every downstream `chunk_id`
changes → cache-miss on every chunk even though the text is unchanged.
The "10× CPU saving" projection is then mathematically zero. This is
the headline finding from the Gemini 3.1 Pro review (§ 35).

**Fix: AST-structural IDs.** Replace the positional scheme with a stable
structural identity derived from the AST:

- **Symbol-attached chunk** (function, method, class, struct, etc.):
  `chunk_struct_id = xxhash3(file_path || parent_symbol_path || symbol_name || signature_norm)`
  where `signature_norm` is the whitespace-normalized signature line.
  Two chunks with identical containing symbol and identical signature
  hash to the same ID regardless of where they sit in the file.
- **Anonymous chunk** (top-level statements, file header, JSX block, etc.):
  `chunk_struct_id = xxhash3(file_path || parent_symbol_path || rolling_hash(normalized_content)) || "_" || occurrence_index_in_parent`
  using a rolling content hash that ignores leading/trailing whitespace
  and import-order shuffles in the parent block. Reorders within the
  same parent of *non-identical* siblings → same ID.
  **The `occurrence_index_in_parent` suffix is mandatory.** Without it,
  two identical statements in the same parent block — e.g.,
  `if (err) return cb(err);` written twice in a function, two identical
  `console.log("…");` lines, two identical guard clauses — would hash
  to the same `chunk_struct_id` and silently overwrite each other in
  the UPSERT. The occurrence index is computed within identical-content
  siblings only (so inserting a non-identical sibling above an
  identical pair does not shift their occurrence indices). Concretely:
  for each anonymous chunk in source order under the same parent,
  the occurrence index is the count of preceding siblings with the
  same `(rolling_hash, parent_symbol_path)` tuple.
- **Fallback for chunks that the AST can't disambiguate** (parser failure,
  unknown grammar): fall back to the existing positional ID but flag
  the chunk with `structural = false`. The encoder is still called for
  these; chunk-hash dedup catches the unchanged case.

**Stability guarantees.**
- Inserting a new function at the top of a file: every other chunk's
  `chunk_struct_id` is invariant. Encode budget = encode the one new chunk.
- Renaming a function: that one chunk's ID changes; siblings unaffected.
- Whitespace-only edits: no ID changes, all chunks dedup.
- Renaming a file (detected via § 22.1 content-hash dedup): IDs stable
  if `file_path` is excluded from the structural ID, or recomputed if
  included. Choose **`file_path` IS included** so chunk identity is
  bound to its file — matches the existing entity ID scheme and
  simplifies "find references in this file".

**Storage.** Add `chunk_struct_id TEXT NOT NULL`,
`chunk_text_hash TEXT NOT NULL`, and `epoch_written INTEGER NOT NULL`
columns to vectors table. Index `epoch_written` so the LSM rebase
replay scan (§ 10.3) is O(changed rows), not O(table size). Old
positional `chunk_id` is preserved for backward compatibility;
reconcile-v2 reads both, writes both, but the structural ID is
authoritative.

**New behavior.**

1. **Hash chunks first, encode second.** For each chunk, compute
   `chunk_text_hash = xxhash3(chunk.content)`. Look up the existing row
   by `chunk_struct_id`. If `chunk_text_hash` matches the stored value,
   reuse the stored embedding — no encoder call. This is where the CPU
   savings actually live.
2. **UPSERT keyed on `(file_path, chunk_struct_id)`.** Old chunks whose
   structural ID is no longer present in the new parse → DELETE in the
   same transaction.
3. The vectors and graph-entities updates for a single file commit in the
   same logical epoch (see § 8.1 atomicity).

**Hash choice: xxHash3, not SHA-256.** Sweet-search hashes for local
deduplication, not cryptographic integrity. xxHash3 throughput is
~15–30 GiB/s on modern x86_64 and ARM64 (Cyan4973/xxHash benchmarks),
versus ~1–2 GiB/s for SHA-256 on cores without dedicated SHA
instructions, or ~5–8 GiB/s on cores with ARMv8 Crypto Extensions or
Intel SHA-NI. On a branch switch that touches 50 000 files at an
average of 5 KiB each (250 MiB total), the difference is ~30–250 ms of
pure hash work — a meaningful fraction of the tick CPU budget on
constrained hardware. xxHash3 is also collision-resistant well beyond
sweet-search's working set (10^9 collisions at ~2^32 items per the
SMHasher3 benchmarks).

**Counter-consideration.** The existing `incremental-tracker.js`
truncates SHA-256 to 16 hex chars (8 bytes / 64 bits). Birthday-bound
collision risk at 1 M chunks is ~10^-7 — already negligible. The win
from switching to xxHash3 is throughput, not security. Apply
xxHash3-64 (low half) and keep the same 16-hex-char display format for
log compatibility.

**CPU savings projection (revised under structural IDs).**
- Whitespace-only edit: ~100 % of chunk hashes match → ~0 encodes.
- Logic edit touching 1–2 functions: ~5–10 % of file chunks change →
  ~10× CPU saving vs whole-file re-encode.
- **Insert function at top of file:** under positional IDs this would
  be ~0 % savings (every ID shifts). Under structural IDs:
  ~`1 / file_chunk_count` encodes — i.e., one chunk re-encoded for a
  10-chunk file → ~10× saving as before.
- Refactor that renames a function: 1 encode per call-site is not
  required because call-site chunks' text/AST is unchanged; the renamed
  function itself is one encode. Encodes ≈ 1 per file affected.

**Verification.** A targeted unit test: parse the same file with one
function inserted at the top → assert structural IDs of every chunk
except the new one are identical.

### 7.3 Float HNSW (USearch)

**Existing.** `core/vector-store/hnsw-index.js` wraps USearch.
`incrementalUpdateHNSW` at `indexer-ann.js:345` removes old vectors per
file and re-inserts.

**Concurrency caveat (verify before shipping).** USearch supports
concurrent additions via atomic CAS on graph topology, but **concurrent
removes during reads are not universally safe** across USearch versions:
a reader traversing a neighborhood while a writer rewires edges around a
removed node can chase a dangling pointer, traverse a stale edge into a
dead node, or loop. Two responses are valid:

- **(A) Read-write coordination.** Wrap reads in a `pthread_rwlock`-style
  shared lock; reconcile takes the exclusive lock for the
  remove + add window. The window is short (microseconds per op) so
  reader latency impact is bounded.
- **(B) Tombstone-only writes (preferred).** Never call `remove()` on
  the live path. Mark vectors stale in a sidecar bitmap, filter at the
  top-k boundary during search. The async rebuild path eventually
  produces a new graph with the dead vectors absent. This is the
  Lucene `liveDocs` pattern.

**Decision: choose (B).** It avoids the safety question entirely, matches
the tombstone model used for LI and Binary HNSW, and aligns with the
single-epoch atomicity model. The "live" `add()` path remains — adding
new chunks is safe — but removals become tombstone-only.

**New behavior.**

1. Live path: for each chunk whose vector changed:
   - mark the old vector's key in `codebase-hnsw.idx.stale.bin`
     (single bit per key, 64-byte aligned so AVX2/NEON SIMD can mask
     later — see § 34.4),
   - `index.add(new_key, new_vec)` with a fresh key (existing key space
     is monotonic; key collisions are impossible because we never reuse).
   Searches filter stale bits after retrieving top-k+slop candidates,
   not during graph traversal — preserves recall.

2. **Capacity management (load-bearing under tombstone-only writes).**
   USearch requires `max_elements` to be declared at `Index::init`.
   Because the live path never calls `remove()`, the key space grows
   monotonically: live vectors + tombstoned vectors, never reclaimed
   until the next async rebuild. Without explicit capacity handling
   the daemon will crash when `max_elements` is exhausted.
   Required behavior:
   - **At rebuild time**: over-allocate the new graph's `max_elements`
     by the tombstone watermark margin plus a working headroom —
     concretely `ceil(live_vectors × (1 + tombstone_watermark) × 1.10)`,
     i.e. ~26 % over current live size at the 0.15 watermark.
   - **At live-add time**: wrap `index.add()` in a try/catch on the
     capacity exception. On exception:
       1. Compute next capacity: `current_capacity × 1.25` (capped at
          a hard ceiling of 100 M elements).
       2. Call `index.reserve(next_capacity)`. This is a synchronous
          graph-resize but cheap relative to a rebuild.
       3. Retry the `add()`.
       4. If `reserve` itself fails (out of memory), enqueue an
          emergency rebuild and tombstone the failed chunk's
          predecessor without adding the new vector — search will
          fall through to BM25 + LI for that chunk until the rebuild
          completes. Log ERROR.
   - **Operator dashboard**: surface `hnsw_capacity_used = (live + tombstoned) / max_elements`
     in the metrics JSON (§ 20.1). Alert if > 0.85.
2. Track `removed_count` and `add_count` in `.meta.json` since last
   rebuild. Compute `tombstone_fraction = removed_count / total_count`
   and `delete_cycles = removed_count` (any vector removed and re-added
   counts as one cycle).
3. **Watermark.** When `tombstone_fraction > 0.15` OR `delete_cycles > 1000`,
   enqueue a rebuild job in the async scheduler.
4. **Rebuild path.**
   - Run on GPU if `shouldArmGpu()` returns true and the model pool is
     idle; else CPU low-priority.
   - Build the new graph in `.sweet-search/codebase-hnsw.idx.next` from
     the current `codebase.db` vectors snapshot.
   - On success: fsync, atomic rename → live; reset `removed_count` and
     `delete_cycles`; bump epoch.
   - On failure: leave existing index in place; log to dead-letter.

**Why 0.15 tombstone fraction?** arXiv:2407.07871 documents ~3–4 % graph
unreachability after thousands of cycles; we want a margin well below that
limit. 0.15 is also the default Qdrant `deleted_threshold`. The probe pack
should re-run at synthetic 5 / 10 / 15 / 20 % tombstone fractions before
we commit to this number (see § Measurements). Note that since we have
adopted tombstone-only writes (see "Concurrency caveat" above), this is
also the trigger that bounds tombstone bitmap pressure and graph
quality drift simultaneously.

### 7.4 Binary HNSW + int8 sidecar

**Existing.** `core/vector-store/binary-hnsw-index.js` and
`core/indexing/artifact-builder.js`. Already gates rebuild on
`artifact-rebuild-state.json::accumulatedChanges`.

**New behavior.**

1. Live path: append new binary fingerprint + tombstone old. Searches
   honor the tombstone bitset (already supported pattern in Lucene-style
   storage; needs implementation here).
2. **Watermark.** Existing threshold; keep current value unless probe
   metrics suggest otherwise. Increase if rebuild storms appear under
   normal editing.
3. **Rebuild path.** Stage-2 int8 sidecar is regenerated as a single
   atomic unit with the binary HNSW — they must always be the same
   epoch. Stage to `*.next`, fsync, swap together.

### 7.5 Late-interaction segments (SSLX v3)

**Existing.** `core/ranking/late-interaction-index.js`. 10 K docs per
segment. Atomic stage-and-swap already implemented at
`indexer-phases.js:108`.

**New behavior (this is the most delicate tier).**

1. **Growing segment.** The newest segment is the only one written into
   live. New chunks (from edits or new files) append here.
2. **Sealed segments** become immutable when they reach the doc cap.
   Edits to docs in sealed segments produce two writes:
   - Mark the old doc tombstoned in the sealed segment's stale bitmap
     (sidecar `*.stale.bin`, single bit per doc, mmap-friendly).
   - Append the new doc to the growing segment.
3. **Per-segment watermark.** Track `stale_doc_count` per segment.
   When `stale_doc_count / segment_doc_count > 0.20`, schedule a
   **per-segment recompaction**: read all live docs in that segment,
   re-emit a new SSLX file under `*.next`, atomic swap. This is bounded
   to ≤ 10 K docs → seconds of CPU work.
4. **No global LI rebuild path.** Per-segment recompaction is enough;
   sweet-search's no-codebook design means there's no centroid to
   refresh. (This is the load-bearing property.)
5. **Query path** must honor the stale bitmap. Update the LI scorer in
   `core/ranking/late-interaction-index.js` to skip stale doc IDs during
   posting-list walk. Validate on the probe pack — the stale bitmap is
   another structural change of the kind that has bitten GCSN twice.

### 7.6 Sparse-gram artifact

**Existing.** Rust native artifact `codebase-sparse-grams.idx`, full
rebuild only (`crates/sweet-search-native/src/sparse_gram.rs`).

**New behavior (adaptive to hardware tier — see § 34).**

1. **Rebuild budget probe at daemon start.** Measure the actual
   sparse-gram rebuild wallclock against the current corpus on the
   current hardware. Use the result to pick one of two strategies:
   - **Fast-rebuild tier** (rebuild ≤ 3 s): just rebuild every reconcile
     tick when the dirty set is non-empty. Simple and correct. Default
     on modern NVMe + multi-core machines.
   - **Slow-rebuild tier** (rebuild > 3 s): use delta-segment + periodic
     merge. The live path appends per-file gram deltas to
     `codebase-sparse-grams.idx.delta`; query path mmap-unions live +
     delta; merge into base when delta size > 10 % of base OR every
     N ticks (default 60). This path matches Lucene's append-only
     segment model.
2. **Watermark.** Fast tier: `dirty_files > 0` triggers rebuild. Slow
   tier: `delta_size_ratio > 0.10` triggers merge.
3. Stage to `*.next`, fsync, atomic rename. Rust artifact is mmap'd,
   so the swap takes effect on the next mmap of the new path.

The plan's original draft assumed fast-tier only ("M3 Max NVMe rebuilds
in 1–2 s"). The slow-tier delta-merge path makes the same architecture
work on a CI runner, a developer laptop with a SATA SSD, or a workstation
under heavy concurrent load. Selection is automatic; no operator
configuration needed.

### 7.7 HCGS summaries cache

**Existing.** `core/graph/hcgs-generator.js` + `code-summaries.json`.

**New behavior.** Out of scope for v1. HCGS regeneration is currently
LLM-driven (or hierarchical roll-up) and orders of magnitude more
expensive than encode. Keep the existing "regenerate on demand" model;
revisit once the reconcile loop is stable.

---

## 8. Atomicity, Consistency, and Concurrency

### 8.1 Epoch model

Define a monotonically-increasing **reconcile epoch** ε, stored as an
integer in `merkle-state.json`. Each tick:

1. Reads current epoch ε.
2. Stages all writes with epoch ε+1.
3. Commits via single update to `merkle-state.json::epoch = ε+1`. This
   commit is fsync'd and atomic (POSIX rename of the staged JSON).
4. Searches see ε+1 on their next state read.

Per-tier files written during the tick carry the epoch in their metadata.
A search that finds, for example, a graph row at epoch ε+1 but a vector
at epoch ε can either:

- (Default) treat both as valid since per-file UPSERT preserves
  consistency for completed files; OR
- (Strict mode) skip results whose tier epochs disagree, logging the
  discrepancy.

### 8.2 Per-file atomicity

Per § 7.1, each file's graph + vectors + HNSW + LI + sparse-gram updates
commit per file. Crash mid-tick: the next tick re-discovers the unfinished
files via content-hash mismatch and replays. **Files are the unit of
atomicity, not chunks** — a chunk update without its sibling chunk update
is fine because every chunk knows which file it belongs to.

### 8.3 Concurrent readers

The existing model (USearch mmap, SQLite WAL, Rust artifact mmap,
SSLX mmap) already supports concurrent readers during writes — **once
the HNSW removal hazard is eliminated by the tombstone-only writes
adopted in § 7.3.** Three additional guarantees we add:

1. **No reader sees a torn metadata header.** Per-tier metadata writes
   go through `fsync + atomic rename`. Existing patterns in
   `indexer-phases.js` already do this for LI; replicate for HNSW.
2. **Tombstone visibility is monotonic.** A reader that observes a
   tombstone bit set for doc D never subsequently sees the same epoch's
   reader observe the bit cleared. Tombstone clearing only happens
   during recompaction, which produces a new file → new mmap.
3. **No HNSW graph topology mutation under live readers.** Per § 7.3,
   `remove()` is never called on the live graph. This is the structural
   guarantee that lets us claim mmap-safe concurrent reads.

### 8.4 SQLite WAL discipline

Three rules. Cheap to implement and necessary for long-running daemons +
MCP servers.

1. **`journal_mode = WAL`** on `code-graph.db` and `codebase.db`.
   Already implied by existing pragmas in `indexer-utils.js`; verify and
   make explicit.
2. **`synchronous = NORMAL`** in WAL mode (see § 7.1.4). Default `FULL`
   adds an unnecessary fsync per commit. `NORMAL` is crash-safe for
   application crashes; the only failure mode is OS-level crash losing
   the last committed transaction, which the next reconcile tick
   reconstructs from disk content.
3. **Active checkpoint policy.** WAL files grow unboundedly when at least
   one reader is always active. **Critical correction**: `TRUNCATE`
   does *not* kill or force readers to release their snapshots —
   SQLite is cooperative. If a reader is holding an active transaction,
   `sqlite3_wal_checkpoint_v2(TRUNCATE)` returns `SQLITE_BUSY` and the
   WAL is **not** truncated. The writer's checkpoint call is therefore
   a *request*, not a *forcing function*. The MCP server (canonical
   long-lived reader) must cooperate or the WAL grows regardless.
   Three coordinated rules:
   - **Reader side (MCP server, mandatory):** between queries, **close
     the read transaction** — either via `COMMIT`/`ROLLBACK` of an
     explicit transaction or by closing and reopening the database
     connection. Holding a long-lived read transaction across many
     queries (the most natural caching pattern) is the single
     biggest cause of WAL bloat in production SQLite. Additionally,
     call `sqlite3_wal_checkpoint_v2(SQLITE_CHECKPOINT_PASSIVE)`
     every 100 queries; `PASSIVE` does not block readers and advances
     the checkpoint frontier when feasible.
   - **Writer side (daemon):** after each successful tick, call
     `sqlite3_wal_checkpoint_v2(SQLITE_CHECKPOINT_PASSIVE)`. Once per
     N ticks (default 60), upgrade to `SQLITE_CHECKPOINT_TRUNCATE`
     **and handle the BUSY return**: if BUSY, log INFO ("reader
     holding back checkpoint") and try again next cycle. Do not
     block on it. The daemon's TRUNCATE is opportunistic.
   - **Watermark.** If WAL file size exceeds 256 MiB (configurable),
     log WARN with reader pid info (queried via SQLite shared-memory
     introspection where supported, otherwise just file size). If it
     exceeds 1 GiB, log ERROR with explicit operator remediation
     ("MCP server is likely holding a long-lived read transaction;
     restart MCP or reduce query-cache lifetime"). Never block the
     daemon on the bloat condition.

The cooperative model is the SQLite reality, not a sweet-search choice.
Documenting it accurately matters because the previous draft implied
that the writer could *force* the WAL to truncate; it cannot. Both
sides must cooperate or the daemon's TRUNCATE silently no-ops while
disk fills.

Without these three rules — especially MCP-side transaction hygiene —
`code-graph.db-wal` and `codebase.db-wal` will grow into the gigabytes
within a week of a continuously-running MCP server. This is a known
SQLite production failure mode (Tailscale, Litestream, and pgvector
forums all document the same pathology).

### 8.5 Concurrent writers

The existing single-instance lockfile at
`.sweet-search/index-maintainer.lock` prevents concurrent reconcile ticks.
Keep this; the lock is acquired at tick start, released at commit.

Two writer classes need explicit consideration:

- **Full reindex via `npm run index`** must take the same lock. If the
  daemon is running, the full reindex waits for the current tick to
  commit, then runs to completion holding the lock. Daemon resumes after.
- **Worktrees.** Stamp the DB directory using
  `git rev-parse --git-common-dir` (not the worktree path), so multiple
  worktrees share an index where appropriate. Documented; not implemented
  in v1.

### 8.6 Stale-lockfile recovery

A daemon crash leaves a lockfile that no one owns. Detection:

1. Lockfile contains `pid` and `boot_id` (Linux: `/proc/sys/kernel/random/boot_id`;
   macOS: `kern.boottime`).
2. On `acquire`: if the recorded `boot_id` differs from current →
   stale; clear. If `boot_id` matches but `kill -0 pid` returns ESRCH →
   stale; clear.
3. If the lockfile is held by a live process, fail-fast with the
   conflicting pid in the error message.

Implement once and reuse across daemon + reindex + worker processes.

---

## 9. Trigger Mechanism

### 9.1 Default: periodic backstop

The minimum viable trigger is the existing daemon's periodic poll, tuned to:

- `SWEET_SEARCH_RECONCILE_INTERVAL=60s` default (overridable; minimum
  10 s, maximum 600 s). Auto-scaled by hardware tier (§ 34): faster
  machines get tighter intervals; slower machines get longer.
- Each tick: walk every tracked directory; for any file whose
  `(mtime_ns, size, inode)` tuple differs from the recorded value in
  `merkle-state.json`, hash and enqueue.
- **Cheap relative to corpus size and storage class.** A typical
  directory walk over 100 K files completes in ~0.5–2 s on NVMe-class
  storage, ~5–15 s on SATA SSD, ~30–120 s on a spinning disk. The
  reconcile interval auto-adjusts so the walk never dominates the
  tick (§ 34.3).

**The mtime equality trap (Ninja's lesson).** The naive check
`current.mtime_ns > recorded.mtime_ns` is **wrong**: filesystems with
sub-nanosecond mtime resolution exist (modern Linux ext4 in some
configurations), but many filesystems and code paths truncate mtime
to 1-second or 1-millisecond resolution:
- tar / zip extraction
- git checkout on older versions
- WSL2 boundary file copies
- network filesystems (NFS, SMB)
- editors that explicitly set mtime to a synthetic value
A second write within the same low-resolution mtime tick will have an
mtime _equal_ to the recorded value, and `>` misses it forever.

**Fix.** Compare the full tuple:

```
dirty if (current.mtime != recorded.mtime)
     OR (current.size  != recorded.size)
     OR (current.inode != recorded.inode)
```

The inode check catches "atomic rename over existing path" (vim swap
write, JetBrains safe-write); without it, a same-size same-mtime
edit through the rename pattern is invisible.

**Node.js BigInt inode caveat (load-bearing).** `fs.statSync(path).ino`
returns a JavaScript `Number` (IEEE 754 double, 53-bit mantissa).
Modern filesystems — APFS, ZFS, XFS, Btrfs in some configurations —
issue 64-bit inodes that routinely exceed `Number.MAX_SAFE_INTEGER`
(`2^53 - 1`). When that happens, Node silently truncates precision
and two distinct files can compare equal in the `inode` field. The
plan must:

- Use `fs.statSync(path, { bigint: true })` (or `fs.promises.stat`
  with the same option). Returns inode (and mtimeNs, size) as
  `BigInt`.
- Store the inode in `merkle-state.json` as a **string** (JSON has
  no BigInt type; serializing as number would re-truncate).
- Compare via BigInt equality after `BigInt(stored)` parse.

Same caveat applies to `mtimeNs` (nanosecond timestamps exceed the
safe integer range for any time after roughly the year 2255 — not
load-bearing today, but the BigInt-everywhere policy is uniform and
cheap, so apply consistently). `size` is bounded well within
`Number.MAX_SAFE_INTEGER` for any reasonable file under
`SWEET_SEARCH_MAX_FILE_BYTES` (1 MiB default) so it can stay
`Number`, but using BigInt for all three is simpler than carrying
the conditional.

After this cheap fast-path, candidates go through full content
hashing (§ 7.2). The mtime/size/inode tuple is a _hint_, not a
truth — the content hash decides whether work runs.

This alone delivers the staleness contract (≤ tick-interval seconds
for any edit).

### 9.2 Optional: Rust `notify` watcher

Opt-in via `SWEET_SEARCH_WATCH=1`. Watcher updates the in-memory dirty set
only; it does **not** trigger work directly. Reasons:

- Watcher events are advisory ("something may have changed in subtree T");
  the source of truth remains content-hash diff at tick time.
- Burst handling: a single `git checkout` between branches can fire 50 k
  events in < 100 ms. Letting these accumulate in the dirty set and
  draining at the next tick is the only sane response.
- Inotify-limit exhaustion (Linux): detect `ENOSPC`, log a clear
  remediation message, fall back to pure 60-s polling for the unwatched
  subtree.

### 9.3 Explicit hints: JSONL queue

The existing `index-maintainer-queue.jsonl` remains the integration point
for editors and MCP clients (Cursor, Claude Code) to drop change hints.
Format unchanged; consumed at every tick.

### 9.4 CLI: `sweet-search index --add <path>`

Adds an entry to the JSONL queue and returns. Useful for shell scripts and
git hooks (yes, despite the name, a *git* post-commit hook is a sensible
integration point — fires rarely, batches by commit). Distinct from
per-save editor hooks, which we explicitly do not support.

### 9.5 Trigger-mechanism decision tree

```
User edits file
  │
  ├── Editor saves                          → fsevent → dirty set
  ├── git checkout / git pull                → many fsevents → dirty set
  ├── Generated code drop                    → fsevents → dirty set
  ├── No fsevent (FSEvents glitch, etc.)     → caught by mtime sweep at next tick
  │
  ▼
60-s tick → process dirty set ∪ mtime-advanced
  │
  └── No-op if all content hashes unchanged (format-on-save, etc.)
```

---

## 10. Watermark & Rebuild Scheduler

### 10.1 Watermark evaluation

At end of each tick (after commit), evaluate per-tier watermarks. Trigger
a rebuild by appending to a rebuild queue (`.sweet-search/rebuild-queue.jsonl`).

The queue, not the daemon, owns rebuild execution. This keeps the reconcile
tick fast and lets rebuilds run on a separate cadence.

### 10.2 Rebuild executor

A separate process (or worker thread; design TBD — see § Open Questions):

1. Polls `rebuild-queue.jsonl` every 30 s.
2. For each pending rebuild:
   - Check whether GPU is idle and `shouldArmGpu()` returns true.
   - If yes: arm GPU per existing model-pool API, run rebuild, tear down,
     restore CPU pool.
   - If no: run on CPU at `nice 10` (low priority) so it does not impact
     interactive search latency.
3. On success: stage → atomic swap → reset the tier's watermark counters.
4. On failure: move job to dead-letter; preserve old artifact.

### 10.3 Coordination with reconcile (LSM rebase pattern)

During a rebuild, the reconcile tick continues normally. New
edits land in the live indices via the live paths (HNSW add +
tombstone-only, LI append + tombstone, etc.). When the rebuild
completes, it must rebase onto current state. The race window between
"replay drained" and "swap committed" is the hazard; **the swap must
hold the writer lock so no edit can land in it.**

Lock-respecting protocol:

1. Rebuild starts: read the current `merkle-state.json::epoch` as ε₀.
   Snapshot the source data (vectors / LI tokens) at ε₀. No lock held;
   reconcile continues writing.
2. Build the new artifact in `*.next` from the ε₀ snapshot. This is the
   long phase (seconds to minutes); reconcile keeps writing at ε₀ + 1,
   ε₀ + 2, ….
3. **Bounded-iteration replay loop** (LSM compaction's "minor merge"):
   - Read current epoch ε_now.
   - Replay (ε₀, ε_now] writes into `*.next`. **The replay source is
     the `epoch_written` column on the SQLite tables** (added per
     §§ 7.1.6 and 7.2), not "the WAL." SQLite's internal WAL is not
     queryable for row-level extraction; only an application-level
     replay log works. The query is simply
     `SELECT * FROM vectors WHERE epoch_written > :ε₀ AND epoch_written <= :ε_now;`
     and likewise for `entities`. For tiers whose source-of-truth is
     not SQLite (LI tokens, sparse-gram), the same `epoch_written`
     pattern is applied via a small per-tier change-log table
     (`li_change_log(chunk_struct_id, op, epoch_written)`,
     `sparse_gram_change_log(file_path, epoch_written)`) maintained
     by the reconcile tick.
   - If `ε_now - ε₀ > replay_threshold` (default 5), loop. Each pass
     narrows the gap.
   - Exit the loop when the gap stops shrinking (replay rate ≥ write
     rate) OR a hard cap is reached (default 10 passes).
4. **Acquire `index-maintainer.lock`** (writer-exclusive). This is the
   critical step the original draft missed.
5. With lock held: replay any final epochs since the last bounded loop
   iteration. The set is now small and bounded because we hold the
   lock — no new writes can land.
6. Fsync, atomic rename `*.next` → live. Bump per-tier epoch metadata.
7. Release lock.
8. Tombstone counters reset for that tier; old artifact left in place
   for one more tick in case a reader is still mmap'd to it, then
   unlinked.

**Why bounded replay before locking.** Holding the writer lock through
the full replay starves the reconcile tick → editor staleness spikes.
Bounded iteration narrows the gap pre-lock so the lock is held for
milliseconds, not the rebuild's full wallclock.

**Pathological case: replay rate < write rate.** If the user is running
a continuous codemod (e.g., a 100 K-line refactor script), the replay
loop never converges. The hard cap (10 passes) bails out and the
rebuild scheduler re-enqueues — the second attempt will succeed once
the codemod completes. Log a WARN if replay caps are hit > 3× in
succession (operator signal: rebuild is starving).

This is the **classic LSM rebase pattern** as deployed in RocksDB,
LevelDB, and Cassandra compaction. The plan's prior draft glossed
over the lock; this version makes it explicit.

---

## 11. Failure Modes (Design For Each)

| Failure | Detection | Response |
|---|---|---|
| Branch switch / git checkout (50 k events in < 1 s) | Watcher overflow OR mtime sweep | Content-hash dedup eats the herd; expect 90 %+ no-ops |
| Save-all from editor (Vim `:wa`, IntelliJ Save All) | Burst of WRITE events | 60-s coalescing; content-hash dedup |
| Format-on-save (whitespace-only edit) | Content hash unchanged | Skip all encoding; no-op tick |
| `node_modules/` dump (`npm install` against new lockfile) | Massive event burst | Default deny-list (independent of `.gitignore`) catches |
| Vendored deps not in `.gitignore` | Files match include set | `.sweet-search-ignore` opt-in; hard cap warning above 200 k files |
| Linux inotify exhaustion (ENOSPC) | Watcher returns error | Log remediation; fall back to 60-s polling for that subtree |
| FSEvents glitch on macOS | Missed events | mtime sweep catches at next tick |
| Crash during reconcile | Process exit before commit | Next tick replays via content-hash mismatch; lockfile cleared. **However**, HNSW `add()` is not idempotent (each call assigns a new key). A crash AFTER `index.add()` but BEFORE `merkle-state.json` commit leaks one duplicate vector per affected chunk into the live HNSW. The duplicate is **self-healing**: the next async rebuild (§ 10.3) reads the source-of-truth from `codebase.db` (which IS idempotent via UPSERT on `(file_path, chunk_struct_id)`) and constructs the new graph cleanly. Until then, search returns one stale + one fresh result per affected chunk — fusion + dedup at the result-set layer (§ 19) mitigates user-visible impact. Same logic applies to LI segment appends. Document explicitly: **the async rebuild is the garbage collector for crash-leaked vectors.** Do not attempt to make HNSW add idempotent (would require read-before-write on every add → unacceptable latency). |
| Crash during rebuild | Rebuild process exit | Old artifact still live; rebuild-queue retries; dead-letter after N |
| Worktree with shared index | Multiple processes, one lockfile | First takes lock, second blocks; document explicitly |
| Config change (e.g. `.sweet-search.config.json` edit) | Config fingerprint mismatch | **Full reindex forced** (existing behavior in `incremental-tracker.js`) |
| Encoder model upgrade | Config fingerprint mismatch | Full reindex; future: dual-read window (out of scope v1) |
| Disk full mid-stage | fsync failure | Abort, preserve old; log; surface to user |
| GPU armed by another process | Model-pool epoch mismatch | Rebuild scheduler falls back to CPU low-pri |
| User runs `npm run index` while daemon is running | Lock contention | Daemon's current tick finishes; full reindex takes over; daemon resumes after |
| `merkle-state.json` corruption | JSON parse failure on load | Treat as no prior state → full reindex |

---

## 12. Quality Discipline

### 12.1 MRR-first

Per CLAUDE.md and `memory/feedback_accuracy_nonnegotiable.md`:

- Every change to the reconcile path runs the GCSN dev set + locked probe
  packs before merge.
- The held-out GCSN 40 % is **never inspected per-query**; only aggregate
  metrics, only at milestones, only after dev passes.
- A reconcile change that introduces a regression greater than the test
  noise floor on aggregate MRR is reverted. No exceptions; this is the
  gating criterion.

**Noise floor definition** (load-bearing, was previously left undefined):

| Benchmark | Noise floor (absolute MRR) | Source |
|---|---|---|
| GCSN dev / held-out | **±0.005** | Empirical jitter measured across seed=42 reruns + AVX2 vs NEON summation order differences |
| Retrieval-probes | **±1 PASS** (60-probe pack) | One-probe noise from chunker tie-breaking |
| ast-tester-probes | **±1 PASS** (170-probe pack) | Parser-state nondeterminism |
| structural-redo | **±1 PASS** | Same |

An absolute regression of −0.005 MRR (0.5 percentage points) or worse on
any benchmark is a regression. Anything tighter is noise.

If a change shows an MRR delta that's within the noise band but
*consistent in sign across multiple reruns* (3 of 3 reruns negative,
even if each is −0.001), treat it as a soft regression and investigate
before merging. CLAUDE.md `memory/feedback_dont_overrevert_chunker_fixes.md`
applies in the reverse direction: do not auto-revert structurally
correct changes that show 0-or-positive delta with no probe flips.

### 12.2 Format-gating

- The reconcile mechanism **itself** is correctness, not a ranking signal,
  and is therefore not gated.
- Any **derived ranking signal** (e.g. "boost recently-edited files",
  "demote files older than X days") MUST be gated on `_isAgentFormat`
  until held-out evidence on NL queries shows no regression. This is the
  guidance from CLAUDE.md and was validated by two regressions
  (−0.07 pp from symbol-exact boosts, −27.57 pp from anomalous-chunk
  demotion). Do not relax.

### 12.3 Structural invariance test

A new CI gate: a **deterministic reindex test** that proves the reconcile
output equals the cold-rebuild output for unchanged files.

```
1. cold-build index on fixture corpus
2. snapshot file-level hashes of every per-tier artifact row for every file
3. edit one file
4. run reconcile
5. assert: every OTHER file's per-tier rows hash-equal step 2
```

This catches phantom invalidation, ghost re-encoding, and the kind of
silent breakage that an MRR test would miss until the next probe pass.

### 12.4 Benchmark cadence

- **Per-change / iteration:** GCSN dev (60 %) + structural invariance test.
- **Pre-commit:** + the locked probe packs (retrieval-probes,
  ast-tester-probes, structural-redo).
- **Pre-release:** + GCSN held-out (40 %) aggregate only.

Use the existing seed-42 stratified split policy from CLAUDE.md.

---

## 13. Phased Implementation Plan

### Phase 0 — Preflight (no code, ~1 day)

- [ ] Run GCSN dev + held-out aggregate to lock the **pre-reconcile
  baseline**. Tag the commit `pre-incremental-reconcile-baseline`.
- [ ] Confirm `incrementalUpdateHNSW` and `stale_since` paths are
  exercised by at least one existing test; add minimal coverage if not.
- [ ] Decide rebuild-executor process model: separate process, worker
  thread, or run-in-daemon. **Recommended:** separate process at
  `core/indexing/rebuild-worker.mjs`, communicated via the rebuild-queue
  JSONL. Reasons: clean GPU lifecycle, no daemon CPU interference,
  trivial to kill/restart.

### Phase 1 — Structural chunk IDs, content hash, encode-skip (~5 days)

This phase grew after the Gemini review: positional `chunk_id`s defeat
the chunk-hash dedup on common edits, so the structural-ID rework is
prerequisite to the encode-skip savings.

- [ ] Add `chunk_struct_id TEXT NOT NULL` and `chunk_text_hash TEXT NOT NULL`
  columns to vectors table in `codebase.db` (auto-migrate; preserve
  existing `chunk_id` for compatibility).
- [ ] In `core/indexing/ast-chunker.js`, emit `chunk_struct_id` per § 7.2
  for symbol-attached and anonymous chunks. Keep positional `chunk_id`
  as fallback for parser failures.
- [ ] Wire xxHash3 (via the existing native crate or `xxhash-wasm`)
  behind a `HASH_ALGORITHM` switch defaulting to `xxhash3`.
- [ ] In `indexer-build.js`, compute `chunk_text_hash` before encoder
  dispatch; look up by `chunk_struct_id`; if hash matches, reuse stored
  embedding (zero encoder calls).
- [ ] Add tracing counters: chunks_struct_stable, chunks_text_unchanged,
  chunks_encoded per tick.
- [ ] Verify on:
  - "format file" no-op edit → 100 % chunks_text_unchanged.
  - "insert function at top of file" → all other chunks
    chunks_struct_stable; only one chunks_encoded.
  - "rename function" → only the renamed function's chunk encoded.
- [ ] **Gate:** GCSN dev MRR unchanged within noise floor; structural
  invariance test (§ 12.3) green.

### Phase 2 — Unified reconcile tick (~3 days)

- [ ] Extract the per-file reconcile from `index-maintainer.mjs` into a
  `Reconciler` class in `core/indexing/reconciler.mjs`.
- [ ] Reconciler owns: dirty-set processing, content-hash diff, per-file
  per-tier writes, epoch commit.
- [ ] Daemon becomes a thin driver: timer → `reconciler.tick()`.
- [ ] Implement per-tier write methods:
  - `applyGraphDelta(file, parsedEntities)`
  - `applyVectorDelta(file, chunks, hashes)`
  - `applyHNSWDelta(file, vectorOps)`
  - `applyBinaryHNSWDelta(file, vectorOps)`
  - `applyLIDelta(file, tokenOps)`
  - `markSparseGramDirty(file)`
- [ ] Implement the structural invariance test from § 12.3.
- [ ] **Gate:** structural invariance test green; GCSN dev MRR unchanged.

### Phase 3 — Watermarks & async rebuild executor (~3 days)

- [ ] Add tombstone counters to Float HNSW `.meta.json` and LI segment
  `.stale.bin` sidecars.
- [ ] Implement watermark evaluation at end of each tick; emit rebuild
  jobs to `rebuild-queue.jsonl`.
- [ ] Implement `core/indexing/rebuild-worker.mjs`:
  - Process model: separate node process spawned by the daemon.
  - GPU coordination: `shouldArmGpu()` + idle check.
  - Stage-and-swap with epoch rebase (§ 10.3).
- [ ] Implement LI per-segment recompaction.
- [ ] **Gate:** synthetic 20 % tombstone fraction triggers rebuild;
  post-rebuild MRR within noise floor of cold-rebuild MRR.

### Phase 4 — Optional Rust `notify` watcher (~2 days)

- [ ] Add `crates/sweet-search-native` binding for `notify` watcher.
- [ ] Expose Node-side as opt-in via `SWEET_SEARCH_WATCH=1`.
- [ ] Implement ENOSPC fallback to pure polling on Linux.
- [ ] Default `.sweet-search-ignore` patterns; 200 k file cap warning.
- [ ] **Gate:** with watcher enabled, latency from `write(2)` to dirty-set
  membership < 100 ms; same MRR as polling-only path.

### Phase 5 — Tombstone-fraction sensitivity study (~1 day)

- [ ] Synthetic injection harness: take current dev index, randomly mark
  N % of vectors as tombstoned, do not rebuild, run GCSN dev.
- [ ] Sweep N ∈ {5, 10, 15, 20, 25, 30 %}.
- [ ] Fit MRR-vs-tombstone-fraction curve; choose Float HNSW watermark
  threshold based on "first N where MRR drop > noise floor" minus a
  margin.
- [ ] Lock the threshold in config; document the study in
  `docs/INCREMENTAL_INDEXING_RESULTS.md`.

### Phase 6 — Production hardening (~2 days)

- [ ] Surface "index N seconds stale" in CLI output (Cursor doesn't,
  users complain; cheap, load-bearing for trust).
- [ ] Dead-letter inspection CLI (`sweet-search reconcile inspect`).
- [ ] Lockfile staleness recovery (current owner crashed → take over).
- [ ] Document operator runbook for: stuck rebuild, dead-letter overflow,
  forced full rebuild.

**Total estimate:** ~13 working days for one engineer focused. The
existing primitives carry most of the load; this is mostly stitching.

---

## 14. Measurements & Open Questions

### 14.1 Measurements needed before merge

1. **Tombstone-fraction sensitivity** (Phase 5). Confirms 0.15 watermark
   choice or moves it.
2. **CPU encode throughput** with warm CPU ORT, measured across at
   least three hardware tiers (low-end laptop, mid-range developer
   machine, high-core workstation — see § 34 for tier definitions).
   Chunks-per-second determines the per-tick CPU budget on each tier.
3. **Per-segment LI recompaction wallclock** at the 10 K-doc cap, also
   per tier. Confirms the "single-segment rebuild fits in a tick"
   budget on the slowest target tier.
4. **Sparse-gram rebuild wallclock** on the actual target corpus, per
   tier. Determines whether the fast-rebuild or delta-merge strategy
   from § 7.6 is selected at daemon startup.
5. **Reconcile tick wallclock** end-to-end on a realistic edit burst
   (10–50 files). Target: P99 below 50 % of the configured tick interval
   on every supported tier (so the tick never overruns into the next).

### 14.2 Open questions deferred

1. **Reconcile interval auto-tuning.** Default 60 s; high-churn monorepos
   might want 30 s, sleepy projects 300 s. Heuristic on observed dirty-set
   churn rate. Out of scope for v1.
2. **Cross-process concurrent reconcile.** Currently single-writer
   lockfile; can two daemons (one per VS Code window) coordinate? Not
   in v1; v1 enforces one.
3. **Encoder model upgrade migration.** Dual-read window during a
   re-embed pass. Tied to the CodeSage-Small-v2 workstream; out of scope.
4. **Cross-worktree shared index.** `git common-dir`-keyed paths.
   Documented; not implemented in v1.
5. **HCGS summaries refresh policy.** Currently regenerate-on-demand;
   should reconcile invalidate them? Defer.
6. **Inotify-watcher pros/cons net-positive at sweet-search scale?**
   The 60-s polling backstop may be enough that the watcher complexity
   doesn't pay off. Default off; ship the timer first; revisit after
   2 weeks of real use.
7. **`.gitignore` content-hash inclusion in config fingerprint.**
   ~~The TODO flags this as an open question.~~ **Resolved 2026-05-15:**
   hash the **resolved exclude array** returned by
   `loadProjectConfig(projectRoot)`, not the raw file. Adding a comment
   line to `.gitignore` should not trigger a full reindex; adding
   `**/build/**` should. The TODO's bidirectional exclude-diff already
   describes the right downstream behavior — the fingerprint change is
   what triggers it. Implementation: in
   `core/indexing/incremental-tracker.js::buildConfigFingerprint`, add
   `excludesHash = xxhash3(sorted(resolved_exclude_array).join('\n'))`
   to the fingerprint tuple. The diff path described in the TODO does
   the bidirectional reindex.

---

## 15. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phantom invalidation re-encodes unchanged chunks | Medium | CPU waste, no correctness impact | Structural invariance test (§ 12.3) |
| Reconcile MRR regression | Medium | Quality regression | Pre-merge GCSN dev + locked probes; pre-release held-out |
| Tombstone watermark too high → search recall drops | Medium | Quality regression | Phase 5 sensitivity study + margin |
| Tombstone watermark too low → rebuild storms | Low | CPU waste | Watch rebuild frequency; adjust threshold |
| Async rebuild rebase races a live edit | Medium | Lost write | LSM rebase pattern (§ 10.3); test concurrent edit + rebuild |
| Watcher overwhelms dirty set (50 k events) | Low | Memory bloat | Path dedup at insertion; bounded set size |
| Inotify exhaustion on Linux | Medium (large repos) | Watcher fails | ENOSPC detection → polling fallback |
| FSEvents glitch on macOS | Medium | Missed events | mtime sweep catches at next tick |
| Daemon crash mid-tick | Low | Inconsistent partial state | Per-file atomicity; next tick replays |
| Config fingerprint changes for benign reason | Medium | Full reindex blocks user | Only fingerprint provider+model+dim; not pipeline-version edits |
| LI per-segment recompaction blocks reconcile | Low | Latency spike | Run via rebuild-worker, not in reconcile tick |
| Format-gating regression slips in via "recency boost" | High (over time) | NL MRR regression | Format-gating rule + held-out CI |
| Schema migration on `chunk_content_hash` column | Low | Cold start required | Auto-migrate at first daemon start; document |
| Stale lockfile after crash | Medium | Daemon won't start | Phase 6 staleness recovery |

---

## 16. Why This Design (Argument Summary)

1. **Single-tier rebuilds at sweet-search scale are seconds, not hours.**
   That collapses the segment-vs-mutable debate to "mutable + tombstone +
   async rebuild." Lucene's segment model exists because rebuild at billion
   scale is impossible; sweet-search is at 500 K vectors per repo.
2. **Per-token int4 with no shared codebook is the load-bearing property
   for safe incremental LI.** PLAID-class designs cannot do this safely
   without PLAID-SHIRTTT hierarchical re-clustering; sweet-search can,
   because there are no centroids to drift. Preserve the property.
3. **Content-hash dedup is necessary and sufficient for handling
   editor pathologies** (save-all, format-on-save, branch switch,
   generated-code dumps). Cursor proved this at scale; sweet-search
   already implements it; the plan extends it to chunk level.
4. **60-s reconcile is six times tighter than Cursor and is the right
   number for a single workstation**, because rebuild costs scale
   sub-linearly with corpus size and the user's edit-to-search latency
   tolerance is much higher than they realize.
5. **CPU for incremental, GPU for batch** is forced by the GPU lifecycle
   cost. The plan threads this constraint through every tier explicitly.
6. **The existing primitives carry most of the load.** This is plumbing,
   not new science.

---

## 17. References

### Academic / arXiv

- Malkov & Yashunin, *Efficient and robust ANN with HNSW*, arXiv:1603.09320.
- Singh et al., *FreshDiskANN*, arXiv:2105.09613, SIGMOD '22.
- Xu et al., *SPFresh*, arXiv:2410.14452, SOSP '23.
- Cosmos DB DiskANN streaming, arXiv:2502.13826, 2025.
- HNSW-Merger, SIGMOD '26 (Purdue).
- Xiao et al., *HNSW unreachable points*, arXiv:2407.07871, 2024.
- Greator topology-aware updates, PVLDB vol. 19, p. 495, 2025.
- ACORN filtered HNSW, arXiv:2403.04871, 2024.
- ParlayANN parallel HNSW, PPoPP '24.
- Graph-based vector search survey, PACMMOD '25, arXiv:2502.05575.
- Santhanam et al., *ColBERTv2*, NAACL '22, arXiv:2112.01488.
- Santhanam et al., *PLAID*, CIKM '22, arXiv:2205.09707.
- Lawrie et al., *PLAID-SHIRTTT*, SIGIR '24, arXiv:2405.00975.
- MacAvaney & Tonellotto, *PLAID Reproducibility*, arXiv:2404.14989.
- XTR, arXiv:2304.01982, NeurIPS '23; replication arXiv:2605.00646, 2026.
- WARP, arXiv:2501.17788, SIGIR '25.
- MUVERA, arXiv:2405.19504, NeurIPS '24.
- EMVB, arXiv:2404.02805, SIGIR '24.
- Seismic, arXiv:2404.18812, SIGIR '24.
- Stack Graphs, OASIcs EVCS '23, arXiv:2211.01224.
- Annotative Indexing, arXiv:2411.06256.
- Brunsfeld, *Tree-sitter*, Strange Loop 2018; ongoing.

### Production blogs / engineering posts

- Cursor, *Secure codebase indexing*, cursor.com/blog (2024–2025).
- Engineer's Codex, *How Cursor indexes codebases fast* (May 2025).
- Sourcegraph, *How Cody understands your codebase*; *Anatomy of a
  coding assistant*; *Tackling the long tail of tiny repos with shard
  merging* (Hengl, 2021).
- GitHub Engineering, *The technology behind GitHub's new code search*
  (Avgustinov, 2023); *A brief history of code search at GitHub* (2024).
- Continue.dev docs; LanceDB blog, *AI-Native Development is Local*.
- GitHub, *Indexing repositories for Copilot Chat*; embedding model
  release (Oct 2025).
- Windsurf docs; Latent Space interview with Varun Mohan.
- Aider, *Repo map* (Gauthier, Oct 2023).
- Tabby docs; TabbyML/tabby#3163.
- JetBrains, *Shared Indexes*; *Junie agent*.
- Sourcegraph Zoekt design.md; admin/search docs.
- Elasticsearch Labs, *HNSW graphs and merging* (April 2025).
- Qdrant 2025 recap, qdrant.tech.
- Vespa, *Approximate nearest neighbor HNSW*, docs.vespa.ai.
- rust-analyzer architecture book; *Durable incrementality* (matklad, 2023).
- Glean open source, engineering.fb.com (Dec 2024).
- Cox, *Regular Expression Matching with a Trigram Index* (2012).
- Tantivy ARCHITECTURE.md; fulmicoton, *Of tantivy's indexing*.
- McCandless, *Visualizing Lucene's segment merges* (2011).

### Internal references

- `INCREMENTAL_INDEXING_TODO.md` — edge cases, cold start, exclude unification.
- `INDEXED_GREP.md` — original dirty-overlay design (never implemented).
- `LI_QUANTIZATION_STRATEGY.md` — per-token int4 design.
- `CLAUDE.md` — ranking signal format-gating, benchmark methodology,
  no-shortcuts integrity rule.
- `memory/feedback_no_model_coexistence.md` — CPU + GPU mutual exclusion.
- `memory/feedback_format_gate_boosts.md` — format-gating regression evidence.
- `memory/feedback_heldout_discipline_strict.md` — held-out inspection rules.
- `memory/feedback_accuracy_nonnegotiable.md` — MRR regression gate.

---

## 18. Appendix: Decision Log

| Decision | Date | Rationale |
|---|---|---|
| CPU-only for incremental path | 2026-04-17 | GPU lifecycle (5–15 s) >> typical incremental work (< 1 s). See TODO. |
| 60 s reconcile interval | 2026-05-14 | Six times tighter than Cursor's 10 min; CPU encode budget permits. |
| Mutable HNSW + tombstones + async rebuild | 2026-05-14 | Lucene segment-per-graph is overkill at ≤500 K vectors. |
| LI per-segment recompaction, no global rebuild | 2026-05-14 | Per-token int4 (no codebook) makes segment-local recompaction safe. |
| Sparse-gram fast-rebuild vs delta-merge (adaptive) | 2026-05-15 | Fast-tier hardware rebuilds in seconds → just rebuild; slow-tier or large corpus → delta-merge. Auto-selected at daemon startup based on measured wallclock. |
| Watcher opt-in, polling default | 2026-05-14 | Polling alone meets staleness contract; watcher adds complexity. |
| Rebuild executor as separate process | 2026-05-14 (proposed) | Clean GPU lifecycle; no daemon CPU interference. |
| Per-file (not per-chunk) atomicity | 2026-05-14 | Chunks already know their file; per-file commit is the natural unit. |
| Single global epoch, not per-tier | 2026-05-14 | One source of truth for "did the index see this commit?". |
| Float HNSW tombstone watermark = 0.15 (tentative) | 2026-05-14 | Matches Qdrant default; awaits sensitivity study. |
| LI per-segment recompaction watermark = 0.20 | 2026-05-14 | Bounds wasted bitmap scan; awaits validation. |
| Skip HCGS in v1 reconcile | 2026-05-14 | LLM-driven cost dominates encode; revisit later. |
| Skip cross-worktree shared index in v1 | 2026-05-14 | Lockfile alone is sufficient for one-writer model. |
| AST-structural chunk IDs replace positional | 2026-05-15 | Gemini review: positional IDs defeat chunk-hash dedup on insertions. Fix is load-bearing for Phase 1 CPU savings. |
| xxHash3 replaces SHA-256 for content dedup | 2026-05-15 | 15–30 GiB/s vs 1–2 GiB/s; cryptographic strength unnecessary for local dedup. |
| FTS5 explicit `('merge', 16)` per tick + `('optimize')` on rebuild | 2026-05-15 | FTS5 does not auto-compact; daemons bloat GB/week without this. |
| HNSW tombstone-only writes (no live `remove()`) | 2026-05-15 | Eliminates USearch concurrent-remove safety question; aligns with LI / Binary HNSW tombstone model. |
| `PRAGMA synchronous = NORMAL` in WAL mode | 2026-05-15 | Default `FULL` adds 10–30 ms fsync per file commit on common filesystems; blows tick budget at 50 files. |
| WAL checkpoint policy explicit (passive on read, truncate on tick N) | 2026-05-15 | Long-lived MCP reader prevents auto-checkpoint; WAL grows GB without intervention. |
| LSM rebase replays bounded then locks for final swap | 2026-05-15 | Lockless replay-then-swap drops writes in the race window. |
| Resolved exclude array hashed in config fingerprint, not gitignore file | 2026-05-15 | Comment edits to `.gitignore` no longer trigger full reindex; semantic excludes do. |
| Mtime-trap fix: `(mtime, size, inode) !=` not `mtime >` | 2026-05-15 | Equal-mtime within FS resolution makes second write invisible to `>` check. |
| Adaptive tick interval, CPU budget, watermarks by hardware tier | 2026-05-15 | "Works on any machine" mandate — see § 34. |
| Occurrence-indexed anonymous chunk IDs | 2026-05-15 | Gemini 2nd-pass: identical statements in same parent would collide and lose chunks under UPSERT. |
| `epoch_written` column on `vectors` and `entities` | 2026-05-15 | Gemini 2nd-pass: LSM rebase needs an application-level replay log; SQLite WAL is not queryable. |
| USearch capacity managed via `index.reserve()` on exception | 2026-05-15 | Gemini 2nd-pass: tombstone-only writes exhaust `max_elements` monotonically. |
| WAL TRUNCATE is opportunistic, not forcing; MCP must close txns | 2026-05-15 | Gemini 2nd-pass: original draft overclaimed TRUNCATE semantics. |
| FTS5 bounded `('merge', 500)` replaces `('optimize')` | 2026-05-15 | Gemini 2nd-pass: `'optimize'` trips own WAL bloat alarm. |
| BigInt inode via `{ bigint: true }`; stored as JSON string | 2026-05-15 | Gemini 2nd-pass: 64-bit inodes silently truncate to Number on APFS/ZFS/XFS. |
| WSL2 polling-only gated on FS-type, not OS detection | 2026-05-15 | Gemini 2nd-pass: native Linux paths (`/home/user/`) work fine in WSL2. |
| `os.availableParallelism()` replaces manual cgroup parsing | 2026-05-15 | Gemini 2nd-pass: Node 18.14+ handles cgroup v1/v2, affinity, quotas natively. |
| HNSW crash-leak documented as self-healing via rebuild | 2026-05-15 | Gemini 2nd-pass: `add()` is not idempotent; rebuild is the GC. |
| Noise floor defined as ±0.005 absolute MRR | 2026-05-15 | Gemini 2nd-pass: previously undefined; AVX2/NEON jitter alone exceeds 0.001. |
| Held-out validation pulled out of iterative phases | 2026-05-15 | Gemini 2nd-pass: original § 24.6 violated `feedback_heldout_discipline_strict`. |
| `tree_sitter_error_nodes_seen` telemetry added | 2026-05-15 | Gemini 2nd-pass: mid-edit syntax errors produce garbage entities; need observability. |

---

## 19. Query-Side Contract (per search tool)

The reconcile design is half of the system; the other half is how each of
the six search tools **reads** the state during a query. Each tool has a
different sensitivity to staleness and a different right-thing-to-do when
it encounters a tombstoned row.

| Tool | Reads | Tombstone behavior | Staleness shown to user |
|---|---|---|---|
| `auto` (default `SweetSearch.search`) | All five indices via hybrid fusion | Filter at fusion boundary, after RRF; drop tombstoned rows before MMR | Yes — `--show-staleness` flag |
| `structural` | code-graph entities + relationships only | Filter rows with `stale_since IS NOT NULL`; resolve cross-file refs at query time | No (cheap to check on demand) |
| `read` | `CodebaseRepository` + disk | Always reads disk; no index staleness possible | n/a |
| `read-semantic` | LI segments + vectors for span ranking | Stale bitmap honored during posting-list walk; spans recomputed from disk text | Yes — explicit warning if span source mtime is newer than index epoch |
| `colgrep` | ripgrep (disk) + LI rerank | ripgrep is always fresh; LI rerank skips tombstoned doc IDs | n/a (ripgrep side is live) |
| `indexed-grep` | sparse-gram artifact + FTS5 trigram | Sparse-gram rebuilt every dirty tick (no tombstones needed); FTS5 has no tombstones (SQLite manages) | Minor — `--show-staleness` |

**Critical rule.** A tool that reads multiple tiers (`auto`, `read-semantic`)
must filter tombstones **after** scoring/fusion, not before. Filtering before
biases candidate selection toward tiers with fewer tombstones; filtering
after preserves the ranking signal and only removes dead rows from the
visible output. This is the Lucene `liveDocs` pattern at the search engine
layer rather than the segment layer.

### 19.1 Staleness display

CLI output adds an optional footer (off by default; on with `--show-staleness`
or when `staleness > threshold`):

```
results...
─────────
index epoch: 12847   age: 23s   dirty files: 2   last rebuild: HNSW 4m ago
```

Three-tier alert:
- **green** (< 60 s, 0 dirty): hidden
- **yellow** (60–300 s, or < 5 dirty): one-liner footer
- **red** (> 300 s, or > 5 dirty, or rebuild-queue backlog): explicit warning

Inspired by Cursor's missing staleness signal (community complaint vector);
worth the bytes.

---

## 20. Telemetry, Observability, Operator Surface

### 20.1 Metrics emitted per tick

JSON line per tick to `.sweet-search/reconcile-metrics.jsonl` (rotated daily):

```json
{
  "ts": 1763097600.123,
  "epoch": 12847,
  "tick_ms": 412,
  "dirty_paths_seen": 18,
  "content_unchanged": 12,
  "files_processed": 6,
  "chunks_total": 48,
  "chunks_encoded": 7,
  "chunks_hash_reused": 41,
  "chunks_struct_stable": 36,
  "tree_sitter_error_nodes_seen": 2,
  "tree_sitter_files_with_errors": 1,
  "ops_per_tier": {
    "graph_upsert": 6, "graph_tombstone": 1,
    "vectors_upsert": 7, "vectors_delete": 3,
    "hnsw_add": 7, "hnsw_tombstone": 3,
    "hnsw_capacity_used": 0.42,
    "binary_hnsw_tombstone": 3, "binary_hnsw_append": 7,
    "li_segment_append": 7, "li_tombstone": 3,
    "sparse_gram_rebuild": 1,
    "fts5_merge_calls": 2
  },
  "watermarks": {
    "hnsw_tombstone_fraction": 0.082,
    "binary_hnsw_dead_doc_ratio": 0.11,
    "li_segments_over_threshold": [],
    "fts5_segment_count": 23
  },
  "wal": {
    "code_graph_db_wal_bytes": 41943040,
    "codebase_db_wal_bytes": 18874368,
    "last_passive_checkpoint_ms_ago": 6014,
    "last_truncate_attempted_ms_ago": 600100,
    "last_truncate_busy": false
  },
  "rebuild_jobs_enqueued": 0,
  "cpu_budget_used_ms": 380,
  "cpu_budget_total_ms": 2000
}
```

The `tree_sitter_error_nodes_seen` field surfaces a risk noted by the
second-pass review: edits saved mid-keystroke produce syntactically
invalid source. Tree-sitter recovers and extracts entities anyway, but
the entities may be garbage. The metric exists so operators (and CI)
can detect a daemon that is repeatedly indexing broken code — a signal
to lengthen the watcher debounce or tick interval. Alert if the
running 1-hour average of `tree_sitter_files_with_errors / files_processed`
exceeds 0.05.

### 20.2 Operator CLI surface

| Command | Purpose |
|---|---|
| `sweet-search reconcile status` | Show current epoch, dirty count, watermark distances, last 5 ticks |
| `sweet-search reconcile tick` | Force one tick (synchronous), useful in CI |
| `sweet-search reconcile inspect <path>` | Show why a path is dirty (hash diff, last seen epoch) |
| `sweet-search reconcile pause` / `resume` | Pause the daemon timer without killing it |
| `sweet-search reconcile reset` | Drop dirty set, force full mtime sweep on next tick |
| `sweet-search rebuild status` | Show rebuild queue, last completion, dead-letter count |
| `sweet-search rebuild force <tier>` | Schedule immediate rebuild of `hnsw` / `binary-hnsw` / `li` / `sparse-gram` |
| `sweet-search rebuild dead-letter [--clear]` | Inspect or clear the dead-letter queue |
| `sweet-search index --add <path>` | Hint a file as dirty (writes to JSONL queue) |
| `sweet-search index --full` | Force full reindex (the existing `npm run index`) |

### 20.3 Logging

- Per-tick INFO line summarizing the metric JSON above
- Per-file DEBUG when `SWEET_SEARCH_RECONCILE_DEBUG=1`
- WARN on: dirty-set growth above threshold, ENOSPC, rebuild dead-letter,
  lock contention, watermark crossing, GPU armed/torn down
- ERROR on: per-tier write failure, corrupted state file, schema mismatch

Logs go to `.sweet-search/logs/reconcile-YYYY-MM-DD.log` with 7-day retention.

---

## 21. Configuration Schema

### 21.1 Environment variables

Defaults marked **adaptive** are computed at daemon startup from the
detected hardware tier (see § 34). All can be overridden.

| Variable | Default | Purpose |
|---|---|---|
| `SWEET_SEARCH_RECONCILE_INTERVAL` | adaptive (30–180 s by tier; 60 s nominal) | Tick interval; min 10s, max 600s |
| `SWEET_SEARCH_RECONCILE_CPU_BUDGET_MS` | adaptive (~250 ms × physical_cores, capped at 4000) | Soft cap per tick |
| `SWEET_SEARCH_RECONCILE_FILES_PER_TICK` | adaptive (10–200 by tier) | Hard cap on files processed per tick |
| `SWEET_SEARCH_RECONCILE_DEBUG` | `0` | Verbose per-file logging |
| `SWEET_SEARCH_WATCH` | `0` | Enable Rust notify watcher (opt-in) |
| `SWEET_SEARCH_WATCH_DEBOUNCE_MS` | `200` | Watcher event coalescing window |
| `SWEET_SEARCH_DAEMON` | `0` | Run as long-lived daemon vs one-shot |
| `SWEET_SEARCH_REBUILD_NICE` | `10` (Unix) / `BELOW_NORMAL` (Win) | OS-priority knob for CPU rebuilds |
| `SWEET_SEARCH_HNSW_TOMBSTONE_THRESHOLD` | `0.15` | Float HNSW rebuild trigger |
| `SWEET_SEARCH_BINARY_HNSW_DEAD_THRESHOLD` | `0.30` | Binary HNSW rebuild trigger |
| `SWEET_SEARCH_LI_SEGMENT_STALE_THRESHOLD` | `0.20` | LI per-segment recompaction trigger |
| `SWEET_SEARCH_FTS5_MERGE_PAGES` | `16` | FTS5 incremental merge fan-in per tick |
| `SWEET_SEARCH_FTS5_OPTIMIZE_SEGMENT_THRESHOLD` | `64` | Trigger full `'optimize'` when segment count exceeds |
| `SWEET_SEARCH_WAL_CHECKPOINT_EVERY_N_TICKS` | `60` | Force TRUNCATE checkpoint cadence |
| `SWEET_SEARCH_WAL_SIZE_WARN_MB` | `256` | WAL bloat warning threshold |
| `SWEET_SEARCH_MAX_FILE_BYTES` | `1048576` | Skip files larger than 1 MiB (existing) |
| `SWEET_SEARCH_MAX_REPO_FILES` | adaptive (50K–500K by tier; warn at 50% cap) | Hard cap; Cursor freezes ≈400 k |
| `SWEET_SEARCH_MEM_BUDGET_FRACTION` | `0.05` | Daemon RSS cap as fraction of system RAM (default 5%) |
| `SWEET_SEARCH_HASH_ALGORITHM` | `xxhash3` | Override to `sha256` for compliance/auditing |
| `SWEET_SEARCH_TIER_OVERRIDE` | (auto) | Force `low`, `mid`, `high`; bypasses detection |

### 21.2 `.sweet-search.config.json` additions

```json
{
  "reconcile": {
    "intervalMs": 60000,
    "cpuBudgetMs": 2000,
    "filesPerTick": 50,
    "watch": false,
    "watchDebounceMs": 200,
    "watermarks": {
      "hnswTombstoneFraction": 0.15,
      "binaryHnswDeadRatio": 0.30,
      "liSegmentStaleRatio": 0.20
    },
    "rebuild": {
      "useGpuWhenIdle": true,
      "minFilesForGpuArm": 20,
      "niceLevel": 10
    },
    "showStaleness": "auto"
  }
}
```

Config changes that mutate watermarks or interval **do not** trigger a full
reindex (they don't affect index content). Config changes that mutate
`exclude`, `respectGitignore`, or model selection **do** trigger one
(existing fingerprint behavior).

---

## 22. Filesystem Reality (Edge Cases)

These are the failure modes that production systems hit and either
documented or got bitten by. We pre-empt them.

### 22.1 File renames

`mv foo.ts bar.ts` produces, in event order:
- Linux inotify: `MOVED_FROM foo.ts`, `MOVED_TO bar.ts` with shared cookie.
- macOS FSEvents: directory-level event; tool walks dir to find diff.
- Editor "atomic save": `WRITE foo.ts.tmp`, `RENAME foo.ts.tmp → foo.ts`.

**Detection.** Content-hash dedup is the answer: if a "new" file's content
hash matches a "deleted" file's content hash, treat as rename — preserve the
existing entity IDs / vector keys, update file_path only. Else treat as
add + delete.

**Why this matters.** The `entities.id = sha256(file:type:name)` keying
means a rename WITHOUT the dedup would change every entity's ID, exploding
the diff. The dedup keeps entity IDs stable across renames.

### 22.2 Symlinks

- Symlinks **into** the indexed tree: follow once, do not re-enter to avoid
  cycles. Use `realpath` for canonical key.
- Symlinks **out of** the indexed tree: skip (don't index external content
  silently).
- Symlink targets that change without the symlink itself touching: detected
  via target's mtime sweep (we walk targets, not symlinks).
- Cycles: `realpath` set; detect repeat → skip with warning.

### 22.3 Submodules

`.gitmodules` submodules under the indexed root are treated as separate
repos (skipped by default; opt-in via `.sweet-search.config.json` `submodules: true`).
Independent submodule history means their `git common-dir` is different and
their content lifecycle is independent of the parent.

### 22.4 Case-insensitive filesystems

macOS APFS, Windows NTFS: `Foo.ts` and `foo.ts` are the same file but
different paths. Keep paths canonicalized via `realpath` (which normalizes
case on these filesystems); compute content hashes from the resolved path.

Watch out for: a git checkout that renames `Foo.ts` → `foo.ts`. On
case-insensitive FS, this looks like a no-op file event; content hash is
unchanged, but the canonical path may not be (depends on FS behavior).
Defensive: re-resolve canonical paths during mtime sweep.

### 22.5 Atomic file replacement (editor save semantics)

vim default, JetBrains "safe write", VS Code with `files.useExperimentalFileWatcher`:
write `.foo.swp.tmp` → `rename` over `foo.ts`. Watcher sees:
- `CREATE .foo.swp.tmp`
- `WRITE .foo.swp.tmp` (possibly many)
- `RENAME → foo.ts`
- `DELETE foo.ts` (the original inode)

Naive processing re-encodes the temp file then the real one. **Mitigation:**
in the watcher debounce window (200 ms default), suppress events for paths
matching common temp-file patterns (`.*\.swp$`, `.*\.tmp$`, `~$.*`, etc.),
and emit only after a quiet period.

### 22.6 Very large files

`SWEET_SEARCH_MAX_FILE_BYTES=1048576` (1 MiB) skips e.g. minified JS
bundles, large fixture JSONs, generated SQL dumps. Already enforced;
make sure the reconcile path honors the same limit (otherwise a generated
file changing every commit will pin the dirty set).

### 22.7 Binary files

Heuristic: first 8 KiB has more than 10 % bytes outside printable ASCII +
common whitespace → binary, skip. Already handled by indexer; ensure
reconcile uses the same check.

### 22.8 File deletion vs file move

A `DELETE` event with no matching `CREATE` of identical content within the
debounce window: process as deletion. Mark all entities/vectors/LI docs
for that file as stale_since=now. They prune after 30 days.

### 22.9 Many tiny files (Cursor's 400 k file freeze)

Hard cap at 200 k indexed files; warn (and offer ignore patterns) at 100 k.
The cap protects against `node_modules` slipping past the deny-list.

### 22.10 NFS / network filesystems

Out of scope. mtime semantics are unreliable; content hashing works but
performance tanks. Document as unsupported.

---

## 23. Rejected Alternatives (and why)

Each of these came up in research; each is wrong for sweet-search at this
scale. Documenting so the next author doesn't relitigate.

| Alternative | Origin | Why rejected |
|---|---|---|
| **Per-save hooks** (re-index on every editor save) | Naive default | Save-all storms, format-on-save, branch switches saturate CPU. User explicitly rejected. |
| **Lucene segment-per-graph for HNSW** | Lucene 9+ | Adds per-segment query tax at small scale. Mutable graph + tombstones is cleaner at ≤500 K. |
| **PLAID-style shared k-means codebook** | ColBERTv2/PLAID | Centroid drift problem (PLAID-SHIRTTT). Sweet-search's per-token int4 avoids this entirely. |
| **PLAID-SHIRTTT hierarchical re-clustering** | SIGIR '24 | Solves the centroid drift we don't have. Adds complexity for nothing. |
| **Vespa-style fully mutable HNSW, no rebuilds** | Vespa | At ≤500 K vectors per repo even the slowest supported hardware tier can rebuild in minutes, not hours. Periodic compaction beats Vespa's "edit forever, never rebuild" once the rebuild is cheap. |
| **Cursor's full Merkle tree** | Cursor blog | Their tree is for client/server reconciliation across an untrusted boundary. Local single-process can use per-file hashes directly. (Could revisit if we ever ship a CDN-cached index.) |
| **Glean's stacked DBs / overlay** | Glean (Meta) | The stacked-DB abstraction shines at fanout (header touches 100 TUs). We don't have C++ #include-style fanout in the index — files are independent units. |
| **JetBrains Shared Indexes CDN** | JetBrains | Pre-built indexes for common dependencies. Compelling for npm packages but a v2 feature; out of v1 scope. |
| **SCIP as the structural format** | Sourcegraph | Worth doing for interop (Searchfox, Glean), but doesn't change the reconcile design. Track as separate workstream. |
| **Aider's per-prompt repo-map** | Aider | Zero staleness but high per-query cost. Wrong tradeoff for tools that re-query frequently. |
| **Claude Code's no-index agentic-grep** | Anthropic | Token cost is the problem (Milvus measured 40 % waste). Sweet-search's selling point is fast pre-indexed retrieval; pivoting away defeats the purpose. |
| **Per-tier independent schedule** | Naive optimization | Tier disagreement on "is this entity still present?" jitters MRR. Single epoch dominates. |
| **Hot-on-write merge (Lucene NRT)** | Near-Real-Time search | Tied to per-save hooks model. Same rejection. |
| **In-process watcher only, no polling** | Pure watcher design | Inotify limits, FSEvents glitches, missed events. Polling is the correctness backstop. |
| **No rebuild ever, only tombstones** | Naive LSM analog | Recall decays after ~20 % tombstones (arXiv:2407.07871). Bounded by rebuilds. |
| **Single shared HNSW with repo-id filter** | Multi-tenant pattern | Sweet-search is single-repo per `.sweet-search/` dir. No multi-repo coordination problem to solve. |
| **Encoder-on-demand at query time** | RAG retrieval style | Defeats the cached-embedding speedup. Encode at index time, search at query time. |

---

## 24. Test Strategy

### 24.1 Unit tests

- `Reconciler.diffEntities(file, oldRows, newParse)` → expected upserts/tombstones
- `Reconciler.chunkHashes(file, content)` → stable across format-only edits
- `Reconciler.applyHNSWDelta` with synthetic ops → expected USearch state
- Watermark evaluator → expected rebuild-queue contents

### 24.2 Integration tests

- Fresh repo → first tick produces full state (cold-start replay)
- Empty repo → empty-but-valid state (TODO § Empty codebase)
- Edit one file → reconcile → search returns new content (E2E)
- Touch one file (no content change) → reconcile no-ops
- Rename file → entity IDs preserved, paths updated
- Delete file → tombstones across all five tiers
- Branch switch → many files dirty; content-hash dedup → most are no-ops
- Config change to excludes → exclude-diff applied bidirectionally
  (per TODO § Exclude unification)

### 24.3 Structural invariance (§ 12.3)

Already specified; the gating CI test.

### 24.4 Soak

- 24-hour run with simulated edit pattern (1 file every 5 s, occasional
  burst of 50 files); assert: tick latency P99 < 5 s, memory steady,
  rebuild queue drains.

### 24.5 Chaos

- Kill the daemon mid-tick → next start recovers state
- Truncate `merkle-state.json` → falls back to full reindex
- Fill disk during stage → abort cleanly, old artifact preserved
- ENOSPC from inotify → fallback to polling
- Watcher floods with 100 k events in 1 s → dirty set bounded, no OOM

### 24.6 A/B validation (dev vs held-out discipline)

Per CLAUDE.md and `memory/feedback_heldout_discipline_strict.md`, the
held-out set is **one-shot, end-of-phase, aggregate-only**. Iterative
validation that informs threshold choices (tombstone watermark,
recompaction trigger, etc.) **must** run on dev.

**Phase-by-phase contract:**

| Phase | A/B validation pair | Run on |
|---|---|---|
| Phase 1 (chunk-hash, encode-skip) | cold-rebuild vs reconcile-from-cold | **dev** |
| Phase 1 (chunk-hash, encode-skip) | cold-rebuild vs reconcile-after-1-edit | **dev** |
| Phase 2 (unified tick) | reconcile-v1 vs reconcile-v2 with 50-edit trace | **dev** |
| Phase 3 (watermarks + rebuild) | pre-watermark vs post-rebuild | **dev** |
| Phase 5 (tombstone sensitivity) | sweep N∈{5,10,15,20,25,30}% tombstones | **dev** |
| End of Phase 6 (production-hardening complete, all thresholds locked) | full reconcile pipeline vs cold rebuild, with the 50-edit trace | **held-out** (one-shot) |

The held-out run at end of Phase 6 is the final sanity check before
merging to `main`. If it fails, the team must **not** tune thresholds
against the held-out failure — that contaminates the set. The correct
response is to investigate the underlying mechanism on a new
hand-crafted probe set, then either (a) reset to the previous merge
commit and design forward, or (b) accept the regression as a known
limitation and document it. Never tune to held-out.

### 24.7 Property-based / fuzz

- Random edit traces (mix of write, rename, delete, branch-switch) →
  state converges to same content as a full reindex from final state.
  This is the "eventual consistency" property; verify with seeded random
  traces (seed=42 per CLAUDE.md benchmark discipline).

---

## 25. Rollout & Migration

### 25.1 Feature flag

`SWEET_SEARCH_RECONCILE_V2=1` enables the new reconcile path. Default off
for the first release; the existing daemon continues to run unchanged.

### 25.2 STATE_VERSION bump

Current: `'2.3'`. New: `'3.0'`.

Old state files are **not** auto-migrated. On detect-mismatch:
- One-shot CLI: log "incremental state from older version; running full
  reindex" and proceed.
- Daemon mode: same, but emit a single warning to operator.

This is consistent with existing `incremental-tracker.js` behavior; only
the version string changes.

### 25.3 SSLX format version

Stale-bitmap sidecar requires changes to SSLX consumers. Two options:

- **(A) SSLX v3 with companion `.stale.bin`.** No SSLX format change;
  the bitmap is a separate file. Reader checks bitmap before doc; if
  bitmap absent, treats all docs as live. Backward-compatible. **Recommended.**
- **(B) SSLX v4** with bitmap embedded in header. Cleaner long-term;
  forces all consumers to upgrade. Defer.

### 25.4 Dual-read window

Not needed for v1: the migration is "drop old state, full rebuild on new
version." Encoder model upgrades will need a dual-read window later, but
that's a separate workstream.

### 25.5 Rollback

If reconcile-v2 ships and regresses: set `SWEET_SEARCH_RECONCILE_V2=0`,
re-run `npm run index` to rebuild state in v1 format. Document explicitly.

### 25.6 Phased flag rollout

- **Week 1:** flag off; reconcile-v2 code lands behind flag; one author
  uses it locally.
- **Week 2:** flag opt-in for power users; held-out GCSN runs nightly to
  catch regressions.
- **Week 3:** flag on by default; v1 daemon remains as fallback (kept
  for one release cycle).
- **Week 4+:** v1 daemon removed if no regressions observed.

---

## 26. Cross-Platform Notes

### 26.1 macOS (primary target)

- FSEvents via `notify` crate. Coalesces aggressively at the OS level.
- APFS case-insensitive by default; canonicalize via `realpath`.
- No inotify limits; no special handling needed.
- Known glitch: FSEvents stream can drop events under load; mtime sweep
  is the backstop.

### 26.2 Linux

- inotify via `notify` crate. Per-user limit default 524 288; large
  monorepos with `node_modules` hit this.
- On ENOSPC: log clear remediation (`sysctl fs.inotify.max_user_watches`),
  fall back to polling for affected subtree.
- ext4/btrfs case-sensitive; no canonicalization issue beyond resolving
  symlinks.

### 26.3 Windows

- Out of v1 scope. `notify` supports `ReadDirectoryChangesW`; correctness
  is achievable, but the sweet-search team has no current Windows users
  per memory. Polling-only fallback should still work.

### 26.4 WSL2

- Crosses the Windows ↔ Linux boundary; inotify reliability is poor.
  Polling-only mode recommended. Document.

---

## 27. MCP & Multi-Reader Concurrency

Sweet-search exposes an MCP server (via aqe-mcp). Three reader classes
can coexist:

1. **CLI** (`sweet-search auto "query"`) — short-lived process; loads
   index, executes query, exits.
2. **MCP server** (long-lived; agents call tools via stdio).
3. **Daemon** (`index-maintainer.mjs`, the writer).

### 27.1 Reader concurrency

USearch, SQLite (WAL), SSLX, and the Rust sparse-gram artifact all
support concurrent readers + single writer. The existing model is correct;
no changes needed.

### 27.2 MCP server cache invalidation

The MCP server caches loaded indices in memory for low-latency reuse.
When the daemon commits a new epoch, MCP must reload. Mechanism:

- MCP polls `merkle-state.json::epoch` once per query. If changed, reload
  per-tier artifacts. Cheap (single JSON read).
- Alternative: file-watcher on `merkle-state.json` to push invalidation.
  More complex; defer.

### 27.2.1 MCP and SQLite WAL discipline (mandatory)

The MCP server is the canonical "long-lived reader" pathology for SQLite
WAL. SQLite checkpointing is cooperative (see § 8.4): the writer cannot
force a misbehaving reader to release its snapshot. The MCP server
therefore **owns** the WAL-growth-prevention contract. Required rules:

1. **No long-lived read transactions across queries.** Either:
   - (a) Use the higher-level driver's "implicit short transaction"
     mode where each `prepare → step → finalize` is its own
     auto-committed read transaction, OR
   - (b) Explicitly `BEGIN DEFERRED` + `COMMIT` per query.
   What the MCP server must **never** do: open a connection, run
   `BEGIN`, then leave the connection idle between queries while
   keeping the transaction open. This is the single most common WAL
   bloat root cause.
2. **Periodic `wal_checkpoint(PASSIVE)` self-call** between queries
   (every N queries or every M seconds, whichever first; defaults
   N=100, M=60s). `PASSIVE` never blocks; it advances the frontier
   when possible. Does not require the txn to be closed but does
   require no other connection to be in the middle of writing.
3. **Connection rotation as a safety net.** Every 1 hour OR every
   10 000 queries (whichever first), the MCP server closes its
   read connection and opens a fresh one. Cheap (sub-ms on local
   SQLite) and guarantees no stale snapshot can be held longer than
   the rotation interval. Insurance against bugs that leave a txn
   open accidentally.
4. **Expose `wal_size_bytes` in the MCP `/health` endpoint** so an
   external monitor can detect MCP-side WAL leaks even if the daemon
   itself can't.

If the MCP server is not maintained by the sweet-search team (third-party
binding), document these rules in the MCP integration guide and
fail-loudly: if the daemon detects WAL > 1 GiB for > 10 minutes, log
ERROR and emit a one-time warning to stderr identifying the likely
culprit pid.

### 27.3 Can the MCP server BE the daemon?

Tempting (one process, one lock, low overhead). Rejected for v1 because:
- MCP needs query latency predictability; reconcile work would compete
  for the same node thread.
- MCP lifecycle is tied to the agent session; daemon should outlive it.
- Separate processes = clean GPU lifecycle management.

Possible v2: spawn a node worker thread inside MCP for reconcile. Defer.

---

## 28. Native Indexer Integration

The Rust native binary (`crates/sweet-search-native/`) currently owns the
sparse-gram build. Future work pulls more of the indexer into Rust for
speed (per `memory/feedback_cli_latency.md`).

Reconcile design must be **language-agnostic at the boundary**:

- Per-tier write methods accept opaque deltas (entity rows as bytes,
  vector keys as u64, etc.). Either Node or Rust can produce them.
- State files (`merkle-state.json`, `rebuild-queue.jsonl`) use stable
  JSON or NDJSON formats consumable from both.
- The reconcile **timer** stays in Node for v1 (daemon is .mjs); future
  port to Rust is a refactor, not a redesign.

---

## 29. Memory & Disk Budgets

### 29.1 Memory (portable budgets)

Memory budgets are **expressed as fractions of system RAM**, not absolute
numbers, so the daemon scales gracefully from a 4 GiB Chromebook to a
256 GiB workstation.

- **Daemon RSS budget**: `max(256 MiB, 0.05 × total_system_ram)`. Override
  with `SWEET_SEARCH_MEM_BUDGET_FRACTION`. Above 1.5× budget triggers a
  warning; above 2× triggers self-restart (memory-leak insurance). On a
  4 GiB machine the budget is 256 MiB (the floor); on a 128 GiB machine
  it is 6.4 GiB. The daemon does its best to stay under but does not
  hard-fail above.
- **Dirty set**: bounded at `min(100 K, total_files × 2)` paths; above →
  drop to pure mtime-sweep for the next tick and warn.
- **Encoder pool**: existing pool sizing remains. On low-RAM machines
  the existing pool already self-limits via batch-size knobs; verify
  the reconcile path inherits the same limits.
- **HNSW heap during rebuild**: 500 K × 512-dim float32 ≈ 1 GiB of
  vectors plus ~30 % graph overhead = ~1.3 GiB. On tier-low hardware
  (4–8 GiB RAM) this is a meaningful share — the rebuild scheduler
  must check `available_ram > 1.5 × estimated_rebuild_footprint`
  before arming; otherwise defer with reason `mem_pressure`.
- **mmap residency**: artifacts are mmap'd. The OS handles eviction
  under memory pressure; sweet-search does not pin pages. Verify
  `madvise(MADV_RANDOM)` is set on the HNSW mmap (the access pattern
  is graph-random, not sequential).

### 29.2 Disk

- Tombstone bitmaps: 1 bit per doc; at 1 M docs = 128 KiB per tier.
  Negligible.
- `reconcile-metrics.jsonl`: ~1 KiB/tick = ~1.4 MiB/day; daily rotation,
  7-day retention.
- `index-maintainer-queue.jsonl`: bounded by daemon's consume rate; dead
  letter has 100-entry cap.
- Logs: 7-day rotation; ~10 MiB/day worst case.

### 29.3 Disk usage at rebuild time

Rebuild stages to `*.next`, then renames. Peak disk usage during rebuild
is 2× the tier's steady-state. Float HNSW at 500 K × 512-dim float32 ≈
1 GiB; binary HNSW ≈ 256 MiB; LI segments ≈ as-is. Worst-case 4–5 GiB
peak during a multi-tier rebuild.

**Portability constraint.** Before staging a rebuild, the scheduler
must check available disk space: require `free_disk > 3 × tier_size`
(stage + room for fsync + safety margin). On constrained machines
(e.g., a laptop with 30 GiB free), the rebuild is deferred and logged
to dead-letter with reason `disk_full`; user must free space or run
`sweet-search rebuild force <tier>` after cleanup. **Never** silently
overwrite the live artifact mid-rebuild.

The cold full-index also benefits from this check; add to
`indexer-utils.js` and reuse.

---

## 30. Security

### 30.1 Path traversal

- All user-supplied paths (from `--add` flag, JSONL queue, etc.) must
  resolve via `realpath` and be within `projectRoot`. Reject otherwise.
- Existing check in `core/cli.js`; ensure reconcile path enforces same.

### 30.2 Symlink escape

Covered in § 22.2. Don't follow symlinks out of the indexed tree.

### 30.3 Untrusted repos

If sweet-search is run on cloned-but-unaudited code:
- No code execution from the indexed content (we parse, we don't run).
- tree-sitter grammars are sandboxed (WASM where possible per
  `tree-sitter-provider.js`).
- `.sweet-search.config.json` from an untrusted repo could specify
  malicious exclude patterns or model overrides. **Mitigation:** ignore
  in-repo config files; trust only the user's home or explicit `--config`.
  (Implementation: existing `loadProjectConfig` reads from `projectRoot`;
  add a "trust" flag and default-off for untrusted invocations. Document.)

### 30.4 Secrets in committed files

If a secret ends up in a tracked file (it shouldn't, but happens), it
ends up in the index. Reconcile doesn't change this exposure surface; the
existing `.sweet-search.config.json` exclude list covers common secret
filenames (`.env`, `*.pem`, etc.). Keep.

---

## 31. Production-System Quick Reference

For future readers who need to remember which system does what without
re-running the research swarm:

| System | Trigger | Cadence | Granularity | Index types |
|---|---|---|---|---|
| Cursor | Merkle reconcile | 10 min | AST chunk | embeddings only |
| Cody (2024+) | Open-file + remote | Live local / poll remote | Snippet/Jaccard | BM25 + (no local embeddings) |
| Continue.dev | On open + manual | Per session | ~10-line block | LanceDB + SQLite |
| Copilot Chat | First chat + push | Server-driven | chunk | server BM25 + embeddings |
| Windsurf | Watcher + on-save | Live | AST chunk | dense + co-edit graph |
| Aider | Per-prompt | Per query | Symbol | Tree-sitter, no embed |
| Claude Code | Per-tool call | Live | File/line | None (grep + read) |
| Tabby ML | Cron / manual | Hours | tree-sitter chunk | BM25 + embed |
| JetBrains | VFS events | Live | File/symbol/PSI | Inverted + stub + semantic |
| Zoekt | Pull poll + push | 8h merge / 2min poll | Trigram per shard | trigram + LSIF/SCIP |
| **Sweet-search (this plan)** | **Hybrid watcher + 60 s tick** | **60 s** | **Per-file content-hash + per-chunk hash** | **All 5 lock-step** |

---

## 32. Glossary

- **Epoch** — monotonically increasing reconcile generation counter.
- **Tick** — one execution of the reconcile loop.
- **Dirty set** — in-memory set of paths suspected of having changed.
- **Watermark** — per-tier threshold that triggers an async rebuild.
- **Tombstone** — soft-delete marker; row still on disk, hidden from queries.
- **Centroid drift** — k-means quantization quality decay as new data
  arrives. Not applicable to sweet-search (no shared codebook).
- **Per-token int4** — sweet-search's quantization: each token has its
  own min/scale, no global codebook. Load-bearing for safe incremental LI.
- **SSLX** — sweet-search's late-interaction segment binary format (v3).
- **Reconcile** — the periodic work that drains the dirty set and updates
  all five indices.
- **Live path** — the per-tick cheap update path (UPSERT, append, tombstone).
- **Rebuild path** — the async expensive path that produces a fresh
  artifact and atomically swaps it in.
- **Live doc / stale doc** — LI segment doc whose tombstone bit is unset / set.
- **content-hash** — SHA-256 truncated to 16 chars, computed over file bytes.
- **chunk-hash** — same, but computed over chunk text after chunker output.

---

## 33. Phase 1 Pre-Merge Checklist

A concrete merge bar for the first PR (Phase 1 — chunk-content-hash &
encode-skip from § 13):

- [ ] Schema migration on `codebase.db`: `chunk_struct_id`,
  `chunk_text_hash`, and `epoch_written` columns added; index on
  `epoch_written` created; tested with existing index (auto-migrates;
  old positional `chunk_id` preserved).
- [ ] Schema migration on `code-graph.db::entities`: `epoch_written`
  column + index added.
- [ ] xxHash3 dependency added; `HASH_ALGORITHM` switch in place; SHA-256
  fallback verified for the compliance/audit override path.
- [ ] AST chunker emits stable `chunk_struct_id` for both symbol-attached
  and anonymous chunks. Unit tests cover **five** stability cases:
  whitespace-only edit, top-of-file insert, function rename, **two
  identical statements in same parent (occurrence-index disambiguation)**,
  and **rename of one of two identical statements** (the renamed one
  gets a new ID; the other keeps its `_0` suffix).
- [ ] `fs.statSync(path, { bigint: true })` used in
  `incremental-tracker.js`; inode stored as string in
  `merkle-state.json`; comparison test on a synthetic
  `inode > 2^53` filesystem (use APFS where available).
- [ ] `STATE_VERSION` bumped to `'3.0'` only after Phase 2 lands; Phase 1
  stays at `'2.3'`.
- [ ] Encode-skip path implemented in `indexer-build.js`; coverage test
  shows zero encodes on whitespace-only edit.
- [ ] Per-tick counter exposed in metrics JSON.
- [ ] GCSN dev MRR runs green vs `pre-incremental-reconcile-baseline`.
- [ ] Locked probe packs (retrieval-probes, ast-tester-probes,
  structural-redo) run green.
- [ ] Held-out GCSN aggregate run at milestone (only after dev passes).
- [ ] No regressions on the existing structural-redo tests.
- [ ] One author has run with `SWEET_SEARCH_RECONCILE_V2=1` for ≥ 24 h on
  a real workload.
- [ ] PR description includes:
  - link to this plan
  - which sections were touched
  - benchmark deltas
  - any open questions deferred

This is the same shape of merge gate used for the `ss-search` Phase 6 v2
audit and structural P6 redo work; reuse the rubric.

---

## 34. Hardware Portability & Adaptive Defaults

Sweet-search must run on:

- a four-core 8 GiB laptop with a SATA SSD,
- an eight-core 32 GiB developer machine with NVMe,
- a 16+-core 64+-GiB workstation with NVMe (Apple Silicon, Threadripper,
  Xeon — same envelope),
- CI runners (2–4 cores, ephemeral disk, no GPU),
- container/sandbox environments with restricted resources,
- WSL2 boundaries (Linux semantics, Windows-backed FS),

with the same correctness contract. Performance scales with available
resources; correctness does not. This section defines how.

### 34.1 Hardware tier detection

At daemon startup, the reconciler probes:

| Signal | Source |
|---|---|
| Physical core count | `os.cpus().filter(c => c.model !== 'efficiency').length` on Apple Silicon (P-cores only); `os.cpus().length` otherwise. Override with `physical-cpu-count` heuristic. |
| Logical core count | `os.cpus().length` |
| Total RAM | `os.totalmem()` |
| Available RAM | `os.freemem()` plus a buffer cache estimate |
| Storage class | Synthetic 4 KiB random-read benchmark against `.sweet-search/` for 100 ms; classify as `nvme` (≥ 50 K IOPS), `ssd` (5–50 K IOPS), or `hdd` (< 5 K IOPS) |
| GPU presence | Existing `shouldArmGpu()` check |
| ARM SHA / SHA-NI | Probe via Node `crypto.getHashes()` + microbench on 1 MiB |
| OS / kernel | `os.platform()`, `os.release()` |
| Filesystem type | `statfs()` where available (Linux); on macOS check `df -T` parse |
| inotify limits (Linux) | Read `/proc/sys/fs/inotify/max_user_watches` |

Tier classification:

| Tier | Approx profile | Examples |
|---|---|---|
| **low** | ≤ 4 physical cores AND/OR ≤ 8 GiB RAM AND/OR HDD/slow-SSD storage | older laptops, free CI tiers, constrained containers |
| **mid** | 4–12 physical cores AND 8–32 GiB RAM AND SATA-SSD-or-better | typical developer machines |
| **high** | ≥ 12 physical cores AND ≥ 32 GiB RAM AND NVMe | workstations, beefy laptops |

Override via `SWEET_SEARCH_TIER_OVERRIDE=low|mid|high`. Detection result is
logged at startup and cached in `merkle-state.json::hw_tier` (informational;
re-probed on next startup).

### 34.2 Adaptive defaults by tier

| Parameter | low | mid | high | Notes |
|---|---|---|---|---|
| `reconcile_interval` | 180 s | 60 s | 30 s | Tighter on faster machines |
| `cpu_budget_ms` | 500 | 2000 | 4000 | ~250 ms × physical_cores, capped |
| `files_per_tick` | 10 | 50 | 200 | Bounds per-tick work |
| `chunks_per_encode_batch` | 8 | 32 | 64 | Encoder batching; throughput vs latency |
| `max_repo_files` | 50 K | 200 K | 500 K | Hard cap; warn at 50 % of cap |
| `mem_budget` | 256 MiB or 5 % RAM | 1 GiB or 5 % RAM | 5 GiB or 5 % RAM | Whichever is larger |
| `sparse_gram_strategy` | delta-merge | adaptive (probe at start) | fast-rebuild | See § 7.6 |
| `rebuild_concurrency` | 1 | 2 | 4 | Parallel tier rebuilds during async pass |
| `watcher_default_state` | off | off | off | Always opt-in (regardless of tier) |
| `fts5_merge_pages` | 8 | 16 | 32 | Higher fan-in on machines that can afford it |
| `wal_checkpoint_every_n_ticks` | 30 | 60 | 120 | Balance WAL growth vs OS write pressure |
| `rebuild_uses_gpu` | n/a | if available + idle | if available + idle | Low tier rarely has GPU; fall through to CPU |

### 34.3 Adaptive backstop budget

The directory walk in § 9.1 is the only cost item that scales with corpus
size rather than edit rate. Adaptive policy:

1. Daemon measures wallclock of one backstop walk at startup.
2. If `walk_wallclock > 0.5 × reconcile_interval`, extend the interval
   to `2 × walk_wallclock` (clamped to max 600 s) and log a notice.
3. Above 600 s, switch to watcher-only mode with a 600 s safety
   resweep. If `SWEET_SEARCH_WATCH=0` AND the walk exceeds 600 s,
   emit an ERROR with remediation: enable watcher OR exclude
   directories OR reduce `max_repo_files`.

### 34.4 Storage-aware artifact layout

- **Tombstone bitmap files** (`*.stale.bin`): 64-byte aligned to allow
  AVX-512/AVX2/NEON SIMD masking. Header records alignment + version.
  Even though v1 reads scalar, the format must be SIMD-ready so the
  future Rust read path is a zero-copy swap (see § 23, deferred SIMD
  optimization).
- **HNSW mmap**: `madvise(MADV_RANDOM)` on the graph region;
  `MADV_SEQUENTIAL` on the vector storage region during cold-load.
- **WAL on slow storage**: on `hdd` tier, increase
  `wal_autocheckpoint` to 10 000 pages (10× default) to amortize
  spinning-disk seek cost; on `nvme`, keep default 1 000.
- **Disk-free check before rebuild stage**: per § 29.2.
- **fsync policy**: `synchronous = NORMAL` on `nvme`/`ssd`; consider
  `synchronous = FULL` on `hdd` because the seek cost dominates anyway
  and durability matters more.

### 34.5 Cross-architecture (ARM64 / x86_64)

The plan is architecture-agnostic. Concrete points:

- xxHash3 has native SIMD on both ARM NEON and x86 SSE2/AVX2;
  fall back to scalar on unsupported targets — still 5× faster than
  SHA-256.
- USearch ships pre-built binaries for both archs.
- Tree-sitter parsers run identically (WASM is a deliberate portability
  choice — see `tree-sitter-provider.js`).
- ORT CPU paths exist for both; no architecture-specific code in
  reconcile.

### 34.6 Cross-OS notes (consolidating § 26)

| OS | Watcher | inotify-class limits | Filesystem hazards | Tested |
|---|---|---|---|---|
| macOS | FSEvents via `notify` | none | APFS case-insensitive default, snapshot semantics | primary |
| Linux | inotify via `notify` | `max_user_watches` (524 288 default; large monorepos exhaust) | mtime resolution varies; symlink semantics differ | primary |
| Windows | `ReadDirectoryChangesW` via `notify` | path length 260 (legacy) or 32 K | NTFS reserved names, alternate streams | v2 |
| WSL2 | inotify on the Linux side; events from Windows-mounted drives are unreliable | low | mtime resolution truncated when crossing boundary | polling-only mode |

**WSL2 handling — refined.** The earlier blanket "WSL2 → polling-only"
over-penalizes users with projects on the native Linux filesystem
(`/home/user/project` on ext4) where inotify works perfectly. Inotify
across the Windows ↔ Linux boundary (`9p`/`drvfs` mount under `/mnt/c/`)
is unreliable; native Linux paths are fine.

Refined detection:
1. Check `/proc/version` for `microsoft`/`WSL` substring → flag WSL2.
2. If flagged, resolve `projectRoot` via `realpath` and query the
   mounted filesystem type. Two equivalent methods:
   - Run `df -T projectRoot | awk 'NR==2 {print $2}'` and check the
     filesystem column.
   - Read `/proc/mounts` and find the longest-prefix-matching mount
     point of `projectRoot`.
3. Decision:
   - `ext4` / `btrfs` / `xfs` / `zfs` / `tmpfs` → native Linux FS,
     **allow the watcher** (respect the user's `SWEET_SEARCH_WATCH`
     setting normally).
   - `9p` / `drvfs` / `cifs` / `nfs` → cross-boundary FS, force
     `SWEET_SEARCH_WATCH=0` regardless of user setting; emit notice
     identifying the FS type as the cause.
4. Log the detected `(WSL2, fs_type, mode)` triple at daemon startup
   so users can audit why polling was forced.

### 34.7 No-GPU machines

On machines where `shouldArmGpu()` returns false at every check (CI
runners, headless servers, older Intel/AMD without compatible GPU
runtime):

- **Cold full reindex** runs on CPU. Wallclock scales with corpus
  size and core count; emit progress logging every 10 % so operators
  know it's making progress.
- **Async rebuilds** run on CPU with `nice 10` priority.
- **No teardown / no arm** — the model-pool stays in its initialized
  state forever. Simplifies the reconcile/rebuild boundary on these
  machines.

### 34.8 Container & sandbox awareness

When running inside Docker or a container:

- **Detect** via `/proc/1/cgroup` content (Linux) or
  `KUBERNETES_SERVICE_HOST` env var.
- **CPU budget**: use **`os.availableParallelism()`** (Node 18.14.0+),
  which natively reads cgroup v1/v2 quotas, CPU affinity masks
  (`sched_getaffinity`), and Windows process affinity, returning a
  correct integer of usable cores. **Do not** manually parse
  `/sys/fs/cgroup/cpu.max` — it's fragile across cgroup v1 vs v2,
  fractional quotas (`150000 100000`), unlimited values (`max`), and
  CPU affinity overrides. The Node API handles all of these.
- **Memory budget**: read `/sys/fs/cgroup/memory.max` (v2) or
  `/sys/fs/cgroup/memory/memory.limit_in_bytes` (v1) directly; Node has
  no helper for this. Fall back to `os.totalmem()` if neither path
  exists (non-containerised). Use the cgroup limit, not the host RAM,
  as the basis for `mem_budget_fraction`.
- **Watcher**: disable inside containers by default. Mount events from
  the host are typically not propagated through Docker's default
  overlay-fs driver; inotify on a bind-mounted host directory works in
  some configurations but not all. Use polling.
- **`mem_budget_fraction` default lowered to 0.10** (10 %) of cgroup
  memory limit inside containers, to coexist with sibling processes.
- **Disk class detection** (§ 34.1) may misclassify overlay filesystems
  as `hdd` because of layered cache thrash during the probe. Override:
  if cgroup-detected, default disk class to `ssd` unless the user
  forces otherwise.

### 34.9 What stays constant across all tiers

- The correctness contract: ≤ tick-interval staleness, no MRR
  regression, single global epoch, per-file atomicity.
- The five-tier index list and their relationships.
- The format-gating rule and held-out discipline.
- The lockfile model.
- The schema versions.
- The file-system safety story (renames, symlinks, atomic writes, etc.
  per § 22).

Sweet-search treats hardware tier as **a knob on speed and frequency,
not on safety or quality**. A user on a four-core laptop gets longer
reconcile intervals and slower rebuilds; they do **not** get a less
correct index.

---

## 35. Post-Review Corrections (Gemini 3.1 Pro deep-think, 2026-05-15)

A SOTA gap analysis was performed by Gemini 3.1 Pro (deep-think,
4 236 thinking tokens). Eleven concrete findings; nine accepted and
folded in, two deferred to v1.1.

### 35.1 Accepted and folded in

| # | Finding | Where it landed | Severity |
|---|---|---|---|
| 1 | **Positional `chunk_id` defeats chunk-hash dedup** on top-of-file inserts (verified against `ast-chunker.js:814-905`) | § 7.2 rewritten with AST-structural ID scheme | **critical** — Phase 1 fails without this |
| 2 | **mtime equality trap** — naive `>` check misses second write within FS resolution tick | § 9.1 fixed to `(mtime, size, inode) !=` tuple | high |
| 3 | **FTS5 does NOT auto-compact** — plan's "SQLite handles compaction" claim was false | § 7.1 added explicit `('merge', 16)` per tick + `('optimize')` watermark | **critical** — daemon bloats GB/week without this |
| 4 | **USearch concurrent `remove()` may be unsafe** vs concurrent readers | § 7.3 adopts tombstone-only writes (no live `remove()`); § 8.3 updates the concurrent-reader guarantees | **critical** — daemon crash hazard |
| 5 | **LSM rebase race window** between replay end and atomic swap | § 10.3 rewritten with bounded-replay + lock-held final swap | high — lost-write hazard |
| 6 | **SQLite WAL checkpoint starvation** under long-lived MCP reader | § 8.4 specifies WAL checkpoint policy; § 27.2.1 adds MCP-side rules | high |
| 7 | **`PRAGMA synchronous = NORMAL`** in WAL mode | § 7.1 added | quick win |
| 8 | **xxHash3 replaces SHA-256** for content dedup (~15–30× throughput) | § 7.2; § 21 adds `SWEET_SEARCH_HASH_ALGORITHM` env override | medium |
| 9 | **Resolved-exclude-array hash, not gitignore-file hash** | § 14.2.7 open question closed; method described | medium |

### 35.2 Deferred

| # | Finding | Reason for deferral |
|---|---|---|
| 10 | SIMD tombstone intersection during HNSW traversal | v1 reads tombstones scalar; § 34.4 mandates 64-byte aligned bitmap format so future Rust-side SIMD swap is zero-copy |
| 11 | Zstd-dictionary-compressed JSONL queues | NVMe-class storage tolerates uncompressed queues; revisit if disk IO appears in P99 profiles |

### 35.3 Items added beyond the review

- Adaptive defaults by hardware tier (§ 34) — beyond Gemini's brief but
  required by the user's "any machine" mandate.
- Pre-rebuild disk-free check (§ 29.2) — was implicit; now explicit.
- Stale-lockfile recovery (§ 8.6) — was buried in failure-mode table;
  now its own subsection.
- WSL2 detection forces polling-only mode (§ 34.6).
- Container/cgroup awareness (§ 34.8).

### 35.4 What the review explicitly did NOT find

Gemini's verdict: "The plan is 90 % complete and highly pragmatic."
The five-tier architecture, the 60 s reconcile cadence, the per-token
int4 LI advantage, the content-hash dedup model, and the format-gating
discipline were all left untouched — they survived independent review.

### 35.5 What I'm still unsure about

These survived this round but deserve further scrutiny:

- Whether the 60 s tick CPU budget is realistic across all three tiers
  on the actual corpus. The tier-stratified benchmark in § 14.1 (Phase 5)
  will answer this.
- Whether per-segment LI recompaction stays under 30 s on the low tier
  for full 10 K-doc segments. May need to lower the segment cap to
  5 K docs on `tier=low`.
- Whether tombstone-only HNSW writes (§ 7.3) cost meaningful recall
  before the watermark fires. The synthetic injection study in Phase 5
  must measure this directly, not just total tombstone fraction.
- Whether xxHash3 collisions on small chunks (~100 bytes) are actually
  bounded. Worth a one-shot collision test on the working corpus
  before flipping the default.

These join the existing § 14.2 open questions list rather than blocking
the plan.

---

## 36. Second-Pass Review Corrections (Gemini 3.1 Pro deep-think, 2026-05-15)

After the first review's findings were folded in (§ 35), a second-pass
deep-think review (33 k prompt tokens, 4 036 thinking tokens, 3.6 k
output) was performed against the updated plan. The reviewer's verdict:
"95 % of the way to a bulletproof engineering document" — but the
implementations of the first-pass fixes contained mechanical bugs that
would crash the daemon or silently lose data. All 10 findings + 2
bonus items have been folded in.

### 36.1 Critical mechanical bugs in the first-pass "fixes"

| # | Finding | Severity | Where it landed |
|---|---|---|---|
| 1 | **Anonymous chunk ID collision** — identical statements (e.g., `if (err) return cb(err);` twice in a function) hash identically → UPSERT silently overwrites one and loses chunks | **critical** | § 7.2 amended with mandatory `occurrence_index_in_parent` suffix |
| 2 | **LSM rebase had no replay log** — § 10.3 said "replay from the WAL of changes recorded per-tier" but no such WAL existed; SQLite's internal WAL is not queryable for row-level extraction. Rebase was physically unimplementable as written. | **critical** | § 7.1.6 and § 7.2 add `epoch_written INTEGER NOT NULL` columns with index; § 10.3 rewrites the replay-source clause |
| 3 | **USearch capacity exhaustion** — tombstone-only writes never call `remove()`, so `max_elements` is exhausted monotonically; eventual `add()` throws → daemon crash. | **critical** | § 7.3 adds dynamic `index.reserve()` on capacity exception, rebuild-time over-allocation by tombstone margin, and a `hnsw_capacity_used` metric |
| 4 | **`TRUNCATE` does not force readers** — the daemon's `wal_checkpoint(TRUNCATE)` returns `SQLITE_BUSY` when readers hold transactions; it does **not** kill them. The original draft implied otherwise. | high | § 8.4 rewritten with cooperative-checkpoint model; § 27.2.1 mandates MCP-side transaction hygiene |
| 5 | **BigInt inode truncation** — `fs.statSync().ino` returns `Number`; modern FS (APFS/ZFS/XFS) routinely exceed `2^53 - 1` → silent precision loss → two distinct files appear identical. | high | § 9.1 amended: `{ bigint: true }` stat option; inode stored as string in `merkle-state.json` |
| 6 | **FTS5 `'optimize'` self-trips own WAL alarm** — rewrites whole FTS5 index in single transaction → 200–800 MiB WAL frame → trips the 256 MiB bloat alarm in § 8.4. | medium | § 7.1 replaces `'optimize'` with bounded `'merge', 500` |
| 7 | **WSL2 over-penalization** — original `WSL2 → polling-only` rule was too broad; native Linux paths work fine. | medium | § 34.6 refined: detect FS type via `df -T`; force polling only on `9p`/`drvfs`/`cifs`/`nfs` |
| 8 | **`os.availableParallelism()` exists** — Node 18.14+ handles cgroup v1/v2, affinity masks, quotas natively. | low (cleanup) | § 34.8 replaces manual cgroup parsing |
| 9 | **HNSW crash-leak between add and epoch-commit** — `add()` is not idempotent; crash mid-tick leaks duplicates. | medium | § 11 amended: documented as self-healing via async rebuild (which reads source-of-truth from idempotent `codebase.db` UPSERT). Made explicit so operators understand transient duplicate behavior. |
| 10 | **Held-out discipline violation** — original § 24.6 ran the 50-edits A/B on held-out, contaminating the set. | high (methodological) | § 24.6 rewritten as a phase-by-phase table; held-out is one-shot at end of Phase 6 only |

### 36.2 Bonus findings

| Finding | Where it landed |
|---|---|
| Noise floor undefined → defined as ±0.005 absolute MRR | § 12.1 |
| Tree-sitter mid-edit error visibility → metric added | § 20.1 (`tree_sitter_error_nodes_seen`, `tree_sitter_files_with_errors`) |

### 36.3 Items the reviewer did NOT challenge

- The five-tier architecture.
- The 60 s reconcile cadence (with adaptive scaling).
- Per-token int4 LI as the load-bearing structural property
  (reviewer flagged the SSLX v4 trap and the plan agreed).
- Content-hash dedup model.
- Format-gating discipline.
- Hardware-tier abstractions in § 34 in principle (only the
  implementation specifics in § 34.6 / § 34.8 / § 9.1 had bugs).

### 36.4 Lessons codified

Three meta-rules learned from this review pass:

1. **"We will replay from the WAL" is hand-waving until the schema
   shows the column.** Any future rebase / GC / migration design must
   explicitly name the source-of-truth table and column it queries.
2. **OS APIs require version awareness.** Manually parsing OS
   internals (cgroup files, mount tables) is fragile; prefer
   language stdlib helpers (`os.availableParallelism()`,
   `fs.statSync({ bigint: true })`) where they exist.
3. **"This handles itself" claims need source citations.** SQLite's
   "automatic" behaviors (FTS5 compaction, WAL checkpointing,
   `TRUNCATE` semantics) are exactly the operations where production
   pathologies live. Every "X handles compaction" in this plan was
   either wrong (FTS5) or required reader cooperation (WAL); they
   are now spelled out.

### 36.5 What's still open

The second-pass review explicitly noted some unresolved areas — these
remain in § 14.2 as open questions:

- USearch's actual auto-resize behavior in the JS binding (some
  versions auto-grow; need empirical verification before relying on
  the `reserve()` retry path).
- FTS5 `'merge', 500` WAL impact at scale (the claim that it stays
  bounded is theoretically correct but unmeasured on sweet-search's
  actual code-graph.db).
- Whether the `epoch_written` index choice (B-tree on a monotonically
  increasing integer) creates write hot-spots; might need a partial
  index `WHERE epoch_written > (max - 10000)` instead.

### 36.6 Net change

The plan grew from 2 216 lines to roughly 2 500 lines after this
pass. No section was removed; eight sections were amended in place
and one new section (§ 36) was added. Schema migrations expanded:
the Phase 1 work now adds three columns (`chunk_struct_id`,
`chunk_text_hash`, `epoch_written`) to `vectors` and one
(`epoch_written`) to `entities`, plus indices.
