import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { dedupeIdenticalSpans, displaySpan, takeDistinctSpans } from '../../core/search/span-dedupe.js';
import { computeSpanSimilarity, applyFinalListMMR, hasRedundantPair, SPAN_MMR_WEIGHTS, CONTENT_MMR_WEIGHTS } from '../../core/ranking/mmr.js';
import { shapeFinalList, finalMMRSettings, FINAL_MMR_WEIGHT_PRESETS } from '../../core/search/search-postprocess.js';
import { applyPostRetrieval } from '../../core/search/index.js';

// The r3h-dgraph-23 shape: the index splits movePredicate into sub-chunks and
// every sub-chunk carries the enclosing symbol span (140-251).
function sub(id, score, extra = {}) {
  return {
    id: `dgraph/cmd/zero/tablet.go:${id}`,
    file: 'dgraph/cmd/zero/tablet.go',
    score,
    metadata: { file: 'dgraph/cmd/zero/tablet.go', startLine: 140, endLine: 251, name: 'movePredicate', type: 'method' },
    ...extra,
  };
}
function other(file, start, end, score, name = 'x', extra = {}) {
  return { id: `${file}:${start}`, file, score, metadata: { file, startLine: start, endLine: end, name }, ...extra };
}

describe('displaySpan', () => {
  it('prefers metadata lines over top-level lines (packager precedence)', () => {
    expect(displaySpan({ file: 'a.go', startLine: 196, endLine: 240, metadata: { startLine: 140, endLine: 251 } }))
      .toEqual({ file: 'a.go', start: 140, end: 251 });
    expect(displaySpan({ file: 'a.go', startLine: 3, endLine: 9 })).toEqual({ file: 'a.go', start: 3, end: 9 });
    expect(displaySpan({ file: 'a.go' })).toBeNull();
    expect(displaySpan({ startLine: 1, endLine: 2 })).toBeNull();
  });
});

describe('dedupeIdenticalSpans', () => {
  it('keeps the best-ranked copy of an identical span and counts the dropped copies', () => {
    const list = [
      sub('240-251:7', 0.468),
      other('worker/predicate_move.go', 189, 255, 0.46, 'MovePredicate'),
      sub('140-157:3', 0.44),
      other('worker/predicate_move.go', 257, 365, 0.424, 'movePredicateHelper'),
      sub('196-240:6', 0.419),
      other('worker/mutation.go', 875, 899, 0.396, 'proposeAndWait'),
    ];
    const { results, dropped } = dedupeIdenticalSpans(list);
    expect(dropped).toBe(2);
    expect(results.map(r => r.metadata.name)).toEqual(['movePredicate', 'MovePredicate', 'movePredicateHelper', 'proposeAndWait']);
    expect(results[0].id).toBe('dgraph/cmd/zero/tablet.go:240-251:7');
    expect(results[0].dedupedHits).toBe(2);
    expect(results[1].dedupedHits).toBeUndefined();
  });

  it('returns the same array when there is nothing to drop', () => {
    const list = [other('a.js', 1, 10, 3), other('a.js', 11, 20, 2), other('b.js', 1, 10, 1)];
    const out = dedupeIdenticalSpans(list);
    expect(out.results).toBe(list);
    expect(out.dropped).toBe(0);
  });

  it('does not drop a span that is only contained in an earlier span', () => {
    const list = [other('a.js', 1, 400, 3, 'BigClass'), other('a.js', 120, 150, 2, 'method')];
    expect(dedupeIdenticalSpans(list).dropped).toBe(0);
  });

  it('prefers a direct hit over a graph-expanded copy of the same span, at the better rank and score', () => {
    const list = [
      other('a.js', 5, 40, 0.9, 'f', { is_expanded: true, entity_id: 'e1' }),
      other('b.js', 1, 9, 0.8),
      other('a.js', 5, 40, 0.7, 'f', { searchPath: 'hybrid' }),
    ];
    const { results } = dedupeIdenticalSpans(list);
    expect(results).toHaveLength(2);
    expect(results[0].is_expanded).toBeUndefined();
    expect(results[0].searchPath).toBe('hybrid');
    expect(results[0].score).toBe(0.9);
    expect(results[0].dedupedHits).toBe(1);
  });

  it('keeps results without a usable span', () => {
    const list = [{ id: 'x', score: 2 }, { id: 'y', score: 1 }, other('a.js', 1, 2, 0.5), other('a.js', 1, 2, 0.4)];
    const { results } = dedupeIdenticalSpans(list);
    expect(results.map(r => r.id)).toEqual(['x', 'y', 'a.js:1']);
  });
});

describe('computeSpanSimilarity', () => {
  const w = SPAN_MMR_WEIGHTS;
  it('scores identical and contained spans in the same file as full overlap', () => {
    expect(computeSpanSimilarity(other('a.js', 1, 100, 1), other('a.js', 1, 100, 1))).toBe(1);
    expect(computeSpanSimilarity(other('a.js', 1, 100, 1), other('a.js', 40, 60, 1))).toBe(1);
  });
  it('scores partial overlap by the share of the shorter span', () => {
    expect(computeSpanSimilarity(other('a.js', 1, 10, 1), other('a.js', 6, 25, 1))).toBeCloseTo(0.5, 5);
  });
  it('default: same file or same name alone is not a near-duplicate', () => {
    expect(w).toEqual({ span: 1, symbol: 0, file: 0, dir: 0 });
    expect(computeSpanSimilarity(other('a.js', 1, 10, 1, 'f'), other('a.js', 50, 60, 1, 'g'))).toBe(0);
    // subclass override of the same method: often both relevant (tortoise to_python_value)
    expect(computeSpanSimilarity(other('a.py', 1, 10, 1, 'to_python_value'), other('b.py', 1, 10, 1, 'to_python_value'))).toBe(0);
  });
  it('content preset: same file stays small, same name gets the symbol weight', () => {
    const c = CONTENT_MMR_WEIGHTS;
    expect(computeSpanSimilarity(other('a.js', 1, 10, 1, 'f'), other('a.js', 50, 60, 1, 'g'), c)).toBe(c.file);
    expect(computeSpanSimilarity(other('a.go', 1, 10, 1, 'Move'), other('b.go', 1, 10, 1, 'Move'), c)).toBe(c.symbol);
  });
  it('is 0 for unrelated results', () => {
    expect(computeSpanSimilarity(other('src/a.js', 1, 10, 1, 'f'), other('lib/b.js', 1, 10, 1, 'g'))).toBe(0);
  });
});

describe('applyFinalListMMR', () => {
  const list = () => [
    other('a.js', 1, 100, 1.0, 'top'),
    other('a.js', 10, 50, 0.95, 'inner'), // contained in top-1
    other('b.js', 1, 30, 0.9, 'b'),
    other('c.js', 1, 30, 0.5, 'c'),
  ];

  it('never moves top-1 and pushes a contained near-duplicate below a distinct result', () => {
    const { results, stats } = applyFinalListMMR(list(), { k: 3, lambda: 0.7 });
    expect(stats.applied).toBe(true);
    expect(results[0].metadata.name).toBe('top');
    expect(results.map(r => r.metadata.name).slice(0, 2)).toEqual(['top', 'b']);
  });

  it('keeps the input top-1 even when a later entry has a higher raw score', () => {
    const unsorted = [
      other('a.js', 1, 100, 0.6, 'promoted'),
      other('a.js', 10, 50, 0.55, 'inner'),
      other('b.js', 1, 30, 0.9, 'higher-raw'),
    ];
    const { results } = applyFinalListMMR(unsorted, { k: 3, lambda: 0.8 });
    expect(results[0].metadata.name).toBe('promoted');
  });

  it('never drops a candidate', () => {
    const input = list();
    const { results } = applyFinalListMMR(input, { k: 2, lambda: 0.5 });
    expect(results).toHaveLength(input.length);
    expect(new Set(results)).toEqual(new Set(input));
  });

  it('with the gate on, leaves a list without redundancy untouched', () => {
    const input = [other('a.js', 1, 9, 1, 'f'), other('b.js', 1, 9, 0.9, 'g'), other('c.js', 1, 9, 0.8, 'h')];
    expect(hasRedundantPair(input, { window: 3 })).toBe(false);
    const { results, stats } = applyFinalListMMR(input, { k: 3, lambda: 0.7, gate: true });
    expect(results).toBe(input);
    expect(stats.applied).toBe(false);
  });

  it('with a high lambda, keeps relevance order when scores are far apart', () => {
    const input = [other('a.js', 1, 100, 1.0), other('a.js', 10, 50, 0.95), other('b.js', 1, 30, 0.1)];
    const { results } = applyFinalListMMR(input, { k: 3, lambda: 0.95 });
    expect(results).toEqual(input);
  });
});

describe('shapeFinalList', () => {
  const dupList = () => [
    sub('240-251:7', 0.468),
    sub('140-157:3', 0.44),
    other('worker/predicate_move.go', 189, 255, 0.46, 'MovePredicate'),
  ];

  it('dedupes identical spans for every agent format and records stats', () => {
    for (const format of ['agent', 'agent_preview', 'agent_full', 'agent_full_xl']) {
      const stats = {};
      const out = shapeFinalList(dupList(), { k: 5, format, stats, finalMMR: { enabled: false } });
      expect(out).toHaveLength(2);
      expect(stats.spanDedupe).toEqual({ dropped: 1 });
    }
  });

  it('leaves non-agent formats untouched: each copy carries its own chunk text there', () => {
    // Two fragments of one class, both widened to the class span by range
    // adoption: same display span, different text. Benchmark/JSON output
    // prints the text, so both must stay.
    const a = { ...sub('140-157:3', 0.47), content: 'func (s *Server) a() {}' };
    const b = { ...sub('240-251:7', 0.46), content: 'func (s *Server) b() {}' };
    for (const format of [undefined, 'json', 'benchmark']) {
      const stats = {};
      const list = [a, b];
      const out = shapeFinalList(list, { k: 5, format, stats, finalMMR: { enabled: true, lambda: 0.8, weights: SPAN_MMR_WEIGHTS, gate: true } });
      expect(out).toBe(list);
      expect(stats).toEqual({});
    }
  });

  it('honours the no-span-dedupe ablation', () => {
    const out = shapeFinalList(dupList(), { k: 5, format: 'agent', ablations: new Set(['no-span-dedupe']), finalMMR: { enabled: false } });
    expect(out).toHaveLength(3);
  });

  it('runs final-list MMR only for agent formats', () => {
    const list = () => [
      other('a.js', 1, 100, 1.0, 'top'),
      other('a.js', 10, 50, 0.95, 'inner'),
      other('b.js', 1, 30, 0.9, 'b'),
      other('c.js', 1, 30, 0.5, 'c'),
    ];
    const mmr = { enabled: true, lambda: 0.7, weights: FINAL_MMR_WEIGHT_PRESETS.content, gate: true };
    expect(shapeFinalList(list(), { k: 3, format: 'json', finalMMR: mmr }).map(r => r.metadata.name))
      .toEqual(['top', 'inner', 'b', 'c']);
    const stats = {};
    expect(shapeFinalList(list(), { k: 3, format: 'agent', finalMMR: mmr, stats }).map(r => r.metadata.name))
      .toEqual(['top', 'b', 'inner', 'c']);
    expect(stats.finalMMR.reordered).toBeGreaterThan(0);
    expect(shapeFinalList(list(), { k: 3, format: 'agent', finalMMR: mmr, ablations: ['no-final-mmr'] })
      .map(r => r.metadata.name)).toEqual(['top', 'inner', 'b', 'c']);
  });

  it('defaults: on, lambda 0.8, span-only weights, gate on; env can turn it off', () => {
    expect(finalMMRSettings({})).toEqual({ enabled: true, lambda: 0.8, weights: SPAN_MMR_WEIGHTS, gate: true });
    expect(finalMMRSettings({ SWEET_SEARCH_FINAL_MMR: '0' }).enabled).toBe(false);
  });

  it('reads env knobs for A/B runs', () => {
    const s = finalMMRSettings({ SWEET_SEARCH_FINAL_MMR: '1', SWEET_SEARCH_FINAL_MMR_LAMBDA: '0.9', SWEET_SEARCH_FINAL_MMR_WEIGHTS: 'span-only', SWEET_SEARCH_FINAL_MMR_GATE: '0' });
    expect(s).toEqual({ enabled: true, lambda: 0.9, weights: FINAL_MMR_WEIGHT_PRESETS['span-only'], gate: false });
    expect(finalMMRSettings({ SWEET_SEARCH_FINAL_MMR_LAMBDA: '7' }).lambda).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// applyPostRetrieval: dedupe runs above the final cut, so freed slots refill.
// ---------------------------------------------------------------------------

function createGraphDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY, file_path TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
      signature TEXT, start_line INTEGER, end_line INTEGER, stale_since INTEGER DEFAULT NULL
    );
    CREATE TABLE relationships (
      source_id TEXT, target_id TEXT, target_name TEXT NOT NULL, type TEXT NOT NULL, weight REAL DEFAULT 1.0
    );
  `);
  const ent = db.prepare('INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const rel = db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)');
  ent.run('mp', 'src/tablet.go', 'method', 'movePredicate', 'func movePredicate()', 140, 251);
  for (let n = 0; n < 4; n++) {
    ent.run(`n${n}`, `src/n${n}.go`, 'function', `n${n}`, `func n${n}()`, 1, 20);
    rel.run('mp', `n${n}`, `n${n}`, 'calls', 1.0);
  }
  return db;
}

function makeSearcher(db) {
  return {
    log: () => {}, logPerformance: () => {}, verbose: false, timing: false,
    enableTranslationFallback: false, hasGraphIndex: true, hasLateInteractionIndex: false,
    useLateInteraction: false, qualityWeight: 0, cascadeEnabled: false,
    graphSearch: { init: vi.fn(async () => {}), db },
    binaryHnswIndex: { getInt8Vector: vi.fn(() => undefined) },
  };
}

function seeds() {
  const span = { file: 'src/tablet.go', startLine: 140, endLine: 251, name: 'movePredicate', type: 'method', entity_id: 'mp' };
  return [
    { id: 'src/tablet.go:240-251:7', file: 'src/tablet.go', score: 10, metadata: { ...span } },
    { id: 'src/tablet.go:140-157:3', file: 'src/tablet.go', score: 9.9, metadata: { ...span } },
    { id: 'src/tablet.go:196-240:6', file: 'src/tablet.go', score: 9.8, metadata: { ...span } },
  ];
}

async function runPost(options, intentPolicy = null) {
  return applyPostRetrieval.call(makeSearcher(createGraphDb()), seeds(), 'q',
    { adaptiveHop2: false, qualityWeight: 0, format: 'agent', ...options },
    { stats: {}, semanticStats: null, searchMode: 'hybrid', effectiveGraphExpand: '1hop', intentPolicy, start: Date.now() });
}

describe('applyPostRetrieval span dedupe', () => {
  it('fills the k slots with distinct spans (copies refill from graph neighbours)', async () => {
    const { results, stats } = await runPost({ k: 3 });
    expect(results).toHaveLength(3);
    const spans = results.map(r => `${r.file || r.metadata?.file}:${r.metadata?.startLine ?? r.startLine}`);
    expect(new Set(spans).size).toBe(3);
    expect(results[0].id).toBe('src/tablet.go:240-251:7');
    expect(results[0].dedupedHits).toBe(2);
    expect(stats.spanDedupe).toEqual({ dropped: 2 });
  });

  it('keeps the copies with the no-span-dedupe ablation (previous behaviour)', async () => {
    const { results } = await runPost({ k: 3, ablations: ['no-span-dedupe'] });
    expect(results.map(r => r.id)).toEqual(['src/tablet.go:240-251:7', 'src/tablet.go:140-157:3', 'src/tablet.go:196-240:6']);
  });

  it('an intent policy maxResults still caps the final list, after dedupe', async () => {
    const policy = { chunkTypeBoosts: {}, edgeTypePriority: ['calls'], expandMode: '1hop', maxResults: 2, rerankerWeight: 0.6 };
    const { results } = await runPost({ k: 5 }, policy);
    expect(results).toHaveLength(2);
    expect(new Set(results.map(r => r.id)).size).toBe(2);
    expect(results[1].file || results[1].metadata?.file).not.toBe('src/tablet.go');
  });
});

// ---------------------------------------------------------------------------
// Packager: covered-summary refill (same rule as Bundle A's A2, plus refill).
// ---------------------------------------------------------------------------

describe('refillCoveredSummaries', () => {
  const full = (file, s, e) => ({
    rank: 1, file, startLine: s, endLine: e, presentation: 'full', code: 'x\n'.repeat(e - s + 1).trimEnd(),
    shownStartLine: s, shownEndLine: e, symbol: 'f',
  });
  const summary = (file, s, e, symbol = 'g') => ({ rank: 0, file, startLine: s, endLine: e, presentation: 'summary', code: null, summary: `${file}:${s} — ${symbol}`, symbol });
  const cand = (file, s, e, name) => ({ file, score: 0.1, metadata: { file, startLine: s, endLine: e, name, type: 'function' } });

  it('swaps a summary inside the shown top-1 body for the next reserve candidate', async () => {
    const { refillCoveredSummaries } = await import('../../core/search/context-expander.js');
    const entries = [full('context.go', 923, 974), summary('context.go', 810, 872), summary('context.go', 928, 943), summary('gin.go', 1, 9)];
    const reserve = [cand('context.go', 930, 940, 'inner'), cand('render.go', 5, 30, 'Render')];
    const { results, replaced } = refillCoveredSummaries(entries, reserve);
    expect(replaced).toBe(1);
    expect(results.map(r => `${r.file}:${r.startLine}`)).toEqual(['context.go:923', 'context.go:810', 'gin.go:1', 'render.go:5']);
    expect(results.map(r => r.rank)).toEqual([1, 2, 3, 4]);
    expect(results[3]).toMatchObject({ presentation: 'summary', code: null, symbol: 'Render', symbolType: 'function' });
  });

  it('never swallows a method into a larger summary-only span, and leaves an uncovered list alone', async () => {
    const { refillCoveredSummaries } = await import('../../core/search/context-expander.js');
    const entries = [full('a.js', 1, 10), summary('b.js', 1, 400, 'BigClass'), summary('b.js', 120, 150, 'method')];
    const out = refillCoveredSummaries(entries, [cand('c.js', 1, 5, 'c')]);
    expect(out.replaced).toBe(0);
    expect(out.results).toBe(entries);
  });

  it('keeps a covered entry when the reserve has nothing usable (A2 then drops it)', async () => {
    const { refillCoveredSummaries } = await import('../../core/search/context-expander.js');
    const entries = [full('a.js', 1, 50), summary('a.js', 10, 20), summary('a.js', 30, 40)];
    const out = refillCoveredSummaries(entries, [cand('a.js', 2, 8, 'covered-too'), cand('z.js', 1, 3, 'z')]);
    expect(out.replaced).toBe(1);
    expect(out.results.map(r => `${r.file}:${r.startLine}`)).toEqual(['a.js:1', 'a.js:30', 'z.js:1']);
  });
});

describe('takeDistinctSpans', () => {
  it('counts distinct spans toward k and keeps copies met on the way', () => {
    const list = [
      sub('196-240:6', 0.9), sub('140-157:3', 0.8), other('a.go', 1, 9, 0.7, 'a'),
      sub('240-251:7', 0.6), other('b.go', 1, 9, 0.5, 'b'), other('c.go', 1, 9, 0.4, 'c'),
    ];
    expect(takeDistinctSpans(list, 2).map(r => r.score)).toEqual([0.9, 0.8, 0.7, 0.6]);
    expect(takeDistinctSpans(list, 3).map(r => r.score)).toEqual([0.9, 0.8, 0.7, 0.6, 0.5]);
    expect(takeDistinctSpans(list, 3, { maxCopies: 1 }).map(r => r.score)).toEqual([0.9, 0.8, 0.7, 0.5]);
    expect(takeDistinctSpans([other('a.go', 1, 2, 1), other('b.go', 1, 2, 1)], 5)).toHaveLength(2);
  });
});

describe('packager ablations (Set or array)', () => {
  it('toAblationSet accepts a Set, an array, or nothing', async () => {
    const { toAblationSet } = await import('../../core/search/context-expander.js');
    const set = new Set(['a']);
    expect(toAblationSet(set)).toBe(set);
    expect([...toAblationSet(['a', 'b'])]).toEqual(['a', 'b']);
    expect(toAblationSet(undefined).size).toBe(0);
    expect(toAblationSet(null).size).toBe(0);
  });

  it('packageForAgent takes an array of ablations (run_benchmark --ablations) without throwing', async () => {
    const { packageForAgent } = await import('../../core/search/context-expander.js');
    const results = [{ file: 'a.js', score: 1, metadata: { file: 'a.js', startLine: 1, endLine: 3, name: 'a', type: 'function' } }];
    const out = packageForAgent(results, {}, {
      query: 'q', k: 5, projectRoot: '/nonexistent', _isAgentFormat: true,
      ablations: ['no-auto-budget', 'no-covered-refill'],
      reserve: [{ file: 'b.js', score: 0.5, metadata: { file: 'b.js', startLine: 1, endLine: 2, name: 'b' } }],
    });
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.results.map(r => r.file)).toEqual(['a.js']);
  });
});
