import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getGitIgnoredPathSet } from '../../core/indexing/gitignore-filter.js';

// git check-ignore cost grows with tracked files x paths asked (70 s per maintainer tick at
// 100k tracked files), and it never reports a tracked path. Only untracked paths are asked.
describe('getGitIgnoredPathSet with tracked files', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ss-gi-tracked-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reports untracked ignored paths, never tracked ones', async () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const tracked = Array.from({ length: 80 }, (_, i) => `f${i}.go`);
    for (const f of tracked) writeFileSync(join(root, f), 'x');
    writeFileSync(join(root, '.gitignore'), '*.go\n');
    execFileSync('git', ['add', '-f', ...tracked], { cwd: root });
    writeFileSync(join(root, 'new.go'), 'y');
    writeFileSync(join(root, 'keep.txt'), 'z');
    const out = await getGitIgnoredPathSet([...tracked, 'new.go', 'keep.txt'], { projectRoot: root, silent: true });
    expect([...out]).toEqual(['new.go']);
  });

  it('asks git nothing when every path is tracked', async () => {
    // Not a git repository: any check-ignore call fails, and all-failed returns null.
    const paths = Array.from({ length: 80 }, (_, i) => `f${i}.go`);
    const out = await getGitIgnoredPathSet(paths, { projectRoot: root, silent: true, tracked: new Set(paths) });
    expect(out).toEqual(new Set());
  });
});
