import { describe, it, expect, beforeAll } from 'vitest';
import {
  initWasm,
  wasmHammingDistance,
  wasmInt8Cosine,
  wasmInt8Dot,
  wasmInt8BatchDot,
  float32BatchDot,
  getMaxSimTier,
  isWasmAvailable,
  isNativeMaxSimAvailable,
  isMaxSimWasmAvailable,
} from '../../core/infrastructure/simd-distance.js';

// ---------------------------------------------------------------------------
// Ensure WASM is initialized before all distance tests.
// The module eagerly calls initWasm() on load, but the promise may not have
// settled by the time tests execute.  Await it explicitly.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await initWasm();
});

// ===========================================================================
// 1. wasmHammingDistance — correctness against known binary vectors
// ===========================================================================

describe('wasmHammingDistance', () => {
  it('should return 0 for identical binary vectors', () => {
    const a = new Uint8Array([0xFF, 0x00, 0xAA, 0x55]);
    const b = new Uint8Array([0xFF, 0x00, 0xAA, 0x55]);
    expect(wasmHammingDistance(a, b)).toBe(0);
  });

  it('should return total bit count for fully inverted vectors', () => {
    // 0x00 ^ 0xFF = 0xFF -> popcount(0xFF) = 8, for 4 bytes => 32
    const a = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    const b = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
    expect(wasmHammingDistance(a, b)).toBe(32);
  });

  it('should count single differing bit correctly', () => {
    // 0x00 ^ 0x01 = 0x01 -> popcount = 1
    const a = new Uint8Array([0x00]);
    const b = new Uint8Array([0x01]);
    expect(wasmHammingDistance(a, b)).toBe(1);
  });

  it('should compute known hamming distance for mixed vectors', () => {
    // 0xAA = 10101010, 0x55 = 01010101 -> XOR = 11111111 -> popcount = 8
    const a = new Uint8Array([0xAA]);
    const b = new Uint8Array([0x55]);
    expect(wasmHammingDistance(a, b)).toBe(8);
  });

  it('should compute correct distance for multi-byte vectors with partial diff', () => {
    // byte 0: 0xFF ^ 0xFE = 0x01 -> popcount 1
    // byte 1: 0x00 ^ 0x00 = 0x00 -> popcount 0
    // byte 2: 0x0F ^ 0xF0 = 0xFF -> popcount 8
    // total = 9
    const a = new Uint8Array([0xFF, 0x00, 0x0F]);
    const b = new Uint8Array([0xFE, 0x00, 0xF0]);
    expect(wasmHammingDistance(a, b)).toBe(9);
  });

  it('should handle empty vectors', () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([]);
    expect(wasmHammingDistance(a, b)).toBe(0);
  });

  it('should handle large vectors (128 bytes = 1024 bits)', () => {
    const a = new Uint8Array(128).fill(0x00);
    const b = new Uint8Array(128).fill(0xFF);
    // 128 bytes * 8 bits = 1024 differing bits
    expect(wasmHammingDistance(a, b)).toBe(1024);
  });
});

// ===========================================================================
// 2. wasmInt8Cosine — correctness against known int8 vectors
// ===========================================================================

describe('wasmInt8Cosine', () => {
  it('should return 1.0 for identical non-zero vectors', () => {
    const a = new Int8Array([10, 20, 30, 40]);
    const b = new Int8Array([10, 20, 30, 40]);
    expect(wasmInt8Cosine(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should return -1.0 for negated vectors', () => {
    const a = new Int8Array([10, 20, 30, 40]);
    const b = new Int8Array([-10, -20, -30, -40]);
    expect(wasmInt8Cosine(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    // [1, 0] dot [0, 1] = 0
    const a = new Int8Array([1, 0]);
    const b = new Int8Array([0, 1]);
    expect(wasmInt8Cosine(a, b)).toBeCloseTo(0.0, 5);
  });

  it('should return 0 when either vector is all zeros', () => {
    const a = new Int8Array([0, 0, 0, 0]);
    const b = new Int8Array([10, 20, 30, 40]);
    expect(wasmInt8Cosine(a, b)).toBe(0);
  });

  it('should compute correct cosine for known vectors', () => {
    // a = [3, 4], b = [4, 3]
    // dot = 12 + 12 = 24
    // normA = sqrt(9+16) = 5, normB = sqrt(16+9) = 5
    // cosine = 24 / 25 = 0.96
    const a = new Int8Array([3, 4]);
    const b = new Int8Array([4, 3]);
    expect(wasmInt8Cosine(a, b)).toBeCloseTo(0.96, 2);
  });

  it('should handle dimension 128 (typical embedding size)', () => {
    const a = new Int8Array(128);
    const b = new Int8Array(128);
    for (let i = 0; i < 128; i++) {
      a[i] = (i % 127) - 63;  // range -63..63
      b[i] = (i % 127) - 63;
    }
    // identical => cosine = 1.0
    expect(wasmInt8Cosine(a, b)).toBeCloseTo(1.0, 5);
  });
});

// ===========================================================================
// 3a. wasmInt8Dot — raw int8 dot product correctness
// ===========================================================================

describe('wasmInt8Dot', () => {
  it('should return 0 for orthogonal vectors', () => {
    const a = new Int8Array([1, 0]);
    const b = new Int8Array([0, 1]);
    expect(wasmInt8Dot(a, b)).toBe(0);
  });

  it('should compute correct dot product for known vectors', () => {
    // [3, 4] dot [4, 3] = 12 + 12 = 24
    const a = new Int8Array([3, 4]);
    const b = new Int8Array([4, 3]);
    expect(wasmInt8Dot(a, b)).toBe(24);
  });

  it('should handle negative values correctly', () => {
    // [-5, 10] dot [10, -5] = -50 + -50 = -100
    const a = new Int8Array([-5, 10]);
    const b = new Int8Array([10, -5]);
    expect(wasmInt8Dot(a, b)).toBe(-100);
  });

  it('should return squared norm when dotting a vector with itself', () => {
    // [3, 4] dot [3, 4] = 9 + 16 = 25
    const a = new Int8Array([3, 4]);
    expect(wasmInt8Dot(a, a)).toBe(25);
  });

  it('should return 0 for zero vectors', () => {
    const a = new Int8Array([0, 0, 0, 0]);
    const b = new Int8Array([0, 0, 0, 0]);
    expect(wasmInt8Dot(a, b)).toBe(0);
  });

  it('should handle int8 extremes (-128, 127)', () => {
    // [-128, 127] dot [1, 1] = -128 + 127 = -1
    const a = new Int8Array([-128, 127]);
    const b = new Int8Array([1, 1]);
    expect(wasmInt8Dot(a, b)).toBe(-1);
  });

  it('should handle higher-dimensional vectors', () => {
    // [1,2,3,4,5,6,7,8] dot [8,7,6,5,4,3,2,1]
    // = 8+14+18+20+20+18+14+8 = 120
    const a = new Int8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Int8Array([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(wasmInt8Dot(a, b)).toBe(120);
  });
});

// ===========================================================================
// 3b. wasmInt8BatchDot — batched int8 dot product
// ===========================================================================

describe('wasmInt8BatchDot', () => {
  it('should return empty Int32Array for empty candidates', () => {
    const query = new Int8Array([1, 2, 3]);
    const result = wasmInt8BatchDot(query, []);
    expect(result).toBeInstanceOf(Int32Array);
    expect(result.length).toBe(0);
  });

  it('should compute correct dot products for single candidate', () => {
    const query = new Int8Array([3, 4]);
    const candidate = new Int8Array([4, 3]);
    const result = wasmInt8BatchDot(query, [candidate]);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(24);
  });

  it('should compute correct dot products for multiple candidates', () => {
    const query = new Int8Array([1, 2, 3]);
    const c0 = new Int8Array([1, 0, 0]); // dot = 1
    const c1 = new Int8Array([0, 1, 0]); // dot = 2
    const c2 = new Int8Array([0, 0, 1]); // dot = 3
    const c3 = new Int8Array([1, 1, 1]); // dot = 6
    const result = wasmInt8BatchDot(query, [c0, c1, c2, c3]);
    expect(result.length).toBe(4);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
    expect(result[2]).toBe(3);
    expect(result[3]).toBe(6);
  });

  it('should match individual wasmInt8Dot results', () => {
    const query = new Int8Array([5, -3, 7, 2]);
    const candidates = [
      new Int8Array([1, 2, -1, 4]),
      new Int8Array([-2, 6, 3, -1]),
      new Int8Array([0, 0, 0, 0]),
    ];
    const batchResult = wasmInt8BatchDot(query, candidates);
    for (let i = 0; i < candidates.length; i++) {
      expect(batchResult[i]).toBe(wasmInt8Dot(query, candidates[i]));
    }
  });
});

// ===========================================================================
// 4. float32BatchDot — batch float32 dot product correctness
// ===========================================================================

describe('float32BatchDot', () => {
  it('should return empty Float64Array for empty candidates', () => {
    const query = new Float32Array([1.0, 2.0]);
    const result = float32BatchDot(query, []);
    expect(result).toBeInstanceOf(Float64Array);
    expect(result.length).toBe(0);
  });

  it('should compute correct dot product for unit vectors', () => {
    // [1, 0] dot [0, 1] = 0
    const query = new Float32Array([1.0, 0.0]);
    const candidate = new Float32Array([0.0, 1.0]);
    const result = float32BatchDot(query, [candidate]);
    expect(result[0]).toBeCloseTo(0.0, 5);
  });

  it('should compute correct dot product for known vectors', () => {
    // [0.6, 0.8] dot [0.8, 0.6] = 0.48 + 0.48 = 0.96
    const query = new Float32Array([0.6, 0.8]);
    const candidate = new Float32Array([0.8, 0.6]);
    const result = float32BatchDot(query, [candidate]);
    expect(result[0]).toBeCloseTo(0.96, 4);
  });

  it('should compute self-dot-product as squared norm', () => {
    // [3.0, 4.0] dot [3.0, 4.0] = 9 + 16 = 25
    const query = new Float32Array([3.0, 4.0]);
    const result = float32BatchDot(query, [query]);
    expect(result[0]).toBeCloseTo(25.0, 3);
  });

  it('should batch-score multiple candidates correctly', () => {
    const query = new Float32Array([1.0, 2.0, 3.0]);
    const c0 = new Float32Array([1.0, 0.0, 0.0]); // dot = 1.0
    const c1 = new Float32Array([0.0, 1.0, 0.0]); // dot = 2.0
    const c2 = new Float32Array([0.0, 0.0, 1.0]); // dot = 3.0
    const c3 = new Float32Array([1.0, 1.0, 1.0]); // dot = 6.0
    const result = float32BatchDot(query, [c0, c1, c2, c3]);
    expect(result.length).toBe(4);
    expect(result[0]).toBeCloseTo(1.0, 5);
    expect(result[1]).toBeCloseTo(2.0, 5);
    expect(result[2]).toBeCloseTo(3.0, 5);
    expect(result[3]).toBeCloseTo(6.0, 5);
  });

  it('should throw on dimension mismatch', () => {
    const query = new Float32Array([1.0, 2.0]);
    const bad = new Float32Array([1.0, 2.0, 3.0]);
    expect(() => float32BatchDot(query, [bad])).toThrow(/dimension mismatch/);
  });

  it('should handle L2-normalized vectors as cosine similarity', () => {
    // For L2-normalized vectors, dot product == cosine similarity.
    // norm([3, 4]) = 5, so normalized = [0.6, 0.8]
    // norm([4, 3]) = 5, so normalized = [0.8, 0.6]
    // cosine = dot = 0.48 + 0.48 = 0.96
    const query = new Float32Array([0.6, 0.8]);
    const candidate = new Float32Array([0.8, 0.6]);
    const result = float32BatchDot(query, [candidate]);
    expect(result[0]).toBeCloseTo(0.96, 4);
  });

  it('should accumulate in Float64 to avoid float32 precision loss', () => {
    // Summing many small products: 256 dimensions all 0.1 * 0.1 = 0.01 each
    // Expected sum = 256 * 0.01 = 2.56
    const dim = 256;
    const query = new Float32Array(dim).fill(0.1);
    const candidate = new Float32Array(dim).fill(0.1);
    const result = float32BatchDot(query, [candidate]);
    // Float32 accumulation would drift; Float64 should stay close
    expect(result[0]).toBeCloseTo(2.56, 1);
  });
});

// ===========================================================================
// 5. getMaxSimTier — returns 'native', 'wasm', or 'js' (docs say 'js-fallback'
//    but implementation returns 'js')
// ===========================================================================

describe('getMaxSimTier', () => {
  it('should return one of the expected tier strings', () => {
    const tier = getMaxSimTier();
    expect(['native', 'wasm', 'js']).toContain(tier);
  });

  it('should return a string', () => {
    expect(typeof getMaxSimTier()).toBe('string');
  });
});

// ===========================================================================
// 6. initWasm — initializes without error
// ===========================================================================

describe('initWasm', () => {
  it('should resolve to true', async () => {
    const result = await initWasm();
    expect(result).toBe(true);
  });

  it('should be idempotent (calling twice returns same result)', async () => {
    const first = await initWasm();
    const second = await initWasm();
    expect(first).toBe(second);
  });
});

// ===========================================================================
// 7. Boolean status functions — isWasmAvailable / isNativeMaxSimAvailable /
//    isMaxSimWasmAvailable
// ===========================================================================

describe('status functions', () => {
  it('isWasmAvailable should return a boolean', () => {
    expect(typeof isWasmAvailable()).toBe('boolean');
  });

  it('isNativeMaxSimAvailable should return a boolean', () => {
    expect(typeof isNativeMaxSimAvailable()).toBe('boolean');
  });

  it('isMaxSimWasmAvailable should return a boolean', () => {
    expect(typeof isMaxSimWasmAvailable()).toBe('boolean');
  });

  it('isWasmAvailable should be true when simd-distance.wasm exists', () => {
    // After initWasm, if the .wasm file was loaded, this must be true.
    // The simd-distance.wasm is checked in alongside the JS file.
    expect(isWasmAvailable()).toBe(true);
  });

  it('tier and status functions should be consistent', () => {
    const tier = getMaxSimTier();
    if (tier === 'native') {
      expect(isNativeMaxSimAvailable()).toBe(true);
    } else if (tier === 'wasm') {
      // WASM tier: at least one of maxsim-wasm or simd-distance wasm maxsim_f32 is loaded
      expect(isMaxSimWasmAvailable() || isWasmAvailable()).toBe(true);
    }
    // tier === 'js' means neither native nor wasm maxsim — no further assertion needed
  });
});

// ===========================================================================
// Cross-cutting: WASM vs JS-fallback agreement
// ===========================================================================

describe('WASM vs JS-fallback agreement', () => {
  it('wasmHammingDistance should agree with popcount reference for random-like vectors', () => {
    // Manually compute reference: XOR then count bits via lookup
    const POPCOUNT_LUT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      POPCOUNT_LUT[i] = (i & 1) + POPCOUNT_LUT[i >> 1];
    }

    const a = new Uint8Array([0x3C, 0xA7, 0x91, 0x2F, 0x88, 0x1D, 0xE5, 0x6B]);
    const b = new Uint8Array([0xC3, 0x59, 0x6E, 0xD0, 0x77, 0xE2, 0x1A, 0x94]);

    let expected = 0;
    for (let i = 0; i < a.length; i++) {
      expected += POPCOUNT_LUT[a[i] ^ b[i]];
    }

    expect(wasmHammingDistance(a, b)).toBe(expected);
  });

  it('wasmInt8Dot should match manual dot product reference', () => {
    const a = new Int8Array([12, -34, 56, -78, 90, -100, 110, -120]);
    const b = new Int8Array([-11, 22, -33, 44, -55, 66, -77, 88]);

    let expected = 0;
    for (let i = 0; i < a.length; i++) expected += a[i] * b[i];

    expect(wasmInt8Dot(a, b)).toBe(expected);
  });

  it('wasmInt8Cosine should match manual cosine reference', () => {
    const a = new Int8Array([12, -34, 56, -78]);
    const b = new Int8Array([-11, 22, -33, 44]);

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const expected = dot / (Math.sqrt(normA) * Math.sqrt(normB));

    expect(wasmInt8Cosine(a, b)).toBeCloseTo(expected, 5);
  });

  it('float32BatchDot should match manual dot product for non-trivial vectors', () => {
    const query = new Float32Array([0.123, -0.456, 0.789, -0.321, 0.654]);
    const c0 = new Float32Array([0.987, -0.654, 0.321, -0.789, 0.456]);
    const c1 = new Float32Array([-0.111, 0.222, -0.333, 0.444, -0.555]);

    function manualDot(a, b) {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * b[i];
      return s;
    }

    const result = float32BatchDot(query, [c0, c1]);
    expect(result[0]).toBeCloseTo(manualDot(query, c0), 3);
    expect(result[1]).toBeCloseTo(manualDot(query, c1), 3);
  });
});
