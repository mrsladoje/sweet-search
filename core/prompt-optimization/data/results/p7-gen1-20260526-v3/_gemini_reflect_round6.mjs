#!/usr/bin/env node
/**
 * Phase 7 §3.4 manual-reflection call: Gemini 3.1 Pro Deep Think reviews the
 * full gen-1 run at end-of-round-6 (winner = r6-pruner, finalScore 0.4235).
 *
 * Goals:
 *   1. Identify why the winner gives up 0.002 of Sonnet accuracy (which probes?)
 *   2. Diagnose the GPT-5.5 token blow-up (43,516 cand vs 9,100 native)
 *   3. Suggest a hand-craftable edit that preserves the pruner's gains
 *      WITHOUT going longer than 980 tokens (the T8-r1 hand-craft failed at
 *      1203 tokens, -33% vs T2-r1; length discipline is non-negotiable).
 *   4. Identify structural patterns across the final Pareto front.
 *
 * Direct google-api call with thinkingBudget=-1 + googleSearch grounding +
 * maxOutputTokens=12000. NOT integrated, NOT committed. Pure scratch output
 * for the user to review before deciding whether to hand-craft.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = __dirname;
const PROBES_FILE = resolve(RUN_DIR, '../../p7-dev-probes.json');
const NATIVE_BL = resolve(RUN_DIR, '../../p7-native-baseline-dev-3panel.json');

// ─── load state ────────────────────────────────────────────────────────────
const pc = JSON.parse(readFileSync(resolve(RUN_DIR, 'pareto-current.json'), 'utf8'));
const traj = readFileSync(resolve(RUN_DIR, 'gepa-trajectory.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const bank = Object.fromEntries(
  readFileSync(resolve(RUN_DIR, 'prompt-bank.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r._kind === 'prompt').map((r) => [r.hash, r.text]),
);
const probesDoc = JSON.parse(readFileSync(PROBES_FILE, 'utf8'));
const probeMap = new Map(probesDoc.probes.map((p) => [p.id, p]));
const nb = JSON.parse(readFileSync(NATIVE_BL, 'utf8'));

const WINNER_HASH = '0x6bd331b51245f787';
const winner = pc.front.find((m) => m.hash === WINNER_HASH);
const winnerPrompt = bank[WINNER_HASH];

// ─── per-probe failure diagnostics for the winner ──────────────────────────
const winnerFailures = [];
for (const pid of Object.keys(winner.detail)) {
  const d = winner.detail[pid];
  const s = d.sonnet.score, g = d.gpt5_5.score;
  const j = Math.min(s, g);
  const native = { sonnet: nb.sonnet[pid] || {}, gpt5_5: nb.gpt5_5[pid] || {} };
  if (s < 1.0 || g < 1.0 || (d.sonnet.traj?.toolCalls?.length ?? 0) > (native.sonnet.calls ?? 99) || (d.gpt5_5.traj?.toolCalls?.length ?? 0) > (native.gpt5_5.calls ?? 99)) {
    winnerFailures.push({
      probe: pid,
      stratum: probeMap.get(pid)?.stratum,
      repo: probeMap.get(pid)?.repo,
      query: probeMap.get(pid)?.query,
      sonnet_score: s, gpt5_5_score: g, joint: j,
      sonnet_calls: d.sonnet.traj?.toolCalls?.length ?? 0,
      gpt5_5_calls: d.gpt5_5.traj?.toolCalls?.length ?? 0,
      native_sonnet_calls: native.sonnet.calls,
      native_gpt5_5_calls: native.gpt5_5.calls,
      native_sonnet_tokens: native.sonnet.tokens,
      native_gpt5_5_tokens: native.gpt5_5.tokens,
    });
  }
}
winnerFailures.sort((a, b) => a.joint - b.joint || ((b.gpt5_5_calls + b.sonnet_calls) - (a.gpt5_5_calls + a.sonnet_calls)));

// ─── front member summaries ────────────────────────────────────────────────
const frontSummary = pc.front.map((m) => ({
  id: m.id, hash: m.hash, sourceOp: m.sourceOp, parentHash: m.parentHash,
  finalScore: m.finalScore, score_sonnet: m.score_sonnet, score_gpt5_5: m.score_gpt5_5,
  taskScore: m.taskScore, efficiencyFactor: m.efficiencyFactor, lengthPenalty: m.lengthPenalty,
  nativeRelative: m.nativeRelative, sharpnessScore: m.sharpnessScore, tokenCount: m.tokenCount,
  promptText: bank[m.hash].slice(0, 4000),
}));

// ─── aggregate per-target costs vs native ──────────────────────────────────
function aggCosts(memberDetail, baselineKey) {
  const rows = [];
  for (const pid of Object.keys(memberDetail)) {
    const d = memberDetail[pid][baselineKey === 'sonnet' ? 'sonnet' : 'gpt5_5'];
    const base = nb[baselineKey][pid] || {};
    rows.push({
      probe: pid,
      cand_score: d.score,
      cand_calls: d.traj?.toolCalls?.length ?? 0,
      cand_in_tokens: d.usage?.agent?.input_tokens ?? 0,
      cand_out_tokens: d.usage?.agent?.output_tokens ?? 0,
      native_score: base.score, native_calls: base.calls, native_tokens: base.tokens,
    });
  }
  return rows;
}

// ─── convergence trajectory ────────────────────────────────────────────────
const paretoUpdates = traj.filter((e) => e._kind === 'pareto-update');
const tareEvents = traj.filter((e) => e._kind === 'tare-adversarial');

// ─── retry stats ───────────────────────────────────────────────────────────
const accepted = traj.filter((e) => e._kind === 'mutation' && e.round > 0);
const rejections = traj.filter((e) => e._kind === 'mutation-rejection');
const attemptDist = {};
for (const m of accepted) attemptDist[m.attempts ?? 1] = (attemptDist[m.attempts ?? 1] ?? 0) + 1;

// ─── build the reflection package ──────────────────────────────────────────
const pkg = {
  context: 'P7 gen-1 GEPA run COMPLETE at round 6 (max-rounds cap). Winner = r6-pruner (finalScore 0.4235, +6.4% over r1 baseline). User asks: what hand-craft edit could push this further WITHOUT going longer than 980 tokens (the prior T8 hand-craft at 1203 tokens failed at -33%, length-penalty zero-floored 25/40 probes).',
  winner: {
    id: winner.id, hash: WINNER_HASH, source_op: winner.sourceOp,
    parent_lineage: 'T2 (seed) -> r1-reflective -> r3-reflective -> r6-PRUNER',
    finalScore: winner.finalScore,
    score_sonnet: winner.score_sonnet,
    score_gpt5_5: winner.score_gpt5_5,
    taskScore: winner.taskScore,
    efficiencyFactor: winner.efficiencyFactor,
    lengthPenalty: winner.lengthPenalty,
    nativeRelative: winner.nativeRelative,
    sharpnessScore: winner.sharpnessScore,
    tokenCount: winner.tokenCount,
    promptText: winnerPrompt,
  },
  acceptance_test_vs_native: {
    note: 'Native is the search-tool baseline WITHOUT any agent prompt — pure ss-search/ss-find calls. Per-probe averages over 40 dev probes.',
    sonnet: { winner_acc: 0.998, native_acc: 1.000, winner_calls: 8.3, native_calls: 10.5, winner_tokens: 1763, native_tokens: 10824 },
    gpt5_5: { winner_acc: 0.993, native_acc: 0.975, winner_calls: 5.5, native_calls: 7.7, winner_tokens: 43516, native_tokens: 9100, NOTE: 'GPT-5.5 candidate uses ~5x MORE tokens than native — this is the length-penalty signal the optimizer was fighting all run.' },
  },
  winner_failures_or_inefficiencies: winnerFailures,
  pareto_front: frontSummary,
  convergence: {
    joint_best_per_round: [
      { round: 1, joint_best: 0.398, note: 'gen-1 round-1 (existing)' },
      { round: 2, joint_best: 0.398, note: 'no acceptance' },
      { round: 3, joint_best: 0.398, note: 'r3-reflective added (final 0.339) but did not lift joint_best' },
      { round: 4, joint_best: 0.398, note: 'r4-persona-pivot added (0.354)' },
      { round: 5, joint_best: 0.414, note: 'r5-trajectory-crossover BREAKTHROUGH +1.6pp' },
      { round: 6, joint_best: 0.424, note: 'r6-PRUNER BREAKTHROUGH +1.0pp; evicted r4 + r5' },
    ],
    tare_events: tareEvents.map((t) => ({ round: t.round, sharpness: t.sharpness, sharpnessScore: t.sharpness_score })),
    pareto_admits: paretoUpdates.map((p) => ({ round: p.round, added: p.added, dropped: p.dropped })),
  },
  retry_loop_stats: {
    note: 'rounds 2-6 used opencode + Gemini DeepThink with retry-until-success (cap 5). Architecture change committed at 48eb4fa.',
    accepted_mutations: accepted.length,
    rejection_events: rejections.length,
    attempts_distribution: attemptDist,
    multiplicity_changed_in_new_r6: 0,
  },
  hand_craft_history: {
    prior_attempt: 'T8-r1-manual (gen-1 round-1 sibling experiment), 1203 tokens, finalScore 0.265 = -33% vs T2-r1. Sonnet zero-floored on 25/40 probes due to >1.5x token ratio. Lesson: do NOT go longer than the current winner.',
    constraint: 'Hand-craft must be <= 980 tokens (winner). Preserve the pruner gains (Sonnet ties native on tool calls, GPT-5.5 beats native by 1.8pp). Address GPT-5.5 token blow-up if possible.',
  },
  question_for_gemini: {
    Q1: 'The winner gives up 0.002 of Sonnet accuracy. Look at the per-probe failures + trajectories shown above — which probes are responsible? Is there a structural fix?',
    Q2: 'GPT-5.5 burns 43,516 tokens/probe (5x native 9,100). Why? Is it (a) repeated tool exploration, (b) verbose final answers despite the Output section instruction, (c) something else? What edit would cut this in half without losing the accuracy gains?',
    Q3: 'The winner is 980 tokens, sharpness=0.987 (sharpest of any variant in this run), source op = PRUNER. The pruner trimmed prose. Can you spot a section of the winner prompt that is STILL redundant or under-pulling its weight? Suggest a SURGICAL edit (1-3 sentence change) that could trim further OR sharpen the routing without lengthening.',
    Q4: 'Looking at the 3 Pareto members and the run trajectory, is there a structural pattern that the optimizer missed? E.g. a class of probe failures the optimizer never addressed because it never picked the right parent + operator combination?',
    Q5: 'Bottom line: would you recommend a SPECIFIC hand-craft edit to test off-loop, OR is the optimizer at a local optimum that hand-crafting probably cannot beat (in which case the user should pursue gen-2 with broader exploration)? Be concrete with your reasoning.',
  },
};

const SYSTEM = `You are a senior IR researcher reviewing a completed gen-1 GEPA prompt-evolution run for an agentic code-search tool. The optimizer has converged at finalScore 0.4235 (winner = OP-5 Pruner mutation). The user wants you to do a deep structural review and decide whether a HAND-CRAFTED edit could materially exceed the optimizer's output, subject to a hard token-count constraint (<= 980 tokens, the winner's size). A prior hand-craft attempt at 1203 tokens crashed at -33% due to the length penalty, so length discipline is non-negotiable.

Your analysis should:
1. Be DATA-DRIVEN. Cite specific probe IDs, specific tool-call counts, specific sections of the winner prompt.
2. Be HONEST about uncertainty. If the optimizer's result already looks close to the local optimum, say so.
3. Be CONCRETE. If you recommend a hand-craft, give me the exact diff against the winner prompt (or a clear instruction list). If you recommend "no hand-craft," propose what gen-2 should explore differently.
4. Stay focused. This is a 1-2 day decision, not a full research program.

Use web search ONLY if you need to verify a specific external claim (e.g. a tool-best-practice or a known retrieval-research result). The package contains all the per-probe and per-front-member data you need.

Output format: Markdown. Front-load your top-line recommendation in 2-3 sentences, then back it up with sections per Q1-Q5.`;

const body = JSON.stringify({
  systemInstruction: { parts: [{ text: SYSTEM }] },
  contents: [{ role: 'user', parts: [{ text: JSON.stringify(pkg, null, 2) }] }],
  tools: [{ googleSearch: {} }],
  generationConfig: { thinkingConfig: { thinkingBudget: -1, includeThoughts: false }, maxOutputTokens: 12000, temperature: 0.3 },
});

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
const path = `/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`;
console.error(`POST → generativelanguage.googleapis.com${path.replace(apiKey, '<key>')}`);
console.error(`Package size: ${body.length} bytes`);

const t0 = Date.now();
const req = https.request({
  hostname: 'generativelanguage.googleapis.com',
  path, method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  timeout: 600000,
}, (res) => {
  let chunks = '';
  res.on('data', (d) => chunks += d);
  res.on('end', () => {
    const wall = Date.now() - t0;
    console.error(`HTTP ${res.statusCode}  ${wall}ms`);
    let parsed;
    try { parsed = JSON.parse(chunks); } catch (e) { console.error('parse error:', e.message); console.log(chunks.slice(0, 2000)); process.exit(1); }
    if (parsed.error) { console.error('Gemini error:', JSON.stringify(parsed.error, null, 2)); process.exit(1); }
    const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n') ?? '';
    const usage = parsed.usageMetadata ?? {};
    const grounding = parsed.candidates?.[0]?.groundingMetadata ?? null;
    console.error(`tokens: in=${usage.promptTokenCount} out=${usage.candidatesTokenCount} thinking=${usage.thoughtsTokenCount}`);
    if (grounding?.webSearchQueries?.length) console.error(`web searches used: ${grounding.webSearchQueries.join(' | ')}`);
    const outPath = `${RUN_DIR}/gemini-reflection-round6.md`;
    writeFileSync(outPath, `# Gemini 3.1 Pro Deep Think — Round-6 Reflection\n\nModel: gemini-3.1-pro-preview\nWall: ${wall}ms\nTokens: in=${usage.promptTokenCount} out=${usage.candidatesTokenCount} thinking=${usage.thoughtsTokenCount}\nWeb searches: ${grounding?.webSearchQueries?.join(' | ') ?? '(none)'}\n\n---\n\n${text}\n`);
    console.error(`\nSaved: ${outPath}`);
  });
});
req.on('error', (e) => { console.error('request error:', e); process.exit(1); });
req.write(body);
req.end();
