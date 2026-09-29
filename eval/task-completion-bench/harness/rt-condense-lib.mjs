// Shared, pure, unit-tested primitives for the cost levers L1 + L2 (2026-07-08).
//
//   L1 — universal command-output condenser (condenseOutput): shrink oversized
//        bash-command output (raw `docker run`, `git diff`, verbose builds/suites)
//        to a bounded head + promoted failure lines + tail + elision marker, so a
//        40 KB log does not sit RESIDENT in the agent's context for the rest of the
//        trajectory. Preserves every failure-diagnostic line (H1 precedent: the old
//        blind `tail -60` hid failing-test names → a quarter-trajectory of shim
//        spelunking). Exit codes are preserved by the CALLER, not here.
//
//   L2 — run_tests self-authority + baseline-diff (extractFailureSignatures /
//        diffFailureSets / buildAuthorityBanner / targeted-test helpers): label the
//        failures that pre-exist the agent's edits so the agent stops chasing
//        environment noise it did not cause (botan `found certificate was nullopt`
//        under --network none). ASYMMETRIC by construction: a failure is called
//        "pre-existing" ONLY on an exact normalized-signature match with the clean
//        baseline; a genuinely new failure never matches → never mislabeled as
//        pre-existing (the one kill condition). A pre-existing failure occasionally
//        shown as "new" is acceptable noise.
//
// Everything here is a pure function of its inputs (no I/O, no Date/Math.random) so
// the harness AND the generated run_tests shim can both import it and so it is
// exhaustively unit-testable offline with zero docker spend.

// Positive failure indicators, language-appropriate. Mirrors + widens the in-container
// RT_CONDENSE grep (pytest/cargo/go/mocha/jest/dotnet/phpunit/R/julia/ctest/generic).
// The FAIL tokens carry a LEADING word boundary: without it `XFAIL` (pytest's
// expected-failure marker, which is a PASS) matched and became a failure signature.
// The lower/mixed-case alternatives are deliberately narrow — the specific vocabulary
// observed from real runners — because blanket case-insensitive `fail` matching was
// measured on 12,752 retained output lines and fired on passing test NAMES
// ("✓ should show failures and exit with 1 on fail") plus JUnit XML attributes.
//
// Jest (2026-09-29, ember-cli__eslint-plugin-ember-551): a failing test is named ONLY by its
// `● <describe> › <test>` block header and, in verbose mode, by a `✕ <test>` list line; the
// file-level `FAIL <path>` line is often in the elided middle. Neither form matched, so
// "Tests: 4 failed" parsed to 0 signatures and every verdict read trustworthy=no. The header
// form is anchored to line start; `● Console` and jest's warning blocks are not failures
// (JEST_NON_FAILURE_HEADER_RE below).
export const FAILURE_INDICATOR_RE =
  /(\bFAILED\b|\bFAIL:|\bFAIL\b|not ok |AssertionError|panicked at|thread '[^']*' panicked|[0-9]+ tests? failed|[0-9]+ (?:failing|failures)|[Ee]rror:|error\[|Exception\b|Traceback|--- FAIL|✗|✘|✖|✕|×|^\s*● \S|\bTests?\s+Failed\b|\bFail\s*\|\||\bFailed\s*:\s*[1-9][0-9]*\b|Failure \(|SEGFAULT|Segmentation fault|core dumped|assert(?:ion)? failed|expected .* but| FAILED\b)/;

// Jest `●` headers that open a NON-failure block: captured console output and config
// warnings. Never a signature. (`● Validation Error` is a usage error, see USAGE_ERROR_RE.)
const JEST_NON_FAILURE_HEADER_RE = /^\s*●\s+(?:Console\s*$|Validation (?:Warning|Error)\b|Deprecation Warning\b|Multiple configurations found\b)/;
const JEST_CONSOLE_HEADER_RE = /^(\s*)●\s+Console\s*$/;
const JEST_FAILURE_HEADER_RE = /^\s*●\s+\S/;
const JEST_CROSS_LINE_RE = /^\s*✕\s/;

// Negative guard: lines that MENTION failure vocabulary but report ZERO failures
// (a green summary) must NOT be promoted or counted as failures. The zero can sit on
// either side of the label — `0 failed` and `FAIL 0` / `Failed : 0` / `failures="0"`
// are all green — and ctest reports green as `100% tests passed, 0 tests failed`.
export const FAILURE_NEGATIVE_RE =
  /(0 fail|failures?: 0|failed: 0|: 0 error|0 error|no failures|all tests passed|0 failing|\bx?fail(?:ed|ures?)?\s*[:=|]?\s*0\b|\b0\s+(?:tests?\s+)?fail(?:ed|ures?)?\b|\b\d+%\s+tests\s+passed\b|\bxfail)/i;

// "Could not resolve" is a NAME-RESOLUTION phrase only when a resolver or package
// manager says it. Anchored 2026-09-02 after the bare alternative cost a whole task its
// test signal: accenture__sfmc-devtools-1974 prints the application log line
// "Could not resolve ID of asset ...: structuredClone is not defined", the shim forced
// status=INFRA, and 0 of 104 run_tests calls across 44 rollouts were trustworthy — 21 of
// those rollouts resolved blind. The suite had run to completion offline every time
// (mocha exit 233/234 = its own failure count).
//
// The anchored forms, and who prints them: curl/git "could not resolve host|proxy",
// ssh "could not resolve hostname", maven "Could not resolve dependencies for project",
// npm "npm ERR! Could not resolve dependency:", gradle "Could not resolve all
// files/artifacts/dependencies for configuration". Keep this list narrow: every widening
// buys back the false positive it was written to remove.
//
// ERE-SAFE by construction — the generated shim greps the same alternation with `grep -E`,
// which has no non-capturing groups. Keep it that way or the two classifiers drift and the
// banner path re-forces INFRA on output the regex here has already cleared.
export const COULD_NOT_RESOLVE_ERE =
  'Could not resolve (host|hostname|proxy|dependency|dependencies|all dependencies|all files|all artifacts)';

// Network markers shared by the in-container banner and the classifier below, in the order
// the shim greps them.
export const NETWORK_ERROR_ERE =
  `${COULD_NOT_RESOLVE_ERE}|Temporary failure in name resolution|Network is unreachable`;

// Infra / harness-error markers: when the CURRENT run is an infra failure (lockdown
// network, broker timeout, docker error) rather than real test failures, baseline
// labeling is suppressed entirely — those "failures" are not the agent's tests.
export const INFRA_ERROR_RE =
  new RegExp(`(NETWORK UNAVAILABLE|no response from test broker|\\[run_tests exit=|${NETWORK_ERROR_ERE}|Cannot connect to the Docker daemon|docker: Error)`);

// ---- Build / collection / load errors (2026-09-29) ------------------------------
// zmap__zlint-299 (hc-claudecode-20260929-0423-L2): `go test` did not COMPILE
// (`undefined: util.PoisonOID`), exit 2. The in-container promote grep matches neither
// `undefined:` nor go's `FAIL\t<pkg> [build failed]`, `tail -45` held only the passing
// util package, so the shim parsed 0 failures, footer said trustworthy=yes and the dedup
// repeat said "0 failed (suite green)". The agent never saw the compiler line.
//
// Two vocabularies, deliberately different widths:
//
// BUILD_ERROR_MARKER_ERE — CLASSIFICATION. High precision only: phrases a toolchain prints
// when the suite could not be built, collected or loaded, never on an ordinary failing
// test. It decides status=ERROR, so every alternative must be one that a passing or a
// normally-failing suite cannot print. `error:` is NOT here: cargo prints
// "error: test failed, to rerun pass --lib" on every ordinary failing test.
//
// FIRST_ERROR_ERE — DISPLAY ONLY. The wider set of lines worth showing the agent first when
// the output is too long for the tail to hold them (the "first errors" excerpt the shim
// prints on a non-zero exit). A false positive here costs a few bytes, never a verdict.
//
// Both ERE-safe (the shim greps them with `grep -E`: no non-capturing groups, no \b, no \d).
export const BUILD_ERROR_MARKER_ERE = [
  '\\[build failed\\]', '\\[setup failed\\]',                          // go test
  'ERROR collecting', 'errors? during collection',                     // pytest
  'ImportError while importing test module', 'Failed to import test module', // pytest / unittest
  'Test suite failed to run',                                          // jest
  'error: could not compile', 'could not compile `',                   // cargo
  'error TS[0-9]+', 'error CS[0-9]+',                                  // tsc / dotnet csc
  'COMPILATION ERROR', 'Compilation failure', 'Compilation failed',    // maven / gradle / swift
  'cannot find symbol',                                                // javac
  '\\.go:[0-9]+:[0-9]+: ',                                             // go compiler / vet line
  '\\.(c|cc|cpp|cxx|h|hpp|m|mm):[0-9]+:[0-9]+: (fatal )?error:',       // gcc / clang
].join('|');

export const FIRST_ERROR_ERE = [
  BUILD_ERROR_MARKER_ERE,
  'undefined: ', 'undefined reference', '[Cc]annot find', 'No module named',
  'SyntaxError', 'ModuleNotFoundError', 'ImportError', 'IndentationError',
  'error\\[E[0-9]+\\]', '^error: ', '^Error: ', '^panic: ', 'BUILD FAILED', 'Build FAILED',
].join('|');

export const BUILD_ERROR_MARKER_RE = new RegExp(BUILD_ERROR_MARKER_ERE);
export const FIRST_ERROR_RE = new RegExp(FIRST_ERROR_ERE);

// A summary that reports a NON-ZERO failed-test count ("Tests: 3 failed", "1 failed,
// 600 passed", "Failed: 2", "FAILED (failures=1)"). When the output carries one, a run
// with exit≠0 and no parsed per-test signature is an UNPARSED TEST FAILURE (jest `✕`
// names, observed on ember-cli__eslint-plugin-ember-551), not a build error: status stays
// FAIL, but it is still untrustworthy — an empty introduced set proves nothing.
const NONZERO_FAILURE_SUMMARY_RE =
  /(?:\b[1-9]\d*\s+(?:tests?\s+)?(?:failed|failing|failures?)\b|\b(?:failed|failures?|failing)\s*[:=(]?\s*[1-9]\d*\b)/i;

/**
 * First `max` display-worthy error lines, in output order, de-duplicated, each cut to
 * `maxChars`. Display only — never feeds a verdict.
 */
export function firstErrorLines(text, { max = 6, maxChars = 240 } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text ?? '').split('\n')) {
    const line = stripAnsi(raw).replace(/\s+$/, '');
    if (!line.trim() || !FIRST_ERROR_RE.test(line)) continue;
    const cut = line.length > maxChars ? line.slice(0, maxChars) + '…' : line;
    if (seen.has(cut)) continue;
    seen.add(cut); out.push(cut);
    if (out.length >= max) break;
  }
  return out;
}

/** Normalized build/collection marker lines (for baseline comparison). */
export function extractBuildErrorMarkers(text) {
  const markers = new Set();
  for (const raw of String(text ?? '').split('\n')) {
    const line = stripVolatileFailurePrefix(stripAnsi(raw));
    if (!BUILD_ERROR_MARKER_RE.test(line)) continue;
    const sig = normalizeFailureSignature(line);
    if (sig) markers.add(sig);
  }
  return markers;
}

/**
 * Decide whether a non-zero, non-infra run is a BUILD/COLLECTION/LOAD error (no test
 * result exists) rather than a test failure. Pure; the caller has already ruled out infra
 * and timeouts.
 *
 *   exit 0                                   → never an error (the runner said it ran).
 *   a build marker NOT present in baseline   → error. Pre-existing markers (a package that
 *                                              never builds in the image) stay FAIL, so the
 *                                              sfmc-devtools trap — one pre-existing line
 *                                              forcing EVERY call untrustworthy — cannot recur.
 *   0 parsed failures + no non-zero summary  → error (nothing says a test ran and failed).
 *   0 parsed failures + non-zero summary     → unparsed test failure (FAIL, untrustworthy).
 *
 * @returns {{ buildError: boolean, unparsedFailure: boolean, newMarkers: string[] }}
 */
export function classifyBuildError({ text, exitCode, sigCount, baselineMarkers = null }) {
  if (!Number.isInteger(exitCode) || exitCode === 0) return { buildError: false, unparsedFailure: false, newMarkers: [] };
  const markers = extractBuildErrorMarkers(text);
  const newMarkers = [...markers].filter(m => !(baselineMarkers instanceof Set && baselineMarkers.has(m)));
  if (newMarkers.length) return { buildError: true, unparsedFailure: false, newMarkers };
  if (sigCount > 0) return { buildError: false, unparsedFailure: false, newMarkers: [] };
  const summary = String(text ?? '').split('\n').some(l => {
    const line = stripAnsi(l);
    return NONZERO_FAILURE_SUMMARY_RE.test(line) && !FAILURE_NEGATIVE_RE.test(line);
  });
  return summary
    ? { buildError: false, unparsedFailure: true, newMarkers: [] }
    : { buildError: true, unparsedFailure: false, newMarkers: [] };
}

/** One-line, tail-safe note rendered directly above the footer on status=ERROR. */
export function renderBuildErrorNote({ exitCode, firstErrors = [] }) {
  const first = firstErrors.length ? ` First error: ${firstErrors[0].trim().slice(0, 200)}` : '';
  return `[run_tests] BUILD/COLLECTION ERROR: exit ${exitCode} and the suite did not build, collect or load ` +
    `- this is NOT a test result and NOT green. Fix the error first.${first}`;
}

// ---- Usage errors and empty selections (2026-09-29) ------------------------------
// mwouts__jupytext-360 (hc-codex-20260929-1618-L3): `run_tests -k pipe` reached pytest as
// `-k '-k'`, pytest printed "pytest: error: argument -k: expected one argument" (exit 4),
// and the `error:` line became "1 NEW failure(s) introduced by your edits". A runner that
// rejected its command line, or a selection that matched no test, has produced NO test
// result: status=ERROR with a note that the command or its arguments were wrong, never a
// failure signature.
//
// USAGE_ERROR_RE — the runner rejected the command line (argparse / pytest / jest config /
// generic `usage:`). Lines matching it are never failure signatures (extractFailureSignatures).
// NO_TESTS_RE — the command was accepted but selected nothing (pytest exit 5, jest "No tests
// found", go "[no test files]" / "[no tests to run]", mocha "0 passing", unittest "Ran 0").
//
// Both only classify when (a) the marker line is NOT already on the clean baseline (the
// full suite of a Go module prints "? pkg [no test files]" for test-less packages on every
// green run — the same pre-existing rule as build markers), and (b) nothing in the output
// shows that a test actually executed (TESTS_EXECUTED_RE). A usage marker also needs exit≠0.
// A CLI project whose failing test prints its own `usage:` text still has a pass/fail
// summary, so (b) keeps that a FAIL.
export const USAGE_ERROR_RE =
  /^\s*(?:ERROR: usage: |usage: |Usage: |\S+: error: (?:argument |unrecognized arguments|the following arguments are required)|ERROR: file or directory not found: |ERROR: not found: |ERROR: Wrong expression passed to '-k'|●\s+Validation Error\b|error: unexpected argument |error: Found argument )/;
export const NO_TESTS_RE =
  /(\bno tests ran\b|\bcollected 0 items\b|\/ 0 selected\b|^\s*No tests found\b|^\s*0 passing\b|\[no test files\]|\[no tests to run\]|^testing: warning: no tests to run|^\s*Ran 0 tests\b|^\s*running 0 tests\b)/i;
const TESTS_EXECUTED_RE =
  /(\b[1-9]\d*\s+(?:passed|passing|failed|failing|skipped|pending|xfailed|xpassed)\b|^\s*Ran [1-9]\d* tests?\b|^--- (?:PASS|FAIL|SKIP):|^ok\s+\S+\s+(?:\(cached\)|[\d.]+s)\s*$|^FAIL\s+\S+\s+[\d.]+s\s*$|\b(?:Passed|Failed|Total)\s*:\s*[1-9]|\bTests:\s*[1-9]|\bOK \([1-9]\d* tests?\b)/im;

/** Normalized usage / no-test marker lines (for baseline comparison). */
export function extractNoResultMarkers(text) {
  const markers = new Set();
  for (const raw of String(text ?? '').split('\n')) {
    const line = stripVolatileFailurePrefix(stripAnsi(raw));
    if (!USAGE_ERROR_RE.test(line) && !NO_TESTS_RE.test(line)) continue;
    const sig = normalizeFailureSignature(line);
    if (sig) markers.add(sig);
  }
  return markers;
}

/**
 * Decide whether a non-infra run produced NO test result because of its command line.
 * Pure; the caller has already ruled out infra and timeouts.
 * @returns {{ kind: 'usage'|'no-tests'|null, line: string }}
 */
export function classifyNoTestResult({ text, exitCode, baselineMarkers = null }) {
  const t = String(text ?? '');
  const none = { kind: null, line: '' };
  if (TESTS_EXECUTED_RE.test(stripAnsi(t))) return none;
  const isNew = line => {
    const sig = normalizeFailureSignature(line);
    return !(baselineMarkers instanceof Set && baselineMarkers.has(sig));
  };
  let noTests = '';
  for (const raw of t.split('\n')) {
    const line = stripVolatileFailurePrefix(stripAnsi(raw)).replace(/\s+$/, '');
    if (USAGE_ERROR_RE.test(line) && Number.isInteger(exitCode) && exitCode !== 0 && isNew(line)) {
      return { kind: 'usage', line: line.trim() };
    }
    if (!noTests && NO_TESTS_RE.test(line) && isNew(line)) noTests = line.trim();
  }
  return noTests ? { kind: 'no-tests', line: noTests } : none;
}

/** One-line, tail-safe note rendered directly above the footer for a usage / empty selection. */
export function renderNoTestResultNote({ kind, line = '', exitCode }) {
  const what = kind === 'usage'
    ? 'the test runner rejected the command or its arguments'
    : 'the command selected no test';
  const shown = line ? ` Runner said: ${line.slice(0, 200)}` : '';
  return `[run_tests] NO TEST RAN: exit ${exitCode} and ${what} - the command/arguments were wrong. ` +
    'This is NOT a test result, NOT green and NOT caused by your edits. `run_tests` takes no runner options: ' +
    `pass ONE test name pattern or ONE test file path, or nothing for the full suite.${shown}`;
}

// Aggregate SUMMARY-count lines ("2 tests failed", "Failures: 1", "1 failed, 600
// passed"). These are useful to PROMOTE in the condenser (they carry the count) but
// must NOT become per-test failure SIGNATURES — the count varies run to run, so a
// summary would spuriously differ between baseline and current and pollute the diff.
export const SUMMARY_COUNT_RE =
  /^\s*(?:\d+\s+(?:tests?\s+)?(?:failed|failing|failures)\b|failures?:\s*\d+|tests?:?\s*\d+\s+failed|\d+\s+failed,\s*\d+\s+passed|Ran\s+\d+\s+tests?\b|Failed\s*:\s*\d+)/i;

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
// Bracketed clock times also accept 1-digit hours, a ':' before the fraction and an AM/PM suffix
// (brighterscript logger: "[12:43:09:4620 PM]"), so such lines keep one signature across runs.
const LEADING_TIMESTAMP_RE = /^\s*(?:\[(?:\d{1,2}:\d{2}:\d{2}(?:[.,:]\d+)?(?:\s?[AaPp][Mm])?|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?)\]|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+/;
const MSBUILD_NODE_PREFIX_RE = /^\s*\d+>\s?/;
const GENERIC_BUILD_FAILURE_RE = /^Build FAILED\.?$/i;

function stripAnsi(s) { return s.replace(ANSI_RE, ''); }

function stripVolatileFailurePrefix(value) {
  let s = value;
  // Prefixes can arrive as timestamp→node or node→timestamp. Two narrow,
  // anchored passes normalize either ordering without touching names/codes later
  // in the diagnostic.
  for (let i = 0; i < 2; i++) {
    s = s.replace(LEADING_TIMESTAMP_RE, '');
    s = s.replace(MSBUILD_NODE_PREFIX_RE, '');
  }
  return s;
}

function isFailureLine(line) {
  return FAILURE_INDICATOR_RE.test(line) && !FAILURE_NEGATIVE_RE.test(line);
}

/**
 * L1 — condense oversized command output.
 * Keeps: first `headLines`, promoted failure lines (with a little trailing context)
 * that fall in the elided middle, last `tailLines`, and an elision marker carrying
 * byte + line counts and a re-run hint. Small outputs pass through verbatim.
 * Never drops a failure line to satisfy the byte cap — failure lines are the point.
 *
 * @returns {{ text: string, condensed: boolean, totalBytes: number, totalLines: number }}
 */
export function condenseOutput(raw, opts = {}) {
  const text = String(raw ?? '');
  const {
    headLines = 30,
    tailLines = 40,
    maxFailLines = 45,
    failContextAfter = 2,
    verbatimUnderBytes = 6000,
    softCapBytes = 8000,
  } = opts;

  const totalBytes = Buffer.byteLength(text, 'utf8');
  if (totalBytes <= verbatimUnderBytes) {
    return { text, condensed: false, totalBytes, totalLines: text ? text.split('\n').length : 0 };
  }

  const lines = text.split('\n');
  const n = lines.length;
  const headEnd = Math.min(headLines, n);
  const tailStart = Math.max(headEnd, n - tailLines);

  // Promote failure lines that live in the elided middle [headEnd, tailStart).
  const promoted = [];
  const promotedIdx = new Set();
  for (let i = headEnd; i < tailStart && promoted.length < maxFailLines; i++) {
    if (isFailureLine(stripAnsi(lines[i]))) {
      // include the matching line + a little trailing context (compiler errors and
      // stack traces put the file:line / detail on the following lines)
      for (let j = i; j <= i + failContextAfter && j < tailStart && promoted.length < maxFailLines; j++) {
        if (!promotedIdx.has(j)) { promotedIdx.add(j); promoted.push(lines[j]); }
      }
    }
  }

  const headBlock = lines.slice(0, headEnd);
  const tailBlock = lines.slice(tailStart);
  const elidedLines = tailStart - headEnd;
  const shownLines = headEnd + promoted.length + (n - tailStart);

  const assemble = (head, tail) => {
    const parts = [];
    parts.push(head.join('\n'));
    if (promoted.length) {
      parts.push(`--- ${promoted.length} failure/error line(s) promoted from the elided region ---`);
      parts.push(promoted.join('\n'));
    }
    const remainingElided = Math.max(0, elidedLines - promoted.length);
    const elidedBytes = totalBytes - Buffer.byteLength(head.concat(promoted, tail).join('\n'), 'utf8');
    parts.push(
      `--- [output condensed by harness: ${head.length + promoted.length + tail.length} of ${n} lines shown, ` +
      `~${Math.max(0, elidedBytes)} bytes / ${remainingElided} middle lines elided of ${totalBytes} total. ` +
      `Failure lines above are preserved. Re-run scoped (append '| grep <pattern>' or narrow the path) if you need the omitted middle.] ---`);
    parts.push(tail.join('\n'));
    return parts.join('\n');
  };

  let out = assemble(headBlock, tailBlock);
  // Enforce a soft byte cap by trimming head then tail — but NEVER the failure block.
  if (Buffer.byteLength(out, 'utf8') > softCapBytes) {
    let h = headBlock.slice(0, Math.max(8, Math.floor(headLines / 2)));
    let t = tailBlock.slice(Math.max(0, tailBlock.length - Math.max(12, Math.floor(tailLines / 2))));
    out = assemble(h, t);
  }
  return { text: out, condensed: true, totalBytes, totalLines: n, shownLines };
}

/**
 * L2 — normalize a failure line to a stable signature for set comparison.
 * Strips volatile bits (ANSI, durations, hex, run-index list markers, leading
 * status tokens) but KEEPS test names AND file:line, so distinct failures stay
 * distinct (guards against a false "pre-existing"). Line-number shifts caused by
 * the agent's edit yield a fresh signature → at worst a false "new" (the safe side).
 */
export function normalizeFailureSignature(line) {
  let s = stripVolatileFailurePrefix(stripAnsi(String(line || '')));
  s = s.replace(/\(\d+(?:\.\d+)?\s*(?:s|ms|sec|secs|seconds|m)\)/gi, '');   // (0.03s)
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds)\b/gi, '');       // 0.03s
  s = s.replace(/0x[0-9a-fA-F]+/g, '');                                       // hex addrs
  s = s.replace(/^\s*\d+\)\s*/, '');                                          // mocha "12) "
  s = s.replace(/^\s*(?:✗|✘|✖|✕|×|●|-|\*|•)\s*/, '');                         // bullet markers
  s = s.replace(/^\s*(?:not ok\s+\d+\s*-?\s*|FAIL(?:ED)?:?\s*|--- FAIL:\s*)/i, ''); // status prefixes
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * L2 — extract the set of normalized failure signatures from suite output.
 * @returns {{ ok: boolean, sigs: Set<string>, infra: boolean }}
 *   ok=false only when the output is empty/absent. infra=true when the output is an
 *   infra error (network/broker/docker) rather than real test failures → caller must
 *   suppress baseline labeling.
 */
export function extractFailureSignatures(text) {
  const t = String(text ?? '');
  if (!t.trim()) return { ok: false, sigs: new Set(), infra: false };
  const infra = INFRA_ERROR_RE.test(t);
  const sigs = new Set();
  const crossSigs = [];            // jest `✕ <test>` list lines, reconciled with ● headers below
  const headerSigs = [];
  let consoleIndent = -1;          // inside a jest `● Console` block: captured output, not failures
  for (const rawLine of t.split('\n')) {
    const line = stripVolatileFailurePrefix(stripAnsi(rawLine));
    if (consoleIndent >= 0) {
      if (!line.trim() || line.match(/^\s*/)[0].length > consoleIndent) continue;
      consoleIndent = -1;
    }
    const consoleHeader = JEST_CONSOLE_HEADER_RE.exec(line);
    if (consoleHeader) { consoleIndent = consoleHeader[1].length; continue; }
    if (JEST_NON_FAILURE_HEADER_RE.test(line)) continue;
    if (USAGE_ERROR_RE.test(line)) continue;     // the command line was rejected: no test failed
    if (!isFailureLine(line)) continue;
    if (SUMMARY_COUNT_RE.test(line)) continue;   // aggregate count, not a per-test signature
    const sig = normalizeFailureSignature(line);
    if (GENERIC_BUILD_FAILURE_RE.test(sig)) continue;
    if (sig.length < 6) continue;                // drop trivially-short signatures (collision guard)
    if (JEST_CROSS_LINE_RE.test(line)) { crossSigs.push(sig); continue; }
    if (JEST_FAILURE_HEADER_RE.test(line)) headerSigs.push(sig);
    sigs.add(sig);
  }
  // One jest failure prints both `✕ <test>` and `● <describe> › <test>`. Keep the header
  // (it carries the describe path); a `✕` line with no matching header still counts.
  for (const sig of crossSigs) {
    if (!headerSigs.some(h => h === sig || h.endsWith(' › ' + sig))) sigs.add(sig);
  }
  return { ok: true, sigs, infra };
}

/**
 * L2 — diff a current failure set against the clean baseline failure set.
 * ASYMMETRIC: a current failure is "pre-existing" only if its exact normalized
 * signature is in the baseline; everything else is "introduced". Returns null when
 * no trustworthy comparison is possible (no baseline captured, or the current run is
 * an infra error) → caller emits NO labeling (degrade, never mislabel).
 *
 * @param baseline {{ ok:boolean, sigs:Set<string> }|null}
 * @param current  {{ ok:boolean, sigs:Set<string>, infra:boolean }}
 */
export function diffFailureSets(baseline, current) {
  if (!baseline || !baseline.ok) return null;            // no trustworthy baseline
  if (!current || !current.ok) return null;
  if (current.infra) return null;                        // current is infra noise, not tests
  const preExisting = [];
  const introduced = [];
  for (const sig of current.sigs) {
    if (baseline.sigs.has(sig)) preExisting.push(sig);
    else introduced.push(sig);
  }
  return {
    preExisting, introduced,
    baselineCount: baseline.sigs.size,
    currentCount: current.sigs.size,
  };
}

/**
 * L2 — render the baseline-diff as a short banner prepended to run_tests output.
 * Returns '' when diff is null (degrade to no labeling) or when there's nothing
 * useful to say (no current failures).
 */
export function renderBaselineDiff(diff) {
  if (!diff) return '';
  const { preExisting, introduced } = diff;
  if (!preExisting.length && !introduced.length) return '';
  const parts = [];
  // Always NAME the NEW failures — they're actionable and few. Only COUNT a large
  // pre-existing set (naming 40+ pre-existing failures every call is resident-mass tax
  // AND can distract the agent into investigating them — the glam-rs +40% smoke signal).
  if (introduced.length) {
    parts.push(`${introduced.length} NEW failure(s) introduced by your edits (were passing before): ` +
      introduced.slice(0, 6).map(s => truncSig(s)).join(' | ') + (introduced.length > 6 ? ' …' : ''));
  }
  if (preExisting.length) {
    const many = preExisting.length > 8;
    parts.push(`${preExisting.length} PRE-EXISTING failure(s) — also failing on the clean checkout BEFORE your edits, NOT caused by you (do not chase them)` +
      (many ? '.' : ': ' + preExisting.slice(0, 6).map(s => truncSig(s)).join(' | ') + (preExisting.length > 6 ? ' …' : '')));
  }
  return '[run_tests baseline-diff] ' + parts.join('  ||  ');
}

function truncSig(s) { return s.length > 90 ? s.slice(0, 90) + '…' : s; }

/**
 * L2 — the authority banner. Harness-only text (never a shipped prompt surface):
 * tells the agent this IS the test signal and not to reconstruct it by hand.
 */
export function buildAuthorityBanner() {
  return '[run_tests] Authoritative test result for your CURRENT edits — the canonical suite ran ' +
    'in the prepared environment (dependencies installed) against your live diff. Trust THIS PASS/FAIL; ' +
    'do NOT reconstruct it by hand (manual `docker run`, `git diff`, or running the suite yourself) — ' +
    're-invoke `run_tests` instead.';
}

// ---- Tail-safe authoritative footer -------------------------------------------
// Footer signature values are URI-encoded tokens, bounded independently from the
// richer human-readable banner above. This keeps all three final lines parseable and
// safe to retain through `tail` without allowing failure text to grow unboundedly.
function footerSignatures(signatures) {
  const values = (Array.isArray(signatures) ? signatures : [])
    .slice(0, 2)
    .map(sig => encodeURIComponent(String(sig).replace(/\s+/g, ' ').trim().slice(0, 48)).slice(0, 72))
    .filter(Boolean);
  return values.length ? values.join(',') : 'none';
}

/** Suffix of the status line when status=FAIL but verdict=PASS (see buildRunTestsFooter). */
export const RAW_STATUS_PRE_EXISTING_NOTE =
  ' (raw runner result: every failure is pre-existing, your edits introduced none; your result is verdict=PASS on the next line)';

/** Render the exact final three-line run_tests footer. */
export function buildRunTestsFooter({
  status, verdict = status, scope = 'full', exitCode = 0,
  baselineDiff = null, trustworthy = false, guidance = 'none',
} = {}) {
  // ERROR (2026-09-29) = the suite did not build/collect/load: no test result exists.
  // Distinct from INFRA (environment, "do not debug the harness") and from FAIL (tests ran).
  const STATUSES = ['PASS', 'FAIL', 'INFRA', 'ERROR'];
  const normalizedStatus = STATUSES.includes(status) ? status : 'INFRA';
  const normalizedVerdict = STATUSES.includes(verdict) ? verdict : 'INFRA';
  const normalizedScope = scope === 'targeted' ? 'targeted' : 'full';
  const normalizedExit = Number.isInteger(exitCode) ? exitCode : 1;
  const introduced = baselineDiff?.introduced || [];
  const preExisting = baselineDiff?.preExisting || [];
  const trusted = trustworthy === true && baselineDiff !== null;
  const action = String(guidance || 'none').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 120) || 'none';
  // RAW STATUS v VERDICT (2026-09-29, Codex phase-6 audit). `status` is the raw runner result;
  // `verdict` is what the edit changed. They differ in one case only: the suite failed, but every
  // failure also fails on the clean checkout (status=FAIL, verdict=PASS). The first line then read
  // `[run_tests verdict] status=FAIL` directly above `verdict=PASS`, and every arm re-ran the
  // tests on it. The line keeps its fields and their order (the stats scripts and the telemetry
  // parse `status=... scope=... exit=...` as a prefix) and gets a suffix that says which line
  // holds the verdict. When the two agree the line is unchanged.
  const rawNote = normalizedStatus === 'FAIL' && normalizedVerdict === 'PASS' ? RAW_STATUS_PRE_EXISTING_NOTE : '';
  return [
    `[run_tests verdict] status=${normalizedStatus} scope=${normalizedScope} exit=${normalizedExit}${rawNote}`,
    `[run_tests baseline-diff] verdict=${normalizedVerdict} introduced_failures=${introduced.length} ` +
      `pre_existing_failures=${preExisting.length} trustworthy=${trusted ? 'yes' : 'no'} ` +
      `introduced_signatures=${footerSignatures(introduced)} pre_existing_signatures=${footerSignatures(preExisting)}`,
    `[run_tests guidance] verdict=${normalizedVerdict} action=${action}` +
      (action !== 'none' ? ` note="${guidanceSentence(action)}"` : ''),
  ].join('\n');
}

// Imperative rendering of a non-none advisory. The first micro-smoke showed the
// model under-complies with the bare token (it kept retesting instead of
// reviewing once and submitting). The token stays first for machine parsing;
// the sentence is bounded imperative prose on the same tail-safe line.
function guidanceSentence(action) {
  const streak = /streak-(\d+)/.exec(action)?.[1] || '?';
  if (action.startsWith('green.')) {
    return `Canonical tests PASS with only pre-existing failures (consecutive pass ${streak}). ` +
      'Review the issue and your diff ONCE; unless you can name a concrete missing requirement, submit now - further edits are not improving anything.';
  }
  if (action.startsWith('recovery.')) {
    return `Your last ${streak} edit+test cycles produced no objective change in the failure state. ` +
      'Do not make another blind edit: gather ONE new fact first (re-read the failing span or run one targeted probe), then edit - or restore your best earlier state and submit.';
  }
  if (action.startsWith('restore-submit.')) {
    return 'Still no objective change after the recovery allowance. Keep or restore your best earlier state and submit it now.';
  }
  return '';
}

// ---- Experimental diff identifier signal --------------------------------------
// A project symbol index cannot authoritatively resolve runtime globals, lexical
// bindings, or every language's import semantics. The implementation is retained
// only for explicit experiments and is default-OFF at this pure-function boundary.
const DIFF_IDENTIFIER_KEYWORDS = new Set([
  'as', 'async', 'await', 'bool', 'boolean', 'break', 'byte', 'case', 'catch',
  'char', 'class', 'const', 'continue', 'def', 'default', 'defer', 'do', 'double',
  'else', 'enum', 'error', 'export', 'extends', 'false', 'finally', 'float', 'fn',
  'for', 'from', 'func', 'function', 'go', 'if', 'implements', 'import', 'in',
  'int', 'interface', 'is', 'let', 'long', 'map', 'match', 'mod', 'module', 'new',
  'nil', 'none', 'null', 'object', 'of', 'or', 'package', 'pass', 'private', 'protected',
  'pub', 'public', 'raise', 'range', 'ref', 'return', 'self', 'short', 'static',
  'string', 'struct', 'super', 'switch', 'this', 'throw', 'trait', 'true', 'try',
  'type', 'typeof', 'undefined', 'unsafe', 'use', 'using', 'var', 'void', 'while',
  'with', 'yield',
]);

function stripAddedLineNoise(line, state, file) {
  let out = '';
  let quote = state.quote || '';
  const hashComments = /\.(?:py|rb|sh|bash|zsh|ps1|r|jl|ex|exs|yaml|yml)$/i.test(file);
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1] || '';
    if (state.blockComment) {
      if (ch === '*' && next === '/') { state.blockComment = false; i++; }
      out += ' ';
      continue;
    }
    if (quote) {
      if (ch === '\\') { i++; out += '  '; continue; }
      if (ch === quote) quote = '';
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') { state.blockComment = true; i++; out += '  '; continue; }
    if (ch === '/' && next === '/') break;
    if (hashComments && ch === '#' && !out.trim()) break;
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ' '; continue; }
    out += ch;
  }
  // Only backtick/raw strings may intentionally span lines. Ordinary unterminated
  // quotes in a hunk are treated as malformed input and suppress later candidates.
  state.quote = quote === '`' ? quote : '';
  return out;
}

function highSignalIdentifier(name) {
  if (!name || name.length < 3 || DIFF_IDENTIFIER_KEYWORDS.has(name.toLowerCase())) return false;
  return /^[A-Z][A-Za-z0-9_]*$/.test(name) || /_/.test(name);
}

export function extractAddedIdentifierReferences(diffText, { maxBytes = 1_000_000, maxCandidates = 64 } = {}) {
  const diff = String(diffText || '');
  if (!diff || Buffer.byteLength(diff, 'utf8') > maxBytes) return { references: [], files: [] };
  const added = [];
  const files = new Set();
  const state = { blockComment: false, quote: '' };
  let file = '';
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '').trim();
      state.blockComment = false; state.quote = '';
      if (file && file !== '/dev/null') files.add(file);
      continue;
    }
    if (!file || !raw.startsWith('+') || raw.startsWith('+++')) continue;
    const code = stripAddedLineNoise(raw.slice(1), state, file);
    if (code.trim()) added.push({ file, code });
  }

  const declared = new Set();
  const declarationRe = /\b(?:class|struct|interface|enum|trait|type|typealias|func|fn|function|def|const|let|var|module|namespace)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const { code } of added) {
    for (const match of code.matchAll(declarationRe)) declared.add(match[1]);
    for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:=/g)) declared.add(match[1]);
    const typedAssignment = code.match(/^\s*(?:(?:public|private|protected|internal|static|final|readonly|volatile|extern)\s+)*(?:[A-Za-z_][\w<>,?.:\[\]]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (typedAssignment) declared.add(typedAssignment[1]);
    const method = code.match(/^\s*(?:(?:public|private|protected|internal|static|final|override|async)\s+)*(?:[A-Za-z_][\w<>,?.:\[\]]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*(?:\{|=>|:)/);
    if (method) declared.add(method[1]);
    if (/^\s*(?:import|from|use|using)\b/.test(code)) {
      for (const match of code.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) declared.add(match[0]);
    }
  }

  const references = [];
  const seen = new Set();
  const add = ref => {
    if (references.length >= maxCandidates || declared.has(ref.name) || seen.has(ref.name)) return;
    seen.add(ref.name); references.push(ref);
  };
  for (const { file: sourceFile, code } of added) {
    const qualifiedRanges = [];
    for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:(?:\.|::)[A-Za-z_][A-Za-z0-9_]*)+)\b/g)) {
      const display = match[1];
      const parts = display.split(/\.|::/);
      const name = parts.at(-1);
      qualifiedRanges.push([match.index, match.index + display.length]);
      if (highSignalIdentifier(name)) add({ name, display, qualifier: parts[0], file: sourceFile });
    }
    for (const match of code.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
      const start = match.index;
      if (qualifiedRanges.some(([a, b]) => start >= a && start < b)) continue;
      const name = match[0];
      if (highSignalIdentifier(name)) add({ name, display: name, qualifier: null, file: sourceFile });
    }
  }
  return { references, files: [...files] };
}

export function buildUnresolvedIdentifierWarning(diffText, resolveNames, { enabled = false, maxWarnings = 3 } = {}) {
  if (enabled !== true) return '';
  if (typeof resolveNames !== 'function') return '';
  const extracted = extractAddedIdentifierReferences(diffText);
  if (!extracted.references.length) return '';
  const names = [...new Set(extracted.references.flatMap(ref =>
    ref.qualifier ? [ref.name, ref.qualifier] : [ref.name]))];
  const rows = resolveNames(names, { files: extracted.files });
  if (!Array.isArray(rows)) return '';
  const resolved = new Set(rows.map(row => row?.name).filter(Boolean));
  const missing = extracted.references.filter(ref =>
    !resolved.has(ref.name) && (!ref.qualifier || resolved.has(ref.qualifier)));
  if (!missing.length) return '';
  const shown = missing.slice(0, Math.max(1, maxWarnings)).map(ref => ref.display);
  const more = missing.length > shown.length ? ` (+${missing.length - shown.length} more)` : '';
  return `[run_tests diff-check] WARNING: added identifier not found in symbol index: ${shown.join(', ')}${more}`.slice(0, 180);
}

// ---- L2 (b) targeted single-test mode -------------------------------------------
// Sanitize an agent-supplied test pattern: strip ALL shell metacharacters (same
// posture as the legacy makeRunTests rawArgs scrub) so a pattern can never inject.
export function sanitizeTestPattern(s) {
  return String(s || '').replace(/[^A-Za-z0-9_.:*/\- ]/g, '').trim().slice(0, 120);
}

// Recognize the runner in a test command and, ONLY when the command is a single
// simple invocation (no pipes / && / ; — appending a filter flag would otherwise
// corrupt a chain), return the filtered command. Otherwise return null → caller
// runs the full suite and notes the pattern was ignored (graceful degrade).
//
// A FILE PATH is not a name filter (2026-09-29, mwouts__jupytext-360): `run_tests
// tests/test_black.py` became `pytest ... -k 'tests/test_black.py'`, which matches no test
// name ("452 deselected / 0 selected", exit 5). pytest keywords include the module name, so a
// path (or `path::test` node id) is narrowed to its stem (or the node's last segment); jest
// takes a path as its positional test-path pattern. Any other runner cannot filter by file
// through its name flag (go -run, mocha --grep, ... would select nothing and exit 0), so the
// call degrades to the full suite with a note.
const PATH_LIKE_RE = /\/|::|\.(?:py|js|jsx|ts|tsx|mjs|cjs|go|rs|rb|php|java|kt|cs|swift|lua|ex|exs)$/;
export function applyTestPattern(testScript, rawPattern) {
  const pattern = sanitizeTestPattern(rawPattern);
  if (!pattern) return { cmd: testScript, applied: false, reason: 'empty pattern' };
  const compound = /[|;&]|&&|\btail\b|\bhead\b|\bfind\b/.test(testScript);
  if (compound) return { cmd: testScript, applied: false, reason: 'compound/piped command not safely filterable' };
  const s = testScript;
  const pytest = /\bpython\b.*-m\s+pytest\b|\bpytest\b/.test(s);
  if (PATH_LIKE_RE.test(pattern)) {
    if (pytest) {
      const node = pattern.includes('::') ? pattern.split('::').filter(Boolean).pop() : '';
      const stem = node || pathStem(pattern);
      if (stem) return { cmd: `${s} -k ${shq(stem)}`, applied: true, reason: `targeted: ${stem} (from ${pattern})` };
    } else if (/\bjest\b/.test(s)) {
      return { cmd: `${s} ${shq(pattern)}`, applied: true, reason: `targeted: ${pattern}` };
    }
    return { cmd: testScript, applied: false, reason: 'a test file path cannot be targeted for this runner' };
  }
  let filtered = null;
  if (pytest) filtered = `${s} -k ${shq(pattern)}`;
  else if (/\bgo test\b/.test(s)) filtered = `${s} -run ${shq(pattern)}`;
  else if (/\bmocha\b/.test(s)) filtered = `${s} --grep ${shq(pattern)}`;
  else if (/\bjest\b/.test(s)) filtered = `${s} -t ${shq(pattern)}`;
  else if (/\bphpunit\b/.test(s)) filtered = `${s} --filter ${shq(pattern)}`;
  else if (/dotnet test\b/.test(s)) filtered = `${s} --filter ${shq(pattern)}`;
  // cargo's filter is POSITIONAL (before `--`), unsafe to append → degrade to full.
  if (!filtered) return { cmd: testScript, applied: false, reason: 'runner not supported for targeting' };
  return { cmd: filtered, applied: true, reason: `targeted: ${pattern}` };
}

function shq(x) { return "'" + String(x).replace(/'/g, "'\\''") + "'"; }
function pathStem(p) { return String(p).split('/').filter(Boolean).pop()?.replace(/\.[A-Za-z]+$/, '') || ''; }

// The agent's run_tests argv → the ONE test pattern. `run_tests -k pipe` used to take `-k`
// itself as the pattern (pytest then got `-k '-k'` and exited with a usage error). A leading
// runner name-filter flag now yields its value; any other option is dropped with a note —
// run_tests never passes runner options through.
const SELECTOR_FLAGS = new Set(['-k', '-t', '--testNamePattern', '--grep', '-g', '-run', '--run', '--filter']);
export function testPatternFromArgv(argv) {
  const list = (Array.isArray(argv) ? argv : [argv]).map(a => String(a ?? '').trim()).filter(Boolean);
  const [first = '', second = ''] = list;
  if (!first) return { pattern: '', ignored: '' };
  const eq = /^(--?[A-Za-z][\w-]*)=(.+)$/.exec(first);
  if (eq && SELECTOR_FLAGS.has(eq[1])) return { pattern: eq[2], ignored: '' };
  if (SELECTOR_FLAGS.has(first)) return second ? { pattern: second, ignored: '' } : { pattern: '', ignored: first };
  if (first.startsWith('-')) return { pattern: '', ignored: first };
  return { pattern: first, ignored: '' };
}
