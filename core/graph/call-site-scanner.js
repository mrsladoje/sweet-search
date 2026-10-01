/**
 * Call-site scanner for the code graph.
 *
 * The graph extractor finds `calls` edges with per-line regexes (tree-sitter
 * only supplies definitions). The original single regex `(\w+)\s*\.\s*(\w+)\s*\(`
 * missed whole call shapes and matched text inside comments:
 *
 *   - optional / forced member access: `broker?.notify(`, `x!.y(`, `a!!.b(`,
 *     Ruby `a&.b(`, PHP 8 `$a?->b(`
 *   - generic / turbofish calls: `repo.find<User>(`, `it.collect::<Vec<_>>(`
 *   - chained calls: `db.makeStatement(sql).execute(` (only `makeStatement` was seen)
 *   - leading-dot continuation lines (`.filter(` under `items`) and Go-style
 *     trailing-dot lines (`client.` / `Do(req)`)
 *   - path calls: Rust `Type::new(`, C++ `ns::fn(`, C `ptr->fn(`
 *   - Swift / Kotlin trailing-closure calls: `dbQueue.write { db in`
 *   - comment lines produced false edges (`// see Foo.bar()`).
 *
 * One scanner instance holds per-file state (block comment, previous line's
 * tail for continuation lines); call `reset()` before each file.
 *
 * Target names keep the historical `obj.method` shape so resolution, ss-trace
 * name patterns and trust checks need no change. A chained call whose
 * receiver is the result of another call is emitted as `prev().method`.
 *
 * Cost: one `indexOf('(')`/`indexOf('{')` prefilter per line, precompiled
 * global regexes cached per language, comment parsing only on lines that
 * contain a comment token.
 */

const QUOTE_DOUBLE = '"';

// Member-access separators per language. `.` is NOT a call separator in PHP
// (string concatenation: `$a . strtolower($b)`).
const DEFAULT_SEPARATORS = ['.', '?.', '!.', '!!.'];
const SEPARATORS_BY_LANGUAGE = {
  php: ['->', '?->', '::'],
  c: ['.', '->'],
  cpp: ['.', '->', '::'],
  rust: ['.', '::'],
  ruby: ['.', '&.'],
};

// Languages where `'…'` delimits strings (so quote parity must count it when
// deciding whether a comment token sits inside a string literal). In the rest
// `'` is a char literal or a lifetime and would break parity.
const SINGLE_QUOTE_STRING_LANGUAGES = new Set([
  'javascript', 'typescript', 'tsx', 'python', 'php', 'ruby', 'dart', 'groovy',
]);
const BACKTICK_STRING_LANGUAGES = new Set(['javascript', 'typescript', 'tsx', 'go']);

// Extra comment syntax the registry's single `comment.line` entry omits.
const EXTRA_LINE_COMMENTS = { php: ['#'] };
const EXTRA_BLOCK_COMMENTS = { python: [["'''", "'''"]] };

// Trailing-closure call syntax (`a.b { … }` is a call). Elsewhere `x.Y {`
// is a composite literal (Go) or a block, not a call.
const TRAILING_CLOSURE_LANGUAGES = new Set(['swift', 'kotlin']);
// Control-flow lines: `if a.b {` / `for x in a.b {` read a property; the
// brace opens the statement's block, not a closure.
const TRAILING_CLOSURE_SKIP_LINE =
  /^(?:\}\s*)?(?:else\s+)?(?:if|guard|while|for|switch|when|repeat|catch|case|where)\b/;
// A declaration keyword before `Foo.Bar {` makes it a type (`extension
// Foo.Bar {`, `class A: B, C.D {`), not a call.
const TRAILING_CLOSURE_DECL_BEFORE =
  /\b(?:class|struct|enum|extension|protocol|interface|object|actor|func|fun|init|subscript|typealias|import)\b/;

// Definition lines that look like qualified calls:
//   Kotlin `fun String.trimSlash(` / Scala `def Foo.bar(` — extension definitions;
//   C++ `void Foo::bar(int x) {` / `Foo::Foo(…) : a_(x)` — out-of-line methods.
// `before` is the code before the match on the same line.
const CPP_TYPE_PREFIX = /^[\w:<>,*&\s]*[\w>*&]$/;
const CPP_EXPR_KEYWORD_END = /\b(?:return|co_return|co_yield|co_await|throw|new|delete|else|case|goto|sizeof|typeid|not|and|or|xor)$/;
const DEFINITION_GUARDS = {
  kotlin: (before) => /\bfun\s+$/.test(before),
  scala: (before) => /\bdef\s+$/.test(before),
  cpp: (before, owner, name) => {
    if (owner === name || name === `~${owner}`) return true; // ctor/dtor
    const b = before.trimEnd();
    return b.length > 0 && CPP_TYPE_PREFIX.test(b) && !CPP_EXPR_KEYWORD_END.test(b);
  },
};

// Optional generic arguments between a method name and `(`: `<T>`,
// `<Map<K, V>>` (one nesting level), Rust turbofish `::<Vec<_>>`.
const GENERIC_ARGS = String.raw`(?:\s*(?:::)?\s*<[^()<>;]*(?:<[^()<>;]*>[^()<>;]*)*>)?`;

// ── Bare calls (`helper(x)`: a name called with no receiver) ───────────────
// Reserved words that can precede `(` but never name a callable. Closed,
// per-language sets (language keywords), not a capture-filter stopword list:
// builtins (`len`, `print`, `setTimeout`) are left to resolution, which only
// links a bare call to a definition the caller can see.
const KW_C_FAMILY = ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'sizeof', 'catch', 'try', 'throw', 'new', 'delete', 'goto'];
const BARE_KEYWORDS_BY_LANGUAGE = {
  c: [...KW_C_FAMILY, 'alignof', '_Alignof', 'offsetof', 'defined', '__attribute__', '__declspec', 'asm', '__asm__', '_Generic', 'typeof', '__typeof__', 'static_assert', '_Static_assert'],
  cpp: [...KW_C_FAMILY, 'alignof', 'offsetof', 'defined', '__attribute__', 'decltype', 'static_assert', 'noexcept', 'typeid', 'co_await', 'co_return', 'co_yield', 'requires', 'operator', 'template', 'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast', 'asm', 'catch'],
  objc: [...KW_C_FAMILY, 'defined', '__attribute__', 'typeof', '@selector', 'synchronized'],
  java: [...KW_C_FAMILY, 'synchronized', 'assert', 'super', 'this', 'instanceof'],
  csharp: [...KW_C_FAMILY, 'foreach', 'using', 'lock', 'fixed', 'checked', 'unchecked', 'typeof', 'nameof', 'default', 'base', 'this', 'when', 'stackalloc', 'await', 'in', 'is', 'as'],
  javascript: [...KW_C_FAMILY, 'typeof', 'void', 'await', 'yield', 'function', 'super', 'import', 'in', 'of', 'instanceof', 'with', 'async'],
  typescript: [...KW_C_FAMILY, 'typeof', 'void', 'await', 'yield', 'function', 'super', 'import', 'in', 'of', 'instanceof', 'with', 'async', 'keyof', 'satisfies', 'as', 'is', 'asserts', 'infer'],
  python: ['if', 'elif', 'else', 'for', 'while', 'return', 'yield', 'await', 'assert', 'del', 'not', 'and', 'or', 'in', 'is', 'lambda', 'with', 'except', 'raise', 'print', 'exec', 'from', 'import', 'match', 'case', 'super'],
  ruby: ['if', 'elsif', 'unless', 'while', 'until', 'for', 'case', 'when', 'return', 'yield', 'defined?', 'not', 'and', 'or', 'in', 'super', 'raise', 'rescue', 'puts', 'p', 'lambda', 'proc', 'loop', 'require', 'require_relative'],
  go: ['if', 'for', 'switch', 'case', 'return', 'go', 'defer', 'select', 'func', 'range', 'make', 'new', 'len', 'cap', 'append', 'copy', 'delete', 'panic', 'recover', 'print', 'println', 'complex', 'real', 'imag', 'close', 'min', 'max', 'clear'],
  rust: ['if', 'else', 'for', 'while', 'loop', 'match', 'return', 'in', 'as', 'move', 'unsafe', 'await', 'Some', 'Ok', 'Err', 'Box', 'Vec'],
  swift: ['if', 'else', 'for', 'while', 'repeat', 'switch', 'case', 'return', 'guard', 'defer', 'catch', 'try', 'throw', 'await', 'in', 'is', 'as', 'where', 'init', 'super', 'self', 'Self', 'type', 'unowned', 'weak', 'some', 'any', 'precondition', 'assert', 'fatalError', 'print'],
  kotlin: ['if', 'else', 'for', 'while', 'when', 'return', 'throw', 'try', 'catch', 'in', 'is', 'as', 'super', 'this', 'constructor', 'init', 'by', 'where', 'get', 'set', 'listOf', 'mapOf', 'setOf', 'arrayOf', 'println', 'print', 'require', 'check', 'error', 'TODO', 'lazy', 'run', 'let', 'also', 'apply', 'with', 'repeat'],
  scala: ['if', 'else', 'for', 'while', 'match', 'case', 'return', 'throw', 'try', 'catch', 'yield', 'new', 'super', 'this', 'println', 'print', 'require', 'assert'],
  php: ['if', 'elseif', 'else', 'for', 'foreach', 'while', 'switch', 'case', 'return', 'catch', 'throw', 'new', 'array', 'list', 'isset', 'unset', 'empty', 'eval', 'exit', 'die', 'echo', 'print', 'include', 'include_once', 'require', 'require_once', 'fn', 'function', 'match', 'clone', 'instanceof', 'parent', 'self', 'static'],
  dart: [...KW_C_FAMILY, 'assert', 'await', 'yield', 'super', 'this', 'is', 'as', 'in', 'print'],
  groovy: [...KW_C_FAMILY, 'assert', 'super', 'this', 'in', 'as', 'println', 'print'],
  lua: ['if', 'elseif', 'while', 'for', 'until', 'return', 'and', 'or', 'not', 'in', 'function', 'local', 'require', 'print', 'pairs', 'ipairs', 'type', 'tostring', 'tonumber', 'error', 'assert', 'pcall', 'xpcall', 'select', 'setmetatable', 'getmetatable', 'rawget', 'rawset', 'next', 'unpack'],
  elixir: ['if', 'unless', 'case', 'cond', 'with', 'for', 'fn', 'quote', 'unquote', 'receive', 'try', 'raise', 'throw', 'def', 'defp', 'defmacro', 'defmacrop', 'defmodule', 'defstruct', 'defimpl', 'defprotocol', 'defguard', 'defdelegate', 'import', 'alias', 'require', 'use', 'when', 'and', 'or', 'not', 'in', 'is_nil', 'is_atom', 'is_binary', 'is_list', 'is_map', 'is_integer'],
  shell: ['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'return', 'local', 'echo', 'printf', 'test', 'exit'],
  zig: ['if', 'else', 'while', 'for', 'switch', 'return', 'try', 'catch', 'orelse', 'defer', 'errdefer', 'comptime', 'fn', 'and', 'or', 'struct', 'enum', 'union', 'error'],
  solidity: [...KW_C_FAMILY, 'require', 'assert', 'revert', 'emit', 'keccak256', 'sha256', 'abi', 'address', 'payable', 'uint', 'uint256', 'int', 'int256', 'bytes', 'bytes32', 'string', 'bool', 'type', 'modifier', 'function', 'event', 'mapping'],
  perl: ['if', 'elsif', 'else', 'unless', 'while', 'until', 'for', 'foreach', 'return', 'my', 'our', 'local', 'sub', 'and', 'or', 'not', 'print', 'printf', 'push', 'pop', 'shift', 'unshift', 'die', 'warn', 'defined', 'scalar', 'ref', 'keys', 'values', 'exists', 'delete', 'join', 'split', 'map', 'grep', 'sort', 'open', 'close', 'qw'],
  r: ['if', 'else', 'for', 'while', 'repeat', 'function', 'return', 'c', 'list', 'library', 'require', 'print', 'paste', 'paste0', 'stop', 'warning', 'is.null', 'length', 'names'],
  julia: ['if', 'elseif', 'else', 'for', 'while', 'return', 'function', 'begin', 'let', 'try', 'catch', 'macro', 'quote', 'in', 'isa', 'println', 'print', 'error', 'throw', 'typeof', 'length', 'push!'],
};
const BARE_KEYWORDS_DEFAULT = [...KW_C_FAMILY, 'function', 'func', 'fn', 'fun', 'def', 'await', 'yield', 'super', 'this', 'self', 'in', 'not', 'and', 'or'];
// Words that may stand right before a called name (`return helper(x)`).
// Any other identifier directly before the name means a declaration or a
// type: `def helper(`, `int helper(`, `static Foo* make(`, `fn new(`.
const CALL_PREFIX_WORDS = new Set([
  'return', 'await', 'yield', 'throw', 'else', 'case', 'in', 'not', 'and', 'or', 'do', 'then',
  'when', 'is', 'go', 'defer', 'try', 'echo', 'print', 'puts', 'raise', 'assert', 'if', 'elif',
  'elsif', 'unless', 'while', 'until', 'match', 'emit', 'co_await', 'co_return', 'co_yield', 'lambda',
  'orelse', 'catch',
]);
// Languages where `name(args) {` at statement start is a method definition
// (class / object-literal shorthand), not a call. Not Swift/Kotlin/Groovy/
// Scala/Ruby: there `name(args) { … }` is a call with a trailing closure.
const SHORTHAND_DEFINITION_LANGUAGES = new Set(['javascript', 'typescript', 'tsx', 'dart', 'java', 'csharp', 'cpp', 'c', 'objc', 'php']);
const SHORTHAND_DEFINITION = /^(?:(?:async|static|get|set|public|private|protected|internal|override|virtual|abstract|final|readonly|export|default)\s+|\*\s*)*(\w+)\s*(?:<[^()]*>)?\s*\([^]*\)\s*(?::\s*[^{]+)?\{?\s*$/;
// `#define FOO(x)` / `#if defined(X)` are preprocessor lines, not calls.
const PREPROCESSOR_LANGUAGES = new Set(['c', 'cpp', 'objc', 'csharp']);

const bareKeywordCache = new Map();
function bareKeywordsFor(language) {
  let set = bareKeywordCache.get(language);
  if (!set) {
    set = new Set(BARE_KEYWORDS_BY_LANGUAGE[language] || (language === 'tsx' ? BARE_KEYWORDS_BY_LANGUAGE.typescript : BARE_KEYWORDS_DEFAULT));
    bareKeywordCache.set(language, set);
  }
  return set;
}

/**
 * Blank the contents of single-line string literals (quotes kept) so call
 * shapes inside log messages and docs (`"usage: run(cmd)"`) are not read as
 * calls. Approximate: an unterminated quote blanks to the end of the line.
 */
function blankStrings(code, plan) {
  if (code.indexOf('"') === -1 && !(plan.countSingleQuote && code.indexOf("'") !== -1) && !(plan.countBacktick && code.indexOf('`') !== -1)) return code;
  let out = '';
  let quote = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code.charCodeAt(i);
    if (quote) {
      if (ch === 92 /* \ */) { out += '  '; i++; continue; }
      if (ch === quote) { quote = 0; out += code[i]; continue; }
      out += ' ';
      continue;
    }
    if (ch === 34 || (ch === 39 && plan.countSingleQuote) || (ch === 96 && plan.countBacktick)) quote = ch;
    out += code[i];
  }
  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sepAlternation(separators) {
  return [...separators]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
}

const planCache = new Map();

function buildPlan(language, langInfo) {
  const separators = SEPARATORS_BY_LANGUAGE[language] || DEFAULT_SEPARATORS;
  const sep = sepAlternation(separators);
  // Ruby bang methods: `record.save!(` / `record.save!` both call `save!`.
  // `!` must touch the name and not start `!=` (`x.y != z` is a comparison).
  const callOpen = language === 'ruby' ? String.raw`(?:\s*\(|!(?!=))` : String.raw`\s*\(`;

  const comment = langInfo?.comment || {};
  const lineTokens = [comment.line, ...(EXTRA_LINE_COMMENTS[language] || [])].filter(Boolean);
  const blockPairs = [];
  if (Array.isArray(comment.block) && comment.block[0] && comment.block[1]) {
    blockPairs.push([comment.block[0], comment.block[1]]);
  }
  for (const pair of EXTRA_BLOCK_COMMENTS[language] || []) blockPairs.push(pair);

  const hasDot = separators.includes('.');
  return {
    language,
    // obj SEP method [generics] (   — no space before SEP: `case .success(`,
    // `return .failure(` are Swift implicit-member expressions, not calls on
    // `case` / `return`.
    qualified: new RegExp(String.raw`\b(\w+)(?:${sep})\s*(\w+)${GENERIC_ARGS}${callOpen}`, 'g'),
    // prev( … ) SEP method [generics] (   — lookahead keeps `method(` available
    // for the next match so `a(x).b(y).c(` yields both `a().b` and `b().c`.
    chained: new RegExp(String.raw`\b(\w+)\s*\([^()]*\)\s*(?:${sep})\s*(?=(\w+)${GENERIC_ARGS}${callOpen})`, 'g'),
    // Continuation line: `.method(` / `?.method(` at line start.
    leading: new RegExp(String.raw`^(?:${sep})\s*(\w+)${GENERIC_ARGS}${callOpen}`),
    // Previous line ends with a receiver: `name`, `name(…)` or `name)` → tail.
    tail: /\b(\w+)\s*(\([^()]*\))?\s*[?!]*\s*$/,
    // Previous line ends with a separator (Go/Ruby/Python trailing-dot style).
    trailingSep: hasDot ? /\b(\w+)\s*\.\s*$/ : null,
    bareCallAtStart: new RegExp(String.raw`^(\w+)${GENERIC_ARGS}${callOpen}`),
    trailingClosure: TRAILING_CLOSURE_LANGUAGES.has(language)
      ? new RegExp(String.raw`\b(\w+)(?:${sep})\s*(\w+)\s*(?=\{)`, 'g')
      : null,
    leadingClosure: TRAILING_CLOSURE_LANGUAGES.has(language)
      ? new RegExp(String.raw`^(?:${sep})\s*(\w+)\s*(?=\{)`)
      : null,
    lineTokens,
    blockPairs,
    countSingleQuote: SINGLE_QUOTE_STRING_LANGUAGES.has(language),
    countBacktick: BACKTICK_STRING_LANGUAGES.has(language),
    bangCalls: language === 'ruby',
    isDefinition: DEFINITION_GUARDS[language] || null,
    // Ruby `=begin`/`=end` must start the line.
    blockAtLineStartOnly: language === 'ruby',
    // Bare call: a name not preceded by a member/path/sigil character.
    bare: new RegExp(String.raw`(?<![\w$.:>@#\\])([A-Za-z_]\w*)${GENERIC_ARGS}\s*\(`, 'g'),
    bareKeywords: bareKeywordsFor(language),
    shorthandDefinitions: SHORTHAND_DEFINITION_LANGUAGES.has(language),
    preprocessor: PREPROCESSOR_LANGUAGES.has(language),
  };
}

function getPlan(language, langInfo) {
  let plan = planCache.get(language);
  if (!plan) {
    plan = buildPlan(language, langInfo);
    planCache.set(language, plan);
  }
  return plan;
}

/**
 * True when `idx` sits inside a string literal on this line (odd count of
 * unescaped quotes before it). Approximate by design: a miss only keeps a
 * comment's text, it never hides code.
 */
function insideString(line, idx, plan) {
  let dq = 0; let sq = 0; let bt = 0;
  for (let i = 0; i < idx; i++) {
    const ch = line.charCodeAt(i);
    if (ch === 92 /* \ */) { i++; continue; }
    if (ch === 34 /* " */) dq++;
    else if (ch === 39 /* ' */ && plan.countSingleQuote) sq++;
    else if (ch === 96 /* ` */ && plan.countBacktick) bt++;
  }
  return (dq & 1) === 1 || (sq & 1) === 1 || (bt & 1) === 1;
}

// First char of a continuation line: `.` `?` `!` `-` (`->`) `&` (`&.`) `:` (`::`).
function startsWithSeparator(trimmed) {
  const c = trimmed.charCodeAt(0);
  return c === 46 || c === 63 || c === 33 || c === 45 || c === 38 || c === 58;
}

// `foo/*` (a glob in a heredoc or raw string) and `http://` are text, not a
// comment opener: real `//` and `/*` follow whitespace, punctuation or
// the line start.
function glued(line, idx, token) {
  if (idx === 0 || token.charCodeAt(0) !== 47 /* / */) return false;
  const p = line.charCodeAt(idx - 1);
  return p === 58 /* : */ || (p >= 48 && p <= 57) || (p >= 65 && p <= 90) || (p >= 97 && p <= 122) || p === 95;
}

function findToken(line, token, from, plan) {
  let idx = line.indexOf(token, from);
  while (idx !== -1) {
    if (!glued(line, idx, token) && !insideString(line, idx, plan)) return idx;
    idx = line.indexOf(token, idx + token.length);
  }
  return -1;
}

export class CallSiteScanner {
  constructor(langInfo) {
    this.language = langInfo?.id || 'unknown';
    this.plan = getPlan(this.language, langInfo);
    this.skip = new Set(langInfo?.graph?.skipCallObjects || []);
    this.reset();
  }

  reset() {
    this.blockEnd = null; // active block-comment terminator, or null
    // Previous code line (comment-stripped, trimmed). Continuation receivers
    // are derived from it lazily — only when the current line needs one.
    this.prevCode = null;
  }

  /** A line the caller skips (e.g. minified, over the length cap) breaks any chain. */
  skipLine() {
    this.prevCode = null;
  }

  /** Receiver at the end of the previous code line: `name` or `name()`. */
  _prevTail() {
    if (!this.prevCode) return null;
    const tm = this.plan.tail.exec(this.prevCode);
    if (!tm) return null;
    return tm[2] !== undefined ? `${tm[1]}()` : tm[1];
  }

  /** `obj` when the previous code line ended with `obj.` (Go/Ruby style). */
  _prevTrailingSep() {
    const prev = this.prevCode;
    if (!prev || !this.plan.trailingSep || prev.charCodeAt(prev.length - 1) !== 46 /* . */) return null;
    const sm = this.plan.trailingSep.exec(prev);
    return sm ? sm[1] : null;
  }

  /**
   * Strip comments from one line, tracking block comments across lines.
   * Returns the code part ('' for a comment-only line).
   */
  codeOf(line) {
    const plan = this.plan;
    let s = line;
    if (this.blockEnd) {
      const end = s.indexOf(this.blockEnd);
      if (end === -1) return '';
      s = s.slice(end + this.blockEnd.length);
      this.blockEnd = null;
    }
    if (plan.lineTokens.length === 0 && plan.blockPairs.length === 0) return s;
    for (let guard = 0; guard < 64; guard++) {
      let bestIdx = -1; let bestLine = false; let bestPair = null;
      for (const tok of plan.lineTokens) {
        if (s.indexOf(tok) === -1) continue;
        const idx = findToken(s, tok, 0, plan);
        if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) { bestIdx = idx; bestLine = true; bestPair = null; }
      }
      for (const pair of plan.blockPairs) {
        if (s.indexOf(pair[0]) === -1) continue;
        let idx;
        if (plan.blockAtLineStartOnly) {
          idx = s.startsWith(pair[0]) ? 0 : -1;
        } else if (pair[0] === pair[1]) {
          // Python triple quotes: the string scanner would see the quotes
          // themselves, so search raw.
          idx = s.indexOf(pair[0]);
        } else {
          idx = findToken(s, pair[0], 0, plan);
        }
        if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) { bestIdx = idx; bestLine = false; bestPair = pair; }
      }
      if (bestIdx === -1) return s;
      // `#` that opens a Ruby/PHP interpolation or a PHP 8 attribute is code.
      if (bestLine && s[bestIdx] === '#' && (s[bestIdx + 1] === '{' || s[bestIdx + 1] === '[')) return s;
      if (bestLine) return s.slice(0, bestIdx);
      const [open, close] = bestPair;
      const end = s.indexOf(close, bestIdx + open.length);
      if (end === -1) {
        this.blockEnd = close;
        return s.slice(0, bestIdx);
      }
      s = `${s.slice(0, bestIdx)} ${s.slice(end + close.length)}`;
    }
    return s;
  }

  /**
   * Bare calls on one comment-free line: `emitBare(name)` for each name called
   * with no receiver. Skips keywords, declarations (`def f(`, `int f(`,
   * `fn f(`, class-method shorthand `f(a) {`), preprocessor lines, names the
   * line itself defines (`isDefinedHere(name)`), and text inside strings.
   */
  _scanBare(trimmed, emitBare, isDefinedHere) {
    const plan = this.plan;
    if (plan.preprocessor && trimmed.charCodeAt(0) === 35 /* # */) return;
    const code = blankStrings(trimmed, plan);
    const re = plan.bare;
    re.lastIndex = 0;
    let m;
    let first = true;
    while ((m = re.exec(code)) !== null) {
      const name = m[1];
      const atStart = first && m.index === 0;
      first = false;
      if (plan.bareKeywords.has(name)) continue;
      if (isDefinedHere && isDefinedHere(name)) continue;
      const before = code.slice(0, m.index).trimEnd();
      if (before) {
        const last = before.charCodeAt(before.length - 1);
        // Go `func (r *T) name(`: a receiver list, not a call. Elsewhere
        // `if (x) name(` and `(int)name(` are calls.
        if (last === 41 /* ) */ && /^func\s*\(/.test(before)) continue;
        if (last === 42 /* * */ || last === 38 /* & */) {
          // `Foo *make(` / `int &ref(`: a declarator after a type name.
          if (/[\w>]\s*[*&]+$/.test(before)) continue;
        }
        const word = /([A-Za-z_]\w*)$/.exec(before);
        if (word && !CALL_PREFIX_WORDS.has(word[1])) continue;
        // `Foo<T> make(` / `List<int> f(`: a generic type before the name.
        if (last === 62 /* > */ && /\w\s*<[^()]*>$/.test(before)) continue;
      } else if (atStart && plan.shorthandDefinitions && code.endsWith('{') && SHORTHAND_DEFINITION.test(code)) {
        continue;
      }
      emitBare(name);
    }
  }

  /**
   * Scan one source line and call `emit(targetName)` for every call site.
   * `line` may be raw (untrimmed); comments are removed here.
   */
  scanLine(line, emit, emitBare = null, isDefinedHere = null) {
    const plan = this.plan;
    const code = this.codeOf(line);
    const trimmed = code.trim();
    if (!trimmed) return;
    if (emitBare && trimmed.indexOf('(') !== -1) this._scanBare(trimmed, emitBare, isDefinedHere);

    // Ruby bang calls (`record.save!`) need no parenthesis.
    const hasParen = trimmed.indexOf('(') !== -1
      || (plan.bangCalls && trimmed.indexOf('!') !== -1);
    if (hasParen) {
      const q = plan.qualified;
      q.lastIndex = 0;
      let m;
      while ((m = q.exec(trimmed)) !== null) {
        if (this.skip.has(m[1])) continue;
        if (plan.isDefinition && plan.isDefinition(trimmed.slice(0, m.index), m[1], m[2])) continue;
        emit(`${m[1]}.${m[2]}`);
      }
      if (trimmed.indexOf(')') !== -1) {
        const c = plan.chained;
        c.lastIndex = 0;
        while ((m = c.exec(trimmed)) !== null) {
          // `super().__init__(` / `print(x).y(`: a skipped receiver stays skipped.
          if (!this.skip.has(m[1])) emit(`${m[1]}().${m[2]}`);
          if (m[0] === '') c.lastIndex++;
        }
      }
      // Continuation lines.
      if (startsWithSeparator(trimmed)) {
        const lm = plan.leading.exec(trimmed);
        const tail = lm ? this._prevTail() : null;
        if (tail) emit(`${tail}.${lm[1]}`);
      } else {
        const recv = this._prevTrailingSep();
        if (recv && !this.skip.has(recv)) {
          const bm = plan.bareCallAtStart.exec(trimmed);
          if (bm) emit(`${recv}.${bm[1]}`);
        }
      }
    }

    if (plan.trailingClosure && trimmed.indexOf('{') !== -1 && !TRAILING_CLOSURE_SKIP_LINE.test(trimmed)) {
      const t = plan.trailingClosure;
      t.lastIndex = 0;
      let m;
      while ((m = t.exec(trimmed)) !== null) {
        // `: Foo.Bar {` / `-> Foo.Bar {` is a type, not a call.
        const before = trimmed.slice(0, m.index).trimEnd();
        if (before.endsWith(':') || before.endsWith('->')) continue;
        if (before && TRAILING_CLOSURE_DECL_BEFORE.test(before)) continue;
        if (!this.skip.has(m[1])) emit(`${m[1]}.${m[2]}`);
      }
      if (plan.leadingClosure && startsWithSeparator(trimmed)) {
        const lm = plan.leadingClosure.exec(trimmed);
        const tail = lm ? this._prevTail() : null;
        if (tail) emit(`${tail}.${lm[1]}`);
      }
    }

    this.prevCode = trimmed;
  }
}

/** Scan a whole file; returns `[{ line, targetName }]` (1-based lines). */
export function scanCallSites(langInfo, lines) {
  const scanner = new CallSiteScanner(langInfo);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    scanner.scanLine(lines[i], (targetName) => out.push({ line: lineNum, targetName }));
  }
  return out;
}
