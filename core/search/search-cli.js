/**
 * Search CLI Module
 *
 * Extracted from sweet-search.js (SOLID refactor). Argument parsing + runCli.
 * Decoration rendering lives in cli-decoration.js; the where-to-emit decision
 * lives in output-policy.js.
 *
 * IMPORTANT: Uses dynamic import() for sweet-search.js and search-server.js
 * references to avoid circular dependencies.
 */

import { existsSync } from 'fs';
import { LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { registerAutoPersistOnExit } from '../embedding/embedding-service.js';
import {
  formatResults as formatSearchResults,
  formatStructuralResults,
  formatSummaryFirst,
  formatMiddleRes,
} from './search-format.js';
import { detectOutputPolicy } from './output-policy.js';
import { emitDecoration } from './cli-decoration.js';

// =============================================================================
// CLI entry point
// =============================================================================

export async function runCli(args) {
  // Dynamic imports to avoid circular dependencies
  const { default: SweetSearch } = await import('./sweet-search.js');
  const { startServer, queryServer, isServerRunning, autoSpawnServer
        } = await import('./search-server.js');
  const { projectSocketPath } = await import('./server-identity.js');

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Sweet Search v2.3 - Unified Code Search with Auto-Warm Server

Usage:
  sweet-search <query> [options]
  sweet-search grep <pattern> [options]
  sweet-search init [--profile <profile>]    Initialize Sweet Search
  sweet-search --stop                        Stop warm server

Options:
  --mode <mode>     Search mode: auto, lexical, semantic, hybrid, pattern (default: auto)
  -e, --regex <pat> Regex pattern for pattern mode (implies --mode=pattern)
  --top, -k <n>     Number of results (default: 10)
  --type <kind>     Bare grep symbol type filter: function|class|method|import|type|other
  --no-expand       Disable graph expansion
  --no-rerank       Disable reranking
  --fusion <type>   Legacy: cc or rrf (ignored for hybrid - always uses robust CC fusion)
  --late-interaction Enable late interaction reranking (if index available)
  --late-interaction-model=ID Use specific model (lateon-code or lateon-code-edge)
  --agent           Agent mode: self-contained code blocks. Auto-picks 3k/8k/12k
                    tier from score-distribution signals (top-1 dominance,
                    entropy, candidate-pool breadth) — no need to choose a tier.
  --agent-preview   Force the 4k preview tier (rarely needed; --agent auto-picks)
  --agent-full      Force the 8k full tier (rarely needed; --agent auto-picks)
  --agent-full-xl   Force the 12k XL tier; gated on top-1 dominance ≥ 2× top-2
  --budget <n>      Explicit total token budget (overrides auto-tier; --agent
                    keeps it as the format)
  --summary         HCGS summary-first output (10x token reduction)
  --mid             Middle-res view: signature + docstring (5x token reduction)
  --json            Output as JSON
  --format <fmt>    Output format: plain (no banner/color), json
  --no-banner       Suppress the decorative banner (keep text results)
  --verbose, -v     Enable verbose logging

Decoration is auto by default (shown only where it is token-free). Override with
SWEET_SEARCH_DECORATION=never (always plain) or =always (force the banner onto
stdout even when captured — you accept the added token cost). NO_COLOR disables
ANSI color.
  --cold            Force cold start (skip auto-start server)
  --serve           Manually start server (usually not needed)

Auto-Warm Server (automatic):
  The server automatically starts on first search and stays warm:
  - First search: ~1-2s (server startup + index load)
  - Subsequent:   ~6-10ms lexical, ~275ms semantic (warm cache)

  Server runs in background until explicitly stopped or system restart.

Examples:
  sweet-search "AuthService"                              # Auto-starts server, uses warm cache
  sweet-search "how does auth work"                       # Semantic search
  sweet-search -e "class.*Service" "authentication"       # Pattern: regex + semantic ranking
  sweet-search --regex "fn.*sort" "sorting algorithm"     # Pattern: regex + semantic ranking
  sweet-search grep "class\\s+Auth\\w+Service"            # Bare grep (no semantic ranking)
  sweet-search grep "auth.*handler" --type function       # Bare grep filtered to function chunks
  sweet-search "auth" --cold                              # Skip server, cold start only
  sweet-search --stop                                     # Stop warm server
`);
    process.exit(0);
  }

  // Handle --serve
  if (args[0] === '--serve') {
    await startServer();
  } else if (args[0] === '--stop') {
    try {
      const http = await import('http');
      const requestStop = (requestOptions) => new Promise((resolve, reject) => {
        const req = http.request(requestOptions, (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({
            statusCode: res.statusCode || 0,
            body: body.trim(),
          }));
        });

        req.on('error', reject);
        req.setTimeout(1500, () => req.destroy(new Error('timeout')));
        req.end();
      });

      // Stop this project's server via its per-project Unix socket (C3). No
      // legacy/global fallback — that would risk stopping another project's
      // server.
      const socketPath = projectSocketPath();
      let stopResponse = null;
      if (existsSync(socketPath)) {
        stopResponse = await requestStop({ socketPath, path: '/stop', method: 'GET' });
      } else {
        stopResponse = { statusCode: 0, body: 'no server running for this project' };
      }

      if (stopResponse.statusCode === 200) {
        console.log('Stop signal sent');
      } else {
        const message = stopResponse.body || `HTTP ${stopResponse.statusCode}`;
        console.log(`Stop request failed: ${message}`);
      }
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      console.log('Server not running');
    }
  } else {
    const isGrepCommand = args[0] === 'grep';
    // Normal query mode
    let query = '';
    let mode = 'auto';
    let regex = '';
    let topK = 10;
    let maxMatches = 0;
    let contextLines = 0;
    let fixedString = false;
    let symbolType = '';
    const globs = [];
    let literalFilter = true;
    let gramIndex = true;
    let expand = true;
    let rerank = true;
    let fusion = 'cc';
    let useLateInteraction = LATE_INTERACTION_CONFIG.enabled;
    let json = false;
    let outputFormat = null;    // e.g. 'plain' — disables decoration but keeps text results
    let noBanner = false;
    let verbose = false;
    let summaryFirst = false;
    let middleRes = false;
    let forceCold = false;
    let agentFormat = null;     // null | 'agent_preview' | 'agent_full' | 'agent_full_xl'
    let agentBudget = null;

    for (let i = isGrepCommand ? 1 : 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--mode' && args[i + 1]) {
        mode = args[++i];
      } else if ((arg === '-e' || arg === '--regex') && args[i + 1]) {
        regex = args[++i];
        mode = 'pattern';
      } else if ((arg === '-C' || arg === '--context') && args[i + 1]) {
        contextLines = parseInt(args[++i], 10);
      } else if ((arg === '--max-matches' || arg === '-m') && args[i + 1]) {
        maxMatches = parseInt(args[++i], 10);
      } else if (arg === '-F' || arg === '--fixed-strings') {
        fixedString = true;
      } else if (arg === '--type' && args[i + 1]) {
        symbolType = args[++i];
      } else if (arg === '--glob' && args[i + 1]) {
        globs.push(args[++i]);
      } else if (arg === '--no-index') {
        gramIndex = false;
      } else if (arg === '--no-literal-filter') {
        literalFilter = false;
      } else if (arg === '--no-gram-index') {
        gramIndex = false;
      } else if ((arg === '--top' || arg === '-k') && args[i + 1]) {
        topK = parseInt(args[++i], 10);
      } else if (arg === '--no-expand') {
        expand = false;
      } else if (arg === '--no-rerank') {
        rerank = false;
      } else if (arg === '--fusion' && args[i + 1]) {
        fusion = args[++i];
      } else if (arg === '--late-interaction') {
        useLateInteraction = true;
      } else if (arg === '--no-late-interaction') {
        useLateInteraction = false;
      } else if (arg.startsWith('--late-interaction-model=')) {
        useLateInteraction = true;
        const { LATE_INTERACTION_CONFIG } = await import('../infrastructure/config/index.js');
        LATE_INTERACTION_CONFIG.model = arg.split('=')[1];
      } else if (arg === '--json') {
        json = true;
      } else if (arg === '--no-banner') {
        noBanner = true;
      } else if (arg === '--format' && args[i + 1]) {
        outputFormat = args[++i];
        if (outputFormat === 'json') json = true;
      } else if (arg.startsWith('--format=')) {
        outputFormat = arg.slice('--format='.length);
        if (outputFormat === 'json') json = true;
      } else if (arg === '--summary') {
        summaryFirst = true;
      } else if (arg === '--mid') {
        middleRes = true;
      } else if (arg === '--verbose' || arg === '-v') {
        verbose = true;
      } else if (arg === '--cold') {
        forceCold = true;
      } else if (arg === '--agent') {
        // 'agent' triggers auto-tier selection (preview/full/xl picked from
        // top-1 dominance, entropy, and candidate-pool breadth). Power users
        // can still force a specific tier with --agent-preview / --agent-full
        // / --agent-full-xl.
        agentFormat = agentFormat || 'agent';
      } else if (arg === '--agent-preview') {
        agentFormat = 'agent_preview';
      } else if (arg === '--agent-full') {
        agentFormat = 'agent_full';
      } else if (arg === '--agent-full-xl') {
        agentFormat = 'agent_full_xl';
      } else if (arg === '--budget' && args[i + 1]) {
        agentBudget = parseInt(args[++i], 10);
        // Pair an explicit numeric budget with auto-tier so the response's
        // budgetReason reflects 'explicit_budget' rather than a tier override.
        agentFormat = agentFormat || 'agent';
      } else if (!arg.startsWith('--')) {
        query = arg;
      }
    }

    if (isGrepCommand) {
      mode = 'grep';
      regex = regex || query;
      rerank = false;
      expand = false;
    }

    if (!query) {
      console.error('Error: Query required');
      process.exit(1);
    }

    // Decide where decoration may go (token-free channels only). Computed once;
    // both the warm and cold paths consult it.
    const outputPolicy = detectOutputPolicy({
      json,
      format: outputFormat,
      noBanner,
      env: process.env,
      stream: process.stdout,
    });

    // Check if warm server is running (unless --cold)
    let serverRunning = !forceCold && await isServerRunning();

    // Auto-start server if not running (unless --cold)
    if (!serverRunning && !forceCold) {
      serverRunning = await autoSpawnServer();
    }

    if (serverRunning) {
      // Use warm server (fast path)
      try {
        const response = await queryServer(query, {
          mode,
          regex,
          topK,
          maxMatches,
          contextLines,
          fixedString,
          type: symbolType,
          globs,
          literalFilter,
          gramIndex,
          expand,
          rerank,
          fusion,
          useLateInteraction,
          summary: summaryFirst,
          mid: middleRes,
          ...(agentFormat && { format: agentFormat, ...(agentBudget && { tokenBudget: agentBudget }) }),
        });

        if (response.error) {
          console.error('Server error:', response.error);
          process.exit(1);
        }

        // Agent mode: response is already a fully packaged agent response
        if (response.format === 'agent') {
          console.log(JSON.stringify(response, null, 2));
        } else {
          const { results, stats } = response;

          if (json) {
            console.log(JSON.stringify({ results, stats }, null, 2));
          } else {
            emitDecoration(outputPolicy, query, stats, true);

            // Use pure formatting helpers (no full SweetSearch instantiation needed).
            // Contract note: formatResults currently only depends on `this` for
            // structural delegation via this.formatStructuralResults(...).
            // If search-format.js adds more `this.*` usages, revisit this context.
            const formatContext = { formatStructuralResults };
            if (stats.path === 'structural') {
              console.log(formatStructuralResults(results, stats));
            } else if (summaryFirst) {
              console.log(formatSummaryFirst(results));
            } else if (middleRes) {
              console.log(formatMiddleRes(results));
            } else {
              console.log(formatSearchResults.call(formatContext, results, stats));
            }
          }
        }
      } catch (err) {
        console.error('Server query failed, falling back to cold start:', err.message);
        // Fall through to cold start
      }
      process.exit(0);
    }

    // Cold start (server auto-start failed or --cold flag)
    const searcher = new SweetSearch({
      verbose,
      returnSummaryFirst: summaryFirst,
      useLateInteraction,
    });

    // Auto-persist frequent queries to vocabulary on exit
    registerAutoPersistOnExit(2);

    try {
      const searchResult = await searcher.search(query, {
        k: topK,
        mode,
        regex,
        maxMatches,
        contextLines,
        fixedString,
        type: symbolType,
        globs,
        literalFilter,
        gramIndex,
        expand,
        rerank,
        fusion,
        useLateInteraction,
        ...(agentFormat && { format: agentFormat, ...(agentBudget && { tokenBudget: agentBudget }) }),
      });

      // Agent mode: already fully packaged
      if (searchResult.format === 'agent') {
        console.log(JSON.stringify(searchResult, null, 2));
      } else {
        let { results, stats } = searchResult;

        // HCGS: Enrich with summaries if summary-first mode
        if (summaryFirst) {
          results = await searcher.enrichWithSummaries(results);
        }

        if (json) {
          console.log(JSON.stringify({ results, stats }, null, 2));
        } else {
          emitDecoration(outputPolicy, query, stats, false);

          if (stats.path === 'structural') {
            console.log(searcher.formatStructuralResults(results, stats));
          } else if (summaryFirst) {
            console.log(searcher.formatSummaryFirst(results));
          } else if (middleRes) {
            console.log(searcher.formatMiddleRes(results));
          } else {
            console.log(searcher.formatResults(results, stats));
          }
        }
      }
    } catch (err) {
      console.error('Error:', err.message);
      if (verbose) console.error(err.stack);
      process.exit(1);
    } finally {
      searcher.close();
    }
  }
}
