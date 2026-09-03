/**
 * 2026-09-03: segmented (SSLX v3) late-interaction indexes carry no per-document
 * metadata, and stage-and-swap rebuilds left the alias sidecar under the staged
 * stub name. Both made ss-find packs on large repos render `:null-null`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodebaseRepository } from '../../core/infrastructure/codebase-repository.js';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';

let TMP;
beforeEach(() => { TMP = mkdtempSync(path.join(tmpdir(), 'li-meta-')); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('CodebaseRepository.getChunkMetaByIds', () => {
  it('returns LI-shaped metadata from the vectors table', () => {
    const dir = path.join(TMP, '.sweet-search'); mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'codebase.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT)');
    db.prepare('INSERT INTO vectors VALUES (?, ?, ?, ?)').run(
      'moto/iam/models.py:325-345:14', 'moto/iam/models.py', 'class ManagedPolicy:',
      JSON.stringify({ symbol: 'ManagedPolicy', chunk_type: 'class', line_start: 325, line_end: 345 }),
    );
    db.close();
    const repo = new CodebaseRepository(dbPath);
    const meta = repo.getChunkMetaByIds(['moto/iam/models.py:325-345:14', 'missing:1-1:0']);
    expect(meta.get('moto/iam/models.py:325-345:14')).toEqual({
      file: 'moto/iam/models.py', name: 'ManagedPolicy', type: 'class', startLine: 325, endLine: 345,
    });
    expect(meta.has('missing:1-1:0')).toBe(false);
    expect(repo.getChunkMetaByIds([]).size).toBe(0);
    repo.close();
  });
});

describe('LateInteractionIndex alias sidecar', () => {
  it('falls back to the staged `<index>.tmp.aliases.json` name left by old rebuilds', async () => {
    const indexPath = path.join(TMP, 'codebase-late-interaction.db');
    writeFileSync(indexPath + '.tmp.aliases.json', [
      JSON.stringify({ version: 2, count: 1 }),
      JSON.stringify({ aliasId: 'a.md:1-3:0', exemplarId: 'b.md:1-3:0', clusterId: 'c1', metadata: { file: 'a.md', startLine: 1, endLine: 3 } }),
    ].join('\n') + '\n');
    const li = new LateInteractionIndex({ indexPath, loadExisting: false });
    li.documents.set('b.md:1-3:0', {}); // orphan guard: the exemplar must exist
    await li._loadAliasSidecar();
    expect(li.aliasPointers.size).toBe(1);
    expect(li.aliasPointers.get('a.md:1-3:0').exemplarId).toBe('b.md:1-3:0');
  });

  it('prefers the canonical sidecar when both exist', async () => {
    const indexPath = path.join(TMP, 'codebase-late-interaction.db');
    const line = (id) => [JSON.stringify({ version: 2, count: 1 }), JSON.stringify({ aliasId: id, exemplarId: 'x:1-1:0', clusterId: 'c', metadata: {} })].join('\n') + '\n';
    writeFileSync(indexPath + '.aliases.json', line('canonical:1-1:0'));
    writeFileSync(indexPath + '.tmp.aliases.json', line('staged:1-1:0'));
    const li = new LateInteractionIndex({ indexPath, loadExisting: false });
    li.documents.set('x:1-1:0', {});
    await li._loadAliasSidecar();
    expect([...li.aliasPointers.keys()]).toEqual(['canonical:1-1:0']);
  });
});

import { mergeChunkLocationMaps } from '../../core/search/search-pattern-chunks.js';

describe('mergeChunkLocationMaps', () => {
  it('unions spans by chunk id and rebuilds the running max', () => {
    const li = new Map([['a.py', [{ startLine: 741, endLine: 741, id: 'a.py:741-741:33', type: 'code', name: null }]]]);
    const cb = new Map([
      ['a.py', [
        { startLine: 325, endLine: 344, id: 'a.py:325-344:13', type: 'class', name: 'X' },
        { startLine: 741, endLine: 741, id: 'a.py:741-741:33', type: 'code', name: null },
      ]],
      ['b.py', [{ startLine: 1, endLine: 9, id: 'b.py:1-9:0', type: 'function', name: 'f' }]],
    ]);
    const merged = mergeChunkLocationMaps(li, cb);
    expect(merged.get('a.py').map(i => i.id)).toEqual(['a.py:325-344:13', 'a.py:741-741:33']);
    expect(merged.get('a.py').map(i => i._maxEndSoFar)).toEqual([344, 741]);
    expect(merged.get('b.py')).toHaveLength(1);
    // Inputs are not mutated.
    expect(li.get('a.py')).toHaveLength(1);
  });
});
