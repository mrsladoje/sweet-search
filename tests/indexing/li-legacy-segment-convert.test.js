import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { applyLateInteractionDelta } from '../../core/incremental-indexing/application/production-li-delta.mjs';

// Below one segment of documents the full build writes the LI index as one JSON file. The
// delta path loaded and rewrote all of it for every file (167 MB and 1.6 s per file at 2,000
// documents). The first delta now moves it to a sealed segment; later deltas append.
const DIM = 128;
const tokens = (seed, n = 6) => Array.from({ length: n }, (_, t) => Float32Array.from({ length: DIM }, (_, k) => Math.sin(seed * 7 + t * 13 + k)));
const query = tokens(424242, 3);

describe('LI delta on a single-file JSON index', () => {
  let dir;
  let indexPath;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ss-li-convert-'));
    indexPath = join(dir, 'codebase-late-interaction.db');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  async function buildLegacy(ids) {
    const index = new LateInteractionIndex({ indexPath, loadExisting: false, tokenDim: DIM, maxTokens: 64, useInt8: true, quantBits: 4, modelId: 'lateon-code' });
    await index.init();
    for (const [i, id] of ids.entries()) await index.add(id, tokens(i), { file: `${id}.js` });
    await index.save();
    expect(JSON.parse(readFileSync(indexPath, 'utf8')).version).toBe('2.1');
  }
  async function scores(ids) {
    const index = new LateInteractionIndex({ indexPath, loadExisting: true });
    await index.init();
    const out = await index.scoreWithLateInteraction(query, ids.map((id) => ({ id, score: 0 })));
    return { live: [...index.documents.keys()].sort(), byId: Object.fromEntries(out.map((r) => [r.id, r.lateInteractionScore ?? r.liScore ?? r.score])) };
  }

  it('moves the index to a segment once, keeps every score, and applies the delta', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    await buildLegacy(ids);
    const before = await scores(ids);
    expect(Object.values(before.byId).every((v) => Number.isFinite(v) && v !== 0)).toBe(true);

    const liEncoder = async (texts) => texts.map((_, i) => tokens(1000 + i));
    await applyLateInteractionDelta({
      indexPath,
      ops: [{ retireId: 'b' }, { addId: 'n', chunk: { file: 'n.js', metadata: {} } }],
      liEncoder,
      pickLiInput: () => 'text',
    });

    const stub = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(stub.format).toBe('segmented');
    const manifest = JSON.parse(readFileSync(join(dir, stub.segmentDir, 'manifest.json'), 'utf8'));
    expect(manifest.segments.map((s) => s.count)).toEqual([5, 1]);

    const after = await scores(['a', 'c', 'd', 'e', 'n']);
    expect(after.live).toEqual(['a', 'c', 'd', 'e', 'n']);
    for (const id of ['a', 'c', 'd', 'e']) expect(after.byId[id]).toBe(before.byId[id]);

    // The next delta appends; it does not convert again.
    await applyLateInteractionDelta({ indexPath, ops: [{ retireId: 'c' }], liEncoder, pickLiInput: () => 'text' });
    expect((await scores([])).live).toEqual(['a', 'd', 'e', 'n']);
  });

  it('refuses to convert a JSON file it cannot load', async () => {
    writeFileSync(indexPath, '{"version":"2.1","documents":[{"id":"a","tok');
    await expect(applyLateInteractionDelta({
      indexPath, ops: [{ retireId: 'a' }], liEncoder: async () => [], pickLiInput: () => '',
    })).rejects.toThrow();
    expect(readFileSync(indexPath, 'utf8')).toContain('"version":"2.1"');
    expect(existsSync(`${indexPath}.segments/manifest.json`)).toBe(false);
  });
});
