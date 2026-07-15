import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyAgentPackCompletion,
  buildIndexedFamilyManifest,
  shownSourceEndLine,
} from '../../core/search/agent-pack-completion.js';
import { packageForAgent } from '../../core/search/context-expander.js';
import { renderAgentSearchResponse, resolveAgentSearchRequest } from '../../core/search/search-server.js';
let projectRoot;
beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'agent-pack-completion-'));
});
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});
function writeSource(file, lines) {
  const absolute = path.join(projectRoot, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, lines.join('\n') + '\n');
}
function estimateTokens(text) {
  return text ? Math.ceil(text.length / 3.5) : 0;
}
function baseResults(overrides = {}) {
  return [
    {
      rank: 1,
      file: 'src/ScannerTokens.scala',
      startLine: 1,
      endLine: 30,
      shownStartLine: 1,
      shownEndLine: 10,
      symbol: 'scanTokens',
      symbolType: 'method',
      score: 0.9,
      presentation: 'full',
      expansionKind: 'chunk',
      code: Array.from({ length: 10 }, (_, i) => `shown ${i + 1}`).join('\n'),
      codeTokens: 40,
      ...overrides,
    },
    {
      rank: 2,
      file: 'src/other.scala',
      startLine: 1,
      endLine: 20,
      symbol: 'otherResult',
      symbolType: 'method',
      score: 0.5,
      presentation: 'preview',
      code: 'x'.repeat(560),
      codeTokens: 160,
    },
  ];
}
function boundaryRepo(overrides = {}) {
  return {
    findAdjacentEntities: vi.fn(() => ({
      above: [],
      below: [{
        id: 'leading-infix',
        name: 'isLeadingInfixArg',
        type: 'method',
        startLine: 13,
        endLine: 17,
        parentClass: 'ScannerTokens',
      }],
    })),
    getEntityById: vi.fn(() => ({ parentClass: 'ScannerTokens' })),
    findEntitiesByAnyName: vi.fn(() => []),
    findFamilyCandidates: vi.fn(() => []),
    ...overrides,
  };
}
describe('shownSourceEndLine', () => {
  it('tracks only source lines before a formatter truncation marker', () => {
    expect(shownSourceEndLine(900, 'a\nb\nc\n// ... (50 more lines)', true)).toBe(902);
    expect(shownSourceEndLine(900, 'a\nb\nc', false)).toBe(902);
  });
});
describe('native captured-agent search response', () => {
  it('activates agent packaging for format=text while preserving explicit JSON agent formats', () => {
    expect(resolveAgentSearchRequest('text', true))
      .toEqual({ agentFormat: 'agent', renderText: true });
    expect(resolveAgentSearchRequest('text', false))
      .toEqual({ agentFormat: undefined, renderText: false });
    expect(resolveAgentSearchRequest('agent_full', true))
      .toEqual({ agentFormat: 'agent_full', renderText: false });
  });
  it('renders continuation and family evidence instead of streaming raw JSON', () => {
    const rendered = renderAgentSearchResponse({
      mode: 'pattern', tokenBudget: 3000, tokensUsed: 120, subMode: 'agent_preview',
      confidence: 'medium', sufficiencyVerdict: 'no', stats: {},
      results: [{
        rank: 1, file: 'src/vec.rs', startLine: 1, endLine: 12,
        symbol: 'IVec2', symbolType: 'struct', presentation: 'full', score: 0.8,
        code: 'pub struct IVec2;',
        continuation: {
          kind: 'trailer', rendered: '# continues at src/vec.rs:15 impl_i64',
        },
        familyManifest: {
          rendered: '# indexed family: IVec{2,3,4} · I64Vec{2,3,4}',
        },
      }],
    });
    expect(rendered).toContain('# continues at src/vec.rs:15 impl_i64');
    expect(rendered).toContain('# indexed family: IVec{2,3,4} · I64Vec{2,3,4}');
    expect(rendered.trimStart().startsWith('{')).toBe(false);
  });
});
describe('buildIndexedFamilyManifest', () => {
  const allTwelve = [
    'IVec2', 'IVec3', 'IVec4',
    'UVec2', 'UVec3', 'UVec4',
    'I64Vec2', 'I64Vec3', 'I64Vec4',
    'U64Vec2', 'U64Vec3', 'U64Vec4',
  ].map((name, i) => ({
    id: `e${i}`,
    name,
    type: 'struct',
    filePath: `src/generated/${name.toLowerCase()}.rs`,
    startLine: 1,
    endLine: 20,
  }));
  it('compacts exact indexed members across type, width, and dimension slots', () => {
    const manifest = buildIndexedFamilyManifest(allTwelve, { seedNames: ['IVec2', 'UVec2'] });
    expect(manifest.rendered).toBe(
      '# indexed family: IVec{2,3,4} · UVec{2,3,4} · I64Vec{2,3,4} · U64Vec{2,3,4}',
    );
    expect(manifest.members.map((member) => member.name).sort())
      .toEqual(allTwelve.map((member) => member.name).sort());
  });
  it('never invents a missing indexed member', () => {
    const withoutU64Vec4 = allTwelve.filter((member) => member.name !== 'U64Vec4');
    const manifest = buildIndexedFamilyManifest(withoutU64Vec4, { seedNames: ['IVec2'] });
    expect(manifest.rendered).toContain('U64Vec{2,3}');
    expect(manifest.rendered).not.toContain('U64Vec{2,3,4}');
    expect(manifest.members.some((member) => member.name === 'U64Vec4')).toBe(false);
  });
  it('preserves exact numeric suffixes instead of normalizing indexed names', () => {
    const candidates = ['Vec01', 'Vec02', 'Vec10'].map((name, i) => ({
      id: `e${i}`, name, type: 'struct', filePath: `src/${name}.rs`, startLine: 1, endLine: 2,
    }));
    const manifest = buildIndexedFamilyManifest(candidates, { seedNames: ['Vec01'] });
    expect(manifest.rendered).toBe('# indexed family: Vec{01,02,10}');
  });
});
describe('applyAgentPackCompletion', () => {
  it('replaces the lowest-ranked code tail with the next complete relevant symbol', () => {
    writeSource('src/ScannerTokens.scala', Array.from({ length: 170 }, (_, i) => (
      i === 158 ? 'def isLeadingInfixArg(token: Token): Boolean = {'
        : i === 162 ? '}'
          : `// scala line ${i + 1}`
    )));
    const results = baseResults({ code: 'getOutdentIfNeeded(); isLeadingInfix == LeadingInfix.Yes', codeTokens: 40 });
    const repo = boundaryRepo({ findAdjacentEntities: vi.fn(() => ({ above: [], below: [
        { id: 'indent', name: 'getIndentIfNeeded', type: 'method', startLine: 16, endLine: 20 }, {
        id: 'leading-infix', name: 'isLeadingInfixArg', type: 'method',
        startLine: 159, endLine: 163, parentClass: 'ScannerTokens',
      }] })), });
    const originalRanks = results.map(({ rank, score }) => ({ rank, score }));
    const beforeTokens = results.reduce((sum, result) => sum + result.codeTokens, 0);
    const outcome = applyAgentPackCompletion({
      results,
      query: 'insert outdent before right brace significant indentation blank line',
      regex: '',
      codeGraphRepo: repo,
      fileCache: new Map(),
      projectRoot,
      tokensUsed: beforeTokens,
      tokenBudget: 3000,
      estimateTokens,
      isAgentFormat: true,
    });
    expect(results.map(({ rank, score }) => ({ rank, score }))).toEqual(originalRanks);
    expect(results[0].continuation).toMatchObject({
      kind: 'symbol',
      file: 'src/ScannerTokens.scala',
      startLine: 159,
      endLine: 163,
      symbol: 'isLeadingInfixArg',
    });
    expect(results[0].continuation.code).toContain('def isLeadingInfixArg');
    expect(results[1].presentation).toBe('summary');
    expect(results[1].code).toBeNull();
    expect(outcome.tokensUsed).toBeLessThanOrEqual(beforeTokens);
    expect(outcome.tokensUsed).toBeLessThanOrEqual(3000);
  });
  it('falls back to the compact continuation trailer when the symbol body cannot fit', () => {
    writeSource('src/ScannerTokens.scala', Array.from({ length: 300 }, (_, i) => `line ${i + 1} ${'x'.repeat(80)}`));
    const results = baseResults();
    const repo = boundaryRepo({
      findAdjacentEntities: vi.fn(() => ({
        above: [],
        below: [{
          id: 'leading-infix', name: 'isLeadingInfixArg', type: 'method',
          startLine: 13, endLine: 280, parentClass: 'ScannerTokens',
        }],
      })),
    });
    const beforeTokens = results.reduce((sum, result) => sum + result.codeTokens, 0);
    const outcome = applyAgentPackCompletion({
      results,
      query: 'isLeadingInfixArg',
      regex: '',
      codeGraphRepo: repo,
      fileCache: new Map(),
      projectRoot,
      tokensUsed: beforeTokens,
      tokenBudget: 3000,
      estimateTokens,
      isAgentFormat: true,
    });
    expect(results[0].continuation).toMatchObject({ kind: 'trailer', symbol: 'isLeadingInfixArg' });
    expect(results[0].continuation.rendered)
      .toBe('# continues at src/ScannerTokens.scala:13 isLeadingInfixArg');
    expect(outcome.tokensUsed).toBeLessThanOrEqual(beforeTokens);
  });
  it('derives the full manifest from indexed symbols despite a restrictive model regex', () => {
    const names = [
      'IVec2', 'IVec3', 'IVec4', 'UVec2', 'UVec3', 'UVec4',
      'I64Vec2', 'I64Vec3', 'I64Vec4', 'U64Vec2', 'U64Vec3', 'U64Vec4',
    ];
    const indexed = names.map((name, i) => ({
      id: `vec-${i}`, name, type: 'struct',
      filePath: `src/generated/${name.toLowerCase()}.rs`, startLine: 1, endLine: 20,
    }));
    const results = baseResults({
      file: 'src/generated/ivec2.rs',
      symbol: 'IVec2',
      symbolType: 'struct',
      code: 'pub struct IVec2;\npub fn accepts(value: UVec2) {}',
      codeTokens: 20,
    });
    const repo = boundaryRepo({
      findAdjacentEntities: vi.fn(() => ({ above: [], below: [] })),
      findEntitiesByAnyName: vi.fn(() => indexed.filter((member) => ['IVec2', 'UVec2'].includes(member.name))),
      findFamilyCandidates: vi.fn(() => indexed),
    });
    const beforeTokens = results.reduce((sum, result) => sum + result.codeTokens, 0);
    const outcome = applyAgentPackCompletion({
      results,
      query: 'integer vector generated outputs',
      regex: '[IU]Vec[234]',
      codeGraphRepo: repo,
      fileCache: new Map(),
      projectRoot,
      tokensUsed: beforeTokens,
      tokenBudget: 3000,
      estimateTokens,
      isAgentFormat: true,
    });
    expect(results[0].familyManifest.rendered).toContain('I64Vec{2,3,4}');
    expect(results[0].familyManifest.rendered).toContain('U64Vec{2,3,4}');
    expect(repo.findFamilyCandidates).toHaveBeenCalled();
    expect(outcome.tokensUsed)
      .toBe(beforeTokens - 160 + results[0].familyManifest.tokens);
  });
  it('uses selected summary symbols as indexed seeds for a generated family', () => {
    const names = [
      'IVec2', 'IVec3', 'IVec4', 'UVec2', 'UVec3', 'UVec4',
      'I64Vec2', 'I64Vec3', 'I64Vec4', 'U64Vec2', 'U64Vec3', 'U64Vec4',
    ];
    const indexed = names.map((name, i) => ({
      id: `vec-${i}`, name, type: 'struct',
      filePath: `src/generated/${name.toLowerCase()}.rs`, startLine: 1, endLine: 20,
    }));
    const results = [
      {
        rank: 1, file: 'src/generated/templates.rs', startLine: 1, endLine: 20,
        shownStartLine: 1, shownEndLine: 20, symbol: 'impl_integer_vectors',
        symbolType: 'macro', score: 0.9, presentation: 'full',
        code: 'macro_rules! impl_integer_vectors { () => {} }', codeTokens: 18,
      },
      {
        rank: 2, file: 'src/generated/ivec2.rs', startLine: 1, endLine: 20,
        symbol: 'IVec2', symbolType: 'struct', score: 0.7,
        presentation: 'summary', summary: 'src/generated/ivec2.rs:1 — IVec2 (struct)',
        code: null, codeTokens: 0,
      },
      {
        rank: 3, file: 'src/generated/uvec2.rs', startLine: 1, endLine: 20,
        symbol: 'UVec2', symbolType: 'struct', score: 0.6,
        presentation: 'summary', summary: 'src/generated/uvec2.rs:1 — UVec2 (struct)',
        code: null, codeTokens: 0,
      },
      {
        rank: 4, file: 'src/other.rs', startLine: 1, endLine: 20,
        symbol: 'unrelated_tail', symbolType: 'function', score: 0.4,
        presentation: 'preview', code: 'x'.repeat(560), codeTokens: 160,
      },
    ];
    const repo = boundaryRepo({
      findAdjacentEntities: vi.fn(() => ({ above: [], below: [] })),
      findEntitiesByAnyName: vi.fn((seeds) => indexed.filter((member) => seeds.includes(member.name))),
      findFamilyCandidates: vi.fn(() => indexed),
    });
    const outcome = applyAgentPackCompletion({
      results,
      query: 'integer vector generated outputs',
      regex: '[IU]Vec[234]',
      codeGraphRepo: repo,
      fileCache: new Map(),
      projectRoot,
      tokensUsed: 178,
      tokenBudget: 3000,
      estimateTokens,
      isAgentFormat: true,
    });
    expect(results[0].familyManifest.rendered).toContain('I64Vec{2,3,4}');
    expect(results[0].familyManifest.rendered).toContain('U64Vec{2,3,4}');
    expect(results[3].presentation).toBe('summary');
    expect(outcome.tokensUsed).toBeLessThanOrEqual(178);
  });
  it('never demotes the family owner or the sole top result to fund a manifest', () => {
    const indexed = ['IVec2', 'IVec3', 'IVec4'].map((name, i) => ({
      id: `vec-${i}`, name, type: 'struct',
      filePath: `src/generated/${name.toLowerCase()}.rs`, startLine: 1, endLine: 20,
    }));
    const results = [baseResults({
      file: 'src/generated/ivec2.rs',
      symbol: 'IVec2',
      symbolType: 'struct',
      code: 'pub struct IVec2;',
      codeTokens: 20,
    })[0]];
    const before = structuredClone(results);
    const repo = boundaryRepo({
      findAdjacentEntities: vi.fn(() => ({ above: [], below: [] })),
      findEntitiesByAnyName: vi.fn(() => [indexed[0]]),
      findFamilyCandidates: vi.fn(() => indexed),
    });
    const outcome = applyAgentPackCompletion({
      results,
      query: 'integer vector generated outputs',
      regex: '[IU]Vec[234]',
      codeGraphRepo: repo,
      fileCache: new Map(),
      projectRoot,
      tokensUsed: 20,
      tokenBudget: 3000,
      estimateTokens,
      isAgentFormat: true,
    });
    expect(results).toEqual(before);
    expect(outcome).toEqual({ tokensUsed: 20, changed: false });
  });
  it('does not discover an unrelated numeric family from arbitrary body text', () => {
    const results = baseResults({
      symbol: 'scanTokens',
      code: 'function scanTokens() { return helper1(); }',
      codeTokens: 20,
    });
    const repo = boundaryRepo({
      findAdjacentEntities: vi.fn(() => ({ above: [], below: [] })),
      findEntitiesByAnyName: vi.fn(() => [{
        id: 'helper1', name: 'helper1', type: 'function',
        filePath: 'src/helpers.js', startLine: 1, endLine: 2,
      }]),
      findFamilyCandidates: vi.fn(() => [
        { id: 'helper1', name: 'helper1', type: 'function', filePath: 'src/helpers.js' },
        { id: 'helper2', name: 'helper2', type: 'function', filePath: 'src/helpers.js' },
      ]),
    });
    const outcome = applyAgentPackCompletion({
      results,
      query: 'scanner token boundary',
      regex: '',
      codeGraphRepo: repo,
      fileCache: new Map(),
      projectRoot,
      tokensUsed: 180,
      tokenBudget: 3000,
      estimateTokens,
      isAgentFormat: true,
    });
    expect(outcome).toEqual({ tokensUsed: 180, changed: false });
    expect(repo.findFamilyCandidates).not.toHaveBeenCalled();
  });
  it('never demotes rank one to complete a lower-ranked boundary', () => {
    const results = baseResults();
    results[0].shownStartLine = undefined;
    results[0].shownEndLine = undefined;
    results[1] = {
      ...results[1],
      file: 'src/ScannerTokens.scala',
      shownStartLine: 1,
      shownEndLine: 10,
      presentation: 'full',
    };
    const before = structuredClone(results);
    const outcome = applyAgentPackCompletion({
      results,
      query: 'isLeadingInfixArg',
      regex: '',
      codeGraphRepo: boundaryRepo(),
      fileCache: new Map(),
      projectRoot,
      tokensUsed: 200,
      tokenBudget: 3000,
      estimateTokens,
      isAgentFormat: true,
    });
    expect(results).toEqual(before);
    expect(outcome).toEqual({ tokensUsed: 200, changed: false });
  });
  it('is inert when opts._isAgentFormat is false', () => {
    const results = baseResults();
    const repo = boundaryRepo();
    const before = structuredClone(results);
    const outcome = applyAgentPackCompletion({
      results,
      query: 'isLeadingInfixArg',
      regex: '',
      codeGraphRepo: repo,
      fileCache: new Map(),
      projectRoot,
      tokensUsed: 200,
      tokenBudget: 3000,
      estimateTokens,
      isAgentFormat: false,
    });
    expect(results).toEqual(before);
    expect(outcome).toEqual({ tokensUsed: 200, changed: false });
    expect(repo.findAdjacentEntities).not.toHaveBeenCalled();
    expect(repo.findEntitiesByAnyName).not.toHaveBeenCalled();
  });
});
describe('packageForAgent boundary integration', () => {
  it('uses the rendered cutoff for adjacency and preserves the pre-branch token total', () => {
    writeSource('src/ScannerTokens.scala', Array.from({ length: 40 }, (_, i) => (
      i === 10 ? 'def isLeadingInfixArg(token: Token): Boolean = {'
        : i === 12 ? '}'
          : `// scanner line ${i + 1} ${'x'.repeat(40)}`
    )));
    writeSource('src/other.scala', Array.from({ length: 20 }, (_, i) => `def helper${i} = ${i}`));
    const ranked = [
      {
        id: 'top', file: 'src/ScannerTokens.scala', startLine: 1, endLine: 30,
        score: 0.9, lateInteractionScore: 0.9,
        metadata: {
          file: 'src/ScannerTokens.scala', name: 'scanTokens', type: 'method',
          startLine: 1, endLine: 30,
        },
      },
      {
        id: 'tail', file: 'src/other.scala', startLine: 1, endLine: 20,
        score: 0.5, lateInteractionScore: 0.5,
        metadata: {
          file: 'src/other.scala', name: 'helperFamily', type: 'method',
          startLine: 1, endLine: 20,
        },
      },
    ];
    const adjacencyEnds = [];
    const repo = boundaryRepo({
      findEnclosingEntity: vi.fn(() => null),
      findFirstEntityInRange: vi.fn(() => null),
      getFileIndexInfo: vi.fn(() => null),
      getDbMtime: vi.fn(() => null),
      findAdjacentEntities: vi.fn((file, start, end) => {
        if (file === 'src/ScannerTokens.scala') adjacencyEnds.push(end);
        return file === 'src/ScannerTokens.scala'
          ? {
              above: [],
              below: [{
                id: 'leading-infix', name: 'isLeadingInfixArg', type: 'method',
                startLine: 11, endLine: 13, parentClass: 'ScannerTokens',
              }],
            }
          : { above: [], below: [] };
      }),
    });
    const baseline = packageForAgent(ranked, { grepMatches: 2 }, {
      query: 'insert outdent before right brace significant indentation blank line', regex: '', format: 'agent_full', tokenBudget: 300,
      projectRoot, codeGraphRepo: repo, _isAgentFormat: false,
    });
    adjacencyEnds.length = 0;
    const completed = packageForAgent(ranked, { grepMatches: 2 }, {
      query: 'insert outdent before right brace significant indentation blank line', regex: '', format: 'agent_full', tokenBudget: 300,
      projectRoot, codeGraphRepo: repo, _isAgentFormat: true,
    });
    const top = completed.results[0];
    expect(top.boundaryTruncated).toBe(true);
    expect(top.shownEndLine).toBeLessThan(top.endLine);
    expect(adjacencyEnds).toContain(top.shownEndLine);
    expect(top.continuation).toMatchObject({
      kind: 'symbol', symbol: 'isLeadingInfixArg', startLine: 11, endLine: 13,
    });
    expect(completed.results.map(({ rank, score }) => ({ rank, score })))
      .toEqual(baseline.results.map(({ rank, score }) => ({ rank, score })));
    expect(completed.tokensUsed).toBeLessThanOrEqual(baseline.tokensUsed);
    expect(completed.tokensUsed).toBeLessThanOrEqual(completed.tokenBudget);
  });
});
