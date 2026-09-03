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
import { buildPackSiblingLine } from '../../core/search/agent-pack-completion.js';
import {
  readFile,
  formatReadResults,
  renderUnreadBelow,
  renderUnreadAbove,
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

// ---------------------------------------------------------------------------
// unread ABOVE (2026-09-03, squashql-295 shape): a field declared and assigned
// above a mid-file window; the trailer must name it. Entities come from
// code-graph.db (fields are entities, not chunks), chunks from codebase.db.
// ---------------------------------------------------------------------------

const JAVA_FILE = 'src/QueryResolver.java';

function writeSquashqlFixture() {
  const lines = [];
  for (let i = 1; i <= 300; i++) {
    if (i === 10) lines.push('public class QueryResolver {');
    else if (i === 35) lines.push('  private final Map<Measure, CompiledMeasure> subQueryMeasures;');
    else if (i === 50) lines.push('  public QueryResolver(QueryDto query, Map<String, Store> storesByName) {');
    else if (i === 55) lines.push('    this.subQueryMeasures = compileMeasures(query.table.subQuery.measures, false);');
    else if (i === 60) lines.push('  }');
    else if (i === 191) lines.push('  private DatabaseQuery toSubQuery(QueryDto subQuery) {');
    else if (i === 207) lines.push('    List<CompiledMeasure> measures = new ArrayList<>(this.subQueryMeasures.values());');
    else if (i === 208) lines.push('  }');
    else if (i === 210) lines.push('  private void checkSubQuery(QueryDto subQuery) {');
    else if (i === 228) lines.push('  }');
    else if (i === 300) lines.push('}');
    else lines.push(`    // line ${i}`);
  }
  writeTmp(JAVA_FILE, lines.join('\n') + '\n');
  const stateDir = path.join(TMP, '.sweet-search');
  mkdirSync(stateDir, { recursive: true });
  const db = new Database(path.join(stateDir, 'codebase.db'));
  try {
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT)');
    const insert = db.prepare('INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)');
    insert.run('c1', JAVA_FILE, '// x', JSON.stringify({ symbol: 'QueryResolver', chunk_type: 'method', line_start: 50, line_end: 60, language: 'java' }));
    insert.run('c2', JAVA_FILE, '// x', JSON.stringify({ symbol: 'toSubQuery', chunk_type: 'method', line_start: 191, line_end: 208, language: 'java' }));
    insert.run('c3', JAVA_FILE, '// x', JSON.stringify({ symbol: 'checkSubQuery', chunk_type: 'method', line_start: 210, line_end: 228, language: 'java' }));
    insert.run('c4', JAVA_FILE, '// x', JSON.stringify({ symbol: 'QueryResolverClass', chunk_type: 'class', line_start: 10, line_end: 300, language: 'java' }));
  } finally {
    db.close();
  }
  const graph = new Database(path.join(stateDir, 'code-graph.db'));
  try {
    graph.exec(`CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT, type TEXT, file_path TEXT,
      start_line INTEGER, end_line INTEGER, parent_class TEXT, signature TEXT, summary TEXT,
      stale_since INTEGER DEFAULT NULL)`);
    const ins = graph.prepare('INSERT INTO entities (id, name, type, file_path, start_line, end_line, parent_class) VALUES (?, ?, ?, ?, ?, ?, ?)');
    ins.run(1, 'QueryResolver', 'class', JAVA_FILE, 10, 300, null);
    ins.run(2, 'subQueryMeasures', 'field', JAVA_FILE, 35, 35, 'QueryResolver');
    ins.run(3, 'QueryResolver', 'method', JAVA_FILE, 50, 60, 'QueryResolver');
    ins.run(4, 'toSubQuery', 'method', JAVA_FILE, 191, 208, 'QueryResolver');
    ins.run(5, 'checkSubQuery', 'method', JAVA_FILE, 210, 228, 'QueryResolver');
  } finally {
    graph.close();
  }
}

describe('unread above (squashql-295 shape)', () => {
  it('names the field declared above the window, via the entity table', async () => {
    writeSquashqlFixture();
    const r = await readFile({ path: JAVA_FILE, startLine: 170, endLine: 235, projectRoot: TMP });
    expect(r.unreadAbove).toEqual({
      startLine: 1,
      endLine: 169,
      symbols: [
        { symbol: 'subQueryMeasures', type: 'field', startLine: 35, referenced: true },
        { symbol: 'QueryResolver', type: 'method', startLine: 50, referenced: false },
      ],
      moreCount: 0,
    });
    // The enclosing class (10-300) is not "unread"; the below side is unchanged.
    expect(r.unreadAbove.symbols.map(s => s.symbol)).not.toContain('QueryResolverClass');
    expect(r.unreadBelow.startLine).toBe(236);
  });

  it('renders only for the ss-read surface, before-the-fence form, and honours SS_UNREAD_ABOVE=0', async () => {
    writeSquashqlFixture();
    const r = await readFile({ path: JAVA_FILE, startLine: 170, endLine: 235, projectRoot: TMP });
    expect(renderUnreadAbove(r, { command: 'ss-read' })).toBe(
      `# unread above (1-169): subQueryMeasures, QueryResolver — continue: ss-read ${JAVA_FILE} 1 169`,
    );
    expect(renderUnreadAbove(r)).toBe('');
    // Human CLI output stays byte-identical: the agent formatter never prints it.
    const out = formatReadResults({ files: [r], totalMs: 1 }, 'agent');
    expect(out).not.toContain('# unread above');
    process.env.SS_UNREAD_ABOVE = '0';
    try {
      expect(renderUnreadAbove(r, { command: 'ss-read' })).toBe('');
      // The field itself is still computed: the switch is a render-time, client-side gate.
      const off = await readFile({ path: JAVA_FILE, startLine: 170, endLine: 235, projectRoot: TMP });
      expect(off.unreadAbove.symbols[0].symbol).toBe('subQueryMeasures');
    } finally {
      delete process.env.SS_UNREAD_ABOVE;
    }
  });

  it('with no query evidence, the field the window READS still leads the list', async () => {
    writeSquashqlFixture();
    const stateDir = path.join(TMP, '.sweet-search');
    const graph = new Database(path.join(stateDir, 'code-graph.db'));
    try {
      const ins = graph.prepare('INSERT INTO entities (id, name, type, file_path, start_line, end_line, parent_class) VALUES (?, ?, ?, ?, ?, ?, ?)');
      ins.run(9, 'aaaEarlyField', 'field', JAVA_FILE, 12, 12, 'QueryResolver');
      for (let i = 0; i < 6; i++) ins.run(10 + i, `helper${i}`, 'method', JAVA_FILE, 61 + i * 2, 62 + i * 2, 'QueryResolver');
    } finally {
      graph.close();
    }
    // Window 170-235 contains L207 `this.subQueryMeasures.values()`; aaaEarlyField (L12) is not read there.
    const r = await readFile({ path: JAVA_FILE, startLine: 170, endLine: 235, projectRoot: TMP });
    expect(r.unreadAbove.symbols[0].symbol).toBe('subQueryMeasures');
    expect(r.unreadAbove.symbols[1].symbol).toBe('aaaEarlyField');
    expect(renderUnreadAbove(r, { command: 'ss-read' }).startsWith('# unread above (1-169): subQueryMeasures, aaaEarlyField,')).toBe(true);
  });

  it('ranks the above list by query evidence (the grep phrase) when it overflows', async () => {
    writeSquashqlFixture();
    const stateDir = path.join(TMP, '.sweet-search');
    const graph = new Database(path.join(stateDir, 'code-graph.db'));
    try {
      const ins = graph.prepare('INSERT INTO entities (id, name, type, file_path, start_line, end_line, parent_class) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (let i = 0; i < 6; i++) ins.run(10 + i, `helper${i}`, 'method', JAVA_FILE, 61 + i * 2, 62 + i * 2, 'QueryResolver');
    } finally {
      graph.close();
    }
    const r = await readFile({ path: JAVA_FILE, startLine: 170, endLine: 235, projectRoot: TMP });
    expect(r.unreadAbove.moreCount).toBe(3);
    const line = renderUnreadAbove(r, { command: 'ss-read', queryEvidence: { anchors: ['subQuery'], subtokens: ['sub', 'query'] } });
    expect(line.startsWith('# unread above (1-169): subQueryMeasures,')).toBe(true);
    expect(line).toContain('+3 more');
  });

  it('read from line 1, whole file, and tiny above-span keep the short/no form', async () => {
    writeSquashqlFixture();
    const fromTop = await readFile({ path: JAVA_FILE, startLine: 1, endLine: 40, projectRoot: TMP });
    expect(fromTop.unreadAbove).toBeNull();
    const whole = await readFile({ path: JAVA_FILE, projectRoot: TMP });
    expect(whole.unreadAbove).toBeNull();
    const tiny = await readFile({ path: JAVA_FILE, startLine: 12, endLine: 40, projectRoot: TMP });
    expect(tiny.unreadAbove).toEqual({ startLine: 1, endLine: 11, symbols: [], moreCount: 0 });
    // No symbol above, no signal: nothing printed (the structured field stays).
    expect(renderUnreadAbove(tiny, { command: 'ss-read' })).toBe('');
  });

  it('prints nothing when the window reads none of the above symbols and the query names none', async () => {
    writeSquashqlFixture();
    // Window 240-300 reads no field; the above list (fields, methods) is unmotivated.
    const r = await readFile({ path: JAVA_FILE, startLine: 240, endLine: 300, projectRoot: TMP });
    expect(r.unreadAbove.symbols.length).toBeGreaterThan(0);
    expect(renderUnreadAbove(r, { command: 'ss-read' })).toBe('');
    // ...unless the session's query evidence names one of them.
    expect(renderUnreadAbove(r, { command: 'ss-read', queryEvidence: { anchors: ['toSubQuery'], subtokens: [] } }))
      .toContain('toSubQuery');
  });

  it('json format carries the structured unreadAbove field', async () => {
    writeSquashqlFixture();
    const r = await readFile({ path: JAVA_FILE, startLine: 170, endLine: 235, projectRoot: TMP });
    const parsed = JSON.parse(formatReadResults({ files: [r], totalMs: 1 }, 'json'));
    expect(parsed.files[0].unreadAbove.symbols[0].symbol).toBe('subQueryMeasures');
  });
});

// ---------------------------------------------------------------------------
// Pack-side sibling line: ss-find "checkSubQuery" returns a chunk labelled
// checkSubQuery that STARTS inside toSubQuery (191-227). The family must be
// computed for the symbol's own declaration line, and the line must render.
// ---------------------------------------------------------------------------

describe('pack sibling line (ss-search / ss-find top-1)', () => {
  const ENTITIES = [
    { id: 1, name: 'QueryResolver', type: 'class', startLine: 10, endLine: 300 },
    { id: 2, name: 'subQueryMeasures', type: 'field', startLine: 35, endLine: 35 },
    { id: 4, name: 'QueryResolver', type: 'method', startLine: 50, endLine: 60 },
    { id: 6, name: 'toSubQuery', type: 'method', startLine: 191, endLine: 208 },
    { id: 7, name: 'checkSubQuery', type: 'method', startLine: 210, endLine: 228 },
  ];
  const repo = () => ({
    findEnclosingEntity: (file, line) => ENTITIES.filter(e => e.startLine <= line && e.endLine >= line)
      .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] || null,
    findEntitiesInFile: () => ENTITIES,
    findEntityWithNameInRange: (file, start, end, name) => ENTITIES.find(e => e.name === name && e.startLine >= start && e.startLine <= end) || null,
    findAdjacentEntities: () => ({ above: [], below: [] }),
  });

  it('keys the family on the symbol declaration, not the chunk start', () => {
    writeSquashqlFixture();
    const top = { file: JAVA_FILE, symbol: 'checkSubQuery', symbolType: 'method', startLine: 191, endLine: 227 };
    const line = buildPackSiblingLine(top, repo(), { projectRoot: TMP, regex: '\\bcheckSubQuery\\b' });
    expect(line.rendered).toContain('siblings of checkSubQuery');
    expect(line.rendered).toContain('35: private final Map<Measure, CompiledMeasure> subQueryMeasures;');
    expect(line.rendered).toContain('191: private DatabaseQuery toSubQuery(QueryDto subQuery) {');
    // A class top-1 gets nothing: its "family" is every top-level entity.
    expect(buildPackSiblingLine({ ...top, symbol: 'QueryResolver', symbolType: 'class', startLine: 10, endLine: 300 }, repo(), { projectRoot: TMP })).toBeNull();
  });

  it('packageForAgent attaches it to top-1 under agent format and counts its tokens', () => {
    writeSquashqlFixture();
    const code = Array.from({ length: 37 }, (_, i) => `    // chunk line ${191 + i}`).join('\n');
    const results = [{
      id: 'c-check', file: JAVA_FILE, startLine: 191, endLine: 227, score: 0.9, lateInteractionScore: 0.9,
      symbol: 'checkSubQuery', symbolType: 'method', text: code, code,
    }];
    const response = packageForAgent(results, { grepMatches: 2 }, {
      query: 'checkSubQuery', format: 'agent_full', tokenBudget: 4000, projectRoot: TMP,
      codeGraphRepo: repo(), _isAgentFormat: true,
    });
    const top = response.results[0];
    expect(top.siblingLine.rendered).toContain('35: private final Map<Measure, CompiledMeasure> subQueryMeasures;');
    expect(response.tokensUsed).toBeGreaterThanOrEqual(top.siblingLine.tokens);
    const off = packageForAgent(results.map(r => ({ ...r })), { grepMatches: 2 }, {
      query: 'checkSubQuery', format: 'agent_full', tokenBudget: 4000, projectRoot: TMP,
      codeGraphRepo: repo(), _isAgentFormat: true, _siblingLine: false,
    });
    expect(off.results[0].siblingLine).toBeUndefined();
  });
});
