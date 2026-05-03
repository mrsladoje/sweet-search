#!/usr/bin/env node
/**
 * GenCodeSearchNet validation for stage3Candidates default change.
 *
 * The graph-2hop pool sweep showed pool=30 dominates pool=20 for the
 * legacy LI rerank path. But stage3Candidates is ALSO the slice point
 * for the 3-stage CE rerank in search-semantic.js:413, which runs on
 * GenCodeSearchNet's main path. Before changing the default we need to
 * confirm bumping it 20→30 doesn't regress GCSN.
 *
 * Holds everything constant except stage3Candidates ∈ {20, 30, 40}.
 *
 * Usage:
 *   node eval/run_stage3_validation.js
 *   node eval/run_stage3_validation.js --max-queries=500
 *   node eval/run_stage3_validation.js --stages=20,30
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { loadJsonl } from './lib/data-loader.js';
import { computeMetrics, computePerLanguageMetrics } from './lib/metrics.js';
import { prepareCorpus } from './lib/corpus.js';
import { evaluateQuery, cleanQueryText } from './lib/evaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dataset: 'gencodesearchnet',
    maxQueries: 0,
    concurrency: 1,
    stages: [20, 30, 40],
    out: path.join(__dirname, 'results', `stage3_validation_${Date.now()}.json`),
  };
  for (const a of args) {
    if (a.startsWith('--max-queries=')) opts.maxQueries = parseInt(a.split('=')[1]);
    else if (a.startsWith('--concurrency=')) opts.concurrency = parseInt(a.split('=')[1]);
    else if (a.startsWith('--dataset=')) opts.dataset = a.split('=')[1];
    else if (a.startsWith('--stages=')) opts.stages = a.split('=')[1].split(',').map(Number);
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.split('=')[1]);
  }
  return opts;
}

async function buildSearch(corpusDir, stage3) {
  process.env.SWEET_SEARCH_PROJECT_ROOT = corpusDir;
  process.env.EMBEDDING_PROVIDER = 'local';
  const dataDir = path.join(corpusDir, '.sweet-search');
  const { SweetSearch } = await import(path.join(PROJECT_ROOT, 'core', 'search', 'sweet-search.js'));
  const s = new SweetSearch({
    graphDbPath: path.join(dataDir, 'code-graph.db'),
    hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(dataDir, 'codebase.db'),
    lateInteractionOptions: { indexPath: path.join(dataDir, 'codebase-late-interaction.db') },
    useLateInteraction: true,
    stage3Candidates: stage3,
    verbose: false,
    timing: false,
  });
  await s.init();
  return s;
}

async function runOne(search, queryObj, k = 100) {
  const start = performance.now();
  const cleaned = cleanQueryText(queryObj.query) || queryObj.query;
  // Match the run_benchmark.js default: graphExpand=none. GenCodeSearchNet
  // is single-function retrieval that does not exercise graph structure;
  // letting expansion fire just adds noise to a stage3 sweep.
  const { results, stats } = await search.search(cleaned, {
    k, mode: 'auto', rerank: true, expand: false, graphExpand: 'none',
  });
  const latencyMs = performance.now() - start;
  return {
    results: results.map(r => ({
      file: r.file || r.metadata?.file || r.filePath || r.path || '',
      name: r.name || r.metadata?.name || r.entityName || '',
      score: r.score || 0,
      type: r.type || r.metadata?.type || '',
    })),
    latencyMs,
    mode: stats?.routing?.mode,
  };
}

async function runStage(search, queries, docIdToFile, k, label, concurrency) {
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(concurrency);
  const evaluated = [];
  let done = 0, errors = 0;
  await Promise.all(queries.map(q =>
    limit(async () => {
      try {
        const r = await runOne(search, q, k);
        const ev = evaluateQuery(q, r.results, docIdToFile);
        ev.latencyMs = r.latencyMs;
        evaluated.push(ev);
      } catch (err) { errors++; }
      done++;
      if (done % 200 === 0 || done === queries.length) {
        process.stdout.write(`\r    [${label}] ${done}/${queries.length}`);
      }
    })
  ));
  process.stdout.write('\n');
  return { evaluated, errors };
}

async function main() {
  const opts = parseArgs();
  console.log('═'.repeat(80));
  console.log('  Stage 3 Candidates Validation — GenCodeSearchNet full profile');
  console.log('═'.repeat(80));
  console.log(`  Dataset:     ${opts.dataset}`);
  console.log(`  Stages:      ${opts.stages.join(', ')}`);
  console.log(`  Max queries: ${opts.maxQueries || 'all'}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log();

  const dataDir = path.join(__dirname, 'data', opts.dataset);
  const corpusDir = path.join(__dirname, 'corpus', opts.dataset);
  const corpus = loadJsonl(path.join(dataDir, 'corpus.jsonl'));
  let queries = loadJsonl(path.join(dataDir, 'queries.jsonl'));
  if (opts.maxQueries > 0) queries = queries.slice(0, opts.maxQueries);
  const docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });
  console.log(`  Corpus: ${corpus.length} docs | Queries: ${queries.length}`);

  const allResults = {};
  for (const stage3 of opts.stages) {
    console.log('\n' + '─'.repeat(80));
    console.log(`  stage3Candidates = ${stage3}`);
    console.log('─'.repeat(80));
    const search = await buildSearch(corpusDir, stage3);

    // Warmup — three queries to seed the LI / embedding caches.
    for (const w of ['warmup query', 'class definition', 'function call']) {
      await search.search(w, { k: 5, mode: 'auto', rerank: true, expand: false }).catch(() => {});
    }

    const { evaluated, errors } = await runStage(
      search, queries, docIdToFile, 100, `s3=${stage3}`, opts.concurrency,
    );

    allResults[stage3] = {
      stage3Candidates: stage3,
      errors,
      count: evaluated.length,
      metrics: computeMetrics(evaluated),
      perLanguage: computePerLanguageMetrics(evaluated),
    };
    // Incremental write: dump partial results after each stage so a later
    // crash doesn't lose hours of completed stages.
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify({
      timestamp: new Date().toISOString(),
      options: opts,
      partial: stage3 !== opts.stages[opts.stages.length - 1],
      results: allResults,
    }, null, 2));
    console.log(`  → checkpoint written (s3=${stage3})`);
    try { await search.close?.(); } catch {}
  }

  // ── Summary ──
  console.log('\n' + '═'.repeat(80));
  console.log('  TOTAL METRICS');
  console.log('═'.repeat(80));
  const fmt = (x) => `${(x * 100).toFixed(2)}%`;
  console.log(
    '  ' + 'stage3'.padEnd(8) +
    'MRR@10'.padStart(10) + 'R@10'.padStart(8) + 'R@20'.padStart(8) +
    'R@50'.padStart(8) + 'R@100'.padStart(9) + 'miss@10'.padStart(10) +
    'p50ms'.padStart(8) + 'p95ms'.padStart(8) + 'errs'.padStart(7)
  );
  console.log('  ' + '-'.repeat(76));
  for (const stage3 of opts.stages) {
    const m = allResults[stage3].metrics;
    console.log(
      '  ' + String(stage3).padEnd(8) +
      fmt(m.mrr_at_10).padStart(10) +
      fmt(m.recall_at_10).padStart(8) +
      fmt(m.recall_at_20).padStart(8) +
      fmt(m.recall_at_50).padStart(8) +
      fmt(m.recall_at_100).padStart(9) +
      fmt(m.gold_missing_top10_rate).padStart(10) +
      `${m.latency_p50_ms.toFixed(0)}`.padStart(8) +
      `${m.latency_p95_ms.toFixed(0)}`.padStart(8) +
      String(allResults[stage3].errors).padStart(7)
    );
  }

  // Per-language breakdown
  console.log('\n' + '═'.repeat(80));
  console.log('  PER-LANGUAGE MRR@10 / R@10');
  console.log('═'.repeat(80));
  const langs = new Set();
  for (const stage3 of opts.stages) {
    for (const l of Object.keys(allResults[stage3].perLanguage)) langs.add(l);
  }
  const langList = [...langs].sort();
  let header = '  ' + 'language'.padEnd(14);
  for (const stage3 of opts.stages) header += `s3=${stage3} mrr/r@10`.padStart(20);
  console.log(header);
  console.log('  ' + '-'.repeat(14 + 20 * opts.stages.length));
  for (const lang of langList) {
    let line = '  ' + lang.padEnd(14);
    for (const stage3 of opts.stages) {
      const lm = allResults[stage3].perLanguage[lang];
      if (!lm) line += '—'.padStart(20);
      else line += `${fmt(lm.mrr_at_10)}/${fmt(lm.recall_at_10)} (n=${lm.count})`.padStart(20);
    }
    console.log(line);
  }

  // Delta vs first (current default)
  const ref = opts.stages[0];
  console.log('\n' + '═'.repeat(80));
  console.log(`  DELTA vs s3=${ref} (pp = percentage points)`);
  console.log('═'.repeat(80));
  for (const stage3 of opts.stages.slice(1)) {
    const a = allResults[stage3].metrics;
    const b = allResults[ref].metrics;
    console.log(`  s3=${stage3}: ` +
      `ΔMRR ${((a.mrr_at_10 - b.mrr_at_10) * 100).toFixed(2)} pp, ` +
      `ΔR@10 ${((a.recall_at_10 - b.recall_at_10) * 100).toFixed(2)} pp, ` +
      `ΔR@50 ${((a.recall_at_50 - b.recall_at_50) * 100).toFixed(2)} pp, ` +
      `ΔR@100 ${((a.recall_at_100 - b.recall_at_100) * 100).toFixed(2)} pp, ` +
      `Δp50 ${(a.latency_p50_ms - b.latency_p50_ms).toFixed(1)} ms`);
    console.log('    per-lang ΔR@10:');
    for (const lang of langList) {
      const al = allResults[stage3].perLanguage[lang];
      const bl = allResults[ref].perLanguage[lang];
      if (!al || !bl) continue;
      console.log(`      ${lang.padEnd(12)} ΔR@10 ${((al.recall_at_10 - bl.recall_at_10) * 100).toFixed(2)} pp, ΔMRR ${((al.mrr_at_10 - bl.mrr_at_10) * 100).toFixed(2)} pp`);
    }
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify({
    timestamp: new Date().toISOString(),
    options: opts,
    results: allResults,
  }, null, 2));
  console.log(`\n  → wrote ${opts.out}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
