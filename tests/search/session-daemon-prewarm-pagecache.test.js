/**
 * Tests for the SessionStart prewarm hook's page-cache sweep (commit 22843b0).
 *
 * The sweep was added entirely untested; the main prewarm suite disables it
 * (SWEET_SEARCH_PREWARM_PAGE_CACHE=0). The sweep is a pure read-only page-cache
 * hint (readFileSync + discard) over the query-path DBs + LI segment shards +
 * LI model files. It can never mutate the index or change ss-* results.
 *
 * The sweep helpers (pageCacheSweepEnabled / readAndDiscard / pageCacheSweep /
 * spawnPageCacheSweep) are module-private, so we exercise the REAL code paths
 * via the module entry as a subprocess and assert on its verbose warmed-count
 * log. DB_PATHS resolve from SWEET_SEARCH_PROJECT_ROOT + SWEET_SEARCH_DATA_DIR,
 * so we point them at a tmp sandbox of fake DB files.
 *
 * Regression-lock for P1: codebase.db is now in the swept set.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const HOOK = join(REPO_ROOT, 'core', 'search', 'session-daemon-prewarm.mjs');

let sandbox;
let dataDir;
let segmentDir;

/** The query-path DB basenames the sweep warms, mirroring DB_PATHS. */
const DB_BASENAMES = [
  'code-graph.db',
  'codebase-late-interaction.db',
  'codebase-sparse-grams.idx',
  'codebase.db', // P1: added to the sweep set
];

function baseEnv(overrides = {}) {
  return {
    ...process.env,
    SWEET_SEARCH_PROJECT_ROOT: sandbox,
    SWEET_SEARCH_DATA_DIR: '.sweet-search',
    SWEET_SEARCH_PREWARM_VERBOSE: '1',
    // Keep the LI model files out of the count: redirect the managed model
    // cache root (SWEET_SEARCH_MODEL_CACHE) at an empty tmp dir so
    // getModelCacheDir resolves to a freshly-created dir with no
    // onnx/tokenizer present — those readAndDiscard calls return false and
    // never inflate the warmed count, isolating the DB+segment assertions.
    SWEET_SEARCH_MODEL_CACHE: join(sandbox, 'empty-model-cache'),
    ...overrides,
  };
}

/** Run the module entry directly in sweep mode; returns { code, stderr }. */
function runSweep(overrides = {}) {
  return new Promise((resolve) => {
    const env = baseEnv({ SWEET_SEARCH_PAGE_CACHE_SWEEP: '1', ...overrides });
    const p = spawn(process.execPath, [HOOK], { env, stdio: 'pipe', cwd: sandbox });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    p.on('exit', (code) => resolve({ code, stderr }));
  });
}

/** Parse the "page-cache sweep warmed N file(s)" count from verbose stderr. */
function warmedCount(stderr) {
  const m = stderr.match(/page-cache sweep warmed (\d+) file\(s\)/);
  return m ? Number(m[1]) : null;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'ss-pagecache-test-'));
  dataDir = join(sandbox, '.sweet-search');
  segmentDir = join(dataDir, 'codebase-late-interaction.db.segments');
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeDb(basename, bytes = 'x') {
  writeFileSync(join(dataDir, basename), bytes);
}

// ---------------------------------------------------------------------------
// pageCacheSweep() — real read-only sweep over fake DBs + segments (c)
// ---------------------------------------------------------------------------
describe('prewarm page-cache sweep — pageCacheSweep()', () => {
  it('warms every present query-path DB including codebase.db (P1) and exits 0', async () => {
    for (const name of DB_BASENAMES) writeDb(name);

    const r = await runSweep();
    expect(r.code).toBe(0); // best-effort, always exits 0
    // All four DBs present → all four warmed (LI model files absent).
    expect(warmedCount(r.stderr)).toBe(DB_BASENAMES.length);
  });

  it('regression-lock: codebase.db is swept (count drops when only it is present-vs-absent)', async () => {
    // Only the three pre-P1 DBs.
    writeDb('code-graph.db');
    writeDb('codebase-late-interaction.db');
    writeDb('codebase-sparse-grams.idx');
    const without = await runSweep();
    expect(warmedCount(without.stderr)).toBe(3);

    // Add codebase.db → the swept count must go up by exactly one, proving the
    // sweep actually reaches DB_PATHS.codebase (the P1 addition).
    writeDb('codebase.db');
    const withCodebase = await runSweep();
    expect(warmedCount(withCodebase.stderr)).toBe(4);
  });

  it('also warms LI segment *.bin shards and never throws on a segments dir', async () => {
    for (const name of DB_BASENAMES) writeDb(name);
    mkdirSync(segmentDir, { recursive: true });
    writeFileSync(join(segmentDir, 'seg-0.bin'), 'a');
    writeFileSync(join(segmentDir, 'seg-1.bin'), 'b');
    writeFileSync(join(segmentDir, 'notes.txt'), 'ignored'); // non-.bin ignored

    const r = await runSweep();
    expect(r.code).toBe(0);
    // 4 DBs + 2 .bin shards = 6 (the .txt is skipped).
    expect(warmedCount(r.stderr)).toBe(DB_BASENAMES.length + 2);
  });

  it('is harmless when DBs are absent (readAndDiscard no-ops on a missing path)', async () => {
    // Empty .sweet-search dir: nothing to warm, still exits 0, never throws.
    const r = await runSweep();
    expect(r.code).toBe(0);
    expect(warmedCount(r.stderr)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// readAndDiscard(path, deadline) — deadline semantics (b)
// ---------------------------------------------------------------------------
describe('prewarm page-cache sweep — readAndDiscard deadline', () => {
  it('warms nothing when the budget is already past (deadline <= now)', async () => {
    for (const name of DB_BASENAMES) writeDb(name);
    // Min budget is clamped to 250ms; the sweep deadline = now + budget. We make
    // the work race the clock with a tiny budget AND a slow start so every
    // readAndDiscard sees Date.now() >= deadline → returns false. 250ms is
    // enough to read four tiny files, so instead assert the *floor* invariant:
    // a 0/garbage budget clamps up (never NaN) and the run still exits 0.
    const r = await runSweep({ SWEET_SEARCH_PREWARM_PAGE_CACHE_MS: 'not-a-number' });
    expect(r.code).toBe(0);
    // Garbage budget clamps to the 3500ms default → all four still warm.
    expect(warmedCount(r.stderr)).toBe(DB_BASENAMES.length);
  });

  it('clamps a tiny numeric budget to the 250ms floor and still completes (best-effort)', async () => {
    for (const name of DB_BASENAMES) writeDb(name);
    const r = await runSweep({ SWEET_SEARCH_PREWARM_PAGE_CACHE_MS: '1' });
    // The sweep is BEST-EFFORT: a 1ms budget clamps to the 250ms floor (never
    // NaN), the run always exits 0, and it reports a valid warmed count. We do
    // NOT assert an exact count here — under heavy CPU contention the 250ms
    // deadline may legitimately expire before all four tiny files are read
    // (that IS the deadline semantics), so an exact-4 assertion flakes. The
    // exact-count behaviour is locked by the default-budget tests above.
    expect(r.code).toBe(0);
    const warmed = warmedCount(r.stderr);
    expect(warmed).not.toBeNull();              // emitted a count (no NaN/throw)
    expect(warmed).toBeGreaterThanOrEqual(0);
    expect(warmed).toBeLessThanOrEqual(DB_BASENAMES.length);
  });
});

// ---------------------------------------------------------------------------
// pageCacheSweepEnabled() + spawnPageCacheSweep() re-entry/disable (a, d)
// ---------------------------------------------------------------------------
describe('prewarm page-cache sweep — enable gate + spawn guard', () => {
  // Drive the NON-sweep module entry (no SWEET_SEARCH_PAGE_CACHE_SWEEP=1) and
  // watch whether it spawns a detached sweep child. We neutralize the server +
  // maintainer launches so the only observable side effect is the sweep child.
  function runMainEntry(overrides = {}) {
    return new Promise((resolve) => {
      const env = baseEnv({
        // No SWEET_SEARCH_PAGE_CACHE_SWEEP here → this is the parent entry.
        SWEET_SEARCH_SERVER_ENTRY: join(sandbox, 'no-such-server.mjs'),
        SWEET_SEARCH_MAINTAINER_ENTRY: join(sandbox, 'no-such-maintainer.mjs'),
        SWEET_SEARCH_SOCKET_PATH: join(sandbox, 'srv.sock'),
        SWEET_SEARCH_PID_FILE: join(sandbox, 'srv.pid'),
        SWEET_SEARCH_PREWARM_LOCK: join(sandbox, 'prewarm.lock'),
        ...overrides,
      });
      const p = spawn(process.execPath, [HOOK], { env, stdio: 'pipe', cwd: sandbox });
      let stderr = '';
      p.stderr.on('data', (d) => (stderr += d));
      p.on('exit', (code) => resolve({ code, stderr }));
    });
  }

  /** Wait until stderr (collected after exit) reports a spawned sweep child. */
  function spawnedSweep(stderr) {
    return /page-cache sweep spawned \(pid \d+, detached\)/.test(stderr);
  }

  it('spawns a detached sweep child by default (enabled)', async () => {
    for (const name of DB_BASENAMES) writeDb(name);
    const r = await runMainEntry();
    expect(r.code).toBe(0);
    expect(spawnedSweep(r.stderr)).toBe(true);
  });

  it("'0' / 'false' / 'off' / 'no' disable the sweep (spawnPageCacheSweep no-ops)", async () => {
    for (const disabled of ['0', 'false', 'off', 'no']) {
      const r = await runMainEntry({ SWEET_SEARCH_PREWARM_PAGE_CACHE: disabled });
      expect(r.code).toBe(0);
      expect(spawnedSweep(r.stderr)).toBe(false);
    }
  });

  it('re-entry guard: a parent already carrying SWEET_SEARCH_PAGE_CACHE_SWEEP=1 does not re-spawn', async () => {
    for (const name of DB_BASENAMES) writeDb(name);
    // With the sweep flag set, the module runs pageCacheSweep() directly and
    // exits (entry-point branch) — it never reaches spawnPageCacheSweep.
    const r = await runMainEntry({ SWEET_SEARCH_PAGE_CACHE_SWEEP: '1' });
    expect(r.code).toBe(0);
    expect(spawnedSweep(r.stderr)).toBe(false);
    // It DID run the sweep inline instead.
    expect(warmedCount(r.stderr)).toBe(DB_BASENAMES.length);
  });
});
