// node synth.mjs <reps> <addon.node>... -- <numQ>x<pool>x<docTokens> ...
// Seeded synthetic int4 pools (docTokens: a fixed count, or "r<max>" for uniform 1..max).
// Times every addon on every shape, addons interleaved per rep; prints the median ms.
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { toSlab } from './slab.mjs';
import { packMaxSimDocs } from '../../core/infrastructure/maxsim-pack.js';
// API=packed: docs live in one slab (as loaded from an index segment) and every
// call packs them (packMaxSimDocs, timed) for maxsimScorePacked.
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const reps = Number(argv[0]);
const addons = argv.slice(1, sep);
const shapes = argv.slice(sep + 1);
const req = createRequire(import.meta.url);
const mods = addons.map(a => req(a));
let s = 42;
const r = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
// GAP_MS: idle time before each timed call. GAP_MODE=sleep parks the calling thread
// (an idle daemon); GAP_MODE=spin keeps it busy (JS work before the call, as in a search).
const GAP = Number(process.env.GAP_MS || 0); const sab = new Int32Array(new SharedArrayBuffer(4));
const gap = () => {
  if (GAP <= 0) return;
  if (process.env.GAP_MODE === 'spin') { const end = performance.now() + GAP; while (performance.now() < end); } else Atomics.wait(sab, 0, 0, GAP);
};
for (const shape of shapes) {
  const [q, p, t] = shape.split('x');
  const numQ = Number(q), pool = Number(p), dim = Number(process.env.DIM || 128);
  const query = new Float32Array(numQ * dim).map(() => r() * 2 - 1);
  const cands = Array.from({ length: pool }, () => {
    const nt = t.startsWith('r') ? 1 + Math.floor(r() * Number(t.slice(1))) : Number(t);
    const tokens = Buffer.alloc(nt * dim / 2).map(() => Math.floor(r() * 256));
    return { tokens, numTokens: nt, dim, minArray: new Float32Array(nt).map(() => -0.5 - r() * 0.2), scaleArray: new Float32Array(nt).fill(0.07), tokenNorms: new Float32Array(nt).fill(2) };
  });
  // API=packed-separate: each doc array in its own ArrayBuffer (JSON-format indexes)
  const sep = (c) => ({ ...c, tokens: new Uint8Array(c.tokens), minArray: new Float32Array(c.minArray), scaleArray: new Float32Array(c.scaleArray), tokenNorms: new Float32Array(c.tokenNorms) });
  const slabDocs = process.env.API === 'packed-separate' ? cands.map(sep) : toSlab(cands);
  const call = process.env.API?.startsWith('packed')
    ? (m) => { const { buffers, desc } = packMaxSimDocs(slabDocs); return m.maxsimScorePacked(query, numQ, dim, 4, buffers, desc); }
    : (m) => m.maxsimScoreBatch4Bit(query, numQ, dim, cands);
  const lat = mods.map(() => []);
  for (const m of mods) call(m);
  for (let i = 0; i < reps; i++) {
    for (let k = 0; k < mods.length; k++) {
      gap();
      const t0 = performance.now(); call(mods[k]); lat[k].push(performance.now() - t0);
    }
  }
  const med = a => a.sort((x, y) => x - y)[a.length >> 1];
  console.log(shape.padEnd(14), lat.map((l, k) => `${addons[k].split('/').pop()} ${med(l).toFixed(4)} (min ${Math.min(...l).toFixed(4)})`).join('  '));
}
