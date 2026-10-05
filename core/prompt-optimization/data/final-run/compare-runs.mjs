#!/usr/bin/env node
// compare-runs.mjs — the same arm in two runs of the final-run question set (for example the 2026-10-05
// dev rerun `dev1005` against the 2026-10-04 final run `final`), paired by question.
//
//   node core/prompt-optimization/data/final-run/compare-runs.mjs --new dev1005 --old final [--cells a,b]
//     [--old-results <dir>]  (default: this checkout's results; the 10-04 run lives in sweet-search-final)
//
// Per cell: new sweet − old sweet (the code + index change), and new native − old native (the drift of
// the model, the judges and the subscription between the two runs: the noise floor for the first line).
// Unit = question (mean over reps); 95% question-clustered bootstrap stratified by tier (B 10000, seed 42).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, '../results');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
const NEW = flag('--new', 'dev1005'), OLD = flag('--old', 'final');
const OLD_RESULTS = path.resolve(flag('--old-results', RESULTS));
const CELLS = String(flag('--cells', 'cc-opus55-medium,codex-sol61-high,oc-sol61-high')).split(',');
const B = 10000;
const METRICS = [['score', r => r.score], ['calls', r => r.calls], ['costBilled', r => r.costRealizedUsd], ['costNoCache', r => r.costNaiveUsd]];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function load(cell, tag, arm, root = RESULTS) { // question → { tier, metric means over ok reps }
  const q = new Map();
  for (const d of fs.readdirSync(root).filter(x => x.startsWith(`r282-${cell}-${tag}-r`))) {
    const f = path.join(root, d, 'runs.jsonl'); if (!fs.existsSync(f)) continue;
    for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l);
      if (r.arm !== arm || r.error || r.exitCode !== 0 || r.warmup === true || r.id === '__warmup__') continue;
      if (!q.has(r.id)) q.set(r.id, { tier: r.set, rows: [] });
      q.get(r.id).rows.push(r);
    }
  }
  for (const e of q.values()) e.m = Object.fromEntries(METRICS.map(([m, f]) => [m, mean(e.rows.map(f).filter(fin))]));
  return q;
}

function contrast(a, b, m) {
  const items = [...a.entries()].filter(([id, e]) => b.has(id) && fin(e.m[m]) && fin(b.get(id).m[m])).map(([id, e]) => ({ tier: e.tier, x: e.m[m], y: b.get(id).m[m] }));
  if (!items.length) return null;
  const stat = (its) => { const mx = mean(its.map(i => i.x)), my = mean(its.map(i => i.y)); return { rel: mx / my - 1, mx, my }; };
  const groups = new Map(); for (const i of items) { if (!groups.has(i.tier)) groups.set(i.tier, []); groups.get(i.tier).push(i); }
  const rnd = mulberry32(42), rels = [];
  for (let k = 0; k < B; k++) { const s = []; for (const g of groups.values()) for (let j = 0; j < g.length; j++) s.push(g[Math.floor(rnd() * g.length)]); rels.push(stat(s).rel); }
  rels.sort((x, y) => x - y);
  return { n: items.length, ...stat(items), ci: [rels[Math.floor(0.025 * B)], rels[Math.floor(0.975 * B)]] };
}

const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const val = (m, v) => (m.startsWith('cost') ? `$${v.toFixed(4)}` : m === 'score' ? v.toFixed(3) : v.toFixed(1));
console.log(`# ${NEW} vs ${OLD}, same arm, paired by question\n`);
console.log('| Harness | Arm | Metric | old | new | new vs old | 95% CI |');
console.log('|---|---|---|---|---|---|---|');
for (const cell of CELLS) for (const arm of ['sweet', 'native']) {
  const a = load(cell, NEW, arm), b = load(cell, OLD, arm, OLD_RESULTS);
  for (const [m] of METRICS) {
    const c = contrast(a, b, m); if (!c) continue;
    const sig = c.ci[0] > 0 || c.ci[1] < 0 ? '*' : '';
    console.log(`| ${cell} | ${arm} | ${m} | ${val(m, c.my)} | ${val(m, c.mx)} | ${pct(c.rel)}${sig} (n=${c.n}) | [${pct(c.ci[0])}, ${pct(c.ci[1])}] |`);
  }
}
