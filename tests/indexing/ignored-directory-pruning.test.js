/**
 * Directories git ignores as a whole are never walked.
 *
 * The defect: the incremental producer (dirty-scan) descended every directory
 * the deny-list did not name, stat-ed every file in it, and only then asked git
 * which of them were ignored. On this repository the gitignored `eval/repos/`
 * holds 3.9 million files, so each maintainer tick ran a ten-minute synchronous
 * stat loop: one core busy without pause, and a SIGTERM never handled because
 * the event loop never turned. Full discovery globbed the same tree.
 *
 * Both walks now prune the directories `git ls-files --ignored --directory`
 * reports, and both admit the same set. The agentic exemption (`.claude/` and
 * friends stay indexable when gitignored) still holds for an ignored agentic
 * directory, but not for one inside an ordinary ignored directory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createAdmissionPolicy } from '../../core/indexing/admission-policy.js';
import { discoverFiles } from '../../core/indexing/indexer-utils.js';
import { scanDirtyAndEnqueue } from '../../core/incremental-indexing/application/dirty-scan.mjs';

let root;
let stateDir;

function write(rel, content = 'export const x = 1;\n') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ignored-dirs-')));
  stateDir = path.join(root, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  write('.gitignore', 'big/\n.claude/\nlogs/*.js\n');
  write('src/a.js');
  write('big/repo/b.js');
  write('big/repo/.claude/notes.md', '# notes\n');
  write('.claude/rules.md', '# rules\n');
  write('logs/c.js');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('admission policy — directories ignored as a whole', () => {
  it('lists ignored directories, never an agentic one', () => {
    const policy = createAdmissionPolicy({ projectRoot: root });
    const dirs = policy.ignoredDirectories();
    expect(dirs.has('big')).toBe(true);
    expect(dirs.has('.claude')).toBe(false);
    // `logs/*.js` ignores files, not the directory.
    expect(dirs.has('logs')).toBe(false);
    expect(policy.isIgnoredDirectory('big')).toBe(true);
    expect(policy.underIgnoredDirectory('big/repo/b.js')).toBe(true);
    expect(policy.underIgnoredDirectory('src/a.js')).toBe(false);
  });

  it('keeps an ignored agentic directory, but not an agentic one inside an ignored tree', async () => {
    const policy = createAdmissionPolicy({ projectRoot: root });
    const ignored = await policy.gitignoredSet(['src/a.js', '.claude/rules.md', 'big/repo/.claude/notes.md', 'logs/c.js']);
    expect(ignored.has('src/a.js')).toBe(false);
    expect(ignored.has('.claude/rules.md')).toBe(false);
    expect(ignored.has('big/repo/.claude/notes.md')).toBe(true);
    expect(ignored.has('logs/c.js')).toBe(true);
  });

  it('prunes nothing when gitignore is off or there is no git', () => {
    fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
    const policy = createAdmissionPolicy({ projectRoot: root });
    expect(policy.ignoredDirectories().size).toBe(0);
  });
});

describe('full discovery and the incremental walk', () => {
  it('admit the same files, none from inside an ignored directory', async () => {
    const full = (await discoverFiles({ projectRoot: root, silent: true })).sort();
    const res = await scanDirtyAndEnqueue({ projectRoot: root, stateDir });
    expect([...res.files].sort()).toEqual(full);
    expect(full).toContain('src/a.js');
    expect(full).toContain('.claude/rules.md');
    expect(full.some((f) => f.startsWith('big/'))).toBe(false);
    expect(full).not.toContain('logs/c.js');
  });

  it('the incremental walk never stats a file inside an ignored directory', async () => {
    const statSpy = vi.spyOn(fs, 'statSync');
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    try {
      await scanDirtyAndEnqueue({ projectRoot: root, stateDir });
      const statted = statSpy.mock.calls.map((c) => String(c[0]));
      const listed = readdirSpy.mock.calls.map((c) => String(c[0]));
      expect(statted.some((p) => p.includes(`${path.sep}big${path.sep}`))).toBe(false);
      expect(listed.some((p) => p.startsWith(path.join(root, 'big')))).toBe(false);
      expect(statted.some((p) => p.endsWith(path.join('src', 'a.js')))).toBe(true);
    } finally {
      statSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });

  it('yields to the event loop while walking a large tree', async () => {
    for (let i = 0; i < 2500; i++) write(`many/f${i}.js`);
    let turns = 0;
    const turnsAtWalkProgress = [];
    const ticker = setInterval(() => { turns += 1; }, 0);
    try {
      await scanDirtyAndEnqueue({
        projectRoot: root,
        stateDir,
        onProgress: (phase) => { if (phase === 'dirty-scan:walk') turnsAtWalkProgress.push(turns); },
      });
    } finally {
      clearInterval(ticker);
    }
    // Without the yield no timer (and no signal handler) runs until the walk
    // is over, so every count taken DURING the walk would be 0.
    expect(turnsAtWalkProgress.length).toBeGreaterThanOrEqual(2);
    expect(turnsAtWalkProgress.at(-1)).toBeGreaterThan(0);
  });
});
