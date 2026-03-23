/**
 * WASM-accelerated distance functions with JS fallback (Fix 6).
 *
 * The WASM module (simd-distance.wasm) contains:
 *   - A 256-byte popcount LUT at memory offset 0
 *   - hamming_distance(a_ptr, b_ptr, len) → i32
 *   - int8_dot(a_ptr, b_ptr, len) → i32
 *   - int8_norm_sq(a_ptr, len) → i32
 *
 * Vector data is written at offset 256+ (after LUT).
 * ~3-4x faster than JS: no GC, typed memory, tight loop codegen.
 *
 * Build: node scripts/build-wasm.js
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const DATA_OFFSET = 0; // SIMD popcount needs no LUT

let wasmExports = null;
let wasmMem = null;
let initDone = false;

// =============================================================================
// WASM INITIALIZATION
// =============================================================================

async function initWasm() {
  if (initDone) return !!wasmExports;
  initDone = true;

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const wasmPath = join(__dirname, 'simd-distance.wasm');
    if (!existsSync(wasmPath)) return false;

    const wasmBuffer = readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(wasmBuffer);
    wasmExports = instance.exports;
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    return true;
  } catch {
    return false;
  }
}

// Eager non-blocking init
initWasm().catch(() => {});

// =============================================================================
// POPCOUNT LUT (JS fallback)
// =============================================================================

const POPCOUNT_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  POPCOUNT_LUT[i] = (i & 1) + POPCOUNT_LUT[i >> 1];
}

// =============================================================================
// HAMMING DISTANCE
// =============================================================================

export function wasmHammingDistance(a, b) {
  if (wasmExports) {
    const aPtr = DATA_OFFSET;
    const bPtr = DATA_OFFSET + a.length;
    // Re-acquire view in case memory grew
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    wasmMem.set(a, aPtr);
    wasmMem.set(b, bPtr);
    return wasmExports.hamming_distance(aPtr, bPtr, a.length);
  }
  // JS fallback
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    distance += POPCOUNT_LUT[a[i] ^ b[i]];
  }
  return distance;
}

// =============================================================================
// INT8 COSINE SIMILARITY
// =============================================================================

export function wasmInt8Cosine(a, b) {
  if (wasmExports) {
    const aPtr = DATA_OFFSET;
    const bPtr = DATA_OFFSET + a.length;
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    wasmMem.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), aPtr);
    wasmMem.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), bPtr);

    const dot = wasmExports.int8_dot(aPtr, bPtr, a.length);
    const normA = wasmExports.int8_norm_sq(aPtr, a.length);
    const normB = wasmExports.int8_norm_sq(bPtr, b.length);

    const na = Math.sqrt(normA);
    const nb = Math.sqrt(normB);
    if (na === 0 || nb === 0) return 0;
    return dot / (na * nb);
  }
  // JS fallback
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const na = Math.sqrt(normA);
  const nb = Math.sqrt(normB);
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

// =============================================================================
// INT8 BATCHED DOT PRODUCT (Phase 1: copy query once, score slab)
// =============================================================================

/**
 * Batch int8 dot product: score multiple candidate vectors against one query.
 * Copies query once to WASM memory, candidates as contiguous slab.
 * Returns raw int8 dot products (not normalized).
 *
 * For normalized int8 vectors (from L2-normalized floats), the raw dot
 * approximates cosine * 127². Divide by 16129 for cosine-scale scores.
 *
 * @param {Int8Array} query - Query int8 vector
 * @param {Int8Array[]} candidates - Array of candidate int8 vectors
 * @returns {Int32Array} Raw dot products
 */
export function wasmInt8BatchDot(query, candidates) {
  const dim = query.length;
  const count = candidates.length;
  if (count === 0) return new Int32Array(0);

  if (wasmExports && wasmExports.int8_batch_dot) {
    const queryPtr = DATA_OFFSET;
    const slabPtr = DATA_OFFSET + dim;
    // Scores buffer: 4 bytes per candidate, placed after the slab
    const scoresPtr = slabPtr + count * dim;
    // Align scores pointer to 4-byte boundary
    const alignedScoresPtr = (scoresPtr + 3) & ~3;
    const needed = alignedScoresPtr + count * 4;

    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    if (needed > wasmMem.length) {
      return _jsInt8BatchDot(query, candidates);
    }

    // Copy query once
    wasmMem.set(new Uint8Array(query.buffer, query.byteOffset, query.byteLength), queryPtr);

    // Copy all candidates as contiguous slab
    for (let i = 0; i < count; i++) {
      const v = candidates[i];
      wasmMem.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), slabPtr + i * dim);
    }

    // Single WASM call: scores all candidates internally, writes to output buffer
    wasmExports.int8_batch_dot(queryPtr, slabPtr, count, dim, alignedScoresPtr);

    // Read scores from WASM memory
    return new Int32Array(wasmExports.memory.buffer, alignedScoresPtr, count);
  }

  return _jsInt8BatchDot(query, candidates);
}

function _jsInt8BatchDot(query, candidates) {
  const dim = query.length;
  const scores = new Int32Array(candidates.length);
  for (let c = 0; c < candidates.length; c++) {
    let dot = 0;
    const v = candidates[c];
    for (let i = 0; i < dim; i++) dot += query[i] * v[i];
    scores[c] = dot;
  }
  return scores;
}

// =============================================================================
// FLOAT32 BATCHED DOT PRODUCT (Phase 2: Stage 2.5 float rescore)
// =============================================================================

/**
 * Batch float32 dot product: score multiple float vectors against one query.
 * Pure JS implementation — V8 JIT is competitive with WASM for float math.
 *
 * @param {Float32Array} query - Query float vector
 * @param {Float32Array[]} candidates - Array of candidate float vectors
 * @returns {Float64Array} Dot product scores
 */
export function float32BatchDot(query, candidates) {
  const dim = query.length;
  const scores = new Float64Array(candidates.length);
  for (let c = 0; c < candidates.length; c++) {
    const v = candidates[c];
    if (v.length !== dim) {
      throw new Error(`float32BatchDot dimension mismatch: query=${dim}, candidate[${c}]=${v.length}`);
    }
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += query[i] * v[i];
    scores[c] = dot;
  }
  return scores;
}

// For L2-normalized vectors, dot product = cosine similarity.
// Use float32BatchDot directly — no separate cosine wrapper needed.

// =============================================================================
// INT8 DOT PRODUCT (raw, for asymmetric distance)
// =============================================================================

export function wasmInt8Dot(a, b) {
  if (wasmExports) {
    const aPtr = DATA_OFFSET;
    const bPtr = DATA_OFFSET + a.length;
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    wasmMem.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), aPtr);
    wasmMem.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), bPtr);
    return wasmExports.int8_dot(aPtr, bPtr, a.length);
  }
  // JS fallback
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// =============================================================================
// STATUS
// =============================================================================

// =============================================================================
// ASYMMETRIC DISTANCE (1-bit doc × int4 query)
// =============================================================================

export function wasmAsymmetricDistance(docBinary, queryInt4, queryNormScaled) {
  if (wasmExports) {
    const docPtr = DATA_OFFSET;
    const queryPtr = DATA_OFFSET + docBinary.length;
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    wasmMem.set(docBinary, docPtr);
    wasmMem.set(new Uint8Array(queryInt4.buffer, queryInt4.byteOffset, queryInt4.byteLength), queryPtr);
    return wasmExports.asymmetric_distance(docPtr, queryPtr, queryInt4.length, queryNormScaled);
  }
  // JS fallback
  let approxDot = 0;
  const dim = queryInt4.length;
  for (let byteIdx = 0; byteIdx < docBinary.length; byteIdx++) {
    let byte = docBinary[byteIdx];
    const baseIdx = byteIdx * 8;
    for (let bit = 7; bit >= 0; bit--) {
      const idx = baseIdx + (7 - bit);
      if (idx >= dim) break;
      if (byte & (1 << bit)) approxDot += queryInt4[idx];
      else approxDot -= queryInt4[idx];
    }
  }
  return queryNormScaled - 2 * approxDot;
}

export function isWasmAvailable() {
  return !!wasmExports;
}

export { initWasm };
