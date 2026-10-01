// An incrementally maintained code graph must resolve call/type edges exactly
// as a fresh full build of the same files does — including edges INTO a file
// whose definitions were edited, added or deleted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake-e2e', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

describe('incremental graph edge resolution matches a full build', () => {
  let projectRoot;
  let stateDir;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-edge-parity-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const write = (rel, lines) => writeFileSync(join(projectRoot, rel), lines.join('\n'));
  const enqueue = (...rels) => writeFileSync(
    join(stateDir, 'index-maintainer-queue.jsonl'),
    rels.map((file_path) => JSON.stringify({ file_path })).join('\n') + '\n',
  );
  const tick = () => runProductionReconcileTick({
    projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO, logger: silentLogger,
    config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
  });

  // Full and incremental builds mint different entity ids; compare entities
  // by what they are (file, type, name, line). File nodes exist only in the
  // incremental graph, so file-level sources compare as 'file'.
  function entityKeys(db) {
    return new Map(db.prepare("SELECT id, file_path, type, name, start_line FROM entities WHERE type != 'file'").all()
      .map((e) => [e.id, `${e.file_path}#${e.type}:${e.name}@${e.start_line}`]));
  }

  /** Live edges of the maintained graph as (source, target) entity tuples. */
  function incrementalEdges() {
    const db = new Database(join(stateDir, 'code-graph.db'), { readonly: true });
    try {
      const key = entityKeys(db);
      return db.prepare("SELECT source_id, target_id, type, target_name FROM relationships WHERE epoch_retired IS NULL AND type IN ('calls','extends','implements','uses','overrides','throws','imports')").all()
        .map((r) => `${r.type} ${key.get(r.source_id) || 'file'} -> ${r.target_id ? key.get(r.target_id) || 'missing' : 'null'} (${r.target_name})`)
        .sort();
    } finally {
      db.close();
    }
  }

  /** The same files built from scratch with the full pass. */
  async function fullBuildEdges(files) {
    const db = new Database(':memory:');
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor({ projectRoot, importResolver: createImportResolver({ projectRoot, files }) });
      const ents = [];
      const rels = [];
      for (const rel of files) {
        const out = await extractor.extractFromFile(rel, readFileSync(join(projectRoot, rel), 'utf-8'));
        ents.push(...out.entities);
        rels.push(...out.relationships);
      }
      insertGraph(db, ents, rels, fts, { syncFts: false });
      resolveRelationshipTargets(db);
      const key = entityKeys(db);
      return db.prepare("SELECT source_id, target_id, type, target_name FROM relationships WHERE type IN ('calls','extends','implements','uses','overrides','throws','imports')").all()
        .map((r) => `${r.type} ${key.get(r.source_id) || 'file'} -> ${r.target_id ? key.get(r.target_id) || 'missing' : 'null'} (${r.target_name})`)
        .sort();
    } finally {
      console.log = log;
      db.close();
    }
  }

  it('resolves new edges, rebinds edges into edited/added definitions, and unbinds deleted ones', async () => {
    write('src/store.ts', [
      'export class Store {',
      '  load(key: string) {',
      '    return key;',
      '  }',
      '}',
    ]);
    write('src/service.ts', [
      "import { Store } from './store';",
      'export class Service {',
      '  constructor(private store: Store) {}',
      '  run(key: string) {',
      '    return this.store.load(key) + this.store.save(key);',
      '  }',
      '}',
    ]);
    enqueue('src/store.ts', 'src/service.ts');
    await tick();
    const files = ['src/store.ts', 'src/service.ts'];
    let inc = incrementalEdges();
    expect(inc.some((e) => e.includes('(store.load)') && !e.includes('-> null'))).toBe(true);
    expect(inc).toEqual(await fullBuildEdges(files));

    // Edit the callee's file only: `load` changes signature (new physical id)
    // and `save` appears — service.ts's untouched edges must follow.
    write('src/store.ts', [
      'export class Store {',
      '  load(key: string, fallback?: string) {',
      '    return key ?? fallback;',
      '  }',
      '  save(key: string) {',
      '    return key;',
      '  }',
      '}',
    ]);
    enqueue('src/store.ts');
    await tick();
    inc = incrementalEdges();
    expect(inc.some((e) => e.includes('(store.save)') && !e.includes('-> null'))).toBe(true);
    expect(inc).toEqual(await fullBuildEdges(files));

    // Delete the callee's file: edges into it must stop pointing at retired ids.
    unlinkSync(join(projectRoot, 'src/store.ts'));
    enqueue('src/store.ts');
    await tick();
    inc = incrementalEdges();
    expect(inc.filter((e) => e.includes('(store.')).every((e) => e.includes('-> null'))).toBe(true);
    expect(inc).toEqual(await fullBuildEdges(['src/service.ts']));
  });
});
