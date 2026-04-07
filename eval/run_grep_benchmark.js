#!/usr/bin/env node

/**
 * Native Grep vs Ripgrep Benchmark
 *
 * Compares accuracy (match-for-match) and latency between:
 *   1. rg (ripgrep via subprocess)
 *   2. sweet-search native grep (Rust NAPI, in-process, gram-prefiltered)
 *
 * Both should produce identical file:line matches. Native grep should be
 * faster due to gram index prefiltering and zero spawn overhead.
 *
 * Usage:
 *   node eval/run_grep_benchmark.js
 *   node eval/run_grep_benchmark.js --repos=fastify,gin
 *   node eval/run_grep_benchmark.js --max-queries=10
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REPOS = [
  { name: 'fastify', queryFile: 'eval/data/pattern-benchmark-fastify/queries.jsonl', projectRoot: 'eval/repos/fastify' },
  { name: 'gin', queryFile: 'eval/data/pattern-benchmark-gin/queries.jsonl', projectRoot: 'eval/repos/gin' },
  { name: 'flask', queryFile: 'eval/data/pattern-benchmark-flask/queries.jsonl', projectRoot: 'eval/repos/flask' },
  { name: 'ripgrep', queryFile: 'eval/data/pattern-benchmark-ripgrep/queries.jsonl', projectRoot: 'eval/repos/ripgrep' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { repos: null, maxQueries: 0, verbose: false };
  for (const arg of args) {
    if (arg.startsWith('--repos=')) opts.repos = arg.split('=')[1].split(',');
    else if (arg.startsWith('--max-queries=')) opts.maxQueries = parseInt(arg.split('=')[1]);
    else if (arg === '-v' || arg === '--verbose') opts.verbose = true;
  }
  return opts;
}

/** Run rg and return sorted file:line matches + timing. */
function runRg(regex, repoRoot) {
  const start = performance.now();
  let stdout;
  try {
    stdout = execSync(`rg --json -m 500 ${JSON.stringify(regex)} .`, {
      cwd: repoRoot, timeout: 10000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    if (err.status === 1) return { matches: [], timeMs: performance.now() - start }; // no matches
    throw err;
  }
  const timeMs = performance.now() - start;

  const matches = stdout.split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(o => o?.type === 'match')
    .map(o => {
      let file = o.data?.path?.text;
      const line = o.data?.line_number;
      if (!file || !line) return null;
      // Normalize: strip leading ./
      file = file.replace(/^\.\//, '');
      return `${file}:${line}`;
    })
    .filter(Boolean)
    .sort();

  return { matches, timeMs };
}

/** Run native grep and return sorted file:line matches + timing. */
async function runNativeGrep(regex, repoRoot, allFiles) {
  const { nativeGrepLines } = await import('../core/infrastructure/native-sparse-gram.js');
  const { normalizeSearchPath } = await import('../core/search/search-pattern-ripgrep.js');

  const start = performance.now();
  const result = nativeGrepLines(regex, repoRoot, allFiles, false);
  const timeMs = performance.now() - start;

  if (!result) return { matches: [], timeMs, error: 'native grep unavailable' };

  const matches = result.matches
    .map(m => {
      const file = normalizeSearchPath(repoRoot, m.file);
      return `${file}:${m.line}`;
    })
    .sort();

  return { matches, timeMs, scannedFiles: result.scannedFiles, elapsedUs: result.elapsedUs };
}

async function main() {
  const opts = parseArgs();

  console.log('═'.repeat(70));
  console.log('  Native Grep vs Ripgrep Benchmark');
  console.log('═'.repeat(70));

  const { ensureSparseGramIndex, getSparseGramAllFiles } = await import('../core/search/search-pattern-prefilter.js');
  const SweetSearch = (await import('../core/search/index.js')).default;

  const activeRepos = REPOS.filter(r =>
    (!opts.repos || opts.repos.includes(r.name)) &&
    fs.existsSync(path.resolve(ROOT, r.queryFile))
  );

  const allResults = [];

  for (const repo of activeRepos) {
    const repoRoot = path.resolve(ROOT, repo.projectRoot);
    const ssDir = path.join(repoRoot, '.sweet-search');
    if (!fs.existsSync(ssDir)) { console.log(`  ${repo.name}: SKIPPED (no index)`); continue; }

    // Initialize search to get gram index + all files
    process.env.SWEET_SEARCH_PROJECT_ROOT = repoRoot;
    const search = new SweetSearch({
      projectRoot: repoRoot,
      graphDbPath: path.join(ssDir, 'code-graph.db'),
      hnswPath: path.join(ssDir, 'codebase-hnsw.idx'),
      binaryHnswPath: path.join(ssDir, 'codebase-binary-hnsw.idx'),
      codebaseDbPath: path.join(ssDir, 'codebase.db'),
      sparseGramIndexPath: path.join(ssDir, 'codebase-sparse-grams.idx'),
      lateInteractionOptions: { indexPath: path.join(ssDir, 'codebase-late-interaction.db') },
    });
    await search.init();

    const gramIndex = ensureSparseGramIndex(search, {});
    const allFiles = getSparseGramAllFiles(gramIndex);

    let queries = fs.readFileSync(path.resolve(ROOT, repo.queryFile), 'utf8')
      .trim().split('\n').map(l => JSON.parse(l));
    // Deduplicate regexes (many queries share the same regex)
    const uniqueRegexes = [...new Set(queries.map(q => q.regex))];
    if (opts.maxQueries > 0) uniqueRegexes.splice(opts.maxQueries);

    console.log(`\n  ${repo.name}: ${uniqueRegexes.length} unique regexes`);

    for (const regex of uniqueRegexes) {
      const rgResult = runRg(regex, repoRoot);
      const nativeResult = await runNativeGrep(regex, repoRoot, allFiles);

      // Compare accuracy
      const rgSet = new Set(rgResult.matches);
      const nativeSet = new Set(nativeResult.matches);
      const commonMatches = rgResult.matches.filter(m => nativeSet.has(m)).length;
      const rgOnly = rgResult.matches.filter(m => !nativeSet.has(m)).length;
      const nativeOnly = nativeResult.matches.filter(m => !rgSet.has(m)).length;
      const identical = rgOnly === 0 && nativeOnly === 0;

      const speedup = rgResult.timeMs > 0 ? rgResult.timeMs / nativeResult.timeMs : 0;

      if (opts.verbose || !identical) {
        const status = identical ? '✓' : '✗';
        console.log(`    ${status} regex="${regex.slice(0, 40)}" rg=${rgResult.matches.length} native=${nativeResult.matches.length} ` +
          `common=${commonMatches} rgOnly=${rgOnly} nativeOnly=${nativeOnly} ` +
          `rg=${rgResult.timeMs.toFixed(1)}ms native=${nativeResult.timeMs.toFixed(1)}ms speedup=${speedup.toFixed(1)}x`);
      }

      allResults.push({
        repo: repo.name,
        regex,
        rgMatches: rgResult.matches.length,
        nativeMatches: nativeResult.matches.length,
        commonMatches,
        rgOnly,
        nativeOnly,
        identical,
        rgTimeMs: rgResult.timeMs,
        nativeTimeMs: nativeResult.timeMs,
        nativeRustUs: nativeResult.elapsedUs || 0,
        speedup,
      });
    }

    search.close();
  }

  // Aggregate
  console.log('\n' + '═'.repeat(70));
  console.log('  AGGREGATE RESULTS');
  console.log('═'.repeat(70));

  const total = allResults.length;
  const identicalCount = allResults.filter(r => r.identical).length;
  const avgSpeedup = allResults.reduce((s, r) => s + r.speedup, 0) / total;
  const medianSpeedup = allResults.map(r => r.speedup).sort((a, b) => a - b)[Math.floor(total / 2)];
  const totalRgTime = allResults.reduce((s, r) => s + r.rgTimeMs, 0);
  const totalNativeTime = allResults.reduce((s, r) => s + r.nativeTimeMs, 0);
  const totalRgMatches = allResults.reduce((s, r) => s + r.rgMatches, 0);
  const totalNativeMatches = allResults.reduce((s, r) => s + r.nativeMatches, 0);
  const totalRgOnly = allResults.reduce((s, r) => s + r.rgOnly, 0);
  const totalNativeOnly = allResults.reduce((s, r) => s + r.nativeOnly, 0);

  console.log(`  Total regexes:      ${total}`);
  console.log(`  Accuracy:`);
  console.log(`    Identical:        ${identicalCount}/${total} (${(identicalCount/total*100).toFixed(1)}%)`);
  console.log(`    rg-only matches:  ${totalRgOnly} (found by rg but not native)`);
  console.log(`    native-only:      ${totalNativeOnly} (found by native but not rg)`);
  console.log(`    Total rg matches: ${totalRgMatches}`);
  console.log(`    Total native:     ${totalNativeMatches}`);
  console.log(`  Latency:`);
  console.log(`    Total rg time:    ${totalRgTime.toFixed(0)}ms`);
  console.log(`    Total native:     ${totalNativeTime.toFixed(0)}ms`);
  console.log(`    Avg speedup:      ${avgSpeedup.toFixed(1)}x`);
  console.log(`    Median speedup:   ${medianSpeedup.toFixed(1)}x`);
  console.log(`    Overall speedup:  ${(totalRgTime / totalNativeTime).toFixed(1)}x`);

  // Per-repo breakdown
  console.log('\n  Per-repo:');
  for (const repo of activeRepos) {
    const repoResults = allResults.filter(r => r.repo === repo.name);
    if (repoResults.length === 0) continue;
    const ident = repoResults.filter(r => r.identical).length;
    const rgT = repoResults.reduce((s, r) => s + r.rgTimeMs, 0);
    const natT = repoResults.reduce((s, r) => s + r.nativeTimeMs, 0);
    console.log(`    ${repo.name}: ${ident}/${repoResults.length} identical, rg=${rgT.toFixed(0)}ms native=${natT.toFixed(0)}ms speedup=${(rgT/natT).toFixed(1)}x`);
  }

  // Save
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(__dirname, 'results', `grep-benchmark_${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), results: allResults }, null, 2));
  console.log(`\n  Results saved: ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
