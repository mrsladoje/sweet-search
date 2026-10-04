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
  objc: ['.', '->'],
  rust: ['.', '::'],
  ruby: ['.', '&.'],
  // Lua `obj:method(` is a method call with implicit self.
  lua: ['.', ':'],
  perl: ['->', '::'],
  r: ['::'],
  shell: ['.'],
};

// Languages whose registry has no `methodCall` pattern but whose calls the
// scanner reads (C-like `name(` / `a.b(` syntax, or shell command words).
// Juxtaposition languages (Haskell, OCaml, F#, Elm), s-expressions (Clojure,
// elisp) and `mod:fun(` Erlang need grammar-aware call queries; not scanned.
export const EXTRA_CALL_SCAN_LANGUAGES = new Set(['objc', 'lua', 'elixir', 'shell', 'zig', 'solidity', 'perl', 'r', 'julia']);

// Elixir pipes call the right-hand function: `data |> transform` /
// `|> Mod.fun` (tree-sitter-elixir tags.scm: binary_operator "|>" right:
// identifier @reference.call). Parenthesised forms are read as calls anyway.
const ELIXIR_PIPE = /\|>\s*(?:(\w+)\.)?([a-z_]\w*[?!]?)(?![\w.(])/g;
// Julia short-form definition: `area(r) = π * r^2` (not `==`).
const JULIA_SHORT_DEFINITION = /^(?:\w+\.)?\w+(?:\{[^}]*\})?\([^]*\)\s*(?:::\s*[^=]+)?=(?!=)/;
// Shell: functions are called as command words, not `name(`.
const SHELL_SEGMENT_SPLIT = /;|&&|\|\||\||\$\(|`|\b(?:then|do|else|elif|if|while|until|time|exec|command|sudo|xargs)\b/;
const SHELL_COMMAND_WORD = /^([A-Za-z_][\w-]*)(?=[\s)]|$)/;

// Languages where `'…'` delimits strings (so quote parity must count it when
// deciding whether a comment token sits inside a string literal). In the rest
// `'` is a char literal or a lifetime and would break parity.
const SINGLE_QUOTE_STRING_LANGUAGES = new Set([
  'javascript', 'typescript', 'tsx', 'python', 'php', 'ruby', 'dart', 'groovy',
]);
const BACKTICK_STRING_LANGUAGES = new Set(['javascript', 'typescript', 'tsx', 'go']);

// Extra comment syntax the registry's single `comment.line` entry omits.
const EXTRA_LINE_COMMENTS = { php: ['#'] };
// Docstrings/heredocs hold examples (`iex> Jason.encode(x)`), not calls.
const EXTRA_BLOCK_COMMENTS = { python: [["'''", "'''"]], elixir: [['"""', '"""']] };

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
  // Lua `function M.helper(` / `function Class:method(`, Julia `function Base.show(`.
  lua: (before) => /\bfunction\s+$/.test(before),
  julia: (before) => /\bfunction\s+$/.test(before),
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
// Reserved words and language constructs that can precede `(` but never name
// a callable: closed per-language sets taken from each language's grammar
// (keywords, special forms, spec-predeclared builtins such as Go's `len`).
// Library functions (`print`, `listOf`, `pairs`, `paste`) are NOT listed —
// that would be a capture-filter stopword list (CLAUDE.md): a bare call links
// only to a repo definition the caller can see, so a library name with no
// such definition never gets an edge, and a repo function that shadows it
// does.
const KW_C_FAMILY = ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'sizeof', 'catch', 'try', 'throw', 'new', 'delete', 'goto'];
const BARE_KEYWORDS_BY_LANGUAGE = {
  c: [...KW_C_FAMILY, 'alignof', '_Alignof', 'offsetof', 'defined', '__attribute__', '__declspec', 'asm', '__asm__', '_Generic', 'typeof', '__typeof__', 'static_assert', '_Static_assert'],
  cpp: [...KW_C_FAMILY, 'alignof', 'offsetof', 'defined', '__attribute__', 'decltype', 'static_assert', 'noexcept', 'typeid', 'co_await', 'co_return', 'co_yield', 'requires', 'operator', 'template', 'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast', 'asm', 'catch'],
  objc: [...KW_C_FAMILY, 'defined', '__attribute__', 'typeof', '@selector', 'synchronized'],
  java: [...KW_C_FAMILY, 'synchronized', 'assert', 'super', 'this', 'instanceof'],
  csharp: [...KW_C_FAMILY, 'foreach', 'using', 'lock', 'fixed', 'checked', 'unchecked', 'typeof', 'nameof', 'default', 'base', 'this', 'when', 'stackalloc', 'await', 'in', 'is', 'as'],
  javascript: [...KW_C_FAMILY, 'typeof', 'void', 'await', 'yield', 'function', 'super', 'import', 'in', 'of', 'instanceof', 'with', 'async'],
  typescript: [...KW_C_FAMILY, 'typeof', 'void', 'await', 'yield', 'function', 'super', 'import', 'in', 'of', 'instanceof', 'with', 'async', 'keyof', 'satisfies', 'as', 'is', 'asserts', 'infer'],
  python: ['if', 'elif', 'else', 'for', 'while', 'return', 'yield', 'await', 'assert', 'del', 'not', 'and', 'or', 'in', 'is', 'lambda', 'with', 'except', 'raise', 'from', 'import', 'match', 'case'],
  ruby: ['if', 'elsif', 'unless', 'while', 'until', 'for', 'case', 'when', 'return', 'yield', 'defined?', 'not', 'and', 'or', 'in', 'super', 'rescue'],
  // Go: keywords plus the predeclared builtin functions of the language spec.
  // `import (`, `var (`, `const (` and `type (` open grouped declarations.
  go: ['if', 'for', 'switch', 'case', 'return', 'go', 'defer', 'select', 'func', 'range', 'import', 'var', 'const', 'type', 'make', 'new', 'len', 'cap', 'append', 'copy', 'delete', 'panic', 'recover', 'print', 'println', 'complex', 'real', 'imag', 'close', 'min', 'max', 'clear'],
  // Rust: keywords plus the prelude's Option/Result constructors.
  rust: ['if', 'else', 'for', 'while', 'loop', 'match', 'return', 'in', 'as', 'move', 'unsafe', 'await', 'Some', 'Ok', 'Err'],
  swift: ['if', 'else', 'for', 'while', 'repeat', 'switch', 'case', 'return', 'guard', 'defer', 'catch', 'try', 'throw', 'await', 'in', 'is', 'as', 'where', 'init', 'super', 'self', 'Self', 'unowned', 'weak', 'some', 'any'],
  kotlin: ['if', 'else', 'for', 'while', 'when', 'return', 'throw', 'try', 'catch', 'in', 'is', 'as', 'super', 'this', 'constructor', 'init', 'by', 'where', 'get', 'set'],
  scala: ['if', 'else', 'for', 'while', 'match', 'case', 'return', 'throw', 'try', 'catch', 'yield', 'new', 'super', 'this'],
  // PHP: keywords and language constructs (`isset`, `echo`, `include` are
  // constructs, not functions).
  php: ['if', 'elseif', 'else', 'for', 'foreach', 'while', 'switch', 'case', 'return', 'catch', 'throw', 'new', 'array', 'list', 'isset', 'unset', 'empty', 'eval', 'exit', 'die', 'echo', 'print', 'include', 'include_once', 'require', 'require_once', 'fn', 'function', 'match', 'clone', 'instanceof', 'parent', 'self', 'static'],
  dart: [...KW_C_FAMILY, 'assert', 'await', 'yield', 'super', 'this', 'is', 'as', 'in'],
  groovy: [...KW_C_FAMILY, 'assert', 'super', 'this', 'in', 'as'],
  lua: ['if', 'elseif', 'while', 'for', 'until', 'return', 'and', 'or', 'not', 'in', 'function', 'local'],
  // Elixir: reserved words and the special forms / definition macros.
  elixir: ['if', 'unless', 'case', 'cond', 'with', 'for', 'fn', 'quote', 'unquote', 'receive', 'try', 'raise', 'throw', 'def', 'defp', 'defmacro', 'defmacrop', 'defmodule', 'defstruct', 'defimpl', 'defprotocol', 'defguard', 'defdelegate', 'import', 'alias', 'require', 'use', 'when', 'and', 'or', 'not', 'in'],
  // Shell: reserved words and POSIX special builtins.
  shell: ['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'return', 'local', 'echo', 'printf', 'test', 'exit'],
  zig: ['if', 'else', 'while', 'for', 'switch', 'return', 'try', 'catch', 'orelse', 'defer', 'errdefer', 'comptime', 'fn', 'and', 'or', 'struct', 'enum', 'union', 'error'],
  // Solidity: keywords, `emit`, and elementary type names (conversions read as calls).
  solidity: [...KW_C_FAMILY, 'emit', 'address', 'payable', 'uint', 'uint256', 'int', 'int256', 'bytes', 'bytes32', 'string', 'bool', 'type', 'modifier', 'function', 'event', 'mapping'],
  perl: ['if', 'elsif', 'else', 'unless', 'while', 'until', 'for', 'foreach', 'return', 'my', 'our', 'local', 'sub', 'and', 'or', 'not', 'qw'],
  r: ['if', 'else', 'for', 'while', 'repeat', 'function', 'return'],
  julia: ['if', 'elseif', 'else', 'for', 'while', 'return', 'function', 'begin', 'let', 'try', 'catch', 'macro', 'quote', 'in', 'isa'],
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

// ── String literals ────────────────────────────────────────────────────────
// Text inside a string is not code: `"usage: obj.run(cmd)"`, `println!("a.b({})")`
// and SQL/HTML templates must not yield call edges. Interpolated parts ARE
// code (`${a.b()}`, Swift `\(a.b())`, Ruby `#{a.b()}`, f-strings, C# `$"{…}"`,
// PHP `"{$o->m()}"`, shell `"$(cmd)"`) and stay visible.
//
// Interpolation opener per language and quote. `prefix` is the identifier
// text glued before the quote (`f`, `rf`, `$`, `@$`, `s`).
function interpolationFor(language, quote, prefix) {
  switch (language) {
    case 'javascript': case 'typescript': case 'tsx':
      return quote === '`' ? '${' : null;
    case 'kotlin': case 'groovy': case 'dart': case 'scala':
      return quote === "'" && language !== 'dart' ? null : '${';
    case 'swift':
      return '\\(';
    case 'ruby': case 'crystal': case 'elixir':
      return quote === '"' ? '#{' : null;
    case 'python':
      return /[fF]/.test(prefix) ? '{' : null;
    case 'csharp':
      return prefix.includes('$') ? '{' : null;
    case 'php':
      return quote === '"' ? '{$' : null;
    case 'shell':
      return quote === '"' ? '$(' : null;
    default:
      return null;
  }
}
// Strings that may span lines: template literals / Go raw strings (backtick)
// and triple-quoted blocks (Kotlin, Swift, Scala, Groovy, Dart, Java text
// blocks, C# raw strings). Python/Elixir `"""` are handled as block comments.
const TRIPLE_QUOTE_LANGUAGES = new Set(['kotlin', 'swift', 'scala', 'groovy', 'dart', 'java', 'csharp']);
// Prefixes that turn backslash escapes off (C# verbatim `@"…"`, Rust/Python raw).
const RAW_PREFIX = /(?:^|[^\w])(?:@|@\$|\$@|r#*|[rR][bB]?|[bB][rR])$/;

/** Index just past the bracket that closes the one at `open` (depth-counted), or `code.length`. */
function matchClose(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c === 40 || c === 123 || c === 91) depth++;
    else if (c === 41 || c === 125 || c === 93) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return code.length;
}

function lineHasQuote(code, plan) {
  return code.indexOf('"') !== -1
    || (code.indexOf("'") !== -1)
    || (plan.countBacktick && code.indexOf('`') !== -1);
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
    tripleQuote: TRIPLE_QUOTE_LANGUAGES.has(language),
    bangCalls: language === 'ruby',
    isDefinition: DEFINITION_GUARDS[language] || null,
    // Ruby `=begin`/`=end` must start the line.
    blockAtLineStartOnly: language === 'ruby',
    // Bare call: a name not preceded by a member/path/sigil character.
    bare: new RegExp(String.raw`(?<![\w$.:>@#\\])([A-Za-z_]\w*)${GENERIC_ARGS}\s*\(`, 'g'),
    bareKeywords: bareKeywordsFor(language),
    shorthandDefinitions: SHORTHAND_DEFINITION_LANGUAGES.has(language),
    preprocessor: PREPROCESSOR_LANGUAGES.has(language),
    pipeCalls: language === 'elixir',
    juliaShortDefinitions: language === 'julia',
    commandCalls: language === 'shell',
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
    // Previous code line (comment-stripped, string-blanked, trimmed).
    // Continuation receivers are derived from it lazily — only when the
    // current line needs one.
    this.prevCode = null;
    // String literal still open at the end of the previous line (template
    // literal, raw string, triple-quoted block): { close, interp, escapes }.
    this.openString = null;
  }

  /** A line the caller skips (e.g. minified, over the length cap) breaks any chain. */
  skipLine() {
    this.prevCode = null;
    this.openString = null;
  }

  /**
   * Walk the open string `open` from `i`: copy interpolated code, blank the
   * rest. Returns `{ out, i }` with `i` just past the closing quote, or
   * `i === code.length` (and `open` still open) when the line ends first.
   */
  _walkString(code, i, open) {
    let out = '';
    const n = code.length;
    while (i < n) {
      if (code.startsWith(open.close, i)) {
        out += open.close;
        return { out, i: i + open.close.length, closed: true };
      }
      if (open.interp && code.startsWith(open.interp, i)) {
        const end = matchClose(code, i + open.interp.length - 1);
        out += code.slice(i, end);
        i = end;
        continue;
      }
      if (open.escapes && code.charCodeAt(i) === 92 /* \ */) {
        out += i + 1 < n ? '  ' : ' ';
        i += 2;
        continue;
      }
      out += ' ';
      i++;
    }
    return { out, i: n, closed: false };
  }

  /** Index where a string still open from the previous line closes on `line`, or -1. */
  _openStringEnd(line) {
    const r = this._walkString(line, 0, this.openString);
    return r.closed ? r.i : -1;
  }

  /**
   * Blank string-literal contents on one comment-free line (quotes and
   * interpolated code kept). Tracks strings that stay open across lines.
   * Approximate: an unterminated single-line quote blanks to the line end.
   */
  _blank(code) {
    const plan = this.plan;
    if (!this.openString && !lineHasQuote(code, plan)) return code;
    let out = '';
    let i = 0;
    const n = code.length;
    if (this.openString) {
      const r = this._walkString(code, 0, this.openString);
      out += r.out;
      i = r.i;
      if (!r.closed) return out;
      this.openString = null;
    }
    while (i < n) {
      const ch = code.charCodeAt(i);
      if (ch === 39 /* ' */ && !plan.countSingleQuote) {
        // Char literal (`'"'`, `'\''`) in languages where `'` is not a
        // string quote: skip it so its `"` does not open a string. A Rust
        // lifetime (`'a`) has no closing quote and falls through.
        if (code.charCodeAt(i + 1) !== 92 && code.charCodeAt(i + 2) === 39) { out += "' '"; i += 3; continue; }
        if (code.charCodeAt(i + 1) === 92 && code.charCodeAt(i + 3) === 39) { out += "'  '"; i += 4; continue; }
        out += "'";
        i++;
        continue;
      }
      let quote = null;
      if (plan.tripleQuote && (code.startsWith('"""', i) || (plan.language === 'dart' && code.startsWith("'''", i)))) {
        quote = code.slice(i, i + 3);
      } else if (ch === 34 || (ch === 39 && plan.countSingleQuote) || (ch === 96 && plan.countBacktick)) {
        quote = code[i];
      }
      if (!quote) { out += code[i]; i++; continue; }
      let p = i;
      while (p > 0 && /[\w$@#]/.test(code[p - 1])) p--;
      const prefix = code.slice(p, i);
      const open = {
        close: quote,
        interp: interpolationFor(plan.language, quote[0], prefix),
        // Go raw strings and C#/Rust/Python raw prefixes have no escapes.
        escapes: !(plan.language === 'go' && quote === '`') && !RAW_PREFIX.test(prefix),
      };
      out += quote;
      const r = this._walkString(code, i + quote.length, open);
      out += r.out;
      i = r.i;
      if (!r.closed) {
        // Only backtick templates/raw strings and triple quotes span lines.
        if (quote === '`' || quote.length === 3) this.openString = open;
        break;
      }
    }
    return out;
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
    // A string left open by the previous line (template literal, triple-quoted
    // block) runs until its closing quote: comment tokens inside it are text.
    if (this.openString && !this.blockEnd) {
      const end = this._openStringEnd(line);
      if (end === -1) return line;
      return line.slice(0, end) + this._codeOfRest(line.slice(end));
    }
    return this._codeOfRest(line);
  }

  _codeOfRest(line) {
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
  _scanBare(code, emitBare, isDefinedHere, continuation) {
    const plan = this.plan;
    if (plan.preprocessor && code.charCodeAt(0) === 35 /* # */) return;
    const re = plan.bare;
    re.lastIndex = 0;
    let m;
    let first = true;
    while ((m = re.exec(code)) !== null) {
      const name = m[1];
      const atStart = first && m.index === 0;
      first = false;
      // `Do(req)` under a line ending in `client.` is the qualified call
      // `client.Do`, already emitted as such — not a bare call.
      if (atStart && continuation) continue;
      if (plan.bareKeywords.has(name)) continue;
      if (isDefinedHere && isDefinedHere(name)) continue;
      // `std::function<void(int)>`: a name right after `<` is a function type in a
      // template argument, not a call.
      if (code.charCodeAt(m.index - 1) === 60 /* < */) continue;
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
      } else if (atStart && plan.juliaShortDefinitions && JULIA_SHORT_DEFINITION.test(code)) {
        continue;
      }
      emitBare(name);
    }
  }

  /**
   * Shell: a function is called as the first word of a command —
   * `deploy "$env"`, `if check_deps; then`, `out=$(render_page x)`. The
   * definition forms `name() {` and `function name {` are skipped, and so are
   * assignments (`name=value`).
   */
  _scanCommands(code, emitBare, isDefinedHere) {
    if (/^(?:function\s+)?[A-Za-z_][\w-]*\s*\(\s*\)/.test(code) || /^function\s/.test(code)) return;
    for (const segment of code.split(SHELL_SEGMENT_SPLIT)) {
      const seg = segment.trim();
      if (!seg) continue;
      const m = SHELL_COMMAND_WORD.exec(seg);
      if (!m) continue;
      const name = m[1];
      if (this.plan.bareKeywords.has(name)) continue;
      if (isDefinedHere && isDefinedHere(name)) continue;
      emitBare(name);
    }
  }

  /**
   * Scan one source line and call `emit(targetName)` for every call site.
   * `line` may be raw (untrimmed); comments are removed here.
   */
  scanLine(line, emit, emitBare = null, isDefinedHere = null) {
    const plan = this.plan;
    const raw = this.codeOf(line).trim();
    if (!raw) return;
    // Every call shape is read from string-blanked code: call text inside a
    // log message, SQL or doc string is not a call; interpolations stay.
    const trimmed = this._blank(raw);
    const contRecv = this._prevTrailingSep();
    if (emitBare) {
      if (plan.commandCalls) this._scanCommands(trimmed, emitBare, isDefinedHere);
      else if (trimmed.indexOf('(') !== -1) this._scanBare(trimmed, emitBare, isDefinedHere, !!contRecv && !startsWithSeparator(trimmed));
    }
    if (plan.pipeCalls && trimmed.indexOf('|>') !== -1) {
      ELIXIR_PIPE.lastIndex = 0;
      let pm;
      while ((pm = ELIXIR_PIPE.exec(trimmed)) !== null) {
        if (pm[1]) emit(`${pm[1]}.${pm[2]}`);
        else if (emitBare && !plan.bareKeywords.has(pm[2])) emitBare(pm[2]);
      }
    }

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
        const recv = contRecv;
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
