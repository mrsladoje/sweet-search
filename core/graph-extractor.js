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
import { GRAPH_CONFIG, DB_PATHS } from './config.js';

// Schema version - increment when schema changes require full reindex
// Users should run `/index-codebase --full` after upgrading
export const SCHEMA_VERSION = 1;

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

// =============================================================================
// GRAPH EXTRACTOR CLASS
// =============================================================================

export class GraphExtractor {
  constructor() {
    this.entities = new Map();
    this.relationships = [];
    this.currentFile = null;
    this.currentClass = null;
    this.packageName = '';
  }

  /**
   * Extract entities and relationships from a file
   */
  async extractFromFile(filePath, content) {
    this.currentFile = filePath;
    const ext = path.extname(filePath).toLowerCase();

    const lines = content.split('\n');

    if (ext === '.java') {
      return this.extractJava(content, lines, filePath);
    } else if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
      return this.extractJavaScript(content, lines, filePath);
    } else if (ext === '.proto') {
      return this.extractProto(content, lines, filePath);
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Class declarations
      const classMatch = line.match(/(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
      if (classMatch) {
        const className = classMatch[1];
        const extendsClass = classMatch[2];
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

        if (extendsClass) {
          relationships.push({
            source_id: id,
            target_id: null,
            target_name: extendsClass,
            type: 'extends',
            weight: GRAPH_CONFIG.relationshipWeights.extends,
          });
        }
      }

      // Function declarations
      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
      if (funcMatch) {
        const funcName = funcMatch[1];
        const funcSignature = line.trim().slice(0, 100);
        const signatureHash = this.makeSignatureHash(funcSignature);

        entities.push({
          id: this.makeId(filePath, 'function', funcName, { signature: funcSignature, startLine: lineNum }),
          file_path: filePath,
          type: 'function',
          name: funcName,
          signature: funcSignature,
          signature_hash: signatureHash,
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
        });
      }

      // React components (capitalized)
      const componentMatch = line.match(/(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/);
      if (componentMatch) {
        const compName = componentMatch[1];
        const compSignature = line.trim().slice(0, 100);
        const signatureHash = this.makeSignatureHash(compSignature);

        entities.push({
          id: this.makeId(filePath, 'component', compName, { startLine: lineNum }),
          file_path: filePath,
          type: 'component',
          name: compName,
          signature: compSignature,
          signature_hash: signatureHash,
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
        });
      }

      // Arrow functions with const
      const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
      if (arrowMatch && !componentMatch) {
        const funcName = arrowMatch[1];
        const arrowSignature = line.trim().slice(0, 100);
        const signatureHash = this.makeSignatureHash(arrowSignature);

        entities.push({
          id: this.makeId(filePath, 'function', funcName, { signature: arrowSignature, startLine: lineNum }),
          file_path: filePath,
          type: 'function',
          name: funcName,
          signature: arrowSignature,
          signature_hash: signatureHash,
          doc_comment: this.extractDocComment(lines, i),
          start_line: lineNum,
          end_line: this.findEndLine(lines, i),
        });
      }

      // Import relationships
      const importMatch = line.match(/import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const imports = importMatch[1] || importMatch[2];
        const source = importMatch[3];

        if (imports && !source.startsWith('.')) {
          // External import
          relationships.push({
            source_id: this.makeId(filePath, 'file', path.basename(filePath)),
            target_id: null,
            target_name: source,
            type: 'imports',
            weight: GRAPH_CONFIG.relationshipWeights.imports,
          });
        }
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
    const relativePath = filePath.replace(/^.*[/\\]sloth[/\\]/, '');

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
      // New database or pre-versioning - set current version
      db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)').run('version', String(SCHEMA_VERSION));
      return { compatible: true, dbVersion: SCHEMA_VERSION };
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
      stale_since INTEGER DEFAULT NULL
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
  } catch (err) {
    // Ignore errors - column might already exist or table not created yet
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
    // Standard FTS5 with porter stemming for word-based search
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        name,
        signature,
        doc_comment,
        content='entities',
        content_rowid='rowid',
        tokenize='porter unicode61'
      )
    `);

    // Trigram FTS5 for fuzzy/substring matching (e.g., "Auth" → "AuthenticationService")
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_trigram USING fts5(
        name,
        signature,
        content='entities',
        content_rowid='rowid',
        tokenize='trigram'
      )
    `);

    hasFts5 = true;
    console.log('  FTS5 enabled (porter + trigram)');
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

  // Check schema version compatibility
  checkSchemaVersion(db);

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
    (id, file_path, type, name, signature, signature_hash, doc_comment, start_line, end_line, package, parent_class, search_text, parent_id, hierarchy_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    } catch (err) {
      // FTS5 rebuild failed, ignore
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
