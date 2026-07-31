// Mechanism report for the turn-economy SMOKE. Deliberately narrow.
//
// The smoke answers ONE question: does the instruction block change how the model
// PACKAGES its work — more retrieval-and-test operations per tool envelope, fewer
// envelopes per turn? At n=5 pairs it cannot answer whether that helps, so this
// script reports NO solve rate, NO cost, and NO pass/fail verdict. Those belong to
// stage 1/2 and `stats/turn-economy-ab.mjs`, which carries the predeclared gates.
//
// It prints turns/task alongside, clearly marked as directional only — turns is the
// stage-gated metric and a 5-pair reading of it is not evidence, but suppressing it
// entirely would hide a treatment that fuses operations while inflating turns.
//
// usage: node stats/turn-economy-smoke.mjs <controlResultPath> <variantResultPath>
//          [--expect N] [--json]
// Bare run IDs remain accepted for compatibility and resolve under `results/`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRollout } from './probe-count.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Resolve an explicit result path, with the historical bare-run-ID form as fallback. */
function resolveResultPath(input) {
  const explicit = path.resolve(input);
  if (existsSync(explicit)) return explicit;
  const legacy = path.join(BENCH, 'results', input);
  if (existsSync(legacy)) return legacy;
  throw new Error(`result path does not exist: ${input}`);
}

/** Load exactly one sweet row and one readable rollout per task. */
function collect(input) {
  const resultPath = resolveResultPath(input);
  const root = path.join(resultPath, 'agent-state');
  const rowsPath = path.join(resultPath, 'rows.json');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`no agent-state for result ${resultPath}`);
  }
  if (!existsSync(rowsPath)) throw new Error(`no rows.json in ${resultPath}`);

  const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
  if (!Array.isArray(rows)) throw new Error(`rows.json is not an array in ${resultPath}`);
  const expectedRows = new Map();
  const problems = [];
  for (const row of rows.filter(candidate => candidate.arm === 'sweet')) {
    if (!row.taskId) { problems.push('sweet row missing taskId'); continue; }
    if (expectedRows.has(row.taskId)) {
      problems.push(`duplicate sweet row: ${row.taskId}`);
      continue;
    }
    expectedRows.set(row.taskId, row);
    if (typeof row.resolved !== 'boolean') {
      problems.push(`${row.taskId}: resolved is ${row.resolved === null ? 'null' : typeof row.resolved}` +
        ' — solve evidence missing, not adjudicable');
    }
  }
  if (!expectedRows.size) problems.push('no sweet rows');

  const out = new Map();
  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith('-sweet')) continue;
    const dir = path.join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const task = name.replace(/-sweet$/, '');
    const r = analyzeRollout(dir, {
      turnLog: path.join(resultPath, 'turns', `${name}.jsonl`),
    });
    if (!r) { problems.push(`${task}: agent-state unreadable`); continue; }
    if (r.turnLogError) problems.push(`${task}: ${r.turnLogError}`);
    if (out.has(task)) { problems.push(`duplicate sweet rollout: ${task}`); continue; }
    out.set(task, r);
  }
  for (const task of expectedRows.keys()) {
    if (!out.has(task)) problems.push(`${task}: sweet row has no readable rollout`);
  }
  for (const task of out.keys()) {
    if (!expectedRows.has(task)) problems.push(`${task}: sweet rollout has no result row`);
  }
  return { input, resultPath, out, problems };
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const expectIndex = args.indexOf('--expect');
const expectedPairs = expectIndex >= 0 ? Number(args[expectIndex + 1]) : 5;
const inputs = args.filter((arg, index) =>
  arg !== '--json' && arg !== '--expect' && !(expectIndex >= 0 && index === expectIndex + 1));
const [ctrlId, varId] = inputs;
const unknownFlag = args.find(arg => arg.startsWith('--') && arg !== '--json' && arg !== '--expect');
if (!ctrlId || !varId || inputs.length !== 2 || unknownFlag ||
    !Number.isInteger(expectedPairs) || expectedPairs <= 0) {
  console.error('usage: node stats/turn-economy-smoke.mjs <controlResultPath> <variantResultPath> [--expect N] [--json]');
  process.exit(2);
}

let control, variant;
try {
  control = collect(ctrlId);
  variant = collect(varId);
} catch (error) {
  console.error(String(error.message || error));
  process.exit(2);
}
const A = control.out;
const B = variant.out;

// Pair strictly. No selected subset is reported as a completed mechanism stage.
const paired = [...A.keys()].filter(t => B.has(t)).sort();
const onlyA = [...A.keys()].filter(t => !B.has(t));
const onlyB = [...B.keys()].filter(t => !A.has(t));
const admissionFailures = [...control.problems, ...variant.problems];
if (A.size !== expectedPairs) admissionFailures.push(`control has ${A.size} tasks, expected ${expectedPairs}`);
if (B.size !== expectedPairs) admissionFailures.push(`variant has ${B.size} tasks, expected ${expectedPairs}`);
if (onlyA.length) admissionFailures.push(`${onlyA.length} task(s) only in control: ${onlyA.join(', ')}`);
if (onlyB.length) admissionFailures.push(`${onlyB.length} task(s) only in variant: ${onlyB.join(', ')}`);

if (admissionFailures.length) {
  const invalid = {
    verdict: 'INVALID — not adjudicated',
    expectedPairs,
    pairedTasks: paired.length,
    controlPath: control.resultPath,
    variantPath: variant.resultPath,
    admissionFailures: [...new Set(admissionFailures)],
  };
  if (asJson) console.log(JSON.stringify(invalid, null, 2));
  else {
    console.error('VERDICT: INVALID — not adjudicated');
    for (const failure of invalid.admissionFailures) console.error(`  - ${failure}`);
  }
  process.exit(1);
}

const rows = paired.map(t => {
  const a = A.get(t), b = B.get(t);
  return {
    task: t,
    operationsPerRetrievalEnvelopeA: a.operations / (a.retrievalEnvelopes || 1),
    operationsPerRetrievalEnvelopeB: b.operations / (b.retrievalEnvelopes || 1),
    retrievalEnvelopesPerTurnA: a.retrievalEnvelopes / (a.modelTurns || 1),
    retrievalEnvelopesPerTurnB: b.retrievalEnvelopes / (b.modelTurns || 1),
    modelTurnsA: a.modelTurns,
    modelTurnsB: b.modelTurns,
    fusedA: a.fusedEnvelopes,
    fusedB: b.fusedEnvelopes,
    a, b,
  };
});

// Ratio of aggregate totals — same estimator family as the stage adjudicator, so the
// smoke and the real run cannot disagree because of how the mean was taken.
const sum = (f, side) => rows.reduce((s, r) => s + f(side === 'a' ? r.a : r.b), 0);
const counts = (side) => ({
  retrievalEnvelopes: sum(x => x.retrievalEnvelopes, side),
  testEnvelopes: sum(x => x.testEnvelopes, side),
  editEnvelopes: sum(x => x.editEnvelopes, side),
  operations: sum(x => x.operations, side),
  modelTurns: sum(x => x.modelTurns, side),
});
const countA = counts('a'), countB = counts('b');
const agg = {
  counts: { a: countA, b: countB },
  operationsPerRetrievalEnvelope: {
    a: countA.operations / countA.retrievalEnvelopes,
    b: countB.operations / countB.retrievalEnvelopes,
  },
  retrievalEnvelopesPerModelTurn: {
    a: countA.retrievalEnvelopes / countA.modelTurns,
    b: countB.retrievalEnvelopes / countB.modelTurns,
  },
  operationsPerModelTurn: {
    a: countA.operations / countA.modelTurns,
    b: countB.operations / countB.modelTurns,
  },
  fusedEnvelopes: { a: sum(x => x.fusedEnvelopes, 'a'), b: sum(x => x.fusedEnvelopes, 'b') },
};
const pct = (a, b) => a === 0 ? NaN : ((b - a) / a) * 100;

if (asJson) {
  console.log(JSON.stringify({
    ctrlId,
    varId,
    controlPath: control.resultPath,
    variantPath: variant.resultPath,
    expectedPairs,
    paired: paired.length,
    onlyA,
    onlyB,
    agg,
    rows: rows.map(({ a, b, ...row }) => row),
  }, null, 2));
} else {
  console.log(`\n=== turn-economy MECHANISM smoke ===`);
  console.log(`control=${control.resultPath}  variant=${variant.resultPath}  paired=${paired.length}`);
  console.log(`\nper task (A=control, B=variant):`);
  console.log(`  ${'task'.padEnd(40)} ${'ops/ret-env A→B'.padEnd(20)} ${'ret-env/turn A→B'.padEnd(20)} turns A→B`);
  for (const row of rows) {
    console.log(`  ${row.task.padEnd(40)} ` +
      `${(row.operationsPerRetrievalEnvelopeA.toFixed(3) + ' → ' + row.operationsPerRetrievalEnvelopeB.toFixed(3)).padEnd(20)} ` +
      `${(row.retrievalEnvelopesPerTurnA.toFixed(3) + ' → ' + row.retrievalEnvelopesPerTurnB.toFixed(3)).padEnd(20)} ` +
      `${row.modelTurnsA} → ${row.modelTurnsB}`);
  }
  console.log(`\naggregate (ratio of totals):`);
  const opRet = agg.operationsPerRetrievalEnvelope;
  const retTurn = agg.retrievalEnvelopesPerModelTurn;
  const opTurn = agg.operationsPerModelTurn;
  console.log(`  operations/retrieval-envelope  ${opRet.a.toFixed(3)} → ${opRet.b.toFixed(3)}   (${pct(opRet.a, opRet.b) >= 0 ? '+' : ''}${pct(opRet.a, opRet.b).toFixed(1)}%)   <- THE mechanism metric`);
  console.log(`  retrieval-envelopes/model-turn ${retTurn.a.toFixed(3)} → ${retTurn.b.toFixed(3)}   (${pct(retTurn.a, retTurn.b) >= 0 ? '+' : ''}${pct(retTurn.a, retTurn.b).toFixed(1)}%)`);
  console.log(`  operations/model-turn          ${opTurn.a.toFixed(3)} → ${opTurn.b.toFixed(3)}   (${pct(opTurn.a, opTurn.b) >= 0 ? '+' : ''}${pct(opTurn.a, opTurn.b).toFixed(1)}%)`);
  console.log(`  multi-op envelopes    ${agg.fusedEnvelopes.a} → ${agg.fusedEnvelopes.b}`);
  console.log(`\nexplicit counts (A → B):`);
  console.log(`  retrieval envelopes  ${countA.retrievalEnvelopes} → ${countB.retrievalEnvelopes}`);
  console.log(`  test envelopes       ${countA.testEnvelopes} → ${countB.testEnvelopes}`);
  console.log(`  edit envelopes       ${countA.editEnvelopes} → ${countB.editEnvelopes}`);
  console.log(`  operations           ${countA.operations} → ${countB.operations}`);
  console.log(`  model turns          ${countA.modelTurns} → ${countB.modelTurns}   ` +
    `(${pct(countA.modelTurns, countB.modelTurns) >= 0 ? '+' : ''}${pct(countA.modelTurns, countB.modelTurns).toFixed(1)}%)   ` +
    `[DIRECTIONAL ONLY — n=${paired.length}]`);
  console.log(`\nNo solve, cost, or pass/fail verdict is reported: ${paired.length} pairs cannot support one.`);
}
