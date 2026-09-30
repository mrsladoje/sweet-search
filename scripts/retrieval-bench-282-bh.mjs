import fs from 'node:fs';
const R = new URL('../core/prompt-optimization/data/results', import.meta.url).pathname;
const CELLS = ['cc-sonnet55-high','cc-opus55-medium','codex-sol61-high','oc-sol61-high','oc-dsflash41'];
const MET = [['accuracy', r => r.score], ['cost$', r => r.costRealizedUsd], ['calls', r => r.calls], ['content', r => r.content]];
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function boot(pairs, B = 20000, seed = 42) {
  const bySet = new Map(); for (const p of pairs) { if (!bySet.has(p.set)) bySet.set(p.set, []); bySet.get(p.set).push(p.d); }
  const rnd = mulberry32(seed); const ms = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (const ds of bySet.values()) for (let j = 0; j < ds.length; j++) { s += ds[Math.floor(rnd() * ds.length)]; n++; } ms.push(s / n); }
  ms.sort((x, y) => x - y);
  const le = ms.filter(x => x <= 0).length / B, ge = ms.filter(x => x >= 0).length / B;
  return { lo: ms[Math.floor(0.025 * B)], hi: ms[Math.floor(0.975 * B)], p: Math.min(1, 2 * Math.min(le, ge)) };
}
const tests = [];
for (const c of CELLS) {
  const rows = fs.readFileSync(`${R}/r282-${c}/runs.jsonl`, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => !r.error && r.exitCode === 0);
  const nat = new Map(rows.filter(r => r.arm === 'native').map(r => [r.id, r])), sw = new Map(rows.filter(r => r.arm === 'sweet').map(r => [r.id, r]));
  const ids = [...sw.keys()].filter(k => nat.has(k));
  for (const [m, f] of MET) {
    const pairs = ids.map(id => ({ set: sw.get(id).set, a: f(sw.get(id)), b: f(nat.get(id)) })).filter(p => Number.isFinite(p.a) && Number.isFinite(p.b));
    const na = pairs.reduce((s, p) => s + p.b, 0) / pairs.length, sa = pairs.reduce((s, p) => s + p.a, 0) / pairs.length;
    const b = boot(pairs.map(p => ({ set: p.set, d: p.a - p.b })));
    tests.push({ cell: c, m, n: pairs.length, na, sa, rel: (sa - na) / na * 100, ...b });
  }
}
const m = tests.length; const sorted = [...tests].sort((a, b) => a.p - b.p);
let prev = 1; for (let i = m - 1; i >= 0; i--) { prev = Math.min(prev, sorted[i].p * m / (i + 1)); sorted[i].q = prev; }
console.log('cell               metric    n    native     sweet      rel%     95% CI                 p       q     BH');
for (const t of tests) console.log(`${t.cell.padEnd(18)} ${t.m.padEnd(8)} ${t.n}  ${t.na.toFixed(4).padStart(8)}  ${t.sa.toFixed(4).padStart(8)}  ${t.rel.toFixed(1).padStart(6)}  [${t.lo.toFixed(4)}, ${t.hi.toFixed(4)}]  ${t.p.toFixed(4)}  ${t.q.toFixed(4)}  ${t.q < 0.05 ? 'SIG' : ''}`);
