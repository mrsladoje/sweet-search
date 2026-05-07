#!/usr/bin/env node
/**
 * Forced-Route Replay — minimal scaffold.
 *
 * For each query, runs the **search-only** pipeline four times — under
 * `auto`, `lexical`, `semantic`, `hybrid` — and records what each route
 * returned. This is the cheap, deterministic part of the forced-route
 * methodology: no agent, no LLM judge, no token cost. The artifact lets
 * us see, per query:
 *
 *   - which route the auto-router actually picked
 *   - what each of the three forced routes returned (count, top paths, top
 *     scores, server latency)
 *   - a simple oracle proxy: whichever forced route has the highest top-1
 *     score wins (not perfect — answerability needs a real judge — but it
 *     surfaces obvious mis-routings without an agent in the loop)
 *
 * Out of scope for this scaffold:
 *   - any LLM-as-judge step (deferred — requires explicit user approval)
 *   - any agent run (deferred — expensive)
 *
 * Inspired by DAT (Hsu & Tzeng, 2025) and SelRoute (McKee, 2026), which
 * both run multiple retrievers per query and pick the winner. Their
 * scoring uses an LLM judge; this scaffold uses top-1 result score as a
 * cheap stand-in until a judge is wired in.
 *
 * Usage:
 *   # supply queries on stdin (one per line):
 *   echo "how does authentication work" | node scripts/forced-route-replay.mjs
 *
 *   # supply a queries.json with [{ "query": "..." }, ...]:
 *   node scripts/forced-route-replay.mjs --queries probes.json
 *
 *   # use the path-detector probe set:
 *   node scripts/forced-route-replay.mjs --builtin path-probes
 *
 * Requires a running sweet-search daemon for the target repo; the script
 * will not auto-spawn one because daemon spawn has cross-repo isolation
 * implications that belong to the bench harness.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

import {
  queryServer,
  isServerRunning,
} from '../core/search/search-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const FORCED_MODES = ['lexical', 'semantic', 'hybrid'];

// Minimal built-in probe set. Keeps the scaffold self-contained for the
// path-fast-path tightening we just shipped — these are the queries we
// most want to see attribution for in the forced-route artifact.
const BUILTIN_PROBES = {
  'path-probes': [
    // True paths — should auto-route lexical via file_pattern
    { query: 'core/query/query-router.js', oracleRoute: 'lexical', kind: 'true-path' },
    { query: 'package.json', oracleRoute: 'lexical', kind: 'true-path' },
    { query: 'src/server/index.ts', oracleRoute: 'lexical', kind: 'true-path' },
    // Ambiguous slash queries — should auto-route via WASM (NOT file_pattern)
    { query: 'HTTP/2 server setup', oracleRoute: 'semantic', kind: 'nl-slash' },
    { query: 'file/function relationship', oracleRoute: 'semantic', kind: 'nl-slash' },
    { query: 'request/response lifecycle', oracleRoute: 'semantic', kind: 'nl-slash' },
    { query: 'and/or behavior', oracleRoute: 'hybrid', kind: 'nl-slash' },
    // Identifiers
    { query: 'AuthService', oracleRoute: 'lexical', kind: 'identifier' },
    // NL questions
    { query: 'how does authentication work', oracleRoute: 'semantic', kind: 'nl-question' },
    // Hybrid-shaped
    { query: 'jwt token', oracleRoute: 'hybrid', kind: 'hybrid' },
  ],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { queriesPath: null, builtin: null, topK: 5, outFile: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--queries') out.queriesPath = args[++i];
    else if (args[i] === '--builtin') out.builtin = args[++i];
    else if (args[i] === '--top-k' || args[i] === '-k') out.topK = +args[++i];
    else if (args[i] === '--out') out.outFile = args[++i];
  }
  return out;
}

async function loadQueries({ queriesPath, builtin }) {
  if (builtin) {
    const set = BUILTIN_PROBES[builtin];
    if (!set) throw new Error(`unknown builtin: ${builtin}. Known: ${Object.keys(BUILTIN_PROBES).join(', ')}`);
    return set;
  }
  if (queriesPath) {
    const data = JSON.parse(readFileSync(queriesPath, 'utf-8'));
    if (Array.isArray(data)) return data;
    if (data.queries) return data.queries;
    throw new Error('queries file must be an array or have a .queries field');
  }
  // stdin: one query per line
  const stdin = readFileSync(0, 'utf-8');
  return stdin.split('\n').map(l => l.trim()).filter(Boolean).map(q => ({ query: q }));
}

function shortHash(q) {
  return createHash('sha1').update(String(q)).digest('hex').slice(0, 16);
}

function topResultSummary(response, k) {
  const results = (response?.results || []).slice(0, k);
  return results.map((r, i) => ({
    rank: i + 1,
    file: r.file || r.file_path || (r.metadata && r.metadata.file) || null,
    startLine: r.startLine ?? r.start_line ?? null,
    endLine: r.endLine ?? r.end_line ?? null,
    score: typeof r.score === 'number' ? Number(r.score.toFixed(4)) : null,
    symbol: r.symbol || r.name || (r.metadata && r.metadata.name) || null,
  }));
}

async function runOne(query, mode, topK) {
  const t0 = performance.now();
  let response = null;
  let error = null;
  try {
    response = await queryServer(query, { mode, topK });
  } catch (e) {
    error = e.message;
  }
  const wallMs = performance.now() - t0;
  const top = topResultSummary(response, topK);
  const top1Score = top[0]?.score ?? null;
  return {
    mode,
    wallMs: Number(wallMs.toFixed(2)),
    error,
    resultCount: response?.results?.length || 0,
    top,
    top1Score,
    routing: response?.stats?.routing || null,
    server_ms: response?.stats?.server_ms ?? null,
    serverProjectRoot: response?.serverProjectRoot ?? null,
  };
}

async function main() {
  const opts = parseArgs();

  if (!(await isServerRunning())) {
    process.stderr.write('[forced-route-replay] sweet-search daemon is not running.\n');
    process.stderr.write('  Start it for the target repo, then re-run this script.\n');
    process.exit(2);
  }

  const queries = await loadQueries(opts);
  if (!queries.length) {
    process.stderr.write('[forced-route-replay] no queries provided.\n');
    process.exit(2);
  }

  const records = [];
  for (const item of queries) {
    const query = item.query || item;
    const expectedOracle = item.oracleRoute || null;
    const kind = item.kind || null;

    // 1) auto — what does the router actually pick?
    const auto = await runOne(query, 'auto', opts.topK);

    // 2) forced runs
    const forced = {};
    for (const mode of FORCED_MODES) {
      forced[mode] = await runOne(query, mode, opts.topK);
    }

    // Cheap oracle proxy: highest top-1 score wins. This is a stand-in for a
    // real answerability judge. Documented as such — do not treat as ground
    // truth for routing accuracy.
    const candidates = FORCED_MODES
      .map(m => ({ mode: m, score: forced[m].top1Score }))
      .filter(c => typeof c.score === 'number' && Number.isFinite(c.score));
    candidates.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    const inferredOracle = candidates[0]?.mode ?? null;

    records.push({
      query,
      queryHash: shortHash(query),
      queryLen: query.length,
      kind,
      expectedOracle,
      autoRoute: auto.routing?.mode || auto.routing?.method || null,
      autoRouteMethod: auto.routing?.method || null,
      autoRouteConfidence: auto.routing?.confidence ?? null,
      autoRouterLatency_us: auto.routing?.latency_us ?? null,
      auto: { resultCount: auto.resultCount, top1Score: auto.top1Score, top: auto.top, wallMs: auto.wallMs },
      forced: {
        lexical: forced.lexical,
        semantic: forced.semantic,
        hybrid: forced.hybrid,
      },
      inferredOracleByTop1Score: inferredOracle,
      autoMatchesInferredOracle: inferredOracle != null && (auto.routing?.mode === inferredOracle),
      autoMatchesExpectedOracle: expectedOracle != null && (auto.routing?.mode === expectedOracle),
    });
  }

  const summary = {
    timestamp: new Date().toISOString(),
    queryCount: records.length,
    autoMatchesInferredOracleRate:
      records.filter(r => r.autoMatchesInferredOracle).length / records.length,
    autoMatchesExpectedOracleRate: (() => {
      const withExp = records.filter(r => r.expectedOracle != null);
      return withExp.length ? withExp.filter(r => r.autoMatchesExpectedOracle).length / withExp.length : null;
    })(),
    records,
  };

  if (opts.outFile) {
    writeFileSync(opts.outFile, JSON.stringify(summary, null, 2));
    process.stderr.write(`[forced-route-replay] wrote ${opts.outFile}\n`);
  } else {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  }
}

main().catch(err => {
  process.stderr.write(`[forced-route-replay] error: ${err.stack || err.message}\n`);
  process.exit(1);
});

void REPO_ROOT;
