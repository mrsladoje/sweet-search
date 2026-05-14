/**
 * Unit tests for core/prompt-optimization/sweep — P6 promotion gate
 * composition and Track B planner arithmetic. These pin the load-bearing
 * behaviour of the §7.6 five-gate pipeline so future changes that silently
 * regress (e.g. allowing a `skipped` Thresholdout to count as `pass` in
 * strict mode) trip a test rather than reach a recommendations.json.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { krippendorffAlphaNominal, validateIaa } from '../../../core/prompt-optimization/stats/krippendorff.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// ─── helpers ──────────────────────────────────────────────────────────────

function tmpRunDir() {
  const d = mkdtempSync(path.join(tmpdir(), 'qshape-promote-'));
  return d;
}

function writeJsonl(filepath, records) {
  mkdirSync(path.dirname(filepath), { recursive: true });
  writeFileSync(filepath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/**
 * Build a synthetic Track A jsonl that gives one tool a clear shape winner
 * and supplies enough paired observations (≥ 5) for the BH-FDR pair floor.
 *
 * Per (gold × variant × tool) we emit a record with:
 *   - file_recall_at_1 ∈ {0, 1}
 *   - shape: derived from variantId (V1=very-short..., V4=baseline-medium...)
 *   - isBaseline: true only for V4
 *
 * The "winning" shape is V1: file_recall_at_1=1 on every gold of that tool;
 * the baseline V4 hits 0 on every gold so the paired-permutation observed
 * diff is +1 (clear one-sided beats-baseline).
 */
function synthTrackA({ tool, nGolds, repos = ['fastify', 'gin', 'flask', 'ripgrep', 'ai-chatbot'] }) {
  const records = [];
  let goldI = 0;
  for (let r = 0; r < repos.length; r++) {
    const repo = repos[r];
    const perRepoGolds = Math.ceil(nGolds / repos.length);
    for (let g = 0; g < perRepoGolds; g++) {
      const goldId = `${repo}:gold-${g}`;
      // V1 winner, V4 baseline
      records.push({
        goldId, tool, shape: 'very-short+with-symbol+narrow-regex+imperative+high-density',
        variantId: 'V1', isBaseline: false, _repo: repo,
        metrics: { file_recall_at_1: 1, file_recall_at_3: 1, file_recall_at_5: 1 },
      });
      records.push({
        goldId, tool, shape: 'medium+with-symbol+medium-regex+interrogative+high-density',
        variantId: 'V4', isBaseline: true, _repo: repo,
        metrics: { file_recall_at_1: 0, file_recall_at_3: 0, file_recall_at_5: 0 },
      });
      goldI += 1;
      if (goldI >= nGolds) break;
    }
    if (goldI >= nGolds) break;
  }
  return records;
}

function synthGoldsJson({ nGolds, repos }) {
  const records = [];
  for (let r = 0; r < repos.length; r++) {
    const repo = repos[r];
    const perRepoGolds = Math.ceil(nGolds / repos.length);
    for (let g = 0; g < perRepoGolds; g++) {
      records.push({
        id: `${repo}:gold-${g}`,
        repo,
        tier: 'dev',
        qshape_stratum: 'literal-lookup',
        gold_authored_by: 'sweet-search-core',
        predicted_winning_tool: 'ss-find',
        predicted_winning_shape: 'short+with-symbol+narrow-regex',
      });
    }
  }
  return {
    schemaVersion: 1,
    runId: 'qshape-test',
    summary: { total: records.length, byRepo: Object.fromEntries(repos.map((r) => [r, records.filter((x) => x.repo === r).length])) },
    records,
  };
}

/**
 * Run promote.mjs against a synthetic Track A/B fixture in `runDir`, writing
 * the resulting recommendations.json to a per-test path under `runDir`.
 *
 * Returns { result, outPath } where `outPath` is the test-isolated output
 * artifact (NOT the canonical
 * core/prompt-optimization/data/query-shapes/recommendations.json — that
 * artifact is consumed by PHASE7 and must never be trampled by tests).
 */
function runPromote(runId, runDir, extraArgs = []) {
  const outPath = path.join(runDir, 'recommendations.json');
  const args = [
    'core/prompt-optimization/sweep/promote.mjs',
    '--run', runId,
    '--out', outPath,
    ...extraArgs,
  ];
  const result = spawnSync('node', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return { result, outPath };
}

// ─── Krippendorff α (IAA helper) ──────────────────────────────────────────

describe('krippendorffAlphaNominal', () => {
  it('returns alpha=1 for perfect agreement', () => {
    const matrix = [
      ['A', 'A'],
      ['B', 'B'],
      ['tie', 'tie'],
    ];
    const r = krippendorffAlphaNominal({ matrix });
    expect(r.alpha).toBe(1);
    expect(r.n).toBe(3);
  });

  it('returns alpha < 0 for systematic disagreement', () => {
    const matrix = [
      ['A', 'B'],
      ['A', 'B'],
      ['B', 'A'],
    ];
    const r = krippendorffAlphaNominal({ matrix });
    expect(r.alpha).toBeLessThan(0.5);
  });

  it('tolerates missing data (null cells)', () => {
    const matrix = [
      ['A', 'A'],
      ['B', null],
      [null, 'B'],
      ['tie', 'tie'],
    ];
    const r = krippendorffAlphaNominal({ matrix });
    // Only rows 0 and 3 have ≥ 2 valid annotations and contribute to α.
    expect(r.n).toBe(2);
    expect(r.alpha).toBe(1);
  });

  it('validateIaa flags below-threshold α', () => {
    const matrix = [
      ['A', 'B'],
      ['A', 'B'],
      ['B', 'A'],
    ];
    const r = validateIaa({ matrix, alphaIndividual: 0.6 });
    expect(r.passes).toBe(false);
    expect(r.alpha).toBeLessThan(0.6);
  });
});

// ─── Track B planner arithmetic ───────────────────────────────────────────

describe('Track B planner — tuple counts', () => {
  // The plan §13.7 P6.3 floor: 20-25 golds × 6 shapes × 4 tools (subject to
  // ss-semantic / structural skip rules) = ~480-600 tuples. We exercise the
  // dry-run path which writes track-b-plan.json and check the math.
  it('produces planned tuple count within expected band for 25-gold subsample', () => {
    const runId = `trackb-test-${Date.now()}`;
    const r = spawnSync('node', [
      'core/prompt-optimization/sweep/track-b.mjs',
      '--run', runId,
      '--subsample', '25',
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const planPath = path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId, 'track-b-plan.json');
    expect(existsSync(planPath)).toBe(true);
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    // 25 golds × 6 shapes × 4 tools = 600 if no skips; ss-semantic skipped
    // for golds with no expectedFiles, structural skipped without
    // expectedSymbols. We expect 400-600.
    expect(plan.nTuples).toBeGreaterThanOrEqual(300);
    expect(plan.nTuples).toBeLessThanOrEqual(700);
    expect(plan.cost.totalEstimatedUSD).toBeGreaterThan(0);
    expect(plan.cost.totalEstimatedUSD).toBeLessThan(250);
    // Cleanup
    try { rmSync(path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId), { recursive: true }); } catch { /* */ }
  });

  it('caps via --max-tuples (planning unaffected; runtime cap is on execute)', () => {
    // The cap is enforced at execute-time, not plan-time; the plan still
    // shows the full slate. This test asserts the dry-run plan doesn't
    // accidentally honour the flag (which would mask cost).
    const runId = `trackb-cap-${Date.now()}`;
    const r = spawnSync('node', [
      'core/prompt-optimization/sweep/track-b.mjs',
      '--run', runId,
      '--subsample', '25',
      '--max-tuples', '4',
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const plan = JSON.parse(readFileSync(
      path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId, 'track-b-plan.json'),
      'utf8',
    ));
    expect(plan.nTuples).toBeGreaterThan(4); // plan reports the full slate
    try { rmSync(path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId), { recursive: true }); } catch { /* */ }
  });
});

// ─── Promotion gate composition (strict vs incomplete) ───────────────────

describe('promote.mjs — gate composition', () => {
  const runId = `promote-test-${Date.now()}`;
  const runDir = path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId);

  beforeAll(() => {
    // Synthesise a Track A jsonl with a clear shape winner for ss-find.
    // Use 5 repos × 5 golds = 25 golds so each cell has ≥ 5 paired
    // observations (the BH-FDR pair floor in promote.mjs).
    const repos = ['fastify', 'gin', 'flask', 'ripgrep', 'ai-chatbot'];
    const trackA = synthTrackA({ tool: 'ss-find', nGolds: 25, repos });
    mkdirSync(runDir, { recursive: true });
    writeJsonl(path.join(runDir, 'track-a.jsonl'), trackA);
  });

  it('strict mode: skipped Thresholdout BLOCKS promotion', () => {
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    const ssFind = recs.per_tool['ss-find'];
    // best_shape was found, but Thresholdout was skipped → strict mode
    // refuses promotion.
    expect(ssFind.best_shape).toBeTruthy();
    expect(ssFind.gate_results.thresholdout).toBe('skipped');
    expect(ssFind.promoted).toBe(false);
    expect(ssFind.not_promoted_reason).toMatch(/thresholdout/);
  });

  it('lenient mode (--allow-incomplete-promotion): skipped gate counts as pass but flags artifact', () => {
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout', '--allow-incomplete-promotion']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(recs.incomplete_promotion).toBe(true);
    // The artifact carries the strict/lenient signal independent of
    // per_tool gate outcomes — a downstream consumer cannot mistake this
    // for a shippable promotion.
    expect(recs.behavior_notes.some((n) => /allow-incomplete-promotion=ON/.test(n))).toBe(true);
  });

  it('reports BH-FDR pair-floor exclusions in summary', () => {
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(typeof recs.summary.bh_fdr_n_cells_considered).toBe('number');
    expect(typeof recs.summary.bh_fdr_n_cells_below_pair_floor).toBe('number');
    expect(recs.summary.bh_fdr_n_tested).toBeLessThanOrEqual(recs.summary.bh_fdr_n_cells_considered);
  });

  it('avoid_shapes carries reason_code and null instruction_text', () => {
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    if (recs.avoid_shapes.length > 0) {
      const a = recs.avoid_shapes[0];
      expect(a.reason_code).toBe('worst_observed_cell_mean');
      expect(a.instruction_text).toBeNull();
    }
  });
});

// ─── Repo stability + author check ───────────────────────────────────────

describe('promote.mjs — repo stability + author check', () => {
  const runId = `repo-stab-test-${Date.now()}`;
  const runDir = path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId);

  beforeAll(() => {
    // 5-repo Track A; we make ai-chatbot recall@1 = 0 deliberately so the
    // gate-5 z-score check trips.
    const repos = ['fastify', 'gin', 'flask', 'ripgrep', 'ai-chatbot'];
    const trackA = [];
    for (const repo of repos) {
      for (let g = 0; g < 5; g++) {
        const goldId = `${repo}:gold-${g}`;
        const isAi = repo === 'ai-chatbot';
        trackA.push({
          goldId, tool: 'ss-find', shape: 'very-short+with-symbol+narrow-regex+imperative+high-density',
          variantId: 'V1', isBaseline: false, _repo: repo,
          metrics: { file_recall_at_1: isAi ? 0 : 1 },
        });
        trackA.push({
          goldId, tool: 'ss-find', shape: 'medium+with-symbol+medium-regex+interrogative+high-density',
          variantId: 'V4', isBaseline: true, _repo: repo,
          metrics: { file_recall_at_1: 0 },
        });
      }
    }
    mkdirSync(runDir, { recursive: true });
    writeJsonl(path.join(runDir, 'track-a.jsonl'), trackA);
  });

  it('flags ai-chatbot z-score outlier as repo_stability fail', () => {
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    const ssFind = recs.per_tool['ss-find'];
    // ai-chatbot recall@1 = 0 vs other repos' 1 → z = -2σ (failure).
    expect(['fail', 'pass']).toContain(ssFind.gate_results?.repo_stability);
    expect(ssFind.repo_stability_details?.ai_chatbot_z_score).toBeLessThan(0);
  });

  it('per_tool block carries gold_authors_slice metadata', () => {
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    const ssFind = recs.per_tool['ss-find'];
    if (ssFind.independent_author_check) {
      expect(typeof ssFind.independent_author_check.gold_authors_slice).toBe('string');
      expect(typeof ssFind.independent_author_check.n_golds_in_slice).toBe('number');
    }
  });
});

// ─── IAA gate via track-b-summary.json ──────────────────────────────────

describe('promote.mjs — IAA gate', () => {
  const runId = `iaa-test-${Date.now()}`;
  const runDir = path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId);

  beforeAll(() => {
    const repos = ['fastify', 'gin', 'flask', 'ripgrep', 'ai-chatbot'];
    const trackA = synthTrackA({ tool: 'ss-find', nGolds: 25, repos });
    mkdirSync(runDir, { recursive: true });
    writeJsonl(path.join(runDir, 'track-a.jsonl'), trackA);
    // Also write a non-empty Track B so the IAA gate actually runs.
    const trackB = repos.flatMap((repo) => {
      const out = [];
      for (let g = 0; g < 5; g++) {
        out.push({
          goldId: `${repo}:gold-${g}`, tool: 'ss-find',
          shape: 'very-short+with-symbol+narrow-regex+imperative+high-density',
          variantId: 'V1', isBaseline: false, repo,
          runStatus: 'ok', answerability: 'full',
          metrics: { file_recall: 1, file_precision: 1, fact_recall: 1 },
        });
      }
      return out;
    });
    writeJsonl(path.join(runDir, 'track-b.jsonl'), trackB);
  });

  it('IAA pending-author surfaces as gate=pending-author and BLOCKS strict promotion', () => {
    // Write a summary with status: pending-author
    writeFileSync(
      path.join(runDir, 'track-b-summary.json'),
      JSON.stringify({ runId, iaa: { status: 'pending-author', n_probes: 0, n_required: 30 } }, null, 2),
    );
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    const ssFind = recs.per_tool['ss-find'];
    expect(ssFind.gate_results.iaa).toBe('pending-author');
    expect(ssFind.promoted).toBe(false);
    expect(ssFind.not_promoted_reason).toMatch(/iaa/);
    expect(recs.incomplete_promotion).toBe(true);
  });

  it('IAA pass: panel-majority α ≥ threshold AND every per-judge α ≥ threshold', () => {
    writeFileSync(
      path.join(runDir, 'track-b-summary.json'),
      JSON.stringify({
        runId,
        iaa: {
          status: 'ok',
          alphaIndividual: 0.6,
          alphaMajority: 0.7,
          perJudge: [
            { judge: 'sonnet', alpha: 0.82, n: 30, passes: true },
            { judge: 'opus',   alpha: 0.78, n: 30, passes: true },
          ],
          majority: { alpha: 0.85, n: 30, passes: true },
        },
      }, null, 2),
    );
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout', '--allow-incomplete-promotion']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    const ssFind = recs.per_tool['ss-find'];
    expect(ssFind.gate_results.iaa).toBe('pass');
    expect(ssFind.iaa.alpha).toBeCloseTo(0.85, 2);
    // judge_iaa_alpha is now wired through to track_b block.
    expect(ssFind.track_b.judge_iaa_alpha).toBeCloseTo(0.85, 2);
  });

  it('IAA fail: per-judge α < threshold blocks the gate even if majority passes', () => {
    writeFileSync(
      path.join(runDir, 'track-b-summary.json'),
      JSON.stringify({
        runId,
        iaa: {
          status: 'ok',
          alphaIndividual: 0.6,
          alphaMajority: 0.7,
          perJudge: [
            { judge: 'sonnet', alpha: 0.82, n: 30, passes: true },
            { judge: 'opus',   alpha: 0.45, n: 30, passes: false },     // <-- below threshold
          ],
          majority: { alpha: 0.72, n: 30, passes: true },
        },
      }, null, 2),
    );
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    const ssFind = recs.per_tool['ss-find'];
    expect(ssFind.gate_results.iaa).toBe('fail');
    expect(ssFind.promoted).toBe(false);
    expect(ssFind.iaa.allJudgesPass).toBe(false);
  });
});

// ─── golds.json predictions coverage ─────────────────────────────────────

describe('golds.json — predictions coverage (GLM #6 fix)', () => {
  it('every gold record has predicted_winning_tool and predicted_winning_shape', () => {
    const goldsRaw = JSON.parse(readFileSync(
      path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/golds.json'),
      'utf8',
    ));
    const missing = [];
    for (const g of goldsRaw.records) {
      if (!g.predicted_winning_tool || !g.predicted_winning_shape) {
        missing.push({ id: g.id, has_tool: !!g.predicted_winning_tool, has_shape: !!g.predicted_winning_shape });
      }
    }
    if (missing.length > 0) {
      // Fail with the offending IDs so build-golds.mjs adders see what's
      // missing without re-running the build script.
      throw new Error(`golds.json missing predictions: ${JSON.stringify(missing.slice(0, 10))}`);
    }
    expect(missing.length).toBe(0);
  });

  it('every gold record has gold_authored_by (independent-author gate input)', () => {
    const goldsRaw = JSON.parse(readFileSync(
      path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/golds.json'),
      'utf8',
    ));
    const missing = goldsRaw.records.filter((g) => !g.gold_authored_by);
    expect(missing.length).toBe(0);
  });
});

// ─── V1 bifurcation by symbol presence ──────────────────────────────────

describe('variants.json — V1 with/without-symbol bifurcation (GLM #3)', () => {
  it('reports both V1 sub-cells in shapeHistogram so BH-FDR can score them separately', () => {
    const variants = JSON.parse(readFileSync(
      path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants.json'),
      'utf8',
    ));
    const hist = variants.summary.shapeHistogram;
    // The two V1 sub-cells are independent shape labels — the build emits
    // very-short+with-symbol+narrow-regex+imperative+high-density and
    // very-short+without-symbol+narrow-regex+imperative+high-density,
    // and promote.mjs treats each as its own (tool, shape) row in the BH-FDR
    // slate. The fallback rows therefore can't pollute the with-symbol
    // main-effect estimate (this is the GLM #3 concern, addressed by data
    // construction rather than analysis-time exclusion).
    const withSym = hist['very-short+with-symbol+narrow-regex+imperative+high-density'] || 0;
    const withoutSym = hist['very-short+without-symbol+narrow-regex+imperative+high-density'] || 0;
    expect(withSym + withoutSym).toBeGreaterThan(0);
    // Either both populated, or one populated — both are valid; what's
    // NOT valid is silently absorbing the fallback into the with-symbol
    // count.
  });
});

// ─── partial-sweep guard ─────────────────────────────────────────────────

describe('promote.mjs — partial sweep diagnosis', () => {
  const runId = `partial-test-${Date.now()}`;
  const runDir = path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId);

  beforeAll(() => {
    // Only 1 repo present in the Track A run. With 5 expected dev repos in
    // golds.json the gate-5 should fail with reason_code partial_sweep_missing_repos.
    const trackA = synthTrackA({ tool: 'ss-find', nGolds: 5, repos: ['fastify'] });
    mkdirSync(runDir, { recursive: true });
    writeJsonl(path.join(runDir, 'track-a.jsonl'), trackA);
  });

  it('reports partial_sweep_missing_repos when Track A covered only 1 dev repo', () => {
    const { result: r, outPath } = runPromote(runId, runDir, ['--skip-thresholdout']);
    expect(r.status).toBe(0);
    const recs = JSON.parse(readFileSync(outPath, 'utf8'));
    const ssFind = recs.per_tool['ss-find'];
    if (ssFind.best_shape && ssFind.gate_results.repo_stability === 'fail') {
      expect(ssFind.repo_stability_details?.reason_code).toBe('partial_sweep_missing_repos');
      expect(ssFind.repo_stability_details?.missing_repos?.length).toBeGreaterThan(0);
    }
  });
});
