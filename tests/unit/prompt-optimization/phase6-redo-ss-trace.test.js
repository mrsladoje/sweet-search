/**
 * Contract tests for the ss-trace failure-analysis program artifacts:
 *   - probes.json shape + counts
 *   - recommendations-v2-ss-trace.json: 3 strategies, secondary metrics,
 *     failure-mode taxonomy, ranking-stability check
 *
 * Skips when the per-repo code-graph.db files aren't present (CI without
 * the full ast-tester-probes corpus), mirroring the
 * aggregate-secondary-metrics-e2e.test.js pattern.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const PROBES_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-trace/probes.json');
const RECS_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations-v2-ss-trace.json');
const REPOS_ROOT = path.join(REPO_ROOT, 'eval/ast-tester-probes/_repos/c');

const probesPresent = fs.existsSync(PROBES_PATH);
const recsPresent = fs.existsSync(RECS_PATH);
const reposPresent = fs.existsSync(REPOS_ROOT);
const maybe = (probesPresent && recsPresent && reposPresent) ? it : it.skip;

describe('ss-trace probes.json contract', () => {
  maybe('has the expected schema + split + relationship counts', () => {
    const data = JSON.parse(fs.readFileSync(PROBES_PATH, 'utf8'));
    expect(data.schemaVersion).toBe(1);
    expect(data.tool).toBe('ss-trace');
    expect(data.splitSource).toMatch(/manifest\.json/);
    expect(data.splitMeta.seed).toBe(42);
    expect(Array.isArray(data.probes)).toBe(true);
    expect(data.probes.length).toBeGreaterThanOrEqual(100);
    expect(data.totals.callers).toBeGreaterThanOrEqual(50);
    expect(data.totals.callees).toBeGreaterThanOrEqual(20);
    expect(data.totals.impact).toBeGreaterThanOrEqual(50);
    expect(data.splits.dev + data.splits.heldout).toBe(data.totals.total);
  });

  maybe('probes carry required fields including expectedFull for grading rubric robustness', () => {
    const data = JSON.parse(fs.readFileSync(PROBES_PATH, 'utf8'));
    const p = data.probes.find(x => x.relationshipType === 'callers');
    expect(p).toBeTruthy();
    expect(p.probeId).toMatch(/^callers-/);
    expect(Array.isArray(p.expected)).toBe(true);
    expect(Array.isArray(p.expectedFull)).toBe(true);
    expect(p.expectedFull[0]).toHaveProperty('symbol');
    expect(p.expectedFull[0]).toHaveProperty('file');
    expect(p.symbol).toBeTruthy();
    expect(p.repoKey).toBeTruthy();
    expect(['dev', 'heldout']).toContain(p.split);
  });

  maybe('impact probes carry the 2-hop diagnostic field', () => {
    const data = JSON.parse(fs.readFileSync(PROBES_PATH, 'utf8'));
    const impacts = data.probes.filter(x => x.relationshipType === 'impact');
    expect(impacts.length).toBeGreaterThan(0);
    for (const p of impacts) {
      expect(Array.isArray(p.expected_2hop_diagnostic)).toBe(true);
    }
  });
});

describe('recommendations-v2-ss-trace.json contract', () => {
  maybe('has the three-strategy structure (mirror ss-find / ss-semantic)', () => {
    const r = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
    expect(r.tool).toBe('ss-trace');
    expect(r.primary_metric).toBe('recall_at_5');
    expect(r.strategies).toHaveProperty('simple_global');
    expect(r.strategies).toHaveProperty('family_conditioned');
    expect(r.strategies).toHaveProperty('popular_weighted_agentic');
  });

  maybe('simple_global.by_relationship_type covers callers, callees, impact', () => {
    const r = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
    const sg = r.strategies.simple_global;
    expect(sg.by_relationship_type).toHaveProperty('callers');
    expect(sg.by_relationship_type).toHaveProperty('callees');
    expect(sg.by_relationship_type).toHaveProperty('impact');
    for (const rel of ['callers', 'callees', 'impact']) {
      const v = sg.by_relationship_type[rel];
      expect(typeof v.strict_recall_at_5).toBe('number');
      expect(typeof v.f1_at_5).toBe('number');
      expect(typeof v.production_recall_at_5).toBe('number');
      expect(v.n).toBeGreaterThan(0);
    }
  });

  maybe('simple_global.options matches the canonical defaults', () => {
    const r = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
    expect(r.strategies.simple_global.options).toEqual({
      maxDepth: 3,
      queryHint: null,
      tokenBudget: null,
      k: 5,
    });
  });

  maybe('family_conditioned has 5 families and the overrides block is empty by design (one options config)', () => {
    const r = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
    const fc = r.strategies.family_conditioned;
    expect(fc.default).toBeTruthy();
    const families = Object.keys(fc.by_family_recall);
    expect(families).toContain('OO-monolithic');
    expect(families).toContain('JS-mobile');
    expect(families).toContain('Dynamic-scripting');
    // Overrides should not have per-family options entries — only the
    // explanatory _note — because no family-best Recall@5 differs from
    // default when only one options config has been measured.
    const overrideKeys = Object.keys(fc.overrides).filter(k => !k.startsWith('_'));
    expect(overrideKeys.length).toBe(0);
  });

  maybe('failure_analysis taxonomy matches Stage 4 findings + ablation status', () => {
    const r = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
    const fa = r.failure_analysis;
    expect(fa).toBeTruthy();
    expect(fa.fail_mode_taxonomy).toHaveProperty('ranker_test_demote');
    expect(fa.fail_mode_taxonomy).toHaveProperty('partial_extraction');
    expect(fa.fix_1_sql_substring_guard.applied).toBe(false);
    expect(fa.pagerank_status.applied).toBe(false);
    expect(fa.adaptive_depth_status.applied).toBe(false);
  });

  maybe('ranking_stability_check declares no argmax flip (one options config measured)', () => {
    const r = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
    expect(r.ranking_stability_check.flip).toBe(false);
  });

  maybe('cell_table_options has exactly one cell keyed by the canonical options JSON', () => {
    const r = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
    const keys = Object.keys(r.cell_table_options);
    expect(keys.length).toBe(1);
    const key = keys[0];
    const parsed = JSON.parse(key);
    expect(parsed.maxDepth).toBe(3);
  });

  maybe('production_recall_at_5 lifts callers + impact (rubric robustness signal)', () => {
    const r = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
    // Production-only re-grade drops test-path entries from BOTH the
    // expected denominator AND the per-row TP count. It can move in
    // either direction depending on whether predicted top-K entries
    // were test-path or production-path. On dev (105 probes), the
    // expected direction per Stage 4 deep-dive is:
    //   - callers: significant lift (test-callers dominate Stage 4 FAILs)
    //   - impact:  large lift (1-hop proxy mismatch + test-callers)
    //   - callees: ~flat or slight regression (almost no test entries
    //              in callee gold; small n + sample noise can drop it).
    const callers = r.strategies.simple_global.by_relationship_type.callers;
    const impact = r.strategies.simple_global.by_relationship_type.impact;
    expect(callers.production_recall_at_5).toBeGreaterThan(callers.strict_recall_at_5);
    expect(impact.production_recall_at_5).toBeGreaterThan(impact.strict_recall_at_5);
  });
});
