/**
 * Regression tests for the native inference output checks. Each test
 * injects one defect the old CUDA parity gate could miss and asserts the
 * check names it.
 */
import { describe, it, expect } from 'vitest';
import {
  checkEmbeddingBatch,
  checkLateInteractionBatch,
  compareEmbeddings,
  compareLateInteraction,
  checkBackend,
} from '../../core/infrastructure/inference-parity.js';

const DIM = 8;

function unit(seed) {
  const v = Float32Array.from({ length: DIM }, (_, k) => ((seed * 7 + k * 3) % 11) + 1 + (k === seed % DIM ? 5 : 0));
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

function docs(shape) {
  let seed = 0;
  return shape.map((len) => Array.from({ length: len }, () => unit(seed++)));
}

/** Rotate a unit vector toward another so its cosine with the original is about 0.90. */
function bend(v, other) {
  const m = v.map((x, k) => 0.9 * x + 0.45 * other[k]);
  const n = Math.hypot(...m);
  return m.map((x) => x / n);
}

const LI_TOL = { minTokenCosine: 0.99, meanTokenCosine: 0.998, maxSimRelTol: 1e-2 };
const EMBED_TOL = { minCosine: 0.99, meanCosine: 0.998 };

const codes = (r) => r.reasons.map((s) => s.split(':')[0]);

describe('compareLateInteraction', () => {
  it('passes identical output', () => {
    const ref = docs([16, 9, 30]);
    const r = compareLateInteraction(ref, ref, LI_TOL);
    expect(r.ok).toBe(true);
    expect(r.tokenStats.n).toBe(55);
  });

  it('fails when trailing tokens are removed', () => {
    const ref = docs([16, 9, 30]);
    const cand = ref.map((d) => d.slice());
    cand[2] = cand[2].slice(0, 20);
    expect(codes(compareLateInteraction(cand, ref, LI_TOL))).toContain('token_count_mismatch');
  });

  it('fails when a document is missing', () => {
    const ref = docs([16, 9, 30]);
    expect(codes(compareLateInteraction(ref.slice(0, 2), ref, LI_TOL))).toContain('count_mismatch');
  });

  it('fails on one corrupted token that a mean-only gate passes', () => {
    const ref = docs([64]);
    const cand = [ref[0].slice()];
    cand[0][10] = bend(ref[0][10], unit(99));
    const r = compareLateInteraction(cand, ref, LI_TOL);
    expect(r.tokenStats.mean).toBeGreaterThan(0.998);
    expect(codes(r)).toContain('min_cosine');
  });

  it('fails on a non-finite value', () => {
    const ref = docs([4, 4]);
    const cand = ref.map((d) => d.map((t) => Float32Array.from(t)));
    cand[1][2][3] = NaN;
    expect(codes(compareLateInteraction(cand, ref, LI_TOL))).toContain('non_finite');
  });

  it('fails on a zero vector', () => {
    const ref = docs([4]);
    const cand = [ref[0].slice()];
    cand[0][1] = new Float32Array(DIM);
    expect(codes(compareLateInteraction(cand, ref, LI_TOL))).toContain('bad_norm');
  });

  it('fails when every token shifts enough to change MaxSim scores', () => {
    const ref = docs([12, 12, 12]);
    const cand = ref.map((d, i) => d.map((t, j) => bend(t, unit(500 + i * 31 + j))));
    const r = compareLateInteraction(cand, ref, { ...LI_TOL, minTokenCosine: 0, meanTokenCosine: 0 });
    expect(codes(r)).toContain('maxsim_diff');
  });
});

describe('compareEmbeddings', () => {
  it('passes identical output and fails a short batch', () => {
    const ref = docs([5])[0];
    expect(compareEmbeddings(ref, ref, EMBED_TOL).ok).toBe(true);
    expect(codes(compareEmbeddings(ref.slice(0, 4), ref, EMBED_TOL))).toContain('count_mismatch');
  });

  it('fails a wrong dimension and an empty batch', () => {
    const ref = docs([3])[0];
    const cand = ref.map((v, i) => (i === 1 ? v.slice(0, DIM - 1) : v));
    expect(codes(compareEmbeddings(cand, ref, EMBED_TOL))).toContain('dim_mismatch');
    expect(codes(compareEmbeddings([], [], EMBED_TOL))).toContain('empty');
  });

  it('fails one bent vector on min cosine', () => {
    const ref = docs([64])[0];
    const cand = ref.slice();
    cand[3] = bend(ref[3], unit(77));
    expect(codes(compareEmbeddings(cand, ref, EMBED_TOL))).toContain('min_cosine');
  });
});

describe('batch checks', () => {
  it('checkEmbeddingBatch rejects NaN', () => {
    const v = docs([2])[0];
    v[0] = Float32Array.from(v[0]);
    v[0][0] = NaN;
    expect(codes(checkEmbeddingBatch(v, { count: 2, dim: DIM }))).toContain('non_finite');
  });

  it('checkLateInteractionBatch rejects an empty document', () => {
    const d = docs([3, 0]);
    expect(codes(checkLateInteractionBatch(d, { count: 2, dim: DIM }))).toContain('empty');
  });
});

describe('checkBackend', () => {
  it('accepts the requested device with or without the CoreML prefix', () => {
    expect(checkBackend({ backend: 'cuda/bf16' }, 'cuda').ok).toBe(true);
    expect(checkBackend({ backend: 'coreml+metal/bf16' }, 'metal').ok).toBe(true);
  });

  it('rejects a silent CPU fallback and an addon without the getter', () => {
    expect(codes(checkBackend({ backend: 'cpu/f32' }, 'cuda'))).toContain('backend_mismatch');
    expect(codes(checkBackend({}, 'cuda'))).toContain('backend_mismatch');
  });
});
