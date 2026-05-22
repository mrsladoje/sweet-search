/**
 * Spec-conformance regression tests for gepa-evaluate.mjs (PHASE7 §3.1, §7.4).
 *
 * These assert the SPEC behavior introduced by CC1 + B6 + CC3, NOT the
 * pre-fix code:
 *   - B6 — all-judges-fail THROWS AllJudgesFailedError (never coerces to 0).
 *   - CC1 — judgePanelScore returns { score, judges } with provider-specific
 *           raw.usage normalized to {input_tokens, output_tokens}; the real
 *           evaluateCandidate threads a `usage` object (agent + judges +
 *           repo_commit + probe_hash + token_count_prompt).
 *   - CC3 — optional judgeBucket seam acquires before each judge call.
 *   - M7 — buildGpt5ReasoningPayload remains temperature:1 + max_completion_tokens.
 *
 * NO network: a fake runJudgeFn is injected everywhere.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  judgePanelScore,
  AllJudgesFailedError,
  normalizeJudgeUsage,
  repoCommitFor,
  buildGpt5ReasoningPayload,
  buildJudgeUserPrompt,
  JUDGE_PANEL,
  JUDGE_SYSTEM_PROMPT,
  parseCodexAgentStream,
} from '../../../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { hashContent } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';
import { estimateTokens } from '../../../core/prompt-optimization/sweep/variant-loader.mjs';

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeProbe(overrides = {}) {
  return {
    id: 'PRB-1',
    repo: 'demo',
    language: 'js',
    stratum: 'literal-lookup',
    difficulty: 'easy',
    query: 'where is the parser entrypoint',
    expectedFiles: ['parser.js'],
    expectedSymbols: ['parse'],
    expectedFacts: [],
    expectedNoMatch: false,
    max_turns: 3,
    ...overrides,
  };
}

/** A runJudgeFn that returns the same verdict + usage for every panelist. */
function judgeAll({ score = 0.8, isError = false, usage = undefined, retryCount = 0, error } = {}) {
  return async ({ lineage, model }) => ({
    text: isError ? '' : JSON.stringify({ score, reason: 'ok' }),
    isError,
    error,
    retryCount,
    lineage,
    model,
    raw: { usage, retryCount },
  });
}

// ─── B6 — all-judges-fail must NOT coerce to 0 ────────────────────────────────

describe('judgePanelScore — B6 all-judges-fail (§3.7.1 selection integrity)', () => {
  it('THROWS AllJudgesFailedError when every panelist errors (never returns 0)', async () => {
    const runJudgeFn = judgeAll({ isError: true, error: 'empty-text-200' });
    await expect(
      judgePanelScore({ probe: makeProbe(), answer: 'a', runJudgeFn }),
    ).rejects.toBeInstanceOf(AllJudgesFailedError);
  });

  it('AllJudgesFailedError carries one judgeErrors entry per panelist', async () => {
    const runJudgeFn = judgeAll({ isError: true, error: 'rate-limit' });
    let caught;
    try {
      await judgePanelScore({ probe: makeProbe(), answer: 'a', runJudgeFn });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AllJudgesFailedError);
    expect(caught.judgeErrors).toHaveLength(JUDGE_PANEL.length);
    expect(caught.judgeErrors[0]).toMatchObject({ error: 'rate-limit' });
    expect(caught.judgeErrors.every((e) => e.model && e.lineage)).toBe(true);
  });

  it('with >=1 valid verdict returns { score, judges } (median of valid)', async () => {
    // 2 valid (0.4, 0.8) + 1 errored → median of the 2 valid = 0.6, NOT 0.
    let i = 0;
    const runJudgeFn = async ({ lineage, model }) => {
      const verdicts = [
        { text: JSON.stringify({ score: 0.4 }), isError: false, retryCount: 0, raw: { usage: { input_tokens: 10, output_tokens: 5 } } },
        { text: JSON.stringify({ score: 0.8 }), isError: false, retryCount: 1, raw: { usage: { prompt_tokens: 20, completion_tokens: 6 } } },
        { text: '', isError: true, error: 'boom', retryCount: 5, raw: {} },
      ];
      return { lineage, model, ...verdicts[i++] };
    };
    const out = await judgePanelScore({ probe: makeProbe(), answer: 'a', runJudgeFn });
    expect(out.score).toBeCloseTo(0.6, 10);
    expect(out.judges).toHaveLength(3);
    expect(out.judges[2].isError).toBe(true);
  });
});

// ─── CC1 — judges-usage normalization across provider shapes ──────────────────

describe('normalizeJudgeUsage — CC1 provider-shape normalization', () => {
  it('deepseek / openai-compatible {prompt_tokens, completion_tokens}', () => {
    expect(normalizeJudgeUsage({ prompt_tokens: 123, completion_tokens: 45 }))
      .toEqual({ input_tokens: 123, output_tokens: 45 });
  });
  it('gemini usageMetadata {promptTokenCount, candidatesTokenCount}', () => {
    expect(normalizeJudgeUsage({ promptTokenCount: 200, candidatesTokenCount: 30 }))
      .toEqual({ input_tokens: 200, output_tokens: 30 });
  });
  it('anthropic {input_tokens, output_tokens}', () => {
    expect(normalizeJudgeUsage({ input_tokens: 9, output_tokens: 1 }))
      .toEqual({ input_tokens: 9, output_tokens: 1 });
  });
  it('missing/null usage → both null', () => {
    expect(normalizeJudgeUsage(null)).toEqual({ input_tokens: null, output_tokens: null });
    expect(normalizeJudgeUsage(undefined)).toEqual({ input_tokens: null, output_tokens: null });
    expect(normalizeJudgeUsage({})).toEqual({ input_tokens: null, output_tokens: null });
  });
});

describe('judgePanelScore — CC1 judges[] usage + retry_count normalized', () => {
  it('normalizes each panelist usage across deepseek/gemini/anthropic shapes', async () => {
    // JUDGE_PANEL order: deepseek-api, google-api, minimax → feed shapes in order.
    const shapes = [
      { usage: { prompt_tokens: 100, completion_tokens: 10 }, retryCount: 0 },     // deepseek shape
      { usage: { promptTokenCount: 250, candidatesTokenCount: 22 }, retryCount: 2 }, // gemini shape
      { usage: { input_tokens: 77, output_tokens: 8 }, retryCount: 1 },             // anthropic shape
    ];
    let i = 0;
    const runJudgeFn = async ({ lineage, model }) => {
      const s = shapes[i++];
      return { lineage, model, text: JSON.stringify({ score: 0.5 }), isError: false, retryCount: s.retryCount, raw: { usage: s.usage } };
    };
    const out = await judgePanelScore({ probe: makeProbe(), answer: 'a', runJudgeFn });
    expect(out.judges[0]).toMatchObject({ lineage: 'deepseek-api', input_tokens: 100, output_tokens: 10, retry_count: 0, isError: false });
    expect(out.judges[1]).toMatchObject({ lineage: 'google-api', input_tokens: 250, output_tokens: 22, retry_count: 2 });
    expect(out.judges[2]).toMatchObject({ input_tokens: 77, output_tokens: 8, retry_count: 1 });
    // model/lineage carried from the panel
    expect(out.judges.map((j) => j.model)).toEqual(JUDGE_PANEL.map((p) => p.model));
  });

  it('null usage → null token fields (no throw)', async () => {
    const runJudgeFn = judgeAll({ score: 0.7, usage: undefined });
    const out = await judgePanelScore({ probe: makeProbe(), answer: 'a', runJudgeFn });
    expect(out.judges.every((j) => j.input_tokens === null && j.output_tokens === null)).toBe(true);
  });
});

// ─── CC3 — optional judgeBucket seam ──────────────────────────────────────────

describe('judgePanelScore — CC3 judgeBucket seam', () => {
  it('acquires the bucket once per panelist when provided', async () => {
    const acquire = vi.fn(async () => ({}));
    const runJudgeFn = judgeAll({ score: 0.9, usage: { input_tokens: 1, output_tokens: 1 } });
    await judgePanelScore({ probe: makeProbe(), answer: 'a', runJudgeFn, judgeBucket: { acquire } });
    expect(acquire).toHaveBeenCalledTimes(JUDGE_PANEL.length);
  });

  it('default (no judgeBucket) does not require a bucket', async () => {
    const runJudgeFn = judgeAll({ score: 0.9 });
    const out = await judgePanelScore({ probe: makeProbe(), answer: 'a', runJudgeFn });
    expect(out.score).toBeCloseTo(0.9, 10);
  });
});

// ─── CC1 — probe_hash + token_count_prompt + repo_commit computation ──────────

describe('CC1 usage-metadata computation helpers', () => {
  it('probe_hash = hashContent(`${id}|${query}`)', () => {
    const probe = makeProbe();
    expect(hashContent(`${probe.id}|${probe.query}`)).toMatch(/^0x[0-9a-f]{16}$/);
  });

  it('token_count_prompt = estimateTokens(promptText)', () => {
    const prompt = 'a'.repeat(400);
    expect(estimateTokens(prompt)).toBe(100); // 400 chars / 4
  });

  it('repoCommitFor returns null for a non-repo dir (best-effort, no throw)', () => {
    expect(repoCommitFor('/nonexistent/path/that/is/not/a/repo')).toBeNull();
  });

  it('repoCommitFor returns null for empty/invalid input', () => {
    expect(repoCommitFor('')).toBeNull();
    expect(repoCommitFor(null)).toBeNull();
  });
});

// ─── M7 — reasoning payload builder unchanged ─────────────────────────────────

describe('buildGpt5ReasoningPayload — M7 caveat (§3.5.2)', () => {
  it('uses temperature:1 + max_completion_tokens (never max_tokens)', () => {
    const p = buildGpt5ReasoningPayload({ systemPrompt: 's', userPrompt: 'u', maxCompletionTokens: 8000 });
    expect(p.temperature).toBe(1);
    expect(p.max_completion_tokens).toBe(8000);
    expect(p.max_tokens).toBeUndefined();
    expect(p.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
  });
});

// ─── prompt-builder sanity (unchanged contracts) ──────────────────────────────

describe('judge prompt builders (unchanged)', () => {
  it('buildJudgeUserPrompt embeds the query + gold + answer', () => {
    const up = buildJudgeUserPrompt({ probe: makeProbe(), answer: 'found it' });
    expect(up).toMatch(/where is the parser entrypoint/);
    expect(up).toMatch(/found it/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/strict grader/);
  });
});

// Fixture pinned to the real codex-cli 0.132 `exec --json` schema (B1, 2026-05-22).
// If a future codex build changes the event shape, these fail loudly instead of
// silently returning 0 tool calls + empty answer (the original bug).
const CODEX_0132_JSONL = [
  '{"type":"thread.started","thread_id":"t1"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"`[features].codex_hooks` is deprecated."}}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \'ss-search parser\'","status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \'ss-search parser\'","aggregated_output":"hit\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"The parser entrypoint is in src/main.rs"}}',
  '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":42,"reasoning_output_tokens":0}}',
].join('\n');

describe('parseCodexAgentStream — codex-cli 0.132 schema (B1)', () => {
  it('extracts command_execution tool calls, the agent_message answer, and usage', () => {
    const { toolCalls, answer, usage } = parseCodexAgentStream(CODEX_0132_JSONL);
    expect(toolCalls).toHaveLength(1); // only the COMPLETED command, not the in_progress start
    expect(toolCalls[0].name).toMatch(/ss-search/);
    expect(answer).toBe('The parser entrypoint is in src/main.rs');
    expect(usage).toEqual({ input_tokens: 100, cached_input_tokens: 20, output_tokens: 42, reasoning_output_tokens: 0 });
  });

  it('ignores the deprecation error item (does not leak it into the answer)', () => {
    const { answer } = parseCodexAgentStream(CODEX_0132_JSONL);
    expect(answer).not.toMatch(/deprecated/);
  });

  it('returns empty result for empty stdout', () => {
    expect(parseCodexAgentStream('')).toEqual({ toolCalls: [], answer: '', usage: null });
  });

  it('does not match the pre-0.132 function_call/tool_call event names', () => {
    const legacy = '{"type":"function_call","name":"ss-search"}\n{"type":"tool_call","tool":"ss-grep"}';
    expect(parseCodexAgentStream(legacy).toolCalls).toHaveLength(0);
  });
});
