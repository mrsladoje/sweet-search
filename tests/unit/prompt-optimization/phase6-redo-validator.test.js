/**
 * Unit tests for core/prompt-optimization/scripts/validator.mjs (PHASE6_REDO
 * §5.3 + §5.5.6). The validator is the load-bearing quality gate — every
 * symbol-leak / length / path-leak rule must be exercised here, including the
 * §5.5.6 worked example ("packaging" leaks "package" but "directories" does
 * not).
 */

import { describe, it, expect } from 'vitest';
import {
  validateVariant,
  pathTokens,
  symbolSubTokens,
  longestCommonSubstringLen,
  commonPrefixLen,
  commonSuffixLen,
  sharesStem,
  detectPathTokenLeak,
  detectQueryStemLeak,
  queryLexicalTokens,
  whitespaceTokenCount,
  PATH_STOPWORDS,
} from '../../../core/prompt-optimization/scripts/validator.mjs';

const RS_001_INPUT = {
  goldId: 'RS-001',
  goldClass: 'ast-tester',
  expectedFile: 'crates/ruff_linter/src/rules/isort/categorize.rs',
  expectedSymbol: 'ImportType',
  pathTokens: ['crates', 'ruff', 'linter', 'src', 'rules', 'isort', 'categorize'],
};

const RS_008_INPUT = {
  goldId: 'RS-008',
  goldClass: 'ast-tester',
  expectedFile: 'crates/ruff_linter/src/packaging.rs',
  expectedSymbol: 'detect_package_root',
  pathTokens: ['crates', 'ruff', 'linter', 'src', 'packaging'],
};

const DOC_INPUT = {
  goldId: 'DP-TS-001',
  goldClass: 'doc-positive',
  expectedFile: 'LICENSE',
  expectedSymbol: null,
  pathTokens: ['license'],
};

describe('whitespaceTokenCount', () => {
  it('counts whitespace-split tokens, not BPE', () => {
    expect(whitespaceTokenCount('a b c')).toBe(3);
    expect(whitespaceTokenCount('a  b\tc\nd')).toBe(4);
    expect(whitespaceTokenCount('singleword')).toBe(1);
    expect(whitespaceTokenCount('   ')).toBe(0);
    expect(whitespaceTokenCount('')).toBe(0);
  });
});

describe('pathTokens / symbolSubTokens', () => {
  it('splits paths on /, _, ., -', () => {
    expect(pathTokens('crates/ruff_linter/src/packaging.rs'))
      .toEqual(['crates', 'ruff', 'linter', 'src', 'packaging', 'rs']);
  });

  it('splits symbol on underscore AND camelCase boundaries (2026-05-13 fix)', () => {
    expect(symbolSubTokens('detect_package_root')).toEqual(['detect', 'package', 'root']);
    expect(symbolSubTokens('ImportType')).toEqual(['import', 'type']);
    expect(symbolSubTokens('redisReaderGetReply')).toEqual(['redis', 'reader', 'get', 'reply']);
    expect(symbolSubTokens('RedisConnectWithOptions')).toEqual(['redis', 'connect', 'with', 'options']);
    expect(symbolSubTokens('HTTPSConnection')).toEqual(['https', 'connection']);
    expect(symbolSubTokens('lint_fix')).toEqual(['lint', 'fix']);
    expect(symbolSubTokens('mixed_caseFoo')).toEqual(['mixed', 'case', 'foo']);
  });

  it('handles null / empty', () => {
    expect(pathTokens(null)).toEqual([]);
    expect(symbolSubTokens('')).toEqual([]);
  });
});

describe('longestCommonSubstringLen', () => {
  it('finds the longest common substring', () => {
    expect(longestCommonSubstringLen('packaging', 'package')).toBe(6); // "packag"
    expect(longestCommonSubstringLen('rust', 'busted')).toBe(3); // "ust"
    expect(longestCommonSubstringLen('abc', 'xyz')).toBe(0);
    expect(longestCommonSubstringLen('', 'abc')).toBe(0);
  });
});

describe('commonPrefixLen / commonSuffixLen', () => {
  it('finds shared leading and trailing stems', () => {
    expect(commonPrefixLen('packaging', 'package')).toBe(6); // "packag"
    expect(commonSuffixLen('preflight', 'flight')).toBe(6);  // "flight"
    expect(commonPrefixLen('abc', 'xyz')).toBe(0);
    expect(commonSuffixLen('rust', 'flask')).toBe(0);
  });
});

describe('sharesStem', () => {
  it('flags ≥ 5-char shared leading stem (PHASE6_REDO worked example A)', () => {
    expect(sharesStem('packaging', 'package')).toBe(true);  // shared prefix "packag"
  });

  it('flags ≥ 5-char shared trailing stem', () => {
    expect(sharesStem('preflight', 'flight')).toBe(true);   // shared suffix "flight"
  });

  it('does NOT flag shorter shared prefix (<5 chars)', () => {
    expect(sharesStem('directories', 'dir')).toBe(false);   // shared prefix only 3 chars
  });

  it('does NOT flag unrelated tokens', () => {
    expect(sharesStem('python', 'cobra')).toBe(false);
    expect(sharesStem('python', '')).toBe(false);
  });
});

describe('detectPathTokenLeak (§5.3 check 5 + §5.5.6 stopwords)', () => {
  it('REJECTS "packaging" against detect_package_root sub-tokens (worked example A)', () => {
    const sub = symbolSubTokens('detect_package_root');
    expect(detectPathTokenLeak('packaging', sub)).toBe('package');
  });

  it('ALLOWS "directories" against detect_package_root sub-tokens (worked example B)', () => {
    const sub = symbolSubTokens('detect_package_root');
    expect(detectPathTokenLeak('directories', sub)).toBe(null);
  });

  it('skips path tokens shorter than 4 chars', () => {
    const sub = symbolSubTokens('detect_package_root');
    expect(detectPathTokenLeak('pak', sub)).toBe(null); // even though "pak" shares chars
  });

  it('skips path tokens in the stopword list', () => {
    expect(PATH_STOPWORDS.has('crates')).toBe(true);
    expect(PATH_STOPWORDS.has('src')).toBe(true);
    // "crates" would otherwise match symbols like "crate_root" but stopword skips it.
    const sub = symbolSubTokens('crate_root');
    expect(detectPathTokenLeak('crates', sub)).toBe(null);
  });
});

describe('validateVariant — schema (check 1)', () => {
  it('rejects non-object output', () => {
    expect(validateVariant(null, 'V2', RS_001_INPUT).ok).toBe(false);
    expect(validateVariant('a string', 'V2', RS_001_INPUT).ok).toBe(false);
    expect(validateVariant([], 'V2', RS_001_INPUT).ok).toBe(false);
  });

  it('rejects missing or empty query', () => {
    expect(validateVariant({}, 'V2', RS_001_INPUT).ok).toBe(false);
    expect(validateVariant({ query: '' }, 'V2', RS_001_INPUT).ok).toBe(false);
  });

  it('rejects unknown shape cell', () => {
    const v = validateVariant({ query: 'find ImportType' }, 'V9', RS_001_INPUT);
    expect(v.ok).toBe(false);
    expect(v.check).toBe('1-schema');
  });

  it('rejects non-string rationale', () => {
    const v = validateVariant({ query: 'ImportType', rationale: 42 }, 'V1', RS_001_INPUT);
    expect(v.ok).toBe(false);
  });
});

describe('validateVariant — length tier (check 2)', () => {
  it('V1: ≤ 3 tokens', () => {
    expect(validateVariant({ query: 'ImportType' }, 'V1', RS_001_INPUT).ok).toBe(true);
    expect(validateVariant({ query: 'find the ImportType enum' }, 'V1', RS_001_INPUT).ok).toBe(false);
  });

  it('V2: 4-8 tokens (with-symbol)', () => {
    expect(validateVariant({ query: 'where is ImportType enum defined' }, 'V2', RS_001_INPUT).ok).toBe(true);
    expect(validateVariant({ query: 'ImportType' }, 'V2', RS_001_INPUT).ok).toBe(false); // too short
    expect(validateVariant(
      { query: 'where is the ImportType enum literally defined inside ruff' },
      'V2',
      RS_001_INPUT,
    ).ok).toBe(false); // too long (9 tokens)
  });

  it('V6: ≥ 16 tokens (long-NL, without-symbol)', () => {
    const long = Array(16).fill('word').join(' ');
    expect(validateVariant({ query: long }, 'V6', RS_001_INPUT).ok).toBe(true);
    const tooShort = Array(15).fill('word').join(' ');
    expect(validateVariant({ query: tooShort }, 'V6', RS_001_INPUT).ok).toBe(false);
  });

  it('V7: 9-15 tokens (with-symbol, declarative, medium tier per §5)', () => {
    expect(validateVariant(
      { query: 'ImportType enum that classifies python imports into standard third party and first party' },
      'V7',
      RS_001_INPUT,
    ).ok).toBe(true);
    // 5 tokens is too short for V7 — that's the V2 tier.
    expect(validateVariant(
      { query: 'ImportType enum classifies imports' },
      'V7',
      RS_001_INPUT,
    ).ok).toBe(false);
  });
});

describe('validateVariant — symbol presence (check 3, V1/V2/V4/V7)', () => {
  it('V1 requires verbatim expectedSymbol', () => {
    expect(validateVariant({ query: 'ImportType' }, 'V1', RS_001_INPUT).ok).toBe(true);
    const v = validateVariant({ query: 'something' }, 'V1', RS_001_INPUT);
    expect(v.ok).toBe(false);
    expect(v.check).toBe('3-symbol-presence');
  });

  it('V2 requires verbatim expectedSymbol (case-sensitive)', () => {
    expect(validateVariant({ query: 'where is ImportType defined' }, 'V2', RS_001_INPUT).ok).toBe(true);
    const v = validateVariant({ query: 'where is importtype defined' }, 'V2', RS_001_INPUT);
    expect(v.ok).toBe(false); // case-sensitive presence check
    expect(v.check).toBe('3-symbol-presence');
  });

  it('V4 requires verbatim expectedSymbol', () => {
    const v = validateVariant(
      { query: 'how does the import classification system tag stdlib vs third-party' },
      'V4',
      RS_001_INPUT,
    );
    expect(v.ok).toBe(false); // no ImportType in query
    expect(v.check).toBe('3-symbol-presence');
  });
});

describe('validateVariant — symbol leak (check 4, V3/V5/V6)', () => {
  it('V3 forbids expectedSymbol substring (case-insensitive)', () => {
    // The accepted query must avoid both the full symbol AND its sub-token
    // stems ("import" leaks "importtype" by ≥ 5-char shared prefix).
    expect(validateVariant(
      { query: 'rules that group python files into stdlib third party first party sections' },
      'V3',
      RS_001_INPUT,
    ).ok).toBe(true);
    const v = validateVariant(
      { query: 'the importtype enumeration that classifies all python imports into categories' },
      'V3',
      RS_001_INPUT,
    );
    expect(v.ok).toBe(false);
    expect(v.check).toBe('4-symbol-leak');
  });

  it('V5 forbids expectedSymbol substring', () => {
    const v = validateVariant(
      { query: 'how do we classify ImportType across the linter codebase generally' },
      'V5',
      RS_001_INPUT,
    );
    expect(v.ok).toBe(false);
    expect(v.check).toBe('4-symbol-leak');
  });
});

describe('queryLexicalTokens', () => {
  it('splits on whitespace AND identifier separators _ - . /', () => {
    expect(queryLexicalTokens('uses is_package and ancestors')).toEqual(['uses', 'is', 'package', 'and', 'ancestors']);
    expect(queryLexicalTokens('detect-package.root/here')).toEqual(['detect', 'package', 'root', 'here']);
  });
});

describe('detectQueryStemLeak (§5.3 check 5b — added 2026-05-13)', () => {
  const RS_008_SUBS = symbolSubTokens('detect_package_root');

  it('REJECTS V3 query containing a sub-token verbatim ("package")', () => {
    const r = detectQueryStemLeak(
      'function that uses is_package and ancestors to locate root package directory',
      RS_008_SUBS,
    );
    expect(r).toBeTruthy();
    // The first leak surfaced determines the report; allow either "package" or
    // "is_package"-decomposed "package".
    expect(r.subToken).toBe('package');
  });

  it('REJECTS V3 query containing a morphological variant ("packages")', () => {
    const r = detectQueryStemLeak('what determines if a project has multiple packages or not', RS_008_SUBS);
    expect(r?.subToken).toBe('package');
  });

  it('ALLOWS V3 query with synonyms only', () => {
    expect(detectQueryStemLeak(
      'helper that walks ancestor directories looking for python module markers',
      RS_008_SUBS,
    )).toBe(null);
  });

  it('ALLOWS query tokens that only coincidentally share a fragment (<5-char stem)', () => {
    // "rooted" shares "root" (4 chars) with sub-token "root" — common prefix 4 < 5.
    // Note: the rule requires ≥ 5-char common prefix or suffix, so "root" (4 chars) by
    // itself can never satisfy the constraint against any other token. This is the
    // documented trade-off: very short sub-tokens cannot be leaked individually.
    expect(detectQueryStemLeak('rooted in tradition', RS_008_SUBS)).toBe(null);
  });

  it('skips tiny sub-tokens (<4 chars) so common English words are not flagged', () => {
    const tinySub = symbolSubTokens('a_b_c'); // ['a','b','c'] — all <4 chars
    expect(detectQueryStemLeak('a generic English query', tinySub)).toBe(null);
  });
});

describe('validateVariant — query-stem leak (check 5b, V3/V5/V6)', () => {
  const RS_008_INPUT_LOCAL = {
    goldId: 'RS-008',
    goldClass: 'ast-tester',
    expectedFile: 'crates/ruff_linter/src/packaging.rs',
    expectedSymbol: 'detect_package_root',
    pathTokens: ['crates', 'ruff', 'linter', 'src', 'packaging'],
  };

  it('REJECTS the RS-008 V3 worked example from 2026-05-13 spot-check', () => {
    const v = validateVariant(
      { query: 'function that uses is_package and ancestors to locate root package directory' },
      'V3',
      RS_008_INPUT_LOCAL,
    );
    expect(v.ok).toBe(false);
    expect(v.check).toBe('5b-query-stem-leak');
  });

  it('ALLOWS the V5 synonym phrasing ("topmost folder")', () => {
    expect(validateVariant(
      { query: 'how is the topmost folder of a project source tree determined here' },
      'V5',
      RS_008_INPUT_LOCAL,
    ).ok).toBe(true);
  });
});

describe('validateVariant — path-token leak (check 5, V3/V5/V6)', () => {
  it('REJECTS "packaging" in a V3 query for detect_package_root gold (PHASE6_REDO §5.3 worked example A)', () => {
    const v = validateVariant(
      { query: 'helper that walks ancestor dirs for python packaging markers' },
      'V3',
      RS_008_INPUT,
    );
    expect(v.ok).toBe(false);
    expect(v.check).toBe('5-path-leak');
  });

  it('ALLOWS "directories" in a V3 query for detect_package_root gold (worked example B)', () => {
    const v = validateVariant(
      {
        query: 'helper that walks ancestor directories looking for python module markers',
      },
      'V3',
      RS_008_INPUT,
    );
    expect(v.ok).toBe(true);
  });
});

describe('validateVariant — boilerplate (check 6)', () => {
  it('rejects template-stub phrases', () => {
    const v = validateVariant(
      { query: 'the function that does X' },
      'V3',
      RS_001_INPUT,
    );
    expect(v.ok).toBe(false);
    expect(v.check).toBe('6-boilerplate');
  });

  it('rejects un-substituted placeholders', () => {
    const v = validateVariant(
      { query: '{symbol} that does the import' },
      'V3',
      RS_001_INPUT,
    );
    expect(v.ok).toBe(false);
    expect(v.check).toBe('6-boilerplate');
  });
});

describe('validateVariant — expectedSymbolAnyOf (elixir / lua / zig probes)', () => {
  const EL_002 = {
    goldId: 'EL-002',
    goldClass: 'ast-tester',
    expectedFile: 'lib/jason.ex',
    expectedFileAnyOf: ['lib/jason.ex', 'lib/encode.ex'],
    expectedSymbol: 'Jason',
    expectedSymbolAnyOf: ['Jason', 'Jason.Encode', 'encode_to_iodata', 'encode_to_iodata!', 'encode'],
    pathTokens: ['lib', 'jason', 'ex'],
  };

  it('V2 accepts the query when ANY listed symbol appears verbatim', () => {
    expect(validateVariant({ query: 'where is encode_to_iodata defined' }, 'V2', EL_002).ok).toBe(true);
    expect(validateVariant({ query: 'where is Jason.Encode defined' }, 'V2', EL_002).ok).toBe(true);
  });

  it('V2 rejects when no listed symbol appears (lists all in reason)', () => {
    const v = validateVariant({ query: 'where is something else defined' }, 'V2', EL_002);
    expect(v.ok).toBe(false);
    expect(v.check).toBe('3-symbol-presence');
    expect(v.reason).toContain('any-of');
  });

  it('V3 forbids EVERY listed symbol (case-insensitive)', () => {
    const v = validateVariant(
      { query: 'how does the encoder format streaming output JSON for elixir maps now' },
      'V3',
      EL_002,
    );
    // "encode" is a substring of "encoder" → matches expectedSymbolAnyOf
    expect(v.ok).toBe(false);
    expect(v.check).toBe('4-symbol-leak');
  });

  it('V3 accepts when none of the AnyOf symbols appear (no sub-token leaks either)', () => {
    // "iodata" / "encode" / "jason" are AnyOf sub-tokens that would leak —
    // a clean query must avoid them all.
    expect(validateVariant(
      { query: 'how does the library serialise maps to streaming raw byte output buffers' },
      'V3',
      EL_002,
    ).ok).toBe(true);
  });
});

describe('validateVariant — doc-positive scope (null expectedSymbol)', () => {
  it('V3 query without an expectedSymbol is vacuously allowed', () => {
    const v = validateVariant(
      { query: 'project license terms file in the repo root location' },
      'V3',
      DOC_INPUT,
    );
    expect(v.ok).toBe(true);
  });

  it('V6 long query against a doc-positive gold passes', () => {
    const long = Array(20).fill('word').join(' ');
    expect(validateVariant({ query: long }, 'V6', DOC_INPUT).ok).toBe(true);
  });
});
