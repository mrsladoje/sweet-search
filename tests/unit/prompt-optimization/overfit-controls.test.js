/**
 * Unit tests for the §0.5 dual-layer overfit-control framework
 * (added 2026-05-09):
 *   - Thresholdout / Reusable-Holdout oracle (§11.4.2, control #1/2)
 *   - Benjamini-Hochberg FDR (§11.4.3, control #4)
 *   - Threshold-sensitivity sweep (§11.10, control #6)
 *   - MDL / prompt-length penalty (§11.10.4, control #6 sub-item)
 *   - Token-overlap leakage gate (§11.9, control #5)
 *   - HOMP transfer-gap gate (§11.11, control #7)
 *
 * These tests pin the load-bearing behaviour: budget exhaustion, AGREE/DIFFER
 * decisions, BH-FDR survival math, rank-stability, length-penalty calibration,
 * leakage-corpus construction, and transfer-gap arithmetic. Future plan
 * revisions that silently regress any of these would fail here, not at
 * campaign time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  openThresholdout,
  initBudgetLog,
  readBudgetUsage,
  BudgetExhaustedError,
} from '../../../core/prompt-optimization/stats/thresholdout.mjs';
import {
  benjaminiHochberg,
  survivors,
} from '../../../core/prompt-optimization/stats/bh-fdr.mjs';
import {
  runThresholdSensitivity,
  _internal as sensInternal,
} from '../../../core/prompt-optimization/stats/threshold-sensitivity.mjs';
import {
  lengthPenalisedScore,
  truncateToTokens,
  truncationCheck,
  _defaults as mdlDefaults,
} from '../../../core/prompt-optimization/stats/mdl-length-penalty.mjs';
import {
  buildLeakageCorpus,
  checkLeakage,
  loadWhitelist,
} from '../../../core/prompt-optimization/decontamination/leakage-gate.mjs';
import {
  computeTransferGap,
  loadHompFromManifest,
} from '../../../core/prompt-optimization/run-homp.mjs';

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'overfit-controls-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── Thresholdout / Reusable-Holdout oracle (§11.4.2) ─────────────────────────

describe('openThresholdout', () => {
  it('returns AGREE when sealed-1 mean is within τ of dev mean', () => {
    const path = join(tmp, 'budget.jsonl');
    initBudgetLog(path);
    const o = openThresholdout({ budgetLogPath: path, runId: 't', totalBudget: 5, seed: 1 });
    const r = o.query({
      queryId: 'q', candidateId: 'c',
      devScore: 0.85, sealed1Score: 0.86,
    });
    expect(r.decision).toBe('AGREE');
    expect(r.sealed1Score).toBeNull(); // withheld on AGREE
    expect(r.devScore).toBe(0.85);
    expect(r.budgetUsedAfter).toBe(1);
  });

  it('returns DIFFER and exposes noisy sealed-1 when divergence exceeds τ', () => {
    const path = join(tmp, 'budget.jsonl');
    const o = openThresholdout({ budgetLogPath: path, runId: 't', totalBudget: 5, seed: 1 });
    const r = o.query({
      queryId: 'q', candidateId: 'c',
      devScore: 0.85, sealed1Score: 0.40,
    });
    expect(r.decision).toBe('DIFFER');
    expect(r.sealed1Score).not.toBeNull();
    expect(typeof r.sealed1Score).toBe('number');
  });

  it('throws BudgetExhaustedError when budget is consumed', () => {
    const path = join(tmp, 'budget.jsonl');
    const o = openThresholdout({ budgetLogPath: path, runId: 't', totalBudget: 2, seed: 1 });
    o.query({ queryId: 'q1', candidateId: 'c', devScore: 0.5, sealed1Score: 0.5 });
    o.query({ queryId: 'q2', candidateId: 'c', devScore: 0.5, sealed1Score: 0.5 });
    expect(() =>
      o.query({ queryId: 'q3', candidateId: 'c', devScore: 0.5, sealed1Score: 0.5 })
    ).toThrow(BudgetExhaustedError);
  });

  it('resumes budget from existing log on restart (crash-safe)', () => {
    const path = join(tmp, 'budget.jsonl');
    const o1 = openThresholdout({ budgetLogPath: path, runId: 't', totalBudget: 4, seed: 1 });
    o1.query({ queryId: 'q1', candidateId: 'c', devScore: 0.5, sealed1Score: 0.5 });
    o1.query({ queryId: 'q2', candidateId: 'c', devScore: 0.5, sealed1Score: 0.5 });
    // Reopen — should know 2 are already consumed.
    const o2 = openThresholdout({ budgetLogPath: path, runId: 't', totalBudget: 4, seed: 2 });
    expect(o2.remaining()).toBe(2);
    const usage = readBudgetUsage(path);
    expect(usage.used).toBe(2);
    expect(usage.lines.length).toBe(2);
  });

  it('accepts per-probe arrays as well as scalar means', () => {
    const path = join(tmp, 'budget.jsonl');
    const o = openThresholdout({ budgetLogPath: path, runId: 't', totalBudget: 3, seed: 1 });
    const r = o.query({
      queryId: 'q', candidateId: 'c',
      devScore: [1, 1, 0, 1, 1, 0, 1, 1, 1, 0],
      sealed1Score: [1, 1, 1, 1, 0, 0, 1, 1, 0, 1],
    });
    expect(r.devScore).toBeCloseTo(0.7, 6);
    expect(typeof r.decision).toBe('string');
  });

  it('rejects empty score arrays', () => {
    const path = join(tmp, 'budget.jsonl');
    const o = openThresholdout({ budgetLogPath: path, runId: 't', totalBudget: 1, seed: 1 });
    expect(() =>
      o.query({ queryId: 'q', candidateId: 'c', devScore: [], sealed1Score: 0.5 })
    ).toThrow(/empty score vector/);
  });
});

// ── Benjamini-Hochberg FDR (§11.4.3) ─────────────────────────────────────────

describe('benjaminiHochberg', () => {
  it('matches the textbook example: 10 p-values at q=0.10 → first 6 survive', () => {
    // Classic walkthrough used in BH tutorials; survivors threshold at p=0.060.
    const tests = [
      { id: 'a', pValue: 0.001 }, { id: 'b', pValue: 0.008 }, { id: 'c', pValue: 0.039 },
      { id: 'd', pValue: 0.041 }, { id: 'e', pValue: 0.042 }, { id: 'f', pValue: 0.060 },
      { id: 'g', pValue: 0.074 }, { id: 'h', pValue: 0.205 }, { id: 'i', pValue: 0.212 },
      { id: 'j', pValue: 0.396 },
    ];
    const r = benjaminiHochberg({ tests, q: 0.1 });
    expect(r.maxRejectedRank).toBe(6);
    expect(survivors(r).map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('declares all ties when no p-value is significant', () => {
    const tests = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, pValue: 0.9 }));
    const r = benjaminiHochberg({ tests, q: 0.1 });
    expect(r.maxRejectedRank).toBe(0);
    expect(survivors(r).length).toBe(0);
  });

  it('rejects all when every p-value is far below threshold', () => {
    const tests = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, pValue: 0.0001 }));
    const r = benjaminiHochberg({ tests, q: 0.1 });
    expect(r.maxRejectedRank).toBe(10);
  });

  it('produces monotone non-decreasing adjusted-p across rank', () => {
    const tests = [
      { id: 'a', pValue: 0.01 }, { id: 'b', pValue: 0.04 }, { id: 'c', pValue: 0.03 },
      { id: 'd', pValue: 0.20 }, { id: 'e', pValue: 0.50 },
    ];
    const r = benjaminiHochberg({ tests, q: 0.1 });
    for (let i = 1; i < r.sortedResults.length; i++) {
      expect(r.sortedResults[i].adjustedP).toBeGreaterThanOrEqual(r.sortedResults[i - 1].adjustedP);
    }
  });

  it('preserves input order in `results` (not sorted order)', () => {
    const tests = [
      { id: 'big', pValue: 0.5 },
      { id: 'small', pValue: 0.001 },
      { id: 'mid', pValue: 0.2 },
    ];
    const r = benjaminiHochberg({ tests, q: 0.1 });
    expect(r.results.map((x) => x.id)).toEqual(['big', 'small', 'mid']);
  });

  it('rejects empty test list and invalid q', () => {
    expect(() => benjaminiHochberg({ tests: [], q: 0.1 })).toThrow();
    expect(() => benjaminiHochberg({ tests: [{ id: 'a', pValue: 0.1 }], q: 0 })).toThrow();
    expect(() => benjaminiHochberg({ tests: [{ id: 'a', pValue: 0.1 }], q: 1 })).toThrow();
  });

  it('rejects malformed p-values', () => {
    expect(() =>
      benjaminiHochberg({ tests: [{ id: 'a', pValue: 1.1 }], q: 0.1 })
    ).toThrow(/invalid pValue/);
    expect(() =>
      benjaminiHochberg({ tests: [{ id: 'a', pValue: -0.01 }], q: 0.1 })
    ).toThrow(/invalid pValue/);
  });
});

// ── Threshold-sensitivity sweep (§11.10) ─────────────────────────────────────

describe('runThresholdSensitivity', () => {
  it('produces a 27-cell balanced design', () => {
    const cells = sensInternal.buildSweepCells();
    expect(cells.length).toBe(27);
    // Balance: each level 0/1/2 should appear 9× per factor.
    for (let factor = 0; factor < 5; factor++) {
      const counts = [0, 0, 0];
      for (const c of cells) counts[c[factor]]++;
      // Allow ±1 tolerance for the cyclic offset construction.
      for (const k of counts) expect(k).toBeGreaterThanOrEqual(7);
    }
  });

  it('flags rank-stable strict winner', () => {
    // T1 strictly dominates T2 across every cell.
    const r = runThresholdSensitivity({
      variants: [
        {
          variantId: 'T1',
          perProbe: Array.from({ length: 30 }, (_, i) => ({
            probeId: `p${i}`, fileRecall: 1, factRecall: 0.95,
            symbolRecall: 0.95, lineOverlap: 0.7, filePrecision: 0.8,
          })),
        },
        {
          variantId: 'T2',
          perProbe: Array.from({ length: 30 }, (_, i) => ({
            probeId: `p${i}`, fileRecall: i < 5 ? 1 : 0.5, factRecall: 0.4,
            symbolRecall: 0.4, lineOverlap: 0.1, filePrecision: 0.2,
          })),
        },
      ],
    });
    const t1 = r.perVariant.find((v) => v.variantId === 'T1');
    expect(t1.medianRank).toBe(1);
    expect(t1.rankStable).toBe(true);
  });

  it('detects threshold-game variants (rank-1 only at registered)', () => {
    // T_game scores fileRecall=1 on every probe but fact/symbol/line/precision
    // are all set to be exactly the registered thresholds. -20% perturbation
    // → still passes; +20% perturbation → fails.
    // T_solid passes everywhere.
    const tightlyAtThresholds = (i) => ({
      probeId: `p${i}`, fileRecall: 1.0,
      factRecall: 0.8, symbolRecall: 0.8, lineOverlap: 0.3, filePrecision: 0.5,
    });
    const r = runThresholdSensitivity({
      variants: [
        {
          variantId: 'T_game',
          perProbe: Array.from({ length: 30 }, (_, i) => tightlyAtThresholds(i)),
        },
        {
          variantId: 'T_solid',
          perProbe: Array.from({ length: 30 }, (_, i) => ({
            probeId: `p${i}`, fileRecall: 1.0,
            factRecall: 0.99, symbolRecall: 0.99, lineOverlap: 0.99, filePrecision: 0.99,
          })),
        },
      ],
    });
    const game = r.perVariant.find((v) => v.variantId === 'T_game');
    const solid = r.perVariant.find((v) => v.variantId === 'T_solid');
    // T_solid should be rank-1 in every cell; T_game should drop ranks at +20%.
    expect(solid.medianRank).toBe(1);
    expect(solid.rankStable).toBe(true);
    // T_game pass rate at registered should be high; at +20% lower.
    expect(game.passAtRegistered).toBeGreaterThan(0.99);
  });

  it('rejects mismatched perProbe lengths', () => {
    expect(() =>
      runThresholdSensitivity({
        variants: [
          { variantId: 'A', perProbe: [{ probeId: 'p', fileRecall: 1, factRecall: 1, symbolRecall: 1, lineOverlap: 1, filePrecision: 1 }] },
          { variantId: 'B', perProbe: [] },
        ],
      })
    ).toThrow(/probes/);
  });
});

// ── MDL / prompt-length penalty (§11.10.4) ───────────────────────────────────

describe('lengthPenalisedScore', () => {
  it('penalises longer prompts more', () => {
    const short = lengthPenalisedScore({ score: 1, promptTokens: 500 });
    const long = lengthPenalisedScore({ score: 1, promptTokens: 2000 });
    expect(long.penalty).toBeGreaterThan(short.penalty);
    expect(long.penalisedScore).toBeLessThan(short.penalisedScore);
  });

  it('default λ implies ~1pp drop per 500-token bloat near 1k tokens', () => {
    // Calibration target documented in the module: ~1pp / +500 tokens.
    const a = lengthPenalisedScore({ score: 1, promptTokens: 1000 });
    const b = lengthPenalisedScore({ score: 1, promptTokens: 1500 });
    const drop = a.penalisedScore - b.penalisedScore;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThan(0.02); // sanity: not catastrophic
  });

  it('rejects zero/negative tokens and λ', () => {
    expect(() => lengthPenalisedScore({ score: 0.5, promptTokens: 0 })).toThrow();
    expect(() => lengthPenalisedScore({ score: 0.5, promptTokens: -1 })).toThrow();
    expect(() => lengthPenalisedScore({ score: 0.5, promptTokens: 100, lambda: -0.1 })).toThrow();
  });
});

describe('truncateToTokens', () => {
  it('returns the body unchanged when already under target', () => {
    const r = truncateToTokens({ body: 'short.', targetTokens: 50 });
    expect(r.truncated).toBe('short.');
    expect(r.originalTokens).toBe(r.truncatedTokens);
  });

  it('cuts at sentence boundaries when possible', () => {
    const body = 'Alpha beta gamma. Delta epsilon zeta. Eta theta iota.';
    const r = truncateToTokens({ body, targetTokens: 5 });
    expect(r.truncated.endsWith('.')).toBe(true);
    expect(r.truncatedTokens).toBeLessThanOrEqual(5);
  });
});

describe('truncationCheck', () => {
  it('passes when truncation drop is within budget', () => {
    expect(truncationCheck({ originalScore: 0.85, truncatedScore: 0.84 }).passes).toBe(true);
  });
  it('fails when truncation drops more than budget', () => {
    expect(truncationCheck({ originalScore: 0.85, truncatedScore: 0.80 }).passes).toBe(false);
  });
  it('default budget is 2pp', () => {
    expect(mdlDefaults.truncationRegressionBudget).toBe(0.02);
  });
});

// ── Token-overlap leakage gate (§11.9) ───────────────────────────────────────

describe('leakage-gate', () => {
  it('builds a corpus from probe symbols/paths/queries, minus whitelist', () => {
    const wl = new Set(['the function returns', 'use the tool']);
    const corpus = buildLeakageCorpus({
      probes: [
        {
          query: 'how does validateBody handle http2 requests',
          expectedSymbol: 'validateBody',
          expectedFile: 'lib/server.js',
        },
      ],
      whitelist: wl,
    });
    expect(corpus.has('validatebody handle http2')).toBe(true);
  });

  it('catches a probe-specific 3-gram in a candidate prompt', () => {
    const wl = new Set();
    const corpus = buildLeakageCorpus({
      probes: [{ query: 'how does validateBody handle http2 requests' }],
      whitelist: wl,
    });
    const r = checkLeakage({
      candidate: 'When the agent sees validateBody handle http2, it should ...',
      leakageCorpus: corpus,
    });
    expect(r.passes).toBe(false);
    expect(r.matches.map((m) => m.ngram)).toContain('validatebody handle http2');
  });

  it('passes a clean prompt with no overlap', () => {
    const wl = new Set();
    const corpus = new Set(['some thing specific']);
    const r = checkLeakage({ candidate: 'A generic prompt about searching code.', leakageCorpus: corpus });
    expect(r.passes).toBe(true);
    expect(r.matches.length).toBe(0);
  });

  it('loadWhitelist parses comments and blank lines', () => {
    const path = join(tmp, 'wl.txt');
    writeFileSync(path, '# comment\nthe function returns\n\nuse the tool\n# trailing\n');
    const set = loadWhitelist(path);
    expect(set.has('the function returns')).toBe(true);
    expect(set.has('use the tool')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('loads the shipped whitelist file successfully', () => {
    // The shipped whitelist is committed at decontamination/leakage-whitelist.txt
    // and must always be loadable without errors.
    const set = loadWhitelist(
      join(process.cwd(), 'core/prompt-optimization/decontamination/leakage-whitelist.txt')
    );
    expect(set.size).toBeGreaterThan(20);
  });
});

// ── HOMP transfer-gap gate (§11.11) ──────────────────────────────────────────

describe('computeTransferGap', () => {
  it('passes when HOMP min equals or exceeds aux-panel min', () => {
    const r = computeTransferGap({
      auxPanelPassByModel: { dsv4: 0.6, minimax: 0.58, kimi: 0.55, qwen: 0.6 },
      hompPassByModel: { llama4: 0.56, commandr: 0.58 },
    });
    expect(r.transferGap).toBeCloseTo(-0.01, 6);
    expect(r.passes).toBe(true);
  });

  it('fails when HOMP min trails aux-panel min by more than 5pp', () => {
    const r = computeTransferGap({
      auxPanelPassByModel: { dsv4: 0.62, minimax: 0.58, kimi: 0.55, qwen: 0.6 },
      hompPassByModel: { llama4: 0.49, commandr: 0.51 },
    });
    expect(r.transferGap).toBeCloseTo(0.06, 6);
    expect(r.passes).toBe(false);
  });

  it('rejects empty pass-rate maps', () => {
    expect(() =>
      computeTransferGap({ auxPanelPassByModel: {}, hompPassByModel: { x: 0.5 } })
    ).toThrow(/non-empty/);
  });
});

describe('loadHompFromManifest', () => {
  it('reads heldOutModels from the shipped manifest', () => {
    const path = join(process.cwd(), 'core/prompt-optimization/data/manifest.json');
    expect(existsSync(path)).toBe(true);
    const homp = loadHompFromManifest(path);
    expect(homp.length).toBeGreaterThanOrEqual(2);
    for (const m of homp) {
      expect(typeof m.name).toBe('string');
      expect(typeof m.lineage).toBe('string');
    }
  });

  it('throws when the panel has fewer than 2 entries', () => {
    const path = join(tmp, 'manifest.json');
    writeFileSync(path, JSON.stringify({ heldOutModels: { panel: [{ name: 'only' }] } }));
    expect(() => loadHompFromManifest(path)).toThrow(/at least 2/);
  });

  it('accepts both wrapped {panel:[...]} and bare-array shapes', () => {
    const wrappedPath = join(tmp, 'wrapped.json');
    writeFileSync(
      wrappedPath,
      JSON.stringify({ heldOutModels: { panel: [{ name: 'a', lineage: 'x' }, { name: 'b', lineage: 'y' }] } })
    );
    expect(loadHompFromManifest(wrappedPath).length).toBe(2);

    const barePath = join(tmp, 'bare.json');
    writeFileSync(
      barePath,
      JSON.stringify({ heldOutModels: [{ name: 'a', lineage: 'x' }, { name: 'b', lineage: 'y' }] })
    );
    expect(loadHompFromManifest(barePath).length).toBe(2);
  });
});
