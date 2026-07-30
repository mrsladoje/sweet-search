#!/usr/bin/env node
/**
 * turn-economy-ab.mjs — the PREDECLARED estimator and decision rule for the
 * turn-economy prompt A/B. Both runs are SWEET-ARM ONLY and differ solely in `MPP`.
 *
 * Existing paired tooling expects native+sweet rows in one run and cannot adjudicate a
 * prompt-vs-prompt comparison, so the rule is fixed here, in code, BEFORE any spend.
 * Running this script IS the decision — there is no post-hoc estimator choice, and the
 * script REFUSES to emit a verdict on incomplete data rather than silently narrowing to
 * whatever tasks happen to be present.
 *
 *   node stats/turn-economy-ab.mjs <results/RUN_A> <results/RUN_B> [--json] [--expect N]
 *     RUN_A = control (frozen M±)      RUN_B = variant (turn-economy M±)
 *     --expect N   required paired-task count (default 36)
 *
 * ── PREDECLARED (do not edit after launch) ───────────────────────────────────────
 * ADMISSION — refuses to adjudicate unless: both runs carry EXACTLY the expected task
 *   set, identical on both sides; exactly one sweet row per task per run; and every
 *   gated metric present and finite for every task. A crashed or partial run gets
 *   INVALID, never a verdict on a selected subset.
 *
 * ESTIMATOR — ratio of aggregate totals, B/A. Aggregate (not the mean of per-task
 *   ratios) because re-send cost is driven by the TOTAL turn count, and because the
 *   per-task distribution is heavily right-skewed (median $0.34, p90 $1.38, max $5.03),
 *   where a mean-of-ratios is dominated by cheap tasks. Mean paired % change is a
 *   SECONDARY read; if the two disagree in sign the result is INCONCLUSIVE and neither
 *   is cherry-picked.
 * UNCERTAINTY — paired bootstrap over tasks, 10,000 resamples, seed 20260730,
 *   percentile 95% CI. Deterministic: same inputs → same verdict.
 *
 * METRIC DEFINITIONS
 *   turns        per-turn records in the rollout's turn log (excluding the meta line)
 *   ctxPerTurn   mean of `in` per turn. `in` is the FULL input context at that turn and
 *                ALREADY INCLUDES `cached` (harness/turn-log.mjs field contract), so
 *                `in + cached` would double-count the cached prefix. A turn log written
 *                with source:"aggregate" is ONE synthetic record and is REJECTED here.
 *   operations   retrieval-and-test operations from stats/probe-count.mjs — `ss-*`,
 *                `run_tests`, native retrieval shell and native read/grep/glob/list —
 *                recovered by splitting fused shell strings. NOT envelopes: an envelope
 *                gate is gameable by shell fusion and could not detect added probes.
 *
 * GATES
 *   WIN      turnsRatio <= 0.90  AND  upper 95% bound < 1.00
 *   REVERT   operationsRatio upper 95% bound > 1.05     (anti-shotgun)
 *   REVERT   ctxPerTurnRatio upper 95% bound > 1.10     (win must be fewer turns,
 *            not wider ones)
 *   REVERT   solveLosses - solveGains >= 3              (tripwire, NOT a parity test:
 *            36 one-rep pairs cannot power a solve comparison)
 *   Anything else = NO CHANGE ADOPTED. A directionally positive result below the win
 *   threshold is reported as "directionally positive, below the predeclared threshold"
 *   and is NOT evidence of a dose-response relationship — do not tune to it.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { analyzeRollout } from './probe-count.mjs';

const SEED = 20260730;
const RESAMPLES = 10000;
const GATES = { win: 0.90, operationsUpper: 1.05, ctxUpper: 1.10, solveNet: 3 };
const GATED_METRICS = ['turns', 'ctxPerTurn', 'operations'];

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

/** Read one rollout's turn log → {turns, ctxPerTurn}. Rejects aggregate logs. */
function readTurnLog(file) {
  if (!existsSync(file)) return { error: 'turn log missing' };
  let sum = 0, k = 0, meta = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { return { error: 'turn log unparseable' }; }
    if (o.kind === 'meta') { meta = o; continue; }
    if (typeof o.in !== 'number') return { error: 'turn record missing `in`' };
    sum += o.in;                       // `in` already includes `cached` — do NOT add it
    k++;
  }
  if (meta && meta.source === 'aggregate') {
    return { error: 'turn log is source:aggregate — not a turn distribution' };
  }
  if (!k) return { error: 'turn log has no turn records' };
  return { turns: k, ctxPerTurn: sum / k };
}

function loadRun(dir) {
  const rowsPath = path.join(dir, 'rows.json');
  if (!existsSync(rowsPath)) throw new Error(`no rows.json in ${dir}`);
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8')).filter(r => r.arm === 'sweet');

  const seen = new Map();
  const dupes = [];
  for (const r of rows) {
    const t = r.taskId;
    if (!t) continue;
    if (seen.has(t)) { dupes.push(t); continue; }
    seen.set(t, r);
  }

  const asRoot = path.join(dir, 'agent-state');
  const byTask = {};
  const problems = [];
  for (const [t, r] of seen) {
    const log = readTurnLog(path.join(dir, 'turns', `${t}-sweet.jsonl`));
    if (log.error) problems.push(`${t}: ${log.error}`);

    let operations = null;
    const roll = path.join(asRoot, `${t}-sweet`);
    if (existsSync(roll) && statSync(roll).isDirectory()) {
      const a = analyzeRollout(roll);
      if (a) operations = a.probes;
      else problems.push(`${t}: agent-state unreadable (operations gate)`);
    } else {
      problems.push(`${t}: no agent-state dir (operations gate)`);
    }

    byTask[t] = {
      turns: log.turns ?? null,
      ctxPerTurn: log.ctxPerTurn ?? null,
      operations,
      envelopes: typeof r.calls === 'number' ? r.calls : null,
      solved: !!r.resolved,
      idealCostUsd: typeof r.idealCostUsd === 'number' ? r.idealCostUsd : null,
    };
  }
  return { byTask, dupes, problems };
}

// ── admission ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const expectIdx = args.indexOf('--expect');
const EXPECT = expectIdx >= 0 ? Number(args[expectIdx + 1]) : 36;
const dirs = args.filter((a, i) => !a.startsWith('--') && !(expectIdx >= 0 && i === expectIdx + 1));
const [dirA, dirB] = dirs;
if (!dirA || !dirB) {
  console.error('usage: node stats/turn-economy-ab.mjs <results/RUN_A> <results/RUN_B> [--json] [--expect N]');
  process.exit(2);
}

const A = loadRun(dirA), B = loadRun(dirB);
const tasksA = Object.keys(A.byTask).sort();
const tasksB = Object.keys(B.byTask).sort();
const onlyA = tasksA.filter(t => !(t in B.byTask));
const onlyB = tasksB.filter(t => !(t in A.byTask));

const admission = [];
if (A.dupes.length) admission.push(`RUN_A has duplicate sweet rows: ${A.dupes.join(', ')}`);
if (B.dupes.length) admission.push(`RUN_B has duplicate sweet rows: ${B.dupes.join(', ')}`);
if (onlyA.length) admission.push(`${onlyA.length} task(s) only in RUN_A: ${onlyA.slice(0, 5).join(', ')}`);
if (onlyB.length) admission.push(`${onlyB.length} task(s) only in RUN_B: ${onlyB.slice(0, 5).join(', ')}`);
if (tasksA.length !== EXPECT) admission.push(`RUN_A has ${tasksA.length} tasks, expected ${EXPECT}`);
if (tasksB.length !== EXPECT) admission.push(`RUN_B has ${tasksB.length} tasks, expected ${EXPECT}`);

const tasks = tasksA.filter(t => t in B.byTask);
for (const t of tasks) {
  for (const m of GATED_METRICS) {
    for (const [tag, run] of [['A', A], ['B', B]]) {
      const v = run.byTask[t][m];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        admission.push(`${t}: RUN_${tag}.${m} missing/non-finite`);
      }
    }
  }
}
for (const p of [...A.problems, ...B.problems]) admission.push(p);

if (admission.length) {
  const uniq = [...new Set(admission)];
  const out = { verdict: 'INVALID — not adjudicated', pairedTasks: tasks.length,
                expected: EXPECT, admissionFailures: uniq };
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else {
    console.error('VERDICT: INVALID — not adjudicated\n');
    console.error('Admission failures (all must clear before this A/B can be decided):');
    for (const f of uniq.slice(0, 40)) console.error('  - ' + f);
    if (uniq.length > 40) console.error(`  … and ${uniq.length - 40} more`);
  }
  process.exit(1);
}

// ── estimation ───────────────────────────────────────────────────────────────────
function ratio(list, key) {
  let sa = 0, sb = 0;
  for (const t of list) { sa += A.byTask[t][key]; sb += B.byTask[t][key]; }
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
  return { point, lo: draws[Math.floor(draws.length * 0.025)], hi: draws[Math.floor(draws.length * 0.975)] };
}

function meanPairedPct(key) {
  const vals = tasks.filter(t => A.byTask[t][key] > 0)
    .map(t => (B.byTask[t][key] / A.byTask[t][key] - 1) * 100);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

const turns = bootstrap('turns');
const ops = bootstrap('operations');
const ctx = bootstrap('ctxPerTurn');
const env = bootstrap('envelopes');
const cost = bootstrap('idealCostUsd');

let gains = 0, losses = 0;
for (const t of tasks) {
  if (!A.byTask[t].solved && B.byTask[t].solved) gains++;
  if (A.byTask[t].solved && !B.byTask[t].solved) losses++;
}

const reverts = [];
if (ops.hi > GATES.operationsUpper) reverts.push(`operations upper ${ops.hi.toFixed(3)} > ${GATES.operationsUpper}`);
if (ctx.hi > GATES.ctxUpper) reverts.push(`ctx/turn upper ${ctx.hi.toFixed(3)} > ${GATES.ctxUpper}`);
if (losses - gains >= GATES.solveNet) reverts.push(`solve losses−gains = ${losses - gains} >= ${GATES.solveNet}`);

const secondary = meanPairedPct('turns');
const signDisagree = (turns.point < 1) !== (secondary < 0);
const winTurns = turns.point <= GATES.win && turns.hi < 1.00;

let verdict;
if (reverts.length) verdict = 'REVERT';
else if (signDisagree) verdict = 'INCONCLUSIVE — aggregate and mean-paired disagree in sign';
else if (winTurns) verdict = 'WIN — all gates clear';
else verdict = 'NO CHANGE ADOPTED — directionally positive but below the predeclared threshold';

const report = {
  pairedTasks: tasks.length, seed: SEED, resamples: RESAMPLES, gates: GATES,
  turnsRatio: turns, operationsRatio: ops, ctxPerTurnRatio: ctx,
  envelopesRatio: env, idealCostRatio: cost,
  meanPairedTurnsPct: +secondary.toFixed(2),
  solve: { gains, losses, net: gains - losses },
  reverts, verdict,
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  const f = (b) => `${b.point.toFixed(3)} [${b.lo.toFixed(3)}, ${b.hi.toFixed(3)}]`;
  console.log(`paired tasks: ${tasks.length}   seed ${SEED}   ${RESAMPLES} resamples\n`);
  console.log(`turns       B/A  ${f(turns)}   ${turns.point <= GATES.win ? 'meets 0.90' : 'above 0.90'}`);
  console.log(`operations  B/A  ${f(ops)}   GATE upper must be <= ${GATES.operationsUpper}`);
  console.log(`ctx/turn    B/A  ${f(ctx)}   GATE upper must be <= ${GATES.ctxUpper}`);
  console.log(`envelopes   B/A  ${f(env)}   (reported only — NOT a gate)`);
  console.log(`idealCost   B/A  ${f(cost)}   (reported only)`);
  console.log(`mean paired turns change: ${secondary.toFixed(2)}%   (secondary)`);
  console.log(`solve: +${gains} / −${losses}  net ${gains - losses}`);
  if (reverts.length) console.log(`\nREVERT triggers:\n  ${reverts.join('\n  ')}`);
  console.log(`\nVERDICT: ${verdict}`);
}
