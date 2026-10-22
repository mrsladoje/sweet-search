/**
 * The full build's sparse-gram step records the grep-only files (grep-corpus-state.json) so
 * the maintainer can keep them current, and drops the delta directory: delta records from
 * before the new base would override its fresh grams with older content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readGrepFiles } from '../helpers/file-state.js';

let root;
const saved = process.env.SWEET_SEARCH_PROJECT_ROOT;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ss-sparse-build-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'vendor/lib'), { recursive: true });
  mkdirSync(join(root, '.sweet-search/codebase-sparse-grams.idx.deltas'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), '.sweet-search/\n');
  writeFileSync(join(root, 'src/a.js'), 'export function alpha() { return 1; }\n');
  writeFileSync(join(root, 'vendor/lib/cert.go'), 'package lib\n\nfunc IsPrecert() bool { return true }\n');
  writeFileSync(join(root, '.sweet-search/codebase-sparse-grams.idx.deltas/3-0.ssgrmdelta'), '{"fileId":"x"}\n');
  process.env.SWEET_SEARCH_PROJECT_ROOT = root;
  vi.resetModules();
});
afterEach(() => {
  if (saved === undefined) delete process.env.SWEET_SEARCH_PROJECT_ROOT;
  else process.env.SWEET_SEARCH_PROJECT_ROOT = saved;
  rmSync(root, { recursive: true, force: true });
});

describe('full build sparse-gram step', () => {
  it('records the grep-only files and removes the old delta directory', async () => {
    const { buildSparseGramArtifact } = await import('../../core/indexing/indexer-sparse-gram.js');
    const { hasNativeSparseGramSupport } = await import('../../core/infrastructure/native-sparse-gram.js');
    if (!hasNativeSparseGramSupport()) return;
    await buildSparseGramArtifact(['src/a.js'], false);

    const state = { files: readGrepFiles(join(root, '.sweet-search')) };
    expect(Object.keys(state.files)).toEqual(expect.arrayContaining(['vendor/lib/cert.go']));
    expect(state.files['src/a.js']).toBeUndefined();
    expect(existsSync(join(root, '.sweet-search/codebase-sparse-grams.idx.deltas'))).toBe(false);
  });
});
