// Pure argument-parsing helpers for the ss-* CLI wrappers.
//
// Extracted from _ss-helpers.mjs so they can be unit-tested without triggering
// the CLI's top-level IIFE (which runs on import). NOTHING here touches
// process.* or the filesystem — every function is a pure transform over an
// args array (some mutate the array in place, by design, and return a value).

// --- value-flag parsers (mutate `args`, returning the consumed value) --------

export function parseFlag(args, name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

export function parseShortFlag(args, names, fallback) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) { const v = args[i + 1]; args.splice(i, 2); return v; }
  }
  return fallback;
}

// Boolean (value-less) flag: remove every occurrence, return whether any present.
export function parseBoolFlag(args, names) {
  let present = false;
  for (const n of names) {
    let i;
    while ((i = args.indexOf(n)) !== -1) { args.splice(i, 1); present = true; }
  }
  return present;
}

// --- pattern construction ----------------------------------------------------

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Translate the grep-family pattern flags into a single regex — no engine change
// needed. `-F` escapes the pattern so metacharacters are literal; `-w` wraps it
// in word boundaries; `-i` prepends the `(?i)` inline flag the planner already
// honours end-to-end (hasCaseInsensitiveRegexFlag → ripgrep prefilter + Rust
// gram+grep). Order matters: escape (literal) → word-wrap → case flag.
export function buildGrepPattern(pattern, { ignoreCase = false, wordBound = false, fixedString = false } = {}) {
  if (!pattern) return pattern;
  let p = fixedString ? escapeRegex(pattern) : pattern;
  if (wordBound) p = `\\b(?:${p})\\b`;
  if (ignoreCase && !/^\(\?[a-z-]*i[a-z-]*[:)]/.test(p)) p = `(?i)${p}`;
  return p;
}

// --- inert flags (always true for ss-*, safe to accept as no-ops) ------------
// These never change which lines match: we always print file:line, always
// search the whole index, never colourise. Stripping them lets reflexive grep
// muscle-memory pass without a wasted call — UNLIKE semantic flags (-w/-F/-v/
// -C…), which we either implement or reject, never silently drop.
export const INERT_FLAGS = new Set([
  '-n', '--line-number', '-H', '--with-filename', '--no-filename',
  '-r', '-R', '--recursive', '--color', '--colour',
]);

export function stripInertFlags(args) {
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i];
    if (typeof a === 'string' && (INERT_FLAGS.has(a) || /^--colou?r=/.test(a))) {
      args.splice(i, 1);
    }
  }
}

// --- normalisation: make agent-typed forms canonical before parsing ----------
// Short flags that consume a following value, and value-less boolean shorts.
// Used to split attached/bundled forms (-k5, -iw, -iwk5) the way getopt would,
// so they parse instead of being mistaken for an unknown flag or the pattern.
export const VALUE_SHORTS = new Set(['k', 'A', 'B', 'C']);
const CONTEXT_SHORTS = new Set(['A', 'B', 'C']);
export const BOOL_SHORTS = new Set(['i', 'w', 'F']);
export const VALUE_LONGS = new Set([
  '--top', '--regex', '--mode', '--max-tokens',
  '--in', '--file', '--query', '--hint', '--depth', '--budget',
  '--after-context', '--before-context', '--context',
  '--glob', '--include', '--exclude', '--exclude-dir',
]);

export function normalizeArgs(args) {
  const out = [];
  let positionalOnly = false;
  for (const tok of args) {
    if (positionalOnly || typeof tok !== 'string') { out.push(tok); continue; }
    if (tok === '--') { out.push(tok); positionalOnly = true; continue; }

    // --name=value  →  --name value, but only for known value flags. Unknown
    // long options stay intact so the guard can reject the whole token, and
    // optional-value no-ops like --color=always can be stripped atomically.
    let m = /^(--[A-Za-z][\w-]*)=(.*)$/.exec(tok);
    if (m && VALUE_LONGS.has(m[1])) { out.push(m[1], m[2]); continue; }

    // attached short value or boolean bundle:  -k5, -iw, -iwk5
    m = /^-([A-Za-z])(.+)$/.exec(tok);
    if (m) {
      const first = m[1];
      if (VALUE_SHORTS.has(first)) {
        // -k5 → -k 5. A grep context flag splits only before a count (-A3): `-A.*foo` and
        // `-C++` are dash-leading patterns/queries and stay whole, as they did before -A/-B/-C.
        if (!CONTEXT_SHORTS.has(first) || /^\d+$/.test(m[2])) { out.push('-' + first, m[2]); continue; }
        out.push(tok); continue;
      }
      if (BOOL_SHORTS.has(first)) {
        const chars = tok.slice(1);
        const expanded = [];
        let i = 0, ok = true;
        while (i < chars.length) {
          const ch = chars[i];
          if (BOOL_SHORTS.has(ch)) { expanded.push('-' + ch); i++; }
          else if (VALUE_SHORTS.has(ch)) {                 // value short ends the bundle
            const val = chars.slice(i + 1);
            if (CONTEXT_SHORTS.has(ch) && val && !/^\d+$/.test(val)) { ok = false; break; }
            expanded.push('-' + ch);
            if (val) expanded.push(val);
            i = chars.length;
          } else { ok = false; break; }                    // unknown char → leave token intact
        }
        if (ok) { out.push(...expanded); continue; }
      }
    }
    out.push(tok);
  }
  return out;
}

// A token that looks like a real CLI option, as opposed to a regex/query that
// merely begins with '-' (e.g. `-?\d+`, `-->`). Narrow on purpose: single short
// letter, pure-letter bundle, or GNU long flag. Anything containing regex
// metacharacters falls through and is treated as the positional pattern, so a
// dash-leading pattern works WITHOUT the agent needing to know about `--`.
export function looksLikeOption(tok) {
  if (typeof tok !== 'string' || tok === '-' || tok === '--') return false;
  return /^-[A-Za-z][A-Za-z0-9]*$/.test(tok)      // -i, -iw, -C2
    || /^--[A-Za-z][\w-]*(?:=.*)?$/.test(tok);    // --ignore-case, --foo=bar
}

export function parseValueFlag(args, names, fallback, { allowOptionValue = false } = {}) {
  const allNames = Array.isArray(names) ? names : [names];
  for (const n of allNames) {
    const i = args.indexOf(n);
    if (i === -1) continue;
    const v = args[i + 1];
    if (v == null || (!allowOptionValue && looksLikeOption(v))) {
      return { value: fallback, flag: n, error: `${n} requires a value` };
    }
    args.splice(i, 2);
    return { value: v, flag: n, error: null };
  }
  return { value: fallback, flag: null, error: null };
}

// Repeatable value flag: `--in A --in B` yields ['A','B']. Every occurrence is
// consumed, in the order given, de-duplicated.
//
// parseValueFlag keeps only the FIRST occurrence and leaves the rest in `args`,
// where they fall through to the positional extractor and vanish. That silent
// drop is the dashbitco/nimble_options defect: the agent scoped one call to two
// paths, the header echoed back only the first, and the dropped file held the
// exact-string assertion that decided the task. A scope that disappears is
// indistinguishable from a regex that genuinely misses.
export function parseRepeatedValueFlag(args, names) {
  const allNames = Array.isArray(names) ? names : [names];
  const values = [];
  let flag = null;
  for (;;) {
    let at = -1;
    let matched = null;
    const separator = args.indexOf('--');
    const optionEnd = separator === -1 ? args.length : separator;
    for (const n of allNames) {
      const i = args.indexOf(n);
      if (i !== -1 && i < optionEnd && (at === -1 || i < at)) { at = i; matched = n; }
    }
    if (at === -1) break;
    flag ??= matched;
    const v = args[at + 1];
    if (v == null || v === '' || v === '--' || looksLikeOption(v)) {
      return { values: [], flag: matched, error: `${matched} requires a value` };
    }
    args.splice(at, 2);
    if (!values.includes(v)) values.push(v);
  }
  return { values, flag, error: null };
}

// ss-grep / ss-find path globs, ripgrep's `-g` plus the grep-habit aliases, in the order
// given, each rewritten into one rg-style glob (core/search/grep-path-globs.js):
//
//   -g G, --glob G     G           (`!G` excludes)
//   --include G        G           (grep: search only files matching G)
//   --exclude G        !G          (grep: skip files matching G)
//   --exclude-dir D    !D/         (grep: skip directories named D, at any depth)
//
// normalizeArgs has already split `--glob=G` and friends. `-gG` (rg's attached form, e.g.
// `-g'!tests/**'` → the token `-g!tests/**`) is taken only when G looks like a glob or a
// path (`! * ? [ { /` or a leading `.`), so a dash-leading pattern such as `-gzip x` is not
// read as a glob. The value is consumed whatever it starts with (`!lib/tests/**`, `*.h`);
// a missing value, `--`, or an option-shaped token is an error, never a silent drop.
// Options end at `--`. Returns { globs, error }.
const GLOB_FLAG_KIND = new Map([
  ['-g', 'glob'], ['--glob', 'glob'],
  ['--include', 'include'], ['--exclude', 'exclude'], ['--exclude-dir', 'excludeDir'],
]);
const ATTACHED_GLOB = /^-g([!*?[{/.].*|.*[*?[{/].*)$/;
export function parseGlobFlags(args) {
  const globs = [];
  const add = (g) => { if (!globs.includes(g)) globs.push(g); };
  for (let i = 0; i < args.length;) {
    const tok = args[i];
    if (tok === '--') break;
    if (typeof tok !== 'string') { i++; continue; }
    const attached = ATTACHED_GLOB.exec(tok);
    if (attached) { add(attached[1]); args.splice(i, 1); continue; }
    const kind = GLOB_FLAG_KIND.get(tok);
    if (!kind) { i++; continue; }
    const v = args[i + 1];
    if (typeof v !== 'string' || v === '' || v === '--' || looksLikeOption(v)) {
      return { globs: [], error: `${tok} requires a value (a glob such as '*.h' or '!tests/**')` };
    }
    let glob;
    if (kind === 'exclude') glob = `!${v}`;
    else if (kind === 'excludeDir') {
      const dir = v.replace(/\/+$/, '');
      if (dir === '' || dir === '.') return { globs: [], error: `${tok} needs a directory name, not "${v}"` };
      glob = `!${dir}/`;
    } else glob = v;
    if (glob === '!' || /^!?\/*$/.test(glob)) return { globs: [], error: `${tok} "${v}" is an empty glob` };
    add(glob);
    args.splice(i, 2);
  }
  return { globs, error: null };
}

// Bare positionals beyond the first, once every known flag has been consumed.
// The first is the pattern/query; anything after it was silently discarded, so
// callers that can mean something by it must say so out loud. Option-shaped
// tokens are left to extractPositional, which already reports them.
export function extraPositionals(args) {
  const sep = args.indexOf('--');
  const scan = sep === -1 ? args : args.slice(sep + 1);
  return scan.filter(tok => !looksLikeOption(tok) && tok !== '--').slice(1);
}

// grep's context flags: -A N / -B N / -C N and --after-context / --before-context /
// --context (normalizeArgs has already split -A3, -iC2 and --context=2). Every
// occurrence is consumed and the last one of each kind wins, as in grep; an
// explicit -A or -B wins over -C whatever the order (GNU grep's rule). Options end
// at `--`. Returns { before, after, error } with 0/0 when no flag was given.
const CONTEXT_FLAG_KIND = new Map([
  ['-A', 'after'], ['--after-context', 'after'],
  ['-B', 'before'], ['--before-context', 'before'],
  ['-C', 'both'], ['--context', 'both'],
]);
export function parseContextFlags(args) {
  const seen = { after: null, before: null, both: null };
  for (let i = 0; i < args.length;) {
    const tok = args[i];
    if (tok === '--') break;
    const kind = CONTEXT_FLAG_KIND.get(tok);
    if (!kind) { i++; continue; }
    const v = args[i + 1];
    if (typeof v !== 'string' || !/^\d+$/.test(v)) {
      return { before: 0, after: 0, error: `${tok} requires a line count (a non-negative integer)` };
    }
    seen[kind] = Number(v);
    args.splice(i, 2);
  }
  return {
    before: seen.before ?? seen.both ?? 0,
    after: seen.after ?? seen.both ?? 0,
    error: null,
  };
}

export function parsePositiveIntFlag(args, names, fallback, { min = 1 } = {}) {
  const parsed = parseValueFlag(args, names, fallback);
  if (parsed.error) return parsed;
  if (parsed.flag == null) return { ...parsed, value: fallback };
  const n = Number(parsed.value);
  if (!Number.isInteger(n) || n < min) {
    return { value: fallback, flag: parsed.flag, error: `${parsed.flag} must be an integer >= ${min}` };
  }
  return { value: n, flag: parsed.flag, error: null };
}

// Parse a line range supplied as a single positional token — `10-20`, `10:20`
// or `10,20` (sed/bat/"lines 10-20" muscle memory). Returns { start, end } only
// for a well-formed ascending range; null otherwise (so the caller falls back to
// the plain numeric path or its own validation). Deliberately strict: both ends
// required, no open-ended `10-` (which previously caused accidental over-reads).
export function parseLineRange(token) {
  if (typeof token !== 'string') return null;
  const m = /^(\d+)[-:,](\d+)$/.exec(token);
  if (!m) return null;
  const start = +m[1];
  const end = +m[2];
  if (start < 1 || end < start) return null;
  return { start, end };
}

// After known flags are consumed, resolve the positional pattern. `--` ends
// option parsing (everything after is positional). Any remaining option-shaped
// token is an unsupported flag → reported, not silently dropped and not
// mistaken for the pattern. Returns { pattern, unknownFlag }; the caller decides
// how to surface the error (kept side-effect-free for testability).
export function extractPositional(args) {
  const sep = args.indexOf('--');
  if (sep !== -1) {
    const before = args.slice(0, sep);
    const after = args.slice(sep + 1);
    const bad = before.find(looksLikeOption);
    if (bad) return { pattern: undefined, unknownFlag: bad };
    return { pattern: after[0], unknownFlag: null };
  }
  const bad = args.find(looksLikeOption);
  if (bad) return { pattern: undefined, unknownFlag: bad };
  return { pattern: args[0], unknownFlag: null };
}

// --- trailer rendering --------------------------------------------------------

// Sufficiency trailer segment: 3-valued verdict (YES / no / unknown) + a
// compact why-token, e.g. ` sufficient=YES (query_evidence_clear_margin)` vs
// ` sufficient=unknown (well_formed_only)`. Falls back to the legacy boolean
// when the engine predates sufficiencyVerdict. The full line shape stays
// `# confidence=<bucket> (<reason>) sufficient=<verdict> (<why>)`.
// One implementation, shared with the daemon's compact agent text (core/search/agent-output-fixes.js).
export { renderSufficiencyFragment as renderSufficiency } from '../../../core/search/agent-output-fixes.js';

// Reinterpret bare positionals AFTER the pattern as `--in` scopes when they name
// a real path. Grep muscle memory writes `ss-grep "pat" src/foo` with the scope
// as a bare positional; rejecting the whole call wastes a turn when the token is
// unambiguously a path. The first bare positional stays the pattern. Absorbed
// tokens are spliced out of `args` and pushed onto `inPaths`. `isPath(token)`
// decides membership — injected so this pure arg logic is testable without a
// filesystem. A non-path bareword is left in place for rejectExtraPositionals.
export function absorbPositionalPaths(args, inPaths, isPath) {
  let seenPattern = false;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (typeof tok !== 'string' || tok === '--' || looksLikeOption(tok)) continue;
    if (!seenPattern) { seenPattern = true; continue; }   // this is the pattern/query
    if (isPath(tok)) { inPaths.push(tok); args.splice(i, 1); i--; }
  }
}
