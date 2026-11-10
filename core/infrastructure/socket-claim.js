/**
 * The rules a process follows to serve on a Unix socket PATH that other processes also try
 * to serve on (the search daemon's per-project socket, the shared query-model server).
 *
 * A socket path has no owner field. A server that removes the path and binds it takes it from
 * whoever was there, and closing a Unix-socket server makes Node remove the path, whatever
 * file is there by then. Without these rules two servers that start at once each remove the
 * other's socket, and the one that lost later removes the winner's socket when it exits.
 *
 *   1. Start: hold the start lock (`<socket>.start`) from before the "does a server answer?"
 *      probe until the socket is bound. One starter at a time; the others wait for its socket.
 *   2. Bound: record the inode of the socket file (fileInode) once listening.
 *   3. Stop: close the server and remove files only while the path still has that inode.
 *
 * See docs/STATE_MACHINES.md, "Socket path ownership".
 */

import fs from 'node:fs';
import net from 'node:net';
import { pidAlive } from './pid-alive.js';

// A start takes well under this (bind happens before any index or model loads). An older
// start lock is left by a server that died before listening; its pid may belong to another
// process by now, so age decides, not the pid alone.
export const START_LOCK_STALE_MS = 60_000;

function startLockHeld(text, ageMs) {
  if (ageMs >= START_LOCK_STALE_MS) return false;
  const holder = Number(text);
  if (!(holder > 0)) return ageMs < 5_000; // being written (no hard links): young = held
  return pidAlive(holder);
}

function ageOf(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return Infinity; }
}

/** Create the start lock atomically, or take it over when it is stale. */
export function takeStartLock(file) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, String(process.pid));
    try {
      fs.linkSync(tmp, file);
      return true;
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        // No hard links here: O_EXCL create.
        try {
          const fd = fs.openSync(file, 'wx');
          try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
          return true;
        } catch (e) {
          if (e?.code !== 'EEXIST') throw e;
        }
      }
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* gone */ }
    }
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
    if (startLockHeld(text, ageOf(file))) return false;
    // Remove that exact stale version: move it aside (one taker wins), judge it there, and
    // put back a live lock someone created meanwhile.
    const aside = `${file}.${process.pid}.stale`;
    try { fs.renameSync(file, aside); } catch { continue; }
    let asideText = '';
    try { asideText = fs.readFileSync(aside, 'utf8'); } catch { asideText = ''; }
    if (startLockHeld(asideText, ageOf(aside))) {
      try { fs.linkSync(aside, file); } catch { /* a newer lock holds the name */ }
    }
    try { fs.unlinkSync(aside); } catch { /* gone */ }
  }
  return false;
}

/** Remove the start lock, only while this process holds it. */
export function dropStartLock(file) {
  try { if (Number(fs.readFileSync(file, 'utf8')) === process.pid) fs.unlinkSync(file); } catch { /* gone */ }
}

/** Is a server answering on `socketPath`? (A connect: a loading or busy server answers too.) */
export function socketAnswers(socketPath, timeoutMs = 500) {
  return new Promise((resolve) => {
    const s = net.connect(socketPath);
    const done = (v) => { clearTimeout(t); s.destroy(); resolve(v); };
    const t = setTimeout(() => done(false), timeoutMs);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/**
 * The inode of the file at `filePath`: null when there is none, undefined when it cannot be
 * told (any other error). A socket path that was removed and bound again has another inode.
 */
export function fileInode(filePath) {
  try { return fs.statSync(filePath).ino; } catch (err) { return err?.code === 'ENOENT' ? null : undefined; }
}

/**
 * Wait for the right to start a server on `socketPath`. Resolves to `{ release }` when this
 * process holds the start lock (call `release` once the socket is bound, or when it gives
 * up), or to null when another server answers on the path, so this one is not needed.
 *
 * A starter that finds the lock held does not exit at once: the client that spawned it waits
 * for a socket it can connect to, and an early exit would read as "the daemon failed to
 * start". It waits until the holder's socket answers. A holder that dies leaves a lock that
 * is taken over (takeStartLock); `waitMs` bounds the wait on a holder that never binds.
 */
export async function claimSocketStart(socketPath, { waitMs = START_LOCK_STALE_MS + 5_000, pollMs = 100 } = {}) {
  const lock = `${socketPath}.start`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (takeStartLock(lock)) return { release: () => dropStartLock(lock) };
    if (await socketAnswers(socketPath)) return null;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
