/**
 * The search daemon's query models (dense + late interaction) in a child process.
 *
 * A warm daemon held both ONNX sessions for its whole life (~940 MB footprint). Releasing
 * a session in-process gave back ~650 MB and leaked ~220 MB on every reload (ORT #25325),
 * so the models live in an encoder child (core/indexing/encoder-host.mjs, query role) that
 * exits after a long idle stretch; the next query starts it again (both models load in
 * parallel). The daemon keeps its query-embedding cache, provider fallback and query
 * prefix: only the model runs cross the process boundary (typed arrays, advanced IPC).
 */
import { createEncoderClient } from '../indexing/encoder-client.mjs';
import { setLocalModelDelegate } from '../embedding/embedding-local-model.js';
import { setLateInteractionQueryDelegate } from '../ranking/late-interaction-model.js';

export const DEFAULT_QUERY_MODEL_IDLE_MS = 15 * 60_000;

/** SWEET_SEARCH_QUERY_MODEL_IDLE_MS: idle time before the query-model process exits. */
export function queryModelIdleMs(env = process.env) {
  const n = Number(env.SWEET_SEARCH_QUERY_MODEL_IDLE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_QUERY_MODEL_IDLE_MS;
}

/**
 * Route this process's query-model runs to an idle-exiting child. Returns the client
 * (close it on shutdown).
 */
export function startQueryEncoder({ env = process.env, log = () => {}, hostPath, onChildChange } = {}) {
  const client = createEncoderClient({
    idleMs: queryModelIdleMs(env),
    env: { ...env, SWEET_SEARCH_ENCODER_ROLE: 'query' },
    log,
    // Model loading logs to stdout; this process's stdout may be a protocol (MCP).
    childStdout: 2,
    ...(hostPath ? { hostPath } : {}),
    ...(onChildChange ? { onChildChange } : {}),
  });
  const warm = () => client.request('warm-query', []);
  setLocalModelDelegate({ warm, run: (op, texts, options) => client.request(op, texts, options) });
  setLateInteractionQueryDelegate({ warm, liQuery: (text) => client.request('li-query', [text]) });
  /** Start the process and load the models if it is not running; do not wait. */
  client.prewarm = () => { if (!client.pid) warm().catch(() => {}); };
  return client;
}

/** Back to in-process models (tests). */
export function stopQueryEncoder(client) {
  setLocalModelDelegate(null);
  setLateInteractionQueryDelegate(null);
  client?.close();
}
