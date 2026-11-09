# Comments pass: incremental (core/incremental-indexing)

Method note: edits were applied with small Python replace scripts (exact-match, asserted unique), not the Edit tool. The verifier confirms comment-only changes.

## Per file: comment lines before -> after
- core/incremental-indexing/application/dirty-scan.mjs: 82 -> 73
- core/incremental-indexing/application/maintenance-handlers.mjs: 157 -> 117
- core/incremental-indexing/application/maintenance-worker.mjs: 94 -> 81
- core/incremental-indexing/application/operator-cli.mjs: 26 -> 26
- core/incremental-indexing/application/production-li-delta.mjs: 49 -> 49
- core/incremental-indexing/application/production-reconciler-helpers.mjs: 62 -> 56
- core/incremental-indexing/application/production-reconciler.mjs: 396 -> 390
- core/incremental-indexing/application/reconciler.mjs: 154 -> 140
- core/incremental-indexing/application/tombstone-injector.mjs: 58 -> 54
- core/incremental-indexing/domain/chunk-identity.mjs: 156 -> 120
- core/incremental-indexing/domain/encoder-input.mjs: 108 -> 94
- core/incremental-indexing/domain/interval-autotune.mjs: 197 -> 192
- core/incremental-indexing/domain/reconcile-counters.mjs: 33 -> 23
- core/incremental-indexing/domain/watermark-scheduler.mjs: 87 -> 79
- core/incremental-indexing/infrastructure/artifact-temp-sweep.mjs: 77 -> 70
- core/incremental-indexing/infrastructure/background-build-child.mjs: 7 -> 7
- core/incremental-indexing/infrastructure/background-build.mjs: 11 -> 11
- core/incremental-indexing/infrastructure/baseline-readiness.mjs: 94 -> 91
- core/incremental-indexing/infrastructure/dirty-set.mjs: 79 -> 62
- core/incremental-indexing/infrastructure/file-state-store.mjs: 36 -> 33
- core/incremental-indexing/infrastructure/graph-gc.mjs: 118 -> 108
- core/incremental-indexing/infrastructure/grep-corpus-state.mjs: 15 -> 15
- core/incremental-indexing/infrastructure/hash-algorithm.mjs: 5 -> 5
- core/incremental-indexing/infrastructure/hashing.mjs: 73 -> 59
- core/incremental-indexing/infrastructure/hcgs-invalidation.mjs: 84 -> 68
- core/incremental-indexing/infrastructure/hnsw-compaction.mjs: 53 -> 53
- core/incremental-indexing/infrastructure/li-segment-merge.mjs: 97 -> 96
- core/incremental-indexing/infrastructure/li-segment-state.mjs: 107 -> 100
- core/incremental-indexing/infrastructure/maintenance-state-reader.mjs: 99 -> 99
- core/incremental-indexing/infrastructure/manifest.mjs: 90 -> 88
- core/incremental-indexing/infrastructure/path-filter.mjs: 63 -> 61
- core/incremental-indexing/infrastructure/reader-heartbeat.mjs: 88 -> 80
- core/incremental-indexing/infrastructure/sparse-gram-delta.mjs: 134 -> 124
- core/incremental-indexing/infrastructure/sparse-gram-fold.mjs: 28 -> 28
- core/incremental-indexing/infrastructure/sqlite-fts5.mjs: 101 -> 95
- core/incremental-indexing/infrastructure/staleness-display.mjs: 67 -> 67
- core/incremental-indexing/infrastructure/tombstone-bitmap.mjs: 76 -> 72
- core/incremental-indexing/infrastructure/vector-delta-writer.mjs: 106 -> 101
- core/incremental-indexing/infrastructure/vector-gc.mjs: 56 -> 55
- core/incremental-indexing/infrastructure/worktree-stamp.mjs: 66 -> 59

## Removed (examples)
- dirty-scan.mjs: "1. Full walk ... / 2. Gitignore ... / 3. Decide enqueues / 5." step labels (kept the reasons, dropped numbering and restating halves).
- maintenance-handlers.mjs: 9 `/* --- name --- */` banners; "Use a writer purely as the SSLX serializer; we never call add()" shortened; "four reclamation tiers the soak REPORT.md flagged as queue-only" change-history opener.
- production-reconciler.mjs: "// ---- G2 lever flags ----" and "// ---- E.1 tick-scoped store context ----" banners; two "E.1: the tick-scoped RW connection (schema already ensured)" lines.
- chunk-identity.mjs: JSDoc on isSymbolAttached / rollingContentHash (name restated), "1./2./3." steps above three regexes, "Pass order" list.
- hcgs-invalidation.mjs / graph-gc.mjs / hashing.mjs / dirty-set.mjs: JSDoc @param lines that only repeat the name and a primitive type; "Resolve native crate (preferred)".

## Kept (examples)
- production-reconciler.mjs CRASH-CONSISTENCY block above the torn-row repair: crash-safety reasoning and why the repair is exact.
- graph-gc.mjs header: strict-visibility proof for the prune frontier and FTS5 external-content delete rule.
- maintenance-handlers.mjs liSegmentHandler "new segment name, not a rewrite in place": positional stale bitmap race.
- interval-autotune.mjs tier-table comments (RSS / idle-TTL reasoning, 128 GiB vs 32 GiB peak): why values are what they are.
- baseline-readiness.mjs header: why the reconciler must never be the first index builder.

## False comments corrected
None found. `merkle-state.json` references are still valid (baseline-readiness.mjs reads it); the plan `§` references that explain decisions were kept.

## Reverted over-reach
A first generic JSDoc pass also removed object-shape types and dotted `@param`s; I reverted those (git checkout plus re-applied manual edits, restored shapes in tombstone-injector, interval-autotune, maintenance-worker, reconciler, production-reconciler). Final pass removes only primitive-typed, description-less `@param` lines.

## Checks
- verifier: files checked: 40; comment-only: 40; problems: 0; lines removed: 298
- node --check on all 40 files: ok. eslint on all 40 files: clean.
- vitest (tests/indexing incremental*, li-delta-reader-cache, li-segmented-always, file-state-store, sparse-gram-base-fold, worktree-index, symlink-admission): 75 files, 921 tests passed.
