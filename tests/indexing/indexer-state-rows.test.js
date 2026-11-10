/**
 * The file-state rows an index run stores ("these files are indexed, with this content").
 * The maintainer's dirty scan compares each file's stat with its row, so a row must describe
 * the content the run INDEXED, and a run over some files must keep the rows of the others.
 * See docs/STATE_MACHINES.md, "Full index build" (rows are taken before the build).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

// The phases read PROJECT_ROOT and the state paths when their modules load: point them at a
// private temp project first, so the test never touches the repository's own index state.
const PROJECT = vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-state-rows-')));
  process.env.SWEET_SEARCH_PROJECT_ROOT = root;
  delete process.env.SWEET_SEARCH_DATA_DIR;
  return root;
});
afterAll(() => rmSync(PROJECT, { recursive: true, force: true }));

import { determineFilesToIndexPhase, updateIncrementalStatePhase } from '../../core/indexing/indexer-phases.js';
import { updateState } from '../../core/indexing/incremental-tracker.js';
import { readFileStateObject } from '../../core/incremental-indexing/infrastructure/file-state-store.mjs';
import { contentHashSync } from '../../core/incremental-indexing/infrastructure/hashing.mjs';
import { PROJECT_ROOT } from '../../core/infrastructure/config/index.js';

const stateDir = join(PROJECT, '.sweet-search');
const stats = { vectorStats: { chunks: 0 }, graphStats: { entities: 0, relationships: 0 } };
const FILES = ['a.js', 'b.js', 'c.js'];
const hashOf = (text) => contentHashSync(Buffer.from(text));

beforeEach(() => {
  expect(PROJECT_ROOT).toBe(PROJECT); // the guard: these phases write into the temp project
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  for (const f of FILES) writeFileSync(join(PROJECT, f), `export const ${f[0]} = 1;\n`);
});

describe('full rebuild: rows describe the content that was indexed', () => {
  it('keeps the start-of-run row of a file edited or deleted during the build', async () => {
    const picked = await determineFilesToIndexPhase({ allFiles: FILES, fullReindex: true });
    expect(picked.earlyExit).toBe(false);

    // While the build runs (chunk, embed, write: minutes on a large repository), the user
    // edits one file and deletes another.
    writeFileSync(join(PROJECT, 'a.js'), 'export const a = "edited during the build";\n');
    unlinkSync(join(PROJECT, 'b.js'));

    await updateIncrementalStatePhase({ fullReindex: true, incrementalInfo: picked.incrementalInfo, stateHashes: picked.stateHashes, allFiles: FILES, ...stats });

    const rows = readFileStateObject(stateDir);
    // a.js: the row is of the content the build read, so its stat no longer matches the
    // file and the dirty scan indexes the edit.
    expect(rows['a.js'].hash).toBe(hashOf('export const a = 1;\n'));
    expect(rows['a.js'].size).toBe(String('export const a = 1;\n'.length));
    // b.js: its chunks are in the index, so it keeps a row, which the scan finds deleted.
    expect(rows['b.js']?.hash).toBe(hashOf('export const b = 1;\n'));
    expect(rows['c.js'].hash).toBe(hashOf('export const c = 1;\n'));
    expect(existsSync(join(PROJECT, 'b.js'))).toBe(false);
  });

  it('takes no rows on a dry run', async () => {
    const picked = await determineFilesToIndexPhase({ allFiles: FILES, fullReindex: true, dryRun: true });
    expect(picked.stateHashes).toBeNull();
  });
});

describe('targeted run (--files-from-stdin): the rows of other files stay', () => {
  it('updates the targeted file\'s row and keeps every other row', async () => {
    // A complete index: one row per file.
    await updateState(Object.fromEntries(FILES.map((f) => [f, { hash: hashOf(`export const ${f[0]} = 1;\n`), size: '20', mtime_ns: '1', inode: '1' }])));
    expect(Object.keys(readFileStateObject(stateDir)).sort()).toEqual(FILES);

    writeFileSync(join(PROJECT, 'a.js'), 'export const a = 2;\n');
    const picked = await determineFilesToIndexPhase({ allFiles: FILES, stdinFiles: ['a.js'], filesFromStdin: true });
    expect(picked.filesToIndex).toEqual(['a.js']);
    await updateIncrementalStatePhase({ incrementalInfo: picked.incrementalInfo, allFiles: FILES, ...stats });

    const rows = readFileStateObject(stateDir);
    expect(Object.keys(rows).sort()).toEqual(FILES);
    expect(rows['a.js'].hash).toBe(hashOf('export const a = 2;\n'));
    expect(rows['b.js'].hash).toBe(hashOf('export const b = 1;\n'));
  });
});
