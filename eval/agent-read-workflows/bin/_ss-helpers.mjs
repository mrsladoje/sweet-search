#!/usr/bin/env node
// Bench-local agent wrappers for Sweet Search. Each subcommand is a thin,
// agent-friendly skin over the JS API:
//   grep      → SweetSearch.bareGrep        (indexed lexical grep, gram-prefiltered)
//   find      → SweetSearch.patternSearch   (ColGrep — regex candidates, MaxSim re-rank)
//   read      → search-read.readFile        (filesystem-grounded read with optional line range)
//   semantic  → search-read-semantic.readSemantic (query-specific spans within one file)
//
// Output is compact, deterministic, agent-readable (one match per line for
// discovery; fenced code for reads). No colour codes. No JSON unless asked.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 8-char SHA1 prefix is enough for grouping identical queries across
// benchmark runs without bloating artifacts.
function shortQueryHash(q) {
  try { return createHash('sha1').update(String(q)).digest('hex').slice(0, 16); }
  catch { return null; }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// The agent's cwd is the target repo. SWEET_SEARCH_PROJECT_ROOT must point
// at the repo so DB_PATHS resolves to the repo's own .sweet-search/.
const PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();

if (!existsSync(path.join(PROJECT_ROOT, '.sweet-search', 'codebase.db'))) {
  process.stderr.write(
    `[ss-*] no Sweet Search index at ${PROJECT_ROOT}/.sweet-search/codebase.db\n` +
    `Run: SWEET_SEARCH_PROJECT_ROOT=${PROJECT_ROOT} node ${REPO_ROOT}/core/indexing/index-codebase-v21.js --full --sqlite-fast\n`
  );
  process.exit(2);
}
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

const subcommand = process.argv[2];
const rest = process.argv.slice(3);

function parseFlag(args, name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
function parseShortFlag(args, names, fallback) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) { const v = args[i + 1]; args.splice(i, 2); return v; }
  }
  return fallback;
}

async function getSweetSearch() {
  const { SweetSearch } = await import(path.join(REPO_ROOT, 'core/search/sweet-search.js'));
  const s = new SweetSearch({ projectRoot: PROJECT_ROOT });
  await s.init();
  return s;
}

async function ensureWarmServerReady({ timeoutMs = 60000, intervalMs = 500 } = {}) {
  const { isServerRunning, autoSpawnServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
  if (await isServerRunning()) return true;

  // autoSpawnServer has a short built-in timeout. It may return false while the
  // detached server is still finishing model/index load, so poll afterwards.
  await autoSpawnServer();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerRunning()) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

// --- subcommands ----------------------------------------------------------

async function cmdGrep(args) {
  const k = +parseShortFlag(args, ['-k', '--top'], 20);
  const regex = args[0];
  if (!regex) {
    process.stderr.write('Usage: ss-grep <regex> [-k N]\n');
    process.exit(2);
  }
  const s = await getSweetSearch();
  const result = await s.bareGrep(regex, null, { regex, maxMatches: k * 5, contextLines: 0 });
  // Group by file, take first k matches across all files (ordered as bareGrep returns).
  const grouped = new Map();
  for (const r of result.results.slice(0, k * 5)) {
    if (!grouped.has(r.file)) grouped.set(r.file, []);
    grouped.get(r.file).push(r);
  }
  let printed = 0;
  process.stdout.write(`# ss-grep: ${result.results.length} total match(es) for /${regex}/\n`);
  for (const [file, lines] of grouped) {
    for (const r of lines) {
      const text = (r.matchText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      process.stdout.write(`${file}:${r.line}: ${text}\n`);
      printed++;
      if (printed >= k) break;
    }
    if (printed >= k) break;
  }
  if (printed === 0) process.stdout.write('(no matches)\n');
  process.exit(0);
}

async function cmdFind(args) {
  const k = +parseShortFlag(args, ['-k', '--top'], 6);
  const regex = parseFlag(args, '--regex', '');
  const query = args[0];
  if (!query) {
    process.stderr.write('Usage: ss-find "<query>" --regex "<regex>" [-k N]\n');
    process.exit(2);
  }
  const effectiveRegex = regex || '';
  const s = await getSweetSearch();
  if (!s.hasLateInteractionIndex) {
    process.stderr.write(`[ss-find] no late-interaction index — falling back to ss-grep\n`);
    return cmdGrep([effectiveRegex || query, '-k', String(k)]);
  }
  const result = await s.patternSearch(query, null, {
    regex: effectiveRegex || `\\b\\w+\\b`,
    k,
    format: 'benchmark',
  });
  process.stdout.write(`# ss-find: ColGrep top ${result.results.length} for "${query}" /${effectiveRegex || '*'}/\n`);
  for (const r of result.results) {
    const sym = r.name ? ` [${r.type || 'code'}: ${r.name}]` : '';
    const preview = (r.text || '').split('\n')[0].slice(0, 140);
    process.stdout.write(`${r.file}:${r.startLine}-${r.endLine}${sym}\n  ${preview}\n`);
  }
  if (result.results.length === 0) process.stdout.write('(no matches)\n');
  process.exit(0);
}

async function cmdRead(args) {
  const file = args[0];
  if (!file) {
    process.stderr.write('Usage: ss-read <file>             # whole file\n');
    process.stderr.write('       ss-read <file> <start>     # ONE line\n');
    process.stderr.write('       ss-read <file> <start> <end>\n');
    process.exit(2);
  }
  // If start is provided and end is omitted, read EXACTLY that one line —
  // no open-ended start-to-EOF (which a previous version did and which
  // caused accidental over-reading on large files).
  let start = null, end = null;
  if (args[1] != null) {
    start = +args[1];
    if (!Number.isFinite(start) || start < 1) {
      process.stderr.write(`[ss-read] invalid start line: "${args[1]}"\n`);
      process.exit(2);
    }
    if (args[2] != null) {
      end = +args[2];
      if (!Number.isFinite(end) || end < start) {
        process.stderr.write(`[ss-read] invalid end line: "${args[2]}" (must be ≥ start ${start})\n`);
        process.exit(2);
      }
    } else {
      end = start;     // single-line read
    }
  }
  const { readFile } = await import(path.join(REPO_ROOT, 'core/search/search-read.js'));
  const r = await readFile({ path: file, projectRoot: PROJECT_ROOT, startLine: start ?? undefined, endLine: end ?? undefined });
  if (!r.ok) {
    process.stderr.write(`[ss-read] error: ${r.error}\n`);
    process.exit(1);
  }
  const range = r.range ? ` (lines ${r.range.startLine}-${r.range.endLine} of ${r.totalLines})` : ` (${r.totalLines} lines)`;
  const fence = r.language ? '```' + r.language : '```';
  process.stdout.write(`# ss-read ${r.file}${range}\n${fence}\n${r.text}\n\`\`\`\n`);
  process.exit(0);
}

async function cmdAgentSearch(args) {
  // Main sweet-search auto/CatBoost search with token-budgeted agent packaging.
  //
  // Usage:
  //   ss-search "<query>"                                  → format=agent (4k budget)
  //   ss-search "<query>" --full                           → format=agent_full (8k budget)
  //   ss-search "<query>" --xl                             → format=agent_full_xl (12k, gated)
  //   ss-search "<query>" -k 5                             → top-K results
  //   ss-search "<query>" --mode hybrid                    → force a mode (default: auto/CatBoost)
  //
  // Output is agent-readable: a meta header with routed mode + budget,
  // followed by per-result blocks with file/line + fenced code. A trailing
  // structured marker line `<<SS_ROUTE_META>>{...json...}` lets the bench
  // post-process parse routing/budget telemetry without affecting the agent.
  let format = 'agent';
  if (args.includes('--full')) { format = 'agent_full'; args.splice(args.indexOf('--full'), 1); }
  if (args.includes('--xl'))   { format = 'agent_full_xl'; args.splice(args.indexOf('--xl'), 1); }
  const k = +parseShortFlag(args, ['-k', '--top'], 5);
  const mode = parseFlag(args, '--mode', 'auto');
  const query = args[0];
  if (!query) {
    process.stderr.write('Usage: ss-search "<query>" [--full|--xl] [-k N] [--mode auto|lexical|semantic|hybrid]\n');
    process.exit(2);
  }

  const { queryServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
  const serverUsed = await ensureWarmServerReady();
  if (!serverUsed) {
    process.stderr.write('[ss-search] warm server is not ready; refusing cold direct search in benchmark wrapper\n');
    process.exit(1);
  }

  const response = await queryServer(query, { topK: k, mode, format });
  if (response?.error) {
    process.stderr.write(`[ss-search] server error: ${response.error}\n`);
    process.exit(1);
  }

  // REPO ISOLATION: refuse to return results from a daemon serving a different
  // repo. The bench harness uses /tmp/sweet-search.sock, which is a global socket;
  // a multi-repo bench fan-out previously reused a stale daemon and silently
  // returned cross-repo matches. Fail closed instead.
  const requestedProjectRoot = path.resolve(PROJECT_ROOT);
  const serverProjectRoot = response?.serverProjectRoot
    ? path.resolve(response.serverProjectRoot) : null;
  const repoMatches = serverProjectRoot != null && serverProjectRoot === requestedProjectRoot;
  if (!repoMatches) {
    process.stderr.write(
      `[ss-search] repo isolation violation: requested projectRoot=${requestedProjectRoot} ` +
      `but server reports serverProjectRoot=${serverProjectRoot ?? '<null>'}. ` +
      `Refusing to surface cross-repo results.\n`
    );
    // Emit a structured trailer anyway so the bench can capture the failure.
    const failMeta = {
      query,
      queryHash: shortQueryHash(query),
      queryLen: query.length,
      routedMode: response?.stats?.routing?.mode || null,
      routeConfidence: typeof response?.stats?.routing?.confidence === 'number'
        ? response.stats.routing.confidence : null,
      routeMethod: response?.stats?.routing?.method || null,
      routerLatency_us: typeof response?.stats?.routing?.latency_us === 'number'
        ? response.stats.routing.latency_us : null,
      serverUsed: true,
      serverProjectRoot,
      requestedProjectRoot,
      repoMatches: false,
      error: 'repo-isolation-mismatch',
    };
    process.stdout.write(`\n<<SS_ROUTE_META>>${JSON.stringify(failMeta)}\n`);
    process.exit(3);
  }

  // The packaged response shape comes from packageForAgent (or pattern's own
  // packager when CatBoost routes to pattern). Both include:
  //   .results[] with {rank, file, startLine, endLine, symbol, symbolType,
  //                    presentation, code, codeTokens, expansionKind, ...}
  //   .tokenBudget, .tokensUsed, .subMode, .confidence, .sufficient
  //   .stats.routing (when produced by the main pipeline)
  const routing = response.stats?.routing || {};
  const routedMode = routing.mode || 'pattern';
  const routeConfidence = typeof routing.confidence === 'number' ? routing.confidence : null;
  // Route attribution: where did the decision come from? Values produced by
  // core/query/query-router.js: 'file_pattern', 'wasm_catboost', 'wasm_rejected',
  // 'fallback_error', 'invalid_input', 'query_too_long', 'empty_query'. When
  // the user forced a mode, routing.method is undefined and routing.forced
  // is true.
  const routeMethod = routing.method || (routing.forced ? 'forced' : null);
  const routerLatency_us = typeof routing.latency_us === 'number' ? routing.latency_us : null;
  const tierCounts = (response.results || []).reduce((acc, r) => {
    acc[r.presentation] = (acc[r.presentation] || 0) + 1;
    return acc;
  }, {});
  const sandwichCount = (response.results || []).filter(r => r.expansionKind === 'sandwich').length;
  const neighborCount = (response.results || []).reduce((acc, r) => acc + (r.neighbors?.count || 0), 0);
  const headerCount = (response.results || []).filter(r => r.headerContext).length;

  // Header (visible to agent)
  const conf = routeConfidence != null ? ` conf=${routeConfidence.toFixed(2)}` : '';
  process.stdout.write(`# ss-search: routed=${routedMode}${conf} budget=${response.tokenBudget} used=${response.tokensUsed}` +
    ` results=${response.results.length} subMode=${response.subMode}\n`);
  if (response.confidence) {
    process.stdout.write(`# confidence=${response.confidence}${response.confidenceReason ? ' (' + response.confidenceReason + ')' : ''}` +
      `${response.sufficient ? ' sufficient=YES' : ' sufficient=no'}\n`);
  }

  // Per-result blocks
  for (const r of response.results || []) {
    const sym = r.symbol ? ` [${r.symbolType || 'code'}: ${r.symbol}]` : '';
    const kind = r.expansionKind ? ` kind=${r.expansionKind}` : '';
    const stale = r.stale ? ' STALE' : '';
    process.stdout.write(`\n## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym} (${r.presentation}${kind}${stale}) score=${(r.score || 0).toFixed(3)}\n`);
    if (r.headerContext) {
      process.stdout.write(`### imports\n\`\`\`\n${r.headerContext}\n\`\`\`\n`);
    }
    if (r.code) {
      process.stdout.write(`\`\`\`\n${r.code}\n\`\`\`\n`);
    } else if (r.summary) {
      process.stdout.write(`${r.summary}\n`);
    }
    // Render the 1-hop graph-neighbour tier directly under top-1's code block.
    // The package surfaces `r.neighbors` only on the rank that earned the
    // reservation (typically top-1). Each line carries `file:line` so the
    // agent can cite the neighbour without an extra search.
    if (r.neighbors && r.neighbors.rendered) {
      process.stdout.write(`### related (1-hop graph, ~${r.neighbors.tokens} tok)\n${r.neighbors.rendered}\n`);
    }
  }

  if (!response.results || response.results.length === 0) {
    process.stdout.write('(no matches)\n');
  }

  // Structured trailer for bench post-processing (audit/summariseRun can parse).
  // Route attribution fields (queryHash, routeMethod, routerLatency_us, query)
  // let downstream analysis link a routing decision to its query and
  // attribute failures to fast-path vs WASM vs fallback.
  const meta = {
    query,                     // exact query text (already bounded by SEARCH_SERVER_MAX_QUERY_LENGTH)
    queryHash: shortQueryHash(query),
    queryLen: query.length,
    routedMode,
    routeConfidence,
    routeMethod,
    routerLatency_us,
    serverUsed,
    serverProjectRoot,
    requestedProjectRoot,
    repoMatches,
    serverPid: response.serverPid ?? null,
    tokenBudget: response.tokenBudget,
    tokensUsed: response.tokensUsed,
    subMode: response.subMode,
    resultCount: response.results?.length || 0,
    tierCounts,
    sandwichCount,
    neighborCount,
    headerCount,
    confidence: response.confidence || null,
    sufficient: response.sufficient ?? null,
    sufficiencyReasons: Array.isArray(response.sufficiencyReasons) ? response.sufficiencyReasons : null,
    unresolvedExternalCount: typeof response.unresolvedExternalCount === 'number'
      ? response.unresolvedExternalCount : null,
  };
  process.stdout.write(`\n<<SS_ROUTE_META>>${JSON.stringify(meta)}\n`);
  process.exit(0);
}

async function cmdSemantic(args) {
  const file = args[0];
  const query = args[1];
  if (!file || !query) {
    process.stderr.write('Usage: ss-semantic <file> "<question>" [--max-tokens N]\n');
    process.exit(2);
  }
  const maxTokens = +parseFlag(args.slice(2), '--max-tokens', 800);
  const { readSemantic } = await import(path.join(REPO_ROOT, 'core/search/search-read-semantic.js'));
  const r = await readSemantic({
    path: file, query, projectRoot: PROJECT_ROOT,
    maxChars: maxTokens * 4, verbose: false,
  });
  if (!r.ok) {
    process.stderr.write(`[ss-semantic] error: ${r.reason || 'unknown'}\n`);
    process.exit(1);
  }
  process.stdout.write(`# ss-semantic ${r.file} | "${query}" | spans=${r.spans?.length ?? 0} | ~tokens=${r.approxTokensReturned}${r.fellBack ? ' [FALLBACK]' : ''}\n`);
  for (const span of r.spans || []) {
    const fence = r.language ? '```' + r.language : '```';
    const sym = span.symbols?.length ? ` [${span.symbols.join(', ')}]` : '';
    process.stdout.write(`### ${r.file}:${span.startLine}-${span.endLine}${sym}\n${fence}\n${span.text}\n\`\`\`\n`);
  }
  process.exit(0);
}

async function cmdTrace(args) {
  let json = false;
  if (args.includes('--json')) {
    json = true;
    args.splice(args.indexOf('--json'), 1);
  }
  const symbol = args[0];
  if (!symbol) {
    process.stderr.write('Usage: ss-trace <symbol> [--in <file>] [--query <hint>] [--depth N] [--budget N]\n');
    process.exit(2);
  }
  const { traceSymbol, formatStructuralContext } = await import(path.join(REPO_ROOT, 'core/search/search-trace.js'));

  const opts = { projectRoot: PROJECT_ROOT };
  const file = parseFlag(args, '--in', null) || parseFlag(args, '--file', null);
  const queryHint = parseFlag(args, '--query', '') || parseFlag(args, '--hint', '');
  const depth = parseFlag(args, '--depth', null);
  const budget = parseFlag(args, '--budget', null);
  if (file) opts.filePath = file;
  if (queryHint) opts.queryHint = queryHint;
  if (depth != null) opts.maxDepth = +depth;
  if (budget != null) opts.tokenBudget = +budget;

  const response = traceSymbol(symbol, opts);
  if (json) process.stdout.write(JSON.stringify(response, null, 2) + '\n');
  else process.stdout.write(formatStructuralContext(response) + '\n');

  const meta = {
    symbol,
    queryHash: shortQueryHash(`${symbol}:${queryHint || ''}`),
    target: response.target ? {
      name: response.target.name,
      type: response.target.type,
      file: response.target.filePath,
      startLine: response.target.startLine,
    } : null,
    tokenBudget: response.tokenBudget,
    tokensUsed: response.tokensUsed,
    budgetTier: response.budgetTier,
    budgetReason: response.budgetReason,
    callers: response.sections?.callers?.total || 0,
    callees: response.sections?.callees?.total || 0,
    impactPaths: response.sections?.impact?.total || 0,
    latencyMs: response.stats?.latencyMs ?? null,
    sufficient: !!response.target,
  };
  process.stdout.write(`\n<<SS_TRACE_META>>${JSON.stringify(meta)}\n`);
  process.exit(response.target ? 0 : 1);
}

(async () => {
  try {
    if (subcommand === 'grep') await cmdGrep(rest);
    else if (subcommand === 'find') await cmdFind(rest);
    else if (subcommand === 'read') await cmdRead(rest);
    else if (subcommand === 'semantic') await cmdSemantic(rest);
    else if (subcommand === 'trace') await cmdTrace(rest);
    else if (subcommand === 'agent-search') await cmdAgentSearch(rest);
    else { process.stderr.write(`unknown subcommand: ${subcommand}\n`); process.exit(2); }
  } catch (err) {
    process.stderr.write(`[ss-*] crash: ${err.stack || err.message || err}\n`);
    process.exit(1);
  }
})();

// Mark unused for lint:
void readFileSync;
