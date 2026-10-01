/**
 * Trace-only `overrides` edges (core/graph/override-edges.js), end to end:
 * real snippets → GraphExtractor (tree-sitter) → insertGraph →
 * resolveRelationshipTargets (which derives the override edges).
 *
 * Before: `overrides` was never extracted and resolveOverride was dead code,
 * so ss-trace on a protocol / interface / base method never showed who
 * implements it (GRDB TransactionObserver.databaseDidRollback has five
 * implementors, three of them adopting the protocol on an `extension`).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let GraphExtractor;
let createGraphSchema;
let insertGraph;
let resolveRelationshipTargets;
let resetTreeSitterProvider;

beforeAll(async () => {
  ({ GraphExtractor, createGraphSchema, insertGraph } = await import('../../core/graph/graph-extractor.js'));
  ({ resolveRelationshipTargets } = await import('../../core/graph/relationship-resolver.js'));
  ({ resetTreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js'));
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

let originalLog;
beforeEach(() => { originalLog = console.log; console.log = () => {}; });
afterEach(() => { console.log = originalLog; delete process.env.SWEET_SEARCH_OVERRIDE_EDGES; });

async function build(files) {
  const db = new Database(':memory:');
  const hasFts5 = createGraphSchema(db);
  const ex = new GraphExtractor();
  const ents = [];
  const rels = [];
  for (const [filePath, content] of Object.entries(files)) {
    const r = await ex.extractFromFile(filePath, content);
    ents.push(...r.entities);
    rels.push(...r.relationships);
  }
  insertGraph(db, ents, rels, hasFts5, { syncFts: false });
  resolveRelationshipTargets(db);
  return db;
}

function overrides(db) {
  return db.prepare(`
    SELECT s.name || '@' || s.file_path || ':' || s.start_line AS src,
           t.name || '@' || t.file_path || ':' || t.start_line AS dst
    FROM relationships r JOIN entities s ON s.id = r.source_id JOIN entities t ON t.id = r.target_id
    WHERE r.type = 'overrides' ORDER BY src, dst
  `).all().map(r => `${r.src} -> ${r.dst}`);
}

describe('override edges', () => {
  it('Swift: a protocol adopted on the type and on an extension block (GRDB TransactionObserver)', async () => {
    const db = await build({
      'GRDB/Core/TransactionObserver.swift': [
        'public protocol TransactionObserver: AnyObject {',
        '    func databaseDidCommit(_ db: Database)',
        '    func databaseDidRollback(_ db: Database)',
        '}',
      ].join('\n'),
      'GRDB/Core/DatabaseRegionObservation.swift': [
        'private class DatabaseRegionObserver: TransactionObserver {',
        '    func databaseDidCommit(_ db: Database) {',
        '        notify()',
        '    }',
        '    func notify() {}',
        '}',
      ].join('\n'),
      'GRDB/ValueObservation/ValueWriteOnlyObserver.swift': [
        'final class ValueWriteOnlyObserver {',
        '    var x = 0',
        '}',
        '',
        'extension ValueWriteOnlyObserver: TransactionObserver {',
        '    func databaseDidRollback(_ db: Database) {',
        '        x = 1',
        '    }',
        '}',
      ].join('\n'),
    });
    expect(overrides(db)).toEqual([
      'databaseDidCommit@GRDB/Core/DatabaseRegionObservation.swift:2 -> databaseDidCommit@GRDB/Core/TransactionObserver.swift:2',
      'databaseDidRollback@GRDB/ValueObservation/ValueWriteOnlyObserver.swift:6 -> databaseDidRollback@GRDB/Core/TransactionObserver.swift:3',
    ]);
    db.close();
  });

  it('Kotlin: open class chain — the nearest base that defines the method wins', async () => {
    const db = await build({
      'src/Base.kt': [
        'abstract class Base {',
        '  abstract fun run(): Int',
        '  open fun name(): String = "b"',
        '}',
      ].join('\n'),
      'src/Mid.kt': [
        'open class Mid : Base() {',
        '  override fun run(): Int = 1',
        '}',
      ].join('\n'),
      'src/Leaf.kt': [
        'class Leaf : Mid() {',
        '  override fun run(): Int = 2',
        '  override fun name(): String = "leaf"',
        '}',
      ].join('\n'),
    });
    expect(overrides(db)).toEqual([
      'name@src/Leaf.kt:3 -> name@src/Base.kt:3',
      'run@src/Leaf.kt:2 -> run@src/Mid.kt:2',
      'run@src/Mid.kt:2 -> run@src/Base.kt:2',
    ]);
    db.close();
  });

  it('Java: interface methods; constructors never override; an external base gives nothing', async () => {
    const db = await build({
      'src/main/java/a/Handler.java': [
        'package a;',
        'public interface Handler {',
        '  void handle(String s);',
        '}',
      ].join('\n'),
      'src/main/java/a/LogHandler.java': [
        'package a;',
        'public class LogHandler implements Handler, java.io.Closeable {',
        '  public LogHandler() { }',
        '  public void handle(String s) { System.out.println(s); }',
        '  public void close() { }',
        '}',
      ].join('\n'),
    });
    expect(overrides(db)).toEqual([
      'handle@src/main/java/a/LogHandler.java:4 -> handle@src/main/java/a/Handler.java:3',
    ]);
    db.close();
  });

  it('two same-named Swift test classes never mix their bases', async () => {
    const db = await build({
      'Sources/P.swift': 'protocol P {\n    func a()\n}\nprotocol Q {\n    func b()\n}\n',
      'Tests/ATests.swift': 'class Observer: P {\n    func a() {}\n    func b() {}\n}\n',
      'Tests/BTests.swift': 'class Observer: Q {\n    func a() {}\n    func b() {}\n}\n',
    });
    expect(overrides(db)).toEqual([
      'a@Tests/ATests.swift:2 -> a@Sources/P.swift:2',
      'b@Tests/BTests.swift:3 -> b@Sources/P.swift:5',
    ]);
    db.close();
  });

  it('overloads match by parameter count; private methods never override (GRDB databaseDidChange, test setup)', async () => {
    const db = await build({
      'Sources/Observer.swift': [
        'public protocol Observer: AnyObject {',
        '    func databaseDidChange()',
        '    func databaseDidChange(with event: DatabaseEvent)',
        '}',
      ].join('\n'),
      'Sources/Cancel.swift': [
        'final class CancelObserver: Observer {',
        '    func databaseDidChange(with event: DatabaseEvent) { }',
        '}',
      ].join('\n'),
      'Tests/Base.swift': 'class BaseCase {\n    func setup(_ dbWriter: Writer) throws { }\n}\n',
      'Tests/Sub.swift': 'class SubCase: BaseCase {\n    private func setup(_ db: Database) throws { }\n}\n',
    });
    expect(overrides(db)).toEqual([
      'databaseDidChange@Sources/Cancel.swift:2 -> databaseDidChange@Sources/Observer.swift:3',
    ]);
    db.close();
  });

  it('SWEET_SEARCH_OVERRIDE_EDGES=0 derives nothing', async () => {
    process.env.SWEET_SEARCH_OVERRIDE_EDGES = '0';
    const db = await build({
      'src/Base.kt': 'abstract class Base {\n  abstract fun run(): Int\n}\n',
      'src/Leaf.kt': 'class Leaf : Base() {\n  override fun run(): Int = 2\n}\n',
    });
    expect(overrides(db)).toEqual([]);
    db.close();
  });
});
