/**
 * Chunk-hash early-cutoff cache (lever E.6).
 *
 * Persists, per file, the set of encoder-input hashes that the file's chunks
 * fed to the embedding + late-interaction encoders on the LAST successful
 * reconcile of that file:
 *
 *   { [relativePath]: { embeddingInputHashes: string[], liInputHashes: string[] } }
 *
 * Before re-embedding a *changed* file, the reconciler recomputes the same
 * per-chunk hashes from the freshly parsed + graph-enriched chunks and compares
 * them to the persisted set. If — and only if — BOTH the embedding-input and the
 * li-input hash sets match exactly, the file's encode + all tier writes can be
 * skipped: the encoders would produce byte-identical inputs and therefore
 * byte-identical outputs.
 *
 * CORRECTNESS GATE (the §1.1 Tier-3 risk).
 * The cutoff key is `embedding_input_hash` + `li_input_hash` (from
 * `encoder-input.mjs::chunkInputHashes`). These fold in cross-file graph
 * enrichment (scope + imports injected by `enrichChunksFromGraph`), so a change
 * to a DEPENDENCY's symbols changes the dependent file's `embedding_text` and
 * therefore its `embedding_input_hash` — which means the dependent file is NOT
 * skipped. The key MUST NEVER be the file's own `chunk_text_hash` nor the raw
 * `contentUnchanged` flag, both of which miss cross-file enrichment and would
 * silently degrade recall. This module deliberately accepts ONLY the encoder-
 * input hashes and exposes no API that takes a text/content hash, so the
 * correctness gate is enforced structurally.
 *
 * This is a DOMAIN module: pure functions over plain data plus a tiny
 * JSON-on-disk persistence helper. The reconciler (application layer) owns the
 * decision of when to skip; this module only computes the key, compares, and
 * persists.
 *
 * Gated by `SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF` at the call site
 * (production-reconciler). When the flag is off the cache is neither read nor
 * written and behavior is exactly today's.
 */

import fs from 'node:fs';
import path from 'node:path';

import { denseInputHash, liInputHash } from './encoder-input.mjs';

export const CUTOFF_CACHE_FILENAME = 'reconcile-cutoff-cache.json';
export const CUTOFF_CACHE_VERSION = 1;

/**
 * @returns {boolean} whether the chunk-cutoff lever is enabled.
 *
 * DEFAULT-ON (disable with SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF=0). The cutoff key
 * is the per-chunk encoder-input hashes (dense + LI), which fold in cross-file
 * graph enrichment, so a file is skipped ONLY when its encoder inputs are
 * byte-identical → byte-identical encoder outputs (verified recall-neutral). Set
 * the flag to '0' to always re-encode changed files (today's behavior).
 */
export function chunkCutoffEnabled(env = process.env) {
  return env.SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF !== '0';
}

/**
 * Compute the cutoff signature for a file's chunk set. The signature is the
 * ordered list of per-chunk encoder-input hashes (dense + LI) — ordered so the
 * comparison is sensitive to chunk reordering, not just set membership (a moved
 * symbol is a real change to LI segment ordering).
 *
 * The chunks passed in MUST be the post-enrichment chunks (after
 * `enrichChunksFromGraph`), so the dense hash reflects cross-file scope/imports.
 *
 * @param {Array<object>} chunks  enriched chunks for one file
 * @returns {{embeddingInputHashes: string[], liInputHashes: string[]}}
 */
export function computeCutoffSignature(chunks) {
  const embeddingInputHashes = [];
  const liInputHashes = [];
  for (const chunk of chunks || []) {
    embeddingInputHashes.push(denseInputHash(chunk));
    liInputHashes.push(liInputHash(chunk));
  }
  return { embeddingInputHashes, liInputHashes };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Decide whether a file's encode + tier writes can be skipped.
 *
 * Returns true only when BOTH the embedding-input and li-input hash lists match
 * the persisted signature exactly (same hashes, same order). An empty current
 * signature (no chunks) never matches a non-empty stored one and vice versa, so
 * a file that lost or gained all chunks is never skipped.
 *
 * @param {{embeddingInputHashes: string[], liInputHashes: string[]}|null} previous
 * @param {{embeddingInputHashes: string[], liInputHashes: string[]}} current
 * @returns {boolean}
 */
export function signaturesMatch(previous, current) {
  if (!previous || !current) return false;
  // Never skip a file whose chunk set went empty (deletion / total rewrite) —
  // that path must flow through the normal retire logic.
  if ((current.embeddingInputHashes?.length ?? 0) === 0) return false;
  return arraysEqual(previous.embeddingInputHashes, current.embeddingInputHashes)
    && arraysEqual(previous.liInputHashes, current.liInputHashes);
}

function cachePath(stateDir) {
  return path.join(stateDir, CUTOFF_CACHE_FILENAME);
}

/**
 * Load the whole cutoff cache (best-effort). A missing / corrupt file yields an
 * empty cache so the first run after enabling the flag re-embeds normally and
 * then populates the cache.
 *
 * @param {string} stateDir
 * @returns {{version: number, files: Record<string, {embeddingInputHashes: string[], liInputHashes: string[]}>}}
 */
export function loadCutoffCache(stateDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(stateDir), 'utf8'));
    if (parsed && parsed.version === CUTOFF_CACHE_VERSION && parsed.files && typeof parsed.files === 'object') {
      return parsed;
    }
  } catch {
    // missing / unreadable / version-skew → empty
  }
  return { version: CUTOFF_CACHE_VERSION, files: {} };
}

/**
 * Look up one file's persisted signature.
 *
 * @param {{files: Record<string, object>}} cache
 * @param {string} relativePath
 * @returns {{embeddingInputHashes: string[], liInputHashes: string[]}|null}
 */
export function getFileSignature(cache, relativePath) {
  return cache?.files?.[relativePath] || null;
}

/**
 * Record a file's new signature into an in-memory cache object (mutates it).
 * Persist with `saveCutoffCache` once at tick-finalize.
 *
 * @param {{files: Record<string, object>}} cache
 * @param {string} relativePath
 * @param {{embeddingInputHashes: string[], liInputHashes: string[]}} signature
 */
export function setFileSignature(cache, relativePath, signature) {
  if (!cache.files) cache.files = {};
  cache.files[relativePath] = {
    embeddingInputHashes: [...(signature.embeddingInputHashes || [])],
    liInputHashes: [...(signature.liInputHashes || [])],
  };
}

/**
 * Drop a file from the cache (deletion / retirement).
 *
 * @param {{files: Record<string, object>}} cache
 * @param {string} relativePath
 */
export function deleteFileSignature(cache, relativePath) {
  if (cache?.files) delete cache.files[relativePath];
}

/**
 * Persist the cutoff cache atomically (temp-file + rename). Best-effort: a
 * write failure leaves the previous cache in place, which only costs a redundant
 * re-embed on the next tick — never a correctness loss.
 *
 * @param {string} stateDir
 * @param {{version: number, files: Record<string, object>}} cache
 */
export function saveCutoffCache(stateDir, cache) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const filePath = cachePath(stateDir);
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ version: CUTOFF_CACHE_VERSION, files: cache?.files || {} }));
    fs.renameSync(tmp, filePath);
  } catch {
    // best-effort; never throw on the maintainer path
  }
}
