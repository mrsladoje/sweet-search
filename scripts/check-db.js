#!/usr/bin/env node

import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Optional CLI override:
//   node scripts/check-db.js /path/to/code-graph.db
//   node scripts/check-db.js .sweet-search/code-graph.db
const inputPath = process.argv[2];
const dbPath = inputPath
  ? path.resolve(PROJECT_ROOT, inputPath)
  : path.join(PROJECT_ROOT, '.sweet-search', 'code-graph.db');

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath, { readonly: true });

console.log('=== Tables in code-graph.db ===');
const tables = db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all();
tables.forEach(t => console.log(`  - ${t.name}`));

console.log('\n=== Relationships stats ===');
try {
  const total = db.prepare('SELECT COUNT(*) as c FROM relationships').get();
  console.log(`Total relationships: ${total.c}`);

  const byType = db.prepare('SELECT type, COUNT(*) as c FROM relationships GROUP BY type').all();
  console.log('By type:');
  byType.forEach(r => console.log(`  ${r.type}: ${r.c}`));

  console.log('\n=== Resolution check ===');
  const resolutionStats = db.prepare(`
    SELECT
      type,
      COUNT(*) as total,
      SUM(CASE WHEN target_id IS NOT NULL THEN 1 ELSE 0 END) as has_target_id
    FROM relationships
    GROUP BY type
  `).all();

  resolutionStats.forEach(s => {
    const pct = (s.has_target_id / s.total * 100).toFixed(1);
    console.log(`  ${s.type.padEnd(15)}: ${s.has_target_id}/${s.total} (${pct}%)`);
  });

  console.log('\n=== Sample implements relationship ===');
  const impl = db.prepare('SELECT * FROM relationships WHERE type="implements" LIMIT 1').get();
  console.log(impl);

  console.log('\n=== Sample calls relationship ===');
  const call = db.prepare('SELECT * FROM relationships WHERE type="calls" LIMIT 1').get();
  console.log(call);
} catch (err) {
  console.error('Error:', err.message);
}

db.close();
