/**
 * ss-grep -l and -c from a fresh process (no daemon host hooks) get their answer from the warm
 * daemon. They ask for every matching file (`maxFiles` = GREP_FILE_MODE_MAX_FILES); while the
 * daemon's own parser refused that value, each call fell back to a cold engine in the tool's
 * process (2 to 8 s) although a ready daemon was there.
 *
 * The fake daemon checks the request with the real parser of /search and answers 400 as the real
 * handler does. A cold engine fails the call.
 */
import http from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/search/sweet-search.js', () => ({
  SweetSearch: class { constructor() { throw new Error('a cold engine was loaded'); } },
}));
vi.mock('../../core/search/search-client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  autoSpawnServer: async () => { throw new Error('a daemon was spawned'); },
}));

const { readGrepShapingParams } = await import('../../core/search/search-server.js');
const { GREP_FILE_MODE_MAX_FILES } = await import('../../core/search/grep-output-shaping.js');
const { runInVirtualProcess } = await import('../../core/agent-tools/virtual-process.js');
const { runAgentTool } = await import('../../core/agent-tools/run-agent-tool.mjs');

const FILES = [{ file: 'src/b.rs', total: 1, kept: 1 }, { file: 'a.go', total: 3, kept: 1 }];
let base;
let root;
let server;
let searches;

beforeEach(async () => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-grep-file-modes-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, '.sweet-search', 'codebase.db'), '');
  searches = [];
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://daemon');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/health') return send(200, { status: 'ready', warm: true });
    let shaping;
    try { shaping = readGrepShapingParams(url.searchParams); } catch (err) {
      searches.push({ status: 400, error: err.message });
      return send(400, { error: err.message });
    }
    searches.push({ status: 200, ...shaping });
    return send(200, {
      results: FILES.map((f) => ({ file: f.file, line: 1, matchText: 'Head', content: 'Head' })),
      stats: { totalMatches: 4 },
      fileSummary: { files: FILES, hiddenFileCount: 0 },
    });
  });
  await new Promise((resolve) => server.listen(path.join(base, 'd.sock'), resolve));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(base, { recursive: true, force: true });
});

async function ssGrep(args) {
  const env = {
    PATH: process.env.PATH || '', HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_SOCKET_PATH: path.join(base, 'd.sock'),
    SWEET_SEARCH_RUNTIME_DIR: path.join(base, 'runtime'),
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0', SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0', SWEET_SEARCH_CHAIN_LATER: '0',
  };
  const r = await runInVirtualProcess({ env, cwd: root, pid: process.pid }, () => runAgentTool('grep', args));
  return { code: r.code, out: r.stdout.toString('utf8'), err: r.stderr.toString('utf8') };
}

describe('ss-grep -l / -c without host hooks', () => {
  it('-l is answered by the warm daemon, in the daemon\'s file order', async () => {
    const r = await ssGrep(['-l', 'Head']);
    expect(r.err).toBe('');
    expect(r).toMatchObject({ code: 0, out: 'src/b.rs\na.go\n' });
    expect(searches).toEqual([expect.objectContaining({ status: 200, maxFiles: GREP_FILE_MODE_MAX_FILES, perFileCap: 1 })]);
  });

  it('-c is answered by the warm daemon, in path order', async () => {
    const r = await ssGrep(['-c', 'Head']);
    expect(r.err).toBe('');
    expect(r).toMatchObject({ code: 0, out: 'a.go:3\nsrc/b.rs:1\n' });
    expect(searches).toEqual([expect.objectContaining({ status: 200, maxFiles: GREP_FILE_MODE_MAX_FILES })]);
  });
});
