// Review of file nodes (core/graph/file-nodes.js): the edges whose source is
// a file node (imports, top-level calls) must RESOLVE the same in a maintained
// graph as in a full build; files with no symbols, only top-level code, or no
// content keep parity; a crash after the graph write is repaired by the next
// tick; an older graph without the `files` table works in every reader and
// shows top-level callers to a reader that was connected before the table
// appeared; GC prunes retired file nodes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';
import { fileNodeId, hasFilesTable } from '../../core/graph/file-nodes.js';
import { pruneRetiredFileNodes } from '../../core/incremental-indexing/infrastructure/graph-gc.mjs';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';
import { GraphSearch } from '../../core/graph/graph-search.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake-e2e', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

describe('file nodes review: resolution parity, edge cases, old graphs', () => {
  let projectRoot;
  let stateDir;
  let fullDbPath;
  let incDbPath;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-file-nodes-review-'));
    stateDir = join(projectRoot, '.sweet-search');
    for (const d of ['src', 'pkg', 'cmd']) mkdirSync(join(projectRoot, d), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    fullDbPath = join(projectRoot, 'full-graph.db');
    incDbPath = join(stateDir, 'code-graph.db');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const write = (rel, lines) => writeFileSync(join(projectRoot, rel), lines.join('\n'));
  const enqueue = (...rels) => writeFileSync(
    join(stateDir, 'index-maintainer-queue.jsonl'),
    rels.map((file_path) => JSON.stringify({ file_path })).join('\n') + '\n',
  );
  const tick = (extra = {}) => runProductionReconcileTick({
    projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO, logger: silentLogger,
    config: { filesPerTick: 20, cpuBudgetMs: 10_000 }, ...extra,
  });

  /** File-sourced edges and call sites with their RESOLVED target (by entity path#name). */
  function fileEdges(dbPath, { live }) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const liveSql = live ? ' AND epoch_retired IS NULL' : '';
      const pathOf = new Map(db.prepare(`SELECT id, file_path FROM files WHERE 1=1${liveSql}`).all().map((f) => [f.id, f.file_path]));
      const ent = new Map(db.prepare('SELECT id, file_path, name FROM entities').all().map((e) => [e.id, `${e.file_path}#${e.name}`]));
      const edges = db.prepare(`SELECT source_id, target_id, type, target_name, context_line FROM relationships WHERE 1=1${liveSql}`).all()
        .filter((r) => pathOf.has(r.source_id))
        .map((r) => `${r.type} ${pathOf.get(r.source_id)}:${r.context_line} ${r.target_name} -> ${r.target_id ? ent.get(r.target_id) || 'missing' : 'null'}`)
        .sort();
      const nullSources = db.prepare(`SELECT COUNT(*) AS n FROM relationships WHERE source_id IS NULL${liveSql}`).get().n;
      const nodes = [...pathOf.values()].sort();
      return { edges, nullSources, nodes };
    } finally {
      db.close();
    }
  }

  async function fullBuild(files) {
    rmSync(fullDbPath, { force: true });
    const db = new Database(fullDbPath);
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot, files }) });
      const ents = []; const rels = []; const sites = []; const nodes = [];
      for (const rel of files) {
        const out = await extractor.extractFromFile(rel, readFileSync(join(projectRoot, rel), 'utf-8'));
        ents.push(...out.entities); rels.push(...out.relationships); sites.push(...(out.callSites || [])); nodes.push(out.file);
      }
      insertGraph(db, ents, rels, fts, { syncFts: false, callSites: sites, files: nodes });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
      db.close();
    }
    return fileEdges(fullDbPath, { live: false });
  }

  function callerLines(dbPath, file, name) {
    const repo = new StructuralContextRepository(dbPath, { projectRoot });
    try {
      const target = repo.findEntityCandidates(name, { filePath: file, limit: 5 }).find((c) => c.name === name && c.filePath === file);
      expect(target).toBeTruthy();
      return [...repo.getCallers(target), ...repo.getBareCallers(target)]
        .map((c) => `${c.name} [${c.type}] ${c.filePath}:${c.startLine} call@${c.contextLine}`)
        .sort();
    } finally {
      repo.close();
    }
  }

  it('file-sourced edges resolve the same in the maintained graph (JS, Python, Go)', async () => {
    write('src/lib.js', ['export function helper() {', '  return 1;', '}', 'export class Svc { run() { return 2; } }']);
    write('src/main.js', ["import * as lib from './lib.js';", "import { Svc } from './lib.js';", 'lib.helper();', 'const s = new Svc();', 's.run();']);
    write('pkg/mod.py', ['def util():', '    return 1']);
    write('pkg/run.py', ['from pkg import mod', 'mod.util()']);
    write('cmd/tool.go', ['package main', '', 'import "fmt"', '', 'var x = fmt.Sprintf("a")']);
    const files = ['cmd/tool.go', 'pkg/mod.py', 'pkg/run.py', 'src/lib.js', 'src/main.js'];
    enqueue(...files);
    await tick();
    const full = await fullBuild(files);
    const inc = fileEdges(incDbPath, { live: true });
    expect(full.edges.some((e) => e.includes('lib.helper -> src/lib.js#helper'))).toBe(true);
    expect(full.edges.some((e) => e.includes('mod.util -> pkg/mod.py#util'))).toBe(true);
    expect(inc.edges).toEqual(full.edges);
    // Top-level qualified calls have the file node as their source, never NULL.
    expect(full.nullSources).toBe(0);
    expect(inc.nullSources).toBe(0);
    // ss-trace lists the Python script body as a caller of util, in both graphs.
    expect(callerLines(fullDbPath, 'pkg/mod.py', 'util')).toEqual(['(top-level) [file] pkg/run.py:2 call@2']);
    expect(callerLines(incDbPath, 'pkg/mod.py', 'util')).toEqual(callerLines(fullDbPath, 'pkg/mod.py', 'util'));

    // A later tick that adds the callee's definition rebinds the script's call.
    write('src/lib.js', ['export function helper() {', '  return 1;', '}', 'export function later() { return 3; }', 'export class Svc { run() { return 2; } }']);
    write('src/main.js', ["import * as lib from './lib.js';", "import { Svc } from './lib.js';", 'lib.helper();', 'const s = new Svc();', 's.run();', 'lib.later();']);
    enqueue('src/main.js');
    await tick();
    enqueue('src/lib.js');
    await tick();
    const full2 = await fullBuild(files);
    expect(full2.edges.some((e) => e.includes('lib.later -> src/lib.js#later'))).toBe(true);
    expect(fileEdges(incDbPath, { live: true }).edges).toEqual(full2.edges);
  });

  it('symbol-less, top-level-only and emptied files keep their node and parity', async () => {
    write('src/lib.js', ['export function boot() { return 1; }']);
    write('src/index.js', ["export * from './lib.js';"]);
    write('src/script.js', ["import { boot } from './lib.js';", 'boot();', 'boot();']);
    write('src/empty.js', ['']);
    let files = ['src/empty.js', 'src/index.js', 'src/lib.js', 'src/script.js'];
    enqueue(...files);
    await tick();
    let full = await fullBuild(files);
    let inc = fileEdges(incDbPath, { live: true });
    expect(inc.nodes).toEqual(files);
    expect(inc.nodes).toEqual(full.nodes);
    expect(inc.edges).toEqual(full.edges);

    // The script loses all its code: the file still exists, so its node stays
    // and its old top-level edges are retired.
    write('src/script.js', ['']);
    enqueue('src/script.js');
    await tick();
    full = await fullBuild(files);
    inc = fileEdges(incDbPath, { live: true });
    expect(inc.nodes).toEqual(files);
    expect(inc.edges).toEqual(full.edges);
    expect(inc.edges.some((e) => e.includes('src/script.js'))).toBe(false);

    // Delete the barrel: node retired, edges retired.
    unlinkSync(join(projectRoot, 'src/index.js'));
    enqueue('src/index.js');
    await tick();
    files = ['src/empty.js', 'src/lib.js', 'src/script.js'];
    full = await fullBuild(files);
    inc = fileEdges(incDbPath, { live: true });
    expect(inc.nodes).toEqual(full.nodes);
    expect(inc.edges).toEqual(full.edges);
  });

  it('a crash after the graph write is repaired by the next tick (no duplicate node)', async () => {
    write('src/lib.js', ['export function boot() { return 1; }']);
    write('src/main.js', ["import { boot } from './lib.js';", 'boot();']);
    const files = ['src/lib.js', 'src/main.js'];
    enqueue(...files);
    let crashed = false;
    await expect(tick({
      onProgress: (phase) => {
        if (phase === 'production:graph-written' && !crashed) { crashed = true; throw new Error('simulated crash'); }
      },
    })).rejects.toThrow('simulated crash');
    // Restart: the queue is processed again.
    enqueue(...files);
    await tick();
    const db = new Database(incDbPath, { readonly: true });
    const live = db.prepare('SELECT file_path, COUNT(*) AS n FROM files WHERE epoch_retired IS NULL GROUP BY file_path ORDER BY file_path').all();
    db.close();
    expect(live).toEqual([{ file_path: 'src/lib.js', n: 1 }, { file_path: 'src/main.js', n: 1 }]);
    const full = await fullBuild(files);
    expect(fileEdges(incDbPath, { live: true }).edges).toEqual(full.edges);
  });

  it('an older full-build graph without `files` works, and a connected reader sees the table once a tick adds it', async () => {
    write('src/lib.js', ['export function boot() { return 1; }']);
    write('src/main.js', ["import * as lib from './lib.js';", 'lib.boot();', 'const app = { go() { return lib.boot(); } };']);
    const files = ['src/lib.js', 'src/main.js'];
    await fullBuild(files);
    // Simulate a graph built before file nodes existed.
    {
      const db = new Database(fullDbPath);
      db.exec('DROP TABLE files');
      db.close();
    }
    const repo = new StructuralContextRepository(fullDbPath, { projectRoot });
    const target = repo.findEntityCandidates('boot', { filePath: 'src/lib.js', limit: 5 }).find((c) => c.name === 'boot');
    expect(target).toBeTruthy();
    const before = [...repo.getCallers(target), ...repo.getBareCallers(target)].map((c) => c.name);
    expect(before.includes('(top-level)')).toBe(false);
    const search = new GraphSearch(fullDbPath);
    const searchBefore = (await search.findCallers('boot')).results.map((r) => r.name);
    expect(searchBefore.includes('(top-level)')).toBe(false);

    // The maintainer (upgraded) adds the table to this graph while the
    // reader stays connected.
    {
      const db = new Database(fullDbPath);
      createGraphSchema(db);
      db.prepare('INSERT INTO files (id, file_path, name, epoch_written, epoch_retired) VALUES (?, ?, ?, 0, NULL)')
        .run(fileNodeId('src/main.js'), 'src/main.js', 'main.js');
      db.close();
    }
    const after = [...repo.getCallers(target), ...repo.getBareCallers(target)].map((c) => `${c.name} call@${c.contextLine}`);
    expect(after).toContain('(top-level) call@2');
    repo.close();
    const searchAfter = (await search.findCallers('boot')).results.map((r) => r.name);
    expect(searchAfter).toContain('(top-level)');
    search.close();
  });

  it('ss-trace prints the top-level caller line in the default and the compact (A4) format', async () => {
    write('pkg/mod.py', ['def util():', '    return 1']);
    write('pkg/run.py', ['from pkg import mod', 'mod.util()']);
    write('pkg/job.py', ['from pkg.mod import util', '', 'util()']);
    enqueue('pkg/mod.py', 'pkg/run.py', 'pkg/job.py');
    await tick();
    const { traceSymbol, formatStructuralContext } = await import('../../core/search/search-trace.js');
    const { formatTraceCompact } = await import('../../core/search/agent-output-fixes.js');
    const result = traceSymbol('util', { graphDbPath: incDbPath, projectRoot, filePath: 'pkg/mod.py', mode: 'callers' });
    const full = formatStructuralContext(result);
    const compact = formatTraceCompact(result, { mode: 'callers' });
    for (const out of [full, compact]) {
      expect(out).toContain('(top-level) [file] pkg/run.py:2 call@2');
      expect(out).toContain('(top-level) [file] pkg/job.py:3 call@3');
    }
    expect(compact).toContain('## callers (2)');
    expect(compact).toMatch(/fan-in=2 /);
  });

  it('hasFilesTable re-checks a "no" after a schema change on the same connection', () => {
    const db = new Database(':memory:');
    expect(hasFilesTable(db)).toBe(false);
    expect(hasFilesTable(db)).toBe(false);
    db.exec('CREATE TABLE files (id TEXT, file_path TEXT, name TEXT, epoch_written INTEGER, epoch_retired INTEGER)');
    expect(hasFilesTable(db)).toBe(true);
    db.close();
  });

  it('graph GC prunes retired file nodes at or below the frontier, never live ones', async () => {
    write('src/a.js', ['export function a() { return 1; }']);
    write('src/b.js', ['export function b() { return 2; }']);
    enqueue('src/a.js', 'src/b.js');
    await tick();
    unlinkSync(join(projectRoot, 'src/a.js'));
    enqueue('src/a.js');
    await tick();
    const db = new Database(incDbPath);
    const retired = db.prepare('SELECT epoch_retired FROM files WHERE file_path = ?').get('src/a.js').epoch_retired;
    expect(retired).toBeGreaterThan(0);
    expect(pruneRetiredFileNodes(db, retired - 1).deleted).toBe(0);
    expect(pruneRetiredFileNodes(db, retired).deleted).toBe(1);
    expect(db.prepare('SELECT file_path FROM files').all().map((r) => r.file_path)).toEqual(['src/b.js']);
    db.close();
  });
});
