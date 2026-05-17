import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MerkleTracker } from '../../core/indexing/merkle-tracker.js';
import { contentHashSync } from '../../core/incremental-indexing/infrastructure/hashing.mjs';

describe('MerkleTracker byte hashing', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-merkle-tracker-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('hashes file bytes instead of decoded UTF-8 strings', async () => {
    const bytes = Buffer.from([0xff, 0x61, 0x00, 0x62]);
    const filePath = path.join(tempDir, 'bytes.bin');
    fs.writeFileSync(filePath, bytes);

    expect(await MerkleTracker.computeFileHash(filePath)).toBe(contentHashSync(bytes));
  });

  it('uses byte hashes when updating and comparing tracked files', async () => {
    const bytes = Buffer.from([0xff, 0x61, 0x00, 0x62]);
    const filePath = path.join(tempDir, 'bytes.bin');
    fs.writeFileSync(filePath, bytes);

    const tracker = new MerkleTracker(path.join(tempDir, 'state.json'));
    await tracker.updateFile(filePath);

    expect(tracker.state.files[filePath]).toMatchObject({
      contentHash: contentHashSync(bytes),
      size: bytes.length,
    });
    expect(await tracker.findChangedFiles([filePath])).toEqual([]);

    const changedBytes = Buffer.from([0xff, 0x61, 0x00, 0x63]);
    fs.writeFileSync(filePath, changedBytes);

    expect(await tracker.findChangedFiles([filePath])).toEqual([filePath]);
  });

  it('saves state through the temp+rename path without leaving a temp file', async () => {
    const statePath = path.join(tempDir, 'nested', 'state.json');
    const tracker = new MerkleTracker(statePath);
    tracker.state.files['src/a.js'] = {
      contentHash: 'abc',
      lastIndexed: '2026-05-16T00:00:00.000Z',
      chunkIds: ['c1'],
      chunkCount: 1,
      size: 10,
    };
    tracker._recalculateStats();

    await tracker.save();

    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.existsSync(`${statePath}.tmp`)).toBe(false);
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(parsed.files['src/a.js'].contentHash).toBe('abc');
    expect(parsed.stats.totalFiles).toBe(1);
  });
});
