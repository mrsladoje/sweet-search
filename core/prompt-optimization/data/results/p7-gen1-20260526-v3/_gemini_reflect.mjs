// One-off Gemini 3.1 Pro Deep Think reflection on round 1, EXTENDED to also
// score per-seed unfulfilled potential. Per PHASE7 §3.4 + user request.
// Direct google-api call (no CLI harness, per user feedback memory).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import https from 'node:https';

const RUN_DIR = resolve(import.meta.dirname);
const TRAJ = `${RUN_DIR}/gepa-trajectory.jsonl`;
const BANK = `${RUN_DIR}/prompt-bank.jsonl`;
const PARETO = `${RUN_DIR}/pareto-current.json`;
const NATIVE_BL = resolve(RUN_DIR, '../../p7-native-baseline-dev-3panel.json');
const VARIANTS_DIR = resolve(RUN_DIR, '../../p7-variants');

// ──── load ────
const traj = readFileSync(TRAJ, 'utf8').trim().split('\n').map(JSON.parse);
const bank = Object.fromEntries(
  readFileSync(BANK, 'utf8').trim().split('\n').map(JSON.parse).map(r => [r.hash, r.text])
);
const pareto = JSON.parse(readFileSync(PARETO, 'utf8'));
const baseline = JSON.parse(readFileSync(NATIVE_BL, 'utf8'));

// hash → T_i map
const norm = s => s.replace(/\s+/g, ' ').trim();
const tiBody = {};
for (let i = 1; i <= 15; i++) {
  const txt = readFileSync(`${VARIANTS_DIR}/T${i}.md`, 'utf8');
  const m = txt.match(/^\s*---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  tiBody[`T${i}`] = norm(m ? m[1] : txt);
}
const hashToTi = {};
for (const [h, t] of Object.entries(bank)) {
  const tn = norm(t);
  for (const [ti, bn] of Object.entries(tiBody)) {
    if (tn === bn) { hashToTi[h] = ti; break; }
  }
}

// build per-(hash,target,probe) map
const per = {};
for (const r of traj) {
  if (r._kind === 'seed') {
    (per[r.mutation_hash] ??= {})[r.target] ??= {};
    per[r.mutation_hash][r.target][r.probe_id] = r;
  } else if (r._kind === 'confirm' && r.round === 1) {
    (per[r.mutation_hash] ??= {})[r.target] ??= {};
    per[r.mutation_hash][r.target][r.probe_id] = {
      score: r.target === 'sonnet' ? r.raw_sonnet : r.raw_gpt5_5,
      tool_calls: r.tool_calls,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_read_tokens: r.cache_read_tokens,
      call_dev_penalty: r.call_deviation_penalty,
      native_search_penalty: r.native_search_penalty,
    };
  }
}

// seed completion order
const seedOrder = traj.filter(r => r._kind === 'mutation' && r.source_op === 'seed')
  .map(r => r.new_prompt_hash);

// per-variant stats + outlier probes
function summarise(hash, label) {
  const sn = per[hash]?.sonnet ?? {};
  const gp = per[hash]?.gpt5_5 ?? {};
  const pids = [...new Set([...Object.keys(sn), ...Object.keys(gp)])].sort();
  const sntScores = [], gptScores = [], sntCalls = [], gptCalls = [];
  const outliers = []; // probes where (calls > 1.5 × native) on either target
  for (const p of pids) {
    const s = sn[p], g = gp[p];
    if (s) { sntScores.push(s.score); sntCalls.push(s.tool_calls); }
    if (g) { gptScores.push(g.score); gptCalls.push(g.tool_calls); }
    const sntBase = baseline.sonnet?.[p];
    const gptBase = baseline.gpt5_5?.[p];
    if (sntBase && s && s.tool_calls > sntBase.calls * 1.5) {
      outliers.push({ probe: p, target: 'sonnet', cand: s.tool_calls, native: sntBase.calls, ratio: (s.tool_calls/sntBase.calls).toFixed(2) });
    }
    if (gptBase && g && g.tool_calls > gptBase.calls * 1.5) {
      outliers.push({ probe: p, target: 'gpt5_5', cand: g.tool_calls, native: gptBase.calls, ratio: (g.tool_calls/gptBase.calls).toFixed(2) });
    }
  }
  const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
  const joint = pids.map(p => {
    const s = sn[p]?.score, g = gp[p]?.score;
    return (s !== undefined && g !== undefined) ? Math.min(s, g) : 0;
  });
  return {
    label, hash,
    snt_acc: avg(sntScores).toFixed(4),
    gpt_acc: avg(gptScores).toFixed(4),
    joint_mm: avg(joint).toFixed(4),
    snt_calls_mean: avg(sntCalls).toFixed(2),
    gpt_calls_mean: avg(gptCalls).toFixed(2),
    outlier_count: outliers.length,
    outliers: outliers.slice(0, 5), // top 5 per variant
    n_probes: pids.length,
  };
}

const seedStats = seedOrder.map(h => summarise(h, hashToTi[h] ?? '?'));
const survivorStats = summarise(pareto.front[0].hash, 'T2-r1-reflective');

// failure clusters for the SURVIVOR (joint ≤ 0.4 — none likely, so use joint < 1.0)
const survivorFailures = [];
const sh = pareto.front[0].hash;
const sntDet = per[sh]?.sonnet ?? {}, gptDet = per[sh]?.gpt5_5 ?? {};
for (const p of Object.keys(sntDet)) {
  const s = sntDet[p]?.score, g = gptDet[p]?.score;
  const j = Math.min(s ?? 0, g ?? 0);
  if (j < 1.0) {
    survivorFailures.push({ probe: p, sonnet_score: s, gpt5_5_score: g, joint: j,
      sonnet_calls: sntDet[p].tool_calls, gpt5_5_calls: gptDet[p]?.tool_calls });
  }
}
survivorFailures.sort((a,b) => a.joint - b.joint);

// per-seed potential analysis (the EXTENDED ask)
const seedsByOutlierCount = [...seedStats].sort((a,b) => b.outlier_count - a.outlier_count);
const seedsWithPerfectAccButOutliers = seedStats
  .filter(s => parseFloat(s.snt_acc) === 1.0 && parseFloat(s.gpt_acc) === 1.0 && s.outlier_count > 0)
  .sort((a,b) => parseFloat(a.snt_calls_mean) + parseFloat(a.gpt_calls_mean) - parseFloat(b.snt_calls_mean) - parseFloat(b.gpt_calls_mean));

const pkg = {
  round: 1,
  context: 'Round 1 of GEPA gen-1 finished. Single survivor T2-r1-reflective on Pareto front. User asked Gemini to (a) standard round reflection and (b) extended analysis: which OTHER seeds have unfulfilled potential — perfect or near-perfect accuracy but localized call-outlier failures that surgical OP-1 reflection could plausibly fix.',
  survivor: {
    id: 'T2-r1-reflective',
    hash: pareto.front[0].hash,
    parent: 'T2 (now evicted from front)',
    source_op: 'OP-1 reflective (Slot 2, fallback after Slot 1 multiplicity rejection)',
    finalScore: pareto.front[0].finalScore,
    score_sonnet: pareto.front[0].score_sonnet,
    score_gpt5_5: pareto.front[0].score_gpt5_5,
    taskScore: pareto.front[0].taskScore,
    efficiencyFactor: pareto.front[0].efficiencyFactor,
    lengthPenalty: pareto.front[0].lengthPenalty,
    nativeRelative: pareto.front[0].nativeRelative,
    promptText: bank[pareto.front[0].hash].slice(0, 2500) + '...[truncated]',
    stats: survivorStats,
    failure_probes: survivorFailures,
  },
  paretoFront: [{ id: 'T2-r1-reflective', finalScore: pareto.front[0].finalScore, taskScore: pareto.front[0].taskScore }],
  convergence: { jointBestPerRound: [0.350, pareto.front[0].finalScore] },
  mutationOutcome: {
    slot1: 'OP-1 reflective primary → REJECTED (multiplicity-changed on [[ss-find]],[[ss-grep]],[[ss-trace]])',
    slot2: 'OP-1 reflective secondary → ACCEPTED → screen 0.542 → confirm 0.398 → ADMITTED, evicted T2',
    slot3: 'OP-3 persona-pivot → ACCEPTED → screen 0.530 (lost to slot 2)',
  },
  allSeedStats: seedStats,
  seedsRankedByOutlierCount: seedsByOutlierCount.slice(0, 6).map(s => ({
    label: s.label, joint_mm: s.joint_mm, snt_acc: s.snt_acc, gpt_acc: s.gpt_acc,
    snt_calls: s.snt_calls_mean, gpt_calls: s.gpt_calls_mean,
    outlier_count: s.outlier_count, outliers_sample: s.outliers
  })),
  perfectAccuracyButOutliersTier: seedsWithPerfectAccButOutliers.map(s => ({
    label: s.label, snt_calls: s.snt_calls_mean, gpt_calls: s.gpt_calls_mean,
    outlier_count: s.outlier_count, outliers: s.outliers
  })),
  hypothesis_to_evaluate:
    'User hypothesis: T8 (and other perfect-accuracy seeds with 2-3 localized call-outlier probes like kotlin-009, js-008, rust-010) may be more promising mutation parents than T2-r1-reflective. The geometric-mean zero-floor on calls (1.5× native = desirability 0) penalised these seeds harshly in finalScore even though their average behaviour is excellent. Please assess: (1) is T8 a strong candidate for a manual OP-1 reflective targeted at its outlier probes? (2) are any other seeds similarly fixable? (3) what specific structural changes would the candidate prompt need? (4) given limited budget for gen-2, what is the recommended action — resume gen-1 with --rounds 2 (evolve T2-r1-reflective further), or run a fresh OP-1 reflective on T8 (~$15-20)?',
};

const SYSTEM = 'You are a senior IR researcher reviewing a single round of a GEPA prompt-evolution loop for an agentic code-search system. The user has asked you for an EXTENDED reflection: in addition to the standard round-1 analysis (top 3 failure clusters, structural insight, plateau/breakthrough signals), please ALSO analyse the per-seed table for unfulfilled potential — seeds where small fixable failures (localized tool-call outliers, not systematic prompt flaws) are blocking what would otherwise be a strong candidate. Recommend whether to evolve the current Pareto front further (resume gen-1) or hand-craft a 4th mutation from a more promising seed (T8, T13, T10, etc.). Be concrete and structural — name specific probes, name specific prompt-section edits, name specific expected outcomes.';

// ──── call Gemini 3.1 Pro Deep Think via direct API ────
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const body = JSON.stringify({
  systemInstruction: { parts: [{ text: SYSTEM }] },
  contents: [{ role: 'user', parts: [{ text: JSON.stringify(pkg, null, 2) }] }],
  generationConfig: {
    thinkingConfig: { thinkingBudget: -1, includeThoughts: false },
    maxOutputTokens: 8000,
    temperature: 0.3,
  },
});

const model = 'gemini-3.1-pro-preview';
const path = `/v1beta/models/${model}:generateContent?key=${apiKey}`;
console.error(`POST → generativelanguage.googleapis.com${path.replace(apiKey, '<key>')}`);
console.error(`Package size: ${body.length} bytes`);

const startMs = Date.now();
const req = https.request({
  hostname: 'generativelanguage.googleapis.com',
  path, method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
}, res => {
  let chunks = '';
  res.on('data', d => chunks += d);
  res.on('end', () => {
    const wall = Date.now() - startMs;
    console.error(`HTTP ${res.statusCode}  ${wall}ms`);
    let parsed;
    try { parsed = JSON.parse(chunks); } catch (e) { console.error('parse error:', e.message); console.log(chunks); process.exit(1); }
    if (parsed.error) {
      console.error('Gemini error:', JSON.stringify(parsed.error, null, 2));
      process.exit(1);
    }
    const text = parsed.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') ?? '';
    const usage = parsed.usageMetadata ?? {};
    console.error(`tokens: in=${usage.promptTokenCount} out=${usage.candidatesTokenCount} thinking=${usage.thoughtsTokenCount ?? '?'}`);
    const outPath = `${RUN_DIR}/gemini-reflection-round1.md`;
    writeFileSync(outPath, `# Gemini 3.1 Pro Deep Think — Round-1 Reflection (Extended)\n\nModel: ${model}\nWall: ${wall}ms\nTokens: in=${usage.promptTokenCount} out=${usage.candidatesTokenCount}\n\n---\n\n${text}\n`);
    console.error(`Saved: ${outPath}`);
    console.log(text);
  });
});
req.on('error', e => { console.error('request error:', e); process.exit(1); });
req.write(body);
req.end();
