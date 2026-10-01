/**
 * ss-trace callers of a protocol / base method list its implementors
 * (`overrides`) and the code that constructs a type (`instantiates`), with a
 * relationship label; unresolved trace-only rows never match by name.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

let GraphExtractor;
let createGraphSchema;
let insertGraph;
let resolveRelationshipTargets;
let StructuralContextBuilder;
let formatStructuralContext;
let resetTreeSitterProvider;

beforeAll(async () => {
  ({ GraphExtractor, createGraphSchema, insertGraph } = await import('../../core/graph/graph-extractor.js'));
  ({ resolveRelationshipTargets } = await import('../../core/graph/relationship-resolver.js'));
  ({ StructuralContextBuilder, formatStructuralContext } = await import('../../core/graph/index.js'));
  ({ resetTreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js'));
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

const FILES = {
  'Sources/Observer.swift': [
    'public protocol TransactionObserver: AnyObject {',
    '    func databaseDidRollback(_ db: Database)',
    '}',
  ].join('\n'),
  'Sources/Region.swift': [
    'final class RegionObserver {',
    '    var n = 0',
    '}',
    '',
    'extension RegionObserver: TransactionObserver {',
    '    func databaseDidRollback(_ db: Database) {',
    '        n = 0',
    '    }',
    '}',
  ].join('\n'),
  'Sources/Setup.swift': [
    'func install() {',
    '    let observer = RegionObserver()',
    '    print(observer)',
    '}',
  ].join('\n'),
  // A second `Config` makes `Config()` ambiguous: no edge, and the unresolved
  // row must not show up as a caller of either Config.
  'Sources/A/Config.swift': 'final class Config {\n    var a = 0\n}\n',
  'Sources/B/Config.swift': 'final class Config {\n    var b = 0\n}\n',
  'Sources/Use.swift': 'func make() {\n    let c = Config()\n    print(c)\n}\n',
};

let root;
let builder;
let originalLog;

beforeEach(async () => {
  originalLog = console.log;
  console.log = () => {};
  root = mkdtempSync(join(tmpdir(), 'trace-overrides-'));
  const dbPath = join(root, 'code-graph.db');
  const db = new Database(dbPath);
  const hasFts5 = createGraphSchema(db);
  const ex = new GraphExtractor();
  const ents = [];
  const rels = [];
  for (const [file, content] of Object.entries(FILES)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), content);
    const r = await ex.extractFromFile(file, content);
    ents.push(...r.entities);
    rels.push(...r.relationships);
  }
  insertGraph(db, ents, rels, hasFts5, { syncFts: true });
  resolveRelationshipTargets(db);
  db.close();
  builder = new StructuralContextBuilder({ projectRoot: root, graphDbPath: dbPath });
});

afterEach(() => {
  builder?.close();
  rmSync(root, { recursive: true, force: true });
  console.log = originalLog;
});

describe('ss-trace with trace-only edges', () => {
  it('callers of a protocol requirement list the implementor declared on an extension', () => {
    const result = builder.build('databaseDidRollback', { filePath: 'Sources/Observer.swift', tokenBudget: 4000 });
    expect(result.target.filePath).toBe('Sources/Observer.swift');
    const callers = result.sections.callers.items.map(i => `${i.file}:${i.relationship}`);
    expect(callers).toContain('Sources/Region.swift:overrides');
    expect(formatStructuralContext(result, { mode: 'callers' })).toMatch(/databaseDidRollback \[function\] Sources\/Region\.swift:6 \(overrides\)/);
  });

  it('callers of a type list the code that constructs it; an ambiguous constructor call matches neither type', () => {
    const region = builder.build('RegionObserver', { filePath: 'Sources/Region.swift', tokenBudget: 4000 });
    expect(region.sections.callers.items.map(i => `${i.name}:${i.relationship}`)).toContain('install:instantiates');

    const config = builder.build('Config', { filePath: 'Sources/A/Config.swift', tokenBudget: 4000 });
    expect(config.sections.callers.items.map(i => i.name)).not.toContain('make');
  });
});
