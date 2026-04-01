/**
 * Quantization & Distance Utilities — pure math functions shared across domains.
 *
 * Extracted from embedding-service.js during DDD boundary cleanup.
 * No domain dependencies — only pure computation.
 */

// =============================================================================
// BINARY QUANTIZATION
// =============================================================================

export function floatToBinary(embedding) {
  const numBytes = Math.ceil(embedding.length / 8);
  const binary = new Uint8Array(numBytes);
  for (let i = 0; i < embedding.length; i++) {
    if (embedding[i] > 0) {
      binary[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
    }
  }
  return binary;
}

// =============================================================================
// CENTROID & ROTATION
// =============================================================================

export function computeCentroid(embeddings) {
  if (!embeddings || embeddings.length === 0) return null;
  const dim = embeddings[0].length;
  const centroid = new Float64Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) centroid[i] += emb[i];
  }
  const n = embeddings.length;
  for (let i = 0; i < dim; i++) centroid[i] /= n;
  return new Float32Array(centroid);
}

export function generateSignVector(dim, seed = 42) {
  const signs = new Float32Array(dim);
  let s = seed | 0;
  for (let i = 0; i < dim; i++) {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    signs[i] = ((t ^ (t >>> 14)) >>> 31) ? 1.0 : -1.0;
  }
  return signs;
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function walshHadamardTransform(v) {
  const n = v.length;
  for (let len = 1; len < n; len <<= 1) {
    for (let i = 0; i < n; i += len << 1) {
      for (let j = 0; j < len; j++) {
        const u = v[i + j];
        const w = v[i + j + len];
        v[i + j] = u + w;
        v[i + j + len] = u - w;
      }
    }
  }
  const scale = 1.0 / Math.sqrt(n);
  for (let i = 0; i < n; i++) v[i] *= scale;
  return v;
}

export function fastRotate(v, signs) {
  const origDim = v.length;
  const padDim = nextPow2(origDim);
  const buf = new Float32Array(padDim);
  for (let i = 0; i < origDim; i++) buf[i] = v[i] * signs[i];
  walshHadamardTransform(buf);
  return padDim === origDim ? buf : buf.subarray(0, origDim);
}

// =============================================================================
// ASYMMETRIC QUANTIZATION
// =============================================================================

export function asymmetricDocEncode(embedding, centroid, signs) {
  const dim = embedding.length;
  const centered = new Float32Array(dim);
  for (let i = 0; i < dim; i++) centered[i] = embedding[i] - centroid[i];
  const rotated = fastRotate(centered, signs);
  return floatToBinary(rotated);
}

export function asymmetricQueryEncode(embedding, centroid, signs) {
  const dim = embedding.length;
  const centered = new Float32Array(dim);
  for (let i = 0; i < dim; i++) centered[i] = embedding[i] - centroid[i];
  const rotated = fastRotate(centered, signs);
  let maxAbs = 0;
  for (let i = 0; i < dim; i++) {
    const abs = Math.abs(rotated[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  const int4 = new Int8Array(dim);
  if (maxAbs > 0) {
    const scale = 7.0 / maxAbs;
    for (let i = 0; i < dim; i++) {
      int4[i] = Math.round(Math.max(-7, Math.min(7, rotated[i] * scale)));
    }
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += rotated[i] * rotated[i];
  return { int4, norm };
}

// =============================================================================
// INT8 QUANTIZATION
// =============================================================================

export function floatToInt8(embedding) {
  const int8 = new Int8Array(embedding.length);
  let maxAbs = 0;
  for (let i = 0; i < embedding.length; i++) {
    const abs = Math.abs(embedding[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  if (maxAbs === 0) return int8;
  const scale = 127 / maxAbs;
  for (let i = 0; i < embedding.length; i++) {
    int8[i] = Math.round(Math.max(-127, Math.min(127, embedding[i] * scale)));
  }
  return int8;
}

export function normalizedFloatToInt8(embedding) {
  const int8 = new Int8Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    const clamped = Math.max(-1, Math.min(1, embedding[i]));
    int8[i] = Math.round(clamped * 127);
  }
  return int8;
}

// =============================================================================
// TRUNCATION & SHUFFLE
// =============================================================================

export function truncateForHNSW(embedding, targetDim) {
  if (embedding.length <= targetDim) return embedding;
  const truncated = embedding.slice(0, targetDim);
  let norm = 0;
  for (let i = 0; i < truncated.length; i++) norm += truncated[i] * truncated[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < truncated.length; i++) truncated[i] /= norm;
  return truncated;
}

export function fisherYatesShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}
