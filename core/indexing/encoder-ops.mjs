/**
 * The encoder operations, shared by the per-process encoder child (encoder-host.mjs) and
 * the shared query-model server (core/search/query-encoder-server.mjs).
 *
 *   maintainer role: 'dense' | 'li' | 'count' | 'warm'
 *   query role: 'local-model' | 'local-model-bucketed' (callLocalModel*, texts already
 *     prefixed by the caller), 'li-query' (encodeQuery of texts[0]), 'warm-query'
 */

import { getEmbeddings } from '../embedding/embedding-service.js';
import { countDocumentTokensCpu, encodeDocumentsCpu, encodeQuery, getLateInteractionPipeline } from '../ranking/late-interaction-model.js';
import { callLocalModel, callLocalModelBucketed, getLocalPipeline } from '../embedding/embedding-local-model.js';
import { takeProvenance } from '../infrastructure/inference-provenance.js';
import { applyPersistedLiModel } from '../infrastructure/init-config.js';

/**
 * @param {string} op
 * @param {string[]} texts
 * @param {{projectRoot: string, options?: object, onProgress?: () => void}} ctx
 */
export async function runEncoderOp(op, texts, { projectRoot, options = {}, onProgress = () => {} }) {
  // The maintainer re-applies the persisted LI model choice every tick; mirror it.
  applyPersistedLiModel(projectRoot);
  if (op === 'dense') return getEmbeddings(texts, { useCache: false, onProgress });
  if (op === 'li') return encodeDocumentsCpu(texts);
  if (op === 'count') return countDocumentTokensCpu(texts);
  if (op === 'local-model') return callLocalModel(texts, options);
  if (op === 'local-model-bucketed') return callLocalModelBucketed(texts, options);
  if (op === 'li-query') return encodeQuery(texts[0]);
  if (op === 'warm-query') {
    await Promise.all([getLocalPipeline(), getLateInteractionPipeline()]);
    return null;
  }
  if (op === 'warm') {
    // Load both models at once, while the maintainer is still hashing and parsing.
    await Promise.all([getEmbeddings(['warm up'], { useCache: false }), encodeDocumentsCpu(['warm up'])]);
    takeProvenance(); // not an encode of the index
    return null;
  }
  throw new Error(`unknown encoder op: ${op}`);
}

export { takeProvenance };
