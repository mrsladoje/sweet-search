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
import { getLanguageByPath } from '../infrastructure/language-patterns.js';
import { getTreeSitterProvider } from '../infrastructure/tree-sitter-provider.js';

// Schema version - increment when schema changes require full reindex
// Users should run `/index-codebase --full` after upgrading
export const SCHEMA_VERSION = 2;

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
  const existingTrigramSql = getTableSql(db, 'entities_trigram');
  const needsRebuild = !existingFtsSql
    || !existingTrigramSql
    || !hasExpectedEntitiesFtsSchema(existingFtsSql)
    || !hasExpectedTrigramSchema(existingTrigramSql);

  if (needsRebuild) {
    db.exec(`DROP TABLE IF EXISTS entities_fts`);
    db.exec(`DROP TABLE IF EXISTS entities_trigram`);
  }

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

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entities_trigram USING fts5(
      name,
      signature,
      content='entities',
      content_rowid='rowid',
      tokenize='trigram'
    )
  `);

  return { rebuilt: needsRebuild };
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
  // TS: type-only imports/re-exports are still module-level
  // dependencies, so they map to the same `imports` edge.
  typeImport: 'imports',
  typeReexport: 'imports',
  // TS: `<T extends Foo>` is a type reference, not an inheritance
  // edge — emit it as a `uses` relationship (consistent with how
  // decorators and method-of references are handled).
  genericConstraint: 'uses',
  // FOLLOW-UP (documented, NOT implemented): per-line type references
  // in function/method/property signatures (e.g. `function foo(x: User):
  // Result` → `uses` edges to User and Result; `field: Token` → `uses`
  // edge to Token). Intentionally not added at the regex layer — the
  // false-positive surface (matching identifiers in comments, strings,
  // and unrelated positions) is too high. Two prerequisites before
  // shipping:
  //   1. AST-level type-reference extractor (walk `type_annotation` /
  //      `parameter` / `return_type` nodes via tree-sitter, not regex)
  //   2. Graph-density benchmark showing retrieval benefit without
  //      precision loss (the new `uses` edges should improve graph
  //      expansion recall without adding noise that hurts MRR).
  // See May-2026 design discussion in chat history for details.
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

// Types whose regex capture groups commonly contain comma-separated lists.
// Module-scope constant to avoid per-call Set allocation.
const MULTI_TARGET_TYPES = new Set([
  'plainImport', 'implements', 'inherit', 'protocol', 'with',
  // TS: `interface Foo extends Bar, Baz<T>` — comma-separated
  // parents, generics handled by expandRelationshipTargets.
  'interfaceExtends',
]);

export const TREE_SITTER_ENTITY_PRIORITY = Object.freeze({
  component: 40,
  class: 35,
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
  trait: 25,
  impl: 20,
  decorator: 15,
});

// Module-scope constants for extractJavaScript() — avoid per-call/per-line allocation.
const JS_CALL_SKIP_OBJECTS = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'process', 'Buffer', 'Date',
]);
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
  }

  /**
   * Extract entities and relationships from a file.
   * Dispatches to specialized extractors for Java/JS/Proto,
   * generic registry-based extractor for all other languages.
   */
  async extractFromFile(filePath, content) {
    this.currentFile = filePath;
    const lines = content.split('\n');
    const langInfo = getLanguageByPath(filePath);

    if (!langInfo) {
      return { entities: [], relationships: [] };
    }

    // Try tree-sitter extraction first (more accurate than regex)
    if (this._useTreeSitter) {
      try {
        const provider = getTreeSitterProvider();
        if (await provider.isAvailable() && provider.hasLanguage(langInfo.id)) {
          const symbols = await provider.extractSymbols(content, langInfo.id);
          if (symbols && symbols.length > 0) {
            // Convert tree-sitter symbols to graph entities format and align
            // labels with regex semantics (component/object arrow distinctions).
            const entities = this._normalizeTreeSitterEntities(filePath, symbols, langInfo.id);
            // Still extract relationships with regex (tree-sitter only gives definitions)
            const relationships = this._extractRelationships(content, lines, filePath, langInfo, entities);
            return { entities, relationships };
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
    const entities = [];
    const relationships = [];

    // Extract package
    const pkgMatch = content.match(JAVA_PATTERNS.package);
    this.packageName = pkgMatch ? pkgMatch[1] : '';

    // Extract Java imports (Phase 3.2: Java Import Extraction)
    // Creates 'imports' relationships for dependency tracking
    const fileEntityId = this.makeId(filePath, 'file', path.basename(filePath));
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Track brace depth
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Reset current class when we exit its scope
      if (currentClass && braceDepth < classStartDepth) {
        currentClass = null;
      }

      // Class declarations
      const classMatch = line.match(/(?:public|private|protected)?\s*(?:static)?\s*(?:final|abstract)?\s*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/);
      if (classMatch) {
        const className = classMatch[1];
        const extendsClass = classMatch[2];
        const implementsStr = classMatch[3];

        const id = this.makeId(filePath, 'class', className);
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
            target_id: this.makeId(filePath, 'class', extendsClass),
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
              target_id: this.makeId(filePath, 'interface', iface),
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
        const id = this.makeId(filePath, 'interface', ifaceName);

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
              target_id: this.makeId(filePath, 'interface', ext),
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
        const id = this.makeId(filePath, 'method', `${currentClass?.name || 'Unknown'}.${methodName}`, {
          signature: fullSignature,
          startLine: lineNum,
        });

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

      // Method calls (within method bodies)
      const callMatches = line.matchAll(/(\w+)\s*\.\s*(\w+)\s*\(/g);
      for (const callMatch of callMatches) {
        const object = callMatch[1];
        const method = callMatch[2];

        // Skip common patterns
        if (['System', 'log', 'LOG', 'logger', 'String', 'Integer', 'Long'].includes(object)) continue;

        relationships.push({
          source_id: currentClass ? this.makeId(filePath, 'class', currentClass.name) : null,
          target_id: null,
          target_name: `${object}.${method}`,
          type: 'calls',
          weight: GRAPH_CONFIG.relationshipWeights.calls,
          context_line: lineNum,
        });
      }

      // Throw statements
      const throwMatch = line.match(/throw\s+new\s+(\w+)/);
      if (throwMatch && currentClass) {
        relationships.push({
          source_id: this.makeId(filePath, 'class', currentClass.name),
          target_id: null,
          target_name: throwMatch[1],
          type: 'throws',
          weight: GRAPH_CONFIG.relationshipWeights.throws,
        });
      }
    }

    return { entities, relationships };
  }

  /**
   * Extract from JavaScript/TypeScript file
   */
  extractJavaScript(content, lines, filePath) {
    const entities = [];
    const relationships = [];
    const fileEntityId = this.makeId(filePath, 'file', path.basename(filePath));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // --- Entity extraction (if-else chain: first match wins per line) ---

      const classMatch = line.match(/(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
      if (classMatch) {
        const className = classMatch[1];
        const id = this.makeId(filePath, 'class', className);
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
            id: this.makeId(filePath, 'function', funcMatch[1], { signature: sig, startLine: lineNum }),
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
              id: this.makeId(filePath, 'component', componentMatch[1], { startLine: lineNum }),
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
                id: this.makeId(filePath, 'arrowFunction', arrowMatch[1], { signature: sig, startLine: lineNum }),
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
                  id: this.makeId(filePath, 'arrowFunction', objArrowMatch[1], { startLine: lineNum }),
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
                    id: this.makeId(filePath, 'method', objMethodMatch[1], { startLine: lineNum }),
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

      // Method call relationships
      const methodCalls = line.matchAll(/(\w+)\s*\.\s*(\w+)\s*\(/g);
      for (const callMatch of methodCalls) {
        const obj = callMatch[1];
        const method = callMatch[2];
        if (!obj || !method || JS_CALL_SKIP_OBJECTS.has(obj)) continue;
        relationships.push({
          source_id: fileEntityId,
          target_id: null,
          target_name: `${obj}.${method}`,
          type: 'calls',
          weight: GRAPH_CONFIG.relationshipWeights.calls,
        });
      }
    }

    return { entities, relationships };
  }

  /**
   * Extract from Proto file
   */
  extractProto(content, lines, filePath) {
    const entities = [];
    const relationships = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Message declarations
      const msgMatch = line.match(/message\s+(\w+)\s*\{/);
      if (msgMatch) {
        entities.push({
          id: this.makeId(filePath, 'message', msgMatch[1]),
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
        entities.push({
          id: this.makeId(filePath, 'service', svcMatch[1]),
          file_path: filePath,
          type: 'service',
          name: svcMatch[1],
          signature: line.trim(),
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
        });
      }

      // RPC declarations
      const rpcMatch = line.match(/rpc\s+(\w+)\s*\(\s*(\w+)\s*\)\s+returns\s+\(\s*(\w+)\s*\)/);
      if (rpcMatch) {
        const rpcName = rpcMatch[1];
        const inputType = rpcMatch[2];
        const outputType = rpcMatch[3];

        const id = this.makeId(filePath, 'rpc', rpcName);
        entities.push({
          id,
          file_path: filePath,
          type: 'rpc',
          name: rpcName,
          signature: line.trim(),
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: lineNum,
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
    const entities = [];
    const relationships = [];
    const { graph, id: language } = langInfo;
    const {
      entityPatterns,
      relationshipPatterns,
      methodCallPattern,
      methodCallPrefilter,
    } = this.getGenericPatternPlan(language, graph);
    const skipCallObjects = new Set(graph.skipCallObjects || []);
    const fileEntityId = this.makeId(filePath, 'file', path.basename(filePath));
    const jsonDependencySections = new Set(['dependencies', 'devDependencies', 'peerDependencies']);
    let jsonBraceDepth = 0;
    let activeJsonDependencyDepth = null;
    // Track active entity scopes to attribute call source_id by lexical range.
    const activeEntityScopes = [];

    // Choose findEndLine strategy based on language type
    const findEndLineFn = (startIdx) => {
      if (langInfo.indentBased) {
        return this.findEndLineIndent(lines, startIdx);
      }
      if (langInfo.endKeyword) {
        return this.findEndLineKeyword(lines, startIdx, langInfo.endKeyword, langInfo.blockKeywords);
      }
      return this.findEndLine(lines, startIdx);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      const lineNum = i + 1;
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

      // Entity extraction
      for (const { type, pattern, prefilter } of entityPatterns) {
        if (prefilter && !prefilter(trimmed)) continue;
        const match = trimmed.match(pattern);
        if (match) {
          const name = match[1];
          if (!name) {
            this._recordEmptyCapture('entity', language, type, lineNum, trimmed);
            continue;
          }
          const sig = trimmed.slice(0, 120);
          const sigHash = this.makeSignatureHash(sig);
          const entityId = this.makeId(filePath, type, name, { signature: sig, startLine: lineNum });
          const endLine = findEndLineFn(i);

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
          });
          activeEntityScopes.push({ id: entityId, start_line: lineNum, end_line: endLine });
          break; // one entity per line
        }
      }

      // Relationship extraction
      const sourceEntityId = activeEntityScopes.length > 0
        ? activeEntityScopes[activeEntityScopes.length - 1].id
        : null;
      // Method calls need special handling: group1=object, group2=method.
      // Reuse compiled global regex to avoid per-line RegExp allocations.
      if (methodCallPattern && (!methodCallPrefilter || methodCallPrefilter(trimmed))) {
        methodCallPattern.lastIndex = 0;
        let m;
        while ((m = methodCallPattern.exec(trimmed)) !== null) {
          const obj = m[1];
          const method = m[2];
          if (!obj || !method) {
            this._recordEmptyCapture('relationship', language, 'methodCall', lineNum, trimmed);
            if (m[0] === '') methodCallPattern.lastIndex++;
            continue;
          }
          if (skipCallObjects.has(obj)) {
            if (m[0] === '') methodCallPattern.lastIndex++;
            continue;
          }
          relationships.push({
            source_id: sourceEntityId,
            target_id: null,
            target_name: `${obj}.${method}`,
            type: 'calls',
            weight: GRAPH_CONFIG.relationshipWeights.calls,
            context_line: lineNum,
          });
          if (m[0] === '') methodCallPattern.lastIndex++;
        }
      }

      this._appendDestructuredRequireRelationships(trimmed, sourceEntityId || fileEntityId, relationships);

      for (const { type: relType, pattern, prefilter } of relationshipPatterns) {
        if (relType === 'methodCall') continue;
        if (prefilter && !prefilter(trimmed)) continue;

        const match = trimmed.match(pattern);
        if (relType === 'dep' && language === 'json') {
          if (match && match[1] && jsonDependencySections.has(match[1]) && depthAfter > depthBefore) {
            activeJsonDependencyDepth = depthAfter;
          }
          continue;
        }
        if (match) {
          const { targets, filtered } = this._resolveRelationshipTargets(relType, match, language);
          if (targets.length === 0) {
            if (!filtered) this._recordEmptyCapture('relationship', language, relType, lineNum, trimmed);
            continue;
          }
          const mappedType = GENERIC_RELATIONSHIP_MAPPING[relType] || 'uses';
          const weight = GRAPH_CONFIG.relationshipWeights[mappedType] || 1.0;
          for (const target of targets) {
            relationships.push({
              source_id: sourceEntityId || fileEntityId,
              target_id: null,
              target_name: target,
              type: mappedType,
              weight,
              context_line: lineNum,
            });
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

    return { entities, relationships };
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
      const isOptional = source[groupEnd + 1] === '?';
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
        if (token) tokens.push(token);
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
      if (ch === '\\') {
        const next = fragment[i + 1];
        if (!next) break;
        if (/[A-Za-z0-9]/.test(next)) break;
        result += next;
        i++;
        continue;
      }
      if (fragment[i + 1] === '?' && result.length === 0 && /[@#<./:_-]/.test(ch)) {
        // Skip optional leading literal chars (e.g. -?include).
        i++;
        continue;
      }
      if (/[A-Za-z0-9_@#<./:-]/.test(ch)) {
        result += ch;
        continue;
      }
      break;
    }

    return result;
  }

  expandRelationshipTargets(relType, target) {
    if (typeof target !== 'string') return [target];
    if (!MULTI_TARGET_TYPES.has(relType)) return [target];

    // Bracket-depth-aware top-level comma splitter.
    // Naive .split(',') would break generics: Base<Foo, Bar>, IFace
    const parts = splitTopLevelCommas(target);

    return parts
      .map((entry) => entry.trim()
        .replace(/\s+as\s+\w+$/i, '')               // import aliases
        .replace(/^(?:(?:public|protected|private|virtual)\s+)+/, '')  // C++ access specifiers
        .replace(/<.*$/, '')                          // strip generics from first <: Map<K, V> → Map
        .replace(/\([^)]*\)/g, '')                    // strip constructor args: Base(x) → Base
        .replace(/[;{}]+$/, '')                       // strip trailing punctuation
        .trim()
      )
      .filter(Boolean);
  }

  _normalizeTreeSitterEntities(filePath, symbols, language) {
    const dedupedBySymbolAndLine = new Map();

    for (const sym of symbols) {
      if (!sym?.name || !sym?.type) continue;
      const normalizedType = this._normalizeTreeSitterSymbolType(sym.type, sym.name);
      if ((language === 'javascript' || language === 'typescript') && normalizedType === 'variable') {
        continue;
      }
      const startLine = Number.isInteger(sym.startLine) ? sym.startLine : 0;
      const endLine = Number.isInteger(sym.endLine) ? sym.endLine : startLine;
      const rank = TREE_SITTER_ENTITY_PRIORITY[normalizedType] || 0;
      const key = `${sym.name}:${startLine}`;
      const existing = dedupedBySymbolAndLine.get(key);

      if (!existing || rank > existing.rank) {
        dedupedBySymbolAndLine.set(key, {
          id: this._makeEntityId(filePath, sym.name, normalizedType, startLine),
          file_path: filePath,
          type: normalizedType,
          name: sym.name,
          signature: sym.signature || null,
          start_line: startLine + 1, // tree-sitter is 0-indexed
          end_line: endLine + 1,
          rank,
        });
      }
    }

    return Array.from(dedupedBySymbolAndLine.values())
      .sort((a, b) => a.start_line - b.start_line)
      .map(({ rank, ...entity }) => entity);
  }

  _normalizeTreeSitterSymbolType(type, name) {
    if (type === 'arrowFunction' && /^[A-Z]/.test(name)) {
      return 'component';
    }
    return type;
  }

  _resolveRelationshipTargets(relType, match, language) {
    const isJsTs = language === 'javascript' || language === 'typescript';

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
   * Generate a deterministic entity ID for tree-sitter symbols.
   * Uses the same hash pattern as makeId() for consistency.
   */
  _makeEntityId(filePath, name, type, startLine) {
    const relativePath = this.projectRoot ? path.relative(this.projectRoot, filePath) : filePath;
    const key = `${relativePath}:${type}:${name}:${startLine}`;
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  /**
   * Extract relationships using regex patterns from langInfo.graph.
   * Used by tree-sitter path where entities come from AST but relationships
   * still need regex (tree-sitter tags.scm only gives definitions).
   */
  _extractRelationships(content, lines, filePath, langInfo, entities) {
    const relationships = [];
    if (!langInfo.graph) return relationships;

    const { graph, id: language } = langInfo;
    const {
      relationshipPatterns,
      methodCallPattern,
      methodCallPrefilter,
    } = this.getGenericPatternPlan(language, graph);
    const skipCallObjects = new Set(graph.skipCallObjects || []);
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      const lineNum = i + 1;

      if (trimmed.length > this.maxRegexLineLength) continue;

      const sourceEntityId = findScopeEntity(lineNum);

      // Method calls
      if (methodCallPattern && (!methodCallPrefilter || methodCallPrefilter(trimmed))) {
        methodCallPattern.lastIndex = 0;
        let m;
        while ((m = methodCallPattern.exec(trimmed)) !== null) {
          const obj = m[1];
          const method = m[2];
          if (!obj || !method) {
            if (m[0] === '') methodCallPattern.lastIndex++;
            continue;
          }
          if (skipCallObjects.has(obj)) {
            if (m[0] === '') methodCallPattern.lastIndex++;
            continue;
          }
          relationships.push({
            source_id: sourceEntityId,
            target_id: null,
            target_name: `${obj}.${method}`,
            type: 'calls',
            weight: GRAPH_CONFIG.relationshipWeights.calls,
            context_line: lineNum,
          });
          if (m[0] === '') methodCallPattern.lastIndex++;
        }
      }

      this._appendDestructuredRequireRelationships(trimmed, sourceEntityId || fileEntityId, relationships);

      // Other relationships (imports, extends, etc.)
      for (const { type: relType, pattern, prefilter } of relationshipPatterns) {
        if (relType === 'methodCall') continue;
        if (prefilter && !prefilter(trimmed)) continue;

        const match = trimmed.match(pattern);
        if (match) {
          const { targets, filtered } = this._resolveRelationshipTargets(relType, match, language);
          if (targets.length === 0) {
            if (!filtered) this._recordEmptyCapture('relationship', language, relType, lineNum, trimmed);
            continue;
          }
          const mappedType = GENERIC_RELATIONSHIP_MAPPING[relType] || 'uses';
          const weight = GRAPH_CONFIG.relationshipWeights[mappedType] || 1.0;
          for (const target of targets) {
            relationships.push({
              source_id: sourceEntityId || fileEntityId,
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
  findEndLineKeyword(lines, startIndex, endKeyword, blockKeywords) {
    const endRe = new RegExp(`^\\s*${escapeRegexLiteral(endKeyword)}\\b`);
    const blockStartRe = blockKeywords?.length
      ? new RegExp(`^\\s*(?:${blockKeywords.join('|')})\\b`)
      : null;
    let depth = 1; // start inside the opening block

    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      // Check for nested block openers (boundary patterns or block keywords)
      if (blockStartRe && blockStartRe.test(line)) {
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

  setSchemaVersion(db);

  return hasFts5;
}

/**
 * Resolve target_id for relationships that have NULL target_id
 * Uses fuzzy matching and heuristics to link calls/imports/overrides to actual entities
 */
function resolveRelationshipTargets(db) {
  const stats = {
    calls: 0,
    imports: 0,
    overrides: 0,
    throws: 0,
    unresolved: 0
  };

  console.log('    Building entity lookup maps...');

  // Build entity lookup maps for fast resolution
  const entityByName = new Map(); // name -> [entities]
  const entityByFQN = new Map();  // fully qualified name -> entity
  const entityById = new Map();    // id -> entity

  const allEntities = db.prepare('SELECT id, name, type, parent_class, package, file_path FROM entities').all();
  console.log(`    Loaded ${allEntities.length} entities`);

  for (const e of allEntities) {
    // Add to ID lookup
    entityById.set(e.id, e);

    // Add to name lookup (can have duplicates)
    if (!entityByName.has(e.name)) {
      entityByName.set(e.name, []);
    }
    entityByName.get(e.name).push(e);

    // Add to FQN lookup (unique)
    if (e.package && e.parent_class) {
      // Java method: package.ClassName.methodName
      const fqn = `${e.package}.${e.parent_class}.${e.name}`;
      entityByFQN.set(fqn, e);
    } else if (e.package) {
      // Java class: package.ClassName
      const fqn = `${e.package}.${e.name}`;
      entityByFQN.set(fqn, e);
    } else if (e.parent_class) {
      // Method without package: ClassName.methodName
      const fqn = `${e.parent_class}.${e.name}`;
      entityByFQN.set(fqn, e);
    }
  }

  console.log('    Resolving unresolved relationships...');

  // Prepare update statement and use transaction for bulk updates
  const updateStmt = db.prepare('UPDATE relationships SET target_id = ? WHERE rowid = ?');

  // Get all unresolved relationships
  const unresolvedRels = db.prepare(`
    SELECT rowid, source_id, target_name, type
    FROM relationships
    WHERE target_id IS NULL
  `).all();

  console.log(`    Found ${unresolvedRels.length} unresolved relationships`);

  // Use transaction for bulk updates (much faster)
  const updateMany = db.transaction(() => {
    let processed = 0;
    for (const rel of unresolvedRels) {
      let targetId = null;

      if (rel.type === 'calls') {
        // Method calls: "object.method" or "ClassName.method"
        targetId = resolveMethodCall(rel.target_name, rel.source_id, entityByName, entityByFQN, entityById);
        if (targetId) stats.calls++;
      } else if (rel.type === 'imports') {
        // Imports: package path or module name
        targetId = resolveImport(rel.target_name, entityByName, entityByFQN);
        if (targetId) stats.imports++;
      } else if (rel.type === 'overrides') {
        // Method overrides: methodName (need to find parent class method)
        targetId = resolveOverride(rel.target_name, rel.source_id, entityByName, entityById, db);
        if (targetId) stats.overrides++;
      } else if (rel.type === 'throws') {
        // Exception classes
        targetId = resolveThrows(rel.target_name, entityByName);
        if (targetId) stats.throws++;
      }

      if (targetId) {
        updateStmt.run(targetId, rel.rowid);
      } else {
        stats.unresolved++;
      }

      processed++;
      if (processed % 1000 === 0) {
        process.stdout.write(`\r    Processed ${processed}/${unresolvedRels.length}...`);
      }
    }
    process.stdout.write('\n');
  });

  updateMany();

  return stats;
}

/**
 * Resolve method call: "object.method" or "service.method"
 */
function resolveMethodCall(targetName, sourceId, entityByName, entityByFQN, entityById) {
  // Parse "object.method" or "ClassName.methodName"
  const parts = targetName.split('.');
  if (parts.length < 2) return null;

  const [objName, methodName] = parts;

  // Strategy 1: Exact FQN match (e.g., "UserService.findById")
  if (entityByFQN.has(targetName)) {
    return entityByFQN.get(targetName).id;
  }

  // Strategy 2: Look for method with matching name in class with matching name
  const methodCandidates = entityByName.get(methodName) || [];
  const classCandidates = entityByName.get(objName) || [];

  for (const method of methodCandidates) {
    if (method.type === 'method' && method.parent_class === objName) {
      return method.id;
    }
  }

  // Strategy 3: Fuzzy match - any method with this name (pick most common class)
  if (methodCandidates.length > 0) {
    const methods = methodCandidates.filter(e => e.type === 'method');
    if (methods.length > 0) {
      // Prefer methods in same package or file as source
      const sourceEntity = entityById.get(sourceId);
      if (sourceEntity) {
        const samePackage = methods.find(m => m.package === sourceEntity.package);
        if (samePackage) return samePackage.id;

        const sameFile = methods.find(m => m.file_path === sourceEntity.file_path);
        if (sameFile) return sameFile.id;
      }

      // Otherwise pick first match
      return methods[0].id;
    }
  }

  return null;
}

/**
 * Resolve import: package.Class or module path
 */
function resolveImport(targetName, entityByName, entityByFQN) {
  // Strategy 1: Exact FQN match
  if (entityByFQN.has(targetName)) {
    return entityByFQN.get(targetName).id;
  }

  // Strategy 2: Match last component (class name)
  const parts = targetName.split('.');
  const className = parts[parts.length - 1];

  const candidates = entityByName.get(className) || [];
  if (candidates.length > 0) {
    // Prefer classes/interfaces over other types
    const classLike = candidates.find(e => ['class', 'interface', 'enum'].includes(e.type));
    if (classLike) return classLike.id;
    return candidates[0].id;
  }

  return null;
}

/**
 * Resolve method override: find parent class/interface method with same name
 * Simplified version: just match by method name (close enough for most cases)
 */
function resolveOverride(methodName, sourceId, entityByName, entityById, db) {
  // Simple strategy: Find any method with this name
  // In a real override, it should be in a parent class, but for now we'll match by name
  const methodCandidates = entityByName.get(methodName) || [];

  const methods = methodCandidates.filter(e => e.type === 'method');
  if (methods.length > 0) {
    // Return first match (could be improved with parent class lookup later)
    return methods[0].id;
  }

  return null;
}

/**
 * Resolve throws: exception class name
 */
function resolveThrows(exceptionName, entityByName) {
  const candidates = entityByName.get(exceptionName) || [];

  // Prefer classes
  const classMatch = candidates.find(e => e.type === 'class');
  if (classMatch) return classMatch.id;

  if (candidates.length > 0) return candidates[0].id;
  return null;
}

/**
 * Insert entities and relationships into database
 * Uses better-sqlite3 (sync API, no .free() needed)
 */
export function insertGraph(db, entities, relationships, hasFts5 = false) {
  // Insert entities with HCGS hierarchy support
  // Includes signature_hash for collision-proof backup/restore
  const entityStmt = db.prepare(`
    INSERT OR REPLACE INTO entities
    (id, file_path, type, name, signature, signature_hash, doc_comment, start_line, end_line, package, parent_class, search_text, name_alias, parent_id, hierarchy_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Build parent lookup for hierarchy
  const parentLookup = new Map();
  for (const e of entities) {
    if (['class', 'interface', 'enum', 'service'].includes(e.type)) {
      parentLookup.set(`${e.file_path}:${e.name}`, e.id);
    }
  }

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

      // Determine hierarchy level and parent
      let hierarchyLevel = 0;
      let parentId = null;

      if (['method', 'field', 'rpc'].includes(e.type)) {
        hierarchyLevel = 1;
        // Find parent class/interface/service
        if (e.parent_class) {
          parentId = parentLookup.get(`${e.file_path}:${e.parent_class}`);
        }
      } else if (['class', 'interface', 'enum', 'service', 'message'].includes(e.type)) {
        hierarchyLevel = 0;
      } else if (['function', 'component'].includes(e.type)) {
        hierarchyLevel = 0; // Top-level in JS/TS files
      }

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

  // PHASE 2: Resolve target_id for relationships with NULL target_id
  // TEMPORARILY DISABLED to test basic indexing
  // console.log('  Resolving relationship targets...');
  // try {
  //   const resolveStats = resolveRelationshipTargets(db);
  //   console.log(`  Resolved ${resolveStats.calls} calls, ${resolveStats.imports} imports, ${resolveStats.overrides} overrides, ${resolveStats.throws} throws (${resolveStats.unresolved} unresolved)`);
  // } catch (err) {
  //   console.log(`  ⚠ Resolution failed: ${err.message}`);
  //   if (process.env.DEBUG) console.error(err.stack);
  // }

  // Rebuild FTS indexes if available
  if (hasFts5) {
    try {
      db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);
      db.exec(`INSERT INTO entities_trigram(entities_trigram) VALUES('rebuild')`);
      console.log('  FTS5 indexes rebuilt (porter + trigram)');

      // Best-effort post-build compaction for faster reads.
      db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('optimize')`);
      db.exec(`INSERT INTO entities_trigram(entities_trigram) VALUES('optimize')`);
      console.log('  FTS5 indexes optimized (segments merged)');
    } catch (err) {
      // FTS5 rebuild/optimize failed, ignore
    }
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
