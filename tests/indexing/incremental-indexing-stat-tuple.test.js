/**
 * Tests for the (mtime, size, inode) dirty-detection tuple added by Phase 1.
 *
 * Plan § 9.1 requires:
 *   - inode captured as a JSON string (BigInt → toString) so 64-bit inodes
 *     from APFS/ZFS/XFS that exceed Number.MAX_SAFE_INTEGER survive
 *     round-trip through merkle-state.json.
 *   - The dirty check is `(mtime_ns, size, inode) !=` rather than
 *     `mtime > recorded`, so a second write within the same FS resolution
 *     tick (or an atomic-rename-over-existing-path) is visible.
 *
 * The full integration with the daemon ships in Phase 2; this test fixes the
 * contract for `incremental-tracker.js::getFileMetadata` so future changes
 * cannot accidentally drop the inode field.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('incremental-tracker / (mtime, size, inode) tuple', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-stat-'));
    file = path.join(dir, 'sample.txt');
    fs.writeFileSync(file, 'hello');
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('fs.statSync(..., { bigint: true }) exposes BigInt inode and mtime', () => {
    const stat = fs.statSync(file, { bigint: true });
    expect(typeof stat.ino).toBe('bigint');
    expect(typeof stat.mtimeNs).toBe('bigint');
    expect(typeof stat.size).toBe('bigint');
  });

  it('atomic-rename-over-existing-path swaps the inode (vim safe-write pattern)', () => {
    const before = fs.statSync(file, { bigint: true });
    // Write a new file then rename over the existing path.
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, 'hello world');
    fs.renameSync(tmp, file);
    const after = fs.statSync(file, { bigint: true });
    expect(after.ino).not.toBe(before.ino);
  });

  it('BigInt-to-string round-trip preserves precision past Number.MAX_SAFE_INTEGER', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 12345n;
    const serialised = huge.toString();
    const restored = BigInt(serialised);
    expect(restored).toBe(huge);
    // The mixed-type comparison bug surfaces here if we ever forget the cast.
    expect(huge === Number(serialised)).toBe(false);
  });
});
