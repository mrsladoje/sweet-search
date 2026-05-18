// Structural tests proving legacy mode (no reconcile-manifest.json) keeps
// the incremental-indexing read paths dormant. These prevent regression of
// the Codex v2 hot-path overhead: per-query manifest probes from heartbeat
// and sparse-overlay subsystems.
//
// All assertions are call-count or behavior based, not wall-clock — durable
// across machines and CI runners (no flaky perf thresholds).
//
// Also documents the explicit decision NOT to negative-cache absent stale
// bitmaps in HNSW/BinaryHNSW/LI: that contract is required for long-lived
// in-process readers to observe writer-side tombstones from the production
// reconciler. See `tests/ranking/late-interaction-model.test.js` →
// 'honors stale bitmap changes during scoring for long-lived LI readers'.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { HNSWIndex } from '../../core/vector-store/hnsw-index.js';
import {
  beginPinnedRead,
  endPinnedRead,
  _resetManifestAbsentCache,
} from '../../core/search/search-reader-pin.js';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('legacy-mode dormant paths (no reconcile-manifest.json)', () => {
  describe('HNSW stale-bitmap long-lived reader contract', () => {
    let dir;

    beforeEach(() => {
      dir = tmpDir('hnsw-long-lived-');
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // Documents the explicit decision NOT to negative-cache absent HNSW stale
    // bitmaps. The production reconciler creates its own HNSWIndex instance
    // (see core/incremental-indexing/application/production-reconciler.mjs)
    // and writes stale.bin from there. The search server's long-lived
    // HNSWIndex reader is a different instance and must re-probe each call
    // so writer-side tombstones become visible without an artifact swap.
    it('does NOT cache absent stale bitmap across calls', () => {
      const idx = new HNSWIndex({
        indexPath: path.join(dir, 'codebase-hnsw.idx'),
        stalePath: path.join(dir, 'codebase-hnsw.idx.stale.bin'),
        dimension: 4,
      });
      expect(idx._loadStaleBitmap()).toBe(null);
      expect(idx._staleBitmapAbsent).toBeFalsy();
      // Writer creates sidecar out-of-band
      fs.mkdirSync(path.dirname(idx.stalePath), { recursive: true });
      const { createBitmap, saveBitmap, setBit } =
        require('../../core/infrastructure/tombstone-bitmap-reader.js');
      const bitmap = createBitmap(8);
      setBit(bitmap, 0);
      saveBitmap(idx.stalePath, bitmap);
      // Long-lived reader must observe the new bitmap on next call
      const observed = idx._loadStaleBitmap();
      expect(observed).not.toBe(null);
    });
  });

  describe('reader-pin heartbeat dormancy', () => {
    let dir, readSpy;

    beforeEach(() => {
      _resetManifestAbsentCache();
      dir = tmpDir('reader-pin-legacy-');
      readSpy = vi.spyOn(fs, 'readFileSync');
    });
    afterEach(() => {
      readSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does not read the manifest when caller passes epoch=null', () => {
      const pin = beginPinnedRead({ stateDir: dir, epoch: null });
      expect(pin).toBe(null);
      const manifestReads = readSpy.mock.calls.filter(
        (c) => String(c[0]).endsWith('reconcile-manifest.json'),
      ).length;
      expect(manifestReads).toBe(0);
    });

    it('reads the manifest at most once per stateDir within the absent TTL', () => {
      // First call with no epoch hint — must probe disk once
      const pin1 = beginPinnedRead({ stateDir: dir });
      expect(pin1).toBe(null);
      const firstReads = readSpy.mock.calls.filter(
        (c) => String(c[0]).endsWith('reconcile-manifest.json'),
      ).length;
      // readManifest may use either readFileSync or other I/O — assert at most one,
      // and verify subsequent calls don't add more.
      expect(firstReads).toBeLessThanOrEqual(1);

      for (let i = 0; i < 10; i++) {
        const p = beginPinnedRead({ stateDir: dir });
        expect(p).toBe(null);
      }
      const afterTen = readSpy.mock.calls.filter(
        (c) => String(c[0]).endsWith('reconcile-manifest.json'),
      ).length;
      expect(afterTen).toBe(firstReads);
    });

    it('endPinnedRead with null is safe', () => {
      expect(() => endPinnedRead(null)).not.toThrow();
    });
  });

});
