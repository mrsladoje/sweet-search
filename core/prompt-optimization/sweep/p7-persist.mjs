/**
 * Phase 7 — Persistence + resume scaffolding (§7.4).
 *
 * Provides durable, fsync-backed JSONL append so a run can be fully resumed
 * after any crash including kill -9.  All write paths:
 *   1. appendFsynced  — open fd → write → fsyncSync → close (in try/finally)
 *   2. atomicWriteJSON — write to .tmp then fs.renameSync (atomic on POSIX)
 *
 * IMPORTANT: appendFileSync does NOT guarantee fsync on macOS or Linux
 * (per GPT-5.5 review §D2).  We open an fd explicitly on every call.
 *
 * Path builders mirror §9:
 *   RESULTS_DIR(runId)     → core/prompt-optimization/data/results/<runId>
 *   trajectoryPath(runId)  → …/<runId>/gepa-trajectory.jsonl
 *   promptBankPath(runId)  → …/<runId>/prompt-bank.jsonl
 *   paretoCurrentPath(runId) → …/<runId>/pareto-current.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_KINDS } from './p7-shared.mjs';

// ─── internal helpers ────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root: sweep/ → prompt-optimization/ → core/ → root
const REPO_ROOT = path.resolve(__dirname, '../../..');

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── path builders (§9) ──────────────────────────────────────────────────────

export function RESULTS_DIR(runId) {
  return path.join(REPO_ROOT, 'core', 'prompt-optimization', 'data', 'results', runId);
}

export function trajectoryPath(runId) {
  return path.join(RESULTS_DIR(runId), 'gepa-trajectory.jsonl');
}

export function promptBankPath(runId) {
  return path.join(RESULTS_DIR(runId), 'prompt-bank.jsonl');
}

export function paretoCurrentPath(runId) {
  return path.join(RESULTS_DIR(runId), 'pareto-current.json');
}

// ─── durable JSONL append ────────────────────────────────────────────────────

/**
 * Append `event` as a JSON line to `filePath`, with an explicit fsync
 * before closing.  Creates parent directories if missing.
 *
 * This is the ONLY safe way to append on macOS/Linux: appendFileSync
 * goes through buffered I/O and does NOT guarantee fsync.  Without fsync,
 * a kill -9 mid-write can silently lose the last event(s).
 */
export function appendFsynced(filePath, event) {
  ensureDir(filePath);
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeSync(fd, JSON.stringify(event) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Alias kept for call-site readability (e.g. appendEvent(path, ev)). */
export const appendEvent = appendFsynced;

// ─── atomic JSON write ───────────────────────────────────────────────────────

/**
 * Write `obj` as pretty-printed JSON to `filePath` atomically AND durably:
 *   1. Write to `filePath + '.tmp'` via an explicit fd
 *   2. fsync the tmp fd so its bytes hit disk before the rename
 *   3. fs.renameSync to final path (POSIX atomic)
 *   4. best-effort fsync of the containing directory so the rename itself
 *      survives a power loss (skipped silently where the platform rejects it)
 *
 * Guarantees the reader always sees either the old file or the new file,
 * never a partial write. The tmp-fsync mirrors `appendFsynced`'s durability
 * contract (§7.4) — `writeFileSync` alone does NOT fsync.
 */
export function atomicWriteJSON(filePath, obj) {
  ensureDir(filePath);
  const tmpPath = filePath + '.tmp';
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(obj, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);

  // Durably persist the rename itself by fsyncing the parent directory.
  // Not all platforms/filesystems permit fsync on a directory fd — treat
  // any failure here as best-effort (atomicity is already guaranteed).
  try {
    const dirFd = fs.openSync(path.dirname(filePath), 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* best-effort directory fsync */
  }
}

// ─── JSONL reader ────────────────────────────────────────────────────────────

/**
 * Read `filePath` as JSONL, returning an array of parsed events.
 * Silently skips corrupt or partial trailing lines (crash-safe).
 * Returns [] if the file does not exist.
 */
export function loadTrajectory(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const events = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      // corrupt / truncated trailing line — skip gracefully
    }
  }
  return events;
}

/**
 * Parse `filePath` as a JSON object (Pareto-front state) or return null
 * if the file is absent or unparseable.
 */
export function loadParetoCurrent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── resume state ────────────────────────────────────────────────────────────

/**
 * Derive a canonical step identifier from an event.
 * Used to detect already-completed steps on resume.
 *
 * Format: `<kind>:<round>:<mutation_hash>:<probe_id>:<target>`
 * Empty fields become empty strings so the `:` separators remain stable.
 */
export function stepId(event) {
  const kind = event._kind || '';
  const round = event.round !== undefined ? String(event.round) : '';
  const mutationHash = event.mutation_hash || '';
  const probeId = event.probe_id || '';
  const target = event.target || '';
  return `${kind}:${round}:${mutationHash}:${probeId}:${target}`;
}

/**
 * Walk the persisted trajectory and build the resume state needed by gepa.mjs.
 *
 * @param {{ trajectoryPath: string }} opts
 * @returns {{
 *   lastRound: number,
 *   completedStepIds: Set<string>,
 *   paretoUpdates: object[],
 *   mutationsByRound: Map<number, object[]>,
 * }}
 */
export function resumeState({ trajectoryPath: tPath }) {
  const events = loadTrajectory(tPath);
  const completedStepIds = new Set();
  let lastRound = 0;
  const paretoUpdates = [];
  const mutationsByRound = new Map();

  for (const event of events) {
    const sid = stepId(event);
    completedStepIds.add(sid);

    if (typeof event.round === 'number' && event.round > lastRound) {
      lastRound = event.round;
    }

    if (event._kind === EVENT_KINDS.PARETO_UPDATE) {
      paretoUpdates.push(event);
    }

    if (event._kind === EVENT_KINDS.MUTATION && typeof event.round === 'number') {
      const r = event.round;
      if (!mutationsByRound.has(r)) mutationsByRound.set(r, []);
      mutationsByRound.get(r).push(event);
    }
  }

  return { lastRound, completedStepIds, paretoUpdates, mutationsByRound };
}
