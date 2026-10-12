/**
 * Reader heartbeat / grace policy.
 *
 * Plan § 8.1.1. Strict row visibility requires bounded history retention:
 * retired rows cannot be physically pruned until every live reader has
 * advanced past their epoch. We track each reader's pinned epoch via a
 * small JSON file under `.sweet-search/readers/<pid>-<boot>-<read>.json`
 * so the maintenance scheduler can compute `min_live_epoch` across
 * non-stale heartbeats. The per-read token is load-bearing: a long-lived
 * MCP/server process can run concurrent queries pinned to different
 * manifest epochs, and those pins must not overwrite each other.
 *
 * Lifecycle:
 *   - Each reader process (sweet-search CLI, MCP server, etc.) calls
 *     `beginRead(stateDir, epoch)` before a query and `endRead` when it
 *     finishes. The heartbeat file holds `{ epoch, pid, bootId, readId, startedAt }`.
 *   - The reconcile maintenance worker enumerates the heartbeats and:
 *     - drops files whose process no longer exists,
 *     - returns `min({live readers}.epoch)` as the prune frontier.
 *   - Heartbeats older than READER_GRACE_MS without a live pid are
 *     ignored.
 *
 * This file is pure I/O. The reconciler / maintenance worker uses it to
 * compute `min_live_epoch` but does not block on it (heartbeats are
 * advisory; correctness is preserved by tombstone-then-prune).
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const READER_GRACE_MS = 60 * 60 * 1000; // 1h default
const HEARTBEAT_DIR = 'readers';
let heartbeatSeq = 0;

function heartbeatDir(stateDir) {
  return path.join(stateDir, HEARTBEAT_DIR);
}

function heartbeatPath(stateDir, pid, bootId, readId = null) {
  const suffix = readId ? `-${readId}` : '';
  return path.join(heartbeatDir(stateDir), `${pid}-${bootId}${suffix}.json`);
}

function nextReadId() {
  heartbeatSeq = (heartbeatSeq + 1) >>> 0;
  const time = Date.now().toString(36);
  const seq = heartbeatSeq.toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${time}-${seq}-${rand}`;
}

/**
 * Returns a coarse boot-id stand-in. Plan § 8.6 mentions
 * `/proc/sys/kernel/random/boot_id` on Linux and `kern.boottime` on macOS;
 * we keep a cross-platform fallback based on `os.uptime()` rounded to the
 * minute boundary, which is stable across the lifetime of a process and
 * changes whenever the machine reboots.
 *
 * @returns {string}
 */
export function bootIdStub() {
  try {
    const procBoot = '/proc/sys/kernel/random/boot_id';
    if (fs.existsSync(procBoot)) {
      const raw = fs.readFileSync(procBoot, 'utf-8').trim();
      return raw.replace(/[^a-zA-Z0-9-]/g, '');
    }
  } catch {
    // fall through
  }
  // Stable enough for the heartbeat: the same process never gets a different
  // value, and a reboot always changes it.
  const epochSeconds = Math.floor(Date.now() / 1000 - os.uptime());
  return `boot-${epochSeconds}`;
}

/**
 * Record a reader heartbeat. Idempotent; safe to call before every query.
 *
 * @param {string} stateDir
 * @param {number} epoch
 * @param {object} [meta]   Optional caller-supplied metadata (mcp-session-id,
 *                           query, etc.) — stored verbatim for diagnostics.
 * @returns {{pid:number, bootId:string, readId:string, path:string}}
 */
export function beginRead(stateDir, epoch, meta = {}) {
  const dir = heartbeatDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const pid = process.pid;
  const bootId = bootIdStub();
  const readId = nextReadId();
  const p = heartbeatPath(stateDir, pid, bootId, readId);
  const payload = {
    epoch,
    pid,
    bootId,
    readId,
    startedAt: new Date().toISOString(),
    // When this process started: a later process that reuses the pid is not this reader.
    procStartMs: Math.round(performance.timeOrigin),
    meta,
  };
  fs.writeFileSync(p, JSON.stringify(payload));
  return { pid, bootId, readId, path: p };
}

/**
 * Drop the heartbeat. Plan § 8.1.1 step 2 requires every reader process
 * to delete its file when the query completes.
 *
 * @param {string} stateDir
 * @param {{pid:number, bootId:string, readId?:string, path?:string}|undefined} record
 *        Return value of beginRead.
 */
export function endRead(stateDir, record) {
  const pid = record?.pid ?? process.pid;
  const bootId = record?.bootId ?? bootIdStub();
  const p = typeof record?.path === 'string'
    ? record.path
    : heartbeatPath(stateDir, pid, bootId, record?.readId ?? null);
  try {
    fs.unlinkSync(p);
  } catch {
    // Ignore — the heartbeat may have been swept by the maintenance scheduler.
  }
}

/**
 * Best-effort liveness check. Returns true when the process is still
 * running and matches the recorded boot id.
 *
 * @param {number} pid
 * @param {string} bootId
 */
export function isReaderAlive(pid, bootId, procStartMs = null) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (bootId !== bootIdStub()) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err.code !== 'EPERM') return false;
  }
  // A heartbeat outlives its reads (search-reader-pin.js), so a reader killed without its exit
  // hook leaves a file whose pid a later process can take. That process started after the
  // reader did. (Start times read to the second; a minute of slack.)
  if (Number.isFinite(procStartMs) && pid !== process.pid) {
    const started = processStartMs(pid);
    if (started !== null && started > procStartMs + 60_000) return false;
  }
  return true;
}

/** Epoch ms at which process `pid` started, or null when it cannot be read. */
export function processStartMs(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
      const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
      const btime = Number(/^btime (\d+)$/m.exec(fs.readFileSync('/proc/stat', 'utf-8'))?.[1]);
      // USER_HZ is 100 on every Linux build Node supports.
      return Number.isFinite(ticks) && Number.isFinite(btime) ? (btime + ticks / 100) * 1000 : null;
    }
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const ms = Date.parse(out.trim().replace(/\s+/g, ' '));
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Sweep stale heartbeats. Returns the surviving records sorted by
 * pinned epoch.
 *
 * @param {string} stateDir
 * @returns {Array<{epoch:number, pid:number, bootId:string, readId?:string, startedAt:string, meta:object}>}
 */
export function liveReaders(stateDir) {
  const dir = heartbeatDir(stateDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
      // Malformed — drop after grace.
      tryUnlinkAfterGrace(p);
      continue;
    }
    if (!Number.isInteger(payload.epoch) || !Number.isInteger(payload.pid) || typeof payload.bootId !== 'string') {
      tryUnlinkAfterGrace(p);
      continue;
    }
    if (!isReaderAlive(payload.pid, payload.bootId, payload.procStartMs)) {
      tryUnlinkAfterGrace(p);
      continue;
    }
    out.push(payload);
  }
  return out.sort((a, b) => a.epoch - b.epoch);
}

function tryUnlinkAfterGrace(p) {
  try {
    const stat = fs.statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > READER_GRACE_MS) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

/**
 * Compute the prune frontier — the minimum epoch any live reader pins.
 * Returns `null` when no live readers exist, meaning all retired rows
 * older than the current epoch are eligible for prune.
 *
 * @param {string} stateDir
 * @returns {number|null}
 */
export function minLiveEpoch(stateDir) {
  const live = liveReaders(stateDir);
  if (live.length === 0) return null;
  return live[0].epoch;
}
