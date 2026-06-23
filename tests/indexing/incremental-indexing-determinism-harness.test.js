/**
 * Determinism + crash-consistency harness — control tests (Plan G0).
 *
 * This is the CONTROL for the whole verification plan (RESEARCH §1.1): if the
 * dumpers or the reconciler are themselves non-deterministic, every later
 * "flag-on == flag-off" byte-diff is meaningless. So we assert:
 *
 *   1. Two identical runs (flags off) produce byte-identical canonical dumps —
 *      i.e. baseline-vs-baseline `byteDiff` is null.
 *   2. The dumpers are pure: re-dumping the SAME finished state dir twice is
 *      identical, and the canonical JSON is stable.
 *   3. The 3-file fixture exercises all five artifacts + merkle (none null).
 *   4. The dumper internals (epoch stripping, structural diff, FTS detection)
 *      behave as specified.
 *
 * The harness drives the REAL production reconciler tick path with injected,
 * pure, hash-derived stub encoders (no GPU/ORT), so any surviving diff is
 * attributable to index code — exactly what the USER needs to gate the
 * efficiency levers.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runFixedSequence,
  runBaselineVsCandidate,
  runCrashConsistency,
  loadEditScript,
  CANDIDATE_FLAGS,
  HNSW_DETERMINISM_FLAG,
  resolveEnvOverrides,
  __testing as harness,
} from '../../eval/index-maintainer-determinism/run-harness.mjs';
import {
  dumpAllArtifacts,
  byteDiff,
  canonicalJson,
  dumpSqliteDb,
  __testing as dumpers,
} from '../../eval/index-maintainer-determinism/dump-artifacts.mjs';

// The index code is chatty on stdout/stderr; silence it so the test output is
// readable. Restored in afterAll.
const savedConsole = {};
beforeAll(() => {
  for (const m of ['log', 'info', 'warn', 'error']) {
    savedConsole[m] = console[m];
    console[m] = () => {};
  }
});
afterAll(() => {
  for (const m of Object.keys(savedConsole)) console[m] = savedConsole[m];
});

describe('determinism harness — CONTROL (baseline-vs-baseline is empty)', () => {
  it('two identical runs (flags off) produce a byte-identical dump', async () => {
    const a = await runFixedSequence({ variant: 'baseline' });
    const b = await runFixedSequence({ variant: 'baseline' });

    // It replayed the full edit script: baseline build + 5 edits = 6 ticks.
    expect(a.ticksRun).toBe(6);
    expect(b.ticksRun).toBe(6);

    const diff = byteDiff(a.dump, b.dump);
    expect(diff).toBeNull();
  }, 60_000);

  it('runBaselineVsCandidate with NO overrides is the control: diff is null', async () => {
    const { diff } = await runBaselineVsCandidate({});
    expect(diff).toBeNull();
  }, 60_000);

  it('canonical JSON of two identical runs is byte-for-byte equal', async () => {
    const a = await runFixedSequence({});
    const b = await runFixedSequence({});
    expect(canonicalJson(a.dump)).toBe(canonicalJson(b.dump));
  }, 60_000);

  // The control was FLAKY (~25–50% red on a clean tree) before the harness
  // pinned SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS=1: the default level RNG
  // (unseeded Math.random in getRandomLevel) made two flags-off runs diverge in
  // `binaryHnsw.graphByLevel`/`entryPointId`. Three back-to-back runs caught the
  // flake in-process most of the time; with the pin they MUST all agree. This is
  // the regression guard for the flake itself, including the HNSW graph + entry
  // point (which the dump compares as a real field, not normalized away).
  it('the control is STABLE across repeated runs (HNSW graph + entryPoint included)', async () => {
    const ref = await runFixedSequence({ variant: 'baseline' });
    for (let i = 0; i < 3; i += 1) {
      const next = await runFixedSequence({ variant: 'baseline' });
      const diff = byteDiff(ref.dump, next.dump);
      expect(diff).toBeNull();
      // The HNSW graph + entryPoint are the load-bearing flake source; assert
      // they are present AND stable, never silently normalized away.
      expect(next.dump.binaryHnsw.graphByLevel).toEqual(ref.dump.binaryHnsw.graphByLevel);
      expect(next.dump.binaryHnsw.meta.entryPointId).toBe(ref.dump.binaryHnsw.meta.entryPointId);
    }
  }, 120_000);
});

describe('determinism harness — HNSW level pin (the control-stability fix)', () => {
  it('resolveEnvOverrides pins SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS=1 by default', () => {
    expect(resolveEnvOverrides({})[HNSW_DETERMINISM_FLAG]).toBe('1');
    // A candidate flag is preserved AND the pin is still added.
    const merged = resolveEnvOverrides({ SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS: '1' });
    expect(merged.SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS).toBe('1');
    expect(merged[HNSW_DETERMINISM_FLAG]).toBe('1');
  });

  it('opt-out: an explicit flag value (incl. unset) is honored verbatim', () => {
    // RNG-path tests pass the flag themselves to exercise getRandomLevel.
    expect(resolveEnvOverrides({ [HNSW_DETERMINISM_FLAG]: '0' })[HNSW_DETERMINISM_FLAG]).toBe('0');
    // null = explicitly unset (opt fully out of the pin).
    expect(resolveEnvOverrides({ [HNSW_DETERMINISM_FLAG]: null })[HNSW_DETERMINISM_FLAG]).toBeNull();
  });

  it('does not mutate the caller-supplied overrides object', () => {
    const input = {};
    const out = resolveEnvOverrides(input);
    expect(input).toEqual({});
    expect(out).not.toBe(input);
  });

  it('a run pinned ON equals one with the flag explicitly set to 1 (no surprise)', async () => {
    const pinned = await runFixedSequence({});
    const explicit = await runFixedSequence({ envOverrides: { [HNSW_DETERMINISM_FLAG]: '1' } });
    expect(byteDiff(pinned.dump, explicit.dump)).toBeNull();
  }, 60_000);
});

describe('determinism harness — dumpers cover all five artifacts + merkle', () => {
  let dump;
  beforeAll(async () => {
    const run = await runFixedSequence({ keepRepo: true });
    dump = run.dump;
    // Re-dump the SAME finished state dir to prove the dumpers are pure.
    dump.__reDump = await dumpAllArtifacts(run.stateDir);
    rmSync(run.projectRoot, { recursive: true, force: true });
  }, 60_000);

  it('produces a non-null dump for every artifact after the full sequence', () => {
    expect(dump.codebaseDb).toBeTruthy();
    expect(dump.codeGraphDb).toBeTruthy();
    expect(dump.binaryHnsw).toBeTruthy();
    expect(dump.floatVectors).toBeTruthy();
    expect(dump.liSegments).toBeTruthy();
    expect(dump.sparseGrams).toBeTruthy();
    expect(dump.merkle).toBeTruthy();
  });

  it('codebase.db dump has a vectors table with no wall-clock created_at column', () => {
    const vectors = dump.codebaseDb.vectors;
    expect(Array.isArray(vectors)).toBe(true);
    expect(vectors.length).toBeGreaterThan(0);
    for (const row of vectors) {
      expect(row).not.toHaveProperty('created_at');
      // epoch tokens stripped from ids
      if (typeof row.id === 'string') expect(row.id).not.toMatch(/@e\d+/);
    }
  });

  it('binary HNSW dump translates entryPoint to an id and re-keys the graph by id', () => {
    expect(dump.binaryHnsw.meta).toBeTruthy();
    expect(Array.isArray(dump.binaryHnsw.vectors)).toBe(true);
    expect(Array.isArray(dump.binaryHnsw.graphByLevel)).toBe(true);
    // Vectors are sorted by id.
    const ids = dump.binaryHnsw.vectors.map((v) => v.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('float vectors dump is loaded, dimensioned, and sorted by id', () => {
    expect(dump.floatVectors.loaded).toBe(true);
    expect(dump.floatVectors.dimension).toBe(harness.MODEL_INFO.hnswDimension);
    const ids = dump.floatVectors.vectors.map((v) => v.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('merkle dump strips epoch / mtime / inode but keeps content hashes', () => {
    expect(dump.merkle.files).toBeTruthy();
    for (const entry of Object.values(dump.merkle.files)) {
      expect(entry).not.toHaveProperty('epoch');
      expect(entry).not.toHaveProperty('mtime_ns');
      expect(entry).not.toHaveProperty('inode');
      expect(entry).toHaveProperty('hash');
    }
  });

  it('re-dumping the same finished state dir is identical (dumpers are pure)', () => {
    const reDump = dump.__reDump;
    const clean = { ...dump };
    delete clean.__reDump;
    expect(byteDiff(clean, reDump)).toBeNull();
  });
});

describe('determinism harness — crash-consistency mechanism (SIGKILL mid-tick)', () => {
  // CLASSIFICATION (default per-file path, kill on an ADD tick):
  //   - liveDiff (the QUERYABLE view: retired rows dropped, epochs ranked) ==
  //     null. This is a CORRECTNESS guarantee. The original hole was a real
  //     correctness bug — a row committed to codebase.db before the crash but
  //     never written to the HNSW/LI tiers stayed QUERYABLE via SQLite/FTS while
  //     being permanently MISSING from vector + late-interaction search (its
  //     committed hash made the restart treat it as an exact reuse → no re-add).
  //     The per-file torn-row repair in production-reconciler.mjs
  //     (`applyVectorDelta`) re-adds any live row whose `epoch_written` exceeds
  //     the highest PUBLISHED merkle epoch under its existing id, so the live
  //     index reconverges to a clean run.
  //   - strictDiff (the FULL on-disk view, incl. MVCC-retired rows + the
  //     physical HNSW graph) MAY be non-null: re-reconciling a crashed tick can
  //     leave an extra retired (query-invisible) row, and a modify/delete crash
  //     can leave an extra physical HNSW node whose stale bit was lost in the
  //     crash (query-correct once `binaryHnswHandler` maintenance reconciles it).
  //     This is cosmetic — a different-but-valid graph + invisible residue — and
  //     is driven to null by E.1 batching (deferred COMMIT + merkle gating).
  it('SIGKILLs a child mid-tick, restarts, and the live (queryable) index reconverges', async () => {
    const res = await runCrashConsistency({ killTick: 2 });
    // The child self-SIGKILLed (the crash actually happened).
    expect(res.childSignal).toBe('SIGKILL');
    // Exactly one tick (the baseline) committed metrics before the crash.
    expect(res.ticksBeforeKill).toBe(1);
    // The restart drained the whole sequence.
    expect(res.ticksAfterRestart).toBe(6);
    // strictDiff is structured when present (either null, or {artifact, path, a, b}).
    if (res.strictDiff !== null) {
      expect(res.strictDiff).toHaveProperty('artifact');
      expect(res.strictDiff).toHaveProperty('path');
    }
    // The queryable index reconverged: no live row is missing or wrong after the
    // crash + restart on the default per-file path.
    expect(res.liveDiff).toBeNull();
  }, 90_000);
});

describe('determinism harness — edit script + flags surface', () => {
  it('the edit script exercises add / modify / dependency-change / delete / rename', () => {
    const script = loadEditScript();
    const kinds = script.steps.map((s) => s.kind);
    expect(kinds).toEqual(['add', 'modify', 'modify-dep', 'delete', 'rename']);
    expect(script.baseFiles.length).toBe(3);
  });

  it('lists every candidate efficiency flag so the USER can sweep flag-on vs flag-off', () => {
    expect(CANDIDATE_FLAGS).toContain('SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS');
    expect(CANDIDATE_FLAGS).toContain('SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES');
    expect(CANDIDATE_FLAGS).toContain('SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS');
  });
});

describe('dump-artifacts internals (unit)', () => {
  it('stripEpochToken normalizes @e<digits> to @e# everywhere', () => {
    expect(dumpers.stripEpochToken('src/a.js:1-4:0@e2.0')).toBe('src/a.js:1-4:0@e#.0');
    expect(dumpers.stripEpochToken('name@e37')).toBe('name@e#');
    expect(dumpers.stripEpochToken('no-epoch-here')).toBe('no-epoch-here');
    expect(dumpers.stripEpochToken(42)).toBe(42);
  });

  it('sortKeysDeep produces order-stable nested objects', () => {
    const a = dumpers.sortKeysDeep({ b: 1, a: { z: 2, y: 3 } });
    expect(JSON.stringify(a)).toBe('{"a":{"y":3,"z":2},"b":1}');
  });

  it('deepDiff returns the first divergent key path or null', () => {
    expect(dumpers.deepDiff({ x: 1 }, { x: 1 }, 'root')).toBeNull();
    const d = dumpers.deepDiff({ x: { y: 1 } }, { x: { y: 2 } }, 'root');
    expect(d).toMatchObject({ path: 'root.x.y', a: 1, b: 2 });
    const lenDiff = dumpers.deepDiff([1, 2], [1, 2, 3], 'arr');
    expect(lenDiff.path).toBe('arr.length');
  });

  it('roundSum is stable and tolerant of float jitter', () => {
    expect(dumpers.roundSum([0.1, 0.2, 0.3])).toBe(dumpers.roundSum([0.1, 0.2, 0.3]));
    expect(dumpers.roundSum([1, 2, 3])).toBe(6);
  });
});

describe('dumpSqliteDb (unit) — FTS shadow tables excluded, blobs hex, rowid order', () => {
  let dir;
  let dbPath;
  beforeAll(async () => {
    const Database = (await import('better-sqlite3')).default;
    dir = mkdtempSync(join(tmpdir(), 'ss-dump-sqlite-'));
    dbPath = join(dir, 'tiny.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE rows (id TEXT PRIMARY KEY, blob BLOB, created_at TEXT, name TEXT);
      CREATE VIRTUAL TABLE rows_fts USING fts5(name);
    `);
    db.prepare('INSERT INTO rows (id, blob, created_at, name) VALUES (?, ?, ?, ?)')
      .run('b@e9', Buffer.from([0xde, 0xad]), '2026-01-01T00:00:00Z', 'beta');
    db.prepare('INSERT INTO rows (id, blob, created_at, name) VALUES (?, ?, ?, ?)')
      .run('a@e9', Buffer.from([0xbe, 0xef]), '2026-02-02T00:00:00Z', 'alpha');
    db.close();
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('excludes FTS5 shadow tables, hex-encodes blobs, strips created_at, strips epoch in ids', () => {
    const dump = dumpSqliteDb(dbPath);
    // FTS virtual table + its shadow tables are excluded.
    expect(Object.keys(dump)).toEqual(['rows']);
    const rows = dump.rows;
    // rowid order = insertion order (beta first).
    expect(rows[0].id).toBe('b@e#');
    expect(rows[1].id).toBe('a@e#');
    expect(rows[0].blob).toEqual({ __blob_hex: 'dead' });
    expect(rows[0]).not.toHaveProperty('created_at');
  });

  it('returns null for a missing database file', () => {
    expect(dumpSqliteDb(join(dir, 'does-not-exist.db'))).toBeNull();
  });
});
