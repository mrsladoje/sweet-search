#!/usr/bin/env node

/**
 * JS-only gencodesearchnet benchmark with full miss capture.
 *
 * Reuses the existing index at eval/corpus/gencodesearchnet/.sweet-search/.
 * For every JS query, records top-10 results (file, score, content snippet)
 * and the expected file (path + ground-truth code body) so that downstream
 * analysis can reason about chunk context bleeding.
 *
 * Output: eval/results/js-misses-<timestamp>.json
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadJsonl } from './lib/data-loader.js';
import { computeMetrics } from './lib/metrics.js';
import { prepareCorpus } from './lib/corpus.js';
import { initSearch } from './lib/indexer.js';
import { evaluateQuery, cleanQueryText } from './lib/evaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SNIPPET_CHARS = 400;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { maxQueries: 0, concurrency: 8, k: 10, language: 'javascript' };
  for (const arg of args) {
    if (arg.startsWith('--max-queries=')) opts.maxQueries = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--k=')) opts.k = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--language=')) opts.language = arg.split('=')[1];
  }
  return opts;
}

function snippet(text, n = SNIPPET_CHARS) {
  if (!text) return '';
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}

async function runQueryRich(search, query, k) {
  const start = performance.now();
  const { results, stats } = await search.search(query, { k, mode: 'auto', rerank: true, expand: true });
  const latencyMs = performance.now() - start;
  const enriched = results.map(r => ({
    file: r.file || r.metadata?.file || r.filePath || r.path || '',
    name: r.name || r.metadata?.name || r.entityName || '',
    type: r.type || r.metadata?.type || '',
    score: typeof r.score === 'number' ? r.score : 0,
    startLine: r.metadata?.startLine ?? r.startLine ?? null,
    endLine: r.metadata?.endLine ?? r.endLine ?? null,
    contentSnippet: snippet(r.text || r.content || r.metadata?.content || ''),
  }));
  return {
    results: enriched,
    latencyMs,
    mode: stats?.routing?.mode || 'auto',
    routingConfidence: stats?.routing?.confidence ?? null,
  };
}

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();

  console.log('═'.repeat(70));
  console.log('  JS-only gencodesearchnet miss capture');
  console.log('═'.repeat(70));
  console.log(`  Language:    ${opts.language}`);
  console.log(`  Max queries: ${opts.maxQueries || 'all'}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log(`  Top-K:       ${opts.k}`);

  const dataDir = path.join(__dirname, 'data', 'gencodesearchnet');
  const corpusFile = path.join(dataDir, 'corpus.jsonl');
  const queriesFile = path.join(dataDir, 'queries.jsonl');

  console.log('\n[1/4] Loading data and filtering to language…');
  const corpus = loadJsonl(corpusFile);
  let queries = loadJsonl(queriesFile).filter(q => q.language === opts.language);
  if (opts.maxQueries > 0) queries = queries.slice(0, opts.maxQueries);
  console.log(`  Corpus:  ${corpus.length} docs (across all languages)`);
  console.log(`  Queries: ${queries.length} (${opts.language} only)`);

  const corpusDir = path.join(__dirname, 'corpus', 'gencodesearchnet');
  const docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });

  // Build doc_id -> { code, func_name, repo, file } from corpus
  const docIdToDoc = new Map();
  for (const doc of corpus) docIdToDoc.set(doc.doc_id, doc);

  console.log('\n[2/4] Initializing Sweet Search…');
  const search = await initSearch(corpusDir, PROJECT_ROOT, { useLateInteraction: true });

  console.log('\n[3/4] Running queries…');
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(opts.concurrency);

  const records = [];
  let completed = 0;

  await Promise.all(queries.map(q => limit(async () => {
    const cleanQuery = cleanQueryText(q.query) || q.query;
    let runRes;
    try {
      runRes = await runQueryRich(search, cleanQuery, opts.k);
    } catch (err) {
      records.push({ queryId: q.query_id, query: q.query, error: err.message });
      completed++;
      return;
    }

    const evaluated = evaluateQuery(q, runRes.results, docIdToFile);

    // Determine expected files (from relevant_doc_ids) and their ground-truth code.
    const expected = q.relevant_doc_ids.map(docId => {
      const filePath = docIdToFile.get(docId);
      const doc = docIdToDoc.get(docId);
      return {
        docId,
        filePath: filePath || null,
        funcName: doc?.func_name || null,
        repo: doc?.repo || null,
        codeSnippet: snippet(doc?.code || '', 800),
        codeLength: doc?.code?.length ?? 0,
      };
    });

    // Find expected-file rank within top-K
    const expectedBasenames = new Set(expected.map(e => e.filePath ? path.basename(e.filePath) : null).filter(Boolean));
    let expectedRank = -1;
    for (let i = 0; i < runRes.results.length; i++) {
      const f = runRes.results[i].file;
      if (!f) continue;
      const base = path.basename(f);
      if (expectedBasenames.has(base)) { expectedRank = i + 1; break; }
    }

    records.push({
      queryId: q.query_id,
      query: q.query,
      cleanQuery,
      mode: runRes.mode,
      routingConfidence: runRes.routingConfidence,
      latencyMs: runRes.latencyMs,
      expectedRank,                        // 1-based rank, -1 if outside top-K
      rankedRelevance: evaluated.rankedRelevance,
      expected,
      topResults: runRes.results,
    });

    completed++;
    if (completed % 50 === 0 || completed === queries.length) {
      console.log(`  Progress: ${completed}/${queries.length}`);
    }
  })));

  console.log('\n[4/4] Computing metrics…');
  const evaluatedQueries = records
    .filter(r => !r.error)
    .map(r => ({
      queryId: r.queryId,
      query: r.query,
      language: opts.language,
      rankedRelevance: r.rankedRelevance,
      totalRelevant: r.expected.length,
      latencyMs: r.latencyMs,
    }));
  const metrics = computeMetrics(evaluatedQueries);

  // Bucket misses
  const top1Hits = records.filter(r => r.expectedRank === 1).length;
  const top5Hits = records.filter(r => r.expectedRank > 0 && r.expectedRank <= 5).length;
  const top10Hits = records.filter(r => r.expectedRank > 0 && r.expectedRank <= 10).length;
  const outsideTopK = records.filter(r => r.expectedRank === -1).length;

  console.log('');
  console.log(`  Total queries:     ${records.length}`);
  console.log(`  MRR@10:            ${(metrics.mrr_at_10 * 100).toFixed(2)}%`);
  console.log(`  NDCG@10:           ${(metrics.ndcg_at_10 * 100).toFixed(2)}%`);
  console.log(`  Recall@5:          ${(metrics.recall_at_5 * 100).toFixed(2)}%`);
  console.log(`  Recall@10:         ${(metrics.recall_at_10 * 100).toFixed(2)}%`);
  console.log(`  Top-1 hits:        ${top1Hits} (${(100 * top1Hits / records.length).toFixed(1)}%)`);
  console.log(`  Top-5 hits:        ${top5Hits}`);
  console.log(`  Top-10 hits:       ${top10Hits}`);
  console.log(`  Outside top-${opts.k}:    ${outsideTopK}`);
  console.log(`  Total time:        ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const resultsDir = path.join(__dirname, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(resultsDir, `js-misses-${stamp}.json`);
  writeFileSync(out, JSON.stringify({
    meta: {
      language: opts.language,
      queryCount: records.length,
      topK: opts.k,
      generatedAt: new Date().toISOString(),
      metrics,
      buckets: { top1Hits, top5Hits, top10Hits, outsideTopK },
    },
    records,
  }, null, 2));
  console.log(`\n  Wrote: ${out}`);

  // Convenience: write a misses-only file (rank != 1)
  const missesOnly = records.filter(r => r.expectedRank !== 1);
  const missOut = path.join(resultsDir, `js-misses-only-${stamp}.json`);
  writeFileSync(missOut, JSON.stringify({
    meta: { count: missesOnly.length, total: records.length, generatedAt: new Date().toISOString() },
    misses: missesOnly,
  }, null, 2));
  console.log(`  Wrote: ${missOut}`);
}

main().catch(err => { console.error(err); process.exit(1); });
