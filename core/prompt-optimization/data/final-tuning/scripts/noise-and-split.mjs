#!/usr/bin/env node
// Final tuning, phase 0/3: (1) the r282 noise floor, (2) the frozen train 78 / validation 52 split.
//   node core/prompt-optimization/data/final-tuning/scripts/noise-and-split.mjs
// Reads r282 rows from the MAIN checkout (results are gitignored and live there).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const MAIN = '/Users/admin/Projects/sweet-search-private';
const CELLS = ['oc-dsflash41', 'oc-sol61-high', 'codex-sol61-high', 'cc-sonnet55-high', 'cc-opus55-medium'];

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb); };

// ── split ──
const SETS = [['vault', 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'], ['heldout', 'core/prompt-optimization/data/frozen/p7-heldout-probes.json'], ['ood', 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json']];
const probes = SETS.flatMap(([set, rel]) => { const raw = JSON.parse(fs.readFileSync(path.join(WT, rel), 'utf8')); return (Array.isArray(raw) ? raw : raw.probes).map(p => ({ id: p.id, set, lang: p.language })); });
const rnd = mulberry32(42);
const train = [], validation = [];
for (const [set] of SETS) {
  const ps = probes.filter(p => p.set === set).map(p => ({ ...p, r: rnd() }));
  // order: language, then a seeded random key → systematic 60% sampling keeps each language ~60/40
  ps.sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || a.r - b.r);
  const off = rnd();
  ps.forEach((p, i) => (Math.floor((i + 1) * 0.6 + off) > Math.floor(i * 0.6 + off) ? train : validation).push(p.id));
}
const split = { seed: 42, method: 'per set: sort by language then seeded random; systematic 60% with seeded offset', n: { train: train.length, validation: validation.length }, train: train.sort(), validation: validation.sort() };
const splitPath = path.join(HERE, '../r282-split.json');
fs.writeFileSync(splitPath, JSON.stringify(split, null, 2) + '\n');
const sha = crypto.createHash('sha256').update(fs.readFileSync(splitPath)).digest('hex');
console.log(`split: train ${train.length} validation ${validation.length}  sha256 ${sha}`);
for (const [set] of SETS) console.log(`  ${set}: train ${probes.filter(p => p.set === set && train.includes(p.id)).length} val ${probes.filter(p => p.set === set && validation.includes(p.id)).length}`);

// ── noise floor ──
// Paired MDE (80% power, two-sided α=0.05) = 2.80 × SD(d) / √n. SD(d) of a variant-vs-baseline
// re-run is unknown until the test-retest; two bounds are reported:
//   indep  = √2 × SD(sweet)                (no within-question correlation — pessimistic)
//   xarm   = SD(sweet − native)             (arms differ by the whole product — also pessimistic)
// The test-retest (phase 3 step 2) replaces both.
const lines = ['| Cell | Metric | Sweet mean | SD | MDE n=78 (indep) | MDE n=78 (xarm) | MDE n=52 (indep) | MDE n=52 (xarm) | ρ(native,sweet) |', '|---|---|---|---|---|---|---|---|---|'];
for (const cell of CELLS) {
  const rows = fs.readFileSync(path.join(MAIN, `core/prompt-optimization/data/results/r282-${cell}/runs.jsonl`), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => !r.error && r.exitCode === 0);
  const sw = new Map(rows.filter(r => r.arm === 'sweet').map(r => [r.id, r])), na = new Map(rows.filter(r => r.arm === 'native').map(r => [r.id, r]));
  const ids = [...sw.keys()].filter(k => na.has(k));
  for (const [name, f] of [['cost$', r => r.costRealizedUsd], ['calls', r => r.calls], ['accuracy', r => r.score]]) {
    const s = ids.map(i => f(sw.get(i))), n = ids.map(i => f(na.get(i)));
    const m = mean(s), S = sd(s), Sx = sd(s.map((x, i) => x - n[i])), rho = corr(s, n);
    const fmt = v => name === 'cost$' ? `${v.toFixed(5)} (${(100 * v / m).toFixed(0)}%)` : name === 'accuracy' ? `${(100 * v).toFixed(1)} pt` : `${v.toFixed(2)} (${(100 * v / m).toFixed(0)}%)`;
    const mde = (sdd, k) => 2.8 * sdd / Math.sqrt(k);
    lines.push(`| ${cell} | ${name} | ${name === 'cost$' ? m.toFixed(5) : m.toFixed(3)} | ${name === 'cost$' ? S.toFixed(5) : S.toFixed(3)} | ${fmt(mde(Math.SQRT2 * S, 78))} | ${fmt(mde(Sx, 78))} | ${fmt(mde(Math.SQRT2 * S, 52))} | ${fmt(mde(Sx, 52))} | ${rho.toFixed(2)} |`);
  }
}
const out = lines.join('\n');
fs.writeFileSync(path.join(HERE, '../noise-floor.md'), `# r282 noise floor (sweet arm), 2026-10-01\n\nPaired MDE = 2.80 × SD(d)/√n (80% power, α = 0.05 two-sided). Two pessimistic bounds for SD(d) until the test-retest exists: indep = √2·SD(sweet); xarm = SD(sweet − native). Percent = of the sweet mean.\n\n${out}\n`);
console.log(out);
