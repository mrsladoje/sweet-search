/**
 * Within-file affordances (2026-07) — same-file span map on search packs +
 * "what remains" trailer on range reads.
 *
 * Fixtures mirror the two full200 miss shapes:
 *   - sushi-1175: top-1 windowed chunk lands at the wrong span of the right
 *     file; the map line must name the sibling symbol ABOVE the window.
 *   - botan-2738: three reads of a 272-line file never pass line 205; the
 *     read trailer must name the symbols in the unread remainder below.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  packageForAgent,
  buildSameFileMap,
} from '../../core/search/context-expander.js';
import {
  readFile,
  formatReadResults,
  renderUnreadBelow,
  __resetReadCachesForTests,
} from '../../core/search/search-read.js';

let TMP;

beforeEach(() => {
  __resetReadCachesForTests();
  TMP = mkdtempSync(path.join(tmpdir(), 'sweet-search-within-file-test-'));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  __resetReadCachesForTests();
});

function writeTmp(rel, content) {
  const abs = path.join(TMP, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

// ---------------------------------------------------------------------------
// Sushi-shaped fixture: src/fhirtypes/common.ts with three sibling functions.
// The top-1 chunk window covers listUndefinedLocalCodes (475-543); the fix
// surface (replaceReferences) sits just above at 441-474.
// ---------------------------------------------------------------------------

const SUSHI_FILE = 'src/fhirtypes/common.ts';

function writeSushiFile() {
  const lines = [];
  for (let i = 1; i <= 580; i++) {
    if (i === 441) lines.push('export function replaceReferences(rule, fisher) {');
    else if (i > 441 && i < 474) lines.push(`  // replaceReferences body line ${i}`);
    else if (i === 474) lines.push('}');
    else if (i === 475) lines.push('export function listUndefinedLocalCodes(system, codes) {');
    else if (i > 475 && i < 543) lines.push(`  // listUndefinedLocalCodes body line ${i}`);
    else if (i === 543) lines.push('}');
    else if (i === 544) lines.push('export function applyInsertRules(fshDefinition, tank) {');
    else if (i > 544 && i < 580) lines.push(`  // applyInsertRules body line ${i}`);
    else if (i === 580) lines.push('}');
    else lines.push(`// filler line ${i}`);
  }
  writeTmp(SUSHI_FILE, lines.join('\n') + '\n');
}

function sushiResults() {
  return [
    {
      id: 'chunk-1',
      file: SUSHI_FILE,
      startLine: 475,
      endLine: 543,
      score: 0.9,
      lateInteractionScore: 0.9,
      metadata: { file: SUSHI_FILE, name: 'listUndefinedLocalCodes', type: 'function', startLine: 475, endLine: 543 },
    },
    {
      id: 'chunk-2',
      file: 'src/utils/other.ts',
      startLine: 10,
      endLine: 40,
      score: 0.3,
      lateInteractionScore: 0.3,
      metadata: { file: 'src/utils/other.ts', name: 'printResults', type: 'function', startLine: 10, endLine: 40 },
    },
  ];
}

function mockGraphRepo(overrides = {}) {
  return {
    // No entity id → graph-neighbour reservation (phase 6) stays off; this
    // suite isolates the same-file map.
    findEnclosingEntity: () => null,
    findFirstEntityInRange: () => null,
    getFileIndexInfo: () => null,
    getDbMtime: () => null,
    findAdjacentEntities: () => ({
      above: [{ id: 'e1', name: 'replaceReferences', type: 'function', startLine: 441, endLine: 474, parentClass: null }],
      below: [{ id: 'e3', name: 'applyInsertRules', type: 'function', startLine: 544, endLine: 580, parentClass: null }],
    }),
    ...overrides,
  };
}

const OFF_TOPIC_QUERY = 'fixedValue assignment nested extension slices';

// ---------------------------------------------------------------------------
// buildSameFileMap — pure rendering
// ---------------------------------------------------------------------------

describe('buildSameFileMap', () => {
  const top = { file: SUSHI_FILE, startLine: 475, endLine: 543 };

  it('renders above/below neighbors with kinds, lines, and the placeholder drill-in hint', () => {
    const map = buildSameFileMap(top, {
      above: [{ name: 'replaceReferences', type: 'function', startLine: 441, endLine: 474 }],
      below: [{ name: 'applyInsertRules', type: 'function', startLine: 544, endLine: 580 }],
    });
    expect(map.rendered).toBe(
      '# same file: replaceReferences (fn 441-474 above) · applyInsertRules (fn 544-580 below)'
      + ` — sweep: ss-semantic ${SUSHI_FILE} "<query>"`,
    );
    expect(map.tokens).toBeGreaterThan(0);
    expect(map.neighbors).toHaveLength(2);
    expect(map.neighbors[0].position).toBe('above');
    expect(map.neighbors[1].position).toBe('below');
  });

  it('returns null when there are no adjacent entities', () => {
    expect(buildSameFileMap(top, { above: [], below: [] })).toBeNull();
    expect(buildSameFileMap(top, null)).toBeNull();
  });

  it('keeps non-function kinds verbatim', () => {
    const map = buildSameFileMap(top, {
      above: [{ name: 'a', type: 'method', startLine: 1, endLine: 2 }],
      below: [],
    });
    expect(map.rendered).toContain('(method 1-2 above)');
  });
});

// ---------------------------------------------------------------------------
// packageForAgent — emission conditions
// ---------------------------------------------------------------------------

describe('packageForAgent same-file span map', () => {
  it('sushi shape: windowed chunk + non-YES verdict → map with the above-pointer, tokens counted', () => {
    writeSushiFile();
    const response = packageForAgent(sushiResults(), { grepMatches: 5 }, {
      query: OFF_TOPIC_QUERY,
      regex: '',
      format: 'agent_full',
      projectRoot: TMP,
      codeGraphRepo: mockGraphRepo(),
    });

    expect(response.sufficiencyVerdict).not.toBe('yes');
    const top = response.results[0];
    expect(top.code).toBeTruthy();
    expect(top.expansionKind).toBe('chunk'); // labeled >10-line chunk → windowed view
    expect(top.sameFile).toBeTruthy();
    expect(top.sameFile.rendered).toContain('replaceReferences (fn 441-474 above)');
    expect(top.sameFile.rendered).toContain('applyInsertRules (fn 544-580 below)');
    expect(top.sameFile.rendered).toContain(`sweep: ss-semantic ${SUSHI_FILE}`);
    // Hint tokens are counted inside the tier budget.
    expect(top.sameFile.tokens).toBeGreaterThan(0);
    expect(response.tokensUsed).toBeLessThanOrEqual(response.tokenBudget);
  });

  it('YES verdict → no map (byte-identical pack)', () => {
    writeSushiFile();
    const response = packageForAgent(sushiResults(), { grepMatches: 5, indexedChunks: 50 }, {
      query: 'listUndefinedLocalCodes',
      regex: '\\blistUndefinedLocalCodes\\b',
      format: 'agent_full',
      projectRoot: TMP,
      codeGraphRepo: mockGraphRepo(),
    });
    expect(response.sufficiencyVerdict).toBe('yes');
    expect(response.results[0].sameFile).toBeUndefined();
  });

  it('kind=full (whole symbol shown) → no map even with adjacent entities', () => {
    writeSushiFile();
    // Unlabeled small chunk inside an entity that fits the cap → kind 'full'.
    const results = [{
      id: 'chunk-1',
      file: SUSHI_FILE,
      startLine: 480,
      endLine: 486,
      score: 0.9,
      lateInteractionScore: 0.9,
      metadata: { file: SUSHI_FILE, startLine: 480, endLine: 486 },
    }];
    const repo = mockGraphRepo({
      findEnclosingEntity: () => ({ id: null, name: 'listUndefinedLocalCodes', type: 'function', startLine: 475, endLine: 543, parentClass: null }),
    });
    const response = packageForAgent(results, { grepMatches: 5 }, {
      query: OFF_TOPIC_QUERY,
      regex: '',
      format: 'agent_full',
      projectRoot: TMP,
      codeGraphRepo: repo,
    });
    expect(response.results[0].expansionKind).toBe('full');
    expect(response.results[0].sameFile).toBeUndefined();
  });

  it('summary-only top-1 → no map', () => {
    // Nonexistent project root → code loading fails → no code on top-1.
    const response = packageForAgent(sushiResults(), { grepMatches: 5 }, {
      query: OFF_TOPIC_QUERY,
      regex: '',
      format: 'agent_full',
      projectRoot: path.join(TMP, 'nonexistent'),
      codeGraphRepo: mockGraphRepo(),
    });
    expect(response.results[0].sameFile).toBeUndefined();
  });

  it('budget overflow → hint dropped, pack intact (never truncated)', () => {
    writeSushiFile();
    const hugeName = 'x'.repeat(4000);
    const repo = mockGraphRepo({
      findAdjacentEntities: () => ({
        above: [{ id: 'e1', name: hugeName, type: 'function', startLine: 441, endLine: 474, parentClass: null }],
        below: [],
      }),
    });
    const response = packageForAgent(sushiResults(), { grepMatches: 5 }, {
      query: OFF_TOPIC_QUERY,
      regex: '',
      format: 'agent_full',
      tokenBudget: 900,
      projectRoot: TMP,
      codeGraphRepo: repo,
    });
    const top = response.results[0];
    expect(top.code).toBeTruthy(); // pack itself intact
    expect(top.sameFile).toBeUndefined(); // hint dropped on overflow
    expect(response.tokensUsed).toBeLessThanOrEqual(response.tokenBudget);
  });

  it('neighbors already shown with code in the pack are filtered from the map', () => {
    writeSushiFile();
    // Rank-2 companion (locality clustering shape) covers the same span as
    // one adjacent entity — the map must not name that one again; the other
    // neighbors survive. Companion sits >10 lines from top-1 so the
    // diversity check does not demote it to summary.
    const results = [
      sushiResults()[0],
      {
        id: 'chunk-companion',
        file: SUSHI_FILE,
        startLine: 300,
        endLine: 350,
        score: 0.85,
        lateInteractionScore: 0.85,
        metadata: { file: SUSHI_FILE, name: 'farHelper', type: 'function', startLine: 300, endLine: 350 },
      },
      sushiResults()[1],
    ];
    const repo = mockGraphRepo({
      findAdjacentEntities: () => ({
        above: [
          { id: 'e1', name: 'replaceReferences', type: 'function', startLine: 441, endLine: 474, parentClass: null },
          { id: 'e0', name: 'farHelper', type: 'function', startLine: 300, endLine: 350, parentClass: null },
        ],
        below: [{ id: 'e3', name: 'applyInsertRules', type: 'function', startLine: 544, endLine: 580, parentClass: null }],
      }),
    });
    const response = packageForAgent(results, { grepMatches: 5 }, {
      query: OFF_TOPIC_QUERY, regex: '', format: 'agent_full', projectRoot: TMP, codeGraphRepo: repo,
    });
    const top = response.results[0];
    const companion = response.results.find(r => r.symbol === 'farHelper');
    expect(companion.code).toBeTruthy(); // shown with code in the pack
    expect(top.sameFile).toBeTruthy();
    expect(top.sameFile.rendered).not.toContain('farHelper');
    expect(top.sameFile.rendered).toContain('replaceReferences (fn 441-474 above)');
    expect(top.sameFile.rendered).toContain('applyInsertRules (fn 544-580 below)');
  });

  it('no adjacent entities → no map', () => {
    writeSushiFile();
    const repo = mockGraphRepo({ findAdjacentEntities: () => ({ above: [], below: [] }) });
    const response = packageForAgent(sushiResults(), { grepMatches: 5 }, {
      query: OFF_TOPIC_QUERY, regex: '', format: 'agent_full', projectRoot: TMP, codeGraphRepo: repo,
    });
    expect(response.results[0].sameFile).toBeUndefined();
  });

  it("'no-same-file-map' ablation disables the map", () => {
    writeSushiFile();
    const response = packageForAgent(sushiResults(), { grepMatches: 5 }, {
      query: OFF_TOPIC_QUERY,
      regex: '',
      format: 'agent_full',
      projectRoot: TMP,
      codeGraphRepo: mockGraphRepo(),
      ablations: new Set(['no-same-file-map']),
    });
    expect(response.results[0].sameFile).toBeUndefined();
  });

  it('repo without findAdjacentEntities (older graph db) → no map, no crash', () => {
    writeSushiFile();
    const repo = mockGraphRepo();
    delete repo.findAdjacentEntities;
    const response = packageForAgent(sushiResults(), { grepMatches: 5 }, {
      query: OFF_TOPIC_QUERY, regex: '', format: 'agent_full', projectRoot: TMP, codeGraphRepo: repo,
    });
    expect(response.results[0].sameFile).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ss-read "what remains" trailer — botan-shaped fixture
// ---------------------------------------------------------------------------

const BOTAN_FILE = 'src/name_constraint.cpp';

function writeBotanFixture() {
  // 272-line file; suffix-matching branch symbols live below line 205.
  const lines = [];
  for (let i = 1; i <= 272; i++) {
    if (i === 210) lines.push('bool dns_suffix_match(const std::string& name) {');
    else if (i === 240) lines.push('}');
    else if (i === 245) lines.push('bool matches_suffix(const std::string& constraint) {');
    else if (i === 270) lines.push('}');
    else lines.push(`// line ${i}`);
  }
  writeTmp(BOTAN_FILE, lines.join('\n') + '\n');

  const stateDir = path.join(TMP, '.sweet-search');
  mkdirSync(stateDir, { recursive: true });
  const db = new Database(path.join(stateDir, 'codebase.db'));
  try {
    db.exec(`
      CREATE TABLE vectors (
        id TEXT PRIMARY KEY,
        file_path TEXT,
        text TEXT,
        metadata TEXT
      )
    `);
    const insert = db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)');
    const rows = [
      ['c1', 'matches_dn', 10, 160],
      ['c2', 'equal_length_compare', 170, 205],
      ['c3', 'dns_suffix_match', 210, 240],
      ['c4', 'matches_suffix', 245, 270],
    ];
    for (const [id, symbol, start, end] of rows) {
      insert.run(id, BOTAN_FILE, `// body of ${symbol}`, JSON.stringify({
        language: 'cpp', symbol, chunk_type: 'function', line_start: start, line_end: end,
      }));
    }
  } finally {
    db.close();
  }
}

describe('readFile unreadBelow', () => {
  it('botan shape: read 170-205 of 272 → remainder names the suffix-branch symbols', async () => {
    writeBotanFixture();
    const r = await readFile({ path: BOTAN_FILE, startLine: 170, endLine: 205, projectRoot: TMP });
    expect(r.ok).toBe(true);
    expect(r.unreadBelow).toEqual({
      startLine: 206,
      endLine: 272,
      symbols: [
        { symbol: 'dns_suffix_match', type: 'function', startLine: 210 },
        { symbol: 'matches_suffix', type: 'function', startLine: 245 },
      ],
      moreCount: 0,
    });
    // In-window chunk narrowing is unchanged by the remainder computation.
    expect(r.chunks.map(c => c.symbol)).toEqual(['equal_length_compare']);
  });

  it('read to EOF → no remainder', async () => {
    writeBotanFixture();
    const r = await readFile({ path: BOTAN_FILE, startLine: 170, endLine: 272, projectRoot: TMP });
    expect(r.unreadBelow).toBeNull();
  });

  it('whole-file read → no remainder', async () => {
    writeBotanFixture();
    const r = await readFile({ path: BOTAN_FILE, projectRoot: TMP });
    expect(r.unreadBelow).toBeNull();
  });

  it('unindexed file: remainder still emitted with the continue command, no symbols', async () => {
    writeTmp('plain.txt', 'a\nb\nc\nd\ne\n');
    const r = await readFile({ path: 'plain.txt', startLine: 1, endLine: 2, projectRoot: TMP });
    expect(r.unreadBelow).toEqual({ startLine: 3, endLine: 5, symbols: [], moreCount: 0 });
    expect(renderUnreadBelow(r)).toBe('# unread below (3-5) — continue: read plain.txt 3-5');
  });

  it('index has no names → sniffs C++ definition lines from the remainder (botan shape)', async () => {
    // Mirrors botan name_constraint.cpp: chunker stored name:null everywhere,
    // remainder holds qualified method definitions at column 0.
    const lines = [];
    for (let i = 1; i <= 60; i++) lines.push(`   // body ${i}`);
    lines[29] = 'bool GeneralName::matches_ip(const std::string& nam) const';
    lines[34] = 'std::ostream& operator<<(std::ostream& os, const GeneralName& gn)';
    lines[39] = 'GeneralSubtree::GeneralSubtree(const std::string& str) : GeneralSubtree()';
    lines[44] = '   some_call(arg);'; // indented call — never a definition
    lines[49] = 'do_thing(arg);';     // col-0 call statement (ends with ;) — excluded
    writeTmp('nc.cpp', lines.join('\n') + '\n');
    const r = await readFile({ path: 'nc.cpp', startLine: 1, endLine: 20, projectRoot: TMP });
    expect(r.unreadBelow.symbols.map(s => s.symbol)).toEqual([
      'GeneralName::matches_ip', 'operator<<', 'GeneralSubtree::GeneralSubtree',
    ]);
    expect(r.unreadBelow.symbols[0].startLine).toBe(30);
  });

  it('sniffs keyword definitions (def/class) in non-C files', async () => {
    const py = ['# header', 'x = 1', '', 'def first(a):', '    return a', '',
      'class Widget:', '    def method(self):', '        pass', '', 'def last():', '    pass',
      ...Array.from({ length: 20 }, (_, i) => `# pad ${i}`)];
    writeTmp('mod.py', py.join('\n') + '\n');
    const r = await readFile({ path: 'mod.py', startLine: 1, endLine: 5, projectRoot: TMP });
    expect(r.unreadBelow.symbols.map(s => s.symbol)).toEqual(['Widget', 'method', 'last']);
  });

  it('caps the symbol list at 5 and reports the overflow count', async () => {
    const lines = [];
    for (let i = 1; i <= 100; i++) lines.push(`// line ${i}`);
    writeTmp('many.js', lines.join('\n') + '\n');
    const stateDir = path.join(TMP, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    const db = new Database(path.join(stateDir, 'codebase.db'));
    try {
      db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT)');
      const insert = db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)');
      for (let i = 0; i < 8; i++) {
        insert.run(`s${i}`, 'many.js', '// x', JSON.stringify({
          symbol: `sym${i}`, chunk_type: 'function', line_start: 20 + i * 10, line_end: 25 + i * 10,
        }));
      }
    } finally {
      db.close();
    }
    const r = await readFile({ path: 'many.js', startLine: 1, endLine: 10, projectRoot: TMP });
    expect(r.unreadBelow.symbols).toHaveLength(5);
    expect(r.unreadBelow.moreCount).toBe(3);
    expect(renderUnreadBelow(r)).toContain('+3 more');
  });

  it('short form for tiny remainders (<20 lines): range + continue, no symbol list', async () => {
    // 30-line file, read 1-15 → 15-line remainder that DOES contain an
    // indexed symbol — the diet suppresses the name, keeps the affordance.
    const lines = [];
    for (let i = 1; i <= 30; i++) lines.push(`// line ${i}`);
    writeTmp('tiny.js', lines.join('\n') + '\n');
    const stateDir = path.join(TMP, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    const db = new Database(path.join(stateDir, 'codebase.db'));
    try {
      db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT)');
      db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)').run(
        't1', 'tiny.js', '// x', JSON.stringify({ symbol: 'tailFn', chunk_type: 'function', line_start: 20, line_end: 28 }),
      );
    } finally {
      db.close();
    }
    const r = await readFile({ path: 'tiny.js', startLine: 1, endLine: 15, projectRoot: TMP });
    expect(r.unreadBelow).toEqual({ startLine: 16, endLine: 30, symbols: [], moreCount: 0 });
    expect(renderUnreadBelow(r)).toBe('# unread below (16-30) — continue: read tiny.js 16-30');
  });
});

describe('renderUnreadBelow + formatReadResults', () => {
  it('agent format ends with the remainder line (recency placement)', async () => {
    writeBotanFixture();
    const r = await readFile({ path: BOTAN_FILE, startLine: 170, endLine: 205, projectRoot: TMP });
    const out = formatReadResults({ files: [r], totalMs: 1 }, 'agent');
    const lines = out.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe(
      `# unread below (206-272): dns_suffix_match, matches_suffix — continue: read ${BOTAN_FILE} 206-272`,
    );
  });

  it('ss-read command form uses positional start/end', async () => {
    writeBotanFixture();
    const r = await readFile({ path: BOTAN_FILE, startLine: 170, endLine: 205, projectRoot: TMP });
    expect(renderUnreadBelow(r, { command: 'ss-read' })).toBe(
      `# unread below (206-272): dns_suffix_match, matches_suffix — continue: ss-read ${BOTAN_FILE} 206 272`,
    );
  });

  it('no remainder → formatted output is unchanged (read-to-EOF)', async () => {
    writeBotanFixture();
    const r = await readFile({ path: BOTAN_FILE, startLine: 170, endLine: 272, projectRoot: TMP });
    const out = formatReadResults({ files: [r], totalMs: 1 }, 'agent');
    expect(out).not.toContain('# unread below');
    expect(renderUnreadBelow(r)).toBe('');
  });

  it('json format carries the structured unreadBelow field', async () => {
    writeBotanFixture();
    const r = await readFile({ path: BOTAN_FILE, startLine: 170, endLine: 205, projectRoot: TMP });
    const parsed = JSON.parse(formatReadResults({ files: [r], totalMs: 1 }, 'json'));
    expect(parsed.files[0].unreadBelow.startLine).toBe(206);
  });
});
