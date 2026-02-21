/**
 * Search CLI Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains all CLI/terminal code: styling, pixel art, argument parsing, runCli.
 *
 * IMPORTANT: Uses dynamic import() for sweet-search.js and search-server.js
 * references to avoid circular dependencies.
 */

import { existsSync } from 'fs';
import { COLBERT_CONFIG } from './config.js';
import { registerAutoPersistOnExit } from './embedding-service.js';

// =============================================================================
// CLI STYLING (ANSI truecolor w/ fallback)
// =============================================================================

export const STYLE = (() => {
  // 5 shades of dark blue (edge -> center)
  const colors = {
    darkest:       { r: 6,   g: 10,  b: 31  },
    darker:        { r: 10,  g: 17,  b: 52  },
    dark:          { r: 14,  g: 24,  b: 73  },
    lightDark:     { r: 18,  g: 32,  b: 95  },
    lightestDark:  { r: 22,  g: 40,  b: 116 },
    border:        { r: 90,  g: 115, b: 220 },
    white:         { r: 255, g: 255, b: 255 },
  };

  const reset = '\x1b[0m';
  const bold = '\x1b[1m';

  const lerp = (c1, c2, t) => ({
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  });

  // Convert RGB to xterm-256 color code (fallback for terminals without truecolor)
  const rgbToAnsi256 = (r, g, b) => {
    // Grayscale range
    if (r === g && g === b) {
      if (r < 8) return 16;
      if (r > 248) return 231;
      return Math.round(((r - 8) / 247) * 24) + 232;
    }

    const to6 = (v) => Math.round((v / 255) * 5);
    const rr = to6(r);
    const gg = to6(g);
    const bb = to6(b);
    return 16 + (36 * rr) + (6 * gg) + bb;
  };

  const fg24 = (c) => `\x1b[38;2;${c.r};${c.g};${c.b}m`;
  const bg24 = (c) => `\x1b[48;2;${c.r};${c.g};${c.b}m`;

  const fg256 = (c) => `\x1b[38;5;${rgbToAnsi256(c.r, c.g, c.b)}m`;
  const bg256 = (c) => `\x1b[48;5;${rgbToAnsi256(c.r, c.g, c.b)}m`;

  const detectColorMode = () => {
    const forced = (process.env.SWEET_SEARCH_COLOR_MODE || process.env.SMART_SEARCH_COLOR_MODE || '').trim().toLowerCase();
    if (forced === 'none' || forced === '0' || forced === 'off') return 'none';
    if (forced === '256' || forced === 'ansi256' || forced === 'xterm256') return 'ansi256';
    if (forced === 'truecolor' || forced === '24bit' || forced === 'rgb') return 'truecolor';

    if (process.env.NO_COLOR) return 'none';

    const colorterm = process.env.COLORTERM || '';
    if (/truecolor|24bit/i.test(colorterm)) return 'truecolor';

    // Windows Terminal + VS Code terminals are typically truecolor-capable.
    if (process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode') return 'truecolor';

    const term = process.env.TERM || '';
    if (/256color/i.test(term)) return 'ansi256';

    return 'none';
  };

  const colorMode = detectColorMode(); // 'truecolor' | 'ansi256' | 'none'
  const fg = colorMode === 'truecolor' ? fg24 : colorMode === 'ansi256' ? fg256 : () => '';
  const bg = colorMode === 'truecolor' ? bg24 : colorMode === 'ansi256' ? bg256 : () => '';

  const headerStyleEnv = (process.env.SWEET_SEARCH_HEADER_STYLE || process.env.SMART_SEARCH_HEADER_STYLE || '').trim().toLowerCase();
  const headerStyle =
    headerStyleEnv === 'zones' || headerStyleEnv === 'gradient'
      ? headerStyleEnv
      : (colorMode === 'truecolor' ? 'gradient' : 'zones');

  return {
    colors,
    fg,
    bg,
    reset: colorMode === 'none' ? '' : reset,
    bold: colorMode === 'none' ? '' : bold,
    lerp,
    colorMode,
    headerStyle,
  };
})();

// 2-line pixel art using half-blocks - SWEET SEARCH
const SWEET_SEARCH_L1 = '█▀▀ █ █ █ █▀▀ █▀▀ ▀█▀  █▀▀ █▀▀ ▄▀▄ █▀▄ █▀▀ █▄█';
const SWEET_SEARCH_L2 = '▄▄█ ▀▄█▄▀ ██▄ ██▄  █   ▄▄█ ██▄ █▀█ ██▄ █▄▄ █▀█';

/**
 * Print styled header - 2-line pixel art with query on right = 2 content lines.
 */
export function printStyledHeader(query) {
  const width = Math.min(process.stdout.columns || 80, 80);
  const { colors, fg, bg, reset, bold } = STYLE;

  const artLen = SWEET_SEARCH_L2.length;
  const maxQueryLen = width - artLen - 8;
  const displayQuery = query.length > maxQueryLen
    ? query.slice(0, maxQueryLen - 3) + '...'
    : query;

  const palette = [
    colors.darkest,
    colors.darker,
    colors.dark,
    colors.lightDark,
    colors.lightestDark,
  ];

  const getBgColor = (i, w) => {
    const pos = i / Math.max(1, w - 1);
    const t = 1 - Math.abs(0.5 - pos) * 2;
    const zone = Math.min(Math.floor(t * palette.length), palette.length - 1);
    return palette[zone];
  };

  const buildLine = (leftContent, rightContent = null, isArt = false) => {
    let result = '';
    const leftPad = 2;
    const rightPad = 2;
    const rightStart = rightContent ? width - rightPad - rightContent.length : width;

    for (let i = 0; i < width; i++) {
      const bgColor = getBgColor(i, width);
      const leftCharIdx = i - leftPad;
      const rightCharIdx = i - rightStart;

      if (rightContent && rightCharIdx >= 0 && rightCharIdx < rightContent.length) {
        result += bold + fg(colors.white) + bg(bgColor) + rightContent[rightCharIdx];
      } else if (leftCharIdx >= 0 && leftCharIdx < leftContent.length) {
        const fgColor = isArt ? colors.border : colors.white;
        result += bold + fg(fgColor) + bg(bgColor) + leftContent[leftCharIdx];
      } else {
        result += bg(bgColor) + ' ';
      }
    }
    return result + reset;
  };

  const queryStr = `"${displayQuery}"`;

  console.log('');
  console.log(buildLine(SWEET_SEARCH_L1, null, true));
  console.log(buildLine(SWEET_SEARCH_L2, queryStr, true));
}

/**
 * Print styled stats line
 */
export function printStyledStats(stats, isWarm = false) {
  const { colors, fg, reset } = STYLE;
  const mode = stats.routing?.mode || stats.mode || 'auto';
  const pathType = stats.path || 'hybrid';
  const timeMs = stats.server_ms || stats.total_ms || 0;

  const modeIcon = { lexical: '⚡', semantic: '🧠', hybrid: '⚗️', structural: '🔗', auto: '✨' }[mode] || '◆';
  const warmIcon = isWarm ? `${fg(colors.border)}●${reset}` : `${fg(colors.darker)}○${reset}`;

  console.log(
    `  ${modeIcon} ${fg(colors.white)}${mode}${reset} ` +
    `${fg(colors.dark)}│${reset} ${fg(colors.border)}${pathType}${reset} ` +
    `${fg(colors.dark)}│${reset} ${fg(colors.white)}${timeMs}ms${reset} ${warmIcon}`
  );
  console.log('');
}

// =============================================================================
// CLI entry point
// =============================================================================

export async function runCli(args) {
  // Dynamic imports to avoid circular dependencies
  const { default: SweetSearch } = await import('./sweet-search.js');
  const { startServer, queryServer, isServerRunning, autoSpawnServer,
          SEARCH_SERVER_SOCKET, SEARCH_SERVER_SOCKET_LEGACY, SEARCH_SERVER_PORT
        } = await import('./search-server.js');

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Sweet Search v2.3 - Unified Code Search with Auto-Warm Server

Usage:
  sweet-search <query> [options]
  sweet-search --stop               Stop warm server

Options:
  --mode <mode>     Search mode: auto, lexical, semantic, hybrid (default: auto)
  --top, -k <n>     Number of results (default: 10)
  --no-expand       Disable graph expansion
  --no-rerank       Disable reranking
  --fusion <type>   Legacy: cc or rrf (ignored for hybrid - always uses robust CC fusion)
  --colbert         Enable ColBERT late interaction (if index available)
  --summary         HCGS summary-first output (10x token reduction)
  --mid             Middle-res view: signature + docstring (5x token reduction)
  --json            Output as JSON
  --verbose, -v     Enable verbose logging
  --cold            Force cold start (skip auto-start server)
  --serve           Manually start server (usually not needed)

Auto-Warm Server (automatic):
  The server automatically starts on first search and stays warm:
  - First search: ~1-2s (server startup + index load)
  - Subsequent:   ~6-10ms lexical, ~275ms semantic (warm cache)

  Server runs in background until explicitly stopped or system restart.

Examples:
  sweet-search "AuthService"        # Auto-starts server, uses warm cache
  sweet-search "how does auth work" # Semantic search
  sweet-search "auth" --cold        # Skip server, cold start only
  sweet-search --stop               # Stop warm server
`);
    process.exit(0);
  }

  // Handle --serve
  if (args[0] === '--serve') {
    startServer();
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

      // F-06: Stop via Unix socket first so CLI behavior matches server policy.
      let stopResponse = null;
      if (existsSync(SEARCH_SERVER_SOCKET)) {
        stopResponse = await requestStop({
          socketPath: SEARCH_SERVER_SOCKET,
          path: '/stop',
          method: 'GET',
        });
      } else if (existsSync(SEARCH_SERVER_SOCKET_LEGACY)) {
        stopResponse = await requestStop({
          socketPath: SEARCH_SERVER_SOCKET_LEGACY,
          path: '/stop',
          method: 'GET',
        });
      } else {
        // Backward-compatible fallback for older servers without Unix socket.
        stopResponse = await requestStop({
          hostname: 'localhost',
          port: SEARCH_SERVER_PORT,
          path: '/stop',
          method: 'GET',
        });
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
    // Normal query mode
    let query = '';
    let mode = 'auto';
    let topK = 10;
    let expand = true;
    let rerank = true;
    let fusion = 'cc';
    let useColBERT = COLBERT_CONFIG.enabled;
    let json = false;
    let verbose = false;
    let summaryFirst = false;
    let middleRes = false;
    let forceCold = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--mode' && args[i + 1]) {
        mode = args[++i];
      } else if ((arg === '--top' || arg === '-k') && args[i + 1]) {
        topK = parseInt(args[++i], 10);
      } else if (arg === '--no-expand') {
        expand = false;
      } else if (arg === '--no-rerank') {
        rerank = false;
      } else if (arg === '--fusion' && args[i + 1]) {
        fusion = args[++i];
      } else if (arg === '--colbert') {
        useColBERT = true;
      } else if (arg === '--no-colbert') {
        useColBERT = false;
      } else if (arg === '--json') {
        json = true;
      } else if (arg === '--summary') {
        summaryFirst = true;
      } else if (arg === '--mid') {
        middleRes = true;
      } else if (arg === '--verbose' || arg === '-v') {
        verbose = true;
      } else if (arg === '--cold') {
        forceCold = true;
      } else if (!arg.startsWith('--')) {
        query = arg;
      }
    }

    if (!query) {
      console.error('Error: Query required');
      process.exit(1);
    }

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
          topK,
          expand,
          rerank,
          fusion,
          useColBERT,
          summary: summaryFirst,
          mid: middleRes,
        });

        if (response.error) {
          console.error('Server error:', response.error);
          process.exit(1);
        }

        const { results, stats } = response;

        if (json) {
          console.log(JSON.stringify({ results, stats }, null, 2));
        } else {
          printStyledHeader(query);
          printStyledStats(stats, true);

          // Simple format for server results
          const searcher = new SweetSearch();
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
      useColBERT
    });

    // Auto-persist frequent queries to vocabulary on exit
    registerAutoPersistOnExit(2);

    try {
      let { results, stats } = await searcher.search(query, {
        k: topK,
        mode,
        expand,
        rerank,
        fusion,
        useColBERT,
      });

      // HCGS: Enrich with summaries if summary-first mode
      if (summaryFirst) {
        results = await searcher.enrichWithSummaries(results);
      }

      if (json) {
        console.log(JSON.stringify({ results, stats }, null, 2));
      } else {
        printStyledHeader(query);
        printStyledStats(stats, false);

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
    } catch (err) {
      console.error('Error:', err.message);
      if (verbose) console.error(err.stack);
      process.exit(1);
    } finally {
      searcher.close();
    }
  }
}
