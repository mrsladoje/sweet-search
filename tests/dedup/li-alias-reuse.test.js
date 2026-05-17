import { describe, it, expect } from 'vitest';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function makeIndex() {
  const dir = await mkdtemp(join(tmpdir(), 'li-alias-test-'));
  const indexPath = join(dir, 'li.db');
  const idx = new LateInteractionIndex({
    indexPath,
    tokenDim: 4,
    maxTokens: 16,
    quantBits: 32,
    loadExisting: false,
  });
  await idx.init();
  return { idx, indexPath, dir };
}

describe('LI alias reuse', () => {
  it('alias dereferences to exemplar tokens', async () => {
    const { idx, dir } = await makeIndex();
    try {
      await idx.add('chunk-a', [[1, 0, 0, 0], [0, 1, 0, 0]], {});
      idx.addAlias('chunk-b', 'chunk-a', 'cluster-xyz', {});
      const a = idx.getTokens('chunk-a');
      const b = idx.getTokens('chunk-b');
      expect(a).toEqual(b);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('alias survives save/load round-trip via sidecar', async () => {
    const { idx, indexPath, dir } = await makeIndex();
    try {
      await idx.add('chunk-a', [[1, 1, 1, 1]], {});
      idx.addAlias('chunk-b', 'chunk-a', 'cluster-xyz', {
        file: 'alias.js',
        startLine: 7,
        endLine: 9,
        type: 'function',
        name: 'aliasFn',
      });
      await idx.save();

      const reloaded = new LateInteractionIndex({ indexPath, tokenDim: 4, maxTokens: 16, quantBits: 32 });
      await reloaded.init();
      expect(reloaded.aliasPointers.size).toBe(1);
      expect(reloaded.aliasPointers.get('chunk-b').exemplarId).toBe('chunk-a');
      expect(reloaded.aliasPointers.get('chunk-b').metadata).toMatchObject({
        file: 'alias.js',
        startLine: 7,
        endLine: 9,
        type: 'function',
        name: 'aliasFn',
      });
      expect(reloaded.getTokens('chunk-b')).toEqual(reloaded.getTokens('chunk-a'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hasTokens returns alias ids when the exemplar is loaded', async () => {
    const { idx, dir } = await makeIndex();
    try {
      await idx.add('chunk-a', [[1, 0, 0, 0]], {});
      idx.addAlias('chunk-b', 'chunk-a', 'cluster-xyz', {});
      const available = idx.hasTokens(['chunk-a', 'chunk-b', 'chunk-c']);
      expect(available.has('chunk-a')).toBe(true);
      expect(available.has('chunk-b')).toBe(true);
      expect(available.has('chunk-c')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('getTokensFlat dereferences for aliases', async () => {
    const { idx, dir } = await makeIndex();
    try {
      await idx.add('chunk-a', [[1, 2, 3, 4], [5, 6, 7, 8]], {});
      idx.addAlias('chunk-b', 'chunk-a', 'cluster-xyz', {});
      const flatA = idx.getTokensFlat('chunk-a');
      const flatB = idx.getTokensFlat('chunk-b');
      expect(flatB.numTokens).toBe(flatA.numTokens);
      expect(flatB.dim).toBe(flatA.dim);
      expect(Array.from(flatB.flat)).toEqual(Array.from(flatA.flat));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('scoreWithLateInteraction scores alias candidates through exemplar tokens', async () => {
    const { idx, dir } = await makeIndex();
    try {
      await idx.add('chunk-a', [[1, 0, 0, 0]], {});
      idx.addAlias('chunk-b', 'chunk-a', 'cluster-xyz', {});

      const scored = await idx.scoreWithLateInteraction(
        [[1, 0, 0, 0]],
        [{ id: 'chunk-b', score: 0.01 }],
      );

      expect(scored).toHaveLength(1);
      expect(scored[0].id).toBe('chunk-b');
      expect(scored[0].lateInteractionScore).toBeGreaterThan(0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
