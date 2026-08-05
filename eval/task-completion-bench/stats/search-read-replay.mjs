#!/usr/bin/env node
/**
 * Reproduce and replay the retired 551 adjacent search->read candidates.
 *
 * Historical admission intentionally matches /tmp/q2split.py byte-for-behavior:
 * every lead envelope is Bash containing an ss search-ish command, every next
 * envelope is Bash containing ss-read, and every read-target basename appeared
 * in the lead output. Current-version elimination is stricter: the union of the
 * safely re-executed search-ish operations must contain every historical read
 * payload. Merely returning the target filename is not sufficient.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { splitShell } from './probe-count.mjs';

const SEARCHISH = /\bss-(search|grep|find|semantic)\b/;
const READ = /\bss-read\s+(\S+)(?:\s+(\d+)\s+(\d+))?/;
const READ_ALL = /\bss-read\s+(\S+)(?:\s+(\d+)\s+(\d+))?/g;
const SUPPORTED = new Set(['ss-search', 'ss-grep', 'ss-find', 'ss-semantic']);
const RETIRED_START_MS = 1_785_024_000_000;
const RETIRED_END_MS = 1_785_196_800_000;

function normFile(value) {
  const clean = String(value || '').trim().replace(/^["']|["']$/g, '');
  return clean.includes('/') ? clean.slice(clean.lastIndexOf('/') + 1) : clean;
}

function json(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function taskArmFromDirectory(directory) {
  const match = String(directory || '').match(/\/runs\/(.+)__(sweet|native)__r0__\d+$/);
  return match ? { task: match[1], arm: match[2] } : null;
}

export function selectHistoricalSessions(db, taskIds) {
  const wanted = new Set(taskIds);
  const grouped = new Map();
  for (const row of db.prepare(
    'select id, directory from session where time_created between ? and ?',
  ).all(RETIRED_START_MS, RETIRED_END_MS)) {
    const parsed = taskArmFromDirectory(row.directory);
    if (!parsed || parsed.arm !== 'sweet' || !wanted.has(parsed.task)) continue;
    const entries = grouped.get(parsed.task) || [];
    entries.push(row.id);
    grouped.set(parsed.task, entries);
  }
  const count = db.prepare(
    `select count(*) n from message where session_id=? and
     (data like '%"role": "assistant"%' or data like '%"role":"assistant"%')`,
  );
  return new Map([...grouped].map(([task, ids]) => {
    const ranked = ids.map(id => ({ id, turns: count.get(id).n }))
      .sort((a, b) => b.turns - a.turns || a.id.localeCompare(b.id));
    return [task, { sessionId: ranked[0].id, candidates: ranked }];
  }));
}

function assistantTurns(db, sessionId) {
  const messages = db.prepare(
    'select id, data from message where session_id=? order by time_created, id',
  ).all(sessionId);
  const parts = db.prepare('select data from part where message_id=? order by id');
  const turns = [];
  for (const message of messages) {
    if (json(message.data).role !== 'assistant') continue;
    const calls = [];
    for (const row of parts.all(message.id)) {
      const part = json(row.data);
      if (part.type !== 'tool') continue;
      const state = part.state || {};
      calls.push({
        tool: part.tool,
        command: state.input?.command || '',
        output: state.output || '',
      });
    }
    turns.push(calls);
  }
  return turns;
}

export function extractSearchReadCandidates(db, selected) {
  const candidates = [];
  for (const [task, selection] of [...selected].sort()) {
    const turns = assistantTurns(db, selection.sessionId);
    for (let turn = 0; turn < turns.length - 1; turn++) {
      const lead = turns[turn];
      const next = turns[turn + 1];
      if (!lead.length || !next.length) continue;
      if (!lead.every(call => call.tool === 'bash' && SEARCHISH.test(call.command))) continue;
      const reads = next.map(call => READ.exec(call.command));
      if (!next.every((call, index) => call.tool === 'bash' && reads[index])) continue;
      const leadOutput = lead.map(call => call.output.slice(0, 20_000)).join('\n');
      const targets = reads.map(match => normFile(match[1]));
      if (!targets.length || !targets.every(target => target && leadOutput.includes(target))) continue;
      candidates.push({
        id: `${task}:${turn + 1}`,
        task,
        turn: turn + 1,
        sessionId: selection.sessionId,
        lead,
        reads: next,
        targets,
      });
    }
  }
  return candidates;
}

export function auditCandidates(candidates) {
  let strictAllTargets = 0;
  let multipleReadsInEnvelope = 0;
  let payloadComplete = 0;
  let safelyReplayable = 0;
  for (const candidate of candidates) {
    const leadOutput = candidate.lead.map(call => call.output.slice(0, 20_000)).join('\n');
    const allTargets = candidate.reads.flatMap(call =>
      [...String(call.command).matchAll(READ_ALL)].map(match => normFile(match[1])));
    if (candidate.reads.some(call => [...String(call.command).matchAll(READ_ALL)].length > 1)) {
      multipleReadsInEnvelope++;
    }
    if (allTargets.length && allTargets.every(target => target && leadOutput.includes(target))) {
      strictAllTargets++;
    }
    if (extractHistoricalReadPayloads(candidate.reads).length === allTargets.length) payloadComplete++;
    const parsed = parseSafeSearchOperations(candidate.lead.map(call => call.command));
    if (parsed.operations.length && !parsed.rejected.length) safelyReplayable++;
  }
  return {
    looseHistoricalCandidates: candidates.length,
    strictAllTargets,
    looseOnly: candidates.length - strictAllTargets,
    multipleReadsInEnvelope,
    payloadComplete,
    safelyReplayable,
  };
}

function tokenizePrefix(source) {
  const words = [];
  let word = '';
  let quote = null;
  let started = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== '\\') quote = null;
      else if (char === '\\' && quote === '"' && index + 1 < source.length) word += source[++index];
      else word += char;
      started = true;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (char === '\\' && index + 1 < source.length) { word += source[++index]; started = true; continue; }
    if (/[|<>&]/.test(char)) break;
    if (/\s/.test(char)) {
      if (started) { words.push(word); word = ''; started = false; }
      continue;
    }
    word += char;
    started = true;
  }
  if (quote) return { error: 'unterminated quote', words: [] };
  if (started) words.push(word);
  return { words };
}

export function parseSafeSearchOperations(commands) {
  const operations = [];
  const rejected = [];
  for (const command of commands) {
    for (const segment of splitShell(command)) {
      const match = /(?:^|[\s({])ss-(search|grep|find|semantic)\b/.exec(segment);
      if (!match) continue;
      const start = match.index + match[0].indexOf('ss-');
      const parsed = tokenizePrefix(segment.slice(start));
      if (parsed.error || !SUPPORTED.has(parsed.words[0])) {
        rejected.push({ segment, reason: parsed.error || 'unsupported command' });
        continue;
      }
      operations.push({ command: parsed.words[0], args: parsed.words.slice(1) });
    }
  }
  return { operations, rejected };
}

export function extractHistoricalReadPayloads(calls) {
  const payloads = [];
  for (const call of calls) {
    const output = String(call.output || '').replace(/\r/g, '');
    const section = /^# ss-read\s+([^\n]+)\n```[^\n]*\n([\s\S]*?)\n```/gm;
    for (const match of output.matchAll(section)) {
      const body = match[2].replace(/[ \t]+$/gm, '').trim();
      if (body) payloads.push({ header: match[1].trim(), body });
    }
  }
  return payloads;
}

function normalizePayload(value) {
  return String(value || '').replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();
}

export function classifyCurrentElimination(candidate, currentOutput, executionErrors = []) {
  const payloads = extractHistoricalReadPayloads(candidate.reads);
  const expectedPayloads = candidate.reads.reduce(
    (count, call) => count + [...String(call.command).matchAll(READ_ALL)].length, 0,
  );
  const haystack = normalizePayload(currentOutput);
  if (executionErrors.length || !payloads.length || payloads.length !== expectedPayloads) {
    return { verdict: 'uncertain', expectedPayloads, payloads: payloads.length, matched: 0 };
  }
  const matched = payloads.filter(payload => haystack.includes(normalizePayload(payload.body))).length;
  return {
    verdict: matched === payloads.length ? 'eliminated' : matched ? 'partial' : 'not_eliminated',
    expectedPayloads,
    payloads: payloads.length,
    matched,
  };
}

export function parseReplayArgs(argv) {
  const out = { execute: false };
  const valueOptions = new Set(['--db', '--trajectories', '--tasks', '--vault', '--work-root', '--results']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--execute-current') out.execute = true;
    else if (valueOptions.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
      out[arg.slice(2).replaceAll('-', '_')] = value;
    } else if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  for (const required of ['db', 'trajectories', 'tasks']) {
    if (!out[required]) throw new Error(`missing --${required}`);
  }
  for (const [name, value] of Object.entries(out)) {
    if (typeof value === 'string' &&
        /tasks_heldout2|heldout2(?:[_.\/-]|$)|(?:^|[_.\/-])ho2(?:[_.\/-]|$)/i.test(value)) {
      throw new Error(`refusing forbidden HO2 path in --${name}`);
    }
  }
  if (out.execute && (!out.vault || !out.work_root || !out.results)) {
    throw new Error('--execute-current requires --vault, --work-root, and --results');
  }
  return out;
}

function loadTaskIds(trajectoryDirs) {
  const ids = new Set();
  for (const dir of trajectoryDirs) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('-sweet-r0.json')) ids.add(name.replace(/-sweet-r0\.json$/, ''));
    }
  }
  return [...ids];
}

function prepareTrajectoryLists(raw) {
  const dirs = String(raw).split(',').map(value => path.resolve(value));
  for (const dir of dirs) {
    if (!existsSync(dir)) throw new Error(`trajectory directory does not exist: ${dir}`);
  }
  return dirs;
}

function taskMap(file) {
  const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const tasks = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.instance_id !== 'string') {
      throw new Error(`task row missing string instance_id in ${file}`);
    }
    if (tasks.has(row.instance_id)) throw new Error(`duplicate task row: ${row.instance_id}`);
    tasks.set(row.instance_id, row);
  }
  return tasks;
}

export function cacheKey(task) {
  const repo = String(task?.repo || '');
  const commit = String(task?.base_commit || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`unsafe or invalid task repo: ${repo}`);
  }
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) {
    throw new Error(`unsafe or invalid base commit for ${repo}`);
  }
  return `${repo.replace('/', '__')}@${commit}`;
}

function cloneGolden(source, destination) {
  if (existsSync(destination)) return;
  if (!existsSync(path.join(source, '.sweet-search', 'codebase.db'))) {
    throw new Error(`golden is missing or incomplete: ${source}`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const copied = spawnSync('/bin/cp', ['-cR', source, destination], { encoding: 'utf8' });
  if (copied.status !== 0) {
    throw new Error(`copy-on-write clone failed for ${source}: ${copied.stderr || copied.error}`);
  }
}

export function formatExecutionError(operation, result) {
  const raw = String(result.stderr || result.error?.message || result.error || '').replace(/\r/g, '');
  const excerpt = raw.length <= 500 ? raw : `${raw.slice(0, 80)}\n...\n${raw.slice(-400)}`;
  const status = result.status === null ? 'null' : String(result.status);
  return `${operation.command}: status=${status} signal=${result.signal || 'none'} ` +
    `error=${result.error?.code || 'none'}\n${excerpt}`.trim();
}

function runCurrent(candidate, task, options, cache) {
  const key = cacheKey(task);
  const projectRoot = path.join(options.work_root, 'goldens', key);
  cloneGolden(path.join(options.vault, key), projectRoot);
  const parsed = parseSafeSearchOperations(candidate.lead.map(call => call.command));
  const outputs = [];
  const errors = parsed.rejected.map(item => item.reason);
  const binDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../agent-read-workflows/bin');
  for (const operation of parsed.operations) {
    const cacheId = `${key}\0${operation.command}\0${JSON.stringify(operation.args)}`;
    let result = cache.get(cacheId);
    if (!result) {
      result = spawnSync(path.join(binDir, operation.command), operation.args, {
        cwd: projectRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120_000,
        // Each task runs against its own checked-out repo, so every spawn below
        // starts a fresh daemon. The resident-daemon cap and short idle-TTL that
        // stop those from piling up are defaulted in bin/_ss-helpers.mjs (single
        // source of truth); export SWEET_SEARCH_MAX_DAEMONS to override.
        env: {
          ...process.env,
          SWEET_SEARCH_PROJECT_ROOT: projectRoot,
          SWEET_SEARCH_EXACT_REREAD_OMISSION: '0',
          SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
        },
      });
      cache.set(cacheId, result);
    }
    outputs.push(result.stdout || '');
    if (result.status !== 0) errors.push(formatExecutionError(operation, result));
  }
  if (!parsed.operations.length) errors.push('no safely replayable search operation');
  return { parsed, outputs, errors, classification: classifyCurrentElimination(candidate, outputs.join('\n'), errors) };
}

function summarize(records) {
  const verdicts = {};
  for (const record of records) verdicts[record.verdict] = (verdicts[record.verdict] || 0) + 1;
  return { candidates: records.length, verdicts };
}

async function main() {
  const options = parseReplayArgs(process.argv.slice(2));
  const trajectoryDirs = prepareTrajectoryLists(options.trajectories);
  const ids = loadTaskIds(trajectoryDirs);
  const db = new Database(options.db, { readonly: true, fileMustExist: true });
  const selected = selectHistoricalSessions(db, ids);
  const candidates = extractSearchReadCandidates(db, selected);
  db.close();
  const base = { selectedTasks: selected.size, ...auditCandidates(candidates) };
  if (!options.execute) { console.log(JSON.stringify(base, null, 2)); return; }

  mkdirSync(options.work_root, { recursive: true });
  const tasks = taskMap(options.tasks);
  const completed = new Map();
  if (existsSync(options.results)) {
    for (const line of readFileSync(options.results, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      completed.set(row.id, row);
    }
  }
  const cache = new Map();
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (completed.has(candidate.id)) continue;
    const task = tasks.get(candidate.task);
    let row;
    if (!task) row = { id: candidate.id, task: candidate.task, verdict: 'uncertain', errors: ['task spec missing'] };
    else {
      const replay = runCurrent(candidate, task, options, cache);
      row = {
        id: candidate.id,
        task: candidate.task,
        verdict: replay.classification.verdict,
        expectedPayloads: replay.classification.expectedPayloads,
        payloads: replay.classification.payloads,
        matched: replay.classification.matched,
        operations: replay.parsed.operations,
        errors: replay.errors,
      };
    }
    appendFileSync(options.results, JSON.stringify(row) + '\n');
    completed.set(row.id, row);
    process.stderr.write(`[search-read replay] ${completed.size}/${candidates.length} ${row.id} ${row.verdict}\n`);
  }
  console.log(JSON.stringify({ ...base, ...summarize([...completed.values()]) }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
}
