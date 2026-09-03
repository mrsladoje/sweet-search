/**
 * Codebase Repository — encapsulates all SQLite access to codebase.db.
 *
 * The search domain calls repository methods instead of running raw SQL.
 * This keeps persistence concerns in the infrastructure layer where they belong.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { applyReadPragmas, assertInClauseSize } from './db-utils.js';

function readAdjacentManifest(dbPath) {
  try {
    const manifestPath = path.join(path.dirname(dbPath), 'reconcile-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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
    const placeholders = uniqueIds.map(() => '?').join(',');
    const visibility = this._visibility(db);
    const visibilityClause = visibility.sql ? ` AND ${visibility.sql}` : '';
    const rows = db.prepare(
      `SELECT id, embedding FROM vectors WHERE id IN (${placeholders})${visibilityClause}`
    ).all(...uniqueIds, ...visibility.params);

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
    this._hasEpochVisibility = null;
  }
}
