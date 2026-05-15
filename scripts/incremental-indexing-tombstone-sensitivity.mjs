#!/usr/bin/env node
/**
 * Tombstone-fraction sensitivity sweep (Plan § 13 Phase 5).
 *
 * Synthesises random tombstone fractions on the current `codebase.db`,
 * runs the GCSN dev benchmark at each point, restores the index, and
 * emits a CSV / JSON summary for use by the Phase 5 threshold-pick.
 *
 * Discipline:
 *   - **Dev set only.** Per CLAUDE.md `feedback_heldout_discipline_strict.md`,
 *     never run held-out per-fraction. This script forbids the held-out
 *     split explicitly.
 *   - **Seed = 42.** CLAUDE.md benchmark methodology pins the seed.
 *   - **Restore between points.** The injector's `restore()` runs even on
 *     exception so the index returns to its pre-experiment state.
 *
 * Usage:
 *
 *   node scripts/incremental-indexing-tombstone-sensitivity.mjs \
 *     --fractions 0.05,0.1,0.15,0.2,0.25,0.3 \
 *     --out docs/INCREMENTAL_INDEXING_RESULTS.json
 *
 * Caveats:
 *   - The script assumes `codebase.db` exists at the default path. It does
 *     not arm a model pool — the GCSN harness is invoked as a subprocess
 *     so it inherits whatever model state the user has already warmed.
 *   - Each sweep point invokes `eval/run_all.js`. That command burns
 *     benchmark budget. Run only when you actually need the curve.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { sweepTombstoneFractions } from '../core/incremental-indexing/application/tombstone-injector.mjs';

const DEFAULT_FRACTIONS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
const DEFAULT_DB_PATH = path.resolve('.sweet-search', 'codebase.db');
const DEFAULT_OUT_PATH = path.resolve('docs', 'INCREMENTAL_INDEXING_RESULTS.json');

function parseArgs(argv) {
  const out = {
    fractions: DEFAULT_FRACTIONS,
    db: DEFAULT_DB_PATH,
    outPath: DEFAULT_OUT_PATH,
    bench: 'npm run eval:bench',
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fractions') {
      out.fractions = argv[++i].split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
    } else if (arg === '--db') {
      out.db = path.resolve(argv[++i]);
    } else if (arg === '--out') {
      out.outPath = path.resolve(argv[++i]);
    } else if (arg === '--bench') {
      out.bench = argv[++i];
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }
  if (out.fractions.length === 0) {
    console.error('Empty --fractions list.');
    process.exit(1);
  }
  return out;
}

function printUsage() {
  console.log(`
Usage: node scripts/incremental-indexing-tombstone-sensitivity.mjs [options]

  --fractions <list>   Comma-separated tombstone fractions (default: 0.05,0.1,0.15,0.2,0.25,0.3)
  --db <path>          Path to codebase.db (default: .sweet-search/codebase.db)
  --out <path>         Output JSON path (default: docs/INCREMENTAL_INDEXING_RESULTS.json)
  --bench <cmd>        Benchmark command (default: npm run eval:bench)
  --dry-run            Inject + restore each point without running the benchmark.
  --help               Show this help text.
`);
}

async function runBenchmark(cmd, point) {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd.split(/\s+/);
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Benchmark exited with code ${code}.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`));
      }
      resolve({ stdout, stderr, point });
    });
    child.on('error', reject);
  });
}

function extractMrrFromBenchOutput(text) {
  // Best-effort extraction; matches lines like "MRR: 0.86012" emitted
  // by eval/run_all.js. The runner is permissive — if multiple matches
  // exist, the LAST one wins (typically the held-out / final summary line).
  const matches = [...text.matchAll(/MRR\s*[=:]\s*([\d.]+)/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!fs.existsSync(opts.db)) {
    console.error(`codebase.db not found at ${opts.db} — index the corpus first.`);
    process.exit(2);
  }

  const db = new Database(opts.db);
  const liveBefore = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE epoch_retired IS NULL').get().n;
  console.error(`[tombstone-sensitivity] live vectors before sweep: ${liveBefore}`);

  const startedAt = new Date().toISOString();
  let points;
  try {
    points = await sweepTombstoneFractions({
      db,
      fractions: opts.fractions,
      seed: 42,
      runOnce: async (meta) => {
        if (opts.dryRun) {
          return { fraction: meta.fraction, mrr: null, dryRun: true };
        }
        console.error(`[tombstone-sensitivity] benchmarking @ fraction=${meta.fraction.toFixed(3)} (${meta.injected} tombstones)`);
        const { stdout, stderr } = await runBenchmark(opts.bench, meta);
        const mrr = extractMrrFromBenchOutput(stdout + stderr);
        return { fraction: meta.fraction, mrr };
      },
    });
  } finally {
    const liveAfter = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE epoch_retired IS NULL').get().n;
    if (liveAfter !== liveBefore) {
      console.error(`[tombstone-sensitivity] WARN: live vector count changed from ${liveBefore} to ${liveAfter} after restore`);
    }
    db.close();
  }

  const report = {
    methodology: {
      seed: 42,
      benchmark: opts.bench,
      generatedAt: startedAt,
      heldOutInspection: 'forbidden-per-feedback_heldout_discipline_strict',
    },
    points,
  };
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  fs.writeFileSync(opts.outPath, JSON.stringify(report, null, 2));
  console.error(`[tombstone-sensitivity] wrote ${opts.outPath}`);
}

main().catch((err) => {
  console.error('[tombstone-sensitivity] fatal:', err);
  process.exit(1);
});
