#!/usr/bin/env node
// analyze.mjs <cx|cc> <name> — pooled micro-smoke read: B − A paired by (question, rep), bootstrap
// resampling QUESTIONS (reps of one question move together), B = 20000, seed 42.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RES = path.join(WT, 'core/prompt-optimization/data/results');
const [mode, name] = process.argv.slice(2);
const cell = mode === 'cx' ? 'codex-sol61-high' : 'cc-opus55-medium';
const load = d => { const f = path.join(RES, `r282-${cell}-${d}`, 'runs.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []; };
const dirs = fs.readdirSync(RES).filter(d => d.startsWith(`r282-${cell}-obs-${name}-`)).map(d => d.slice(`r282-${cell}-`.length));
const pairs = []; let errs = 0;
for (const d of dirs) {
  const rep = d.match(/-r(\d+)$/)?.[1];
  if (mode === 'cx') {
    const rows = load(d); const by = new Map();
    for (const r of rows) { if (r.error || r.exitCode !== 0) { errs++; continue; } (by.get(r.id) || by.set(r.id, {}).get(r.id))[r.arm] = r; }
    for (const [id, x] of by) if (x.sweet && x.sweetB) pairs.push({ id, rep, a: x.sweet, b: x.sweetB });
  } else if (/-A-r\d+$/.test(d)) {
    const A = new Map(load(d).filter(r => !r.error && r.exitCode === 0).map(r => [r.id, r]));
    const B = new Map(load(d.replace(/-A-r/, '-B-r')).filter(r => !r.error && r.exitCode === 0).map(r => [r.id, r]));
    for (const [id, a] of A) if (B.has(id)) pairs.push({ id, rep, a, b: B.get(id) });
  }
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const M = [['score', r => r.score, 3], ['cost$', r => r.costRealizedUsd, 4], ['naive$', r => r.costNaiveUsd, 4], ['calls', r => r.calls, 2],
  ['ssCalls', r => r.ssCalls, 2], ['ssDelivTok', r => r.ssDeliveredTokens, 0], ['nativeSearch', r => r.nativeSearchCalls, 2], ['wallSec', r => r.wallMs / 1000, 1]];
console.log(`${cell} obs-${name}: ${pairs.length} pairs over ${new Set(pairs.map(p => p.id)).size} questions, reps ${[...new Set(pairs.map(p => p.rep))].join(',')}, ${errs} error rows`);
console.log('| metric | A | B | Δ% | 95% CI of Δ% (question bootstrap) |'); console.log('|---|---|---|---|---|');
for (const [n, f, dp] of M) {
  const ps = pairs.map(p => ({ id: p.id, a: f(p.a), b: f(p.b) })).filter(p => Number.isFinite(p.a) && Number.isFinite(p.b));
  if (ps.length < 3) continue;
  const byQ = new Map(); for (const p of ps) (byQ.get(p.id) || byQ.set(p.id, []).get(p.id)).push(p);
  const qs = [...byQ.values()]; const r = rng(42); const ds = [];
  for (let i = 0; i < 20000; i++) { let sa = 0, sb = 0; for (let j = 0; j < qs.length; j++) { for (const p of qs[Math.floor(r() * qs.length)]) { sa += p.a; sb += p.b; } } ds.push(sa ? (sb - sa) / sa * 100 : 0); }
  ds.sort((x, y) => x - y);
  const ma = mean(ps.map(p => p.a)), mb = mean(ps.map(p => p.b));
  console.log(`| ${n} | ${ma.toFixed(dp)} | ${mb.toFixed(dp)} | ${ma ? ((mb - ma) / ma * 100).toFixed(1) : '—'} | [${ds[500].toFixed(1)}, ${ds[19500].toFixed(1)}] |`);
}
if (process.argv.includes('--per-q')) for (const p of pairs) console.log(`${p.id} r${p.rep} score ${p.a.score}→${p.b.score} cost ${p.a.costRealizedUsd?.toFixed(4)}→${p.b.costRealizedUsd?.toFixed(4)} calls ${p.a.calls}→${p.b.calls}`);
