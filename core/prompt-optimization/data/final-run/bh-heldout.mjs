#!/usr/bin/env node
// bh-heldout.mjs — Benjamini–Hochberg over the held-out cells × primary metrics (aggregates only).
//
//   node core/prompt-optimization/data/final-run/bh-heldout.mjs [--tag ho1005] [--cells a,b] [--boot 20000] [--q 0.05]
//
// Unit = question: an arm's value = mean over its reps (same as analyze.mjs). Contrast = sweet − native,
// relative effect = ratio of means − 1. Paired question-clustered bootstrap, resampling within tier
// (easy / hard), B = 20000, seed 42. Two-sided p = min(1, 2 × share of bootstrap differences on the far
// side of 0), floored at 1/B. BH at q across every cell × metric. Prints no per-question value.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.resolve(HERE, '../results');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
const TAG = flag('--tag', 'ho1005');
const CELLS = flag('--cells', 'cc-sonnet55-high,cc-opus55-medium,cc-opus55-high,oc-sol61-high,codex-sol61-high').split(',');
const B = Number(flag('--boot', 20000));
const Q = Number(flag('--q', 0.05));
const METRICS = [['score', r => r.score], ['costBilled', r => r.costRealizedUsd], ['costNoCache', r => r.costNaiveUsd], ['calls', r => r.calls]];

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const tierOf = (id) => (id.startsWith('r3h') ? 'hard' : 'easy');

const tests = [];
for (const cell of CELLS) {
  const dirs = fs.readdirSync(RESULTS).filter(d => d.startsWith(`r282-${cell}-${TAG}-r`) && /-r\d+$/.test(d.slice(`r282-${cell}-${TAG}`.length)));
  const rows = new Map();   // arm|rep|id → ok row (a resumed run keeps the ok row)
  for (const d of dirs) {
    const rep = /-r(\d+)$/.exec(d)[1];
    for (const l of fs.readFileSync(path.join(RESULTS, d, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l);
      if (r.warmup || r.error || r.exitCode !== 0) continue;
      rows.set(`${r.arm}|${rep}|${r.id}`, r);
    }
  }
  for (const [m, get] of METRICS) {
    const per = new Map();   // id → { sweet: [], native: [] }
    for (const [k, r] of rows) {
      const [arm, , id] = k.split('|'); const v = get(r);
      if (!fin(v) || (arm !== 'sweet' && arm !== 'native')) continue;
      if (!per.has(id)) per.set(id, { sweet: [], native: [] });
      per.get(id)[arm].push(v);
    }
    const qs = [...per.entries()].filter(([, e]) => e.sweet.length && e.native.length)
      .map(([id, e]) => ({ tier: tierOf(id), a: mean(e.sweet), b: mean(e.native) }));
    const byTier = { easy: qs.filter(x => x.tier === 'easy'), hard: qs.filter(x => x.tier === 'hard') };
    const diff = mean(qs.map(x => x.a - x.b));
    const rel = mean(qs.map(x => x.a)) / mean(qs.map(x => x.b)) - 1;
    const rnd = mulberry32(42); let le = 0, ge = 0; const boots = [];
    for (let i = 0; i < B; i++) {
      let sa = 0, sb = 0, n = 0;
      for (const t of Object.values(byTier)) for (let j = 0; j < t.length; j++) { const x = t[Math.floor(rnd() * t.length)]; sa += x.a; sb += x.b; n++; }
      const d = (sa - sb) / n; boots.push(sb ? sa / sb - 1 : NaN);
      if (d <= 0) le++; if (d >= 0) ge++;
    }
    boots.sort((x, y) => x - y);
    const p = Math.max(1 / B, Math.min(1, 2 * Math.min(le, ge) / B));
    tests.push({ cell, metric: m, n: qs.length, diff, rel, ci: [boots[Math.floor(0.025 * B)], boots[Math.floor(0.975 * B)]], p });
  }
}
// Benjamini–Hochberg (step-up), q-values = adjusted p.
const sorted = tests.map((t, i) => ({ i, p: t.p })).sort((x, y) => x.p - y.p);
const m = tests.length; let prev = 1;
for (let k = m - 1; k >= 0; k--) { const adj = Math.min(prev, sorted[k].p * m / (k + 1)); tests[sorted[k].i].q = adj; prev = adj; }
const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const fmtp = (v) => (v < 0.001 ? '<0.001' : v.toFixed(3));
console.log(`# BH correction — held-out ${TAG}, ${CELLS.length} cells × ${METRICS.length} metrics = ${m} tests, q = ${Q}, B = ${B}, seed 42\n`);
console.log('| Cell | Metric | n | Sweet − native (rel) | 95% CI (rel) | p | BH q | |');
console.log('|---|---|---|---|---|---|---|---|');
for (const t of tests) console.log(`| ${t.cell} | ${t.metric} | ${t.n} | ${pct(t.rel)} | [${pct(t.ci[0])}, ${pct(t.ci[1])}] | ${fmtp(t.p)} | ${fmtp(t.q)} | ${t.q < Q ? '**sig**' : ''} |`);
console.log(`\n${tests.filter(t => t.q < Q).length} of ${m} tests significant after BH at q = ${Q}.`);
