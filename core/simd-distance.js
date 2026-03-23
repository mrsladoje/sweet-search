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
