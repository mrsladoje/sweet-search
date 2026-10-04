/**
 * A --in scope that does not exist (2026-10-04): ss-grep says so with exit 3, and names the
 * indexed files or directories that carry the same last name, so the agent re-scopes in the
 * next call (GRDB/Core/Pool.swift for GRDB/Utils/Pool.swift). No candidate keeps the generic
 * repair line.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';

const FILES = ['GRDB/Utils/Pool.swift', 'GRDB/Core/Database.swift', 'a/Shared.swift', 'b/Shared.swift'];
let base;
let root;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-scope-hint-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  for (const f of FILES) {
    mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
    writeFileSync(path.join(root, f), `// ${f}\nfunc a() {}\n`);
  }
  const db = new Database(path.join(root, '.sweet-search', 'codebase.db'));
  try {
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT, epoch_retired INTEGER)');
    const ins = db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)');
    FILES.forEach((f, i) => ins.run(`c${i}`, f, 'x', JSON.stringify({ line_start: 1, line_end: 2, language: 'swift' })));
  } finally {
    db.close();
  }
});

afterAll(() => {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function ssGrep(args) {
  const env = {
    PATH: process.env.PATH || '', HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_SOCKET_PATH: path.join(base, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: path.join(base, 'runtime'),
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0', SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
    SWEET_SEARCH_CHAIN_LATER: '0',
  };
  const r = await runInVirtualProcess({ env, cwd: root }, () => runAgentTool('grep', args));
  return { code: r.code, out: r.stdout.toString('utf8'), err: r.stderr.toString('utf8') };
}

describe('ss-grep --in a path that does not exist', () => {
  it('names the one indexed file with the same name', async () => {
    const { code, out } = await ssGrep(['discard', '--in', 'GRDB/Core/Pool.swift']);
    expect(code).toBe(3);
    expect(out).toContain('(scope not found: GRDB/Core/Pool.swift');
    expect(out).toContain('Did you mean --in GRDB/Utils/Pool.swift?)');
    expect(out).not.toContain('Locate the real path first');
  });

  it('names a directory guessed under the wrong parent', async () => {
    const { code, out } = await ssGrep(['x', '--in', 'GRDB/Foo/Utils']);
    expect(code).toBe(3);
    expect(out).toContain('Did you mean --in GRDB/Utils?)');
  });

  it('lists several candidates', async () => {
    const { code, out } = await ssGrep(['x', '--in', 'c/Shared.swift']);
    expect(code).toBe(3);
    expect(out).toContain('Indexed paths named like c/Shared.swift: a/Shared.swift, b/Shared.swift.');
  });

  it('keeps the generic repair line when nothing has that name', async () => {
    const { code, out } = await ssGrep(['x', '--in', 'GRDB/Core/Nope.swift']);
    expect(code).toBe(3);
    expect(out).toContain('Locate the real path first: ss-grep "<name>" with no --in, then re-scope.)');
    expect(out).not.toContain('Did you mean');
  });
});
