#!/usr/bin/env node
/**
 * Forced-Route Replay (offline) — no daemon, no socket.
 *
 * Initializes a SweetSearch instance directly against an existing index
 * (default: eval/corpus/gencodesearchnet/.sweet-search) and runs every query
 * under auto / lexical / semantic / hybrid. Records:
 *   - auto route + method + confidence + routerLatency_us
 *   - per-forced-route: top-1 score, top-k file paths, latency, result count
 *   - oracle by top-1 score (cheap proxy)
 *   - whether auto matched the inferred oracle
 *
 * Curated probe sets + a JSON-array option let us cover:
 *   - the user's adversarial slash queries (path FP / NL slash)
 *   - GCSN-style raw queries (with leading // — simulates agent inputs)
 *   - GCSN cleaned queries (after cleanQueryText — what run_benchmark.js sees)
 *   - identifier vs NL vs mixed agent-realistic queries
 *
 * Usage:
 *   node scripts/forced-route-replay-offline.mjs --builtin agent-realistic
 *   node scripts/forced-route-replay-offline.mjs --builtin path-probes
 *   node scripts/forced-route-replay-offline.mjs --builtin gcsn-raw --limit 50
 *   node scripts/forced-route-replay-offline.mjs --builtin gcsn-clean --limit 50
 *   node scripts/forced-route-replay-offline.mjs --queries my.json --out replay.json
 *   node scripts/forced-route-replay-offline.mjs --corpus path/to/corpus
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const FORCED_MODES = ['lexical', 'semantic', 'hybrid'];

const PATH_PROBES = [
  { query: 'core/query/query-router.js', oracleRoute: 'lexical', kind: 'true-path' },
  { query: 'package.json',                oracleRoute: 'lexical', kind: 'true-path' },
  { query: 'src/server/index.ts',         oracleRoute: 'lexical', kind: 'true-path' },
  { query: 'foo/bar',                      oracleRoute: 'lexical', kind: 'true-path' },
  { query: 'foo\\bar',                     oracleRoute: 'lexical', kind: 'true-path' },
  { query: '*.test.js',                    oracleRoute: 'lexical', kind: 'true-path' },
  // Adversarial slash queries (the bug-fix targets)
  { query: 'HTTP/2 server setup',          oracleRoute: 'semantic', kind: 'nl-slash' },
  { query: 'file/function relationship',   oracleRoute: 'semantic', kind: 'nl-slash' },
  { query: 'request/response lifecycle',   oracleRoute: 'semantic', kind: 'nl-slash' },
  { query: 'and/or behavior',              oracleRoute: 'hybrid',   kind: 'nl-slash' },
  { query: 'TCP/IP stack overview',        oracleRoute: 'semantic', kind: 'nl-slash' },
];

const AGENT_REALISTIC = [
  // Identifiers
  { query: 'AuthService',                                                     kind: 'identifier' },
  { query: 'getUserById',                                                     kind: 'identifier' },
  { query: 'MAX_CONNECTION_POOL_SIZE',                                        kind: 'constant' },
  { query: 'EmployeeController',                                              kind: 'identifier' },
  // NL questions
  { query: 'how does authentication work',                                    kind: 'nl-question' },
  { query: 'explain the bot detection algorithm',                             kind: 'nl-question' },
  { query: 'where is rate limiting implemented',                              kind: 'nl-question' },
  // Mixed identifier + NL
  { query: 'AuthService login flow',                                          kind: 'mixed' },
  { query: 'jwt token validation',                                            kind: 'mixed' },
  { query: 'how does JwtService verify tokens',                               kind: 'mixed' },
  // Error codes / config keys
  { query: 'ERR_INVALID_TOKEN',                                               kind: 'error-code' },
  { query: 'STAGE3_CANDIDATES',                                               kind: 'config-key' },
  // Relationship queries
  { query: 'what calls JwtService',                                           kind: 'relationship' },
  { query: 'callers of ApiKeyService',                                        kind: 'relationship' },
  { query: 'implementations of DetectionHeuristic',                           kind: 'relationship' },
  // Short ambiguous
  { query: 'token',                                                           kind: 'short-ambiguous' },
  { query: 'cache',                                                           kind: 'short-ambiguous' },
  { query: 'http',                                                            kind: 'short-ambiguous' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    queriesPath: null, builtin: null, topK: 5, outFile: null,
    corpus: 'eval/corpus/gencodesearchnet', limit: 0,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--queries') opts.queriesPath = args[++i];
    else if (a === '--builtin') opts.builtin = args[++i];
    else if (a === '--top-k' || a === '-k') opts.topK = +args[++i];
    else if (a === '--out') opts.outFile = args[++i];
    else if (a === '--corpus') opts.corpus = args[++i];
    else if (a === '--limit') opts.limit = +args[++i];
  }
  return opts;
}

async function loadGcsnQueries({ cleaned, limit, sampleSeed = 1 }) {
  const { cleanQueryText } = await import(path.join(REPO_ROOT, 'eval', 'lib', 'evaluator.js'));
  const lines = readFileSync(path.join(REPO_ROOT, 'eval/data/gencodesearchnet/queries.jsonl'), 'utf-8')
    .split('\n').filter(Boolean);
  let queries = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      const raw = o.query || '';
      const q = cleaned ? cleanQueryText(raw) : raw;
      if (!q) continue;
      queries.push({
        query: q,
        kind: cleaned ? 'gcsn-clean' : 'gcsn-raw',
        language: o.language,
        gold: o.relevant_doc_ids || [],
        queryId: o.query_id,
      });
    } catch {}
  }
  // Deterministic sample
  const rng = (seed) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const r = rng(sampleSeed);
  if (limit > 0 && limit < queries.length) {
    queries = queries.map(q => ({ q, k: r() })).sort((a, b) => a.k - b.k).slice(0, limit).map(x => x.q);
  }
  return queries;
}

async function loadQueries(opts) {
  if (opts.builtin === 'path-probes') return PATH_PROBES;
  if (opts.builtin === 'agent-realistic') return AGENT_REALISTIC;
  if (opts.builtin === 'gcsn-raw')  return loadGcsnQueries({ cleaned: false, limit: opts.limit || 100 });
  if (opts.builtin === 'gcsn-clean') return loadGcsnQueries({ cleaned: true,  limit: opts.limit || 100 });
  if (opts.builtin === 'all') {
    return [
      ...PATH_PROBES,
      ...AGENT_REALISTIC,
      ...(await loadGcsnQueries({ cleaned: false, limit: 50 })),
      ...(await loadGcsnQueries({ cleaned: true,  limit: 50 })),
    ];
  }
  if (opts.queriesPath) {
    const data = JSON.parse(readFileSync(opts.queriesPath, 'utf-8'));
    return Array.isArray(data) ? data : (data.queries || []);
  }
  // stdin fallback
  const stdin = readFileSync(0, 'utf-8');
  return stdin.split('\n').map(l => l.trim()).filter(Boolean).map(q => ({ query: q }));
}

function shortHash(q) {
  return createHash('sha1').update(String(q)).digest('hex').slice(0, 16);
}

function topResultSummary(results, k) {
  return (results || []).slice(0, k).map((r, i) => ({
    rank: i + 1,
    file: r.file || r.filePath || r.metadata?.file || null,
    name: r.name || r.metadata?.name || null,
    score: typeof r.score === 'number' ? Number(r.score.toFixed(4)) : null,
  }));
}

async function runOne(search, query, mode, topK) {
  const t0 = performance.now();
  let response = null, error = null;
  try {
    response = await search.search(query, { k: topK, mode, rerank: true, expand: false });
  } catch (e) {
    error = e.message;
  }
  const wallMs = performance.now() - t0;
  const top = topResultSummary(response?.results, topK);
  return {
    mode,
    wallMs: Number(wallMs.toFixed(2)),
    error,
    resultCount: response?.results?.length || 0,
    top,
    top1Score: top[0]?.score ?? null,
    top1File: top[0]?.file ?? null,
    routing: response?.stats?.routing || null,
  };
}

// Mirror evaluator.js: file/basename match against the docIdToFile map.
// Returns rank (1-based) when one of the top-k results corresponds to a gold
// doc_id, or 0 when not found, or null when no gold provided.
function goldHitAt(top, gold, k, docIdToFile) {
  if (!gold?.length) return null;
  if (!docIdToFile) return null;
  const relevantFiles = new Set();
  for (const docId of gold) {
    const fp = docIdToFile.get(docId);
    if (fp) {
      relevantFiles.add(fp);
      relevantFiles.add(path.basename(fp));
    }
  }
  if (!relevantFiles.size) return 0;
  for (let i = 0; i < Math.min(k, top.length); i++) {
    const t = top[i];
    const resultFile = t?.file || '';
    if (!resultFile) continue;
    const resultBasename = path.basename(resultFile);
    if (relevantFiles.has(resultFile) || relevantFiles.has(resultBasename)) return i + 1;
    for (const relFile of relevantFiles) {
      if (relFile && resultFile.endsWith(relFile)) return i + 1;
      if (resultFile && relFile.endsWith(resultFile)) return i + 1;
    }
  }
  return 0;
}

async function main() {
  const opts = parseArgs();
  const corpusDir = path.resolve(REPO_ROOT, opts.corpus);
  if (!existsSync(path.join(corpusDir, '.sweet-search'))) {
    process.stderr.write(`[forced-route-replay-offline] no .sweet-search index at ${corpusDir}\n`);
    process.exit(2);
  }

  // Init SweetSearch on the corpus directly. Bypasses the daemon entirely.
  process.env.SWEET_SEARCH_PROJECT_ROOT = corpusDir;
  const { SweetSearch } = await import(path.join(REPO_ROOT, 'core/search/sweet-search.js'));
  const search = new SweetSearch({ projectRoot: corpusDir, useLateInteraction: true });
  await search.init();

  // Build docIdToFile map for gold matching, when this is a GCSN-shaped corpus.
  // We mirror eval/lib/corpus.js's prepareCorpus output without re-writing files.
  let docIdToFile = null;
  const dataPath = path.join(REPO_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  if (existsSync(dataPath)) {
    const { prepareCorpus } = await import(path.join(REPO_ROOT, 'eval/lib/corpus.js'));
    const { loadJsonl } = await import(path.join(REPO_ROOT, 'eval/lib/data-loader.js'));
    const corpus = loadJsonl(dataPath);
    docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });
    process.stderr.write(`[forced-route-replay-offline] docIdToFile loaded: ${docIdToFile.size} entries\n`);
  }

  const queries = await loadQueries(opts);
  if (!queries.length) { process.stderr.write('no queries\n'); process.exit(2); }
  process.stderr.write(`[forced-route-replay-offline] running ${queries.length} queries × 4 modes against ${corpusDir}\n`);

  const records = [];
  let i = 0;
  for (const item of queries) {
    const query = item.query || item;
    if (!query) continue;
    i++;
    const expectedOracle = item.oracleRoute || null;
    const kind = item.kind || null;
    const language = item.language || null;
    const gold = item.gold || null;

    const auto = await runOne(search, query, 'auto', opts.topK);
    const forced = {};
    for (const mode of FORCED_MODES) {
      forced[mode] = await runOne(search, query, mode, opts.topK);
    }

    // Cheap top-1 score oracle
    const candidates = FORCED_MODES
      .map(m => ({ mode: m, score: forced[m].top1Score }))
      .filter(c => typeof c.score === 'number' && Number.isFinite(c.score));
    candidates.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    const inferredOracle = candidates[0]?.mode ?? null;

    // Gold-based oracle when available
    let goldOracle = null;
    let goldRanks = null;
    if (gold && gold.length && docIdToFile) {
      goldRanks = {};
      for (const m of FORCED_MODES) {
        goldRanks[m] = goldHitAt(forced[m].top, gold, opts.topK, docIdToFile);
      }
      // Best is lowest-rank-positive; ties broken by mode preference: lex < hyb < sem
      const cand = Object.entries(goldRanks).filter(([, r]) => typeof r === 'number' && r > 0);
      cand.sort((a, b) => a[1] - b[1]);
      goldOracle = cand[0]?.[0] ?? null;
    }

    records.push({
      query, queryHash: shortHash(query), queryLen: query.length, kind, language,
      expectedOracle,
      autoRoute: auto.routing?.mode ?? null,
      autoRouteMethod: auto.routing?.method ?? null,
      autoRouteConfidence: auto.routing?.confidence ?? null,
      autoRouterLatency_us: auto.routing?.latency_us ?? null,
      auto: { resultCount: auto.resultCount, top1Score: auto.top1Score, top: auto.top, wallMs: auto.wallMs },
      forced: { lexical: forced.lexical, semantic: forced.semantic, hybrid: forced.hybrid },
      inferredOracleByTop1Score: inferredOracle,
      goldOracle,
      goldRanks,
      autoMatchesInferredOracle: inferredOracle != null && (auto.routing?.mode === inferredOracle),
      autoMatchesGoldOracle: goldOracle != null ? (auto.routing?.mode === goldOracle) : null,
      autoMatchesExpectedOracle: expectedOracle != null && (auto.routing?.mode === expectedOracle),
    });
    if (i % 25 === 0) process.stderr.write(`  ... ${i}/${queries.length}\n`);
  }

  // Aggregate
  const agg = {
    queryCount: records.length,
    autoMatchesInferredOracleRate:
      records.filter(r => r.autoMatchesInferredOracle).length / records.length,
    autoMatchesExpectedOracleRate: (() => {
      const w = records.filter(r => r.expectedOracle != null);
      return w.length ? w.filter(r => r.autoMatchesExpectedOracle).length / w.length : null;
    })(),
    autoMatchesGoldOracleRate: (() => {
      const w = records.filter(r => r.goldOracle != null);
      return w.length ? w.filter(r => r.autoMatchesGoldOracle).length / w.length : null;
    })(),
    byKind: {},
  };
  for (const r of records) {
    const k = r.kind || 'unknown';
    if (!agg.byKind[k]) agg.byKind[k] = { count: 0, autoVsInferred: 0, autoVsGold: 0, goldEval: 0 };
    agg.byKind[k].count++;
    if (r.autoMatchesInferredOracle) agg.byKind[k].autoVsInferred++;
    if (r.goldOracle != null) {
      agg.byKind[k].goldEval++;
      if (r.autoMatchesGoldOracle) agg.byKind[k].autoVsGold++;
    }
  }

  const out = { timestamp: new Date().toISOString(), corpusDir, builtin: opts.builtin, agg, records };
  if (opts.outFile) {
    writeFileSync(opts.outFile, JSON.stringify(out, null, 2));
    process.stderr.write(`[forced-route-replay-offline] wrote ${opts.outFile}\n`);
  } else {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  }

  // No process.exit — let the SweetSearch instance shut down cleanly.
}

main().catch(err => {
  process.stderr.write(`[forced-route-replay-offline] error: ${err.stack || err.message}\n`);
  process.exit(1);
});
