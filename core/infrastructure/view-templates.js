/**
 * ASP.NET view templates: Razor (.cshtml, .razor) and ASP.NET pages with `<% %>` code
 * (.aspx, .ascx, .master, .asax, .ashx, .asmx, .svc).
 *
 * scanRazor and scanAspNet split a file into markup and C# by the rules of the Razor and
 * ASP.NET page parsers. A scan is a tree of nodes; markup is what no node covers:
 *
 *   expr       an expression the page writes: `@Model.Name`, `@(a + b)`, `<%= x %>`;
 *              `code` is its C# range
 *   block      `@{ ... }`: C# statements; `holes` are the markup spans inside the C#
 *   control    `@if (...) { } else { }`, `@foreach`, `@using (...)`, `@try`, ...: C# with holes
 *   members    `@functions { }`, `@code { }`, `<script runat="server">`: class members
 *   section    `@section Name { markup }` (children: the nodes in its markup)
 *   directive  `@model T`, `@inject T x`, `@using N`, `<%@ Page Inherits="T" %>`, ...
 *   nugget     `<% statements %>` (statements may span several nuggets: `<% if (x) { %>`)
 *   handler    an `On<Event>="Method"` attribute of a server control, or Blazor `@onclick`
 *   comment    `@* *@`, `<%-- --%>`; escape `@@`
 *   csharp     the C# body of a .ashx / .asmx file (after its directive)
 *
 * projectToCSharp turns a scan into the C# class the view compiles to, line for line: every
 * C# span stays on its line, markup becomes blank, and the expressions become statements.
 * The C# grammar then reads a view like a .cs file (graph entities, calls), and the view
 * chunker reads C# statement and member boundaries from it.
 */

import path from 'path';

export const RAZOR_EXTENSIONS = ['.cshtml', '.razor'];
export const ASPNET_EXTENSIONS = ['.aspx', '.ascx', '.master', '.asax', '.ashx', '.asmx', '.svc'];
// Files whose body after the directive is C# (not markup).
const ASPNET_CODE_FILE_EXTENSIONS = new Set(['.ashx', '.asmx']);

// The render method of a projected view. Graph extraction drops it and moves its edges to
// the file node: they are the view's own calls.
export const VIEW_RENDER_METHOD_PREFIX = '__ViewRender';
/** The projection's call that holds a section's code (graph extraction drops it). */
export const VIEW_SECTION_CALL = '__ViewSection';

/** 'razor' | 'aspnet' | null */
export function viewTemplateKind(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (RAZOR_EXTENSIONS.includes(ext)) return 'razor';
  if (ASPNET_EXTENSIONS.includes(ext)) return 'aspnet';
  return null;
}

// ---------------------------------------------------------------------------------------------
// C# lexing: literals, comments and balanced brackets
// ---------------------------------------------------------------------------------------------

const isIdStart = (c) => c !== undefined && /[\p{L}_]/u.test(c);
const isIdChar = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
const isAlnum = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isWs = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '﻿';

function lineEnd(t, i, end) {
  const j = t.indexOf('\n', i);
  return j < 0 || j > end ? end : j;
}

/** The index after a C# string, char literal or comment starting at i, else -1. */
function skipCSharpLiteral(t, i, end) {
  const c = t[i];
  if (c === '/' && t[i + 1] === '/') return lineEnd(t, i, end);
  if (c === '/' && t[i + 1] === '*') {
    const j = t.indexOf('*/', i + 2);
    return j < 0 || j + 2 > end ? end : j + 2;
  }
  if (c === "'") return skipCharLiteral(t, i, end);
  let j = i;
  let dollars = 0;
  let verbatim = false;
  while (t[j] === '$') { dollars++; j++; }
  if (t[j] === '@') {
    verbatim = true;
    j++;
    while (t[j] === '$') { dollars++; j++; }
  }
  if (t[j] !== '"') return -1;
  // A raw string has no `@` (`@""""` is a verbatim string holding one quote).
  if (!verbatim && t.startsWith('"""', j)) {
    let n = 0;
    while (t[j + n] === '"') n++;
    const close = t.indexOf('"'.repeat(n), j + n);
    return close < 0 || close + n > end ? end : close + n;
  }
  const interp = dollars > 0;
  for (let k = j + 1; k < end; k++) {
    const ch = t[k];
    if (verbatim) {
      if (ch === '"') {
        if (t[k + 1] === '"') { k++; continue; }
        return k + 1;
      }
    } else {
      if (ch === '\\') { k++; continue; }
      if (ch === '"') return k + 1;
      if (ch === '\n') return k; // unterminated: stop at the line end
    }
    if (interp && ch === '{') {
      if (t[k + 1] === '{') { k++; continue; }
      k = skipInterpolationHole(t, k + 1, end) - 1;
    }
  }
  return end;
}

function skipCharLiteral(t, i, end) {
  let k = i + 1;
  if (t[k] === '\\') k += 2; else k += 1;
  for (let n = 0; n < 8 && k < end && t[k] !== '\n'; n++, k++) {
    if (t[k] === "'") return k + 1;
  }
  return i + 1; // not a char literal
}

function skipInterpolationHole(t, k, end) {
  let depth = 0;
  while (k < end) {
    const lit = skipCSharpLiteral(t, k, end);
    if (lit >= 0) { k = lit; continue; }
    const ch = t[k];
    if (ch === '{') depth++;
    else if (ch === '}') {
      if (depth === 0) return k + 1;
      depth--;
    }
    k++;
  }
  return end;
}

/**
 * t[i] is ( [ or {: the index after its match (C# literals skipped), or -1. `end` bounds the
 * search: an unclosed `@if (` must not read the rest of the file once per `@if`.
 */
function matchBalanced(t, i, end) {
  const open = t[i];
  const close = open === '(' ? ')' : open === '[' ? ']' : '}';
  let depth = 0;
  let k = i;
  while (k < end) {
    const lit = skipCSharpLiteral(t, k, end);
    if (lit >= 0) { k = lit; continue; }
    const ch = t[k];
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return k + 1;
    k++;
  }
  return -1;
}

function skipWs(t, i, end) {
  while (i < end && isWs(t[i])) i++;
  return i;
}

/** Past whitespace and C# comments. */
function skipWsAndComments(t, i, end) {
  for (;;) {
    i = skipWs(t, i, end);
    if (t[i] === '/' && (t[i + 1] === '/' || t[i + 1] === '*')) {
      i = skipCSharpLiteral(t, i, end);
      continue;
    }
    return i;
  }
}

function readIdent(t, i) {
  let k = i;
  while (isIdChar(t[k])) k++;
  return t.slice(i, k);
}

function startsWithWord(t, i, word) {
  return t.startsWith(word, i) && !isIdChar(t[i + word.length]);
}

// ---------------------------------------------------------------------------------------------
// Razor
// ---------------------------------------------------------------------------------------------

// `@word (...) { }` statements. `using` is a statement only with a parenthesis (else a directive).
const RAZOR_CONTROL_KEYWORDS = new Set(['if', 'for', 'foreach', 'while', 'switch', 'lock', 'try', 'do', 'using']);
// Line directives (to the line end).
const RAZOR_DIRECTIVES = new Set([
  'model', 'using', 'inject', 'inherits', 'implements', 'layout', 'page', 'namespace', 'attribute',
  'typeparam', 'addTagHelper', 'removeTagHelper', 'tagHelperPrefix', 'preservewhitespace', 'rendermode',
]);
// C# reserved words: `@class` in code is a verbatim identifier (`int @class = 0; @class++;`),
// unless an expression goes on from it (`@string.Format(...)`).
const CSHARP_RESERVED = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const',
  'continue', 'decimal', 'default', 'delegate', 'double', 'else', 'enum', 'event', 'explicit', 'extern',
  'false', 'finally', 'fixed', 'float', 'goto', 'implicit', 'in', 'int', 'interface', 'internal', 'is',
  'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'private',
  'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof', 'stackalloc',
  'static', 'string', 'struct', 'this', 'throw', 'true', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe',
  'ushort', 'virtual', 'void', 'volatile',
]);
// How far a control header `(...)` or an implicit expression's `(...)` may run: longer ones
// are unclosed, and reading on would make the scan quadratic.
const HEADER_SCAN_LIMIT = 8192;
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

class RazorScanner {
  constructor(text) {
    this.t = text;
    this.n = text.length;
  }

  scan() {
    const { children } = this.markup(0, { });
    return { kind: 'root', s: 0, e: this.n, children };
  }

  _atLineStart(i) {
    for (let k = i - 1; k >= 0; k--) {
      const c = this.t[k];
      if (c === '\n') return true;
      if (c !== ' ' && c !== '\t' && c !== '﻿') return false;
    }
    return true;
  }

  /**
   * Markup from i, with its @ transitions. Stops at the end of text, at an unmatched `}`
   * (stopBrace: returns its index), after the matching `</stopTag>`, or at the line end (line).
   */
  markup(i, { stopBrace = false, stopTag = null, line = false, raw: rawStart = null } = {}) {
    const t = this.t;
    const children = [];
    let depth = 0; // braces (stopBrace) or nested stopTag elements
    let raw = rawStart; // inside <script>/<style>: the element name
    while (i < this.n) {
      const c = t[i];
      if (line && c === '\n') return { end: i, children };
      if (c === '@') {
        const node = this.transition(i, false);
        if (node) {
          children.push(node);
          i = node.e;
          continue;
        }
        i++;
        continue;
      }
      if (stopBrace && raw === null) {
        if (c === '{') depth++;
        else if (c === '}') {
          if (depth === 0) return { end: i, children };
          depth--;
        }
      }
      if (c === '<') {
        if (raw !== null) {
          if (t[i + 1] === '/' && t.slice(i + 2, i + 2 + raw.length).toLowerCase() === raw && !/[\w:.-]/.test(t[i + 2 + raw.length] ?? '')) {
            raw = null;
            continue; // the end tag: read again outside raw text (it may close stopTag)
          }
          i++;
          continue;
        }
        if (t.startsWith('<!--', i)) {
          const j = t.indexOf('-->', i + 4);
          const stop = j < 0 ? this.n : j + 3;
          // Razor runs the @ transitions inside HTML comments too.
          for (const node of this.transitionsIn(i + 4, stop)) children.push(node);
          i = stop;
          continue;
        }
        if (t[i + 1] === '/' && stopTag) {
          const name = readTagName(t, i + 2);
          if (name.toLowerCase() === stopTag.toLowerCase()) {
            if (depth === 0) {
              const gt = t.indexOf('>', i);
              return { end: gt < 0 ? this.n : gt + 1, children };
            }
            depth--;
          }
        }
        if (isIdStart(t[i + 1])) {
          const tag = this.startTag(i);
          for (const node of tag.children) children.push(node);
          const lower = tag.name.toLowerCase();
          if (!tag.selfClosing && stopTag && lower === stopTag.toLowerCase() && !VOID_ELEMENTS.has(lower)) depth++;
          if (!tag.selfClosing && RAW_TEXT_ELEMENTS.has(lower)) raw = lower;
          i = tag.end;
          continue;
        }
      }
      i++;
    }
    return { end: this.n, children };
  }

  /** The @ transitions in [from, to) (HTML comment text). */
  transitionsIn(from, to) {
    const out = [];
    // Scan inside [from, to) only: an unclosed `@{` in a comment must not read the rest of the file.
    const n = this.n;
    this.n = to;
    try {
      for (let k = this.t.indexOf('@', from); k >= 0 && k < to; k = this.t.indexOf('@', k + 1)) {
        const node = this.transition(k, false);
        if (node && node.e <= to) {
          out.push(node);
          k = node.e - 1;
        }
      }
    } finally {
      this.n = n;
    }
    return out;
  }

  /** A start tag `<name ...>` at i: its attributes may hold @ transitions and directive attributes. */
  startTag(i) {
    const t = this.t;
    const name = readTagName(t, i + 1);
    const children = [];
    let k = i + 1 + name.length;
    let quote = null;
    while (k < this.n) {
      const c = t[k];
      if (c === '@') {
        // Directive attributes (`@onclick=`) stand at an attribute's place, not in a value.
        const node = this.transition(k, !quote);
        if (node) {
          children.push(node);
          k = node.e;
          continue;
        }
      } else if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        this.csharpAttributes(name, i, k, children);
        return { name, end: k + 1, selfClosing: t[k - 1] === '/', children };
      }
      k++;
    }
    return { name, end: this.n, selfClosing: true, children };
  }

  /**
   * Attribute values that are C# without an `@`: a component's event parameter
   * (`<MudButton OnClick="Submit">`, `<EditForm OnValidSubmit="Save">`) and `asp-items`.
   */
  csharpAttributes(tagName, from, to, children) {
    const component = /^[A-Z]/.test(tagName);
    const tag = this.t.slice(from, to);
    for (const m of tag.matchAll(/\s(On[A-Z]\w*|asp-items)\s*=\s*"([^"@][^"]*)"/g)) {
      if (m[1] !== 'asp-items' && !component) continue;
      const s = from + m.index + m[0].lastIndexOf(m[2]);
      if (children.some((c) => c.s <= s && c.e > s)) continue;
      children.push({ kind: m[1] === 'asp-items' ? 'expr' : 'handler', s, e: s + m[2].length, code: [s, s + m[2].length] });
    }
    children.sort((a, b) => a.s - b.s);
  }

  /** The node of the @ transition at i, or null when the @ is text. */
  transition(i, inTag) {
    const t = this.t;
    const next = t[i + 1];
    // An e-mail address: a letter or digit on both sides (`item_@Model.Id` is an expression).
    if (isAlnum(t[i - 1]) && isAlnum(next)) return null;
    if (next === '@') return { kind: 'escape', s: i, e: i + 2 };
    if (next === '*') {
      const j = t.indexOf('*@', i + 2);
      return { kind: 'comment', s: i, e: j < 0 ? this.n : j + 2 };
    }
    if (next === '{') {
      const body = this.code(i + 2);
      const e = Math.min(this.n, body.end + 1);
      return { kind: 'block', s: i, e, code: [i + 1, e], holes: body.holes };
    }
    if (next === '(') {
      const m = this.balanced(i + 1);
      return { kind: 'expr', s: i, e: m.end, code: [i + 2, Math.max(i + 2, m.end - 1)], holes: m.holes };
    }
    if (next === '<' && isIdStart(t[i + 2])) {
      // A Razor template (`@<li>@item</li>`): markup in an expression.
      const hole = this.element(i + 1);
      return { kind: 'template', s: i, e: hole.e, holes: [{ ...hole, template: true }] };
    }
    if (!isIdStart(next)) return null;
    const word = readIdent(t, i + 1);
    const after = i + 1 + word.length;
    if (inTag && (t[after] === '=' || t[after] === ':' || t[after] === '-')) return this.directiveAttribute(i, word, after);
    const nextSig = skipWs(t, after, this.n);
    if (RAZOR_CONTROL_KEYWORDS.has(word) && (word !== 'using' || t[nextSig] === '(')) {
      return this.control(i, word, after);
    }
    if (word === 'section' && !inTag) {
      const name = readIdent(t, nextSig);
      const brace = skipWs(t, nextSig + name.length, this.n);
      if (name && t[brace] === '{') {
        const body = this.markup(brace + 1, { stopBrace: true });
        const e = Math.min(this.n, body.end + 1);
        return { kind: 'section', s: i, e, name, children: body.children, bodyS: brace + 1, bodyE: body.end };
      }
    }
    if ((word === 'functions' || word === 'code') && t[nextSig] === '{' && !inTag) {
      const body = this.code(nextSig + 1);
      const e = Math.min(this.n, body.end + 1);
      return { kind: 'members', s: i, e, name: word, code: [nextSig + 1, body.end], holes: body.holes, open: nextSig, close: body.end };
    }
    if (RAZOR_DIRECTIVES.has(word) && !inTag && this._atLineStart(i) && /\s/.test(t[after] ?? '\n')) {
      const e = lineEnd(t, i, this.n);
      return { kind: 'directive', s: i, e, name: word, value: t.slice(after, e).trim() };
    }
    const holes = [];
    if (word === 'await' && startsWithWord(t, nextSig, 'foreach')) {
      // `@await foreach (var x in xs) { }`: the statement.
      const node = this.control(i, 'foreach', nextSig + 'foreach'.length);
      return { ...node, code: [i + 1, node.e] };
    }
    if (word === 'await') {
      const start = skipWs(t, after, this.n);
      const e = isIdStart(t[start]) ? this.implicitEnd(start, holes) : after;
      return { kind: 'expr', s: i, e, code: [i + 1, e], holes };
    }
    const e = this.implicitEnd(i + 1, holes);
    return { kind: 'expr', s: i, e, code: [i + 1, e], holes };
  }

  /** The end of an implicit expression `a.b(c)[d]?.e` starting at an identifier. */
  implicitEnd(i, holes = null) {
    const t = this.t;
    let k = i + readIdent(t, i).length;
    for (;;) {
      const c = t[k];
      if (c === '(' || c === '[') {
        const m = this.balanced(k, k + HEADER_SCAN_LIMIT);
        if (m.end <= k) return k;
        for (const h of m.holes) holes?.push(h);
        k = m.end;
      } else if (c === '.' && isIdStart(t[k + 1])) {
        k += 1 + readIdent(t, k + 1).length;
      } else if (c === '?' && t[k + 1] === '.' && isIdStart(t[k + 2])) {
        k += 2 + readIdent(t, k + 2).length;
      } else if (c === '?' && t[k + 1] === '[') {
        k++;
      } else if (c === '!' && (t[k + 1] === '.' || t[k + 1] === '[' || t[k + 1] === '(')) {
        k++;
      } else {
        return k;
      }
    }
  }

  /**
   * t[i] is ( or [: the index after its match, and the Razor templates in it (`@<li>...</li>`:
   * markup passed as an argument).
   */
  balanced(i, limit = this.n) {
    const t = this.t;
    const open = t[i];
    const close = open === '(' ? ')' : ']';
    const holes = [];
    let depth = 0;
    let k = i;
    const end = Math.min(this.n, limit);
    while (k < end) {
      if (t[k] === '@' && t[k + 1] === '<' && isIdStart(t[k + 2])) {
        const hole = this.element(k + 1);
        holes.push({ ...hole, s: k, template: true });
        k = hole.e;
        continue;
      }
      const lit = skipCSharpLiteral(t, k, end);
      if (lit >= 0) { k = lit; continue; }
      const c = t[k];
      if (c === open) depth++;
      else if (c === close && --depth === 0) return { end: k + 1, holes };
      k++;
    }
    // Unclosed within the limit: the bracket is text (`@x(` with no `)`), not the rest of the file.
    return { end: end < this.n ? i : this.n, holes: end < this.n ? [] : holes };
  }

  /** `@onclick="M"`, `@bind-Value="x"`, `@bind:event="oninput"` in a tag (Blazor). */
  directiveAttribute(i, word, after) {
    const t = this.t;
    let k = after;
    while (t[k] === ':' || t[k] === '-') k += 1 + readIdent(t, k + 1).length;
    while (isIdChar(t[k]) || t[k] === '-') k++;
    if (t[k] !== '=') return { kind: 'comment', s: i, e: k };
    const q = t[k + 1];
    if (q !== '"' && q !== "'") return { kind: 'comment', s: i, e: k + 1 };
    // The value is C#: `@(...)` to its match, `@x.y` to its end, else to the first quote outside
    // brackets and C# strings (`"() => Go("x")"`).
    let vs = k + 2;
    let ve;
    if (t[vs] === '@' && t[vs + 1] === '(') {
      ve = this.balanced(vs + 1).end;
      vs += 1;
    } else {
      if (t[vs] === '@') vs++;
      let depth = 0;
      let p = vs;
      while (p < this.n && !(depth === 0 && t[p] === q)) {
        const lit = q === '"' && t[p] === '"' ? -1 : skipCSharpLiteral(t, p, this.n);
        if (lit > p) { p = lit; continue; }
        if (t[p] === '(' || t[p] === '[' || t[p] === '{') depth++;
        else if (t[p] === ')' || t[p] === ']' || t[p] === '}') depth = Math.max(0, depth - 1);
        p++;
      }
      ve = p;
    }
    const close = t.indexOf(q, ve);
    const e = close < 0 ? this.n : close + 1;
    const value = [vs, Math.max(vs, ve)];
    // `@bind:event`, `@bind:format`, `@bind:culture` take a string; `@bind:after` / `:set` a
    // method; `:get` and `@onclick:preventDefault` a C# value.
    const modifier = (t.slice(after, k).match(/:([\w-]+)$/) || [])[1];
    if (modifier && ['event', 'format', 'culture'].includes(modifier)) return { kind: 'comment', s: i, e };
    if (modifier === 'after' || modifier === 'set' || (!modifier && /^on/i.test(word))) return { kind: 'handler', s: i, e, code: value };
    return { kind: 'expr', s: i, e, code: value };
  }

  /** `@if (...) { } else if (...) { } else { }` and the other statements. */
  control(i, word, after) {
    const t = this.t;
    const holes = [];
    let k = after;
    const block = (at) => {
      const p = skipWsAndComments(t, at, this.n);
      if (t[p] !== '{') return -1;
      const body = this.code(p + 1);
      for (const h of body.holes) holes.push(h);
      return Math.min(this.n, body.end + 1);
    };
    const paren = (at) => {
      const p = skipWsAndComments(t, at, this.n);
      if (t[p] !== '(') return -1;
      return matchBalanced(t, p, Math.min(this.n, p + HEADER_SCAN_LIMIT));
    };
    if (word !== 'do' && word !== 'try') {
      const p = paren(k);
      if (p < 0) return { kind: 'expr', s: i, e: after, code: [i + 1, after] };
      k = p;
    }
    let end = block(k);
    if (end < 0) return { kind: 'expr', s: i, e: k, code: [i + 1, k] };
    for (;;) {
      const q = skipWsAndComments(t, end, this.n);
      if (word === 'if' && startsWithWord(t, q, 'else')) {
        let p = skipWsAndComments(t, q + 4, this.n);
        if (startsWithWord(t, p, 'if')) {
          p = paren(p + 2);
          if (p < 0) break;
        }
        const b = block(p);
        if (b < 0) break;
        end = b;
      } else if (word === 'try' && (startsWithWord(t, q, 'catch') || startsWithWord(t, q, 'finally'))) {
        let p = q + (t.startsWith('catch', q) ? 5 : 7);
        const c = paren(p);
        if (c >= 0) p = c;
        const w = skipWs(t, p, this.n);
        if (startsWithWord(t, w, 'when')) {
          const c2 = paren(w + 4);
          if (c2 >= 0) p = c2;
        }
        const b = block(p);
        if (b < 0) break;
        end = b;
      } else if (word === 'do' && startsWithWord(t, q, 'while')) {
        const p = paren(q + 5);
        if (p < 0) break;
        end = t[p] === ';' ? p + 1 : p;
        break;
      } else {
        break;
      }
    }
    return { kind: 'control', s: i, e: end, name: word, code: [i + 1, end], holes };
  }

  /**
   * C# from i to the unmatched `}` (its index is `end`). Markup inside it (a tag at a statement
   * start, `@:` lines, `<text>`) becomes holes.
   */
  code(i) {
    const t = this.t;
    const holes = [];
    let depth = 0;
    let last = null; // last significant character
    let k = i;
    while (k < this.n) {
      const c = t[k];
      if (isWs(c)) { k++; continue; }
      const statementStart = last === null || last === '{' || last === '}' || last === ';' || last === ':';
      if (c === '@' && t[k + 1] === '*') {
        const j = t.indexOf('*@', k + 2);
        const e = j < 0 ? this.n : j + 2;
        holes.push({ kind: 'comment', s: k, e });
        k = e;
        continue;
      }
      if (c === '@' && t[k + 1] === ':' && statementStart) {
        const line = this.markup(k + 2, { line: true });
        holes.push({ kind: 'markup', s: k, e: line.end, children: line.children });
        k = line.end;
        last = ';';
        continue;
      }
      if (c === '@' && t[k + 1] === '<' && isIdStart(t[k + 2])) {
        const hole = this.element(k + 1);
        holes.push({ ...hole, s: k, template: true });
        k = hole.e;
        last = ';';
        continue;
      }
      if (c === '@' && statementStart && (isIdStart(t[k + 1]) || t[k + 1] === '(')) {
        // `@` in code: `@Html.Raw(x)` writes an expression, `@if (...)` is the statement itself.
        const word = readIdent(t, k + 1);
        if (RAZOR_CONTROL_KEYWORDS.has(word) && word !== 'using') {
          holes.push({ kind: 'comment', s: k, e: k + 1 });
          k++;
          continue;
        }
        // `new { @class = "x" }`: a verbatim identifier being assigned, not a transition.
        const after = skipWs(t, k + 1 + word.length, this.n);
        const assigned = t[after] === '=' && t[after + 1] !== '=';
        const verbatimId = CSHARP_RESERVED.has(word) && !['.', '(', '[', '?'].includes(t[k + 1 + word.length]);
        if (!assigned && !verbatimId) {
          const node = this.transition(k, false);
          if (node) {
            holes.push(node);
            k = node.e;
            last = ';';
            continue;
          }
        }
      }
      if (c === '<' && statementStart && t.startsWith('<!--', k)) {
        const j = t.indexOf('-->', k + 4);
        const e = j < 0 ? this.n : j + 3;
        holes.push({ kind: 'markup', s: k, e, children: this.transitionsIn(k + 4, e) });
        k = e;
        continue;
      }
      if (c === '<' && statementStart && isIdStart(t[k + 1])) {
        const hole = this.element(k);
        holes.push(hole);
        k = hole.e;
        last = ';';
        continue;
      }
      const lit = skipCSharpLiteral(t, k, this.n);
      if (lit >= 0) {
        // A comment leaves the statement position as it was.
        if (c !== '/') last = '"';
        k = lit;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0) return { end: k, holes };
        depth--;
      }
      last = c;
      k++;
    }
    return { end: this.n, holes };
  }

  /** A markup element at i (`<tag ...>...</tag>`, void or self-closing), as a markup hole. */
  element(i) {
    const tag = this.startTag(i);
    const lower = tag.name.toLowerCase();
    if (tag.selfClosing || VOID_ELEMENTS.has(lower)) {
      return { kind: 'markup', s: i, e: tag.end, children: tag.children };
    }
    const body = this.markup(tag.end, { stopTag: tag.name, raw: RAW_TEXT_ELEMENTS.has(lower) ? lower : null });
    for (const node of body.children) tag.children.push(node);
    return { kind: 'markup', s: i, e: body.end, children: tag.children };
  }
}

function readTagName(t, i) {
  let k = i;
  while (k < t.length && /[A-Za-z0-9:_.-]/.test(t[k])) k++;
  return t.slice(i, k);
}

export function scanRazor(text) {
  return new RazorScanner(String(text)).scan();
}

// ---------------------------------------------------------------------------------------------
// ASP.NET pages (<% %>)
// ---------------------------------------------------------------------------------------------

function parseDirectiveAttributes(body) {
  const attrs = {};
  for (const m of body.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
  }
  return attrs;
}

export function scanAspNet(text, filePath = '') {
  const t = String(text);
  const n = t.length;
  const children = [];
  const codeFile = ASPNET_CODE_FILE_EXTENSIONS.has(path.extname(String(filePath)).toLowerCase());
  const scripts = serverScripts(t);
  let si = 0;
  let i = 0;
  while (i < n) {
    while (si < scripts.length && scripts[si].e <= i) si++;
    const open = t.indexOf('<%', i);
    const script = scripts[si];
    if (open < 0 && !script) break;
    if (script && (open < 0 || script.s < open)) {
      children.push(script);
      i = script.e;
      continue;
    }
    if (t.startsWith('<%--', open)) {
      const j = t.indexOf('--%>', open + 4);
      const e = j < 0 ? n : j + 4;
      children.push({ kind: 'comment', s: open, e });
      i = e;
      continue;
    }
    const close = t.indexOf('%>', open + 2);
    const e = close < 0 ? n : close + 2;
    const bodyEnd = close < 0 ? n : close;
    const marker = t[open + 2];
    if (marker === '@') {
      const body = t.slice(open + 3, bodyEnd).trim();
      // `<%@ Language="VB" %>`: the directive name may be left out (then it is Page).
      const word = (body.match(/^[\w.]+/) || [''])[0];
      const name = /^\s*=/.test(body.slice(word.length)) ? '' : word;
      children.push({ kind: 'directive', s: open, e, name, value: body, attrs: parseDirectiveAttributes(body.slice(name.length, name.length + 4096)) });
      if (codeFile) {
        // .ashx / .asmx: the file after its directive is C#.
        children.push({ kind: 'csharp', s: e, e: n, code: [e, n] });
        return { kind: 'root', s: 0, e: n, children };
      }
    } else if (marker === '=' || marker === ':' || marker === '#') {
      // `<%#: x %>`: a binding, HTML-encoded.
      const from = marker === '#' && t[open + 3] === ':' ? open + 4 : open + 3;
      children.push({ kind: 'expr', s: open, e, code: [from, bodyEnd] });
    } else if (marker === '$') {
      children.push({ kind: 'comment', s: open, e }); // an expression builder, not C#
    } else {
      children.push({ kind: 'nugget', s: open, e, code: [open + 2, bodyEnd] });
    }
    i = e;
  }
  // Server controls: `<asp:Button OnClick="Save_Click" runat="server" />`. Read with the
  // nuggets masked, so a tag with `<%# %>` in an attribute is still one tag.
  const masked = maskSpans(t, children);
  for (const m of masked.matchAll(/<[\w:.-]+\b[^<>]*\brunat\s*=\s*["']?server[^<>]*>/gi)) {
    // Event handlers (attribute names are case-insensitive; `OnClientClick` is browser script)
    // and the model-binding methods of data controls.
    for (const a of m[0].matchAll(/\b(on(?!client)\w+|(?:select|insert|update|delete)method)\s*=\s*(["'])([A-Za-z_]\w*)\2/gi)) {
      const at = m.index + a.index + a[0].lastIndexOf(a[3]);
      children.push({ kind: 'handler', s: at, e: at + a[3].length, code: [at, at + a[3].length] });
    }
  }
  children.sort((x, y) => x.s - y.s);
  return { kind: 'root', s: 0, e: n, children };
}

/** `<script runat="server">` elements, in order. */
function serverScripts(t) {
  const out = [];
  const lower = t.toLowerCase();
  const re = /<script\b([^>]*)>/gi;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const bodyS = m.index + m[0].length;
    const closeRe = /<\/script\s*>/gi;
    closeRe.lastIndex = bodyS;
    const closeMatch = closeRe.exec(t);
    const close = closeMatch ? closeMatch.index : -1;
    const bodyE = close < 0 ? t.length : close;
    if (!/\brunat\s*=\s*["']?server/i.test(m[1])) {
      re.lastIndex = bodyE;
      continue;
    }
    const gt = close < 0 ? -1 : t.indexOf('>', close);
    const e = gt < 0 ? t.length : gt + 1;
    out.push({ kind: 'members', s: m.index, e, name: 'script', code: [bodyS, bodyE], holes: [], open: bodyS - 1, close: bodyE });
    re.lastIndex = e;
  }
  return out;
}

function maskSpans(t, spans) {
  const parts = [];
  let pos = 0;
  for (const sp of spans) {
    if (sp.s < pos) continue;
    parts.push(t.slice(pos, sp.s), ' '.repeat(sp.e - sp.s));
    pos = sp.e;
  }
  parts.push(t.slice(pos));
  return parts.join('');
}

/** The scan of a view file, or null when the file is no view template. */
export function scanViewTemplate(text, filePath) {
  const kind = viewTemplateKind(filePath);
  if (kind === 'razor') return scanRazor(text);
  if (kind === 'aspnet') return scanAspNet(text, filePath);
  return null;
}

// ---------------------------------------------------------------------------------------------
// C# projection
// ---------------------------------------------------------------------------------------------

/** The class a view compiles to: `Counter` for Counter.razor, `List_cshtml`, `Default_aspx`. */
export function viewClassName(filePath) {
  const ext = path.extname(String(filePath));
  const ident = (v) => String(v).replace(/[^A-Za-z0-9_]/g, '_');
  const base = ident(path.basename(String(filePath), ext)) || 'View';
  // A Blazor component's class is its file name. A page or MVC view compiles to a class named
  // by its path (`Views_Order_List`): the folder keeps two `Default.aspx` apart.
  const folder = path.basename(path.dirname(String(filePath)));
  const dir = folder && folder !== '.' ? ident(folder) : '';
  const name = ext.toLowerCase() === '.razor' ? base : `${dir ? `${dir}_` : ''}${base}_${ext.slice(1)}`;
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

/** A page whose code is not C# (`<%@ Page Language="VB" %>`): no projection. */
function aspNetLanguage(scan) {
  for (const c of scan.children) {
    if (c.kind === 'directive' && c.attrs?.language) return c.attrs.language.toLowerCase();
  }
  return 'c#';
}

/**
 * The C# a view compiles to, with every line where it was (columns may move). Null when the
 * file is no view template or its code is not C#.
 */
export function projectToCSharp(text, filePath, scan = scanViewTemplate(text, filePath)) {
  if (!scan) return null;
  const t = String(text);
  const kind = viewTemplateKind(filePath);
  if (kind === 'aspnet' && !['c#', 'cs', 'csharp'].includes(aspNetLanguage(scan))) return null;

  const usings = [];
  const fields = [];
  const bases = [];
  let typeParams = [];
  const constraints = [];
  const attributes = [];
  let namespace = null;
  const directives = [];
  collectDirectives(scan, directives);
  for (const d of directives) {
    // `@inherits Base // why` takes C# comments after the directive.
    const v = (d.value || '').replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim().replace(/;\s*$/, '');
    if (kind === 'razor') {
      if (d.name === 'using') usings.push(`using ${v.replace(/;$/, '')};`);
      else if (d.name === 'model') fields.push(`public ${v} Model;`);
      else if (d.name === 'inject') {
        const m = v.match(/^(.+?)\s+([A-Za-z_]\w*)\s*;?$/);
        if (m) fields.push(`public ${m[1]} ${m[2]};`);
      } else if (d.name === 'inherits') bases.unshift(v);
      else if (d.name === 'implements') bases.push(v);
      else if (d.name === 'typeparam') {
        const [param, where] = v.split(/\s+where\s+/);
        typeParams.push(param.trim());
        if (where) constraints.push(`where ${where.trim()}`);
      } else if (d.name === 'namespace') namespace = v;
      else if (d.name === 'attribute') attributes.push(v);
    } else {
      const a = d.attrs || {};
      if (d.name.toLowerCase() === 'import' && a.namespace) usings.push(`using ${a.namespace};`);
      if (a.inherits) bases.unshift(a.inherits);
    }
  }
  typeParams = typeParams.filter(Boolean);

  // Body: C# where it is, markup blank (newlines kept).
  const out = [];
  let pos = 0;
  let renders = 0;
  const blank = (to) => {
    if (to <= pos) return;
    out.push(t.slice(pos, to).replace(/[^\n]/g, ' '));
    pos = to;
  };
  const verbatim = (to) => {
    if (to <= pos) return;
    out.push(t.slice(pos, to));
    pos = to;
  };
  const codeWithHoles = (from, to, holes) => {
    blank(from);
    for (const h of [...(holes || [])].sort((a, b) => a.s - b.s)) {
      if (h.s < pos || h.e > to) continue;
      verbatim(h.s);
      if (h.template) {
        // Markup as a value (a RenderFragment): the lambda it compiles to, with its expressions.
        out.push('(__builder) => {');
        emitMarkup(h);
        out.push('}');
      } else if (h.kind === 'markup') {
        emitMarkup(h);
      } else {
        emit(h);
      }
    }
    verbatim(to);
  };
  const emitMarkup = (node) => {
    for (const c of node.children || []) {
      if (c.s < pos) continue;
      blank(c.s);
      emit(c);
    }
    blank(node.e);
  };
  const emit = (node) => {
    switch (node.kind) {
      case 'expr':
        blank(node.code[0]);
        out.push('_ = (');
        codeWithHoles(node.code[0], node.code[1], node.holes);
        out.push(');');
        blank(node.e);
        break;
      case 'handler': {
        blank(node.code[0]);
        const raw = t.slice(node.code[0], node.code[1]);
        const v = raw.trim();
        // A method name: the control calls it; any other value is an expression. The value's
        // own line breaks stay (every later line keeps its number).
        out.push(/^[A-Za-z_][\w.]*$/.test(v) ? `${v}(default, default);` : `_ = (${v.replace(/\n/g, ' ')});`);
        out.push('\n'.repeat((raw.match(/\n/g) || []).length));
        pos = node.code[1];
        blank(node.e);
        break;
      }
      case 'block':
      case 'control':
      case 'nugget':
        codeWithHoles(node.code[0], node.code[1], node.holes);
        blank(node.e);
        break;
      case 'template':
        blank(node.e);
        break;
      case 'members':
        blank(node.open);
        out.push('}'); // the render method ends; class members follow
        pos = node.open + 1;
        codeWithHoles(node.code[0], node.code[1], node.holes);
        blank(node.close);
        out.push(` async void ${VIEW_RENDER_METHOD_PREFIX}${++renders}() {`);
        pos = Math.min(node.close + 1, node.e);
        blank(node.e);
        break;
      case 'section':
        blank(node.bodyS);
        out.push(`${VIEW_SECTION_CALL}("${node.name}", async () => {`);
        emitMarkup({ children: node.children, e: node.bodyE });
        out.push('});');
        blank(node.e);
        break;
      case 'csharp':
        blank(node.code[0]);
        verbatim(node.code[1]);
        break;
      default: // directive, comment, escape
        blank(node.e);
    }
  };

  if (scan.children.some((c) => c.kind === 'csharp')) {
    // .ashx / .asmx: the file after its directive is C#.
    for (const c of scan.children) {
      blank(c.s);
      if (c.kind === 'csharp') emit(c);
      else blank(c.e);
    }
    blank(t.length);
    const body = out.join('');
    return `${usings.join(' ')}${usings.length ? ' ' : ''}${body}`;
  }

  emitMarkup(scan);
  blank(t.length);
  const body = out.join('');
  const name = viewClassName(filePath) + (typeParams.length ? `<${typeParams.join(', ')}>` : '');
  const classHead = [
    `${attributes.join(' ')}${attributes.length ? ' ' : ''}public partial class ${name}${bases.length ? ` : ${bases.join(', ')}` : ''}${constraints.length ? ` ${constraints.join(' ')}` : ''} {`,
    ...fields,
    `async void ${VIEW_RENDER_METHOD_PREFIX}0() {`,
  ].join(' ');
  // The header takes the view's first lines, which are blank in the body (its directives):
  // one using per line, then the class at the start of a line (the C# extractor reads `using`
  // and `class X : Base` one per line, from the line start). Every line keeps its number.
  const lines = body.split('\n');
  let row = 0;
  const extra = [];
  // `@namespace N`: a file-scoped namespace, after the usings.
  for (const u of namespace ? [...usings, `namespace ${namespace};`] : usings) {
    if (row < lines.length - 1 && !lines[row].trim()) lines[row++] = u;
    else extra.push(u);
  }
  // Usings with no blank line left: on the last using line, or in front of the class.
  if (extra.length && row > 0) lines[row - 1] += ` ${extra.join(' ')}`;
  const lead = extra.length && row === 0 ? `${extra.join(' ')} ` : '';
  lines[row] = `${lead}${classHead} ${lines[row]}`;
  // The closing braces after the last line: on a line of their own when it ends in a comment.
  const last = lines.length - 1;
  lines[last] = /\/\//.test(lines[last]) ? `${lines[last]}\n} }` : `${lines[last]} } }`;
  return lines.join('\n');
}

function collectDirectives(node, out) {
  for (const c of node.children || []) {
    if (c.kind === 'directive') out.push(c);
    else if (c.kind === 'section') collectDirectives(c, out);
  }
}
