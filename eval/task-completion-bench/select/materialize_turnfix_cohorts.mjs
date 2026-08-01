#!/usr/bin/env node
/** Deterministic DEV-RET cohort materializer for TURN_FIX_PLAN revision 4. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export const TURNFIX_SEED = 20260731;
export const RETIRED_START_MS = 1_785_024_000_000;
export const RETIRED_END_MS = 1_785_196_800_000;
export const TURNFIX_OUTPUTS = Object.freeze({
  discovery: 'tasks_turnfix_discovery20.jsonl',
  confirm: 'tasks_turnfix_confirm28.jsonl',
  expand: 'tasks_turnfix_expand32.jsonl',
  manifest: 'MANIFEST_turnfix_cohorts.json',
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = /tasks_heldout2|heldout2(?:[_.\/-]|$)|(?:^|[_.\/-])ho2(?:[_.\/-]|$)|discarded-draw-/i;
const STRATA = ['tail', 'non_tail', 'unknown'];

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalJson(value, pretty = false) {
  return JSON.stringify(canonical(value), null, pretty ? 2 : 0);
}

function assertSafePath(value, label) {
  if (FORBIDDEN.test(String(value))) throw new Error(`refusing forbidden path in ${label}`);
}

function taskId(row) {
  return row?.instance_id || row?.taskId || row?.task_id || null;
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) out[row[key]] = (out[row[key]] || 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Hamilton largest-remainder allocation using exact integer remainders. */
export function largestRemainder(counts, target) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (!Number.isSafeInteger(target) || target < 0) throw new Error('target must be a non-negative integer');
  if (entries.some(([, n]) => !Number.isSafeInteger(n) || n < 0)) throw new Error('counts must be non-negative integers');
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (target > total || (target > 0 && total === 0)) throw new Error(`cannot allocate ${target} from population ${total}`);
  const allocation = Object.fromEntries(entries.map(([key, n]) => [key, total ? Math.floor(target * n / total) : 0]));
  let left = target - Object.values(allocation).reduce((sum, n) => sum + n, 0);
  const order = entries.map(([key, n]) => ({ key, remainder: total ? (target * n) % total : 0 }))
    .sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key));
  for (const { key } of order) {
    if (!left) break;
    if (allocation[key] < counts[key]) { allocation[key]++; left--; }
  }
  if (left) throw new Error(`largest-remainder allocation left ${left} unassigned`);
  return allocation;
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length !== 200) throw new Error('DEV-RET must contain exactly 200 tasks');
  const seen = new Set();
  return tasks.map((row) => {
    const id = taskId(row);
    if (!id || typeof row.language !== 'string' || !row.language) throw new Error('task needs instance_id and language');
    if (seen.has(id)) throw new Error(`duplicate task: ${id}`);
    seen.add(id);
    return { id, language: row.language, source: row };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function validTurns(value, valid, label) {
  if (valid === false || value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer or invalid`);
  return value;
}

function normalizeHistory(rows, taskIds) {
  if (!Array.isArray(rows)) throw new Error('history must be an array');
  const out = new Map([...taskIds].map((id) => [id, { native: null, sweet: null }]));
  const assigned = new Set();
  const put = (id, arm, value, valid) => {
    if (!out.has(id)) throw new Error(`history contains non-DEV task: ${id}`);
    if (!['native', 'sweet'].includes(arm)) throw new Error(`invalid history arm: ${arm}`);
    const key = `${id}\0${arm}`;
    if (assigned.has(key)) throw new Error(`duplicate history row: ${id}/${arm}`);
    assigned.add(key);
    out.get(id)[arm] = validTurns(value, valid, `${id}/${arm} turns`);
  };
  for (const row of rows) {
    const id = taskId(row);
    if (!id) throw new Error('history row missing task id');
    if (row.arm != null) put(id, row.arm, row.turns ?? row.modelTurns, row.valid);
    else {
      put(id, 'native', row.nativeTurns, row.nativeValid);
      put(id, 'sweet', row.sweetTurns, row.sweetValid);
    }
  }
  return out;
}

function normalizeLedger(rows, taskIds) {
  if (!Array.isArray(rows)) throw new Error('ledger must be an array');
  const out = new Map();
  for (const row of rows) {
    const id = taskId(row);
    if (!id) throw new Error('ledger row missing instance_id');
    if (!taskIds.has(id)) throw new Error(`ledger contains non-DEV task: ${id}`);
    out.set(id, row); // append-only ledger: last verdict wins
  }
  return out;
}

function isGreen(row) {
  return row?.status === 'gold-valid' && typeof row.configHash === 'string' && row.configHash.length > 0;
}

/** Extract the canonical retired task/arm turn counts from a read-only DB snapshot. */
export function retiredTurnsFromSnapshot(dbPath, tasks) {
  assertSafePath(dbPath, '--db');
  const normalized = normalizeTasks(tasks);
  const wanted = new Set(normalized.map(({ id }) => id));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const count = db.prepare(`select count(*) n from message where session_id=? and
    (data like '%"role": "assistant"%' or data like '%"role":"assistant"%')`);
  const candidates = new Map();
  try {
    for (const row of db.prepare('select id,directory from session where time_created between ? and ?').all(RETIRED_START_MS, RETIRED_END_MS)) {
      const match = String(row.directory).match(/\/runs\/(.+)__(native|sweet)__r0__\d+$/);
      if (!match || !wanted.has(match[1])) continue;
      const key = `${match[1]}\0${match[2]}`;
      const values = candidates.get(key) || [];
      values.push({ id: row.id, turns: count.get(row.id).n });
      candidates.set(key, values);
    }
  } finally { db.close(); }
  const rows = [];
  for (const task of normalized) for (const arm of ['native', 'sweet']) {
    const values = (candidates.get(`${task.id}\0${arm}`) || [])
      .filter(({ turns }) => Number.isSafeInteger(turns) && turns > 0)
      .sort((a, b) => b.turns - a.turns || a.id.localeCompare(b.id));
    rows.push({ taskId: task.id, arm, turns: values[0]?.turns ?? null, valid: values.length > 0,
      ...(values[0] ? { sessionId: values[0].id } : {}) });
  }
  return rows;
}

function classify(tasks, history) {
  const scored = [], unknown = [];
  for (const task of tasks) {
    const turns = history.get(task.id);
    const valid = [turns.native, turns.sweet].filter(Number.isFinite);
    const row = { ...task, nativeTurns: turns.native, sweetTurns: turns.sweet };
    if (valid.length) scored.push({ ...row, historicalMaxTurns: Math.max(...valid) });
    else unknown.push({ ...row, historicalMaxTurns: null });
  }
  const tailN = tasks.length / 5;
  if (!Number.isSafeInteger(tailN) || scored.length < tailN) throw new Error('cannot define the top 20% historical tail');
  scored.sort((a, b) => b.historicalMaxTurns - a.historicalMaxTurns || a.id.localeCompare(b.id));
  return [
    ...scored.slice(0, tailN).map((row, index) => ({ ...row, stratum: 'tail', tailRank: index + 1 })),
    ...scored.slice(tailN).map((row) => ({ ...row, stratum: 'non_tail' })),
    ...unknown.sort((a, b) => a.id.localeCompare(b.id)).map((row) => ({ ...row, stratum: 'unknown' })),
  ];
}

function stageTargets(stratumCounts) {
  const discoveryRest = largestRemainder({ non_tail: stratumCounts.non_tail, unknown: stratumCounts.unknown }, 10);
  const discovery = { tail: 10, ...discoveryRest };
  const confirm = largestRemainder(stratumCounts, 28);
  const safety = largestRemainder(stratumCounts, 60);
  const expand = Object.fromEntries(STRATA.map((key) => [key, safety[key] - confirm[key]]));
  if (Object.values(expand).some((n) => n < 0) || Object.values(expand).reduce((a, n) => a + n, 0) !== 32) {
    throw new Error('CONFIRM allocation is not a subset of the 60-task safety allocation');
  }
  return { discovery, confirm, expand, safety };
}

function languageAllocation(rows, stratum, target) {
  const counts = countBy(rows.filter((row) => row.stratum === stratum), 'language');
  return target ? largestRemainder(counts, target) : Object.fromEntries(Object.keys(counts).map((key) => [key, 0]));
}

function cellKey(stratum, language) { return `${stratum}\0${language}`; }

function buildQueues(rows, seed) {
  const queues = new Map();
  for (const row of rows) {
    const key = cellKey(row.stratum, row.language);
    const values = queues.get(key) || [];
    values.push(row); queues.set(key, values);
  }
  for (const [key, values] of queues) values.sort((a, b) =>
    digest(`${seed}\0${key}\0${a.id}`).localeCompare(digest(`${seed}\0${key}\0${b.id}`)) || a.id.localeCompare(b.id));
  return { queues, cursors: new Map([...queues.keys()].map((key) => [key, 0])) };
}

function hasGreen(queueState, stratum, language, ledger) {
  const key = cellKey(stratum, language), queue = queueState.queues.get(key) || [];
  for (let i = queueState.cursors.get(key) || 0; i < queue.length; i++) if (isGreen(ledger.get(queue[i].id))) return true;
  return false;
}

function takeGreen(queueState, stratum, language, ledger, context, audit) {
  const key = cellKey(stratum, language), queue = queueState.queues.get(key) || [];
  let cursor = queueState.cursors.get(key) || 0;
  const rejected = [];
  while (cursor < queue.length) {
    const candidate = queue[cursor++];
    queueState.cursors.set(key, cursor);
    const gold = ledger.get(candidate.id);
    if (isGreen(gold)) {
      for (const excluded of rejected) audit.replacements.push({ ...context, stratum, language,
        rejectedId: excluded.id, rejectedStatus: excluded.status, replacementId: candidate.id });
      return candidate;
    }
    const exclusion = { id: candidate.id, status: gold?.status || 'missing', configHash: gold?.configHash || null };
    rejected.push(exclusion); audit.exclusions.push({ ...context, stratum, language, ...exclusion });
  }
  return null;
}

function selectStage(name, rows, targets, allocations, queueState, ledger, audit, seed) {
  const selected = [];
  for (const stratum of STRATA) {
    const population = countBy(rows.filter((row) => row.stratum === stratum), 'language');
    const picked = Object.fromEntries(Object.keys(population).map((language) => [language, 0]));
    const deficits = [];
    for (const [language, n] of Object.entries(allocations[stratum] || {}).sort(([a], [b]) => a.localeCompare(b))) {
      for (let slot = 0; slot < n; slot++) {
        const exclusionStart = audit.exclusions.length;
        const item = takeGreen(queueState, stratum, language, ledger, { stage: name, slot }, audit);
        if (item) { selected.push(item); picked[language]++; }
        else deficits.push({ fromLanguage: language, slot,
          rejectedIds: audit.exclusions.slice(exclusionStart).map(({ id }) => id) });
      }
    }
    const populationN = Object.values(population).reduce((sum, n) => sum + n, 0);
    for (const deficit of deficits) {
      const candidates = Object.keys(population).filter((language) => hasGreen(queueState, stratum, language, ledger));
      candidates.sort((a, b) => {
        const scoreA = targets[stratum] * population[a] - picked[a] * populationN;
        const scoreB = targets[stratum] * population[b] - picked[b] * populationN;
        return scoreB - scoreA || a.localeCompare(b);
      });
      if (!candidates.length) throw new Error(`${name}/${stratum} exhausted green replacement pool`);
      const language = candidates[0];
      const item = takeGreen(queueState, stratum, language, ledger, { stage: name, slot: deficit.slot }, audit);
      selected.push(item); picked[language]++;
      for (const rejectedId of deficit.rejectedIds) audit.replacements.push({ stage: name,
        slot: deficit.slot, stratum, language: deficit.fromLanguage, rejectedId,
        rejectedStatus: ledger.get(rejectedId)?.status || 'missing', replacementId: item.id,
        replacementLanguage: language });
      audit.fallbacks.push({ stage: name, stratum, fromLanguage: deficit.fromLanguage,
        toLanguage: language, taskId: item.id, rule: 'largest-proportional-deficit-then-language' });
    }
  }
  if (selected.length !== Object.values(targets).reduce((sum, n) => sum + n, 0)) throw new Error(`${name} size mismatch`);
  return selected.sort((a, b) => digest(`${seed}\0${name}\0${a.id}`).localeCompare(digest(`${seed}\0${name}\0${b.id}`)) || a.id.localeCompare(b.id));
}

function jsonl(rows) {
  return `${rows.map((row) => canonicalJson(row.source)).join('\n')}\n`;
}

/** Pure materialization: no outcomes are accepted or inspected. */
export function materializeTurnfixCohorts({ tasks, historyRows, ledgerRows, seed = TURNFIX_SEED }) {
  if (seed !== TURNFIX_SEED) throw new Error(`seed must remain ${TURNFIX_SEED}`);
  const normalized = normalizeTasks(tasks), ids = new Set(normalized.map(({ id }) => id));
  const history = normalizeHistory(historyRows, ids), ledger = normalizeLedger(ledgerRows, ids);
  const classified = classify(normalized, history);
  const stratumCounts = Object.fromEntries(STRATA.map((key) => [key, classified.filter((row) => row.stratum === key).length]));
  const targets = stageTargets(stratumCounts);
  if (!stratumCounts.unknown) {
    const exact = targets.discovery.tail === 10 && targets.discovery.non_tail === 10
      && targets.confirm.tail === 6 && targets.confirm.non_tail === 22
      && targets.expand.tail === 6 && targets.expand.non_tail === 26;
    if (!exact) throw new Error('frozen 10+10 / 6+22 / 6+26 quotas drifted');
  }
  const allocation = {};
  for (const stage of ['discovery', 'confirm']) allocation[stage] = Object.fromEntries(
    STRATA.map((stratum) => [stratum, languageAllocation(classified, stratum, targets[stage][stratum])]));
  const safetyAllocation = Object.fromEntries(STRATA.map((stratum) =>
    [stratum, languageAllocation(classified, stratum, targets.safety[stratum])]));
  allocation.expand = Object.fromEntries(STRATA.map((stratum) => {
    const languages = new Set([...Object.keys(safetyAllocation[stratum]), ...Object.keys(allocation.confirm[stratum])]);
    const values = Object.fromEntries([...languages].sort().map((language) =>
      [language, (safetyAllocation[stratum][language] || 0) - (allocation.confirm[stratum][language] || 0)]));
    if (Object.values(values).some((n) => n < 0)) throw new Error(`non-monotone safety language allocation in ${stratum}`);
    return [stratum, values];
  }));
  const queueState = buildQueues(classified, seed), audit = { exclusions: [], replacements: [], fallbacks: [] };
  const selected = {};
  for (const stage of ['discovery', 'confirm', 'expand']) {
    selected[stage] = selectStage(stage, classified, targets[stage], allocation[stage], queueState, ledger, audit, seed);
  }
  const all = Object.values(selected).flat(), selectedIds = new Set(all.map(({ id }) => id));
  if (selectedIds.size !== 80 || all.some((row) => !isGreen(ledger.get(row.id)))) throw new Error('cohorts are not disjoint and green');
  const files = Object.fromEntries(['discovery', 'confirm', 'expand'].map((stage) => {
    const content = jsonl(selected[stage]);
    return [stage, { filename: TURNFIX_OUTPUTS[stage], content, sha256: digest(content), rows: selected[stage].map(({ source }) => source) }];
  }));
  const cohortManifest = Object.fromEntries(['discovery', 'confirm', 'expand'].map((stage) => [stage, {
    file: files[stage].filename, sha256: files[stage].sha256, n: selected[stage].length,
    execute: stage !== 'expand', targets: targets[stage], languageAllocation: allocation[stage],
    actualByStratum: countBy(selected[stage], 'stratum'), actualByLanguage: countBy(selected[stage], 'language'),
    ids: selected[stage].map(({ id }) => id),
  }]));
  const manifest = {
    schema: 'turnfix-dev-cohorts-v1', seed, source: 'DEV-RET', sourceTaskCount: normalized.length,
    outcomesObserved: false,
    tailRule: 'top 20% by max(valid nativeTurns, valid sweetTurns); ties by instance_id',
    historicalTail: {
      n: stratumCounts.tail,
      boundaryTurns: Math.min(...classified.filter((row) => row.stratum === 'tail').map((row) => row.historicalMaxTurns)),
      ids: classified.filter((row) => row.stratum === 'tail').sort((a, b) => a.tailRank - b.tailRank).map(({ id }) => id),
      oneInvalidArm: classified.filter((row) => Number.isFinite(row.nativeTurns) !== Number.isFinite(row.sweetTurns)).length,
      bothInvalidIds: classified.filter((row) => row.stratum === 'unknown').map(({ id }) => id),
    },
    stratumCounts, stratumWeights: Object.fromEntries(STRATA.map((key) => [key, stratumCounts[key] / normalized.length])),
    safetyLanguageAllocation: safetyAllocation,
    goldLedger: { green: normalized.filter(({ id }) => isGreen(ledger.get(id))).length,
      nonGreenOrMissing: normalized.filter(({ id }) => !isGreen(ledger.get(id))).length },
    greenRule: 'append-only ledger last verdict is gold-valid with non-empty configHash',
    replacementRule: 'same seeded stratum/language cell, then largest proportional deficit with language tie-break',
    safetyRule: 'CONFIRM-28 plus EXPAND-32 is the pre-materialized 60-task safety cohort; EXPAND is never automatic',
    cohorts: cohortManifest, audit,
  };
  return { files, manifest };
}

function parseJsonRows(file) {
  assertSafePath(file, 'input');
  const text = readFileSync(file, 'utf8').trim();
  if (!text) return [];
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value)) return value;
      if (Array.isArray(value.rows)) return value.rows;
    } catch { /* fall through to JSONL */ }
  }
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function parseArgs(argv) {
  const out = { tasks: path.join(HERE, 'tasks_heldout.jsonl'), outDir: HERE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--materialize') out.materialize = true;
    else if (arg === '--out-dir') out.outDir = argv[++i];
    else if (['--tasks', '--history', '--db', '--ledger'].includes(arg)) out[arg.slice(2)] = argv[++i];
    else throw new Error(`unknown option: ${arg}`);
  }
  for (const key of ['tasks', 'history', 'db', 'ledger', 'outDir']) if (key in out && !out[key]) throw new Error(`missing value for --${key}`);
  for (const [key, value] of Object.entries(out)) if (typeof value === 'string') assertSafePath(value, `--${key}`);
  if (!out.ledger || (!out.history && !out.db) || (out.history && out.db)) throw new Error('require --ledger and exactly one of --history/--db');
  if (out.dryRun === out.materialize) throw new Error('choose exactly one of --dry-run or --materialize');
  return out;
}

function fileHash(file) { return digest(readFileSync(file)); }

function main() {
  const options = parseArgs(process.argv.slice(2));
  const tasks = parseJsonRows(options.tasks);
  const historyRows = options.history ? parseJsonRows(options.history) : retiredTurnsFromSnapshot(options.db, tasks);
  const ledgerRows = parseJsonRows(options.ledger);
  const result = materializeTurnfixCohorts({ tasks, historyRows, ledgerRows });
  result.manifest.sources = {
    tasks: { path: path.resolve(options.tasks), sha256: fileHash(options.tasks) },
    history: options.history ? { path: path.resolve(options.history), sha256: fileHash(options.history) }
      : { dbSnapshot: path.resolve(options.db), extractedRowsSha256: digest(canonicalJson(historyRows)) },
    ledger: { path: path.resolve(options.ledger), sha256: fileHash(options.ledger) },
  };
  const manifestContent = `${canonicalJson(result.manifest, true)}\n`;
  if (options.materialize) {
    mkdirSync(options.outDir, { recursive: true });
    for (const value of Object.values(result.files)) writeFileSync(path.join(options.outDir, value.filename), value.content);
    writeFileSync(path.join(options.outDir, TURNFIX_OUTPUTS.manifest), manifestContent);
  }
  console.log(JSON.stringify({ mode: options.materialize ? 'materialized' : 'dry-run',
    cohorts: Object.fromEntries(Object.entries(result.files).map(([key, value]) => [key, { file: value.filename, n: value.rows.length, sha256: value.sha256 }])),
    manifest: { file: TURNFIX_OUTPUTS.manifest, sha256: digest(manifestContent) }, audit: result.manifest.audit }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
