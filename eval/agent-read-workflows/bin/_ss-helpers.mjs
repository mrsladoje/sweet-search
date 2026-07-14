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
import {
  parseBoolFlag, parseValueFlag, parsePositiveIntFlag,
  buildGrepPattern, stripInertFlags, normalizeArgs, extractPositional,
  parseLineRange, looksLikeOption, renderSufficiency,
} from './_ss-argparse.mjs';
import { renderGrepBody } from '../../../core/search/grep-output-shaping.js';
import { formatRouteMetadata } from '../../../core/search/search-format.js';

// Diagnostic-log isolation (agent-facing tools). The Sweet Search engine emits
// model/index load banners via console.log → stdout ("LateInteraction: Loaded…",
// "BinaryHNSW: Loaded…", "Warming up embedding…", "✓ Vocabulary loaded…"). When the
// engine runs IN-PROCESS in this wrapper, that stdout IS the agent's tool result, so a
// cold start crowds out the actual hits and the agent falls back to native tools
// (diagnosed root cause of the sweet≈native tie). The wrappers emit REAL results only
// via process.stdout.write, so redirect every console.log to stderr; the ss-* shell
// wrapper's `2>` suppresses it on success → the agent sees clean results, warm or cold.
// (Production search/grep/find already avoid this: the daemon is spawned stdio:'ignore'.)
console.log = (...args) => process.stderr.write(args.map(a => (typeof a === 'string' ? a : String(a))).join(' ') + '\n');

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

// Pure arg-parsing helpers (parseFlag/parseShortFlag/parseBoolFlag/
// buildGrepPattern/stripInertFlags/normalizeArgs/extractPositional) live in
// ./_ss-argparse.mjs so they can be unit-tested without this file's top-level
// IIFE firing. resolvePositional wraps the side-effect-free extractPositional
// with the CLI's loud-error exit.
function resolvePositional(args, usage) {
  const { pattern, unknownFlag } = extractPositional(args);
  if (unknownFlag) {
    failUsage(`unrecognised option "${unknownFlag}"`, usage);
  }
  return pattern;
}

function failUsage(message, usage) {
  process.stderr.write(`[ss] ${message}\n${usage}\n`);
  process.exit(2);
}

function readPositiveIntFlag(args, names, fallback, usage) {
  const parsed = parsePositiveIntFlag(args, names, fallback);
  if (parsed.error) failUsage(parsed.error, usage);
  return parsed.value;
}

function readValueFlag(args, names, fallback, usage, opts = {}) {
  const parsed = parseValueFlag(args, names, fallback, opts);
  if (parsed.error) failUsage(parsed.error, usage);
  return parsed.value;
}

function rejectUnknownOptions(args, usage) {
  const bad = args.find(looksLikeOption);
  if (bad) failUsage(`unrecognised option "${bad}"`, usage);
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

const GREP_USAGE = 'Usage: ss-grep <regex> [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [--in <file>] [-k N]';
async function cmdGrep(rawArgs) {
  const args = normalizeArgs(rawArgs);
  const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
  const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
  const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
  const k = readPositiveIntFlag(args, ['-k', '--top'], 20, GREP_USAGE);
  // Drill-in scope: show matches from ONE file (the recovery affordance the
  // diversified output advertises when it truncates a flooded file).
  const inFile = readValueFlag(args, '--in', null, GREP_USAGE);
  stripInertFlags(args);
  const regex = buildGrepPattern(resolvePositional(args, GREP_USAGE), { ignoreCase, wordBound, fixedString });
  if (!regex) {
    process.stderr.write(GREP_USAGE + '\n');
    process.exit(2);
  }
  const s = await getSweetSearch();

  if (inFile) {
    // Single-file scope: flat output, depth up to k within that file.
    const result = await s.bareGrep(regex, null, {
      regex, maxMatches: k, contextLines: 0, fileFilter: inFile,
    });
    const total = result.stats?.totalMatches ?? result.results.length;
    process.stdout.write(`# ss-grep: ${total} total match(es) for /${regex}/ (scope: --in ${inFile})\n`);
    result.results.forEach((r, i) => {
      const text = (r.matchText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      const marker = (i === result.results.length - 1 && total > result.results.length)
        ? ` (+${total - result.results.length} more — raise -k)` : '';
      process.stdout.write(`${r.file}:${r.line}: ${text}${marker}\n`);
    });
    if (result.results.length === 0) process.stdout.write('(no matches)\n');
    process.exit(0);
  }

  // k-budget file diversity: fetch at most min(k,100) matches per file across
  // at most k files (a file can never show more than k lines, and more than k
  // files can never fit), then allocate the k body lines breadth-first so one
  // flooded file can never hide every other matching file (the gradethis-161
  // failure). Rendering stays grouped per file; truncation is marked inline
  // and drillable via --in.
  const result = await s.bareGrep(regex, null, {
    regex, maxMatches: 0, contextLines: 0,
    perFileCap: Math.min(k, 100), maxFiles: k,
  });
  const total = result.stats?.totalMatches ?? result.results.length;
  const fileSummary = result.fileSummary
    || { files: [], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
  const body = renderGrepBody(result.results, fileSummary, k);

  // Sibling-surface signal (E6, 2026-07-08 trace audit): when a symbol/stem
  // matches in more than one file, say so unconditionally in the header —
  // the file count is the objective "visible siblings" trigger for
  // fix-surface mapping, and it must not depend on truncation having occurred.
  const across = body.matchedFileCount > 1 ? ` across ${body.matchedFileCount} files` : '';
  process.stdout.write(`# ss-grep: ${total} total match(es) for /${regex}/${across}\n`);
  if (body.truncatedFileCount > 0 || body.hiddenLine) {
    process.stdout.write(`# (+N more in this file)=truncated — ` +
      `see the rest: ss-grep "<regex>" --in <file>\n`);
  }
  for (const line of body.lines) process.stdout.write(line + '\n');
  if (body.hiddenLine) process.stdout.write(body.hiddenLine + '\n');
  if (body.shownMatches === 0) process.stdout.write('(no matches)\n');
  process.exit(0);
}

async function cmdFind(rawArgs) {
  const args = normalizeArgs(rawArgs);
  // ColGrep pattern search with token-budgeted agent packaging — returns the
  // FULL useful answer (ranked code blocks + confidence + sufficiency), the same
  // agent packaging ss-search emits. ss-grep is the short/locator counterpart, so
  // ss-find defaults to the full answer: it saves the follow-up read entirely.
  // (Mirrors the agent-in-the-loop H2H adapter eval/agent-eval/tools/
  // pattern-agent-tools.js, which calls search(...,{format:'agent'}).)
  const FIND_USAGE = 'Usage: ss-find "<query>" --regex "<regex>" [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [--full|--xl] [-k N]';
  let format = 'agent';
  if (args.includes('--full')) { format = 'agent_full'; args.splice(args.indexOf('--full'), 1); }
  if (args.includes('--xl'))   { format = 'agent_full_xl'; args.splice(args.indexOf('--xl'), 1); }
  const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
  const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
  const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
  const k = readPositiveIntFlag(args, ['-k', '--top'], 6, FIND_USAGE);
  const regex = readValueFlag(args, '--regex', '', FIND_USAGE, { allowOptionValue: true });
  stripInertFlags(args);
  const query = resolvePositional(args, FIND_USAGE);
  if (!query) {
    process.stderr.write(FIND_USAGE + '\n');
    process.exit(2);
  }
  // Budget-sweep experiment hook: lets the bench pin the response token budget
  // per-process without changing the agent-visible tool surface.
  const envFindBudget = Number(process.env.SS_SMOKE_FIND_BUDGET || '') || null;
  // Pattern flags apply to the regex candidate generator; the NL query is untouched.
  const effectiveRegex = buildGrepPattern(regex || '', { ignoreCase, wordBound, fixedString });
  const s = await getSweetSearch();
  if (!s.hasLateInteractionIndex) {
    process.stderr.write(`[ss-find] no late-interaction index — falling back to ss-grep\n`);
    return cmdGrep([effectiveRegex || query, '-k', String(k)]);
  }
  const response = await s.patternSearch(query, null, {
    regex: effectiveRegex || `\\b\\w+\\b`,
    k,
    format,
    ...(envFindBudget ? { tokenBudget: envFindBudget } : {}),
  });

  // Header (visible to agent)
  process.stdout.write(`# ss-find: ColGrep ${response.results?.length || 0} for "${query}" /${effectiveRegex || '*'}/` +
    ` budget=${response.tokenBudget} used=${response.tokensUsed} subMode=${response.subMode ?? format}\n`);
  if (response.confidence) {
    process.stdout.write(`# confidence=${response.confidence}${response.confidenceReason ? ' (' + response.confidenceReason + ')' : ''}` +
      `${renderSufficiency(response)}\n`);
  }

  // Per-result blocks — identical shape to ss-search's agent packaging.
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
    if (r.neighbors && r.neighbors.rendered) {
      process.stdout.write(`### related (1-hop graph, ~${r.neighbors.tokens} tok)\n${r.neighbors.rendered}\n`);
    }
    // Same-file span map (top-1, windowed chunk, verdict != YES): sibling
    // symbols just outside the shown window + a copy-paste drill-in command.
    if (r.sameFile && r.sameFile.rendered) {
      process.stdout.write(`${r.sameFile.rendered}\n`);
    }
  }
  if (!response.results || response.results.length === 0) process.stdout.write('(no matches)\n');
  process.exit(0);
}

// ss-read takes NO flags — only positional <file> [start] [end] (or a single
// "start-end" / "start:end" / "start,end" range token). Unlike ss-grep, a stray
// flag here can never silently corrupt the result: the line slots are validated
// as numbers, so a misuse is already a loud error. These hints exist only to
// turn that error into a self-correcting one (the M++ prompt, which we may not
// touch, documents the positional form, not these recovery messages).
const READ_USAGE =
  'Usage: ss-read <file>            # whole file\n' +
  '       ss-read <file> <start>    # ONE line\n' +
  '       ss-read <file> <start> <end>\n' +
  '       ss-read <file> 10-20      # range (also 10:20, 10,20)\n' +
  'Note: ss-read has no flags (no -n/--limit/-r); line selection is positional.';
async function cmdRead(args) {
  const file = args[0];
  if (!file) {
    process.stderr.write(READ_USAGE + '\n');
    process.exit(2);
  }
  if (looksLikeOption(file)) {
    process.stderr.write(`[ss-read] "${file}" looks like a flag, but ss-read takes a file path first.\n${READ_USAGE}\n`);
    process.exit(2);
  }
  // If start is provided and end is omitted, read EXACTLY that one line —
  // no open-ended start-to-EOF (which a previous version did and which
  // caused accidental over-reading on large files).
  let start = null, end = null;
  if (args[1] != null) {
    // Accept a single-token range (10-20 / 10:20 / 10,20) before the plain
    // numeric path, so "lines 10-20" muscle memory works without a wasted call.
    const range = parseLineRange(args[1]);
    if (range && args[2] == null) {
      start = range.start;
      end = range.end;
    } else {
      start = +args[1];
      if (!Number.isFinite(start) || start < 1) {
        process.stderr.write(`[ss-read] invalid start line: "${args[1]}" (expected a line number, e.g. 10, or a range like 10-20)\n${READ_USAGE}\n`);
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
  }
  const { readFile, renderUnreadBelow } = await import(path.join(REPO_ROOT, 'core/search/search-read.js'));
  const r = await readFile({ path: file, projectRoot: PROJECT_ROOT, startLine: start ?? undefined, endLine: end ?? undefined });
  if (!r.ok) {
    process.stderr.write(`[ss-read] error: ${r.error}\n`);
    process.exit(1);
  }
  const range = r.range ? ` (lines ${r.range.startLine}-${r.range.endLine} of ${r.totalLines})` : ` (${r.totalLines} lines)`;
  const fence = r.language ? '```' + r.language : '```';
  // "What remains" trailer: on a range read that stops before EOF, one final
  // line names the symbols in the unread remainder + the exact continue
  // command (last line for recency — the actionable form of truncation).
  const remainder = renderUnreadBelow(r, { command: 'ss-read' });
  process.stdout.write(`# ss-read ${r.file}${range}\n${fence}\n${r.text}\n\`\`\`${remainder ? '\n' + remainder : ''}\n`);
  process.exit(0);
}

const SEARCH_USAGE = 'Usage: ss-search "<query>" [--full|--xl] [-k N] [--mode auto|lexical|semantic|hybrid]';
async function cmdAgentSearch(rawArgs) {
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

  const { queryServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
  const serverUsed = await ensureWarmServerReady();
  if (!serverUsed) {
    process.stderr.write('[ss-search] warm server is not ready; refusing cold direct search in benchmark wrapper\n');
    process.exit(1);
  }

  // Budget-sweep experiment hook: per-request explicit budget (overrides the
  // auto-tier on the warm server; flows as the `budget` URL param).
  const envSearchBudget = Number(process.env.SS_SMOKE_SEARCH_BUDGET || '') || null;
  const response = await queryServer(query, { topK: k, mode, format, ...(envSearchBudget ? { tokenBudget: envSearchBudget } : {}) });
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
    // Emit a route trailer so the mismatch remains explicit in agent output.
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
      `${renderSufficiency(response)}\n`);
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
    // Same-file span map (top-1, windowed chunk, verdict != YES): sibling
    // symbols just outside the shown window + a copy-paste drill-in command.
    if (r.sameFile && r.sameFile.rendered) {
      process.stdout.write(`${r.sameFile.rendered}\n`);
    }
  }

  if (!response.results || response.results.length === 0) {
    process.stdout.write('(no matches)\n');
  }

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
    sufficiencyVerdict: response.sufficiencyVerdict ?? null,
    sufficiencyReason: response.sufficiencyReason ?? null,
    sufficiencyReasons: Array.isArray(response.sufficiencyReasons) ? response.sufficiencyReasons : null,
    unresolvedExternalCount: typeof response.unresolvedExternalCount === 'number'
      ? response.unresolvedExternalCount : null,
    sameFileMapTokens: response.results?.[0]?.sameFile?.tokens ?? null,
    sameFileNeighborCount: response.results?.[0]?.sameFile?.neighbors?.length ?? null,
  };
  process.stdout.write(`\n${formatRouteMetadata(meta, {
    _isAgentFormat: true,
    debug: process.env.SWEET_SEARCH_ROUTE_META_DEBUG === '1',
  })}\n`);
  process.exit(0);
}

const SEMANTIC_USAGE = 'Usage: ss-semantic <file> "<question>" [--max-tokens N]';
async function cmdSemantic(rawArgs) {
  const args = normalizeArgs(rawArgs);
  // Default 600 (was 800) per the 2026-06 budget sweep — scaled with the 3k
  // preview tier. Env hook overrides the default for sweeps; an explicit
  // --max-tokens flag from the agent always wins.
  const maxTokens = readPositiveIntFlag(args, '--max-tokens',
    Number(process.env.SS_SMOKE_SEMANTIC_MAXTOKENS || '') || 600, SEMANTIC_USAGE);
  rejectUnknownOptions(args, SEMANTIC_USAGE);
  const file = args[0];
  const query = args[1];
  if (!file || !query) {
    process.stderr.write(SEMANTIC_USAGE + '\n');
    process.exit(2);
  }
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

const TRACE_USAGE = 'Usage: ss-trace <symbol> [--in <file>] [--query <hint>] [--depth N] [--budget N]';
async function cmdTrace(rawArgs) {
  const args = normalizeArgs(rawArgs);
  let json = false;
  if (args.includes('--json')) {
    json = true;
    args.splice(args.indexOf('--json'), 1);
  }
  const { traceSymbol, formatStructuralContext } = await import(path.join(REPO_ROOT, 'core/search/search-trace.js'));

  const opts = { projectRoot: PROJECT_ROOT };
  const file = readValueFlag(args, ['--in', '--file'], null, TRACE_USAGE);
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
  if (depth != null) opts.maxDepth = depth;
  // Budget-sweep experiment hook: env sets the default; explicit --budget wins.
  if (budget != null) opts.tokenBudget = budget;
  else if (Number(process.env.SS_SMOKE_TRACE_BUDGET || '') > 0) opts.tokenBudget = Number(process.env.SS_SMOKE_TRACE_BUDGET);

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
