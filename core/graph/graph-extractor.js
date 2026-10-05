#!/usr/bin/env node

/**
 * Code Graph Extractor
 *
 * Builds a knowledge graph from codebase:
 * - Entities: classes, interfaces, methods, fields, enums
 * - Relationships: extends, implements, calls, uses, throws, overrides
 *
 * Stores in SQLite with FTS5 for fast lexical search.
 */

import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { GRAPH_CONFIG, DB_PATHS } from '../infrastructure/config/index.js';
import { getLanguageByPath, resolveLanguage } from '../infrastructure/language-patterns.js';
import { getTreeSitterProvider, STATE_CAPTURE_LANGUAGES, STATE_ENTITY_TYPES } from '../infrastructure/tree-sitter-provider.js';
import { CallSiteScanner, EXTRA_CALL_SCAN_LANGUAGES } from './call-site-scanner.js';
import { goImportName, scanImports, SCANNED_IMPORT_LANGUAGES, importLanguageFor } from './import-scanner.js';
import { GO_PACKAGE_PREFIX, RUST_PATH_PREFIX, UNRESOLVED_IMPORT_PREFIX } from './import-resolver.js';
import { annotateReceiverTypes } from './receiver-types.js';
import { scanInstantiations, scanSignatureTypes, swiftExtensionTarget } from './type-usage-scanner.js';
import { ensureFilesSchema, hasGraphColumn, insertFileNodes } from '../infrastructure/file-nodes.js';

// Languages whose legacy `imports` rows are all module specifiers that the
// statement scanner sees (so an unmatched row is a regex false positive).
const STATEMENT_COVERED_IMPORT_LANGUAGES = new Set([
  'javascript', 'typescript', 'tsx', 'python', 'go', 'rust', 'c', 'cpp', 'objc',
  'java', 'kotlin', 'scala', 'groovy', 'dart',
]);

// Schema version - increment when schema changes require full reindex
// Users should run `/index-codebase --full` after upgrading
export const SCHEMA_VERSION = 2;

/**
 * Sentinel `end_line` clamp (2026-05-13). Lua-specific by design.
 *
 * Background: Lua's regex extractor uses `findEndLineKeyword` to find the
 * `end` keyword that closes a function body. The helper tracks nesting
 * depth across `if`/`while`/`for`/`function`/`do` keywords and decrements
 * on `end`. When the depth counter mis-balances (control-flow keywords
 * sharing line context with the closing `end`), the helper falls through
 * to `return lines.length` (the file's last line), producing entities
 * with end_line = EOF that structurally span half the file (LU-003:
 * tablex.deepcopy at 118-120 got rendered as 98-999 because its
 * preceding sibling cycle_aware_copy had bogus end_line=999).
 *
 * Gated to language='lua' EXPLICITLY because:
 *   - Tree-sitter languages (Java, Python, JS, TS, Go, Rust, C, C++,
 *     Ruby, etc.) get accurate end_lines from grammar-driven extraction —
 *     this clamp's pattern doesn't apply.
 *   - Other regex-path languages (zig, scala, kotlin, dart, elixir, php)
 *     may have similar bugs but haven't been audited. Apply only after
 *     per-language validation.
 *
 * Clamp condition (BOTH required):
 *   1. cur.type ∈ NON_CONTAINER_TYPES (function-shaped — these cannot
 *      legitimately contain a same-level sibling that starts inside them)
 *   2. cur.end_line >= file_line_count (ends at-or-past EOF)
 *   3. A later entity starts after cur.start_line and before cur.end_line.
 *
 * Clamp target: next entity's start_line - 1. Mutates in place.
 *
 * The container-type gate (NON_CONTAINER_TYPES) is a defence-in-depth
 * even within Lua — Lua doesn't really have classes, but if a future
 * change adds 'module' or 'class' types via metatable detection, they
 * stay protected.
 */
const NON_CONTAINER_TYPES = new Set([
  'function', 'method', 'arrowFunction', 'variable', 'const', 'field',
  'decorator', 'assignedFunc', 'component', 'typeAlias',
]);

const LUA_CLAMP_ALLOWED_LANGUAGES = new Set(['lua']);

// Regex-registry entity types that own their members (`parent_class` of the
// definitions inside their line range). Swift `extension Foo` is named after
// the extended type, so its members belong to Foo.
const REGEX_CONTAINER_TYPES = new Set([
  'class', 'interface', 'enum', 'struct', 'trait', 'impl', 'module', 'object',
  'protocol', 'extension', 'mixin', 'record',
]);

// Data formats whose entities are keys, not definitions: an exact repeat of a
// key line is the same key (see GraphExtractor.entityId).
const DATA_KEY_LANGUAGES = new Set(['json', 'yaml', 'toml', 'xml']);

/**
 * The code part of one line: `//` and `/* … *\/` comments removed, but only
 * outside string literals — `string Url = "http://x";` keeps its `;` (a plain
 * `//.*$` cut left `string Url = "http:` and the field ran on to the next
 * block's `}`). Trailing whitespace is trimmed.
 */
export function codeBeforeComment(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += line[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    out += c;
  }
  return out.trimEnd();
}

/** 0-based indexes of the lines strictly inside Elixir heredocs (`\"\"\"` / `\'\'\'`). */
export function elixirHeredocLines(lines) {
  const inside = new Set();
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] || '');
    if (fence) {
      if (raw.includes(fence)) fence = null;
      else inside.add(i);
      continue;
    }
    const m = /("""|''')/.exec(raw);
    if (m && !raw.slice(m.index + 3).includes(m[1])) fence = m[1];
  }
  return inside;
}

/** Elixir code of one line: string, charlist and comment text blanked. */
function elixirCode(line) {
  return String(line || '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/#.*$/, '');
}

/**
 * 1-based end line of the Elixir definition starting at `startIndex`.
 * Every Elixir block is `do … end` or `fn … end`, so the span closes where
 * the `do`/`fn` and `end` tokens balance; keyword forms (`, do: x`, also after
 * a multi-line head or guard) close where their expression does. Heredoc
 * (`\"\"\"`) lines are text. Line-start keyword matching mis-counted
 * `if a,\n do: b` (no `end`) and `x = case y do` (an `end` with no opener).
 */
function elixirEndLine(lines, startIndex) {
  const headEnd = elixirBodilessHeadEnd(lines, startIndex);
  if (headEnd !== null) return headEnd;
  let depth = 0;
  let parens = 0;
  let keyword = false;
  let heredoc = null;
  for (let i = startIndex; i < lines.length; i++) {
    const raw = String(lines[i] || '');
    if (heredoc) {
      if (raw.includes(heredoc)) heredoc = null;
      continue;
    }
    const fence = /("""|\'\'\')/.exec(raw);
    let code = elixirCode(fence ? raw.slice(0, fence.index) : raw);
    if (fence && !raw.slice(fence.index + 3).includes(fence[1])) heredoc = fence[1];
    code = code.replace(/:(?:do|end|fn)\b/g, '');
    for (const c of code) {
      if (c === '(' || c === '[' || c === '{') parens++;
      else if (c === ')' || c === ']' || c === '}') parens--;
    }
    const opens = (code.match(/\b(?:do\b(?!:)|fn\b)/g) || []).length;
    const closes = (code.match(/\bend\b(?!:)/g) || []).length;
    if (depth === 0 && opens === 0 && /\bdo:/.test(code)) keyword = true;
    depth += opens - closes;
    if (depth > 0) continue;
    if (depth < 0) return i + 1;
    if (opens > 0 || closes > 0) return i + 1;
    if (keyword && parens <= 0 && !/(?:,|[-+*/=|&<>]|\bwhen|\bdo:|\belse:)\s*$/.test(code)) {
      let j = i + 1;
      while (j < lines.length && /^\s*(?:#.*)?$/.test(lines[j])) j++;
      if (!/^\s*(?:\|>|else:|,)/.test(lines[j] || '')) return i + 1;
    }
  }
  return lines.length;
}

/**
 * Elixir `def f(a, b \\ 1)` with no `do` is a function head (default
 * arguments / docs for the clauses below), not a block: plug's
 * `def send_resp(conn)` spanned to the end of the file. Returns the 1-based
 * last line of the head, or null when a `do` opens a body. The head may span
 * lines (`def f(` … `)`), and a guard may follow on the next line
 * (`when is_binary(key) do`), which makes it a clause.
 */
function elixirBodilessHeadEnd(lines, startIndex) {
  if (!/^\s*(?:def|defp|defmacro|defmacrop)\s/.test(lines[startIndex] || '')) return null;
  let depth = 0;
  for (let i = startIndex; i < lines.length && i < startIndex + 30; i++) {
    const code = String(lines[i] || '').replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/#.*$/, '');
    if (/\bdo\b/.test(code)) return null;
    for (const c of code) {
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
    if (depth > 0 || /(?:,|\bwhen|\\\\|[-+*/=|&<>])\s*$/.test(code)) continue;
    let j = i + 1;
    while (j < lines.length && /^\s*(?:#.*)?$/.test(lines[j])) j++;
    if (/^\s*(?:when\b|do\b|do:|,|\|>|and\b|or\b)/.test(lines[j] || '')) return null;
    return i + 1;
  }
  return null;
}

/**
 * Arity of an Elixir clause head (`def f(a, %{b: c}), do: …` → 2; a default
 * argument `b \\ 1` counts), or null when the head does not close on its line.
 */
function elixirClauseArity(signature) {
  const m = /^\s*(def|defp|defmacro|defmacrop)\s+[\w?!]+\s*(\(?)/.exec(signature || '');
  if (!m) return null;
  if (!m[2]) return 0;
  let depth = 0;
  let commas = 0;
  let any = false;
  let quote = null;
  for (let i = m[0].length - 1; i < signature.length; i++) {
    const c = signature[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (c === '(' || c === '[' || c === '{') { if (depth > 0) any = true; depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return any ? commas + 1 : 0;
      continue;
    }
    if (depth === 1 && c === ',') commas++;
    else if (!/\s/.test(c)) any = true;
  }
  return null;
}

/**
 * Elixir: the clauses of one function (`def put_status(%{state: s}, _) when …`
 * then `def put_status(conn, nil)`, …) are one function — same name, kind and
 * arity, written next to each other (only blank, comment or `@` attribute
 * lines between). The regex extractor saw one entity per clause, so ss-trace
 * listed the later clauses as "other definitions". The first clause now spans
 * them all; rows of the later clauses move to it. Different arities (`f/1`,
 * `f/2`) stay separate functions.
 */
export function mergeElixirClauses(entities, relationships, callSites, lines) {
  if (!Array.isArray(entities) || entities.length < 2) return entities;
  const sorted = entities.slice().sort((a, b) => a.start_line - b.start_line);
  const into = new Map();
  let head = null;
  let headKey = null;
  for (const e of sorted) {
    const kind = /^\s*(def|defp|defmacro|defmacrop)\s/.exec(e.signature || '')?.[1];
    const arity = kind ? elixirClauseArity(e.signature) : null;
    const key = kind && arity !== null ? `${kind}\0${e.name}\0${arity}\0${e.parent_class || ''}` : null;
    if (key && head && key === headKey && e.start_line > head.end_line) {
      let between = true;
      for (let l = head.end_line + 1; l < e.start_line; l++) {
        if (!/^\s*(?:#.*|@[\w]+\b.*)?$/.test(lines[l - 1] ?? '')) { between = false; break; }
      }
      if (between) {
        head.end_line = Math.max(head.end_line, e.end_line);
        into.set(e.id, head.id);
        continue;
      }
    }
    head = key ? e : null;
    headKey = key;
  }
  if (into.size === 0) return entities;
  for (const r of relationships) if (into.has(r.source_id)) r.source_id = into.get(r.source_id);
  for (const c of callSites || []) if (into.has(c.source_id)) c.source_id = into.get(c.source_id);
  return entities.filter((e) => !into.has(e.id));
}

export function clampSentinelEndLines(entities, fileLineCount, language) {
  if (!Array.isArray(entities) || entities.length < 2) return entities;
  if (fileLineCount == null || fileLineCount <= 0) return entities;
  if (!LUA_CLAMP_ALLOWED_LANGUAGES.has(language)) return entities;
  for (let i = 0; i < entities.length - 1; i++) {
    const cur = entities[i];
    if (!NON_CONTAINER_TYPES.has(cur?.type)) continue;
    const curEnd = Number(cur?.end_line ?? 0);
    if (!Number.isFinite(curEnd) || curEnd < fileLineCount) continue;
    for (let j = i + 1; j < entities.length; j++) {
      const next = entities[j];
      const nextStart = Number(next?.start_line ?? 0);
      const curStart = Number(cur?.start_line ?? 0);
      if (!Number.isFinite(nextStart) || nextStart <= curStart) continue;
      if (nextStart >= curEnd) break;
      // Sentinel detected: clamp.
      if (nextStart - 1 >= curStart) {
        cur.end_line = nextStart - 1;
      }
      break;
    }
  }
  return entities;
}


/**
 * Normalize an identifier into searchable alias tokens.
 * Splits camelCase, PascalCase, snake_case, digits and emits both
 * the split form and the collapsed alnum form.
 *
 * @param {string} name - The original identifier name
 * @returns {string} Space-separated alias tokens (lowercased, deduped)
 *
 * @example
 * normalizeIdentifier('UserService')   // 'user service userservice'
 * normalizeIdentifier('getUserName')   // 'get user name getusername'
 * normalizeIdentifier('get_user_name') // 'get user name getusername'
 * normalizeIdentifier('HTMLParser2')   // 'html parser 2 htmlparser2'
 * normalizeIdentifier('OAuth2Client')  // 'o auth 2 client oauth2client'
 * normalizeIdentifier('auth.service')  // 'auth service authservice'
 */
export function normalizeIdentifier(name) {
  if (!name) return '';

  // Step 1-4: Split on separators and camelCase/PascalCase boundaries
  let split = name
    // Insert space before acronym→word transitions (e.g. HTMLParser -> HTML Parser)
    // Requires 2+ uppercase chars to avoid splitting single-letter prefixes (OAuth stays intact)
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
    // Insert space at camelCase boundaries (e.g. getUser -> get User)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Insert space at digit boundaries (e.g. Parser2 -> Parser 2, v2Handler -> v 2 Handler)
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    // Split on separators: _ - . / :
    .replace(/[_\-./:\\]/g, ' ');

  // Step 5-6: Lowercase and normalize whitespace
  const tokens = split.toLowerCase().split(/\s+/).filter(t => t.length > 0);

  // Step 7: Emit both split tokens and collapsed form
  const collapsed = tokens.join('');
  const uniqueTokens = [...new Set([...tokens, collapsed])];

  return uniqueTokens.join(' ');
}

/**
 * Persist the current schema version after schema creation/migration succeeds.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} [version=SCHEMA_VERSION]
 */
export function setSchemaVersion(db, version = SCHEMA_VERSION) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)`);
  db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)').run('version', String(version));
}

function getTableSql(db, tableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return row?.sql || '';
}

function normalizeSql(sql) {
  return sql.toLowerCase().replace(/\s+/g, ' ');
}

function hasExpectedEntitiesFtsSchema(sql) {
  const normalized = normalizeSql(sql);
  return normalized.includes('name_alias')
    && normalized.includes("tokenize='porter unicode61'")
    && normalized.includes("prefix='2 3 4'");
}

function hasExpectedTrigramSchema(sql) {
  const normalized = normalizeSql(sql);
  return normalized.includes("tokenize='trigram'")
    && normalized.includes("content='entities'")
    && normalized.includes("content_rowid='rowid'");
}

function backfillNameAliases(db) {
  const rowsNeedingAlias = db.prepare(`
    SELECT id, name
    FROM entities
    WHERE name IS NOT NULL
      AND (name_alias IS NULL OR trim(name_alias) = '')
  `).all();

  if (rowsNeedingAlias.length === 0) {
    return 0;
  }

  const updateAlias = db.prepare(`UPDATE entities SET name_alias = ? WHERE id = ?`);
  const applyBackfill = db.transaction((rows) => {
    for (const row of rows) {
      updateAlias.run(normalizeIdentifier(row.name), row.id);
    }
  });

  applyBackfill(rowsNeedingAlias);
  return rowsNeedingAlias.length;
}

function ensureLexicalFtsSchema(db) {
  const existingFtsSql = getTableSql(db, 'entities_fts');
  const existingCodeFtsSql = getTableSql(db, 'entities_code_fts');
  const existingTrigramSql = getTableSql(db, 'entities_trigram');
  const needsRebuild = !existingFtsSql
    || !existingTrigramSql
    || !hasExpectedEntitiesFtsSchema(existingFtsSql)
    || !hasExpectedTrigramSchema(existingTrigramSql)
    || (existingCodeFtsSql && !hasExpectedEntitiesFtsSchema(existingCodeFtsSql));

  if (needsRebuild) {
    db.exec(`DROP TABLE IF EXISTS entities_fts`);
    db.exec(`DROP TABLE IF EXISTS entities_code_fts`);
    db.exec(`DROP TABLE IF EXISTS entities_trigram`);
  }
  // Tables (re)created below start empty. On a graph that already holds
  // entities (an incremental tick opening an index built before
  // entities_code_fts existed) they are refilled from the content table at
  // once, so lexical search never runs on an empty index.
  const created = needsRebuild
    ? ['entities_fts', 'entities_code_fts', 'entities_trigram']
    : (existingCodeFtsSql ? [] : ['entities_code_fts']);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
      name,
      name_alias,
      signature,
      doc_comment,
      content='entities',
      content_rowid='rowid',
      tokenize='porter unicode61',
      prefix='2 3 4'
    )
  `);

  // entities_fts without the doc column: what non-agent formats and
  // name-restricted queries rank on. FTS5 bm25() normalises by the whole
  // row's token count, so a filled doc_comment would otherwise lower every
  // documented entity's name/signature score (GraphSearch DOC_COMMENT_FORMATS).
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entities_code_fts USING fts5(
      name,
      name_alias,
      signature,
      content='entities',
      content_rowid='rowid',
      tokenize='porter unicode61',
      prefix='2 3 4'
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entities_trigram USING fts5(
      name,
      signature,
      content='entities',
      content_rowid='rowid',
      tokenize='trigram'
    )
  `);

  if (created.length > 0 && db.prepare('SELECT 1 FROM entities LIMIT 1').get()) {
    for (const table of created) {
      // A content table without a column this FTS reads (a graph older than
      // the entities migrations) cannot rebuild; the next full build will.
      try { db.exec(`INSERT INTO ${table}(${table}) VALUES('rebuild')`); } catch { /* left empty */ }
    }
  }

  return { rebuilt: needsRebuild || created.length > 0 };
}

// =============================================================================
// ENTITY EXTRACTION PATTERNS
// =============================================================================

const JAVA_PATTERNS = {
  // Class declarations
  class: /(?:public|private|protected)?\s*(?:static)?\s*(?:final|abstract)?\s*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g,

  // Interface declarations
  interface: /(?:public)?\s*interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/g,

  // Enum declarations
  enum: /(?:public)?\s*enum\s+(\w+)/g,

  // Method declarations
  method: /(?:@\w+\s*(?:\([^)]*\))?\s*)*(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*(?:synchronized)?\s*(?:<[\w\s,<>?]+>\s*)?(\w+(?:<[\w\s,<>?]+>)?(?:\[\])?)\s+(\w+)\s*\(([^)]*)\)/g,

  // Field declarations
  field: /(?:public|private|protected)\s+(?:static)?\s*(?:final)?\s*(\w+(?:<[\w\s,<>?]+>)?(?:\[\])?)\s+(\w+)\s*[;=]/g,

  // Method calls
  methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/g,

  // Imports (supports static and wildcard: import com.foo.*; import static com.bar.Baz.*)
  import: /import\s+(?:static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/g,

  // Throw statements
  throw: /throw\s+new\s+(\w+)/g,

  // Package declaration
  package: /package\s+([\w.]+)\s*;/,
};

const JS_PATTERNS = {
  // Function declarations
  function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,

  // Arrow functions
  arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,

  // Class declarations
  class: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g,

  // React components (capitalized functions)
  component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/g,

  // Method calls
  methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/g,

  // Imports
  import: /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
};

const PROTO_PATTERNS = {
  // Message declarations
  message: /message\s+(\w+)\s*\{/g,

  // Service declarations
  service: /service\s+(\w+)\s*\{/g,

  // RPC declarations
  rpc: /rpc\s+(\w+)\s*\(\s*(\w+)\s*\)\s+returns\s+\(\s*(\w+)\s*\)/g,

  // Enum declarations
  enum: /enum\s+(\w+)\s*\{/g,
};

export const GENERIC_RELATIONSHIP_MAPPING = Object.freeze({
  import: 'imports',
  plainImport: 'imports',
  include: 'imports',
  require: 'imports',
  reexport: 'imports',
  dynamicImport: 'imports',
  use: 'imports',
  prepend: 'imports',
  open: 'imports',
  source: 'imports',
  from: 'imports',
  forward: 'imports',
  using: 'imports',
  link: 'imports',
  script: 'imports',
  copyFrom: 'imports',
  alias: 'imports',
  namespace: 'imports',
  ref: 'imports',
  dep: 'imports',
  package: 'imports',
  extends: 'extends',
  inherit: 'extends',
  mixin: 'extends',
  with: 'extends',
  category: 'extends',
  // TS: interface extends interface(s) is a true `extends` edge in
  // the graph (separate pattern key because the registry regex needs
  // to match on the `interface` keyword, not `class`).
  interfaceExtends: 'extends',
  implements: 'implements',
  protocol: 'implements',
  implFor: 'implements',
  behaviour: 'implements',
  interfaceWith: 'implements',
  // TS: type-only imports/re-exports are still module-level
  // dependencies, so they map to the same `imports` edge.
  typeImport: 'imports',
  typeReexport: 'imports',
  // TS: `<T extends Foo>` is a type reference, not an inheritance
  // edge — emit it as a `uses` relationship (consistent with how
  // decorators and method-of references are handled).
  genericConstraint: 'uses',
  // Signature type references (`function foo(x: User): Result`) are NOT
  // `uses` edges: they are emitted as the trace-only `typeRef` type
  // (type-usage-scanner.js; definition lines only, resolved only when
  // exactly one type matches), which no ranking consumer reads. Promoting
  // them to `uses` still needs an AST-level extractor and held-out MRR
  // evidence that graph expansion gains recall without precision loss.
  decorator: 'uses',
  embed: 'uses',
  extend: 'uses',
  anchor: 'uses',
  derive: 'uses',
  throw: 'uses',
  img: 'uses',
  form: 'uses',
  methodOf: 'uses',
});

export const INTENTIONAL_DEFAULT_RELATIONSHIP_TYPES = Object.freeze([]);
const escapeRegexLiteral = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Relationship patterns whose line annotates the NEXT definition (`@app.route`
// above `def index`, `#[derive(Debug)]` above `struct Foo`): the decorated
// definition is the source, not whatever scope encloses the annotation line.
const ATTRIBUTE_RELATIONSHIP_TYPES = new Set(['decorator', 'derive']);
// How far below an annotation its definition may start (stacked attributes,
// doc comments in between).
const ATTRIBUTE_MAX_GAP = 20;
// A Go embedded field (`RouterGroup`, `*sync.Mutex`) only exists inside a
// struct or interface body; anywhere else the same bare-identifier line is a
// const-block member or a statement.
const EMBED_SCOPE_TYPES = new Set(['struct', 'interface', 'class', 'type']);

/**
 * Per-file tracker for comment and docstring lines, called once per line in
 * order. Relationship patterns (extends / implements / decorator ...) must not
 * fire on `// class Fake extends Comment`, Javadoc/JSDoc examples or Python
 * docstring examples — those created self-loops and phantom bases.
 *
 * Deliberately conservative: a `/* ... *\/` block is only tracked when the line
 * STARTS with the opener (a `/*` inside a string such as a glob must not hide
 * the rest of the file). Python triple quotes are tracked by parity, so a
 * `SQL = """` assignment is skipped through its closing `"""`.
 */
export function createCommentLineTracker(comment) {
  if (!comment) return () => false;
  const lineToken = comment.line || null;
  const [open, close] = comment.block || [];
  const tripleQuote = open === '"""';
  const cStyle = open === '/*';
  let inBlock = false;
  let quote = null; // active Python triple-quote delimiter

  const count = (s, token) => {
    let n = 0;
    for (let i = s.indexOf(token); i !== -1; i = s.indexOf(token, i + token.length)) n++;
    return n;
  };

  return (trimmed) => {
    if (tripleQuote) {
      if (quote) {
        if (count(trimmed, quote) % 2 === 1) quote = null;
        return true;
      }
      if (lineToken && trimmed.startsWith(lineToken)) return true;
      for (const q of ['"""', "'''"]) {
        if (!trimmed.includes(q)) continue;
        const startsWithQuote = /^[rRbBuUfF]{0,2}("""|''')/.test(trimmed);
        if (count(trimmed, q) % 2 === 1) quote = q;
        return startsWithQuote;
      }
      return false;
    }
    if (inBlock) {
      if (trimmed.includes(close)) inBlock = false;
      return true;
    }
    if (lineToken && trimmed.startsWith(lineToken)) return true;
    if (open && trimmed.startsWith(open)) {
      if (!trimmed.includes(close, open.length)) inBlock = true;
      return true;
    }
    // Continuation of a block opened mid-line (`code(); /* note` ... ` * more`).
    return cStyle && (trimmed === '*' || trimmed.startsWith('* ') || trimmed.startsWith('*/'));
  };
}

// Relationship types whose patterns read a type declaration header.
const INHERITANCE_RELATIONSHIP_TYPES = new Set(['extends', 'implements']);
// Entity types that own an inheritance list. A one-line declaration
// (`enum Color implements Paint { RED }`, Kotlin `companion object F : C { fun make() }`)
// also starts a member on the same line; the list belongs to the type.
const TYPE_DECLARATION_ENTITY_TYPES = new Set([
  'class', 'interface', 'struct', 'record', 'trait', 'object', 'protocol', 'actor',
  'enum', 'extension', 'impl', 'module', 'mixin', 'type',
]);
// A line that starts a type declaration, after annotations and modifiers.
const TYPE_DECL_START = /^(?:(?:@[\w.]+(?:\([^)]*\))?|\[[^\]]*\]|template\s*<[^>]*>|export|default|public|private|protected|internal|open|abstract|sealed|final|static|data|inner|annotation|value|expect|actual|partial|readonly|unsafe|new|file|fileprivate|indirect|implicit|case|declare|companion|pub(?:\([^)]*\))?)\s+)*(?:class|interface|struct|record|trait|object|protocol|extension|actor|enum)\b/;
const TYPE_DECL_KEYWORD = /\b(?:class|interface|struct|record|trait|object|protocol|extension|actor|enum)\b/;
// A header line that is not finished yet, or a next line that continues it.
const HEADER_OPEN_END = /(?:[,(:&]|\b(?:extends|implements|with|where))$/;
const HEADER_CONTINUATION = /^(?::|extends\b|implements\b|with\b|where\b|permits\b|constructor\b|,|\)|\]|&|<:)/;
const MAX_HEADER_LINES = 12;
// A header still inside its brackets (a Kotlin / Scala / C# primary constructor) continues
// up to this many lines: okhttp's RealInterceptorChain lists 23 constructor parameters
// before `) : Interceptor.Chain {`, and the 12-line cap lost the supertype (no implements
// edge, so no overrides edge, so ss-trace knew no caller of RealInterceptorChain.proceed).
const MAX_BRACKETED_HEADER_LINES = 80;

function bracketDepth(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
  }
  return depth;
}

/**
 * Type declarations whose header continues on later lines: Kotlin
 * constructor parameters before `) : Base`, Python base lists one per line,
 * Java/TS `extends` / `implements` on their own lines, C#/C++/Swift `:` lists.
 * The inheritance patterns match one line, so they saw only the first header
 * line and lost every base after it.
 *
 * Returns the joined header text per declaration line, and the line indexes
 * the headers consumed (inheritance patterns skip those; their content is in
 * the join). One pass, regex-tested only on lines that contain a declaration
 * keyword.
 *
 * @param {string[]} lines
 * @param {{ lineComment?: string|null, colonBlocks?: boolean }} opts
 *   colonBlocks: the header ends at a `:` (Python), not at a `{`.
 * @returns {{ joins: Map<number, string>, consumed: Set<number> }}
 */
export function buildTypeHeaderJoins(lines, { lineComment = null, colonBlocks = false } = {}) {
  const joins = new Map();
  const consumed = new Set();
  const strip = (s) => {
    const t = s.trim();
    if (!lineComment) return t;
    const at = t.indexOf(` ${lineComment}`);
    return at >= 0 ? t.slice(0, at).trimEnd() : (t.startsWith(lineComment) ? '' : t);
  };
  const closed = (text) => (colonBlocks
    ? bracketDepth(text) === 0 && /:\s*$/.test(text)
    : text.includes('{') || text.endsWith(';'));

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!TYPE_DECL_KEYWORD.test(raw)) continue;
    let text = strip(raw);
    if (!TYPE_DECL_START.test(text) || closed(text)) continue;
    let j = i;
    while (j + 1 < lines.length && j - i < MAX_BRACKETED_HEADER_LINES) {
      const next = strip(lines[j + 1]);
      const depth = bracketDepth(text);
      if (depth === 0 && j - i >= MAX_HEADER_LINES) break;
      if (!next) {
        if (depth > 0) { j++; continue; }
        break;
      }
      // A new declaration never belongs to this header.
      if (TYPE_DECL_START.test(next) && depth === 0) break;
      const continues = depth > 0
        || (!colonBlocks && (HEADER_OPEN_END.test(text) || HEADER_CONTINUATION.test(next)));
      if (!continues) break;
      text += ` ${next}`;
      j++;
      if (closed(text)) break;
    }
    if (j === i) continue;
    const brace = colonBlocks ? -1 : text.indexOf('{');
    joins.set(i, brace >= 0 ? text.slice(0, brace + 1) : text);
    for (let k = i + 1; k <= j; k++) consumed.add(k);
    i = j;
  }
  return { joins, consumed };
}

/**
 * A definition's signature when its parameter list continues on later
 * lines: joined up to the line that closes the brackets (which carries the
 * return type), max MAX_HEADER_LINES; trailing line comments dropped.
 */
function joinDefinitionSignature(lines, i, lineComment) {
  const strip = (s) => {
    const t = s.trim();
    if (!lineComment) return t;
    const at = t.indexOf(` ${lineComment}`);
    return at >= 0 ? t.slice(0, at).trimEnd() : (t.startsWith(lineComment) ? '' : t);
  };
  let text = strip(lines[i]);
  for (let j = i + 1; j < lines.length && j - i <= MAX_HEADER_LINES && bracketDepth(text) > 0; j++) {
    text += ` ${strip(lines[j])}`;
  }
  return text;
}

/** True when line `i` (trimmed text) is part of a type declaration header. */
function isTypeHeaderLine(trimmed, i, headers) {
  if (headers && (headers.joins.has(i) || headers.consumed.has(i))) return true;
  return TYPE_DECL_KEYWORD.test(trimmed) && TYPE_DECL_START.test(trimmed);
}

/** True when `index` sits inside a `"…"` or `` `…` `` string literal of `text`. */
function insideStringLiteral(text, index) {
  let quote = null;
  for (let i = 0; i < index; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === '`') {
      quote = ch;
    }
  }
  return quote !== null;
}

// Types whose regex capture groups commonly contain comma-separated lists.
// Module-scope constant to avoid per-call Set allocation.
const MULTI_TARGET_TYPES = new Set([
  'plainImport', 'implements', 'inherit', 'protocol', 'with',
  // TS: `interface Foo extends Bar, Baz<T>` — comma-separated
  // parents, generics handled by expandRelationshipTargets.
  'interfaceExtends',
  // Python `class A(B, C)`, Java/PHP `interface I extends J, K`.
  'extends',
  // Rust `#[derive(Debug, Clone)]` — one edge per derived trait.
  'derive',
]);
// Inheritance-list entries that are not type names after cleanup (Python
// `metaclass=ABCMeta` / `*mixins`, leftovers of exotic syntax) are dropped.
const TYPE_LIST_ENTRY = /^\\?[A-Za-z_$][\w$]*(?:(?:\.|::|\\)[A-Za-z_$][\w$]*)*$/;

export const TREE_SITTER_ENTITY_PRIORITY = Object.freeze({
  component: 40,
  class: 35,
  // Kotlin `object`, Swift `actor` / `extension`: 'class' before their kinds
  // were read from the node; same rank.
  object: 35,
  actor: 35,
  extension: 35,
  function: 30,
  method: 25,
  arrowFunction: 20,
  interface: 20,
  typeAlias: 20,
  enum: 20,
  namespace: 20,
  struct: 30,
  record: 30,
  module: 25,
  // `variable` is intentionally lowest: when an `export const X = memo(...)`
  // matches BOTH the @component (rank 40) and @variable rules, component wins.
  // When `export const handler = async () => {}` matches BOTH @arrow (rank 20)
  // and @variable, arrowFunction wins. Plain `export const FOO = "bar"` only
  // matches @variable so it lands at rank 5 (kept).
  variable: 5,
  trait: 25,
  impl: 20,
  decorator: 15,
  // Rust macro_rules! definitions — same rank as function/struct/impl since
  // they're top-level definitions with similar discoverability needs.
  macro: 30,
  // Java enum constants (FieldNamingPolicy.UPPER_CAMEL_CASE) — fine-grained
  // anchor inside the enclosing enum class, but worth surfacing for
  // symbol-anchored probes. Rank between decorator and arrow: low enough
  // to not steal the enum's primary anchor when both match, high enough
  // to win over plain variables in disambiguation.
  enum_constant: 10,
  // Java field declarations (static finals like TypeAdapters.BIT_SET that
  // initialize anonymous inner-class subclasses). Same priority story as
  // enum_constant — useful for anchoring, not primary.
  field: 10,
  // C# property declarations (`public RespCommand Command { get; init; }`) —
  // first-class members per the C# spec, but lower in retrieval priority
  // than methods/classes when both could anchor a result. Same rank as
  // arrowFunction/interface/enum (20): high enough to win over enum_constant
  // when both match, low enough to never overshadow the owning class.
  property: 20,
  // Go package-level `const`, Rust `const` / `static` items: state, like
  // `variable` (Go package-level `var` reuses that label).
  const: 5,
  static: 5,
});

// Module-scope constants for extractJavaScript() — avoid per-call/per-line allocation.
const JS_CALL_SKIP_OBJECTS = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'process', 'Buffer', 'Date',
]);
// Language descriptors for the call scanner in the regex-only Java/JS paths
// (used when tree-sitter is unavailable).
const C_STYLE_COMMENTS = Object.freeze({ line: '//', block: ['/*', '*/'] });
const JS_CALL_SCANNER_LANG = Object.freeze({
  id: 'javascript',
  comment: C_STYLE_COMMENTS,
  graph: { skipCallObjects: [...JS_CALL_SKIP_OBJECTS] },
});
const JAVA_CALL_SCANNER_LANG = Object.freeze({
  id: 'java',
  comment: C_STYLE_COMMENTS,
  graph: { skipCallObjects: ['System', 'log', 'LOG', 'logger', 'String', 'Integer', 'Long'] },
});
const JS_RESERVED_WORDS = new Set([
  'if', 'else', 'for', 'while', 'switch', 'catch', 'with', 'do', 'try', 'return',
]);

// Import-like relationship patterns for extractJavaScript() — DRYs up five inline blocks.
const JS_IMPORT_PATTERNS = [
  { regex: /import\s+(?:\{[^}]+\}|\w+)\s+from\s+['"]([^'"]+)['"]/, group: 1 },
  { regex: /(?:const|let|var)\s+(?:\{[^}]+\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/, group: 1 },
  { regex: /export\s+(?:\{[^}]+\}|\*)\s+from\s+['"]([^'"]+)['"]/, group: 1 },
  { regex: /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/, group: 1 },
];

/**
 * True when an entity named `name` starts on `lineNum`. Regex extractors push
 * entities in line order, so only the tail of the list can match.
 */
function definedOnLine(entities, lineNum, name) {
  for (let i = entities.length - 1, k = 0; i >= 0 && k < 6; i--, k++) {
    const e = entities[i];
    if (e.start_line === lineNum && e.name === name) return true;
    if (e.start_line < lineNum) break;
  }
  return false;
}


/**
 * Rust `a::b::f()` where the path names a repo module (`serde_json::from_str`,
 * `crate::de::f`, `self::f`, or a `use`d module): a call of a free function of
 * that module or crate, never a method of a type that shares the name. The
 * call row carries `rustpath:<module file>|<crate source dir>/` so resolution
 * binds only there. Rust names modules in snake_case and types in CamelCase
 * (compiler lints), so a CamelCase qualifier (`Value::from_str`) is a type and
 * is left alone; so is a path that names no repo module (std, other crates).
 */
function annotateRustPathCalls(filePath, content, relationships, scanned, resolver) {
  const useByLast = new Map();
  for (const imp of scanned) {
    if (imp.kind !== 'use' || !imp.spec || imp.spec.endsWith('*')) continue;
    const last = imp.spec.split('::').pop();
    if (last && !useByLast.has(last)) useByLast.set(last, imp.spec);
  }
  let lines = null;
  const scopes = new Map();
  for (const rel of relationships) {
    if (rel.type !== 'calls' || rel.full_import_path || !rel.context_line) continue;
    const m = /^([a-z_][a-z0-9_]*)\.([A-Za-z_]\w*)$/.exec(String(rel.target_name || ''));
    if (!m) continue;
    if (!lines) lines = content.split('\n');
    const line = lines[rel.context_line - 1] || '';
    const pathRe = new RegExp(String.raw`(?<![\w:])((?:\w+\s*::\s*)*${m[1]})\s*::\s*${m[2]}\b`);
    const pm = pathRe.exec(line);
    if (!pm) continue;
    const segs = pm[1].split('::').map((x) => x.trim());
    // A path whose head is a `use`d module (`use serde_json::de; de::f()`).
    const alias = useByLast.get(segs[0]);
    const spec = [...(alias && !['crate', 'self', 'super'].includes(segs[0]) ? alias.split('::') : [segs[0]]), ...segs.slice(1), m[2]].join('::');
    let scope = scopes.get(spec);
    if (scope === undefined) {
      scope = resolver.rustPathScope(filePath, spec);
      scopes.set(spec, scope);
    }
    if (scope) rel.full_import_path = `${RUST_PATH_PREFIX}${scope.file}|${scope.crate ? `${scope.crate}/` : ''}${scope.name ? `|${scope.name}` : ''}`;
  }
}
/**
 * Whether a Go file also uses an import name `name` as something other than
 * the package: a local variable (`schema := …`, `a, schema := …`, `var
 * schema`), a parameter or receiver (`func f(schema *T)`), or a field
 * (`s.schema.Meta()`). The call row `schema.Meta` cannot tell such a use
 * from the package call (dgraph auth_test.go: `schema :=
 * test.LoadSchemaFromString(…)` then `schema.Meta()`), so the file's calls
 * through that name are left to the receiver rules.
 */
export function goNameShadowed(content, name) {
  if (!/^[A-Za-z_]\w*$/.test(name)) return true;
  // One pass over the name's whole-word occurrences, reading the code
  // around each one (no per-name regex scans of the whole file).
  const isWord = (c) => c !== undefined && /\w/.test(c);
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  for (let at = content.indexOf(name); at !== -1; at = content.indexOf(name, at + 1)) {
    const end = at + name.length;
    if (isWord(content[at - 1]) || isWord(content[end])) continue;
    let b = at - 1;
    let crossedLine = false;
    while (b >= 0 && isSpace(content[b])) { if (content[b] === '\n') crossedLine = true; b--; }
    let before = content[b];
    // A `.` that ends a `// comment.` line is no member access.
    if (crossedLine && before === '.') {
      const lineStart = content.lastIndexOf('\n', b) + 1;
      if (content.slice(lineStart, b).includes('//')) before = '\n';
    }
    let f = end;
    while (f < content.length && isSpace(content[f])) f++;
    const after = content[f];
    // `s.schema.Meta()`, `s.\n\tschema.Meta()`: a field of that name.
    if (before === '.' && after === '.') return true;
    // `schema := …`, `a, schema := …`, `for _, schema := range`.
    let g = f;
    for (;;) {
      if (content[g] === ':' && content[g + 1] === '=') return true;
      if (content[g] !== ',') break;
      g++;
      while (g < content.length && isSpace(content[g])) g++;
      const m = /^[A-Za-z_]\w*/.exec(content.slice(g, g + 64));
      if (!m) break;
      g += m[0].length;
      while (g < content.length && isSpace(content[g])) g++;
    }
    // `func f(schema *T)`, `func (schema *T) m()`, `a, schema int`.
    if ((before === '(' || before === ',') && f > end && /[*[A-Za-z_]/.test(after || '')) return true;
    // `var schema …`, `var a, schema …`: only `var` or a name list before it.
    if (after !== '.') {
      let k = b;
      for (;;) {
        if (content[k] === 'r' && content.startsWith('var', k - 2) && !isWord(content[k - 3])) return true;
        if (content[k] !== ',') break;
        k--;
        while (k >= 0 && isSpace(content[k])) k--;
        if (!isWord(content[k])) break;
        while (k >= 0 && isWord(content[k])) k--;
        while (k >= 0 && isSpace(content[k])) k--;
      }
    }
  }
  return false;
}

/**
 * Split a string on commas, but only at the top level — ignoring commas
 * inside <>, (), [], or {} brackets.
 */
export function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts;
}

// =============================================================================
// GRAPH EXTRACTOR CLASS
// =============================================================================

export class GraphExtractor {
  constructor(options) {
    this.projectRoot = options?.projectRoot || process.cwd();
    this.entities = new Map();
    this.relationships = [];
    this.currentFile = null;
    this.currentClass = null;
    this.packageName = '';
    this._useTreeSitter = options?.useTreeSitter !== false;
    this.warnOnPatternDrop = options?.warnOnPatternDrop || false;
    this.maxRegexLineLength = options?.maxRegexLineLength || 4000;
    this.debugCounters = {
      emptyCapture: {
        entity: 0,
        relationship: 0,
      },
      skippedLongLines: 0,
      byLanguage: {},
      byPattern: {},
    };
    this.patternPrefilterCache = new Map();
    this.methodCallRegexCache = new Map();
    this.genericPatternPlanCache = new Map();
    // Optional import resolver (core/graph/import-resolver.js). When set,
    // every file also gets `importsFile` edges to the repo files it imports,
    // and its legacy `imports` rows are annotated with the resolved file.
    this.importResolver = options?.importResolver || null;
    // Trace-only `instantiates` / `typeRef` / `extensionOf` rows
    // (relationship-types.js); ranking consumers skip them.
    this.typeUsageEdges = options?.typeUsageEdges ?? process.env.SWEET_SEARCH_TYPE_USAGE_EDGES !== '0';
    this._skipObjectSets = new Map();
    // Per-file id counters for entityId(); one entry per file being extracted.
    this._idStates = new Map();
  }

  _skipObjectSet(langInfo) {
    let set = this._skipObjectSets.get(langInfo.id);
    if (!set) {
      set = new Set(langInfo.graph?.skipCallObjects || []);
      this._skipObjectSets.set(langInfo.id, set);
    }
    return set;
  }

  /**
   * Extract entities and relationships from a file.
   * Dispatches to specialized extractors for Java/JS/Proto,
   * generic registry-based extractor for all other languages.
   */
  async extractFromFile(filePath, content) {
    this._idStates.set(filePath, new Map());
    let result;
    try {
      result = await this._extractFromFileInner(filePath, content);
    } finally {
      this._idStates.delete(filePath);
    }
    this._ensureUniqueEntityIds(filePath, result);
    let goPackages = null;
    if (this.importResolver && result.relationships) {
      goPackages = this._appendResolvedImports(filePath, content, result.relationships);
    }
    // `b.write(x)` where the caller declares `WriteBuffer b`: the call row
    // carries the declared type (receiver-types.js) so resolution binds only
    // to that type's method, never to another type's `write` by name.
    if (result.relationships) {
      annotateReceiverTypes(filePath, content, result.entities, result.relationships, { goPackages });
    }
    // Every extracted file has a graph node (file-nodes.js): the source of
    // its top-level edges. Same id as those edges' source_id, and the same
    // row from the full build and the incremental maintainer.
    result.file = {
      id: this.makeId(filePath, 'file', path.basename(filePath)),
      file_path: String(filePath).replace(/\\/g, '/'),
      name: path.basename(filePath),
    };
    return result;
  }

  /**
   * Collision guard. A full build stores entities with INSERT OR REPLACE and
   * the maintainer keys rows by id, so two entities of one file with one id
   * would silently lose one (the bug entityId() fixed). entityId() makes ids
   * unique by construction; this keeps it true if an extractor path ever
   * breaks it. Under tests (VITEST, or SWEET_SEARCH_STRICT_ENTITY_IDS=1) it
   * throws. Otherwise every later duplicate gets a derived id
   * (`<id>:#dup<k>`, k in source order — deterministic, and the same in a full
   * build and a maintainer tick), and the edges and call sites whose line
   * lies in its range move with it. Runs once per file on the extractor's
   * output, so both writers see the same ids.
   */
  _ensureUniqueEntityIds(filePath, result) {
    const entities = result?.entities;
    if (!entities || entities.length < 2) return;
    const count = new Map();
    let dups = null;
    for (const e of entities) {
      const k = count.get(e.id);
      count.set(e.id, (k ?? -1) + 1);
      if (k !== undefined) (dups ??= []).push({ e, k: k + 1 });
    }
    if (!dups) return;
    const sample = dups.slice(0, 3).map(({ e }) => `${e.type} ${e.name}@${e.start_line}`).join(', ');
    const message = `GraphExtractor: ${dups.length} duplicate entity id(s) in ${filePath} (${sample})`;
    if (process.env.VITEST || process.env.SWEET_SEARCH_STRICT_ENTITY_IDS === '1') throw new Error(message);
    console.warn(`${message} — kept with derived ids`);
    for (const { e, k } of dups) {
      const oldId = e.id;
      const newId = createHash('sha256').update(`${oldId}:#dup${k}`).digest('hex').slice(0, 16);
      e.id = newId;
      const end = e.end_line ?? e.start_line;
      const inRange = (line) => line != null && e.start_line != null && line >= e.start_line && line <= end;
      for (const r of result.relationships || []) if (r.source_id === oldId && inRange(r.context_line)) r.source_id = newId;
      for (const c of result.callSites || []) if (c.source_id === oldId && inRange(c.context_line)) c.source_id = newId;
    }
  }

  /**
   * File-level import edges. Scans whole import statements (multi-line,
   * default + named, namespace, side-effect, `pub use`, `mod x;`, Go blocks),
   * resolves each specifier to a repo file, and:
   *  1. appends one `importsFile` edge per (file, imported file):
   *     target_name = repo-relative target path (Go: package dir + '/'),
   *     full_import_path = the specifier as written;
   *  2. sets full_import_path on the matching legacy `imports` rows to the
   *     resolved file, or to `unresolved:<spec>` when the module is not a
   *     repo file, so name-based resolution stops guessing.
   * Legacy target_name/type values are never changed: they feed the
   * embedding `# Uses:` line (ENRICHMENT_VERSION contract).
   */
  _appendResolvedImports(filePath, content, relationships) {
    const langInfo = resolveLanguage(filePath, content);
    const language = langInfo?.id;
    if (language === 'json') {
      // package.json-style dependency rows name packages, never repo code.
      for (const rel of relationships) {
        if (rel.type === 'imports' && !rel.full_import_path) rel.full_import_path = `${UNRESOLVED_IMPORT_PREFIX}${rel.target_name}`;
      }
      return;
    }
    // .vue/.svelte/.astro are registry `html`; their scripts import like TS.
    const importLanguage = importLanguageFor(filePath, language);
    if (!importLanguage || !SCANNED_IMPORT_LANGUAGES.has(importLanguage)) return;
    let scanned;
    try { scanned = scanImports(content, importLanguage); } catch { return; }

    const fileEntityId = this.makeId(filePath, 'file', path.basename(filePath));
    const self = String(filePath).replace(/\\/g, '/');
    const bySpec = new Map();
    const byBinding = new Map();
    const seenTargets = new Set();
    const pushEdge = (target, spec, line) => {
      seenTargets.add(target);
      relationships.push({
        source_id: fileEntityId,
        target_id: null,
        target_name: target,
        type: 'importsFile',
        weight: GRAPH_CONFIG.relationshipWeights.imports,
        context_line: line,
        full_import_path: spec,
      });
    };
    // Go: the name each import binds in this file → `gopkg:<dir>/` for a repo
    // package (`gopkg:` for a module root at the repo root), or
    // `unresolved:<path>` for one outside the repo (standard library, third
    // party). A path under a repo module with no such directory is left out.
    const goPackages = importLanguage === 'go' && this.importResolver.goPackageDir ? new Map() : null;
    for (const imp of scanned) {
      const target = this.importResolver.resolve(filePath, imp, importLanguage);
      // A namespace import (C# `using X.Y;`) names a namespace, never one
      // entity: name matching bound `using Ocelot.Configuration.File;` to a
      // class called Ocelot. Its file-level dependencies come from
      // implicitImports below; the legacy row gets no entity target.
      const annotation = target || `${UNRESOLVED_IMPORT_PREFIX}${imp.spec}`;
      if (goPackages) {
        const name = goImportName(imp);
        if (name && !goPackages.has(name)) {
          const dir = this.importResolver.goPackageDir(filePath, imp.spec);
          if (dir === null) goPackages.set(name, `${UNRESOLVED_IMPORT_PREFIX}${imp.spec}`);
          else if (typeof dir === 'string') goPackages.set(name, `${GO_PACKAGE_PREFIX}${dir ? `${dir}/` : ''}`);
        }
      }
      if (!bySpec.has(imp.spec)) bySpec.set(imp.spec, annotation);
      for (const name of imp.names || []) if (!byBinding.has(name)) byBinding.set(name, annotation);
      if (!target || target === self || seenTargets.has(target)) continue;
      pushEdge(target, imp.spec, imp.line);
    }
    // Namespace / package / module languages: files whose top-level
    // declarations this file uses (C# usings, JVM same-package and `*`
    // imports, Swift modules, Elixir module names).
    const implicit = this.importResolver.implicitImports?.(filePath, content, importLanguage, scanned) || [];
    for (const dep of implicit) {
      if (dep.target === self || seenTargets.has(dep.target)) continue;
      pushEdge(dep.target, dep.spec, dep.line);
    }

    for (const rel of relationships) {
      if (rel.type !== 'imports' || rel.full_import_path) continue;
      const name = rel.target_name;
      const key = language === 'rust' ? String(name).replace(/::$/, '') : name;
      let annotation = bySpec.get(key);
      if (annotation === undefined && language === 'rust') {
        // Legacy Rust rows hold the `use` prefix (`crate::a::b::`); match
        // the longest scanned path under it.
        for (const [spec, ann] of bySpec) if (spec.startsWith(`${key}::`)) { annotation = ann; break; }
      }
      if (annotation === undefined && !rel.context_line) annotation = byBinding.get(name);
      // A legacy row no import statement accounts for is a per-line regex
      // false positive (Go: any line starting with a string literal, e.g.
      // map keys `"name": x`); keep its text, stop it resolving by name.
      // Ruby/PHP rows also carry include/trait uses, so they are left alone.
      if (annotation === undefined && STATEMENT_COVERED_IMPORT_LANGUAGES.has(language)) {
        annotation = `${UNRESOLVED_IMPORT_PREFIX}${name}`;
      }
      if (annotation !== undefined) rel.full_import_path = annotation;
    }

    // Go `pkg.Func()` where `pkg` is an import name: a call into that package,
    // never a method of a same-named local value. full_import_path carries
    // the package so resolution binds only the package's top-level function
    // (`x.Parse` → x/keys.go Parse, not WorkerOptions.Parse) and leaves a
    // non-repo package unresolved (`glog.Errorf` is no in-repo
    // ToGlog.Errorf). Legacy target_name stays as written.
    if (goPackages && goPackages.size > 0) {
      const ambiguous = new Map();
      for (const rel of relationships) {
        if (rel.type !== 'calls' || rel.full_import_path) continue;
        const dot = String(rel.target_name || '').indexOf('.');
        if (dot <= 0) continue;
        const receiver = rel.target_name.slice(0, dot);
        const rest = rel.target_name.slice(dot + 1);
        if (!rest || rest.includes('.') || rest.includes('(')) continue;
        const pkg = goPackages.get(receiver);
        if (!pkg) continue;
        let skip = ambiguous.get(receiver);
        if (skip === undefined) {
          skip = goNameShadowed(content, receiver);
          ambiguous.set(receiver, skip);
        }
        if (!skip) rel.full_import_path = pkg;
      }
    }
    if (importLanguage === 'rust' && this.importResolver.rustPathScope) {
      annotateRustPathCalls(filePath, content, relationships, scanned, this.importResolver);
    }
    return goPackages;
  }

  async _extractFromFileInner(filePath, content) {
    this.currentFile = filePath;
    const lines = content.split('\n');
    // resolveLanguage handles per-file disambiguation of ambiguous extensions
    // (today: `.h` → c-vs-cpp) so header-only C++ libraries get parsed by
    // tree-sitter-cpp rather than tree-sitter-c.
    const langInfo = resolveLanguage(filePath, content);

    if (!langInfo) {
      return { entities: [], relationships: [] };
    }

    // Try tree-sitter extraction first (more accurate than regex)
    if (this._useTreeSitter) {
      try {
        const provider = getTreeSitterProvider();
        if (await provider.isAvailable() && provider.hasLanguage(langInfo.id)) {
          const symbols = await provider.extractSymbols(content, langInfo.id);
          // C#: the shipped grammar predates C# 12 primary constructors
          // (`class Box<T>(T route) : Base(route)`); on such files the class
          // is lost and its methods parse as local functions. Those files keep
          // the regex extractor (ocelot: 42 of 757 files).
          const csharpParseError = langInfo.id === 'csharp' && symbols?.hasParseError;
          // Go/Rust files that do not parse and yield only state entities
          // (var/const/static) keep the regex extractor, as they did before
          // those entities existed: the grammar lost their definitions.
          const stateOnlyParseError = symbols?.hasParseError
            && STATE_CAPTURE_LANGUAGES.has(langInfo.id)
            && symbols.every((s) => STATE_ENTITY_TYPES.has(s.type));
          if (symbols && symbols.length > 0 && !csharpParseError && !stateOnlyParseError) {
            // Convert tree-sitter symbols to graph entities format and align
            // labels with regex semantics (component/object arrow distinctions).
            const entities = this._normalizeTreeSitterEntities(filePath, symbols, langInfo.id, lines);
            // Still extract relationships with regex (tree-sitter only gives definitions)
            const callSites = [];
            const relationships = this._extractRelationships(content, lines, filePath, langInfo, entities, callSites);
            return { entities, relationships, callSites };
          }
        }
      } catch {
        // Fall through to regex extraction
      }
    }

    // Specialized extractors for languages with complex logic
    if (langInfo.id === 'java') {
      return this.extractJava(content, lines, filePath);
    }
    if (langInfo.id === 'javascript') {
      return this.extractJavaScript(content, lines, filePath);
    }
    if (langInfo.id === 'proto') {
      return this.extractProto(content, lines, filePath);
    }

    // Generic registry-based extraction for all other languages
    if (langInfo.graph) {
      return this.extractGeneric(content, lines, filePath, langInfo);
    }

    return { entities: [], relationships: [] };
  }

  /**
   * Extract from Java file
   */
  extractJava(content, lines, filePath) {
    this._idStates.set(filePath, new Map()); // fresh id counters (entityId)
    const entities = [];
    const relationships = [];

    // Extract package
    const pkgMatch = content.match(JAVA_PATTERNS.package);
    this.packageName = pkgMatch ? pkgMatch[1] : '';

    // Extract Java imports (Phase 3.2: Java Import Extraction)
    // Creates 'imports' relationships for dependency tracking
    const fileEntityId = this.makeId(filePath, 'file', path.basename(filePath));
    const javaCallScanner = new CallSiteScanner(JAVA_CALL_SCANNER_LANG);
    const callSites = [];
    const seenCalls = this._callEdgeSet(callSites); // one ranking edge per (caller, target) per file
    const javaBare = this._bareCallSink(callSites);
    const importMatches = content.matchAll(JAVA_PATTERNS.import);

    for (const match of importMatches) {
      const importPath = match[1];
      const isStatic = match[0].includes('static');
      const isWildcard = importPath.endsWith('.*');

      // Find the line number of this import by counting newlines before match position
      // Note: Uses regex match which creates an array; for truly allocation-free counting,
      // would need a manual loop, but this is fast enough for typical file sizes (<10k lines)
      const importLine = (content.substring(0, match.index).match(/\n/g) || []).length + 1;

      // Extract the class name for target resolution
      // For "com.example.services.AuthService" -> target_name = "AuthService"
      // For "com.example.services.*" -> target_name = "services" (package - won't resolve)
      // For static "com.example.utils.Constants.MAX_VALUE" -> target_name = "Constants" (class only)
      // For static "com.example.utils.Constants.*" -> target_name = "Constants" (class only)
      const pathWithoutWildcard = importPath.replace(/\.\*$/, '');
      const parts = pathWithoutWildcard.split('.');

      // Static import logic explanation:
      // - Regular import "com.foo.Bar" → target = "Bar" (last part)
      // - Regular wildcard "com.foo.*" → target = "foo" (last part after removing *)
      // - Static import "com.foo.Bar.METHOD" → target = "Bar" (second-to-last, the class)
      // - Static wildcard "com.foo.Bar.*" → target = "Bar" (last part after removing *, the class)
      // The key insight: static imports reference CLASS members, so we need the class name,
      // not the member name, for entity resolution to work correctly.
      let targetName;
      if (isWildcard && !isStatic) {
        // Regular wildcard: import com.foo.* -> package name (won't resolve to entity)
        targetName = parts[parts.length - 1];
      } else if (isStatic) {
        // Static import: import static com.foo.Bar.METHOD or com.foo.Bar.*
        // The class is second-to-last part (Bar), member is last (METHOD or *)
        // For resolution, we want the CLASS name (Bar), not the member
        targetName = parts.length >= 2 ? parts[parts.length - (isWildcard ? 1 : 2)] : parts[parts.length - 1];
      } else {
        // Regular import: import com.foo.Bar -> class name
        targetName = parts[parts.length - 1];
      }

      // Skip empty or invalid target names
      if (!targetName || targetName.length === 0) continue;

      relationships.push({
        source_id: fileEntityId,
        target_id: null,  // Will be resolved by resolveRelationshipTargets()
        target_name: targetName,
        full_import_path: importPath,  // Store full path for better resolution
        type: 'imports',
        weight: GRAPH_CONFIG.relationshipWeights.imports,
        context_line: importLine,
        is_static: isStatic,
        is_wildcard: isWildcard,
      });
    }

    // Track current class for method/field association
    let currentClass = null;
    let braceDepth = 0;
    let classStartDepth = 0;
    // Track whether we are inside a `/* ... */` or `/** ... */` block
    // comment. Without this, every entity-emission regex below also
    // matches Javadoc `<pre>` examples ("public class MyClass { ... }"),
    // creating phantom classes/methods/calls in the graph. Verified on
    // gson SerializedName.java / Since.java / Until.java where phantom
    // `MyClass`/`User`/`Gson`/`fromJson` entities were polluting
    // search-time symbol attribution via findFirstEntityInRange.
    // The state is a per-line boolean: true if the line BEGINS inside
    // a block comment (and we therefore skip all regex extractions and
    // brace counting on that line). State transitions on the first
    // `/*` open and the first `*/` close encountered, scanned left-to-
    // right. Inline `/* ... */` on a single line is treated as the
    // line containing both open and close — the line ends OUT of the
    // comment, so extraction runs as normal (a rare but harmless edge:
    // identifiers on the same line as a closing `*/` could still be
    // picked up; this matches existing whole-file regex behaviour).
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      const enteredAtStart = inBlockComment;
      // Update inBlockComment state from this line's `/*` opens and
      // `*/` closes. We scan character-by-character but cheaply: a
      // single pass with two indexOf-style searches per iteration.
      {
        let scan = 0;
        while (scan < line.length) {
          if (inBlockComment) {
            const close = line.indexOf('*/', scan);
            if (close < 0) { scan = line.length; break; }
            inBlockComment = false;
            scan = close + 2;
          } else {
            const open = line.indexOf('/*', scan);
            if (open < 0) { scan = line.length; break; }
            // Inline line-comment `//` before `/*` on the same line:
            // // /* not really a block */ — treat the `//` as wins.
            const lineCom = line.indexOf('//', scan);
            if (lineCom >= 0 && lineCom < open) { scan = line.length; break; }
            inBlockComment = true;
            scan = open + 2;
          }
        }
      }

      // Skip lines that are entirely inside a block comment (including
      // the case where the line opens AND stays inside — entered false,
      // ends true: line has no executable code AFTER the `/*`).
      const lineWasFullyInComment = enteredAtStart && inBlockComment;
      if (lineWasFullyInComment) {
        // Don't count braces, don't run extraction regexes.
        continue;
      }

      // Track brace depth (raw-line approximation, matches pre-fix
      // behaviour for non-comment lines).
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Reset current class when we exit its scope
      if (currentClass && braceDepth < classStartDepth) {
        currentClass = null;
      }

      // If we OPENED a block comment on this line, code BEFORE the
      // `/*` is still real — run extraction on the line as usual; the
      // Javadoc body that follows starts on the next iteration with
      // inBlockComment=true. Same for lines that close a block comment
      // (we already cleared the state above by the time we get here).
      // Defensive: if the line is mostly Javadoc but has trailing code
      // after `*/`, the regex will still capture; that mirrors the
      // existing 99% case (real `public class Foo {` lines).

      // Class declarations
      const classMatch = line.match(/(?:public|private|protected)?\s*(?:static)?\s*(?:final|abstract)?\s*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/);
      if (classMatch) {
        const className = classMatch[1];
        const extendsClass = classMatch[2];
        const implementsStr = classMatch[3];

        const { id } = this.entityId(filePath, 'class', className, { line });
        const entity = {
          id,
          file_path: filePath,
          type: 'class',
          name: className,
          signature: line.trim(),
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
          package: this.packageName,
        };
        entities.push(entity);
        currentClass = entity;
        classStartDepth = braceDepth;

        // Extends relationship
        if (extendsClass) {
          relationships.push({
            source_id: id,
            target_id: null, // resolved by name (the base may live in another file)
            target_name: extendsClass,
            type: 'extends',
            weight: GRAPH_CONFIG.relationshipWeights.extends,
          });
        }

        // Implements relationships
        if (implementsStr) {
          const interfaces = implementsStr.split(',').map(s => s.trim());
          for (const iface of interfaces) {
            relationships.push({
              source_id: id,
              target_id: null,
              target_name: iface,
              type: 'implements',
              weight: GRAPH_CONFIG.relationshipWeights.implements,
            });
          }
        }
      }

      // Interface declarations
      const ifaceMatch = line.match(/(?:public)?\s*interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/);
      if (ifaceMatch) {
        const ifaceName = ifaceMatch[1];
        const { id } = this.entityId(filePath, 'interface', ifaceName, { line });

        entities.push({
          id,
          file_path: filePath,
          type: 'interface',
          name: ifaceName,
          signature: line.trim(),
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
          package: this.packageName,
        });

        // Extends relationships for interfaces
        const extendsStr = ifaceMatch[2];
        if (extendsStr) {
          const extended = extendsStr.split(',').map(s => s.trim());
          for (const ext of extended) {
            relationships.push({
              source_id: id,
              target_id: null,
              target_name: ext,
              type: 'extends',
              weight: GRAPH_CONFIG.relationshipWeights.extends,
            });
          }
        }
      }

      // Method declarations
      const methodMatch = line.match(/(?:@\w+\s*(?:\([^)]*\))?\s*)*(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*(?:synchronized)?\s*(?:<[\w\s,<>?]+>\s*)?(\w+(?:<[\w\s,<>?]+>)?(?:\[\])?)\s+(\w+)\s*\(([^)]*)\)/);
      if (methodMatch && !line.includes('class ') && !line.includes('interface ')) {
        const returnType = methodMatch[1];
        const methodName = methodMatch[2];
        const params = methodMatch[3];

        // Skip if this looks like a constructor
        if (returnType === currentClass?.name) continue;

        // Build full signature for collision-proof ID (overloaded methods)
        const fullSignature = `${returnType} ${methodName}(${params})`;
        const signatureHash = this.makeSignatureHash(fullSignature);

        // Use signature hash for disambiguation of overloaded methods
        const { id } = this.entityId(filePath, 'method', methodName, { owner: currentClass?.name, line });

        entities.push({
          id,
          file_path: filePath,
          type: 'method',
          name: methodName,
          signature: fullSignature,
          signature_hash: signatureHash,  // Store for backup/restore matching
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findMethodEndLine(lines, i),
          parent_class: currentClass?.name,
          package: this.packageName,
        });

        // Check for @Override
        if (i > 0 && lines[i - 1].includes('@Override')) {
          relationships.push({
            source_id: id,
            target_id: null, // Will be resolved later
            target_name: methodName,
            type: 'overrides',
            weight: GRAPH_CONFIG.relationshipWeights.overrides,
          });
        }
      }

      // Method calls (within method bodies; comment-aware)
      const javaSource = currentClass ? currentClass.id : null;
      javaCallScanner.scanLine(
        line,
        (targetName) => this._pushCallEdge(relationships, seenCalls, javaSource, targetName, lineNum),
        (name) => javaBare(javaSource || fileEntityId, name, lineNum),
        (name) => definedOnLine(entities, lineNum, name),
      );

      // Throw statements
      const throwMatch = line.match(/throw\s+new\s+(\w+)/);
      if (throwMatch && currentClass) {
        relationships.push({
          source_id: currentClass.id,
          target_id: null,
          target_name: throwMatch[1],
          type: 'throws',
          weight: GRAPH_CONFIG.relationshipWeights.throws,
        });
      }
    }

    return { entities, relationships, callSites };
  }

  /**
   * Extract from JavaScript/TypeScript file
   */
  extractJavaScript(content, lines, filePath) {
    this._idStates.set(filePath, new Map()); // fresh id counters (entityId)
    const entities = [];
    const relationships = [];
    const fileEntityId = this.makeId(filePath, 'file', path.basename(filePath));
    const callSites = [];
    const jsBare = this._bareCallSink(callSites);
    const jsCallScanner = new CallSiteScanner(JS_CALL_SCANNER_LANG);
    const seenCalls = this._callEdgeSet(callSites); // one ranking edge per (caller, target) per file

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // --- Entity extraction (if-else chain: first match wins per line) ---

      const classMatch = line.match(/(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
      if (classMatch) {
        const className = classMatch[1];
        const { id } = this.entityId(filePath, 'class', className, { line });
        entities.push({
          id,
          file_path: filePath,
          type: 'class',
          name: className,
          signature: line.trim(),
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
        });
        if (classMatch[2]) {
          relationships.push({
            source_id: id,
            target_id: null,
            target_name: classMatch[2],
            type: 'extends',
            weight: GRAPH_CONFIG.relationshipWeights.extends,
          });
        }
      } else {
        const funcMatch = line.match(/(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+(\w+)\s*\(/);
        if (funcMatch) {
          const sig = line.trim().slice(0, 100);
          entities.push({
            id: this.entityId(filePath, 'function', funcMatch[1], { line }).id,
            file_path: filePath,
            type: 'function',
            name: funcMatch[1],
            signature: sig,
            signature_hash: this.makeSignatureHash(sig),
            doc_comment: this.extractDocComment(lines, i),
            start_line: lineNum,
            end_line: this.findEndLine(lines, i),
          });
        } else {
          const componentMatch = line.match(/(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/);
          if (componentMatch) {
            const sig = line.trim().slice(0, 100);
            entities.push({
              id: this.entityId(filePath, 'component', componentMatch[1], { line }).id,
              file_path: filePath,
              type: 'component',
              name: componentMatch[1],
              signature: sig,
              signature_hash: this.makeSignatureHash(sig),
              doc_comment: this.extractDocComment(lines, i),
              start_line: lineNum,
              end_line: this.findEndLine(lines, i),
            });
          } else {
            const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
            if (arrowMatch) {
              const sig = line.trim().slice(0, 100);
              entities.push({
                id: this.entityId(filePath, 'arrowFunction', arrowMatch[1], { line }).id,
                file_path: filePath,
                type: 'arrowFunction',
                name: arrowMatch[1],
                signature: sig,
                signature_hash: this.makeSignatureHash(sig),
                doc_comment: this.extractDocComment(lines, i),
                start_line: lineNum,
                end_line: this.findEndLine(lines, i),
              });
            } else {
              const objArrowMatch = line.match(/(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/);
              if (objArrowMatch) {
                entities.push({
                  id: this.entityId(filePath, 'arrowFunction', objArrowMatch[1], { line }).id,
                  file_path: filePath,
                  type: 'arrowFunction',
                  name: objArrowMatch[1],
                  signature: line.trim().slice(0, 100),
                  doc_comment: this.extractDocComment(lines, i),
                  start_line: lineNum,
                  end_line: this.findEndLine(lines, i),
                });
              } else {
                const objMethodMatch = line.match(/^\s+(\w+)\s*\([^)]*\)\s*\{/);
                if (objMethodMatch && !JS_RESERVED_WORDS.has(objMethodMatch[1])) {
                  entities.push({
                    id: this.entityId(filePath, 'method', objMethodMatch[1], { line }).id,
                    file_path: filePath,
                    type: 'method',
                    name: objMethodMatch[1],
                    signature: line.trim().slice(0, 100),
                    doc_comment: this.extractDocComment(lines, i),
                    start_line: lineNum,
                    end_line: this.findEndLine(lines, i),
                  });
                }
              }
            }
          }
        }
      }

      // --- Relationship extraction ---

      // Module-level import patterns (ESM import, CJS require, re-export, dynamic import)
      for (const { regex, group } of JS_IMPORT_PATTERNS) {
        const m = line.match(regex);
        if (m) {
          const source = m[group];
          if (source && !source.startsWith('.')) {
            relationships.push({
              source_id: fileEntityId,
              target_id: null,
              target_name: source,
              type: 'imports',
              weight: GRAPH_CONFIG.relationshipWeights.imports,
            });
          }
        }
      }

      // Destructured require — per-name import relationships
      this._appendDestructuredRequireRelationships(line, fileEntityId, relationships);

      // Method call relationships (comment-aware)
      jsCallScanner.scanLine(
        line,
        (targetName) => this._pushCallEdge(relationships, seenCalls, fileEntityId, targetName, lineNum),
        (name) => jsBare(fileEntityId, name, lineNum),
        (name) => definedOnLine(entities, lineNum, name),
      );
    }

    return { entities, relationships, callSites };
  }

  /**
   * Extract from Proto file
   */
  extractProto(content, lines, filePath) {
    this._idStates.set(filePath, new Map()); // fresh id counters (entityId)
    const entities = [];
    const relationships = [];

    // The service whose block holds the current line: rpc names are only
    // unique per service (two services may both declare `Query`).
    let currentService = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      if (currentService && lineNum > currentService.end_line) currentService = null;

      // Message declarations
      const msgMatch = line.match(/message\s+(\w+)\s*\{/);
      if (msgMatch) {
        entities.push({
          id: this.entityId(filePath, 'message', msgMatch[1], { line }).id,
          file_path: filePath,
          type: 'message',
          name: msgMatch[1],
          signature: line.trim(),
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
        });
      }

      // Service declarations
      const svcMatch = line.match(/service\s+(\w+)\s*\{/);
      if (svcMatch) {
        currentService = {
          id: this.entityId(filePath, 'service', svcMatch[1], { line }).id,
          file_path: filePath,
          type: 'service',
          name: svcMatch[1],
          signature: line.trim(),
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
        };
        entities.push(currentService);
      }

      // RPC declarations
      const rpcMatch = line.match(/rpc\s+(\w+)\s*\(\s*(\w+)\s*\)\s+returns\s+\(\s*(\w+)\s*\)/);
      if (rpcMatch) {
        const rpcName = rpcMatch[1];
        const inputType = rpcMatch[2];
        const outputType = rpcMatch[3];

        const owner = currentService?.name || null;
        const { id } = this.entityId(filePath, 'rpc', rpcName, { owner, line });
        entities.push({
          id,
          file_path: filePath,
          type: 'rpc',
          name: rpcName,
          signature: line.trim(),
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: lineNum,
          ...(owner ? { parent_class: owner } : {}),
        });

        // RPC uses input and output messages
        relationships.push({
          source_id: id,
          target_id: null,
          target_name: inputType,
          type: 'uses',
          weight: GRAPH_CONFIG.relationshipWeights.uses,
        });
        relationships.push({
          source_id: id,
          target_id: null,
          target_name: outputType,
          type: 'uses',
          weight: GRAPH_CONFIG.relationshipWeights.uses,
        });
      }
    }

    return { entities, relationships };
  }

  /**
   * Generic extraction using registry patterns.
   * Works for all languages that have graph patterns in language-patterns.js.
   */
  extractGeneric(content, lines, filePath, langInfo) {
    this._idStates.set(filePath, new Map()); // fresh id counters (entityId)
    const entities = [];
    const relationships = [];
    const { graph, id: language } = langInfo;
    const {
      entityPatterns,
      relationshipPatterns,
      methodCallPattern,
    } = this.getGenericPatternPlan(language, graph);
    const callScanner = (methodCallPattern || EXTRA_CALL_SCAN_LANGUAGES.has(language)) ? new CallSiteScanner(langInfo) : null;
    const callSites = [];
    const seenCalls = this._callEdgeSet(callSites); // one ranking edge per (caller, target) per file
    const seenTypeUsage = this._typeUsageSet(callSites); // one trace row per (source, type, target); every line in callSites
    const skipObjects = this._skipObjectSet(langInfo);
    const bareSink = this._bareCallSink(callSites);
    const fileEntityId = this.makeId(filePath, 'file', path.basename(filePath));
    const jsonDependencySections = new Set(['dependencies', 'devDependencies', 'peerDependencies']);
    let jsonBraceDepth = 0;
    let activeJsonDependencyDepth = null;
    // Track active entity scopes to attribute call source_id by lexical range.
    const activeEntityScopes = [];
    const lineComment = langInfo.comment?.line || null;
    const hasBlockComment = Array.isArray(langInfo.comment?.block)
      && langInfo.comment.block[0] === '/*';
    const trackCommentLine = createCommentLineTracker(langInfo.comment);
    // Decorator/derive edges waiting for the definition below them.
    let pendingAttributes = [];
    const headers = this._typeHeaderJoins(relationshipPatterns, lines, langInfo);

    // Choose findEndLine strategy based on language type
    const findEndLineFn = (startIdx) => {
      if (langInfo.indentBased) {
        return this.findEndLineIndent(lines, startIdx);
      }
      if (langInfo.endKeyword) {
        return this.findEndLineKeyword(lines, startIdx, langInfo.endKeyword, langInfo.blockKeywords, langInfo.id);
      }
      return this.findEndLine(lines, startIdx);
    };

    const docLines = langInfo.id === 'elixir' ? elixirHeredocLines(lines) : null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      const lineNum = i + 1;
      // Inside an Elixir heredoc (`@doc """` examples such as
      // `def call(conn, _opts) do`): text, not definitions or calls.
      if (docLines?.has(i)) {
        callScanner?.skipLine();
        continue;
      }
      const lineIsComment = trackCommentLine(trimmed);
      while (
        activeEntityScopes.length > 0 &&
        activeEntityScopes[activeEntityScopes.length - 1].end_line < lineNum
      ) {
        activeEntityScopes.pop();
      }
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      const depthBefore = jsonBraceDepth;
      const depthAfter = depthBefore + openBraces - closeBraces;
      if (trimmed.length > this.maxRegexLineLength) {
        this._recordLongLineSkip(language, lineNum, trimmed.length);
        callScanner?.skipLine();
        if (language === 'json') {
          if (activeJsonDependencyDepth !== null && depthAfter < activeJsonDependencyDepth) {
            activeJsonDependencyDepth = null;
          }
          jsonBraceDepth = depthAfter;
        }
        continue;
      }

      // JSON dependency extraction:
      // "dependencies"/"devDependencies"/"peerDependencies" are section markers.
      // Actual imports are package keys inside those objects.
      if (language === 'json' && activeJsonDependencyDepth !== null && depthBefore === activeJsonDependencyDepth) {
        const depEntry = trimmed.match(/^"([^"]+)"\s*:\s*"([^"]+)"/);
        if (depEntry && depEntry[1]) {
          relationships.push({
            source_id: fileEntityId,
            target_id: null,
            target_name: depEntry[1],
            type: 'imports',
            weight: GRAPH_CONFIG.relationshipWeights.imports,
            context_line: lineNum,
          });
        }
      }

      // Entity extraction. Comment lines are skipped: unanchored definition
      // patterns matched doc prose (Swift `/// … protocol comes …` became a
      // protocol named `comes` and parent of the next type).
      const isCommentLine = (lineComment && trimmed.startsWith(lineComment))
        || (hasBlockComment && (trimmed.startsWith('*') || trimmed.startsWith('/*')));
      for (const { type, pattern, prefilter } of (isCommentLine ? [] : entityPatterns)) {
        if (prefilter && !prefilter(trimmed)) continue;
        const match = trimmed.match(pattern);
        if (match) {
          // Lua method definitions `function List:clone()` are stored like
          // `function M.helper()`: dotted (`List.clone`), so resolution reads
          // the method name from the last segment. Lua only: `xs:element`
          // (XML) and `::` paths keep their colons.
          const name = language === 'lua' && match[1] ? match[1].replace(/(?<=\w):(?=\w)/g, '.') : match[1];
          if (!name) {
            this._recordEmptyCapture('entity', language, type, lineNum, trimmed);
            continue;
          }
          const sig = trimmed.slice(0, 120);
          const sigHash = this.makeSignatureHash(sig);
          const endLine = findEndLineFn(i);
          // Containment: the innermost enclosing entity owns this one only
          // when it is a type-like container (a definition inside a function
          // body is local, not a member).
          // Off for `end`-keyword languages: their keyword-counted end lines
          // are too loose (sequel: 756 of 3,543 Ruby parents wrong).
          const enclosing = activeEntityScopes[activeEntityScopes.length - 1];
          const parentClass = !langInfo.endKeyword && enclosing
            && REGEX_CONTAINER_TYPES.has(enclosing.type) ? enclosing.name : null;
          const { id: entityId, duplicate } = this.entityId(filePath, type, name, {
            owner: parentClass,
            line: trimmed,
            data: DATA_KEY_LANGUAGES.has(language),
          });
          if (duplicate) {
            // An exact repeat of a data key: the first occurrence is the entity.
            activeEntityScopes.push({ id: entityId, start_line: lineNum, end_line: endLine, type, name });
            break;
          }

          entities.push({
            id: entityId,
            file_path: filePath,
            type,
            name,
            signature: sig,
            signature_hash: sigHash,
            doc_comment: this.extractDocComment(lines, i),
            start_line: lineNum,
            end_line: endLine,
            ...(parentClass ? { parent_class: parentClass } : {}),
          });
          activeEntityScopes.push({ id: entityId, start_line: lineNum, end_line: endLine, type, name });
          if (pendingAttributes.length > 0 && type !== 'decorator') {
            for (const rel of pendingAttributes) {
              if (lineNum - rel.context_line <= ATTRIBUTE_MAX_GAP) rel.source_id = entityId;
            }
            pendingAttributes = [];
          }
          break; // one entity per line
        }
      }

      // Relationship extraction
      const sourceEntityId = activeEntityScopes.length > 0
        ? activeEntityScopes[activeEntityScopes.length - 1].id
        : null;
      // Call sites (comment-aware; see call-site-scanner.js).
      if (callScanner) {
        callScanner.scanLine(
          line,
          (targetName) => this._pushCallEdge(relationships, seenCalls, sourceEntityId || fileEntityId, targetName, lineNum),
          (name) => bareSink(sourceEntityId || fileEntityId, name, lineNum),
          (name) => definedOnLine(entities, lineNum, name),
        );
      }
      if (!lineIsComment) {
        const lastEntity = entities[entities.length - 1];
        this._appendTypeUsageEdges(relationships, seenTypeUsage, trimmed, lineNum, language,
          sourceEntityId || fileEntityId, lastEntity?.start_line === lineNum ? lastEntity : null,
          skipObjects, isTypeHeaderLine(trimmed, i, headers), () => joinDefinitionSignature(lines, i, lineComment));
      }

      this._appendDestructuredRequireRelationships(trimmed, sourceEntityId || fileEntityId, relationships);

      for (const { type: relType, pattern, prefilter } of relationshipPatterns) {
        if (relType === 'methodCall') continue;
        const mappedType = GENERIC_RELATIONSHIP_MAPPING[relType] || 'uses';
        if (lineIsComment && mappedType !== 'imports') continue;
        const isInheritance = INHERITANCE_RELATIONSHIP_TYPES.has(mappedType);
        let subject = trimmed;
        if (isInheritance && headers) {
          if (headers.consumed.has(i)) continue;
          subject = headers.joins.get(i) ?? trimmed;
        }
        if (prefilter && !prefilter(subject)) continue;

        const match = subject.match(pattern);
        if (match && isInheritance && match.index > 0 && insideStringLiteral(subject, match.index)) continue;
        if (relType === 'dep' && language === 'json') {
          if (match && match[1] && jsonDependencySections.has(match[1]) && depthAfter > depthBefore) {
            activeJsonDependencyDepth = depthAfter;
          }
          continue;
        }
        if (match) {
          if (relType === 'embed' && !EMBED_SCOPE_TYPES.has(activeEntityScopes[activeEntityScopes.length - 1]?.type)) continue;
          const { targets, filtered } = this._resolveRelationshipTargets(relType, match, language);
          if (targets.length === 0) {
            if (!filtered) this._recordEmptyCapture('relationship', language, relType, lineNum, trimmed);
            continue;
          }
          const weight = GRAPH_CONFIG.relationshipWeights[mappedType] || 1.0;
          const isAttribute = ATTRIBUTE_RELATIONSHIP_TYPES.has(relType);
          const lastEntity = entities[entities.length - 1];
          const declaredType = isInheritance && lastEntity?.start_line === lineNum
            && TYPE_DECLARATION_ENTITY_TYPES.has(lastEntity.type) ? lastEntity.id : null;
          // A namespace never inherits: the declaration on this line is not an
          // entity (C++ partial specialization `struct W<std::vector<T>>`).
          if (isInheritance && !declaredType
            && activeEntityScopes[activeEntityScopes.length - 1]?.type === 'namespace') continue;
          for (const target of targets) {
            const rel = {
              source_id: declaredType || sourceEntityId || fileEntityId,
              target_id: null,
              target_name: target,
              type: mappedType,
              weight,
              context_line: lineNum,
            };
            relationships.push(rel);
            if (isAttribute) pendingAttributes.push(rel);
          }
        }
      }

      if (language === 'json') {
        if (activeJsonDependencyDepth !== null && depthAfter < activeJsonDependencyDepth) {
          activeJsonDependencyDepth = null;
        }
        jsonBraceDepth = depthAfter;
      }
    }

    // Sentinel clamp (2026-05-13): Lua-only. The regex `findEndLineKeyword`
    // falls through to `return lines.length` when the `end` keyword counter
    // mis-balances (control-flow keywords sharing line context), producing
    // entities with end_line=EOF that swallow subsequent siblings (LU-003:
    // tablex.deepcopy at 118-120 was being rendered as 98-999 because the
    // preceding sibling cycle_aware_copy had bogus end_line=999). The
    // language gate inside clampSentinelEndLines is explicit — other
    // regex-path languages (zig, scala, kotlin, etc.) are unaffected and
    // would need per-language validation before opt-in.
    clampSentinelEndLines(entities, lines.length, langInfo?.id);
    const kept = langInfo?.id === 'elixir' ? mergeElixirClauses(entities, relationships, callSites, lines) : entities;

    return { entities: kept, relationships, callSites };
  }

  getGenericPatternPlan(language, graph) {
    const cached = this.genericPatternPlanCache.get(language);
    if (cached) return cached;

    const entityPatterns = Object.entries(graph.entities || {}).map(([type, pattern]) => ({
      type,
      pattern,
      prefilter: this.getPatternPrefilter(pattern),
    }));
    const relationshipPatterns = Object.entries(graph.relationships || {}).map(([type, pattern]) => ({
      type,
      pattern,
      prefilter: this.getPatternPrefilter(pattern),
    }));

    const methodCallEntry = relationshipPatterns.find((entry) => entry.type === 'methodCall');
    const methodCallPattern = methodCallEntry
      ? this.getCachedGlobalRegex(language, methodCallEntry.pattern)
      : null;
    const plan = {
      entityPatterns,
      relationshipPatterns,
      methodCallPattern,
      methodCallPrefilter: methodCallEntry?.prefilter || null,
    };
    this.genericPatternPlanCache.set(language, plan);
    return plan;
  }

  getCachedGlobalRegex(language, pattern) {
    const key = `${language}:${pattern.source}:${pattern.flags}`;
    const cached = this.methodCallRegexCache.get(key);
    if (cached) return cached;

    const uniqueFlags = [...new Set(`${pattern.flags || ''}g`)].join('');
    const compiled = new RegExp(pattern.source, uniqueFlags);
    this.methodCallRegexCache.set(key, compiled);
    return compiled;
  }

  getPatternPrefilter(pattern) {
    const key = `${pattern.source}:${pattern.flags}`;
    if (this.patternPrefilterCache.has(key)) {
      return this.patternPrefilterCache.get(key);
    }

    const caseInsensitive = pattern.flags.includes('i');
    let tokens = this.extractLineStartTokens(pattern.source);
    const optionalPrefixMatch = pattern.source.match(/^\^(\\?.)\?/);
    if (optionalPrefixMatch && tokens.length > 0) {
      const prefix = optionalPrefixMatch[1].startsWith('\\')
        ? optionalPrefixMatch[1].slice(1)
        : optionalPrefixMatch[1];
      tokens = [...tokens, ...tokens.map((token) => `${prefix}${token}`)];
    }
    if (tokens.length === 0) {
      this.patternPrefilterCache.set(key, null);
      return null;
    }

    const normalizedTokens = caseInsensitive
      ? [...new Set(tokens.map((t) => t.toLowerCase()))]
      : [...new Set(tokens)];
    const prefilter = (line) => {
      const value = caseInsensitive ? line.toLowerCase() : line;
      return normalizedTokens.some((token) => value.startsWith(token));
    };
    this.patternPrefilterCache.set(key, prefilter);
    return prefilter;
  }

  extractLineStartTokens(source) {
    if (!source.startsWith('^')) return [];

    let i = 1;
    const tokens = [];

    const skipLeadingWhitespace = () => {
      if (source.slice(i).startsWith('\\s*')) {
        i += 3;
        return true;
      }
      if (source.slice(i).startsWith('\\s+')) {
        i += 3;
        return true;
      }
      return false;
    };

    while (skipLeadingWhitespace()) {}

    while (source.slice(i).startsWith('(?:')) {
      const start = i + 3;
      let depth = 1;
      let j = start;
      let inClass = false;
      while (j < source.length && depth > 0) {
        const ch = source[j];
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']' && inClass) inClass = false;
        else if (!inClass && ch === '(') depth++;
        else if (!inClass && ch === ')') depth--;
        j++;
      }
      if (depth !== 0) return [];

      const groupEnd = j - 1;
      const groupContent = source.slice(start, groupEnd);
      // A group quantified by `?` OR `*` can match zero times, so the tokens
      // AFTER it (e.g. the real keyword) may start the line. Treating a `(?:…)*`
      // modifier prefix as mandatory wrongly rejected lines like `class Foo`
      // (QL/Vala/Haxe leading-modifier patterns), dropping all their entities.
      const isOptional = source[groupEnd + 1] === '?' || source[groupEnd + 1] === '*';
      if (!isOptional) {
        const alternatives = groupContent.split('|').map((alt) => alt.trim()).filter(Boolean);
        const altTokens = [];
        for (const alt of alternatives) {
          const token = this.extractLiteralPrefix(alt);
          if (!token) return [];
          altTokens.push(token);
        }
        tokens.push(...altTokens);
        return [...new Set(tokens)];
      }
      const optionalAlternatives = groupContent.split('|').map((alt) => alt.trim()).filter(Boolean);
      for (const alt of optionalAlternatives) {
        const token = this.extractLiteralPrefix(alt);
        // A nested group / non-literal alternative (e.g. `(?:(?:public|…)\s+)*`)
        // means we cannot enumerate every literal this optional prefix could
        // start with. Adding only the literals we *can* see would
        // false-negative lines that begin with an un-enumerated one (Vala/Haxe
        // `public class Foo`). Disabling the prefilter is the only
        // correctness-preserving choice; the full regex still runs per line.
        if (!token) return [];
        tokens.push(token);
      }
      i = groupEnd + 2;
      while (skipLeadingWhitespace()) {}
    }

    const literal = this.extractLiteralPrefix(source.slice(i));
    if (!literal) {
      // If no mandatory literal prefix can be derived, disable prefilter to avoid false negatives.
      return [];
    }
    tokens.push(literal);
    return [...new Set(tokens)];
  }

  extractLiteralPrefix(fragment) {
    let result = '';

    for (let i = 0; i < fragment.length; i++) {
      const ch = fragment[i];
      let literal;
      let width;
      if (ch === '\\') {
        const next = fragment[i + 1];
        if (!next) break;
        if (/[A-Za-z0-9]/.test(next)) break;
        literal = next;
        width = 2;
      } else if (/[A-Za-z0-9_@#<./:-]/.test(ch)) {
        literal = ch;
        width = 1;
      } else {
        break;
      }

      // The quantifier on this literal decides whether a line must contain
      // it. `\*?` / `-?` / `x*` may match nothing: skip it while the prefix is
      // still empty (e.g. -?include), otherwise stop before it — an escaped
      // optional char (`^\*?Foo`) was read as a mandatory `*`, so the Go
      // embed pattern rejected every embed without a pointer star.
      const quantifier = fragment[i + width];
      if (quantifier === '?' || quantifier === '*') {
        if (result.length > 0) break;
        i += width;
        continue;
      }
      result += literal;
      // `a+` / `a{2}`: the literal is required, but what follows may repeat it.
      if (quantifier === '+' || quantifier === '{') break;
      i += width - 1;
    }

    return result;
  }

  expandRelationshipTargets(relType, target) {
    if (typeof target !== 'string') return [target];
    if (!MULTI_TARGET_TYPES.has(relType)) return [target];

    if (relType === 'plainImport') {
      return splitTopLevelCommas(target)
        .map((entry) => entry.trim().replace(/\s+as\s+\w+$/i, '').replace(/[;{}]+$/, '').trim())
        .filter(Boolean);
    }

    // Generic constraints end the type list: Swift `extension Foo: Bar where
    // Value: Baz`, Kotlin/C# `class Foo<T> : Bar where T : Baz`.
    const list = target.replace(/\s+where\s[\s\S]*$/, '');

    // Bracket-depth-aware top-level comma splitter.
    // Naive .split(',') would break generics: Base<Foo, Bar>, IFace
    // GraphQL joins interfaces with `&` (`implements Character & Employee`).
    const parts = splitTopLevelCommas(list).flatMap((entry) => entry.split('&'));

    return parts
      .map((entry) => entry.trim()
        .replace(/^(?:(?:public|protected|private|virtual)\s+)+/, '')  // C++ access specifiers
        .replace(/<.*$/, '')                          // strip generics from first <: Map<K, V> → Map
        .replace(/[([].*$/, '')                       // ctor args / Python generics: Base(x), Generic[T]
        .replace(/\s+by\s[\s\S]*$/, '')               // Kotlin delegation: Base by impl
        .replace(/^:+/, '')                           // C++ global qualifier: ::Base
        .replace(/[;{}]+$/, '')                       // strip trailing punctuation
        .trim()
      )
      .filter((entry) => TYPE_LIST_ENTRY.test(entry));
  }

  _clampSentinelEndLines(entities, fileLineCount) {
    return clampSentinelEndLines(entities, fileLineCount);
  }

  _normalizeTreeSitterEntities(filePath, symbols, language, lines = null) {
    this._idStates.set(filePath, new Map()); // fresh id counters (entityId)
    const dedupedBySymbolAndLine = new Map();

    for (const sym of symbols) {
      if (!sym?.name || !sym?.type) continue;
      const normalizedType = this._normalizeTreeSitterSymbolType(sym.type, sym.name);
      // Note: previously dropped 'variable' for js/ts to avoid noise from
      // every internal `let x = 1`. The current TS/TSX/JS tag query scopes
      // @variable.definition to `(export_statement (lexical_declaration ...))`
      // so only EXPORTED top-level consts reach this point — keep them.
      const startLine = Number.isInteger(sym.startLine) ? sym.startLine : 0;
      const endLine = Number.isInteger(sym.endLine) ? sym.endLine : startLine;
      const rank = TREE_SITTER_ENTITY_PRIORITY[normalizedType] || 0;
      const key = `${sym.name}:${startLine}`;
      const existing = dedupedBySymbolAndLine.get(key);

      if (!existing || rank > existing.rank) {
        dedupedBySymbolAndLine.set(key, {
          file_path: filePath,
          type: normalizedType,
          name: sym.name,
          signature: sym.signature || null,
          doc_comment: sym.docComment || null,
          start_line: startLine + 1, // tree-sitter is 0-indexed
          end_line: endLine + 1,
          ...(sym.parentClass ? { parent_class: sym.parentClass } : {}),
          rank,
        });
      }
    }

    const sorted = Array.from(dedupedBySymbolAndLine.values())
      .sort((a, b) => a.start_line - b.start_line
        || (a.end_line - b.end_line)
        || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Ids in source order (entityId numbers identical definitions in that
    // order), from the full definition line — the tree-sitter `signature`
    // is cut at 120 chars.
    const data = DATA_KEY_LANGUAGES.has(language);
    const kept = [];
    for (const entity of sorted) {
      const line = lines?.[entity.start_line - 1] ?? entity.signature ?? '';
      const { id, duplicate } = this.entityId(filePath, entity.type, entity.name, {
        owner: entity.parent_class || null,
        line,
        data,
      });
      if (duplicate) continue;
      kept.push({ id, ...entity });
    }
    // Tree-sitter path: NO sentinel clamp. Tree-sitter parsers return
    // accurate end_lines via grammar-driven extraction; the regex-path
    // `findEndLineKeyword` fall-through is the only known source of the
    // bogus-EOF pattern, and only Lua currently goes through that path
    // (Lua has no tree-sitter grammar registered).
    return kept.map(({ rank, ...entity }) => entity);
  }

  _normalizeTreeSitterSymbolType(type, name) {
    if (type === 'arrowFunction' && /^[A-Z]/.test(name)) {
      return 'component';
    }
    return type;
  }

  /** Joined multi-line type headers (buildTypeHeaderJoins), or null when no inheritance pattern exists. */
  _typeHeaderJoins(relationshipPatterns, lines, langInfo) {
    const hasInheritance = relationshipPatterns.some(({ type }) =>
      INHERITANCE_RELATIONSHIP_TYPES.has(GENERIC_RELATIONSHIP_MAPPING[type]));
    if (!hasInheritance) return null;
    const lineComment = langInfo.comment?.line || null;
    return buildTypeHeaderJoins(lines, {
      lineComment,
      colonBlocks: langInfo.id === 'python',
    });
  }

  _resolveRelationshipTargets(relType, match, language) {
    const isJsTs = language === 'javascript' || language === 'typescript' || language === 'tsx';

    if (isJsTs && relType === 'import') {
      const source = match[3]?.trim();
      if (!source) return { targets: [], filtered: false };
      if (source.startsWith('.')) return { targets: [], filtered: true };
      return { targets: [source], filtered: false };
    }

    if (isJsTs && (relType === 'require' || relType === 'reexport' || relType === 'dynamicImport'
      || relType === 'typeImport' || relType === 'typeReexport')) {
      const source = match[1]?.trim();
      if (!source) return { targets: [], filtered: false };
      if (source.startsWith('.')) return { targets: [], filtered: true };
      return { targets: [source], filtered: false };
    }

    const rawTarget = typeof match[1] === 'string' ? match[1].trim() : match[1];
    if (!rawTarget) return { targets: [], filtered: false };

    return {
      targets: this.expandRelationshipTargets(relType, rawTarget),
      filtered: false,
    };
  }

  _appendDestructuredRequireRelationships(line, sourceId, relationships) {
    const destructuredRequire = line.match(/(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (!destructuredRequire) return;

    const names = this._extractDestructuredRequireNames(destructuredRequire[1]);
    for (const name of names) {
      relationships.push({
        source_id: sourceId,
        target_id: null,
        target_name: name,
        type: 'imports',
        weight: GRAPH_CONFIG.relationshipWeights.imports,
      });
    }
  }

  _extractDestructuredRequireNames(rawNames) {
    return rawNames
      .split(',')
      .map(part => part.trim())
      .map((name) => {
        if (!name) return null;

        // JS destructuring alias: { readFile: read }.
        if (name.includes(':')) {
          name = name.split(':').pop().trim();
        }

        // TS-style docs aliasing: { foo as bar }.
        const asAlias = name.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
        if (asAlias) {
          name = asAlias[1];
        }

        // Remove default value patterns: { foo = fallback }.
        name = name.replace(/=.*/, '').trim();
        name = name.replace(/^\.\.\./, '').trim();

        return /^[A-Za-z_$][\w$]*$/.test(name) ? name : null;
      })
      .filter(Boolean);
  }

  /**
   * Extract relationships using regex patterns from langInfo.graph.
   * Used by tree-sitter path where entities come from AST but relationships
   * still need regex (tree-sitter tags.scm only gives definitions).
   */
  _extractRelationships(content, lines, filePath, langInfo, entities, callSites = null) {
    const relationships = [];
    if (!langInfo.graph) return relationships;

    const { graph, id: language } = langInfo;
    const {
      relationshipPatterns,
      methodCallPattern,
    } = this.getGenericPatternPlan(language, graph);
    const callScanner = (methodCallPattern || EXTRA_CALL_SCAN_LANGUAGES.has(language)) ? new CallSiteScanner(langInfo) : null;
    const seenCalls = this._callEdgeSet(callSites); // one ranking edge per (caller, target) per file
    const fileEntityId = this.makeId(filePath, 'file', path.basename(filePath));

    // Build scope lookup from tree-sitter entities for source_id attribution
    const sortedEntities = [...entities].sort((a, b) => a.start_line - b.start_line);

    const findScopeEntity = (lineNum) => {
      for (let i = sortedEntities.length - 1; i >= 0; i--) {
        const e = sortedEntities[i];
        if (e.start_line <= lineNum && e.end_line >= lineNum) {
          return e.id;
        }
      }
      return null;
    };
    // The definition an annotation line belongs to: the first non-decorator
    // entity starting at or below it (tree-sitter may start a decorated
    // definition at its first decorator line).
    const findAnnotatedEntity = (lineNum) => {
      for (const e of sortedEntities) {
        if (e.start_line < lineNum || e.type === 'decorator') continue;
        return e.start_line - lineNum <= ATTRIBUTE_MAX_GAP ? e.id : null;
      }
      return null;
    };
    const findScopeType = (lineNum) => {
      for (let i = sortedEntities.length - 1; i >= 0; i--) {
        const e = sortedEntities[i];
        if (e.start_line <= lineNum && e.end_line >= lineNum) return e.type;
      }
      return null;
    };
    const trackCommentLine = createCommentLineTracker(langInfo.comment);
    // Definition starting on a line (signature types → `typeRef`).
    const definitionAt = new Map();
    // The widest type declaration starting on a line owns that line's
    // inheritance list (not a member declared on the same line).
    const typeDeclarationAt = new Map();
    const typeSpanAt = new Map();
    for (const e of sortedEntities) {
      if (!definitionAt.has(e.start_line)) definitionAt.set(e.start_line, e);
      if (!TYPE_DECLARATION_ENTITY_TYPES.has(e.type)) continue;
      const span = (e.end_line ?? e.start_line) - e.start_line;
      if (!typeDeclarationAt.has(e.start_line) || span > typeSpanAt.get(e.start_line)) {
        typeDeclarationAt.set(e.start_line, e.id);
        typeSpanAt.set(e.start_line, span);
      }
    }
    const headers = this._typeHeaderJoins(relationshipPatterns, lines, langInfo);
    const seenTypeUsage = this._typeUsageSet(callSites); // one trace row per (source, type, target); every line in callSites
    const skipObjects = this._skipObjectSet(langInfo);
    const bareSink = callSites ? this._bareCallSink(callSites) : null;
    // Names defined on each line: `def helper(` must not read as a call.
    const definedOnLine = new Map();
    if (bareSink) {
      for (const e of sortedEntities) {
        let names = definedOnLine.get(e.start_line);
        if (!names) { names = new Set(); definedOnLine.set(e.start_line, names); }
        names.add(e.name);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      const lineNum = i + 1;
      const lineIsComment = trackCommentLine(trimmed);

      if (trimmed.length > this.maxRegexLineLength) {
        callScanner?.skipLine();
        continue;
      }

      const sourceEntityId = findScopeEntity(lineNum);
      if (!lineIsComment) {
        this._appendTypeUsageEdges(relationships, seenTypeUsage, trimmed, lineNum, language,
          sourceEntityId || fileEntityId, definitionAt.get(lineNum), skipObjects,
          isTypeHeaderLine(trimmed, i, headers), () => joinDefinitionSignature(lines, i, langInfo.comment?.line || null));
      }

      // Call sites (comment-aware; see call-site-scanner.js).
      if (callScanner) {
        callScanner.scanLine(
          line,
          (targetName) => this._pushCallEdge(relationships, seenCalls, sourceEntityId || fileEntityId, targetName, lineNum),
          bareSink ? (name) => bareSink(sourceEntityId || fileEntityId, name, lineNum) : null,
          bareSink ? (name) => definedOnLine.get(lineNum)?.has(name) === true : null,
        );
      }

      this._appendDestructuredRequireRelationships(trimmed, sourceEntityId || fileEntityId, relationships);

      // Other relationships (imports, extends, etc.)
      for (const { type: relType, pattern, prefilter } of relationshipPatterns) {
        if (relType === 'methodCall') continue;
        const mappedType = GENERIC_RELATIONSHIP_MAPPING[relType] || 'uses';
        if (lineIsComment && mappedType !== 'imports') continue;
        const isInheritance = INHERITANCE_RELATIONSHIP_TYPES.has(mappedType);
        let subject = trimmed;
        if (isInheritance && headers) {
          if (headers.consumed.has(i)) continue;
          subject = headers.joins.get(i) ?? trimmed;
        }
        if (prefilter && !prefilter(subject)) continue;

        const match = subject.match(pattern);
        if (match && isInheritance && match.index > 0 && insideStringLiteral(subject, match.index)) continue;
        if (match) {
          if (relType === 'embed' && !EMBED_SCOPE_TYPES.has(findScopeType(lineNum))) continue;
          const { targets, filtered } = this._resolveRelationshipTargets(relType, match, language);
          if (targets.length === 0) {
            if (!filtered) this._recordEmptyCapture('relationship', language, relType, lineNum, trimmed);
            continue;
          }
          const weight = GRAPH_CONFIG.relationshipWeights[mappedType] || 1.0;
          const declaredType = isInheritance ? typeDeclarationAt.get(lineNum) : null;
          // A namespace never inherits: the declaration on this line is not an
          // entity (C++ partial specialization `struct W<std::vector<T>>`).
          if (isInheritance && !declaredType && findScopeType(lineNum) === 'namespace') continue;
          const sourceId = (ATTRIBUTE_RELATIONSHIP_TYPES.has(relType) && findAnnotatedEntity(lineNum))
            || declaredType
            || sourceEntityId || fileEntityId;
          for (const target of targets) {
            relationships.push({
              source_id: sourceId,
              target_id: null,
              target_name: target,
              type: mappedType,
              weight,
              context_line: lineNum,
            });
          }
        }
      }
    }

    return relationships;
  }

  /**
   * Collector for bare call sites (`helper(x)` — no receiver). They go to the
   * separate `call_sites` table, never to `relationships`: ranking (PageRank,
   * graph expansion, communities, ref counts) reads relationships only, and
   * ss-trace resolves bare calls at query time with scope rules
   * (bare-call-resolution.js). One row per call site: ss-trace lists every
   * line a caller calls the name on (`call@440,476`).
   */
  _bareCallSink(callSites) {
    const seen = new Set();
    return (sourceId, name, lineNum) => {
      if (!sourceId) return;
      const key = `${sourceId}\u0000${name}\u0000${lineNum}`;
      if (seen.has(key)) return;
      seen.add(key);
      callSites.push({ source_id: sourceId, callee_name: name, context_line: lineNum });
    };
  }

  /**
   * Per-file state for qualified call edges: the (caller, target) pairs that
   * already have a ranking row, and the sink for every call site's line.
   */
  _callEdgeSet(callSites) {
    return { keys: new Set(), sites: callSites, siteKeys: new Set() };
  }

  /**
   * Record a qualified call. `relationships` gets one row per (caller, target)
   * per file — the first site's line — as ranking has always seen it: repeat
   * rows were deleted by the resolver (resolved duplicates hit the unique
   * index). Every site is recorded in callSites (`target_name` set);
   * insertCallSites stores the lines of repeated pairs in the trace-only
   * `call_lines` table, so ss-trace shows each call.
   */
  _pushCallEdge(relationships, seen, sourceId, targetName, lineNum) {
    if (seen.sites && sourceId) {
      const siteKey = `${sourceId}\u0000${targetName}\u0000${lineNum}`;
      if (!seen.siteKeys.has(siteKey)) {
        seen.siteKeys.add(siteKey);
        seen.sites.push({ source_id: sourceId, target_name: targetName, context_line: lineNum });
      }
    }
    const key = `${sourceId}\u0000${targetName}`;
    if (seen.keys.has(key)) return;
    seen.keys.add(key);
    relationships.push({
      source_id: sourceId,
      target_id: null,
      target_name: targetName,
      type: 'calls',
      weight: GRAPH_CONFIG.relationshipWeights.calls,
      context_line: lineNum,
    });
  }

  /**
   * Per-file state for trace-only type-usage rows: the (source, type, target)
   * keys that already have a row, and the sink for every site's line (the
   * same callSites list qualified calls use, tagged with `rel_type`).
   */
  _typeUsageSet(callSites) {
    return { keys: new Set(), sites: callSites, siteKeys: new Set() };
  }

  /**
   * Trace-only type-usage rows for one comment-free line (relationship-types.js):
   * `instantiates` (constructed types), `typeRef` (types in a function/method
   * signature, definition lines only) and Swift `extensionOf`. One row per
   * (source, type, target) per file — the first site's line. Every site's
   * line also goes to the callSites sink with its `rel_type`; insertCallSites
   * keeps the lines of repeated pairs in call_lines, so ss-trace lists each
   * `new Foo()` (`(instantiates)@4,5,6`). SWEET_SEARCH_TYPE_USAGE_EDGES=0
   * disables.
   */
  _appendTypeUsageEdges(relationships, seen, trimmed, lineNum, language, sourceId, defEntity, skipObjects = null, typeHeader = false, fullSignature = null) {
    if (!this.typeUsageEdges || !sourceId) return;
    const push = (type, target) => {
      // The registry's skipCallObjects (Scala `Seq(`, Kotlin `listOf`) are
      // library factories, not repo types.
      if (skipObjects && skipObjects.has(target)) return;
      if (seen.sites) {
        const siteKey = `${type}\u0000${sourceId}\u0000${target}\u0000${lineNum}`;
        if (!seen.siteKeys.has(siteKey)) {
          seen.siteKeys.add(siteKey);
          seen.sites.push({ source_id: sourceId, target_name: target, context_line: lineNum, rel_type: type });
        }
      }
      const key = `${type}\u0000${sourceId}\u0000${target}`;
      if (seen.keys.has(key)) return;
      seen.keys.add(key);
      relationships.push({ source_id: sourceId, target_id: null, target_name: target, type, weight: 1.0, context_line: lineNum });
    };
    for (const name of scanInstantiations(trimmed, language, { typeHeader })) push('instantiates', name);
    if (defEntity && (defEntity.type === 'function' || defEntity.type === 'method')) {
      // Parameters on later lines count too (`fun f(\n  a: A,\n): B {`).
      const signature = fullSignature && bracketDepth(trimmed) > 0 ? fullSignature() : trimmed;
      for (const name of scanSignatureTypes(signature, language, { ownName: defEntity.name, ownerName: defEntity.parent_class })) {
        push('typeRef', name);
      }
    }
    if (language === 'swift') {
      const extended = swiftExtensionTarget(trimmed);
      if (extended) push('extensionOf', extended);
    }
  }

  _recordEmptyCapture(kind, language, patternType, lineNum, line) {
    this.debugCounters.emptyCapture[kind] = (this.debugCounters.emptyCapture[kind] || 0) + 1;

    if (!this.debugCounters.byLanguage[language]) {
      this.debugCounters.byLanguage[language] = { entity: 0, relationship: 0, skippedLongLines: 0 };
    }
    this.debugCounters.byLanguage[language][kind] += 1;

    const key = `${language}:${kind}:${patternType}`;
    this.debugCounters.byPattern[key] = (this.debugCounters.byPattern[key] || 0) + 1;

    if (this.warnOnPatternDrop && this.debugCounters.byPattern[key] <= 3) {
      console.warn(`[graph-extractor] Empty capture dropped for ${key} at line ${lineNum}: ${line.slice(0, 120)}`);
    }
  }

  _recordLongLineSkip(language, lineNum, lineLength) {
    this.debugCounters.skippedLongLines += 1;
    if (!this.debugCounters.byLanguage[language]) {
      this.debugCounters.byLanguage[language] = { entity: 0, relationship: 0, skippedLongLines: 0 };
    }
    this.debugCounters.byLanguage[language].skippedLongLines += 1;
    if (this.warnOnPatternDrop && this.debugCounters.byLanguage[language].skippedLongLines <= 3) {
      console.warn(`[graph-extractor] Skipping regex extraction for long line (${lineLength} chars) at ${language}:${lineNum}`);
    }
  }

  getDebugCounters() {
    const byLanguage = {};
    for (const [language, counts] of Object.entries(this.debugCounters.byLanguage)) {
      byLanguage[language] = { ...counts };
    }
    return {
      emptyCapture: { ...this.debugCounters.emptyCapture },
      skippedLongLines: this.debugCounters.skippedLongLines,
      byLanguage,
      byPattern: { ...this.debugCounters.byPattern },
    };
  }

  /**
   * Id of one definition in one file — unique within the file by construction.
   *
   *   sha256(relPath:type:owner.name:hash(definition line)[:#n])[0:16]
   *
   * - `owner` (parent_class) separates same-named members of different types
   *   (C# `_builder` fields in nested test classes).
   * - The WHOLE definition line, whitespace-collapsed, separates overloads;
   *   a 120-char prefix did not (ocelot `GivenOcelotIsRunning(...)` overloads
   *   that differ after column 120).
   * - `#n` numbers the remaining identical definitions in source order
   *   (Makefile `VAR = x` in two `ifeq` branches, a CSS variable repeated in
   *   two selectors). Every definition stays its own entity.
   * - No line NUMBER: an edit above a definition does not change its id.
   *
   * Data files (`data: true`: JSON/YAML/TOML/XML keys) are the exception: an
   * exact repeat of a key line (`gqlquery: |` in every YAML test case,
   * `<ItemGroup>`, `[[bin]]`) is the same key, not a new definition — it
   * returns the first occurrence's id with `duplicate: true` and is not
   * stored again. Repeats with a different line (`name: a` / `name: b`) stay
   * separate entities.
   *
   * Per-file counters live in `this._idStates` (set by extractFromFile), so
   * the full build and the maintainer, which extract the same file content,
   * mint the same ids.
   *
   * @returns {{ id: string, duplicate: boolean }}
   */
  entityId(filePath, type, name, { owner = null, line = '', data = false } = {}) {
    const relativePath = this.projectRoot ? path.relative(this.projectRoot, filePath) : filePath;
    const definition = String(line ?? '').replace(/\s+/g, ' ').trim();
    const lineHash = createHash('sha256').update(definition).digest('hex').slice(0, 8);
    const key = `${relativePath}:${type}:${owner ? `${owner}.` : ''}${name}:${lineHash}`;
    let state = this._idStates.get(filePath);
    if (!state) {
      state = new Map();
      this._idStates.set(filePath, state);
    }
    const seen = state.get(key);
    if (seen !== undefined && data) return { id: seen.id, duplicate: true };
    const n = seen === undefined ? 0 : seen.n + 1;
    const id = createHash('sha256').update(n === 0 ? key : `${key}:#${n}`).digest('hex').slice(0, 16);
    state.set(key, { id: seen?.id ?? id, n });
    return { id, duplicate: false };
  }

  /**
   * Generate unique ID for an entity
   *
   * For collision-proof IDs (especially overloaded methods), include signature or line info.
   * ID format: sha256(relativePath:type:name:disambiguator)[0:16]
   *
   * @param {string} filePath - Absolute file path
   * @param {string} type - Entity type (class, method, function, etc.)
   * @param {string} name - Entity name
   * @param {object} [options] - Optional disambiguation info
   * @param {string} [options.signature] - Method/function signature for overload disambiguation
   * @param {number} [options.startLine] - Start line as fallback disambiguator
   * @returns {string} 16-char hex ID
   */
  makeId(filePath, type, name, options = {}) {
    const relativePath = this.projectRoot ? path.relative(this.projectRoot, filePath) : filePath;

    // Build disambiguator for overloaded methods or same-name entities
    let disambiguator = '';
    if (options.signature) {
      // Hash the signature for a compact, stable disambiguator
      disambiguator = createHash('sha256').update(options.signature).digest('hex').slice(0, 8);
    } else if (options.startLine !== undefined) {
      // Fallback: use line number if no signature
      disambiguator = String(options.startLine);
    }

    const key = disambiguator
      ? `${relativePath}:${type}:${name}:${disambiguator}`
      : `${relativePath}:${type}:${name}`;

    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  /**
   * Generate a signature hash for stable entity identification.
   * Used for backup/restore matching when IDs change.
   *
   * @param {string} signature - Full method/function signature
   * @returns {string|null} 8-char hex hash or null if no signature
   */
  makeSignatureHash(signature) {
    if (!signature) return null;
    return createHash('sha256').update(signature).digest('hex').slice(0, 8);
  }

  /**
   * Extract doc comment from lines before a declaration
   */
  extractDocComment(lines, lineIndex) {
    const comments = [];
    let i = lineIndex - 1;

    while (i >= 0) {
      const line = lines[i].trim();
      if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*') || line.startsWith('/**')) {
        comments.unshift(line.replace(/^[/*\s]+/, '').replace(/\*\/$/, '').trim());
        i--;
      } else if (line === '') {
        i--;
      } else {
        break;
      }
    }

    return comments.join(' ').slice(0, 500) || null;
  }

  /**
   * Find end line of a block (matching braces)
   */
  findEndLine(lines, startIndex) {
    let braceDepth = 0;
    let started = false;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      const opens = (line.match(/{/g) || []).length;
      const closes = (line.match(/}/g) || []).length;

      // A declaration that ends with `;` before any block opens is one
      // statement: a field (`private readonly Builder _builder = new();`),
      // an expression-bodied member (`void F(X x) => _b.Set(x);`), a
      // prototype. Counting on to the next block's `}` gave the C# field
      // `_builder` the span of the two methods after it, so they lost their
      // owning class.
      if (!started && opens === 0 && closes === 0 && codeBeforeComment(line).endsWith(';')) {
        return i + 1;
      }

      if (opens > 0) started = true;
      braceDepth += opens - closes;

      if (started && braceDepth === 0) {
        return i + 1;
      }
    }

    return lines.length;
  }

  /**
   * Find end line for indent-based languages (Python, YAML, etc.)
   * Scans forward until a line at the same or lesser indentation is found.
   */
  findEndLineIndent(lines, startIndex) {
    const startLine = lines[startIndex];
    const startIndent = startLine.length - startLine.trimStart().length;

    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (!trimmed) continue; // skip blank lines
      const indent = line.length - trimmed.length;
      if (indent <= startIndent) {
        return i; // 0-based exclusive → 1-based line number
      }
    }

    return lines.length;
  }

  /**
   * Find end line for end-keyword languages (Ruby, Elixir, Lua, Obj-C).
   * Counts matching keyword pairs to find the closing end/keyword.
   */
  findEndLineKeyword(lines, startIndex, endKeyword, blockKeywords, language = null) {
    const endRe = new RegExp(`^\\s*${escapeRegexLiteral(endKeyword)}\\b`);
    const blockStartRe = blockKeywords?.length
      ? new RegExp(`^\\s*(?:${blockKeywords.join('|')})\\b`)
      : null;
    // A keyword form opens no block: Elixir `def f(x), do: y` / `if a, do: b`, or a
    // one-line `def f; end`. plug's `def put_status(conn, nil), do: ...` clauses spanned
    // to the end of the file.
    const opensNoBlock = (line) => /,\s*do:/.test(line) || /^\s*do:/.test(line)
      || new RegExp(`\\b${escapeRegexLiteral(endKeyword)}\\s*$`).test(line.replace(/#.*$/, ''));
    const first = lines[startIndex] || '';
    if (opensNoBlock(first) && !/\bdo\s*(?:#.*)?$/.test(first)) return startIndex + 1;
    // `def f(x),` with `do: y` on the next line.
    if (/,\s*$/.test(first) && /^\s*do:/.test(lines[startIndex + 1] || '')) return startIndex + 2;
    if (language === 'elixir') return elixirEndLine(lines, startIndex);
    let depth = 1; // start inside the opening block

    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      // Check for nested block openers (boundary patterns or block keywords)
      if (blockStartRe && blockStartRe.test(line) && !opensNoBlock(line)) {
        depth++;
      }
      if (endRe.test(line)) {
        depth--;
        if (depth === 0) {
          return i + 1; // 1-based
        }
      }
    }

    return lines.length;
  }

  /**
   * Find end line of a method (simpler heuristic)
   */
  findMethodEndLine(lines, startIndex) {
    let braceDepth = 0;
    let started = false;

    for (let i = startIndex; i < Math.min(startIndex + 200, lines.length); i++) {
      const line = lines[i];
      const opens = (line.match(/{/g) || []).length;
      const closes = (line.match(/}/g) || []).length;

      if (opens > 0) started = true;
      braceDepth += opens - closes;

      if (started && braceDepth === 0) {
        return i + 1;
      }
    }

    return Math.min(startIndex + 50, lines.length);
  }
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

/**
 * Ensure stale_since column exists for soft-delete support.
 * Handles branch switching gracefully by marking entities as stale instead of deleting.
 * Files marked as stale can be pruned after 30 days.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {boolean} true if column exists or was added successfully
 */
export function ensureStaleColumn(db) {
  try {
    // Check if column exists
    const columns = db.prepare("PRAGMA table_info(entities)").all();
    const hasStaleColumn = columns.some(c => c.name === 'stale_since');

    if (!hasStaleColumn) {
      console.log('[graph-extractor] Adding stale_since column for soft-delete support');
      db.exec('ALTER TABLE entities ADD COLUMN stale_since INTEGER DEFAULT NULL');
      // Create partial index for efficient stale entity queries
      db.exec('CREATE INDEX IF NOT EXISTS idx_entities_stale ON entities(stale_since) WHERE stale_since IS NOT NULL');
    }

    // P1 FIX: Add covering index for active entities (stale_since IS NULL)
    // The idx_entities_stale helps find stale entries, but queries filtering for
    // active entries (WHERE stale_since IS NULL) need their own index
    // This provides 5-20ms savings per query on active entity lookups
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entities_active
        ON entities(id, name, type, file_path)
        WHERE stale_since IS NULL
      `);
    } catch (e) {
      // Index may already exist, ignore
    }

    return true;
  } catch (err) {
    if (err.message.includes('duplicate column')) {
      return true; // Column already exists
    }
    console.error(`[graph-extractor] Failed to add stale_since column: ${err.message}`);
    return false;
  }
}

/**
 * Check if database schema is compatible with current version.
 * Stores version in a simple key-value table.
 * @param {import('better-sqlite3').Database} db
 * @returns {{compatible: boolean, dbVersion: number|null}}
 */
export function checkSchemaVersion(db) {
  try {
    // Create metadata table if not exists
    db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)`);

    const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version');
    const dbVersion = row ? parseInt(row.value, 10) : null;

    if (dbVersion === null) {
      const existingTableCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != 'schema_meta'
      `).get().count;

      // Fresh databases can continue; pre-versioning databases must be migrated.
      return { compatible: existingTableCount === 0, dbVersion: null };
    }

    if (dbVersion < SCHEMA_VERSION) {
      console.warn(`⚠️  Schema version mismatch: DB has v${dbVersion}, code expects v${SCHEMA_VERSION}`);
      console.warn(`   Run: /index-codebase --full (or node index-codebase-v21.js --full)`);
      return { compatible: false, dbVersion };
    }

    return { compatible: true, dbVersion };
  } catch (err) {
    // If check fails, assume compatible and continue
    return { compatible: true, dbVersion: null };
  }
}

/**
 * Create code graph database schema
 * Uses better-sqlite3 (native SQLite binding with full FTS5 trigram support)
 */
export function createGraphSchema(db) {
  const versionStatus = checkSchemaVersion(db);
  if (!versionStatus.compatible) {
    console.log(`  Updating schema from ${versionStatus.dbVersion ?? 'unversioned'} to v${SCHEMA_VERSION}`);
  }

  // Entities table with HCGS summary support
  // signature_hash added for collision-proof backup/restore of overloaded methods
  // code column stores actual source code for HCGS summary generation
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT,
      signature_hash TEXT,
      doc_comment TEXT,
      start_line INTEGER,
      end_line INTEGER,
      package TEXT,
      parent_class TEXT,
      search_text TEXT,
      summary TEXT,
      summary_embedding BLOB,
      parent_id TEXT,
      hierarchy_level INTEGER DEFAULT 0,
      code TEXT,
      name_alias TEXT,
      stale_since INTEGER DEFAULT NULL,
      page_rank REAL DEFAULT 0
    )
  `);

  // Migration: Add code column to existing tables that don't have it
  try {
    const columns = db.prepare("PRAGMA table_info(entities)").all();
    const hasCodeColumn = columns.some(col => col.name === 'code');
    if (!hasCodeColumn) {
      db.exec('ALTER TABLE entities ADD COLUMN code TEXT');
      console.log('  Migrated: added code column to entities table');
    }
    const hasAliasColumn = columns.some(col => col.name === 'name_alias');
    if (!hasAliasColumn) {
      db.exec('ALTER TABLE entities ADD COLUMN name_alias TEXT');
      console.log('  Migrated: added name_alias column to entities table');
    }
    const hasPageRankColumn = columns.some(col => col.name === 'page_rank');
    if (!hasPageRankColumn) {
      db.exec('ALTER TABLE entities ADD COLUMN page_rank REAL DEFAULT 0');
      console.log('  Migrated: added page_rank column to entities table');
    }
  } catch (err) {
    // Ignore errors - column might already exist or table not created yet
  }

  const aliasBackfillCount = backfillNameAliases(db);
  if (aliasBackfillCount > 0) {
    console.log(`  Migrated: backfilled name_alias for ${aliasBackfillCount} entities`);
  }

  // Migration: Add stale_since column for soft-delete support
  // Files marked as stale (removed from filesystem but kept in DB) can be pruned after 30 days
  // This handles branch switches gracefully
  // E4 FIX: Check return value and warn if migration failed
  if (!ensureStaleColumn(db)) {
    console.warn('[graph-extractor] WARN: Failed to add stale_since column - searches may include deleted files');
  }

  // Relationships table (source_id can be NULL for unresolved references)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      source_id TEXT,
      target_id TEXT,
      target_name TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      context_line INTEGER,
      full_import_path TEXT,
      is_static INTEGER DEFAULT 0,
      is_wildcard INTEGER DEFAULT 0
    )
  `);

  // Try FTS5 first, fallback to regular indexes if not available
  // better-sqlite3 bundles SQLite 3.51.1 which has native FTS5 trigram support
  let hasFts5 = false;
  try {
    const { rebuilt } = ensureLexicalFtsSchema(db);
    hasFts5 = true;
    console.log(rebuilt ? '  FTS5 schema rebuilt (porter + trigram)' : '  FTS5 enabled (porter + trigram)');
  } catch (err) {
    console.log('  FTS5 not available:', err.message);
  }

  // Indexes for graph traversal and text search
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_file ON entities(file_path)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_search ON entities(search_text)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_parent ON entities(parent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_level ON entities(hierarchy_level)`);
  // Partial index for soft-delete queries: efficiently find stale entities
  // Only indexes rows where stale_since IS NOT NULL (smaller index, faster lookups)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_stale ON entities(stale_since) WHERE stale_since IS NOT NULL`);
  // P1 FIX: Covering index for active entity queries (WHERE stale_since IS NULL)
  // Provides 5-20ms savings on all active entity lookups (BM25, graph expansion, etc.)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_active ON entities(id, name, type, file_path) WHERE stale_since IS NULL`);
  // Composite index for collision-proof backup/restore of overloaded methods
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_sig_hash ON entities(file_path, type, name, signature_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_target_name ON relationships(target_name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(type)`);
  // Unique constraint to prevent duplicate relationships (same source→target with same type)
  // Allows NULL source_id (unresolved refs) by excluding them from uniqueness check
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rel_unique ON relationships(source_id, target_id, type, target_name) WHERE source_id IS NOT NULL`);
  // Index on target_id for efficient reverse lookups ("what calls X")
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_target_id ON relationships(target_id) WHERE target_id IS NOT NULL`);
  // Index supports `page_rank DESC` lookups for ss-trace ranking and ranking probes.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_page_rank ON entities(page_rank) WHERE stale_since IS NULL`);
  ensureCallSitesSchema(db);
  ensureFilesSchema(db);

  setSchemaVersion(db);

  return hasFts5;
}

/**
 * Bare call sites (`helper(x)` — no receiver). Kept out of `relationships` on
 * purpose: every ranking consumer (PageRank, graph expansion, communities,
 * ref counts, name-joined neighbour lookups) reads that table, and bare calls
 * resolve only under scope rules at ss-trace query time
 * (bare-call-resolution.js). Additive: graphs built before this table simply
 * have no bare callers. Epoch columns match the incremental visibility model.
 */
export function ensureCallSitesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_sites (
      source_id TEXT NOT NULL,
      callee_name TEXT NOT NULL,
      context_line INTEGER,
      epoch_written INTEGER NOT NULL DEFAULT 0,
      epoch_retired INTEGER
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_call_sites_callee ON call_sites(callee_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_call_sites_source ON call_sites(source_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_call_sites_retired ON call_sites(epoch_retired) WHERE epoch_retired IS NOT NULL');
  // Site lines of qualified calls (`a.b(`, `A::b(`) and of the trace-only
  // type-usage links (`instantiates`, `typeRef`, `extensionOf`).
  // `relationships` keeps one row per (source, type, target_name) with the
  // first site's line; this trace-only table keeps every line of a pair seen
  // on two or more lines, so ss-trace can list all of them. `rel_type` keeps
  // a `new Foo()` line apart from a `x.Foo()` call line of the same name.
  // Same epoch columns and lifecycle as call_sites; a pair without rows (one
  // site, or a graph built before the table) uses the relationship row's
  // context_line.
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_lines (
      source_id TEXT NOT NULL,
      target_name TEXT NOT NULL,
      context_line INTEGER,
      epoch_written INTEGER NOT NULL DEFAULT 0,
      epoch_retired INTEGER,
      rel_type TEXT NOT NULL DEFAULT 'calls'
    )
  `);
  // Graphs written before rel_type existed hold call lines only: the
  // default labels them correctly.
  if (!db.prepare('PRAGMA table_info(call_lines)').all().some((c) => c.name === 'rel_type')) {
    db.exec("ALTER TABLE call_lines ADD COLUMN rel_type TEXT NOT NULL DEFAULT 'calls'");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_call_lines_source ON call_lines(source_id, target_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_call_lines_retired ON call_lines(epoch_retired) WHERE epoch_retired IS NOT NULL');
}

/**
 * Insert call sites; `idFor` maps an extractor source id to the stored id.
 * Bare sites (`callee_name`) go to call_sites. Qualified sites
 * (`target_name`, `rel_type` 'calls' when absent) go to call_lines only for
 * a (source, rel_type, target) pair seen on two or more lines: a single site
 * is already the relationship row's context_line, which readers fall back
 * to. A pair's sites all come from one file, so every batch holds whole
 * pairs. On a call_lines table without `rel_type` (a writer that skipped
 * ensureCallSitesSchema), only call lines are stored.
 */
export function insertCallSites(db, callSites, { epoch = 0, idFor = null } = {}) {
  if (!callSites || callSites.length === 0) return 0;
  const bare = db.prepare('INSERT INTO call_sites (source_id, callee_name, context_line, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, NULL)');
  const pairKey = (c) => `${c.source_id}\u0000${c.rel_type || 'calls'}\u0000${c.target_name}`;
  const pairSites = new Map();
  for (const c of callSites) {
    if (!c.target_name || !c.source_id) continue;
    const key = pairKey(c);
    pairSites.set(key, (pairSites.get(key) || 0) + 1);
  }
  let typed;
  let qualified = null;
  let n = 0;
  for (const c of callSites) {
    const source = (idFor && idFor.get(c.source_id)) || c.source_id;
    if (!source) continue;
    if (c.target_name) {
      if ((pairSites.get(pairKey(c)) || 0) < 2) continue;
      typed ??= hasGraphColumn(db, 'call_lines', 'rel_type');
      const relType = c.rel_type || 'calls';
      if (!typed && relType !== 'calls') continue;
      qualified ||= typed
        ? db.prepare('INSERT INTO call_lines (source_id, target_name, context_line, epoch_written, epoch_retired, rel_type) VALUES (?, ?, ?, ?, NULL, ?)')
        : db.prepare('INSERT INTO call_lines (source_id, target_name, context_line, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, NULL)');
      if (typed) qualified.run(source, c.target_name, c.context_line ?? null, epoch, relType);
      else qualified.run(source, c.target_name, c.context_line ?? null, epoch);
      n++;
      continue;
    }
    if (!c.callee_name) continue;
    bare.run(source, c.callee_name, c.context_line ?? null, epoch);
    n++;
  }
  return n;
}

/**
 * Insert entities and relationships into database
 * Uses better-sqlite3 (sync API, no .free() needed)
 */
/**
 * Rebuild + optimize the external-content FTS5 mirrors from the entities
 * table. 'rebuild' reconstructs the whole FTS index from current content, so
 * only the LAST rebuild before any FTS read matters — batch loops should
 * pass { syncFts: false } to insertGraph and call this once at the end.
 */
export function rebuildGraphFts(db) {
  try {
    db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);
    db.exec(`INSERT INTO entities_code_fts(entities_code_fts) VALUES('rebuild')`);
    db.exec(`INSERT INTO entities_trigram(entities_trigram) VALUES('rebuild')`);
    console.log('  FTS5 indexes rebuilt (porter + trigram)');

    // Best-effort post-build compaction for faster reads.
    db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('optimize')`);
    db.exec(`INSERT INTO entities_code_fts(entities_code_fts) VALUES('optimize')`);
    db.exec(`INSERT INTO entities_trigram(entities_trigram) VALUES('optimize')`);
    console.log('  FTS5 indexes optimized (segments merged)');
  } catch (err) {
    // FTS5 rebuild/optimize failed, ignore
  }
}

// HCGS hierarchy: which entity types own members (`parent_id`), and which
// members get one. Shared by the full build (insertGraph) and the maintainer
// (production-reconciler), so both store the same parent for every member.
// Kotlin `object` and Swift `actor` / `extension` were stored as 'class'
// before their kinds were read from the node; they own members the same way.
const HIERARCHY_PARENT_TYPES = new Set(['class', 'interface', 'enum', 'service', 'object', 'actor', 'extension']);
const HIERARCHY_MEMBER_TYPES = new Set(['method', 'field', 'rpc']);

/** HCGS level of an entity type: 1 for members, 0 for everything else. */
export function entityHierarchyLevel(type) {
  return HIERARCHY_MEMBER_TYPES.has(type) ? 1 : 0;
}

/**
 * Parent entity id of every member that has one: the `parent_class`
 * container of the same file whose line range holds the member (the
 * innermost one, when nested classes share a name), else the last container
 * of that name in the file. Ids in, ids out — the caller maps them to stored
 * rows.
 *
 * @param {Array<{id, file_path, type, name, parent_class?, start_line?, end_line?}>} entities
 * @returns {Map<string, string>} member id → parent id
 */
export function entityParentIds(entities) {
  const containers = new Map(); // `${file}:${name}` → [entity…] in input order
  for (const e of entities) {
    if (!HIERARCHY_PARENT_TYPES.has(e.type)) continue;
    const key = `${e.file_path}:${e.name}`;
    if (!containers.has(key)) containers.set(key, []);
    containers.get(key).push(e);
  }
  const out = new Map();
  for (const e of entities) {
    if (!HIERARCHY_MEMBER_TYPES.has(e.type) || !e.parent_class) continue;
    const candidates = containers.get(`${e.file_path}:${e.parent_class}`);
    if (!candidates?.length) continue;
    let best = null;
    for (const c of candidates) {
      if (c.id === e.id || c.start_line == null || c.end_line == null || e.start_line == null) continue;
      if (c.start_line > e.start_line || c.end_line < e.start_line) continue;
      if (!best || (c.end_line - c.start_line) < (best.end_line - best.start_line)) best = c;
    }
    out.set(e.id, (best || candidates[candidates.length - 1]).id);
  }
  return out;
}

export function insertGraph(db, entities, relationships, hasFts5 = false, { syncFts = true, callSites = null, files = null } = {}) {
  // Insert entities with HCGS hierarchy support
  // Includes signature_hash for collision-proof backup/restore
  const entityStmt = db.prepare(`
    INSERT OR REPLACE INTO entities
    (id, file_path, type, name, signature, signature_hash, doc_comment, start_line, end_line, package, parent_class, search_text, name_alias, parent_id, hierarchy_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Ids are unique per file by construction (GraphExtractor.entityId and its
  // guard) and carry the path, so a repeated id here means one file was
  // extracted twice — INSERT OR REPLACE would hide that. Loud under tests.
  const seenIds = new Set();
  let repeatedIds = 0;
  for (const e of entities) {
    if (seenIds.has(e.id)) repeatedIds++;
    else seenIds.add(e.id);
  }
  if (repeatedIds > 0) {
    const message = `insertGraph: ${repeatedIds} repeated entity id(s) — a file was extracted twice?`;
    if (process.env.VITEST || process.env.SWEET_SEARCH_STRICT_ENTITY_IDS === '1') throw new Error(message);
    console.warn(message);
  }

  // HCGS hierarchy: the same parent rule the maintainer applies.
  const parentIds = entityParentIds(entities);

  console.log(`  Inserting ${entities.length} entities...`);

  // Use transaction for bulk entity inserts (much faster)
  const insertEntities = db.transaction(() => {
    for (const e of entities) {
      // Create searchable text combining name, signature, and doc comment
      const searchText = [e.name, e.signature, e.doc_comment]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .slice(0, 1000);

      const hierarchyLevel = entityHierarchyLevel(e.type);
      const parentId = parentIds.get(e.id) ?? null;

      // Fix 7: Generate normalized identifier alias for cross-style search
      const nameAlias = normalizeIdentifier(e.name);

      // better-sqlite3: use spread params instead of array
      entityStmt.run(
        e.id,
        e.file_path,
        e.type,
        e.name,
        e.signature || null,
        e.signature_hash || null,  // For collision-proof backup/restore
        e.doc_comment || null,
        e.start_line || null,
        e.end_line || null,
        e.package || null,
        e.parent_class || null,
        searchText,
        nameAlias || null,
        parentId,
        hierarchyLevel
      );
    }
  });

  insertEntities();
  console.log(`  ✓ Inserted ${entities.length} entities`);
  // Note: better-sqlite3 doesn't need .free()

  // Insert relationships (filter out invalid ones)
  console.log(`  Inserting ${relationships.length} relationships...`);

  const relStmt = db.prepare(`
    INSERT INTO relationships
    (source_id, target_id, target_name, type, weight, context_line, full_import_path, is_static, is_wildcard)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Use transaction for bulk relationship inserts
  let relInserted = 0;
  const insertRelationships = db.transaction(() => {
    for (const r of relationships) {
      // Skip relationships without target_name
      if (!r.target_name) continue;

      try {
        // better-sqlite3: use spread params instead of array
        relStmt.run(
          r.source_id || null,
          r.target_id || null,
          r.target_name,
          r.type,
          r.weight || 1.0,
          r.context_line || null,
          r.full_import_path || null,
          r.is_static ? 1 : 0,
          r.is_wildcard ? 1 : 0
        );
        relInserted++;
      } catch (err) {
        // Expected: UNIQUE constraint violations for duplicate relationships
        // Log unexpected errors at debug level for troubleshooting
        if (!err.message.includes('UNIQUE constraint')) {
          if (process.env.DEBUG) {
            console.debug(`  [debug] Relationship insert failed: ${err.message} (target: ${r.target_name})`);
          }
        }
      }
    }
  });

  insertRelationships();
  console.log(`  ✓ Inserted ${relInserted} relationships`);

  // Target resolution runs after all files are inserted:
  // relationship-resolver.js resolveRelationshipTargets (called by the
  // index builder), which also derives the trace-only override edges.

  if (callSites && callSites.length > 0) {
    ensureCallSitesSchema(db);
    db.transaction(() => insertCallSites(db, callSites))();
  }

  if (files && files.length > 0) {
    db.transaction(() => insertFileNodes(db, files))();
  }


  // Rebuild FTS indexes if available
  if (hasFts5 && syncFts) {
    rebuildGraphFts(db);
  }
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: graph-extractor.js <file>');
    process.exit(1);
  }

  const filePath = args[0];

  (async () => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const extractor = new GraphExtractor();
      const result = await extractor.extractFromFile(filePath, content);

      console.log(JSON.stringify(result, null, 2));
      console.error(`\nExtracted ${result.entities.length} entities, ${result.relationships.length} relationships`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}

export default GraphExtractor;
