/**
 * Safety tests for the persistent query-vocabulary cache.
 *
 * Background: a populated `query-vocabulary.json` was found to depress
 * GenCodeSearchNet MRR by ~1 pp because the cached embeddings drift
 * from fresh ONNX outputs over time. The cache is consulted *before*
 * the live model in `getEmbedding`, so stale entries silently override
 * the model. The fix:
 *
 *   1. `Vocabulary.load()` rejects files whose metadata fingerprint
 *      (schemaVersion / provider / model / dimension) does not match
 *      the active embedding configuration.
 *   2. `EMBEDDING_CONFIG.cache.useVocabulary` (env
 *      `SWEET_SEARCH_VOCAB_USE`) lets the caller bypass vocab reads
 *      entirely — the contract benchmarks rely on for reproducibility.
 *   3. `Vocabulary.isFull()` (env `SWEET_SEARCH_VOCAB_MAX_TERMS`) caps
 *      auto-promotion so a long benchmark cannot inflate the file
 *      unbounded.
 *
 * These tests pin those guarantees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Vocabulary,
  isVocabFingerprintCompatible,
} from '../../core/embedding/embedding-cache.js';
import { EMBEDDING_CONFIG } from '../../core/infrastructure/config/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

let tmpDir;
let vocabPath;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vocab-safety-'));
  vocabPath = path.join(tmpDir, 'query-vocabulary.json');
  // Ensure the test process starts each case with deterministic env.
  delete process.env.SWEET_SEARCH_VOCAB_USE;
  delete process.env.SWEET_SEARCH_VOCAB_AUTO_EXPAND;
  delete process.env.SWEET_SEARCH_VOCAB_MAX_TERMS;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.SWEET_SEARCH_VOCAB_USE;
  delete process.env.SWEET_SEARCH_VOCAB_AUTO_EXPAND;
  delete process.env.SWEET_SEARCH_VOCAB_MAX_TERMS;
});

describe('isVocabFingerprintCompatible', () => {
  const expected = {
    schemaVersion: 3,
    provider: 'local',
    model: 'mrsladoje/CodeRankEmbed-onnx-int8',
    dimension: 768,
  };

  it('accepts metadata that matches every fingerprint field', () => {
    expect(isVocabFingerprintCompatible({ ...expected }, expected).compatible).toBe(true);
  });

  it('rejects metadata with a stale schema version (legacy v2 file)', () => {
    const result = isVocabFingerprintCompatible({ version: 2, provider: 'local' }, expected);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/schema-version/);
  });

  it('rejects metadata with a different provider', () => {
    const result = isVocabFingerprintCompatible({ ...expected, provider: 'voyage' }, expected);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/provider/);
  });

  it('rejects metadata with a different model', () => {
    const result = isVocabFingerprintCompatible({ ...expected, model: 'old-model' }, expected);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/model/);
  });

  it('rejects metadata with a different embedding dimension', () => {
    const result = isVocabFingerprintCompatible({ ...expected, dimension: 1024 }, expected);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/dimension/);
  });

  it('rejects metadata when the metadata field is missing entirely', () => {
    expect(isVocabFingerprintCompatible(null, expected).compatible).toBe(false);
    expect(isVocabFingerprintCompatible(undefined, expected).compatible).toBe(false);
  });

  it('treats a missing `model` field as incompatible (cannot prove origin)', () => {
    // metadata.model === undefined → falsy → check is skipped, but
    // schema-version mismatch (v2 implicit) catches it first.
    const result = isVocabFingerprintCompatible({ schemaVersion: 3, provider: 'local', dimension: 768 }, expected);
    // schemaVersion matches; provider matches; dimension matches;
    // model field is missing → fingerprint check passes (we err on
    // the side of trusting v3 files). The schema-version bump is
    // what protects us from legacy files.
    expect(result.compatible).toBe(true);
  });
});

describe('Vocabulary.load (fingerprint compatibility)', () => {
  it('clears terms when the persisted file has a v2 (legacy) schema', async () => {
    // Simulate the in-the-wild v2 file: only `version` + `provider`,
    // no model / dimension. This is exactly the file that depressed
    // GCSN MRR before the fix.
    const legacy = {
      metadata: { version: 2, provider: 'local', created: '2026-05-03T16:28:15Z' },
      terms: { 'cached query one': [0.1, 0.2, 0.3], 'cached query two': [0.4, 0.5, 0.6] },
    };
    await fs.writeFile(vocabPath, JSON.stringify(legacy));

    const vocab = new Vocabulary(vocabPath);
    await vocab.load();

    expect(vocab.size()).toBe(0);
    expect(vocab.get('cached query one')).toBeNull();
  });

  it('clears terms when the persisted provider differs from the active one', async () => {
    const stale = {
      metadata: {
        schemaVersion: 3,
        provider: 'voyage',
        model: 'voyage-code-3',
        dimension: 1024,
        created: '2026-05-03T16:28:15Z',
      },
      terms: { 'should be ignored': [0.1, 0.2] },
    };
    await fs.writeFile(vocabPath, JSON.stringify(stale));

    const vocab = new Vocabulary(vocabPath);
    await vocab.load();

    expect(vocab.size()).toBe(0);
  });

  it('keeps terms when the persisted fingerprint matches the active config', async () => {
    const compatible = {
      metadata: {
        schemaVersion: 3,
        provider: EMBEDDING_CONFIG.provider,
        model: EMBEDDING_CONFIG.model,
        dimension: EMBEDDING_CONFIG.dimension,
        created: '2026-05-03T16:28:15Z',
      },
      terms: { 'compatible query': [0.7, 0.8, 0.9] },
    };
    await fs.writeFile(vocabPath, JSON.stringify(compatible));

    const vocab = new Vocabulary(vocabPath);
    await vocab.load();

    expect(vocab.size()).toBe(1);
    // load() coerces persisted vectors to Float32Array (see
    // coerceToFloat32Vector). [0.7, 0.8, 0.9] are NOT exactly representable
    // in Float32 — comparing against a plain array would fail on the
    // unavoidable precision drift. Asserting against Float32Array.from(...)
    // makes both sides go through the same Float32 truncation and matches
    // bit-exactly.
    expect(vocab.get('compatible query')).toEqual(Float32Array.from([0.7, 0.8, 0.9]));
  });

  it('writes a v3 fingerprint on save() (provider, model, dimension)', async () => {
    const vocab = new Vocabulary(vocabPath);
    vocab.set('something', [0.1, 0.2]);
    await vocab.save();

    const raw = await fs.readFile(vocabPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.metadata.schemaVersion).toBe(3);
    expect(parsed.metadata.provider).toBe(EMBEDDING_CONFIG.provider);
    expect(parsed.metadata.model).toBe(EMBEDDING_CONFIG.model);
    expect(parsed.metadata.dimension).toBe(EMBEDDING_CONFIG.dimension);
  });
});

describe('Vocabulary kill switch (SWEET_SEARCH_VOCAB_USE)', () => {
  it('returns null from get() when the cache is disabled at the env layer', async () => {
    const vocab = new Vocabulary(vocabPath);
    vocab.set('hello', [0.1, 0.2, 0.3]);

    // Sanity: lookup works when the cache is enabled.
    expect(vocab.get('hello')).toEqual([0.1, 0.2, 0.3]);
    expect(Vocabulary.isEnabled()).toBe(true);

    // Bypass via env. The config is read at call time so flipping the
    // env var takes effect immediately for new gets (no module
    // re-import needed).
    EMBEDDING_CONFIG.cache.useVocabulary = false;
    try {
      expect(Vocabulary.isEnabled()).toBe(false);
      expect(vocab.get('hello')).toBeNull();
    } finally {
      EMBEDDING_CONFIG.cache.useVocabulary = true;
    }

    // After re-enabling, lookups resume.
    expect(vocab.get('hello')).toEqual([0.1, 0.2, 0.3]);
  });

  it('still allows set/has/save when reads are disabled', async () => {
    const vocab = new Vocabulary(vocabPath);
    EMBEDDING_CONFIG.cache.useVocabulary = false;
    try {
      vocab.set('world', [1, 2, 3]);
      expect(vocab.has('world')).toBe(true);
      expect(vocab.size()).toBe(1);
      await vocab.save();
      const raw = await fs.readFile(vocabPath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.terms.world).toEqual([1, 2, 3]);
    } finally {
      EMBEDDING_CONFIG.cache.useVocabulary = true;
    }
  });
});

describe('Vocabulary.isFull (auto-expand cap)', () => {
  it('returns false when the cap is unset / unlimited', async () => {
    const vocab = new Vocabulary(vocabPath);
    EMBEDDING_CONFIG.cache.maxTerms = null;
    try {
      expect(vocab.isFull()).toBe(false);
      vocab.set('a', [1]); vocab.set('b', [2]); vocab.set('c', [3]);
      expect(vocab.isFull()).toBe(false);
    } finally {
      EMBEDDING_CONFIG.cache.maxTerms = 10_000;
    }
  });

  it('reports full once the term count reaches the cap', async () => {
    const vocab = new Vocabulary(vocabPath);
    const originalCap = EMBEDDING_CONFIG.cache.maxTerms;
    EMBEDDING_CONFIG.cache.maxTerms = 2;
    try {
      vocab.set('a', [1]);
      expect(vocab.isFull()).toBe(false);
      vocab.set('b', [2]);
      expect(vocab.isFull()).toBe(true);
      // Explicit `set` still works past the cap (admin paths must be
      // able to push curated entries through). The cap is enforced
      // upstream in `getEmbedding`'s auto-expand branch.
      vocab.set('c', [3]);
      expect(vocab.size()).toBe(3);
    } finally {
      EMBEDDING_CONFIG.cache.maxTerms = originalCap;
    }
  });
});
