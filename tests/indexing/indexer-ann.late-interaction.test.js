import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = path.join(os.tmpdir(), `sweet-search-indexer-ann-${process.pid}`);
const defaultLiPath = path.join(tmpRoot, 'codebase-late-interaction.db');

vi.mock('../../core/late-interaction-model.js', () => ({
  encodeDocuments: vi.fn(async (texts) => texts.map(() => [
    new Float32Array([1, 0, 0, 0]),
    new Float32Array([0, 1, 0, 0]),
  ])),
}));
vi.mock('../../core/ranking/late-interaction-model.js', () => ({
  encodeDocuments: vi.fn(async (texts) => texts.map(() => [
    new Float32Array([1, 0, 0, 0]),
    new Float32Array([0, 1, 0, 0]),
  ])),
}));

vi.mock('../../core/config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DB_PATHS: {
      ...actual.DB_PATHS,
      lateInteraction: defaultLiPath,
    },
    LATE_INTERACTION_CONFIG: {
      ...actual.LATE_INTERACTION_CONFIG,
      enabled: true,
      tokenDimension: 4,
      model: 'test-li',
    },
  };
});
vi.mock('../../core/infrastructure/config/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DB_PATHS: {
      ...actual.DB_PATHS,
      lateInteraction: defaultLiPath,
    },
    LATE_INTERACTION_CONFIG: {
      ...actual.LATE_INTERACTION_CONFIG,
      enabled: true,
      tokenDimension: 4,
      model: 'test-li',
    },
  };
});

describe('buildLateInteractionIndex', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns removed=0 when building from scratch with no removals', async () => {
    const { buildLateInteractionIndex } = await import('../../core/indexing/indexer-ann.js');

    const result = await buildLateInteractionIndex([
      {
        id: 'src/a.ts:1-2:0',
        file: 'src/a.ts',
        text: 'const a = 1;',
        metadata: { symbol: 'a', chunk_type: 'code', line_start: 1, line_end: 2 },
      },
    ], false, [], {
      saveToPath: defaultLiPath,
    });

    expect(result.removed).toBe(0);
    expect(result.added).toBe(1);
    expect(result.documents).toBe(1);

    const saved = JSON.parse(await fs.readFile(defaultLiPath, 'utf8'));
    expect(saved.documents).toHaveLength(1);
    expect(saved.documents[0].metadata.file).toBe('src/a.ts');
  });

  it('applies removals against an existing LI index', async () => {
    const { buildLateInteractionIndex } = await import('../../core/indexing/indexer-ann.js');

    await buildLateInteractionIndex([
      {
        id: 'src/remove.ts:1-2:0',
        file: 'src/remove.ts',
        text: 'const oldValue = 1;',
        metadata: { symbol: 'oldValue', chunk_type: 'code', line_start: 1, line_end: 2 },
      },
    ], false, [], {
      saveToPath: defaultLiPath,
    });

    const updatedPath = path.join(tmpRoot, 'updated-late-interaction.db');
    const result = await buildLateInteractionIndex([], false, ['src/remove.ts'], {
      loadFromPath: defaultLiPath,
      saveToPath: updatedPath,
    });

    expect(result.removed).toBe(1);
    expect(result.added).toBe(0);
    expect(result.documents).toBe(0);

    const saved = JSON.parse(await fs.readFile(updatedPath, 'utf8'));
    expect(saved.documents).toHaveLength(0);
  });

  it('buckets LI batches by estimated length to reduce padding waste', async () => {
    const { buildLateInteractionIndex } = await import('../../core/indexing/indexer-ann.js');
    const liModel = await import('../../core/ranking/late-interaction-model.js');

    await buildLateInteractionIndex([
      {
        id: 'src/long-a.ts:1-10:0',
        file: 'src/long-a.ts',
        text: 'x'.repeat(4000),
        metadata: { symbol: 'longA', chunk_type: 'code', line_start: 1, line_end: 10 },
      },
      {
        id: 'src/short-a.ts:1-2:0',
        file: 'src/short-a.ts',
        text: 'const a = 1;',
        metadata: { symbol: 'shortA', chunk_type: 'code', line_start: 1, line_end: 2 },
      },
      {
        id: 'src/short-b.ts:1-2:0',
        file: 'src/short-b.ts',
        text: 'const b = 2;',
        metadata: { symbol: 'shortB', chunk_type: 'code', line_start: 1, line_end: 2 },
      },
      {
        id: 'src/long-b.ts:1-10:0',
        file: 'src/long-b.ts',
        text: 'y'.repeat(4200),
        metadata: { symbol: 'longB', chunk_type: 'code', line_start: 1, line_end: 10 },
      },
    ], false, [], {
      saveToPath: defaultLiPath,
      batchSize: 2,
      // With the dynamic batchSizeUpperCap introduced for short-chunk
      // bucketing, `batchSize` is a baseline, not a hard cap. Pin both to 2
      // so the test exercises the strict 2-2 split it was written for.
      batchSizeUpperCap: 2,
      tokenBudget: 10_000,
      // The attention-budget constraint (seq² × batch) would otherwise bind
      // before the hard cap for these tiny inputs; disable it here to keep
      // the test focused on length-bucketing behavior.
      attentionBudget: 0,
    });

    expect(liModel.encodeDocuments).toHaveBeenCalledTimes(2);
    expect(liModel.encodeDocuments.mock.calls[0][0]).toEqual(['const a = 1;', 'const b = 2;']);
    expect(liModel.encodeDocuments.mock.calls[1][0]).toEqual(['x'.repeat(4000), 'y'.repeat(4200)]);
  });
});
