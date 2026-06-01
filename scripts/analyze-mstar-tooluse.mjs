#!/usr/bin/env node
/**
 * M* tool-use profile — what tools does Mstar actually reach for, and how do they fare?
 * Reads every captured Mstar trajectory across dev-40 + reverify + rotation-13, classifies
 * each Bash invocation by its leading executable (splitting on && ; so chains count separately;
 * a pipe like `ss-grep x | head` is classified by the segment's first token = ss-grep).
 *
 *   node scripts/analyze-mstar-tooluse.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(REPO, 'core/prompt-optimization/data/results');

// corpus: file → label (so we can split dev vs rotation)
const FILES = [
  ['dev40-PM-trajectories.json', 'dev40'],
  ['Mstar-reverify.json', 'dev40'],
  ['rot13-PMA-trajectories.json', 'rotation'],
];

const SS = ['ss-search', 'ss-find', 'ss-grep', 'ss-semantic', 'ss-trace', 'ss-read'];
const RAW = ['grep', 'rg', 'egrep', 'fgrep', 'find', 'fd', 'cat', 'less', 'more', 'ls', 'head', 'tail', 'sed', 'awk', 'wc', 'tree', 'nl', 'cut', 'sort', 'uniq'];

// classify ONE shell segment (already split on && ; ) by its first token
function classifySeg(seg) {
  const t = seg.trim().split(/\s+/)[0] || '';
  const base = t.replace(/^.*\//, ''); // strip any path prefix
  if (SS.includes(base)) return base;
  if (RAW.includes(base)) return `raw:${base}`;
  if (base === '') return null;
  return `other:${base}`;
}

// a Bash command can chain: split on && ; (NOT | — pipe stays with its head command)
function classifyCommand(cmd) {
  if (typeof cmd !== 'string') return [];
  return cmd
    .split(/&&|\|\||;/)
    .map(classifySeg)
    .filter(Boolean);
}

const runs = [];
for (const [f, corpus] of FILES) {
  const p = path.join(RES, f);
  if (!fs.existsSync(p)) continue;
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const r of d.runs || []) {
    if (r.cand !== 'Mstar') continue;
    const tools = (r.toolCalls || []).flatMap((c) => classifyCommand(c.input?.command));
    runs.push({ corpus, target: r.target, stratum: r.stratum, probeId: r.probeId, rep: r.rep, score: r.score, callCount: r.callCount, tools });
  }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '—');

// canonical tool order for display
const ORDER = [...SS, 'raw'];
function bucket(tool) {
  if (SS.includes(tool)) return tool;
  if (tool.startsWith('raw:')) return 'raw';
  return 'other';
}

function profile(label, rs) {
  if (!rs.length) return;
  const totalCalls = rs.reduce((s, r) => s + r.tools.length, 0);
  // total invocations per bucket
  const inv = {}; const runsUsing = {};
  for (const t of [...ORDER, 'other']) { inv[t] = 0; runsUsing[t] = 0; }
  for (const r of rs) {
    const seen = new Set();
    for (const t of r.tools) { const b = bucket(t); inv[b]++; seen.add(b); }
    for (const b of seen) runsUsing[b]++;
  }
  console.log(`\n━━━ ${label}  (runs=${rs.length}, total tool-calls=${totalCalls}, mean calls/run=${(totalCalls / rs.length).toFixed(2)}, mean score=${mean(rs.map((r) => r.score)).toFixed(3)}) ━━━`);
  console.log('  tool          invocations   %of-calls   runs-using   %of-runs');
  for (const t of [...ORDER, 'other']) {
    if (inv[t] === 0 && runsUsing[t] === 0) continue;
    console.log(`  ${t.padEnd(13)} ${String(inv[t]).padStart(8)}     ${pct(inv[t], totalCalls).padStart(7)}    ${String(runsUsing[t]).padStart(8)}     ${pct(runsUsing[t], rs.length).padStart(7)}`);
  }
}

console.log(`M* TOOL-USE PROFILE — ${runs.length} Mstar runs total`);

// 1) overall, then per target
profile('ALL', runs);
for (const tg of ['sonnet', 'gpt5_5']) profile(`target=${tg}`, runs.filter((r) => r.target === tg));

// 2) per stratum (sonnet only — the binding target)
console.log('\n\n=========== PER-STRATUM (sonnet only — the binding/priced target) ===========');
const strata = [...new Set(runs.map((r) => r.stratum))];
for (const s of strata) profile(`stratum=${s}`, runs.filter((r) => r.target === 'sonnet' && r.stratum === s));

// 3) dev vs rotation generalization (sonnet)
console.log('\n\n=========== DEV vs ROTATION (sonnet) ===========');
for (const c of ['dev40', 'rotation']) profile(`corpus=${c}`, runs.filter((r) => r.target === 'sonnet' && r.corpus === c));

// 4) "how do ss-find / ss-search / ss-trace / ss-semantic FARE" — score+calls of runs that used each (sonnet)
console.log('\n\n=========== EFFECTIVENESS: runs (sonnet) that invoked each tool ≥once ===========');
console.log('  tool          n-runs   mean-score   mean-calls   (vs runs that did NOT use it)');
const son = runs.filter((r) => r.target === 'sonnet');
for (const t of SS) {
  const used = son.filter((r) => r.tools.some((x) => x === t));
  const notUsed = son.filter((r) => !r.tools.some((x) => x === t));
  if (!used.length) { console.log(`  ${t.padEnd(13)} ${String(0).padStart(6)}   (never used)`); continue; }
  console.log(`  ${t.padEnd(13)} ${String(used.length).padStart(6)}    ${mean(used.map((r) => r.score)).toFixed(3)}        ${mean(used.map((r) => r.callCount)).toFixed(2)}        (not-used: score=${mean(notUsed.map((r) => r.score)).toFixed(3)} calls=${mean(notUsed.map((r) => r.callCount)).toFixed(2)} n=${notUsed.length})`);
}

// 5) which probes ever triggered ss-trace / ss-semantic / ss-find (sonnet) — the "rare tool" map
console.log('\n\n=========== WHICH PROBES TRIGGER THE RARE TOOLS (sonnet, any rep) ===========');
for (const t of ['ss-trace', 'ss-semantic', 'ss-find']) {
  const probes = [...new Set(son.filter((r) => r.tools.includes(t)).map((r) => `${r.probeId}(${r.stratum})`))].sort();
  console.log(`  ${t}: ${probes.length ? probes.join(', ') : '— NONE —'}`);
}
