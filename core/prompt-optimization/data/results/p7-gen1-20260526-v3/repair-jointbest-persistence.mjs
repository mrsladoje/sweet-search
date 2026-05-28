#!/usr/bin/env node
// Repair the per-probe persistence gap for the round-7 surgical-rerun winner
// 0xb44adf7c5563cd99. The prior `apply-rerun-correction.mjs` intentionally
// left `scores: {}` / `detail: {}` empty because the live rerun results
// were not captured in a persistable shape. This script:
//   1. Re-runs the 24 (probe, gpt5_5) pairs that originally failed silently
//      with 200-OK-no-usage-block from OpenRouter (same set the original
//      surgical rerun targeted, identified the same way: trajectory confirm
//      events where billable+cache_creation+output_tokens == 0).
//   2. Reuses the 56 good measurements from trajectory (40 sonnet + 16 good
//      gpt5_5) for free via a cache shim.
//   3. Calls buildCandidate to get a FULL candidate object including
//      scores{} (per-probe averaged) and detail{} (per-probe per-target
//      sonnet + gpt5_5 with judge panels + agent trajectories).
//   4. Writes 24 fresh `confirm` events into gepa-trajectory.jsonl with a
//      `repair_rerun: true` marker + timestamp, so future replay /
//      analysis sees the corrected per-probe values, not the silent-failure
//      originals.
//   5. Atomically updates pareto-current.json:
//      - joint-best 0xb44adf7c: populate scores{} + detail{} + refresh
//        nativeRelative (perTargetFactor + breakdown) from the new candidate;
//        KEEP the existing sharpnessScore (0.98125) because TARE is a
//        separate workflow not re-done here; APPEND an _amendment entry
//        recording this repair.
//      - drop 0x120958014e46182d (round-9 reflective admission) from the
//        front per user decision (strictly Pareto-dominated on
//        (finalScore, sharpnessScore) and no per-probe unique wins).
//   6. Backs everything up to *.before-repair.{json,jsonl} first.
//
// Cost: ~24 OpenRouter gpt5_5 calls = ~$0.50, ~2 min wall.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { makeRealEvaluateCandidate } from '../../../sweep/gepa-evaluate.mjs';
import { buildCandidate } from '../../../sweep/gepa-scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const RUN_DIR = __dirname;
const TARGET_HASH = '0xb44adf7c5563cd99';
const EXCLUDE_HASH = '0x120958014e46182d';

async function readJsonl(p) {
  const txt = await fs.readFile(p, 'utf8');
  return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function atomicWrite(filePath, contents) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  await fs.writeFile(tmp, contents);
  await fs.rename(tmp, filePath);
}

async function main() {
  const probesFile = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
  const probes = Array.isArray(probesFile) ? probesFile : probesFile.probes;
  const nativeBaseline = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'core/prompt-optimization/data/p7-native-baseline-dev-3panel.json'), 'utf8'));
  const promptBank = await readJsonl(path.join(RUN_DIR, 'prompt-bank.jsonl'));
  const traj = await readJsonl(path.join(RUN_DIR, 'gepa-trajectory.jsonl'));
  const paretoPath = path.join(RUN_DIR, 'pareto-current.json');
  const trajPath = path.join(RUN_DIR, 'gepa-trajectory.jsonl');
  const pareto = JSON.parse(await fs.readFile(paretoPath, 'utf8'));

  const promptEntry = promptBank.find((r) => r._kind === 'prompt' && r.hash === TARGET_HASH);
  if (!promptEntry) throw new Error(`prompt not found for ${TARGET_HASH}`);
  const promptText = promptEntry.text;
  console.log(`[repair] loaded variant prompt: ${promptText.length} chars, hash=${TARGET_HASH}`);

  // ─── backup ─────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.copyFile(paretoPath, paretoPath.replace(/\.json$/, `.before-repair-${stamp}.json`));
  await fs.copyFile(trajPath, trajPath.replace(/\.jsonl$/, `.before-repair-${stamp}.jsonl`));
  console.log(`[repair] backups written with stamp ${stamp}`);

  // ─── build cache from existing confirms ─────────────────────────────────
  const confirms = traj.filter((e) => e._kind === 'confirm' && e.round === 7 && e.mutation_hash === TARGET_HASH);
  console.log(`[repair] found ${confirms.length} prior round-7 confirm events (expect 80)`);

  const cache = new Map();
  const toRerun = [];
  for (const e of confirms) {
    const key = `${e.probe_id}|${e.target}`;
    const raw = e.target === 'sonnet' ? e.raw_sonnet : e.raw_gpt5_5;
    const ot = e.output_tokens || 0;
    const it = e.input_tokens || 0;
    const cr = e.cache_read_tokens || 0;
    const cc = e.cache_creation_tokens || 0;
    const billable = Math.max(0, it - (cr > 0 && cr <= it ? cr : 0));
    const work = billable + cc + ot;
    if (work === 0) {
      toRerun.push({ probe_id: e.probe_id, target: e.target });
      continue;
    }
    const evidencePen = e.evidence_adequacy_penalty;
    const nativePen = e.native_search_penalty;
    cache.set(key, {
      score: raw,
      toolCalls: e.tool_calls,
      finalAnswerEmitted: raw > 0 || e.tool_calls > 0,
      usedReadOrGrep: (evidencePen == null || evidencePen === 0) && e.tool_calls > 0,
      usedSweetSearch: e.tool_calls > 0 && !(nativePen > 0),
      usedNativeSearch: nativePen > 0,
      usedNativeRead: false,
      trajectory: { toolCalls: [], answer: '[cached from prior confirm]' },
      wallMs: e.wall_ms || 0,
      usage: {
        agent: {
          model_id: e.model_id,
          api_path: e.api_path,
          temperature: e.temperature ?? null,
          input_tokens: it,
          output_tokens: ot,
          cache_read_tokens: cr,
          cache_creation_tokens: cc,
          retry_count: e.retry_count ?? 0,
        },
        judges: [],
        repo_commit: e.repo_commit,
        probe_hash: e.probe_hash,
        token_count_prompt: e.token_count_prompt,
      },
    });
  }
  console.log(`[repair] cache: ${cache.size} good measurements; ${toRerun.length} to re-measure (all gpt5_5)`);
  if (toRerun.length === 0) {
    console.log('[repair] nothing to re-measure — abort');
    return;
  }

  // ─── evaluator shim: cache hit → reuse; miss → live + capture for trajectory write-back ─
  const realEval = makeRealEvaluateCandidate({
    agentProvider: 'api',
    models: { sonnet: 'claude-sonnet-4-6', gpt5_5: 'gpt-5.5-instant' },
  });
  let liveCalls = 0;
  const liveResults = []; // [{probe_id, target, probe, result}]
  const evaluateCandidate = async ({ promptText: pt, probe, target }) => {
    const key = `${probe.id}|${target}`;
    if (cache.has(key)) return cache.get(key);
    liveCalls += 1;
    console.log(`[repair] live ${liveCalls}/${toRerun.length}: ${key}`);
    const t0 = Date.now();
    const r = await realEval({ promptText: pt, probe, target });
    const ms = Date.now() - t0;
    const ot = r.usage?.agent?.output_tokens ?? null;
    const tc = r.toolCalls ?? null;
    console.log(`[repair]   → score=${r.score} tool_calls=${tc} output_tokens=${ot} ${ms}ms`);
    liveResults.push({ probe_id: probe.id, target, probe, result: r, wall_ms: ms });
    return r;
  };

  const weights = probes.map(() => 1);

  console.log('\n[repair] calling buildCandidate (concurrency=6) ...');
  const t0 = Date.now();
  const candidate = await buildCandidate({
    id: 'T2-r1-reflective-r3-reflective-r7-trajectory-crossover',
    prompt: promptText,
    sourceOp: 'trajectory-crossover',
    parentHash: '0x06e10aca321f2927',
    probes,
    weights,
    evaluateCandidate,
    nativeBaselineByTarget: nativeBaseline,
    concurrency: 6,
  });
  const elapsedMs = Date.now() - t0;
  console.log(`\n[repair] buildCandidate done in ${elapsedMs}ms; ${liveCalls} live calls`);
  console.log(`[repair] new candidate: score_sonnet=${candidate.score_sonnet} score_gpt5_5=${candidate.score_gpt5_5} finalScore=${candidate.finalScore}`);
  console.log(`[repair] candidate.scores has ${Object.keys(candidate.scores).length} probe entries`);
  console.log(`[repair] candidate.detail has ${Object.keys(candidate.detail).length} probe entries`);

  // ─── append corrected confirm events to trajectory ──────────────────────
  // These events SUPERSEDE the matching pre-correction events at the natural
  // key (round, mutation_hash, probe_id, target) without destructively
  // rewriting them. Trajectory readers MUST deduplicate by that key, preferring
  // events with `corrected: true` (and the older `_repair_rerun` marker, for
  // pre-2026-05-28 repair events that lacked the explicit flag). See
  // docs/PHASE7.md §4.6.2.
  const repairTs = new Date().toISOString();
  // Get a repo commit for the event (use the original confirms' commit so the events stay consistent).
  const repoCommit = confirms[0]?.repo_commit ?? null;
  const newConfirmLines = [];
  for (const { probe_id, target, probe, result, wall_ms } of liveResults) {
    const u = result.usage?.agent ?? {};
    const supersededEvent = confirms.find((c) => c.probe_id === probe_id && c.target === target) || null;
    const ev = {
      _kind: 'confirm',
      round: 7,
      mutation_hash: TARGET_HASH,
      prompt_hash: TARGET_HASH,
      probe_id,
      probe_hash: probe.hash ?? supersededEvent?.probe_hash ?? null,
      probe_stratum: probe.stratum ?? supersededEvent?.probe_stratum ?? null,
      target,
      model_id: u.model_id ?? (target === 'sonnet' ? 'claude-sonnet-4-6' : 'gpt-5.5-instant'),
      api_path: u.api_path ?? null,
      temperature: u.temperature ?? null,
      tool_schema_version: 'ss-v3',
      repo_commit: repoCommit,
      raw_sonnet: target === 'sonnet' ? result.score : null,
      raw_gpt5_5: target === 'gpt5_5' ? result.score : null,
      tool_calls: result.toolCalls ?? null,
      native_search_penalty: result.usedNativeSearch ? 0.1 : 0,
      evidence_adequacy_penalty: result.usedReadOrGrep ? null : 0,
      input_tokens: u.input_tokens ?? null,
      output_tokens: u.output_tokens ?? null,
      cache_read_tokens: u.cache_read_tokens ?? null,
      cache_creation_tokens: u.cache_creation_tokens ?? null,
      retry_count: u.retry_count ?? 0,
      wall_ms,
      judge_panel: result.usage?.judges ?? [],
      // Explicit supersession flags. `corrected: true` is the load-bearing
      // flag for trajectory readers; `supersedes` records the natural key
      // of the pre-correction event so audits can locate it.
      corrected: true,
      supersedes: {
        round: 7,
        mutation_hash: TARGET_HASH,
        probe_id,
        target,
      },
      _repair_rerun: {
        timestamp: repairTs,
        reason: 'jointbest-persistence-repair: replace round-7 silent-failure entry with live remeasurement',
      },
    };
    newConfirmLines.push(JSON.stringify(ev));
  }
  const appendBlob = newConfirmLines.length > 0 ? newConfirmLines.join('\n') + '\n' : '';
  if (appendBlob.length > 0) {
    await fs.appendFile(trajPath, appendBlob);
    console.log(`[repair] appended ${newConfirmLines.length} confirm events to trajectory`);
  }

  // ─── update pareto-current.json ─────────────────────────────────────────
  // 1. Find joint-best, replace scores/detail/nativeRelative, keep sharpness.
  const jbIndex = pareto.front.findIndex((m) => m.hash === TARGET_HASH);
  if (jbIndex < 0) throw new Error('joint-best not found in pareto-current.json front');
  const jb = pareto.front[jbIndex];
  const priorAmendment = jb._amendment ?? null;
  const newJb = {
    ...jb,
    // Populate per-probe data from the freshly built candidate.
    scores: candidate.scores,
    detail: candidate.detail,
    // Refresh probeIds in case ordering normalized.
    probeIds: candidate.probeIds,
    // Refresh nativeRelative (now includes perTargetFactor + breakdown the
    // old surgical rerun couldn't preserve).
    nativeRelative: candidate.nativeRelative,
    // Refresh aggregates from the rerun (should match within LLM noise).
    score_sonnet: candidate.score_sonnet,
    score_gpt5_5: candidate.score_gpt5_5,
    taskScore: candidate.taskScore,
    efficiencyFactor: candidate.efficiencyFactor,
    lengthPenalty: candidate.lengthPenalty,
    finalScore: candidate.finalScore,
    // sharpnessScore stays as the TARE-measured value (0.98125), NOT the
    // placeholder 1.0 that buildCandidate returns by default.
    sharpnessScore: jb.sharpnessScore,
    // Append amendment metadata.
    _amendment: {
      ...(priorAmendment || {}),
      jointbest_persistence_repair: {
        timestamp: repairTs,
        elapsed_ms: elapsedMs,
        live_calls: liveCalls,
        cached_calls: cache.size,
        prior_aggregates: {
          score_sonnet: jb.score_sonnet,
          score_gpt5_5: jb.score_gpt5_5,
          finalScore: jb.finalScore,
        },
        new_aggregates: {
          score_sonnet: candidate.score_sonnet,
          score_gpt5_5: candidate.score_gpt5_5,
          finalScore: candidate.finalScore,
        },
        note: 'Repopulated scores/detail/nativeRelative from live re-run; sharpnessScore preserved from TARE rerun amendment.',
      },
    },
  };
  pareto.front[jbIndex] = newJb;

  // 2. Drop the round-9 admission per user decision.
  const beforeCount = pareto.front.length;
  pareto.front = pareto.front.filter((m) => m.hash !== EXCLUDE_HASH);
  const dropped = beforeCount - pareto.front.length;
  console.log(`[repair] dropped ${dropped} member(s) by hash ${EXCLUDE_HASH}`);

  // 3. Record this exclusion in pareto.metadata or a top-level _amendments log.
  pareto._amendments = pareto._amendments ?? [];
  pareto._amendments.push({
    timestamp: repairTs,
    kind: 'manual-front-edit',
    actions: [
      {
        action: 'populate-scores-detail',
        target: TARGET_HASH,
        reason: 'fix round-7 surgical-rerun persistence gap (scores/detail were empty)',
      },
      {
        action: 'evict',
        target: EXCLUDE_HASH,
        reason: 'strictly Pareto-dominated on (finalScore, sharpnessScore) by all other front members; admitted only because empty-slot bypass at gepa-pareto.mjs:68; no per-probe unique wins',
      },
    ],
  });

  await atomicWrite(paretoPath, JSON.stringify(pareto, null, 2) + '\n');
  console.log(`[repair] wrote pareto-current.json; front now has ${pareto.front.length} members`);

  console.log('\n--- SUMMARY ---');
  console.log('elapsed_ms:', elapsedMs);
  console.log('live_calls:', liveCalls);
  console.log('cached_calls:', cache.size);
  console.log('new joint-best aggregates:');
  console.log('  score_sonnet:', candidate.score_sonnet);
  console.log('  score_gpt5_5:', candidate.score_gpt5_5);
  console.log('  finalScore:', candidate.finalScore);
  console.log('  scores entries:', Object.keys(candidate.scores).length);
  console.log('  detail entries:', Object.keys(candidate.detail).length);
  console.log('front member count:', pareto.front.length);
}

main().catch((err) => {
  console.error('[repair] FATAL:', err);
  process.exit(1);
});
