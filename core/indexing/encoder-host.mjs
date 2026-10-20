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
 *   request  { id, op: 'dense' | 'li' | 'count', texts }
 *   reply    { id, ok: true, result, provenance, rss } | { id, ok: false, error, rss }
 *   progress { id, progress: true }   (dense encodes, per batch)
 */

import { getEmbeddings } from '../embedding/embedding-service.js';
import { countDocumentTokensCpu, encodeDocumentsCpu } from '../ranking/late-interaction-model.js';
import { takeProvenance } from './inference-provenance.js';
import { applyPersistedLiModel } from '../infrastructure/init-config.js';
import { armBackgroundOrtProfiles } from './model-pool.js';

try { process.title = 'sweet-search-encoder'; } catch { /* cosmetic */ }

const projectRoot = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
if (process.env.SWEET_SEARCH_ORT_BACKGROUND !== '0') armBackgroundOrtProfiles();

const send = (msg) => { try { process.send(msg); } catch { /* parent gone */ } };

async function run(op, texts, id) {
  // The maintainer re-applies the persisted LI model choice every tick; mirror it.
  applyPersistedLiModel(projectRoot);
  if (op === 'dense') {
    return getEmbeddings(texts, { useCache: false, onProgress: () => send({ id, progress: true }) });
  }
  if (op === 'li') return encodeDocumentsCpu(texts);
  if (op === 'count') return countDocumentTokensCpu(texts);
  throw new Error(`unknown encoder op: ${op}`);
}

process.on('message', async (msg) => {
  const { id, op, texts } = msg || {};
  try {
    const result = await run(op, texts, id);
    send({ id, ok: true, result, provenance: takeProvenance(), rss: process.memoryUsage.rss() });
  } catch (err) {
    send({ id, ok: false, error: String(err?.stack || err?.message || err), rss: process.memoryUsage.rss() });
  }
});

// The maintainer exited or stopped us: nothing left to serve.
process.on('disconnect', () => process.exit(0));
