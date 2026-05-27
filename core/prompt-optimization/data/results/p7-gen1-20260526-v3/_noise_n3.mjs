#!/usr/bin/env node
/**
 * Noise characterization: re-score the same prompts N=3 times on the 8 screen
 * probes × 2 targets and report stderr on raw task scores. This pins down the
 * judge+agent stochastic noise floor — needed to evaluate whether the gen-1
 * convergence trace (0.398 → 0.414 → 0.424) is real or noise-dominated.
 *
 * Per Opus's analysis (2026-05-27): the r6 "winner" (0x6bd331b5) is
 * byte-identical to its r3 parent (0x06e10aca) after JSON-unescape — same
 * prompt scored 0.339 (r3-confirm) and 0.4235 (r6-confirm), a 0.085 swing
 * that should pin the run-to-run noise floor.
 *
 * Setup:
 *   - 2 prompts: r6-winner (= r3-reflective; byte-identical), T2-r1-reflective
 *   - 8 probes: first 8 in dev-probes.json (the existing screen-set)
 *   - 2 targets: sonnet, gpt5_5
 *   - 3 repeats per (prompt, probe, target)
 * = 96 evaluate calls × ~5s wall × ~$0.20 ≈ $15-20 and ~30 min serial.
 *
 * Concurrency=6 to bring wall to ~5-10 min.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRealEvaluateCandidate } from '../../../sweep/gepa-evaluate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = __dirname;
const OUT = resolve(RUN_DIR, 'noise-n3');
mkdirSync(OUT, { recursive: true });

const PROBES_FILE = resolve(RUN_DIR, '../../p7-dev-probes.json');
const probesDoc = JSON.parse(readFileSync(PROBES_FILE, 'utf8'));
const screenProbes = probesDoc.probes.slice(0, 8);

const bank = {};
for (const line of readFileSync(resolve(RUN_DIR, 'prompt-bank.jsonl'), 'utf8').trim().split('\n')) {
  const r = JSON.parse(line);
  if (r._kind === 'prompt') bank[r.hash] = r.text;
}

const PROMPTS = [
  { id: 'r6-winner-aka-r3-reflective', hash: '0x6bd331b51245f787' },
  { id: 'T2-r1-reflective', hash: '0xec184e6e19b2ab44' },
];

const N = 3;
const CONCURRENCY = 6;
const evaluate = makeRealEvaluateCandidate({ agentProvider: 'api' });

console.error(`Noise n=${N} on ${screenProbes.length} probes × 2 targets × ${PROMPTS.length} prompts = ${PROMPTS.length * screenProbes.length * 2 * N} evaluations`);
console.error(`Probes: ${screenProbes.map((p) => p.id).join(', ')}`);
console.error(`Prompts: ${PROMPTS.map((p) => `${p.id} (${p.hash.slice(0, 18)})`).join(', ')}`);

// Build the full task list
const tasks = [];
for (const prompt of PROMPTS) {
  for (const probe of screenProbes) {
    for (const target of ['sonnet', 'gpt5_5']) {
      for (let rep = 1; rep <= N; rep++) {
        tasks.push({ prompt, probe, target, rep });
      }
    }
  }
}
console.error(`Total tasks: ${tasks.length}`);

// Run with bounded concurrency
const results = [];
let nextIdx = 0;
let inFlight = 0;
let completed = 0;
const t0 = Date.now();

async function worker(workerId) {
  while (true) {
    const idx = nextIdx++;
    if (idx >= tasks.length) return;
    const task = tasks[idx];
    const tStart = Date.now();
    try {
      const r = await evaluate({ promptText: bank[task.prompt.hash], probe: task.probe, target: task.target });
      const wall = Date.now() - tStart;
      const row = {
        prompt: task.prompt.id,
        probe: task.probe.id,
        target: task.target,
        rep: task.rep,
        score: r.score,
        toolCalls: r.toolCalls,
        wallMs: wall,
      };
      results.push(row);
      completed += 1;
      if (completed % 8 === 0) {
        const eta = ((Date.now() - t0) / completed) * (tasks.length - completed) / 1000;
        console.error(`  [${completed}/${tasks.length}] ${task.prompt.id} ${task.probe.id} ${task.target} rep${task.rep} score=${r.score?.toFixed(2)} calls=${r.toolCalls} (${(wall / 1000).toFixed(1)}s)  ETA ${eta.toFixed(0)}s`);
      }
    } catch (e) {
      console.error(`  [${idx}] FAILED ${task.prompt.id} ${task.probe.id} ${task.target} rep${task.rep}: ${e?.message}`);
      results.push({ prompt: task.prompt.id, probe: task.probe.id, target: task.target, rep: task.rep, error: e?.message });
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
const wallTotal = (Date.now() - t0) / 1000;
console.error(`\nDone. Total wall: ${wallTotal.toFixed(1)}s = ${(wallTotal / 60).toFixed(1)} min`);

writeFileSync(`${OUT}/raw.jsonl`, results.map((r) => JSON.stringify(r)).join('\n'));

// ─── analyze: per-(prompt, probe, target) mean + stderr ─────────────────────
function statsOf(arr) {
  const a = arr.filter((x) => typeof x === 'number' && !isNaN(x));
  if (a.length === 0) return { mean: NaN, min: NaN, max: NaN, range: NaN, stderr: NaN, n: 0 };
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const variance = a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length;
  const stddev = Math.sqrt(variance);
  return { mean, min: Math.min(...a), max: Math.max(...a), range: Math.max(...a) - Math.min(...a), stderr: stddev / Math.sqrt(a.length), n: a.length, stddev };
}

const byKey = {};
for (const r of results) {
  if (r.error) continue;
  const k = `${r.prompt}|${r.probe}|${r.target}`;
  (byKey[k] = byKey[k] || []).push(r);
}

const perCell = [];
for (const [k, rows] of Object.entries(byKey)) {
  const [prompt, probe, target] = k.split('|');
  const scores = rows.map((r) => r.score);
  const calls = rows.map((r) => r.toolCalls);
  const s = statsOf(scores);
  const c = statsOf(calls);
  perCell.push({ prompt, probe, target, scores, calls, score_stats: s, calls_stats: c });
}
writeFileSync(`${OUT}/per-cell-stats.json`, JSON.stringify(perCell, null, 2));

console.error('\n══ NOISE FLOOR per (prompt, probe, target) ══');
console.error('range = max - min across N=3 repeats; this is the raw score noise per cell.');
console.error('format: prompt × probe × target | scores | score_range | calls_range');
for (const c of perCell) {
  const sScores = c.scores.map((x) => x.toFixed(2)).join(',');
  const sCalls = c.calls.join(',');
  console.error(`  ${c.prompt.padEnd(28)} ${c.probe.padEnd(12)} ${c.target.padEnd(8)} scores=[${sScores}] range=${c.score_stats.range.toFixed(2)} calls=[${sCalls}] range=${c.calls_stats.range}`);
}

console.error('\n══ AGGREGATE NOISE per (prompt, target) ══');
console.error('Mean of per-cell ranges (avg noise across the 8 probes):');
const aggKeys = {};
for (const c of perCell) {
  const k = `${c.prompt}|${c.target}`;
  (aggKeys[k] = aggKeys[k] || []).push(c.score_stats.range);
}
for (const [k, ranges] of Object.entries(aggKeys)) {
  const avg = ranges.reduce((s, x) => s + x, 0) / ranges.length;
  console.error(`  ${k.padEnd(40)} avg_range=${avg.toFixed(3)}  max_range=${Math.max(...ranges).toFixed(3)}`);
}

console.error('\n══ COMPARISON: which is bigger, noise or the gen-1 lift? ══');
const r6vsT2 = perCell.reduce((acc, c) => {
  acc[c.prompt + '|' + c.target] = (acc[c.prompt + '|' + c.target] || []).concat(c.scores);
  return acc;
}, {});
for (const target of ['sonnet', 'gpt5_5']) {
  const w = r6vsT2[`r6-winner-aka-r3-reflective|${target}`] || [];
  const t = r6vsT2[`T2-r1-reflective|${target}`] || [];
  if (!w.length || !t.length) continue;
  const wMean = w.reduce((s, x) => s + x, 0) / w.length;
  const tMean = t.reduce((s, x) => s + x, 0) / t.length;
  const wStdErr = Math.sqrt(w.reduce((s, x) => s + (x - wMean) ** 2, 0) / w.length) / Math.sqrt(w.length);
  const tStdErr = Math.sqrt(t.reduce((s, x) => s + (x - tMean) ** 2, 0) / t.length) / Math.sqrt(t.length);
  console.error(`  ${target}: winner mean=${wMean.toFixed(3)} ±${wStdErr.toFixed(3)} (n=${w.length})  T2 mean=${tMean.toFixed(3)} ±${tStdErr.toFixed(3)} (n=${t.length})  gap=${(wMean - tMean).toFixed(3)}`);
}

console.error(`\nArtifacts: ${OUT}/raw.jsonl, ${OUT}/per-cell-stats.json`);
