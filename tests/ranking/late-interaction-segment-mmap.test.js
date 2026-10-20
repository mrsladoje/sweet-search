import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { nativeRescoreKernels } from '../../core/infrastructure/native-rescore.js';
import { resolveNativeAddon } from '../../core/infrastructure/native-resolver.js';

const hasMap = typeof nativeRescoreKernels()?.mapFileSection === 'function';
// The section bounds check is newer than older prebuilt packages; test it only
// on an addon built from this checkout's crate.
const builtHere = hasMap && String(resolveNativeAddon() || '').includes(path.join('crates', 'sweet-search-native'));

// Per-token int8 docs (the production layout) in one sealed SSLX segment.
async function writeSegment(dir, n, offset = 0) {
  const writer = new LateInteractionIndex({ indexPath: path.join(dir, 'stub.db'), loadExisting: false, tokenDim: 8, useInt8: true, quantBits: 8, modelId: 't', maxTokens: 16 });
  await writer.init();
  const docs = new Map();
  for (let d = 0; d < n; d++) {
    const numTokens = 3 + (d % 4);
    const tokens = new Int8Array(numTokens * 8).map((_, i) => ((d + offset) * 31 + i * 7) % 255 - 127);
    const f = (k) => Float32Array.from({ length: numTokens }, (_, i) => (d + offset + 1) * 0.01 + i * k);
    docs.set(`doc-${d}`, { tokens, numTokens, dim: 8, minArray: f(0.1), scaleArray: f(0.2), tokenNorms: f(0.3) });
  }
  const seg = path.join(dir, 'segment-0000.bin');
  await writer._writeSegmentFile(seg, docs);
  return { writer, seg };
}

const plain = (doc) => ({
  tokens: Array.from(doc.tokens), numTokens: doc.numTokens,
  minArray: Array.from(doc.minArray), scaleArray: Array.from(doc.scaleArray), tokenNorms: Array.from(doc.tokenNorms),
});

describe.skipIf(!hasMap)('memory-mapped SSLX segments', () => {
  let dir;
  let saved;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-li-mmap-')); saved = process.env.SWEET_SEARCH_LI_MMAP; });
  afterEach(() => {
    if (saved === undefined) delete process.env.SWEET_SEARCH_LI_MMAP; else process.env.SWEET_SEARCH_LI_MMAP = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the same docs as a heap read, with token bytes viewed in the mapped file', async () => {
    const { writer, seg } = await writeSegment(dir, 9);
    process.env.SWEET_SEARCH_LI_MMAP = '0';
    const heap = await writer.readLiveSegmentDocs(seg);
    delete process.env.SWEET_SEARCH_LI_MMAP;
    const mapped = await writer.readLiveSegmentDocs(seg);
    expect(mapped.map((d) => [d.id, plain(d.entry)])).toEqual(heap.map((d) => [d.id, plain(d.entry)]));
    // Mapped: tokens are a view over the whole file; the f32 arrays sit in a smaller slab.
    const t = mapped[0].entry.tokens;
    expect(t.buffer.byteLength).toBe(fs.statSync(seg).size);
    expect(mapped[0].entry.tokenNorms.buffer).not.toBe(t.buffer);
    expect(heap[0].entry.tokens.buffer.byteLength).toBeLessThan(fs.statSync(seg).size);
  });

  it('rewrites a segment by rename, so an existing mapping keeps the old bytes', async () => {
    const { writer, seg } = await writeSegment(dir, 4);
    const before = await writer.readLiveSegmentDocs(seg);
    const oldTokens = Array.from(before[0].entry.tokens);
    const inode = fs.statSync(seg).ino;

    const next = await writeSegment(dir, 4, 50);
    expect(fs.statSync(next.seg).ino).not.toBe(inode);
    expect(Array.from(before[0].entry.tokens)).toEqual(oldTokens);
    const after = await writer.readLiveSegmentDocs(seg);
    expect(Array.from(after[0].entry.tokens)).not.toEqual(oldTokens);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp.'))).toEqual([]);
  });
});

describe.skipIf(!builtHere)('mapFileSection bounds', () => {
  it('refuses a section past the end of the file it opened (a shorter file renamed over the path)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-map-bounds-'));
    try {
      const f = path.join(dir, 'seg.bin');
      fs.writeFileSync(f, Buffer.alloc(100, 7));
      const map = nativeRescoreKernels().mapFileSection;
      expect(map(f, 0, 100).length).toBe(100);
      expect(() => map(f, 0, 101)).toThrow(/past the end of the file/);
      expect(() => map(f, 90, 11)).toThrow(/past the end of the file/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
