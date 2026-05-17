/**
 * Tests for core/incremental-indexing/infrastructure/manifest.mjs
 *
 * Plan § 8.1:
 *   - zeroManifest has every tier slot with epoch 0.
 *   - writeManifest is atomic (no torn writes) and survives a missing
 *     directory.
 *   - readManifest tolerates a corrupted file by returning null.
 *   - buildNextManifest carries forward unchanged tiers under the new epoch.
 *   - epochVisibilityPredicate emits the SQL fragment from § 8.1.1.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MANIFEST_FILENAME,
  zeroManifest,
  readManifest,
  writeManifest,
  buildNextManifest,
  epochVisibilityPredicate,
} from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import { FALLBACK_WEIGHTS_ID } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';

describe('manifest / zero state', () => {
  it('produces every tier slot at epoch 0', () => {
    const m = zeroManifest({});
    expect(m.epoch).toBe(0);
    for (const key of ['codeGraph', 'vectors', 'hnsw', 'binaryHnsw', 'lateInteraction', 'sparseGram']) {
      expect(m[key].epoch).toBe(0);
    }
    expect(m.sparseGram.weightsId).toBe(FALLBACK_WEIGHTS_ID);
  });
});

describe('manifest / write + read round-trip', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-manifest-'));
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('writes and re-reads an identical manifest', () => {
    const m = zeroManifest({});
    writeManifest(dir, m);
    expect(fs.existsSync(path.join(dir, MANIFEST_FILENAME))).toBe(true);
    const round = readManifest(dir);
    expect(round.epoch).toBe(0);
    expect(round.codeGraph.path).toBe(m.codeGraph.path);
  });

  it('returns null when the manifest is missing', () => {
    expect(readManifest(dir)).toBeNull();
  });

  it('returns null on a corrupted manifest', () => {
    fs.writeFileSync(path.join(dir, MANIFEST_FILENAME), '{ not json');
    expect(readManifest(dir)).toBeNull();
  });

  it('creates the state directory on first write', () => {
    const nested = path.join(dir, 'a', 'b', 'c');
    writeManifest(nested, zeroManifest({}));
    expect(fs.existsSync(path.join(nested, MANIFEST_FILENAME))).toBe(true);
  });

  it('cleans up the temp file after a successful publish', () => {
    writeManifest(dir, zeroManifest({}));
    const tmp = path.join(dir, MANIFEST_FILENAME + '.tmp');
    expect(fs.existsSync(tmp)).toBe(false);
  });
});

describe('manifest / buildNextManifest', () => {
  it('carries forward unchanged tiers with the new epoch', () => {
    const prev = zeroManifest({});
    const next = buildNextManifest(prev, { epoch: 7, tiers: {} });
    expect(next.epoch).toBe(7);
    for (const key of ['codeGraph', 'vectors', 'hnsw', 'binaryHnsw', 'lateInteraction', 'sparseGram']) {
      expect(next[key].epoch).toBe(7);
      expect(next[key].path || next[key].base || next[key].manifest)
        .toBe(prev[key].path || prev[key].base || prev[key].manifest);
    }
  });

  it('overlays tier-specific changes', () => {
    const prev = zeroManifest({});
    const next = buildNextManifest(prev, {
      epoch: 12,
      tiers: {
        sparseGram: { deltas: ['codebase-sparse-grams.idx.deltas/12-0.ssgrmdelta'] },
      },
    });
    expect(next.sparseGram.deltas).toEqual(['codebase-sparse-grams.idx.deltas/12-0.ssgrmdelta']);
    expect(next.sparseGram.epoch).toBe(12);
  });

  it('rejects non-integer epochs', () => {
    expect(() => buildNextManifest(zeroManifest({}), { epoch: 1.5 })).toThrow();
  });
});

describe('manifest / epochVisibilityPredicate', () => {
  it('emits the unaliased form', () => {
    expect(epochVisibilityPredicate()).toBe(
      'epoch_written <= :manifestEpoch AND (epoch_retired IS NULL OR epoch_retired > :manifestEpoch)',
    );
  });

  it('emits a table-qualified form', () => {
    expect(epochVisibilityPredicate('v')).toBe(
      'v.epoch_written <= :manifestEpoch AND (v.epoch_retired IS NULL OR v.epoch_retired > :manifestEpoch)',
    );
  });

  it('accepts aliases with a trailing dot', () => {
    expect(epochVisibilityPredicate('v.')).toBe(
      'v.epoch_written <= :manifestEpoch AND (v.epoch_retired IS NULL OR v.epoch_retired > :manifestEpoch)',
    );
  });
});
