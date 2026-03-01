import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Hoisted mocks (available to vi.mock factories)
const mockSpawn = vi.hoisted(() => vi.fn());
const mockUnlink = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('fs/promises', () => ({
  default: { unlink: mockUnlink },
}));

import { indexCorpus } from '../../eval/lib/indexer.js';

function createMockChild(exitCode = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setTimeout(() => child.emit('close', exitCode), 0);
  return child;
}

describe('indexCorpus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSpawn.mockImplementation(() => createMockChild(0));
    mockUnlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('default single-pass mode spawns once with --quiet', async () => {
    await indexCorpus('/corpus', '/project');

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--quiet');
    expect(args).not.toContain('--graph-only');
    expect(args).not.toContain('--vectors-only');
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('two-phase mode spawns twice with correct flags', async () => {
    await indexCorpus('/corpus', '/project', { indexMode: 'two-phase' });

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Phase 1: graph-only
    const args1 = mockSpawn.mock.calls[0][1];
    expect(args1).toContain('--graph-only');
    expect(args1).toContain('--quiet');

    // Phase 2: vectors-only
    const args2 = mockSpawn.mock.calls[1][1];
    expect(args2).toContain('--vectors-only');
    expect(args2).toContain('--quiet');

    // Merkle state deleted between phases
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink.mock.calls[0][0]).toContain('merkle-state.json');
  });

  it('buildLateInteraction=false passes --no-late-interaction', async () => {
    await indexCorpus('/corpus', '/project', { buildLateInteraction: false });

    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--no-late-interaction');
  });

  it('buildLateInteraction=true (default) does not pass --no-late-interaction', async () => {
    await indexCorpus('/corpus', '/project');

    const args = mockSpawn.mock.calls[0][1];
    expect(args).not.toContain('--no-late-interaction');
  });

  it('sqliteFastMode=true sets env variable', async () => {
    await indexCorpus('/corpus', '/project', { sqliteFastMode: true });

    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.SWEET_SEARCH_SQLITE_FAST_MODE).toBe('1');
  });

  it('sqliteFastMode=false (default) does not set env variable', async () => {
    // Remove from process.env to ensure clean test
    const original = process.env.SWEET_SEARCH_SQLITE_FAST_MODE;
    delete process.env.SWEET_SEARCH_SQLITE_FAST_MODE;

    await indexCorpus('/corpus', '/project');

    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.SWEET_SEARCH_SQLITE_FAST_MODE).toBeUndefined();

    // Restore
    if (original !== undefined) process.env.SWEET_SEARCH_SQLITE_FAST_MODE = original;
  });

  it('sqliteFastMode=false strips inherited env variable from child process', async () => {
    const original = process.env.SWEET_SEARCH_SQLITE_FAST_MODE;
    process.env.SWEET_SEARCH_SQLITE_FAST_MODE = '1';

    await indexCorpus('/corpus', '/project', { sqliteFastMode: false });

    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.SWEET_SEARCH_SQLITE_FAST_MODE).toBeUndefined();

    if (original === undefined) {
      delete process.env.SWEET_SEARCH_SQLITE_FAST_MODE;
    } else {
      process.env.SWEET_SEARCH_SQLITE_FAST_MODE = original;
    }
  });

  it('requireNativeAnn=true forwards --require-native-ann', async () => {
    await indexCorpus('/corpus', '/project', { requireNativeAnn: true });
    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--require-native-ann');
  });

  it('returns timing info with correct shape', async () => {
    const result = await indexCorpus('/corpus', '/project');

    expect(result).toHaveProperty('elapsed');
    expect(result).toHaveProperty('indexMode');
    expect(result).toHaveProperty('timings');
    expect(result.timings).toHaveProperty('total');
    expect(result.timings).toHaveProperty('graphPhase');
    expect(result.timings).toHaveProperty('vectorsPhase');
    expect(typeof result.elapsed).toBe('number');
    expect(typeof result.timings.total).toBe('number');
  });

  it('single mode returns null for phase timings', async () => {
    const result = await indexCorpus('/corpus', '/project');

    expect(result.indexMode).toBe('single');
    expect(result.timings.graphPhase).toBeNull();
    expect(result.timings.vectorsPhase).toBeNull();
  });

  it('two-phase mode returns non-null phase timings', async () => {
    const result = await indexCorpus('/corpus', '/project', { indexMode: 'two-phase' });

    expect(result.indexMode).toBe('two-phase');
    expect(typeof result.timings.graphPhase).toBe('number');
    expect(typeof result.timings.vectorsPhase).toBe('number');
  });

  it('two-phase with buildLateInteraction=false passes --no-late-interaction only to vectors phase', async () => {
    await indexCorpus('/corpus', '/project', { indexMode: 'two-phase', buildLateInteraction: false });

    // Phase 1 (graph) should NOT have --no-late-interaction
    const args1 = mockSpawn.mock.calls[0][1];
    expect(args1).not.toContain('--no-late-interaction');

    // Phase 2 (vectors) should have --no-late-interaction
    const args2 = mockSpawn.mock.calls[1][1];
    expect(args2).toContain('--no-late-interaction');
  });

  // initSearch requires a real SweetSearch instance with database files.
  // Testing it properly needs integration tests with an actual indexed corpus.
  // Skipping unit test here as mocking the dynamic import is fragile.
});
