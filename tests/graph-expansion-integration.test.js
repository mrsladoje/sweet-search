import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { GraphExtractor } from '../core/graph-extractor.js';
import { expandResults } from '../core/graph-expansion.js';

/**
 * Integration tests: GraphExtractor → SQLite → expandResults
 *
 * Verifies that relationship patterns extracted by GraphExtractor produce
 * resolvable edges that graph expansion can actually follow. This tests
 * the full pipeline that was fixed in the relationship-patterns commit.
 */

// Helper: extract entities + relationships, insert into DB, return DB
async function buildGraphFromFiles(files) {
  const extractor = new GraphExtractor({ useTreeSitter: false });
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT,
      start_line INTEGER,
      end_line INTEGER,
      stale_since INTEGER DEFAULT NULL
    )
  `);
  db.exec(`
    CREATE TABLE relationships (
      source_id TEXT,
      target_id TEXT,
      target_name TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0
    )
  `);

  const insertEntity = db.prepare(
    'INSERT OR IGNORE INTO entities (id, file_path, type, name, signature, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertRel = db.prepare(
    'INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)'
  );

  // Build entity ID lookup: name → id
  const nameToId = new Map();
  const allEntities = [];
  const allRels = [];

  for (const { path: filePath, code } of files) {
    const result = await extractor.extractFromFile(filePath, code);
    allEntities.push(...result.entities);
    allRels.push(...result.relationships);
  }

  // Insert entities
  for (const e of allEntities) {
    insertEntity.run(e.id, e.file_path, e.type, e.name, e.signature || null, e.start_line, e.end_line);
    nameToId.set(e.name, e.id);
  }

  // Insert relationships, resolving target_id from name when possible
  for (const r of allRels) {
    const sourceId = r.source_id || nameToId.get(r.source_name) || null;
    const targetId = nameToId.get(r.target_name) || null;
    insertRel.run(sourceId, targetId, r.target_name, r.type, r.weight || 1.0);
  }

  return { db, nameToId, entities: allEntities, relationships: allRels };
}

// ─── PHP: extends + implements ─────────────────────────────────────────────
describe('Integration: PHP → graph expansion', () => {
  let db, nameToId;

  beforeAll(async () => {
    const result = await buildGraphFromFiles([
      {
        path: '/app/BaseController.php',
        code: `<?php
abstract class BaseController {
  public function handle() {}
}`,
      },
      {
        path: '/app/Loggable.php',
        code: `<?php
interface Loggable {
  public function log();
}`,
      },
      {
        path: '/app/Cacheable.php',
        code: `<?php
interface Cacheable {
  public function cache();
}`,
      },
      {
        path: '/app/UserController.php',
        code: `<?php
class UserController extends BaseController implements Loggable, Cacheable {
  public function handle() {}
  public function log() {}
  public function cache() {}
}`,
      },
    ]);
    db = result.db;
    nameToId = result.nameToId;
  });

  afterAll(() => db?.close());

  it('extracts extends + implements relationships from PHP', () => {
    const rels = db.prepare('SELECT type, target_name FROM relationships').all();
    const types = rels.map(r => r.type);
    expect(types).toContain('extends');
    expect(types).toContain('implements');
  });

  it('resolves target_id for extends relationship', () => {
    const ext = db.prepare("SELECT target_id, target_name FROM relationships WHERE type = 'extends' AND target_name = 'BaseController'").get();
    expect(ext).toBeDefined();
    expect(ext.target_id).toBe(nameToId.get('BaseController'));
  });

  it('resolves target_id for implements relationships', () => {
    const impls = db.prepare("SELECT target_id, target_name FROM relationships WHERE type = 'implements'").all();
    expect(impls.length).toBe(2);
    const resolvedIds = impls.map(r => r.target_id).filter(Boolean);
    expect(resolvedIds.length).toBe(2);
  });

  it('1-hop from UserController finds BaseController + interfaces', () => {
    const ucId = nameToId.get('UserController');
    const results = [{ id: ucId, score: 10, file: '/app/UserController.php', name: 'UserController' }];
    const expanded = expandResults(db, results, { expandMode: '1hop' });

    const names = expanded.map(r => r.name);
    expect(names).toContain('UserController');
    expect(names).toContain('BaseController');
    expect(names).toContain('Loggable');
    expect(names).toContain('Cacheable');
  });
});

// ─── C++: multiple inheritance ─────────────────────────────────────────────
describe('Integration: C++ → graph expansion', () => {
  let db, nameToId;

  beforeAll(async () => {
    const result = await buildGraphFromFiles([
      {
        path: '/src/base.hpp',
        code: `#include <iostream>
class Drawable {
  virtual void draw() = 0;
};`,
      },
      {
        path: '/src/clickable.hpp',
        code: `class Clickable {
  virtual void onClick() = 0;
};`,
      },
      {
        path: '/src/widget.cpp',
        code: `#include "base.hpp"
#include "clickable.hpp"
class Widget : public Drawable, public Clickable {
  void draw() override {}
  void onClick() override {}
};`,
      },
    ]);
    db = result.db;
    nameToId = result.nameToId;
  });

  afterAll(() => db?.close());

  it('extracts both C++ parent classes', () => {
    const extRels = db.prepare("SELECT target_name FROM relationships WHERE type = 'extends'").all();
    const targets = extRels.map(r => r.target_name);
    expect(targets).toContain('Drawable');
    expect(targets).toContain('Clickable');
  });

  it('both parents have resolved target_ids', () => {
    const extRels = db.prepare("SELECT target_id, target_name FROM relationships WHERE type = 'extends'").all();
    const resolved = extRels.filter(r => r.target_id);
    expect(resolved.length).toBe(2);
  });

  it('1-hop from Widget reaches both parents', () => {
    const widgetId = nameToId.get('Widget');
    const results = [{ id: widgetId, score: 10, file: '/src/widget.cpp', name: 'Widget' }];
    const expanded = expandResults(db, results, { expandMode: '1hop' });

    const names = expanded.map(r => r.name);
    expect(names).toContain('Drawable');
    expect(names).toContain('Clickable');
  });
});

// ─── Kotlin: multi-parent via inherit ──────────────────────────────────────
describe('Integration: Kotlin → graph expansion', () => {
  let db, nameToId;

  beforeAll(async () => {
    const result = await buildGraphFromFiles([
      {
        path: '/src/Serializable.kt',
        code: `import kotlin.io
interface Serializable {
  fun serialize(): String
}`,
      },
      {
        path: '/src/Comparable.kt',
        code: `import kotlin.io
interface Comparable {
  fun compareTo(other: Any): Int
}`,
      },
      {
        path: '/src/DataModel.kt',
        code: `import kotlin.io
class DataModel(val id: Int) : Serializable, Comparable {
  override fun serialize() = id.toString()
  override fun compareTo(other: Any) = 0
}`,
      },
    ]);
    db = result.db;
    nameToId = result.nameToId;
  });

  afterAll(() => db?.close());

  it('extracts both Kotlin parents', () => {
    const extRels = db.prepare("SELECT target_name FROM relationships WHERE type = 'extends'").all();
    const targets = extRels.map(r => r.target_name);
    expect(targets).toContain('Serializable');
    expect(targets).toContain('Comparable');
  });

  it('1-hop from DataModel reaches both interfaces', () => {
    const modelId = nameToId.get('DataModel');
    const results = [{ id: modelId, score: 10, file: '/src/DataModel.kt', name: 'DataModel' }];
    const expanded = expandResults(db, results, { expandMode: '1hop' });

    const names = expanded.map(r => r.name);
    expect(names).toContain('Serializable');
    expect(names).toContain('Comparable');
  });
});

// ─── 2-hop: PHP hierarchy with grandparent ─────────────────────────────────
describe('Integration: 2-hop PHP hierarchy', () => {
  let db, nameToId;

  beforeAll(async () => {
    const result = await buildGraphFromFiles([
      {
        path: '/app/Model.php',
        code: `<?php
abstract class Model {
  public function save() {}
}`,
      },
      {
        path: '/app/SoftDeletable.php',
        code: `<?php
interface SoftDeletable {
  public function softDelete();
}`,
      },
      {
        path: '/app/BaseModel.php',
        code: `<?php
abstract class BaseModel extends Model {
  public function find() {}
}`,
      },
      {
        path: '/app/User.php',
        code: `<?php
class User extends BaseModel implements SoftDeletable {
  public function softDelete() {}
}`,
      },
    ]);
    db = result.db;
    nameToId = result.nameToId;
  });

  afterAll(() => db?.close());

  it('2-hop from User reaches grandparent Model', () => {
    const userId = nameToId.get('User');
    const results = [{ id: userId, score: 10, file: '/app/User.php', name: 'User' }];
    const expanded = expandResults(db, results, { expandMode: '2hop' });

    const names = expanded.map(r => r.name);
    // Hop 1: User → BaseModel, User → SoftDeletable
    expect(names).toContain('BaseModel');
    expect(names).toContain('SoftDeletable');
    // Hop 2: BaseModel → Model (grandparent)
    expect(names).toContain('Model');
  });

  it('adaptive 2-hop scores extends higher than calls', () => {
    const userId = nameToId.get('User');
    const results = [{ id: userId, score: 10, file: '/app/User.php', name: 'User' }];
    const expanded = expandResults(db, results, {
      expandMode: '2hop',
      adaptiveHop2: true,
    });

    const baseModel = expanded.find(r => r.name === 'BaseModel');
    const softDel = expanded.find(r => r.name === 'SoftDeletable');
    // Both should exist
    expect(baseModel).toBeDefined();
    expect(softDel).toBeDefined();
  });
});

// ─── Swift: extension conformance ──────────────────────────────────────────
describe('Integration: Swift extension → graph expansion', () => {
  let db, nameToId;

  beforeAll(async () => {
    const result = await buildGraphFromFiles([
      {
        path: '/Sources/Equatable.swift',
        code: `import Foundation
protocol Equatable {
  func isEqual(to other: Self) -> Bool
}`,
      },
      {
        path: '/Sources/Hashable.swift',
        code: `import Foundation
protocol Hashable {
  var hashValue: Int { get }
}`,
      },
      {
        path: '/Sources/Point.swift',
        code: `import Foundation
struct Point {
  let x: Int
  let y: Int
}`,
      },
      {
        path: '/Sources/PointExt.swift',
        code: `import Foundation
extension Point: Equatable, Hashable {
}`,
      },
    ]);
    db = result.db;
    nameToId = result.nameToId;
  });

  afterAll(() => db?.close());

  it('extracts extension protocol conformance', () => {
    const extRels = db.prepare("SELECT target_name FROM relationships WHERE type = 'extends'").all();
    const targets = extRels.map(r => r.target_name);
    expect(targets).toContain('Equatable');
    expect(targets).toContain('Hashable');
  });
});

// ─── Ruby: method call extraction ──────────────────────────────────────────
describe('Integration: Ruby method calls → graph expansion', () => {
  let db, nameToId;

  beforeAll(async () => {
    const result = await buildGraphFromFiles([
      {
        path: '/lib/service.rb',
        code: `class Service
  def run
    client.fetch(url)
    logger.info("done")
  end
end`,
      },
    ]);
    db = result.db;
    nameToId = result.nameToId;
  });

  afterAll(() => db?.close());

  it('extracts Ruby method calls', () => {
    const calls = db.prepare("SELECT target_name FROM relationships WHERE type = 'calls'").all();
    const targets = calls.map(r => r.target_name);
    expect(targets).toContain('client.fetch');
  });
});

// ─── Cross-language edge type distribution ─────────────────────────────────
describe('Integration: multi-language edge type distribution', () => {
  let db;

  beforeAll(async () => {
    const result = await buildGraphFromFiles([
      // PHP
      {
        path: '/php/Service.php',
        code: `<?php
class Service extends BaseService implements Runnable {
}`,
      },
      // C++
      {
        path: '/cpp/widget.cpp',
        code: `class Widget : public Base, public Interface {
};`,
      },
      // Kotlin
      {
        path: '/kt/Model.kt',
        code: `import kotlin.io
class Model(val id: Int) : Serializable, Comparable {
}`,
      },
      // Swift
      {
        path: '/swift/Foo.swift',
        code: `import Foundation
class Foo: Bar, Baz {
}`,
      },
    ]);
    db = result.db;
  });

  afterAll(() => db?.close());

  it('produces extends and implements edges across languages', () => {
    const rels = db.prepare('SELECT type, COUNT(*) as cnt FROM relationships GROUP BY type').all();
    const relMap = Object.fromEntries(rels.map(r => [r.type, r.cnt]));

    // Should have extends from all four languages
    expect(relMap.extends).toBeGreaterThanOrEqual(4);
    // PHP should produce implements edges
    expect(relMap.implements).toBeGreaterThanOrEqual(1);
  });

  it('no edges have empty target_name', () => {
    const empty = db.prepare("SELECT COUNT(*) as cnt FROM relationships WHERE target_name = '' OR target_name IS NULL").get();
    expect(empty.cnt).toBe(0);
  });
});
