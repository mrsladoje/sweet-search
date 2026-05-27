#!/usr/bin/env node
/**
 * One-off experiment: run ALL 5 OP-* operators against the round-5-end state
 * of p7-gen1-20260526-v3 using Gemini 3.1 Pro Deep Think instead of Kimi K2.6.
 *
 * For each operator we:
 *   1. Reuse the EXACT production prompt builder (no re-write).
 *   2. Wrap the system prompt with two extra clauses:
 *      - anti-overfitting reminder (60/40 dev/heldout discipline)
 *      - web-search availability via Google Search grounding tool
 *   3. Call gemini-3.1-pro-preview with thinkingBudget=-1 + googleSearch tool.
 *   4. Validate the output via the same §3.2.1 token validator.
 *   5. Save full output + validation to disk.
 *
 * NOT integrated into the GEPA driver. NOT committed. Pure scratch for the
 * user to inspect whether DeepThink produces materially better mutations.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

import { buildReflectivePrompt } from '../../../sweep/gepa-mutate.mjs';
import { buildTrajectoryCrossoverPrompt } from '../../../sweep/op-trajectory-crossover.mjs';
import { buildPersonaPivotPrompt, countConditionalRules, pickGenerator } from '../../../sweep/op-persona-pivot.mjs';
import { buildToolMaskPrompt, makeAliasMap, applyMask, unMask } from '../../../sweep/op-tool-mask.mjs';
import { buildPrunerPrompt, checkProtectedBlocks } from '../../../sweep/op-pruner.mjs';
import { validateMutation } from '../../../sweep/token-validator.mjs';
import { topFailures } from '../../../sweep/gepa-scoring.mjs';
import { mulberry32 } from '../../../stats/rng.mjs';
import { findCrossoverPair } from '../../../sweep/gepa-pareto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = __dirname;
const OUT_DIR = resolve(RUN_DIR, 'gemini-op-experiment');
mkdirSync(OUT_DIR, { recursive: true });

const PROBES_FILE = resolve(RUN_DIR, '../../p7-dev-probes.json');
const MODEL = 'gemini-3.1-pro-preview';

// ─── load round-5 end state ─────────────────────────────────────────────────
const pc = JSON.parse(readFileSync(resolve(RUN_DIR, 'pareto-current.json'), 'utf8'));
const bankLines = readFileSync(resolve(RUN_DIR, 'prompt-bank.jsonl'), 'utf8').trim().split('\n');
const promptByHash = Object.fromEntries(
  bankLines.map((l) => JSON.parse(l)).filter((r) => r._kind === 'prompt').map((r) => [r.hash, r.text]),
);
const probesDoc = JSON.parse(readFileSync(PROBES_FILE, 'utf8'));
const probeMap = new Map(probesDoc.probes.map((p) => [p.id, p]));

const JOINT_BEST_HASH = '0xe9c1421a31a50f5a';
const jointBest = pc.front.find((m) => m.hash === JOINT_BEST_HASH);
if (!jointBest) throw new Error(`joint_best ${JOINT_BEST_HASH} not on front`);
const candidatePrompt = promptByHash[JOINT_BEST_HASH];
if (!candidatePrompt) throw new Error('joint_best prompt missing from bank');
console.error(`Loaded round-5 joint_best: ${jointBest.id}  finalScore=${jointBest.finalScore.toFixed(4)}`);
console.error(`Pareto front: ${pc.front.length} members`);

// ─── augmentation: anti-overfit + web-search clauses ────────────────────────
const ANTI_OVERFIT_CLAUSE =
  '\n\n## ANTI-OVERFITTING DISCIPLINE\n' +
  'The probes you see come from the DEV split (60% of the benchmark); a HELDOUT split of 40% has been ' +
  'set aside and will be used to validate this prompt later. Do NOT tailor the prompt to specific probe ' +
  'IDs, individual query phrasings, or single-repo idioms. Edits should be GENERAL: improve the underlying ' +
  'reasoning or routing pattern, not the symptom on one query. If a proposed edit would only help one or ' +
  'two probes and could plausibly hurt unseen ones, reject it.';

const WEB_SEARCH_CLAUSE =
  '\n\n## WEB SEARCH AVAILABLE\n' +
  'You have the googleSearch tool available. Use it ONLY if you need to verify a specific external ' +
  'claim (e.g. a language-feature fact, a tool best-practice, an established research result). Do NOT ' +
  'use it to look up the probes themselves or to copy patterns from other people\'s system prompts. ' +
  'Cite any search you use in a brief comment inside the prompt only if directly load-bearing for an edit.';

function augmentSystem(systemPrompt) {
  return systemPrompt + ANTI_OVERFIT_CLAUSE + WEB_SEARCH_CLAUSE;
}

// ─── Gemini 3.1 Pro Deep Think direct caller ────────────────────────────────
function callGeminiDeepThink({ systemPrompt, userPrompt }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      thinkingConfig: { thinkingBudget: -1, includeThoughts: false },
      maxOutputTokens: 32768,
      temperature: 0.4,
    },
  });
  const path = `/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  return new Promise((resolveP, rejectP) => {
    const t0 = Date.now();
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 600000,
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => (chunks += d));
      res.on('end', () => {
        const wall = Date.now() - t0;
        let parsed;
        try { parsed = JSON.parse(chunks); }
        catch (e) { rejectP(new Error(`parse error: ${e.message}; body[0..500]=${chunks.slice(0, 500)}`)); return; }
        if (parsed.error) {
          resolveP({ ok: false, error: parsed.error, raw: parsed, wall });
          return;
        }
        const cand = parsed.candidates?.[0];
        const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
        const grounding = cand?.groundingMetadata ?? null;
        const usage = parsed.usageMetadata ?? {};
        resolveP({ ok: true, text, grounding, usage, finishReason: cand?.finishReason, wall, raw: parsed });
      });
    });
    req.on('error', (e) => rejectP(e));
    req.on('timeout', () => { req.destroy(); rejectP(new Error('request timed out after 600s')); });
    req.write(body);
    req.end();
  });
}

// ─── build per-operator prompts ─────────────────────────────────────────────

function buildOpInputs() {
  const ops = [];

  // OP-1: reflective on joint_best, with topFailures over its scores+detail
  const failures = topFailures({ candidate: jointBest, probes: probesDoc.probes, limit: 5 });
  console.error(`OP-1 failures (joint <=0.4): ${failures.length}`);
  if (failures.length === 0) {
    // joint_best has nothing under 0.4 — relax the gate so the reflective slot
    // still has something to chew on (this is the same edge the production
    // loop would hit; we use the 5 lowest joint scores instead of <=0.4).
    const sorted = Object.entries(jointBest.scores)
      .map(([pid, s]) => ({ pid, s }))
      .sort((a, b) => a.s - b.s)
      .slice(0, 5);
    for (const { pid } of sorted) {
      const p = probeMap.get(pid);
      const d = jointBest.detail?.[pid];
      const worse = d ? (d.sonnet.score <= d.gpt5_5.score ? 'sonnet' : 'gpt5_5') : 'sonnet';
      const traj = d?.[worse]?.traj || { toolCalls: [], answer: '' };
      failures.push({
        probeId: pid, stratum: p?.stratum, repo: p?.repo, query: p?.query,
        jointScore: jointBest.scores[pid], target: worse,
        toolCalls: traj.toolCalls, answer: traj.answer,
        expectedFiles: p?.expectedFiles ?? [],
      });
    }
    console.error(`OP-1 (relaxed): using 5 lowest-joint probes instead`);
  }
  const reflective = buildReflectivePrompt({ candidate: candidatePrompt, failures });
  ops.push({ name: 'op1-reflective', systemPrompt: reflective.systemPrompt, userPrompt: reflective.userPrompt, source: candidatePrompt });

  // OP-2: trajectory-crossover; reproduce production pair-finder over front
  const activeIds = probesDoc.probes.map((p) => p.id);
  const pair = findCrossoverPair({ front: pc.front, probeIds: activeIds });
  if (pair) {
    const probe = probeMap.get(pair.probeId);
    const dW = pair.winner.detail?.[pair.probeId];
    const dL = pair.loser.detail?.[pair.probeId];
    const targetW = dW ? (dW.sonnet.score >= dW.gpt5_5.score ? 'sonnet' : 'gpt5_5') : 'sonnet';
    const targetL = dL ? (dL.sonnet.score <= dL.gpt5_5.score ? 'sonnet' : 'gpt5_5') : 'sonnet';
    const trajA = { target: targetW, ...(dW?.[targetW]?.traj ?? { toolCalls: [], answer: '' }) };
    const trajB = { target: targetL, ...(dL?.[targetL]?.traj ?? { toolCalls: [], answer: '' }) };
    const xover = buildTrajectoryCrossoverPrompt({ probe, promptA: pair.winner.prompt, promptB: pair.loser.prompt, trajectoryA: trajA, trajectoryB: trajB });
    ops.push({ name: 'op2-trajectory-crossover', systemPrompt: xover.systemPrompt, userPrompt: xover.userPrompt, source: pair.winner.prompt, pair_meta: { probeId: pair.probeId, winner: pair.winner.id, loser: pair.loser.id } });
    console.error(`OP-2 pair: winner=${pair.winner.id} loser=${pair.loser.id} probe=${pair.probeId}`);
  } else {
    // No production-eligible pair available. Synthesize one across the lowest-
    // joint candidate (loser) and the joint_best (winner) so OP-2 still has
    // an input — flag it as synthesized in the metadata.
    const sortedFront = [...pc.front].sort((a, b) => a.finalScore - b.finalScore);
    const winner = jointBest, loser = sortedFront[0] === jointBest ? sortedFront[1] : sortedFront[0];
    // pick any probe both members have detail for
    const probeId = Object.keys(winner.detail).find((p) => loser.detail?.[p]);
    const probe = probeMap.get(probeId);
    const trajA = { target: 'sonnet', ...(winner.detail[probeId]?.sonnet?.traj ?? {}) };
    const trajB = { target: 'gpt5_5', ...(loser.detail[probeId]?.gpt5_5?.traj ?? {}) };
    const xover = buildTrajectoryCrossoverPrompt({ probe, promptA: winner.prompt, promptB: loser.prompt, trajectoryA: trajA, trajectoryB: trajB });
    ops.push({ name: 'op2-trajectory-crossover-synth', systemPrompt: xover.systemPrompt, userPrompt: xover.userPrompt, source: winner.prompt, pair_meta: { synthesized: true, probeId, winner: winner.id, loser: loser.id } });
    console.error(`OP-2: no production pair; synthesized winner=${winner.id} loser=${loser.id} probe=${probeId}`);
  }

  // OP-3: persona-pivot — mode-a or mode-b based on conditional-rule count
  const mode = countConditionalRules(candidatePrompt) >= 3 ? 'b' : 'a';
  const generator = pickGenerator(6);
  const persona = buildPersonaPivotPrompt({ candidate: candidatePrompt, mode, generator });
  ops.push({ name: 'op3-persona-pivot', systemPrompt: persona.systemPrompt, userPrompt: persona.userPrompt, source: candidatePrompt, op_meta: { mode, productionGenerator: generator } });
  console.error(`OP-3 mode: ${mode}`);

  // OP-4: tool-mask — apply mask, ask for improvement, plan to unmask on receive
  const rng = mulberry32(0xdeadbeef);
  const aliasMap = makeAliasMap(rng);
  const maskedCandidate = applyMask(candidatePrompt, aliasMap);
  const tm = buildToolMaskPrompt({ maskedCandidate });
  ops.push({ name: 'op4-tool-mask', systemPrompt: tm.systemPrompt, userPrompt: tm.userPrompt, source: candidatePrompt, op_meta: { aliasMapEntries: [...aliasMap.entries()] }, _aliasMap: aliasMap });
  console.error(`OP-4 aliasMap: ${[...aliasMap.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);

  // OP-5: pruner
  const pruner = buildPrunerPrompt({ candidate: candidatePrompt });
  ops.push({ name: 'op5-pruner', systemPrompt: pruner.systemPrompt, userPrompt: pruner.userPrompt, source: candidatePrompt });

  return ops;
}

// ─── runner ─────────────────────────────────────────────────────────────────
async function main() {
  const ops = buildOpInputs();
  console.error(`\nRunning ${ops.length} operators against gemini-3.1-pro-preview (Deep Think) with googleSearch grounding...`);

  const summary = [];
  for (const op of ops) {
    console.error(`\n─── ${op.name} ───`);
    const augmentedSystem = augmentSystem(op.systemPrompt);
    let result;
    try {
      result = await callGeminiDeepThink({ systemPrompt: augmentedSystem, userPrompt: op.userPrompt });
    } catch (e) {
      console.error(`  HTTP error: ${e.message}`);
      summary.push({ name: op.name, ok: false, http_error: e.message });
      writeFileSync(`${OUT_DIR}/${op.name}.error.txt`, `HTTP error: ${e.message}`);
      continue;
    }
    if (!result.ok) {
      console.error(`  Gemini error: ${JSON.stringify(result.error).slice(0, 300)}`);
      summary.push({ name: op.name, ok: false, gemini_error: result.error });
      writeFileSync(`${OUT_DIR}/${op.name}.error.json`, JSON.stringify(result, null, 2));
      continue;
    }
    let mutated = result.text;
    if (op.name === 'op4-tool-mask') {
      mutated = unMask(mutated, op._aliasMap);
    }
    let validation = validateMutation({ source: op.source, mutated, op: op.name.replace(/^op\d-/, '') });
    let prunerBlockFailures = [];
    if (op.name === 'op5-pruner') {
      prunerBlockFailures = checkProtectedBlocks(op.source, result.text);
    }
    const ok = validation.ok && prunerBlockFailures.length === 0;

    const reqTokens = (s) => (s ? s.length / 4 : 0); // rough char-to-token estimate
    const meta = {
      name: op.name,
      accepted: ok,
      validation_failures: validation.failures,
      pruner_block_failures: prunerBlockFailures,
      wall_ms: result.wall,
      finish_reason: result.finishReason,
      usage: result.usage,
      grounding_used: !!(result.grounding && (result.grounding.webSearchQueries?.length || result.grounding.searchEntryPoint || result.grounding.groundingChunks?.length)),
      grounding: result.grounding ?? null,
      op_meta: op.op_meta ?? op.pair_meta ?? null,
      system_chars: augmentedSystem.length,
      user_chars: op.userPrompt.length,
      mutated_chars: mutated.length,
      source_chars: op.source.length,
      delta_chars: mutated.length - op.source.length,
      approx_input_tokens: Math.round(reqTokens(augmentedSystem) + reqTokens(op.userPrompt)),
    };
    summary.push(meta);

    writeFileSync(`${OUT_DIR}/${op.name}.mutated.txt`, mutated);
    writeFileSync(`${OUT_DIR}/${op.name}.system.txt`, augmentedSystem);
    writeFileSync(`${OUT_DIR}/${op.name}.user.txt`, op.userPrompt);
    writeFileSync(`${OUT_DIR}/${op.name}.meta.json`, JSON.stringify(meta, null, 2));
    console.error(`  → ${ok ? 'ACCEPTED' : 'REJECTED'}  wall=${(result.wall / 1000).toFixed(1)}s  in≈${meta.usage?.promptTokenCount} out=${meta.usage?.candidatesTokenCount} think=${meta.usage?.thoughtsTokenCount}  Δchars=${meta.delta_chars}`);
    if (!ok) {
      const reasons = validation.failures.map((f) => f.reason).join(',') || (prunerBlockFailures.length ? 'fenced-block-altered' : '?');
      console.error(`    failures: ${reasons}`);
    }
    if (meta.grounding_used) {
      const queries = result.grounding?.webSearchQueries ?? [];
      console.error(`    web search used: ${queries.length} queries — ${queries.slice(0, 3).join(' | ')}`);
    }
  }

  writeFileSync(`${OUT_DIR}/SUMMARY.json`, JSON.stringify({ model: MODEL, joint_best: JOINT_BEST_HASH, runs: summary }, null, 2));

  console.error('\n══ SUMMARY ══');
  console.error(`Output dir: ${OUT_DIR}`);
  const totalIn = summary.reduce((a, m) => a + (m.usage?.promptTokenCount ?? 0), 0);
  const totalOut = summary.reduce((a, m) => a + (m.usage?.candidatesTokenCount ?? 0), 0);
  const totalThink = summary.reduce((a, m) => a + (m.usage?.thoughtsTokenCount ?? 0), 0);
  const accepted = summary.filter((m) => m.accepted).length;
  console.error(`${accepted}/${summary.length} accepted by §3.2.1 token validator`);
  console.error(`Total tokens: in=${totalIn} out=${totalOut} thinking=${totalThink}`);
  // Gemini 3.1 Pro pricing (rough, as of 2026-05): $2.50/M input, $20/M output, thinking billed as output
  const approxCost = (totalIn * 2.50 + (totalOut + totalThink) * 20) / 1e6;
  console.error(`Approx cost: $${approxCost.toFixed(2)} (input $2.50/M, output+thinking $20/M)`);
}

main().catch((e) => { console.error('FATAL:', e?.stack ?? e); process.exit(1); });
