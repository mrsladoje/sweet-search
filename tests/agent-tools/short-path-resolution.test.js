/**
 * Path rule safety net (2026-10-04): ss-read / ss-semantic / ss-trace --in accept a short path
 * (whole trailing path components) that names exactly one indexed file. The full path prints
 * first; two or more files are listed and the call fails; no match keeps the old message.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';

const FILES = ['src/http/RealChain.kt', 'src/conn/RealCall.kt', 'mock/RealCall.kt'];
let base;
let root;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-short-path-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  for (const f of FILES) {
    mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
    writeFileSync(path.join(root, f), `// ${f}\nfun a() = 1\nfun b() = 2\n`);
  }
  const db = new Database(path.join(root, '.sweet-search', 'codebase.db'));
  try {
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT, epoch_retired INTEGER)');
    const ins = db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)');
    FILES.forEach((f, i) => ins.run(`c${i}`, f, 'x', JSON.stringify({ line_start: 1, line_end: 3, language: 'kotlin' })));
  } finally {
    db.close();
  }
});

afterAll(() => {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function ssRead(args) {
  const env = {
    PATH: process.env.PATH || '', HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_SOCKET_PATH: path.join(base, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: path.join(base, 'runtime'),
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0', SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
    SS_READ_GUTTER: 'none', SWEET_SEARCH_CHAIN_LATER: '0',
  };
  const r = await runInVirtualProcess({ env, cwd: root }, () => runAgentTool('read', args));
  return { code: r.code, out: r.stdout.toString('utf8'), err: r.stderr.toString('utf8') };
}

describe('ss-read short path', () => {
  it('a suffix naming one indexed file reads it and prints its full path first', async () => {
    const { code, out } = await ssRead(['RealChain.kt', '2', '3']);
    expect(code).toBe(0);
    expect(out).toBe('# src/http/RealChain.kt\n```\nfun a() = 1\nfun b() = 2\n```\n');
  });

  it('more path components pick one of several files with the same name', async () => {
    const { code, out } = await ssRead(['conn/RealCall.kt', '1', '1']);
    expect(code).toBe(0);
    expect(out.split('\n')[0]).toBe('# src/conn/RealCall.kt');
  });

  it('a name that matches several files lists them and fails', async () => {
    const { code, out, err } = await ssRead(['RealCall.kt', '1', '2']);
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toBe('[ss-read] RealCall.kt matches 2 files; give one in full:\nmock/RealCall.kt\nsrc/conn/RealCall.kt\n');
  });

  it('a full path prints no path line; a name that matches nothing keeps the old message', async () => {
    expect((await ssRead(['src/http/RealChain.kt', '2', '3'])).out).toBe('```\nfun a() = 1\nfun b() = 2\n```\n');
    const miss = await ssRead(['Nope.kt', '1', '2']);
    expect(miss.code).toBe(1);
    expect(miss.err).toContain('[ss-read] no such file');
  });

  it('a partial component is no match (`Chain.kt` does not name RealChain.kt)', async () => {
    const r = await ssRead(['Chain.kt', '1', '2']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('no such file');
  });
});
