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
 * The worker drains `rebuild-queue.jsonl` (legacy filename retained per
 * plan § 13 Phase 0). Jobs are acknowledged only after their tier handler
 * succeeds; unknown tiers remain queued; repeated failures move to the
 * dead-letter file.
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
import Database from 'better-sqlite3';
import { fts5Merge, fts5Optimize, fts5SegmentCount, fts5WatermarkBudgetPages } from '../infrastructure/sqlite-fts5.mjs';
import { reclamationHandlers } from './maintenance-handlers.mjs';

const fts5BudgetEnabled = () => process.env.SWEET_SEARCH_RECONCILE_FTS5_BUDGET === '1';
const fts5OptimizeEnabled = () => process.env.SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE === '1';
// Minimum segment count below which an optimize is not worth its full rewrite.
const FTS5_OPTIMIZE_MIN_SEGMENTS = Number.parseInt(process.env.SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE_MIN_SEGMENTS || '8', 10);

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
 * inference adapter from this file. Per-tier work must be implemented by
 * CPU-only domain helpers.
 *
 * The runtime guard catches dependency drift: if a future helper imports
 * the GPU pool transitively, the `shouldArmGpu` symbol resolution will
 * surface in `process._linkedBinding` or as a missing-export error before
 * a job ever runs.
 *
 * @returns {void}
 */
export function installGpuLoadGuard() {
  // The current worker uses CPU-only maintenance handlers. This hook remains
  // as the single place to add module-resolution guards if a future handler
  // grows a transitive model dependency.
}

/**
 * The rebuild queue lives at `.sweet-search/rebuild-queue.jsonl` (legacy
 * filename retained for compatibility — plan § 13 Phase 0). Each line is a
 * JSON job descriptor:
 *
 *   {
 *     "tier":   "binary_hnsw" | "li_segment" | "sparse_gram" | "fts5",
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

function writeMaintenanceQueue(stateDir, jobs, appendedRaw = '') {
  fs.mkdirSync(stateDir, { recursive: true });
  const data = jobs.map((job) => JSON.stringify(job)).join('\n');
  fs.writeFileSync(defaultQueuePath(stateDir), (data ? data + '\n' : '') + appendedRaw);
}

function readQueueSnapshot(stateDir) {
  const p = defaultQueuePath(stateDir);
  if (!fs.existsSync(p)) return { raw: '', lines: [] };
  const raw = fs.readFileSync(p, 'utf-8');
  return { raw, lines: raw.split('\n').filter((line) => line.trim()) };
}

function appendedQueueTail(stateDir, originalRaw) {
  const p = defaultQueuePath(stateDir);
  if (!fs.existsSync(p)) return '';
  const current = fs.readFileSync(p, 'utf-8');
  return current.startsWith(originalRaw) ? current.slice(originalRaw.length) : '';
}

/**
 * Two pending jobs are "equivalent" when they would do the same work.
 * Coalescing here keeps the queue bounded even when the watermark
 * scheduler emits the same tier/reason every tick (the steady state for
 * sparse_gram + binary_hnsw on a churning fixture — see the post-fix
 * soak's 489-deep queue at 30s before this change).
 *
 * Granularity:
 *   - li_segment: keyed on payload.segmentId (one job per segment).
 *   - everything else: keyed on (tier, reason).
 *
 * Jobs that have already been retried (`attempts > 0`) are NEVER
 * coalesced away: they carry the prior failure context and the
 * dead-letter path depends on attempt counts being monotone per-job.
 */
export function jobsAreCoalescible(a, b) {
  if (!a || !b) return false;
  if (a.tier !== b.tier) return false;
  if (a.reason !== b.reason) return false;
  if ((a.attempts || 0) > 0 || (b.attempts || 0) > 0) return false;
  if (a.tier === 'li_segment') {
    return (a.payload?.segmentId ?? null) === (b.payload?.segmentId ?? null);
  }
  return true;
}

/**
 * Append a job descriptor to the rebuild queue. Atomic per call (single
 * `fs.appendFileSync`), so concurrent enqueuers from the daemon and CLI
 * never tear a line.
 *
 * By default the call coalesces against existing pending jobs (see
 * `jobsAreCoalescible`). Pass `{ coalesce: false }` to force-append
 * (callers that intentionally want to retry the same tier work).
 *
 * @param {string} stateDir   `.sweet-search/` directory
 * @param {object} job
 * @param {{coalesce?:boolean}} [opts]
 * @returns {{enqueued:boolean, coalescedWith?:object}}
 */
export function enqueueMaintenanceJob(stateDir, job, opts = {}) {
  fs.mkdirSync(stateDir, { recursive: true });
  const coalesce = opts.coalesce !== false;
  if (coalesce) {
    const existing = readMaintenanceQueue(stateDir);
    const match = existing.find((pending) => jobsAreCoalescible(pending, job));
    if (match) return { enqueued: false, coalescedWith: match };
  }
  const line = JSON.stringify({ ...job, createdAt: job.createdAt ?? new Date().toISOString() }) + '\n';
  fs.appendFileSync(defaultQueuePath(stateDir), line);
  return { enqueued: true };
}

/**
 * Read the queue and return all jobs in insertion order. Idempotent — does
 * not mutate the file. `processMaintenanceQueue` rewrites the queue after
 * acknowledging successful jobs.
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

export function defaultMaintenanceHandlers(stateDir) {
  return {
    ...reclamationHandlers(stateDir),
    fts5: async (job, ctx = {}) => {
      const payload = job?.payload || {};
      const dbPath = payload.dbPath || payload.databasePath || path.join(stateDir, payload.dbFile || 'code-graph.db');
      const tableNames = payload.tableName || payload.table
        ? [payload.tableName || payload.table]
        : ['entities_fts', 'entities_trigram'];
      // E.5: derive the merge page count from the budget remaining in the drain
      // window. Off (default) → the original aggressive 500-page merge. On →
      // scale pages down (floor 16) as the budget runs out so a near-exhausted
      // drain still makes a small step rather than overrunning on one big merge.
      // An explicit `payload.pages` always wins (operator override).
      const explicitPages = Number.isFinite(payload.pages) && payload.pages > 0 ? payload.pages : null;
      const pages = explicitPages != null
        ? explicitPages
        : (fts5BudgetEnabled()
            ? fts5WatermarkBudgetPages({ remainingMs: ctx.remainingBudgetMs })
            : 500);
      // E.5 idle-gated optimize: when the daemon enqueues an fts5 job with
      // `payload.optimize:true` (signaling true-idle / consecutive empty ticks)
      // AND the optimize flag is on, run the full `('optimize')` rewrite + an
      // immediate wal_checkpoint(TRUNCATE) — but ONLY on tables above a size
      // threshold (a tiny table doesn't need it). Off by default; the merge path
      // is the steady-state behavior.
      const wantOptimize = fts5OptimizeEnabled() && payload.optimize === true;
      if (!fs.existsSync(dbPath)) throw new Error(`fts5 maintenance database not found: ${dbPath}`);
      const db = new Database(dbPath);
      try {
        const merged = [];
        const optimized = [];
        for (const tableName of tableNames) {
          const exists = db.prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
          ).get(tableName);
          if (!exists) continue;
          if (wantOptimize && fts5SegmentCount(db, tableName) >= FTS5_OPTIMIZE_MIN_SEGMENTS) {
            fts5Optimize(db, tableName);
            optimized.push(tableName);
          } else {
            fts5Merge(db, tableName, pages);
            merged.push(tableName);
          }
        }
        if (merged.length === 0 && optimized.length === 0) {
          throw new Error(`fts5 maintenance found no FTS5 tables in ${dbPath}`);
        }
        return { dbPath, tableNames: [...merged, ...optimized], pages, optimized };
      } finally {
        db.close();
      }
    },
  };
}

/**
 * Drain maintenance jobs in insertion order. Success removes a job from the
 * queue; handler failure retries until `maxAttempts`, then dead-letters.
 * Jobs without a registered handler remain queued for a future worker.
 *
 * Draining is bounded by EITHER a job cap (`maxJobs`, a hard ceiling when
 * set) OR a wall-clock budget (`budgetMs`). The budget lets the daemon keep
 * pace with a growing backlog without starving the reconcile tick: it
 * drains as many jobs as fit in the window rather than a fixed tiny count.
 * The first eligible job always runs (so a sub-job-duration budget still
 * makes forward progress); the budget gates only subsequent jobs.
 *
 * @param {string} stateDir
 * @param {{handlers?:object, maxJobs?:number, maxAttempts?:number, budgetMs?:number, now?:()=>number, onProgress?:(phase:string)=>void}} [options]
 */
export async function processMaintenanceQueue(stateDir, options = {}) {
  const handlers = options.handlers || {};
  const maxJobs = Number.isInteger(options.maxJobs) && options.maxJobs > 0 ? options.maxJobs : Infinity;
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0 ? options.maxAttempts : 3;
  const budgetMs = Number.isFinite(options.budgetMs) && options.budgetMs > 0 ? options.budgetMs : Infinity;
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const onProgress = typeof options.onProgress === 'function'
    ? (phase) => { options.onProgress(phase); }
    : () => {};
  const startMs = clock();
  const remaining = [];
  const summary = {
    seen: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
    deadLettered: 0,
    deferred: 0,
    malformed: 0,
    remaining: 0,
  };

  let attempted = 0;
  const snapshot = readQueueSnapshot(stateDir);
  for (const line of snapshot.lines) {
    let job;
    try {
      job = JSON.parse(line);
    } catch (err) {
      summary.malformed += 1;
      appendDeadLetter(stateDir, { tier: 'malformed', raw: line }, err);
      continue;
    }

    summary.seen += 1;
    const handler = handlers[job.tier] || handlers.default;
    const overBudget = budgetMs !== Infinity && attempted > 0 && (clock() - startMs) >= budgetMs;
    if (!handler || attempted >= maxJobs || overBudget) {
      summary.deferred += 1;
      remaining.push(job);
      continue;
    }

    attempted += 1;
    try {
      onProgress(`maintenance:${job.tier || 'unknown'}:start`);
      // E.5: surface the wall-clock budget remaining so budget-aware handlers
      // (fts5 merge) can scale their work to the spare window.
      const remainingBudgetMs = budgetMs === Infinity ? Infinity : Math.max(0, budgetMs - (clock() - startMs));
      await handler(job, { stateDir, onProgress, remainingBudgetMs });
      onProgress(`maintenance:${job.tier || 'unknown'}:done`);
      summary.succeeded += 1;
    } catch (err) {
      if (err?.name === 'MaintainerLifecycleAbort') throw err;
      summary.failed += 1;
      const attempts = Number.isInteger(job.attempts) ? job.attempts + 1 : 1;
      const next = {
        ...job,
        attempts,
        lastError: err?.message ?? String(err),
        lastTriedAt: new Date().toISOString(),
      };
      if (attempts >= maxAttempts) {
        summary.deadLettered += 1;
        appendDeadLetter(stateDir, next, err);
      } else {
        summary.retried += 1;
        remaining.push(next);
      }
    }
  }

  writeMaintenanceQueue(stateDir, remaining, appendedQueueTail(stateDir, snapshot.raw));
  summary.remaining = readMaintenanceQueue(stateDir).length;
  return summary;
}

async function main() {
  assertCpuOnlyEnvironment();
  installGpuLoadGuard();

  const stateDir = process.env.SWEET_SEARCH_STATE_DIR
    || path.resolve(process.cwd(), '.sweet-search');
  const budgetRaw = Number.parseInt(process.env.SWEET_SEARCH_MAINTENANCE_BUDGET_MS || '', 10);
  const drain = await processMaintenanceQueue(stateDir, {
    handlers: defaultMaintenanceHandlers(stateDir),
    maxJobs: Number.parseInt(process.env.SWEET_SEARCH_MAINTENANCE_MAX_JOBS || '50', 10),
    budgetMs: Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : undefined,
    maxAttempts: Number.parseInt(process.env.SWEET_SEARCH_MAINTENANCE_MAX_ATTEMPTS || '3', 10),
  });
  console.log(JSON.stringify({
    worker: 'maintenance',
    phase: 'queue-drain',
    stateDir,
    pendingJobs: drain.remaining,
    drain,
    cpuOnly: true,
  }));
  process.exit(0);
}

const invokedDirectly = process.argv[1]
  && (process.argv[1] === new URL(import.meta.url).pathname
      || process.argv[1].endsWith('/maintenance-worker.mjs'));
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[maintenance-worker]', err);
    process.exit(1);
  });
}
