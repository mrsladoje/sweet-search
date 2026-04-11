import { describe, expect, it } from 'vitest';
import { detectResources, planAllocation } from '../../core/indexing/indexer-pool.js';

describe('indexer resource planning', () => {
  it('keeps small x64 machines on a single inline embedding session', () => {
    const resources = detectResources({
      arch: 'x64',
      logicalCores: 8,
      totalMemBytes: 8 * 1024 ** 3,
    });
    const plan = planAllocation(resources);

    expect(resources.computeCores).toBe(4);
    expect(plan.executionStrategy).toBe('sequential-phases');
    expect(plan.useWorkerPool).toBe(false);
    expect(plan.embeddingWorkers).toBe(1);
    expect(plan.inlineEmbeddingThreads).toBe(3);
    expect(plan.useLateInteractionPool).toBe(false);
    expect(plan.lateInteractionWorkers).toBe(1);
    expect(plan.lateInteractionThreads).toBe(3);
    expect(plan.lateInteractionBatchSize).toBe(2);
    expect(plan.lateInteractionTokenBudget).toBe(4096);
  });

  it('scales embedding and LI workers on larger machines', () => {
    const resources = detectResources({
      arch: 'arm64',
      logicalCores: 16,
      totalMemBytes: 64 * 1024 ** 3,
    });
    const plan = planAllocation(resources);

    expect(resources.computeCores).toBe(16);
    expect(plan.useWorkerPool).toBe(true);
    expect(plan.embeddingWorkers).toBe(2);
    expect(plan.threadsPerEmbeddingWorker).toBe(8);
    expect(plan.useLateInteractionPool).toBe(true);
    expect(plan.lateInteractionWorkers).toBe(2);
    expect(plan.threadsPerLateInteractionWorker).toBe(8);
    expect(plan.lateInteractionThreads).toBe(8);
    expect(plan.lateInteractionBatchSize).toBe(8);
    expect(plan.lateInteractionTokenBudget).toBe(12288);
  });
});
