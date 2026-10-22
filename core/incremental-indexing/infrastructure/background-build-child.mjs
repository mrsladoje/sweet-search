/**
 * Child process of a background maintenance build (background-build.mjs): builds
 * a new base from a snapshot while the maintainer keeps ticking, then reports.
 * Runs at background priority.
 *   binary_hnsw: the graph base (hnsw-compaction.mjs buildCompactedBase)
 *   sparse_gram: the folded sparse-gram base (sparse-gram-fold.mjs buildSparseGramFold)
 */
import os from 'node:os';

try { process.title = 'sweet-search-compaction'; } catch { /* cosmetic */ }
try { os.setPriority(0, 19); } catch { /* not permitted */ }

const { kind, args } = JSON.parse(process.argv[2] || '{}');
try {
  let result;
  if (kind === 'binary_hnsw') {
    const { buildCompactedBase } = await import('./hnsw-compaction.mjs');
    result = await buildCompactedBase({ ...args, graph: true });
  } else if (kind === 'sparse_gram') {
    const { buildSparseGramFold } = await import('./sparse-gram-fold.mjs');
    result = await buildSparseGramFold(args);
  } else {
    throw new Error(`unknown background build: ${kind}`);
  }
  process.send?.({ ok: true, result });
} catch (err) {
  process.send?.({ ok: false, error: String(err?.stack || err?.message || err) });
}
process.disconnect?.();
