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

import { sparseGramHandler, __sparseTesting, SPARSE_FOLD_INLINE_MAX_FILES } from '../../core/incremental-indexing/application/maintenance-handlers.mjs';
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
afterEach(async () => {
  const fold = __sparseTesting.fold();
  if (fold) {
    fold.child?.kill('SIGKILL');
    for (let t = 0; t < 100 && !fold.done; t++) await new Promise((r) => setTimeout(r, 20));
    await sparseGramHandler({}, { stateDir }).catch(() => {}); // drops the finished build
  }
  __sparseTesting.setInlineMaxFiles(SPARSE_FOLD_INLINE_MAX_FILES);
  fs.rmSync(root, { recursive: true, force: true });
});

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

  it('folds in a child process while a tick appends, and re-extracts that tick with the new weights', async () => {
    if (!hasNativeSparseGramSupport()) return;
    __sparseTesting.setInlineMaxFiles(0);
    // Past 4096 corpus bigrams the base derives its weights from the corpus (else a
    // fixed table), so the fold changes the weights id.
    const filler = (i) => Array.from({ length: 40 }, (_, j) => `// note ${i * 97 + j} about module ${i} line ${j}`).join('\n');
    for (let i = 0; i < 6; i++) write(`src/f${i}.js`, `export function unrelated${i}() { return ${i}; }\n${filler(i)}\n`);
    const files = [...Array(6).keys()].map((i) => `src/f${i}.js`);
    buildSparseGramIndexArtifact({ projectRoot: root, files, fileSymbolMasks: files.map(() => 0), outputPath: base });
    const manifest = zeroManifest({});
    manifest.epoch = 4;
    writeManifest(stateDir, manifest);
    const oldWeights = extractSparseGramDeltaRecord({ indexPath: base, content: '' }).weightsId;
    const record = (rel, epoch, deleted = false) => {
      const rec = deleted ? { weightsId: oldWeights, grams: [] }
        : extractSparseGramDeltaRecord({ indexPath: base, content: fs.readFileSync(path.join(root, rel), 'utf8') });
      appendDeltaRecord(base, epoch, { fileId: fileIdFor(rel), filePath: rel, contentHash: rel, deleted, symbolMask: 0, weightsId: rec.weightsId, grams: rec.grams.map((g) => [g, 1]) });
    };
    write('src/f0.js', 'export function editedBeforeTheFold() { return 0; }\n');
    record('src/f0.js', 2);
    const snapshot = listDeltaSegments(base).map((s) => s.path);
    const config = { sparseDeltaRatio: deltaSizeStats(base).ratio / 2, sparseDeltaSegmentCount: 64 };

    expect(await sparseGramHandler({}, { stateDir, projectRoot: root, config })).toMatchObject({ requeue: true, background: 'started' });
    // A tick during the build: a new file and a deletion, with the old base's weights.
    write('src/late.js', 'export function addedDuringTheFold() {}\n');
    record('src/late.js', 5);
    fs.rmSync(path.join(root, 'src/f1.js'));
    record('src/f1.js', 5, true);
    expect(await sparseGramHandler({}, { stateDir, projectRoot: root, config })).toMatchObject({ requeue: true, background: 'building' });
    const fold = __sparseTesting.fold();
    for (let t = 0; t < 600 && !fold.done; t++) await new Promise((r) => setTimeout(r, 50));
    expect(fold.error).toBeNull();

    const out = await sparseGramHandler({}, { stateDir, projectRoot: root, config });
    expect(out).toMatchObject({ action: 'fold', background: true, carriedRecords: 2, retiredSegments: 2 });
    expect(out.weightsId).not.toBe(oldWeights);
    const published = readManifest(stateDir);
    expect(published.sparseGram.weightsId).toBe(out.weightsId);
    const live = listDeltaSegments(base);
    expect(live.map((s) => s.path)).toEqual([out.carriedPath]);
    expect(published.sparseGram.deltas).toEqual([path.relative(stateDir, out.carriedPath)]);
    for (const p of snapshot) expect(fs.existsSync(p)).toBe(true); // retired, kept for the grace

    const carried = fs.readFileSync(out.carriedPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const byPath = Object.fromEntries(carried.map((r) => [r.filePath, r]));
    expect(byPath['src/f1.js']).toMatchObject({ deleted: true, weightsId: out.weightsId });
    const want = extractSparseGramDeltaRecord({ indexPath: base, content: fs.readFileSync(path.join(root, 'src/late.js'), 'utf8') });
    expect(byPath['src/late.js'].weightsId).toBe(out.weightsId);
    expect(byPath['src/late.js'].grams.map((g) => g[0])).toEqual([...new Set(want.grams)].sort());

    const rebuilt = loadSparseGramIndex(base);
    expect(rebuilt.queryLiterals(['editedBeforeTheFold'], 0, 0).files).toEqual(['src/f0.js']);
    expect(rebuilt.getAllFiles()).not.toContain('src/late.js'); // the delta carries it
  }, 60000);
});
