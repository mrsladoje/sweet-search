/**
 * Tests for core/incremental-indexing/infrastructure/artifact-temp-sweep.mjs
 *
 * The reconcile daemon stages every per-tier write to a sibling temp path
 * then atomically renames it. A SIGKILL between stage and rename orphans
 * the temp; these tests prove the startup sweep:
 *   - removes the reconcile/maintenance staging temps,
 *   - preserves every canonical artifact, queue, WAL/SHM, lock and
 *     heartbeat,
 *   - leaves the indexer cold-build full-artifact stages alone,
 *   - honours the age gate, and
 *   - recurses into `*.deltas` / `*.segments` artifact subdirs but never
 *     into a `*.tmp.segments` self-heal directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isOrphanTempName,
  isScannableArtifactSubdir,
  sweepStaleArtifactTemps,
  DEFAULT_TMP_SWEEP_MAX_AGE_MS,
} from '../../core/incremental-indexing/infrastructure/artifact-temp-sweep.mjs';

describe('artifact-temp-sweep', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-tmpsweep-'));
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  function touch(rel, content = 'x') {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }

  describe('isOrphanTempName', () => {
    it('matches reconcile/maintenance staging temps', () => {
      expect(isOrphanTempName('codebase-hnsw.usearch.tmp.12345')).toBe(true);
      expect(isOrphanTempName('codebase-hnsw.meta.json.tmp.999')).toBe(true);
      expect(isOrphanTempName('codebase-binary-hnsw.vectors.json.tmp.7')).toBe(true);
      expect(isOrphanTempName('12-3.ssgrmdelta.compacting.tmp')).toBe(true);
      expect(isOrphanTempName('seg-001.sslx.compacting.tmp')).toBe(true);
      expect(isOrphanTempName('reconcile-manifest.json.tmp')).toBe(true);
      expect(isOrphanTempName('manifest.json.tmp')).toBe(true);
      expect(isOrphanTempName('codebase-hnsw.idx.stale.bin.tmp')).toBe(true);
      expect(isOrphanTempName('codebase-late-interaction.db.selfheal.tmp')).toBe(true);
    });

    it('does NOT match canonical artifacts', () => {
      for (const name of [
        'codebase.db', 'code-graph.db', 'codebase.db-wal', 'codebase.db-shm',
        'codebase-hnsw.idx', 'codebase-hnsw.usearch', 'codebase-hnsw.meta.json',
        'codebase-hnsw.vectors.json', 'codebase-hnsw.idx.stale.bin',
        'codebase-binary-hnsw.graph.json', 'codebase-binary-hnsw.int8.json',
        'reconcile-manifest.json', 'merkle-state.json', 'manifest.json',
        '12-0.ssgrmdelta', 'seg-001.sslx',
        'rebuild-queue.jsonl', 'rebuild-queue.dead-letter.jsonl',
        'index-maintainer-queue.jsonl', 'index-maintainer-queue.processing.jsonl',
        'index-maintainer.lock', 'reconcile-metrics.jsonl', 'reconcile-pause.json',
      ]) {
        expect(isOrphanTempName(name), name).toBe(false);
      }
    });

    it('does NOT match cold-build full-artifact stages owned by the indexer', () => {
      expect(isOrphanTempName('codebase.db.tmp')).toBe(false);
      expect(isOrphanTempName('code-graph.db.tmp')).toBe(false);
      expect(isOrphanTempName('codebase-late-interaction.db.tmp')).toBe(false);
      expect(isOrphanTempName('codebase-sparse-grams.idx.tmp')).toBe(false);
    });

    it('rejects junk input', () => {
      expect(isOrphanTempName('')).toBe(false);
      expect(isOrphanTempName(null)).toBe(false);
      expect(isOrphanTempName(undefined)).toBe(false);
    });
  });

  describe('isScannableArtifactSubdir', () => {
    it('accepts canonical artifact subdirs', () => {
      expect(isScannableArtifactSubdir('codebase-sparse-grams.idx.deltas')).toBe(true);
      expect(isScannableArtifactSubdir('codebase-late-interaction.db.segments')).toBe(true);
    });
    it('rejects self-heal / non-artifact dirs', () => {
      expect(isScannableArtifactSubdir('codebase-late-interaction.db.tmp.segments')).toBe(false);
      expect(isScannableArtifactSubdir('readers')).toBe(false);
      expect(isScannableArtifactSubdir('whatever')).toBe(false);
    });
  });

  it('removes orphan temps at the top level (age gate disabled)', () => {
    const orphans = [
      'codebase-hnsw.usearch.tmp.111',
      'codebase-hnsw.meta.json.tmp.111',
      'codebase-binary-hnsw.vectors.json.tmp.222',
      'reconcile-manifest.json.tmp',
      'codebase-hnsw.idx.stale.bin.tmp',
      'codebase-late-interaction.db.selfheal.tmp',
    ];
    for (const o of orphans) touch(o);
    const summary = sweepStaleArtifactTemps(dir, { maxAgeMs: 0 });
    expect(summary.removed).toBe(orphans.length);
    for (const o of orphans) expect(fs.existsSync(path.join(dir, o))).toBe(false);
  });

  it('preserves canonical artifacts, queues, WAL/SHM, lock, dead-letter and heartbeats', () => {
    const keep = [
      'codebase.db', 'codebase.db-wal', 'codebase.db-shm',
      'code-graph.db', 'codebase-hnsw.usearch', 'codebase-hnsw.meta.json',
      'codebase-hnsw.idx.stale.bin', 'reconcile-manifest.json', 'merkle-state.json',
      'rebuild-queue.jsonl', 'rebuild-queue.dead-letter.jsonl',
      'index-maintainer-queue.jsonl', 'index-maintainer-queue.processing.jsonl',
      'index-maintainer.lock', 'reconcile-metrics.jsonl',
      // cold-build full-artifact stages — owned by the indexer, not us
      'codebase.db.tmp', 'codebase-sparse-grams.idx.tmp',
      // heartbeat lives in a non-artifact subdir
      'readers/123-boot-456.json',
    ];
    for (const k of keep) touch(k);
    const summary = sweepStaleArtifactTemps(dir, { maxAgeMs: 0 });
    expect(summary.removed).toBe(0);
    for (const k of keep) expect(fs.existsSync(path.join(dir, k)), k).toBe(true);
  });

  it('recurses into *.deltas and *.segments subdirs', () => {
    touch('codebase-sparse-grams.idx.deltas/12-3.ssgrmdelta.compacting.tmp');
    touch('codebase-sparse-grams.idx.deltas/12-0.ssgrmdelta'); // canonical — keep
    touch('codebase-late-interaction.db.segments/seg-001.sslx.compacting.tmp');
    touch('codebase-late-interaction.db.segments/manifest.json.tmp');
    touch('codebase-late-interaction.db.segments/manifest.json'); // canonical — keep
    touch('codebase-late-interaction.db.segments/seg-001.sslx.stale.bin.tmp');

    const summary = sweepStaleArtifactTemps(dir, { maxAgeMs: 0 });
    expect(summary.removed).toBe(4);
    expect(fs.existsSync(path.join(dir, 'codebase-sparse-grams.idx.deltas/12-0.ssgrmdelta'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'codebase-late-interaction.db.segments/manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'codebase-late-interaction.db.segments/seg-001.sslx.compacting.tmp'))).toBe(false);
  });

  it('does NOT recurse into a *.tmp.segments self-heal directory', () => {
    const inside = touch('codebase-late-interaction.db.tmp.segments/seg-000.sslx.compacting.tmp');
    const summary = sweepStaleArtifactTemps(dir, { maxAgeMs: 0 });
    expect(summary.removed).toBe(0);
    expect(fs.existsSync(inside)).toBe(true);
  });

  it('honours the age gate via injected now', () => {
    const orphan = touch('codebase-hnsw.usearch.tmp.333');
    const now = Date.now();
    // Fresh file, 60s grace → skipped.
    const skipped = sweepStaleArtifactTemps(dir, { maxAgeMs: 60_000, now });
    expect(skipped.removed).toBe(0);
    expect(skipped.skippedRecent).toBe(1);
    expect(fs.existsSync(orphan)).toBe(true);
    // Advance the clock past the grace → removed.
    const swept = sweepStaleArtifactTemps(dir, { maxAgeMs: 60_000, now: now + 120_000 });
    expect(swept.removed).toBe(1);
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it('reports bytesReclaimed and removedPaths', () => {
    touch('codebase-hnsw.usearch.tmp.444', 'abcdefghij'); // 10 bytes
    const summary = sweepStaleArtifactTemps(dir, { maxAgeMs: 0 });
    expect(summary.bytesReclaimed).toBe(10);
    expect(summary.removedPaths).toHaveLength(1);
    expect(summary.removedPaths[0]).toContain('codebase-hnsw.usearch.tmp.444');
  });

  it('is a no-op on a missing state dir', () => {
    const summary = sweepStaleArtifactTemps(path.join(dir, 'does-not-exist'));
    expect(summary).toMatchObject({ scanned: 0, removed: 0 });
  });

  it('exposes a sane default grace window', () => {
    expect(DEFAULT_TMP_SWEEP_MAX_AGE_MS).toBeGreaterThan(0);
  });
});
