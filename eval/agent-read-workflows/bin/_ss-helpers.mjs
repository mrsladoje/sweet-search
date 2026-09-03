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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseBoolFlag, parseValueFlag, parsePositiveIntFlag,
  parseRepeatedValueFlag, extraPositionals,
  buildGrepPattern, stripInertFlags, normalizeArgs, extractPositional,
  parseLineRange, looksLikeOption, renderSufficiency, absorbPositionalPaths as absorbPositionalPathsPure,
} from './_ss-argparse.mjs';
import {
  reallocateGrepTailForManifest,
  renderGrepBody,
} from '../../../core/search/grep-output-shaping.js';
import { formatRouteMetadata } from '../../../core/search/search-format.js';
import { createAdmissionPolicy } from '../../../core/indexing/admission-policy.js';
import { createIndexCoverage } from '../../../core/search/index-coverage.js';
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
import { sendAgentSpanOperation } from '../../../core/search/agent-span-client.js';

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
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

const AGENT_SESSION_ID = resolveAgentSessionId();
const EXACT_REREAD_OMISSION = exactRereadOmissionEnabled();
const SHOWN_SPAN_TRAILER = shownSpanTrailerEnabled();
const SPAN_POLICY_ENABLED = EXACT_REREAD_OMISSION || SHOWN_SPAN_TRAILER;

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

// Grep muscle memory writes `ss-grep "pat" src/foo` with the scope as a bare
// positional instead of `--in src/foo`. Absorb any such trailing positional that
// resolves to a real path under the project (pure logic lives in _ss-argparse so
// it is unit-tested; the path predicate is injected here).
function absorbPositionalPaths(args, inPaths) {
  absorbPositionalPathsPure(args, inPaths,
    (tok) => existsSync(path.isAbsolute(tok) ? tok : path.resolve(FILE_ROOT, tok)));
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

/** The `--in` scopes that do not exist on disk at all. */
function missingScopes(scopePaths) {
  return (scopePaths || []).filter((p) => {
    if (!p) return false;
    try { return !existsSync(path.isAbsolute(p) ? p : path.resolve(FILE_ROOT, p)); }
    catch { return false; }
  });
}

async function getSweetSearch() {
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

async function queryWarmSearch(query, options) {
  if (!await ensureWarmServerReady({ timeoutMs: 5000 })) {
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

// --- subcommands ----------------------------------------------------------

const GREP_USAGE = 'Usage: ss-grep <regex> [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [--in <path>]... [-k N]';
async function cmdGrep(rawArgs) {
  const args = normalizeArgs(rawArgs);
  const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
  const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
  const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
  const k = readPositiveIntFlag(args, ['-k', '--top'], 20, GREP_USAGE);
  // Drill-in scope: restrict matches to the named files or directories (the
  // recovery affordance the diversified output advertises when it truncates a
  // flooded file). Repeatable — one path per flag, every one applied.
  const inPaths = readRepeatedValueFlag(args, '--in', GREP_USAGE);
  stripInertFlags(args);
  absorbPositionalPaths(args, inPaths);
  rejectExtraPositionals(args, GREP_USAGE);
  const regex = buildGrepPattern(resolvePositional(args, GREP_USAGE), { ignoreCase, wordBound, fixedString });
  if (!regex) {
    process.stderr.write(GREP_USAGE + '\n');
    process.exit(2);
  }
  if (inPaths.length > 0) {
    // Scoped: flat output, depth up to k across the named scopes.
    const fileFilter = inPaths.length === 1 ? inPaths[0] : inPaths;
    let result;
    try {
      result = await queryWarmSearch(regex, {
        mode: 'grep', regex, maxMatches: k, contextLines: 0,
        fileFilter, expand: false, rerank: false, useLateInteraction: false,
        _isAgentFormat: !fixedString,
      });
    } catch {
      const s = await getSweetSearch();
      result = await s.bareGrep(regex, null, {
        regex, maxMatches: k, contextLines: 0, fileFilter,
        _isAgentFormat: !fixedString,
      });
    }
    const total = result.stats?.totalMatches ?? result.results.length;
    await recordAgentToolCall({
      query: fixedString ? undefined : regex,
      regex: fixedString ? undefined : regex,
    });
    // Every applied scope is echoed. The header used to print one value however
    // many were supplied, which made the loss look like intended behaviour.
    const scopes = inPaths.map(p => `--in ${p}`).join(' ');
    process.stdout.write(`# ss-grep: ${total} total match(es) for /${regex}/ (scope: ${scopes})\n`);
    result.results.forEach((r, i) => {
      const text = (r.matchText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      const marker = (i === result.results.length - 1 && total > result.results.length)
        ? ` (+${total - result.results.length} more — raise -k)` : '';
      process.stdout.write(`${r.file}:${r.line}: ${text}${marker}\n`);
    });
    if (result.results.length === 0) {
      // A scope that does not exist on disk is the loudest case: 10 of 11 such calls in the
      // fresh pool printed a bare `(no matches)`, which says "your pattern is absent" about
      // a directory that was never searched. Usually a mistyped or invented path
      // (`src/b2/build/x` for `src/build/x`). Say so and name the repair.
      const missing = missingScopes(inPaths);
      if (missing.length) {
        process.stdout.write(`(scope not found: ${missing.join(', ')} — nothing was searched under `
          + `${missing.length > 1 ? 'those paths' : 'that path'}. This is NOT an absence of matches. `
          + `Locate the real path first: ss-grep "<name>" with no --in, then re-scope.)\n`);
        // Informative, not a crash: the pattern may still be fine. A distinct exit code lets
        // a wrapper or a script tell "scope wrong" from "searched and found nothing" (0).
        process.exit(3);
      }
      // Then a scope the index cannot answer for: an agent that scoped to a bundle needs to
      // know that before it decides the pattern is absent.
      let note = null;
      for (const p of inPaths) { note = await notIndexedNote(p); if (note) break; }
      process.stdout.write(`${note ? note.text : '(no matches)'}\n`);
    }
    writeRegexDialectHint(result.stats);
    process.exit(0);
  }

  // k-budget file diversity: fetch at most min(k,100) matches per file across
  // at most k files (a file can never show more than k lines, and more than k
  // files can never fit), then allocate the k body lines breadth-first so one
  // flooded file can never hide every other matching file (the gradethis-161
  // failure). Rendering stays grouped per file; truncation is marked inline
  // and drillable via --in.
  let result;
  try {
    result = await queryWarmSearch(regex, {
      mode: 'grep', regex, maxMatches: 0, contextLines: 0,
      perFileCap: Math.min(k, 100), maxFiles: k,
      expand: false, rerank: false, useLateInteraction: false,
      _isAgentFormat: !fixedString,
      _siblingLine: process.env.SS_SIBLING_LINE === '1', // opt-in: Gate 2 (2026-09-03) found it inert on solves
    });
  } catch {
    const s = await getSweetSearch();
    result = await s.bareGrep(regex, null, {
      regex, maxMatches: 0, contextLines: 0,
      perFileCap: Math.min(k, 100), maxFiles: k,
      _isAgentFormat: !fixedString,
      _siblingLine: process.env.SS_SIBLING_LINE === '1', // opt-in: Gate 2 (2026-09-03) found it inert on solves
    });
  }
  const total = result.stats?.totalMatches ?? result.results.length;
  const fileSummary = result.fileSummary
    || { files: [], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
  const body = renderGrepBody(result.results, fileSummary, k);
  const completed = reallocateGrepTailForManifest(body.lines, result.familyManifest);
  await recordAgentToolCall({
    query: fixedString ? undefined : regex,
    regex: fixedString ? undefined : regex,
  });

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
  for (const line of completed.lines) process.stdout.write(line + '\n');
  if (completed.familyManifest) process.stdout.write(`${completed.familyManifest.rendered}\n`);
  // Singleton hit: the same-file identifier family, with code lines (L1a).
  if (result.siblingLine?.rendered) process.stdout.write(`${result.siblingLine.rendered}\n`);
  if (body.hiddenLine) process.stdout.write(body.hiddenLine + '\n');
  if (body.shownMatches === 0) process.stdout.write('(no matches)\n');
  writeRegexDialectHint(result.stats);
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
  const FIND_USAGE = 'Usage: ss-find "<query>" --regex "<regex>" [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [--in <path>]... [--full|--xl] [-k N]';
  let format = 'agent';
  if (args.includes('--full')) { format = 'agent_full'; args.splice(args.indexOf('--full'), 1); }
  if (args.includes('--xl'))   { format = 'agent_full_xl'; args.splice(args.indexOf('--xl'), 1); }
  const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
  const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
  const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
  const k = readPositiveIntFlag(args, ['-k', '--top'], 6, FIND_USAGE);
  const regex = readValueFlag(args, '--regex', '', FIND_USAGE, { allowOptionValue: true });
  const inPaths = readRepeatedValueFlag(args, '--in', FIND_USAGE);
  stripInertFlags(args);
  absorbPositionalPaths(args, inPaths);
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
      _siblingLine: process.env.SS_SIBLING_LINE === '1', // opt-in: Gate 2 (2026-09-03) found it inert on solves
      ...(findFileFilter ? { fileFilter: findFileFilter } : {}),
      ...(envFindBudget ? { tokenBudget: envFindBudget } : {}),
    });
  } catch {
    const s = await getSweetSearch();
    if (!s.hasLateInteractionIndex) {
      process.stderr.write(`[ss-find] no late-interaction index — falling back to ss-grep\n`);
      return cmdGrep([effectiveRegex || query, '-k', String(k), ...inPaths.flatMap(p => ['--in', p])]);
    }
    response = await s.patternSearch(query, null, {
      regex: effectiveRegex || `\\b\\w+\\b`,
      k,
      format,
      _isAgentFormat: !fixedString,
      ...(findFileFilter ? { fileFilter: findFileFilter } : {}),
      ...(envFindBudget ? { tokenBudget: envFindBudget } : {}),
    });
  }
  const shownSpans = SPAN_POLICY_ENABLED
    ? collectAgentShownSpans(response.results, { projectRoot: FILE_ROOT }) : [];
  await recordAgentToolCall({
    spans: shownSpans,
    query: fixedString ? undefined : query,
    regex: fixedString ? undefined : effectiveRegex,
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
  writeRegexDialectHint(response.stats);
  const shownTrailer = SHOWN_SPAN_TRAILER ? renderShownFullTrailer(shownSpans) : '';
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

  const serverUsed = await ensureWarmServerReady();
  if (!serverUsed) {
    process.stderr.write('[ss-search] warm server is not ready; refusing cold direct search in benchmark wrapper\n');
    process.exit(1);
  }

  // Budget-sweep experiment hook: per-request explicit budget (overrides the
  // auto-tier on the warm server; flows as the `budget` URL param).
  const envSearchBudget = Number(process.env.SS_SMOKE_SEARCH_BUDGET || '') || null;
  const { queryServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
  const response = await queryServer(query, {
    topK: k, mode, format, projectRoot: PROJECT_ROOT, trackAgentSpans: false,
    ...(envSearchBudget ? { tokenBudget: envSearchBudget } : {}),
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
  const shownSpans = SPAN_POLICY_ENABLED
    ? collectAgentShownSpans(response.results, { projectRoot: FILE_ROOT }) : [];
  await recordAgentToolCall({ spans: shownSpans, query });

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
      process.stdout.write(`\`\`\`\n${gutter(r.code, r.startLine)}\n\`\`\`\n`);
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

  if (!response.results || response.results.length === 0) {
    process.stdout.write('(no matches)\n');
  }
  const shownTrailer = SHOWN_SPAN_TRAILER ? renderShownFullTrailer(shownSpans) : '';
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
  // Same refusal as ss-read, and for a sharper reason: on an excluded file `readSemantic`
  // has no chunks to rank, so it falls back to a WHOLE-FILE span. Five of the seven
  // [FALLBACK] calls on the fresh pool were `dist/index.js` lines 1-35000 — the tool
  // answering a semantic question with 35,000 lines of bundle.
  {
    const note = await notIndexedNote(file);
    if (note && note.kind === 'excluded' && !note.isDir) {
      process.stderr.write(`[ss-semantic] ${note.text}\n`);
      process.stderr.write(`[ss-semantic] There is nothing to rank inside it, so no span is returned. Ask this question of the source it was built from.\n`);
      process.exit(1);
    }
  }

  let r;
  try {
    if (!await ensureWarmServerReady({ timeoutMs: 5000 })) throw new Error('warm server is not ready');
    const { queryReadSemanticServer } = await import(path.join(REPO_ROOT, 'core/search/search-server.js'));
    r = await queryReadSemanticServer({
      path: file, query, projectRoot: FILE_ROOT, maxChars: maxTokens * 4,
    });
    if (r?.error) throw new Error(r.error);
  } catch {
    const { readSemantic } = await import(path.join(REPO_ROOT, 'core/search/search-read-semantic.js'));
    r = await readSemantic({
      path: file, query, projectRoot: FILE_ROOT,
      maxChars: maxTokens * 4, verbose: false,
    });
  }
  if (!r.ok) {
    process.stderr.write(`[ss-semantic] error: ${r.reason || 'unknown'}\n`);
    process.exit(1);
  }
  const shownSpans = SPAN_POLICY_ENABLED
    ? collectSemanticShownSpans(r, { projectRoot: FILE_ROOT }) : [];
  await recordAgentToolCall({ spans: shownSpans, query });
  process.stdout.write(`# ss-semantic ${r.file} | "${query}" | spans=${r.spans?.length ?? 0} | ~tokens=${r.approxTokensReturned}${r.fellBack ? ' [FALLBACK]' : ''}\n`);
  for (const span of r.spans || []) {
    const fence = r.language ? '```' + r.language : '```';
    const sym = span.symbols?.length ? ` [${span.symbols.join(', ')}]` : '';
    process.stdout.write(`### ${r.file}:${span.startLine}-${span.endLine}${sym}\n${fence}\n${gutter(span.text, span.startLine)}\n\`\`\`\n`);
  }
  const shownTrailer = SHOWN_SPAN_TRAILER ? renderShownFullTrailer(shownSpans) : '';
  if (shownTrailer) process.stdout.write(`${shownTrailer}\n`);
  process.exit(0);
}

const TRACE_USAGE = 'Usage: ss-trace <symbol> [callers|callees|impact] [--in <file>] [--query <hint>] [--depth N] [--budget N]';
async function cmdTrace(rawArgs) {
  const args = normalizeArgs(rawArgs);
  let json = false;
  if (args.includes('--json')) {
    json = true;
    args.splice(args.indexOf('--json'), 1);
  }
  const { traceSymbol, formatStructuralContext, TRACE_MODES } = await import(path.join(REPO_ROOT, 'core/search/search-trace.js'));

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
  await recordAgentToolCall({
    query: json ? undefined : `${symbol} ${queryHint}`.trim(),
  });
  if (json) process.stdout.write(JSON.stringify({ ...response, mode }, null, 2) + '\n');
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
