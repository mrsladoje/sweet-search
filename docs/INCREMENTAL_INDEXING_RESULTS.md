# Incremental Indexing — Phase 5 Results (placeholder)

This document holds the empirical measurements that justify the per-tier
watermark defaults in `docs/INCREMENTAL_INDEXING_PLAN.md`. The
sensitivity sweep is **user-driven** because it burns GCSN benchmark
budget; the harness (`scripts/incremental-indexing-tombstone-sensitivity.mjs`)
ships with Phase 5 so the run can happen as soon as the Reconciler is
wired to the live tiers.

## Discipline

- **Dev set only.** Per CLAUDE.md `feedback_heldout_discipline_strict.md`,
  never inspect held-out per-fraction. The runner enforces this — it
  shells out to `npm run eval:bench`, which by default runs the dev
  split. The held-out split is reserved for the end-of-Phase 6
  one-shot validation.
- **Seed = 42.** CLAUDE.md "Benchmark Methodology" pins the seed for the
  stratified split. The harness passes `seed=42` to the mulberry32 PRNG
  so the same vector ids tombstone across reruns.
- **Restore between points.** `injectTombstones().restore()` runs in a
  `finally` block; even an exception during the benchmark leaves the
  index in its pre-experiment state.

## Sweep protocol

1. Tag the pre-sweep commit `pre-tombstone-sensitivity-baseline`.
2. Build the index in cold form:
   ```bash
   npm run index
   ```
3. Run the sweep:
   ```bash
   node scripts/incremental-indexing-tombstone-sensitivity.mjs \
     --fractions 0.05,0.10,0.15,0.20,0.25,0.30 \
     --out docs/INCREMENTAL_INDEXING_RESULTS.json
   ```
4. Paste the resulting `MRR / fraction` table into this document and
   commit it alongside the JSON.
5. Pick the **Float HNSW tombstone watermark** as `first fraction where
   ΔMRR > noise floor (0.005)` minus a 5-percentage-point margin.
6. Repeat for Binary HNSW + LI segments using `sessionFilter` if you
   want to scope the sweep to a specific tier.

## Measurements (to be filled in)

| Fraction | MRR | ΔMRR vs baseline | Margin vs noise floor (±0.005) | Notes |
|---:|---:|---:|---|---|
| 0.00 (baseline) | _TBD_ | 0 | — | locked baseline |
| 0.05 | _TBD_ | _TBD_ | _TBD_ | |
| 0.10 | _TBD_ | _TBD_ | _TBD_ | |
| 0.15 | _TBD_ | _TBD_ | _TBD_ | provisional watermark |
| 0.20 | _TBD_ | _TBD_ | _TBD_ | |
| 0.25 | _TBD_ | _TBD_ | _TBD_ | |
| 0.30 | _TBD_ | _TBD_ | _TBD_ | |

## Locked thresholds (post-sweep)

Once the table is populated, paste the chosen watermark into the env vars
in `docs/INCREMENTAL_INDEXING_PLAN.md` § 21.1 and into the test fixtures
that consume `DEFAULT_WATERMARKS` in
`core/incremental-indexing/domain/watermark-scheduler.mjs`. The plan's
provisional defaults are:

| Tier | Provisional default | Source |
|---|---|---|
| Float HNSW tombstone fraction | `0.15` | plan § 13 Phase 3 starting default |
| Float HNSW delete cycles | `1000` | plan § 7.3 starting default |
| Binary HNSW dead-doc ratio | `0.30` | existing artifact-rebuild-state behaviour |
| LI per-segment stale ratio | `0.20` | plan § 7.5 step 3 |
| Sparse-gram delta size ratio | `0.10` | plan § 7.6 |
| Sparse-gram delta segment count | `64` | plan § 7.6 |
| FTS5 segment count | `64` | plan § 7.1.5 |

## Open question

The plan's third-pass review flagged `epoch_written` index choice as
unresolved (full B-tree vs partial recent-window). Phase 0 picked the
full B-tree provisionally. Phase 5 should re-evaluate by adding a
parallel benchmark point: `0.15` tombstones with the partial index
configuration and `0.15` with the full index. If insertion-latency creep
is real, the partial-index variant wins; otherwise stay on the full
B-tree.
