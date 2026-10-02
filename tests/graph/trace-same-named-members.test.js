// ss-trace on a member repeated in several classes of one file (ocelot test
// classes each declare `GivenJObject`): each definition is its own entity, a
// qualified symbol `Owner.name` selects it, and the same-file caller scan
// attributes a call only to the definition of the caller's own class.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';

const FILE = 'tests/BuilderTests.cs';
const SOURCE = [
  'namespace Demo;',
  'public class BuilderTests',
  '{',
  '    public class First',
  '    {',
  '        private readonly Builder _builder = new();',
  '        private void Given(JObject j) => _builder.Set(j);',
  '        public void A()',
  '        {',
  '            Given(null);',
  '        }',
  '        public void B()',
  '        {',
  '            Given(null);',
  '        }',
  '    }',
  '    public class Second',
  '    {',
  '        private readonly Builder _builder = new();',
  '        private void Given(JObject j) => _builder.Set(j);',
  '        public void C()',
  '        {',
  '            Given(null);',
  '        }',
  '    }',
  '}',
].join('\n');

describe('ss-trace: same-named members of different classes in one file', () => {
  let projectRoot;
  let dbPath;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-trace-members-'));
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(join(projectRoot, FILE), SOURCE);
    dbPath = join(projectRoot, 'code-graph.db');
    const db = new Database(dbPath);
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const out = await new GraphExtractor().extractFromFile(FILE, SOURCE);
      insertGraph(db, out.entities, out.relationships, fts, { syncFts: false, callSites: out.callSites || [], files: [out.file] });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
      db.close();
    }
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('stores both definitions, each under its own class', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare("SELECT name, parent_class, start_line FROM entities WHERE name IN ('Given', '_builder') ORDER BY start_line").all();
      expect(rows.map((r) => `${r.parent_class}.${r.name}@${r.start_line}`)).toEqual([
        'First._builder@6', 'First.Given@7', 'Second._builder@19', 'Second.Given@20',
      ]);
    } finally {
      db.close();
    }
  });

  it('Owner.name selects the owned definition; callers are those of its class only', () => {
    const repo = new StructuralContextRepository(dbPath, { projectRoot });
    try {
      const pick = (symbol) => repo.findEntityCandidates(symbol, { filePath: FILE })[0].startLine;
      expect(pick('First.Given')).toBe(7);
      expect(pick('Second.Given')).toBe(20);
      expect(pick('Second::Given')).toBe(20);

      const first = repo.findEntityCandidates('First.Given', { filePath: FILE })[0];
      const second = repo.findEntityCandidates('Second.Given', { filePath: FILE })[0];
      const callerLines = (t) => [...repo.getBareCallers(t), ...repo.getSameFileCallers(t)]
        .map((c) => `${c.name}@${c.contextLine}`).sort();
      expect([...new Set(callerLines(first))]).toEqual(['A@10', 'B@14']);
      expect([...new Set(callerLines(second))]).toEqual(['C@23']);
    } finally {
      repo.close();
    }
  });
});
