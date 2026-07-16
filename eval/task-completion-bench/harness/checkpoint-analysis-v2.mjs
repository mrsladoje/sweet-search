#!/usr/bin/env node
// checkpoint-analysis-v2.mjs — repaired dev-checkpoint analysis (2026-07-09 env-honesty).
// Merges codex-dev-checkpoint-59 rows with codex-checkpoint-repair rows (repaired rows
// REPLACE the originals for re-run tasks), drops env-curation-broken tasks (ledger
// evidence), and reports STRATIFIED (random-45 vs watch-list — never mixed):
// resolution + CIs, idealCost/realized per arm per stratum, both-solved, per-language,
// same-53 comparison vs the unrepaired checkpoint, and the CLEAN L3 POOL NUMBER
// (fraction of idealCost on tasks neither arm resolves + top never-resolver tails,
// with a turns-after-last-test-improvement proxy from stored trajectories).
// DEV data — internal direction check, never publishable.
import { readFileSync } from 'node:fs';

const D = process.env.CKPT_DIR || '/root/sweet-search-private/eval/task-completion-bench/results/codex-dev-checkpoint-59';
const R = process.env.REPAIR_DIR || '/root/sweet-search-private/eval/task-completion-bench/results/codex-checkpoint-repair';
const SPECS = process.env.SPECS || '/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_multilingual.json';
const LEDGER = process.env.ENV_LEDGER || '/root/env-ledger/dev200/ledger.jsonl';

const lang = Object.fromEntries(JSON.parse(readFileSync(SPECS, 'utf8')).map(t => [t.instance_id, (t.language || '?').toLowerCase()]));
const ledger = new Map();
for (const l of readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean)) {
  try { const r = JSON.parse(l); ledger.set(r.instance_id, r.status); } catch { /* */ }
}

const WATCH = ['microsoft__kiota-3834', 'microformats__php-mf2-255', 'helm__helm-7381', 'webonyx__graphql-php-1382', 'bitshifter__glam-rs-382', 'fhir__sushi-1175', 'elixir-ecto__ecto-2438', 'randombit__botan-2738', 'thelounge__thelounge-2538', 'jeltef__derive_more-387', 'mgechev__revive-477', 'rstudio__gt-783', 'nodatime__nodatime-1808', 'jump-dev__jump.jl-2714'];

const orig = JSON.parse(readFileSync(`${D}/rows.json`, 'utf8'));
const rep = JSON.parse(readFileSync(`${R}/rows.json`, 'utf8'));
const repTasks = new Set(rep.map(r => r.taskId));

// merged clean set: repaired rows replace originals; curation-broken tasks dropped
const rows = [
  ...orig.filter(r => !repTasks.has(r.taskId) && ledger.get(r.taskId) === 'gold-valid' && !r.shimExcluded),
  ...rep.filter(r => !r.shimExcluded),
];
const dropped = [...new Set(orig.map(r => r.taskId))].filter(t => !repTasks.has(t) && ledger.get(t) !== 'gold-valid');
// integrity: a kept original row on a non-gold-valid env would be env noise
console.log(`# REPAIRED DEV CHECKPOINT (env-honest) — DEV DATA, NOT PUBLISHABLE`);
console.log(`kept-original tasks: ${new Set(orig.filter(r => !repTasks.has(r.taskId) && ledger.get(r.taskId) === 'gold-valid').map(r => r.taskId)).size}, repaired tasks: ${repTasks.size}, DROPPED (env-curation-broken or unrepaired): ${dropped.length} → ${dropped.join(', ')}`);

const wilson = (k, n) => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d, m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - m), Math.min(1, c + m)]; };
const byArm = (rs) => ({ native: rs.filter(r => r.arm === 'native'), sweet: rs.filter(r => r.arm === 'sweet') });
const tasksOf = (rs) => [...new Set(rs.map(r => r.taskId))];
const rowFor = (rs, t, a) => rs.find(r => r.taskId === t && r.arm === a);

function table(label, rs) {
  console.log(`\n## ${label}`);
  console.log('| arm | resolved | rate | 95% CI | anyF2P | ideal$/task | ideal$/solve | Σideal$ | Σreal$ | avg calls |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  const A = byArm(rs);
  for (const arm of ['native', 'sweet']) {
    const x = A[arm]; const n = x.length; if (!n) { console.log(`| ${arm} | 0 | — | — | — | — | — | — | — | — |`); continue; }
    const res = x.filter(r => r.resolved).length;
    const part = x.filter(r => (r.f2pFrac || 0) > 0).length;
    const ideal = x.reduce((a, r) => a + (r.idealCostUsd || 0), 0);
    const real = x.reduce((a, r) => a + (r.costRealizedUsd || 0), 0);
    const calls = x.reduce((a, r) => a + (r.calls || 0), 0) / n;
    const [lo, hi] = wilson(res, n);
    console.log(`| ${arm} | ${res}/${n} | ${(100 * res / n).toFixed(0)}% | [${(100 * lo).toFixed(0)}–${(100 * hi).toFixed(0)}%] | ${part} | ${(ideal / n).toFixed(3)} | ${res ? (ideal / res).toFixed(2) : '—'} | ${ideal.toFixed(2)} | ${real.toFixed(2)} | ${calls.toFixed(1)} |`);
  }
  const ts = tasksOf(rs);
  let both = 0, onlyN = 0, onlyS = 0, neither = 0, bothN = 0, bothS = 0;
  for (const t of ts) {
    const rn = rowFor(rs, t, 'native'), rsw = rowFor(rs, t, 'sweet');
    const a = rn?.resolved ? 1 : 0, b = rsw?.resolved ? 1 : 0;
    if (a && b) { both++; bothN += rn.idealCostUsd || 0; bothS += rsw.idealCostUsd || 0; }
    else if (a) onlyN++; else if (b) onlyS++; else neither++;
  }
  console.log(`task-level: both=${both} (ideal$ nat ${bothN.toFixed(2)} vs sw ${bothS.toFixed(2)}), native-only=${onlyN}, sweet-only=${onlyS}, neither=${neither} of ${ts.length}`);
  return { neither, total: ts.length };
}

const strata = {
  'RANDOM stratum (env-honest, repaired)': rows.filter(r => !WATCH.includes(r.taskId)),
  'WATCH-LIST stratum (env-honest, repaired)': rows.filter(r => WATCH.includes(r.taskId)),
};
for (const [label, rs] of Object.entries(strata)) table(label, rs);

// same-53 comparison: original 53 valid pairs vs the merged view restricted to them
const ERR = new Set(['dart-lang__dartdoc-3393', 'microformats__php-mf2-255', 'mgechev__revive-477', 'microsoft__kiota-3760', 'kripken__emscripten-5742', 'jump-dev__jump.jl-2714']);
const old53tasks = [...new Set(orig.map(r => r.taskId))].filter(t => !ERR.has(t));
table('SAME-TASKS comparison — OLD rows (53 valid pairs incl. broken envs)', orig.filter(r => old53tasks.includes(r.taskId) && !r.shimExcluded));
table('SAME-TASKS comparison — MERGED rows (env-honest subset of those tasks)', rows.filter(r => old53tasks.includes(r.taskId)));

// --- THE CLEAN L3 POOL NUMBER (random stratum only) ---
const rnd = strata['RANDOM stratum (env-honest, repaired)'];
const rndTasks = tasksOf(rnd);
let poolIdeal = 0, totalIdeal = 0;
const neverResolved = [];
for (const t of rndTasks) {
  const rn = rowFor(rnd, t, 'native'), rsw = rowFor(rnd, t, 'sweet');
  const ideal = (rn?.idealCostUsd || 0) + (rsw?.idealCostUsd || 0);
  totalIdeal += ideal;
  if (!(rn?.resolved) && !(rsw?.resolved)) { poolIdeal += ideal; neverResolved.push({ t, ideal, rn, rsw }); }
}
console.log(`\n## CLEAN L3 POOL (random stratum, env-honest)`);
console.log(`idealCost on tasks NEITHER arm resolves: $${poolIdeal.toFixed(2)} of $${totalIdeal.toFixed(2)} = ${(100 * poolIdeal / totalIdeal).toFixed(0)}%  (prior watch-list-inflated figure was 82%)`);
// tails: calls after the last run_tests call whose (truncated) output changed vs the
// previous run_tests output — a PROXY for "turns after last newly-cleared failing test"
// (trajectory results are stored truncated to 600 chars; disclosed limitation).
const tail = (row) => {
  if (!row?.trajectory?.length) return null;
  const tests = row.trajectory.filter(x => x.kind === 'test');
  if (!tests.length) return row.calls ?? null;
  let lastChange = tests[0].call;
  for (let i = 1; i < tests.length; i++) if (tests[i].result !== tests[i - 1].result) lastChange = tests[i].call;
  return (row.calls || 0) - lastChange;
};
console.log(`top never-resolver tails (ideal$ · calls-after-last-test-output-change proxy nat/sw):`);
for (const { t, ideal, rn, rsw } of neverResolved.sort((a, b) => b.ideal - a.ideal).slice(0, 8)) {
  console.log(`  ${t}: $${ideal.toFixed(2)} · tail ${tail(rn) ?? '—'} / ${tail(rsw) ?? '—'} (calls ${rn?.calls ?? '—'}/${rsw?.calls ?? '—'})`);
}
console.log(`\nintegrity: repair-run startRetried=${rep.filter(r => r.startRetried).length}, codexErrors-rows=${rep.filter(r => (r.codexErrors || []).length).length}, shimTampered=${rows.filter(r => r.shimTampered).length}, errored=${rows.filter(r => r.exitReason === 'codex_error' || r.exitReason === 'timeout').length}`);
