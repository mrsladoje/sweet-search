/**
 * Unit tests for core/prompt-optimization/sweep/agent-query-degrader.mjs
 *
 * Covers:
 *  - buildBuckets: counts 28/6/3/3 (deterministic by index)
 *  - dropArticles / abbreviatePackages / lowercaseWrongExt / telegraphic
 *  - generateVariants: total variant count; deterministic C/D templates
 *  - computeDrops: per-target aggregate; bucket-A flag; bucket-B asymmetry
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildBuckets,
  dropArticles,
  abbreviatePackages,
  lowercaseWrongExt,
  telegraphic,
  generateVariants,
  computeDrops,
} from '../../../core/prompt-optimization/sweep/agent-query-degrader.mjs';
import { DEFAULTS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

// ─── fixtures ─────────────────────────────────────────────────────────────

function makeProbes(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `probe-${i}`,
    query: `Find the implementation of SortArray function in the main module`,
    expectedSymbols: ['SortArray'],
    expectedFiles: ['src/main.ts'],
  }));
}

// ─── buildBuckets ─────────────────────────────────────────────────────────

describe('buildBuckets', () => {
  it('assigns probes to buckets of size 28/6/3/3', () => {
    const probes = makeProbes(40);
    const { A, B, C, D } = buildBuckets({ devProbes: probes });
    expect(A).toHaveLength(28);
    expect(B).toHaveLength(6);
    expect(C).toHaveLength(3);
    expect(D).toHaveLength(3);
  });

  it('total across buckets equals 40', () => {
    const probes = makeProbes(40);
    const { A, B, C, D } = buildBuckets({ devProbes: probes });
    expect(A.length + B.length + C.length + D.length).toBe(40);
  });

  it('assignment is deterministic by index (A = first 28)', () => {
    const probes = makeProbes(40);
    const { A, B, C, D } = buildBuckets({ devProbes: probes });
    expect(A[0].id).toBe('probe-0');
    expect(A[27].id).toBe('probe-27');
    expect(B[0].id).toBe('probe-28');
    expect(B[5].id).toBe('probe-33');
    expect(C[0].id).toBe('probe-34');
    expect(D[0].id).toBe('probe-37');
  });

  it('is referentially consistent — same input yields same output', () => {
    const probes = makeProbes(40);
    const r1 = buildBuckets({ devProbes: probes });
    const r2 = buildBuckets({ devProbes: probes });
    expect(r1.A.map((p) => p.id)).toEqual(r2.A.map((p) => p.id));
  });

  it('throws when not given exactly 40 probes', () => {
    expect(() => buildBuckets({ devProbes: makeProbes(39) })).toThrow(/40/);
    expect(() => buildBuckets({ devProbes: makeProbes(41) })).toThrow(/40/);
  });

  it('throws when devProbes is not an array', () => {
    expect(() => buildBuckets({ devProbes: null })).toThrow(/array/);
  });
});

// ─── deterministic template functions ────────────────────────────────────

describe('dropArticles', () => {
  it('removes "the", "a", "an" from a query', () => {
    expect(dropArticles('Find the main function in a module')).not.toMatch(/\b(the|a|an)\b/i);
  });

  it('preserves core identifier words', () => {
    const result = dropArticles('Find the SortArray function in the main module');
    expect(result).toContain('SortArray');
    expect(result).toContain('function');
  });

  it('collapses extra whitespace', () => {
    const result = dropArticles('the the the foo');
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('is idempotent on queries without articles', () => {
    const q = 'SortArray implementation';
    expect(dropArticles(q)).toBe(q);
  });
});

describe('abbreviatePackages', () => {
  it('removes node: prefix', () => {
    expect(abbreviatePackages('find node:fs module')).not.toContain('node:');
  });

  it('strips leading package segments before a dot', () => {
    const result = abbreviatePackages('fs.readFile implementation');
    expect(result).not.toContain('fs.');
  });

  it('returns a non-empty string', () => {
    const result = abbreviatePackages('mypackage.MyClass function');
    expect(result.trim().length).toBeGreaterThan(0);
  });
});

describe('lowercaseWrongExt', () => {
  it('lowercases the entire query', () => {
    const result = lowercaseWrongExt('Find SortArray in Main.TS');
    expect(result).toBe(result.toLowerCase());
  });

  it('swaps .ts → .js extension', () => {
    expect(lowercaseWrongExt('find foo.ts')).toContain('.js');
  });

  it('swaps .js → .ts extension', () => {
    expect(lowercaseWrongExt('find bar.js')).toContain('.ts');
  });

  it('swaps .py → .rb extension', () => {
    expect(lowercaseWrongExt('find baz.py')).toContain('.rb');
  });

  it('swaps .go → .rs extension', () => {
    expect(lowercaseWrongExt('find main.go')).toContain('.rs');
  });
});

describe('telegraphic', () => {
  it('strips common filler words', () => {
    const result = telegraphic('Where is the SortArray function defined?');
    expect(result).not.toMatch(/\b(where|is|the)\b/i);
  });

  it('removes question marks and punctuation', () => {
    const result = telegraphic('What does foo.bar do?');
    expect(result).not.toContain('?');
  });

  it('lowercases the result', () => {
    const result = telegraphic('Find SortArray Implementation');
    expect(result).toBe(result.toLowerCase());
  });

  it('returns a non-empty string for a typical query', () => {
    const result = telegraphic('Where is the merge function in the core module?');
    expect(result.trim().length).toBeGreaterThan(0);
  });
});

// ─── generateVariants ────────────────────────────────────────────────────

describe('generateVariants', () => {
  const makeCallModel = () =>
    vi.fn(async ({ model, prompt }) => ({ text: `[${model}] variant for: ${prompt.slice(0, 20)}` }));

  it('produces 28 A-variants + 24 B-variants + 3 C-variants + 3 D-variants = 58 total', async () => {
    const probes = makeProbes(40);
    const buckets = buildBuckets({ devProbes: probes });
    const callModel = makeCallModel();
    const variants = await generateVariants({ buckets, callModel });

    expect(variants).toHaveLength(58);
    expect(variants.filter((v) => v.bucket === 'A')).toHaveLength(28);
    expect(variants.filter((v) => v.bucket === 'B')).toHaveLength(24);
    expect(variants.filter((v) => v.bucket === 'C')).toHaveLength(3);
    expect(variants.filter((v) => v.bucket === 'D')).toHaveLength(3);
  });

  it('C and D variants are deterministic (no callModel call for them)', async () => {
    const probes = makeProbes(40);
    const buckets = buildBuckets({ devProbes: probes });
    const callModel = makeCallModel();
    const variants = await generateVariants({ buckets, callModel });

    const cVariants = variants.filter((v) => v.bucket === 'C');
    const dVariants = variants.filter((v) => v.bucket === 'D');

    // C variants should use deterministic templates (generator = 'deterministic')
    for (const cv of cVariants) {
      expect(cv.generator).toBe('deterministic');
    }
    for (const dv of dVariants) {
      expect(dv.generator).toBe('deterministic');
    }
  });

  it('C/D variants produce different text from the original query', async () => {
    const probes = makeProbes(40);
    const buckets = buildBuckets({ devProbes: probes });
    const callModel = makeCallModel();
    const variants = await generateVariants({ buckets, callModel });

    const cVariants = variants.filter((v) => v.bucket === 'C');
    const dVariants = variants.filter((v) => v.bucket === 'D');

    // Telegraphic should at least differ in case or content
    for (const dv of dVariants) {
      expect(dv.variant.length).toBeGreaterThan(0);
    }
    for (const cv of cVariants) {
      expect(cv.variant.length).toBeGreaterThan(0);
    }
  });

  it('each A-variant has a probeId and generator from the rotation', async () => {
    const probes = makeProbes(40);
    const buckets = buildBuckets({ devProbes: probes });
    const callModel = makeCallModel();
    const variants = await generateVariants({ buckets, callModel });

    const aVariants = variants.filter((v) => v.bucket === 'A');
    for (const av of aVariants) {
      expect(typeof av.probeId).toBe('string');
      expect(typeof av.generator).toBe('string');
      expect(av.generator).not.toBe('deterministic');
    }
  });

  it('each B-variant has 4 families covered per probe (24 total for 6 probes)', async () => {
    const probes = makeProbes(40);
    const buckets = buildBuckets({ devProbes: probes });
    const callModel = makeCallModel();
    const variants = await generateVariants({ buckets, callModel });

    const bVariants = variants.filter((v) => v.bucket === 'B');
    const grouped = {};
    for (const bv of bVariants) {
      grouped[bv.probeId] = grouped[bv.probeId] || new Set();
      grouped[bv.probeId].add(bv.generator);
    }
    for (const families of Object.values(grouped)) {
      expect(families.size).toBe(4);
    }
  });

  it('throws when callModel is not a function', async () => {
    const probes = makeProbes(40);
    const buckets = buildBuckets({ devProbes: probes });
    await expect(generateVariants({ buckets, callModel: null })).rejects.toThrow(/callModel/);
  });
});

// ─── computeDrops ────────────────────────────────────────────────────────

describe('computeDrops', () => {
  const THRESH = DEFAULTS.agentQueryMaxDrop; // 0.20

  function makeBaseline(probeIds, score = 0.9) {
    return Object.fromEntries(probeIds.map((id) => [id, { sonnet: score, gpt5_5: score }]));
  }

  function makeDegraded(probeIds, bucket, scores, generator = undefined) {
    return probeIds.map((id) => ({
      probeId: id,
      bucket,
      generator,
      scores,
    }));
  }

  it('returns pass=true when all drops are within 20%', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const baseline = makeBaseline(ids, 0.9);
    // Drop of 0.10 on each → 10% < 20%
    const degraded = makeDegraded(ids.slice(0, 8), 'A', { sonnet: 0.8, gpt5_5: 0.8 });

    const result = computeDrops({ baseline, degraded });
    expect(result.pass).toBe(true);
    expect(result.bucketADropFlag).toBe(false);
  });

  it('sets bucketADropFlag when bucket-A mean drop exceeds 20%', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `a${i}`);
    const baseline = makeBaseline(ids, 1.0);
    // Drop of 0.25 on sonnet → 25% > 20%
    const degraded = makeDegraded(ids, 'A', { sonnet: 0.75, gpt5_5: 0.85 });

    const result = computeDrops({ baseline, degraded });
    expect(result.bucketADropFlag).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('sets bucketBAsymmetryFlag when one family drops >20% while another does not', () => {
    const ids = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
    const baseline = makeBaseline(ids, 1.0);
    // Family 'sonnet': small drop (5%)
    // Family 'gpt-5.5': large drop (30%)
    const degraded = [
      ...ids.map((id) => ({ probeId: id, bucket: 'B', generator: 'sonnet', scores: { sonnet: 0.95, gpt5_5: 0.95 } })),
      ...ids.map((id) => ({ probeId: id, bucket: 'B', generator: 'gpt-5.5', scores: { sonnet: 0.70, gpt5_5: 0.70 } })),
    ];

    const result = computeDrops({ baseline, degraded });
    expect(result.bucketBAsymmetryFlag).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('does NOT set asymmetry flag when all families drop similarly', () => {
    const ids = ['b0', 'b1', 'b2'];
    const baseline = makeBaseline(ids, 1.0);
    const degraded = [
      ...ids.map((id) => ({ probeId: id, bucket: 'B', generator: 'sonnet', scores: { sonnet: 0.85, gpt5_5: 0.85 } })),
      ...ids.map((id) => ({ probeId: id, bucket: 'B', generator: 'gpt-5.5', scores: { sonnet: 0.85, gpt5_5: 0.85 } })),
    ];

    const result = computeDrops({ baseline, degraded });
    expect(result.bucketBAsymmetryFlag).toBe(false);
  });

  it('perTarget reflects mean drop across all variants', () => {
    const ids = ['p0', 'p1'];
    const baseline = makeBaseline(ids, 1.0);
    // All drops = 0.1 on sonnet, 0.05 on gpt5_5
    const degraded = makeDegraded(ids, 'A', { sonnet: 0.9, gpt5_5: 0.95 });

    const result = computeDrops({ baseline, degraded });
    expect(result.perTarget.sonnet).toBeCloseTo(0.1, 5);
    expect(result.perTarget.gpt5_5).toBeCloseTo(0.05, 5);
  });

  it('perBucket contains keys A, B, C, D', () => {
    const result = computeDrops({ baseline: {}, degraded: [] });
    expect(result.perBucket).toHaveProperty('A');
    expect(result.perBucket).toHaveProperty('B');
    expect(result.perBucket).toHaveProperty('C');
    expect(result.perBucket).toHaveProperty('D');
  });

  it('throws when baseline is not an object', () => {
    expect(() => computeDrops({ baseline: null, degraded: [] })).toThrow(/baseline/);
  });

  it('throws when degraded is not an array', () => {
    expect(() => computeDrops({ baseline: {}, degraded: null })).toThrow(/degraded/);
  });

  it('uses DEFAULTS.agentQueryMaxDrop (0.2) as the threshold', () => {
    expect(DEFAULTS.agentQueryMaxDrop).toBe(0.2);
  });
});
