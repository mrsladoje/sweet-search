#!/usr/bin/env node
// Strict, stage-aware adjudicator for the frozen turn-fix program. Unlike the
// retired prompt A/B rule, this accepts arbitrary native/sweet arm selectors,
// has no lower-operations gate, and uses the Phase-4 estimator contract.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRollout, readTurnLog } from './probe-count.mjs';

export const TURNFIX_STATS = Object.freeze({
  seed: 20260731,
  resamples: 50_000,
  confidence: 0.95,
  costPointTarget: 0.85,
  operationsUpper: 1.05,
  contextPerTurnUpper: 1.10,
  solveMargin: -0.05,
});
const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_TURN_SOURCES = new Set(['stream', 'rollout-jsonl']);
const VALID_EXITS = new Set(['model_stopped', 'budget_exhausted']);
const VALID_ARMS = new Set(['native', 'sweet']);

function rng(seed) {
  let x = seed >>> 0 || 1, y = 362436069, z = 521288629, w = 88675123;
  return () => {
    const t = x ^ (x << 11);
    x = y; y = z; z = w;
    w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8));
    return (w >>> 0) / 4294967296;
  };
}

function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

function sum(tasks, run, key) {
  return tasks.reduce((total, task) => total + run.byTask[task][key], 0);
}

function ratioOfSums(tasks, control, treatment, key) {
  const denominator = sum(tasks, control, key);
  return denominator > 0 ? sum(tasks, treatment, key) / denominator : NaN;
}

function contextPerTurnRatio(tasks, control, treatment) {
  const cTurns = sum(tasks, control, 'turns'), tTurns = sum(tasks, treatment, 'turns');
  const cRate = sum(tasks, control, 'contextTokens') / cTurns;
  const tRate = sum(tasks, treatment, 'contextTokens') / tTurns;
  return cRate > 0 ? tRate / cRate : NaN;
}

function bootstrapUpper(tasks, estimator) {
  const point = estimator(tasks);
  const random = rng(TURNFIX_STATS.seed);
  const draws = new Float64Array(TURNFIX_STATS.resamples);
  let accepted = 0, attempted = 0;
  while (accepted < draws.length && attempted < draws.length * 100) {
    attempted++;
    const sample = new Array(tasks.length);
    for (let j = 0; j < tasks.length; j++) sample[j] = tasks[(random() * tasks.length) | 0];
    const value = estimator(sample);
    if (!Number.isFinite(value)) continue;
    draws[accepted++] = value;
  }
  if (accepted !== draws.length) throw new Error('bootstrap could not obtain 50,000 finite paired ratio draws');
  draws.sort();
  return {
    point,
    upper95: draws[Math.ceil(TURNFIX_STATS.confidence * draws.length) - 1],
    interval: 'one-sided 95% percentile upper bound',
    estimator: 'ratio of untrimmed assigned-task sums',
    seed: TURNFIX_STATS.seed,
    resamples: TURNFIX_STATS.resamples,
    drawsAttempted: attempted,
  };
}

function safeTaskSegment(task) {
  return typeof task === 'string' && task.length > 0 && !/[\\/\0]/.test(task) && task !== '.' && task !== '..';
}

function readRows(resultPath) {
  const rowsPath = path.join(resultPath, 'rows.json');
  if (!existsSync(rowsPath)) return { rows: [], problems: [`no rows.json in ${resultPath}`] };
  try {
    const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
    return Array.isArray(rows) ? { rows, problems: [] } : { rows: [], problems: ['rows.json is not an array'] };
  } catch {
    return { rows: [], problems: ['rows.json is not valid JSON'] };
  }
}

function loadArm(inputPath, arm, tag) {
  const resultPath = path.resolve(inputPath);
  const { rows, problems } = readRows(resultPath);
  const selected = rows.filter(row => row?.arm === arm);
  const byTask = {}, seen = new Set();
  for (const row of selected) {
    const task = row?.taskId;
    if (!safeTaskSegment(task)) { problems.push(`${tag}: selected row has an unsafe/missing taskId`); continue; }
    if (seen.has(task)) { problems.push(`${tag}: duplicate ${arm} row for ${task}`); continue; }
    seen.add(task);
    const prefix = `${tag}.${task}`;
    if (typeof row.resolved !== 'boolean') problems.push(`${prefix}.resolved must be boolean`);
    if (row.gradeable !== true) problems.push(`${prefix}.gradeable must be true`);
    if (row.isolated !== true) problems.push(`${prefix}.isolated must be true`);
    if (row.escape !== 0) problems.push(`${prefix}.escape must equal 0`);
    if (row.leak !== 0) problems.push(`${prefix}.leak must equal 0`);
    if (row.goldTripwire !== false) problems.push(`${prefix}.goldTripwire must be false`);
    if (row.shimTampered !== false) problems.push(`${prefix}.shimTampered must be false`);
    if (row.shimReran !== false) problems.push(`${prefix}.shimReran must be false for complete assigned-task cost`);
    if (row.shimExcluded !== false) problems.push(`${prefix}.shimExcluded must be false`);
    if (!Array.isArray(row.shimTamperedFiles) || row.shimTamperedFiles.length) {
      problems.push(`${prefix}.shimTamperedFiles must be an empty array`);
    }
    if (!VALID_EXITS.has(row.exitReason)) problems.push(`${prefix}.exitReason is not an admitted completion outcome`);
    if (typeof row.costRealizedUsd !== 'number' || !Number.isFinite(row.costRealizedUsd) || row.costRealizedUsd <= 0) {
      problems.push(`${prefix}.costRealizedUsd must be finite and positive`);
    }

    const turnFile = path.join(resultPath, 'turns', `${task}-${arm}.jsonl`);
    const turns = readTurnLog(turnFile);
    if (turns.error) problems.push(`${prefix}: ${turns.error}`);
    else if (!REAL_TURN_SOURCES.has(turns.source)) problems.push(`${prefix}: turn log source must be stream or rollout-jsonl`);

    const rolloutDir = path.join(resultPath, 'agent-state', `${task}-${arm}`);
    let meter = null;
    if (existsSync(rolloutDir) && statSync(rolloutDir).isDirectory()) {
      meter = analyzeRollout(rolloutDir, { turnLog: turnFile });
    }
    if (!meter) problems.push(`${prefix}: canonical operation meter could not read agent-state`);
    else {
      if (meter.turnLogError || meter.modelTurnsSource !== 'turn-log') problems.push(`${prefix}: operation meter lacks a real turn log`);
      if (!Number.isInteger(meter.operations) || meter.operations < 0) problems.push(`${prefix}.operations must be a non-negative integer`);
      if (!Number.isInteger(meter.retrievalOperations) || meter.retrievalOperations < 0) {
        problems.push(`${prefix}.retrievalOperations must be a non-negative integer`);
      }
      if (!Number.isInteger(meter.retrievalEnvelopes) || meter.retrievalEnvelopes < 0) {
        problems.push(`${prefix}.retrievalEnvelopes must be a non-negative integer`);
      }
    }
    if (!Number.isInteger(turns.modelTurns) || turns.modelTurns <= 0) problems.push(`${prefix}.modelTurns must be a positive integer`);
    if (typeof turns.contextTokens !== 'number' || !Number.isFinite(turns.contextTokens) || turns.contextTokens <= 0) {
      problems.push(`${prefix}.contextTokens must be finite and positive`);
    }

    byTask[task] = {
      resolved: row.resolved,
      cost: row.costRealizedUsd,
      turns: turns.modelTurns,
      contextTokens: turns.contextTokens,
      contextPerTurn: turns.ctxPerTurn,
      operations: meter?.operations,
      retrievalOperations: meter?.retrievalOperations,
      retrievalEnvelopes: meter?.retrievalEnvelopes,
    };
  }
  return { resultPath, arm, byTask, problems };
}

function wilson(count, n, z) {
  const p = count / n, z2 = z * z, denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) / n) + z2 / (4 * n * n)) / denominator;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

// Newcombe's paired score method 10, oriented as treatment minus control.
export function newcombeMethod10({ both, controlOnly, treatmentOnly, neither }, z = 1.6448536269514722) {
  const n = both + controlOnly + treatmentOnly + neither;
  const pc = (both + controlOnly) / n, pt = (both + treatmentOnly) / n;
  const wc = wilson(both + controlOnly, n, z), wt = wilson(both + treatmentOnly, n, z);
  const raw = both * neither - controlOnly * treatmentOnly;
  const denominator = Math.sqrt((both + controlOnly) * (treatmentOnly + neither) *
    (both + treatmentOnly) * (controlOnly + neither));
  const corrected = raw > 0 ? Math.max(raw - n / 2, 0) : raw;
  const phi = denominator > 0 ? corrected / denominator : 0;
  const dcLower = pc - wc.lower, dcUpper = wc.upper - pc;
  const dtLower = pt - wt.lower, dtUpper = wt.upper - pt;
  const controlMinusTreatment = pc - pt;
  const lowerCT = controlMinusTreatment - Math.sqrt(Math.max(0,
    dcLower ** 2 - 2 * phi * dcLower * dtUpper + dtUpper ** 2));
  const upperCT = controlMinusTreatment + Math.sqrt(Math.max(0,
    dcUpper ** 2 - 2 * phi * dcUpper * dtLower + dtLower ** 2));
  return {
    point: pt - pc,
    lower95: Math.max(-1, -upperCT),
    upper95: Math.min(1, -lowerCT),
    interval: 'Newcombe paired score method 10',
    z,
    bothSolved: both,
    controlOnlySolved: controlOnly,
    treatmentOnlySolved: treatmentOnly,
    neitherSolved: neither,
  };
}

function pairedRiskDifference(control, treatment, tasks) {
  let both = 0, controlOnly = 0, treatmentOnly = 0, neither = 0;
  for (const task of tasks) {
    const c = control.byTask[task].resolved, t = treatment.byTask[task].resolved;
    if (c && t) both++;
    else if (c) controlOnly++;
    else if (t) treatmentOnly++;
    else neither++;
  }
  return newcombeMethod10({ both, controlOnly, treatmentOnly, neither });
}

function binomialCdf(x, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return x >= n ? 1 : 0;
  let term = (1 - p) ** n, total = term;
  for (let k = 0; k < x; k++) {
    term *= ((n - k) / (k + 1)) * (p / (1 - p));
    total += term;
  }
  return total;
}

function exactBinomialUpper95(x, n) {
  if (x >= n) return 1;
  let lo = x / n, hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(x, n, mid) > 0.05) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function distribution(tasks, run, key) {
  const values = tasks.map(task => run.byTask[task][key]);
  return { p50: quantile(values, 0.50), p75: quantile(values, 0.75), p90: quantile(values, 0.90) };
}

function topFive(tasks, run) {
  const ranked = tasks.map(task => ({ task, costUsd: run.byTask[task].cost }))
    .sort((a, b) => b.costUsd - a.costUsd || a.task.localeCompare(b.task)).slice(0, 5);
  const totalUsd = sum(tasks, run, 'cost'), topFiveUsd = ranked.reduce((s, row) => s + row.costUsd, 0);
  return { totalUsd, topFiveUsd, share: topFiveUsd / totalUsd, tasks: ranked };
}

function topFiveSavings(tasks, control, treatment) {
  const ranked = tasks.map(task => ({
    task, savingsUsd: control.byTask[task].cost - treatment.byTask[task].cost,
  })).sort((a, b) => b.savingsUsd - a.savingsUsd || a.task.localeCompare(b.task));
  const netSavingsUsd = ranked.reduce((total, row) => total + row.savingsUsd, 0);
  const top = ranked.slice(0, 5), topFiveSavingsUsd = top.reduce((total, row) => total + row.savingsUsd, 0);
  return { netSavingsUsd, topFiveSavingsUsd, shareOfNetSavings: netSavingsUsd > 0 ? topFiveSavingsUsd / netSavingsUsd : null, tasks: top };
}

function pairedDiagnostics(tasks, control, treatment, key) {
  const logs = tasks.filter(task => control.byTask[task][key] > 0 && treatment.byTask[task][key] > 0)
    .map(task => Math.log(treatment.byTask[task][key] / control.byTask[task][key]));
  if (!logs.length) return { n: 0, medianRatio: null, geometricMeanRatio: null };
  return {
    n: logs.length,
    medianRatio: Math.exp(quantile(logs, 0.5)),
    geometricMeanRatio: Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length),
  };
}

export function adjudicateTurnfix(options) {
  const { stage, controlPath, treatmentPath, controlArm, treatmentArm, expected } = options;
  const control = loadArm(controlPath, controlArm, 'CONTROL');
  const treatment = loadArm(treatmentPath, treatmentArm, 'TREATMENT');
  const cTasks = Object.keys(control.byTask).sort(), tTasks = Object.keys(treatment.byTask).sort();
  const onlyControl = cTasks.filter(task => !(task in treatment.byTask));
  const onlyTreatment = tTasks.filter(task => !(task in control.byTask));
  const admissionFailures = [...control.problems, ...treatment.problems];
  if (cTasks.length !== expected) admissionFailures.push(`CONTROL has ${cTasks.length} tasks, expected ${expected}`);
  if (tTasks.length !== expected) admissionFailures.push(`TREATMENT has ${tTasks.length} tasks, expected ${expected}`);
  if (onlyControl.length) admissionFailures.push(`${onlyControl.length} task(s) only in CONTROL: ${onlyControl.slice(0, 5).join(', ')}`);
  if (onlyTreatment.length) admissionFailures.push(`${onlyTreatment.length} task(s) only in TREATMENT: ${onlyTreatment.slice(0, 5).join(', ')}`);
  const aggregate = (run, key) => Object.values(run.byTask)
    .reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : NaN), 0);
  for (const [tag, run] of [['CONTROL', control], ['TREATMENT', treatment]]) {
    for (const key of ['retrievalEnvelopes', 'turns', 'contextTokens']) {
      const total = aggregate(run, key);
      if (Number.isFinite(total) && total <= 0) admissionFailures.push(`${tag} aggregate ${key} denominator must be positive`);
    }
  }
  for (const key of ['operations', 'retrievalOperations']) {
    const total = aggregate(control, key);
    if (Number.isFinite(total) && total <= 0) admissionFailures.push(`CONTROL aggregate ${key} denominator must be positive`);
  }
  if (admissionFailures.length) return {
    valid: false, verdict: 'INVALID — not adjudicated', stage, expected,
    admissionFailures: [...new Set(admissionFailures)],
  };

  const tasks = cTasks;
  const metric = key => bootstrapUpper(tasks, sample => ratioOfSums(sample, control, treatment, key));
  const metrics = {
    cost: metric('cost'),
    turns: metric('turns'),
    operations: metric('operations'),
    retrievalOperations: metric('retrievalOperations'),
    contextTokens: metric('contextTokens'),
    contextPerTurn: bootstrapUpper(tasks, sample => contextPerTurnRatio(sample, control, treatment)),
  };
  const solve = pairedRiskDifference(control, treatment, tasks);
  solve.treatmentOnlyLosses = solve.controlOnlySolved;
  solve.controlOnlyLosses = solve.treatmentOnlySolved;
  solve.treatmentOnlyLossTaskIds = tasks.filter(task => control.byTask[task].resolved && !treatment.byTask[task].resolved);
  solve.controlOnlyLossTaskIds = tasks.filter(task => !control.byTask[task].resolved && treatment.byTask[task].resolved);
  solve.grossTreatmentLossUpper95 = exactBinomialUpper95(solve.treatmentOnlyLosses, tasks.length);
  solve.nonInferiorityMargin = TURNFIX_STATS.solveMargin;
  solve.nonInferiorityClaimEligible = tasks.length >= 60;
  solve.nonInferiorityPass = solve.nonInferiorityClaimEligible && solve.lower95 > TURNFIX_STATS.solveMargin;

  const bothSolvedTasks = tasks.filter(task => control.byTask[task].resolved && treatment.byTask[task].resolved);
  const bothControl = sum(bothSolvedTasks, control, 'cost');
  const bothTreatment = sum(bothSolvedTasks, treatment, 'cost');
  const packing = {
    operationsPerRetrievalEnvelopeRatio:
      (sum(tasks, treatment, 'operations') / sum(tasks, treatment, 'retrievalEnvelopes')) /
      (sum(tasks, control, 'operations') / sum(tasks, control, 'retrievalEnvelopes')),
    operationsPerModelTurnRatio:
      (sum(tasks, treatment, 'operations') / sum(tasks, treatment, 'turns')) /
      (sum(tasks, control, 'operations') / sum(tasks, control, 'turns')),
  };
  const external = {
    retrievalEquivalence: options.retrievalEquivalence || 'pending',
    completionTripwires: options.completionTripwires || 'pending',
    treatmentLossAdjudication: solve.treatmentOnlyLosses === 0 ? 'not-needed' : (options.lossAdjudication || 'pending'),
  };
  const common = {
    valid: true, stage, expected, pairedTasks: tasks.length,
    inputs: { controlPath: control.resultPath, controlArm, treatmentPath: treatment.resultPath, treatmentArm },
    seed: TURNFIX_STATS.seed, resamples: TURNFIX_STATS.resamples,
    metrics, packing, solve,
    bothSolvedCost: {
      tasks: bothSolvedTasks.length,
      controlTotalUsd: bothControl,
      treatmentTotalUsd: bothTreatment,
      ratio: bothControl > 0 ? bothTreatment / bothControl : null,
    },
    tails: {
      turns: { control: distribution(tasks, control, 'turns'), treatment: distribution(tasks, treatment, 'turns') },
      costUsd: { control: distribution(tasks, control, 'cost'), treatment: distribution(tasks, treatment, 'cost') },
    },
    topFiveCostContribution: { control: topFive(tasks, control), treatment: topFive(tasks, treatment) },
    topFiveSavingsContribution: topFiveSavings(tasks, control, treatment),
    pairedLogDiagnostics: Object.fromEntries(['cost', 'turns', 'operations', 'contextTokens']
      .map(key => [key, pairedDiagnostics(tasks, control, treatment, key)])),
    triggers: {
      retrievalEquivalenceAuditRequired: metrics.retrievalOperations.point < 0.85,
      retrievalOperationRatioThreshold: 0.85,
    },
    externalGates: external,
  };

  if (stage === 'natural') {
    const gates = {
      operationsPerRetrievalEnvelopeImproved: packing.operationsPerRetrievalEnvelopeRatio > 1,
      operationsPerModelTurnImproved: packing.operationsPerModelTurnRatio > 1,
      operationsUpperAtMost1_05: metrics.operations.upper95 <= TURNFIX_STATS.operationsUpper,
      contextPerTurnUpperAtMost1_10: metrics.contextPerTurn.upper95 <= TURNFIX_STATS.contextPerTurnUpper,
      retrievalEquivalencePassed: external.retrievalEquivalence === 'pass',
      completionTripwiresPassed: external.completionTripwires === 'pass',
      treatmentLossesExplained: external.treatmentLossAdjudication === 'not-needed' || external.treatmentLossAdjudication === 'pass',
    };
    const advance = Object.values(gates).every(Boolean);
    return { ...common, gates, verdict: advance ? 'ADVANCE' : 'DO NOT ADVANCE' };
  }

  const gates = {
    costPointAtMost0_85: metrics.cost.point <= TURNFIX_STATS.costPointTarget,
    costUpperBelow1: metrics.cost.upper95 < 1,
    operationsUpperAtMost1_05: metrics.operations.upper95 <= TURNFIX_STATS.operationsUpper,
    contextPerTurnUpperAtMost1_10: metrics.contextPerTurn.upper95 <= TURNFIX_STATS.contextPerTurnUpper,
    retrievalEquivalencePassed: external.retrievalEquivalence === 'pass',
    completionTripwiresPassed: external.completionTripwires === 'pass',
    treatmentLossesAdjudicated: external.treatmentLossAdjudication === 'not-needed' || external.treatmentLossAdjudication === 'pass',
    solveSafetyEstablished: tasks.length >= 60 ? solve.nonInferiorityPass : solve.treatmentOnlyLosses === 0,
  };
  const allPass = Object.values(gates).every(Boolean);
  const mechanismPass = gates.operationsUpperAtMost1_05 && gates.contextPerTurnUpperAtMost1_10 &&
    gates.retrievalEquivalencePassed && gates.completionTripwiresPassed && gates.treatmentLossesAdjudicated;
  let verdict = allPass ? (tasks.length < 60 ? 'PASS — STOP AT CONFIRM-28' : 'PASS — CONFIRMED') : 'FAIL';
  if (tasks.length < 60 && solve.treatmentOnlyLosses >= 3) verdict = 'FAIL — THREE OR MORE TREATMENT-ONLY LOSSES; NO EXPANSION';
  else if (tasks.length < 60 && mechanismPass && [1, 2].includes(solve.treatmentOnlyLosses)) {
    verdict = 'EXPAND-32 — PLAUSIBLE TREATMENT-ONLY LOSS TRIGGER';
  } else if (tasks.length < 60 && mechanismPass && metrics.cost.upper95 >= 1 && metrics.cost.point <= TURNFIX_STATS.costPointTarget) {
    verdict = 'EXPAND-32 — COST-UNCERTAINTY TRIGGER';
  } else if (metrics.cost.point > TURNFIX_STATS.costPointTarget && metrics.cost.point < 1) {
    verdict = 'INCREMENTAL ONLY — MISSES 15% COST TARGET';
  }
  return { ...common, gates, verdict };
}

export function parseTurnfixArgs(argv) {
  const values = new Set(['stage', 'control', 'treatment', 'control-arm', 'treatment-arm', 'expect',
    'retrieval-equivalence', 'completion-tripwires', 'loss-adjudication']);
  const out = { json: false }, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') { if (seen.has('json')) throw new Error('duplicate --json'); seen.add('json'); out.json = true; continue; }
    if (!arg.startsWith('--') || !values.has(arg.slice(2)) || seen.has(arg.slice(2))) throw new Error(`unknown/duplicate option ${arg}`);
    const key = arg.slice(2); seen.add(key);
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`missing value for ${arg}`);
    out[key] = argv[++i];
  }
  const stage = out.stage === 'confirmation' ? 'confirmation' : out.stage;
  const expected = Number(out.expect);
  if (!['natural', 'confirmation'].includes(stage) || !out.control || !out.treatment ||
      !VALID_ARMS.has(out['control-arm']) || !VALID_ARMS.has(out['treatment-arm']) ||
      !Number.isInteger(expected) || expected <= 0) throw new Error('missing/invalid required option');
  for (const key of ['retrieval-equivalence', 'completion-tripwires']) {
    if (out[key] != null && !['pass', 'fail'].includes(out[key])) throw new Error(`invalid --${key}`);
  }
  if (out['loss-adjudication'] != null && !['pass', 'fail'].includes(out['loss-adjudication'])) {
    throw new Error('invalid --loss-adjudication');
  }
  return {
    stage, controlPath: out.control, treatmentPath: out.treatment,
    controlArm: out['control-arm'], treatmentArm: out['treatment-arm'], expected,
    retrievalEquivalence: out['retrieval-equivalence'], completionTripwires: out['completion-tripwires'],
    lossAdjudication: out['loss-adjudication'], json: out.json,
  };
}

function printText(report) {
  if (!report.valid) {
    console.error('VERDICT: INVALID — not adjudicated');
    for (const failure of report.admissionFailures) console.error(`  - ${failure}`);
    return;
  }
  console.log(`${report.stage}: ${report.pairedTasks} exact pairs; seed=${report.seed}; resamples=${report.resamples}`);
  for (const [key, value] of Object.entries(report.metrics)) {
    console.log(`${key}: treatment/control=${value.point.toFixed(3)} upper95=${value.upper95.toFixed(3)}`);
  }
  console.log(`solve treatment-only=${report.solve.treatmentOnlyLosses} control-only=${report.solve.controlOnlyLosses} RD=${report.solve.point.toFixed(3)} lower95=${report.solve.lower95.toFixed(3)}`);
  console.log(`VERDICT: ${report.verdict}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseTurnfixArgs(process.argv.slice(2));
    const report = adjudicateTurnfix(options);
    if (options.json) console.log(JSON.stringify(report, null, 2)); else printText(report);
    if (!report.valid) process.exitCode = 1;
  } catch {
    console.error('usage: node stats/turnfix-adjudicator.mjs --stage natural|confirmation --control PATH --control-arm native|sweet --treatment PATH --treatment-arm native|sweet --expect N [--retrieval-equivalence pass|fail] [--completion-tripwires pass|fail] [--loss-adjudication pass|fail] [--json]');
    process.exitCode = 2;
  }
}
