/**
 * Maintenance queue and its drain.
 *
 * Maintenance jobs (binary HNSW replacement, LI segment recompaction and merges,
 * sparse-gram compaction, FTS5 watermark merges, vector/graph GC, PageRank) are
 * queued in `rebuild-queue.jsonl` by the reconciler's watermarks and drained
 * inline by the maintainer daemon after a tick (index-maintainer.mjs
 * drainMaintenanceInline), the single writer of the state dir. Jobs are
 * acknowledged only after their tier handler succeeds; unknown tiers stay
 * queued; repeated failures move to the dead-letter file.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';
import { fts5Merge, fts5WatermarkBudgetPages } from '../infrastructure/sqlite-fts5.mjs';
import { reclamationHandlers } from './maintenance-handlers.mjs';

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
        : ['entities_fts', 'entities_code_fts', 'entities_trigram'];
      // E.5: derive the merge page count from the budget remaining in the drain
      // window: pages scale down (floor 16) as the budget runs out, so a
      // near-exhausted drain makes a small step rather than one big overrun. An
      // explicit `payload.pages` always wins (operator override).
      const explicitPages = Number.isFinite(payload.pages) && payload.pages > 0 ? payload.pages : null;
      const pages = explicitPages ?? fts5WatermarkBudgetPages({ remainingMs: ctx.remainingBudgetMs });
      if (!fs.existsSync(dbPath)) throw new Error(`fts5 maintenance database not found: ${dbPath}`);
      const db = new Database(dbPath);
      try {
        const merged = [];
        for (const tableName of tableNames) {
          const exists = db.prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
          ).get(tableName);
          if (!exists) continue;
          fts5Merge(db, tableName, pages);
          merged.push(tableName);
        }
        if (merged.length === 0) {
          throw new Error(`fts5 maintenance found no FTS5 tables in ${dbPath}`);
        }
        return { dbPath, tableNames: merged, pages };
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
