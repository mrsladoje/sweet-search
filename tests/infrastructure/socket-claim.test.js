/**
 * core/infrastructure/socket-claim.js: the start lock and the path-ownership check that keep
 * one server per Unix socket path (docs/STATE_MACHINES.md, "Socket path ownership").
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  START_LOCK_STALE_MS, takeStartLock, dropStartLock, claimSocketStart, fileInode, socketAnswers,
} from '../../core/infrastructure/socket-claim.js';

let dir;
let socketPath;
let lock;

/** A pid that is certainly dead: a child that already exited. */
function deadPid() {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

function listen(server, at) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(at, resolve); });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ss-claim-'));
  socketPath = join(dir, 'd.sock');
  lock = `${socketPath}.start`;
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('takeStartLock / dropStartLock', () => {
  it('gives the lock to one taker and refuses a second while the holder lives', () => {
    expect(takeStartLock(lock)).toBe(true);
    expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
    // The holder (this process) is alive: a second take, as another starter would do it, fails.
    expect(takeStartLock(lock)).toBe(false);
    dropStartLock(lock);
    expect(existsSync(lock)).toBe(false);
  });

  it('takes over a lock whose holder died', () => {
    writeFileSync(lock, String(deadPid()));
    expect(takeStartLock(lock)).toBe(true);
    expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
  });

  it('takes over a lock older than the stale age, whatever its pid', () => {
    // A live pid (the parent of the test) that is not a starter: age decides.
    writeFileSync(lock, String(process.ppid));
    const old = new Date(Date.now() - START_LOCK_STALE_MS - 5_000);
    utimesSync(lock, old, old);
    expect(takeStartLock(lock)).toBe(true);
  });

  it('does not remove a lock another process holds', () => {
    writeFileSync(lock, String(process.ppid));
    dropStartLock(lock);
    expect(existsSync(lock)).toBe(true);
  });
});

describe('claimSocketStart', () => {
  it('returns a claim when nobody starts or serves, and release frees it', async () => {
    const claim = await claimSocketStart(socketPath);
    expect(claim).not.toBeNull();
    expect(existsSync(lock)).toBe(true);
    claim.release();
    expect(existsSync(lock)).toBe(false);
  });

  it('waits on a held claim and gives up (null) once the holder\'s socket answers', async () => {
    writeFileSync(lock, String(process.ppid)); // another starter holds the claim
    const server = net.createServer((conn) => conn.destroy());
    const pending = claimSocketStart(socketPath, { pollMs: 20 });
    let settled = false;
    pending.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled).toBe(false); // still waiting: the holder has not bound yet

    await listen(server, socketPath);
    try {
      expect(await pending).toBeNull();
      expect(readFileSync(lock, 'utf8')).toBe(String(process.ppid)); // the holder's lock is untouched
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('takes the claim when the holder dies before it binds', async () => {
    writeFileSync(lock, String(deadPid()));
    const claim = await claimSocketStart(socketPath, { pollMs: 20 });
    expect(claim).not.toBeNull();
    claim.release();
  });

  it('gives up after the wait bound when the holder never binds', async () => {
    writeFileSync(lock, String(process.ppid));
    expect(await claimSocketStart(socketPath, { waitMs: 150, pollMs: 20 })).toBeNull();
  });
});

describe('fileInode — whose socket file is at the path', () => {
  it('is null for a missing path and changes when the path is bound again', async () => {
    expect(fileInode(socketPath)).toBeNull();
    const a = net.createServer();
    await listen(a, socketPath);
    const inoA = fileInode(socketPath);
    expect(Number.isInteger(inoA)).toBe(true);

    // A second server takes the path over, as a daemon that found no answer does.
    rmSync(socketPath);
    const b = net.createServer();
    await listen(b, socketPath);
    try {
      expect(fileInode(socketPath)).not.toBe(inoA);
      // The fact the ownership check exists for: closing the first server removes the PATH,
      // although the file there now belongs to the second.
      await new Promise((resolve) => a.close(resolve));
      expect(await socketAnswers(socketPath)).toBe(false);
    } finally {
      await new Promise((resolve) => b.close(resolve));
    }
  });
});
