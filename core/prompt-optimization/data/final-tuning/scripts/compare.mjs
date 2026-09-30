#!/usr/bin/env node
// compare.mjs <cell> <baseTag> <variantTag> [--base2 <tag>] [--native-r282]
// Paired (by probe id) variant − base on the rows both runs finished. Stratified bootstrap by set,
// B = 20000, seed 42 (same as the runner). Prints the §6.2 screen verdict inputs.
// --base2: a second baseline run (test-retest) → also prints base2 − base (the real noise).
// --native-r282: also prints each run vs the r282 NATIVE arm on the same ids (time drift caveat).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const RES = path.join(WT, 'core/prompt-optimization/data/results');
const R282 = '/Users/admin/Projects/sweet-search-private/core/prompt-optimization/data/results';
const [cell, baseTag, varTag] = process.argv.slice(2);
const flag = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const load = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => !r.error && r.exitCode === 0) : [];
const run = (tag, arm = null) => {
  const dir = path.join(RES, `r282-${cell}-${tag}`);
  const rows = load(path.join(dir, 'runs.jsonl')).filter(r => (arm ? r.arm === arm : r.arm !== 'sweetB'));
  const m = new Map(rows.map(r => [r.id, r]));
  // accOR: accuracy re-judged with the OpenRouter DeepSeek route (rescore.mjs); only complete panels.
  const f = path.join(dir, 'rescore-or.jsonl');
  if (fs.existsSync(f)) for (const x of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)) {
    const r = m.get(x.id); if (r && (x.arm || 'sweet') === r.arm && (x.judgesOk || []).length === 3) r.accOR = x.score;
  }
  return m;
};
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function bootCI(pairs, B = 20000, seed = 42) {
  const bySet = new Map(); for (const p of pairs) { if (!bySet.has(p.set)) bySet.set(p.set, []); bySet.get(p.set).push(p.d); }
  const rnd = mulberry32(seed); const ms = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (const ds of bySet.values()) for (let j = 0; j < ds.length; j++) { s += ds[Math.floor(rnd() * ds.length)]; n++; } ms.push(s / n); }
  ms.sort((x, y) => x - y); return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]];
}
const cw = r => r.usage?.cache_creation_input_tokens ?? null;
const turns = r => r.usage?.turns ?? r.usage?.num_turns ?? null;
const METRICS = [
  ['accuracy', r => r.score, 3], ['accOR', r => r.accOR, 3], ['cost$', r => r.costRealizedUsd, 5], ['naive$', r => r.costNaiveUsd, 5],
  ['calls', r => r.calls, 2], ['turns', turns, 2], ['ssCalls', r => r.ssCalls, 2],
  ['ssDelivTok', r => r.ssDeliveredTokens, 0], ['rawLen', r => r.rawLen, 0], ['cacheWrite', cw, 0],
  ['nativeSearch', r => r.nativeSearchCalls, 2], ['wallSec', r => r.wallMs / 1000, 1],
  ['judges<3', r => ((r.judgesOk || []).length < 3 ? 1 : 0), 2],
];
function compare(label, A, B) {
  const ids = [...B.keys()].filter(k => A.has(k));
  console.log(`\n### ${label}  (paired n=${ids.length})`);
  console.log('| metric | A | B | Δ (B−A) | Δ% | 95% CI | sig |'); console.log('|---|---|---|---|---|---|---|');
  const out = {};
  for (const [name, f, dp] of METRICS) {
    const pairs = ids.map(id => ({ set: B.get(id).set, a: f(A.get(id)), b: f(B.get(id)) })).filter(p => Number.isFinite(p.a) && Number.isFinite(p.b));
    if (pairs.length < 5) continue;
    const ds = pairs.map(p => ({ set: p.set, d: p.b - p.a })); const [lo, hi] = bootCI(ds);
    const ma = mean(pairs.map(p => p.a)), mb = mean(pairs.map(p => p.b));
    out[name] = { a: ma, b: mb, d: mb - ma, lo, hi, n: pairs.length };
    console.log(`| ${name} | ${ma.toFixed(dp)} | ${mb.toFixed(dp)} | ${(mb - ma).toFixed(dp)} | ${ma ? ((mb - ma) / ma * 100).toFixed(1) : '—'} | [${lo.toFixed(dp)}, ${hi.toFixed(dp)}] | ${lo > 0 || hi < 0 ? '*' : ''} |`);
  }
  return out;
}
// --within: baseTag is ONE interleaved run; compare its arm `sweet` (A) with arm `sweetB` (B).
const WITHIN = process.argv.includes('--within');
const base = WITHIN ? run(baseTag, 'sweet') : run(baseTag), variant = WITHIN ? run(baseTag, 'sweetB') : run(varTag);
console.log(`# ${cell}: ${varTag} vs ${baseTag}`);
const res = compare(`B=${varTag} vs A=${baseTag}`, base, variant);
const b2 = flag('--base2');
if (b2) compare(`test-retest: B=${b2} vs A=${baseTag}`, base, run(b2));
if (process.argv.includes('--native-r282')) {
  const nat = new Map(load(path.join(R282, `r282-${cell}`, 'runs.jsonl')).filter(r => r.arm === 'native').map(r => [r.id, r]));
  compare(`B=${baseTag} vs A=r282 native (different time)`, nat, base);
  if (varTag !== baseTag) compare(`B=${varTag} vs A=r282 native (different time)`, nat, variant);
}
// §6.2 verdict inputs
if (res['cost$'] && (res.accOR || res.accuracy)) {
  const c = res['cost$'], a = res.accOR || res.accuracy;
  console.log(`\nverdict inputs: cost CI below 0: ${c.hi < 0}; accuracy lower CI > −0.02: ${a.lo > -0.02}; calls rise sig: ${res.calls?.lo > 0}`);
}
