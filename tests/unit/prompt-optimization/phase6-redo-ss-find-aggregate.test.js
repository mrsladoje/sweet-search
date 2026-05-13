/**
 * Unit tests for ss-find aggregator (3-strategy emission per 2026-05-13 amendment).
 */

import { describe, it, expect } from 'vitest';
import {
  buildGlobalCellTable, buildFamilyCellTable, buildLanguageCellTable,
  pickGlobalBest, pickWeightedBest, pickFamilyBests,
  annotateRowsRelaxedDef,
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

describe('annotateRowsRelaxedDef + secondary metric tracking (2026-05-13 cross-tool audit)', () => {
  it('skips rows with fileRecallAt1=0 (relaxed_def = 0) and rows without an input (relaxed_def = null)', () => {
    const rows = [
      row({ gold: 'X1', language: 'rust', family: 'Systems-modular-terse', rCell: 'R2', qCell: 'Q3', file: 0, symbol: 0 }),
      row({ gold: 'X2', language: 'rust', family: 'Systems-modular-terse', rCell: 'R2', qCell: 'Q3', file: 1, symbol: 1 }),
    ];
    // No top1 wired in for X2 — rowRelaxedDef returns 0 because top1.file is null.
    const inputs = new Map([
      ['X1', { goldId: 'X1', language: 'rust', expectedSymbol: 'foo' }],
      // X2 deliberately missing — should land in skippedNoInput counter.
    ]);
    const stats = annotateRowsRelaxedDef({ rows, inputs, reposMap: new Map() });
    expect(stats.skippedNoInput).toBe(1);
    expect(rows[0].relaxedDefAt1).toBe(0); // file_recall=0 → short-circuit to 0
    expect(rows[1].relaxedDefAt1).toBe(null); // no input → null
  });

  it('cell tables track relaxed_def_at_1 and file_recall_at_5 alongside strict', () => {
    // Build a fixture with explicit relaxedDefAt1 set so we can verify the
    // tables aggregate it correctly without needing the locked repos.
    const rows = fixture();
    for (const r of rows) {
      r.relaxedDefAt1 = r.symbolRecallAt1; // straight passthrough for the test
    }
    const global = buildGlobalCellTable(rows);
    const fam = buildFamilyCellTable(rows);
    const lang = buildLanguageCellTable(rows);

    // Global R3|Q3: 2 rust passes (sym=1) + 2 ts fails (sym=0) = 2/4 strict.
    // relaxed_def mirrors strict here → 2/4. file_recall_at_5 mirrors fileRecallAt1 → 2/4.
    expect(global['R3|Q3'].relaxed_def_n).toBe(4);
    expect(global['R3|Q3'].relaxed_def).toBe(2);
    expect(global['R3|Q3'].file_recall_at_5).toBe(2);

    // By family JS-mobile R5|Q3: 2 ts passes → 2/2 strict + relaxed; file@5 = 2/2.
    expect(fam['JS-mobile']['R5|Q3'].relaxed_def_n).toBe(2);
    expect(fam['JS-mobile']['R5|Q3'].relaxed_def).toBe(2);

    // langTable carries the same fields per-language.
    expect(lang['R3|Q3|rust'].relaxed_def_n).toBe(2);
    expect(lang['R3|Q3|rust'].relaxed_def).toBe(2);
  });

  it('null relaxedDefAt1 rows are excluded from relaxed_def_n but still count toward strict n', () => {
    const rows = fixture();
    // Make 2 rows null → 6 contributing strict, 4 contributing relaxed_def.
    rows[0].relaxedDefAt1 = null;
    rows[2].relaxedDefAt1 = null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].relaxedDefAt1 !== null) rows[i].relaxedDefAt1 = rows[i].symbolRecallAt1;
    }
    rows[0].relaxedDefAt1 = null; rows[2].relaxedDefAt1 = null; // reassert after the loop
    const global = buildGlobalCellTable(rows);
    // R3|Q3 had n=4 strict rows; two of those rows have null relaxedDefAt1 → relaxed_def_n=2.
    expect(global['R3|Q3'].n).toBe(4);
    expect(global['R3|Q3'].relaxed_def_n).toBe(2);
  });
});
