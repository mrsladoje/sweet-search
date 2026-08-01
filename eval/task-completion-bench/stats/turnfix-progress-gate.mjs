#!/usr/bin/env node
// Fresh DISCOVERY-20 threshold selection and advisory-controller behavior gate.
// This consumes only retained DEV rows, append-only controller ledgers, and raw
// model-step mappings. It never restores a checkpoint or reads a frozen set.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { adjudicateTurnfix } from './turnfix-adjudicator.mjs';
import {
  TURNFIX_ARMS, armCohortFailures, loadTurnfixArm, loadTurnfixCohort,
} from './turnfix-admission.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const THRESHOLDS = Object.freeze([2, 3, 4]);
const FOLD_SEED = 'turnfix-live-progress-v1';
const MIN_EXPOSED_TASKS = 5;

const forbidden = value => /tasks_heldout2|heldout2|(?:^|[_.\/-])ho2(?:[_.\/-]|$)|expand32/i.test(String(value || ''));
const inside = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

function readJson(file, label) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${label} is missing or invalid JSON`); }
}

function resultRows(resultPath, arm) {
  const rows = readJson(path.join(resultPath, 'rows.json'), 'rows.json');
  if (!Array.isArray(rows)) throw new Error('rows.json must be an array');
  return new Map(rows.filter(row => row?.arm === arm).map(row => [row.taskId, row]));
}

function controllerRows(resultPath, row, task, arm, expectation, totalTurns) {
  if (row.rtProgressTelemetry !== true || row.rtProgressTurnMapComplete !== true) {
    throw new Error(`${task}/${arm}: T0 telemetry or model-turn map is incomplete`);
  }
  if (row.rtProgressAdvisory !== expectation.advisory
      || row.rtProgressH !== (expectation.advisory ? expectation.h : null)) {
    throw new Error(`${task}/${arm}: controller flags differ from the frozen cell`);
  }
  if (expectation.packing != null && row.packingTreatment !== expectation.packing) {
    throw new Error(`${task}/${arm}: packing treatment differs from ${expectation.packing}`);
  }
  const logPath = path.resolve(BENCH, String(row.rtProgressLog || ''));
  if (!inside(resultPath, logPath) || !existsSync(logPath)) {
    throw new Error(`${task}/${arm}: controller log is outside the result or missing`);
  }
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${task}/${arm}: invalid controller JSONL line ${index + 1}`); }
  });
  const sessions = lines.filter(item => item.kind === 'session');
  const maps = lines.filter(item => item.kind === 'model-turn-map');
  const invocations = lines.filter(item => item.kind === 'invocation').sort((a, b) => a.call - b.call);
  if (sessions.length !== 1 || maps.length !== 1 || maps[0].complete !== true) {
    throw new Error(`${task}/${arm}: controller session or model-turn map is not exact`);
  }
  const session = sessions[0], turnMap = maps[0];
  if (session.task !== task || session.arm !== arm || session.policyHash !== row.rtProgressPolicyHash
      || session.flags?.telemetry !== true || session.flags?.advisory !== expectation.advisory
      || session.flags?.h !== (expectation.advisory ? expectation.h : null)) {
    throw new Error(`${task}/${arm}: controller session provenance drifted`);
  }
  if (turnMap.sessionId !== session.sessionId || turnMap.policyHash !== session.policyHash
      || turnMap.invocationCount !== invocations.length || turnMap.mappings?.length !== invocations.length) {
    throw new Error(`${task}/${arm}: model-turn join does not cover every invocation`);
  }
  const byCall = new Map(turnMap.mappings.map(item => [item.call, item]));
  const joined = invocations.map((item, index) => {
    const mapping = byCall.get(item.call);
    if (item.call !== index + 1 || item.sessionId !== session.sessionId
        || item.task !== task || item.arm !== arm || item.policyHash !== session.policyHash
        || !Number.isInteger(item.triggerCount) || item.triggerCount < 0
        || !Number.isInteger(mapping?.modelTurn) || mapping.modelTurn < 1 || mapping.modelTurn > totalTurns) {
      throw new Error(`${task}/${arm}: invocation ${index + 1} failed integrity checks`);
    }
    return { ...item, modelTurn: mapping.modelTurn, messageId: mapping.messageId || null };
  });
  return { logPath, invocations: joined };
}

function loadRecords({ resultPath, arm, cohort, expected, expectation }) {
  const run = loadTurnfixArm(resultPath, arm, arm.toUpperCase());
  const failures = armCohortFailures(run, cohort, expected, arm.toUpperCase());
  if (failures.length) throw new Error(failures.join('; '));
  const rows = resultRows(run.resultPath, arm);
  return cohort.ids.map(task => {
    const metrics = run.byTask[task], row = rows.get(task);
    if (!row) throw new Error(`${task}/${arm}: result row is missing`);
    const controller = controllerRows(run.resultPath, row, task, arm, expectation, metrics.turns);
    return {
      task, arm, resolved: metrics.resolved, totalTurns: metrics.turns,
      resultPath: run.resultPath, row, ...controller,
    };
  });
}

function triggerFor(record, h) {
  return record.invocations.find(item => item.executed === true && item.trustworthy === true
    && item.status !== 'INFRA' && item.triggerCount >= h) || null;
}

function foldFor(task) {
  return Number.parseInt(createHash('sha256').update(`${FOLD_SEED}\0${task}`).digest('hex').slice(0, 8), 16) % 5;
}

function thresholdMetrics(records, h) {
  const rows = records.flatMap(record => {
    const trigger = triggerFor(record, h);
    if (!trigger) return [];
    const firstPass = record.invocations.find(item => item.issuePass === true)?.call ?? null;
    return [{
      task: record.task, arm: record.arm, resolved: record.resolved,
      triggerCall: trigger.call, triggerModelTurn: trigger.modelTurn,
      beforeFirstPass: firstPass === null || trigger.call < firstPass,
      remainingTurns: Math.max(0, record.totalTurns - trigger.modelTurn),
    }];
  });
  const solved = rows.filter(row => row.resolved);
  const unresolved = rows.filter(row => !row.resolved);
  return {
    h, exposedRecords: rows.length, exposedTasks: new Set(rows.map(row => row.task)).size,
    eventualSolved: solved.length,
    solvedTriggeredBeforeFirstPass: solved.filter(row => row.beforeFirstPass).length,
    unresolvedRemainingTurns: unresolved.reduce((sum, row) => sum + row.remainingTurns, 0),
    remainingTurns: rows.reduce((sum, row) => sum + row.remainingTurns, 0),
    rows,
  };
}

function rankThreshold(records) {
  return THRESHOLDS.map(h => thresholdMetrics(records, h)).filter(metric => metric.exposedRecords > 0)
    .sort((left, right) => {
      const leftRisk = left.solvedTriggeredBeforeFirstPass / left.exposedRecords;
      const rightRisk = right.solvedTriggeredBeforeFirstPass / right.exposedRecords;
      return leftRisk - rightRisk
        || right.unresolvedRemainingTurns - left.unresolvedRemainingTurns
        || right.exposedRecords - left.exposedRecords || right.h - left.h;
    })[0]?.h ?? null;
}

export function selectFreshProgressThreshold({ nativePath, sweetPath, tasksPath, expected = 20 }) {
  try {
    if ([nativePath, sweetPath, tasksPath].some(forbidden)) throw new Error('forbidden frozen/expansion path');
    const cohort = loadTurnfixCohort(tasksPath, expected);
    if (cohort.problems.length) throw new Error(cohort.problems.join('; '));
    const expectation = { advisory: false, h: null, packing: 'off' };
    const records = [
      ...loadRecords({ resultPath: nativePath, arm: 'native', cohort, expected, expectation }),
      ...loadRecords({ resultPath: sweetPath, arm: 'sweet', cohort, expected, expectation }),
    ];
    const folds = Array.from({ length: 5 }, (_, fold) => {
      const train = records.filter(record => foldFor(record.task) !== fold);
      const heldout = records.filter(record => foldFor(record.task) === fold);
      const selected = rankThreshold(train);
      return { fold, selected, heldout: selected == null ? null : thresholdMetrics(heldout, selected) };
    });
    const selections = folds.map(fold => fold.selected);
    const stable = selections[0] != null && selections.every(value => value === selections[0]);
    const selected = stable ? selections[0] : null;
    const full = selected == null ? null : thresholdMetrics(records, selected);
    const heldoutCovered = selected != null && folds.every(fold => fold.heldout?.exposedTasks >= 1);
    const enoughExposure = full?.exposedTasks >= MIN_EXPOSED_TASKS && heldoutCovered;
    const eligible = stable && enoughExposure;
    return {
      valid: true, stage: 'fresh-progress-threshold', verdict: eligible ? 'ELIGIBLE' : 'NO-GO',
      advisoryThreshold: eligible ? selected : null,
      foldSeed: FOLD_SEED, candidates: THRESHOLDS,
      rule: 'task-level 5-fold CV; minimize solved-before-pass risk, then maximize unresolved remaining turns, exposure, and H',
      exposureRule: `at least ${MIN_EXPOSED_TASKS} unique tasks overall and at least one in every held-out fold`,
      cohort: { tasksPath: cohort.tasksPath, sha256: cohort.sha256 },
      selections, selectionStableAcrossFolds: stable, enoughExposure,
      folds: folds.map(fold => ({ ...fold, heldout: fold.heldout && { ...fold.heldout, rows: undefined } })),
      selectedMetrics: full && { ...full, rows: undefined },
    };
  } catch (error) {
    return { valid: false, stage: 'fresh-progress-threshold', verdict: 'INVALID — not adjudicated', error: error.message };
  }
}

function percentile90(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.9) - 1];
}

function trajectoryFor(record) {
  const file = path.join(record.resultPath, 'trajectories', `${record.task}-${record.arm}-r0.json`);
  const value = readJson(file, `${record.task}/${record.arm} trajectory`);
  if (!Array.isArray(value.trajectory)) throw new Error(`${record.task}/${record.arm}: trajectory is missing`);
  for (const [index, item] of value.trajectory.entries()) {
    if (!Number.isInteger(item.modelTurn) || item.modelTurn < 1 || item.modelTurn > record.totalTurns) {
      throw new Error(`${record.task}/${record.arm}: trajectory call ${index + 1} lacks a real model turn`);
    }
  }
  return value.trajectory;
}

function firstPostTriggerAction(record, trigger) {
  const next = trajectoryFor(record).find(item => item.modelTurn > trigger.modelTurn);
  if (!next) return 'submission';
  if (next.kind === 'edit') return 'blind-edit';
  const input = String(next.input || '');
  if (/\bgit\s+(?:restore|checkout|reset|apply)\b/.test(input)) return 'restore';
  if (['ss', 'nativeRead', 'nativeGrep', 'test'].includes(next.kind)
      || /^\s*git\s+(?:diff|status|show)\b/.test(input)) return 'recovery';
  return 'other';
}

function behaviorSummary(records, h, { advisory }) {
  const rows = records.flatMap(record => {
    const trigger = triggerFor(record, h);
    if (!trigger) return [];
    if (advisory && !/^(?:recovery|restore-submit)\./.test(String(trigger.advisory || ''))) {
      throw new Error(`${record.task}/${record.arm}: trigger lacks the T1 advisory token`);
    }
    if (!advisory && trigger.advisory !== 'none') {
      throw new Error(`${record.task}/${record.arm}: T0 unexpectedly exposed advisory text`);
    }
    const action = firstPostTriggerAction(record, trigger);
    return [{
      task: record.task, arm: record.arm, action,
      postTriggerTurns: Math.max(0, record.totalTurns - trigger.modelTurn),
    }];
  });
  const good = rows.filter(row => ['recovery', 'restore', 'submission'].includes(row.action)).length;
  return {
    triggeredRecords: rows.length, goodNextActions: good,
    goodNextActionRate: rows.length ? good / rows.length : null,
    blindEditCycles: rows.filter(row => row.action === 'blind-edit').length,
    p90PostTriggerTurns: percentile90(rows.map(row => row.postTriggerTurns)), rows,
  };
}

export function evaluateAdvisoryBehavior({
  controlPath, treatmentPath, arm, tasksPath, expected = 20, h, packing = 'off',
}) {
  try {
    if (![2, 3, 4].includes(h) || !TURNFIX_ARMS.has(arm)
        || !['off', 'ss-batch', 'parallel-bash'].includes(packing)) throw new Error('invalid arm, H, or packing cell');
    if ([controlPath, treatmentPath, tasksPath].some(forbidden)) throw new Error('forbidden frozen/expansion path');
    const cohort = loadTurnfixCohort(tasksPath, expected);
    if (cohort.problems.length) throw new Error(cohort.problems.join('; '));
    const control = loadRecords({
      resultPath: controlPath, arm, cohort, expected,
      expectation: { advisory: false, h: null, packing },
    });
    const treatment = loadRecords({
      resultPath: treatmentPath, arm, cohort, expected,
      expectation: { advisory: true, h, packing },
    });
    const controlBehavior = behaviorSummary(control, h, { advisory: false });
    const treatmentBehavior = behaviorSummary(treatment, h, { advisory: true });
    const statistics = adjudicateTurnfix({
      stage: 'advisory', controlPath, treatmentPath, controlArm: arm, treatmentArm: arm,
      expected, tasksPath, completionTripwires: 'pass',
    });
    const gates = {
      treatmentHasTriggerExposure: treatmentBehavior.triggeredRecords > 0,
      goodNextActionsAtLeast80Percent: treatmentBehavior.goodNextActionRate >= 0.8,
      blindEditCyclesDecrease: treatmentBehavior.blindEditCycles < controlBehavior.blindEditCycles,
      p90PostTriggerTurnsDecrease: treatmentBehavior.p90PostTriggerTurns != null
        && controlBehavior.p90PostTriggerTurns != null
        && treatmentBehavior.p90PostTriggerTurns < controlBehavior.p90PostTriggerTurns,
      noControllerInducedLoss: statistics.valid === true && statistics.solve.treatmentOnlyLosses === 0,
      operationAndContextGatesPass: statistics.valid === true && statistics.verdict === 'ADVANCE',
    };
    return {
      valid: statistics.valid === true, stage: 'advisory-behavior', arm, h,
      verdict: Object.values(gates).every(Boolean) ? 'ADVANCE' : 'DO NOT ADVANCE',
      cohort: { tasksPath: cohort.tasksPath, sha256: cohort.sha256 },
      gates, control: { ...controlBehavior, rows: undefined },
      treatment: { ...treatmentBehavior, rows: undefined }, statistics,
    };
  } catch (error) {
    return { valid: false, stage: 'advisory-behavior', verdict: 'INVALID — not adjudicated', error: error.message };
  }
}

function parseCli(argv) {
  const out = {}, allowed = new Set(['mode', 'native', 'sweet', 'control', 'treatment', 'arm', 'tasks', 'expect', 'h']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--') || !allowed.has(arg.slice(2)) || arg.slice(2) in out
        || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('invalid options');
    out[arg.slice(2)] = argv[++index];
  }
  const expected = Number(out.expect), h = Number(out.h);
  if (!Number.isInteger(expected) || expected <= 0 || !out.tasks) throw new Error('invalid expected/tasks');
  if (out.mode === 'select' && out.native && out.sweet) return { mode: 'select', nativePath: out.native, sweetPath: out.sweet, tasksPath: out.tasks, expected };
  if (out.mode === 'behavior' && out.control && out.treatment && TURNFIX_ARMS.has(out.arm) && [2, 3, 4].includes(h)) {
    return { mode: 'behavior', controlPath: out.control, treatmentPath: out.treatment, arm: out.arm, tasksPath: out.tasks, expected, h };
  }
  throw new Error('incomplete options');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCli(process.argv.slice(2));
    const report = options.mode === 'select' ? selectFreshProgressThreshold(options) : evaluateAdvisoryBehavior(options);
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid || !['ELIGIBLE', 'ADVANCE'].includes(report.verdict)) process.exitCode = 1;
  } catch {
    console.error('usage: --mode select --native PATH --sweet PATH --tasks COHORT --expect 20 | --mode behavior --control PATH --treatment PATH --arm native|sweet --tasks COHORT --expect 20 --h 2|3|4');
    process.exitCode = 2;
  }
}
