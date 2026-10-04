/**
 * ss-grep line allocation (SS_FIX_GREP_ALLOC, default ON), end to end through the real tool code
 * (runAgentTool in a virtual process, as the daemon and the in-process fallback run it) on a real
 * engine (bareGrep over a mock native sparse-gram index). ripgrep is mocked to throw.
 *
 * The legacy expectations below are origin/main's own selection for the same fixture and arguments
 * (captured 2026-10-02 by running origin/main's tool code on this fixture), so SS_FIX_GREP_ALLOC=0
 * is pinned to the previous files, lines and counts, not to a re-derivation of them. Since
 * 2026-10-04 every arm prints the grouped listing (path once, `LINE:text` under it, no header).
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
import { grepHitCount } from './grep-listing-helpers.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';
import { GREP_BROAD_HIT_CHARS, GREP_BROAD_MIN_HITS, grepBroadHitMax } from '../../core/search/agent-output-fixes.js';

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

const HINT = '# hidden hits: raise -k or use --in <file>\n';

// The weighted -k 8 body with SS_FIX_GREP_FULLLINE=0: each hit prints only the matched text.
const WEIGHTED_K8 = ''
  + 'worker/export.go\n3:func Export3\n6:func Export6\n(+20 more)\n'
  + 'worker/export_test.go\n3:func Export3\n(+7 more)\n'
  + 'backup/run.go\n3:func Export3\n(+1 more)\n'
  + 'buildvars/buildvars.go\n3:func Export3\n(+1 more)\n'
  + 'graphql/admin/export.go\n3:func Export3\n(+1 more)\n'
  + 'protos/pb/pb.pb.go\n3:func Export3\n(+22 more)\n'
  + 'buildvars/buildvars_test.go\n3:func Export3\n(+3 more)\n'
  + '# +14 more files with 25 hits: systest/export/export_test.go, dgraphapi/cluster.go, dgraphtest/load.go\n'
  + HINT;

/** The path lines of a listing, in print order. */
const pathLines = (out) => out.split('\n').filter(l => l && !/^(\d|#|--|\(\+)/.test(l));

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

// The 2026-10-02 shipped rule (sqrt(hits) x prior, Sainte-Laguë, prefix lines): the legacy values of
// the three ss-grep switches that are default ON since 2026-10-03.
const PREV = { SS_FIX_GREP_WEIGHT: 'sqrt', SS_FIX_GREP_ALLOC_RULE: 'sl', SS_FIX_GREP_LINES: '0' };

describe('ss-grep line allocation (2026-10-02 rule: sqrt(hits) x prior, Sainte-Laguë)', () => {
  it('keeps the best files, not the first k in the alphabet; files print by weight', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '8'], PREV);
    expect(out).toBe(WEIGHTED_K8.replace(/:func Export(\d+)/g, ':func Export$1(ctx context.Context) error {'));
    // the engine was asked for the weighted selection of k files
    expect(grepCalls[0]).toMatchObject({ grepFileOrder: 'weight', maxFiles: 8, perFileCap: 8 });
    expect(grepCalls[0].grepFileWeight).toBeUndefined();
    expect(grepCalls[0].grepLineClasses).toBeUndefined();
  });

  it('-C context renders the same hits in the same order', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '6', '-C', '1'], PREV);
    // one window per file (2-7 merges the hits at 3 and 6); no `--` between files, the path separates them
    expect(out.startsWith('worker/export.go\n2-  x := 2\n3:func Export3(ctx context.Context) error {\n'
      + '4-  x := 4\n5-  x := 5\n6:func Export6(ctx context.Context) error {\n7-  x := 7\n(+20 more)\nworker/export_test.go\n')).toBe(true);
    expect(out).not.toMatch(/^--$/m);
    expect(out.endsWith('# +16 more files with 52 hits: protos/pb/pb.pb.go, buildvars/buildvars_test.go, '
      + `systest/export/export_test.go\n${HINT}`)).toBe(true);
  });

  it('--in scoped calls keep their flat output (no weighting asked of the engine)', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '2', '--in', 'worker/export.go']);
    // PATH RULE: the one --in file is typed in the command; no heading repeats it.
    expect(out).toBe(''
      + '3:func Export3(ctx context.Context) error {\n'
      + '6:func Export6(ctx context.Context) error {\n'
      + '# +20 more hits (raise -k)\n');
    expect(grepCalls[0].grepFileOrder).toBeUndefined();
  });
});

describe('Step 2 arms (guarantee and sat2 default ON since 2026-10-03): SS_FIX_GREP_ALLOC_RULE, SS_FIX_GREP_WEIGHT', () => {
  const HIDDEN_13 = '# +13 more files with 21 hits: dgraphapi/cluster.go, dgraphtest/load.go, '
    + `dgraphtest/local_cluster.go\n${HINT}`;

  it('guarantee and hh: each of the 8 kept files gets one line, so the 8th file shows too', async () => {
    for (const rule of ['guarantee', 'hh']) {
      const out = await ss('grep', ['func .*Export', '-k', '8'], { ...PREV, SS_FIX_GREP_ALLOC_RULE: rule, SS_FIX_GREP_FULLLINE: '0' });
      expect(out).toBe(''
        + 'worker/export.go\n3:func Export3\n(+21 more)\n'
        + 'worker/export_test.go\n3:func Export3\n(+7 more)\n'
        + 'backup/run.go\n3:func Export3\n(+1 more)\n'
        + 'buildvars/buildvars.go\n3:func Export3\n(+1 more)\n'
        + 'graphql/admin/export.go\n3:func Export3\n(+1 more)\n'
        + 'protos/pb/pb.pb.go\n3:func Export3\n(+22 more)\n'
        + 'buildvars/buildvars_test.go\n3:func Export3\n(+3 more)\n'
        + 'systest/export/export_test.go\n3:func Export3\n(+3 more)\n'
        + HIDDEN_13);
      // renderer-only: the engine request is the shipped one
      expect(grepCalls[0]).toMatchObject({ grepFileOrder: 'weight', maxFiles: 8 });
      expect(grepCalls[0].grepFileWeight).toBeUndefined();
    }
  });

  it('sat2: the engine keeps and orders files by hits / (hits + 2) x prior', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '8'], { ...PREV, SS_FIX_GREP_WEIGHT: 'sat2' });
    expect(grepCalls[0]).toMatchObject({ grepFileOrder: 'weight', grepFileWeight: 'sat2' });
    // 22 hits 0.92; 2-hit sources 0.5; the 8-hit test file 0.4; then 1/3: the 4-hit test files
    // (more hits) before the 1-hit sources. The generated pb.pb.go (0.23) drops out of the 8.
    expect(pathLines(out).map(l => l.split(' ')[0])).toEqual([
      'worker/export.go', 'backup/run.go', 'buildvars/buildvars.go', 'graphql/admin/export.go',
      'worker/export_test.go', 'buildvars/buildvars_test.go', 'systest/export/export_test.go', 'dgraphapi/cluster.go',
    ]);
    expect(out).toContain('# +13 more files with 43 hits: dgraphtest/load.go, dgraphtest/local_cluster.go');
  });
});

describe('the product default since 2026-10-03: sat2 weight, the one-line guarantee, line classes', () => {
  it('asks the engine for sat2 and line classes, and gives each of the 8 kept files a line', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '8'], { SS_FIX_GREP_FULLLINE: '0' });
    expect(grepCalls[0]).toMatchObject({ grepFileOrder: 'weight', grepFileWeight: 'sat2', grepLineClasses: true, maxFiles: 8 });
    // sat2 order (see the sat2 test above); the guarantee gives each kept file one line.
    // The mock searcher has no code graph, so no line is reordered by class.
    expect(out).toBe(''
      + 'worker/export.go\n3:func Export3\n(+21 more)\n'
      + 'backup/run.go\n3:func Export3\n(+1 more)\n'
      + 'buildvars/buildvars.go\n3:func Export3\n(+1 more)\n'
      + 'graphql/admin/export.go\n3:func Export3\n(+1 more)\n'
      + 'worker/export_test.go\n3:func Export3\n(+7 more)\n'
      + 'buildvars/buildvars_test.go\n3:func Export3\n(+3 more)\n'
      + 'systest/export/export_test.go\n3:func Export3\n(+3 more)\n'
      + 'dgraphapi/cluster.go\n3:func Export3\n'
      + '# +13 more files with 43 hits: dgraphtest/load.go, dgraphtest/local_cluster.go, '
      + `systest/bulk_live/common/bulk_live_cases.go\n${HINT}`);
  });
});

describe('SS_FIX_GREP_ALLOC=0 restores the previous selection (files, lines, counts)', () => {
  // origin/main's selection for these exact calls (see the file header), in the grouped listing.
  const LEGACY_K8 = ''
    + 'backup/run.go\n3:func Export3\n(+1 more)\n'
    + 'buildvars/buildvars_test.go\n3:func Export3\n(+3 more)\n'
    + 'buildvars/buildvars.go\n3:func Export3\n(+1 more)\n'
    + 'dgraph/cmd/live/load-uids/load_test.go\n3:func Export3\n(+1 more)\n'
    + 'dgraphapi/cluster.go\n3:func Export3\n'
    + 'dgraphtest/load.go\n3:func Export3\n'
    + 'dgraphtest/local_cluster.go\n3:func Export3\n'
    + 'graphql/admin/export.go\n3:func Export3\n(+1 more)\n'
    + '# +13 more files with 73 hits: graphql/e2e/schema/schema_test.go, protos/pb/pb_grpc.pb.go, protos/pb/pb.pb.go\n'
    + HINT;
  const win = (file, more, last = 4) => `${file}\n2-  x := 2\n3:func Export3(ctx context.Context) error {\n`
    + (last >= 4 ? '4-  x := 4\n' : '') + (more ? `(+${more} more)\n` : '');
  const LEGACY_K6_C1 = win('backup/run.go', 1) + win('buildvars/buildvars_test.go', 3) + win('buildvars/buildvars.go', 1)
    + win('dgraph/cmd/live/load-uids/load_test.go', 1) + win('dgraphapi/cluster.go', 0, 3) + win('dgraphtest/load.go', 0, 3)
    + '# +15 more files with 76 hits: dgraphtest/local_cluster.go, graphql/admin/export.go, graphql/e2e/schema/schema_test.go\n'
    + HINT;

  it('the switch, SS_FIX_A=0 and the product opt-out all give origin/main\'s selection', async () => {
    // SS_FIX_GREP_FULLLINE=0 too: origin/main printed the matched text.
    const both = { SS_FIX_GREP_ALLOC: '0', SS_FIX_GREP_FULLLINE: '0' };
    for (const env of [both, { SS_FIX_A: '0' }, { SWEET_SEARCH_COMPACT_OUTPUT: '0' }]) {
      expect(await ss('grep', ['func .*Export', '-k', '8'], env)).toBe(LEGACY_K8);
      expect(grepCalls[0].grepFileOrder).toBeUndefined();
      expect(await ss('grep', ['func .*Export', '-k', '6', '-C', '1'], env)).toBe(LEGACY_K6_C1);
    }
  });
});

describe('SS_FIX_GREP_FULLLINE=0 restores the matched-text output byte for byte', () => {
  it('body, --in and the allocation rule: only the hit text differs', async () => {
    const off = { SS_FIX_GREP_FULLLINE: '0' };
    expect(await ss('grep', ['func .*Export', '-k', '8'], { ...PREV, ...off })).toBe(WEIGHTED_K8);
    expect(await ss('grep', ['func .*Export', '-k', '2', '--in', 'worker/export.go'], off))
      .toBe('3:func Export3\n6:func Export6\n# +20 more hits (raise -k)\n');
    // SS_FIX_GREP_ALLOC=0 alone keeps the full lines on the path-order rule
    const legacyAlloc = await ss('grep', ['func .*Export', '-k', '8'], { SS_FIX_GREP_ALLOC: '0' });
    expect(legacyAlloc).toContain('backup/run.go\n3:func Export3(ctx context.Context) error {\n(+1 more)\n');
    expect(await ss('grep', ['func .*Export', '-k', '8'], { SS_FIX_GREP_ALLOC: '0', ...off }))
      .toBe(legacyAlloc.replace(/:func Export(\d+)\(ctx context\.Context\) error \{/g, ':func Export$1'));
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
  for (const env of [{}, PREV, { SS_FIX_GREP_ALLOC: '0' }, { SS_FIX_GREP_ORDER: '1' }, { SS_FIX_GREP_FULLLINE: '0' }]) {
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
    // B7 still drops the repeated matched text (every shown hit reads `func Export3`) ...
    const hits = (out) => {
      const seq = [];
      let file = null;
      for (const l of out.split('\n')) {
        if (/^\d+/.test(l)) seq.push(`${file}:${l.match(/^\d+/)[0]}`);
        else if (l && !l.startsWith('#') && !l.startsWith('(+')) file = l.split(' ')[0];
      }
      return seq;
    };
    expect(withB7.startsWith('backup/run.go\n3\n(+1 more)\n')).toBe(true);
    // ... but the hits and their order are the weighted rule's, untouched by source-before-tests
    expect(hits(withB7)).toEqual(hits(await ss('grep', args)));
    // weight 1.41 (2-hit sources) first; the 4-hit test files (1.0) tie the 1-hit sources and
    // win on hits; the vendored 5-hit file (0.56) gets no line
    expect(hits(withB7).slice(0, 5)).toEqual([
      'backup/run.go:3', 'buildvars/buildvars.go:3', 'graphql/admin/export.go:3',
      'buildvars/buildvars_test.go:3', 'systest/export/export_test.go:3',
    ]);
    expect(withB7).not.toContain('vendor/x/y/export.go');
  });

  it('list mode (>= 50 hits) still prints B7\'s per-file line lists', async () => {
    const out = await ss('grep', ['func .*Export', '-k', '8'], { SS_FIX_GREP_ORDER: '1' });
    expect(out).toContain('# 88 hits: first hit lines per file');
    expect(out).toContain('worker/export.go: lines 3, 6, 9 (+19 more)\n');
    expect(grepCalls[0]).toMatchObject({ grepFileOrder: 'weight', maxFiles: 100 });
  });
});

describe('the listing (2026-10-04): no header, every hidden hit counted, chained-call boundary', () => {
  it('no header and no regex echo: the harness shows the command', async () => {
    for (const args of [['func .*Export', '-k', '8'], ['func .*Export', '-k', '2', '--in', 'worker'], ['func .*Export', '-k', '3', '-A', '1']]) {
      const out = await ss('grep', args);
      expect(out).not.toContain('# ss-grep');
      expect(out).not.toContain('func .*Export');
      expect(out).not.toContain('total match');
    }
  });

  it('shown rows + (+N more) + hidden files add up to every hit, for any -k, with or without context', async () => {
    for (const k of ['1', '3', '8', '20', '30', '100']) {
      expect(grepHitCount(await ss('grep', ['func .*Export', '-k', k])), `-k ${k}`).toBe(88);
      expect(grepHitCount(await ss('grep', ['func .*Export', '-k', k, '-C', '1'])), `-k ${k} -C 1`).toBe(88);
      expect(grepHitCount(await ss('grep', ['func .*Export', '-k', k, '--in', 'worker'])), `-k ${k} --in worker`).toBe(31);
    }
  });

  it('an indexed family line is added after the listing; it never replaces a hit row (the dgraph silent cut)', async () => {
    const plain = await ss('grep', ['func .*Export', '-k', '8']);
    const orig = searcher.bareGrep;
    searcher.bareGrep = async function (...a) {
      const r = await orig.apply(this, a);
      return { ...r, familyManifest: { rendered: '# indexed family: Export{3,6,9}' } };
    };
    try {
      const out = await ss('grep', ['func .*Export', '-k', '8']);
      expect(out).toBe(plain.replace(/^# \+\d+ more files/m, '# indexed family: Export{3,6,9}\n$&'));
      expect(grepHitCount(out)).toBe(88);
    } finally { searcher.bareGrep = orig; }
  });

  it('the sibling line is `# siblings:` and leaves out sites that print as a hit or context row', async () => {
    const orig = searcher.bareGrep;
    searcher.bareGrep = async function (...a) {
      const r = await orig.apply(this, a);
      return { ...r, siblingLine: { rendered: '# same file (siblings of Export3): 3: x · 5: y · 9: z',
        sites: [{ line: 3, text: 'x' }, { line: 5, text: 'y' }, { line: 9, text: 'z' }] } };
    };
    try {
      const args = ['func .*Export', '-k', '100', '-g', 'backup/**'];
      expect((await ss('grep', args)).endsWith('\n# siblings: 5: y · 9: z\n')).toBe(true);
      expect((await ss('grep', [...args, '-C', '1'])).endsWith('\n# siblings: 9: z\n')).toBe(true);
    } finally { searcher.bareGrep = orig; }
  });

  it('the hint prints once, and only when something is hidden', async () => {
    const cut = await ss('grep', ['func .*Export', '-k', '8']);
    expect(cut.match(/# hidden hits: raise -k or use --in <file>/g)).toHaveLength(1);
    const all = await ss('grep', ['func .*Export', '-k', '100', '-g', 'backup/**']);
    expect(all).toBe('backup/run.go\n3:func Export3(ctx context.Context) error {\n6:func Export6(ctx context.Context) error {\n');
  });

  it('a later call of a chained command starts with the boundary line; the first call prints none', async () => {
    const later = await ss('grep', ['func .*Export', '-k', '100', '-g', 'backup/**'], { SWEET_SEARCH_CHAIN_LATER: '1' });
    expect(later).toBe('# ss-grep func .*Exp…\nbackup/run.go\n3:func Export3(ctx context.Context) error {\n'
      + '6:func Export6(ctx context.Context) error {\n');
    const first = await ss('grep', ['func .*Export', '-k', '100', '-g', 'backup/**'], { SWEET_SEARCH_CHAIN_LATER: '0' });
    expect(first.startsWith('backup/run.go\n')).toBe(true);
  });
});

// A broad grep (>= GREP_BROAD_MIN_HITS total matches) prints each hit line in a window of at most
// GREP_BROAD_HIT_CHARS chars; below the threshold the 140-char window applies.
describe('broad greps print a narrower hit window', () => {
  const longLine = (i) => `return handleExportRequest(ctx, request, response, ${i}) // a trailing comment that runs on past sixty chars`;
  /** A searcher whose one file wide/a.go holds `n` hits of a long line. */
  function wideSearcher(n) {
    const matches = [];
    for (let i = 1; i <= n; i++) matches.push({ file: 'wide/a.go', line: i, matchText: 'handleExportRequest', column: 8, content: longLine(i) });
    const result = { matches, candidateFiles: 1, totalFiles: 1, scannedFiles: 1 };
    return {
      ...searcher,
      sparseGramIndex: { searchFull: vi.fn(() => result), searchLines: vi.fn(() => result) },
    };
  }
  // Hit rows of the grouped listing: `LINE:text`.
  const hitTexts = (out) => out.split('\n').filter(l => /^\d+:/.test(l)).map(l => l.replace(/^\d+:/, ''));
  const wideOut = async (n, args, daemon) => {
    const s = wideSearcher(n);
    if (!daemon) {
      const r = await runInVirtualProcess({ env: callEnv(), cwd: root },
        () => runAgentTool('grep', args, { getSearcher: () => s }));
      return r.stdout.toString('utf8');
    }
    const r = await buildAgentToolDaemonResponse(
      { v: 1, tool: 'grep', args, cwd: root, env: callEnv(), pid: 4242 },
      { isUnixSocket: true, searcher: s, isReady: () => true },
    );
    expect(r.status).toBe(200);
    return JSON.parse(r.body).stdout;
  };

  it('the constants: 50 hits, 60 chars', () => {
    expect([GREP_BROAD_MIN_HITS, GREP_BROAD_HIT_CHARS]).toEqual([50, 60]);
    expect(grepBroadHitMax(GREP_BROAD_MIN_HITS - 1)).toBeUndefined();
    expect(grepBroadHitMax(GREP_BROAD_MIN_HITS)).toBe(GREP_BROAD_HIT_CHARS);
    expect(grepBroadHitMax(1000)).toBe(GREP_BROAD_HIT_CHARS);
  });

  for (const daemon of [false, true]) {
    const via = daemon ? 'daemon' : 'in-process';
    for (const [shape, args] of [['body', ['handleExportRequest', '-k', '3']], ['--in', ['handleExportRequest', '--in', 'wide/a.go', '-k', '3']]]) {
      it(`${shape}, >= 50 total matches: a 60-char window (${via})`, async () => {
        const texts = hitTexts(await wideOut(GREP_BROAD_MIN_HITS, args, daemon));
        expect(texts.length).toBeGreaterThan(0);
        for (const t of texts) {
          expect(t.length).toBe(GREP_BROAD_HIT_CHARS);
          expect(t.endsWith('…')).toBe(true);
          expect(t).toContain('handleExportRequest');
        }
      });

      it(`${shape}, < 50 total matches: the whole line, up to 140 chars (${via})`, async () => {
        const texts = hitTexts(await wideOut(GREP_BROAD_MIN_HITS - 1, args, daemon));
        expect(texts.length).toBeGreaterThan(0);
        for (const t of texts) expect(t).toBe(longLine(Number(/, (\d+)\)/.exec(t)[1])));
      });
    }
  }
});
