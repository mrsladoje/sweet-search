import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../../.agentdb/code-graph.db');

console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath, { readonly: true });

console.log('=== Tables in codebase.db ===');
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
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
