/**
 * Tests for core/incremental-indexing/domain/encoder-deps.mjs
 *
 * Covers plan § 7.2.1: dense / LI / dedup dependency registration,
 * change-set expansion, and the file-forget path.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  collectChunkDependencies,
  persistDependencies,
  dependentsOf,
  forgetFile,
} from '../../core/incremental-indexing/domain/encoder-deps.mjs';
import { ensureEncoderDepsSchema } from '../../core/incremental-indexing/infrastructure/schema-migrations.mjs';

function symbolChunk({ relative_path, parent_symbol, language = 'javascript', symbol = 'foo' }) {
  return {
    metadata: {
      relative_path,
      parent_symbol,
      language,
      symbol,
      chunk_type: 'function',
    },
  };
}

describe('encoder-deps / collectChunkDependencies', () => {
  it('registers same-file path, language, symbol, imports, and parent deps', () => {
    const c = symbolChunk({ relative_path: 'src/a.js', parent_symbol: 'Foo' });
    const deps = collectChunkDependencies(c);
    const keys = deps.map((d) => d.dependency_key);
    expect(keys).toEqual(expect.arrayContaining([
      'path:src/a.js',
      'lang:src/a.js',
      'same-file-symbols:src/a.js',
      'same-file-imports:src/a.js',
      'parent:src/a.js:Foo',
      'policy:embed',
      'policy:li',
      'policy:dedup',
    ]));
    // Dense consumer always covers path, lang, scope. LI gets path/lang too.
    const consumersForPath = deps.filter((d) => d.dependency_key === 'path:src/a.js')
      .map((d) => d.consumer).sort();
    expect(consumersForPath).toEqual(['dense', 'li']);
  });

  it('omits parent-symbol dep when no parent is known', () => {
    const c = symbolChunk({ relative_path: 'src/a.js' });
    const deps = collectChunkDependencies(c);
    expect(deps.find((d) => d.dependency_key.startsWith('parent:'))).toBeUndefined();
  });

  it('returns [] on null input', () => {
    expect(collectChunkDependencies(null)).toEqual([]);
  });
});

describe('encoder-deps / persistDependencies + dependentsOf', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    ensureEncoderDepsSchema(db);
  });

  it('writes one row per (key, consumer) pair', () => {
    const c = symbolChunk({ relative_path: 'src/a.js', parent_symbol: 'Foo' });
    const deps = collectChunkDependencies(c);
    persistDependencies(db, 'src/a.js', 'chunk-1', deps);

    const rows = db.prepare('SELECT * FROM encoder_input_dependencies').all();
    expect(rows.length).toBe(deps.length);
  });

  it('replaces previous rows for the same chunk', () => {
    const c1 = symbolChunk({ relative_path: 'src/a.js', parent_symbol: 'Foo' });
    persistDependencies(db, 'src/a.js', 'chunk-1', collectChunkDependencies(c1));
    const beforeCount = db.prepare(
      'SELECT COUNT(*) AS n FROM encoder_input_dependencies WHERE chunk_struct_id = ?',
    ).get('chunk-1').n;

    const c2 = symbolChunk({ relative_path: 'src/a.js' }); // no parent
    persistDependencies(db, 'src/a.js', 'chunk-1', collectChunkDependencies(c2));
    const afterCount = db.prepare(
      'SELECT COUNT(*) AS n FROM encoder_input_dependencies WHERE chunk_struct_id = ?',
    ).get('chunk-1').n;
    expect(afterCount).toBeLessThan(beforeCount);
    // Parent dep no longer present
    const hasParent = db.prepare(
      "SELECT 1 FROM encoder_input_dependencies WHERE dependency_key LIKE 'parent:%' AND chunk_struct_id = ?",
    ).get('chunk-1');
    expect(hasParent).toBeUndefined();
  });

  it('dependentsOf returns dependent chunks for a list of keys', () => {
    const c1 = symbolChunk({ relative_path: 'src/a.js', parent_symbol: 'Foo' });
    const c2 = symbolChunk({ relative_path: 'src/b.js' });
    persistDependencies(db, 'src/a.js', 'chunk-1', collectChunkDependencies(c1));
    persistDependencies(db, 'src/b.js', 'chunk-2', collectChunkDependencies(c2));

    const out = dependentsOf(db, ['same-file-imports:src/a.js']);
    expect(out.length).toBe(1);
    expect(out[0].file_path).toBe('src/a.js');
    expect(out[0].chunk_struct_id).toBe('chunk-1');
    expect(out[0].consumer).toBe('dense');

    const policyDeps = dependentsOf(db, ['policy:embed']);
    expect(policyDeps.length).toBe(2);
    expect(policyDeps.map((r) => r.chunk_struct_id).sort()).toEqual(['chunk-1', 'chunk-2']);
  });

  it('forgetFile drops every row for a single path', () => {
    const c1 = symbolChunk({ relative_path: 'src/a.js' });
    const c2 = symbolChunk({ relative_path: 'src/b.js' });
    persistDependencies(db, 'src/a.js', 'chunk-1', collectChunkDependencies(c1));
    persistDependencies(db, 'src/b.js', 'chunk-2', collectChunkDependencies(c2));
    forgetFile(db, 'src/a.js');
    const remaining = db.prepare('SELECT DISTINCT file_path FROM encoder_input_dependencies').all();
    expect(remaining.map((r) => r.file_path)).toEqual(['src/b.js']);
  });
});
