#!/usr/bin/env node
/**
 * Sweep SWEET_SEARCH_FULL_VECTOR_LI_RESCORE_WEIGHT on GCSN dev split only.
 *
 * This weight blends min-max normalised dense-vector similarity back after
 * Late Interaction has reranked (see core/search/search-postprocess.js).
 * It only affects semantic/hybrid paths where full-vector rescore runs — not
 * pattern/search (ColGrep multi-repo) or agent-format probes.
 *
 * Usage (from repo root):
 *   node eval/scripts/sweep-li-blend-dev.mjs
 *   node eval/scripts/sweep-li-blend-dev.mjs --weights=0.2,0.3,0.4
 *   node eval/scripts/sweep-li-blend-dev.mjs --heldout-validate=0.25,0.30,0.35
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_WEIGHTS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];

function parseArgs(argv) {
  const out = { weights: [...DEFAULT_WEIGHTS], heldoutValidate: null };
  for (const a of argv) {
    if (a.startsWith('--weights=')) {
      out.weights = a.slice(10).split(',').map(Number).filter(Number.isFinite);
    } else if (a.startsWith('--heldout-validate=')) {
      out.heldoutValidate = a.slice(19).split(',').map(Number).filter(Number.isFinite);
    }
  }
  return out;
}

function runGcsn({ weight, split, concurrency = 8 }) {
  const env = {
    ...process.env,
    SWEET_SEARCH_FULL_VECTOR_LI_RESCORE_WEIGHT: String(weight),
  };
  const r = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'eval/run_benchmark.js'),
      '--dataset=gencodesearchnet',
      '--skip-index',
      `--split=${split}`,
      `--concurrency=${concurrency}`,
    ],
    { cwd: REPO_ROOT, env, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    throw new Error(
      `run_benchmark failed (weight=${weight}, split=${split})\n${r.stderr || r.stdout}`,
    );
  }
  const m = r.stdout.match(/Results saved to:\s*(.+)/);
  if (!m) {
    throw new Error(`Could not parse results path in stdout (weight=${weight})\n${r.stdout.slice(-2000)}`);
  }
  const jsonPath = m[1].trim();
  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return {
    weight,
    split,
    mrr: report.aggregate?.mrr_at_10 ?? null,
    s1: report.aggregate?.success_at_1 ?? null,
    queryCount: report.queryCount,
    jsonPath,
  };
}

/** Competition ranking by MRR (1 = best). */
function withRanks(rows) {
  const sorted = [...rows].sort((a, b) => b.mrr - a.mrr);
  let rank = 1;
  return sorted.map((r, i) => {
    if (i > 0 && sorted[i].mrr !== sorted[i - 1].mrr) rank = i + 1;
    return { ...r, rank };
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('═'.repeat(70));
  console.log('  LI post-rerank dense blend sweep (GCSN)');
  console.log('  Env: SWEET_SEARCH_FULL_VECTOR_LI_RESCORE_WEIGHT');
  console.log('  Split: dev (methodology: iterate on dev only)');
  console.log('═'.repeat(70));

  const devResults = [];
  for (const w of opts.weights) {
    console.log(`\n  Running weight=${w} ...`);
    const row = runGcsn({ weight: w, split: 'dev' });
    devResults.push(row);
    console.log(`    MRR@10=${(row.mrr * 100).toFixed(2)}%  S@1=${(row.s1 * 100).toFixed(2)}%  n=${row.queryCount}`);
  }

  const ranked = withRanks(devResults);
  const byWeight = new Map(ranked.map(r => [r.weight, r]));

  console.log('\n' + '═'.repeat(70));
  console.log('  DEV SUMMARY (rank 1 = best MRR@10)');
  console.log('  ' + '-'.repeat(66));
  console.log('  ' + 'weight'.padEnd(8) + 'MRR@10'.padStart(10) + 'S@1'.padStart(10) + 'rank'.padStart(6));
  console.log('  ' + '-'.repeat(66));
  for (const w of opts.weights) {
    const r = byWeight.get(w);
    console.log(
      '  ' +
      String(r.weight).padEnd(8) +
      ((r.mrr * 100).toFixed(2) + '%').padStart(10) +
      ((r.s1 * 100).toFixed(2) + '%').padStart(10) +
      String(r.rank).padStart(6),
    );
  }
  const best = ranked[0];
  console.log('  ' + '-'.repeat(66));
  console.log(`  Best dev MRR: weight=${best.weight} → ${(best.mrr * 100).toFixed(2)}%`);

  if (opts.heldoutValidate?.length) {
    console.log('\n' + '═'.repeat(70));
    console.log('  HELD-OUT VALIDATION (aggregate only)');
    console.log('═'.repeat(70));
    for (const w of opts.heldoutValidate) {
      console.log(`\n  Running weight=${w} split=heldout ...`);
      const row = runGcsn({ weight: w, split: 'heldout' });
      console.log(`    MRR@10=${(row.mrr * 100).toFixed(2)}%  S@1=${(row.s1 * 100).toFixed(2)}%  n=${row.queryCount}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('  Note: multi-repo ColGrep (pattern) and retrieval-probes (agent)');
  console.log('  do not hit full-vector rescore; skip tuning this weight on those.');
  console.log('═'.repeat(70));
}

main();
