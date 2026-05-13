/**
 * Unit tests for ss-find aggregator (3-strategy emission per 2026-05-13 amendment).
 */

import { describe, it, expect } from 'vitest';
import {
  buildGlobalCellTable, buildFamilyCellTable, buildLanguageCellTable,
  pickGlobalBest, pickWeightedBest, pickFamilyBests,
} from '../../../core/prompt-optimization/scripts/ss-find/aggregate-track-a-ss-find.mjs';

function row({ gold, language, family, rCell, qCell, file, symbol, error = null }) {
  return {
    goldId: gold, language, family, goldClass: 'ast-tester',
    rCell, qCell, shapeLabel: `${rCell}|${qCell}`,
    regex: 'x', query: 'y',
    fileRecallAt1: file, fileRecallAt5: file, symbolRecallAt1: symbol,
    verdict: file && symbol ? 'PASS' : file ? 'PARTIAL' : 'FAIL',
    error,
  };
}

function fixture() {
  // 2-language synthetic: rust (Systems-modular-terse) + typescript (JS-mobile).
  // Each gets 2 golds × 2 cells.
  const rows = [];
  for (let i = 1; i <= 2; i++) {
    rows.push(row({ gold: `RS-${i}`, language: 'rust', family: 'Systems-modular-terse', rCell: 'R3', qCell: 'Q3', file: 1, symbol: 1 }));
    rows.push(row({ gold: `RS-${i}`, language: 'rust', family: 'Systems-modular-terse', rCell: 'R5', qCell: 'Q3', file: 1, symbol: 0 }));
  }
  for (let i = 1; i <= 2; i++) {
    rows.push(row({ gold: `TS-${i}`, language: 'typescript', family: 'JS-mobile', rCell: 'R3', qCell: 'Q3', file: 0, symbol: 0 }));
    rows.push(row({ gold: `TS-${i}`, language: 'typescript', family: 'JS-mobile', rCell: 'R5', qCell: 'Q3', file: 1, symbol: 1 }));
  }
  return rows;
}

describe('buildGlobalCellTable', () => {
  it('aggregates over all ast-tester golds and skips baseline', () => {
    const rows = [
      ...fixture(),
      // baseline row should be ignored
      row({ gold: 'RS-1', language: 'rust', family: 'Systems-modular-terse', rCell: 'R2_baseline', qCell: 'R2_baseline', file: 1, symbol: 1 }),
    ];
    const t = buildGlobalCellTable(rows);
    expect(t['R3|Q3'].n).toBe(4);
    expect(t['R3|Q3'].file).toBe(2); // 2 rust + 0 typescript
    expect(t['R5|Q3'].n).toBe(4);
    expect(t['R5|Q3'].file).toBe(4);
    expect(t['R2_baseline|R2_baseline']).toBeUndefined();
  });
});

describe('pickGlobalBest', () => {
  it('returns the highest-scoring (R, Q) on the chosen metric', () => {
    // Custom fixture with a distinct winner — R3|Q3 wins symbol_recall.
    const rows = [
      row({ gold: 'A', language: 'rust', family: 'Systems-modular-terse', rCell: 'R3', qCell: 'Q3', file: 1, symbol: 1 }),
      row({ gold: 'B', language: 'rust', family: 'Systems-modular-terse', rCell: 'R3', qCell: 'Q3', file: 1, symbol: 1 }),
      row({ gold: 'A', language: 'rust', family: 'Systems-modular-terse', rCell: 'R5', qCell: 'Q3', file: 1, symbol: 0 }),
      row({ gold: 'B', language: 'rust', family: 'Systems-modular-terse', rCell: 'R5', qCell: 'Q3', file: 1, symbol: 0 }),
    ];
    const t = buildGlobalCellTable(rows);
    const best = pickGlobalBest(t, 'sym');
    expect(best.cell).toBe('R3|Q3');
    expect(best.score).toBeCloseTo(1.0);
  });
});

describe('pickFamilyBests', () => {
  it('picks the best (R, Q) per family independently', () => {
    const ft = buildFamilyCellTable(fixture());
    const best = pickFamilyBests(ft, 'sym');
    expect(best['Systems-modular-terse'].cell).toBe('R3|Q3'); // rust prefers R3
    expect(best['JS-mobile'].cell).toBe('R5|Q3');             // typescript prefers R5
  });
});

describe('pickWeightedBest', () => {
  it('returns natural winner when no exclusion supplied', () => {
    const lt = buildLanguageCellTable(fixture());
    const w = { rust: 1, typescript: 1 };
    const best = pickWeightedBest(lt, w, 'sym');
    expect(best.cell).toBeTruthy();
    expect(best.diversityEnforced).toBe(false);
  });

  it('promotes 2nd-best when natural winner matches excludeCell', () => {
    const lt = buildLanguageCellTable(fixture());
    // typescript heavy weighting → R5|Q3 wins (typescript prefers it).
    const w = { rust: 1, typescript: 5 };
    const naturalBest = pickWeightedBest(lt, w, 'sym');
    expect(naturalBest.cell).toBe('R5|Q3');
    // Now ask for diversity-enforced pick excluding R5|Q3:
    const diversity = pickWeightedBest(lt, w, 'sym', 'R5|Q3');
    expect(diversity.cell).toBe('R3|Q3');
    expect(diversity.diversityEnforced).toBe(true);
    expect(diversity.naturalWinner.cell).toBe('R5|Q3');
  });

  it('respects per-language weighting in the aggregate', () => {
    const lt = buildLanguageCellTable(fixture());
    // Rust gets weight 10, typescript weight 1 → R3|Q3 (rust-preferred) wins.
    const w = { rust: 10, typescript: 1 };
    const best = pickWeightedBest(lt, w, 'sym');
    expect(best.cell).toBe('R3|Q3');
  });
});
