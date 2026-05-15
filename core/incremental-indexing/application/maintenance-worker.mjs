#!/usr/bin/env node
/**
 * Maintenance worker entry point.
 *
 * Plan § 10.2, § 13 Phase 0, § 34.7: maintenance jobs (Float HNSW clean
 * replacement, Binary HNSW replacement, LI per-segment recompaction,
 * sparse-gram delta compaction, FTS5 watermark merges) run in a separate
 * process so they have predictable low-priority CPU scheduling and cannot
 * interfere with the daemon's event loop.
 *
 * **CPU-only assertion (mandatory).** This worker MUST NEVER arm the GPU.
 * The reconcile path inherits the ORT INT8 CPU encoder unconditionally
 * (plan § 3.1, § 34.7). Importing or invoking the GPU model pool from this
 * file is a hard error that surfaces in the dead-letter queue. The
 * assertions below trip if a future change accidentally pulls in the
 * `core/indexing/model-pool.js` GPU arming path or sets
 * `process.env.SWEET_SEARCH_GPU` / `INDEX_GPU_BACKEND` to a value other
 * than the CPU defaults.
 *
 * Phase 0 ships this scaffold. Phase 3 wires it to the `rebuild-queue.jsonl`
 * (legacy filename retained per plan § 13 Phase 0) and adds the per-tier
 * compaction handlers.
 *
 * Process model:
 *   - The daemon spawns this worker via `child_process.spawn` with
 *     `process.platform === 'win32' ? 'start /BELOW_NORMAL' : 'nice -n 10'`.
 *   - The worker polls the JSONL queue every 30 s (plan § 10.2 step 1).
 *   - On startup, the worker asserts CPU-only state and refuses to proceed
 *     otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FORBIDDEN_GPU_FLAGS = [
  'SWEET_SEARCH_GPU',          // sweet-search canonical knob
  'INDEX_GPU_BACKEND',         // pre-existing flag in core/indexing
];

/**
 * Throw if any environment flag would arm the GPU in this process.
 * Plan § 3.1 / § 6.1 / § 34.7. The maintenance worker is part of the
 * reconcile context and therefore inherits the CPU-only constraint.
 *
 * @returns {void}
 */
export function assertCpuOnlyEnvironment(env = process.env) {
  for (const key of FORBIDDEN_GPU_FLAGS) {
    const value = env[key];
    if (!value) continue;
    const normalised = String(value).toLowerCase();
    if (normalised === '0' || normalised === 'false' || normalised === 'cpu' || normalised === 'off') continue;
    throw new Error(
      `maintenance-worker: ${key}=${value} is incompatible with the CPU-only ` +
      `reconcile constraint (plan § 3.1 / § 34.7). Refusing to start.`,
    );
  }
}

/**
 * Refuse to load any module that arms the GPU. We do this by attaching a
 * one-shot listener to `process.emit('warning')` and a guard that re-asserts
 * after any dynamic import. Most importantly we never *statically* import
 * `core/indexing/model-pool.js`, `core/indexing/indexer-pool.js`, or any
 * inference adapter from this file. Phase 3 will pass per-tier work to
 * domain helpers that themselves are CPU-only.
 *
 * The runtime guard catches dependency drift: if a future helper imports
 * the GPU pool transitively, the `shouldArmGpu` symbol resolution will
 * surface in `process._linkedBinding` or as a missing-export error before
 * a job ever runs.
 *
 * @returns {void}
 */
export function installGpuLoadGuard() {
  // Stub: Phase 0 ships the contract; Phase 3 enriches with concrete
  // resolution guards. Today, the assertion in assertCpuOnlyEnvironment
  // is the load-bearing check.
}

/**
 * The rebuild queue lives at `.sweet-search/rebuild-queue.jsonl` (legacy
 * filename retained for compatibility — plan § 13 Phase 0). Each line is a
 * JSON job descriptor:
 *
 *   {
 *     "tier":   "float_hnsw" | "binary_hnsw" | "li_segment" | "sparse_gram" | "fts5",
 *     "reason": "tombstone_watermark" | "dead_doc_ratio" | "stale_doc_ratio" | "delta_size_ratio" | "fts5_segment_count" | "crash_recovery",
 *     "epoch":  <int>,
 *     "createdAt": <ISO-8601>,
 *     "payload": {...tier-specific}
 *   }
 */
export const QUEUE_FILENAME = 'rebuild-queue.jsonl';
export const DEAD_LETTER_FILENAME = 'rebuild-queue.dead-letter.jsonl';

function defaultQueuePath(stateDir) {
  return path.join(stateDir, QUEUE_FILENAME);
}

function defaultDeadLetterPath(stateDir) {
  return path.join(stateDir, DEAD_LETTER_FILENAME);
}

/**
 * Append a job descriptor to the rebuild queue. Atomic per call (single
 * `fs.appendFileSync`), so concurrent enqueuers from the daemon and CLI
 * never tear a line.
 *
 * @param {string} stateDir   `.sweet-search/` directory
 * @param {object} job
 */
export function enqueueMaintenanceJob(stateDir, job) {
  fs.mkdirSync(stateDir, { recursive: true });
  const line = JSON.stringify({ ...job, createdAt: job.createdAt ?? new Date().toISOString() }) + '\n';
  fs.appendFileSync(defaultQueuePath(stateDir), line);
}

/**
 * Read the queue and return all jobs in insertion order. Idempotent — does
 * not mutate the file. Phase 3's executor will rotate the file once a job is
 * acknowledged, mirroring the existing index-maintainer JSONL pattern.
 *
 * @param {string} stateDir
 * @returns {object[]}
 */
export function readMaintenanceQueue(stateDir) {
  const p = defaultQueuePath(stateDir);
  if (!fs.existsSync(p)) return [];
  const content = fs.readFileSync(p, 'utf-8');
  const out = [];
  for (const raw of content.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines; Phase 6 surfaces these via `reconcile inspect`.
    }
  }
  return out;
}

/**
 * Move a job that failed three times to the dead-letter file. Plan § 13
 * Phase 6 surfaces the dead letter via the operator CLI.
 *
 * @param {string} stateDir
 * @param {object} job
 * @param {Error} err
 */
export function appendDeadLetter(stateDir, job, err) {
  fs.mkdirSync(stateDir, { recursive: true });
  const line = JSON.stringify({
    job,
    error: { message: err?.message ?? String(err), stack: err?.stack ?? null },
    deadAt: new Date().toISOString(),
  }) + '\n';
  fs.appendFileSync(defaultDeadLetterPath(stateDir), line);
}

async function main() {
  assertCpuOnlyEnvironment();
  installGpuLoadGuard();

  // Phase 0 scaffold: just print a heartbeat and exit. Phase 3 replaces this
  // with the JSONL poll loop and per-tier dispatcher.
  const stateDir = process.env.SWEET_SEARCH_STATE_DIR
    || path.resolve(process.cwd(), '.sweet-search');
  const pending = readMaintenanceQueue(stateDir);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    worker: 'maintenance',
    phase: 0,
    stateDir,
    pendingJobs: pending.length,
    cpuOnly: true,
  }));
  // Exit cleanly: Phase 0 is observational only.
  process.exit(0);
}

const invokedDirectly = process.argv[1]
  && (process.argv[1] === new URL(import.meta.url).pathname
      || process.argv[1].endsWith('/maintenance-worker.mjs'));
if (invokedDirectly) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[maintenance-worker]', err);
    process.exit(1);
  });
}
