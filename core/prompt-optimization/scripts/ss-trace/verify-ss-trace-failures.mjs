#!/usr/bin/env node
/**
 * Verify-against-DB script for the 7 FAILs surfaced by Stage 3.
 *
 * For each FAIL probe, query the per-repo code-graph.db directly to determine:
 *   - does the expected caller/callee entity exist in the entities table?
 *   - is there a relationships row that names it (target_name match or by id)?
 *
 * Classification:
 *   - "ranker"   : entity exists in graph + a relationship row exists → ss-trace
 *                  knows about the caller but ranks it below top-5 (probably the
 *                  -0.38 isTestPath penalty when the expected callers are tests)
 *   - "missing"  : no entity row OR no relationship row → graph extractor gap
 *   - "rubric"   : expected set is meaningless (e.g. C++ namespace dupes), not
 *                  a real ss-trace failure
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TRACK_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-trace/tracks/track-a-baseline-dev-v2.jsonl');
const PROBES_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-trace/probes.json');

function classifyExpected(probe, db) {
  const findByName = db.prepare(`SELECT id, name, file_path, type FROM entities WHERE name = ? LIMIT 5`);
  const findRelByName = db.prepare(`
    SELECT COUNT(*) AS n FROM relationships
    WHERE (target_name = ? OR target_name LIKE ?)
      AND type IN ('calls', 'uses', 'implements', 'extends', 'overrides')
  `);
  const findRelBySource = db.prepare(`
    SELECT COUNT(*) AS n FROM relationships r
    JOIN entities e ON e.id = r.source_id
    WHERE e.name = ?
      AND r.type = 'calls'
  `);

  const seen = new Set();
  const items = [];
  for (const s of probe.expected) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const ents = findByName.all(s);
    const inFile = ents.find(e => probe.expectedFull?.some(x => x.symbol === s && x.file === e.file_path));
    const isTest = ents.some(e => /(^|\/)(test|tests|__tests__|spec)(\/|$)|[-_.](test|spec)\.[jt]sx?$|_test\.go$/.test(e.file_path));
    // for callers/impact: relationship is "source named X calls target"
    // for callees: relationship is "target named X is called by source"
    let nRel = 0;
    if (probe.relationshipType === 'callees') {
      nRel = findRelByName.get(s, `%.${s}`).n;
    } else {
      nRel = findRelBySource.get(s).n;
    }
    items.push({
      symbol: s,
      n_entity_rows: ents.length,
      in_expected_file: !!inFile,
      is_in_test_path: isTest,
      n_rel_rows: nRel,
    });
  }
  const all_missing = items.every(x => x.n_entity_rows === 0);
  const any_test = items.some(x => x.is_in_test_path);
  const all_resolved = items.every(x => x.n_entity_rows > 0 && x.n_rel_rows > 0);
  let mode;
  if (all_missing) mode = 'missing_extraction';
  else if (any_test && all_resolved) mode = 'ranker_test_demote';
  else if (all_resolved) mode = 'ranker_other';
  else mode = 'partial_extraction';
  return { mode, items };
}

const rows = fs.readFileSync(TRACK_PATH, 'utf8').trim().split('\n').map(JSON.parse);
const probesData = JSON.parse(fs.readFileSync(PROBES_PATH, 'utf8'));
const fails = rows.filter(r => r.classification === 'FAIL');

console.log(`Analyzing ${fails.length} FAIL probes against per-repo code-graph.db…\n`);
const tally = {};
for (const f of fails) {
  const probe = probesData.probes.find(p => p.probeId === f.probeId);
  const dbPath = path.join(REPO_ROOT, 'eval/ast-tester-probes/_repos', probe.repoKey, '.sweet-search/code-graph.db');
  if (!fs.existsSync(dbPath)) { console.log(`MISS DB: ${dbPath}`); continue; }
  const db = new Database(dbPath, { readonly: true });
  const result = classifyExpected(probe, db);
  db.close();
  tally[result.mode] = (tally[result.mode] || 0) + 1;
  console.log(`${f.probeId.padEnd(22)} ${probe.language.padEnd(10)} mode=${result.mode}`);
  for (const it of result.items) {
    const tags = [it.is_in_test_path ? 'TEST' : '', it.n_entity_rows > 0 ? `E${it.n_entity_rows}` : 'E0', `R${it.n_rel_rows}`].filter(Boolean).join('/');
    console.log(`  ${it.symbol.padEnd(50)} ${tags}`);
  }
  console.log();
}
console.log('--- mode tally ---');
console.log(JSON.stringify(tally, null, 2));
