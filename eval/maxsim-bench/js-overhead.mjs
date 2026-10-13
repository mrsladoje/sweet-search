// node js-overhead.mjs <replay-set-dir> [reps]
// Time of the whole rerank scoring stage (LateInteractionIndex.scoreWithLateInteraction:
// query prep, candidate grouping, packing, kernel, result objects, sort) vs the native
// kernel call inside it, on replayed calls. The index is filled in memory with the
// calls' real docs (laid out in slabs as load() does); candidates carry only an id and
// a first-stage score, like the real ones' fields that matter here.
import { performance } from 'node:perf_hooks';
import { loadCalls } from './replay.mjs';

const [set, repsArg] = process.argv.slice(2);
const reps = Number(repsArg || 20);
const SRC = new URL('../../', import.meta.url).pathname;
const { LateInteractionIndex } = await import(`${SRC}core/ranking/late-interaction-index.js`);
const { loadNativeAddon } = await import(`${SRC}core/infrastructure/native-resolver.js`);
const mod = loadNativeAddon().mod;
let kernelMs = 0;
const packed = mod.maxsimScorePacked.bind(mod);
mod.maxsimScorePacked = (...a) => { const t = performance.now(); const r = packed(...a); kernelMs += performance.now() - t; return r; };

const calls = loadCalls(set).filter(c => c.kind === 'int4');
const idx = new LateInteractionIndex({ indexPath: '/nonexistent/li.db', loadExisting: false, quantBits: 4, tokenDim: calls[0].dim });
idx.tokenDim = calls[0].dim; idx.quantBits = 4;
let id = 0;
const work = calls.map(c => {
  const cands = c.cands.map(d => {
    const docId = `d${id++}`;
    idx.documents.set(docId, { tokens: new Uint8Array(d.tokens), numTokens: d.numTokens, dim: d.dim, minArray: new Float32Array(d.minArray), scaleArray: new Float32Array(d.scaleArray), tokenNorms: new Float32Array(d.tokenNorms), quantBits: 4 });
    return { id: docId, score: Math.random(), filePath: `src/file${id}.js`, startLine: 1, endLine: 40 };
  });
  const tokens = Array.from({ length: c.numQ }, (_, i) => c.query.slice(i * c.dim, (i + 1) * c.dim));
  return { tokens, cands };
});
idx._packDocsIntoSlabs();

const stage = [], kern = [];
for (const w of work) await idx.scoreWithLateInteraction(w.tokens, w.cands); // warm
for (let r = 0; r < reps; r++) {
  for (const w of work) {
    kernelMs = 0;
    const t = performance.now();
    await idx.scoreWithLateInteraction(w.tokens, w.cands);
    stage.push(performance.now() - t); kern.push(kernelMs);
  }
}
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
const sum = a => a.reduce((x, y) => x + y, 0);
console.log(`${set.split('/').pop()}: ${work.length} calls x ${reps}: stage p50 ${(pct(stage, .5) * 1e3).toFixed(1)} µs, kernel p50 ${(pct(kern, .5) * 1e3).toFixed(1)} µs, JS around the kernel ${((sum(stage) - sum(kern)) / stage.length * 1e3).toFixed(1)} µs/call (${((1 - sum(kern) / sum(stage)) * 100).toFixed(0)}% of the stage)`);
process.exit(0);
