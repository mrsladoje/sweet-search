/**
 * pipeline-io.test.js
 *
 * Tests for P2 async I/O pipeline -- buildInsertItems helper.
 */

import { describe, it, expect } from 'vitest';

describe('P2 Async I/O Pipeline', () => {
  describe('buildInsertItems logic', () => {
    const modelInfo = { provider: 'local', dimension: 768 };

    function buildInsertItems(chunks, embeddings, mInfo) {
      const items = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        if (!embedding || embedding.length === 0) continue;

        items.push({
          id: chunk.id,
          filePath: chunk.file,
          embeddingBlob: embedding instanceof Float32Array
            ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
            : Buffer.from(new Float32Array(embedding).buffer),
          text: (chunk.text || chunk.content || '').slice(0, 2000),
          metadata: JSON.stringify({
            file: chunk.file,
            type: chunk.metadata?.chunk_type || 'code',
            name: chunk.metadata?.symbol || null,
            startLine: chunk.metadata?.line_start || null,
            endLine: chunk.metadata?.line_end || null,
            language: chunk.metadata?.language || null,
            provider: mInfo.provider,
            dimension: embedding.length,
          }),
          sessionId: `codebase-v22-${mInfo.provider}`,
          tags: JSON.stringify(['codebase', chunk.metadata?.language || 'unknown']),
          createdAt: expect.any(String),
        });
      }
      return items;
    }

    it('builds items from chunks and embeddings', () => {
      const chunks = [
        { id: 'c1', file: 'test.js', text: 'hello', metadata: { language: 'javascript' } },
        { id: 'c2', file: 'test2.js', text: 'world', metadata: { language: 'javascript' } },
      ];
      const embeddings = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6]),
      ];

      const items = buildInsertItems(chunks, embeddings, modelInfo);
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('c1');
      expect(items[1].id).toBe('c2');
    });

    it('skips null or empty embeddings', () => {
      const chunks = [
        { id: 'c1', file: 'test.js', text: 'hello', metadata: {} },
        { id: 'c2', file: 'test2.js', text: 'world', metadata: {} },
        { id: 'c3', file: 'test3.js', text: 'foo', metadata: {} },
      ];
      const embeddings = [
        new Float32Array([1, 2, 3]),
        null,
        new Float32Array([]),
      ];

      const items = buildInsertItems(chunks, embeddings, modelInfo);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('c1');
    });

    it('handles Float32Array subarray views correctly', () => {
      const pool = new Float32Array([10, 20, 30, 40, 50, 60]);
      const sub1 = pool.subarray(0, 3);
      const sub2 = pool.subarray(3, 6);

      const chunks = [
        { id: 'c1', file: 'a.js', text: 'a', metadata: {} },
        { id: 'c2', file: 'b.js', text: 'b', metadata: {} },
      ];

      const items = buildInsertItems(chunks, [sub1, sub2], modelInfo);
      expect(items).toHaveLength(2);

      // Verify the blob contains the correct bytes
      const view1 = new Float32Array(items[0].embeddingBlob.buffer,
        items[0].embeddingBlob.byteOffset,
        items[0].embeddingBlob.byteLength / 4);
      expect(Array.from(view1)).toEqual([10, 20, 30]);

      const view2 = new Float32Array(items[1].embeddingBlob.buffer,
        items[1].embeddingBlob.byteOffset,
        items[1].embeddingBlob.byteLength / 4);
      expect(Array.from(view2)).toEqual([40, 50, 60]);
    });

    it('truncates text to 2000 chars', () => {
      const longText = 'x'.repeat(5000);
      const chunks = [
        { id: 'c1', file: 'test.js', text: longText, metadata: {} },
      ];
      const embeddings = [new Float32Array([1, 2, 3])];

      const items = buildInsertItems(chunks, embeddings, modelInfo);
      expect(items[0].text).toHaveLength(2000);
    });

    it('serializes metadata as JSON', () => {
      const chunks = [
        {
          id: 'c1', file: 'test.js', text: 'hello',
          metadata: { chunk_type: 'function', symbol: 'myFunc', line_start: 10, line_end: 20, language: 'javascript' },
        },
      ];
      const embeddings = [new Float32Array([1, 2, 3])];

      const items = buildInsertItems(chunks, embeddings, modelInfo);
      const meta = JSON.parse(items[0].metadata);
      expect(meta.file).toBe('test.js');
      expect(meta.type).toBe('function');
      expect(meta.name).toBe('myFunc');
      expect(meta.startLine).toBe(10);
      expect(meta.endLine).toBe(20);
      expect(meta.language).toBe('javascript');
      expect(meta.provider).toBe('local');
      expect(meta.dimension).toBe(3);
    });
  });

  describe('Pipeline overlapping', () => {
    it('demonstrates interleaved embed+write pattern', async () => {
      // Simulate the pipeline: embed batch N+1 while "writing" batch N
      const batches = [['a', 'b'], ['c', 'd'], ['e', 'f']];
      const embedOrder = [];
      const writeOrder = [];

      async function mockEmbed(batch) {
        embedOrder.push(batch[0]); // track first item
        return batch.map(() => ({ embedding: new Float32Array([1]) }));
      }

      function mockWrite(items) {
        writeOrder.push(items.length);
      }

      const embeddings = [];
      let prevItems = null;

      for (const batch of batches) {
        const resultsPromise = mockEmbed(batch);

        if (prevItems) {
          mockWrite(prevItems);
        }

        const results = await resultsPromise;
        embeddings.push(...results.map(r => r.embedding));
        prevItems = results; // simplified: use results as "items"
      }

      // Write last batch
      if (prevItems) mockWrite(prevItems);

      expect(embeddings).toHaveLength(6);
      expect(embedOrder).toEqual(['a', 'c', 'e']);
      expect(writeOrder).toEqual([2, 2, 2]); // 3 writes for 3 batches
    });
  });
});
