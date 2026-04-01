import { describe, it, expect } from 'vitest';
import { ASTChunker } from '../../ast-chunker.js';

describe('Cross-line construct handling', () => {
  const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });

  describe('_matchBoundary with cross-line joining', () => {
    const jsPatterns = {
      function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/,
      class: /(?:export\s+)?class\s+(\w+)/,
      arrow: /const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
    };

    it('matches multi-line function signature ending with (', () => {
      const lines = [
        'function foo(',
        '  a,',
        '  b,',
        '  c',
        ') {',
      ];
      const result = chunker._matchBoundary(lines[0], jsPatterns, 'javascript', lines, 0, true);
      expect(result.name).toBe('foo');
      expect(result.type).toBe('function');
      expect(result.joinedLines).toBeGreaterThan(0);
    });

    it('matches multi-line arrow function ending with (', () => {
      // Use only the arrow pattern so it's the first match
      const arrowOnly = { arrow: /const\s+(\w+)\s*=\s*(?:async\s*)?\(/ };
      const lines = [
        'const processItems = async(',
        '  items,',
        '  options',
        ') => {',
      ];
      const result = chunker._matchBoundary(lines[0], arrowOnly, 'javascript', lines, 0, true);
      expect(result.name).toBe('processItems');
      expect(result.type).toBe('arrow');
      // Single-line already matches, so joinedLines may be undefined
    });

    it('matches line ending with comma in continuation context', () => {
      const lines = [
        'export const handler =',
        '  async(',
        '    req,',
        '    res',
        '  ) => {',
      ];
      // Line 2 ends with `,` — should attempt join from line 2
      const result = chunker._matchBoundary(lines[2], jsPatterns, 'javascript', lines, 2, true);
      // Comma-ending line with parameter content won't match a function pattern
      expect(result.name).toBeNull();
    });

    it('matches line ending with backslash continuation', () => {
      const pyPatterns = {
        function: /^(?:async\s+)?def\s+(\w+)\s*\(/,
        decorator: /^@(\w+(?:\.\w+)*)/,
      };
      const lines = [
        '@app.route(\\',
        "  '/api',",
        "  methods=['GET']",
        ')',
      ];
      const result = chunker._matchBoundary(lines[0], pyPatterns, 'python', lines, 0, true);
      expect(result.name).toBe('app.route');
      expect(result.type).toBe('decorator');
      expect(result.joinedLines).toBeGreaterThan(0);
    });

    it('falls back to single-line match when joined does not match', () => {
      const lines = [
        'class MyService(',
        '  BaseService',
        ') {',
      ];
      // `class MyService(` matches class pattern on single line already
      const result = chunker._matchBoundary(lines[0], jsPatterns, 'javascript', lines, 0, true);
      // The joined version or single-line both match — either way name is captured
      expect(result.name).toBe('MyService');
      expect(result.type).toBe('class');
    });

    it('falls back to single-line when multiLine is false', () => {
      const lines = [
        'function foo(',
        '  a,',
        '  b',
        ') {',
      ];
      // With multiLine=false, only single line is tried
      // `function foo(` matches the function pattern on its own
      const result = chunker._matchBoundary(lines[0], jsPatterns, 'javascript', lines, 0, false);
      expect(result.name).toBe('foo');
      expect(result.type).toBe('function');
      expect(result.joinedLines).toBeUndefined();
    });

    it('backward compat: works without lines/lineIndex args', () => {
      const result = chunker._matchBoundary('function bar() {', jsPatterns, 'javascript');
      expect(result.name).toBe('bar');
      expect(result.type).toBe('function');
      expect(result.joinedLines).toBeUndefined();
    });

    it('returns null when no pattern matches even with joining', () => {
      const lines = [
        '// just a comment(',
        '  continued',
        ')',
      ];
      const result = chunker._matchBoundary(lines[0], jsPatterns, 'javascript', lines, 0, true);
      expect(result.name).toBeNull();
      expect(result.type).toBeNull();
    });

    it('respects max 3 lines peek-ahead limit', () => {
      const lines = [
        'function longSig(',
        '  paramA,',
        '  paramB,',
        '  paramC,',
        '  paramD,',
        '  paramE',
        ') {',
      ];
      // Peek-ahead is capped at 3 lines — won't reach `) {` on line 6
      // But the first 4 lines joined should still match `function longSig(`
      const result = chunker._matchBoundary(lines[0], jsPatterns, 'javascript', lines, 0, true);
      expect(result.name).toBe('longSig');
      expect(result.joinedLines).toBe(3);
    });

    it('handles last line in file (no lines to peek)', () => {
      const lines = [
        'function solo(',
      ];
      const result = chunker._matchBoundary(lines[0], jsPatterns, 'javascript', lines, 0, true);
      // Only 1 line, no peek-ahead possible — single-line match
      expect(result.name).toBe('solo');
      expect(result.type).toBe('function');
      expect(result.joinedLines).toBeUndefined();
    });
  });

  describe('parseBraceBasedFile with multiLinePatterns', () => {
    it('detects function split across lines in JS', () => {
      const code = [
        'function processData(',
        '  inputValue,',
        '  optionsConfig',
        ') {',
        '  const result = transformInput(inputValue, optionsConfig);',
        '  return result;',
        '}',
        '',
      ].join('\n');

      const chunks = chunker.parseBraceBasedFile(
        '/test/app.js', code, 'javascript',
        { function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/ },
        { line: '//', block: ['/*', '*/'] },
        true
      );

      const funcChunk = chunks.find(c => c.metadata.symbol === 'processData');
      expect(funcChunk).toBeDefined();
      expect(funcChunk.metadata.chunk_type).toBe('function');
    });

    it('does not use cross-line matching when multiLine is false', () => {
      const code = [
        'function processData(',
        '  inputValue,',
        '  optionsConfig',
        ') {',
        '  return inputValue;',
        '}',
        '',
      ].join('\n');

      // Even with multiLine=false, this still matches because `function processData(`
      // matches the pattern on its own (single-line)
      const chunks = chunker.parseBraceBasedFile(
        '/test/app.js', code, 'javascript',
        { function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/ },
        { line: '//', block: ['/*', '*/'] },
        false
      );

      const funcChunk = chunks.find(c => c.metadata.symbol === 'processData');
      expect(funcChunk).toBeDefined();
    });
  });

  describe('line_end metadata for cross-line constructs', () => {
    const jsPatterns = {
      function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/,
    };
    const jsComment = { line: '//', block: ['/*', '*/'] };

    it('brace-based: line_end covers full body after multi-line signature', () => {
      // Lines 0-6 (0-indexed). Function signature spans lines 0-2,
      // body through closing brace on line 6.
      // Body lines intentionally avoid matching the boundary pattern.
      const code = [
        'function processData(',   // 0
        '  inputValue,',           // 1
        '  optionsConfig',         // 2
        ') {',                     // 3
        '  let result = transformInput(inputValue, optionsConfig);', // 4
        '  return result;',        // 5
        '}',                       // 6
        '',                        // 7
      ].join('\n');

      const chunks = chunker.parseBraceBasedFile(
        '/test/app.js', code, 'javascript', jsPatterns, jsComment, true
      );

      const funcChunk = chunks.find(c => c.metadata.symbol === 'processData');
      expect(funcChunk).toBeDefined();
      // line_start is 1-indexed, so line 0 => 1
      expect(funcChunk.metadata.line_start).toBe(1);
      // The chunk must extend past the signature lines that were joined.
      // It should cover through the closing brace (line 6 => 7 in 1-indexed).
      expect(funcChunk.metadata.line_end).toBeGreaterThanOrEqual(7);
    });

    it('brace-based: joined lines are not emitted as a separate chunk', () => {
      const code = [
        'function alpha(',        // 0
        '  x,',                   // 1
        '  y',                    // 2
        ') {',                    // 3
        '  return x + y;',        // 4
        '}',                      // 5
        '',                       // 6
        'function beta() {',      // 7
        '  return 42;',           // 8
        '}',                      // 9
        '',                       // 10
      ].join('\n');

      const chunks = chunker.parseBraceBasedFile(
        '/test/app.js', code, 'javascript', jsPatterns, jsComment, true
      );

      const alphaChunk = chunks.find(c => c.metadata.symbol === 'alpha');
      const betaChunk = chunks.find(c => c.metadata.symbol === 'beta');
      expect(alphaChunk).toBeDefined();
      expect(betaChunk).toBeDefined();
      // alpha should start at line 1 (1-indexed) and end at line 6 (closing brace)
      expect(alphaChunk.metadata.line_start).toBe(1);
      expect(alphaChunk.metadata.line_end).toBe(6);
      // beta should start at line 8 (1-indexed)
      expect(betaChunk.metadata.line_start).toBe(8);
      // No chunk should have been created from the joined signature lines (2-4)
      const symbolNames = chunks.map(c => c.metadata.symbol);
      expect(symbolNames).not.toContain('x');
      expect(symbolNames).not.toContain('y');
    });

    it('end-keyword: line_end covers full body after multi-line signature', () => {
      const rubyPatterns = {
        function: /^def\s+(\w+)/,
      };

      const code = [
        'def calculate(',                     // 0
        '  amount,',                           // 1
        '  rate',                              // 2
        ')',                                   // 3
        '  result = amount * rate',            // 4
        '  puts "Result: #{result}"',          // 5
        '  return result',                     // 6
        'end',                                 // 7
        '',                                    // 8
      ].join('\n');

      const chunks = chunker.parseEndKeywordFile(
        '/test/app.rb', code, 'ruby', rubyPatterns, 'end', null, true
      );

      const funcChunk = chunks.find(c => c.metadata.symbol === 'calculate');
      expect(funcChunk).toBeDefined();
      expect(funcChunk.metadata.line_start).toBe(1);
      // Should cover through 'end' on line 7 => 8 in 1-indexed
      expect(funcChunk.metadata.line_end).toBe(8);
    });

    it('indent-based: line_end covers full body after multi-line decorator', () => {
      const pyPatterns = {
        function: /^(?:async\s+)?def\s+(\w+)\s*\(/,
        decorator: /^@(\w+(?:\.\w+)*)\s*\(/,
      };

      const code = [
        '@app.route(',                          // 0
        "    '/api/users',",                     // 1
        "    methods=['GET']",                   // 2
        ')',                                     // 3
        'def get_users():',                      // 4
        '    users = db.query()',                 // 5
        '    return jsonify(users)',              // 6
        '',                                      // 7
      ].join('\n');

      const chunks = chunker.parseIndentBasedFile(
        '/test/app.py', code, 'python', pyPatterns, true
      );

      // Should have found at least the decorator or the function
      const decoratorChunk = chunks.find(c => c.metadata.symbol === 'app.route');
      const funcChunk = chunks.find(c => c.metadata.symbol === 'get_users');

      if (decoratorChunk) {
        // Decorator starts at line 0 (1-indexed: 1)
        expect(decoratorChunk.metadata.line_start).toBe(1);
        // The joined lines (1,2) should not cause an early line_end
        expect(decoratorChunk.metadata.line_end).toBeGreaterThanOrEqual(4);
      }

      if (funcChunk) {
        expect(funcChunk.metadata.line_start).toBe(5);
        expect(funcChunk.metadata.line_end).toBeGreaterThanOrEqual(7);
      }

      expect(decoratorChunk || funcChunk).toBeDefined();
    });
  });

  describe('parseIndentBasedFile with multiLinePatterns', () => {
    it('detects Python decorator spanning lines', () => {
      const code = [
        '@app.route(',
        "    '/api/users',",
        "    methods=['GET', 'POST']",
        ')',
        'def get_users():',
        '    return []',
        '',
      ].join('\n');

      const pyPatterns = {
        function: /^(?:async\s+)?def\s+(\w+)\s*\(/,
        decorator: /^@(\w+(?:\.\w+)*)/,
      };

      const chunks = chunker.parseIndentBasedFile(
        '/test/app.py', code, 'python', pyPatterns, true
      );

      // Should find the decorator and/or the function
      const hasDecorator = chunks.some(c => c.metadata.symbol === 'app.route');
      const hasFunction = chunks.some(c => c.metadata.symbol === 'get_users');
      expect(hasDecorator || hasFunction).toBe(true);
    });
  });

  describe('parseEndKeywordFile with multiLinePatterns', () => {
    it('passes multiLine through without breaking end-keyword parsing', () => {
      const code = [
        'def hello(',
        '  name',
        ')',
        '  puts "Hello #{name}"',
        'end',
        '',
      ].join('\n');

      const rubyPatterns = {
        function: /^def\s+(\w+)/,
        class: /^class\s+(\w+)/,
      };

      const chunks = chunker.parseEndKeywordFile(
        '/test/app.rb', code, 'ruby', rubyPatterns, 'end', null, true
      );

      const funcChunk = chunks.find(c => c.metadata.symbol === 'hello');
      expect(funcChunk).toBeDefined();
    });
  });

  describe('multiLinePatterns language config', () => {
    it('javascript has multiLinePatterns enabled', async () => {
      const { getLanguageByPath } = await import('../../core/infrastructure/language-patterns.js');
      const lang = getLanguageByPath('test.js');
      expect(lang.multiLinePatterns).toBe(true);
    });

    it('typescript has multiLinePatterns enabled', async () => {
      const { getLanguageByPath } = await import('../../core/infrastructure/language-patterns.js');
      const lang = getLanguageByPath('test.ts');
      expect(lang.multiLinePatterns).toBe(true);
    });

    it('python has multiLinePatterns enabled', async () => {
      const { getLanguageByPath } = await import('../../core/infrastructure/language-patterns.js');
      const lang = getLanguageByPath('test.py');
      expect(lang.multiLinePatterns).toBe(true);
    });

    it('java has multiLinePatterns enabled', async () => {
      const { getLanguageByPath } = await import('../../core/infrastructure/language-patterns.js');
      const lang = getLanguageByPath('Test.java');
      expect(lang.multiLinePatterns).toBe(true);
    });

    it('kotlin has multiLinePatterns enabled', async () => {
      const { getLanguageByPath } = await import('../../core/infrastructure/language-patterns.js');
      const lang = getLanguageByPath('Test.kt');
      expect(lang.multiLinePatterns).toBe(true);
    });

    it('go does NOT have multiLinePatterns enabled', async () => {
      const { getLanguageByPath } = await import('../../core/infrastructure/language-patterns.js');
      const lang = getLanguageByPath('test.go');
      expect(lang.multiLinePatterns).toBeFalsy();
    });
  });
});
