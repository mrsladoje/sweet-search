/**
 * Unit tests for ss-find R-template builders (PHASE6_REDO §12.1 + the
 * 2026-05-13 ss-find redo design).
 */

import { describe, it, expect } from 'vitest';
import {
  buildR1, buildR2, buildR3, buildR4, buildR5, buildR6, buildR7,
  buildAllRegexCells, regexEscape, pickPrimarySubToken, pickDomainTokens,
  pickNeighborSymbols, pickSiblingSymbolsFromChunk,
  FAMILY_DEF_KEYWORDS, R_CELLS, R_LABELS,
} from '../../../core/prompt-optimization/scripts/ss-find/r-templates.mjs';

const RS_008 = {
  goldId: 'RS-008',
  expectedSymbol: 'detect_package_root',
  family: 'Systems-modular-terse',
  goldQuery: 'detect_package_root function that walks ancestor directories to find a Python package root path',
  goldNotes: 'Walks ancestor directories looking for python module markers and namespace packages',
  graphNeighbors: {
    callers: [{ symbol: 'is_package', file: 'x.rs' }, { symbol: 'lint_file', file: 'y.rs' }],
    callees: [{ symbol: 'walk_ancestors', file: 'z.rs' }],
    implementors: [],
  },
};

const JV_001 = {
  goldId: 'JV-001',
  expectedSymbol: 'JsonReader',
  family: 'OO-monolithic',
  goldQuery: 'JsonReader class that parses JSON streams token by token',
  goldNotes: 'Pull parser for JSON values',
  graphNeighbors: { callers: [], callees: [], implementors: [] },
};

describe('regexEscape', () => {
  it('escapes regex metacharacters', () => {
    expect(regexEscape('a.b*c')).toBe('a\\.b\\*c');
    expect(regexEscape('foo(bar)')).toBe('foo\\(bar\\)');
    expect(regexEscape('plain')).toBe('plain');
  });
});

describe('pickPrimarySubToken', () => {
  it('returns the longest non-stopword sub-token ≥ 4 chars', () => {
    expect(pickPrimarySubToken('detect_package_root')).toBe('package');
    expect(pickPrimarySubToken('JsonReader')).toBe('reader'); // both Json + Reader qualify; tie-break longest
  });
  it('falls back to longest sub-token when none qualify', () => {
    expect(pickPrimarySubToken('a_bb_ccc')).toBe('ccc');
  });
});

describe('pickDomainTokens', () => {
  it('picks K distinct non-stopword content tokens', () => {
    const tokens = pickDomainTokens('walks ancestor directories to find python module markers', 4);
    expect(tokens).toEqual(['walks', 'ancestor', 'directories', 'find']);
  });
  it('excludes given sub-tokens', () => {
    const tokens = pickDomainTokens('detect package ancestor module', 4, { exclude: new Set(['detect', 'package']) });
    expect(tokens).toEqual(['ancestor', 'module']);
  });
});

describe('pickNeighborSymbols', () => {
  it('picks symbols from callers + callees, excluding the gold symbol', () => {
    const out = pickNeighborSymbols(RS_008.graphNeighbors, 2, 'detect_package_root');
    expect(out).toEqual(['is_package', 'lint_file']);
  });
  it('returns empty when no graph data', () => {
    expect(pickNeighborSymbols({ callers: [], callees: [] }, 2, 'X')).toEqual([]);
  });
});

describe('R1 — bare literal', () => {
  it('returns the symbol verbatim with escaping', () => {
    expect(buildR1(RS_008)).toBe('detect_package_root');
  });
});

describe('R2 — word-bounded literal', () => {
  it('wraps the symbol in \\b boundaries', () => {
    expect(buildR2(RS_008)).toBe('\\bdetect_package_root\\b');
  });
});

describe('R3 — definition-anchored', () => {
  it('prepends the family keyword set for Systems-modular-terse', () => {
    const r = buildR3(RS_008);
    expect(r).toBe(`\\b${FAMILY_DEF_KEYWORDS['Systems-modular-terse']}\\s+detect_package_root\\b`);
    expect(r).toContain('pub\\s+fn');
    expect(r).toContain('fn');
    expect(r).toContain('struct');
  });
  it('uses the OO-monolithic keyword set for Java', () => {
    const r = buildR3(JV_001);
    expect(r).toContain('class');
    expect(r).toContain('public');
  });
});

describe('R4 — wildcard around sub-token', () => {
  it('wraps the primary sub-token with \\w*', () => {
    expect(buildR4(RS_008)).toBe('\\b\\w*package\\w*\\b');
  });
});

describe('R5 — small alternation', () => {
  it('includes symbol + up to 2 graph neighbours when present', () => {
    expect(buildR5(RS_008)).toBe('\\b(detect_package_root|is_package|lint_file)\\b');
  });

  it('falls back to chunk-sibling identifiers when graph neighbours are empty (2026-05-13 fix)', () => {
    const input = {
      ...JV_001,
      containingChunk: { text: 'public class JsonReader extends Reader { public JsonToken peek() { ImportSection ref; Importable trait; } }' },
    };
    const r = buildR5(input);
    // Must pick 2 sibling identifiers from the chunk text (skipping the gold + java keywords)
    expect(r).toMatch(/^\\b\(JsonReader\|/);
    expect(r).toContain('JsonToken');
  });

  it('still falls back to symbol-only when neither graph nor chunk has siblings', () => {
    expect(buildR5(JV_001)).toBe('\\b(JsonReader)\\b');
  });
});

describe('pickSiblingSymbolsFromChunk', () => {
  it('picks identifier-shaped tokens from chunk text in first-appearance order', () => {
    const text = 'pub enum ImportType { Future, StandardLibrary, ThirdParty } impl Display for ImportType {} pub enum ImportSection { Known(ImportType), UserDefined(String) }';
    const out = pickSiblingSymbolsFromChunk(text, 'ImportType', 3);
    // Future (3-char PascalCase ≥3) and StandardLibrary appear before
    // ImportSection in the chunk, so they're picked first.
    expect(out).toEqual(['Future', 'StandardLibrary', 'ThirdParty']);
    expect(out).not.toContain('ImportType'); // gold excluded
  });

  it('picks ImportSection-style siblings when first 3 cells require more depth', () => {
    const text = 'pub enum ImportType { Future, StandardLibrary, ThirdParty } impl Display for ImportType {} pub enum ImportSection { Known(ImportType), UserDefined(String) }';
    const out = pickSiblingSymbolsFromChunk(text, 'ImportType', 5);
    expect(out).toContain('ImportSection');
    expect(out).toContain('Display');
  });

  it('skips language keywords like `pub`, `enum`, `impl`', () => {
    const text = 'pub enum E { A } impl Foo for E {}';
    const out = pickSiblingSymbolsFromChunk(text, 'X', 5);
    expect(out).not.toContain('pub');
    expect(out).not.toContain('enum');
    expect(out).not.toContain('impl');
    expect(out).toContain('Foo');
  });

  it('skips lowercase English words that are not identifier-shaped', () => {
    const text = 'parses values walks ancestors detects a package';
    const out = pickSiblingSymbolsFromChunk(text, 'X', 5);
    expect(out).toEqual([]); // none have uppercase / underscore / camelCase
  });

  it('returns empty for empty text', () => {
    expect(pickSiblingSymbolsFromChunk('', 'X', 3)).toEqual([]);
  });
});

describe('R6 — broad alternation', () => {
  it('picks 6 domain-content tokens from goldQuery + goldNotes', () => {
    const r = buildR6(RS_008);
    expect(r).toMatch(/^\\b\(/);
    expect(r).toMatch(/\)\\b$/);
    // Should NOT contain the symbol's sub-tokens (detect/package/root)
    expect(r).not.toContain('detect');
    expect(r).not.toContain('|package|');
    expect(r).not.toContain('|root|');
    // Should contain typical domain words from the corpus
    expect(r).toContain('ancestor');
  });
  it('falls back to R2 when corpus is too thin', () => {
    const thin = { ...RS_008, goldQuery: '', goldNotes: '' };
    expect(buildR6(thin)).toBe(buildR2(thin));
  });
});

describe('R7 — character-class shape pattern', () => {
  it('wraps the primary sub-token in [a-z_]* on each side', () => {
    expect(buildR7(RS_008)).toBe('\\b[a-z_]*package[a-z_]*\\b');
  });
});

describe('buildAllRegexCells', () => {
  it('returns all 7 cells as a map', () => {
    const cells = buildAllRegexCells(RS_008);
    expect(Object.keys(cells)).toEqual(R_CELLS);
    for (const c of R_CELLS) expect(typeof cells[c]).toBe('string');
    expect(R_LABELS.R3).toMatch(/definition-anchored/);
  });
});
