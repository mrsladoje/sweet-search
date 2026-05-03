#!/usr/bin/env node
/**
 * Graph-2hop miss tracer.
 *
 * Runs the 300-query graph benchmark on real repos under two modes:
 *   - mode A: graphExpand='none', expand=false      (no graph)
 *   - mode B: graphExpand='2hop',  adaptiveHop2=true, expand=true (production)
 *
 * For each query:
 *   - records gold rank in both modes (1-indexed; null if absent in top-k)
 *   - whether expansion rescued / harmed
 *   - whether the gold result row carries is_expanded:true (meaning graph
 *     expansion is the reason the gold survives)
 *   - graph expansion stats from sweet-search (mode, expanded count, LI pool)
 *   - top-10 file lists for both modes for forensic review
 *
 * Buckets each "miss" (gold not in top-10 under production mode B) into:
 *   graph_seed_missing                — gold absent in mode A AND in mode B (seed never reached gold neighborhood)
 *   graph_edge_missing                — gold absent in mode A, present in mode B's expanded pool but >10
 *                                        (expansion knew about gold but reranker / seed similarity didn't)
 *   graph_added_gold_but_reranker_lost — gold appears in mode B as is_expanded but rank > 10
 *   graph_added_wrong_neighbor        — top-1 in mode B is is_expanded but is NOT gold
 *   gold_present_without_graph_but_expansion_harmed — gold in mode A top-10 but mode B top-10 misses it
 *   query_label_ambiguous             — multiple gold candidates, only one gold_files entry
 *   benchmark_query_bad               — gold file does not exist in repo
 *   relation_type_not_extracted       — same as graph_edge_missing but flagged when expanded count==0
 *   chunk_entity_bridge_failure       — expandedWithLiChunk == 0 but expanded > 0
 *   hit_top10                         — gold in mode B top-10 (not a miss)
 *
 * Output:
 *   eval/miss-analysis/graph2hop_misses.jsonl
 *   eval/miss-analysis/graph2hop_records.json
 *
 * Usage:
 *   node eval/miss-analysis/trace_graph2hop_misses.js
 *   node eval/miss-analysis/trace_graph2hop_misses.js --repos=fastify
 *   node eval/miss-analysis/trace_graph2hop_misses.js --max=50
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repos: ['fastify', 'flask', 'ripgrep'],
    queriesFile: path.join(__dirname, '..', 'graph-2hop', 'queries.jsonl'),
    max: 0,
    k: 100,
    out: path.join(__dirname, 'graph2hop_misses.jsonl'),
    rawOut: path.join(__dirname, 'graph2hop_records.json'),
    warmup: true,
    verbose: false,
  };
  for (const a of args) {
    if (a.startsWith('--repos=')) opts.repos = a.split('=')[1].split(',');
    else if (a.startsWith('--queries=')) opts.queriesFile = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--max=')) opts.max = parseInt(a.split('=')[1]);
    else if (a.startsWith('--k=')) opts.k = parseInt(a.split('=')[1]);
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--raw=')) opts.rawOut = path.resolve(a.split('=')[1]);
    else if (a === '--no-warmup') opts.warmup = false;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
  }
  return opts;
}

const MODES = {
  none:           { graphExpand: 'none', expand: false },
  '2hop-adaptive':{ graphExpand: '2hop',  adaptiveHop2: true,  expand: true },
};

function loadJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`queries file not found: ${file}`);
  return fs.readFileSync(file, 'utf-8')
    .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

function fileMatches(resultPath, goldPaths, repoRoot) {
  if (!resultPath) return false;
  const norm = (p) => p
    .replace(repoRoot, '')
    .replace(/^\//, '')
    .replace(/^eval\/repos\/[^/]+\//, '');
  const r = norm(resultPath);
  for (const g of goldPaths) {
    const gn = norm(g);
    if (r === gn) return true;
    if (r.endsWith('/' + gn) || gn.endsWith('/' + r)) return true;
    if (path.basename(r) === path.basename(gn)) return true;
  }
  return false;
}

function findGoldRank(results, goldPaths, repoRoot) {
  for (let i = 0; i < results.length; i++) {
    const f = results[i].file || results[i].file_path || results[i].metadata?.file || '';
    if (fileMatches(f, goldPaths, repoRoot)) return i + 1;
  }
  return -1;
}

async function runOne(search, query, modeOpts, k) {
  const t0 = performance.now();
  const { results, stats } = await search.search(query, {
    k, mode: 'auto', rerank: true, ...modeOpts,
  });
  const latencyMs = performance.now() - t0;
  const enriched = results.map(r => ({
    file: r.file || r.file_path || r.metadata?.file || '',
    name: r.name || r.metadata?.name || '',
    score: r.score || 0,
    is_expanded: !!r.is_expanded,
    hops: r.expansion?.hops || 0,
    via: r.expansion?.via || null,
  }));
  return { results: enriched, latencyMs, stats };
}

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
    use3Stage: false,
    verbose: false,
    timing: false,
  });
  await search.init();
  return { search, repoRoot };
}

function classifyMiss({ rankNone, rankExpand, expandResults, expandStats, query }) {
  const expandTop10 = expandResults.slice(0, 10);
  const goldRowExpand = rankExpand > 0 ? expandResults[rankExpand - 1] : null;
  const expandedTotal = expandStats?.graphExpansion?.expanded ?? 0;
  const expandedWithLiChunk = expandStats?.graphExpansion?.expandedWithLiChunk ?? 0;
  const expansionMode = expandStats?.graphExpansion?.mode || 'none';

  // Mode B hit?
  if (rankExpand > 0 && rankExpand <= 10) return 'hit_top10';

  // Mode B miss but mode A hit → expansion harmed
  if (rankExpand <= 0 || rankExpand > 10) {
    if (rankNone > 0 && rankNone <= 10) return 'gold_present_without_graph_but_expansion_harmed';
  }

  // Bridge failure: expansion ran but no expanded entries got LI chunk attached
  if (expandedTotal > 0 && expandedWithLiChunk === 0) return 'chunk_entity_bridge_failure';

  // No expansion happened at all
  if (expandedTotal === 0 && expansionMode === 'none') {
    return 'graph_seed_missing';
  }

  // Gold appears in expand top-100 with is_expanded:true but didn't break top10
  if (rankExpand > 10 && goldRowExpand?.is_expanded) {
    return 'graph_added_gold_but_reranker_lost';
  }

  // Gold not in top-100 of expand mode AND not in top-100 of none mode → seed reached neither
  if (rankExpand <= 0 && rankNone <= 0) return 'graph_seed_missing';

  // Gold in expand >10, not is_expanded → expansion didn't help; rerank or seed
  if (rankExpand > 10 && !goldRowExpand?.is_expanded) {
    if (rankNone <= 0) return 'graph_edge_missing';
    return 'reranker_demoted_gold';
  }

  // Mode B has no gold in top-100 but expansion ran
  if (rankExpand <= 0 && expandedTotal > 0) return 'graph_edge_missing';

  // Mode B miss with no expanded contributions, gold was reachable in mode A
  // beyond top-10. Either expansion ran but produced no useful expanded entries
  // (adaptive gate suppressed), or the only difference is post-rerank jitter.
  if (rankExpand <= 0 && rankNone > 0) return 'mode_b_pushed_gold_off';
  if (rankExpand > 10 && rankNone > 10) return 'graph_edge_missing';

  return 'unknown';
}

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();

  console.log('='.repeat(70));
  console.log('  Graph-2hop miss tracer');
  console.log('='.repeat(70));
  console.log(`  repos: ${opts.repos.join(',')}  max: ${opts.max || 'all'}  k: ${opts.k}`);

  const allQueries = loadJsonl(opts.queriesFile);
  const queriesByRepo = {};
  for (const q of allQueries) {
    if (!opts.repos.includes(q.repo)) continue;
    (queriesByRepo[q.repo] = queriesByRepo[q.repo] || []).push(q);
  }
  if (opts.max > 0) {
    for (const r of Object.keys(queriesByRepo)) queriesByRepo[r] = queriesByRepo[r].slice(0, opts.max);
  }
  const total = Object.values(queriesByRepo).reduce((s, q) => s + q.length, 0);
  if (total === 0) { console.error('No queries.'); process.exit(1); }

  const records = [];

  for (const repo of Object.keys(queriesByRepo)) {
    console.log(`\n— Repo: ${repo} (${queriesByRepo[repo].length} queries)`);
    let h;
    try { h = await openSearchForRepo(repo); }
    catch (err) { console.error(`SKIP ${repo}: ${err.message}`); continue; }
    const { search, repoRoot } = h;

    if (opts.warmup) {
      for (const w of ['warmup query', 'find a function', 'class definition']) {
        await search.search(w, { k: 5, mode: 'auto', rerank: true, expand: false }).catch(() => {});
      }
    }

    let done = 0;
    for (const q of queriesByRepo[repo]) {
      let runNone, runExpand;
      try {
        runNone = await runOne(search, q.query, MODES.none, opts.k);
      } catch (err) {
        records.push({ id: q.id, repo, query: q.query, error_none: err.message });
        done++;
        continue;
      }
      try {
        runExpand = await runOne(search, q.query, MODES['2hop-adaptive'], opts.k);
      } catch (err) {
        records.push({ id: q.id, repo, query: q.query, error_expand: err.message });
        done++;
        continue;
      }

      const rankNone = findGoldRank(runNone.results, q.gold_files, repoRoot);
      const rankExpand = findGoldRank(runExpand.results, q.gold_files, repoRoot);
      const goldRowExpand = rankExpand > 0 ? runExpand.results[rankExpand - 1] : null;

      const bucket = classifyMiss({
        rankNone, rankExpand,
        expandResults: runExpand.results,
        expandStats: runExpand.stats,
        query: q.query,
      });

      const expandedInTop10 = runExpand.results.slice(0, 10).filter(r => r.is_expanded).length;

      records.push({
        id: q.id,
        repo,
        query: q.query,
        category: q.category,
        expectedHops: q.expected_hops,
        goldFiles: q.gold_files,
        goldSymbols: q.gold_symbols,

        rankNone,
        rankExpand,
        bucket,
        rescue: rankExpand > 0 && rankExpand <= 10 && (rankNone <= 0 || rankNone > 10),
        harm:   rankNone   > 0 && rankNone   <= 10 && (rankExpand <= 0 || rankExpand > 10),
        goldAddedByExpansion: !!goldRowExpand?.is_expanded,
        goldHops: goldRowExpand?.hops ?? null,
        goldVia: goldRowExpand?.via ?? null,

        latencyNoneMs:   runNone.latencyMs,
        latencyExpandMs: runExpand.latencyMs,

        graphExpansion: runExpand.stats?.graphExpansion ? {
          mode: runExpand.stats.graphExpansion.mode,
          total: runExpand.stats.graphExpansion.total,
          expanded: runExpand.stats.graphExpansion.expanded,
          expandedWithLiChunk: runExpand.stats.graphExpansion.expandedWithLiChunk,
          latency_ms: runExpand.stats.graphExpansion.latency_ms,
        } : null,
        liStatsExpand: runExpand.stats?.lateInteraction ? {
          candidates: runExpand.stats.lateInteraction.candidates,
          expandedInPool: runExpand.stats.lateInteraction.expandedInPool,
        } : null,
        cascadeStatsExpand: runExpand.stats?.cascade ? {
          ceInvoked: runExpand.stats.cascade.ceInvoked,
          ceCandidates: runExpand.stats.cascade.ceCandidates,
          gateReason: runExpand.stats.cascade.gateReason,
        } : null,
        searchPath: runExpand.stats?.path,

        expandedInTop10,

        topNone:   runNone.results.slice(0, 10).map(r => ({ file: r.file, name: r.name, score: r.score, is_expanded: r.is_expanded })),
        topExpand: runExpand.results.slice(0, 10).map(r => ({
          file: r.file, name: r.name, score: r.score,
          is_expanded: r.is_expanded, hops: r.hops, via: r.via,
        })),
      });

      done++;
      if (done % 20 === 0 || done === queriesByRepo[repo].length) {
        process.stdout.write(`\r    progress: ${done}/${queriesByRepo[repo].length}`);
      }
    }
    process.stdout.write('\n');
    try { await search.close?.(); } catch {}
  }

  // Aggregate
  const bucketCounts = {};
  const repoBucketCounts = {};
  let rescue = 0, harm = 0;
  for (const r of records) {
    if (r.error_none || r.error_expand) continue;
    bucketCounts[r.bucket] = (bucketCounts[r.bucket] || 0) + 1;
    repoBucketCounts[r.repo] = repoBucketCounts[r.repo] || {};
    repoBucketCounts[r.repo][r.bucket] = (repoBucketCounts[r.repo][r.bucket] || 0) + 1;
    if (r.rescue) rescue++;
    if (r.harm) harm++;
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(opts.rawOut, JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      options: opts,
      total: records.length,
      rescue, harm,
      bucketCounts,
      repoBucketCounts,
    },
    records,
  }, null, 2));

  console.log(`\n  rescued (mode B top10 but mode A miss): ${rescue}`);
  console.log(`  harmed  (mode A top10 but mode B miss):  ${harm}`);
  console.log('  Buckets:');
  for (const [b, n] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${b.padEnd(50)} ${n}`);
  }
  console.log(`  Time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\n  Wrote: ${opts.out}`);
  console.log(`  Wrote: ${opts.rawOut}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
