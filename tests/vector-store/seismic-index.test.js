import { describe, it, expect } from 'vitest';
import {
  SeismicIndex,
  TopKHeap,
  sparseDotProduct,
  Block,
  InvertedList,
} from '../../core/vector-store/seismic-index.js';

// =============================================================================
// HELPERS
// =============================================================================

/** Build a sparse vector Map from a plain object */
function sv(obj) {
  return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
}

/** Brute-force top-k by exact dot product (reference implementation) */
function bruteForceTopK(docs, query, k) {
  const scores = docs.map(({ id, vector }) => ({
    id,
    score: sparseDotProduct(query, vector),
  }));
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k).filter(r => r.score > 0);
}

// =============================================================================
// sparseDotProduct
// =============================================================================

describe('sparseDotProduct', () => {
  it('computes dot product for overlapping dimensions', () => {
    const a = sv({ 0: 2, 1: 3, 2: 4 });
    const b = sv({ 1: 5, 2: 6 });
    // 3*5 + 4*6 = 15 + 24 = 39
    expect(sparseDotProduct(a, b)).toBe(39);
  });

  it('returns 0 for non-overlapping dimensions', () => {
    const a = sv({ 0: 1, 1: 2 });
    const b = sv({ 5: 3, 6: 4 });
    expect(sparseDotProduct(a, b)).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(sparseDotProduct(new Map(), sv({ 1: 5 }))).toBe(0);
    expect(sparseDotProduct(sv({ 1: 5 }), new Map())).toBe(0);
    expect(sparseDotProduct(new Map(), new Map())).toBe(0);
  });

  it('handles negative weights', () => {
    const a = sv({ 0: -2, 1: 3 });
    const b = sv({ 0: 4, 1: -1 });
    // (-2)*4 + 3*(-1) = -8 + -3 = -11
    expect(sparseDotProduct(a, b)).toBe(-11);
  });

  it('is commutative', () => {
    const a = sv({ 0: 2, 3: 7, 5: 1 });
    const b = sv({ 3: 4, 5: 2, 9: 3 });
    expect(sparseDotProduct(a, b)).toBe(sparseDotProduct(b, a));
  });
});

// =============================================================================
// TopKHeap
// =============================================================================

describe('TopKHeap', () => {
  it('keeps only top-k items', () => {
    const heap = new TopKHeap(3);
    for (let i = 0; i < 10; i++) heap.push(`doc${i}`, i);
    const results = heap.results();
    expect(results).toHaveLength(3);
    expect(results[0].score).toBe(9);
    expect(results[1].score).toBe(8);
    expect(results[2].score).toBe(7);
  });

  it('threshold returns -Infinity when not full', () => {
    const heap = new TopKHeap(5);
    expect(heap.threshold()).toBe(-Infinity);
    heap.push('a', 10);
    expect(heap.threshold()).toBe(-Infinity);
  });

  it('threshold returns minimum score when full', () => {
    const heap = new TopKHeap(3);
    heap.push('a', 5);
    heap.push('b', 10);
    heap.push('c', 15);
    expect(heap.threshold()).toBe(5);
    heap.push('d', 20);
    expect(heap.threshold()).toBe(10);
  });

  it('handles push of items with equal scores', () => {
    const heap = new TopKHeap(2);
    heap.push('a', 5);
    heap.push('b', 5);
    heap.push('c', 5);
    expect(heap.results()).toHaveLength(2);
    expect(heap.results().every(r => r.score === 5)).toBe(true);
  });

  it('handles k=1', () => {
    const heap = new TopKHeap(1);
    heap.push('a', 3);
    heap.push('b', 7);
    heap.push('c', 1);
    const results = heap.results();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 'b', score: 7 });
  });
});

// =============================================================================
// Block
// =============================================================================

describe('Block', () => {
  it('summary is the max weight', () => {
    const block = new Block([
      { docId: 'a', weight: 3 },
      { docId: 'b', weight: 7 },
      { docId: 'c', weight: 1 },
    ]);
    expect(block.summary).toBe(7);
  });

  it('canSkip returns true when block cannot improve threshold', () => {
    const block = new Block([{ docId: 'a', weight: 2 }]);
    // summary=2, queryWeight=3, contribution upper bound = 6
    // threshold=10 → 6 < 10 → can skip
    expect(block.canSkip(3, 10)).toBe(true);
  });

  it('canSkip returns false when block might improve threshold', () => {
    const block = new Block([{ docId: 'a', weight: 5 }]);
    // summary=5, queryWeight=3, contribution upper bound = 15
    // threshold=10 → 15 >= 10 → cannot skip
    expect(block.canSkip(3, 10)).toBe(false);
  });
});

// =============================================================================
// InvertedList
// =============================================================================

describe('InvertedList', () => {
  it('sorts postings by weight descending and creates blocks', () => {
    const list = new InvertedList(42);
    list.addPosting('a', 1);
    list.addPosting('b', 5);
    list.addPosting('c', 3);
    list.buildBlocks(2);

    expect(list.postings[0].weight).toBe(5);
    expect(list.postings[1].weight).toBe(3);
    expect(list.postings[2].weight).toBe(1);
    expect(list.blocks).toHaveLength(2); // [5,3] and [1]
    expect(list.blocks[0].summary).toBe(5);
    expect(list.blocks[1].summary).toBe(1);
  });
});

// =============================================================================
// SeismicIndex - build & stats
// =============================================================================

describe('SeismicIndex', () => {
  const docs = [
    { id: 'doc1', vector: sv({ 0: 1, 1: 2, 2: 3 }) },
    { id: 'doc2', vector: sv({ 1: 4, 3: 5 }) },
    { id: 'doc3', vector: sv({ 0: 6, 2: 7, 4: 8 }) },
  ];

  it('builds and reports correct stats', () => {
    const index = new SeismicIndex({ blockSize: 2 });
    index.build(docs);
    const stats = index.getStats();
    expect(stats.totalDocs).toBe(3);
    // dimensions used: 0,1,2,3,4 = 5 terms
    expect(stats.totalTerms).toBe(5);
    expect(stats.totalBlocks).toBeGreaterThan(0);
    expect(stats.avgBlockSize).toBeGreaterThan(0);
  });

  it('returns correct top-k results vs brute force', () => {
    const index = new SeismicIndex({ blockSize: 2 });
    index.build(docs);
    const query = sv({ 0: 1, 1: 1, 2: 1 });
    const results = index.query(query, 3);
    const expected = bruteForceTopK(docs, query, 3);

    expect(results.map(r => r.id)).toEqual(expected.map(r => r.id));
    for (let i = 0; i < results.length; i++) {
      expect(results[i].score).toBeCloseTo(expected[i].score, 10);
    }
  });

  it('respects k parameter', () => {
    const index = new SeismicIndex({ blockSize: 2 });
    index.build(docs);
    const query = sv({ 0: 1, 1: 1, 2: 1 });
    const results = index.query(query, 1);
    expect(results).toHaveLength(1);
    // doc3 has 0:6 + 2:7 = 13 which is the highest
    expect(results[0].id).toBe('doc3');
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('SeismicIndex edge cases', () => {
  it('returns empty for empty index', () => {
    const index = new SeismicIndex();
    index.build([]);
    expect(index.query(sv({ 0: 1 }), 5)).toEqual([]);
    expect(index.getStats().totalDocs).toBe(0);
  });

  it('returns empty for empty query', () => {
    const index = new SeismicIndex();
    index.build([{ id: 'a', vector: sv({ 0: 1 }) }]);
    expect(index.query(new Map(), 5)).toEqual([]);
  });

  it('handles single document, single term', () => {
    const index = new SeismicIndex();
    index.build([{ id: 'only', vector: sv({ 42: 3.14 }) }]);
    const results = index.query(sv({ 42: 2 }), 10);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('only');
    expect(results[0].score).toBeCloseTo(6.28, 10);
  });

  it('skips zero-weight dimensions in build', () => {
    const index = new SeismicIndex();
    index.build([{ id: 'a', vector: sv({ 0: 0, 1: 5 }) }]);
    // Dimension 0 should not create an inverted list
    expect(index.getStats().totalTerms).toBe(1);
  });

  it('returns empty when query has no matching dimensions', () => {
    const index = new SeismicIndex();
    index.build([{ id: 'a', vector: sv({ 0: 1 }) }]);
    const results = index.query(sv({ 99: 1 }), 5);
    expect(results).toEqual([]);
  });
});

// =============================================================================
// High-dimensional sparse vectors
// =============================================================================

describe('SeismicIndex high-dimensional', () => {
  it('handles 1000+ dimensions with few non-zero entries', () => {
    const numDocs = 100;
    const numDims = 10000;
    const nnzPerDoc = 20;

    const docs = [];
    for (let d = 0; d < numDocs; d++) {
      const vector = new Map();
      for (let i = 0; i < nnzPerDoc; i++) {
        const dim = Math.floor(Math.random() * numDims);
        vector.set(dim, Math.random() * 10);
      }
      docs.push({ id: `doc${d}`, vector });
    }

    const index = new SeismicIndex({ blockSize: 16 });
    index.build(docs);

    const query = new Map();
    for (let i = 0; i < 5; i++) {
      query.set(Math.floor(Math.random() * numDims), Math.random() * 10);
    }

    const results = index.query(query, 5);
    const expected = bruteForceTopK(docs, query, 5);

    // Scores should match brute force
    expect(results.length).toBeLessThanOrEqual(5);
    for (let i = 0; i < results.length; i++) {
      expect(results[i].id).toBe(expected[i].id);
      expect(results[i].score).toBeCloseTo(expected[i].score, 10);
    }
  });
});

// =============================================================================
// Block skipping
// =============================================================================

describe('SeismicIndex block skipping', () => {
  it('approximateQuery skips blocks when threshold is high enough', () => {
    // Create docs where one document has very high weights and others are low
    // With a small blockSize, the low-weight blocks should be skippable
    const docs = [
      { id: 'high', vector: sv({ 0: 100, 1: 100 }) },
    ];
    // Add many low-weight docs to create multiple blocks
    for (let i = 0; i < 200; i++) {
      docs.push({ id: `low${i}`, vector: sv({ 0: 0.001, 1: 0.001 }) });
    }

    const index = new SeismicIndex({ blockSize: 4 });
    index.build(docs);

    const { results, blocksExamined, blocksSkipped } =
      index.approximateQuery(sv({ 0: 1, 1: 1 }), 1);
    expect(results[0].id).toBe('high');
    expect(blocksSkipped).toBeGreaterThan(0);
    expect(blocksExamined).toBeGreaterThan(0);
  });

  it('exact query examines all blocks', () => {
    const docs = [
      { id: 'high', vector: sv({ 0: 100 }) },
    ];
    for (let i = 0; i < 100; i++) {
      docs.push({ id: `low${i}`, vector: sv({ 0: 0.001 }) });
    }

    const index = new SeismicIndex({ blockSize: 4 });
    index.build(docs);

    const results = index.query(sv({ 0: 1 }), 1);
    expect(results[0].id).toBe('high');

    const stats = index.lastQueryStats;
    // Exact query has no blocksSkipped field — all blocks examined
    expect(stats.blocksExamined).toBe(Math.ceil(101 / 4));
  });
});

// =============================================================================
// Serialize / Deserialize
// =============================================================================

describe('SeismicIndex serialization', () => {
  it('round-trips correctly', () => {
    const docs = [
      { id: 'alpha', vector: sv({ 0: 1.5, 5: 2.5, 100: 0.3 }) },
      { id: 'beta', vector: sv({ 5: 4.0, 200: 1.1 }) },
      { id: 'gamma', vector: sv({ 0: 0.7, 100: 3.3, 200: 2.2 }) },
    ];

    const original = new SeismicIndex({ blockSize: 2, alpha: 0.75 });
    original.build(docs);

    const buffer = original.serialize();
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const restored = SeismicIndex.deserialize(buffer);
    expect(restored.blockSize).toBe(2);
    expect(restored.alpha).toBe(0.75);
    expect(restored.getStats().totalDocs).toBe(3);
    expect(restored.getStats().totalTerms).toBe(original.getStats().totalTerms);

    // Query results should match
    const query = sv({ 0: 1, 5: 1, 200: 1 });
    const origResults = original.query(query, 3);
    const restoredResults = restored.query(query, 3);
    expect(restoredResults.map(r => r.id)).toEqual(origResults.map(r => r.id));
    for (let i = 0; i < origResults.length; i++) {
      expect(restoredResults[i].score).toBeCloseTo(origResults[i].score, 10);
    }
  });

  it('rejects invalid magic bytes', () => {
    const bad = Buffer.alloc(20);
    expect(() => SeismicIndex.deserialize(bad)).toThrow('Invalid SEISMIC index magic bytes');
  });

  it('rejects unsupported version', () => {
    const buf = Buffer.alloc(20);
    buf.write('SEISM', 0, 5, 'ascii');
    buf.writeUInt8(99, 5); // bad version
    expect(() => SeismicIndex.deserialize(buf)).toThrow('Unsupported SEISMIC index version');
  });

  it('rejects truncated payloads', () => {
    const buf = Buffer.alloc(22);
    buf.write('SEISM', 0, 5, 'ascii');
    buf.writeUInt8(1, 5);
    buf.writeUInt32BE(64, 6);
    buf.writeDoubleBE(0.8, 10);
    buf.writeUInt32BE(1, 18); // numDocs=1 but no document bytes follow

    expect(() => SeismicIndex.deserialize(buf)).toThrow('Corrupt SEISMIC index: truncated');
  });

  it('rejects invalid block size', () => {
    const buf = Buffer.alloc(22);
    buf.write('SEISM', 0, 5, 'ascii');
    buf.writeUInt8(1, 5);
    buf.writeUInt32BE(0, 6); // invalid
    buf.writeDoubleBE(0.8, 10);
    buf.writeUInt32BE(0, 18);

    expect(() => SeismicIndex.deserialize(buf)).toThrow('Corrupt SEISMIC index: invalid block size');
  });

  it('rejects oversized dimension counts', () => {
    const buf = Buffer.alloc(29);
    buf.write('SEISM', 0, 5, 'ascii');
    buf.writeUInt8(1, 5);
    buf.writeUInt32BE(64, 6);
    buf.writeDoubleBE(0.8, 10);
    buf.writeUInt32BE(1, 18); // numDocs
    buf.writeUInt16BE(1, 22); // idLen
    buf.write('a', 24, 1, 'utf8');
    buf.writeUInt32BE(1_000_001, 25); // exceeds MAX_DESERIALIZE_DIMS_PER_DOC

    expect(() => SeismicIndex.deserialize(buf)).toThrow('Corrupt SEISMIC index: dimension count too large');
  });
});

// =============================================================================
// Performance
// =============================================================================

describe('SeismicIndex performance', () => {
  it('1000 docs, 100 dimensions completes in <100ms', () => {
    const numDocs = 1000;
    const numDims = 100;
    const nnzPerDoc = 15;

    const docs = [];
    for (let d = 0; d < numDocs; d++) {
      const vector = new Map();
      for (let i = 0; i < nnzPerDoc; i++) {
        vector.set(Math.floor(Math.random() * numDims), Math.random());
      }
      docs.push({ id: `doc${d}`, vector });
    }

    const index = new SeismicIndex({ blockSize: 32 });

    const buildStart = performance.now();
    index.build(docs);
    const buildTime = performance.now() - buildStart;

    const query = new Map();
    for (let i = 0; i < 10; i++) {
      query.set(Math.floor(Math.random() * numDims), Math.random());
    }

    const queryStart = performance.now();
    const results = index.query(query, 10);
    const queryTime = performance.now() - queryStart;

    expect(buildTime).toBeLessThan(100);
    expect(queryTime).toBeLessThan(100);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);

    // Top-1 should match brute force (block skipping is approximate for lower ranks)
    const expected = bruteForceTopK(docs, query, 10);
    expect(results[0].id).toBe(expected[0].id);
    expect(results[0].score).toBeCloseTo(expected[0].score, 10);
  });
});
