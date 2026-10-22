/**
 * Encoder child process for the index maintainer (see encoder-client.mjs).
 *
 * Holds the dense and late-interaction ONNX sessions so the maintainer itself
 * stays small. The client stops this process after an idle period; process exit
 * is the only way to return everything the models and their activations took
 * (ORT session release leaves several hundred MB behind, #25325). Inherits the
 * maintainer's environment and nice value.
 *
 * Protocol (advanced IPC serialization, so typed arrays pass as-is):
 *   request  { id, op, texts, options }
 *     maintainer role: 'dense' | 'li' | 'count' | 'warm'
 *     query role (search daemon, SWEET_SEARCH_ENCODER_ROLE=query): 'local-model' |
 *       'local-model-bucketed' (callLocalModel*, texts already prefixed by the caller),
 *       'li-query' (encodeQuery of texts[0]), 'warm-query'
 *   reply    { id, ok: true, result, provenance, rss } | { id, ok: false, error, rss }
 *   progress { id, progress: true }   (dense encodes, per batch)
 */

import { getEmbeddings } from '../embedding/embedding-service.js';
import { countDocumentTokensCpu, encodeDocumentsCpu, encodeQuery, getLateInteractionPipeline } from '../ranking/late-interaction-model.js';
import { callLocalModel, callLocalModelBucketed, getLocalPipeline } from '../embedding/embedding-local-model.js';
import { takeProvenance } from './inference-provenance.js';
import { applyPersistedLiModel } from '../infrastructure/init-config.js';
import { armBackgroundOrtProfiles } from './model-pool.js';
import { setProcessTitle } from '../infrastructure/process-title.js';

// The search daemon's query models run here too (queryRole), at the daemon's own
// priority and threads: a query waits on them, so no background profile.
const queryRole = process.env.SWEET_SEARCH_ENCODER_ROLE === 'query';
setProcessTitle(queryRole ? 'sweet-search-query-encoder' : 'sweet-search-encoder');

const projectRoot = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
if (!queryRole) armBackgroundOrtProfiles();

const send = (msg) => { try { process.send(msg); } catch { /* parent gone */ } };

async function run(op, texts, id, options = {}) {
  // The maintainer re-applies the persisted LI model choice every tick; mirror it.
  applyPersistedLiModel(projectRoot);
  if (op === 'dense') {
    return getEmbeddings(texts, { useCache: false, onProgress: () => send({ id, progress: true }) });
  }
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

process.on('message', async (msg) => {
  const { id, op, texts, options } = msg || {};
  try {
    const result = await run(op, texts, id, options);
    send({ id, ok: true, result, provenance: takeProvenance(), rss: process.memoryUsage.rss() });
  } catch (err) {
    send({ id, ok: false, error: String(err?.stack || err?.message || err), rss: process.memoryUsage.rss() });
  }
});

// The maintainer exited or stopped us: nothing left to serve.
process.on('disconnect', () => process.exit(0));
