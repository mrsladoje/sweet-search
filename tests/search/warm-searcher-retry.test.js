/**
 * getWarmSearcher keeps one SweetSearch per process (the MCP server searches through it).
 * It kept the promise of the first init for the life of the process, so an init that failed
 * once (the first search ran before the project had an index) failed every later search with
 * the same error, after the index was built, until the MCP server restarted.
 * See docs/STATE_MACHINES.md, machine "Warm searcher singleton".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let sandbox;
let options;
let mod;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'ss-warm-searcher-'));
  const stateDir = join(sandbox, '.sweet-search');
  mkdirSync(stateDir, { recursive: true });
  // Every artifact path inside the sandbox: construction never touches the real repository.
  options = {
    projectRoot: sandbox,
    codebaseDbPath: join(stateDir, 'codebase.db'),
    graphDbPath: join(stateDir, 'code-graph.db'),
    hnswPath: join(stateDir, 'codebase-hnsw.idx'),
    binaryHnswPath: join(stateDir, 'codebase-binary-hnsw.idx'),
    sparseGramIndexPath: join(stateDir, 'codebase-sparse-grams.idx'),
  };
  vi.resetModules(); // a fresh singleton per test
  mod = await import('../../core/search/sweet-search.js');
});

afterEach(() => {
  vi.restoreAllMocks();
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('getWarmSearcher — a failed init is not kept', () => {
  it('initializes again on the next call after an init that failed', async () => {
    // No index in the sandbox: the real init refuses.
    await expect(mod.getWarmSearcher(options)).rejects.toThrow(/No search indexes found/);

    // The index was built since. The loads are stubbed; the test is on the retry alone.
    const init = vi.spyOn(mod.SweetSearch.prototype, 'init').mockImplementation(async function init() {
      this.initialized = true;
    });
    const searcher = await mod.getWarmSearcher(options);

    expect(init).toHaveBeenCalledTimes(1);
    expect(searcher.initialized).toBe(true);
  });

  it('gives every caller that waited on a failing init the error, then starts over once', async () => {
    const results = await Promise.allSettled([mod.getWarmSearcher(options), mod.getWarmSearcher(options)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);

    const init = vi.spyOn(mod.SweetSearch.prototype, 'init').mockImplementation(async function init() {
      this.initialized = true;
    });
    const [a, b] = await Promise.all([mod.getWarmSearcher(options), mod.getWarmSearcher(options)]);

    expect(init).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.initialized).toBe(true);
  });

  it('shares one init between concurrent first callers and returns the same searcher after', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const init = vi.spyOn(mod.SweetSearch.prototype, 'init').mockImplementation(async function init() {
      await gate;
      this.initialized = true;
    });
    const first = mod.getWarmSearcher(options);
    const second = mod.getWarmSearcher(options);
    release();
    const [a, b] = await Promise.all([first, second]);
    const c = await mod.getWarmSearcher(options);

    expect(init).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });
});
