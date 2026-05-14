#!/usr/bin/env node
/**
 * ss-trace probe builder (Stage 2 of the failure-analysis program).
 *
 * Reads core/prompt-optimization/data/query-shapes/inputs/<lang>-<gold>.json,
 * keeps those with non-empty `graphNeighbors.callers` or `graphNeighbors.callees`,
 * and emits one probe per (gold, relationshipType) pair into
 * core/prompt-optimization/data/query-shapes/ss-trace/probes.json.
 *
 * Relationship types:
 *   - callers: ground truth = graphNeighbors.callers (1-hop direct callers)
 *   - callees: ground truth = graphNeighbors.callees (1-hop direct callees)
 *   - impact:  ground truth = graphNeighbors.callers (1-hop proxy);
 *              `expected_2hop_diagnostic` populated by querying code-graph.db
 *              for each 1-hop caller's own callers (the union forms the
 *              "callers ∪ callers-of-callers" diagnostic field per handoff)
 *
 * Implementors are intentionally dropped (only 17 inputs / 12% coverage).
 *
 * Split assignment inherits eval/ast-tester-probes/splits/manifest.json.
 *
 * Usage:
 *   node core/prompt-optimization/scripts/ss-trace/build-probes.mjs
 *   node core/prompt-optimization/scripts/ss-trace/build-probes.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const SPLITS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-trace');
const OUT_PATH = path.join(OUT_DIR, 'probes.json');
const DB_PATH = path.join(REPO_ROOT, '.sweet-search/code-graph.db');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');

function loadSplits() {
  const m = JSON.parse(fs.readFileSync(SPLITS_PATH, 'utf8'));
  const dev = new Set(), heldout = new Set();
  for (const lang of Object.values(m.perLanguage)) {
    for (const id of lang.dev) dev.add(id);
    for (const id of lang.heldout || []) heldout.add(id);
  }
  return { dev, heldout, meta: { seed: m.seed, stratifyBy: m.stratifyBy } };
}

function loadInputs() {
  const files = fs.readdirSync(INPUTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, f), 'utf8')));
}

function classifyFamily(lang) {
  // Mirror the family map used elsewhere in the program.
  if (['java', 'csharp', 'kotlin', 'scala'].includes(lang)) return 'OO-monolithic';
  if (['rust', 'go'].includes(lang)) return 'Systems-modular-terse';
  if (['c', 'cpp', 'zig'].includes(lang)) return 'C-family';
  if (['javascript', 'typescript', 'typescript-lib', 'dart'].includes(lang)) return 'JS-mobile';
  if (['python', 'ruby', 'php', 'elixir', 'lua'].includes(lang)) return 'Dynamic-scripting';
  return 'Other';
}

function build2HopDiagnostic(db, callers1Hop) {
  // For each 1-hop caller, resolve to entity rows and query its callers.
  // Returns a deduplicated array of caller symbol names.
  if (!callers1Hop.length) return [];
  const out = new Set();
  // We don't trust caller.symbol to be unique across files. Match on
  // (name, file) when possible.
  const findEntity = db.prepare(`
    SELECT id FROM entities
    WHERE name = ? AND file_path = ?
    LIMIT 1
  `);
  const findEntityByName = db.prepare(`
    SELECT id FROM entities WHERE name = ? LIMIT 5
  `);
  const findCallers = db.prepare(`
    SELECT DISTINCT e2.name
    FROM relationships r
    JOIN entities e2 ON e2.id = r.source_id
    WHERE r.type IN ('calls', 'uses', 'implements', 'extends', 'overrides')
      AND (r.target_id = ? OR r.target_name = ?)
    LIMIT 50
  `);
  for (const c of callers1Hop) {
    let entityIds = [];
    if (c.file && c.symbol) {
      const row = findEntity.get(c.symbol, c.file);
      if (row) entityIds = [row.id];
    }
    if (!entityIds.length) {
      entityIds = findEntityByName.all(c.symbol).map(r => r.id);
    }
    for (const id of entityIds) {
      for (const r of findCallers.all(id, c.symbol)) {
        if (r.name && r.name !== c.symbol) out.add(r.name);
      }
    }
  }
  return [...out];
}

function main() {
  const { dev, heldout, meta } = loadSplits();
  const inputs = loadInputs();
  const db = fs.existsSync(DB_PATH) ? new Database(DB_PATH, { readonly: true, fileMustExist: true }) : null;
  if (!db) {
    console.error(`WARN: code-graph.db not found at ${DB_PATH}; 2-hop diagnostic will be empty.`);
  }

  const probes = [];
  let droppedDp = 0, droppedNoSplit = 0, droppedNoNeighbors = 0;

  for (const gold of inputs) {
    const id = gold.goldId;
    const isDp = /^DP-/.test(id);
    if (isDp) { droppedDp++; continue; }
    let split = null;
    if (dev.has(id)) split = 'dev';
    else if (heldout.has(id)) split = 'heldout';
    else { droppedNoSplit++; continue; }

    const g = gold.graphNeighbors || {};
    const callers = g.callers || [];
    const callees = g.callees || [];
    if (!callers.length && !callees.length) { droppedNoNeighbors++; continue; }

    const base = {
      goldId: id,
      language: gold.canonicalLanguage || gold.language,
      family: classifyFamily(gold.canonicalLanguage || gold.language),
      split,
      symbol: gold.expectedSymbol,
      filePath: gold.expectedFile || null,
      repoKey: gold.repoKey,
      repoSha: gold.repoSha,
    };

    if (callers.length) {
      probes.push({
        ...base,
        probeId: `callers-${id}`,
        relationshipType: 'callers',
        expected: callers.map(c => c.symbol).filter(Boolean),
        expectedFull: callers,
      });
      const closure = db ? build2HopDiagnostic(db, callers) : [];
      probes.push({
        ...base,
        probeId: `impact-${id}`,
        relationshipType: 'impact',
        expected: callers.map(c => c.symbol).filter(Boolean),
        expectedFull: callers,
        expected_2hop_diagnostic: closure,
      });
    }

    if (callees.length) {
      probes.push({
        ...base,
        probeId: `callees-${id}`,
        relationshipType: 'callees',
        expected: callees.map(c => c.symbol).filter(Boolean),
        expectedFull: callees,
      });
    }
  }

  if (db) db.close();

  const splitCounts = { dev: 0, heldout: 0 };
  const typeCounts = { callers: 0, callees: 0, impact: 0 };
  const langCounts = {};
  for (const p of probes) {
    splitCounts[p.split]++;
    typeCounts[p.relationshipType]++;
    const k = `${p.language}|${p.relationshipType}|${p.split}`;
    langCounts[k] = (langCounts[k] || 0) + 1;
  }

  const out = {
    schemaVersion: 1,
    tool: 'ss-trace',
    createdAt: new Date().toISOString().slice(0, 10),
    splitSource: 'eval/ast-tester-probes/splits/manifest.json (stratified seed=42)',
    splitMeta: meta,
    totals: { ...typeCounts, total: probes.length },
    splits: splitCounts,
    drops: { dp: droppedDp, no_split: droppedNoSplit, no_neighbors: droppedNoNeighbors },
    probes,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify({ totals: out.totals, splits: out.splits, drops: out.drops }, null, 2));
    console.log(`\n(dry-run) would write ${probes.length} probes to ${OUT_PATH}`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${probes.length} probes to ${OUT_PATH}`);
  console.log(`  by type: ${JSON.stringify(typeCounts)}`);
  console.log(`  by split: ${JSON.stringify(splitCounts)}`);
  console.log(`  drops: ${JSON.stringify(out.drops)}`);
}

main();
