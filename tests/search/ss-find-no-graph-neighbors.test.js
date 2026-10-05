/**
 * ss-find (ColGrep / pattern mode) never carries the related rows (the 1-hop graph tier).
 * ss-search (every non-pattern mode) keeps them: one compact line per kind under rank 1.
 *
 * The decision lives in graphNeighborsEnabled() (context-expander.js). Pattern
 * mode must not even query the graph, and must not reserve budget for the tier.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  packageForAgent,
  graphNeighborsEnabled,
} from '../../core/search/context-expander.js';
import { renderAgentSearchResponse } from '../../core/search/search-server.js';

const RELATED_HEADER = '### related (1-hop graph';
const RELATED_ROW = 'function validate calls: function validateParam (lib/validation.js 118-144)';

describe('graphNeighborsEnabled', () => {
  it('is off only for pattern mode and the no-graph-neighbors ablation', () => {
    expect(graphNeighborsEnabled({ mode: 'pattern' })).toBe(false);
    expect(graphNeighborsEnabled({ mode: 'hybrid' })).toBe(true);
    expect(graphNeighborsEnabled({ mode: 'semantic' })).toBe(true);
    expect(graphNeighborsEnabled({ mode: 'lexical' })).toBe(true);
    expect(graphNeighborsEnabled({ mode: null })).toBe(true);
    expect(graphNeighborsEnabled({})).toBe(true);
    expect(graphNeighborsEnabled({
      mode: 'hybrid', ablations: new Set(['no-graph-neighbors']),
    })).toBe(false);
  });
});

describe('packageForAgent graph neighbours: ss-find vs ss-search', () => {
  let tmp;
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'ss-find-nogn-')); });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

  function write(rel, body) {
    const full = join(tmp, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    return rel;
  }

  function fixture() {
    const rel = write('lib/validation.js', [
      "'use strict'",
      "const { kSchemaParams: paramsSchema } = require('./symbols')",
      '',
      'function validate (request) {',
      '  return paramsSchema && validateParam(paramsSchema, request)',
      '}',
      '',
      'module.exports = validate',
    ].join('\n'));
    const ranked = [{
      id: 'r1', file: rel, startLine: 4, endLine: 6,
      score: 1.0, lateInteractionScore: 1.0,
      metadata: { file: rel, name: 'validate', type: 'function', startLine: 4, endLine: 6 },
    }];
    const calls = { outgoing: 0, incoming: 0 };
    const repo = {
      findEnclosingEntity: () => ({
        id: 'e_validate', name: 'validate', type: 'function',
        startLine: 4, endLine: 6, parentClass: null,
      }),
      getOutgoingRelationships: () => {
        calls.outgoing++;
        return [{
          type: 'calls', targetName: 'validateParam', targetId: 'e_vp',
          contextLine: 5, fullImportPath: null,
          target: { id: 'e_vp', name: 'validateParam', type: 'function',
            filePath: 'lib/validation.js', startLine: 118, endLine: 144 },
        }];
      },
      getIncomingRelationships: () => { calls.incoming++; return []; },
      getDbMtime: () => null,
      getFileIndexInfo: () => null,
    };
    return { ranked, repo, calls };
  }

  function pack(mode, extra = {}) {
    const { ranked, repo, calls } = fixture();
    const response = packageForAgent(ranked, { path: mode, grepMatches: 1, total_ms: 5 }, {
      query: 'validate request',
      regex: '\\bvalidate\\b',
      mode,
      format: 'agent',
      tokenBudget: 4000,
      codeGraphRepo: repo,
      locationMap: null,
      projectRoot: tmp,
      ...extra,
    });
    return { response, calls };
  }

  it('ss-find (pattern mode) has no neighbors and never queries the graph', () => {
    for (const format of ['agent', 'agent_preview', 'agent_full', 'agent_full_xl']) {
      const { response, calls } = pack('pattern', { format });
      expect(response.results[0].neighbors).toBeUndefined();
      expect(calls.outgoing).toBe(0);
      expect(calls.incoming).toBe(0);
      expect(renderAgentSearchResponse(response)).not.toContain('calls:');
    }
  });

  it('ss-search (non-pattern modes) still has the related rows', () => {
    for (const mode of ['hybrid', 'semantic', 'lexical']) {
      const { response, calls } = pack(mode);
      expect(response.results[0].neighbors?.count).toBeGreaterThanOrEqual(1);
      expect(calls.outgoing).toBeGreaterThan(0);
      const text = renderAgentSearchResponse(response);
      expect(text).toContain(RELATED_ROW);
      expect(text).not.toContain(RELATED_HEADER);
    }
  });

  it('ss-search prints the related rows as one compact line per kind, under the code, naming the subject', () => {
    const { response } = pack('hybrid');
    const top = response.results[0];
    const text = renderAgentSearchResponse(response);
    // After the code and entry 1's imports.
    expect(text).toContain("```\nimports of validation.js: const { kSchemaParams: paramsSchema } = require('./symbols')\n" + RELATED_ROW + '\n');
    expect(top.neighbors.rows).toEqual([expect.objectContaining({
      kind: 'calls', name: 'validateParam', file: 'lib/validation.js', startLine: 118, endLine: 144,
    })]);
    // The one-row-per-line form stays on the package (`neighbors.rendered`: JSON / MCP consumers).
    expect(top.neighbors.rendered).toBe('- calls validateParam → lib/validation.js:118-144 [function]');
  });

  it('does not reserve neighbour tokens in pattern mode', () => {
    const find = pack('pattern').response;
    const search = pack('hybrid').response;
    expect(search.results[0].neighbors.tokens).toBeGreaterThan(0);
    // Same code, same header: the only token difference is the neighbour tier.
    expect(find.results[0].code).toBe(search.results[0].code);
    expect(search.tokensUsed - find.tokensUsed).toBe(search.results[0].neighbors.tokens);
  });

  // Guard only: lower ranks never LOSE tokens when the tier is skipped. A strict
  // gain needs a pack that hits its budget (ranks 2-3 truncated by the remaining
  // budget); on 62 real r282 ss-find calls that happened once (+46 code tokens).
  it('pattern mode never gives lower ranks fewer tokens and stays within budget', () => {
    const rels = [0, 1, 2].map(n => write(`lib/f${n}.js`, [
      `function fn${n} () {`,
      ...Array.from({ length: 60 }, (_, l) => `  const v${l} = ${l} + ${n}`),
      '}',
    ].join('\n')));
    const ranked = rels.map((rel, n) => ({
      id: `r${n}`, file: rel, startLine: 1, endLine: 62,
      score: 1.0 - n * 0.01, lateInteractionScore: 1.0 - n * 0.01,
      metadata: { file: rel, name: `fn${n}`, type: 'function', startLine: 1, endLine: 62 },
    }));
    const repo = {
      findEnclosingEntity: (f) => ({
        id: `e_${f}`, name: 'fn', type: 'function', startLine: 1, endLine: 62, parentClass: null,
      }),
      getOutgoingRelationships: () => Array.from({ length: 16 }, (_, n) => ({
        type: 'calls', targetName: `callee${n}`, targetId: `c${n}`, contextLine: 2,
        target: { id: `c${n}`, name: `callee${n}`, type: 'function',
          filePath: `lib/callee${n}.js`, startLine: 1, endLine: 9 },
      })),
      getIncomingRelationships: () => [],
      getDbMtime: () => null,
      getFileIndexInfo: () => null,
    };
    const run = mode => packageForAgent(ranked, { path: mode, grepMatches: 3, total_ms: 5 }, {
      query: 'fn', regex: 'fn', mode, format: 'agent', tokenBudget: 1200,
      codeGraphRepo: repo, locationMap: null, projectRoot: tmp,
    });
    const find = run('pattern');
    const search = run('hybrid');
    const lowerCode = r => r.results.slice(1).reduce((a, x) => a + (x.codeTokens || 0), 0);
    expect(find.results.every(r => !r.neighbors)).toBe(true);
    expect(lowerCode(find)).toBeGreaterThanOrEqual(lowerCode(search));
    expect(find.tokensUsed).toBeLessThanOrEqual(1200);
  });
});
