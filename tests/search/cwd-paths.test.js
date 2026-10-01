/**
 * Shell-cwd-aware path arguments for the ss-* tools (core/search/cwd-paths.js) and the
 * implicit ss-grep scope it produces.
 *
 * Real directories on disk (a temp tree), because the rule is about what exists where.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cwdGrepScope, cwdOffset, resolveCwdPath } from '../../core/search/cwd-paths.js';
import { matchesGrepFileFilter } from '../../core/search/grep-output-shaping.js';

let base;
let root;       // the repository
let sub;        // okhttp/src/okhttp3
let outside;    // a directory that is not under the repository
let rootLink;   // a symlinked spelling of the repository root

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'ss-cwd-paths-'));
  root = path.join(base, 'repo');
  sub = path.join(root, 'okhttp', 'src', 'okhttp3');
  outside = path.join(base, 'elsewhere');
  mkdirSync(sub, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(sub, 'Dispatcher.kt'), 'class Dispatcher\n');
  writeFileSync(path.join(sub, 'README.md'), 'sub\n');
  writeFileSync(path.join(root, 'README.md'), 'root\n');
  writeFileSync(path.join(outside, 'README.md'), 'outside\n');
  rootLink = path.join(base, 'repo-link');
  symlinkSync(root, rootLink);
});

afterAll(() => {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('resolveCwdPath', () => {
  it('a path that exists under the cwd resolves there, as a root-relative path', () => {
    expect(resolveCwdPath('Dispatcher.kt', { cwd: sub, root })).toBe('okhttp/src/okhttp3/Dispatcher.kt');
    expect(resolveCwdPath('./Dispatcher.kt', { cwd: sub, root })).toBe('okhttp/src/okhttp3/Dispatcher.kt');
    expect(resolveCwdPath('../okhttp3/Dispatcher.kt', { cwd: sub, root })).toBe('okhttp/src/okhttp3/Dispatcher.kt');
    expect(resolveCwdPath('.', { cwd: sub, root })).toBe('okhttp/src/okhttp3');
    expect(resolveCwdPath('..', { cwd: sub, root })).toBe('okhttp/src');
  });

  it('the cwd wins over a same-named file at the root (shell semantics)', () => {
    expect(resolveCwdPath('README.md', { cwd: sub, root })).toBe('okhttp/src/okhttp3/README.md');
  });

  it('falls back to the root-relative meaning when the cwd reading does not exist', () => {
    // a root-relative path copied from earlier tool output, typed from the subdirectory
    expect(resolveCwdPath('okhttp/src/okhttp3/Dispatcher.kt', { cwd: sub, root })).toBe('okhttp/src/okhttp3/Dispatcher.kt');
    expect(resolveCwdPath('missing.kt', { cwd: sub, root })).toBe('missing.kt');
  });

  it('changes nothing at the root, outside the repository, or for an absolute path', () => {
    expect(resolveCwdPath('./README.md', { cwd: root, root })).toBe('./README.md');
    expect(resolveCwdPath('README.md', { cwd: outside, root })).toBe('README.md');
    const abs = path.join(sub, 'Dispatcher.kt');
    expect(resolveCwdPath(abs, { cwd: sub, root })).toBe(abs);
    expect(resolveCwdPath(null, { cwd: sub, root })).toBe(null);
  });

  it('a path that climbs out of the repository from the cwd keeps its old meaning', () => {
    expect(resolveCwdPath('../../../../elsewhere/README.md', { cwd: sub, root })).toBe('../../../../elsewhere/README.md');
  });

  it('a symlinked spelling of the root is the same root', () => {
    expect(cwdOffset({ cwd: sub, root: rootLink })).toBe('okhttp/src/okhttp3');
    expect(resolveCwdPath('Dispatcher.kt', { cwd: sub, root: rootLink })).toBe('okhttp/src/okhttp3/Dispatcher.kt');
  });
});

describe('cwdGrepScope (ss-grep implicit scope)', () => {
  it('is the absolute subdirectory under the index root when run from a subdirectory', () => {
    expect(cwdGrepScope({ cwd: sub, fileRoot: root, indexRoot: root }))
      .toBe(path.join(root, 'okhttp', 'src', 'okhttp3'));
  });

  it('is null at the root and outside the repository (output unchanged)', () => {
    expect(cwdGrepScope({ cwd: root, fileRoot: root, indexRoot: root })).toBeNull();
    expect(cwdGrepScope({ cwd: outside, fileRoot: root, indexRoot: root })).toBeNull();
  });

  it('measures the offset in the file root and applies it to the index root (linked worktree)', () => {
    expect(cwdGrepScope({ cwd: sub, fileRoot: root, indexRoot: '/main/checkout' }))
      .toBe(path.join('/main/checkout', 'okhttp', 'src', 'okhttp3'));
  });

  it('the scope admits only files below the subdirectory, anchored at the root', () => {
    const scope = cwdGrepScope({ cwd: path.join(root, 'okhttp'), fileRoot: root, indexRoot: root });
    expect(matchesGrepFileFilter('okhttp/src/okhttp3/Dispatcher.kt', scope, root)).toBe(true);
    expect(matchesGrepFileFilter('README.md', scope, root)).toBe(false);
    // a relative `okhttp` scope would admit this; the anchored implicit scope must not
    expect(matchesGrepFileFilter('vendor/okhttp/x.kt', scope, root)).toBe(false);
  });

  it('matches when the engine root is a symlinked spelling of the scope root', () => {
    const scope = cwdGrepScope({ cwd: sub, fileRoot: realpathSync(root), indexRoot: realpathSync(root) });
    expect(matchesGrepFileFilter('okhttp/src/okhttp3/Dispatcher.kt', scope, rootLink)).toBe(true);
    expect(matchesGrepFileFilter('README.md', scope, rootLink)).toBe(false);
  });
});
