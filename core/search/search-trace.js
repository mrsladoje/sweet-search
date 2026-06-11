/**
 * Structural trace CLI/API surface.
 *
 * One explicit agent primitive for callers, callees, and impact context.
 */

import { dirname } from 'node:path';
import { DB_PATHS } from '../infrastructure/config/index.js';
import { StructuralContextBuilder, formatStructuralContext } from '../graph/structural-context.js';
import { beginPinnedRead, endPinnedRead } from './search-reader-pin.js';
import { emitToolIdentityAuto } from './cli-decoration.js';

function parseArgs(args) {
  const opts = {
    symbol: '',
    filePath: null,
    queryHint: '',
    tokenBudget: null,
    maxDepth: 3,
    json: false,
    plain: false,
    noBanner: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--in' || arg === '--file') && args[i + 1]) {
      opts.filePath = args[++i];
    } else if ((arg === '--query' || arg === '--hint') && args[i + 1]) {
      opts.queryHint = args[++i];
    } else if (arg === '--budget' && args[i + 1]) {
      opts.tokenBudget = Number.parseInt(args[++i], 10);
    } else if (arg === '--depth' && args[i + 1]) {
      opts.maxDepth = Number.parseInt(args[++i], 10);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--no-banner') {
      opts.noBanner = true;
    } else if (arg === '--format' && args[i + 1]) {
      const v = args[++i];
      if (v === 'json') opts.json = true;
      else if (v === 'plain') opts.plain = true;
    } else if (arg.startsWith('--format=')) {
      const v = arg.slice('--format='.length);
      if (v === 'json') opts.json = true;
      else if (v === 'plain') opts.plain = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (!arg.startsWith('-') && !opts.symbol) {
      opts.symbol = arg;
    } else if (!arg.startsWith('-') && opts.symbol) {
      opts.queryHint = opts.queryHint ? `${opts.queryHint} ${arg}` : arg;
    }
  }
  return opts;
}

export function traceSymbol(symbol, options = {}) {
  const graphDbPath = options.graphDbPath || DB_PATHS.codeGraph;
  const readPin = beginPinnedRead({
    stateDir: dirname(graphDbPath),
    epoch: options.manifestEpoch,
    meta: { tool: 'trace', symbol: String(symbol).slice(0, 200) },
  });
  const builder = new StructuralContextBuilder({
    projectRoot: options.projectRoot,
    graphDbPath,
    manifestEpoch: options.manifestEpoch ?? readPin?.epoch,
  });
  try {
    return builder.build(symbol, options);
  } finally {
    builder.close();
    endPinnedRead(readPin);
  }
}

export async function handleTraceCli(args) {
  const opts = parseArgs(args);
  if (opts.help || !opts.symbol) {
    console.log(`sweet-search trace <symbol> [options]

Options:
  --in <file>       Disambiguate symbols by indexed file path
  --query <hint>    Natural-language hint used only for structural ranking
  --depth <n>       Impact depth, 1-4 (default: 3)
  --budget <n>      Token budget, 1000-16000 (default: adaptive 3k/8k/12k)
  --json            Output structured JSON
  --format <fmt>    plain (no banner) or json
  --no-banner       Suppress the identity line

Examples:
  sweet-search trace processOrder
  sweet-search trace validate --query "request validation order" --depth 2
  sweet-search trace handleRequest --in lib/handle-request.js --json`);
    process.exit(opts.help ? 0 : 1);
  }

  const result = traceSymbol(opts.symbol, opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  emitToolIdentityAuto('trace', opts.symbol, { plain: opts.plain, noBanner: opts.noBanner });
  console.log(formatStructuralContext(result));
}

export { formatStructuralContext };
