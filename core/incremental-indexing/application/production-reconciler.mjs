import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

import { Reconciler } from './reconciler.mjs';
import { enqueueMaintenanceJob, readMaintenanceQueue } from './maintenance-worker.mjs';
import { createAdmissionPolicy } from '../../indexing/admission-policy.js';
import { filterGrepCorpusFiles } from '../../indexing/grep-corpus.js';
import { applyIndexingChunkPolicy } from '../../indexing/indexing-file-policy.js';
import { readGrepCorpusState, writeGrepCorpusState } from '../infrastructure/grep-corpus-state.mjs';
import { contentHashSync } from '../infrastructure/hashing.mjs';
import { readManifest, writeManifest } from '../infrastructure/manifest.mjs';
import { annotateChunksForDelta, snapshotFileRows, diffChunks, applyDiff } from '../infrastructure/vector-delta-writer.mjs';
import { appendDeltaRecord, FALLBACK_WEIGHTS_ID, fileIdFor, listDeltaSegments, syncDeltaSegments } from '../infrastructure/sparse-gram-delta.mjs';
import { fts5Merge, fts5MergeBudgetPages } from '../infrastructure/sqlite-fts5.mjs';
import { openSegmentState, tombstoneDoc, persistSegmentState } from '../infrastructure/li-segment-state.mjs';
import { chunkTextFtsWriter } from '../../indexing/chunk-text-fts.js';
import { dropAliasPointersSync } from './production-li-delta.mjs';
import { insertEntity, insertRelationships, resolveTouchedEdges, markBinaryStale, createStaleBatch, maintainFloatStore, flushFloatStore } from './production-reconciler-helpers.mjs';
import { resolveRowsScoped } from '../../graph/relationship-resolver.js';
import { deriveOverrideEdges } from '../../graph/override-edges.js';
import { FloatVectorStore, getFloatStorePath, float512StoreEnabled } from '../../vector-store/float-vector-store.js';
import { createGraphSchema, entityParentIds, GraphExtractor, insertCallSites } from '../../graph/graph-extractor.js';
import { createImportResolver, importEdgesEnabled } from '../../graph/import-resolver.js';
import { syncFileNode } from '../../infrastructure/file-nodes.js';
import { createVectorSchema, ensureVectorSchema, buildInsertItems, insertVectorItems } from '../../indexing/indexer-build.js';
import { ASTChunker, JAVA_FAMILY } from '../../indexing/ast-chunker.js';
import { getEmbeddings, getModelInfo } from '../../embedding/embedding-service.js';
import { BinaryHNSWIndex } from '../../vector-store/binary-hnsw-index.js';
import { floatToBinary, normalizedFloatToInt8, truncateForHNSW } from '../../infrastructure/quantization.js';
import { extractSparseGramDeltaRecord, loadSparseGramIndex, resolveSparseSymbolMask } from '../../infrastructure/native-sparse-gram.js';
import { migrateEntitiesSchema, migrateRelationshipsSchema } from '../infrastructure/schema-migrations.mjs';
import { readMaintenanceState as readMaintenanceStateFromArtifacts } from '../infrastructure/maintenance-state-reader.mjs';
import { prepareCached } from '../../infrastructure/db-utils.js';

const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';
const PROCESSING_QUEUE = 'index-maintainer-queue.processing.jsonl';
const MERKLE_STATE = 'merkle-state.json';
const METRICS_FILE = 'reconcile-metrics.jsonl';
// One line per published epoch; past this size the file moves to `.1` (the
// previous `.1` is dropped). `reconcile status` reads only the last lines.
const METRICS_ROTATE_BYTES = 4 * 1024 * 1024;
// Files that failed a tick (encoder crash, parser blow-up): path -> { count,
// size, mtimeMs, error }. Two failures on unchanged content quarantine the file
// so one bad file cannot stall every later edit; an edit lifts it.
const FILE_FAILURES = 'index-maintainer-failures.json';
const QUARANTINE_AFTER_FAILURES = 2;

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

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

function statTuple(absPath) {
  const stat = fs.statSync(absPath, { bigint: true });
  return { size: stat.size.toString(), mtime_ns: stat.mtimeNs.toString(), inode: stat.ino.toString() };
}

function safeWriteJson(filePath, payload, { compact = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, filePath);
}

function relativeArtifact(stateDir, filePath) {
  return path.relative(stateDir, filePath).replace(/\\/g, '/');
}

/**
 * Re-derive `overrides` edges on the maintained graph (override-edges.js:
 * live rows only, diffed — unchanged edges keep their rows, vanished ones
 * retire at `epoch`). Non-fatal: the derivation reads the whole live graph,
 * so a failed pass is repaired by the next tick that writes the graph.
 */
function deriveOverridesSafely(db, epoch, logger) {
  try {
    return deriveOverrideEdges(db, null, { epoch });
  } catch (err) {
    (logger || console).warn?.(`[reconciler] override edges not derived this tick: ${err?.message || err}`);
    return null;
  }
}

function uniquePhysicalId(db, table, id) {
  let candidate = id;
  let suffix = 1;
  const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
  while (stmt.get(candidate)) candidate = `${id}.${suffix++}`;
  return candidate;
}

// The sparse-gram record for `content` from the loaded base (`extractor.index`; without a
// base, the addon's standalone extractor). Null without the native addon.
function sparseGramRecord(extractor, content) {
  const extracted = extractSparseGramDeltaRecord({ index: extractor.index, content });
  if (!extracted) return null;
  return {
    weightsId: extracted.weightsId || FALLBACK_WEIGHTS_ID,
    grams: [...new Set(extracted.grams || [])].sort().map((gram) => [gram, 1]),
  };
}

// The sparse symbol mask of a file's live vector rows, as the full build derives it
// (indexer-sparse-gram.js): a symbol-filtered grep then narrows on this file too.
function fileSymbolMask(db, rel) {
  let mask = 0;
  for (const row of prepareCached(db, 'SELECT metadata FROM vectors WHERE file_path = ? AND epoch_retired IS NULL').iterate(rel)) {
    try { mask |= resolveSparseSymbolMask(JSON.parse(row.metadata || '{}').type); } catch { /* malformed row */ }
  }
  return mask;
}

function fileIdentity(filePath) {
  try {
    const st = fs.statSync(filePath, { bigint: true });
    return `${st.ino}:${st.size}:${st.mtimeNs}`;
  } catch {
    return null;
  }
}

/** True when a live entity row stores exactly what a fresh extraction would. */
function sameEntityRow(row, e) {
  const v = (x) => (x === undefined || x === '' ? null : x);
  return v(row.signature_hash) === v(e.signature_hash)
    && v(row.type) === v(e.type)
    && v(row.name) === v(e.name)
    && v(row.signature) === v(e.signature)
    && v(row.doc_comment) === v(e.doc_comment)
    && v(row.start_line) === v(e.start_line || null)
    && v(row.end_line) === v(e.end_line || null)
    && v(row.package) === v(e.package)
    && v(row.parent_class) === v(e.parent_class);
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
    const entityStmt = prepareCached(db, 'SELECT type, name, start_line, end_line FROM entities WHERE file_path = ? AND epoch_retired IS NULL ORDER BY start_line ASC');
    const fileEntityStmt = prepareCached(db, 'SELECT id FROM entities WHERE file_path = ? AND logical_entity_id = ? AND epoch_retired IS NULL ORDER BY epoch_written DESC LIMIT 1');
    const importStmt = prepareCached(db, "SELECT DISTINCT target_name FROM relationships WHERE source_id = ? AND type IN ('imports', 'plainImport') AND epoch_retired IS NULL ORDER BY target_name");
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

function envInt(env, name, min = 1) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : undefined; // malformed or below min → the reconciler default
}

/** Budget config from the environment; malformed values keep the reconciler defaults. */
export function tickBudgetConfig(env = process.env) {
  const filesPerTick = envInt(env, 'SWEET_SEARCH_RECONCILE_FILES_PER_TICK');
  const cpuBudgetMs = envInt(env, 'SWEET_SEARCH_RECONCILE_CPU_BUDGET_MS');
  return { filesPerTick, cpuBudgetMs };
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
      ...tickBudgetConfig(process.env),
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
    // The reconciler's file cap, when the caller sets it (readDirtySet admits twice this).
    this._filesPerTick = options.config?.filesPerTick ?? null;
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    this.vectorEncoder = options.vectorEncoder || ((texts, progressOptions = {}) => getEmbeddings(texts, {
      useCache: false,
      onProgress: progressOptions.onProgress,
    }));
    this.liEncoder = options.liEncoder || null;
    this.modelInfo = options.modelInfo || getModelInfo();
    this.logger = options.logger || null;
    // Shared admission policy — the SAME include/exclude/.sweet-search-ignore/
    // .gitignore/size gates full indexing applies. Used as the second safety
    // gate: queued files full indexing would skip are never reconciled, and a
    // previously-indexed file that is now inadmissible is retired (see
    // readDirtySet → _retireSet → hashFile).
    this.admission = options.admissionPolicy || createAdmissionPolicy({ projectRoot: this.projectRoot });
    this._retireSet = new Set();
    // Grep-only files (sparse-gram corpus, outside embedding admission): reconciled through
    // the sparse-gram tier alone and recorded in grep-corpus-state.json, not the merkle.
    // _grepKeep: retired embedding files that stay in the grep corpus (their sparse record
    // keeps the content instead of deleting it). _grepTouched: rel -> {hash, stat} | null.
    this._grepOnly = new Set();
    this._grepKeep = new Set();
    this._grepTouched = new Map();
    // Delta segments appended without fsync this tick (persistManifest syncs them).
    this._unsyncedDeltaSegments = new Set();
    this._sparseBase = null;
    this._tickAdmitted = [];
    this._liSkipFiles = new Set();
    this.touched = new Map();
    // Content-unchanged files whose stat moved (checkout, touch, same-bytes
    // rewrite): only the merkle stat is refreshed, or every scan requeues them.
    this._statRefresh = new Map();
    // E.1: the active tick-scoped store context (null on the per-file path).
    this._tickCtx = null;
    // merkle-state.json is written exactly once per tick (persistManifest);
    // every other reader gets one shared parse. `undefined` = not read yet,
    // `null` = missing/corrupt file.
    this._merkleCache = undefined;
  }

  /**
   * Shared read of merkle-state.json — parsed once per adapter lifetime and
   * invalidated by persistManifest (the only writer). All consumers treat the
   * object as read-only.
   * @returns {object|null}
   */
  _merkleRead() {
    if (this._merkleCache === undefined) {
      this._merkleCache = readJson(path.join(this.stateDir, MERKLE_STATE), null);
    }
    return this._merkleCache;
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
      recordFileFailure: (file, err) => this.recordFileFailure(file, err),
      // The queue held only inadmissible paths that were never indexed.
      releaseEmptyTick: () => { try { fs.unlinkSync(path.join(this.stateDir, PROCESSING_QUEUE)); } catch {} },
      isFreshDirtyFile: (file) => this._freshRels?.has(file) === true,
      requeueDirtyFiles: (files) => this.requeueDirtyFiles(files),
      requeueDirtyFilesAfterFailure: (files) => this.requeueDirtyFilesAfterFailure(files),
      recordUnchangedFile: (file, hashes) => this.recordUnchangedFile(file, hashes),
      hashFile: (file) => this.hashFile(file),
      loadCurrentManifest: () => readManifest(this.stateDir),
      persistManifest: (manifest) => this.persistManifest(manifest),
      applyGraphDelta: (file, hashes, epoch, ctx) => this.applyGraphDelta(file, hashes, epoch, ctx),
      applyVectorDelta: (file, chunks, hashes, epoch, ctx) => this.applyVectorDelta(file, chunks, hashes, epoch, ctx),
      applyBinaryHNSWDelta: (file, ops, epoch, ctx) => this.applyBinaryHNSWDelta(file, ops, epoch, ctx),
      applyLIDelta: (file, ops, epoch, ctx) => this.applyLIDelta(file, ops, ctx),
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
   * the binary HNSW + float store once.
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
      // Step 2a LAZY TICK STORES. The binary HNSW + float store are NOT loaded
      // here. On this repository they are ~253 MB of fresh allocation, and an
      // idle tick (empty dirty set) never touches them, so eagerly loading them
      // every ~20 s was pure churn. They are materialised on first use through
      // `ctx.ensureStores()` — from `applyBinaryHNSWDelta` (a file actually has
      // vector ops) and from `finalizeTick` (staged adds, or a resident live
      // store that may be due for a deferred disk save).
      index: null,
      floatStore: null,
      binaryVectorsBefore: 0,
      storesLoaded: false,
      // `live` is resolved EAGERLY: it is an environment read, not a load. The
      // finalize guard below tests `ctx.live` to decide whether a resident
      // store may need flushing, so deferring it would make that guard circular
      // (no stores loaded ⇒ no `live` ⇒ never flush) and strand a pending
      // deferred disk save across idle ticks under
      // SWEET_SEARCH_RECONCILE_LIVE_HNSW=1.
      live: liveHnswEnabled(),
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

    // Step 2a: single-flight loader for the tick-scoped stores. Idempotent and
    // safe to call from anywhere in the tick; the first call pays the load, all
    // later calls resolve on the same promise. Under E.2 (live HNSW) the
    // resident registry entry usually satisfies it with no disk read at all.
    let storesPromise = null;
    const loadStores = async () => {
      const live = ctx.live ? this._getLiveStore(ctx.indexPath) : null;
      let index = live?.index || null;
      let floatStore = live?.floatStore || null;
      if (!index) {
        index = new BinaryHNSWIndex({
          indexPath: ctx.indexPath,
          stalePath: `${ctx.indexPath}.stale.bin`,
          floatDimension: this.modelInfo.hnswDimension,
        });
        try { await index.load(ctx.indexPath); } catch { await index.init(); }
      }
      ctx.index = index;
      // Captured BEFORE the float store loads, exactly as the eager path did.
      ctx.binaryVectorsBefore = index.idToIndex?.size ?? 0;
      if (!floatStore && float512StoreEnabled()) {
        floatStore = new FloatVectorStore();
        try {
          await floatStore.loadOrInit(getFloatStorePath(ctx.indexPath), this.modelInfo.hnswDimension);
        } catch { /* fall back to fresh */ }
      }
      ctx.floatStore = floatStore;
      ctx.storesLoaded = true;
      return ctx;
    };
    ctx.ensureStores = () => (storesPromise ??= loadStores());

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
      // Override edges for every graph write of this tick: one pass over the
      // live graph, inside the tick's open transaction (committed with it).
      if (ctx.overridesEpoch != null && ctx.graphDb) {
        ctx.overrideStats = deriveOverridesSafely(ctx.graphDb, ctx.overridesEpoch, this.logger);
        ctx.overridesEpoch = null;
        this.progress('production:overrides-derived');
      }
      // E.1: insert all staged adds into the resident index in a DETERMINISTIC
      // order (sorted by id). Combined with G1's per-id deterministic levels and
      // sorted-order compaction, this makes the batched graph reproducible and
      // byte-identical across batch / rebuild / compaction construction paths.
      const pending = ctx.pendingAdds || [];
      if (pending.length > 0) {
        // Step 2a: staged adds imply `applyBinaryHNSWDelta` already opened the
        // stores; this is the belt-and-braces no-op that keeps the invariant
        // local rather than inherited.
        await ctx.ensureStores?.();
        pending.sort((a, b) => (a.addId < b.addId ? -1 : a.addId > b.addId ? 1 : 0));
        let done = 0;
        for (const op of pending) {
          const truncated = truncateForHNSW(op.embedding, this.modelInfo.hnswDimension);
          await ctx.index.add(op.addId, floatToBinary(truncated), op.metadata || {}, normalizedFloatToInt8(truncated), op.embedding);
          ctx.floatUpserts.push({ id: op.addId, vector: truncated });
          if ((++done) % 100 === 0) this.progress('production:binary-hnsw-loop');
        }
        this.progress('production:binary-hnsw-batched');
      }
      ctx.pendingAdds = [];

      if (ctx.live) {
        const entry = liveStoreRegistry.get(ctx.indexPath);
        // Step 2a: run the resident-store bookkeeping when this tick actually
        // opened the stores, OR when an earlier tick left a resident index in
        // the registry (that index may carry a deferred, not-yet-saved delta
        // and must still be re-evaluated for the save thresholds). When neither
        // holds there is nothing resident and nothing staged, so the whole
        // block is a no-op and the stores stay unloaded. `ensureStores()` costs
        // no disk read in the resident case — it adopts `entry.index`.
        if (entry && (ctx.storesLoaded || entry.index)) {
          await ctx.ensureStores();
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
          } else if (ctx.floatStore && (ctx.floatUpserts.length || ctx.floatRemoveIds.length)) {
            // Keep the float store's in-memory delta consistent with the live
            // index even when we skip the disk save (so a later threshold save
            // writes the full set).
            ctx.floatStore.applyDelta({ upserts: ctx.floatUpserts, removeIds: ctx.floatRemoveIds });
          }
        }
      } else if (ctx.append > 0 || ctx.tombstone > 0) {
        // Non-zero op counters imply `applyBinaryHNSWDelta` opened the stores.
        await ctx.ensureStores?.();
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
      // Tombstones last: a crash before this leaves retired rows visible (codebase.db
      // divergence schedules the binary_hnsw compaction), never live rows hidden.
      ctx.staleBatch?.flush();
      await this._persistLiTombstones(ctx);
      if (ctx.aliasDrops?.size) dropAliasPointersSync(path.join(this.stateDir, 'codebase-late-interaction.db'), ctx.aliasDrops);
      if (ctx.liAppend?.writer) {
        const { appendDeferredLiSegment } = await import('./production-li-delta.mjs');
        await appendDeferredLiSegment(path.join(this.stateDir, 'codebase-late-interaction.db'), ctx.liAppend);
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
    this._requeued = [];
    this._freshRels = new Set();
    fs.mkdirSync(this.stateDir, { recursive: true });
    const processing = path.join(this.stateDir, PROCESSING_QUEUE);
    const queue = path.join(this.stateDir, DIRTY_QUEUE);
    if (!fs.existsSync(processing) && fs.existsSync(queue)) {
      fs.renameSync(queue, processing);
    }
    // Fresh hints (watcher, scan, CLI) go first, newest first, so an edit made
    // during a backlog is not stuck behind the tails earlier ticks requeued.
    // Requeued tails keep their order after them. The scan skips a path that is
    // already queued, so a requeued file edited after it was queued counts as
    // fresh here.
    const entries = readJsonl(processing);
    // When each path was last observed. A deferred file is requeued with this
    // time, not the requeue time: an edit made during the tick must still read
    // as newer than its queue entry (_editedSinceQueued) and go first.
    this._observedAt = new Map();
    for (const e of entries) {
      const rel = relPath(this.projectRoot, e.file_path || e.path || e.filePath || '');
      if (rel && Number.isFinite(e.timestamp)) this._observedAt.set(rel, Math.max(e.timestamp, this._observedAt.get(rel) ?? 0));
    }
    const fresh = [];
    const requeued = [];
    for (let k = entries.length - 1; k >= 0; k--) {
      const e = entries[k];
      (e.source === 'requeue' && !this._editedSinceQueued(e) ? requeued : fresh).push(e);
    }
    requeued.reverse();
    let rels = [];
    const seen = new Set();
    const entryOf = new Map();
    for (const [k, entry] of [...fresh, ...requeued].entries()) {
      const rel = relPath(this.projectRoot, entry.file_path || entry.path || entry.filePath || '');
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      rels.push(rel);
      entryOf.set(rel, entry);
      if (k < fresh.length) this._freshRels.add(rel);
    }

    // Admit only what this tick can reach. Stat, symlink, gitignore and content checks on
    // the whole queue made a backlog drain in O(backlog^2) (20k queued files: 12.6 s per
    // tick for 50 processed). The rest goes back to the queue as it was (same entries, so
    // fresh edits stay first); a failed tick takes it out again like its deferred tail.
    const sliceLimit = this._dirtySliceLimit();
    if (rels.length > sliceLimit) {
      const tail = rels.slice(sliceLimit);
      rels = rels.slice(0, sliceLimit);
      const queueFile = path.join(this.stateDir, DIRTY_QUEUE);
      const text = tail.map((rel) => `${JSON.stringify(entryOf.get(rel))}\n`).join('');
      let offset = 0;
      try { offset = fs.statSync(queueFile).size; } catch { offset = 0; }
      fs.appendFileSync(queueFile, text);
      this._requeued.push({ offset, text });
    }

    // Admission rule 5: a path that is a symlink or runs through a symlinked
    // directory is never admitted (full discovery does not follow symlinks), and
    // a previously indexed one is retired below. An edit made through such a
    // path changed the real file, so queue the real path when it is a regular
    // file inside the project root.
    // The real path goes right after its source, so a fresh edit's real file
    // stays ahead of the requeued backlog.
    const symlinkMemo = new Map();
    const symlinked = new Set();
    const realAfter = new Map();
    const canProbe = typeof this.admission.isSymlinkedRel === 'function';
    for (let k = 0, n = canProbe ? rels.length : 0; k < n; k++) {
      const rel = rels[k];
      if (!this.admission.isSymlinkedRel(rel, symlinkMemo)) continue;
      symlinked.add(rel);
      const real = this.admission.realRelInsideRoot(rel);
      if (!real || seen.has(real)) continue;
      try {
        if (!fs.statSync(path.join(this.projectRoot, real)).isFile()) continue;
      } catch {
        continue;
      }
      seen.add(real);
      realAfter.set(rel, real);
      if (this._freshRels.has(rel)) this._freshRels.add(real);
    }
    if (realAfter.size > 0) rels = rels.flatMap((rel) => (realAfter.has(rel) ? [rel, realAfter.get(rel)] : [rel]));

    // Second admission gate. A queued file that full indexing would skip is
    // dropped if it was never indexed, and retired if it was (so the index
    // converges to a fresh full rebuild). Existence + shape + size are sync;
    // gitignore is ONE batched check over the admissible candidates.
    const merkle = (this._merkleRead() ?? { files: {} }).files || {};
    const info = rels.map((rel) => {
      const abs = path.join(this.projectRoot, rel);
      const exists = fs.existsSync(abs);
      const shapeOk = !symlinked.has(rel) && this.admission.admitsShape(rel);
      const sizeOk = exists && shapeOk ? !this.admission.isOversizedAbs(abs) : false;
      return { rel, exists, shapeOk, sizeOk };
    });
    const gitignored = await this.admission.gitignoredSet(
      info.filter((i) => i.exists && i.shapeOk && i.sizeOk).map((i) => i.rel),
    );
    this.progress('production:dirty-gitignore');

    // Full discovery's content-shape skip: a minified or bundled file is dropped (retired
    // when indexed). Only queued files are read, so this runs on new and changed files.
    const minified = typeof this.admission.minifiedSet === 'function'
      ? await this.admission.minifiedSet(info.filter((i) => i.exists && i.shapeOk && i.sizeOk && !gitignored.has(i.rel)).map((i) => i.rel))
      : new Set();
    const admittedOf = (i) => i.exists && i.shapeOk && i.sizeOk && !gitignored.has(i.rel) && !minified.has(i.rel);
    // The grep corpus is wider than embedding admission: an inadmissible file it still
    // holds is reconciled through the sparse-gram tier alone (or keeps its sparse content
    // when an embedding file leaves admission), and a known grep-only file that left the
    // corpus is deleted from it.
    const grepKnown = readGrepCorpusState(this.stateDir).files;
    const grepEligible = await this._grepEligible(
      info.filter((i) => i.exists && !symlinked.has(i.rel) && !admittedOf(i)).map((i) => i.rel),
    );
    this._grepOnly = new Set();
    this._grepEligibleSet = grepEligible;
    this._grepKeep = new Set();
    this._grepTouched = new Map();
    const files = [];
    const retire = new Set();
    for (const i of info) {
      if (admittedOf(i)) {
        files.push(i.rel);
      } else if (merkle[i.rel]) {
        files.push(i.rel); // previously indexed → keep so hashFile retires it
        retire.add(i.rel);
        if (grepEligible.has(i.rel)) this._grepKeep.add(i.rel);
      } else if (grepEligible.has(i.rel) || grepKnown[i.rel]) {
        files.push(i.rel);
        this._grepOnly.add(i.rel);
      }
      // else: never indexed and inadmissible → drop
    }
    this._retireSet = retire;
    const live = this._dropQuarantined(files, retire);
    // Admitted this tick (new files included): the import resolver's file set.
    this._tickAdmitted = live.filter((f) => !retire.has(f) && !this._grepOnly.has(f));
    return live;
  }

  /** Queue entries a tick admits: twice its file cap (unchanged files do not count toward it). */
  _dirtySliceLimit() {
    const perTick = this._filesPerTick
      ?? Number.parseInt(process.env.SWEET_SEARCH_RECONCILE_FILES_PER_TICK || '50', 10);
    return Math.max(1, perTick) * 2;
  }

  /** The `rels` (existing, not symlinked) the sparse-gram corpus admits (grep-corpus.js gates). */
  async _grepEligible(rels) {
    if (rels.length === 0) return new Set();
    const kept = await filterGrepCorpusFiles(rels, { projectRoot: this.projectRoot, policy: this.admission });
    const ignored = kept.length > 0 ? await this.admission.gitignoredSet(kept) : new Set();
    return new Set(kept.filter((rel) => !ignored.has(rel)));
  }

  _readFailures() {
    return readJson(path.join(this.stateDir, FILE_FAILURES), {}) || {};
  }

  _statKey(rel) {
    try {
      const st = fs.statSync(path.join(this.projectRoot, rel));
      return { size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  }

  /** Drop quarantined files whose content has not changed since they failed. */
  _dropQuarantined(files, retire) {
    const failures = this._readFailures();
    if (Object.keys(failures).length === 0) return files;
    let changed = false;
    const live = files.filter((rel) => {
      const f = failures[rel];
      if (!f || retire.has(rel)) return true;
      const now = this._statKey(rel);
      if (!now || now.size !== f.size || now.mtimeMs !== f.mtimeMs) {
        delete failures[rel]; // edited since it failed: try again from zero
        changed = true;
        return true;
      }
      return f.count < QUARANTINE_AFTER_FAILURES;
    });
    if (changed) safeWriteJson(path.join(this.stateDir, FILE_FAILURES), failures);
    return live;
  }

  /** A tick failed while this file was in flight. */
  recordFileFailure(rel, err) {
    const failures = this._readFailures();
    const now = this._statKey(rel);
    if (!now) return;
    const prev = failures[rel];
    const same = prev && prev.size === now.size && prev.mtimeMs === now.mtimeMs;
    const count = same ? prev.count + 1 : 1;
    failures[rel] = { ...now, count, error: String(err?.message ?? err).slice(0, 300), at: new Date().toISOString() };
    safeWriteJson(path.join(this.stateDir, FILE_FAILURES), failures);
    if (count === QUARANTINE_AFTER_FAILURES) {
      this.logger?.warn?.(`[reconciler] ${rel} failed ${count} ticks in a row (${failures[rel].error}); skipping it until it is edited`);
    }
  }

  _editedSinceQueued(entry) {
    if (!Number.isFinite(entry.timestamp)) return false;
    const rel = relPath(this.projectRoot, entry.file_path || entry.path || entry.filePath || '');
    if (!rel) return false;
    try {
      return fs.statSync(path.join(this.projectRoot, rel)).mtimeMs > entry.timestamp;
    } catch {
      return false;
    }
  }

  requeueDirtyFiles(files) {
    if (!Array.isArray(files) || files.length === 0) return;
    fs.mkdirSync(this.stateDir, { recursive: true });
    const queue = path.join(this.stateDir, DIRTY_QUEUE);
    const now = Date.now();
    const text = files.map((file) => {
      const rel = file.path || file;
      return JSON.stringify({ file_path: rel, timestamp: this._observedAt?.get(rel) ?? now, source: 'requeue' }) + '\n';
    }).join('');
    let offset = 0;
    try { offset = fs.statSync(queue).size; } catch { offset = 0; }
    fs.appendFileSync(queue, text);
    (this._requeued ||= []).push({ offset, text });
  }

  /**
   * After a failed tick the processing queue is still on disk (only a publish
   * removes it), and the next readDirtySet reads it again. Requeueing its files
   * too would copy the whole list into the queue on every failure. The deferred
   * tail this tick appended before it failed is in the processing queue as
   * well: take it out again, or every failing tick adds one more copy.
   */
  requeueDirtyFilesAfterFailure(files) {
    if (fs.existsSync(path.join(this.stateDir, PROCESSING_QUEUE))) {
      this._dropRequeuedTail();
      return;
    }
    this.requeueDirtyFiles(files);
  }

  _dropRequeuedTail() {
    const appends = this._requeued || [];
    this._requeued = [];
    if (appends.length === 0) return;
    const queue = path.join(this.stateDir, DIRTY_QUEUE);
    try {
      let buf = fs.readFileSync(queue);
      // Newest append first; remove only our own bytes, so lines another writer
      // appended after them stay.
      for (const { offset, text } of appends.reverse()) {
        const tail = buf.subarray(offset).toString('utf8');
        if (!tail.startsWith(text)) return;
        buf = Buffer.concat([buf.subarray(0, offset), Buffer.from(tail.slice(text.length), 'utf8')]);
      }
      const tmp = `${queue}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, queue);
    } catch { /* best-effort: readers dedupe repeated paths */ }
  }

  recordUnchangedFile(file, hashes) {
    const rel = typeof file === 'string' ? file : file.path;
    if (hashes?.grepOnly) this._grepTouched.set(rel, { hash: hashes.contentHash, stat: hashes.stat });
    else if (hashes?.stat) this._statRefresh.set(rel, { hash: hashes.contentHash, stat: hashes.stat });
  }

  /**
   * A grep-only file, for the reconciler's sparse-only path: a deletion when it is gone or
   * left the corpus, else its content (unchanged when the recorded hash matches).
   */
  _hashGrepOnly(rel, abs) {
    if (!fs.existsSync(abs) || !this._grepEligibleSet?.has(rel)) {
      this._grepTouched.set(rel, null);
      return { file: rel, sparseOnly: true, grepOnly: true, deleted: true, contentHash: '', gramOps: [{ file: rel, deleted: true }] };
    }
    const stat = statTuple(abs); // before the read, as in hashFile
    const content = fs.readFileSync(abs);
    // The native base builder drops a file that is not valid UTF-8 (binary): so does this.
    // Its stat is still recorded, so the scan does not discover it again.
    let text;
    try { text = UTF8_STRICT.decode(content); } catch { text = null; }
    if (text === null) {
      this._grepTouched.set(rel, { hash: '', stat });
      return { file: rel, sparseOnly: true, grepOnly: true, deleted: true, contentHash: '', gramOps: [{ file: rel, deleted: true }] };
    }
    const contentHash = contentHashSync(content);
    const known = readGrepCorpusState(this.stateDir).files[rel];
    const contentUnchanged = known?.hash === contentHash;
    if (!contentUnchanged) this._grepTouched.set(rel, { hash: contentHash, stat });
    return {
      file: rel,
      sparseOnly: true,
      grepOnly: true,
      contentHash,
      stat,
      contentUnchanged,
      gramOps: [{ file: rel, deleted: false, content: text, contentHash }],
    };
  }

  async hashFile(file) {
    const rel = typeof file === 'string' ? file : file.path;
    const abs = path.join(this.projectRoot, rel);
    const merkle = this._merkleRead() ?? { files: {} };
    if (this._grepOnly.has(rel)) return this._hashGrepOnly(rel, abs);
    // Deleted on disk, or flagged inadmissible by readDirtySet (a previously
    // indexed file that became excluded/oversized/gitignored): retire it so all
    // tiers tombstone and the merkle entry is dropped. A retired file the grep
    // corpus keeps carries its content for the sparse-gram record.
    if (!fs.existsSync(abs) || this._retireSet.has(rel)) {
      const grep = this._grepKeep.has(rel) ? this._hashGrepOnly(rel, abs) : null;
      return { file: rel, deleted: true, contentHash: '', chunks: [], ...(grep && !grep.deleted ? { grepKeep: grep } : {}) };
    }
    // Stat BEFORE the read. The merkle stores this stat with the hash, and the
    // next scan skips a file whose size and mtime match it. A write that lands
    // after the stat leaves the file's stat different from the stored one, so
    // the scan picks it up again; a stat taken after the read could pair the
    // old content's hash with the new stat and hide the edit for good.
    const stat = statTuple(abs);
    const content = fs.readFileSync(abs);
    const contentHash = contentHashSync(content);
    const previous = merkle.files?.[rel];
    return {
      file: rel,
      absPath: abs,
      content: content.toString('utf8'),
      contentHash,
      stat,
      contentUnchanged: previous?.hash === contentHash,
    };
  }

  /**
   * Tick-scoped import resolver (same rules as the full build). The file list
   * is the graph's live files; candidates missing from it are checked on disk
   * (new files in this tick), and configs are re-read every tick.
   */
  _importResolverFor(ctx, db) {
    if (!importEdgesEnabled() || !this.projectRoot) return null;
    if (ctx && ctx.importResolver !== undefined) return ctx.importResolver;
    let resolver = null;
    try {
      // Resolve against the file set a full build resolves against: every
      // indexed file (merkle-state.json) plus this tick's admitted files,
      // minus this tick's retirements. A disk probe would also link
      // gitignored / excluded / oversized files (generated code, dist/) that
      // a full build never sees. Before any merkle state exists (a fresh
      // maintainer), the graph's live files plus a disk probe stand in.
      const merkle = this._merkleRead()?.files;
      if (merkle && Object.keys(merkle).length > 0) {
        const files = new Set(Object.keys(merkle));
        for (const f of this._retireSet || []) files.delete(f);
        for (const f of this._tickAdmitted || []) files.add(f);
        resolver = createImportResolver({ projectRoot: this.projectRoot, files, probeFs: false });
      } else {
        const files = prepareCached(db, 'SELECT DISTINCT file_path FROM entities WHERE epoch_retired IS NULL').pluck().all();
        resolver = createImportResolver({ projectRoot: this.projectRoot, files, probeFs: true });
      }
    } catch {
      resolver = null;
    }
    if (ctx) ctx.importResolver = resolver;
    return resolver;
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
      const oldRows = prepareCached(db, 'SELECT rowid, id, name, logical_entity_id, signature_hash, type, signature, doc_comment, start_line, end_line, package, parent_class, parent_id, page_rank FROM entities WHERE file_path = ? AND epoch_retired IS NULL').all(rel);
      const oldByLogical = new Map(oldRows.map((r) => [r.logical_entity_id || r.id, r]));
      const oldIds = oldRows.map((r) => r.id);
      const importResolver = this._importResolverFor(ctx, db);
      const extractor = new GraphExtractor(importResolver ? { importResolver } : undefined);
      const parsed = hashes.deleted
        ? { entities: [], relationships: [] }
        : await extractor.extractFromFile(rel, hashes.content);
      this.progress('production:graph-extracted');
      const entities = [...(parsed.entities || [])];
      const relationships = parsed.relationships || [];
      const callSites = parsed.callSites || [];
      // File-level edges keep the file's logical id as their source — the
      // same id a full build writes. The file's node lives in the `files`
      // table (file-nodes.js), never in `entities`: an entity row here made
      // maintained graphs differ from fresh builds (PageRank, scope chains,
      // symbol search) and gave file-level edges a per-epoch source id.
      const fileLogicalId = graphEntityLogicalId(rel, 'file', path.basename(rel));
      let upsert = 0;
      let tombstone = 0;
      let edgeResolution = null;
      let overrideStats = null;
      const liveIdFor = new Map();
      const tx = db.transaction(() => {
        const retireEntity = prepareCached(db, 'UPDATE entities SET epoch_retired = ?, stale_since = COALESCE(stale_since, ?) WHERE id = ? AND epoch_retired IS NULL');
        const retireRel = oldIds.length > 0
          ? db.prepare(`UPDATE relationships SET epoch_retired = ? WHERE source_id IN (${oldIds.map(() => '?').join(',')}) AND epoch_retired IS NULL`)
          : null;
        if (retireRel) retireRel.run(epoch, ...oldIds);
        // A full build writes the file-level rows (`imports`, `importsFile`)
        // under the file's logical id with no file entity row, so oldIds never
        // lists it and those rows stayed live forever after an edit (a removed
        // import kept its edge). Retire them with the rest of the file — and
        // the file-level call sites (call_sites, call_lines) stored under the
        // same id.
        if (!oldIds.includes(fileLogicalId)) {
          prepareCached(db, 'UPDATE relationships SET epoch_retired = ? WHERE source_id = ? AND epoch_retired IS NULL').run(epoch, fileLogicalId);
          prepareCached(db, 'UPDATE call_sites SET epoch_retired = ? WHERE source_id = ? AND epoch_retired IS NULL').run(epoch, fileLogicalId);
          prepareCached(db, 'UPDATE call_lines SET epoch_retired = ? WHERE source_id = ? AND epoch_retired IS NULL').run(epoch, fileLogicalId);
        }
        // The file's node: one live row while the file exists, retired on
        // delete. Older maintained graphs also hold a `file` row in
        // `entities`; it is in oldRows and retires below like any entity
        // the new extraction no longer emits.
        syncFileNode(db, rel, { epoch, deleted: !!hashes.deleted, node: parsed.file });
        // A deleted file is no longer an import target of any other file.
        if (hashes.deleted) {
          prepareCached(db, "UPDATE relationships SET epoch_retired = ? WHERE type = 'importsFile' AND target_name = ? AND epoch_retired IS NULL").run(epoch, rel);
        }
        if (oldIds.length > 0) {
          db.prepare(`UPDATE call_sites SET epoch_retired = ? WHERE source_id IN (${oldIds.map(() => '?').join(',')}) AND epoch_retired IS NULL`).run(epoch, ...oldIds);
          db.prepare(`UPDATE call_lines SET epoch_retired = ? WHERE source_id IN (${oldIds.map(() => '?').join(',')}) AND epoch_retired IS NULL`).run(epoch, ...oldIds);
        }
        const retiredIds = [];
        const nextLogical = new Set(entities.map((e) => e.id));
        for (const row of oldRows) {
          if (!nextLogical.has(row.logical_entity_id || row.id)) {
            retireEntity.run(epoch, epoch, row.id);
            retiredIds.push(row.id);
            tombstone += 1;
          }
        }
        // Keep a live row only when every stored column is unchanged,
        // including its HCGS parent. Entity ids carry no line number
        // (GraphExtractor.entityId), so a definition moved by an edit above
        // it keeps its id; its row must still be re-written, or the
        // maintained graph keeps stale lines that a fresh build does not
        // have. A member's `parent_id` is its parent's stored row, so a
        // re-written parent re-writes its kept members too.
        const parentOf = entityParentIds(entities);
        const oldLogicalOfRow = new Map(oldRows.map((r) => [r.id, r.logical_entity_id || r.id]));
        const rewrite = new Set();
        for (const e of entities) {
          const old = oldByLogical.get(e.id);
          const oldParent = old?.parent_id ? (oldLogicalOfRow.get(old.parent_id) ?? old.parent_id) : null;
          if (!old || !sameEntityRow(old, e) || oldParent !== (parentOf.get(e.id) ?? null)) rewrite.add(e.id);
        }
        for (let grew = true; grew;) {
          grew = false;
          for (const e of entities) {
            const parent = parentOf.get(e.id);
            if (parent && !rewrite.has(e.id) && rewrite.has(parent)) { rewrite.add(e.id); grew = true; }
          }
        }
        for (const e of entities) {
          const old = oldByLogical.get(e.id);
          if (!rewrite.has(e.id)) {
            liveIdFor.set(e.id, old.id);
            continue;
          }
          if (old) {
            retireEntity.run(epoch, epoch, old.id);
            retiredIds.push(old.id);
            tombstone += 1;
          }
          liveIdFor.set(e.id, uniquePhysicalId(db, 'entities', `${e.id}@e${epoch}`));
        }
        for (const e of entities) {
          if (!rewrite.has(e.id)) continue;
          const parent = parentOf.get(e.id);
          insertEntity(db, e, liveIdFor.get(e.id), epoch, hasFts, parent ? (liveIdFor.get(parent) ?? null) : null);
          // The row keeps its last PageRank until the graph_pagerank job recomputes it:
          // at 0, trace ranked every edited definition last.
          const oldRank = oldByLogical.get(e.id)?.page_rank;
          if (oldRank > 0) prepareCached(db, 'UPDATE entities SET page_rank = ? WHERE id = ?').run(oldRank, liveIdFor.get(e.id));
          upsert += 1;
        }
        insertRelationships(db, relationships, liveIdFor, epoch);
        insertCallSites(db, callSites, { epoch, idFor: liveIdFor });
        // Resolve this write's edges (and edges into its definitions) with
        // the full build's rules — otherwise maintained files keep
        // target-less edges that readers can only match by name.
        // Every name whose set of definitions changed in this write: names of
        // definitions that disappeared or appeared (by logical id). A removed
        // `Alpha.run` leaves one `run` (a full build now binds `x.run()` to
        // it); a second `run` makes a bound call ambiguous again. A definition
        // that only moved or changed keeps its logical id and changes no
        // candidate set; edges into its old row are re-resolved through
        // `retiredIds`.
        const changedNames = new Set();
        for (const r of oldRows) {
          if (r.name && r.type !== 'file' && !nextLogical.has(r.logical_entity_id || r.id)) changedNames.add(r.name);
        }
        for (const e of entities) {
          if (e.type !== 'file' && e.name && !oldByLogical.has(e.id)) changedNames.add(e.name);
        }
        const newNames = [...changedNames];
        // The file's own edges (imports, top-level calls) have the file node
        // as their source, which is in no liveIdFor entry: list it too, or
        // they stay target-less while a full build resolves them.
        edgeResolution = resolveTouchedEdges(db, {
          epoch,
          sourceIds: [...liveIdFor.values(), fileLogicalId],
          retiredIds,
          newNames,
        }, resolveRowsScoped);
        // Override edges follow the resolved extends/implements rows above.
        // The batched tick derives them once at finalize (one tick-wide pass
        // over the live graph); a per-file connection derives them here.
        if (ctx?.graphDb) ctx.overridesEpoch = epoch;
        else overrideStats = deriveOverridesSafely(db, epoch, this.logger);
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
          for (const table of ['entities_fts', 'entities_code_fts', 'entities_trigram']) try { fts5Merge(db, table, pages); } catch {}
        }
      }
      this.touched.set(rel, { ...(this.touched.get(rel) || {}), graphEntities: entities.length, graphEdgeResolution: edgeResolution, graphOverrides: overrideStats });
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
        const tokenOps = [...retired];
        this._releaseDedupAliases(db, summary.retiredRows.map((r) => r.oldId), tokenOps, ctx);
        this.touched.set(rel, { ...(this.touched.get(rel) || {}), hash: hashes, chunkIds: [] });
        // A retired file the grep corpus still holds keeps its sparse-gram content.
        const keep = hashes.grepKeep;
        if (keep) this._grepTouched.set(rel, { hash: keep.contentHash, stat: keep.stat });
        return { ops: { vectors_delete: summary.retiredRows.length }, vectorOps: retired, tokenOps, gramOps: keep ? keep.gramOps : [{ file: rel, deleted: true }] };
      }
      const parsed = await new ASTChunker({ projectRoot: this.projectRoot }).parseFile(rel, hashes.content);
      this.progress('production:vector-parsed');
      chunks = await enrichChunksFromGraph(parsed.map((chunk, i) => ({ ...chunk, file: rel, id: `${rel}:${chunk.metadata?.line_start || 0}-${chunk.metadata?.line_end || chunk.metadata?.line_start || 0}:${i}` })), this.stateDir, ctx);
      this.progress('production:vector-enriched');
      // LI generated-content parity: decide ONCE, from the file's full chunk set
      // (exactly like full indexing's per-file applyIndexingChunkPolicy), whether
      // late interaction skips this file. Embeddings/graph/sparse still index it.
      // Stored per-file so applyLIDelta drops adds even when only a non-first
      // chunk changed and the @generated first chunk was hash-reused.
      const liKept = applyIndexingChunkPolicy(chunks, { projectRoot: this.projectRoot }).kept;
      const liSkip = chunks.length > 0 && liKept.length === 0;
      if (liSkip) this._liSkipFiles.add(rel);
      else this._liSkipFiles.delete(rel);
      const liSkipBefore = (this._merkleRead() ?? { files: {} }).files?.[rel]?.liSkip === true;
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
      this._releaseDedupAliases(db, retiredRows.map((row) => row.oldId), tokenOps, ctx);
      // A row version has the same LI input as its old row: copy the stored LI doc
      // (the delta encodes it only when the old doc is gone).
      for (const row of summary.versionedRows) {
        const reused = delta.toReuse.find((item) => item.ann?.chunkStructId === row.chunkStructId);
        if (reused?.chunk) tokenOps.push({ addId: row.newId, chunk: reused.chunk, copyFromId: row.oldId });
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
          // `snap` predates applyDiff: a row this tick retired still reads as live there.
          // Re-adding it put the old chunk back into LI, and the search could return it.
          const dbRow = db.prepare('SELECT id, embedding, metadata FROM vectors WHERE id = ? AND epoch_retired IS NULL').get(row.id);
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
      // The LI verdict flipped (a file became @generated, or stopped being): the chunks
      // reused unchanged emit no LI op, so retire their docs (now skipped) or add them
      // (no longer skipped), as a full build would have.
      if (liSkip !== liSkipBefore) {
        for (const item of delta.toReuse) {
          if (item.metadataOnly || item.textOnly) continue;
          tokenOps.push({ retireId: item.prevRow.id, file: rel });
          if (!liSkip) tokenOps.push({ addId: item.prevRow.id, chunk: item.chunk });
        }
      }
      this.touched.set(rel, { ...(this.touched.get(rel) || {}), hash: hashes, chunkIds: recordedChunkIds, content: hashes.content, liSkip });
      if (ctx) ctx.persistedFiles.add(rel);
      return {
        ops: { vectors_upsert: newIds.length, vectors_delete: vectorOps.filter((o) => o.retireId).length },
        chunksTotal: chunks.length,
        chunksEncoded: encodedChunks.length,
        chunksReused: delta.toReuse.length,
        chunksMetadataDirty: delta.counters.metadata_dirty,
        vectorOps,
        tokenOps,
        gramOps: [{ file: rel, deleted: false, content: hashes.content, contentHash: hashes.contentHash, symbolMask: fileSymbolMask(db, rel) }],
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
    // Step 2a: the batched path is selected by the PRESENCE of a tick context,
    // not by an already-loaded index — `ctx.index` is now lazy and is null until
    // the first file with vector ops asks for it. Keying the branch on
    // `ctx.index` would have silently rerouted every tick to the per-file path
    // (per-file HNSW saves, no persist-before-advance).
    if (ctx && (ctx.ensureStores || ctx.index)) {
      if (!ctx.index && ctx.ensureStores) await ctx.ensureStores();
      const index = ctx.index;
      let append = 0; let tombstone = 0;
      // One bitmap load + one save+fsync per file's ops instead of per
      // retired id; marks apply in op order with identical semantics.
      // One batch for the tick, written in finalizeTick after the index save and the
      // COMMIT. A per-file flush hid the old chunk from vector search before its
      // replacement was saved, and after an aborted tick the marks outlived the rolled
      // back rows (a file reverted meanwhile then stayed hidden).
      const staleBatch = (ctx.staleBatch ??= createStaleBatch(index));
      for (const op of ops) {
        if (op.retireId) {
          if (staleBatch.markStale(op.retireId)) tombstone += 1;
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
    // One bitmap load + one save+fsync for the whole op list instead of per
    // retired id. Marks still apply inline in op order (adds never consult
    // the bitmap), so retire-then-readd sequences behave exactly as before.
    const staleBatch = createStaleBatch(index);
    for (const op of ops) {
      if (op.retireId) {
        if (staleBatch.markStale(op.retireId)) tombstone += 1;
        floatRemoveIds.push(op.retireId);
      }
      if (op.addId && op.embedding) {
        const truncated = truncateForHNSW(op.embedding, this.modelInfo.hnswDimension);
        await index.add(op.addId, floatToBinary(truncated), op.metadata || {}, normalizedFloatToInt8(truncated), op.embedding);
        floatUpserts.push({ id: op.addId, vector: truncated });
        append += 1;
      }
      if ((append + tombstone) > 0 && (append + tombstone) % 100 === 0) this.progress('production:binary-hnsw-loop');
    }
    staleBatch.flush();
    await index.save(indexPath);
    this.progress('production:binary-hnsw-saved');
    await maintainFloatStore(indexPath, { upserts: floatUpserts, removeIds: floatRemoveIds, binaryVectorsBefore, dimension: this.modelInfo.hnswDimension });
    this.progress('production:float-store-maintained');
    return { ops: { binary_hnsw_append: append, binary_hnsw_tombstone: tombstone }, manifest: { path: 'codebase-binary-hnsw.idx' } };
  }

  async applyLIDelta(file, ops, ctx = null) {
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
    // E.1-LI: tick-scoped READER cache. The per-file delta previously paid a
    // full loadExisting init (segment manifest + doc positions over a multi-
    // hundred-MB index) once per file; within one tick the reader view it
    // needs is stable (per-file ops only reference the file's own pre-tick
    // docs, appendGrowingSegment re-reads the manifest from disk, and segment
    // compaction only runs in maintenance after the tick). Null ctx (per-file
    // path) ⇒ fresh load per file, exactly as before.
    const readerCache = ctx ? (ctx._liReaderCache ??= { key: null, index: null }) : null;
    const { appended, tombstone } = await applyLateInteractionDelta({
      indexPath: path.join(this.stateDir, 'codebase-late-interaction.db'),
      ops: filteredOps,
      liEncoder: this.liEncoder,
      pickLiInput,
      onProgress: () => this.progress('production:li-delta'),
      readerCache,
      deferredTombstones: ctx ? (ctx.liTombstones ??= []) : null,
      deferredAppend: ctx ? (ctx.liAppend ??= { writer: null }) : null,
    });
    return { ops: { li_segment_append: appended, li_tombstone: tombstone }, manifest: { path: 'codebase-late-interaction.db', segments: 'codebase-late-interaction.db.segments/manifest.json' } };
  }

  /**
   * Dedup aliases (full build): an alias row carries its exemplar's embedding, has no
   * chunk FTS row and no LI doc (an LI pointer stands in). When the tick retires rows:
   *   - a retired alias drops its LI pointer;
   *   - each live alias of a retired exemplar becomes an ordinary row: exemplarId cleared,
   *     its chunk FTS row written, the exemplar's LI doc copied under its id, its pointer
   *     dropped. Before, those aliases lost chunk BM25 and LI for good.
   * Pointers are dropped after the COMMIT (finalizeTick); without a tick, at once.
   */
  _releaseDedupAliases(db, retiredIds, tokenOps, ctx) {
    if (retiredIds.length === 0) return;
    const drops = ctx ? (ctx.aliasDrops ??= new Set()) : new Set();
    for (let i = 0; i < retiredIds.length; i += 500) {
      const ids = retiredIds.slice(i, i + 500);
      const marks = ids.map(() => '?').join(',');
      for (const row of db.prepare(`SELECT id FROM vectors WHERE id IN (${marks}) AND json_extract(metadata, '$.exemplarId') IS NOT NULL`).all(...ids)) {
        drops.add(row.id);
      }
      const orphans = db.prepare(`SELECT rowid, id, text, metadata FROM vectors
        WHERE json_extract(metadata, '$.exemplarId') IS NOT NULL AND json_extract(metadata, '$.exemplarId') IN (${marks})
          AND epoch_retired IS NULL`).all(...ids);
      if (orphans.length === 0) continue;
      const writeFts = chunkTextFtsWriter(db);
      const update = db.prepare('UPDATE vectors SET metadata = ? WHERE rowid = ?');
      for (const row of orphans) {
        const meta = JSON.parse(row.metadata || '{}');
        const exemplarId = meta.exemplarId;
        meta.exemplarId = null;
        meta.isExemplar = true;
        update.run(JSON.stringify(meta), row.rowid);
        writeFts?.(row.rowid, row.text || '', meta);
        tokenOps.push({ addId: row.id, copyFromId: exemplarId });
        drops.add(row.id);
      }
    }
    if (!ctx && drops.size > 0) dropAliasPointersSync(path.join(this.stateDir, 'codebase-late-interaction.db'), drops);
  }

  /** Write the tick's LI tombstones (collected by applyLIDelta), after the COMMIT. */
  async _persistLiTombstones(ctx) {
    const marks = ctx?.liTombstones;
    if (!marks || marks.length === 0) return;
    const states = new Map();
    for (const { segmentPath, docIndex, docCount } of marks) {
      if (!states.has(segmentPath)) states.set(segmentPath, openSegmentState(segmentPath, docCount));
      tombstoneDoc(states.get(segmentPath), docIndex);
    }
    for (const state of states.values()) persistSegmentState(state);
    ctx.liTombstones = [];
  }

  /**
   * Highest SUCCESSFULLY-published merkle epoch (the per-file crash-recovery
   * advance authority — see the torn-row repair in `applyVectorDelta`). Returns
   * 0 when no tick has published yet, so any row a tick committed counts as
   * un-advanced. Best-effort + read-only.
   * @returns {number}
   */
  _publishedEpoch() {
    const merkle = this._merkleRead() ?? {};
    // A full build writes its rows at epoch 0 and no merkle epoch; a tick writes at epoch 1 or
    // later. So rows at epoch 0 are never torn, and the first tick after a build does not
    // re-encode every reused chunk of the files it touches.
    return Number.isInteger(merkle?.epoch) ? merkle.epoch : 0;
  }

  applySparseGramDelta(_file, ops, epoch) {
    if (!Array.isArray(ops) || ops.length === 0) return { ops: { sparse_gram_delta_upsert: 0 } };
    const base = path.join(this.stateDir, 'codebase-sparse-grams.idx');
    const extractor = this._sparseExtractor(base);
    let count = 0;
    for (const op of ops) {
      const record = op.deleted ? { weightsId: extractor.weightsId, grams: [] } : sparseGramRecord(extractor, op.content);
      if (!record) continue; // no native addon: no reader could use the record
      // No fsync per record: persistManifest syncs the touched segments once, before the
      // manifest that lists them is published.
      this._unsyncedDeltaSegments.add(appendDeltaRecord(base, epoch, {
        fileId: fileIdFor(op.file),
        filePath: op.file,
        contentHash: op.contentHash || '',
        deleted: !!op.deleted,
        symbolMask: op.symbolMask || 0,
        weightsId: record.weightsId,
        grams: record.grams,
      }, { sync: false }));
      count += 1;
      if (count % 100 === 0) this.progress('production:sparse-loop');
    }
    this.progress('production:sparse-done');
    return { ops: { sparse_gram_delta_upsert: count }, manifest: { base: 'codebase-sparse-grams.idx', deltas: listDeltaSegments(base, { maxEpoch: epoch }).map((s) => relativeArtifact(this.stateDir, s.path)), weightsId: extractor.weightsId } };
  }

  /**
   * The loaded sparse-gram base and its weights id, kept while the base file is unchanged:
   * the native load parses every gram (5-8 ms per load on a 140k-gram base), and each
   * record and weights lookup loaded it again.
   */
  _sparseExtractor(base) {
    const identity = fileIdentity(base);
    if (this._sparseBase && this._sparseBase.identity === identity) return this._sparseBase;
    const index = identity ? loadSparseGramIndex(base) : null;
    const weightsId = (index ? extractSparseGramDeltaRecord({ index, content: '' })?.weightsId : null)
      || readManifest(this.stateDir)?.sparseGram?.weightsId || FALLBACK_WEIGHTS_ID;
    this._sparseBase = { identity, index, weightsId };
    return this._sparseBase;
  }

  readMaintenanceState() {
    return readMaintenanceStateFromArtifacts(this.stateDir);
  }

  /**
   * Record this tick's grep-only files (their sparse-gram records are already appended) in
   * grep-corpus-state.json; a file the embedding tiers now index leaves it.
   */
  _persistGrepCorpusState() {
    const state = readGrepCorpusState(this.stateDir);
    let changed = false;
    for (const [file, entry] of this._grepTouched) {
      if (entry) state.files[file] = { size: entry.stat.size, mtime_ns: entry.stat.mtime_ns, hash: entry.hash };
      else delete state.files[file];
      changed = true;
    }
    for (const file of this.touched.keys()) {
      if (state.files[file] && !this._grepTouched.has(file)) { delete state.files[file]; changed = true; }
    }
    if (changed) writeGrepCorpusState(this.stateDir, state);
  }

  persistManifest(manifest) {
    syncDeltaSegments([...this._unsyncedDeltaSegments]);
    this._unsyncedDeltaSegments.clear();
    writeManifest(this.stateDir, manifest);
    const merklePath = path.join(this.stateDir, MERKLE_STATE);
    // The adapter's cached parse (invalidated below): a second parse of the whole file
    // cost 121 ms at 100k files.
    const merkle = this._merkleRead() ?? { version: '2.4', files: {}, stats: {} };
    this._merkleCache = undefined;
    merkle.files ||= {};
    // E.1 PERSIST-BEFORE-ADVANCE: when batching, promote a file into the merkle
    // ONLY if its ops are in the persisted batch (recorded in finalizeTick). A
    // file touched this tick but absent from the persisted set (e.g. its HNSW
    // adds did not make the saved batch) is left at its prior merkle state and
    // re-reconciled next tick. Deletions always apply (no HNSW add to persist).
    const persisted = this._lastPersistedFiles;
    const gate = batchTierWritesEnabled() && persisted instanceof Set;
    const failures = this._readFailures();
    let failuresChanged = false;
    for (const [file, data] of this.touched.entries()) {
      if (failures[file]) { delete failures[file]; failuresChanged = true; }
      if (data.hash?.deleted) delete merkle.files[file];
      else if (!gate || persisted.has(file)) {
        merkle.files[file] = { hash: data.hash.contentHash, ...data.hash.stat, epoch: manifest.epoch, chunkIds: data.chunkIds || [] };
        if (data.liSkip) merkle.files[file].liSkip = true;
      }
    }
    // Same content, new stat: keep hash, chunk ids and epoch; record the stat so
    // the dirty scan stops requeueing the file. No tier holds stat data, so
    // this needs no persisted-batch gate.
    for (const [file, { hash, stat }] of this._statRefresh) {
      const prev = merkle.files[file];
      if (prev && prev.hash === hash && !this.touched.has(file)) merkle.files[file] = { ...prev, ...stat };
    }
    if (failuresChanged) safeWriteJson(path.join(this.stateDir, FILE_FAILURES), failures);
    this._persistGrepCorpusState();
    merkle.lastIndex = new Date().toISOString();
    merkle.epoch = manifest.epoch;
    merkle.stats = { ...(merkle.stats || {}), totalFiles: Object.keys(merkle.files).length };
    // Compact: pretty-printing doubled the bytes and the stringify time (55 MB at 100k files).
    safeWriteJson(merklePath, merkle, { compact: true });
    try { fs.unlinkSync(path.join(this.stateDir, PROCESSING_QUEUE)); } catch {}
    const metricsPath = path.join(this.stateDir, METRICS_FILE);
    try {
      if (fs.statSync(metricsPath).size > METRICS_ROTATE_BYTES) fs.renameSync(metricsPath, `${metricsPath}.1`);
    } catch { /* no file yet */ }
    fs.appendFileSync(metricsPath, JSON.stringify({ ...manifest, ts: Date.now() / 1000, epoch: manifest.epoch }) + '\n');
  }
}

export const __testing = {
  ProductionReconcileAdapter,
  METRICS_ROTATE_BYTES,
  sparseGramRecord,
  markBinaryStale,
  normalizeHnswDeterminismFlags,
  // Reset the one-time forced-on warning latch so each test case observes the
  // warning independently.
  _resetDetLevelsWarnLatch() { _batchForcedDetLevelsWarned = false; },
};
