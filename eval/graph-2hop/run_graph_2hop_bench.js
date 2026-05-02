#!/usr/bin/env node
/**
 * Adaptive 2-hop Graph Expansion Benchmark — real codebases.
 *
 * Compares four retrieval modes on hand-curated, graph-benefiting NL queries
 * against indexed real repos (fastify, flask, ripgrep):
 *
 *   1. graphExpand='none'                            (no expansion)
 *   2. graphExpand='1hop'                            (1-hop expansion)
 *   3. graphExpand='2hop', adaptiveHop2=false        (naive 2-hop)
 *   4. graphExpand='2hop', adaptiveHop2=true         (adaptive 2-hop, default)
 *
 * Search settings: mode=auto (semantic/hybrid via routing), expand=true,
 * rerank=true, useLateInteraction=true (cascade). Only graphExpand /
 * adaptiveHop2 vary across conditions.
 *
 * Per query and per repo we record:
 *   - rank of each gold file (best rank across gold files)
 *   - latency
 *   - graph rescue:  gold absent in `none` top-k but present in this mode
 *   - graph harm:    gold present in `none` top-k but absent (or worse) in this mode
 *   - mean candidates added by expansion (from stats.graphExpansion + stats.cascade)
 *
 * Usage:
 *   node eval/graph-2hop/run_graph_2hop_bench.js
 *   node eval/graph-2hop/run_graph_2hop_bench.js --repos=fastify,flask
 *   node eval/graph-2hop/run_graph_2hop_bench.js --max=10            # smoke
 *   node eval/graph-2hop/run_graph_2hop_bench.js --queries=path.jsonl
 *   node eval/graph-2hop/run_graph_2hop_bench.js --concurrency=4
 *   node eval/graph-2hop/run_graph_2hop_bench.js --modes=none,2hop-adaptive
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

import { initSearch } from '../lib/indexer.js';

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repos: ['fastify', 'flask', 'ripgrep'],
    queriesFile: path.join(__dirname, 'queries.jsonl'),
    max: 0,
    concurrency: 1,
    modes: ['none', '1hop', '2hop-naive', '2hop-adaptive'],
    k: 50,                  // request 50 to compute Recall@50
    out: path.join(__dirname, 'results', `graph2hop_${Date.now()}.json`),
    warmup: true,
    verbose: false,
  };
  for (const a of args) {
    if (a.startsWith('--repos=')) opts.repos = a.split('=')[1].split(',');
    else if (a.startsWith('--queries=')) opts.queriesFile = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--max=')) opts.max = parseInt(a.split('=')[1]);
    else if (a.startsWith('--concurrency=')) opts.concurrency = parseInt(a.split('=')[1]);
    else if (a.startsWith('--modes=')) opts.modes = a.split('=')[1].split(',');
    else if (a.startsWith('--k=')) opts.k = parseInt(a.split('=')[1]);
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.split('=')[1]);
    else if (a === '--no-warmup') opts.warmup = false;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
  }
  return opts;
}

// IMPORTANT: sweet-search auto-promotes graphExpand='none' → '2hop' for
// semantic/hybrid when expand=true (sweet-search.js ~line 416). To get a
// genuine "no expansion" baseline we must pass expand=false on the `none`
// condition. All other conditions keep expand=true (production setting).
const MODE_OPTS = {
  'none':          { graphExpand: 'none', expand: false },
  '1hop':          { graphExpand: '1hop',  adaptiveHop2: false, expand: true },
  '2hop-naive':    { graphExpand: '2hop',  adaptiveHop2: false, expand: true },
  '2hop-adaptive': { graphExpand: '2hop',  adaptiveHop2: true,  expand: true },
};

// ─── Query loading ──────────────────────────────────────────────────────────

function loadJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`queries file not found: ${file}`);
  return fs.readFileSync(file, 'utf-8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map((l, i) => {
      try { return JSON.parse(l); }
      catch (err) { throw new Error(`bad JSON at line ${i + 1} of ${file}: ${err.message}`); }
    });
}

// ─── File-path matching ─────────────────────────────────────────────────────

/**
 * Robust file matcher. Compares relative paths after stripping repo root.
 * Accepts equality, suffix match, and basename match (last resort).
 */
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
    // basename fallback only when both sides have no '/' OR basenames match
    if (path.basename(r) === path.basename(gn)) return true;
  }
  return false;
}

/**
 * For a query, find the BEST (smallest) rank across any gold file.
 * Returns rank (1-indexed) or null if not found.
 */
function findGoldRank(results, goldPaths, repoRoot) {
  for (let i = 0; i < results.length; i++) {
    const f = results[i].file || results[i].file_path || results[i].metadata?.file || '';
    if (fileMatches(f, goldPaths, repoRoot)) return i + 1;
  }
  return null;
}

// ─── Core query runner ──────────────────────────────────────────────────────

async function runOne(search, query, modeOpts, k) {
  const t0 = performance.now();
  const { results, stats } = await search.search(query, {
    k,
    mode: 'auto',          // let routing pick semantic / hybrid
    rerank: true,
    ...modeOpts,           // includes expand + graphExpand + adaptiveHop2
  });
  const latencyMs = performance.now() - t0;

  return {
    results: results.map(r => ({
      file: r.file || r.file_path || r.metadata?.file || '',
      name: r.name || r.metadata?.name || '',
      score: r.score || 0,
      is_expanded: !!r.is_expanded,
      hops: r.expansion?.hops || 0,
      via: r.expansion?.via || null,
    })),
    latencyMs,
    stats,
  };
}

// ─── Stats helpers ──────────────────────────────────────────────────────────

function pct(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function summarize(modeRows) {
  const mrr10 = [];
  const r10 = [], r20 = [], r50 = [];
  const missing10 = [];
  const missing50 = [];
  const latencies = [];
  const expanded10 = [];   // # of expanded chunks in top10 across queries
  const candidatesAdded = [];
  for (const row of modeRows) {
    const rank = row.gold_rank;
    mrr10.push(rank && rank <= 10 ? 1 / rank : 0);
    r10.push(rank && rank <= 10 ? 1 : 0);
    r20.push(rank && rank <= 20 ? 1 : 0);
    r50.push(rank && rank <= 50 ? 1 : 0);
    missing10.push(rank && rank <= 10 ? 0 : 1);
    missing50.push(rank && rank <= 50 ? 0 : 1);
    latencies.push(row.latency_ms);
    expanded10.push(row.expanded_in_top10 || 0);
    candidatesAdded.push(row.candidates_added || 0);
  }
  return {
    n: modeRows.length,
    mrr_at_10: mean(mrr10),
    recall_at_10: mean(r10),
    recall_at_20: mean(r20),
    recall_at_50: mean(r50),
    gold_missing_top10_rate: mean(missing10),
    gold_missing_top50_rate: mean(missing50),
    expanded_survival_top10: mean(expanded10),
    mean_candidates_added: mean(candidatesAdded),
    latency_p50_ms: pct(latencies, 0.5),
    latency_p95_ms: pct(latencies, 0.95),
    latency_mean_ms: mean(latencies),
  };
}

// rescue/harm need cross-mode comparison vs `none`
function rescueAndHarmRates(modeRows, baselineRows) {
  let rescue = 0, harm = 0;
  let total = 0;
  for (let i = 0; i < modeRows.length; i++) {
    const m = modeRows[i];
    const b = baselineRows[i];
    if (!m || !b) continue;
    total++;
    const mInTop10 = m.gold_rank && m.gold_rank <= 10;
    const bInTop10 = b.gold_rank && b.gold_rank <= 10;
    if (mInTop10 && !bInTop10) rescue++;
    if (!mInTop10 && bInTop10) harm++;
  }
  return {
    rescue_rate_top10: total > 0 ? rescue / total : 0,
    harm_rate_top10: total > 0 ? harm / total : 0,
    rescue_count: rescue,
    harm_count: harm,
    n: total,
  };
}

// ─── Search initialization per repo ─────────────────────────────────────────

async function openSearchForRepo(repoName) {
  const repoRoot = path.join(PROJECT_ROOT, 'eval', 'repos', repoName);
  const ssDir = path.join(repoRoot, '.sweet-search');
  if (!fs.existsSync(path.join(ssDir, 'code-graph.db'))) {
    throw new Error(`Repo ${repoName} not indexed at ${ssDir}`);
  }
  process.env.SWEET_SEARCH_PROJECT_ROOT = repoRoot;
  const { SweetSearch } = await import(path.join(PROJECT_ROOT, 'core', 'search', 'sweet-search.js'));
  // NOTE: existing test-repo indexes have mixed-dim float vectors stored from
  // earlier pipeline versions (some 768d, current pipeline expects 512d).
  // Stage 2.5 fails with dimension-mismatch on those. Disable 3-stage and run
  // the standard 2-stage HNSW pipeline — graph expansion (the variable under
  // test) is unaffected.
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

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('═'.repeat(74));
  console.log('  Adaptive 2-hop Graph Expansion Benchmark — real codebases');
  console.log('═'.repeat(74));
  console.log(`  Repos:        ${opts.repos.join(', ')}`);
  console.log(`  Modes:        ${opts.modes.join(', ')}`);
  console.log(`  Queries file: ${opts.queriesFile}`);
  console.log(`  Max queries:  ${opts.max || 'all'}`);
  console.log(`  Out:          ${opts.out}`);
  console.log();

  const allQueries = loadJsonl(opts.queriesFile);
  const queriesByRepo = {};
  for (const q of allQueries) {
    if (!opts.repos.includes(q.repo)) continue;
    if (!queriesByRepo[q.repo]) queriesByRepo[q.repo] = [];
    queriesByRepo[q.repo].push(q);
  }
  if (opts.max > 0) {
    for (const r of Object.keys(queriesByRepo)) {
      queriesByRepo[r] = queriesByRepo[r].slice(0, opts.max);
    }
  }

  const totalQueries = Object.values(queriesByRepo).reduce((s, q) => s + q.length, 0);
  console.log(`  Loaded ${totalQueries} queries across ${Object.keys(queriesByRepo).length} repo(s).`);
  if (totalQueries === 0) {
    console.error('No queries to run. Exiting.');
    process.exit(1);
  }

  // ── Per-repo evaluation ──
  const repoResults = {}; // { repo: { mode: [rows] } }
  const perQueryRows = []; // wide format for analysis

  for (const repo of Object.keys(queriesByRepo)) {
    console.log('\n' + '─'.repeat(74));
    console.log(`  Repo: ${repo}  (${queriesByRepo[repo].length} queries)`);
    console.log('─'.repeat(74));

    let openHandle;
    try {
      openHandle = await openSearchForRepo(repo);
    } catch (err) {
      console.error(`  SKIP ${repo}: ${err.message}`);
      continue;
    }
    const { search, repoRoot } = openHandle;

    if (opts.warmup) {
      // Multi-warmup: warm up the LI / embedding models before measurement.
      // Single warmup wasn't enough to unblock cold-start `embedding.slice`
      // failures observed during the first ~5–10 real queries.
      for (const w of ['warmup query', 'find a function', 'class definition']) {
        await search.search(w, {
          k: 5, mode: 'auto', rerank: true, expand: false,
        }).catch(() => {});
      }
    }

    repoResults[repo] = {};
    for (const mode of opts.modes) repoResults[repo][mode] = [];

    let done = 0;
    const queries = queriesByRepo[repo];
    for (const q of queries) {
      for (const mode of opts.modes) {
        const modeOpts = MODE_OPTS[mode];
        if (!modeOpts) {
          console.error(`  Unknown mode: ${mode}`);
          continue;
        }

        let row;
        try {
          const r = await runOne(search, q.query, modeOpts, opts.k);
          const rank = findGoldRank(r.results, q.gold_files, repoRoot);
          const top10 = r.results.slice(0, 10);
          const expandedInTop10 = top10.filter(x => x.is_expanded).length;
          const candidatesAdded =
            (r.stats?.graphExpansion?.total ?? r.results.length) - r.results.filter(x => !x.is_expanded).length;

          row = {
            id: q.id,
            repo,
            mode,
            query: q.query,
            category: q.category,
            expected_hops: q.expected_hops,
            gold_files: q.gold_files,
            gold_rank: rank,
            in_top10: !!(rank && rank <= 10),
            in_top20: !!(rank && rank <= 20),
            in_top50: !!(rank && rank <= 50),
            latency_ms: r.latencyMs,
            expanded_in_top10: expandedInTop10,
            candidates_added: candidatesAdded,
            graph_expansion_mode: r.stats?.graphExpansion?.mode || 'none',
            graph_expansion_latency_ms: r.stats?.graphExpansion?.latency_ms || 0,
            graph_expansion_total: r.stats?.graphExpansion?.total ?? null,
            expanded_count: r.stats?.graphExpansion?.expanded ?? null,
            expanded_with_li_chunk: r.stats?.graphExpansion?.expandedWithLiChunk ?? null,
            li_pool_size: r.stats?.lateInteraction?.candidates ?? null,
            li_expanded_in_pool: r.stats?.lateInteraction?.expandedInPool ?? null,
            cascade_stats: r.stats?.cascade ? {
              ceInvoked: r.stats.cascade.ceInvoked,
              ceCandidates: r.stats.cascade.ceCandidates,
              gateReason: r.stats.cascade.gateReason,
              candidatesIn: r.stats.cascade.candidatesIn,
              candidatesOut: r.stats.cascade.candidatesOut,
            } : null,
            search_path: r.stats?.path || null,
            top1_file: r.results[0]?.file || null,
            top10_files: r.results.slice(0, 10).map(x => x.file),
          };
        } catch (err) {
          if (opts.verbose) console.error(`\n[${q.id} ${mode}] ${err.message}\n${err.stack?.split('\n').slice(0,4).join('\n')}`);
          row = {
            id: q.id, repo, mode, query: q.query, error: err.message,
            error_stack: err.stack?.split('\n').slice(0, 4).join('\n') || null,
            gold_rank: null, latency_ms: 0,
          };
        }
        repoResults[repo][mode].push(row);
        perQueryRows.push(row);
      }
      done++;
      if (done % 10 === 0 || done === queries.length) {
        process.stdout.write(`\r    progress: ${done}/${queries.length}`);
      }
    }
    process.stdout.write('\n');
    try { await search.close?.(); } catch {}
  }

  // ── Summarize ──
  const summary = {};
  for (const repo of Object.keys(repoResults)) {
    summary[repo] = {};
    const baseline = repoResults[repo]['none'] || [];
    for (const mode of opts.modes) {
      const rows = repoResults[repo][mode] || [];
      summary[repo][mode] = {
        ...summarize(rows),
        ...(mode === 'none' ? {} : rescueAndHarmRates(rows, baseline)),
      };
    }
  }

  // Aggregate (all repos)
  const overall = {};
  const baselineAll = Object.values(repoResults).flatMap(m => m['none'] || []);
  for (const mode of opts.modes) {
    const rows = Object.values(repoResults).flatMap(m => m[mode] || []);
    overall[mode] = {
      ...summarize(rows),
      ...(mode === 'none' ? {} : rescueAndHarmRates(rows, baselineAll)),
    };
  }

  // Per-category breakdown for the most interesting mode comparisons
  const byCategory = {};
  const baselineByCategory = {};
  for (const row of perQueryRows.filter(r => r.mode === 'none')) {
    if (!baselineByCategory[row.category]) baselineByCategory[row.category] = [];
    baselineByCategory[row.category].push(row);
  }
  for (const mode of opts.modes) {
    byCategory[mode] = {};
    for (const row of perQueryRows.filter(r => r.mode === mode)) {
      if (!byCategory[mode][row.category]) byCategory[mode][row.category] = [];
      byCategory[mode][row.category].push(row);
    }
  }
  const perCategorySummary = {};
  for (const mode of opts.modes) {
    perCategorySummary[mode] = {};
    for (const cat of Object.keys(byCategory[mode] || {})) {
      const rows = byCategory[mode][cat];
      const base = baselineByCategory[cat] || [];
      perCategorySummary[mode][cat] = {
        ...summarize(rows),
        ...(mode === 'none' ? {} : rescueAndHarmRates(rows, base)),
      };
    }
  }

  // ── Print summary ──
  console.log('\n\n' + '═'.repeat(74));
  console.log('  RESULTS SUMMARY');
  console.log('═'.repeat(74));

  const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;
  const fmtMs = (x) => `${x.toFixed(1)}ms`;

  for (const repo of Object.keys(summary)) {
    console.log(`\n  ${repo.toUpperCase()}`);
    console.log('  ' + '-'.repeat(70));
    console.log(
      '  ' + 'mode'.padEnd(16) +
      'MRR@10'.padStart(10) + 'R@10'.padStart(8) + 'R@20'.padStart(8) + 'R@50'.padStart(8) +
      'p50ms'.padStart(9) + 'rescue%'.padStart(10) + 'harm%'.padStart(8)
    );
    console.log('  ' + '-'.repeat(70));
    for (const mode of opts.modes) {
      const s = summary[repo][mode];
      if (!s) continue;
      console.log(
        '  ' + mode.padEnd(16) +
        fmtPct(s.mrr_at_10).padStart(10) +
        fmtPct(s.recall_at_10).padStart(8) +
        fmtPct(s.recall_at_20).padStart(8) +
        fmtPct(s.recall_at_50).padStart(8) +
        fmtMs(s.latency_p50_ms).padStart(9) +
        (s.rescue_rate_top10 != null ? fmtPct(s.rescue_rate_top10).padStart(10) : '   —    ') +
        (s.harm_rate_top10  != null ? fmtPct(s.harm_rate_top10).padStart(8)  : '   —  ')
      );
    }
  }

  console.log(`\n  ALL  (n=${overall[opts.modes[0]]?.n || 0})`);
  console.log('  ' + '-'.repeat(70));
  console.log(
    '  ' + 'mode'.padEnd(16) +
    'MRR@10'.padStart(10) + 'R@10'.padStart(8) + 'R@20'.padStart(8) + 'R@50'.padStart(8) +
    'p50ms'.padStart(9) + 'rescue%'.padStart(10) + 'harm%'.padStart(8)
  );
  console.log('  ' + '-'.repeat(70));
  for (const mode of opts.modes) {
    const s = overall[mode];
    if (!s) continue;
    console.log(
      '  ' + mode.padEnd(16) +
      fmtPct(s.mrr_at_10).padStart(10) +
      fmtPct(s.recall_at_10).padStart(8) +
      fmtPct(s.recall_at_20).padStart(8) +
      fmtPct(s.recall_at_50).padStart(8) +
      fmtMs(s.latency_p50_ms).padStart(9) +
      (s.rescue_rate_top10 != null ? fmtPct(s.rescue_rate_top10).padStart(10) : '   —    ') +
      (s.harm_rate_top10  != null ? fmtPct(s.harm_rate_top10).padStart(8)  : '   —  ')
    );
  }

  // ── Write output ──
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const out = {
    timestamp: new Date().toISOString(),
    options: opts,
    summary,
    overall,
    perCategorySummary,
    perQueryRows,
  };
  fs.writeFileSync(opts.out, JSON.stringify(out, null, 2));
  console.log(`\n  → wrote ${opts.out}`);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
