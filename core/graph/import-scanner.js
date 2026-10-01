/**
 * Import Scanner — statement-level import discovery for file-to-file edges.
 *
 * The per-line relationship regexes in the language registry only see one
 * line, so they miss multi-line imports (`import {\n a,\n b\n} from './x'`),
 * `import React, { useState } from 'react'`, `import * as ns from 'x'`,
 * side-effect imports, `pub use`, Rust `mod x;` and Go import blocks. This
 * scanner reads whole statements and returns every import specifier with its
 * 1-based line. It never touches the legacy `imports` rows (their target
 * names feed the embedding `# Uses:` line, which must stay byte-identical);
 * GraphExtractor uses the result only to add `importsFile` edges and to
 * annotate the legacy rows with their resolved file.
 *
 * Pure and allocation-light: one pass over the lines, cheap substring
 * prefilters before any regex runs.
 *
 * @typedef {{ spec: string, line: number, kind: string, names?: string[] }} ScannedImport
 */

const JS_LANGS = new Set(['javascript', 'typescript', 'tsx']);
const JVM_LANGS = new Set(['java', 'kotlin', 'scala', 'groovy']);
const C_LANGS = new Set(['c', 'cpp', 'objc']);
const STYLE_LANGS = new Set(['scss', 'sass', 'less', 'css']);

/**
 * Pseudo-language for single-file components (.vue / .svelte / .astro). The
 * registry maps them to `html`; their `<script>` blocks (and Astro
 * frontmatter) hold ordinary JS/TS imports.
 */
export const SFC_LANGUAGE = 'sfc';
const SFC_EXT_RE = /\.(?:vue|svelte|astro)$/i;

export const SCANNED_IMPORT_LANGUAGES = new Set([
  ...JS_LANGS, ...JVM_LANGS, ...C_LANGS, ...STYLE_LANGS, 'python', 'rust', 'go', 'ruby', 'php', 'dart',
  SFC_LANGUAGE, 'csharp', 'swift', 'elixir', 'lua', 'zig', 'haskell', 'clojure', 'solidity', 'shell',
  'proto', 'hcl', 'julia', 'elm', 'perl', 'r', 'powershell', 'erlang', 'crystal',
]);

/**
 * The language whose import rules apply to `filePath`: `sfc` for
 * .vue/.svelte/.astro (registry id `html`), else the registry id.
 */
export function importLanguageFor(filePath, language) {
  if (language === 'html' && SFC_EXT_RE.test(String(filePath || ''))) return SFC_LANGUAGE;
  return language;
}

const MAX_STATEMENT_LINES = 60;

/**
 * @param {string} content
 * @param {string} language - registry language id (or `sfc`, see importLanguageFor)
 * @returns {ScannedImport[]}
 */
export function scanImports(content, language) {
  if (!content) return [];
  if (JS_LANGS.has(language)) return scanJs(content);
  if (language === 'python') return scanPython(content);
  if (language === 'rust') return scanRust(content);
  if (language === 'go') return scanGo(content);
  if (C_LANGS.has(language)) return scanC(content);
  if (JVM_LANGS.has(language)) return scanJvm(content);
  if (language === 'ruby') return scanRuby(content);
  if (language === 'php') return scanPhp(content);
  if (language === 'dart') return scanDart(content);
  if (STYLE_LANGS.has(language)) return scanStyle(content, language);
  switch (language) {
    case SFC_LANGUAGE: return scanSfc(content);
    case 'csharp': return scanCsharp(content);
    case 'swift': return scanSwift(content);
    case 'elixir': return scanElixir(content);
    case 'lua': return scanLua(content);
    case 'zig': return scanZig(content);
    case 'haskell': return scanHaskell(content);
    case 'clojure': return scanClojure(content);
    case 'solidity': return scanSolidity(content);
    case 'shell': return scanShell(content);
    case 'proto': return scanProto(content);
    case 'hcl': return scanHcl(content);
    case 'julia': return scanSimple(content, JULIA_RE, 'include');
    case 'elm': return scanSimple(content, ELM_RE, 'module');
    case 'perl': return scanPerl(content);
    case 'r': return scanSimple(content, R_SOURCE_RE, 'source');
    case 'powershell': return scanPowershell(content);
    case 'erlang': return scanErlang(content);
    case 'crystal': return scanSimple(content, CRYSTAL_RE, 'require');
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript
// ---------------------------------------------------------------------------

const JS_FROM_RE = /\bfrom\s*(['"])([^'"\n]+)\1/;
const JS_SIDE_EFFECT_RE = /^import\s*(['"])([^'"\n]+)\1/;
const JS_IMPORT_EQUALS_RE = /^(?:export\s+)?import\s+\w+\s*=\s*require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/;
const JS_REQUIRE_RE = /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const JS_DYNAMIC_RE = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const JS_DESTRUCTURED_REQUIRE_RE = /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"\n]+)['"]/;

/** True when an `import`/`export` statement header is complete on `text`. */
function jsStatementDone(text) {
  return JS_FROM_RE.test(text) || /;\s*$/.test(text) || JS_SIDE_EFFECT_RE.test(text);
}

function scanJs(content) {
  const lines = content.split('\n');
  const out = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlockComment = false;
      line = line.slice(end + 2);
    }
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (trimmed.startsWith('/*')) {
      if (trimmed.indexOf('*/', 2) === -1) inBlockComment = true;
      continue;
    }
    const hasImport = trimmed.includes('import');
    const hasRequire = trimmed.includes('require');
    const hasExport = trimmed.startsWith('export');
    if (!hasImport && !hasRequire && !hasExport) continue;

    // Statement-level `import ...` / `export ... from` (possibly multi-line).
    if ((trimmed.startsWith('import') && !trimmed.startsWith('import(')) || (hasExport && /^export\s+(?:type\s+)?(?:\*|\{)/.test(trimmed))) {
      let stmt = trimmed;
      let j = i;
      while (!jsStatementDone(stmt) && j + 1 < lines.length && j - i < MAX_STATEMENT_LINES) {
        j++;
        stmt += ' ' + lines[j].trim();
      }
      const eq = JS_IMPORT_EQUALS_RE.exec(stmt);
      if (eq) {
        out.push({ spec: eq[2], line: i + 1, kind: 'require' });
      } else {
        const side = JS_SIDE_EFFECT_RE.exec(stmt);
        if (side) {
          out.push({ spec: side[2], line: i + 1, kind: 'side-effect' });
        } else {
          const from = JS_FROM_RE.exec(stmt);
          if (from) out.push({ spec: from[2], line: i + 1, kind: stmt.startsWith('export') ? 'reexport' : 'import' });
        }
      }
      // A multi-line header has no other imports on its continuation lines.
      if (j > i) { i = j; continue; }
    }

    if (hasRequire) {
      const destructured = JS_DESTRUCTURED_REQUIRE_RE.exec(trimmed);
      JS_REQUIRE_RE.lastIndex = 0;
      let m;
      while ((m = JS_REQUIRE_RE.exec(trimmed)) !== null) {
        if (trimmed.startsWith('import') && JS_IMPORT_EQUALS_RE.test(trimmed)) break;
        const entry = { spec: m[2], line: i + 1, kind: 'require' };
        if (destructured && destructured[2] === m[2]) entry.names = destructuredNames(destructured[1]);
        out.push(entry);
      }
    }
    if (hasImport && trimmed.includes('import(')) {
      JS_DYNAMIC_RE.lastIndex = 0;
      let m;
      while ((m = JS_DYNAMIC_RE.exec(trimmed)) !== null) {
        out.push({ spec: m[2], line: i + 1, kind: 'dynamic' });
      }
    }
  }
  return out;
}

/** Local binding names of `{ a, b: c, d = 1, ...rest }` (mirrors GraphExtractor). */
export function destructuredNames(raw) {
  const names = [];
  for (let part of raw.split(',')) {
    part = part.trim();
    if (!part) continue;
    if (part.includes(':')) part = part.split(':').pop().trim();
    const asAlias = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
    if (asAlias) part = asAlias[1];
    part = part.replace(/=.*/, '').replace(/^\.\.\./, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(part)) names.push(part);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const PY_FROM_RE = /^from\s+(\.+[\w.]*|[A-Za-z_][\w.]*)\s+import\s+(.*)$/;
const PY_IMPORT_RE = /^import\s+(.+)$/;

function scanPython(content) {
  const lines = content.split('\n');
  const out = [];
  let inDoc = null; // '"""' or "'''" while inside a triple-quoted string
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (inDoc) {
      if (countOccurrences(trimmed, inDoc) % 2 === 1) inDoc = null;
      continue;
    }
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      const q = trimmed.slice(0, 3);
      if (countOccurrences(trimmed, q) % 2 === 1) inDoc = q;
      continue;
    }
    if (!trimmed.startsWith('from') && !trimmed.startsWith('import')) continue;
    const from = PY_FROM_RE.exec(trimmed);
    if (from) {
      let namesText = from[2];
      let j = i;
      if (namesText.startsWith('(') && !namesText.includes(')')) {
        while (j + 1 < lines.length && j - i < MAX_STATEMENT_LINES) {
          j++;
          namesText += ' ' + lines[j].trim();
          if (lines[j].includes(')')) break;
        }
      } else {
        while (namesText.endsWith('\\') && j + 1 < lines.length && j - i < MAX_STATEMENT_LINES) {
          j++;
          namesText = namesText.slice(0, -1) + ' ' + lines[j].trim();
        }
      }
      const names = namesText.replace(/#.*$/, '').replace(/[()\\]/g, ' ').split(',')
        .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
        .filter((n) => /^[A-Za-z_]\w*$/.test(n));
      out.push({ spec: from[1], line: i + 1, kind: 'from', names });
      i = j;
      continue;
    }
    const imp = PY_IMPORT_RE.exec(trimmed);
    if (imp) {
      for (const part of imp[1].replace(/#.*$/, '').split(',')) {
        const mod = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_][\w.]*$/.test(mod)) out.push({ spec: mod, line: i + 1, kind: 'import' });
      }
    }
  }
  return out;
}

function countOccurrences(text, needle) {
  let n = 0;
  let k = text.indexOf(needle);
  while (k !== -1) { n++; k = text.indexOf(needle, k + needle.length); }
  return n;
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

const RUST_USE_START_RE = /^(?:pub(?:\s*\([^)]*\))?\s+)?use\s+/;
const RUST_MOD_RE = /^(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/;
const RUST_PATH_ATTR_RE = /^#\[\s*path\s*=\s*"([^"]+)"\s*\]/;

function scanRust(content) {
  const lines = content.split('\n');
  const out = [];
  let inBlockComment = false;
  let pendingPath = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    // `#[path = "x.rs"] mod m;`: the attribute names the file outright
    // (Rust reference, "The path attribute"). Other attributes in between
    // (`#[cfg(...)]`) keep it pending.
    const pathAttr = RUST_PATH_ATTR_RE.exec(trimmed);
    if (pathAttr) { pendingPath = pathAttr[1]; continue; }
    if (pendingPath !== null && !trimmed.startsWith('#[') && !RUST_MOD_RE.test(trimmed)) pendingPath = null;
    if (!trimmed.includes('use') && !trimmed.includes('mod')) continue;
    const mod = RUST_MOD_RE.exec(trimmed);
    if (mod) {
      if (pendingPath !== null) {
        out.push({ spec: pendingPath, line: i + 1, kind: 'mod-path' });
        pendingPath = null;
      } else {
        out.push({ spec: mod[1], line: i + 1, kind: 'mod' });
      }
      continue;
    }
    const start = RUST_USE_START_RE.exec(trimmed);
    if (!start) continue;
    let stmt = trimmed.slice(start[0].length);
    let j = i;
    while (!stmt.includes(';') && j + 1 < lines.length && j - i < MAX_STATEMENT_LINES) {
      j++;
      stmt += ' ' + lines[j].trim();
    }
    stmt = stmt.slice(0, stmt.indexOf(';') === -1 ? stmt.length : stmt.indexOf(';'))
      .replace(/\/\/[^\n]*/g, '').replace(/\s+as\s+\w+/g, '').replace(/\s+/g, '');
    for (const p of expandRustUseTree(stmt)) out.push({ spec: p, line: i + 1, kind: 'use' });
    i = j;
  }
  return out;
}

/**
 * Flatten a Rust use-tree: `a::b::{c, d::{e, f}, self}` →
 * ['a::b::c', 'a::b::d::e', 'a::b::d::f', 'a::b'].
 */
export function expandRustUseTree(tree, prefix = '') {
  const results = [];
  const brace = tree.indexOf('{');
  if (brace === -1) {
    const leaf = tree.replace(/::\*$/, '');
    if (!leaf) return results;
    if (leaf === 'self') { if (prefix) results.push(prefix.replace(/::$/, '')); return results; }
    results.push(prefix + leaf);
    return results;
  }
  const head = tree.slice(0, brace);
  const body = tree.slice(brace + 1, tree.lastIndexOf('}'));
  for (const part of splitTopLevel(body)) {
    if (!part) continue;
    for (const r of expandRustUseTree(part, prefix + head)) results.push(r);
  }
  return results;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

// Group 1: the optional package name (`pb "…/protos/pb"`, `_`, `.`).
const GO_SINGLE_RE = /^import\s+(?:([A-Za-z_]\w*|\.)\s+)?"([^"]+)"/;
const GO_BLOCK_LINE_RE = /^(?:([A-Za-z_]\w*|\.)\s+)?"([^"]+)"/;

function goImport(m, line) {
  const out = { spec: m[2], line, kind: 'import' };
  if (m[1]) out.alias = m[1];
  return out;
}

function scanGo(content) {
  const lines = content.split('\n');
  const out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (inBlock) {
      if (trimmed.startsWith(')')) { inBlock = false; continue; }
      const m = GO_BLOCK_LINE_RE.exec(trimmed);
      if (m) out.push(goImport(m, i + 1));
      continue;
    }
    if (!trimmed.startsWith('import')) continue;
    if (/^import\s*\($/.test(trimmed) || /^import\s*\(\s*\/\//.test(trimmed)) { inBlock = true; continue; }
    const single = GO_SINGLE_RE.exec(trimmed);
    if (single) out.push(goImport(single, i + 1));
  }
  return out;
}

/**
 * The name a Go file uses for an import: its explicit name, else the
 * package-name convention of the path — last element, without a major
 * version element (`…/raft/v3` → raft) or suffix (`gopkg.in/yaml.v3` →
 * yaml), without a `go-` prefix or `-go` suffix (`go-humanize` →
 * humanize). Null when there is no usable name: blank `_` and dot `.`
 * imports, or a path element that is no identifier after the convention.
 */
export function goImportName(imp) {
  if (imp?.alias) return imp.alias === '_' || imp.alias === '.' ? null : imp.alias;
  const parts = String(imp?.spec || '').split('/').filter(Boolean);
  let last = parts.pop() || '';
  if (/^v\d+$/.test(last) && parts.length > 0) last = parts.pop();
  last = last.replace(/\.v\d+$/, '').replace(/^go-/, '').replace(/-go$/, '');
  return /^[A-Za-z_]\w*$/.test(last) ? last : null;
}

// ---------------------------------------------------------------------------
// C / C++ / Objective-C
// ---------------------------------------------------------------------------

const C_INCLUDE_RE = /^#\s*(?:include|import)\s*([<"])([^>"]+)[>"]/;

function scanC(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.charCodeAt(0) !== 35 /* # */) continue;
    const m = C_INCLUDE_RE.exec(trimmed);
    if (m) out.push({ spec: m[2], line: i + 1, kind: m[1] === '"' ? 'quote' : 'angle' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// JVM (Java / Kotlin / Scala / Groovy)
// ---------------------------------------------------------------------------

const JVM_IMPORT_RE = /^import\s+(?:static\s+)?([A-Za-z_][\w.]*?)(\.\*|\._|\.\{([^}]*)\})?\s*(?:as\s+(\w+))?\s*;?\s*$/;

function scanJvm(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('import')) continue;
    const m = JVM_IMPORT_RE.exec(trimmed.replace(/\s*\/\/.*$/, ''));
    if (!m) continue;
    const base = m[1].replace(/`/g, '');
    if (m[2] && m[2].startsWith('.{')) {
      for (const sel of (m[3] || '').split(',')) {
        const [name, rename] = sel.trim().split(/\s*=>\s*/).map((s) => s.trim());
        if (!/^[A-Za-z_]\w*$/.test(name || '')) continue;
        const entry = { spec: `${base}.${name}`, line: i + 1, kind: 'jvm' };
        // Scala `{A => B}` binds B; `{A => _}` hides A.
        if (rename && /^[A-Za-z_]\w*$/.test(rename) && rename !== '_') entry.names = [rename];
        out.push(entry);
      }
    } else {
      const entry = { spec: base, line: i + 1, kind: m[2] ? 'jvm-wildcard' : 'jvm' };
      if (m[4] && !m[2]) entry.names = [m[4]]; // Kotlin `import a.B as C`
      out.push(entry);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------

const RUBY_REQUIRE_RE = /^(require_relative|require|load|autoload\s+:\w+\s*,)\s*\(?\s*['"]([^'"]+)['"]/;

function scanRuby(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('require') && !trimmed.startsWith('load') && !trimmed.startsWith('autoload')) continue;
    const m = RUBY_REQUIRE_RE.exec(trimmed);
    if (m) out.push({ spec: m[2], line: i + 1, kind: m[1] === 'require_relative' ? 'relative' : 'load-path' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

const PHP_USE_RE = /^use\s+(?:function\s+|const\s+)?\\?([\w\\]+?)(?:\\\{([^}]*)\})?\s*(?:as\s+\w+)?\s*[;,]/;
const PHP_REQUIRE_RE = /^(?:require|include)(?:_once)?\s*\(?\s*(__DIR__\s*\.\s*|dirname\(__FILE__\)\s*\.\s*)?['"]([^'"]+)['"]/;

function scanPhp(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Namespace imports sit at column 0; an indented `use X;` is a trait use.
    if (line.startsWith('use ')) {
      let stmt = line.trim();
      let j = i;
      while (!stmt.includes(';') && j + 1 < lines.length && j - i < MAX_STATEMENT_LINES) {
        j++;
        stmt += ' ' + lines[j].trim();
      }
      const m = PHP_USE_RE.exec(stmt);
      if (m) {
        if (m[2] !== undefined) {
          for (const part of m[2].split(',')) {
            const name = part.trim().split(/\s+as\s+/)[0].trim().replace(/^\\/, '');
            if (name) out.push({ spec: `${m[1]}\\${name}`, line: i + 1, kind: 'use' });
          }
        } else {
          out.push({ spec: m[1], line: i + 1, kind: 'use' });
        }
      }
      i = j;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith('require') && !trimmed.startsWith('include')) continue;
    const r = PHP_REQUIRE_RE.exec(trimmed);
    if (r) out.push({ spec: r[2], line: i + 1, kind: 'require' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dart
// ---------------------------------------------------------------------------

const DART_IMPORT_RE = /^(?:import|export|part)\s+['"]([^'"]+)['"]/;

function scanDart(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('import') && !trimmed.startsWith('export') && !trimmed.startsWith('part')) continue;
    const m = DART_IMPORT_RE.exec(trimmed);
    if (m && !m[1].startsWith('dart:')) out.push({ spec: m[1], line: i + 1, kind: 'import' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function newlinesBefore(text, index) {
  let n = 0;
  for (let k = text.indexOf('\n'); k !== -1 && k < index; k = text.indexOf('\n', k + 1)) n++;
  return n;
}

/** One anchored regex per line; group 1 is the specifier. */
function scanSimple(content, re, kind) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) out.push({ spec: m[1], line: i + 1, kind });
  }
  return out;
}

const JULIA_RE = /^\s*include\(\s*"([^"]+)"\s*\)/;
const ELM_RE = /^import\s+([A-Z][\w]*(?:\.[A-Z][\w]*)*)/;
const R_SOURCE_RE = /^\s*(?:sys\.)?source\(\s*(?:file\s*=\s*)?["']([^"']+)["']/;
const CRYSTAL_RE = /^\s*require\s+"([^"]+)"/;

// ---------------------------------------------------------------------------
// Single-file components (.vue / .svelte / .astro)
// ---------------------------------------------------------------------------

const SFC_SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

function scanSfc(content) {
  const out = [];
  const add = (block, start) => {
    const offset = newlinesBefore(content, start);
    for (const imp of scanJs(block)) out.push({ ...imp, line: imp.line + offset });
  };
  // Astro component script: a `---` fenced frontmatter at the top.
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) add(content.slice(3, end), 3);
  }
  SFC_SCRIPT_RE.lastIndex = 0;
  let m;
  while ((m = SFC_SCRIPT_RE.exec(content)) !== null) {
    add(m[1], m.index + m[0].indexOf('>') + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stylesheets: Sass/SCSS `@use` / `@forward` / `@import`, Less and CSS `@import`
// ---------------------------------------------------------------------------

const STYLE_AT_RE = /@(use|forward|import)\b([^;{]*)/g;
const STYLE_ARG_RE = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)|(['"])([^'"\n]+)\3/g;

function scanStyle(content, language) {
  const text = content.indexOf('/*') === -1 ? content : content.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''));
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.charCodeAt(0) !== 64 /* @ */ && !trimmed.includes('@')) continue;
    if (trimmed.startsWith('//')) continue;
    STYLE_AT_RE.lastIndex = 0;
    let at;
    while ((at = STYLE_AT_RE.exec(trimmed)) !== null) {
      // @use/@forward load exactly one module; Sass/CSS @import may list several.
      const single = at[1] !== 'import';
      STYLE_ARG_RE.lastIndex = 0;
      let a;
      while ((a = STYLE_ARG_RE.exec(at[2])) !== null) {
        const spec = a[2] || a[4];
        if (spec && !/^(?:sass:|https?:|\/\/|data:)/.test(spec)) {
          out.push({ spec, line: i + 1, kind: a[2] ? 'style-url' : `style-${language === 'css' ? 'css' : language === 'less' ? 'less' : 'sass'}` });
        }
        if (single) break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// C#: `using X.Y;`, `global using`, `using static`, `using A = X.Y.Z;`
// ---------------------------------------------------------------------------

const CS_USING_RE = /^(?:global\s+)?using\s+(?:(static)\s+)?(?:([A-Za-z_]\w*)\s*=\s*)?(?:global::)?(@?[A-Za-z_][\w.]*)(?:<[^;]*>)?\s*;/;

function scanCsharp(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('using') && !trimmed.startsWith('global')) continue;
    const m = CS_USING_RE.exec(trimmed);
    if (!m) continue;
    const spec = m[3].replace(/^@/, '');
    if (m[2]) out.push({ spec, line: i + 1, kind: 'cs-alias', names: [m[2]] });
    else if (m[1]) out.push({ spec, line: i + 1, kind: 'cs-static' });
    else out.push({ spec, line: i + 1, kind: trimmed.startsWith('global') ? 'cs-global' : 'cs-namespace' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Swift: `import Module`, `@testable import Module`, `import struct Module.Type`
// ---------------------------------------------------------------------------

const SWIFT_IMPORT_RE = /^(?:@[\w]+(?:\([^)]*\))?\s+)*import\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?([A-Za-z_]\w*)/;

function scanSwift(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.includes('import')) continue;
    if (trimmed.charCodeAt(0) !== 64 /* @ */ && !trimmed.startsWith('import')) continue;
    const m = SWIFT_IMPORT_RE.exec(trimmed);
    if (m) out.push({ spec: m[1], line: i + 1, kind: 'swift-module' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Elixir: `alias A.B`, `alias A.{B, C}`, `alias A.B, as: X`, import/require/use
// ---------------------------------------------------------------------------

const EX_DIRECTIVE_RE = /^(alias|import|require|use)\s+([A-Z][\w]*(?:\.[A-Z][\w]*)*)(\.\{)?/;
const EX_AS_RE = /,\s*as:\s*([A-Z]\w*)/;

function scanElixir(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const c = trimmed.charCodeAt(0);
    if (c !== 97 && c !== 105 && c !== 114 && c !== 117) continue; // a i r u
    const m = EX_DIRECTIVE_RE.exec(trimmed);
    if (!m) continue;
    const kind = `ex-${m[1]}`;
    if (m[3]) {
      let body = trimmed.slice(m[0].length);
      let j = i;
      while (!body.includes('}') && j + 1 < lines.length && j - i < MAX_STATEMENT_LINES) {
        j++;
        body += ' ' + lines[j].trim();
      }
      body = body.slice(0, body.indexOf('}') === -1 ? body.length : body.indexOf('}'));
      for (const part of body.split(',')) {
        const sub = part.trim();
        if (/^[A-Z][\w]*(?:\.[A-Z][\w]*)*$/.test(sub)) {
          out.push({ spec: `${m[2]}.${sub}`, line: i + 1, kind, names: [sub.split('.').pop()] });
        }
      }
      i = j;
      continue;
    }
    const as = m[1] === 'alias' ? EX_AS_RE.exec(trimmed) : null;
    const entry = { spec: m[2], line: i + 1, kind };
    if (m[1] === 'alias') entry.names = [as ? as[1] : m[2].split('.').pop()];
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lua: `require "a.b"`, `require("a.b")`, `require('a.b')`
// ---------------------------------------------------------------------------

const LUA_REQUIRE_RE = /\brequire\s*\(?\s*(['"])([^'"\n]+)\1/g;

function scanLua(content) {
  const lines = content.split('\n');
  const out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (inBlock) {
      const end = line.indexOf(']]');
      if (end === -1) continue;
      inBlock = false;
      line = line.slice(end + 2);
    }
    const blockStart = line.indexOf('--[[');
    if (blockStart !== -1) {
      if (line.indexOf(']]', blockStart + 4) === -1) inBlock = true;
      line = line.slice(0, blockStart);
    }
    if (!line.includes('require')) continue;
    const comment = line.indexOf('--');
    const code = comment === -1 ? line : line.slice(0, comment);
    LUA_REQUIRE_RE.lastIndex = 0;
    let m;
    while ((m = LUA_REQUIRE_RE.exec(code)) !== null) out.push({ spec: m[2], line: i + 1, kind: 'lua-require' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zig: `@import("x.zig")`, `@import("module")`
// ---------------------------------------------------------------------------

const ZIG_IMPORT_RE = /@import\(\s*"([^"]+)"\s*\)/g;

function scanZig(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('@import')) continue;
    const comment = line.indexOf('//');
    const code = comment === -1 ? line : line.slice(0, comment);
    ZIG_IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = ZIG_IMPORT_RE.exec(code)) !== null) out.push({ spec: m[1], line: i + 1, kind: 'zig-import' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Haskell: `import [qualified] A.B [as X] [(..)]`, incl. SOURCE / package imports
// ---------------------------------------------------------------------------

const HS_IMPORT_RE = /^import\s+(?:\{-#\s*SOURCE\s*#-\}\s*)?(?:safe\s+)?(?:qualified\s+)?(?:"[^"]*"\s+)?([A-Z][\w']*(?:\.[A-Z][\w']*)*)/;

function scanHaskell(content) {
  const lines = content.split('\n');
  const out = [];
  let depth = 0; // nested {- -} block comments
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (depth > 0 || line.includes('{-')) {
      const opens = (line.match(/\{-(?!#)/g) || []).length;
      const closes = (line.match(/(?<!#)-\}/g) || []).length;
      const was = depth;
      depth = Math.max(0, depth + opens - closes);
      if (was > 0 || opens > 0) continue;
    }
    if (!line.startsWith('import')) continue;
    const m = HS_IMPORT_RE.exec(line);
    if (m) out.push({ spec: m[1], line: i + 1, kind: 'hs-import' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clojure: `(ns x (:require [a.b :as c] d.e (f.g [h :as i])))`, `(require '[a.b])`
// ---------------------------------------------------------------------------

/**
 * Minimal reader: nested arrays for lists/vectors (`kind` property), strings
 * for symbols and keywords. Skips strings, comments, chars and reader prefixes.
 */
function readClojureForms(text, maxTopForms = Infinity) {
  const root = [];
  const stack = [root];
  let tops = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ';') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '"') { i++; while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; } continue; }
    if (ch === '\\') { i++; while (i + 1 < text.length && /[\w-]/.test(text[i + 1])) i++; continue; }
    if (ch === '(' || ch === '[' || ch === '{') {
      const form = [];
      form.kind = ch;
      form.offset = i;
      stack[stack.length - 1].push(form);
      stack.push(form);
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length > 1) stack.pop();
      if (stack.length === 1 && ++tops >= maxTopForms) break;
      continue;
    }
    if (/\s|,|'|`|~|@|\^|#/.test(ch)) continue;
    let j = i;
    while (j < text.length && !/[\s,()[\]{}"';]/.test(text[j])) j++;
    stack[stack.length - 1].push(text.slice(i, j));
    i = j - 1;
  }
  return root;
}

const CLJ_LIB_RE = /^[A-Za-z_*+!?<>=][\w.*+!?<>=-]*$/;

function clojureLibspecs(section, push) {
  for (const el of section.slice(1)) {
    if (typeof el === 'string') {
      if (!el.startsWith(':') && CLJ_LIB_RE.test(el)) push(el);
    } else if (el.kind === '[') {
      if (typeof el[0] === 'string' && CLJ_LIB_RE.test(el[0])) push(el[0]);
    } else if (el.kind === '(' && typeof el[0] === 'string') {
      // Prefix list: (a.b [c :as x] d) → a.b.c, a.b.d
      for (const sub of el.slice(1)) {
        const name = typeof sub === 'string' ? sub : (sub.kind === '[' && typeof sub[0] === 'string' ? sub[0] : null);
        if (name && !name.startsWith(':') && CLJ_LIB_RE.test(name)) push(`${el[0]}.${name}`);
      }
    }
  }
}

function scanClojure(content) {
  if (!content.includes('(ns') && !content.includes('(require')) return [];
  const out = [];
  const forms = readClojureForms(content);
  const lineOf = (offset) => newlinesBefore(content, offset) + 1;
  for (const form of forms) {
    if (!Array.isArray(form) || form.kind !== '(') continue;
    const head = form[0];
    if (head === 'ns') {
      for (const section of form.slice(2)) {
        if (!Array.isArray(section) || (section[0] !== ':require' && section[0] !== ':use')) continue;
        const line = lineOf(section.offset);
        clojureLibspecs(section, (spec) => out.push({ spec, line, kind: 'clj-require' }));
      }
    } else if (head === 'require' || head === 'use') {
      const line = lineOf(form.offset);
      clojureLibspecs(form, (spec) => out.push({ spec, line, kind: 'clj-require' }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Solidity: `import "x";`, `import "x" as y;`, `import * as y from "x";`, `import {a} from "x";`
// ---------------------------------------------------------------------------

const SOL_IMPORT_RE = /^[ \t]*import\s+(?:[^;"']*?\bfrom\s+)?(["'])([^"'\n]+)\1/gm;

function scanSolidity(content) {
  const out = [];
  if (!content.includes('import')) return out;
  SOL_IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = SOL_IMPORT_RE.exec(content)) !== null) {
    out.push({ spec: m[2], line: newlinesBefore(content, m.index) + 1, kind: 'sol-import' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shell: `source x`, `. x`, with the script-directory idioms
// ---------------------------------------------------------------------------

const SH_SOURCE_RE = /(?:^|[;&|]\s*|\b(?:then|do|else)\s+)(?:source|\.)\s+/;
const SH_ASSIGN_RE = /^(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)=(.*)$/;
const SH_SCRIPT_DIR_EXPR_RE = /dirname|BASH_SOURCE|\$\{0%\/\*\}|\$0\b/;
// The script directory written inline: `$(dirname "$0")`, `$(dirname "${BASH_SOURCE[0]}")`,
// `$(cd "$(dirname "$0")" && pwd)`, `${BASH_SOURCE%/*}`, `${0%/*}` — each followed by `/`.
const SH_SELF = String.raw`\$(?:\{BASH_SOURCE(?:\[0\])?\}|BASH_SOURCE(?:\[0\])?|0|\{0\})`;
const SH_DIRNAME = String.raw`\$\(dirname\s+"?${SH_SELF}"?\s*\)`;
const SH_SCRIPT_DIR_INLINE_RE = new RegExp(String.raw`^"?(?:${SH_DIRNAME}|\$\(cd\s+"?${SH_DIRNAME}"?\s*(?:&&|;)\s*pwd(?:\s+-P)?\s*\)|\$\{BASH_SOURCE(?:\[0\])?%\/\*\}|\$\{0%\/\*\})"?\/`);

/** First shell word of `rest` (one level of quotes), without trailing `;`. */
function shellWord(rest) {
  const q = rest[0];
  if (q === '"' || q === "'") {
    const end = rest.indexOf(q, 1);
    return end === -1 ? null : rest.slice(1, end);
  }
  const m = /^[^\s;|&]+/.exec(rest);
  return m ? m[0] : null;
}

function scanShell(content) {
  const lines = content.split('\n');
  const out = [];
  const scriptDirVars = new Set();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.charCodeAt(0) === 35 /* # */) continue;
    const assign = SH_ASSIGN_RE.exec(trimmed);
    if (assign && SH_SCRIPT_DIR_EXPR_RE.test(assign[2])) scriptDirVars.add(assign[1]);
    if (!trimmed.includes('source') && !trimmed.includes('. ')) continue;
    const m = SH_SOURCE_RE.exec(trimmed);
    if (!m) continue;
    const rest = trimmed.slice(m.index + m[0].length);
    const inline = SH_SCRIPT_DIR_INLINE_RE.exec(rest);
    if (inline) {
      const tail = /^[^\s;|&"']+/.exec(rest.slice(inline[0].length));
      if (tail) out.push({ spec: tail[0], line: i + 1, kind: 'sh-scriptdir' });
      continue;
    }
    const arg = shellWord(rest);
    if (!arg) continue;
    const v = /^\$\{?([A-Za-z_]\w*)\}?\/(.+)$/.exec(arg);
    if (v) {
      if (scriptDirVars.has(v[1]) && !v[2].includes('$')) out.push({ spec: v[2].replace(/["']/g, ''), line: i + 1, kind: 'sh-scriptdir' });
      continue;
    }
    if (arg.includes('$') || arg.includes('`') || arg.includes('*')) continue;
    out.push({ spec: arg, line: i + 1, kind: 'sh-literal' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Protocol Buffers: `import "a/b.proto";`, `import public|weak "x";`
// ---------------------------------------------------------------------------

const PROTO_IMPORT_RE = /^\s*import\s+(?:public\s+|weak\s+)?"([^"]+)"\s*;/;

function scanProto(content) {
  return scanSimple(content, PROTO_IMPORT_RE, 'proto-import');
}

// ---------------------------------------------------------------------------
// Terraform / HCL: `module "x" { source = "./modules/x" }` (local paths only)
// ---------------------------------------------------------------------------

const HCL_MODULE_RE = /\bmodule\s+"[^"]*"\s*\{/g;
const HCL_SOURCE_RE = /(?:^|\n)\s*source\s*=\s*"([^"]+)"/;

function scanHcl(content) {
  const out = [];
  if (!content.includes('module')) return out;
  HCL_MODULE_RE.lastIndex = 0;
  let m;
  while ((m = HCL_MODULE_RE.exec(content)) !== null) {
    // The block body up to its closing brace (strings may hold braces).
    let depth = 1;
    let k = m.index + m[0].length;
    let inStr = false;
    for (; k < content.length && depth > 0; k++) {
      const ch = content[k];
      if (inStr) { if (ch === '\\') k++; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    const body = content.slice(m.index + m[0].length, k);
    const s = HCL_SOURCE_RE.exec(body);
    if (s && /^\.\.?\//.test(s[1])) {
      out.push({ spec: s[1], line: newlinesBefore(content, m.index + m[0].length + s.index + (s[0].startsWith('\n') ? 1 : 0)) + 1, kind: 'tf-module' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Perl: `use A::B;`, `require A::B;`, `use parent/base qw(A B)`, `require "x.pl"`
// ---------------------------------------------------------------------------

const PERL_USE_RE = /^\s*(?:use|require)\s+([A-Z][\w]*(?:::\w+)*)\b/;
const PERL_PARENT_RE = /^\s*use\s+(?:parent|base)\s+(?:-norequire\s*,\s*)?(?:qw\s*[(\[{/]\s*([^)\]}/]+)|["']([^"']+)["'])/;
const PERL_REQUIRE_FILE_RE = /^\s*(?:require|do)\s+["']([^"']+\.p[lm])["']/;

function scanPerl(content) {
  const lines = content.split('\n');
  const out = [];
  let inPod = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inPod) { if (line.startsWith('=cut')) inPod = false; continue; }
    if (/^=[a-zA-Z]/.test(line)) { inPod = true; continue; }
    if (line.startsWith('__END__') || line.startsWith('__DATA__')) break;
    if (!line.includes('use') && !line.includes('require') && !line.includes('do')) continue;
    const parent = PERL_PARENT_RE.exec(line);
    if (parent) {
      for (const mod of (parent[1] || parent[2] || '').split(/\s+/)) {
        if (/^[A-Z][\w]*(?:::\w+)*$/.test(mod)) out.push({ spec: mod, line: i + 1, kind: 'perl-module' });
      }
      continue;
    }
    const file = PERL_REQUIRE_FILE_RE.exec(line);
    if (file) { out.push({ spec: file[1], line: i + 1, kind: 'perl-file' }); continue; }
    const m = PERL_USE_RE.exec(line);
    if (m) out.push({ spec: m[1], line: i + 1, kind: 'perl-module' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PowerShell: `. $PSScriptRoot\x.ps1`, `Import-Module $PSScriptRoot/x.psm1`, `using module .\x.psm1`
// ---------------------------------------------------------------------------

const PS_SCRIPTROOT_RE = /^\s*(?:\.|Import-Module(?:\s+-Name)?)\s+["']?\$PSScriptRoot[\\/]([^"'\s;]+)/i;
const PS_USING_MODULE_RE = /^\s*using\s+module\s+["']?(\.{1,2}[\\/][^"'\s;]+)/i;

function scanPowershell(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('PSScriptRoot') && !/using\s+module/i.test(line)) continue;
    const a = PS_SCRIPTROOT_RE.exec(line);
    if (a) { out.push({ spec: a[1].replace(/\\/g, '/'), line: i + 1, kind: 'ps-scriptdir' }); continue; }
    const b = PS_USING_MODULE_RE.exec(line);
    if (b) out.push({ spec: b[1].replace(/\\/g, '/'), line: i + 1, kind: 'ps-scriptdir' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Erlang: `-include("x.hrl").`, `-include_lib("app/include/x.hrl").`
// ---------------------------------------------------------------------------

const ERL_INCLUDE_RE = /^-include(_lib)?\(\s*"([^"]+)"\s*\)/;

function scanErlang(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].charCodeAt(0) !== 45 /* - */) continue;
    const m = ERL_INCLUDE_RE.exec(lines[i]);
    if (m) out.push({ spec: m[2], line: i + 1, kind: m[1] ? 'erl-include-lib' : 'erl-include' });
  }
  return out;
}

export default { scanImports, importLanguageFor, expandRustUseTree, destructuredNames, SCANNED_IMPORT_LANGUAGES, SFC_LANGUAGE };
