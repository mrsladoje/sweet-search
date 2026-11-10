// Helpers that two or more ss-* commands use (the modules beside this file).
//
// A function whose first parameter is `ctx` reads the state of one call (./context.mjs: project
// root, file root, fix flags, ledger keys, the daemon's host hooks). The others read only their
// arguments. All of them run inside the virtual process of the call, as the commands do: they
// use process.cwd(), process.stdout / process.stderr and process.exit (see ../run-agent-tool.mjs).

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseValueFlag, parsePositiveIntFlag, parseRepeatedValueFlag, extractPositional, renderSufficiency,
  absorbPositionalPaths as absorbPositionalPathsPure, parseGlobFlags,
} from '../argparse.mjs';
import { resolveCwdGlob, resolveCwdPath } from '../../search/cwd-paths.js';
import { SEARCH_LOADING_WAIT_MS } from '../tools.js';
import { createIndexCoverage } from '../../search/index-coverage.js';
import { callExistsSync, callStatSync } from '../../infrastructure/call-fs.js';
import { numberCodeLines, lineGutterEnabled } from '../../search/search-read.js';
import { renderRegexDialectHint } from '../../search/regex-dialect.js';
import { sendAgentSpanOperation } from '../../search/agent-span-client.js';
import {
  decideAlreadyShown, printedSpanCandidates, readSpansForAlreadyShown, renderCompactSufficiency, selectEntries,
} from '../../search/agent-output-fixes.js';

// 16-char SHA1 prefix is enough for grouping identical queries across
// benchmark runs without bloating artifacts.
export function shortQueryHash(q) {
  try { return createHash('sha1').update(String(q)).digest('hex').slice(0, 16); }
  catch { return null; }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../../..');

// EVERY code block the ss-* wrappers hand the agent goes through the SAME gutter as
// `ss-read`. It used not to: `ss-search`, `ss-find` and `ss-semantic` wrote `r.code` and
// `span.text` raw while `ss-read` numbered, so 27-36% of delivered code lines arrived
// unnumbered and 5-10% of edits anchored on them. A model that has to strip a prefix on
// some blocks and not others is being handed two formats for one job.
export function gutter(text, startLine) {
  return (lineGutterEnabled() && text) ? numberCodeLines(text, startLine || 1) : text;
}

// core/search/search-client.js, loaded once per process (an `await import()` per call costs ~10 µs).
let searchServerModule = null;
function loadSearchServerModule() {
  searchServerModule ||= import(path.join(REPO_ROOT, 'core/search/search-client.js'))
    .catch((err) => { searchServerModule = null; throw err; });
  return searchServerModule;
}

export async function recordAgentToolCall(ctx, {
  operation = 'observe',
  spans = [],
  force = false,
  query,
  regex,
} = {}) {
  if (!ctx.exactRereadOmission || !ctx.sessionId) return null;
  return sendAgentSpanOperation({
    operation,
    spans,
    force,
    sessionId: ctx.sessionId,
    query,
    regex,
  });
}

// Entry plan for the fixed ss-search / ss-find renderer (see selectEntries).
export function planFixedResults(ctx, results, { k, find }) {
  return selectEntries(results, {
    dedupe: ctx.fix.compact ? 'a2' : (ctx.dedupe && !find ? 'v3' : false),
    onePerFile: !find && ctx.fix.onePerFile,
    foldDeclarationBlocks: ctx.fix.compact,
    summaryCap: ctx.fix.summaryCap,
    k,
  });
}

// A3: which printed blocks this thread already saw (own ledger namespace). Fail open.
export async function alreadyShownFor(ctx, results, plan) {
  if (!ctx.alreadyShownOn || !plan) return new Set();
  try {
    return await decideAlreadyShown({
      send: sendAgentSpanOperation,
      sessionId: ctx.a3SessionId,
      candidates: printedSpanCandidates(results, plan, { projectRoot: ctx.fileRoot }),
    });
  } catch {
    return new Set();
  }
}

// A3: ss-read / ss-semantic only RECORD what they printed (A3 namespace); their output is not
// changed and the reply is ignored. Fail open.
export async function recordForAlreadyShown(ctx, spans, decisions, printedChars) {
  if (!ctx.alreadyShownOn) return;
  try {
    await sendAgentSpanOperation({
      operation: 'observe',
      spans: readSpansForAlreadyShown(spans, decisions, printedChars),
      sessionId: ctx.a3SessionId,
    });
  } catch { /* the receipt is best effort */ }
}

// Pure arg-parsing helpers (parseFlag/parseShortFlag/parseBoolFlag/
// buildGrepPattern/stripInertFlags/normalizeArgs/extractPositional) live in
// ../argparse.mjs so they can be unit-tested without this file's top-level
// IIFE firing. resolvePositional wraps the side-effect-free extractPositional
// with the CLI's loud-error exit.
export function resolvePositional(args, usage) {
  const { pattern, unknownFlag } = extractPositional(args);
  if (unknownFlag) {
    failUsage(`unrecognised option "${unknownFlag}"`, usage);
  }
  return pattern;
}

export function failUsage(message, usage) {
  process.stderr.write(`[ss] ${message}\n${usage}\n`);
  process.exit(2);
}

export function readPositiveIntFlag(args, names, fallback, usage) {
  const parsed = parsePositiveIntFlag(args, names, fallback);
  if (parsed.error) failUsage(parsed.error, usage);
  return parsed.value;
}

export function readValueFlag(args, names, fallback, usage, opts = {}) {
  const parsed = parseValueFlag(args, names, fallback, opts);
  if (parsed.error) failUsage(parsed.error, usage);
  return parsed.value;
}

export function readRepeatedValueFlag(args, names, usage) {
  const parsed = parseRepeatedValueFlag(args, names);
  if (parsed.error) failUsage(parsed.error, usage);
  return parsed.values;
}

// Agents pass `-k N` to every ss-* tool by habit (it sizes ss-grep, ss-find and ss-search).
// A tool without a result count takes it and ignores it, instead of failing the call on a
// usage error (2 Codex calls on ss-semantic, TRACES-rules3). Consumes `-k N`, `-kN`,
// `--top N`; returns the count (unused by the caller) or null.
export function takeCountFlag(args, usage) {
  const at = args.findIndex((a) => /^-k\d+$/.test(a));
  if (at !== -1) args.splice(at, 1, '-k', args[at].slice(2));
  return readPositiveIntFlag(args, ['-k', '--top'], null, usage);
}

// Every path argument resolves the way the shell would: relative to the agent's cwd
// first, then (unchanged) relative to the repository root. The result is the
// root-relative spelling, so all output stays root-relative (core/search/cwd-paths.js).
// `cd okhttp3 && ss-read Dispatcher.kt 190 215` used to fail with ENOENT.
export function cwdPath(ctx, p) {
  return resolveCwdPath(p, { cwd: process.cwd(), root: ctx.fileRoot });
}

// A short path the agent copied from an output (`RealInterceptorChain.kt`, `http/RealCall.kt`)
// that names no file on disk: when it is the end (whole path components) of exactly ONE
// indexed file, that file is meant. Returns { file, resolved }: `resolved` = the caller prints
// the full path, so the agent learns it. Two or more files: exit 1 listing them (stderr; the
// wrapper shows stderr on a non-zero exit). None: unchanged (the caller's own miss handling).
const SHORT_PATH_CANDIDATES_SHOWN = 8;
export async function resolveShortFile(ctx, typed, file, tool) {
  if (!file || typeof typed !== 'string' || path.isAbsolute(typed)) return { file, resolved: false };
  try { if (existsSync(path.resolve(ctx.fileRoot, file))) return { file, resolved: false }; }
  catch { return { file, resolved: false }; }
  const cov = await getCoverage(ctx);
  let matches = [];
  try { matches = cov?.filesEndingWith?.(typed) || []; } catch { matches = []; }
  if (matches.length === 1) return { file: matches[0], resolved: true };
  if (matches.length > 1) {
    const shown = matches.slice(0, SHORT_PATH_CANDIDATES_SHOWN);
    const more = matches.length - shown.length;
    process.stderr.write(`[${tool}] ${typed} matches ${matches.length} files; give one in full:\n`
      + `${shown.join('\n')}${more > 0 ? `\n+${more} more` : ''}\n`);
    process.exit(1);
  }
  return { file, resolved: false };
}

// The --in scopes that are files: paths the agent typed, which the output need not repeat.
export function typedFiles(ctx, inPaths) {
  return (inPaths || []).filter((p) => {
    try { return !!p && !!callStatSync(path.resolve(ctx.fileRoot, p))?.isFile(); } catch { return false; }
  });
}

// --in values and absorbed positional scopes, cwd-first, de-duplicated (in place).
export function resolveScopePaths(ctx, inPaths) {
  const resolved = [...new Set(inPaths.map((p) => cwdPath(ctx, p)))];
  inPaths.splice(0, inPaths.length, ...resolved);
}

// ss-grep / ss-find -g globs (and --include / --exclude / --exclude-dir), in rg form. A glob
// typed from a subdirectory is re-anchored the way rg anchors it, at the cwd, with the same
// root-relative fallback as a path (resolveCwdGlob); `resolve: false` for ss-find's fallback,
// whose globs are already resolved.
export function readGlobFlags(ctx, args, usage, { resolve = true } = {}) {
  const parsed = parseGlobFlags(args);
  if (parsed.error) failUsage(parsed.error, usage);
  if (!resolve) return parsed.globs;
  return [...new Set(parsed.globs.map(g => resolveCwdGlob(g, { cwd: process.cwd(), root: ctx.fileRoot })))];
}

/** The globs as the agent can paste them back: ` -g '!lib/tests/**'` per glob. */
function globEcho(globs) {
  return globs.map(g => ` -g '${g.replace(/'/g, `'\\''`)}'`).join('');
}

// Every match the -g globs removed, when they removed all of them: never a bare
// "(no matches)", which reads as "the pattern is absent".
export function globExcludedNote(stats, globs) {
  const n = stats?.pathGlobExcludedMatches || 0;
  if (!globs.length || n === 0) return null;
  const files = stats?.pathGlobExcludedFiles;
  return `(no matches outside the globs:${globEcho(globs)} removed all ${n} match(es)`
    + `${files ? ` in ${files} file(s)` : ''}; drop or widen a glob to see them)`;
}

// An include glob that matched a directory took the files below it (grep-path-globs.js,
// deviation 0). One line names those directories, so the wider scope is never silent.
export function globDirNote(stats) {
  const dirs = Array.isArray(stats?.pathGlobDirs) ? stats.pathGlobDirs : [];
  if (!dirs.length) return null;
  const shown = dirs.slice(0, 3).map(d => `${d}/`).join(', ');
  const more = dirs.length > 3 ? ` +${dirs.length - 3} more` : '';
  return `# -g also matched ${dirs.length === 1 ? 'directory' : 'directories'} ${shown}${more} — searched the files below`;
}

// Grep muscle memory writes `ss-grep "pat" src/foo` with the scope as a bare
// positional instead of `--in src/foo`. Absorb any such trailing positional that
// resolves to a real path under the project.
export function absorbPositionalPaths(ctx, args, inPaths) {
  absorbPositionalPathsPure(args, inPaths,
    (tok) => existsSync(path.isAbsolute(tok) ? tok : path.resolve(ctx.fileRoot, cwdPath(ctx, tok))));
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
async function getCoverage(ctx) {
  if (ctx.coverageTried) return ctx.coverage;
  ctx.coverageTried = true;
  try { ctx.coverage = await createIndexCoverage({ projectRoot: ctx.projectRoot }); }
  catch { ctx.coverage = null; }
  return ctx.coverage;
}

/**
 * `{kind, reason, text}` when the index does not hold `scopePath`, else null.
 * `kind` is 'excluded' (the indexer will never hold it) or 'stale' (it would, but this
 * index has not seen it yet). Callers must not treat those the same: refusing to show a
 * file body is right for the first and wrong for the second.
 */
export async function notIndexedNote(ctx, scopePath) {
  const cov = await getCoverage(ctx);
  if (!cov) return null;
  try { return await cov.notIndexedNote(scopePath); } catch { return null; }
}

// A scope that does not exist on disk is the loudest case: 10 of 11 such calls in the
// fresh pool printed a bare `(no matches)`, which says "your pattern is absent" about
// a directory that was never searched. Usually a mistyped or invented path
// (`src/b2/build/x` for `src/build/x`). Say so and name the repair. Informative, not a
// crash: the pattern may still be fine. A distinct exit code (3) lets a wrapper or a
// script tell "scope wrong" from "searched and found nothing" (0). ss-grep and ss-find.
//
// The usual wrong guess has the right NAME under the wrong parent (`GRDB/Core/Pool.swift`
// for `GRDB/Utils/Pool.swift`). The index knows every file and directory with that name, so
// name them: the agent re-scopes in the next call instead of spending one on a locate step.
// Suggest only, never search a guessed path on the agent's behalf.
const SCOPE_CANDIDATES_SHOWN = 3;
async function scopeCandidates(ctx, missingPath) {
  const name = String(missingPath).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
  if (!name || name === '.' || name === '..') return [];
  const cov = await getCoverage(ctx);
  let found = [];
  try { found = cov?.filesEndingWith?.(name) || []; } catch { found = []; }
  if (!found.length) {
    try { found = cov?.dirsNamed?.(name) || []; } catch { found = []; }
  }
  return found.filter((f) => f !== missingPath);
}

export async function exitScopeNotFound(ctx, missing) {
  const hints = [];
  for (const p of missing) {
    const found = await scopeCandidates(ctx, p);
    if (!found.length) continue;
    const shown = found.slice(0, SCOPE_CANDIDATES_SHOWN);
    const more = found.length - shown.length;
    hints.push(found.length === 1
      ? `Did you mean --in ${found[0]}?`
      : `Indexed paths named like ${p}: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}.`);
  }
  const repair = hints.length === missing.length
    ? hints.join(' ')
    : [...hints, 'Locate the real path first: ss-grep "<name>" with no --in, then re-scope.'].join(' ');
  process.stdout.write(`(scope not found: ${missing.join(', ')} — nothing was searched under `
    + `${missing.length > 1 ? 'those paths' : 'that path'}. This is NOT an absence of matches. `
    + `${repair})\n`);
  process.exit(3);
}

/** The `--in` scopes that do not exist on disk at all. */
export function missingScopes(ctx, scopePaths) {
  return (scopePaths || []).filter((p) => {
    if (!p) return false;
    try { return !callExistsSync(path.isAbsolute(p) ? p : path.resolve(ctx.fileRoot, p)); }
    catch { return false; }
  });
}

export async function getSweetSearch(ctx) {
  if (ctx.host.getSearcher) return ctx.host.getSearcher();
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
    const s = new SweetSearch({ projectRoot: ctx.projectRoot });
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
export async function ensureWarmServerReady(ctx, { timeoutMs = SEARCH_LOADING_WAIT_MS, startedMs = Date.now(), intervalMs = 500 } = {}) {
  // Inside the daemon: it is the warm server, and it only takes a call once ready.
  if (ctx.host.getSearcher) return 'ready';
  const { getServerHealth, isServerListening, autoSpawnServer } = await import(path.join(REPO_ROOT, 'core/search/search-client.js'));
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

export async function queryWarmSearch(ctx, query, options) {
  if (await ensureWarmServerReady(ctx, { timeoutMs: 5000 }) !== 'ready') {
    throw new Error('warm server is not ready');
  }
  const { queryServer } = await loadSearchServerModule();
  const response = await queryServer(query, {
    ...options,
    projectRoot: ctx.projectRoot,
    trackAgentSpans: false,
    _isAgentFormat: options._isAgentFormat ?? true,
  });
  if (response?.error) throw new Error(response.error);
  return response;
}

export function writeRegexDialectHint(stats) {
  const note = renderRegexDialectHint(stats?.regexDialectHint);
  if (note) process.stdout.write(`${note}\n`);
}

// SS_FIX_A keeps a compact sufficiency token, printed ONLY when the verdict is YES (the sweet rules
// tell the agent to trust the top result on `sufficient=YES`). Owner decision 2026-10-01: dropping it
// is a behaviour change → separate B-switch SS_FIX_DROP_SUFFICIENCY=1 (A/B "keep vs drop").
// Like the original, it is printed only together with a confidence verdict. SS_FIX_DROP_SUFFICIENCY
// only acts under SS_FIX_A (without SS_FIX_A the original confidence line prints unchanged).
export function compactSufficiencyLine(ctx, response) {
  return renderCompactSufficiency(response, renderSufficiency(response), { drop: ctx.fix.dropSufficiency });
}
