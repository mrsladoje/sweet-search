/**
 * Tests for core/incremental-indexing/application/maintenance-worker.mjs
 *
 * Plan § 0 / § 13 Phase 0:
 *   - Phase 0 ships the worker scaffold + CPU-only assertion.
 *   - The rebuild queue is append-only JSONL named `rebuild-queue.jsonl`
 *     (legacy filename retained).
 *   - The dead-letter file is `rebuild-queue.dead-letter.jsonl`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertCpuOnlyEnvironment,
  enqueueMaintenanceJob,
  readMaintenanceQueue,
  appendDeadLetter,
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
});
