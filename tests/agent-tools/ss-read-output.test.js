/**
 * What `ss-read` prints besides the code (token diet 2026-10-04), through the real wrapper.
 *
 * - No header echoing the path and range; a line `lines a-b of N` only when the lines
 *   served are not the lines typed (end-of-file clamp, start+count form).
 * - A plain fence (no language tag) and no empty line before the closing fence.
 * - The function the window cuts through: `inside method X a-b`, `method X starts at a`, `method X ends at b`.
 * - Owner review 2026-10-04: only the moved range prints above the fence; the rest follows the code, no `#`.
 * - `below a-b: kind names` without a continue command; `(part N)` pieces are one name.
 * - A start past the end of the file is an error that states the length (it printed the
 *   whole file). A later call of a chained command opens with `# ss-read <file name>`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';
import { fenceBody, formatReadResults, readFile } from '../../core/search/search-read.js';

const FILE = 'lib/pool.rb';
const TOTAL = 60;
// 1-9 header, `def hold` 10-30, `def size` 32-34, `def big` 36-58 (chunked in two parts).
function sourceLines() {
  const lines = [];
  for (let i = 1; i <= TOTAL; i++) {
    if (i === 10) lines.push('  def hold(server=nil)');
    else if (i === 30) lines.push('  end');
    else if (i === 32) lines.push('  def size');
    else if (i === 34) lines.push('  end');
    else if (i === 36) lines.push('  def big');
    else if (i === 58) lines.push('  end');
    else lines.push(`    x${i} = ${i}`);
  }
  return lines;
}

let base;
let root;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-read-output-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, 'lib'), { recursive: true });
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, FILE), sourceLines().join('\n') + '\n');
  const db = new Database(path.join(root, '.sweet-search', 'codebase.db'));
  try {
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT)');
    const ins = db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)');
    const row = (id, symbol, a, b) => ins.run(id, FILE, '# x', JSON.stringify({ symbol, chunk_type: 'method', line_start: a, line_end: b, language: 'ruby' }));
    row('c1', 'hold', 10, 30);
    row('c2', 'size', 32, 34);
    row('c3', 'big', 36, 47);
    row('c4', 'big (part 2)', 48, 58);
  } finally {
    db.close();
  }
  const graph = new Database(path.join(root, '.sweet-search', 'code-graph.db'));
  try {
    graph.exec(`CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT, type TEXT, file_path TEXT,
      start_line INTEGER, end_line INTEGER, parent_class TEXT, signature TEXT, summary TEXT,
      stale_since INTEGER DEFAULT NULL)`);
    const ins = graph.prepare('INSERT INTO entities (id, name, type, file_path, start_line, end_line, parent_class) VALUES (?, ?, ?, ?, ?, ?, ?)');
    ins.run(1, 'Pool', 'class', FILE, 1, 60, null);
    ins.run(2, 'hold', 'method', FILE, 10, 30, 'Pool');
    ins.run(3, 'size', 'method', FILE, 32, 34, 'Pool');
    ins.run(4, 'big', 'method', FILE, 36, 58, 'Pool');
  } finally {
    graph.close();
  }
});

afterAll(() => {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function ssRead(args, extraEnv = {}) {
  const env = {
    PATH: process.env.PATH || '', HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_SOCKET_PATH: path.join(base, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: path.join(base, 'runtime'),
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0', SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
    SS_READ_GUTTER: 'none', SWEET_SEARCH_CHAIN_LATER: '0',
    ...extraEnv,
  };
  const r = await runInVirtualProcess({ env, cwd: root }, () => runAgentTool('read', args));
  return { code: r.code, out: r.stdout.toString('utf8'), err: r.stderr.toString('utf8') };
}

const src = (a, b) => sourceLines().slice(a - 1, b).join('\n');

describe('ss-read output shape', () => {
  it('a range read prints the code in a plain fence, no header, no empty last line', async () => {
    const { code, out, err } = await ssRead([FILE, '32', '34']);
    expect(code).toBe(0);
    expect(err).toBe('');
    // Window ends at `def size`'s end: no function runs on, so the type around it is named;
    // the rest below is named.
    expect(out).toBe(`\`\`\`\n${src(32, 34)}\n\`\`\`\ninside class Pool 1-60\nbelow 35-60: method big\n`);
  });

  it('a window inside one function says so once, after the fence', async () => {
    const { out } = await ssRead([FILE, '12', '14']);
    expect(out.split('\n')[0]).toBe('```');
    expect(out.trimEnd().split('\n').slice(-2)).toEqual(['inside method hold 10-30', 'below 15-60: methods size, big']);
  });

  it('ss-read <file> <symbol> serves one definition, its parts joined', async () => {
    const hold = await ssRead([FILE, 'hold']);
    expect(hold.err).toBe('');
    expect(hold.out.split('\n')[0]).toBe('lines 10-30 of 60');
    expect(hold.out).toContain(`\`\`\`\n${src(10, 30)}\n\`\`\``);
    const big = await ssRead([FILE, 'big']);
    expect(big.out.split('\n')[0]).toBe('lines 36-58 of 60');
    const missing = await ssRead([FILE, 'nope']);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('no definition named "nope" in lib/pool.rb');
  });


  it('names the function the window starts in and the one it ends in', async () => {
    const { out } = await ssRead([FILE, '20', '40']);
    expect(out.trimEnd().split('\n').slice(-2)).toEqual(['method hold starts at 10', 'method big ends at 58; below 41-60']);
    // `big` is cut: its end is named, and it is not listed again below (nor its part 2).
  });

  it('a one-line read inside a function names where the function ends', async () => {
    const { out } = await ssRead([FILE, '10']);
    expect(out).toBe(`\`\`\`\n${src(10, 10)}\n\`\`\`\nmethod hold ends at 30; below 11-60: methods size, big\n`);
  });

  it('(part N) pieces of one definition are one name', async () => {
    const { out } = await ssRead([FILE, '1', '5']);
    expect(out.trimEnd().split('\n').pop()).toBe('below 6-60: methods hold, size, big');
  });

  it('a whole-file read is the file in a fence and nothing else', async () => {
    const { out } = await ssRead([FILE]);
    expect(out).toBe(`\`\`\`\n${src(1, TOTAL)}\n\`\`\`\n`);
  });

  it('prints the range only when the lines served are not the lines typed', async () => {
    const clamped = await ssRead([FILE, '55', '90']);
    expect(clamped.out.split('\n')[0]).toBe('lines 55-60 of 60');
    expect(clamped.out.trimEnd().split('\n').pop()).toBe('method big starts at 36');
    // start+count (`5 3` = lines 5-7): the header shows it, no stderr note.
    const count = await ssRead([FILE, '5', '3']);
    expect(count.err).toBe('');
    expect(count.out.split('\n')[0]).toBe('lines 5-7 of 60');
    expect(count.out).toContain(`\`\`\`\n${src(5, 7)}\n\`\`\``);
  });

  it('a start past the end is an error that states the length, not the whole file', async () => {
    const { code, out, err } = await ssRead([FILE, '400', '500']);
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toBe(`[ss-read] the file has 60 lines; line 400 is past the end\n`);
  });

  it('a later call of a chained command opens with the file name', async () => {
    const { out } = await ssRead([FILE, '32', '34'], { SWEET_SEARCH_CHAIN_LATER: '1' });
    expect(out.split('\n')[0]).toBe('# ss-read pool.rb');
  });

  it('a missing file gets one short line', async () => {
    const { code, err } = await ssRead(['lib/nope.rb', '1', '2']);
    expect(code).toBe(1);
    expect(err).toBe('[ss-read] no such file; find it: ss-grep "nope.rb" or ss-search "<what it does>"\n');
  });

  it('the colon gutter numbers reads of 15+ source lines; a final newline is not a line', async () => {
    const fifteen = await ssRead([FILE, '1', '15'], { SS_READ_GUTTER: 'colon' });
    expect(fifteen.out.startsWith('```\n1:    x1 = 1\n')).toBe(true);
    expect(fifteen.out).toContain('\n15:    x15 = 15\n```\n');
    const fourteen = await ssRead([FILE, '1', '14'], { SS_READ_GUTTER: 'colon' });
    expect(fourteen.out).toContain(`\`\`\`\n${src(1, 14)}\n\`\`\``);
  });
});

describe('readFile / formatReadResults (read CLI, MCP)', () => {
  it('a start past the end selects nothing and names nothing above', async () => {
    const r = await readFile({ path: FILE, projectRoot: root, startLine: 400, endLine: 500 });
    expect(r.text).toBe('');
    expect(r.range).toEqual({ startLine: 400, endLine: 399 });
    expect(r.unreadAbove).toBeNull();
    expect(r.unreadBelow).toBeNull();
  });

  it('the agent format has no empty line before the closing fence and keeps its continue command', async () => {
    const r = await readFile({ path: FILE, projectRoot: root, startLine: 32, endLine: 34 });
    const out = formatReadResults({ files: [r], totalMs: 1 }, 'agent', { lineNumbers: false });
    expect(out).toContain(`${src(32, 34)}\n\`\`\`\n# unread below (35-60): big — continue: read ${FILE} 35-60`);
  });
});

describe('fenceBody', () => {
  it('drops exactly one final newline', () => {
    expect(fenceBody('a\nb\n')).toBe('a\nb');
    expect(fenceBody('a\nb')).toBe('a\nb');
    expect(fenceBody('a\n\n')).toBe('a\n');
    expect(fenceBody('a\r\n')).toBe('a');
    expect(fenceBody('')).toBe('');
  });
});
