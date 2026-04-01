/**
 * P0 Gap Tests — Brutal Honesty Review Findings
 *
 * Tests that expose the real issues found in the P0 implementation:
 * - P0.1: Tree-sitter grammar availability
 * - P0.2: enrichEmbeddingText parent info loss + enrichChunksFromGraph
 * - P0.3: PageRank dangling node behavior
 * - P0.4: Recall@k semantic mismatch + formatReport NaN on missing metrics
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import path from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

// =============================================================================
// P0.1 — Tree-sitter Grammar Availability
// =============================================================================

describe('P0.1: Tree-sitter grammar availability', () => {
  it('web-tree-sitter module is importable', async () => {
    let available = false;
    try {
      await import('web-tree-sitter');
      available = true;
    } catch { /* not installed */ }
    expect(available).toBe(true);
  });

  it('TreeSitterProvider reports isAvailable based on module presence', async () => {
    const { TreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js');
    const provider = new TreeSitterProvider();
    const available = await provider.isAvailable();
    // web-tree-sitter IS installed, so this should be true
    expect(available).toBe(true);
  });

  it('language grammars load successfully from tree-sitter-wasms', async () => {
    const { TreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js');
    const provider = new TreeSitterProvider();

    const jsLang = await provider.loadLanguage('javascript');
    const pyLang = await provider.loadLanguage('python');
    const goLang = await provider.loadLanguage('go');

    expect(jsLang).toBeTruthy();
    expect(pyLang).toBeTruthy();
    expect(goLang).toBeTruthy();

    provider.reset();
  });

  it('all 12 GRAMMAR_MAP languages load', async () => {
    const { TreeSitterProvider, GRAMMAR_MAP } = await import('../../core/infrastructure/tree-sitter-provider.js');
    const provider = new TreeSitterProvider();

    for (const lang of Object.keys(GRAMMAR_MAP)) {
      const loaded = await provider.loadLanguage(lang);
      expect(loaded, `${lang} grammar should load`).toBeTruthy();
    }

    provider.reset();
  });

  it('ASTChunker uses tree-sitter path when grammars available', async () => {
    const { ASTChunker } = await import('../../core/indexing/ast-chunker.js');
    const chunker = new ASTChunker({ projectRoot: '/project', useTreeSitter: true });

    const code = 'function hello() {\n  return "world";\n}';
    const chunks = await chunker.parseFile('/project/src/test.js', code);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toHaveProperty('embedding_text');
  });
});

// =============================================================================
// P0.1b — Tree-sitter Real Parsing Integration
// =============================================================================

describe('P0.1b: tree-sitter real parsing integration', () => {
  let TreeSitterProvider;
  let provider;

  beforeAll(async () => {
    ({ TreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js'));
  });

  beforeEach(() => {
    provider = new TreeSitterProvider();
  });

  afterEach(() => {
    provider.reset();
  });

  it('parseFileToChunks produces chunks for JavaScript', async () => {
    const code = [
      'function add(a, b) {',
      '  return a + b;',
      '}',
      '',
      'function multiply(x, y) {',
      '  return x * y;',
      '}',
    ].join('\n');

    const chunks = await provider.parseFileToChunks(code, 'javascript');
    expect(chunks).not.toBeNull();
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Content should include both functions
    const allText = chunks.map(c => c.text).join('\n');
    expect(allText).toContain('add');
    expect(allText).toContain('multiply');
  });

  it('parseFileToChunks produces chunks for Python', async () => {
    const code = [
      'def greet(name):',
      '    print(f"Hello, {name}")',
      '    return name.upper()',
      '',
      'class UserService:',
      '    def __init__(self, db):',
      '        self.db = db',
      '    def get_user(self, user_id):',
      '        return self.db.find(user_id)',
    ].join('\n');

    const chunks = await provider.parseFileToChunks(code, 'python');
    expect(chunks).not.toBeNull();
    const allText = chunks.map(c => c.text).join('\n');
    expect(allText).toContain('greet');
    expect(allText).toContain('UserService');
  });

  it('parseFileToChunks produces chunks for Go', async () => {
    const code = [
      'package main',
      '',
      'func Add(a, b int) int {',
      '    return a + b',
      '}',
      '',
      'type Server struct {',
      '    Host string',
      '    Port int',
      '}',
    ].join('\n');

    const chunks = await provider.parseFileToChunks(code, 'go');
    expect(chunks).not.toBeNull();
    const allText = chunks.map(c => c.text).join('\n');
    expect(allText).toContain('Add');
    expect(allText).toContain('Server');
  });

  it('extractSymbols returns correct names for JavaScript', async () => {
    const code = [
      'function fetchData(url) {',
      '  return fetch(url);',
      '}',
      '',
      'class ApiClient {',
      '  constructor(baseUrl) {',
      '    this.baseUrl = baseUrl;',
      '  }',
      '  get(path) {',
      '    return fetch(this.baseUrl + path);',
      '  }',
      '}',
    ].join('\n');

    const symbols = await provider.extractSymbols(code, 'javascript');
    expect(symbols).not.toBeNull();

    const names = symbols.map(s => s.name);
    expect(names).toContain('fetchData');
    expect(names).toContain('ApiClient');
    expect(names).toContain('constructor');
    expect(names).toContain('get');
  });

  it('extractSymbols returns correct line ranges', async () => {
    const code = [
      'function first() {',  // L0
      '  return 1;',         // L1
      '}',                   // L2
      '',                    // L3
      'function second() {', // L4
      '  return 2;',         // L5
      '}',                   // L6
    ].join('\n');

    const symbols = await provider.extractSymbols(code, 'javascript');
    expect(symbols).not.toBeNull();

    const first = symbols.find(s => s.name === 'first');
    expect(first).toBeDefined();
    expect(first.startLine).toBe(0);
    expect(first.endLine).toBe(2);

    const second = symbols.find(s => s.name === 'second');
    expect(second).toBeDefined();
    expect(second.startLine).toBe(4);
    expect(second.endLine).toBe(6);
  });

  it('extractSymbols returns signature from extent node', async () => {
    const code = 'function processData(input, options) {\n  return input;\n}';

    const symbols = await provider.extractSymbols(code, 'javascript');
    expect(symbols).not.toBeNull();
    expect(symbols[0].signature).toContain('function processData');
  });

  it('extractSymbols works for Go functions and types', async () => {
    const code = [
      'package main',
      '',
      'func Calculate(x, y int) int {',
      '    return x + y',
      '}',
      '',
      'type Config struct {',
      '    Debug bool',
      '}',
    ].join('\n');

    const symbols = await provider.extractSymbols(code, 'go');
    expect(symbols).not.toBeNull();

    const names = symbols.map(s => s.name);
    expect(names).toContain('Calculate');
    expect(names).toContain('Config');
  });

  it('extractSymbols works for Python', async () => {
    const code = [
      'def compute(x):',
      '    return x * 2',
      '',
      'class DataProcessor:',
      '    def run(self):',
      '        pass',
    ].join('\n');

    const symbols = await provider.extractSymbols(code, 'python');
    expect(symbols).not.toBeNull();

    const names = symbols.map(s => s.name);
    expect(names).toContain('compute');
    expect(names).toContain('DataProcessor');
  });

  it('extractSymbols works for Rust', async () => {
    const code = [
      'fn main() {',
      '    println!("hello");',
      '}',
      '',
      'struct Point {',
      '    x: f64,',
      '    y: f64,',
      '}',
      '',
      'impl Point {',
      '    fn distance(&self) -> f64 {',
      '        (self.x.powi(2) + self.y.powi(2)).sqrt()',
      '    }',
      '}',
    ].join('\n');

    const symbols = await provider.extractSymbols(code, 'rust');
    expect(symbols).not.toBeNull();

    const names = symbols.map(s => s.name);
    expect(names).toContain('main');
    expect(names).toContain('Point');
  });

  it('cAST splits oversized functions into sub-chunks with parent links', async () => {
    // Generate a large function that exceeds maxChunkSize
    const stmts = [];
    for (let i = 0; i < 50; i++) {
      stmts.push(`  console.log("statement ${i}: ${'x'.repeat(40)}");`);
    }
    const code = `function bigFunction() {\n${stmts.join('\n')}\n}`;
    expect(code.length).toBeGreaterThan(2000);

    const chunks = await provider.parseFileToChunks(code, 'javascript', { maxChunkSize: 500 });
    expect(chunks).not.toBeNull();
    expect(chunks.length).toBeGreaterThan(1);

    // At least one sub-chunk should have parent info
    const withParent = chunks.filter(c => c.parentChunkId);
    expect(withParent.length).toBeGreaterThan(0);
    expect(withParent[0].parentSymbol).toBe('bigFunction');
    expect(withParent[0].parentType).toBe('function');
  });

  it('ASTChunker uses tree-sitter for supported languages', async () => {
    const { ASTChunker } = await import('../../core/indexing/ast-chunker.js');
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: true });

    const code = [
      'function greet(name) {',
      '  console.log("Hello, " + name);',
      '  return name.toUpperCase();',
      '}',
    ].join('\n');

    const chunks = await chunker.parseFile('/test/greet.js', code);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Should have embedding_text with path context
    expect(chunks[0].embedding_text).toContain('greet.js');
  });
});

// =============================================================================
// P0.2 — enrichEmbeddingText: Parent Info Loss
// =============================================================================

describe('P0.2: enrichEmbeddingText parent context behavior', () => {
  let ASTChunker;

  beforeAll(async () => {
    ({ ASTChunker } = await import('../../core/indexing/ast-chunker.js'));
  });

  it('buildChunk includes parent info in embedding_text when hierarchyInfo provided', () => {
    const chunker = new ASTChunker({ projectRoot: '/project' });
    const chunk = chunker.buildChunk(
      'this.name = name;', '/project/src/user.js',
      'javascript', 'method', 'constructor', 0, 0,
      { chunkId: 'c1', parentChunkId: 'c0', parentSymbol: 'UserService', parentType: 'class' }
    );
    expect(chunk.embedding_text).toContain('# Parent: class UserService');
    expect(chunk.metadata.parent_symbol).toBe('UserService');
    expect(chunk.metadata.parent_type).toBe('class');
  });

  it('enrichEmbeddingText uses scope chain when available (replaces parent)', () => {
    const chunker = new ASTChunker({ projectRoot: '/project' });
    const chunk = chunker.buildChunk(
      'this.name = name;', '/project/src/user.js',
      'javascript', 'method', 'constructor', 0, 0,
      { chunkId: 'c1', parentChunkId: 'c0', parentSymbol: 'UserService', parentType: 'class' }
    );

    // Before enrichment: parent info exists
    expect(chunk.embedding_text).toContain('# Parent: class UserService');

    // After enrichment with scope chain: scope replaces parent (more detailed)
    ASTChunker.enrichEmbeddingText(chunk, ['UserService', 'constructor'], ['Database']);
    expect(chunk.embedding_text).not.toContain('# Parent: class UserService');
    expect(chunk.embedding_text).toContain('# Scope: UserService > constructor');
    expect(chunk.metadata.parent_symbol).toBe('UserService');
  });

  it('enrichEmbeddingText preserves parent info when no scope chain', () => {
    const chunker = new ASTChunker({ projectRoot: '/project' });
    const chunk = chunker.buildChunk(
      'this.name = name;', '/project/src/user.js',
      'javascript', 'method', 'constructor', 0, 0,
      { chunkId: 'c1', parentChunkId: 'c0', parentSymbol: 'UserService', parentType: 'class' }
    );

    // Enrich with no scope chain — parent from buildChunk should be preserved
    ASTChunker.enrichEmbeddingText(chunk, [], ['Database']);
    expect(chunk.embedding_text).toContain('# Parent: class UserService');
    expect(chunk.embedding_text).toContain('# Uses: Database');
  });

  it('enrichEmbeddingText preserves metadata even though embedding_text is replaced', () => {
    const chunker = new ASTChunker({ projectRoot: '/project' });
    const chunk = chunker.buildChunk(
      'const x = 1;', '/project/src/mod.js',
      'javascript', 'variable', 'x', 10, 10,
      { chunkId: 'c5', parentChunkId: 'c2', parentSymbol: 'MyClass', parentType: 'class' }
    );

    const originalMetadata = { ...chunk.metadata };
    ASTChunker.enrichEmbeddingText(chunk, ['MyClass'], ['lodash']);

    // Metadata is untouched
    expect(chunk.metadata.parent_symbol).toBe(originalMetadata.parent_symbol);
    expect(chunk.metadata.parent_type).toBe(originalMetadata.parent_type);
    expect(chunk.metadata.chunk_id).toBe(originalMetadata.chunk_id);
    expect(chunk.metadata.parent_chunk_id).toBe(originalMetadata.parent_chunk_id);
  });
});

// =============================================================================
// P0.2 — enrichChunksFromGraph: Integration Test
// =============================================================================

describe('P0.2: enrichChunksFromGraph hash computation', () => {
  it('fileEntityId hash matches GraphExtractor.makeId when using default projectRoot (cwd)', async () => {
    const { GraphExtractor } = await import('../../core/graph/graph-extractor.js');
    // Production case: both use default projectRoot = cwd
    const extractor = new GraphExtractor(); // defaults to process.cwd()

    const filePath = 'core/config.js';
    const basename = path.basename(filePath);

    // How GraphExtractor computes the ID:
    // path.relative(cwd, 'core/config.js') → 'core/config.js' (already relative to cwd)
    const extractorId = extractor.makeId(filePath, 'file', basename);

    // How enrichChunksFromGraph computes it (uses raw filePath):
    const key = `${filePath}:file:${basename}`;
    const enrichmentId = createHash('sha256').update(key).digest('hex').slice(0, 16);

    expect(enrichmentId).toBe(extractorId);
  });

  it('hash matches for various relative paths with default projectRoot', async () => {
    const { GraphExtractor } = await import('../../core/graph/graph-extractor.js');
    const extractor = new GraphExtractor(); // defaults to cwd

    const testPaths = [
      'src/services/auth-service.ts',
      'core/deep/nested/module.js',
      'index.js',
      'a.py',
    ];

    for (const filePath of testPaths) {
      const basename = path.basename(filePath);
      const extractorId = extractor.makeId(filePath, 'file', basename);
      const key = `${filePath}:file:${basename}`;
      const enrichmentId = createHash('sha256').update(key).digest('hex').slice(0, 16);
      expect(enrichmentId).toBe(extractorId);
    }
  });

  it('hash DIVERGES when GraphExtractor uses custom projectRoot (fragile coupling)', async () => {
    const { GraphExtractor } = await import('../../core/graph/graph-extractor.js');
    // Non-default projectRoot causes path.relative to transform the path
    const extractor = new GraphExtractor({ projectRoot: '/custom/root' });

    const filePath = 'core/config.js';
    const basename = path.basename(filePath);
    const extractorId = extractor.makeId(filePath, 'file', basename);

    // enrichChunksFromGraph uses raw filePath — won't match
    const key = `${filePath}:file:${basename}`;
    const enrichmentId = createHash('sha256').update(key).digest('hex').slice(0, 16);

    // This documents a fragile coupling: if anyone passes custom projectRoot
    // to GraphExtractor, the import enrichment will silently fail to match
    expect(enrichmentId).not.toBe(extractorId);
  });
});

describe('P0.2: enrichChunksFromGraph SQLite integration', () => {
  let tmpDir;
  let dbPath;

  beforeAll(async () => {
    const { createGraphSchema, insertGraph } = await import('../../core/graph/graph-extractor.js');
    const Database = (await import('better-sqlite3')).default;

    tmpDir = mkdtempSync(path.join(tmpdir(), 'enrich-test-'));
    dbPath = path.join(tmpDir, 'code-graph.db');

    const db = new Database(dbPath);
    createGraphSchema(db);

    // Insert test entities
    const insertEntity = db.prepare(`
      INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRel = db.prepare(`
      INSERT INTO relationships (source_id, target_id, target_name, type, weight)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Entities for core/config.js
    insertEntity.run('e1', 'core/config.js', 'class', 'Config', 'class Config', 1, 50);
    insertEntity.run('e2', 'core/config.js', 'method', 'load', 'load()', 10, 20);

    // Compute file entity ID for import relationships
    const key = 'core/config.js:file:config.js';
    const fileEntityId = createHash('sha256').update(key).digest('hex').slice(0, 16);

    // Import relationships
    insertRel.run(fileEntityId, null, 'path', 'imports', 1.0);
    insertRel.run(fileEntityId, null, 'fs', 'imports', 1.0);

    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('queries entities by file_path', async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    const entities = db.prepare('SELECT * FROM entities WHERE file_path = ?').all('core/config.js');
    expect(entities).toHaveLength(2);
    expect(entities[0].name).toBe('Config');
    expect(entities[1].name).toBe('load');
    db.close();
  });

  it('queries imports by exact fileEntityId hash', async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const key = 'core/config.js:file:config.js';
    const fileEntityId = createHash('sha256').update(key).digest('hex').slice(0, 16);

    const imports = db.prepare(
      `SELECT DISTINCT target_name FROM relationships
       WHERE source_id = ? AND type IN ('imports', 'plainImport')
       ORDER BY target_name`
    ).all(fileEntityId);

    expect(imports).toHaveLength(2);
    expect(imports.map(r => r.target_name)).toEqual(['fs', 'path']);
    db.close();
  });

  it('LIKE query with file path does NOT match hash-based source_id', async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    // This was the original bug — LIKE '%core/config.js%' against a hex hash
    const imports = db.prepare(
      `SELECT DISTINCT target_name FROM relationships
       WHERE source_id LIKE ? AND type IN ('imports', 'plainImport')`
    ).all('%core/config.js%');

    expect(imports).toHaveLength(0); // Correctly demonstrates the bug
    db.close();
  });

  it('scope chain correctly identifies containing entities', () => {
    // Simulate the scope chain logic from enrichChunksFromGraph
    const entities = [
      { type: 'class', name: 'Config', start_line: 1, end_line: 50 },
      { type: 'method', name: 'load', start_line: 10, end_line: 20 },
    ];

    // A chunk inside the load method (lines 12-18)
    const chunkStart = 12;
    const chunkEnd = 18;
    const scopeChain = [];
    for (const entity of entities) {
      if (entity.start_line <= chunkStart && entity.end_line >= chunkEnd) {
        scopeChain.push(entity.name);
      }
    }

    expect(scopeChain).toEqual(['Config', 'load']); // Both contain the chunk
  });

  it('scope chain excludes non-containing entities', () => {
    const entities = [
      { type: 'class', name: 'Config', start_line: 1, end_line: 50 },
      { type: 'method', name: 'load', start_line: 10, end_line: 20 },
      { type: 'method', name: 'save', start_line: 25, end_line: 35 },
    ];

    // A chunk inside save method (lines 28-30)
    const chunkStart = 28;
    const chunkEnd = 30;
    const scopeChain = [];
    for (const entity of entities) {
      if (entity.start_line <= chunkStart && entity.end_line >= chunkEnd) {
        scopeChain.push(entity.name);
      }
    }

    expect(scopeChain).toEqual(['Config', 'save']); // load is NOT included
  });
});

// =============================================================================
// P0.3 — PageRank: Dangling Nodes
// =============================================================================

describe('P0.3: PageRank dangling node behavior', () => {
  let pageRank;

  beforeAll(async () => {
    ({ pageRank } = await import('../../core/graph/repo-map.js'));
  });

  it('dangling node mass is redistributed — score sum ≈ 1.0', () => {
    // Graph with dangling nodes (d, e, f have no outgoing edges)
    const nodes = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
    const edges = new Map([
      ['a', new Set(['b', 'c'])],
      ['b', new Set(['c'])],
      ['c', new Set(['d'])],
      // d, e, f are dangling — no outgoing edges
    ]);
    const scores = pageRank(edges, nodes);
    const sum = [...scores.values()].reduce((s, v) => s + v, 0);

    // With dangling mass redistribution, sum ≈ 1.0
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('relative rankings correct with dangling mass redistribution', () => {
    // c is the hub — everyone points to it
    const nodes = new Set(['a', 'b', 'c', 'leaf1', 'leaf2']);
    const edges = new Map([
      ['a', new Set(['c'])],
      ['b', new Set(['c'])],
      // leaf1, leaf2 are dangling; c is dangling too (no outgoing)
    ]);
    const scores = pageRank(edges, nodes);

    // c should still rank highest (most incoming links)
    expect(scores.get('c')).toBeGreaterThan(scores.get('a'));
    expect(scores.get('c')).toBeGreaterThan(scores.get('b'));
    expect(scores.get('c')).toBeGreaterThan(scores.get('leaf1'));

    // Score sum should be ≈ 1.0 even with dangling nodes
    const sum = [...scores.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('all-dangling graph (no edges) distributes mass uniformly', () => {
    const nodes = new Set(['a', 'b', 'c']);
    const edges = new Map(); // no edges at all
    const scores = pageRank(edges, nodes);
    const sum = [...scores.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    // All nodes should have equal score (1/3)
    expect(scores.get('a')).toBeCloseTo(1 / 3, 5);
    expect(scores.get('b')).toBeCloseTo(1 / 3, 5);
    expect(scores.get('c')).toBeCloseTo(1 / 3, 5);
  });

  it('fully-connected graph sums to approximately 1', () => {
    // Baseline: no dangling nodes → sum ≈ 1
    const nodes = new Set(['a', 'b', 'c']);
    const edges = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['c'])],
      ['c', new Set(['a'])],
    ]);
    const scores = pageRank(edges, nodes);
    const sum = [...scores.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

// =============================================================================
// P0.3b — Focus File Matching (path.resolve fix)
// =============================================================================

describe('P0.3b: focus file matching with relative/absolute paths', () => {
  let pageRank, buildAdjacency;

  beforeAll(async () => {
    ({ pageRank, buildAdjacency } = await import('../../core/graph/repo-map.js'));
  });

  it('suffix matching catches relative focusFile against absolute entity path', () => {
    const graph = {
      entities: [
        { id: 'e1', file_path: '/project/src/main.js', type: 'function', name: 'main', signature: 'main()', start_line: 1, end_line: 10 },
        { id: 'e2', file_path: '/project/src/util.js', type: 'function', name: 'helper', signature: 'helper()', start_line: 1, end_line: 5 },
      ],
      relationships: [
        { source_id: 'e1', target_id: 'e2', target_name: 'helper', type: 'calls', weight: 1 },
      ],
    };

    const { outEdges, allNodes, entityMap } = buildAdjacency(graph);
    const scores = pageRank(outEdges, allNodes);

    // Simulate focus boost with relative path
    const focusFiles = ['src/main.js']; // relative — won't match path.resolve alone
    for (const [nodeId, ent] of entityMap) {
      const entPath = ent.file_path;
      const matched = focusFiles.some(f =>
        entPath === f ||
        entPath.endsWith('/' + f) ||
        path.resolve(entPath) === path.resolve(f)
      );
      if (matched) {
        scores.set(nodeId, (scores.get(nodeId) || 0) * 3);
      }
    }

    // main.js should be boosted
    expect(scores.get('e1')).toBeGreaterThan(scores.get('e2'));
  });

  it('exact match works for identical paths', () => {
    const focusFiles = ['/project/src/main.js'];
    const entPath = '/project/src/main.js';
    const matched = focusFiles.some(f =>
      entPath === f ||
      entPath.endsWith('/' + f) ||
      path.resolve(entPath) === path.resolve(f)
    );
    expect(matched).toBe(true);
  });
});

// =============================================================================
// P0.4 — Retrieval Harness: formatReport NaN + Recall@k Semantics
// =============================================================================

describe('P0.4: formatReport handles missing metrics', () => {
  let RetrievalHarness;

  beforeAll(async () => {
    ({ RetrievalHarness } = await import('../../eval/retrieval-harness.js'));
  });

  it('formatReport omits absent metric keys without NaN', () => {
    const harness = new RetrievalHarness({ k_values: [1, 5, 10, 20] });
    // Simulate importBenchmarkResult output where recall@1, ndcg@1, ndcg@5, ndcg@20 are absent
    const metrics = {
      'recall@5': 0.8,
      'recall@10': 0.9,
      'recall@20': 0.95,
      mrr: 0.7,
      'ndcg@10': 0.75,
      totalQueries: 100,
    };
    const comparison = { hasBaseline: false, deltas: {}, passed: true };
    const report = harness.formatReport(metrics, comparison);

    // After fix: absent keys are skipped entirely, no NaN
    expect(report).not.toContain('NaN');
    expect(report).not.toContain('Recall@1:');
    expect(report).not.toContain('NDCG@1:');
    expect(report).toContain('Recall@5:  80.0%');
    expect(report).toContain('NDCG@10');
  });
});

describe('P0.4: importBenchmarkResult only maps existing keys', () => {
  let RetrievalHarness;
  let fs;

  beforeAll(async () => {
    ({ RetrievalHarness } = await import('../../eval/retrieval-harness.js'));
    fs = await import('fs/promises');
  });

  it('skips recall@1 when recall_at_1 is absent from benchmark', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'import-test-'));
    const resultFile = path.join(tmpDir, 'result.json');
    await fs.writeFile(resultFile, JSON.stringify({
      queryCount: 100,
      aggregate: {
        recall_at_5: 0.8,
        recall_at_10: 0.9,
        recall_at_20: 0.95,
        mrr_at_10: 0.7,
        ndcg_at_10: 0.75,
        // recall_at_1, ndcg_at_1, ndcg_at_5, ndcg_at_20 are absent
      },
    }));

    const harness = new RetrievalHarness();
    const metrics = await harness.importBenchmarkResult(resultFile);

    // Absent keys should NOT be in the result
    expect(metrics).not.toHaveProperty('recall@1');
    expect(metrics).not.toHaveProperty('ndcg@1');
    expect(metrics).not.toHaveProperty('ndcg@5');
    expect(metrics).not.toHaveProperty('ndcg@20');

    // Present keys should be mapped correctly
    expect(metrics['recall@5']).toBe(0.8);
    expect(metrics['recall@10']).toBe(0.9);
    expect(metrics['recall@20']).toBe(0.95);
    expect(metrics.mrr).toBe(0.7);
    expect(metrics['ndcg@10']).toBe(0.75);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('maps all keys when benchmark provides them', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'import-full-'));
    const resultFile = path.join(tmpDir, 'result.json');
    await fs.writeFile(resultFile, JSON.stringify({
      queryCount: 200,
      aggregate: {
        recall_at_1: 0.5,
        recall_at_5: 0.8,
        recall_at_10: 0.9,
        recall_at_20: 0.95,
        mrr_at_10: 0.7,
        ndcg_at_1: 0.4,
        ndcg_at_5: 0.6,
        ndcg_at_10: 0.75,
        ndcg_at_20: 0.8,
      },
    }));

    const harness = new RetrievalHarness();
    const metrics = await harness.importBenchmarkResult(resultFile);

    expect(metrics['recall@1']).toBe(0.5);
    expect(metrics['ndcg@1']).toBe(0.4);
    expect(metrics['ndcg@5']).toBe(0.6);
    expect(metrics['ndcg@20']).toBe(0.8);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('P0.4: Recall@k now computes proportion-based recall (aligned with benchmark)', () => {
  it('harness recallAtK computes proportion of relevant docs found', async () => {
    const { RetrievalHarness } = await import('../../eval/retrieval-harness.js');
    const harness = new RetrievalHarness();

    // Query with 3 relevant docs, only 1 in top-5
    const results = [
      { retrieved: ['a', 'b', 'c', 'd', 'e'], relevant: ['c', 'x', 'y'] },
    ];
    // Proportion: 1/3 of relevant docs found in top-5
    expect(harness.recallAtK(results, 5)).toBeCloseTo(1 / 3, 5);
  });

  it('harness recallAtK equals 1.0 when all relevant docs found', async () => {
    const { RetrievalHarness } = await import('../../eval/retrieval-harness.js');
    const harness = new RetrievalHarness();

    const results = [
      { retrieved: ['a', 'b', 'c'], relevant: ['a', 'c'] },
    ];
    // 2/2 relevant found → 1.0
    expect(harness.recallAtK(results, 3)).toBe(1.0);
  });

  it('harness recallAtK equivalent to successAtK for single-relevant queries', async () => {
    const { RetrievalHarness } = await import('../../eval/retrieval-harness.js');
    const harness = new RetrievalHarness();

    // Each query has exactly 1 relevant doc (CodeSearchNet scenario)
    const results = [
      { retrieved: ['a', 'b', 'c', 'd', 'e'], relevant: ['c'] },
      { retrieved: ['x', 'y', 'z'], relevant: ['w'] },
    ];
    // For single-relevant: recallAtK = successAtK (binary per query)
    expect(harness.recallAtK(results, 5)).toBe(harness.successAtK(results, 5));
  });

  it('successAtK computes binary hit rate', async () => {
    const { RetrievalHarness } = await import('../../eval/retrieval-harness.js');
    const harness = new RetrievalHarness();

    // 3 relevant docs, 1 found → binary hit = 1.0
    const results = [
      { retrieved: ['a', 'b', 'c', 'd', 'e'], relevant: ['c', 'x', 'y'] },
    ];
    expect(harness.successAtK(results, 5)).toBe(1.0);
  });

  it('benchmark and harness recallAtK now agree on proportion semantics', async () => {
    const { RetrievalHarness } = await import('../../eval/retrieval-harness.js');
    const { computeMetrics } = await import('../../eval/lib/metrics.js');
    const harness = new RetrievalHarness();

    // Same scenario: 5 relevant docs, 2 found in top-10
    const harnessResults = [
      { retrieved: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], relevant: ['c', 'f', 'x', 'y', 'z'] },
    ];
    const harnessRecall = harness.recallAtK(harnessResults, 10);

    const benchmarkQueries = [{
      rankedRelevance: [0, 0, 1, 0, 0, 1, 0, 0, 0, 0], // 2 relevant found
      totalRelevant: 5,
      latencyMs: 10,
    }];
    const benchmarkMetrics = computeMetrics(benchmarkQueries);
    const benchmarkRecall = benchmarkMetrics.recall_at_10;

    // Both now compute proportion: 2/5 = 0.4
    expect(harnessRecall).toBeCloseTo(0.4, 3);
    expect(benchmarkRecall).toBeCloseTo(0.4, 3);
    expect(harnessRecall).toBeCloseTo(benchmarkRecall, 3);
  });
});
