/**
 * Exact encoder-input hashes for the dense, LI, and dedup consumers.
 *
 * Plan § 7.2 + § 7.2.1 + § 12.4. The reconcile path must reuse a previously
 * computed dense embedding only when the **exact bytes** sent to the encoder
 * have not changed. The "bytes" depend on far more than the raw chunk body:
 *
 *   * Dense (`embedding_text`):
 *       - chunk body
 *       - relative path, language, chunk type, primary symbol
 *       - parent symbol + parent type
 *       - AST signature (when the active variant uses signatures)
 *       - sibling `additional_symbols`
 *       - active embedding-text policy fingerprint
 *       - same-file scope / defines / uses enrichment
 *
 *   * Late-interaction (`pickLiInput`):
 *       - same body
 *       - language-routed input variant (Python and Java-family use
 *         `li_text`; JS/TS/etc. use the greedy form)
 *       - LI input policy fingerprint
 *
 *   * Dedup (`simhash` / `clusterId` / `exemplarId` / `liReuseEligible`):
 *       - chunk content normalised for dedup
 *       - cluster exemplar identity (a member whose exemplar changed is
 *         "dedup-dirty" even if its own content is stable)
 *
 * This module is pure domain logic. It accepts plain JS objects and returns
 * 16-hex-char hash strings. The Phase 1 reconciler calls these helpers
 * **after** the existing graph-enrichment pass has built `embedding_text` /
 * `li_text` / `li_greedy_text` on each chunk, so the inputs to the hashers
 * are already metadata-aware.
 */

import { contentHashSync, stableStringify, metadataFingerprint } from '../infrastructure/hashing.mjs';
import { pickLiInput } from '../../indexing/chunk-embed-text.js';

/**
 * Policy fingerprint constants. Bump these when the encoder-text recipe
 * changes in a way that invalidates cached payloads. The values are
 * intentionally simple integers; reconcile mixes them into the hash inputs
 * so changing the variant flushes the cache without renaming columns.
 *
 * EMBED_TEXT_POLICY_VERSION mirrors the cold-path `pipelineVersion` bump in
 * `core/indexing/config-fingerprint.js::buildConfigFingerprint`; LI policy
 * has its own counter because LI input routing can change independently of
 * dense input.
 */
export const EMBED_TEXT_POLICY_VERSION = 1;
export const LI_INPUT_POLICY_VERSION = 1;
export const DEDUP_INPUT_POLICY_VERSION = 1;

/**
 * The LI input text of a chunk: the text the late-interaction encoder reads
 * (`pickLiInput`), so the hash changes exactly when the encoder input does.
 *
 * @param {object} chunk
 * @returns {string}
 */
export function pickLiInputText(chunk) {
  return chunk ? pickLiInput(chunk) : '';
}

/**
 * Compute the dense `embedding_input_hash`. The input is the exact
 * `embedding_text` produced by the chunker + graph-enrichment pass, mixed
 * with the policy fingerprint.
 *
 * @param {object} chunk
 * @returns {string}
 */
export function denseInputHash(chunk) {
  if (!chunk) return '';
  const text = chunk.embedding_text || chunk.text || chunk.content || '';
  return contentHashSync(`${text}|policy:${EMBED_TEXT_POLICY_VERSION}`);
}

/**
 * Compute the LI `li_input_hash`. Resolves the LI input text via the
 * language taxonomy and mixes the policy fingerprint.
 *
 * @param {object} chunk
 * @returns {string}
 */
export function liInputHash(chunk) {
  if (!chunk) return '';
  const text = pickLiInputText(chunk);
  return contentHashSync(`${text}|policy:${LI_INPUT_POLICY_VERSION}`);
}

/**
 * Compute the dedup `metadata_fingerprint`. Plan § 7.2.1 calls this out as
 * its own consumer so that a member whose cluster exemplar changed gets
 * re-aliased even when its own `embedding_input_hash` / `li_input_hash`
 * are unchanged.
 *
 * Dedup signal taxonomy:
 *   - `simhash` (chunk-local; recomputed when content changes)
 *   - `clusterId` (cluster membership)
 *   - `exemplarId` (target of the alias)
 *   - `isExemplar` (whether this row is the exemplar)
 *   - `aliasJaccard` (similarity score; informational)
 *   - `liReuseEligible` (drives the LI-side alias decision)
 *
 * The fingerprint is built from a stable JSON of these fields plus the
 * policy version.
 *
 * @param {object} chunk
 * @returns {string}
 */
export function dedupFingerprint(chunk) {
  const meta = (chunk && chunk.metadata) || {};
  return contentHashSync(stableStringify({
    simhash: meta.simhash ?? null,
    clusterId: meta.clusterId ?? null,
    exemplarId: meta.exemplarId ?? null,
    isExemplar: meta.isExemplar ?? null,
    aliasJaccard: meta.aliasJaccard ?? null,
    liReuseEligible: meta.liReuseEligible ?? null,
    policy: DEDUP_INPUT_POLICY_VERSION,
  }));
}

function chunkRelativePath(chunk, meta = chunk?.metadata || {}) {
  return firstSafeRelativePath(
    meta.relative_path,
    meta.path,
    meta.file_path,
    chunk?.file,
    meta.file,
  );
}

function firstSafeRelativePath(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
    if (!normalized || normalized === '.' || normalized.startsWith('/')) continue;
    if (/^[A-Za-z]:\//.test(normalized)) continue;
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) continue;
    return normalized;
  }
  return null;
}

/**
 * Convenience: compute all three hashes plus the raw `chunk_text_hash` and
 * `metadata_fingerprint` in one pass.
 *
 * The returned `metadata_fingerprint` here is the "encoder-input-affecting
 * metadata hash" required by plan § 7.2 / § 33 for the `metadata_fingerprint`
 * column. It is distinct from the dedup `dedupFingerprint`; both must be
 * stored when the reconcile path lands the row.
 *
 * Pass `{ includeDedup: false }` when the caller never persists the dedup
 * fingerprint (the full-indexing insert path) to skip that hash entirely.
 *
 * @param {object} chunk
 * @param {{includeDedup?: boolean}} [opts]
 * @returns {{chunk_text_hash:string, embedding_input_hash:string, li_input_hash:string, metadata_fingerprint:string, dedup_fingerprint?:string}}
 */
export function chunkInputHashes(chunk, { includeDedup = true } = {}) {
  const text = chunk?.content || chunk?.text || '';
  const meta = chunk?.metadata || {};
  const hashes = {
    chunk_text_hash: contentHashSync(text),
    embedding_input_hash: denseInputHash(chunk),
    li_input_hash: liInputHash(chunk),
    metadata_fingerprint: contentHashSync(stableStringify({
      relative_path: chunkRelativePath(chunk, meta),
      language: meta.language ?? null,
      chunk_type: meta.chunk_type ?? null,
      symbol: meta.symbol ?? null,
      parent_symbol: meta.parent_symbol ?? null,
      parent_type: meta.parent_type ?? null,
      signature: meta.signature ?? null,
      additional_symbols: meta.additional_symbols ?? null,
      // The span: unchanged code moved by an edit above it must get a new row version
      // (reusing its vectors), or search results and read-semantic keep the old lines.
      line_start: meta.line_start ?? null,
      line_end: meta.line_end ?? null,
      policy_embed: EMBED_TEXT_POLICY_VERSION,
      policy_li: LI_INPUT_POLICY_VERSION,
    })),
  };
  if (includeDedup) hashes.dedup_fingerprint = dedupFingerprint(chunk);
  return hashes;
}

/**
 * Re-export metadataFingerprint for callers that want the generic stable-
 * stringify hash without the encoder-specific field selection.
 */
export { metadataFingerprint };
