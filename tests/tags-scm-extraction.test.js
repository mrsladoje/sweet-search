import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TreeSitterProvider,
  TAGS_QUERIES,
  CAPTURE_TO_ENTITY_TYPE,
  GRAMMAR_MAP,
} from '../core/tree-sitter-provider.js';
import { GraphExtractor } from '../core/graph-extractor.js';

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

    it('javascript query captures function, class, method, arrow, variable', () => {
      const q = TAGS_QUERIES.javascript;
      expect(q).toContain('@function.definition');
      expect(q).toContain('@class.definition');
      expect(q).toContain('@method.definition');
      expect(q).toContain('@arrow.definition');
      expect(q).toContain('@variable.definition');
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
      expect(CAPTURE_TO_ENTITY_TYPE['variable.definition']).toBe('variable');
    });

    it('has 12 entries total', () => {
      expect(Object.keys(CAPTURE_TO_ENTITY_TYPE).length).toBe(12);
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
      const result = await provider.extractSymbols('puts "hello"', 'ruby');
      expect(result).toBeNull();
    });

    it('returns null when language grammar cannot be loaded', async () => {
      provider._available = true;
      // loadLanguage will fail (no WASM files in test env)
      const result = await provider.extractSymbols('const x = 1;', 'javascript');
      expect(result).toBeNull();
    });

    it('processes captures correctly with mocked tree-sitter', async () => {
      // Mock the full tree-sitter pipeline
      const mockNode = {
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

      const mockQuery = { captures: () => mockCaptures };
      const mockTree = {
        rootNode: {},
        delete: vi.fn(),
      };
      const mockLanguage = {
        query: () => mockQuery,
      };

      provider._available = true;
      provider._parser = {
        setLanguage: vi.fn(),
        parse: () => mockTree,
      };
      provider._languages.set('javascript', mockLanguage);

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
    });

    it('handles multiple captures in a single file', async () => {
      const mockNodes = [
        {
          startPosition: { row: 0 }, endPosition: { row: 2 },
          startIndex: 0, endIndex: 30,
          childForFieldName: (f) => f === 'name' ? { text: 'Foo' } : null,
          childCount: 0, child: () => null,
        },
        {
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

      const mockTree = { rootNode: {}, delete: vi.fn() };
      const mockLanguage = { query: () => ({ captures: () => mockCaptures }) };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', mockLanguage);

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
        startPosition: { row: 0 }, endPosition: { row: 0 },
        startIndex: 0, endIndex: 10,
        childForFieldName: () => null, childCount: 0, child: () => null,
      };

      const mockCaptures = [
        { name: 'unknown.capture', node: mockNode },
      ];

      const mockTree = { rootNode: {}, delete: vi.fn() };
      const mockLanguage = { query: () => ({ captures: () => mockCaptures }) };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', mockLanguage);

      const result = await provider.extractSymbols('const x = 1;', 'javascript');
      expect(result).toEqual([]);
    });

    it('falls back to _extractNodeName when no name field', async () => {
      const mockNode = {
        startPosition: { row: 0 }, endPosition: { row: 0 },
        startIndex: 0, endIndex: 20,
        childForFieldName: () => null,
        childCount: 1,
        child: (i) => i === 0 ? { type: 'identifier', text: 'fallbackName' } : null,
      };

      const mockCaptures = [{ name: 'function.definition', node: mockNode }];
      const mockTree = { rootNode: {}, delete: vi.fn() };
      const mockLanguage = { query: () => ({ captures: () => mockCaptures }) };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', mockLanguage);

      const content = 'function fallbackName';
      const result = await provider.extractSymbols(content, 'javascript');

      expect(result[0].name).toBe('fallbackName');
    });

    it('uses anonymous label when no name can be extracted', async () => {
      const mockNode = {
        startPosition: { row: 0 }, endPosition: { row: 0 },
        startIndex: 0, endIndex: 10,
        childForFieldName: () => null,
        childCount: 0, child: () => null,
      };

      const mockCaptures = [{ name: 'arrow.definition', node: mockNode }];
      const mockTree = { rootNode: {}, delete: vi.fn() };
      const mockLanguage = { query: () => ({ captures: () => mockCaptures }) };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', mockLanguage);

      const result = await provider.extractSymbols('() => 42', 'javascript');
      expect(result[0].name).toBe('<anonymous:arrowFunction>');
    });

    it('truncates long signatures to 120 chars', async () => {
      const longLine = 'function ' + 'a'.repeat(200) + '() {';
      const mockNode = {
        startPosition: { row: 0 }, endPosition: { row: 0 },
        startIndex: 0, endIndex: longLine.length,
        childForFieldName: (f) => f === 'name' ? { text: 'longFunc' } : null,
        childCount: 0, child: () => null,
      };

      const mockCaptures = [{ name: 'function.definition', node: mockNode }];
      const mockTree = { rootNode: {}, delete: vi.fn() };
      const mockLanguage = { query: () => ({ captures: () => mockCaptures }) };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', mockLanguage);

      const result = await provider.extractSymbols(longLine, 'javascript');
      expect(result[0].signature.length).toBe(120);
      expect(result[0].signature).toMatch(/\.\.\.$/);
    });

    it('returns null when query creation throws', async () => {
      const mockTree = { rootNode: {}, delete: vi.fn() };
      const mockLanguage = {
        query: () => { throw new Error('Invalid query syntax'); },
      };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', mockLanguage);

      const result = await provider.extractSymbols('const x = 1;', 'javascript');
      expect(result).toBeNull();
      expect(mockTree.delete).toHaveBeenCalled();
    });

    it('cleans up tree even on success', async () => {
      const mockTree = { rootNode: {}, delete: vi.fn() };
      const mockLanguage = { query: () => ({ captures: () => [] }) };

      provider._available = true;
      provider._parser = { setLanguage: vi.fn(), parse: () => mockTree };
      provider._languages.set('javascript', mockLanguage);

      await provider.extractSymbols('const x = 1;', 'javascript');
      expect(mockTree.delete).toHaveBeenCalledOnce();
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
    const { getTreeSitterProvider: getRealProvider } = await import('../core/tree-sitter-provider.js');
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

describe('GraphExtractor._makeEntityId', () => {
  it('generates deterministic 16-char hex IDs', () => {
    const extractor = new GraphExtractor({ projectRoot: '/project' });
    const id1 = extractor._makeEntityId('/project/src/a.js', 'foo', 'function', 5);
    const id2 = extractor._makeEntityId('/project/src/a.js', 'foo', 'function', 5);
    const id3 = extractor._makeEntityId('/project/src/a.js', 'foo', 'function', 10);

    expect(id1).toBe(id2); // deterministic
    expect(id1).not.toBe(id3); // different line -> different ID
    expect(id1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('uses relative path from projectRoot', () => {
    const extractor = new GraphExtractor({ projectRoot: '/project' });
    const id = extractor._makeEntityId('/project/src/a.js', 'foo', 'function', 1);
    // Should hash "src/a.js:function:foo:1" not "/project/src/a.js:..."
    expect(id).toMatch(/^[0-9a-f]{16}$/);
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
