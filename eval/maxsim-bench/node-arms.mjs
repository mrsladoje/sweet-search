// The Node arms of bench-node.mjs (timing) and mem-node.mjs (W11 RAM pass), in one place
// so both run the same code. See bench-node.mjs for what each arm is.
import { performance } from 'node:perf_hooks';

export const busy = (ms) => { const end = performance.now() + ms; while (performance.now() < end); };

// Lay every doc of every call out in shared slabs, once (LateInteractionIndex
// _packDocsIntoSlabs does the same at index load).
export function packAll(calls) {
  const al = n => (n + 3) & ~3;
  const MAX = 64 * 1024 * 1024;
  let batch = [], bytes = 0;
  const flush = () => {
    if (!batch.length) return;
    const slab = new ArrayBuffer(bytes), u8 = new Uint8Array(slab);
    let at = 0;
    for (const d of batch) {
      for (const f of ['tokens', 'minArray', 'scaleArray', 'tokenNorms']) {
        const a = d[f];
        u8.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at);
        d[f] = new a.constructor(slab, at, a.length);
        at += al(a.byteLength);
      }
    }
    batch = []; bytes = 0;
  };
  for (const c of calls) for (const d of c.cands) {
    const need = al(d.tokens.byteLength) + 3 * al(d.numTokens * 4);
    if (bytes + need > MAX) flush();
    batch.push(d); bytes += need;
  }
  flush();
}

// The arm's call for one replay call: () => scores (and .before for the prewarm arm).
// ctx: { sd (simd-distance.js), arm, legacy (LEGACY_ADDON module or null), jsScore
// (_maxSimScore4BitImplicit or null), prepMs }.
export function makeBuild({ sd, arm, legacy, jsScore, prepMs }) {
  return function build(c) {
    const docs = c.cands;
    if (arm === 'production') return () => sd.nativeMaxSimPacked(c.query, c.numQ, c.dim, c.kind === 'int4' ? 4 : 8, docs);
    if (arm === 'prewarm') {
      const score = () => sd.nativeMaxSimPacked(c.query, c.numQ, c.dim, c.kind === 'int4' ? 4 : 8, docs);
      score.before = () => { const t0 = performance.now(); sd.nativeMaxSimPrewarm(); const t = performance.now() - t0; busy(prepMs); return t; };
      return score;
    }
    if (arm === 'wasm') {
      return () => {
        const session = sd.wasmMaxSimPrepareQuery(c.query, c.numQ, c.dim);
        return docs.map(d => sd.wasmMaxSimDequant4Bit(c.query, d.tokens, d.minArray, d.scaleArray, d.tokenNorms, c.numQ, d.numTokens, c.dim, session));
      };
    }
    if (arm === 'legacy') {
      return () => legacy.maxsimScoreBatch4Bit(c.query, c.numQ, c.dim, docs.map(d => ({
        tokens: Buffer.from(d.tokens.buffer, d.tokens.byteOffset, d.tokens.byteLength),
        numTokens: d.numTokens, dim: d.dim, minArray: d.minArray, scaleArray: d.scaleArray, tokenNorms: d.tokenNorms,
      })));
    }
    if (arm === 'js') {
      const rows = Array.from({ length: c.numQ }, (_, i) => c.query.subarray(i * c.dim, (i + 1) * c.dim));
      const self = { useTokenWeights: false };
      return () => docs.map(d => jsScore.call(self, rows, { ...d, quantBits: 4 }, c.query));
    }
    throw new Error(`unknown arm ${arm}`);
  };
}
