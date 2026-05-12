/**
 * Unit tests for gradeResult() in core/prompt-optimization/scripts/track-a-runner.mjs.
 *
 * Tests cover the PHASE6_REDO §6.1 grading rubric:
 *   - PASS  : file + symbol match (ast-tester) OR file match (doc-positive)
 *   - PARTIAL: file match, symbol mismatch (ast-tester only)
 *   - FAIL  : file mismatch
 *   - file_recall@1 / @5 / symbol_recall@1 binary metrics
 *   - score margin (top1 - top2)
 */

import { describe, it, expect } from 'vitest';
import { gradeResult } from '../../../core/prompt-optimization/scripts/track-a-runner.mjs';

const AST_GOLD = {
  goldId: 'RS-001',
  goldClass: 'ast-tester',
  expectedFile: 'crates/ruff_linter/src/rules/isort/categorize.rs',
  expectedSymbol: 'ImportType',
};

const DOC_GOLD = {
  goldId: 'DP-RS-001',
  goldClass: 'doc-positive',
  expectedFile: 'LICENSE',
  expectedSymbol: null,
};

const DOC_ANYOF = {
  goldId: 'DP-PY-004',
  goldClass: 'doc-positive',
  expectedFile: null,
  expectedFileAnyOf: ['.github/workflows/lock.yaml', '.github/workflows/pre-commit.yaml'],
  expectedSymbol: null,
};

describe('gradeResult — ast-tester verdicts', () => {
  it('PASS when top-1 file + symbol both match', () => {
    const r = gradeResult(AST_GOLD, [
      { file: AST_GOLD.expectedFile, symbol: 'ImportType', score: 0.9 },
      { file: 'other.rs', symbol: 'Other', score: 0.5 },
    ]);
    expect(r.verdict).toBe('PASS');
    expect(r.fileRecallAt1).toBe(1);
    expect(r.symbolRecallAt1).toBe(1);
    expect(r.fileRecallAt5).toBe(1);
    expect(r.scoreMargin).toBeCloseTo(0.4);
  });

  it('PARTIAL when file matches but symbol mismatches', () => {
    const r = gradeResult(AST_GOLD, [
      { file: AST_GOLD.expectedFile, symbol: 'ImportSection', score: 0.9 },
      { file: 'other.rs', symbol: 'Other', score: 0.5 },
    ]);
    expect(r.verdict).toBe('PARTIAL');
    expect(r.fileRecallAt1).toBe(1);
    expect(r.symbolRecallAt1).toBe(0);
  });

  it('FAIL when top-1 file does not match', () => {
    const r = gradeResult(AST_GOLD, [
      { file: 'somewhere/else.rs', symbol: 'ImportType', score: 0.9 },
    ]);
    expect(r.verdict).toBe('FAIL');
    expect(r.fileRecallAt1).toBe(0);
    expect(r.fileRecallAt5).toBe(0);
  });

  it('captures file_recall@5 even when top-1 missed', () => {
    const r = gradeResult(AST_GOLD, [
      { file: 'a.rs', score: 0.9 },
      { file: 'b.rs', score: 0.8 },
      { file: AST_GOLD.expectedFile, symbol: 'ImportType', score: 0.7 },
    ]);
    expect(r.verdict).toBe('FAIL');
    expect(r.fileRecallAt1).toBe(0);
    expect(r.fileRecallAt5).toBe(1);
  });

  it('returns FAIL with no top1 when results empty', () => {
    const r = gradeResult(AST_GOLD, []);
    expect(r.verdict).toBe('FAIL');
    expect(r.top1).toBe(null);
  });

  it('reads file from metadata.file fallback', () => {
    const r = gradeResult(AST_GOLD, [
      { metadata: { file: AST_GOLD.expectedFile, symbol: 'ImportType' }, score: 0.9 },
    ]);
    expect(r.verdict).toBe('PASS');
  });
});

describe('gradeResult — expectedSymbolAnyOf (elixir / lua / zig probes)', () => {
  const EL_GOLD = {
    goldId: 'EL-002',
    goldClass: 'ast-tester',
    expectedFile: 'lib/jason.ex',
    expectedFileAnyOf: ['lib/jason.ex', 'lib/encode.ex'],
    expectedSymbol: 'Jason',
    expectedSymbolAnyOf: ['Jason', 'encode_to_iodata', 'encode'],
  };

  it('PASS when top-1 matches an AnyOf file AND an AnyOf symbol', () => {
    const r = gradeResult(EL_GOLD, [
      { file: 'lib/encode.ex', symbol: 'encode_to_iodata', score: 0.9 },
    ]);
    expect(r.verdict).toBe('PASS');
  });

  it('PARTIAL when file matches but symbol is not in AnyOf list', () => {
    const r = gradeResult(EL_GOLD, [
      { file: 'lib/encode.ex', symbol: 'helperFn', score: 0.9 },
    ]);
    expect(r.verdict).toBe('PARTIAL');
  });
});

describe('gradeResult — doc-positive verdicts (file-only grading)', () => {
  it('PASS on file match alone (no symbol required)', () => {
    const r = gradeResult(DOC_GOLD, [
      { file: 'LICENSE', symbol: null, score: 0.9 },
    ]);
    expect(r.verdict).toBe('PASS');
    expect(r.symbolRecallAt1).toBe(1); // expectedSymbol is null → vacuously true
  });

  it('FAIL on file mismatch', () => {
    const r = gradeResult(DOC_GOLD, [
      { file: 'README.md', score: 0.9 },
    ]);
    expect(r.verdict).toBe('FAIL');
  });

  it('PASS when top-1 matches any expectedFileAnyOf member', () => {
    const r = gradeResult(DOC_ANYOF, [
      { file: '.github/workflows/pre-commit.yaml', score: 0.9 },
    ]);
    expect(r.verdict).toBe('PASS');
    expect(r.fileRecallAt1).toBe(1);
  });
});
