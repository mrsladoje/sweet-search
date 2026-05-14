#!/usr/bin/env node
/**
 * verify-sql-fix.mjs — exercise the proposed _resolveStructuralTarget SQL
 * against each language's code-graph.db and report whether known-failing
 * probe symbols now resolve to the correct entity.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const CLASSIFIED_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/structural/dev-fails-classified.jsonl');

function resolveFixed(db, name) {
  return db.prepare(`
    SELECT id, name, type, file_path FROM entities
    WHERE (name = ? OR name LIKE ?)
      AND stale_since IS NULL
    ORDER BY
      CASE WHEN name = ? THEN 0 ELSE 1 END,
      CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
      CASE type
        WHEN 'class' THEN 0 WHEN 'struct' THEN 0 WHEN 'trait' THEN 0
        WHEN 'interface' THEN 1 WHEN 'enum' THEN 1 WHEN 'type' THEN 1 WHEN 'typeAlias' THEN 1
        WHEN 'function' THEN 2 WHEN 'method' THEN 2
        ELSE 3
      END,
      length(name) ASC
    LIMIT 1
  `).get(name, `%${name}%`, name);
}

function loadRepos() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const m = new Map();
  for (const r of raw.repos || []) m.set(r.key || r.language, r);
  return m;
}

function main() {
  const repos = loadRepos();
  const classified = fs.readFileSync(CLASSIFIED_PATH, 'utf8').trim().split('\n').map(JSON.parse);
  const sqlBugCases = classified.filter(r => r.classification === 'sql-substring');

  let fixed = 0;
  let stillBuggy = 0;
  const dbs = new Map();

  console.log(`Replaying ${sqlBugCases.length} sql-substring FAILs with the proposed SQL fix:\n`);

  for (const c of sqlBugCases) {
    const repoEntry = repos.get(c.language);
    if (!repoEntry) continue;
    let db = dbs.get(c.language);
    if (!db) {
      const dbPath = path.join(REPO_ROOT, repoEntry.localPath, '.sweet-search/code-graph.db');
      if (!fs.existsSync(dbPath)) continue;
      db = new Database(dbPath, { readonly: true });
      dbs.set(c.language, db);
    }
    const picked = resolveFixed(db, c.expectedSymbol);
    const exactName = c.expectedSymbol;
    if (picked && picked.name === exactName) {
      fixed++;
    } else {
      stillBuggy++;
      console.log(`  STILL BUGGY: ${c.probeId} expected="${exactName}" → picked="${picked?.name}" (${picked?.type}) @ ${picked?.file_path}`);
    }
  }

  console.log(`\nFixed: ${fixed} / ${sqlBugCases.length}`);
  console.log(`Still buggy: ${stillBuggy}`);

  for (const db of dbs.values()) db?.close();
}

main();
