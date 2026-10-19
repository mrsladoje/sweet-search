import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { bareGrep } from '../../core/search/search-pattern.js';
import { _resetChangedGrepFilesCache } from '../../core/indexing/grep-corpus.js';

describe('bareGrep zero-hit epoch retry', () => {
  let root;
  beforeEach(() => {
    _resetChangedGrepFilesCache();
    root = mkdtempSync(join(tmpdir(), 'ss-epoch-retry-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.go'), 'func Fresh() {}\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function searcher(firstEpochResult) {
    let epoch = 1;
    const hit = { matches: [{ file: 'src/a.go', line: 1, matchText: 'Fresh', content: 'func Fresh() {}' }], candidateFiles: 1, totalFiles: 1, scannedFiles: 1 };
    const empty = { matches: [], candidateFiles: 0, totalFiles: 1, scannedFiles: 1 };
    const search = vi.fn(() => {
      if (epoch === 1) {
        epoch = firstEpochResult.bump ? 2 : 1; // a tick publishes while this search runs
        return empty;
      }
      return hit;
    });
    return {
      projectRoot: root,
      sparseGramIndexPath: join(root, 'absent-sparse.idx'),
      sparseGramIndex: { searchFull: search, searchLines: search, getAllFiles: () => ['src/a.go'] },
      _readReconcileManifest: () => ({ epoch }),
      search,
    };
  }

  it('searches again when a tick published during a zero-hit search', async () => {
    const s = searcher({ bump: true });
    const out = await bareGrep.call(s, 'Fresh', null, {});
    expect(out.results.map((r) => r.file)).toEqual(['src/a.go']);
  });

  it('compares against the epoch the refresh pinned, not a later read of the manifest', async () => {
    // The refresh pins epoch 1, then a tick publishes epoch 2 before bareGrep looks again.
    let disk = 1;
    const hit = { matches: [{ file: 'src/a.go', line: 1, matchText: 'Fresh', content: 'func Fresh() {}' }], candidateFiles: 1, totalFiles: 1, scannedFiles: 1 };
    const empty = { matches: [], candidateFiles: 0, totalFiles: 1, scannedFiles: 1 };
    const s = {
      projectRoot: root,
      sparseGramIndexPath: join(root, 'absent-sparse.idx'),
      async _refreshManifestPins() { this.manifestEpoch = disk; disk = 2; },
      _readReconcileManifest: () => ({ epoch: disk }),
      _currentManifestEpoch: () => disk,
    };
    const search = vi.fn(() => (s.manifestEpoch === 1 ? empty : hit));
    s.sparseGramIndex = { searchFull: search, searchLines: search, getAllFiles: () => ['src/a.go'] };
    const out = await bareGrep.call(s, 'Fresh', null, {});
    expect(out.results.map((r) => r.file)).toEqual(['src/a.go']);
  });

  it('does not retry when the epoch did not move', async () => {
    const s = searcher({ bump: false });
    const out = await bareGrep.call(s, 'Fresh', null, {});
    expect(out.results).toEqual([]);
  });
});
