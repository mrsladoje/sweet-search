/**
 * Canonical, epoch/timestamp-stripped dumpers for the five index-maintainer
 * artifacts + the merkle state. (Plan G0 / RESEARCH §1.1 verification plan.)
 *
 * The goal: turn each on-disk artifact into a deterministic, order-stable JSON
 * value such that two semantically-identical indexes produce byte-identical
 * dumps, and any *semantic* difference (a different vector, a missing graph
 * row, a different HNSW level) surfaces as a structured diff via `byteDiff`.
 *
 * What is stripped (intentionally NOT compared):
 *   - wall-clock timestamps (`savedAt`, `lastIndex`, `ts`, `queued_at`)
 *   - the monotonic epoch counter and any `epoch`-suffixed physical id
 *     (mapped to a stable `@e#` token so two runs with the same number of
 *     ticks compare equal regardless of absolute epoch value)
 *   - filesystem-specific stat fields (`mtime_ns`, `inode`)
 *
 * Everything else (content hashes, embeddings, int8 quantization, HNSW graph
 * structure, LI token shapes, sparse grams, row visibility windows) is kept,
 * because those are exactly what a correctness-affecting change would perturb.
 *
 * This module performs READ-ONLY I/O against a finished state dir. It opens
 * SQLite read-only and never mutates the index.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FloatVectorStore } from '../../core/vector-store/float-vector-store.js';
import { resolveLatestRecords, listDeltaSegments } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';

/**
 * Columns whose values are wall-clock timestamps written by the storage layer
 * (e.g. `vectors.created_at DEFAULT CURRENT_TIMESTAMP`), NOT part of the search
 * contract. The plan dumps "modulo timestamp", so these are excluded from the
 * canonical row. `stale_since`/`epoch_*` are deliberately NOT here: they hold
 * the monotonic epoch counter (deterministic across identical runs) and are
 * already epoch-normalized by the diff path when needed.
 */
const STRIPPED_TIMESTAMP_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'indexed_at',
  'last_seen_at',
  'last_accessed_at',
  'saved_at',
]);

// --- artifact file names (mirrors production-reconciler.mjs) ---
const ARTIFACTS = Object.freeze({
  codebaseDb: 'codebase.db',
  codeGraphDb: 'code-graph.db',
  binaryHnswIdx: 'codebase-binary-hnsw.idx',
  floatVectors: 'codebase-float-vectors.bin',
  liDb: 'codebase-late-interaction.db',
  sparseBase: 'codebase-sparse-grams.idx',
  merkle: 'merkle-state.json',
});

// ---------------------------------------------------------------------------
// Generic canonicalizers
// ---------------------------------------------------------------------------

/**
 * Replace an embedded epoch counter inside a physical id so two runs with the
 * same tick count compare equal. The reconciler mints ids like
 * `src/a.js:1-4:0@e2.0` and `name@e3`. We normalize the `@e<digits>` token to
 * `@e#` so absolute epoch values are not compared, while the *structure*
 * (which chunk, which version slot) is preserved.
 */
function stripEpochToken(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/@e\d+/g, '@e#');
}

/** Recursively sort object keys so JSON serialization is order-stable. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/** Stable JSON.stringify with deep-sorted keys (no whitespace). */
export function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

// ---------------------------------------------------------------------------
// SQLite dumpers (ORDER BY rowid; epoch-stripped ids)
// ---------------------------------------------------------------------------

function openReadonly(dbPath) {
  // readonly + no WAL writes; tolerate a missing file by returning null.
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function listUserTables(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);
}

/**
 * Epoch columns hold the monotonic tick counter. Two runs with the same number
 * of TICKS produce the same absolute epochs, so the strict byte-diff compares
 * them as-is. A CRASH that burns/retries a tick shifts the absolute counter
 * while preserving the row-visibility STRUCTURE (which row was written/retired
 * before/after which) — so the crash-consistency path passes
 * `normalizeEpochs:true`, which dense-ranks each distinct epoch value to a
 * 0-based rank (NULL stays NULL). This compares the MVCC visibility ordering
 * "modulo epoch" exactly as the plan specifies.
 */
const EPOCH_COLUMNS = new Set(['epoch_written', 'epoch_retired', 'epoch', 'stale_since']);

/**
 * Dump every user table in a SQLite DB, row-by-row, ORDER BY rowid, with each
 * cell canonicalized: epoch tokens stripped from string ids, BLOBs rendered as
 * lowercase hex (so embeddings/int8 payloads compare byte-exactly), and FTS5
 * shadow tables skipped (they are a derived function of the base table and
 * their internal segment layout is non-deterministic across merge schedules —
 * exactly the E.5 lever this harness must tolerate).
 *
 * @param {string} dbPath
 * @param {{normalizeEpochs?:boolean, liveOnly?:boolean}} [opts]
 *   `liveOnly` drops MVCC-retired rows (non-null `epoch_retired`), comparing
 *   only the queryable index — used by the crash path to distinguish a real
 *   live-state divergence from a harmless extra retired row left by a per-file
 *   crash + re-reconcile (the persist-before-advance concern owned by G2).
 * @returns {object|null} { [tableName]: row[] } or null when the DB is absent.
 */
export function dumpSqliteDb(dbPath, opts = {}) {
  const normalizeEpochs = !!opts.normalizeEpochs;
  const liveOnly = !!opts.liveOnly;
  const db = openReadonly(dbPath);
  if (!db) return null;
  try {
    const out = {};
    const epochRank = normalizeEpochs ? buildEpochRank(db) : null;
    for (const table of listUserTables(db)) {
      if (isDerivedFtsTable(db, table)) continue;
      const cols = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => c.name);
      // Use rowid for stable ordering. Some tables (WITHOUT ROWID / FTS) lack
      // an addressable rowid; fall back to a deterministic column ordering.
      const orderClause = hasRowid(db, table)
        ? 'ORDER BY rowid'
        : `ORDER BY ${cols.map(quoteIdent).join(', ')}`;
      const whereClause = liveOnly && cols.includes('epoch_retired')
        ? 'WHERE epoch_retired IS NULL'
        : '';
      const rows = db.prepare(`SELECT * FROM ${quoteIdent(table)} ${whereClause} ${orderClause}`).all();
      out[table] = rows.map((row) => canonicalizeRow(row, epochRank));
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * Collect every distinct non-null epoch value across all epoch columns in all
 * tables, then map them to a dense 0-based rank in ascending order. Returns a
 * Map<number,number> (epoch value → rank).
 */
function buildEpochRank(db) {
  const values = new Set();
  for (const table of listUserTables(db)) {
    if (isDerivedFtsTable(db, table)) continue;
    const cols = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => c.name);
    for (const col of cols) {
      if (!EPOCH_COLUMNS.has(col)) continue;
      const rows = db
        .prepare(`SELECT DISTINCT ${quoteIdent(col)} AS v FROM ${quoteIdent(table)} WHERE ${quoteIdent(col)} IS NOT NULL`)
        .all();
      for (const r of rows) if (typeof r.v === 'number') values.add(r.v);
    }
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = new Map();
  sorted.forEach((v, i) => rank.set(v, i));
  return rank;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function hasRowid(db, table) {
  // A table is WITHOUT ROWID iff selecting rowid throws; probe cheaply.
  try {
    db.prepare(`SELECT rowid FROM ${quoteIdent(table)} LIMIT 0`).all();
    return true;
  } catch {
    return false;
  }
}

/**
 * FTS5 virtual tables expose several shadow tables (`_data`, `_idx`,
 * `_content`, `_docsize`, `_config`). Their on-disk segment layout depends on
 * the merge schedule (the E.5 lever) and is NOT part of the query contract, so
 * the harness excludes them — comparing them would flag a false positive on
 * the very optimization the doc says is output-identical. The base content is
 * still compared via the non-FTS `entities`/`relationships`/`vectors` tables.
 */
function isDerivedFtsTable(db, table) {
  // Heuristic: an FTS5 contentless/external table's shadow tables share the
  // virtual table name as a prefix and end in a known suffix. Also treat any
  // table created by an fts5 module as derived.
  if (/_(data|idx|content|docsize|config)$/.test(table)) {
    // Confirm a sibling virtual table exists so we don't drop a legitimately
    // named user table.
    const base = table.replace(/_(data|idx|content|docsize|config)$/, '');
    const vt = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = ? AND type='table'`)
      .get(base);
    if (vt && /\bfts5\b|\btrigram\b/i.test(String(vt.sql || ''))) return true;
  }
  const self = db
    .prepare(`SELECT sql FROM sqlite_master WHERE name = ? AND type='table'`)
    .get(table);
  if (self && /USING\s+fts5/i.test(String(self.sql || ''))) return true;
  return false;
}

function canonicalizeRow(row, epochRank = null) {
  const out = {};
  for (const key of Object.keys(row).sort()) {
    if (STRIPPED_TIMESTAMP_COLUMNS.has(key)) continue; // wall-clock; not compared
    if (epochRank && EPOCH_COLUMNS.has(key)) {
      out[key] = typeof row[key] === 'number' ? (epochRank.get(row[key]) ?? row[key]) : null;
      continue;
    }
    out[key] = canonicalizeCell(key, row[key]);
  }
  return out;
}

function canonicalizeCell(key, value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return { __blob_hex: value.toString('hex') };
  if (typeof value === 'string') {
    // `metadata` is a JSON column; canonicalize its keys too and strip epoch
    // tokens that the reconciler embeds in chunk ids.
    if (key === 'metadata') {
      try {
        return { __json: sortKeysDeep(stripEpochDeep(JSON.parse(value))) };
      } catch {
        return stripEpochToken(value);
      }
    }
    return stripEpochToken(value);
  }
  return value;
}

function stripEpochDeep(value) {
  if (Array.isArray(value)) return value.map(stripEpochDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = stripEpochDeep(value[k]);
    return out;
  }
  return stripEpochToken(value);
}

// ---------------------------------------------------------------------------
// Binary HNSW dumper (JSON sidecars, sorted by id; graph re-keyed to ids)
// ---------------------------------------------------------------------------

function readJsonIfExists(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Dump the binary HNSW sidecars canonically. The save format is:
 *   - .meta.json     descriptor (savedAt timestamp stripped)
 *   - .vectors.json  [{ id, binary:[...], metadata }] in INSERTION order
 *   - .graph.json    [level][idx] -> [neighborIdx...]  (positional!)
 *   - .int8.json     { id: [int8...] }
 *   - .calibration.json (optional asymmetric centroid/sign)
 *
 * The `.vectors.json` array order and the `.graph.json` positional indices are
 * the load-bearing determinism signal: per-file vs batched insertion can yield
 * a different node order AND different levels (the G1 prerequisite). To make
 * the dump comparable while preserving the graph *structure*, we:
 *   1. sort vectors by id,
 *   2. re-express the graph adjacency in terms of vector *ids* (not positional
 *      idx), then sort each neighbor list, then sort the per-level adjacency by
 *      source id.
 * This means a graph that is structurally identical up to node relabeling
 * compares equal, while a genuinely different neighbor set differs.
 */
export function dumpBinaryHnsw(stateDir) {
  const idxPath = path.join(stateDir, ARTIFACTS.binaryHnswIdx);
  const metaPath = idxPath.replace('.idx', '.meta.json');
  if (!fs.existsSync(metaPath)) return null;

  const meta = readJsonIfExists(metaPath) || {};
  const vectors = readJsonIfExists(idxPath.replace('.idx', '.vectors.json')) || [];
  const graph = readJsonIfExists(idxPath.replace('.idx', '.graph.json')) || [];
  const int8 = readJsonIfExists(idxPath.replace('.idx', '.int8.json')) || {};
  const calibration = readJsonIfExists(idxPath.replace('.idx', '.calibration.json'));

  // idx -> id (positional). Empty slots (retired/never-filled) map to null.
  const idForIdx = vectors.map((v) => (v && v.id != null ? stripEpochToken(v.id) : null));

  const vectorsCanonical = vectors
    .map((v) => ({
      id: stripEpochToken(v.id),
      binary: Array.isArray(v.binary) ? v.binary.slice() : v.binary,
      metadata: sortKeysDeep(stripEpochDeep(v.metadata ?? {})),
    }))
    .sort((a, b) => cmpStr(a.id, b.id));

  // Re-express graph adjacency by id, per level, sorted.
  const graphByLevel = [];
  for (let level = 0; level < graph.length; level += 1) {
    const adjacency = graph[level] || [];
    const perSource = [];
    for (let idx = 0; idx < adjacency.length; idx += 1) {
      const neighbors = adjacency[idx];
      if (!Array.isArray(neighbors) || neighbors.length === 0) continue;
      const srcId = idForIdx[idx];
      if (srcId == null) continue;
      const neighborIds = neighbors
        .map((nIdx) => idForIdx[nIdx])
        .filter((x) => x != null)
        .sort(cmpStr);
      perSource.push({ source: srcId, neighbors: neighborIds });
    }
    perSource.sort((a, b) => cmpStr(a.source, b.source));
    graphByLevel.push(perSource);
  }

  const int8Canonical = {};
  for (const id of Object.keys(int8).sort(cmpStr)) {
    int8Canonical[stripEpochToken(id)] = int8[id];
  }

  return {
    meta: {
      dimension: meta.dimension ?? null,
      floatDimension: meta.floatDimension ?? null,
      M: meta.M ?? null,
      efConstruction: meta.efConstruction ?? null,
      efSearch: meta.efSearch ?? null,
      maxElements: meta.maxElements ?? null,
      vectorCount: meta.vectorCount ?? null,
      maxLevel: meta.maxLevel ?? null,
      // entryPoint is a positional idx → translate to id so it survives a
      // node-order change; absolute idx would falsely diff under reordering.
      entryPointId:
        typeof meta.entryPoint === 'number' ? (idForIdx[meta.entryPoint] ?? null) : null,
      useAsymmetric: meta.useAsymmetric ?? null,
      pipelineVersion: meta.pipelineVersion ?? null,
      // savedAt intentionally omitted (wall-clock).
    },
    vectors: vectorsCanonical,
    graphByLevel,
    int8: int8Canonical,
    calibration: calibration ? sortKeysDeep(calibration) : null,
  };
}

function cmpStr(a, b) {
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Float vector store dumper (header + per-id arrays sorted by id)
// ---------------------------------------------------------------------------

export async function dumpFloatVectors(stateDir) {
  const binPath = path.join(stateDir, ARTIFACTS.floatVectors);
  if (!fs.existsSync(binPath)) return null;
  const store = new FloatVectorStore();
  const loaded = await store.load(binPath);
  if (!loaded) return { loaded: false };
  const ids = [...store.idToIndex.keys()].sort(cmpStr);
  const vectors = ids.map((id) => ({
    id: stripEpochToken(id),
    // Array.from over the returned copy → plain numbers, deterministic JSON.
    vector: Array.from(store.get(id)),
  }));
  return {
    loaded: true,
    dimension: store.dimension,
    count: store.count,
    vectors,
  };
}

// ---------------------------------------------------------------------------
// Late-interaction segments dumper (document ids + token shapes, sorted)
// ---------------------------------------------------------------------------

/**
 * Dump the LI index via its public loader rather than re-parsing the INT4
 * segment binary. We emit, per document id (sorted), the token-matrix shape
 * (numTokens × tokenDim) and a stable fingerprint of the dequantized token
 * values. The raw segment file layout (number of segments, byte offsets) is a
 * function of the segment-merge schedule (the E.5/E.2 levers) and is NOT part
 * of the search contract, so it is deliberately not compared.
 */
export async function dumpLiSegments(stateDir) {
  const indexPath = path.join(stateDir, ARTIFACTS.liDb);
  if (!fs.existsSync(indexPath)) return null;
  let index;
  try {
    index = new LateInteractionIndex({ indexPath, loadExisting: true });
    await index.init();
  } catch {
    return { loadError: true };
  }
  const ids = [...index.documents.keys()].sort(cmpStr);
  const documents = ids.map((id) => {
    const doc = index.documents.get(id) || {};
    const shape = liDocShape(index, id, doc);
    return { id: stripEpochToken(id), ...shape };
  });
  return { count: documents.length, documents };
}

function liDocShape(index, id, doc) {
  // Prefer the public token accessor when available so we compare the values a
  // searcher would actually see (post-dequant), independent of on-disk
  // quantization layout.
  let tokens = null;
  try {
    if (typeof index.getTokens === 'function') tokens = index.getTokens(id);
  } catch {
    tokens = null;
  }
  if (Array.isArray(tokens) && tokens.length > 0) {
    const numTokens = tokens.length;
    const tokenDim = tokens[0]?.length ?? 0;
    return {
      numTokens,
      tokenDim,
      // A coarse, value-stable fingerprint: rounded sum per token. Survives
      // INT4 re-quantization noise yet still flags a wrong/missing document.
      tokenFingerprint: tokens.map((t) => roundSum(t)),
    };
  }
  // Fallback: report whatever shape metadata the doc entry carries
  // (the LI doc entry uses `dim`, not `tokenDim`).
  return {
    numTokens: doc.numTokens ?? null,
    tokenDim: doc.dim ?? doc.tokenDim ?? null,
    tokenFingerprint: null,
  };
}

function roundSum(arr) {
  let s = 0;
  for (const v of arr) s += Number(v) || 0;
  // 4 decimal places: stable across deterministic dequant, tolerant of
  // float formatting jitter.
  return Math.round(s * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Sparse-gram dumper (latest record per fileId, sorted by key)
// ---------------------------------------------------------------------------

/**
 * Dump the sparse-gram delta state. The `.ssgrmdelta` segments are append-only
 * JSON-line files keyed by fileId; the query merge keeps only the LATEST record
 * per fileId. We dump exactly that resolved set, sorted by fileId, with grams
 * sorted, so the number/ordering of physical segments (the compaction lever)
 * does not perturb the dump while the resolved postings still compare exactly.
 */
export function dumpSparseGrams(stateDir) {
  const base = path.join(stateDir, ARTIFACTS.sparseBase);
  const segments = listDeltaSegments(base);
  if (!segments || segments.length === 0) return null;
  const latest = resolveLatestRecords(base);
  const keys = [...latest.keys()].sort(cmpStr);
  const records = keys.map((fileId) => {
    const { record } = latest.get(fileId);
    const grams = Array.isArray(record.grams)
      ? record.grams
          .map((g) => (Array.isArray(g) ? [String(g[0]), g[1]] : g))
          .slice()
          .sort((a, b) => cmpStr(Array.isArray(a) ? a[0] : a, Array.isArray(b) ? b[0] : b))
      : record.grams;
    return {
      fileId,
      filePath: record.filePath ?? null,
      contentHash: record.contentHash ?? null,
      deleted: !!record.deleted,
      symbolMask: record.symbolMask ?? 0,
      weightsId: record.weightsId ?? null,
      grams,
    };
  });
  return { count: records.length, records };
}

// ---------------------------------------------------------------------------
// Merkle state dumper (modulo epoch / timestamp / queued_at / fs stat)
// ---------------------------------------------------------------------------

export function dumpMerkleState(stateDir) {
  const p = path.join(stateDir, ARTIFACTS.merkle);
  const m = readJsonIfExists(p);
  if (!m) return null;
  const files = m.files || {};
  const out = {};
  for (const rel of Object.keys(files).sort(cmpStr)) {
    const entry = files[rel] || {};
    out[rel] = {
      hash: entry.hash ?? null,
      size: entry.size ?? null,
      // chunkIds embed @e<epoch>; strip the epoch token so two runs with the
      // same number of ticks compare equal while the chunk structure is kept.
      chunkIds: Array.isArray(entry.chunkIds)
        ? entry.chunkIds.map(stripEpochToken).slice().sort(cmpStr)
        : [],
      // mtime_ns, inode, epoch intentionally omitted.
    };
  }
  return {
    files: out,
    totalFiles: m.stats?.totalFiles ?? Object.keys(files).length,
    // top-level epoch, lastIndex intentionally omitted.
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Dump all five artifacts + merkle into a single canonical object. Each value
 * is null when the artifact is absent (e.g. an empty repo).
 *
 * @param {string} stateDir  absolute path to the `.sweet-search` state dir
 * @param {{normalizeEpochs?:boolean, liveOnly?:boolean}} [opts]  `normalizeEpochs`
 *   dense-ranks the SQLite epoch columns so a crashed-vs-clean run (which burns
 *   a tick) compares the MVCC visibility ordering "modulo epoch"; `liveOnly`
 *   drops retired rows. Both OFF by default so the Tier-1/Tier-2 flag-on-vs-off
 *   byte-diff stays strict.
 * @returns {Promise<object>}
 */
export async function dumpAllArtifacts(stateDir, opts = {}) {
  const sqliteOpts = { normalizeEpochs: !!opts.normalizeEpochs, liveOnly: !!opts.liveOnly };
  return {
    codebaseDb: dumpSqliteDb(path.join(stateDir, ARTIFACTS.codebaseDb), sqliteOpts),
    codeGraphDb: dumpSqliteDb(path.join(stateDir, ARTIFACTS.codeGraphDb), sqliteOpts),
    binaryHnsw: dumpBinaryHnsw(stateDir),
    floatVectors: await dumpFloatVectors(stateDir),
    liSegments: await dumpLiSegments(stateDir),
    sparseGrams: dumpSparseGrams(stateDir),
    merkle: dumpMerkleState(stateDir),
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Structural diff of two artifact dumps. Returns the FIRST differing artifact
 * and the key path where they diverge, or null when the dumps are identical.
 *
 * Artifacts are compared in a fixed order so the "first difference" is stable.
 *
 * @param {object} a  dump from `dumpAllArtifacts`
 * @param {object} b  dump from `dumpAllArtifacts`
 * @returns {{artifact:string, path:string, a:*, b:*}|null}
 */
export function byteDiff(a, b) {
  const ARTIFACT_ORDER = [
    'codebaseDb',
    'codeGraphDb',
    'binaryHnsw',
    'floatVectors',
    'liSegments',
    'sparseGrams',
    'merkle',
  ];
  for (const artifact of ARTIFACT_ORDER) {
    const diff = deepDiff(a?.[artifact] ?? null, b?.[artifact] ?? null, artifact);
    if (diff) return { artifact, ...diff };
  }
  return null;
}

/**
 * Recursive structural diff returning the first divergent key path. Compares
 * canonicalized JSON at the leaves so number/string/order differences surface.
 */
function deepDiff(a, b, pathStr) {
  if (a === b) return null;
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) return { path: pathStr, a, b };
  if (ta === 'array') {
    if (a.length !== b.length) {
      return { path: `${pathStr}.length`, a: a.length, b: b.length };
    }
    for (let i = 0; i < a.length; i += 1) {
      const d = deepDiff(a[i], b[i], `${pathStr}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (ta === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const d = deepDiff(a[key], b[key], `${pathStr}.${key}`);
      if (d) return d;
    }
    return null;
  }
  // primitives that are !== (NaN, number/string mismatch already covered)
  return { path: pathStr, a, b };
}

function typeOf(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : typeof v;
}

export const ARTIFACT_NAMES = ARTIFACTS;
export const __testing = { stripEpochToken, sortKeysDeep, deepDiff, isDerivedFtsTable, roundSum };
