// File nodes (core/graph/file-nodes.js): a fresh full build and an
// incrementally maintained graph of the same files hold the SAME file nodes
// (`files` table, same ids) and the same file-sourced edges and bare call
// sites — through add, edit, rename and delete. File nodes never appear in
// `entities`, and ss-trace lists top-level code as a `(top-level)` caller in
// both graphs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';
import { fileNodeId } from '../../core/graph/file-nodes.js';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake-e2e', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

describe('file nodes: full build and maintained graph agree', () => {
  let projectRoot;
  let stateDir;
  let fullDbPath;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-file-nodes-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    fullDbPath = join(projectRoot, 'full-graph.db');
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

  /**
   * What a graph says about files: live file nodes, file-sourced edges and
   * bare call sites (keyed by the file's path), and any `file` entity rows.
   */
  function fileView(dbPath, { live }) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const liveSql = live ? ' AND epoch_retired IS NULL' : '';
      const nodes = db.prepare(`SELECT id, file_path, name FROM files WHERE 1=1${liveSql}`).all()
        .map((f) => `${f.id} ${f.file_path} ${f.name}`).sort();
      const pathOf = new Map(db.prepare(`SELECT id, file_path FROM files WHERE 1=1${liveSql}`).all().map((f) => [f.id, f.file_path]));
      const entityKey = new Map(db.prepare("SELECT id, file_path, type, name, start_line FROM entities").all()
        .map((e) => [e.id, `${e.file_path}#${e.type}:${e.name}@${e.start_line}`]));
      const edges = db.prepare(`SELECT source_id, target_id, type, target_name, context_line FROM relationships WHERE 1=1${liveSql}`).all()
        .filter((r) => pathOf.has(r.source_id))
        .map((r) => `${r.type} file:${pathOf.get(r.source_id)} -> ${r.target_id ? entityKey.get(r.target_id) || 'missing' : 'null'} (${r.target_name})@${r.context_line}`)
        .sort();
      const sites = db.prepare(`SELECT source_id, callee_name, context_line FROM call_sites WHERE 1=1${liveSql}`).all()
        .filter((c) => pathOf.has(c.source_id))
        .map((c) => `file:${pathOf.get(c.source_id)} ${c.callee_name}@${c.context_line}`)
        .sort();
      const fileEntities = db.prepare(`SELECT COUNT(*) AS n FROM entities WHERE type = 'file'${live ? ' AND epoch_retired IS NULL' : ''}`).get().n;
      return { nodes, edges, sites, fileEntities };
    } finally {
      db.close();
    }
  }

  /** The same files built from scratch by the full pass (as indexer-build does). */
  async function fullBuild(files) {
    rmSync(fullDbPath, { force: true });
    const db = new Database(fullDbPath);
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot, files }) });
      const ents = [];
      const rels = [];
      const sites = [];
      const nodes = [];
      for (const rel of files) {
        const out = await extractor.extractFromFile(rel, readFileSync(join(projectRoot, rel), 'utf-8'));
        ents.push(...out.entities);
        rels.push(...out.relationships);
        sites.push(...(out.callSites || []));
        nodes.push(out.file);
      }
      insertGraph(db, ents, rels, fts, { syncFts: false, callSites: sites, files: nodes });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
      db.close();
    }
    return fileView(fullDbPath, { live: false });
  }

  const maintained = () => fileView(join(stateDir, 'code-graph.db'), { live: true });

  /** Callers of `name` (defined in `file`) as ss-trace lists them. */
  function tracedCallers(dbPath, file, name) {
    const repo = new StructuralContextRepository(dbPath, { projectRoot });
    try {
      const target = repo.findEntityCandidates(name, { filePath: file, limit: 5 })
        .find((c) => c.name === name && c.filePath === file);
      expect(target).toBeTruthy();
      return [...repo.getCallers(target), ...repo.getBareCallers(target)]
        .map((c) => `${c.name} [${c.type}] ${c.filePath}:${c.startLine} call@${c.contextLine}`)
        .sort();
    } finally {
      repo.close();
    }
  }

  it('same file nodes and file-sourced edges through add, edit, barrel, rename and delete', async () => {
    write('src/lib.js', [
      'export function boot(cfg) {',
      '  return cfg;',
      '}',
      'export function helper() {',
      '  return 1;',
      '}',
    ]);
    write('src/main.js', [
      "import { boot, helper } from './lib.js';",
      'const app = { start() { return 1; } };',
      'boot({ port: 1 });',
      'app.start();',
      'helper();',
    ]);
    enqueue('src/lib.js', 'src/main.js');
    await tick();
    let files = ['src/lib.js', 'src/main.js'];
    let inc = maintained();
    let full = await fullBuild(files);
    expect(inc.fileEntities).toBe(0);
    expect(full.fileEntities).toBe(0);
    expect(inc.nodes).toEqual(full.nodes);
    expect(inc.nodes.map((n) => n.split(' ')[1]).sort()).toEqual(['src/lib.js', 'src/main.js']);
    expect(inc.nodes).toContain(`${fileNodeId('src/lib.js')} src/lib.js lib.js`);
    expect(inc.edges).toEqual(full.edges);
    expect(inc.sites).toEqual(full.sites);
    expect(inc.edges.some((e) => e.startsWith('importsFile file:src/main.js'))).toBe(true);

    // Top-level calls are callers in BOTH graphs: `boot(...)` at line 3.
    const fromFull = tracedCallers(fullDbPath, 'src/lib.js', 'boot');
    const fromInc = tracedCallers(join(stateDir, 'code-graph.db'), 'src/lib.js', 'boot');
    expect(fromFull).toEqual(['(top-level) [file] src/main.js:3 call@3']);
    expect(fromInc).toEqual(fromFull);

    // Edit the script: the node stays (same row, same epoch), edges follow.
    write('src/main.js', [
      "import { boot } from './lib.js';",
      'boot({ port: 2 });',
      'boot({ port: 3 });',
    ]);
    enqueue('src/main.js');
    await tick();
    inc = maintained();
    full = await fullBuild(files);
    expect(inc.nodes).toEqual(full.nodes);
    expect(inc.edges).toEqual(full.edges);
    expect(inc.sites).toEqual(full.sites);
    expect(tracedCallers(join(stateDir, 'code-graph.db'), 'src/lib.js', 'boot'))
      .toEqual(tracedCallers(fullDbPath, 'src/lib.js', 'boot'));

    // A barrel with no symbols still gets a node (it imports, so its edges need a source).
    write('src/index.js', ["export * from './lib.js';"]);
    enqueue('src/index.js');
    await tick();
    files = ['src/index.js', 'src/lib.js', 'src/main.js'];
    inc = maintained();
    full = await fullBuild(files);
    expect(inc.nodes).toEqual(full.nodes);
    expect(inc.nodes.some((n) => n.includes(' src/index.js '))).toBe(true);
    expect(inc.edges).toEqual(full.edges);

    // Rename the script (delete + add under a new path).
    unlinkSync(join(projectRoot, 'src/main.js'));
    write('src/app.js', ["import { boot } from './lib.js';", 'boot({});']);
    enqueue('src/main.js', 'src/app.js');
    await tick();
    files = ['src/app.js', 'src/index.js', 'src/lib.js'];
    inc = maintained();
    full = await fullBuild(files);
    expect(inc.nodes).toEqual(full.nodes);
    expect(inc.nodes.some((n) => n.includes(' src/main.js '))).toBe(false);
    expect(inc.edges).toEqual(full.edges);
    expect(inc.sites).toEqual(full.sites);

    // Delete: the node is retired (kept for pinned readers), not live.
    unlinkSync(join(projectRoot, 'src/index.js'));
    enqueue('src/index.js');
    await tick();
    files = ['src/app.js', 'src/lib.js'];
    inc = maintained();
    full = await fullBuild(files);
    expect(inc.nodes).toEqual(full.nodes);
    expect(inc.edges).toEqual(full.edges);
    const all = fileView(join(stateDir, 'code-graph.db'), { live: false });
    expect(all.nodes.some((n) => n.includes(' src/index.js '))).toBe(true);
  });

  it('retires a file row that an older maintainer wrote into entities', async () => {
    write('src/run.js', ['function go() { return 1; }', 'go();']);
    enqueue('src/run.js');
    await tick();
    // Simulate a graph maintained before file nodes moved to `files`: a live
    // `file` entity for the script.
    const dbPath = join(stateDir, 'code-graph.db');
    const db = new Database(dbPath);
    db.prepare(`INSERT INTO entities (id, file_path, type, name, start_line, end_line, logical_entity_id, epoch_written)
      VALUES (?, 'src/run.js', 'file', 'run.js', 1, 2, ?, 1)`).run(`${fileNodeId('src/run.js')}@e1`, fileNodeId('src/run.js'));
    db.close();
    expect(fileView(dbPath, { live: true }).fileEntities).toBe(1);

    write('src/run.js', ['function go() { return 2; }', 'go();']);
    enqueue('src/run.js');
    await tick();
    const inc = maintained();
    expect(inc.fileEntities).toBe(0);
    expect(inc.nodes.map((n) => n.split(' ')[1])).toEqual(['src/run.js']);
  });
});
