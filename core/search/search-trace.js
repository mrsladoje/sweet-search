/**
 * Structural trace CLI/API surface.
 *
 * One explicit agent primitive for callers, callees, and impact context.
 */

import { DB_PATHS } from '../infrastructure/config/index.js';
import { StructuralContextBuilder, formatStructuralContext } from '../graph/structural-context.js';

function parseArgs(args) {
  const opts = {
    symbol: '',
    filePath: null,
    queryHint: '',
    tokenBudget: null,
    maxDepth: 3,
    json: false,
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
  const builder = new StructuralContextBuilder({
    projectRoot: options.projectRoot,
    graphDbPath: options.graphDbPath || DB_PATHS.codeGraph,
  });
  try {
    return builder.build(symbol, options);
  } finally {
    builder.close();
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
  --budget <n>      Token budget, 1000-16000 (default: adaptive 4k/8k/12k)
  --json            Output structured JSON

Examples:
  sweet-search trace processOrder
  sweet-search trace validate --query "request validation order" --depth 2
  sweet-search trace handleRequest --in lib/handle-request.js --json`);
    process.exit(opts.help ? 0 : 1);
  }

  const result = traceSymbol(opts.symbol, opts);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatStructuralContext(result));
}

export { formatStructuralContext };
