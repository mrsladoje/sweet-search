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
import {
  DEDUP_INPUT_POLICY_VERSION,
  EMBED_TEXT_POLICY_VERSION,
  LI_INPUT_POLICY_VERSION,
} from '../../core/incremental-indexing/domain/encoder-input.mjs';
import { ensureEncoderDepsSchema } from '../../core/incremental-indexing/infrastructure/schema-migrations.mjs';

function symbolChunk({
  relative_path,
  parent_symbol,
  parent_type,
  language = 'javascript',
  symbol = 'foo',
  signature = 'function foo() {}',
  additional_symbols = ['bar'],
  clusterId,
  exemplarId,
  liReuseEligible,
}) {
  return {
    metadata: {
      relative_path,
      parent_symbol,
      parent_type,
      language,
      symbol,
      chunk_type: 'function',
      signature,
      additional_symbols,
      clusterId,
      exemplarId,
      liReuseEligible,
    },
  };
}

describe('encoder-deps / collectChunkDependencies', () => {
  it('registers same-file path, metadata, enrichment, policy, and parent deps', () => {
    const c = symbolChunk({ relative_path: 'src/a.js', parent_symbol: 'Foo', parent_type: 'class' });
    const deps = collectChunkDependencies(c);
    const keys = deps.map((d) => d.dependency_key);
    expect(keys).toEqual(expect.arrayContaining([
      'path:src/a.js',
      'lang:src/a.js',
      'chunk-type:src/a.js',
      'symbol:src/a.js',
      'signature:src/a.js',
      'additional-symbols:src/a.js',
      'same-file-symbols:src/a.js',
      'same-file-imports:src/a.js',
      'same-file-scope:src/a.js',
      'parent:src/a.js:Foo',
      'parent-type:src/a.js:class',
      `policy:embed:${EMBED_TEXT_POLICY_VERSION}`,
      `policy:li:${LI_INPUT_POLICY_VERSION}`,
      `policy:dedup:${DEDUP_INPUT_POLICY_VERSION}`,
    ]));
    // Dense consumer always covers path, lang, scope. LI gets path/lang too.
    const consumersForPath = deps.filter((d) => d.dependency_key === 'path:src/a.js')
      .map((d) => d.consumer).sort();
    expect(consumersForPath).toEqual(['dense', 'li']);

    const consumersForSignature = deps.filter((d) => d.dependency_key === 'signature:src/a.js')
      .map((d) => d.consumer).sort();
    expect(consumersForSignature).toEqual(['dense', 'li']);
  });

  it('registers dedup cluster, exemplar, and LI-reuse deps for the dedup consumer', () => {
    const c = symbolChunk({
      relative_path: 'src/a.js',
      clusterId: 'cluster-1',
      exemplarId: 'chunk-exemplar',
      liReuseEligible: true,
    });
    const deps = collectChunkDependencies(c);
    expect(deps).toEqual(expect.arrayContaining([
      { dependency_key: 'dedup-cluster:cluster-1', consumer: 'dedup' },
      { dependency_key: 'dedup-exemplar:chunk-exemplar', consumer: 'dedup' },
      { dependency_key: 'dedup-li-reuse:cluster-1', consumer: 'dedup' },
    ]));
  });

  it('omits parent-symbol dep when no parent is known', () => {
    const c = symbolChunk({ relative_path: 'src/a.js' });
    const deps = collectChunkDependencies(c);
    expect(deps.find((d) => d.dependency_key.startsWith('parent:'))).toBeUndefined();
  });

  it('uses metadata.path before metadata.file for cold AST chunks', () => {
    const deps = collectChunkDependencies({
      metadata: {
        file: 'a.js',
        path: 'src/a.js',
        language: 'javascript',
        chunk_type: 'function',
        symbol: 'foo',
      },
    });
    const keys = deps.map((d) => d.dependency_key);

    expect(keys).toContain('path:src/a.js');
    expect(keys).not.toContain('path:a.js');
  });

  it('falls back to chunk.file for dependency keys when metadata has only basename file', () => {
    const deps = collectChunkDependencies({
      file: 'src/a.js',
      metadata: {
        file: 'a.js',
        language: 'javascript',
        chunk_type: 'function',
        symbol: 'foo',
      },
    });

    expect(deps.map((d) => d.dependency_key)).toContain('same-file-scope:src/a.js');
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
    expect(out.map((r) => r.consumer).sort()).toEqual(['dense', 'li']);
    expect(out.every((r) => r.file_path === 'src/a.js')).toBe(true);
    expect(out.every((r) => r.chunk_struct_id === 'chunk-1')).toBe(true);

    const policyDeps = dependentsOf(db, [`policy:embed:${EMBED_TEXT_POLICY_VERSION}`]);
    expect(policyDeps.length).toBe(2);
    expect(policyDeps.map((r) => r.chunk_struct_id).sort()).toEqual(['chunk-1', 'chunk-2']);
  });

  it('dependentsOf batches large key sets without duplicate dependents', () => {
    db.prepare(`
      INSERT INTO encoder_input_dependencies
        (dependency_key, file_path, chunk_struct_id, consumer)
      VALUES (?, ?, ?, ?)
    `).run('bulk-key-1177', 'src/bulk.js', 'chunk-bulk', 'dense');

    const keys = Array.from({ length: 1200 }, (_, i) => `bulk-key-${i}`);
    keys.push('bulk-key-1177');
    const out = dependentsOf(db, keys);

    expect(out).toEqual([
      { file_path: 'src/bulk.js', chunk_struct_id: 'chunk-bulk', consumer: 'dense' },
    ]);
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
