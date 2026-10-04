/**
 * SS_FIX_SEMANTIC_RANGES / SS_FIX_SEMANTIC_PICK through readSemantic and the real ss-semantic
 * printer (runAgentTool in a virtual process, in-process fallback). Chunks come from a mocked
 * CodebaseRepository, as in search-read-semantic-indexed.test.js; text always comes from disk.
 *
 * The defect: when the merged span exceeds the budget, the shipped printer shows its first
 * maxChars characters but still names the whole merged range in the `### file:start-end` header.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mockState = vi.hoisted(() => ({ rows: [] }));

vi.mock('../../core/infrastructure/codebase-repository.js', () => ({
  CodebaseRepository: class {
    refreshManifestEpoch() { return 1; }
    getChunksByFilePath(filePath) { return mockState.rows.filter(r => r.file_path === filePath); }
    close() {}
  },
}));

vi.mock('../../core/infrastructure/config/index.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    DB_PATHS: { ...(actual.DB_PATHS || {}), codebase: ':memory:' },
    LATE_INTERACTION_CONFIG: { ...(actual.LATE_INTERACTION_CONFIG || {}), enabled: false },
  };
});

const { readSemantic, __resetReadSemanticCachesForTests } = await import('../../core/search/search-read-semantic.js');
const { __resetReadCachesForTests } = await import('../../core/search/search-read.js');
const { runInVirtualProcess } = await import('../../core/agent-tools/virtual-process.js');
const { runAgentTool } = await import('../../eval/agent-read-workflows/bin/_ss-helpers.mjs');

const FILE = 'src/big.js';
// alpha (1-10) mentions beta once; beta (11-20) is the query's symbol. 24 characters per line.
const LINES = [
  'function alpha(input) {',
  ...Array.from({ length: 8 }, (_, i) => `  const a${i} = beta(${i});`),
  '}',
  'function beta(value) {',
  ...Array.from({ length: 8 }, (_, i) => `  const b${i} = value*${i};`),
  '}',
];

let base;
let root;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'rsem-ranges-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, '.sweet-search', 'codebase.db'), '');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, FILE), `${LINES.join('\n')}\n`);
  writeFileSync(path.join(root, 'src/min.js'), `${'var x=1;'.repeat(100)}\nvar y=2;\n`);
});

beforeEach(() => {
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
  const chunk = (id, symbol, s, e, file = FILE) => ({
    id, file_path: file, text: 'DB TEXT',
    metadata: JSON.stringify({ language: 'javascript', symbol, chunk_type: 'function', line_start: s, line_end: e }),
  });
  mockState.rows = [chunk('alpha', 'alpha', 1, 10), chunk('beta', 'beta', 11, 20), chunk('min', 'x', 1, 1, 'src/min.js')];
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const read = (extra = {}) => readSemantic({ path: FILE, query: 'beta value', projectRoot: root, maxChars: 200, ...extra });

describe('readSemantic exactRanges / pickExcerpt', () => {
  it('shipped (no option): the merged range is claimed although only its head was kept', async () => {
    const r = await read();
    expect(r.spans).toHaveLength(1);
    // 21: the reader counts the empty string after the final newline as a line
    expect([r.spans[0].startLine, r.spans[0].endLine, r.spans[0].truncated]).toEqual([1, 21, true]);
    expect(r.spans[0].text.length).toBe(200);
  });

  it('exactRanges: whole lines only, and the range is exactly what the text holds', async () => {
    const r = await read({ exactRanges: true });
    const span = r.spans[0];
    expect(span).toMatchObject({ startLine: 1, fullStartLine: 1, fullEndLine: 20, truncated: true, exactRange: true });
    expect(span.text.endsWith('\n')).toBe(true);
    expect(span.text.split('\n').length - 1).toBe(span.endLine - span.startLine + 1);
    expect(span.text.length).toBeLessThanOrEqual(200);
    expect(r.charsReturned).toBe(span.text.length);
    // the chosen chunks do not change, only the cut
    expect(span.chunkIds).toEqual((await read()).spans[0].chunkIds);
  });

  it('pickExcerpt: the excerpt starts at the best chunk (beta, padded by 2 context lines)', async () => {
    const r = await read({ pickExcerpt: true, verbose: true });
    const best = r.signals.preMergeRanked[0];
    expect(best.symbol).toBe('beta');
    expect(r.spans[0]).toMatchObject({ startLine: best.startLine - 2, fullStartLine: 1, fullEndLine: 20, exactRange: true });
  });

  it('a minified line longer than the budget is a partial line', async () => {
    const r = await readSemantic({ path: 'src/min.js', query: 'x', projectRoot: root, maxChars: 120, exactRanges: true });
    expect(r.spans[0]).toMatchObject({ startLine: 1, endLine: 1, partialLine: { line: 1, shownChars: 120, totalChars: 800 } });
  });
});

async function ssSemantic(args, extra = {}) {
  const env = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_SOCKET_PATH: path.join(base, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: path.join(base, 'runtime'),
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0',
    SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
    ...extra,
  };
  const r = await runInVirtualProcess({ env, cwd: root }, () => runAgentTool('semantic', args, { getSearcher: () => ({}) }));
  return r.stdout.toString('utf8');
}

/** [start, end] of each `## start-end names` heading and the code lines printed under it. */
function printed(out) {
  const blocks = [];
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^## (\d+)-(\d+)/);
    if (!h) continue;
    let j = i + 2;
    const code = [];
    while (j < lines.length && lines[j] !== '```') code.push(lines[j++]);
    blocks.push({ start: +h[1], end: +h[2], code });
  }
  return blocks;
}

describe('the ss-semantic printer', () => {
  const ARGS = [FILE, 'beta value', '--max-tokens', '50'];
  it('SS_FIX_SEMANTIC_RANGES=0 (legacy): the heading still over-claims (that is the defect)', async () => {
    const out = await ssSemantic(ARGS, { SS_FIX_SEMANTIC_RANGES: '0' });
    const [block] = printed(out);
    expect([block.start, block.end]).toEqual([1, 21]);
    expect(block.code.length).toBeLessThan(20);
    expect(out).not.toContain('# not shown');
  });

  it('default ON since 2026-10-03: an empty environment equals SS_FIX_SEMANTIC_RANGES=1', async () => {
    expect(await ssSemantic(ARGS)).toBe(await ssSemantic(ARGS, { SS_FIX_SEMANTIC_RANGES: '1' }));
    expect(await ssSemantic(ARGS, { SS_FIX_A: '0' })).toBe(await ssSemantic(ARGS, { SS_FIX_A: '0', SS_FIX_SEMANTIC_RANGES: '0' }));
  });

  it('SS_FIX_SEMANTIC_RANGES: the heading range equals the printed range; the rest is named', async () => {
    const out = await ssSemantic(ARGS, { SS_FIX_SEMANTIC_RANGES: '1' });
    const [block] = printed(out);
    expect(block.code).toHaveLength(block.end - block.start + 1);
    expect([block.start, block.end]).toEqual([1, 9]);
    // No echo header, no language tag, no blank line before the closing fence, no ledger trailer.
    expect(out).toBe([
      '## 1-9',
      '```',
      ...LINES.slice(0, 9),
      '```',
      // The rest of the cut span: alpha's last line and beta, in score order.
      '# also: 11-20 function beta · 10-10 function alpha',
      '',
    ].join('\n'));
  });

  it('a later call of a chained command opens with the boundary line (the file name)', async () => {
    const out = await ssSemantic(ARGS, { SWEET_SEARCH_CHAIN_LATER: '1' });
    expect(out.startsWith('# ss-semantic big.js\n## 1-9\n```\n')).toBe(true);
    expect((await ssSemantic(ARGS, { SWEET_SEARCH_CHAIN_LATER: '0' })).startsWith('## 1-9\n')).toBe(true);
  });

  it('SS_FIX_SEMANTIC_PICK: omitted content is named before and after the excerpt', async () => {
    const out = await ssSemantic(ARGS, { SS_FIX_SEMANTIC_PICK: '1' });
    const [block] = printed(out);
    expect(block.code).toHaveLength(block.end - block.start + 1);
    expect(block.start).toBeGreaterThan(1);
    expect(out).toContain(`# not shown above: 1-${block.start - 1}\n## ${block.start}-`);
    expect(out).toContain(`# also: ${block.end + 1}-20 function beta · 1-${block.start - 1} function alpha\n`);
  });

  it('SS_FIX_SEMANTIC_RANGES on a minified file: a partial line, reported as such', async () => {
    const out = await ssSemantic(['src/min.js', 'x', '--max-tokens', '30'], { SS_FIX_SEMANTIC_RANGES: '1' });
    const [block] = printed(out);
    expect([block.start, block.end]).toEqual([1, 1]);
    // No place names line 2, so the cut says so itself.
    expect(out).toContain('(line 1 truncated: 120 of 800 characters)\n# not shown: 2-2\n');
  });
});
