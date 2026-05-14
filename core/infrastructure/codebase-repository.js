/**
 * Codebase Repository — encapsulates all SQLite access to codebase.db.
 *
 * The search domain calls repository methods instead of running raw SQL.
 * This keeps persistence concerns in the infrastructure layer where they belong.
 */

import Database from 'better-sqlite3';
import { applyReadPragmas, assertInClauseSize } from './db-utils.js';

export class CodebaseRepository {
  constructor(dbPath) {
    this._dbPath = dbPath;
    this._db = null;
  }

  /** Lazy read-only connection with optimized pragmas. */
  _open() {
    if (!this._db) {
      this._db = new Database(this._dbPath, { readonly: true });
      applyReadPragmas(this._db);
    }
    return this._db;
  }

  /**
   * Iterate all vectors (for O(N) scan or chunk type map building).
   * Returns rows with: id, embedding (Buffer), text, metadata (string), file_path.
   */
  * iterateVectors() {
    const db = this._open();
    yield* db.prepare('SELECT id, embedding, text, metadata, file_path FROM vectors').iterate();
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
    const rows = db.prepare(
      `SELECT id, embedding FROM vectors WHERE id IN (${placeholders})`
    ).all(...uniqueIds);

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
      const rows = db.prepare(
        `SELECT id, text FROM vectors WHERE id IN (${ph})`
      ).all(...ids);
      return new Map(rows.map(r => [r.id, r.text]));
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
      return db.prepare(
        'SELECT id, file_path, text, metadata FROM vectors WHERE file_path = ? ORDER BY id'
      ).all(filePath);
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
    const db = new Database(this._dbPath, { readonly: true });
    applyReadPragmas(db);
    try {
      return db.prepare('SELECT id, embedding, text, metadata FROM vectors').all();
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

    const sql = `
      SELECT id, file_path, text, metadata
      FROM vectors
      WHERE json_extract(metadata, '$.clusterId') IN (${clusterPh})${excludeClause}
    `;

    return db.prepare(sql).all(...uniqueClusters, ...uniqueExclude);
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}
