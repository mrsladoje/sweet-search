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

export const SCANNED_IMPORT_LANGUAGES = new Set([
  ...JS_LANGS, ...JVM_LANGS, ...C_LANGS, 'python', 'rust', 'go', 'ruby', 'php', 'dart',
]);

const MAX_STATEMENT_LINES = 60;

/**
 * @param {string} content
 * @param {string} language - registry language id
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
  return [];
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

function scanRust(content) {
  const lines = content.split('\n');
  const out = [];
  let inBlockComment = false;
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
    if (!trimmed.includes('use') && !trimmed.includes('mod')) continue;
    const mod = RUST_MOD_RE.exec(trimmed);
    if (mod) {
      out.push({ spec: mod[1], line: i + 1, kind: 'mod' });
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

const GO_SINGLE_RE = /^import\s+(?:[A-Za-z_]\w*\s+|_\s+|\.\s+)?"([^"]+)"/;
const GO_BLOCK_LINE_RE = /^(?:[A-Za-z_]\w*\s+|_\s+|\.\s+)?"([^"]+)"/;

function scanGo(content) {
  const lines = content.split('\n');
  const out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (inBlock) {
      if (trimmed.startsWith(')')) { inBlock = false; continue; }
      const m = GO_BLOCK_LINE_RE.exec(trimmed);
      if (m) out.push({ spec: m[1], line: i + 1, kind: 'import' });
      continue;
    }
    if (!trimmed.startsWith('import')) continue;
    if (/^import\s*\($/.test(trimmed) || /^import\s*\(\s*\/\//.test(trimmed)) { inBlock = true; continue; }
    const single = GO_SINGLE_RE.exec(trimmed);
    if (single) out.push({ spec: single[1], line: i + 1, kind: 'import' });
  }
  return out;
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

const JVM_IMPORT_RE = /^import\s+(?:static\s+)?([A-Za-z_][\w.]*?)(\.\*|\._|\.\{([^}]*)\})?\s*(?:as\s+\w+)?\s*;?\s*$/;

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
        const name = sel.trim().split(/\s*=>\s*/)[0].trim();
        if (/^[A-Za-z_]\w*$/.test(name)) out.push({ spec: `${base}.${name}`, line: i + 1, kind: 'jvm' });
      }
    } else {
      out.push({ spec: base, line: i + 1, kind: m[2] ? 'jvm-wildcard' : 'jvm' });
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

export default { scanImports, expandRustUseTree, destructuredNames, SCANNED_IMPORT_LANGUAGES };
