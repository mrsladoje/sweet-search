/**
 * Tests for core/incremental-indexing/domain/encoder-input.mjs
 *
 * Covers plan § 7.2 + § 7.2.1 + § 12.4:
 *   - Dense hash captures the exact `embedding_text` policy fingerprint.
 *   - LI hash routes correctly across Python / Java-family / default.
 *   - Dedup fingerprint changes when exemplar identity changes.
 *   - `chunkInputHashes` aggregates all four hashes deterministically.
 */

import { describe, it, expect } from 'vitest';
import {
  denseInputHash,
  liInputHash,
  dedupFingerprint,
  chunkInputHashes,
  pickLiInputText,
  normalizePathSlug,
} from '../../core/incremental-indexing/domain/encoder-input.mjs';

function chunk({ language, embedding_text, li_text, li_greedy_text, relative_path, ...meta }) {
  return {
    content: embedding_text || '',
    embedding_text,
    li_text,
    li_greedy_text,
    metadata: { language, relative_path, ...meta },
  };
}

describe('encoder-input / dense hash', () => {
  it('is stable for identical embedding_text', () => {
    const a = chunk({ embedding_text: 'function foo() { return 1; }' });
    const b = chunk({ embedding_text: 'function foo() { return 1; }' });
    expect(denseInputHash(a)).toBe(denseInputHash(b));
  });

  it('flips on any embedding_text byte change', () => {
    const a = chunk({ embedding_text: 'function foo() { return 1; }' });
    const b = chunk({ embedding_text: 'function foo() { return 2; }' });
    expect(denseInputHash(a)).not.toBe(denseInputHash(b));
  });

  it('uses chunk.content when embedding_text is missing', () => {
    const a = { content: 'fallback content' };
    expect(denseInputHash(a)).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('encoder-input / LI input routing', () => {
  it('Python uses li_text without path slug', () => {
    const py = chunk({
      language: 'python',
      relative_path: 'foo/bar.py',
      embedding_text: 'def foo():\n    return 1',
      li_text: 'def foo():\n    return 1',
    });
    expect(pickLiInputText(py)).toBe('def foo():\n    return 1');
  });

  it('Java-family prepends a normalised path slug', () => {
    const java = chunk({
      language: 'java',
      relative_path: 'src/main/Foo.java',
      li_text: 'class Foo {}',
    });
    expect(pickLiInputText(java)).toBe('src.main.foo\nclass Foo {}');
  });

  it('JS/TS uses li_greedy_text first', () => {
    const js = chunk({
      language: 'javascript',
      relative_path: 'src/a.js',
      embedding_text: 'embed',
      li_text: 'plain',
      li_greedy_text: 'greedy',
    });
    expect(pickLiInputText(js)).toBe('greedy');
  });

  it('falls back to embedding_text when li_greedy_text is empty', () => {
    const js = chunk({
      language: 'javascript',
      relative_path: 'src/a.js',
      embedding_text: 'embed',
      li_text: 'plain',
    });
    expect(pickLiInputText(js)).toBe('embed');
  });

  it('liInputHash matches across the three regimes', () => {
    const py = chunk({ language: 'python', li_text: 'x = 1' });
    const java = chunk({ language: 'java', relative_path: 'a.java', li_text: 'class A {}' });
    const js = chunk({ language: 'javascript', li_greedy_text: 'const x = 1;' });
    for (const c of [py, java, js]) {
      expect(liInputHash(c)).toMatch(/^[a-f0-9]{16}$/);
    }
  });
});

describe('encoder-input / dedup fingerprint', () => {
  it('changes when exemplarId flips', () => {
    const a = { metadata: { simhash: 1, clusterId: 'c1', exemplarId: 'e1', isExemplar: false, liReuseEligible: true } };
    const b = { metadata: { simhash: 1, clusterId: 'c1', exemplarId: 'e2', isExemplar: false, liReuseEligible: true } };
    expect(dedupFingerprint(a)).not.toBe(dedupFingerprint(b));
  });

  it('changes when liReuseEligible flips', () => {
    const a = { metadata: { simhash: 1, clusterId: 'c1', exemplarId: 'e1', isExemplar: false, liReuseEligible: true } };
    const b = { metadata: { simhash: 1, clusterId: 'c1', exemplarId: 'e1', isExemplar: false, liReuseEligible: false } };
    expect(dedupFingerprint(a)).not.toBe(dedupFingerprint(b));
  });

  it('is identical for two chunks with all-null dedup metadata', () => {
    const a = { metadata: {} };
    const b = { metadata: {} };
    expect(dedupFingerprint(a)).toBe(dedupFingerprint(b));
  });
});

describe('encoder-input / chunkInputHashes aggregate', () => {
  it('emits four 16-hex strings + dedup fingerprint', () => {
    const c = chunk({
      language: 'javascript',
      relative_path: 'src/a.js',
      embedding_text: 'const x = 1;',
      li_greedy_text: 'greedy const x = 1;',
      symbol: 'x',
      chunk_type: 'variable',
      simhash: 42,
      clusterId: 'c1',
    });
    const h = chunkInputHashes(c);
    for (const k of ['chunk_text_hash', 'embedding_input_hash', 'li_input_hash', 'metadata_fingerprint', 'dedup_fingerprint']) {
      expect(h[k]).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  it('metadata fingerprint shifts on parent-symbol change', () => {
    const before = chunk({ language: 'javascript', relative_path: 's.js', embedding_text: 'x', parent_symbol: 'A' });
    const after = chunk({ language: 'javascript', relative_path: 's.js', embedding_text: 'x', parent_symbol: 'B' });
    expect(chunkInputHashes(before).metadata_fingerprint)
      .not.toBe(chunkInputHashes(after).metadata_fingerprint);
  });

  it('embedding hash unchanged when only metadata fingerprint moves', () => {
    const before = chunk({ language: 'javascript', relative_path: 's.js', embedding_text: 'x', parent_symbol: 'A' });
    const after = chunk({ language: 'javascript', relative_path: 's.js', embedding_text: 'x', parent_symbol: 'B' });
    expect(chunkInputHashes(before).embedding_input_hash)
      .toBe(chunkInputHashes(after).embedding_input_hash);
  });
});

describe('encoder-input / normalizePathSlug', () => {
  it('drops file extensions and converts slashes to dots', () => {
    expect(normalizePathSlug('src/main/Foo.java')).toBe('src.main.foo');
    expect(normalizePathSlug('a/b/c.tsx')).toBe('a.b.c');
    expect(normalizePathSlug('./Foo.kt')).toBe('foo');
  });
});
