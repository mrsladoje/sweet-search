// chunk_text_fts (codebase.db): BM25 over chunk bodies for the body-text
// lexical channel. An incrementally maintained index must hold the same FTS
// rows as a full build of the same files, through edits, deletes, garbage
// collection and INSERT OR REPLACE. The query side must see only live,
// non-alias rows.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { pruneRetiredVectors } from '../../core/incremental-indexing/infrastructure/vector-gc.mjs';
import { createVectorSchema, ensureVectorSchema, buildInsertItems, insertVectorItems } from '../../core/indexing/indexer-build.js';
import { ASTChunker } from '../../core/indexing/ast-chunker.js';
import { CodebaseRepository } from '../../core/infrastructure/codebase-repository.js';
import {
  CHUNK_TEXT_FTS_MAX_CHARS,
  buildChunkTextQueries,
  chunkTextFtsDocument,
  splitCamelIdentifier,
} from '../../core/indexing/chunk-text-fts.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake-e2e', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

/** Throws when the FTS5 index is internally inconsistent. */
function assertFtsIntegrity(db) {
  expect(() => db.prepare("INSERT INTO chunk_text_fts(chunk_text_fts, rank) VALUES('integrity-check', 0)").run()).not.toThrow();
}

/**
 * Multiset of `<file>:<start>-<end>` + indexed tokens (column, offset, term)
 * for every visible vectors row. Row ids differ between a full build and an
 * incremental update, so rows are compared by location and content only.
 */
function ftsRows(db, { liveOnly = true } = {}) {
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.ctf_vocab USING fts5vocab(main, 'chunk_text_fts', 'instance')");
  const tokens = new Map();
  for (const t of db.prepare('SELECT term, doc, col, offset FROM temp.ctf_vocab').all()) {
    if (!tokens.has(t.doc)) tokens.set(t.doc, []);
    tokens.get(t.doc).push(`${t.col}:${t.offset}:${t.term}`);
  }
  const where = liveOnly ? 'WHERE epoch_retired IS NULL' : '';
  const rows = db.prepare(`SELECT rowid, file_path, metadata FROM vectors ${where}`).all();
  return rows.map((r) => {
    const m = JSON.parse(r.metadata || '{}');
    return `${r.file_path}:${m.startLine}-${m.endLine}\n${(tokens.get(r.rowid) || []).sort().join(' ')}`;
  }).sort();
}

function ftsDocCount(db) {
  return db.prepare('SELECT count(*) AS n FROM chunk_text_fts_docsize').get().n;
}

describe('chunk-text FTS document', () => {
  it('splits camelCase identifiers into subtokens and keeps the body whole', () => {
    expect(splitCamelIdentifier('errHasPendingTxns')).toEqual(['err', 'Has', 'Pending', 'Txns']);
    expect(splitCamelIdentifier('HTTPServerError')).toEqual(['HTTP', 'Server', 'Error']);
    expect(splitCamelIdentifier('snake_case_only')).toBeNull();
    expect(splitCamelIdentifier('lower')).toBeNull();
    const doc = chunkTextFtsDocument('return errHasPendingTxns // errHasPendingTxns\nx := "Pending transactions found"');
    expect(doc.body).toContain('"Pending transactions found"');
    expect(doc.subtokens).toBe('err has pending txns');
    expect(chunkTextFtsDocument('x'.repeat(CHUNK_TEXT_FTS_MAX_CHARS + 50)).body.length).toBe(CHUNK_TEXT_FTS_MAX_CHARS);
  });

  it('builds a body phrase and an any-word query', () => {
    const q = buildChunkTextQueries('Pending transactions found. Please retry operation');
    expect(q.phrase).toBe('{body} : "pending transactions found please retry operation"');
    expect(q.or).toBe('"pending" OR "transactions" OR "found" OR "please" OR "retry" OR "operation"');
    expect(buildChunkTextQueries('how is the error raised').or).toBe('"error" OR "raised"');
    expect(buildChunkTextQueries('').phrase).toBeNull();
  });
});

describe('chunk-text FTS stays a function of the vectors table', () => {
  let projectRoot;
  let stateDir;
  const FILES = ['src/txn.go', 'src/retry.go'];

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-chunk-fts-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const sources = new Map();
  const write = (file, lines) => {
    const text = lines.join('\n');
    sources.set(file, text);
    writeFileSync(join(projectRoot, file), text);
  };
  const remove = (file) => {
    sources.delete(file);
    rmSync(join(projectRoot, file), { force: true });
  };
  const tick = async (files) => {
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), files.map((f) => `${JSON.stringify({ file_path: f })}\n`).join(''));
    await runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO, logger: silentLogger,
      config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  };
  const codebasePath = () => join(stateDir, 'codebase.db');

  /** A full build of the current files: chunk, then the full-build insert path. */
  async function fullBuildRows() {
    const db = new Database(':memory:');
    try {
      createVectorSchema(db);
      for (const [file, text] of [...sources.entries()].sort()) {
        const parsed = await new ASTChunker({ projectRoot }).parseFile(file, text);
        const chunks = parsed.map((chunk, i) => ({
          ...chunk,
          file,
          id: `${file}:${chunk.metadata?.line_start || 0}-${chunk.metadata?.line_end || chunk.metadata?.line_start || 0}:${i}`,
        }));
        const embeddings = await vectorEncoder(chunks.map((c) => c.text || c.content || ''));
        insertVectorItems(db, buildInsertItems(chunks, embeddings, MODEL_INFO));
      }
      assertFtsIntegrity(db);
      expect(ftsDocCount(db)).toBe(db.prepare('SELECT count(*) AS n FROM vectors').get().n);
      return ftsRows(db);
    } finally {
      db.close();
    }
  }

  function withDb(fn) {
    const db = new Database(codebasePath());
    try { return fn(db); } finally { db.close(); }
  }

  it('matches a full build through adds, edits, deletes and GC', async () => {
    write(FILES[0], [
      'package txn',
      '',
      'var errHasPendingTxns = errors.New("Pending transactions found. Please retry operation")',
      '',
      'func Commit(pendingCount int) error {',
      '\tif pendingCount > 0 {',
      '\t\treturn errHasPendingTxns',
      '\t}',
      '\treturn nil',
      '}',
    ]);
    write(FILES[1], [
      'package txn',
      '',
      'func RetryLater(attempt int) error {',
      '\tlog.Printf("retrying commit, attempt %d", attempt)',
      '\treturn nil',
      '}',
    ]);
    await tick(FILES);
    withDb((db) => {
      assertFtsIntegrity(db);
      expect(ftsRows(db)).toHaveLength(db.prepare('SELECT count(*) AS n FROM vectors WHERE epoch_retired IS NULL').get().n);
    });
    expect(withDb(ftsRows)).toEqual(await fullBuildRows());

    // Edit: the message changes; the old text must leave the visible index.
    write(FILES[0], [
      'package txn',
      '',
      'var errHasPendingTxns = errors.New("Transactions still open; abort them first")',
      '',
      'func Commit(pendingCount int) error {',
      '\tif pendingCount > 0 {',
      '\t\treturn errHasPendingTxns',
      '\t}',
      '\treturn nil',
      '}',
    ]);
    await tick([FILES[0]]);
    withDb(assertFtsIntegrity);
    expect(withDb(ftsRows)).toEqual(await fullBuildRows());

    // Delete a file.
    remove(FILES[1]);
    await tick([FILES[1]]);
    withDb(assertFtsIntegrity);
    expect(withDb(ftsRows)).toEqual(await fullBuildRows());

    // GC removes every retired row; its FTS row goes with it.
    withDb((db) => {
      expect(db.prepare('SELECT count(*) AS n FROM vectors WHERE epoch_retired IS NOT NULL').get().n).toBeGreaterThan(0);
      pruneRetiredVectors(db, Number.MAX_SAFE_INTEGER);
      expect(db.prepare('SELECT count(*) AS n FROM vectors WHERE epoch_retired IS NOT NULL').get().n).toBe(0);
      expect(ftsDocCount(db)).toBe(db.prepare('SELECT count(*) AS n FROM vectors').get().n);
      assertFtsIntegrity(db);
      expect(ftsRows(db, { liveOnly: false })).toEqual(ftsRows(db));
    });
    expect(withDb(ftsRows)).toEqual(await fullBuildRows());

    // The query side sees the new message and never the old one.
    const repo = new CodebaseRepository(codebasePath());
    try {
      const hit = (q) => repo.searchChunkText(buildChunkTextQueries(q).phrase, 5).map((r) => r.file_path);
      expect(hit('Transactions still open; abort them first')).toEqual(['src/txn.go']);
      expect(hit('Pending transactions found. Please retry operation')).toEqual([]);
      expect(hit('retrying commit, attempt')).toEqual([]);
      // Subtokens reach a camelCase identifier from plain words.
      const or = repo.searchChunkText(buildChunkTextQueries('has pending txns').or, 5);
      expect(or.map((r) => r.file_path)).toContain('src/txn.go');
    } finally {
      repo.close();
    }
  });

  it('leaves an index without the table as it is, and search skips the channel', async () => {
    write(FILES[0], [
      'package txn',
      '',
      'func Abort() error {',
      '\treturn errors.New("predicate is being moved, mutation rejected")',
      '}',
    ]);
    await tick([FILES[0]]);
    withDb((db) => {
      db.exec('DROP TRIGGER chunk_text_fts_vectors_bi; DROP TRIGGER chunk_text_fts_vectors_ad; DROP TRIGGER chunk_text_fts_vectors_au; DROP TABLE chunk_text_fts;');
      ensureVectorSchema(db);
      expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'chunk_text_fts%'").get().n).toBe(0);
    });
    write(FILES[0], ['package txn', '', 'func Abort() error {', '\treturn errors.New("mutation rejected")', '}']);
    await tick([FILES[0]]);
    const repo = new CodebaseRepository(codebasePath());
    try {
      expect(repo.searchChunkText(buildChunkTextQueries('mutation rejected').phrase, 5)).toEqual([]);
    } finally {
      repo.close();
    }
  });

  it('keeps one FTS row per vector row under INSERT OR REPLACE and skips alias rows at query time', async () => {
    const db = new Database(':memory:');
    try {
      createVectorSchema(db);
      const chunk = (id, text, extra = {}) => ({
        id, file: 'src/a.js', text, content: text,
        metadata: { relative_path: 'src/a.js', language: 'javascript', chunk_type: 'function', symbol: id, line_start: 1, line_end: 3, ...extra },
      });
      insertVectorItems(db, buildInsertItems([chunk('a', 'throw new Error("config key missing: server.port")')], [[1, 0, 0, 0]], MODEL_INFO));
      insertVectorItems(db, buildInsertItems([chunk('a', 'throw new Error("listen address already in use")')], [[1, 0, 0, 0]], MODEL_INFO));
      expect(db.prepare('SELECT count(*) AS n FROM vectors').get().n).toBe(1);
      expect(ftsDocCount(db)).toBe(1);
      assertFtsIntegrity(db);
      const phrase = (q) => db.prepare('SELECT rowid FROM chunk_text_fts WHERE chunk_text_fts MATCH ?').all(buildChunkTextQueries(q).phrase).length;
      expect(phrase('config key missing')).toBe(0);
      expect(phrase('listen address already in use')).toBe(1);
      // snake/dotted keys: the tokenizer splits them and the phrase rejoins them.
      insertVectorItems(db, buildInsertItems([chunk('b', 'cfg.get("server.port")')], [[1, 0, 0, 0]], MODEL_INFO));
      expect(phrase('server.port')).toBe(1);
    } finally {
      db.close();
    }

    // Alias rows (dedup) are not returned: their exemplar is.
    write(FILES[0], ['package txn', '', 'func A() error {', '\treturn errors.New("duplicate body text here")', '}']);
    await tick([FILES[0]]);
    withDb((db) => {
      const row = db.prepare('SELECT id, metadata FROM vectors WHERE epoch_retired IS NULL LIMIT 1').get();
      const meta = JSON.parse(row.metadata);
      db.prepare('UPDATE vectors SET metadata = ? WHERE id = ?').run(JSON.stringify({ ...meta, isExemplar: false }), row.id);
    });
    const repo = new CodebaseRepository(codebasePath());
    try {
      expect(repo.searchChunkText(buildChunkTextQueries('duplicate body text here').phrase, 5)).toEqual([]);
    } finally {
      repo.close();
    }
  });
});
