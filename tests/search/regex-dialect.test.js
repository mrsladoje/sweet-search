import { describe, expect, it, vi } from 'vitest';

import {
  detectBreDialectHint,
  renderRegexDialectHint,
  retryBreDialectAfterZero,
  translateBreToRustRegex,
} from '../../core/search/regex-dialect.js';

describe('agent regex-dialect translation', () => {
  it('translates unambiguous GNU BRE operators to Rust regex syntax', () => {
    expect(translateBreToRustRegex(String.raw`I64Vec\|U64Vec`)).toEqual({
      pattern: 'I64Vec|U64Vec', operators: ['\\|'],
    });
    expect(translateBreToRustRegex(String.raw`\(item\)\+`)).toEqual({
      pattern: '(item)+', operators: ['\\(', '\\)', '\\+'],
    });
    expect(translateBreToRustRegex(String.raw`item\{2,4\}`)).toEqual({
      pattern: 'item{2,4}', operators: ['\\{m,n\\}'],
    });
    expect(translateBreToRustRegex(String.raw`func \(.*\) Reset\|writeFileFooter`)).toEqual({
      pattern: 'func (.*) Reset|writeFileFooter', operators: ['\\(', '\\)', '\\|'],
    });
  });

  it('rejects empty or zero-width alternation arms and mixed BRE/Rust operator spellings', () => {
    for (const pattern of [
      String.raw`Vec\|`,
      String.raw`\|Vec`,
      String.raw`cell\|$`,
      String.raw`foo\|.*`,
      String.raw`a\|b*`,
      String.raw`^\|cell`,
      String.raw`\(left\|\)`,
      String.raw`\(\|right\)`,
      String.raw`free(ptr)\|g_free(ptr)`,
      String.raw`x+\|y+`,
      String.raw`left|middle\|right`,
      String.raw`foo\(bar\)\?`,
    ]) {
      expect(translateBreToRustRegex(pattern), pattern).toBeNull();
    }
  });

  it('detects BRE spellings without changing the first-search hint', () => {
    const hint = detectBreDialectHint(String.raw`I64Vec\|U64Vec`);
    expect(hint).toEqual({ operators: ['\\|'] });
    expect(renderRegexDialectHint(hint)).toContain('original pattern was used unchanged');
  });

  it('ignores intentional literal pipes, character classes, and fixed strings', () => {
    expect(detectBreDialectHint(String.raw`left\|\|right`)).toBeNull();
    expect(detectBreDialectHint(String.raw`[\|]`)).toBeNull();
    expect(detectBreDialectHint(String.raw`left\\|right`)).toBeNull();
    expect(detectBreDialectHint(String.raw`\x7C`)).toBeNull();
    expect(detectBreDialectHint(String.raw`left\|right`, { fixedString: true })).toBeNull();
    expect(translateBreToRustRegex(String.raw`left\|\|right`)).toBeNull();
    expect(translateBreToRustRegex(String.raw`[\|]`)).toBeNull();
    expect(translateBreToRustRegex(String.raw`left\\|right`)).toBeNull();
    expect(translateBreToRustRegex(String.raw`left\|right`, { fixedString: true })).toBeNull();
  });

  it('re-scans character classes after even backslash runs', () => {
    expect(detectBreDialectHint(String.raw`\[left\|right`)).toEqual({ operators: ['\\|'] });
    expect(detectBreDialectHint(String.raw`[\]]left\|right`)).toEqual({ operators: ['\\|'] });
    expect(detectBreDialectHint(String.raw`\\[abc\|x]`)).toBeNull();
    expect(translateBreToRustRegex(String.raw`\\[abc\|x]`)).toBeNull();
  });

  it('recognizes only valid escaped interval shapes', () => {
    expect(detectBreDialectHint(String.raw`item\{2,4\}`)).toEqual({ operators: ['\\{m,n\\}'] });
    expect(detectBreDialectHint(String.raw`item\{many\}`)).toBeNull();
    expect(detectBreDialectHint(String.raw`(item)\1`)).toBeNull();
  });
});

describe('agent regex-dialect retry orchestration', () => {
  it('does not retry when an original match exists only in the overlay', async () => {
    const retry = vi.fn();
    const overlayMatch = { file: 'src/dirty.js', line: 1, content: 'foo|bar' };

    const result = await retryBreDialectAfterZero({
      pattern: String.raw`foo\|bar`,
      agentFormat: true,
      originalResult: {
        indexedMatches: [], overlayMatches: [overlayMatch], matchingFiles: [], stats: {},
      },
      retry,
    });

    expect(result.matches).toEqual([overlayMatch]);
    expect(result.regexDialectHint).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });

  it('falls back only for regex syntax errors and preserves other failures', async () => {
    const originalResult = {
      indexedMatches: [], overlayMatches: [], matchingFiles: [],
      stats: { candidateGenTime_ms: 2, grepTime_ms: 1 },
    };
    const syntaxFailure = vi.fn().mockRejectedValue(
      new Error('Invalid regex: repetition operator missing expression'),
    );

    const fallback = await retryBreDialectAfterZero({
      pattern: String.raw`\+foo`, agentFormat: true, originalResult, retry: syntaxFailure,
    });
    expect(fallback.candidateResult).toBe(originalResult);
    expect(fallback.regexDialectHint).toEqual({ operators: ['\\+'] });
    expect(syntaxFailure).toHaveBeenCalledOnce();

    await expect(retryBreDialectAfterZero({
      pattern: String.raw`foo\|bar`,
      agentFormat: true,
      originalResult,
      retry: vi.fn().mockRejectedValue(new Error('EIO: index unavailable')),
    })).rejects.toThrow('EIO: index unavailable');
  });

  it('merges original and retry timing instead of discarding retry work', async () => {
    const result = await retryBreDialectAfterZero({
      pattern: String.raw`foo\|bar`,
      agentFormat: true,
      originalResult: {
        indexedMatches: [], overlayMatches: [],
        stats: { candidateGenTime_ms: 2, grepTime_ms: 1, stageTiming: { grepVerifyTime_ms: 1 } },
      },
      retry: vi.fn(async () => ({
        indexedMatches: [{ file: 'src/a.js', line: 1 }], overlayMatches: [],
        stats: { candidateGenTime_ms: 3, grepTime_ms: 2, stageTiming: { grepVerifyTime_ms: 2 } },
      })),
    });

    expect(result.candidateResult.stats).toMatchObject({
      candidateGenTime_ms: 5,
      grepTime_ms: 3,
      stageTiming: { grepVerifyTime_ms: 3 },
    });
    expect(result.regexDialectHint.translatedPattern).toBe('foo|bar');
  });
});
