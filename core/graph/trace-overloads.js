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
  const open = raw.indexOf('(');
  if (open <= 0 || !raw.endsWith(')')) return { name: raw, params: null };
  const name = raw.slice(0, open).trim();
  // The list must close at the end: `a(b).c()` is no parameter list.
  if (!name || /[()]/.test(name) || parenBody(raw, open) !== raw.slice(open + 1, -1)) return { name: raw, params: null };
  // `Repo<T>.Get<TKey>(TKey)`: the stored names carry no type arguments.
  const bare = name.replace(/<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>/g, '').trim();
  return { name: bare || name, params: listParts(raw.slice(open + 1, -1)).filter((p) => p !== 'void') };
}

// C# keyword types and their System names (the two spellings of one type).
const TYPE_ALIASES = new Map(Object.entries({
  int32: 'int', uint32: 'uint', int64: 'long', uint64: 'ulong', int16: 'short', uint16: 'ushort',
  boolean: 'bool', single: 'float', sbyte: 'sbyte', intptr: 'nint', uintptr: 'nuint',
}));
// String, Object, Double, Decimal, Byte, Char: the same word in both spellings (case is ignored).

const MODIFIERS = /^(?:ref|out|in|params|this|final|const|readonly|scoped|volatile|mut|var|val|let|inout|vararg|noalias|restrict|register|struct|enum|class|unsigned|signed)$/;

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
  const want = String(written || '').trim();
  if (!want) return 0;
  const { name, type } = parseParameter(declared);
  const nType = normalizeType(type);
  const nName = name.toLowerCase();
  const typed = parseParameter(want);
  // `int id`: a type and a name.
  if (typed.type && typed.name) {
    const t = parameterFit(typed.type, declared);
    return t >= 2 && typed.name.toLowerCase() === nName ? 3 : 0;
  }
  const w = normalizeType(want);
  if (nType && w === nType) return 3;
  if (nType && w === head(nType)) return 2;
  if (w === nName) return 2;
  const words = new Set((`${type} ${name}`.match(/[A-Za-z_$][\w$]*/g) || []).map((x) => normalizeType(x)));
  const wantWords = want.match(/[A-Za-z_$][\w$]*/g) || [];
  return wantWords.length && wantWords.every((x) => words.has(normalizeType(x))) ? 1 : 0;
}

const VARIADIC = /\.\.\.|^\*|\bparams\b|vararg/;

/** The declared parameters of `name`'s definition in `source` (null: no list found). */
export function declaredParameters(source, name) {
  const text = String(source || '');
  const at = text.search(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:<[^()]*>)?\\s*\\(`));
  if (at < 0) return null;
  const body = parenBody(text, text.indexOf('(', at));
  if (body == null) return null;
  return listParts(body).filter((p) => p !== 'void' && p !== 'self' && p !== '&self' && p !== '&mut self');
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
  const fitting = scored.filter((x) => x.s != null);
  if (!fitting.length) return { candidates, matched: false };
  // A written owner (`Owner.Save(int)`) comes before the fit: another class's Save is not meant.
  fitting.sort((a, b) => b.own - a.own || b.s - a.s || a.i - b.i);
  const rest = scored.filter((x) => x.s == null);
  return { candidates: [...fitting, ...rest].map((x) => x.c), matched: true };
}

// ── Call sites: which overload a call's argument types fit ────────────────────────────

const PRIMITIVES = new Set(['int', 'uint', 'long', 'ulong', 'short', 'ushort', 'byte', 'sbyte', 'char', 'bool', 'boolean', 'string', 'float', 'double', 'decimal', 'nint', 'nuint']);
const NUMERIC = new Set(['int', 'uint', 'long', 'ulong', 'short', 'ushort', 'byte', 'sbyte', 'float', 'double', 'decimal', 'nint', 'nuint']);
const NOT_A_TYPE = /^(?:return|new|var|out|ref|in|is|as|await|yield|case|else|throw|using|goto|const|static|readonly|public|private|protected|internal|virtual|override|sealed|abstract|async|unsafe|extern|params|this|base|typeof|sizeof|nameof|default|not|and|or|when|from|where|select|let|fixed|lock|delete|operator|import|package|throws)$/;
// Languages that pick an overload by argument types at compile time.
export const STATIC_OVERLOAD_FILE = /\.(?:cs|java|kt|kts|scala|swift|cpp|cc|cxx|c\+\+|hpp|hh|hxx|h|cshtml|razor|aspx|ascx|master|asax|ashx|asmx|svc)$/i;

/** The argument texts of the first `name(` call in `text` (null: no call there, or a spread). */
export function callArguments(text, name) {
  const m = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:<[^()]*>)?\\s*\\(`).exec(String(text || ''));
  if (!m) return null;
  const body = parenBody(text, m.index + m[0].length - 1);
  if (body == null || /\.\.\.|^\s*\*\w/.test(body)) return null;
  return listParts(body);
}

const TYPE_TEXT = String.raw`(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*(?:\s*<[^;(){}=]*?>)?(?:\s*\[\s*,*\s*\])*\??`;

// The declared type of a local / parameter `name` in `scope` (C-style `Type name`), or
// the type of what `var name = …` assigns.
function localType(name, scope, depth, returnTypeOf) {
  const decl = new RegExp(`(?<![\\w.])(${TYPE_TEXT})\\s+${name}\\s*(?=[,)=;:&|]|\\bin\\b|$)`, 'gm');
  let found = null;
  for (const m of String(scope || '').matchAll(decl)) {
    const t = m[1].trim();
    if (NOT_A_TYPE.test(t) && t !== 'var') continue;
    found = t; // the last declaration before the call wins (shadowing)
  }
  if (!found) return null;
  if (/^(?:var|auto|let|val|dynamic)$/.test(found)) {
    if (depth > 0) return null;
    const init = new RegExp(`\\b(?:var|auto)\\s+${name}\\s*=\\s*([^;\\n]+)`).exec(scope);
    return init ? argumentType(init[1].trim(), scope, depth + 1, returnTypeOf) : null;
  }
  return found;
}

/**
 * The type of an argument expression, as far as the call line and its scope show it
 * (null: not known). `returnTypeOf(name, qualifier)` gives a called method's return type.
 */
export function argumentType(arg, scope = '', depth = 0, returnTypeOf = null) {
  let a = String(arg || '').trim()
    .replace(/^(?:ref|out|in)\s+/, '')
    .replace(/^[A-Za-z_]\w*\s*:(?!:)\s*/, ''); // a named argument
  if (!a) return null;
  if (/^[$@]*"/.test(a) || /^nameof\s*\(/.test(a)) return 'string';
  if (/^'(?:[^'\\]|\\.[^']*)'$/.test(a)) return 'char';
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
  if (/^typeof\s*\(/.test(a)) return 'Type';
  const created = new RegExp(`^new\\s+(${TYPE_TEXT.replace(/\\\?$/, '')})\\s*([([{])`).exec(a);
  if (created) return `${created[1].replace(/\s+/g, '')}${created[2] === '[' ? '[]' : ''}`;
  const cast = /^\(\s*([A-Za-z_][\w.]*(?:<[^()]*>)?(?:\[\])?\??)\s*\)\s*[\w@"($]/.exec(a);
  if (cast && (PRIMITIVES.has(normalizeType(cast[1])) || /^[A-Z]/.test(cast[1].split('.').pop()))) return cast[1];
  if (/^[A-Za-z_]\w*$/.test(a)) return localType(a, scope, depth, returnTypeOf);
  // `recv.Member`: the member's declared type in the receiver's type (or in the class `Recv`).
  const member = /^([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)$/.exec(a);
  if (member && returnTypeOf) {
    const recv = /^[A-Z]/.test(member[1]) && !localType(member[1], scope, 1, null) ? member[1] : localType(member[1], scope, depth, returnTypeOf);
    const owner = recv ? head(recv.replace(/\s+/g, '')).split('.').pop().replace(/\?$/, '') : null;
    return owner ? returnTypeOf(member[2], owner, { member: true }) : null;
  }
  // `Owner.Method(…)` / `Method(…)`: what that method returns.
  const call = /^(?:([A-Za-z_][\w]*)\s*\.\s*)?([A-Za-z_]\w*)\s*(?:<[^()]*>)?\s*\(/.exec(a);
  if (call && parenBody(a, call[0].length - 1) === a.slice(call[0].length, -1)) {
    // Object's own methods: every type has them, with these return types.
    if (/^(?:ToString|nameof)$/.test(call[2])) return 'string';
    if (!returnTypeOf) return null;
    // `local.Method(…)`: the method of the local's declared type.
    const recv = call[1] && !/^[A-Z]/.test(call[1]) ? localType(call[1], scope, depth, returnTypeOf) : null;
    const owner = recv ? head(recv.replace(/\s+/g, '')).split('.').pop().replace(/\?$/, '') : call[1] || null;
    return returnTypeOf(call[2], owner);
  }
  return null;
}

const GENERIC_PARAM = /^(?:[A-Z]|T[A-Z0-9]\w*|T)$/;

// How a known argument type relates to a declared parameter type.
function relation(argType, paramType) {
  if (!paramType) return 'loose';
  const rawHead = paramType.replace(/[<[?].*$/, '').split(/\.|::/).pop().trim();
  const a = normalizeType(argType);
  const p = normalizeType(paramType).replace(/^params/, '');
  if (a === p || a.replace(/\?$/, '') === p) return 'exact';
  if (head(a) === head(p) && /\[\]$/.test(a) === /\[\]$/.test(p)) return 'exact';
  if (GENERIC_PARAM.test(rawHead) || p === 'object' || p === 'dynamic') return 'loose';
  const aPrim = PRIMITIVES.has(a);
  const pPrim = PRIMITIVES.has(p);
  if (aPrim && pPrim) return NUMERIC.has(a) && NUMERIC.has(p) ? 'loose' : 'conflict';
  if (aPrim) return /^I[A-Z]/.test(rawHead) ? 'loose' : 'conflict';
  if (pPrim) return 'conflict';
  return 'loose'; // two class types: a subclass or an interface can fit
}

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

export function overloadForArguments(argTypes, overloads, argNames = []) {
  const n = argTypes.length;
  const fits = overloadsTaking(n, overloads, argNames);
  if (fits.length <= 1) return fits[0]?.key ?? null;
  const scored = [];
  for (const o of fits) {
    let exact = 0;
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
      const r = relation(argTypes[i], type);
      if (r === 'conflict') conflict = true;
      else if (r === 'exact') exact++;
    }
    if (!conflict) scored.push({ key: o.key, exact });
  }
  if (scored.length === 1) return scored[0].key;
  if (!scored.length) return null;
  scored.sort((x, y) => y.exact - x.exact);
  return scored[0].exact > 0 && scored[0].exact > scored[1].exact ? scored[0].key : null;
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
    if (typed) return typed[1].trim();
  }
  const before = s.slice(0, colon.index).trim();
  const m = new RegExp(`(${TYPE_TEXT})$`).exec(before);
  if (!m) return null;
  const t = m[1].trim();
  return NOT_A_TYPE.test(t) || /^(?:void|function|def|fn|fun|func|sub|async|Task|ValueTask)$/.test(t) ? null : t;
}
