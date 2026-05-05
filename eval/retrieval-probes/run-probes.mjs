#!/usr/bin/env node
/**
 * Curated retrieval-quality probe runner.
 *
 * Runs each probe in eval/retrieval-probes/probes.json against the
 * pinned bench repo and grades the top-1 chunk against the expected
 * file/symbol/type hints. No agent in the loop, no judge model — pure
 * retrieval-layer regression gate. Should run in under a minute.
 *
 * Usage:
 *   node eval/retrieval-probes/run-probes.mjs                   # all probes
 *   node eval/retrieval-probes/run-probes.mjs --repo=fastify    # one repo only
 *   node eval/retrieval-probes/run-probes.mjs --id=S2-Q3        # one probe
 *   node eval/retrieval-probes/run-probes.mjs --json out.json   # write artifact
 *   node eval/retrieval-probes/run-probes.mjs --baseline out.json  # diff vs prior
 *
 * Grading rubric — top-1 only:
 *   PASS  : top-1 file matches expectedFile (or expectedFileAnyOf)
 *           AND symbol matches expectedSymbol (or expectedSymbolAnyOf), if set
 *           AND symbolType matches expectedSymbolType (or *AnyOf), if set
 *   PARTIAL: file matches but symbol/type does not (still useful, less precise)
 *   FAIL   : top-1 file does not match expected
 *
 * The runner does NOT depend on a daemon — it instantiates SweetSearch
 * directly and cycles the LI cache between repos. Safe to run from CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SweetSearch } from '../../core/search/sweet-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROBES_PATH = path.join(__dirname, 'probes.json');

function parseArgs(argv) {
  const out = { repo: null, id: null, json: null, baseline: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--repo=')) out.repo = a.slice(7);
    else if (a.startsWith('--id=')) out.id = a.slice(5);
    else if (a.startsWith('--json=')) out.json = a.slice(7);
    else if (a === '--json') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.json = next; i++; }
      else out.json = 'eval/retrieval-probes/last-run.json';
    }
    else if (a.startsWith('--baseline=')) out.baseline = a.slice(11);
    else if (a === '--baseline') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.baseline = next; i++; }
    }
    else if (a === '-v' || a === '--verbose') out.verbose = true;
  }
  return out;
}

function arrayOrNull(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  return [value];
}

function gradeProbe(probe, top1) {
  if (!top1) return { verdict: 'FAIL', reason: 'no_results' };

  const file = top1.file || top1.metadata?.file || '';
  const sym = top1.symbol || top1.name || top1.metadata?.name || '';
  const type = top1.symbolType || top1.type || top1.metadata?.type || '';

  const wantFiles = arrayOrNull(probe.expectedFile)
    || arrayOrNull(probe.expectedFileAnyOf);
  const wantSymbols = arrayOrNull(probe.expectedSymbol)
    || arrayOrNull(probe.expectedSymbolAnyOf);
  const wantTypes = arrayOrNull(probe.expectedSymbolType)
    || arrayOrNull(probe.expectedSymbolTypeAnyOf);

  const fileMatch = !wantFiles
    || wantFiles.some(w => file === w || file.endsWith('/' + w) || file.endsWith(w));
  const symbolMatch = !wantSymbols
    || wantSymbols.some(w => String(sym).toLowerCase() === String(w).toLowerCase());
  const typeMatch = !wantTypes
    || wantTypes.some(w => String(type).toLowerCase() === String(w).toLowerCase());

  if (fileMatch && symbolMatch && typeMatch) return { verdict: 'PASS', reason: 'match' };
  if (fileMatch && (!wantSymbols || !symbolMatch || !typeMatch)) {
    return {
      verdict: 'PARTIAL',
      reason: !symbolMatch ? 'symbol_mismatch' : (!typeMatch ? 'type_mismatch' : 'partial'),
    };
  }
  return { verdict: 'FAIL', reason: !fileMatch ? 'file_mismatch' : 'unknown' };
}

const VERDICT_RANK = { PASS: 0, PARTIAL: 1, FAIL: 2 };

async function runOne(searcher, probe) {
  const start = Date.now();
  let response, top1, gradeResult, error = null;
  try {
    response = await searcher.search(probe.query, { format: 'agent', k: 5 });
    top1 = response?.results?.[0] || null;
    gradeResult = gradeProbe(probe, top1);
  } catch (err) {
    error = err.message;
    gradeResult = { verdict: 'FAIL', reason: 'error: ' + err.message };
  }
  const wallMs = Date.now() - start;
  return {
    id: probe.id,
    repo: probe.repo,
    query: probe.query,
    verdict: gradeResult.verdict,
    reason: gradeResult.reason,
    top1: top1 ? {
      file: top1.file || top1.metadata?.file,
      startLine: top1.startLine ?? top1.metadata?.startLine,
      endLine: top1.endLine ?? top1.metadata?.endLine,
      symbol: top1.symbol || top1.name,
      symbolType: top1.symbolType || top1.type,
      score: top1.score,
    } : null,
    wallMs,
    error,
  };
}

function summarize(results) {
  const counts = { PASS: 0, PARTIAL: 0, FAIL: 0 };
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const totalMs = results.reduce((acc, r) => acc + r.wallMs, 0);
  const avgMs = results.length ? Math.round(totalMs / results.length) : 0;
  return { counts, totalMs, avgMs, n: results.length };
}

function diffAgainstBaseline(current, baseline) {
  const baseById = new Map((baseline?.results || []).map(r => [r.id, r]));
  const flips = { improvedPP: 0, improvedPF: 0, improvedFP: 0, regressedPF: 0, regressedFP: 0, regressedPP: 0, unchanged: 0 };
  const lines = [];
  for (const cur of current.results) {
    const prev = baseById.get(cur.id);
    if (!prev) continue;
    if (prev.verdict === cur.verdict) {
      flips.unchanged++;
      continue;
    }
    const dir = VERDICT_RANK[cur.verdict] - VERDICT_RANK[prev.verdict];
    const tag = dir < 0 ? '✓ improved' : '✗ regressed';
    lines.push(`  ${tag} ${cur.id.padEnd(8)} ${prev.verdict} → ${cur.verdict}  (${cur.repo})`);
    if (dir < 0) {
      if (prev.verdict === 'FAIL' && cur.verdict === 'PASS') flips.improvedFP++;
      else if (prev.verdict === 'FAIL' && cur.verdict === 'PARTIAL') flips.improvedFP++;
      else flips.improvedPP++;
    } else {
      if (prev.verdict === 'PASS' && cur.verdict === 'FAIL') flips.regressedPF++;
      else if (prev.verdict === 'PARTIAL' && cur.verdict === 'FAIL') flips.regressedPF++;
      else flips.regressedPP++;
    }
  }
  return { flips, lines };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const probes = JSON.parse(fs.readFileSync(PROBES_PATH, 'utf8')).probes;
  const filtered = probes.filter(p =>
    (!opts.repo || p.repo === opts.repo) &&
    (!opts.id || p.id === opts.id)
  );

  if (filtered.length === 0) {
    console.error('No probes match filters.');
    process.exit(2);
  }

  // Group by repo so we only spin up one SweetSearch per repo.
  const byRepo = new Map();
  for (const p of filtered) {
    if (!byRepo.has(p.repo)) byRepo.set(p.repo, []);
    byRepo.get(p.repo).push(p);
  }

  const allResults = [];
  for (const [repo, list] of byRepo.entries()) {
    const projectRoot = path.join(REPO_ROOT, 'eval/repos', repo);
    if (!fs.existsSync(projectRoot)) {
      console.error(`[${repo}] repo not found at ${projectRoot}; run eval/scripts/fetch-benchmark-repos.js first`);
      for (const p of list) {
        allResults.push({ id: p.id, repo, query: p.query, verdict: 'FAIL', reason: 'repo_missing', wallMs: 0 });
      }
      continue;
    }
    // DB_PATHS in core/infrastructure/config is a module-load-time const
    // computed from PROJECT_ROOT, so we can't switch repos by mutating
    // env vars after import. Pass explicit DB paths instead — every
    // bench repo uses the same `.sweet-search/` layout.
    const dataDir = path.join(projectRoot, '.sweet-search');
    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: path.join(dataDir, 'code-graph.db'),
      codebaseDbPath: path.join(dataDir, 'codebase.db'),
      hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
      binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
      sparseGramIndexPath: path.join(dataDir, 'codebase-sparse-grams.idx'),
      lateInteractionOptions: {
        indexPath: path.join(dataDir, 'codebase-late-interaction.db'),
      },
    });
    await searcher.init();
    process.stdout.write(`\n=== ${repo} (${list.length} probes) ===\n`);
    for (const probe of list) {
      const r = await runOne(searcher, probe);
      const tag = r.verdict === 'PASS' ? '✓' : (r.verdict === 'PARTIAL' ? '~' : '✗');
      const top = r.top1 ? `${r.top1.file}:${r.top1.startLine}-${r.top1.endLine} [${r.top1.symbolType||'?'}: ${r.top1.symbol||'-'}]` : '(no top-1)';
      process.stdout.write(`  ${tag} ${r.id.padEnd(8)} ${r.verdict.padEnd(7)} ${(r.reason || '').padEnd(20)} ${r.wallMs}ms\n`);
      if (opts.verbose || r.verdict !== 'PASS') {
        process.stdout.write(`     "${probe.query}"\n`);
        process.stdout.write(`     → ${top}\n`);
      }
      allResults.push(r);
    }
    try { searcher.close(); } catch { /* ignore */ }
  }

  const summary = summarize(allResults);
  process.stdout.write(`\n=== Summary ===\n`);
  process.stdout.write(`  PASS:    ${summary.counts.PASS}/${summary.n}\n`);
  process.stdout.write(`  PARTIAL: ${summary.counts.PARTIAL}/${summary.n}\n`);
  process.stdout.write(`  FAIL:    ${summary.counts.FAIL}/${summary.n}\n`);
  process.stdout.write(`  avg wall: ${summary.avgMs}ms (total ${summary.totalMs}ms)\n`);

  const artifact = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    summary,
    results: allResults,
  };

  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify(artifact, null, 2));
    process.stdout.write(`\nWrote artifact: ${opts.json}\n`);
  }

  if (opts.baseline && fs.existsSync(opts.baseline)) {
    const baseline = JSON.parse(fs.readFileSync(opts.baseline, 'utf8'));
    const diff = diffAgainstBaseline(artifact, baseline);
    process.stdout.write(`\n=== Diff vs ${opts.baseline} ===\n`);
    if (diff.lines.length === 0) {
      process.stdout.write(`  (no changes)\n`);
    } else {
      for (const ln of diff.lines) process.stdout.write(ln + '\n');
    }
    const totalImproved = diff.flips.improvedFP + diff.flips.improvedPP;
    const totalRegressed = diff.flips.regressedPF + diff.flips.regressedPP;
    process.stdout.write(`  improved: ${totalImproved}, regressed: ${totalRegressed}, unchanged: ${diff.flips.unchanged}\n`);
    if (totalRegressed > 0) process.exitCode = 3;
  }

  if (summary.counts.FAIL > 0 && process.exitCode == null) process.exitCode = 1;
}

main().catch(err => {
  console.error('probe runner failed:', err.stack || err.message || err);
  process.exit(1);
});
