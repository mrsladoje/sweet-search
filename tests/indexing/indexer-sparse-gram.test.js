import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __TEST__ as sparseGramTest } from '../../core/indexing/indexer-sparse-gram.js';
import { SPARSE_SYMBOL_MASKS } from '../../core/infrastructure/native-sparse-gram.js';
import { contentHashSync } from '../../core/incremental-indexing/infrastructure/hashing.mjs';
import { FALLBACK_WEIGHTS_ID } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';

function createVectorsDb({ withEpochRetired = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ss-sparse-gram-'));
  const db = new Database(join(dir, 'codebase.db'));
  db.exec(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      metadata TEXT
      ${withEpochRetired ? ', epoch_retired INTEGER' : ''}
    )
  `);
  const insert = db.prepare(withEpochRetired
    ? 'INSERT INTO vectors (id, file_path, metadata, epoch_retired) VALUES (?, ?, ?, ?)'
    : 'INSERT INTO vectors (id, file_path, metadata) VALUES (?, ?, ?)');
  return { dir, db, insert };
}

describe('indexer sparse-gram symbol masks', () => {
  let tmpDir = null;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it('ignores epoch-retired vector metadata when building per-file symbol masks', () => {
    const { dir, db, insert } = createVectorsDb({ withEpochRetired: true });
    tmpDir = dir;
    insert.run('old', 'src/service.js', JSON.stringify({ type: 'class' }), 5);
    insert.run('live', 'src/service.js', JSON.stringify({ type: 'function' }), null);

    try {
      const [mask] = sparseGramTest.collectFileSymbolMasksFromDb(db, ['src/service.js']);
      expect(mask & SPARSE_SYMBOL_MASKS.function).toBe(SPARSE_SYMBOL_MASKS.function);
      expect(mask & SPARSE_SYMBOL_MASKS.class).toBe(0);
    } finally {
      db.close();
    }
  });

  it('keeps legacy vector DBs without epoch_retired readable', () => {
    const { dir, db, insert } = createVectorsDb();
    tmpDir = dir;
    insert.run('legacy', 'src/legacy.js', JSON.stringify({ type: 'method' }));

    try {
      const [mask] = sparseGramTest.collectFileSymbolMasksFromDb(db, ['src/legacy.js']);
      expect(mask & SPARSE_SYMBOL_MASKS.method).toBe(SPARSE_SYMBOL_MASKS.method);
    } finally {
      db.close();
    }
  });

  it('assigns deterministic sparse weight ids for fallback and corpus-specific artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-sparse-gram-weights-'));
    tmpDir = dir;
    const artifactPath = join(dir, 'codebase-sparse-grams.idx');
    writeFileSync(artifactPath, Buffer.from('artifact bytes'));

    await expect(
      sparseGramTest.resolveSparseGramWeightsId({ usedFallbackWeights: true }, artifactPath),
    ).resolves.toBe(FALLBACK_WEIGHTS_ID);

    await expect(
      sparseGramTest.resolveSparseGramWeightsId({ usedFallbackWeights: false }, artifactPath),
    ).resolves.toBe(`corpus-bigram-v1-${contentHashSync(Buffer.from('artifact bytes'))}`);
  });

  it('preserves native sparse weight ids when napi exposes snake_case fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-sparse-gram-weights-'));
    tmpDir = dir;
    const artifactPath = join(dir, 'codebase-sparse-grams.idx');
    writeFileSync(artifactPath, Buffer.from('artifact bytes'));

    await expect(
      sparseGramTest.resolveSparseGramWeightsId({ weights_id: 'corpus-bigram-v1-native' }, artifactPath),
    ).resolves.toBe('corpus-bigram-v1-native');
  });
});
