/**
 * Unit tests for the OPT-IN MAP-Elites behavioral-descriptor archive
 * (core/prompt-optimization/sweep/gepa-map-elites.mjs).
 *
 * Pure-function coverage (descriptors, binning, in-bin displacement, uniform
 * parent selection, determinism) + an end-to-end opt-in safety check that the
 * DEFAULT path is byte-identical and a map-elites resume == fresh.
 *
 * Everything is STUBBED (deterministic evaluateCandidate / callModel, tmp-dir
 * persistence). NO network, NO real agents. $0.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import {
  computeDescriptors,
  binIndex,
  binKey,
  betterInBin,
  buildArchive,
  attemptArchiveAdmission,
  selectParentMapElites,
  archiveStats,
  migrateElites,
  shouldResetArchive,
} from '../../../core/prompt-optimization/sweep/gepa-map-elites.mjs';
import { runGepa, roundRng, makeDryRunCallModel } from '../../../core/prompt-optimization/sweep/gepa.mjs';
import { attemptParetoAdmission } from '../../../core/prompt-optimization/sweep/gepa-pareto.mjs';
import { DEFAULTS, isNearDuplicate } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';
import { loadTrajectory } from '../../../core/prompt-optimization/sweep/p7-persist.mjs';

// ─── fixtures ────────────────────────────────────────────────────────────────

/** A tool call of family `name` ('ss-search' | 'Bash' with a grep command | …). */
function tc(name, command) {
  return command ? { name, input: { command } } : { name };
}

/** Build a candidate `detail` map: detailSpec[pid][target] = array-of-toolCalls. */
function mkDetail(spec) {
  const detail = {};
  for (const pid of Object.keys(spec)) {
    detail[pid] = {};
    for (const target of ['sonnet', 'gpt5_5']) {
      const calls = spec[pid][target] ?? [];
      detail[pid][target] = { score: 1, traj: { toolCalls: calls, answer: 'a' } };
    }
  }
  return detail;
}

/** Build a scored candidate object (the unit the front passes around). */
function mkCandidate({ id, detail, finalScore = 0.3, taskScore = 1.0, costUsd = 0.2, scores = {}, prompt, hash }) {
  return {
    id,
    hash: hash ?? `0xhash-${id}`,
    prompt: prompt ?? `prompt for ${id}`,
    detail,
    finalScore,
    taskScore,
    costUsd,
    scores,
    score_sonnet: 1,
    score_gpt5_5: 1,
  };
}

const ssCalls = (n) => Array.from({ length: n }, () => tc('ss-search'));

// ─── 1. behavioral descriptors ───────────────────────────────────────────────

describe('computeDescriptors — behavioral, from trajectories not text', () => {
  it('d1 medianToolCalls is the median over ALL (probe,target) runs', () => {
    // calls per run: p1 sonnet 2, p1 gpt 2, p2 sonnet 4, p2 gpt 6 → sorted [2,2,4,6] → median 3
    const detail = mkDetail({
      p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) },
      p2: { sonnet: ssCalls(4), gpt5_5: ssCalls(6) },
    });
    const d = computeDescriptors(mkCandidate({ id: 'A', detail }), {});
    expect(d.medianToolCalls).toBe(3);
  });

  it('d2 noMatchCalls uses the WORSE (more-spiraling) target on no-match probes', () => {
    const detail = mkDetail({
      lit1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) },     // literal — ignored by d2
      nm1: { sonnet: ssCalls(16), gpt5_5: ssCalls(6) },     // no-match — worse=16
      nm2: { sonnet: ssCalls(8), gpt5_5: ssCalls(12) },     // no-match — worse=12
    });
    const stratumById = {
      lit1: { stratum: 'literal-lookup' },
      nm1: { stratum: 'no-match' },
      nm2: { stratum: 'no-match' },
    };
    const d = computeDescriptors(mkCandidate({ id: 'A', detail }), stratumById);
    expect(d.noMatchCalls).toBe(14); // mean(16, 12)
  });

  it('d2 falls back to d1 when the probe set has no no-match stratum (descriptor stays total)', () => {
    const detail = mkDetail({ p1: { sonnet: ssCalls(3), gpt5_5: ssCalls(3) } });
    const d = computeDescriptors(mkCandidate({ id: 'A', detail }), { p1: { stratum: 'literal-lookup' } });
    expect(d.noMatchCalls).toBe(d.medianToolCalls);
    expect(d.noMatchCalls).toBe(3);
  });

  it('d3 nativeFallbackRate counts runs that reached for native grep/find/cat (not ss-*)', () => {
    const detail = mkDetail({
      p1: { sonnet: [tc('ss-search'), tc('Bash', 'rg foo src/')], gpt5_5: ssCalls(2) }, // sonnet native (rg)
      p2: { sonnet: ssCalls(3), gpt5_5: [tc('Read')] },                                  // gpt native (Read)
    });
    const d = computeDescriptors(mkCandidate({ id: 'A', detail }), {});
    // 2 native runs (p1.sonnet, p2.gpt5_5) out of 4 → 0.5
    expect(d.nativeFallbackRate).toBe(0.5);
  });

  it('ss-grep / ss-read are NOT counted as native fallback', () => {
    const detail = mkDetail({
      p1: { sonnet: [tc('Bash', 'ss-grep pattern'), tc('Bash', 'ss-read file.js')], gpt5_5: ssCalls(1) },
    });
    const d = computeDescriptors(mkCandidate({ id: 'A', detail }), {});
    expect(d.nativeFallbackRate).toBe(0);
  });

  it('no-match raw-shell spiral (find/xargs/ls after empty index probes) IS native fallback', () => {
    const detail = mkDetail({
      nm: { sonnet: [tc('ss-search'), tc('Bash', 'find . -name "*.kt" | xargs grep foo')], gpt5_5: ssCalls(1) },
    });
    const d = computeDescriptors(mkCandidate({ id: 'A', detail }), { nm: { stratum: 'no-match' } });
    expect(d.nativeFallbackRate).toBe(0.5); // 1 of 2 runs
  });

  it('empty / missing detail → all-zero descriptors (no throw)', () => {
    expect(computeDescriptors({}, {})).toEqual({ medianToolCalls: 0, noMatchCalls: 0, nativeFallbackRate: 0 });
    expect(computeDescriptors(null, {})).toEqual({ medianToolCalls: 0, noMatchCalls: 0, nativeFallbackRate: 0 });
  });

  it('d3 native-fallback classification agrees with gepa-evaluate.classifyToolUse', async () => {
    // The module re-implements the SS/native regexes locally (dependency-light);
    // pin them to the canonical classifier so they cannot silently drift.
    const { classifyToolUse } = await import('../../../core/prompt-optimization/sweep/gepa-evaluate.mjs');
    const cases = [
      [tc('Bash', 'rg foo src/'), true],
      [tc('Bash', 'ss-search "foo"'), false],
      [tc('Bash', 'ss-grep pattern'), false],
      [tc('Read'), true],
      [tc('Bash', 'cat file.js'), true],
    ];
    for (const [call, expectNative] of cases) {
      // classifyToolUse marks nativeSearch OR nativeRead; an ss-* call sets neither.
      const cls = classifyToolUse([call]);
      const evaluatorSaysNative = cls.nativeSearch || cls.nativeRead;
      const detail = mkDetail({ p1: { sonnet: [call], gpt5_5: [] } });
      const ourRate = computeDescriptors(mkCandidate({ id: 'x', detail }), {}).nativeFallbackRate;
      // our rate is 1/1 live runs when native, else 0 (p1.gpt5_5 is empty → not a native run)
      expect(ourRate > 0).toBe(expectNative);
      expect(evaluatorSaysNative).toBe(expectNative);
    }
  });
});

// ─── 2. binning ───────────────────────────────────────────────────────────────

describe('binIndex / binKey — discretization', () => {
  it('binIndex: bin i covers (edges[i-1], edges[i]]; last bin is open-ended', () => {
    const edges = [3, 5, 8, 12];
    expect(binIndex(1, edges)).toBe(0);   // ≤3
    expect(binIndex(3, edges)).toBe(0);   // boundary inclusive
    expect(binIndex(4, edges)).toBe(1);   // (3,5]
    expect(binIndex(8, edges)).toBe(2);   // (5,8]
    expect(binIndex(12, edges)).toBe(3);  // (8,12]
    expect(binIndex(13, edges)).toBe(4);  // >12 (the 5th bin)
    expect(binIndex(999, edges)).toBe(4);
  });

  it('binIndex coerces non-finite to bin 0', () => {
    expect(binIndex(NaN, [3, 5])).toBe(0);
    expect(binIndex(undefined, [3, 5])).toBe(0);
  });

  it('binKey produces a stable [d1,d2,d3] coord + colon key', () => {
    const desc = { medianToolCalls: 4, noMatchCalls: 16, nativeFallbackRate: 0.1 };
    const { coord, key } = binKey(desc); // default DEFAULTS bins
    // d1=4 → (3,5]=1 ; d2=16 → >14 =4 ; d3=0.1 → (0.08,0.2]=2
    expect(coord).toEqual([1, 4, 2]);
    expect(key).toBe('1:4:2');
  });
});

// ─── 3. archive build + in-bin competition ───────────────────────────────────

describe('buildArchive + betterInBin — one elite per behavioral niche', () => {
  it('two candidates in the SAME bin keep only the higher-finalScore elite', () => {
    const detail = mkDetail({ p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) } });
    const lo = mkCandidate({ id: 'LO', detail, finalScore: 0.20 });
    const hi = mkCandidate({ id: 'HI', detail, finalScore: 0.30 });
    const archive = buildArchive([lo, hi], {});
    expect(archive.size).toBe(1);
    expect([...archive.values()][0].elite.id).toBe('HI');
  });

  it('candidates with DISTINCT behavior occupy DISTINCT bins (no collapse)', () => {
    const cheapShort = mkCandidate({ id: 'A', detail: mkDetail({ p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) } }) });
    const spiraler = mkCandidate({ id: 'B', detail: mkDetail({ p1: { sonnet: ssCalls(16), gpt5_5: ssCalls(16) } }) });
    const archive = buildArchive([cheapShort, spiraler], {});
    expect(archive.size).toBe(2); // different d1 bins → two niches survive
  });

  it('betterInBin: higher finalScore wins (lengthPenalty IS respected via finalScore)', () => {
    // The plain dominates() blind spot: a marginally-cheaper-but-longer prompt.
    // In-bin we compare finalScore, which already folds in lengthPenalty.
    const longerCheaper = mkCandidate({ id: 'LONG', detail: {}, finalScore: 0.28, costUsd: 0.18, taskScore: 1.0 });
    const shorterDearer = mkCandidate({ id: 'SHORT', detail: {}, finalScore: 0.31, costUsd: 0.20, taskScore: 1.0 });
    // SHORT has higher finalScore (its lengthPenalty edge beats LONG's tiny cost edge).
    expect(betterInBin(shorterDearer, longerCheaper)).toBe(true);
    expect(betterInBin(longerCheaper, shorterDearer)).toBe(false);
  });

  it('betterInBin: accuracy floor blocks a "cheap because it gave up" challenger', () => {
    const accurate = mkCandidate({ id: 'ACC', detail: {}, finalScore: 0.30, taskScore: 1.0 });
    const gaveUp = mkCandidate({ id: 'GAVE_UP', detail: {}, finalScore: 0.45, taskScore: 0.80 }); // cheaper but −0.2 accuracy
    expect(betterInBin(gaveUp, accurate)).toBe(false); // accuracy regression > slack → blocked
  });

  it('betterInBin: empty bin (no incumbent) always admits', () => {
    expect(betterInBin(mkCandidate({ id: 'X', detail: {} }), null)).toBe(true);
  });

  it('betterInBin: exact finalScore tie breaks deterministically on id (never "newer wins")', () => {
    const a = mkCandidate({ id: 'aaa', detail: {}, finalScore: 0.3, taskScore: 1 });
    const b = mkCandidate({ id: 'bbb', detail: {}, finalScore: 0.3, taskScore: 1 });
    expect(betterInBin(a, b)).toBe(true);  // 'aaa' < 'bbb'
    expect(betterInBin(b, a)).toBe(false);
  });
});

// ─── 4. archive admission (drop-in shape parity) ─────────────────────────────

describe('attemptArchiveAdmission — own-bin displacement + colonisation', () => {
  const bin2 = () => mkDetail({ p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) } });   // d1 bin 0
  const bin16 = () => mkDetail({ p1: { sonnet: ssCalls(16), gpt5_5: ssCalls(16) } }); // d1 bin 4

  it('colonises an EMPTY bin unconditionally (QD novelty value)', () => {
    const front = [mkCandidate({ id: 'A', detail: bin2(), finalScore: 0.30 })];
    const colonist = mkCandidate({ id: 'B', detail: bin16(), finalScore: 0.10 }); // worse finalScore but NEW niche
    const res = attemptArchiveAdmission({ candidate: colonist, front, isNearDuplicate });
    expect(res.admitted).toBe(true);
    expect(res.evicted).toEqual([]);
    expect(res.newFront.map((c) => c.id).sort()).toEqual(['A', 'B']);
  });

  it('displaces the in-bin elite ONLY on a finalScore win; evicts the loser', () => {
    const front = [mkCandidate({ id: 'INC', detail: bin2(), finalScore: 0.25 })];
    const challenger = mkCandidate({ id: 'CHAL', detail: bin2(), finalScore: 0.31 });
    const res = attemptArchiveAdmission({ candidate: challenger, front, isNearDuplicate });
    expect(res.admitted).toBe(true);
    expect(res.evicted).toEqual(['INC']);
    expect(res.incumbent).toBe('INC');
    expect(res.newFront.map((c) => c.id)).toEqual(['CHAL']);
  });

  it('rejects a challenger that LOSES its own bin (lower finalScore)', () => {
    const front = [mkCandidate({ id: 'INC', detail: bin2(), finalScore: 0.31 })];
    const weak = mkCandidate({ id: 'WEAK', detail: bin2(), finalScore: 0.20 });
    const res = attemptArchiveAdmission({ candidate: weak, front, isNearDuplicate });
    expect(res.admitted).toBe(false);
    expect(res.reason).toBe('dominated');
    expect(res.incumbent).toBe('INC');
    expect(res.newFront.map((c) => c.id)).toEqual(['INC']); // unchanged
  });

  it('rejects an exact-hash dup and a whitespace near-duplicate (anti-clone parity)', () => {
    const inc = mkCandidate({ id: 'INC', detail: bin2(), finalScore: 0.31, prompt: 'use ss-search first', hash: '0xsame' });
    const exactDup = mkCandidate({ id: 'DUP', detail: bin2(), finalScore: 0.99, hash: '0xsame' });
    const wsDup = mkCandidate({ id: 'WS', detail: bin2(), finalScore: 0.99, prompt: 'use   ss-search\n\nfirst', hash: '0xother' });
    expect(attemptArchiveAdmission({ candidate: exactDup, front: [inc], isNearDuplicate }).reason).toBe('dominated');
    expect(attemptArchiveAdmission({ candidate: wsDup, front: [inc], isNearDuplicate }).reason).toBe('near-duplicate');
  });

  it('returns the SAME result shape as attemptParetoAdmission (drop-in for the loop)', () => {
    const front = [mkCandidate({ id: 'A', detail: bin2(), finalScore: 0.30, scores: { p1: 0.9 } })];
    const cand = mkCandidate({ id: 'B', detail: bin16(), finalScore: 0.10, scores: { p1: 0.9 } });
    const me = attemptArchiveAdmission({ candidate: cand, front, isNearDuplicate });
    const pareto = attemptParetoAdmission({ candidate: cand, front });
    expect(Object.keys(me).sort()).toEqual(Object.keys(pareto).sort());
  });

  it('respects the frontSize safety cap by evicting the weakest elite', () => {
    // 2 occupied bins at frontSize=2; colonise a 3rd → must trim back to 2.
    const front = [
      mkCandidate({ id: 'A', detail: bin2(), finalScore: 0.30 }),
      mkCandidate({ id: 'B', detail: bin16(), finalScore: 0.05 }), // weakest
    ];
    const mid = () => mkDetail({ p1: { sonnet: ssCalls(7), gpt5_5: ssCalls(7) } }); // d1 bin 2 — a 3rd niche
    const colonist = mkCandidate({ id: 'C', detail: mid(), finalScore: 0.20 });
    const res = attemptArchiveAdmission({ candidate: colonist, front, isNearDuplicate, frontSize: 2 });
    expect(res.admitted).toBe(true);
    expect(res.newFront.length).toBe(2);
    expect(res.evicted).toContain('B'); // weakest elite trimmed, not the colonist
    expect(res.newFront.map((c) => c.id)).toContain('C');
  });
});

// ─── 5. uniform parent selection (the champion-bias fix) ─────────────────────

describe('selectParentMapElites — uniform across occupied bins, deterministic', () => {
  // A dominant champion (high finalScore) in one bin + two cheap distinct
  // behaviors in other bins. finalScore-weighted selectParent would over-pick the
  // champion; uniform map-elites must give each of the 3 bins ~1/3 share.
  const front = [
    mkCandidate({ id: 'CHAMP', detail: mkDetail({ p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) } }), finalScore: 0.90 }),
    mkCandidate({ id: 'MID', detail: mkDetail({ p1: { sonnet: ssCalls(7), gpt5_5: ssCalls(7) } }), finalScore: 0.10 }),
    mkCandidate({ id: 'SPIRAL', detail: mkDetail({ p1: { sonnet: ssCalls(16), gpt5_5: ssCalls(16) } }), finalScore: 0.05 }),
  ];

  it('samples each occupied bin with roughly equal frequency (NOT finalScore-weighted)', () => {
    const counts = {};
    for (let s = 0; s < 600; s++) {
      const p = selectParentMapElites({ front, rng: roundRng(s, 1), stratumById: {} });
      counts[p.id] = (counts[p.id] || 0) + 1;
    }
    // Each bin ≈ 200/600 ≈ 0.33; champion must NOT dominate (it would at ~0.86
    // under finalScore weighting). Generous band for sampling noise.
    expect(counts.CHAMP).toBeGreaterThan(120);
    expect(counts.CHAMP).toBeLessThan(280);
    expect(counts.MID).toBeGreaterThan(120);
    expect(counts.SPIRAL).toBeGreaterThan(120);
  });

  it('is deterministic for a fixed rng', () => {
    const a = selectParentMapElites({ front, rng: roundRng(42, 1), stratumById: {} });
    const b = selectParentMapElites({ front, rng: roundRng(42, 1), stratumById: {} });
    expect(a.id).toBe(b.id);
  });

  it('single occupied bin returns that bin elite; empty front throws', () => {
    const one = [mkCandidate({ id: 'ONLY', detail: mkDetail({ p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) } }) })];
    expect(selectParentMapElites({ front: one, rng: roundRng(1, 1) }).id).toBe('ONLY');
    expect(() => selectParentMapElites({ front: [], rng: roundRng(1, 1) })).toThrow(RangeError);
  });

  it('noveltyBias > 0 still deterministic + favours the isolated bin', () => {
    // Two clustered bins (coords near each other) + one far-away isolated bin.
    const clustered1 = mkCandidate({ id: 'C1', detail: mkDetail({ p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) } }) });
    const clustered2 = mkCandidate({ id: 'C2', detail: mkDetail({ p1: { sonnet: ssCalls(4), gpt5_5: ssCalls(4) } }) });
    const isolated = mkCandidate({ id: 'ISO', detail: mkDetail({ p1: { sonnet: ssCalls(16), gpt5_5: ssCalls(16) } }) });
    const f = [clustered1, clustered2, isolated];
    const cfg = { ...DEFAULTS.mapElites, noveltyBias: 4 };
    const counts = {};
    for (let s = 0; s < 600; s++) {
      const p = selectParentMapElites({ front: f, rng: roundRng(s, 7), stratumById: {}, config: cfg });
      counts[p.id] = (counts[p.id] || 0) + 1;
    }
    // ISO is the most descriptor-isolated bin → gets the largest share under bias.
    expect(counts.ISO).toBeGreaterThan(counts.C1);
    expect(counts.ISO).toBeGreaterThan(counts.C2);
  });
});

// ─── 6. archive stats + island/reset helpers ─────────────────────────────────

describe('archiveStats / migrateElites / shouldResetArchive', () => {
  it('archiveStats reports occupied bins + QD-score (sum of elite finalScores)', () => {
    const front = [
      mkCandidate({ id: 'A', detail: mkDetail({ p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) } }), finalScore: 0.3 }),
      mkCandidate({ id: 'B', detail: mkDetail({ p1: { sonnet: ssCalls(16), gpt5_5: ssCalls(16) } }), finalScore: 0.2 }),
    ];
    const st = archiveStats(buildArchive(front, {}));
    expect(st.occupiedBins).toBe(2);
    expect(st.qdScore).toBeCloseTo(0.5, 9);
    expect(st.bestFinalScore).toBeCloseTo(0.3, 9);
  });

  it('migrateElites only lands a migrant that wins/colonises a destination bin', () => {
    const dest = [mkCandidate({ id: 'D', detail: mkDetail({ p1: { sonnet: ssCalls(2), gpt5_5: ssCalls(2) } }), finalScore: 0.30 })];
    const src = [mkCandidate({ id: 'S', detail: mkDetail({ p1: { sonnet: ssCalls(16), gpt5_5: ssCalls(16) } }), finalScore: 0.10 })];
    const merged = migrateElites({ srcFront: src, destFront: dest, isNearDuplicate, fraction: 1 });
    expect(merged.map((c) => c.id).sort()).toEqual(['D', 'S']); // S colonised a new niche
  });

  it('shouldResetArchive fires only when coverage stalls AND QD-score is flat', () => {
    const stalled = Array.from({ length: 5 }, () => ({ occupiedBins: 3, qdScore: 0.9 }));
    expect(shouldResetArchive(stalled, { stallRounds: 5, qdDelta: 0.01 })).toBe(true);
    const growingCoverage = [{ occupiedBins: 3, qdScore: 0.9 }, { occupiedBins: 4, qdScore: 0.9 }, { occupiedBins: 4, qdScore: 0.9 }, { occupiedBins: 4, qdScore: 0.9 }, { occupiedBins: 4, qdScore: 0.9 }];
    expect(shouldResetArchive(growingCoverage, { stallRounds: 5, qdDelta: 0.01 })).toBe(false);
    const improvingQd = Array.from({ length: 5 }, (_, i) => ({ occupiedBins: 3, qdScore: 0.9 + i * 0.05 }));
    expect(shouldResetArchive(improvingQd, { stallRounds: 5, qdDelta: 0.01 })).toBe(false);
    expect(shouldResetArchive([{ occupiedBins: 3, qdScore: 0.9 }], { stallRounds: 5 })).toBe(false); // too short
  });
});

// ─── 7. front-collapse demonstration (the headline failure mode) ─────────────

describe('saturated-accuracy: pareto collapses, map-elites does not', () => {
  it('pareto dominance collapses a saturated front toward the cheapest; map-elites keeps niches', () => {
    // All members: identical perfect per-probe scores (saturated). Costs differ;
    // behaviors (call counts) differ. The plain front's non-dominated set under
    // (accuracy-tie + cheapest) collapses; the archive keeps one elite per niche.
    const sat = (id, calls, cost) => mkCandidate({
      id,
      detail: mkDetail({ p1: { sonnet: ssCalls(calls), gpt5_5: ssCalls(calls) } }),
      finalScore: 0.4 - cost,    // cheaper → higher finalScore
      taskScore: 1.0,
      costUsd: cost,
      scores: { p1: 1.0, p2: 1.0 },
    });
    const front = [sat('A', 2, 0.18), sat('B', 7, 0.20), sat('C', 16, 0.22)];

    // Pareto: A (cheapest, accuracy-tied) dominates B and C → non-dominated = {A}.
    const ndPareto = front.filter((c) => !front.some((o) => o !== c
      && o.scores && c.scores
      && Object.keys(c.scores).every((p) => o.scores[p] >= c.scores[p])
      && o.costUsd <= c.costUsd
      && (o.costUsd < c.costUsd || Object.keys(c.scores).some((p) => o.scores[p] > c.scores[p]))));
    expect(ndPareto.map((c) => c.id)).toEqual(['A']); // collapsed to a singleton

    // Map-elites: A, B, C land in three distinct d1 (call-count) bins → all survive.
    const archive = buildArchive(front, {});
    expect(archive.size).toBe(3);
  });
});

// ─── 8. OPT-IN: default path byte-identical + map-elites resume == fresh ─────

describe('opt-in safety: default unchanged, map-elites resume == fresh', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), 'p7-me-')); });
  afterEach(() => { if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

  function pathsFor(dir) {
    return {
      trajectory: path.join(dir, 'gepa-trajectory.jsonl'),
      promptBank: path.join(dir, 'prompt-bank.jsonl'),
      paretoCurrent: path.join(dir, 'pareto-current.json'),
    };
  }
  function makeProbe(i, stratum) {
    return { id: `p${i}`, repo: 'r', language: 'js', stratum: stratum ?? 'literal-lookup', difficulty: 'easy', query: `q${i}`, expectedFiles: [], expectedSymbols: [], expectedFacts: [], expectedNoMatch: stratum === 'no-match', max_turns: 10 };
  }
  function variants(n) {
    const base = ['Use [[ss-search]].', 'Use [[ss-search]] then [[ss-read]].', 'Prefer [[ss-find]] for files.'];
    return Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, prompt: base[i % base.length] + ` variant ${i + 1}` }));
  }
  // Per-probe trade-off stub (mirrors the gepa resume test): each lineage
  // specialises a distinct probe so the front is genuinely multi-member, and
  // call counts vary by lineage so behavioral bins differ.
  function tradeoffEvaluate() {
    return async ({ promptText, probe }) => {
      const lin = Number((promptText.match(/variant (\d+)/) || [])[1] || 1);
      const probeNum = Number(String(probe.id).replace(/\D/g, '')) || 1;
      const favored = ((lin - 1) % 3) + 1;
      const score = probeNum === favored ? 0.9 : 0.55 + Math.min(0.04, promptText.length / 50000);
      const calls = 2 + ((lin + probeNum) % 5); // 2..6 calls → spreads d1 bins
      return {
        score, toolCalls: calls, finalAnswerEmitted: true, usedReadOrGrep: true,
        trajectory: { toolCalls: ssCalls(calls), answer: 'a' }, wallMs: 1,
      };
    };
  }
  const mutatingEcho = makeDryRunCallModel;

  it('DEFAULT runGepa front === explicit selectionMode:"pareto" front (byte-identical)', async () => {
    const devProbes = [makeProbe(1), makeProbe(2), makeProbe(3)];
    const common = {
      variants: variants(3), devProbes, evaluateCandidate: tradeoffEvaluate(), callModel: mutatingEcho(),
      seed: 42, patience: 99, screenProbeCount: 2, verbose: false,
    };
    const dDir = mkdtempSync(path.join(tmpdir(), 'p7-def-'));
    const pDir = mkdtempSync(path.join(tmpdir(), 'p7-par-'));
    const def = await runGepa({ ...common, runId: 'def', maxRounds: 3, paths: pathsFor(dDir) });
    const par = await runGepa({ ...common, runId: 'par', maxRounds: 3, selectionMode: 'pareto', paths: pathsFor(pDir) });
    const sig = (r) => r.front.map((f) => `${f.hash}:${f.finalScore.toFixed(6)}`).sort();
    expect(sig(def)).toEqual(sig(par));
    expect(def.convergence.map((x) => x.toFixed(6))).toEqual(par.convergence.map((x) => x.toFixed(6)));
    rmSync(dDir, { recursive: true, force: true });
    rmSync(pDir, { recursive: true, force: true });
  });

  it('map-elites: a resumed run reaches the SAME front as a fresh uninterrupted run', async () => {
    const devProbes = [makeProbe(1, 'no-match'), makeProbe(2), makeProbe(3, 'no-match')];
    const common = {
      variants: variants(3), devProbes, evaluateCandidate: tradeoffEvaluate(), callModel: mutatingEcho(),
      seed: 42, patience: 99, screenProbeCount: 2, selectionMode: 'map-elites', verbose: false,
    };
    const freshDir = mkdtempSync(path.join(tmpdir(), 'p7-mef-'));
    const fresh = await runGepa({ ...common, runId: 'mef', maxRounds: 4, paths: pathsFor(freshDir) });

    const resumeDir = mkdtempSync(path.join(tmpdir(), 'p7-mer-'));
    await runGepa({ ...common, runId: 'mer', maxRounds: 2, paths: pathsFor(resumeDir) });
    const resumed = await runGepa({ ...common, runId: 'mer', maxRounds: 4, resume: true, paths: pathsFor(resumeDir) });

    const sig = (r) => r.front.map((f) => `${f.hash}:${f.finalScore.toFixed(6)}`).sort();
    expect(sig(resumed)).toEqual(sig(fresh));
    expect(resumed.rounds).toBe(fresh.rounds);
    expect(resumed.convergence.map((x) => x.toFixed(6))).toEqual(fresh.convergence.map((x) => x.toFixed(6)));
    rmSync(freshDir, { recursive: true, force: true });
    rmSync(resumeDir, { recursive: true, force: true });
  });

  it('map-elites logs occupied_bins QD telemetry; pareto path does NOT (no log leakage)', async () => {
    const devProbes = [makeProbe(1, 'no-match'), makeProbe(2)];
    const logsME = [];
    const logsPar = [];
    const common = {
      variants: variants(2), devProbes, evaluateCandidate: tradeoffEvaluate(), callModel: mutatingEcho(),
      seed: 42, patience: 99, screenProbeCount: 2, verbose: false,
    };
    await runGepa({ ...common, runId: 'meL', maxRounds: 1, selectionMode: 'map-elites', paths: pathsFor(mkdtempSync(path.join(tmpdir(), 'p7-mel-'))), log: (m) => logsME.push(m) });
    await runGepa({ ...common, runId: 'paL', maxRounds: 1, selectionMode: 'pareto', paths: pathsFor(mkdtempSync(path.join(tmpdir(), 'p7-pal-'))), log: (m) => logsPar.push(m) });
    expect(logsME.some((m) => m.includes('map-elites: occupied_bins'))).toBe(true);
    expect(logsPar.some((m) => m.includes('map-elites'))).toBe(false);
  });

  it('runGepa rejects an unknown selectionMode (the money safety gate)', async () => {
    await expect(runGepa({
      runId: 'bad', variants: variants(1), devProbes: [makeProbe(1)],
      evaluateCandidate: tradeoffEvaluate(), callModel: mutatingEcho(),
      selectionMode: 'quality-diversity-typo', maxRounds: 1, paths: pathsFor(tmp), verbose: false,
    })).rejects.toThrow(/selectionMode must be/);
  });
});
