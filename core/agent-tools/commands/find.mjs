// ss-find: ColGrep (SweetSearch.patternSearch: regex candidates, MaxSim re-rank) with agent packaging.

import { parseBoolFlag, buildGrepPattern, stripInertFlags, normalizeArgs, renderSufficiency } from '../argparse.mjs';
import { collectAgentShownSpans, renderShownFullTrailer } from '../../search/agent-span-ledger.js';
import { renderFixedBlocks, resultRenderFixActive, resultsForOriginalLedger } from '../../search/agent-output-fixes.js';
import {
  gutter, recordAgentToolCall, planFixedResults, alreadyShownFor, resolvePositional, readPositiveIntFlag,
  readValueFlag, readRepeatedValueFlag, typedFiles, resolveScopePaths, readGlobFlags, globExcludedNote, globDirNote,
  absorbPositionalPaths, exitScopeNotFound, missingScopes, getSweetSearch, queryWarmSearch, writeRegexDialectHint,
  compactSufficiencyLine,
} from './shared.mjs';
import { cmdGrep } from './grep.mjs';

export async function cmdFind(ctx, rawArgs) {
  const args = normalizeArgs(rawArgs);
  // ColGrep pattern search with token-budgeted agent packaging — returns the
  // FULL useful answer (ranked code blocks + confidence + sufficiency), the same
  // agent packaging ss-search emits. ss-grep is the short/locator counterpart, so
  // ss-find defaults to the full answer: it saves the follow-up read entirely.
  // (Mirrors the agent-in-the-loop H2H adapter eval/agent-eval/tools/
  // pattern-agent-tools.js, which calls search(...,{format:'agent'}).)
  const FIND_USAGE = 'Usage: ss-find "<query>" --regex "<regex>" [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [--in <path>]... '
    + "[-g|--glob '<glob>']... [--full|--xl] [-k N]\n"
    + "  -g '*.h' searches only matching files; -g '!tests/**' excludes (exclusion wins). Also --include <glob>, --exclude <glob>, --exclude-dir <dir>.";
  let format = 'agent';
  if (args.includes('--full')) { format = 'agent_full'; args.splice(args.indexOf('--full'), 1); }
  if (args.includes('--xl'))   { format = 'agent_full_xl'; args.splice(args.indexOf('--xl'), 1); }
  const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
  const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
  const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
  const k = readPositiveIntFlag(args, ['-k', '--top'], 6, FIND_USAGE);
  const regex = readValueFlag(args, '--regex', '', FIND_USAGE, { allowOptionValue: true });
  const inPaths = readRepeatedValueFlag(args, '--in', FIND_USAGE);
  const globs = readGlobFlags(ctx, args, FIND_USAGE);
  const globOpts = globs.length ? { pathGlobs: globs } : {};
  stripInertFlags(args);
  absorbPositionalPaths(ctx, args, inPaths);
  resolveScopePaths(ctx, inPaths);
  const query = resolvePositional(args, FIND_USAGE);
  const findFileFilter = inPaths.length ? (inPaths.length === 1 ? inPaths[0] : inPaths) : undefined;
  if (!query) {
    process.stderr.write(FIND_USAGE + '\n');
    process.exit(2);
  }
  // Budget-sweep experiment hook: lets the bench pin the response token budget
  // per-process without changing the agent-visible tool surface.
  const envFindBudget = Number(process.env.SS_SMOKE_FIND_BUDGET || '') || null;
  // Pattern flags apply to the regex candidate generator; the NL query is untouched.
  const effectiveRegex = buildGrepPattern(regex || '', { ignoreCase, wordBound, fixedString });
  let response;
  try {
    response = await queryWarmSearch(ctx, query, {
      mode: 'pattern', regex: effectiveRegex || `\\b\\w+\\b`, topK: k, format,
      _isAgentFormat: !fixedString,
      _siblingLine: process.env.SS_SIBLING_LINE !== '0', // default ON; cost bounded (≤0.6% prompt tokens), see SMOKE-LOSS-FORENSICS §9
      ...(findFileFilter ? { fileFilter: findFileFilter } : {}),
      ...globOpts,
      ...(envFindBudget ? { tokenBudget: envFindBudget } : {}),
      ...(ctx.fix.searchFirstUnit ? { firstUnit: ctx.fix.searchFirstUnit } : {}),
    });
  } catch {
    const s = await getSweetSearch(ctx);
    if (!s.hasLateInteractionIndex) {
      process.stderr.write(`[ss-find] no late-interaction index — falling back to ss-grep\n`);
      return cmdGrep(ctx, [effectiveRegex || query, '-k', String(k), ...inPaths.flatMap(p => ['--in', p]),
        ...globs.flatMap(g => ['-g', g])], { fromFind: true });
    }
    response = await s.patternSearch(query, null, {
      regex: effectiveRegex || `\\b\\w+\\b`,
      k,
      format,
      _isAgentFormat: !fixedString,
      ...(findFileFilter ? { fileFilter: findFileFilter } : {}),
      ...globOpts,
      ...(envFindBudget ? { tokenBudget: envFindBudget } : {}),
      ...(ctx.fix.searchFirstUnit ? { firstUnit: ctx.fix.searchFirstUnit } : {}),
    });
  }
  // Output-fix switches: plan the printed entries first (dedupe / caps), so both ledgers learn
  // only what this call prints. With every switch off `plan` is null and this is the original.
  const renderFix = resultRenderFixActive(ctx.fix, { find: true, alreadyShownActive: ctx.alreadyShownOn });
  const plan = renderFix ? planFixedResults(ctx, response.results || [], { k, find: true }) : null;
  const shownSpans = ctx.spanPolicyEnabled
    ? collectAgentShownSpans(resultsForOriginalLedger(response.results, plan), { projectRoot: ctx.fileRoot }) : [];
  await recordAgentToolCall(ctx, {
    spans: shownSpans,
    query: fixedString ? undefined : query,
    regex: fixedString ? undefined : effectiveRegex,
  });
  const alreadyShown = await alreadyShownFor(ctx, response.results || [], plan);

  // Header (visible to agent). SS_FIX_A: no query header, only the compact `# sufficient=YES`
  // line; no budget/used/subMode, no confidence line.
  if (ctx.fix.compact) {
    process.stdout.write(compactSufficiencyLine(ctx, response));
  } else {
    process.stdout.write(`# ss-find: ColGrep ${response.results?.length || 0} for "${query}" /${effectiveRegex || '*'}/` +
      ` budget=${response.tokenBudget} used=${response.tokensUsed} subMode=${response.subMode ?? format}\n`);
    if (response.confidence) {
      process.stdout.write(`# confidence=${response.confidence}${response.confidenceReason ? ' (' + response.confidenceReason + ')' : ''}` +
        `${renderSufficiency(response)}\n`);
    }
  }

  // --in naming a path that does not exist: what ss-grep says, with the same exit code.
  if (!response.results?.length && inPaths.length) {
    const missing = missingScopes(ctx, inPaths);
    if (missing.length) await exitScopeNotFound(ctx, missing);
  }

  // -g globs that removed every candidate: say so, not a bare "(no matches)".
  const findGlobNote = response.results?.length ? null : globExcludedNote(response.stats, globs);
  const findDirNote = response.results?.length ? globDirNote(response.stats) : null;
  if (findDirNote) process.stdout.write(`${findDirNote}\n`);
  if (findGlobNote) {
    process.stdout.write(`${findGlobNote}\n`);
  } else if (renderFix) {
    process.stdout.write(renderFixedBlocks(response.results || [], plan, {
      compact: ctx.fix.compact, omitted: alreadyShown, dropRestatingSummary: false, gutter, typed: typedFiles(ctx, inPaths),
    }));
  } else {
  for (const r of response.results || []) {
    const sym = r.symbol ? ` [${r.symbolType || 'code'}: ${r.symbol}]` : '';
    const kind = r.expansionKind ? ` kind=${r.expansionKind}` : '';
    const stale = r.stale ? ' STALE' : '';
    process.stdout.write(`\n## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym} (${r.presentation}${kind}${stale}) score=${(r.score || 0).toFixed(3)}\n`);
    if (r.headerContext) {
      process.stdout.write(`### imports\n\`\`\`\n${r.headerContext}\n\`\`\`\n`);
    }
    if (r.code) {
      process.stdout.write(`\`\`\`\n${gutter(r.code, r.startLine)}\n\`\`\`\n`);
    } else if (r.summary) {
      process.stdout.write(`${r.summary}\n`);
    }
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
  if (!response.results || response.results.length === 0) process.stdout.write('(no matches)\n');
  }
  writeRegexDialectHint(response.stats);
  const shownTrailer = (ctx.shownSpanTrailer && !ctx.fix.compact) ? renderShownFullTrailer(shownSpans) : '';
  if (shownTrailer) process.stdout.write(`\n${shownTrailer}\n`);
  process.exit(0);
}
