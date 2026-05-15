/**
 * Encoder-input dependency registry.
 *
 * Plan § 7.2.1, § 12.4. The encoder-input hashes in
 * `encoder-input.mjs` answer the question "given the fully built
 * `embedding_text` / `li_text`, do I still need to encode this chunk?"
 * They do **not** answer "which chunks need their `embedding_text`
 * rebuilt when something outside the chunk body changes?"
 *
 * Today, the production policy keeps cross-file metadata out of encoder
 * inputs: changing file A's callee body does not re-embed unchanged caller
 * file B. But the chunker DOES inject same-file scope / defines / uses
 * enrichment plus import names into `embedding_text`. When any of those
 * facts changes for a stable chunk, the reconciler must:
 *
 *   1. Mark the chunk **metadata-dirty**.
 *   2. Re-run graph enrichment for that chunk to rebuild `embedding_text`
 *      / `li_text` / `li_greedy_text`.
 *   3. Compute the exact input hash and reuse the previous payload only
 *      on byte-identical match.
 *
 * The registry is a small key→consumer table seeded by the reconcile
 * tick whenever a chunk is encoded. When a key fires (e.g. a same-file
 * scope change), the registry yields every dependent chunk so they can
 * be added to the dirty set.
 *
 * Dependency-key vocabulary (all string keys; readers should treat them
 * opaquely):
 *
 *   * `path:<relative_path>`            — file-level identity facts.
 *   * `lang:<relative_path>`            — language detection result for the file.
 *   * `policy:embed:<n>`                — bumps when embed-text policy changes.
 *   * `policy:li:<n>`                   — bumps when LI input policy changes.
 *   * `parent:<relative_path>:<parent>` — same-file parent symbol identity.
 *   * `same-file-symbols:<relative_path>` — set of symbols defined in this file.
 *   * `same-file-imports:<relative_path>` — set of import target names in this file.
 *   * `entity:<entity_id>`              — future cross-file rule (plan § 7.2.1).
 *   * `relationship:<source_entity_id>` — future cross-file rule.
 *   * `file-exports:<relative_path>`    — future cross-file rule.
 *   * `graph-centrality:<entity_id>`    — future cross-file rule.
 *
 * Consumers (`consumer` column of `encoder_input_dependencies`):
 *
 *   * `dense` — affects `embedding_text` only.
 *   * `li`    — affects `pickLiInput` only.
 *   * `dedup` — affects dedup signals.
 *
 * The same chunk can register multiple `(key, consumer)` pairs.
 */

/**
 * Build the same-file dependency set for a single chunk. The reconcile
 * tick calls this **after** graph enrichment so the inputs already
 * reflect the current scope / defines / uses lines.
 *
 * @param {object} chunk             Enriched chunk (post graph-enrichment).
 * @returns {Array<{dependency_key: string, consumer: 'dense'|'li'|'dedup'}>}
 */
export function collectChunkDependencies(chunk) {
  if (!chunk) return [];
  const meta = chunk.metadata || {};
  const rel = meta.relative_path || meta.file || meta.file_path || '';
  const lang = (meta.language || '').toLowerCase();
  const parent = meta.parent_symbol || '';
  const deps = [];

  if (rel) {
    deps.push({ dependency_key: `path:${rel}`, consumer: 'dense' });
    deps.push({ dependency_key: `path:${rel}`, consumer: 'li' });
    deps.push({ dependency_key: `lang:${rel}`, consumer: 'dense' });
    deps.push({ dependency_key: `lang:${rel}`, consumer: 'li' });
    deps.push({ dependency_key: `same-file-symbols:${rel}`, consumer: 'dense' });
    deps.push({ dependency_key: `same-file-imports:${rel}`, consumer: 'dense' });
  }
  if (parent && rel) {
    deps.push({ dependency_key: `parent:${rel}:${parent}`, consumer: 'dense' });
  }
  // Policy fingerprints. Any consumer of these keys is the canonical place
  // to invalidate cached encoder payloads after a policy bump.
  deps.push({ dependency_key: 'policy:embed', consumer: 'dense' });
  deps.push({ dependency_key: 'policy:li', consumer: 'li' });
  deps.push({ dependency_key: 'policy:dedup', consumer: 'dedup' });

  void lang; // currently only used as a fingerprint input; keeping the
              // binding so a future taxonomy expansion has a clean home.
  return deps;
}

/**
 * Persist the dependency set for a chunk into the
 * `encoder_input_dependencies` table. Caller controls the transaction.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} filePath
 * @param {string} chunkStructId
 * @param {Array<{dependency_key:string, consumer:string}>} deps
 */
export function persistDependencies(db, filePath, chunkStructId, deps) {
  if (!chunkStructId) return;
  const remove = db.prepare(`
    DELETE FROM encoder_input_dependencies
    WHERE file_path = ? AND chunk_struct_id = ?
  `);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO encoder_input_dependencies
      (dependency_key, file_path, chunk_struct_id, consumer)
    VALUES (?, ?, ?, ?)
  `);
  remove.run(filePath, chunkStructId);
  for (const dep of deps) {
    insert.run(dep.dependency_key, filePath, chunkStructId, dep.consumer);
  }
}

/**
 * Look up dependent chunks for a list of changed dependency keys. The
 * reconciler uses this to expand the metadata-dirty set when external
 * facts change.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} keys
 * @returns {Array<{file_path:string, chunk_struct_id:string, consumer:string}>}
 */
export function dependentsOf(db, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const placeholders = keys.map(() => '?').join(',');
  return db.prepare(`
    SELECT DISTINCT file_path, chunk_struct_id, consumer
    FROM encoder_input_dependencies
    WHERE dependency_key IN (${placeholders})
  `).all(...keys);
}

/**
 * Drop all dependency rows for a file. Used when a file is deleted or its
 * structural identity has been replaced wholesale.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} filePath
 */
export function forgetFile(db, filePath) {
  db.prepare('DELETE FROM encoder_input_dependencies WHERE file_path = ?').run(filePath);
}
