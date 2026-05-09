/**
 * sweep/ — Track A (deterministic) + Track B (agent-in-loop) query-shape
 * harnesses + the §7.6 four-gate promotion gate.
 *
 * Re-exported from the prompt-optimization barrel so callers can
 * `import { runQueryShapeSweep, ... } from 'core/prompt-optimization'`.
 *
 * The actual entrypoints in this directory are CLIs:
 *   - track-a.mjs        (driver; spawns track-a-worker.mjs per repo)
 *   - track-a-worker.mjs (per-repo subprocess; in-process tool calls)
 *   - track-b.mjs        (agent-in-loop scaffold; dry-runnable)
 *   - promote.mjs        (4-gate promotion → recommendations.json)
 *
 * The exported functions below are programmatic adapters that delegate to
 * the CLIs via spawn (single-process callers can skip and use the CLIs
 * directly).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Run Track A (deterministic per-tool shape sweep).
 *
 * Spawns the CLI driver as a child process so its per-repo isolation
 * (SWEET_SEARCH_PROJECT_ROOT) holds. Captures stdout/stderr; returns
 * exit code + paths to the output artifacts.
 *
 * @param {object} args
 * @param {string} args.runId
 * @param {string} [args.repo]      — filter to one repo
 * @param {string} [args.tool]      — filter to one tool
 * @param {boolean} [args.dryRun]
 * @returns {{ exitCode: number, outPath: string, summaryPath: string }}
 */
export function runTrackA({ runId, repo = null, tool = null, dryRun = false }) {
  if (!runId) throw new Error('runQueryShapeSweep: runId required');
  const argv = ['core/prompt-optimization/sweep/track-a.mjs', '--run', runId];
  if (repo) argv.push('--repo', repo);
  if (tool) argv.push('--tool', tool);
  if (dryRun) argv.push('--dry-run');
  const r = spawnSync('node', argv, { cwd: REPO_ROOT, stdio: 'inherit' });
  return {
    exitCode: r.status,
    outPath: path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId, 'track-a.jsonl'),
    summaryPath: path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId, 'track-a-summary.json'),
  };
}

/**
 * Plan / execute Track B (agent-in-loop sweep). Default is dry-run; pass
 * `confirmCostUsd` to execute. Track B drives the `shape-constrained` policy
 * in eval/agent-read-workflows/policies.js with a per-tuple shape-forcing
 * system prompt and runs PRP two-judge pairwise scoring against the V4
 * baseline.
 *
 * Sequencing rule: Track B is OFF by default; the caller MUST opt in with
 * `confirmCostUsd`. Track A only is the safe default for promotion-only
 * runs (`runShapePromotion` then handles the deterministic-only path).
 *
 * @param {object} args
 * @param {string} args.runId
 * @param {number|null} [args.confirmCostUsd] — ≥ estimate or run aborts
 * @param {number} [args.subsampleSize=25]
 * @param {number} [args.seed=42]
 * @param {boolean} [args.includeUv=false]   — include held-out uv golds
 * @param {number|null} [args.maxTuples]     — hard cap on tuple count
 * @param {string} [args.agentModel='sonnet']
 * @param {string} [args.judgeModel='sonnet']
 */
export function runTrackB({
  runId, confirmCostUsd = null, subsampleSize = 25, seed = 42,
  includeUv = false, maxTuples = null,
  agentModel = 'gemini-3-flash-preview', judgeModel = 'gemini-3-flash-preview',
}) {
  if (!runId) throw new Error('runTrackB: runId required');
  const argv = ['core/prompt-optimization/sweep/track-b.mjs', '--run', runId,
    '--subsample', String(subsampleSize), '--seed', String(seed),
    '--agent-model', agentModel, '--judge-model', judgeModel];
  if (includeUv) argv.push('--include-uv');
  if (maxTuples != null) argv.push('--max-tuples', String(maxTuples));
  if (confirmCostUsd != null) argv.push('--confirm-cost', String(confirmCostUsd));
  const r = spawnSync('node', argv, { cwd: REPO_ROOT, stdio: 'inherit' });
  return {
    exitCode: r.status,
    planPath: path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId, 'track-b-plan.json'),
    summaryPath: path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId, 'track-b-summary.json'),
    jsonlPath: path.join(REPO_ROOT, 'core/prompt-optimization/data/results', runId, 'track-b.jsonl'),
  };
}

/**
 * Run the §7.6 five-gate promotion: BH-FDR + Thresholdout + leakage-gate +
 * independent-author check + per-repo cross-shape stability; emit
 * recommendations.json.
 *
 * Strict by default: any gate marked `skipped` (Thresholdout) or `not_run`
 * (Track B) blocks `promoted: true`. Pass `allowIncompletePromotion: true`
 * for diagnostic runs (recommendations.json then carries an explicit
 * `incompletePromotion: true` flag and per-tool `not_promoted_reason`).
 */
export function runShapePromotion({
  runId, skipThresholdout = false,
  allowIncompletePromotion = false,
  independentAuthor = 'sweet-search-core-secondary',
}) {
  if (!runId) throw new Error('runShapePromotion: runId required');
  const argv = ['core/prompt-optimization/sweep/promote.mjs', '--run', runId,
    '--author', independentAuthor];
  if (skipThresholdout) argv.push('--skip-thresholdout');
  if (allowIncompletePromotion) argv.push('--allow-incomplete-promotion');
  const r = spawnSync('node', argv, { cwd: REPO_ROOT, stdio: 'inherit' });
  const outPath = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations.json');
  const recommendations = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, 'utf8'))
    : null;
  return { exitCode: r.status, outPath, recommendations };
}

/**
 * Convenience: orchestrate the full P6.2 → P6.4 pipeline. Mirrors the §13.5
 * runbook (Track A → Track B (gated) → promote).
 *
 * Track B remains opt-in: it runs only when `confirmTrackBCostUsd` is set
 * (>= the dry-run estimate). Default is "Track A only", and promote runs
 * with `--allow-incomplete-promotion` so the pipeline can produce a
 * deterministic-only diagnostic without silently shipping promotion.
 *
 * @param {object} args
 * @param {string} args.runId
 * @param {boolean} [args.dryRun=false]
 * @param {number|null} [args.confirmTrackBCostUsd=null]   set to enable Track B
 * @param {boolean} [args.allowIncompletePromotion=false]  loosens promote gate when Thresholdout/Track B skipped
 */
export function runQueryShapeSweep({
  runId, dryRun = false, confirmTrackBCostUsd = null, allowIncompletePromotion = false,
}) {
  const a = runTrackA({ runId, dryRun });
  if (a.exitCode !== 0) return { ok: false, stage: 'track-a', exitCode: a.exitCode };
  if (dryRun) return { ok: true, stage: 'dry-run', trackA: a };
  let b = null;
  if (confirmTrackBCostUsd != null) {
    b = runTrackB({ runId, confirmCostUsd: confirmTrackBCostUsd });
    if (b.exitCode !== 0) return { ok: false, stage: 'track-b', exitCode: b.exitCode };
  }
  const p = runShapePromotion({ runId, allowIncompletePromotion });
  return { ok: p.exitCode === 0, stage: 'promote', trackA: a, trackB: b, promote: p };
}
