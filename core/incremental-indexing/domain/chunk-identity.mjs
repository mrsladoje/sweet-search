/**
 * Stable AST-structural chunk identity.
 *
 * Plan § 7.2 makes the positional `chunk_id` from `ast-chunker.js` the
 * single biggest defeat of incremental encode-skip: inserting one
 * function at the top of a file shifts every downstream `parentCounter`
 * → every chunk ID changes → cache-miss on every chunk → projected 10×
 * CPU saving collapses to 0. The fix is a content-anchored identity that
 * survives whitespace edits, import shuffles, and insertions.
 *
 * Two regimes:
 *
 * 1. **Symbol-attached chunks** (functions, methods, classes, structs,
 *    etc.). The identity binds to the containing symbol path plus the
 *    whitespace-normalised signature line:
 *
 *        struct_id = hash(file_path || parent_symbol_path || symbol_name || signature_norm)
 *
 *    Renaming the function flips the ID for the renamed chunk only.
 *    Reordering siblings, inserting a new function above, or
 *    re-indenting the file is invisible.
 *
 * 2. **Anonymous chunks** (file headers, JSX blocks, free-form
 *    statements, regex-split sub-chunks). The identity binds to a
 *    rolling hash of normalised content under the parent symbol path,
 *    PLUS a mandatory `occurrence_index_in_parent` suffix:
 *
 *        struct_id = hash(file_path || parent_symbol_path || rolling_hash) || '_' || occurrence_index
 *
 *    The occurrence index is the *count of preceding siblings with the
 *    same `(rolling_hash, parent_symbol_path)` tuple* — not the absolute
 *    sibling index. This guarantees that two distinct sibling chunks
 *    keep distinct IDs even when they sit between identical pairs, and
 *    that two identical siblings keep distinct IDs because their
 *    occurrence-in-population is different (`_0`, `_1`, ...). See plan
 *    § 7.2 "occurrence index ... is mandatory" and § 33 unit-test
 *    coverage requirements for the renamed-one-of-two case.
 *
 * Fallback: parser failure or no AST metadata → use the existing
 * positional `chunk_id` and set `structural = false`. Downstream
 * dedup paths still hash the chunk content, so the worst-case is no
 * structural savings for that one chunk.
 *
 * This module is pure domain logic. It must not import the chunker,
 * SQLite, the encoder pool, or any infrastructure adapter.
 */

import { contentHashSync } from '../infrastructure/hashing.mjs';

/**
 * Normalise whitespace in a signature for hashing. Collapses runs of
 * whitespace into a single space, trims the result, and drops trailing
 * `=> {` / `{` braces so e.g.
 *   `async function foo (a , b ) {`
 *   `async function foo(a, b) {`
 * hash identically.
 *
 * @param {string} signature
 * @returns {string}
 */
export function normalizeSignature(signature) {
  if (typeof signature !== 'string') return '';
  return signature
    .replace(/[\s ]+/g, ' ')
    .replace(/\s*\{\s*$/, '')
    .replace(/\s*([(),:;<>=\[\]])\s*/g, '$1')
    .trim();
}

/**
 * Normalise an anonymous chunk's content for rolling-hash purposes.
 * Drops leading/trailing whitespace, collapses internal whitespace runs,
 * and removes blank lines so format-on-save edits cancel.
 *
 * Intentionally does NOT strip comments — comment edits should change
 * the encoder input and therefore the dense embedding, but they do not
 * change the chunk's identity in v1 unless the chunker drops them in a
 * subsequent pass.
 *
 * @param {string} content
 * @returns {string}
 */
export function normalizeAnonymousContent(content) {
  if (typeof content !== 'string') return '';
  // 1. Collapse internal runs of whitespace (preserving newlines so the
  //    rolling hash still distinguishes multi-line forms from one-line
  //    forms).
  // 2. Drop blank lines so format-on-save reflows are invisible.
  // 3. Trim leading/trailing whitespace overall.
  const collapsed = content.replace(/[ \t]+/g, ' ');
  const noBlanks = collapsed.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  return noBlanks;
}

/**
 * Build the parent-symbol path string used in both regimes. The chunker
 * may already provide `parent_symbol` and `parent_type`; we serialise
 * them as `type:name` and join with `/` for any hierarchy ancestors so
 * `Foo.bar.baz` and `module:Foo / class:Foo / method:bar / lambda:baz`
 * survive sibling-rename without collision.
 *
 * Accepted shapes:
 *   - `chunk.metadata.parent_path` — pre-joined `/`-separated string
 *   - `chunk.metadata.parent_symbol` plus `chunk.metadata.parent_type`
 *   - undefined → empty string (top-level)
 *
 * @param {object} metadata
 * @returns {string}
 */
export function parentSymbolPath(metadata) {
  if (!metadata) return '';
  if (typeof metadata.parent_path === 'string' && metadata.parent_path.length > 0) {
    return metadata.parent_path;
  }
  const parent = metadata.parent_symbol;
  const parentType = metadata.parent_type;
  if (parent && parentType) return `${parentType}:${parent}`;
  if (parent) return `:${parent}`;
  return '';
}

/**
 * Determine whether a chunk is symbol-attached for identity purposes.
 *
 * @param {object} chunk
 * @returns {boolean}
 */
export function isSymbolAttached(chunk) {
  if (!chunk || !chunk.metadata) return false;
  const symbol = chunk.metadata.symbol;
  const chunkType = chunk.metadata.chunk_type;
  if (!symbol || symbol === 'unknown' || symbol === 'code') return false;
  if (!chunkType) return false;
  // Treat anything that names a callable / class / module as symbol-
  // attached. The chunker emits chunk_type values like 'function',
  // 'method', 'class', 'struct', 'interface', 'enum', 'module',
  // 'namespace', plus 'code'/'plain'/'doc' for non-symbol chunks.
  return chunkType !== 'code' && chunkType !== 'plain' && chunkType !== 'doc' && chunkType !== 'text';
}

/**
 * Compute the rolling content hash used by anonymous chunk identity.
 *
 * @param {string} content
 * @returns {string}
 */
export function rollingContentHash(content) {
  return contentHashSync(normalizeAnonymousContent(content));
}

/**
 * Derive a stable structural ID for a single chunk.
 *
 * Returns:
 *   {
 *     chunkStructId: string,
 *     structural: boolean,
 *     rollingHash: string | null,
 *     reason: 'symbol' | 'anonymous' | 'fallback',
 *   }
 *
 * Callers MUST provide the occurrence index when `structural=true` and
 * `reason='anonymous'`; the convenience wrapper
 * `assignStructuralIds(chunks, filePath)` below computes the indices in
 * a single pass and is the recommended entry point.
 *
 * @param {object} chunk
 * @param {string} filePath
 * @param {number|null} occurrenceIndex  Mandatory for anonymous chunks.
 * @returns {{chunkStructId:string, structural:boolean, rollingHash:string|null, reason:'symbol'|'anonymous'|'fallback'}}
 */
export function deriveStructuralId(chunk, filePath, occurrenceIndex) {
  if (!chunk || typeof filePath !== 'string') {
    return { chunkStructId: '', structural: false, rollingHash: null, reason: 'fallback' };
  }
  const metadata = chunk.metadata || {};
  const parentPath = parentSymbolPath(metadata);

  if (isSymbolAttached(chunk)) {
    const signature = metadata.signature || metadata.symbol_signature || '';
    const sigNorm = normalizeSignature(signature);
    const sigSource = sigNorm.length > 0 ? sigNorm : `${metadata.chunk_type || ''}:${metadata.symbol || ''}`;
    const id = contentHashSync(
      `${filePath}\0${parentPath}\0${metadata.symbol}\0${sigSource}`,
    );
    return {
      chunkStructId: id,
      structural: true,
      rollingHash: null,
      reason: 'symbol',
    };
  }

  // Anonymous regime.
  if (occurrenceIndex == null || !Number.isFinite(occurrenceIndex) || occurrenceIndex < 0) {
    // Per plan § 7.2, an anonymous chunk without an occurrence index is a
    // bug at the call site, NOT a fallback opportunity. The wrapper below
    // always supplies one; callers reaching this branch directly are
    // misusing the API.
    return { chunkStructId: '', structural: false, rollingHash: null, reason: 'fallback' };
  }
  const text = chunk.content || chunk.text || '';
  const rolling = rollingContentHash(text);
  const id =
    contentHashSync(`${filePath}\0${parentPath}\0${rolling}`) + '_' + occurrenceIndex;
  return {
    chunkStructId: id,
    structural: true,
    rollingHash: rolling,
    reason: 'anonymous',
  };
}

/**
 * Assign stable structural IDs across an ordered chunk list for one file.
 *
 * Pass order:
 *   1. First pass: classify each chunk as symbol-attached / anonymous,
 *      compute rolling hashes for anonymous chunks.
 *   2. Second pass: number anonymous chunks within each
 *      `(parent_path, rolling_hash)` population (occurrence_index_in_parent).
 *   3. Emit a parallel array of structural-id records aligned with the
 *      input chunk list.
 *
 * Mutating the input chunks is intentionally avoided here; the caller
 * decides whether to write the IDs onto chunks, into a SQL transaction,
 * or both.
 *
 * @param {Array<object>} chunks
 * @param {string} filePath
 * @returns {Array<{chunkStructId:string, structural:boolean, rollingHash:string|null, reason:'symbol'|'anonymous'|'fallback', occurrenceIndex:number|null}>}
 */
export function assignStructuralIds(chunks, filePath) {
  if (!Array.isArray(chunks)) return [];
  const out = new Array(chunks.length);
  const populationCount = new Map();
  const symbolIdCount = new Map();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (isSymbolAttached(chunk)) {
      const derived = deriveStructuralId(chunk, filePath, null);
      // Two chunks with the same path, symbol and signature (the same
      // declaration in both branches of an `#if`) would share one id, and
      // the reconciler would retire the wrong row: the second and later
      // ones get an occurrence suffix.
      const seen = symbolIdCount.get(derived.chunkStructId) || 0;
      symbolIdCount.set(derived.chunkStructId, seen + 1);
      if (seen > 0) {
        out[i] = { ...derived, chunkStructId: `${derived.chunkStructId}_${seen}`, occurrenceIndex: seen };
      } else {
        out[i] = { ...derived, occurrenceIndex: null };
      }
      continue;
    }
    // Anonymous chunk: compute population key, occurrence index, then derive.
    const parentPath = parentSymbolPath(chunk?.metadata || {});
    const text = chunk?.content || chunk?.text || '';
    const rolling = rollingContentHash(text);
    const key = `${parentPath}\0${rolling}`;
    const idx = populationCount.get(key) || 0;
    populationCount.set(key, idx + 1);

    const derived = deriveStructuralId(chunk, filePath, idx);
    out[i] = { ...derived, occurrenceIndex: idx };
  }

  return out;
}

export const __testing = { isSymbolAttached, parentSymbolPath, normalizeSignature, normalizeAnonymousContent };
