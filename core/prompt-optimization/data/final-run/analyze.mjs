#!/usr/bin/env node
// analyze.mjs — PLAN.md §7.5 report for the final before / after / native comparison.
//
//   node core/prompt-optimization/data/final-run/analyze.mjs [--tag final] [--cells a,b] [--out report.json] [--swings 5]
//
// Reads core/prompt-optimization/data/results/r282-<cell>-<tag>-r<rep>/runs.jsonl (warm-ups excluded).
// Arms: after = bench arm `sweet` (final checkout), before = `before` (d013b492 checkout), native.
// Per harness (cell) and tier (easy, hard, pooled):
//   score, calls, cost billed (costRealizedUsd: cache-aware, token × list price), cost without cache
//   (costNaiveUsd: every input token at the full input price), wall time.
// The unit is the QUESTION: an arm's value for a question = mean over its reps (sweet arms 2, native 1).
// Contrasts after − before and after − native: mean difference and ratio of means − 1, with 95%
// question-clustered percentile bootstrap intervals (questions resampled with replacement, within tier
// for the pooled scope; B = 10000, seed 42). Only questions where both arms have an ok row count.
// This is a DEV set: the per-question swing list is allowed (trace reading, §7.5).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.resolve(process.argv.includes('--results') ? process.argv[process.argv.indexOf('--results') + 1] : path.join(HERE, '../results'));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
const TAG = flag('--tag', 'final');
const CELLS = String(flag('--cells', 'cc-opus55-medium,codex-sol61-high,oc-sol61-high')).split(',').filter(Boolean);
const OUT = flag('--out', null);
const SWINGS = Number(flag('--swings', 5));
const B = Number(flag('--boot', 10000));
const ARM_NAME = { sweet: 'after', before: 'before', native: 'native' };
const METRICS = [
  ['score', r => r.score, 'pt'],
  ['calls', r => r.calls, 'n'],
  ['costBilled', r => r.costRealizedUsd, '$'],
  ['costNoCache', r => r.costNaiveUsd, '$'],
  ['wallSec', r => (r.wallMs != null ? r.wallMs / 1000 : null), 's'],
];
const CONTRASTS = [['after', 'before'], ['after', 'native']];

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

function loadCell(cell) {
  const dirs = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter(d => d.startsWith(`r282-${cell}-${TAG}-r`)) : [];
  const rows = [], summaries = [];
  for (const d of dirs.sort()) {
    const rep = Number(/-r(\d+)$/.exec(d)?.[1]);
    const f = path.join(RESULTS, d, 'runs.jsonl');
    if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l);
      if (r.warmup === true || r.id === '__warmup__') continue;
      rows.push({ ...r, rep, dir: d, armName: ARM_NAME[r.arm] ?? r.arm });
    }
    const s = path.join(RESULTS, d, 'summary.json');
    if (fs.existsSync(s)) summaries.push({ dir: d, ...JSON.parse(fs.readFileSync(s, 'utf8')) });
  }
  return { dirs, rows, summaries };
}

// A failed rollout that a later resume re-ran leaves an error row AND an ok row: keep the ok row per (arm, rep, id).
function okRows(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = `${r.armName}|${r.rep}|${r.id}`;
    const ok = !r.error && r.exitCode === 0;
    if (ok) best.set(k, r); else if (!best.has(k)) best.set(k, null);
  }
  return [...best.values()].filter(Boolean);
}

// question → arm → { tier, metric means over reps }
function perQuestion(rows) {
  const q = new Map();
  for (const r of rows) {
    if (!q.has(r.id)) q.set(r.id, { tier: r.set, arms: {} });
    const e = q.get(r.id); (e.arms[r.armName] ||= []).push(r);
  }
  for (const e of q.values()) for (const [a, rs] of Object.entries(e.arms)) {
    e.arms[a] = Object.fromEntries(METRICS.map(([m, f]) => { const v = rs.map(f).filter(fin); return [m, v.length ? mean(v) : NaN]; }));
    e.arms[a].reps = rs.length;
  }
  return q;
}

function contrast(q, a, b, metric, tiers, seed = 42) {
  const items = [...q.entries()].filter(([, e]) => tiers.includes(e.tier) && fin(e.arms[a]?.[metric]) && fin(e.arms[b]?.[metric]))
    .map(([id, e]) => ({ id, tier: e.tier, x: e.arms[a][metric], y: e.arms[b][metric] }));
  if (!items.length) return null;
  const stat = (its) => { const mx = mean(its.map(i => i.x)), my = mean(its.map(i => i.y)); return { diff: mx - my, rel: my ? mx / my - 1 : NaN, mx, my }; };
  const point = stat(items);
  const byTier = new Map(); for (const i of items) { if (!byTier.has(i.tier)) byTier.set(i.tier, []); byTier.get(i.tier).push(i); }
  const rnd = mulberry32(seed); const diffs = [], rels = [];
  for (let k = 0; k < B; k++) {
    const s = []; for (const g of byTier.values()) for (let j = 0; j < g.length; j++) s.push(g[Math.floor(rnd() * g.length)]);
    const st = stat(s); diffs.push(st.diff); rels.push(st.rel);
  }
  const ci = (v) => { const w = v.filter(fin).sort((x, y) => x - y); return [w[Math.floor(0.025 * w.length)], w[Math.min(w.length - 1, Math.floor(0.975 * w.length))]]; };
  return { n: items.length, ...point, diffCI: ci(diffs), relCI: ci(rels) };
}

const fmt = (m, v) => (!fin(v) ? '—' : m.startsWith('cost') ? `$${v.toFixed(4)}` : m === 'score' ? v.toFixed(3) : v.toFixed(1));
const pct = (v) => (fin(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '—');
const report = { tag: TAG, generatedAt: new Date().toISOString(), boot: B, cells: {} };
console.log(`# Final comparison (${TAG}) — before vs after vs native\n`);
console.log('Unit = question (mean over reps). Intervals: 95% question-clustered bootstrap, stratified by tier for "pooled". `*` = interval excludes 0.\n');

for (const cell of CELLS) {
  const { dirs, rows, summaries } = loadCell(cell);
  if (!rows.length) { console.log(`## ${cell}\n\nno rows (${dirs.length} dirs)\n`); continue; }
  const ok = okRows(rows);
  const failed = rows.length - rows.filter(r => !r.error && r.exitCode === 0).length;
  const prov = {};
  for (const r of ok) {
    const p = (prov[r.armName] ||= { gitCommit: new Set(), benchCommit: new Set(), gutter: new Set(), indexCommit: new Set(), harnessVersion: new Set(), captureVersion: new Set() });
    for (const k of Object.keys(p)) p[k].add(String(r[k] ?? '—'));
  }
  const provOut = Object.fromEntries(Object.entries(prov).map(([a, p]) => [a, Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v]]))]));
  const benchCommits = new Set(ok.map(r => r.benchCommit ?? r.gitCommit));
  const q = perQuestion(ok);
  const cellOut = { dirs, rows: rows.length, okRows: ok.length, failedRows: failed, provenance: provOut, cacheFairness: summaries.map(s => ({ dir: s.dir, status: s.cacheFairness?.status ?? null })), scopes: {} };
  console.log(`## ${cell}\n`);
  console.log(`rows ${rows.length} (ok ${ok.length}, failed attempts ${failed}) from ${dirs.join(', ')}`);
  for (const [a, p] of Object.entries(provOut)) console.log(`- ${a}: code ${p.gitCommit.map(c => c.slice(0, 8)).join('+')} | index ${p.indexCommit.map(c => c.slice(0, 8)).join('+')} | gutter ${p.gutter.join('+')} | harness ${p.harnessVersion.join('+')}${p.gitCommit.length > 1 ? '  **MIXED CODE — do not pool**' : ''}`);
  if (benchCommits.size > 1) console.log(`- **bench code differs between rows (${[...benchCommits].map(c => c.slice(0, 8)).join(', ')}) — arms were not judged/costed by the same bench**`);
  for (const s of cellOut.cacheFairness) if (s.status && s.status !== 'fair' && s.status !== 'ok') console.log(`- cache fairness ${s.dir}: ${s.status}`);
  const reps = {}; for (const r of ok) { const k = r.armName; reps[k] ||= {}; reps[k][r.rep] = (reps[k][r.rep] || 0) + 1; }
  console.log(`- ok rollouts per arm × rep: ${Object.entries(reps).map(([a, o]) => `${a} ${Object.entries(o).map(([rp, n]) => `r${rp}=${n}`).join(' ')}`).join('; ')}\n`);
  for (const [scope, tiers] of [['easy', ['easy']], ['hard', ['hard']], ['pooled', ['easy', 'hard']]]) {
    const sc = (cellOut.scopes[scope] = { means: {}, contrasts: {} });
    const nq = [...q.values()].filter(e => tiers.includes(e.tier)).length;
    console.log(`### ${scope} (${nq} questions)\n`);
    console.log('| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const [m] of METRICS) {
      const armMean = (a) => mean([...q.values()].filter(e => tiers.includes(e.tier) && fin(e.arms[a]?.[m])).map(e => e.arms[a][m]));
      sc.means[m] = { before: armMean('before'), after: armMean('after'), native: armMean('native') };
      const cells = [];
      for (const [a, b] of CONTRASTS) {
        const c = contrast(q, a, b, m, tiers);
        sc.contrasts[`${a}-${b}`] ||= {}; sc.contrasts[`${a}-${b}`][m] = c;
        if (!c) { cells.push('—', '—', '—'); continue; }
        const sig = c.diffCI[0] > 0 || c.diffCI[1] < 0 ? ' *' : '';
        cells.push(`${fmt(m, c.diff)}${sig} (n=${c.n})`, `[${fmt(m, c.diffCI[0])}, ${fmt(m, c.diffCI[1])}]`, `${pct(c.rel)} [${pct(c.relCI[0])}, ${pct(c.relCI[1])}]`);
      }
      console.log(`| ${m} | ${fmt(m, sc.means[m].before)} | ${fmt(m, sc.means[m].after)} | ${fmt(m, sc.means[m].native)} | ${cells.join(' | ')} |`);
    }
    console.log('');
  }
  // §7.5: the biggest swings, for trace reading (DEV questions only).
  const swings = (a, b, m) => [...q.entries()].filter(([, e]) => fin(e.arms[a]?.[m]) && fin(e.arms[b]?.[m]))
    .map(([id, e]) => ({ id, tier: e.tier, a: e.arms[a][m], b: e.arms[b][m], d: e.arms[a][m] - e.arms[b][m] }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, SWINGS);
  cellOut.swings = {};
  for (const [a, b] of CONTRASTS) for (const m of ['costBilled', 'score']) {
    const s = swings(a, b, m); cellOut.swings[`${a}-${b}:${m}`] = s;
    console.log(`Top ${SWINGS} ${m} swings ${a} − ${b}: ${s.map(x => `${x.id} (${x.tier}) ${fmt(m, x.b)}→${fmt(m, x.a)}`).join('; ')}`);
  }
  console.log(`Captures: ${dirs.map(d => path.join('core/prompt-optimization/data/results', d, 'captures')).join(', ')} (<arm>.<id>.json; arm sweet = after)\n`);
  report.cells[cell] = cellOut;
}
if (OUT) { fs.writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`); console.log(`wrote ${OUT}`); }
