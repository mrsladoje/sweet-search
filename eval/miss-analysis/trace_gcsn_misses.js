#!/usr/bin/env node
/**
 * GenCodeSearchNet miss tracer.
 *
 * Runs the dense benchmark profile (graphExpand=none, stage3Candidates=15,
 * useLateInteraction=true, k=100) and records per-query stage evidence so
 * each miss can be classified into a failure bucket.
 *
 * Outputs JSONL (one record per query) plus a baseline JSON summary.
 *
 * For misses (gold not at rank 1), runs a second "no-rerank" pass to
 * disambiguate candidate-generation misses from reranker misses.
 *
 * Usage:
 *   node eval/miss-analysis/trace_gcsn_misses.js --max-queries=200
 *   node eval/miss-analysis/trace_gcsn_misses.js                  # full 6000
 *   node eval/miss-analysis/trace_gcsn_misses.js --concurrency=12 --no-second-pass
 *   node eval/miss-analysis/trace_gcsn_misses.js --language=python
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { loadJsonl } from '../lib/data-loader.js';
import { prepareCorpus } from '../lib/corpus.js';
import { initSearch } from '../lib/indexer.js';
import { evaluateQuery, cleanQueryText } from '../lib/evaluator.js';
import { computeMetrics } from '../lib/metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    maxQueries: 0,
    concurrency: 8,
    k: 100,
    stage3Candidates: 15,
    graphExpand: 'none',
    language: null,                // null = all languages
    secondPass: true,              // run no-rerank pass for misses
    out: path.join(__dirname, 'gencodesearchnet_misses.jsonl'),
    summaryOut: path.join(__dirname, 'gencodesearchnet_summary.md'),
    rawOut: path.join(__dirname, 'gencodesearchnet_records.json'),
    sample: 0,                     // 0 = no sampling, n = first n only
  };
  for (const a of args) {
    if (a.startsWith('--max-queries=')) opts.maxQueries = parseInt(a.split('=')[1]);
    else if (a.startsWith('--concurrency=')) opts.concurrency = parseInt(a.split('=')[1]);
    else if (a.startsWith('--k=')) opts.k = parseInt(a.split('=')[1]);
    else if (a.startsWith('--stage3-candidates=')) opts.stage3Candidates = parseInt(a.split('=')[1]);
    else if (a.startsWith('--graph-expand=')) opts.graphExpand = a.split('=')[1];
    else if (a.startsWith('--language=')) opts.language = a.split('=')[1];
    else if (a === '--no-second-pass') opts.secondPass = false;
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--summary=')) opts.summaryOut = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--sample=')) opts.sample = parseInt(a.split('=')[1]);
  }
  return opts;
}

const SNIPPET_CHARS = 240;
function snip(s, n = SNIPPET_CHARS) {
  if (!s) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}

function rankIn(results, expectedBasenames) {
  for (let i = 0; i < results.length; i++) {
    const f = results[i].file || '';
    if (!f) continue;
    if (expectedBasenames.has(path.basename(f))) return i + 1;
  }
  return -1;
}

async function runOnce(search, query, k, opts = {}) {
  const t0 = performance.now();
  const { results, stats } = await search.search(query, {
    k,
    mode: 'auto',
    rerank: opts.rerank ?? true,
    expand: opts.expand ?? false,
    graphExpand: opts.graphExpand ?? 'none',
    useLateInteraction: opts.useLateInteraction ?? true,
  });
  const latencyMs = performance.now() - t0;
  const enriched = results.map(r => ({
    file: r.file || r.metadata?.file || r.filePath || r.path || '',
    name: r.name || r.metadata?.name || r.entityName || '',
    type: r.type || r.metadata?.type || '',
    score: typeof r.score === 'number' ? r.score : 0,
    startLine: r.metadata?.startLine ?? r.startLine ?? null,
    endLine: r.metadata?.endLine ?? r.endLine ?? null,
  }));
  return { results: enriched, latencyMs, stats };
}

function classifyMiss({ goldRankFinal, goldRankNoRerank, k, stage3Candidates, expected, topResults, query }) {
  // Hit?
  if (goldRankFinal === 1) return 'hit_top1';
  if (goldRankFinal > 0 && goldRankFinal <= 10) return 'hit_top10';

  // No gold file or unindexed corpus → instrumentation/data noise.
  if (!expected || expected.length === 0) return 'wrong_gold_or_ambiguous_label';

  // Final not in top-100 — compare with no-rerank pass.
  if (goldRankFinal < 0) {
    if (goldRankNoRerank == null) return 'gold_not_in_top100_unknown_pass2';
    if (goldRankNoRerank < 0) return 'gold_not_in_top100_candidate_generation';
    if (goldRankNoRerank > k) return 'gold_not_in_top100_candidate_generation';
    if (goldRankNoRerank > stage3Candidates) return 'gold_in_100_but_not_rerank_window';
    return 'reranker_demoted_gold';
  }

  // Gold present in final but ranked >10 (these are not strict misses for MRR@10)
  if (goldRankFinal > 10) {
    if (goldRankNoRerank != null && goldRankNoRerank > 0 && goldRankNoRerank <= 10
        && goldRankFinal > goldRankNoRerank) {
      return 'reranker_demoted_gold';
    }
    return 'gold_present_but_not_top10';
  }
  return 'unknown';
}

function detectQueryShape(query) {
  const q = (query || '').trim();
  // Heuristic: very short / signature-like queries
  if (q.length <= 12) return 'very_short';
  if (/^\w+\s*->\s*\w+/.test(q)) return 'type_signature';
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(q)) return 'title_caps';
  if (q.split(/\s+/).length <= 3) return 'few_words';
  return 'normal';
}

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();

  console.log('='.repeat(70));
  console.log('  GenCodeSearchNet miss tracer (dense profile)');
  console.log('='.repeat(70));
  console.log(`  k=${opts.k}, stage3Candidates=${opts.stage3Candidates}, graphExpand=${opts.graphExpand}`);
  console.log(`  language=${opts.language || 'all'}, max-queries=${opts.maxQueries || 'all'}, concurrency=${opts.concurrency}`);
  console.log(`  second-pass=${opts.secondPass}`);

  const dataDir = path.join(__dirname, '..', 'data', 'gencodesearchnet');
  const corpus = loadJsonl(path.join(dataDir, 'corpus.jsonl'));
  let queries = loadJsonl(path.join(dataDir, 'queries.jsonl'));
  if (opts.language) queries = queries.filter(q => q.language === opts.language);
  if (opts.maxQueries > 0) queries = queries.slice(0, opts.maxQueries);
  if (opts.sample > 0) queries = queries.slice(0, opts.sample);

  console.log(`  Corpus:  ${corpus.length} docs`);
  console.log(`  Queries: ${queries.length}`);

  const corpusDir = path.join(__dirname, '..', 'corpus', 'gencodesearchnet');
  const docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });
  const docIdToDoc = new Map();
  for (const d of corpus) docIdToDoc.set(d.doc_id, d);

  console.log('\n[1/3] Initializing search…');
  const search = await initSearch(corpusDir, PROJECT_ROOT, {
    useLateInteraction: true,
    stage3Candidates: opts.stage3Candidates,
  });

  console.log('\n[2/3] Running queries…');
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(opts.concurrency);

  const records = [];
  let completed = 0;

  await Promise.all(queries.map(q => limit(async () => {
    const cleanQuery = cleanQueryText(q.query) || q.query;

    let runA;
    try {
      runA = await runOnce(search, cleanQuery, opts.k, {
        rerank: true,
        expand: false,
        graphExpand: opts.graphExpand,
        useLateInteraction: true,
      });
    } catch (err) {
      records.push({ queryId: q.query_id, query: q.query, language: q.language, error: err.message });
      completed++;
      return;
    }

    const evaluated = evaluateQuery(q, runA.results, docIdToFile);

    // Expected files (basenames) and ground-truth docs
    const expected = q.relevant_doc_ids.map(docId => {
      const filePath = docIdToFile.get(docId);
      const doc = docIdToDoc.get(docId);
      return {
        docId,
        filePath: filePath || null,
        funcName: doc?.func_name || null,
        repo: doc?.repo || null,
        codeSnippet: snip(doc?.code || '', 320),
        codeLength: doc?.code?.length ?? 0,
      };
    });
    const expectedBasenames = new Set(expected.map(e => e.filePath ? path.basename(e.filePath) : null).filter(Boolean));
    const goldRankFinal = rankIn(runA.results, expectedBasenames);

    let goldRankNoRerank = null;
    let runB = null;
    if (opts.secondPass && goldRankFinal !== 1) {
      try {
        runB = await runOnce(search, cleanQuery, opts.k, {
          rerank: false,                  // disable cascade rerank
          expand: false,
          graphExpand: 'none',
          useLateInteraction: false,      // disable LI rerank
        });
        goldRankNoRerank = rankIn(runB.results, expectedBasenames);
      } catch {
        goldRankNoRerank = null;
      }
    }

    const queryShape = detectQueryShape(q.query);
    const bucket = classifyMiss({
      goldRankFinal,
      goldRankNoRerank,
      k: opts.k,
      stage3Candidates: opts.stage3Candidates,
      expected,
      topResults: runA.results,
      query: q.query,
    });

    records.push({
      queryId: q.query_id,
      query: q.query,
      cleanQuery,
      language: q.language,
      queryShape,
      goldRankFinal,
      goldRankNoRerank,
      goldInTop10: goldRankFinal > 0 && goldRankFinal <= 10,
      goldInTop20: goldRankFinal > 0 && goldRankFinal <= 20,
      goldInTop50: goldRankFinal > 0 && goldRankFinal <= 50,
      goldInTop100: goldRankFinal > 0 && goldRankFinal <= 100,
      bucket,
      latencyMs: runA.latencyMs,
      latencyMsNoRerank: runB?.latencyMs ?? null,
      searchPath: runA.stats?.path,
      searchMode: runA.stats?.routing?.mode,
      cascadeStats: runA.stats?.cascade ? {
        ceInvoked: runA.stats.cascade.ceInvoked,
        ceCandidates: runA.stats.cascade.ceCandidates,
        candidatesIn: runA.stats.cascade.candidatesIn,
        candidatesOut: runA.stats.cascade.candidatesOut,
        gateReason: runA.stats.cascade.gateReason,
      } : null,
      lateInteractionStats: runA.stats?.lateInteraction ? {
        candidates: runA.stats.lateInteraction.candidates,
        expandedInPool: runA.stats.lateInteraction.expandedInPool,
        queryTokens: runA.stats.lateInteraction.queryTokens,
        latency_us: runA.stats.lateInteraction.latency_us,
      } : null,
      stagesSummary: runA.stats?.stages ? {
        binaryCands: runA.stats.stages.binary?.candidates,
        int8Cands: runA.stats.stages.int8?.candidates,
        floatRescoreCands: runA.stats.stages.floatRescore?.candidates,
      } : null,
      expected,
      top10: runA.results.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        file: r.file,
        name: r.name,
        type: r.type,
        score: r.score,
        symbolStartLine: r.startLine,
        symbolEndLine: r.endLine,
      })),
      // Compact rank20-100 for bucket evidence
      tail: runA.results.slice(10, 100).map((r, i) => ({
        rank: i + 11,
        file: r.file,
        name: r.name,
        score: r.score,
      })),
    });

    completed++;
    if (completed % 50 === 0 || completed === queries.length) {
      process.stdout.write(`\r  progress: ${completed}/${queries.length}`);
    }
  })));
  process.stdout.write('\n');

  console.log('\n[3/3] Writing outputs…');

  // Compute aggregate metrics on the surviving records
  const evaluatedQueries = records
    .filter(r => !r.error)
    .map(r => ({
      queryId: r.queryId,
      query: r.query,
      language: r.language,
      // crude rankedRelevance (0/1): 1 at goldRankFinal-1 if hit, else all 0s
      rankedRelevance: (() => {
        const arr = new Array(Math.min(opts.k, 100)).fill(0);
        if (r.goldRankFinal > 0 && r.goldRankFinal <= arr.length) arr[r.goldRankFinal - 1] = 1;
        return arr;
      })(),
      totalRelevant: r.expected.length,
      latencyMs: r.latencyMs,
    }));
  const metrics = computeMetrics(evaluatedQueries);

  // Bucket counts
  const bucketCounts = {};
  const langBucketCounts = {};
  for (const r of records) {
    if (r.error) continue;
    bucketCounts[r.bucket] = (bucketCounts[r.bucket] || 0) + 1;
    langBucketCounts[r.language] = langBucketCounts[r.language] || {};
    langBucketCounts[r.language][r.bucket] = (langBucketCounts[r.language][r.bucket] || 0) + 1;
  }

  // Write JSONL
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const lines = records.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(opts.out, lines + '\n');

  // Raw JSON (handy for downstream summarizer)
  fs.writeFileSync(opts.rawOut, JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      options: opts,
      metrics,
      bucketCounts,
      langBucketCounts,
      total: records.length,
      errors: records.filter(r => r.error).length,
    },
    records,
  }, null, 2));

  // Console summary
  const fmtPct = x => `${(x * 100).toFixed(2)}%`;
  console.log(`\n  Total queries: ${records.length}`);
  console.log(`  MRR@10: ${fmtPct(metrics.mrr_at_10)}  R@10: ${fmtPct(metrics.recall_at_10)}  R@50: ${fmtPct(metrics.recall_at_50)}`);
  console.log(`  Buckets:`);
  for (const [b, n] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${b.padEnd(50)} ${n}`);
  }
  console.log(`  Time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\n  Wrote: ${opts.out}`);
  console.log(`  Wrote: ${opts.rawOut}`);

  try { await search.close?.(); } catch {}
}

main().catch(err => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
