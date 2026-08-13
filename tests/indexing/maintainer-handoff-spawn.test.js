/**
 * Real-spawn coverage for the RSS-recycle handoff.
 *
 * The unit tests inject the launcher, so they prove the DECISION logic but not
 * that a successor process actually appears. This file exercises the real
 * `spawn` path end to end — env merge, cwd, detachment, `O_EXCL` lock
 * acquisition by the child — using a stub maintainer entry instead of the real
 * one. The stub keeps the test fast and hermetic: no model load, no index, no
 * 2.7 GB resident set.
 *
 * What it proves that the unit tests cannot:
 *   - the successor really starts, in its own process, and outlives the parent;
 *   - it receives ABSOLUTE project/state paths even when the parent inherited
 *     relative ones (the retarget bug: a successor that maintains a different
 *     index leaves the real index with zero writers);
 *   - it can acquire the state lock the parent released;
 *   - a failed spawn is reported as NOT confirmed rather than as success.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handOffAfterRssRecycle, successorEnv } from '../../core/indexing/index-maintainer.mjs';

let root;

/**
 * Wait until `check()` returns a value, or give up after `ms`.
 *
 * A throwing `check()` counts as "not ready yet", NOT as a failure. That matters
 * here: the successor's `writeFileSync` is not atomic from a reader's point of
 * view, so polling on `existsSync` alone can read a half-written file and throw
 * from `JSON.parse` — which is a race in the test, not a defect in the code.
 */
async function until(check, ms = 60000, step = 50) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    let v = null;
    try { v = check(); } catch { v = null; }
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ss-handoff-'));
  mkdirSync(join(root, 'repo', '.sweet-search'), { recursive: true });
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('RSS-recycle handoff — real spawn', () => {
  it('starts a successor process that records its env and takes the state lock', async () => {
    const projectRoot = join(root, 'repo');
    const stateDir = join(projectRoot, '.sweet-search');
    const out = join(root, 'successor.json');
    const entry = join(root, 'stub-maintainer.mjs');

    // Stub successor: records what it inherited, then takes the O_EXCL lock the
    // parent released — the same lockfile name the real maintainer uses.
    writeFileSync(entry, `
      import { writeFileSync, openSync, closeSync, constants } from 'node:fs';
      import { join } from 'node:path';
      const stateDir = process.env.SWEET_SEARCH_STATE_DIR;
      let lockTaken = false;
      try {
        const fd = openSync(join(stateDir, 'index-maintainer.lock'),
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        closeSync(fd);
        lockTaken = true;
      } catch { lockTaken = false; }
      writeFileSync(${JSON.stringify(out)}, JSON.stringify({
        pid: process.pid,
        ppid: process.ppid,
        generation: process.env.SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION,
        projectRoot: process.env.SWEET_SEARCH_PROJECT_ROOT,
        stateDir: process.env.SWEET_SEARCH_STATE_DIR,
        cwd: process.cwd(),
        lockTaken,
      }));
      // Stay resident past the liveness confirm window, like a real maintainer
      // that has just acquired the lock and started ticking. A stub that exits
      // immediately is indistinguishable from a failed spawn — see the
      // "exits immediately" case below, which asserts exactly that.
      setTimeout(() => {}, 3000);
    `);

    const ctx = { projectRoot, stateDir };
    // The parent inherited RELATIVE paths; the successor must still be pinned to
    // the resolved absolute ones.
    const inherited = {
      ...process.env,
      SWEET_SEARCH_PROJECT_ROOT: 'repo',
      SWEET_SEARCH_STATE_DIR: 'repo/.sweet-search',
      SWEET_SEARCH_MAINTAINER_ENTRY: entry,
      SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: '1',
    };

    const result = await handOffAfterRssRecycle({
      cwd: projectRoot,
      env: successorEnv(ctx, inherited),
      emit: () => {},
    });

    expect(result.spawned).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.generation).toBe(2);

    const written = await until(() => (existsSync(out) ? JSON.parse(readFileSync(out, 'utf-8')) : null));
    expect(written).not.toBeNull();
    expect(written.generation).toBe('2');
    expect(written.projectRoot).toBe(projectRoot);
    expect(written.stateDir).toBe(stateDir);
    // realpath: macOS resolves /var → /private/var in the child's cwd.
    expect(realpathSync(written.cwd)).toBe(realpathSync(projectRoot));
    // The successor is a different process, and it could take the lock the
    // parent released — that is the whole point of releasing before spawning.
    expect(written.pid).not.toBe(process.pid);
    expect(written.lockTaken).toBe(true);
  }, 90000);

  it('reports NOT confirmed when the successor entry does not exist', async () => {
    const projectRoot = join(root, 'repo');
    const ctx = { projectRoot, stateDir: join(projectRoot, '.sweet-search') };
    const result = await handOffAfterRssRecycle({
      cwd: projectRoot,
      env: successorEnv(ctx, {
        ...process.env,
        SWEET_SEARCH_MAINTAINER_ENTRY: join(root, 'does-not-exist.mjs'),
      }),
      emit: () => {},
    });
    expect(result.confirmed).toBe(false);
    expect(result.spawned).toBe(false);
    expect(result.reason).toBe('entry-missing');
  }, 90000);

  it('reports NOT confirmed when the successor exits immediately', async () => {
    const projectRoot = join(root, 'repo');
    const ctx = { projectRoot, stateDir: join(projectRoot, '.sweet-search') };
    const entry = join(root, 'instant-exit.mjs');
    writeFileSync(entry, 'process.exit(1);\n');

    const result = await handOffAfterRssRecycle({
      cwd: projectRoot,
      env: successorEnv(ctx, { ...process.env, SWEET_SEARCH_MAINTAINER_ENTRY: entry }),
      emit: () => {},
      // Generous window ON PURPOSE. The assertion is "a death inside the window
      // is detected", not "node boots quickly" — this file spawns real
      // processes, and under a full parallel suite process startup alone can
      // take seconds. A production-sized 750ms budget here would only measure
      // machine load. Same reason the polls above wait 60s.
      confirmDelayMs: 30000,
    });
    // Both attempts spawn a process that dies before the confirm window ends,
    // so the handoff must NOT claim success.
    expect(result.confirmed).toBe(false);
    expect(result.reason).toBe('died-immediately');
  }, 90000);
});
