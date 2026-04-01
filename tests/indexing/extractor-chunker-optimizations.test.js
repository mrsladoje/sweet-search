import { describe, it, expect } from 'vitest';
import GraphExtractor from '../../core/graph/graph-extractor.js';
import { ASTChunker } from '../../ast-chunker.js';

describe('extractor/chunker optimization guards', () => {
  it('reuses cached methodCall regex per language', async () => {
    const extractor = new GraphExtractor({ projectRoot: '/test' });

    await extractor.extractFromFile('/test/a.py', [
      'def run_a():',
      '    client.call()',
    ].join('\n'));

    const firstCacheSize = extractor.methodCallRegexCache.size;
    expect(firstCacheSize).toBeGreaterThan(0);

    await extractor.extractFromFile('/test/b.py', [
      'def run_b():',
      '    client.call()',
    ].join('\n'));

    expect(extractor.methodCallRegexCache.size).toBe(firstCacheSize);
  });

  it('tracks empty-capture drops for generic entity patterns', () => {
    const extractor = new GraphExtractor({ projectRoot: '/test' });
    const lines = ['class Service'];
    const langInfo = {
      id: 'testlang',
      indentBased: false,
      endKeyword: null,
      blockKeywords: null,
      graph: {
        entities: {
          badEntity: /^class\s+\w+/,
        },
        relationships: {},
        skipCallObjects: [],
      },
    };

    extractor.extractGeneric(lines.join('\n'), lines, '/test/service.tl', langInfo);
    const counters = extractor.getDebugCounters();

    expect(counters.emptyCapture.entity).toBe(1);
    expect(counters.byLanguage.testlang.entity).toBe(1);
    expect(counters.byPattern['testlang:entity:badEntity']).toBe(1);
  });

  it('tracks empty-capture drops for chunk boundary patterns', () => {
    const chunker = new ASTChunker({ projectRoot: '/test' });
    const boundary = chunker._matchBoundary('function run() {', {
      badBoundary: /^function\s+\w+\s*\(/,
    }, 'javascript');

    expect(boundary.name).toBeNull();
    expect(boundary.type).toBeNull();

    const counters = chunker.getDebugCounters();
    expect(counters.emptyCapture.boundary).toBe(1);
    expect(counters.byLanguage.javascript.boundary).toBe(1);
    expect(counters.byPattern['javascript:boundary:badBoundary']).toBe(1);
  });

  it('skips regex extraction on excessively long lines', async () => {
    const extractor = new GraphExtractor({ projectRoot: '/test', maxRegexLineLength: 40, useTreeSitter: false });
    const result = await extractor.extractFromFile('/test/app.py', [
      `import ${'module,'.repeat(20)}tail`,
      'def run():',
      '    return 1',
    ].join('\n'));

    expect(result.relationships.some(r => r.type === 'imports')).toBe(false);
    const counters = extractor.getDebugCounters();
    expect(counters.skippedLongLines).toBe(1);
    expect(counters.byLanguage.python.skippedLongLines).toBe(1);
  });

  it('skips chunk boundary regex on excessively long lines', () => {
    const chunker = new ASTChunker({ projectRoot: '/test', maxRegexLineLength: 20 });
    const line = `function ${'a'.repeat(40)}() {`;
    const boundary = chunker._matchBoundary(line, {
      function: /^function\s+(\w+)\s*\(/,
    }, 'javascript');

    expect(boundary.name).toBeNull();
    expect(boundary.type).toBeNull();
    const counters = chunker.getDebugCounters();
    expect(counters.skippedLongLines).toBe(1);
    expect(counters.byLanguage.javascript.skippedLongLines).toBe(1);
  });
});
