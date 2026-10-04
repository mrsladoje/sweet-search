import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import {
  resolveRelationshipTargets,
  narrowCallCandidates,
  createCallResolutionIndex,
} from '../../core/graph/relationship-resolver.js';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';
import { BareCallResolver } from '../../core/graph/bare-call-resolution.js';
import { trustedCallerEdge } from '../../core/infrastructure/structural-qualified-resolution.js';

function ent(id, name, file, start, end, extra = {}) {
  return { id, name, type: 'function', file_path: file, start_line: start, end_line: end, parent_class: null, signature: '', ...extra };
}

describe('narrowCallCandidates', () => {
  const brokerFn = ent('b', 'statementDidFail', 'GRDB/Core/TransactionObserver.swift', 354, 376, { parent_class: 'DatabaseObservationBroker' });
  const dbFn = ent('d', 'statementDidFail', 'GRDB/Core/Database+Statements.swift', 473, 514, { parent_class: 'Database' });
  const entities = [brokerFn, dbFn];
  const index = createCallResolutionIndex(entities);

  it('a foreign receiver resolves to another definition before the caller itself', () => {
    expect(narrowCallCandidates(entities, 'observationBroker', dbFn, index).map(c => c.id)).toEqual(['b']);
  });

  it('keeps recursion through another instance when the caller is the only definition', () => {
    const visit = ent('v', 'getChildByName', 'src/models/Reflection.ts', 210, 230, { type: 'method', parent_class: 'Reflection' });
    expect(narrowCallCandidates([visit], 'child', visit, createCallResolutionIndex([visit])).map(c => c.id)).toEqual(['v']);
  });

  it('a receiver that names a candidate owner wins', () => {
    const caller = ent('s', 'step', 'GRDB/Core/Statement.swift', 600, 630, { parent_class: 'Statement' });
    expect(narrowCallCandidates(entities, 'database', caller, index).map(c => c.id)).toEqual(['d']);
    expect(narrowCallCandidates(entities, 'observationBroker', caller, index).map(c => c.id)).toEqual(['b']);
  });

  it('self-like receivers prefer the caller owner and allow recursion', () => {
    const sibling = ent('x', 'statementDidFail', 'GRDB/Other.swift', 1, 5, { parent_class: 'Other' });
    const all = [...entities, sibling];
    const idx = createCallResolutionIndex(all);
    expect(narrowCallCandidates(all, 'self', dbFn, idx).map(c => c.id)).toEqual(['d']);
  });

  it('derives owners from container spans when parent_class is empty', () => {
    const cls = { id: 'c', name: 'UserService', type: 'class', file_path: 'a.ts', start_line: 1, end_line: 50 };
    const m1 = ent('m1', 'find', 'a.ts', 10, 20);
    const m2 = ent('m2', 'find', 'b.ts', 1, 5);
    const idx = createCallResolutionIndex([cls, m1, m2]);
    expect(idx.ownerOf(m1)).toBe('UserService');
    expect(narrowCallCandidates([m1, m2], 'userService', null, idx).map(c => c.id)).toEqual(['m1']);
  });

  it('Go methods take their owner from the receiver in the signature', () => {
    const m = ent('g', 'Next', 'context.go', 188, 196, { type: 'method', signature: 'func (c *Context) Next() {' });
    expect(createCallResolutionIndex([m]).ownerOf(m)).toBe('Context');
  });

  it('a type-qualified call binds only to that type, else stays unresolved', () => {
    const foo = { id: 'F', name: 'Foo', type: 'struct', file_path: 'src/foo.rs', start_line: 1, end_line: 3 };
    const fooNew = ent('fn', 'new', 'src/foo.rs', 5, 9, { parent_class: 'Foo' });
    const barNew = ent('bn', 'new', 'src/bar.rs', 5, 9, { parent_class: 'Bar' });
    const caller = ent('c1', 'main', 'src/main.rs', 1, 9);
    const idx = createCallResolutionIndex([foo, fooNew, barNew, caller]);
    expect(narrowCallCandidates([fooNew, barNew], 'Foo', caller, idx).map(c => c.id)).toEqual(['fn']);
    // `HashMap::new` — HashMap is not defined in the repo: external, no edge.
    expect(narrowCallCandidates([fooNew, barNew], 'HashMap', caller, idx)).toEqual([]);
  });

  it('a module-qualified call to a top-level function must name its module', () => {
    const loads = ent('l', 'loads', 'app/serializers.py', 1, 4);
    const caller = ent('c', 'handler', 'app/views.py', 1, 9);
    const idx = createCallResolutionIndex([loads, caller]);
    // `json.loads(s)` must not bind to a first-party `loads` (code-graph-rag #2636).
    expect(narrowCallCandidates([loads], 'json', caller, idx)).toEqual([]);
    expect(narrowCallCandidates([loads], 'serializers', caller, idx).map(c => c.id)).toEqual(['l']);
    // Go: package qualifier = directory name.
    const join = ent('j', 'Join', 'internal/paths/join.go', 1, 4);
    expect(narrowCallCandidates([join], 'filepath', caller, idx)).toEqual([]);
    expect(narrowCallCandidates([join], 'paths', caller, idx).map(c => c.id)).toEqual(['j']);
  });

  it('prefers a definition in a file the caller imports', () => {
    const a = ent('a', 'render', 'src/a/view.ts', 1, 5, { type: 'method' });
    const b = ent('b', 'render', 'src/b/view.ts', 1, 5, { type: 'method' });
    const caller = ent('c', 'main', 'src/main.ts', 1, 9);
    const fileImports = new Map([['src/main.ts', new Set(['src/b/view.ts'])]]);
    const idx = createCallResolutionIndex([a, b, caller], { fileImports });
    expect(narrowCallCandidates([a, b], 'view', caller, idx).map(x => x.id)).toEqual(['b']);
    expect(narrowCallCandidates([a, b], 'makeView()', caller, idx).map(x => x.id)).toEqual(['b']);
    // Python: an aliased module import keeps a module function the receiver does not name.
    const helper = ent('h', 'slugify', 'pkg/util/strings.py', 1, 3);
    const pyCaller = ent('pc', 'main', 'pkg/main.py', 1, 9);
    const idx2 = createCallResolutionIndex([helper, pyCaller], {
      fileImports: new Map([['pkg/main.py', new Set(['pkg/util/strings.py'])]]),
    });
    expect(narrowCallCandidates([helper], 's', pyCaller, idx2).map(x => x.id)).toEqual(['h']);
    expect(narrowCallCandidates([helper], 's', pyCaller, createCallResolutionIndex([helper, pyCaller]))).toEqual([]);
  });

  it('Go: an aliased package import (importsFile → `dir/`) keeps the package function', () => {
    const setMode = ent('s', 'SetMode', 'internal/mode/mode.go', 1, 5);
    const caller = ent('c', 'TestX', 'app/x_test.go', 1, 9);
    const idx = createCallResolutionIndex([setMode, caller], {
      fileImports: new Map([['app/x_test.go', new Set(['internal/mode/'])]]),
    });
    expect(narrowCallCandidates([setMode], 'tmode', caller, idx).map(x => x.id)).toEqual(['s']);
  });

  it('JS/TS objects that hold functions keep their targets (no module guard)', () => {
    const fn = ent('f', 'commentSummary', 'src/partials/comment.tsx', 1, 9);
    const caller = ent('c', 'memberSignature', 'src/partials/member.tsx', 1, 9);
    expect(narrowCallCandidates([fn], 'context', caller, createCallResolutionIndex([fn, caller])).map(x => x.id)).toEqual(['f']);
  });

  it('chained receivers (`prev()`) keep all candidates but never the caller itself', () => {
    const a = ent('a', 'execute', 'x.swift', 1, 5);
    const b = ent('b', 'execute', 'y.swift', 1, 5);
    expect(narrowCallCandidates([a, b], 'makeStatement()', a, createCallResolutionIndex([a, b])).map(c => c.id)).toEqual(['b']);
  });
});

describe('trustedCallerEdge — resolved elsewhere', () => {
  const target = { id: 'b', name: 'statementDidFail', filePath: 'GRDB/Core/TransactionObserver.swift', parentClass: 'DatabaseObservationBroker' };

  it('rejects an edge that resolution bound to another file or owner', () => {
    expect(trustedCallerEdge({
      targetId: 'd', targetName: 'database.statementDidFail',
      resolvedFile: 'GRDB/Core/Database+Statements.swift', resolvedParent: 'Database',
    }, target)).toBe(false);
  });

  it('keeps an edge resolved to the same definition or an overload in the same owner', () => {
    expect(trustedCallerEdge({ targetId: 'b', targetName: 'observationBroker.statementDidFail' }, target)).toBe(true);
    expect(trustedCallerEdge({
      targetId: 'b2', targetName: 'broker.statementDidFail',
      resolvedFile: target.filePath, resolvedParent: 'DatabaseObservationBroker',
    }, target)).toBe(true);
  });
});

describe('ss-trace callers end to end (graph-only build)', () => {
  let root;
  let dbPath;

  const FILES = {
    'Core/TransactionObserver.swift': [
      'final class DatabaseObservationBroker {',
      '    func statementDidFail(_ statement: Statement) throws {',
      '        // Undo statementWillExecute',
      '        statementObservations = []',
      '    }',
      '}',
    ],
    'Core/Database+Statements.swift': [
      'extension Database {',
      '    func statementDidFail(_ statement: Statement, withResultCode resultCode: CInt) throws -> Never {',
      '        // `TransactionObserver.databaseDidRollback(_:)` implementation',
      '        try observationBroker?.statementDidFail(statement)',
      '        throw DatabaseError(resultCode: resultCode)',
      '    }',
      '}',
    ],
    'Core/Statement.swift': [
      'final class Statement {',
      '    func step() throws {',
      '        try database.statementDidFail(self, withResultCode: code)',
      '    }',
      '}',
    ],
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ss-call-res-'));
    const extractor = new GraphExtractor({ projectRoot: root });
    const entities = [];
    const relationships = [];
    for (const [rel, lines] of Object.entries(FILES)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, lines.join('\n'));
      const out = await extractor.extractFromFile(rel, lines.join('\n'));
      entities.push(...out.entities);
      relationships.push(...out.relationships);
    }
    dbPath = join(root, 'code-graph.db');
    const db = new Database(dbPath);
    const fts = createGraphSchema(db);
    const log = console.log;
    console.log = () => {};
    try {
      insertGraph(db, entities, relationships, fts, { syncFts: true });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
    }
    db.close();
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function callersOf(file) {
    const repo = new StructuralContextRepository(dbPath, { BareCallResolver, projectRoot: root });
    try {
      const target = repo.findEntityCandidates('statementDidFail', { filePath: file, limit: 3 })[0];
      expect(target.filePath).toBe(file);
      return repo.getCallers(target, { limit: 50 }).map(c => `${c.name}@${c.contextLine}`);
    } finally {
      repo.close?.();
    }
  }

  it('lists Database.statementDidFail as the caller of the broker method (optional chaining)', () => {
    expect(callersOf('Core/TransactionObserver.swift')).toEqual(['statementDidFail@4']);
  });

  it('keeps database.statementDidFail callers on the Database method only', () => {
    expect(callersOf('Core/Database+Statements.swift')).toEqual(['step@3']);
  });

  it('stores no call edge from the comment line', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare("SELECT target_name FROM relationships WHERE type = 'calls' AND target_name LIKE '%databaseDidRollback%'").all();
      expect(rows).toEqual([]);
    } finally {
      db.close();
    }
  });
});
