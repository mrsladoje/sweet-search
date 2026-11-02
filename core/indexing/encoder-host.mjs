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

import { runEncoderOp, takeProvenance } from './encoder-ops.mjs';
import { armBackgroundOrtProfiles } from './model-pool.js';
import { setProcessTitle } from '../infrastructure/process-title.js';

// The search daemon's query models run here too (queryRole), at the daemon's own
// priority and threads: a query waits on them, so no background profile.
const queryRole = process.env.SWEET_SEARCH_ENCODER_ROLE === 'query';
setProcessTitle(queryRole ? 'sweet-search-query-encoder' : 'sweet-search-encoder');

const projectRoot = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
if (!queryRole) armBackgroundOrtProfiles();

const send = (msg) => { try { process.send(msg); } catch { /* parent gone */ } };

process.on('message', async (msg) => {
  const { id, op, texts, options } = msg || {};
  try {
    const result = await runEncoderOp(op, texts, { projectRoot, options, onProgress: () => send({ id, progress: true }) });
    send({ id, ok: true, result, provenance: takeProvenance(), rss: process.memoryUsage.rss() });
  } catch (err) {
    send({ id, ok: false, error: String(err?.stack || err?.message || err), rss: process.memoryUsage.rss() });
  }
});

// The maintainer exited or stopped us: nothing left to serve.
process.on('disconnect', () => process.exit(0));
