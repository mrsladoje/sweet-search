/**
 * Late Interaction skip policy compatibility exports.
 *
 * The shared implementation lives in `indexing-file-policy.js` so embedding,
 * sparse/BM25 artifacts, and LI all depend on one file-policy source.
 */

export {
  isExcludedByConfig,
  chunkLooksGenerated,
  _internals,
} from './indexing-file-policy.js';

export {
  applyIndexingChunkPolicy as applyLiSkipPolicy,
} from './indexing-file-policy.js';
