/**
 * G8 — Shared model server: the resident-model SERVER process.
 *
 * Loads the ONNX embedding model ONCE and serves embedding requests for many
 * per-repo daemons over a Unix domain socket, saving N−1 model copies
 * (~10 GB across 8 repos), keeping per-repo crash isolation, and making
 * per-repo state cheap to evict.
 *
 * It also cleanly resolves G3's process-global ORT-config contamination: this
 * process can opt into the background ORT profile (force_spinning_stop +
 * arena-off + clamped intra-op threads) WITHOUT affecting any query-serving
 * process, because the model lives here and nowhere else. Opt in with
 * `SWEET_SEARCH_MODEL_SERVER_BACKGROUND=1` (or pass `{ background: true }` to
 * `startModelServer`); off by default.
 *
 * Wire protocol + codec live in `model-client.mjs` (single source of truth);
 * this module imports them so framing/serialization can never drift between
 * the two sides. Embeddings travel as RAW Float32 little-endian bytes →
 * byte-identical to the in-process path (same model, same preprocessing).
 *
 * Gate: only started when `SWEET_SEARCH_SHARED_MODEL_SERVER==='1'`
 * (the launcher checks this); the in-process embedding path is the default and
 * is completely untouched when the flag is off.
 */

import net from 'node:net';
import fs from 'node:fs';

import {
  encodeFrame,
  FrameDecoder,
  packEmbeddings,
  modelServerSocketPath,
  PROTOCOL_VERSION,
} from './model-client.mjs';

import {
  callLocalModelBucketed,
  configureLocalModelRuntime,
} from './embedding-local-model.js';

/**
 * Compute the embeddings for one request. Routes through the SAME bucketed
 * local-model path the in-process embedding service uses for the `local`
 * provider, so the output Float32 vectors are byte-identical to in-process.
 *
 * Exported so the parity test can exercise the exact server-side code path
 * headlessly (no socket).
 */
export async function computeEmbeddingsForRequest(texts, providerOptions = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const bucketOptions = {
    maxLength: providerOptions.maxLength,
    hardCap: providerOptions.hardCap,
    resolveHardCap: providerOptions.resolveHardCap,
    batchingSafety: providerOptions.batchingSafety,
    // onProgress is a function → not serializable over the wire; never set.
  };
  return callLocalModelBucketed(texts, bucketOptions);
}

/**
 * Handle one decoded request frame for a connected client. Writes exactly one
 * reply frame back. Pure wire glue around `computeEmbeddingsForRequest`.
 */
async function handleRequestFrame(socket, header) {
  if (!header || typeof header !== 'object') return;

  if (header.type === 'ping') {
    socket.write(encodeFrame({ type: 'pong', v: PROTOCOL_VERSION }));
    return;
  }

  if (header.type === 'getEmbeddings') {
    const requestId = header.requestId;
    try {
      const embeddings = await computeEmbeddingsForRequest(
        header.texts || [],
        header.providerOptions || {},
      );
      const { payload, dims } = packEmbeddings(embeddings);
      socket.write(encodeFrame({ type: 'embeddings', requestId, dims, v: PROTOCOL_VERSION }, payload));
    } catch (err) {
      socket.write(encodeFrame({
        type: 'error',
        requestId,
        message: err?.message || String(err),
        v: PROTOCOL_VERSION,
      }));
    }
    return;
  }

  // Unknown request type — reply with a structured error (client falls back).
  socket.write(encodeFrame({
    type: 'error',
    requestId: header.requestId,
    message: `unknown request type: ${header.type}`,
    v: PROTOCOL_VERSION,
  }));
}

/**
 * Wire a connected socket to the request handler. Concurrent clients are
 * supported: each connection gets its own decoder and requests are processed
 * as their frames complete. Robust to fragmentation and to client disconnects.
 */
export function attachConnection(socket) {
  socket.on('error', () => { /* client vanished — ignore, keep server up */ });
  const decoder = new FrameDecoder((header, _payload, err) => {
    if (err) {
      try { socket.destroy(); } catch { /* ignore */ }
      return;
    }
    // Fire-and-forget per frame; the handler writes its own reply. We never
    // let one client's failure take down the server.
    handleRequestFrame(socket, header).catch(() => {
      try {
        socket.write(encodeFrame({
          type: 'error',
          requestId: header?.requestId,
          message: 'internal model-server error',
          v: PROTOCOL_VERSION,
        }));
      } catch { /* socket gone */ }
    });
  });
  socket.on('data', (chunk) => decoder.push(chunk));
}

/**
 * Start the shared model server. Binds the Unix socket, applies the background
 * ORT profile (if requested) BEFORE the first encode (the local model is a
 * singleton built on first encode — configuring after would be a silent
 * no-op), and serves until `close()` is called.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.socketPath]  override the socket path.
 * @param {boolean} [opts.background]  opt into the bg ORT profile for THIS
 *                                     process only (default from env gate).
 * @returns {Promise<{ socketPath, server, close }>}
 */
export async function startModelServer(opts = {}) {
  const socketPath = opts.socketPath || modelServerSocketPath();
  const background = opts.background
    ?? (process.env.SWEET_SEARCH_MODEL_SERVER_BACKGROUND === '1');

  // Configure the resident model's runtime profile up front. This process owns
  // the only model copy, so bg-profiling here cannot throttle any query server.
  if (background) {
    try {
      configureLocalModelRuntime({ background: true });
    } catch (err) {
      // Best-effort: never let profile config abort server startup.
      if (process.env.DEBUG_CATCHES) {
        process.stderr.write(`[model-server] bg profile config failed: ${err?.message || err}\n`);
      }
    }
  }

  // Remove any stale socket left by a crashed predecessor.
  try { fs.unlinkSync(socketPath); } catch { /* none / not ours — listen() will error if truly busy */ }

  const server = net.createServer((socket) => attachConnection(socket));

  await new Promise((resolve, reject) => {
    const onErr = (err) => { server.off('listening', onOk); reject(err); };
    const onOk = () => { server.off('error', onErr); resolve(); };
    server.once('error', onErr);
    server.once('listening', onOk);
    // Restrict permissions on the socket file (owner-only).
    const prevUmask = process.umask(0o077);
    try {
      server.listen(socketPath);
    } finally {
      process.umask(prevUmask);
    }
  });

  // Belt-and-suspenders: chmod explicitly in case umask was ineffective.
  try { fs.chmodSync(socketPath, 0o700); } catch { /* best-effort */ }

  const close = () => new Promise((resolve) => {
    try {
      server.close(() => {
        try { fs.unlinkSync(socketPath); } catch { /* already gone */ }
        resolve();
      });
    } catch {
      resolve();
    }
  });

  return { socketPath, server, close };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────
// Allow `node core/embedding/model-server.mjs` to run a standalone server.
// Guarded so importing this module (tests, launcher) never auto-binds.
const _isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (_isMain) {
  startModelServer()
    .then(({ socketPath }) => {
      process.stdout.write(`[model-server] listening on ${socketPath}\n`);
    })
    .catch((err) => {
      process.stderr.write(`[model-server] failed to start: ${err?.message || err}\n`);
      process.exit(1);
    });
}
