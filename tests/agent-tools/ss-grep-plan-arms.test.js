/**
 * ss-grep plan arms, end to end through the real tool code (runAgentTool in a virtual process,
 * the in-process fallback and the warm-daemon /agent-tool path), on a real engine (bareGrep over
 * a mock native sparse-gram index) with a REAL code graph (CodeGraphRepository over SQLite) and
 * a real reconcile manifest:
 *
 *   SS_FIX_GREP_LINES=1               declarations first, lines outside every symbol last
 *                                     (this and the two below are DEFAULT ON since 2026-10-03)
 *   SS_FIX_GREP_ALLOC_RULE=guarantee|hh  one line per kept file first
 *   SS_FIX_GREP_WEIGHT=sat2           hits / (hits + 2) x prior
 *
 * All three are default off: without them the output is the shipped output.
 */
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';
import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';
import { buildAgentToolDaemonResponse } from '../../core/agent-tools/daemon-route.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';

const FILES = {
  // indexed Go: comment and import first, then two declarations and their bodies
  'worker/export.go': [
    '// Package worker: export helpers',
    'package worker',
    'import "github.com/x/export"',
    '',
    'func Export(ctx context.Context) error {',
    '\treturn exportAll(ctx)',
    '}',
    '',
    'func exportAll(ctx context.Context) error {',
    '\t// export every predicate',
    '\treturn nil',
    '}',
  ],
  // no entity extraction for shell: partial indexing inside one call
  'scripts/export.sh': ['#!/bin/sh', 'export A=1', 'export B=2', 'export C=3'],
  // one hit: never looked up
  'other.go': ['package other', 'func other() { export() }'],
};
const ENTITIES = [
  ['e1', 'Export', 'function', 'worker/export.go', 5, 7],
  ['e2', 'exportAll', 'function', 'worker/export.go', 9, 12],
  ['e3', 'other', 'function', 'other.go', 2, 2],
];
const REGEX = '[Ee]xport';
const OLD = new Date('2026-01-01T00:00:00Z');
const PUBLISHED = '2026-06-01T00:00:00.000Z';
const NEWER = new Date('2026-07-01T00:00:00Z');

let base;
let root;
let dbPath;
let db;
let searcher;
let grepCalls;

function setEntities(rows) {
  db.prepare('DELETE FROM entities').run();
  const insert = db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, NULL)');
  for (const [id, name, type, file, s, e, stale = null] of rows) insert.run(id, name, type, file, s, e, stale);
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-grep-plan-arms-')));
  root = path.join(base, 'repo');
  const state = path.join(root, '.sweet-search');
  mkdirSync(state, { recursive: true });
  writeFileSync(path.join(state, 'codebase.db'), '');
  writeFileSync(path.join(state, 'reconcile-manifest.json'), JSON.stringify({ epoch: 3, publishedAt: PUBLISHED }));
  const matches = [];
  const re = new RegExp(REGEX);
  for (const [file, lines] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${lines.join('\n')}\n`);
    utimesSync(path.join(root, file), OLD, OLD);
    lines.forEach((text, i) => {
      const hit = text.match(re);
      if (hit) matches.push({ file, line: i + 1, matchText: hit[0], content: text });
    });
  }
  dbPath = path.join(state, 'code-graph.db');
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, file_path TEXT,
      start_line INTEGER, end_line INTEGER, parent_class TEXT, stale_since INTEGER,
      epoch_written INTEGER, epoch_retired INTEGER
    );
    CREATE INDEX idx_entities_file ON entities(file_path);
  `);
  const result = { matches, candidateFiles: 3, totalFiles: 3, scannedFiles: 3 };
  grepCalls = [];
  const graph = new CodeGraphRepository(dbPath);
  searcher = {
    projectRoot: root,
    sparseGramIndexPath: path.join(base, 'absent-sparse.idx'),
    sparseGramIndex: { searchFull: vi.fn(() => result), searchLines: vi.fn(() => result) },
    hasLateInteractionIndex: false,
    codeGraphRepo: graph,
    _readReconcileManifest: () => JSON.parse(readFileSync(path.join(state, 'reconcile-manifest.json'), 'utf8')),
    async bareGrep(query, routing, options) {
      grepCalls.push(options);
      return bareGrep.call(this, query, routing, options);
    },
  };
});

beforeEach(() => {
  setEntities(ENTITIES);
  utimesSync(path.join(root, 'worker/export.go'), OLD, OLD);
});

afterAll(() => {
  searcher?.codeGraphRepo?.close?.();
  db?.close();
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
    // These tests check which lines a file shows, not how a line prints: keep the matched-text form.
    SS_FIX_GREP_FULLLINE: '0',
    ...extra,
  };
}

async function ss(args, extra = {}) {
  grepCalls.length = 0;
  const r = await runInVirtualProcess({ env: callEnv(extra), cwd: root },
    () => runAgentTool('grep', args, { getSearcher: () => searcher }));
  return r.stdout.toString('utf8');
}

async function ssDaemon(args, extra = {}) {
  const r = await buildAgentToolDaemonResponse(
    { v: 1, tool: 'grep', args, cwd: root, env: callEnv(extra), pid: 4242 },
    { isUnixSocket: true, searcher, isReady: () => true },
  );
  expect(r.status).toBe(200);
  return JSON.parse(r.body).stdout;
}

const LINES = { SS_FIX_GREP_LINES: '1' };
/** worker/export.go's block of the listing: its path line, then its rows. */
const goLines = (out) => {
  const lines = out.split('\n');
  const at = lines.findIndex(l => l.startsWith('worker/export.go'));
  const block = [lines[at]];
  for (let i = at + 1; i < lines.length && /^(\d|--)/.test(lines[i]); i++) block.push(lines[i]);
  return block;
};
const HINT = '# hidden hits: raise -k or use --in <file>\n';
// k = 4: worker/export.go (6 hits, w 2.45) gets 2 lines, scripts/export.sh (3, w 1.73) 1, other.go 1
const SHIPPED_K4 = ''
  + 'worker/export.go (+4 more)\n1:export\n3:export\n'
  + 'scripts/export.sh (+2 more)\n2:export\n'
  + 'other.go\n2:export\n'
  + HINT;

describe('SS_FIX_GREP_LINES through the real tool', () => {
  it('0 (the legacy value): the 2026-10-02 prefix; the engine is not asked for classes', async () => {
    expect(await ss([REGEX, '-k', '4'], { SS_FIX_GREP_LINES: '0' })).toBe(SHIPPED_K4);
    expect(grepCalls[0].grepLineClasses).toBeUndefined();
  });

  it('default ON since 2026-10-03: an empty environment equals SS_FIX_GREP_LINES=1', async () => {
    const on = await ss([REGEX, '-k', '4'], LINES);
    expect(await ss([REGEX, '-k', '4'])).toBe(on);
    expect(grepCalls[0]).toMatchObject({ grepLineClasses: true, grepFileWeight: 'sat2' });
  });

  it('a file with more entities than findEntitiesInFile\'s default 512 still gets classes', async () => {
    // 600 one-line entities on the blank line 4 sort before Export (5) and exportAll (9)
    const filler = Array.from({ length: 600 }, (_, i) => [`f${i}`, `zz${i}`, 'variable', 'worker/export.go', 4, 4]);
    setEntities([...filler, ...ENTITIES]);
    try {
      expect(goLines(await ss([REGEX, '-k', '4'], LINES))).toEqual(['worker/export.go (+4 more)', '5:Export', '6:export']);
    } finally { setEntities(ENTITIES); }
  });

  it('a file that fills the entity cap (2048) keeps the prefix: its list may be cut', async () => {
    const filler = Array.from({ length: 2100 }, (_, i) => [`f${i}`, `zz${i}`, 'variable', 'worker/export.go', 4, 4]);
    setEntities([...filler, ...ENTITIES]);
    try {
      expect(await ss([REGEX, '-k', '4'], LINES)).toBe(SHIPPED_K4);
    } finally { setEntities(ENTITIES); }
  });

  it('on: the declaration and a line inside it replace the comment and the import', async () => {
    // k = 4: the engine stores the file's first min(k, 100) = 4 hits (lines 1, 3, 5, 6)
    const out = await ss([REGEX, '-k', '4'], LINES);
    expect(out).toBe(''
      + 'worker/export.go (+4 more)\n5:Export\n6:export\n'
      // no entities (shell): the prefix, in the same call
      + 'scripts/export.sh (+2 more)\n2:export\n'
      + 'other.go\n2:export\n'
      + HINT);
    expect(grepCalls[0]).toMatchObject({ grepLineClasses: true, grepFileOrder: 'weight', _isAgentFormat: true });
  });

  it('more lines: usage inside a symbol before lines outside every symbol', async () => {
    // k = 6: export.go gets 3 of its 6 stored hits (sh 2, other 1); the usage at 6 beats the
    // comment at 1 and the import at 3
    expect(goLines(await ss([REGEX, '-k', '6'], LINES))).toEqual(['worker/export.go (+3 more)', '5:Export', '6:export', '9:export']);
  });

  it('-C context renders the same chosen hits', async () => {
    const out = await ss([REGEX, '-k', '4', '-C', '1'], LINES);
    expect(goLines(out)).toEqual(['worker/export.go (+4 more)', '4-', '5:func Export(ctx context.Context) error {',
      '6:\treturn exportAll(ctx)', '7-}']);
  });

  it('a source newer than the published index (detected staleness) keeps the prefix', async () => {
    utimesSync(path.join(root, 'worker/export.go'), NEWER, NEWER);
    expect(await ss([REGEX, '-k', '4'], LINES)).toBe(SHIPPED_K4);
  });

  it('entities hidden by the graph visibility rule (stale_since set) keep the prefix', async () => {
    setEntities(ENTITIES.map(e => [...e, 99]));
    expect(await ss([REGEX, '-k', '4'], LINES)).toBe(SHIPPED_K4);
  });

  it('UNDETECTED staleness (documented): a moved declaration\'s old span promotes the wrong lines', async () => {
    // The index still has Export at lines 1-3 (from before an edit that kept the old mtime).
    // Lines 1 and 3 are then "inside a symbol" and beat 5 and 6; the name-on-line check keeps
    // them out of the declaration class, but the real declaration at 5 is no longer shown
    // (with a correct index this call shows 5, 6, 9; the shipped prefix shows 1, 3, 5).
    setEntities([['e1', 'Export', 'function', 'worker/export.go', 1, 3], ENTITIES[1], ENTITIES[2]]);
    expect(goLines(await ss([REGEX, '-k', '6'], LINES))).toEqual(['worker/export.go (+3 more)', '1:export', '3:export', '9:export']);
  });

  it('--in drill-in keeps every hit in line order and asks the engine for nothing', async () => {
    const out = await ss([REGEX, '-k', '3', '--in', 'worker/export.go'], LINES);
    expect(out).toBe('worker/export.go\n1:export\n3:export\n5:Export\n# +3 more hits (raise -k)\n');
    expect(grepCalls[0].grepLineClasses).toBeUndefined();
  });
});

describe('the arms need SS_FIX_GREP_ALLOC', () => {
  it('they are ignored with SS_FIX_GREP_ALLOC=0 (the legacy output)', async () => {
    const legacy = await ss([REGEX, '-k', '4'], { SS_FIX_GREP_ALLOC: '0' });
    expect(await ss([REGEX, '-k', '4'], { SS_FIX_GREP_ALLOC: '0', ...LINES, SS_FIX_GREP_ALLOC_RULE: 'guarantee', SS_FIX_GREP_WEIGHT: 'sat2' }))
      .toBe(legacy);
    expect(grepCalls[0].grepFileOrder).toBeUndefined();
  });
});

describe('the warm daemon (/agent-tool) prints exactly what the in-process tool prints', () => {
  const CALLS = [[REGEX, '-k', '4'], [REGEX, '-k', '6'], [REGEX, '-k', '3', '-A', '1'], [REGEX, '-k', '2', '--in', 'worker']];
  for (const env of [LINES, { SS_FIX_GREP_ALLOC_RULE: 'guarantee' }, { SS_FIX_GREP_ALLOC_RULE: 'hh', SS_FIX_GREP_WEIGHT: 'sat2', ...LINES }]) {
    it(`same bytes on both paths (${JSON.stringify(env)})`, async () => {
      for (const args of CALLS) {
        const inProcess = await ss(args, env);
        expect(inProcess.length).toBeGreaterThan(0);
        expect(await ssDaemon(args, env)).toBe(inProcess);
      }
    });
  }
});
