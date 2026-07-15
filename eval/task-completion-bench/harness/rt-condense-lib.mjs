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
export const FAILURE_INDICATOR_RE =
  /(FAILED|FAIL:|FAIL\b|not ok |AssertionError|panicked at|thread '[^']*' panicked|[0-9]+ tests? failed|[0-9]+ (?:failing|failures)|[Ee]rror:|error\[|Exception\b|Traceback|--- FAIL|✗|✘|×|Test Failed|Failure \(|SEGFAULT|Segmentation fault|core dumped|assert(?:ion)? failed|expected .* but| FAILED\b)/;

// Negative guard: lines that MENTION failure vocabulary but report ZERO failures
// (a green summary) must NOT be promoted or counted as failures.
export const FAILURE_NEGATIVE_RE =
  /(0 fail|failures?: 0|failed: 0|: 0 error|0 error|no failures|all tests passed|0 failing)/i;

// Infra / harness-error markers: when the CURRENT run is an infra failure (lockdown
// network, broker timeout, docker error) rather than real test failures, baseline
// labeling is suppressed entirely — those "failures" are not the agent's tests.
export const INFRA_ERROR_RE =
  /(NETWORK UNAVAILABLE|no response from test broker|\[run_tests exit=|Could not resolve|Temporary failure in name resolution|Network is unreachable|Cannot connect to the Docker daemon|docker: Error)/;

// Aggregate SUMMARY-count lines ("2 tests failed", "Failures: 1", "1 failed, 600
// passed"). These are useful to PROMOTE in the condenser (they carry the count) but
// must NOT become per-test failure SIGNATURES — the count varies run to run, so a
// summary would spuriously differ between baseline and current and pollute the diff.
export const SUMMARY_COUNT_RE =
  /^\s*(?:\d+\s+(?:tests?\s+)?(?:failed|failing|failures)\b|failures?:\s*\d+|tests?:?\s*\d+\s+failed|\d+\s+failed,\s*\d+\s+passed|Ran\s+\d+\s+tests?\b)/i;

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const LEADING_TIMESTAMP_RE = /^\s*(?:\[(?:\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?)\]|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+/;
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
  s = s.replace(/^\s*(?:✗|✘|×|-|\*|•)\s*/, '');                               // bullet markers
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
  for (const rawLine of t.split('\n')) {
    const line = stripVolatileFailurePrefix(stripAnsi(rawLine));
    if (!isFailureLine(line)) continue;
    if (SUMMARY_COUNT_RE.test(line)) continue;   // aggregate count, not a per-test signature
    const sig = normalizeFailureSignature(line);
    if (GENERIC_BUILD_FAILURE_RE.test(sig)) continue;
    if (sig.length >= 6) sigs.add(sig);   // drop trivially-short signatures (collision guard)
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

// ---- Conditional diff identifier signal ---------------------------------------
// This deliberately extracts only high-confidence code-shaped references. The
// symbol index is the authority for whether they resolve; prose/string/comment
// tokens and identifiers declared by the same diff never become warnings.
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

export function buildUnresolvedIdentifierWarning(diffText, resolveNames, { maxWarnings = 3 } = {}) {
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
export function applyTestPattern(testScript, rawPattern) {
  const pattern = sanitizeTestPattern(rawPattern);
  if (!pattern) return { cmd: testScript, applied: false, reason: 'empty pattern' };
  const compound = /[|;&]|&&|\btail\b|\bhead\b|\bfind\b/.test(testScript);
  if (compound) return { cmd: testScript, applied: false, reason: 'compound/piped command not safely filterable' };
  const s = testScript;
  let filtered = null;
  if (/\bpython\b.*-m\s+pytest\b|\bpytest\b/.test(s)) filtered = `${s} -k ${shq(pattern)}`;
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
