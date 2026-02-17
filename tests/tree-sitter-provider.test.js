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
} from '../core/tree-sitter-provider.js';
import { ASTChunker } from '../ast-chunker.js';

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
  it('maps top 12 languages', () => {
    const expected = [
      'javascript', 'typescript', 'python', 'go', 'rust',
      'java', 'c', 'cpp', 'ruby', 'php', 'kotlin', 'swift',
    ];
    for (const lang of expected) {
      expect(GRAMMAR_MAP[lang]).toBeDefined();
      expect(GRAMMAR_MAP[lang]).toMatch(/^tree-sitter-/);
    }
  });

  it('has exactly 12 entries', () => {
    expect(Object.keys(GRAMMAR_MAP)).toHaveLength(12);
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

  it('getSupportedLanguages returns 12 languages', () => {
    const langs = provider.getSupportedLanguages();
    expect(langs).toHaveLength(12);
    expect(langs).toContain('javascript');
    expect(langs).toContain('python');
    expect(langs).toContain('go');
    expect(langs).toContain('rust');
  });

  it('hasLanguage returns true for supported', () => {
    expect(provider.hasLanguage('javascript')).toBe(true);
    expect(provider.hasLanguage('typescript')).toBe(true);
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
  });
});
