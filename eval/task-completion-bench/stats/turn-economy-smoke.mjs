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
// usage: node stats/turn-economy-smoke.mjs <controlRunId> <variantRunId> [--json]
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRollout } from './probe-count.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collect(runId) {
  const root = path.join(BENCH, 'results', runId, 'agent-state');
  if (!existsSync(root)) throw new Error(`no agent-state for run ${runId} at ${root}`);
  const out = new Map();
  for (const name of readdirSync(root).sort()) {
    const dir = path.join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const r = analyzeRollout(dir);
    if (!r) continue;
    // rollout dirs are `<taskId>-<arm>`; the smoke is sweet-only
    const task = name.replace(/-(sweet|native)$/, '');
    out.set(task, r);
  }
  return out;
}

const [ctrlId, varId] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!ctrlId || !varId) {
  console.error('usage: node stats/turn-economy-smoke.mjs <controlRunId> <variantRunId> [--json]');
  process.exit(2);
}

const A = collect(ctrlId);
const B = collect(varId);

// Pair strictly. A task present on only one side is DROPPED and named — a silently
// half-paired smoke would read as a mechanism signal when it is a missing rollout.
const paired = [...A.keys()].filter(t => B.has(t)).sort();
const onlyA = [...A.keys()].filter(t => !B.has(t));
const onlyB = [...B.keys()].filter(t => !A.has(t));

const rows = paired.map(t => {
  const a = A.get(t), b = B.get(t);
  return {
    task: t,
    opsPerEnvA: a.probes / (a.envelopes || 1), opsPerEnvB: b.probes / (b.envelopes || 1),
    envPerTurnA: a.envelopes / (a.turns || 1), envPerTurnB: b.envelopes / (b.turns || 1),
    turnsA: a.turns, turnsB: b.turns,
    fusedA: a.fused, fusedB: b.fused,
    a, b,
  };
});

// Ratio of aggregate totals — same estimator family as the stage adjudicator, so the
// smoke and the real run cannot disagree because of how the mean was taken.
const sum = (f, side) => rows.reduce((s, r) => s + f(side === 'a' ? r.a : r.b), 0);
const agg = {
  opsPerEnv: { a: sum(x => x.probes, 'a') / sum(x => x.envelopes, 'a'), b: sum(x => x.probes, 'b') / sum(x => x.envelopes, 'b') },
  envPerTurn: { a: sum(x => x.envelopes, 'a') / sum(x => x.turns, 'a'), b: sum(x => x.envelopes, 'b') / sum(x => x.turns, 'b') },
  opsPerTurn: { a: sum(x => x.probes, 'a') / sum(x => x.turns, 'a'), b: sum(x => x.probes, 'b') / sum(x => x.turns, 'b') },
  turns: { a: sum(x => x.turns, 'a'), b: sum(x => x.turns, 'b') },
  fusedEnvelopes: { a: sum(x => x.fused, 'a'), b: sum(x => x.fused, 'b') },
};
const pct = (a, b) => a === 0 ? NaN : ((b - a) / a) * 100;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ctrlId, varId, paired: paired.length, onlyA, onlyB, agg, rows: rows.map(({ a, b, ...r }) => r) }, null, 2));
} else {
  console.log(`\n=== turn-economy MECHANISM smoke ===`);
  console.log(`control=${ctrlId}  variant=${varId}  paired=${paired.length}`);
  if (onlyA.length || onlyB.length) {
    console.log(`!! UNPAIRED (dropped): control-only=[${onlyA}] variant-only=[${onlyB}]`);
  }
  console.log(`\nper task (A=control, B=variant):`);
  console.log(`  ${'task'.padEnd(40)} ${'ops/env A→B'.padEnd(20)} ${'env/turn A→B'.padEnd(20)} turns A→B`);
  for (const r of rows) {
    console.log(`  ${r.task.padEnd(40)} ${(r.opsPerEnvA.toFixed(3) + ' → ' + r.opsPerEnvB.toFixed(3)).padEnd(20)} ${(r.envPerTurnA.toFixed(3) + ' → ' + r.envPerTurnB.toFixed(3)).padEnd(20)} ${r.turnsA} → ${r.turnsB}`);
  }
  console.log(`\naggregate (ratio of totals):`);
  console.log(`  operations/envelope   ${agg.opsPerEnv.a.toFixed(3)} → ${agg.opsPerEnv.b.toFixed(3)}   (${pct(agg.opsPerEnv.a, agg.opsPerEnv.b) >= 0 ? '+' : ''}${pct(agg.opsPerEnv.a, agg.opsPerEnv.b).toFixed(1)}%)   <- THE mechanism metric`);
  console.log(`  envelopes/turn        ${agg.envPerTurn.a.toFixed(3)} → ${agg.envPerTurn.b.toFixed(3)}   (${pct(agg.envPerTurn.a, agg.envPerTurn.b) >= 0 ? '+' : ''}${pct(agg.envPerTurn.a, agg.envPerTurn.b).toFixed(1)}%)`);
  console.log(`  operations/turn       ${agg.opsPerTurn.a.toFixed(3)} → ${agg.opsPerTurn.b.toFixed(3)}   (${pct(agg.opsPerTurn.a, agg.opsPerTurn.b) >= 0 ? '+' : ''}${pct(agg.opsPerTurn.a, agg.opsPerTurn.b).toFixed(1)}%)`);
  console.log(`  multi-op envelopes    ${agg.fusedEnvelopes.a} → ${agg.fusedEnvelopes.b}`);
  console.log(`  turns (total)         ${agg.turns.a} → ${agg.turns.b}   (${pct(agg.turns.a, agg.turns.b) >= 0 ? '+' : ''}${pct(agg.turns.a, agg.turns.b).toFixed(1)}%)   [DIRECTIONAL ONLY — n=${paired.length}]`);
  console.log(`\nNo solve, cost, or pass/fail verdict is reported: ${paired.length} pairs cannot support one.`);
}
