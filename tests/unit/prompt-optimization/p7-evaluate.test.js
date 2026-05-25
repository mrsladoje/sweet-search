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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  extractCodexErrorMessages,
  classifyToolUse,
  buildAgentUserPrompt,
} from '../../../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { hashContent } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';
import { estimateTokens } from '../../../core/prompt-optimization/sweep/variant-loader.mjs';
import {
  buildAnthropicAgentPayload,
  buildOpenRouterAgentPayload,
  resolveOpenRouterAgentModel,
  validateBashCommand,
  addOpenAIUsage,
  addAnthropicUsage,
  AGENT_TOOL_CALL_CAP,
  classifyAgentStatus,
  runAnthropicApiAgent,
  runOpenRouterApiAgent,
  _apiAgentInternal,
} from '../../../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';

describe('tool-call ceiling + sufficiency framing (no tight truncation)', () => {
  it('AGENT_TOOL_CALL_CAP is a generous runaway guard (40), not a tight per-probe budget', () => {
    expect(AGENT_TOOL_CALL_CAP).toBe(40);
  });

  it('buildAgentUserPrompt no longer injects a numeric "stay within N" budget', () => {
    const p = buildAgentUserPrompt({ query: 'find the thing', max_turns: 3 });
    expect(p).not.toMatch(/stay within/i);
    expect(p).not.toMatch(/\b3 tool calls\b/);
    expect(p).toMatch(/as many tool calls as you need/i);
    expect(p).toMatch(/stop as soon as your evidence covers the answer/i);
  });
});

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

describe('extractCodexErrorMessages', () => {
  it('extracts user-visible Codex failure messages from JSONL', () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"config warning"}}',
      '{"type":"error","message":"usage limit"}',
      '{"type":"turn.failed","error":{"message":"usage limit"}}',
    ].join('\n');

    expect(extractCodexErrorMessages(jsonl)).toEqual(['config warning', 'usage limit']);
  });
});

describe('API-backed Phase 7 agent runner helpers', () => {
  it('builds Anthropic tool-use payloads with Bash and Read tools', () => {
    const p = buildAnthropicAgentPayload({
      model: 'claude-sonnet-4-6',
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'task' }],
    });
    expect(p.system[0].text).toMatch(/system/);
    expect(p.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(p.tools.map((t) => t.name)).toEqual(['Bash', 'Read']);
    expect(p.tool_choice).toEqual({ type: 'auto' });
    // rolling cache breakpoint lands on the final message's last content block
    expect(p.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('keeps exactly two cache breakpoints across a growing tool-loop transcript', () => {
    const grown = [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: [{ type: 'text', text: 'thinking' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'rg output' }] },
    ];
    const p = buildAnthropicAgentPayload({ systemPrompt: 'sys', messages: grown });
    const marks = JSON.stringify(p.messages).split('"cache_control"').length - 1;
    expect(marks).toBe(1); // exactly one rolling breakpoint in messages (+1 on system)
    expect(p.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    // caller's array is never mutated
    expect(grown.at(-1).content.at(-1).cache_control).toBeUndefined();
  });

  it('routes GPT-5.5 through the OpenRouter slug with minimal reasoning', () => {
    const p = buildOpenRouterAgentPayload({
      model: 'gpt-5.5-instant',
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'task' }],
    });
    expect(resolveOpenRouterAgentModel('gpt-5.5-instant')).toBe('openai/gpt-5.5');
    expect(p.model).toBe('openai/gpt-5.5');
    expect(p.reasoning).toEqual({ effort: 'minimal' });
    expect(p.tools.map((t) => t.function.name)).toEqual(['Bash', 'Read']);
  });

  it('blocks sweet-search and write/network shell commands for native API baselines', () => {
    expect(validateBashCommand('rg -n "foo" .').ok).toBe(true);
    expect(validateBashCommand('ss-search foo').ok).toBe(false);
    expect(validateBashCommand('ss-search foo', { allowSweetSearch: true }).ok).toBe(true);
    expect(validateBashCommand("rg foo . --glob '!.sweet-search/**'").ok).toBe(true);
    expect(validateBashCommand('cat .sweet-search/index.json').ok).toBe(false);
    expect(validateBashCommand('curl https://example.com').ok).toBe(false);
    expect(validateBashCommand('sed -i s/a/b/ file.js').ok).toBe(false);
  });

  it('accounts stateless API replay context as cached input for scoring parity', () => {
    const openai = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, max_input_tokens: 0 };
    addOpenAIUsage(openai, { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } });
    addOpenAIUsage(openai, { prompt_tokens: 150, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } });
    expect(openai).toMatchObject({ input_tokens: 250, output_tokens: 30, cached_input_tokens: 100, max_input_tokens: 150 });

    const anthropic = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, max_input_tokens: 0 };
    addAnthropicUsage(anthropic, { input_tokens: 80, output_tokens: 5 });
    addAnthropicUsage(anthropic, { input_tokens: 120, output_tokens: 7 });
    expect(anthropic).toMatchObject({ input_tokens: 200, output_tokens: 12, cache_read_input_tokens: 80, max_input_tokens: 120 });
  });
});

// ─── agent runner transient-error retry (the §Q2 fix) ───────────────────────
//
// The paid agent loop now retries transient 429/5xx/network faults instead of
// turning them into an empty answer (→ judged ~0 → contaminated probe score).
// HTTP is injected via _apiAgentInternal.fetch; sleep is stubbed so the backoff
// ladder does not actually wait.
describe('agent runner transient-error retry (mirrors judge ladder)', () => {
  const jsonRes = (json) => ({
    ok: true, status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
    headers: { get: () => null },
  });
  const errRes = (status, body = 'err', retryAfter) => ({
    ok: false, status,
    json: async () => ({}),
    text: async () => body,
    headers: { get: (h) => (String(h).toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) },
  });
  const seqFetch = (items) => vi.fn(async () => {
    const next = items.shift();
    if (next === undefined) throw new Error('seqFetch: no more responses queued');
    return typeof next === 'function' ? next() : next;
  });

  let origFetch, origSleep, origAnthKey, origOrKey;
  beforeEach(() => {
    origFetch = _apiAgentInternal.fetch;
    origSleep = _apiAgentInternal.sleep;
    origAnthKey = process.env.ANTHROPIC_API_KEY;
    origOrKey = process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-anth-key';
    process.env.OPENROUTER_API_KEY = 'test-or-key';
    _apiAgentInternal.sleep = async () => {}; // no real backoff waits
  });
  afterEach(() => {
    _apiAgentInternal.fetch = origFetch;
    _apiAgentInternal.sleep = origSleep;
    if (origAnthKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = origAnthKey;
    if (origOrKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = origOrKey;
  });

  it('classifyAgentStatus: 429→rate-limit, 5xx/network→server, 4xx/timeout→fatal', () => {
    expect(classifyAgentStatus(429)).toBe('retry-rate-limit');
    expect(classifyAgentStatus(503)).toBe('retry-server');
    expect(classifyAgentStatus('network')).toBe('retry-server');
    expect(classifyAgentStatus('timeout')).toBe('fatal');
    expect(classifyAgentStatus(401)).toBe('fatal');
    expect(classifyAgentStatus(400)).toBe('fatal');
  });

  it('Anthropic agent: transient 429 then 200 → succeeds, retryCount=1', async () => {
    _apiAgentInternal.fetch = seqFetch([
      errRes(429, 'slow down', '0'),
      jsonRes({ content: [{ type: 'text', text: 'the answer' }], usage: { input_tokens: 5, output_tokens: 3 } }),
    ]);
    const r = await runAnthropicApiAgent({ prompt: 'task', model: 'claude-sonnet-4-6', cwd: process.cwd() });
    expect(r.isError).toBe(false);
    expect(r.finalResultText).toBe('the answer');
    expect(r.retryCount).toBe(1);
    expect(_apiAgentInternal.fetch).toHaveBeenCalledTimes(2);
  });

  it('Anthropic agent: persistent 429 → exhausts ladder, isError, bounded calls', async () => {
    _apiAgentInternal.fetch = vi.fn(async () => errRes(429, 'rate', '0'));
    const r = await runAnthropicApiAgent({ prompt: 'task', cwd: process.cwd() });
    expect(r.isError).toBe(true);
    expect(r.retryCount).toBe(5); // AGENT_MAX_RATE_LIMIT_RETRIES
    expect(_apiAgentInternal.fetch).toHaveBeenCalledTimes(6); // 1 initial + 5 retries
  });

  it('Anthropic agent: 4xx (401) is fatal — no retry', async () => {
    _apiAgentInternal.fetch = vi.fn(async () => errRes(401, 'unauthorized'));
    const r = await runAnthropicApiAgent({ prompt: 'task', cwd: process.cwd() });
    expect(r.isError).toBe(true);
    expect(r.retryCount).toBe(0);
    expect(_apiAgentInternal.fetch).toHaveBeenCalledTimes(1);
  });

  it('OpenRouter agent: transient 503 then 200 → succeeds, retryCount=1', async () => {
    _apiAgentInternal.fetch = seqFetch([
      errRes(503, 'upstream down'),
      jsonRes({ choices: [{ message: { content: 'ok', tool_calls: [] } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }),
    ]);
    const r = await runOpenRouterApiAgent({ prompt: 'task', model: 'gpt-5.5-instant', cwd: process.cwd() });
    expect(r.isError).toBe(false);
    expect(r.finalResultText).toBe('ok');
    expect(r.retryCount).toBe(1);
    expect(_apiAgentInternal.fetch).toHaveBeenCalledTimes(2);
  });

  it('OpenRouter agent: network throw then 200 → retried as transient', async () => {
    let n = 0;
    _apiAgentInternal.fetch = vi.fn(async () => {
      if (n++ === 0) throw new Error('fetch failed'); // ECONNRESET-style transient
      return jsonRes({ choices: [{ message: { content: 'recovered', tool_calls: [] } }], usage: {} });
    });
    const r = await runOpenRouterApiAgent({ prompt: 'task', model: 'gpt-5.5-instant', cwd: process.cwd() });
    expect(r.isError).toBe(false);
    expect(r.finalResultText).toBe('recovered');
    expect(r.retryCount).toBe(1);
  });
});

// ─── classifyToolUse — name + command (Claude Bash-wrap vs Codex command-name) ─

describe('classifyToolUse', () => {
  it('credits a Claude Bash-wrapped ss-search call (name=Bash, cmd in input.command)', () => {
    // The bug this guards: testing tc.name alone scored every Claude ss-* call
    // as "no evidence" and applied the evidence-adequacy penalty (eas.mjs:67).
    const r = classifyToolUse([{ name: 'Bash', input: { command: 'ss-search "where is foo defined" -k 5' } }]);
    expect(r).toEqual({ ss: true, nativeSearch: false, nativeRead: false });
  });

  it('credits a Codex command-name ss-find call (name = full command string)', () => {
    const r = classifyToolUse([{ name: 'ss-find "x" --regex "\\bX\\b"', input: { command: 'ss-find "x" --regex "\\bX\\b"' } }]);
    expect(r.ss).toBe(true);
    expect(r.nativeSearch).toBe(false);
  });

  it('flags native grep/rg in a Bash command as nativeSearch, not ss', () => {
    expect(classifyToolUse([{ name: 'Bash', input: { command: 'grep -rn foo .' } }]))
      .toEqual({ ss: false, nativeSearch: true, nativeRead: false });
    expect(classifyToolUse([{ name: 'rg foo', input: { command: 'rg foo' } }]).nativeSearch).toBe(true);
  });

  it('never counts ss-grep / ss-read as native (the ss guard wins first)', () => {
    expect(classifyToolUse([{ name: 'Bash', input: { command: 'ss-grep "\\bfoo\\b"' } }]))
      .toEqual({ ss: true, nativeSearch: false, nativeRead: false });
    expect(classifyToolUse([{ name: 'Bash', input: { command: 'ss-read src/x.js 10 40' } }]).ss).toBe(true);
  });

  it('flags Claude native Read tool and shell cat as nativeRead', () => {
    expect(classifyToolUse([{ name: 'Read', input: { file_path: 'a.js' } }]).nativeRead).toBe(true);
    expect(classifyToolUse([{ name: 'Bash', input: { command: 'cat a.js' } }]).nativeRead).toBe(true);
  });

  it('does not false-positive on grep mentioned inside an ss-search query string', () => {
    const r = classifyToolUse([{ name: 'Bash', input: { command: 'ss-search "where is the grep handler"' } }]);
    expect(r).toEqual({ ss: true, nativeSearch: false, nativeRead: false });
  });

  it('handles empty / malformed input safely', () => {
    expect(classifyToolUse([])).toEqual({ ss: false, nativeSearch: false, nativeRead: false });
    expect(classifyToolUse(null)).toEqual({ ss: false, nativeSearch: false, nativeRead: false });
    expect(classifyToolUse([{}, { name: 42 }])).toEqual({ ss: false, nativeSearch: false, nativeRead: false });
  });
});
