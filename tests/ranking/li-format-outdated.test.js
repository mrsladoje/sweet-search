import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LateInteractionIndex, LI_FORMAT_OUTDATED_CODE } from '../../core/ranking/late-interaction-index.js';
import { hasCompleteBaseIndex, LI_FORMAT_OUTDATED } from '../../core/incremental-indexing/infrastructure/baseline-readiness.mjs';
import { buildConfigFingerprint } from '../../core/indexing/config-fingerprint.js';
import SweetSearch from '../../core/search/sweet-search.js';

// The LI reader reads only SSLX segments with per-token (or float32) docs. An index in a
// removed format (single-file JSON, LISE segments, per-document quantization) must fail
// cleanly: the search side runs without LI (one warning naming the rebuild), the maintainer's
// positions-only reader throws, and the baseline gate reports li-format-outdated.
describe('LI index in a removed format', () => {
  let dir;
  let indexPath;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ss-li-outdated-'));
    indexPath = join(dir, 'codebase-late-interaction.db');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  const jsonIndex = () => writeFileSync(indexPath, JSON.stringify({ version: '2.1', modelId: 'lateon-code', tokenDim: 4, documents: [{ id: 'a', tokens: [1, 2, 3, 4], numTokens: 1, dim: 4, min: 0, scale: 1 }] }));
  const liseIndex = () => {
    mkdirSync(`${indexPath}.segments`);
    writeFileSync(join(`${indexPath}.segments`, 'manifest.json'), JSON.stringify({ version: '3.0', format: 'segmented', modelId: 'lateon-code', tokenDim: 4, segments: [{ path: 'segment-0000.bin', count: 1 }] }));
    writeFileSync(indexPath, JSON.stringify({ version: '3.0', format: 'segmented', segmentDir: 'codebase-late-interaction.db.segments' }));
  };

  it('a single-file JSON index: no docs, flagged, one warning, no throw', async () => {
    jsonIndex();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 2; i++) {
      const index = new LateInteractionIndex({ indexPath, loadExisting: true });
      await index.init();
      expect(index.formatOutdated).toBe(true);
      expect(index.documents.size).toBe(0);
      expect(index._loadFailure.code).toBe(LI_FORMAT_OUTDATED_CODE);
    }
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('older format'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('sweet-search index --full');
  });

  it('LISE segments: flagged the same way; the positions-only reader throws', async () => {
    liseIndex();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const full = new LateInteractionIndex({ indexPath, loadExisting: true });
    await full.init();
    expect(full.formatOutdated).toBe(true);
    const writerView = new LateInteractionIndex({ indexPath, loadExisting: true, positionsOnly: true });
    await expect(writerView.init()).rejects.toMatchObject({ code: LI_FORMAT_OUTDATED_CODE });
  });

  it('per-document quantized docs in an SSLX segment: flagged', async () => {
    const writer = new LateInteractionIndex({ indexPath, loadExisting: false, tokenDim: 4, useInt8: true, quantBits: 8, modelId: 'lateon-code' });
    await writer.init();
    mkdirSync(`${indexPath}.segments`);
    const doc = { tokens: Int8Array.from([1, 2, 3, 4]), numTokens: 1, dim: 4, min: -1, scale: 0.01, tokenNorms: Float32Array.from([1]) };
    await writer._writeSegmentFile(join(`${indexPath}.segments`, 'segment-0000.bin'), new Map([['a', doc]]));
    writeFileSync(join(`${indexPath}.segments`, 'manifest.json'), JSON.stringify({ version: '3.0', format: 'sslx-v3', modelId: 'lateon-code', tokenDim: 4, useInt8: true, quantBits: 8, segments: [{ path: 'segment-0000.bin', count: 1 }] }));
    writeFileSync(indexPath, JSON.stringify({ version: '3.0', format: 'segmented', segmentDir: 'codebase-late-interaction.db.segments' }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const index = new LateInteractionIndex({ indexPath, loadExisting: true });
    await index.init();
    expect(index.formatOutdated).toBe(true);
    expect(index.documents.size).toBe(0);
  });

  it('the searcher turns LI off and keeps going', async () => {
    jsonIndex();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const searcher = new SweetSearch({
      projectRoot: dir,
      codebaseDbPath: join(dir, 'codebase.db'),
      graphDbPath: join(dir, 'code-graph.db'),
      binaryHnswPath: join(dir, 'absent.idx'),
      sparseGramIndexPath: join(dir, 'absent-sparse.idx'),
      lateInteractionOptions: { indexPath },
    });
    searcher._syncManifestPaths = () => {};
    searcher.useLateInteraction = true;
    await searcher._reloadManifestArtifacts({ epoch: 2 });
    expect(searcher.hasLateInteractionIndex).toBe(false);
    expect(searcher.useLateInteraction).toBe(false);
  });

  it('the baseline gate reports both formats', () => {
    const stateDir = dir;
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({ epoch: 1 }));
    writeFileSync(join(stateDir, 'codebase.db'), '');
    writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify({ version: '2.4', config_fingerprint: buildConfigFingerprint(), files: {} }));
    jsonIndex();
    expect(hasCompleteBaseIndex(stateDir)).toEqual({ ready: false, reason: LI_FORMAT_OUTDATED });
    rmSync(indexPath);
    liseIndex();
    expect(hasCompleteBaseIndex(stateDir)).toEqual({ ready: false, reason: LI_FORMAT_OUTDATED });
  });
});
