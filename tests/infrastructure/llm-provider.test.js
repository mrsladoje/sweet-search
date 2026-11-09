/**
 * LLM provider tests.
 *
 * These call the real exports of core/infrastructure/llm-provider.js:
 * error classification, retry behaviour, static summaries, prompt creation
 * and provider priority.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isRetryable,
  generateWithRetry,
  generateStaticSummary,
  createSummaryPrompt,
  providers,
  RETRY_CONFIG,
} from '../../core/infrastructure/llm-provider.js';
import { HCGS_CONFIG } from '../../core/infrastructure/config/index.js';

describe('isRetryable', () => {
  it('classifies network errors as retryable', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']) {
      expect(isRetryable({ code })).toBe(true);
    }
  });

  it('classifies rate limit (429) and server errors (5xx) as retryable', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryable({ status })).toBe(true);
    }
  });

  it('classifies client errors (4xx except 429) as permanent', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryable({ status })).toBe(false);
    }
  });

  it('classifies timeout and abort errors as retryable', () => {
    expect(isRetryable({ name: 'AbortError' })).toBe(true);
    expect(isRetryable({ message: 'Request timeout exceeded' })).toBe(true);
  });

  it('defaults to retryable for unknown errors', () => {
    expect(isRetryable({ message: 'Something unexpected' })).toBe(true);
  });

  it('reads the status from error.response.status and error.statusCode', () => {
    expect(isRetryable({ response: { status: 503 } })).toBe(true);
    expect(isRetryable({ response: { status: 401 } })).toBe(false);
    expect(isRetryable({ statusCode: 404 })).toBe(false);
  });
});

describe('generateWithRetry', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the first successful result without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(generateWithRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a permanent (4xx) error', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('bad key'), { status: 401 }));
    await expect(generateWithRetry(fn)).rejects.toThrow('bad key');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient error with exponential backoff, then succeeds', async () => {
    vi.useFakeTimers();
    const transient = () => Object.assign(new Error('busy'), { status: 503 });
    const fn = vi.fn()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValue('done');
    const result = generateWithRetry(fn);

    // First retry waits baseDelay +-jitter, the second about twice as long.
    const jitter = RETRY_CONFIG.jitterFactor;
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelay * (1 - jitter) - 1);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelay * 2 * jitter + 2);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelay * 2 * (1 + jitter));
    await expect(result).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after maxRetries retries', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('down'), { status: 500 }));
    const result = generateWithRetry(fn, { maxRetries: 2 });
    const settled = expect(result).rejects.toThrow('down');
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.maxDelay * 3);
    await settled;
    expect(fn).toHaveBeenCalledTimes(3); // first try + 2 retries
  });
});

describe('generateStaticSummary', () => {
  it('extracts the first sentence from a doc comment', () => {
    expect(generateStaticSummary({
      doc_comment: '/** This is the main service for authentication. It handles all login flows. */',
      name: 'AuthService',
      type: 'class',
    })).toBe('This is the main service for authentication');
  });

  it('uses the signature when the doc comment is too short', () => {
    expect(generateStaticSummary({
      doc_comment: '/** TODO */',
      signature: 'public class AuthService extends BaseService',
      name: 'AuthService',
      type: 'class',
    })).toBe('public class AuthService extends BaseService');
  });

  it('falls back to type plus humanized camelCase name', () => {
    expect(generateStaticSummary({ name: 'processUserAuthentication', type: 'method' }))
      .toBe('Method: process user authentication');
  });

  it('humanizes snake_case names', () => {
    expect(generateStaticSummary({ name: 'user_authentication_service', type: 'class' }))
      .toBe('Class: user authentication service');
  });

  it('truncates long summaries to 200 chars with an ellipsis', () => {
    const summary = generateStaticSummary({
      doc_comment: '/** ' + 'A'.repeat(300) + ' */',
      name: 'LongEntity',
      type: 'class',
    });
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith('...')).toBe(true);
  });

  it('handles an entity with no metadata', () => {
    expect(generateStaticSummary({})).toBe('Entity: unknown');
  });

  it('strips doc comment formatting', () => {
    const summary = generateStaticSummary({
      doc_comment: `/**
       * This is a multiline comment.
       * With multiple lines.
       */`,
      name: 'Test',
      type: 'class',
    });
    expect(summary).toBe('This is a multiline comment');
  });
});

describe('providers', () => {
  it('lists cloud providers before local ones and static as the last resort', () => {
    const ordered = Object.values(providers).sort((a, b) => a.priority - b.priority);
    expect(ordered[0].name).toBe('groq');
    expect(ordered[ordered.length - 1].name).toBe('static');
    expect(ordered[ordered.length - 1].isLocal).toBe(true);
  });

  it('static provider always reports available and summarizes entity metadata', async () => {
    expect(await providers.static.checkAvailable()).toBe(true);
    const entity = { name: 'user_service', type: 'class' };
    expect(await providers.static.generate('ignored prompt', { entity })).toBe('Class: user service');
    expect(await providers.static.generate('ignored prompt', {})).toBe('Code entity');
  });
});

describe('createSummaryPrompt', () => {
  it('includes entity metadata and code', () => {
    const prompt = createSummaryPrompt({
      name: 'AuthService',
      type: 'class',
      file: 'src/auth/AuthService.java',
      code: 'public class AuthService { /* ... */ }',
    });
    expect(prompt).toContain('Summarize this class');
    expect(prompt).toContain('Name: AuthService');
    expect(prompt).toContain('File: src/auth/AuthService.java');
    expect(prompt).toContain('public class AuthService');
  });

  it('asks for the configured token limit of each entity type', () => {
    const classPrompt = createSummaryPrompt({ name: 'Test', type: 'class', code: 'code' });
    const methodPrompt = createSummaryPrompt({ name: 'test', type: 'method', code: 'code' });
    expect(classPrompt).toContain(`${HCGS_CONFIG.summaryTokenLimits.class} tokens`);
    expect(methodPrompt).toContain(`${HCGS_CONFIG.summaryTokenLimits.method} tokens`);
    expect(HCGS_CONFIG.summaryTokenLimits.class).not.toBe(HCGS_CONFIG.summaryTokenLimits.method);
  });

  it('truncates long code snippets', () => {
    const prompt = createSummaryPrompt({ name: 'LargeClass', type: 'class', code: 'x'.repeat(3000) });
    expect(prompt).toContain('// ... (truncated)');
    expect(prompt).not.toContain('x'.repeat(2001));
  });

  it('includes child summaries', () => {
    const prompt = createSummaryPrompt({
      name: 'ParentClass',
      type: 'class',
      code: 'class ParentClass {}',
      childSummaries: [
        { name: 'methodA', summary: 'Does A' },
        { name: 'methodB', summary: 'Does B' },
      ],
    });
    expect(prompt).toContain('Contains:');
    expect(prompt).toContain('- methodA: Does A');
    expect(prompt).toContain('- methodB: Does B');
  });

  it('limits child summaries to 5', () => {
    const prompt = createSummaryPrompt({
      name: 'BigClass',
      type: 'class',
      code: 'code',
      childSummaries: Array.from({ length: 10 }, (_, i) => ({ name: `method${i}`, summary: `Summary ${i}` })),
    });
    expect(prompt).toContain('method0');
    expect(prompt).toContain('method4');
    expect(prompt).not.toContain('method5');
  });
});
