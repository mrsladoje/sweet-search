import fs from 'node:fs';
import { makeRealEvaluateCandidate } from '/Users/admin/Projects/sweet-search-private/core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = '/Users/admin/Projects/sweet-search-private';
const OUT = '/tmp/gen1b-rescore-results.json';
const CONC = 4;
const PATCH_REPS = 3;
const MAX_EMPTY_RETRY = 3;

function body(md) { const m = md.split(/^---\s*$/m); return (m.length >= 3 ? m.slice(2).join('---') : md).trim(); }
const SEEDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map((id) => ({
  id, prompt: body(fs.readFileSync(`${REPO}/core/prompt-optimization/data/p7-variant-restarts/p7-gen1b-normalized/${id}.md`, 'utf8')),
}));
const raw = JSON.parse(fs.readFileSync(`${REPO}/core/prompt-optimization/data/p7-dev-probes.json`, 'utf8'));
const probes = Array.isArray(raw) ? raw : (raw.probes || raw.dev || []);
const byId = Object.fromEntries(probes.map((p) => [p.id, p]));

// 4 known-noisy GPT cells to re-measure (the rest of gen-1b GPT is reused as-is).
const GPT_PATCH = [['T4', 'ruby-002'], ['T5', 'cpp-008'], ['T5', 'ts-002'], ['T8', 'js-009']];

const evalC = makeRealEvaluateCandidate({ agentProvider: 'api' });

const tasks = [];
// Phase A: full Sonnet, 1 rep, all 8 seeds × 40 probes.
for (const s of SEEDS) for (const p of probes) tasks.push({ seed: s.id, prompt: s.prompt, probe: p, target: 'sonnet', rep: 0 });
// Phase B: the 4 GPT patch cells × PATCH_REPS.
for (const [sid, pid] of GPT_PATCH) {
  const s = SEEDS.find((x) => x.id === sid);
  for (let r = 0; r < PATCH_REPS; r++) tasks.push({ seed: sid, prompt: s.prompt, probe: byId[pid], target: 'gpt5_5', rep: r });
}

const out = [];
let cursor = 0;
const flush = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
const isDead = (r) => { const a = r?.usage?.agent; return !a || (((a.input_tokens || 0) + (a.output_tokens || 0)) === 0); };

async function evalWithRetry(args) {
  let last = null;
  for (let a = 1; a <= MAX_EMPTY_RETRY; a++) {
    try { const r = await evalC(args); if (!isDead(r)) return { r, dead: false, attempts: a }; last = r; }
    catch (e) { last = { _err: String((e && e.message) || e) }; }
    console.error(`  retry ${args.seed}.${args.probe.id}.${args.target} (empty/err attempt ${a})`);
  }
  return { r: last, dead: true, attempts: MAX_EMPTY_RETRY };
}

async function worker() {
  for (let k = cursor++; k < tasks.length; k = cursor++) {
    const t = tasks[k]; const t0 = Date.now();
    const { r, dead, attempts } = await evalWithRetry({ promptText: t.prompt, probe: t.probe, target: t.target });
    const a = r?.usage?.agent || {};
    out.push({
      seed: t.seed, probe: t.probe.id, target: t.target, rep: t.rep,
      score: dead ? null : r.score, dead, attempts, toolCalls: r?.toolCalls ?? null, usedSweetSearch: r?.usedSweetSearch ?? null,
      input_tokens: a.input_tokens ?? null, output_tokens: a.output_tokens ?? null,
      cache_read_tokens: a.cache_read_tokens ?? null, cache_creation_tokens: a.cache_creation_tokens ?? null,
      judges: (r?.usage?.judges || []).map((j) => ({ model: j.model, isError: j.isError })),
      answerLen: (r?.trajectory?.answer || '').length, ms: Date.now() - t0,
    });
    flush();
    console.error(`${dead ? '✗DEAD' : '✓'} ${t.seed}.${t.probe.id}.${t.target}${t.rep ? '#' + t.rep : ''} score=${dead ? 'DEAD' : r.score} calls=${r?.toolCalls} (${((Date.now() - t0) / 1000).toFixed(0)}s) [${k + 1}/${tasks.length}]`);
  }
}

console.error(`gen1b-rescore: ${tasks.length} runs (${SEEDS.length}×${probes.length} sonnet + ${GPT_PATCH.length}×${PATCH_REPS} gpt patches), conc=${CONC}`);
await Promise.all(Array.from({ length: CONC }, worker));
flush();
console.error(`ALL DONE: ${out.length} runs → ${OUT}`);
