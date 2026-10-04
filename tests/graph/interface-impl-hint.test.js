// A call through an interface-typed field (`_replacer.Replace`) names only the interface.
// ss-read names the class that implements it (r3-ocelot-03: every rollout that reached the
// call stopped at the interface), and ss-trace resolves a name that `--in <file>` only calls
// and labels an implementing class as `(implements)`, not `call@`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';
import { StructuralContextBuilder, formatStructuralContext } from '../../core/graph/structural-context.js';
import { readFile, renderInterfaceImpls, selectInterfaceCalls } from '../../core/search/search-read.js';

const FILES = {
  'src/IReplacer.cs': [
    'namespace Demo;',
    'public interface IReplacer',
    '{',
    '    string Replace(string template);',
    '}',
  ].join('\n'),
  'src/Replacer.cs': [
    'namespace Demo;',
    'public class Replacer : IReplacer',
    '{',
    '    public string Replace(string template)',
    '    {',
    '        return template.Trim();',
    '    }',
    '}',
  ].join('\n'),
  'src/Middleware.cs': [
    'namespace Demo;',
    'public class Middleware',
    '{',
    '    private readonly IReplacer _replacer;',
    '    public Middleware(IReplacer replacer)',
    '    {',
    '        _replacer = replacer;',
    '    }',
    '    public string Invoke(string template)',
    '    {',
    '        var path = _replacer.Replace(template);',
    '        return path;',
    '    }',
    '}',
  ].join('\n'),
  'tests/FakeReplacerTests.cs': [
    'namespace Demo.Tests;',
    'public class FakeReplacer : IReplacer',
    '{',
    '    public string Replace(string template) => template;',
    '}',
  ].join('\n'),
};

describe('interface calls: ss-read names the implementation, ss-trace resolves and labels it', () => {
  let projectRoot;
  let dbPath;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-impl-hint-'));
    for (const dir of ['src', 'tests', '.sweet-search']) mkdirSync(join(projectRoot, dir), { recursive: true });
    for (const [file, source] of Object.entries(FILES)) writeFileSync(join(projectRoot, file), source);
    dbPath = join(projectRoot, '.sweet-search', 'code-graph.db');
    const db = new Database(dbPath);
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor();
      for (const [file, source] of Object.entries(FILES)) {
        const out = await extractor.extractFromFile(file, source);
        insertGraph(db, out.entities, out.relationships, fts, { syncFts: false, callSites: out.callSites || [], files: [out.file] });
      }
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
      db.close();
    }
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('finds the implementation of an interface call in a line range, test doubles included', () => {
    const repo = new CodeGraphRepository(dbPath);
    const rows = repo.findInterfaceCallImplementations('src/Middleware.cs', 9, 13);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 11, call: '_replacer.Replace', target: 'IReplacer.Replace' });
    expect(rows[0].impls.map(i => `${i.owner}.${i.name}@${i.filePath}`).sort()).toEqual([
      'FakeReplacer.Replace@tests/FakeReplacerTests.cs',
      'Replacer.Replace@src/Replacer.cs',
    ]);
    expect(repo.findInterfaceCallImplementations('src/Middleware.cs', 1, 8)).toEqual([]);
  });

  it('ss-read names the production class behind the call and drops the test double', async () => {
    const r = await readFile({ path: 'src/Middleware.cs', projectRoot, startLine: 9, endLine: 13, format: 'agent' });
    expect(renderInterfaceImpls(r)).toBe(
      'line 11 _replacer.Replace calls interface IReplacer.Replace, implemented by Replacer.Replace (src/Replacer.cs:4)',
    );
    const plain = await readFile({ path: 'src/Middleware.cs', projectRoot, startLine: 9, endLine: 13, format: 'json' });
    expect(renderInterfaceImpls(plain)).toBe('');
  });

  it('ss-trace resolves a name the --in file only calls to the called method, not a substring match', () => {
    const repo = new StructuralContextRepository(dbPath);
    try {
      const [first] = repo.findEntityCandidates('Replace', { filePath: 'src/Middleware.cs' });
      // The call's resolved target (here the implementation the resolver picked), never the field `_replacer`.
      expect(first).toMatchObject({ name: 'Replace', type: 'method' });
    } finally {
      repo.close?.();
    }
  });

  it('ss-trace labels an implementing class as (implements), not as a call', () => {
    const builder = new StructuralContextBuilder({ projectRoot, graphDbPath: dbPath });
    try {
      const text = formatStructuralContext(builder.build('IReplacer', {}));
      expect(text).toMatch(/Replacer \[class\] src\/Replacer\.cs:2 \(implements\)/);
      expect(text).not.toMatch(/Replacer \[class\] src\/Replacer\.cs:2 call@/);
    } finally {
      builder.close();
    }
  });

  it('selection: nothing for a test file, overloads once, more than two implementations named none', () => {
    const impl = (owner, file, line) => ({ name: 'Log', owner, filePath: file, startLine: line });
    const row = (target, impls) => ({ line: 5, call: 'x.Log', target, impls });
    expect(selectInterfaceCalls([row('ILog.Log', [impl('Logger', 'src/Logger.cs', 3)])], 'unit/LoggerTests.cs')).toEqual([]);
    expect(selectInterfaceCalls([row('ILog.Log', [impl('Logger', 'src/Logger.cs', 3), impl('Logger', 'src/Logger.cs', 4), impl('Fake', 'acceptance/Logging/FakeLog.cs', 1)])], 'src/App.cs'))
      .toEqual([{ line: 5, call: 'x.Log', target: 'ILog.Log', impls: [impl('Logger', 'src/Logger.cs', 3)] }]);
    expect(selectInterfaceCalls([row('ILog.Log', [impl('A', 'src/A.cs', 1), impl('B', 'src/B.cs', 1), impl('C', 'src/C.cs', 1)])], 'src/App.cs')).toEqual([]);
  });
});
