// An incrementally maintained graph must hold the same tree-sitter doc
// comments and Go package-level var/const entities as a full build of the
// same files, and its three external-content FTS5 tables (entities_fts,
// entities_code_fts, entities_trigram) must stay in step with `entities`
// through edits and garbage collection.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { pruneRetiredEntities } from '../../core/incremental-indexing/infrastructure/graph-gc.mjs';
import { GraphExtractor, createGraphSchema, insertGraph, rebuildGraphFts } from '../../core/graph/graph-extractor.js';
import { GraphSearch } from '../../core/graph/graph-search.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake-e2e', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

const FTS_TABLES = ['entities_fts', 'entities_code_fts', 'entities_trigram'];

function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

/** Throws when an external-content FTS5 index disagrees with `entities`. */
function assertFtsInSync(db) {
  for (const table of FTS_TABLES) {
    expect(() => db.prepare(`INSERT INTO ${table}(${table}, rank) VALUES('integrity-check', 1)`).run(), table).not.toThrow();
  }
}

function entityRows(db, where = '') {
  return db.prepare(`SELECT file_path, type, name, start_line, end_line, signature, doc_comment
    FROM entities WHERE type != 'file' ${where} ORDER BY start_line, name`).all()
    .map((e) => `${e.file_path}#${e.type}:${e.name}@${e.start_line}-${e.end_line} sig=${e.signature} doc=${e.doc_comment}`);
}

describe('incremental graph keeps doc comments and Go var/const entities like a full build', () => {
  let projectRoot;
  let stateDir;
  const FILE = 'src/txn.go';

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-doc-parity-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const write = (lines) => writeFileSync(join(projectRoot, FILE), lines.join('\n'));
  const tick = async () => {
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: FILE })}\n`);
    await runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO, logger: silentLogger,
      config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  };

  async function fullBuildRows() {
    const db = new Database(':memory:');
    try {
      const out = await new GraphExtractor().extractFromFile(FILE, readFileSync(join(projectRoot, FILE), 'utf-8'));
      quiet(() => {
        const fts = createGraphSchema(db);
        insertGraph(db, out.entities, out.relationships, fts, { syncFts: false });
        rebuildGraphFts(db);
      });
      assertFtsInSync(db);
      return entityRows(db);
    } finally {
      db.close();
    }
  }

  const graphPath = () => join(stateDir, 'code-graph.db');

  function incrementalRows() {
    const db = new Database(graphPath(), { readonly: true });
    try {
      return entityRows(db, 'AND epoch_retired IS NULL');
    } finally {
      db.close();
    }
  }

  async function search(query, options) {
    const gs = new GraphSearch(graphPath());
    await gs.init();
    try {
      return (await gs.bm25SearchRaw(query, 10, options)).results.map((r) => r.name);
    } finally {
      gs.close();
    }
  }

  it('adds, edits and collects doc comments and var/const entities in step with a full build', async () => {
    write([
      'package txn',
      '',
      '// errPending is returned while older transactions are still open.',
      'var errPending = errors.New("pending transactions found")',
      '',
      'const (',
      '\t// maxRetries bounds the commit loop.',
      '\tmaxRetries = 3',
      '\tbackoffMs  = 10',
      ')',
      '',
      '// Commit applies the buffered mutations atomically.',
      'func Commit() error {',
      '\treturn errPending',
      '}',
    ]);
    await tick();
    let inc = incrementalRows();
    expect(inc).toEqual(await fullBuildRows());
    expect(inc.some((r) => r.includes('#variable:errPending@4') && r.includes('doc=errPending is returned'))).toBe(true);
    expect(inc.some((r) => r.includes('#const:maxRetries@8') && r.includes('doc=maxRetries bounds'))).toBe(true);
    expect(inc.some((r) => r.includes('#const:backoffMs@9') && r.endsWith('doc=null'))).toBe(true);
    expect(inc.some((r) => r.includes('#function:Commit@13') && r.includes('doc=Commit applies'))).toBe(true);

    // Edit: the var is renamed and every doc changes wording.
    write([
      'package txn',
      '',
      '// errBusy is returned while a rollback is still running.',
      'var errBusy = errors.New("rollback in progress")',
      '',
      'const (',
      '\t// maxRetries caps the retry loop.',
      '\tmaxRetries = 3',
      '\tbackoffMs  = 10',
      ')',
      '',
      '// Commit flushes the journal before returning.',
      'func Commit() error {',
      '\treturn errBusy',
      '}',
    ]);
    await tick();
    inc = incrementalRows();
    expect(inc).toEqual(await fullBuildRows());
    expect(inc.some((r) => r.includes('errPending'))).toBe(false);

    let db = new Database(graphPath());
    try {
      assertFtsInSync(db);
      // Garbage-collect every retired row: the FTS deletes must match.
      pruneRetiredEntities(db, Number.MAX_SAFE_INTEGER);
      expect(db.prepare('SELECT COUNT(*) AS n FROM entities WHERE epoch_retired IS NOT NULL').get().n).toBe(0);
      assertFtsInSync(db);
    } finally {
      db.close();
    }

    // Agent formats match the new doc text, never the old; other formats
    // never match doc text at all.
    expect(await search('journal flushes', { format: 'agent' })).toContain('Commit');
    expect(await search('buffered mutations', { format: 'agent' })).not.toContain('Commit');
    expect(await search('journal flushes')).not.toContain('Commit');
    expect(await search('errBusy')).toContain('errBusy');
  });

  it('fills entities_code_fts at once when a graph built before it opens for an incremental tick', async () => {
    write([
      'package txn',
      '',
      '// Commit flushes the journal before returning.',
      'func Commit() error {',
      '\treturn nil',
      '}',
    ]);
    await tick();
    let db = new Database(graphPath());
    try {
      db.exec('DROP TABLE entities_code_fts'); // the pre-change schema
      quiet(() => createGraphSchema(db));
      const live = db.prepare('SELECT COUNT(*) AS n FROM entities').get().n;
      expect(db.prepare('SELECT COUNT(*) AS n FROM entities_code_fts').get().n).toBe(live);
      expect(db.prepare('SELECT COUNT(*) AS n FROM entities_fts').get().n).toBe(live);
      assertFtsInSync(db);
    } finally {
      db.close();
    }
    expect(await search('Commit')).toContain('Commit');
  });
});
