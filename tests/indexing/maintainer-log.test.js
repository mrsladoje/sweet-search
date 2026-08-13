/**
 * The detached maintainer must have somewhere to speak.
 *
 * It is spawned with `detached: true`, and it used to be spawned with
 * `stdio: 'ignore'` — so every warning it emitted went to a console nobody was
 * attached to, and so did every crash. That is not a cosmetic gap: the RSS
 * ceiling advisory, the recycle-chain warning, and the "your override is below
 * the steady resident set" notice are the three things an operator needs in
 * order to act, and none of them could reach one. Diagnosing a maintainer that
 * had died meant guessing.
 *
 * These tests pin the three properties that make the log safe to keep on by
 * default: it captures the child's output, it is bounded, and opening it never
 * costs the parent a file descriptor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchMaintainer, MAINTAINER_LOG_FILENAME } from '../../core/indexing/maintainer-launcher.mjs';

let root;
let stateDir;
let entry;

const logPath = () => join(stateDir, MAINTAINER_LOG_FILENAME);

async function until(check, ms = 20000, step = 50) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    let v = null;
    try { v = check(); } catch { v = null; }
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}

/** Count this process's open descriptors. Only meaningful on platforms with /dev/fd. */
function openFdCount() {
  try { return readdirSync('/dev/fd').length; } catch { return null; }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ss-mlog-'));
  stateDir = join(root, '.sweet-search');
  mkdirSync(stateDir, { recursive: true });
  entry = join(root, 'talkative-maintainer.mjs');
  writeFileSync(entry, `
    process.stdout.write('HELLO FROM STDOUT\\n');
    process.stderr.write('HELLO FROM STDERR\\n');
  `);
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const launch = () => launchMaintainer({
  cwd: root,
  env: {
    ...process.env,
    SWEET_SEARCH_STATE_DIR: stateDir,
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_RECONCILE_V2: '1',
    SWEET_SEARCH_MAINTAINER_ENTRY: entry,
  },
});

describe('maintainer log', () => {
  it('captures the detached child\'s stdout AND stderr', async () => {
    expect(launch().spawned).toBe(true);
    const body = await until(() => {
      const text = existsSync(logPath()) ? readFileSync(logPath(), 'utf-8') : '';
      return text.includes('HELLO FROM STDOUT') && text.includes('HELLO FROM STDERR') ? text : null;
    });
    expect(body).toBeTruthy();
  }, 30000);

  it('appends rather than truncating, so a restart does not erase the history', async () => {
    writeFileSync(logPath(), 'EARLIER RUN\n');
    expect(launch().spawned).toBe(true);
    const body = await until(() => {
      const text = readFileSync(logPath(), 'utf-8');
      return text.includes('HELLO FROM STDOUT') ? text : null;
    });
    expect(body).toContain('EARLIER RUN');
  }, 30000);

  it('rotates once past the cap so the pair of files stays bounded', async () => {
    // 5 MB is over the 4 MB cap.
    writeFileSync(logPath(), 'x'.repeat(5 * 1024 * 1024));
    expect(launch().spawned).toBe(true);

    // The oversized file was moved aside and a fresh one started.
    expect(existsSync(`${logPath()}.1`)).toBe(true);
    expect(statSync(`${logPath()}.1`).size).toBeGreaterThan(4 * 1024 * 1024);
    const body = await until(() => {
      const text = readFileSync(logPath(), 'utf-8');
      return text.includes('HELLO FROM STDOUT') ? text : null;
    });
    expect(body).toBeTruthy();
    expect(statSync(logPath()).size).toBeLessThan(1024);
  }, 30000);

  it('leaks no file descriptor in the launching process', async () => {
    const before = openFdCount();
    if (before == null) return; // platform without /dev/fd; nothing to assert
    for (let i = 0; i < 12; i++) {
      // Each launch must open the log, hand it to the child, and close OUR copy.
      // Supervision launches repeatedly over a daemon's lifetime, so a missing
      // close would exhaust the daemon's descriptors given enough time.
      launch();
      rmSync(join(stateDir, 'index-maintainer.lock'), { force: true });
    }
    const after = openFdCount();
    expect(after - before).toBeLessThanOrEqual(2);
  }, 30000);

  it('still launches when the log cannot be opened', () => {
    // A state dir the process cannot write must cost the LOG, never the
    // maintainer — keeping the index fresh matters more than being able to
    // explain it.
    if (process.getuid?.() === 0) return; // root ignores the mode bits
    chmodSync(stateDir, 0o500); // r-x: readable for the lock check, not writable
    try {
      const result = launch();
      expect(result.spawned).toBe(true);
      expect(existsSync(logPath())).toBe(false);
    } finally {
      chmodSync(stateDir, 0o700);
    }
  }, 30000);
});
