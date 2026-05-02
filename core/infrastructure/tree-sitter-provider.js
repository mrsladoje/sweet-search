/**
 * Tree-sitter WASM Provider
 *
 * Provides AST-based parsing for top languages using web-tree-sitter WASM.
 * Falls back gracefully when tree-sitter or grammar files are unavailable.
 *
 * Usage:
 *   import { getTreeSitterProvider } from './core/tree-sitter-provider.js';
 *   const provider = getTreeSitterProvider();
 *   const chunks = await provider.parseFileToChunks(content, 'javascript');
 *   if (!chunks) { // fall back to regex }
 */

// Grammar mapping: language ID -> grammar WASM file stem
const GRAMMAR_MAP = {
  javascript: 'tree-sitter-javascript',
  typescript: 'tree-sitter-typescript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  ruby: 'tree-sitter-ruby',
  php: 'tree-sitter-php',
  kotlin: 'tree-sitter-kotlin',
  swift: 'tree-sitter-swift',
};

// Identifier node types — used to detect leaf-ident captures in extractSymbols()
const IDENT_TYPES = new Set([
  'identifier', 'type_identifier', 'property_identifier', 'field_identifier',
  // Needed by Ruby, PHP, Kotlin, Swift, C++
  'constant',             // Ruby class/module names
  'name',                 // PHP all identifiers
  'simple_identifier',    // Kotlin functions, Swift functions
  'namespace_identifier', // C++ namespace names
]);

// AST node types that represent meaningful chunk boundaries
const BOUNDARY_TYPES = new Set([
  // Functions
  'function_declaration', 'function_definition', 'method_definition',
  'arrow_function', 'function_expression', 'method_declaration',
  'function_item',
  // Classes
  'class_declaration', 'class_definition',
  // Interfaces/Types (TypeScript)
  'interface_declaration', 'type_alias_declaration', 'enum_declaration',
  // Structs/Traits (Rust/Go)
  'struct_item', 'impl_item', 'trait_item', 'type_declaration',
  // Modules
  'module', 'namespace_declaration',
  // Python
  'decorated_definition',
  // Java
  'record_declaration', 'constructor_declaration',
  // Ruby
  'singleton_method',
  // PHP
  'trait_declaration',
  // Kotlin
  'object_declaration',
  // Swift
  'protocol_declaration', 'protocol_function_declaration', 'init_declaration',
  // C
  'struct_specifier', 'enum_specifier', 'type_definition',
  // C++
  'class_specifier', 'namespace_definition',
]);

// AST node types that represent function/class bodies. Used by
// extractSignature() to find where the declaration's body starts so
// the signature span is everything before it (decorators + name +
// parameters + return type, excluding body).
const BODY_TYPES = new Set([
  // JS/TS, Java, Go, Rust, Kotlin, Swift, C#, Ruby (sometimes)
  'block', 'statement_block', 'class_body', 'function_body',
  // C / C++ — function bodies
  'compound_statement', 'field_declaration_list',
  // Python uses `block` (already covered) but `:` precedes it
  // PHP — function/method body
  'compound_statement_php',
  // Swift / Kotlin — sometimes labelled differently
  'enum_class_body', 'enum_body', 'interface_body',
  // Rust impl/trait bodies
  'declaration_list',
]);

// Maximum signature length (chars) after whitespace normalization.
// Signatures longer than this get truncated with `…`.
const MAX_SIGNATURE_LENGTH = 200;

// Map tree-sitter node type -> our chunk type label
const NODE_TYPE_MAP = {
  'function_declaration': 'function',
  'function_definition': 'function',
  'function_item': 'function',
  'method_definition': 'method',
  'method_declaration': 'method',
  'arrow_function': 'arrow',
  'function_expression': 'function',
  'class_declaration': 'class',
  'class_definition': 'class',
  'interface_declaration': 'interface',
  'type_alias_declaration': 'typeAlias',
  'enum_declaration': 'enum',
  'struct_item': 'struct',
  'impl_item': 'impl',
  'trait_item': 'trait',
  'type_declaration': 'struct',
  'module': 'module',
  'namespace_declaration': 'namespace',
  'decorated_definition': 'decorator',
  // Java
  'record_declaration': 'record',
  'constructor_declaration': 'method',
  // Ruby
  'method': 'method',
  'singleton_method': 'method',
  // PHP
  'trait_declaration': 'trait',
  // Kotlin
  'object_declaration': 'class',
  // Swift
  'protocol_declaration': 'interface',
  'protocol_function_declaration': 'method',
  'init_declaration': 'method',
  // C
  'struct_specifier': 'struct',
  'enum_specifier': 'enum',
  'type_definition': 'typeAlias',
  // C++
  'class_specifier': 'class',
  'namespace_definition': 'namespace',
};

// Standard tags.scm query patterns for symbol extraction
// These are s-expression patterns matching tree-sitter node types
const TAGS_QUERIES = {
  javascript: `
    (function_declaration name: (identifier) @function.definition)
    (generator_function_declaration name: (identifier) @function.definition)
    (class_declaration name: (identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (variable_declarator
      name: (identifier) @arrow.definition
      value: (arrow_function))
    (export_statement (function_declaration name: (identifier) @function.definition))
    (export_statement
      declaration: (class_declaration name: (identifier) @class.definition))
    (pair
      key: (property_identifier) @method.definition
      value: (function_expression))
    (pair
      key: (property_identifier) @arrow.definition
      value: (arrow_function))
  `,
  typescript: `
    (function_declaration name: (identifier) @function.definition)
    (generator_function_declaration name: (identifier) @function.definition)
    (class_declaration name: (type_identifier) @class.definition)
    (abstract_class_declaration name: (type_identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (interface_declaration name: (type_identifier) @interface.definition)
    (type_alias_declaration name: (type_identifier) @type.definition)
    (enum_declaration name: (identifier) @enum.definition)
    (variable_declarator
      name: (identifier) @arrow.definition
      value: (arrow_function))
    (export_statement
      declaration: (class_declaration name: (type_identifier) @class.definition))
    (export_statement
      declaration: (abstract_class_declaration name: (type_identifier) @class.definition))
    (pair
      key: (property_identifier) @method.definition
      value: (function_expression))
    (pair
      key: (property_identifier) @arrow.definition
      value: (arrow_function))
    (module name: (identifier) @namespace.definition)
    (internal_module name: (identifier) @namespace.definition)
  `,
  python: `
    (function_definition name: (identifier) @function.definition)
    (class_definition name: (identifier) @class.definition)
    (decorated_definition) @decorator.definition
  `,
  go: `
    (function_declaration name: (identifier) @function.definition)
    (method_declaration name: (field_identifier) @method.definition)
    (type_declaration (type_spec name: (type_identifier) @type.definition))
  `,
  rust: `
    (function_item name: (identifier) @function.definition)
    (struct_item name: (type_identifier) @struct.definition)
    (impl_item type: (type_identifier) @impl.definition)
    (trait_item name: (type_identifier) @trait.definition)
    (enum_item name: (type_identifier) @enum.definition)
  `,
  java: `
    (class_declaration name: (identifier) @class.definition)
    (interface_declaration name: (identifier) @interface.definition)
    (enum_declaration name: (identifier) @enum.definition)
    (record_declaration name: (identifier) @record.definition)
    (method_declaration name: (identifier) @method.definition)
    (constructor_declaration name: (identifier) @method.definition)
  `,
  ruby: `
    (class name: (constant) @class.definition)
    (module name: (constant) @module.definition)
    (method name: (identifier) @method.definition)
    (singleton_method name: (identifier) @method.definition)
  `,
  php: `
    (class_declaration name: (name) @class.definition)
    (interface_declaration name: (name) @interface.definition)
    (enum_declaration name: (name) @enum.definition)
    (trait_declaration name: (name) @trait.definition)
    (function_definition name: (name) @function.definition)
    (method_declaration name: (name) @method.definition)
  `,
  // Kotlin: positional children — no `name:` field on declarations
  kotlin: `
    (class_declaration (type_identifier) @class.definition)
    (object_declaration (type_identifier) @object.definition)
    (function_declaration (simple_identifier) @function.definition)
  `,
  // Swift: init_declaration has no name child — captured at node level
  swift: `
    (class_declaration name: (type_identifier) @class.definition)
    (protocol_declaration name: (type_identifier) @interface.definition)
    (function_declaration name: (simple_identifier) @function.definition)
    (protocol_function_declaration name: (simple_identifier) @method.definition)
    (init_declaration) @method.definition
  `,
  // C/C++: function name nested inside declarator chain
  c: `
    (function_definition
      declarator: (function_declarator
        declarator: (identifier) @function.definition))
    (struct_specifier name: (type_identifier) @struct.definition)
    (enum_specifier name: (type_identifier) @enum.definition)
    (type_definition declarator: (type_identifier) @type.definition)
  `,
  cpp: `
    (function_definition
      declarator: (function_declarator
        declarator: (identifier) @function.definition))
    (class_specifier name: (type_identifier) @class.definition)
    (struct_specifier name: (type_identifier) @struct.definition)
    (enum_specifier name: (type_identifier) @enum.definition)
    (namespace_definition name: (namespace_identifier) @namespace.definition)
  `,
};

// Map capture names from tags.scm queries to entity types
const CAPTURE_TO_ENTITY_TYPE = {
  'function.definition': 'function',
  'class.definition': 'class',
  'method.definition': 'method',
  'interface.definition': 'interface',
  'type.definition': 'typeAlias',
  'enum.definition': 'enum',
  'struct.definition': 'struct',
  'impl.definition': 'impl',
  'trait.definition': 'trait',
  'arrow.definition': 'arrowFunction',
  'decorator.definition': 'decorator',
  'namespace.definition': 'namespace',
  // New: Java, Ruby, PHP, Kotlin
  'record.definition': 'record',
  'module.definition': 'module',
  'object.definition': 'class',
};

export class TreeSitterProvider {
  constructor(options = {}) {
    this.grammarsDir = options.grammarsDir || null;
    this._parser = null;
    this._languages = new Map();
    this._initPromise = null;
    this._available = null; // null = unknown, true/false after first check
    this._chunkCounter = 0; // per-parse chunk ID counter
  }

  /** Check if web-tree-sitter is importable */
  async isAvailable() {
    if (this._available !== null) return this._available;
    try {
      await import('web-tree-sitter');
      this._available = true;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  /** Lazily initialize the tree-sitter parser (once) */
  async init() {
    if (this._parser) return this._parser;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        const { Parser } = await import('web-tree-sitter');
        await Parser.init();
        this._parser = new Parser();
        return this._parser;
      } catch (err) {
        this._available = false;
        this._initPromise = null;
        return null;
      }
    })();

    return this._initPromise;
  }

  /** Load a language grammar (lazy, cached) */
  async loadLanguage(languageId) {
    if (this._languages.has(languageId)) return this._languages.get(languageId);

    const grammarName = GRAMMAR_MAP[languageId];
    if (!grammarName) return null;

    try {
      const parser = await this.init();
      if (!parser) return null;

      const wasmPath = await this._findGrammarWasm(languageId, grammarName);
      if (!wasmPath) return null;

      const { Language } = await import('web-tree-sitter');
      const language = await Language.load(wasmPath);
      this._languages.set(languageId, language);
      return language;
    } catch {
      return null;
    }
  }

  /** Parse content with tree-sitter, returns tree or null */
  async parse(content, languageId) {
    const language = await this.loadLanguage(languageId);
    if (!language) return null;

    this._parser.setLanguage(language);
    return this._parser.parse(content);
  }

  /**
   * Extract symbols from content using tree-sitter tags.scm query patterns.
   * Returns an array of symbol objects, or null if tree-sitter is unavailable
   * or the language is unsupported.
   *
   * @param {string} content - Source code content
   * @param {string} languageId - Language identifier (e.g. 'javascript')
   * @returns {Promise<Array<{name: string, type: string, startLine: number, endLine: number, signature: string}>|null>}
   */
  async extractSymbols(content, languageId) {
    if (!(await this.isAvailable())) return null;

    const queryString = TAGS_QUERIES[languageId];
    if (!queryString) return null;

    const language = await this.loadLanguage(languageId);
    if (!language) return null;

    let tree;
    let query;
    try {
      this._parser.setLanguage(language);
      tree = this._parser.parse(content);
      if (!tree) return null;

      query = await this._createQuery(language, queryString);
      const captures = query.captures(tree.rootNode);

      const symbols = [];
      const seen = new Set(); // deduplicate by startIndex
      for (const capture of captures) {
        const { name: captureName, node } = capture;
        const entityType = CAPTURE_TO_ENTITY_TYPE[captureName];
        if (!entityType) continue;

        // When queries capture an identifier (e.g. `name: (identifier) @x`),
        // the node is the identifier leaf — use node.text for the name and
        // node.parent for the extent (start/end lines, signature).
        const isLeafIdent = IDENT_TYPES.has(node.type);
        const extentNode = isLeafIdent && node.parent ? node.parent : node;

        // Deduplicate: multiple captures can match the same declaration
        const key = `${extentNode.startIndex}:${entityType}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const startLine = extentNode.startPosition.row;
        const endLine = extentNode.endPosition.row;

        // Build signature from the extent node's first line
        const nodeText = content.substring(extentNode.startIndex, extentNode.endIndex);
        const firstLine = nodeText.split('\n')[0].trim();
        const signature = firstLine.length > 120
          ? firstLine.substring(0, 117) + '...'
          : firstLine;

        const symbolName = isLeafIdent
          ? node.text
          : (node.childForFieldName?.('name')?.text
            || this._extractNodeName(node)
            || `<anonymous:${entityType}>`);

        symbols.push({
          name: symbolName,
          type: entityType,
          startLine,
          endLine,
          signature,
        });
      }

      return symbols;
    } catch {
      return null;
    } finally {
      if (query) query.delete();
      if (tree) tree.delete();
    }
  }

  /**
   * Parse file content into semantic chunks using the cAST recursive algorithm.
   * Returns array of chunk objects or null if tree-sitter can't handle it.
   *
   * Header-aware budget (research-only ablation, May 2026): set
   * SWEET_SEARCH_CHUNK_HEADER_OVERHEAD=N to subtract N chars from the
   * cAST max chunk size, leaving room for the embedding-text headers
   * (path / parent / symbol / language ≈ 50–100 chars) without spilling
   * past the embedding cap. Default 0 = byte-identical to shipped. The
   * audit motivating this lever lives in eval/results/chunk-overflow-audit.md.
   */
  async parseFileToChunks(content, languageId, options = {}) {
    const tree = await this.parse(content, languageId);
    if (!tree) return null;

    const headerOverhead = (() => {
      const v = parseInt(process.env.SWEET_SEARCH_CHUNK_HEADER_OVERHEAD || '', 10);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    })();
    const maxChunkSize = (options.maxChunkSize || 2000) - headerOverhead;
    this._chunkCounter = 0;

    const children = this._getChildren(tree.rootNode);
    const chunks = this.recursiveChunk(children, content, maxChunkSize, null);

    tree.delete(); // free WASM memory
    return chunks.length > 0 ? chunks : null;
  }

  /** Generate a unique chunk ID for this parse session */
  _nextChunkId() {
    return `c${++this._chunkCounter}`;
  }

  /** Collect children of a node into an array */
  _getChildren(node) {
    const children = [];
    for (let i = 0; i < node.childCount; i++) {
      children.push(node.child(i));
    }
    return children;
  }

  /**
   * cAST recursive split-merge algorithm.
   *
   * Greedily merges adjacent sibling AST nodes into chunks up to maxSize.
   * When a single node exceeds maxSize, recurses into its children.
   * Never splits mid-expression or mid-statement (leaf nodes emit as-is).
   *
   * @param {Array} nodes - Sibling AST nodes to chunk
   * @param {string} content - Full file content
   * @param {number} maxSize - Maximum chunk size in characters
   * @param {object|null} parentInfo - Parent chunk info for hierarchical linking
   * @returns {Array} List of chunk objects
   */
  recursiveChunk(nodes, content, maxSize, parentInfo) {
    const chunks = [];
    let buffer = [];
    let bufferSize = 0;

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      const text = buffer
        .map(n => content.substring(n.startIndex, n.endIndex))
        .join('\n');

      if (text.trim().length > 30) {
        const firstBoundary = buffer.find(n => BOUNDARY_TYPES.has(n.type));
        const name = firstBoundary ? this._extractNodeName(firstBoundary) : null;
        const type = firstBoundary ? (NODE_TYPE_MAP[firstBoundary.type] || 'code') : 'code';
        const signature = firstBoundary ? this._extractSignature(firstBoundary, content) : null;

        chunks.push({
          chunkId: this._nextChunkId(),
          parentChunkId: parentInfo?.chunkId || null,
          parentSymbol: parentInfo?.name || null,
          parentType: parentInfo?.type || null,
          text: text.trim(),
          startLine: buffer[0].startPosition.row,
          endLine: buffer[buffer.length - 1].endPosition.row,
          type,
          name: name || (buffer.length === 1 ? null : null),
          signature,
        });
      }
      buffer = [];
      bufferSize = 0;
    };

    for (const node of nodes) {
      const nodeSize = node.endIndex - node.startIndex;

      if (bufferSize + nodeSize <= maxSize) {
        // Fits in current buffer — accumulate
        buffer.push(node);
        bufferSize += nodeSize;
      } else {
        // Doesn't fit — flush buffer first
        flushBuffer();

        if (nodeSize <= maxSize) {
          // Node fits alone — start new buffer
          buffer = [node];
          bufferSize = nodeSize;
        } else {
          // Node is oversized even alone — recurse into children
          if (node.childCount > 0) {
            const name = this._extractNodeName(node);
            const type = NODE_TYPE_MAP[node.type] || 'code';

            // Transparent nodes (e.g., statement_block, block) that have no
            // name and aren't boundary types should pass through the caller's
            // parent context instead of creating an anonymous level.
            let subParent;
            if (!name && !BOUNDARY_TYPES.has(node.type) && parentInfo) {
              subParent = parentInfo;
            } else {
              const parentId = this._nextChunkId();
              subParent = { chunkId: parentId, name: name || 'unknown', type };
            }

            const subChunks = this.recursiveChunk(
              this._getChildren(node),
              content,
              maxSize,
              subParent
            );
            chunks.push(...subChunks);
          } else {
            // Leaf node too big — emit as-is (never split mid-expression)
            const nodeText = content.substring(node.startIndex, node.endIndex);
            chunks.push({
              chunkId: this._nextChunkId(),
              parentChunkId: parentInfo?.chunkId || null,
              parentSymbol: parentInfo?.name || null,
              parentType: parentInfo?.type || null,
              text: nodeText.trim(),
              startLine: node.startPosition.row,
              endLine: node.endPosition.row,
              type: NODE_TYPE_MAP[node.type] || 'code',
              name: this._extractNodeName(node),
              signature: this._extractSignature(node, content),
            });
          }
        }
      }
    }

    flushBuffer();
    return chunks;
  }

  /**
   * Extract a compact, single-line signature for a boundary AST node.
   *
   * Strategy: find the first body-like child (block / statement_block /
   * compound_statement / class_body / declaration_list / …), and return
   * the source span [node.startIndex, body.startIndex) with whitespace
   * normalized to single spaces. If no body child is found (e.g.
   * declarations without a body, abstract methods, interface members),
   * return the full first line of the node.
   *
   * Returns null when the node has no children to inspect.
   *
   * Used by the `signature` R1 embedding-text variant. Intentionally
   * does NOT alter `text`, `li_text`, or `li_greedy_text` — signature
   * surface is research-only on `embedding_text`.
   */
  _extractSignature(node, content) {
    if (!node || !content) return null;
    if (!BOUNDARY_TYPES.has(node.type)) return null;

    let bodyStart = null;
    // Try field-name lookup first (works for most modern grammars).
    const bodyField = node.childForFieldName?.('body');
    if (bodyField && BODY_TYPES.has(bodyField.type)) {
      bodyStart = bodyField.startIndex;
    } else {
      // Fall back to scanning children for a body-shaped child.
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (BODY_TYPES.has(child.type)) {
          bodyStart = child.startIndex;
          break;
        }
      }
    }

    let raw;
    if (bodyStart != null && bodyStart > node.startIndex) {
      raw = content.substring(node.startIndex, bodyStart);
    } else {
      // No body found — declaration only (e.g. abstract method, type
      // alias). Take the whole node text.
      raw = content.substring(node.startIndex, node.endIndex);
    }

    // Normalize: collapse runs of whitespace (including newlines) to a
    // single space, drop leading/trailing whitespace.
    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;

    if (normalized.length <= MAX_SIGNATURE_LENGTH) return normalized;
    return normalized.slice(0, MAX_SIGNATURE_LENGTH - 1) + '…';
  }

  /** Extract symbol name from an AST node */
  _extractNodeName(node) {
    // Try field name first (most reliable)
    const nameNode = node.childForFieldName('name');
    if (nameNode) return nameNode.text;

    // Fallback: look for identifier-type children (uses IDENT_TYPES set)
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (IDENT_TYPES.has(child.type)) {
        return child.text;
      }
    }

    return null;
  }

  /** Create a tree-sitter query (mockable seam for tests) */
  async _createQuery(language, queryString) {
    const { Query } = await import('web-tree-sitter');
    return new Query(language, queryString);
  }

  /** Find grammar WASM file on disk */
  async _findGrammarWasm(languageId, grammarName) {
    const fs = await import('fs');
    const pathMod = await import('path');

    // Strategy 1: explicit grammars directory
    if (this.grammarsDir) {
      const localPath = pathMod.join(this.grammarsDir, `${grammarName}.wasm`);
      if (fs.existsSync(localPath)) return localPath;
    }

    // Strategy 2: .sweet-search/grammars/
    const dataDir = process.env.SWEET_SEARCH_DATA_DIR || '.sweet-search';
    const dataPath = pathMod.join(process.cwd(), dataDir, 'grammars', `${grammarName}.wasm`);
    if (fs.existsSync(dataPath)) return dataPath;

    // Strategy 3: tree-sitter-wasms bundle (all grammars in one package)
    try {
      const bundlePkg = await import.meta.resolve?.('tree-sitter-wasms/package.json');
      if (bundlePkg) {
        const bundleDir = pathMod.dirname(new URL(bundlePkg).pathname);
        const bundlePath = pathMod.join(bundleDir, 'out', `${grammarName}.wasm`);
        if (fs.existsSync(bundlePath)) return bundlePath;
      }
    } catch {
      // tree-sitter-wasms not installed
    }

    // Strategy 4: individual grammar packages in node_modules
    try {
      const pkgPath = await import.meta.resolve?.(`${grammarName}/package.json`);
      if (pkgPath) {
        const pkgDir = pathMod.dirname(new URL(pkgPath).pathname);
        const candidates = [
          pathMod.join(pkgDir, `${grammarName}.wasm`),
          pathMod.join(pkgDir, `${languageId}.wasm`),
          pathMod.join(pkgDir, 'tree-sitter.wasm'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // Package not installed
    }

    return null;
  }

  /** List all languages with tree-sitter grammar support */
  getSupportedLanguages() {
    return Object.keys(GRAMMAR_MAP);
  }

  /** Check if a language ID has tree-sitter grammar mapping */
  hasLanguage(languageId) {
    return languageId in GRAMMAR_MAP;
  }

  /** Reset internal state (useful for testing) */
  reset() {
    if (this._parser) {
      try { this._parser.delete(); } catch { /* ignore */ }
    }
    this._parser = null;
    this._languages.clear();
    this._initPromise = null;
    this._available = null;
  }
}

// Singleton instance
let _instance = null;

export function getTreeSitterProvider(options) {
  if (!_instance) {
    _instance = new TreeSitterProvider(options);
  } else if (options?.grammarsDir && options.grammarsDir !== _instance.grammarsDir) {
    _instance.reset();
    _instance = new TreeSitterProvider(options);
  }
  return _instance;
}

/** Reset the singleton (for testing) */
export function resetTreeSitterProvider() {
  if (_instance) {
    _instance.reset();
    _instance = null;
  }
}

// Re-export constants for testing
export { GRAMMAR_MAP, IDENT_TYPES, BOUNDARY_TYPES, BODY_TYPES, MAX_SIGNATURE_LENGTH, NODE_TYPE_MAP, TAGS_QUERIES, CAPTURE_TO_ENTITY_TYPE };
