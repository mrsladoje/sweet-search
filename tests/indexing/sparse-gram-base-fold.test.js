/**
 * Past the delta size ratio, sparse maintenance merged the deltas into one segment and kept
 * the ratio, so the job fired again on every tick with an edit and rewrote the whole delta
 * (Fable round 4, F2). It now rebuilds the base from the corpus on disk and empties the
 * deltas; the consumed segments stay on disk for readers holding the older manifest.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sparseGramHandler } from '../../core/incremental-indexing/application/maintenance-handlers.mjs';
import {
  appendDeltaRecord, deltaSizeStats, fileIdFor, listDeltaSegments,
} from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { readManifest, writeManifest, zeroManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import { evaluateWatermarks } from '../../core/incremental-indexing/domain/watermark-scheduler.mjs';
import { readSparseGramState } from '../../core/incremental-indexing/infrastructure/maintenance-state-reader.mjs';
import {
  buildSparseGramIndexArtifact, extractSparseGramDeltaRecord, hasNativeSparseGramSupport, loadSparseGramIndex,
} from '../../core/infrastructure/native-sparse-gram.js';

let root;
let stateDir;
let base;

function write(rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sparse-fold-'));
  stateDir = path.join(root, '.sweet-search');
  base = path.join(stateDir, 'codebase-sparse-grams.idx');
  fs.mkdirSync(stateDir, { recursive: true });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('sparse-gram base fold', () => {
  it('rebuilds the base from disk, empties the deltas, and stops re-firing', async () => {
    if (!hasNativeSparseGramSupport()) return;
    for (let i = 0; i < 6; i++) write(`src/f${i}.js`, `export function unrelated${i}() { return ${i}; }\n`);
    write('src/gone.js', 'export const removedLater = 1;\n');
    const files = [...Array(6).keys()].map((i) => `src/f${i}.js`).concat('src/gone.js');
    buildSparseGramIndexArtifact({ projectRoot: root, files, fileSymbolMasks: files.map(() => 0), outputPath: base });
    const manifest = zeroManifest({});
    manifest.epoch = 4;
    writeManifest(stateDir, manifest);

    // Edits after the build: f0 now holds a new identifier, new.js was added, gone.js deleted.
    write('src/f0.js', 'export function freshlyEditedIdentifier() { return 0; }\n');
    write('src/new.js', 'export function brandNewFileSymbol() {}\n');
    fs.rmSync(path.join(root, 'src/gone.js'));
    let epoch = 2;
    for (const rel of ['src/f0.js', 'src/new.js']) {
      const rec = extractSparseGramDeltaRecord({ indexPath: base, content: fs.readFileSync(path.join(root, rel), 'utf8') });
      appendDeltaRecord(base, epoch++, { fileId: fileIdFor(rel), filePath: rel, contentHash: rel, deleted: false, symbolMask: 0, weightsId: rec.weightsId, grams: rec.grams.map((g) => [g, 1]) });
    }
    appendDeltaRecord(base, epoch++, { fileId: fileIdFor('src/gone.js'), filePath: 'src/gone.js', contentHash: '', deleted: true, symbolMask: 0, weightsId: 'w', grams: [] });
    const consumed = listDeltaSegments(base).map((s) => s.path);
    const ratio = deltaSizeStats(base).ratio;
    expect(ratio).toBeGreaterThan(0);

    const out = await sparseGramHandler({}, { stateDir, projectRoot: root, config: { sparseDeltaRatio: ratio / 2, sparseDeltaSegmentCount: 64 } });
    expect(out.action).toBe('fold');
    expect(listDeltaSegments(base)).toEqual([]);
    const published = readManifest(stateDir);
    expect(published.sparseGram.deltas).toEqual([]);
    expect(published.sparseGram.weightsId).toBe(out.weightsId);
    for (const p of consumed) expect(fs.existsSync(p)).toBe(true); // readers on the old manifest

    const rebuilt = loadSparseGramIndex(base);
    expect(rebuilt.getAllFiles().sort()).toEqual([...files.filter((f) => f !== 'src/gone.js'), 'src/new.js'].sort());
    const hit = rebuilt.queryLiterals(['freshlyEditedIdentifier'], 0, 0);
    expect(hit.files).toEqual(['src/f0.js']);

    // The next tick's edit no longer re-fires a full rewrite.
    expect(evaluateWatermarks({ sparseGram: readSparseGramState(stateDir) }).filter((j) => j.tier === 'sparse_gram')).toEqual([]);
  });
});
