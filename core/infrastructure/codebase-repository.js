/**
 * Codebase Repository — encapsulates all SQLite access to codebase.db.
 *
 * The search domain calls repository methods instead of running raw SQL.
 * This keeps persistence concerns in the infrastructure layer where they belong.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { applyReadPragmas, assertInClauseSize } from './db-utils.js';
import { readJsonFileCachedIfExists } from './cached-json-file.js';
import { nativeRescoreKernels, scratchArray, scratchFloat64Query } from './native-rescore.js';

function readAdjacentManifest(dbPath) {
  try {
    const manifestPath = path.join(path.dirname(dbPath), 'reconcile-manifest.json');
    const manifest = readJsonFileCachedIfExists(manifestPath);
    return Number.isInteger(manifest?.epoch) ? manifest : null;
  } catch {
    return null;
  }
}

function resolveManifestVectorsPath(dbPath, manifest = readAdjacentManifest(dbPath)) {
  const descriptor = manifest?.vectors?.path || manifest?.vectors?.dbPath;
  if (!descriptor || typeof descriptor !== 'string') return dbPath;
  return path.isAbsolute(descriptor) ? descriptor : path.join(path.dirname(dbPath), descriptor);
}

// Small indexes keep every float embedding resident, so the per-query
// full-vector rescore reads memory instead of a 200-id SQLite IN query. Same
// rows, same bytes, so scores are unchanged. Bounded by vector count;
// SS_FIX_EMBED_CACHE=0 disables it.
const EMBEDDING_CACHE_MAX_VECTORS = Number.parseInt(process.env.SWEET_SEARCH_EMBEDDING_CACHE_MAX_VECTORS || '', 10) || 16384;

export class CodebaseRepository {
  constructor(dbPath, options = {}) {
    this._baseDbPath = dbPath;
    this._explicitManifestEpoch = Number.isInteger(options.manifestEpoch);
    this._manifestEpoch = this._explicitManifestEpoch ? options.manifestEpoch : null;
    const manifest = this._explicitManifestEpoch ? readAdjacentManifest(this._baseDbPath) : null;
    this._dbPath = this._explicitManifestEpoch
      ? resolveManifestVectorsPath(this._baseDbPath, manifest)
      : dbPath;
    this._db = null;
    this._hasEpochVisibility = null;
    this._embeddingCache = null;
    if (!this._explicitManifestEpoch) {
      this._syncAdjacentManifest();
    }
  }

  _syncAdjacentManifest() {
    if (this._explicitManifestEpoch) return false;
    const manifest = readAdjacentManifest(this._baseDbPath);
    const nextEpoch = Number.isInteger(manifest?.epoch) ? manifest.epoch : null;
    const nextDbPath = resolveManifestVectorsPath(this._baseDbPath, manifest);
    const changed = nextEpoch !== this._manifestEpoch || nextDbPath !== this._dbPath;
    this._manifestEpoch = nextEpoch;
    this._dbPath = nextDbPath;
    if (changed) {
      this.close();
    }
    return changed;
  }

  refreshManifestEpoch() {
    this._syncAdjacentManifest();
    return this._manifestEpoch;
  }

  getManifestEpoch() {
    return this._manifestEpoch;
  }

  /** Lazy read-only connection with optimized pragmas. */
  _open() {
    this._syncAdjacentManifest();
    if (!this._db) {
      this._db = new Database(this._dbPath, { readonly: true });
      applyReadPragmas(this._db);
    }
    return this._db;
  }

  _visibility(db) {
    if (this._hasEpochVisibility === null) {
      const cols = db.prepare('PRAGMA table_info(vectors)').all().map((c) => c.name);
      this._hasEpochVisibility = cols.includes('epoch_written') && cols.includes('epoch_retired');
    }
    if (!this._hasEpochVisibility) return { sql: '', params: [] };
    if (this._manifestEpoch !== null) {
      return {
        sql: '(epoch_written IS NULL OR epoch_written <= ?) AND (epoch_retired IS NULL OR epoch_retired > ?)',
        params: [this._manifestEpoch, this._manifestEpoch],
      };
    }
    return { sql: 'epoch_retired IS NULL', params: [] };
  }

  /**
   * Iterate all vectors (for O(N) scan or chunk type map building).
   * Returns rows with: id, embedding (Buffer), text, metadata (string), file_path.
   */
  * iterateVectors() {
    const db = this._open();
    const visibility = this._visibility(db);
    const where = visibility.sql ? ` WHERE ${visibility.sql}` : '';
    yield* db.prepare(`SELECT id, embedding, text, metadata, file_path FROM vectors${where}`)
      .iterate(...visibility.params);
  }

  /**
   * Batch-load float embeddings by ID.
   * @param {string[]} ids
   * @returns {Map<string, Float32Array>}
   */
  getEmbeddingsByIds(ids) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return new Map();
    assertInClauseSize(uniqueIds.length, 'CodebaseRepository.getEmbeddingsByIds');

    const db = this._open();
    return this._embeddingsFor(db, this._residentEmbeddings(db), uniqueIds);
  }

  /** getEmbeddingsByIds after validation: resident map or SQLite. */
  _embeddingsFor(db, cached, uniqueIds) {
    if (cached) {
      const result = new Map();
      for (const id of uniqueIds) {
        const vector = cached.get(id);
        if (vector) result.set(id, vector);
      }
      return result;
    }
    const visibility = this._visibility(db);
    const visibilityClause = visibility.sql ? ` AND ${visibility.sql}` : '';
    // Statements are cached per (connection, id count, visibility clause):
    // compiling a 200-placeholder IN query costs more than running it.
    const stmtKey = `${uniqueIds.length}|${visibilityClause}`;
    if (this._embStmtDb !== db) {
      this._embStmtDb = db;
      this._embStmts = new Map();
    }
    let stmt = this._embStmts.get(stmtKey);
    if (!stmt) {
      const placeholders = uniqueIds.map(() => '?').join(',');
      stmt = db.prepare(`SELECT id, embedding FROM vectors WHERE id IN (${placeholders})${visibilityClause}`);
      if (this._embStmts.size >= 64) this._embStmts.clear();
      this._embStmts.set(stmtKey, stmt);
    }
    const rows = stmt.all(...uniqueIds, ...visibility.params);

    const result = new Map();
    for (const row of rows) {
      if (row.embedding) {
        result.set(
          row.id,
          new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4)
        );
      }
    }
    return result;
  }

  /**
   * All visible embeddings as id → Float32Array when the index is small,
   * else null. Reloaded when the connection, the visibility epoch, or the
   * database contents (PRAGMA data_version: commits by other connections;
   * this connection is read-only) change.
   */
  _residentEmbeddings(db) {
    if (process.env.SS_FIX_EMBED_CACHE === '0') return null;
    const visibility = this._visibility(db);
    if (this._dataVersionStmt?.database !== db) {
      this._dataVersionStmt = db.prepare('PRAGMA data_version').pluck();
    }
    const version = this._dataVersionStmt.get();
    const visKey = `${visibility.sql}|${visibility.params.join(',')}`;
    const c = this._embeddingCache;
    if (c && c.db === db && c.version === version && c.visKey === visKey) return c.map;

    const where = visibility.sql ? ` WHERE ${visibility.sql}` : '';
    const count = db.prepare(`SELECT count(*) AS n FROM vectors${where}`).get(...visibility.params).n;
    let map = null;
    let flat = null;
    if (count <= EMBEDDING_CACHE_MAX_VECTORS) {
      map = new Map();
      // Rows go straight into one contiguous array while they all share one
      // width (the map holds views into it); a row of another width ends
      // that and gets its own copy.
      let data = null;
      let dim = 0;
      let uniform = true;
      const rowOf = new Map();
      for (const row of db.prepare(`SELECT id, embedding FROM vectors${where}`).iterate(...visibility.params)) {
        if (!row.embedding) continue;
        const blob = row.embedding;
        // Aligned whole-float blobs are read in place; anything else takes
        // the copying path (which also throws on a ragged length, as before).
        const src = blob.byteOffset % 4 === 0 && blob.length % 4 === 0
          ? new Float32Array(blob.buffer, blob.byteOffset, blob.length / 4)
          : new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length));
        const len = src.length;
        if (uniform && data === null && len > 0) {
          dim = len;
          data = new Float32Array(count * dim);
        }
        if (uniform && len === dim && len > 0 && !map.has(row.id)) {
          const r = rowOf.size;
          const view = data.subarray(r * dim, (r + 1) * dim);
          view.set(src);
          map.set(row.id, view);
          rowOf.set(row.id, r);
        } else {
          uniform = false;
          // Copy: iterate() may reuse row buffers.
          map.set(row.id, new Float32Array(src));
        }
      }
      if (uniform && data) flat = { data, dim, rowOf };
    }
    this._embeddingCache = { db, version, visKey, map, flat };
    return map;
  }

  /**
   * Full-vector scores for the semantic blend in one repository round trip.
   * From the resident store on the native kernel: { scores, found } —
   * dotProduct(query, embedding) per id (null when missing) and the number
   * of distinct ids found, exactly what getEmbeddingsByIds + dotProducts
   * give. Otherwise (large index, mixed widths, no addon, other query
   * width): { embeddings }, the getEmbeddingsByIds(ids) result.
   * @param {ArrayLike<number>} query
   * @param {Array<string|null>} ids
   * @returns {{ scores: Array<number|null>, found: number } | { embeddings: Map<string, Float32Array> }}
   */
  embeddingDotScores(query, ids) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return { embeddings: new Map() };
    assertInClauseSize(uniqueIds.length, 'CodebaseRepository.getEmbeddingsByIds');
    const db = this._open();
    const cached = this._residentEmbeddings(db);
    const flat = cached ? this._embeddingCache.flat : null;
    const kernels = flat && query && query.length === flat.dim ? nativeRescoreKernels() : null;
    if (!kernels) {
      const viaExtension = !cached && query && query.length > 0
        ? this._extensionDotScores(db, query, ids, uniqueIds)
        : null;
      return viaExtension || { embeddings: this._embeddingsFor(db, cached, uniqueIds) };
    }
    const rows = scratchArray('embRows', Uint32Array, ids.length);
    const slot = new Array(ids.length).fill(-1);
    const found = new Set();
    let m = 0;
    for (let i = 0; i < ids.length; i++) {
      const row = ids[i] ? flat.rowOf.get(ids[i]) : undefined;
      if (row === undefined) continue;
      found.add(ids[i]);
      slot[i] = m;
      rows[m++] = row;
    }
    const dots = scratchArray('embScores', Float64Array, m);
    if (m > 0) kernels.f32DotScores(flat.data, flat.dim, scratchFloat64Query(query), rows.subarray(0, m), dots);
    const scores = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) scores[i] = slot[i] < 0 ? null : dots[slot[i]];
    return { scores, found: found.size };
  }

  /**
   * embeddingDotScores for an index too large to keep resident, in one
   * SQLite round trip: the ss_full_dots aggregate (native addon, loaded as
   * an extension into this connection) scores the visible rows with these
   * ids and returns one blob, instead of one Buffer per row. Same rows as
   * _embeddingsFor, same scores as dotProducts over them. null when the
   * extension is not loaded.
   */
  _extensionDotScores(db, query, ids, uniqueIds) {
    if (!this._fullDotsExtension(db)) return null;
    const visibility = this._visibility(db);
    const key = visibility.sql;
    if (this._fullDotsStmt?.db !== db || this._fullDotsStmt.key !== key) {
      this._fullDotsStmt = {
        db,
        key,
        stmt: db.prepare(
          `SELECT ss_full_dots(?, h.key, v.embedding) FROM json_each(?) h JOIN vectors v ON v.id = h.value${key ? ` WHERE ${key}` : ''}`
        ).pluck(),
      };
    }
    const q = scratchFloat64Query(query);
    const blob = this._fullDotsStmt.stmt.get(Buffer.from(q.buffer, q.byteOffset, q.byteLength), JSON.stringify(uniqueIds), ...visibility.params);
    const triples = blob.byteOffset % 8 === 0
      ? new Float64Array(blob.buffer, blob.byteOffset, blob.length / 8)
      : new Float64Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length));
    // [slot in uniqueIds, flag (0 no embedding, 1 score, 2 empty), score]
    const byId = new Map();
    let found = 0;
    for (let t = 0; t < triples.length; t += 3) {
      if (triples[t + 1] === 0) continue;
      found++;
      byId.set(uniqueIds[triples[t]], triples[t + 1] === 1 ? triples[t + 2] : null);
    }
    const scores = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const v = ids[i] ? byId.get(ids[i]) : undefined;
      scores[i] = v === undefined ? null : v;
    }
    return { scores, found };
  }

  /** Load the ss_full_dots extension into `db` once; false when unavailable. */
  _fullDotsExtension(db) {
    if (this._fullDotsDb === db) return this._fullDotsReady;
    this._fullDotsDb = db;
    this._fullDotsReady = false;
    const kernels = process.env.SS_FIX_SQLITE_DOTS === '0' ? null : nativeRescoreKernels();
    if (kernels?.path && typeof db.loadExtension === 'function') {
      try {
        db.loadExtension(kernels.path, 'sqlite3_ssext_init');
        this._fullDotsReady = true;
      } catch {
        // Old addon without the entry point, or extension loading disabled.
      }
    }
    return this._fullDotsReady;
  }

  /**
   * Batch-load chunk texts by ID.
   * @param {string[]} ids - Vector IDs to look up
   * @returns {Map<string, string>} id → text
   */
  getChunkTexts(ids) {
    if (!ids || ids.length === 0) return new Map();
    try {
      assertInClauseSize(ids.length, 'CodebaseRepository.getChunkTexts');
      const db = this._open();
      const ph = ids.map(() => '?').join(',');
      const visibility = this._visibility(db);
      const visibilityClause = visibility.sql ? ` AND ${visibility.sql}` : '';
      const rows = db.prepare(
        `SELECT id, text FROM vectors WHERE id IN (${ph})${visibilityClause}`
      ).all(...ids, ...visibility.params);
      return new Map(rows.map(r => [r.id, r.text]));
    } catch {
      return new Map();
    }
  }

  /**
   * Chunk location metadata for a set of ids, in the shape the late-interaction
   * index carries per document ({ file, name, type, startLine, endLine }).
   *
   * Why this exists (2026-09-03): the SSLX v3 SEGMENTED late-interaction format
   * stores ids and token slabs only — no per-document metadata — so on every
   * repo large enough to segment (>= one segment of documents) a pattern
   * search resolved its hits to `file: ''` and rendered `:null-null` packs.
   * The chunk table is the durable home of that metadata; this is the lookup.
   *
   * @param {string[]} ids
   * @returns {Map<string, { file: string, name: string|null, type: string|null, startLine: number|null, endLine: number|null }>}
   */
  getChunkMetaByIds(ids) {
    if (!ids || ids.length === 0) return new Map();
    try {
      assertInClauseSize(ids.length, 'CodebaseRepository.getChunkMetaByIds');
      const db = this._open();
      const ph = ids.map(() => '?').join(',');
      const visibility = this._visibility(db);
      const visibilityClause = visibility.sql ? ` AND ${visibility.sql}` : '';
      const rows = db.prepare(
        `SELECT id, file_path, metadata FROM vectors WHERE id IN (${ph})${visibilityClause}`
      ).all(...ids, ...visibility.params);
      const out = new Map();
      for (const row of rows) {
        let meta = {};
        try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch { meta = {}; }
        out.set(row.id, {
          file: row.file_path,
          name: meta.symbol ?? meta.name ?? null,
          type: meta.chunk_type ?? meta.type ?? null,
          startLine: meta.line_start ?? meta.startLine ?? null,
          endLine: meta.line_end ?? meta.endLine ?? null,
        });
      }
      return out;
    } catch {
      return new Map();
    }
  }

  /**
   * Return all chunk metadata rows for a single file_path.
   * Used by sweet-search read / read-semantic for symbol-aware metadata
   * and for in-file candidate enumeration. Returns empty array if the file
   * is not indexed, the DB is missing, or the table doesn't exist yet.
   *
   * @param {string} filePath - Project-relative file path as stored in vectors.file_path
   * @returns {Array<{id, file_path, text, metadata}>}
   */
  getChunksByFilePath(filePath) {
    if (!filePath) return [];
    try {
      const db = this._open();
      const visibility = this._visibility(db);
      const visibilityClause = visibility.sql ? ` AND ${visibility.sql}` : '';
      return db.prepare(
        `SELECT id, file_path, text, metadata FROM vectors WHERE file_path = ?${visibilityClause} ORDER BY id`
      ).all(filePath, ...visibility.params);
    } catch {
      return [];
    }
  }

  /**
   * Full vector scan in an ephemeral connection (no persistent state).
   * Used by the O(N) fallback path — opens, scans, closes immediately.
   * @returns {Array<{id, embedding: Buffer, text: string, metadata: string}>}
   */
  scanAllVectors() {
    this._syncAdjacentManifest();
    const db = new Database(this._dbPath, { readonly: true });
    applyReadPragmas(db);
    try {
      const visibility = this._visibility(db);
      const where = visibility.sql ? ` WHERE ${visibility.sql}` : '';
      return db.prepare(`SELECT id, embedding, text, metadata FROM vectors${where}`)
        .all(...visibility.params);
    } finally {
      db.close();
    }
  }

  /**
   * BM25 over chunk text (`chunk_text_fts`, core/indexing/chunk-text-fts.js).
   * Returns visible, non-alias chunks best first: `score` is -bm25 (higher is
   * better). Returns [] when the table is absent (an index built before it,
   * or with the index turned off) or the expression does not parse.
   *
   * @param {string} matchExpr FTS5 MATCH expression
   * @param {number} limit
   * @param {{ weights?: number[], withText?: boolean, window?: number }} [options]
   *   bm25 column weights (body, subtokens); withText adds the stored chunk
   *   text; window is the first-stage size (at least 4 x limit, default 200)
   * @returns {Array<{ id: string, file_path: string, metadata: string, score: number, text?: string }>}
   */
  searchChunkText(matchExpr, limit, options = {}) {
    if (!matchExpr) return [];
    try {
      const db = this._open();
      if (this._hasChunkTextFts === undefined) {
        this._hasChunkTextFts = !!db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chunk_text_fts'",
        ).get();
      }
      if (!this._hasChunkTextFts) return [];
      const [wBody, wSub] = options.weights || [1.0, 0.5];
      const visibility = this._visibility(db);
      const visibilityClause = visibility.sql
        ? ` AND ${visibility.sql.replace(/epoch_(written|retired)/g, 'v.epoch_$1')}`
        : '';
      // Dedup aliases are not in the HNSW either; they come back through
      // expandAliases next to their exemplar. The writer stores no FTS row
      // for an alias (chunkTextFtsWriter); the filter stays for indexes
      // written before that.
      const filter = `${visibilityClause}
           AND coalesce(json_extract(v.metadata, '$.isExemplar'), 1) != 0`;
      const columns = `v.id AS id, v.file_path AS file_path, v.metadata AS metadata,
               ${options.withText ? 'v.text AS text,' : ''}`;
      // Two stages: rank inside FTS5 first (no vectors join, no metadata
      // parse for each of the possibly tens of thousands of OR matches),
      // then join and filter the best `window` rows. When at least `limit`
      // of them pass the filter they are exactly the best `limit` passing
      // rows (any passing row outside the window scores no higher); when
      // fewer pass, the single-stage query below gives the same answer.
      const window = Math.max(limit * 4, Number.isInteger(options.window) ? options.window : 200);
      const staged = db.prepare(`
        SELECT ${columns} f.score AS score
          FROM (SELECT rowid, -bm25(chunk_text_fts, ?, ?) AS score
                  FROM chunk_text_fts
                 WHERE chunk_text_fts MATCH ?
                 ORDER BY bm25(chunk_text_fts, ?, ?)
                 LIMIT ?) f
          JOIN vectors v ON v.rowid = f.rowid
         WHERE 1 = 1${filter}
         ORDER BY f.score DESC
         LIMIT ?
      `).all(wBody, wSub, matchExpr, wBody, wSub, window, ...visibility.params, limit);
      if (staged.length >= limit) return staged;
      return db.prepare(`
        SELECT ${columns}
               -bm25(chunk_text_fts, ?, ?) AS score
          FROM chunk_text_fts
          JOIN vectors v ON v.rowid = chunk_text_fts.rowid
         WHERE chunk_text_fts MATCH ?${filter}
         ORDER BY bm25(chunk_text_fts, ?, ?)
         LIMIT ?
      `).all(wBody, wSub, matchExpr, ...visibility.params, wBody, wSub, limit);
    } catch {
      return [];
    }
  }

  /**
   * Find alias sibling rows for a set of cluster IDs (dedup re-expansion).
   * Given the set of exemplar clusterIds present in ranked results, returns
   * every row in those clusters EXCEPT the provided excludeIds (typically the
   * exemplars themselves, already in the result list).
   *
   * @param {string[]} clusterIds - Cluster IDs to fetch siblings for.
   * @param {string[]} [excludeIds] - Chunk IDs to omit from results.
   * @returns {Array<{id, file_path, text, metadata}>}
   */
  findSiblingsByClusterIds(clusterIds, excludeIds = []) {
    if (!clusterIds || clusterIds.length === 0) return [];
    const uniqueClusters = [...new Set(clusterIds)];
    const uniqueExclude = [...new Set(excludeIds)];
    assertInClauseSize(uniqueClusters.length, 'CodebaseRepository.findSiblingsByClusterIds.clusters');
    assertInClauseSize(uniqueExclude.length, 'CodebaseRepository.findSiblingsByClusterIds.exclude');
    const db = this._open();

    const clusterPh = uniqueClusters.map(() => '?').join(',');
    const excludePh = uniqueExclude.map(() => '?').join(',');
    const excludeClause = uniqueExclude.length > 0 ? ` AND id NOT IN (${excludePh})` : '';
    const visibility = this._visibility(db);
    const visibilityClause = visibility.sql ? ` AND ${visibility.sql}` : '';

    const sql = `
      SELECT id, file_path, text, metadata
      FROM vectors
      WHERE json_extract(metadata, '$.clusterId') IN (${clusterPh})${excludeClause}${visibilityClause}
    `;

    return db.prepare(sql).all(...uniqueClusters, ...uniqueExclude, ...visibility.params);
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
    this._embeddingCache = null;
    this._hasEpochVisibility = null;
    this._hasChunkTextFts = undefined;
  }
}
