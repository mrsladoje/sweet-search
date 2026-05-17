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
 *   * `chunk-type:<relative_path>`      — chunk kind selected by the chunker.
 *   * `symbol:<relative_path>`          — primary chunk symbol metadata.
 *   * `signature:<relative_path>`       — AST signature metadata.
 *   * `additional-symbols:<relative_path>` — sibling symbols injected into text.
 *   * `policy:embed:<n>`                — bumps when embed-text policy changes.
 *   * `policy:li:<n>`                   — bumps when LI input policy changes.
 *   * `parent:<relative_path>:<parent>` — same-file parent symbol identity.
 *   * `same-file-symbols:<relative_path>` — set of symbols defined in this file.
 *   * `same-file-imports:<relative_path>` — set of import target names in this file.
 *   * `same-file-scope:<relative_path>` — same-file scope/defines/uses enrichment.
 *   * `dedup-cluster:<cluster_id>`      — dedup cluster membership.
 *   * `dedup-exemplar:<exemplar_id>`    — dedup alias target.
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

import {
  DEDUP_INPUT_POLICY_VERSION,
  EMBED_TEXT_POLICY_VERSION,
  LI_INPUT_POLICY_VERSION,
} from './encoder-input.mjs';

const MAX_DEPENDENCY_KEYS_PER_QUERY = 900;

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
  const rel = meta.relative_path || meta.path || meta.file_path || chunk.file || meta.file || '';
  const parent = meta.parent_symbol || '';
  const parentType = meta.parent_type || '';
  const clusterId = meta.clusterId || '';
  const exemplarId = meta.exemplarId || '';
  const deps = [];
  const push = (dependencyKey, consumers) => {
    for (const consumer of consumers) {
      deps.push({ dependency_key: dependencyKey, consumer });
    }
  };

  if (rel) {
    const encoderConsumers = ['dense', 'li'];
    push(`path:${rel}`, encoderConsumers);
    push(`lang:${rel}`, encoderConsumers);
    push(`chunk-type:${rel}`, encoderConsumers);
    push(`symbol:${rel}`, encoderConsumers);
    push(`signature:${rel}`, encoderConsumers);
    push(`additional-symbols:${rel}`, encoderConsumers);
    push(`same-file-symbols:${rel}`, encoderConsumers);
    push(`same-file-imports:${rel}`, encoderConsumers);
    push(`same-file-scope:${rel}`, encoderConsumers);
  }
  if (parent && rel) {
    push(`parent:${rel}:${parent}`, ['dense', 'li']);
  }
  if (parentType && rel) {
    push(`parent-type:${rel}:${parentType}`, ['dense', 'li']);
  }
  if (clusterId) {
    deps.push({ dependency_key: `dedup-cluster:${clusterId}`, consumer: 'dedup' });
  }
  if (exemplarId) {
    deps.push({ dependency_key: `dedup-exemplar:${exemplarId}`, consumer: 'dedup' });
  }
  if (Object.hasOwn(meta, 'liReuseEligible')) {
    const key = clusterId ? `dedup-li-reuse:${clusterId}` : 'dedup-li-reuse';
    deps.push({ dependency_key: key, consumer: 'dedup' });
  }
  // Policy fingerprints. Any consumer of these keys is the canonical place
  // to invalidate cached encoder payloads after a policy bump.
  deps.push({ dependency_key: `policy:embed:${EMBED_TEXT_POLICY_VERSION}`, consumer: 'dense' });
  deps.push({ dependency_key: `policy:li:${LI_INPUT_POLICY_VERSION}`, consumer: 'li' });
  deps.push({ dependency_key: `policy:dedup:${DEDUP_INPUT_POLICY_VERSION}`, consumer: 'dedup' });

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
  const out = [];
  const seen = new Set();
  for (let i = 0; i < keys.length; i += MAX_DEPENDENCY_KEYS_PER_QUERY) {
    const batch = keys.slice(i, i + MAX_DEPENDENCY_KEYS_PER_QUERY);
    const placeholders = batch.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT DISTINCT file_path, chunk_struct_id, consumer
      FROM encoder_input_dependencies
      WHERE dependency_key IN (${placeholders})
      ORDER BY file_path, chunk_struct_id, consumer
    `).all(...batch);
    for (const row of rows) {
      const key = `${row.file_path}\0${row.chunk_struct_id}\0${row.consumer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
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
