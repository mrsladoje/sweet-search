/**
 * Declared receiver types of qualified calls (`b.write(x)` where `b` is a
 * `WriteBuffer`), read from the calling function's own text: its parameter
 * list (all lines of it, not only the signature's first line) and the local
 * declarations before the call.
 *
 * The extractor stores the type on the call row as
 * `full_import_path = recvtype:<Type>` (Go: `recvtype:<Type>@<package dir>/`,
 * or `recvtype:!<pkg.Type>` for a type from a package outside the repo).
 * Build-time resolution then binds the call only to a method of that type (or
 * of a supertype the graph knows) and leaves it unresolved otherwise: a typed
 * receiver never links to an unrelated type's same-named method by name.
 *
 * Sound, not complete: a name declared twice with different types, or also
 * bound without a written type (`l := get()`, `val b = f()`, a lambda or
 * loop variable, a Python rebinding), gets no type, and resolution keeps its
 * receiver-name rules. Languages without written types (JS, Ruby) are skipped;
 * Python counts only annotated names (`b: Buffer`).
 */

import { RECEIVER_TYPE_PREFIX, parseReceiverType } from '../infrastructure/receiver-type-annotation.js';

export { RECEIVER_TYPE_PREFIX, parseReceiverType };

const GO = /\.go$/i;
const TYPE_FIRST = /\.(?:java|cs|dart)$/i;
const COLON_TYPED_FILE = /\.(?:kt|kts|ts|tsx|mts|cts|swift|rs|scala|py|pyi)$/i;
const TS_FILE = /\.(?:ts|tsx|mts|cts)$/i;
const PY_FILE = /\.(?:py|pyi)$/i;
const RUST_FILE = /\.rs$/i;
const KOTLIN_SWIFT_SCALA = /\.(?:kt|kts|swift|scala)$/i;

const SELF_NAMES = new Set(['this', 'self', 'super', 'cls', 'me', 'static', 'it']);
const CALLABLE = new Set(['method', 'function', 'constructor', 'rpc']);
// Longest body prefix scanned for declarations (lines from the definition to
// the call). Longer functions keep the receiver-name rules.
const MAX_SCAN_LINES = 400;
// Words that precede a type-first declaration only as an expression
// (`return Foo b` is no declaration; `new Foo b` never parses).
const TYPE_FIRST_NOT_TYPES = new Set(['return', 'new', 'throw', 'case', 'else', 'yield', 'await', 'goto']);

/** True when the language of `filePath` writes declared types the scanner reads. */
export function receiverTypesSupported(filePath) {
  const f = String(filePath || '');
  return GO.test(f) || TYPE_FIRST.test(f) || COLON_TYPED_FILE.test(f);
}

/**
 * The declared type of `name` in `text` (the caller's lines from its
 * definition through the call line), or null when it is unknown or ambiguous.
 * Returns { type, qualifier } — qualifier is the package / namespace prefix
 * as written (`gin` in `*gin.Context`), or '' when none.
 */
export function declaredTypeIn(text, name, filePath) {
  return declaredTypeInCode(stripComments(text || '', filePath), name, filePath);
}

// Comments are no code: `// Act` above `_builder.Add()` is no `Act _builder`.
function stripComments(text, filePath) {
  return PY_FILE.test(String(filePath || ''))
    ? text.replace(/#.*$/gm, '')
    : text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
}

// Every pattern is compiled once and captures the declared name(s); a match
// counts only when it names the receiver. (A per-name pattern set cost more
// to compile than to run: jj has ~10k distinct receiver names.)
const ID = '[A-Za-z_]\\w*';
const GENERICS = '(?:\\s*<(?:[^<>()]|<[^<>()]*>)*>)';
// Go: `l *List`, `a, l *List`, `var l List`, `func (l *List)`; not `[]List`, `map[..]List`.
const GO_TYPED = new RegExp(`(?<![\\w.])(${ID}(?:\\s*,\\s*${ID})*)[ \\t]+\\*?((?:[a-z_]\\w*\\.)?[A-Z]\\w*)(?![\\w.(\\[{])`, 'g');
// `l := &List{…}`, `l := List{…}`, `var l = new(List)`.
const GO_BUILT = new RegExp(`(?<![\\w.])(?:var\\s+)?(${ID})\\s*:?=\\s*(?:&\\s*((?:[a-z_]\\w*\\.)?[A-Z]\\w*)\\s*\\{|((?:[a-z_]\\w*\\.)?[A-Z]\\w*)\\s*\\{|new\\(\\s*((?:[a-z_]\\w*\\.)?[A-Z]\\w*)\\s*\\))`, 'g');
// Untyped bindings: `l := x`, `l, err := x`, `for _, l := range`, `var l = x`.
const GO_UNTYPED = new RegExp(`(?<![\\w.])(${ID}(?:\\s*,\\s*${ID})*)\\s*:=|(?<![\\w.])var\\s+(${ID})\\s*=`, 'g');
// Java / C# / Dart: `WriteBuffer b`, `final Foo<T> b`, `@Nullable Foo b`, `for (Foo b : xs)`, `x instanceof Foo b`.
const TF_TYPED = new RegExp(`(?<![\\w.$@])((?:${ID}\\.)*)([A-Z]\\w*)${GENERICS}?\\??[ \\t]+(${ID})\\s*(?=[,)=;:])`, 'g');
const TF_BUILT = new RegExp(`(?<![\\w.$])var\\s+(${ID})\\s*=\\s*new\\s+((?:${ID}\\.)*[A-Z]\\w*)`, 'g');
// `var b = x`, `final b = x` (Dart), `out var b`, lambda parameters `b ->`, `(b, c) ->`, `b =>`.
const TF_UNTYPED = new RegExp(`(?<![\\w.$])(?:var|final|dynamic)\\s+(${ID})\\b|(?<![\\w.$])(${ID})\\s*(?:->|=>)|\\(\\s*(${ID}(?:\\s*,\\s*${ID})*)\\s*\\)\\s*(?:->|=>)`, 'g');
// Kotlin / TS / Swift / Rust / Scala / Python: `b: Foo`, `b: &mut Foo`, `inout b: Foo`, `_ db: Database`
// after `(`, `,`, line start or a binding keyword — not `x ? b : Foo`, `{ b: Foo }`, `f(b: Foo.x)`.
const COLON_TYPED = new RegExp(`(?:^|[(,])\\s*(?:(?:val|var|let|const|mut|lateinit|readonly|private|public|protected|internal|override|inout|final|ref|${ID})[ \\t]+)*(${ID})\\s*\\??\\s*:\\s*(?:&\\s*(?:'\\w+\\s+)?(?:mut\\s+)?|inout\\s+|\\*)?((?:${ID}\\.)*)([A-Z]\\w*)(${GENERICS})?(?!\\s*[.([\\w])`, 'gm');
const BIND = '\\b(?:val|var|let|const)\\s+(?:mut\\s+)?';
// Construction: Kotlin/Swift/Scala `val b = Foo(`, TS `const b = new Foo(`, Rust `let b = Foo {`.
const CTOR_KSS = new RegExp(`${BIND}(${ID})\\s*=\\s*((?:${ID}\\.)*[A-Z]\\w*)\\s*\\(`, 'g');
const CTOR_TS = new RegExp(`${BIND}(${ID})\\s*=\\s*new\\s+((?:${ID}\\.)*[A-Z]\\w*)\\s*[(<]`, 'g');
const CTOR_RS = new RegExp(`${BIND}(${ID})\\s*=\\s*([A-Z]\\w*)\\s*\\{`, 'g');
// Bindings without a written type. Each alternative captures a name list.
const COLON_UNTYPED = new RegExp([
  // `val b = f()`, `let b = x`, `for (const b of xs)`.
  `${BIND}(${ID})\\b(?!\\s*\\??\\s*:)`,
  // Destructuring: `const { b } = x`, `val (a, b) = p`, `let (a, b) = t`.
  `\\b(?:val|var|let|const)\\s*[{[(]([^=;\\n]*)`,
  // `for b in`, `for (a, b) in`, `for (b in xs)`.
  `\\bfor\\s*\\(?\\s*(${ID}(?:\\s*,\\s*${ID})*)\\s*\\)?\\s+in\\b`,
  // Closure / lambda parameters: `{ b ->`, `{ a, b in`, `|b|`, `|a, b|`, `b =>`, `(a, b) =>`.
  `\\{\\s*(${ID}(?:\\s*,\\s*${ID})*)\\s*(?:->|\\bin\\b)`,
  `\\|([^|\\n]*)\\|`,
  `(?<![\\w.$])(${ID})\\s*=>`,
  `\\(\\s*(${ID}(?:\\s*,\\s*${ID})*)\\s*\\)\\s*=>`,
  // Rust patterns `Some(b)`, `Ok(b)`; untyped `catch (b)`.
  `\\b(?:Some|Ok|Err)\\s*\\(\\s*(?:ref\\s+)?(?:mut\\s+)?(${ID})\\s*\\)`,
  `\\bcatch\\s*\\(\\s*(${ID})\\s*\\)`,
].join('|'), 'g');
// Python rebinding: `b = x`, `a, b = t`, `with x as b`, `except E as b`, `lambda b:`.
const PY_UNTYPED = new RegExp(`(?<![\\w.])(${ID}(?:\\s*,\\s*${ID})*)\\s*=(?!=)|\\bas\\s+(${ID})|\\blambda\\b([^:\\n]*)`, 'g');

function namesIn(list) {
  return String(list || '').split(/[^\w$]+/).filter(Boolean);
}
function anyGroupNames(m, name) {
  for (let i = 1; i < m.length; i++) if (m[i] !== undefined && namesIn(m[i]).includes(name)) return true;
  return false;
}

function declaredTypeInCode(text, name, filePath) {
  if (!text || !name || SELF_NAMES.has(name) || !/^[A-Za-z_]\w*$/.test(name)) return null;
  const f = String(filePath || '');
  // Every pattern matches within one line that names the receiver: scan only those.
  text = text.split('\n').filter(l => l.includes(name) && hasWord(l, name)).join('\n');
  if (!text) return null;
  const found = [];
  let m;

  if (GO.test(f)) {
    GO_TYPED.lastIndex = 0;
    while ((m = GO_TYPED.exec(text)) !== null) {
      // `return l List` / `n *Scale` (a product) are no declarations.
      if (namesIn(m[1]).includes(name) && lineStartsDeclaration(text, m.index)) found.push(m[2]);
    }
    const builtAt = new Set();
    GO_BUILT.lastIndex = 0;
    while ((m = GO_BUILT.exec(text)) !== null) {
      if (m[1] === name) { found.push(m[2] || m[3] || m[4]); builtAt.add(m.index); }
    }
    GO_UNTYPED.lastIndex = 0;
    while ((m = GO_UNTYPED.exec(text)) !== null) {
      if (anyGroupNames(m, name) && !builtAt.has(m.index)) return null;
    }
  } else if (TYPE_FIRST.test(f)) {
    TF_TYPED.lastIndex = 0;
    while ((m = TF_TYPED.exec(text)) !== null) {
      if (m[3] !== name) continue;
      const prevWord = /(\w+)\s*$/.exec(text.slice(Math.max(0, m.index - 12), m.index))?.[1];
      if (prevWord && TYPE_FIRST_NOT_TYPES.has(prevWord)) continue;
      found.push(`${m[1]}${m[2]}`);
    }
    const builtAt = new Set();
    TF_BUILT.lastIndex = 0;
    while ((m = TF_BUILT.exec(text)) !== null) if (m[1] === name) { found.push(m[2]); builtAt.add(m.index); }
    TF_UNTYPED.lastIndex = 0;
    while ((m = TF_UNTYPED.exec(text)) !== null) {
      if (anyGroupNames(m, name) && !builtAt.has(m.index)) return null;
    }
  } else if (COLON_TYPED_FILE.test(f)) {
    COLON_TYPED.lastIndex = 0;
    while ((m = COLON_TYPED.exec(text)) !== null) {
      if (m[1] !== name) continue;
      // A type followed by `[]` (TS array) is no `Foo`.
      if (/^\s*\[/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 3))) continue;
      // Rust: `Box<Foo>` / `Rc<Foo>` / `Arc<Mutex<Foo>>` auto-deref to the
      // inner type's methods; the outer name says nothing. No type.
      if (m[4] && RUST_FILE.test(f)) return null;
      found.push(`${m[2]}${m[3]}`);
    }
    const ctor = KOTLIN_SWIFT_SCALA.test(f) ? CTOR_KSS : (TS_FILE.test(f) ? CTOR_TS : (RUST_FILE.test(f) ? CTOR_RS : null));
    const builtAt = new Set();
    if (ctor) {
      ctor.lastIndex = 0;
      while ((m = ctor.exec(text)) !== null) if (m[1] === name) { found.push(m[2]); builtAt.add(m.index); }
    }
    for (const untyped of PY_FILE.test(f) ? [COLON_UNTYPED, PY_UNTYPED] : [COLON_UNTYPED]) {
      untyped.lastIndex = 0;
      while ((m = untyped.exec(text)) !== null) {
        if (anyGroupNames(m, name) && !builtAt.has(m.index)) return null;
      }
    }
  } else {
    return null;
  }

  if (found.length === 0) return null;
  const first = found[0];
  if (found.some(t => t !== first)) return null;
  const dot = first.lastIndexOf('.');
  return dot >= 0 ? { type: first.slice(dot + 1), qualifier: first.slice(0, dot) } : { type: first, qualifier: '' };
}

function hasWord(line, name) {
  let i = line.indexOf(name);
  while (i >= 0) {
    const before = i > 0 ? line[i - 1] : '';
    const after = line[i + name.length] || '';
    if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) return true;
    i = line.indexOf(name, i + 1);
  }
  return false;
}

// Go: the match must start a declaration — line start, `(`, `,` or `var`/`func (`.
function lineStartsDeclaration(text, index) {
  let i = index - 1;
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--;
  if (i < 0 || text[i] === '\n' || text[i] === '(' || text[i] === ',' || text[i] === ';') return true;
  return /\bvar\s*$/.test(text.slice(Math.max(0, i - 4), index));
}

/**
 * Annotate qualified call rows (`recv.method`) with the receiver's declared
 * type (see the module comment). `goPackages` maps a Go import name to its
 * `gopkg:<dir>/` / `unresolved:<path>` annotation; without it a Go type from
 * another package is left unannotated.
 */
export function annotateReceiverTypes(filePath, content, entities, relationships, { goPackages = null } = {}) {
  if (!receiverTypesSupported(filePath) || !relationships?.length || !entities?.length) return;
  const byId = new Map();
  for (const e of entities) if (e?.id) byId.set(e.id, e);
  let lines = null;
  const isGo = GO.test(filePath);
  const ownDir = (() => {
    const p = String(filePath).replace(/\\/g, '/');
    const slash = p.lastIndexOf('/');
    return slash >= 0 ? p.slice(0, slash + 1) : '';
  })();
  const memo = new Map();
  const bodies = new Map();
  for (const rel of relationships) {
    if (rel.type !== 'calls' || rel.full_import_path || !rel.context_line) continue;
    const parts = String(rel.target_name || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1] || parts[1].includes('(')) continue;
    const recv = parts[0];
    if (!/^[A-Za-z_]\w*$/.test(recv) || SELF_NAMES.has(recv)) continue;
    const src = byId.get(rel.source_id);
    if (!src || !CALLABLE.has(src.type) || src.start_line == null) continue;
    const start = src.start_line;
    const end = src.end_line ?? rel.context_line;
    if (rel.context_line < start || end - start > MAX_SCAN_LINES) continue;
    // The whole definition, once per (definition, receiver): a declaration
    // after the call can only add a conflicting type (then no type at all).
    const key = `${src.id}\u0000${recv}`;
    let annotation = memo.get(key);
    if (annotation === undefined) {
      let text = bodies.get(src.id);
      if (text === undefined) {
        lines ??= content.split('\n');
        text = stripComments(lines.slice(start - 1, end).join('\n'), filePath);
        bodies.set(src.id, text);
      }
      const declared = declaredTypeInCode(text, recv, filePath);
      annotation = declared ? receiverAnnotation(declared, { isGo, ownDir, goPackages }) : null;
      memo.set(key, annotation);
    }
    if (annotation) rel.full_import_path = annotation;
  }
}

function receiverAnnotation({ type, qualifier }, { isGo, ownDir, goPackages }) {
  if (!isGo) {
    // A nested type keeps its enclosing type (`Span.Builder`), not a package
    // (`zipkin2.Span` → `Span`): many types nest a `Builder`.
    const outer = qualifier ? qualifier.slice(qualifier.lastIndexOf('.') + 1) : '';
    return /^[A-Z]/.test(outer) ? `${RECEIVER_TYPE_PREFIX}${outer}.${type}` : `${RECEIVER_TYPE_PREFIX}${type}`;
  }
  if (!qualifier) return `${RECEIVER_TYPE_PREFIX}${type}@${ownDir}`;
  const pkg = goPackages?.get(qualifier);
  if (!pkg) return null;
  if (pkg.startsWith('gopkg:')) return `${RECEIVER_TYPE_PREFIX}${type}@${pkg.slice('gopkg:'.length)}`;
  return `${RECEIVER_TYPE_PREFIX}!${qualifier}.${type}`;
}
