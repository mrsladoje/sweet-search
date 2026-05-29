#!/usr/bin/env node
/**
 * Build a pre-scored gen-2 initial Pareto front for {T1,T2,T3} by SURGICALLY
 * MERGING the gen-1b rescore (rep #1) with ONE fresh ablation rep (rep #2) →
 * 2-rep median score + median token-breakdown (→ cost) + fresh trajectories.
 *
 * Output is consumed by `gepa.mjs --initial-front <file>`, so round 1 SKIPS the
 * round-0 seed ablation (no re-paying to score seeds we already scored) while the
 * seeds sit on 2 reps — equal footing with the reps=2 mutations.
 *
 *   node scripts/build-gen2-front.mjs --validate   # rep#1 only, NO API calls (path test, $0)
 *   node scripts/build-gen2-front.mjs              # + 1 fresh rep (real ablation, ~$18)
 *
 * rep#1 sources: Sonnet ← p7-gen1b-rescore/rescore-results.json; GPT ← gen-1b
 * trajectory (clean cells) + t3-noise-diagnostic.json (T3's 5 patched, median).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidate } from '../core/prompt-optimization/sweep/gepa-scoring.mjs';
import { makeRealEvaluateCandidate } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATE = process.argv.includes('--validate');
const SEEDS = ['T1', 'T2', 'T3'];
const TID = { T1: '0x9b99587f0b0db9a7', T2: '0x53f8a0f707141e25', T3: '0x57d1d3600aaf18a8' };
const OUT = path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts',
  VALIDATE ? 'p7-gen2-initial-front.VALIDATE.json' : 'p7-gen2-initial-front.json');
const CONC = 4;
const median = (xs) => { const s = xs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const body = (md) => { const m = md.split(/^---\s*$/m); return (m.length >= 3 ? m.slice(2).join('---') : md).trim(); };

const prompts = Object.fromEntries(SEEDS.map((s) => [s, body(fs.readFileSync(path.join(REPO, `core/prompt-optimization/data/p7-variant-restarts/p7-gen1b-normalized/${s}.md`), 'utf8'))]));
const probesRaw = load(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'));
const devProbes = Array.isArray(probesRaw) ? probesRaw : (probesRaw.probes || probesRaw.dev || []);
const baseline = path.join(REPO, 'core/prompt-optimization/data/p7-native-baseline-dev-3panel.json');

// ── rep #1: the gen-1b rescore assembly (Sonnet fresh, GPT reused + T3 patches) ──
const rep1 = {}; // rep1[seed][probe][target] = { score, toolCalls, in, out, cr, cc }
const put1 = (seed, probe, target, c) => { ((rep1[seed] = rep1[seed] || {})[probe] = rep1[seed][probe] || {})[target] = c; };
for (const r of load(path.join(REPO, 'core/prompt-optimization/data/results/p7-gen1b-rescore/rescore-results.json'))) {
  if (r.dead || !SEEDS.includes(r.seed) || r.target !== 'sonnet') continue;
  put1(r.seed, r.probe, 'sonnet', { score: r.score, toolCalls: r.toolCalls, in: num(r.input_tokens), out: num(r.output_tokens), cr: num(r.cache_read_tokens), cc: num(r.cache_creation_tokens) });
}
const REV = Object.fromEntries(Object.entries(TID).map(([s, h]) => [h, s]));
const PATCH = new Set(['T3:cpp-004', 'T3:kotlin-002', 'T3:ruby-001', 'T3:js-008', 'T3:js-005']);
for (const e of fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/results/p7-gen1b-round0/gepa-trajectory.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))) {
  if (e._kind !== 'seed' || e.target !== 'gpt5_5') continue;
  const seed = REV[e.mutation_hash]; if (!seed || PATCH.has(`${seed}:${e.probe_id}`)) continue;
  put1(seed, e.probe_id, 'gpt5_5', { score: e.score, toolCalls: e.tool_calls, in: num(e.input_tokens), out: num(e.output_tokens), cr: num(e.cache_read_tokens), cc: num(e.cache_creation_tokens) });
}
const t3patch = {};
for (const r of load(path.join(REPO, 'core/prompt-optimization/data/results/p7-gen1b-rescore/t3-noise-diagnostic.json'))) {
  if (r.error) continue; (t3patch[r.probe] = t3patch[r.probe] || []).push(r);
}
for (const [probe, runs] of Object.entries(t3patch)) {
  put1('T3', probe, 'gpt5_5', { score: median(runs.map((x) => x.score)), toolCalls: Math.round(median(runs.map((x) => x.toolCalls))), in: median(runs.map((x) => num(x.agent?.input_tokens))), out: median(runs.map((x) => num(x.agent?.output_tokens))), cr: median(runs.map((x) => num(x.agent?.cache_read_tokens))), cc: median(runs.map((x) => num(x.agent?.cache_creation_tokens))) });
}

// ── rep #2: ONE fresh ablation rep (both targets), capturing trajectories ──
const rep2 = {};
if (!VALIDATE) {
  const evalC = makeRealEvaluateCandidate({ agentProvider: 'api' });
  const tasks = [];
  for (const s of SEEDS) for (const p of devProbes) for (const t of ['sonnet', 'gpt5_5']) tasks.push({ s, p, t });
  let cur = 0;
  const worker = async () => {
    for (let k = cur++; k < tasks.length; k = cur++) {
      const { s, p, t } = tasks[k];
      let r = null;
      for (let a = 0; a < 3; a++) { r = await evalC({ promptText: prompts[s], probe: p, target: t }); const ag = r.usage?.agent; if (ag && (num(ag.input_tokens) + num(ag.output_tokens)) > 0) break; }
      const ag = r.usage?.agent || {};
      ((rep2[s] = rep2[s] || {})[p.id] = rep2[s][p.id] || {})[t] = { score: r.score, toolCalls: r.toolCalls, in: num(ag.input_tokens), out: num(ag.output_tokens), cr: num(ag.cache_read_tokens), cc: num(ag.cache_creation_tokens), trajectory: r.trajectory, finalAnswerEmitted: r.finalAnswerEmitted, usedReadOrGrep: r.usedReadOrGrep, usedSweetSearch: r.usedSweetSearch, usedNativeSearch: r.usedNativeSearch };
      console.error(`✓ ${s}.${p.id}.${t} score=${r.score} [${k + 1}/${tasks.length}]`);
    }
  };
  console.error(`fresh ablation: ${tasks.length} cells (3 seeds × ${devProbes.length} × 2), conc=${CONC}`);
  await Promise.all(Array.from({ length: CONC }, worker));
}

// ── merge rep#1 + rep#2 → a pre-merged evalResult per cell; assemble via buildCandidate ──
function mergedCell(seed, probe, target) {
  const a = rep1[seed]?.[probe]?.[target];
  const b = rep2[seed]?.[probe]?.[target];
  const reps = [a, b].filter(Boolean);
  if (!reps.length) return null;
  const score = median(reps.map((x) => x.score));
  const agent = { input_tokens: median(reps.map((x) => x.in)), output_tokens: median(reps.map((x) => x.out)), cache_read_tokens: median(reps.map((x) => x.cr)), cache_creation_tokens: median(reps.map((x) => x.cc)) };
  const traj = b?.trajectory || { toolCalls: [], answer: '' };
  return {
    score, toolCalls: (b ?? a).toolCalls ?? 0,
    finalAnswerEmitted: b?.finalAnswerEmitted ?? true,
    usedReadOrGrep: b?.usedReadOrGrep ?? true, usedSweetSearch: b?.usedSweetSearch ?? true, usedNativeSearch: b?.usedNativeSearch ?? false,
    trajectory: traj, usage: { agent }, _repScores: reps.map((x) => x.score),
  };
}

const candidates = [];
for (const seed of SEEDS) {
  const mergedEval = async ({ probe, target }) => {
    const c = mergedCell(seed, probe.id, target);
    if (!c) throw new Error(`missing merged cell ${seed}.${probe.id}.${target}`);
    return c;
  };
  const cand = await buildCandidate({
    id: seed, prompt: prompts[seed], sourceOp: 'seed', parentHash: null,
    probes: devProbes, weights: devProbes.map(() => 1), evaluateCandidate: mergedEval,
    nativeBaselineByTarget: load(baseline), repeats: 1,
  });
  candidates.push(cand);
  console.error(`assembled ${seed}: taskScore=${cand.taskScore.toFixed(4)} cost$=${(cand.costUsd ?? 0).toExponential(3)} finalScore=${cand.finalScore.toFixed(4)}`);
}
// Inject ALL THREE seeds as the parent front — do NOT run buildFrontFrom. Under
// per-probe dominance the perfect-accuracy T3 (1.0 on every probe) dominates the
// cheaper T1/T2 and collapses the front to {T3} (cost isn't in the search
// dominance). We deliberately keep the 3-seed slate as parents so evolution can
// also mutate the cheaper lineages. (Follow-up: fold cost into the search front
// for the saturated-accuracy regime.)
fs.writeFileSync(OUT, JSON.stringify(candidates, null, 2));
console.error(`\nwrote ${candidates.length}-member front → ${OUT}${VALIDATE ? '  (VALIDATE: rep#1 only, no fresh rep)' : ''}`);
