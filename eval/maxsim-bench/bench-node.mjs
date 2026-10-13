// node bench-node.mjs --arm NAME --out FILE.json --set DIR [--set DIR ...] [--reps N] [--gap-ms G] [--limit N] [--stride N]
//
// The Node twin of bench.py (same timing protocol, same JSON) for the paths a
// sweet-search process actually runs:
//   production  core/infrastructure/simd-distance.js nativeMaxSimPacked, the call the
//               LI rerank stage makes (docs in one slab, as loaded from an index
//               segment; per-call JS packing and N-API included)
//   prewarm     production, with nativeMaxSimPrewarm() called PREP_US (busy JS work,
//               default 100 µs) before the call, as the rerank stage does on entry;
//               latency = the prewarm call + the scoring call (the JS work is not
//               counted: it runs either way)
//   wasm        the WASM SIMD tier (fused int4 kernel, one call per candidate), used
//               when the native addon is unavailable
//   js          the plain-JS tier (_maxSimScore4BitImplicit), the last fallback
//   legacy      the path before this change: per call, one candidate object per doc
//               (Buffer.from + object literal, as late-interaction-index.js built them)
//               into maxsimScoreBatch4Bit of the addon at LEGACY_ADDON
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadCalls } from './replay.mjs';
import { toSlab } from './slab.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const sets = argv.flatMap((a, i) => (a === '--set' ? [argv[i + 1]] : []));
const arm = opt('arm'), outFile = opt('out');
const reps = Number(opt('reps', 5)), gapMs = Number(opt('gap-ms', 0)), limit = Number(opt('limit', 0)), stride = Number(opt('stride', 1));
const PREP = Number(process.env.PREP_US || 100) / 1000;

const SRC = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const sd = await import(`${SRC}/core/infrastructure/simd-distance.js`);
await sd.initWasm?.();
const jsScore = arm === 'js'
  ? (await import(`${SRC}/core/ranking/late-interaction-index.js`)).LateInteractionIndex.prototype._maxSimScore4BitImplicit
  : null;
const legacy = arm === 'legacy' ? (await import('node:module')).createRequire(import.meta.url)(process.env.LEGACY_ADDON) : null;

const busy = (ms) => { const end = performance.now() + ms; while (performance.now() < end); };

function build(c) {
  const docs = toSlab(c.cands);
  if (arm === 'production') return () => sd.nativeMaxSimPacked(c.query, c.numQ, c.dim, c.kind === 'int4' ? 4 : 8, docs);
  if (arm === 'prewarm') {
    const score = () => sd.nativeMaxSimPacked(c.query, c.numQ, c.dim, c.kind === 'int4' ? 4 : 8, docs);
    score.before = () => { const t0 = performance.now(); sd.nativeMaxSimPrewarm(); const t = performance.now() - t0; busy(PREP); return t; };
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
}

// float64 reference of our contract: per query token max(0, max cosine), mean over tokens.
// bench.py caches it per set in <set>/<repo>/refs.json ([raw, clamped] per call); use
// that when present (the scalar JS below is slow on the largest sweep cells).
const refCache = new Map();
function cachedReference(root, c) {
  const p = path.join(root, c.repo, 'refs.json');
  if (!refCache.has(p)) refCache.set(p, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});
  const r = refCache.get(p)[c.file];
  return r ? r[1] : reference(c);
}
function reference(c) {
  const { numQ, dim, query } = c; const pd = (dim + 1) >> 1;
  const qn = []; for (let i = 0; i < numQ; i++) { let s = 0; for (let k = 0; k < dim; k++) s += query[i * dim + k] ** 2; qn.push(Math.sqrt(s)); }
  return c.cands.map(d => {
    let total = 0;
    for (let i = 0; i < numQ; i++) {
      let best = -Infinity;
      for (let t = 0; t < d.numTokens; t++) {
        let dot = 0;
        for (let k = 0; k < dim; k++) {
          const b = d.tokens[t * pd + (k >> 1)]; const nib = (k & 1) ? b >> 4 : b & 15;
          dot += query[i * dim + k] * (nib * d.scaleArray[t] + d.minArray[t]);
        }
        const sim = dot / (qn[i] * d.tokenNorms[t]);
        if (sim > best) best = sim;
      }
      total += Math.max(0, best);
    }
    return total / numQ;
  });
}

const out = { env: { arm, reps, gap_ms: gapMs, sets, node: process.version, platform: `${os.platform()} ${os.release()}`, machine: os.arch(), cpu: os.cpus()[0]?.model, cpu_count: os.cpus().length, loadavg: os.loadavg(), started: new Date().toISOString() }, clamp: true, calls: [] };
for (const root of sets) {
  let calls = loadCalls(root).filter((_, i) => i % stride === 0);
  if (limit) calls = calls.slice(0, limit);
  for (const c of calls) {
    if (c.kind !== 'int4' && arm !== 'production' && arm !== 'prewarm') throw new Error('wasm/js/legacy arms cover int4 calls only');
    const run = build(c);
    const got = Array.from(run());
    const ts = [];
    for (let r = 0; r < reps; r++) {
      if (gapMs > 0) busy(gapMs);
      const extra = run.before ? run.before() : 0;
      const t0 = performance.now(); run(); ts.push(performance.now() - t0 + extra);
    }
    ts.sort((a, b) => a - b);
    const ref = cachedReference(root, c);
    const order = (s) => s.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[1]);
    const oR = order(ref), oG = order(got); const k = Math.min(10, got.length);
    const top10 = k ? oR.slice(0, k).filter(i => oG.slice(0, k).includes(i)).length / k : 1;
    out.calls.push({ set: path.basename(root.replace(/\/$/, '')), file: c.file, nq: c.numQ, pool: c.cands.length, tokens: c.cands.reduce((a, d) => a + d.numTokens, 0),
      ms: ts[ts.length >> 1], err: got.length ? Math.max(...got.map((g, i) => Math.abs(g - ref[i]))) : 0, top1: !got.length || oR[0] === oG[0], top10 });
  }
}
out.env.loadavg_end = os.loadavg(); out.env.ended = new Date().toISOString();
fs.writeFileSync(outFile, JSON.stringify(out));
const lat = out.calls.map(c => c.ms).sort((a, b) => a - b);
console.log(`${arm} gap=${gapMs}ms calls=${lat.length} p50=${lat[lat.length >> 1].toFixed(4)} ms total=${lat.reduce((a, b) => a + b, 0).toFixed(1)} ms max|err|=${Math.max(...out.calls.map(c => c.err)).toExponential(2)} top1=${(out.calls.filter(c => c.top1).length / lat.length * 100).toFixed(2)}%`);
process.exit(0);
