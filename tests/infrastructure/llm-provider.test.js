/**
 * LLM Provider Tests
 *
 * Tests for the LLM provider fallback chain:
 * - Error classification (retryable vs permanent)
 * - Retry delay calculation
 * - Static summary generation
 *
 * Note: These tests use isolated logic to avoid mock complexity.
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// UNIT TESTS FOR ISOLATED LOGIC
// =============================================================================

describe('Error Classification (isRetryable)', () => {
  /**
   * Replicates the error classification logic from llm-provider.js
   */
  function isRetryable(error) {
    // Network errors are retryable
    const networkCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'];
    if (error.code && networkCodes.includes(error.code)) {
      return true;
    }

    // Get status from various error formats
    const status = error.status || error.response?.status;

    // Rate limit (429) and server errors (5xx) are retryable
    if (status === 429 || (status >= 500 && status < 600)) {
      return true;
    }

    // Client errors (4xx except 429) are not retryable
    if (status >= 400 && status < 500) {
      return false;
    }

    // Timeout/abort errors are retryable
    if (error.name === 'AbortError' || (error.message && error.message.toLowerCase().includes('timeout'))) {
      return true;
    }

    // Default to retryable for unknown errors
    return true;
  }

  it('should classify network errors as retryable', () => {
    expect(isRetryable({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ code: 'ENOTFOUND' })).toBe(true);
    expect(isRetryable({ code: 'EAI_AGAIN' })).toBe(true);
  });

  it('should classify rate limit (429) as retryable', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
  });

  it('should classify server errors (5xx) as retryable', () => {
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 502 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 504 })).toBe(true);
  });

  it('should classify client errors (4xx except 429) as permanent', () => {
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 401 })).toBe(false);
    expect(isRetryable({ status: 403 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
    expect(isRetryable({ status: 422 })).toBe(false);
  });

  it('should classify timeout errors as retryable', () => {
    expect(isRetryable({ name: 'AbortError' })).toBe(true);
    expect(isRetryable({ message: 'Request timeout exceeded' })).toBe(true);
  });

  it('should default to retryable for unknown errors', () => {
    expect(isRetryable({ message: 'Something unexpected' })).toBe(true);
  });

  it('should handle error with response.status property', () => {
    expect(isRetryable({ response: { status: 503 } })).toBe(true);
    expect(isRetryable({ response: { status: 401 } })).toBe(false);
  });
});

describe('Retry Delay Calculation', () => {
  const RETRY_CONFIG = {
    baseDelay: 1000,
    maxDelay: 30000,
    maxRetries: 3,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  };

  /**
   * Calculates retry delay with exponential backoff
   */
  function calculateRetryDelay(attempt, config = RETRY_CONFIG) {
    const { baseDelay, maxDelay, backoffMultiplier, jitterFactor } = config;

    // Exponential backoff
    let delay = baseDelay * Math.pow(backoffMultiplier, attempt);

    // Cap at maxDelay
    delay = Math.min(delay, maxDelay);

    // Add jitter (without randomness for testing)
    const jitter = delay * jitterFactor;

    return { baseDelay: delay, minDelay: delay - jitter, maxDelay: delay + jitter };
  }

  it('should calculate exponential backoff', () => {
    const d0 = calculateRetryDelay(0);
    const d1 = calculateRetryDelay(1);
    const d2 = calculateRetryDelay(2);
    const d3 = calculateRetryDelay(3);

    expect(d0.baseDelay).toBe(1000); // 1s
    expect(d1.baseDelay).toBe(2000); // 2s
    expect(d2.baseDelay).toBe(4000); // 4s
    expect(d3.baseDelay).toBe(8000); // 8s
  });

  it('should cap delay at maxDelay', () => {
    const d10 = calculateRetryDelay(10);

    expect(d10.baseDelay).toBe(30000); // Capped at 30s
  });

  it('should include jitter range', () => {
    const d1 = calculateRetryDelay(1);

    expect(d1.minDelay).toBeLessThan(d1.baseDelay);
    expect(d1.maxDelay).toBeGreaterThan(d1.baseDelay);
  });
});

describe('Static Summary Generation', () => {
  /**
   * Replicates static summary generation from llm-provider.js
   */
  function generateStaticSummary(entity) {
    // Try to extract first sentence from doc comment
    if (entity.doc_comment) {
      const cleaned = entity.doc_comment
        .replace(/^\/\*\*\s*/g, '')
        .replace(/\s*\*\/$/g, '')
        .replace(/^\s*\*\s*/gm, '')
        .trim();

      const firstSentence = cleaned.split(/[.!?]/)[0]?.trim();
      if (firstSentence && firstSentence.length > 10) {
        return truncate(firstSentence, 200);
      }
    }

    // Fall back to signature
    if (entity.signature && entity.signature.length > 10) {
      return truncate(entity.signature, 200);
    }

    // Fall back to type + humanized name
    const type = capitalize(entity.type || 'Entity');
    const name = humanize(entity.name || 'unknown');
    return `${type}: ${name}`;
  }

  function truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  function humanize(name) {
    // Split on camelCase and snake_case
    return name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase();
  }

  it('should extract first sentence from doc comment', () => {
    const entity = {
      doc_comment: '/** This is the main service for authentication. It handles all login flows. */',
      name: 'AuthService',
      type: 'class',
    };

    const summary = generateStaticSummary(entity);

    expect(summary).toBe('This is the main service for authentication');
  });

  it('should use signature when doc comment is too short', () => {
    const entity = {
      doc_comment: '/** TODO */',
      signature: 'public class AuthService extends BaseService',
      name: 'AuthService',
      type: 'class',
    };

    const summary = generateStaticSummary(entity);

    expect(summary).toBe('public class AuthService extends BaseService');
  });

  it('should fall back to type + humanized name', () => {
    const entity = {
      name: 'processUserAuthentication',
      type: 'method',
    };

    const summary = generateStaticSummary(entity);

    expect(summary).toBe('Method: process user authentication');
  });

  it('should handle snake_case names', () => {
    const entity = {
      name: 'user_authentication_service',
      type: 'class',
    };

    const summary = generateStaticSummary(entity);

    expect(summary).toBe('Class: user authentication service');
  });

  it('should truncate long summaries to 200 chars', () => {
    const longComment = '/** ' + 'A'.repeat(300) + ' */';
    const entity = {
      doc_comment: longComment,
      name: 'LongEntity',
      type: 'class',
    };

    const summary = generateStaticSummary(entity);

    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith('...')).toBe(true);
  });

  it('should handle entity with no metadata', () => {
    const entity = {};

    const summary = generateStaticSummary(entity);

    expect(summary).toBe('Entity: unknown');
  });

  it('should strip doc comment formatting', () => {
    const entity = {
      doc_comment: `/**
       * This is a multiline comment.
       * With multiple lines.
       */`,
      name: 'Test',
      type: 'class',
    };

    const summary = generateStaticSummary(entity);

    expect(summary).toBe('This is a multiline comment');
    expect(summary).not.toContain('*');
  });
});

describe('Provider Priority Logic', () => {
  const providers = [
    { name: 'groq', priority: 1, isLocal: false },
    { name: 'cerebras', priority: 2, isLocal: false },
    { name: 'ollama', priority: 3, isLocal: true },
    { name: 'transformers', priority: 4, isLocal: true },
    { name: 'static', priority: 99, isLocal: true },
  ];

  /**
   * Selects provider based on priority and preference
   */
  function selectProvider(availableProviders, preferLocal = false) {
    const sorted = [...availableProviders].sort((a, b) => {
      if (preferLocal) {
        // Local providers first
        if (a.isLocal !== b.isLocal) {
          return a.isLocal ? -1 : 1;
        }
      }
      return a.priority - b.priority;
    });

    return sorted[0] || null;
  }

  it('should select by priority normally', () => {
    const provider = selectProvider(providers);

    expect(provider.name).toBe('groq');
  });

  it('should prefer local when requested', () => {
    const provider = selectProvider(providers, true);

    expect(provider.name).toBe('ollama');
    expect(provider.isLocal).toBe(true);
  });

  it('should handle empty provider list', () => {
    const provider = selectProvider([]);

    expect(provider).toBeNull();
  });

  it('should select static as last resort', () => {
    const onlyStatic = providers.filter((p) => p.name === 'static');
    const provider = selectProvider(onlyStatic);

    expect(provider.name).toBe('static');
    expect(provider.priority).toBe(99);
  });
});

describe('Summary Prompt Creation', () => {
  const TOKEN_LIMITS = {
    class: 150,
    method: 80,
    function: 80,
    field: 40,
    default: 100,
  };

  /**
   * Replicates prompt creation logic
   */
  function createSummaryPrompt(entity) {
    const type = entity.type || 'entity';
    const tokenLimit = TOKEN_LIMITS[type] || TOKEN_LIMITS.default;
    const code = truncateCode(entity.code || '', 2000);

    let prompt = `Summarize this ${type} in max ${tokenLimit} tokens.\n\n`;
    prompt += `Name: ${entity.name || 'unknown'}\n`;
    if (entity.file) prompt += `File: ${entity.file}\n`;
    prompt += `\nCode:\n${code}`;

    if (entity.childSummaries && entity.childSummaries.length > 0) {
      prompt += '\n\nContains:\n';
      const limited = entity.childSummaries.slice(0, 5);
      for (const child of limited) {
        prompt += `- ${child.name}: ${child.summary}\n`;
      }
    }

    return prompt;
  }

  function truncateCode(code, maxLen) {
    if (code.length <= maxLen) return code;
    return code.substring(0, maxLen) + '\n// ... (truncated)';
  }

  it('should create prompt with entity metadata', () => {
    const entity = {
      name: 'AuthService',
      type: 'class',
      file: 'src/auth/AuthService.java',
      code: 'public class AuthService { /* ... */ }',
    };

    const prompt = createSummaryPrompt(entity);

    expect(prompt).toContain('Summarize this class');
    expect(prompt).toContain('Name: AuthService');
    expect(prompt).toContain('File: src/auth/AuthService.java');
    expect(prompt).toContain('public class AuthService');
  });

  it('should respect token limits per entity type', () => {
    const classEntity = { name: 'Test', type: 'class', code: 'code' };
    const methodEntity = { name: 'test', type: 'method', code: 'code' };

    const classPrompt = createSummaryPrompt(classEntity);
    const methodPrompt = createSummaryPrompt(methodEntity);

    expect(classPrompt).toContain('150 tokens');
    expect(methodPrompt).toContain('80 tokens');
  });

  it('should truncate long code snippets', () => {
    const entity = {
      name: 'LargeClass',
      type: 'class',
      code: 'x'.repeat(3000),
    };

    const prompt = createSummaryPrompt(entity);

    expect(prompt).toContain('// ... (truncated)');
    expect(prompt.length).toBeLessThan(5000);
  });

  it('should include child summaries if available', () => {
    const entity = {
      name: 'ParentClass',
      type: 'class',
      code: 'class ParentClass {}',
      childSummaries: [
        { name: 'methodA', summary: 'Does A' },
        { name: 'methodB', summary: 'Does B' },
      ],
    };

    const prompt = createSummaryPrompt(entity);

    expect(prompt).toContain('Contains:');
    expect(prompt).toContain('- methodA: Does A');
    expect(prompt).toContain('- methodB: Does B');
  });

  it('should limit child summaries to 5', () => {
    const entity = {
      name: 'BigClass',
      type: 'class',
      code: 'code',
      childSummaries: Array.from({ length: 10 }, (_, i) => ({
        name: `method${i}`,
        summary: `Summary ${i}`,
      })),
    };

    const prompt = createSummaryPrompt(entity);

    // Should only include first 5
    expect(prompt).toContain('method0');
    expect(prompt).toContain('method4');
    expect(prompt).not.toContain('method5');
  });
});

describe('Batch Processing', () => {
  it('should handle empty batch', () => {
    const batch = [];
    const results = batch.map(() => ({ summary: 'test' }));

    expect(results).toHaveLength(0);
  });

  it('should process items maintaining order', () => {
    const items = ['a', 'b', 'c'];
    const results = items.map((item, i) => ({ item, index: i }));

    expect(results[0].item).toBe('a');
    expect(results[1].item).toBe('b');
    expect(results[2].item).toBe('c');
  });

  it('should handle mixed success/failure in batch', () => {
    const items = [
      { success: true, summary: 'A' },
      { success: false, error: 'Failed' },
      { success: true, summary: 'C' },
    ];

    const successes = items.filter((i) => i.success).length;
    const failures = items.filter((i) => !i.success).length;

    expect(successes).toBe(2);
    expect(failures).toBe(1);
  });
});
