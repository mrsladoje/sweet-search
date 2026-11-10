// ss-grep: indexed lexical grep (SweetSearch.bareGrep, gram-prefiltered), printed in grep's shape.
//
// The native lane (crates/sweet-search-native/src/lane/, crates/ss-grep-core/) prints the same
// bytes as cmdGrep. A change here that shapes the output must be ported there in the same commit;
// crates/ss-grep-core/fixtures-gen/args.mjs cuts functions out of this file's source text.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  parseBoolFlag, extraPositionals, buildGrepPattern, stripInertFlags, normalizeArgs, parseContextFlags,
  GREP_BOOL_SHORTS, translateBreAlternation, unsupportedGrepOption,
} from '../argparse.mjs';
import {
  GREP_HIDDEN_HINT, renderGrepBody, renderGrepHiddenFiles, renderOutsideScopeLine, renderOutsideScopeProbeLine,
  renderGrepListing, renderGrepFileList, renderGrepFileCounts, renderGrepOnlyMatching,
} from '../../search/grep-output-shaping.js';
import { loadNativeAddon } from '../../infrastructure/native-resolver.js';
import { cwdGrepScope } from '../../search/cwd-paths.js';
import { interfaceCallsInRanges, renderInterfaceImpls } from '../../search/search-read.js';
import {
  GREP_COUNTS_THRESHOLD, isRegexParseError, grepBroadHitMax, grepHitText, matchTextIsRepeated, orderSourceBeforeTests,
  renderGrepLineLists, repairRegexBranches,
} from '../../search/agent-output-fixes.js';
import {
  recordAgentToolCall, resolvePositional, failUsage, readPositiveIntFlag, readRepeatedValueFlag, typedFiles,
  resolveScopePaths, readGlobFlags, globExcludedNote, globDirNote, absorbPositionalPaths, notIndexedNote,
  exitScopeNotFound, missingScopes, getSweetSearch, queryWarmSearch, writeRegexDialectHint,
} from './shared.mjs';

// Bare positionals past the pattern used to be dropped without a word. Both
// plausible intents are named, because the parser cannot tell them apart:
// extra scopes (`--in A B`) or an unquoted multi-word pattern (`ss-grep def foo`).
function rejectExtraPositionals(args, usage) {
  const extras = extraPositionals(args);
  if (extras.length === 0) return;
  const shown = extras.map(e => `"${e}"`).join(', ');
  failUsage(
    `${extras.length} argument(s) not consumed: ${shown}\n` +
    `[ss] for several scopes repeat the flag: ss-grep "<regex>" --in A --in B\n` +
    `[ss] if this is part of the pattern, quote the whole pattern`,
    usage,
  );
}

// File contents for grep context lines, read from the agent's own files (ctx.fileRoot).
// Cached per call; null when the file cannot be read (the hit then prints alone).
function grepContextLineReader(ctx) {
  const cache = new Map();
  return (file) => {
    if (!cache.has(file)) {
      let lines = null;
      try {
        const abs = path.isAbsolute(file) ? file : path.join(ctx.fileRoot, file);
        lines = readFileSync(abs, 'utf8').split('\n');
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
      } catch { lines = null; }
      cache.set(file, lines);
    }
    return cache.get(file);
  };
}

// Every fetched hit line per file: a context line that is itself a match prints with ':'.
function grepMatchLines(results) {
  const byFile = new Map();
  for (const m of results || []) {
    if (!byFile.has(m.file)) byFile.set(m.file, new Set());
    byFile.get(m.file).add(m.line);
  }
  return byFile;
}

// `# siblings: 363: async def _fetch… · 599: async def _prefetch_m2m_relation(` — the same-file
// family of a 1-3 hit grep (agent-pack-completion.js buildSameFileSiblingLine), without the
// sites that already print as a hit or inside a -A/-B/-C window. The file is the path above.
function grepSiblingLine(siblingLine, rows, { before = 0, after = 0 } = {}) {
  if (!siblingLine?.rendered) return null;
  if (!Array.isArray(siblingLine.sites)) return siblingLine.rendered;
  const shown = (line) => rows.some((r) => line >= r.line - before && line <= r.line + after);
  const kept = siblingLine.sites.filter((site) => !shown(site.line));
  if (kept.length === 0) return null;
  return `# siblings: ${kept.map((site) => `${site.line}: ${site.text}`).join(' · ')}`;
}

// A5: after a repair, the engine's "the original pattern was used unchanged" note describes the
// wrapper's escaped pattern, not the agent's, so it is left out (the repair note says what was
// searched). A note about the engine's own GNU-dialect retry still prints: the hits shown then
// come from that retry (an agent-written `\(a\)` searched as `(a)`), and the agent must know it.
function writeRegexDialectHintAfterRepair(stats, repaired) {
  if (!repaired || stats?.regexDialectHint?.retryAttempted) writeRegexDialectHint(stats);
}

const GREP_USAGE = 'Usage: ss-grep <regex> [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [-E] [-l|-c|-o] [--in <path>]... '
  + "[-g|--glob '<glob>']... [-k N] [-A N] [-B N] [-C N]\n"
  + "  -g '*.h' searches only matching files; -g '!tests/**' excludes (exclusion wins). Also --include <glob>, --exclude <glob>, --exclude-dir <dir>.\n"
  + '  -l lists the files with a match (most relevant first), -c prints path:count, -o prints only the matched text; '
  + '-k N caps the files (-l, -c) or hit lines (-o). Without -E or -F, a pattern with \\| and no | is grep basic regex.';
// -l and -c list at most this many files from the engine before the k cut (all of them).
const GREP_FILE_MODE_MAX_FILES = 100000;
// ss-grep -o: every non-empty match of `rx` on each hit line, found by the native engine's own
// regex (the lane calls the same function). Without that addon export: the stored first match.
function grepOnlyMatchingTexts(rx, rows) {
  const addon = loadNativeAddon({ validate: (m) => typeof m.grepOnlyMatching === 'function' })?.mod;
  const lists = addon ? addon.grepOnlyMatching(rx, rows.map((r) => r.content ?? '')) : null;
  const found = new Map();
  rows.forEach((r, i) => found.set(r, lists ? lists[i] : (r.matchText ? [r.matchText] : [])));
  return found;
}

// `fromFind`: ss-find's fallback when there is no late-interaction index. Its --in paths are
// already resolved (resolving them again would re-apply the cwd), and ss-find has no implicit
// cwd scope, so the fallback must not pick up ss-grep's.
export async function cmdGrep(ctx, rawArgs, { fromFind = false } = {}) {
  const args = normalizeArgs(rawArgs, { boolShorts: GREP_BOOL_SHORTS });
  const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
  const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
  const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
  // grep's -E (ss-grep patterns are extended regex already: it only turns off the basic-regex
  // reading of `\|`), and the output modes -l / -c / -o. -l wins over -c, -c over -o, as in grep.
  const extended = parseBoolFlag(args, ['-E', '--extended-regexp']);
  const filesWithMatches = parseBoolFlag(args, ['-l', '--files-with-matches']);
  const countLines = parseBoolFlag(args, ['-c', '--count']);
  const onlyMatching = parseBoolFlag(args, ['-o', '--only-matching']);
  const k = readPositiveIntFlag(args, ['-k', '--top'], 20, GREP_USAGE);
  // grep's -A/-B/-C: native agents use them in ~13% of grep calls (an enum body in one
  // call). Rendered client-side from the agent's own files, in grep's own shape; with no
  // context flag every byte below is what it was.
  const context = parseContextFlags(args);
  if (context.error) failUsage(context.error, GREP_USAGE);
  const withContext = context.before > 0 || context.after > 0;
  // The recovery affordance the diversified output advertises when it truncates a flooded file.
  const inPaths = readRepeatedValueFlag(args, '--in', GREP_USAGE);
  // -g include / !exclude globs, ANDed with --in; evaluated by the engine on the native path.
  const globs = readGlobFlags(ctx, args, GREP_USAGE, { resolve: !fromFind });
  const globOpts = globs.length ? { pathGlobs: globs } : {};
  stripInertFlags(args);
  absorbPositionalPaths(ctx, args, inPaths);
  if (!fromFind) resolveScopePaths(ctx, inPaths);
  const unsupported = unsupportedGrepOption(args);
  if (unsupported) failUsage(`grep option "${unsupported.flag}" (${unsupported.what}) is not supported by ss-grep`, GREP_USAGE);
  rejectExtraPositionals(args, GREP_USAGE);
  const rawPattern = resolvePositional(args, GREP_USAGE);
  const searched = (!fixedString && !extended && translateBreAlternation(rawPattern)) || rawPattern;
  const regex = buildGrepPattern(searched, { ignoreCase, wordBound, fixedString });
  if (!regex) {
    process.stderr.write(GREP_USAGE + '\n');
    process.exit(2);
  }

  // SS_FIX_GREP_RETRY (A5; part of SS_FIX_A). Off: one call, errors propagate exactly as before.
  // On: a regex the engine cannot parse is repaired once — only the alternatives that do not
  // parse are escaped, `|` alternatives stay alternatives — and a zero-hit search is retried
  // once case-insensitively. Each retry is announced in one line; nothing is retried silently.
  // `fetch(rx)` runs one search for the regex `rx` and returns the engine result.
  // `repaired` = the pattern did not parse as written. The ORIGINAL ledger is then not told
  // about this call: with the switch off the call crashed before it recorded anything, so
  // ss-read's query-aware trailers stay byte-identical.
  async function fetchWithFixes(fetch, { scopeMissing = false } = {}) {
    if (!ctx.fix.grepRetry) return { result: await fetch(regex), usedRegex: regex, notes: [], repaired: false };
    let usedRegex = regex;
    const notes = [];
    let repaired = false;
    let result;
    try {
      result = await fetch(regex);
    } catch (err) {
      if (!isRegexParseError(err)) throw err;
      const repair = repairRegexBranches(rawPattern);
      usedRegex = buildGrepPattern(repair.pattern, { ignoreCase, wordBound, fixedString: false });
      try {
        result = await fetch(usedRegex);
      } catch (err2) {
        if (!isRegexParseError(err2)) throw err2;
        return { result: null, usedRegex, notes, repaired: true, unparsable: true };
      }
      repaired = true;
      notes.push(repair.wholeLiteral
        ? `(invalid regex "${rawPattern}" — searched it as literal text instead)`
        : `(invalid regex "${rawPattern}" — escaped only the part(s) that did not parse; searched /${usedRegex}/)`);
    }
    const hits = result.stats?.totalMatches ?? result.results.length;
    // A zero that the -g globs explain (they removed real matches) is not retried
    // case-insensitively: the answer to give is "your globs excluded them".
    const globExplained = (result.stats?.pathGlobExcludedMatches || 0) > 0;
    if (hits === 0 && !scopeMissing && !globExplained && !/^\(\?[a-z-]*i[a-z-]*[:)]/.test(usedRegex)) {
      try {
        const ci = `(?i)${usedRegex}`;
        const retry = await fetch(ci);
        if ((retry.stats?.totalMatches ?? retry.results.length) > 0) {
          result = retry;
          usedRegex = ci;
          notes.push('(no case-sensitive matches — showing case-insensitive matches)');
        }
      } catch { /* keep the zero-hit answer */ }
    }
    return { result, usedRegex, notes, repaired };
  }
  // A5: the repair itself did not parse. One line, no stack trace, no "(no matches)".
  function exitUnparsable(usedRegex) {
    process.stdout.write(`# ss-grep: regex parse error for /${regex}/\n`
      + `(the regex did not parse, and the repaired pattern /${usedRegex}/ did not parse either — `
      + `escape ( ) [ ] { } with a backslash, or use -F for literal text, and run again)\n`);
    process.exit(2);
  }
  // A5: a repaired pattern with zero hits must not read as a clean absence.
  const REPAIRED_NO_MATCH = '(no matches — note: the regex did not parse as written; check the escaping of ( [ { and run again)';

  // grep's output modes (agents type -l in ~8% of file searches, -c in ~2%, -o in ~0.5%).
  // -l / -c: every file with a match and its count of matching lines (one stored hit per file;
  // the counts come from the scan), -l in the selector's file order (the weight that ranks the
  // files of the listing below), -c in path order. -o: the first k hit lines in path order,
  // each with every match on it. Context flags do not apply, and grep prints no enrichment
  // (family, sibling line, interface hint, outside-scope line), so neither does this. Zero
  // matches exit 1, as grep does.
  if (filesWithMatches || countLines || onlyMatching) {
    const fileMode = filesWithMatches || countLines;
    const modeCwdScope = inPaths.length > 0 || fromFind ? null
      : cwdGrepScope({ cwd: process.cwd(), fileRoot: ctx.fileRoot, indexRoot: ctx.projectRoot });
    const modeOpts = {
      mode: 'grep', contextLines: 0, _isAgentFormat: false, _siblingLine: false,
      ...(fileMode
        ? { maxMatches: 0, perFileCap: 1, maxFiles: GREP_FILE_MODE_MAX_FILES, grepFileOrder: 'weight',
          ...(ctx.fix.grepWeight ? { grepFileWeight: ctx.fix.grepWeight } : {}) }
        : { maxMatches: k }),
      ...(inPaths.length > 0 ? { fileFilter: inPaths.length === 1 ? inPaths[0] : inPaths }
        : modeCwdScope ? { fileFilter: modeCwdScope, _cwdScope: true } : {}),
      ...globOpts,
    };
    const fetchMode = async (rx) => {
      try {
        return await queryWarmSearch(ctx, rx, { ...modeOpts, regex: rx, expand: false, rerank: false, useLateInteraction: false });
      } catch {
        const s = await getSweetSearch(ctx);
        return await s.bareGrep(rx, null, { ...modeOpts, regex: rx });
      }
    };
    const fetched = await fetchWithFixes(fetchMode, { scopeMissing: ctx.fix.grepRetry && missingScopes(ctx, inPaths).length > 0 });
    if (fetched.unparsable) exitUnparsable(fetched.usedRegex);
    const { result, usedRegex, notes, repaired } = fetched;
    if (!repaired) {
      await recordAgentToolCall(ctx, {
        query: fixedString ? undefined : regex,
        regex: fixedString ? undefined : regex,
      });
    }
    for (const note of notes) process.stdout.write(`${note}\n`);
    if (result.results.length === 0) {
      const missing = missingScopes(ctx, inPaths);
      if (missing.length) await exitScopeNotFound(ctx, missing);
      const globNote = globExcludedNote(result.stats, globs);
      process.stdout.write(`${globNote || (repaired ? REPAIRED_NO_MATCH : '(no matches)')}\n`);
      if (!globNote) writeRegexDialectHintAfterRepair(result.stats, repaired);
      process.exit(1);
    }
    let lines;
    if (fileMode) {
      const summary = result.fileSummary || { files: [], hiddenFileCount: 0 };
      const fileCount = summary.files.length + (summary.hiddenFileCount || 0);
      lines = filesWithMatches
        ? renderGrepFileList(summary.files, k, fileCount)
        : renderGrepFileCounts([...summary.files].sort((a, b) => a.file.localeCompare(b.file)), k, fileCount);
    } else {
      const matches = grepOnlyMatchingTexts(usedRegex, result.results);
      lines = renderGrepOnlyMatching(result.results, (row) => matches.get(row), { typed: typedFiles(ctx, inPaths) });
      const cut = (result.stats?.totalMatches ?? result.results.length) - result.results.length;
      if (cut > 0) lines.push(`# +${cut} more ${cut === 1 ? 'hit' : 'hits'} (raise -k)`);
    }
    for (const line of lines) process.stdout.write(`${line}\n`);
    writeRegexDialectHintAfterRepair(result.stats, repaired);
    process.exit(0);
  }

  // A scope that names a directory holds many files: it takes the weighted listing below, as
  // an unscoped grep does (r3h-tortoise-orm-03: `--in tortoise -k 15` printed files in path
  // order, gave 12 of 15 lines to the first heavy file and hid models.py, the second-heaviest
  // file and the one with the answer). Only scopes that are all files keep the flat output.
  const dirScoped = inPaths.length > 0 && ctx.fix.grepAlloc && missingScopes(ctx, inPaths).length === 0
    && typedFiles(ctx, inPaths).length < inPaths.length;
  if (inPaths.length > 0 && !dirScoped) {
    const fileFilter = inPaths.length === 1 ? inPaths[0] : inPaths;
    const fetchScoped = async (rx) => {
      try {
        return await queryWarmSearch(ctx, rx, {
          mode: 'grep', regex: rx, maxMatches: k, contextLines: 0,
          fileFilter, expand: false, rerank: false, useLateInteraction: false,
          _isAgentFormat: !fixedString,
          ...globOpts,
        });
      } catch {
        const s = await getSweetSearch(ctx);
        return await s.bareGrep(rx, null, {
          regex: rx, maxMatches: k, contextLines: 0, fileFilter,
          _isAgentFormat: !fixedString,
          ...globOpts,
        });
      }
    };
    const fetched = await fetchWithFixes(fetchScoped, { scopeMissing: ctx.fix.grepRetry && missingScopes(ctx, inPaths).length > 0 });
    if (fetched.unparsable) exitUnparsable(fetched.usedRegex);
    const { result, usedRegex, notes, repaired } = fetched;
    const total = result.stats?.totalMatches ?? result.results.length;
    if (!repaired) {
      await recordAgentToolCall(ctx, {
        query: fixedString ? undefined : regex,
        regex: fixedString ? undefined : regex,
      });
    }
    // No header: the harness shows the command (regex, scopes, globs) right above the output,
    // and a cut by -k is the `# +N more hits` line below.
    for (const note of notes) process.stdout.write(`${note}\n`);
    // SS_FIX_GREP_ORDER (B7): source hits before test hits; no repeated matched-text column.
    const rows = ctx.fix.grepOrder ? orderSourceBeforeTests(result.results) : result.results;
    const broadMax = grepBroadHitMax(total);
    const hitText = { fullLine: ctx.fix.grepFullLine, ...(broadMax ? { max: broadMax } : {}) };
    const dropText = ctx.fix.grepOrder && matchTextIsRepeated(rows, hitText);
    const shown = rows.map((r) => ({ file: r.file, line: r.line, text: grepHitText(r, hitText) }));
    for (const line of renderGrepListing(shown, {
      ...context, dropText, typed: typedFiles(ctx, inPaths),
      ...(withContext ? { getLines: grepContextLineReader(ctx), matchLines: grepMatchLines(result.results) } : {}),
    })) process.stdout.write(`${line}\n`);
    const dirNote = globDirNote(result.stats);
    if (dirNote) process.stdout.write(`${dirNote}\n`);
    writeGrepInterfaceHint(ctx, total, shown);
    const cut = total - rows.length;
    if (cut > 0) process.stdout.write(`# +${cut} more ${cut === 1 ? 'hit' : 'hits'} (raise -k)\n`);
    // Hits the scope hid: source files outside --in that match the same regex (an override or
    // plugin redefining the scoped symbol). One unscoped count; fail silent.
    // File scopes only: a directory scope (`--in tortoise`) is a deliberate boundary, and
    // what lies outside it is mostly examples and tests.
    const outsideLine = fromFind || typedFiles(ctx, inPaths).length !== inPaths.length ? null
      : await outsideScopeLine(ctx, usedRegex, total, inPaths, globOpts);
    if (outsideLine) process.stdout.write(`${outsideLine}\n`);
    let zeroExplained = false;
    if (result.results.length === 0) {
      const missing = missingScopes(ctx, inPaths);
      if (missing.length) await exitScopeNotFound(ctx, missing);
      const globNote = globExcludedNote(result.stats, globs);
      // Then a scope the index cannot answer for: an agent that scoped to a bundle needs to
      // know that before it decides the pattern is absent.
      // The grep index covers more than the vector index the note reads (grep-corpus.js), so
      // a scope the grep index holds is a searched scope, whatever the note would say.
      let note = null;
      const grepCovered = result.stats?.scopeInGrepIndex === true;
      if (!globNote && !grepCovered) for (const p of inPaths) { note = await notIndexedNote(ctx, p); if (note) break; }
      process.stdout.write(`${globNote || (note ? note.text : (repaired ? REPAIRED_NO_MATCH : '(no matches)'))}\n`);
      zeroExplained = !!(globNote || note);
    }
    // A zero the globs or the index explain is not a syntax problem; a dialect note would
    // send the agent to rewrite a pattern that was fine.
    if (!zeroExplained) writeRegexDialectHintAfterRepair(result.stats, repaired);
    process.exit(0);
  }

  // k-budget file diversity: fetch at most min(k,100) matches per file across
  // at most k files (a file can never show more than k lines, and more than k
  // files can never fit), then allocate the k body lines breadth-first so one
  // flooded file can never hide every other matching file (the gradethis-161
  // failure). Rendering stays grouped per file; truncation is marked inline
  // and drillable via --in.
  //
  // SS_FIX_GREP_ORDER (B7) fetches up to 100 files instead of k, so that source files are
  // not cut away before the source-before-test ordering can see them.
  //
  // SS_FIX_GREP_ALLOC (default ON; 0 = the rule above, byte for byte): the engine keeps the
  // fetchFiles files of highest weight = sqrt(hits) x file-type prior (1 source, 0.5 test, 0.25
  // generated), not the first fetchFiles in path order; the k lines are shared by Sainte-Laguë
  // and files print by weight (grep-output-shaping.js). With B7 also on, B7's source-before-tests
  // body order is skipped (the prior already ranks tests below source); its line lists stay.
  //
  // Arms on top of SS_FIX_GREP_ALLOC, DEFAULT ON since 2026-10-03 (legacy: sqrt / sl / 0): SS_FIX_GREP_WEIGHT=sat2 (the engine keeps and
  // orders files by hits / (hits + 2) x prior), SS_FIX_GREP_ALLOC_RULE=guarantee|hh (renderer
  // only) and SS_FIX_GREP_LINES (the engine stamps line classes; the renderer picks by them).
  const fetchFiles = ctx.fix.grepOrder ? Math.max(k, 100) : k;
  const allocOpts = ctx.fix.grepAlloc ? {
    grepFileOrder: 'weight',
    ...(ctx.fix.grepWeight ? { grepFileWeight: ctx.fix.grepWeight } : {}),
    ...(ctx.fix.grepLines ? { grepLineClasses: true } : {}),
  } : {};
  // Run from a subdirectory with no --in, ss-grep searches that subdirectory, as
  // `grep -r` / `rg` do (jj-13: `cd cli/src/config && ss-grep "editor|pager"` returned
  // 942 repo-wide hits in 95 files). The scope travels as an engine fileFilter marked
  // _cwdScope, so the output keeps the unscoped shape (header, per-file body, family
  // manifest, sibling line) with only the out-of-scope hits gone, and no line announces
  // it. At the root, or outside the repository, cwdScope is null: nothing changes.
  const cwdScope = fromFind ? null
    : cwdGrepScope({ cwd: process.cwd(), fileRoot: ctx.fileRoot, indexRoot: ctx.projectRoot });
  const scopeOpts = dirScoped ? { fileFilter: inPaths.length === 1 ? inPaths[0] : inPaths }
    : cwdScope ? { fileFilter: cwdScope, _cwdScope: true } : {};
  const fetchUnscoped = async (rx) => {
    try {
      return await queryWarmSearch(ctx, rx, {
        mode: 'grep', regex: rx, maxMatches: 0, contextLines: 0,
        perFileCap: Math.min(k, 100), maxFiles: fetchFiles,
        ...allocOpts,
        expand: false, rerank: false, useLateInteraction: false,
        _isAgentFormat: !fixedString,
        _siblingLine: process.env.SS_SIBLING_LINE !== '0', // default ON; cost bounded (≤0.6% prompt tokens), see SMOKE-LOSS-FORENSICS §9
        ...scopeOpts,
        ...globOpts,
      });
    } catch {
      const s = await getSweetSearch(ctx);
      return await s.bareGrep(rx, null, {
        regex: rx, maxMatches: 0, contextLines: 0,
        perFileCap: Math.min(k, 100), maxFiles: fetchFiles,
        ...allocOpts,
        _isAgentFormat: !fixedString,
        _siblingLine: process.env.SS_SIBLING_LINE !== '0', // default ON; cost bounded (≤0.6% prompt tokens), see SMOKE-LOSS-FORENSICS §9
        ...scopeOpts,
        ...globOpts,
      });
    }
  };
  const fetched = await fetchWithFixes(fetchUnscoped);
  if (fetched.unparsable) exitUnparsable(fetched.usedRegex);
  const { result, notes, repaired } = fetched;
  const total = result.stats?.totalMatches ?? result.results.length;
  const fileSummary = result.fileSummary
    || { files: [], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
  // B7: >= GREP_COUNTS_THRESHOLD hits print a short line list per file, not the hit-line flood.
  // Source files come first, but a quota of test files stays among the first k files.
  // A typed directory scope keeps the hit text: the agent has already narrowed (Codex review).
  const listMode = ctx.fix.grepOrder && total >= GREP_COUNTS_THRESHOLD && !withContext && !dirScoped;
  const keptMatches = ctx.fix.grepOrder && !ctx.fix.grepAlloc ? orderSourceBeforeTests(result.results, { k }) : result.results;
  // SS_FIX_GREP_FULLLINE (default ON; 0 = the matched substring, byte for byte): each hit prints
  // its full source line, as `grep -n` does.
  const bodyOpts = ctx.fix.grepAlloc
    ? {
      alloc: 'weight',
      ...(ctx.fix.grepOrder ? { dropRepeatedText: true } : {}),
      ...(ctx.fix.grepWeight ? { weight: ctx.fix.grepWeight } : {}),
      ...(ctx.fix.grepAllocRule ? { rule: ctx.fix.grepAllocRule } : {}),
      ...(ctx.fix.grepLines ? { lineClasses: true } : {}),
      ...(ctx.fix.grepLines && ctx.fix.grepLineSpread ? { lineSpread: true } : {}),
      ...(ctx.fix.grepFullLine ? { fullLine: true } : {}),
    }
    : {
      ...(ctx.fix.grepOrder ? { dropRepeatedText: true } : {}),
      ...(ctx.fix.grepFullLine ? { fullLine: true } : {}),
    };
  // A broad grep (>= GREP_BROAD_MIN_HITS total matches) prints each hit line in a narrower window.
  const broadMax = grepBroadHitMax(total);
  const body = renderGrepBody(keptMatches, fileSummary, k, broadMax ? { ...bodyOpts, hitMax: broadMax } : bodyOpts);
  const familyLine = result.familyManifest?.rendered || null;
  if (!repaired) {
    await recordAgentToolCall(ctx, {
      query: fixedString ? undefined : regex,
      regex: fixedString ? undefined : regex,
    });
  }

  // No header. The harness shows the command (regex, globs) right above the output; every file
  // with hits prints its path (more than one path = siblings, E6), a file with hidden hits says
  // `(+N more)` after its last shown hit, and files that did not fit are the `# +N more files` line. So
  // the total and the file count the header used to print can be read off the listing.
  for (const note of notes) process.stdout.write(`${note}\n`);
  if (listMode) {
    const linesByFile = new Map();
    for (const m of result.results) {
      if (!linesByFile.has(m.file)) linesByFile.set(m.file, []);
      linesByFile.get(m.file).push(m.line);
    }
    process.stdout.write(`# ${total} hits: first hit lines per file — list all of one file's hits: ss-grep "<regex>" --in <file>\n`);
    for (const line of renderGrepLineLists(fileSummary.files, linesByFile, k)) process.stdout.write(line + '\n');
    if (fileSummary.hiddenFileCount > 0) {
      process.stdout.write(`# +${fileSummary.hiddenFileCount} more file(s) with ${fileSummary.hiddenMatchCount} match(es) not listed; narrow the regex\n`);
    }
    if (familyLine) process.stdout.write(`${familyLine}\n`);
    if (result.siblingLine?.rendered) process.stdout.write(`${result.siblingLine.rendered}\n`);
    writeRegexDialectHintAfterRepair(result.stats, repaired);
    process.exit(0);
  }
  const listing = renderGrepListing(body.rows, {
    ...context, typed: typedFiles(ctx, inPaths),
    dropText: bodyOpts.dropRepeatedText === true && body.rows.length > 1 && body.rows.every(r => r.text === body.rows[0].text),
    ...(withContext ? { getLines: grepContextLineReader(ctx), matchLines: grepMatchLines(result.results) } : {}),
  });
  for (const line of listing) process.stdout.write(line + '\n');
  if (familyLine) process.stdout.write(`${familyLine}\n`);
  // Singleton hit: the same-file identifier family, with code lines (L1a). The file is the path
  // above; sites that already print as a hit or context row are left out.
  const siblings = grepSiblingLine(result.siblingLine, body.rows, context);
  if (siblings) process.stdout.write(`${siblings}\n`);
  const dirNote = globDirNote(result.stats);
  if (dirNote) process.stdout.write(`${dirNote}\n`);
  writeGrepInterfaceHint(ctx, total, body.rows);
  const hiddenFiles = renderGrepHiddenFiles(body.hidden);
  if (hiddenFiles) process.stdout.write(`${hiddenFiles}\n`);
  if (body.truncatedFileCount > 0 || hiddenFiles) process.stdout.write(`${GREP_HIDDEN_HINT}\n`);
  if (body.shownMatches === 0) {
    // A typed directory scope the index cannot answer for says so, as the flat scoped path does.
    const globNote = globExcludedNote(result.stats, globs);
    let note = null;
    if (!globNote && dirScoped && result.stats?.scopeInGrepIndex !== true) {
      for (const p of inPaths) { note = await notIndexedNote(ctx, p); if (note) break; }
    }
    process.stdout.write(`${globNote || (note ? note.text : (repaired ? REPAIRED_NO_MATCH : '(no matches)'))}\n`);
  }
  writeRegexDialectHintAfterRepair(result.stats, repaired);
  process.exit(0);
}

// The `# also N hits outside --in` line of a scoped ss-grep (renderOutsideScopeLine): the same
// regex and globs, unscoped, files by weight, one hit kept per file. Null on any error.
const OUTSIDE_SCOPE_MAX_FILES = 20;
async function outsideScopeLine(ctx, rx, scopedTotal, scopes, globOpts) {
  if (process.env.SS_GREP_OUTSIDE_SCOPE === '0') return null;
  try {
    // Cost bound first: past ~800 candidate files the engine reads a budget of them, source
    // first, and the line says "N+ files" (grep-outside-probe.js). Otherwise it runs the exact
    // unscoped search in the same call (the scope only feeds the bound).
    const result = await queryWarmSearch(ctx, rx, {
      mode: 'grep', regex: rx, maxMatches: 0, contextLines: 0,
      fileFilter: scopes, grepOutsideProbe: OUTSIDE_SCOPE_MAX_FILES, grepOutsideScopedTotal: scopedTotal,
      perFileCap: 1, maxFiles: OUTSIDE_SCOPE_MAX_FILES, grepFileOrder: 'weight',
      expand: false, rerank: false, useLateInteraction: false, _isAgentFormat: true,
      ...globOpts,
    });
    if (result.stats?.outsideProbe) {
      return renderOutsideScopeProbeLine({ ...result.stats.outsideProbe, scopedTotal, scopes });
    }
    const all = result.stats?.totalMatches ?? result.results.length;
    const summary = result.fileSummary || {};
    return renderOutsideScopeLine({
      files: summary.files || [], hiddenFiles: summary.hiddenFileCount || 0,
      outsideTotal: all - scopedTotal, scopedTotal, scopes,
    });
  } catch {
    return null;
  }
}

// Interface-call trailer on focused greps: hit count ceiling, lines after a hit it looks at,
// and the most trailer lines one grep prints.
const GREP_IMPL_HINT_MAX_MATCHES = 8;
const GREP_IMPL_HINT_LINES_AFTER = 3;
const GREP_IMPL_HINT_MAX_LINES = 3;

// Interface-call trailer on a focused grep (at most GREP_IMPL_HINT_MAX_MATCHES hits): a hit
// whose line or next lines call through an interface names the implementing class, as
// ss-read does (r3-ocelot-03: the hop landed on `TemplatePlaceholderNameAndValues()` at
// line 37 and the interface call `_replacer.Replace` sat on line 38).
function writeGrepInterfaceHint(ctx, total, rows) {
  if (!(total > 0 && total <= GREP_IMPL_HINT_MAX_MATCHES)) return;
  // One graph query per file, not per hit.
  const byFile = new Map();
  for (const r of rows) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }
  const callsOf = new Map();
  for (const [file, hits] of byFile) {
    const found = interfaceCallsInRanges(ctx.projectRoot, file, hits.map(r => ({ startLine: r.line, endLine: r.line + GREP_IMPL_HINT_LINES_AFTER })));
    hits.forEach((r, i) => callsOf.set(r, found[i]));
  }
  const calls = [];
  const seen = new Set();
  for (const r of rows) {
    for (const c of callsOf.get(r)) {
      if (seen.has(c.target)) continue;
      seen.add(c.target);
      calls.push(c);
    }
  }
  const hint = renderInterfaceImpls({ interfaceCalls: calls.slice(0, GREP_IMPL_HINT_MAX_LINES) });
  if (hint) process.stdout.write(`${hint}\n`);
}
