// node ab.mjs <set-dir> <reps> <addonA> <addonB> [variant=int4|int8]
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { loadCalls } from './bench-ours.mjs';
const [set, repsArg, a, b, variant = 'int4'] = process.argv.slice(2);
const req = createRequire(import.meta.url);
const A = req(a), B = req(b); const reps = Number(repsArg);
const calls = loadCalls(set);
if (variant === 'int8') { const { toInt8 } = await import('./int8.mjs'); for (const c of calls) c.cands = c.cands.map(toInt8); }
const fn = variant === 'int8' ? 'maxsimScoreBatchPertoken' : 'maxsimScoreBatch4Bit';
const GAP = Number(process.env.GAP_MS || 0); const sab = new Int32Array(new SharedArrayBuffer(4));
const idle = () => { if (GAP > 0) Atomics.wait(sab, 0, 0, GAP); };
const time = (m, c) => { let s = m[fn](c.query, c.numQ, c.dim, c.cands); const ts = []; for (let r = 0; r < reps; r++) { idle(); const t0 = performance.now(); s = m[fn](c.query, c.numQ, c.dim, c.cands); ts.push(performance.now() - t0); } ts.sort((x, y) => x - y); return [ts[ts.length >> 1], s]; };
let lr = [], la = [], lb = [], maxd = 0, maxrel = 0, top1 = 0;
for (const c of calls) {
  const [ta, sa] = time(A, c); const [tb, sb] = time(B, c);
  la.push(ta); lb.push(tb); lr.push(Math.log(ta / tb));
  for (let i = 0; i < sa.length; i++) { const d = Math.abs(sa[i] - sb[i]); maxd = Math.max(maxd, d); if (Math.abs(sa[i]) > 1e-6) maxrel = Math.max(maxrel, d / Math.abs(sa[i])); }
  const am = sa.indexOf(Math.max(...sa)), bm = sb.indexOf(Math.max(...sb)); top1 += am === bm;
}
const pct = (x, p) => [...x].sort((u, v) => u - v)[Math.floor(x.length * p)];
const g = Math.exp(lr.reduce((s, x) => s + x, 0) / lr.length);
console.log(`${variant} gap=${GAP}ms n=${calls.length} A p50=${pct(la, .5).toFixed(3)} p95=${pct(la, .95).toFixed(3)} total=${la.reduce((s, x) => s + x, 0).toFixed(0)}ms | B p50=${pct(lb, .5).toFixed(3)} p95=${pct(lb, .95).toFixed(3)} total=${lb.reduce((s, x) => s + x, 0).toFixed(0)}ms | speedup A/B geomean ${g.toFixed(3)}x | max|d| ${maxd.toExponential(2)} maxrel ${maxrel.toExponential(2)} top1 ${(top1 / calls.length * 100).toFixed(2)}%`);
