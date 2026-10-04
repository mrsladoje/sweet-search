/**
 * ss-semantic on a file a little over the budget: the budget grows to the file's size, so a
 * ranked span is never cut there (spanBudget in search-read-semantic.js). The cut it replaces
 * left out the lines the question asked about and cost a second read of the same file
 * (ocelot RequestMapper.cs, 3,562 characters against a 2,400 budget: MapHeaders cut, then
 * read with ss-read). An explicit --max-tokens stays a hard cap.
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
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'rsem-whole-')));
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
  // alpha's chunk runs one line into beta's: the chunks overlap, so they merge into one span
  // over the budget (chunks that only touch merge only while they fit).
  mockState.rows = [chunk('alpha', 'alpha', 1, 11), chunk('beta', 'beta', 11, 20), chunk('min', 'x', 1, 1, 'src/min.js')];
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
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

const { spanBudget } = await import('../../core/search/search-read-semantic.js');
const SIZE = LINES.join('\n').length + 1;

describe('spanBudget', () => {
  it('grows to the file only when the file is over the budget and within the whole-file limit', () => {
    const text = 'x'.repeat(300);
    expect(spanBudget(text, 200, 400)).toBe(300);
    expect(spanBudget(text, 200, 300)).toBe(300);
    expect(spanBudget(text, 200, 299)).toBe(200);
    expect(spanBudget(text, 400, 800)).toBe(400); // under the budget: unchanged
    expect(spanBudget(text, 200, undefined)).toBe(200);
    expect(spanBudget(null, 200, 400)).toBe(200);
  });
});

describe('readSemantic wholeFileMaxChars', () => {
  const read = (extra = {}) => readSemantic({ path: FILE, query: 'beta value', projectRoot: root, maxChars: 200, exactRanges: true, ...extra });

  it('a file within the limit prints its ranked spans uncut', async () => {
    const r = await read({ wholeFileMaxChars: 400 + SIZE });
    expect(r.spans).toHaveLength(1);
    expect(r.spans[0]).toMatchObject({ startLine: 1, endLine: 20 });
    expect(r.spans[0].truncated).toBeUndefined();
    expect(r.charsReturned).toBeGreaterThan(200);
    expect(r.charsReturned).toBeLessThanOrEqual(SIZE);
  });

  it('a file over the limit is cut at the budget as before', async () => {
    const before = await read();
    const r = await read({ wholeFileMaxChars: SIZE - 1 });
    expect(r.spans).toEqual(before.spans);
    expect(r.spans[0].truncated).toBe(true);
    expect(r.charsReturned).toBeLessThanOrEqual(200);
  });

  it('the limit never prints more than the ranked spans: an unranked chunk stays out', async () => {
    // Only beta ranks; alpha is not a chunk at all, so its lines are not printed.
    mockState.rows = mockState.rows.filter(c => c.id !== 'alpha');
    const r = await read({ wholeFileMaxChars: 10 * SIZE });
    expect(r.spans.map(s => [s.startLine, s.endLine])).toEqual([[9, 20]]);
  });
});

describe('the ss-semantic printer', () => {
  // Default budget 51 tokens = 204 characters; the file is SIZE (403) characters.
  const ARGS = [FILE, 'beta value'];
  it('the default budget grows to a file of up to twice its size', async () => {
    expect(SIZE).toBeGreaterThan(204);
    expect(SIZE).toBeLessThanOrEqual(408);
    const out = await ssSemantic(ARGS, { SS_SMOKE_SEMANTIC_MAXTOKENS: '51' });
    const [block] = printed(out);
    expect([block.start, block.end]).toEqual([1, 20]);
    expect(block.code).toEqual(LINES);
    expect(out).not.toContain('# also:');
    expect(out).not.toContain('# not shown');
  });

  it('a file over twice the default budget is still cut', async () => {
    const out = await ssSemantic(ARGS, { SS_SMOKE_SEMANTIC_MAXTOKENS: String(Math.floor(SIZE / 8) - 1) });
    const [block] = printed(out);
    expect(block.end).toBeLessThan(20);
    expect(out).toContain('# also:');
  });

  it('an explicit --max-tokens is a hard cap', async () => {
    const out = await ssSemantic([...ARGS, '--max-tokens', '50']);
    const [block] = printed(out);
    expect([block.start, block.end]).toEqual([1, 9]);
    expect(await ssSemantic([...ARGS, '--max-tokens=50'])).toBe(out);
  });
});
