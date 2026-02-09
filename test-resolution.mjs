#!/usr/bin/env node

import Database from 'better-sqlite3';
import { resolveRelationshipTargets } from './core/relationship-resolver.js';
import fs from 'fs/promises';

const dbPath = '/mnt/c/Users/panonit/IdeaProjects/sloth/.agentdb/test-code-graph.db';

console.log('Creating test database at:', dbPath);

// Remove existing
try {
  await fs.unlink(dbPath);
} catch (e) {}

const db = new Database(dbPath);

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    signature TEXT,
    parent_class TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS relationships (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT,
    target_id TEXT,
    target_name TEXT NOT NULL,
    type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    context_line INTEGER,
    full_import_path TEXT,
    is_static INTEGER DEFAULT 0,
    is_wildcard INTEGER DEFAULT 0
  )
`);

// Insert test entities
const insertEntity = db.prepare('INSERT INTO entities (id, file_path, type, name) VALUES (?, ?, ?, ?)');
insertEntity.run('id1', 'File.java', 'class', 'UserService');
insertEntity.run('id2', 'File.java', 'method', 'getUser');
insertEntity.run('id3', 'File.java', 'method', 'saveUser');

// Insert test relationships with NULL target_id
const insertRel = db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)');
insertRel.run('id1', null, 'getUser', 'calls', 1.0);
insertRel.run('id1', null, 'saveUser', 'calls', 1.0);
insertRel.run('id1', null, 'UnknownMethod', 'calls', 1.0);

console.log('Test database created with 3 entities and 3 relationships');

// Test resolution
console.log('\nRunning resolution...');
const stats = resolveRelationshipTargets(db);

console.log('\nResolution stats:');
console.log('  Resolved:', stats.resolved);
console.log('  Total:', stats.total);
console.log('  Ambiguous:', stats.ambiguous);

// Check results
const resolved = db.prepare('SELECT * FROM relationships WHERE target_id IS NOT NULL').all();
console.log('\nResolved relationships:');
for (const r of resolved) {
  console.log('  -', r.source_id, '->', r.target_name, '(target_id:', r.target_id + ')');
}

const unresolved = db.prepare('SELECT * FROM relationships WHERE target_id IS NULL').all();
console.log('\nUnresolved relationships:');
for (const r of unresolved) {
  console.log('  -', r.source_id, '->', r.target_name);
}

db.close();

console.log('\n✅ Resolution test complete!');
