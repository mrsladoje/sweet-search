#!/usr/bin/env node
/**
 * One-shot reproducibility runner for the prompt-optimization campaign.
 *
 * P0 surface: validates manifest + run-config + splits, prints a
 * campaign-readiness report, and exposes the orchestration entrypoint
 * downstream phases (P8-P11.5) will plug into. Per plan §11.7, every
 * published number must be reproducible from the artifacts validated here.
 *
 * Usage:
 *   node scripts/eval-prompt-evolution.mjs --validate
 *   node scripts/eval-prompt-evolution.mjs --run <run-id>
 *
 * Add `npm run eval:prompt -- --validate` (or `-- --run <id>`) once the
 * package.json entry lands.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadManifest,
  loadRunConfig,
  buildSplits,
} from '../core/prompt-optimization/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { mode: 'validate', runId: null, runConfigPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--validate') out.mode = 'validate';
    else if (a === '--run') {
      out.mode = 'run';
      out.runId = argv[++i];
    } else if (a.startsWith('--run-config=')) {
      out.runConfigPath = a.slice('--run-config='.length);
    } else if (a === '--help' || a === '-h') {
      out.mode = 'help';
    }
  }
  return out;
}

function help() {
  process.stdout.write(`Usage:
  node scripts/eval-prompt-evolution.mjs --validate
  node scripts/eval-prompt-evolution.mjs --run <run-id> [--run-config=<path>]

P0 (this commit) ships only --validate; --run is reserved for the
GEPA / DSPy / baseline orchestrators landing in P8-P11.5.
`);
}

function validate() {
  const report = { ok: true, errors: [], warnings: [], summary: {} };

  // 1. Manifest loads + has expected shape.
  let manifest;
  try {
    manifest = loadManifest();
    report.summary.manifest = {
      campaignId: manifest.campaignId,
      evaluatees: manifest.evaluatees.length,
      pinnedRepos: Object.keys(manifest._repos).length,
      freshstack: Object.keys(manifest.freshstack ?? {}),
    };
  } catch (err) {
    report.ok = false;
    report.errors.push(`manifest: ${err.message}`);
  }

  // 2. Run-config loads + parses TOML.
  let cfg;
  try {
    cfg = loadRunConfig();
    report.summary.runConfig = {
      campaignId: cfg.campaign_id,
      poolSize: cfg.evaluatees?.pool?.length ?? 0,
      reflector: cfg.reflector?.model,
      hardCapUsd: cfg.budget?.hard_cap_usd,
    };
  } catch (err) {
    report.ok = false;
    report.errors.push(`run-config: ${err.message}`);
  }

  // 3. Splits regenerate to byte-identical output.
  try {
    const r = buildSplits({ check: true });
    if (!r.ok) {
      report.ok = false;
      report.errors.push(
        `splits: on-disk artifacts diverge from generator. Mismatches: ${r.mismatches.join(', ')}.`
        + ' Re-run `node core/prompt-optimization/splits/build-splits.mjs` and commit.',
      );
    } else {
      report.summary.splits = r.manifest.totals;
    }
  } catch (err) {
    report.ok = false;
    report.errors.push(`splits: ${err.message}`);
  }

  // 4. Pre-registration template exists (campaigns must copy + commit before runs).
  const preregPath = path.join(REPO_ROOT, 'core', 'prompt-optimization', 'data', 'preregistration.template.md');
  if (!fs.existsSync(preregPath)) {
    report.ok = false;
    report.errors.push(`pre-registration template missing at ${path.relative(REPO_ROOT, preregPath)}`);
  }

  // 5. Decontamination: no removed-items list yet — that's expected pre-P6.0.
  const contaminatedDir = path.join(REPO_ROOT, 'core', 'prompt-optimization', 'data', 'contaminated');
  if (!fs.existsSync(contaminatedDir)) {
    report.warnings.push(
      `data/contaminated/ does not exist yet — populated when scripts/eval-prompt-evolution.mjs runs decontamination layers (post-P6.0).`,
    );
  }

  return report;
}

function printReport(report) {
  const stream = report.ok ? process.stdout : process.stderr;
  stream.write(`\nprompt-optimization campaign readiness — ${report.ok ? 'OK' : 'FAIL'}\n`);
  if (Object.keys(report.summary).length) {
    stream.write('\nSummary:\n');
    for (const [k, v] of Object.entries(report.summary)) {
      stream.write(`  ${k}: ${JSON.stringify(v)}\n`);
    }
  }
  if (report.warnings.length) {
    stream.write('\nWarnings:\n');
    for (const w of report.warnings) stream.write(`  - ${w}\n`);
  }
  if (report.errors.length) {
    stream.write('\nErrors:\n');
    for (const e of report.errors) stream.write(`  - ${e}\n`);
  }
  stream.write('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'help') {
    help();
    return 0;
  }
  if (args.mode === 'validate') {
    const report = validate();
    printReport(report);
    return report.ok ? 0 : 1;
  }
  if (args.mode === 'run') {
    process.stderr.write(
      `eval-prompt-evolution: --run <run-id> is reserved for P8-P11.5 orchestrators (currently a no-op).\n`
      + `Re-run with --validate to confirm campaign scaffolding readiness.\n`,
    );
    return 2;
  }
  help();
  return 64; // EX_USAGE
}

const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; }
  catch { return false; }
})();
if (isMain) {
  process.exit(main());
}

export { validate };
