// File-level import rows written by a FULL build carry the file's logical id
// and have no file entity row. The maintainer must still retire them when it
// re-extracts the file, and a deleted file must stop being an import target.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver, buildFileImportMap } from '../../core/graph/import-resolver.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake-e2e', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

describe('maintainer: file-level import rows from a full build', () => {
  let projectRoot;
  let stateDir;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-inc-imports-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const write = (rel, text) => writeFileSync(join(projectRoot, rel), text);
  const enqueue = (...rels) => writeFileSync(
    join(stateDir, 'index-maintainer-queue.jsonl'),
    rels.map((file_path) => JSON.stringify({ file_path })).join('\n') + '\n',
  );
  const tick = () => runProductionReconcileTick({
    projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO, logger: silentLogger,
    config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
  });

  async function fullBuild(files) {
    const db = new Database(join(stateDir, 'code-graph.db'));
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot, files }) });
      const ents = [];
      const rels = [];
      for (const rel of files) {
        const out = await extractor.extractFromFile(rel, readFileSync(join(projectRoot, rel), 'utf-8'));
        ents.push(...out.entities);
        rels.push(...out.relationships);
      }
      insertGraph(db, ents, rels, fts, { syncFts: false });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
      db.close();
    }
  }

  function liveImportMap() {
    const db = new Database(join(stateDir, 'code-graph.db'), { readonly: true });
    try {
      const ex = new GraphExtractor();
      const map = buildFileImportMap(db, (p) => ex.makeId(p, 'file', p.split('/').pop()));
      return Object.fromEntries([...map].map(([k, v]) => [k, [...v].sort()]).sort());
    } finally {
      db.close();
    }
  }

  it('an edit retires the removed import; a delete retires edges into the deleted file', async () => {
    write('src/b.ts', 'export function b() { return 1; }\n');
    write('src/c.ts', 'export function c() { return 2; }\n');
    write('src/a.ts', "import { b } from './b';\nimport { c } from './c';\nexport function a() { return b() + c(); }\n");
    await fullBuild(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(liveImportMap()).toEqual({ 'src/a.ts': ['src/b.ts', 'src/c.ts'] });
    // The maintainer learns b.ts and c.ts (a.ts keeps its full-build rows).
    enqueue('src/b.ts', 'src/c.ts');
    await tick();
    expect(liveImportMap()).toEqual({ 'src/a.ts': ['src/b.ts', 'src/c.ts'] });

    // Edit: drop the import of ./c.
    write('src/a.ts', "import { b } from './b';\nexport function a() { return b(); }\n");
    enqueue('src/a.ts');
    await tick();
    expect(liveImportMap()).toEqual({ 'src/a.ts': ['src/b.ts'] });

    // Delete b.ts: a.ts no longer imports an existing file.
    unlinkSync(join(projectRoot, 'src/b.ts'));
    enqueue('src/b.ts');
    await tick();
    expect(liveImportMap()).toEqual({});
  });
});
