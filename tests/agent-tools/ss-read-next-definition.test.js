/**
 * ss-read `below` names the definition that starts right after the window first, also when
 * the window ends inside that definition's doc comment (the chunk then starts inside the
 * window). r3hb-okhttp-12, 2026-10-05: `ss-read RealCall.kt 360 407` ended on callDone's KDoc;
 * the list named five other methods and the agent paid a request to read 408-438.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';

const FILE = 'src/Call.kt';
const JFILE = 'src/Svc.java';
// `void a` 1-10, `@First @Route(\n path) @Fourth` 12-15 (a multi-line annotation), `void target` 16-30, filler to 60.
const JLINES = Array.from({ length: 60 }, (_, i) => `    int y${i + 1} = ${i + 1};`);
JLINES[0] = '  void a() {'; JLINES[9] = '  }';
JLINES[11] = '  @First'; JLINES[12] = '  @Route('; JLINES[13] = '      path = "/x")'; JLINES[14] = '  @Fourth';
JLINES[15] = '  void target() {'; JLINES[29] = '  }';
const TOTAL = 80;
// `fun a` 5-20, KDoc 22-25 + `fun callDone` 26-40, `fun z1`..`fun z6` 42-77 (6 lines each).
function sourceLines() {
  const lines = [];
  for (let i = 1; i <= TOTAL; i++) lines.push(`  val x${i} = ${i}`);
  lines[4] = '  fun a() {'; lines[19] = '  }';
  lines[21] = '  /**'; lines[22] = '   * Completes this call.'; lines[23] = '   * Releases the connection.'; lines[24] = '   */';
  lines[25] = '  private fun callDone() {'; lines[39] = '  }';
  return lines;
}

let base;
let root;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-read-next-def-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, FILE), sourceLines().join('\n') + '\n');
  writeFileSync(path.join(root, JFILE), JLINES.join('\n') + '\n');
  const db = new Database(path.join(root, '.sweet-search', 'codebase.db'));
  try {
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT)');
    const ins = db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)');
    const row = (id, symbol, a, b) => ins.run(id, FILE, '# x', JSON.stringify({ symbol, chunk_type: 'function', line_start: a, line_end: b, language: 'kotlin' }));
    row('c1', 'a', 5, 20);
    row('c2', 'callDone', 22, 40); // the chunk starts at the KDoc
    for (let k = 1; k <= 6; k++) row(`z${k}`, `z${k}`, 36 + 6 * k, 41 + 6 * k);
    const jrow = (id, symbol, a, b) => ins.run(id, JFILE, '# x', JSON.stringify({ symbol, chunk_type: 'method', line_start: a, line_end: b, language: 'java' }));
    jrow('j1', 'a', 1, 10);
    jrow('j2', 'target', 12, 30);
    jrow('j3', 'tail', 31, 60);
  } finally {
    db.close();
  }
  const graph = new Database(path.join(root, '.sweet-search', 'code-graph.db'));
  try {
    graph.exec(`CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT, type TEXT, file_path TEXT,
      start_line INTEGER, end_line INTEGER, parent_class TEXT, signature TEXT, summary TEXT,
      stale_since INTEGER DEFAULT NULL)`);
    const ins = graph.prepare('INSERT INTO entities (id, name, type, file_path, start_line, end_line, parent_class) VALUES (?, ?, ?, ?, ?, ?, ?)');
    ins.run(1, 'a', 'method', FILE, 5, 20, null);
    ins.run(2, 'callDone', 'method', FILE, 26, 40, null); // the definition starts after the KDoc
    for (let k = 1; k <= 6; k++) ins.run(2 + k, `z${k}`, 'method', FILE, 36 + 6 * k, 41 + 6 * k, null);
    ins.run(20, 'a', 'method', JFILE, 1, 10, null);
    ins.run(21, 'target', 'method', JFILE, 16, 30, null);
    ins.run(22, 'tail', 'method', JFILE, 31, 60, null);
  } finally {
    graph.close();
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
  return r.stdout.toString('utf8').trimEnd().split('\n').pop();
}

describe('ss-read below: the definition right after the window comes first', () => {
  it('a window that ends inside the next definition\'s doc comment names it first', async () => {
    expect(await ssRead([FILE, '1', '25'])).toBe('below 26-80: methods callDone, z1, z2, z3, z4 +2 more');
  });

  it('a window that ends on the line before a definition names it first', async () => {
    expect(await ssRead([FILE, '1', '47'])).toMatch(/^below 48-80: methods z2, /);
  });

  it('a run of annotations between the window and the definition does not hide it', async () => {
    expect(await ssRead([JFILE, '1', '12'])).toMatch(/^below 13-60: methods target/);
  });

  it('a definition farther than a few lines below is listed in position order only', async () => {
    expect(await ssRead([FILE, '1', '21'])).toBe('below 22-80: methods callDone, z1, z2, z3, z4 +2 more');
    expect(await ssRead([FILE, '1', '13'])).toMatch(/^method a ends at 20; below 14-80: methods callDone, z1/);
  });
});
