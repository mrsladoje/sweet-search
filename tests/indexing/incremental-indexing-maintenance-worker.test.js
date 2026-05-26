/**
 * Tests for core/incremental-indexing/application/maintenance-worker.mjs
 *
 * Plan § 0 / § 13:
 *   - The worker enforces CPU-only execution and drains maintenance jobs.
 *   - The rebuild queue is append-only JSONL named `rebuild-queue.jsonl`
 *     (legacy filename retained).
 *   - The dead-letter file is `rebuild-queue.dead-letter.jsonl`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  assertCpuOnlyEnvironment,
  enqueueMaintenanceJob,
  readMaintenanceQueue,
  appendDeadLetter,
  defaultMaintenanceHandlers,
  processMaintenanceQueue,
  jobsAreCoalescible,
  QUEUE_FILENAME,
  DEAD_LETTER_FILENAME,
} from '../../core/incremental-indexing/application/maintenance-worker.mjs';

describe('maintenance-worker / CPU-only assertion', () => {
  it('accepts an environment without GPU flags', () => {
    expect(() => assertCpuOnlyEnvironment({})).not.toThrow();
  });

  it('treats explicit-off values as CPU-only', () => {
    expect(() => assertCpuOnlyEnvironment({ SWEET_SEARCH_GPU: '0' })).not.toThrow();
    expect(() => assertCpuOnlyEnvironment({ SWEET_SEARCH_GPU: 'false' })).not.toThrow();
    expect(() => assertCpuOnlyEnvironment({ INDEX_GPU_BACKEND: 'off' })).not.toThrow();
    expect(() => assertCpuOnlyEnvironment({ INDEX_GPU_BACKEND: 'cpu' })).not.toThrow();
  });

  it('refuses to start when any GPU flag is set', () => {
    expect(() => assertCpuOnlyEnvironment({ SWEET_SEARCH_GPU: '1' }))
      .toThrow(/CPU-only/);
    expect(() => assertCpuOnlyEnvironment({ INDEX_GPU_BACKEND: 'metal' }))
      .toThrow(/CPU-only/);
  });
});

describe('maintenance-worker / queue', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-maint-'));
  });
  afterEach(() => {
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch {}
  });

  it('writes the legacy rebuild-queue.jsonl filename', () => {
    enqueueMaintenanceJob(stateDir, {
      tier: 'float_hnsw',
      reason: 'tombstone_watermark',
      epoch: 1,
      payload: {},
    });
    expect(fs.existsSync(path.join(stateDir, QUEUE_FILENAME))).toBe(true);
  });

  it('round-trips multiple jobs in insertion order', () => {
    enqueueMaintenanceJob(stateDir, { tier: 'float_hnsw', reason: 'a', epoch: 1 });
    enqueueMaintenanceJob(stateDir, { tier: 'li_segment', reason: 'b', epoch: 2 });
    enqueueMaintenanceJob(stateDir, { tier: 'fts5', reason: 'c', epoch: 3 });
    const jobs = readMaintenanceQueue(stateDir);
    expect(jobs.map((j) => j.tier)).toEqual(['float_hnsw', 'li_segment', 'fts5']);
    for (const job of jobs) {
      expect(typeof job.createdAt).toBe('string');
    }
  });

  it('returns [] when the queue file is missing', () => {
    expect(readMaintenanceQueue(stateDir)).toEqual([]);
  });

  it('appends dead-letter entries with the stack trace', () => {
    appendDeadLetter(stateDir,
      { tier: 'float_hnsw', reason: 'x', epoch: 7 },
      new Error('staging failed'),
    );
    const text = fs.readFileSync(path.join(stateDir, DEAD_LETTER_FILENAME), 'utf-8');
    const parsed = JSON.parse(text.trim());
    expect(parsed.job.tier).toBe('float_hnsw');
    expect(parsed.error.message).toBe('staging failed');
    expect(typeof parsed.deadAt).toBe('string');
  });

  it('processes successful jobs and removes them from the queue', async () => {
    const handled = [];
    enqueueMaintenanceJob(stateDir, { tier: 'float_hnsw', reason: 'a', epoch: 1 });
    enqueueMaintenanceJob(stateDir, { tier: 'li_segment', reason: 'b', epoch: 2 });

    const summary = await processMaintenanceQueue(stateDir, {
      handlers: {
        float_hnsw: async (job) => handled.push(job.tier),
        li_segment: async (job) => handled.push(job.tier),
      },
    });

    expect(handled).toEqual(['float_hnsw', 'li_segment']);
    expect(summary.succeeded).toBe(2);
    expect(readMaintenanceQueue(stateDir)).toEqual([]);
  });

  it('preserves jobs appended while the worker is acknowledging a snapshot', async () => {
    enqueueMaintenanceJob(stateDir, { tier: 'float_hnsw', reason: 'a', epoch: 1 });

    const summary = await processMaintenanceQueue(stateDir, {
      handlers: {
        float_hnsw: async () => {
          enqueueMaintenanceJob(stateDir, { tier: 'fts5', reason: 'later', epoch: 2 });
        },
      },
    });

    expect(summary.succeeded).toBe(1);
    expect(readMaintenanceQueue(stateDir).map((job) => job.tier)).toEqual(['fts5']);
  });

  it('keeps jobs with no handler pending instead of acknowledging them', async () => {
    enqueueMaintenanceJob(stateDir, { tier: 'binary_hnsw', reason: 'dead_doc_ratio', epoch: 1 });

    const summary = await processMaintenanceQueue(stateDir, { handlers: {} });

    expect(summary.deferred).toBe(1);
    expect(readMaintenanceQueue(stateDir).map((job) => job.tier)).toEqual(['binary_hnsw']);
  });

  it('retries failed jobs before dead-lettering them', async () => {
    enqueueMaintenanceJob(stateDir, { tier: 'sparse_gram', reason: 'delta_size_ratio', epoch: 1 });

    const first = await processMaintenanceQueue(stateDir, {
      maxAttempts: 2,
      handlers: { sparse_gram: async () => { throw new Error('compaction failed'); } },
    });
    expect(first.retried).toBe(1);
    expect(readMaintenanceQueue(stateDir)[0].attempts).toBe(1);

    const second = await processMaintenanceQueue(stateDir, {
      maxAttempts: 2,
      handlers: { sparse_gram: async () => { throw new Error('compaction failed again'); } },
    });
    expect(second.deadLettered).toBe(1);
    expect(readMaintenanceQueue(stateDir)).toEqual([]);
    const text = fs.readFileSync(path.join(stateDir, DEAD_LETTER_FILENAME), 'utf-8');
    expect(JSON.parse(text.trim()).job.tier).toBe('sparse_gram');
  });

  it('propagates lifecycle aborts instead of retrying or dead-lettering them', async () => {
    enqueueMaintenanceJob(stateDir, { tier: 'sparse_gram', reason: 'delta_size_ratio', epoch: 1 });
    const err = new Error('lock ownership lost');
    err.name = 'MaintainerLifecycleAbort';

    await expect(processMaintenanceQueue(stateDir, {
      handlers: { sparse_gram: async () => { throw err; } },
    })).rejects.toThrow('lock ownership lost');

    expect(readMaintenanceQueue(stateDir).map((job) => job.tier)).toEqual(['sparse_gram']);
    expect(fs.existsSync(path.join(stateDir, DEAD_LETTER_FILENAME))).toBe(false);
  });

  it('moves malformed queue lines to dead-letter and keeps valid jobs', async () => {
    fs.writeFileSync(path.join(stateDir, QUEUE_FILENAME),
      'not-json\n' + JSON.stringify({ tier: 'li_segment', reason: 'ok', epoch: 1 }) + '\n');

    const summary = await processMaintenanceQueue(stateDir, { handlers: {} });

    expect(summary.malformed).toBe(1);
    expect(summary.deferred).toBe(1);
    expect(readMaintenanceQueue(stateDir).map((job) => job.tier)).toEqual(['li_segment']);
    const dead = JSON.parse(fs.readFileSync(path.join(stateDir, DEAD_LETTER_FILENAME), 'utf-8').trim());
    expect(dead.job.tier).toBe('malformed');
  });

  it('executes built-in fts5 maintenance against a real SQLite FTS5 table', async () => {
    const dbPath = path.join(stateDir, 'code-graph.db');
    const db = new Database(dbPath);
    db.exec('CREATE VIRTUAL TABLE entities_fts USING fts5(name)');
    db.prepare('INSERT INTO entities_fts(name) VALUES (?)').run('Widget');
    db.close();
    enqueueMaintenanceJob(stateDir, {
      tier: 'fts5',
      reason: 'fts5_segment_count',
      epoch: 1,
      payload: { dbPath, tableName: 'entities_fts', pages: 16 },
    });

    const summary = await processMaintenanceQueue(stateDir, {
      handlers: defaultMaintenanceHandlers(stateDir),
    });

    expect(summary.succeeded).toBe(1);
    expect(readMaintenanceQueue(stateDir)).toEqual([]);
  });

  it('coalesces identical pending jobs at enqueue time', () => {
    const r1 = enqueueMaintenanceJob(stateDir, { tier: 'sparse_gram', reason: 'delta_size_ratio', epoch: 1, payload: {} });
    expect(r1.enqueued).toBe(true);
    const r2 = enqueueMaintenanceJob(stateDir, { tier: 'sparse_gram', reason: 'delta_size_ratio', epoch: 2, payload: {} });
    expect(r2.enqueued).toBe(false);
    expect(r2.coalescedWith).toMatchObject({ tier: 'sparse_gram', reason: 'delta_size_ratio' });
    expect(readMaintenanceQueue(stateDir).length).toBe(1);
  });

  it('coalesces li_segment jobs only when payload.segmentId matches', () => {
    enqueueMaintenanceJob(stateDir, { tier: 'li_segment', reason: 'stale_doc_ratio', epoch: 1, payload: { segmentId: 'segment-0000.bin' } });
    const dup = enqueueMaintenanceJob(stateDir, { tier: 'li_segment', reason: 'stale_doc_ratio', epoch: 2, payload: { segmentId: 'segment-0000.bin' } });
    const diff = enqueueMaintenanceJob(stateDir, { tier: 'li_segment', reason: 'stale_doc_ratio', epoch: 2, payload: { segmentId: 'segment-0001.bin' } });
    expect(dup.enqueued).toBe(false);
    expect(diff.enqueued).toBe(true);
    expect(readMaintenanceQueue(stateDir).map((j) => j.payload.segmentId).sort()).toEqual(['segment-0000.bin', 'segment-0001.bin']);
  });

  it('does NOT coalesce a retried job (preserves attempts/dead-letter accounting)', () => {
    // Manually write a job that has already been retried once. A fresh
    // enqueue of the "same" tier must NOT coalesce against it — coalescing
    // would erase the attempt count and let the job loop forever.
    fs.writeFileSync(
      path.join(stateDir, QUEUE_FILENAME),
      JSON.stringify({ tier: 'sparse_gram', reason: 'delta_size_ratio', epoch: 1, attempts: 1, lastError: 'boom' }) + '\n',
    );
    const result = enqueueMaintenanceJob(stateDir, { tier: 'sparse_gram', reason: 'delta_size_ratio', epoch: 2 });
    expect(result.enqueued).toBe(true);
    expect(readMaintenanceQueue(stateDir).length).toBe(2);
  });

  it('can be force-appended with coalesce:false', () => {
    enqueueMaintenanceJob(stateDir, { tier: 'fts5', reason: 'fts5_segment_count', epoch: 1 });
    enqueueMaintenanceJob(stateDir, { tier: 'fts5', reason: 'fts5_segment_count', epoch: 2 }, { coalesce: false });
    expect(readMaintenanceQueue(stateDir).length).toBe(2);
  });

  it('merges both graph FTS5 tables for a default fts5 maintenance job', async () => {
    const dbPath = path.join(stateDir, 'code-graph.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE VIRTUAL TABLE entities_fts USING fts5(name);
      CREATE VIRTUAL TABLE entities_trigram USING fts5(name, tokenize='trigram');
    `);
    db.prepare('INSERT INTO entities_fts(name) VALUES (?)').run('Widget');
    db.prepare('INSERT INTO entities_trigram(name) VALUES (?)').run('Widget');
    db.close();

    const result = await defaultMaintenanceHandlers(stateDir).fts5({
      tier: 'fts5',
      reason: 'fts5_segment_count',
      epoch: 1,
      payload: { dbPath, pages: 16 },
    });

    expect(result.tableNames.sort()).toEqual(['entities_fts', 'entities_trigram']);
  });
});

describe('maintenance-worker / adaptive drain', () => {
  let stateDir;
  beforeEach(() => { stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-maint-drain-')); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  function enqueueN(n, tier = 'fts5') {
    for (let i = 0; i < n; i += 1) {
      // Distinct reasons so coalescing does not collapse them.
      enqueueMaintenanceJob(stateDir, { tier, reason: `r${i}`, epoch: i }, { coalesce: false });
    }
  }

  it('drains the whole backlog when only a generous budget is set (no fixed cap)', async () => {
    enqueueN(40);
    let handled = 0;
    const summary = await processMaintenanceQueue(stateDir, {
      handlers: { fts5: async () => { handled += 1; } },
      budgetMs: 10_000,
    });
    expect(handled).toBe(40);
    expect(summary.succeeded).toBe(40);
    expect(readMaintenanceQueue(stateDir)).toEqual([]);
  });

  it('stops at the time budget and defers the rest (always runs >= 1 job)', async () => {
    enqueueN(20);
    let handled = 0;
    let virtualNow = 1000;
    const summary = await processMaintenanceQueue(stateDir, {
      handlers: { fts5: async () => { handled += 1; virtualNow += 100; } },
      budgetMs: 250, // room for ~3 jobs after the first free one
      now: () => virtualNow,
    });
    // First job is always attempted; budget gates the rest.
    expect(handled).toBeGreaterThanOrEqual(1);
    expect(handled).toBeLessThan(20);
    expect(summary.deferred).toBe(20 - handled);
    expect(readMaintenanceQueue(stateDir).length).toBe(20 - handled);
  });

  it('honors an explicit maxJobs hard cap even with budget headroom', async () => {
    enqueueN(20);
    let handled = 0;
    const summary = await processMaintenanceQueue(stateDir, {
      handlers: { fts5: async () => { handled += 1; } },
      maxJobs: 5,
      budgetMs: 10_000,
    });
    expect(handled).toBe(5);
    expect(summary.deferred).toBe(15);
  });

  it('still retries/dead-letters failures under a budget drain', async () => {
    enqueueMaintenanceJob(stateDir, { tier: 'fts5', reason: 'boom', epoch: 1 }, { coalesce: false });
    const failing = { fts5: async () => { throw new Error('boom'); } };
    let s = await processMaintenanceQueue(stateDir, { handlers: failing, budgetMs: 5000, maxAttempts: 2 });
    expect(s.retried).toBe(1);
    s = await processMaintenanceQueue(stateDir, { handlers: failing, budgetMs: 5000, maxAttempts: 2 });
    expect(s.deadLettered).toBe(1);
    expect(readMaintenanceQueue(stateDir)).toEqual([]);
  });
});
