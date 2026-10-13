// node ab.mjs <set-dir> <reps> <addonA>[:packed][:prewarm] <addonB>[...] [...]
// Times builds against each other on replayed calls. Per call, every build runs as a
// block (builds in rotating order, so drift and thermal state hit all equally): a 2 ms
// sleep first, so the worker pools of the other builds (each build loads its own) have
// parked and do not compete, then one warm call, then the timed reps back to back.
// Per call: latency = median of the timed reps.
// Prints p50 / p95 / total per build and, for each build vs the first, the geometric
// mean of per-call ratios (first / build, > 1 = build faster) with a 95% bootstrap CI.
// An arm ending in ":packed" calls maxsimScorePacked with the call's docs in one slab
// (as loaded from an index segment), packing them on every call (packMaxSimDocs, timed),
// which is the production path; other arms call the object entry point. An arm with
// ":prewarm" calls maxsimPrewarm() before the PREP_US preparation; its cost is added
// to the arm's latency.
//   PREP_US=<µs>     busy JS work between the gap and the call (default 0), as the
//                    rerank stage does before its kernel call
//   VARIANT=int8     same docs requantized to int8 per token (default int4 as captured)
//   GAP_MS=<ms>      idle time before every timed call
//   GAP_MODE=spin    keep the calling thread busy during the gap (default: sleep)
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { loadCalls } from './replay.mjs';
import { toSlab } from './slab.mjs';
import { packMaxSimDocs } from '../../core/infrastructure/maxsim-pack.js';

const [set, repsArg, ...arms] = process.argv.slice(2);
const req = createRequire(import.meta.url);
const addons = arms.map(a => a.split(':')[0]);
const isPacked = arms.map(a => a.split(':').includes('packed'));
const isPrewarm = arms.map(a => a.split(':').includes('prewarm'));
const PREP = Number(process.env.PREP_US || 0) / 1000;
const prep = () => { if (PREP > 0) { const end = performance.now() + PREP; while (performance.now() < end); } };
const mods = addons.map(a => req(a));
const reps = Number(repsArg);
const calls = loadCalls(set);
const variant = process.env.VARIANT || 'int4';
if (variant === 'int8') { const { toInt8 } = await import('./int8.mjs'); for (const c of calls) c.cands = c.cands.map(toInt8); }
const fn = variant === 'int8' ? 'maxsimScoreBatchPertoken' : 'maxsimScoreBatch4Bit';
const bits = variant === 'int8' ? 8 : 4;
if (isPacked.some(Boolean)) for (const c of calls) c.slab = toSlab(c.cands);
const run = (k, c) => {
  if (!isPacked[k]) return mods[k][fn](c.query, c.numQ, c.dim, c.cands);
  const { buffers, desc } = packMaxSimDocs(c.slab);
  return mods[k].maxsimScorePacked(c.query, c.numQ, c.dim, bits, buffers, desc);
};
const GAP = Number(process.env.GAP_MS || 0); const sab = new Int32Array(new SharedArrayBuffer(4));
const gap = () => {
  if (GAP <= 0) return;
  if (process.env.GAP_MODE === 'spin') { const end = performance.now() + GAP; while (performance.now() < end); } else Atomics.wait(sab, 0, 0, GAP);
};

const lat = mods.map(() => []);
let mismatched = 0;
for (let ci = 0; ci < calls.length; ci++) {
  const c = calls[ci];
  const ref = mods.map((m, k) => Array.from(run(k, c)));
  for (let k = 1; k < mods.length; k++) if (ref[k].some((x, i) => !Object.is(x, ref[0][i]))) mismatched++;
  for (let j = 0; j < mods.length; j++) {
    const k = (j + ci) % mods.length;
    Atomics.wait(sab, 0, 0, 2);
    run(k, c);
    const ts = [];
    for (let r = 0; r < reps; r++) {
      gap();
      let warm = 0;
      if (isPrewarm[k]) { const tw = performance.now(); mods[k].maxsimPrewarm(); warm = performance.now() - tw; }
      prep();
      const t0 = performance.now(); run(k, c); ts.push(performance.now() - t0 + warm);
    }
    ts.sort((x, y) => x - y); lat[k].push(ts[ts.length >> 1]);
  }
}

const pct = (x, p) => [...x].sort((u, v) => u - v)[Math.min(x.length - 1, Math.floor(x.length * p))];
const sum = x => x.reduce((s, v) => s + v, 0);
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
console.log(`${set.split('/').pop()} ${variant} gap=${GAP}ms${GAP ? ` (${process.env.GAP_MODE || 'sleep'})` : ''} calls=${calls.length} reps=${reps}${mismatched ? `  SCORE MISMATCH in ${mismatched} calls` : '  scores bit-identical'}`);
for (let k = 0; k < mods.length; k++) {
  let line = `  ${arms[k].split('/').pop().padEnd(22)} p50 ${pct(lat[k], 0.5).toFixed(4)}  p95 ${pct(lat[k], 0.95).toFixed(4)}  total ${sum(lat[k]).toFixed(1)} ms`;
  if (k > 0) {
    const lr = lat[0].map((a, i) => Math.log(a / lat[k][i]));
    const g = Math.exp(sum(lr) / lr.length);
    const bs = [];
    for (let b = 0; b < 1000; b++) { let s = 0; for (let i = 0; i < lr.length; i++) s += lr[Math.floor(rnd() * lr.length)]; bs.push(Math.exp(s / lr.length)); }
    bs.sort((x, y) => x - y);
    line += `  speedup ${g.toFixed(3)}x [${bs[25].toFixed(3)}, ${bs[974].toFixed(3)}]`;
  }
  console.log(line);
}
