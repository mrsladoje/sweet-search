/**
 * JS bridge to the CoreML Python embedding server.
 *
 * Spawns coreml_embedding_server.py as a long-lived child process and exposes
 * an object that matches the napi NativeEmbeddingModel contract:
 *   - .dim getter (returns 768)
 *   - .embedBatch(inputIds, attentionMask) → Promise<number[][]>
 *
 * Used by core/infrastructure/native-inference.js when SWEET_SEARCH_INFERENCE_BACKEND=coreml.
 *
 * IPC: 4-byte big-endian length prefix + UTF-8 JSON body. Same format both ways.
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON = join(HERE, '.venv', 'bin', 'python');
const SERVER = join(HERE, 'coreml_embedding_server.py');

class CoremlEmbeddingBridge {
  constructor() {
    this._proc = null;
    this._dim = 768;
    this._readyPromise = null;
    this._nextId = 1;
    this._pending = new Map(); // id → { resolve, reject }
    this._readBuf = Buffer.alloc(0);
  }

  static async load() {
    const bridge = new CoremlEmbeddingBridge();
    await bridge._spawn();
    return bridge;
  }

  get dim() {
    return this._dim;
  }

  async _spawn() {
    if (!existsSync(PYTHON)) throw new Error(`[coreml-bridge] python not found at ${PYTHON} — run scripts/spike-coreml/.venv setup`);
    if (!existsSync(SERVER)) throw new Error(`[coreml-bridge] server not found at ${SERVER}`);

    console.error(`[coreml-bridge] spawning ${PYTHON} ${SERVER}`);
    this._proc = spawn(PYTHON, [SERVER], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._proc.stderr.on('data', (chunk) => {
      process.stderr.write(`[coreml-server] ${chunk.toString()}`);
    });

    // Kill the python child when this Node process exits so it doesn't get
    // orphaned. process.on('exit') runs synchronously during Node teardown.
    process.on('exit', () => {
      try { this._proc?.kill('SIGTERM'); } catch {}
    });

    this._proc.on('exit', (code, sig) => {
      console.error(`[coreml-bridge] server exited (code=${code}, sig=${sig})`);
      // Reject any outstanding requests
      for (const { reject } of this._pending.values()) {
        reject(new Error(`[coreml-bridge] server exited unexpectedly (code=${code})`));
      }
      this._pending.clear();
      this._proc = null;
    });

    this._proc.stdout.on('data', (chunk) => this._onData(chunk));

    // Wait for the ready handshake before resolving load()
    await new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
      // 60s timeout for model load (coreml first-load can be slow)
      this._readyTimer = setTimeout(() => {
        reject(new Error('[coreml-bridge] timed out waiting for server ready handshake (60s)'));
      }, 60_000);
    });
  }

  _onData(chunk) {
    console.error(`[coreml-bridge] _onData got ${chunk.length} bytes (buf was ${this._readBuf.length})`);
    this._readBuf = Buffer.concat([this._readBuf, chunk]);
    while (this._readBuf.length >= 4) {
      const length = this._readBuf.readUInt32BE(0);
      if (this._readBuf.length < 4 + length) break;
      const body = this._readBuf.slice(4, 4 + length);
      this._readBuf = this._readBuf.slice(4 + length);
      let msg;
      try {
        msg = JSON.parse(body.toString('utf-8'));
      } catch (err) {
        console.error('[coreml-bridge] failed to parse server message:', err.message);
        continue;
      }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    if (msg.event === 'ready') {
      this._dim = msg.dim;
      console.error(`[coreml-bridge] server ready (dim=${msg.dim}, shapes=${JSON.stringify(msg.shapes)})`);
      clearTimeout(this._readyTimer);
      const r = this._readyResolve;
      this._readyResolve = null;
      this._readyReject = null;
      if (r) r();
      return;
    }
    const id = msg.id;
    const pending = this._pending.get(id);
    if (!pending) {
      console.error(`[coreml-bridge] no pending request for id=${id}`);
      return;
    }
    this._pending.delete(id);
    if (msg.error) {
      pending.reject(new Error(`[coreml-bridge] server error: ${msg.error}`));
    } else {
      pending.resolve(msg);
    }
  }

  _send(payload) {
    if (!this._proc) return Promise.reject(new Error('[coreml-bridge] server not running'));
    const id = this._nextId++;
    payload.id = id;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      const body = Buffer.from(JSON.stringify(payload), 'utf-8');
      const frame = Buffer.alloc(4 + body.length);
      frame.writeUInt32BE(body.length, 0);
      body.copy(frame, 4);
      console.error(`[coreml-bridge] _send id=${id} op=${payload.op} bytes=${frame.length}`);
      const ok = this._proc.stdin.write(frame, (err) => {
        if (err) console.error(`[coreml-bridge] stdin.write callback error:`, err);
        else console.error(`[coreml-bridge] stdin.write callback ok id=${id}`);
      });
      console.error(`[coreml-bridge] stdin.write returned ${ok} for id=${id}`);
    });
  }

  /**
   * Match the napi NativeEmbeddingModel contract. After the typed-array
   * conversion in embedding_model.rs, the contract is now:
   *   embedBatch(inputIds, attentionMask) → Promise<Float32Array>
   * The returned typed array is flat with length = batch * dim. Caller
   * slices via `.slice(i * dim, (i + 1) * dim)` per batch row.
   */
  async embedBatch(inputIds, attentionMask) {
    const t0 = Date.now();
    const batch = inputIds.length;
    const seq = batch > 0 ? inputIds[0].length : 0;
    console.error(`[coreml-bridge] embedBatch entry: batch=${batch} seq=${seq}`);
    const reply = await this._send({
      op: 'embed_batch',
      input_ids: inputIds,
      attention_mask: attentionMask,
    });
    console.error(`[coreml-bridge] embedBatch reply in ${Date.now() - t0}ms`);
    // Flatten the python-bridge reply (number[][]) into a flat Float32Array
    // to match the new contract. This is a copy on the spike path; the real
    // production path is Rust-native objc2-core-ml which would emit the
    // typed array zero-copy.
    const nested = reply.embeddings;
    const dim = nested.length > 0 ? nested[0].length : 0;
    const flat = new Float32Array(nested.length * dim);
    for (let i = 0; i < nested.length; i++) {
      for (let j = 0; j < dim; j++) {
        flat[i * dim + j] = nested[i][j];
      }
    }
    return flat;
  }

  async shutdown() {
    if (!this._proc) return;
    try {
      await this._send({ op: 'shutdown' });
    } catch {
      // ignore — process is exiting
    }
    if (this._proc) this._proc.kill();
    this._proc = null;
  }
}

export { CoremlEmbeddingBridge };
