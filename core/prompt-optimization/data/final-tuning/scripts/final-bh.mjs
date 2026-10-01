#!/usr/bin/env node
// final-bh.mjs — Phase 7 read-out (r3-PREREG.md): paired bootstrap (stratified by stratum, B=20000,
// seed 42, 95% percentile CI, two-sided bootstrap p) for every comparison, then Benjamini–Hochberg
// q across ALL comparisons × primary metrics (accuracy, cost, calls). Aggregates only.
//   node final-bh.mjs <spec.json>   spec = { label, comparisons: [{ name, cell, a: {tag, arm}, b: {tag, arm} }] }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const RES = path.join(WT, 'core/prompt-optimization/data/results');
const PROBES = new Map(JSON.parse(fs.readFileSync(path.join(HERE, '../r3/r3-probes.json'), 'utf8')).probes.map(p => [p.id, p]));
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function boot(ds) {
  const by = new Map(); for (const d of ds) { if (!by.has(d.s)) by.set(d.s, []); by.get(d.s).push(d.d); }
  const rnd = mulberry32(42), B = 20000, ms = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (const v of by.values()) for (let j = 0; j < v.length; j++) { s += v[Math.floor(rnd() * v.length)]; n++; } ms.push(s / n); }
  ms.sort((x, y) => x - y);
  const lo = ms[Math.floor(0.025 * B)], hi = ms[Math.floor(0.975 * B)];
  const pLow = ms.filter(x => x <= 0).length / B, pHigh = ms.filter(x => x >= 0).length / B;
  return { lo, hi, p: Math.min(1, 2 * Math.min(pLow, pHigh)) };
}
function rows(cell, tag, arm) {
  const dir = path.join(RES, `r282-${cell}-${tag}`);
  const m = new Map(fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => !r.error && r.exitCode === 0 && r.arm === arm).map(r => [r.id, r]));
  const f = path.join(dir, 'rescore-or.jsonl');
  if (fs.existsSync(f)) for (const x of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)) { const r = m.get(x.id); if (r && (x.arm || 'sweet') === arm && x.judgesOk?.length === 3) r.accOR = x.score; }
  return m;
}
const METRICS = [['accuracy', r => r.accOR ?? ((r.judgesOk || []).length === 3 ? r.score : null)], ['cost', r => r.costRealizedUsd], ['calls', r => r.calls]];
const tests = [];
for (const c of spec.comparisons) {
  const A = rows(c.cell, c.a.tag, c.a.arm), B = rows(c.cell, c.b.tag, c.b.arm);
  for (const [m, f] of METRICS) {
    const ids = [...B.keys()].filter(id => A.has(id) && Number.isFinite(f(A.get(id))) && Number.isFinite(f(B.get(id))));
    const ds = ids.map(id => ({ s: PROBES.get(id)?.stratum || 'x', d: f(B.get(id)) - f(A.get(id)) }));
    const ma = mean(ids.map(id => f(A.get(id)))), mb = mean(ids.map(id => f(B.get(id))));
    tests.push({ comparison: c.name, metric: m, n: ids.length, a: ma, b: mb, d: mb - ma, rel: ma ? (mb - ma) / ma : null, ...boot(ds) });
  }
}
// Benjamini–Hochberg
const sorted = [...tests].sort((x, y) => x.p - y.p); const m = sorted.length;
let prev = 1; for (let i = m - 1; i >= 0; i--) { prev = Math.min(prev, sorted[i].p * m / (i + 1)); sorted[i].q = prev; }
console.log(`# ${spec.label}\n\nPaired bootstrap stratified by stratum, B=20000, seed 42; BH across ${m} tests.\n`);
console.log('| Comparison | Metric | n | A | B | Δ | Δ% | 95% CI | p | BH q | |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const t of tests) {
  const dp = t.metric === 'cost' ? 5 : 3;
  console.log(`| ${t.comparison} | ${t.metric} | ${t.n} | ${t.a.toFixed(dp)} | ${t.b.toFixed(dp)} | ${t.d.toFixed(dp)} | ${t.rel != null ? (100 * t.rel).toFixed(1) : '—'} | [${t.lo.toFixed(dp)}, ${t.hi.toFixed(dp)}] | ${t.p < 0.001 ? '<0.001' : t.p.toFixed(3)} | ${t.q < 0.001 ? '<0.001' : t.q.toFixed(3)} | ${t.q < 0.05 ? '**sig**' : ''} |`);
}
