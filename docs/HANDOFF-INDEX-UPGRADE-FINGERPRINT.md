# Handoff: detect index-format changes after an upgrade

**Status:** open, not started. Written 2026-09-30.

## The problem

When a new sweet-search version changes how chunks are embedded, an old on-disk index
keeps its old format. Nothing reliably detects this.

1. **The config fingerprint is too narrow.** `buildConfigFingerprint()` in
   `core/indexing/incremental-tracker.js:47` covers the dense embedding provider, model,
   dimensions, `pipelineVersion: 2`, the hash algorithm, and `STATE_VERSION` (`'2.4'`).
   It does NOT cover:
   - the late-interaction model (LateOn-Code / LateOn-Code-edge) and its quantization,
   - the chunker (cAST cap, split rules, language configs),
   - the enrichment preamble policy (`ASTChunker.enrichEmbeddingText`, per-language routing),
   - the sparse-gram weights ID (`common-code-bigram-v1`).
   A change to any of these only reaches old indexes if someone remembers to bump
   `pipelineVersion` or `STATE_VERSION` by hand.

2. **The reconcile daemon never compares the fingerprint.** The full indexer calls
   `validateConfigFingerprint()` (`incremental-tracker.js:310`, acted on at `:410`) and
   rebuilds on a mismatch. The daemon's baseline gate
   (`core/incremental-indexing/infrastructure/baseline-readiness.mjs:65-100`) checks only
   that a fingerprint EXISTS. After an upgrade, the daemon writes new-format chunks into an
   old-format index. The result is a mixed index until the user runs `sweet-search index`.
   This is worst for an embedding-model change: old and new vectors do not share a space.

## What to build

1. **Widen the fingerprint.** Add the LI model ID and quantization, and one
   `chunkingVersion` and one `enrichmentVersion` constant that live next to the code they
   version (so a PR that changes the chunker or preamble bumps them in the same diff).
   Add the sparse-gram weights ID.
2. **Make the daemon compare it.** In the baseline gate, a fingerprint MISMATCH is a new
   not-ready reason (for example `config-fingerprint-mismatch`). The daemon then stops
   writing (same behaviour as `waiting_for_initial_index`) and never mixes formats.
3. **Tell the user.** `sweet-search reconcile status` and the search staleness banner
   (`core/incremental-indexing/infrastructure/staleness-display.mjs`) say which field
   changed and to run `sweet-search index`.
4. **Decide policy for legacy states** with no fingerprint fields for the new keys. Today a
   missing fingerprint is treated as valid ("legacy, migrate gracefully"). A missing NEW
   field should probably count as a mismatch once, so existing users rebuild after the
   first upgrade that ships this. Confirm with the owner first: this forces a full rebuild
   for every existing user.

## Guard rails

- Accuracy is non-negotiable. This change must not alter embeddings or ranking. It only
  gates when the daemon writes.
- Unit tests: fingerprint round-trip; each new field flips validation; baseline gate
  returns the new reason; daemon tick is a no-op under mismatch.
- No benchmark run needed (no retrieval change). Do not run tests while a Mac bench queue
  is running (see memory `feedback_no_tests_during_mac_bench_queue.md`).
- Commit and push to main.

## README follow-up

After this ships, add one line at the end of the "Incremental Indexing" under-the-hood box
in `README.md`:

> **Want a clean slate?** `sweet-search index` rebuilds from scratch at any time. After an
> upgrade that changes the models or chunking, we tell you to run it.

Until it ships, only the first sentence is true.

## Checked and ruled out (do not re-investigate)

Cross-file staleness of the enrichment preamble. Both enrichment paths
(`core/indexing/indexer-build.js:44` and
`core/incremental-indexing/application/production-reconciler.mjs:258`) read only the
chunk's OWN file: its entities (scope chain) and its own import statements. Editing file A
never changes file B's preamble, so B needs no re-queue. The comment in
`core/incremental-indexing/domain/cutoff-cache.mjs:20` that says "cross-file graph
enrichment" is misleading and can be corrected in the same PR.
