#!/usr/bin/env node
/**
 * verify-structural-failures.mjs — classifies each dev P3 FAIL into one of:
 *
 *   sql-substring     : exact match exists for expectedSymbol but `findCallers`
 *                       SQL (`name = ? OR name LIKE ?` with no preference order)
 *                       picked a different entity as the target → empty/wrong
 *                       results.
 *   target-not-found  : no entity with name=expectedSymbol exists in code-graph.db.
 *                       Graph-extraction gap OR symbol resolves to qualified
 *                       form (e.g., ClassName.method).
 *   target-no-rels    : exact target exists, IS the one picked, but the
 *                       relationships table has zero entries for it (no callers
 *                       indexed) — genuine graph-extraction gap.
 *   ranker-issue      : exact target picked, relationships exist for it, but
 *                       the right entities don't reach top-5 (rank issue).
 *   unknown           : doesn't fit the above four (shouldn't happen often).
 *
 * Uses each language's code-graph.db directly. Read-only. Does NOT mutate the
 * sweep or the DB.
 *
 * Output: jsonl + a short summary table.
 *
 * Discipline: dev-only. Held-out is NEVER inspected by this script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const SWEEP_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/structural/tracks/track-a-phase6-redo-structural-v1.jsonl');
const OUT_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/structural/dev-fails-classified.jsonl');

function loadRepos() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const m = new Map();
  for (const r of raw.repos || []) m.set(r.key || r.language, r);
  return m;
}

const dbs = new Map();
function openDb(language, repoEntry) {
  if (dbs.has(language)) return dbs.get(language);
  const dbPath = path.join(REPO_ROOT, repoEntry.localPath, '.sweet-search/code-graph.db');
  if (!fs.existsSync(dbPath)) {
    dbs.set(language, null);
    return null;
  }
  const db = new Database(dbPath, { readonly: true });
  dbs.set(language, db);
  return db;
}

function reproduceBuggySql(db, name) {
  return db.prepare(`SELECT id, name, type, file_path FROM entities WHERE (name = ? OR name LIKE ?) AND stale_since IS NULL LIMIT 1`).get(name, `%${name}%`);
}

function exactTarget(db, name) {
  // Strictest: case-sensitive exact match
  return db.prepare(`SELECT id, name, type, file_path FROM entities WHERE name = ? AND stale_since IS NULL LIMIT 1`).get(name);
}

function exactTargetCount(db, name) {
  return db.prepare(`SELECT COUNT(*) as n FROM entities WHERE name = ? AND stale_since IS NULL`).get(name).n;
}

function countCallersOf(db, targetId, targetName) {
  // Approximate the findCallers SQL's matching strategy
  const lowerCamel = targetName.charAt(0).toLowerCase() + targetName.slice(1);
  return db.prepare(`
    SELECT COUNT(*) as n FROM relationships r
    JOIN entities e ON e.id = r.source_id
    WHERE r.type = 'calls' AND (
      r.target_id = ?
      OR r.target_name LIKE ?
      OR r.target_name LIKE ?
    ) AND e.stale_since IS NULL
  `).get(targetId, `${lowerCamel}.%`, `${targetName}.%`).n;
}

function countCalleesOf(db, sourceId) {
  return db.prepare(`SELECT COUNT(*) as n FROM relationships WHERE source_id = ? AND type = 'calls'`).get(sourceId).n;
}

function classifyFail(row, repos) {
  const repoEntry = repos.get(row.language);
  if (!repoEntry) return { ...row, classification: 'no-repo-entry' };
  const db = openDb(row.language, repoEntry);
  if (!db) return { ...row, classification: 'no-db' };

  const expected = row.expectedSymbol;
  const exact = exactTarget(db, expected);
  const buggy = reproduceBuggySql(db, expected);
  const exactCount = exactTargetCount(db, expected);

  const info = {
    probeId: row.probeId,
    language: row.language,
    relationship: row.relationship,
    expectedSymbol: expected,
    returned_count: (row.returned || []).length,
    verdict: row.verdict,
    exactExists: exactCount > 0,
    exactCount,
    exactTarget: exact ? `${exact.name} (${exact.type}) @ ${exact.file_path}` : null,
    buggyPicked: buggy ? `${buggy.name} (${buggy.type}) @ ${buggy.file_path}` : null,
    sqlBugTriggers: !!(exact && buggy && exact.id !== buggy.id),
  };

  // Classification logic
  let cls;
  if (!exact) {
    cls = 'target-not-found';
  } else if (info.sqlBugTriggers) {
    cls = 'sql-substring';
  } else {
    // Exact match exists AND was picked. Check if relationships exist.
    const rels = row.relationship === 'callees'
      ? countCalleesOf(db, exact.id)
      : countCallersOf(db, exact.id, exact.name);
    info.relCount = rels;
    if (rels === 0) cls = 'target-no-rels';
    else if (info.returned_count > 0) cls = 'ranker-issue';
    else cls = 'unknown';
  }
  info.classification = cls;
  return info;
}

function main() {
  const repos = loadRepos();
  const sweep = fs.readFileSync(SWEEP_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const dev = sweep.filter(r => r.split === 'dev' && r.phrasing === 'P3');
  const fails = dev.filter(r => r.verdict === 'FAIL');

  const classified = fails.map(r => classifyFail(r, repos));

  fs.writeFileSync(OUT_PATH, classified.map(r => JSON.stringify(r)).join('\n') + '\n');

  // Summary
  const byClass = new Map();
  for (const r of classified) {
    byClass.set(r.classification, (byClass.get(r.classification) || 0) + 1);
  }
  console.log(`\nDev P3 FAILs: ${classified.length}\n`);
  console.log('Classification:');
  const sorted = [...byClass.entries()].sort((a,b)=>b[1]-a[1]);
  for (const [k,v] of sorted) {
    console.log(`  ${k.padEnd(20)} ${v}  (${(v*100/classified.length).toFixed(1)}%)`);
  }

  // Per-relationship breakdown of SQL bug
  console.log('\nSQL substring bug by relationship type:');
  const sqlBugs = classified.filter(r => r.classification === 'sql-substring');
  const byRel = new Map();
  for (const r of sqlBugs) {
    byRel.set(r.relationship, (byRel.get(r.relationship) || 0) + 1);
  }
  for (const [k,v] of byRel) console.log(`  ${k}: ${v}`);

  // Sample affected probes
  console.log('\nSample sql-substring affected probes:');
  sqlBugs.slice(0, 15).forEach(r => {
    console.log(`  ${r.probeId} expected="${r.expectedSymbol}" → buggy picked "${r.buggyPicked}"  (exact existed: ${r.exactTarget})`);
  });

  // target-not-found cases (likely method-name probes)
  const notFound = classified.filter(r => r.classification === 'target-not-found');
  if (notFound.length) {
    console.log(`\nSample target-not-found probes (${notFound.length} total):`);
    notFound.slice(0, 10).forEach(r => {
      console.log(`  ${r.probeId} expected="${r.expectedSymbol}" (no exact match in code-graph.db)`);
    });
  }

  // target-no-rels
  const noRels = classified.filter(r => r.classification === 'target-no-rels');
  if (noRels.length) {
    console.log(`\nSample target-no-rels probes (${noRels.length} total):`);
    noRels.slice(0, 10).forEach(r => {
      console.log(`  ${r.probeId} expected="${r.expectedSymbol}" (target found, 0 ${r.relationship} in DB)`);
    });
  }

  console.log(`\nOutput: ${path.relative(REPO_ROOT, OUT_PATH)}`);

  for (const db of dbs.values()) db?.close();
}

main();
