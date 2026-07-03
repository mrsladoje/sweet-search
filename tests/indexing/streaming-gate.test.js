/**
 * Streaming-vectors gate (shouldStreamVectors).
 *
 * The gate used to be file-count-only, but peak heap on the in-memory path
 * scales with source bytes, not file count — a repo with few-but-huge files
 * (amalgamations, vendored/generated blobs) can OOM the default heap while
 * staying under the 5000-file gate. The 512 MB byte default is calibrated so
 * the trigger only fires where in-memory would crash outright (libsql:
 * 596 MB admitted, needed 9.6+ GB heap) — see the shouldStreamVectors
 * doc comment for the measured-vs-estimated split. These tests pin the byte
 * trigger, the count trigger's priority (no stats when it fires), the
 * explicit-0 disable knob, and the conditions under which the gate must
 * stay closed (dry-run, incremental, kill switch).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { shouldStreamVectors, sumFileSizesUpTo } from '../../core/indexing/indexer-utils.js';

let TMP;
let files; // 10 files x 1 MB each = 10 MB total

beforeAll(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'ss-stream-gate-'));
  files = [];
  const oneMB = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 10; i++) {
    const rel = `big-${i}.js`;
    writeFileSync(path.join(TMP, rel), oneMB);
    files.push(rel);
  }
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const base = { dryRun: false, fullReindex: true };

describe('shouldStreamVectors', () => {
  it('fires on total bytes even when far under the file-count threshold', async () => {
    const d = await shouldStreamVectors({
      ...base,
      filesToIndex: files,
      projectRoot: TMP,
      env: { SWEET_SEARCH_STREAM_MIN_BYTES: String(5 * 1024 * 1024) }, // 5 MB < 10 MB on disk
    });
    expect(d.useStreaming).toBe(true);
    expect(d.reason).toBe('bytes');
    expect(d.totalBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });

  it('stays closed when bytes and count are both under threshold', async () => {
    const d = await shouldStreamVectors({
      ...base,
      filesToIndex: files,
      projectRoot: TMP,
      env: {}, // defaults: 5000 files / 128 MB, repo is 10 files / 10 MB
    });
    expect(d.useStreaming).toBe(false);
  });

  it('fires on file count without enumerating (or stat-ing) the file list', async () => {
    // A pseudo-array whose ITERATION throws: if the gate reaches the byte
    // check (which iterates to stat), the test fails loudly. Only `length`
    // may be touched when the count trigger fires.
    const trap = {
      length: 6000,
      [Symbol.iterator]() {
        throw new Error('gate must not enumerate files when the count trigger fires');
      },
    };
    const d = await shouldStreamVectors({
      ...base,
      filesToIndex: trap,
      projectRoot: TMP,
      env: {},
    });
    expect(d.useStreaming).toBe(true);
    expect(d.reason).toBe('files');
  });

  it('treats SWEET_SEARCH_STREAM_MIN_BYTES=0 as byte-trigger-disabled (count trigger stays live)', async () => {
    // 10 MB on disk, threshold "0": byte trigger must NOT fall back to the
    // default and must NOT fire at >= 0 semantics.
    const closed = await shouldStreamVectors({
      ...base,
      filesToIndex: files,
      projectRoot: TMP,
      env: { SWEET_SEARCH_STREAM_MIN_BYTES: '0' },
    });
    expect(closed.useStreaming).toBe(false);
    // ...while the count trigger is unaffected by the disable.
    const byCount = await shouldStreamVectors({
      ...base,
      filesToIndex: files,
      projectRoot: TMP,
      env: { SWEET_SEARCH_STREAM_MIN_BYTES: '0', SWEET_SEARCH_STREAM_MIN_FILES: '10' },
    });
    expect(byCount.useStreaming).toBe(true);
    expect(byCount.reason).toBe('files');
  });

  it('falls back to the 512 MB default when MIN_BYTES is empty or garbage', async () => {
    for (const bad of ['', 'not-a-number']) {
      const d = await shouldStreamVectors({
        ...base,
        filesToIndex: files, // 10 MB on disk — far under 512 MB
        projectRoot: TMP,
        env: { SWEET_SEARCH_STREAM_MIN_BYTES: bad },
      });
      expect(d.useStreaming).toBe(false);
    }
  });

  it('never fires for dry-run or incremental runs', async () => {
    const env = { SWEET_SEARCH_STREAM_MIN_BYTES: '1' };
    for (const overrides of [{ dryRun: true, fullReindex: true }, { dryRun: false, fullReindex: false }]) {
      const d = await shouldStreamVectors({ ...overrides, filesToIndex: files, projectRoot: TMP, env });
      expect(d.useStreaming).toBe(false);
    }
  });

  it('honours the SWEET_SEARCH_STREAM_VECTORS=0 kill switch over both triggers', async () => {
    const d = await shouldStreamVectors({
      ...base,
      filesToIndex: files,
      projectRoot: TMP,
      env: { SWEET_SEARCH_STREAM_VECTORS: '0', SWEET_SEARCH_STREAM_MIN_BYTES: '1', SWEET_SEARCH_STREAM_MIN_FILES: '1' },
    });
    expect(d.useStreaming).toBe(false);
  });
});

describe('sumFileSizesUpTo', () => {
  it('early-exits once the running total crosses the stop threshold', async () => {
    const total = await sumFileSizesUpTo(files, 2 * 1024 * 1024 + 1, TMP);
    // Stops after the third stat (3 MB >= 2 MB + 1), never sums all 10 MB.
    expect(total).toBe(3 * 1024 * 1024);
  });

  it('skips files that disappeared between discovery and the gate', async () => {
    const total = await sumFileSizesUpTo(['big-0.js', 'vanished.js', 'big-1.js'], Infinity, TMP);
    expect(total).toBe(2 * 1024 * 1024);
  });
});
