import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __testing } from '../../core/incremental-indexing/application/production-reconciler.mjs';

const { normalizeHnswDeterminismFlags, _resetDetLevelsWarnLatch } = __testing;

const BATCH_FLAG = 'SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES';
const DET_LEVELS_FLAG = 'SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS';

/**
 * Task #3 — couple the two HNSW-determinism levers so the batch lever can never
 * silently produce a non-byte-identical graph (binary-hnsw-index.js reads
 * SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS directly at insert time).
 */
describe('normalizeHnswDeterminismFlags (batch ⇄ det-levels coupling)', () => {
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

  it('batch ON + det-levels UNSET → forces det-levels=1 and warns ONCE', () => {
    process.env[BATCH_FLAG] = '1';
    expect(process.env[DET_LEVELS_FLAG]).toBeUndefined();

    const warnings = [];
    const logger = { warn: (m) => warnings.push(m) };

    normalizeHnswDeterminismFlags(logger);

    // Forced ON so binary-hnsw-index.js transparently sees it at insert time.
    expect(process.env[DET_LEVELS_FLAG]).toBe('1');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/forced ON/i);
    expect(warnings[0]).toContain(BATCH_FLAG);
    expect(warnings[0]).toContain(DET_LEVELS_FLAG);

    // One-time: a second call in the same process does NOT re-warn (the env is
    // already '1', so it short-circuits before the latch anyway).
    normalizeHnswDeterminismFlags(logger);
    expect(warnings).toHaveLength(1);
  });

  it('one-time warning latch suppresses repeat warnings across forced ticks', () => {
    const warnings = [];
    const logger = { warn: (m) => warnings.push(m) };

    // First forced-on emits the warning...
    process.env[BATCH_FLAG] = '1';
    normalizeHnswDeterminismFlags(logger);
    expect(warnings).toHaveLength(1);

    // ...and after the env is reset to unset (simulating a fresh tick that
    // re-reads the operator's flags), the latch keeps it to one notice/process.
    delete process.env[DET_LEVELS_FLAG];
    normalizeHnswDeterminismFlags(logger);
    expect(process.env[DET_LEVELS_FLAG]).toBe('1');
    expect(warnings).toHaveLength(1);
  });

  it('batch ON + det-levels EXPLICITLY 0 → throws a clear config error', () => {
    process.env[BATCH_FLAG] = '1';
    process.env[DET_LEVELS_FLAG] = '0';

    expect(() => normalizeHnswDeterminismFlags()).toThrow(/contradictor/i);
    // The contradiction is surfaced verbatim with both flag names + remedy.
    let caught;
    try { normalizeHnswDeterminismFlags(); } catch (e) { caught = e; }
    expect(caught.message).toContain(BATCH_FLAG);
    expect(caught.message).toContain(DET_LEVELS_FLAG);
    expect(caught.message).toMatch(/§0\.5|0\.5/);
    // The contradictory env is left as the operator set it (we never silently
    // flip an explicit '0').
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

  it('batch OFF → never touches det-levels (independent off the batch path)', () => {
    // Unset det-levels stays unset.
    delete process.env[BATCH_FLAG];
    delete process.env[DET_LEVELS_FLAG];
    normalizeHnswDeterminismFlags();
    expect(process.env[DET_LEVELS_FLAG]).toBeUndefined();

    // Explicit det-levels=0 with batch off is a legitimate config (RNG path) and
    // must NOT throw.
    process.env[DET_LEVELS_FLAG] = '0';
    expect(() => normalizeHnswDeterminismFlags()).not.toThrow();
    expect(process.env[DET_LEVELS_FLAG]).toBe('0');
  });

  it('falls back to stderr when no logger.warn is provided (warning never swallowed)', () => {
    process.env[BATCH_FLAG] = '1';
    const writes = [];
    const orig = process.stderr.write;
    process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
    try {
      normalizeHnswDeterminismFlags(); // no logger
    } finally {
      process.stderr.write = orig;
    }
    expect(process.env[DET_LEVELS_FLAG]).toBe('1');
    expect(writes.join('')).toMatch(/forced ON/i);
  });
});
