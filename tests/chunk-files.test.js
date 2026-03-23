import { describe, expect, it } from 'vitest';
import { chunkFiles } from '../core/indexer-build.js';

describe('chunkFiles', () => {
  it('returns { allChunks, texts } with matching lengths', async () => {
    // Use a known small file from the project
    const result = await chunkFiles(['core/config.js']);

    expect(result).toHaveProperty('allChunks');
    expect(result).toHaveProperty('texts');
    expect(result.allChunks.length).toBeGreaterThan(0);
    expect(result.texts).toHaveLength(result.allChunks.length);
  });

  it('each chunk has required id, file, and text fields', async () => {
    const { allChunks } = await chunkFiles(['core/config.js']);

    for (const chunk of allChunks) {
      expect(chunk.id).toMatch(/^core\/config\.js:\d+-\d+:\d+$/);
      expect(chunk.file).toBe('core/config.js');
      expect(chunk.text || chunk.content).toBeTruthy();
    }
  });

  it('each text is a non-empty string within length limit', async () => {
    const { texts } = await chunkFiles(['core/config.js']);

    for (const text of texts) {
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThanOrEqual(2000);
    }
  });

  it('returns empty results for empty file list', async () => {
    const result = await chunkFiles([]);

    expect(result.allChunks).toHaveLength(0);
    expect(result.texts).toHaveLength(0);
  });

  it('skips files that do not exist without throwing', async () => {
    const result = await chunkFiles(['nonexistent/file.js']);

    expect(result.allChunks).toHaveLength(0);
    expect(result.texts).toHaveLength(0);
  });

  it('handles multiple files and preserves file attribution', async () => {
    const files = ['core/config.js', 'core/indexer-build.js'];
    const { allChunks } = await chunkFiles(files);

    const filesInChunks = new Set(allChunks.map(c => c.file));
    expect(filesInChunks.has('core/config.js')).toBe(true);
    expect(filesInChunks.has('core/indexer-build.js')).toBe(true);
  });

  it('prefers embedding_text over raw text for texts array', async () => {
    const { allChunks, texts } = await chunkFiles(['core/config.js']);

    // Chunks with embedding_text should have texts derived from it
    for (let i = 0; i < allChunks.length; i++) {
      if (allChunks[i].embedding_text) {
        expect(texts[i]).toBe(allChunks[i].embedding_text.slice(0, 2000));
      }
    }
  });
});
