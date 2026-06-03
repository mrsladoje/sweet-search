#!/usr/bin/env node
// Rigorous read-only stats on the completed Codex vault (no runs, no spend):
//  (1) paired (per-probe) bootstrap 95% CIs for M++−native on accuracy / calls / realized$ / cache-naive$
//      → answers "is the accuracy gap within noise?" and "are the call/cost wins robust?"
//  (2) wall-time mechanism: per-turn wall, and correlation of wall with tokens
//      → evidence on whether the wall-time gap is model-processing (token-driven) vs contention.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (r) => { const p = path.join(REPO, 'core/prompt-optimization/data/results', r, 'rows.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []; };
// Defaults = the Codex 4-shard vault (GPT-5.5 prices). Override via env for other cells, e.g. bare-API DeepSeek:
//   MPP_DIRS=ba-ds-vault-mpp NAT_DIRS=ba-ds-vault-native PRICE_IN=0.28 PRICE_OUT=0.42 PRICE_CACHE=0.028 node scripts/vault-stats.mjs
const MPP_DIRS = (process.env.MPP_DIRS || 'vault-cdx-mpp-s1,vault-cdx-mpp-s2,vault-cdx-mpp-s3,vault-cdx-mpp-s4').split(',');
const NAT_DIRS = (process.env.NAT_DIRS || 'vault-cdx-native-s1,vault-cdx-native-s2,vault-cdx-native-s3,vault-cdx-native-s4').split(',');
let mpp = [], nat = [];
for (const d of MPP_DIRS) mpp = mpp.concat(load(d));
for (const d of NAT_DIRS) nat = nat.concat(load(d));
// REPS=2,3 → restrict to those rep numbers (e.g. the clean DeepSeek-direct reps, excluding an OpenRouter rep1).
if (process.env.REPS) { const keep = new Set(process.env.REPS.split(',').map(Number)); mpp = mpp.filter((r) => keep.has(r.rep)); nat = nat.filter((r) => keep.has(r.rep)); }
const P = { inPerM: Number(process.env.PRICE_IN || 5), outPerM: Number(process.env.PRICE_OUT || 30), cacheReadPerM: Number(process.env.PRICE_CACHE || 0.50) };
const naive = (u) => !u ? 0 : ((u.input_tokens || 0) / 1e6) * P.inPerM + ((u.output_tokens || 0) / 1e6) * P.outPerM;
const real = (u) => { if (!u) return 0; const c = u.cached_input_tokens || 0; return (Math.max(0, (u.input_tokens || 0) - c) / 1e6) * P.inPerM + (c / 1e6) * P.cacheReadPerM + ((u.output_tokens || 0) / 1e6) * P.outPerM; };
const tok = (u) => !u ? 0 : (u.input_tokens || 0) + (u.output_tokens || 0);
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// group by probe id → per-probe mean of each metric, per arm
const byId = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.id)) m.set(r.id, []); m.get(r.id).push(r); } return m; };
const M = byId(mpp), N = byId(nat);
const ids = [...M.keys()].filter((id) => N.has(id));
const perProbe = ids.map((id) => {
  const m = M.get(id), n = N.get(id);
  const pm = (f) => mean(m.map(f)), pn = (f) => mean(n.map(f));
  return {
    id,
    dAcc: pm((x) => x.score || 0) - pn((x) => x.score || 0),
    dCalls: pm((x) => x.calls) - pn((x) => x.calls),
    dReal: pm((x) => real(x.usage)) - pn((x) => real(x.usage)),
    dNaive: pm((x) => naive(x.usage)) - pn((x) => naive(x.usage)),
  };
});
// paired bootstrap over probes
function bootCI(vals, B = 20000) {
  const n = vals.length, out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += vals[Math.floor(Math.random() * n)]; out.push(s / n); }
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]];
}
console.log('=== PAIRED (per-probe, n=' + ids.length + ') bootstrap 95% CI for M++ − native ===');
for (const [lbl, key, unit] of [['accuracy', 'dAcc', ''], ['tool calls', 'dCalls', ''], ['realized $/run', 'dReal', '$'], ['cache-naive $/run', 'dNaive', '$']]) {
  const v = perProbe.map((p) => p[key]); const m = mean(v); const [lo, hi] = bootCI(v);
  const crosses0 = lo < 0 && hi > 0;
  console.log('  ' + lbl.padEnd(18) + 'Δ=' + (m >= 0 ? '+' : '') + unit + m.toFixed(4) + '   95% CI [' + unit + lo.toFixed(4) + ', ' + unit + hi.toFixed(4) + ']   ' + (crosses0 ? 'WITHIN NOISE (CI crosses 0)' : 'SIGNIFICANT (CI excludes 0)'));
}
// wall-time mechanism
const pearson = (xs, ys) => { const n = xs.length, mx = mean(xs), my = mean(ys); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sx += (xs[i] - mx) ** 2; sy += (ys[i] - my) ** 2; } return sxy / Math.sqrt(sx * sy); };
console.log('\n=== WALL-TIME mechanism (is the gap tool-contention or model-processing-richer-output?) ===');
for (const [lbl, rows] of [['M++   ', mpp], ['native', nat]]) {
  const wall = rows.map((x) => (x.wallMs || 0) / 1000), calls = rows.map((x) => x.calls), toks = rows.map((x) => tok(x.usage));
  console.log('  ' + lbl + ' wall=' + mean(wall).toFixed(1) + 's  per-turn=' + (mean(wall) / mean(calls)).toFixed(1) + 's/call  meanTokens=' + Math.round(mean(toks)) + '  corr(wall,tokens)=' + pearson(wall, toks).toFixed(2) + '  corr(wall,calls)=' + pearson(wall, calls).toFixed(2));
}
console.log('\n  (high corr(wall,tokens) ⇒ wall is driven by the model processing richer output (REMOTE, a clean machine will NOT fix);');
console.log('   high corr(wall,calls) with low corr(wall,tokens) ⇒ wall is round-trip/contention driven (a clean machine WOULD help).)');
