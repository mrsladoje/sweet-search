/**
 * Unit tests for core/prompt-optimization/sweep/gepa-finalize.mjs.
 *
 * Covers (spec-conformance, all stubbed — NO network):
 *   - B1 resume-replay: buildReplayMap + makeResumeReplayEvaluate replay an
 *     already-paid (round,kind,mutation_hash,probe,target) step instead of
 *     re-calling the evaluator (§7.4 "no re-spending").
 *   - CC2/M13 finalizeRun: §4 winner-selection gates run IN ORDER, short-circuit
 *     on the first failure, persist each result, write the ship-file, and open
 *     the Vault EXACTLY once at the end (§5.8).
 *   - M7 reasoning adapters: makeReasoningAdapters builds (prompt,probes)=>{score}
 *     runners that runReasoningHomp consumes; the structural runJudge default
 *     uses the reasoning payloads (thinking / useCompletionTokens), never temp-0.
 *   - renderShipFile YAML front-matter (§4 step 11).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildReplayMap,
  makeResumeReplayEvaluate,
  replayKey,
  makeReasoningAdapters,
  finalizeRun,
  renderShipFile,
  buildConfirmEvent,
} from '../../../core/prompt-optimization/sweep/gepa-finalize.mjs';
import { appendFsynced } from '../../../core/prompt-optimization/sweep/p7-persist.mjs';
import { DEFAULTS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

let tmp;
beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), 'p7-fin-')); });
afterEach(() => { if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

function makeWinner(over = {}) {
  return {
    id: 'W', hash: '0xwinner', prompt: 'You are a code-search agent. Use [[ss-search]].',
    tokenCount: 800, score_sonnet: 0.72, score_gpt5_5: 0.70,
    taskScore: 0.70, efficiencyFactor: 1.0, lengthPenalty: 0.04, finalScore: 0.66,
    scores: { p1: 0.7 }, ...over,
  };
}

// ─── B1 — resume-replay helpers ─────────────────────────────────────────────

describe('B1 — buildReplayMap + makeResumeReplayEvaluate (§7.4 no re-spending)', () => {
  it('buildReplayMap indexes SCREEN + CONFIRM scores by (round,kind,mutation_hash,probe,target)', () => {
    const tPath = path.join(tmp, 'traj.jsonl');
    appendFsynced(tPath, { _kind: 'screen', round: 3, mutation_hash: '0xabc', probe_id: 'p1', target: 'sonnet', score: 0.81, tool_calls: 2, input_tokens: 100, output_tokens: 20 });
    appendFsynced(tPath, { _kind: 'confirm', round: 3, mutation_hash: '0xdef', probe_id: 'p2', target: 'gpt5_5', raw_sonnet: 0.6, raw_gpt5_5: 0.55, tool_calls: 4, input_tokens: 200, output_tokens: 30 });
    appendFsynced(tPath, { _kind: 'mutation', round: 3, new_prompt_hash: '0xabc' }); // ignored
    const map = buildReplayMap(tPath);
    expect(map.get(replayKey({ kind: 'screen', round: 3, mutationHash: '0xabc', probeId: 'p1', target: 'sonnet' })).score).toBeCloseTo(0.81);
    expect(map.get(replayKey({ kind: 'screen', round: 3, mutationHash: '0xabc', probeId: 'p1', target: 'sonnet' })).usage.agent.input_tokens).toBe(100);
    // confirm row stores the per-target raw score for the row's target
    expect(map.get(replayKey({ kind: 'confirm', round: 3, mutationHash: '0xdef', probeId: 'p2', target: 'gpt5_5' })).score).toBeCloseTo(0.55);
    expect(map.size).toBe(2);
  });

  it('replays a completed step instead of calling the evaluator; runs live for an unpaid step', async () => {
    const tPath = path.join(tmp, 'traj.jsonl');
    appendFsynced(tPath, { _kind: 'screen', round: 3, mutation_hash: '0xm1', probe_id: 'p1', target: 'sonnet', score: 0.9, tool_calls: 3, input_tokens: 100, output_tokens: 20 });
    const map = buildReplayMap(tPath);
    const completed = new Set([replayKey({ kind: 'screen', round: 3, mutationHash: '0xm1', probeId: 'p1', target: 'sonnet' })]);

    let liveCalls = 0;
    const real = async () => { liveCalls += 1; return { score: 0.123, toolCalls: 1, finalAnswerEmitted: true, usedReadOrGrep: true, trajectory: { toolCalls: [], answer: '' }, wallMs: 1 }; };
    const layer = makeResumeReplayEvaluate({ evaluateCandidate: real, completedStepIds: completed, replayMap: map });

    // enter the round-3 screen context for mutation 0xm1
    layer.enterStep({ kind: 'screen', round: 3, mutationHash: '0xm1' });
    const replayed = await layer.evaluate({ probe: { id: 'p1' }, target: 'sonnet', promptText: 'x' });
    expect(replayed.replayed).toBe(true);
    expect(replayed.score).toBeCloseTo(0.9); // persisted score, NOT 0.123
    expect(replayed.usage.agent).toMatchObject({ input_tokens: 100, output_tokens: 20 });
    expect(liveCalls).toBe(0); // no API call paid for the already-completed step

    // an UNPAID (probe,target) under the same context → live call
    const live = await layer.evaluate({ probe: { id: 'p2' }, target: 'sonnet', promptText: 'x' });
    expect(live.score).toBeCloseTo(0.123);
    expect(liveCalls).toBe(1);
    expect(layer.replayedCount()).toBe(1);
  });

  it('is an identity pass-through for a fresh run (empty maps)', async () => {
    let liveCalls = 0;
    const real = async () => { liveCalls += 1; return { score: 0.5, toolCalls: 1, finalAnswerEmitted: true, usedReadOrGrep: true, trajectory: { toolCalls: [], answer: '' }, wallMs: 1 }; };
    const layer = makeResumeReplayEvaluate({ evaluateCandidate: real, completedStepIds: new Set(), replayMap: new Map() });
    layer.enterStep({ kind: 'screen', round: 1, mutationHash: '0xz' });
    await layer.evaluate({ probe: { id: 'p1' }, target: 'sonnet', promptText: 'x' });
    expect(liveCalls).toBe(1);
    expect(layer.replayedCount()).toBe(0);
  });
});

// ─── B2 — buildConfirmEvent (forensic, exported from finalize) ───────────────

describe('B2 — buildConfirmEvent forensic shape', () => {
  it('threads usage + the REAL judge panel and derives the EAS window', () => {
    const survivor = { hash: '0xs', detail: { p1: { sonnet: { score: 0.7 }, gpt5_5: { score: 0.6 } } }, scores: { p1: 0.6 }, efficiencyFactor: 0.98, nativeRelative: { factor: 0.82, perTargetFactor: { sonnet: 0.84, gpt5_5: 0.82 } }, lengthPenalty: 0.04, finalScore: 0.55, tokenCount: 1200 };
    const d = {
      score: 0.7,
      traj: { toolCalls: [{}, {}, {}, {}], answer: 'hello' },
      usage: { agent: { model_id: 'm', api_path: 'claude-cli', temperature: null, input_tokens: 100, output_tokens: 20, cache_read_tokens: 5, retry_count: 1 }, repo_commit: 'abc', probe_hash: '0xph', token_count_prompt: 1180 },
    };
    const ev = buildConfirmEvent({ round: 7, survivor, probe: { stratum: 'multi-file-flow' }, pid: 'p1', target: 'sonnet', d });
    expect(ev.judge_panel).toContain('abab6.5s-chat');
    expect(ev.repo_commit).toBe('abc');
    expect(ev.input_tokens).toBe(100);
    expect(ev.expected_call_window).toEqual([3, 6]);
    expect(ev.call_deviation_penalty).toBeCloseTo(0, 6); // 4 calls in [3,6]
    expect(ev.native_relative_factor).toBeCloseTo(0.82, 6);
    expect(ev.native_relative_target_factors.gpt5_5).toBeCloseTo(0.82, 6);
    expect(ev.result_bytes).toBe(Buffer.byteLength('hello', 'utf8'));
    expect(ev.tool_schema_version).toBe('ss-v3');
  });
});

// ─── M7 — reasoning adapters ────────────────────────────────────────────────

describe('M7 — makeReasoningAdapters (§3.5.2)', () => {
  it('builds (prompt,probes)=>{score} runners that aggregate per-probe scores', async () => {
    const replayProbe = vi.fn(async ({ className }) => (className === 'sonnet-thinking' ? 0.8 : 0.6));
    const { runSonnetThinking, runGptReasoning } = makeReasoningAdapters({ replayProbe });
    const probes = [{ id: 'a' }, { id: 'b' }];
    expect((await runSonnetThinking('p', probes)).score).toBeCloseTo(0.8);
    expect((await runGptReasoning('p', probes)).score).toBeCloseTo(0.6);
    expect(replayProbe).toHaveBeenCalledTimes(4);
  });

  it('the default runJudge-backed scorer uses the reasoning payloads (thinking / useCompletionTokens), never temp-0', async () => {
    const seen = [];
    const runJudge = vi.fn(async (req) => { seen.push(req); return { isError: false, text: 'ok' }; });
    const { runSonnetThinking, runGptReasoning } = makeReasoningAdapters({ runJudge, thinkingBudget: 8000, maxTokens: 8000 });
    await runSonnetThinking('winner', [{ id: 'a' }]);
    await runGptReasoning('winner', [{ id: 'a' }]);
    const sonnetReq = seen.find((r) => r.lineage === 'anthropic-api');
    const gptReq = seen.find((r) => r.lineage === 'openai-api');
    expect(sonnetReq.thinking).toBe(8000); // extended-thinking ON
    expect(gptReq.useCompletionTokens).toBe(true); // reasoning payload, not buildOpenAIPayload
    expect(sonnetReq.temperature).toBeUndefined(); // never forces temp-0
  });

  it('runReasoningHomp consumes the adapters end-to-end', async () => {
    const { runReasoningHomp } = await import('../../../core/prompt-optimization/sweep/p7-reasoning-homp.mjs');
    const adapters = makeReasoningAdapters({ replayProbe: async () => 0.6 });
    const res = await runReasoningHomp({
      winnerPrompt: 'w', heldoutProbes: [{ id: 'a' }],
      runSonnetThinking: adapters.runSonnetThinking, runGptReasoning: adapters.runGptReasoning,
      baseFinalScore: 0.8, // threshold = 0.56
    });
    expect(res.pass).toBe(true); // 0.6 ≥ 0.56 on both
  });
});

// ─── renderShipFile ─────────────────────────────────────────────────────────

describe('renderShipFile (§4 step 11)', () => {
  it('emits YAML front-matter with both raw scores + joint Maximin + final score', () => {
    const body = renderShipFile({ runId: 'p7-v1', winner: makeWinner(), gates: { scs: { cwSCS: 0.85, minParaphraseAccuracy: 0.7 } }, vault: { maximin: 0.64, withinExpected: true } });
    expect(body).toMatch(/^---\n/);
    expect(body).toMatch(/run_id: p7-v1/);
    expect(body).toMatch(/score_sonnet: 0.72/);
    expect(body).toMatch(/score_gpt5_5: 0.7/);
    expect(body).toMatch(/joint_maximin: 0.7/);
    expect(body).toMatch(/final_score: 0.66/);
    expect(body).toMatch(/vault_maximin: 0.64/);
    expect(body).toContain('You are a code-search agent.'); // the prompt body follows
  });
});

// ─── CC2/M13 — finalizeRun gate ordering ────────────────────────────────────

describe('CC2/M13 — finalizeRun winner-selection gates (§4 steps 10–12)', () => {
  function gateDir() { const d = path.join(tmp, 'gates'); mkdirSync(d, { recursive: true }); return d; }

  it('blocks at the per-target floor (gate 1) before spending on later gates', async () => {
    const runFamilyHomp = vi.fn(async () => ({ pass: true }));
    const r = await finalizeRun({
      winner: makeWinner({ score_sonnet: 0.4 }), // < 0.5 floor
      heldoutProbes: [{ id: 'h' }], runFamilyHomp,
      paths: { trajectory: path.join(tmp, 't.jsonl'), gateDir: gateDir() },
    });
    expect(r.ship).toBe(false);
    expect(r.blockedBy).toBe('floor');
    expect(runFamilyHomp).not.toHaveBeenCalled(); // short-circuit
    expect(existsSync(path.join(tmp, 'gates', 'gate-floor.json'))).toBe(true);
  });

  it('blocks at the length cap (gate 6, checked pre-spend) before family HOMP', async () => {
    const runFamilyHomp = vi.fn(async () => ({ pass: true }));
    const r = await finalizeRun({
      winner: makeWinner({ tokenCount: DEFAULTS.shipTokenCap + 1 }),
      heldoutProbes: [{ id: 'h' }], runFamilyHomp,
      paths: { trajectory: path.join(tmp, 't.jsonl'), gateDir: gateDir() },
    });
    expect(r.ship).toBe(false);
    expect(r.blockedBy).toBe('length');
    expect(runFamilyHomp).not.toHaveBeenCalled();
  });

  it('runs gates IN ORDER and blocks at the OOD gate, never reaching SCS/vault', async () => {
    const calls = [];
    const runFamilyHomp = async () => { calls.push('family'); return { pass: true }; };
    const runOod = async () => { calls.push('ood'); return { pass: false, maximin_sonnet: 0.4, maximin_gpt: 0.5 }; };
    const reasoningAdapters = { runSonnetThinking: async () => { calls.push('reason-s'); return { score: 1 }; }, runGptReasoning: async () => { calls.push('reason-g'); return { score: 1 }; } };
    const scsEvaluate = async () => { calls.push('scs'); return { answer: 'a', tokenCount: 1, correct: true }; };
    const evaluateVault = async () => { calls.push('vault'); return { maximin: 0.6 }; };

    const r = await finalizeRun({
      winner: makeWinner(),
      heldoutProbes: [{ id: 'h' }], oodProbes: [{ id: 'o' }], scsProbes: [{ id: 's' }], vaultProbes: [{ id: 'v' }],
      runFamilyHomp, runOod, reasoningAdapters, scsEvaluate, scsEmbed: async (xs) => xs.map(() => [1, 0]), scsPrompts: ['p'],
      evaluateVault, baseFinalScore: 0.66,
      paths: { trajectory: path.join(tmp, 't.jsonl'), gateDir: gateDir() },
    });
    expect(r.ship).toBe(false);
    expect(r.blockedBy).toBe('ood');
    // gates 2 (family) → 3 (ood) ran; reasoning/scs/vault did NOT
    expect(calls).toEqual(['family', 'ood']);
    expect(existsSync(path.join(tmp, 'gates', 'gate-ood.json'))).toBe(true);
  });

  it('runs the §5.7 counter-probe gate AFTER OOD, blocks on overfit, and feeds it the RAW dev taskScore', async () => {
    const calls = [];
    let seenDevScore = null;
    const runFamilyHomp = async () => { calls.push('family'); return { pass: true }; };
    const runOod = async () => { calls.push('ood'); return { pass: true, maximin_sonnet: 0.6, maximin_gpt: 0.6 }; };
    const runCounterProbe = async ({ devScore }) => { calls.push('counter'); seenDevScore = devScore; return { pass: false, overfit: true, drop: 0.4, counterMaximin: 0.42 }; };
    const reasoningAdapters = { runSonnetThinking: async () => { calls.push('reason'); return { score: 1 }; }, runGptReasoning: async () => ({ score: 1 }) };

    const r = await finalizeRun({
      winner: makeWinner(), // taskScore 0.70, finalScore 0.66 — distinct on purpose
      heldoutProbes: [{ id: 'h' }], oodProbes: [{ id: 'o' }], counterProbes: [{ id: 'c' }],
      runFamilyHomp, runOod, runCounterProbe, reasoningAdapters,
      paths: { trajectory: path.join(tmp, 't.jsonl'), gateDir: gateDir() },
    });
    expect(r.ship).toBe(false);
    expect(r.blockedBy).toBe('counter-probe');
    // ordering: family → ood → counter; reasoning never reached (short-circuit)
    expect(calls).toEqual(['family', 'ood', 'counter']);
    // baseline is the winner's RAW taskScore (0.70), NOT the penalized finalScore (0.66)
    expect(seenDevScore).toBe(0.70);
    expect(existsSync(path.join(tmp, 'gates', 'gate-counter-probe.json'))).toBe(true);
  });

  it('lets the run proceed past a GENERALISED counter-probe gate (pass) on to reasoning/vault', async () => {
    const calls = [];
    const r = await finalizeRun({
      winner: makeWinner(),
      heldoutProbes: [{ id: 'h' }], oodProbes: [{ id: 'o' }], counterProbes: [{ id: 'c' }], vaultProbes: [{ id: 'v' }],
      runFamilyHomp: async () => { calls.push('family'); return { pass: true }; },
      runOod: async () => { calls.push('ood'); return { pass: true, maximin_sonnet: 0.6, maximin_gpt: 0.6 }; },
      runCounterProbe: async () => { calls.push('counter'); return { pass: true, generalised: true, drop: 0.05, counterMaximin: 0.665 }; },
      reasoningAdapters: makeReasoningAdapters({ replayProbe: async () => { calls.push('reason'); return 0.9; } }),
      evaluateVault: async () => { calls.push('vault'); return { maximin: 0.62 }; },
      heldoutFinalScore: 0.66,
      paths: { trajectory: path.join(tmp, 't.jsonl'), gateDir: gateDir() },
      shipFilePath: path.join(tmp, 'p7-final', 'ship-cp.md'),
    });
    expect(r.blockedBy).toBeNull();
    expect(r.ship).toBe(true);
    // counter ran strictly between ood and reasoning, and the run reached the vault
    expect(calls.indexOf('counter')).toBeGreaterThan(calls.indexOf('ood'));
    expect(calls.indexOf('counter')).toBeLessThan(calls.indexOf('reason'));
    expect(calls).toContain('vault');
  });

  it('passes all gates, writes the ship-file, and opens the Vault EXACTLY ONCE at the end', async () => {
    let vaultOpens = 0;
    const order = [];
    const r = await finalizeRun({
      runId: 'p7-v1',
      winner: makeWinner(),
      heldoutProbes: [{ id: 'h' }], oodProbes: [{ id: 'o', language: 'C' }], scsProbes: [{ id: 's' }], vaultProbes: [{ id: 'v' }],
      runFamilyHomp: async () => { order.push('family'); return { pass: true, classes: {} }; },
      runOod: async () => { order.push('ood'); return { pass: true, maximin_sonnet: 0.6, maximin_gpt: 0.6, perLanguage: {}, weakSpots: [] }; },
      reasoningAdapters: makeReasoningAdapters({ replayProbe: async () => { order.push('reason'); return 0.9; } }),
      scsEvaluate: async () => ({ answer: 'same', tokenCount: 10, correct: true }),
      scsEmbed: async (xs) => xs.map(() => [1, 0, 0]),
      scsPrompts: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], // 7 versions → AC threshold met
      evaluateVault: async () => { vaultOpens += 1; order.push('vault'); return { maximin: 0.60 }; },
      heldoutFinalScore: 0.66,
      paths: { trajectory: path.join(tmp, 't.jsonl'), gateDir: gateDir() },
      shipFilePath: path.join(tmp, 'p7-final', 'sweet-search-system-prompt.md'),
    });
    expect(r.ship).toBe(true);
    expect(r.blockedBy).toBeNull();
    expect(vaultOpens).toBe(1); // §5.8 — opened EXACTLY once
    // ship file written with YAML front-matter
    const shipPath = path.join(tmp, 'p7-final', 'sweet-search-system-prompt.md');
    expect(existsSync(shipPath)).toBe(true);
    expect(readFileSync(shipPath, 'utf8')).toMatch(/run_id: p7-v1/);
    // vault opened AFTER all the gate runners (last in the order)
    expect(order[order.length - 1]).toBe('vault');
    // within ~15% of held-out (0.66 → 0.60 is ~9% drop) → generalizes
    expect(r.vault.withinExpected).toBe(true);
  });

  it('flags a >25% vault drop as a documented overfit finding (winner still ships)', async () => {
    const r = await finalizeRun({
      winner: makeWinner(),
      heldoutProbes: [{ id: 'h' }], vaultProbes: [{ id: 'v' }],
      runFamilyHomp: async () => ({ pass: true }),
      reasoningAdapters: makeReasoningAdapters({ replayProbe: async () => 0.9 }),
      evaluateVault: async () => ({ maximin: 0.40 }), // 0.66 → 0.40 = ~39% drop
      heldoutFinalScore: 0.66,
      paths: { trajectory: path.join(tmp, 't.jsonl'), gateDir: gateDir() },
      shipFilePath: path.join(tmp, 'p7-final', 'ship.md'),
    });
    expect(r.ship).toBe(true); // vault is report-only, NOT a gate (§5.8)
    expect(r.vault.overfit).toBe(true);
    expect(r.vault.withinExpected).toBe(false);
  });
});
