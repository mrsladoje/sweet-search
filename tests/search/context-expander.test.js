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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  computeBudgetSignals,
  selectAgentBudget,
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

  it('should produce a symbol sandwich when entity exceeds token cap', () => {
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

    // Symbol sandwich: anchor on the entity range, but render
    // signature + elision + gold + elision + closing in packageForAgent.
    expect(expansion.kind).toBe('sandwich');
    expect(expansion.expanded).toBe(true);
    expect(expansion.expandedFrom).toBe('50-55');
    expect(expansion.symbol).toBe('HugeClass');
    expect(expansion.startLine).toBe(1);
    expect(expansion.endLine).toBe(500);
    expect(expansion.sandwich).toBeDefined();
    // Gold part is always present
    const goldPart = expansion.sandwich.parts.find(p => p.kind === 'gold');
    expect(goldPart).toBeDefined();
    expect(goldPart.startLine).toBe(50);
    expect(goldPart.endLine).toBe(55);
    // Signature should fit in 800-token cap (gold=60, sig=30, closing=10 => well under)
    const sigPart = expansion.sandwich.parts.find(p => p.kind === 'signature');
    expect(sigPart).toBeDefined();
    expect(sigPart.startLine).toBe(1);
    // Closing should also fit
    const closePart = expansion.sandwich.parts.find(p => p.kind === 'closing');
    expect(closePart).toBeDefined();
    expect(closePart.startLine).toBe(500);
    // Both head and tail elisions should be flagged
    expect(expansion.sandwich.elidedHead).toBeGreaterThan(0);
    expect(expansion.sandwich.elidedTail).toBeGreaterThan(0);
    expect(expansion.sandwich.elisionMarkers).toBe(2);
  });

  it('should fall back to bare chunk when even gold does not fit in cap', () => {
    // 200-line gold chunk = 2000 tokens; cap of 100 cannot fit even gold.
    const result = {
      file: 'src/big.js',
      startLine: 50,
      endLine: 249,
      metadata: { file: 'src/big.js', startLine: 50, endLine: 249 },
    };

    const mockRepo = {
      findEnclosingEntity: () => ({
        name: 'HugeFunc',
        type: 'function',
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
      tokenCap: 100,
    });

    // Cap too tight for sandwich → fall back to bare chunk + entity name.
    expect(expansion.kind).toBe('chunk');
    expect(expansion.expanded).toBe(false);
    expect(expansion.symbol).toBe('HugeFunc');
    expect(expansion.startLine).toBe(50);
    expect(expansion.endLine).toBe(249);
    expect(expansion.sandwich).toBeUndefined();
  });

  it('should drop closing brace first when sandwich is tight', () => {
    // Gold: 50 lines (origStart=100..origEnd=149). Entity 1-1000.
    // Token math (10 tokens/line, 10 per elision marker):
    //   sig=40 (lines 1-4), gold=500, closing=10 (line 1000), 2 elisions=20
    //   full sandwich = 570
    // Cap=560: full overshoots by 10 → drop closing first.
    //   sig + gold + 1 elision = 40 + 500 + 10 = 550 ≤ 560 → keep signature, drop closing ✓
    const result = {
      file: 'src/tight.js',
      startLine: 100,
      endLine: 149,
      metadata: { file: 'src/tight.js', startLine: 100, endLine: 149 },
    };

    const mockRepo = {
      findEnclosingEntity: () => ({
        name: 'TightFunc',
        type: 'function',
        startLine: 1,
        endLine: 1000,
        parentClass: null,
      }),
    };

    const expansion = expandToSymbol(result, {
      codeGraphRepo: mockRepo,
      locationMap: null,
      fileCache: new Map(),
      projectRoot: '/tmp',
      tokenCap: 560,
    });

    expect(expansion.kind).toBe('sandwich');
    const kinds = expansion.sandwich.parts.map(p => p.kind);
    expect(kinds).toContain('signature');
    expect(kinds).toContain('gold');
    expect(kinds).not.toContain('closing');
    expect(expansion.sandwich.elidedHead).toBeGreaterThan(0);
    expect(expansion.sandwich.elidedTail).toBe(0); // no tail elision when no closing
  });

  it('should respect no-sandwich ablation flag', () => {
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
      ablations: new Set(['no-sandwich']),
    });

    // Ablation forces the previous "bare chunk" fallback
    expect(expansion.kind).toBe('chunk');
    expect(expansion.expanded).toBe(false);
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

    // Anchor to explicit preview tier — this test covers diversity demotion,
    // not auto-tier selection. Auto-tier behaviour is tested separately
    // under `selectAgentBudget` / 'auto-tier' suites below.
    const response = packageForAgent(results, { grepMatches: 5 }, {
      query: 'test', regex: 'test', format: 'agent_preview', projectRoot: '/nonexistent',
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
      query: 'test', regex: 'test', format: 'agent_preview', projectRoot: '/nonexistent',
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
    // Anchor to explicit preview tier — this test covers the
    // rank-3 summary boundary, not auto-tier selection.
    const response = packageForAgent(makeResults(5), {}, {
      query: 'test',
      regex: 'test',
      format: 'agent_preview',
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

// =============================================================================
// Auto-tier selection (selectAgentBudget) — format='agent' default
// =============================================================================
//
// Mirrors core/graph/structural-context.js:selectBudget() (the trace tool's
// adaptive budget). The agent passes a single format='agent' and the system
// picks 4k / 8k / 12k from score-distribution signals. Explicit tier formats
// (agent_preview / agent_full / agent_full_xl) and explicit numeric
// tokenBudget remain as overrides.
//
// IMPORTANT for agents reading this: the contract is that the FORMAT-GATED
// ranking pipeline (file-kind-ranking.js:1443-1448) treats ALL agent
// variants — agent / agent_preview / agent_full / agent_full_xl — as
// "agent format". Auto-pick changes the BUDGET tier, not the ranking. So
// MRR on retrieval benches must not change when format='agent' switches
// from preview to full or xl.

describe('selectAgentBudget (auto-tier)', () => {
  describe('explicit format pass-through', () => {
    it('agent_preview → preview/4k with explicit_preview reason', () => {
      const pick = selectAgentBudget('agent_preview', { numResults: 5, dominance: 1.2, entropy: 0.9, breadth: 100 });
      expect(pick.tier).toBe('preview');
      expect(pick.tokenBudget).toBe(4000);
      expect(pick.subMode).toBe('agent_preview');
      expect(pick.reason).toBe('explicit_preview');
    });

    it('agent_full → full/8k with explicit_full reason', () => {
      const pick = selectAgentBudget('agent_full', { numResults: 1, dominance: 99, entropy: 0, breadth: 0 });
      expect(pick.tier).toBe('full');
      expect(pick.tokenBudget).toBe(8000);
      expect(pick.subMode).toBe('agent_full');
      expect(pick.reason).toBe('explicit_full');
    });

    it('agent_full_xl → xl/12k with explicit_xl reason', () => {
      const pick = selectAgentBudget('agent_full_xl', { numResults: 1, dominance: 99, entropy: 0, breadth: 0 });
      expect(pick.tier).toBe('xl');
      expect(pick.tokenBudget).toBe(12000);
      expect(pick.subMode).toBe('agent_full_xl');
      expect(pick.reason).toBe('explicit_xl');
    });

    it('explicit numeric budget overrides auto-pick (passes value through unchanged)', () => {
      const pick = selectAgentBudget('agent', { numResults: 5, dominance: 1.2, entropy: 0.9, breadth: 100 }, { explicitBudget: 1 });
      expect(pick.tokenBudget).toBe(1); // honoured verbatim — strict ceiling tests rely on this
      expect(pick.reason).toBe('explicit_budget');
    });

    it('explicit numeric budget infers tier label from clamped value', () => {
      expect(selectAgentBudget('agent', {}, { explicitBudget: 5000 }).tier).toBe('preview');
      expect(selectAgentBudget('agent', {}, { explicitBudget: 8500 }).tier).toBe('full');
      expect(selectAgentBudget('agent', {}, { explicitBudget: 13000 }).tier).toBe('xl');
    });
  });

  describe('auto-pick decision tree (format=agent)', () => {
    // Design target: preview fires on ~99% of queries; xl+full combined ~1-5%.
    // These tests pin the threshold semantics. If you intentionally widen the
    // upgrade triggers, update both the tests and the design comment in
    // context-expander.js together.

    it('zero results → preview/auto_empty', () => {
      const pick = selectAgentBudget('agent', { numResults: 0, dominance: 0, top1Tokens: 0 });
      expect(pick.tier).toBe('preview');
      expect(pick.reason).toBe('auto_empty');
    });

    it('single small result → preview', () => {
      const pick = selectAgentBudget('agent', { numResults: 1, dominance: 99, top1Tokens: 500 });
      expect(pick.tier).toBe('preview');
      expect(pick.reason).toBe('auto_preview_default');
    });

    it('single huge result (>=2400t) → xl (gate fires; top-1 gets up to 8k)', () => {
      const pick = selectAgentBudget('agent', { numResults: 1, dominance: 99, top1Tokens: 3000 });
      expect(pick.tier).toBe('xl');
      expect(pick.reason).toBe('auto_xl_single_huge');
    });

    it('dominant top-1 + small chunk → preview (extra budget would be unused)', () => {
      // The user-flagged regression: small results, top1 >= 2*top2, top-1
      // fits in 2k. Earlier rules wrongly upgraded via entropy or just-≥2
      // dominance.
      const pick = selectAgentBudget('agent', { numResults: 2, dominance: 2.25, top1Tokens: 800 });
      expect(pick.tier).toBe('preview');
    });

    it('moderately dominant top-1 + huge chunk → still preview (need D >= 2.5)', () => {
      // Tightened from D>=2.0 to D>=2.5: borderline dominance (2.0-2.4) lands
      // on preview to avoid spending XL on cases the dominance gate may not
      // reliably fire on.
      const pick = selectAgentBudget('agent', { numResults: 5, dominance: 2.2, top1Tokens: 3000 });
      expect(pick.tier).toBe('preview');
    });

    it('strongly dominant top-1 + huge chunk → xl', () => {
      const pick = selectAgentBudget('agent', { numResults: 5, dominance: 3.0, top1Tokens: 2500 });
      expect(pick.tier).toBe('xl');
      expect(pick.reason).toBe('auto_xl_dominant_huge_top1');
    });

    it('many tightly-clustered results → full (rare case)', () => {
      // 12 results, top-1 only 4% ahead of top-2, non-trivial chunk → full.
      const pick = selectAgentBudget('agent', { numResults: 12, dominance: 1.04, top1Tokens: 800 });
      expect(pick.tier).toBe('full');
      expect(pick.reason).toBe('auto_full_tight_cluster');
    });

    it('moderately competitive multi-result (D between 1.05 and 2.0) → preview', () => {
      // The "many results, only 2 important" case the user flagged: dominance
      // moderate (not tied). Preview is enough — top-1 is fully shown, rank-2
      // gets a signature, agent can re-read or escalate.
      const pick = selectAgentBudget('agent', { numResults: 10, dominance: 1.3, top1Tokens: 500 });
      expect(pick.tier).toBe('preview');
    });

    it('tightly clustered but few results → preview (need 10+ results for full)', () => {
      const pick = selectAgentBudget('agent', { numResults: 5, dominance: 1.0, top1Tokens: 800 });
      expect(pick.tier).toBe('preview');
    });

    it('tightly clustered with tiny top-1 → preview (full buys nothing on tiny chunks)', () => {
      const pick = selectAgentBudget('agent', { numResults: 12, dominance: 1.02, top1Tokens: 200 });
      expect(pick.tier).toBe('preview');
    });

    it('top1Tokens=0 (chunk size unknown) → preview, never xl', () => {
      // When startLine/endLine missing, top1Tokens=0 keeps the path on preview.
      const pick = selectAgentBudget('agent', { numResults: 5, dominance: 3.0, top1Tokens: 0 });
      expect(pick.tier).toBe('preview');
    });

    it('breadth and entropy are diagnostic-only, not used by the decision', () => {
      const pickA = selectAgentBudget('agent', {
        numResults: 5, dominance: 3.0, top1Tokens: 800, breadth: 5000, entropy: 0.99,
      });
      expect(pickA.tier).toBe('preview'); // top1Tokens too small for xl

      const pickB = selectAgentBudget('agent', {
        numResults: 5, dominance: 1.2, top1Tokens: 4000, breadth: 0, entropy: 0.1,
      });
      expect(pickB.tier).toBe('preview'); // dominance below XL threshold; cluster not tight enough for full
    });
  });

  describe('computeBudgetSignals', () => {
    it('returns zeros for empty input', () => {
      expect(computeBudgetSignals([], {})).toEqual({
        numResults: 0, breadth: 0, dominance: 0, entropy: 0, top1Tokens: 0, top1LineCount: 0,
      });
    });

    it('handles single positive-score result with sentinel dominance', () => {
      const s = computeBudgetSignals([{ score: 0.9 }], {});
      expect(s.numResults).toBe(1);
      expect(s.dominance).toBeGreaterThan(10); // sentinel
    });

    it('computes dominance as top1/top2', () => {
      const s = computeBudgetSignals([{ score: 0.9 }, { score: 0.45 }, { score: 0.3 }], {});
      expect(s.dominance).toBeCloseTo(2.0, 1);
    });

    it('reads breadth from grepMatches first, then candidatePoolSize (diagnostic only)', () => {
      const a = computeBudgetSignals([{ score: 0.9 }], { grepMatches: 100 });
      expect(a.breadth).toBe(100);
      const b = computeBudgetSignals([{ score: 0.9 }], { candidatePoolSize: 50 });
      expect(b.breadth).toBe(50);
      const c = computeBudgetSignals([{ score: 0.9 }], { grepMatches: 100, candidatePoolSize: 50 });
      expect(c.breadth).toBe(100); // grepMatches wins (matches allocateBudget contract)
    });

    it('falls back to lateInteractionScore when score is missing (colgrep)', () => {
      const s = computeBudgetSignals([{ lateInteractionScore: 0.8 }, { lateInteractionScore: 0.4 }], {});
      expect(s.numResults).toBe(2);
      expect(s.dominance).toBeCloseTo(2.0, 1);
    });

    it('computes top1Tokens from start/end lines × 9 tokens/line', () => {
      const s = computeBudgetSignals([{ score: 0.9, startLine: 10, endLine: 109 }], {});
      expect(s.top1LineCount).toBe(100);
      expect(s.top1Tokens).toBe(900); // 100 × 9
    });

    it('reads top-1 line range from metadata when present', () => {
      const s = computeBudgetSignals([{
        score: 0.9,
        metadata: { startLine: 1, endLine: 200 },
      }], {});
      expect(s.top1LineCount).toBe(200);
      expect(s.top1Tokens).toBe(1800);
    });

    it('returns top1Tokens=0 when start/end lines missing (auto-pick falls back to preview)', () => {
      const s = computeBudgetSignals([{ score: 0.9 }], {});
      expect(s.top1Tokens).toBe(0);
      expect(s.top1LineCount).toBe(0);
    });

    it('produces normalised entropy in [0, 1] (diagnostic only)', () => {
      const uniform = computeBudgetSignals([{ score: 0.5 }, { score: 0.5 }, { score: 0.5 }], {});
      expect(uniform.entropy).toBeGreaterThan(0.95); // near-1 for uniform
      const peaked = computeBudgetSignals([{ score: 0.99 }, { score: 0.005 }, { score: 0.005 }], {});
      expect(peaked.entropy).toBeLessThan(0.5); // near-0 for peaked
    });
  });

  describe('packageForAgent integration with auto-tier', () => {
    // makeResults defaults to small chunks (lineCount=21 → ~189 tokens),
    // well below the BIG_TOP1 threshold (2000 tokens). Override `lineCount`
    // to test the big-top-1 branch.
    const makeResults = (count, { scores, lineCount = 21 } = {}) => Array.from({ length: count }, (_, i) => ({
      id: `chunk${i}`,
      file: `src/file${i}.js`,
      startLine: 10,
      endLine: 10 + lineCount - 1,
      score: scores ? scores[i] : 0.9 - i * 0.15,
      lateInteractionScore: scores ? scores[i] : 0.9 - i * 0.15,
      metadata: { file: `src/file${i}.js`, name: `func${i}`, type: 'function', startLine: 10, endLine: 10 + lineCount - 1 },
    }));

    it('format=agent + 1 small result → preview', () => {
      const r = packageForAgent(makeResults(1), {}, {
        query: 'test', regex: 'test', format: 'agent', projectRoot: '/nonexistent',
      });
      expect(r.subMode).toBe('agent_preview');
      expect(r.tokenBudget).toBe(4000);
      expect(r.budgetReason).toBe('auto_preview_default');
    });

    it('format=agent + 1 huge result (300 lines) → xl', () => {
      const r = packageForAgent(makeResults(1, { lineCount: 300 }), {}, {
        query: 'test', regex: 'test', format: 'agent', projectRoot: '/nonexistent',
      });
      expect(r.subMode).toBe('agent_full_xl');
      expect(r.tokenBudget).toBe(12000);
      expect(r.budgetReason).toBe('auto_xl_single_huge');
    });

    it('format=agent + 5 moderately competitive small results → preview (was full, now preview)', () => {
      // Under the tight rule: dominance 1.2 isn't < 1.05 AND numResults < 10,
      // so full does NOT auto-fire. 4k is enough — agent can escalate manually.
      const r = packageForAgent(makeResults(5), {}, {
        query: 'test', regex: 'test', format: 'agent', projectRoot: '/nonexistent',
      });
      expect(r.subMode).toBe('agent_preview');
      expect(r.tokenBudget).toBe(4000);
      expect(r.budgetReason).toBe('auto_preview_default');
    });

    it('format=agent + dominant top-1 + small chunk → preview (NOT xl)', () => {
      // The original user-flagged regression case: small results, top1 >= 2*top2,
      // top-1 fits in 2k. Preview is correct.
      const r = packageForAgent(
        makeResults(5, { scores: [0.9, 0.4, 0.3, 0.2, 0.1] }),
        { grepMatches: 500 },
        { query: 'test', regex: 'test', format: 'agent', projectRoot: '/nonexistent' }
      );
      expect(r.subMode).toBe('agent_preview');
      expect(r.tokenBudget).toBe(4000);
      expect(r.budgetReason).toBe('auto_preview_default');
    });

    it('format=agent + dominant top-1 + big chunk → xl', () => {
      const r = packageForAgent(
        makeResults(5, { scores: [0.9, 0.3, 0.2, 0.1, 0.05], lineCount: 300 }),
        {},
        { query: 'test', regex: 'test', format: 'agent', projectRoot: '/nonexistent' }
      );
      expect(r.subMode).toBe('agent_full_xl');
      expect(r.budgetReason).toBe('auto_xl_dominant_huge_top1');
    });

    it('format=agent + 12 tightly-clustered results → full (rare case)', () => {
      // 12 results all within ~3% of top score → tight cluster → full.
      const tightScores = Array.from({ length: 12 }, (_, i) => 0.85 - i * 0.005);
      const r = packageForAgent(
        makeResults(12, { scores: tightScores, lineCount: 80 }),
        {},
        { query: 'test', regex: 'test', format: 'agent', projectRoot: '/nonexistent' }
      );
      expect(r.subMode).toBe('agent_full');
      expect(r.budgetReason).toBe('auto_full_tight_cluster');
    });

    it('format=agent_preview keeps explicit tier label regardless of signals', () => {
      const r = packageForAgent(makeResults(5, { lineCount: 400 }), { grepMatches: 1000 }, {
        query: 'test', regex: 'test', format: 'agent_preview', projectRoot: '/nonexistent',
      });
      expect(r.subMode).toBe('agent_preview');
      expect(r.budgetReason).toBe('explicit_preview');
    });

    it('"no-auto-budget" ablation falls back to legacy resolveSubMode', () => {
      const r = packageForAgent(makeResults(5), {}, {
        query: 'test', regex: 'test', format: 'agent', projectRoot: '/nonexistent',
        ablations: new Set(['no-auto-budget']),
      });
      expect(r.subMode).toBe('agent_preview'); // legacy: 'agent' → preview
      expect(r.budgetReason).toBe('ablation_no_auto_budget');
    });

    it('exposes budgetSignals in the response for diagnostics', () => {
      const r = packageForAgent(makeResults(3), { grepMatches: 42 }, {
        query: 'test', regex: 'test', format: 'agent', projectRoot: '/nonexistent',
      });
      expect(r.budgetSignals).toMatchObject({
        numResults: 3,
        breadth: 42,
        dominance: expect.any(Number),
        top1Tokens: expect.any(Number),
      });
    });

    it('ranking identity is preserved across auto-pick and explicit tiers', () => {
      const ranked = makeResults(3);
      const auto = packageForAgent(ranked, {}, { query: 't', regex: 't', format: 'agent', projectRoot: '/nonexistent' });
      const preview = packageForAgent(ranked, {}, { query: 't', regex: 't', format: 'agent_preview', projectRoot: '/nonexistent' });
      const full = packageForAgent(ranked, {}, { query: 't', regex: 't', format: 'agent_full', projectRoot: '/nonexistent' });

      // Same files in same order, same scores — auto-pick changes the BUDGET, not the RANKING.
      const tuple = (resp) => resp.results.map(r => `${r.file}:${r.startLine}:${r.score}`);
      expect(tuple(auto)).toEqual(tuple(preview));
      expect(tuple(auto)).toEqual(tuple(full));
    });
  });
});

// =============================================================================
// agent_full_xl stretch budget — opt-in, gated on top-1 dominance
// =============================================================================

describe('agent_full_xl stretch budget', () => {
  it('does not fire by default (agent or agent_preview format)', () => {
    const dominant = [{ score: 0.95 }, { score: 0.10 }, { score: 0.08 }];

    // agent_preview default: per-result top-1 cap is 2000, regardless of score gap
    const allocPreview = allocateBudget(4000, 3, 'agent_preview', { results: dominant });
    expect(allocPreview[0].tokenCap).toBeLessThanOrEqual(2000);

    // agent_full default: also capped at 2000
    const allocFull = allocateBudget(8000, 3, 'agent_full', { results: dominant });
    expect(allocFull[0].tokenCap).toBeLessThanOrEqual(2000);
  });

  it('fires only when subMode is agent_full_xl AND top1 >= 2 * top2', () => {
    const dominant = [{ score: 0.95 }, { score: 0.10 }, { score: 0.08 }];
    const alloc = allocateBudget(12000, 3, 'agent_full_xl', { results: dominant });

    // Gate fires: top1 (0.95) >= 2 * top2 (0.10), per-result cap raised to 8000
    expect(alloc[0].tokenCap).toBeGreaterThan(2000);
    expect(alloc[0].tokenCap).toBeLessThanOrEqual(8000);
  });

  it('falls back to agent_full caps when xl gate fails (top1/top2 < 2)', () => {
    // top1 = 0.6, top2 = 0.5: ratio 1.2 — gate fails.
    const close = [{ score: 0.6 }, { score: 0.5 }, { score: 0.4 }];
    const alloc = allocateBudget(12000, 3, 'agent_full_xl', { results: close });

    // Per-result cap stays at default (2000) when gate fails
    expect(alloc[0].tokenCap).toBeLessThanOrEqual(2000);
  });

  it('xl uses the 12k total budget when explicitly opted-in via format', () => {
    const dominant = [{ score: 0.9, file: 'a.js' }];
    const response = packageForAgent(dominant, {}, {
      query: 'test', regex: 'test',
      format: 'agent_full_xl',
      projectRoot: '/nonexistent',
    });
    expect(response.subMode).toBe('agent_full_xl');
    expect(response.tokenBudget).toBe(12000);
  });

  it('reports the caller-provided retrieval mode instead of hardcoding pattern', () => {
    const response = packageForAgent([{ score: 0.9, file: 'a.js' }], { path: 'hybrid' }, {
      query: 'test',
      regex: '',
      format: 'agent',
      mode: 'hybrid',
      projectRoot: '/nonexistent',
    });

    expect(response.mode).toBe('hybrid');
  });

  it('agent and agent_preview formats default to 4k budget', () => {
    const r = [{ score: 0.9, file: 'a.js' }];
    const responseA = packageForAgent(r, {}, { query: 't', regex: 't', format: 'agent', projectRoot: '/nonexistent' });
    const responseP = packageForAgent(r, {}, { query: 't', regex: 't', format: 'agent_preview', projectRoot: '/nonexistent' });
    expect(responseA.tokenBudget).toBe(4000);
    expect(responseP.tokenBudget).toBe(4000);
  });
});

// =============================================================================
// Generalized breadth signal (works for non-grep retrieval modes)
// =============================================================================

describe('generalized breadth signal', () => {
  it('uses candidatePoolSize when grepMatches is absent (lexical/semantic/hybrid)', () => {
    const broadSemantic = allocateBudget(4000, 3, 'agent_preview', {
      candidatePoolSize: 500, // broad: should sharpen on top-1
      results: [{ score: 0.9 }, { score: 0.6 }, { score: 0.5 }],
    });
    const narrowSemantic = allocateBudget(4000, 3, 'agent_preview', {
      candidatePoolSize: 5,
      results: [{ score: 0.9 }, { score: 0.6 }, { score: 0.5 }],
    });

    // Broad pool concentrates on top-1
    expect(broadSemantic[0].tokenCap).toBeGreaterThanOrEqual(narrowSemantic[0].tokenCap);
    // ...at the cost of rank-2/3
    expect(broadSemantic[1].tokenCap).toBeLessThanOrEqual(narrowSemantic[1].tokenCap);
  });

  it('grepMatches still wins when present (colgrep behavior preserved)', () => {
    // Broad colgrep retrieval (grepMatches=500). Effects: top1Share=0.70, top23Share=0.15.
    const colgrepBroad = allocateBudget(4000, 3, 'agent_preview', {
      grepMatches: 500,
      candidatePoolSize: 5, // should be ignored — grepMatches wins
      results: [{ score: 0.9 }, { score: 0.6 }, { score: 0.5 }],
    });
    // Narrow retrieval (everything small). Effects: top1Share=0.60, top23Share=0.20.
    const narrow = allocateBudget(4000, 3, 'agent_preview', {
      grepMatches: 5,
      candidatePoolSize: 5,
      results: [{ score: 0.9 }, { score: 0.6 }, { score: 0.5 }],
    });

    // The broad/narrow distinction shows up at rank-2 (top-1 hard-caps at 2000):
    //   broad rank-2 cap = floor(4000*0.15) = 600
    //   narrow rank-2 cap = floor(4000*0.20) = 800
    expect(colgrepBroad[1].tokenCap).toBeLessThan(narrow[1].tokenCap);
  });
});

// =============================================================================
// Symbol sandwich integration — exercises the full packageForAgent flow
// against a real on-disk file so readFileRange works end-to-end.
// =============================================================================

describe('symbol sandwich rendering (integration)', () => {
  let tmpRoot;
  const filename = 'huge-fn.js';

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sandwich-test-'));
    // 1000-line file. Lines 1-3 are the signature, line 1000 is the closing brace.
    // Lines 500-510 are a distinctive "gold" region containing GOLD_MARKER.
    const lines = [];
    lines.push('export function processOrders(input, options) {'); // 1
    lines.push('  const { strict = false } = options || {};');     // 2
    lines.push('  let total = 0;');                                  // 3
    for (let i = 4; i <= 499; i++) {
      lines.push(`  // filler line ${i} — ${'x'.repeat(20)}`);
    }
    // Gold region 500-510
    lines.push('  if (input.kind === "refund") {');                  // 500
    lines.push('    // GOLD_MARKER: refund branch begins');          // 501
    lines.push('    const refundAmount = computeRefund(input);');    // 502
    lines.push('    if (refundAmount > options.maxRefund) {');       // 503
    lines.push('      throw new RefundLimitExceeded(refundAmount);');// 504
    lines.push('    }');                                              // 505
    lines.push('    total -= refundAmount;');                        // 506
    lines.push('    return { ok: true, total, refunded: true };');   // 507
    lines.push('  }');                                                // 508
    lines.push('  // GOLD_MARKER: end of refund branch');            // 509
    lines.push('');                                                   // 510
    for (let i = 511; i <= 999; i++) {
      lines.push(`  // filler line ${i} — ${'y'.repeat(20)}`);
    }
    lines.push('}');                                                  // 1000
    writeFileSync(join(tmpRoot, filename), lines.join('\n'), 'utf8');
  });

  afterAll(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeCodeGraphRepo(entityRange = { start: 1, end: 1000 }) {
    return {
      findEnclosingEntity: () => ({
        name: 'processOrders',
        type: 'function',
        startLine: entityRange.start,
        endLine: entityRange.end,
        parentClass: null,
      }),
      // packageForAgent calls these for staleness / index info; safe stubs.
      getFileIndexInfo: () => null,
      getDbMtime: () => null,
    };
  }

  it('preserves the gold chunk verbatim and includes signature + closing', () => {
    // Gold chunk: lines 500-510 (the refund branch). Entity: 1-1000.
    // tokenCap = 1500: comfortable fit for sig (30) + gold (~110) + closing (10) + 2 elisions.
    const rankedResults = [{
      file: filename,
      startLine: 500,
      endLine: 510,
      score: 0.95,
      lateInteractionScore: 0.95,
      metadata: {
        file: filename,
        startLine: 500,
        endLine: 510,
        name: null,
        type: 'code',
      },
    }];

    const response = packageForAgent(rankedResults, { grepMatches: 1 }, {
      query: 'refund branch',
      regex: 'refund',
      format: 'agent_full',
      tokenBudget: 1500,
      projectRoot: tmpRoot,
      codeGraphRepo: makeCodeGraphRepo(),
    });

    expect(response.results).toHaveLength(1);
    const r = response.results[0];

    // Sandwich was used
    expect(r.expansionKind).toBe('sandwich');
    expect(r.sandwich).toBeDefined();
    expect(r.sandwich.partKinds).toContain('signature');
    expect(r.sandwich.partKinds).toContain('gold');
    expect(r.sandwich.partKinds).toContain('closing');

    // Gold content preserved verbatim — every gold line is in the rendered code
    expect(r.code).toContain('GOLD_MARKER: refund branch begins');
    expect(r.code).toContain('GOLD_MARKER: end of refund branch');
    expect(r.code).toContain('throw new RefundLimitExceeded');
    expect(r.code).toContain('return { ok: true, total, refunded: true };');

    // Signature is included
    expect(r.code).toContain('export function processOrders');

    // Closing brace
    expect(r.code).toMatch(/\}\s*$/);

    // Elision markers are present and indicate the right gap sizes
    expect(r.code).toMatch(/\/\/ \.\.\. \(\d+ lines elided\)/);
    expect(r.sandwich.elisionMarkers).toBe(2);
    expect(r.sandwich.elidedHead).toBeGreaterThan(400); // ~496 lines between sig and gold
    expect(r.sandwich.elidedTail).toBeGreaterThan(400); // ~489 lines between gold and closing

    // Fits within the token cap (allow some tolerance for the 10-tokens/line estimate)
    expect(r.codeTokens).toBeLessThanOrEqual(1500 * 1.1);
  });

  it('falls back to bare gold when assembled sandwich would exceed cap', () => {
    // Gold chunk: 100 lines (~1000 tokens). cap = 800 → goldTokens > tokenCap → no sandwich.
    const rankedResults = [{
      file: filename,
      startLine: 400,
      endLine: 499,
      score: 0.9,
      metadata: {
        file: filename,
        startLine: 400,
        endLine: 499,
        name: null,
        type: 'code',
      },
    }];

    const response = packageForAgent(rankedResults, {}, {
      query: 'filler',
      regex: 'filler',
      format: 'agent_full',
      tokenBudget: 800,
      projectRoot: tmpRoot,
      codeGraphRepo: makeCodeGraphRepo(),
    });

    const r = response.results[0];
    // Sandwich was not used (gold itself doesn't fit in the cap)
    expect(r.expansionKind).toBe('chunk');
    expect(r.sandwich).toBeUndefined();
    // Some content was still returned, fits cap
    expect(r.code).toBeDefined();
    expect(r.codeTokens).toBeLessThanOrEqual(800);
  });

  it('does not regress: small-function full expansion still works', () => {
    // Small function (entity 1-30, fits in 800-token cap with room).
    const rankedResults = [{
      file: filename,
      startLine: 5,
      endLine: 8,
      score: 0.9,
      metadata: { file: filename, startLine: 5, endLine: 8, name: null, type: 'code' },
    }];

    const response = packageForAgent(rankedResults, {}, {
      query: 'whatever',
      regex: 'filler',
      format: 'agent_full',
      tokenBudget: 800,
      projectRoot: tmpRoot,
      codeGraphRepo: makeCodeGraphRepo({ start: 1, end: 30 }),
    });

    const r = response.results[0];
    // Small entity fits → 'full' expansion (whole entity), not sandwich
    expect(r.expansionKind).toBe('full');
    expect(r.sandwich).toBeUndefined();
    expect(r.expanded).toBe(true);
  });

  it('no-match (empty results) behavior is unchanged', () => {
    const response = packageForAgent([], {}, {
      query: 'nothing matches',
      regex: 'NOMATCH',
      format: 'agent_full',
      tokenBudget: 4000,
      projectRoot: tmpRoot,
    });
    expect(response.format).toBe('agent');
    expect(response.totalResults).toBe(0);
    expect(response.results).toEqual([]);
  });
});
