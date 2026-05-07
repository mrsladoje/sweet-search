// Layer 2 deterministic ranking probes for the structural-trace tool.
//
// Auto-generates probes directly from the SQLite code graph, so:
//   - There is no hand labelling (and no held-out concept — the grader is
//     mechanical and the population is the graph itself).
//   - Probes scale with the graph; large repos yield hundreds of probes.
//   - Ranking-change A/Bs are statistically discriminable in a way the
//     20-task hand-curated bench cannot be.
//
// Each probe family asks one yes/no question about the top-K of a trace:
//
//   tests_demoted              — for symbols with ≥1 test-caller AND ≥3 prod
//                                 callers, no test caller should appear in
//                                 top-3 callers.
//   prod_first                 — for symbols with ≥3 prod callers, top-3
//                                 callers should all be from production paths.
//   pagerank_anchored          — for the top-fan-in symbols, the highest-PR
//                                 caller should appear in top-3 (validates PR
//                                 contribution).
//   callees_no_test_pollution  — mirror of tests_demoted for callees: when a
//                                 symbol has ≥1 prod callee AND ≥1 test-path
//                                 callee in the raw graph, the trace's top-3
//                                 callees should not include test paths.
//                                 Replaces the earlier callee_diverse family
//                                 (DEC-001), which punished correct file
//                                 locality and correct rejection of wrong
//                                 dynamic-dispatch resolutions.
//
// Each family can be enabled/disabled independently; aggregate pass rate is
// reported per family so a regression on one family is visible.

import Database from 'better-sqlite3';
import { applyReadPragmas } from '../../core/infrastructure/db-utils.js';

const TEST_PATH_RE = /(^|\/)(__tests__|tests?|spec|fixtures|examples?|docs?)(\/|$)|[-_.](test|spec)\.[cm]?[jt]sx?$|_test\.go$/;

function isTestPath(filePath = '') { return TEST_PATH_RE.test(String(filePath || '')); }

function pickTopByFanIn(db, opts = {}) {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const minFanIn = Math.max(1, opts.minFanIn ?? 3);
  return db.prepare(`
    SELECT e.id, e.name, e.type, e.file_path,
           COUNT(DISTINCT r.source_id) AS fan_in
    FROM entities e
    JOIN relationships r ON r.target_id = e.id
    WHERE e.stale_since IS NULL
      AND e.name IS NOT NULL
      AND r.type IN ('calls', 'uses', 'implements', 'extends', 'overrides')
    GROUP BY e.id
    HAVING fan_in >= ?
    ORDER BY fan_in DESC
    LIMIT ?
  `).all(minFanIn, limit);
}

function hasPageRankColumn(db) {
  try {
    return db.prepare('PRAGMA table_info(entities)').all().some(c => c.name === 'page_rank');
  } catch {
    return false;
  }
}

function callerSummary(db, targetId, hasPr) {
  const prSelect = hasPr ? 'COALESCE(e.page_rank, 0)' : '0';
  return db.prepare(`
    SELECT e.id, e.file_path, ${prSelect} AS pr
    FROM relationships r
    JOIN entities e ON e.id = r.source_id
    WHERE r.target_id = ?
      AND e.stale_since IS NULL
      AND r.type IN ('calls', 'uses', 'implements', 'extends', 'overrides')
  `).all(targetId);
}

function calleeSummary(db, sourceId) {
  return db.prepare(`
    SELECT e.id, e.file_path
    FROM relationships r
    JOIN entities e ON e.id = r.target_id
    WHERE r.source_id = ?
      AND e.stale_since IS NULL
      AND r.type = 'calls'
  `).all(sourceId);
}

/**
 * Generate Layer 2 probes from a code graph.
 *
 * @param {object} params
 * @param {string} params.dbPath
 * @param {object} [params.config]
 * @returns {Array<{ family, symbol, file, expect, meta }>} probe descriptors
 */
export function generateRankingProbes({ dbPath, config = {} }) {
  const db = new Database(dbPath, { readonly: true });
  applyReadPragmas(db);
  try {
    const probes = [];
    const hasPr = hasPageRankColumn(db);
    const top = pickTopByFanIn(db, { limit: config.symbolLimit ?? 60, minFanIn: 3 });
    for (const sym of top) {
      const callers = callerSummary(db, sym.id, hasPr);
      const prodCallers = callers.filter(c => !isTestPath(c.file_path));
      const testCallers = callers.filter(c => isTestPath(c.file_path));
      const callerFiles = new Set(callers.map(c => c.file_path));

      if (prodCallers.length >= 3 && testCallers.length >= 1) {
        probes.push({
          family: 'tests_demoted',
          symbol: sym.name,
          file: sym.file_path,
          expect: { topKExcludesTestPaths: 3 },
          meta: { fanIn: sym.fan_in, prodCallers: prodCallers.length, testCallers: testCallers.length },
        });
      }
      if (prodCallers.length >= 3) {
        probes.push({
          family: 'prod_first',
          symbol: sym.name,
          file: sym.file_path,
          expect: { topKAllProduction: 3 },
          meta: { fanIn: sym.fan_in, prodCallers: prodCallers.length },
        });
      }
      if (hasPr && prodCallers.length >= 3) {
        const sortedByPR = [...prodCallers].sort((a, b) => b.pr - a.pr);
        const topPR = sortedByPR[0];
        if (topPR && topPR.pr > 0) {
          probes.push({
            family: 'pagerank_anchored',
            symbol: sym.name,
            file: sym.file_path,
            expect: { topKContainsCallerId: { id: topPR.id, k: 3 } },
            meta: { fanIn: sym.fan_in, topPRCallerId: topPR.id, topPR: topPR.pr },
          });
        }
      }
      const callees = calleeSummary(db, sym.id);
      const prodCallees = callees.filter(c => c.file_path && !isTestPath(c.file_path));
      const testCallees = callees.filter(c => c.file_path && isTestPath(c.file_path));
      if (callees.length >= 3 && prodCallees.length >= 1 && testCallees.length >= 1) {
        probes.push({
          family: 'callees_no_test_pollution',
          symbol: sym.name,
          file: sym.file_path,
          expect: { calleeTopKExcludesTestPaths: 3 },
          meta: {
            calleeCount: callees.length,
            prodCallees: prodCallees.length,
            testCallees: testCallees.length,
          },
        });
      }
      if (probes.length >= (config.maxProbes ?? 400)) break;
    }
    return probes;
  } finally {
    db.close();
  }
}

/**
 * Grade a single probe given the trace builder's output.
 *
 * @param {object} probe
 * @param {object} trace - return value of StructuralContextBuilder.build()
 * @returns {{ pass: boolean, reason?: string }}
 */
export function gradeProbe(probe, trace) {
  if (!trace || !trace.target) return { pass: false, reason: 'no_target' };
  const callers = trace.sections?.callers?.items || [];
  const callees = trace.sections?.callees?.items || [];
  const exp = probe.expect || {};
  if (exp.topKExcludesTestPaths) {
    const k = exp.topKExcludesTestPaths;
    const top = callers.slice(0, k);
    if (!top.length) return { pass: false, reason: 'no_callers_returned' };
    const offender = top.find(item => isTestPath(item.file));
    if (offender) return { pass: false, reason: `test_caller_in_top_${k}: ${offender.file}` };
    return { pass: true };
  }
  if (exp.topKAllProduction) {
    const k = exp.topKAllProduction;
    const top = callers.slice(0, k);
    if (top.length < 1) return { pass: false, reason: 'no_callers_returned' };
    const offender = top.find(item => isTestPath(item.file));
    if (offender) return { pass: false, reason: `non_prod_in_top_${k}: ${offender.file}` };
    return { pass: true };
  }
  if (exp.topKContainsCallerId) {
    const { id, k } = exp.topKContainsCallerId;
    const top = callers.slice(0, k);
    if (!top.some(item => item.id === id)) {
      return { pass: false, reason: `pr_anchor_missing_top_${k}` };
    }
    return { pass: true };
  }
  if (exp.calleeTopKExcludesTestPaths) {
    const k = exp.calleeTopKExcludesTestPaths;
    const top = callees.slice(0, k);
    if (!top.length) return { pass: false, reason: 'no_callees_returned' };
    const offender = top.find(item => isTestPath(item.file));
    if (offender) return { pass: false, reason: `test_callee_in_top_${k}: ${offender.file}` };
    return { pass: true };
  }
  return { pass: false, reason: 'unknown_expectation' };
}

/**
 * Aggregate per-family pass rates from a list of graded probes.
 * @param {Array<{ probe, result }>} graded
 * @returns {Object<string, { n: number, passed: number, passRate: number }>}
 */
export function aggregateByFamily(graded) {
  const out = {};
  for (const { probe, result } of graded) {
    const fam = probe.family;
    if (!out[fam]) out[fam] = { n: 0, passed: 0, passRate: 0 };
    out[fam].n++;
    if (result.pass) out[fam].passed++;
  }
  for (const fam of Object.keys(out)) {
    out[fam].passRate = out[fam].n ? out[fam].passed / out[fam].n : 0;
  }
  return out;
}
