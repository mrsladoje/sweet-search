/**
 * G8 — Shared model server: RPC CLIENT + wire protocol codec.
 *
 * One ONNX model is loaded ONCE in a separate process (`model-server.mjs`);
 * per-repo daemons RPC to it for embeddings over a Unix domain socket. This
 * module is the CLIENT used by `embedding-service.js` when
 * `SWEET_SEARCH_SHARED_MODEL_SERVER==='1'`. It connects, sends `getEmbeddings`
 * requests, and falls back to in-process embedding when the socket is
 * unavailable (the caller catches and reverts — see the dispatch shim).
 *
 * Wire protocol (length-prefixed binary frames). Each frame is:
 *
 *   [4 bytes BE]  header JSON byte length  (H)
 *   [4 bytes BE]  payload byte length      (P)
 *   [H bytes]     UTF-8 JSON header        (type, metadata, dims, lengths…)
 *   [P bytes]     raw payload              (concatenated Float32 little-endian)
 *
 * CRITICAL byte-identity guarantee: embedding floats travel as RAW Float32
 * little-endian bytes in the payload, never JSON-stringified. The bytes the
 * server reads out of the model are the bytes the client reconstructs — a
 * pure transport hop, no lossy float→string→float round-trip. The codec here
 * is the single source of truth for that framing; the server imports it.
 *
 * This module owns NO model state and performs NO inference; it is pure
 * transport + (de)serialization, safe to import from any process.
 */

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Header lengths are 32-bit BE; payloads are bounded by the same width.
export const FRAME_HEADER_BYTES = 8; // 4 (header len) + 4 (payload len)
export const PROTOCOL_VERSION = 1;

/**
 * Resolve the shared model server's socket path. The model server is GLOBAL
 * (one per machine/user, shared across all repos) — unlike the per-project
 * search server — so the default socket is a single fixed path. A deep path
 * would overflow `sockaddr_un.sun_path` (~104 bytes on macOS), so we keep it
 * short under the OS temp dir. Override with `SWEET_SEARCH_MODEL_SOCKET_PATH`.
 */
export function modelServerSocketPath(env = process.env) {
  if (env.SWEET_SEARCH_MODEL_SOCKET_PATH) return env.SWEET_SEARCH_MODEL_SOCKET_PATH;
  // Scope by uid where available so multiple users don't collide on one path.
  let uidPart = '';
  try {
    if (typeof process.getuid === 'function') uidPart = `-${process.getuid()}`;
  } catch { /* getuid unavailable (e.g. Windows) — fall through */ }
  return path.join(os.tmpdir(), `sweet-search-model${uidPart}.sock`);
}

// ── Wire codec ────────────────────────────────────────────────────────────

/**
 * Encode a single frame. `header` is a JSON-serializable object; `payload` is
 * an optional Buffer of raw bytes (Float32 little-endian for embeddings).
 * Returns one Buffer ready to write to the socket.
 */
export function encodeFrame(header, payload = null) {
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const payloadBuf = payload || Buffer.alloc(0);
  const prefix = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  prefix.writeUInt32BE(headerJson.length, 0);
  prefix.writeUInt32BE(payloadBuf.length, 4);
  return Buffer.concat([prefix, headerJson, payloadBuf]);
}

/**
 * Incremental frame decoder. Feed it chunks; it emits whole frames via the
 * `onFrame(header, payloadBuffer)` callback. Handles TCP/stream fragmentation
 * (a frame split across many chunks, or many frames in one chunk).
 */
export class FrameDecoder {
  constructor(onFrame) {
    this._onFrame = onFrame;
    this._buf = Buffer.alloc(0);
  }

  push(chunk) {
    this._buf = this._buf.length === 0 ? chunk : Buffer.concat([this._buf, chunk]);
    // Drain as many complete frames as are buffered.
    for (;;) {
      if (this._buf.length < FRAME_HEADER_BYTES) return;
      const headerLen = this._buf.readUInt32BE(0);
      const payloadLen = this._buf.readUInt32BE(4);
      const total = FRAME_HEADER_BYTES + headerLen + payloadLen;
      if (this._buf.length < total) return; // wait for more bytes
      const headerJson = this._buf.toString('utf8', FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + headerLen);
      const payload = this._buf.subarray(FRAME_HEADER_BYTES + headerLen, total);
      // Copy the payload out so the retained buffer slice can be GC'd and the
      // caller owns a stable Buffer independent of our internal buffer.
      const payloadCopy = Buffer.from(payload);
      this._buf = this._buf.subarray(total);
      let header;
      try {
        header = JSON.parse(headerJson);
      } catch (err) {
        // A corrupt header is unrecoverable on a stream — surface and stop.
        this._onFrame(null, null, err);
        return;
      }
      this._onFrame(header, payloadCopy, null);
    }
  }
}

/**
 * Pack an array of embeddings (Float32Array | number[]) into one contiguous
 * Float32 little-endian payload + a per-vector length list (so ragged dims are
 * preserved exactly). Returns { payload: Buffer, dims: number[] }.
 *
 * We do NOT assume a fixed dimension: each vector's length is recorded so the
 * decode is exact even if a caller ever returns mixed-width vectors.
 */
export function packEmbeddings(embeddings) {
  const dims = new Array(embeddings.length);
  let totalFloats = 0;
  for (let i = 0; i < embeddings.length; i++) {
    const v = embeddings[i];
    const len = v == null ? 0 : v.length;
    dims[i] = len;
    totalFloats += len;
  }
  // One backing buffer; copy each vector's raw little-endian bytes in order.
  const out = Buffer.allocUnsafe(totalFloats * 4);
  let offset = 0;
  for (let i = 0; i < embeddings.length; i++) {
    const v = embeddings[i];
    if (!v || v.length === 0) continue;
    // Float32Array view over the SAME bytes — copy losslessly into `out`.
    const src = v instanceof Float32Array ? v : Float32Array.from(v);
    const srcBytes = Buffer.from(src.buffer, src.byteOffset, src.length * 4);
    srcBytes.copy(out, offset);
    offset += src.length * 4;
  }
  return { payload: out, dims };
}

/**
 * Inverse of `packEmbeddings`. Reconstructs an array of Float32Array from a
 * raw little-endian payload + per-vector dims. The reconstructed arrays are
 * byte-identical to the originals (same IEEE-754 bit patterns).
 */
export function unpackEmbeddings(payload, dims) {
  const out = new Array(dims.length);
  let floatOffset = 0;
  for (let i = 0; i < dims.length; i++) {
    const len = dims[i];
    const vec = new Float32Array(len);
    for (let j = 0; j < len; j++) {
      // Read each float by absolute byte offset to stay correct regardless of
      // payload alignment (Buffer is not guaranteed 4-byte aligned).
      vec[j] = payload.readFloatLE((floatOffset + j) * 4);
    }
    out[i] = vec;
    floatOffset += len;
  }
  return out;
}

// ── RPC client ──────────────────────────────────────────────────────────────

let _nextRequestId = 1;

/**
 * Send a single `getEmbeddings` RPC and resolve with Float32Array[] (one per
 * input text). Opens a fresh connection per call (simple, robust; the model
 * server multiplexes concurrent connections). REJECTS on any transport/server
 * error so the dispatch shim can fall back to in-process — it must NEVER throw
 * a value that looks like a successful (but wrong) result.
 *
 * @param {string[]} texts
 * @param {object}   [opts]
 * @param {object}   [opts.providerOptions] forwarded to the server-side embed.
 * @param {string}   [opts.socketPath]
 * @param {number}   [opts.timeoutMs]
 */
export function requestEmbeddings(texts, opts = {}) {
  const socketPath = opts.socketPath || modelServerSocketPath();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const providerOptions = opts.providerOptions || {};
  const requestId = _nextRequestId++;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      fn(arg);
    };

    const socket = net.connect(socketPath);
    const decoder = new FrameDecoder((header, payload, err) => {
      if (err) return finish(reject, err);
      if (header.type === 'error') {
        return finish(reject, new Error(header.message || 'model-server error'));
      }
      if (header.type === 'embeddings' && header.requestId === requestId) {
        try {
          const embeddings = unpackEmbeddings(payload, header.dims || []);
          return finish(resolve, embeddings);
        } catch (e) {
          return finish(reject, e);
        }
      }
      // Unknown / mismatched frame — treat as protocol error, fall back.
      finish(reject, new Error(`unexpected model-server frame: ${header.type}`));
    });

    const timer = setTimeout(() => finish(reject, new Error('model-server RPC timeout')), timeoutMs);

    socket.on('connect', () => {
      const frame = encodeFrame({
        type: 'getEmbeddings',
        v: PROTOCOL_VERSION,
        requestId,
        texts,
        providerOptions,
      });
      socket.write(frame);
    });
    socket.on('data', (chunk) => decoder.push(chunk));
    socket.on('error', (e) => finish(reject, e));
    socket.on('close', () => finish(reject, new Error('model-server connection closed before reply')));
  });
}

/**
 * Best-effort liveness probe: resolves true if the model server answers a
 * `ping` over the socket within `timeoutMs`, false otherwise. Never throws.
 */
export function pingModelServer(opts = {}) {
  const socketPath = opts.socketPath || modelServerSocketPath();
  const timeoutMs = opts.timeoutMs ?? 1_000;
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    const socket = net.connect(socketPath);
    const decoder = new FrameDecoder((header) => {
      done(!!header && header.type === 'pong');
    });
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.on('connect', () => socket.write(encodeFrame({ type: 'ping', v: PROTOCOL_VERSION })));
    socket.on('data', (chunk) => decoder.push(chunk));
    socket.on('error', () => done(false));
    socket.on('close', () => done(false));
  });
}
