/**
 * Per-line type-usage scanner for the trace-only relationship types
 * (relationship-types.js): `instantiates`, `typeRef`, `extensionOf`.
 *
 * Shape rules, not stopword lists (CLAUDE.md "Stopword Lists vs Shape
 * Heuristics"): a constructed or annotated type is a PascalCase identifier
 * (Go also allows `&lowercase{`), and only a repo type can resolve — `Int(`,
 * `String`, `ValueError(` find no local type entity and give no edge. The
 * resolver keeps an edge only when exactly one type candidate survives.
 *
 * Instantiation forms (tree-sitter tags capture the same sites as
 * `@reference.class`; graphify links them as `uses`):
 *   new X(…) / new X<…>(…) / new X{…}   Java, JS/TS, C#, PHP, Dart, C++, Groovy, Scala
 *   make_unique<X>( / make_shared<X>(    C++
 *   X(…)                                 Swift, Kotlin, Python, Dart, Scala (not after `.`/`@`, not a definition)
 *   X::new( / X::default( / X::from( / X::with_*( / X::builder(   Rust
 *   = X { / ( X { / return X {           Rust and Go composite literals; Go `&x{`
 *   X.new                                Ruby
 *   [X alloc] / [X new]                  Objective-C
 *   %X{                                  Elixir structs
 */

const NEW_LANGS = new Set(['java', 'javascript', 'typescript', 'tsx', 'csharp', 'php', 'dart', 'cpp', 'groovy', 'scala']);
const CTOR_CALL_LANGS = new Set(['swift', 'kotlin', 'python', 'dart', 'scala']);
// Languages whose definition signatures carry parameter / return types.
const TYPED_SIGNATURE_LANGS = new Set([
  'java', 'typescript', 'tsx', 'csharp', 'kotlin', 'swift', 'scala', 'dart', 'go', 'rust', 'php',
  'python', 'cpp', 'c', 'groovy',
]);

const NEW_RE = /\bnew\s+\\?((?:[A-Za-z_]\w*(?:\.|\\|::))*[A-Z]\w*)\s*[(<{[]/g;
const CPP_MAKE_RE = /\bmake_(?:unique|shared)\s*<\s*((?:\w+::)*[A-Z]\w*)/g;
// A PascalCase call not preceded by `.`, `@`, `#` or a word character.
const CTOR_CALL_RE = /(^|[^\w.@#$])([A-Z][A-Za-z0-9_]*)\s*\(/g;
const RUST_ASSOC_RE = /\b([A-Z]\w*)\s*::\s*(?:new|default|from|builder|with_\w+)\s*\(/g;
const LITERAL_RE = /(?:[=(,:]|=>|\breturn)\s*&?\s*([A-Z]\w*)\s*\{/g;
const GO_ADDR_LITERAL_RE = /&\s*([A-Za-z_]\w*)\s*\{/g;
const RUBY_NEW_RE = /\b([A-Z]\w*(?:::[A-Z]\w*)*)\.new\b/g;
const OBJC_ALLOC_RE = /\[\s*([A-Z]\w*)\s+(?:alloc|new)\b/g;
const ELIXIR_STRUCT_RE = /%([A-Z][\w.]*)\{/g;

// Definition heads: a PascalCase name right after these is declared, not used.
const DEFINITION_HEAD_RE = /\b(?:class|struct|enum|interface|trait|protocol|object|record|actor|def|fun|func|fn|function|case|typealias|type|data|sealed|annotation)\s+$/;

const PASCAL_TOKEN_RE = /(^|[^\w.@$'"])([A-Z][A-Za-z0-9_]*[a-z][A-Za-z0-9_]*)\b/g;
const SWIFT_EXTENSION_HEAD_RE = /^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|package)\s+)?extension\s+([A-Za-z_][\w.]*)(?:<[^>]*>)?\s*(?:where\b[^:{]*)?:/;

function lastSegment(name) {
  const parts = name.split(/::|\\|\./).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : name;
}

function pushAll(re, line, group, out) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    const name = m[group];
    if (name) out.add(lastSegment(name));
    if (m[0] === '') re.lastIndex++;
  }
}

/**
 * Types constructed on one (comment-free) line.
 * @param {string} line trimmed source line
 * @param {string} language
 * @returns {string[]} short type names, deduplicated
 */
export function scanInstantiations(line, language) {
  if (line.length === 0) return [];
  const out = new Set();
  if (NEW_LANGS.has(language) && line.includes('new')) pushAll(NEW_RE, line, 1, out);
  if (language === 'cpp' && line.includes('make_')) pushAll(CPP_MAKE_RE, line, 1, out);
  if (CTOR_CALL_LANGS.has(language) && line.includes('(')) {
    CTOR_CALL_RE.lastIndex = 0;
    let m;
    while ((m = CTOR_CALL_RE.exec(line)) !== null) {
      const name = m[2];
      const before = line.slice(0, m.index + m[1].length);
      if (!DEFINITION_HEAD_RE.test(before) && !/^[A-Z0-9_]+$/.test(name)) out.add(name);
    }
  }
  if (language === 'rust') {
    if (line.includes('::')) pushAll(RUST_ASSOC_RE, line, 1, out);
    if (line.includes('{')) pushAll(LITERAL_RE, line, 1, out);
  }
  if (language === 'go' && line.includes('{')) {
    pushAll(LITERAL_RE, line, 1, out);
    if (line.includes('&')) pushAll(GO_ADDR_LITERAL_RE, line, 1, out);
  }
  if (language === 'ruby' && line.includes('.new')) pushAll(RUBY_NEW_RE, line, 1, out);
  if (language === 'objc' && line.includes('[')) pushAll(OBJC_ALLOC_RE, line, 1, out);
  if (language === 'elixir' && line.includes('%')) pushAll(ELIXIR_STRUCT_RE, line, 1, out);
  return [...out];
}

/**
 * Types named in a definition's signature line (parameter and return types).
 * Excludes the defined name and its owner; ALL-CAPS tokens (macros,
 * constants, single-letter generics) never count.
 * @param {string} line trimmed definition line
 * @param {string} language
 * @param {{ ownName?: string, ownerName?: string }} [opts]
 * @returns {string[]}
 */
export function scanSignatureTypes(line, language, opts = {}) {
  if (!TYPED_SIGNATURE_LANGS.has(language)) return [];
  // The signature ends where the body starts.
  let sig = line;
  const brace = sig.indexOf('{');
  if (brace >= 0) sig = sig.slice(0, brace);
  const arrow = language === 'typescript' || language === 'tsx' ? sig.indexOf('=>') : -1;
  if (arrow >= 0) sig = sig.slice(0, arrow);
  // Strip string literals (default values) before collecting names.
  sig = sig.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  const declared = declaredTypeParameters(sig);
  const out = new Set();
  PASCAL_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = PASCAL_TOKEN_RE.exec(sig)) !== null) {
    const name = m[2];
    if (name === opts.ownName || name === opts.ownerName || declared.has(name)) continue;
    out.add(name);
  }
  return [...out];
}

/**
 * Generic parameters a signature declares before its parameter list:
 * `func f<Key: Hashable, Value>(`, `public <T extends Foo> T get(`,
 * `fn map<Output>(`. The first name of each `<…>` part is declared, not
 * used (`Foo` in `T extends Foo` still counts).
 */
function declaredTypeParameters(sig) {
  const declared = new Set();
  const paren = sig.indexOf('(');
  const head = paren >= 0 ? sig.slice(0, paren) : sig;
  if (!head.includes('<')) return declared;
  const groups = head.match(/<([^<>]*(?:<[^<>]*>[^<>]*)*)>/g) || [];
  for (const g of groups) {
    for (const part of g.slice(1, -1).split(',')) {
      const name = /^\s*(?:in\s+|out\s+|reified\s+)?([A-Za-z_]\w*)/.exec(part);
      if (name) declared.add(name[1]);
    }
  }
  return declared;
}

/**
 * Swift `extension X: P, Q {` → `X` (the extended type), else null.
 * Conformance on an extension has no container entity to hang on; the
 * `extensionOf` row lets the override pass join it to the extends rows of
 * the same line.
 */
export function swiftExtensionTarget(line) {
  if (!line.includes('extension')) return null;
  const m = SWIFT_EXTENSION_HEAD_RE.exec(line);
  return m ? lastSegment(m[1]) : null;
}
