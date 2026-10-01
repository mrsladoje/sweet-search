/**
 * Shell-cwd-aware path arguments for the ss-* tools (core/search/cwd-paths.js) and the
 * implicit ss-grep scope it produces.
 *
 * Real directories on disk (a temp tree), because the rule is about what exists where.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
      .toBe(path.join(realpathSync(root), 'okhttp', 'src', 'okhttp3'));
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

  // The defect: the wrapper's root came from SWEET_SEARCH_PROJECT_ROOT as typed (/tmp/x on
  // macOS), the daemon's was canonical (/private/tmp/x, e.g. started by the native client).
  // The scope was spelled like the wrapper's root, the daemon rejected it, and ss-grep from a
  // subdirectory printed "(no matches)" for hits that exist.
  it('a root given through a symlink still matches an engine whose root is the real path', () => {
    const scope = cwdGrepScope({ cwd: path.join(rootLink, 'okhttp'), fileRoot: rootLink, indexRoot: rootLink });
    expect(scope).toBe(path.join(realpathSync(root), 'okhttp'));
    expect(matchesGrepFileFilter('okhttp/src/okhttp3/Dispatcher.kt', scope, realpathSync(root))).toBe(true);
    expect(matchesGrepFileFilter('okhttp/src/okhttp3/Dispatcher.kt', scope, rootLink)).toBe(true);
    expect(matchesGrepFileFilter('README.md', scope, realpathSync(root))).toBe(false);
  });

  it('matches when the engine root is a symlinked spelling of the scope root', () => {
    const scope = cwdGrepScope({ cwd: sub, fileRoot: realpathSync(root), indexRoot: realpathSync(root) });
    expect(matchesGrepFileFilter('okhttp/src/okhttp3/Dispatcher.kt', scope, rootLink)).toBe(true);
    expect(matchesGrepFileFilter('README.md', scope, rootLink)).toBe(false);
  });
});

// The wrapper cannot be imported (it runs on import and needs a warm daemon), so its wiring is
// checked in the source, as in agent-output-fixes-wiring.test.js.
describe('ss-find → ss-grep fallback wiring (_ss-helpers.mjs)', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../eval/agent-read-workflows/bin/_ss-helpers.mjs'),
    'utf8',
  );
  const cmdGrep = src.slice(src.indexOf('async function cmdGrep('), src.indexOf('async function cmdFind('));
  const cmdFind = src.slice(src.indexOf('async function cmdFind('), src.indexOf('const READ_USAGE'));

  // Measured on a temp repo before the fix: from src/, ss-find with no --in fell back to
  // cmdGrep, picked up ss-grep's implicit cwd scope and printed 3 of the 6 hits.
  it('the fallback tells cmdGrep it comes from ss-find', () => {
    expect(cmdFind).toMatch(/return cmdGrep\(\[[^\]]*\.\.\.inPaths\.flatMap[^)]*\)\],\s*\{ fromFind: true \}\)/);
  });

  it('cmdGrep applies neither the implicit cwd scope nor a second cwd resolution for ss-find', () => {
    expect(cmdGrep).toMatch(/if \(!fromFind\) resolveScopePaths\(inPaths\)/);
    expect(cmdGrep).toMatch(/const cwdScope = fromFind \? null\s*: cwdGrepScope\(/);
  });

  it('ss-find reports a missing --in scope the way ss-grep does (shared writer, exit 3)', () => {
    expect(cmdFind).toMatch(/missingScopes\(inPaths\)[\s\S]{0,40}exitScopeNotFound\(missing\)/);
    expect(cmdGrep).toMatch(/exitScopeNotFound\(missing\)/);
    expect(src).toMatch(/function exitScopeNotFound\(missing\) \{[\s\S]*?process\.exit\(3\);/);
  });
});
