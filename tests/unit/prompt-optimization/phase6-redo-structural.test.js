/**
 * Unit tests for the PHASE6_REDO structural redo (handoff 2026-05-14):
 *
 *   1) gradeStructural — Recall@5 / Precision@5 / F1@5 + verdict thresholds
 *   2) gradeStructural — 2-hop diagnostic for impact probes
 *   3) parser shim — all 15 phrasing templates fire the expected
 *      structuralType (regression guard against parser drift)
 *   4) aggregate-track-a-structural — table builders + 3-strategy pickers
 *      per relationship type + ranking_stability_check
 *
 * Mirrors phase6-redo-ss-semantic.test.js and ss-find aggregate tests.
 */

import { describe, it, expect } from 'vitest';
import {
  gradeStructural,
  parseStructuralQueryShim,
  TEMPLATES as RUNNER_TEMPLATES,
} from '../../../core/prompt-optimization/scripts/structural/track-a-runner-structural.mjs';
import {
  buildGlobalCellTable,
  buildFamilyCellTable,
  buildLanguageCellTable,
  pickGlobalBestForRelationship,
  pickFamilyBestForRelationship,
  pickWeightedBestForRelationship,
  buildRankingStabilityCheck,
} from '../../../core/prompt-optimization/scripts/structural/aggregate-track-a-structural.mjs';

// ─── 1) gradeStructural ───────────────────────────────────────────────

describe('gradeStructural — set-overlap rubric', () => {
  it('PASS when recall@5 >= 0.5', () => {
    const r = gradeStructural(['A', 'B', 'C'], ['A', 'B', 'X', 'Y'], 5);
    // recall = 2/4 = 0.5 → PASS
    expect(r.verdict).toBe('PASS');
    expect(r.recall_at_5).toBe(0.5);
    expect(r.n_matched).toBe(2);
    expect(r.n_expected).toBe(4);
  });

  it('PARTIAL when 0 < recall@5 < 0.5', () => {
    const r = gradeStructural(['A'], ['A', 'B', 'C', 'D', 'E'], 5);
    // recall = 1/5 = 0.2 → PARTIAL
    expect(r.verdict).toBe('PARTIAL');
    expect(r.recall_at_5).toBeCloseTo(0.2);
  });

  it('FAIL when recall@5 == 0', () => {
    const r = gradeStructural(['X', 'Y', 'Z'], ['A', 'B'], 5);
    expect(r.verdict).toBe('FAIL');
    expect(r.recall_at_5).toBe(0);
  });

  it('FAIL when nothing returned', () => {
    const r = gradeStructural([], ['A'], 5);
    expect(r.verdict).toBe('FAIL');
    expect(r.recall_at_5).toBe(0);
  });

  it('precision@5 is matches / k (not / min(k, expected))', () => {
    const r = gradeStructural(['A', 'B'], ['A', 'B'], 5);
    // k=5, 2 matches → precision = 2/5
    expect(r.precision_at_5).toBeCloseTo(0.4);
    expect(r.recall_at_5).toBe(1.0);
    expect(r.f1_at_5).toBeCloseTo((2 * 1.0 * 0.4) / (1.0 + 0.4));
  });

  it('top-k truncation: only the first 5 of returned counts', () => {
    // 6 returned, but only first 5 count for recall@5.
    const r = gradeStructural(['X', 'X', 'X', 'X', 'X', 'A'], ['A', 'B'], 5);
    expect(r.recall_at_5).toBe(0); // A is at index 5, outside top-5
  });

  it('computes recall_at_5_2hop when expected2Hop is provided (impact path)', () => {
    const expected = ['A', 'B'];
    const expected2Hop = ['A', 'B', 'C', 'D'];
    const r = gradeStructural(['A', 'C'], expected, 5, expected2Hop);
    expect(r.recall_at_5).toBe(0.5); // {A} ∩ {A,B} = 1, /2 = 0.5
    expect(r.recall_at_5_2hop).toBe(0.5); // {A,C} ∩ {A,B,C,D} = 2, /4 = 0.5
    expect(r.n_matched_2hop).toBe(2);
    expect(r.n_expected_2hop).toBe(4);
  });

  it('does not compute 2-hop when expected2Hop is null/undefined', () => {
    const r = gradeStructural(['A'], ['A'], 5, null);
    expect(r.recall_at_5_2hop).toBeUndefined();
  });
});

// ─── 2) Parser shim: all 15 templates must fire the right type ──────

describe('parseStructuralQueryShim — 15 phrasing templates must fire', () => {
  // Stop-rule guard: if any template falls through to hybrid, the sweep
  // would silently invalidate itself. This regression test catches drift
  // between TEMPLATES in the runner and STRUCTURAL_PATTERNS in
  // sweet-search.js.
  const SYM = 'TestSymbol';
  const flatten = [];
  for (const rel of Object.keys(RUNNER_TEMPLATES)) {
    for (const t of RUNNER_TEMPLATES[rel]) {
      flatten.push({ rel, id: t.id, label: t.label, query: t.tpl(SYM) });
    }
  }

  for (const { rel, id, query } of flatten) {
    it(`${rel}/${id}: "${query}" → ${rel}/${SYM}`, () => {
      const parsed = parseStructuralQueryShim(query);
      expect(parsed.structuralType).toBe(rel);
      expect(parsed.targetEntity).toBe(SYM);
    });
  }

  it('returns null/null when no pattern matches', () => {
    expect(parseStructuralQueryShim('how to fix the foo bug').structuralType).toBeNull();
  });
});

// ─── 3) Aggregator: table builders + pickers ─────────────────────────

function row({ probeId, language, family, relationship, phrasing, recall, precision = null, f1 = null, split = 'dev', recall2 = null, n2 = 0 }) {
  return {
    probeId, language, family, relationship, phrasing, split,
    recall_at_5: recall,
    precision_at_5: precision ?? recall / 2,
    f1_at_5: f1 ?? recall * 0.6,
    recall_at_5_2hop: recall2 ?? 0,
    n_expected_2hop: n2,
    verdict: recall >= 0.5 ? 'PASS' : recall > 0 ? 'PARTIAL' : 'FAIL',
  };
}

describe('aggregator — table builders', () => {
  const rows = [
    row({ probeId: 'A-callers', language: 'rust', family: 'Systems-modular-terse', relationship: 'callers', phrasing: 'P1', recall: 0.6 }),
    row({ probeId: 'A-callers', language: 'rust', family: 'Systems-modular-terse', relationship: 'callers', phrasing: 'P3', recall: 0.6 }),
    row({ probeId: 'B-callers', language: 'typescript', family: 'JS-mobile', relationship: 'callers', phrasing: 'P1', recall: 0.2 }),
    row({ probeId: 'B-callers', language: 'typescript', family: 'JS-mobile', relationship: 'callers', phrasing: 'P3', recall: 0.4 }),
    row({ probeId: 'A-callees', language: 'rust', family: 'Systems-modular-terse', relationship: 'callees', phrasing: 'P1', recall: 0.8 }),
    row({ probeId: 'A-callees', language: 'rust', family: 'Systems-modular-terse', relationship: 'callees', phrasing: 'P3', recall: 0.8 }),
    // baseline rows must be skipped
    row({ probeId: 'A-callers', language: 'rust', family: 'Systems-modular-terse', relationship: 'callers', phrasing: 'P_baseline', recall: 1.0 }),
  ];

  it('buildGlobalCellTable groups by relationship|phrasing and skips P_baseline', () => {
    const t = buildGlobalCellTable(rows);
    expect(t['callers|P_baseline']).toBeUndefined();
    expect(t['callers|P1'].n).toBe(2);
    expect(t['callees|P1'].n).toBe(1);
    expect(t['callers|P1'].recall_sum).toBeCloseTo(0.8); // 0.6 + 0.2
  });

  it('buildFamilyCellTable groups by family then by relationship|phrasing', () => {
    const ft = buildFamilyCellTable(rows);
    expect(ft['Systems-modular-terse']['callers|P1'].n).toBe(1);
    expect(ft['JS-mobile']['callers|P3'].n).toBe(1);
  });

  it('buildLanguageCellTable groups by relationship|phrasing|language', () => {
    const lt = buildLanguageCellTable(rows);
    expect(lt['callers|P1|rust'].n).toBe(1);
    expect(lt['callers|P3|typescript'].n).toBe(1);
  });
});

describe('aggregator — pickers per relationship type', () => {
  // Construct cells where P3 strictly wins for callers, P1 wins for callees.
  // Phrasing variance is unusual for structural (sweep finds ties everywhere)
  // but the picker must still pick the argmax when one exists.
  const rows = [
    row({ probeId: 'A-callers', language: 'rust', family: 'Systems-modular-terse', relationship: 'callers', phrasing: 'P1', recall: 0.4 }),
    row({ probeId: 'A-callers', language: 'rust', family: 'Systems-modular-terse', relationship: 'callers', phrasing: 'P3', recall: 0.8 }),
    row({ probeId: 'A-callees', language: 'rust', family: 'Systems-modular-terse', relationship: 'callees', phrasing: 'P1', recall: 0.9 }),
    row({ probeId: 'A-callees', language: 'rust', family: 'Systems-modular-terse', relationship: 'callees', phrasing: 'P3', recall: 0.5 }),
  ];

  it('pickGlobalBestForRelationship returns the argmax phrasing per relationship', () => {
    const gt = buildGlobalCellTable(rows);
    expect(pickGlobalBestForRelationship(gt, 'callers')).toBe('P3');
    expect(pickGlobalBestForRelationship(gt, 'callees')).toBe('P1');
  });

  it('tie-break prefers canonical order P3 > P2 > P1 > P4 > P5', () => {
    // All P1-P5 tie on recall=0.5 → tie-break to P3
    const tiedRows = ['P1', 'P2', 'P3', 'P4', 'P5'].map((p) =>
      row({ probeId: `X-callers`, language: 'rust', family: 'Systems-modular-terse', relationship: 'callers', phrasing: p, recall: 0.5 })
    );
    const gt = buildGlobalCellTable(tiedRows);
    expect(pickGlobalBestForRelationship(gt, 'callers')).toBe('P3');
  });

  it('pickFamilyBestForRelationship returns the per-family argmax', () => {
    const ft = buildFamilyCellTable(rows);
    expect(pickFamilyBestForRelationship(ft, 'Systems-modular-terse', 'callers')).toBe('P3');
    expect(pickFamilyBestForRelationship(ft, 'Systems-modular-terse', 'callees')).toBe('P1');
  });

  it('pickWeightedBestForRelationship weights per-language scores and argmax across phrasings', () => {
    const langRows = [
      row({ probeId: 'A-callers', language: 'typescript', family: 'JS-mobile', relationship: 'callers', phrasing: 'P1', recall: 0.9 }),
      row({ probeId: 'A-callers', language: 'typescript', family: 'JS-mobile', relationship: 'callers', phrasing: 'P3', recall: 0.5 }),
      row({ probeId: 'B-callers', language: 'scala', family: 'OO-monolithic', relationship: 'callers', phrasing: 'P1', recall: 0.0 }),
      row({ probeId: 'B-callers', language: 'scala', family: 'OO-monolithic', relationship: 'callers', phrasing: 'P3', recall: 1.0 }),
    ];
    const lt = buildLanguageCellTable(langRows);
    const w = { typescript: 5, scala: 1 };
    // P1 weighted: (5*0.9 + 1*0.0) / (5+1) = 4.5/6 = 0.75
    // P3 weighted: (5*0.5 + 1*1.0) / (5+1) = 3.5/6 ≈ 0.583
    const out = pickWeightedBestForRelationship(lt, w, 'callers');
    expect(out.phrasing).toBe('P1');
    expect(out.score).toBeCloseTo(4.5 / 6, 3);
  });
});

describe('aggregator — ranking stability check (rubric robustness)', () => {
  it('reports stable=true when argmax under recall/precision/f1 agree', () => {
    // Single-probe case where P3 wins on all three metrics.
    const rows = ['P1', 'P3'].map((p) => row({
      probeId: 'A-callers', language: 'rust', family: 'Systems-modular-terse',
      relationship: 'callers', phrasing: p,
      recall: p === 'P3' ? 0.8 : 0.4,
      precision: p === 'P3' ? 0.4 : 0.2,
      f1: p === 'P3' ? 0.5 : 0.25,
    }));
    const gt = buildGlobalCellTable(rows);
    const s = buildRankingStabilityCheck(gt);
    expect(s.callers.stable).toBe(true);
    expect(s.callers.argmax_recall_at_5).toBe('P3');
    expect(s.callers.argmax_precision_at_5).toBe('P3');
    expect(s.callers.argmax_f1_at_5).toBe('P3');
  });

  it('reports stable=false when rubrics disagree (different argmax)', () => {
    // P1 wins on recall, P3 wins on precision/f1.
    const rows = ['P1', 'P3'].map((p) => row({
      probeId: 'A-callers', language: 'rust', family: 'Systems-modular-terse',
      relationship: 'callers', phrasing: p,
      recall: p === 'P1' ? 0.9 : 0.5,
      precision: p === 'P1' ? 0.1 : 0.4,
      f1: p === 'P1' ? 0.18 : 0.44,
    }));
    const gt = buildGlobalCellTable(rows);
    const s = buildRankingStabilityCheck(gt);
    expect(s.callers.stable).toBe(false);
    expect(s.callers.argmax_recall_at_5).toBe('P1');
    expect(s.callers.argmax_precision_at_5).toBe('P3');
  });
});

// ─── 4) End-to-end: emitted artifact shape (smoke test against fixture) ─

describe('aggregator — artifact contract (smoke)', () => {
  // Smoke test: feeding the picker stack a small synthetic dataset
  // produces a non-null winner with the required fields. Catches if a
  // refactor breaks the integration shape.
  it('all 3 relationships yield a non-null simple_global pick', () => {
    const rows = [];
    for (const rel of ['callers', 'callees', 'impact']) {
      for (const p of ['P1', 'P2', 'P3', 'P4', 'P5']) {
        rows.push(row({
          probeId: `A-${rel}`, language: 'rust', family: 'Systems-modular-terse',
          relationship: rel, phrasing: p, recall: 0.6,
        }));
      }
    }
    const gt = buildGlobalCellTable(rows);
    for (const rel of ['callers', 'callees', 'impact']) {
      const p = pickGlobalBestForRelationship(gt, rel);
      expect(p).toBe('P3'); // tied → canonical tie-break
    }
  });
});
