#!/usr/bin/env node
// Strict one-arm admission shared by sequential orchestration and paired stats.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRollout, readTurnLog } from './probe-count.mjs';

const REAL_TURN_SOURCES = new Set(['stream', 'rollout-jsonl']);
const VALID_EXITS = new Set(['model_stopped', 'budget_exhausted']);
const PACKING_TREATMENTS = new Set(['off', 'ss-batch', 'parallel-bash']);
export const TURNFIX_ARMS = new Set(['native', 'sweet']);

function safeTaskSegment(task) {
  return typeof task === 'string' && task.length > 0 && !/[\\/\0]/.test(task) && task !== '.' && task !== '..';
}

function taskId(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value.instance_id ?? value.taskId ?? null;
}

export function loadTurnfixCohort(inputPath, expected) {
  const tasksPath = path.resolve(inputPath || '');
  const problems = [];
  let bytes = '';
  try { bytes = readFileSync(tasksPath, 'utf8'); } catch { problems.push(`cohort file unreadable: ${tasksPath}`); }
  let entries = [];
  if (bytes) {
    try {
      const parsed = JSON.parse(bytes);
      if (!Array.isArray(parsed)) throw new Error('not-array');
      entries = parsed;
    } catch {
      try { entries = bytes.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); }
      catch { problems.push('cohort must be a JSON array or parseable NDJSON'); }
    }
  }
  const ids = entries.map(taskId);
  ids.forEach((id, index) => { if (!safeTaskSegment(id)) problems.push(`cohort entry ${index + 1} has an unsafe/missing task ID`); });
  const validIds = ids.filter(safeTaskSegment);
  const duplicates = validIds.filter((id, index) => validIds.indexOf(id) !== index);
  if (duplicates.length) problems.push(`cohort has duplicate task IDs: ${[...new Set(duplicates)].slice(0, 5).join(', ')}`);
  if (validIds.length !== expected) problems.push(`cohort has ${validIds.length} tasks, expected ${expected}`);
  return {
    tasksPath,
    ids: [...new Set(validIds)].sort(),
    sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : null,
    problems,
  };
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

export function loadTurnfixArm(inputPath, arm, tag = 'ARM', expectedCell = null) {
  const resultPath = path.resolve(inputPath);
  const { rows, problems } = readRows(resultPath);
  const selected = rows.filter(row => row?.arm === arm);
  const byTask = Object.create(null), seen = new Set();
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
    if (row.model !== 'x-ai/grok-4.5' || row.provider !== 'openrouter'
        || row.harness !== 'opencode' || row.reasoning !== 'standard') {
      problems.push(`${prefix}: model/provider/harness/reasoning differ from the frozen contract`);
    }
    if (!/^[a-f0-9]{16}$/.test(String(row.envConfigHash || ''))) {
      problems.push(`${prefix}.envConfigHash must be the exact green-ledger hash`);
    }
    if (row.openCodePreflight?.valid !== true || row.openCodePreflight?.version !== '1.18.4'
        || row.openCodePreflight?.pluginCount !== 0
        || !/^[a-f0-9]{64}$/.test(String(row.openCodePreflight?.resolvedConfigSha256 || ''))) {
      problems.push(`${prefix}: exact OpenCode 1.18.4 no-plugin preflight is missing`);
    }
    if (row.secretLeakDetected !== false) problems.push(`${prefix}.secretLeakDetected must be false`);
    if (!PACKING_TREATMENTS.has(row.packingTreatment)
        || !/^[a-f0-9]{64}$/.test(String(row.packingInstructionSha256 || ''))) {
      problems.push(`${prefix}: packing treatment provenance is missing or invalid`);
    }
    if (row.rtProgressVersion !== 'rt-progress-v1' || row.rtProgressSchema !== 1
        || row.rtProgressTelemetry !== true || typeof row.rtProgressAdvisory !== 'boolean'
        || row.rtProgressTurnMapComplete !== true
        || !/^[a-f0-9]{64}$/.test(String(row.rtProgressPolicyHash || ''))
        || (row.rtProgressAdvisory ? ![2, 3, 4].includes(row.rtProgressH) : row.rtProgressH !== null)) {
      problems.push(`${prefix}: progress-controller provenance is missing or invalid`);
    }
    if (expectedCell) {
      for (const [key, expectedValue] of Object.entries(expectedCell)) {
        if (row[key] !== expectedValue) problems.push(`${prefix}.${key} differs from the frozen cell`);
      }
    }
    if (typeof row.costRealizedUsd !== 'number' || !Number.isFinite(row.costRealizedUsd) || row.costRealizedUsd <= 0) {
      problems.push(`${prefix}.costRealizedUsd must be finite and positive`);
    }

    const turnFile = path.join(resultPath, 'turns', `${task}-${arm}.jsonl`);
    let turns;
    try { turns = readTurnLog(turnFile); } catch { turns = { error: 'turn log unreadable' }; }
    if (turns.error) problems.push(`${prefix}: ${turns.error}`);
    else if (!REAL_TURN_SOURCES.has(turns.source)) problems.push(`${prefix}: turn log source must be stream or rollout-jsonl`);

    const rolloutDir = path.join(resultPath, 'agent-state', `${task}-${arm}`);
    let meter = null;
    try {
      if (existsSync(rolloutDir) && statSync(rolloutDir).isDirectory()) {
        meter = analyzeRollout(rolloutDir, { turnLog: turnFile });
      }
    } catch { /* reported as an unreadable canonical meter below */ }
    if (!meter) problems.push(`${prefix}: canonical operation meter could not read agent-state`);
    else {
      if (meter.turnLogError || meter.modelTurnsSource !== 'turn-log') problems.push(`${prefix}: operation meter lacks a real turn log`);
      for (const key of ['operations', 'retrievalOperations', 'retrievalEnvelopes']) {
        if (!Number.isInteger(meter[key]) || meter[key] < 0) problems.push(`${prefix}.${key} must be a non-negative integer`);
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

export function armCohortFailures(run, cohort, expected, tag = 'ARM') {
  const actual = Object.keys(run.byTask).sort();
  const expectedSet = new Set(cohort.ids), actualSet = new Set(actual);
  const failures = [...run.problems, ...cohort.problems];
  if (actual.length !== expected) failures.push(`${tag} has ${actual.length} tasks, expected ${expected}`);
  const extra = actual.filter(id => !expectedSet.has(id));
  const missing = cohort.ids.filter(id => !actualSet.has(id));
  if (extra.length) failures.push(`${tag} has ${extra.length} task(s) outside frozen cohort: ${extra.slice(0, 5).join(', ')}`);
  if (missing.length) failures.push(`${tag} is missing ${missing.length} frozen task(s): ${missing.slice(0, 5).join(', ')}`);
  return [...new Set(failures)];
}

function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

export function validateTurnfixArm({ resultPath, arm, expected, tasksPath, expectedCell = null }) {
  const cohort = loadTurnfixCohort(tasksPath, expected);
  const run = loadTurnfixArm(resultPath, arm, 'ARM', expectedCell);
  const admissionFailures = armCohortFailures(run, cohort, expected, 'ARM');
  if (admissionFailures.length) return {
    valid: false, verdict: 'INVALID — ARM NOT ADMITTED', expected,
    cohort: { tasksPath: cohort.tasksPath, sha256: cohort.sha256 }, admissionFailures,
  };
  const rows = cohort.ids.map(id => run.byTask[id]);
  const total = key => rows.reduce((sum, row) => sum + row[key], 0);
  const dist = key => ({
    p50: quantile(rows.map(row => row[key]), 0.5),
    p75: quantile(rows.map(row => row[key]), 0.75),
    p90: quantile(rows.map(row => row[key]), 0.90),
  });
  return {
    valid: true,
    verdict: 'VALID — ARM ADMITTED',
    resultPath: run.resultPath,
    arm,
    expected,
    cohort: { tasksPath: cohort.tasksPath, sha256: cohort.sha256 },
    summary: {
      tasks: rows.length,
      solved: rows.filter(row => row.resolved).length,
      totals: Object.fromEntries(['cost', 'turns', 'contextTokens', 'operations',
        'retrievalOperations', 'retrievalEnvelopes'].map(key => [key, total(key)])),
      tails: { turns: dist('turns'), costUsd: dist('cost') },
    },
  };
}

export function parseArmAdmissionArgs(argv) {
  const out = {}, allowed = new Set(['result', 'arm', 'expect', 'tasks']);
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') { if (json) throw new Error('duplicate'); json = true; continue; }
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!allowed.has(key) || key in out || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('invalid options');
    out[key] = argv[++i];
  }
  const expected = Number(out.expect);
  if (!out.result || !TURNFIX_ARMS.has(out.arm) || !out.tasks || !Number.isInteger(expected) || expected <= 0) throw new Error('invalid options');
  return { resultPath: out.result, arm: out.arm, expected, tasksPath: out.tasks, json };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArmAdmissionArgs(process.argv.slice(2));
    const report = validateTurnfixArm(options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(`${report.verdict}${report.valid ? `: ${report.summary.tasks} ${report.arm} tasks` : ''}`);
    if (!report.valid) process.exitCode = 1;
  } catch {
    console.error('usage: node stats/turnfix-admission.mjs --result PATH --arm native|sweet --expect N --tasks COHORT.jsonl [--json]');
    process.exitCode = 2;
  }
}
