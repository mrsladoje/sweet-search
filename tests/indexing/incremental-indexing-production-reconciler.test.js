import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { resolveLatestRecords } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';

const MODEL_INFO = Object.freeze({
  provider: 'test',
  model: 'fake-e2e',
  dimension: 8,
  hnswDimension: 8,
});

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

function fakeVector(text, index) {
  const seed = [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), index + 1);
  return Float32Array.from({ length: 8 }, (_, i) => ((seed + i * 13) % 97) / 97);
}

async function vectorEncoder(texts) {
  return texts.map((text, i) => fakeVector(text, i));
}

async function liEncoder(texts) {
  return texts.map((text, i) => {
    const seed = text.length + i;
    return [
      Float32Array.from([seed, 2, 3, 4]),
      Float32Array.from([seed + 1, 3, 4, 5]),
    ];
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function enqueue(stateDir, filePath) {
  writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: filePath })}\n`);
}

function withDb(dbPath, fn) {
  const db = new Database(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function vectorRows(stateDir) {
  return withDb(join(stateDir, 'codebase.db'), (db) => db.prepare(`
    SELECT id, file_path, embedding_input_hash, epoch_written, epoch_retired, metadata
    FROM vectors
    ORDER BY epoch_written, id
  `).all());
}

function graphRows(stateDir) {
  return withDb(join(stateDir, 'code-graph.db'), (db) => ({
    entities: db.prepare(`
      SELECT id, logical_entity_id, type, name, start_line, end_line, epoch_written, epoch_retired
      FROM entities
      ORDER BY epoch_written, type, name
    `).all(),
    relationships: db.prepare(`
      SELECT source_id, target_name, type, epoch_written, epoch_retired
      FROM relationships
      ORDER BY epoch_written, type, target_name
    `).all(),
  }));
}

function liveFtsNames(stateDir, term) {
  return withDb(join(stateDir, 'code-graph.db'), (db) => db.prepare(`
    SELECT e.name
    FROM entities_fts f
    JOIN entities e ON e.rowid = f.rowid
    WHERE entities_fts MATCH ? AND e.epoch_retired IS NULL
    ORDER BY e.name
  `).all(term).map((r) => r.name));
}

function hnswLiveIds(stateDir) {
  const meta = readJson(join(stateDir, 'codebase-hnsw.meta.json'));
  return new Set(meta.idMap.map(([id]) => id));
}

function binaryArtifacts(stateDir) {
  const int8Path = join(stateDir, 'codebase-binary-hnsw.int8.json');
  return {
    vectors: readJson(join(stateDir, 'codebase-binary-hnsw.vectors.json')),
    int8: existsSync(int8Path) ? readJson(int8Path) : {},
  };
}

async function liDocumentIds(stateDir) {
  const index = new LateInteractionIndex({
    indexPath: join(stateDir, 'codebase-late-interaction.db'),
    loadExisting: true,
  });
  await index.init();
  return new Set(index.documents.keys());
}

function sparseLatest(stateDir) {
  const latest = resolveLatestRecords(join(stateDir, 'codebase-sparse-grams.idx'));
  expect(latest.size).toBe(1);
  return [...latest.values()][0].record;
}

describe('production incremental Reconciler', () => {
  let projectRoot;
  let stateDir;
  let sourceFile;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-prod-reconcile-'));
    stateDir = join(projectRoot, '.sweet-search');
    sourceFile = join(projectRoot, 'src', 'sample.js');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  async function tick() {
    return runProductionReconcileTick({
      projectRoot,
      stateDir,
      vectorEncoder,
      liEncoder,
      modelInfo: MODEL_INFO,
      logger: silentLogger,
      config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }

  it('updates graph, vectors, HNSW, binary HNSW, LI, sparse grams, manifest, and merkle state across add/update/delete', async () => {
    writeFileSync(sourceFile, [
      "import { readFile } from 'node:fs';",
      'export function alphaThing(input) {',
      '  return readFile + input.trim();',
      '}',
      '',
    ].join('\n'));
    enqueue(stateDir, 'src/sample.js');

    const first = await tick();
    expect(first.files_processed).toBe(1);
    expect(first.ops_per_tier.vectors_upsert).toBeGreaterThan(0);
    expect(first.ops_per_tier.hnsw_add).toBe(first.ops_per_tier.vectors_upsert);
    expect(first.ops_per_tier.binary_hnsw_append).toBe(first.ops_per_tier.vectors_upsert);
    expect(first.ops_per_tier.li_segment_append).toBe(first.ops_per_tier.vectors_upsert);
    expect(first.ops_per_tier.sparse_gram_delta_upsert).toBe(1);

    const manifest1 = readJson(join(stateDir, 'reconcile-manifest.json'));
    expect(manifest1.epoch).toBe(1);
    expect(readJson(join(stateDir, 'merkle-state.json')).files['src/sample.js'].epoch).toBe(1);
    expect(existsSync(join(stateDir, 'index-maintainer-queue.processing.jsonl'))).toBe(false);

    const live1 = vectorRows(stateDir).filter((row) => row.epoch_retired == null);
    expect(live1.length).toBeGreaterThan(0);
    expect(live1.every((row) => row.file_path === 'src/sample.js')).toBe(true);
    expect(live1.every((row) => row.embedding_input_hash.length > 0)).toBe(true);
    const liveMeta1 = JSON.parse(live1[0].metadata);
    expect(liveMeta1).toMatchObject({
      provider: 'test',
      startLine: 1,
      endLine: 4,
    });

    const graph1 = graphRows(stateDir);
    const liveEntityIds1 = new Set(graph1.entities.filter((e) => e.epoch_retired == null).map((e) => e.id));
    expect(graph1.entities).toContainEqual(expect.objectContaining({
      name: 'alphaThing',
      start_line: 2,
      end_line: 4,
      epoch_written: 1,
    }));
    expect(graph1.relationships.every((rel) => !rel.source_id || liveEntityIds1.has(rel.source_id))).toBe(true);
    expect(liveFtsNames(stateDir, 'alphaThing')).toContain('alphaThing');

    expect(hnswLiveIds(stateDir)).toEqual(new Set(live1.map((row) => row.id)));
    expect(new Set(binaryArtifacts(stateDir).vectors.map((row) => row.id))).toEqual(new Set(live1.map((row) => row.id)));
    expect(new Set(Object.keys(binaryArtifacts(stateDir).int8))).toEqual(new Set(live1.map((row) => row.id)));
    expect(await liDocumentIds(stateDir)).toEqual(new Set(live1.map((row) => row.id)));
    expect(readJson(join(stateDir, 'codebase-late-interaction.db'))).toMatchObject({
      format: 'segmented',
      segmentDir: 'codebase-late-interaction.db.segments',
    });
    expect(sparseLatest(stateDir)).toMatchObject({ filePath: 'src/sample.js', deleted: false });
    expect(sparseLatest(stateDir).grams.length).toBeGreaterThan(0);
    expect(sparseLatest(stateDir).grams.every(([gram]) => typeof gram === 'string' && gram.length >= 3)).toBe(true);

    writeFileSync(sourceFile, [
      '// shifted header',
      "import { writeFile } from 'node:fs';",
      'export function betaThing(input) {',
      '  return writeFile + input.trim();',
      '}',
      '',
    ].join('\n'));
    enqueue(stateDir, 'src/sample.js');
    const second = await tick();
    expect(second.epoch).toBe(2);
    expect(second.ops_per_tier.vectors_delete).toBeGreaterThan(0);
    expect(second.ops_per_tier.hnsw_tombstone).toBeGreaterThan(0);
    expect(second.ops_per_tier.binary_hnsw_tombstone).toBeGreaterThan(0);
    expect(second.ops_per_tier.li_tombstone).toBeGreaterThan(0);

    const rows2 = vectorRows(stateDir);
    const live2 = rows2.filter((row) => row.epoch_retired == null);
    const retired2 = rows2.filter((row) => row.epoch_retired === 2);
    expect(live2.length).toBeGreaterThan(0);
    expect(retired2.length).toBeGreaterThan(0);
    expect(live2.every((row) => row.epoch_written === 2)).toBe(true);
    expect(JSON.parse(live2[0].metadata)).toMatchObject({
      startLine: 1,
      endLine: 5,
    });

    const graph2 = graphRows(stateDir);
    expect(graph2.entities.some((e) => e.name === 'alphaThing' && e.epoch_retired === 2)).toBe(true);
    expect(graph2.entities).toContainEqual(expect.objectContaining({
      name: 'betaThing',
      start_line: 3,
      end_line: 5,
      epoch_retired: null,
    }));
    expect(liveFtsNames(stateDir, 'alphaThing')).toEqual([]);
    expect(liveFtsNames(stateDir, 'betaThing')).toContain('betaThing');
    expect(existsSync(join(stateDir, 'codebase-hnsw.idx.stale.bin'))).toBe(true);
    expect(existsSync(join(stateDir, 'codebase-binary-hnsw.idx.stale.bin'))).toBe(true);
    expect(hnswLiveIds(stateDir)).toEqual(new Set(live2.map((row) => row.id)));
    expect(await liDocumentIds(stateDir)).toEqual(new Set(live2.map((row) => row.id)));
    expect(existsSync(join(stateDir, 'codebase-late-interaction.db.segments', 'segment-0000.bin.stale.bin'))).toBe(true);
    expect(sparseLatest(stateDir)).toMatchObject({ filePath: 'src/sample.js', deleted: false });

    unlinkSync(sourceFile);
    enqueue(stateDir, 'src/sample.js');
    const third = await tick();
    expect(third.epoch).toBe(3);
    expect(third.ops_per_tier.vectors_delete).toBeGreaterThan(0);
    expect(vectorRows(stateDir).filter((row) => row.epoch_retired == null)).toEqual([]);
    expect(graphRows(stateDir).entities.filter((row) => row.epoch_retired == null)).toEqual([]);
    expect(hnswLiveIds(stateDir).size).toBe(0);
    expect(Object.keys(binaryArtifacts(stateDir).int8)).toEqual([]);
    expect((await liDocumentIds(stateDir)).size).toBe(0);
    expect(existsSync(join(stateDir, 'codebase-late-interaction.db.segments', 'segment-0001.bin.stale.bin'))).toBe(true);
    expect(sparseLatest(stateDir)).toMatchObject({ filePath: 'src/sample.js', deleted: true });
    expect(readJson(join(stateDir, 'merkle-state.json')).files['src/sample.js']).toBeUndefined();
    expect(readdirSync(stateDir)).toContain('reconcile-metrics.jsonl');
  });
});
