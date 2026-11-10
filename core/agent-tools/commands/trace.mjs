// ss-trace: callers, callees and impact of one symbol from the code graph (search-trace.traceSymbol).

import path from 'node:path';
import { normalizeArgs } from '../argparse.mjs';
import { isTestLikePath } from '../../infrastructure/test-paths.js';
import { alternativesAfterSwitch, formatTraceCompact } from '../../search/agent-output-fixes.js';
import {
  REPO_ROOT, shortQueryHash, recordAgentToolCall, resolvePositional, failUsage, readPositiveIntFlag, readValueFlag,
  takeCountFlag, cwdPath, resolveShortFile,
} from './shared.mjs';

/**
 * True when `args[i]` is the value belonging to the flag before it, rather than a
 * positional of its own. Needed because ss-trace's flags are all space-separated
 * (`--in <file>`), so a naive "second non-flag token" scan would read a flag's value as
 * the mode word.
 */
function looksLikeTraceOptionValue(args, i) {
  const token = String(args[i] ?? '');
  if (token.startsWith('-')) return true;
  const prev = String(args[i - 1] ?? '');
  return prev.startsWith('-') && !prev.includes('=');
}

// The usage text names each mode word on its own line. A bracketed `[callers|callees|impact]`
// form was copied by agents into commands (zsh `no matches found: [callees]`), and an
// unbracketed `callers|callees|impact` would run as a shell pipe.
const TRACE_USAGE =
  'Usage: ss-trace <symbol> [--in <file>] [--query <hint>] [--depth N] [--budget N]\n' +
  '       ss-trace <symbol> callers --in <defining file>\n' +
  '       ss-trace <symbol> callees\n' +
  '       ss-trace <symbol> impact\n' +
  "       ss-trace 'Owner.Method(Type, Type)'   one overload, by parameter types or names\n" +
  'Mode word (optional, after the symbol): callers, callees or impact.';
export async function cmdTrace(ctx, rawArgs) {
  const args = normalizeArgs(rawArgs);
  let json = false;
  if (args.includes('--json')) {
    json = true;
    args.splice(args.indexOf('--json'), 1);
  }
  const { traceSymbol, formatStructuralContext, TRACE_MODES } = await import(path.join(REPO_ROOT, 'core/search/search-trace.js'));
  // `-k N` has no meaning for a trace (its size knobs are --depth / --budget): accepted, ignored.
  takeCountFlag(args, TRACE_USAGE);

  // THE MODE WORD. The guide has taught `ss-trace <symbol> [callers|callees|impact]` since
  // p7, but this function read only the FIRST positional, so `ss-trace foo callers` ran as
  // an un-moded trace and the agent silently got the whole thing — 27 pooled operations
  // used the form. Implemented rather than removed from the guide: the guidance block is
  // owner-protected, and an agent that asks for one relationship should be answered with
  // one relationship. An unrecognised second positional is now a usage error instead of a
  // silent drop, because a typo'd mode word is exactly how this stayed invisible.
  let mode = null;
  {
    const idx = args.findIndex((a, i) => i > 0 && !looksLikeTraceOptionValue(args, i));
    if (idx > 0) {
      const word = String(args[idx]).toLowerCase();
      if (!TRACE_MODES.includes(word)) {
        failUsage(`unrecognised mode "${args[idx]}" (expected one of: ${TRACE_MODES.join(', ')})`, TRACE_USAGE);
      }
      mode = word;
      args.splice(idx, 1);
    }
  }

  const opts = { projectRoot: ctx.projectRoot };
  const inTyped = readValueFlag(args, ['--in', '--file'], null, TRACE_USAGE);
  let file = cwdPath(ctx, inTyped);
  // --in with a short path naming one indexed file: trace in that file; the header then
  // prints its full path (formatTraceCompact prints `# lines a-b` only for a file typed in full).
  let inResolved = false;
  if (file) {
    const short = await resolveShortFile(ctx, inTyped, file, 'ss-trace');
    file = short.file;
    inResolved = short.resolved;
  }
  const queryHint = readValueFlag(args, ['--query', '--hint'], '', TRACE_USAGE, { allowOptionValue: true });
  const depth = readPositiveIntFlag(args, '--depth', null, TRACE_USAGE);
  const budget = readPositiveIntFlag(args, '--budget', null, TRACE_USAGE);
  const symbol = resolvePositional(args, TRACE_USAGE);
  if (!symbol) {
    process.stderr.write(TRACE_USAGE + '\n');
    process.exit(2);
  }
  if (file) opts.filePath = file;
  if (queryHint) opts.queryHint = queryHint;
  // SS_FIX_TRACE_MODE_BUDGET (default ON since 2026-10-03; 0 = legacy): the one section the mode word prints takes the budget.
  if (ctx.fix.traceModeBudget && mode) opts.modeSection = mode;
  if (ctx.fix.traceCompact) opts.inRepoImpactOnly = true;
  if (ctx.fix.traceCompact) opts.rowsOnly = true;
  if (depth != null) opts.maxDepth = depth;
  // Budget-sweep experiment hook: env sets the default; explicit --budget wins.
  if (budget != null) opts.tokenBudget = budget;
  else if (Number(process.env.SS_SMOKE_TRACE_BUDGET || '') > 0) opts.tokenBudget = Number(process.env.SS_SMOKE_TRACE_BUDGET);

  let response = traceSymbol(symbol, opts);
  const traceNotes = [];
  if (ctx.fix.traceCompact) {
    // SS_FIX_TRACE_COMPACT (A4; part of SS_FIX_A): a wrong --in file falls back to the
    // repo-wide definition; an ambiguous name prefers the non-test definition over a test mock.
    if (!response.target && opts.filePath) {
      const wide = traceSymbol(symbol, { ...opts, filePath: undefined });
      if (wide.target) {
        response = wide;
        traceNotes.push(`# not defined in ${inResolved ? file : 'the --in file'}; traced the definition above`);
      }
    }
    if (response.target && !(file && isTestLikePath(file)) && isTestLikePath(response.target.filePath)) {
      const alt = (response.disambiguation || []).find((a) => a.file && !isTestLikePath(a.file));
      if (alt) {
        const better = traceSymbol(symbol, { ...opts, filePath: alt.file });
        if (better.target && !isTestLikePath(better.target.filePath)) {
          // The re-run trace has no alternatives of its own: keep naming the test definition
          // (the other-definitions line lists it; the header names the one traced).
          better.disambiguation = alternativesAfterSwitch(response, better.target.filePath, better.target.startLine);
          response = better;
        }
      }
    }
  }
  await recordAgentToolCall(ctx, {
    query: json ? undefined : `${symbol} ${queryHint}`.trim(),
  });
  if (json) process.stdout.write(JSON.stringify({ ...response, mode }, null, 2) + '\n');
  else if (ctx.fix.traceCompact) process.stdout.write(formatTraceCompact(response, { mode, inFile: inResolved ? null : file, notes: traceNotes }) + '\n');
  else process.stdout.write(formatStructuralContext(response, { mode }) + '\n');

  const meta = {
    symbol,
    mode,
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
  // SS_FIX_TRACE_COMPACT (A4): the meta line goes to stderr. The ss-trace wrapper discards
  // stderr on a zero exit, so the agent never sees it; a script that runs this file directly
  // still can.
  if (ctx.fix.traceCompact) { if (response.target) process.stderr.write(`<<SS_TRACE_META>>${JSON.stringify(meta)}\n`); }
  else process.stdout.write(`\n<<SS_TRACE_META>>${JSON.stringify(meta)}\n`);
  process.exit(response.target ? 0 : 1);
}
