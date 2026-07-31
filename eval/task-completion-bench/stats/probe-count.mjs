#!/usr/bin/env node
/**
 * Canonical retrieval-and-test operation meter for the turn-economy A/B.
 * It separates operations from tool envelopes, parses shell composition recursively,
 * and reads only copied OpenCode stores. See tests/probe-count.mjs for parser scope.
 * Usage: node stats/probe-count.mjs <results/RUN_ID> [--expect N] [--json]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @typedef {'retrieval' | 'test' | 'edit'} OperationKind */
/** @typedef {{ kind: OperationKind, command: string,
 *   batch?: 'declared' | 'conservative' }} ShellOperation */

/** Head-of-command matcher for a retrieval operation. */
const RETRIEVAL_OP = /^(ss[-_](search|grep|find|read|semantic|trace)|sweet-search|cat|head|tail|nl|bat|less|sed|rg|grep|ag|ack|find|ls)$/;
/** Leading wrappers that delegate to a real command; strip then re-inspect the head. */
const WRAPPER = /^(timeout|env|command|nice|time|stdbuf|nohup|ionice)$/;
const NATIVE_RETRIEVAL_TOOLS = new Set(['read', 'grep', 'glob', 'list']);
const NATIVE_EDIT_TOOLS = new Set([
  'apply_patch', 'edit', 'write', 'patch', 'multiedit', 'multi_edit',
  'notebookedit', 'notebook_edit',
]);
const BATCH_TOOLS = new Set(['search', 'grep', 'find', 'read', 'semantic', 'trace']);
const BATCH_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const REFERENCE_KEYS = new Set(['ref', '$ref', 'fromOperation', 'from_operation']);
/** Split a shell string into top-level segments on ; && || and newlines, honouring
 *  quotes, parens and braces. Pipes are NOT split: a pipeline is one operation. */
export function splitShell(cmd) {
  const out = [];
  let cur = '', q = null, depth = 0;
  const s = String(cmd || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q && s[i - 1] !== '\\') q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === '}') { depth--; cur += c; continue; }
    if (depth === 0) {
      if (c === ';' || c === '\n') { out.push(cur); cur = ''; continue; }
      if ((c === '&' && s[i + 1] === '&') || (c === '|' && s[i + 1] === '|')) {
        out.push(cur); cur = ''; i++; continue;
      }
    }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

/** Extract the bodies of every `$( … )` substitution NOT inside single quotes.
 *  Single quotes suppress substitution in POSIX shells; double quotes do not. */
function substitutions(seg) {
  const out = [];
  let q = null;                                  // "'" suppresses; '"' does not
  for (let i = 0; i < seg.length - 1; i++) {
    const c = seg[i];
    if (q === "'") { if (c === "'") q = null; continue; }
    if (q === '"') {
      if (c === '"' && seg[i - 1] !== '\\') { q = null; continue; }
    } else {
      if (c === "'") { q = "'"; continue; }
      if (c === '"') { q = '"'; continue; }
    }
    if (c === '$' && seg[i + 1] === '(') {
      let d = 1, j = i + 2, body = '';
      while (j < seg.length && d > 0) {
        if (seg[j] === '(') d++;
        else if (seg[j] === ')') { d--; if (!d) break; }
        body += seg[j]; j++;
      }
      out.push(body);
      i = j;
    }
  }
  return out;
}

/** Split a segment into words, honouring quotes (so `X='a b' cmd` is two words). */
function tokenize(seg) {
  const toks = [];
  let cur = '', q = null, started = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (q === '"' && c === '\\' && /["\\$`]/.test(seg[i + 1])) {
        cur += seg[++i];
        continue;
      }
      if (c === q && seg[i - 1] !== '\\') q = null; else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; started = true; continue; }
    if (/\s/.test(c)) { if (cur || started) { toks.push(cur); cur = ''; started = false; } continue; }
    cur += c;
  }
  if (cur || started) toks.push(cur);
  return toks;
}

/** Strip leading assignments/wrappers and return the effective command words. */
function effectiveTokens(seg) {
  let toks = tokenize(seg);
  for (;;) {
    if (!toks.length) return toks;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) { toks = toks.slice(1); continue; }
    const base = path.basename(toks[0]);
    if (WRAPPER.test(base)) {
      toks = toks.slice(1);
      // drop the wrapper's own options/operands (e.g. `timeout 60`, `stdbuf -o0`)
      while (toks.length && /^(?:-{1,2}.+|\d+(?:\.\d+)?[smhd]?)$/.test(toks[0])) {
        toks = toks.slice(1);
      }
      continue;
    }
    return [base, ...toks.slice(1)];
  }
}

function dynamicBatchValue(value, ids) {
  if (typeof value === 'string') {
    if (/\$\{[^}]*\}|\{\{[\s\S]*?\}\}/.test(value)) return true;
    return ids.some((id) => {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\$${escaped}(?=$|[.\\[::{_\\-0-9])`).test(value);
    });
  }
  if (Array.isArray(value)) return value.some(item => dynamicBatchValue(item, ids));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    REFERENCE_KEYS.has(key) || dynamicBatchValue(item, ids));
}

/** Return 2–3 for a valid literal request; all other batch shapes are one operation. */
function batchOperationCount(payload) {
  let request;
  try { request = JSON.parse(payload); } catch { return 1; }
  const ops = request?.operations;
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some(key => !['version', 'operations', 'maxChars'].includes(key)) ||
      ![undefined, 1].includes(request.version) ||
      (request.maxChars != null && (!Number.isInteger(request.maxChars) ||
        request.maxChars < 1024 || request.maxChars > 64_000)) ||
      !Array.isArray(ops) || ![2, 3].includes(ops.length)) return 1;
  const valid = ops.every(op => op && typeof op === 'object' && !Array.isArray(op) &&
    Object.keys(op).every(key => ['id', 'tool', 'args'].includes(key)) &&
    BATCH_ID.test(op.id) && BATCH_TOOLS.has(op.tool) && op.args &&
    typeof op.args === 'object' && !Array.isArray(op.args));
  const ids = valid ? ops.map(op => op.id) : [];
  return valid && new Set(ids).size === ids.length &&
    !ops.some(op => dynamicBatchValue(op.args, ids)) ? ops.length : 1;
}

/**
 * Split one shell string into classified retrieval, test, and edit operations.
 * This is the canonical operation parser used by every stats consumer. The hard
 * `operations` metric counts only the returned retrieval and test entries; edits
 * are retained so envelope classification cannot drift to a second parser.
 *
 * @param {unknown} cmd
 * @returns {ShellOperation[]}
 */
export function splitOperations(cmd) {
  /** @type {ShellOperation[]} */
  const operations = [];
  for (const seg of splitShell(cmd)) {
    // Recurse into ( … ) and { … } groups rather than treating them as one command.
    const grouped = seg.match(/^[({]([\s\S]*)[)}]$/);
    if (grouped) { operations.push(...splitOperations(grouped[1])); continue; }
    const tokens = effectiveTokens(seg);
    const head = tokens[0] || '';
    for (const sub of substitutions(seg)) operations.push(...splitOperations(sub));
    const batchArg = head === 'ss-batch' ? tokens[1] :
      head === 'sweet-search' && tokens[1] === 'batch' ? tokens[2] : null;
    if (batchArg !== null) {
      const count = batchOperationCount(batchArg);
      const batch = count > 1 ? 'declared' : 'conservative';
      for (let i = 0; i < count; i++) operations.push({ kind: 'retrieval', command: seg, batch });
      continue;
    }
    if (head === 'run_tests') operations.push({ kind: 'test', command: seg });
    else if (/\bapply_patch\b/.test(seg) || (head === 'sed' && /(?:^|\s)-i(?:\s|$)/.test(seg))) {
      operations.push({ kind: 'edit', command: seg });
    } else if (RETRIEVAL_OP.test(head)) {
      operations.push({ kind: 'retrieval', command: seg });
    }
  }
  return operations;
}

/** Count retrieval-and-test operations inside one shell string. Recursive. */
export function countOperations(cmd) {
  return splitOperations(cmd).filter(operation => operation.kind !== 'edit').length;
}

/** Backwards-compatible name retained for existing callers. */
export function countProbes(cmd) {
  return countOperations(cmd);
}

/**
 * Classify one tool envelope using the same parser that supplies the hard operation
 * count. `retrievalEnvelope` deliberately means a retrieval-or-test envelope: this
 * is the denominator ratified in TURN_FIX_PLAN and the handoff's 143/70 correction.
 *
 * @param {unknown} tool
 * @param {unknown} command
 * @returns {{ retrievalEnvelope: boolean, testEnvelope: boolean, editEnvelope: boolean,
 *   retrievalOperations: number, testOperations: number, operations: number }}
 */
export function analyzeToolEnvelope(tool, command = '') {
  const name = String(tool || '').toLowerCase();
  /** @type {ShellOperation[]} */
  let classified = [];
  if (name === 'bash' || name === 'shell') classified = splitOperations(command);
  else if (NATIVE_RETRIEVAL_TOOLS.has(name)) {
    classified = [{ kind: 'retrieval', command: `${name} ${String(command || '')}`.trim() }];
  } else if (NATIVE_EDIT_TOOLS.has(name)) {
    classified = [{ kind: 'edit', command: `${name} ${String(command || '')}`.trim() }];
  }

  const retrievalOperations = classified.filter(operation => operation.kind === 'retrieval').length;
  const testOperations = classified.filter(operation => operation.kind === 'test').length;
  const operations = retrievalOperations + testOperations;
  return {
    retrievalEnvelope: operations > 0,
    testEnvelope: testOperations > 0,
    editEnvelope: classified.some(operation => operation.kind === 'edit'),
    retrievalOperations,
    testOperations,
    operations,
  };
}

function findDb(dir) {
  const hits = [];
  const walk = (d, depth = 0) => {
    if (depth > 4) return;
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith('.db')) hits.push(p);
    }
  };
  walk(dir);
  return hits.sort((a, b) => statSync(b).size - statSync(a).size)[0];
}

/**
 * Read tool parts via python3's sqlite3 (the box has no `sqlite3` CLI and Node 20 has no
 * `node:sqlite`). The db + WAL + shm are copied to a scratch dir first, so the run's own
 * store is never opened for write and an un-checkpointed WAL is not lost.
 */
function readToolParts(db) {
  const py = `
import sqlite3, shutil, tempfile, os, json, sys
src = ${JSON.stringify(db)}
tmp = tempfile.mkdtemp()
dst = os.path.join(tmp, "c.db")
for suf in ("", "-wal", "-shm"):
    if os.path.exists(src + suf):
        shutil.copyfile(src + suf, dst + suf)
try:
    c = sqlite3.connect(dst)
    rows = c.execute(
        "select session_id, message_id, json_extract(data,'$.tool'), "
        "coalesce(json_extract(data,'$.state.input.command'),'') "
        "from part where json_extract(data,'$.type')='tool'").fetchall()
    c.close()
    print(json.dumps(rows))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
`;
  const out = execFileSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return JSON.parse(out);
}

/**
 * Read a persisted per-turn log. `in` already includes cached input tokens.
 * Aggregate-only logs are not a model-turn distribution and are rejected.
 *
 * @param {string} file
 * @returns {{ modelTurns?: number, ctxPerTurn?: number, error?: string }}
 */
export function readTurnLog(file) {
  if (!existsSync(file)) return { error: 'turn log missing' };
  let inputTokens = 0, modelTurns = 0, meta = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { return { error: 'turn log unparseable' }; }
    if (record.kind === 'meta') { meta = record; continue; }
    if (typeof record.in !== 'number' || !Number.isFinite(record.in)) {
      return { error: 'turn record missing finite `in`' };
    }
    inputTokens += record.in;
    modelTurns++;
  }
  if (meta && meta.source === 'aggregate') {
    return { error: 'turn log is source:aggregate — not a turn distribution' };
  }
  if (!modelTurns) return { error: 'turn log has no turn records' };
  return { modelTurns, ctxPerTurn: inputTokens / modelTurns };
}

/**
 * Analyze one rollout store.
 *
 * @param {string} dir rollout agent-state directory
 * @param {{ turnLog?: string }} [options]
 * @returns {null | { totalEnvelopes: number, retrievalEnvelopes: number,
 *   testEnvelopes: number, editEnvelopes: number, retrievalOperations: number,
 *   testOperations: number, operations: number, modelTurns: number,
 *   toolBearingModelTurns: number, modelTurnsSource: 'turn-log' | 'tool-messages',
 *   fusedEnvelopes: number, envelopes: number, probes: number, turns: number,
 *   fused: number, turnLogError?: string }}
 */
export function analyzeRollout(dir, options = {}) {
  const db = findDb(dir);
  if (!db) return null;
  let rows;
  try { rows = readToolParts(db); } catch (e) {
    console.error(`  [skip] ${dir}: ${String(e.message).slice(0, 120)}`);
    return null;
  }

  const toolTurns = new Set();
  let totalEnvelopes = 0, retrievalEnvelopes = 0, testEnvelopes = 0, editEnvelopes = 0;
  let retrievalOperations = 0, testOperations = 0, operations = 0, fusedEnvelopes = 0;
  for (const [sid, mid, tool, cmd] of rows) {
    totalEnvelopes++;
    toolTurns.add(`${sid || ''}|${mid}`);
    const envelope = analyzeToolEnvelope(tool, cmd);
    retrievalEnvelopes += Number(envelope.retrievalEnvelope);
    testEnvelopes += Number(envelope.testEnvelope);
    editEnvelopes += Number(envelope.editEnvelope);
    retrievalOperations += envelope.retrievalOperations;
    testOperations += envelope.testOperations;
    operations += envelope.operations;
    if (envelope.operations > 1) fusedEnvelopes++;
  }

  const loggedTurns = options.turnLog ? readTurnLog(options.turnLog) : null;
  const modelTurns = loggedTurns && !loggedTurns.error ? loggedTurns.modelTurns : toolTurns.size;
  return {
    totalEnvelopes,
    retrievalEnvelopes,
    testEnvelopes,
    editEnvelopes,
    retrievalOperations,
    testOperations,
    operations,
    modelTurns,
    toolBearingModelTurns: toolTurns.size,
    modelTurnsSource: loggedTurns && !loggedTurns.error ? 'turn-log' : 'tool-messages',
    fusedEnvelopes,
    // Compatibility aliases for archival callers. New stats must use explicit names.
    envelopes: totalEnvelopes,
    probes: operations,
    turns: modelTurns,
    fused: fusedEnvelopes,
    ...(loggedTurns?.error ? { turnLogError: loggedTurns.error } : {}),
  };
}

// CLI entry — guarded so the parser above can be imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const expectIndex = args.indexOf('--expect');
  const expectedPairs = expectIndex >= 0 ? Number(args[expectIndex + 1]) : null;
  const inputs = args.filter((arg, index) =>
    arg !== '--json' && arg !== '--expect' && !(expectIndex >= 0 && index === expectIndex + 1));
  const input = inputs[0];
  const unknownFlag = args.find(arg => arg.startsWith('--') && arg !== '--json' && arg !== '--expect');
  if (!input || inputs.length !== 1 || unknownFlag ||
      (expectedPairs !== null && (!Number.isInteger(expectedPairs) || expectedPairs <= 0))) {
    console.error('usage: node stats/probe-count.mjs <results/RUN_ID> [--expect N] [--json]');
    process.exit(2);
  }

  const resolvedInput = path.resolve(input);
  const resultRoot = path.basename(resolvedInput) === 'agent-state'
    ? path.dirname(resolvedInput)
    : resolvedInput;
  const root = path.basename(resolvedInput) === 'agent-state'
    ? resolvedInput
    : path.join(resolvedInput, 'agent-state');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`no agent-state directory for result path ${input}`);
    process.exit(2);
  }

  const admissionFailures = [];
  const perArm = {};
  const rollouts = [];
  for (const name of readdirSync(root).sort()) {
    const dir = path.join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const arm = name.endsWith('-sweet') ? 'sweet' : name.endsWith('-native') ? 'native' : 'other';
    const turnLog = path.join(resultRoot, 'turns', `${name}.jsonl`);
    const r = analyzeRollout(dir, { turnLog });
    if (!r) {
      admissionFailures.push(`${name}: agent-state unreadable`);
      continue;
    }
    if (r.turnLogError && expectedPairs !== null) {
      admissionFailures.push(`${name}: ${r.turnLogError} (model-turn count unavailable)`);
    }
    if (arm === 'other') admissionFailures.push(`${name}: rollout arm suffix is not native or sweet`);
    rollouts.push({ rollout: name, arm, ...r });
    (perArm[arm] ||= {
      rollouts: 0,
      totalEnvelopes: 0,
      retrievalEnvelopes: 0,
      testEnvelopes: 0,
      editEnvelopes: 0,
      retrievalOperations: 0,
      testOperations: 0,
      operations: 0,
      modelTurns: 0,
      fusedEnvelopes: 0,
    });
    const aggregate = perArm[arm];
    aggregate.rollouts++;
    for (const key of ['totalEnvelopes', 'retrievalEnvelopes', 'testEnvelopes',
      'editEnvelopes', 'retrievalOperations', 'testOperations', 'operations',
      'modelTurns', 'fusedEnvelopes']) aggregate[key] += r[key];
  }

  if (!rollouts.length) admissionFailures.push('no readable rollouts');
  if (expectedPairs !== null) {
    for (const [arm, aggregate] of Object.entries(perArm)) {
      if (arm !== 'other' && aggregate.rollouts !== expectedPairs) {
        admissionFailures.push(`${arm} has ${aggregate.rollouts} rollouts, expected ${expectedPairs}`);
      }
    }
  }

  // Compatibility aliases are output-only; all calculations above use explicit names.
  for (const aggregate of Object.values(perArm)) {
    aggregate.n = aggregate.rollouts;
    aggregate.envelopes = aggregate.totalEnvelopes;
    aggregate.probes = aggregate.operations;
    aggregate.turns = aggregate.modelTurns;
    aggregate.fused = aggregate.fusedEnvelopes;
  }
  const sampleCount = {
    total: rollouts.length,
    perArm: Object.fromEntries(Object.entries(perArm).map(([arm, value]) => [arm, value.rollouts])),
  };
  const report = {
    resultPath: resultRoot,
    expectedPairs,
    sampleCount,
    rollouts,
    perArm,
    ...(admissionFailures.length
      ? { verdict: 'INVALID — not adjudicated', admissionFailures: [...new Set(admissionFailures)] }
      : { verdict: 'VALID' }),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('rollout'.padEnd(44), 'ret-env'.padStart(7), 'test-env'.padStart(8),
                'edit-env'.padStart(8), 'ops'.padStart(6), 'turns'.padStart(6),
                'ops/ret'.padStart(7));
    for (const r of rollouts) {
      console.log(r.rollout.padEnd(44), String(r.retrievalEnvelopes).padStart(7),
                  String(r.testEnvelopes).padStart(8), String(r.editEnvelopes).padStart(8),
                  String(r.operations).padStart(6), String(r.modelTurns).padStart(6),
                  (r.operations / (r.retrievalEnvelopes || 1)).toFixed(2).padStart(7));
    }
    console.log('\n=== per arm ===');
    for (const [arm, a] of Object.entries(perArm)) {
      console.log(`${arm.padEnd(8)} n=${a.rollouts}  retrieval-envelopes=${a.retrievalEnvelopes}  ` +
        `test-envelopes=${a.testEnvelopes}  edit-envelopes=${a.editEnvelopes}  ` +
        `operations=${a.operations}  model-turns=${a.modelTurns}  ` +
        `operations/retrieval-envelope=${(a.operations / (a.retrievalEnvelopes || 1)).toFixed(2)}  ` +
        `operations/model-turn=${(a.operations / (a.modelTurns || 1)).toFixed(2)}`);
    }
    if (admissionFailures.length) {
      console.error('\nVERDICT: INVALID — not adjudicated');
      for (const failure of [...new Set(admissionFailures)]) console.error(`  - ${failure}`);
    }
  }
  if (admissionFailures.length) process.exit(1);
}
