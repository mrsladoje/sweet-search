/**
 * ss-grep line allocation, end to end through the real tool code (runAgentTool in a virtual
 * process, as the daemon and the in-process fallback run it) on a real engine (bareGrep over a
 * mock native sparse-gram index). ripgrep is mocked to throw.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/search/search-pattern-ripgrep.js', async (importOriginal) => {
  const actual = await importOriginal();
  const boom = () => { throw new Error('ripgrep must not be invoked on the native grep path'); };
  return {
    ...actual,
    isRipgrepAvailable: () => Promise.resolve(false),
    runRipgrepJson: boom,
    runRipgrepFilesWithMatches: boom,
    runRipgrepJsonStreaming: boom,
  };
});

import { bareGrep } from '../../core/search/index.js';
import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';
import { buildAgentToolDaemonResponse } from '../../core/agent-tools/daemon-route.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';

// dgraph-08-shaped fixture: the answer worker/export.go (22 hits) sorts late in the alphabet;
// plus a generated pb.pb.go (23 hits), test files and one vendored file. 88 hits in 21 files.
const COUNTS = {
  'backup/run.go': 2, 'buildvars/buildvars.go': 2, 'buildvars/buildvars_test.go': 4,
  'dgraph/cmd/live/load-uids/load_test.go': 2, 'dgraphapi/cluster.go': 1, 'dgraphtest/load.go': 1,
  'dgraphtest/local_cluster.go': 1, 'graphql/admin/export.go': 2, 'graphql/e2e/schema/schema_test.go': 1,
  'protos/pb/pb.pb.go': 23, 'protos/pb/pb_grpc.pb.go': 3, 'systest/bulk_live/common/bulk_live_cases.go': 1,
  'systest/export/export_test.go': 4, 'systest/live_pw_test.go': 1, 'systest/vector/load_test.go': 2,
  'testutil/multi_tenancy.go': 1, 'vendor/x/y/export.go': 5, 'worker/backup.go': 1,
  'worker/export.go': 22, 'worker/export_test.go': 8, 'x/metrics.go': 1,
};

const HEADER = '# ss-grep: 88 total match(es) for /func .*Export/ across 21 files\n'
  + '# (+N more in this file)=truncated — see the rest: ss-grep "<regex>" --in <file>\n';

let base;
let root;
let searcher;
let grepCalls;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-grep-alloc-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, '.sweet-search', 'codebase.db'), '');
  const matches = [];
  for (const [file, n] of Object.entries(COUNTS)) {
    const lines = [];
    for (let i = 1; i <= n * 3; i++) lines.push(i % 3 === 0 ? `func Export${i}(ctx context.Context) error {` : `  x := ${i}`);
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${lines.join('\n')}\n`);
    for (let i = 3; i <= n * 3; i += 3) matches.push({ file, line: i, matchText: `func Export${i}`, content: lines[i - 1] });
  }
  const result = { matches, candidateFiles: 21, totalFiles: 21, scannedFiles: 21 };
  grepCalls = [];
  searcher = {
    projectRoot: root,
    sparseGramIndexPath: path.join(base, 'absent-sparse.idx'),
    sparseGramIndex: { searchFull: vi.fn(() => result), searchLines: vi.fn(() => result) },
    hasLateInteractionIndex: false,
    async bareGrep(query, routing, options) {
      grepCalls.push(options);
      return bareGrep.call(this, query, routing, options);
    },
  };
});

afterAll(() => {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

function callEnv(extra = {}) {
  return {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_SOCKET_PATH: path.join(base, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: path.join(base, 'runtime'),
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0',
    SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
    ...extra,
  };
}

/** The in-process path (bin stub / CLI fallback). */
async function ss(tool, args, extra = {}) {
  grepCalls.length = 0;
  const r = await runInVirtualProcess({ env: callEnv(extra), cwd: root },
    () => runAgentTool(tool, args, { getSearcher: () => searcher }));
  return r.stdout.toString('utf8');
}

/** The warm-daemon path (POST /agent-tool), with the real tool runner. */
async function ssDaemon(tool, args, extra = {}) {
  const r = await buildAgentToolDaemonResponse(
    { v: 1, tool, args, cwd: root, env: callEnv(extra), pid: 4242 },
    { isUnixSocket: true, searcher, isReady: () => true },
  );
  expect(r.status).toBe(200);
  return JSON.parse(r.body).stdout;
}

// The shipped rule, -k 8 with SS_FIX_GREP_FULLLINE=0 (each hit prints only the matched text).
// sat2 order: 22 hits 0.92; 2-hit sources 0.5; the 8-hit test file 0.4; then 1/3: the 4-hit test
// files (more hits) before the 1-hit sources. The generated pb.pb.go (0.23) drops out of the 8.
// The guarantee gives each kept file one line. The mock searcher has no code graph, so no line is
// reordered by class.
const K8 = HEADER
  + 'worker/export.go:3: func Export3 (+21 more in this file)\n'
  + 'backup/run.go:3: func Export3 (+1 more in this file)\n'
  + 'buildvars/buildvars.go:3: func Export3 (+1 more in this file)\n'
  + 'graphql/admin/export.go:3: func Export3 (+1 more in this file)\n'
  + 'worker/export_test.go:3: func Export3 (+7 more in this file)\n'
  + 'buildvars/buildvars_test.go:3: func Export3 (+3 more in this file)\n'
  + 'systest/export/export_test.go:3: func Export3 (+3 more in this file)\n'
  + 'dgraphapi/cluster.go:3: func Export3\n'
  + '# +13 more file(s) with 43 match(es) — e.g. dgraphtest/load.go, dgraphtest/local_cluster.go, '
  + 'systest/bulk_live/common/bulk_live_cases.go; narrow the regex, raise -k, or drill in with --in <file>\n';
const fullLines = (out) => out.replace(/: func Export(\d+)/g, ': func Export$1(ctx context.Context) error {');

describe('ss-grep line allocation: sat2 weight, the one-line guarantee, line classes', () => {
  it('keeps the best files, not the first k in the alphabet; files print by weight', async () => {
    expect(await ss('grep', ['func .*Export', '-k', '8'])).toBe(fullLines(K8));
    expect(grepCalls[0]).toMatchObject({ maxFiles: 8, perFileCap: 8 });
  });

  it('-C context renders the same hits in the same order', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '6', '-C', '1']);
    expect(out.startsWith(`${HEADER}worker/export.go-2-   x := 2\nworker/export.go:3: func Export3(ctx context.Context) error { (+21 more in this file)\n`)).toBe(true);
    const hits = (text) => text.split('\n').filter(l => /^[\w/.-]+:\d+:/.test(l)).map(l => l.split(':')[0]);
    expect(hits(out)).toEqual(hits(K8).slice(0, 6));
  });

  it('--in scoped calls keep their flat output (no file selection asked of the engine)', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '2', '--in', 'worker/export.go']);
    expect(out).toBe('# ss-grep: 22 total match(es) for /func .*Export/ (scope: --in worker/export.go)\n'
      + 'worker/export.go:3: func Export3(ctx context.Context) error {\n'
      + 'worker/export.go:6: func Export6(ctx context.Context) error { (+20 more — raise -k)\n');
    expect(grepCalls[0].perFileCap).toBeUndefined();
  });
});

describe('SS_FIX_GREP_FULLLINE=0 prints the matched text', () => {
  it('body, --in: only the hit text differs; -C context is unchanged', async () => {
    const off = { SS_FIX_GREP_FULLLINE: '0' };
    expect(await ss('grep', ['func .*Export', '-k', '8'], off)).toBe(K8);
    expect(await ss('grep', ['func .*Export', '-k', '2', '--in', 'worker/export.go'], off))
      .toBe('# ss-grep: 22 total match(es) for /func .*Export/ (scope: --in worker/export.go)\n'
        + 'worker/export.go:3: func Export3\nworker/export.go:6: func Export6 (+20 more — raise -k)\n');
    // -C context already printed full lines from the file: unchanged by the switch
    expect(await ss('grep', ['func .*Export', '-k', '6', '-C', '1'], off))
      .toBe(await ss('grep', ['func .*Export', '-k', '6', '-C', '1']));
  });
});

describe('the warm daemon (/agent-tool) prints exactly what the in-process tool prints', () => {
  const CALLS = [
    ['grep', ['func .*Export', '-k', '8']],
    ['grep', ['func .*Export', '-k', '30']],
    ['grep', ['func .*Export', '-k', '5', '-A', '2']],
    ['grep', ['func .*Export', '-k', '10', '-g', '!*_test.go']],
    ['grep', ['func .*Export', '-k', '3', '--in', 'worker']],
    ['find', ['export functions', '--regex', 'func .*Export', '-k', '6']],
  ];
  for (const env of [{}, { SS_FIX_GREP_FULLLINE: '0' }, { SS_VARIANT_GREP_BROAD: '5:40' }]) {
    it(`same bytes on both paths (${JSON.stringify(env)})`, async () => {
      for (const [tool, args] of CALLS) {
        const inProcess = await ss(tool, args, env);
        expect(inProcess.length).toBeGreaterThan(0);
        expect(await ssDaemon(tool, args, env)).toBe(inProcess);
      }
    });
  }
});
