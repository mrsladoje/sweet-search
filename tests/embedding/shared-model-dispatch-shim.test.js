// G8 — dispatch shim in embedding-service.getEmbeddings.
//
// When SWEET_SEARCH_SHARED_MODEL_SERVER==='1' AND the provider is the local
// ONNX model, the uncached-text generation routes through the model-server RPC
// client. On ANY failure (flag off, client import failed, socket down, server
// error, short reply) it falls through to the existing in-process path
// UNCHANGED. This test pins both behaviors without loading ORT by mocking the
// RPC client and the local-model module the in-process path uses.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the RPC client: `requestEmbeddings` is observable + scriptable.
const requestEmbeddings = vi.fn();
vi.mock('../../core/embedding/model-client.mjs', () => ({
  requestEmbeddings,
}));

// Mock the in-process local-model path so the fallback is deterministic and
// cheap (no ORT). `generateEmbeddings` routes the local provider through
// callLocalModelBucketed.
const callLocalModelBucketed = vi.fn(async (texts) =>
  texts.map((_t, i) => new Float32Array([i + 0.5, i + 1.5])),
);
vi.mock('../../core/embedding/embedding-local-model.js', () => ({
  INDEXING_MAX_LENGTH: 1024,
  QUERY_MAX_LENGTH: 512,
  callLocalModel: vi.fn(),
  callLocalModelBucketed,
  applyLocalQueryPrefix: (t) => t,
  getLocalPipeline: vi.fn(),
  unloadLocalModel: vi.fn(),
  isLocalModelLoaded: () => true,
  configureLocalModelRuntime: vi.fn(),
  resetLocalModelRuntime: vi.fn(),
}));

const { getEmbeddings } = await import('../../core/embedding/embedding-service.js');

const ORIG = process.env.SWEET_SEARCH_SHARED_MODEL_SERVER;

beforeEach(() => {
  requestEmbeddings.mockReset();
  callLocalModelBucketed.mockClear();
  delete process.env.SWEET_SEARCH_SHARED_MODEL_SERVER;
});

afterEach(() => {
  if (ORIG === undefined) delete process.env.SWEET_SEARCH_SHARED_MODEL_SERVER;
  else process.env.SWEET_SEARCH_SHARED_MODEL_SERVER = ORIG;
});

describe('getEmbeddings dispatch shim — flag OFF (default)', () => {
  it('never touches the RPC client; uses the in-process path', async () => {
    const out = await getEmbeddings(['fn a()', 'fn b()'], { useCache: false });
    expect(requestEmbeddings).not.toHaveBeenCalled();
    expect(callLocalModelBucketed).toHaveBeenCalledTimes(1);
    expect(out.map((r) => Array.from(r.embedding))).toEqual([[0.5, 1.5], [1.5, 2.5]]);
    expect(out.every((r) => r.cached === false)).toBe(true);
  });
});

describe('getEmbeddings dispatch shim — flag ON', () => {
  it('routes uncached local-model embeddings through RPC, bypassing in-process', async () => {
    process.env.SWEET_SEARCH_SHARED_MODEL_SERVER = '1';
    requestEmbeddings.mockResolvedValueOnce([
      new Float32Array([9, 8]),
      new Float32Array([7, 6]),
    ]);
    const out = await getEmbeddings(['x', 'y'], { useCache: false });
    expect(requestEmbeddings).toHaveBeenCalledTimes(1);
    // in-process generation must NOT run when RPC succeeds
    expect(callLocalModelBucketed).not.toHaveBeenCalled();
    expect(out.map((r) => Array.from(r.embedding))).toEqual([[9, 8], [7, 6]]);
  });

  it('falls back to in-process when the RPC client rejects (socket down)', async () => {
    process.env.SWEET_SEARCH_SHARED_MODEL_SERVER = '1';
    requestEmbeddings.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const out = await getEmbeddings(['a'], { useCache: false });
    expect(requestEmbeddings).toHaveBeenCalledTimes(1);
    expect(callLocalModelBucketed).toHaveBeenCalledTimes(1);
    expect(Array.from(out[0].embedding)).toEqual([0.5, 1.5]);
  });

  it('falls back to in-process on a short/partial RPC reply (length mismatch)', async () => {
    process.env.SWEET_SEARCH_SHARED_MODEL_SERVER = '1';
    // 1 vector for 2 inputs → must be rejected and fall back
    requestEmbeddings.mockResolvedValueOnce([new Float32Array([1, 2])]);
    const out = await getEmbeddings(['a', 'b'], { useCache: false });
    expect(callLocalModelBucketed).toHaveBeenCalledTimes(1);
    expect(out.map((r) => Array.from(r.embedding))).toEqual([[0.5, 1.5], [1.5, 2.5]]);
  });
});
