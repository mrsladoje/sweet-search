// Structural tests proving legacy mode (no reconcile-manifest.json) keeps
// the incremental-indexing read paths dormant. These prevent regression of
// the Codex v2 hot-path overhead: per-query manifest probes from heartbeat
// and sparse-overlay subsystems.
//
// All assertions are call-count or behavior based, not wall-clock — durable
// across machines and CI runners (no flaky perf thresholds).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  beginPinnedRead,
  endPinnedRead,
  _resetManifestAbsentCache,
} from '../../core/search/search-reader-pin.js';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('legacy-mode dormant paths (no reconcile-manifest.json)', () => {
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
