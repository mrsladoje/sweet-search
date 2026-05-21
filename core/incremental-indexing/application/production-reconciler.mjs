import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

import { Reconciler } from './reconciler.mjs';
import { enqueueMaintenanceJob } from './maintenance-worker.mjs';
import { buildPathFilter } from '../infrastructure/path-filter.mjs';
import { contentHashSync } from '../infrastructure/hashing.mjs';
import { readManifest, writeManifest } from '../infrastructure/manifest.mjs';
import { annotateChunksForDelta, snapshotFileRows, diffChunks, applyDiff } from '../infrastructure/vector-delta-writer.mjs';
import { appendDeltaRecord, FALLBACK_WEIGHTS_ID, fileIdFor, listDeltaSegments } from '../infrastructure/sparse-gram-delta.mjs';
import { fts5Merge } from '../infrastructure/sqlite-fts5.mjs';
import { insertEntity, insertRelationships, markBinaryStale, maintainFloatStore } from './production-reconciler-helpers.mjs';
import { createGraphSchema, GraphExtractor } from '../../graph/graph-extractor.js';
import { createVectorSchema, ensureVectorSchema, buildInsertItems, insertVectorItems } from '../../indexing/indexer-build.js';
import { ASTChunker, JAVA_FAMILY } from '../../indexing/ast-chunker.js';
import { getEmbeddings, getModelInfo } from '../../embedding/embedding-service.js';
import { HNSWIndex } from '../../vector-store/hnsw-index.js';
import { BinaryHNSWIndex } from '../../vector-store/binary-hnsw-index.js';
import { floatToBinary, normalizedFloatToInt8, truncateForHNSW } from '../../infrastructure/quantization.js';
import { extractSparseGramDeltaRecord } from '../../infrastructure/native-sparse-gram.js';
import { migrateEntitiesSchema, migrateRelationshipsSchema } from '../infrastructure/schema-migrations.mjs';
import { readMaintenanceState as readMaintenanceStateFromArtifacts } from '../infrastructure/maintenance-state-reader.mjs';

const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';
const PROCESSING_QUEUE = 'index-maintainer-queue.processing.jsonl';
const MERKLE_STATE = 'merkle-state.json';
const METRICS_FILE = 'reconcile-metrics.jsonl';

function relPath(projectRoot, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
  return rel && !rel.startsWith('../') && !path.isAbsolute(rel) ? rel : null;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function statTuple(absPath) {
  const stat = fs.statSync(absPath, { bigint: true });
  return { size: stat.size.toString(), mtime_ns: stat.mtimeNs.toString(), inode: stat.ino.toString() };
}

function safeWriteJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, filePath);
}

function relativeArtifact(stateDir, filePath) {
  return path.relative(stateDir, filePath).replace(/\\/g, '/');
}

function uniquePhysicalId(db, table, id) {
  let candidate = id;
  let suffix = 1;
  const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
  while (stmt.get(candidate)) candidate = `${id}.${suffix++}`;
  return candidate;
}

function sparseGramRecord(basePath, content) {
  const extracted = extractSparseGramDeltaRecord({ indexPath: basePath, content }) || { weightsId: FALLBACK_WEIGHTS_ID, grams: [] };
  return {
    weightsId: extracted.weightsId || FALLBACK_WEIGHTS_ID,
    grams: [...new Set(extracted.grams || [])].sort().map((gram) => [gram, 1]),
  };
}

function resolveLatestSparseWeightsId(basePath) {
  return extractSparseGramDeltaRecord({ indexPath: basePath, content: '' })?.weightsId || null;
}

function graphEntityLogicalId(filePath, type, name) {
  return createHash('sha256').update(`${filePath}:${type}:${name}`).digest('hex').slice(0, 16);
}

function float32FromBuffer(buffer) {
  const view = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(view);
}

function pickLiInput(chunk) {
  const lang = chunk?.metadata?.language;
  if (lang === 'python' || JAVA_FAMILY.has(lang)) {
    return chunk.li_text || chunk.embedding_text || chunk.text || chunk.content || '';
  }
  return chunk.li_greedy_text || chunk.embedding_text || chunk.li_text || chunk.text || chunk.content || '';
}

async function enrichChunksFromGraph(chunks, stateDir) {
  const dbPath = path.join(stateDir, 'code-graph.db');
  if (!fs.existsSync(dbPath) || chunks.length === 0) return chunks;
  const db = new Database(dbPath, { readonly: true });
  try {
    const entityStmt = db.prepare('SELECT type, name, start_line, end_line FROM entities WHERE file_path = ? AND epoch_retired IS NULL ORDER BY start_line ASC');
    const fileEntityStmt = db.prepare('SELECT id FROM entities WHERE file_path = ? AND logical_entity_id = ? AND epoch_retired IS NULL ORDER BY epoch_written DESC LIMIT 1');
    const importStmt = db.prepare("SELECT DISTINCT target_name FROM relationships WHERE source_id = ? AND type IN ('imports', 'plainImport') AND epoch_retired IS NULL ORDER BY target_name");
    for (const chunk of chunks) {
      const file = chunk.file || chunk.metadata?.relative_path;
      const symbol = chunk.metadata?.symbol;
      if (!file || !symbol || symbol === 'unknown') continue;
      const entities = entityStmt.all(file);
      const start = chunk.metadata?.line_start || 0;
      const end = chunk.metadata?.line_end || start;
      const scope = entities.filter((e) => e.start_line <= start && e.end_line >= end).map((e) => e.name);
      const fileEntity = entities.find((e) => e.type === 'file')?.name || path.basename(file);
      const fileLogicalId = graphEntityLogicalId(file, 'file', fileEntity);
      const filePhysicalId = fileEntityStmt.get(file, fileLogicalId)?.id || fileLogicalId;
      const imports = importStmt.all(filePhysicalId).map((r) => r.target_name);
      if (scope.length > 0 || imports.length > 0) ASTChunker.enrichEmbeddingText(chunk, scope, imports);
    }
  } catch {
    return chunks;
  } finally {
    db.close();
  }
  return chunks;
}

export function createProductionReconciler(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd());
  const stateDir = path.resolve(options.stateDir || process.env.SWEET_SEARCH_STATE_DIR || path.join(projectRoot, '.sweet-search'));
  const adapter = new ProductionReconcileAdapter({ ...options, projectRoot, stateDir });
  return new Reconciler({
    projectRoot,
    stateDir,
    adapters: adapter.adapters(),
    config: {
      filesPerTick: Number.parseInt(process.env.SWEET_SEARCH_RECONCILE_FILES_PER_TICK || '50', 10),
      cpuBudgetMs: Number.parseInt(process.env.SWEET_SEARCH_RECONCILE_CPU_BUDGET_MS || '2000', 10),
      ...(options.config || {}),
    },
    logger: options.logger || console,
  });
}

/**
 * Run a single reconcile tick. This is a PURE primitive: given a dirty set it
 * will build tier artifacts from scratch if none exist. Callers in the default-
 * on path MUST first confirm a complete baseline via
 * `infrastructure/baseline-readiness.mjs::hasCompleteBaseIndex` — the
 * reconciler must never be the first index builder for a non-empty repo (the
 * maintainer daemon and the operator `reconcile tick` command apply that gate).
 */
export async function runProductionReconcileTick(options = {}) {
  const reconciler = createProductionReconciler(options);
  const startup = reconciler.verifyStartup();
  if (!startup.ok) throw new Error(startup.reason || 'reconciler startup verification failed');
  return reconciler.tick();
}

class ProductionReconcileAdapter {
  constructor(options) {
    this.projectRoot = options.projectRoot;
    this.stateDir = options.stateDir;
    this.vectorEncoder = options.vectorEncoder || ((texts) => getEmbeddings(texts, { useCache: false }));
    this.liEncoder = options.liEncoder || null;
    this.modelInfo = options.modelInfo || getModelInfo();
    this.pathFilter = buildPathFilter({ projectRoot: this.projectRoot });
    this.hashes = new Map();
    this.touched = new Map();
  }

  adapters() {
    return {
      readDirtySet: () => this.readDirtySet(),
      requeueDirtyFiles: (files) => this.requeueDirtyFiles(files),
      hashFile: (file) => this.hashFile(file),
      loadCurrentManifest: () => readManifest(this.stateDir),
      persistManifest: (manifest) => this.persistManifest(manifest),
      applyGraphDelta: (file, hashes, epoch) => this.applyGraphDelta(file, hashes, epoch),
      applyVectorDelta: (file, chunks, hashes, epoch) => this.applyVectorDelta(file, chunks, hashes, epoch),
      applyHNSWDelta: (file, ops, epoch) => this.applyHNSWDelta(file, ops, epoch),
      applyBinaryHNSWDelta: (file, ops, epoch) => this.applyBinaryHNSWDelta(file, ops, epoch),
      applyLIDelta: (file, ops, epoch) => this.applyLIDelta(file, ops, epoch),
      applySparseGramDelta: (file, ops, epoch) => this.applySparseGramDelta(file, ops, epoch),
      readMaintenanceState: () => this.readMaintenanceState(),
      scheduleMaintenance: (job) => enqueueMaintenanceJob(this.stateDir, job),
    };
  }

  readDirtySet() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const processing = path.join(this.stateDir, PROCESSING_QUEUE);
    const queue = path.join(this.stateDir, DIRTY_QUEUE);
    if (!fs.existsSync(processing) && fs.existsSync(queue)) {
      fs.renameSync(queue, processing);
    }
    const files = [];
    const seen = new Set();
    for (const entry of readJsonl(processing)) {
      const rel = relPath(this.projectRoot, entry.file_path || entry.path || entry.filePath || '');
      if (!rel || this.pathFilter(rel) || seen.has(rel)) continue;
      seen.add(rel);
      files.push(rel);
    }
    return files;
  }

  requeueDirtyFiles(files) {
    if (!Array.isArray(files) || files.length === 0) return;
    fs.mkdirSync(this.stateDir, { recursive: true });
    const queue = path.join(this.stateDir, DIRTY_QUEUE);
    for (const file of files) fs.appendFileSync(queue, JSON.stringify({ file_path: file.path || file, timestamp: Date.now(), source: 'requeue' }) + '\n');
  }

  async hashFile(file) {
    const rel = typeof file === 'string' ? file : file.path;
    const abs = path.join(this.projectRoot, rel);
    const merkle = readJson(path.join(this.stateDir, MERKLE_STATE), { files: {} });
    if (!fs.existsSync(abs)) {
      const h = { file: rel, deleted: true, contentHash: '', chunks: [] };
      this.hashes.set(rel, h);
      return h;
    }
    const content = fs.readFileSync(abs);
    const contentHash = contentHashSync(content);
    const stat = statTuple(abs);
    const previous = merkle.files?.[rel];
    const h = {
      file: rel,
      absPath: abs,
      content: content.toString('utf8'),
      contentHash,
      stat,
      contentUnchanged: previous?.hash === contentHash,
    };
    this.hashes.set(rel, h);
    return h;
  }

  async applyGraphDelta(file, hashes, epoch) {
    const rel = typeof file === 'string' ? file : file.path;
    const dbPath = path.join(this.stateDir, 'code-graph.db');
    fs.mkdirSync(this.stateDir, { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    const hasFts = createGraphSchema(db);
    migrateEntitiesSchema(db);
    migrateRelationshipsSchema(db);
    try {
      const oldRows = db.prepare('SELECT rowid, id, logical_entity_id, signature_hash FROM entities WHERE file_path = ? AND epoch_retired IS NULL').all(rel);
      const oldByLogical = new Map(oldRows.map((r) => [r.logical_entity_id || r.id, r]));
      const oldIds = oldRows.map((r) => r.id);
      const extractor = new GraphExtractor();
      const parsed = hashes.deleted
        ? { entities: [], relationships: [] }
        : await extractor.extractFromFile(rel, hashes.content);
      const entities = [...(parsed.entities || [])];
      const relationships = parsed.relationships || [];
      const fileLogicalId = graphEntityLogicalId(rel, 'file', path.basename(rel));
      if (relationships.some((r) => r.source_id === fileLogicalId) && !entities.some((e) => e.id === fileLogicalId)) {
        entities.unshift({
          id: fileLogicalId,
          file_path: rel,
          type: 'file',
          name: path.basename(rel),
          signature: `file ${rel}`,
          signature_hash: contentHashSync(`file:${rel}`),
          start_line: 1,
          end_line: Math.max(1, hashes.content?.split('\n').length || 1),
        });
      }
      let upsert = 0;
      let tombstone = 0;
      const liveIdFor = new Map();
      const tx = db.transaction(() => {
        const retireEntity = db.prepare('UPDATE entities SET epoch_retired = ?, stale_since = COALESCE(stale_since, ?) WHERE id = ? AND epoch_retired IS NULL');
        const retireRel = oldIds.length > 0
          ? db.prepare(`UPDATE relationships SET epoch_retired = ? WHERE source_id IN (${oldIds.map(() => '?').join(',')}) AND epoch_retired IS NULL`)
          : null;
        if (retireRel) retireRel.run(epoch, ...oldIds);
        const nextLogical = new Set(entities.map((e) => e.id));
        for (const row of oldRows) {
          if (!nextLogical.has(row.logical_entity_id || row.id)) {
            retireEntity.run(epoch, epoch, row.id);
            tombstone += 1;
          }
        }
        for (const e of entities) {
          const old = oldByLogical.get(e.id);
          if (old && old.signature_hash === (e.signature_hash || null)) {
            liveIdFor.set(e.id, old.id);
            continue;
          }
          if (old) {
            retireEntity.run(epoch, epoch, old.id);
            tombstone += 1;
          }
          const physical = uniquePhysicalId(db, 'entities', `${e.id}@e${epoch}`);
          liveIdFor.set(e.id, physical);
          insertEntity(db, e, physical, epoch, hasFts);
          upsert += 1;
        }
        insertRelationships(db, relationships, liveIdFor, epoch);
      });
      tx();
      if (hasFts) for (const table of ['entities_fts', 'entities_trigram']) try { fts5Merge(db, table, 16); } catch {}
      this.touched.set(rel, { ...(this.touched.get(rel) || {}), graphEntities: entities.length });
      return { ops: { graph_upsert: upsert, graph_tombstone: tombstone }, manifest: { path: 'code-graph.db' } };
    } finally {
      db.close();
    }
  }

  async applyVectorDelta(file, _chunks, hashes, epoch) {
    const rel = typeof file === 'string' ? file : file.path;
    const dbPath = path.join(this.stateDir, 'codebase.db');
    const existed = fs.existsSync(dbPath);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    existed ? ensureVectorSchema(db) : createVectorSchema(db);
    const vectorOps = [];
    let chunks = [];
    try {
      if (hashes.deleted) {
        const snap = snapshotFileRows(db, rel);
        const retire = db.transaction(() => applyDiff(db, rel, { toReuse: [], toEncode: [], toRetire: [...snap.values()].map((r) => ({ rowId: r.id, chunkStructId: r.chunk_struct_id })) }, epoch));
        const summary = retire();
        const retired = summary.retiredRows.map((r) => ({ retireId: r.oldId, file: rel }));
        this.touched.set(rel, { ...(this.touched.get(rel) || {}), hash: hashes, chunkIds: [] });
        return { ops: { vectors_delete: summary.retiredRows.length }, vectorOps: retired, tokenOps: retired, gramOps: [{ file: rel, deleted: true }] };
      }
      const parsed = await new ASTChunker({ projectRoot: this.projectRoot }).parseFile(rel, hashes.content);
      chunks = await enrichChunksFromGraph(parsed.map((chunk, i) => ({ ...chunk, file: rel, id: `${rel}:${chunk.metadata?.line_start || 0}-${chunk.metadata?.line_end || chunk.metadata?.line_start || 0}:${i}` })), this.stateDir);
      const annotations = annotateChunksForDelta(chunks, rel);
      const snap = snapshotFileRows(db, rel);
      const delta = diffChunks(chunks, annotations, snap);
      const texts = delta.toEncode.map(({ chunk }) => chunk.embedding_text || `${rel}\n${chunk.text || chunk.content || ''}`);
      const embeddings = texts.length > 0 ? (await this.vectorEncoder(texts)).map((r) => r.embedding || r) : [];
      const encodedChunks = delta.toEncode.map(({ chunk }, i) => ({ ...chunk, id: `${chunk.id}@e${epoch}.${i}` }));
      const encodedAnnotations = delta.toEncode.map((x) => x.ann);
      const tx = db.transaction(() => {
        const summary = applyDiff(db, rel, delta, epoch);
        if (encodedChunks.length > 0) {
          const items = buildInsertItems(encodedChunks, embeddings, this.modelInfo, encodedAnnotations, { epochWritten: epoch });
          insertVectorItems(db, items);
        }
        return summary;
      });
      const summary = tx();
      const retiredRows = [...summary.replacedRows, ...summary.retiredRows, ...summary.versionedRows];
      for (const row of retiredRows) {
        vectorOps.push({ retireId: row.oldId });
      }
      const newIds = [...encodedChunks.map((c) => c.id), ...summary.versionedRows.map((r) => r.newId)];
      if (newIds.length > 0) {
        const rows = db.prepare(`SELECT id, embedding, metadata FROM vectors WHERE id IN (${newIds.map(() => '?').join(',')})`).all(...newIds);
        for (const row of rows) {
          vectorOps.push({ addId: row.id, embedding: float32FromBuffer(row.embedding), metadata: JSON.parse(row.metadata || '{}') });
        }
      }
      const tokenOps = retiredRows.map((row) => ({ retireId: row.oldId, file: rel }));
      for (const chunk of encodedChunks) tokenOps.push({ addId: chunk.id, chunk });
      for (const row of summary.versionedRows) {
        const reused = delta.toReuse.find((item) => item.ann?.chunkStructId === row.chunkStructId);
        if (reused?.chunk) tokenOps.push({ addId: row.newId, chunk: reused.chunk });
      }
      this.touched.set(rel, { ...(this.touched.get(rel) || {}), hash: hashes, chunkIds: newIds, content: hashes.content });
      return {
        ops: { vectors_upsert: newIds.length, vectors_delete: vectorOps.filter((o) => o.retireId).length },
        chunksTotal: chunks.length,
        chunksEncoded: encodedChunks.length,
        chunksReused: delta.toReuse.length,
        chunksMetadataDirty: delta.counters.metadata_dirty,
        vectorOps,
        tokenOps,
        gramOps: [{ file: rel, deleted: false, content: hashes.content, contentHash: hashes.contentHash }],
        manifest: { path: 'codebase.db' },
      };
    } finally {
      db.close();
    }
  }

  async applyHNSWDelta(_file, ops) {
    if (!Array.isArray(ops) || ops.length === 0) return { ops: { hnsw_add: 0, hnsw_tombstone: 0 } };
    const indexPath = path.join(this.stateDir, 'codebase-hnsw.idx');
    const index = new HNSWIndex({ indexPath, stalePath: `${indexPath}.stale.bin`, dimension: this.modelInfo.hnswDimension });
    try { await index.load(indexPath); } catch { await index.init(); }
    let add = 0; let tombstone = 0;
    for (const op of ops) {
      if (op.retireId && await index.remove(op.retireId)) tombstone += 1;
      if (op.addId && op.embedding) {
        await index.add(op.addId, truncateForHNSW(op.embedding, this.modelInfo.hnswDimension), { file: op.metadata?.file, name: op.metadata?.name, type: op.metadata?.type });
        add += 1;
      }
    }
    await index.save(indexPath);
    return { ops: { hnsw_add: add, hnsw_tombstone: tombstone }, manifest: { path: 'codebase-hnsw.idx', stale: 'codebase-hnsw.idx.stale.bin' } };
  }

  async applyBinaryHNSWDelta(_file, ops) {
    if (!Array.isArray(ops) || ops.length === 0) return { ops: { binary_hnsw_append: 0, binary_hnsw_tombstone: 0 } };
    const indexPath = path.join(this.stateDir, 'codebase-binary-hnsw.idx');
    const index = new BinaryHNSWIndex({ indexPath, stalePath: `${indexPath}.stale.bin`, floatDimension: this.modelInfo.hnswDimension });
    try { await index.load(indexPath); } catch { await index.init(); }
    const binaryVectorsBefore = index.idToIndex?.size ?? 0;
    let append = 0; let tombstone = 0;
    const floatUpserts = [];
    const floatRemoveIds = [];
    for (const op of ops) {
      if (op.retireId) {
        if (markBinaryStale(index, op.retireId)) tombstone += 1;
        floatRemoveIds.push(op.retireId);
      }
      if (op.addId && op.embedding) {
        const truncated = truncateForHNSW(op.embedding, this.modelInfo.hnswDimension);
        await index.add(op.addId, floatToBinary(truncated), op.metadata || {}, normalizedFloatToInt8(truncated));
        floatUpserts.push({ id: op.addId, vector: truncated });
        append += 1;
      }
    }
    await index.save(indexPath);
    await maintainFloatStore(indexPath, { upserts: floatUpserts, removeIds: floatRemoveIds, binaryVectorsBefore, dimension: this.modelInfo.hnswDimension });
    return { ops: { binary_hnsw_append: append, binary_hnsw_tombstone: tombstone }, manifest: { path: 'codebase-binary-hnsw.idx' } };
  }

  async applyLIDelta(_file, ops) {
    if (!Array.isArray(ops) || ops.length === 0) return { ops: { li_segment_append: 0, li_tombstone: 0 } };
    const { applyLateInteractionDelta } = await import('./production-li-delta.mjs');
    const { appended, tombstone } = await applyLateInteractionDelta({
      indexPath: path.join(this.stateDir, 'codebase-late-interaction.db'),
      ops,
      liEncoder: this.liEncoder,
      pickLiInput,
    });
    return { ops: { li_segment_append: appended, li_tombstone: tombstone }, manifest: { path: 'codebase-late-interaction.db', segments: 'codebase-late-interaction.db.segments/manifest.json' } };
  }

  applySparseGramDelta(_file, ops, epoch) {
    if (!Array.isArray(ops) || ops.length === 0) return { ops: { sparse_gram_delta_upsert: 0 } };
    const base = path.join(this.stateDir, 'codebase-sparse-grams.idx');
    let count = 0;
    for (const op of ops) {
      const record = op.deleted ? { weightsId: this.activeSparseWeightsId(base), grams: [] } : sparseGramRecord(base, op.content);
      appendDeltaRecord(base, epoch, {
        fileId: fileIdFor(op.file),
        filePath: op.file,
        contentHash: op.contentHash || '',
        deleted: !!op.deleted,
        symbolMask: 0,
        weightsId: record.weightsId,
        grams: record.grams,
      });
      count += 1;
    }
    return { ops: { sparse_gram_delta_upsert: count }, manifest: { base: 'codebase-sparse-grams.idx', deltas: listDeltaSegments(base, { maxEpoch: epoch }).map((s) => relativeArtifact(this.stateDir, s.path)), weightsId: this.activeSparseWeightsId(base) } };
  }

  activeSparseWeightsId(base) {
    const latest = resolveLatestSparseWeightsId(base);
    return latest || readManifest(this.stateDir)?.sparseGram?.weightsId || FALLBACK_WEIGHTS_ID;
  }

  readMaintenanceState() {
    return readMaintenanceStateFromArtifacts(this.stateDir);
  }

  persistManifest(manifest) {
    writeManifest(this.stateDir, manifest);
    const merklePath = path.join(this.stateDir, MERKLE_STATE);
    const merkle = readJson(merklePath, { version: '2.4', files: {}, stats: {} });
    merkle.files ||= {};
    for (const [file, data] of this.touched.entries()) {
      if (data.hash?.deleted) delete merkle.files[file];
      else merkle.files[file] = { hash: data.hash.contentHash, ...data.hash.stat, epoch: manifest.epoch, chunkIds: data.chunkIds || [] };
    }
    merkle.lastIndex = new Date().toISOString();
    merkle.epoch = manifest.epoch;
    merkle.stats = { ...(merkle.stats || {}), totalFiles: Object.keys(merkle.files).length };
    safeWriteJson(merklePath, merkle);
    try { fs.unlinkSync(path.join(this.stateDir, PROCESSING_QUEUE)); } catch {}
    fs.appendFileSync(path.join(this.stateDir, METRICS_FILE), JSON.stringify({ ...manifest, ts: Date.now() / 1000, epoch: manifest.epoch }) + '\n');
  }
}

export const __testing = {
  ProductionReconcileAdapter,
  sparseGramRecord,
  markBinaryStale,
};
