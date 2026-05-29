import fs from 'node:fs';
import { makeRealEvaluateCandidate } from '/Users/admin/Projects/sweet-search-private/core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = '/Users/admin/Projects/sweet-search-private';
const OUT = '/tmp/t3-diag-results.json';
const IDS = ['cpp-004', 'kotlin-002', 'ruby-001', 'js-008', 'js-005'];
const REPS = 3;
const CONC = 3;

function body(md) { const m = md.split(/^---\s*$/m); return (m.length >= 3 ? m.slice(2).join('---') : md).trim(); }
const raw = JSON.parse(fs.readFileSync(REPO + '/core/prompt-optimization/data/p7-dev-probes.json', 'utf8'));
const arr = Array.isArray(raw) ? raw : (raw.probes || raw.dev || []);
const probes = IDS.map((id) => arr.find((p) => p.id === id));
const T3 = body(fs.readFileSync(REPO + '/core/prompt-optimization/data/p7-variant-restarts/p7-gen1b-normalized/T3.md', 'utf8'));

const evalC = makeRealEvaluateCandidate({ agentProvider: 'api' });

const tasks = [];
for (const p of probes) for (let r = 0; r < REPS; r++) tasks.push({ p, r });
const out = [];
let cursor = 0;
const flush = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

function cmdOf(tc) {
  const i = tc.input || {};
  return i.command || i.file_path || i.path || (typeof i === 'string' ? i : JSON.stringify(i)).slice(0, 200);
}

async function worker() {
  for (let k = cursor++; k < tasks.length; k = cursor++) {
    const { p, r } = tasks[k];
    const t0 = Date.now();
    try {
      const res = await evalC({ promptText: T3, probe: p, target: 'gpt5_5' });
      const calls = (res.trajectory?.toolCalls || []).map((tc) => `${tc.name}:${cmdOf(tc)}`);
      const rec = {
        probe: p.id, rep: r, score: res.score, toolCalls: res.toolCalls,
        usedSweetSearch: res.usedSweetSearch, usedNativeSearch: res.usedNativeSearch,
        finalAnswerEmitted: res.finalAnswerEmitted,
        commands: calls,
        answerLen: (res.trajectory?.answer || '').length,
        answer: (res.trajectory?.answer || '').slice(0, 700),
        judges: (res.usage?.judges || []).map((j) => ({ model: j.model, score: j.score, isError: j.isError })),
        agent: res.usage?.agent, ms: Date.now() - t0,
      };
      out.push(rec); flush();
      console.error(`✓ ${p.id} rep${r} score=${res.score} calls=${res.toolCalls} ss=${res.usedSweetSearch} ans=${rec.answerLen}c judges=[${rec.judges.map((j) => j.score).join(',')}] ${(rec.ms / 1000).toFixed(0)}s`);
    } catch (e) {
      out.push({ probe: p.id, rep: r, error: String((e && e.message) || e), ms: Date.now() - t0 }); flush();
      console.error(`✗ ${p.id} rep${r} ERROR: ${(e && e.message) || e}`);
    }
  }
}

console.error(`T3-diagnostic: ${tasks.length} runs (${IDS.length} probes × ${REPS} reps, gpt5_5, conc=${CONC})`);
await Promise.all(Array.from({ length: CONC }, worker));
flush();
console.error(`ALL DONE: ${out.length} runs written to ${OUT}`);
