/**
 * A graph-expanded TINY entity borrows the MaxSim score of the chunk it sits in
 * (attachChunkIdsToExpanded). In agent formats it then shows that chunk: okhttp's `Chain`
 * interface (one chunk, 84-104) became three expanded results `request` 85, `proceed` 87-88 and
 * `connection` 94 with the interface's score, and the body-less `fun request(): Request` won
 * rank 1. Agent formats only (CLAUDE.md format gate): GCSN / JSON callers are unchanged.
 */
import { describe, expect, it } from 'vitest';

import {
  BORROWED_SPAN_MAX_CHUNK_LINES,
  attachChunkIdsToExpanded,
} from '../../core/search/search-postprocess.js';
import { applyResultDemotions } from '../../core/ranking/file-kind-ranking.js';

const FILE = 'okhttp/Interceptor.kt';
const chunks = [
  { id: `${FILE}:66-82:2`, metadata: { startLine: 66, endLine: 82, name: 'intercept', type: 'function' } },
  { id: `${FILE}:84-104:3`, metadata: { startLine: 84, endLine: 104, name: 'Chain', type: 'class' } },
  { id: `${FILE}:106-300:4`, metadata: { startLine: 106, endLine: 300, name: 'withConnectTimeout', type: 'function' } },
];
const codebaseRepo = { getChunksByFilePath: () => chunks };

function expanded(name, startLine, endLine) {
  return {
    entity_id: name, file: FILE, file_path: FILE, name, type: 'function',
    startLine, endLine, start_line: startLine, end_line: endLine, is_expanded: true, score: 0.5,
    metadata: { file: FILE, name, type: 'function', startLine, endLine },
  };
}

describe('attachChunkIdsToExpanded: borrowed chunk span', () => {
  it('default (every non-agent caller): ids attached, spans unchanged', () => {
    const results = [expanded('request', 85, 85), expanded('proceed', 87, 88)];
    expect(attachChunkIdsToExpanded(results, codebaseRepo)).toBe(2);
    expect(results.map((r) => [r._liChunkId, r.metadata.startLine, r.metadata.endLine, r.metadata.name])).toEqual([
      [`${FILE}:84-104:3`, 85, 85, 'request'],
      [`${FILE}:84-104:3`, 87, 88, 'proceed'],
    ]);
  });

  it('agent formats: a tiny entity shows the chunk whose score it carries (one span for all three)', () => {
    const results = [expanded('request', 85, 85), expanded('proceed', 87, 88), expanded('connection', 94, 94)];
    attachChunkIdsToExpanded(results, codebaseRepo, { adoptBorrowedSpan: true });
    for (const r of results) {
      expect([r.startLine, r.endLine, r.metadata.startLine, r.metadata.endLine, r.metadata.name, r.metadata.type])
        .toEqual([84, 104, 84, 104, 'Chain', 'class']);
      expect(r._borrowedSpanFrom).toBeTruthy();
    }
  });

  it('agent formats: an entity of more than 3 lines, or a chunk over the cap, keeps its own span', () => {
    const big = expanded('intercept', 66, 80);
    const inLong = expanded('withReadTimeout', 120, 120);
    expect(300 - 106 + 1).toBeGreaterThan(BORROWED_SPAN_MAX_CHUNK_LINES);
    attachChunkIdsToExpanded([big, inLong], codebaseRepo, { adoptBorrowedSpan: true });
    expect([big.metadata.startLine, big.metadata.endLine]).toEqual([66, 80]);
    expect([inLong.metadata.startLine, inLong.metadata.endLine]).toEqual([120, 120]);
  });
});

describe('applyResultDemotions: a borrowed span is not widened to its enclosing class', () => {
  const repo = {
    findEnclosingEntity: () => ({ id: 'c', name: 'Chain', type: 'class', startLine: 84, endLine: 297 }),
    findFirstEntityInRange: () => null,
    findEntitiesInRange: () => [],
    findEntityWithNameInRange: () => null,
  };
  const borrowed = () => {
    const [r] = [expanded('request', 85, 85)];
    attachChunkIdsToExpanded([r], codebaseRepo, { adoptBorrowedSpan: true });
    return r;
  };

  it('agent format keeps the chunk span 84-104', () => {
    const [out] = applyResultDemotions([borrowed()], { query: 'how are interceptors chained', codeGraphRepo: repo, format: 'agent' });
    expect([out.metadata.startLine, out.metadata.endLine]).toEqual([84, 104]);
  });

  it('a class chunk that did not borrow its span is still widened as before (agent format)', () => {
    const chunk = { file: FILE, startLine: 84, endLine: 104, score: 0.5, metadata: { file: FILE, startLine: 84, endLine: 104, name: 'Chain', type: 'class' } };
    const [out] = applyResultDemotions([chunk], { query: 'how are interceptors chained', codeGraphRepo: repo, format: 'agent' });
    expect([out.metadata.startLine, out.metadata.endLine]).toEqual([84, 297]);
  });

  it('format undefined (GCSN) is unchanged by the borrowed-span flag', () => {
    const r = borrowed();
    const plain = { ...r };
    delete plain._borrowedSpanFrom;
    const [a] = applyResultDemotions([r], { query: 'how are interceptors chained', codeGraphRepo: repo });
    const [b] = applyResultDemotions([plain], { query: 'how are interceptors chained', codeGraphRepo: repo });
    expect([a.metadata.startLine, a.metadata.endLine, a.score]).toEqual([b.metadata.startLine, b.metadata.endLine, b.score]);
  });
});
