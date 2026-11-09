/**
 * Per-chunk row recipe shared by every index build: the chunk id, the
 * chunk's file path, the embedding-text cap and fallback, and the text the
 * late-interaction encoder reads. The full build (indexer-build.js,
 * streaming-vectors.js, indexer-ann.js) and the incremental reconciler call
 * these so both write the same rows for the same file.
 */

import { JAVA_FAMILY } from './chunking/java-family.js';

/**
 * Cap on `embedding_text`, `li_text`, `li_greedy_text` and the enriched form:
 * SWEET_SEARCH_EMBED_TEXT_CAP when it is an integer of at least 500, else 2000.
 *
 * The May-2026 chunk-overflow audit found 80.5% of overflowing chunks are
 * header-pushed (raw content <= 2000, headers push the embedding text over),
 * which motivated an A/B against slightly larger caps. See
 * eval/results/chunk-overflow-audit.md and eval/run_overflow_ablation.sh.
 * This does NOT alter the chunker max size; that is
 * SWEET_SEARCH_CHUNK_HEADER_OVERHEAD in tree-sitter-provider.js.
 */
export function embedTextCap() {
  const v = parseInt(process.env.SWEET_SEARCH_EMBED_TEXT_CAP || '', 10);
  return Number.isFinite(v) && v >= 500 ? v : 2000;
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

/** Project-relative POSIX path of a chunk's file, or '' when none is safe. */
export function chunkFilePath(chunk) {
  return firstSafeRelativePath(
    chunk?.metadata?.relative_path,
    chunk?.metadata?.path,
    chunk?.metadata?.file_path,
    chunk?.file,
    chunk?.metadata?.file,
  ) || '';
}

/** Id of the `index`-th chunk parsed from `file`. */
export function chunkIdOf(file, chunk, index) {
  const lineStart = chunk.metadata?.line_start || 0;
  const lineEnd = chunk.metadata?.line_end || lineStart;
  return `${file}:${lineStart}-${lineEnd}:${index}`;
}

/** Text the dense encoder reads for a chunk, cut to `cap`. */
export function embedTextOf(chunk, cap) {
  if (chunk.embedding_text) return chunk.embedding_text.slice(0, cap);
  return `${chunkFilePath(chunk)} ${chunk.metadata?.symbol || ''}\n${(chunk.text || chunk.content || '').slice(0, 1500)}`;
}

/**
 * v6.2: language-family-conditioned LI input routing.
 *
 * Per-language ablation on GenCodeSearchNet (May 2026, see
 * docs/JS_CHUNK_BLEEDING_ANALYSIS.md) determined that different
 * languages benefit from different metadata richness in the late-
 * interaction MaxSim input. v6.2 picks empirically:
 *
 *   chunk.li_text  (simple, per-lang path policy in chunker):
 *     - python (no path; at 97% ceiling, path duplicated funcname)
 *     - JAVA_FAMILY: java, php, csharp/c#, kotlin, scala
 *       (slug-stripped path; framework signal preserved, hashed-slug
 *       noise removed)
 *
 *   chunk.embedding_text (greedy enriched; Scope + Defines + Uses):
 *     - javascript, typescript, jsx, tsx (closures + imports help)
 *     - ruby, go, c, cpp, c++, rust
 *     - any unknown language as the safe fallback
 *
 * The Java-family set is the chunker's own (`JAVA_FAMILY`), so this routing and the
 * path policy inside the chunker read one list.
 *
 * In production `li_greedy_text` equals `embedding_text`; it differs only under a research
 * embedding variant (SWEET_SEARCH_EMBED_TEXT_VARIANT), where it keeps the shipped form so
 * the variant cannot change the LI input.
 */
export function pickLiInput(chunk) {
  const lang = chunk?.metadata?.language;
  if (lang === 'python' || JAVA_FAMILY.has(lang)) {
    return chunk.li_text || chunk.embedding_text || chunk.text || chunk.content || '';
  }
  return chunk.li_greedy_text || chunk.embedding_text || chunk.li_text || chunk.text || chunk.content || '';
}
