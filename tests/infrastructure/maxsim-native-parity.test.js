import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { loadNativeAddon } from '../../core/infrastructure/native-resolver.js';

// Native MaxSim kernels vs a plain JS reference of the output contract:
//   score = mean over query tokens of max(0, max_d dot(q, d) / (|q|·|d| + 1e-8))
// with d dequantized exactly as the kernels do (f32 mul then add) and |d| the
// stored per-token norm (per-doc path: the norm of the dequantized row).
// Shapes cover every kernel branch: dim % 4 != 0 (portable path), dim % 32 != 0
// (scalar int4 dequant), odd dim, tile edges (63/64/65/257 doc tokens), more
// than 64 query tokens, empty docs, zero scales and all-negative similarities.

// SS_NATIVE_ADDON: test a specific build (the hill-climb A/B uses it).
const native = process.env.SS_NATIVE_ADDON
  ? createRequire(import.meta.url)(process.env.SS_NATIVE_ADDON)
  : loadNativeAddon()?.mod;
const run = native?.maxsimScoreBatch4Bit ? describe : describe.skip;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = Math.fround;

function makeQuery(r, numQ, dim, { negate = false, zeroRow = false } = {}) {
  const q = new Float32Array(numQ * dim);
  for (let i = 0; i < q.length; i++) q[i] = (r() * 2 - 1) * (negate ? -1 : 1);
  if (zeroRow) q.fill(0, 0, dim);
  return q;
}

// Per-token quantized doc: int8 (Buffer of signed bytes) or int4 (packed nibbles).
function makeDoc(r, numTokens, dim, bits, { zeroScale = false, positive = false } = {}) {
  const minArray = new Float32Array(numTokens);
  const scaleArray = new Float32Array(numTokens);
  const tokenNorms = new Float32Array(numTokens);
  const levels = bits === 4 ? 15 : 255;
  const codes = new Uint8Array(numTokens * dim);
  for (let t = 0; t < numTokens; t++) {
    minArray[t] = positive ? f(r() * 0.1) : f(-0.5 - r() * 0.5);
    scaleArray[t] = zeroScale ? 0 : f((positive ? 0.2 : 1 + r()) / levels);
    let n2 = 0;
    for (let d = 0; d < dim; d++) {
      const c = Math.floor(r() * (levels + 1));
      codes[t * dim + d] = c;
      const v = f(f(c * scaleArray[t]) + minArray[t]);
      n2 += v * v;
    }
    tokenNorms[t] = f(Math.sqrt(n2) * (1 + (r() - 0.5) * 1e-3)); // stored pre-quant norm ≈ dequant norm
  }
  let tokens;
  if (bits === 4) {
    const pd = (dim + 1) >> 1;
    tokens = Buffer.alloc(numTokens * pd);
    for (let t = 0; t < numTokens; t++) {
      for (let d = 0; d < dim; d++) {
        const c = codes[t * dim + d];
        tokens[t * pd + (d >> 1)] |= (d & 1) ? c << 4 : c;
      }
    }
  } else {
    tokens = Buffer.alloc(numTokens * dim);
    for (let i = 0; i < codes.length; i++) tokens[i] = (codes[i] - 128) & 255;
  }
  return { tokens, numTokens, dim, minArray, scaleArray, tokenNorms, codes };
}

function dequant(doc, bits, t, d) {
  const c = doc.codes[t * doc.dim + d];
  if (bits === 4) return f(f(c * doc.scaleArray[t]) + doc.minArray[t]);
  return f(f((c - 128 + 128) * doc.scaleArray[t]) + doc.minArray[t]);
}

function reference(query, numQ, dim, doc, bits) {
  let total = 0;
  for (let qi = 0; qi < numQ; qi++) {
    let qn = 0;
    for (let d = 0; d < dim; d++) qn += query[qi * dim + d] ** 2;
    qn = Math.sqrt(qn);
    let best = -1;
    for (let t = 0; t < doc.numTokens; t++) {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += query[qi * dim + d] * dequant(doc, bits, t, d);
      const sim = dot / (qn * doc.tokenNorms[t] + 1e-8);
      if (sim > best) best = sim;
    }
    if (best > 0) total += best;
  }
  return total / numQ;
}

function score(bits, query, numQ, dim, docs) {
  const fn = bits === 4 ? native.maxsimScoreBatch4Bit : native.maxsimScoreBatchPertoken;
  return fn(query, numQ, dim, docs.map(({ codes, ...c }) => c));
}

const DIMS = [128, 96, 48, 130, 127, 16];
const DOC_TOKENS = [0, 1, 3, 4, 5, 63, 64, 65, 257];
const QUERY_TOKENS = [1, 3, 4, 5, 14, 70];

run('native MaxSim kernels match the reference contract', () => {
  for (const bits of [4, 8]) {
    it(`int${bits}: every shape within 1e-5 of the reference`, () => {
      const r = rng(42 + bits);
      let worst = 0;
      for (const dim of DIMS) {
        for (const numQ of QUERY_TOKENS) {
          const query = makeQuery(r, numQ, dim);
          const docs = DOC_TOKENS.map(n => makeDoc(r, n, dim, bits));
          const got = score(bits, query, numQ, dim, docs);
          docs.forEach((doc, i) => {
            const want = reference(query, numQ, dim, doc, bits);
            worst = Math.max(worst, Math.abs(got[i] - want));
            expect(Math.abs(got[i] - want), `dim=${dim} numQ=${numQ} numD=${doc.numTokens}`).toBeLessThan(1e-5);
          });
        }
      }
      expect(worst).toBeLessThan(1e-5);
    });

    it(`int${bits}: empty doc scores 0 and the top candidate matches the reference`, () => {
      const r = rng(7 + bits);
      const dim = 128;
      const numQ = 14;
      const query = makeQuery(r, numQ, dim);
      const docs = [0, 40, 90, 200, 300].map(n => makeDoc(r, n, dim, bits));
      const got = score(bits, query, numQ, dim, docs);
      const want = docs.map(d => reference(query, numQ, dim, d, bits));
      expect(got[0]).toBe(0);
      expect(got.indexOf(Math.max(...got))).toBe(want.indexOf(Math.max(...want)));
    });

    it(`int${bits}: all-negative similarities clamp to 0; zero scale and zero query row stay finite`, () => {
      const r = rng(99 + bits);
      const dim = 128;
      // Positive doc values against a negated query: every similarity < 0.
      const neg = makeQuery(r, 5, dim, { negate: true }).map(Math.abs).map(v => -v);
      const docPos = makeDoc(r, 70, dim, bits, { positive: true });
      expect(score(bits, neg, 5, dim, [docPos])[0]).toBe(0);

      const q = makeQuery(r, 6, dim, { zeroRow: true });
      const docs = [makeDoc(r, 33, dim, bits, { zeroScale: true }), makeDoc(r, 65, dim, bits)];
      const got = score(bits, q, 6, dim, docs);
      docs.forEach((doc, i) => {
        expect(Number.isFinite(got[i])).toBe(true);
        expect(Math.abs(got[i] - reference(q, 6, dim, doc, bits))).toBeLessThan(1e-5);
      });
    });
  }

  it('rejects a candidate whose dim differs from the query dim', () => {
    const r = rng(5);
    const query = makeQuery(r, 4, 128);
    const doc = makeDoc(r, 10, 96, 4);
    expect(() => score(4, query, 4, 128, [doc])).toThrow(/dim/);
  });
});
