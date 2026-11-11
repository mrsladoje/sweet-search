/**
 * Which process a pid names.
 *
 * A pid read from a file (a lock, a pause, a pid file, a registry) names its writer only
 * while the writer lives. After the writer dies the OS gives the number to another program,
 * and `kill -0` succeeds for that program too. A signal sent on the pid alone then stops an
 * editor or a database, and a "the holder is alive" answer keeps a dead holder's lock for as
 * long as that program runs.
 *
 * The rule: the writer stores its START TOKEN beside its pid (`ownStartToken`), and a reader
 * compares that token with the token of the process that has the pid now (`processIs`)
 * before it sends a signal or decides that the holder lives.
 *
 * The token is the start time as the OS reports it, read the same way by the writer and the
 * reader and compared as a string. It is not compared with a clock: a start time taken from
 * `Date.now()` on one side and from the OS on the other differs after a clock step.
 *   - Linux: boot id + field 22 of /proc/<pid>/stat (start time in ticks since boot).
 *   - elsewhere: `ps -o lstart=` in UTC (a change of the system time zone does not change it).
 *
 * See docs/STATE_MACHINES.md, "A pid read from a file is not a process identity".
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pidAlive } from './pid-alive.js';

const PS_TIMEOUT_MS = 2_000;
// Every long-lived sweet-search process titles itself with this prefix (process-title.js).
const OWN_TITLE_PREFIX = 'sweet-search-';

let linuxBootId = null;
function bootId() {
  if (linuxBootId === null) {
    try { linuxBootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { linuxBootId = ''; }
  }
  return linuxBootId;
}

/**
 * What the OS says about `pid` now: `{ token, zombie, command }`, or null when it cannot be
 * read (no such process, no `ps`, Windows). `command` is null unless asked for.
 */
function inspect(pid, { command = false } = {}) {
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      // The name (field 2) can hold spaces and brackets: count from the last ')'.
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ticks = rest[19];
      let cmd = null;
      if (command) {
        try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+/g, ' ').trim(); } catch { cmd = null; }
      }
      return { token: /^\d+$/.test(ticks || '') ? `${bootId()}:${ticks}` : null, zombie: rest[0] === 'Z', command: cmd };
    }
    const out = execFileSync('ps', ['-o', 'stat=', '-o', 'lstart=', '-o', 'command=', '-p', String(pid)], {
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: PS_TIMEOUT_MS,
    });
    // "Ss   Tue Nov 10 07:52:11 2026     sweet-search-maintainer"
    const m = /^\s*(\S+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)[ \t]*(.*)$/s.exec(out);
    if (!m) return null;
    return { token: m[2].replace(/\s+/g, ' '), zombie: m[1].startsWith('Z'), command: m[3].trim() };
  } catch {
    return null;
  }
}

/** The start token of process `pid`, or null when it cannot be read. */
export function processStartToken(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return inspect(pid)?.token ?? null;
}

let ownToken = null;
/** This process's start token, to store beside `process.pid` (null when it cannot be read). */
export function ownStartToken() {
  if (ownToken === null) ownToken = processStartToken(process.pid);
  return ownToken;
}

function judge(pid, startToken, ownTitle) {
  if (!pidAlive(pid)) return 'gone';
  if (pid === process.pid) {
    const own = ownStartToken();
    return startToken && own ? (own === startToken ? 'same' : 'other') : 'unknown';
  }
  const seen = inspect(pid, { command: ownTitle });
  // The process can end between the probe and the read.
  if (!seen) return pidAlive(pid) ? 'unknown' : 'gone';
  if (seen.zombie) return 'gone';
  if (startToken && seen.token) return seen.token === startToken ? 'same' : 'other';
  if (ownTitle && seen.command) return seen.command.startsWith(OWN_TITLE_PREFIX) ? 'same' : 'other';
  return 'unknown';
}

/**
 * Who has `pid` now, compared with the process that stored `startToken` beside it:
 *   'gone'    no process has the pid (or only a zombie: it ended and was not reaped)
 *   'same'    the process that wrote the token
 *   'other'   another process got the pid
 *   'unknown' a process has the pid, and one of the two tokens is missing
 *
 * 'unknown' is the answer for a file written without a token and on a platform where the
 * start time cannot be read. The caller decides; a pid probe alone gave "alive" there.
 */
export function processIs(pid, startToken) {
  return judge(pid, startToken, false);
}

/**
 * The same for a pid that a file names as a sweet-search daemon or maintainer. Those title
 * themselves `sweet-search-…`, so with no token to compare the command decides. 'unknown'
 * is left only when the command cannot be read either. Use it before a signal.
 */
export function sweetSearchProcessIs(pid, startToken) {
  return judge(pid, startToken, true);
}

/**
 * Does the holder that a file names still live? False when the process is gone or another
 * process has its pid. True when it cannot be told ('unknown'): a holder taken for dead
 * while it works gives two writers.
 */
export function holderLives(pid, startToken) {
  const who = processIs(pid, startToken);
  return who === 'same' || who === 'unknown';
}
