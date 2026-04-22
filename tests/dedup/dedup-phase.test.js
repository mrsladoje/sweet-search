import { describe, it, expect } from 'vitest';
import { runDedupPhase, partitionByExemplar, formatDedupSummary } from '../../core/indexing/dedup/dedup-phase.js';
import { selectExemplar } from '../../core/indexing/dedup/exemplar-selector.js';

function mkChunk(id, file, text) {
  return { id, file, text };
}

describe('runDedupPhase', () => {
  it('annotates chunks with simhash + cluster metadata', async () => {
    const chunks = [
      mkChunk('a:1-5:0', 'a.js', 'function foo(x) { return x + 1; } function bar(y) { return y * 2; }'),
      mkChunk('b:1-5:0', 'b.js', 'function foo(x) { return x + 1; } function bar(y) { return y * 2; }'),
      mkChunk('c:1-5:0', 'c.js', 'class Widget { render() { return this.value; } }'),
    ];
    const result = await runDedupPhase(chunks);
    expect(result.skipped).toBe(false);
    expect(result.stats.totalChunks).toBe(3);
    expect(result.stats.totalAliases).toBe(1);
    expect(result.stats.clustersWithSiblings).toBe(1);

    // a and b share a clusterId.
    expect(chunks[0].metadata.clusterId).toBeTruthy();
    expect(chunks[0].metadata.clusterId).toBe(chunks[1].metadata.clusterId);

    // Exactly one of a/b is the exemplar; the other is the alias.
    const exemplars = chunks.filter((c) => c.metadata.isExemplar);
    const aliases = chunks.filter((c) => c.metadata.exemplarId);
    expect(exemplars).toHaveLength(2); // a or b + c (self-exemplar)
    expect(aliases).toHaveLength(1);
    expect(exemplars.some((c) => c.id === aliases[0].metadata.exemplarId)).toBe(true);

    // c is a singleton.
    expect(chunks[2].metadata.clusterId).toBeNull();
    expect(chunks[2].metadata.exemplarId).toBeNull();
    expect(chunks[2].metadata.isExemplar).toBe(true);
  });

  it('chooses the same exemplar regardless of input order', async () => {
    const t = 'function foo(x) { return x + 1; } function bar(y) { return y * 2; }';
    const order1 = [
      mkChunk('a:1-5:0', 'a.js', t),
      mkChunk('b:1-5:0', 'b.js', t),
      mkChunk('c:1-5:0', 'c.js', t),
    ];
    const order2 = [
      mkChunk('c:1-5:0', 'c.js', t),
      mkChunk('a:1-5:0', 'a.js', t),
      mkChunk('b:1-5:0', 'b.js', t),
    ];

    await runDedupPhase(order1);
    await runDedupPhase(order2);

    const findExemplar = (cs) => cs.find((c) => c.metadata.isExemplar && c.metadata.clusterId);
    expect(findExemplar(order1).id).toBe(findExemplar(order2).id);
  });

  it('skips when disabled by config flag', async () => {
    const chunks = [mkChunk('a:1-5:0', 'a.js', 'x')];
    const result = await runDedupPhase(chunks, { enabled: false });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('disabled');
    expect(chunks[0].metadata).toBeUndefined();
  });

  it('skips on empty chunk list', async () => {
    const result = await runDedupPhase([]);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('empty');
  });

  it('produces a human-readable summary', async () => {
    const chunks = [
      mkChunk('a:1-5:0', 'a.js', 'function foo(x) { return x + 1; } function bar(y) { return y * 2; }'),
      mkChunk('b:1-5:0', 'b.js', 'function foo(x) { return x + 1; } function bar(y) { return y * 2; }'),
    ];
    const result = await runDedupPhase(chunks);
    const summary = formatDedupSummary(result);
    expect(summary).toMatch(/1 clusters.*1 aliases/);
  });
});

describe('partitionByExemplar', () => {
  it('splits annotated chunks into exemplars and aliases preserving order', () => {
    const chunks = [
      { id: 'a', metadata: { isExemplar: true, exemplarId: null } },
      { id: 'b', metadata: { exemplarId: 'a' } },
      { id: 'c', metadata: { isExemplar: true, exemplarId: null } },
      { id: 'd', metadata: { exemplarId: 'c' } },
    ];
    const { exemplars, aliases } = partitionByExemplar(chunks);
    expect(exemplars.map((c) => c.id)).toEqual(['a', 'c']);
    expect(aliases.map((c) => c.id)).toEqual(['b', 'd']);
  });

  it('exemplarTexts aligns with exemplars when passed', () => {
    const chunks = [
      { id: 'a', metadata: { exemplarId: null } },
      { id: 'b', metadata: { exemplarId: 'a' } },
      { id: 'c', metadata: {} }, // undefined exemplarId → treated as exemplar
    ];
    const texts = ['TA', 'TB', 'TC'];
    const { exemplars, exemplarTexts } = partitionByExemplar(chunks, texts);
    expect(exemplars.map((c) => c.id)).toEqual(['a', 'c']);
    expect(exemplarTexts).toEqual(['TA', 'TC']);
  });
});

describe('selectExemplar', () => {
  it('picks the longest text', () => {
    const members = [
      { idx: 0, chunk: { text: 'abc', file: 'z.js', id: 'z' } },
      { idx: 1, chunk: { text: 'abcdef', file: 'y.js', id: 'y' } },
      { idx: 2, chunk: { text: 'ab', file: 'x.js', id: 'x' } },
    ];
    expect(selectExemplar(members).idx).toBe(1);
  });

  it('ties on length break by lowest path lex', () => {
    const members = [
      { idx: 0, chunk: { text: 'same', file: 'b.js', id: '0' } },
      { idx: 1, chunk: { text: 'same', file: 'a.js', id: '1' } },
      { idx: 2, chunk: { text: 'same', file: 'c.js', id: '2' } },
    ];
    expect(selectExemplar(members).idx).toBe(1);
  });

  it('ties on path break by lowest hash/id', () => {
    const members = [
      { idx: 0, chunk: { text: 'x', file: 'a.js', id: '222', metadata: { hash: '222' } } },
      { idx: 1, chunk: { text: 'x', file: 'a.js', id: '111', metadata: { hash: '111' } } },
    ];
    expect(selectExemplar(members).idx).toBe(1);
  });
});
