// Unit fixtures for the turn-economy A/B's operation counter (stats/probe-count.mjs).
// These LOCK THE DEFINITION of a "retrieval-and-test operation" before any paid run,
// because operations/task is a HARD REVERT GATE and a mis-count there silently
// invalidates the anti-shotgun conclusion.
//
// The counter's job: recover the number of retrieval/test operations from a shell
// string that the harness records as ONE tool envelope. Edits and non-retrieval shell
// count zero on BOTH arms — this is the anti-shotgun metric, not "all operations".
//
// `node tests/probe-count.mjs` — exit 1 on any failure. Offline, zero spend.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeToolEnvelope,
  countOperations,
  countProbes,
  splitOperations,
  splitShell,
} from '../stats/probe-count.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'stats', 'probe-count.mjs');
const PACKAGING_SCRIPT = path.join(HERE, '..', 'stats', 'packaging-recompute.mjs');
const BATCH_WRAPPER = path.join(HERE, '..', '..', 'agent-read-workflows', 'bin', 'ss-batch');

let failures = 0;
let n = 0;

function eq(actual, expected, label) {
  n++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
}

function cliFailure(script, args) {
  try {
    execFileSync('node', [script, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: '', stderr: '' };
  } catch (error) {
    return {
      status: error.status,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
    };
  }
}

const probes = (cmd, want) => eq(countProbes(cmd), want, `countProbes(${JSON.stringify(cmd)})`);

// ── the shape the block actually asks for ────────────────────────────────────
probes('ss-grep "sym"', 1);
probes('ss-grep "sym"; ss-read src/x.rs 40 120', 2);
probes('ss-grep A; ss-read B; ss-search C', 3);
probes('ss-search "how does routing work"; ss-trace dispatch; ss-read a.go 1 60', 3);

// ── separators ───────────────────────────────────────────────────────────────
probes('ss-grep A && ss-read B', 2);
probes('ss-grep A || ss-read B', 2);
probes('ss-grep A\nss-read B', 2);

// ── quoting must not create phantom separators ───────────────────────────────
probes('ss-grep "a;b"', 1);
probes('ss-grep "a;b" ; ss-read C', 2);
probes("ss-grep 'x && y'", 1);
probes('ss-grep "a|b" | head -20', 1);          // a pipeline is ONE retrieval

// ── grouping: recursion, not opacity (regression: reported 1) ────────────────
probes('(ss-grep A; ss-read B) && ss-search C', 3);
probes('{ ss-grep A; ss-read B; }', 2);
probes('(ss-grep A)', 1);
probes('(cd src && ss-grep A); ss-read B', 2);

// ── env assignments and wrappers (regression: reported 1) ────────────────────
probes('X=1 ss-grep A; ss-read B', 2);
probes('FOO=bar BAZ=qux ss-search "x"', 1);
probes('timeout 60 ss-grep A', 1);
probes('timeout 60s ss-grep A; ss-read B', 2);
probes('env FOO=bar ss-search "x"', 1);
probes('command ss-grep A', 1);
probes('stdbuf -o0 ss-grep A', 1);
probes('/usr/bin/timeout 30 ss-grep A', 1);      // absolute-path wrapper

// ── quoting suppresses substitution (regression: reported 1) ─────────────────
probes("echo '$(ss-grep A)'", 0);            // single quotes: no substitution
probes('echo "$(ss-grep A)"', 1);            // double quotes: substitution happens
probes("X='a b' ss-grep A; ss-read B", 2);   // quoted assignment value
probes('X="a b" ss-grep A', 1);
probes("ss-grep 'literal $(not a call)'", 1);

// ── command substitution counts the inner retrieval too ──────────────────────
probes('ss-read "$(ss-grep -l foo)" 1 40', 2);
probes('echo "$(ss-grep A)"', 1);

// ── native-side retrieval counts identically (symmetry across arms) ──────────
probes('cat src/x.rs', 1);
probes('sed -n "1,40p" src/x.rs', 1);
probes('rg "sym" src', 1);
probes('grep -rn "sym" .', 1);
probes('cat a.py; sed -n "1,20p" b.py', 2);
probes('ls && ss-grep A', 2);                    // BOTH are retrieval operations

// ── non-retrieval shell counts ZERO on both arms ─────────────────────────────
probes('git log --oneline -5', 0);
probes('npm install', 0);
probes('cd src && npm test', 0);
probes('git log --oneline -5; git status', 0);
probes('', 0);
probes('   ', 0);

// ── run_tests is an operation ────────────────────────────────────────────────
probes('run_tests', 1);
probes('run_tests 2>&1 | tail -80', 1);
probes('ss-grep A; run_tests', 2);

// ── typed ss-batch: literal declared operations, never JSON substrings ────────
const batch2 = JSON.stringify({ operations: [
  { id: 'imports', tool: 'grep', args: { pattern: 'ss-read fake; run_tests', in: 'src/a.js' } },
  { id: 'caller', tool: 'trace', args: { symbol: 'dispatch' } },
] });
const batch3 = JSON.stringify({ operations: [
  ...JSON.parse(batch2).operations,
  { id: 'context', tool: 'read', args: { path: 'src/a.js', startLine: 1, endLine: 40 } },
] });
const doubleQuotedBatch2 = batch2.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
probes(`ss-batch '${batch2}'`, 2);
probes(`ss-batch '${batch3}'`, 3);
probes(`sweet-search batch '${batch2}'`, 2);
probes(`sweet-search batch '${batch3}'`, 3);
probes(`ss-batch "${doubleQuotedBatch2}"`, 2);
probes(`timeout 30 env TRACE=1 ss-batch '${batch2}'`, 2);
probes(`ss-batch '${batch2}'; run_tests`, 3);
probes(`ss-batch '{"operations":['`, 1);
probes(`ss-batch '{"operations":[]}'`, 1);
probes(`ss-batch '${batch2.replace('src/a.js', '${file}')}'`, 1);
probes(`ss-batch '${batch2.replace('src/a.js', '$imports.path')}'`, 1);
probes(`ss-batch '${batch2.replace('dispatch', '{{caller.symbol}}')}'`, 1);
probes(`ss-batch '${batch2.replace('dispatch', '<div> foo$ $open $importsPath `literal`')}'`, 2);
probes(`ss-batch '${batch2.replace('"symbol":"dispatch"', '"symbol":"dispatch","nested":{"ref":"imports"}')}'`, 1);
probes(`ss-batch '${batch2.replace('"imports"', '"bad.id"')}'`, 1);
probes(`ss-batch '${JSON.stringify({ ...JSON.parse(batch2), version: 1, maxChars: 1024 })}'`, 2);
probes(`ss-batch '${JSON.stringify({ ...JSON.parse(batch2), version: 2 })}'`, 1);
probes(`ss-batch '${JSON.stringify({ ...JSON.parse(batch2), maxChars: 1000 })}'`, 1);
probes(`ss-batch '${JSON.stringify({ ...JSON.parse(batch2), extra: true })}'`, 1);
probes(`ss-batch '${JSON.stringify({ operations: JSON.parse(batch2).operations.map((op, i) =>
  i ? op : { ...op, extra: true }) })}'`, 1);
probes(`sweet-search batch '{"operations":['`, 1);
probes('ss-batch "$(ss-grep request.json)"', 2);
probes(`ss-batch '${batch2.replace('ss-read fake; run_tests', '$(ss-grep literal)')}'`, 2);
eq(splitOperations(`ss-batch '${batch2}'`).map(({ kind, batch }) => ({ kind, batch })), [
  { kind: 'retrieval', batch: 'declared' },
  { kind: 'retrieval', batch: 'declared' },
], 'literal batch operations carry a declared tag');
eq(splitOperations(`ss-batch '{"operations":['`).map(({ kind, batch }) => ({ kind, batch })), [
  { kind: 'retrieval', batch: 'conservative' },
], 'malformed batch remains one conservatively tagged retrieval');

// ── canonical operation splitter and envelope categories ────────────────────
eq(countOperations('ss-grep A; run_tests; apply_patch patch.diff'), 2,
  'countOperations is the retrieval-and-test count');
eq(splitOperations('ss-grep A; run_tests; apply_patch patch.diff').map(x => x.kind),
  ['retrieval', 'test', 'edit'], 'splitOperations classifies retrieval/test/edit once');
eq(analyzeToolEnvelope('bash', 'ss-grep A; run_tests; apply_patch patch.diff'), {
  retrievalEnvelope: true,
  testEnvelope: true,
  editEnvelope: true,
  retrievalOperations: 1,
  testOperations: 1,
  operations: 2,
}, 'one canonical analysis supplies all envelope and operation counts');
eq(analyzeToolEnvelope('edit', ''), {
  retrievalEnvelope: false,
  testEnvelope: false,
  editEnvelope: true,
  retrievalOperations: 0,
  testOperations: 0,
  operations: 0,
}, 'typed edit envelope is not an operation');
probes('sed -i s/old/new/ src/x.js', 0);

// ── splitShell contract ──────────────────────────────────────────────────────
eq(splitShell('a; b && c || d'), ['a', 'b', 'c', 'd'], 'splitShell separators');
eq(splitShell('a "x; y" ; b'), ['a "x; y"', 'b'], 'splitShell quoted separator');
eq(splitShell('a | b'), ['a | b'], 'splitShell does not split pipes');
eq(splitShell('(a; b); c'), ['(a; b)', 'c'], 'splitShell keeps groups intact');

// ── the two documented un-handled forms: assert we KNOW we miss them ─────────
// Not bugs to fix silently — they are the audit boundary named in the header.
// If a pilot rollout contains one of these, it is hand-audited.
probes('eval "ss-grep A; ss-read B"', 0);        // eval-constructed: invisible, by design

// ── end-to-end meter admission fixture ───────────────────────────────────────
// This locks both denominators that can otherwise drift silently: exact rollout
// count per arm and exact retrieval-and-test operations per arm.
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'probe-count-'));
const resultRoot = path.join(fixtureRoot, 'result');
mkdirSync(path.join(resultRoot, 'agent-state'), { recursive: true });
mkdirSync(path.join(resultRoot, 'turns'), { recursive: true });

// The wrapper must add only the canonical `batch` subcommand and must not eval args.
const fakeBin = path.join(fixtureRoot, 'fake-bin');
mkdirSync(fakeBin);
writeFileSync(path.join(fakeBin, 'node'), '#!/usr/bin/env bash\nprintf \'%s\\0\' "$@"\n');
chmodSync(path.join(fakeBin, 'node'), 0o755);
const wrapperArgs = [batch2, '$(printf INJECTED)', 'argument with spaces'];
const forwarded = execFileSync(BATCH_WRAPPER, wrapperArgs, {
  encoding: 'utf8', env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
}).split('\0').filter(Boolean);
eq(Boolean(statSync(BATCH_WRAPPER).mode & 0o111), true, 'ss-batch wrapper is executable');
eq(forwarded, [path.resolve(HERE, '../../..', 'core/cli.js'), 'batch', ...wrapperArgs],
  'ss-batch delegates to the canonical CLI with arguments unchanged');

function makeRollout(name, tools, modelTurns) {
  const store = path.join(resultRoot, 'agent-state', name, 'opencode-data');
  mkdirSync(store, { recursive: true });
  execFileSync('python3', ['-c', `
import sqlite3, json, sys
db, tools = sys.argv[1], json.loads(sys.argv[2])
c = sqlite3.connect(db)
c.execute("create table part (id text primary key, message_id text, session_id text, "
          "time_created integer, time_updated integer, data text)")
for i, tool in enumerate(tools):
    data = {"type": "tool", "tool": tool["tool"],
            "state": {"input": {"command": tool.get("command", "")}}}
    c.execute("insert into part values (?,?,?,?,?,?)",
              (f"p{i}", tool.get("message", f"m{i}"), "s1", i, i, json.dumps(data)))
c.commit(); c.close()
`, path.join(store, 'opencode.db'), JSON.stringify(tools)]);

  const lines = [JSON.stringify({ kind: 'meta', source: 'stream', turns: modelTurns })];
  for (let turn = 1; turn <= modelTurns; turn++) {
    lines.push(JSON.stringify({ t: turn, in: 1000 + turn, cached: 500, out: 10 }));
  }
  writeFileSync(path.join(resultRoot, 'turns', `${name}.jsonl`), `${lines.join('\n')}\n`);
}

makeRollout('task-a-native', [
  { tool: 'grep', message: 'm1' },
  { tool: 'bash', command: 'run_tests', message: 'm2' },
  { tool: 'edit', message: 'm3' },
], 4);
makeRollout('task-b-native', [
  { tool: 'bash', command: 'rg x; cat y', message: 'm1' },
  { tool: 'bash', command: 'sed -i s/x/y/ src/x.js', message: 'm2' },
], 2);
makeRollout('task-a-sweet', [
  { tool: 'bash', command: 'ss-grep A; ss-read B', message: 'm1' },
  { tool: 'bash', command: 'run_tests', message: 'm2' },
  { tool: 'write', message: 'm3' },
], 3);
makeRollout('task-b-sweet', [
  { tool: 'bash', command: 'ss-search A; run_tests; ss-read B', message: 'm1' },
], 5);

const meter = JSON.parse(execFileSync('node', [SCRIPT, resultRoot, '--expect', '2', '--json'],
  { encoding: 'utf8' }));
eq(meter.verdict, 'VALID', 'meter fixture is admitted');
eq(meter.sampleCount, { total: 4, perArm: { native: 2, sweet: 2 } },
  'meter reports exact rollout sample count per arm');
eq(meter.perArm.native.operations, 4, 'meter reports exact native operations');
eq(meter.perArm.sweet.operations, 6, 'meter reports exact sweet operations');
const nativeATurns = meter.rollouts.find(rollout => rollout.rollout === 'task-a-native');
eq({
  modelTurns: nativeATurns?.modelTurns,
  toolBearingModelTurns: nativeATurns?.toolBearingModelTurns,
  source: nativeATurns?.modelTurnsSource,
}, { modelTurns: 4, toolBearingModelTurns: 3, source: 'turn-log' },
  'meter distinguishes actual model turns from tool-bearing model turns');
eq({
  retrieval: meter.perArm.native.retrievalEnvelopes,
  test: meter.perArm.native.testEnvelopes,
  edit: meter.perArm.native.editEnvelopes,
  turns: meter.perArm.native.modelTurns,
}, { retrieval: 3, test: 1, edit: 2, turns: 6 }, 'meter emits explicit native counts');
eq({
  retrieval: meter.perArm.sweet.retrievalEnvelopes,
  test: meter.perArm.sweet.testEnvelopes,
  edit: meter.perArm.sweet.editEnvelopes,
  turns: meter.perArm.sweet.modelTurns,
}, { retrieval: 3, test: 2, edit: 1, turns: 8 }, 'meter emits explicit sweet counts');

let invalidMeter;
try {
  execFileSync('node', [SCRIPT, resultRoot, '--expect', '3', '--json'], { encoding: 'utf8' });
} catch (error) {
  invalidMeter = JSON.parse(error.stdout || '{}');
}
eq(invalidMeter?.verdict, 'INVALID — not adjudicated', 'sample-count drift blocks the meter');
eq(invalidMeter?.admissionFailures, [
  'native has 2 rollouts, expected 3',
  'sweet has 2 rollouts, expected 3',
], 'sample-count admission names every drifting arm');

const invalidProbeFlag = cliFailure(SCRIPT, [resultRoot, '--expect', '2', '--unknown']);
eq({ status: invalidProbeFlag.status, usage: /usage:/.test(invalidProbeFlag.stderr) },
  { status: 2, usage: true }, 'probe meter rejects unknown flags');

// The archival recompute reads actual assistant messages separately from tool
// envelopes. Keep that distinction executable: answer-only turns must not vanish.
const packagingDb = path.join(fixtureRoot, 'packaging.db');
execFileSync('python3', ['-c', `
import sqlite3, json, sys
db = sys.argv[1]
c = sqlite3.connect(db)
c.execute("create table session (id text primary key, directory text)")
c.execute("create table message (id text primary key, session_id text, data text)")
c.execute("create table part (id text primary key, message_id text, session_id text, data text)")
sessions = [
    ("native-session", "/root/.ss-eval/runs/task__native__r0", 3),
    ("sweet-session", "/root/.ss-eval/runs/task__sweet__r0", 4),
]
for sid, directory, turns in sessions:
    c.execute("insert into session values (?,?)", (sid, directory))
    c.execute("insert into message values (?,?,?)",
              (f"{sid}-user", sid, json.dumps({"role": "user"})))
    for turn in range(1, turns + 1):
        c.execute("insert into message values (?,?,?)",
                  (f"{sid}-m{turn}", sid, json.dumps({"role": "assistant"})))
tools = [
    ("n1", "native-session-m1", "native-session", "bash", "rg x; cat y"),
    ("n2", "native-session-m3", "native-session", "bash", "run_tests"),
    ("s1", "sweet-session-m1", "sweet-session", "bash", "ss-grep A; ss-read B"),
    ("s2", "sweet-session-m1", "sweet-session", "edit", ""),
    ("s3", "sweet-session-m3", "sweet-session", "bash", "run_tests"),
]
for pid, mid, sid, tool, command in tools:
    data = {"type": "tool", "tool": tool,
            "state": {"input": {"command": command}}}
    c.execute("insert into part values (?,?,?,?)", (pid, mid, sid, json.dumps(data)))
c.commit(); c.close()
`, packagingDb]);

const packaging = JSON.parse(execFileSync('node', [PACKAGING_SCRIPT, '--json', packagingDb],
  { encoding: 'utf8' }));
eq({
  native: {
    modelTurns: packaging.native?.modelTurns,
    toolBearingTurns: packaging.native?.toolBearingTurns,
    operations: packaging.native?.operations,
  },
  sweet: {
    modelTurns: packaging.sweet?.modelTurns,
    toolBearingTurns: packaging.sweet?.toolBearingTurns,
    operations: packaging.sweet?.operations,
  },
}, {
  native: { modelTurns: 3, toolBearingTurns: 2, operations: 3 },
  sweet: { modelTurns: 4, toolBearingTurns: 2, operations: 3 },
}, 'packaging recompute separates actual model turns from tool-bearing turns');

const invalidPackagingFlag = cliFailure(PACKAGING_SCRIPT, [packagingDb, '--unknown']);
eq({ status: invalidPackagingFlag.status, usage: /usage:/.test(invalidPackagingFlag.stderr) },
  { status: 2, usage: true }, 'packaging recompute rejects unknown flags');

execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("delete from message where id='sweet-session-m3'")
c.commit(); c.close()
`, packagingDb]);
const incompleteMessages = cliFailure(PACKAGING_SCRIPT, [packagingDb, '--json']);
eq({
  status: incompleteMessages.status,
  detected: /message-table extraction is incomplete/.test(incompleteMessages.stderr),
}, { status: 1, detected: true },
  'packaging recompute blocks incomplete assistant-message extraction');

rmSync(fixtureRoot, { recursive: true, force: true });

console.log(`${n - failures}/${n} assertions passed`);
if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
