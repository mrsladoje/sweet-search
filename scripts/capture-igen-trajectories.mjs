#!/usr/bin/env node
/**
 * Trajectory CAPTURE for the I/J-gen diagnosis (A vs G vs H).
 *
 * The screen (screen-gen3-candidates.mjs) only persisted call-COUNTS, not the
 * tool-call sequences, and the G/H screen overwrote the A/D screen at the same
 * JSON path. To diagnose *how* A behaves vs G/H on the probes where G/H lose,
 * we re-run A, G, H on the diagnostic subset on SONNET (the binding target —
 * Maximin; cost lives here) and persist the FULL trajectory: every {name,input}
 * tool call, the final answer, score, count, cache-naive $.
 *
 * Diagnostic subset (where G/H lose or differ):
 *   kotlin-009 (no-match spiral, 2 reps to catch the loop) — THE headroom probe
 *   cpp-004, csharp-004 (multi-file blowup — trace-first vs manual-chain)
 *   rust-010 (no-match STABLE control — contrast with the kotlin spiral)
 *   js-008 (behavioral — G/H both spend more here)
 *
 * Sonnet-only by design (cost mechanism is a sonnet story; halves spend).
 *   node scripts/capture-igen-trajectories.mjs
 *   CANDS=A,G,H PROBES=kotlin-009,cpp-004 node scripts/capture-igen-trajectories.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRealEvaluateCandidate } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runCostLatencyFields } from '../core/prompt-optimization/sweep/gepa-scoring.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONC = Number(process.env.CONC) || 5;
const TARGET = 'sonnet';
const CANDS = (process.env.CANDS || 'A,G,H').split(',').map((s) => s.trim()).filter(Boolean);

// probeId → { stratum, reps }
const PLAN = {
  'kotlin-009': { stratum: 'no-match', reps: 2 },
  'cpp-004': { stratum: 'multi-file-flow', reps: 1 },
  'csharp-004': { stratum: 'multi-file-flow', reps: 1 },
  'rust-010': { stratum: 'no-match-control', reps: 1 },
  'js-008': { stratum: 'behavioral', reps: 1 },
  // literal top-up (A's #1 injection target — quantify the wasted ss-search call)
  'ts-003': { stratum: 'literal-lookup', reps: 1 },
  'rust-001': { stratum: 'literal-lookup', reps: 1 },
  'java-001': { stratum: 'literal-lookup', reps: 1 },
};
const PROBE_IDS = (process.env.PROBES ? process.env.PROBES.split(',').map((s) => s.trim()) : Object.keys(PLAN)).filter(Boolean);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const prompts = Object.fromEntries(
  CANDS.map((k) => [k, fs.readFileSync(path.join(REPO, `core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/${k}.md`), 'utf8')]),
);
const probesRaw = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const allProbes = Array.isArray(probesRaw) ? probesRaw : (probesRaw.probes || probesRaw.dev || []);
const probes = PROBE_IDS.map((id) => {
  const p = allProbes.find((x) => x.id === id);
  if (!p) throw new Error(`probe ${id} not in dev set`);
  return p;
});

const evalC = makeRealEvaluateCandidate({ agentProvider: 'api' });

// Build task list: (cand × probe × rep), flattened.
const tasks = [];
for (const k of CANDS) {
  for (const probe of probes) {
    const reps = PLAN[probe.id]?.reps ?? 1;
    for (let r = 0; r < reps; r++) tasks.push({ k, probe, r });
  }
}

const out = []; // { cand, probeId, stratum, rep, score, callCount, cost, toolCalls:[{name,input}], answer }
let cur = 0;
const worker = async () => {
  for (let i = cur++; i < tasks.length; i = cur++) {
    const { k, probe, r } = tasks[i];
    let res = null;
    for (let a = 0; a < 3; a++) {
      res = await evalC({ promptText: prompts[k], probe, target: TARGET });
      const ag = res.usage?.agent;
      if (ag && num(ag.input_tokens) + num(ag.output_tokens) > 0) break;
    }
    const callCount = res.toolCalls ?? (res.trajectory?.toolCalls?.length ?? 0);
    const clf = runCostLatencyFields({ usage: res.usage, target: TARGET, toolCalls: callCount });
    const toolCalls = (res.trajectory?.toolCalls ?? []).map((c) => ({ name: c.name, input: c.input }));
    out.push({
      cand: k,
      probeId: probe.id,
      stratum: PLAN[probe.id]?.stratum ?? '?',
      query: probe.query ?? probe.prompt ?? '',
      rep: r,
      score: res.score,
      callCount,
      cost: clf.cost_usd ?? 0,
      toolCalls,
      answer: typeof res.trajectory?.answer === 'string' ? res.trajectory.answer.slice(0, 4000) : res.trajectory?.answer ?? null,
    });
    const seq = toolCalls.map((c) => c.name.replace(/^ss-?/, '')).join('→');
    console.error(`✓ ${k}.${probe.id}.r${r} score=${res.score} calls=${callCount} $${(clf.cost_usd ?? 0).toFixed(4)}  [${seq}]  [${out.length}/${tasks.length}]`);
  }
};

console.error(`CAPTURE: ${CANDS.join(',')} × ${probes.length} probes (${TARGET}) = ${tasks.length} trajectories, conc=${CONC}`);
await Promise.all(Array.from({ length: CONC }, worker));

// Sort for readability: probe, then cand, then rep.
out.sort((a, b) => a.probeId.localeCompare(b.probeId) || a.cand.localeCompare(b.cand) || a.rep - b.rep);
const outPath = path.join(REPO, 'core/prompt-optimization/data/results/', process.env.OUT || 'igen-trajectories.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ target: TARGET, cands: CANDS, plan: PLAN, captured: new Date().toISOString(), trajectories: out }, null, 2));
console.error(`\nwrote ${outPath} (${out.length} trajectories)`);
