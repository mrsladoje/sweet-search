/**
 * The daemon keeps the delta overlay per index and updates it from appended bytes. A sparse
 * base rebuild folds the deltas into a new base file and lists only newer segments: overlay
 * entries read before it must not survive it (they would hide the new base's file or serve
 * its old grams). The overlay reader resets when a listed segment is no longer listed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadSparseDeltaOverlay, _resetSparseDeltaOverlayCache } from '../../core/search/search-pattern-sparse-overlay.js';
import { _resetSparseManifestAbsentCache } from '../../core/search/search-pattern-sparse-overlay.js';

let root;
let stateDir;
let base;

function delta(name, records) {
  fs.mkdirSync(`${base}.deltas`, { recursive: true });
  fs.writeFileSync(path.join(`${base}.deltas`, name), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
function manifest(deltas) {
  fs.writeFileSync(path.join(stateDir, 'reconcile-manifest.json'), JSON.stringify({
    epoch: 9, sparseGram: { base: 'codebase-sparse-grams.idx', deltas, weightsId: 'w', epoch: 9 },
  }));
}
const rec = (file) => ({ fileId: file, filePath: file, contentHash: file, deleted: false, symbolMask: 0, weightsId: 'w', grams: [['ab', 1]] });

beforeEach(() => {
  _resetSparseDeltaOverlayCache();
  _resetSparseManifestAbsentCache();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-overlay-fold-'));
  stateDir = path.join(root, '.sweet-search');
  base = path.join(stateDir, 'codebase-sparse-grams.idx');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(base, 'base v1');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('delta overlay across a base rebuild', () => {
  it('drops the entries read before the base was replaced', () => {
    const searcher = { sparseGramIndexPath: base, _manifestStateDir: stateDir, projectRoot: root };
    delta('3-0.ssgrmdelta', [rec('a.js')]);
    manifest(['codebase-sparse-grams.idx.deltas/3-0.ssgrmdelta']);
    expect(loadSparseDeltaOverlay(searcher).live.map((r) => r.filePath)).toEqual(['a.js']);

    // Rebuild: a new base file (a.js folded in), 3-0 retired but still on disk, a new delta.
    fs.writeFileSync(`${base}.next`, 'base v2, a longer file');
    fs.renameSync(`${base}.next`, base);
    delta('9-0.ssgrmdelta', [rec('b.js')]);
    manifest(['codebase-sparse-grams.idx.deltas/9-0.ssgrmdelta']);
    const overlay = loadSparseDeltaOverlay(searcher);
    expect(overlay.live.map((r) => r.filePath)).toEqual(['b.js']);
    expect(overlay.hidden.has('a.js')).toBe(false);
  });
});
