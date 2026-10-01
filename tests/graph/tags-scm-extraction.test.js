import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TreeSitterProvider,
  TAGS_QUERIES,
  CAPTURE_TO_ENTITY_TYPE,
  GRAMMAR_MAP,
} from '../../core/infrastructure/tree-sitter-provider.js';
import { GraphExtractor } from '../../core/graph/index.js';

describe('tags.scm Symbol Extraction', () => {
  let provider;

  beforeEach(() => {
    provider = new TreeSitterProvider();
  });

  describe('TAGS_QUERIES', () => {
    it('has entries for javascript, typescript, python, go, rust', () => {
      const expected = ['javascript', 'typescript', 'python', 'go', 'rust'];
      for (const lang of expected) {
        expect(TAGS_QUERIES).toHaveProperty(lang);
        expect(typeof TAGS_QUERIES[lang]).toBe('string');
        expect(TAGS_QUERIES[lang].trim().length).toBeGreaterThan(0);
      }
    });

    it('only references languages present in GRAMMAR_MAP', () => {
      for (const lang of Object.keys(TAGS_QUERIES)) {
        expect(GRAMMAR_MAP).toHaveProperty(lang);
      }
    });

    it('query patterns contain s-expression syntax', () => {
      for (const [lang, query] of Object.entries(TAGS_QUERIES)) {
        // Basic s-expression: opening paren, node type, capture @name
        expect(query).toMatch(/\([a-z_]+/);
        expect(query).toMatch(/@[a-z]+\.[a-z]+/);
      }
    });

    it('javascript query captures function, class, method, arrow', () => {
      const q = TAGS_QUERIES.javascript;
      expect(q).toContain('@function.definition');
      expect(q).toContain('@class.definition');
      expect(q).toContain('@method.definition');
      expect(q).toContain('@arrow.definition');
    });

    it('typescript query captures interface, type, enum', () => {
      const q = TAGS_QUERIES.typescript;
      expect(q).toContain('@interface.definition');
      expect(q).toContain('@type.definition');
      expect(q).toContain('@enum.definition');
    });

    it('python query captures function, class, decorator', () => {
      const q = TAGS_QUERIES.python;
      expect(q).toContain('@function.definition');
      expect(q).toContain('@class.definition');
      expect(q).toContain('@decorator.definition');
    });

    it('go query captures function, method, type', () => {
      const q = TAGS_QUERIES.go;
      expect(q).toContain('@function.definition');
      expect(q).toContain('@method.definition');
      expect(q).toContain('@type.definition');
    });

    it('rust query captures function, struct, impl, trait, enum', () => {
      const q = TAGS_QUERIES.rust;
      expect(q).toContain('@function.definition');
      expect(q).toContain('@struct.definition');
      expect(q).toContain('@impl.definition');
      expect(q).toContain('@trait.definition');
      expect(q).toContain('@enum.definition');
    });
  });

  describe('CAPTURE_TO_ENTITY_TYPE', () => {
    it('maps all capture names referenced in TAGS_QUERIES', () => {
      // Collect all @capture.names from all query strings
      const allCaptures = new Set();
      for (const query of Object.values(TAGS_QUERIES)) {
        const matches = query.matchAll(/@([a-z]+\.[a-z]+)/g);
        for (const m of matches) {
          allCaptures.add(m[1]);
        }
      }

      for (const capture of allCaptures) {
        expect(CAPTURE_TO_ENTITY_TYPE).toHaveProperty(capture);
        expect(typeof CAPTURE_TO_ENTITY_TYPE[capture]).toBe('string');
      }
    });

    it('maps to correct entity types', () => {
      expect(CAPTURE_TO_ENTITY_TYPE['function.definition']).toBe('function');
      expect(CAPTURE_TO_ENTITY_TYPE['class.definition']).toBe('class');
      expect(CAPTURE_TO_ENTITY_TYPE['method.definition']).toBe('method');
      expect(CAPTURE_TO_ENTITY_TYPE['interface.definition']).toBe('interface');
      expect(CAPTURE_TO_ENTITY_TYPE['type.definition']).toBe('typeAlias');
      expect(CAPTURE_TO_ENTITY_TYPE['enum.definition']).toBe('enum');
      expect(CAPTURE_TO_ENTITY_TYPE['struct.definition']).toBe('struct');
      expect(CAPTURE_TO_ENTITY_TYPE['impl.definition']).toBe('impl');
      expect(CAPTURE_TO_ENTITY_TYPE['trait.definition']).toBe('trait');
      expect(CAPTURE_TO_ENTITY_TYPE['arrow.definition']).toBe('arrowFunction');
      expect(CAPTURE_TO_ENTITY_TYPE['decorator.definition']).toBe('decorator');
    });

    it('has 23 entries total', () => {
      // Bumped to 17 May-2026: added component.definition + variable.definition
      // for JS/TS/TSX `export const X = ...` shapes.
      // Bumped to 18 2026-05-11: added macro.definition for Rust macro_rules!
      // (previously emitted as `code:null` chunks since BOUNDARY_TYPES and
      // TAGS_QUERIES for rust both lacked macro_definition coverage).
      // Bumped to 20 2026-05-11: added enum_constant.definition + field.definition
      // for Java enum constants (FieldNamingPolicy.UPPER_CAMEL_CASE) and
      // static fields with anonymous-class initializers (TypeAdapters.BIT_SET).
      // Bumped to 21 2026-05-12: added property.definition for csharp init-only
      // properties (CS-004 anchor); other graph entity types are reused by
      // the csharp tags.scm (struct/record/method/namespace/field/function).
      // Bumped to 23 2026-10-01: added constant.definition + static.definition
      // for Go package-level const and Rust const / static items.
      expect(Object.keys(CAPTURE_TO_ENTITY_TYPE).length).toBe(23);
    });
  });

  describe('extractSymbols()', () => {
    it('returns null when tree-sitter is unavailable', async () => {
      provider._available = false;
      const result = await provider.extractSymbols('const x = 1;', 'javascript');
      expect(result).toBeNull();
    });

    it('returns null for unsupported language (no query)', async () => {
      // Force available=true but use a language with no TAGS_QUERIES entry
      provider._available = true;
      const result = await provider.extractSymbols('main = putStrLn "hello"', 'haskell');
      expect(result).toBeNull();
    });

    it('returns null when language grammar cannot be loaded', async () => {
      const isolated = new TreeSitterProvider();
      isolated._available = true;
      // Force _findGrammarWasm to return null (simulates missing grammars)
      isolated._findGrammarWasm = vi.fn().mockResolvedValue(null);
      const result = await isolated.extractSymbols('const x = 1;', 'javascript');
      expect(result).toBeNull();
    });

    it('processes captures correctly with mocked tree-sitter', async () => {
      // Mock the full tree-sitter pipeline
      const mockNode = {
        type: 'function_declaration',
        startPosition: { row: 0 },
        endPosition: { row: 2 },
        startIndex: 0,
        endIndex: 30,
        childForFieldName: (field) => field === 'name' ? { text: 'myFunc' } : null,
        childCount: 0,
        child: () => null,
      };

      const mockCaptures = [
        { name: 'function.definition', node: mockNode },
      ];

      const mockQuery = { captures: () => mockCaptures, delete: vi.fn() };
      const mockTree = {
        rootNode: {},
        delete: vi.fn(),
      };
      const mockLanguage = {};

      provider._available = true;
      provider._parser = {
        setLanguage: vi.fn(),
        parse: () => mockTree,
      };
      provider._languages.set('javascript', mockLanguage);
      provider._createQuery = vi.fn().mockResolvedValue(mockQuery);

      const content = 'function myFunc() {\n  return 1;\n}';
      const result = await provider.extractSymbols(content, 'javascript');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'myFunc',
        type: 'function',
        startLine: 0,
        endLine: 2,
        signature: 'function myFunc() {',
      });
      expect(mockTree.delete).toHaveBeenCalled();
      // The tags query is compiled once per grammar and kept for reuse.
      expect(mockQuery.delete).not.toHaveBeenCalled();
    });

    it('handles multiple captures in a single file', async () => {
      const mockNodes = [
        {
          type: 'class_declaration',
          startPosition: { row: 0 }, endPosition: { row: 2 },
          startIndex: 0, endIndex: 30,
          childForFieldName: (f) => f === 'name' ? { text: 'Foo' } : null,
          childCount: 0, child: () => null,
        },
        {
          type: 'method_definition',
          startPosition: { row: 4 }, endPosition: { row: 6 },
          startIndex: 31, endIndex: 55,
          childForFieldName: (f) => f === 'name' ? { text: 'bar' } : null,
          childCount: 0, child: () => null,
        },
      ];

      const mockCaptures = [
        { name: 'class.definition', node: mockNodes[0] },
        { name: 'method.definition', node: mockNodes[1] },
      ];

      const mockQuery = { captures: () => mockCaptures, delete: vi.fn() };
      const mockTree = { rootNode: {}, delete: vi.fn() };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', {});
      provider._createQuery = vi.fn().mockResolvedValue(mockQuery);

      const content = 'class Foo {\n  constructor() {}\n}\n\n  bar() {\n    return 1;\n  }';
      const result = await provider.extractSymbols(content, 'javascript');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Foo');
      expect(result[0].type).toBe('class');
      expect(result[1].name).toBe('bar');
      expect(result[1].type).toBe('method');
    });

    it('skips captures with unknown capture names', async () => {
      const mockNode = {
        type: 'unknown_node',
        startPosition: { row: 0 }, endPosition: { row: 0 },
        startIndex: 0, endIndex: 10,
        childForFieldName: () => null, childCount: 0, child: () => null,
      };

      const mockCaptures = [
        { name: 'unknown.capture', node: mockNode },
      ];

      const mockQuery = { captures: () => mockCaptures, delete: vi.fn() };
      const mockTree = { rootNode: {}, delete: vi.fn() };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', {});
      provider._createQuery = vi.fn().mockResolvedValue(mockQuery);

      const result = await provider.extractSymbols('const x = 1;', 'javascript');
      expect(result).toEqual([]);
    });

    it('falls back to _extractNodeName when no name field', async () => {
      const mockNode = {
        type: 'function_declaration',
        startPosition: { row: 0 }, endPosition: { row: 0 },
        startIndex: 0, endIndex: 20,
        childForFieldName: () => null,
        childCount: 1,
        child: (i) => i === 0 ? { type: 'identifier', text: 'fallbackName' } : null,
      };

      const mockCaptures = [{ name: 'function.definition', node: mockNode }];
      const mockQuery = { captures: () => mockCaptures, delete: vi.fn() };
      const mockTree = { rootNode: {}, delete: vi.fn() };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', {});
      provider._createQuery = vi.fn().mockResolvedValue(mockQuery);

      const content = 'function fallbackName';
      const result = await provider.extractSymbols(content, 'javascript');

      expect(result[0].name).toBe('fallbackName');
    });

    it('uses anonymous label when no name can be extracted', async () => {
      const mockNode = {
        type: 'arrow_function',
        startPosition: { row: 0 }, endPosition: { row: 0 },
        startIndex: 0, endIndex: 10,
        childForFieldName: () => null,
        childCount: 0, child: () => null,
      };

      const mockCaptures = [{ name: 'arrow.definition', node: mockNode }];
      const mockQuery = { captures: () => mockCaptures, delete: vi.fn() };
      const mockTree = { rootNode: {}, delete: vi.fn() };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', {});
      provider._createQuery = vi.fn().mockResolvedValue(mockQuery);

      const result = await provider.extractSymbols('() => 42', 'javascript');
      expect(result[0].name).toBe('<anonymous:arrowFunction>');
    });

    it('truncates long signatures to 120 chars', async () => {
      const longLine = 'function ' + 'a'.repeat(200) + '() {';
      const mockNode = {
        type: 'function_declaration',
        startPosition: { row: 0 }, endPosition: { row: 0 },
        startIndex: 0, endIndex: longLine.length,
        childForFieldName: (f) => f === 'name' ? { text: 'longFunc' } : null,
        childCount: 0, child: () => null,
      };

      const mockCaptures = [{ name: 'function.definition', node: mockNode }];
      const mockQuery = { captures: () => mockCaptures, delete: vi.fn() };
      const mockTree = { rootNode: {}, delete: vi.fn() };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', {});
      provider._createQuery = vi.fn().mockResolvedValue(mockQuery);

      const result = await provider.extractSymbols(longLine, 'javascript');
      expect(result[0].signature.length).toBe(120);
      expect(result[0].signature).toMatch(/\.\.\.$/);
    });

    it('returns null when query creation throws', async () => {
      const mockTree = { rootNode: {}, delete: vi.fn() };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', {});
      provider._createQuery = vi.fn().mockRejectedValue(new Error('Invalid query syntax'));

      const result = await provider.extractSymbols('const x = 1;', 'javascript');
      expect(result).toBeNull();
      expect(mockTree.delete).toHaveBeenCalled();
    });

    it('cleans up tree even on success', async () => {
      const mockQuery = { captures: () => [], delete: vi.fn() };
      const mockTree = { rootNode: {}, delete: vi.fn() };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', {});
      provider._createQuery = vi.fn().mockResolvedValue(mockQuery);

      await provider.extractSymbols('const x = 1;', 'javascript');
      await provider.extractSymbols('const y = 2;', 'javascript');
      expect(mockTree.delete).toHaveBeenCalledTimes(2);
      // Compiled once per grammar, reused for the second file, never deleted.
      expect(provider._createQuery).toHaveBeenCalledOnce();
      expect(mockQuery.delete).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// P2.4: graph-extractor tree-sitter integration
// =============================================================================

describe('GraphExtractor tree-sitter integration', () => {
  // We mock the tree-sitter-provider module at the import level
  // by using vi.spyOn on the singleton returned by getTreeSitterProvider.
  // Since GraphExtractor imports getTreeSitterProvider directly, we spy
  // on the provider instance methods.

  let extractor;
  let providerSpy;
  let originalProvider;

  beforeEach(async () => {
    extractor = new GraphExtractor({ projectRoot: '/project' });

    // Get the real singleton and spy on its methods
    const { getTreeSitterProvider: getRealProvider } = await import('../../core/infrastructure/tree-sitter-provider.js');
    originalProvider = getRealProvider();
    providerSpy = {
      isAvailable: vi.spyOn(originalProvider, 'isAvailable'),
      hasLanguage: vi.spyOn(originalProvider, 'hasLanguage'),
      extractSymbols: vi.spyOn(originalProvider, 'extractSymbols'),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tries tree-sitter before regex extractors', async () => {
    providerSpy.isAvailable.mockResolvedValue(true);
    providerSpy.hasLanguage.mockReturnValue(true);
    providerSpy.extractSymbols.mockResolvedValue([
      {
        name: 'greet',
        type: 'function',
        startLine: 0,
        endLine: 2,
        signature: 'function greet(name) {',
      },
    ]);

    const result = await extractor.extractFromFile(
      '/project/src/hello.js',
      'function greet(name) {\n  return "Hello " + name;\n}\n'
    );

    expect(providerSpy.isAvailable).toHaveBeenCalled();
    expect(providerSpy.hasLanguage).toHaveBeenCalledWith('javascript');
    expect(providerSpy.extractSymbols).toHaveBeenCalled();
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('greet');
    expect(result.entities[0].type).toBe('function');
    // tree-sitter is 0-indexed, entities should be 1-indexed
    expect(result.entities[0].start_line).toBe(1);
    expect(result.entities[0].end_line).toBe(3);
    expect(result.entities[0].file_path).toBe('/project/src/hello.js');
    expect(result.entities[0].id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('falls back to regex when tree-sitter is unavailable', async () => {
    providerSpy.isAvailable.mockResolvedValue(false);

    const result = await extractor.extractFromFile(
      '/project/src/hello.js',
      'function greet(name) {\n  return "Hello " + name;\n}\n'
    );

    // Should still find the function via JS regex extractor
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
    const func = result.entities.find(e => e.name === 'greet');
    expect(func).toBeDefined();
    expect(providerSpy.extractSymbols).not.toHaveBeenCalled();
  });

  it('falls back to regex when tree-sitter returns empty symbols', async () => {
    providerSpy.isAvailable.mockResolvedValue(true);
    providerSpy.hasLanguage.mockReturnValue(true);
    providerSpy.extractSymbols.mockResolvedValue([]);

    const result = await extractor.extractFromFile(
      '/project/src/hello.js',
      'function greet(name) {\n  return "Hello " + name;\n}\n'
    );

    // Should fall through to JS regex extractor
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
    const func = result.entities.find(e => e.name === 'greet');
    expect(func).toBeDefined();
  });

  it('falls back to regex when tree-sitter returns null', async () => {
    providerSpy.isAvailable.mockResolvedValue(true);
    providerSpy.hasLanguage.mockReturnValue(true);
    providerSpy.extractSymbols.mockResolvedValue(null);

    const result = await extractor.extractFromFile(
      '/project/src/hello.js',
      'function greet(name) {\n  return "Hello " + name;\n}\n'
    );

    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to regex when tree-sitter throws', async () => {
    providerSpy.isAvailable.mockResolvedValue(true);
    providerSpy.hasLanguage.mockReturnValue(true);
    providerSpy.extractSymbols.mockRejectedValue(new Error('WASM load failed'));

    const result = await extractor.extractFromFile(
      '/project/src/hello.js',
      'function greet(name) {\n  return "Hello " + name;\n}\n'
    );

    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back when language has no tree-sitter grammar', async () => {
    providerSpy.isAvailable.mockResolvedValue(true);
    providerSpy.hasLanguage.mockReturnValue(false);

    const result = await extractor.extractFromFile(
      '/project/src/hello.js',
      'function greet(name) {\n  return "Hello " + name;\n}\n'
    );

    expect(providerSpy.extractSymbols).not.toHaveBeenCalled();
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('skips tree-sitter when useTreeSitter is false', async () => {
    const noTsExtractor = new GraphExtractor({
      projectRoot: '/project',
      useTreeSitter: false,
    });

    const result = await noTsExtractor.extractFromFile(
      '/project/src/hello.js',
      'function greet(name) {\n  return "Hello " + name;\n}\n'
    );

    expect(providerSpy.isAvailable).not.toHaveBeenCalled();
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('still extracts relationships via regex when tree-sitter provides entities', async () => {
    providerSpy.isAvailable.mockResolvedValue(true);
    providerSpy.hasLanguage.mockReturnValue(true);
    providerSpy.extractSymbols.mockResolvedValue([
      {
        name: 'MyClass',
        type: 'class',
        startLine: 0,
        endLine: 5,
        signature: 'class MyClass extends Base {',
      },
    ]);

    const code = [
      'class MyClass extends Base {',
      '  constructor() {',
      '    this.service = new UserService();',
      '  }',
      '}',
      '',
    ].join('\n');

    const result = await extractor.extractFromFile('/project/src/my-class.js', code);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('MyClass');
    // Relationships extracted via regex
    expect(Array.isArray(result.relationships)).toBe(true);
  });

  it('handles multiple tree-sitter symbols correctly', async () => {
    providerSpy.isAvailable.mockResolvedValue(true);
    providerSpy.hasLanguage.mockReturnValue(true);
    providerSpy.extractSymbols.mockResolvedValue([
      { name: 'add', type: 'function', startLine: 0, endLine: 2, signature: 'function add(a, b) {' },
      { name: 'sub', type: 'function', startLine: 4, endLine: 6, signature: 'function sub(a, b) {' },
      { name: 'Calculator', type: 'class', startLine: 8, endLine: 10, signature: 'class Calculator {' },
    ]);

    const code = [
      'function add(a, b) {', '  return a + b;', '}', '',
      'function sub(a, b) {', '  return a - b;', '}', '',
      'class Calculator {', '  mul(a, b) { return a * b; }', '}',
    ].join('\n');

    const result = await extractor.extractFromFile('/project/src/calc.js', code);

    expect(result.entities).toHaveLength(3);
    expect(result.entities.map(e => e.name)).toEqual(['add', 'sub', 'Calculator']);
    // All IDs should be unique
    const ids = new Set(result.entities.map(e => e.id));
    expect(ids.size).toBe(3);
  });
});

describe('GraphExtractor.entityId', () => {
  it('is deterministic, 16-char hex, and ignores the line number', () => {
    const a = new GraphExtractor({ projectRoot: '/project' });
    const b = new GraphExtractor({ projectRoot: '/project' });
    const id1 = a.entityId('/project/src/a.js', 'function', 'foo', { line: 'function foo(x) {' }).id;
    const id2 = b.entityId('/project/src/a.js', 'function', 'foo', { line: '  function   foo(x)   {' }).id;
    expect(id1).toBe(id2); // whitespace-collapsed definition line
    expect(id1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('separates owners, long overloads and identical definitions', () => {
    const ex = new GraphExtractor({ projectRoot: '/project' });
    const f = '/project/src/A.cs';
    const pad = 'Action<WebHostBuilderContext, IConfigurationBuilder> configureDelegate, Action<IServiceCollection> services';
    const ids = [
      ex.entityId(f, 'field', '_builder', { owner: 'OcelotJ', line: 'private Builder _builder;' }).id,
      ex.entityId(f, 'field', '_builder', { owner: 'OcelotJRoute', line: 'private Builder _builder;' }).id,
      ex.entityId(f, 'method', 'Run', { line: `public int Run(${pad})` }).id,
      ex.entityId(f, 'method', 'Run', { line: `public int Run(${pad}, Action<IApplicationBuilder> app)` }).id,
      ex.entityId(f, 'variable', 'X', { line: 'X = 1' }).id,
      ex.entityId(f, 'variable', 'X', { line: 'X = 1' }).id,
    ];
    expect(new Set(ids).size).toBe(6);
  });

  it('collapses an exact repeat of a data key to the first occurrence', () => {
    const ex = new GraphExtractor({ projectRoot: '/project' });
    const f = '/project/ci.yml';
    const first = ex.entityId(f, 'topKey', 'run', { line: 'run: make', data: true });
    const again = ex.entityId(f, 'topKey', 'run', { line: 'run: make', data: true });
    const other = ex.entityId(f, 'topKey', 'run', { line: 'run: make test', data: true });
    expect(first.duplicate).toBe(false);
    expect(again).toEqual({ id: first.id, duplicate: true });
    expect(other.duplicate).toBe(false);
    expect(other.id).not.toBe(first.id);
  });
});

describe('GraphExtractor._extractRelationships', () => {
  it('returns empty array when langInfo has no graph patterns', () => {
    const extractor = new GraphExtractor({ projectRoot: '/project' });
    const rels = extractor._extractRelationships(
      'some content',
      ['some content'],
      '/project/src/a.txt',
      { id: 'text' },
      []
    );
    expect(rels).toEqual([]);
  });
});
