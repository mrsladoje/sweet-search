#!/usr/bin/env node
/**
 * build-probes.mjs — derive structural probes from existing
 * inputs/<lang>-<gold>.json files (PHASE6_REDO §12.1 + structural redo
 * handoff 2026-05-14).
 *
 * For each ast-tester gold with non-empty graphNeighbors:
 *   - callers probe (relationship='callers'): expected = graphNeighbors.callers
 *   - callees probe (relationship='callees'): expected = graphNeighbors.callees
 *   - impact probe (relationship='impact'):
 *       expected_1hop = graphNeighbors.callers (direct-callers-as-proxy)
 *       expected_2hop_diagnostic = callers ∪ callers-of-callers (closure via
 *         code-graph.db lookups; diagnostic only — not the ground truth)
 *
 * Out: core/prompt-optimization/data/query-shapes/structural/probes.json
 *   Per probe: { probeId, language, family, goldId, relationship,
 *                expectedSymbol, expected: [...names], expected_2hop: [...],
 *                split: 'dev'|'heldout' }
 *
 * The 2-hop diagnostic is for impact probes only. If the sweep finds the
 * tool's Recall@5 against 2-hop closure is materially higher than against
 * 1-hop, the tool is doing transitive expansion and the 1-hop ground truth
 * may be wrong (escalation gate, see stage 4 stop rule).
 *
 * Implementations is OUT OF SCOPE per the handoff (only 17 probes; not on
 * the prioritized list). We do not emit implementations probes.
 *
 * C-family probes are known thin: ≤3 probes total across c/cpp/zig with
 * any callers/callees data. We emit them anyway and document the
 * limitation in the artifact rather than inflate the probe count.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { languageToFamily } from '../../data/query-shapes/family-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const SPLITS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/structural');
const OUT_PATH = path.join(OUT_DIR, 'probes.json');

function loadInputs() {
  return fs.readdirSync(INPUTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, n), 'utf8')));
}
function loadReposMap() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const m = new Map();
  for (const r of raw.repos || []) m.set(r.key || r.language, r);
  return m;
}
function loadSplits() {
  const raw = JSON.parse(fs.readFileSync(SPLITS_PATH, 'utf8'));
  const map = new Map();
  for (const [lang, splits] of Object.entries(raw.perLanguage || {})) {
    for (const sid of splits.dev || []) map.set(sid, 'dev');
    for (const sid of splits.heldout || []) map.set(sid, 'heldout');
  }
  return map;
}

/**
 * Compute 2-hop callers closure (callers ∪ callers-of-callers) for a
 * given target entity. Used as a diagnostic ground-truth set for impact
 * probes, NOT the primary 1-hop ground truth.
 *
 * Mirrors findCallers' SQL behaviour so the closure reflects what the
 * tool itself would see at depth 2. Returns a Set<string> of entity names.
 */
function compute2HopCallersClosure(db, targetName) {
  // Layer 1: resolve target (same OR-LIKE rule the tool uses).
  const target = db.prepare(`
    SELECT id, name FROM entities
    WHERE (name = ? OR name LIKE ?)
      AND stale_since IS NULL
    LIMIT 1
  `).get(targetName, `%${targetName}%`);
  if (!target) return new Set();

  function callerNames(entId, entName) {
    const lowerCamel = entName.charAt(0).toLowerCase() + entName.slice(1);
    return db.prepare(`
      SELECT DISTINCT e.id, e.name
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE r.type = 'calls' AND (
        r.target_id = ?
        OR r.target_name LIKE ?
        OR r.target_name LIKE ?
      )
        AND e.stale_since IS NULL
    `).all(entId, `${lowerCamel}.%`, `${entName}.%`);
  }

  const layer1 = callerNames(target.id, target.name);
  const names = new Set(layer1.map((r) => r.name).filter(Boolean));

  // Layer 2: expand each layer-1 caller.
  // Cap fan-out to 20 per layer-1 to avoid pathological closures (mirrors
  // findImpact's branching cap).
  for (const c of layer1.slice(0, 20)) {
    const layer2 = callerNames(c.id, c.name);
    for (const r of layer2) {
      if (r.name) names.add(r.name);
    }
  }
  return names;
}

function uniqueNames(arr) {
  const s = new Set();
  for (const item of arr || []) {
    const n = typeof item === 'string' ? item : item?.symbol ?? item?.name;
    if (n) s.add(n);
  }
  return [...s];
}

async function main() {
  const inputs = loadInputs().filter((i) => i.goldClass === 'ast-tester');
  const reposMap = loadReposMap();
  const splits = loadSplits();

  const probes = [];
  let skippedNoLang = 0;
  let skippedNoCallers = 0;
  let skippedNoCallees = 0;
  let skippedNoRepo = 0;
  const perRelByFamily = {};
  const dbCache = new Map();
  function getDb(language) {
    if (dbCache.has(language)) return dbCache.get(language);
    const repoEntry = reposMap.get(language);
    if (!repoEntry) return null;
    const dbPath = path.join(REPO_ROOT, repoEntry.localPath, '.sweet-search/code-graph.db');
    if (!fs.existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    dbCache.set(language, db);
    return db;
  }

  for (const input of inputs) {
    const language = input.language;
    const family = input.family || languageToFamily(language);
    const split = splits.get(input.goldId) || 'dev'; // default to dev if absent

    if (!family) { skippedNoLang++; continue; }
    if (!reposMap.has(language)) { skippedNoRepo++; continue; }

    const callers = uniqueNames(input.graphNeighbors?.callers);
    const callees = uniqueNames(input.graphNeighbors?.callees);

    // callers probe — emit only if non-empty (genuinely thin data is a
    // real finding; do not fabricate by relaxing the filter).
    if (callers.length > 0) {
      probes.push({
        probeId: `${input.goldId}-callers`,
        language, family, goldId: input.goldId, split,
        relationship: 'callers',
        expectedSymbol: input.expectedSymbol,
        expectedFile: input.expectedFile,
        expected: callers,
        expectedCount: callers.length,
      });
      perRelByFamily[family] ??= { callers: 0, callees: 0, impact: 0 };
      perRelByFamily[family].callers++;
    } else {
      skippedNoCallers++;
    }

    // callees probe — emit only if non-empty.
    if (callees.length > 0) {
      probes.push({
        probeId: `${input.goldId}-callees`,
        language, family, goldId: input.goldId, split,
        relationship: 'callees',
        expectedSymbol: input.expectedSymbol,
        expectedFile: input.expectedFile,
        expected: callees,
        expectedCount: callees.length,
      });
      perRelByFamily[family] ??= { callers: 0, callees: 0, impact: 0 };
      perRelByFamily[family].callees++;
    } else {
      skippedNoCallees++;
    }

    // impact probe — same source set as callers (direct-callers-as-proxy),
    // PLUS a 2-hop closure as diagnostic. Emit only when callers exist.
    if (callers.length > 0) {
      const db = getDb(language);
      let expected2Hop = [];
      let groundTruthMode2HopFallback = false;
      if (db) {
        try {
          const closure = compute2HopCallersClosure(db, input.expectedSymbol);
          expected2Hop = [...closure];
        } catch (err) {
          process.stderr.write(`  WARN ${input.goldId}: 2-hop closure failed: ${err.message}\n`);
          groundTruthMode2HopFallback = true;
        }
      }
      probes.push({
        probeId: `${input.goldId}-impact`,
        language, family, goldId: input.goldId, split,
        relationship: 'impact',
        expectedSymbol: input.expectedSymbol,
        expectedFile: input.expectedFile,
        groundTruthMode: 'direct_callers_as_impact_proxy',
        expected: callers,
        expectedCount: callers.length,
        expected_2hop_diagnostic: expected2Hop,
        expected_2hop_count: expected2Hop.length,
        diagnostic_fallback: groundTruthMode2HopFallback,
      });
      perRelByFamily[family].impact++;
    }
  }

  // Close DB cache.
  for (const db of dbCache.values()) {
    try { db.close(); } catch { /* ignore */ }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    schemaVersion: 1,
    bench: 'ast-tester-probes-structural',
    generatedAt: new Date().toISOString(),
    plan_reference: 'docs/PHASE6_REDO.md §12.1 + 2026-05-14 structural redo handoff',
    source_inputs_dir: path.relative(REPO_ROOT, INPUTS_DIR),
    source_splits_manifest: path.relative(REPO_ROOT, SPLITS_PATH),
    ground_truth_notes: {
      callers: '1-hop graphNeighbors.callers (set match by entity name)',
      callees: '1-hop graphNeighbors.callees (set match by entity name)',
      impact: 'direct_callers_as_impact_proxy — 1-hop graphNeighbors.callers; 2-hop closure provided as diagnostic via expected_2hop_diagnostic',
    },
    out_of_scope: {
      implementations: 'omitted — only 17 inputs / 12% coverage, not on prioritized list (handoff §scope)',
      swift: 'no inputs/ entries; manifest carries 8 SW-* but no preprocess artifact',
    },
    coverage: {
      total_probes: probes.length,
      by_relationship: {
        callers: probes.filter((p) => p.relationship === 'callers').length,
        callees: probes.filter((p) => p.relationship === 'callees').length,
        impact: probes.filter((p) => p.relationship === 'impact').length,
      },
      by_family: perRelByFamily,
      by_split: {
        dev: probes.filter((p) => p.split === 'dev').length,
        heldout: probes.filter((p) => p.split === 'heldout').length,
      },
      skipped: {
        no_family: skippedNoLang,
        no_repos_entry: skippedNoRepo,
        no_callers: skippedNoCallers,
        no_callees: skippedNoCallees,
      },
    },
    probes,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  process.stdout.write(`build-probes: wrote ${probes.length} probes to ${path.relative(REPO_ROOT, OUT_PATH)}\n`);
  process.stdout.write(`  by relationship: callers=${out.coverage.by_relationship.callers}, callees=${out.coverage.by_relationship.callees}, impact=${out.coverage.by_relationship.impact}\n`);
  process.stdout.write(`  by split: dev=${out.coverage.by_split.dev}, heldout=${out.coverage.by_split.heldout}\n`);
  process.stdout.write(`  by family:\n`);
  for (const [fam, counts] of Object.entries(perRelByFamily)) {
    process.stdout.write(`    ${fam}: callers=${counts.callers} callees=${counts.callees} impact=${counts.impact}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`build-probes: fatal ${err.stack || err.message}\n`);
  process.exit(1);
});
