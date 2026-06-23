import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

import { Reconciler } from './reconciler.mjs';
import { enqueueMaintenanceJob, readMaintenanceQueue } from './maintenance-worker.mjs';
import { createAdmissionPolicy } from '../../indexing/admission-policy.js';
import { applyIndexingChunkPolicy } from '../../indexing/indexing-file-policy.js';
import { contentHashSync } from '../infrastructure/hashing.mjs';
import { readManifest, writeManifest } from '../infrastructure/manifest.mjs';
import { annotateChunksForDelta, snapshotFileRows, diffChunks, applyDiff } from '../infrastructure/vector-delta-writer.mjs';
import { appendDeltaRecord, FALLBACK_WEIGHTS_ID, fileIdFor, listDeltaSegments } from '../infrastructure/sparse-gram-delta.mjs';
import { fts5Merge, fts5MergeBudgetPages } from '../infrastructure/sqlite-fts5.mjs';
import { insertEntity, insertRelationships, markBinaryStale, maintainFloatStore, flushFloatStore } from './production-reconciler-helpers.mjs';
import {
  chunkCutoffEnabled,
  computeCutoffSignature,
  signaturesMatch,
  loadCutoffCache,
  getFileSignature,
  setFileSignature,
  deleteFileSignature,
  saveCutoffCache,
} from '../domain/cutoff-cache.mjs';
import { FloatVectorStore, getFloatStorePath } from '../../vector-store/float-vector-store.js';
import { createGraphSchema, GraphExtractor } from '../../graph/graph-extractor.js';
import { createVectorSchema, ensureVectorSchema, buildInsertItems, insertVectorItems } from '../../indexing/indexer-build.js';
import { ASTChunker, JAVA_FAMILY } from '../../indexing/ast-chunker.js';
import { getEmbeddings, getModelInfo } from '../../embedding/embedding-service.js';
import { BinaryHNSWIndex } from '../../vector-store/binary-hnsw-index.js';
import { floatToBinary, normalizedFloatToInt8, truncateForHNSW } from '../../infrastructure/quantization.js';
import { extractSparseGramDeltaRecord } from '../../infrastructure/native-sparse-gram.js';
import { migrateEntitiesSchema, migrateRelationshipsSchema } from '../infrastructure/schema-migrations.mjs';
import { readMaintenanceState as readMaintenanceStateFromArtifacts } from '../infrastructure/maintenance-state-reader.mjs';

const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';
const PROCESSING_QUEUE = 'index-maintainer-queue.processing.jsonl';
const MERKLE_STATE = 'merkle-state.json';
const METRICS_FILE = 'reconcile-metrics.jsonl';

// ---- G2 lever flags ----------------------------------------------------------
// `flagOn` = strict opt-in (`'1'`), used by the levers that remain DEFAULT-OFF
// (a trade or unvalidated). `flagDefaultOn` = default-on (ON unless explicitly
// '0'), used by the PROVEN-safe levers (recall-neutral / byte-identical / soak
// == baseline). Disable any default-on lever with `=0`.
const flagOn = (name) => process.env[name] === '1';
const flagDefaultOn = (name) => process.env[name] !== '0';
// DEFAULT-ON (verified safe): batch tier writes (byte-identical with det-levels),
// SQLite memory pragmas (footprint-only), budget-derived FTS5 merge (CPU-budget
// adaptive, recall-neutral). Disable with the matching env var = '0'.
const batchTierWritesEnabled = () => flagDefaultOn('SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES');
const sqlitePragmasEnabled = () => flagDefaultOn('SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS');
const fts5BudgetEnabled = () => flagDefaultOn('SWEET_SEARCH_RECONCILE_FTS5_BUDGET');
// DEFAULT-OFF (freshness trade — defers HNSW disk saves so on-disk lags the live
// graph): keep strict opt-in.
const liveHnswEnabled = () => flagOn('SWEET_SEARCH_RECONCILE_LIVE_HNSW');

const BATCH_FLAG = 'SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES';
const DET_LEVELS_FLAG = 'SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS';

// One-time-warning latch so the forced-on notice is emitted ONCE per process,
// not on every tick (createProductionReconciler runs per tick in the daemon).
let _batchForcedDetLevelsWarned = false;

/**
 * Couple the two HNSW-determinism levers so the batch lever can never silently
 * produce a non-byte-identical graph.
 *
 * E.1 batching (`SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES`) only yields a graph
 * byte-identical to the per-file / compaction paths when per-id deterministic
 * levels (`SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS`) are ON — see plan §0.5.
 * `binary-hnsw-index.js` reads the det-levels env var directly at insert time,
 * so running batch WITHOUT det-levels is a footgun: the batched tick draws the
 * global RNG in a different interleaving than a per-file run and the resulting
 * graph diverges. These two flags are coupled here.
 *
 * BOTH levers are now DEFAULT-ON (`!== '0'`). "batch effectively ON" therefore
 * means the batch flag is unset (default) OR '1' — i.e. `BATCH_FLAG !== '0'`.
 * In the normal case (both unset / default-on) det-levels is ALREADY effectively
 * ON, so this is a no-op; no env mutation is needed and binary-hnsw-index.js
 * sees det-levels on via its own `!== '0'` gate. The ONE case that must still
 * fail loudly is the explicit contradiction: batch effectively ON while
 * det-levels is EXPLICITLY '0'.
 *
 * Runs per tick from `createProductionReconciler` (which the daemon constructs
 * each tick), so the daemon is covered without touching index-maintainer.mjs.
 *
 *   - batch effectively ON + det-levels EXPLICITLY '0' → throw (explicit
 *     contradiction: byte-identity requested via batch, but levels forced
 *     non-deterministic).
 *   - batch effectively ON + det-levels default/unset/'1' → no-op (det-levels is
 *     default-on, so the batched graph already stays byte-identical).
 *   - batch EXPLICITLY OFF ('0') → no-op (the per-file path is taken; det-levels
 *     is independently meaningful and we never touch it).
 *
 * @param {{warn?:Function}} [logger]  optional logger (reserved; the default-on
 *   defaults make the force-on warning path unreachable, but the signature is
 *   preserved for callers + tests).
 */
export function normalizeHnswDeterminismFlags(logger = null) {
  void logger;
  // batch is DEFAULT-ON: it is effectively OFF only when explicitly '0'.
  if (process.env[BATCH_FLAG] === '0') return;
  const det = process.env[DET_LEVELS_FLAG];
  // det-levels is also DEFAULT-ON: only an EXPLICIT '0' is the contradiction.
  if (det === '0') {
    throw new Error(
      `${BATCH_FLAG} is enabled (default-on) but requires ${DET_LEVELS_FLAG} to be `
      + `ON for a byte-identical HNSW graph — ${DET_LEVELS_FLAG} is explicitly '0'. `
      + `These are contradictory: batch tier writes only converge with the `
      + `per-file and compaction build paths when per-id deterministic levels are `
      + `enabled (see INDEX_MAINTAINER_EFFICIENCY_IMPLEMENTATION_PLAN §0.5). Either `
      + `leave ${DET_LEVELS_FLAG} default-on (omit it or set it to '1') or disable `
      + `the batch lever with ${BATCH_FLAG}=0.`,
    );
  }
  // det-levels is default-on (unset) or explicitly '1' → already coupled
  // correctly; no env mutation needed (binary-hnsw-index.js reads its own
  // `!== '0'` gate). The legacy force-on warning latch is retained only to keep
  // its symbol stable for any importer.
  void _batchForcedDetLevelsWarned;
}

// E.2: deletion-fraction threshold + insert cadence for the live (daemon-scoped)
// HNSW. Save to disk only on graceful shutdown, deletion-fraction >= this, or
// every N inserts.
const LIVE_HNSW_DELETION_FRACTION = Number.parseFloat(process.env.SWEET_SEARCH_RECONCILE_LIVE_HNSW_DELETE_FRAC || '0.15');
const LIVE_HNSW_SAVE_EVERY_INSERTS = Number.parseInt(process.env.SWEET_SEARCH_RECONCILE_LIVE_HNSW_SAVE_EVERY || '2000', 10);

/**
 * E.4 SQLite memory pragmas, applied AFTER `journal_mode=WAL; synchronous=NORMAL`
 * on a write connection. `cache_size=-32768` caps the per-connection page cache
 * at ~32 MiB. `soft_heap_limit` is process-global and is set ONCE at daemon
 * startup by G4 (index-maintainer) — NOT here — to avoid every connection
 * re-setting a process-wide knob. With E.1 these attach to the tick-scoped
 * connection so the cache is meaningful; without E.1 the per-file conn churn
 * makes them near no-ops (documented, not a bug).
 *
 * Gated on `SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS`; off ⇒ unchanged behavior.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{readonly?: boolean}} [opts]
 */
function applyMemoryPragmas(db, { readonly = false } = {}) {
  if (!sqlitePragmasEnabled()) return;
  try { db.pragma('cache_size = -32768'); } catch {}
  // mmap_size only on readonly maintainer conns (negligible benefit on the JS
  // side — the user search path is native Rust — but harmless; matches the doc).
  if (readonly) {
    try { db.pragma('mmap_size = 268435456'); } catch {}
  }
}

/**
 * E.2: process-scoped (daemon-scoped) live store registry. The index-maintainer
 * daemon runs many ticks in one process, each constructing a fresh
 * `createProductionReconciler`; a module-level registry keyed by the resolved
 * state dir lets the resident HNSW + float store survive across those
 * per-tick adapter instances when `SWEET_SEARCH_RECONCILE_LIVE_HNSW` is on.
 *
 * Each entry: { index: BinaryHNSWIndex, floatStore: FloatVectorStore,
 *               insertsSinceSave, deletedCount, totalCount, dirty }
 */
const liveStoreRegistry = new Map();

/**
 * Release all live stores, saving any that are dirty. Called on graceful daemon
 * shutdown (G4 wires the call; exposed here for tests + the disposeTick path).
 */
export async function shutdownLiveStores() {
  for (const [key, entry] of liveStoreRegistry) {
    try {
      if (entry.dirty && entry.index) {
        await entry.index.save(entry.indexPath);
        if (entry.floatStore && entry.floatStore.loaded) {
          await entry.floatStore.save(getFloatStorePath(entry.indexPath));
        }
      }
    } catch { /* best-effort flush on shutdown */ }
    liveStoreRegistry.delete(key);
  }
}

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

async function enrichChunksFromGraph(chunks, stateDir, tickCtx = null) {
  const dbPath = path.join(stateDir, 'code-graph.db');
  if (chunks.length === 0) return chunks;
  // E.1: reuse the tick-scoped readonly connection when batching; else open a
  // per-file readonly connection exactly as before.
  let db;
  let ownConn = false;
  if (tickCtx?.graphRoDb) {
    db = tickCtx.graphRoDb;
  } else {
    if (!fs.existsSync(dbPath)) return chunks;
    db = new Database(dbPath, { readonly: true });
    applyMemoryPragmas(db, { readonly: true });
    ownConn = true;
  }
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
    if (ownConn) db.close();
  }
  return chunks;
}

export function createProductionReconciler(options = {}) {
  // Couple the batch + det-levels flags FIRST (before the adapter is built and
  // before any tier write), so binary-hnsw-index.js — which reads
  // SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS at insert time — transparently sees
  // the forced value whenever batch is on. Throws on the explicit contradiction
  // (batch=1 + det-levels=0). See `normalizeHnswDeterminismFlags`.
  normalizeHnswDeterminismFlags(options.logger);
  const projectRoot = path.resolve(options.projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd());
  const stateDir = path.resolve(options.stateDir || process.env.SWEET_SEARCH_STATE_DIR || path.join(projectRoot, '.sweet-search'));
  const adapter = new ProductionReconcileAdapter({ ...options, projectRoot, stateDir });
  // A.4-config: feed the interval-autotune a real load signal. This is ONLY the
  // config half — the daemon (G4) reads the tuned interval back into its sleep
  // loop. DEFAULT-ON (disable with SWEET_SEARCH_RECONCILE_AUTOTUNE=0): when off,
  // `autotuneInterval` stays false and the reconciler never re-tunes (today's
  // fixed-interval behavior). Verified recall-neutral + soak == baseline.
  const autotuneOn = flagDefaultOn('SWEET_SEARCH_RECONCILE_AUTOTUNE');
  const cpuCount = Math.max(1, os.cpus().length);
  const autotuneConfig = autotuneOn
    ? {
        autotuneInterval: true,
        cpuLoadAvg: os.loadavg()[0] / cpuCount,
        maintenanceBacklog: adapter.maintenanceBacklog(),
      }
    : {};
  return new Reconciler({
    projectRoot,
    stateDir,
    adapters: adapter.adapters(),
    onProgress: options.onProgress,
    config: {
      filesPerTick: Number.parseInt(process.env.SWEET_SEARCH_RECONCILE_FILES_PER_TICK || '50', 10),
      cpuBudgetMs: Number.parseInt(process.env.SWEET_SEARCH_RECONCILE_CPU_BUDGET_MS || '2000', 10),
      ...autotuneConfig,
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
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    this.vectorEncoder = options.vectorEncoder || ((texts, progressOptions = {}) => getEmbeddings(texts, {
      useCache: false,
      onProgress: progressOptions.onProgress,
    }));
    this.liEncoder = options.liEncoder || null;
    this.modelInfo = options.modelInfo || getModelInfo();
    // Shared admission policy — the SAME include/exclude/.sweet-search-ignore/
    // .gitignore/size gates full indexing applies. Used as the second safety
    // gate: queued files full indexing would skip are never reconciled, and a
    // previously-indexed file that is now inadmissible is retired (see
    // readDirtySet → _retireSet → hashFile).
    this.admission = options.admissionPolicy || createAdmissionPolicy({ projectRoot: this.projectRoot });
    this._retireSet = new Set();
    this._liSkipFiles = new Set();
    this.hashes = new Map();
    this.touched = new Map();
    // E.1: the active tick-scoped store context (null on the per-file path).
    this._tickCtx = null;
    // E.6: chunk-cutoff cache — loaded lazily at tick begin / first vector delta
    // when the flag is on; null when disabled.
    this._cutoffCache = null;
    this._cutoffDirty = false;
  }

  progress(phase) {
    this.onProgress?.(phase);
  }

  /**
   * A.4-config: a coarse maintenance-backlog signal for the interval autotune —
   * the depth of the rebuild queue. Best-effort; never throws.
   * @returns {number}
   */
  maintenanceBacklog() {
    try { return readMaintenanceQueue(this.stateDir).length; } catch { return 0; }
  }

  adapters() {
    const hooks = {
      readDirtySet: () => this.readDirtySet(),
      requeueDirtyFiles: (files) => this.requeueDirtyFiles(files),
      hashFile: (file) => this.hashFile(file),
      loadCurrentManifest: () => readManifest(this.stateDir),
      persistManifest: (manifest) => this.persistManifest(manifest),
      applyGraphDelta: (file, hashes, epoch, ctx) => this.applyGraphDelta(file, hashes, epoch, ctx),
      applyVectorDelta: (file, chunks, hashes, epoch, ctx) => this.applyVectorDelta(file, chunks, hashes, epoch, ctx),
      applyBinaryHNSWDelta: (file, ops, epoch, ctx) => this.applyBinaryHNSWDelta(file, ops, epoch, ctx),
      applyLIDelta: (file, ops, epoch) => this.applyLIDelta(file, ops, epoch),
      applySparseGramDelta: (file, ops, epoch) => this.applySparseGramDelta(file, ops, epoch),
      readMaintenanceState: () => this.readMaintenanceState(),
      scheduleMaintenance: (job) => enqueueMaintenanceJob(this.stateDir, job),
    };
    // E.1: expose the batch lifecycle hooks ONLY when the flag is on, so the
    // reconciler's `_batchTierWritesEnabled()` gate (which checks for the hooks)
    // stays false by default and the per-file path is taken verbatim.
    if (batchTierWritesEnabled()) {
      hooks.beginTick = (info) => this.beginTick(info);
      hooks.finalizeTick = (ctx, info) => this.finalizeTick(ctx, info);
      hooks.disposeTick = (ctx) => this.disposeTick(ctx);
    }
    return hooks;
  }

  // ---- E.1/E.2 tick-scoped store context -----------------------------------

  /**
   * E.1: open the tick-scoped store context once at tick start. Opens RW
   * `codebase.db` + `code-graph.db`, a RO `code-graph.db` for enrichment, loads
   * the binary HNSW + float store once, and primes the cutoff cache (E.6).
   *
   * With E.2 (`SWEET_SEARCH_RECONCILE_LIVE_HNSW`) the HNSW + float store come
   * from the daemon-scoped registry (loaded once, kept resident across ticks);
   * otherwise they are loaded fresh and saved+closed at finalize.
   */
  async beginTick() {
    const codebaseDbPath = path.join(this.stateDir, 'codebase.db');
    const graphDbPath = path.join(this.stateDir, 'code-graph.db');
    const indexPath = path.join(this.stateDir, 'codebase-binary-hnsw.idx');
    fs.mkdirSync(this.stateDir, { recursive: true });

    const codebaseExisted = fs.existsSync(codebaseDbPath);
    const codebaseDb = new Database(codebaseDbPath);
    codebaseDb.pragma('journal_mode = WAL');
    codebaseDb.pragma('synchronous = NORMAL');
    applyMemoryPragmas(codebaseDb);
    codebaseExisted ? ensureVectorSchema(codebaseDb) : createVectorSchema(codebaseDb);

    const graphDb = new Database(graphDbPath);
    graphDb.pragma('journal_mode = WAL');
    graphDb.pragma('synchronous = NORMAL');
    applyMemoryPragmas(graphDb);
    const graphHasFts = createGraphSchema(graphDb);
    migrateEntitiesSchema(graphDb);
    migrateRelationshipsSchema(graphDb);

    // Enrichment reads must observe THIS tick's graph writes. Because the
    // batched path defers the SQLite COMMIT to finalize (persist-before-advance,
    // see below), a SEPARATE readonly connection in WAL mode would NOT see the
    // uncommitted in-tick graph rows. So enrichment reads from the SAME RW
    // connection (`graphDb`) — a connection always sees its own uncommitted
    // writes — preserving per-file enrichment semantics inside one tick.
    const graphRoDb = graphDb;

    // Resident HNSW + float store (E.1 load-once; E.2 daemon-scoped singleton).
    const live = liveHnswEnabled() ? this._getLiveStore(indexPath) : null;
    let index = live?.index || null;
    let floatStore = live?.floatStore || null;
    if (!index) {
      index = new BinaryHNSWIndex({ indexPath, stalePath: `${indexPath}.stale.bin`, floatDimension: this.modelInfo.hnswDimension });
      try { await index.load(indexPath); } catch { await index.init(); }
    }
    const binaryVectorsBefore = index.idToIndex?.size ?? 0;
    if (!floatStore) {
      floatStore = new FloatVectorStore();
      try { await floatStore.loadOrInit(getFloatStorePath(indexPath), this.modelInfo.hnswDimension); } catch { /* fall back to fresh */ }
    }

    if (chunkCutoffEnabled() && !this._cutoffCache) {
      this._cutoffCache = loadCutoffCache(this.stateDir);
      this._cutoffDirty = false;
    }

    // E.1 PERSIST-BEFORE-ADVANCE: defer the SQLite COMMIT to finalizeTick. Open
    // an explicit outer transaction on each RW connection now; the per-file
    // `db.transaction(fn)()` calls inside apply*Delta then run as SAVEPOINTs
    // (better-sqlite3 nests automatically) and only become durable when
    // finalizeTick COMMITs — which it does ONLY after the HNSW + float batch
    // save fsyncs. A crash/throw before that point rolls the whole tick's SQLite
    // writes back, so a restart re-reconciles from a consistent prior state and
    // can never leave a SQLite-live row missing from the HNSW.
    codebaseDb.exec('BEGIN');
    graphDb.exec('BEGIN');

    const ctx = {
      indexPath,
      tickStartMs: Date.now(),
      txOpen: true,
      codebaseDb,
      graphDb,
      graphRoDb,
      graphHasFts,
      index,
      floatStore,
      binaryVectorsBefore,
      live: !!live,
      // Accumulated across the tick:
      floatUpserts: [],
      floatRemoveIds: [],
      append: 0,
      tombstone: 0,
      // Files whose ops are staged in this batch (provisional → promoted to
      // merkle only after finalize fsyncs).
      persistedFiles: new Set(),
      pendingAdds: [],
    };
    this._tickCtx = ctx;
    this._lastPersistedFiles = ctx.persistedFiles;
    return ctx;
  }

  /**
   * E.2: fetch (or lazily create) the daemon-scoped resident store entry.
   */
  _getLiveStore(indexPath) {
    let entry = liveStoreRegistry.get(indexPath);
    if (!entry) {
      entry = {
        indexPath,
        index: null,
        floatStore: null,
        insertsSinceSave: 0,
        deletedCount: 0,
        totalCount: 0,
        dirty: false,
        loadPromise: null,
      };
      liveStoreRegistry.set(indexPath, entry);
    }
    return entry;
  }

  /**
   * E.1 PERSIST-BEFORE-ADVANCE: save the batched HNSW + float store once, fsync,
   * then (per E.4) shrink_memory + wal_checkpoint(PASSIVE) on the tick-scoped
   * connections. Returns the set of files whose ops are now persisted so the
   * manifest publish only promotes those into the merkle.
   *
   * With E.2 the resident index is NOT saved every tick — only on a deletion
   * fraction >= threshold, every N inserts, or graceful shutdown. The SQLite
   * tiers always fsync here; the merkle then advances for files whose vector
   * rows landed (HNSW reconverges from those rows on the next save / restart).
   */
  async finalizeTick(ctx) {
    if (!ctx) return { persistedFiles: new Set(), requeueFiles: [] };
    let hnswSaved = false;
    try {
      // E.1: insert all staged adds into the resident index in a DETERMINISTIC
      // order (sorted by id). Combined with G1's per-id deterministic levels and
      // sorted-order compaction, this makes the batched graph reproducible and
      // byte-identical across batch / rebuild / compaction construction paths.
      const pending = ctx.pendingAdds || [];
      if (pending.length > 0) {
        pending.sort((a, b) => (a.addId < b.addId ? -1 : a.addId > b.addId ? 1 : 0));
        let done = 0;
        for (const op of pending) {
          const truncated = truncateForHNSW(op.embedding, this.modelInfo.hnswDimension);
          await ctx.index.add(op.addId, floatToBinary(truncated), op.metadata || {}, normalizedFloatToInt8(truncated));
          ctx.floatUpserts.push({ id: op.addId, vector: truncated });
          if ((++done) % 100 === 0) this.progress('production:binary-hnsw-loop');
        }
        this.progress('production:binary-hnsw-batched');
      }
      ctx.pendingAdds = [];

      if (ctx.live) {
        const entry = liveStoreRegistry.get(ctx.indexPath);
        if (entry) {
          entry.index = ctx.index;
          entry.floatStore = ctx.floatStore;
          entry.insertsSinceSave += ctx.append;
          entry.deletedCount += ctx.tombstone;
          entry.totalCount = ctx.index.idToIndex?.size ?? entry.totalCount;
          if (ctx.append > 0 || ctx.tombstone > 0) entry.dirty = true;
          const denom = Math.max(1, entry.totalCount + entry.deletedCount);
          const deletionFraction = entry.deletedCount / denom;
          const shouldSave = deletionFraction >= LIVE_HNSW_DELETION_FRACTION
            || entry.insertsSinceSave >= LIVE_HNSW_SAVE_EVERY_INSERTS;
          if (shouldSave && entry.dirty) {
            await ctx.index.save(ctx.indexPath);
            await flushFloatStore({
              binaryHnswPath: ctx.indexPath,
              store: ctx.floatStore,
              upserts: ctx.floatUpserts,
              removeIds: ctx.floatRemoveIds,
              binaryVectorsBefore: ctx.binaryVectorsBefore,
              dimension: this.modelInfo.hnswDimension,
            });
            entry.insertsSinceSave = 0;
            entry.deletedCount = 0;
            entry.dirty = false;
            hnswSaved = true;
          } else if (ctx.floatUpserts.length || ctx.floatRemoveIds.length) {
            // Keep the float store's in-memory delta consistent with the live
            // index even when we skip the disk save (so a later threshold save
            // writes the full set).
            ctx.floatStore.applyDelta({ upserts: ctx.floatUpserts, removeIds: ctx.floatRemoveIds });
          }
        }
      } else if (ctx.append > 0 || ctx.tombstone > 0) {
        await ctx.index.save(ctx.indexPath);
        this.progress('production:binary-hnsw-saved');
        await flushFloatStore({
          binaryHnswPath: ctx.indexPath,
          store: ctx.floatStore,
          upserts: ctx.floatUpserts,
          removeIds: ctx.floatRemoveIds,
          binaryVectorsBefore: ctx.binaryVectorsBefore,
          dimension: this.modelInfo.hnswDimension,
        });
        this.progress('production:float-store-maintained');
        hnswSaved = true;
      }
      // PERSIST-BEFORE-ADVANCE: the HNSW + float batch has now fsynced (or was
      // intentionally not due-to-save under E.2). COMMIT the SQLite tiers ONLY
      // now, so a crash before this point rolled the SQLite writes back too.
      if (ctx.txOpen) {
        ctx.codebaseDb.exec('COMMIT');
        ctx.graphDb.exec('COMMIT');
        ctx.txOpen = false;
      }
    } catch (err) {
      // HNSW save (or COMMIT) failed → roll back the SQLite tiers so nothing is
      // half-persisted, close connections, and surface the error. The manifest
      // never advances for these files (persistedFiles is dropped) and the
      // processing queue is left in place → the next tick re-reconciles them.
      await this.disposeTick(ctx);
      throw err;
    }

    // E.4: return cache to the OS + checkpoint the WAL, then close. Safe now that
    // the transaction is committed (a checkpoint inside a write tx is a no-op).
    try {
      if (sqlitePragmasEnabled()) {
        try { ctx.codebaseDb.pragma('shrink_memory'); } catch {}
        try { ctx.graphDb.pragma('shrink_memory'); } catch {}
      }
      try { ctx.codebaseDb.pragma('wal_checkpoint(PASSIVE)'); } catch {}
      try { ctx.graphDb.pragma('wal_checkpoint(PASSIVE)'); } catch {}
    } finally {
      await this.disposeTick(ctx);
    }
    void hnswSaved;
    // Stash for persistManifest (which runs after finalize disposed the ctx):
    // only these files are promoted into the merkle (persist-before-advance).
    this._lastPersistedFiles = ctx.persistedFiles;
    return { persistedFiles: ctx.persistedFiles, requeueFiles: [] };
  }

  /**
   * Close the tick-scoped connections. Idempotent + best-effort. With E.2 the
   * resident index/float store are NOT closed (they belong to the registry).
   */
  async disposeTick(ctx) {
    if (!ctx) return;
    // Roll back an uncommitted tick transaction (crash/throw before finalize's
    // COMMIT) so the SQLite tiers are left at their prior consistent state.
    if (ctx.txOpen) {
      for (const key of ['codebaseDb', 'graphDb']) {
        try { ctx[key]?.exec('ROLLBACK'); } catch {}
      }
      ctx.txOpen = false;
    }
    // graphRoDb aliases graphDb in the batched path; close each distinct handle
    // once.
    const closed = new Set();
    for (const key of ['codebaseDb', 'graphDb', 'graphRoDb']) {
      const db = ctx[key];
      if (db && !closed.has(db)) { try { db.close(); } catch {} closed.add(db); }
      ctx[key] = null;
    }
    if (this._tickCtx === ctx) this._tickCtx = null;
  }

  async readDirtySet() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const processing = path.join(this.stateDir, PROCESSING_QUEUE);
    const queue = path.join(this.stateDir, DIRTY_QUEUE);
    if (!fs.existsSync(processing) && fs.existsSync(queue)) {
      fs.renameSync(queue, processing);
    }
    const rels = [];
    const seen = new Set();
    for (const entry of readJsonl(processing)) {
      const rel = relPath(this.projectRoot, entry.file_path || entry.path || entry.filePath || '');
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      rels.push(rel);
    }

    // Second admission gate. A queued file that full indexing would skip is
    // dropped if it was never indexed, and retired if it was (so the index
    // converges to a fresh full rebuild). Existence + shape + size are sync;
    // gitignore is ONE batched check over the admissible candidates.
    const merkle = readJson(path.join(this.stateDir, MERKLE_STATE), { files: {} }).files || {};
    const info = rels.map((rel) => {
      const abs = path.join(this.projectRoot, rel);
      const exists = fs.existsSync(abs);
      const shapeOk = this.admission.admitsShape(rel);
      const sizeOk = exists && shapeOk ? !this.admission.isOversizedAbs(abs) : false;
      return { rel, exists, shapeOk, sizeOk };
    });
    const gitignored = await this.admission.gitignoredSet(
      info.filter((i) => i.exists && i.shapeOk && i.sizeOk).map((i) => i.rel),
    );
    this.progress('production:dirty-gitignore');

    const files = [];
    const retire = new Set();
    for (const i of info) {
      const admitted = i.exists && i.shapeOk && i.sizeOk && !gitignored.has(i.rel);
      if (admitted) {
        files.push(i.rel);
      } else if (merkle[i.rel]) {
        files.push(i.rel); // previously indexed → keep so hashFile retires it
        retire.add(i.rel);
      }
      // else: never indexed and inadmissible → drop
    }
    this._retireSet = retire;
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
    // Deleted on disk, or flagged inadmissible by readDirtySet (a previously
    // indexed file that became excluded/oversized/gitignored): retire it so all
    // tiers tombstone and the merkle entry is dropped.
    if (!fs.existsSync(abs) || this._retireSet.has(rel)) {
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

  async applyGraphDelta(file, hashes, epoch, ctx = null) {
    const rel = typeof file === 'string' ? file : file.path;
    // E.1: reuse the tick-scoped RW connection (schema already ensured) instead
    // of opening + migrating + closing a connection per file.
    let db;
    let hasFts;
    let ownConn = false;
    if (ctx?.graphDb) {
      db = ctx.graphDb;
      hasFts = ctx.graphHasFts;
    } else {
      const dbPath = path.join(this.stateDir, 'code-graph.db');
      fs.mkdirSync(this.stateDir, { recursive: true });
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      applyMemoryPragmas(db);
      hasFts = createGraphSchema(db);
      migrateEntitiesSchema(db);
      migrateRelationshipsSchema(db);
      ownConn = true;
    }
    try {
      const oldRows = db.prepare('SELECT rowid, id, logical_entity_id, signature_hash FROM entities WHERE file_path = ? AND epoch_retired IS NULL').all(rel);
      const oldByLogical = new Map(oldRows.map((r) => [r.logical_entity_id || r.id, r]));
      const oldIds = oldRows.map((r) => r.id);
      const extractor = new GraphExtractor();
      const parsed = hashes.deleted
        ? { entities: [], relationships: [] }
        : await extractor.extractFromFile(rel, hashes.content);
      this.progress('production:graph-extracted');
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
      this.progress('production:graph-written');
      // E.5: budget-derived FTS5 merge. When the budget flag is off this is the
      // fixed 16-page merge exactly as before; when on, a busy tick (elapsed >
      // 1800ms) skips the merge to leave CPU for reconcile.
      if (hasFts) {
        const pages = fts5BudgetEnabled()
          ? fts5MergeBudgetPages({ elapsedMs: ctx ? Date.now() - ctx.tickStartMs : 0 })
          : 16;
        if (pages != null) {
          for (const table of ['entities_fts', 'entities_trigram']) try { fts5Merge(db, table, pages); } catch {}
        }
      }
      this.touched.set(rel, { ...(this.touched.get(rel) || {}), graphEntities: entities.length });
      return { ops: { graph_upsert: upsert, graph_tombstone: tombstone }, manifest: { path: 'code-graph.db' } };
    } finally {
      if (ownConn) db.close();
    }
  }

  async applyVectorDelta(file, _chunks, hashes, epoch, ctx = null) {
    const rel = typeof file === 'string' ? file : file.path;
    // E.1: reuse the tick-scoped RW connection (schema already ensured).
    let db;
    let ownConn = false;
    if (ctx?.codebaseDb) {
      db = ctx.codebaseDb;
    } else {
      const dbPath = path.join(this.stateDir, 'codebase.db');
      const existed = fs.existsSync(dbPath);
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      applyMemoryPragmas(db);
      existed ? ensureVectorSchema(db) : createVectorSchema(db);
      ownConn = true;
    }
    const vectorOps = [];
    let chunks = [];
    try {
      if (hashes.deleted) {
        const snap = snapshotFileRows(db, rel);
        const retire = db.transaction(() => applyDiff(db, rel, { toReuse: [], toEncode: [], toRetire: [...snap.values()].map((r) => ({ rowId: r.id, chunkStructId: r.chunk_struct_id })) }, epoch));
        const summary = retire();
        const retired = summary.retiredRows.map((r) => ({ retireId: r.oldId, file: rel }));
        this.touched.set(rel, { ...(this.touched.get(rel) || {}), hash: hashes, chunkIds: [] });
        // E.6: drop a deleted file's cutoff signature.
        if (this._cutoffCache) { deleteFileSignature(this._cutoffCache, rel); this._cutoffDirty = true; }
        return { ops: { vectors_delete: summary.retiredRows.length }, vectorOps: retired, tokenOps: retired, gramOps: [{ file: rel, deleted: true }] };
      }
      const parsed = await new ASTChunker({ projectRoot: this.projectRoot }).parseFile(rel, hashes.content);
      this.progress('production:vector-parsed');
      chunks = await enrichChunksFromGraph(parsed.map((chunk, i) => ({ ...chunk, file: rel, id: `${rel}:${chunk.metadata?.line_start || 0}-${chunk.metadata?.line_end || chunk.metadata?.line_start || 0}:${i}` })), this.stateDir, ctx);
      this.progress('production:vector-enriched');
      // E.6 chunk-hash early-cutoff. The signature is the per-chunk encoder-input
      // hashes (embedding_input_hash + li_input_hash) computed from the ENRICHED
      // chunks — so cross-file enrichment (scope/imports injected above) folds in.
      // If the file changed on disk but produces byte-identical encoder inputs
      // (comment-only / reformat edits, or a dependency change that does NOT
      // alter this file's enriched text), the encode + all tier writes are
      // skipped. CORRECTNESS GATE: keyed ONLY on encoder-input hashes, never on
      // the file's own chunk_text_hash / contentUnchanged.
      if (chunkCutoffEnabled()) {
        if (!this._cutoffCache) { this._cutoffCache = loadCutoffCache(this.stateDir); this._cutoffDirty = false; }
        const signature = computeCutoffSignature(chunks);
        const previous = getFileSignature(this._cutoffCache, rel);
        if (signaturesMatch(previous, signature)) {
          this.progress('production:vector-cutoff-skip');
          // Provisional touched entry: keep the file's existing chunkIds so the
          // merkle hash advances (the encoder inputs are unchanged) without any
          // tier write. The merkle still records the new content hash so the
          // file is not re-queued forever.
          const prevTouched = this.touched.get(rel) || {};
          const prevChunkIds = readJson(path.join(this.stateDir, MERKLE_STATE), { files: {} }).files?.[rel]?.chunkIds || prevTouched.chunkIds || [];
          this.touched.set(rel, { ...prevTouched, hash: hashes, chunkIds: prevChunkIds, content: hashes.content });
          if (ctx) ctx.persistedFiles.add(rel);
          return {
            ops: { vectors_upsert: 0, vectors_delete: 0 },
            chunksTotal: chunks.length,
            chunksEncoded: 0,
            chunksReused: chunks.length,
            chunksMetadataDirty: 0,
            skipped: true,
            vectorOps: [],
            tokenOps: [],
            gramOps: [],
            manifest: { path: 'codebase.db' },
          };
        }
      }
      // LI generated-content parity: decide ONCE, from the file's full chunk set
      // (exactly like full indexing's per-file applyIndexingChunkPolicy), whether
      // late interaction skips this file. Embeddings/graph/sparse still index it.
      // Stored per-file so applyLIDelta drops adds even when only a non-first
      // chunk changed and the @generated first chunk was hash-reused.
      const liKept = applyIndexingChunkPolicy(chunks, { projectRoot: this.projectRoot }).kept;
      if (chunks.length > 0 && liKept.length === 0) this._liSkipFiles.add(rel);
      else this._liSkipFiles.delete(rel);
      const annotations = annotateChunksForDelta(chunks, rel);
      const snap = snapshotFileRows(db, rel);
      const delta = diffChunks(chunks, annotations, snap);
      const texts = delta.toEncode.map(({ chunk }) => chunk.embedding_text || `${rel}\n${chunk.text || chunk.content || ''}`);
      const embeddings = texts.length > 0
        ? (await this.vectorEncoder(texts, { onProgress: () => this.progress('production:vector-embedding') })).map((r) => r.embedding || r)
        : [];
      this.progress('production:vector-embedded');
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
      this.progress('production:vector-written');
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

      // CRASH-CONSISTENCY (default per-file path durability). On this path the
      // SQLite vector COMMIT above (`production:vector-written`) lands BEFORE the
      // dependent tiers (HNSW, then LI) are persisted, in separate adapter calls
      // with no shared transaction. A SIGKILL between them leaves the vector rows
      // DURABLE in codebase.db while the HNSW node + LI doc were never written —
      // and the merkle did NOT advance (persistManifest never ran). On the next
      // tick the file is re-reconciled, but its committed rows now hash-MATCH an
      // EXACT reuse in diffChunks → zero re-encode → zero add ops → the chunk is
      // QUERYABLE via FTS/SQLite yet permanently MISSING from the HNSW vector
      // index AND the LI index (a real correctness hole: vector / late-interaction
      // search silently never return it). Verified by the determinism harness
      // `--kill-after-tick 2`: live HNSW + LI diverge (the new gamma.js chunk).
      //
      // FIX (minimal persist-before-advance for the per-file path): the published
      // merkle epoch is the advance authority — persistManifest only advances
      // `merkle.epoch` AFTER a tick wrote its downstream tiers, so any LIVE vector
      // row whose `epoch_written` exceeds the highest published merkle epoch was
      // committed by a tick that never published: a torn post-crash row whose
      // HNSW node / LI doc may be missing. Re-emit a repair op for each such row
      // under its EXISTING id (so the recovered index is identical to a clean
      // run, not a fresh re-encode id):
      //   - HNSW: an ADD op. `index.add` on an already-present id updates in place
      //     (no duplicate node, no graph mutation) → no-op when the node landed,
      //     repair when it didn't.
      //   - LI: a RETIRE+ADD pair. LI `add` appends to a fresh segment and is NOT
      //     idempotent, so we tombstone any existing doc for the id first; the
      //     add then yields exactly one live doc whether or not the doc had
      //     landed. (Retiring a non-existent LI doc is a no-op.)
      //
      // The discriminator is exact and never fires on the happy path: a
      // successful tick always advances `merkle.epoch` to the epoch it wrote its
      // rows at, so on a non-crash tick every prior live row has
      // `epoch_written <= merkle.epoch` and the rows written THIS tick are already
      // in `newIds` (added above), never re-added here. Runs in BOTH the per-file
      // and the E.1 batched path: the batched path never CREATES a torn row (its
      // deferred COMMIT + merkle gating rolls a crashed batch back), but a LEGACY
      // orphan from a pre-batched per-file crash can still exist on disk when the
      // daemon later runs batched, so the repair must heal it under either mode.
      // In the batched path the repair ops join `vectorOps`/`tokenOps`, flow
      // through the tick-scoped adapters into `ctx.pendingAdds`, and are saved by
      // `finalizeTick` — and `db` reads see the committed orphan (prior-tick) row.
      // Byte-diff/behaviour on non-crash runs is UNCHANGED in both modes (no
      // orphan ⇒ no-op; verified by the determinism harness control + sweeps).
      const repairedIds = [];
      if (snap.size > 0) {
        const publishedEpoch = this._publishedEpoch();
        const alreadyAdded = new Set(newIds);
        const chunkByStructId = new Map();
        for (let i = 0; i < chunks.length; i += 1) {
          const sid = annotations[i]?.chunkStructId;
          if (sid != null) chunkByStructId.set(sid, chunks[i]);
        }
        for (const row of snap.values()) {
          if (row.epoch_retired != null) continue;
          if (!Number.isInteger(row.epoch_written) || row.epoch_written <= publishedEpoch) continue;
          if (alreadyAdded.has(row.id)) continue; // written THIS tick already
          const dbRow = db.prepare('SELECT id, embedding, metadata FROM vectors WHERE id = ?').get(row.id);
          if (!dbRow?.embedding) continue;
          vectorOps.push({ addId: dbRow.id, embedding: float32FromBuffer(dbRow.embedding), metadata: JSON.parse(dbRow.metadata || '{}') });
          const chunk = chunkByStructId.get(row.chunk_struct_id);
          if (chunk) {
            tokenOps.push({ retireId: dbRow.id, file: rel });
            tokenOps.push({ addId: dbRow.id, chunk });
          }
          // Record the repaired row in the merkle chunkIds so the file's recorded
          // chunk set reflects the rows actually live after recovery (a torn add
          // produced no `newIds`, so without this the merkle would advance with an
          // empty chunkIds for a file that does have a live, now-indexed chunk).
          repairedIds.push(dbRow.id);
          this.progress('production:vector-crash-recovery');
        }
      }

      const recordedChunkIds = repairedIds.length > 0 ? [...newIds, ...repairedIds] : newIds;
      this.touched.set(rel, { ...(this.touched.get(rel) || {}), hash: hashes, chunkIds: recordedChunkIds, content: hashes.content });
      // E.6: record this file's new cutoff signature (encoder-input hashes of
      // the enriched chunks) for next-tick comparison.
      if (this._cutoffCache) {
        setFileSignature(this._cutoffCache, rel, computeCutoffSignature(chunks));
        this._cutoffDirty = true;
      }
      if (ctx) ctx.persistedFiles.add(rel);
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
      if (ownConn) db.close();
    }
  }

  async applyBinaryHNSWDelta(_file, ops, _epoch, ctx = null) {
    if (!Array.isArray(ops) || ops.length === 0) return { ops: { binary_hnsw_append: 0, binary_hnsw_tombstone: 0 } };

    // E.1 batched path: reuse the resident index, apply tombstones in place, and
    // ACCUMULATE the add ops onto the tick context. The actual `index.add()`
    // insertions are deferred to finalizeTick, where they run sorted-by-id so
    // the graph is reproducible (G1 byte-identity). We still report the per-file
    // append/tombstone counts here for the tick counters.
    if (ctx?.index) {
      const index = ctx.index;
      let append = 0; let tombstone = 0;
      for (const op of ops) {
        if (op.retireId) {
          if (markBinaryStale(index, op.retireId)) tombstone += 1;
          ctx.floatRemoveIds.push(op.retireId);
        }
        if (op.addId && op.embedding) {
          // Stage the add; insertion happens in finalize (sorted by id).
          ctx.pendingAdds = ctx.pendingAdds || [];
          ctx.pendingAdds.push(op);
          append += 1;
        }
      }
      ctx.tombstone += tombstone;
      // append is committed to ctx.append in finalize after the sorted inserts.
      ctx.append += append;
      return { ops: { binary_hnsw_append: append, binary_hnsw_tombstone: tombstone }, manifest: { path: 'codebase-binary-hnsw.idx' } };
    }

    // ---- Per-file path (flag off): exact current behavior. ----
    const indexPath = path.join(this.stateDir, 'codebase-binary-hnsw.idx');
    const index = new BinaryHNSWIndex({ indexPath, stalePath: `${indexPath}.stale.bin`, floatDimension: this.modelInfo.hnswDimension });
    try { await index.load(indexPath); } catch { await index.init(); }
    this.progress('production:binary-hnsw-loaded');
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
      if ((append + tombstone) > 0 && (append + tombstone) % 100 === 0) this.progress('production:binary-hnsw-loop');
    }
    await index.save(indexPath);
    this.progress('production:binary-hnsw-saved');
    await maintainFloatStore(indexPath, { upserts: floatUpserts, removeIds: floatRemoveIds, binaryVectorsBefore, dimension: this.modelInfo.hnswDimension });
    this.progress('production:float-store-maintained');
    return { ops: { binary_hnsw_append: append, binary_hnsw_tombstone: tombstone }, manifest: { path: 'codebase-binary-hnsw.idx' } };
  }

  async applyLIDelta(file, ops) {
    if (!Array.isArray(ops) || ops.length === 0) return { ops: { li_segment_append: 0, li_tombstone: 0 } };
    // LI generated-content parity: full indexing's buildLateInteractionIndex runs
    // applyIndexingChunkPolicy so @generated / config-excluded files never reach
    // the LI encoder, while embeddings/graph/sparse still index them. The skip is
    // a per-file decision computed in applyVectorDelta. Drop this file's LI adds
    // when flagged; retire ops always flow through (a file that becomes generated
    // tombstones its old LI docs and adds none — net retire from LI only).
    const rel = typeof file === 'string' ? file : file?.path;
    const filteredOps = (rel && this._liSkipFiles.has(rel))
      ? ops.filter((op) => !(op.addId && op.chunk))
      : ops;
    const { applyLateInteractionDelta } = await import('./production-li-delta.mjs');
    const { appended, tombstone } = await applyLateInteractionDelta({
      indexPath: path.join(this.stateDir, 'codebase-late-interaction.db'),
      ops: filteredOps,
      liEncoder: this.liEncoder,
      pickLiInput,
      onProgress: () => this.progress('production:li-delta'),
    });
    return { ops: { li_segment_append: appended, li_tombstone: tombstone }, manifest: { path: 'codebase-late-interaction.db', segments: 'codebase-late-interaction.db.segments/manifest.json' } };
  }

  /**
   * Highest SUCCESSFULLY-published merkle epoch (the per-file crash-recovery
   * advance authority — see the torn-row repair in `applyVectorDelta`). Returns
   * -1 when no merkle has been published yet, so any committed row counts as
   * un-advanced. Best-effort + read-only.
   * @returns {number}
   */
  _publishedEpoch() {
    const merkle = readJson(path.join(this.stateDir, MERKLE_STATE), {});
    return Number.isInteger(merkle?.epoch) ? merkle.epoch : -1;
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
      if (count % 100 === 0) this.progress('production:sparse-loop');
    }
    this.progress('production:sparse-done');
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
    // E.1 PERSIST-BEFORE-ADVANCE: when batching, promote a file into the merkle
    // ONLY if its ops are in the persisted batch (recorded in finalizeTick). A
    // file touched this tick but absent from the persisted set (e.g. its HNSW
    // adds did not make the saved batch) is left at its prior merkle state and
    // re-reconciled next tick. Deletions always apply (no HNSW add to persist).
    const persisted = this._lastPersistedFiles;
    const gate = batchTierWritesEnabled() && persisted instanceof Set;
    for (const [file, data] of this.touched.entries()) {
      if (data.hash?.deleted) delete merkle.files[file];
      else if (!gate || persisted.has(file)) merkle.files[file] = { hash: data.hash.contentHash, ...data.hash.stat, epoch: manifest.epoch, chunkIds: data.chunkIds || [] };
    }
    merkle.lastIndex = new Date().toISOString();
    merkle.epoch = manifest.epoch;
    merkle.stats = { ...(merkle.stats || {}), totalFiles: Object.keys(merkle.files).length };
    safeWriteJson(merklePath, merkle);
    // E.6: persist the updated chunk-cutoff cache once per tick (after the
    // merkle advances). Best-effort; a failure only costs a redundant re-embed.
    if (this._cutoffCache && this._cutoffDirty) {
      saveCutoffCache(this.stateDir, this._cutoffCache);
      this._cutoffDirty = false;
    }
    try { fs.unlinkSync(path.join(this.stateDir, PROCESSING_QUEUE)); } catch {}
    fs.appendFileSync(path.join(this.stateDir, METRICS_FILE), JSON.stringify({ ...manifest, ts: Date.now() / 1000, epoch: manifest.epoch }) + '\n');
  }
}

export const __testing = {
  ProductionReconcileAdapter,
  sparseGramRecord,
  markBinaryStale,
  normalizeHnswDeterminismFlags,
  // Reset the one-time forced-on warning latch so each test case observes the
  // warning independently.
  _resetDetLevelsWarnLatch() { _batchForcedDetLevelsWarned = false; },
};
