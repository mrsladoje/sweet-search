/**
 * ss-grep line allocation (SS_FIX_GREP_ALLOC, default ON), end to end through the real tool code
 * (runAgentTool in a virtual process, as the daemon and the in-process fallback run it) on a real
 * engine (bareGrep over a mock native sparse-gram index). ripgrep is mocked to throw.
 *
 * The legacy expectations below are origin/main's own output for the same fixture and arguments
 * (captured 2026-10-02 by running origin/main's tool code on this fixture), so SS_FIX_GREP_ALLOC=0
 * is pinned to the previous bytes, not to a re-derivation of them.
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

describe('ss-grep line allocation (default: sqrt(hits) x prior, Sainte-Laguë)', () => {
  it('keeps the best files, not the first k in the alphabet; files print by weight', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '8']);
    expect(out).toBe(HEADER
      + 'worker/export.go:3: func Export3\n'
      + 'worker/export.go:6: func Export6 (+20 more in this file)\n'
      + 'worker/export_test.go:3: func Export3 (+7 more in this file)\n'
      + 'backup/run.go:3: func Export3 (+1 more in this file)\n'
      + 'buildvars/buildvars.go:3: func Export3 (+1 more in this file)\n'
      + 'graphql/admin/export.go:3: func Export3 (+1 more in this file)\n'
      + 'protos/pb/pb.pb.go:3: func Export3 (+22 more in this file)\n'
      + 'buildvars/buildvars_test.go:3: func Export3 (+3 more in this file)\n'
      + '# +14 more file(s) with 25 match(es) — e.g. systest/export/export_test.go, dgraphapi/cluster.go, '
      + 'dgraphtest/load.go; narrow the regex, raise -k, or drill in with --in <file>\n');
    // the engine was asked for the weighted selection of k files
    expect(grepCalls[0]).toMatchObject({ grepFileOrder: 'weight', maxFiles: 8, perFileCap: 8 });
  });

  it('-C context renders the same hits in the same order', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '6', '-C', '1']);
    expect(out.startsWith(`${HEADER}worker/export.go-2-   x := 2\nworker/export.go:3: func Export3(ctx context.Context) error {\n`)).toBe(true);
    expect(out).toContain('worker/export.go:6: func Export6(ctx context.Context) error { (+20 more in this file)\n');
    expect(out.endsWith('# +16 more file(s) with 52 match(es) — e.g. protos/pb/pb.pb.go, buildvars/buildvars_test.go, '
      + 'systest/export/export_test.go; narrow the regex, raise -k, or drill in with --in <file>\n')).toBe(true);
  });

  it('--in scoped calls keep their flat output (no weighting asked of the engine)', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '2', '--in', 'worker/export.go']);
    expect(out).toBe('# ss-grep: 22 total match(es) for /func .*Export/ (scope: --in worker/export.go)\n'
      + 'worker/export.go:3: func Export3\nworker/export.go:6: func Export6 (+20 more — raise -k)\n');
    expect(grepCalls[0].grepFileOrder).toBeUndefined();
  });
});

describe('SS_FIX_GREP_ALLOC=0 restores the previous output byte for byte', () => {
  // origin/main output for these exact calls (see the file header).
  const LEGACY_K8 = HEADER
    + 'backup/run.go:3: func Export3 (+1 more in this file)\n'
    + 'buildvars/buildvars_test.go:3: func Export3 (+3 more in this file)\n'
    + 'buildvars/buildvars.go:3: func Export3 (+1 more in this file)\n'
    + 'dgraph/cmd/live/load-uids/load_test.go:3: func Export3 (+1 more in this file)\n'
    + 'dgraphapi/cluster.go:3: func Export3\n'
    + 'dgraphtest/load.go:3: func Export3\n'
    + 'dgraphtest/local_cluster.go:3: func Export3\n'
    + 'graphql/admin/export.go:3: func Export3 (+1 more in this file)\n'
    + '# +13 more file(s) with 73 match(es) — e.g. graphql/e2e/schema/schema_test.go, protos/pb/pb_grpc.pb.go, '
    + 'protos/pb/pb.pb.go; narrow the regex, raise -k, or drill in with --in <file>\n';
  const LEGACY_K6_C1 = HEADER
    + 'backup/run.go-2-   x := 2\nbackup/run.go:3: func Export3(ctx context.Context) error { (+1 more in this file)\nbackup/run.go-4-   x := 4\n--\n'
    + 'buildvars/buildvars_test.go-2-   x := 2\nbuildvars/buildvars_test.go:3: func Export3(ctx context.Context) error { (+3 more in this file)\nbuildvars/buildvars_test.go-4-   x := 4\n--\n'
    + 'buildvars/buildvars.go-2-   x := 2\nbuildvars/buildvars.go:3: func Export3(ctx context.Context) error { (+1 more in this file)\nbuildvars/buildvars.go-4-   x := 4\n--\n'
    + 'dgraph/cmd/live/load-uids/load_test.go-2-   x := 2\ndgraph/cmd/live/load-uids/load_test.go:3: func Export3(ctx context.Context) error { (+1 more in this file)\ndgraph/cmd/live/load-uids/load_test.go-4-   x := 4\n--\n'
    + 'dgraphapi/cluster.go-2-   x := 2\ndgraphapi/cluster.go:3: func Export3(ctx context.Context) error {\n--\n'
    + 'dgraphtest/load.go-2-   x := 2\ndgraphtest/load.go:3: func Export3(ctx context.Context) error {\n'
    + '# +15 more file(s) with 76 match(es) — e.g. dgraphtest/local_cluster.go, graphql/admin/export.go, '
    + 'graphql/e2e/schema/schema_test.go; narrow the regex, raise -k, or drill in with --in <file>\n';

  it('the switch, SS_FIX_A=0 and the product opt-out all give origin/main\'s bytes', async () => {
    for (const env of [{ SS_FIX_GREP_ALLOC: '0' }, { SS_FIX_A: '0' }, { SWEET_SEARCH_COMPACT_OUTPUT: '0' }]) {
      expect(await ss('grep', ['func .*Export', '-k', '8'], env)).toBe(LEGACY_K8);
      expect(grepCalls[0].grepFileOrder).toBeUndefined();
      expect(await ss('grep', ['func .*Export', '-k', '6', '-C', '1'], env)).toBe(LEGACY_K6_C1);
    }
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
  for (const env of [{}, { SS_FIX_GREP_ALLOC: '0' }, { SS_FIX_GREP_ORDER: '1' }]) {
    it(`same bytes on both paths (${JSON.stringify(env)})`, async () => {
      for (const [tool, args] of CALLS) {
        const inProcess = await ss(tool, args, env);
        expect(inProcess.length).toBeGreaterThan(0);
        expect(await ssDaemon(tool, args, env)).toBe(inProcess);
      }
    });
  }
});

describe('B7 (SS_FIX_GREP_ORDER=1) on top of the weighted rule', () => {
  it('body mode: the prior already ranks tests below source, so B7 adds no reordering', async () => {
    // 31 hits (< 50): the per-hit body, not B7's line lists
    const args = ['func .*Export', '-k', '8', '-g', '!protos/**', '-g', '!worker/**'];
    const withB7 = await ss('grep', args, { SS_FIX_GREP_ORDER: '1' });
    expect(withB7).toMatch(/^# ss-grep: 31 total match\(es\)/);
    // B7 still drops the repeated matched text (every shown hit reads `func Export3`) ...
    const hits = (out) => out.split('\n').filter(l => /^[\w/.-]+:\d+/.test(l)).map(l => l.match(/^([\w/.-]+:\d+)/)[1]);
    expect(withB7).toContain('\nbackup/run.go:3 (+1 more in this file)\n');
    // ... but the hits and their order are the weighted rule's, untouched by source-before-tests
    expect(hits(withB7)).toEqual(hits(await ss('grep', args)));
    // weight 1.41 (2-hit sources) first; the 4-hit test files (1.0) tie the 1-hit sources and
    // win on hits; the vendored 5-hit file (0.56) gets no line
    expect(hits(withB7).slice(0, 5)).toEqual([
      'backup/run.go:3', 'buildvars/buildvars.go:3', 'graphql/admin/export.go:3',
      'buildvars/buildvars_test.go:3', 'systest/export/export_test.go:3',
    ]);
    expect(withB7).not.toContain('vendor/x/y/export.go:');
  });

  it('list mode (>= 50 hits) still prints B7\'s per-file line lists', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '8'], { SS_FIX_GREP_ORDER: '1' });
    expect(out).toContain('# 88 hits: first hit lines per file');
    expect(out).toContain('worker/export.go: lines 3, 6, 9 (+19 more)\n');
    expect(grepCalls[0]).toMatchObject({ grepFileOrder: 'weight', maxFiles: 100 });
  });
});
