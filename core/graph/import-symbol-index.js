/**
 * Import Symbol Index — declarations and references for languages whose
 * imports name a namespace, package or module instead of a file.
 *
 * C# `using X.Y;`, Java/Kotlin/Scala/Groovy same-package and wildcard
 * visibility, Swift modules and Elixir module names do not say which file
 * they load. Mapping them to every file of the namespace would explode the
 * graph (graphify issue #3868: an O(files × names × classes) edge blow-up).
 * The rule here, borrowed from graphify's fix for that issue, is to emit an
 * edge only to a file that declares a name the importing file actually
 * uses, and only when the language's own lookup rules make that name
 * unambiguous:
 *
 * - C#: own namespace, then using-imported namespaces (+ project-level
 *   `global using`), then enclosing namespaces innermost first (C# spec,
 *   "Namespaces" — namespace and type names). Two imported namespaces that
 *   both declare the name are a compile-time ambiguity: no edge.
 * - Java/Kotlin/Groovy: explicit imports bind first (resolved elsewhere),
 *   then the own package, then on-demand (`*`) imports (JLS §6.4.1 / Kotlin
 *   "Packages and imports"). Scala: wildcard imports before the package
 *   members of other compilation units (Scala spec, ch. 2).
 * - Swift: the own SwiftPM target, then imported local targets.
 * - Elixir: fully qualified module names (after `alias` expansion).
 *
 * Declarations are top-level only (brace depth 0, and for brace languages
 * other than C# at column 0, which also guards Scala 3 braceless bodies).
 * References are identifiers that are not member accesses (`x.Foo` is not a
 * reference to type Foo) outside comments and strings, minus every name the
 * file declares itself.
 *
 * Pure functions; the resolver owns file reading and memoisation.
 */

// Comments and string literals, newline-preserving. One alternation per
// family so V8 runs a single pass per file.
const C_LIKE_NOISE_RE = /"""[\s\S]*?"""|@"(?:[^"]|"")*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n]){1,6}'/g;
const GROOVY_NOISE_RE = /"""[\s\S]*?"""|'''[\s\S]*?'''|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
const ELIXIR_NOISE_RE = /"""[\s\S]*?"""|'''[\s\S]*?'''|#[^\n]*|"(?:\\.|[^"\\])*"/g;

const keepNewlines = (m) => (m.indexOf('\n') === -1 ? '' : m.replace(/[^\n]+/g, ''));

export function stripNoise(content, language) {
  const re = language === 'elixir' ? ELIXIR_NOISE_RE : language === 'groovy' ? GROOVY_NOISE_RE : C_LIKE_NOISE_RE;
  re.lastIndex = 0;
  // A UTF-8 byte-order mark (most Visual Studio C# files) would hide the
  // first line's `namespace` / `package` / `using` from the `^[ \t]*`
  // directive rules; a space keeps every offset.
  const text = content.charCodeAt(0) === 0xfeff ? ` ${content.slice(1)}` : content;
  return text.replace(re, keepNewlines);
}

// Directive lines name namespaces, not referenced types. C# / Swift
// preprocessor lines (`#region Helper Methods`) carry prose.
const DIRECTIVE_LINE_RE = /^[ \t]*(?:@\w+[ \t]+)*(?:global[ \t]+)?(?:using|import|package|namespace)\b[^\n]*/gm;
const PREPROCESSOR_LINE_RE = /^[ \t]*#[ \t]*(?:region|endregion|pragma|warning|error|line|nullable|define|undef|sourceLocation)\b[^\n]*/gm;
const blankSameLength = (m) => ' '.repeat(m.length);

export function lineOfIndex(text, index) {
  let n = 1;
  for (let k = text.indexOf('\n'); k !== -1 && k < index; k = text.indexOf('\n', k + 1)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

const CS_TOKEN_RE = /\bnamespace\s+([A-Za-z_][\w.]*)\s*([;{])|\b(class|struct|interface|enum|record|delegate)\s+|[{}]/g;
const CS_TYPE_NAME_RE = /^(?:(?:class|struct)\s+)?(@?[A-Za-z_]\w*)/;
const CS_DELEGATE_NAME_RE = /^[^;(){}=]*?([A-Za-z_]\w*)\s*(?:<[^<>(){};]*>)?\s*\(/;
const CS_GLOBAL_USING_RE = /^[ \t]*global[ \t]+using[ \t]+(?!static\b)(?:global::)?([A-Za-z_][\w.]*)[ \t]*;/gm;

/**
 * @returns {{ namespaces: string[], types: Array<{ns: string, name: string}>, globalUsings: string[] }}
 */
export function csharpDeclarations(stripped) {
  const namespaces = [];
  const types = [];
  const stack = []; // { name, depth } block namespaces
  let fileNs = '';
  let depth = 0;
  CS_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = CS_TOKEN_RE.exec(stripped)) !== null) {
    const tok = m[0];
    if (m[1]) {
      const outer = stack.length ? stack[stack.length - 1].name : fileNs;
      const full = outer ? `${outer}.${m[1]}` : m[1];
      if (!namespaces.includes(full)) namespaces.push(full);
      if (m[2] === '{') { depth++; stack.push({ name: full, depth }); } else fileNs = full;
      continue;
    }
    if (tok === '{') { depth++; continue; }
    if (tok === '}') {
      depth--;
      while (stack.length && stack[stack.length - 1].depth > depth) stack.pop();
      continue;
    }
    const required = stack.length ? stack[stack.length - 1].depth : 0;
    if (depth !== required) continue;
    const rest = stripped.slice(CS_TOKEN_RE.lastIndex, CS_TOKEN_RE.lastIndex + 300);
    const nm = m[3] === 'delegate' ? CS_DELEGATE_NAME_RE.exec(rest) : (m[3] === 'record' ? CS_TYPE_NAME_RE.exec(rest) : /^(@?[A-Za-z_]\w*)/.exec(rest));
    if (!nm) continue;
    // Skip past the name so `record struct X` is not read twice.
    CS_TOKEN_RE.lastIndex += nm[0].length - (nm[0].endsWith('(') ? 1 : 0);
    const name = nm[1].replace(/^@/, '');
    if (name === 'class' || name === 'struct' || name === 'where') continue;
    types.push({ ns: stack.length ? stack[stack.length - 1].name : fileNs, name });
  }
  const globalUsings = [];
  CS_GLOBAL_USING_RE.lastIndex = 0;
  while ((m = CS_GLOBAL_USING_RE.exec(stripped)) !== null) globalUsings.push(m[1]);
  return { namespaces, types, globalUsings };
}

// ---------------------------------------------------------------------------
// Brace languages with column-0 top-level declarations: JVM family + Swift
// ---------------------------------------------------------------------------

const MODIFIERS = new Set([
  'public', 'private', 'internal', 'protected', 'open', 'final', 'abstract', 'sealed', 'data', 'value',
  'inline', 'annotation', 'inner', 'external', 'expect', 'actual', 'static', 'strictfp', 'case',
  'implicit', 'lazy', 'override', 'fileprivate', 'indirect', 'nonisolated', 'isolated', 'const',
  'tailrec', 'infix', 'operator', 'suspend', 'transparent', 'opaque', 'export', 'non-sealed',
  'package', 'mutating', 'nonmutating', 'convenience', 'required', 'dynamic', 'distributed', 'consuming',
  'borrowing', 'weak', 'unowned', 'optional', 'prefix', 'postfix', 'final', 'synchronized', 'native',
]);
const DECL_KW_RE = /^(class|interface|object|record|trait|typealias|type|struct|protocol|actor|enum|fun|def|func|val|var|let)\s+/;
const ANNOTATION_PREFIX_RE = /^@(?!interface\b)[\w.]+(?:\([^()]*\))?\s*/;
const KOTLIN_FUN_NAME_RE = /^(?:<[^>]*(?:<[^>]*>[^>]*)*>\s*)?(?:[A-Za-z_][\w<>?,* ]*?\.)?`?([A-Za-z_]\w*)`?\s*[(<]/;
const SIMPLE_NAME_RE = /^`?([A-Za-z_]\w*)`?/;

function parseTopLevelDecl(line) {
  let rest = line;
  for (let guard = 0; guard < 12; guard++) {
    const ann = ANNOTATION_PREFIX_RE.exec(rest);
    if (ann) { rest = rest.slice(ann[0].length); continue; }
    const w = /^([a-z][\w-]*)\s+/.exec(rest);
    if (w && MODIFIERS.has(w[1])) { rest = rest.slice(w[0].length); continue; }
    break;
  }
  if (rest.startsWith('@interface ')) {
    const n = SIMPLE_NAME_RE.exec(rest.slice(11).trim());
    return n ? { name: n[1], kind: 'type' } : null;
  }
  let kw = DECL_KW_RE.exec(rest);
  if (!kw) return null;
  let keyword = kw[1];
  rest = rest.slice(kw[0].length);
  // `enum class X`, `fun interface X`, `enum struct` style compounds.
  const inner = /^(class|interface|struct)\s+/.exec(rest);
  if (inner && (keyword === 'enum' || keyword === 'fun')) { keyword = inner[1]; rest = rest.slice(inner[0].length); }
  if (keyword === 'fun') {
    const f = KOTLIN_FUN_NAME_RE.exec(rest);
    return f ? { name: f[1], kind: 'func' } : null;
  }
  const n = SIMPLE_NAME_RE.exec(rest);
  if (!n) return null;
  if (keyword === 'def' || keyword === 'func') return { name: n[1], kind: 'func' };
  if (keyword === 'val' || keyword === 'var' || keyword === 'let') {
    // Top-level properties: only constant-style names, which are referenced
    // as capitalised identifiers.
    return /^[A-Z][A-Z0-9_]*$/.test(n[1]) ? { name: n[1], kind: 'type' } : null;
  }
  return { name: n[1], kind: 'type' };
}

const PACKAGE_RE = /^package\s+([\w.`]+)\s*;?\s*$/;

/**
 * @returns {{ packages: string[], decls: Array<{name: string, kind: 'type'|'func'}> }}
 *   packages: the package clauses in order (Scala may chain several; the
 *   effective package is their join, and each prefix stays visible).
 */
export function braceDeclarations(stripped) {
  const lines = stripped.split('\n');
  const packages = [];
  const decls = [];
  let depth = 0;
  let sawDecl = false;
  for (const line of lines) {
    if (line.length === 0) continue;
    const c = line.charCodeAt(0);
    if (depth === 0 && c !== 32 && c !== 9) {
      if (!sawDecl && line.startsWith('package ')) {
        const p = PACKAGE_RE.exec(line.trim());
        if (p) packages.push(p[1].replace(/`/g, ''));
      } else if (c >= 64 /* @ and letters */) {
        const d = parseTopLevelDecl(line);
        if (d) { decls.push(d); sawDecl = true; }
      }
    }
    if (line.indexOf('{') !== -1 || line.indexOf('}') !== -1) {
      for (let k = 0; k < line.length; k++) {
        const ch = line.charCodeAt(k);
        if (ch === 123) depth++;
        else if (ch === 125 && depth > 0) depth--;
      }
    }
  }
  return { packages, decls };
}

/** `a.b` + `c` chained Scala clauses → ['a.b', 'a.b.c'] (each visible), effective last. */
export function packageChain(packages) {
  const chain = [];
  let acc = '';
  for (const p of packages) {
    acc = acc ? `${acc}.${p}` : p;
    chain.push(acc);
  }
  return chain;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const TYPE_REF_RE = /\b[A-Z][A-Za-z0-9_]*/g;
const OWN_TYPE_DECL_RE = /\b(?:class|struct|interface|enum|record|object|trait|protocol|actor|typealias|type|delegate)\s+`?([A-Za-z_]\w*)/g;
const OWN_FUNC_DECL_RE = /\b(?:fun|func|def)\s+(?:<[^>]*>\s*)?(?:[\w<>?,* ]*?\.)?`?([A-Za-z_]\w*)/g;

// A name right after one of these is a member access or an annotation /
// directive, not a reference to a top-level declaration: `x.Foo`, `$Foo`.
const NOT_REF_PREV = new Set([46 /* . */, 36 /* $ */, 35 /* # */, 64 /* @ */]);
const OWN_DECL_KEYWORDS = new Set(['class', 'struct', 'interface', 'enum', 'record', 'object', 'trait', 'protocol', 'actor', 'typealias', 'type', 'delegate']);

function isIdentChar(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/**
 * Names a file references (first-occurrence offset per name), excluding
 * member accesses, directive lines and the file's own declarations.
 *
 * @param {string} stripped - stripNoise() output
 * @param {{ calls?: boolean }} [opts] - also collect lowercase call names
 * @returns {{ types: Map<string, number>, calls: Map<string, number>, body: string }}
 */
export function referencedNames(stripped, opts = {}) {
  // Directives (using/import/package/namespace) precede the first type
  // declaration; stripping only that head keeps the pass cheap.
  OWN_TYPE_DECL_RE.lastIndex = 0;
  const firstDecl = OWN_TYPE_DECL_RE.exec(stripped);
  const cut = firstDecl ? stripped.lastIndexOf('\n', firstDecl.index) + 1 : stripped.length;
  // Length-preserving, so offsets in `body` are offsets in `stripped`.
  let body = cut > 0 ? stripped.slice(0, cut).replace(DIRECTIVE_LINE_RE, blankSameLength) + stripped.slice(cut) : stripped;
  if (body.indexOf('#') !== -1) body = body.replace(PREPROCESSOR_LINE_RE, blankSameLength);
  const own = new Set();
  const types = new Map();
  TYPE_REF_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_REF_RE.exec(body)) !== null) {
    const name = m[0];
    const at = m.index;
    if (at > 0) {
      const prev = body.charCodeAt(at - 1);
      if (NOT_REF_PREV.has(prev)) continue;
      // `class Foo` / `struct Foo` …: the file's own declaration.
      if (prev === 32 || prev === 96 /* ` */) {
        let e = at - 1;
        while (e > 0 && (body.charCodeAt(e - 1) === 32 || body.charCodeAt(e - 1) === 96)) e--;
        let s = e;
        while (s > 0 && isIdentChar(body.charCodeAt(s - 1))) s--;
        if (e - s >= 4 && e - s <= 9 && OWN_DECL_KEYWORDS.has(body.slice(s, e))) { own.add(name); continue; }
      }
    }
    if (types.has(name)) continue;
    // C# methods are capitalised: `void Run()` / `Run()` name a member, not
    // a type. `new Foo(`, `[Foo(` and `, Foo(` (attributes) stay references.
    if (opts.capitalizedMethods) {
      let n = at + name.length;
      while (n < body.length && (body.charCodeAt(n) === 32 || body.charCodeAt(n) === 9)) n++;
      if (body.charCodeAt(n) === 40 /* ( */) {
        let p = at - 1;
        while (p >= 0 && (body.charCodeAt(p) === 32 || body.charCodeAt(p) === 9 || body.charCodeAt(p) === 10)) p--;
        const prevChar = p >= 0 ? body.charCodeAt(p) : 0;
        const isAttribute = prevChar === 91 /* [ */ || prevChar === 44 /* , */;
        const isNew = p >= 2 && body.slice(p - 2, p + 1) === 'new' && (p < 3 || !isIdentChar(body.charCodeAt(p - 3)));
        if (!isAttribute && !isNew) continue;
      }
    }
    types.set(name, at);
  }
  for (const name of own) types.delete(name);
  let m2;
  const calls = new Map();
  if (opts.calls) {
    const ownFuncs = new Set();
    OWN_FUNC_DECL_RE.lastIndex = 0;
    while ((m2 = OWN_FUNC_DECL_RE.exec(body)) !== null) ownFuncs.add(m2[1]);
    // Walk back from each `(` over spaces and one identifier: cheaper than
    // a regex over every lowercase word.
    for (let p = body.indexOf('('); p !== -1; p = body.indexOf('(', p + 1)) {
      let e = p;
      while (e > 0 && (body.charCodeAt(e - 1) === 32 || body.charCodeAt(e - 1) === 9)) e--;
      let s = e;
      while (s > 0 && isIdentChar(body.charCodeAt(s - 1))) s--;
      if (s === e) continue;
      const first = body.charCodeAt(s);
      if (!((first >= 97 && first <= 122) || first === 95)) continue;
      if (s > 0 && NOT_REF_PREV.has(body.charCodeAt(s - 1))) continue;
      const name = body.slice(s, e);
      if (!ownFuncs.has(name) && !calls.has(name)) calls.set(name, s);
    }
  }
  return { types, calls, body };
}

const CS_NS_TOKEN_RE = /\bnamespace\s+([A-Za-z_][\w.]*)\s*([;{])|[{}]/g;

/**
 * Namespace bodies of a C# file as offset ranges (block namespaces nest;
 * a file-scoped namespace runs to the end). A reference resolves against
 * the innermost range that contains it.
 *
 * @returns {Array<{name: string, start: number, end: number}>}
 */
export function csharpNamespaceRanges(stripped) {
  const ranges = [];
  const stack = [];
  let depth = 0;
  CS_NS_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = CS_NS_TOKEN_RE.exec(stripped)) !== null) {
    if (m[1]) {
      const outer = stack.length ? stack[stack.length - 1].name : (ranges.find((r) => r.fileScoped)?.name || '');
      const name = outer ? `${outer}.${m[1]}` : m[1];
      if (m[2] === ';') {
        ranges.push({ name, start: m.index, end: stripped.length, fileScoped: true });
      } else {
        depth++;
        const r = { name, start: m.index, end: stripped.length, depth };
        ranges.push(r);
        stack.push(r);
      }
      continue;
    }
    if (m[0] === '{') { depth++; continue; }
    depth--;
    while (stack.length && stack[stack.length - 1].depth > depth) stack.pop().end = m.index;
  }
  return ranges;
}

/** Innermost namespace containing `offset` ('' for the global namespace). */
export function namespaceAt(ranges, offset) {
  let best = null;
  for (const r of ranges) {
    if (offset >= r.start && offset < r.end && (!best || r.start >= best.start)) best = r;
  }
  return best ? best.name : '';
}

const QUALIFIED_RE = /\b[A-Za-z_]\w*(?:[ \t]*\.[ \t]*[A-Za-z_]\w*)+/g;

/**
 * Dotted name chains (`zipkin2.storage.StorageComponent`,
 * `Configuration.File.FileRoute`) that do not start after a `.`, first
 * offset per chain. The resolver keeps only chains that spell a declared
 * namespace/package plus a declared top-level name.
 *
 * @param {string} body
 * @param {Set<string>} heads - first segments worth considering
 * @returns {Map<string, number>}
 */
export function qualifiedChains(body, heads) {
  const out = new Map();
  QUALIFIED_RE.lastIndex = 0;
  let m;
  while ((m = QUALIFIED_RE.exec(body)) !== null) {
    const at = m.index;
    if (at > 0 && NOT_REF_PREV.has(body.charCodeAt(at - 1))) continue;
    const text = m[0];
    const dot = text.indexOf('.');
    const head = text.slice(0, dot).trim();
    if (!heads.has(head)) continue;
    const chain = text.replace(/[ \t]+/g, '');
    if (!out.has(chain)) out.set(chain, at);
  }
  return out;
}

const PACKAGE_LINE_RE = /^package\s+([\w.`]+)\s*;?[ \t]*$/gm;
/** Package clauses of a JVM file, in order (Scala may chain several). */
export function packageClauses(stripped) {
  const out = [];
  PACKAGE_LINE_RE.lastIndex = 0;
  let m;
  while ((m = PACKAGE_LINE_RE.exec(stripped)) !== null) out.push(m[1].replace(/`/g, ''));
  return out;
}

// ---------------------------------------------------------------------------
// Elixir
// ---------------------------------------------------------------------------

const EX_DEFMODULE_RE = /^([ \t]*)(?:defmodule|defprotocol)\s+([A-Z][\w]*(?:\.[A-Z][\w]*)*)\s*(?:,\s*)?do\b/gm;

/** Fully qualified module names a file defines (nested defmodule by indentation). */
export function elixirModules(stripped) {
  const out = [];
  const stack = []; // { indent, name }
  EX_DEFMODULE_RE.lastIndex = 0;
  let m;
  while ((m = EX_DEFMODULE_RE.exec(stripped)) !== null) {
    const indent = m[1].replace(/\t/g, '  ').length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const full = stack.length ? `${stack[stack.length - 1].name}.${m[2]}` : m[2];
    out.push(full);
    stack.push({ indent, name: full });
  }
  return out;
}

const EX_REF_RE = /(?<![\w.:@])([A-Z][\w]*(?:\.[A-Z][\w]*)*)/g;

/** Dotted module references (first offset per name) in Elixir code. */
export function elixirReferences(stripped) {
  const refs = new Map();
  EX_REF_RE.lastIndex = 0;
  let m;
  while ((m = EX_REF_RE.exec(stripped)) !== null) if (!refs.has(m[1])) refs.set(m[1], m.index);
  return refs;
}

export default {
  stripNoise, csharpDeclarations, braceDeclarations, packageChain, referencedNames,
  csharpNamespaceRanges, namespaceAt, qualifiedChains, packageClauses, elixirModules,
  elixirReferences, lineOfIndex,
};
