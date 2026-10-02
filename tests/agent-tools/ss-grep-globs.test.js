/**
 * ss-grep / ss-find -g globs, end to end through the real tool code (runAgentTool in a
 * virtual process, as the daemon and the in-process fallback run it) on a real engine
 * (bareGrep over a mock native sparse-gram index). ripgrep is mocked to throw: every call
 * here must stay on the native path.
 *
 * The daemon socket is pointed at a path that does not exist, so queryWarmSearch fails over
 * to host.getSearcher() — the same SweetSearch method the daemon would run.
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
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';

const MATCHES = [
  ...[1, 2, 3, 4, 5].map(line => ({ file: 'lib/tests/a_test.go', line, matchText: 'Head', content: `Head ${line}` })),
  { file: 'lib/src/Head.h', line: 1, matchText: 'Head', content: 'struct Head;' },
  { file: 'lib/src/HttpClient.java', line: 1, matchText: 'Head', content: 'Head client;' },
  { file: 'src/main.c', line: 1, matchText: 'Head', content: 'Head main;' },
];

let base;
let root;
let searcher;
let grepCalls;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-grep-globs-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, '.sweet-search', 'codebase.db'), '');
  const byFile = new Map();
  for (const m of MATCHES) byFile.set(m.file, [...(byFile.get(m.file) || []), m.content]);
  for (const [file, lines] of byFile) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${lines.join('\n')}\n`);
  }
  grepCalls = [];
  const index = {
    searchFull: vi.fn(() => ({ matches: MATCHES, candidateFiles: 4, totalFiles: 4, scannedFiles: 4 })),
    searchLines: vi.fn(() => ({ matches: MATCHES, candidateFiles: 4, totalFiles: 4, scannedFiles: 4 })),
  };
  searcher = {
    projectRoot: root,
    sparseGramIndexPath: path.join(base, 'absent-sparse.idx'),
    sparseGramIndex: index,
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

async function ss(tool, args, { cwd = root } = {}) {
  grepCalls.length = 0;
  const env = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_SOCKET_PATH: path.join(base, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: path.join(base, 'runtime'),
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0',
    SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
  };
  const r = await runInVirtualProcess({ env, cwd }, () => runAgentTool(tool, args, { getSearcher: () => searcher }));
  return { code: r.code, out: r.stdout.toString('utf8'), err: r.stderr.toString('utf8') };
}

describe('ss-grep -g (native path, counts after the filter)', () => {
  it('a `!` glob is consumed as the glob, never the pattern; excluded files vanish from body and counts', async () => {
    const { code, out } = await ss('grep', ['Head', '-g', '!lib/tests/**']);
    expect(code).toBe(0);
    expect(out).toBe("# ss-grep: 3 total match(es) for /Head/ across 3 files (-g '!lib/tests/**')\n"
      + 'lib/src/Head.h:1: struct Head;\nlib/src/HttpClient.java:1: Head client;\nsrc/main.c:1: Head main;\n');
    // the engine got the glob, served it natively (ripgrep is mocked to throw)
    expect(grepCalls[0].pathGlobs).toEqual(['!lib/tests/**']);
    expect(searcher.sparseGramIndex.searchFull).toHaveBeenCalled();
  });

  it('--exclude-dir, --exclude, --include and the = form map onto rg globs', async () => {
    let { out } = await ss('grep', ['Head', '--exclude-dir', 'tests']);
    expect(out).toMatch(/^# ss-grep: 3 total match\(es\) for \/Head\/ across 3 files \(-g '!tests\/'\)/);
    ({ out } = await ss('grep', ['Head', '--exclude=*.java', '--exclude-dir=tests']));
    expect(out).toMatch(/^# ss-grep: 2 total match\(es\)/);
    expect(out).not.toContain('HttpClient');
    ({ out } = await ss('grep', ['Head', '--include', '*.h']));
    expect(out).toMatch(/^# ss-grep: 1 total match\(es\) for \/Head\/ \(-g '\*\.h'\)/);
    expect(out).toContain('lib/src/Head.h');
  });

  it('include + exclude, and -g ANDed with --in', async () => {
    let { out } = await ss('grep', ['Head', '-g', 'lib/**', '-g', '!*.java']);
    expect(out).toMatch(/^# ss-grep: 6 total match\(es\)/);
    expect(out).not.toContain('src/main.c');
    ({ out } = await ss('grep', ['Head', '--in', 'lib', '-g', '!lib/tests/**']));
    expect(out).toMatch(/^# ss-grep: 2 total match\(es\) for \/Head\/ \(scope: --in lib -g '!lib\/tests\/\*\*'\)\n/);
    expect(out.trim().split('\n')).toHaveLength(3);
  });

  it('-k: an excluded file never takes a k slot; the total counts only what the globs allow', async () => {
    const { out } = await ss('grep', ['Head', '-k', '2', '-g', '!*_test.go']);
    expect(out).toMatch(/^# ss-grep: 3 total match\(es\) for \/Head\/ across 3 files/);
    expect(out).not.toContain('a_test.go');
    const { out: scoped } = await ss('grep', ['Head', '-k', '1', '--in', 'lib', '-g', '!tests']);
    expect(scoped).toMatch(/^# ss-grep: 2 total match\(es\)/);
    expect(scoped).toContain('lib/src/Head.h:1');
    expect(scoped).toContain('(+1 more — raise -k)');
  });

  it('globs that remove every match say so (no bare "(no matches)", no case-insensitive retry)', async () => {
    let { out } = await ss('grep', ['Head', '-g', '*.py']);
    expect(out).toContain("(no matches outside the globs: -g '*.py' removed all 8 match(es) in 4 file(s); drop or widen a glob to see them)");
    expect(out).not.toMatch(/^\(no matches\)$/m);
    expect(out).not.toContain('case-insensitive');
    expect(grepCalls).toHaveLength(1);
    ({ out } = await ss('grep', ['Head', '--in', 'lib/tests', '--exclude-dir', 'tests']));
    expect(out).toContain("(no matches outside the globs: -g '!tests/' removed all 5 match(es) in 1 file(s);");
  });

  it('a zero the globs explain carries no regex-dialect note (the escaped paren was fine)', async () => {
    const { out } = await ss('grep', ['Head\\(', '--in', 'lib/tests', '--exclude-dir', 'tests']);
    expect(out).toContain("(no matches outside the globs: -g '!tests/' removed all 5 match(es) in 1 file(s);");
    expect(out).not.toContain('regex note');
  });

  it('an unexplained zero still carries the regex-dialect note', async () => {
    searcher.sparseGramIndex.searchFull.mockImplementation(() => ({ matches: [], candidateFiles: 0, totalFiles: 4, scannedFiles: 0 }));
    try {
      // a real GNU BRE operator (an unpaired `\\(` is a literal paren and gets no note)
      const { out } = await ss('grep', ['Head\\|Nope', '--in', 'lib/tests']);
      expect(out).toMatch(/^\(no matches\)$/m);
      expect(out).toContain('regex note');
    } finally {
      searcher.sparseGramIndex.searchFull.mockImplementation(() => ({ matches: MATCHES, candidateFiles: 4, totalFiles: 4, scannedFiles: 4 }));
    }
  });

  it('a zero with nothing excluded is still the plain answer', async () => {
    searcher.sparseGramIndex.searchFull.mockImplementationOnce(() => ({ matches: [], candidateFiles: 0, totalFiles: 4, scannedFiles: 0 }));
    searcher.sparseGramIndex.searchFull.mockImplementationOnce(() => ({ matches: [], candidateFiles: 0, totalFiles: 4, scannedFiles: 0 }));
    const { out } = await ss('grep', ['Nope', '-g', '!tests']);
    expect(out).toMatch(/^\(no matches\)$/m);
  });

  it('from a subdirectory an anchored glob is anchored at the cwd, as rg does', async () => {
    const { out } = await ss('grep', ['Head', '-g', '!tests/**'], { cwd: path.join(root, 'lib') });
    expect(out).toMatch(/^# ss-grep: 2 total match\(es\) for \/Head\/ across 2 files \(-g '!\/lib\/tests\/\*\*'\)\n/);
    expect(out).not.toContain('a_test.go');
    expect(out).not.toContain('src/main.c');   // the implicit cwd scope still applies
    expect(grepCalls[0].pathGlobs).toEqual(['!/lib/tests/**']);
  });
});

describe('ss-find -g', () => {
  it('passes the globs to its ss-grep fallback once, resolved once', async () => {
    const { code, out, err } = await ss('find', ['head type', '--regex', 'Head', '-g', '!tests/**'], { cwd: path.join(root, 'lib') });
    expect(code).toBe(0);
    expect(err).toContain('no late-interaction index');
    expect(grepCalls[grepCalls.length - 1].pathGlobs).toEqual(['!/lib/tests/**']);
    expect(out).not.toContain('a_test.go');
    expect(out).toContain('src/main.c');          // ss-find has no implicit cwd scope
  });

  it('accepts the grep aliases too', async () => {
    const { out } = await ss('find', ['head type', '--regex', 'Head', '--exclude-dir=tests', '--include=*.h']);
    expect(out).toMatch(/^# ss-grep: 1 total match\(es\)/);
    expect(out).toContain('lib/src/Head.h');
  });
});

// Rules v2 (scripts/harness-prompts/rules-v2.js RULES_V2_GREP_FLAGS_LINE) tells the agent these
// flags exist: every one of them must be accepted, together, in one call.
describe('ss-grep: the flags the rules line lists', () => {
  for (const ctx of [['-A', '1'], ['-B', '1'], ['-C', '1']]) {
    it(`-i -w --in -g '<glob>' -g '!<glob>' ${ctx.join(' ')} in one call`, async () => {
      const { code, out, err } = await ss('grep', ['head', '-i', '-w', '--in', 'lib', '-g', '*.h', '-g', '!lib/tests/**', ...ctx]);
      expect(err).not.toMatch(/Usage:/);
      expect(code).toBe(0);
      expect(grepCalls[0].pathGlobs).toEqual(['*.h', '!lib/tests/**']);
      expect(out).toContain('/(?i)\\b(?:head)\\b/');   // -i and -w reached the regex
      expect(out).toContain('lib/src/Head.h:1');
      expect(out).not.toContain('a_test.go');
    });
  }
});
