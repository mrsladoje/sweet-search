/**
 * Unit tests for the shared relaxed-grading module — the def-anchor regex +
 * classifyChunk port extracted from the 2026-05-13 cross-tool-audit
 * spot-check (see core/prompt-optimization/data/query-shapes/
 * cross-tool-benchmark-audit-2026-05-13.md).
 *
 * The module is the single source of truth for the relaxed_def_recall@1
 * secondary metric published by recommendations-v2*.json. These tests pin
 * the per-language classification logic to a small canonical set of
 * positive (DEFINITION) and negative (REFERENCE / COMMENT) cases drawn from
 * real chunks in the audit doc.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyChunk,
  computeRelaxedDefMatch,
} from '../../../core/prompt-optimization/scripts/relaxed-grading.mjs';

describe('classifyChunk — DEFINITION detection (positive cases)', () => {
  it('C function definition: "Type *symbol(args) {" — strong', () => {
    // From audit doc — gold C-002 in hiredis.
    const lines = ['', 'redisContext *redisConnectWithOptions(const redisOptions *options) {', '    /* ... */', '}'];
    const cls = classifyChunk(lines, 1, lines.length, 'redisConnectWithOptions', 'c');
    expect(cls.verdict).toBe('strong');
  });

  it('Rust pub trait: "pub trait Violation: ViolationMetadata + Sized {" — strong', () => {
    const lines = ['pub trait Violation: ViolationMetadata + Sized {'];
    const cls = classifyChunk(lines, 1, lines.length, 'Violation', 'rust');
    expect(cls.verdict).toBe('strong');
  });

  it('C# sealed unsafe partial class — strong', () => {
    const lines = ['internal sealed unsafe partial class RespServerSession : ServerSessionBase'];
    const cls = classifyChunk(lines, 1, lines.length, 'RespServerSession', 'csharp');
    expect(cls.verdict).toBe('strong');
  });

  it('TypeScript export const + symbol verbatim — strong', () => {
    // From audit doc TSL-001.
    const lines = ['export const safeParse: $SafeParse = /* @__PURE__*/ _safeParse(errors.$ZodRealError);'];
    const cls = classifyChunk(lines, 1, lines.length, 'safeParse', 'typescript');
    expect(cls.verdict).toBe('strong');
  });

  it('Dart extension on type — strong', () => {
    const lines = ['extension HeadersWithSplitValues on BaseResponse {'];
    const cls = classifyChunk(lines, 1, lines.length, 'HeadersWithSplitValues', 'dart');
    expect(cls.verdict).toBe('strong');
  });

  it('Ruby "class Request < Rack::Request" — strong', () => {
    const lines = ['class Request < Rack::Request'];
    const cls = classifyChunk(lines, 1, lines.length, 'Request', 'ruby');
    expect(cls.verdict).toBe('strong');
  });
});

describe('classifyChunk — REFERENCE detection (negative cases)', () => {
  it('C# "new LoaderBlockCache(...)" — weak (instantiation, not def)', () => {
    // From audit doc CS-005 — chunk uses the symbol but doesn't define it.
    const lines = ['var newCache = new LoaderBlockCache(maxBlocks, blockSize, ...);'];
    const cls = classifyChunk(lines, 1, lines.length, 'LoaderBlockCache', 'csharp');
    expect(cls.verdict).toBe('weak');
  });

  it('Python type annotation reference — weak', () => {
    // From audit doc PY-002 — "parent: Context | None = None,"
    const lines = ['    parent: Context | None = None,'];
    const cls = classifyChunk(lines, 1, lines.length, 'Context', 'python');
    expect(cls.verdict).toBe('weak');
  });

  it('Lua local instantiation — weak', () => {
    // From audit doc LU-001 — "local c = _class(...)" — instantiates, not defines.
    const lines = ['local c = _class(name, base)'];
    const cls = classifyChunk(lines, 1, lines.length, '_class', 'lua');
    expect(cls.verdict).toBe('weak');
  });

  it('Symbol only in a JSDoc / doc comment — comment-only', () => {
    // Note: dart isn't in the docstring-mask list, so we use python-style # comments
    // which is recognised by isCommentLine for python.
    const lines = ['# See HeadersWithSplitValues for the full extension API.'];
    const cls = classifyChunk(lines, 1, lines.length, 'HeadersWithSplitValues', 'python');
    expect(cls.verdict).toBe('comment-only');
  });

  it('Symbol not present at all — none', () => {
    const lines = ['some unrelated code here', 'function unrelated() {}'];
    const cls = classifyChunk(lines, 1, lines.length, 'NotInChunk', 'typescript');
    expect(cls.verdict).toBe('none');
  });
});

describe('computeRelaxedDefMatch — single-call API used by aggregators', () => {
  it('returns true when chunkText is a definition', () => {
    const r = computeRelaxedDefMatch({
      chunkText: 'pub fn detect_package_root(path: &Path) -> Option<PathBuf> { ... }',
      expectedSymbol: 'detect_package_root',
      language: 'rust',
    });
    expect(r).toBe(true);
  });

  it('returns false when chunkText only references the symbol', () => {
    const r = computeRelaxedDefMatch({
      chunkText: 'let r = detect_package_root(&path);',
      expectedSymbol: 'detect_package_root',
      language: 'rust',
    });
    expect(r).toBe(false);
  });

  it('returns false when expectedSymbol is missing or empty', () => {
    expect(computeRelaxedDefMatch({
      chunkText: 'whatever',
      expectedSymbol: '',
      language: 'rust',
    })).toBe(false);
    expect(computeRelaxedDefMatch({
      chunkText: 'whatever',
      expectedSymbol: null,
      language: 'rust',
    })).toBe(false);
  });
});
