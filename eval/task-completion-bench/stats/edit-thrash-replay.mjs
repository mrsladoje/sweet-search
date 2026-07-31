#!/usr/bin/env node
/** Offline edit/test-cycle replay for DEV-RET and post-frame Stage 1. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { extractFailureSignatures } from '../harness/rt-condense-lib.mjs';
import { splitOperations } from './probe-count.mjs';

const RETIRED_START_MS = 1_785_024_000_000;
const RETIRED_END_MS = 1_785_196_800_000;
const EDIT_TOOLS = new Set([
  'apply_patch', 'edit', 'write', 'patch', 'multiedit', 'multi_edit',
  'notebookedit', 'notebook_edit',
]);
const FOLD_SEED = 'turnfix-edit-thrash-v1';
const THRESHOLDS = [2, 3, 4];
const IDENTIFIER_WARNING = '[run_tests diff-check] WARNING: added identifier not found in symbol index:';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function parseEditReplayArgs(argv) {
  const out = {};
  const allowed = new Set([
    '--db', '--c1', '--c2', '--stage1-control', '--stage1-variant', '--stage1-db-root',
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    if (!allowed.has(arg)) throw new Error(`unknown option: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    out[arg.slice(2).replaceAll('-', '_')] = value;
  }
  for (const required of ['db', 'c1', 'c2', 'stage1_control', 'stage1_variant', 'stage1_db_root']) {
    if (!out[required]) throw new Error(`missing --${required.replaceAll('_', '-')}`);
  }
  for (const [name, value] of Object.entries(out)) {
    if (/tasks_heldout2|heldout2(?:[_.\/-]|$)|(?:^|[_.\/-])ho2(?:[_.\/-]|$)/i.test(value)) {
      throw new Error(`refusing forbidden HO2 path in --${name}`);
    }
  }
  return out;
}

function trajectoryKeys(runDir) {
  return readdirSync(path.join(runDir, 'trajectories'))
    .filter(name => /-(native|sweet)-r0\.json$/.test(name))
    .map(name => {
      const match = name.match(/^(.+)-(native|sweet)-r0\.json$/);
      return { task: match[1], arm: match[2] };
    });
}

function assistantCount(db, sessionId) {
  return db.prepare(
    `select count(*) n from message where session_id=? and
     (data like '%"role": "assistant"%' or data like '%"role":"assistant"%')`,
  ).get(sessionId).n;
}

function retiredSessions(db, keys) {
  const wanted = new Set(keys.map(key => `${key.task}\0${key.arm}`));
  const grouped = new Map();
  for (const row of db.prepare(
    'select id,directory from session where time_created between ? and ?',
  ).all(RETIRED_START_MS, RETIRED_END_MS)) {
    const match = String(row.directory).match(/\/runs\/(.+)__(native|sweet)__r0__\d+$/);
    if (!match) continue;
    const key = `${match[1]}\0${match[2]}`;
    if (!wanted.has(key)) continue;
    const values = grouped.get(key) || [];
    values.push(row.id);
    grouped.set(key, values);
  }
  return new Map([...grouped].map(([key, ids]) => [
    key,
    ids.map(id => ({ id, turns: assistantCount(db, id) }))
      .sort((a, b) => b.turns - a.turns || a.id.localeCompare(b.id))[0].id,
  ]));
}

function strictRows(file) {
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const result = new Map();
  for (const row of rows) {
    if (typeof row.resolved !== 'boolean') {
      throw new Error(`${file}: ${row.taskId}/${row.arm} resolved is not Boolean`);
    }
    result.set(`${row.taskId}\0${row.arm}`, row.resolved);
  }
  return result;
}

function retiredOutcomes(c1, c2, keys) {
  const outcomes = strictRows(path.join(c2, 'rows.json'));
  const graded = JSON.parse(readFileSync(path.join(c1, 'graded-45.json'), 'utf8'));
  for (const arm of ['native', 'sweet']) {
    const resolved = new Set(graded[arm].resolved_ids);
    const excluded = new Set([...graded[arm].error_ids, ...graded[arm].missing]);
    for (const key of keys.filter(item => item.arm === arm)) {
      if (outcomes.has(`${key.task}\0${arm}`)) continue;
      if (excluded.has(key.task)) throw new Error(`c1 outcome excluded for ${key.task}/${arm}`);
      outcomes.set(`${key.task}\0${arm}`, resolved.has(key.task));
    }
  }
  return outcomes;
}

function sessionMessages(db, sessionId) {
  const partQuery = db.prepare('select id,data from part where message_id=? order by id');
  const rows = db.prepare(
    'select id,data from message where session_id=? order by time_created,id',
  ).all(sessionId);
  const messages = [];
  for (const row of rows) {
    const data = parseJson(row.data);
    if (data.role !== 'assistant') continue;
    const calls = partQuery.all(row.id).map(partRow => {
      const part = parseJson(partRow.data);
      if (part.type !== 'tool') return null;
      return {
        id: partRow.id,
        tool: String(part.tool || '').toLowerCase(),
        command: part.state?.input?.command || '',
        output: part.state?.output || '',
      };
    }).filter(Boolean);
    const tokens = data.tokens || {};
    messages.push({
      calls,
      cost: Number(data.cost) || 0,
      inputTokens: (Number(tokens.input) || 0) + (Number(tokens.cache?.read) || 0),
    });
  }
  return messages;
}

function isEdit(call) {
  if (EDIT_TOOLS.has(call.tool)) return true;
  if (!['bash', 'shell'].includes(call.tool)) return false;
  return splitOperations(call.command).some(operation => operation.kind === 'edit');
}

function isTest(call) {
  return ['bash', 'shell'].includes(call.tool) &&
    splitOperations(call.command).some(operation => operation.kind === 'test');
}

function normalizeScope(command, output) {
  if (/targeted pattern .* ignored .*ran the full suite/i.test(output)) return 'full';
  const match = String(command).match(/(?:^|[;&|\n]\s*)run_tests(?:\s+([^|;&\n]+))?/);
  if (!match || !match[1]) return 'full';
  const args = match[1].replace(/\s*\d*>?&?\d*\s*$/, '').trim().replace(/\s+/g, ' ');
  return args ? `targeted:${args}` : 'full';
}

function introducedState(output) {
  const text = String(output || '');
  const extracted = extractFailureSignatures(text);
  const nonExecuted = /\[run_tests dedup\].*(?:unchanged|not re-run|cached)/i.test(text);
  const authority = text.includes('[run_tests] Authoritative test result');
  const baseline = text.match(/^\[run_tests baseline-diff\] (.+)$/m)?.[1] || '';
  const infra = extracted.infra || /\[run_tests exit=(124|137)\]/.test(text);
  if (nonExecuted || infra || (!authority && !baseline)) {
    return { trustworthy: false, nonExecuted, infra };
  }
  const newMatch = baseline.match(/(\d+) NEW failure\(s\).*?: (.*?)(?:\s{2}\|\||$)/);
  if (!newMatch) {
    if (baseline || extracted.sigs.size === 0) {
      return { trustworthy: true, failures: [], key: '0:', passing: true };
    }
    return { trustworthy: false, nonExecuted: false, infra: false };
  }
  const count = Number(newMatch[1]);
  const names = newMatch[2].split(' | ').map(value => value.trim()).filter(Boolean);
  if (count > names.length || names.some(value => value.endsWith('…'))) {
    return { trustworthy: false, incompleteSignatures: true };
  }
  const failures = [...new Set(names)].sort();
  return { trustworthy: true, failures, key: `${count}:${failures.join('\0')}`, passing: count === 0 };
}

function relation(previous, current, seen) {
  const before = new Set(previous.failures);
  const after = new Set(current.failures);
  const strictSubset = after.size < before.size && [...after].every(value => before.has(value));
  if (strictSubset) return { progress: true, kind: 'failure_subset' };
  if (current.key === previous.key) return { progress: false, kind: 'failure_state_repeat' };
  if (seen.has(current.key)) return { progress: false, kind: 'oscillation' };
  return { progress: false, kind: 'degradation_or_changed_failure' };
}

export function replayCycles(messages) {
  let editEpoch = 0;
  const scopes = new Map();
  const cycles = [];
  let testExecutions = 0;
  let editEnvelopes = 0;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    const messageHasEdit = message.calls.some(isEdit);
    for (const call of message.calls) {
      if (isEdit(call)) { editEpoch++; editEnvelopes++; }
      if (!isTest(call)) continue;
      const state = introducedState(call.output);
      if (!state.nonExecuted) testExecutions++;
      const scope = normalizeScope(call.command, call.output);
      const prior = scopes.get(scope) || { lastEditEpoch: 0, state: null, streak: 0, seen: new Set() };
      if (!state.trustworthy || messageHasEdit) continue;
      const attemptedRepair = editEpoch > prior.lastEditEpoch;
      let progress = false, kind = 'cycle0';
      if (attemptedRepair) {
        if (prior.state) ({ progress, kind } = relation(prior.state, state, prior.seen));
        else if (scope === 'full') { progress = true; kind = 'first_trustworthy_full'; }
        else kind = 'first_targeted_unranked';
        prior.streak = progress ? 0 : (kind === 'first_targeted_unranked' ? prior.streak : prior.streak + 1);
        cycles.push({ messageIndex, scope, editEpoch, progress, kind, streak: prior.streak, passing: state.passing });
      }
      prior.lastEditEpoch = editEpoch;
      prior.state = state;
      prior.seen.add(state.key);
      scopes.set(scope, prior);
    }
  }
  return { cycles, testExecutions, editEnvelopes };
}

/** Re-derive the Stage-1 first-edit timing and warning incidence from retained calls. */
export function verifyStage1(records) {
  const cells = {};
  for (const record of records.filter(row => row.era === 'post-frame')) {
    const cell = cells[record.cell] ||= {
      rollouts: 0, retrievalBeforeFirstEdit: 0, retrievalAfterFirstEdit: 0,
      warningOutputs: 0, affectedTasks: [], theloungeTests: [],
    };
    cell.rollouts++;
    const calls = record.messages.flatMap(message => message.calls);
    const firstEdit = calls.findIndex(isEdit);
    for (let index = 0; index < calls.length; index++) {
      const count = splitOperations(calls[index].command)
        .filter(operation => operation.kind === 'retrieval').length;
      if (firstEdit < 0 || index < firstEdit) cell.retrievalBeforeFirstEdit += count;
      else cell.retrievalAfterFirstEdit += count;
    }
    const warnings = calls.filter(call => String(call.output).includes(IDENTIFIER_WARNING));
    cell.warningOutputs += warnings.length;
    if (warnings.length) cell.affectedTasks.push(record.task);
    if (record.task === 'thelounge__thelounge-2538') {
      cell.theloungeTests = calls.filter(isTest).map((call, index) => {
        const state = introducedState(call.output);
        return {
          ordinal: index + 1,
          warning: String(call.output).includes(IDENTIFIER_WARNING),
          trustworthy: state.trustworthy,
          failureState: state.key || null,
        };
      });
    }
  }
  for (const cell of Object.values(cells)) {
    cell.affectedTasks.sort();
    const total = cell.retrievalBeforeFirstEdit + cell.retrievalAfterFirstEdit;
    cell.beforeFirstEditFraction = total ? cell.retrievalBeforeFirstEdit / total : null;
  }
  return {
    classifier: 'stage1-first-edit-warning-v1',
    timing: 'OpenCode tool declaration order; canonical retrieval operations; boundary is first source-edit envelope',
    warningNeedle: IDENTIFIER_WARNING,
    cells,
    affectedRollouts: Object.values(cells).reduce((sum, cell) => sum + cell.affectedTasks.length, 0),
    totalRollouts: Object.values(cells).reduce((sum, cell) => sum + cell.rollouts, 0),
  };
}

function foldFor(task) {
  return Number.parseInt(createHash('sha256').update(`${FOLD_SEED}\0${task}`).digest('hex').slice(0, 8), 16) % 5;
}

function trajectoryRecord({ task, arm, era, cell, resolved, messages }) {
  const replay = replayCycles(messages);
  return {
    task, arm, era, cell, resolved, messages, fold: foldFor(task),
    cycles: replay.cycles, turns: messages.length,
    testExecutions: replay.testExecutions, editEnvelopes: replay.editEnvelopes,
  };
}

function triggers(record, threshold) {
  const cycle = record.cycles.find(item => item.streak >= threshold);
  if (!cycle) return null;
  const later = record.messages.slice(cycle.messageIndex + 1);
  const laterCalls = later.flatMap(message => message.calls);
  const firstPassing = record.cycles.find(item => item.passing)?.messageIndex ?? null;
  return {
    task: record.task, arm: record.arm, era: record.era, cell: record.cell,
    resolved: record.resolved, fold: record.fold, triggerMessage: cycle.messageIndex + 1,
    beforeFirstPassing: firstPassing === null || cycle.messageIndex < firstPassing,
    remainingTurns: later.length,
    remainingEdits: laterCalls.filter(isEdit).length,
    remainingTests: laterCalls.filter(isTest).filter(call => !/\[run_tests dedup\].*(?:unchanged|not re-run|cached)/i.test(call.output)).length,
    remainingInputTokens: later.reduce((sum, message) => sum + message.inputTokens, 0),
    remainingRealizedUsd: later.reduce((sum, message) => sum + message.cost, 0),
    triggerKind: cycle.kind,
  };
}

function aggregateTriggers(records, threshold) {
  const rows = records.map(record => triggers(record, threshold)).filter(Boolean);
  const sum = field => rows.reduce((total, row) => total + row[field], 0);
  const solved = rows.filter(row => row.resolved);
  const unresolved = rows.filter(row => !row.resolved);
  return {
    threshold,
    exposedTasks: rows.length,
    exposedCycles: records.reduce(
      (total, record) => total + record.cycles.filter(cycle => cycle.streak >= threshold).length, 0),
    eventualSolved: solved.length,
    eventualSolveRate: rows.length ? solved.length / rows.length : null,
    solvedTriggeredBeforeFirstPassing: solved.filter(row => row.beforeFirstPassing).length,
    remainingTurns: sum('remainingTurns'),
    remainingEdits: sum('remainingEdits'),
    remainingTests: sum('remainingTests'),
    remainingInputTokens: sum('remainingInputTokens'),
    remainingRealizedUsd: sum('remainingRealizedUsd'),
    unresolvedRemainingRealizedUsd: unresolved.reduce(
      (total, row) => total + row.remainingRealizedUsd, 0),
    rows,
  };
}

function rankThreshold(metrics) {
  return metrics.filter(metric => metric.exposedTasks > 0).sort((a, b) => {
    const riskA = a.solvedTriggeredBeforeFirstPassing / Math.max(1, a.exposedTasks);
    const riskB = b.solvedTriggeredBeforeFirstPassing / Math.max(1, b.exposedTasks);
    return riskA - riskB || b.unresolvedRemainingRealizedUsd - a.unresolvedRemainingRealizedUsd ||
      b.exposedTasks - a.exposedTasks || b.threshold - a.threshold;
  })[0]?.threshold ?? null;
}

function crossValidate(records) {
  return Array.from({ length: 5 }, (_, fold) => {
    const train = records.filter(record => record.fold !== fold);
    const heldout = records.filter(record => record.fold === fold);
    const trainMetrics = THRESHOLDS.map(threshold => aggregateTriggers(train, threshold));
    const selected = rankThreshold(trainMetrics);
    return {
      fold,
      trainTasks: new Set(train.map(record => record.task)).size,
      heldoutTasks: new Set(heldout.map(record => record.task)).size,
      selected,
      heldout: aggregateTriggers(heldout, selected),
    };
  });
}

function nearestRank(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(probability * sorted.length) - 1];
}

function budgetGroups(records) {
  const groups = {};
  const add = (name, rows) => {
    groups[name] = {
      n: rows.length,
      turns: { p50: nearestRank(rows.map(row => row.turns), 0.5), p75: nearestRank(rows.map(row => row.turns), 0.75) },
      tests: { p50: nearestRank(rows.map(row => row.testExecutions), 0.5), p75: nearestRank(rows.map(row => row.testExecutions), 0.75) },
    };
  };
  add('all', records);
  for (const era of ['pre-frame', 'post-frame']) {
    const eraRows = records.filter(row => row.era === era);
    add(era, eraRows);
    add(`${era}:solved`, eraRows.filter(row => row.resolved));
    for (const cell of [...new Set(eraRows.map(row => row.cell))].sort()) {
      add(`${era}:${cell}`, eraRows.filter(row => row.cell === cell));
    }
  }
  return groups;
}

function bestStageSession(db) {
  return db.prepare('select id from session').all()
    .map(row => ({ id: row.id, turns: assistantCount(db, row.id) }))
    .sort((a, b) => b.turns - a.turns || a.id.localeCompare(b.id))[0]?.id;
}

function loadStageRecords(resultDir, dbRoot, cell) {
  const outcomes = strictRows(path.join(resultDir, 'rows.json'));
  const records = [];
  for (const [key, resolved] of outcomes) {
    const [task, arm] = key.split('\0');
    if (arm !== 'sweet') continue;
    const dbPath = path.join(dbRoot, `${cell}-${task}-sweet`, 'c.db');
    if (!existsSync(dbPath)) throw new Error(`stage DB missing: ${dbPath}`);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const sessionId = bestStageSession(db);
    records.push(trajectoryRecord({
      task, arm, era: 'post-frame', cell, resolved,
      messages: sessionMessages(db, sessionId),
    }));
    db.close();
  }
  return records;
}

async function main() {
  const options = parseEditReplayArgs(process.argv.slice(2));
  const keys = [...trajectoryKeys(options.c1), ...trajectoryKeys(options.c2)];
  if (keys.length !== 400) throw new Error(`expected 400 DEV-RET trajectories, got ${keys.length}`);
  const outcomes = retiredOutcomes(options.c1, options.c2, keys);
  const db = new Database(options.db, { readonly: true, fileMustExist: true });
  const selected = retiredSessions(db, keys);
  if (selected.size !== 400) throw new Error(`expected 400 DEV-RET sessions, got ${selected.size}`);
  const records = keys.map(key => trajectoryRecord({
    ...key,
    era: 'pre-frame',
    cell: key.arm,
    resolved: outcomes.get(`${key.task}\0${key.arm}`),
    messages: sessionMessages(db, selected.get(`${key.task}\0${key.arm}`)),
  }));
  db.close();
  records.push(...loadStageRecords(options.stage1_control, options.stage1_db_root, 'control'));
  records.push(...loadStageRecords(options.stage1_variant, options.stage1_db_root, 'variant'));
  if (records.some(record => typeof record.resolved !== 'boolean')) throw new Error('non-Boolean outcome admitted');

  const fullMetrics = THRESHOLDS.map(threshold => aggregateTriggers(records, threshold));
  const cv = crossValidate(records);
  const selections = cv.map(fold => fold.selected);
  const stable = selections.every(value => value === selections[0]);
  const composition = {};
  for (const record of records) for (const cycle of record.cycles) {
    composition[cycle.kind] = (composition[cycle.kind] || 0) + 1;
  }
  const report = {
    classifier: 'edit-thrash-observable-v1',
    limitations: [
      'No retained intermediate diff hashes or patches: exact-state, checkpoint, and best-vs-final replay unavailable.',
      'Issue-relevant pass and deterministic build-stage transitions are not reliably retained; only baseline-diff failure states are ranked.',
      'Untrusted, infra, parallel edit/test, and non-executed dedup results abstain.',
    ],
    foldSeed: FOLD_SEED,
    thresholdRule: 'among thresholds with exposure: minimize solved-before-pass triggers/exposed; then maximize unresolved remaining realized USD; exposure; larger H',
    records: records.length,
    uniqueTasks: new Set(records.map(record => record.task)).size,
    cycles: records.reduce((sum, record) => sum + record.cycles.length, 0),
    composition,
    budgets: budgetGroups(records),
    stage1Verification: verifyStage1(records),
    thresholds: fullMetrics.map(({ rows, ...metric }) => metric),
    thresholdsByEra: Object.fromEntries(['pre-frame', 'post-frame'].map(era => [
      era,
      THRESHOLDS.map(threshold => {
        const { rows, ...metric } = aggregateTriggers(records.filter(record => record.era === era), threshold);
        return metric;
      }),
    ])),
    crossValidation: cv.map(fold => ({ ...fold, heldout: { ...fold.heldout, rows: undefined } })),
    advisoryThreshold: stable ? selections[0] : null,
    selectionStableAcrossFolds: stable,
    enforcement: 'OFF',
  };
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
}
