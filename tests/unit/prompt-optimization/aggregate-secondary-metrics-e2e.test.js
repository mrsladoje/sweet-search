/**
 * End-to-end integration: run both aggregators against the locked
 * phase6-redo JSONLs and verify (a) the new secondary_metrics block is
 * populated, and (b) the headline strategy cells are UNCHANGED relative to
 * the existing recommendations-v2*.json artifacts.
 *
 * Skipped if the locked AST-tester-probes repos are absent (CI without the
 * full corpus) — these tests need the chunk text to compute relaxed_def.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const TRACK_SS_SEARCH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/tracks/track-a-phase6-redo-v1.jsonl');
const TRACK_SS_FIND = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/tracks/track-a-phase6-redo-ss-find-v8.jsonl');
const RECS_SS_SEARCH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations-v2.json');
const RECS_SS_FIND = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations-v2-ss-find.json');
const REPOS_ROOT = path.join(REPO_ROOT, 'eval/ast-tester-probes/_repos/c');
const OVERRIDES = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/overrides-v1.json');

const reposPresent = fs.existsSync(REPOS_ROOT);
const tracksPresent = fs.existsSync(TRACK_SS_SEARCH) && fs.existsSync(TRACK_SS_FIND);
const maybeIt = (reposPresent && tracksPresent) ? it : it.skip;

function runAggregator(script, args) {
  return execFileSync('node', [path.join(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('aggregator e2e — secondary_metrics published, headline unchanged', () => {
  maybeIt('ss-search: republishes recommendations-v2.json with new secondaries; default=V7 unchanged', () => {
    const out = path.join(REPO_ROOT, 'tests/.tmp/recommendations-v2-test.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    runAggregator('core/prompt-optimization/scripts/aggregate-track-a.mjs', [
      '--run-id=phase6-redo-v1',
      '--primary-metric=symbol_recall',
      '--promotion-mode=global',
      `--overrides=${OVERRIDES}`,
      `--out=${out}`,
    ]);
    const old = JSON.parse(fs.readFileSync(RECS_SS_SEARCH, 'utf8'));
    const next = JSON.parse(fs.readFileSync(out, 'utf8'));

    // Headline is unchanged.
    expect(next.default.shape).toBe(old.default.shape);
    expect(next.default.shape).toBe('V7');
    expect(next.popular_weighted.shape).toBe(old.popular_weighted.shape);
    expect(Object.keys(next.family_overrides).sort()).toEqual(Object.keys(old.family_overrides).sort());
    for (const fam of Object.keys(old.family_overrides)) {
      expect(next.family_overrides[fam].shape).toBe(old.family_overrides[fam].shape);
    }

    // New secondary_metrics block exists with the expected shape.
    expect(next.secondary_metrics).toBeDefined();
    expect(next.secondary_metrics._note).toMatch(/cross-tool/);
    expect(next.secondary_metrics.global).toHaveProperty('strict_symbol_recall_at_1');
    expect(next.secondary_metrics.global).toHaveProperty('relaxed_def_recall_at_1');
    expect(next.secondary_metrics.global).toHaveProperty('file_recall_at_5');
    expect(next.secondary_metrics.by_family).toHaveProperty('OO-monolithic');
    expect(next.secondary_metrics.ranking_stability_check).toHaveProperty('strict_winner');
    expect(next.secondary_metrics.ranking_stability_check).toHaveProperty('relaxed_winner');
    expect(next.secondary_metrics.ranking_stability_check).toHaveProperty('recall_at_5_winner');

    // Per-strategy secondaries: trio attached.
    for (const key of ['strict_symbol_recall_at_1', 'relaxed_def_recall_at_1', 'file_recall_at_5']) {
      expect(next.default.secondary_metrics).toHaveProperty(key);
      expect(typeof next.default.secondary_metrics[key]).toBe('number');
      expect(next.popular_weighted.secondary_metrics).toHaveProperty(key);
      for (const fam of Object.keys(next.family_overrides)) {
        expect(next.family_overrides[fam].secondary_metrics).toHaveProperty(key);
      }
    }

    // Schema bump.
    expect(next.schemaVersion).toBe(5);
  }, 90_000);

  maybeIt('ss-find: republishes recommendations-v2-ss-find.json with new secondaries; simple_global cell unchanged', () => {
    const out = path.join(REPO_ROOT, 'tests/.tmp/recommendations-v2-ss-find-test.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    runAggregator('core/prompt-optimization/scripts/ss-find/aggregate-track-a-ss-find.mjs', [
      '--run-id=phase6-redo-ss-find-v8',
      `--out=${out}`,
    ]);
    const old = JSON.parse(fs.readFileSync(RECS_SS_FIND, 'utf8'));
    const next = JSON.parse(fs.readFileSync(out, 'utf8'));

    // Headline cells unchanged.
    const oldSG = old.strategies.simple_global;
    const newSG = next.strategies.simple_global;
    expect(`${newSG.rCell}|${newSG.qCell}`).toBe(`${oldSG.rCell}|${oldSG.qCell}`);

    const oldPW = old.strategies.popular_weighted_agentic;
    const newPW = next.strategies.popular_weighted_agentic;
    expect(`${newPW.rCell}|${newPW.qCell}`).toBe(`${oldPW.rCell}|${oldPW.qCell}`);

    const oldOver = old.strategies.family_conditioned.overrides;
    const newOver = next.strategies.family_conditioned.overrides;
    expect(Object.keys(newOver).sort()).toEqual(Object.keys(oldOver).sort());
    for (const fam of Object.keys(oldOver)) {
      expect(`${newOver[fam].rCell}|${newOver[fam].qCell}`).toBe(`${oldOver[fam].rCell}|${oldOver[fam].qCell}`);
    }

    // Top-level secondary_metrics block.
    expect(next.secondary_metrics).toBeDefined();
    expect(next.secondary_metrics.global).toHaveProperty('strict_symbol_recall_at_1');
    expect(next.secondary_metrics.global).toHaveProperty('relaxed_def_recall_at_1');
    expect(next.secondary_metrics.global).toHaveProperty('file_recall_at_5');
    expect(next.secondary_metrics.by_family).toHaveProperty('JS-mobile');

    // Per-strategy secondaries.
    for (const key of ['strict_symbol_recall_at_1', 'relaxed_def_recall_at_1', 'file_recall_at_5']) {
      expect(newSG.secondary_metrics).toHaveProperty(key);
      expect(newPW.secondary_metrics).toHaveProperty(key);
      for (const fam of Object.keys(newOver)) {
        expect(newOver[fam].secondary_metrics).toHaveProperty(key);
      }
    }

    // Schema bump.
    expect(next.schemaVersion).toBe(2);
  }, 90_000);
});
