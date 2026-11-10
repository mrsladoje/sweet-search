// ss-search: the routed search of the warm daemon with token-budgeted agent packaging.

import path from 'node:path';
import { normalizeArgs, renderSufficiency } from '../argparse.mjs';
import { searchNotReadyLine, callStartedMs } from '../tools.js';
import { formatRouteMetadata } from '../../search/search-format.js';
import { collectAgentShownSpans, renderShownFullTrailer } from '../../search/agent-span-ledger.js';
import { renderFixedBlocks, resultRenderFixActive, resultsForOriginalLedger } from '../../search/agent-output-fixes.js';
import {
  REPO_ROOT, shortQueryHash, gutter, recordAgentToolCall, planFixedResults, alreadyShownFor, resolvePositional,
  readPositiveIntFlag, readValueFlag, ensureWarmServerReady, compactSufficiencyLine,
} from './shared.mjs';

const SEARCH_USAGE = 'Usage: ss-search "<query>" [--full|--xl] [-k N] [--mode auto|lexical|semantic|hybrid]';

export async function cmdAgentSearch(ctx, rawArgs) {
  const args = normalizeArgs(rawArgs);
  // Main sweet-search auto/CatBoost search with token-budgeted agent packaging.
  //
  // Usage:
  //   ss-search "<query>"                                  → format=agent (auto-pick 3k/8k/12k)
  //   ss-search "<query>" --full                           → force 8k (rarely needed; default auto-picks)
  //   ss-search "<query>" --xl                             → force 12k (rarely needed; default auto-picks)
  //   ss-search "<query>" -k 5                             → top-K results
  //   ss-search "<query>" --mode hybrid                    → force a mode (default: auto/CatBoost)
  //
  // Output is agent-readable: a meta header with routed mode + budget,
  // followed by per-result blocks with file/line + fenced code and one compact
  // actionable route trailer. SWEET_SEARCH_ROUTE_META_DEBUG=1 restores the
  // complete JSON trailer for routing diagnostics.
  let format = 'agent';
  if (args.includes('--full')) { format = 'agent_full'; args.splice(args.indexOf('--full'), 1); }
  if (args.includes('--xl'))   { format = 'agent_full_xl'; args.splice(args.indexOf('--xl'), 1); }
  const k = readPositiveIntFlag(args, ['-k', '--top'], 5, SEARCH_USAGE);
  const mode = readValueFlag(args, '--mode', 'auto', SEARCH_USAGE);
  const query = resolvePositional(args, SEARCH_USAGE);
  if (!query) {
    process.stderr.write(SEARCH_USAGE + '\n');
    process.exit(2);
  }

  // The budget counts from the start of the agent's command (the native client may already
  // have waited for the socket, and the daemon route for the indexes).
  const waitStart = callStartedMs(process.env);
  const warm = await ensureWarmServerReady(ctx, { startedMs: waitStart });
  if (warm !== 'ready') {
    process.stderr.write(searchNotReadyLine(Math.round((Date.now() - waitStart) / 1000), warm === 'failed'));
    process.exit(1);
  }

  // Budget-sweep experiment hook: per-request explicit budget (overrides the
  // auto-tier on the warm server; flows as the `budget` URL param).
  const envSearchBudget = Number(process.env.SS_SMOKE_SEARCH_BUDGET || '') || null;
  const { queryServer } = await import(path.join(REPO_ROOT, 'core/search/search-client.js'));
  const response = await queryServer(query, {
    topK: k, mode, format, projectRoot: ctx.projectRoot, trackAgentSpans: false,
    ...(envSearchBudget ? { tokenBudget: envSearchBudget } : {}),
    ...(ctx.fix.searchFirstUnit ? { firstUnit: ctx.fix.searchFirstUnit } : {}),
  });
  if (response?.error) {
    process.stderr.write(`[ss-search] server error: ${response.error}\n`);
    process.exit(1);
  }

  // REPO ISOLATION: refuse to return results from a daemon serving a different
  // repo. The bench harness uses /tmp/sweet-search.sock, which is a global socket;
  // a multi-repo bench fan-out previously reused a stale daemon and silently
  // returned cross-repo matches. Fail closed instead.
  const requestedProjectRoot = path.resolve(ctx.projectRoot);
  const serverProjectRoot = response?.serverProjectRoot
    ? path.resolve(response.serverProjectRoot) : null;
  const repoMatches = serverProjectRoot != null && serverProjectRoot === requestedProjectRoot;
  if (!repoMatches) {
    process.stderr.write(
      `[ss-search] repo isolation violation: requested projectRoot=${requestedProjectRoot} ` +
      `but server reports serverProjectRoot=${serverProjectRoot ?? '<null>'}. ` +
      `Refusing to surface cross-repo results.\n`
    );
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
    process.stdout.write(`\n${formatRouteMetadata(failMeta, {
      _isAgentFormat: true,
      debug: process.env.SWEET_SEARCH_ROUTE_META_DEBUG === '1',
    })}\n`);
    process.exit(3);
  }
  // Output-fix switches: plan the printed entries first (dedupe / one-per-file / caps), so both
  // ledgers learn only what this call prints. With every switch off `plan` is null and this is
  // the original.
  const renderFix = resultRenderFixActive(ctx.fix, { alreadyShownActive: ctx.alreadyShownOn });
  const plan = renderFix ? planFixedResults(ctx, response.results || [], { k, find: false }) : null;
  const shownSpans = ctx.spanPolicyEnabled
    ? collectAgentShownSpans(resultsForOriginalLedger(response.results, plan), { projectRoot: ctx.fileRoot }) : [];
  await recordAgentToolCall(ctx, { spans: shownSpans, query });
  const alreadyShown = await alreadyShownFor(ctx, response.results || [], plan);

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

  // SS_FIX_A: no query header (the agent wrote the query), the compact `# sufficient=YES` line
  // instead of the confidence line; the route trailer goes to stderr (below).
  const conf = routeConfidence != null ? ` conf=${routeConfidence.toFixed(2)}` : '';
  if (!ctx.fix.compact) {
    process.stdout.write(`# ss-search: routed=${routedMode}${conf} budget=${response.tokenBudget} used=${response.tokensUsed}` +
      ` results=${response.results.length} subMode=${response.subMode}\n`);
  }
  // final-tuning: proves a bench run executes this tree's helpers (off = byte-identical).
  if (process.env.SS_VARIANT_SENTINEL === '1') process.stdout.write('# variant-sentinel: final-tuning worktree\n');
  if (ctx.fix.compact) process.stdout.write(compactSufficiencyLine(ctx, response));
  if (!ctx.fix.compact && response.confidence) {
    process.stdout.write(`# confidence=${response.confidence}${response.confidenceReason ? ' (' + response.confidenceReason + ')' : ''}` +
      `${renderSufficiency(response)}\n`);
  }

  // final-tuning variant SS_VARIANT_SEARCH_DEDUPE=1 (default off = byte-identical): print no
  // repeated information. A summary entry whose span lies inside a span already listed above, or
  // that names the same file + symbol as an entry above, is dropped; a summary line that only
  // restates its own header (`file:line — symbol (kind)`) is not printed.
  const seenSpans = [];
  if (renderFix) {
    process.stdout.write(renderFixedBlocks(response.results || [], plan, {
      compact: ctx.fix.compact, omitted: alreadyShown, dropRestatingSummary: ctx.dedupe, gutter,
    }));
  } else
  for (const r of response.results || []) {
    if (ctx.dedupe) {
      const covered = seenSpans.some(x => x.file === r.file && ((r.startLine >= x.start && r.endLine <= x.end) || (r.symbol && x.symbol === r.symbol)));
      seenSpans.push({ file: r.file, start: r.startLine, end: r.endLine, symbol: r.symbol || null });
      if (covered && r.presentation === 'summary') continue;
    }
    const sym = r.symbol ? ` [${r.symbolType || 'code'}: ${r.symbol}]` : '';
    const kind = r.expansionKind ? ` kind=${r.expansionKind}` : '';
    const stale = r.stale ? ' STALE' : '';
    process.stdout.write(`\n## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym} (${r.presentation}${kind}${stale}) score=${(r.score || 0).toFixed(3)}\n`);
    if (r.headerContext) {
      process.stdout.write(`### imports\n\`\`\`\n${r.headerContext}\n\`\`\`\n`);
    }
    if (r.code) {
      process.stdout.write(`\`\`\`\n${gutter(r.code, r.startLine)}\n\`\`\`\n`);
    } else if (r.summary && !(ctx.dedupe && /^\S+:\d+ — .+ \([^)]*\)$/.test(String(r.summary).trim()))) {
      process.stdout.write(`${r.summary}\n`);
    }
    // Render the 1-hop graph-neighbour tier directly under top-1's code block.
    // The package surfaces `r.neighbors` only on the rank that earned the
    // reservation (typically top-1). Each line carries `file:line` so the
    // agent can cite the neighbour without an extra search.
    if (r.neighbors && r.neighbors.rendered) {
      process.stdout.write(`### related (1-hop graph, ~${r.neighbors.tokens} tok)\n${r.neighbors.rendered}\n`);
    }
    // Same-file span map (top-1, windowed chunk, verdict != YES): sibling
    // symbols just outside the shown window + a copy-paste drill-in command.
    if (r.sameFile && r.sameFile.rendered) {
      process.stdout.write(`${r.sameFile.rendered}\n`);
    }
    // Same-file identifier family of a method/function top-1, with code lines.
    if (r.siblingLine?.rendered) process.stdout.write(`${r.siblingLine.rendered}\n`);
    if (r.continuation?.rendered) {
      process.stdout.write(`${r.continuation.rendered}\n`);
      if (r.continuation.kind === 'symbol' && r.continuation.code) {
        process.stdout.write(`\`\`\`\n${r.continuation.code}\n\`\`\`\n`);
      }
    }
    if (r.familyManifest?.rendered) process.stdout.write(`${r.familyManifest.rendered}\n`);
  }

  if (!renderFix && (!response.results || response.results.length === 0)) {
    process.stdout.write('(no matches)\n');
  }
  const shownTrailer = (ctx.shownSpanTrailer && !ctx.fix.compact) ? renderShownFullTrailer(shownSpans) : '';
  if (shownTrailer) process.stdout.write(`\n${shownTrailer}\n`);

  // Keep complete metadata available to the debug serializer, while normal
  // agent output receives only the fields that can change its next action.
  const meta = {
    query,                     // exact query text (already bounded by SEARCH_SERVER_MAX_QUERY_LENGTH)
    queryHash: shortQueryHash(query),
    queryLen: query.length,
    routedMode,
    routeConfidence,
    routeMethod,
    routerLatency_us,
    serverUsed: true,
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
    sufficiencyVerdict: response.sufficiencyVerdict ?? null,
    sufficiencyReason: response.sufficiencyReason ?? null,
    sufficiencyReasons: Array.isArray(response.sufficiencyReasons) ? response.sufficiencyReasons : null,
    unresolvedExternalCount: typeof response.unresolvedExternalCount === 'number'
      ? response.unresolvedExternalCount : null,
    sameFileMapTokens: response.results?.[0]?.sameFile?.tokens ?? null,
    sameFileNeighborCount: response.results?.[0]?.sameFile?.neighbors?.length ?? null,
  };
  const routeLine = formatRouteMetadata(meta, {
    _isAgentFormat: true,
    debug: process.env.SWEET_SEARCH_ROUTE_META_DEBUG === '1',
  });
  // SS_FIX_A (A1): the route trailer goes to stderr (the agent never sees it; the wrapper drops
  // stderr on exit 0). A script that runs this file directly can still read it.
  if (ctx.fix.compact) process.stderr.write(`${routeLine}\n`);
  else process.stdout.write(`\n${routeLine}\n`);
  process.exit(0);
}
