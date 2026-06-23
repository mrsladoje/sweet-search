import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __testing } from '../../core/incremental-indexing/application/production-reconciler.mjs';

const { normalizeHnswDeterminismFlags, _resetDetLevelsWarnLatch } = __testing;

const BATCH_FLAG = 'SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES';
const DET_LEVELS_FLAG = 'SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS';

/**
 * Couple the two HNSW-determinism levers so the batch lever can never silently
 * produce a non-byte-identical graph (binary-hnsw-index.js reads
 * SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS directly at insert time).
 *
 * Both levers are now DEFAULT-ON (`!== '0'`). "batch effectively ON" therefore
 * means the flag is unset (default) OR '1' — i.e. `BATCH_FLAG !== '0'`. In the
 * normal case det-levels is ALSO default-on, so coupling is a no-op (no env
 * mutation, no warning). The ONE case that must still fail loudly is the explicit
 * contradiction: batch effectively ON while det-levels is EXPLICITLY '0'.
 */
describe('normalizeHnswDeterminismFlags (batch ⇄ det-levels coupling, default-on)', () => {
  let savedBatch;
  let savedDet;

  beforeEach(() => {
    savedBatch = process.env[BATCH_FLAG];
    savedDet = process.env[DET_LEVELS_FLAG];
    delete process.env[BATCH_FLAG];
    delete process.env[DET_LEVELS_FLAG];
    _resetDetLevelsWarnLatch();
  });

  afterEach(() => {
    if (savedBatch === undefined) delete process.env[BATCH_FLAG]; else process.env[BATCH_FLAG] = savedBatch;
    if (savedDet === undefined) delete process.env[DET_LEVELS_FLAG]; else process.env[DET_LEVELS_FLAG] = savedDet;
  });

  it('both default (unset) → no-op: det-levels stays default-on, never mutated', () => {
    // Both flags unset = both effectively ON. det-levels is already on via its
    // own `!== '0'` gate, so the coupler must NOT mutate the env.
    expect(process.env[BATCH_FLAG]).toBeUndefined();
    expect(process.env[DET_LEVELS_FLAG]).toBeUndefined();
    expect(() => normalizeHnswDeterminismFlags()).not.toThrow();
    expect(process.env[DET_LEVELS_FLAG]).toBeUndefined();
  });

  it('batch unset (default-on) + det-levels EXPLICITLY 0 → throws (the contradiction)', () => {
    // Batch is default-on; det-levels forced off is the explicit contradiction.
    process.env[DET_LEVELS_FLAG] = '0';
    expect(() => normalizeHnswDeterminismFlags()).toThrow(/contradictor/i);
    // Env is left as the operator set it (we never silently flip an explicit '0').
    expect(process.env[DET_LEVELS_FLAG]).toBe('0');
  });

  it('batch ON (explicit 1) + det-levels UNSET → no-op (det-levels default-on), no warning', () => {
    process.env[BATCH_FLAG] = '1';
    expect(process.env[DET_LEVELS_FLAG]).toBeUndefined();

    const warnings = [];
    const logger = { warn: (m) => warnings.push(m) };
    normalizeHnswDeterminismFlags(logger);

    // Det-levels is default-on, so nothing is forced and nothing is warned.
    expect(process.env[DET_LEVELS_FLAG]).toBeUndefined();
    expect(warnings).toHaveLength(0);

    // Idempotent: a second call still no-ops.
    normalizeHnswDeterminismFlags(logger);
    expect(warnings).toHaveLength(0);
  });

  it('batch ON + det-levels EXPLICITLY 0 → throws a clear config error', () => {
    process.env[BATCH_FLAG] = '1';
    process.env[DET_LEVELS_FLAG] = '0';

    expect(() => normalizeHnswDeterminismFlags()).toThrow(/contradictor/i);
    // The contradiction is surfaced with both flag names + remedy.
    let caught;
    try { normalizeHnswDeterminismFlags(); } catch (e) { caught = e; }
    expect(caught.message).toContain(BATCH_FLAG);
    expect(caught.message).toContain(DET_LEVELS_FLAG);
    expect(caught.message).toMatch(/§0\.5|0\.5/);
    // The contradictory env is left as the operator set it.
    expect(process.env[DET_LEVELS_FLAG]).toBe('0');
  });

  it('batch ON + det-levels EXPLICITLY 1 → no-op (already coupled), no warning', () => {
    process.env[BATCH_FLAG] = '1';
    process.env[DET_LEVELS_FLAG] = '1';
    const warnings = [];
    normalizeHnswDeterminismFlags({ warn: (m) => warnings.push(m) });
    expect(process.env[DET_LEVELS_FLAG]).toBe('1');
    expect(warnings).toHaveLength(0);
  });

  it('batch EXPLICITLY OFF (0) → never touches det-levels, even det-levels=0 is legitimate', () => {
    // Batch explicitly disabled → the per-file path is taken, det-levels is
    // independently meaningful and an explicit det-levels=0 must NOT throw.
    process.env[BATCH_FLAG] = '0';
    process.env[DET_LEVELS_FLAG] = '0';
    expect(() => normalizeHnswDeterminismFlags()).not.toThrow();
    expect(process.env[DET_LEVELS_FLAG]).toBe('0');

    // Batch off + det-levels unset → unset stays unset.
    delete process.env[DET_LEVELS_FLAG];
    normalizeHnswDeterminismFlags();
    expect(process.env[DET_LEVELS_FLAG]).toBeUndefined();
  });
});
