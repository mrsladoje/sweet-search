import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, statSync } from 'fs';
import {
  QualityScorer,
  scoreTestProximity,
  scoreCommentDensity,
  scoreComplexity,
  scoreSizePreference,
  scoreRecency,
  clearRecencyCache,
  clearTestProximityCache,
  setRepoMapModule,
} from '../../core/ranking/quality-scorer.js';

// ---------------------------------------------------------------------------
// Mock fs.existsSync for test proximity checks
// ---------------------------------------------------------------------------

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn((p) => {
      // Simulate: /src/foo.test.js exists, /src/__tests__/foo.test.js exists
      if (typeof p === 'string') {
        if (p.includes('with-test.test.js')) return true;
        if (p.includes('__tests__/has-dir.test.js')) return true;
      }
      // Default: delegate to real check for quality-scorer.js itself (DB path)
      return actual.existsSync(p);
    }),
    statSync: vi.fn((p) => actual.statSync(p)),
  };
});

// ---------------------------------------------------------------------------
// Mock repo-map module for centrality tests
// ---------------------------------------------------------------------------

function makeMockRepoMap(entities = [], relationships = []) {
  return {
    loadGraph: () => ({ entities, relationships }),
    buildAdjacency: (graph) => {
      const allNodes = new Set(graph.entities.map(e => e.id));
      const outEdges = new Map();
      const entityMap = new Map();
      for (const ent of graph.entities) {
        entityMap.set(ent.id, ent);
      }
      for (const rel of graph.relationships) {
        if (!outEdges.has(rel.source_id)) outEdges.set(rel.source_id, new Set());
        outEdges.get(rel.source_id).add(rel.target_id);
      }
      return { outEdges, allNodes, entityMap };
    },
    pageRank: (outEdges, allNodes) => {
      // Simple mock: nodes with more in-edges get higher score
      const scores = new Map();
      for (const node of allNodes) scores.set(node, 1 / allNodes.size);
      return scores;
    },
  };
}

// ---------------------------------------------------------------------------
// Test proximity
// ---------------------------------------------------------------------------

describe('scoreTestProximity', () => {
  it('returns 1.0 for test files themselves', () => {
    expect(scoreTestProximity('/src/foo.test.js')).toBe(1.0);
    expect(scoreTestProximity('/src/foo.spec.ts')).toBe(1.0);
  });

  it('returns 1.0 for files inside test directories', () => {
    expect(scoreTestProximity('/project/__tests__/bar.js')).toBe(1.0);
    expect(scoreTestProximity('/project/tests/baz.js')).toBe(1.0);
  });

  it('returns 1.0 when sibling test file exists', () => {
    // Mock makes /src/with-test.test.js exist
    expect(scoreTestProximity('/src/with-test.js')).toBe(1.0);
  });

  it('returns 0.3 when no test file found', () => {
    expect(scoreTestProximity('/src/no-test-here.js')).toBe(0.3);
  });

  it('returns 0.3 for empty/null path', () => {
    expect(scoreTestProximity('')).toBe(0.3);
    expect(scoreTestProximity(null)).toBe(0.3);
    expect(scoreTestProximity(undefined)).toBe(0.3);
  });

  it('caches results (no duplicate existsSync calls for same path)', () => {
    clearTestProximityCache();
    vi.mocked(existsSync).mockClear();

    const score1 = scoreTestProximity('/src/cache-test-file.js');
    const callsAfterFirst = vi.mocked(existsSync).mock.calls.length;

    const score2 = scoreTestProximity('/src/cache-test-file.js');
    const callsAfterSecond = vi.mocked(existsSync).mock.calls.length;

    expect(score1).toBe(score2);
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// Comment density
// ---------------------------------------------------------------------------

describe('scoreCommentDensity', () => {
  it('returns 0 for empty text', () => {
    expect(scoreCommentDensity('')).toBe(0);
    expect(scoreCommentDensity(null)).toBe(0);
  });

  it('returns 0 for code-only text', () => {
    expect(scoreCommentDensity('const x = 1;\nconst y = 2;')).toBe(0);
  });

  it('scores comment-heavy text near 1.0', () => {
    const text = '// line 1\n// line 2\n// line 3\nconst x = 1;';
    // 3/4 = 0.75, * 3 = 2.25 → clamped to 1.0
    expect(scoreCommentDensity(text)).toBe(1);
  });

  it('scores partial comments proportionally', () => {
    const text = '// comment\ncode\ncode\ncode\ncode\ncode';
    // 1/6 ≈ 0.167, * 3 ≈ 0.5
    const score = scoreCommentDensity(text);
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(0.6);
  });

  it('recognizes different comment styles', () => {
    expect(scoreCommentDensity('# python comment')).toBe(1);
    expect(scoreCommentDensity('/* C block */')).toBe(1);
    expect(scoreCommentDensity(' * JSDoc line')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Complexity
// ---------------------------------------------------------------------------

describe('scoreComplexity', () => {
  it('returns 1 for empty/null text (no complexity)', () => {
    expect(scoreComplexity('')).toBe(1);
    expect(scoreComplexity(null)).toBe(1);
  });

  it('returns 1 for simple code', () => {
    expect(scoreComplexity('const x = 1;\nreturn x;')).toBe(1);
  });

  it('penalizes branching keywords', () => {
    const text = 'if (a) { } else if (b) { } else { }';
    // 3 keywords: if, else, if → 3/20 = 0.15 → 1 - 0.15 = 0.85
    const score = scoreComplexity(text);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns near 0 for highly complex code', () => {
    const branches = Array(25).fill('if (x) {} else {}').join('\n');
    const score = scoreComplexity(branches);
    expect(score).toBeLessThanOrEqual(0.1);
  });

  it('counts logical operators', () => {
    const text = 'if (a && b || c && d) { }';
    // if + && + || + && = 4 → 4/20 = 0.2 → 0.8
    const score = scoreComplexity(text);
    expect(score).toBeCloseTo(0.8, 1);
  });

  it('counts ternary operator', () => {
    const text = 'const x = a ? b : c;';
    // ? = 1 → 1/20 = 0.05 → 0.95
    expect(scoreComplexity(text)).toBeCloseTo(0.95, 1);
  });
});

// ---------------------------------------------------------------------------
// Size preference
// ---------------------------------------------------------------------------

describe('scoreSizePreference', () => {
  it('returns 0.3 for empty/null', () => {
    expect(scoreSizePreference('')).toBe(0.3);
    expect(scoreSizePreference(null)).toBe(0.3);
  });

  it('returns 1.0 for medium chunks (100-500 chars)', () => {
    expect(scoreSizePreference('a'.repeat(100))).toBe(1.0);
    expect(scoreSizePreference('a'.repeat(300))).toBe(1.0);
    expect(scoreSizePreference('a'.repeat(500))).toBe(1.0);
  });

  it('decays for very short chunks', () => {
    const score = scoreSizePreference('a'.repeat(50));
    // 50/100 * 0.7 + 0.3 = 0.65
    expect(score).toBeCloseTo(0.65, 1);
  });

  it('decays for very large chunks', () => {
    const score = scoreSizePreference('a'.repeat(1000));
    expect(score).toBeLessThan(1.0);
    expect(score).toBeGreaterThan(0.3);
  });

  it('floors at 0.3 for extremely large chunks', () => {
    const score = scoreSizePreference('a'.repeat(5000));
    expect(score).toBeCloseTo(0.3, 1);
  });
});

// ---------------------------------------------------------------------------
// Recency (git blame last-modified date)
// ---------------------------------------------------------------------------

describe('scoreRecency', () => {
  beforeEach(() => {
    clearRecencyCache();
    vi.mocked(statSync).mockReset();
  });

  it('returns 0.5 when stat fails (file not found)', () => {
    vi.mocked(statSync).mockImplementation(() => { throw new Error('ENOENT: no such file'); });
    expect(scoreRecency('/some/random/file.js')).toBe(0.5);
  });

  it('returns 0.5 for empty/null path', () => {
    expect(scoreRecency('')).toBe(0.5);
    expect(scoreRecency(null)).toBe(0.5);
    expect(scoreRecency(undefined)).toBe(0.5);
  });

  it('returns high score for recently modified file', () => {
    const oneDayAgoMs = Date.now() - 86_400_000;
    vi.mocked(statSync).mockReturnValue({ mtimeMs: oneDayAgoMs });

    const score = scoreRecency('/src/recent.js');
    // 1 day / 365 ≈ 0.003, so score ≈ 0.997
    expect(score).toBeGreaterThan(0.99);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('returns low score for old file', () => {
    const oldMs = Date.now() - 300 * 86_400_000;
    vi.mocked(statSync).mockReturnValue({ mtimeMs: oldMs });

    const score = scoreRecency('/src/old.js');
    // 300/365 ≈ 0.822, so score ≈ 0.178
    expect(score).toBeGreaterThanOrEqual(0.1);
    expect(score).toBeLessThan(0.3);
  });

  it('floors at 0.1 for very old files', () => {
    const veryOldMs = Date.now() - 730 * 86_400_000;
    vi.mocked(statSync).mockReturnValue({ mtimeMs: veryOldMs });

    const score = scoreRecency('/src/ancient.js');
    expect(score).toBe(0.1);
  });

  it('caches results per file path', () => {
    const recentMs = Date.now() - 86_400_000;
    vi.mocked(statSync).mockReturnValue({ mtimeMs: recentMs });

    const score1 = scoreRecency('/src/cached-file.js');
    const score2 = scoreRecency('/src/cached-file.js');

    expect(score1).toBe(score2);
    // statSync should only be called once due to caching
    expect(statSync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// QualityScorer class
// ---------------------------------------------------------------------------

describe('QualityScorer', () => {
  let scorer;

  beforeEach(() => {
    // Create scorer without DB (centrality will be 0)
    scorer = new QualityScorer({ dbPath: '/nonexistent/path.db' });
  });

  describe('scoreChunk', () => {
    it('returns score in 0-1 range', () => {
      const { score } = scorer.scoreChunk({
        file: '/src/no-test.js',
        content: 'const x = 1;',
      });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('returns all six factors', () => {
      const { factors } = scorer.scoreChunk({
        file: '/src/app.js',
        content: 'function hello() { return "hi"; }',
      });
      expect(factors).toHaveProperty('testProximity');
      expect(factors).toHaveProperty('recency');
      expect(factors).toHaveProperty('centrality');
      expect(factors).toHaveProperty('commentDensity');
      expect(factors).toHaveProperty('complexity');
      expect(factors).toHaveProperty('sizeScore');
    });

    it('handles empty chunk', () => {
      const { score, factors } = scorer.scoreChunk({});
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(factors.commentDensity).toBe(0);
      expect(factors.complexity).toBe(1);
      expect(factors.sizeScore).toBe(0.3);
    });

    it('scores well-documented medium-sized simple code higher', () => {
      const good = scorer.scoreChunk({
        file: '/src/with-test.js',
        content: '// Calculate total price\n' + 'a'.repeat(200),
      });
      const bad = scorer.scoreChunk({
        file: '/src/no-test.js',
        content: 'if(a&&b||c){try{for(let i=0;i<n;i++){while(x){switch(y){case 1:if(z){}}}}}catch(e){}}',
      });
      expect(good.score).toBeGreaterThan(bad.score);
    });
  });

  describe('scoreResults', () => {
    it('returns empty array for empty input', () => {
      expect(scorer.scoreResults([])).toEqual([]);
    });

    it('returns original array for null/undefined', () => {
      expect(scorer.scoreResults(null)).toBe(null);
      expect(scorer.scoreResults(undefined)).toBe(undefined);
    });

    it('adds quality_score and quality_factors to each result', () => {
      const results = [
        { file: '/src/a.js', content: 'const a = 1;', score: 0.9 },
        { file: '/src/b.js', content: 'const b = 2;', score: 0.8 },
      ];
      const scored = scorer.scoreResults(results);
      expect(scored).toHaveLength(2);
      for (const r of scored) {
        expect(r).toHaveProperty('quality_score');
        expect(r).toHaveProperty('quality_factors');
        expect(r.quality_score).toBeGreaterThanOrEqual(0);
        expect(r.quality_score).toBeLessThanOrEqual(1);
      }
    });

    it('preserves original result properties', () => {
      const results = [{ file: '/src/x.js', content: 'x', score: 0.5, name: 'myFn' }];
      const scored = scorer.scoreResults(results);
      expect(scored[0].file).toBe('/src/x.js');
      expect(scored[0].score).toBe(0.5);
      expect(scored[0].name).toBe('myFn');
    });

    it('handles results with text instead of content', () => {
      const results = [{ file: '/src/y.js', text: 'some code here' }];
      const scored = scorer.scoreResults(results);
      expect(scored[0].quality_score).toBeGreaterThan(0);
    });

    it('handles large batch of results', () => {
      const results = Array.from({ length: 100 }, (_, i) => ({
        file: `/src/file${i}.js`,
        content: `function f${i}() { return ${i}; }`,
        score: Math.random(),
      }));
      const scored = scorer.scoreResults(results);
      expect(scored).toHaveLength(100);
      for (const r of scored) {
        expect(r.quality_score).toBeGreaterThanOrEqual(0);
        expect(r.quality_score).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('centrality with mock graph', () => {
    it('uses PageRank scores when graph is available', () => {
      const entities = [
        { id: '1', file_path: '/src/core.js', name: 'CoreClass', type: 'class', start_line: 1 },
        { id: '2', file_path: '/src/util.js', name: 'helper', type: 'function', start_line: 5 },
      ];
      const relationships = [
        { source_id: '2', target_id: '1', type: 'calls' },
      ];

      setRepoMapModule(makeMockRepoMap(entities, relationships));

      const graphScorer = new QualityScorer({ dbPath: '/fake/code-graph.db' });
      // Force _ensurePageRank to use our mock (existsSync returns true for .db)
      graphScorer._pageRankLoaded = false;

      // Manually set up the page rank data
      graphScorer._pageRankScores = new Map([['1', 1.0], ['2', 0.5]]);
      graphScorer._pageRankEntityMap = new Map([
        ['1', entities[0]],
        ['2', entities[1]],
      ]);
      graphScorer._pageRankLoaded = true;

      const { factors } = graphScorer.scoreChunk({
        file: '/src/core.js',
        name: 'CoreClass',
        content: 'class CoreClass {}',
      });
      expect(factors.centrality).toBe(1.0);

      const { factors: f2 } = graphScorer.scoreChunk({
        file: '/src/util.js',
        name: 'helper',
        content: 'function helper() {}',
      });
      expect(f2.centrality).toBe(0.5);
    });

    it('returns 0 centrality when graph is not available', () => {
      const noGraphScorer = new QualityScorer({ dbPath: '/nonexistent.db' });
      const { factors } = noGraphScorer.scoreChunk({
        file: '/src/orphan.js',
        content: 'const x = 1;',
      });
      expect(factors.centrality).toBe(0);
    });
  });

  describe('custom weights', () => {
    it('respects custom weight overrides', () => {
      const allComplexity = new QualityScorer({
        dbPath: '/nonexistent.db',
        weights: {
          testProximity: 0,
          recency: 0,
          centrality: 0,
          commentDensity: 0,
          complexity: 1.0,
          sizeScore: 0,
        },
      });

      // Simple code → complexity = 1.0, so total = 1.0
      const { score } = allComplexity.scoreChunk({
        file: '/x.js',
        content: 'return 42;',
      });
      expect(score).toBeCloseTo(1.0, 1);

      // Complex code → lower score
      const { score: complex } = allComplexity.scoreChunk({
        file: '/x.js',
        content: Array(25).fill('if (x) {} else {}').join('\n'),
      });
      expect(complex).toBeLessThan(0.2);
    });
  });

  describe('score range validation', () => {
    it('all scores are always 0-1 regardless of input', () => {
      const edgeCases = [
        {},
        { content: '' },
        { content: 'a' },
        { content: 'a'.repeat(10000) },
        { content: Array(50).fill('if(a&&b||c){try{}catch(e){for(;;){while(1){switch(x){case 1:}}}}}').join('\n') },
        { file: null, content: null },
        { file: '/test.test.js', content: '// all comments\n// more\n// and more' },
      ];

      for (const chunk of edgeCases) {
        const { score, factors } = scorer.scoreChunk(chunk);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        for (const [key, val] of Object.entries(factors)) {
          expect(val).toBeGreaterThanOrEqual(0);
          expect(val).toBeLessThanOrEqual(1);
        }
      }
    });
  });
});
