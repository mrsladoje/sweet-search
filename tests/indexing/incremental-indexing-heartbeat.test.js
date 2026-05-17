/**
 * Tests for core/incremental-indexing/infrastructure/reader-heartbeat.mjs
 *
 * Plan § 8.1.1: heartbeat lifecycle and minLiveEpoch computation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  beginRead,
  endRead,
  liveReaders,
  minLiveEpoch,
  isReaderAlive,
} from '../../core/incremental-indexing/infrastructure/reader-heartbeat.mjs';

describe('reader-heartbeat', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-heartbeat-'));
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('creates the readers/ directory on first heartbeat', () => {
    beginRead(dir, 7);
    expect(fs.existsSync(path.join(dir, 'readers'))).toBe(true);
  });

  it('writes a distinct file per concurrent read in the same process', () => {
    const first = beginRead(dir, 1);
    const second = beginRead(dir, 2);
    const files = fs.readdirSync(path.join(dir, 'readers'));
    expect(files.length).toBe(2);
    expect(first.path).not.toBe(second.path);
    expect(minLiveEpoch(dir)).toBe(1);
    endRead(dir, first);
    expect(minLiveEpoch(dir)).toBe(2);
    endRead(dir, second);
    expect(minLiveEpoch(dir)).toBeNull();
  });

  it('endRead unlinks the heartbeat', () => {
    const rec = beginRead(dir, 4);
    endRead(dir, rec);
    expect(fs.existsSync(rec.path)).toBe(false);
  });

  it('liveReaders sorts by epoch', () => {
    // Synthesize two heartbeat files for current pid by writing manually
    // (we can't fork the test runner). The second file simulates a higher epoch.
    beginRead(dir, 5);
    const dir2 = path.join(dir, 'readers');
    const synth = path.join(dir2, `${process.pid}-other.json`);
    fs.writeFileSync(synth, JSON.stringify({
      epoch: 9, pid: process.pid, bootId: 'other', startedAt: new Date().toISOString(),
    }));
    const live = liveReaders(dir);
    // The "other" bootId fails the boot-id check so only the real reader survives.
    expect(live.length).toBe(1);
    expect(live[0].epoch).toBe(5);
  });

  it('minLiveEpoch returns null when nothing is alive', () => {
    expect(minLiveEpoch(dir)).toBeNull();
    const rec = beginRead(dir, 3);
    expect(minLiveEpoch(dir)).toBe(3);
    endRead(dir, rec);
    expect(minLiveEpoch(dir)).toBeNull();
  });

  it('isReaderAlive rejects bogus pids and mismatched boot ids', () => {
    expect(isReaderAlive(0, 'x')).toBe(false);
    expect(isReaderAlive(-1, 'x')).toBe(false);
    expect(isReaderAlive(process.pid, 'wrong-boot')).toBe(false);
  });
});
