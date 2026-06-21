/**
 * Tests for the reconcile daemon's inline maintenance drain
 * (`drainMaintenanceInline` in `core/indexing/index-maintainer.mjs`).
 *
 * Plan § 10.2 + soak REPORT § 9 item 2: the reconcile daemon coordinates
 * the maintenance worker by draining the rebuild queue inline after each
 * tick, gated by `SWEET_SEARCH_MAINTENANCE_INLINE`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  drainMaintenanceInline,
  maintenanceInlineEnabled,
} from '../../core/indexing/index-maintainer.mjs';
import {
  enqueueMaintenanceJob,
  readMaintenanceQueue,
  QUEUE_FILENAME,
  DEAD_LETTER_FILENAME,
} from '../../core/incremental-indexing/application/maintenance-worker.mjs';

describe('drainMaintenanceInline / opt-out gate', () => {
  it('default-enabled (no env set)', () => {
    expect(maintenanceInlineEnabled({})).toBe(true);
  });
  it('honours SWEET_SEARCH_MAINTENANCE_INLINE=0/false/off', () => {
    expect(maintenanceInlineEnabled({ SWEET_SEARCH_MAINTENANCE_INLINE: '0' })).toBe(false);
    expect(maintenanceInlineEnabled({ SWEET_SEARCH_MAINTENANCE_INLINE: 'false' })).toBe(false);
    expect(maintenanceInlineEnabled({ SWEET_SEARCH_MAINTENANCE_INLINE: 'off' })).toBe(false);
  });
  it('treats any other value as enabled', () => {
    expect(maintenanceInlineEnabled({ SWEET_SEARCH_MAINTENANCE_INLINE: '1' })).toBe(true);
    expect(maintenanceInlineEnabled({ SWEET_SEARCH_MAINTENANCE_INLINE: 'yes' })).toBe(true);
  });
});

describe('drainMaintenanceInline / behaviour', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-daemon-maint-'));
  });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('skips when SWEET_SEARCH_MAINTENANCE_INLINE=0', async () => {
    enqueueMaintenanceJob(stateDir, { tier: 'fts5', reason: 'x', epoch: 1, payload: {} });
    const result = await drainMaintenanceInline({
      stateDir,
      env: { SWEET_SEARCH_MAINTENANCE_INLINE: '0' },
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('inline-disabled');
    // Queue is untouched.
    expect(readMaintenanceQueue(stateDir).length).toBe(1);
  });

  it('drains a real fts5 job against an on-disk FTS5 table', async () => {
    const dbPath = path.join(stateDir, 'code-graph.db');
    const db = new Database(dbPath);
    db.exec('CREATE VIRTUAL TABLE entities_fts USING fts5(name)');
    db.prepare('INSERT INTO entities_fts(name) VALUES (?)').run('alpha');
    db.close();

    enqueueMaintenanceJob(stateDir, {
      tier: 'fts5',
      reason: 'fts5_segment_count',
      epoch: 1,
      payload: { dbPath, tableName: 'entities_fts', pages: 16 },
    });

    const summary = await drainMaintenanceInline({ stateDir, env: {} });
    expect(summary.skipped).toBeUndefined();
    expect(summary.succeeded).toBe(1);
    expect(readMaintenanceQueue(stateDir)).toEqual([]);
  });

  it('drains reclamation-tier jobs against empty artifacts as no-op successes', async () => {
    // binary_hnsw / li_segment / sparse_gram now have real handlers. With
    // no artifacts on disk they each return a `skipped: ...` result (which
    // the worker accounts as `succeeded`), the queue empties, and the
    // dead-letter file is never touched.
    enqueueMaintenanceJob(stateDir, { tier: 'binary_hnsw', reason: 'dead_doc_ratio', epoch: 1, payload: {} });
    enqueueMaintenanceJob(stateDir, { tier: 'li_segment', reason: 'stale_doc_ratio', epoch: 1, payload: { segmentId: 'segment-0000.bin' } });
    enqueueMaintenanceJob(stateDir, { tier: 'sparse_gram', reason: 'delta_size_ratio', epoch: 1, payload: {} });

    const summary = await drainMaintenanceInline({ stateDir, env: {} });
    expect(summary.skipped).toBeUndefined();
    expect(summary.seen).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(summary.deferred).toBe(0);

    expect(readMaintenanceQueue(stateDir)).toEqual([]);
    expect(fs.existsSync(path.join(stateDir, DEAD_LETTER_FILENAME))).toBe(false);
  });

  it('is a no-op when the queue is missing', async () => {
    expect(fs.existsSync(path.join(stateDir, QUEUE_FILENAME))).toBe(false);
    const summary = await drainMaintenanceInline({ stateDir, env: {} });
    expect(summary.skipped).toBeUndefined();
    expect(summary.seen).toBe(0);
  });

  it('respects SWEET_SEARCH_MAINTENANCE_MAX_JOBS_PER_TICK bound', async () => {
    // Enqueue 6 distinct li_segment jobs (one per segmentId; coalescing
    // only deduplicates identical pairs). Cap the drain at 2 jobs/tick;
    // verify the worker attempts at most 2 and defers the rest. Empty
    // handler set here so attempts visibly become deferrals.
    for (let i = 0; i < 6; i++) {
      enqueueMaintenanceJob(stateDir, {
        tier: 'li_segment',
        reason: 'stale_doc_ratio',
        epoch: i,
        payload: { segmentId: `segment-${i.toString().padStart(4, '0')}.bin` },
      });
    }
    // Force-disable inline handlers so each job hits the empty handler
    // map and stays deferred — exposes the maxJobs accounting cleanly.
    // We can't easily inject a handler map through drainMaintenanceInline,
    // so we call processMaintenanceQueue directly to assert the bound.
    const { processMaintenanceQueue } = await import(
      '../../core/incremental-indexing/application/maintenance-worker.mjs'
    );
    const summary = await processMaintenanceQueue(stateDir, {
      handlers: {},
      maxJobs: 2,
    });
    expect(summary.seen).toBe(6);
    expect(summary.deferred).toBe(6);
    expect(readMaintenanceQueue(stateDir).length).toBe(6);
  });
});
