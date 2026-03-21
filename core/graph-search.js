#!/usr/bin/env node

/**
 * Graph-Expanded Search
 *
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
import { DB_PATHS, GRAPH_CONFIG } from './config.js';
import { applyReadPragmas } from './db-utils.js';
import { detectIntent, getIntentBoost } from './intent-detector.js';
import { applyMMR, shouldApplyMMR } from './mmr.js';
import { SYMBOL_KIND_WEIGHTS, DEFINITION_TYPES } from './constants.js';

// Fix 9: Abbreviation expansion dictionary for common software abbreviations
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

// =============================================================================
// GRAPH SEARCH CLASS
// =============================================================================

export class GraphSearch {
  constructor(dbPath = DB_PATHS.codeGraph) {
    this.dbPath = dbPath;
    this.db = null;
    this.hasFts5 = false;
    this.hasTrigram = false;
  }

  /**
   * Initialize database connection (synchronous with better-sqlite3)
   */
  async init() {
    if (this.db) return;

    if (!existsSync(this.dbPath)) {
      throw new Error(`Code graph database not found at ${this.dbPath}. Run graph indexing first.`);
    }

    // Use better-sqlite3 for native FTS5 with trigram support
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(this.dbPath, { readonly: true });

    try {
      applyReadPragmas(db, { tempStoreMemory: true });

      // Check if FTS5 tables exist
      try {
        const ftsCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'").get();
        this.hasFts5 = !!ftsCheck;

        const trigramCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities_trigram'").get();
        this.hasTrigram = !!trigramCheck;
      } catch {
        this.hasFts5 = false;
        this.hasTrigram = false;
      }

      // Detect FTS5 column count to warn about schema mismatches with old databases.
      // The bm25() weights are positional — wrong column count produces wrong ranking.
      if (this.hasFts5) {
        try {
          const ftsColInfo = db.prepare("SELECT * FROM entities_fts LIMIT 0").columns();
          this._ftsColumnCount = ftsColInfo.length;
          const expectedCols = 4; // name, name_alias, signature, doc_comment
          if (this._ftsColumnCount !== expectedCols) {
            console.warn(
              `[GraphSearch] FTS5 schema mismatch: expected ${expectedCols} columns, found ${this._ftsColumnCount}. ` +
              `BM25 weights will be misaligned. Run \`/index-codebase --full\` to rebuild.`
            );
          }
        } catch {
          // Non-fatal — continue with FTS5
        }
      }

      // Cache hot-path prepared statements (eliminates ~8-9µs per prepare() call)
      // Prepare failures on optional FTS paths should degrade to existing fallbacks.
      if (this.hasFts5) {
        try {
          this._stmtFts5 = db.prepare(`
            SELECT
              e.id, e.file_path, e.type, e.name, e.signature,
              e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
              bm25(entities_fts, 10.0, 4.0, 5.0, 1.0) AS score
            FROM entities_fts
            JOIN entities e ON entities_fts.rowid = e.rowid
            WHERE entities_fts MATCH ?
              AND e.stale_since IS NULL
            ORDER BY score
            LIMIT ?
          `);
        } catch {
          this.hasFts5 = false;
          this._stmtFts5 = null;
        }
      }

      if (this.hasTrigram) {
        try {
          this._stmtTrigram = db.prepare(`
            SELECT
              e.id, e.file_path, e.type, e.name, e.signature,
              e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
              bm25(entities_trigram, 10.0, 3.0) AS score
            FROM entities_trigram
            JOIN entities e ON entities_trigram.rowid = e.rowid
            WHERE entities_trigram MATCH ?
              AND e.stale_since IS NULL
            ORDER BY score
            LIMIT ?
          `);
        } catch {
          this.hasTrigram = false;
          this._stmtTrigram = null;
        }
      }

      this._stmtEntityById = db.prepare(
        'SELECT * FROM entities WHERE id = ? AND stale_since IS NULL'
      );

      this._stmtOutRels = db.prepare(`
        SELECT e.*, r.type as rel_type, r.weight as rel_weight
        FROM relationships r
        JOIN entities e ON e.id = r.target_id OR e.name = r.target_name
        WHERE r.source_id = ?
          AND e.stale_since IS NULL
        LIMIT 20
      `);

      this._stmtInRels = db.prepare(`
        SELECT e.*, r.type as rel_type, r.weight as rel_weight
        FROM relationships r
        JOIN entities e ON e.id = r.source_id
        WHERE (r.target_id = ? OR r.target_name = (SELECT name FROM entities WHERE id = ?))
          AND e.stale_since IS NULL
        LIMIT 20
      `);

      this.db = db;
    } catch (err) {
      this.hasFts5 = false;
      this.hasTrigram = false;
      this._stmtFts5 = null;
      this._stmtTrigram = null;
      this._stmtEntityById = null;
      this._stmtOutRels = null;
      this._stmtInRels = null;
      db.close();
      throw err;
    }
  }

  /**
   * Map a raw FTS5/trigram/LIKE row to a search result object.
   */
  _mapRow(row, source, scoreMultiplier = 1.0) {
    return {
      id: row.id,
      file: row.file_path,
      type: row.type,
      name: row.name,
      signature: row.signature,
      docComment: row.doc_comment,
      startLine: row.start_line,
      endLine: row.end_line,
      package: row.package,
      parentClass: row.parent_class,
      score: Math.abs(row.score) * scoreMultiplier,
      source,
    };
  }

  /**
   * Merge new rows into results, deduplicating by id.
   */
  _mergeRows(results, rows, source, scoreMultiplier = 1.0) {
    const existingIds = new Set(results.map(r => r.id));
    for (const row of rows) {
      if (!existingIds.has(row.id)) {
        results.push(this._mapRow(row, source, scoreMultiplier));
        existingIds.add(row.id);
      }
    }
  }

  /**
   * LIKE-based fallback search (used when FTS5 is unavailable or returns no results).
   */
  _likeFallback(results, query, limit, source = 'like') {
    const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const likeConditions = searchTerms.map(() => 'search_text LIKE ?').join(' AND ');
    const likeParams = searchTerms.map(t => `%${t}%`);

    const stmt = this.db.prepare(`
      SELECT
        id, file_path, type, name, signature, doc_comment,
        start_line, end_line, package, parent_class, search_text
      FROM entities
      WHERE ${likeConditions || '1=1'}
        AND stale_since IS NULL
      ORDER BY
        CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
        length(name)
      LIMIT ?
    `);

    const rows = stmt.all(...likeParams, `%${query}%`, limit);

    let rank = 0;
    for (const row of rows) {
      rank++;
      const nameMatch = row.name.toLowerCase().includes(query.toLowerCase()) ? 2 : 0;
      const exactMatch = row.name.toLowerCase() === query.toLowerCase() ? 5 : 0;
      row.score = -(10 - rank * 0.1 + nameMatch + exactMatch);
      const mapped = this._mapRow(row, source);
      mapped.score = Math.max(0.1, mapped.score);
      results.push(mapped);
    }
  }

  /**
   * Fix 11: Compute lexical path observability metadata.
   */
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
   * Close database connection
   */
  close() {
    this._stmtFts5 = null;
    this._stmtTrigram = null;
    this._stmtEntityById = null;
    this._stmtOutRels = null;
    this._stmtInRels = null;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Fast text search (FTS5 with trigram fuzzy + LIKE fallback)
   *
   * @param {string} query - Search query
   * @param {Object|number} options - Options object or limit (for backwards compat)
   * @param {number} [options.limit=20] - Maximum results to return
   * @param {boolean} [options.skipBoosts=false] - Skip post-FTS5 ranking boosts (for fair hybrid fusion)
   * @returns {Promise<{results: Array, latency: number}>}
   */
  async bm25Search(query, options = {}) {
    // Support legacy signature: bm25Search(query, limit)
    const opts = typeof options === 'number' ? { limit: options } : options;
    const { limit = 20, skipBoosts = false } = opts;
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
          rows = this._stmtFts5.all(`name : ${this.sanitizeFtsQuery(query)}`, limit);
        } catch (err) {
          this.log(`[bm25Search] Name-restricted FTS5 query failed: ${err.message}`);
          rows = [];
        }
      }

      // Fall back to unrestricted FTS5 if name-restricted returned nothing
      if (rows.length === 0) {
        restrictedFallback = restrictedAttempted;
        try {
          rows = this._stmtFts5.all(this.sanitizeFtsQuery(query), limit);
        } catch (err) {
          this.log(`[bm25Search] FTS5 query failed: ${err.message}`);
          rows = [];
        }
      }

      for (const row of rows) {
        results.push(this._mapRow(row, 'fts5'));
      }
    }

    // Try trigram fuzzy search if standard FTS5 returned few results
    // This enables "Auth" → "AuthenticationService" matching
    if (this.hasTrigram && results.length < 3 && query.length >= 3) {
      try {
        // Trigram search - just use the raw query (trigram handles substrings)
        const escaped = query.replace(/"/g, '""');
        const trigramRows = this._stmtTrigram.all(`"${escaped}"`, limit);

        this._mergeRows(results, trigramRows, 'trigram', 0.9);
      } catch (err) {
        this.log(`[bm25Search] Trigram query failed: ${err.message}`);
      }
    }

    // Fix 8: Identifier variant expansion — run secondary expanded query for code-shaped identifiers
    if (this.hasFts5 && results.length < 5 && this.isStrictIdentifierQuery(query)) {
      try {
        const expandedForm = this.expandIdentifierQuery(query);
        if (expandedForm && expandedForm !== this.sanitizeFtsQuery(query)) {
          const expandedRows = this._stmtFts5.all(expandedForm, limit);
          this._mergeRows(results, expandedRows, 'fts5_expanded', 0.85);
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
          const abbrRows = this._stmtFts5.all(abbrQuery, limit);
          this._mergeRows(results, abbrRows, 'fts5_abbr', 0.8);
        }
      } catch (err) {
        this.log(`[bm25Search] Abbreviation expansion failed: ${err.message}`);
      }
    }

    if (!this.hasFts5 || results.length === 0) {
      this._likeFallback(results, query, limit, 'like');
    }

    const latency = Date.now() - start;

    // Apply post-FTS5 ranking boosts (Strategies #1, #19, #4, #20)
    // Skip boosts if skipBoosts=true (for fair hybrid fusion - boosts applied post-fusion)
    const finalResults = skipBoosts ? results : this.applyRankingBoosts(results, query);

    // Fix 11: Lexical path observability
    const { searchQuality, lexicalMeta } = this._computeLexicalMeta(finalResults, query, {
      restrictedAttempted,
      restrictedFallback,
    });

    this.log(`[bm25Search] quality=${searchQuality} path=${lexicalMeta.lexicalPath} restricted=${lexicalMeta.identifierRestricted} fallback=${lexicalMeta.restrictedFallback} results=${finalResults.length} latency=${latency}ms`);

    return { results: finalResults, latency, searchQuality, lexicalMeta };
  }

  /**
   * Raw BM25 search for hybrid fusion (PHASE_1_FIXES Change 1)
   *
   * Returns raw FTS5/BM25 scores WITHOUT post-FTS5 boosts or flood control.
   * Used by hybrid search to ensure fair CC fusion between lexical and semantic paths.
   *
   * @param {string} query - Search query
   * @param {number} [limit=50] - Maximum results to return
   * @returns {Promise<{results: Array, latency: number}>}
   */
  async bm25SearchRaw(query, limit = 50) {
    await this.init();

    const start = Date.now();
    let results = [];

    if (this.hasFts5) {
      // Fix 4: Name-restricted FTS5 query for code-shaped identifiers (plan requires both bm25Search & Raw)
      const useNameRestriction = this.isStrictIdentifierQuery(query);
      let rows = [];

      if (useNameRestriction) {
        try {
          rows = this._stmtFts5.all(`name : ${this.sanitizeFtsQuery(query)}`, limit);
        } catch (err) {
          this.log(`[bm25SearchRaw] Name-restricted FTS5 query failed: ${err.message}`);
          rows = [];
        }
      }

      if (rows.length === 0) {
        try {
          rows = this._stmtFts5.all(this.sanitizeFtsQuery(query), limit);
        } catch (err) {
          this.log(`[bm25SearchRaw] FTS5 query failed: ${err.message}`);
          rows = [];
        }
      }

      for (const row of rows) {
        results.push(this._mapRow(row, 'fts5_raw'));
      }
    }

    // Try trigram fuzzy search if standard FTS5 returned few results
    if (this.hasTrigram && results.length < 3 && query.length >= 3) {
      try {
        const escapedRaw = query.replace(/"/g, '""');
        const trigramRows = this._stmtTrigram.all(`"${escapedRaw}"`, limit);
        this._mergeRows(results, trigramRows, 'trigram_raw', 0.9);
      } catch (err) {
        this.log(`[bm25SearchRaw] Trigram query failed: ${err.message}`);
      }
    }

    // LIKE fallback for no FTS5
    if (!this.hasFts5 || results.length === 0) {
      this._likeFallback(results, query, limit, 'like_raw');
    }

    const latency = Date.now() - start;

    // NO boosts, NO flood control - return raw scores for fair fusion
    return { results, latency };
  }

  // =============================================================================
  // POST-FTS5 RANKING BOOST STRATEGIES (#1, #19, #4, #20)
  // =============================================================================

  // SYMBOL_KIND_WEIGHTS and DEFINITION_TYPES imported from constants.js

  /**
   * Apply all post-FTS5 ranking boosts to search results.
   *
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

    // Strategy #5: Detect query intent once for all results
    const { intent, confidence } = detectIntent(query);
    const applyIntentBoost = intent !== 'general' && confidence >= 0.7;

    if (debugMode && applyIntentBoost) {
      this.log(`Intent: ${intent} (confidence: ${confidence.toFixed(2)})`);
    }

    const boostedResults = results.map(result => {
      let totalBoost = 1.0;
      const boostDetails = [];

      // Strategy #1: Post-FTS5 Definition Boost
      const defBoost = this.applyDefinitionBoost(result, queryLower, queryTokens);
      if (defBoost > 1.0) {
        totalBoost *= defBoost;
        boostDetails.push(`def:${defBoost.toFixed(2)}`);
      }

      // Strategy #19: Definition Syntax Boost
      const syntaxBoost = this.applyDefinitionSyntaxBoost(result, queryTokens);
      if (syntaxBoost > 1.0) {
        totalBoost *= syntaxBoost;
        boostDetails.push(`syntax:${syntaxBoost.toFixed(2)}`);
      }

      // Strategy #4: Symbol Kind Hierarchy
      const kindWeight = this.applySymbolKindWeight(result);
      // Apply as soft boost: score *= (0.5 + 0.5 * kindWeight) to avoid crushing low types
      const kindBoost = 0.5 + 0.5 * kindWeight;
      totalBoost *= kindBoost;
      if (kindWeight !== 1.0) {
        boostDetails.push(`kind:${kindBoost.toFixed(2)}`);
      }

      // Strategy #20: Structural Position Boost
      const posBoost = this.applyPositionBoost(result);
      if (posBoost > 1.0) {
        totalBoost *= posBoost;
        boostDetails.push(`pos:${posBoost.toFixed(2)}`);
      }

      // Strategy #5: Intent-based Boost
      if (applyIntentBoost) {
        const intentBoost = getIntentBoost(intent, result.type);
        if (intentBoost > 1.0) {
          totalBoost *= intentBoost;
          boostDetails.push(`intent:${intentBoost.toFixed(2)}`);
        }
      }

      // Fix 6: Path-aware lexical signal boost
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

    // Re-sort by boosted score descending
    boostedResults.sort((a, b) => b.score - a.score);

    // Apply MMR diversification if needed (replaces Strategy #21 flood control)
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
   * Extract normalized tokens from query for matching.
   * Handles PascalCase, camelCase, and space-separated terms.
   *
   * @param {string} query - Search query
   * @returns {string[]} Lowercase tokens
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

    // Add full query as token
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
   * Strategy #1: Post-FTS5 Definition Boost
   *
   * Prioritizes results that DEFINE the queried entity over results that merely
   * reference or use it. A search for "AuthService" should rank AuthService.java
   * (the definition) above LoginController.java (a caller).
   *
   * @param {Object} result - Search result with file, name, type properties
   * @param {string} queryLower - Lowercase query string
   * @param {string[]} queryTokens - Query tokens for matching
   * @returns {number} Boost multiplier (1.0 = no boost, 2.0 = strong boost)
   *
   * Boost logic:
   * - Filename matches query AND is definition type -> 2.0x
   * - Entity name matches exactly AND is definition type -> 1.5x
   * - Any definition type -> 1.2x
   * - Otherwise -> 1.0x (no boost)
   */
  applyDefinitionBoost(result, queryLower, queryTokens) {
    const isDefinitionType = DEFINITION_TYPES.has(result.type);
    const resultNameLower = (result.name || '').toLowerCase();

    // Extract filename without extension
    const filePath = result.file || '';
    const fileName = filePath.split('/').pop() || '';
    const fileNameNoExt = fileName.replace(/\.[^.]+$/, '').toLowerCase();

    // Check if filename matches query (e.g., query="AuthService", file="AuthService.java")
    const filenameMatchesQuery = queryTokens.some(token =>
      fileNameNoExt === token || fileNameNoExt.includes(token)
    );

    // Check if entity name exactly matches query
    const exactNameMatch = queryTokens.some(token => resultNameLower === token);

    // Apply boost based on match strength
    if (filenameMatchesQuery && isDefinitionType) {
      // Strongest signal: file is named after query and contains definition
      return 2.0;
    }

    if (exactNameMatch && isDefinitionType) {
      // Strong signal: entity name matches and is a definition
      return 1.5;
    }

    if (isDefinitionType) {
      // Weak signal: at least it's a definition type
      return 1.2;
    }

    return 1.0;
  }

  /**
   * Strategy #19: Definition Syntax Boost
   *
   * Detects language-specific definition patterns in entity signatures/content.
   * Boosts entities whose signatures explicitly define the queried symbol.
   *
   * @param {Object} result - Search result with signature, name, type properties
   * @param {string[]} queryTokens - Query tokens for pattern matching
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
      // Java patterns
      /\b(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/,
      /\b(?:public|private|protected)?\s*interface\s+(\w+)/,
      /\b(?:public|private|protected)?\s*enum\s+(\w+)/,
      /\b(?:public|private|protected)?\s*(?:static)?\s*(?:abstract)?\s*(?:final)?\s*\w+\s+(\w+)\s*\(/,

      // JavaScript/TypeScript patterns
      /\bclass\s+(\w+)/,
      /\bfunction\s+(\w+)/,
      /\bexport\s+(?:default\s+)?class\s+(\w+)/,
      /\bexport\s+(?:default\s+)?function\s+(\w+)/,
      /\bconst\s+(\w+)\s*=/,
      /\bexport\s+const\s+(\w+)\s*=/,

      // TypeScript specific
      /\binterface\s+(\w+)/,
      /\btype\s+(\w+)\s*=/,
      /\benum\s+(\w+)/,
    ];

    for (const pattern of definitionPatterns) {
      const match = signature.match(pattern);
      if (match && match[1]) {
        const definedName = match[1].toLowerCase();
        // Check if the defined name matches any query token
        if (queryTokens.some(token => definedName === token || definedName.includes(token))) {
          return 1.8;
        }
      }
    }

    return 1.0;
  }

  /**
   * Strategy #4: Symbol Kind Hierarchy Weight
   *
   * Applies importance weights based on entity type. Classes and interfaces
   * are generally more important than variables or imports.
   *
   * @param {Object} result - Search result with type property
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
   * Strategy #20: Structural Position Boost
   *
   * Boosts entities that appear early in files, as definitions typically
   * appear near the top (after imports). This helps prioritize class declarations
   * over method implementations deep in the file.
   *
   * @param {Object} result - Search result with startLine and type properties
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

    // Only apply position boost to definition types
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
        // Exact basename match: highest boost
        boost = Math.max(boost, 1.5);
      } else if (basename.includes(token)) {
        // Basename contains token
        boost = Math.max(boost, 1.25);
      } else if (parts.some(seg => seg.includes(token))) {
        // Directory segment contains token
        boost = Math.max(boost, 1.1);
      }
    }

    return boost;
  }

  /**
   * Search by entity name (exact match)
   */
  async searchByName(name, type = null) {
    await this.init();

    let query = `SELECT * FROM entities WHERE name = ? AND stale_since IS NULL`;
    const params = [name];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' LIMIT 50';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Search by file path pattern
   */
  async searchByFile(pathPattern) {
    await this.init();

    const stmt = this.db.prepare(`
      SELECT * FROM entities
      WHERE file_path LIKE ?
        AND stale_since IS NULL
      ORDER BY start_line
      LIMIT 100
    `);

    return stmt.all(`%${pathPattern}%`);
  }

  /**
   * Graph expansion - find related entities
   *
   * P2 FIX: Batched queries to eliminate N+1 problem
   * Before: O(n) queries for n entities (getEntity + getRelated in loop)
   * After: O(1) batched queries per hop (single query for all entities + relationships)
   */
  async expandGraph(entityIds, maxHops = GRAPH_CONFIG.expansion.maxHops) {
    await this.init();

    const expanded = new Map();
    let frontier = new Set(entityIds);

    for (let hop = 0; hop < maxHops; hop++) {
      const nextFrontier = new Set();

      // P2 FIX: Batch fetch all entities in frontier at once
      const frontierIds = Array.from(frontier).filter(id => !expanded.has(id));
      if (frontierIds.length === 0) break;

      // Single query for all entities in this hop
      const placeholders = frontierIds.map(() => '?').join(',');
      const entities = this.db.prepare(`
        SELECT * FROM entities
        WHERE id IN (${placeholders})
        AND stale_since IS NULL
      `).all(...frontierIds);

      // Create lookup map for fast access
      const entityMap = new Map(entities.map(e => [e.id, e]));

      // P2 FIX: Batch fetch all relationships (outgoing + incoming) in single query
      const relationships = this.db.prepare(`
        SELECT r.*, 'out' as direction, r.source_id as origin_id
        FROM relationships r
        JOIN entities e ON r.target_id = e.id
        WHERE r.source_id IN (${placeholders})
        AND e.stale_since IS NULL
        UNION ALL
        SELECT r.*, 'in' as direction, r.target_id as origin_id
        FROM relationships r
        JOIN entities e ON r.source_id = e.id
        WHERE r.target_id IN (${placeholders})
        AND e.stale_since IS NULL
      `).all(...frontierIds, ...frontierIds);

      // Group relationships by their origin entity
      const relMap = new Map();
      for (const rel of relationships) {
        const key = rel.origin_id;
        if (!relMap.has(key)) relMap.set(key, []);
        relMap.get(key).push(rel);
      }

      // Process all entities without additional queries
      for (const entityId of frontierIds) {
        const entity = entityMap.get(entityId);
        if (entity) {
          expanded.set(entityId, {
            ...entity,
            hop,
            source: hop === 0 ? 'direct' : 'graph',
          });
        }

        // Get related entities from pre-fetched relationships
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

  /**
   * Get single entity by ID
   */
  async getEntity(entityId) {
    await this.init();
    return this._stmtEntityById.get(entityId) || null;
  }

  /**
   * Get entities related to given entity
   */
  async getRelated(entityId) {
    await this.init();

    const results = [];

    // Find outgoing relationships (cached prepared statement)
    const outRows = this._stmtOutRels.all(entityId);
    for (const row of outRows) {
      results.push({
        ...row,
        direction: 'outgoing',
      });
    }

    // Find incoming relationships (cached prepared statement)
    const inRows = this._stmtInRels.all(entityId, entityId);
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
   * D4 FIX: Added JSDoc documentation
   *
   * @param {string} query - The search query
   * @param {Object} topResult - The top search result
   * @param {Object} [secondResult] - Optional second result for score gap comparison
   * @returns {boolean} True if top result is an exact/near-exact match
   */
  isExactMatchResult(query, topResult, secondResult = null) {
    if (!topResult) return false;

    const queryLower = query.toLowerCase().trim();
    const nameLower = (topResult.name || '').toLowerCase();

    // Criterion 1: Name exactly matches query (case-insensitive)
    if (nameLower === queryLower) {
      return true;
    }

    // Criterion 2: High absolute score (BM25 > 30 indicates strong match)
    if (topResult.score > 30.0) {
      return true;
    }

    // Criterion 3: Score significantly higher than #2 (2x or more)
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

  /**
   * Log helper (can be overridden for testing)
   */
  log(message) {
    if (process.env.DEBUG_GRAPH_SEARCH) {
      console.error(`[GraphSearch] ${message}`);
    }
  }

  /**
   * Graph-expanded search: BM25 + graph traversal
   *
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
    } = options;

    const start = Date.now();

    // STRATEGY #2: Use definition-first search for identifier queries
    // This ensures "AuthService" returns AuthService.java at position 1
    const shouldUseDefinitionFirst = useDefinitionFirst ?? this.isIdentifierQuery(query);

    if (shouldUseDefinitionFirst) {
      this.log(`Using definition-first search for identifier query: "${query}"`);

      // Two-pass search: definitions in parallel with BM25
      const { results: definitionResults, stats: defStats } = await this.hybridDefinitionSearch(query, { k, limit: 20, skipBoosts });

      // If we got definition results, optionally expand graph from them
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

        // Internal expansion (used by hybrid and direct callers)
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
                  docComment: rel.doc_comment,
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

      // No expansion needed or no results - return definition results
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

    // Standard BM25 path for non-identifier queries
    // Step 1: BM25 search for initial matches
    // Pass skipBoosts for fair hybrid fusion
    const { results: bm25Results, latency: bm25Latency } = await this.bm25Search(query, { limit: 20, skipBoosts });

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

    // Internal expansion (used by hybrid and direct callers)
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
              docComment: rel.doc_comment,
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
   * Get score multiplier for relationship type in graph expansion.
   * Higher values = more important relationships to follow.
   * D5 FIX: Added JSDoc documentation
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
    // Remove FTS5 special characters
    let sanitized = query.replace(/[":*^~()+\-]/g, ' ');

    // Convert to prefix match if single word
    const words = sanitized.trim().split(/\s+/).filter(w => w.length > 0);

    if (words.length === 1) {
      // Single word: use prefix matching
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

  // =============================================================================
  // STRATEGY #2: TWO-PASS DEFINITION-FIRST SEARCH
  // =============================================================================

  /**
   * Check if query looks like an identifier (PascalCase, camelCase, or snake_case).
   * Used to decide whether to prioritize definition-first search.
   *
   * @param {string} query - The search query
   * @returns {boolean} True if query matches identifier patterns
   *
   * @example
   * isIdentifierQuery('AuthService')     // true (PascalCase)
   * isIdentifierQuery('employeeService') // true (camelCase)
   * isIdentifierQuery('get_employee')    // true (snake_case)
   * isIdentifierQuery('how does auth work') // false (natural language)
   */
  isIdentifierQuery(query) {
    const trimmed = query.trim();
    // Skip multi-word queries (likely natural language)
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
   * Two-Pass Definition-First Search (Strategy #2)
   *
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

    const { k = 10, limit = 20, skipBoosts = false } = options;
    const queryNormalized = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    const queryLower = query.toLowerCase();
    const start = Date.now();

    // Pass 1: Definition-first search (parallel with Pass 2)
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
          AND e.type IN ('class', 'interface', 'struct', 'enum', 'function', 'type', 'component')
          AND e.stale_since IS NULL
          ORDER BY
            match_priority,
            CASE e.type
              WHEN 'class' THEN 0
              WHEN 'interface' THEN 1
              WHEN 'function' THEN 2
              WHEN 'component' THEN 3
              ELSE 4
            END,
            length(e.name)
          LIMIT 5
        `);
        const rows = stmt.all(queryLower, queryLower, queryLower, queryLower);
        resolve(rows);
      } catch (err) {
        this.log(`Definition search error: ${err.message}`);
        resolve([]);
      }
    });

    // Pass 2: Normal BM25/FTS5 search (parallel)
    // Pass skipBoosts through for fair hybrid fusion
    const fts5Promise = this.bm25Search(query, { limit, skipBoosts });

    // Wait for both searches
    const [definitionResults, fts5Result] = await Promise.all([definitionPromise, fts5Promise]);

    const latency = Date.now() - start;
    this.log(`hybridDefinitionSearch: ${definitionResults.length} definitions, ${fts5Result.results.length} FTS5 in ${latency}ms`);

    // Merge: definitions first, then FTS5 (deduplicated)
    const merged = this.mergeWithDefinitionPriority(definitionResults, fts5Result.results, k);

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
   * Merge definition search results with FTS5 results, prioritizing definitions.
   * Definitions are guaranteed in top positions, followed by deduplicated FTS5 results.
   *
   * @param {Array} definitions - Results from definition-first search
   * @param {Array} fts5Results - Results from BM25/FTS5 search
   * @param {number} [k=10] - Maximum results to return
   * @returns {Array} Merged and deduplicated results
   */
  mergeWithDefinitionPriority(definitions, fts5Results, k = 10) {
    const seen = new Set();
    const merged = [];

    // Add definitions first (guaranteed top positions)
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
          docComment: def.doc_comment,
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

    // Add remaining FTS5 results (deduplicated)
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
   * Find all callers of a given entity
   */
  async findCallers(entityName, options = {}) {
    await this.init();
    const { maxDepth = 2, limit = 50 } = options;

    // Find target entity
    const target = this.db.prepare(`
      SELECT id, name, type, file_path FROM entities
      WHERE (name = ? OR name LIKE ?)
        AND stale_since IS NULL
      LIMIT 1
    `).get(entityName, `%${entityName}%`);

    if (!target) return { results: [], stats: { found: false, query: entityName } };

    // Create lowercase camelCase pattern for target_name matching
    // e.g., "EmployeeService" -> "employeeService.%" to match "employeeService.getEmployee"
    const lowerCamelCase = target.name.charAt(0).toLowerCase() + target.name.slice(1);
    const targetNamePattern = `${lowerCamelCase}.%`;

    // Find callers (reverse 'calls' relationship)
    // Match by target_id (resolved) OR target_name pattern (unresolved)
    const callers = this.db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
        r.context_line as call_line, r.target_name
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE r.type = 'calls' AND (
        r.target_id = ?
        OR r.target_name LIKE ?
        OR r.target_name LIKE ?
      )
        AND e.stale_since IS NULL
      ORDER BY e.file_path, r.context_line
      LIMIT ?
    `).all(target.id, targetNamePattern, `${target.name}.%`, limit);

    return {
      results: callers.map(c => ({
        ...c,
        relationship: 'calls',
        depth: 1,
      })),
      stats: { targetEntity: target.name, targetType: target.type, totalCallers: callers.length },
    };
  }

  /**
   * Find all callees of a given entity
   */
  async findCallees(entityName, options = {}) {
    await this.init();
    const { limit = 50 } = options;

    const source = this.db.prepare(`
      SELECT id, name, type FROM entities
      WHERE (name = ? OR name LIKE ?)
        AND stale_since IS NULL
      LIMIT 1
    `).get(entityName, `%${entityName}%`);

    if (!source) return { results: [], stats: { found: false } };

    const callees = this.db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
        r.context_line as call_line, r.target_name
      FROM relationships r
      LEFT JOIN entities e ON e.id = r.target_id OR e.name = r.target_name
      WHERE r.source_id = ? AND r.type = 'calls'
        AND (e.stale_since IS NULL OR e.id IS NULL)
      ORDER BY r.context_line
      LIMIT ?
    `).all(source.id, limit);

    return {
      results: callees.map(c => ({
        id: c.id,
        name: c.name || c.target_name,
        type: c.type || 'external',
        file_path: c.file_path,
        start_line: c.start_line,
        signature: c.signature,
        call_line: c.call_line,
        relationship: 'calls',
      })),
      stats: { sourceEntity: source.name, totalCallees: callees.length },
    };
  }

  /**
   * Find implementations of an interface
   */
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
        AND e.stale_since IS NULL
      ORDER BY e.name
      LIMIT ?
    `).all(interfaceName, `%${interfaceName}%`, limit);

    return {
      results: implementations.map(i => ({ ...i, relationship: i.rel_type })),
      stats: { targetInterface: interfaceName, totalImplementations: implementations.length },
    };
  }

  /**
   * Impact analysis - what depends on this entity?
   */
  async findImpact(entityName, options = {}) {
    await this.init();
    const { maxDepth = 3, limit = 100 } = options;

    const target = this.db.prepare(`
      SELECT id, name, type FROM entities
      WHERE (name = ? OR name LIKE ?)
        AND stale_since IS NULL
      LIMIT 1
    `).get(entityName, `%${entityName}%`);

    if (!target) return { results: [], stats: { found: false } };

    const impacted = new Map();
    let frontier = [target.id];

    // For depth 1, also match on target_name pattern (e.g., "employeeService.getEmployee")
    const targetNamePattern = target.name.charAt(0).toLowerCase() + target.name.slice(1) + '.%';

    for (let depth = 1; depth <= maxDepth && impacted.size < limit; depth++) {
      if (frontier.length === 0) break;

      const placeholders = frontier.map(() => '?').join(',');
      let dependents;

      if (depth === 1) {
        // First depth: match by target_id OR target_name pattern (for instance.method() calls)
        dependents = this.db.prepare(`
          SELECT DISTINCT
            e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
            r.type as rel_type
          FROM relationships r
          JOIN entities e ON e.id = r.source_id
          WHERE (r.target_id IN (${placeholders}) OR r.target_name LIKE ?)
            AND e.stale_since IS NULL
          LIMIT 50
        `).all(...frontier, targetNamePattern);
      } else {
        // Subsequent depths: only match by target_id
        dependents = this.db.prepare(`
          SELECT DISTINCT
            e.id, e.name, e.type, e.file_path, e.start_line, e.signature, e.summary,
            r.type as rel_type
          FROM relationships r
          JOIN entities e ON e.id = r.source_id
          WHERE r.target_id IN (${placeholders})
            AND e.stale_since IS NULL
          LIMIT 50
        `).all(...frontier);
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
          nextFrontier.push(dep.id);
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

  /**
   * Get database statistics
   */
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

// =============================================================================
// CLI
// =============================================================================

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
