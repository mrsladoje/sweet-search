/**
 * Overload selection for ss-trace: `Owner.Method(Type, Type)` picks the one definition whose
 * parameter list the written list fits. Each written item is a parameter type, a parameter
 * name, or both (`int id`); C# keyword types match their System names (`int` = `Int32`).
 */

// The text of a parenthesised list starting at `open` (index of `(`), or null when unbalanced.
export function parenBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<' && /\w/.test(text[i - 1] || '')) depth++;
    else if (ch === ')' || ch === ']' || ch === '}' || (ch === '>' && depth > 1 && text[i - 1] !== '-')) {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * `text` with the contents of string / char literals and comments blanked, same length:
 * a comma or `string id;` inside `"a,b"` or `// …` is no code. Quotes stay, so a blanked
 * literal still reads as a string; newlines stay.
 */
export function maskCode(text) {
  const t = String(text || '');
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < t.length) {
    const ch = t[i];
    const next = t[i + 1];
    if (ch === '/' && next === '/') {
      const end = t.indexOf('\n', i);
      const stop = end < 0 ? t.length : end;
      out += blank(t.slice(i, stop)); i = stop; continue;
    }
    if (ch === '/' && next === '*') {
      const end = t.indexOf('*/', i + 2);
      const stop = end < 0 ? t.length : end + 2;
      out += blank(t.slice(i, stop)); i = stop; continue;
    }
    if (ch === '"' && t.startsWith('"""', i)) {
      const end = t.indexOf('"""', i + 3);
      const stop = end < 0 ? t.length : end + 3;
      out += `"${blank(t.slice(i + 1, stop - 1))}"`; i = stop; continue;
    }
    if (ch === '"' || (ch === "'" && /^'(?:[^'\\\n]|\\.[^'\n]{0,8})'/.test(t.slice(i, i + 12)))) {
      const verbatim = ch === '"' && /@\$?$|\$@$/.test(t.slice(Math.max(0, i - 2), i));
      let j = i + 1;
      while (j < t.length) {
        if (!verbatim && t[j] === '\\') { j += 2; continue; }
        if (t[j] === ch) {
          if (verbatim && t[j + 1] === ch) { j += 2; continue; }
          break;
        }
        if (t[j] === '\n' && !verbatim) break;
        j++;
      }
      const stop = Math.min(j, t.length);
      out += ch + blank(t.slice(i + 1, stop)) + (stop < t.length && t[stop] === ch ? ch : '');
      i = stop < t.length && t[stop] === ch ? stop + 1 : stop;
      continue;
    }
    out += ch; i++;
  }
  return out;
}

// The index of the `>` that closes a type-argument list opened at `s[i]` (`List<int>`),
// or -1 when `<` is a comparison (`x < y, "a")`): only type-name characters may come between.
function genericEnd(s, i) {
  if (!/[\w$]/.test(s[i - 1] || '')) return -1;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '<') depth++;
    else if (c === '>') { if (--depth === 0) return j; }
    else if (!/[\w\s.,?[\]:*]/.test(c)) return -1;
  }
  return -1;
}

// The index of the bracket that closes the one at `s[open]` (type-argument lists skipped,
// `=>` no bracket), or -1. `s` is masked text.
export function closeOf(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth === 0) return i; }
    else if (c === '<') { const e = genericEnd(s, i); if (e > 0) i = e; }
  }
  return -1;
}

// Top-level comma-separated parts of `body`, cut where its masked copy has the commas.
function listPartsMasked(body, masked) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === '<') { const e = genericEnd(masked, i); if (e > 0) i = e; }
    else if (ch === ',' && depth === 0) { parts.push(body.slice(from, i)); from = i + 1; }
  }
  parts.push(body.slice(from));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Top-level comma-separated parts of a parameter / argument list.
export function listParts(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * `Owner.Method(int, string)` → { name: 'Owner.Method', params: ['int', 'string'] };
 * `Method()` → params []; a symbol without a closing parameter list → params null.
 */
export function splitParameterList(symbol) {
  const raw = String(symbol || '').trim();
  // C++ `operator()(int)`: the name's own `()` is no parameter list.
  const op = /\boperator\s*\(\s*\)/.exec(raw);
  const open = raw.indexOf('(', op ? op.index + op[0].length : 0);
  if (open <= 0 || !raw.endsWith(')')) return { name: raw, params: null };
  const name = raw.slice(0, open).trim();
  // The list must close at the end: `a(b).c()` is no parameter list.
  if (!name || /[()]/.test(name.replace(/\boperator\s*\(\s*\)/, '')) || parenBody(raw, open) !== raw.slice(open + 1, -1)) return { name: raw, params: null };
  // `Repo<T>.Get<TKey>(TKey)`: the stored names carry no type arguments.
  const bare = name.replace(/<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>/g, '').trim();
  const body = raw.slice(open + 1, -1);
  // `M(,)` / `M(a,)`: an empty item is no list (the symbol is then looked up as written).
  if (/^\s*,|,\s*,|,\s*$/.test(maskCode(body))) return { name: raw, params: null };
  return { name: bare || name, params: listParts(body).filter((p) => p !== 'void') };
}

// C# keyword types and their System names (the two spellings of one type).
const TYPE_ALIASES = new Map(Object.entries({
  int32: 'int', uint32: 'uint', int64: 'long', uint64: 'ulong', int16: 'short', uint16: 'ushort',
  boolean: 'bool', single: 'float', sbyte: 'sbyte', intptr: 'nint', uintptr: 'nuint',
}));
// String, Object, Double, Decimal, Byte, Char: the same word in both spellings (case is ignored).

const MODIFIERS = /^(?:ref|out|in|params|this|final|const|readonly|scoped|volatile|mut|var|val|let|inout|vararg|noalias|restrict|register|struct|enum|class)$/;

function normalizeType(text) {
  const t = String(text || '')
    .replace(/\b(?:global::)/g, '')
    .replace(/\b(?:const|volatile|struct|class|enum)\b/g, ' ')
    .replace(/[&*?!^]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  // Namespace qualifiers of every type part: `System.Collections.Generic.List<System.String>` → `list<string>`.
  return t.replace(/(?:[a-z_$][\w$]*(?:\.|::))+(?=[a-z_$][\w$]*)/g, '')
    .replace(/[a-z_$][\w$]*/g, (w) => TYPE_ALIASES.get(w) || w);
}

const head = (t) => t.replace(/[<[].*$/, '');

/** One declared parameter: its name (when written) and its type text (when written). */
export function parseParameter(text) {
  let p = String(text || '')
    .replace(/^\s*(?:\[[^\]]*\]\s*)+/, '') // C# attributes
    .replace(/(?:^|\s)@[\w.]+(?:\([^)]*\))?/g, ' '); // Java / Kotlin annotations
  // A default value (`int n = 0`; not `=>` in a lambda type).
  const eq = p.search(/=(?!>)/);
  if (eq >= 0) p = p.slice(0, eq);
  p = p.trim();
  const colon = p.search(/(?<!:):(?!:)/);
  if (colon >= 0) {
    // `name: Type` (TypeScript, Kotlin, Swift, Scala, Rust, Python annotations).
    const name = p.slice(0, colon).trim().split(/\s+/).filter((w) => !MODIFIERS.test(w)).pop() || '';
    return { name: name.replace(/^[.*&]+|\?$/g, ''), type: p.slice(colon + 1).trim() };
  }
  const words = p.split(/\s+(?![^<>()[\]]*[>)\]])/).filter((w) => w && !MODIFIERS.test(w));
  if (words.length < 2) return { name: words[0] || '', type: '' };
  const name = words.pop();
  return { name: name.replace(/^[.*&]+|\[\]$/g, ''), type: `${words.join(' ')}${/[*&]/.test(name) ? '*' : ''}` };
}

/**
 * How well a written item fits a declared parameter: 3 = its exact type, 2 = its type's
 * head (`List` for `List<int>`) or its name, 1 = every written word is a word of the
 * parameter, 0 = no fit. `int id` must fit both the type and the name.
 */
export function parameterFit(written, declared) {
  // `ref T` / `params T[]` / `this T`: the modifier must be the declared one; the type decides.
  const mod = /^\s*(ref|out|in|params|this)\s+/.exec(String(written || ''));
  if (mod && !new RegExp(`(?:^|\\s)${mod[1]}\\s`).test(` ${String(declared || '').replace(/^\s*(?:\[[^\]]*\]\s*)+/, '')}`)) return 0;
  const want = String(written || '').trim().replace(/^(?:ref|out|in|params|this)\s+/, '');
  if (!want) return 0;
  const { name, type } = parseParameter(declared);
  const nType = normalizeType(type);
  const nName = name.toLowerCase();
  // The whole item as a type first (`unsigned int`, `long long`), then `type name`.
  const w = normalizeType(want);
  if (nType && w === nType) return exactness(want, type);
  const typed = parseParameter(want);
  if (typed.type && typed.name) {
    const t = parameterFit(typed.type, declared);
    return t >= 2 && typed.name.toLowerCase() === nName ? 3 : 0;
  }
  if (nType && w === head(nType)) return Math.min(2, exactness(want, type));
  if (w === nName) return 2;
  const words = new Set((`${type} ${name}`.match(/[A-Za-z_$][\w$]*/g) || []).map((x) => normalizeType(x)));
  const wantWords = want.match(/[A-Za-z_$][\w$]*/g) || [];
  return wantWords.length && wantWords.every((x) => words.has(normalizeType(x))) ? 1 : 0;
}

// The parts normalizeType drops: namespace qualifiers and `?` / `*` / `&` marks.
const qualified = (t) => String(t || '').replace(/\bglobal::/g, '').replace(/\s+/g, '').replace(/::/g, '.').replace(/[?*&!^]+/g, '').toLowerCase();
const marks = (t) => (String(t || '').replace(/\s+/g, '').match(/[?*&]/g) || []).sort().join('');

// 3 when a written type that matches by name also matches in what the name leaves out:
// `A.Order` against a declared `B.Order` fits not at all, against a bare `Order` only
// as a name (2); `int` against `int?` or `int*` fits as a name (2), not exactly.
function exactness(written, declared) {
  const wq = qualified(written);
  const dq = qualified(declared);
  if (wq.includes('.') && dq.includes('.') && !(dq.endsWith(wq) || wq.endsWith(dq))) return 0;
  if (wq.includes('.') && !dq.includes('.')) return 2;
  return marks(written) === marks(declared) ? 3 : 2;
}

const VARIADIC = /\.\.\.|^\*|\bparams\b|vararg/;

/** The declared parameters of `name`'s definition in `source` (null: no list found). */
export function declaredParameters(source, name) {
  const text = String(source || '');
  const masked = maskCode(text);
  const at = masked.search(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:<[^()]*>)?\\s*\\(`));
  if (at < 0) return null;
  const open = masked.indexOf('(', at);
  const close = closeOf(masked, open);
  if (close < 0) return null;
  return listPartsMasked(text.slice(open + 1, close), masked.slice(open + 1, close)).filter((p) => p !== 'void' && p !== 'self' && p !== '&self' && p !== '&mut self');
}

/**
 * Score of a definition for a written parameter list: null when the list does not fit
 * (wrong count, or an item fits no parameter at its position), else the sum of the fits.
 */
export function overloadScore(written, declared) {
  if (!declared) return null;
  const variadic = declared.length > 0 && VARIADIC.test(declared[declared.length - 1]);
  const min = declared.filter((p) => !/=(?!>)/.test(p) && !VARIADIC.test(p)).length;
  if (written.length < min || (!variadic && written.length > declared.length)) return null;
  let score = 0;
  for (let i = 0; i < written.length; i++) {
    const fit = parameterFit(written[i], declared[Math.min(i, declared.length - 1)]);
    if (!fit) return null;
    score += fit;
  }
  // The exact count first: `Write(string)` over `Write(string, params object[])`.
  return score + (written.length === declared.length ? 1 : 0);
}

/**
 * The candidates reordered by fit to a written parameter list (the written owner's
 * definitions first, then the best fit, the existing order between equal fits). `matched` is false when no candidate fits: the
 * order is then unchanged.
 */
export function selectOverload(candidates, written, readParameters, owner = null) {
  const scored = candidates.map((c, i) => ({ c, i, s: overloadScore(written, readParameters(c)), own: owner && c.parentClass === owner ? 1 : 0 }));
  // A written owner that has the name: only its definitions can fit (`Repo.M(int)` is
  // no `Other.M(int)`). The order then still lists the owner's definitions first.
  const owned = owner && scored.some((x) => x.own);
  const fitting = scored.filter((x) => x.s != null && (!owned || x.own));
  if (!fitting.length && owned) return { candidates: [...scored].sort((a, b) => b.own - a.own || a.i - b.i).map((x) => x.c), matched: false };
  if (!fitting.length) return { candidates, matched: false };
  // A written owner (`Owner.Save(int)`) comes before the fit: another class's Save is not meant.
  fitting.sort((a, b) => b.own - a.own || b.s - a.s || a.i - b.i);
  // The owner's other overloads lead the alternatives too.
  const chosen = new Set(fitting);
  const rest = scored.filter((x) => !chosen.has(x)).sort((a, b) => b.own - a.own || a.i - b.i);
  return { candidates: [...fitting, ...rest].map((x) => x.c), matched: true };
}

// ── Call sites: which overload a call's argument types fit ────────────────────────────

const PRIMITIVES = new Set(['int', 'uint', 'long', 'ulong', 'short', 'ushort', 'byte', 'sbyte', 'char', 'bool', 'boolean', 'string', 'float', 'double', 'decimal', 'nint', 'nuint']);
const NUMERIC = new Set(['int', 'uint', 'long', 'ulong', 'short', 'ushort', 'byte', 'sbyte', 'float', 'double', 'decimal', 'nint', 'nuint']);
const NOT_A_TYPE = /^(?:return|new|var|out|ref|in|is|as|await|yield|case|else|throw|using|goto|const|static|readonly|public|private|protected|internal|virtual|override|sealed|abstract|async|unsafe|extern|params|this|base|typeof|sizeof|nameof|default|not|and|or|when|from|where|select|let|fixed|lock|delete|operator|import|package|throws)$/;
// C# and its views: call sites are re-bound by argument types only here (the typing
// follows C# conversion rules; Swift labels, Kotlin trailing lambdas, Java boxing and C++
// pointers would need their own).
export const REBIND_FILE = /\.(?:cs|cshtml|razor|aspx|ascx|master|asax|ashx|asmx|svc)$/i;
// Languages that pick an overload by argument types at compile time.
export const STATIC_OVERLOAD_FILE = /\.(?:cs|java|kt|kts|scala|swift|cpp|cc|cxx|c\+\+|hpp|hh|hxx|h|cshtml|razor|aspx|ascx|master|asax|ashx|asmx|svc)$/i;

/** The argument texts of the first `name(` call in `text` (null: no call there, or a spread). */
export function callArguments(text, name) {
  const t = String(text || '');
  const masked = maskCode(t);
  const m = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(<[^()]*>)?\\s*\\(`).exec(masked);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = closeOf(masked, open);
  if (close < 0) return null;
  const body = masked.slice(open + 1, close);
  if (/\.\.\.|^\s*\*\w/.test(body)) return null; // spread: count unknown
  const args = listPartsMasked(t.slice(open + 1, close), body);
  // `Get<int>(…)`: explicit type arguments (only generic overloads apply).
  args.typeArguments = Boolean(m[1]);
  return args;
}

const TYPE_TEXT = String.raw`(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*(?:\s*<(?:[^<>;(){}=]|<[^<>;(){}=]*>)*>)?(?:\s*\[\s*,*\s*\])*\??`;

// The declared type of a local / parameter `name` in `scope` (C-style `Type name`), or
// the type of what `var name = …` assigns.
function localType(name, rawScope, depth, returnTypeOf) {
  // Declarations are read from code only; an initialiser is read from the original text.
  const scope = maskCode(rawScope);
  const decl = new RegExp(`(?<![\\w.])(${TYPE_TEXT})[ \\t]+${name}\\s*(?=[,)=;:&|]|\\bin\\b|$)`, 'gm');
  let found = null;
  let at = -1;
  for (const m of String(scope || '').matchAll(decl)) {
    const t = m[1].trim();
    if (NOT_A_TYPE.test(t) && t !== 'var') continue;
    found = t; // the last declaration before the call wins (shadowing)
    at = m.index;
  }
  if (!found) return null;
  // A lambda parameter of that name after it (`xs.ForEach(i => Save(i))`) is another variable.
  const lambda = new RegExp(`(?:\\(\\s*(?:[\\w\\s,]*,\\s*)?${name}\\s*(?:,[\\w\\s,]*)?\\)|(?<![\\w.])${name})\\s*=>`, 'g');
  for (const m of scope.matchAll(lambda)) if (m.index > at) return null;
  if (/^(?:var|auto|let|val|dynamic)$/.test(found)) {
    if (depth > 0) return null;
    let init = null;
    for (const m of scope.matchAll(new RegExp(`\\b(?:var|auto)\\s+${name}\\s*=\\s*([^;\\n]+)`, 'g'))) init = m;
    if (!init) return null;
    const start = init.index + init[0].length - init[1].length;
    return argumentType(String(rawScope).slice(start, start + init[1].length).trim(), rawScope, depth + 1, returnTypeOf);
  }
  return found;
}

/**
 * The type of an argument expression, as far as the call line and its scope show it
 * (null: not known). `returnTypeOf(name, qualifier)` gives a called method's return type.
 */
export function argumentType(arg, scope = '', depth = 0, returnTypeOf = null) {
  const a = String(arg || '').trim()
    .replace(/^(?:ref|out|in)\s+/, '')
    .replace(/^[A-Za-z_]\w*\s*:(?!:)\s*/, ''); // a named argument
  if (!a) return null;
  // Each form types the argument only when it is the WHOLE argument: `"abc".Length`,
  // `"a" == s`, `typeof(T).Name` and `new Uri(u).AbsoluteUri` are other types.
  const m = maskCode(a);
  if (/^[$@]{0,3}"[^"]*"$/.test(m)) {
    // A non-constant `$"…{x}…"`: an interpolated-string handler parameter takes it first, then string.
    return /^@?\$/.test(a) && /\{(?!\{)/.test(a.replace(/\{\{/g, '')) ? INTERPOLATED : 'string';
  }
  if (/^'[^']*'$/.test(m)) return 'char';
  if (/^(?:true|false)$/.test(a)) return 'bool';
  const num = /^-?(?:0[xX][\da-fA-F_]+|\d[\d_]*(\.\d[\d_]*)?(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/.exec(a);
  if (num) {
    const suffix = num[2].toLowerCase();
    if (suffix === 'f') return 'float';
    if (suffix === 'd') return 'double';
    if (suffix === 'm') return 'decimal';
    if (suffix === 'l') return 'long';
    if (suffix === 'u') return 'uint';
    if (suffix === 'ul' || suffix === 'lu') return 'ulong';
    return num[1] || /[eE]/.test(a) && !/^0[xX]/.test(a) ? 'double' : 'int';
  }
  const whole = (prefix) => {
    const p = new RegExp(prefix).exec(m);
    if (!p) return null;
    const open = p.index + p[0].length - 1;
    return closeOf(m, open) === m.length - 1 ? p : null;
  };
  if (whole('^nameof\\s*\\(')) return 'string';
  if (whole('^typeof\\s*\\(')) return 'Type';
  const created = new RegExp(`^new\\s+(${TYPE_TEXT.replace(/\\\?$/, '')})\\s*([([{])`).exec(m);
  if (created) {
    // `new T(…)`, `new T { … }`, `new T(…) { … }`, `new T[n]`, `new T[] { … }` — to the end.
    let end = created.index + created[0].length - 1;
    end = closeOf(m, end);
    let rest = end < 0 ? null : m.slice(end + 1).trim();
    if (rest && rest[0] === '{') {
      const brace = m.indexOf('{', end + 1);
      rest = closeOf(m, brace) === m.length - 1 ? '' : null;
    }
    if (rest === '') return `${created[1].replace(/\s+/g, '')}${created[2] === '[' ? '[]' : ''}`;
    return null;
  }
  const cast = /^\(\s*([A-Za-z_][\w.]*(?:<[^()]*>)?(?:\[\])?\??)\s*\)\s*(?=[\w@"($])/.exec(m);
  if (cast && (PRIMITIVES.has(normalizeType(cast[1])) || /^[A-Z]/.test(cast[1].split('.').pop()))) {
    // A cast binds to the primary expression after it: `(T)x.Y` is a T; `(T)x + 1` is not known.
    return primaryChain(m.slice(cast[0].length)) ? cast[1] : null;
  }
  if (/^[A-Za-z_]\w*$/.test(a)) return localType(a, scope, depth, returnTypeOf);
  // `recv.Member`: the member's declared type in the receiver's type (or in the class `Recv`).
  const member = /^([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)$/.exec(a);
  if (member && returnTypeOf) {
    const recv = /^[A-Z]/.test(member[1]) && !localType(member[1], scope, 1, null) ? member[1] : localType(member[1], scope, depth, returnTypeOf);
    const owner = recv ? head(recv.replace(/\s+/g, '')).split('.').pop().replace(/\?$/, '') : null;
    return owner ? returnTypeOf(member[2], owner, { member: true }) : null;
  }
  // `Owner.Method(…)` / `Method(…)`: what that method returns (no type arguments: `Get<T>()` returns T).
  const call = /^(?:([A-Za-z_][\w]*)\s*\.\s*)?([A-Za-z_]\w*)\s*\(/.exec(m);
  if (call && closeOf(m, call[0].length - 1) === m.length - 1) {
    // Object's own method: every type has it, with this return type.
    if (call[2] === 'ToString') return 'string';
    if (!returnTypeOf) return null;
    // `local.Method(…)`: the method of the local's declared type.
    const recv = call[1] && !/^[A-Z]/.test(call[1]) ? localType(call[1], scope, depth, returnTypeOf) : null;
    const owner = recv ? head(recv.replace(/\s+/g, '')).split('.').pop().replace(/\?$/, '') : call[1] || null;
    return returnTypeOf(call[2], owner);
  }
  return null;
}

// `x`, `x.Y`, `x?.Y`, `x.M(…)`, `x[i]`, `x!`: one primary expression, no operator.
function primaryChain(m) {
  let i = 0;
  const s = m.trim();
  const ident = /^[A-Za-z_@$][\w$]*/;
  const first = ident.exec(s) || (s[0] === '(' ? [s.slice(0, closeOf(s, 0) + 1)] : null);
  if (!first || !first[0]) return false;
  i = first[0].length;
  while (i < s.length) {
    const rest = s.slice(i);
    const step = /^(?:\?\.|\.|!)/.exec(rest);
    if (step) {
      i += step[0].length;
      if (step[0] === '!') continue;
      const id = ident.exec(s.slice(i));
      if (!id) return false;
      i += id[0].length;
      continue;
    }
    if (s[i] === '(' || s[i] === '[') {
      const close = closeOf(s, i);
      if (close < 0) return false;
      i = close + 1;
      continue;
    }
    return false;
  }
  return true;
}

const GENERIC_PARAM = /^(?:[A-Z]|T[A-Z0-9]\w*|T)$/;
// The type of a non-constant interpolated string (C# 10 handler conversions).
const INTERPOLATED = '$interpolated';
const HANDLER_PARAM = (text) => /InterpolatedStringHandler\b/.test(String(text || ''));

// How a known argument type relates to a declared parameter type: 'exact', 'generic'
// (a type parameter: identity by inference), a number (supertype steps, from the type
// hierarchy), 'loose' (a known implicit conversion: numeric widening, char to a number,
// object), 'uncertain' (it may or may not convert: two class types the index cannot
// relate) or 'conflict'. C# rules.
function relation(argType, paramType, hierarchy = null) {
  if (!paramType) return 'uncertain';
  if (argType === INTERPOLATED) {
    if (HANDLER_PARAM(paramType)) return 'exact';
    return /^(?:string|object|formattablestring|iformattable)$/.test(normalizeType(paramType)) ? 'loose' : 'conflict';
  }
  const rawHead = paramType.replace(/[<[?].*$/, '').split(/\.|::/).pop().trim();
  const a = normalizeType(argType);
  const p = normalizeType(paramType).replace(/^params/, '');
  const aNullable = /\?\s*$/.test(argType);
  const pNullable = /\?\s*$/.test(paramType);
  if (a === p || (head(a) === head(p) && /\[\]$/.test(a) === /\[\]$/.test(p))) {
    // `int?` to `int` does not convert; `int` to `int?` does, but not as an identity.
    if (PRIMITIVES.has(a) && a !== 'string' && aNullable !== pNullable) return aNullable ? 'conflict' : 'loose';
    return 'exact';
  }
  if (GENERIC_PARAM.test(rawHead)) return 'generic';
  if (p === 'object' || p === 'dynamic') return 'loose';
  // An array is one of its element type's sequence interfaces: `T[]` to `IEnumerable<T>`.
  if (/\[\]$/.test(a)) {
    if (p === 'ienumerable') return 1;
    const elem = /^(?:IEnumerable|ICollection|IList|IReadOnlyList|IReadOnlyCollection)\s*<\s*(.+?)\s*>$/.exec(paramType.trim().split(/\.(?=[A-Z][^.]*$)/).pop())?.[1];
    if (elem && (normalizeType(elem) === a.slice(0, -2) || GENERIC_PARAM.test(elem))) return 1;
  }
  const aPrim = PRIMITIVES.has(a);
  const pPrim = PRIMITIVES.has(p);
  if (aPrim && pPrim) {
    if (aNullable && !pNullable && a !== 'string') return 'conflict';
    if (NUMERIC.has(a) && NUMERIC.has(p)) return 'loose';
    if (a === 'char' && NUMERIC.has(p) && !/^(?:byte|sbyte|short)$/.test(p)) return 'loose';
    return 'conflict';
  }
  // A keyword type to an interface (`int` to `IComparable`): it may implement it.
  if (aPrim) return /^I[A-Z]/.test(rawHead) ? 'uncertain' : 'conflict';
  if (pPrim) return 'conflict';
  // Two class types: the argument's indexed supertypes say whether it is one of the parameter's.
  if (hierarchy) {
    const aName = argType.replace(/[<[?].*$/, '').split(/\.|::/).pop().trim();
    const up = hierarchy.supertypes(aName);
    if (up) {
      const steps = up.get(rawHead);
      if (steps != null) return steps;
      // Both indexed, and no path from the argument's type to the parameter's: no fit.
      if (hierarchy.supertypes(rawHead)) return 'conflict';
    }
  }
  return 'uncertain';
}

const REF_KIND = (text) => /^\s*(ref|out)\b/.exec(String(text || ''))?.[1] || null;

/**
 * The overload a call with these argument types binds to: the one whose parameter count
 * fits and whose parameters no known argument type contradicts, or, among several, the
 * one with the most exact type matches. Null when that is not one overload.
 * `overloads`: [{ key, params: declared parameter texts }].
 */
/** The overloads that take `n` arguments with these argument names (null names: positional). */
export function overloadsTaking(n, overloads, argNames = []) {
  // A named argument (`additionalTexts: null`) needs a parameter of that name.
  const named = (o) => argNames.every((name) => !name || o.params.some((p) => parseParameter(p).name === name));
  return overloads.filter((o) => {
    if (!o.params) return false;
    const variadic = o.params.length > 0 && VARIADIC.test(o.params[o.params.length - 1]);
    const min = o.params.filter((p) => !/=(?!>)/.test(p) && !VARIADIC.test(p)).length;
    return n >= min && (variadic || n <= o.params.length) && named(o);
  });
}

/**
 * The overload a call binds to, or null when that is not certain. `site`: { names
 * (named arguments), mods (`ref` / `out` written at each argument) }. The overloads that
 * take the count and names are scored by the known argument types: a conflict removes
 * one; the winner must match at least one argument exactly (or by a known supertype),
 * have no uncertain argument, and beat the next one on the compiler's order (exact
 * matches, then the nearest supertypes, then the fewest type parameters).
 */
/**
 * The overloads a call can reach by the compiler's shape rules alone: the argument count,
 * the named arguments, and `ref` / `out` written exactly where a parameter has it.
 */
export function overloadsCallable(n, overloads, argNames = [], mods = []) {
  return overloadsTaking(n, overloads, argNames).filter((o) => {
    for (let i = 0; i < n; i++) {
      const decl = argNames[i] ? o.params.find((p) => parseParameter(p).name === argNames[i]) : o.params[Math.min(i, o.params.length - 1)];
      // An interpolated-string handler is declared `ref` and passed without it.
      const declared = HANDLER_PARAM(decl) ? null : REF_KIND(decl) || null;
      if (declared !== (mods[i] === 'in' ? null : mods[i] || null)) return false;
    }
    return true;
  });
}

export function overloadForArguments(argTypes, overloads, argNames = [], hierarchy = null, site = {}) {
  const n = argTypes.length;
  const fits = overloadsCallable(n, overloads, argNames, site.mods || []);
  if (!fits.length || !argTypes.some(Boolean)) return null;
  const scored = [];
  for (const o of fits) {
    let exact = 0;
    let steps = 0;
    let generic = 0;
    let uncertain = 0;
    let conflict = false;
    for (let i = 0; i < n && !conflict; i++) {
      if (!argTypes[i]) continue;
      const byName = argNames[i] ? o.params.find((p) => parseParameter(p).name === argNames[i]) : null;
      const decl = byName || o.params[Math.min(i, o.params.length - 1)];
      let type = parseParameter(decl).type;
      if (!byName && VARIADIC.test(decl) && i >= o.params.length - 1) {
        // `params T[] xs` takes one T per argument, or one T[] as the last argument.
        if (!/\[\]$/.test(normalizeType(argTypes[i]))) type = type.replace(/\[\s*\]\s*$/, '');
        else if (i < n - 1) { conflict = true; break; }
      }
      const r = relation(argTypes[i], type, hierarchy);
      if (r === 'conflict') conflict = true;
      else if (r === 'exact') exact++;
      else if (typeof r === 'number') { exact++; steps += r; }
      else if (r === 'generic') { exact++; generic++; }
      else if (r === 'uncertain') uncertain++;
    }
    if (!conflict) scored.push({ key: o.key, exact, steps, generic, uncertain });
  }
  if (!scored.length) return null;
  const order = (x, y) => y.exact - x.exact || x.steps - y.steps || x.generic - y.generic;
  scored.sort(order);
  const [best, second] = scored;
  if (best.exact === 0 || best.uncertain > 0) return null;
  return !second || order(best, second) < 0 ? best.key : null;
}

/**
 * A type hierarchy over `directSupertypes(name)` (names, or null when no such type is
 * indexed): `supertypes(name)` maps every supertype reachable from `name` (itself at 0)
 * to its step count, or is null for a type the index does not hold.
 */
export function typeHierarchy(directSupertypes, { maxDepth = 8, maxTypes = 200 } = {}) {
  const cache = new Map();
  return {
    supertypes(name) {
      if (cache.has(name)) return cache.get(name);
      const first = directSupertypes(name);
      if (!first) { cache.set(name, null); return null; }
      const seen = new Map([[name, 0]]);
      let frontier = first.map((n) => [n, 1]);
      while (frontier.length && seen.size < maxTypes) {
        const next = [];
        for (const [n, d] of frontier) {
          if (seen.has(n) || d > maxDepth) continue;
          seen.set(n, d);
          for (const up of directSupertypes(n) || []) if (!seen.has(up)) next.push([up, d + 1]);
        }
        frontier = next;
      }
      cache.set(name, seen);
      return seen;
    },
  };
}

/** The declared type in a property / field signature (`public Foo Bar { get; }`, `Foo bar;`, `bar: Foo`), or null. */
export function memberSignatureType(signature, name) {
  const s = String(signature || '');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const colon = new RegExp(`\\b${esc}\\s*\\??\\s*:\\s*([A-Za-z_][\\w.]*(?:<[^{}=;]*?>)?(?:\\[\\])?)`).exec(s);
  if (colon) return colon[1];
  const m = new RegExp(`(${TYPE_TEXT})\\s+${esc}\\s*(?:[{;=]|=>|$)`).exec(s);
  if (!m) return null;
  const t = m[1].trim();
  return NOT_A_TYPE.test(t) ? null : t;
}

/** The return type in a definition's signature (`public static Foo Bar(` / `fun bar(): Foo`), or null. */
export function signatureReturnType(signature, name) {
  const s = String(signature || '');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const colon = new RegExp(`\\b${esc}\\s*(?:<[^()]*>)?\\s*\\(`).exec(s);
  if (!colon) return null;
  const body = parenBody(s, s.indexOf('(', colon.index));
  if (body != null) {
    const after = s.slice(s.indexOf('(', colon.index) + body.length + 2);
    const typed = /^\s*(?::|->)\s*([A-Za-z_][\w.]*(?:<[^{}=]*?>)?\??)/.exec(after);
    if (typed) return GENERIC_PARAM.test(typed[1].replace(/[<?].*$/, '')) ? null : typed[1].trim();
  }
  const before = s.slice(0, colon.index).trim();
  const m = new RegExp(`(${TYPE_TEXT})$`).exec(before);
  if (!m) return null;
  const t = m[1].trim();
  if (GENERIC_PARAM.test(t.replace(/[[?].*$/, ''))) return null; // `T Get<T>()`: the caller's T
  return NOT_A_TYPE.test(t) || /^(?:void|function|def|fn|fun|func|sub|async|Task|ValueTask)$/.test(t) ? null : t;
}

/** The receiver written before the first `name(` call in `text` (`a.b` in `a.b.name(`), '' for a bare call, null when it is not a plain name chain. */
export function callReceiver(text, name) {
  const t = maskCode(text);
  const m = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:<[^()]*>)?\\s*\\(`).exec(t);
  if (!m) return null;
  const before = t.slice(0, m.index);
  const sep = /(?:\?\.|\.|->|::)\s*$/.exec(before);
  if (!sep) return '';
  const chain = /((?:[A-Za-z_]\w*\s*(?:\?\.|\.|::)\s*)*[A-Za-z_]\w*)\s*$/.exec(before.slice(0, sep.index));
  // A receiver ending in `)` / `]` (a call, an index) is no plain name chain.
  return chain && chain.index + chain[0].length === sep.index ? chain[1].replace(/\s+/g, '').replace(/\?\.|::|->/g, '.') : null;
}

/**
 * Whether a call written on `receiver` can reach a member of `owner` (in `namespace`):
 * bare, `this`, `base`, the owner's name (or its namespace-qualified name), or a local
 * whose declared type is the owner. Another class name or a local of another type: no.
 * Unknown receivers (a call result, an untyped local) count as fitting.
 */
export function receiverFits(receiver, owner, namespace = '', scope = '') {
  if (receiver == null || receiver === '' || receiver === 'this' || receiver === 'base' || !owner) return true;
  const parts = receiver.split('.');
  const last = parts[parts.length - 1];
  if (last === owner) {
    if (parts.length === 1) return true;
    const prefix = parts.slice(0, -1).filter((p) => p !== 'global').join('.');
    return namespace === prefix || namespace.endsWith(`.${prefix}`);
  }
  if (parts.length > 1) return true; // `this._svc`, `a.B`: a member of unknown type
  if (/^[A-Z]/.test(last)) return false; // another class's static member (or a property: unknown, so no move)
  const type = localType(last, scope, 0, null);
  return !type || head(normalizeType(type)).split('.').pop() === owner.toLowerCase();
}
