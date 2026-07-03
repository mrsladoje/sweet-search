/**
 * E.1-LI tick-scoped reader cache (production-li-delta.mjs).
 *
 * Hermetic: the encoder is injected (deterministic fake tokens), so no model
 * loads. Verifies (1) cache seeding/reuse semantics, (2) tombstones of
 * pre-cache docs resolve through the cached reader, and (3) a cached run
 * leaves byte-identical on-disk state to fresh-per-call runs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyLateInteractionDelta } from '../../core/incremental-indexing/application/production-li-delta.mjs';

function fakeEncoder(texts) {
  return texts.map((text, i) => {
    const tokens = [];
    for (let k = 0; k < 3; k += 1) {
      const v = new Float32Array(128);
      for (let d = 0; d < 128; d += 1) {
        // Deterministic in (text, token, dim) so identical op sequences
        // produce identical bytes regardless of call grouping.
        v[d] = (((text.length + 1) * (i + 2) * (k + 3) * (d + 5)) % 97) / 97;
      }
      tokens.push(v);
    }
    return tokens;
  });
}

const mkChunk = (file, i) => ({
  file,
  content: `content-${file}-${i}`,
  text: `content-${file}-${i}`,
  metadata: {
    symbol: `sym${i}`,
    chunk_type: 'function',
    line_start: i * 10 + 1,
    line_end: i * 10 + 5,
    relative_path: file,
  },
});
const pickLiInput = (c) => c.text;

function hashTree(root) {
  const lines = [];
  const walk = (dir, rel = '') => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) walk(p, r);
      else lines.push(`${r}:${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
    }
  };
  walk(root);
  return lines.join('\n');
}

describe('applyLateInteractionDelta — tick-scoped reader cache (E.1-LI)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ss-li-cache-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const OPS = [
    [{ addId: 'a.js:1-5:0', chunk: mkChunk('a.js', 1) }],
    [{ addId: 'b.js:1-5:0', chunk: mkChunk('b.js', 1) }, { addId: 'b.js:11-15:1', chunk: mkChunk('b.js', 2) }],
    [{ retireId: 'a.js:1-5:0' }, { addId: 'a.js:21-25:0', chunk: mkChunk('a.js', 3) }],
  ];

  async function drive(indexPath, readerCache) {
    const results = [];
    for (const ops of OPS) {
      results.push(await applyLateInteractionDelta({
        indexPath, ops, liEncoder: fakeEncoder, pickLiInput, readerCache,
      }));
    }
    return results;
  }

  it('seeds on the first segmented call and reuses the same reader for later files', async () => {
    const indexPath = join(dir, 'li.db');
    const readerCache = { key: null, index: null };

    const r1 = await applyLateInteractionDelta({
      indexPath, ops: OPS[0], liEncoder: fakeEncoder, pickLiInput, readerCache,
    });
    expect(r1.appended).toBe(1);
    // First call: index did not exist yet → not cacheable.
    expect(readerCache.index).toBe(null);

    const r2 = await applyLateInteractionDelta({
      indexPath, ops: OPS[1], liEncoder: fakeEncoder, pickLiInput, readerCache,
    });
    expect(r2.appended).toBe(2);
    expect(readerCache.index).not.toBe(null);
    const seeded = readerCache.index;

    // Tombstone of a PRE-cache doc must resolve through the cached reader.
    const r3 = await applyLateInteractionDelta({
      indexPath, ops: OPS[2], liEncoder: fakeEncoder, pickLiInput, readerCache,
    });
    expect(readerCache.index).toBe(seeded);
    expect(r3.tombstone).toBe(1);
    expect(r3.appended).toBe(1);
  });

  it('cached run leaves byte-identical on-disk state to fresh-per-call runs', async () => {
    const cachedPath = join(dir, 'cached', 'li.db');
    const freshPath = join(dir, 'fresh', 'li.db');

    const cachedResults = await drive(cachedPath, { key: null, index: null });
    const freshResults = await drive(freshPath, null);

    expect(cachedResults).toEqual(freshResults);
    expect(hashTree(join(dir, 'cached'))).toBe(hashTree(join(dir, 'fresh')));
  });

  it('no-cache callers (per-file path) are unaffected', async () => {
    const indexPath = join(dir, 'li.db');
    const r1 = await applyLateInteractionDelta({
      indexPath, ops: OPS[0], liEncoder: fakeEncoder, pickLiInput,
    });
    const r2 = await applyLateInteractionDelta({
      indexPath, ops: OPS[2].slice(0, 1), liEncoder: fakeEncoder, pickLiInput,
    });
    expect(r1.appended).toBe(1);
    expect(r2.tombstone).toBe(1);
  });
});
