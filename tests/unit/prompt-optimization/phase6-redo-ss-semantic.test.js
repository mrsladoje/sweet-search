/**
 * Unit tests for ss-semantic runner (gradeSpans) + aggregator (3-strategy
 * pickers). Mirrors the ss-find test structure.
 */

import { describe, it, expect } from 'vitest';
import { gradeSpans } from '../../../core/prompt-optimization/scripts/ss-semantic/track-a-runner-ss-semantic.mjs';
import {
  buildPerCellTable, buildPerFamilyTable, buildPerLanguageTable,
  pickGlobalBest, pickFamilyBests, pickWeightedBest,
} from '../../../core/prompt-optimization/scripts/ss-semantic/aggregate-track-a-ss-semantic.mjs';

const GOLD = { containingChunk: { startLine: 100, endLine: 120 } };

describe('gradeSpans — IoU rubric', () => {
  it('PASS when top-1 span IoU ≥ 0.5 with gold range', () => {
    const r = gradeSpans(GOLD, [{ startLine: 100, endLine: 120 }]); // perfect overlap
    expect(r.verdict).toBe('PASS');
    expect(r.top1_iou).toBeCloseTo(1.0);
  });

  it('PARTIAL when top-1 has some overlap < 0.5 IoU', () => {
    const r = gradeSpans(GOLD, [{ startLine: 95, endLine: 105 }]); // overlap 100-105 (6 lines) vs union 95-120 (26 lines) ≈ 0.23
    expect(r.verdict).toBe('PARTIAL');
    expect(r.top1_iou).toBeCloseTo(6 / 26);
  });

  it('FAIL when top-1 span has zero overlap', () => {
    const r = gradeSpans(GOLD, [{ startLine: 200, endLine: 300 }]);
    expect(r.verdict).toBe('FAIL');
    expect(r.top1_iou).toBe(0);
  });

  it('FAIL with no spans returned', () => {
    const r = gradeSpans(GOLD, []);
    expect(r.verdict).toBe('FAIL');
    expect(r.top1_iou).toBe(0);
  });

  it('max_iou tracks the best span across the result list', () => {
    const r = gradeSpans(GOLD, [
      { startLine: 200, endLine: 220 }, // top-1, no overlap
      { startLine: 100, endLine: 120 }, // perfect overlap, but not top-1
    ]);
    expect(r.top1_iou).toBe(0);
    expect(r.max_iou).toBeCloseTo(1.0);
    expect(r.verdict).toBe('FAIL'); // verdict still based on top-1
  });

  it('coverage = fraction of gold range covered by ANY span', () => {
    const r = gradeSpans(GOLD, [
      { startLine: 100, endLine: 109 }, // covers 10 lines of gold
      { startLine: 110, endLine: 120 }, // covers other 11 lines
    ]);
    expect(r.coverage).toBeCloseTo(1.0);
  });
});

function row({ gold, language, family, shape, iou }) {
  return {
    goldId: gold, language, family, goldClass: 'ast-tester',
    shape, top1_iou: iou, max_iou: iou, coverage: iou, precision: iou,
    verdict: iou >= 0.5 ? 'PASS' : iou > 0 ? 'PARTIAL' : 'FAIL',
  };
}

describe('aggregate-track-a-ss-semantic builders', () => {
  const rows = [
    row({ gold: 'A', language: 'rust', family: 'Systems-modular-terse', shape: 'V1', iou: 0.9 }),
    row({ gold: 'B', language: 'rust', family: 'Systems-modular-terse', shape: 'V1', iou: 0.7 }),
    row({ gold: 'A', language: 'rust', family: 'Systems-modular-terse', shape: 'V2', iou: 0.3 }),
    row({ gold: 'B', language: 'rust', family: 'Systems-modular-terse', shape: 'V2', iou: 0.4 }),
    row({ gold: 'C', language: 'typescript', family: 'JS-mobile', shape: 'V1', iou: 0.5 }),
    row({ gold: 'C', language: 'typescript', family: 'JS-mobile', shape: 'V2', iou: 0.8 }),
    // baseline rows ignored
    row({ gold: 'A', language: 'rust', family: 'Systems-modular-terse', shape: 'V_baseline', iou: 1.0 }),
  ];

  it('buildPerCellTable aggregates across all ast-tester golds, skips baseline', () => {
    const t = buildPerCellTable(rows);
    expect(t.V1.n).toBe(3);
    expect(t.V2.n).toBe(3);
    expect(t.V_baseline).toBeUndefined();
  });

  it('pickGlobalBest picks the highest-IoU cell', () => {
    const t = buildPerCellTable(rows);
    const best = pickGlobalBest(t);
    // V1 avg = (0.9 + 0.7 + 0.5) / 3 = 0.7
    // V2 avg = (0.3 + 0.4 + 0.8) / 3 = 0.5
    expect(best.shape).toBe('V1');
    expect(best.score).toBeCloseTo(0.7);
  });

  it('pickFamilyBests gives per-family winners', () => {
    const ft = buildPerFamilyTable(rows);
    const out = pickFamilyBests(ft);
    expect(out['Systems-modular-terse'].shape).toBe('V1'); // 0.8 avg vs V2 0.35
    expect(out['JS-mobile'].shape).toBe('V2');             // 0.8 vs V1 0.5
  });

  it('pickWeightedBest with diversity-enforcement skips simple_global pick', () => {
    const lt = buildPerLanguageTable(rows);
    // Equal weights → V1 wins (3 langs avg 0.7 vs V2 avg 0.5).
    const w = { rust: 1, typescript: 1 };
    const top = pickWeightedBest(lt, w);
    expect(top.shape).toBe('V1');
    // With excludeShape=V1, V2 should win as 2nd-best.
    const div = pickWeightedBest(lt, w, 'V1');
    expect(div.shape).toBe('V2');
    expect(div.diversityEnforced).toBe(true);
    expect(div.naturalWinner.shape).toBe('V1');
  });
});
