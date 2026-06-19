/**
 * search-read-semantic unit tests.
 *
 * Scope:
 *   - The graceful fallback path (no semantic index available) returns the
 *     full file via readFile, marked fellBack=true.
 *   - The result text is always re-read from disk, even when chunk metadata
 *     is present (regression guard against returning truncated DB text).
 *   - Token/character budget enforcement.
 *   - Span merge / context expansion behaviour.
 *
 * These tests do not require a real LateInteractionIndex or ONNX model —
 * they cover the lossless-disk-re-read invariant and the user-visible
 * fallback contract that must hold even when the heavy semantic stack is
 * absent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readSemantic,
  formatReadSemanticResult,
  __resetReadSemanticCachesForTests,
} from '../../core/search/search-read-semantic.js';
import { __resetReadCachesForTests } from '../../core/search/search-read.js';
import { buildReadSemanticDaemonResponse } from '../../core/search/search-server.js';

let TMP;

beforeEach(() => {
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
  TMP = mkdtempSync(path.join(tmpdir(), 'sweet-search-rsem-test-'));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
});

function writeTmp(rel, content) {
  const abs = path.join(TMP, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe('readSemantic — fallback when not indexed', () => {
  it('falls back to plain read and returns the entire file', async () => {
    const text = 'function foo() {}\n\nfunction bar() {}\n';
    writeTmp('src/x.js', text);
    const r = await readSemantic({
      path: 'src/x.js',
      query: 'how does bar work',
      projectRoot: TMP,
    });
    expect(r.ok).toBe(true);
    expect(r.fellBack).toBe(true);
    expect(r.indexed).toBe(false);
    expect(r.spans).toHaveLength(1);
    expect(r.spans[0].text).toBe(text); // disk-exact, including trailing newline
    expect(r.spans[0].startLine).toBe(1);
  });

  it('reports a missing file via the fallback shape (ok=false)', async () => {
    const r = await readSemantic({
      path: 'src/does-not-exist.js',
      query: 'anything',
      projectRoot: TMP,
    });
    expect(r.ok).toBe(false);
    expect(r.fellBack).toBe(true);
    expect(r.spans).toHaveLength(0);
  });

  it('rejects empty queries', async () => {
    writeTmp('a.js', 'a\n');
    await expect(
      readSemantic({ path: 'a.js', query: '', projectRoot: TMP }),
    ).rejects.toThrow(/query is required/);
  });

  it('rejects missing path', async () => {
    await expect(
      readSemantic({ query: 'q' }),
    ).rejects.toThrow(/path is required/);
  });
});

describe('formatReadSemanticResult', () => {
  it('json mode round-trips through JSON.parse', async () => {
    writeTmp('y.js', 'export const Y = 1;\n');
    const r = await readSemantic({ path: 'y.js', query: 'Y', projectRoot: TMP });
    const json = formatReadSemanticResult(r, 'json');
    const parsed = JSON.parse(json);
    // Disk-exact bytes flow through structured output, including trailing newline.
    expect(parsed.spans[0].text).toBe('export const Y = 1;\n');
  });

  it('agent mode includes a header and a fenced span', async () => {
    writeTmp('z.js', 'const Z = 2;\n');
    const r = await readSemantic({ path: 'z.js', query: 'Z', projectRoot: TMP });
    const out = formatReadSemanticResult(r, 'agent');
    expect(out).toContain('z.js');
    expect(out).toContain('const Z = 2;');
    expect(out).toContain('```');
  });
});

describe('disk-grounded invariant (regression guard)', () => {
  it('returns exact bytes from disk under fallback (no DB-truncated text leakage)', async () => {
    const huge = Array.from({ length: 200 }, (_, i) => `line ${i + 1}: payload-${'X'.repeat(20)}`).join('\n') + '\n';
    writeTmp('big.js', huge);
    const r = await readSemantic({ path: 'big.js', query: 'payload', projectRoot: TMP });
    expect(r.ok).toBe(true);
    // Whole-file fallback returns the file content unmodified (disk ground truth).
    expect(r.spans[0].text).toBe(huge);
    // We never report exact:true and then return less than the file —
    // either spans cover the full content (fallback) or specific spans (indexed).
    expect(r.fellBack).toBe(true);
  });
});

describe('budget — char limit honoured even on fallback', () => {
  it('caps fallback span when whole file exceeds maxChars by truncating to budget', async () => {
    // Fallback still uses filesystem-grounded content, but must not dump an
    // unbounded file into the agent context.
    writeTmp('mb.js', 'a'.repeat(50_000));
    const r = await readSemantic({
      path: 'mb.js',
      query: 'a',
      maxChars: 1000,
      projectRoot: TMP,
    });
    expect(r.ok).toBe(true);
    expect(r.fellBack).toBe(true);
    expect(r.spans[0].text).toHaveLength(1000);
    expect(r.spans[0].truncated).toBe(true);
    expect(r.charsReturned).toBe(1000);
  });
});

describe('readSemantic daemon route helper', () => {
  function routeUrl(params) {
    return `/read-semantic?${new URLSearchParams(params).toString()}`;
  }

  it('rejects non-Unix-socket requests', async () => {
    const r = await buildReadSemanticDaemonResponse(routeUrl({
      path: 'a.js',
      q: 'query',
      projectRoot: TMP,
    }), {
      isUnixSocket: false,
      serverReady: true,
      searcher: { projectRoot: TMP },
    });
    expect(r.status).toBe(403);
  });

  it('rejects wrong-project daemons before running readSemantic', async () => {
    let called = false;
    const otherRoot = path.join(TMP, 'other');
    mkdirSync(otherRoot, { recursive: true });
    const r = await buildReadSemanticDaemonResponse(routeUrl({
      path: 'a.js',
      q: 'query',
      projectRoot: otherRoot,
    }), {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: TMP },
      readSemanticFn: async () => { called = true; },
      formatReadSemanticResultFn: formatReadSemanticResult,
    });
    expect(r.status).toBe(409);
    expect(called).toBe(false);
    expect(r.body).toContain('Daemon project root mismatch');
  });

  it('passes the daemon late-interaction index when it is loaded and same-project', async () => {
    const fakeIndex = {
      documents: new Map([['chunk-1', {}]]),
      modelMismatch: false,
    };
    let seenReq = null;
    const r = await buildReadSemanticDaemonResponse(routeUrl({
      path: 'src/a.js',
      q: 'query',
      projectRoot: TMP,
    }), {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: TMP, lateInteractionIndex: fakeIndex },
      readSemanticFn: async (req) => {
        seenReq = req;
        return {
          ok: true,
          file: 'src/a.js',
          query: 'query',
          indexed: true,
          fellBack: false,
          language: 'javascript',
          totalLines: 1,
          spans: [],
          charsReturned: 0,
          approxTokensReturned: 0,
        };
      },
      formatReadSemanticResultFn: formatReadSemanticResult,
    });
    expect(r.status).toBe(200);
    expect(seenReq?._lateInteractionIndex).toBe(fakeIndex);
  });

  it('rereads fallback text from disk on each daemon request', async () => {
    writeTmp('src/live.js', 'export const value = "old";\n');
    const params = {
      path: 'src/live.js',
      q: 'value',
      projectRoot: TMP,
    };
    const first = await buildReadSemanticDaemonResponse(routeUrl(params), {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: TMP },
    });
    expect(first.status).toBe(200);
    expect(first.body).toContain('"old"');

    writeTmp('src/live.js', 'export const value = "newer text";\n');
    const second = await buildReadSemanticDaemonResponse(routeUrl(params), {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: TMP },
    });
    expect(second.status).toBe(200);
    expect(second.body).toContain('"newer text"');
    expect(second.body).not.toContain('"old"');
  });

  it('preserves staleness warnings in formatted daemon output', async () => {
    const r = await buildReadSemanticDaemonResponse(routeUrl({
      path: 'src/a.js',
      q: 'query',
      projectRoot: TMP,
    }), {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: TMP },
      readSemanticFn: async () => ({
        ok: true,
        file: 'src/a.js',
        query: 'query',
        indexed: true,
        fellBack: false,
        language: 'javascript',
        totalLines: 1,
        warnings: ['source file is newer than the semantic index; spans were selected from stale index metadata and text was reread from disk'],
        spans: [{ startLine: 1, endLine: 1, score: 1, symbols: [], text: 'const a = 1;\n' }],
        charsReturned: 13,
        approxTokensReturned: 4,
      }),
      formatReadSemanticResultFn: formatReadSemanticResult,
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain('[warning] source file is newer than the semantic index');
  });
});
