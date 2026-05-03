#!/usr/bin/env node
/**
 * Three-way file-kind ranking comparison on the file-kind guard set.
 *
 * For each guard query we:
 *   1. open the matching repo's existing index
 *   2. run a single search and capture the top-K result list
 *   3. score the gold rank under three rankers:
 *        A. baseline                    (no demotion)
 *        B. blanket demotion            (same factor for all queries)
 *        C. intent-aware ranking        (demotion only when query is implementation-seeking)
 *
 * Compare with the same harness on the existing graph-2hop records (which is
 * an implementation-skewed corpus) so we can see whether intent-aware keeps
 * the implementation-side gain we found earlier without harming docs / test /
 * type guard queries.
 *
 * Outputs:
 *   eval/miss-analysis/file_kind_guard_records.json   raw per-query records
 *   eval/miss-analysis/file_kind_intent_report.md     summary + recommendation
 *
 * Usage:
 *   node eval/miss-analysis/test_file_kind_intent_ranking.js
 *   node eval/miss-analysis/test_file_kind_intent_ranking.js --doc-factor=0.7
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { detectFileKind, classifyQueryIntent, applyFileKindRanking }
  from './file_kind_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    queries: path.join(__dirname, 'file_kind_guard_queries.jsonl'),
    graphRecords: path.join(__dirname, 'graph2hop_records.json'),
    rawOut: path.join(__dirname, 'file_kind_guard_records.json'),
    reportOut: path.join(__dirname, 'file_kind_intent_report.md'),
    docFactor: 0.7,
    testFactor: 0.7,
    typeFactor: 0.7,
    blanketFactor: 0.7,
    k: 50,
  };
  for (const a of args) {
    if (a.startsWith('--queries=')) opts.queries = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--graph-records=')) opts.graphRecords = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--raw=')) opts.rawOut = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--report=')) opts.reportOut = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--doc-factor=')) opts.docFactor = parseFloat(a.split('=')[1]);
    else if (a.startsWith('--test-factor=')) opts.testFactor = parseFloat(a.split('=')[1]);
    else if (a.startsWith('--type-factor=')) opts.typeFactor = parseFloat(a.split('=')[1]);
    else if (a.startsWith('--blanket-factor=')) opts.blanketFactor = parseFloat(a.split('=')[1]);
    else if (a.startsWith('--k=')) opts.k = parseInt(a.split('=')[1]);
  }
  return opts;
}

// ──────────────────────────────────────────────────────────────────────────
// Live search
// ──────────────────────────────────────────────────────────────────────────

async function openSearchForRepo(repoName) {
  const repoRoot = path.join(PROJECT_ROOT, 'eval', 'repos', repoName);
  const ssDir = path.join(repoRoot, '.sweet-search');
  if (!fs.existsSync(path.join(ssDir, 'code-graph.db'))) {
    throw new Error(`Repo ${repoName} not indexed at ${ssDir}`);
  }
  process.env.SWEET_SEARCH_PROJECT_ROOT = repoRoot;
  const { SweetSearch } = await import(path.join(PROJECT_ROOT, 'core', 'search', 'sweet-search.js'));
  const search = new SweetSearch({
    projectRoot: repoRoot,
    graphDbPath: path.join(ssDir, 'code-graph.db'),
    hnswPath: path.join(ssDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(ssDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(ssDir, 'codebase.db'),
    lateInteractionOptions: { indexPath: path.join(ssDir, 'codebase-late-interaction.db') },
    useLateInteraction: true,
    // Guard-set runs use the 2-stage path. Some repos still have stale 768-d
    // float vectors in SQLite that fail Stage 2.5's dimension check; the file-
    // kind-ranking question is independent of which retrieval path runs.
    use3Stage: false,
    verbose: false,
    timing: false,
  });
  await search.init();
  return { search, repoRoot };
}

async function runOneWithRetry(search, query, k) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const t0 = performance.now();
      const { results, stats } = await search.search(query, {
        k, mode: 'auto', rerank: true, expand: true, graphExpand: '2hop', adaptiveHop2: true,
      });
      const enriched = results.map(r => ({
        file: r.file || r.file_path || r.metadata?.file || '',
        name: r.name || r.metadata?.name || '',
        score: typeof r.score === 'number' ? r.score : 0,
        is_expanded: !!r.is_expanded,
      }));
      return { results: enriched, stats, latencyMs: performance.now() - t0 };
    } catch (err) {
      lastErr = err;
      if (!/slice is not a function|cannot read|undefined/.test(err.message)) break;
      await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ──────────────────────────────────────────────────────────────────────────
// Gold matching (handles paths or basenames)
// ──────────────────────────────────────────────────────────────────────────

function goldRank(results, goldPaths, repoRoot) {
  const goldBase = new Set(goldPaths.map(g => path.basename(g)));
  const norm = (p) => p.replace(repoRoot, '').replace(/^\//, '').replace(/^eval\/repos\/[^/]+\//, '');
  for (let i = 0; i < results.length; i++) {
    const f = results[i].file || '';
    if (!f) continue;
    const r = norm(f);
    for (const g of goldPaths) {
      if (r === g || r.endsWith('/' + g) || g.endsWith('/' + r)) return i + 1;
    }
    if (goldBase.has(path.basename(f))) return i + 1;
  }
  return -1;
}

// ──────────────────────────────────────────────────────────────────────────
// Three rankers (offline rerank applied to the result list)
// ──────────────────────────────────────────────────────────────────────────

function rankerBaseline(results /* , query, opts */) {
  return [...results];
}

function rankerBlanket(results, _query, opts) {
  // Demote ALL doc/test/type results regardless of intent.
  const reranked = results.map(r => {
    const kind = detectFileKind(r.file);
    const mult = kind === 'docs' || kind === 'tests' || kind === 'types' ? opts.blanketFactor : 1;
    return { ...r, score: (r.score || 0) * mult };
  });
  reranked.sort((a, b) => (b.score || 0) - (a.score || 0));
  return reranked;
}

function rankerIntentAware(results, query, opts) {
  return applyFileKindRanking(results, {
    intent: classifyQueryIntent(query),
    docFactor: opts.docFactor,
    testFactor: opts.testFactor,
    typeFactor: opts.typeFactor,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

function fmtPct(x) { return `${(x * 100).toFixed(2)}%`; }

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();
  console.log('='.repeat(72));
  console.log('  File-kind intent-aware ranking — three-way comparison');
  console.log('='.repeat(72));
  console.log(`  guard queries:     ${opts.queries}`);
  console.log(`  graph records:     ${opts.graphRecords}`);
  console.log(`  factors: doc=${opts.docFactor} test=${opts.testFactor} type=${opts.typeFactor}  blanket=${opts.blanketFactor}`);

  const queries = fs.readFileSync(opts.queries, 'utf-8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const byRepo = {};
  for (const q of queries) (byRepo[q.repo] = byRepo[q.repo] || []).push(q);

  const records = [];

  for (const repo of Object.keys(byRepo)) {
    console.log(`\n— Repo: ${repo} (${byRepo[repo].length} queries)`);
    let h;
    try { h = await openSearchForRepo(repo); }
    catch (err) { console.error(`SKIP ${repo}: ${err.message}`); continue; }
    const { search, repoRoot } = h;

    // Robust warmup: target 3 consecutive successful runs.
    const warmups = ['warmup query', 'find a function', 'class definition', 'route handler', 'data parser', 'serialize body', 'parse json'];
    let consec = 0; let attempts = 0;
    while (consec < 3 && attempts < 25) {
      try {
        await search.search(warmups[attempts % warmups.length], { k: 3, mode: 'auto', rerank: true, expand: attempts % 2 === 0 });
        consec++;
      } catch { consec = 0; }
      attempts++;
    }

    let done = 0;
    for (const q of byRepo[repo]) {
      let res;
      try {
        res = await runOneWithRetry(search, q.query, opts.k);
      } catch (err) {
        records.push({ ...q, error: err.message });
        done++;
        continue;
      }

      // Apply each ranker offline.
      const base = rankerBaseline(res.results, q.query, opts);
      const blanket = rankerBlanket(res.results, q.query, opts);
      const intentAware = rankerIntentAware(res.results, q.query, opts);

      records.push({
        id: q.id,
        repo: q.repo,
        intent: q.intent,
        query: q.query,
        gold_files: q.gold_files,
        notes: q.notes,
        rankBaseline:    goldRank(base,        q.gold_files, repoRoot),
        rankBlanket:     goldRank(blanket,     q.gold_files, repoRoot),
        rankIntentAware: goldRank(intentAware, q.gold_files, repoRoot),
        top5Baseline:    base.slice(0, 5).map(r => ({ file: r.file, score: r.score })),
        top5Blanket:     blanket.slice(0, 5).map(r => ({ file: r.file, score: r.score })),
        top5IntentAware: intentAware.slice(0, 5).map(r => ({ file: r.file, score: r.score })),
        latencyMs: res.latencyMs,
      });

      done++;
      if (done % 10 === 0 || done === byRepo[repo].length) {
        process.stdout.write(`\r    progress: ${done}/${byRepo[repo].length}`);
      }
    }
    process.stdout.write('\n');
    try { await search.close?.(); } catch {}
  }

  // ── Apply intent-aware to graph-2hop records (which carry topExpand[]) ──
  // We do NOT re-run search there; we just rerank the existing top-10 lists.
  let graphMetrics = null;
  if (fs.existsSync(opts.graphRecords)) {
    const data = JSON.parse(fs.readFileSync(opts.graphRecords, 'utf-8'));
    const grec = (data.records || []).filter(r => !r.error_none && !r.error_expand && (r.goldFiles || []).length);
    let baseR1=0, baseR10=0, blanR1=0, blanR10=0, intR1=0, intR10=0;
    let baseMRR=0, blanMRR=0, intMRR=0;
    let blanHarm=0, intHarm=0;
    let blanRescue=0, intRescue=0;
    for (const r of grec) {
      const top10 = r.topExpand || [];
      const goldBase = new Set((r.goldFiles || []).map(p => path.basename(p)));
      const rank = (list) => {
        for (let i = 0; i < list.length; i++) {
          if (list[i].file && goldBase.has(path.basename(list[i].file))) return i + 1;
        }
        return -1;
      };
      const base = rankerBaseline(top10, r.query, opts);
      const blan = rankerBlanket(top10, r.query, opts);
      const intA = rankerIntentAware(top10, r.query, opts);
      const rB = rank(base), rBl = rank(blan), rI = rank(intA);
      if (rB > 0 && rB <= 1) baseR1++;
      if (rB > 0 && rB <= 10) baseR10++;
      if (rBl > 0 && rBl <= 1) blanR1++;
      if (rBl > 0 && rBl <= 10) blanR10++;
      if (rI > 0 && rI <= 1) intR1++;
      if (rI > 0 && rI <= 10) intR10++;
      baseMRR += rB > 0 && rB <= 10 ? 1/rB : 0;
      blanMRR += rBl > 0 && rBl <= 10 ? 1/rBl : 0;
      intMRR  += rI > 0 && rI <= 10 ? 1/rI : 0;
      const inB  = rB  > 0 && rB  <= 10;
      const inBl = rBl > 0 && rBl <= 10;
      const inI  = rI  > 0 && rI  <= 10;
      if (inBl && !inB) blanRescue++; if (!inBl && inB) blanHarm++;
      if (inI  && !inB) intRescue++;  if (!inI  && inB) intHarm++;
    }
    graphMetrics = {
      n: grec.length,
      baseline:    { r1: baseR1/grec.length, r10: baseR10/grec.length, mrr: baseMRR/grec.length },
      blanket:     { r1: blanR1/grec.length, r10: blanR10/grec.length, mrr: blanMRR/grec.length, rescue: blanRescue, harm: blanHarm },
      intentAware: { r1: intR1/grec.length,  r10: intR10/grec.length,  mrr: intMRR/grec.length,  rescue: intRescue,  harm: intHarm  },
    };
  }

  // ── Aggregate guard metrics ──
  const ok = records.filter(r => !r.error);
  function intentStats(intent) {
    const subset = ok.filter(r => r.intent === intent);
    const n = subset.length;
    if (n === 0) return null;
    const stat = (rs) => ({
      r1:  subset.filter(r => r[rs] > 0 && r[rs] <= 1).length / n,
      r10: subset.filter(r => r[rs] > 0 && r[rs] <= 10).length / n,
      mean_rank: subset.filter(r => r[rs] > 0).reduce((s, r) => s + r[rs], 0) / Math.max(1, subset.filter(r => r[rs] > 0).length),
    });
    return {
      n,
      baseline:    stat('rankBaseline'),
      blanket:     stat('rankBlanket'),
      intentAware: stat('rankIntentAware'),
    };
  }
  const guardMetrics = {
    implementation: intentStats('implementation'),
    docs:           intentStats('docs'),
    tests:          intentStats('tests'),
    types:          intentStats('types'),
  };

  // Identify harmed-by-blanket guard queries (top-10 baseline lost under blanket but kept under intent-aware)
  const blanketHarms = ok.filter(r =>
    r.rankBaseline > 0 && r.rankBaseline <= 10 &&
    !(r.rankBlanket > 0 && r.rankBlanket <= 10)
  );
  const intentHarms = ok.filter(r =>
    r.rankBaseline > 0 && r.rankBaseline <= 10 &&
    !(r.rankIntentAware > 0 && r.rankIntentAware <= 10)
  );
  const blanketImpHits = ok.filter(r => r.intent === 'implementation' && r.rankBaseline > 0 && r.rankBaseline > 1 && r.rankBlanket === 1);
  const intentImpHits  = ok.filter(r => r.intent === 'implementation' && r.rankBaseline > 0 && r.rankBaseline > 1 && r.rankIntentAware === 1);

  // ── Write outputs ──
  fs.writeFileSync(opts.rawOut, JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      options: opts,
      graphMetrics,
      guardMetrics,
      blanketHarmsCount: blanketHarms.length,
      intentHarmsCount: intentHarms.length,
    },
    records,
  }, null, 2));

  // Markdown
  const lines = [];
  lines.push('# File-kind intent-aware ranking — validation report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Factors: doc=${opts.docFactor}, test=${opts.testFactor}, type=${opts.typeFactor} (intent-aware) ; blanket=${opts.blanketFactor}`);
  lines.push('');
  lines.push('## Guard set (live search)');
  lines.push('');
  lines.push(`Total: ${records.length} records  errors: ${records.filter(r => r.error).length}`);
  for (const intent of ['implementation', 'docs', 'tests', 'types']) {
    const m = guardMetrics[intent];
    if (!m) continue;
    lines.push('');
    lines.push(`### ${intent} (n=${m.n})`);
    lines.push('');
    lines.push('| ranker | R@1 | R@10 |');
    lines.push('|---|---:|---:|');
    lines.push(`| baseline       | ${fmtPct(m.baseline.r1)} | ${fmtPct(m.baseline.r10)} |`);
    lines.push(`| blanket demote | ${fmtPct(m.blanket.r1)} | ${fmtPct(m.blanket.r10)} |`);
    lines.push(`| intent-aware   | ${fmtPct(m.intentAware.r1)} | ${fmtPct(m.intentAware.r10)} |`);
  }
  lines.push('');
  lines.push('### Blanket-vs-intent-aware harm summary');
  lines.push('');
  lines.push(`Guard queries that lost their top-10 hit under blanket demotion: **${blanketHarms.length}**`);
  lines.push(`Guard queries that lost their top-10 hit under intent-aware ranking: **${intentHarms.length}**`);
  lines.push(`Implementation queries newly at rank 1 under blanket: **${blanketImpHits.length}**`);
  lines.push(`Implementation queries newly at rank 1 under intent-aware: **${intentImpHits.length}**`);
  lines.push('');

  if (blanketHarms.length > 0) {
    lines.push('### Examples of blanket-demote harm (resolved under intent-aware)');
    lines.push('');
    let shown = 0;
    for (const r of blanketHarms) {
      if (r.rankIntentAware > 0 && r.rankIntentAware <= 10) {
        lines.push(`- \`${r.id}\` (${r.repo}, **${r.intent}**) baseline=${r.rankBaseline} → blanket=${r.rankBlanket} → intent-aware=${r.rankIntentAware}`);
        lines.push(`  - query: *"${r.query.slice(0, 100)}"*`);
        if (++shown >= 8) break;
      }
    }
    lines.push('');
  }

  if (graphMetrics) {
    lines.push('## Graph-2hop benchmark (offline rerank of cached top-10)');
    lines.push('');
    lines.push(`n = ${graphMetrics.n}`);
    lines.push('');
    lines.push('| ranker | R@1 | R@10 | MRR@10 | rescue | harm |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    lines.push(`| baseline    | ${fmtPct(graphMetrics.baseline.r1)} | ${fmtPct(graphMetrics.baseline.r10)} | ${fmtPct(graphMetrics.baseline.mrr)} | — | — |`);
    lines.push(`| blanket     | ${fmtPct(graphMetrics.blanket.r1)} | ${fmtPct(graphMetrics.blanket.r10)} | ${fmtPct(graphMetrics.blanket.mrr)} | ${graphMetrics.blanket.rescue} | ${graphMetrics.blanket.harm} |`);
    lines.push(`| intent-aware| ${fmtPct(graphMetrics.intentAware.r1)} | ${fmtPct(graphMetrics.intentAware.r10)} | ${fmtPct(graphMetrics.intentAware.mrr)} | ${graphMetrics.intentAware.rescue} | ${graphMetrics.intentAware.harm} |`);
    lines.push('');
  }

  lines.push('## Decision criteria');
  lines.push('');
  lines.push('Intent-aware ranking is acceptable for production iff ALL of:');
  lines.push('1. Implementation guard R@1 lifts toward blanket\'s number (≥80% of the gain).');
  lines.push('2. Docs / tests / types guard R@10 not worse than baseline.');
  lines.push('3. Graph-2hop R@1 lift is preserved (close to blanket\'s number).');
  lines.push('4. Graph-2hop harm@10 ≤ blanket\'s harm.');
  lines.push('');

  fs.writeFileSync(opts.reportOut, lines.join('\n'));

  console.log(`\n  wrote ${opts.reportOut}`);
  console.log(`  wrote ${opts.rawOut}`);
  console.log(`\nGuard summary:`);
  for (const intent of ['implementation', 'docs', 'tests', 'types']) {
    const m = guardMetrics[intent];
    if (!m) continue;
    console.log(`  ${intent.padEnd(15)} (n=${m.n})  base R@1 ${fmtPct(m.baseline.r1)}  blanket R@1 ${fmtPct(m.blanket.r1)}  intent-aware R@1 ${fmtPct(m.intentAware.r1)}`);
  }
  if (graphMetrics) {
    console.log(`\nGraph-2hop:`);
    console.log(`  baseline    R@1 ${fmtPct(graphMetrics.baseline.r1)}  R@10 ${fmtPct(graphMetrics.baseline.r10)}`);
    console.log(`  blanket     R@1 ${fmtPct(graphMetrics.blanket.r1)}  R@10 ${fmtPct(graphMetrics.blanket.r10)}  rescue=${graphMetrics.blanket.rescue} harm=${graphMetrics.blanket.harm}`);
    console.log(`  intent-aware R@1 ${fmtPct(graphMetrics.intentAware.r1)} R@10 ${fmtPct(graphMetrics.intentAware.r10)}  rescue=${graphMetrics.intentAware.rescue} harm=${graphMetrics.intentAware.harm}`);
  }
  console.log(`\nblanket harms: ${blanketHarms.length}, intent-aware harms: ${intentHarms.length}`);
  console.log(`Time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });
