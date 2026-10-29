import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DAEMON_STARTS_FILE,
  KEEP_STARTS,
  readDaemonStarts,
  recordDaemonStart,
  summarizeDaemonStarts,
} from '../../core/search/daemon-starts.js';
import {
  KEEPALIVE_POLL_S,
  findWslExe,
  isWsl,
  keepAliveCommand,
  startWslKeepAlive,
} from '../../core/search/wsl-keepalive.js';
import { formatDuration, formatSetupStatus } from '../../core/search/setup-status.js';

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-starts-'));
  dirs.push(d);
  return d;
}

describe('daemon start history', () => {
  it('appends, reads back and skips torn lines', () => {
    const d = tmp();
    recordDaemonStart(d, { startedAt: 1000, loadMs: 50, ok: true, pid: 1 });
    fs.appendFileSync(path.join(d, DAEMON_STARTS_FILE), '{"startedAt":\n');
    recordDaemonStart(d, { startedAt: 2000, loadMs: 70, ok: false, pid: 2 });
    expect(readDaemonStarts(d).map((e) => e.pid)).toEqual([1, 2]);
  });

  it('keeps the file bounded', () => {
    const d = tmp();
    for (let i = 0; i < KEEP_STARTS * 2 + 5; i++) recordDaemonStart(d, { startedAt: i, loadMs: 1, ok: true, pid: i });
    const lines = fs.readFileSync(path.join(d, DAEMON_STARTS_FILE), 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(KEEP_STARTS * 2);
    expect(readDaemonStarts(d).at(-1).pid).toBe(KEEP_STARTS * 2 + 4);
  });

  it('reads nothing from a missing dir', () => {
    expect(readDaemonStarts(path.join(tmp(), 'nope'))).toEqual([]);
  });

  it('summarizes only the last 24 hours', () => {
    const now = 10 * 24 * 3600 * 1000;
    const s = summarizeDaemonStarts([
      { startedAt: now - 25 * 3600 * 1000, loadMs: 99_000, ok: true },
      { startedAt: now - 3600 * 1000, loadMs: 4000, ok: true },
      { startedAt: now - 60 * 1000, loadMs: 9000, ok: false },
      { startedAt: now - 1000, loadMs: 2000, ok: true },
    ], now);
    expect(s).toEqual({ startsLast24h: 3, failedLast24h: 1, medianLoadMs: 4000, slowestLoadMs: 9000 });
    expect(summarizeDaemonStarts([], now)).toEqual({ startsLast24h: 0, failedLast24h: 0, medianLoadMs: null, slowestLoadMs: null });
  });
});

describe('WSL keep-alive', () => {
  const wslEnv = { WSL_DISTRO_NAME: 'Ubuntu', PATH: '/usr/bin:/mnt/c/WINDOWS/system32' };
  const okFor = (file) => (p) => { if (p !== file) throw new Error('ENOENT'); };

  it('detects WSL from the env or the kernel release', () => {
    expect(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }, '6.8.0')).toBe(true);
    expect(isWsl({}, '5.15.167.4-microsoft-standard-WSL2')).toBe(true);
    expect(isWsl({}, '24.3.0')).toBe(false);
  });

  it('finds wsl.exe on PATH first, then at its usual location', () => {
    expect(findWslExe(wslEnv, okFor('/mnt/c/WINDOWS/system32/wsl.exe'))).toBe('/mnt/c/WINDOWS/system32/wsl.exe');
    expect(findWslExe({ PATH: '/usr/bin' }, okFor('/mnt/c/Windows/System32/wsl.exe'))).toBe('/mnt/c/Windows/System32/wsl.exe');
    expect(findWslExe({ PATH: '/usr/bin' }, () => { throw new Error('ENOENT'); })).toBeNull();
  });

  it('builds a loop that ends when the daemon exits', () => {
    const cmd = keepAliveCommand({ pid: 4242, env: wslEnv, release: 'x', access: okFor('/mnt/c/WINDOWS/system32/wsl.exe') });
    expect(cmd.exe).toBe('/mnt/c/WINDOWS/system32/wsl.exe');
    expect(cmd.args).toEqual(['-d', 'Ubuntu', '--exec', 'sh', '-c',
      `while [ -d /proc/4242 ]; do sleep ${KEEPALIVE_POLL_S}; done`]);
  });

  it('does nothing off WSL, when turned off, without a distro name or without wsl.exe', () => {
    const access = okFor('/mnt/c/WINDOWS/system32/wsl.exe');
    expect(keepAliveCommand({ pid: 1, env: { PATH: wslEnv.PATH }, release: '24.3.0', access })).toBeNull();
    expect(keepAliveCommand({ pid: 1, env: { ...wslEnv, SWEET_SEARCH_WSL_KEEPALIVE: '0' }, release: 'x', access })).toBeNull();
    expect(keepAliveCommand({ pid: 1, env: { PATH: wslEnv.PATH }, release: 'microsoft', access })).toBeNull();
    expect(keepAliveCommand({ pid: 1, env: wslEnv, release: 'x', access: () => { throw new Error('x'); } })).toBeNull();
  });

  it('starts a detached child and stops it; a failed spawn returns null', () => {
    const calls = [];
    const child = { pid: 77, on() {}, unref() { calls.push('unref'); }, kill() { calls.push('kill'); } };
    const env = { WSL_DISTRO_NAME: 'Ubuntu', PATH: '/mnt/c/Windows/System32' };
    // startWslKeepAlive resolves wsl.exe itself: give it a PATH dir that holds a fake one.
    const d = tmp();
    fs.writeFileSync(path.join(d, 'wsl.exe'), '', { mode: 0o755 });
    const ka = startWslKeepAlive({
      pid: 5, env: { ...env, PATH: d },
      spawn: (exe, args, opts) => { calls.push([exe, args[1], opts.detached]); return child; },
    });
    expect(ka.pid).toBe(77);
    ka.stop();
    expect(calls).toEqual([[path.join(d, 'wsl.exe'), 'Ubuntu', true], 'unref', 'kill']);
    expect(startWslKeepAlive({ pid: 5, env: { ...env, PATH: d }, spawn: () => { throw new Error('boom'); } })).toBeNull();
  });
});

describe('status output for the server', () => {
  const base = {
    projectRoot: '/repo',
    install: { version: '1', packageRoot: '/pkg', skippedPostinstall: null },
    setup: { initialized: true, modelsDeferred: false, liModel: 'none' },
    models: { cacheRoot: '/c', cacheWritable: true, required: [] },
    index: { ready: true, reason: 'ready', parts: { codeGraph: true, searchDatabase: true, vectorIndex: true, lateInteraction: null }, state: null },
    nextStep: null,
  };
  const server = (extra) => ({ state: 'ready', pid: 9, error: null, socket: '/s', log: null, uptimeSec: 7300, loadMs: 4200, ...extra });

  it('shows uptime, load time and the starts of the last day', () => {
    const out = formatSetupStatus({ ...base, server: server({ starts: { startsLast24h: 4, failedLast24h: 1, medianLoadMs: 4100, slowestLoadMs: 65_000 }, wsl: null }) });
    expect(out).toContain('Running for: 2 h 2 min');
    expect(out).toContain('Index load time at its start: 4.2 s');
    expect(out).toContain('Starts in the last 24 hours: 4, 1 failed (index load: median 4.1 s, slowest 65 s)');
    expect(out).not.toContain('WSL');
  });

  it('explains frequent starts on WSL', () => {
    const starts = { startsLast24h: 5, failedLast24h: 0, medianLoadMs: 1, slowestLoadMs: 1 };
    expect(formatSetupStatus({ ...base, server: server({ starts, wsl: { keepAlive: false } }) }))
      .toMatch(/WSL stops the server when no terminal is open/);
    expect(formatSetupStatus({ ...base, server: server({ starts, wsl: { keepAlive: true } }) }))
      .toMatch(/holds a session open/);
    expect(formatSetupStatus({ ...base, server: server({ starts: { ...starts, startsLast24h: 1 }, wsl: { keepAlive: false } }) }))
      .not.toMatch(/WSL/);
  });

  it('formats durations', () => {
    expect(formatDuration(870)).toBe('0.9 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(600_000)).toBe('10 min');
    expect(formatDuration(3 * 3600_000 + 60_000)).toBe('3 h 1 min');
  });
});
