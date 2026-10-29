/**
 * linkGraph when the native graph build throws: the index is still flat, so the JS loop builds
 * the same lists (only slower), and the result says the build was not native.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../core/infrastructure/native-resolver.js', async (orig) => ({
  ...(await orig()),
  loadNativeAddon: () => ({ mod: { buildBinaryHnsw: async () => { throw new Error('buildBinaryHnsw: bad arguments'); } } }),
}));

const { BinaryHNSWIndex } = await import('../../core/vector-store/binary-hnsw-index.js');
const dir = mkdtempSync(join(tmpdir(), 'ss-hnsw-fail-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('linkGraph after a native error', () => {
  it('builds the addSync lists in JS', async () => {
    let s = 7;
    const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    const codes = Array.from({ length: 300 }, () => Uint8Array.from({ length: 64 }, () => Math.floor(r() * 256)));
    const ids = codes.map((_, i) => `f${i % 9}.js:${i}`);
    const make = (name) => {
      const ix = new BinaryHNSWIndex({ dimension: 64, floatDimension: 512, M: 8, efConstruction: 40, indexPath: join(dir, name) });
      ix.resetForBuild();
      return ix;
    };
    const ref = make('ref.idx');
    codes.forEach((c, i) => ref.addSync(ids[i], c));
    const ix = make('fail.idx');
    for (let i = 0; i < codes.length; i++) await ix.addDeferred(ids[i], codes[i]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const link = await ix.linkGraph({ threads: 4 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/native graph build failed/));
    warn.mockRestore();
    expect(link).toEqual({ native: false, threads: 1, redos: 0 });
    expect([ix.entryPoint, ix.maxLevel]).toEqual([ref.entryPoint, ref.maxLevel]);
    const lists = (g) => g.map((lv) => Array.from(lv, (l) => (l ? [...l] : null)));
    expect(lists(ix.graph)).toEqual(lists(ref.graph));
  });
});
