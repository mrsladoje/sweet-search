/**
 * Chunk-text lexical index (codebase.db `chunk_text_fts`).
 *
 * The graph BM25 channel (entities_fts / entities_code_fts in code-graph.db)
 * only sees entity names, signatures and doc comments. Text inside a body —
 * string literals, error messages, log lines, config keys, comments — was
 * reachable only through embeddings. This index holds BM25 over the same
 * chunks the semantic channel ranks (one FTS row per `vectors` row, same
 * rowid), so a body hit and a semantic hit share an id.
 *
 * Columns (BM25 weights in CHUNK_TEXT_FTS_WEIGHTS):
 *   body       the chunk text (first CHUNK_TEXT_FTS_MAX_CHARS characters, the
 *              cap the full build applies to `vectors.text`). unicode61 splits
 *              snake_case, kebab-case and dotted keys into words, and a phrase
 *              query puts them back together; camelCase identifiers stay whole,
 *              so an exact identifier still matches as one token.
 *   subtokens  the parts of each distinct camelCase / PascalCase identifier in
 *              the chunk ("errHasPendingTxns" -> "err has pending txns"), so a
 *              natural-language word can reach an identifier in a body.
 *
 * Sync. The table is contentless (contentless_delete=1). Rows are written in
 * JS by every vector insert helper (chunkTextFtsWriter, through
 * prepareVectorInsert and the reconciler's row-version insert); SQL triggers
 * remove a row when its vector row is deleted (GC, delete-by-file), replaced
 * (INSERT OR REPLACE) or has its text changed. The table is created only with
 * an empty `vectors` table, so it holds a row for every vector row or does
 * not exist (search then skips the channel): a full build and an incremental
 * update give the same rows.
 */

export const CHUNK_TEXT_FTS_TABLE = 'chunk_text_fts';
export const CHUNK_TEXT_FTS_MAX_CHARS = 2000;
/** bm25() weights, in column order (body, subtokens). */
export const CHUNK_TEXT_FTS_WEIGHTS = Object.freeze({ body: 1.0, subtokens: 0.5 });

const TRIGGERS = Object.freeze({
  // INSERT OR REPLACE deletes the old row without firing delete triggers
  // (recursive_triggers is off), so the old FTS row is removed up front.
  beforeInsert: `CREATE TRIGGER IF NOT EXISTS chunk_text_fts_vectors_bi BEFORE INSERT ON vectors BEGIN
      DELETE FROM ${CHUNK_TEXT_FTS_TABLE} WHERE rowid IN (SELECT rowid FROM vectors WHERE id = new.id);
    END`,
  afterDelete: `CREATE TRIGGER IF NOT EXISTS chunk_text_fts_vectors_ad AFTER DELETE ON vectors BEGIN
      DELETE FROM ${CHUNK_TEXT_FTS_TABLE} WHERE rowid = old.rowid;
    END`,
  // A text edit in place drops the FTS row: no writer edits text in place,
  // and one that does must write the new row through chunkTextFtsWriter.
  afterUpdate: `CREATE TRIGGER IF NOT EXISTS chunk_text_fts_vectors_au AFTER UPDATE OF text ON vectors BEGIN
      DELETE FROM ${CHUNK_TEXT_FTS_TABLE} WHERE rowid = old.rowid;
    END`,
});

/** False when the operator turned the index off (SWEET_SEARCH_CHUNK_TEXT_FTS=0). */
export function chunkTextFtsEnabled(env = process.env) {
  const raw = env.SWEET_SEARCH_CHUNK_TEXT_FTS;
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const CAMEL_BOUNDARY_RE = /[a-z0-9][A-Z]|[A-Z]{2}[a-z]/;

/** Parts of a camelCase / PascalCase identifier, or null when it has none. */
export function splitCamelIdentifier(identifier) {
  if (!CAMEL_BOUNDARY_RE.test(identifier)) return null;
  const parts = identifier
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_$]+/)
    .filter(Boolean);
  return parts.length > 1 ? parts : null;
}

/**
 * The FTS document for one chunk text. Pure and deterministic: the full build
 * and the incremental writer index a row through this one function.
 * @param {string|null|undefined} text
 * @returns {{ body: string, subtokens: string }}
 */
export function chunkTextFtsDocument(text) {
  const body = String(text ?? '').slice(0, CHUNK_TEXT_FTS_MAX_CHARS);
  const seen = new Set();
  const lines = [];
  IDENT_RE.lastIndex = 0;
  let m;
  while ((m = IDENT_RE.exec(body))) {
    const ident = m[0];
    if (seen.has(ident)) continue;
    seen.add(ident);
    const parts = splitCamelIdentifier(ident);
    if (parts) lines.push(parts.join(' ').toLowerCase());
  }
  return { body, subtokens: lines.join('\n') };
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);
}

export function hasChunkTextFts(db) {
  try { return tableExists(db, CHUNK_TEXT_FTS_TABLE); } catch { return false; }
}

/**
 * A writer `(rowid, text) => void` for the current connection, or null when
 * the table is absent (index disabled, or an index built without it).
 * Callers write the FTS row in the same transaction as the vector row.
 */
export function chunkTextFtsWriter(db) {
  if (!hasChunkTextFts(db)) return null;
  const del = db.prepare(`DELETE FROM ${CHUNK_TEXT_FTS_TABLE} WHERE rowid = ?`);
  const stmt = db.prepare(`INSERT INTO ${CHUNK_TEXT_FTS_TABLE}(rowid, body, subtokens) VALUES (?, ?, ?)`);
  return (rowid, text) => {
    const doc = chunkTextFtsDocument(text);
    // A second write for the same rowid replaces the first (an FTS5 rowid
    // is not a unique key, so a duplicate insert would index the row twice).
    del.run(rowid);
    stmt.run(rowid, doc.body, doc.subtokens);
  };
}

/**
 * Create the table and its triggers when missing. Idempotent; called by
 * migrateVectorsSchema on every write session. The table is created only
 * while `vectors` is empty (a new index): rows are indexed as they are
 * inserted, never filled in afterwards, so an index that has vector rows and
 * no table stays without one. Never throws: a database without FTS5 keeps
 * working without the channel.
 * @returns {{ created: boolean, skipped?: string }}
 */
export function ensureChunkTextFts(db, env = process.env) {
  if (!chunkTextFtsEnabled(env)) return { created: false, skipped: 'disabled' };
  try {
    if (!tableExists(db, 'vectors')) return { created: false, skipped: 'no-vectors-table' };
    const created = !tableExists(db, CHUNK_TEXT_FTS_TABLE);
    if (created && db.prepare('SELECT 1 FROM vectors LIMIT 1').get()) {
      return { created: false, skipped: 'existing-index' };
    }
    // One transaction: a table without its triggers would go stale.
    db.transaction(() => {
      if (created) {
        db.exec(`CREATE VIRTUAL TABLE ${CHUNK_TEXT_FTS_TABLE} USING fts5(
          body,
          subtokens,
          content='',
          contentless_delete=1,
          tokenize='porter unicode61 remove_diacritics 2'
        )`);
      }
      for (const sql of Object.values(TRIGGERS)) db.exec(sql);
    })();
    return { created };
  } catch (err) {
    return { created: false, skipped: `error: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Query side
// ---------------------------------------------------------------------------

// Query-tokenization stopwords (CLAUDE.md "OK to keep" category): English
// scaffolding filtered from the OR query only. The phrase query keeps every
// word, since an exact message includes them.
const QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'did', 'do',
  'does', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'its', 'of', 'on',
  'or', 'should', 'that', 'the', 'this', 'to', 'was', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'with', 'would',
]);

/**
 * FTS5 MATCH expressions for a query.
 *   phrase  every word of the query, in order, as one body phrase
 *   or      the content words, any of them, in either column
 * @param {string} query
 * @returns {{ words: string[], contentWords: string[], phrase: string|null, or: string|null }}
 */
export function buildChunkTextQueries(query) {
  const words = (String(query || '').match(/[\p{L}\p{N}]+/gu) || []).map((w) => w.toLowerCase());
  const contentWords = [...new Set(words.filter((w) => w.length >= 2 && !QUERY_STOPWORDS.has(w)))];
  return {
    words,
    contentWords,
    phrase: words.length > 0 ? `{body} : "${words.join(' ')}"` : null,
    or: contentWords.length > 0 ? contentWords.map((w) => `"${w}"`).join(' OR ') : null,
  };
}
