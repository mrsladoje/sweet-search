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
]);

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
};

// Standard tags.scm query patterns for symbol extraction
// These are s-expression patterns matching tree-sitter node types
const TAGS_QUERIES = {
  javascript: `
    (function_declaration name: (identifier) @function.definition)
    (class_declaration name: (identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (arrow_function) @arrow.definition
    (variable_declarator name: (identifier) @variable.definition)
    (export_statement (function_declaration name: (identifier) @function.definition))
  `,
  typescript: `
    (function_declaration name: (identifier) @function.definition)
    (class_declaration name: (identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (interface_declaration name: (type_identifier) @interface.definition)
    (type_alias_declaration name: (type_identifier) @type.definition)
    (enum_declaration name: (identifier) @enum.definition)
    (arrow_function) @arrow.definition
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
  'variable.definition': 'variable',
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
    try {
      this._parser.setLanguage(language);
      tree = this._parser.parse(content);
      if (!tree) return null;

      const query = language.query(queryString);
      const captures = query.captures(tree.rootNode);
      const lines = content.split('\n');

      const symbols = [];
      for (const capture of captures) {
        const { name: captureName, node } = capture;
        const entityType = CAPTURE_TO_ENTITY_TYPE[captureName];
        if (!entityType) continue;

        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;

        // Build signature from the first line of the node text
        const nodeText = content.substring(node.startIndex, node.endIndex);
        const firstLine = nodeText.split('\n')[0].trim();
        const signature = firstLine.length > 120
          ? firstLine.substring(0, 117) + '...'
          : firstLine;

        // Extract name: prefer the 'name' field, fall back to _extractNodeName
        const symbolName = node.childForFieldName?.('name')?.text
          || this._extractNodeName(node)
          || `<anonymous:${entityType}>`;

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
      if (tree) tree.delete();
    }
  }

  /**
   * Parse file content into semantic chunks using the cAST recursive algorithm.
   * Returns array of chunk objects or null if tree-sitter can't handle it.
   */
  async parseFileToChunks(content, languageId, options = {}) {
    const tree = await this.parse(content, languageId);
    if (!tree) return null;

    const maxChunkSize = options.maxChunkSize || 2000;
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
            const parentId = this._nextChunkId();

            const subChunks = this.recursiveChunk(
              this._getChildren(node),
              content,
              maxSize,
              { chunkId: parentId, name: name || 'unknown', type }
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
            });
          }
        }
      }
    }

    flushBuffer();
    return chunks;
  }

  /** Extract symbol name from an AST node */
  _extractNodeName(node) {
    // Try field name first (most reliable)
    const nameNode = node.childForFieldName('name');
    if (nameNode) return nameNode.text;

    // Fallback: look for identifier-type children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (
        child.type === 'identifier' ||
        child.type === 'type_identifier' ||
        child.type === 'property_identifier'
      ) {
        return child.text;
      }
    }

    return null;
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

    // Strategy 3: node_modules
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
export { GRAMMAR_MAP, BOUNDARY_TYPES, NODE_TYPE_MAP, TAGS_QUERIES, CAPTURE_TO_ENTITY_TYPE };
