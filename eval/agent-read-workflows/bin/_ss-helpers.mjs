#!/usr/bin/env node
// The ss-* agent tools. Each subcommand is a thin, agent-friendly skin over the JS API:
//   grep      → SweetSearch.bareGrep        (indexed lexical grep, gram-prefiltered)
//   find      → SweetSearch.patternSearch   (ColGrep — regex candidates, MaxSim re-rank)
//   read      → search-read.readFile        (filesystem-grounded read with optional line range)
//   semantic  → search-read-semantic.readSemantic (query-specific spans within one file)
//
// Output is compact, deterministic, agent-readable (one match per line for
// discovery; fenced code for reads). No colour codes. No JSON unless asked.
//
// ONE CALL = ONE VIRTUAL PROCESS. `runAgentTool` is written as if it owned the process:
// it reads process.env and process.cwd(), writes to process.stdout/stderr and ends with
// process.exit(code). It always runs inside core/agent-tools/virtual-process.js, which
// scopes all of those to the call. The resident daemon runs it warm for the native ss-*
// client (POST /agent-tool); core/agent-tools/cli.js runs it in a fresh process as the
// fallback. Both are the same code, so both print the same bytes.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseBoolFlag, parseValueFlag, parsePositiveIntFlag,
  parseRepeatedValueFlag, extraPositionals,
  buildGrepPattern, stripInertFlags, normalizeArgs, extractPositional,
  parseLineRange, looksLikeOption, renderSufficiency, absorbPositionalPaths as absorbPositionalPathsPure,
  parseContextFlags, parseGlobFlags,
} from './_ss-argparse.mjs';
import {
  reallocateGrepTailForManifest,
  renderGrepBody,
  renderGrepContext,
} from '../../../core/search/grep-output-shaping.js';
import { cwdGrepScope, resolveCwdGlob, resolveCwdPath } from '../../../core/search/cwd-paths.js';
import { SEARCH_LOADING_WAIT_MS, searchNotReadyLine, callStartedMs } from '../../../core/agent-tools/tools.js';
import { formatRouteMetadata } from '../../../core/search/search-format.js';
import { createAdmissionPolicy } from '../../../core/indexing/admission-policy.js';
import { createIndexCoverage, semanticTargetFor } from '../../../core/search/index-coverage.js';
import { resolveRoots } from '../../../core/search/worktree-roots.js';
import { numberCodeLines, lineGutterEnabled } from '../../../core/search/search-read.js';
import { renderRegexDialectHint } from '../../../core/search/regex-dialect.js';
import {
  applyReadOmissionDecisions,
  collectAgentShownSpans,
  collectReadShownSpans,
  collectSemanticShownSpans,
  exactRereadOmissionEnabled,
  renderReadOmission,
  renderShownFullTrailer,
  resolveAgentSessionId,
  shownSpanTrailerEnabled,
} from '../../../core/search/agent-span-ledger.js';
import { formatAlsoLine, formatSpanSymbols } from '../../../core/search/semantic-also.js';
import { omittedRangeLines } from '../../../core/search/semantic-span-budget.js';
import { sendAgentSpanOperation } from '../../../core/search/agent-span-client.js';
import {
  GREP_COUNTS_THRESHOLD,
  alreadyShownSessionId,
  alternativesAfterSwitch,
  decideAlreadyShown,
  formatTraceCompact,
  isRegexParseError,
  grepHitText,
  isTestLikePath,
  matchTextIsRepeated,
  orderSourceBeforeTests,
  printedSpanCandidates,
  readFixFlags,
  readSpansForAlreadyShown,
  renderCompactHeader,
  renderCompactSufficiency,
  renderFixedBlocks,
  renderGrepLineLists,
  repairRegexBranches,
  resolveThreadKey,
  resultRenderFixActive,
  resultsForOriginalLedger,
  selectEntries,
  grepBroadHitMax,
} from '../../../core/search/agent-output-fixes.js';

// Diagnostic-log isolation (agent-facing tools). The Sweet Search engine emits
// model/index load banners via console.log → stdout ("LateInteraction: Loaded…",
// "BinaryHNSW: Loaded…", "Warming up embedding…", "✓ Vocabulary loaded…"). When the
// engine runs IN-PROCESS, that stdout IS the agent's tool result, so a cold start crowds
// out the actual hits and the agent falls back to native tools (diagnosed root cause of
// the sweet≈native tie). The tools emit REAL results only via process.stdout.write, and
// the virtual process (core/agent-tools/virtual-process.js) sends every console.log of a
// call to that call's stderr, which the agent sees only on a non-zero exit.

// 8-char SHA1 prefix is enough for grouping identical queries across
// benchmark runs without bloating artifacts.
function shortQueryHash(q) {
  try { return createHash('sha1').update(String(q)).digest('hex').slice(0, 16); }
  catch { return null; }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// EVERY code block the ss-* wrappers hand the agent goes through the SAME gutter as
// `ss-read`. It used not to: `ss-search`, `ss-find` and `ss-semantic` wrote `r.code` and
// `span.text` raw while `ss-read` numbered, so 27-36% of delivered code lines arrived
// unnumbered and 5-10% of edits anchored on them. A model that has to strip a prefix on
// some blocks and not others is being handed two formats for one job.
//
// `search-server.js` and `search-read-semantic.js` already number on the daemon path; this
// closes the CLI path so the two agree.
function gutter(text, startLine) {
  return (lineGutterEnabled() && text) ? numberCodeLines(text, startLine || 1) : text;
}


/**
 * Run one ss-* subcommand. See the header: this must run inside a virtual process.
 *
 * @param {string} subcommand  grep | find | read | semantic | trace | agent-search
 * @param {string[]} rest      the arguments after the subcommand
 * @param {object} [host]      set by the resident daemon:
 *   host.getSearcher()          its warm SweetSearch (no second cold engine in the daemon)
 *   host.assertProjectRoot(r)   throws when this call belongs to another repository's daemon
 */
export async function runAgentTool(subcommand, rest, host = {}) {
// The agent's cwd is the target repo. SWEET_SEARCH_PROJECT_ROOT must point
// at the repo so DB_PATHS resolves to the repo's own .sweet-search/.
//
// TWO ROOTS, NOT ONE, when the session runs inside a LINKED GIT WORKTREE. A worktree is a
// second checkout sharing the main repository's `.git`, and it has no `.sweet-search/` of
// its own, so every ss-* call used to exit 2 — on a surface Claude Code's desktop app,
// `claude --worktree` and worktree-isolated subagents all put agents on.
//
//   PROJECT_ROOT  where the index lives. One index describes the repository and serves
//                 every checkout of it.
//   FILE_ROOT     where the agent's own files are. ss-read and ss-semantic resolve paths
//                 here, because every byte the agent edits comes from its own worktree.
//
// Pointing BOTH at the main checkout is what the bench pin did, and it was worse than
// failing: the tools read the parent's uncommitted tree while `Read` saw the clean
// worktree (45 worktree-scoped zeros in 5 of 66 rollouts; 6 of 22 subagent results echoed
// the parent's own edit). So the split is announced, never silent, and with no index
// anywhere the tools REFUSE with a hint instead of guessing.
const { indexRoot: PROJECT_ROOT, fileRoot: FILE_ROOT, split: WORKTREE_SPLIT, refusal: ROOT_REFUSAL, notice: ROOT_NOTICE } =
  resolveRoots({ cwd: process.cwd(), explicitRoot: process.env.SWEET_SEARCH_PROJECT_ROOT || '' });

if (ROOT_REFUSAL) {
  process.stderr.write(`${ROOT_REFUSAL}\n`);
  process.exit(2);
}
if (!existsSync(path.join(PROJECT_ROOT, '.sweet-search', 'codebase.db'))) {
  process.stderr.write(
    `[ss-*] no Sweet Search index at ${PROJECT_ROOT}/.sweet-search/codebase.db\n` +
    `Run: SWEET_SEARCH_PROJECT_ROOT=${PROJECT_ROOT} node ${REPO_ROOT}/core/indexing/index-codebase-v21.js --full --sqlite-fast\n`
  );
  process.exit(2);
}
// STDOUT, not stderr: the ss-* shell wrappers discard stderr on a zero exit, so a notice
// written there would never reach the agent — and "never redirect silently" is the whole
// requirement. One line, once per process, and only inside a linked worktree, so it costs
// the benchmark nothing and costs a real worktree user one line.
if (WORKTREE_SPLIT && ROOT_NOTICE) process.stdout.write(`${ROOT_NOTICE}\n`);
// Before anything is recorded or searched: a daemon answers for its own repository only.
host.assertProjectRoot?.(PROJECT_ROOT);
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

const AGENT_SESSION_ID = resolveAgentSessionId();
const EXACT_REREAD_OMISSION = exactRereadOmissionEnabled();
const SHOWN_SPAN_TRAILER = shownSpanTrailerEnabled();
const SPAN_POLICY_ENABLED = EXACT_REREAD_OMISSION || SHOWN_SPAN_TRAILER;

// Output-fix switches (see core/search/agent-output-fixes.js). Bundle A (A1, A2, A7, A4, A5) is the
// product default, and so are SS_FIX_GREP_ALLOC (ss-grep line allocation) and SS_FIX_GREP_FULLLINE (ss-grep
// full hit lines), and since 2026-10-03 SS_FIX_GREP_LINES, SS_FIX_GREP_ALLOC_RULE=guarantee,
// SS_FIX_GREP_WEIGHT=sat2, SS_FIX_SEMANTIC_RANGES and SS_FIX_TRACE_MODE_BUDGET; SWEET_SEARCH_COMPACT_OUTPUT=0
// or SS_FIX_A=0 restores the previous output byte for byte. Every other SS_FIX_* switch is default
// off (bench only).
const FIX = readFixFlags();
// A3 (SS_FIX_ALREADY_SHOWN only; not part of SS_FIX_A). AGENT_SESSION_ID above, the original
// ledger and so ss-read are never changed by it: A3 keeps its receipts under its own ledger
// namespace (`a3:<thread key>`), with the wider thread key that also knows the Claude Code and
// opencode variables. Needs the receipt ledger on. LIMIT: the key cannot tell a subagent from
// its parent (FIXES-IMPL.md), which is why this switch stays default off.
const A3_SESSION_ID = FIX.alreadyShown && EXACT_REREAD_OMISSION ? alreadyShownSessionId(resolveThreadKey()) : null;
const ALREADY_SHOWN_ON = !!A3_SESSION_ID;
// final-tuning variant SS_VARIANT_SEARCH_DEDUPE (ss-search only since fff75887).
const DEDUPE = process.env.SS_VARIANT_SEARCH_DEDUPE === '1';

async function recordAgentToolCall({
  operation = 'observe',
  spans = [],
  force = false,
  query,
  regex,
} = {}) {
  if (!EXACT_REREAD_OMISSION || !AGENT_SESSION_ID) return null;
  return sendAgentSpanOperation({
    operation,
    spans,
    force,
    sessionId: AGENT_SESSION_ID,
    query,
    regex,
  });
}

// Entry plan for the fixed ss-search / ss-find renderer (see selectEntries).
function planFixedResults(results, { k, find }) {
  return selectEntries(results, {
    dedupe: FIX.compact ? 'a2' : (DEDUPE && !find ? 'v3' : false),
    onePerFile: !find && FIX.onePerFile,
    summaryCap: FIX.summaryCap,
    k,
  });
}

// A3: which printed blocks this thread already saw (own ledger namespace). Fail open.
async function alreadyShownFor(results, plan) {
  if (!ALREADY_SHOWN_ON || !plan) return new Set();
  try {
    return await decideAlreadyShown({
      send: sendAgentSpanOperation,
      sessionId: A3_SESSION_ID,
      candidates: printedSpanCandidates(results, plan, { projectRoot: FILE_ROOT }),
    });
  } catch {
    return new Set();
  }
}

// A3: ss-read / ss-semantic only RECORD what they printed (A3 namespace); their output is not
// changed and the reply is ignored. Fail open.
async function recordForAlreadyShown(spans, decisions, printedChars) {
  if (!ALREADY_SHOWN_ON) return;
  try {
    await sendAgentSpanOperation({
      operation: 'observe',
      spans: readSpansForAlreadyShown(spans, decisions, printedChars),
      sessionId: A3_SESSION_ID,
    });
  } catch { /* the receipt is best effort */ }
}

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

/**
 * True when `args[i]` is the value belonging to the flag before it, rather than a
 * positional of its own. Needed because ss-trace's flags are all space-separated
 * (`--in <file>`), so a naive "second non-flag token" scan would read a flag's value as
 * the mode word.
 */
function looksLikeTraceOptionValue(args, i) {
  const token = String(args[i] ?? '');
  if (token.startsWith('-')) return true;                     // a flag, not a positional
  const prev = String(args[i - 1] ?? '');
  return prev.startsWith('-') && !prev.includes('=');         // the previous flag's value
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

function readRepeatedValueFlag(args, names, usage) {
  const parsed = parseRepeatedValueFlag(args, names);
  if (parsed.error) failUsage(parsed.error, usage);
  return parsed.values;
}

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

function rejectUnknownOptions(args, usage) {
  const bad = args.find(looksLikeOption);
  if (bad) failUsage(`unrecognised option "${bad}"`, usage);
}

// Agents pass `-k N` to every ss-* tool by habit (it sizes ss-grep, ss-find and ss-search).
// A tool without a result count takes it and ignores it, instead of failing the call on a
// usage error (2 Codex calls on ss-semantic, TRACES-rules3). Consumes `-k N`, `-kN`,
// `--top N`; returns the count (unused by the caller) or null.
function takeCountFlag(args, usage) {
  const at = args.findIndex((a) => /^-k\d+$/.test(a));
  if (at !== -1) args.splice(at, 1, '-k', args[at].slice(2));
  return readPositiveIntFlag(args, ['-k', '--top'], null, usage);
}

// Every path argument resolves the way the shell would: relative to the agent's cwd
// first, then (unchanged) relative to the repository root. The result is the
// root-relative spelling, so all output stays root-relative (core/search/cwd-paths.js).
// `cd okhttp3 && ss-read Dispatcher.kt 190 215` used to fail with ENOENT.
function cwdPath(p) {
  return resolveCwdPath(p, { cwd: process.cwd(), root: FILE_ROOT });
}

// --in values and absorbed positional scopes, cwd-first, de-duplicated (in place).
function resolveScopePaths(inPaths) {
  const resolved = [...new Set(inPaths.map(cwdPath))];
  inPaths.splice(0, inPaths.length, ...resolved);
}

// ss-grep / ss-find -g globs (and --include / --exclude / --exclude-dir), in rg form. A glob
// typed from a subdirectory is re-anchored the way rg anchors it, at the cwd, with the same
// root-relative fallback as a path (resolveCwdGlob); `resolve: false` for ss-find's fallback,
// whose globs are already resolved.
function readGlobFlags(args, usage, { resolve = true } = {}) {
  const parsed = parseGlobFlags(args);
  if (parsed.error) failUsage(parsed.error, usage);
  if (!resolve) return parsed.globs;
  return [...new Set(parsed.globs.map(g => resolveCwdGlob(g, { cwd: process.cwd(), root: FILE_ROOT })))];
}

/** The globs as the agent can paste them back: ` -g '!lib/tests/**'` per glob. */
function globEcho(globs) {
  return globs.map(g => ` -g '${g.replace(/'/g, `'\\''`)}'`).join('');
}

// Every match the -g globs removed, when they removed all of them: never a bare
// "(no matches)", which reads as "the pattern is absent".
function globExcludedNote(stats, globs) {
  const n = stats?.pathGlobExcludedMatches || 0;
  if (!globs.length || n === 0) return null;
  const files = stats?.pathGlobExcludedFiles;
  return `(no matches outside the globs:${globEcho(globs)} removed all ${n} match(es)`
    + `${files ? ` in ${files} file(s)` : ''}; drop or widen a glob to see them)`;
}

// Grep muscle memory writes `ss-grep "pat" src/foo` with the scope as a bare
// positional instead of `--in src/foo`. Absorb any such trailing positional that
// resolves to a real path under the project (pure logic lives in _ss-argparse so
// it is unit-tested; the path predicate is injected here).
function absorbPositionalPaths(args, inPaths) {
  absorbPositionalPathsPure(args, inPaths,
    (tok) => existsSync(path.isAbsolute(tok) ? tok : path.resolve(FILE_ROOT, cwdPath(tok))));
}

// File contents for grep context lines, read from the agent's own files (FILE_ROOT).
// Cached per call; null when the file cannot be read (the hit then prints alone).
function grepContextLineReader() {
  const cache = new Map();
  return (file) => {
    if (!cache.has(file)) {
      let lines = null;
      try {
        const abs = path.isAbsolute(file) ? file : path.join(FILE_ROOT, file);
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

// When a scope resolves to a real path on disk but the index does not hold it, a 0-result
// answer means "not searchable", not "searched and absent". Say which, so the agent stops
// grepping a bundle like dist/index.js and looks at real source.
//
// THE PATH PREDICATE WAS NOT ENOUGH. This used to ask `admitsShape(rel)`, a PATH rule. The
// indexer ALSO drops files by CONTENT: a committed bundle is git-tracked, so the path rules
// re-admit it and the minified-shape rule then drops it anyway. `admitsShape` answered
// "admitted", so the wrapper printed a bare `(no matches)` on `--in dist/index.js`. Asking
// the index itself cannot drift from the indexer, whatever rule did the dropping.
//
// Built once, lazily, and only on a branch that is already about to explain something.
let _coverage = null;
let _coverageTried = false;
async function getCoverage() {
  if (_coverageTried) return _coverage;
  _coverageTried = true;
  try { _coverage = await createIndexCoverage({ projectRoot: PROJECT_ROOT }); }
  catch { _coverage = null; }
  return _coverage;
}

/**
 * `{kind, reason, text}` when the index does not hold `scopePath`, else null.
 * `kind` is 'excluded' (the indexer will never hold it) or 'stale' (it would, but this
 * index has not seen it yet). Callers must not treat those the same: refusing to show a
 * file body is right for the first and wrong for the second.
 */
async function notIndexedNote(scopePath) {
  const cov = await getCoverage();
  if (!cov) return null;
  try { return await cov.notIndexedNote(scopePath); } catch { return null; }
}

// A scope that does not exist on disk is the loudest case: 10 of 11 such calls in the
// fresh pool printed a bare `(no matches)`, which says "your pattern is absent" about
// a directory that was never searched. Usually a mistyped or invented path
// (`src/b2/build/x` for `src/build/x`). Say so and name the repair. Informative, not a
// crash: the pattern may still be fine. A distinct exit code (3) lets a wrapper or a
// script tell "scope wrong" from "searched and found nothing" (0). ss-grep and ss-find.
function exitScopeNotFound(missing) {
  process.stdout.write(`(scope not found: ${missing.join(', ')} — nothing was searched under `
    + `${missing.length > 1 ? 'those paths' : 'that path'}. This is NOT an absence of matches. `
    + `Locate the real path first: ss-grep "<name>" with no --in, then re-scope.)\n`);
  process.exit(3);
}

/** The `--in` scopes that do not exist on disk at all. */
function missingScopes(scopePaths) {
  return (scopePaths || []).filter((p) => {
    if (!p) return false;
    try { return !existsSync(path.isAbsolute(p) ? p : path.resolve(FILE_ROOT, p)); }
    catch { return false; }
  });
}

async function getSweetSearch() {
  if (host.getSearcher) return host.getSearcher();
  // In-process cold-start loads the LI/HNSW indexes and the embedding model,
  // which print load banners ("BinaryHNSW: Loaded …", "LateInteraction: …",
  // "Loading local model: …") via raw console.log — i.e. onto THIS process's
  // stdout, which the agent captures as the tool result. The warm-daemon path
  // never leaks (it spawns detached with stdio:'ignore'); only this fallback
  // does. Reroute stdout writes to stderr for the duration of init so the boot
  // noise stays in the logs but never contaminates the agent-visible output.
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);
  try {
    const { SweetSearch } = await import(path.join(REPO_ROOT, 'core/search/sweet-search.js'));
    const s = new SweetSearch({ projectRoot: PROJECT_ROOT });
    await s.init();
    return s;
  } finally {
    process.stdout.write = origWrite;
  }
}

// ss-search has no cold fallback here, so it waits for a daemon that is still loading.
// r282 Codex r1 typedoc: the daemon was cold-starting while another cell warmed 8 servers;
// the 60 s wait ran out and 5 searches were refused. A daemon that is listening (busy
// loading) is waited for, never replaced: a second spawn would only race it for the socket.
// The wait is SEARCH_LOADING_WAIT_MS (90 s), under the harnesses' 120 s command cap.
const SPAWN_RETRY_MS = 60_000;

/** 'ready', 'loading' (not ready by the deadline) or 'failed' (init failed, even after one replacement). */
async function ensureWarmServerReady({ timeoutMs = SEARCH_LOADING_WAIT_MS, startedMs = Date.now(), intervalMs = 500 } = {}) {
  // Inside the daemon: it is the warm server, and it only takes a call once ready.
  if (host.getSearcher) return 'ready';
  const { getServerHealth, isServerListening, autoSpawnServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
  const deadline = startedMs + timeoutMs;
  let spawns = 0;
  let lastSpawnAt = 0;
  for (;;) {
    const health = await getServerHealth({ timeoutMs: 1000 });
    if (health?.status === 'ready' || health?.warm === true) return 'ready';
    // A daemon whose init failed stays resident until its idle TTL; a fresh spawn replaces
    // it (the new daemon's startup guard stops a failed one). Once, then give up.
    if (health?.status === 'failed') {
      if (spawns > 0 || Date.now() >= deadline) return 'failed';
      spawns++;
      lastSpawnAt = Date.now();
      await autoSpawnServer({ quiet: true });
      continue;
    }
    if (Date.now() >= deadline) return 'loading';
    // No daemon at all (never started, or it exited): start one. autoSpawnServer has a
    // short built-in wait and may return before the detached server binds its socket, so
    // a second spawn waits SPAWN_RETRY_MS — sooner, it would race the first for the socket.
    if (!health && spawns < 2 && Date.now() - lastSpawnAt >= SPAWN_RETRY_MS && !await isServerListening()) {
      spawns++;
      lastSpawnAt = Date.now();
      await autoSpawnServer({ quiet: true });
      continue;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
}

async function queryWarmSearch(query, options) {
  if (await ensureWarmServerReady({ timeoutMs: 5000 }) !== 'ready') {
    throw new Error('warm server is not ready');
  }
  const { queryServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
  const response = await queryServer(query, {
    ...options,
    projectRoot: PROJECT_ROOT,
    trackAgentSpans: false,
    _isAgentFormat: options._isAgentFormat ?? true,
  });
  if (response?.error) throw new Error(response.error);
  return response;
}

function writeRegexDialectHint(stats) {
  const note = renderRegexDialectHint(stats?.regexDialectHint);
  if (note) process.stdout.write(`${note}\n`);
}

// A5: after a repair, the engine's "the original pattern was used unchanged" note describes the
// wrapper's escaped pattern, not the agent's, so it is left out (the repair note says what was
// searched). A note about the engine's own GNU-dialect retry still prints: the hits shown then
// come from that retry (an agent-written `\(a\)` searched as `(a)`), and the agent must know it.
function writeRegexDialectHintAfterRepair(stats, repaired) {
  if (!repaired || stats?.regexDialectHint?.retryAttempted) writeRegexDialectHint(stats);
}

// --- subcommands ----------------------------------------------------------

const GREP_USAGE = 'Usage: ss-grep <regex> [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [--in <path>]... '
  + "[-g|--glob '<glob>']... [-k N] [-A N] [-B N] [-C N]\n"
  + "  -g '*.h' searches only matching files; -g '!tests/**' excludes (exclusion wins). Also --include <glob>, --exclude <glob>, --exclude-dir <dir>.";
// `fromFind`: ss-find's fallback when there is no late-interaction index. Its --in paths are
// already resolved (resolving them again would re-apply the cwd), and ss-find has no implicit
// cwd scope, so the fallback must not pick up ss-grep's.
async function cmdGrep(rawArgs, { fromFind = false } = {}) {
  const args = normalizeArgs(rawArgs);
  const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
  const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
  const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
  const k = readPositiveIntFlag(args, ['-k', '--top'], 20, GREP_USAGE);
  // grep's -A/-B/-C: native agents use them in ~13% of grep calls (an enum body in one
  // call). Rendered client-side from the agent's own files, in grep's own shape; with no
  // context flag every byte below is what it was.
  const context = parseContextFlags(args);
  if (context.error) failUsage(context.error, GREP_USAGE);
  const withContext = context.before > 0 || context.after > 0;
  // Drill-in scope: restrict matches to the named files or directories (the
  // recovery affordance the diversified output advertises when it truncates a
  // flooded file). Repeatable — one path per flag, every one applied.
  const inPaths = readRepeatedValueFlag(args, '--in', GREP_USAGE);
  // -g include / !exclude globs, ANDed with --in; evaluated by the engine on the native path.
  const globs = readGlobFlags(args, GREP_USAGE, { resolve: !fromFind });
  const globOpts = globs.length ? { pathGlobs: globs } : {};
  stripInertFlags(args);
  absorbPositionalPaths(args, inPaths);
  if (!fromFind) resolveScopePaths(inPaths);
  rejectExtraPositionals(args, GREP_USAGE);
  const rawPattern = resolvePositional(args, GREP_USAGE);
  const regex = buildGrepPattern(rawPattern, { ignoreCase, wordBound, fixedString });
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
    if (!FIX.grepRetry) return { result: await fetch(regex), usedRegex: regex, notes: [], repaired: false };
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
        : `(invalid regex "${rawPattern}" — escaped only the part(s) that did not parse; the header shows the pattern searched)`);
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

  if (inPaths.length > 0) {
    // Scoped: flat output, depth up to k across the named scopes.
    const fileFilter = inPaths.length === 1 ? inPaths[0] : inPaths;
    const fetchScoped = async (rx) => {
      try {
        return await queryWarmSearch(rx, {
          mode: 'grep', regex: rx, maxMatches: k, contextLines: 0,
          fileFilter, expand: false, rerank: false, useLateInteraction: false,
          _isAgentFormat: !fixedString,
          ...globOpts,
        });
      } catch {
        const s = await getSweetSearch();
        return await s.bareGrep(rx, null, {
          regex: rx, maxMatches: k, contextLines: 0, fileFilter,
          _isAgentFormat: !fixedString,
          ...globOpts,
        });
      }
    };
    const fetched = await fetchWithFixes(fetchScoped, { scopeMissing: FIX.grepRetry && missingScopes(inPaths).length > 0 });
    if (fetched.unparsable) exitUnparsable(fetched.usedRegex);
    const { result, usedRegex, notes, repaired } = fetched;
    const total = result.stats?.totalMatches ?? result.results.length;
    if (!repaired) {
      await recordAgentToolCall({
        query: fixedString ? undefined : regex,
        regex: fixedString ? undefined : regex,
      });
    }
    // Every applied scope is echoed. The header used to print one value however
    // many were supplied, which made the loss look like intended behaviour.
    const scopes = inPaths.map(p => `--in ${p}`).join(' ');
    process.stdout.write(`# ss-grep: ${total} total match(es) for /${usedRegex}/ (scope: ${scopes}${globEcho(globs)})\n`);
    for (const note of notes) process.stdout.write(`${note}\n`);
    // SS_FIX_GREP_ORDER (B7): source hits before test hits; no repeated matched-text column.
    const rows = FIX.grepOrder ? orderSourceBeforeTests(result.results) : result.results;
    const broadMax = grepBroadHitMax(FIX, total);
    const hitText = { fullLine: FIX.grepFullLine, ...(broadMax ? { max: broadMax } : {}) };
    const dropText = FIX.grepOrder && matchTextIsRepeated(rows, hitText);
    const shown = rows.map((r, i) => ({
      file: r.file,
      line: r.line,
      text: grepHitText(r, hitText),
      suffix: (i === rows.length - 1 && total > rows.length)
        ? ` (+${total - rows.length} more — raise -k)` : '',
    }));
    if (withContext) {
      for (const line of renderGrepContext(shown, {
        ...context, getLines: grepContextLineReader(), matchLines: grepMatchLines(result.results),
      })) process.stdout.write(`${line}\n`);
    } else {
      for (const r of shown) {
        process.stdout.write(dropText ? `${r.file}:${r.line}${r.suffix}\n` : `${r.file}:${r.line}: ${r.text}${r.suffix}\n`);
      }
    }
    let zeroExplained = false;
    if (result.results.length === 0) {
      // A scope that does not exist on disk is the loudest case (exitScopeNotFound).
      const missing = missingScopes(inPaths);
      if (missing.length) exitScopeNotFound(missing);
      // Then globs that removed every match in the scope.
      const globNote = globExcludedNote(result.stats, globs);
      // Then a scope the index cannot answer for: an agent that scoped to a bundle needs to
      // know that before it decides the pattern is absent.
      // The grep index covers more than the vector index the note reads (grep-corpus.js), so
      // a scope the grep index holds is a searched scope, whatever the note would say.
      let note = null;
      const grepCovered = result.stats?.scopeInGrepIndex === true;
      if (!globNote && !grepCovered) for (const p of inPaths) { note = await notIndexedNote(p); if (note) break; }
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
  const fetchFiles = FIX.grepOrder ? Math.max(k, 100) : k;
  const allocOpts = FIX.grepAlloc ? {
    grepFileOrder: 'weight',
    ...(FIX.grepWeight ? { grepFileWeight: FIX.grepWeight } : {}),
    ...(FIX.grepLines ? { grepLineClasses: true } : {}),
  } : {};
  // Run from a subdirectory with no --in, ss-grep searches that subdirectory, as
  // `grep -r` / `rg` do (jj-13: `cd cli/src/config && ss-grep "editor|pager"` returned
  // 942 repo-wide hits in 95 files). The scope travels as an engine fileFilter marked
  // _cwdScope, so the output keeps the unscoped shape (header, per-file body, family
  // manifest, sibling line) with only the out-of-scope hits gone, and no line announces
  // it. At the root, or outside the repository, cwdScope is null: nothing changes.
  const cwdScope = fromFind ? null
    : cwdGrepScope({ cwd: process.cwd(), fileRoot: FILE_ROOT, indexRoot: PROJECT_ROOT });
  const scopeOpts = cwdScope ? { fileFilter: cwdScope, _cwdScope: true } : {};
  const fetchUnscoped = async (rx) => {
    try {
      return await queryWarmSearch(rx, {
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
      const s = await getSweetSearch();
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
  const { result, usedRegex, notes, repaired } = fetched;
  const total = result.stats?.totalMatches ?? result.results.length;
  const fileSummary = result.fileSummary
    || { files: [], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
  // B7: >= GREP_COUNTS_THRESHOLD hits print a short line list per file, not the hit-line flood.
  // Source files come first, but a quota of test files stays among the first k files.
  const listMode = FIX.grepOrder && total >= GREP_COUNTS_THRESHOLD && !withContext;
  const keptMatches = FIX.grepOrder && !FIX.grepAlloc ? orderSourceBeforeTests(result.results, { k }) : result.results;
  // SS_FIX_GREP_FULLLINE (default ON; 0 = the matched substring, byte for byte): each hit prints
  // its full source line, as `grep -n` does.
  const bodyOpts = FIX.grepAlloc
    ? {
      alloc: 'weight',
      ...(FIX.grepOrder ? { dropRepeatedText: true } : {}),
      ...(FIX.grepWeight ? { weight: FIX.grepWeight } : {}),
      ...(FIX.grepAllocRule ? { rule: FIX.grepAllocRule } : {}),
      ...(FIX.grepLines ? { lineClasses: true } : {}),
      ...(FIX.grepFullLine ? { fullLine: true } : {}),
      ...(grepBroadHitMax(FIX, total) ? { hitMax: grepBroadHitMax(FIX, total) } : {}),
    }
    : {
      ...(FIX.grepOrder ? { dropRepeatedText: true } : {}),
      ...(FIX.grepFullLine ? { fullLine: true } : {}),
      ...(grepBroadHitMax(FIX, total) ? { hitMax: grepBroadHitMax(FIX, total) } : {}),
    };
  const body = renderGrepBody(keptMatches, fileSummary, k, bodyOpts);
  const completed = listMode
    ? { lines: [], familyManifest: result.familyManifest?.rendered ? result.familyManifest : null }
    : reallocateGrepTailForManifest(body.lines, result.familyManifest);
  if (!repaired) {
    await recordAgentToolCall({
      query: fixedString ? undefined : regex,
      regex: fixedString ? undefined : regex,
    });
  }

  // Sibling-surface signal (E6, 2026-07-08 trace audit): when a symbol/stem
  // matches in more than one file, say so unconditionally in the header —
  // the file count is the objective "visible siblings" trigger for
  // fix-surface mapping, and it must not depend on truncation having occurred.
  const across = body.matchedFileCount > 1 ? ` across ${body.matchedFileCount} files` : '';
  // Applied globs are echoed, as --in scopes are (in the form they were applied).
  process.stdout.write(`# ss-grep: ${total} total match(es) for /${usedRegex}/${across}${globs.length ? ` (${globEcho(globs).trim()})` : ''}\n`);
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
    if (completed.familyManifest) process.stdout.write(`${completed.familyManifest.rendered}\n`);
    if (result.siblingLine?.rendered) process.stdout.write(`${result.siblingLine.rendered}\n`);
    writeRegexDialectHintAfterRepair(result.stats, repaired);
    process.exit(0);
  }
  if (body.truncatedFileCount > 0 || body.hiddenLine) {
    process.stdout.write(`# (+N more in this file)=truncated — ` +
      `see the rest: ss-grep "<regex>" --in <file>\n`);
  }
  if (withContext) {
    // The same hits the plain body keeps (completed.lines[i] prints body.rows[i]).
    const shown = body.rows.slice(0, completed.lines.length).map((r) => ({
      file: r.file, line: r.line, text: r.text,
      suffix: r.more ? ` (+${r.more} more in this file)` : '',
    }));
    for (const line of renderGrepContext(shown, {
      ...context, getLines: grepContextLineReader(), matchLines: grepMatchLines(result.results),
    })) process.stdout.write(line + '\n');
  } else {
    for (const line of completed.lines) process.stdout.write(line + '\n');
  }
  if (completed.familyManifest) process.stdout.write(`${completed.familyManifest.rendered}\n`);
  // Singleton hit: the same-file identifier family, with code lines (L1a).
  if (result.siblingLine?.rendered) process.stdout.write(`${result.siblingLine.rendered}\n`);
  if (body.hiddenLine) process.stdout.write(body.hiddenLine + '\n');
  if (body.shownMatches === 0) {
    process.stdout.write(`${globExcludedNote(result.stats, globs) || (repaired ? REPAIRED_NO_MATCH : '(no matches)')}\n`);
  }
  writeRegexDialectHintAfterRepair(result.stats, repaired);
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
  const globs = readGlobFlags(args, FIND_USAGE);
  const globOpts = globs.length ? { pathGlobs: globs } : {};
  stripInertFlags(args);
  absorbPositionalPaths(args, inPaths);
  resolveScopePaths(inPaths);
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
    response = await queryWarmSearch(query, {
      mode: 'pattern', regex: effectiveRegex || `\\b\\w+\\b`, topK: k, format,
      _isAgentFormat: !fixedString,
      _siblingLine: process.env.SS_SIBLING_LINE !== '0', // default ON; cost bounded (≤0.6% prompt tokens), see SMOKE-LOSS-FORENSICS §9
      ...(findFileFilter ? { fileFilter: findFileFilter } : {}),
      ...globOpts,
      ...(envFindBudget ? { tokenBudget: envFindBudget } : {}),
      ...(FIX.searchFirstUnit ? { firstUnit: FIX.searchFirstUnit } : {}),
    });
  } catch {
    const s = await getSweetSearch();
    if (!s.hasLateInteractionIndex) {
      process.stderr.write(`[ss-find] no late-interaction index — falling back to ss-grep\n`);
      return cmdGrep([effectiveRegex || query, '-k', String(k), ...inPaths.flatMap(p => ['--in', p]),
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
      ...(FIX.searchFirstUnit ? { firstUnit: FIX.searchFirstUnit } : {}),
    });
  }
  // Output-fix switches: plan the printed entries first (dedupe / caps), so both ledgers learn
  // only what this call prints. With every switch off `plan` is null and this is the original.
  const renderFix = resultRenderFixActive(FIX, { find: true, alreadyShownActive: ALREADY_SHOWN_ON });
  const plan = renderFix ? planFixedResults(response.results || [], { k, find: true }) : null;
  const shownSpans = SPAN_POLICY_ENABLED
    ? collectAgentShownSpans(resultsForOriginalLedger(response.results, plan), { projectRoot: FILE_ROOT }) : [];
  await recordAgentToolCall({
    spans: shownSpans,
    query: fixedString ? undefined : query,
    regex: fixedString ? undefined : effectiveRegex,
  });
  const alreadyShown = await alreadyShownFor(response.results || [], plan);

  // Header (visible to agent). SS_FIX_A (A1): one short header (results, query, regex) and
  // the compact `# sufficient=YES` line; no budget/used/subMode, no confidence line.
  if (FIX.compact) {
    process.stdout.write(renderCompactHeader('ss-find', plan ? plan.entries.length : (response.results?.length || 0), query, { regex: effectiveRegex || '*' }));
    process.stdout.write(compactSufficiencyLine(response));
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
    const missing = missingScopes(inPaths);
    if (missing.length) exitScopeNotFound(missing);
  }

  // -g globs that removed every candidate: say so, not a bare "(no matches)".
  const findGlobNote = response.results?.length ? null : globExcludedNote(response.stats, globs);
  if (findGlobNote) {
    process.stdout.write(`${findGlobNote}\n`);
  } else if (renderFix) {
    process.stdout.write(renderFixedBlocks(response.results || [], plan, {
      compact: FIX.compact, omitted: alreadyShown, dropRestatingSummary: false, gutter,
    }));
  } else {
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
  const shownTrailer = (SHOWN_SPAN_TRAILER && !FIX.compact) ? renderShownFullTrailer(shownSpans) : '';
  if (shownTrailer) process.stdout.write(`\n${shownTrailer}\n`);
  process.exit(0);
}

// ss-read takes one recovery flag plus positional <file> [start] [end] (or a single
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
  'Option: --force shows content again after an unchanged-content omission.';
async function cmdRead(rawArgs) {
  const args = [...rawArgs];
  const force = parseBoolFlag(args, ['--force']);
  // `-k N` has no meaning for a read (lines are positional): accepted, ignored.
  takeCountFlag(args, READ_USAGE);
  // --in <file> names the file, as it does for ss-grep / ss-trace: `ss-read --in <file> 10 20`.
  const inFile = readValueFlag(args, ['--in', '--file'], null, READ_USAGE);
  if (inFile != null) args.unshift(inFile);
  const file = cwdPath(args[0]);
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
        // Agents habitually pass (start, COUNT) offset/limit-style; a small second
        // arg below start is unambiguous (a real end would be ≥ start), so honor
        // the intent instead of burning one of the agent's turns on an error
        // (raml rep1 lost 6 calls to this under a 44-turn cap — TURNFIX §14.3).
        if (Number.isFinite(end) && end >= 1 && end < start) {
          const count = end;
          end = start + count - 1;
          process.stderr.write(`[ss-read] note: interpreted "${args[1]} ${args[2]}" as start+count → lines ${start}-${end} (usage: ss-read <file> <start> <end>)\n`);
        } else if (!Number.isFinite(end) || end < start) {
          process.stderr.write(`[ss-read] invalid end line: "${args[2]}" (expected END line ≥ start ${start}; usage: ss-read <file> <start> <end>, e.g. ss-read src/a.js 40 90)\n`);
          process.exit(2);
        }
      } else {
        end = start;     // single-line read
      }
    }
  }
  // L4a (2026-07-09) — default read window. An unbounded whole-file read (no range
  // given) delivers the ENTIRE file, which then sits RESIDENT in the agent's context
  // and is re-sent every subsequent turn. P1 measured this read-mass resident tax at
  // ~$11/200 (whole-file/large reads are the tail: p90=180, max=900 lines). So when
  // the agent gives NO range, cap the default to READ_WINDOW lines and let the
  // existing "what remains" trailer advertise the exact continue command — the agent
  // widens on demand instead of paying for the whole file up front. Only the no-range
  // case is capped: an EXPLICIT range is the agent's deliberate choice and capping it
  // would cause widen-thrash (the RETUNE hazard). GCSN-neutral by construction (reads
  // are never ranked). Gated for the standing ON-vs-OFF A/B: SS_NO_READ_WINDOW=1 → OFF
  // (legacy whole-file); SS_READ_WINDOW=<n> retunes the tier. Prod/human ss-read is a
  // separate wrapper and is untouched (byte-identical).
  // PARKED default-OFF (2026-07-09 smoke): the mechanism works (−39% delivered read
  // tokens vs off) and is accuracy-safe (no resolved→unresolved flips), but the ~$11/200
  // pool is too small to show a net idealCost win at n=2 and one read-thrash instance
  // appeared at window=150. Opt-in via SS_READ_WINDOW=<n> pending a larger-n confirmation.
  const READ_WINDOW = Number(process.env.SS_READ_WINDOW) || 0;
  const cappedDefault = (start === null && end === null && READ_WINDOW > 0);
  if (cappedDefault) { start = 1; end = READ_WINDOW; }

  // A file the INDEXER refused by content is refused here too, BEFORE any body is read.
  // `ss-read dist/index.js` used to hand back 13,396 tokens of minified JavaScript in one
  // call — resident for the rest of the rollout and re-sent every turn. The refusal names
  // the native read, so the agent that genuinely wants the bytes can still get them; it
  // just does not get them by accident from a search tool.
  //
  // ONLY 'excluded' refuses. A file this index has not seen yet ('stale') is ordinary
  // source — often the agent's own new file — and reading it is exactly right.
  {
    const note = await notIndexedNote(file);
    if (note && note.kind === 'excluded' && !note.isDir) {
      process.stderr.write(`[ss-read] ${note.text}\n`);
      process.stderr.write(`[ss-read] ss-read will not return its contents. If you truly need the bytes, read ${file} with your own file-reading tool.\n`);
      process.exit(1);
    }
  }

  const { readFile, renderUnreadBelow, renderUnreadAbove, numberCodeLines } = await import(path.join(REPO_ROOT, 'core/search/search-read.js'));
  // Agent-facing ss-read: span gate on, same as the CLI and the daemon route.
  const r = await readFile({
    path: file, projectRoot: FILE_ROOT,
    startLine: start ?? undefined, endLine: end ?? undefined,
    spanExpand: true, format: 'agent',
  });
  if (!r.ok) {
    process.stderr.write(`[ss-read] error: ${r.error}\n`);
    // A wrong or invented path is the common cause (e.g. src/b2/build/x for
    // src/build/x). Point back at the index instead of a bare ENOENT: an
    // excluded path says so, otherwise suggest locating it by name/behaviour.
    if (/ENOENT|not a regular file|no such file/i.test(String(r.error))) {
      const note = await notIndexedNote(file);
      if (note) {
        process.stderr.write(`[ss-read] ${note.text}\n`);
      } else {
        const base = path.basename(String(file));
        process.stderr.write(`[ss-read] path not found — locate it first: ss-grep "${base}"  (exact name) or ss-search "<what it does>" (behaviour), then ss-read the path it returns.\n`);
      }
    }
    process.exit(1);
  }
  const readBatch = { files: [r], totalMs: r.timings?.totalMs ?? 0 };
  const shownSpans = EXACT_REREAD_OMISSION
    ? collectReadShownSpans(readBatch, { projectRoot: FILE_ROOT }) : [];
  const receiptResponse = await recordAgentToolCall({
    operation: 'read',
    spans: shownSpans,
    force,
  });
  if (receiptResponse?.ok && Array.isArray(receiptResponse.decisions)) {
    applyReadOmissionDecisions(readBatch, receiptResponse.decisions);
  }
  // SS_FIX_ALREADY_SHOWN (A3): ss-read prints exactly what it always printed. It only RECORDS
  // the lines it printed in the separate A3 ledger namespace (never in the original one, whose
  // reply above is the only input to this output), so a later ss-search / ss-find can tell
  // they were already shown. The reply is ignored.
  await recordForAlreadyShown(shownSpans, receiptResponse?.decisions,
    readBatch.files.reduce((n, f) => n + (typeof f.text === 'string' ? f.text.length : 0), 0));
  // If the window happened to cover the whole file (file ≤ READ_WINDOW, clamped by
  // readFile), present it EXACTLY like an uncapped whole-file read — no synthetic
  // range, no continue trailer — so small-file reads stay byte-identical to legacy.
  const coveredWholeFile = (start === null && end === null) || (cappedDefault && r.range && r.range.endLine >= r.totalLines);
  const range = (r.range && !coveredWholeFile) ? ` (lines ${r.range.startLine}-${r.range.endLine} of ${r.totalLines})` : ` (${r.totalLines} lines)`;
  const fence = r.language ? '```' + r.language : '```';
  // "What remains" trailer: on a range read that stops before EOF, one final
  // line names the symbols in the unread remainder + the exact continue
  // command (last line for recency — the actionable form of truncation).
  const remainder = coveredWholeFile ? '' : renderUnreadBelow(r, {
    command: 'ss-read',
    queryEvidence: receiptResponse?.queryEvidence,
  });
  // Mirror for the span ABOVE the window, printed BEFORE the fence: the
  // below-trailer keeps the last line (recency), this one sits with the header
  // (squashql-295: the field the fix needed was declared above a 170-235 read).
  const aboveLine = coveredWholeFile ? '' : renderUnreadAbove(r, {
    command: 'ss-read',
    queryEvidence: receiptResponse?.queryEvidence,
  });
  const omitted = renderReadOmission(r, { surface: 'ss-read' });
  // Optional line-number gutter (SS_READ_LINENUMS=0 disables), skipped under 15
  // lines. Native Claude Code Read numbers every line; this closes that
  // grounding asymmetry for the sweet arm so exact-span edits are easier.
  //
  // Rendering goes through the SHARED numberCodeLines. It used to be an inlined
  // copy of the same arithmetic, which meant the CLI and the daemon/library
  // renderers could drift apart silently — and a delimiter that differs between
  // the two paths is exactly the class of defect that corrupts edit anchors.
  //
  // The gate is the SHARED lineGutterEnabled(), which also carries the
  // per-harness form (codex renders no gutter at all — gutter-form.js).
  let bodyText = r.text;
  if (lineGutterEnabled() && r.text && r.text.split('\n').length >= 15) {
    const startAt = (r.range && !coveredWholeFile) ? r.range.startLine : 1;
    bodyText = numberCodeLines(r.text, startAt);
  }
  if (omitted) process.stdout.write(`# ss-read ${r.file}${range}\n${omitted}\n`);
  else process.stdout.write(`# ss-read ${r.file}${range}\n${aboveLine ? aboveLine + '\n' : ''}${fence}\n${bodyText}\n\`\`\`${remainder ? '\n' + remainder : ''}\n`);
  process.exit(0);
}

const SEARCH_USAGE = 'Usage: ss-search "<query>" [--full|--xl] [-k N] [--mode auto|lexical|semantic|hybrid]';
// SS_FIX_A keeps a compact sufficiency token, printed ONLY when the verdict is YES (the sweet rules
// tell the agent to trust the top result on `sufficient=YES`). Owner decision 2026-10-01: dropping it
// is a behaviour change → separate B-switch SS_FIX_DROP_SUFFICIENCY=1 (A/B "keep vs drop").
// Like the original, it is printed only together with a confidence verdict. SS_FIX_DROP_SUFFICIENCY
// only acts under SS_FIX_A (without SS_FIX_A the original confidence line prints unchanged).
function compactSufficiencyLine(response) {
  return renderCompactSufficiency(response, renderSufficiency(response), { drop: FIX.dropSufficiency });
}

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

  // The budget counts from the start of the agent's command (the native client may already
  // have waited for the socket, and the daemon route for the indexes).
  const waitStart = callStartedMs(process.env);
  const warm = await ensureWarmServerReady({ startedMs: waitStart });
  if (warm !== 'ready') {
    process.stderr.write(searchNotReadyLine(Math.round((Date.now() - waitStart) / 1000), warm === 'failed'));
    process.exit(1);
  }

  // Budget-sweep experiment hook: per-request explicit budget (overrides the
  // auto-tier on the warm server; flows as the `budget` URL param).
  const envSearchBudget = Number(process.env.SS_SMOKE_SEARCH_BUDGET || '') || null;
  const { queryServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
  const response = await queryServer(query, {
    topK: k, mode, format, projectRoot: PROJECT_ROOT, trackAgentSpans: false,
    ...(envSearchBudget ? { tokenBudget: envSearchBudget } : {}),
    ...(FIX.searchFirstUnit ? { firstUnit: FIX.searchFirstUnit } : {}),
  });
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
  // Output-fix switches: plan the printed entries first (dedupe / one-per-file / caps), so both
  // ledgers learn only what this call prints. With every switch off `plan` is null and this is
  // the original.
  const renderFix = resultRenderFixActive(FIX, { alreadyShownActive: ALREADY_SHOWN_ON });
  const plan = renderFix ? planFixedResults(response.results || [], { k, find: false }) : null;
  const shownSpans = SPAN_POLICY_ENABLED
    ? collectAgentShownSpans(resultsForOriginalLedger(response.results, plan), { projectRoot: FILE_ROOT }) : [];
  await recordAgentToolCall({ spans: shownSpans, query });
  const alreadyShown = await alreadyShownFor(response.results || [], plan);

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
  // SS_FIX_A (A1): one short header (results, query) instead of the route/budget header, the
  // compact `# sufficient=YES` line instead of the confidence line; the route trailer goes to
  // stderr (below).
  const conf = routeConfidence != null ? ` conf=${routeConfidence.toFixed(2)}` : '';
  if (FIX.compact) {
    // The count is what the agent sees: A2 can drop covered summary entries after the
    // packager ran out of refill candidates, and the header must not promise more.
    process.stdout.write(renderCompactHeader('ss-search', plan ? plan.entries.length : response.results.length, query));
  } else {
    process.stdout.write(`# ss-search: routed=${routedMode}${conf} budget=${response.tokenBudget} used=${response.tokensUsed}` +
      ` results=${response.results.length} subMode=${response.subMode}\n`);
  }
  // final-tuning: proves a bench run executes this tree's helpers (off = byte-identical).
  if (process.env.SS_VARIANT_SENTINEL === '1') process.stdout.write('# variant-sentinel: final-tuning worktree\n');
  if (FIX.compact) process.stdout.write(compactSufficiencyLine(response));
  if (!FIX.compact && response.confidence) {
    process.stdout.write(`# confidence=${response.confidence}${response.confidenceReason ? ' (' + response.confidenceReason + ')' : ''}` +
      `${renderSufficiency(response)}\n`);
  }

  // final-tuning variant SS_VARIANT_SEARCH_DEDUPE=1 (default off = byte-identical): print no
  // repeated information. A summary entry whose span lies inside a span already listed above, or
  // that names the same file + symbol as an entry above, is dropped; a summary line that only
  // restates its own header (`file:line — symbol (kind)`) is not printed.
  const seenSpans = [];
  // Per-result blocks
  if (renderFix) {
    process.stdout.write(renderFixedBlocks(response.results || [], plan, {
      compact: FIX.compact, omitted: alreadyShown, dropRestatingSummary: DEDUPE, gutter,
    }));
  } else
  for (const r of response.results || []) {
    if (DEDUPE) {
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
    } else if (r.summary && !(DEDUPE && /^\S+:\d+ — .+ \([^)]*\)$/.test(String(r.summary).trim()))) {
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
  const shownTrailer = (SHOWN_SPAN_TRAILER && !FIX.compact) ? renderShownFullTrailer(shownSpans) : '';
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
  if (FIX.compact) process.stderr.write(`${routeLine}\n`);
  else process.stdout.write(`\n${routeLine}\n`);
  process.exit(0);
}

const SEMANTIC_USAGE = 'Usage: ss-semantic <file> "<question>" [-k N] [--max-tokens N]';
async function cmdSemantic(rawArgs) {
  const args = normalizeArgs(rawArgs);
  // Default 600 (was 800) per the 2026-06 budget sweep — scaled with the 3k
  // preview tier. Env hook overrides the default for sweeps; an explicit
  // --max-tokens flag from the agent always wins.
  const maxTokens = readPositiveIntFlag(args, '--max-tokens',
    Number(process.env.SS_SMOKE_SEMANTIC_MAXTOKENS || '') || 600, SEMANTIC_USAGE);
  // -k N: the number of top-ranked chunks the spans are built from (readSemantic topK, the
  // product CLI's `read-semantic -k`); the --max-tokens budget still caps the output.
  const topK = takeCountFlag(args, SEMANTIC_USAGE);
  // --in <file> names the file, as it does for ss-grep / ss-trace: `ss-semantic "<question>"
  // --in <file>`. The positional form stays `<file> "<question>"`.
  const inFile = readValueFlag(args, ['--in', '--file'], null, SEMANTIC_USAGE);
  rejectUnknownOptions(args, SEMANTIC_USAGE);
  if (inFile && args.length > 1) failUsage('give the file once: <file> "<question>" or "<question>" --in <file>', SEMANTIC_USAGE);
  let file = cwdPath(inFile ?? args[0]);
  const query = inFile ? args[0] : args[1];
  if (!file || !query) {
    process.stderr.write(SEMANTIC_USAGE + '\n');
    process.exit(2);
  }
  // Same refusal as ss-read, and for a sharper reason: on an excluded file `readSemantic`
  // has no chunks to rank, so it falls back to a WHOLE-FILE span. Five of the seven
  // [FALLBACK] calls on the fresh pool were `dist/index.js` lines 1-35000 — the tool
  // answering a semantic question with 35,000 lines of bundle.
  // A symlinked path has no chunks either (the indexer does not follow symlinks): answer
  // from its real path when that is inside the project, else refuse (semanticTargetFor).
  {
    const note = await notIndexedNote(file);
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
      process.stdout.write(`(ss-semantic: ${file} is a symlink; answering from its real path ${target.file})\n`);
      file = target.file;
    }
  }

  // SS_FIX_SEMANTIC_RANGES (default ON since 2026-10-03; 0 = legacy) / SS_FIX_SEMANTIC_PICK (default
  // off; semantic-span-budget.js): a span
  // cut by the budget prints exactly the lines its header names, and what it left out is named
  // with an ss-read command.
  const rangeOpts = {
    ...(FIX.semanticRanges ? { exactRanges: true } : {}),
    ...(FIX.semanticPick ? { pickExcerpt: true } : {}),
  };
  let r;
  try {
    if (await ensureWarmServerReady({ timeoutMs: 5000 }) !== 'ready') throw new Error('warm server is not ready');
    const { queryReadSemanticServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
    r = await queryReadSemanticServer({
      path: file, query, projectRoot: FILE_ROOT, maxChars: maxTokens * 4, ...(topK ? { topK } : {}), ...rangeOpts,
    });
    if (r?.error) throw new Error(r.error);
  } catch {
    const { readSemantic } = await import(path.join(REPO_ROOT, 'core/search/search-read-semantic.js'));
    r = await readSemantic({
      path: file, query, projectRoot: FILE_ROOT,
      maxChars: maxTokens * 4, verbose: false, ...(topK ? { topK } : {}), ...rangeOpts,
    });
  }
  if (!r.ok) {
    process.stderr.write(`[ss-semantic] error: ${r.reason || 'unknown'}\n`);
    process.exit(1);
  }
  const shownSpans = SPAN_POLICY_ENABLED
    ? collectSemanticShownSpans(r, { projectRoot: FILE_ROOT }) : [];
  await recordAgentToolCall({ spans: shownSpans, query });
  // SS_FIX_ALREADY_SHOWN (A3): record the printed spans in the A3 namespace only (reply ignored).
  await recordForAlreadyShown(shownSpans, null,
    (r.spans || []).reduce((n, sp) => n + (typeof sp?.text === 'string' ? sp.text.length : 0), 0));
  process.stdout.write(`# ss-semantic ${r.file} | "${query}" | spans=${r.spans?.length ?? 0} | ~tokens=${r.approxTokensReturned}${r.fellBack ? ' [FALLBACK]' : ''}\n`);
  for (const span of r.spans || []) {
    const fence = r.language ? '```' + r.language : '```';
    const sym = formatSpanSymbols(span);
    const omitted = FIX.semanticRanges ? omittedRangeLines(r.file, span) : null;
    for (const line of omitted?.before || []) process.stdout.write(`${line}\n`);
    process.stdout.write(`### ${r.file}:${span.startLine}-${span.endLine}${sym}\n${fence}\n${gutter(span.text, span.startLine)}\n\`\`\`\n`);
    for (const line of omitted?.after || []) process.stdout.write(`${line}\n`);
  }
  // The next-best ranked places the budget left out. Pointers only: they are not shown spans,
  // so they stay out of the ledger above and out of the shown-full trailer below.
  const alsoLine = formatAlsoLine(r.alsoCandidates);
  if (alsoLine) process.stdout.write(`${alsoLine}\n`);
  const shownTrailer = SHOWN_SPAN_TRAILER ? renderShownFullTrailer(shownSpans) : '';
  if (shownTrailer) process.stdout.write(`${shownTrailer}\n`);
  process.exit(0);
}

// The usage text names each mode word on its own line. A bracketed `[callers|callees|impact]`
// form was copied by agents into commands (zsh `no matches found: [callees]`), and an
// unbracketed `callers|callees|impact` would run as a shell pipe.
const TRACE_USAGE =
  'Usage: ss-trace <symbol> [--in <file>] [--query <hint>] [--depth N] [--budget N]\n' +
  '       ss-trace <symbol> callers --in <defining file>\n' +
  '       ss-trace <symbol> callees\n' +
  '       ss-trace <symbol> impact\n' +
  'Mode word (optional, after the symbol): callers, callees or impact.';
async function cmdTrace(rawArgs) {
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

  const opts = { projectRoot: PROJECT_ROOT };
  const file = cwdPath(readValueFlag(args, ['--in', '--file'], null, TRACE_USAGE));
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
  if (FIX.traceModeBudget && mode) opts.modeSection = mode;
  if (depth != null) opts.maxDepth = depth;
  // Budget-sweep experiment hook: env sets the default; explicit --budget wins.
  if (budget != null) opts.tokenBudget = budget;
  else if (Number(process.env.SS_SMOKE_TRACE_BUDGET || '') > 0) opts.tokenBudget = Number(process.env.SS_SMOKE_TRACE_BUDGET);

  let response = traceSymbol(symbol, opts);
  const traceNotes = [];
  if (FIX.traceCompact) {
    // SS_FIX_TRACE_COMPACT (A4; part of SS_FIX_A): a wrong --in file falls back to the
    // repo-wide definition; an ambiguous name prefers the non-test definition over a test mock.
    if (!response.target && opts.filePath) {
      const wide = traceSymbol(symbol, { ...opts, filePath: undefined });
      if (wide.target) {
        response = wide;
        traceNotes.push(`note: no definition of ${symbol} in ${file}; showing the repo-wide definition ${wide.target.filePath}:${wide.target.startLine}.`);
      }
    }
    if (response.target && !(file && isTestLikePath(file)) && isTestLikePath(response.target.filePath)) {
      const alt = (response.disambiguation || []).find((a) => a.file && !isTestLikePath(a.file));
      if (alt) {
        const better = traceSymbol(symbol, { ...opts, filePath: alt.file });
        if (better.target && !isTestLikePath(better.target.filePath)) {
          // The re-run trace has no alternatives of its own: keep naming the test definition.
          better.disambiguation = alternativesAfterSwitch(response, better.target.filePath, better.target.startLine);
          response = better;
          traceNotes.push('note: the first match was a test definition; showing the non-test definition.');
        }
      }
    }
  }
  await recordAgentToolCall({
    query: json ? undefined : `${symbol} ${queryHint}`.trim(),
  });
  if (json) process.stdout.write(JSON.stringify({ ...response, mode }, null, 2) + '\n');
  else if (FIX.traceCompact) process.stdout.write(formatTraceCompact(response, { mode, notes: traceNotes }) + '\n');
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
  if (FIX.traceCompact) { if (response.target) process.stderr.write(`<<SS_TRACE_META>>${JSON.stringify(meta)}\n`); }
  else process.stdout.write(`\n<<SS_TRACE_META>>${JSON.stringify(meta)}\n`);
  process.exit(response.target ? 0 : 1);
}

if (subcommand === 'grep') await cmdGrep(rest);
else if (subcommand === 'find') await cmdFind(rest);
else if (subcommand === 'read') await cmdRead(rest);
else if (subcommand === 'semantic') await cmdSemantic(rest);
else if (subcommand === 'trace') await cmdTrace(rest);
else if (subcommand === 'agent-search') await cmdAgentSearch(rest);
else { process.stderr.write(`unknown subcommand: ${subcommand}\n`); process.exit(2); }
} // runAgentTool

// Mark unused for lint:
void readFileSync;

// Run directly (`node _ss-helpers.mjs <subcommand> …`): the bench's direct callers and
// tests. Prints stdout AND stderr whatever the exit code — a script reads the route and
// trace meta lines from stderr. The agent-facing entry is core/agent-tools/cli.js.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // Resident-daemon cap for bench fan-outs. Daemon sockets are keyed per project
  // root, so a multi-repo replay never reuses one: search-read-replay --execute-current
  // checks out a different golden repo per task, so every task takes the `action='spawned'`
  // branch and leaves behind a ~1.2GB daemon plus a ~2.7GB maintainer. The cap used to
  // ship OFF (SWEET_SEARCH_MAX_DAEMONS=0) with only a 20-minute idle-TTL, which at the
  // observed ~1 daemon / 4.5s reaches ~265 resident daemons on a 200-task replay — it
  // OOM-killed a 224GB box twice. The cap now ships ON at a RAM-tier default (2 on
  // <=12 GiB, 3 on <=24 GiB, 6 above), so a bench box would settle at 6 rather than 265;
  // this pin keeps the replay at the tighter, measured 3 regardless of host RAM. An
  // explicit caller env still wins over both.
  //
  // LATENCY: this must never cost a cold start. The cap evicts by LRU only when the count
  // is exceeded, and a replay walks repos strictly in sequence — the evicted daemon serves
  // a task that is already finished and is never queried again. The idle-TTL is left at the
  // production default ON PURPOSE: shortening it can reap a daemon that a slow task is still
  // between calls on, which would force a ~2.5s cold start instead of the ~80ms warm path.
  // Bound the count, never the lifetime.
  //
  // The cap gates registry participation at daemon STARTUP (search-server.js `capEnabled`),
  // so a daemon spawned with the cap explicitly OFF ('' or '0') never registers and is
  // invisible to LRU eviction. Kill stray daemons before a run rather than mixing opted-out
  // ones with capped ones.
  process.env.SWEET_SEARCH_MAX_DAEMONS ??= '3';

  // SCORE DETERMINISM — this pin exists for accuracy, not for speed, and it must
  // not be removed without replacing it.
  //
  // `bestIntraOpThreads` (core/infrastructure/onnx-session-utils.js) divides the
  // intra-op thread count by the number of resident daemons, so a daemon started
  // with 1 peer and a daemon started with 3 peers build DIFFERENT ORT thread
  // pools. ORT partitions its GEMM and reduction kernels by thread count and
  // floating-point addition is not associative, so the two are not guaranteed to
  // produce bit-identical logits — and a replay walks a new repository every
  // ~4.5 s, so the live peer count varies across a single 200-task run depending
  // on eviction timing. Two runs of the same benchmark on the same commit could
  // therefore encode two different thread configurations and disagree at ties: a
  // silent, machine-state-dependent MRR wobble in the harness whose whole job is
  // to detect MRR changes.
  //
  // `SWEET_SEARCH_INTRA_OP_THREADS` wins outright and bypasses the share (see the
  // early return in bestIntraOpThreads), so every replay daemon builds the same
  // session regardless of how many peers happen to be resident. 8 is inside the
  // unshared band on every bench box we use, so it does not slow the run down to
  // the shared value either.
  process.env.SWEET_SEARCH_INTRA_OP_THREADS ??= '8';

  // The maintainers, not the daemons, are the bigger half of the footprint (~2.7GB each
  // and ratcheting, vs ~1.2GB for a daemon). maintainerIdleTtlMs() auto-tunes off the
  // memory tier. It used to return 0 = NEVER self-exit on a roomy host; it now returns
  // 30 minutes on every tier, which is still far too slack for a bench fan-out that walks
  // a new repo every ~4.5s. An explicit env value always wins over the tier default, so
  // pin the much tighter 2 minutes here.
  //
  // LATENCY: free. The maintainer has NO query route (index-maintainer.mjs) — it only does
  // background reconcile — so idling it out can never slow a search, and it respawns
  // on demand. Idle is counted as consecutive ticks that found nothing to do, so the repo
  // being actively searched keeps its maintainer; only finished repos are reclaimed.
  process.env.SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS ??= '120000';

  const { runAgentToolInProcess } = await import('../../../core/agent-tools/cli.js');
  await runAgentToolInProcess(process.argv[2], process.argv.slice(3), { stderr: 'always', runTool: runAgentTool });
}
