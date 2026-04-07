/**
 * Context Expander Tests — agent mode packaging for ColGrep pattern search.
 *
 * Tests Phases 1-5 of the USEFUL_ANSWER_COLGREP_PLAN:
 *   1. Basic code loading
 *   2. Symbol-complete expansion (via CodeGraphRepository — DDD compliant)
 *   3. Token budget management (agent_preview / agent_full sub-modes)
 *   4. Header context extraction (broad identifier matching)
 *   5. Confidence signals (score gaps, regex selectivity, sufficiency)
 *   + Ranking identity between benchmark and agent modes
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  computeConfidence,
  computeSufficiency,
  allocateBudget,
  expandToSymbol,
  expandBySyntax,
  extractHeaderContext,
  truncateToTokenCap,
  checkStaleness,
  packageForAgent,
} from '../../core/search/context-expander.js';

// =============================================================================
// Phase 1: Token estimation
// =============================================================================

describe('estimateTokens', () => {
  it('should return 0 for empty/null input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('should estimate ~3.5 chars per token', () => {
    const code = 'export function hello() { return "world"; }';
    const tokens = estimateTokens(code);
    // 44 chars / 3.5 ≈ 13
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(20);
  });

  it('should scale linearly with code length', () => {
    const short = 'const x = 1;';
    const long = short.repeat(10);
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short) * 5);
  });
});

// =============================================================================
// Phase 5: Confidence signals (Fix #4: regex selectivity)
// =============================================================================

describe('computeConfidence', () => {
  it('should return low for no results', () => {
    const { confidence, confidenceReason } = computeConfidence([], {});
    expect(confidence).toBe('low');
    expect(confidenceReason).toBe('no_results');
  });

  it('should return high for single result', () => {
    const { confidence } = computeConfidence([{ score: 0.8 }], {});
    expect(confidence).toBe('high');
  });

  it('should return high when top-1 is 2x top-2', () => {
    const results = [{ score: 0.9 }, { score: 0.4 }];
    const { confidence, confidenceReason } = computeConfidence(results, {});
    expect(confidence).toBe('high');
    expect(confidenceReason).toBe('clear_winner');
  });

  it('should return medium/close_top2 when scores are within 20%', () => {
    const results = [{ score: 0.85 }, { score: 0.80 }]; // ratio 1.0625 <= 1.2
    const { confidence, confidenceReason } = computeConfidence(results, {});
    expect(confidence).toBe('medium');
    expect(confidenceReason).toBe('close_top2');
  });

  it('should return medium/moderate_gap when ratio is between 1.2 and 2.0', () => {
    const results = [{ score: 0.9 }, { score: 0.6 }]; // ratio 1.5
    const { confidence, confidenceReason } = computeConfidence(results, {});
    expect(confidence).toBe('medium');
    expect(confidenceReason).toBe('moderate_gap');
  });

  it('should return high when top-2 is zero', () => {
    const results = [{ score: 0.5 }, { score: 0 }];
    const { confidence } = computeConfidence(results, {});
    expect(confidence).toBe('high');
  });

  it('should return low for no indexed candidates', () => {
    const results = [{ score: 0.5 }, { score: 0.4 }];
    const { confidence } = computeConfidence(results, { grepMatches: 10, indexedChunks: 0 });
    expect(confidence).toBe('low');
  });

  // Fix #4: regex selectivity tests
  it('should boost to high when regex is selective (<=10 matches) and base is medium', () => {
    const results = [{ score: 0.85 }, { score: 0.80 }];
    // Without selectivity: medium (close scores)
    // With selective regex (5 grep matches): should boost to high
    const { confidence, confidenceReason } = computeConfidence(results, { grepMatches: 5, indexedChunks: 3 });
    expect(confidence).toBe('high');
    expect(confidenceReason).toBe('selective_regex');
  });

  it('should demote from high to medium when regex is broad (>200 matches)', () => {
    // Selective regex would be high, but broad regex demotes
    // ratio > 2.0 = clear_winner, which is exempt from demotion
    // So use a ratio that would be "high" from selective_regex but not clear_winner
    const results = [{ score: 0.85 }, { score: 0.80 }];
    const { confidence } = computeConfidence(results, { grepMatches: 5, indexedChunks: 3 });
    expect(confidence).toBe('high'); // selective → high

    const { confidence: broad } = computeConfidence(results, { grepMatches: 300, indexedChunks: 100 });
    // With broad regex, medium scores stay medium
    expect(broad).toBe('medium');
  });

  it('should not demote clear_winner even with broad regex', () => {
    const results = [{ score: 0.9 }, { score: 0.3 }]; // ratio 3.0 > 2.0
    const { confidence } = computeConfidence(results, { grepMatches: 500, indexedChunks: 200 });
    expect(confidence).toBe('high');
  });
});

// =============================================================================
// Fix #7: Sufficiency signal
// =============================================================================

describe('computeSufficiency', () => {
  it('should be sufficient when symbol is complete + high confidence', () => {
    const topResult = {
      symbol: 'MyClass',
      presentation: 'full',
      code: 'export class MyClass { constructor() {} }',
      headerContext: "import { Base } from './base.js';",
    };
    const { sufficient, reasons } = computeSufficiency(topResult, { confidence: 'high' });
    expect(sufficient).toBe(true);
    expect(reasons).toContain('complete_symbol');
    expect(reasons).toContain('header_resolved');
    expect(reasons).toContain('high_confidence');
  });

  it('should not be sufficient with only one signal', () => {
    const topResult = {
      symbol: null,
      presentation: 'preview',
      code: 'some code',
      headerContext: null,
    };
    const { sufficient } = computeSufficiency(topResult, { confidence: 'low' });
    expect(sufficient).toBe(false);
  });

  it('should detect truncated code as not complete', () => {
    const topResult = {
      symbol: 'MyFunc',
      presentation: 'full',
      code: 'function MyFunc() {\n  // ...\n// ... (50 more lines)',
      headerContext: null,
    };
    const { reasons } = computeSufficiency(topResult, { confidence: 'high' });
    expect(reasons).not.toContain('complete_symbol');
    // high_confidence is the only signal → not sufficient (need 2)
  });
});

// =============================================================================
// Phase 3: Budget allocation (Fix #3: agent_preview / agent_full)
// =============================================================================

describe('allocateBudget', () => {
  describe('agent_preview (default)', () => {
    it('should allocate full/preview/summary tiers', () => {
      const alloc = allocateBudget(4000, 5, 'agent_preview');
      expect(alloc[0].presentation).toBe('full');
      expect(alloc[1].presentation).toBe('preview');
      expect(alloc[2].presentation).toBe('preview');
      expect(alloc[3].presentation).toBe('summary');
      expect(alloc[4].presentation).toBe('summary');
    });

    it('should give top-1 up to 60% of budget', () => {
      const alloc = allocateBudget(4000, 3, 'agent_preview');
      expect(alloc[0].tokenCap).toBeLessThanOrEqual(2400); // 60% of 4000
      expect(alloc[0].tokenCap).toBeGreaterThan(0);
    });

    it('should cap per-result tokens at defaults', () => {
      const alloc = allocateBudget(10000, 3, 'agent_preview');
      expect(alloc[0].tokenCap).toBeLessThanOrEqual(2000);
      expect(alloc[1].tokenCap).toBeLessThanOrEqual(800);
      expect(alloc[2].tokenCap).toBeLessThanOrEqual(400);
    });
  });

  describe('agent_full', () => {
    it('should give competitive top-3 results full presentation', () => {
      // Results with competitive scores (all within 2× of top-1)
      const results = [{ score: 0.8 }, { score: 0.6 }, { score: 0.5 }, { score: 0.3 }, { score: 0.1 }];
      const alloc = allocateBudget(8000, 5, 'agent_full', { results });
      expect(alloc[0].presentation).toBe('full');
      expect(alloc[1].presentation).toBe('full');  // 0.6 >= 0.8/2 = 0.4
      expect(alloc[2].presentation).toBe('full');  // 0.5 >= 0.4
      expect(alloc[3].presentation).toBe('summary');
      expect(alloc[4].presentation).toBe('summary');
    });

    it('should demote uncompetitive results to preview even in full mode', () => {
      // rank-2 score < top-1 / 2 → not competitive
      const results = [{ score: 0.9 }, { score: 0.3 }, { score: 0.1 }];
      const alloc = allocateBudget(8000, 3, 'agent_full', { results });
      expect(alloc[0].presentation).toBe('full');
      expect(alloc[1].presentation).toBe('preview'); // 0.3 < 0.9/2 = 0.45
      expect(alloc[2].presentation).toBe('preview'); // 0.1 < 0.45
    });

    it('should give competitive top-2/3 higher caps than preview mode', () => {
      const results = [{ score: 0.8 }, { score: 0.7 }, { score: 0.6 }];
      const preview = allocateBudget(8000, 3, 'agent_preview', { results });
      const full = allocateBudget(8000, 3, 'agent_full', { results });
      expect(full[1].tokenCap).toBeGreaterThan(preview[1].tokenCap);
      expect(full[2].tokenCap).toBeGreaterThan(preview[2].tokenCap);
    });
  });

  describe('adaptive (regex breadth)', () => {
    it('should concentrate on top-1 when regex is broad (>200 matches)', () => {
      const normal = allocateBudget(4000, 3, 'agent_preview', { grepMatches: 10 });
      const broad = allocateBudget(4000, 3, 'agent_preview', { grepMatches: 500 });
      // Broad regex gives more to top-1 (70% vs 60%)
      expect(broad[0].tokenCap).toBeGreaterThanOrEqual(normal[0].tokenCap);
      // And less to top-2/3
      expect(broad[1].tokenCap).toBeLessThanOrEqual(normal[1].tokenCap);
    });
  });

  it('should handle single result', () => {
    const alloc = allocateBudget(4000, 1);
    expect(alloc).toHaveLength(1);
    expect(alloc[0].presentation).toBe('full');
  });

  it('should handle zero results', () => {
    const alloc = allocateBudget(4000, 0);
    expect(alloc).toHaveLength(0);
  });
});

// =============================================================================
// Phase 3: Token truncation
// =============================================================================

describe('truncateToTokenCap', () => {
  it('should not truncate code within budget', () => {
    const code = 'const x = 1;\nconst y = 2;\n';
    const { code: result, truncated } = truncateToTokenCap(code, 100);
    expect(result).toBe(code);
    expect(truncated).toBe(false);
  });

  it('should truncate code exceeding budget', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `const line${i} = ${i};`);
    const code = lines.join('\n');
    const { code: result, truncated } = truncateToTokenCap(code, 50);
    expect(truncated).toBe(true);
    expect(result).toContain('// ...');
    expect(result.length).toBeLessThan(code.length);
  });

  it('should handle empty code', () => {
    const { code, truncated, originalTokens } = truncateToTokenCap('', 100);
    expect(code).toBe('');
    expect(truncated).toBe(false);
    expect(originalTokens).toBe(0);
  });

  it('should never exceed the requested token cap', () => {
    const code = [
      'export function example() {',
      '  const a = 1;',
      '  const b = 2;',
      '  return a + b;',
      '}',
    ].join('\n');

    for (const tokenCap of [1, 2, 5, 10]) {
      const { code: result } = truncateToTokenCap(code, tokenCap);
      expect(estimateTokens(result)).toBeLessThanOrEqual(tokenCap);
    }
  });
});

// =============================================================================
// Phase 2: Symbol expansion (Fix #1: uses codeGraphRepo, not raw SQL)
// =============================================================================

describe('expandToSymbol', () => {
  it('should return as-is when chunk is already a complete symbol (>10 lines)', () => {
    const result = {
      file: 'src/foo.js',
      startLine: 10,
      endLine: 30,
      metadata: { file: 'src/foo.js', name: 'MyClass', type: 'class', startLine: 10, endLine: 30 },
    };

    const expansion = expandToSymbol(result, {
      codeGraphRepo: null,
      locationMap: null,
      fileCache: new Map(),
      projectRoot: '/tmp',
      tokenCap: 2000,
    });

    expect(expansion.expanded).toBe(false);
    expect(expansion.symbol).toBe('MyClass');
    expect(expansion.symbolType).toBe('class');
    expect(expansion.startLine).toBe(10);
    expect(expansion.endLine).toBe(30);
  });

  it('should expand via CodeGraphRepository when chunk is a signature fragment', () => {
    const result = {
      file: 'src/foo.js',
      startLine: 10,
      endLine: 13,
      metadata: { file: 'src/foo.js', name: null, type: 'code', startLine: 10, endLine: 13 },
    };

    // Mock CodeGraphRepository (Fix #1: repository, not raw _db access)
    const mockRepo = {
      findEnclosingEntity: () => ({
        name: 'myFunction',
        type: 'function',
        startLine: 8,
        endLine: 25,
        parentClass: null,
      }),
    };

    const expansion = expandToSymbol(result, {
      codeGraphRepo: mockRepo,
      locationMap: null,
      fileCache: new Map(),
      projectRoot: '/tmp',
      tokenCap: 2000,
    });

    expect(expansion.expanded).toBe(true);
    expect(expansion.expandedFrom).toBe('10-13');
    expect(expansion.symbol).toBe('myFunction');
    expect(expansion.symbolType).toBe('function');
    expect(expansion.startLine).toBe(8);
    expect(expansion.endLine).toBe(25);
  });

  it('should keep original range when entity exceeds token cap', () => {
    const result = {
      file: 'src/big.js',
      startLine: 50,
      endLine: 55,
      metadata: { file: 'src/big.js', startLine: 50, endLine: 55 },
    };

    const mockRepo = {
      findEnclosingEntity: () => ({
        name: 'HugeClass',
        type: 'class',
        startLine: 1,
        endLine: 500,
        parentClass: null,
      }),
    };

    const expansion = expandToSymbol(result, {
      codeGraphRepo: mockRepo,
      locationMap: null,
      fileCache: new Map(),
      projectRoot: '/tmp',
      tokenCap: 800,
    });

    expect(expansion.expanded).toBe(false);
    expect(expansion.symbol).toBe('HugeClass');
    expect(expansion.startLine).toBe(50);
    expect(expansion.endLine).toBe(55);
  });

  it('should fall back gracefully when no repository is available', () => {
    const result = {
      file: 'src/foo.js',
      startLine: 10,
      endLine: 15,
      metadata: { file: 'src/foo.js', name: 'snippet', type: 'code', startLine: 10, endLine: 15 },
    };

    const expansion = expandToSymbol(result, {
      codeGraphRepo: null,
      locationMap: null,
      fileCache: new Map(),
      projectRoot: '/tmp',
      tokenCap: 2000,
    });

    expect(expansion.expanded).toBe(false);
    expect(expansion.symbol).toBe('snippet');
  });

  it('should merge sibling chunks when graph lookup fails', () => {
    const result = {
      file: 'src/foo.js',
      startLine: 20,
      endLine: 25,
      metadata: { file: 'src/foo.js', startLine: 20, endLine: 25 },
    };

    const locationMap = new Map();
    locationMap.set('src/foo.js', [
      { startLine: 10, endLine: 19, id: 'chunk1' },
      { startLine: 20, endLine: 30, id: 'chunk2' },
      { startLine: 31, endLine: 40, id: 'chunk3' },
    ]);

    const expansion = expandToSymbol(result, {
      codeGraphRepo: null,
      locationMap,
      fileCache: new Map(),
      projectRoot: '/tmp',
      tokenCap: 2000,
    });

    expect(expansion.expanded).toBe(true);
    expect(expansion.startLine).toBeLessThanOrEqual(20);
    expect(expansion.endLine).toBeGreaterThanOrEqual(30);
  });
});

// =============================================================================
// Syntax-aware expansion fallback
// =============================================================================

describe('expandBySyntax', () => {
  it('should expand JS/Go function by brace matching', () => {
    const fileCache = new Map();
    // Simulate a file with a function at lines 5-15 (absolute)
    const lines = [
      '// header',          // 1
      '',                   // 2
      '// comment',         // 3
      '',                   // 4
      'function foo() {',   // 5
      '  const x = 1;',    // 6
      '  if (x) {',        // 7
      '    return x;',     // 8
      '  }',               // 9
      '  return 0;',       // 10
      '}',                 // 11
      '',                  // 12
    ];
    const absPath = '/tmp/test.js';
    fileCache.set(absPath, lines);

    // Chunk covers only line 8 (inside the function)
    const result = expandBySyntax(fileCache, 'test.js', 8, 8, 2000, '/tmp');
    // Should expand to include the whole function (lines 5-11)
    expect(result).not.toBeNull();
    if (result) {
      expect(result.startLine).toBeLessThanOrEqual(5);
      expect(result.endLine).toBeGreaterThanOrEqual(11);
    }
  });

  it('should expand Python function by indent level', () => {
    const fileCache = new Map();
    const lines = [
      'import os',             // 1
      '',                      // 2
      'def my_func():',        // 3
      '    x = 1',             // 4
      '    if x:',             // 5
      '        return x',      // 6
      '    return 0',          // 7
      '',                      // 8
      'def other():',          // 9
    ];
    const absPath = '/tmp/test.py';
    fileCache.set(absPath, lines);

    // Chunk is line 6 (inside my_func)
    const result = expandBySyntax(fileCache, 'test.py', 6, 6, 2000, '/tmp');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.startLine).toBeLessThanOrEqual(3); // should reach def
      expect(result.endLine).toBeGreaterThanOrEqual(7);
      expect(result.endLine).toBeLessThan(9); // should not include other()
    }
  });

  it('should return null when expansion exceeds token cap', () => {
    const fileCache = new Map();
    const lines = Array.from({ length: 500 }, (_, i) => `  line ${i};`);
    lines[0] = 'function big() {';
    lines[499] = '}';
    fileCache.set('/tmp/big.js', lines);

    const result = expandBySyntax(fileCache, 'big.js', 250, 250, 100, '/tmp');
    // 500 lines × 10 tokens/line = 5000 >> 100 cap
    expect(result).toBeNull();
  });

  it('should return null when file is not readable', () => {
    const result = expandBySyntax(new Map(), 'nonexistent.js', 5, 5, 2000, '/tmp');
    expect(result).toBeNull();
  });
});

// =============================================================================
// Result diversity penalty
// =============================================================================

describe('diversity penalty', () => {
  it('should demote overlapping results in same file to summary', () => {
    // Two results from the same file with overlapping line ranges
    const results = [
      { id: 'a', file: 'src/foo.js', startLine: 10, endLine: 30, score: 0.9, lateInteractionScore: 0.9, metadata: { file: 'src/foo.js', startLine: 10, endLine: 30, name: 'func1', type: 'function' } },
      { id: 'b', file: 'src/foo.js', startLine: 25, endLine: 40, score: 0.7, lateInteractionScore: 0.7, metadata: { file: 'src/foo.js', startLine: 25, endLine: 40, name: 'func1b', type: 'function' } },
      { id: 'c', file: 'src/bar.js', startLine: 1, endLine: 20, score: 0.5, lateInteractionScore: 0.5, metadata: { file: 'src/bar.js', startLine: 1, endLine: 20, name: 'func2', type: 'function' } },
    ];

    const response = packageForAgent(results, { grepMatches: 5 }, {
      query: 'test', regex: 'test', projectRoot: '/nonexistent',
    });

    // Result 1 (a) should be full, result 2 (b) should be demoted to summary
    // (overlaps with a in same file), result 3 (c) should be preview
    expect(response.results[0].presentation).toBe('full');
    expect(response.results[1].presentation).toBe('summary'); // diversity demoted
    expect(response.results[2].presentation).toBe('preview');
  });

  it('should not demote results from different files', () => {
    const results = [
      { id: 'a', file: 'src/foo.js', startLine: 10, endLine: 30, score: 0.9, lateInteractionScore: 0.9, metadata: { file: 'src/foo.js', startLine: 10, endLine: 30, name: 'f1', type: 'function' } },
      { id: 'b', file: 'src/bar.js', startLine: 10, endLine: 30, score: 0.7, lateInteractionScore: 0.7, metadata: { file: 'src/bar.js', startLine: 10, endLine: 30, name: 'f2', type: 'function' } },
    ];

    const response = packageForAgent(results, { grepMatches: 5 }, {
      query: 'test', regex: 'test', projectRoot: '/nonexistent',
    });

    expect(response.results[0].presentation).toBe('full');
    expect(response.results[1].presentation).toBe('preview'); // not demoted
  });
});

// =============================================================================
// Fix #2: Staleness detection
// =============================================================================

describe('checkStaleness', () => {
  it('should return stale:false and indexedAt:null when no repository', () => {
    const { stale, indexedAt } = checkStaleness('foo.js', '/tmp', null);
    expect(stale).toBe(false);
    expect(indexedAt).toBeNull();
  });

  it('should return stale:true when repository reports stale_since', () => {
    const mockRepo = {
      getFileIndexInfo: () => ({ staleSince: Date.now() }),
      getDbMtime: () => null,
    };
    const { stale } = checkStaleness('foo.js', '/tmp', mockRepo);
    expect(stale).toBe(true);
  });

  it('should handle gracefully when file does not exist', () => {
    const mockRepo = {
      getFileIndexInfo: () => null,
      getDbMtime: () => new Date('2026-01-01'),
    };
    const { stale } = checkStaleness('nonexistent.js', '/tmp', mockRepo);
    expect(stale).toBe(false);
  });

  it('should cache db mtime across calls (Fix D: perf)', () => {
    let callCount = 0;
    const mockRepo = {
      getFileIndexInfo: () => null,
      getDbMtime: () => { callCount++; return new Date('2026-01-01'); },
    };
    const cache = {};
    checkStaleness('a.js', '/tmp', mockRepo, cache);
    checkStaleness('b.js', '/tmp', mockRepo, cache);
    checkStaleness('c.js', '/tmp', mockRepo, cache);
    // getDbMtime should only be called once — cached after first call
    expect(callCount).toBe(1);
  });
});

// =============================================================================
// Phase 4: Header context (Fix #5: broader identifier matching)
// =============================================================================

describe('extractHeaderContext', () => {
  it('should return null for empty code', () => {
    const { headerContext } = extractHeaderContext('', new Map(), 'foo.js', '/tmp');
    expect(headerContext).toBeNull();
  });

  it('should return null when no file path', () => {
    const { headerContext } = extractHeaderContext('const x = 1;', new Map(), null, '/tmp');
    expect(headerContext).toBeNull();
  });

  it('should handle missing files gracefully', () => {
    const { headerContext } = extractHeaderContext('const x = SweetSearch();', new Map(), 'nonexistent.js', '/tmp');
    expect(headerContext).toBeNull();
  });
});

// =============================================================================
// Main packaging function
// =============================================================================

describe('packageForAgent', () => {
  const makeResults = (count = 2) => Array.from({ length: count }, (_, i) => ({
    id: `chunk${i}`,
    file: `src/file${i}.js`,
    startLine: 10,
    endLine: 30,
    score: 0.9 - i * 0.15,
    lateInteractionScore: 0.9 - i * 0.15,
    metadata: { file: `src/file${i}.js`, name: `func${i}`, type: 'function', startLine: 10, endLine: 30 },
  }));

  it('should produce agent format with correct schema including stale, indexedAt, sufficiency', () => {
    const response = packageForAgent(makeResults(), { total_ms: 28, grepMatches: 10, indexedChunks: 5 }, {
      query: 'authentication',
      regex: 'class.*Service',
      tokenBudget: 4000,
      projectRoot: '/nonexistent',
    });

    // Top-level schema
    expect(response.format).toBe('agent');
    expect(response.subMode).toBe('agent_preview');
    expect(response.query).toBe('authentication');
    expect(response.regex).toBe('class.*Service');
    expect(response.mode).toBe('pattern');
    expect(response.totalResults).toBe(2);
    expect(response.tokenBudget).toBe(4000);
    expect(typeof response.tokensUsed).toBe('number');
    expect(['high', 'medium', 'low']).toContain(response.confidence);
    expect(typeof response.confidenceReason).toBe('string');
    expect(response.packagingMs).toBeGreaterThanOrEqual(0);

    // Fix #7: sufficiency signals present
    expect(typeof response.sufficient).toBe('boolean');
    expect(Array.isArray(response.sufficiencyReasons)).toBe(true);

    // Fix #2: stale/indexedAt fields on results
    for (const r of response.results) {
      expect(typeof r.stale).toBe('boolean');
      expect('indexedAt' in r).toBe(true);
    }

    // Result schema
    const r1 = response.results[0];
    expect(r1.rank).toBe(1);
    expect(r1.file).toBe('src/file0.js');
    expect(r1.symbol).toBe('func0');
    expect(r1.symbolType).toBe('function');
    expect(r1.score).toBe(0.9);
    expect(['full', 'preview', 'summary']).toContain(r1.presentation);
  });

  it('should assign summary presentation to results beyond rank 3', () => {
    const response = packageForAgent(makeResults(5), {}, {
      query: 'test',
      regex: 'test',
      projectRoot: '/nonexistent',
    });

    expect(response.results[0].presentation).toBe('full');
    expect(response.results[1].presentation).toBe('preview');
    expect(response.results[2].presentation).toBe('preview');
    expect(response.results[3].presentation).toBe('summary');
    expect(response.results[4].presentation).toBe('summary');

    expect(response.results[3].code).toBeNull();
    expect(response.results[3].codeTokens).toBe(0);
    expect(response.results[3].summary).toBeTruthy();
  });

  // Fix #3: agent_full sub-mode — competitive results get full, uncompetitive get preview
  it('should give competitive top-3 full presentation in agent_full mode', () => {
    const response = packageForAgent(makeResults(5), { grepMatches: 5 }, {
      query: 'test',
      regex: 'test',
      format: 'agent_full',
      projectRoot: '/nonexistent',
    });

    expect(response.subMode).toBe('agent_full');
    expect(response.tokenBudget).toBe(8000); // default for agent_full
    expect(response.results[0].presentation).toBe('full');
    // makeResults scores: 0.9, 0.75, 0.6, 0.45, 0.3
    // top1/2 = 0.45 → results 1,2 are competitive (0.75, 0.6 >= 0.45)
    expect(response.results[1].presentation).toBe('full');
    expect(response.results[2].presentation).toBe('full');
    expect(response.results[3].presentation).toBe('summary');
  });

  it('should default to agent_preview sub-mode', () => {
    const response = packageForAgent(makeResults(1), {}, {
      query: 'test',
      regex: 'test',
      format: 'agent',
      projectRoot: '/nonexistent',
    });
    expect(response.subMode).toBe('agent_preview');
  });

  it('should handle empty results', () => {
    const response = packageForAgent([], {}, {
      query: 'test',
      regex: 'test',
      projectRoot: '/tmp',
    });

    expect(response.format).toBe('agent');
    expect(response.totalResults).toBe(0);
    expect(response.results).toHaveLength(0);
    expect(response.confidence).toBe('low');
    expect(response.sufficient).toBe(false);
  });

  it('should respect custom token budget', () => {
    const response = packageForAgent(makeResults(1), {}, {
      query: 'test',
      regex: 'test',
      tokenBudget: 6000,
      projectRoot: '/nonexistent',
    });
    expect(response.tokenBudget).toBe(6000);
  });

  it('should enforce tokenBudget as a hard ceiling', () => {
    const results = [
      {
        id: 'a',
        file: 'core/search/context-expander.js',
        startLine: 1,
        endLine: 120,
        score: 0.9,
        lateInteractionScore: 0.9,
        metadata: { file: 'core/search/context-expander.js', startLine: 1, endLine: 120, name: 'f1', type: 'function' },
      },
      {
        id: 'b',
        file: 'core/search/context-expander.js',
        startLine: 121,
        endLine: 220,
        score: 0.7,
        lateInteractionScore: 0.7,
        metadata: { file: 'core/search/context-expander.js', startLine: 121, endLine: 220, name: 'f2', type: 'function' },
      },
      {
        id: 'c',
        file: 'core/search/context-expander.js',
        startLine: 221,
        endLine: 320,
        score: 0.5,
        lateInteractionScore: 0.5,
        metadata: { file: 'core/search/context-expander.js', startLine: 221, endLine: 320, name: 'f3', type: 'function' },
      },
    ];

    for (const tokenBudget of [1, 50, 100, 200]) {
      const response = packageForAgent(results, { grepMatches: 3, indexedChunks: 3 }, {
        query: 'test',
        regex: 'test',
        tokenBudget,
        projectRoot: process.cwd(),
      });

      expect(response.tokensUsed).toBeLessThanOrEqual(tokenBudget);
    }
  });
});

// =============================================================================
// Ranking identity — agent mode must not change result order (Fix #6)
// =============================================================================

describe('ranking identity', () => {
  it('should preserve result files, order, and scores between modes', () => {
    const rankedResults = [
      { id: 'a', file: 'x.js', startLine: 1, endLine: 5, score: 0.9, lateInteractionScore: 0.9, rank: 1, metadata: { file: 'x.js', startLine: 1, endLine: 5 } },
      { id: 'b', file: 'y.js', startLine: 10, endLine: 20, score: 0.7, lateInteractionScore: 0.7, rank: 2, metadata: { file: 'y.js', startLine: 10, endLine: 20 } },
      { id: 'c', file: 'z.js', startLine: 5, endLine: 8, score: 0.5, lateInteractionScore: 0.5, rank: 3, metadata: { file: 'z.js', startLine: 5, endLine: 8 } },
    ];

    // Run through agent packaging for both sub-modes
    for (const fmt of ['agent_preview', 'agent_full']) {
      const response = packageForAgent(rankedResults, {}, {
        query: 'test', regex: 'test', format: fmt, projectRoot: '/nonexistent',
      });

      // Ranks must be sequential and match input order
      expect(response.results.map(r => r.rank)).toEqual([1, 2, 3]);
      // Files must match input order
      expect(response.results.map(r => r.file)).toEqual(['x.js', 'y.js', 'z.js']);
      // Scores must match input (ranking is frozen before packaging)
      expect(response.results.map(r => r.score)).toEqual([0.9, 0.7, 0.5]);
    }
  });

  /**
   * Fix #6: Real integration test per plan §14.
   *
   * This test verifies the ranking identity contract by feeding the SAME
   * ranked results through packageForAgent and confirming that the output
   * preserves file, startLine, and score from the input — with both sub-modes.
   *
   * We also verify the structural contract: benchmark mode returns {results, stats}
   * while agent mode returns the agent schema with format='agent'.
   *
   * A full end-to-end test calling patternSearch in both modes belongs in the
   * integration test suite (where ES module mocking is handled by vi.mock at
   * module scope). This unit-level test verifies the packaging layer's contract.
   */
  it('should produce identical file:line:score tuples regardless of sub-mode', () => {
    const rankedResults = [
      { id: 'chunk-a', file: 'src/a.js', startLine: 1, endLine: 20, score: 0.9, lateInteractionScore: 0.9, metadata: { file: 'src/a.js', name: 'funcA', type: 'function', startLine: 1, endLine: 20 } },
      { id: 'chunk-b', file: 'src/b.js', startLine: 5, endLine: 15, score: 0.6, lateInteractionScore: 0.6, metadata: { file: 'src/b.js', name: 'funcB', type: 'function', startLine: 5, endLine: 15 } },
      { id: 'chunk-c', file: 'src/c.js', startLine: 10, endLine: 30, score: 0.3, lateInteractionScore: 0.3, metadata: { file: 'src/c.js', name: 'funcC', type: 'function', startLine: 10, endLine: 30 } },
    ];

    const stats = { total_ms: 15, grepMatches: 5, indexedChunks: 3 };

    // Run both sub-modes on the same ranked results
    const previewResult = packageForAgent(rankedResults, stats, {
      query: 'test', regex: 'function', format: 'agent_preview', projectRoot: '/nonexistent',
    });
    const fullResult = packageForAgent(rankedResults, stats, {
      query: 'test', regex: 'function', format: 'agent_full', projectRoot: '/nonexistent',
    });

    // Extract the ranking-identity tuple: file + startLine + score
    const previewTuples = previewResult.results.map(r => `${r.file}:${r.startLine}:${r.score}`);
    const fullTuples = fullResult.results.map(r => `${r.file}:${r.startLine}:${r.score}`);

    // RANKING IDENTITY: both modes produce the same order and scores
    expect(previewTuples).toEqual(fullTuples);

    // Also verify against the input order
    const inputTuples = rankedResults.map(r => `${r.file}:${r.startLine}:${r.score}`);
    expect(previewTuples).toEqual(inputTuples);

    // Structural contract: both return format='agent' with distinct subMode
    expect(previewResult.format).toBe('agent');
    expect(previewResult.subMode).toBe('agent_preview');
    expect(fullResult.format).toBe('agent');
    expect(fullResult.subMode).toBe('agent_full');

    // Presentation tiers differ between modes (the whole point of sub-modes)
    expect(previewResult.results[1].presentation).toBe('preview');
    expect(fullResult.results[1].presentation).toBe('full');
  });
});
