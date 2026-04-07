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

/**
 * Standard Walsh-Hadamard Transform (natural / Hadamard ordering).
 * This is the default used by all existing indexes. Do NOT change
 * the output ordering — it would silently break every index on disk.
 */
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

/**
 * CRA-4: Sequency-ordered Walsh-Hadamard Transform.
 *
 * Same butterfly as walshHadamardTransform, then permutes to sequency (Walsh)
 * ordering. Clusters similar-frequency components together, reducing
 * quantization error (GSR, arXiv 2505.03810).
 *
 * MUST be opt-in via whtOrdering='sequency' — never default.
 * Indexes built with sequency ordering are NOT compatible with natural-order indexes.
 */
export function walshHadamardTransformSequency(v) {
  // Step 1: standard butterfly (natural order)
  walshHadamardTransform(v);

  // Step 2: permute from natural to sequency order
  const n = v.length;
  const bits = 31 - Math.clz32(n);
  if (n <= 1 || bits === 0) return v;

  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = i ^ (i >>> 1);
    let r = 0, x = g;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>>= 1; }
    tmp[i] = v[r];
  }
  v.set(tmp);
  return v;
}

export function fastRotate(v, signs, sequency = false) {
  const origDim = v.length;
  const padDim = nextPow2(origDim);
  const buf = new Float32Array(padDim);
  for (let i = 0; i < origDim; i++) buf[i] = v[i] * signs[i];
  if (sequency) {
    walshHadamardTransformSequency(buf);
  } else {
    walshHadamardTransform(buf);
  }
  return padDim === origDim ? buf : buf.subarray(0, origDim);
}

// =============================================================================
// FAST PSEUDO-RANDOM ROTATION (CRA-14)
// =============================================================================

/**
 * CRA-14: Weaviate-style fast pseudo-random rotation using a sequence of
 * random Givens (pairwise plane) rotations. Achieves variance equalization
 * comparable to WHT at O(d × numRotations) cost, which is cheaper than
 * WHT's O(d log d) for high dimensions (d >= 768).
 *
 * For our d=128 this is similar speed to WHT. Provided for future model
 * scaling and A/B testing against WHT.
 *
 * @param {Float32Array} v - Input vector (modified in-place)
 * @param {number} seed - Deterministic seed for rotation angles and pairs
 * @param {number} [numRounds=3] - Number of rotation rounds (more = better equalization)
 * @returns {Float32Array} Rotated vector (same reference as input)
 */
export function fastPseudoRandomRotate(v, seed, numRounds = 3) {
  const dim = v.length;
  if (dim < 2) return v;

  // Deterministic PRNG from seed
  let s = seed | 0;
  const prng = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };

  // Apply numRounds passes of dim/2 random Givens rotations.
  // Each pass randomly pairs all dimensions and applies a random rotation angle.
  const indices = new Uint32Array(dim);
  for (let i = 0; i < dim; i++) indices[i] = i;

  for (let round = 0; round < numRounds; round++) {
    // Fisher-Yates shuffle for random pairing
    for (let i = dim - 1; i > 0; i--) {
      const j = (prng() * (i + 1)) | 0;
      const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
    }

    // Apply Givens rotation to each pair
    for (let p = 0; p < dim - 1; p += 2) {
      const i = indices[p];
      const j = indices[p + 1];
      const theta = prng() * 2 * Math.PI;
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      const vi = v[i];
      const vj = v[j];
      v[i] = c * vi - sn * vj;
      v[j] = sn * vi + c * vj;
    }
  }

  // Normalize to preserve L2 norm (Givens rotations are orthogonal, but
  // accumulated floating-point error can cause small drift)
  let normSq = 0;
  for (let i = 0; i < dim; i++) normSq += v[i] * v[i];
  if (normSq > 0) {
    const scale = Math.sqrt(normSq);
    // Only renormalize if drift exceeds epsilon
    if (Math.abs(scale - 1.0) > 1e-6) {
      for (let i = 0; i < dim; i++) v[i] /= scale;
    }
  }

  return v;
}

// =============================================================================
// WUSH CALIBRATED ROTATION (CRA-3)
// =============================================================================

/**
 * Calibrate a WUSH transform from sample embeddings.
 * Computes the covariance matrix, eigendecomposition, and produces
 * the calibration scaling vector S^(-1/2) and rotation matrix U.
 *
 * The full WUSH transform is: T = H × diag(S^(-1/2)) × U^T
 * where H is the Walsh-Hadamard matrix, and U,S come from the
 * eigendecomposition of the covariance matrix.
 *
 * @param {Float32Array[]} samples - Sample embedding vectors (L2-normalized)
 * @param {number} dim - Embedding dimension
 * @returns {{ eigenVecs: Float64Array, invSqrtEigenVals: Float64Array }} Calibration data
 */
export function calibrateWUSH(samples, dim) {
  const n = samples.length;
  if (n < dim) throw new Error(`WUSH calibration requires >= ${dim} samples, got ${n}`);

  // Compute covariance matrix C = (1/N) × X^T × X (symmetric, dim × dim)
  const C = new Float64Array(dim * dim);
  for (let s = 0; s < n; s++) {
    const x = samples[s];
    for (let i = 0; i < dim; i++) {
      const xi = x[i];
      for (let j = i; j < dim; j++) {
        C[i * dim + j] += xi * x[j];
      }
    }
  }
  // Symmetrize and normalize
  for (let i = 0; i < dim; i++) {
    C[i * dim + i] /= n;
    for (let j = i + 1; j < dim; j++) {
      const v = C[i * dim + j] / n;
      C[i * dim + j] = v;
      C[j * dim + i] = v;
    }
  }

  // Jacobi eigendecomposition of symmetric C.
  // eigenVecs columns are eigenvectors (stored row-major as V[i*dim+j]).
  const V = new Float64Array(dim * dim);
  for (let i = 0; i < dim; i++) V[i * dim + i] = 1.0; // identity

  const maxIter = 100;
  for (let iter = 0; iter < maxIter; iter++) {
    // Find largest off-diagonal element
    let maxVal = 0, p = 0, q = 0;
    for (let i = 0; i < dim; i++) {
      for (let j = i + 1; j < dim; j++) {
        const absVal = Math.abs(C[i * dim + j]);
        if (absVal > maxVal) { maxVal = absVal; p = i; q = j; }
      }
    }
    if (maxVal < 1e-10) break; // converged

    // Jacobi rotation for (p, q)
    const cpp = C[p * dim + p];
    const cqq = C[q * dim + q];
    const cpq = C[p * dim + q];

    const theta = 0.5 * Math.atan2(2 * cpq, cpp - cqq);
    const c = Math.cos(theta);
    const s2 = Math.sin(theta);

    // Update C: rotate rows/cols p and q
    for (let i = 0; i < dim; i++) {
      if (i === p || i === q) continue;
      const cip = C[i * dim + p];
      const ciq = C[i * dim + q];
      C[i * dim + p] = C[p * dim + i] = c * cip + s2 * ciq;
      C[i * dim + q] = C[q * dim + i] = -s2 * cip + c * ciq;
    }
    C[p * dim + p] = c * c * cpp + 2 * c * s2 * cpq + s2 * s2 * cqq;
    C[q * dim + q] = s2 * s2 * cpp - 2 * c * s2 * cpq + c * c * cqq;
    C[p * dim + q] = C[q * dim + p] = 0;

    // Update eigenvector matrix V
    for (let i = 0; i < dim; i++) {
      const vip = V[i * dim + p];
      const viq = V[i * dim + q];
      V[i * dim + p] = c * vip + s2 * viq;
      V[i * dim + q] = -s2 * vip + c * viq;
    }
  }

  // Extract eigenvalues (diagonal of C) and compute S^(-1/2)
  const invSqrtEigenVals = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    const ev = Math.max(C[i * dim + i], 1e-12);
    invSqrtEigenVals[i] = 1.0 / Math.sqrt(ev);
  }

  return { eigenVecs: V, invSqrtEigenVals };
}

/**
 * Apply the WUSH-calibrated rotation: T_wush × v = H × diag(S^(-1/2)) × U^T × v
 *
 * Steps:
 * 1. Project: w = U^T × v (rotate into eigenbasis)
 * 2. Scale: w[i] *= S^(-1/2)[i] (equalize dimension variance)
 * 3. WHT: w = H × w (spread information across dimensions)
 *
 * @param {Float32Array} v - Input vector
 * @param {Float64Array} eigenVecs - Eigenvector matrix (dim×dim, row-major)
 * @param {Float64Array} invSqrtEigenVals - S^(-1/2) diagonal
 * @param {Float32Array} signs - Sign-flip vector (for randomization)
 * @returns {Float32Array} Rotated vector
 */
export function wushRotate(v, eigenVecs, invSqrtEigenVals, signs) {
  const dim = v.length;

  // Step 1: w = U^T × v (U stored row-major in eigenVecs, so U^T × v = transpose-multiply)
  const w = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    let sum = 0;
    for (let j = 0; j < dim; j++) {
      sum += eigenVecs[j * dim + i] * v[j]; // column i of V = row j, col i
    }
    // Step 2: scale by S^(-1/2)
    w[i] = sum * invSqrtEigenVals[i];
  }

  // Step 3: Sign-flip + WHT (reuses existing infrastructure)
  for (let i = 0; i < dim; i++) w[i] *= signs[i];
  walshHadamardTransform(w);

  return w;
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
