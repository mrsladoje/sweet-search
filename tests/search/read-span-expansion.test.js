// Span-gated whole-file expansion in ss-read (C-4).
//
// Two things have to hold and both are load-bearing:
//   1. the gate fires exactly when the span already covers >=25% of a <=600-line file;
//   2. it is INVISIBLE to every measurement path, because the retrieval evaluation
//      harness calls readFile() with a chunk range and scores containment from the
//      lines that come back. A default-on expansion would inflate that.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFile, readFiles, resolveSpanExpansion, spanExpandEnabled } from '../../core/search/search-read.js';

// The gate ships OFF (a live A/B refuted the replay -- see search-read.js). Tests that
// exercise the mechanism must opt in explicitly, exactly as a caller would have to.
let dir, prevEnv;
beforeAll(() => { prevEnv = process.env.SS_READ_SPAN_EXPAND; process.env.SS_READ_SPAN_EXPAND = '1'; });
afterAll(() => { if (prevEnv === undefined) delete process.env.SS_READ_SPAN_EXPAND; else process.env.SS_READ_SPAN_EXPAND = prevEnv; });
const mk = (name, lines) => {
  const p = path.join(dir, name);
  writeFileSync(p, Array.from({ length: lines }, (_, i) => `line ${i + 1} content`).join('\n') + '\n');
  return p;
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ss-span-'));
  mk('small.txt', 100);      // 101 line offsets incl. trailing
  mk('mid.txt', 400);
  mk('big.txt', 900);
});
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('resolveSpanExpansion — the gate itself', () => {
  const on = { spanExpand: true };

  it('expands when the span covers >=25% of a small file', () => {
    const r = resolveSpanExpansion(400, 1, 100, on);   // 25.0%
    expect(r.expanded).toBe(true);
    expect(r.startLine).toBe(1);
    expect(r.endLine).toBe(400);
  });

  it('does NOT expand just below the fraction gate', () => {
    const r = resolveSpanExpansion(400, 1, 99, on);    // 24.75%
    expect(r.expanded).toBe(false);
    expect(r.endLine).toBe(99);
  });

  it('does NOT expand above the line cap, however large the span', () => {
    const r = resolveSpanExpansion(601, 1, 600, on);   // 99.8% but 601 lines
    expect(r.expanded).toBe(false);
  });

  it('expands at exactly the line cap', () => {
    expect(resolveSpanExpansion(600, 1, 150, on).expanded).toBe(true);
  });

  it('is a no-op when the request already covers the whole file', () => {
    const r = resolveSpanExpansion(300, 1, 300, on);
    expect(r.expanded).toBe(false);
  });

  // An open-ended read runs to EOF, so its covered fraction is (total - start + 1).
  // The replay that measured this policy treats `ss-read f 200` the same way
  // (`b = s.read.b ?? lines`), so the implementation has to agree with it or the
  // shipped constants would be describing a different policy from the measured one.
  it('treats an open-ended range as read-to-EOF and expands on its true fraction', () => {
    const r = resolveSpanExpansion(300, 200, null, on);   // covers 101/300 = 33.7%
    expect(r.expanded).toBe(true);
    expect(r.startLine).toBe(1);
  });

  it('does not expand an open-ended tail that is under the fraction gate', () => {
    expect(resolveSpanExpansion(300, 240, null, on).expanded).toBe(false);  // 61/300 = 20.3%
  });

  it('clamps an over-long endLine rather than expanding on a bogus fraction', () => {
    // asks 1-5000 of a 300-line file: covered==total, already whole
    expect(resolveSpanExpansion(300, 1, 5000, on).expanded).toBe(false);
  });

  it('never expands an empty or unknown file', () => {
    expect(resolveSpanExpansion(0, 1, 10, on).expanded).toBe(false);
    expect(resolveSpanExpansion(NaN, 1, 10, on).expanded).toBe(false);
  });
});

describe('spanExpandEnabled — measurement paths are structurally immune', () => {
  it('is OFF by default at the library boundary', () => {
    expect(spanExpandEnabled({})).toBe(false);
    expect(spanExpandEnabled({ startLine: 1, endLine: 50 })).toBe(false);
  });

  it('is ON only when the caller opts in', () => {
    expect(spanExpandEnabled({ spanExpand: true })).toBe(true);
  });

  for (const fmt of ['benchmark', 'raw', 'json']) {
    it(`is vetoed by format=${fmt} even when the caller opts in`, () => {
      expect(spanExpandEnabled({ spanExpand: true, format: fmt })).toBe(false);
    });
  }

  it('is OFF unless SS_READ_SPAN_EXPAND=1, even when the caller opts in', () => {
    const prev = process.env.SS_READ_SPAN_EXPAND;
    for (const v of ['0', '', 'true', undefined]) {
      if (v === undefined) delete process.env.SS_READ_SPAN_EXPAND; else process.env.SS_READ_SPAN_EXPAND = v;
      expect(spanExpandEnabled({ spanExpand: true })).toBe(false);
    }
    process.env.SS_READ_SPAN_EXPAND = prev ?? '1';
  });
});

describe('readFile — end to end', () => {
  it('returns the whole file when the gate fires, and says so', async () => {
    const r = await readFile({
      path: path.join(dir, 'mid.txt'), projectRoot: dir,
      startLine: 1, endLine: 150, spanExpand: true, format: 'agent', includeMetadata: false,
    });
    expect(r.ok).not.toBe(false);
    expect(r.spanExpanded).toBe(true);
    expect(r.range.startLine).toBe(1);
    expect(r.text).toContain('line 400 content');
    // read-to-EOF, so the unread-remainder trailer must be silent
    expect(r.unreadBelow).toBeNull();
  });

  it('returns EXACTLY the requested span when the caller does not opt in', async () => {
    const r = await readFile({
      path: path.join(dir, 'mid.txt'), projectRoot: dir,
      startLine: 1, endLine: 150, includeMetadata: false,
    });
    expect(r.spanExpanded).toBeUndefined();
    expect(r.range).toEqual({ startLine: 1, endLine: 150 });
    expect(r.text).not.toContain('line 400 content');
  });

  it('the retrieval-measurement call shape is byte-identical with and without the flag', async () => {
    const base = { path: path.join(dir, 'mid.txt'), projectRoot: dir, startLine: 40, endLine: 60, includeMetadata: false };
    const plain = await readFile(base);
    const benchmarked = await readFile({ ...base, spanExpand: true, format: 'benchmark' });
    expect(benchmarked.text).toBe(plain.text);
    expect(benchmarked.range).toEqual(plain.range);
  });

  it('leaves a large file alone', async () => {
    const r = await readFile({
      path: path.join(dir, 'big.txt'), projectRoot: dir,
      startLine: 1, endLine: 800, spanExpand: true, format: 'agent', includeMetadata: false,
    });
    expect(r.spanExpanded).toBeUndefined();
    expect(r.range.endLine).toBe(800);
  });

  it('leaves a whole-file read alone (no range requested)', async () => {
    const r = await readFile({
      path: path.join(dir, 'small.txt'), projectRoot: dir,
      spanExpand: true, format: 'agent', includeMetadata: false,
    });
    expect(r.spanExpanded).toBeUndefined();
    expect(r.range).toBeNull();
  });

  it('readFiles threads the opt-in, and defaults to off', async () => {
    const files = [{ path: path.join(dir, 'mid.txt'), startLine: 1, endLine: 150 }];
    const off = await readFiles(files, { projectRoot: dir, includeMetadata: false });
    expect(off.files[0].spanExpanded).toBeUndefined();
    const on = await readFiles(files, { projectRoot: dir, includeMetadata: false, spanExpand: true, format: 'agent' });
    expect(on.files[0].spanExpanded).toBe(true);
  });
});
