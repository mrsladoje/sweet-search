/**
 * Tests for core/incremental-indexing/infrastructure/sparse-gram-delta.mjs
 *
 * Plan § 7.6 / § 22.8:
 *   - Append-only delta segments organised by epoch.
 *   - Latest-wins resolution per fileId.
 *   - Deletion records mark the file as removed.
 *   - Size-stats provide ratio + segment count for the watermark.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fileIdFor,
  appendDeltaRecord,
  listDeltaSegments,
  resolveLatestRecords,
  recordFileDeletion,
  deltaSizeStats,
  FALLBACK_WEIGHTS_ID,
} from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';

describe('sparse-gram-delta', () => {
  let dir;
  let basePath;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-sparse-'));
    basePath = path.join(dir, 'codebase-sparse-grams.idx');
    fs.writeFileSync(basePath, Buffer.alloc(1024));
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('fileIdFor is deterministic and 16-hex chars', () => {
    expect(fileIdFor('src/a.js')).toBe(fileIdFor('src/a.js'));
    expect(fileIdFor('src/a.js')).toMatch(/^[a-f0-9]{16}$/);
  });

  it('appendDeltaRecord refuses without an epoch or fileId', () => {
    expect(() => appendDeltaRecord(basePath, 'x', { fileId: 'abc' })).toThrow();
    expect(() => appendDeltaRecord(basePath, 1, {})).toThrow();
  });

  it('persists records in `epoch-seq.ssgrmdelta` files', () => {
    appendDeltaRecord(basePath, 5, {
      fileId: fileIdFor('src/a.js'), filePath: 'src/a.js', contentHash: 'h1',
      deleted: false, symbolMask: 0, weightsId: FALLBACK_WEIGHTS_ID, grams: [],
    });
    const segs = listDeltaSegments(basePath);
    expect(segs.length).toBe(1);
    expect(segs[0].epoch).toBe(5);
    expect(segs[0].seq).toBe(0);
  });

  it('resolveLatestRecords prefers the newer record per fileId', () => {
    const id = fileIdFor('src/a.js');
    appendDeltaRecord(basePath, 1, {
      fileId: id, filePath: 'src/a.js', contentHash: 'old', deleted: false,
      symbolMask: 0, weightsId: FALLBACK_WEIGHTS_ID, grams: [],
    });
    appendDeltaRecord(basePath, 2, {
      fileId: id, filePath: 'src/a.js', contentHash: 'new', deleted: false,
      symbolMask: 0, weightsId: FALLBACK_WEIGHTS_ID, grams: [],
    });
    const map = resolveLatestRecords(basePath);
    expect(map.size).toBe(1);
    expect(map.get(id).record.contentHash).toBe('new');
    expect(map.get(id).epoch).toBe(2);
  });

  it('recordFileDeletion writes a deleted record', () => {
    recordFileDeletion(basePath, 3, 'src/a.js');
    const map = resolveLatestRecords(basePath);
    expect(map.get(fileIdFor('src/a.js')).record.deleted).toBe(true);
  });

  it('deltaSizeStats reports ratio + segment count', () => {
    appendDeltaRecord(basePath, 1, {
      fileId: 'a', filePath: 'a', contentHash: 'h', deleted: false,
      symbolMask: 0, weightsId: 'x', grams: [],
    });
    appendDeltaRecord(basePath, 2, {
      fileId: 'b', filePath: 'b', contentHash: 'h', deleted: false,
      symbolMask: 0, weightsId: 'x', grams: [],
    });
    const stats = deltaSizeStats(basePath);
    expect(stats.deltaSegments).toBe(2);
    expect(stats.deltaBytes).toBeGreaterThan(0);
    expect(stats.baseBytes).toBe(1024);
    expect(stats.ratio).toBeGreaterThan(0);
    expect(stats.ratio).toBeLessThan(1);
  });
});
