/**
 * A maintainer stops when told to, and when its search daemon is gone.
 *
 * The defects (2026-10-04): maintainers kept running after SIGTERM — the
 * signal only set a flag that the loop read after its current sleep slice (up
 * to 30 s) or after a tick that could run for minutes inside a synchronous
 * walk — and nothing tied a maintainer's lifetime to the daemon that started
 * it, so maintainers outlived their daemons by hours. These tests run the real
 * maintainer entry as a process.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  daemonGoneLongEnough,
  daemonPidFromArgv,
  daemonPidFileFromArgv,
  daemonPidFileLive,
  SIGNAL_EXIT_DEADLINE_MS,
} from '../../core/indexing/index-maintainer.mjs';
import { launchMaintainer, reconcilePaused } from '../../core/indexing/maintainer-launcher.mjs';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = path.join(REPO_ROOT, 'core', 'indexing', 'index-maintainer.mjs');

let sandbox;
let projectRoot;
let stateDir;
let child;

beforeEach(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-maint-stop-')));
  projectRoot = path.join(sandbox, 'proj');
  stateDir = path.join(projectRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'a.js'), 'export const a = 1;\n');
  child = null;
});

afterEach(() => {
  if (child?.pid && child.exitCode == null) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function startMaintainer(extraArgs = [], extraEnv = {}) {
  const proc = spawn(process.execPath, [ENTRY, ...extraArgs], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SWEET_SEARCH_PROJECT_ROOT: projectRoot,
      SWEET_SEARCH_STATE_DIR: stateDir,
      SWEET_SEARCH_RUNTIME_DIR: path.join(sandbox, 'runtime'),
      SWEET_SEARCH_RECONCILE_V2: '1',
      // A long, pinned interval: the maintainer is asleep when the stop arrives.
      SWEET_SEARCH_RECONCILE_INTERVAL_MS: '60000',
      SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS: '0',
      SWEET_SEARCH_MAINTAINER_BG_PRIORITY: '0',
      ...extraEnv,
    },
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  proc.output = () => out;
  proc.exited = new Promise((resolve) => proc.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() })));
  return proc;
}

/** Resolve once the maintainer holds its lock and has gone to sleep after its first tick. */
async function waitUntilSleeping(proc, timeoutMs = 30_000) {
  const lock = path.join(stateDir, 'index-maintainer.lock');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) throw new Error(`maintainer exited early:\n${proc.output()}`);
    if (fs.existsSync(lock) && /interval/i.test(proc.output())) {
      // Give the first (dormant: no baseline index) tick time to finish.
      await new Promise((r) => setTimeout(r, 500));
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`maintainer never became ready:\n${proc.output()}`);
}

describe('maintainer stop', () => {
  it('exits within seconds of SIGTERM while asleep, and releases its lock', async () => {
    child = startMaintainer();
    await waitUntilSleeping(child);
    const sentAt = Date.now();
    child.kill('SIGTERM');
    const { code, at } = await child.exited;
    expect(code).toBe(0);
    // The sleep slice is 30 s; the stop must not wait it out.
    expect(at - sentAt).toBeLessThan(5_000);
    expect(fs.existsSync(path.join(stateDir, 'index-maintainer.lock'))).toBe(false);
  }, 60_000);

  it('stops on its own once the daemon behind its pid file is gone', async () => {
    const pidFile = path.join(sandbox, 'daemon.pid');
    fs.writeFileSync(pidFile, String(process.pid)); // this test process plays the daemon
    child = startMaintainer([`--daemon-pid-file=${pidFile}`], {
      SWEET_SEARCH_MAINTAINER_DAEMON_GRACE_MS: '300',
      SWEET_SEARCH_MAINTAINER_IDLE_CHECK_MS: '100',
    });
    await waitUntilSleeping(child);
    // Daemon alive: the maintainer stays.
    await new Promise((r) => setTimeout(r, 800));
    expect(child.exitCode).toBe(null);
    // Daemon gone (pid file removed, as the daemon does on shutdown).
    const goneAt = Date.now();
    fs.unlinkSync(pidFile);
    const { code, at } = await child.exited;
    expect(code).toBe(0);
    expect(at - goneAt).toBeLessThan(5_000);
    expect(child.output()).toMatch(/No search daemon behind/);
  }, 60_000);

  it('stops on its own once the process named by --daemon-pid is gone (MCP server)', async () => {
    const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      child = startMaintainer([`--daemon-pid=${owner.pid}`], {
        SWEET_SEARCH_MAINTAINER_DAEMON_GRACE_MS: '300',
        SWEET_SEARCH_MAINTAINER_IDLE_CHECK_MS: '100',
      });
      await waitUntilSleeping(child);
      await new Promise((r) => setTimeout(r, 800));
      expect(child.exitCode).toBe(null);
      const goneAt = Date.now();
      owner.kill('SIGKILL');
      const { code, at } = await child.exited;
      expect(code).toBe(0);
      expect(at - goneAt).toBeLessThan(5_000);
    } finally {
      try { owner.kill('SIGKILL'); } catch { /* gone */ }
    }
  }, 60_000);

  it('a paused index stops a running maintainer', async () => {
    child = startMaintainer([], { SWEET_SEARCH_RECONCILE_INTERVAL_MS: '200' });
    await waitUntilSleeping(child);
    fs.writeFileSync(path.join(stateDir, 'reconcile-pause.json'), JSON.stringify({ paused: true, reason: 'frozen benchmark index' }));
    const { code } = await child.exited;
    expect(code).toBe(0);
    expect(child.output()).toMatch(/paused.*frozen benchmark index.*stopping/);
  }, 60_000);

  it('bounds the time a stop may take', () => {
    expect(SIGNAL_EXIT_DEADLINE_MS).toBeGreaterThan(0);
    expect(SIGNAL_EXIT_DEADLINE_MS).toBeLessThanOrEqual(15_000);
  });
});

describe('daemon following — pure parts', () => {
  it('reads the pid file argument', () => {
    expect(daemonPidFileFromArgv(['node', 'x.mjs', '--daemon-pid-file=/tmp/a.pid'])).toBe('/tmp/a.pid');
    expect(daemonPidFileFromArgv(['node', 'x.mjs'])).toBe(null);
    expect(daemonPidFileFromArgv(['node', 'x.mjs', '--daemon-pid-file='])).toBe(null);
    expect(daemonPidFromArgv(['node', 'x.mjs', '--daemon-pid=4242'])).toBe(4242);
    expect(daemonPidFromArgv(['node', 'x.mjs', '--daemon-pid=abc'])).toBe(null);
    expect(daemonPidFromArgv(['node', 'x.mjs', '--daemon-pid-file=/tmp/a.pid'])).toBe(null);
  });

  it('a pid file is live only when it names a running process', () => {
    const f = path.join(sandbox, 'p.pid');
    expect(daemonPidFileLive(f)).toBe(false);
    fs.writeFileSync(f, String(process.pid));
    expect(daemonPidFileLive(f)).toBe(true);
    fs.writeFileSync(f, '2147483600');
    expect(daemonPidFileLive(f)).toBe(false);
    fs.writeFileSync(f, 'garbage');
    expect(daemonPidFileLive(f)).toBe(false);
  });

  it('stops only after the daemon has been missing for the whole grace', () => {
    const state = { absentSinceMs: null };
    expect(daemonGoneLongEnough(state, { live: false, nowMs: 1_000, graceMs: 100 })).toBe(false);
    expect(daemonGoneLongEnough(state, { live: false, nowMs: 1_050, graceMs: 100 })).toBe(false);
    // A daemon that comes back (a restart) resets the clock.
    expect(daemonGoneLongEnough(state, { live: true, nowMs: 1_080, graceMs: 100 })).toBe(false);
    expect(daemonGoneLongEnough(state, { live: false, nowMs: 1_090, graceMs: 100 })).toBe(false);
    expect(daemonGoneLongEnough(state, { live: false, nowMs: 1_190, graceMs: 100 })).toBe(true);
  });
});

describe('launcher', () => {
  it('starts no maintainer for a paused (frozen) index', () => {
    fs.writeFileSync(path.join(stateDir, 'reconcile-pause.json'), JSON.stringify({ paused: true, reason: 'frozen benchmark index' }));
    expect(reconcilePaused(stateDir)).toBe(true);
    const res = launchMaintainer({
      cwd: projectRoot,
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot, SWEET_SEARCH_STATE_DIR: stateDir, SWEET_SEARCH_RECONCILE_V2: '1' },
      maintainerEntry: ENTRY,
    });
    expect(res).toMatchObject({ spawned: false, reason: 'paused' });
  });

  it('passes the daemon pid file to the maintainer', async () => {
    const argvLog = path.join(sandbox, 'argv.json');
    const fake = path.join(sandbox, 'fake-maintainer.mjs');
    fs.writeFileSync(fake, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));\n`);
    const res = launchMaintainer({
      cwd: projectRoot,
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot, SWEET_SEARCH_STATE_DIR: stateDir, SWEET_SEARCH_RECONCILE_V2: '1', SWEET_SEARCH_MAINTAINER_BG_PRIORITY: '0' },
      maintainerEntry: fake,
      daemonPidFile: '/tmp/some-daemon.pid',
    });
    expect(res.spawned).toBe(true);
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(argvLog) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(JSON.parse(fs.readFileSync(argvLog, 'utf-8'))).toEqual(['--daemon-pid-file=/tmp/some-daemon.pid']);
  }, 20_000);
});
