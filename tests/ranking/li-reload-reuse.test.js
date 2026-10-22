import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { applyLateInteractionDelta } from '../../core/incremental-indexing/application/production-li-delta.mjs';
import { mergeLiSegments } from '../../core/incremental-indexing/infrastructure/li-segment-merge.mjs';
import { liSegmentHandler } from '../../core/incremental-indexing/application/maintenance-handlers.mjs';

// The daemon reloaded every LI segment on every epoch (0.32 s warm, ~4 s cold on a 1.7 GB
// index). A reload given the previous index reuses the docs of unchanged segments; the
// result must equal a fresh load: same docs, same order, same bytes, same scores.
const DIM = 128;
const tokens = (seed, n = 3) => Array.from({ length: n }, (_, t) => Float32Array.from({ length: DIM }, (_, k) => Math.sin(seed * 7 + t * 13 + k)));
const query = tokens(424242, 2);
const plain = (doc) => [doc.numTokens, doc.dim, doc.quantBits ?? null,
  Array.from(doc.tokens), Array.from(doc.minArray ?? []), Array.from(doc.scaleArray ?? []), Array.from(doc.tokenNorms ?? [])];

describe('LI reload with reuseFrom', () => {
  let dir;
  let indexPath;
  let stateDir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ss-li-reuse-'));
    stateDir = dir;
    indexPath = join(dir, 'codebase-late-interaction.db');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const liEncoder = async (texts) => texts.map((_, i) => tokens(1000 + i * 3 + texts.length));
  const delta = (ops) => applyLateInteractionDelta({ indexPath, ops, liEncoder, pickLiInput: () => 'x' });
  const add = (id) => ({ addId: id, chunk: { file: `${id}.js`, metadata: {} } });

  async function load(reuseFrom = null) {
    const index = new LateInteractionIndex({ indexPath, loadExisting: true });
    if (reuseFrom) index._reuseFrom = reuseFrom;
    await index.init();
    return index;
  }
  async function same(reloaded, fresh) {
    expect([...reloaded.documents.keys()]).toEqual([...fresh.documents.keys()]);
    for (const [id, doc] of fresh.documents) expect(plain(reloaded.documents.get(id))).toEqual(plain(doc));
    const candidates = [...fresh.documents.keys()].map((id) => ({ id, score: 0 }));
    const a = await reloaded.scoreWithLateInteraction(query, candidates);
    const b = await fresh.scoreWithLateInteraction(query, candidates);
    expect(a.map((r) => [r.id, r.lateInteractionScore])).toEqual(b.map((r) => [r.id, r.lateInteractionScore]));
  }

  it('equals a fresh load after appends, tombstones, a merge and a compaction, reading only what changed', async () => {
    const base = new LateInteractionIndex({ indexPath, loadExisting: false, tokenDim: DIM, maxTokens: 64, useInt8: true, quantBits: 4, modelId: 'lateon-code' });
    await base.init();
    for (let i = 0; i < 6; i++) await base.add(`b${i}`, tokens(i), {});
    await base.save();

    let current = await load();
    const reads = vi.spyOn(LateInteractionIndex.prototype, 'readLiveSegmentDocs');
    const step = async () => {
      reads.mockClear();
      const reloaded = await load(current);
      const readCount = reads.mock.calls.length;
      await same(reloaded, await load());
      current = reloaded;
      return readCount;
    };

    await delta([add('n1'), add('n2')]);
    expect(await step()).toBe(1); // only the appended segment is read

    await delta([{ retireId: 'b1' }, { retireId: 'n1' }, add('n3')]);
    expect(await step()).toBe(1); // tombstones applied to reused docs; the new segment read

    await mergeLiSegments(stateDir, { minSmallSegments: 2, graceMs: 0 });
    await step();

    await delta([{ retireId: 'b2' }, { retireId: 'b3' }, { retireId: 'b4' }]);
    await step();
    await liSegmentHandler({ payload: { segmentId: current._segments[0].path.split('/').pop() } }, { stateDir });
    await step();
    expect(current.documents.has('b2')).toBe(false);
    reads.mockRestore();
  });
});
