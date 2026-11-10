// ss-semantic: the spans of one file that answer a question (search-read-semantic.readSemantic).

import path from 'node:path';
import { normalizeArgs, looksLikeOption } from '../argparse.mjs';
import { semanticTargetFor } from '../../search/index-coverage.js';
import { fenceBody } from '../../search/search-read.js';
import { collectSemanticShownSpans } from '../../search/agent-span-ledger.js';
import { formatAlsoLine, formatSpanHeading, nameContext, uncoveredCutRests } from '../../search/semantic-also.js';
import { omittedRangeLines } from '../../search/semantic-span-budget.js';
import {
  REPO_ROOT, gutter, recordAgentToolCall, recordForAlreadyShown, failUsage, readPositiveIntFlag, readValueFlag,
  takeCountFlag, cwdPath, resolveShortFile, notIndexedNote, ensureWarmServerReady,
} from './shared.mjs';

function rejectUnknownOptions(args, usage) {
  const bad = args.find(looksLikeOption);
  if (bad) failUsage(`unrecognised option "${bad}"`, usage);
}

const SEMANTIC_WHOLE_FILE_FACTOR = 2;
const SEMANTIC_USAGE = 'Usage: ss-semantic <file> "<question>" [-k N] [--max-tokens N]';
export async function cmdSemantic(ctx, rawArgs) {
  const args = normalizeArgs(rawArgs);
  // Default 600 (was 800) per the 2026-06 budget sweep — scaled with the 3k
  // preview tier. Env hook overrides the default for sweeps; an explicit
  // --max-tokens flag from the agent always wins.
  const explicitBudget = args.some((a) => a === '--max-tokens' || String(a).startsWith('--max-tokens='));
  const maxTokens = readPositiveIntFlag(args, '--max-tokens',
    Number(process.env.SS_SMOKE_SEMANTIC_MAXTOKENS || '') || 600, SEMANTIC_USAGE);
  // A file of up to twice the default budget is never cut (spanBudget in
  // search-read-semantic.js). A cut there is read again ~85% of the time (6 of 7 calls,
  // 1.0-1.5x the budget, r282 captures), and that second request re-sends the whole context:
  // 1,000-1,500 token-equivalents at cached prices, more than the up to 600 extra tokens
  // printed here. An explicit --max-tokens from the agent stays a hard cap.
  const wholeFileMaxChars = explicitBudget ? undefined : maxTokens * 4 * SEMANTIC_WHOLE_FILE_FACTOR;
  // -k N: the number of top-ranked chunks the spans are built from (readSemantic topK, the
  // product CLI's `read-semantic -k`); the --max-tokens budget still caps the output.
  const topK = takeCountFlag(args, SEMANTIC_USAGE);
  // --in <file> names the file, as it does for ss-grep / ss-trace: `ss-semantic "<question>"
  // --in <file>`. The positional form stays `<file> "<question>"`.
  const inFile = readValueFlag(args, ['--in', '--file'], null, SEMANTIC_USAGE);
  rejectUnknownOptions(args, SEMANTIC_USAGE);
  if (inFile && args.length > 1) failUsage('give the file once: <file> "<question>" or "<question>" --in <file>', SEMANTIC_USAGE);
  let file = cwdPath(ctx, inFile ?? args[0]);
  const query = inFile ? args[0] : args[1];
  if (!file || !query) {
    process.stderr.write(SEMANTIC_USAGE + '\n');
    process.exit(2);
  }
  {
    const short = await resolveShortFile(ctx, inFile ?? args[0], file, 'ss-semantic');
    if (short.resolved) { file = short.file; process.stdout.write(`# ${file}\n`); }
  }
  // Same refusal as ss-read, and for a sharper reason: on an excluded file `readSemantic`
  // has no chunks to rank, so it falls back to a WHOLE-FILE span. Five of the seven
  // [FALLBACK] calls on the fresh pool were `dist/index.js` lines 1-35000 — the tool
  // answering a semantic question with 35,000 lines of bundle.
  // A symlinked path has no chunks either (the indexer does not follow symlinks): answer
  // from its real path when that is inside the project, else refuse (semanticTargetFor).
  {
    const note = await notIndexedNote(ctx, file);
    const target = semanticTargetFor(file, note);
    if (target.refuse) {
      process.stderr.write(`[ss-semantic] ${note.text}\n`);
      process.stderr.write(note.kind === 'symlink'
        ? `[ss-semantic] The index does not follow this link, so there is nothing to rank and no span is returned. Read it directly instead.\n`
        : `[ss-semantic] There is nothing to rank inside it, so no span is returned. Ask this question of the source it was built from.\n`);
      process.exit(1);
    }
    if (target.redirected) {
      // STDOUT: the wrapper discards stderr on a zero exit, and a redirect is never silent.
      process.stdout.write(`(ss-semantic: a symlink; answering from its real path ${target.file})\n`);
      file = target.file;
    }
  }

  // SS_FIX_SEMANTIC_RANGES (default ON since 2026-10-03; 0 = legacy) / SS_FIX_SEMANTIC_PICK (default
  // off; semantic-span-budget.js): a span
  // cut by the budget prints exactly the lines its header names, and what it left out is named
  // with an ss-read command.
  const rangeOpts = {
    ...(ctx.fix.semanticRanges ? { exactRanges: true } : {}),
    ...(ctx.fix.semanticPick ? { pickExcerpt: true } : {}),
  };
  let r;
  try {
    if (await ensureWarmServerReady(ctx, { timeoutMs: 5000 }) !== 'ready') throw new Error('warm server is not ready');
    const { queryReadSemanticServer } = await import(path.join(REPO_ROOT, 'core/search/search-client.js'));
    r = await queryReadSemanticServer({
      path: file, query, projectRoot: ctx.fileRoot, maxChars: maxTokens * 4, wholeFileMaxChars,
      ...(topK ? { topK } : {}), ...rangeOpts,
    });
    if (r?.error) throw new Error(r.error);
  } catch {
    const { readSemantic } = await import(path.join(REPO_ROOT, 'core/search/search-read-semantic.js'));
    r = await readSemantic({
      path: file, query, projectRoot: ctx.fileRoot,
      maxChars: maxTokens * 4, wholeFileMaxChars, verbose: false, ...(topK ? { topK } : {}), ...rangeOpts,
    });
  }
  if (!r.ok) {
    process.stderr.write(`[ss-semantic] error: ${r.reason || 'unknown'}\n`);
    process.exit(1);
  }
  const shownSpans = ctx.spanPolicyEnabled
    ? collectSemanticShownSpans(r, { projectRoot: ctx.fileRoot }) : [];
  await recordAgentToolCall(ctx, { spans: shownSpans, query });
  // SS_FIX_ALREADY_SHOWN (A3): record the printed spans in the A3 namespace only (reply ignored).
  await recordForAlreadyShown(ctx, shownSpans, null,
    (r.spans || []).reduce((n, sp) => n + (typeof sp?.text === 'string' ? sp.text.length : 0), 0));
  // WHAT THE OUTPUT SAYS BESIDES THE CODE (token diet 2026-10-04, same shape as ss-read and
  // ss-search). No header: the harness shows the command (path and question), and a later
  // call of a chained command opens with the boundary line (`# ss-semantic timed_queue.rb`).
  // Per span one `## a-b names` heading — the printed lines and what they hold, a `Parent.`
  // prefix printed once — and a plain fence. After the spans one `# also:` line names the
  // ranked places that were not printed, the unprinted rest of a cut span among them, with
  // every entity each holds. The span ledger is recorded server-side above; nothing
  // prints it (`shown-full:` had no reader but the ledger itself).
  const named = nameContext([], r.nameKinds);
  const out = [];
  if (r.fellBack) out.push(`# no ranked span (${r.indexed === false ? 'file not indexed' : 'no chunk matches the question'}); the file from line 1`);
  if (!r.spans?.length) out.push('(no results)');
  for (const span of r.spans || []) {
    const omitted = ctx.fix.semanticRanges ? omittedRangeLines(r.file, span) : null;
    if (omitted?.before?.length) out.push(`# not shown above: ${span.fullStartLine}-${span.startLine - 1}`);
    out.push(formatSpanHeading(span, named), '```', fenceBody(gutter(span.text, span.startLine)), '```');
    for (const line of omitted?.after || []) if (line.startsWith('(line ')) out.push(line);
  }
  // The next-best ranked places the budget left out. Pointers only: they are not shown spans,
  // so they stay out of the ledger above.
  // A cut span's rest that no also place names still says it was cut.
  const uncut = uncoveredCutRests(r.spans, r.alsoCandidates);
  if (uncut.length) out.push(`# not shown: ${uncut.join(', ')}`);
  const alsoLine = formatAlsoLine(r.alsoCandidates, named);
  if (alsoLine) out.push(alsoLine);
  process.stdout.write(`${out.join('\n')}\n`);
  process.exit(0);
}
