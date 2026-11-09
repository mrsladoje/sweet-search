#!/usr/bin/env node

/**
 * Fast lexical search with code graph expansion:
 * - FTS5/BM25 for initial matches (with trigram fuzzy search)
 * - Graph traversal to find related entities
 * - Weighted scoring based on relationship types
 *
 * Target: <10ms p50 for lexical queries
 *
 * Uses better-sqlite3 for native FTS5 with trigram tokenizer support.
 */

import { existsSync } from 'fs';
import { DB_PATHS, GRAPH_CONFIG } from '../infrastructure/config/index.js';
import { applyReadPragmas, assertInClauseSize } from '../infrastructure/db-utils.js';
import { detectIntent, getIntentBoost } from '../query/intent-detector.js';
import { applyMMR, shouldApplyMMR } from '../ranking/mmr.js';
import { SYMBOL_KIND_WEIGHTS, DEFINITION_TYPES } from '../infrastructure/constants.js';
import {
  entityVisibilityParams,
  entityVisibilitySql,
  readAdjacentManifest,
  relationshipVisibilityParams,
  relationshipVisibilitySql,
  resolveManifestCodeGraphPath,
  sqlAliasPrefix,
} from '../infrastructure/code-graph-visibility.js';
import { TRACE_ONLY_TYPES_SQL } from '../infrastructure/relationship-types.js';
import { assertGraphSchema } from '../infrastructure/index-schema.js';
import { isAgentFormat } from '../infrastructure/agent-format.js';
import { asTopLevelCaller, fileNodeSourceSql } from '../infrastructure/file-nodes.js';

// Entity doc comments (filled from the AST since 2026-10) take part in BM25
// only for agent formats. GCSN dev: an ungated doc column cost MRR@10 86.92%
// -> 86.89% (n=3600, seed=42): GCSN keeps docstrings only in its Python
// corpus, so Python entities won other languages' doc-text queries. Per the
// CLAUDE.md format-gating rule, other formats keep the pre-doc behaviour:
// FTS5 matches name/name_alias/signature only, LIKE fallback ignores the doc
// part of search_text, and rows carry no docComment (the non-agent
// query-text reranker reads it).
//
// A column filter on `entities_fts` is not enough for that: FTS5 bm25()
// normalises by the token count of the WHOLE row, so a documented entity's
// name match scores ~45% lower than an undocumented one's even when the doc
// column cannot match. Non-agent formats and name-restricted queries
// therefore read `entities_code_fts` (name, name_alias, signature; no doc),
// which ranks exactly as `entities_fts` did before docs were filled.
const NON_DOC_FTS_COLUMNS = '{name name_alias signature}';

function usesDocComments(format) {
  return isAgentFormat(format);
}

const ABBREVIATION_EXPANSIONS = {
  auth: ['authentication', 'authorize'],
  cfg: ['config', 'configuration'],
  btn: ['button'],
  repo: ['repository'],
  req: ['request'],
  res: ['response'],
  impl: ['implementation'],
  env: ['environment'],
  msg: ['message'],
  err: ['error'],
  ctx: ['context'],
  db: ['database'],
  conn: ['connection'],
  mgr: ['manager'],
  svc: ['service'],
};

export class GraphSearch {
  constructor(dbPath = DB_PATHS.codeGraph, options = {}) {
    this._baseDbPath = dbPath;
    this._explicitManifestEpoch = Number.isInteger(options.manifestEpoch);
    this._manifestEpoch = this._explicitManifestEpoch ? options.manifestEpoch : null;
    const manifest = this._explicitManifestEpoch ? readAdjacentManifest(this._baseDbPath) : null;
    this.dbPath = this._explicitManifestEpoch
      ? resolveManifestCodeGraphPath(this._baseDbPath, manifest)
      : dbPath;
    this.db = null;
    this.hasFts5 = false;
    this.hasCodeFts = false;
    this.hasTrigram = false;
    if (!this._explicitManifestEpoch) {
      this._syncAdjacentManifest();
    }
  }

  _syncAdjacentManifest() {
    if (this._explicitManifestEpoch) return false;
    const manifest = readAdjacentManifest(this._baseDbPath);
    const nextEpoch = Number.isInteger(manifest?.epoch) ? manifest.epoch : null;
    const nextDbPath = resolveManifestCodeGraphPath(this._baseDbPath, manifest);
    const changed = nextEpoch !== this._manifestEpoch || nextDbPath !== this.dbPath;
    this._manifestEpoch = nextEpoch;
    this.dbPath = nextDbPath;
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

  /**
   * Initialize database connection (synchronous with better-sqlite3)
   */
  async init() {
    this._syncAdjacentManifest();
    if (this.db) return;

    if (!existsSync(this.dbPath)) {
      throw new Error(`Code graph database not found at ${this.dbPath}. Run graph indexing first.`);
    }

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(this.dbPath, { readonly: true });
    // An index from another schema version fails here with the rebuild instruction.
    try { assertGraphSchema(db, this.dbPath); } catch (err) { db.close(); throw err; }

    try {
      applyReadPragmas(db, { tempStoreMemory: true });

      try {
        const ftsCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'").get();
        this.hasFts5 = !!ftsCheck;

        const trigramCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities_trigram'").get();
        this.hasTrigram = !!trigramCheck;

        const codeFtsCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities_code_fts'").get();
        this.hasCodeFts = !!codeFtsCheck;
      } catch {
        this.hasFts5 = false;
        this.hasCodeFts = false;
        this.hasTrigram = false;
      }

      // Cache hot-path prepared statements (eliminates ~8-9µs per prepare() call)
      // Prepare failures on optional FTS paths should degrade to existing fallbacks.
      if (this.hasFts5) {
        try {
          const entityVis = this._entityVisibilitySql('e');
          this._stmtFts5 = db.prepare(`
            SELECT
              e.id, e.file_path, e.type, e.name, e.signature,
              e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
              bm25(entities_fts, 10.0, 4.0, 5.0, 1.0) AS score
            FROM entities_fts
            JOIN entities e ON entities_fts.rowid = e.rowid
            WHERE entities_fts MATCH ?
              AND ${entityVis}
            ORDER BY score
            LIMIT ?
          `);
        } catch {
          this.hasFts5 = false;
          this._stmtFts5 = null;
        }
      }

      // Doc-free twin of entities_fts (see DOC_COMMENT_FORMATS). Without it
      // (an index built before the table existed) _ftsRows falls back to a
      // column filter on entities_fts.
      this._stmtCodeFts = null;
      if (this.hasFts5 && this.hasCodeFts) {
        try {
          const entityVis = this._entityVisibilitySql('e');
          this._stmtCodeFts = db.prepare(`
            SELECT
              e.id, e.file_path, e.type, e.name, e.signature,
              e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
              bm25(entities_code_fts, 10.0, 4.0, 5.0) AS score
            FROM entities_code_fts
            JOIN entities e ON entities_code_fts.rowid = e.rowid
            WHERE entities_code_fts MATCH ?
              AND ${entityVis}
            ORDER BY score
            LIMIT ?
          `);
        } catch {
          this.hasCodeFts = false;
          this._stmtCodeFts = null;
        }
      }

      if (this.hasTrigram) {
        try {
          const entityVis = this._entityVisibilitySql('e');
          this._stmtTrigram = db.prepare(`
            SELECT
              e.id, e.file_path, e.type, e.name, e.signature,
              e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
              bm25(entities_trigram, 10.0, 3.0) AS score
            FROM entities_trigram
            JOIN entities e ON entities_trigram.rowid = e.rowid
            WHERE entities_trigram MATCH ?
              AND ${entityVis}
            ORDER BY score
            LIMIT ?
          `);
        } catch {
          this.hasTrigram = false;
          this._stmtTrigram = null;
        }
      }

      this._stmtEntityById = db.prepare(
        `SELECT * FROM entities WHERE id = ? AND ${this._entityVisibilitySql('')}`
      );

      this._stmtOutRels = db.prepare(`
        SELECT e.*, r.type as rel_type, r.weight as rel_weight
        FROM relationships r
        JOIN entities e ON (
          (r.target_id IS NOT NULL AND e.id = r.target_id)
          OR (r.target_id IS NULL AND e.name = r.target_name)
        )
        WHERE r.source_id = ?
          AND ${this._entityVisibilitySql('e')}
          AND ${this._relationshipVisibilitySql('r')}
        LIMIT 20
      `);

      this._stmtInRels = db.prepare(`
        SELECT e.*, r.type as rel_type, r.weight as rel_weight
        FROM relationships r
        JOIN entities e ON e.id = r.source_id
        WHERE (r.target_id = ? OR r.target_name = (SELECT name FROM entities WHERE id = ?))
          AND ${this._entityVisibilitySql('e')}
          AND ${this._relationshipVisibilitySql('r')}
        LIMIT 20
      `);

      this.db = db;
    } catch (err) {
      this.hasFts5 = false;
      this.hasCodeFts = false;
      this.hasTrigram = false;
      this._stmtFts5 = null;
      this._stmtCodeFts = null;
      this._stmtTrigram = null;
      this._stmtEntityById = null;
      this._stmtOutRels = null;
      this._stmtInRels = null;
      db.close();
      throw err;
    }
  }

  _entityVisibilitySql(alias = 'e', options = {}) {
    const sql = entityVisibilitySql({ manifestEpoch: this._manifestEpoch }, alias);
    if (options.allowNullJoined) {
      return `(${sql} OR ${sqlAliasPrefix(alias)}id IS NULL)`;
    }
    return sql;
  }

  _entityVisibilityParams() {
    return entityVisibilityParams({ manifestEpoch: this._manifestEpoch });
  }

  // Every graph-search query (graph lane, frontier expansion, impact) also
  // skips the trace-only relationship types; ss-trace reads them through
  // structural-context-repository instead.
  _relationshipVisibilitySql(alias = 'r') {
    const traceOnly = `${sqlAliasPrefix(alias)}type NOT IN ${TRACE_ONLY_TYPES_SQL}`;
    return `${relationshipVisibilitySql({ manifestEpoch: this._manifestEpoch }, alias)} AND ${traceOnly}`;
  }

  _relationshipVisibilityParams() {
    return relationshipVisibilityParams({ manifestEpoch: this._manifestEpoch });
  }

  _mapRow(row, source, scoreMultiplier = 1.0, format) {
    return {
      id: row.id,
      file: row.file_path,
      type: row.type,
      name: row.name,
      signature: row.signature,
      docComment: usesDocComments(format) ? row.doc_comment : null,
      startLine: row.start_line,
      endLine: row.end_line,
      package: row.package,
      parentClass: row.parent_class,
      score: Math.abs(row.score) * scoreMultiplier,
      source,
    };
  }

  _mergeRows(results, rows, source, scoreMultiplier = 1.0, format) {
    const existingIds = new Set(results.map(r => r.id));
    for (const row of rows) {
      if (!existingIds.has(row.id)) {
        results.push(this._mapRow(row, source, scoreMultiplier, format));
        existingIds.add(row.id);
      }
    }
  }

  /**
   * FTS5 rows for a MATCH expression. Agent formats read entities_fts (name,
   * name_alias, signature, doc_comment); other formats, and name-restricted
   * queries (`nameOnly`, whose expression is `name : …`) in every format,
   * read the doc-free entities_code_fts so a doc never changes their BM25
   * length normalisation (see DOC_COMMENT_FORMATS).
   */
  _ftsRows(expr, format, limit, { nameOnly = false } = {}) {
    const params = this._entityVisibilityParams();
    if (usesDocComments(format) && !nameOnly) {
      return this._stmtFts5.all(expr, ...params, limit);
    }
    if (this._stmtCodeFts) return this._stmtCodeFts.all(expr, ...params, limit);
    const scoped = nameOnly ? expr : `${NON_DOC_FTS_COLUMNS} : (${expr})`;
    return this._stmtFts5.all(scoped, ...params, limit);
  }

  /**
   * LIKE-based fallback search (used when FTS5 is unavailable or returns no results).
   */
  _likeFallback(results, query, limit, source = 'like', format) {
    const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    // search_text = name + signature + doc_comment; without docs, match the
    // same text minus the doc part.
    const haystack = usesDocComments(format)
      ? 'search_text'
      : "lower(name || ' ' || coalesce(signature, ''))";
    const likeConditions = searchTerms.map(() => `${haystack} LIKE ?`).join(' AND ');
    const likeParams = searchTerms.map(t => `%${t}%`);

    const stmt = this.db.prepare(`
      SELECT
        id, file_path, type, name, signature, doc_comment,
        start_line, end_line, package, parent_class, search_text
      FROM entities
      WHERE ${likeConditions || '1=1'}
        AND ${this._entityVisibilitySql('')}
      ORDER BY
        CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
        length(name)
      LIMIT ?
    `);

    const rows = stmt.all(...likeParams, ...this._entityVisibilityParams(), `%${query}%`, limit);

    let rank = 0;
    for (const row of rows) {
      rank++;
      const nameMatch = row.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 0;
      const exactMatch = row.name.toLowerCase() === query.toLowerCase() ? 5 : 0;
      row.score = -(10 - rank * 0.1 + nameMatch + exactMatch);
      const mapped = this._mapRow(row, source, 1.0, format);
      mapped.score = Math.max(0.1, mapped.score);
      results.push(mapped);
    }
  }

  _computeLexicalMeta(results, query, options = {}) {
    const {
      restrictedAttempted = false,
      restrictedFallback = false,
      definitionFirstUsed = false,
      definitionFirstTopHit = false,
    } = options;
    const sources = new Set(results.map(r => r.source));
    const hasFtsSource = Array.from(sources).some(source => source.startsWith('fts5'));
    const hasTrigramSource = Array.from(sources).some(source => source.startsWith('trigram'));
    let searchQuality = 'fallback';
    if (hasFtsSource) {
      searchQuality = 'exact';
    } else if (hasTrigramSource) {
      searchQuality = 'fuzzy';
    }

    const lexicalMeta = {
      searchQuality,
      lexicalPath: hasFtsSource ? 'fts5' : (hasTrigramSource ? 'trigram' : 'like'),
      identifierRestricted: restrictedAttempted && !restrictedFallback,
      restrictedAttempted,
      restrictedFallback,
      abbreviationExpanded: sources.has('fts5_abbr'),
      variantExpanded: sources.has('fts5_expanded'),
      definitionFirstUsed,
      definitionFirstTopHit,
    };

    return { searchQuality, lexicalMeta };
  }

  /**
   * Find an entity by name (non-stale).
   * Returns { id, name, type, signature, summary, file_path, start_line } or null.
   */
  async findEntityByName(name) {
    await this.init();
    if (!this._stmtEntityByName) {
      this._stmtEntityByName = this.db.prepare(`
        SELECT id, name, type, signature, entities.summary, file_path, start_line
        FROM entities
        WHERE name = ? AND ${this._entityVisibilitySql('entities')}
        LIMIT 1
      `);
    }
    return this._stmtEntityByName.get(
      name,
      ...this._entityVisibilityParams(),
    ) || null;
  }

  /**
   * Find an entity by file location (non-stale).
   * Returns { id, name, type, signature, summary, file_path, start_line } or null.
   */
  async findEntityByLocation(filePath, line) {
    await this.init();
    if (!this._stmtEntityByLocation) {
      this._stmtEntityByLocation = this.db.prepare(`
        SELECT id, name, type, signature, entities.summary, file_path, start_line
        FROM entities
        WHERE file_path LIKE ? AND start_line <= ? AND end_line >= ?
          AND ${this._entityVisibilitySql('entities')}
        LIMIT 1
      `);
    }
    return this._stmtEntityByLocation.get(
      `%${filePath}%`,
      line,
      line,
      ...this._entityVisibilityParams(),
    ) || null;
  }

  /**
   * Batch-find entities by name and location for a results array.
   * Two queries total (one per lookup type) instead of n sequential lookups.
   * @param {Array} results - search results with name/file/startLine fields
   * @returns {{ byName: Map<string, Object>, byLocation: Map<string, Object> }}
   */
  async findEntitiesBatch(results) {
    await this.init();
    const byName = new Map();
    const byLocation = new Map();

    const names = new Set();
    const locations = [];
    for (const r of results) {
      const name = r.name || r.metadata?.name;
      const file = r.file || r.metadata?.file;
      const line = r.startLine || r.metadata?.startLine;
      if (name) names.add(name);
      if (file && line) locations.push({ file, line });
    }

    if (names.size > 0) {
      if (!this._stmtEntityByName) {
        this._stmtEntityByName = this.db.prepare(`
          SELECT id, name, type, signature, entities.summary, file_path, start_line
          FROM entities
          WHERE name = ? AND ${this._entityVisibilitySql('entities')}
          LIMIT 1
        `);
      }
      for (const name of names) {
        const entity = this._stmtEntityByName.get(
          name,
          ...this._entityVisibilityParams(),
        );
        if (entity) byName.set(name, entity);
      }
    }

    // Batch location lookup (only for results not found by name)
    if (locations.length > 0) {
      if (!this._stmtEntityByLocation) {
        this._stmtEntityByLocation = this.db.prepare(`
          SELECT id, name, type, signature, entities.summary, file_path, start_line
          FROM entities
          WHERE file_path LIKE ? AND start_line <= ? AND end_line >= ?
            AND ${this._entityVisibilitySql('entities')}
          LIMIT 1
        `);
      }
      for (const { file, line } of locations) {
        const key = `${file}:${line}`;
        if (byLocation.has(key)) continue;
        const entity = this._stmtEntityByLocation.get(
          `%${file}%`,
          line,
          line,
          ...this._entityVisibilityParams(),
        );
        if (entity) byLocation.set(key, entity);
      }
    }

    return { byName, byLocation };
  }

  /**
   * @returns {Set<string>}
   */
  async getStaleEntityIds() {
    await this.init();
    const result = new Set();
    try {
      const rows = this._manifestEpoch !== null
        ? this.db.prepare(`
            SELECT id FROM entities
            WHERE stale_since IS NOT NULL
              AND (epoch_written IS NULL OR epoch_written <= ?)
              AND (epoch_retired IS NULL OR epoch_retired <= ?)
          `).all(this._manifestEpoch, this._manifestEpoch)
        : this.db.prepare('SELECT id FROM entities WHERE stale_since IS NOT NULL').all();
      for (const row of rows) result.add(row.id);
    } catch {
      // Unreadable graph: no stale ids
    }
    return result;
  }

  /**
   * Run lightweight queries to warm the SQLite page cache.
   * Touches FTS5, relationship, and summary pages.
   * @returns {{ summaries: number }}
   */
  async warmCache() {
    await this.init();
    let summaries = 0;
    try { this.db.prepare('SELECT count(*) FROM entities_fts WHERE name MATCH "warmup"').get(); } catch { /* table may not exist */ }
    try { this.db.prepare('SELECT count(*) FROM relationships').get(); } catch { /* table may not exist */ }
    try {
      const row = this.db.prepare('SELECT count(*) as cnt FROM entities WHERE summary IS NOT NULL').get();
      summaries = row?.cnt || 0;
    } catch { /* column may not exist */ }
    return { summaries };
  }

  close() {
    this._stmtFts5 = null;
    this._stmtCodeFts = null;
    this._stmtTrigram = null;
    this._stmtEntityById = null;
    this._stmtOutRels = null;
    this._stmtInRels = null;
    this._stmtEntityByName = null;
    this._stmtEntityByLocation = null;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * @param {string} query - Search query
   * @param {Object|number} options - Options object or limit (for backwards compat)
   * @param {number} [options.limit=20] - Maximum results to return
   * @param {boolean} [options.skipBoosts=false] - Skip post-FTS5 ranking boosts (for fair hybrid fusion)
   * @returns {Promise<{results: Array, latency: number}>}
   */
  async bm25Search(query, options = {}) {
    const opts = typeof options === 'number' ? { limit: options } : options;
    const { limit = 20, skipBoosts = false, format } = opts;
    await this.init();

    const start = Date.now();
    let results = [];
    let restrictedAttempted = false;
    let restrictedFallback = false;

    if (this.hasFts5) {
      // Fix 4: Try name:-restricted FTS5 query first for code-shaped identifiers
      const useNameRestriction = this.isStrictIdentifierQuery(query);
      let rows = [];

      if (useNameRestriction) {
        restrictedAttempted = true;
        try {
          rows = this._ftsRows(
            `name : ${this.sanitizeFtsQuery(query)}`, format, limit, { nameOnly: true },
          );
        } catch (err) {
          this.log(`[bm25Search] Name-restricted FTS5 query failed: ${err.message}`);
          rows = [];
        }
      }

      if (rows.length === 0) {
        restrictedFallback = restrictedAttempted;
        try {
          rows = this._ftsRows(this.sanitizeFtsQuery(query), format, limit);
        } catch (err) {
          this.log(`[bm25Search] FTS5 query failed: ${err.message}`);
          rows = [];
        }
      }

      for (const row of rows) {
        results.push(this._mapRow(row, 'fts5', 1.0, format));
      }
    }

    // Try trigram fuzzy search if standard FTS5 returned few results
    // This enables "Auth" → "AuthenticationService" matching
    if (this.hasTrigram && results.length < 3 && query.length >= 3) {
      try {
        const escaped = query.replace(/"/g, '""');
        const trigramRows = this._stmtTrigram.all(
          `"${escaped}"`,
          ...this._entityVisibilityParams(),
          limit,
        );

        this._mergeRows(results, trigramRows, 'trigram', 0.9, format);
      } catch (err) {
        this.log(`[bm25Search] Trigram query failed: ${err.message}`);
      }
    }

    // Fix 8: Identifier variant expansion — run secondary expanded query for code-shaped identifiers
    if (this.hasFts5 && results.length < 5 && this.isStrictIdentifierQuery(query)) {
      try {
        const expandedForm = this.expandIdentifierQuery(query);
        if (expandedForm && expandedForm !== this.sanitizeFtsQuery(query)) {
          const expandedRows = this._ftsRows(expandedForm, format, limit);
          this._mergeRows(results, expandedRows, 'fts5_expanded', 0.85, format);
        }
      } catch (err) {
        this.log(`[bm25Search] Identifier expansion query failed: ${err.message}`);
      }
    }

    // Fix 9: Abbreviation expansion — try expanding abbreviations when results are sparse
    if (this.hasFts5 && results.length < 3) {
      try {
        const abbrQuery = this.expandAbbreviations(query);
        if (abbrQuery) {
          const abbrRows = this._ftsRows(abbrQuery, format, limit);
          this._mergeRows(results, abbrRows, 'fts5_abbr', 0.8, format);
        }
      } catch (err) {
        this.log(`[bm25Search] Abbreviation expansion failed: ${err.message}`);
      }
    }

    if (!this.hasFts5 || results.length === 0) {
      this._likeFallback(results, query, limit, 'like', format);
    }

    const latency = Date.now() - start;

    // Apply post-FTS5 ranking boosts (Strategies #1, #19, #4, #20)
    // Skip boosts if skipBoosts=true (for fair hybrid fusion - boosts applied post-fusion)
    const finalResults = skipBoosts ? results : this.applyRankingBoosts(results, query);

    const { searchQuality, lexicalMeta } = this._computeLexicalMeta(finalResults, query, {
      restrictedAttempted,
      restrictedFallback,
    });

    this.log(`[bm25Search] quality=${searchQuality} path=${lexicalMeta.lexicalPath} restricted=${lexicalMeta.identifierRestricted} fallback=${lexicalMeta.restrictedFallback} results=${finalResults.length} latency=${latency}ms`);

    return { results: finalResults, latency, searchQuality, lexicalMeta };
  }

  /**
   * Returns raw FTS5/BM25 scores WITHOUT post-FTS5 boosts or flood control.
   * Used by hybrid search to ensure fair CC fusion between lexical and semantic paths.
   *
   * @param {string} query - Search query
   * @param {number} [limit=50] - Maximum results to return
   * @param {object} [options]
   * @param {string} [options.format] - Output format; agent formats also match doc comments
   * @returns {Promise<{results: Array, latency: number}>}
   */
  async bm25SearchRaw(query, limit = 50, options = {}) {
    const { format } = options;
    await this.init();

    const start = Date.now();
    let results = [];

    if (this.hasFts5) {
      // Fix 4: Name-restricted FTS5 query for code-shaped identifiers (plan requires both bm25Search & Raw)
      const useNameRestriction = this.isStrictIdentifierQuery(query);
      let rows = [];

      if (useNameRestriction) {
        try {
          rows = this._ftsRows(
            `name : ${this.sanitizeFtsQuery(query)}`, format, limit, { nameOnly: true },
          );
        } catch (err) {
          this.log(`[bm25SearchRaw] Name-restricted FTS5 query failed: ${err.message}`);
          rows = [];
        }
      }

      if (rows.length === 0) {
        try {
          rows = this._ftsRows(this.sanitizeFtsQuery(query), format, limit);
        } catch (err) {
          this.log(`[bm25SearchRaw] FTS5 query failed: ${err.message}`);
          rows = [];
        }
      }

      for (const row of rows) {
        results.push(this._mapRow(row, 'fts5_raw', 1.0, format));
      }
    }

    if (this.hasTrigram && results.length < 3 && query.length >= 3) {
      try {
        const escapedRaw = query.replace(/"/g, '""');
        const trigramRows = this._stmtTrigram.all(
          `"${escapedRaw}"`,
          ...this._entityVisibilityParams(),
          limit,
        );
        this._mergeRows(results, trigramRows, 'trigram_raw', 0.9, format);
      } catch (err) {
        this.log(`[bm25SearchRaw] Trigram query failed: ${err.message}`);
      }
    }

    if (!this.hasFts5 || results.length === 0) {
      this._likeFallback(results, query, limit, 'like_raw', format);
    }

    const latency = Date.now() - start;

    // NO boosts, NO flood control - return raw scores for fair fusion
    return { results, latency };
  }

  /**
   * Implements 4 strategies:
   * - Strategy #1: Definition Boost - prioritize files that DEFINE the queried entity
   * - Strategy #19: Definition Syntax Boost - detect definition patterns in signatures
   * - Strategy #4: Symbol Kind Hierarchy - weight by entity type importance
   * - Strategy #20: Structural Position Boost - prioritize early-in-file entities
   *
   * @param {Array<Object>} results - BM25 search results with score, name, type, file, startLine, signature
   * @param {string} query - Original search query
   * @returns {Array<Object>} Results with boosted scores, re-sorted by score descending
   *
   * @example
   * // AuthService.java defining "class AuthService" will get:
   * // - 2.0x from Strategy #1 (filename match + definition type)
   * // - 1.8x from Strategy #19 (contains "class AuthService")
   * // - 1.0x from Strategy #4 (class = highest weight)
   * // - ~1.24x from Strategy #20 (if at line 10)
   * // Total: score *= 2.0 * 1.8 * 1.0 * 1.24 = 4.46x boost
   */
  applyRankingBoosts(results, query) {
    if (!results || results.length === 0) {
      return results;
    }

    const queryLower = query.toLowerCase().trim();
    const queryTokens = this.extractQueryTokens(query);
    const debugMode = process.env.DEBUG_GRAPH_SEARCH;

    const { intent, confidence } = detectIntent(query);
    const applyIntentBoost = intent !== 'general' && confidence >= 0.7;

    if (debugMode && applyIntentBoost) {
      this.log(`Intent: ${intent} (confidence: ${confidence.toFixed(2)})`);
    }

    const boostedResults = results.map(result => {
      let totalBoost = 1.0;
      const boostDetails = [];

      const defBoost = this.applyDefinitionBoost(result, queryLower, queryTokens);
      if (defBoost > 1.0) {
        totalBoost *= defBoost;
        boostDetails.push(`def:${defBoost.toFixed(2)}`);
      }

      const syntaxBoost = this.applyDefinitionSyntaxBoost(result, queryTokens);
      if (syntaxBoost > 1.0) {
        totalBoost *= syntaxBoost;
        boostDetails.push(`syntax:${syntaxBoost.toFixed(2)}`);
      }

      const kindWeight = this.applySymbolKindWeight(result);
      // Apply as soft boost: score *= (0.5 + 0.5 * kindWeight) to avoid crushing low types
      const kindBoost = 0.5 + 0.5 * kindWeight;
      totalBoost *= kindBoost;
      if (kindWeight !== 1.0) {
        boostDetails.push(`kind:${kindBoost.toFixed(2)}`);
      }

      const posBoost = this.applyPositionBoost(result);
      if (posBoost > 1.0) {
        totalBoost *= posBoost;
        boostDetails.push(`pos:${posBoost.toFixed(2)}`);
      }

      if (applyIntentBoost) {
        const intentBoost = getIntentBoost(intent, result.type);
        if (intentBoost > 1.0) {
          totalBoost *= intentBoost;
          boostDetails.push(`intent:${intentBoost.toFixed(2)}`);
        }
      }

      const pathBoost = this.applyPathBoost(result, queryTokens);
      if (pathBoost > 1.0) {
        totalBoost *= pathBoost;
        boostDetails.push(`path:${pathBoost.toFixed(2)}`);
      }

      const boostedScore = result.score * totalBoost;

      if (debugMode && totalBoost > 1.0) {
        this.log(`Boost ${result.name}: ${result.score.toFixed(3)} -> ${boostedScore.toFixed(3)} (${boostDetails.join(', ')})`);
      }

      return {
        ...result,
        score: boostedScore,
        _originalScore: result.score,
        _boostFactor: totalBoost,
      };
    });

    boostedResults.sort((a, b) => b.score - a.score);

    if (shouldApplyMMR(boostedResults)) {
      const { results: diversified, stats } = applyMMR(boostedResults, { k: boostedResults.length, lambda: 0.9 });
      if (debugMode) {
        this.log(`MMR: ${stats.candidates} → ${stats.selected} (λ=${stats.lambda}, ${stats.reorderCount} reordered)`);
      }
      return diversified;
    }

    return boostedResults;
  }

  /**
   * Handles PascalCase, camelCase, and space-separated terms.
   *
   * @example
   * extractQueryTokens("AuthService") // ["auth", "service", "authservice"]
   * extractQueryTokens("user login") // ["user", "login"]
   */
  extractQueryTokens(query) {
    const tokens = new Set();
    const trimmed = query.trim();

    if (!trimmed) {
      return [];
    }

    tokens.add(trimmed.toLowerCase());

    // Split on identifier boundaries and path-like separators.
    const normalized = trimmed
      .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      .replace(/[_\-./:\\]/g, ' ');

    const words = normalized.toLowerCase().split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (word.length > 0) {
        tokens.add(word);
      }
    }

    const collapsed = words.join('');
    if (collapsed) {
      tokens.add(collapsed);
    }

    return Array.from(tokens);
  }

  /**
   * Prioritizes results that DEFINE the queried entity over results that merely
   * reference or use it. A search for "AuthService" should rank AuthService.java
   * (the definition) above LoginController.java (a caller).
   *
   * @returns {number} Boost multiplier (1.0 = no boost, 2.0 = strong boost)
   */
  applyDefinitionBoost(result, queryLower, queryTokens) {
    const isDefinitionType = DEFINITION_TYPES.has(result.type);
    const resultNameLower = (result.name || '').toLowerCase();

    const filePath = result.file || '';
    const fileName = filePath.split('/').pop() || '';
    const fileNameNoExt = fileName.replace(/\.[^.]+$/, '').toLowerCase();

    const filenameMatchesQuery = queryTokens.some(token =>
      fileNameNoExt === token || fileNameNoExt.includes(token)
    );

    const exactNameMatch = queryTokens.some(token => resultNameLower === token);

    if (filenameMatchesQuery && isDefinitionType) {
      return 2.0;
    }

    if (exactNameMatch && isDefinitionType) {
      return 1.5;
    }

    if (isDefinitionType) {
      return 1.2;
    }

    return 1.0;
  }

  /**
   * Detects language-specific definition patterns in entity signatures/content.
   * Boosts entities whose signatures explicitly define the queried symbol.
   *
   * @returns {number} Boost multiplier (1.0 = no boost, 1.8 = strong boost)
   *
   * Patterns detected:
   * - Java: "class <Q>", "interface <Q>", "enum <Q>", "public class <Q>"
   * - JS/TS: "class <Q>", "function <Q>", "export class <Q>", "export function <Q>"
   * - General: "<visibility> <type> <Q>" patterns
   */
  applyDefinitionSyntaxBoost(result, queryTokens) {
    const signature = (result.signature || '').toLowerCase();
    if (!signature) return 1.0;

    // Definition syntax patterns (order matters - check strongest first)
    const definitionPatterns = [
      /\b(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/,
      /\b(?:public|private|protected)?\s*interface\s+(\w+)/,
      /\b(?:public|private|protected)?\s*enum\s+(\w+)/,
      /\b(?:public|private|protected)?\s*(?:static)?\s*(?:abstract)?\s*(?:final)?\s*\w+\s+(\w+)\s*\(/,

      /\bclass\s+(\w+)/,
      /\bfunction\s+(\w+)/,
      /\bexport\s+(?:default\s+)?class\s+(\w+)/,
      /\bexport\s+(?:default\s+)?function\s+(\w+)/,
      /\bconst\s+(\w+)\s*=/,
      /\bexport\s+const\s+(\w+)\s*=/,

      /\binterface\s+(\w+)/,
      /\btype\s+(\w+)\s*=/,
      /\benum\s+(\w+)/,
    ];

    for (const pattern of definitionPatterns) {
      const match = signature.match(pattern);
      if (match && match[1]) {
        const definedName = match[1].toLowerCase();
        if (queryTokens.some(token => definedName === token || definedName.includes(token))) {
          return 1.8;
        }
      }
    }

    return 1.0;
  }

  /**
   * Applies importance weights based on entity type. Classes and interfaces
   * are generally more important than variables or imports.
   *
   * @returns {number} Weight multiplier (0.1 - 1.0)
   *
   * Hierarchy (highest to lowest):
   * - class, interface, struct (0.95-1.0): Primary definitions
   * - function, method (0.80-0.85): Behavior definitions
   * - constant, property, field (0.6-0.7): Data definitions
   * - variable, parameter (0.3-0.4): Local scope
   * - reference, call, import (0.1-0.2): Usage patterns
   */
  applySymbolKindWeight(result) {
    const entityType = (result.type || '').toLowerCase();
    return SYMBOL_KIND_WEIGHTS[entityType] ?? 0.5;
  }

  /**
   * Boosts entities that appear early in files, as definitions typically
   * appear near the top (after imports). This helps prioritize class declarations
   * over method implementations deep in the file.
   *
   * @returns {number} Boost multiplier (1.0 - 1.3 for definitions)
   *
   * Formula:
   * - positionPrior = 1 / (1 + startLine / 50), clamped to [0.5, 1.0]
   * - For definition types: score *= (1 + 0.3 * positionPrior)
   * - For non-definitions: no boost (return 1.0)
   */
  applyPositionBoost(result) {
    const startLine = result.startLine;
    if (startLine == null || startLine < 0) return 1.0;

    if (!DEFINITION_TYPES.has(result.type)) {
      return 1.0;
    }

    // Calculate position prior: higher for entities near the top
    // Line 1 -> prior = 0.98
    // Line 50 -> prior = 0.5
    // Line 100 -> prior = 0.33 (clamped to 0.5)
    const rawPrior = 1 / (1 + startLine / 50);
    const positionPrior = Math.max(0.5, Math.min(1.0, rawPrior));

    // Apply boost: definitions at top get up to 1.3x, at bottom get 1.15x
    return 1 + 0.3 * positionPrior;
  }

  /**
   * Fix 6: Path-aware lexical signal boost.
   * Boosts results where the file path/basename contains query tokens.
   */
  applyPathBoost(result, queryTokens) {
    if (!result.file) return 1.0;

    const filePath = result.file.toLowerCase();
    const parts = filePath.split('/');
    const basename = parts[parts.length - 1]?.replace(/\.[^.]+$/, '') || '';

    let boost = 1.0;

    for (const token of queryTokens) {
      if (token.length < 2) continue;

      if (basename === token) {
        boost = Math.max(boost, 1.5);
      } else if (basename.includes(token)) {
        boost = Math.max(boost, 1.25);
      } else if (parts.some(seg => seg.includes(token))) {
        boost = Math.max(boost, 1.1);
      }
    }

    return boost;
  }

  async searchByName(name, type = null) {
    await this.init();

    let query = 'SELECT * FROM entities WHERE name = ?';
    const params = [name];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ` AND ${this._entityVisibilitySql('')}`;
    query += ' LIMIT 50';

    const stmt = this.db.prepare(query);
    return stmt.all(...params, ...this._entityVisibilityParams());
  }

  async searchByFile(pathPattern) {
    await this.init();

    const stmt = this.db.prepare(`
      SELECT * FROM entities
      WHERE file_path LIKE ?
        AND ${this._entityVisibilitySql('')}
      ORDER BY start_line
      LIMIT 100
    `);

    return stmt.all(`%${pathPattern}%`, ...this._entityVisibilityParams());
  }

  async expandGraph(entityIds, maxHops = GRAPH_CONFIG.expansion.maxHops) {
    await this.init();

    const expanded = new Map();
    let frontier = new Set(entityIds);

    for (let hop = 0; hop < maxHops; hop++) {
      const nextFrontier = new Set();

      const frontierIds = Array.from(frontier).filter(id => !expanded.has(id));
      if (frontierIds.length === 0) break;

      assertInClauseSize(frontierIds.length, 'graph-search.frontier-fetch');
      const placeholders = frontierIds.map(() => '?').join(',');
      const entities = this.db.prepare(`
        SELECT * FROM entities
        WHERE id IN (${placeholders})
        AND ${this._entityVisibilitySql('')}
      `).all(...frontierIds, ...this._entityVisibilityParams());

      const entityMap = new Map(entities.map(e => [e.id, e]));

      // The UNION ALL binds `frontierIds` twice in one prepared statement, so the
      // SQLite-parameter ceiling is reached at half the array length — guard the
      // actual bind count, not the array length.
      assertInClauseSize(2 * frontierIds.length, 'graph-search.frontier-relationships (double-bind UNION)');
      const relationships = this.db.prepare(`
        SELECT r.*, 'out' as direction, r.source_id as origin_id
        FROM relationships r
        JOIN entities e ON r.target_id = e.id
        WHERE r.source_id IN (${placeholders})
        AND ${this._entityVisibilitySql('e')}
        AND ${this._relationshipVisibilitySql('r')}
        UNION ALL
        SELECT r.*, 'in' as direction, r.target_id as origin_id
        FROM relationships r
        JOIN entities e ON r.source_id = e.id
        WHERE r.target_id IN (${placeholders})
        AND ${this._entityVisibilitySql('e')}
        AND ${this._relationshipVisibilitySql('r')}
      `).all(
        ...frontierIds,
        ...this._entityVisibilityParams(),
        ...this._relationshipVisibilityParams(),
        ...frontierIds,
        ...this._entityVisibilityParams(),
        ...this._relationshipVisibilityParams(),
      );

      const relMap = new Map();
      for (const rel of relationships) {
        const key = rel.origin_id;
        if (!relMap.has(key)) relMap.set(key, []);
        relMap.get(key).push(rel);
      }

      for (const entityId of frontierIds) {
        const entity = entityMap.get(entityId);
        if (entity) {
          expanded.set(entityId, {
            ...entity,
            hop,
            source: hop === 0 ? 'direct' : 'graph',
          });
        }

        const related = relMap.get(entityId) || [];
        for (const rel of related) {
          const relatedId = rel.direction === 'out' ? rel.target_id : rel.source_id;
          if (relatedId && !expanded.has(relatedId) && !frontier.has(relatedId)) {
            nextFrontier.add(relatedId);
          }
        }
      }

      frontier = nextFrontier;
      if (frontier.size === 0) break;
    }

    return Array.from(expanded.values());
  }

  async getEntity(entityId) {
    await this.init();
    return this._stmtEntityById.get(entityId, ...this._entityVisibilityParams()) || null;
  }

  async getRelated(entityId) {
    await this.init();

    const results = [];

    const outRows = this._stmtOutRels.all(
      entityId,
      ...this._entityVisibilityParams(),
      ...this._relationshipVisibilityParams(),
    );
    for (const row of outRows) {
      results.push({
        ...row,
        direction: 'outgoing',
      });
    }

    const inRows = this._stmtInRels.all(
      entityId,
      entityId,
      ...this._entityVisibilityParams(),
      ...this._relationshipVisibilityParams(),
    );
    for (const row of inRows) {
      results.push({
        ...row,
        direction: 'incoming',
      });
    }

    return results;
  }

  /**
   * Check if query is an exact match for top result (used for adaptive expansion).
   * Skips expensive graph traversal when we have a clear winner.
   * @param {Object} [secondResult] - Optional second result for score gap comparison
   * @returns {boolean} True if top result is an exact/near-exact match
   */
  isExactMatchResult(query, topResult, secondResult = null) {
    if (!topResult) return false;

    const queryLower = query.toLowerCase().trim();
    const nameLower = (topResult.name || '').toLowerCase();

    if (nameLower === queryLower) {
      return true;
    }

    // Criterion 2: High absolute score (BM25 > 30 indicates strong match)
    if (topResult.score > 30.0) {
      return true;
    }

    if (secondResult && topResult.score >= secondResult.score * 2) {
      return true;
    }

    // Criterion 4: Query is a camelCase/PascalCase identifier that matches name
    // e.g., "AuthService" matching "AuthService" or "AuthenticationService"
    if (/^[A-Z][a-zA-Z0-9]*$/.test(query) && nameLower.includes(queryLower)) {
      return true;
    }

    return false;
  }

  log(message) {
    if (process.env.DEBUG_GRAPH_SEARCH) {
      console.error(`[GraphSearch] ${message}`);
    }
  }

  /**
   * ADAPTIVE EXPANSION: Skips expensive graph expansion when BM25 returns
   * a high-confidence exact match, making "hits" as fast as "misses" (<10ms).
   *
   * DEFINITION-FIRST (Strategy #2): For identifier queries, uses two-pass search
   * to guarantee definition files appear in top-3 results.
   */
  async graphExpandedSearch(query, options = {}) {
    const {
      k = 10,
      expand = true,
      maxHops = GRAPH_CONFIG.expansion.maxHops,
      maxExpanded = GRAPH_CONFIG.expansion.maxExpanded,
      skipExpansionForExactMatch = true, // Adaptive expansion (default: enabled)
      useDefinitionFirst = null, // Auto-detect if null, force on/off if boolean
      skipBoosts = false, // Skip ranking boosts (for fair hybrid fusion)
      deferExpansion = false, // When true, ambiguous queries skip internal expansion (lexical-only path)
      format, // Output format: agent formats also match entity doc comments
    } = options;

    const start = Date.now();

    // STRATEGY #2: Use definition-first search for identifier queries
    // This ensures "AuthService" returns AuthService.java at position 1
    const shouldUseDefinitionFirst = useDefinitionFirst ?? this.isIdentifierQuery(query);

    if (shouldUseDefinitionFirst) {
      this.log(`Using definition-first search for identifier query: "${query}"`);

      const { results: definitionResults, stats: defStats } = await this.hybridDefinitionSearch(query, { k, limit: 20, skipBoosts, format });

      if (definitionResults.length > 0 && expand) {
        const topResult = definitionResults[0];
        const secondResult = definitionResults[1] || null;
        const isExactMatch = skipExpansionForExactMatch &&
          this.isExactMatchResult(query, topResult, secondResult);

        if (isExactMatch) {
          this.log(`Skipping graph expansion: exact definition match found (${topResult.name})`);
          return {
            results: definitionResults.slice(0, k),
            stats: {
              bm25_ms: defStats.fts5_latency_ms,
              definition_ms: defStats.latency_ms,
              graph_ms: 0,
              total_ms: Date.now() - start,
              direct_matches: definitionResults.length,
              expanded_total: definitionResults.length,
              mode: 'definition_first_exact',
              confidence: 'exact',
              definition_count: defStats.definition_count,
              skipped_expansion: true,
            },
          };
        }

        if (deferExpansion) {
          // Lexical-only path: defer expansion to postprocess expandResults()
          // (adaptive hop2, alpha decay, degree normalization, cosine scoring)
          this.log(`Definition-first ambiguous: deferring expansion to postprocess`);
          return {
            results: definitionResults.slice(0, k),
            stats: {
              bm25_ms: defStats.fts5_latency_ms,
              definition_ms: defStats.latency_ms,
              graph_ms: 0,
              total_ms: Date.now() - start,
              direct_matches: definitionResults.length,
              expanded_total: definitionResults.length,
              mode: 'definition_first_ambiguous',
              confidence: 'ambiguous',
              definition_count: defStats.definition_count,
              skipped_expansion: true,
            },
          };
        }

        const graphStart = Date.now();
        const expanded = new Map();

        for (const result of definitionResults) {
          expanded.set(result.id, { ...result, source: result.source || 'definition_pass' });
        }

        const entityIds = definitionResults.map(r => r.id);
        for (let hop = 1; hop <= maxHops && expanded.size < maxExpanded; hop++) {
          for (const entityId of entityIds.slice(0, 5)) {
            const related = await this.getRelated(entityId);

            for (const rel of related) {
              if (!expanded.has(rel.id)) {
                const relMultiplier = this.getRelTypeMultiplier(rel.rel_type);
                const parentResult = definitionResults.find(r => r.id === entityId);
                const relScore = (parentResult?.score || 1) * rel.rel_weight * relMultiplier * 0.8;

                expanded.set(rel.id, {
                  id: rel.id,
                  file: rel.file_path,
                  type: rel.type,
                  name: rel.name,
                  signature: rel.signature,
                  docComment: usesDocComments(format) ? rel.doc_comment : null,
                  startLine: rel.start_line,
                  endLine: rel.end_line,
                  score: relScore,
                  relType: rel.rel_type,
                  source: 'graph',
                  hop,
                });
              }
            }
          }
        }

        const graphLatency = Date.now() - graphStart;
        const ranked = Array.from(expanded.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, k);

        return {
          results: ranked,
          stats: {
            bm25_ms: defStats.fts5_latency_ms,
            definition_ms: defStats.latency_ms,
            graph_ms: graphLatency,
            total_ms: Date.now() - start,
            direct_matches: definitionResults.length,
            expanded_total: expanded.size,
            mode: 'definition_first_graph',
            confidence: 'ambiguous',
            definition_count: defStats.definition_count,
            skipped_expansion: false,
          },
        };
      }

      return {
        results: definitionResults.slice(0, k),
        stats: {
          bm25_ms: defStats.fts5_latency_ms,
          definition_ms: defStats.latency_ms,
          graph_ms: 0,
          total_ms: Date.now() - start,
          direct_matches: definitionResults.length,
          expanded_total: definitionResults.length,
          mode: 'definition_first_only',
          confidence: 'exact',
          definition_count: defStats.definition_count,
          skipped_expansion: true,
        },
      };
    }

    // Pass skipBoosts for fair hybrid fusion
    const { results: bm25Results, latency: bm25Latency } = await this.bm25Search(query, { limit: 20, skipBoosts, format });

    if (bm25Results.length === 0) {
      return {
        results: [],
        stats: {
          bm25_ms: bm25Latency,
          total_ms: Date.now() - start,
          mode: 'bm25_only',
          confidence: 'exact',
        },
      };
    }

    if (!expand) {
      return {
        results: bm25Results.slice(0, k),
        stats: {
          bm25_ms: bm25Latency,
          total_ms: Date.now() - start,
          mode: 'bm25_only',
          confidence: 'exact',
        },
      };
    }

    // ADAPTIVE EXPANSION: Skip graph traversal for exact matches
    // This prevents "hits" from being slower than "misses"
    const topResult = bm25Results[0];
    const secondResult = bm25Results[1] || null;
    const isExactMatch = skipExpansionForExactMatch &&
      this.isExactMatchResult(query, topResult, secondResult);

    if (isExactMatch) {
      this.log(`Skipping graph expansion: exact match found (${topResult.name}, score=${topResult.score.toFixed(2)})`);
      return {
        results: bm25Results.slice(0, k),
        stats: {
          bm25_ms: bm25Latency,
          graph_ms: 0,
          total_ms: Date.now() - start,
          direct_matches: bm25Results.length,
          expanded_total: bm25Results.length,
          mode: 'bm25_exact_match',
          confidence: 'exact',
          skipped_expansion: true,
        },
      };
    }

    if (deferExpansion) {
      // Lexical-only path: defer expansion to postprocess expandResults()
      this.log(`BM25 ambiguous: deferring expansion to postprocess`);
      return {
        results: bm25Results.slice(0, k),
        stats: {
          bm25_ms: bm25Latency,
          graph_ms: 0,
          total_ms: Date.now() - start,
          direct_matches: bm25Results.length,
          expanded_total: bm25Results.length,
          mode: 'bm25_ambiguous',
          confidence: 'ambiguous',
          skipped_expansion: true,
        },
      };
    }

    const graphStart = Date.now();
    const expanded = new Map();

    for (const result of bm25Results) {
      expanded.set(result.id, { ...result, source: 'direct' });
    }

    const entityIds = bm25Results.map(r => r.id);
    for (let hop = 1; hop <= maxHops && expanded.size < maxExpanded; hop++) {
      for (const entityId of entityIds.slice(0, 5)) {
        const related = await this.getRelated(entityId);

        for (const rel of related) {
          if (!expanded.has(rel.id)) {
            const relMultiplier = this.getRelTypeMultiplier(rel.rel_type);
            const parentResult = bm25Results.find(r => r.id === entityId);
            const relScore = (parentResult?.score || 1) * rel.rel_weight * relMultiplier * 0.8;

            expanded.set(rel.id, {
              id: rel.id,
              file: rel.file_path,
              type: rel.type,
              name: rel.name,
              signature: rel.signature,
              docComment: usesDocComments(format) ? rel.doc_comment : null,
              startLine: rel.start_line,
              endLine: rel.end_line,
              score: relScore,
              relType: rel.rel_type,
              source: 'graph',
              hop,
            });
          }
        }
      }
    }

    const graphLatency = Date.now() - graphStart;

    const ranked = Array.from(expanded.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return {
      results: ranked,
      stats: {
        bm25_ms: bm25Latency,
        graph_ms: graphLatency,
        total_ms: Date.now() - start,
        direct_matches: bm25Results.length,
        expanded_total: expanded.size,
        mode: 'bm25_graph',
        confidence: 'ambiguous',
        skipped_expansion: false,
      },
    };
  }

  /**
   * Higher values = more important relationships to follow.
   *
   * @param {string} relType - Relationship type ('calls', 'implements', 'extends', etc.)
   * @returns {number} Score multiplier (0.0 - 1.0)
   *
   * @example
   * getRelTypeMultiplier('implements')  // 0.9 - strong signal
   * getRelTypeMultiplier('calls')       // 0.7 - medium signal
   * getRelTypeMultiplier('unknown')     // 0.5 - fallback
   */
  getRelTypeMultiplier(relType) {
    const multipliers = {
      implements: 0.9,
      extends: 0.85,
      overrides: 0.8,
      calls: 0.7,
      throws: 0.6,
      uses: 0.5,
      imports: 0.3,
    };
    return multipliers[relType] || 0.5;
  }

  /**
   * Sanitize query for FTS5 (escape special characters)
   */
  sanitizeFtsQuery(query) {
    let sanitized = query.replace(/[":*^~()+\-]/g, ' ');

    const words = sanitized.trim().split(/\s+/).filter(w => w.length > 0);

    if (words.length === 1) {
      return `"${words[0]}"*`;
    }

    // Multiple words: use AND logic with prefix on last word
    return words.map((w, i) => {
      if (i === words.length - 1) {
        return `"${w}"*`;
      }
      return `"${w}"`;
    }).join(' ');
  }

  /**
   * Fix 8: Expand a code-shaped identifier into split-form FTS5 query.
   * Preserves the original as primary; this produces the secondary expanded form.
   *
   * @example
   * expandIdentifierQuery('getUserName') // '"get" "user" "name"*'
   * expandIdentifierQuery('UserService') // '"user" "service"*'
   */
  expandIdentifierQuery(query) {
    const split = query
      .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      .replace(/[_\-./:\\]/g, ' ');

    const parts = split.trim().split(/\s+/).filter(w => w.length > 0);
    if (parts.length <= 1) return null; // No expansion needed for single tokens

    return parts.map((w, i) => {
      const lower = w.toLowerCase();
      if (i === parts.length - 1) {
        return `"${lower}"*`;
      }
      return `"${lower}"`;
    }).join(' ');
  }

  /**
   * Fix 9: Expand abbreviations in a query using the curated dictionary.
   * Returns a grouped FTS5 query, or null if no expansions apply.
   * Single-word queries expand to OR groups; two-word queries preserve the
   * non-abbreviation term as an AND requirement to avoid noisy broad matches.
   */
  expandAbbreviations(query) {
    const sanitizedWords = query
      .replace(/[":*^~()+\-]/g, ' ')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    // Only expand single-word or two-word queries to avoid explosion
    if (sanitizedWords.length === 0 || sanitizedWords.length > 2) return null;

    let changed = false;
    const groups = sanitizedWords.map(word => {
      const variants = [word, ...(ABBREVIATION_EXPANSIONS[word] || [])];
      const uniqueVariants = [...new Set(variants)];
      if (uniqueVariants.length > 1) {
        changed = true;
      }

      const clauses = uniqueVariants.map(variant => `"${variant}"*`);
      return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
    });

    return changed ? groups.join(' ') : null;
  }

  /**
   * Check if query looks like an identifier (PascalCase, camelCase, or snake_case).
   * Used to decide whether to prioritize definition-first search.
   *
   *
   * @example
   * isIdentifierQuery('AuthService')     // true (PascalCase)
   * isIdentifierQuery('employeeService') // true (camelCase)
   * isIdentifierQuery('get_employee')    // true (snake_case)
   * isIdentifierQuery('how does auth work') // false (natural language)
   */
  isIdentifierQuery(query) {
    const trimmed = query.trim();
    if (/\s/.test(trimmed)) return false;

    // PascalCase: starts with uppercase, alphanumeric (AuthService, EmployeeDTO)
    if (/^[A-Z][a-zA-Z0-9]*$/.test(trimmed)) return true;

    // camelCase: starts with lowercase, has at least one uppercase (getUserById)
    if (/^[a-z][a-zA-Z0-9]*$/.test(trimmed) && /[A-Z]/.test(trimmed)) return true;

    // snake_case: lowercase with underscores (get_employee, user_id)
    if (/^[a-z][a-z0-9_]*$/.test(trimmed) && trimmed.includes('_')) return true;

    // Single lowercase word that could be a simple identifier (auth, user)
    if (/^[a-z][a-z0-9]*$/.test(trimmed) && trimmed.length >= 3) return true;

    return false;
  }

  /**
   * Check if query is a clearly code-shaped identifier suitable for name: field restriction.
   * More restrictive than isIdentifierQuery() — excludes generic single lowercase words
   * like "cache", "error", "token" that should search all fields.
   *
   * Matches: PascalCase, camelCase, snake_case, SCREAMING_SNAKE_CASE, dotted identifiers.
   */
  isStrictIdentifierQuery(query) {
    const trimmed = query.trim();
    if (/\s/.test(trimmed)) return false;

    // PascalCase: UserService, AuthDTO, HTMLParser (uppercase start, has at least one lowercase)
    if (/^[A-Z][a-zA-Z0-9]+$/.test(trimmed) && /[a-z]/.test(trimmed)) return true;

    // camelCase: getUserName, authService
    if (/^[a-z][a-zA-Z0-9]*$/.test(trimmed) && /[A-Z]/.test(trimmed)) return true;

    // snake_case: get_user_name
    if (/^[a-z][a-z0-9_]*$/.test(trimmed) && trimmed.includes('_')) return true;

    // SCREAMING_SNAKE_CASE: MAX_RETRIES
    if (/^[A-Z][A-Z0-9_]+$/.test(trimmed) && trimmed.includes('_')) return true;

    // All-uppercase code identifiers (2+ chars): JSON, URL, API, HTTP, IO
    if (/^[A-Z]{2,}$/.test(trimmed)) return true;

    // Dotted identifier: foo.bar.baz
    if (/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+$/.test(trimmed)) return true;

    return false;
  }

  /**
   * Runs two searches in parallel:
   * 1. Definition search: Find files where filename == query OR entity is class/interface with exact name
   * 2. Normal FTS5/BM25: Standard ranking
   *
   * Merges results with definition matches guaranteed in top positions.
   * This fixes the ranking problem where "AuthService" returns AuthService.java
   * at position 5 instead of position 1.
   *
   * @param {string} query - The search query
   * @param {Object} options - Search options
   * @param {number} [options.k=10] - Number of results to return
   * @param {number} [options.limit=20] - FTS5 search limit
   * @param {boolean} [options.skipBoosts=false] - Skip ranking boosts (for fair hybrid fusion)
   * @returns {Promise<Object>} Merged results with definitions prioritized
   */
  async hybridDefinitionSearch(query, options = {}) {
    await this.init();

    const { k = 10, limit = 20, skipBoosts = false, format } = options;
    const queryLower = query.toLowerCase();
    const start = Date.now();

    const definitionPromise = new Promise((resolve) => {
      try {
        // Search for entities where:
        // - Entity name exactly matches query (case-insensitive)
        // - Entity is a top-level definition type (class, interface, function, etc.)
        // - Only match primary definitions, not methods inside files
        const stmt = this.db.prepare(`
          SELECT
            e.*,
            100.0 as definition_boost,
            CASE
              WHEN LOWER(e.name) = ? THEN 1
              WHEN LOWER(e.name) LIKE ? || '%' THEN 2
              ELSE 3
            END as match_priority
          FROM entities e
          WHERE (
            -- Entity name exactly matches query
            LOWER(e.name) = ?
            OR
            -- Entity name starts with query (prefix match for partial identifiers)
            LOWER(e.name) LIKE ? || '%'
          )
          -- Only match top-level definition types, not methods
          AND e.type IN ('class', 'interface', 'struct', 'enum', 'function', 'type', 'component', 'object', 'actor')
          AND ${this._entityVisibilitySql('e')}
          ORDER BY
            match_priority,
            CASE e.type
              WHEN 'class' THEN 0
              WHEN 'object' THEN 0
              WHEN 'actor' THEN 0
              WHEN 'interface' THEN 1
              WHEN 'function' THEN 2
              WHEN 'component' THEN 3
              ELSE 4
            END,
            length(e.name)
          LIMIT 5
        `);
        const rows = stmt.all(
          queryLower,
          queryLower,
          queryLower,
          queryLower,
          ...this._entityVisibilityParams(),
        );
        resolve(rows);
      } catch (err) {
        this.log(`Definition search error: ${err.message}`);
        resolve([]);
      }
    });

    // Pass skipBoosts through for fair hybrid fusion
    const fts5Promise = this.bm25Search(query, { limit, skipBoosts, format });

    const [definitionResults, fts5Result] = await Promise.all([definitionPromise, fts5Promise]);

    const latency = Date.now() - start;
    this.log(`hybridDefinitionSearch: ${definitionResults.length} definitions, ${fts5Result.results.length} FTS5 in ${latency}ms`);

    const merged = this.mergeWithDefinitionPriority(definitionResults, fts5Result.results, k, format);

    return {
      results: merged,
      stats: {
        definition_count: definitionResults.length,
        fts5_count: fts5Result.results.length,
        latency_ms: latency,
        fts5_latency_ms: fts5Result.latency,
      },
    };
  }

  /**
   * Definitions are guaranteed in top positions, followed by deduplicated FTS5 results.
   *
   * @param {string} [format] - Output format (agent formats keep doc comments)
   * @returns {Array} Merged and deduplicated results
   */
  mergeWithDefinitionPriority(definitions, fts5Results, k = 10, format) {
    const seen = new Set();
    const merged = [];

    for (const def of definitions) {
      const key = `${def.file_path}:${def.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({
          id: def.id,
          file: def.file_path,
          type: def.type,
          name: def.name,
          signature: def.signature,
          docComment: usesDocComments(format) ? def.doc_comment : null,
          startLine: def.start_line,
          endLine: def.end_line,
          package: def.package,
          parentClass: def.parent_class,
          score: (def.score || 0) + (def.definition_boost || 100),
          source: 'definition_pass',
          isDefinition: true,
        });
      }
    }

    for (const result of fts5Results) {
      const key = `${result.file}:${result.name}`;
      if (!seen.has(key) && merged.length < k * 2) {
        seen.add(key);
        merged.push({
          ...result,
          isDefinition: false,
        });
      }
    }

    return merged.slice(0, k);
  }

  /**
   * Resolve `entityName` to a single target entity row.
   *
   * Substring fallback (`name LIKE '%X%'`) is preserved so callers like
   * `findCallers("HttpClient")` still resolve when only `MyHttpClient`
   * exists in the index. But exact matches now sort first; otherwise short
   * names like `Vec` silently resolved to substring siblings like
   * `AlignedVector` because the prior `LIMIT 1` had no preference order.
   */
  _resolveStructuralTarget(entityName) {
    return this.db.prepare(`
      SELECT id, name, type, file_path FROM entities
      WHERE (name = ? OR name LIKE ?)
        AND ${this._entityVisibilitySql('')}
      ORDER BY
        CASE WHEN name = ? THEN 0 ELSE 1 END,
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        CASE type
          WHEN 'class' THEN 0 WHEN 'struct' THEN 0 WHEN 'trait' THEN 0 WHEN 'object' THEN 0 WHEN 'actor' THEN 0
          WHEN 'interface' THEN 1 WHEN 'enum' THEN 1 WHEN 'type' THEN 1 WHEN 'typeAlias' THEN 1
          WHEN 'function' THEN 2 WHEN 'method' THEN 2
          ELSE 3
        END,
        length(name) ASC
      LIMIT 1
    `).get(entityName, `%${entityName}%`, ...this._entityVisibilityParams(), entityName);
  }

  async findCallers(entityName, options = {}) {
    await this.init();
    const { limit = 50 } = options;

    const target = this._resolveStructuralTarget(entityName);

    if (!target) return { results: [], stats: { found: false, query: entityName } };

    // e.g., "EmployeeService" -> "employeeService.%" to match "employeeService.getEmployee"
    const lowerCamelCase = target.name.charAt(0).toLowerCase() + target.name.slice(1);
    const targetNamePattern = `${lowerCamelCase}.%`;

    // Match by target_id (resolved) OR target_name pattern (unresolved)
    const callersFrom = (source) => this.db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
        r.context_line as call_line, r.target_name
      FROM relationships r
      JOIN ${source} e ON e.id = r.source_id
      WHERE r.type = 'calls' AND (
        r.target_id = ?
        OR r.target_name LIKE ?
        OR r.target_name LIKE ?
      )
        AND ${this._entityVisibilitySql('e')}
        AND ${this._relationshipVisibilitySql('r')}
      ORDER BY e.file_path, r.context_line
      LIMIT ?
    `).all(
      target.id,
      targetNamePattern,
      `${target.name}.%`,
      ...this._entityVisibilityParams(),
      ...this._relationshipVisibilityParams(),
      limit,
    );
    let callers = callersFrom('entities');
    // Calls from top-level code have the file node as their source
    // (file-nodes.js): `(top-level)` rows at the call line.
    const top = callersFrom(fileNodeSourceSql()).map(row => asTopLevelCaller(row, row.call_line));
    if (top.length > 0) {
      callers = [...callers, ...top]
        .sort((a, b) => String(a.file_path).localeCompare(String(b.file_path)) || ((a.call_line ?? 0) - (b.call_line ?? 0)))
        .slice(0, limit);
    }

    return {
      results: callers.map(c => ({
        ...c,
        relationship: 'calls',
        depth: 1,
      })),
      stats: { targetEntity: target.name, targetType: target.type, totalCallers: callers.length },
    };
  }

  async findCallees(entityName, options = {}) {
    await this.init();
    const { limit = 50 } = options;

    const source = this._resolveStructuralTarget(entityName);

    if (!source) return { results: [], stats: { found: false } };

    const callees = this.db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
        r.context_line as call_line, r.target_name
      FROM relationships r
      LEFT JOIN entities e ON e.id = r.target_id OR e.name = r.target_name
      WHERE r.source_id = ? AND r.type = 'calls'
        AND ${this._entityVisibilitySql('e', { allowNullJoined: true })}
        AND ${this._relationshipVisibilitySql('r')}
      ORDER BY r.context_line
      LIMIT ?
    `).all(
      source.id,
      ...this._entityVisibilityParams(),
      ...this._relationshipVisibilityParams(),
      limit,
    );

    return {
      results: callees.map(row => {
        return {
          id: row.id,
          name: row.name || row.target_name,
          type: row.type || 'external',
          file_path: row.file_path,
          start_line: row.start_line,
          signature: row.signature,
          call_line: row.call_line,
          relationship: 'calls',
        };
      }),
      stats: { sourceEntity: source.name, totalCallees: callees.length },
    };
  }

  async findImplementations(interfaceName, options = {}) {
    await this.init();
    const { limit = 50 } = options;

    const implementations = this.db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
        r.type as rel_type
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE (r.target_name = ? OR r.target_name LIKE ?)
        AND r.type IN ('implements', 'extends')
        AND ${this._entityVisibilitySql('e')}
        AND ${this._relationshipVisibilitySql('r')}
      ORDER BY e.name
      LIMIT ?
    `).all(
      interfaceName,
      `%${interfaceName}%`,
      ...this._entityVisibilityParams(),
      ...this._relationshipVisibilityParams(),
      limit,
    );

    return {
      results: implementations.map(i => ({
        ...i,
        relationship: i.rel_type,
      })),
      stats: { targetInterface: interfaceName, totalImplementations: implementations.length },
    };
  }

  /**
   * Impact analysis - what depends on this entity?
   */
  async findImpact(entityName, options = {}) {
    await this.init();
    const { maxDepth = 3, limit = 100 } = options;

    const target = this._resolveStructuralTarget(entityName);

    if (!target) return { results: [], stats: { found: false } };

    const impacted = new Map();
    let frontier = [target.id];
    // Dependents in top-level code are the file's node (file-nodes.js). A
    // file node is a leaf here: nothing calls a script body.
    const withTopLevel = (run) => {
      const rows = run('entities');
      return [...rows, ...run(fileNodeSourceSql()).map(row => asTopLevelCaller(row, null))];
    };

    // For depth 1, also match on target_name pattern (e.g., "employeeService.getEmployee")
    const targetNamePattern = target.name.charAt(0).toLowerCase() + target.name.slice(1) + '.%';

    for (let depth = 1; depth <= maxDepth && impacted.size < limit; depth++) {
      if (frontier.length === 0) break;

      assertInClauseSize(frontier.length, 'graph-search.impact-frontier');
      const placeholders = frontier.map(() => '?').join(',');
      let dependents;

      if (depth === 1) {
        // First depth: match by target_id OR target_name pattern (for instance.method() calls)
        dependents = withTopLevel((source) => this.db.prepare(`
          SELECT DISTINCT
            e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
            r.type as rel_type
          FROM relationships r
          JOIN ${source} e ON e.id = r.source_id
          WHERE (r.target_id IN (${placeholders}) OR (r.target_name LIKE ? AND r.type != 'importsFile'))
            AND ${this._entityVisibilitySql('e')}
            AND ${this._relationshipVisibilitySql('r')}
          LIMIT 50
        `).all(
          ...frontier,
          targetNamePattern,
          ...this._entityVisibilityParams(),
          ...this._relationshipVisibilityParams(),
        ));
      } else {
        // Subsequent depths: only match by target_id
        dependents = withTopLevel((source) => this.db.prepare(`
          SELECT DISTINCT
            e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
            r.type as rel_type
          FROM relationships r
          JOIN ${source} e ON e.id = r.source_id
          WHERE r.target_id IN (${placeholders})
            AND ${this._entityVisibilitySql('e')}
            AND ${this._relationshipVisibilitySql('r')}
          LIMIT 50
        `).all(...frontier, ...this._entityVisibilityParams(), ...this._relationshipVisibilityParams()));
      }

      const nextFrontier = [];
      for (const dep of dependents) {
        if (!impacted.has(dep.id) && dep.id !== target.id) {
          impacted.set(dep.id, {
            ...dep,
            relationship: dep.rel_type,
            depth,
            riskScore: (4 - depth) / 3, // Higher for closer dependencies
          });
          if (dep.type !== 'file') nextFrontier.push(dep.id);
        }
      }
      frontier = nextFrontier.slice(0, 20); // Limit branching
    }

    const results = Array.from(impacted.values()).sort((a, b) => b.riskScore - a.riskScore);
    return {
      results,
      stats: {
        targetEntity: target.name,
        totalImpacted: results.length,
        highRisk: results.filter(r => r.depth === 1).length,
      },
    };
  }

  async getStats() {
    await this.init();

    const entityCount = this.db.prepare('SELECT COUNT(*) as count FROM entities').get()?.count || 0;
    const relCount = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get()?.count || 0;

    const typeCounts = {};
    const typeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM entities GROUP BY type').all();
    for (const row of typeRows) {
      typeCounts[row.type] = row.count;
    }

    const relTypeCounts = {};
    const relTypeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM relationships GROUP BY type').all();
    for (const row of relTypeRows) {
      relTypeCounts[row.type] = row.count;
    }

    return {
      entities: entityCount,
      relationships: relCount,
      entityTypes: typeCounts,
      relationshipTypes: relTypeCounts,
      hasFts5: this.hasFts5,
      hasTrigram: this.hasTrigram,
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Graph-Expanded Search (better-sqlite3 + FTS5 trigram)

Usage:
  graph-search.js <query> [options]

Options:
  --no-expand           Disable graph expansion (BM25 only)
  --force-expand        Force graph expansion even for exact matches
  --no-definition-first Disable definition-first search for identifier queries
  --top <n>             Number of results (default: 10)
  --stats               Show database statistics
  --json                Output as JSON

Definition-First Search (Strategy #2):
  For identifier queries (PascalCase, camelCase, snake_case), a two-pass
  search runs in parallel:
    1. Definition search: Find files where filename or entity name matches
    2. Standard FTS5/BM25 search
  Definition results are guaranteed in top positions.
  Use --no-definition-first to disable this behavior.

Adaptive Expansion:
  By default, graph expansion is SKIPPED for exact identifier matches
  (e.g., "AuthService" finds AuthService.java with score 50.0).
  This keeps lexical hits as fast as misses (<10ms).
  Use --force-expand to always perform graph traversal.

Examples:
  graph-search.js "AuthService"                   # Definition-first search (<10ms)
  graph-search.js "authentication" --top 20       # Conceptual query (may expand)
  graph-search.js "LoginService" --no-expand      # BM25 only
  graph-search.js "AuthService" --force-expand    # Force graph traversal
  graph-search.js "AuthService" --no-definition-first  # Standard BM25 ranking
  graph-search.js --stats

Environment:
  DEBUG_GRAPH_SEARCH=1  Enable debug logging for expansion decisions
`);
    process.exit(0);
  }

  let query = '';
  let expand = true;
  let forceExpand = false;
  let useDefinitionFirst = null; // Auto-detect
  let top = 10;
  let showStats = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-expand') {
      expand = false;
    } else if (args[i] === '--force-expand') {
      forceExpand = true;
    } else if (args[i] === '--no-definition-first') {
      useDefinitionFirst = false;
    } else if (args[i] === '--definition-first') {
      useDefinitionFirst = true;
    } else if (args[i] === '--top' && args[i + 1]) {
      top = parseInt(args[++i], 10);
    } else if (args[i] === '--stats') {
      showStats = true;
    } else if (args[i] === '--json') {
      json = true;
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }

  (async () => {
    const searcher = new GraphSearch();

    try {
      if (showStats) {
        const stats = await searcher.getStats();
        console.log(json ? JSON.stringify(stats, null, 2) : stats);
        return;
      }

      if (!query) {
        console.error('Error: Query required');
        process.exit(1);
      }

      const { results, stats } = await searcher.graphExpandedSearch(query, {
        k: top,
        expand,
        skipExpansionForExactMatch: !forceExpand, // Override adaptive behavior
        useDefinitionFirst, // Pass through (null = auto-detect)
      });

      if (json) {
        console.log(JSON.stringify({ results, stats }, null, 2));
      } else {
        console.log(`\nGraph Search Results for: "${query}"`);
        const expansionInfo = stats.skipped_expansion ? ' (expansion skipped: exact match)' : '';
        const defInfo = stats.definition_count != null ? ` | Definitions: ${stats.definition_count}` : '';
        console.log(`Mode: ${stats.mode}${expansionInfo}${defInfo} | BM25: ${stats.bm25_ms}ms | Graph: ${stats.graph_ms || 0}ms | Total: ${stats.total_ms}ms`);
        console.log('='.repeat(80));

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          console.log(`\n${i + 1}. ${r.name} (${r.type})`);
          console.log(`   File: ${r.file}:${r.startLine}`);
          console.log(`   Score: ${r.score?.toFixed(4)} | Source: ${r.source}${r.relType ? ` via ${r.relType}` : ''}`);
          if (r.signature) {
            console.log(`   ${r.signature.slice(0, 80)}${r.signature.length > 80 ? '...' : ''}`);
          }
        }
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      searcher.close();
    }
  })();
}

export { GraphSearch as default };
