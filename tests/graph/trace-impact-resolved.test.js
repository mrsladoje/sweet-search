/**
 * ss-trace impact paths respect resolved call targets (GRDB grdb-02 shape).
 *
 * Callers already dropped `database.statementDidFail` edges that resolution
 * bound to Database's method; impact paths used the same name-pattern clause
 * without the resolved file/owner, so `Statement.step -> broker.statementDidFail`
 * reappeared as a depth-1 path. Hint ("handoff") paths also bound a name in
 * the target's body to the global top candidate instead of the definition the
 * call resolved to.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { StructuralContextBuilder } from '../../core/graph/structural-context.js';

const FILES = {
  'Core/TransactionObserver.swift': [
    'protocol TransactionObserver {',
    '    func databaseDidRollback(_ db: Database)',
    '}',
    'final class DatabaseObservationBroker {',
    '    func statementDidFail(_ statement: Statement) throws {',
    '        statementObservations = []',
    '        databaseDidRollback(notifyTransactionObservers: false)',
    '    }',
    '    func databaseDidRollback(notifyTransactionObservers: Bool) {',
    '        savepointStack.clear()',
    '    }',
    '}',
  ],
  'Core/DatabaseRegionObservation.swift': [
    // A smaller span than the broker's method, so the global top candidate
    // for `databaseDidRollback` is this one — the wrong target for the hint.
    'final class DatabaseRegionObserver {',
    '    func databaseDidRollback(_ db: Database) {',
    '    }',
    '}',
  ],
  'Core/Database+Statements.swift': [
    'extension Database {',
    '    func statementDidFail(_ statement: Statement, withResultCode resultCode: CInt) throws -> Never {',
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

describe('ss-trace impact paths follow resolved targets', () => {
  let root;
  let dbPath;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ss-trace-impact-'));
    const extractor = new GraphExtractor({ projectRoot: root });
    const entities = [];
    const relationships = [];
    const callSites = [];
    for (const [rel, lines] of Object.entries(FILES)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, lines.join('\n'));
      const out = await extractor.extractFromFile(rel, lines.join('\n'));
      entities.push(...out.entities);
      relationships.push(...out.relationships);
      if (out.callSites) callSites.push(...out.callSites);
    }
    dbPath = join(root, 'code-graph.db');
    const db = new Database(dbPath);
    const fts = createGraphSchema(db);
    const log = console.log;
    console.log = () => {};
    try {
      insertGraph(db, entities, relationships, fts, { syncFts: true, callSites });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
    }
    db.close();
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function trace() {
    const builder = new StructuralContextBuilder({ projectRoot: root, graphDbPath: dbPath });
    try {
      return builder.build('statementDidFail', { filePath: 'Core/TransactionObserver.swift' });
    } finally {
      builder.close();
    }
  }

  it('a call resolved to another same-named method is not a depth-1 upstream path', () => {
    const upstream = trace().sections.impact.paths.filter(p => p.direction === 'upstream');
    const depth1 = upstream.filter(p => p.depth === 1).map(p => p.path);
    expect(depth1).toEqual([
      'statementDidFail (Core/Database+Statements.swift:2) -> statementDidFail (Core/TransactionObserver.swift:5)',
    ]);
    // Statement.step still reaches the broker — through Database's method.
    expect(upstream.map(p => p.path)).toContain(
      'step (Core/Statement.swift:2) -> statementDidFail (Core/Database+Statements.swift:2) -> statementDidFail (Core/TransactionObserver.swift:5)',
    );
  });

  it('a hint path binds a body call to the definition the call resolved to', () => {
    const downstream = trace().sections.impact.paths.filter(p => p.direction === 'downstream' && p.depth === 1);
    const rollback = downstream.map(p => p.path).filter(p => p.includes('databaseDidRollback'));
    expect(rollback).toEqual([
      'statementDidFail (Core/TransactionObserver.swift:5) -> databaseDidRollback (Core/TransactionObserver.swift:9)',
    ]);
  });
});
