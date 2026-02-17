import { describe, it, expect, beforeEach } from 'vitest';
import { RetrievalHarness } from '../eval/retrieval-harness.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('RetrievalHarness', () => {
  let harness;

  beforeEach(() => {
    harness = new RetrievalHarness({ k_values: [1, 5, 10, 20] });
  });

  // ─── recallAtK ─────────────────────────────────────────────────────────────

  describe('recallAtK', () => {
    it('returns 1.0 for perfect recall (relevant doc at position 1)', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['a'] },
        { retrieved: ['x', 'y', 'z'], relevant: ['x'] },
      ];
      expect(harness.recallAtK(results, 5)).toBe(1.0);
    });

    it('returns 0 when no relevant doc is in top-k', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['z'] },
        { retrieved: ['x', 'y', 'w'], relevant: ['q'] },
      ];
      expect(harness.recallAtK(results, 3)).toBe(0);
    });

    it('returns 0.5 for partial recall', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['a'] },
        { retrieved: ['x', 'y', 'w'], relevant: ['q'] },
      ];
      expect(harness.recallAtK(results, 3)).toBe(0.5);
    });

    it('respects k boundary', () => {
      const results = [
        { retrieved: ['a', 'b', 'c', 'd', 'e', 'target'], relevant: ['target'] },
      ];
      expect(harness.recallAtK(results, 3)).toBe(0);
      expect(harness.recallAtK(results, 6)).toBe(1.0);
    });

    it('returns 0 for empty results array', () => {
      expect(harness.recallAtK([], 5)).toBe(0);
    });

    it('handles multiple relevant docs per query', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['b', 'd'] },
      ];
      // 'b' is in top-3, so this query is a hit
      expect(harness.recallAtK(results, 3)).toBe(1.0);
    });
  });

  // ─── mrr ───────────────────────────────────────────────────────────────────

  describe('mrr', () => {
    it('returns 1.0 when relevant doc is first for all queries', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['a'] },
        { retrieved: ['x', 'y', 'z'], relevant: ['x'] },
      ];
      expect(harness.mrr(results)).toBe(1.0);
    });

    it('returns 0.5 when relevant doc is second position', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['b'] },
      ];
      expect(harness.mrr(results)).toBe(0.5);
    });

    it('returns 0 when relevant doc is not found', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['z'] },
      ];
      expect(harness.mrr(results)).toBe(0);
    });

    it('averages across queries correctly', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['a'] },  // RR = 1
        { retrieved: ['x', 'y', 'z'], relevant: ['y'] },  // RR = 1/2
      ];
      expect(harness.mrr(results)).toBe(0.75);
    });

    it('returns 0 for empty results array', () => {
      expect(harness.mrr([])).toBe(0);
    });

    it('uses first relevant doc found (not best rank)', () => {
      // Two relevant docs; MRR uses the first (highest-ranked) one found
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['b', 'c'] },
      ];
      // 'b' at rank 2 → RR = 1/2
      expect(harness.mrr(results)).toBe(0.5);
    });
  });

  // ─── ndcgAtK ───────────────────────────────────────────────────────────────

  describe('ndcgAtK', () => {
    it('returns 1.0 for perfect ranking (relevant at rank 1)', () => {
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['a'] },
      ];
      expect(harness.ndcgAtK(results, 3)).toBe(1.0);
    });

    it('returns < 1.0 for imperfect ranking', () => {
      const results = [
        { retrieved: ['b', 'a', 'c'], relevant: ['a'] },
      ];
      // Relevant at rank 2. DCG = 1/log2(3), IDCG = 1/log2(2) = 1.0
      const expected = (1 / Math.log2(3)) / (1 / Math.log2(2));
      expect(harness.ndcgAtK(results, 3)).toBeCloseTo(expected, 10);
    });

    it('returns 0 when no relevant docs are retrieved', () => {
      const results = [
        { retrieved: ['x', 'y', 'z'], relevant: ['a'] },
      ];
      expect(harness.ndcgAtK(results, 3)).toBe(0);
    });

    it('returns 0 for empty results array', () => {
      expect(harness.ndcgAtK([], 5)).toBe(0);
    });

    it('handles multiple relevant docs correctly', () => {
      // Perfect: both relevant in top 2
      const results = [
        { retrieved: ['a', 'b', 'c'], relevant: ['a', 'b'] },
      ];
      // DCG = 1/log2(2) + 1/log2(3), IDCG = same → NDCG = 1.0
      expect(harness.ndcgAtK(results, 3)).toBeCloseTo(1.0, 10);
    });

    it('handles reversed ranking with multiple relevant docs', () => {
      // Relevant docs at positions 2 and 3 instead of 1 and 2
      const results = [
        { retrieved: ['x', 'a', 'b'], relevant: ['a', 'b'] },
      ];
      const dcg = 1 / Math.log2(3) + 1 / Math.log2(4);
      const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);
      expect(harness.ndcgAtK(results, 3)).toBeCloseTo(dcg / idcg, 10);
    });
  });

  // ─── evaluate ──────────────────────────────────────────────────────────────

  describe('evaluate', () => {
    it('returns metrics for all configured k values', () => {
      const results = [
        { retrieved: ['a', 'b', 'c', 'd', 'e'], relevant: ['a'] },
      ];
      const metrics = harness.evaluate(results);

      expect(metrics).toHaveProperty('recall@1');
      expect(metrics).toHaveProperty('recall@5');
      expect(metrics).toHaveProperty('recall@10');
      expect(metrics).toHaveProperty('recall@20');
      expect(metrics).toHaveProperty('ndcg@1');
      expect(metrics).toHaveProperty('ndcg@5');
      expect(metrics).toHaveProperty('mrr');
      expect(metrics).toHaveProperty('totalQueries');
      expect(metrics).toHaveProperty('timestamp');
    });

    it('returns correct values for a known dataset', () => {
      const results = [
        { retrieved: ['a', 'b'], relevant: ['a'] },
        { retrieved: ['x', 'y'], relevant: ['y'] },
      ];
      const metrics = harness.evaluate(results);

      expect(metrics['recall@1']).toBe(0.5);    // only first query hits at rank 1
      expect(metrics['recall@5']).toBe(1.0);     // both hit within top 5
      expect(metrics.mrr).toBe(0.75);            // (1 + 0.5) / 2
      expect(metrics.totalQueries).toBe(2);
    });

    it('returns all zeros for empty input', () => {
      const metrics = harness.evaluate([]);
      expect(metrics.mrr).toBe(0);
      expect(metrics['recall@5']).toBe(0);
      expect(metrics['ndcg@10']).toBe(0);
      expect(metrics.totalQueries).toBe(0);
    });
  });

  // ─── compareToBaseline ─────────────────────────────────────────────────────

  describe('compareToBaseline', () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-test-'));
      harness = new RetrievalHarness({
        resultsDir: tmpDir,
        baselineFile: path.join(tmpDir, 'baseline.json'),
      });
    });

    it('returns hasBaseline=false when no baseline exists', async () => {
      const result = await harness.compareToBaseline({ 'recall@5': 0.8, mrr: 0.7 });
      expect(result.hasBaseline).toBe(false);
      expect(result.passed).toBe(true);
    });

    it('detects regression (FAIL) when delta exceeds threshold', async () => {
      await harness.saveBaseline({ 'recall@5': 0.8, 'recall@20': 0.9, mrr: 0.7 });

      const result = await harness.compareToBaseline({
        'recall@5': 0.7,   // -0.1, threshold is -0.02 → FAIL
        'recall@20': 0.89, // -0.01, within threshold → PASS
        mrr: 0.65,         // -0.05, threshold is -0.02 → FAIL
      });

      expect(result.hasBaseline).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.deltas['recall@5'].passed).toBe(false);
      expect(result.deltas['recall@5'].delta).toBeCloseTo(-0.1, 10);
      expect(result.deltas['recall@20'].passed).toBe(true);
      expect(result.deltas.mrr.passed).toBe(false);
    });

    it('passes when metrics improve', async () => {
      await harness.saveBaseline({ 'recall@5': 0.8, 'recall@20': 0.9, mrr: 0.7 });

      const result = await harness.compareToBaseline({
        'recall@5': 0.85,
        'recall@20': 0.95,
        mrr: 0.75,
      });

      expect(result.passed).toBe(true);
      expect(result.deltas['recall@5'].delta).toBeCloseTo(0.05, 10);
    });

    it('passes when metrics stay the same', async () => {
      await harness.saveBaseline({ 'recall@5': 0.8, 'recall@20': 0.9, mrr: 0.7 });

      const result = await harness.compareToBaseline({
        'recall@5': 0.8,
        'recall@20': 0.9,
        mrr: 0.7,
      });

      expect(result.passed).toBe(true);
    });

    it('passes with small regression within threshold', async () => {
      await harness.saveBaseline({ 'recall@5': 0.8, 'recall@20': 0.9, mrr: 0.7 });

      const result = await harness.compareToBaseline({
        'recall@5': 0.79,  // -0.01, within -0.02 threshold
        'recall@20': 0.89, // -0.01
        mrr: 0.69,         // -0.01
      });

      expect(result.passed).toBe(true);
    });
  });

  // ─── saveBaseline / saveResults ────────────────────────────────────────────

  describe('saveBaseline', () => {
    it('creates results directory and saves file', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-save-'));
      const nestedDir = path.join(tmpDir, 'nested', 'results');
      const h = new RetrievalHarness({
        resultsDir: nestedDir,
        baselineFile: path.join(nestedDir, 'baseline.json'),
      });

      const metrics = { 'recall@5': 0.8, mrr: 0.7 };
      await h.saveBaseline(metrics);

      const saved = JSON.parse(await fs.readFile(path.join(nestedDir, 'baseline.json'), 'utf-8'));
      expect(saved['recall@5']).toBe(0.8);
      expect(saved.mrr).toBe(0.7);
    });
  });

  describe('saveResults', () => {
    it('saves timestamped result file and returns path', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-results-'));
      const h = new RetrievalHarness({ resultsDir: tmpDir });

      const metrics = { 'recall@5': 0.9, mrr: 0.8 };
      const filePath = await h.saveResults(metrics, 'test-run');

      expect(filePath).toContain('eval_test-run_');
      expect(filePath).toMatch(/\.json$/);
      const saved = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(saved['recall@5']).toBe(0.9);
    });
  });

  // ─── formatReport ─────────────────────────────────────────────────────────

  describe('formatReport', () => {
    it('produces readable output with metrics', () => {
      const metrics = {
        'recall@1': 0.5, 'recall@5': 0.8, 'recall@10': 0.9, 'recall@20': 0.95,
        'ndcg@1': 0.5, 'ndcg@5': 0.7, 'ndcg@10': 0.8, 'ndcg@20': 0.85,
        mrr: 0.65,
        totalQueries: 100,
      };
      const comparison = { hasBaseline: false, deltas: {}, passed: true };

      const report = harness.formatReport(metrics, comparison);

      expect(report).toContain('Retrieval Evaluation Report');
      expect(report).toContain('Recall@5:  80.0%');
      expect(report).toContain('MRR:        65.0%');
      expect(report).toContain('Queries:    100');
      expect(report).toContain('No baseline found');
    });

    it('shows delta comparison with PASS/FAIL', () => {
      const metrics = {
        'recall@1': 0.5, 'recall@5': 0.75, 'recall@10': 0.9, 'recall@20': 0.95,
        'ndcg@1': 0.5, 'ndcg@5': 0.7, 'ndcg@10': 0.8, 'ndcg@20': 0.85,
        mrr: 0.6,
        totalQueries: 50,
      };
      const comparison = {
        hasBaseline: true,
        deltas: {
          'recall@5': { baseline: 0.8, current: 0.75, delta: -0.05, threshold: -0.02, passed: false },
          mrr: { baseline: 0.5, current: 0.6, delta: 0.1, threshold: -0.02, passed: true },
        },
        passed: false,
      };

      const report = harness.formatReport(metrics, comparison);

      expect(report).toContain('Delta vs Baseline');
      expect(report).toContain('recall@5: -5.0pp [FAIL]');
      expect(report).toContain('mrr: +10.0pp [PASS]');
      expect(report).toContain('FAIL - regression detected');
    });

    it('shows Overall: PASS when all deltas pass', () => {
      const metrics = {
        'recall@1': 0.5, 'recall@5': 0.8, 'recall@10': 0.9, 'recall@20': 0.95,
        'ndcg@1': 0.5, 'ndcg@5': 0.7, 'ndcg@10': 0.8, 'ndcg@20': 0.85,
        mrr: 0.7,
        totalQueries: 50,
      };
      const comparison = {
        hasBaseline: true,
        deltas: {
          mrr: { baseline: 0.65, current: 0.7, delta: 0.05, threshold: -0.02, passed: true },
        },
        passed: true,
      };

      const report = harness.formatReport(metrics, comparison);
      expect(report).toContain('Overall: PASS');
      expect(report).not.toContain('regression');
    });
  });

  // ─── importBenchmarkResult ─────────────────────────────────────────────────

  describe('importBenchmarkResult', () => {
    it('normalizes existing benchmark result format', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-import-'));
      const resultFile = path.join(tmpDir, 'result.json');
      await fs.writeFile(resultFile, JSON.stringify({
        timestamp: '2026-02-16T00:00:00.000Z',
        queryCount: 200,
        aggregate: {
          recall_at_1: 0.5,
          recall_at_5: 0.8,
          recall_at_10: 0.9,
          recall_at_20: 0.95,
          mrr_at_10: 0.7,
          ndcg_at_10: 0.75,
        },
      }));

      const metrics = await harness.importBenchmarkResult(resultFile);

      expect(metrics['recall@5']).toBe(0.8);
      expect(metrics['recall@20']).toBe(0.95);
      expect(metrics.mrr).toBe(0.7);
      expect(metrics['ndcg@10']).toBe(0.75);
      expect(metrics.totalQueries).toBe(200);
      expect(metrics.source).toBe(resultFile);
    });
  });

  // ─── Custom configuration ──────────────────────────────────────────────────

  describe('custom configuration', () => {
    it('uses custom k_values', () => {
      const h = new RetrievalHarness({ k_values: [3, 7] });
      const results = [
        { retrieved: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], relevant: ['d'] },
      ];
      const metrics = h.evaluate(results);
      expect(metrics).toHaveProperty('recall@3');
      expect(metrics).toHaveProperty('recall@7');
      expect(metrics['recall@3']).toBe(0); // 'd' at position 4
      expect(metrics['recall@7']).toBe(1.0);
    });

    it('uses custom delta thresholds', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-threshold-'));
      const h = new RetrievalHarness({
        resultsDir: tmpDir,
        baselineFile: path.join(tmpDir, 'baseline.json'),
        deltaThresholds: { mrr: -0.10 },  // very lenient
      });

      await h.saveBaseline({ mrr: 0.8 });
      const result = await h.compareToBaseline({ mrr: 0.72 }); // -0.08, within -0.10
      expect(result.passed).toBe(true);
    });
  });
});
