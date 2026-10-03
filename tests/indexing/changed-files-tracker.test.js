/**
 * The daemon's changed-file listing (changed-files-tracker.js) must answer as a full
 * `git ls-files --modified --others --exclude-standard` does, after every kind of change.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startChangedFilesTracking, stopChangedFilesTracking } from '../../core/indexing/changed-files-tracker.js';

let hasWatcher = true;
try { await import('@parcel/watcher'); } catch { hasWatcher = false; }

describe.runIf(hasWatcher)('changed-files tracker', () => {
  let root;
  let tracker;
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const write = (p, c = 'x\n') => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), c); };
  const full = () => git('ls-files', '-z', '--modified', '--others', '--exclude-standard').split('\0').filter(Boolean).sort();
  const settle = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-tracker-'));
    git('init', '-q'); git('config', 'user.email', 'a@b'); git('config', 'user.name', 'a');
    for (let i = 0; i < 20; i++) write(`src/d${i % 4}/f${i}.js`, `v${i}\n`);
    write('.gitignore', 'build/\n*.log\n');
    git('add', '-A'); git('commit', '-qm', 'init');
    tracker = await startChangedFilesTracking(root);
  });
  afterAll(async () => { await stopChangedFilesTracking(); fs.rmSync(root, { recursive: true, force: true }); });

  const steps = [
    ['modify a tracked file', () => write('src/d0/f0.js', 'changed\n')],
    ['add an untracked file', () => write('new.txt')],
    ['add ignored files', () => { write('build/out.js'); write('x.log'); }],
    ['delete a tracked file', () => fs.unlinkSync(path.join(root, 'src/d1/f1.js'))],
    ['add a nested directory', () => { write('pkg/a/b/c.ts'); write('pkg/a/d.ts'); }],
    ['rename that directory', () => fs.renameSync(path.join(root, 'pkg'), path.join(root, 'pkg2'))],
    ['remove it', () => fs.rmSync(path.join(root, 'pkg2'), { recursive: true })],
    ['stage a change', () => git('add', 'src/d0/f0.js')],
    ['commit', () => git('commit', '-qm', 'c2')],
    ['edit .gitignore', () => write('.gitignore', 'build/\n*.log\nnew.txt\n')],
    ['add a nested .gitignore', () => write('src/.gitignore', 'd2/\n')],
    ['restore the worktree', () => git('checkout', '--', '.')],
    ['many files at once', () => { for (let i = 0; i < 300; i++) write(`many/m${i}.txt`); }],
  ];
  it('starts on a git worktree', () => { expect(tracker).not.toBeNull(); });
  for (const [name, change] of steps) {
    it(`answers as git after: ${name}`, async () => {
      change();
      await settle();
      expect(tracker.list().sort()).toEqual(full());
    });
  }
});
