/**
 * ss-grep allocation arms (SS_FIX_GREP_ALLOC_RULE, SS_FIX_GREP_WEIGHT): the first-line guarantee,
 * Huntington–Hill, and the saturating weight hits / (hits + 2) x prior. Default off; without
 * them the shipped rule (sqrt(hits) x prior, Sainte-Laguë) renders unchanged.
 */
import { describe, expect, it } from 'vitest';

import {
  allocateGrepLinesSainteLague,
  applyGrepFileDiversity,
  grepFilePrior,
  renderGrepBody,
  selectGrepFilesByWeight,
} from '../../core/search/grep-output-shaping.js';
import { allocateGrepLinesWithFirstLine, grepWeightKey } from '../../core/search/grep-allocation-rules.js';

function m(file, line, text = `hit ${line}`) {
  return { file, line, column: 1, matchText: text, content: text };
}

function matchList(counts) {
  const out = [];
  for (const file of Object.keys(counts).sort((a, b) => a.localeCompare(b))) {
    for (let line = 1; line <= counts[file]; line++) out.push(m(file, line));
  }
  return out;
}

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const scaleOf = file => 16 * grepFilePrior(file) ** 2;

/** Brute force: a first-line pass in order, then every line scans every file by real divisors. */
function referenceFirstLine(weights, totals, caps, budget, rule) {
  const alloc = weights.map(() => 0);
  let remaining = budget;
  for (let i = 0; i < weights.length && remaining > 0; i++) {
    if (caps[i] > 0) { alloc[i] = 1; remaining--; }
  }
  const div = rule === 'hh' ? a => Math.sqrt(a * (a + 1)) : a => 2 * a + 1;
  for (; remaining > 0; remaining--) {
    let best = -1;
    for (let i = 0; i < weights.length; i++) {
      if (alloc[i] >= caps[i] || alloc[i] === 0) continue;
      if (best < 0) { best = i; continue; }
      const qi = weights[i] / div(alloc[i]); const qb = weights[best] / div(alloc[best]);
      if (qi > qb * (1 + 1e-12) || (Math.abs(qi - qb) <= qb * 1e-12 && totals[i] > totals[best])) best = i;
    }
    if (best < 0) break;
    alloc[best]++;
  }
  return alloc;
}

describe('grepWeightKey', () => {
  it('sqrt (absent): hits x scale, the shipped exact integer key', () => {
    expect(grepWeightKey(9, 16)).toBe(144);
    expect(grepWeightKey(9, 4, 'sqrt')).toBe(36);
  });

  it('sat2: 16 x (hits / (hits + 2) x prior)^2', () => {
    expect(grepWeightKey(2, 16, 'sat2')).toBeCloseTo(16 * 0.25, 12);
    expect(grepWeightKey(2, 4, 'sat2')).toBeCloseTo(16 * (0.5 * 0.5) ** 2, 12);
    // saturates: 1,000 hits is barely above 100
    expect(grepWeightKey(1000, 16, 'sat2') / grepWeightKey(100, 16, 'sat2')).toBeLessThan(1.05);
  });
});

describe('allocateGrepLinesWithFirstLine', () => {
  const run = (hits, caps, budget, rule, files = hits.map((_, i) => `f${i}.go`)) =>
    [...allocateGrepLinesWithFirstLine(hits.map((h, i) => grepWeightKey(h, scaleOf(files[i]))), hits, caps, budget, rule)];

  it('10,000 / 1 / 1 at k = 20: the shipped rule gives 20 / 0 / 0, the guarantee 18 / 1 / 1', () => {
    const keys = [10000, 1, 1].map(h => h * 16);
    expect([...allocateGrepLinesSainteLague(keys, [10000, 1, 1], [20, 1, 1], 20)]).toEqual([20, 0, 0]);
    expect(run([10000, 1, 1], [20, 1, 1], 20, 'guarantee')).toEqual([18, 1, 1]);
    expect(run([10000, 1, 1], [20, 1, 1], 20, 'hh')).toEqual([18, 1, 1]);
  });

  it('more files than budget: one line each to the first k files, nothing else', () => {
    expect(run([50, 9, 4, 1, 1], [5, 5, 4, 1, 1], 3, 'guarantee')).toEqual([1, 1, 1, 0, 0]);
    expect(run([50, 9, 4, 1, 1], [5, 5, 4, 1, 1], 3, 'hh')).toEqual([1, 1, 1, 0, 0]);
  });

  it('after the first line, guarantee continues by Sainte-Laguë and hh by sqrt(a (a + 1))', () => {
    // weights sqrt(26) = 5.10 and 3 (ratio 1.70); first pass 1 / 1, then A's 2nd line under both.
    // A's 3rd line vs B's 2nd: SL 5.10/5 = 1.02 > 3/3 = 1; HH 5.10/sqrt(6) = 2.08 < 3/sqrt(2) = 2.12.
    expect(run([26, 9], [10, 10], 4, 'guarantee')).toEqual([3, 1]);
    expect(run([26, 9], [10, 10], 4, 'hh')).toEqual([2, 2]);
  });

  it('caps and zero-cap files are respected; zero budget gives nothing', () => {
    expect(run([400, 1, 1], [2, 0, 1], 10, 'guarantee')).toEqual([2, 0, 1]);
    expect(run([3, 3], [3, 3], 0, 'hh')).toEqual([0, 0]);
    expect(run([], [], 5, 'guarantee')).toEqual([]);
  });

  it('agrees with a brute-force scan on 3,000 random inputs, both rules', () => {
    const r = prng(17);
    for (let c = 0; c < 3000; c++) {
      const n = 1 + Math.floor(r() * 30);
      const files = []; const hits = [];
      for (let i = 0; i < n; i++) {
        const u = r();
        files.push(u < 0.6 ? `src/f${i}.go` : u < 0.85 ? `src/f${i}_test.go` : `vendor/f${i}.go`);
        hits.push(1 + Math.floor(r() * r() * 60));
      }
      const order = files.map((_, i) => i).sort((a, b) =>
        grepWeightKey(hits[b], scaleOf(files[b])) - grepWeightKey(hits[a], scaleOf(files[a])) || hits[b] - hits[a] || a - b);
      const keys = order.map(i => grepWeightKey(hits[i], scaleOf(files[i])));
      const weights = keys.map(k => Math.sqrt(k));
      const totals = order.map(i => hits[i]);
      const caps = totals.map(t => Math.min(t, 1 + Math.floor(r() * 30)));
      const budget = Math.floor(r() * 50);
      for (const rule of ['guarantee', 'hh']) {
        const got = [...allocateGrepLinesWithFirstLine(keys, totals, caps, budget, rule)];
        const want = referenceFirstLine(weights, totals, caps, budget, rule);
        expect(got.reduce((a, b) => a + b, 0)).toBe(want.reduce((a, b) => a + b, 0));
        expect(got).toEqual(want);
      }
    }
  });
});

describe('selectGrepFilesByWeight weight: sat2', () => {
  it('a flatter weight lets the prior dominate: many-hit test files fall below few-hit sources', () => {
    const counts = { 'a.go': 2, 'b_test.go': 40, 'c.go': 1, 'd_test.go': 9 };
    const sqrt = selectGrepFilesByWeight(matchList(counts), { perFileCap: 5, maxFiles: 4 });
    const sat = selectGrepFilesByWeight(matchList(counts), { perFileCap: 5, maxFiles: 4, weight: 'sat2' });
    // sqrt: b_test 3.16, d_test 1.5, a 1.41, c 1; sat2: a 0.5, b_test 0.476, d_test 0.41, c 0.33
    expect(sqrt.fileSummary.files.map(f => f.file)).toEqual(['b_test.go', 'd_test.go', 'a.go', 'c.go']);
    expect(sat.fileSummary.files.map(f => f.file)).toEqual(['a.go', 'b_test.go', 'd_test.go', 'c.go']);
    expect(sat.fileSummary.weight).toBe('sat2');
    expect(sqrt.fileSummary.weight).toBeUndefined();
    expect(sat.fileSummary.files.map(f => f.prior)).toEqual([1, 0.5, 0.5, 1]);
  });

  it('agrees with a brute-force sat2 top-maxFiles on 2,000 random match lists', () => {
    const r = prng(23);
    for (let c = 0; c < 2000; c++) {
      const counts = {};
      for (let i = 0, n = 1 + Math.floor(r() * 50); i < n; i++) {
        const u = r();
        const file = u < 0.6 ? `d${i % 5}/f${i}.go` : u < 0.85 ? `d${i % 5}/f${i}_test.go` : `vendor/f${i}.go`;
        counts[file] = 1 + Math.floor(r() * r() * 30);
      }
      const maxFiles = 1 + Math.floor(r() * 20);
      const key = (h, f) => grepWeightKey(h, scaleOf(f), 'sat2');
      const order = Object.keys(counts).sort((a, b) => a.localeCompare(b))
        .map((file, i) => ({ file, hits: counts[file], i }))
        .sort((a, b) => key(b.hits, b.file) - key(a.hits, a.file) || b.hits - a.hits || a.i - b.i);
      const { fileSummary } = selectGrepFilesByWeight(matchList(counts), { perFileCap: 5, maxFiles, weight: 'sat2' });
      expect(fileSummary.files.map(f => f.file)).toEqual(order.slice(0, maxFiles).map(f => f.file));
      expect(fileSummary.hiddenSample.map(f => f.file)).toEqual(order.slice(maxFiles, maxFiles + 3).map(f => f.file));
      expect(fileSummary.hiddenMatchCount).toBe(order.slice(maxFiles).reduce((a, f) => a + f.hits, 0));
    }
  });
});

describe('renderGrepBody alloc: weight with the plan arms', () => {
  const render = (counts, k, opts = {}, engineOpts = {}) => {
    const { kept, fileSummary } = applyGrepFileDiversity(matchList(counts), {
      perFileCap: Math.min(k, 100), maxFiles: k, order: 'weight', ...engineOpts,
    });
    return renderGrepBody(kept, fileSummary, k, { alloc: 'weight', ...opts });
  };

  it('no arm options: byte-identical to the shipped weighted body', () => {
    const r = prng(29);
    for (let c = 0; c < 200; c++) {
      const counts = {};
      for (let i = 0, n = 1 + Math.floor(r() * 25); i < n; i++) counts[`${r() < 0.3 ? 'tests/' : 'src/'}f${i}.go`] = 1 + Math.floor(r() * 20);
      const k = 1 + Math.floor(r() * 30);
      expect(render(counts, k, { weight: undefined, rule: undefined, lineClasses: false })).toEqual(render(counts, k));
    }
  });

  it('rule: guarantee shows every file when they all fit (the shipped rule can leave one at zero)', () => {
    const counts = { 'big.go': 100, 'a.go': 1, 'b.go': 1 };
    expect(render(counts, 3).rows.map(r => r.file)).toEqual(['big.go', 'big.go', 'big.go']);
    const body = render(counts, 3, { rule: 'guarantee' });
    expect(body.lines).toEqual(['big.go:1: hit 1 (+99 more in this file)', 'a.go:1: hit 1', 'b.go:1: hit 1']);
    expect(body.hiddenLine).toBeNull();
  });

  it('weight: sat2 needs the engine to have used sat2 too, else the renderer re-sorts by sat2', () => {
    const counts = { 'a.go': 2, 'b_test.go': 40, 'c.go': 1 };
    const both = render(counts, 3, { weight: 'sat2' }, { weight: 'sat2' });
    const rendererOnly = render(counts, 3, { weight: 'sat2' });
    expect(both.rows.map(r => r.file)[0]).toBe('a.go');
    expect(rendererOnly.lines).toEqual(both.lines);
  });
});
