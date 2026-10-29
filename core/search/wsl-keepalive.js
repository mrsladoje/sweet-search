// WSL keep-alive for the search daemon.
//
// WSL shuts a distribution down a short time after its last terminal session ends, and every
// process in it stops, the search daemon too. The next search then pays a cold start (the
// index loads again). The `.wslconfig` idle timeouts do not reliably prevent this; a session
// that stays open does. So while the daemon runs, it holds one session open: a `wsl.exe`
// started through WSL interop that runs a shell loop in the same distribution. The loop ends
// itself within KEEPALIVE_POLL_S of the daemon's exit, so the keep-alive never outlives the
// daemon (which stops itself after its idle TTL). SWEET_SEARCH_WSL_KEEPALIVE=0 turns it off.

import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const KEEPALIVE_POLL_S = 15;
const WSL_EXE_FALLBACK = '/mnt/c/Windows/System32/wsl.exe';

export function isWsl(env = process.env, release = os.release()) {
  return Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(release);
}

function isOff(value) {
  return ['0', 'false', 'off', 'no'].includes(String(value ?? '').toLowerCase());
}

/** `wsl.exe` on PATH (interop appends the Windows PATH), else its usual location, else null. */
export function findWslExe(env = process.env, access = accessSync) {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const candidate of [...dirs.map((d) => path.join(d, 'wsl.exe')), WSL_EXE_FALLBACK]) {
    try {
      access(candidate, constants.X_OK);
      return candidate;
    } catch { /* next */ }
  }
  return null;
}

/** The command that holds a session open while `pid` lives, or null when it does not apply. */
export function keepAliveCommand({ pid, env = process.env, release = os.release(), access = accessSync } = {}) {
  if (!isWsl(env, release) || isOff(env.SWEET_SEARCH_WSL_KEEPALIVE)) return null;
  const distro = env.WSL_DISTRO_NAME;
  if (!distro || !Number.isInteger(pid) || pid <= 0) return null;
  const exe = findWslExe(env, access);
  if (!exe) return null;
  // /proc, not `kill -0`: wsl.exe runs the loop as the distro's default user, and kill -0 on
  // another user's process fails (EPERM), which ended the loop at once.
  const loop = `while [ -d /proc/${pid} ]; do sleep ${KEEPALIVE_POLL_S}; done`;
  return { exe, args: ['-d', distro, '--exec', 'sh', '-c', loop] };
}

/**
 * Start the keep-alive for this daemon. Returns { stop() } or null. Never throws: without
 * interop (or on a failed spawn) the daemon only loses the keep-alive.
 */
export function startWslKeepAlive({ pid = process.pid, env = process.env, spawn = nodeSpawn, log = () => {} } = {}) {
  const cmd = keepAliveCommand({ pid, env });
  if (!cmd) return null;
  let child;
  try {
    child = spawn(cmd.exe, cmd.args, { stdio: 'ignore', detached: true });
    child.on?.('error', (err) => log(`WSL keep-alive failed: ${err?.message || err}`));
    child.unref?.();
  } catch (err) {
    log(`WSL keep-alive failed: ${err?.message || err}`);
    return null;
  }
  log(`WSL keep-alive on (process id ${child.pid}); set SWEET_SEARCH_WSL_KEEPALIVE=0 to turn it off`);
  return {
    pid: child.pid,
    stop() {
      try { child.kill(); } catch { /* the loop also ends when the daemon exits */ }
    },
  };
}
