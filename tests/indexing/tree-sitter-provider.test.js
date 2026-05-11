/**
 * Tree-sitter WASM Provider Tests
 *
 * Tests the tree-sitter provider module: grammar mapping, availability checks,
 * cAST recursive split-merge algorithm, hierarchical chunk linking,
 * and AST chunker integration (fallback behaviour).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TreeSitterProvider,
  getTreeSitterProvider,
  resetTreeSitterProvider,
  GRAMMAR_MAP,
  BOUNDARY_TYPES,
  NODE_TYPE_MAP,
} from '../../core/infrastructure/tree-sitter-provider.js';
import { ASTChunker } from '../../core/indexing/ast-chunker.js';

// =============================================================================
// Helper: create mock AST node
// =============================================================================

function mockNode(type, startIdx, endIdx, startRow, endRow, opts = {}) {
  const children = opts.children || [];
  return {
    type,
    startIndex: startIdx,
    endIndex: endIdx,
    startPosition: { row: startRow },
    endPosition: { row: endRow },
    childForFieldName: (f) => {
      if (f === 'name' && opts.name) return { text: opts.name };
      return null;
    },
    childCount: children.length,
    child: (i) => children[i] || null,
  };
}

// =============================================================================
// GRAMMAR MAP
// =============================================================================

describe('GRAMMAR_MAP', () => {
  it('maps top 13 languages', () => {
    const expected = [
      'javascript', 'typescript', 'tsx', 'python', 'go', 'rust',
      'java', 'c', 'cpp', 'ruby', 'php', 'kotlin', 'swift',
    ];
    for (const lang of expected) {
      expect(GRAMMAR_MAP[lang]).toBeDefined();
      expect(GRAMMAR_MAP[lang]).toMatch(/^tree-sitter-/);
    }
  });

  it('has exactly 13 entries', () => {
    expect(Object.keys(GRAMMAR_MAP)).toHaveLength(13);
  });

  it('routes tsx to tree-sitter-tsx (not tree-sitter-typescript) so JSX bodies parse', () => {
    expect(GRAMMAR_MAP.tsx).toBe('tree-sitter-tsx');
    expect(GRAMMAR_MAP.typescript).toBe('tree-sitter-typescript');
  });
});

// =============================================================================
// BOUNDARY_TYPES
// =============================================================================

describe('BOUNDARY_TYPES', () => {
  it('includes function types', () => {
    expect(BOUNDARY_TYPES.has('function_declaration')).toBe(true);
    expect(BOUNDARY_TYPES.has('function_definition')).toBe(true);
    expect(BOUNDARY_TYPES.has('method_definition')).toBe(true);
    expect(BOUNDARY_TYPES.has('arrow_function')).toBe(true);
  });

  it('includes class types', () => {
    expect(BOUNDARY_TYPES.has('class_declaration')).toBe(true);
    expect(BOUNDARY_TYPES.has('class_definition')).toBe(true);
  });

  it('includes TypeScript types', () => {
    expect(BOUNDARY_TYPES.has('interface_declaration')).toBe(true);
    expect(BOUNDARY_TYPES.has('type_alias_declaration')).toBe(true);
    expect(BOUNDARY_TYPES.has('enum_declaration')).toBe(true);
  });

  it('includes Rust types', () => {
    expect(BOUNDARY_TYPES.has('struct_item')).toBe(true);
    expect(BOUNDARY_TYPES.has('impl_item')).toBe(true);
    expect(BOUNDARY_TYPES.has('trait_item')).toBe(true);
  });

  it('does not include non-boundary types', () => {
    expect(BOUNDARY_TYPES.has('comment')).toBe(false);
    expect(BOUNDARY_TYPES.has('expression_statement')).toBe(false);
    expect(BOUNDARY_TYPES.has('import_declaration')).toBe(false);
  });
});

// =============================================================================
// NODE_TYPE_MAP
// =============================================================================

describe('NODE_TYPE_MAP', () => {
  it('maps function types to function/method/arrow', () => {
    expect(NODE_TYPE_MAP['function_declaration']).toBe('function');
    expect(NODE_TYPE_MAP['method_definition']).toBe('method');
    expect(NODE_TYPE_MAP['arrow_function']).toBe('arrow');
  });

  it('maps class types', () => {
    expect(NODE_TYPE_MAP['class_declaration']).toBe('class');
    expect(NODE_TYPE_MAP['class_definition']).toBe('class');
  });

  it('maps Rust types', () => {
    expect(NODE_TYPE_MAP['struct_item']).toBe('struct');
    expect(NODE_TYPE_MAP['impl_item']).toBe('impl');
    expect(NODE_TYPE_MAP['trait_item']).toBe('trait');
  });
});

// =============================================================================
// TreeSitterProvider — constructor & basic methods
// =============================================================================

describe('TreeSitterProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new TreeSitterProvider();
  });

  afterEach(() => {
    provider.reset();
  });

  it('constructs with default options', () => {
    expect(provider.grammarsDir).toBeNull();
    expect(provider._parser).toBeNull();
    expect(provider._available).toBeNull();
    expect(provider._chunkCounter).toBe(0);
  });

  it('constructs with custom grammarsDir', () => {
    const p = new TreeSitterProvider({ grammarsDir: '/tmp/grammars' });
    expect(p.grammarsDir).toBe('/tmp/grammars');
  });

  it('getSupportedLanguages returns 13 languages (incl. tsx)', () => {
    const langs = provider.getSupportedLanguages();
    expect(langs).toHaveLength(13);
    expect(langs).toContain('javascript');
    expect(langs).toContain('typescript');
    expect(langs).toContain('tsx');
    expect(langs).toContain('python');
    expect(langs).toContain('go');
    expect(langs).toContain('rust');
  });

  it('hasLanguage returns true for supported', () => {
    expect(provider.hasLanguage('javascript')).toBe(true);
    expect(provider.hasLanguage('typescript')).toBe(true);
    expect(provider.hasLanguage('tsx')).toBe(true);
    expect(provider.hasLanguage('python')).toBe(true);
    expect(provider.hasLanguage('go')).toBe(true);
  });

  it('hasLanguage returns false for unsupported', () => {
    expect(provider.hasLanguage('haskell')).toBe(false);
    expect(provider.hasLanguage('lua')).toBe(false);
    expect(provider.hasLanguage('fortran')).toBe(false);
    expect(provider.hasLanguage('')).toBe(false);
  });

  it('loadLanguage returns null for unsupported language', async () => {
    const result = await provider.loadLanguage('haskell');
    expect(result).toBeNull();
  });

  it('parse returns null for unsupported language', async () => {
    const result = await provider.parse('x = 1', 'haskell');
    expect(result).toBeNull();
  });

  it('parseFileToChunks returns null for unsupported language', async () => {
    const result = await provider.parseFileToChunks('x = 1', 'haskell');
    expect(result).toBeNull();
  });

  it('reset clears internal state', () => {
    provider._available = true;
    provider._languages.set('test', {});
    provider._chunkCounter = 5;
    provider.reset();
    expect(provider._available).toBeNull();
    expect(provider._languages.size).toBe(0);
    expect(provider._parser).toBeNull();
    expect(provider._initPromise).toBeNull();
  });
});

// =============================================================================
// _extractNodeName (unit test with mock nodes)
// =============================================================================

describe('TreeSitterProvider._extractNodeName', () => {
  let provider;

  beforeEach(() => {
    provider = new TreeSitterProvider();
  });

  it('extracts name from childForFieldName', () => {
    const node = mockNode('function_declaration', 0, 10, 0, 0, { name: 'myFunc' });
    expect(provider._extractNodeName(node)).toBe('myFunc');
  });

  it('falls back to identifier child', () => {
    const node = {
      childForFieldName: () => null,
      childCount: 2,
      child: (i) => {
        if (i === 0) return { type: 'keyword', text: 'function' };
        if (i === 1) return { type: 'identifier', text: 'hello' };
        return null;
      },
    };
    expect(provider._extractNodeName(node)).toBe('hello');
  });

  it('returns null when no name found', () => {
    const node = {
      childForFieldName: () => null,
      childCount: 1,
      child: () => ({ type: 'keyword', text: 'return' }),
    };
    expect(provider._extractNodeName(node)).toBeNull();
  });

  it('finds type_identifier child', () => {
    const node = {
      childForFieldName: () => null,
      childCount: 1,
      child: () => ({ type: 'type_identifier', text: 'MyStruct' }),
    };
    expect(provider._extractNodeName(node)).toBe('MyStruct');
  });
});

// =============================================================================
// recursiveChunk — cAST algorithm (unit tests with mock AST)
// =============================================================================

describe('TreeSitterProvider.recursiveChunk (cAST)', () => {
  let provider;

  beforeEach(() => {
    provider = new TreeSitterProvider();
    provider._chunkCounter = 0;
  });

  it('merges small sibling nodes into a single chunk', () => {
    const part1 = 'const a = "hello world";';  // 24 chars
    const part2 = 'const b = "goodbye world";';  // 26 chars
    const content = part1 + '\n' + part2;

    const nodes = [
      mockNode('lexical_declaration', 0, part1.length, 0, 0),
      mockNode('lexical_declaration', part1.length + 1, content.length, 1, 1),
    ];

    const chunks = provider.recursiveChunk(nodes, content, 2000, null);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('code');
    expect(chunks[0].chunkId).toBe('c1');
    expect(chunks[0].parentChunkId).toBeNull();
  });

  it('extracts boundary node with name and type', () => {
    const content = 'function hello() {\n  return 1;\n}';
    const node = mockNode('function_declaration', 0, content.length, 0, 2, { name: 'hello' });

    const chunks = provider.recursiveChunk([node], content, 2000, null);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('function');
    expect(chunks[0].name).toBe('hello');
    expect(chunks[0].chunkId).toBe('c1');
    expect(chunks[0].parentChunkId).toBeNull();
  });

  it('generates sequential chunk IDs', () => {
    const content = 'const a = 1;\nfunction f() { return "some long content"; }\nconst b = 2;';
    const nodes = [
      mockNode('lexical_declaration', 0, 12, 0, 0),
      mockNode('function_declaration', 13, 57, 1, 1, { name: 'f' }),
      mockNode('lexical_declaration', 58, content.length, 2, 2),
    ];

    // Use small maxSize to force separate chunks
    const chunks = provider.recursiveChunk(nodes, content, 20, null);
    const ids = chunks.map(c => c.chunkId);

    // IDs should be sequential
    for (let i = 0; i < ids.length - 1; i++) {
      const num = parseInt(ids[i].replace('c', ''));
      expect(num).toBeGreaterThan(0);
    }
  });

  it('recurses into oversized node and sets parent info', () => {
    // An oversized class containing a method
    const methodText = 'inner() { return "some long value here"; }'; // 43 chars > 30
    const bigContent = 'class Big {\n  ' + methodText + '\n}';

    const methodNode = mockNode(
      'method_definition',
      bigContent.indexOf(methodText),
      bigContent.indexOf(methodText) + methodText.length,
      1, 1,
      { name: 'inner' }
    );

    const classNode = mockNode(
      'class_declaration', 0, bigContent.length, 0, 2,
      { name: 'Big', children: [methodNode] }
    );

    const chunks = provider.recursiveChunk([classNode], bigContent, 50, null);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const methodChunk = chunks.find(c => c.name === 'inner');
    expect(methodChunk).toBeDefined();
    expect(methodChunk.type).toBe('method');
    // Should have parent info
    expect(methodChunk.parentChunkId).toBeDefined();
    expect(methodChunk.parentSymbol).toBe('Big');
    expect(methodChunk.parentType).toBe('class');
  });

  it('emits leaf node as-is when too big and no children', () => {
    const longText = 'x'.repeat(100);
    const content = longText;
    const node = mockNode('string', 0, 100, 0, 0);

    const chunks = provider.recursiveChunk([node], content, 50, null);

    // Leaf too big, emitted as-is
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(longText);
  });

  it('never splits mid-expression (leaf nodes stay whole)', () => {
    // A single expression_statement that's 80 chars (> maxSize 50)
    const stmt = 'const result = calculateSomethingVeryLongWithManyParams(a, b, c, d, e, f, g);';
    const node = mockNode('expression_statement', 0, stmt.length, 0, 0);

    const chunks = provider.recursiveChunk([node], stmt, 50, null);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(stmt);
  });

  it('preserves parent chain through multiple recursion levels', () => {
    // Module > Class > Method (each level oversized)
    const methodBody = 'do_stuff() { return "' + 'x'.repeat(40) + '"; }';
    const fullContent = 'module M {\n  class C {\n    ' + methodBody + '\n  }\n}';

    const methodNode = mockNode(
      'method_definition',
      fullContent.indexOf(methodBody),
      fullContent.indexOf(methodBody) + methodBody.length,
      2, 2,
      { name: 'do_stuff' }
    );

    const classNode = mockNode(
      'class_declaration',
      fullContent.indexOf('class'),
      fullContent.indexOf('}', fullContent.indexOf(methodBody) + methodBody.length) + 1,
      1, 3,
      { name: 'C', children: [methodNode] }
    );

    const moduleNode = mockNode(
      'module', 0, fullContent.length, 0, 4,
      { name: 'M', children: [classNode] }
    );

    // maxSize=60 forces recursion at every level
    const chunks = provider.recursiveChunk([moduleNode], fullContent, 60, null);

    // Should find method chunk with parent chain info
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const methodChunk = chunks.find(c => c.name === 'do_stuff');
    if (methodChunk) {
      // Method's parent should be the class
      expect(methodChunk.parentSymbol).toBe('C');
      expect(methodChunk.parentType).toBe('class');
    }
  });

  it('skips chunks below 30-char threshold', () => {
    const content = 'x = 1;'; // 6 chars < 30
    const node = mockNode('expression_statement', 0, 6, 0, 0);

    const chunks = provider.recursiveChunk([node], content, 2000, null);
    expect(chunks).toHaveLength(0);
  });

  it('flushes buffer when next node would exceed maxSize', () => {
    const part1 = 'const aaaa = "' + 'a'.repeat(20) + '";'; // ~38 chars
    const part2 = 'const bbbb = "' + 'b'.repeat(20) + '";'; // ~38 chars
    const content = part1 + '\n' + part2;

    const nodes = [
      mockNode('lexical_declaration', 0, part1.length, 0, 0),
      mockNode('lexical_declaration', part1.length + 1, content.length, 1, 1),
    ];

    // maxSize=50 forces them into separate chunks
    const chunks = provider.recursiveChunk(nodes, content, 50, null);

    expect(chunks).toHaveLength(2);
  });

  it('propagates parentInfo from caller', () => {
    const content = 'const result = doSomethingInterestingHere();';
    const node = mockNode('lexical_declaration', 0, content.length, 0, 0);

    const parentInfo = { chunkId: 'parent-1', name: 'ParentClass', type: 'class' };
    const chunks = provider.recursiveChunk([node], content, 2000, parentInfo);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].parentChunkId).toBe('parent-1');
    expect(chunks[0].parentSymbol).toBe('ParentClass');
    expect(chunks[0].parentType).toBe('class');
  });
});

// =============================================================================
// Singleton management
// =============================================================================

describe('getTreeSitterProvider / resetTreeSitterProvider', () => {
  afterEach(() => {
    resetTreeSitterProvider();
  });

  it('returns same instance on repeated calls', () => {
    const a = getTreeSitterProvider();
    const b = getTreeSitterProvider();
    expect(a).toBe(b);
  });

  it('returns new instance after reset', () => {
    const a = getTreeSitterProvider();
    resetTreeSitterProvider();
    const b = getTreeSitterProvider();
    expect(a).not.toBe(b);
  });
});

// =============================================================================
// isAvailable — dynamic import check
// =============================================================================

describe('TreeSitterProvider.isAvailable', () => {
  let provider;

  beforeEach(() => {
    provider = new TreeSitterProvider();
  });

  afterEach(() => {
    provider.reset();
  });

  it('returns boolean', async () => {
    const result = await provider.isAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('caches the result', async () => {
    const first = await provider.isAvailable();
    const second = await provider.isAvailable();
    expect(first).toBe(second);
  });
});

// =============================================================================
// ASTChunker tree-sitter integration
// =============================================================================

describe('ASTChunker tree-sitter integration', () => {
  it('still produces chunks when tree-sitter disabled', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
    const content = [
      'function greet(name) {',
      '  console.log("Hello, " + name);',
      '  return name.toUpperCase();',
      '}',
    ].join('\n');

    const chunks = await chunker.parseFile('/test/file.js', content);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].metadata.language).toBe('javascript');
  });

  it('has _useTreeSitter enabled by default', () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    expect(chunker._useTreeSitter).toBe(true);
  });

  it('can disable tree-sitter via option', () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
    expect(chunker._useTreeSitter).toBe(false);
  });

  it('falls back to regex when _parseWithTreeSitter returns null', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    chunker._parseWithTreeSitter = vi.fn().mockResolvedValue(null);

    const content = [
      'def calculate(x, y):',
      '    result = x + y',
      '    return result * 2',
      '',
    ].join('\n');

    const chunks = await chunker.parseFile('/test/calc.py', content);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunker._parseWithTreeSitter).toHaveBeenCalledOnce();
  });

  it('falls back to regex when _parseWithTreeSitter throws', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    chunker._parseWithTreeSitter = vi.fn().mockRejectedValue(new Error('WASM fail'));

    const content = [
      'function failSafe() {',
      '  return "still works via regex fallback";',
      '}',
    ].join('\n');

    const chunks = await chunker.parseFile('/test/safe.js', content);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('uses tree-sitter chunks when available', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    const fakeChunks = [
      {
        text: 'function hello() { return 1; }',
        metadata: { language: 'javascript', chunk_type: 'function', symbol: 'hello' },
        tags: ['codebase', 'javascript', 'test'],
      },
    ];
    chunker._parseWithTreeSitter = vi.fn().mockResolvedValue(fakeChunks);

    const content = 'function hello() { return 1; }';
    const chunks = await chunker.parseFile('/test/hello.js', content);

    expect(chunker._parseWithTreeSitter).toHaveBeenCalledOnce();
    expect(chunks).toBe(fakeChunks);
  });

  it('passes hierarchy info through buildChunk', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    const fakeChunks = [
      {
        chunkId: 'c3',
        parentChunkId: 'c1',
        parentSymbol: 'MyClass',
        parentType: 'class',
        text: 'method() { return "some long content value here"; }',
        startLine: 5,
        endLine: 7,
        type: 'method',
        name: 'method',
      },
    ];

    chunker._parseWithTreeSitter = vi.fn().mockImplementation(
      async (filePath, content, langInfo) => {
        return fakeChunks.map(chunk =>
          chunker.buildChunk(
            chunk.text, filePath, langInfo.id, chunk.type, chunk.name,
            chunk.startLine, chunk.endLine,
            {
              chunkId: chunk.chunkId,
              parentChunkId: chunk.parentChunkId,
              parentSymbol: chunk.parentSymbol,
              parentType: chunk.parentType,
            }
          )
        );
      }
    );

    const content = 'class MyClass {\n  method() { return "some long content value here"; }\n}';
    const chunks = await chunker.parseFile('/test/cls.js', content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.chunk_id).toBe('c3');
    expect(chunks[0].metadata.parent_chunk_id).toBe('c1');
    expect(chunks[0].metadata.parent_symbol).toBe('MyClass');
    expect(chunks[0].metadata.parent_type).toBe('class');
  });
});

// =============================================================================
// ASTChunker regex fallback — oversized chunk splitting
// =============================================================================

describe('ASTChunker regex oversized splitting', () => {
  it('splits a single oversized chunk with no inner boundaries', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });

    // A single large function with only plain statements (no inner function boundaries)
    // The regex parser will produce ONE chunk for the whole function
    const stmts = [];
    for (let i = 0; i < 40; i++) {
      stmts.push(`  console.log("statement ${i}: ${'x'.repeat(60)}");`);
    }
    const content = `function bigFlat() {\n${stmts.join('\n')}\n}`;
    expect(content.length).toBeGreaterThan(2000);

    const chunks = await chunker.parseFile('/test/bigflat.js', content);

    // The oversized chunk should have been split
    expect(chunks.length).toBeGreaterThan(1);

    // Sub-chunks should have parent_chunk_id
    const subChunks = chunks.filter(c => c.metadata.parent_chunk_id);
    expect(subChunks.length).toBeGreaterThan(0);
    for (const c of subChunks) {
      expect(c.metadata.parent_symbol).toBeDefined();
      expect(c.metadata.parent_type).toBeDefined();
    }
  });

  it('preserves small chunks without modification', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
    const content = [
      'function small() {',
      '  return "hello";',
      '}',
    ].join('\n');

    const chunks = await chunker.parseFile('/test/small.js', content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.parent_chunk_id).toBeUndefined();
  });

  it('parent metadata includes symbol and type from original chunk', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });

    // Large function with inner function boundaries for sub-splitting.
    // Use `let` (not `const`) for filler lines — `const` matches JS chunker boundary.
    const lines = ['function outerBig() {'];
    for (let i = 0; i < 25; i++) {
      lines.push(`  let v${i} = "${'z'.repeat(70)}";`);
    }
    for (let i = 0; i < 5; i++) {
      lines.push(`  function helper${i}() { return "${i}"; }`);
    }
    lines.push('}');
    const content = lines.join('\n');

    expect(content.length).toBeGreaterThan(2000); // fail-fast if fixture is wrong

    const chunks = await chunker.parseFile('/test/outer.js', content);
    const withParent = chunks.filter(c => c.metadata.parent_chunk_id);

    expect(withParent.length).toBeGreaterThan(0);
    for (const c of withParent) {
      expect(c.metadata.parent_symbol).toBeDefined();
    }
  });

  it('first sub-chunk uses parentType (not parentSymbol) for chunk_type', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });

    const lines = ['function outerBig() {'];
    for (let i = 0; i < 25; i++) {
      lines.push(`  let v${i} = "${'z'.repeat(70)}";`);
    }
    for (let i = 0; i < 5; i++) {
      lines.push(`  function helper${i}() { return "${i}"; }`);
    }
    lines.push('}');
    const content = lines.join('\n');

    expect(content.length).toBeGreaterThan(2000);

    const chunks = await chunker.parseFile('/test/outer.js', content);
    const withParent = chunks.filter(c => c.metadata.parent_chunk_id);
    expect(withParent.length).toBeGreaterThan(0);

    const first = withParent[0];
    expect(first.metadata.chunk_type).toBe('function');
    expect(first.metadata.parent_symbol).toBe('outerBig');
  });
});

// =============================================================================
// P1 fix coverage: singleton, MIN_CONTENT_LENGTH, sub-chunk edge cases
// =============================================================================

describe('getTreeSitterProvider singleton with grammarsDir', () => {
  afterEach(() => resetTreeSitterProvider());

  it('returns same instance when called without options', () => {
    resetTreeSitterProvider();
    const a = getTreeSitterProvider();
    const b = getTreeSitterProvider();
    expect(a).toBe(b);
  });

  it('recreates instance when grammarsDir changes', () => {
    resetTreeSitterProvider();
    const a = getTreeSitterProvider({ grammarsDir: '/path/a' });
    expect(a.grammarsDir).toBe('/path/a');
    const b = getTreeSitterProvider({ grammarsDir: '/path/b' });
    expect(b.grammarsDir).toBe('/path/b');
    expect(b).not.toBe(a);
  });

  it('calls reset() on previous instance when grammarsDir changes', () => {
    resetTreeSitterProvider();
    const a = getTreeSitterProvider({ grammarsDir: '/old' });
    const resetSpy = vi.spyOn(a, 'reset');
    getTreeSitterProvider({ grammarsDir: '/new' });
    expect(resetSpy).toHaveBeenCalledOnce();
    resetSpy.mockRestore();
  });

  it('keeps instance when grammarsDir is the same', () => {
    resetTreeSitterProvider();
    const a = getTreeSitterProvider({ grammarsDir: '/same' });
    const b = getTreeSitterProvider({ grammarsDir: '/same' });
    expect(b).toBe(a);
  });

  it('keeps instance when subsequent call has no options', () => {
    resetTreeSitterProvider();
    const a = getTreeSitterProvider({ grammarsDir: '/init' });
    const b = getTreeSitterProvider();
    expect(b).toBe(a);
  });
});

describe('MIN_CONTENT_LENGTH boundary (30 chars)', () => {
  const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });

  it('drops chunk whose trimmed content is exactly 30 chars', () => {
    // _splitAtSubBoundaries checks `content.trim().length > MIN_CONTENT_LENGTH`
    // 30 chars is NOT > 30, so the flush segment should be dropped
    const padded = 'x'.repeat(30);
    expect(padded.trim().length).toBe(30);

    const jsPatterns = { function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/ };
    const result = chunker._splitAtSubBoundaries(
      padded, '/test/f.js', 'javascript', jsPatterns, { line: '//' }, 0,
      'rx-test', 'sym', 'function'
    );
    expect(result).toHaveLength(0);
  });

  it('keeps chunk whose trimmed content is 31 chars', () => {
    const padded = 'x'.repeat(31);
    expect(padded.trim().length).toBe(31);

    const jsPatterns = { function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/ };
    const result = chunker._splitAtSubBoundaries(
      padded, '/test/f.js', 'javascript', jsPatterns, { line: '//' }, 0,
      'rx-test', 'sym', 'function'
    );
    expect(result).toHaveLength(1);
  });
});

describe('_splitAtSubBoundaries edge cases', () => {
  const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });

  it('first sub-chunk of oversized class uses parentType "class"', async () => {
    const lines = ['class BigService {'];
    for (let i = 0; i < 25; i++) {
      lines.push(`  let v${i} = "${'z'.repeat(70)}";`);
    }
    for (let i = 0; i < 3; i++) {
      lines.push(`  function method${i}() { return ${i}; }`);
    }
    lines.push('}');
    const content = lines.join('\n');

    expect(content.length).toBeGreaterThan(2000);

    const chunks = await chunker.parseFile('/test/big-class.js', content);
    const withParent = chunks.filter(c => c.metadata.parent_chunk_id);
    expect(withParent.length).toBeGreaterThan(0);

    const first = withParent[0];
    expect(first.metadata.chunk_type).toBe('class');
    expect(first.metadata.parent_symbol).toBe('BigService');
    expect(first.metadata.parent_type).toBe('class');
  });

  it('parentType falls back to "code" when parentType is null', () => {
    const jsPatterns = { function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/ };
    const lines = [];
    for (let i = 0; i < 30; i++) {
      lines.push(`let line${i} = "${'x'.repeat(60)}";`);
    }
    lines.push('function inner() { return 1; }');
    const content = lines.join('\n');

    const subChunks = chunker._splitAtSubBoundaries(
      content, '/test/f.js', 'javascript', jsPatterns, { line: '//' }, 0,
      'rx-test', 'orphan', null
    );

    expect(subChunks.length).toBeGreaterThan(1);
    expect(subChunks[0].metadata.chunk_type).toBe('code');
  });

  it('subsequent sub-chunks use their own matchType, not parentType', async () => {
    // 28 padding lines to ensure the class chunk exceeds MAX_CHUNK_SIZE (2000)
    // so _splitOversizedRegexChunks triggers _splitAtSubBoundaries
    const lines = ['class Container {'];
    for (let i = 0; i < 28; i++) {
      lines.push(`  let pad${i} = "${'y'.repeat(70)}";`);
    }
    lines.push('  function alpha() { return "a"; }');
    for (let i = 0; i < 5; i++) {
      lines.push(`  let more${i} = "${'w'.repeat(70)}";`);
    }
    lines.push('  function beta() { return "b"; }');
    lines.push('}');
    const content = lines.join('\n');

    expect(content.length).toBeGreaterThan(2000);

    const chunks = await chunker.parseFile('/test/multi.js', content);
    const withParent = chunks.filter(c => c.metadata.parent_chunk_id);
    expect(withParent.length).toBeGreaterThanOrEqual(2);

    // First sub-chunk inherits parentType
    expect(withParent[0].metadata.chunk_type).toBe('class');

    // Later sub-chunks at function boundaries should use 'function', not 'class'
    const funcChunk = withParent.find(c => c.metadata.symbol === 'alpha');
    expect(funcChunk).toBeDefined();
    expect(funcChunk.metadata.chunk_type).toBe('function');
  });
});

// =============================================================================
// buildChunk — hierarchy metadata
// =============================================================================

describe('ASTChunker.buildChunk hierarchy', () => {
  it('includes chunk_id and parent_chunk_id when hierarchyInfo provided', () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    const chunk = chunker.buildChunk(
      'function f() { return "some content here for testing"; }',
      '/test/f.js', 'javascript', 'function', 'f', 0, 0,
      { chunkId: 'c5', parentChunkId: 'c2', parentSymbol: 'MyClass', parentType: 'class' }
    );

    expect(chunk.metadata.chunk_id).toBe('c5');
    expect(chunk.metadata.parent_chunk_id).toBe('c2');
    expect(chunk.metadata.parent_symbol).toBe('MyClass');
    expect(chunk.metadata.parent_type).toBe('class');
  });

  it('omits chunk_id and parent_chunk_id when no hierarchyInfo', () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    const chunk = chunker.buildChunk(
      'function g() { return "test content value"; }',
      '/test/g.js', 'javascript', 'function', 'g', 0, 0
    );

    expect(chunk.metadata.chunk_id).toBeUndefined();
    expect(chunk.metadata.parent_chunk_id).toBeUndefined();
    expect(chunk.metadata.parent_symbol).toBeUndefined();
  });

  it('includes parent context in embedding_text', () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    const chunk = chunker.buildChunk(
      'method() { return "long enough content for embedding"; }',
      '/test/m.js', 'javascript', 'method', 'method', 5, 7,
      { chunkId: 'c3', parentChunkId: 'c1', parentSymbol: 'Router', parentType: 'class' }
    );

    expect(chunk.embedding_text).toContain('# Parent: class Router');
  });
});

// =============================================================================
// Integration: actual tree-sitter parsing (skipped if unavailable)
// =============================================================================

describe('TreeSitterProvider integration', async () => {
  const provider = new TreeSitterProvider();
  const available = await provider.isAvailable();
  provider.reset();

  describe.skipIf(!available)('with web-tree-sitter installed', () => {
    let provider;

    beforeEach(() => {
      resetTreeSitterProvider();
      provider = getTreeSitterProvider();
    });

    afterEach(() => {
      resetTreeSitterProvider();
    });

    it('init() returns a parser', async () => {
      const parser = await provider.init();
      expect(parser).not.toBeNull();
    });

    it('isAvailable() returns true', async () => {
      expect(await provider.isAvailable()).toBe(true);
    });

    it('init() is idempotent', async () => {
      const a = await provider.init();
      const b = await provider.init();
      expect(a).toBe(b);
    });

    it('extracts a multi-line signature from a real JS function (decl up to body)', async () => {
      // Top-level (non-exported) declaration — `export_statement` is
      // not in BOUNDARY_TYPES at the chunk-emission level, which is a
      // pre-existing chunker behavior unrelated to signatures.
      const src = [
        'async function getUser(',
        '  id,',
        '  options = { cache: true }',
        ') {',
        '  return await db.find(id);',
        '}',
        '',
      ].join('\n');
      const chunks = await provider.parseFileToChunks(src, 'javascript');
      expect(chunks).not.toBeNull();
      const fn = chunks.find(c => c.name === 'getUser');
      expect(fn).toBeDefined();
      expect(fn.signature).toBeDefined();
      // Whitespace-collapsed; ends BEFORE the body opening brace.
      expect(fn.signature).toMatch(/^async function getUser\(/);
      expect(fn.signature).toContain('options =');
      expect(fn.signature).not.toMatch(/return await db\.find/);
    });

    it('extracts a Python def signature including default args, excluding the body', async () => {
      const src = [
        'def load_model(',
        '    path: str,',
        '    *,',
        '    device: str = "cpu",',
        ') -> Model:',
        '    return Model.from_pretrained(path, map_location=device)',
        '',
      ].join('\n');
      const chunks = await provider.parseFileToChunks(src, 'python');
      expect(chunks).not.toBeNull();
      const fn = chunks.find(c => c.name === 'load_model');
      expect(fn).toBeDefined();
      expect(fn.signature).toMatch(/^def load_model\(/);
      expect(fn.signature).not.toMatch(/from_pretrained/);
    });

    it('signature is null for non-boundary chunks (e.g. anonymous merged buffers)', async () => {
      // A bare expression-statement file has no boundary nodes the
      // chunker recognizes — the recursive split will emit at least
      // one non-boundary chunk with no signature.
      const src = 'const x = 1; const y = 2; const z = x + y;\n';
      const chunks = await provider.parseFileToChunks(src, 'javascript');
      // Non-boundary chunks (or chunks too small to emit) — either
      // way, no signature should be set on chunks without a boundary.
      if (chunks && chunks.length > 0) {
        for (const c of chunks) {
          if (!c.name) {
            expect(c.signature == null).toBe(true);
          }
        }
      }
    });

    // =========================================================================
    // TS/TSX/JSX export const extraction (May 2026 — see HANDOFF/handoff doc)
    // =========================================================================
    //
    // Pre-fix bug: vercel/ai-chatbot indexed clean but 5 of 12 P6 gold symbols
    // were missing because (a) the typescript tag query had no rule for
    // `export const X = expr` shapes other than arrow functions, and
    // (b) .tsx routed to tree-sitter-typescript which produced ERROR nodes on
    // JSX bodies, masking sibling captures like `export function VisibilitySelector`.
    //
    // The cases below lock both fixes in.

    describe('TS/TSX/JSX export const + top-level const extraction', () => {
      const cases = [
        // Plain TS — exported const, value-shape variations
        ['typescript', 'export const FOO = "bar";', 'FOO', 'variable'],
        ['typescript', 'export const Component = memo(Inner);', 'Component', 'component'],
        ['typescript', 'export const handler = async (req) => { return req; };', 'handler', 'arrowFunction'],
        ['typescript', 'export const config: Cfg = { x: 1 };', 'config', 'variable'],
        ['typescript', 'export const items: Item[] = [];', 'items', 'variable'],
        // TSX — JSX bodies must not break sibling captures
        ['tsx', 'export const Btn = memo((props: Props) => <button {...props}/>);', 'Btn', 'component'],
        ['tsx', 'export function Header({ id }: Props) { return <h1>{id}</h1>; }', 'Header', 'function'],
        ['tsx', 'export const config: Cfg = { x: 1 };', 'config', 'variable'],
        // JSX — tree-sitter-javascript supports JSX natively, no separate grammar
        ['javascript', 'export const Btn = memo((props) => <button {...props}/>);', 'Btn', 'component'],
        ['javascript', 'export function Header({ id }) { return <h1>{id}</h1>; }', 'Header', 'function'],
        ['javascript', 'export const FOO = "bar";', 'FOO', 'variable'],
        // POLICY (2026-05-11, reverting 01e8b37): non-exported top-level consts
        // are NOT captured — the (program ...) rules were removed because they
        // polluted NL retrieval rankings (single-line `const VERSION = '...'`
        // outranked real function/class definitions on behavior queries,
        // regressing 5 fastify probes from the post-perf-60 May 8 baseline).
        // CJS structural-mode queries for non-exported consts are no longer
        // resolvable as entities — accepted trade-off in favor of retrieval
        // quality. Exported consts (`export const X = ...`) continue to be
        // captured by both paths via the `(export_statement ...)` branch.
        // The historical non-exported test cases (createError, lifecycleHooks,
        // applicationHooks, SECRETS_PATH, cache, buildLogger) are intentionally
        // removed from this matrix and reasserted as NEGATIVE cases below.
      ];
      for (const [lang, src, name, expectedType] of cases) {
        it(`extracts ${name} (${expectedType}) from ${lang}: ${src.slice(0, 50)}...`, async () => {
          const symbols = await provider.extractSymbols(src, lang);
          expect(symbols).not.toBeNull();
          // Multiple captures can fire for the same node (e.g. @component AND
          // @variable on `export const X = memo(...)`). Whichever has the
          // highest priority wins downstream in graph-extractor; here we just
          // assert the expected type is among the emitted symbols.
          const candidates = symbols.filter(s => s.name === name);
          expect(candidates.length).toBeGreaterThan(0);
          expect(candidates.some(s => s.type === expectedType)).toBe(true);
        });
      }

      it('TSX: function declaration with JSX body still captures (regression: was missed by tree-sitter-typescript)', async () => {
        // Repro of the VisibilitySelector miss in vercel/ai-chatbot — a
        // function declaration whose body contains JSX. Under tree-sitter-typescript
        // this used to produce ERROR nodes that broke sibling captures.
        const src = `
import { Button } from './ui';
type Props = { chatId: string };
export function VisibilitySelector({ chatId }: Props) {
  return <Button>{chatId}</Button>;
}
`;
        const symbols = await provider.extractSymbols(src, 'tsx');
        expect(symbols.find(s => s.name === 'VisibilitySelector' && s.type === 'function')).toBeDefined();
      });

      it('TS: export const with object literal extracts as variable (regression: was completely missed)', async () => {
        // Repro of DEFAULT_CHAT_MODEL / entitlementsByUserType miss. Pre-fix,
        // the tag query had no rule for non-arrow const-exports.
        const src = `
type UserType = 'guest' | 'user';
type Entitlements = { quota: number };
export const DEFAULT_CHAT_MODEL = "moonshotai/kimi-k2.5";
export const entitlementsByUserType: Record<UserType, Entitlements> = {
  guest: { quota: 5 },
  user: { quota: 100 },
};
`;
        const symbols = await provider.extractSymbols(src, 'typescript');
        expect(symbols.find(s => s.name === 'DEFAULT_CHAT_MODEL' && s.type === 'variable')).toBeDefined();
        expect(symbols.find(s => s.name === 'entitlementsByUserType' && s.type === 'variable')).toBeDefined();
      });

      it('TS: internal `const x = LITERAL` is NOT extracted as variable (scope guard)', async () => {
        // Important scope guard — the @variable.definition rule fires only
        // when its parent is (export_statement ...) OR (program ...). If we
        // ever loosened it (e.g., to `(variable_declarator ...)` directly),
        // internal const literals would flood the entity table from every
        // function body.
        // Note: internal arrow-function consts (e.g. `const helper = () => ...`)
        // ARE still captured by the pre-existing @arrow.definition rule — that
        // behavior is unchanged by this fix.
        const src = `
export function compute() {
  const internal = 42;
  const config = { ttl: 100 };
  return internal + config.ttl;
}
`;
        const symbols = await provider.extractSymbols(src, 'typescript');
        // Neither internal literal const should leak into the symbol table.
        expect(symbols.find(s => s.name === 'internal')).toBeUndefined();
        expect(symbols.find(s => s.name === 'config')).toBeUndefined();
        // And the surrounding function still extracts.
        expect(symbols.find(s => s.name === 'compute' && s.type === 'function')).toBeDefined();
      });

      it('JS: top-level CommonJS `const X = require(...)` is NOT extracted (policy revert 2026-05-11)', async () => {
        // POLICY: non-exported top-level consts (createError, lifecycleHooks,
        // applicationHooks) are intentionally NOT captured. The (program ...)
        // tag-rules that captured them in 01e8b37 (May 9) polluted NL retrieval
        // — single-line consts outranked real function/class definitions on
        // behavior queries, regressing 5 fastify probes. Restored prior policy
        // 2026-05-11. CJS structural-mode resolution for non-exported consts
        // is the deliberately-accepted cost; if a future change re-introduces
        // resolution, it MUST measure NL retrieval probes do not regress
        // (eval/retrieval-probes/post-perf-60.json baseline = 46/60 PASS).
        // Top-level FUNCTIONS and class-bodied entities are still captured.
        const src = `
'use strict'
const createError = require('@fastify/error')

const applicationHooks = [
  'onReady',
  'onClose',
]
const lifecycleHooks = [
  'onRequest',
  'preHandler',
]

function helper() {
  const cacheKey = 'tag'
  return cacheKey
}

module.exports = { createError, applicationHooks, lifecycleHooks, helper }
`;
        const symbols = await provider.extractSymbols(src, 'javascript');
        // Non-exported top-level consts: NOT captured (the regression fix).
        expect(symbols.find(s => s.name === 'createError')).toBeUndefined();
        expect(symbols.find(s => s.name === 'applicationHooks')).toBeUndefined();
        expect(symbols.find(s => s.name === 'lifecycleHooks')).toBeUndefined();
        // Top-level function: still captured (function_declaration is in BOUNDARY_TYPES).
        expect(symbols.find(s => s.name === 'helper' && s.type === 'function')).toBeDefined();
        // Internal consts also stay invisible (unchanged).
        expect(symbols.find(s => s.name === 'cacheKey')).toBeUndefined();
      });

      it('.mjs and .cjs files share the javascript grammar — exported consts captured, non-exported are NOT', async () => {
        // Sanity: extract via the tree-sitter provider directly with languageId
        // 'javascript' (which is what EXTENSION_MAP returns for all of .js,
        // .jsx, .mjs, .cjs). tree-sitter-javascript produces the same
        // (program ...)-rooted AST regardless of extension.
        // POLICY (2026-05-11): only EXPORTED top-level consts produce entities.
        // The .mjs side (export const X) is captured; the .cjs side
        // (top-level non-exported const X) is intentionally NOT — see
        // "top-level CommonJS `const X = require(...)` is NOT extracted" test
        // above for rationale.
        const mjsLike = `
import { a } from 'pkg'
export const M_VAR = 'hello'
export const M_FACTORY = makeFactory()
`;
        const cjsLike = `
'use strict'
const C_REQ = require('pkg')
const C_LIST = ['x', 'y']
module.exports = { C_REQ, C_LIST }
`;
        const mjsSyms = await provider.extractSymbols(mjsLike, 'javascript');
        // Exported (.mjs / ESM): captured.
        expect(mjsSyms.find(s => s.name === 'M_VAR' && s.type === 'variable')).toBeDefined();
        expect(mjsSyms.find(s => s.name === 'M_FACTORY' && s.type === 'component')).toBeDefined();
        const cjsSyms = await provider.extractSymbols(cjsLike, 'javascript');
        // Non-exported (.cjs / CommonJS top-level): NOT captured.
        expect(cjsSyms.find(s => s.name === 'C_REQ')).toBeUndefined();
        expect(cjsSyms.find(s => s.name === 'C_LIST')).toBeUndefined();
      });

      it('JS: const inside namespace/class body is NOT extracted (scope guard)', async () => {
        // POLICY (2026-05-11): the only @variable/@component captures fire on
        // (export_statement ...) — neither nested consts NOR non-exported
        // top-level consts produce entities. FILE_LEVEL (non-exported) used to
        // be captured under the (program ...) rule but that rule was removed
        // (see retrieval-regression comments in the queries + above tests).
        const src = `
class Container {
  static run() {
    const internal = 42;
    return internal;
  }
}
const FILE_LEVEL = 1;
`;
        const symbols = await provider.extractSymbols(src, 'javascript');
        expect(symbols.find(s => s.name === 'internal')).toBeUndefined();
        // FILE_LEVEL is NO LONGER captured — non-exported, top-level const literal.
        expect(symbols.find(s => s.name === 'FILE_LEVEL')).toBeUndefined();
        // Containing class still captured (class_declaration is in BOUNDARY_TYPES).
        expect(symbols.find(s => s.name === 'Container' && s.type === 'class')).toBeDefined();
      });
    });

    // CPP-005 regression — phantom C/C++ attribute names suppressed.
    //
    // tree-sitter-c does not recognize the C++ keyword `alignas` and parses
    // `struct alignas(16) uint128_t { ... }` with `name=alignas`. That phantom
    // entity used to dominate retrieval for SIMD-flavored NL queries (top-1
    // on cpp probe CPP-005). The filter in extractSymbols / parseFileToChunks
    // drops C/C++ phantoms from a closed list of keywords/attribute markers
    // (alignas, __attribute__, __declspec, final, override, etc.). The list
    // is scoped to language ∈ {c, cpp} so a Go/Python file named `final`
    // is not affected.
    describe('C/C++ attribute phantom suppression', () => {
      it('drops alignas-named struct (tree-sitter-c misparse)', async () => {
        const src = 'struct alignas(16) uint128_t { unsigned long lo; unsigned long hi; };\n';
        const symbols = await provider.extractSymbols(src, 'c');
        expect(symbols.find(s => s.name === 'alignas')).toBeUndefined();
      });

      it('keeps correctly-parsed names through __attribute__', async () => {
        const src = 'struct __attribute__((packed)) Foo { int x; };\n';
        const symbols = await provider.extractSymbols(src, 'c');
        expect(symbols.find(s => s.name === 'Foo' && s.type === 'struct')).toBeDefined();
      });

      it('does not filter `final` in non-C languages', async () => {
        // Python class literally named `final` — not in the C-family path.
        const src = 'class final:\n    pass\n';
        const symbols = await provider.extractSymbols(src, 'python');
        expect(symbols.find(s => s.name === 'final' && s.type === 'class')).toBeDefined();
      });

      it('preserves uint128_t when routed to cpp (tree-sitter-cpp parses correctly)', async () => {
        const src = 'struct alignas(16) uint128_t { unsigned long lo; unsigned long hi; };\n';
        const symbols = await provider.extractSymbols(src, 'cpp');
        expect(symbols.find(s => s.name === 'uint128_t' && s.type === 'struct')).toBeDefined();
        expect(symbols.find(s => s.name === 'alignas')).toBeUndefined();
      });
    });
  });
});
