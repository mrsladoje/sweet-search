#!/usr/bin/env node
//
// Layer 2 deterministic ranking-probe runner.
//
// Generates probes from a code-graph.db, runs StructuralContextBuilder.build()
// against each, grades the result, and writes per-family pass rates plus the
// raw probe outcomes to a JSON artifact for offline diffing.
//
// Usage:
//   node eval/structural-context/run-ranking-probes.mjs \
//        --db <path/code-graph.db> --root <project-root> \
//        [--repo <name>] [--max-probes 400] [--symbol-limit 60] [--label baseline]
//
// Two-arm A/B is performed by running this script twice (before vs after a
// ranking change) and diffing the per-family pass rates.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRankingProbes, gradeProbe, aggregateByFamily } from './ranking-probes.js';
import { StructuralContextBuilder } from '../../core/graph/structural-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const opts = {
    dbPath: null,
    projectRoot: null,
    repo: null,
    label: 'unlabelled',
    maxProbes: 400,
    symbolLimit: 60,
    queryHint: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db' && argv[i + 1]) opts.dbPath = argv[++i];
    else if (a === '--root' && argv[i + 1]) opts.projectRoot = argv[++i];
    else if (a === '--repo' && argv[i + 1]) opts.repo = argv[++i];
    else if (a === '--label' && argv[i + 1]) opts.label = argv[++i];
    else if (a === '--max-probes' && argv[i + 1]) opts.maxProbes = +argv[++i];
    else if (a === '--symbol-limit' && argv[i + 1]) opts.symbolLimit = +argv[++i];
    else if (a === '--hint' && argv[i + 1]) opts.queryHint = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stdout.write(`run-ranking-probes — Layer 2 deterministic probes\n\n  --db PATH         path to code-graph.db (required)\n  --root PATH       project root for source reads (required)\n  --repo NAME       label for the artifact (e.g. fastify)\n  --label NAME      A/B label (e.g. baseline / with-ppr)\n  --max-probes N    cap on probes generated (default 400)\n  --symbol-limit N  cap on candidate symbols scanned (default 60)\n  --hint TEXT       optional query hint to pass into ss-trace\n`);
      process.exit(0);
    }
  }
  if (!opts.dbPath) throw new Error('--db is required');
  if (!opts.projectRoot) throw new Error('--root is required');
  if (!existsSync(opts.dbPath)) throw new Error(`db not found: ${opts.dbPath}`);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const probes = generateRankingProbes({
    dbPath: opts.dbPath,
    config: { maxProbes: opts.maxProbes, symbolLimit: opts.symbolLimit },
  });
  process.stdout.write(`Generated ${probes.length} probes from ${opts.dbPath}\n`);

  const builder = new StructuralContextBuilder({
    projectRoot: opts.projectRoot,
    graphDbPath: opts.dbPath,
  });

  const graded = [];
  let i = 0;
  for (const probe of probes) {
    i++;
    let trace = null;
    try {
      trace = builder.build(probe.symbol, {
        filePath: probe.file,
        queryHint: opts.queryHint || undefined,
        tokenBudget: 8000,
        maxDepth: 2,
      });
    } catch (err) {
      graded.push({ probe, result: { pass: false, reason: `build_error: ${err.message}` } });
      continue;
    }
    const result = gradeProbe(probe, trace);
    graded.push({ probe, result });
    if (i % 50 === 0 || i === probes.length) {
      process.stdout.write(`  ${i}/${probes.length} probes graded\n`);
    }
  }
  builder.close();

  const summary = aggregateByFamily(graded);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(REPO_ROOT, '.sweet-search', 'benchmarks');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const repoTag = opts.repo || 'unknown';
  const outPath = path.join(outDir, `ranking-probes-${repoTag}-${opts.label}-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({
    bench: 'structural-context-ranking-probes',
    repo: repoTag,
    label: opts.label,
    db: opts.dbPath,
    generatedProbes: probes.length,
    summary,
    graded: graded.map(({ probe, result }) => ({
      family: probe.family,
      symbol: probe.symbol,
      file: probe.file,
      pass: result.pass,
      reason: result.reason || null,
    })),
  }, null, 2));
  process.stdout.write(`Wrote ${path.relative(REPO_ROOT, outPath)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(err => {
  process.stderr.write(`[ranking-probes] ${err.stack || err.message}\n`);
  process.exit(1);
});
