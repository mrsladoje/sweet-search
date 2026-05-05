import { describe, it, expect } from 'vitest';
import {
  extractContentKeywords,
  shouldRunFallback,
  fuseRRF,
  runRRFFallback,
} from '../../core/search/search-rrf.js';

// ---------------------------------------------------------------------------
// extractContentKeywords — drops question scaffolding only, keeps content
// ---------------------------------------------------------------------------

describe('extractContentKeywords (RRF)', () => {
  it('drops question scaffolding ("how", "does", "the")', () => {
    const out = extractContentKeywords('how does Fastify compile route schemas at registration time');
    expect(out).not.toContain('how');
    expect(out).not.toContain('does');
    expect(out).not.toContain('the');
    expect(out).not.toContain('at');
  });

  it('keeps GENERIC English nouns that may carry signal (RRF handles noise)', () => {
    // Crucial anti-overfit assertion: "time", "mode", "state", "data"
    // can be the actual concept. RRF will demote them naturally if they
    // only match noise; we don't drop them at the input layer.
    const out = extractContentKeywords('what is the request timeout time and Mode state for data');
    expect(out).toContain('time');
    expect(out).toContain('Mode');
    expect(out).toContain('state');
    expect(out).toContain('data');
  });

  it('dedupes case-insensitively', () => {
    const out = extractContentKeywords('compile Compile COMPILE');
    expect(out).toHaveLength(1);
  });

  it('drops <3-char tokens', () => {
    const out = extractContentKeywords('on of in the to is');
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shouldRunFallback — same triggers as before
// ---------------------------------------------------------------------------

describe('shouldRunFallback', () => {
  it('returns "empty" on empty list', () => {
    expect(shouldRunFallback([])).toBe('empty');
  });

  it('returns "low_confidence" when top-1 < floor', () => {
    expect(shouldRunFallback([{ score: 0.20, file: 'lib/x.js' }])).toBe('low_confidence');
  });

  it('returns "no_source_in_top3" when top-3 has no implementation', () => {
    const r = [
      { score: 0.6, file: 'docs/Hooks.md' },
      { score: 0.5, file: 'types/x.d.ts' },
      { score: 0.4, file: 'test/foo.test.js' },
    ];
    expect(shouldRunFallback(r)).toBe('no_source_in_top3');
  });

  it('returns null when top-1 is a strong source result', () => {
    expect(shouldRunFallback([{ score: 0.7, file: 'lib/server.js' }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fuseRRF — the actual Cormack 2009 mechanics
// ---------------------------------------------------------------------------

describe('fuseRRF', () => {
  it('chunks matching MULTIPLE keywords beat single-keyword rank-1 hits', () => {
    // The Q4 canary: a chunk that matches "compile" rank 4 + "schemas"
    // rank 3 must outscore a chunk that matches "time" rank 1 only.
    // RRF score formula: sum(1 / (60 + rank)) per keyword hit.
    //   compile@4 + schemas@3 = 1/64 + 1/63 = 0.01563 + 0.01587 = 0.03150
    //   time@1                = 1/61                          = 0.01639
    //
    // Without RRF (raw BM25 sum), "time"-matched code can win. RRF's
    // anti-noise property is exactly the rank-curve flattening that makes
    // multi-keyword matches dominate single-keyword rank-1 noise.
    const compileResults = [
      { id: 'c4', file: 'a.js', metadata: { file: 'a.js', startLine: 1, endLine: 5 } },
      { id: 'c5', file: 'b.js', metadata: { file: 'b.js', startLine: 1, endLine: 5 } },
      { id: 'c6', file: 'c.js', metadata: { file: 'c.js', startLine: 1, endLine: 5 } },
      { id: 'compileSchemas', file: 'lib/validation.js', metadata: { file: 'lib/validation.js', startLine: 57, endLine: 116 } },
    ];
    const schemasResults = [
      { id: 's1', file: 'd.js', metadata: { file: 'd.js', startLine: 1, endLine: 5 } },
      { id: 's2', file: 'e.js', metadata: { file: 'e.js', startLine: 1, endLine: 5 } },
      { id: 'compileSchemas', file: 'lib/validation.js', metadata: { file: 'lib/validation.js', startLine: 57, endLine: 116 } },
    ];
    const timeResults = [
      { id: 'setTimeout', file: 'test/handlers.test.js', metadata: { file: 'test/handlers.test.js', startLine: 1, endLine: 10 } },
      { id: 't2', file: 'test/x.test.js', metadata: { file: 'test/x.test.js', startLine: 1, endLine: 10 } },
    ];

    const fused = fuseRRF([compileResults, schemasResults, timeResults]);
    const compileSchemas = fused.get('lib/validation.js|57|116');
    const setTimeoutEntry = fused.get('test/handlers.test.js|1|10');

    expect(compileSchemas).toBeTruthy();
    expect(setTimeoutEntry).toBeTruthy();
    // RRF math: compileSchemas hits compile@4 + schemas@3
    // = 1/64 + 1/63 = ~0.0315
    // setTimeout hits time@1 only = 1/61 = ~0.0164
    expect(compileSchemas.rrf).toBeGreaterThan(setTimeoutEntry.rrf);
    expect(compileSchemas.keywordsHit.size).toBe(2);
    expect(setTimeoutEntry.keywordsHit.size).toBe(1);
  });

  it('a single-keyword rank-1 hit DOES beat a single-keyword rank-N hit', () => {
    const aResults = [
      { id: 'top1a', file: 'a.js', metadata: { file: 'a.js', startLine: 1, endLine: 5 } },
    ];
    const bResults = [];
    for (let i = 1; i <= 30; i++) {
      bResults.push({ id: `b${i}`, file: `b${i}.js`, metadata: { file: `b${i}.js`, startLine: 1, endLine: 5 } });
    }
    bResults.push({ id: 'top1a', file: 'a.js', metadata: { file: 'a.js', startLine: 1, endLine: 5 } });
    // top1a is rank 1 in aResults (RRF: 1/61) AND rank 31 in bResults (RRF: 1/91)
    // → total ~0.0274
    // Compared with a chunk only at rank 1 of bResults (1/61 = 0.0164)
    const fused = fuseRRF([aResults, bResults]);
    const top1a = fused.get('a.js|1|5');
    const b1 = fused.get('b1.js|1|5');
    expect(top1a.rrf).toBeGreaterThan(b1.rrf);
  });
});

// ---------------------------------------------------------------------------
// runRRFFallback — end-to-end with mocked graph search
// ---------------------------------------------------------------------------

function mockSearcher(perKeywordResultsByQuery) {
  return {
    graphSearch: {
      bm25SearchRaw: async (query) => ({
        results: perKeywordResultsByQuery[query] || [],
        latency: 1,
      }),
    },
  };
}

describe('runRRFFallback', () => {
  it('does nothing when results are strong (top-1 source, score above floor)', async () => {
    const existing = [{ score: 0.7, file: 'lib/server.js' }];
    const out = await runRRFFallback(existing, 'create http server', {
      searcher: mockSearcher({}),
    });
    expect(out.results).toBe(existing);
    expect(out.stats.reason).toBeNull();
    expect(out.stats.injected).toBe(0);
  });

  it('injects RRF candidates when initial results are empty', async () => {
    const compileSchemas = {
      id: 'cs', file: 'lib/validation.js',
      metadata: { file: 'lib/validation.js', startLine: 57, endLine: 116, name: 'compileSchemasForValidation' },
    };
    const noiseTime = {
      id: 'st', file: 'test/handlers.test.js',
      metadata: { file: 'test/handlers.test.js', startLine: 1, endLine: 10, name: 'setTimeout' },
    };
    const out = await runRRFFallback([], 'how does Fastify compile route schemas at registration time', {
      searcher: mockSearcher({
        Fastify: [],                                                  // empty
        compile: [{ ...compileSchemas }, { id: 'x' }, { id: 'y' }, { id: 'z' }],
        route: [],
        schemas: [{ id: 'a' }, { id: 'b' }, { ...compileSchemas }],   // rank 3
        registration: [],
        time: [{ ...noiseTime }],                                     // rank 1
      }),
    });
    expect(out.stats.reason).toBe('empty');
    expect(out.stats.injected).toBeGreaterThan(0);
    // Critical: compileSchemas (2 keyword hits) must rank above setTimeout (1 hit)
    const idxCS = out.results.findIndex(r => r.metadata?.name === 'compileSchemasForValidation');
    const idxST = out.results.findIndex(r => r.metadata?.name === 'setTimeout');
    expect(idxCS).toBeLessThan(idxST);
    expect(idxCS).toBeGreaterThanOrEqual(0);
  });

  it('boosts existing entries instead of double-adding', async () => {
    const cs = {
      id: 'cs',
      score: 0.20,
      file: 'lib/validation.js',
      metadata: { file: 'lib/validation.js', startLine: 57, endLine: 116, name: 'compileSchemasForValidation' },
    };
    const out = await runRRFFallback([cs], 'how does Fastify compile schemas registration', {
      searcher: mockSearcher({
        Fastify: [],
        compile: [{ ...cs }],
        schemas: [{ ...cs }],
        registration: [],
      }),
    });
    expect(out.stats.boosted).toBe(1);
    expect(out.stats.injected).toBe(0);
    expect(out.results.length).toBe(1);
    expect(out.results[0].score).toBeGreaterThan(0.20);
    expect(out.results[0]._rrfBoosted).toBe(true);
  });

  it('honours no-rrf-fallback ablation', async () => {
    const out = await runRRFFallback([], 'compile schemas', {
      searcher: mockSearcher({
        compile: [{ id: 'a', file: 'a.js', metadata: { file: 'a.js', startLine: 1, endLine: 5 } }],
        schemas: [{ id: 'a', file: 'a.js', metadata: { file: 'a.js', startLine: 1, endLine: 5 } }],
      }),
      ablations: new Set(['no-rrf-fallback']),
    });
    expect(out.results).toEqual([]);
    expect(out.stats.reason).toBeNull();
  });

  it('returns existing list unchanged when query has <2 content keywords', async () => {
    const existing = [{ score: 0.2, file: 'docs/x.md' }];
    const out = await runRRFFallback(existing, 'how is it', {
      searcher: mockSearcher({}),
    });
    expect(out.stats.injected).toBe(0);
    expect(out.results).toBe(existing);
  });

  it('handles graphSearch returning empty across all keywords', async () => {
    const out = await runRRFFallback([], 'compile schemas registration time', {
      searcher: mockSearcher({}),
    });
    expect(out.stats.reason).toBe('empty');
    expect(out.stats.injected).toBe(0);
    expect(out.results).toEqual([]);
  });

  it('does NOT overfit on generic English nouns — "time" alone with one hit doesn\'t win', async () => {
    // Anti-overfit canary: a query "request timeout time" has 3 content
    // keywords. If "time" matches setTimeout at rank 1 but no other
    // keyword does, RRF score for setTimeout = 1/61 = 0.0164. Any chunk
    // matching 2+ keywords at any rank beats it. This test directly
    // verifies we did NOT need a stopword list to handle this.
    const setTimeoutItem = {
      id: 'st', file: 'test/x.test.js',
      metadata: { file: 'test/x.test.js', startLine: 1, endLine: 10, name: 'setTimeout' },
    };
    const realAnswer = {
      id: 'rt', file: 'lib/timeout.js',
      metadata: { file: 'lib/timeout.js', startLine: 5, endLine: 30, name: 'requestTimeout' },
    };
    const out = await runRRFFallback([], 'request timeout time', {
      searcher: mockSearcher({
        request: [{ ...realAnswer }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }, { id: 'r5' }],
        timeout: [{ ...realAnswer }],
        time: [{ ...setTimeoutItem }],
      }),
    });
    const idxReal = out.results.findIndex(r => r.metadata?.name === 'requestTimeout');
    const idxNoise = out.results.findIndex(r => r.metadata?.name === 'setTimeout');
    expect(idxReal).toBeGreaterThanOrEqual(0);
    expect(idxNoise).toBeGreaterThanOrEqual(0);
    expect(idxReal).toBeLessThan(idxNoise);
  });
});
