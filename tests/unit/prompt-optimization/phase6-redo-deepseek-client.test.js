/**
 * Unit tests for core/prompt-optimization/scripts/deepseek-client.mjs.
 *
 * fetch + sleep are dependency-injected so retries / backoff / rate-limit
 * cap are exercised hermetically (no real HTTP, no real timers).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildChatCompletionBody,
  classifyResponse,
  createDeepSeekClient,
  DEFAULT_MODEL,
  BACKOFF_LADDER_MS,
} from '../../../core/prompt-optimization/scripts/deepseek-client.mjs';

function makeJsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeTextResponse(status, text) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => { throw new Error('not json'); },
    text: async () => text,
  };
}

describe('buildChatCompletionBody', () => {
  it('builds the canonical PHASE6_REDO §5.5.4 body', () => {
    const body = buildChatCompletionBody({
      systemPrompt: 'sys',
      userPrompt: 'user',
    });
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.temperature).toBe(0.3);
    expect(body.seed).toBe(42);
    expect(body.max_tokens).toBe(4096);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ]);
  });

  it('omits the system role when no systemPrompt given', () => {
    const body = buildChatCompletionBody({ userPrompt: 'u' });
    expect(body.messages).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('throws when userPrompt is missing', () => {
    expect(() => buildChatCompletionBody({})).toThrow(/userPrompt is required/);
  });
});

describe('classifyResponse', () => {
  it('classifies 2xx as ok', () => {
    expect(classifyResponse(200).kind).toBe('ok');
    expect(classifyResponse(204).kind).toBe('ok');
  });
  it('classifies 429 as retry-rate-limit', () => {
    expect(classifyResponse(429).kind).toBe('retry-rate-limit');
  });
  it('classifies 5xx as retry-server', () => {
    expect(classifyResponse(500).kind).toBe('retry-server');
    expect(classifyResponse(503).kind).toBe('retry-server');
  });
  it('classifies 4xx (non-429) as fatal', () => {
    expect(classifyResponse(400).kind).toBe('fatal');
    expect(classifyResponse(401).kind).toBe('fatal');
    expect(classifyResponse(404).kind).toBe('fatal');
  });
});

describe('createDeepSeekClient — happy path', () => {
  it('returns parsed content from a single 200 response', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(200, {
        choices: [{ message: { content: '{"query":"ImportType","rationale":"short"}' } }],
      }),
    );
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const client = createDeepSeekClient({ apiKey: 'k', fetchFn, sleepFn });
    const result = await client.chat({ systemPrompt: 'sys', userPrompt: 'u' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
    expect(result.attempts).toBe(1);
    expect(result.content).toBe('{"query":"ImportType","rationale":"short"}');
  });

  it('throws on missing API key', () => {
    expect(() => createDeepSeekClient({ apiKey: '', fetchFn: () => {} }))
      .toThrow(/DEEPSEEK_API_KEY missing/);
  });
});

describe('createDeepSeekClient — 429 backoff', () => {
  it('retries with the documented exponential ladder and recovers', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(makeTextResponse(429, 'slow down'))
      .mockResolvedValueOnce(makeTextResponse(429, 'slow down'))
      .mockResolvedValueOnce(makeJsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
      }));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const client = createDeepSeekClient({ apiKey: 'k', fetchFn, sleepFn });
    const result = await client.chat({ userPrompt: 'u' });
    expect(result.content).toBe('ok');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    // First retry waited 1s, second waited 2s — the §5.5.4 ladder.
    expect(sleepFn.mock.calls.map((c) => c[0])).toEqual([BACKOFF_LADDER_MS[0], BACKOFF_LADDER_MS[1]]);
  });

  it('throws after the rate-limit cap is hit', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValue(makeTextResponse(429, 'slow down'));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const client = createDeepSeekClient({ apiKey: 'k', fetchFn, sleepFn, maxRateLimitRetries: 2 });
    await expect(client.chat({ userPrompt: 'u' })).rejects.toThrow(/rate-limit cap exhausted/);
    // initial attempt + 2 retries
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe('createDeepSeekClient — 5xx retry', () => {
  it('retries once on 5xx then succeeds', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(makeTextResponse(503, 'oops'))
      .mockResolvedValueOnce(makeJsonResponse(200, {
        choices: [{ message: { content: 'ok' } }],
      }));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const client = createDeepSeekClient({ apiKey: 'k', fetchFn, sleepFn });
    const result = await client.chat({ userPrompt: 'u' });
    expect(result.content).toBe('ok');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws after the single 5xx retry is exhausted', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeTextResponse(503, 'still down'));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const client = createDeepSeekClient({ apiKey: 'k', fetchFn, sleepFn });
    await expect(client.chat({ userPrompt: 'u' })).rejects.toThrow(/503/);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('createDeepSeekClient — fatal 4xx', () => {
  it('throws immediately on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeTextResponse(401, 'bad key'));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const client = createDeepSeekClient({ apiKey: 'k', fetchFn, sleepFn });
    await expect(client.chat({ userPrompt: 'u' })).rejects.toThrow(/401/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });
});

describe('preflightModels', () => {
  it('returns the model list when required ids are present', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse(200, { data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] }),
    );
    const client = createDeepSeekClient({ apiKey: 'k', fetchFn });
    const result = await client.preflightModels();
    expect(result.models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('throws when a required model is missing (§5.5.4 preflight)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse(200, { data: [{ id: 'deepseek-v4-pro' }] }),
    );
    const client = createDeepSeekClient({ apiKey: 'k', fetchFn });
    await expect(client.preflightModels()).rejects.toThrow(/deepseek-v4-flash.*not in \/models/);
  });
});
