/**
 * search-read unit tests — filesystem-grounded reader.
 *
 * These tests use a real temp directory rather than mocking node:fs:
 * filesystem grounding is a core invariant of this tool, so we test against
 * actual files. The tests do NOT depend on a built sweet-search index.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readFile,
  readFiles,
  formatReadResults,
  __resetReadCachesForTests,
  __testing,
} from '../../core/search/search-read.js';
import { withPinnedRead } from '../../core/search/search-reader-pin.js';

let TMP;

beforeEach(() => {
  __resetReadCachesForTests();
  TMP = mkdtempSync(path.join(tmpdir(), 'sweet-search-read-test-'));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  __resetReadCachesForTests();
});

function writeTmp(rel, content) {
  const abs = path.join(TMP, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe('readFile — single file', () => {
  it('returns exact disk bytes and full line count (preserves trailing newline)', async () => {
    const text = 'line1\nline2\nline3\nline4\n';
    writeTmp('a.txt', text);
    const r = await readFile({ path: 'a.txt', projectRoot: TMP });
    expect(r.ok).toBe(true);
    expect(r.exact).toBe(true);
    expect(r.text).toBe(text); // exact disk content; never mutated
    expect(r.totalLines).toBe(4);
  });

  it('slices a specific line range exactly (1-based, inclusive)', async () => {
    const text = 'L1\nL2\nL3\nL4\nL5\n';
    writeTmp('b.txt', text);
    const r = await readFile({ path: 'b.txt', startLine: 2, endLine: 4, projectRoot: TMP });
    expect(r.ok).toBe(true);
    // Lines 2-4 inclusive — newline of line 4 is part of the slice.
    expect(r.text).toBe('L2\nL3\nL4\n');
    expect(r.range).toEqual({ startLine: 2, endLine: 4 });
    expect(r.totalLines).toBe(5);
  });

  it('clamps endLine past the file end', async () => {
    writeTmp('c.txt', 'one\ntwo');
    const r = await readFile({ path: 'c.txt', startLine: 1, endLine: 999, projectRoot: TMP });
    expect(r.ok).toBe(true);
    expect(r.range.endLine).toBe(2);
    expect(r.text).toBe('one\ntwo'); // file has no trailing newline
  });

  it('handles single-line range form (--lines 3 → start=3, end=3)', async () => {
    writeTmp('d.txt', 'a\nb\nc\nd');
    const r = await readFile({ path: 'd.txt', startLine: 3, endLine: 3, projectRoot: TMP });
    expect(r.text).toBe('c\n'); // newline separator preserved
  });

  it('returns ok=false for a missing file without throwing', async () => {
    const r = await readFile({ path: 'missing.txt', projectRoot: TMP });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ENOENT|stat failed|no such file/i);
  });

  it('returns ok=false when target is a directory', async () => {
    mkdirSync(path.join(TMP, 'adir'));
    const r = await readFile({ path: 'adir', projectRoot: TMP });
    expect(r.ok).toBe(false);
  });

  it('preserves exact bytes including unicode and tabs', async () => {
    const tricky = 'α=β\n\t\tindented "quote"\nmöre';
    writeTmp('uni.txt', tricky);
    const r = await readFile({ path: 'uni.txt', projectRoot: TMP });
    expect(r.text).toBe(tricky);
  });

  it('caches reads — same content returned across calls without filesystem flake', async () => {
    writeTmp('cache.txt', 'X\nY\nZ\n');
    const r1 = await readFile({ path: 'cache.txt', projectRoot: TMP });
    const r2 = await readFile({ path: 'cache.txt', projectRoot: TMP });
    expect(r2.text).toBe(r1.text);
    expect(r2.mtimeMs).toBe(r1.mtimeMs);
  });

  it('serves line ranges from cached large files without crashing', async () => {
    const line1 = 'a'.repeat(5 * 1024 * 1024);
    writeTmp('large.txt', `${line1}\nlast\n`);
    const r1 = await readFile({ path: 'large.txt', startLine: 1, endLine: 1, projectRoot: TMP });
    const r2 = await readFile({ path: 'large.txt', startLine: 2, endLine: 2, projectRoot: TMP });
    const r3 = await readFile({ path: 'large.txt', projectRoot: TMP });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.text).toBe('last\n');
    expect(r3.text.endsWith('last\n')).toBe(true);
  });

  it('marks indexed=false when no codebase index exists at the project root', async () => {
    writeTmp('e.txt', 'line\n');
    const r = await readFile({ path: 'e.txt', projectRoot: TMP });
    // No vectors DB at this project root — indexed is false, not an error.
    expect(r.indexed).toBe(false);
    expect(r.chunks).toEqual([]);
  });

  it('attaches metadata from the requested projectRoot index, not the process root', async () => {
    writeTmp('src/e.js', 'function e() { return 1; }\n');
    const stateDir = path.join(TMP, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    const db = new Database(path.join(stateDir, 'codebase.db'));
    try {
      db.exec(`
        CREATE TABLE vectors (
          id TEXT PRIMARY KEY,
          file_path TEXT,
          text TEXT,
          metadata TEXT
        )
      `);
      db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)').run(
        'chunk-e',
        'src/e.js',
        'function e() { return 1; }',
        JSON.stringify({
          language: 'javascript',
          symbol: 'e',
          chunk_type: 'function',
          line_start: 1,
          line_end: 1,
          signature: 'function e()',
        }),
      );
    } finally {
      db.close();
    }

    const r = await readFile({ path: 'src/e.js', projectRoot: TMP });

    expect(r.indexed).toBe(true);
    expect(r.language).toBe('javascript');
    expect(r.chunks).toEqual([
      {
        id: 'chunk-e',
        symbol: 'e',
        type: 'function',
        startLine: 1,
        endLine: 1,
        signature: 'function e()',
      },
    ]);
  });

  it('attaches metadata from the manifest-selected vectors database', async () => {
    writeTmp('src/f.js', 'function f() { return 2; }\n');
    const stateDir = path.join(TMP, '.sweet-search');
    const nestedDir = path.join(stateDir, 'nested');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(path.join(stateDir, 'reconcile-manifest.json'), JSON.stringify({
      epoch: 9,
      vectors: { path: 'nested/codebase.db', epoch: 9 },
    }));
    const db = new Database(path.join(nestedDir, 'codebase.db'));
    try {
      db.exec(`
        CREATE TABLE vectors (
          id TEXT PRIMARY KEY,
          file_path TEXT,
          text TEXT,
          metadata TEXT,
          epoch_written INTEGER NOT NULL DEFAULT 0,
          epoch_retired INTEGER
        )
      `);
      db.prepare('INSERT INTO vectors (id, file_path, text, metadata, epoch_written) VALUES (?, ?, ?, ?, ?)').run(
        'chunk-f',
        'src/f.js',
        'function f() { return 2; }',
        JSON.stringify({
          language: 'javascript',
          symbol: 'f',
          chunk_type: 'function',
          line_start: 1,
          line_end: 1,
          signature: 'function f()',
        }),
        9,
      );
    } finally {
      db.close();
    }

    const r = await readFile({ path: 'src/f.js', projectRoot: TMP });

    expect(r.indexed).toBe(true);
    expect(r.chunks[0]).toMatchObject({
      id: 'chunk-f',
      symbol: 'f',
      startLine: 1,
      endLine: 1,
    });
  });

  it('normalizes realpath-spelled files under a symlink-spelled project root for index lookup', () => {
    const realRoot = path.join(TMP, 'real');
    const linkRoot = path.join(TMP, 'link');
    mkdirSync(path.join(realRoot, 'src'), { recursive: true });
    writeFileSync(path.join(realRoot, 'src/a.js'), 'const a = 1;\n');
    symlinkSync(realRoot, linkRoot, 'dir');

    expect(__testing.projectRelative(path.join(realRoot, 'src/a.js'), linkRoot)).toBe('src/a.js');
  });
});

describe('readFiles — batch', () => {
  it('pins and releases the reconcile reader heartbeat while work is in flight', async () => {
    const stateDir = path.join(TMP, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path.join(stateDir, 'reconcile-manifest.json'), JSON.stringify({ epoch: 12 }));

    await withPinnedRead({ projectRoot: TMP, meta: { tool: 'test-read' } }, async () => {
      const readerDir = path.join(stateDir, 'readers');
      const files = readdirSync(readerDir);
      expect(files).toHaveLength(1);
      const payload = JSON.parse(readFileSync(path.join(readerDir, files[0]), 'utf-8'));
      expect(payload).toMatchObject({ epoch: 12, meta: { tool: 'test-read' } });
    });

    const readerDir = path.join(stateDir, 'readers');
    expect(existsSync(readerDir) ? readdirSync(readerDir) : []).toEqual([]);
  });

  it('reads up to 20 files and returns per-file results', async () => {
    writeTmp('one.txt', 'A');
    writeTmp('two.txt', 'B\nC');
    writeTmp('three.txt', 'X\nY\nZ\n');
    const out = await readFiles(
      [{ path: 'one.txt' }, { path: 'two.txt' }, { path: 'three.txt' }],
      { projectRoot: TMP },
    );
    expect(out.files).toHaveLength(3);
    expect(out.files.map(f => f.text)).toEqual(['A', 'B\nC', 'X\nY\nZ\n']);
  });

  it('does not abort the batch when one file is missing', async () => {
    writeTmp('exists.txt', 'ok');
    const out = await readFiles(
      [{ path: 'exists.txt' }, { path: 'gone.txt' }, { path: 'exists.txt' }],
      { projectRoot: TMP },
    );
    expect(out.files).toHaveLength(3);
    expect(out.files[0].ok).toBe(true);
    expect(out.files[1].ok).toBe(false);
    expect(out.files[2].ok).toBe(true);
  });

  it('rejects more than 20 files', async () => {
    const reqs = Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.txt` }));
    await expect(readFiles(reqs, { projectRoot: TMP })).rejects.toThrow(/at most 20/);
  });

  it('returns empty for empty input', async () => {
    const out = await readFiles([], { projectRoot: TMP });
    expect(out.files).toEqual([]);
  });
});

describe('formatReadResults', () => {
  it('json mode emits JSON-parseable output', async () => {
    writeTmp('j.txt', 'hello');
    const out = await readFiles([{ path: 'j.txt' }], { projectRoot: TMP });
    const json = formatReadResults(out, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.files[0].text).toBe('hello');
  });

  it('raw mode returns just the text', async () => {
    writeTmp('r.txt', 'just text');
    const out = await readFiles([{ path: 'r.txt' }], { projectRoot: TMP });
    expect(formatReadResults(out, 'raw')).toBe('just text');
  });

  it('agent mode wraps in fenced block with header', async () => {
    writeTmp('a.ts', 'export const x = 1;\n');
    const out = await readFiles([{ path: 'a.ts' }], { projectRoot: TMP });
    const formatted = formatReadResults(out, 'agent');
    expect(formatted).toContain('### a.ts');
    expect(formatted).toContain('export const x = 1;');
    expect(formatted).toContain('```');
  });
});
