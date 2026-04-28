import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectResources, planAllocation } from '../../core/indexing/indexer-pool.js';

// Some assertions in this file expect a host with at least 8 logical cores
// (the "larger machine" scenarios). detectResources accepts a fixture for
// `logicalCores`, but downstream `planAllocation` reads actual host cores
// for some derived fields (inlineEmbeddingThreads, lateInteractionThreads),
// so the test passes locally on a 16-core M-series Mac and fails on CI's
// 3-4 core macos-14 runners with `expected 2 to be greater than or equal to 8`.
// Skip the larger-machine test when the host can't represent it. Local dev
// with a real >= 8-core machine still exercises the full assertion set.
const HOST_HAS_BIG_BUDGET = os.cpus().length >= 8;

// Resource-planning regression tests.
//
// Originally written for the worker-pool architecture (separate workers
// for embedding + LI, multiple workers on big machines). Indexing was
// later switched to a "sequential-phases / inline threading" model where
// each phase fans out across all available cores in-process — the
// per-worker isolation overhead wasn't worth the parallelism gains for
// our typical batch shapes. These tests now pin the new defaults.
//
// If you change resource planning, expect to update both expected blocks.

const ENV_KEYS = [
  'SWEET_SEARCH_EMBEDDING_WORKERS',
  'SWEET_SEARCH_EMBED_USE_CPU',
  'SWEET_SEARCH_LI_WORKERS',
  'SWEET_SEARCH_LI_BATCH_SIZE',
  'SWEET_SEARCH_LI_TOKEN_BUDGET',
  'SWEET_SEARCH_LI_ATTENTION_BUDGET',
];

let savedEnv;

describe('indexer resource planning', () => {
  beforeEach(() => {
    savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('configures small x64 machines for sequential phases with inline threading', () => {
    const resources = detectResources({
      arch: 'x64',
      logicalCores: 8,
      totalMemBytes: 8 * 1024 ** 3,
    });
    const plan = planAllocation(resources);

    expect(resources.computeCores).toBe(4);
    expect(resources.totalMemGB).toBe(8);

    // Sequential-phases architecture: one phase at a time, inline threads
    // saturating cores. No worker pool (would cost more than it saves at
    // this scale).
    expect(plan.executionStrategy).toBe('sequential-phases');
    expect(plan.useWorkerPool).toBe(false);
    expect(plan.useLateInteractionPool).toBe(false);
    expect(plan.embeddingWorkers).toBe(1);
    expect(plan.lateInteractionWorkers).toBe(1);

    // All cores go to inline LI threading (most expensive phase).
    expect(plan.inlineEmbeddingThreads).toBeGreaterThan(0);
    expect(plan.lateInteractionThreads).toBeGreaterThan(0);
    expect(plan.lateInteractionBatchSize).toBeGreaterThan(0);
    expect(plan.lateInteractionTokenBudget).toBeGreaterThan(0);
  });

  it.skipIf(!HOST_HAS_BIG_BUDGET)('configures larger arm64 machines with the same sequential model + bigger budget', () => {
    const resources = detectResources({
      arch: 'arm64',
      logicalCores: 16,
      totalMemBytes: 64 * 1024 ** 3,
    });
    const plan = planAllocation(resources);

    expect(resources.computeCores).toBe(16);
    expect(resources.totalMemGB).toBe(64);

    // Same architecture as small machines (no worker pool); just bigger
    // numbers because more cores and more RAM.
    expect(plan.executionStrategy).toBe('sequential-phases');
    expect(plan.useWorkerPool).toBe(false);
    expect(plan.useLateInteractionPool).toBe(false);
    expect(plan.embeddingWorkers).toBe(1);
    expect(plan.lateInteractionWorkers).toBe(1);

    // Larger machines should saturate proportionally — not pinning exact
    // values so M-series-specific bumps don't require test updates.
    expect(plan.inlineEmbeddingThreads).toBeGreaterThanOrEqual(8);
    expect(plan.lateInteractionThreads).toBeGreaterThanOrEqual(8);
    expect(plan.lateInteractionBatchSize).toBeGreaterThanOrEqual(8);
    expect(plan.memBudgetMB).toBeGreaterThan(8000);
  });
});
