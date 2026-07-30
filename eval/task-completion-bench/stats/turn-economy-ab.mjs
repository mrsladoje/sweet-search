#!/usr/bin/env node
/**
 * turn-economy-ab.mjs — the PREDECLARED estimator and decision rule for the
 * turn-economy prompt A/B. Both runs are SWEET-ARM ONLY and differ solely in `MPP`.
 *
 * Existing paired tooling expects native+sweet rows in one run and cannot adjudicate a
 * prompt-vs-prompt comparison, so the rule is fixed here, in code, BEFORE any spend.
 * Running this script is the decision; there is no post-hoc estimator choice.
 *
 *   node stats/turn-economy-ab.mjs <results/RUN_A> <results/RUN_B> [--json]
 *     RUN_A = control (frozen M±)      RUN_B = variant (turn-economy M±)
 *
 * ── PREDECLARED (do not edit after launch) ───────────────────────────────────────
 * ESTIMATOR — ratio of aggregate totals, B/A, over tasks present in BOTH runs.
 *   Aggregate (not the mean of per-task ratios) because re-send cost is driven by the
 *   TOTAL turn count, and because the per-task distribution is heavily right-skewed
 *   (median $0.34, p90 $1.38, max $5.03), where a mean-of-ratios is dominated by cheap
 *   tasks. The mean paired % change is reported as a SECONDARY read; if the two
 *   disagree in sign, the result is INCONCLUSIVE and neither is cherry-picked.
 * UNCERTAINTY — paired bootstrap over tasks, 10,000 resamples, seed 20260730,
 *   percentile 95% CI. Deterministic: same inputs → same verdict.
 *
 * GATES
 *   WIN      turnsRatio <= 0.90  AND  upper 95% bound < 1.00
 *   REVERT   operationsRatio upper 95% bound > 1.05     (anti-shotgun; operations,
 *            NOT envelopes — an envelope gate is gameable by shell fusion)
 *   REVERT   ctxPerTurnRatio upper 95% bound > 1.10     (win must be fewer turns,
 *            not wider ones)
 *   REVERT   solveLosses - solveGains >= 3              (tripwire, NOT a parity test:
 *            36 one-rep pairs cannot power a solve comparison)
 *   Anything else = NO CHANGE ADOPTED. A directionally positive result below the win
 *   threshold is reported as "directionally positive, below the predeclared threshold"
 *   and is NOT evidence of a dose-response relationship — do not tune to it.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SEED = 20260730;
const RESAMPLES = 10000;
const GATES = { win: 0.90, operationsUpper: 1.05, ctxUpper: 1.10, solveNet: 3 };

/** xorshift128 — seeded so the verdict is reproducible. */
function rng(seed) {
  let x = seed >>> 0 || 1, y = 362436069, z = 521288629, w = 88675123;
  return () => {
    const t = x ^ (x << 11);
    x = y; y = z; z = w;
    w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8));
    return (w >>> 0) / 4294967296;
  };
}

function loadRun(dir) {
  const rowsPath = path.join(dir, 'rows.json');
  if (!existsSync(rowsPath)) throw new Error(`no rows.json in ${dir}`);
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8')).filter(r => r.arm === 'sweet');
  const byTask = {};
  for (const r of rows) {
    const t = r.taskId;
    if (!t) continue;
    // ctx/turn = mean input width per turn (fresh + cached), from the per-turn log.
    let ctxPerTurn = null, turns = r.idealTurns ?? null;
    const tf = r.turnsFile && path.resolve(dir, '..', '..', r.turnsFile);
    const local = tf && existsSync(tf) ? tf : path.join(dir, 'turns', `${t}-sweet.jsonl`);
    if (existsSync(local)) {
      let sum = 0, k = 0;
      for (const line of readFileSync(local, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const o = JSON.parse(line);
        if (o.kind === 'meta') continue;
        sum += (o.in || 0) + (o.cached || 0);
        k++;
      }
      if (k) { ctxPerTurn = sum / k; turns = turns ?? k; }
    }
    byTask[t] = {
      turns, ctxPerTurn,
      envelopes: r.calls ?? null,
      solved: !!r.resolved,
      idealCostUsd: r.idealCostUsd ?? null,
    };
  }
  return byTask;
}

/** operations/task from the predeclared counter, if agent-state is present. */
function loadOperations(dir) {
  const as = path.join(dir, 'agent-state');
  if (!existsSync(as)) return null;
  const out = {};
  for (const name of readdirSync(as)) {
    const m = name.match(/^(.*)-sweet$/);
    if (m) out[m[1]] = null;                 // filled by probe-count.mjs --json
  }
  return Object.keys(out).length ? out : null;
}

const [dirA, dirB] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const asJson = process.argv.includes('--json');
if (!dirA || !dirB) {
  console.error('usage: node stats/turn-economy-ab.mjs <results/RUN_A> <results/RUN_B> [--json]');
  process.exit(2);
}

const A = loadRun(dirA), B = loadRun(dirB);
const tasks = Object.keys(A).filter(t => t in B).sort();
if (!tasks.length) { console.error('no paired tasks'); process.exit(2); }

const opsA = loadOperations(dirA), opsB = loadOperations(dirB);
const opsNote = (opsA && opsB)
  ? 'run `node stats/probe-count.mjs <run>/agent-state --json` for both runs and pass the totals'
  : 'agent-state absent — operations gate CANNOT be evaluated';

/** ratio of aggregate totals for a metric, over a (possibly resampled) task list. */
function ratio(list, key) {
  let sa = 0, sb = 0;
  for (const t of list) {
    const a = A[t][key], b = B[t][key];
    if (a == null || b == null) continue;
    sa += a; sb += b;
  }
  return sa > 0 ? sb / sa : NaN;
}

function bootstrap(key) {
  const point = ratio(tasks, key);
  const r = rng(SEED);
  const draws = [];
  for (let i = 0; i < RESAMPLES; i++) {
    const samp = new Array(tasks.length);
    for (let j = 0; j < tasks.length; j++) samp[j] = tasks[(r() * tasks.length) | 0];
    const v = ratio(samp, key);
    if (!Number.isNaN(v)) draws.push(v);
  }
  draws.sort((a, b) => a - b);
  return {
    point,
    lo: draws[Math.floor(draws.length * 0.025)],
    hi: draws[Math.floor(draws.length * 0.975)],
  };
}

/** SECONDARY read: mean of per-task percentage change. */
function meanPairedPct(key) {
  const vals = tasks
    .filter(t => A[t][key] != null && B[t][key] != null && A[t][key] > 0)
    .map(t => (B[t][key] / A[t][key] - 1) * 100);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

const turns = bootstrap('turns');
const ctx = bootstrap('ctxPerTurn');
const env = bootstrap('envelopes');
const cost = bootstrap('idealCostUsd');

let gains = 0, losses = 0;
for (const t of tasks) {
  if (!A[t].solved && B[t].solved) gains++;
  if (A[t].solved && !B[t].solved) losses++;
}

const reverts = [];
if (ctx.hi > GATES.ctxUpper) reverts.push(`ctx/turn upper ${ctx.hi.toFixed(3)} > ${GATES.ctxUpper}`);
if (losses - gains >= GATES.solveNet) reverts.push(`solve losses−gains = ${losses - gains} >= ${GATES.solveNet}`);

const winTurns = turns.point <= GATES.win && turns.hi < 1.00;
const secondary = meanPairedPct('turns');
const signDisagree = (turns.point < 1) !== (secondary < 0);

let verdict;
if (reverts.length) verdict = 'REVERT';
else if (signDisagree) verdict = 'INCONCLUSIVE (aggregate and mean-paired disagree in sign)';
else if (winTurns) verdict = 'WIN (pending the operations gate)';
else verdict = 'NO CHANGE ADOPTED — directionally positive but below the predeclared threshold';

const report = {
  pairedTasks: tasks.length, seed: SEED, resamples: RESAMPLES, gates: GATES,
  turnsRatio: turns, ctxPerTurnRatio: ctx, envelopesRatio: env, idealCostRatio: cost,
  meanPairedTurnsPct: +secondary.toFixed(2),
  solve: { gains, losses, net: gains - losses },
  operationsGate: { evaluated: false, note: opsNote },
  reverts, verdict,
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  const f = (b) => `${b.point.toFixed(3)} [${b.lo.toFixed(3)}, ${b.hi.toFixed(3)}]`;
  console.log(`paired tasks: ${tasks.length}   seed ${SEED}   ${RESAMPLES} resamples\n`);
  console.log(`turns      B/A  ${f(turns)}   ${turns.point <= GATES.win ? '<= 0.90 ✓' : '> 0.90'}`);
  console.log(`ctx/turn   B/A  ${f(ctx)}`);
  console.log(`envelopes  B/A  ${f(env)}   (reported only — NOT a gate)`);
  console.log(`idealCost  B/A  ${f(cost)}   (reported only)`);
  console.log(`mean paired turns change: ${secondary.toFixed(2)}%   (secondary)`);
  console.log(`solve: +${gains} / −${losses}  net ${gains - losses}`);
  console.log(`\noperations gate: NOT EVALUATED — ${opsNote}`);
  if (reverts.length) console.log(`\nREVERT triggers:\n  ${reverts.join('\n  ')}`);
  console.log(`\nVERDICT: ${verdict}`);
}
