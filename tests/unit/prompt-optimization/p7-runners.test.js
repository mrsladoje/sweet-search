/**
 * Unit tests for the Phase 7 direct-API runners added to
 * eval/agent-read-workflows/judge-runner.js:
 *   - buildAnthropicPayload / parseAnthropicResponse  (anthropic-api lineage)
 *   - buildOpenAIPayload   / parseOpenAIResponse      (openai-api + compat shim)
 *   - runJudge dispatch: anthropic-api, openai-api, moonshot, minimax, mimo,
 *                        qwen, dashscope
 *   - parseJudgeModelSpec: new heuristic prefixes
 *
 * All HTTP is injected via `_internal.fetch`; no real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  parseJudgeModelSpec,
  buildAnthropicPayload,
  parseAnthropicResponse,
  buildOpenAIPayload,
  buildOpenAIReasoningPayload,
  parseOpenAIResponse,
  classifyResponseStatus,
  runJudge,
  _internal,
} from '../../../eval/agent-read-workflows/judge-runner.js';

// ─── parseJudgeModelSpec — new lineage prefixes ──────────────────────────────

describe('parseJudgeModelSpec — new lineage heuristics', () => {
  it('kimi- prefix → moonshot', () => {
    expect(parseJudgeModelSpec('kimi-k2.6').lineage).toBe('moonshot');
  });

  it('moonshot- prefix → moonshot', () => {
    expect(parseJudgeModelSpec('moonshot-v1').lineage).toBe('moonshot');
  });

  it('minimax prefix → minimax', () => {
    expect(parseJudgeModelSpec('minimax-m2.7').lineage).toBe('minimax');
  });

  it('abab prefix → minimax', () => {
    expect(parseJudgeModelSpec('abab6.5s-chat').lineage).toBe('minimax');
  });

  it('mimo prefix → mimo', () => {
    expect(parseJudgeModelSpec('mimo-v2.5-pro').lineage).toBe('mimo');
  });

  it('qwen prefix → qwen (not opencode)', () => {
    expect(parseJudgeModelSpec('qwen3.6-plus').lineage).toBe('qwen');
    expect(parseJudgeModelSpec('qwen2.5-72b').lineage).toBe('qwen');
  });

  it('explicit anthropic-api:model form', () => {
    expect(parseJudgeModelSpec('anthropic-api:claude-sonnet-4-6')).toEqual({
      lineage: 'anthropic-api', model: 'claude-sonnet-4-6',
    });
  });

  it('explicit openai-api:model form', () => {
    expect(parseJudgeModelSpec('openai-api:gpt-4.1')).toEqual({
      lineage: 'openai-api', model: 'gpt-4.1',
    });
  });

  it('explicit moonshot:model form', () => {
    expect(parseJudgeModelSpec('moonshot:kimi-k2.6')).toEqual({
      lineage: 'moonshot', model: 'kimi-k2.6',
    });
  });

  it('explicit minimax:model form', () => {
    expect(parseJudgeModelSpec('minimax:abab6.5s-chat')).toEqual({
      lineage: 'minimax', model: 'abab6.5s-chat',
    });
  });

  it('explicit mimo:model form', () => {
    expect(parseJudgeModelSpec('mimo:MiMo-V2.5-Pro')).toEqual({
      lineage: 'mimo', model: 'MiMo-V2.5-Pro',
    });
  });

  it('explicit qwen:model form', () => {
    expect(parseJudgeModelSpec('qwen:qwen3.6-plus')).toEqual({
      lineage: 'qwen', model: 'qwen3.6-plus',
    });
  });

  it('explicit dashscope:model form', () => {
    expect(parseJudgeModelSpec('dashscope:qwen3.6-plus')).toEqual({
      lineage: 'dashscope', model: 'qwen3.6-plus',
    });
  });

  it('llama-/mistral-/command- still route to opencode', () => {
    expect(parseJudgeModelSpec('llama-4-instruct-70b').lineage).toBe('opencode');
    expect(parseJudgeModelSpec('mistral-large').lineage).toBe('opencode');
    expect(parseJudgeModelSpec('command-r-plus').lineage).toBe('opencode');
  });
});

// ─── buildAnthropicPayload ───────────────────────────────────────────────────

describe('buildAnthropicPayload', () => {
  it('emits {model, system, messages, max_tokens, temperature}', () => {
    const p = buildAnthropicPayload({
      model: 'claude-sonnet-4-6',
      systemPrompt: 'system text',
      userPrompt: 'user text',
    });
    expect(p.model).toBe('claude-sonnet-4-6');
    expect(p.system).toBe('system text');
    expect(p.messages).toEqual([{ role: 'user', content: 'user text' }]);
    expect(p.max_tokens).toBe(4096);
    expect(p.temperature).toBe(0);
  });

  it('omits `system` key when systemPrompt is falsy', () => {
    const p = buildAnthropicPayload({ userPrompt: 'u' });
    expect('system' in p).toBe(false);
    const p2 = buildAnthropicPayload({ userPrompt: 'u', systemPrompt: '' });
    expect('system' in p2).toBe(false);
  });

  it('adds thinking block when thinking arg is a number (§3.5.2)', () => {
    const p = buildAnthropicPayload({ userPrompt: 'u', thinking: 1024 });
    expect(p.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });

  it('does NOT add thinking when arg is absent', () => {
    const p = buildAnthropicPayload({ userPrompt: 'u' });
    expect('thinking' in p).toBe(false);
  });

  it('forces temperature to 1 when thinking is enabled (API constraint)', () => {
    // Extended thinking is incompatible with temperature != 1 → API 400.
    const p = buildAnthropicPayload({ userPrompt: 'u', thinking: 1024, temperature: 0 });
    expect(p.temperature).toBe(1);
    // ...but leaves temperature untouched when thinking is OFF.
    const p2 = buildAnthropicPayload({ userPrompt: 'u', temperature: 0 });
    expect(p2.temperature).toBe(0);
  });

  it('lifts max_tokens above budget_tokens when thinking budget exceeds it (§3.5.2)', () => {
    // §3.5.2 uses budget_tokens:8000; default max_tokens 4096 would 400.
    const p = buildAnthropicPayload({ userPrompt: 'u', thinking: 8000 });
    expect(p.max_tokens).toBeGreaterThan(8000);
    // Caller-supplied max_tokens already above the budget is preserved.
    const p2 = buildAnthropicPayload({ userPrompt: 'u', thinking: 2000, maxTokens: 16000 });
    expect(p2.max_tokens).toBe(16000);
  });

  it('defaults model to claude-sonnet-4-6', () => {
    const p = buildAnthropicPayload({ userPrompt: 'u' });
    expect(p.model).toBe('claude-sonnet-4-6');
  });

  it('respects custom maxTokens and temperature', () => {
    const p = buildAnthropicPayload({ userPrompt: 'u', maxTokens: 512, temperature: 0.3 });
    expect(p.max_tokens).toBe(512);
    expect(p.temperature).toBe(0.3);
  });
});

// ─── parseAnthropicResponse ──────────────────────────────────────────────────

describe('parseAnthropicResponse', () => {
  it('concatenates text blocks and skips thinking blocks', () => {
    const json = {
      content: [
        { type: 'thinking', thinking: 'internal chain-of-thought' },
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
    };
    expect(parseAnthropicResponse(json)).toBe('hello world');
  });

  it('returns empty string when content array is empty', () => {
    expect(parseAnthropicResponse({ content: [] })).toBe('');
  });

  it('returns empty string when content key is missing', () => {
    expect(parseAnthropicResponse({})).toBe('');
    expect(parseAnthropicResponse(null)).toBe('');
  });

  it('skips non-text blocks (tool_use, etc.)', () => {
    const json = {
      content: [
        { type: 'tool_use', id: 'x', name: 'ss-search', input: {} },
        { type: 'text', text: 'answer' },
      ],
    };
    expect(parseAnthropicResponse(json)).toBe('answer');
  });
});

// ─── buildOpenAIPayload ──────────────────────────────────────────────────────

describe('buildOpenAIPayload', () => {
  it('emits OpenAI-compatible {model, messages, temperature, max_tokens, stream:false}', () => {
    const p = buildOpenAIPayload({
      model: 'gpt-5.5', systemPrompt: 'sys', userPrompt: 'usr',
    });
    expect(p.model).toBe('gpt-5.5');
    expect(p.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
    expect(p.temperature).toBe(0);
    expect(p.max_tokens).toBe(4096);
    expect(p.stream).toBe(false);
  });

  it('omits system message when systemPrompt is falsy', () => {
    const p = buildOpenAIPayload({ userPrompt: 'u' });
    expect(p.messages).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('respects custom temperature and maxTokens', () => {
    const p = buildOpenAIPayload({ userPrompt: 'u', temperature: 0.7, maxTokens: 512 });
    expect(p.temperature).toBe(0.7);
    expect(p.max_tokens).toBe(512);
  });

  it('defaults model to gpt-4.1', () => {
    const p = buildOpenAIPayload({ userPrompt: 'u' });
    expect(p.model).toBe('gpt-4.1');
  });
});

// ─── parseOpenAIResponse ─────────────────────────────────────────────────────

describe('parseOpenAIResponse', () => {
  it('extracts choices[0].message.content', () => {
    expect(parseOpenAIResponse({
      choices: [{ message: { content: 'hello' } }],
    })).toBe('hello');
  });

  it('returns empty on missing choices', () => {
    expect(parseOpenAIResponse({})).toBe('');
    expect(parseOpenAIResponse({ choices: [] })).toBe('');
    expect(parseOpenAIResponse(null)).toBe('');
  });
});

// ─── runJudge dispatch helpers ────────────────────────────────────────────────

function makeFetch(responseJson) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => responseJson,
  }));
}

function makeFetchError(status, body = 'error body') {
  return vi.fn(async () => ({
    ok: false, status,
    text: async () => body,
  }));
}

// ─── runJudge — anthropic-api lineage ────────────────────────────────────────

describe('runJudge — anthropic-api', () => {
  let origFetch;
  beforeEach(() => { origFetch = _internal.fetch; });
  afterEach(() => {
    _internal.fetch = origFetch;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('routes through fetch and parses content blocks', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    _internal.fetch = makeFetch({
      content: [{ type: 'text', text: 'anthropic verdict' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const r = await runJudge({
      lineage: 'anthropic-api', model: 'claude-sonnet-4-6',
      systemPrompt: 'judge', userPrompt: 'rate this',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('anthropic verdict');
    expect(r.lineage).toBe('anthropic-api');
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(typeof r.latencyMs).toBe('number');
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'test-anthropic-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  it('errors when ANTHROPIC_API_KEY is not set', async () => {
    const r = await runJudge({
      lineage: 'anthropic-api', model: 'claude-sonnet-4-6',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('non-OK HTTP response → isError with status in raw', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    _internal.fetch = makeFetchError(401, 'unauthorized');
    const r = await runJudge({
      lineage: 'anthropic-api', model: 'claude-sonnet-4-6',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.raw.status).toBe(401);
  });

  it('thinking blocks are stripped from response text', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    _internal.fetch = makeFetch({
      content: [
        { type: 'thinking', thinking: 'chain of thought' },
        { type: 'text', text: 'final answer' },
      ],
    });
    const r = await runJudge({
      lineage: 'anthropic-api', model: 'claude-sonnet-4-6',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.text).toBe('final answer');
  });

  it('thinking arg flows onto the wire with corrected temperature/max_tokens (§3.5.2)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    _internal.fetch = makeFetch({ content: [{ type: 'text', text: 'ok' }] });
    await runJudge({
      lineage: 'anthropic-api', model: 'claude-sonnet-4-6',
      systemPrompt: 'judge', userPrompt: 'rate', thinking: 8000,
    });
    const body = JSON.parse(_internal.fetch.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
    expect(body.temperature).toBe(1);
    expect(body.max_tokens).toBeGreaterThan(8000);
  });
});

// ─── runJudge — openai-api lineage ───────────────────────────────────────────

describe('runJudge — openai-api', () => {
  let origFetch;
  let origSleep;
  beforeEach(() => {
    origFetch = _internal.fetch;
    origSleep = _internal.sleep;
    // Fake sleep so the retry/backoff wrapper does not actually wait.
    _internal.sleep = vi.fn(async () => {});
  });
  afterEach(() => {
    _internal.fetch = origFetch;
    _internal.sleep = origSleep;
    delete process.env.OPENAI_API_KEY;
  });

  it('routes through fetch to OpenAI endpoint and parses choices', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    _internal.fetch = makeFetch({
      choices: [{ message: { content: 'openai reply' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5',
      systemPrompt: 'sys', userPrompt: 'usr',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('openai reply');
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-openai-key' }),
      }),
    );
  });

  it('errors when OPENAI_API_KEY is not set', async () => {
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toMatch(/OPENAI_API_KEY/);
  });

  it('persistent 429 → retried then surfaced as isError with status', async () => {
    // Spec (CC3/B5): a 429 is retryable. A fetch that always 429s exhausts the
    // ladder and surfaces isError:true with the final status + a retryCount.
    process.env.OPENAI_API_KEY = 'test-key';
    _internal.fetch = makeFetchError(429, 'rate limited');
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.raw.status).toBe(429);
    expect(r.retryCount).toBeGreaterThan(0);
    expect(_internal.sleep).toHaveBeenCalled();
  });
});

// ─── runJudge — moonshot lineage ─────────────────────────────────────────────

describe('runJudge — moonshot', () => {
  let origFetch;
  beforeEach(() => { origFetch = _internal.fetch; });
  afterEach(() => {
    _internal.fetch = origFetch;
    delete process.env.MOONSHOT_API_KEY;
  });

  it('routes to moonshot endpoint and parses choices', async () => {
    process.env.MOONSHOT_API_KEY = 'test-moonshot-key';
    _internal.fetch = makeFetch({
      choices: [{ message: { content: 'kimi reply' } }],
    });
    const r = await runJudge({
      lineage: 'moonshot', model: 'kimi-k2.6',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('kimi reply');
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.moonshot.ai/v1/chat/completions',
      expect.anything(),
    );
  });

  it('errors when MOONSHOT_API_KEY is not set', async () => {
    const r = await runJudge({
      lineage: 'moonshot', model: 'kimi-k2.6',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toMatch(/MOONSHOT_API_KEY/);
  });
});

// ─── runJudge — minimax lineage ──────────────────────────────────────────────

describe('runJudge — minimax', () => {
  let origFetch;
  beforeEach(() => { origFetch = _internal.fetch; });
  afterEach(() => {
    _internal.fetch = origFetch;
    delete process.env.MINIMAX_API_KEY;
  });

  it('routes to MiniMax non-standard path and parses choices', async () => {
    process.env.MINIMAX_API_KEY = 'test-minimax-key';
    _internal.fetch = makeFetch({
      choices: [{ message: { content: 'minimax reply' } }],
    });
    const r = await runJudge({
      lineage: 'minimax', model: 'abab6.5s-chat',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('minimax reply');
    // MiniMax uses /text/chatcompletion_v2, NOT /chat/completions
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/text/chatcompletion_v2',
      expect.anything(),
    );
  });

  it('errors when MINIMAX_API_KEY is not set', async () => {
    const r = await runJudge({
      lineage: 'minimax', model: 'abab6.5s-chat',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toMatch(/MINIMAX_API_KEY/);
  });
});

// ─── runJudge — mimo lineage ─────────────────────────────────────────────────

describe('runJudge — mimo', () => {
  let origFetch;
  beforeEach(() => { origFetch = _internal.fetch; });
  afterEach(() => {
    _internal.fetch = origFetch;
    delete process.env.MIMO_API_KEY;
    delete process.env.TOGETHER_API_KEY;
  });

  it('uses MIMO_API_KEY direct endpoint when set', async () => {
    process.env.MIMO_API_KEY = 'test-mimo-key';
    _internal.fetch = makeFetch({
      choices: [{ message: { content: 'mimo reply' } }],
    });
    const r = await runJudge({
      lineage: 'mimo', model: 'MiMo-V2.5-Pro',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('mimo reply');
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.mimo.ai/v1/chat/completions',
      expect.anything(),
    );
  });

  it('falls back to Together.AI when only TOGETHER_API_KEY is set', async () => {
    process.env.TOGETHER_API_KEY = 'test-together-key';
    _internal.fetch = makeFetch({
      choices: [{ message: { content: 'together-mimo reply' } }],
    });
    const r = await runJudge({
      lineage: 'mimo', model: 'xiaomi/MiMo-7B-RL-v2.5',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.together.xyz/v1/chat/completions',
      expect.anything(),
    );
  });

  it('MIMO_API_KEY takes precedence over TOGETHER_API_KEY', async () => {
    process.env.MIMO_API_KEY = 'mimo-key';
    process.env.TOGETHER_API_KEY = 'together-key';
    _internal.fetch = makeFetch({ choices: [{ message: { content: 'ok' } }] });
    await runJudge({ lineage: 'mimo', model: 'x', systemPrompt: '', userPrompt: 'u' });
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.mimo.ai/v1/chat/completions',
      expect.anything(),
    );
  });

  it('errors when neither MIMO_API_KEY nor TOGETHER_API_KEY is set', async () => {
    const r = await runJudge({
      lineage: 'mimo', model: 'MiMo-V2.5-Pro',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toMatch(/MIMO_API_KEY/);
  });
});

// ─── runJudge — qwen / dashscope lineages ────────────────────────────────────

describe('runJudge — qwen/dashscope', () => {
  let origFetch;
  beforeEach(() => { origFetch = _internal.fetch; });
  afterEach(() => {
    _internal.fetch = origFetch;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.TOGETHER_API_KEY;
  });

  it('qwen lineage uses DASHSCOPE_API_KEY endpoint', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-dashscope-key';
    _internal.fetch = makeFetch({
      choices: [{ message: { content: 'qwen reply' } }],
    });
    const r = await runJudge({
      lineage: 'qwen', model: 'qwen3.6-plus',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('qwen reply');
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      expect.anything(),
    );
  });

  it('dashscope lineage is an alias for qwen runner', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    _internal.fetch = makeFetch({
      choices: [{ message: { content: 'dashscope reply' } }],
    });
    const r = await runJudge({
      lineage: 'dashscope', model: 'qwen3.6-plus',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('dashscope reply');
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      expect.anything(),
    );
  });

  it('falls back to Together.AI when only TOGETHER_API_KEY is set', async () => {
    process.env.TOGETHER_API_KEY = 'test-together-key';
    _internal.fetch = makeFetch({
      choices: [{ message: { content: 'together-qwen reply' } }],
    });
    const r = await runJudge({
      lineage: 'qwen', model: 'Qwen/Qwen2.5-72B-Instruct',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(_internal.fetch).toHaveBeenCalledWith(
      'https://api.together.xyz/v1/chat/completions',
      expect.anything(),
    );
  });

  it('errors when neither DASHSCOPE_API_KEY nor TOGETHER_API_KEY is set', async () => {
    const r = await runJudge({
      lineage: 'qwen', model: 'qwen3.6-plus',
      systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toMatch(/DASHSCOPE_API_KEY/);
  });
});

// ─── retry helpers — sequenced-fetch fixtures ────────────────────────────────

/**
 * Build a fetch mock that returns each entry of `responses` on successive
 * calls (clamping to the last entry once exhausted). Each entry is one of:
 *   { ok:true,  json }                  — a 2xx with a JSON body
 *   { ok:false, status[, retryAfter] }  — a non-2xx, optional Retry-After header
 */
function makeSequencedFetch(responses) {
  let i = 0;
  return vi.fn(async () => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i++;
    if (spec.ok) {
      return { ok: true, json: async () => spec.json };
    }
    return {
      ok: false,
      status: spec.status,
      text: async () => spec.body ?? 'err',
      headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? (spec.retryAfter ?? null) : null) },
    };
  });
}

// ─── classifyResponseStatus (pure) ───────────────────────────────────────────

describe('classifyResponseStatus', () => {
  it('2xx → ok', () => {
    expect(classifyResponseStatus(200)).toBe('ok');
    expect(classifyResponseStatus(204)).toBe('ok');
  });
  it('429 → retry-rate-limit', () => {
    expect(classifyResponseStatus(429)).toBe('retry-rate-limit');
  });
  it('5xx → retry-server', () => {
    expect(classifyResponseStatus(500)).toBe('retry-server');
    expect(classifyResponseStatus(503)).toBe('retry-server');
  });
  it('4xx (non-429) → fatal', () => {
    expect(classifyResponseStatus(400)).toBe('fatal');
    expect(classifyResponseStatus(401)).toBe('fatal');
    expect(classifyResponseStatus(404)).toBe('fatal');
  });
});

// ─── B5 — shared retry/backoff wrapper (CC3) ─────────────────────────────────

describe('runJudge retry wrapper (B5/CC3)', () => {
  let origFetch;
  let origSleep;
  let sleepSpy;
  beforeEach(() => {
    origFetch = _internal.fetch;
    origSleep = _internal.sleep;
    sleepSpy = vi.fn(async () => {});
    _internal.sleep = sleepSpy;     // injectable: no real waiting
    process.env.OPENAI_API_KEY = 'test-key';
  });
  afterEach(() => {
    _internal.fetch = origFetch;
    _internal.sleep = origSleep;
    delete process.env.OPENAI_API_KEY;
  });

  it('429-then-200 → retries and returns the eventual 200 with isError:false', async () => {
    _internal.fetch = makeSequencedFetch([
      { ok: false, status: 429 },
      { ok: true, json: { choices: [{ message: { content: 'recovered reply' } }] } },
    ]);
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('recovered reply');
    expect(r.retryCount).toBe(1);
    expect(r.raw.retryCount).toBe(1);
    expect(_internal.fetch).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1); // backoff sleep happened
  });

  it('429 honors Retry-After header for the backoff delay', async () => {
    _internal.fetch = makeSequencedFetch([
      { ok: false, status: 429, retryAfter: '3' }, // 3 seconds
      { ok: true, json: { choices: [{ message: { content: 'ok' } }] } },
    ]);
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(sleepSpy).toHaveBeenCalledWith(3000); // Retry-After: 3s → 3000ms
  });

  it('4xx (400) → fatal, no retry', async () => {
    _internal.fetch = makeSequencedFetch([
      { ok: false, status: 400 },
      { ok: true, json: { choices: [{ message: { content: 'should not reach' } }] } },
    ]);
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.raw.status).toBe(400);
    expect(r.retryCount).toBe(0);
    expect(_internal.fetch).toHaveBeenCalledTimes(1); // no retry
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it('5xx → retried once then succeeds', async () => {
    _internal.fetch = makeSequencedFetch([
      { ok: false, status: 503 },
      { ok: true, json: { choices: [{ message: { content: 'after-5xx' } }] } },
    ]);
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('after-5xx');
    expect(r.retryCount).toBe(1);
    expect(_internal.fetch).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  it('5xx → retried only ONCE (persistent 5xx surfaces as error)', async () => {
    _internal.fetch = makeSequencedFetch([{ ok: false, status: 500 }]); // always 500
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.raw.status).toBe(500);
    expect(r.retryCount).toBe(1);             // exactly one server retry
    expect(_internal.fetch).toHaveBeenCalledTimes(2); // original + 1 retry
  });
});

// ─── M6 — empty-text-200 detection + retry ───────────────────────────────────

describe('empty-text-200 (M6)', () => {
  let origFetch;
  let origSleep;
  beforeEach(() => {
    origFetch = _internal.fetch;
    origSleep = _internal.sleep;
    _internal.sleep = vi.fn(async () => {});
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
  });
  afterEach(() => {
    _internal.fetch = origFetch;
    _internal.sleep = origSleep;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it('a 200 with empty content is classified isError:true error:empty-text-200 and retried', async () => {
    // First 200 carries empty content (reasoning-only); second 200 has text.
    _internal.fetch = makeSequencedFetch([
      { ok: true, json: { choices: [{ message: { content: '   ' } }] } }, // whitespace-only
      { ok: true, json: { choices: [{ message: { content: 'real verdict' } }] } },
    ]);
    const r = await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('real verdict');
    expect(r.retryCount).toBe(1);
    expect(_internal.fetch).toHaveBeenCalledTimes(2);
  });

  it('persistent empty-text-200 surfaces error:empty-text-200 (DeepSeek path)', async () => {
    _internal.fetch = makeSequencedFetch([
      { ok: true, json: { choices: [{ message: { content: '' } }] } }, // always empty
    ]);
    const r = await runJudge({
      lineage: 'deepseek-api', model: 'deepseek-v4-flash', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(true);
    expect(r.error).toBe('empty-text-200');
    expect(r.retryCount).toBeGreaterThan(0); // it tried to recover
  });

  it('empty-text-200 detected on the Anthropic path', async () => {
    _internal.fetch = makeSequencedFetch([
      { ok: true, json: { content: [{ type: 'thinking', thinking: 'cot only' }] } }, // no text block
      { ok: true, json: { content: [{ type: 'text', text: 'final' }] } },
    ]);
    const r = await runJudge({
      lineage: 'anthropic-api', model: 'claude-sonnet-4-6', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('final');
    expect(r.retryCount).toBe(1);
  });

  it('empty-text-200 detected on the Gemini path', async () => {
    _internal.fetch = makeSequencedFetch([
      { ok: true, json: { candidates: [{ content: { parts: [{ text: '' }] } }] } }, // empty
      { ok: true, json: { candidates: [{ content: { parts: [{ text: 'gemini final' }] } }] } },
    ]);
    const r = await runJudge({
      lineage: 'google-api', model: 'gemini-3.1-flash-lite', systemPrompt: '', userPrompt: 'u',
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('gemini final');
    expect(r.retryCount).toBe(1);
  });
});

// ─── M7 — reasoning payload (max_completion_tokens + temperature:1) ───────────

describe('buildOpenAIReasoningPayload (M7)', () => {
  it('emits max_completion_tokens (NOT max_tokens) + temperature:1', () => {
    const p = buildOpenAIReasoningPayload({
      model: 'gpt-5.5', systemPrompt: 'sys', userPrompt: 'usr', maxCompletionTokens: 8000,
    });
    expect(p.max_completion_tokens).toBe(8000);
    expect('max_tokens' in p).toBe(false);
    expect(p.temperature).toBe(1);
    expect(p.stream).toBe(false);
    expect(p.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('defaults max_completion_tokens to 4096', () => {
    const p = buildOpenAIReasoningPayload({ userPrompt: 'u' });
    expect(p.max_completion_tokens).toBe(4096);
    expect('max_tokens' in p).toBe(false);
  });

  it('buildOpenAIPayload remains unchanged (max_tokens + temperature:0)', () => {
    const p = buildOpenAIPayload({ userPrompt: 'u' });
    expect(p.max_tokens).toBe(4096);
    expect(p.temperature).toBe(0);
    expect('max_completion_tokens' in p).toBe(false);
  });
});

describe('runOpenAIDirect reasoning vs non-reasoning wire shape (M7)', () => {
  let origFetch;
  let origSleep;
  beforeEach(() => {
    origFetch = _internal.fetch;
    origSleep = _internal.sleep;
    _internal.sleep = vi.fn(async () => {});
    process.env.OPENAI_API_KEY = 'test-key';
  });
  afterEach(() => {
    _internal.fetch = origFetch;
    _internal.sleep = origSleep;
    delete process.env.OPENAI_API_KEY;
  });

  it('useCompletionTokens:true → body has max_completion_tokens + temperature:1, no max_tokens', async () => {
    _internal.fetch = makeFetch({ choices: [{ message: { content: 'ok' } }] });
    await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5-reasoning',
      systemPrompt: 'sys', userPrompt: 'usr',
      useCompletionTokens: true, maxTokens: 8000,
    });
    const body = JSON.parse(_internal.fetch.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(8000);
    expect('max_tokens' in body).toBe(false);
    expect(body.temperature).toBe(1);
  });

  it('without useCompletionTokens → body has max_tokens + temperature:0 (unchanged)', async () => {
    _internal.fetch = makeFetch({ choices: [{ message: { content: 'ok' } }] });
    await runJudge({
      lineage: 'openai-api', model: 'gpt-5.5',
      systemPrompt: 'sys', userPrompt: 'usr',
    });
    const body = JSON.parse(_internal.fetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0);
    expect('max_completion_tokens' in body).toBe(false);
  });
});
