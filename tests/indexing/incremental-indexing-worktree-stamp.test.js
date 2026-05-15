/**
 * Tests for core/incremental-indexing/infrastructure/worktree-stamp.mjs
 *
 * Plan § 8.5 / § 14.2.4 cross-worktree DB stamping.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STAMP_FILENAME,
  writeStamp,
  readStamp,
  verifyStamp,
  formatStampMismatch,
} from '../../core/incremental-indexing/infrastructure/worktree-stamp.mjs';

describe('worktree-stamp', () => {
  let stateDir;
  let projectA;
  let projectB;
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-ws-'));
    stateDir = path.join(tmp, '.sweet-search');
    projectA = path.join(tmp, 'a');
    projectB = path.join(tmp, 'b');
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => {
    try { fs.rmSync(path.dirname(stateDir), { recursive: true, force: true }); } catch {}
  });

  it('writeStamp + readStamp round-trip', () => {
    const stamp = writeStamp(stateDir, projectA);
    expect(stamp.projectRoot).toBe(path.resolve(projectA));
    const back = readStamp(stateDir);
    expect(back.projectRoot).toBe(stamp.projectRoot);
  });

  it('verifyStamp returns ok when absent', () => {
    expect(verifyStamp(stateDir, projectA).ok).toBe(true);
  });

  it('verifyStamp returns ok on a match', () => {
    writeStamp(stateDir, projectA);
    expect(verifyStamp(stateDir, projectA).ok).toBe(true);
  });

  it('verifyStamp flags a projectRoot mismatch', () => {
    writeStamp(stateDir, projectA);
    const res = verifyStamp(stateDir, projectB);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('projectRoot-mismatch');
    expect(res.expected.projectRoot).toBe(path.resolve(projectA));
    expect(res.actual.projectRoot).toBe(path.resolve(projectB));
  });

  it('formatStampMismatch produces a multi-line operator-friendly message', () => {
    writeStamp(stateDir, projectA);
    const mismatch = verifyStamp(stateDir, projectB);
    const msg = formatStampMismatch(mismatch);
    expect(msg).toContain('worktree-stamp mismatch');
    expect(msg).toContain('expected projectRoot');
    expect(msg).toContain('Remediation:');
  });
});
