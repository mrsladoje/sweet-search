/**
 * Unit tests for core/prompt-optimization/scripts/aggregate-track-a.mjs.
 *
 * These exercise the bucketing, paired-vector construction, and the
 * §8.1 / §8.2 / §9 G3 / G5 logic against a synthetic Track A JSONL fixture
 * that's small enough to compute aggregates by hand.
 */

import { describe, it, expect } from 'vitest';
import {
  bucketRows,
  pairsForCell,
  perLanguageMean,
  perFamilyAggregate,
  macroAggregate,
  weightedAggregate,
  checkIntrafamilyStability,
  checkLeakage,
  pickDefault,
  pickFamilyOverrides,
} from '../../../core/prompt-optimization/scripts/aggregate-track-a.mjs';

function row({ gold, language, family, goldClass = 'ast-tester', shape, recall, score = 0.9, error = null }) {
  return {
    runId: 'unit',
    goldId: gold,
    language,
    family,
    goldClass,
    shape,
    shapeLabel: `label-${shape}`,
    query: `query for ${gold} ${shape}`,
    fileRecallAt1: recall,
    fileRecallAt5: recall,
    symbolRecallAt1: recall,
    verdict: recall ? 'PASS' : 'FAIL',
    scoreMargin: 0.1,
    error,
    top1: { score },
  };
}

// 2-language synthetic fixture inside one family ("Systems-modular-terse"):
//   - rust: 4 golds, baseline=2/4 PASS, V2 candidate=4/4 PASS
//   - go:   4 golds, baseline=1/4 PASS, V2 candidate=3/4 PASS
function fixtureBasic() {
  const rows = [];
  // Rust
  for (let i = 1; i <= 4; i++) {
    rows.push(row({ gold: `RS-00${i}`, language: 'rust', family: 'Systems-modular-terse', shape: 'V_baseline', recall: i <= 2 ? 1 : 0 }));
    rows.push(row({ gold: `RS-00${i}`, language: 'rust', family: 'Systems-modular-terse', shape: 'V2', recall: 1 }));
    // Other shapes get a single neutral row each so cell aggregates exist
    for (const s of ['V1', 'V3', 'V4', 'V5', 'V6', 'V7']) {
      rows.push(row({ gold: `RS-00${i}`, language: 'rust', family: 'Systems-modular-terse', shape: s, recall: 0 }));
    }
  }
  // Go
  for (let i = 1; i <= 4; i++) {
    rows.push(row({ gold: `GO-00${i}`, language: 'go', family: 'Systems-modular-terse', shape: 'V_baseline', recall: i <= 1 ? 1 : 0 }));
    rows.push(row({ gold: `GO-00${i}`, language: 'go', family: 'Systems-modular-terse', shape: 'V2', recall: i <= 3 ? 1 : 0 }));
    for (const s of ['V1', 'V3', 'V4', 'V5', 'V6', 'V7']) {
      rows.push(row({ gold: `GO-00${i}`, language: 'go', family: 'Systems-modular-terse', shape: s, recall: 0 }));
    }
  }
  return rows;
}

describe('bucketRows', () => {
  it('groups by gold and indexes shapes; normalises typescript-lib → typescript', () => {
    const rows = [
      row({ gold: 'TSL-001', language: 'typescript-lib', family: 'JS-mobile', shape: 'V_baseline', recall: 1 }),
      row({ gold: 'TSL-001', language: 'typescript-lib', family: 'JS-mobile', shape: 'V2', recall: 0 }),
    ];
    const { byGold, byLanguage } = bucketRows(rows);
    expect(byGold.size).toBe(1);
    const g = byGold.get('TSL-001');
    expect(g.language).toBe('typescript'); // normalized
    expect(g.shapes.get('V2').fileRecallAt1).toBe(0);
    expect(byLanguage.has('typescript')).toBe(true);
  });
});

describe('pairsForCell — baseline vs candidate', () => {
  it('returns paired vectors only for golds that have BOTH rows', () => {
    const { byGold } = bucketRows(fixtureBasic());
    const { baseline, candidate, meta } = pairsForCell({ byGold, family: 'Systems-modular-terse', shape: 'V2' });
    expect(baseline.length).toBe(8); // 4 rust + 4 go
    expect(candidate.length).toBe(8);
    expect(meta.length).toBe(8);
    // Rust pairs: baseline [1,1,0,0], candidate [1,1,1,1]
    // Go    pairs: baseline [1,0,0,0], candidate [1,1,1,0]
    expect(baseline.reduce((s, x) => s + x, 0)).toBe(3); // 2 rust + 1 go
    expect(candidate.reduce((s, x) => s + x, 0)).toBe(7);
  });

  it('skips golds with errors', () => {
    const rows = [
      row({ gold: 'RS-001', language: 'rust', family: 'Systems-modular-terse', shape: 'V_baseline', recall: 1 }),
      row({ gold: 'RS-001', language: 'rust', family: 'Systems-modular-terse', shape: 'V2', recall: 0, error: 'crashed' }),
    ];
    const { byGold } = bucketRows(rows);
    const { baseline } = pairsForCell({ byGold, family: 'Systems-modular-terse', shape: 'V2' });
    expect(baseline.length).toBe(0);
  });
});

describe('perLanguageMean / perFamilyAggregate / macro / weighted', () => {
  it('computes per-language mean over that language\'s golds', () => {
    const { byGold } = bucketRows(fixtureBasic());
    const { mean: m, n } = perLanguageMean({ byGold, language: 'rust', shape: 'V2' });
    expect(m).toBe(1.0);
    expect(n).toBe(4);
  });

  it('family aggregate averages language means uniformly within the family', () => {
    const { byGold } = bucketRows(fixtureBasic());
    const agg = perFamilyAggregate({ byGold, family: 'Systems-modular-terse', shape: 'V2' });
    // rust mean = 4/4 = 1.0; go mean = 3/4 = 0.75; uniform avg = 0.875
    expect(agg.mean).toBeCloseTo(0.875);
    expect(agg.nLangs).toBe(2);
    expect(agg.nPairs).toBe(8);
  });

  it('macro aggregate uniform across ALL 18 covered languages (missing = excluded)', () => {
    const { byGold } = bucketRows(fixtureBasic());
    const m = macroAggregate({ byGold, shape: 'V2' });
    // Only rust + go present; macro = (1.0 + 0.75) / 2 = 0.875
    expect(m).toBeCloseTo(0.875);
  });

  it('weighted aggregate respects §7 tier weights (rust=3, go=2)', () => {
    const { byGold } = bucketRows(fixtureBasic());
    const w = weightedAggregate({ byGold, shape: 'V2' });
    // (3 × 1.0 + 2 × 0.75) / (3 + 2) = (3 + 1.5) / 5 = 0.9
    expect(w).toBeCloseTo(0.9);
  });
});

describe('checkIntrafamilyStability — G5', () => {
  it('passes when worst-language ≥ 0.6 × best-language', () => {
    const { byGold } = bucketRows(fixtureBasic());
    const r = checkIntrafamilyStability({ byGold, family: 'Systems-modular-terse', shape: 'V2' });
    // rust 1.0, go 0.75 → ratio 0.75 ≥ 0.6 → pass
    expect(r.gate).toBe('pass');
  });

  it('fails when one language drops below 0.6 × best', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) =>
        row({ gold: `RS-00${i + 1}`, language: 'rust', family: 'Systems-modular-terse', shape: 'V_baseline', recall: 0 })),
      ...Array.from({ length: 4 }, (_, i) =>
        row({ gold: `RS-00${i + 1}`, language: 'rust', family: 'Systems-modular-terse', shape: 'V2', recall: 1 })),
      ...Array.from({ length: 4 }, (_, i) =>
        row({ gold: `GO-00${i + 1}`, language: 'go', family: 'Systems-modular-terse', shape: 'V_baseline', recall: 0 })),
      ...Array.from({ length: 4 }, (_, i) =>
        row({ gold: `GO-00${i + 1}`, language: 'go', family: 'Systems-modular-terse', shape: 'V2', recall: i === 0 ? 1 : 0 })),
    ];
    const { byGold } = bucketRows(rows);
    const r = checkIntrafamilyStability({ byGold, family: 'Systems-modular-terse', shape: 'V2' });
    // rust 1.0, go 0.25 → ratio 0.25 → fail
    expect(r.gate).toBe('fail');
    expect(r.ratio).toBeCloseTo(0.25);
  });
});

describe('checkLeakage — G3', () => {
  const corpus = ['the foo bar baz quux query'];
  const whitelist = new Set(['v1', 'v2', 'rust', 'python']);

  it('returns pass when no 3-gram in candidate appears in corpus', () => {
    expect(checkLeakage('use a short interrogative query', whitelist, corpus).gate).toBe('pass');
  });

  it('returns fail when a non-whitelisted 3-gram from the corpus leaks', () => {
    const r = checkLeakage('the foo bar baz', whitelist, corpus);
    expect(r.gate).toBe('fail');
    expect(r.leaks.length).toBeGreaterThan(0);
  });

  it('whitelists pure language-name 3-grams', () => {
    const r = checkLeakage('v1 v2 rust', whitelist, corpus);
    expect(r.gate).toBe('pass');
  });

  it('marks empty text as pending', () => {
    expect(checkLeakage('', whitelist, corpus).gate).toBe('pending-no-text');
  });
});

describe('pickDefault / pickFamilyOverrides', () => {
  function fakeCellTable({ winnerShape = 'V2', otherShape = 'V3', winnerMean = 0.9, otherMean = 0.5 } = {}) {
    const t = {};
    for (const family of ['OO-monolithic', 'Systems-modular-terse', 'C-family', 'JS-mobile', 'Scripting-dynamic']) {
      t[family] = {};
      for (const s of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7']) {
        t[family][s] = {
          candidateMean: s === winnerShape ? winnerMean : (s === otherShape ? otherMean : 0.3),
          fdrSurvives: s === winnerShape,
          nPairs: 8,
        };
      }
    }
    return t;
  }
  function fakeGlobals(shape, weighted) {
    const g = {};
    for (const s of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7']) {
      // New nested shape: globalAggs[shape].file_recall.{macro,weighted}
      // The default primary_metric is fileRecallAt1, so populate that branch.
      const v = s === shape ? weighted : 0.3;
      g[s] = {
        file_recall: { macro: v, weighted: v },
        symbol_recall: { macro: v, weighted: v },
      };
    }
    return g;
  }

  it('picks the weighted winner when it is within 3pp of every family-best', () => {
    const cellTable = fakeCellTable({ winnerShape: 'V2', winnerMean: 0.9, otherMean: 0.8 });
    const globalAggs = fakeGlobals('V2', 0.85);
    const d = pickDefault({ globalAggs, cellTable });
    expect(d.shape).toBe('V2');
    expect(d.gates.weighted_winner).toBe('pass');
    expect(d.gates.within_threshold_all_families).toBe('pass');
  });

  it('returns shape=null when family-best is > 3pp above weighted winner', () => {
    // V2 is weighted winner at 0.9, but V3's per-family is 0.99 → drop > 3pp → fail
    const cellTable = fakeCellTable({ winnerShape: 'V2', winnerMean: 0.9, otherShape: 'V3', otherMean: 0.99 });
    const globalAggs = fakeGlobals('V2', 0.85);
    const d = pickDefault({ globalAggs, cellTable });
    expect(d.shape).toBe(null);
    expect(d.gates.within_threshold_all_families).toBe('fail');
  });

  it('flags family override only when delta ≥ 8pp and no other family regresses > 3pp', () => {
    const cellTable = fakeCellTable({ winnerShape: 'V2', winnerMean: 0.7, otherMean: 0.65 });
    // Boost OO-monolithic V4 to 0.9 (delta 0.2 vs V2's 0.7) and keep other families' V4 close to V2.
    for (const f of ['Systems-modular-terse', 'C-family', 'JS-mobile', 'Scripting-dynamic']) {
      cellTable[f]['V4'] = { candidateMean: 0.7, fdrSurvives: true, nPairs: 8 };
    }
    cellTable['OO-monolithic']['V4'] = { candidateMean: 0.9, fdrSurvives: true, nPairs: 8 };
    const defaultDecision = { shape: 'V2' };
    const byGold = new Map(); // empty — stability check returns insufficient-langs (won't gate text)
    const overrides = pickFamilyOverrides({ defaultDecision, cellTable, byGold });
    expect(overrides['OO-monolithic']?.shape).toBe('V4');
    expect(overrides['OO-monolithic']?.delta_vs_default).toBeCloseTo(0.2);
  });
});
