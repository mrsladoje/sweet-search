// The search daemon's log: .sweet-search/daemon.log in the project. Every spawner sends the
// daemon's stdout and stderr here, so a daemon that fails at start leaves its reason behind
// (`sweet-search daemon status` and the CLI's start-up error point to it).
//
// Mirrors: crates/sweet-search-cli/src/main.rs:open_daemon_log

import { closeSync, existsSync, openSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';

/** Above this size the log starts over at the next daemon start. */
export const DAEMON_LOG_MAX_BYTES = 1024 * 1024;

/** `.sweet-search/daemon.log`, or null before the project has a `.sweet-search/` dir. */
export function daemonLogPath(projectRoot) {
  const dir = path.join(projectRoot, '.sweet-search');
  return existsSync(dir) ? path.join(dir, 'daemon.log') : null;
}

/**
 * A file descriptor for the daemon's stdout and stderr, opened for appending (a second
 * daemon started at the same moment writes into the same file, then exits), or 'ignore'
 * when there is no log. The caller passes it to spawn() and then calls closeDaemonLog().
 */
export function openDaemonLog(projectRoot) {
  const file = daemonLogPath(projectRoot);
  if (!file) return 'ignore';
  try {
    try {
      if (statSync(file).size > DAEMON_LOG_MAX_BYTES) unlinkSync(file);
    } catch { /* no log yet */ }
    const fd = openSync(file, 'a');
    writeSync(fd, `--- daemon start (unix time ${Math.floor(Date.now() / 1000)})\n`);
    return fd;
  } catch {
    return 'ignore';
  }
}

export function closeDaemonLog(fd) {
  if (typeof fd === 'number') {
    try { closeSync(fd); } catch { /* already closed */ }
  }
}
