#!/usr/bin/env node
/**
 * Rerank-pool allocation sweep for graph expansion.
 *
 * Holds the query set + retrieval pipeline constant and varies only:
 *   - graphExpand mode (none / 1hop / 2hop-naive / 2hop-adaptive)
 *   - LI rerank pool size       (`liPoolSize`)
 *   - LI expanded-slot fraction (`liExpandedFraction`)
 *
 * Goal: see whether wider pools or different splits raise rescue rate
 * without raising harm or latency, and whether they make adaptive 2-hop
 * separable from 1-hop / naive 2-hop.
 *
 * Usage:
 *   node eval/graph-2hop/run_pool_sweep.js
 *   node eval/graph-2hop/run_pool_sweep.js --max=50
 *   SWEET_SEARCH_CASCADE_ENABLED=true node eval/graph-2hop/run_pool_sweep.js
 *   node eval/graph-2hop/run_pool_sweep.js --policies=production,wide_40_40
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ─── Policies ───────────────────────────────────────────────────────────────

// Each policy = (graph mode, pool-size, expanded-fraction). 60/40 means 60 %
// originals / 40 % expanded — matches the production default.
const POLICIES = {
  baseline_none:        { mode: 'none',          poolSize: null, expandedFrac: null },
  pool20:               { mode: '2hop-adaptive', poolSize: 20,   expandedFrac: 0.4 },
  pool25:               { mode: '2hop-adaptive', poolSize: 25,   expandedFrac: 0.4 },
  pool30:               { mode: '2hop-adaptive', poolSize: 30,   expandedFrac: 0.4 },
  pool35:               { mode: '2hop-adaptive', poolSize: 35,   expandedFrac: 0.4 },
  pool40:               { mode: '2hop-adaptive', poolSize: 40,   expandedFrac: 0.4 },
  pool40_50_50:         { mode: '2hop-adaptive', poolSize: 40,   expandedFrac: 0.5 },
  // Same widest pool, swap algorithm — does adaptive separate from
  // naive / 1-hop once the pool is wide enough?
  '1hop_pool40':        { mode: '1hop',          poolSize: 40,   expandedFrac: 0.4 },
  '2hop_naive_pool40':  { mode: '2hop-naive',    poolSize: 40,   expandedFrac: 0.4 },
  // Control: pool size 25 with no graph expansion. Should behave like
  // baseline_none modulo pool-size effects on the originals-only LI window.
  pool25_no_expand:     { mode: 'none',          poolSize: 25,   expandedFrac: null },
};

const MODE_OPTS = {
  'none':          { graphExpand: 'none', expand: false },
  '1hop':          { graphExpand: '1hop',  adaptiveHop2: false, expand: true },
  '2hop-naive':    { graphExpand: '2hop',  adaptiveHop2: false, expand: true },
  '2hop-adaptive': { graphExpand: '2hop',  adaptiveHop2: true,  expand: true },
};

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repos: ['fastify', 'flask', 'ripgrep'],
    queriesFile: path.join(__dirname, 'queries.jsonl'),
    max: 0,
    policies: Object.keys(POLICIES),
    k: 50,
    out: path.join(__dirname, 'results', `pool_sweep_${Date.now()}.json`),
    warmup: true,
  };
  for (const a of args) {
    if (a.startsWith('--repos=')) opts.repos = a.split('=')[1].split(',');
    else if (a.startsWith('--queries=')) opts.queriesFile = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--max=')) opts.max = parseInt(a.split('=')[1]);
    else if (a.startsWith('--policies=')) opts.policies = a.split('=')[1].split(',');
    else if (a.startsWith('--k=')) opts.k = parseInt(a.split('=')[1]);
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.split('=')[1]);
    else if (a === '--no-warmup') opts.warmup = false;
  }
  return opts;
}

function loadJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`queries file not found: ${file}`);
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(JSON.parse);
}

// ─── File-path matching (copied from run_graph_2hop_bench.js) ───────────────

function fileMatches(resultPath, goldPaths, repoRoot) {
  if (!resultPath) return false;
  const norm = (p) => p
    .replace(repoRoot || '', '')
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
    const f = results[i].file || results[i].file_path || '';
    if (fileMatches(f, goldPaths, repoRoot)) return i + 1;
  }
  return null;
}

// ─── Core query runner ──────────────────────────────────────────────────────

async function runOne(search, query, policy, k) {
  const t0 = performance.now();
  const modeOpts = MODE_OPTS[policy.mode];
  const searchOpts = {
    k,
    mode: 'auto',
    rerank: true,
    ...modeOpts,
  };
  if (policy.poolSize != null) searchOpts.liPoolSize = policy.poolSize;
  if (policy.expandedFrac != null) searchOpts.liExpandedFraction = policy.expandedFrac;
  const { results, stats } = await search.search(query, searchOpts);
  const latencyMs = performance.now() - t0;
  return {
    results: results.map(r => ({
      file: r.file || r.file_path || r.metadata?.file || r.metadata?.path || '',
      is_expanded: !!r.is_expanded,
    })),
    latencyMs,
    stats,
  };
}

async function openSearchForRepo(repoName) {
  const repoRoot = path.join(PROJECT_ROOT, 'eval', 'repos', repoName);
  const search = await _openSearchInner(repoName, repoRoot);
  return { search, repoRoot };
}

async function _openSearchInner(repoName, repoRoot) {
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
  return search;
}
void _openSearchInner; // referenced via openSearchForRepo

// ─── Aggregation ────────────────────────────────────────────────────────────

function pct(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

function summarize(rows) {
  const mrr10=[], r10=[], r20=[], r50=[], lat=[];
  let exp_in_pool_sum = 0, with_exp = 0;
  for (const r of rows) {
    const k = r.gold_rank;
    mrr10.push(k && k <= 10 ? 1/k : 0);
    r10.push(k && k <= 10 ? 1 : 0);
    r20.push(k && k <= 20 ? 1 : 0);
    r50.push(k && k <= 50 ? 1 : 0);
    lat.push(r.latency_ms);
    exp_in_pool_sum += r.li_expanded_in_pool || 0;
    if ((r.expanded_count || 0) > 0) with_exp++;
  }
  return {
    n: rows.length,
    mrr_at_10: mean(mrr10),
    recall_at_10: mean(r10),
    recall_at_20: mean(r20),
    recall_at_50: mean(r50),
    latency_p50_ms: pct(lat, 0.5),
    latency_p95_ms: pct(lat, 0.95),
    queries_with_expansion: with_exp,
    mean_expanded_in_pool: rows.length ? exp_in_pool_sum / rows.length : 0,
  };
}

function rescueAndHarm(rows, baselineRows, k = 10) {
  let rescue = 0, harm = 0, n = 0;
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i], b = baselineRows[i];
    if (!m || !b || m.error || b.error) continue;
    n++;
    const mIn = m.gold_rank && m.gold_rank <= k;
    const bIn = b.gold_rank && b.gold_rank <= k;
    if (mIn && !bIn) rescue++;
    if (!mIn && bIn) harm++;
  }
  return { rescue_count: rescue, harm_count: harm, n,
    rescue_rate: n ? rescue / n : 0, harm_rate: n ? harm / n : 0 };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  console.log('═'.repeat(74));
  console.log('  Rerank-pool allocation sweep — graph-2hop benchmark');
  console.log('═'.repeat(74));
  console.log(`  Cascade enabled: ${process.env.SWEET_SEARCH_CASCADE_ENABLED === 'true'}`);
  console.log(`  Policies:        ${opts.policies.join(', ')}`);
  console.log(`  Repos:           ${opts.repos.join(', ')}`);
  console.log(`  Max queries:     ${opts.max || 'all'}`);
  console.log();

  const allQueries = loadJsonl(opts.queriesFile);
  const queriesByRepo = {};
  for (const q of allQueries) {
    if (!opts.repos.includes(q.repo)) continue;
    (queriesByRepo[q.repo] ||= []).push(q);
  }
  if (opts.max > 0) {
    for (const r of Object.keys(queriesByRepo)) queriesByRepo[r] = queriesByRepo[r].slice(0, opts.max);
  }

  // perPolicy[policyName] = array of rows (one per query × repo)
  const perPolicy = Object.fromEntries(opts.policies.map(p => [p, []]));

  for (const repo of opts.repos) {
    if (!queriesByRepo[repo]?.length) continue;
    console.log('─'.repeat(74));
    console.log(`  Repo: ${repo} (${queriesByRepo[repo].length} queries)`);
    console.log('─'.repeat(74));
    let search, repoRoot;
    try { ({ search, repoRoot } = await openSearchForRepo(repo)); }
    catch (err) { console.error(`  SKIP ${repo}: ${err.message}`); continue; }

    if (opts.warmup) {
      for (const w of ['warmup query', 'find function', 'class definition']) {
        await search.search(w, { k: 5, mode: 'auto', rerank: true, expand: false }).catch(() => {});
      }
    }

    let done = 0;
    for (const q of queriesByRepo[repo]) {
      for (const policyName of opts.policies) {
        const policy = POLICIES[policyName];
        if (!policy) { console.error(`unknown policy ${policyName}`); continue; }
        let row;
        try {
          const r = await runOne(search, q.query, policy, opts.k);
          const rank = findGoldRank(r.results, q.gold_files, repoRoot);
          row = {
            id: q.id, repo, policy: policyName, mode: policy.mode,
            poolSize: policy.poolSize, expandedFrac: policy.expandedFrac,
            category: q.category, expected_hops: q.expected_hops,
            gold_rank: rank,
            latency_ms: r.latencyMs,
            expanded_count: r.stats?.graphExpansion?.expanded ?? null,
            li_expanded_in_pool: r.stats?.lateInteraction?.expandedInPool ?? null,
            li_pool_size: r.stats?.lateInteraction?.candidates ?? null,
          };
        } catch (err) {
          row = { id: q.id, repo, policy: policyName, mode: policy.mode,
            error: err.message, gold_rank: null, latency_ms: 0 };
        }
        perPolicy[policyName].push(row);
      }
      done++;
      if (done % 20 === 0 || done === queriesByRepo[repo].length) {
        process.stdout.write(`\r    ${done}/${queriesByRepo[repo].length}`);
      }
    }
    process.stdout.write('\n');
    try { await search.close?.(); } catch {}
  }

  // ── Summarize ──
  const summary = {};
  const baseline = perPolicy['baseline_none'] || [];
  for (const p of opts.policies) {
    summary[p] = {
      ...summarize(perPolicy[p]),
      ...(p === 'baseline_none' ? {} : {
        rescue_top10: rescueAndHarm(perPolicy[p], baseline, 10),
        rescue_top50: rescueAndHarm(perPolicy[p], baseline, 50),
      }),
      policy: POLICIES[p],
      errors: perPolicy[p].filter(r => r.error).length,
    };
  }

  // ── Print ──
  console.log('\n' + '═'.repeat(90));
  console.log('  POLICY COMPARISON (vs baseline_none)');
  console.log('═'.repeat(90));
  const fmt = (x) => `${(x * 100).toFixed(2)}%`;
  console.log(
    '  ' + 'policy'.padEnd(22) +
    'MRR@10'.padStart(9) + 'R@10'.padStart(8) + 'R@20'.padStart(8) + 'R@50'.padStart(8) +
    'p50ms'.padStart(8) + 'rescue@10'.padStart(11) + 'harm@10'.padStart(10) +
    'rescue@50'.padStart(11) + 'harm@50'.padStart(10) + 'pool'.padStart(7)
  );
  console.log('  ' + '-'.repeat(86));
  for (const p of opts.policies) {
    const s = summary[p];
    console.log(
      '  ' + p.padEnd(22) +
      fmt(s.mrr_at_10).padStart(9) +
      fmt(s.recall_at_10).padStart(8) +
      fmt(s.recall_at_20).padStart(8) +
      fmt(s.recall_at_50).padStart(8) +
      `${s.latency_p50_ms.toFixed(1)}`.padStart(8) +
      (s.rescue_top10 ? fmt(s.rescue_top10.rescue_rate).padStart(11) : '   —      '.padStart(11)) +
      (s.rescue_top10 ? fmt(s.rescue_top10.harm_rate).padStart(10) : '   —     '.padStart(10)) +
      (s.rescue_top50 ? fmt(s.rescue_top50.rescue_rate).padStart(11) : '   —      '.padStart(11)) +
      (s.rescue_top50 ? fmt(s.rescue_top50.harm_rate).padStart(10) : '   —     '.padStart(10)) +
      `${s.mean_expanded_in_pool.toFixed(1)}`.padStart(7)
    );
  }

  // ── Write ──
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify({
    timestamp: new Date().toISOString(),
    cascadeEnabled: process.env.SWEET_SEARCH_CASCADE_ENABLED === 'true',
    options: opts, policies: POLICIES, summary, perPolicy,
  }, null, 2));
  console.log(`\n  → wrote ${opts.out}`);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
