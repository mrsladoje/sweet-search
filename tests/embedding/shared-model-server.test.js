// G8 — Shared model server: wire-codec, client/server contract, and
// embedding parity (RPC result === in-process result, byte-identical Float32).
//
// The model server loads the ONNX model ONCE in a separate process; per-repo
// daemons RPC for embeddings over a Unix domain socket. The load-bearing
// correctness claim is BYTE-IDENTITY: an embedding fetched over the socket
// must equal the in-process embedding bit-for-bit (same model, same
// preprocessing — only a transport hop). We prove that here without loading
// the real ONNX model by:
//   1. exhaustively round-tripping the Float32 codec on adversarial bit
//      patterns (subnormals, ±Inf, NaN, extreme exponents, ±0), and
//   2. running a real Unix-socket server whose model is a deterministic stub,
//      then asserting the RPC bytes equal the stub's in-process bytes.
//
// Integration note: an end-to-end parity test against the *real* CodeRankEmbed
// ONNX model is intentionally NOT run here (it loads ~hundreds of MB of ORT
// session state, ~23s like the other gated heavy tests in this dir). The
// byte-identity guarantee holds transitively: the server calls the SAME
// `callLocalModelBucketed` the in-process path calls, and this file proves the
// transport hop is lossless, so RPC(model) === in-process(model) bit-for-bit.
// Run the heavy real-model parity check via the determinism harness (G0).

import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  encodeFrame,
  FrameDecoder,
  packEmbeddings,
  unpackEmbeddings,
  modelServerSocketPath,
  requestEmbeddings,
  pingModelServer,
} from '../../core/embedding/model-client.mjs';

// --- Deterministic stub for the resident model -----------------------------
// Mock the local-model module so the server's `callLocalModelBucketed` returns
// reproducible Float32 vectors WITHOUT loading ORT. The server and any
// in-process comparison call the SAME stub, so any byte mismatch is a pure
// transport/codec defect.
const stubEmbed = vi.fn(async (texts) => {
  return texts.map((t, i) => {
    const dim = 8;
    const v = new Float32Array(dim);
    for (let j = 0; j < dim; j++) {
      // A mix of ordinary, fractional, and high-precision values per text so a
      // lossy float→string→float hop would visibly corrupt them.
      v[j] = Math.fround(Math.sin((t.length + 1) * (i + 1) * (j + 1)) * 1234.56789);
    }
    return v;
  });
});

vi.mock('../../core/embedding/embedding-local-model.js', () => ({
  callLocalModelBucketed: (texts, opts) => stubEmbed(texts, opts),
  configureLocalModelRuntime: vi.fn(),
}));

// Imported AFTER the mock is declared (vi.mock is hoisted) so the server picks
// up the stub.
const { startModelServer, computeEmbeddingsForRequest } = await import(
  '../../core/embedding/model-server.mjs'
);

function tmpSocket(name) {
  return path.join(os.tmpdir(), `ss-g8-test-${process.pid}-${name}-${Date.now()}.sock`);
}

// =============================================================================
// 1. Float32 codec — lossless byte round-trip on adversarial bit patterns
// =============================================================================
describe('G8 codec — packEmbeddings/unpackEmbeddings byte-identity', () => {
  it('round-trips adversarial Float32 bit patterns bit-for-bit', () => {
    const tricky = new Float32Array([
      0, -0, 1, -1,
      Math.fround(0.1), Math.fround(-0.1),
      3.4028234663852886e38,   // ~FLT_MAX
      1.401298464324817e-45,   // smallest subnormal
      1.1754943508222875e-38,  // smallest normal
      Infinity, -Infinity, NaN,
      Math.fround(Math.PI), Math.fround(-Math.E),
    ]);
    const original = [tricky, new Float32Array([42]), new Float32Array(0)];

    const { payload, dims } = packEmbeddings(original);
    expect(dims).toEqual([tricky.length, 1, 0]);

    const restored = unpackEmbeddings(payload, dims);
    expect(restored.length).toBe(3);

    // Compare the raw IEEE-754 bit patterns, not numeric equality (NaN !== NaN
    // numerically but must be byte-preserved).
    const origBits = new Uint32Array(tricky.buffer.slice(0));
    const restBits = new Uint32Array(restored[0].buffer.slice(0));
    expect(Array.from(restBits)).toEqual(Array.from(origBits));
    expect(restored[1][0]).toBe(42);
    expect(restored[2].length).toBe(0);
  });

  it('preserves ragged per-vector dimensions exactly', () => {
    const original = [
      new Float32Array([1, 2, 3]),
      new Float32Array([4]),
      new Float32Array([5, 6, 7, 8, 9]),
    ];
    const { payload, dims } = packEmbeddings(original);
    const restored = unpackEmbeddings(payload, dims);
    expect(restored.map((v) => Array.from(v))).toEqual([
      [1, 2, 3], [4], [5, 6, 7, 8, 9],
    ]);
  });

  it('accepts number[] input and yields byte-identical Float32 on decode', () => {
    const original = [[Math.fround(0.333), Math.fround(-7.5)]];
    const { payload, dims } = packEmbeddings(original);
    const restored = unpackEmbeddings(payload, dims);
    expect(restored[0][0]).toBe(Math.fround(0.333));
    expect(restored[0][1]).toBe(Math.fround(-7.5));
  });
});

// =============================================================================
// 2. Frame codec — fragmentation & multiplexing
// =============================================================================
describe('G8 frame codec — FrameDecoder', () => {
  it('reassembles a frame split across arbitrary chunk boundaries', () => {
    const payload = Buffer.from(new Float32Array([1.5, -2.25, 3.75]).buffer);
    const frame = encodeFrame({ type: 'embeddings', requestId: 7, dims: [3] }, payload);

    const seen = [];
    const dec = new FrameDecoder((h, p, err) => seen.push({ h, p, err }));
    // Feed one byte at a time — the worst-case fragmentation.
    for (let i = 0; i < frame.length; i++) dec.push(frame.subarray(i, i + 1));

    expect(seen.length).toBe(1);
    expect(seen[0].err).toBeNull();
    expect(seen[0].h).toEqual({ type: 'embeddings', requestId: 7, dims: [3] });
    expect(Array.from(new Float32Array(seen[0].p.buffer, seen[0].p.byteOffset, 3)))
      .toEqual([1.5, -2.25, 3.75]);
  });

  it('drains multiple frames delivered in a single chunk', () => {
    const f1 = encodeFrame({ type: 'ping' });
    const f2 = encodeFrame({ type: 'pong' });
    const seen = [];
    const dec = new FrameDecoder((h) => seen.push(h.type));
    dec.push(Buffer.concat([f1, f2]));
    expect(seen).toEqual(['ping', 'pong']);
  });
});

// =============================================================================
// 3. Socket path derivation
// =============================================================================
describe('G8 modelServerSocketPath', () => {
  it('honours SWEET_SEARCH_MODEL_SOCKET_PATH override', () => {
    expect(modelServerSocketPath({ SWEET_SEARCH_MODEL_SOCKET_PATH: '/tmp/x.sock' }))
      .toBe('/tmp/x.sock');
  });
  it('defaults to a short global path under tmpdir (fits sun_path)', () => {
    const p = modelServerSocketPath({});
    expect(p.startsWith(os.tmpdir())).toBe(true);
    expect(p.endsWith('.sock')).toBe(true);
    expect(p.length).toBeLessThan(104); // sockaddr_un.sun_path cap on macOS
  });
});

// =============================================================================
// 4. Client/server contract + embedding PARITY over a real Unix socket
// =============================================================================
describe('G8 client/server contract + parity', () => {
  let handle;
  let socketPath;

  beforeEach(async () => {
    stubEmbed.mockClear();
    socketPath = tmpSocket('contract');
    handle = await startModelServer({ socketPath });
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = null;
  });

  it('round-trips getEmbeddings and the RPC result is BYTE-IDENTICAL to in-process', async () => {
    const texts = ['fn main()', 'class Foo {}', 'SELECT * FROM t'];

    // In-process reference: the exact server-side code path, no socket.
    const inProcess = await computeEmbeddingsForRequest(texts, {});

    // Over the wire.
    const rpc = await requestEmbeddings(texts, { socketPath });

    expect(rpc.length).toBe(texts.length);
    for (let i = 0; i < texts.length; i++) {
      expect(rpc[i]).toBeInstanceOf(Float32Array);
      // Byte-for-byte: compare the underlying IEEE-754 bit patterns.
      const a = new Uint8Array(inProcess[i].buffer, inProcess[i].byteOffset, inProcess[i].length * 4);
      const b = new Uint8Array(rpc[i].buffer, rpc[i].byteOffset, rpc[i].length * 4);
      expect(Array.from(b)).toEqual(Array.from(a));
    }
  });

  it('serves concurrent clients without cross-talk', async () => {
    const reqA = requestEmbeddings(['aaa'], { socketPath });
    const reqB = requestEmbeddings(['bb', 'cccc'], { socketPath });
    const reqC = requestEmbeddings(['dddddd'], { socketPath });
    const [a, b, c] = await Promise.all([reqA, reqB, reqC]);

    expect(a.length).toBe(1);
    expect(b.length).toBe(2);
    expect(c.length).toBe(1);

    // Each reply must match its own input length (no response mix-up).
    const refA = await computeEmbeddingsForRequest(['aaa'], {});
    expect(Array.from(a[0])).toEqual(Array.from(refA[0]));
  });

  it('answers a ping', async () => {
    expect(await pingModelServer({ socketPath, timeoutMs: 2000 })).toBe(true);
  });

  it('returns a structured error (not a bogus result) when the model throws', async () => {
    stubEmbed.mockRejectedValueOnce(new Error('boom'));
    await expect(requestEmbeddings(['x'], { socketPath })).rejects.toThrow(/boom/);
  });
});

// =============================================================================
// 5. Client fallback when the server is unavailable (drives the dispatch shim)
// =============================================================================
describe('G8 client fallback', () => {
  it('rejects (does not hang or return garbage) when no server is listening', async () => {
    const dead = tmpSocket('dead'); // never bound
    await expect(requestEmbeddings(['x'], { socketPath: dead, timeoutMs: 1500 }))
      .rejects.toThrow();
  });

  it('pingModelServer resolves false (never throws) on a dead socket', async () => {
    const dead = tmpSocket('dead2');
    await expect(pingModelServer({ socketPath: dead, timeoutMs: 500 })).resolves.toBe(false);
  });
});
