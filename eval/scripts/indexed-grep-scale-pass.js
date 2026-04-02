#!/usr/bin/env node

import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'eval', 'data', 'indexed-grep-scale', 'manifest.json');
const RESULTS_DIR = path.join(ROOT, 'eval', 'results');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repo: 'typescript',
    fetch: false,
    rebuild: false,
    coldRuns: 1,
    warmRuns: 3,
  };

  for (const arg of args) {
    if (arg.startsWith('--repo=')) opts.repo = arg.split('=')[1];
    else if (arg === '--fetch') opts.fetch = true;
    else if (arg === '--rebuild') opts.rebuild = true;
    else if (arg.startsWith('--cold-runs=')) opts.coldRuns = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--warm-runs=')) opts.warmRuns = parseInt(arg.split('=')[1], 10);
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Indexed Grep Scale Pass

Usage: node eval/scripts/indexed-grep-scale-pass.js [options]

Options:
  --repo=ID           Repo id from manifest [default: typescript]
  --fetch             Clone the pinned repo if missing
  --rebuild           Rebuild the sparse-gram artifact even if present
  --cold-runs=N       Number of cold runs per pattern [default: 1]
  --warm-runs=N       Number of measured warm runs per pattern [default: 3]
`);
      process.exit(0);
    }
  }

  return opts;
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

function toKey(match) {
  return `${match.file}:${match.line}:${match.column || 1}`;
}

function compareSets(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function clonePinnedRepo(repo) {
  const repoDir = path.join(ROOT, repo.path);
  mkdirSync(path.dirname(repoDir), { recursive: true });
  if (existsSync(repoDir)) {
    return repoDir;
  }

  execSync(`git clone --depth 100 ${repo.url} ${repoDir}`, { stdio: 'inherit' });
  execSync(`git -C ${repoDir} checkout ${repo.sha}`, { stdio: 'inherit' });
  rmSync(path.join(repoDir, '.git'), { recursive: true, force: true });
  return repoDir;
}

function buildSparseArtifact(repoDir) {
  const script = `
    process.env.SWEET_SEARCH_PROJECT_ROOT = ${JSON.stringify(repoDir)};
    const { discoverFiles } = await import(${JSON.stringify(path.join(ROOT, 'core', 'indexing', 'indexer-utils.js'))});
    const { buildSparseGramArtifact } = await import(${JSON.stringify(path.join(ROOT, 'core', 'indexing', 'indexer-sparse-gram.js'))});
    const files = await discoverFiles({ silent: true });
    const result = await buildSparseGramArtifact(files, false);
    console.log(JSON.stringify(result));
  `;

  const output = execFileSync('node', ['--input-type=module', '-e', script], {
    cwd: ROOT,
    env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: repoDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  }).toString('utf-8').trim();

  return JSON.parse(output.split('\n').at(-1));
}

async function main() {
  const opts = parseArgs();
  const manifest = loadManifest();
  const repo = manifest.repos.find((entry) => entry.id === opts.repo);

  if (!repo) {
    console.error(`Unknown repo id: ${opts.repo}`);
    process.exit(1);
  }

  const repoDir = path.join(ROOT, repo.path);
  if (!existsSync(repoDir)) {
    if (!opts.fetch) {
      console.error(`Repo not found at ${repoDir}. Re-run with --fetch.`);
      process.exit(2);
    }
    clonePinnedRepo(repo);
  }

  const sparseIndexPath = path.join(repoDir, '.sweet-search', 'codebase-sparse-grams.idx');
  let sparseBuild = null;
  if (opts.rebuild || !existsSync(sparseIndexPath)) {
    sparseBuild = buildSparseArtifact(repoDir);
  }

  process.env.SWEET_SEARCH_PROJECT_ROOT = repoDir;
  const [{ default: SweetSearch }, { runRipgrep }, { discoverFiles }] = await Promise.all([
    import(path.join(ROOT, 'core', 'search', 'sweet-search.js')),
    import(path.join(ROOT, 'core', 'search', 'index.js')),
    import(path.join(ROOT, 'core', 'indexing', 'indexer-utils.js')),
  ]);
  const indexedFileSet = new Set(await discoverFiles({ silent: true }));

  const patterns = manifest.patterns;
  const coldResults = [];
  const warmResults = [];

  for (const pattern of patterns) {
    for (let run = 0; run < opts.coldRuns; run += 1) {
      const searcher = new SweetSearch({ projectRoot: repoDir, verbose: false });
      const rawStart = performance.now();
      const raw = await runRipgrep(pattern.regex, repoDir, { maxMatches: 0 });
      const rawTime = performance.now() - rawStart;
      const indexedStart = performance.now();
      const indexed = await searcher.search(pattern.regex, {
        mode: 'grep',
        regex: pattern.regex,
        rerank: false,
        expand: false,
      });
      const indexedTime = performance.now() - indexedStart;
      searcher.close();
      const rawIndexedCorpus = raw.filter((match) => indexedFileSet.has(match.file));
      const indexedCorpusResults = indexed.results.filter((match) => indexedFileSet.has(match.file));

      coldResults.push({
        patternId: pattern.id,
        regex: pattern.regex,
        kind: pattern.kind,
        rawTimeMs: Number(rawTime.toFixed(1)),
        indexedTimeMs: Number(indexedTime.toFixed(1)),
        matchesEqual: compareSets(
          new Set(rawIndexedCorpus.map(toKey)),
          new Set(indexedCorpusResults.map(toKey))
        ),
        rawMatches: rawIndexedCorpus.length,
        indexedMatches: indexedCorpusResults.length,
      });
    }
  }

  const warmSearcher = new SweetSearch({ projectRoot: repoDir, verbose: false });
  await warmSearcher.initGrepOnly();

  for (const pattern of patterns) {
    await warmSearcher.search(pattern.regex, {
      mode: 'grep',
      regex: pattern.regex,
      rerank: false,
      expand: false,
    });

    for (let run = 0; run < opts.warmRuns; run += 1) {
      const rawStart = performance.now();
      const raw = await runRipgrep(pattern.regex, repoDir, { maxMatches: 0 });
      const rawTime = performance.now() - rawStart;
      const indexedStart = performance.now();
      const indexed = await warmSearcher.search(pattern.regex, {
        mode: 'grep',
        regex: pattern.regex,
        rerank: false,
        expand: false,
      });
      const indexedTime = performance.now() - indexedStart;
      const rawIndexedCorpus = raw.filter((match) => indexedFileSet.has(match.file));
      const indexedCorpusResults = indexed.results.filter((match) => indexedFileSet.has(match.file));

      warmResults.push({
        patternId: pattern.id,
        regex: pattern.regex,
        kind: pattern.kind,
        rawTimeMs: Number(rawTime.toFixed(1)),
        indexedTimeMs: Number(indexedTime.toFixed(1)),
        matchesEqual: compareSets(
          new Set(rawIndexedCorpus.map(toKey)),
          new Set(indexedCorpusResults.map(toKey))
        ),
        rawMatches: rawIndexedCorpus.length,
        indexedMatches: indexedCorpusResults.length,
      });
    }
  }

  warmSearcher.close();

  const indexedWarmTimes = warmResults.map((row) => row.indexedTimeMs);
  const rawWarmTimes = warmResults.map((row) => row.rawTimeMs);
  const report = {
    generatedAt: new Date().toISOString(),
    repo,
    sparseBuild,
    coldRuns: opts.coldRuns,
    warmRuns: opts.warmRuns,
    coldResults,
    warmResults,
    summary: {
      cold: {
        rawP50Ms: percentile(coldResults.map((row) => row.rawTimeMs), 0.5),
        indexedP50Ms: percentile(coldResults.map((row) => row.indexedTimeMs), 0.5),
      },
      warm: {
        rawP50Ms: percentile(rawWarmTimes, 0.5),
        rawP95Ms: percentile(rawWarmTimes, 0.95),
        indexedP50Ms: percentile(indexedWarmTimes, 0.5),
        indexedP95Ms: percentile(indexedWarmTimes, 0.95),
      },
      completenessFailures: [
        ...coldResults.filter((row) => !row.matchesEqual),
        ...warmResults.filter((row) => !row.matchesEqual),
      ].length,
    },
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const resultPath = path.join(
    RESULTS_DIR,
    `indexed-grep-scale_${repo.id}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  writeFileSync(resultPath, JSON.stringify(report, null, 2));

  console.log(`Saved scale report to ${resultPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
