/**
 * Bundle A (A1, A2, A7, A4, A5) in the PRODUCT, default on.
 *
 * The shipped ss-* tools are eval/agent-read-workflows/bin/ss-* (package.json "files"), so the
 * product default and the bench switch go through the same wrapper code and the same renderer.
 * What is pinned here:
 *   1. Flags: the product default selects exactly what SS_FIX_A=1 selects; SWEET_SEARCH_COMPACT_OUTPUT=0 selects exactly what SS_FIX_A=0 selects (all
 *      off, the original code paths, which agent-output-fixes-wiring.test.js pins byte for byte
 *      against verbatim copies of the original loops).
 *   2. The daemon's agent text (`sweet-search "<q>"` from an agent, renderAgentSearchResponse):
 *      opt-out = a verbatim copy of the previous renderer; default = the ss-* compact renderer.
 *   3. (opt-in, SS_BUNDLE_A_FIXTURE=<indexed repo>) the real wrapper on a real index: default
 *      output == SS_FIX_A=1 output, and SWEET_SEARCH_COMPACT_OUTPUT=0 output == SS_FIX_A=0 output,
 *      for ss-search, ss-find, ss-grep (regex error and zero-hit case included) and ss-trace.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  readFixFlags,
  renderCompactSufficiency,
  renderFixedBlocks,
  renderSufficiencyFragment,
  selectEntries,
} from '../../core/search/agent-output-fixes.js';
import { renderSufficiency } from '../../eval/agent-read-workflows/bin/_ss-argparse.mjs';
import { renderAgentSearchResponse } from '../../core/search/search-server.js';
import { renderRegexDialectHint } from '../../core/search/regex-dialect.js';
import { lineGutterEnabled, numberCodeLines } from '../../core/search/search-read.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---- verbatim copy of renderAgentSearchResponse before Bundle A (origin/main 52999acf) ---------
function previousRenderAgentSearchResponse(response) {
  const results = response?.results || [];
  const routing = response?.stats?.routing || {};
  const routedMode = routing.mode || response?.mode || 'auto';
  let out = `# sweet-search: routed=${routedMode} budget=${response?.tokenBudget ?? '?'} used=${response?.tokensUsed ?? '?'} results=${results.length} subMode=${response?.subMode ?? 'agent'}\n`;
  if (response?.confidence) {
    out += `# confidence=${response.confidence}${response.confidenceReason ? ` (${response.confidenceReason})` : ''}`;
    if (response.sufficiencyVerdict) out += ` sufficient=${response.sufficiencyVerdict}`;
    out += '\n';
  }
  for (const result of results) {
    const symbol = result.symbol ? ` [${result.symbolType || 'code'}: ${result.symbol}]` : '';
    const kind = result.expansionKind ? ` kind=${result.expansionKind}` : '';
    const stale = result.stale ? ' STALE' : '';
    out += `\n## #${result.rank} ${result.file}:${result.startLine}-${result.endLine}${symbol} (${result.presentation}${kind}${stale}) score=${(result.score || 0).toFixed(3)}\n`;
    if (result.headerContext) out += `### imports\n\`\`\`\n${result.headerContext}\n\`\`\`\n`;
    if (result.code) {
      const body = (lineGutterEnabled() && String(result.code).split('\n').length >= 15)
        ? numberCodeLines(result.code, result.startLine || 1)
        : result.code;
      out += `\`\`\`\n${body}\n\`\`\`\n`;
    } else if (result.summary) out += `${result.summary}\n`;
    if (result.neighbors?.rendered) {
      out += `### related (1-hop graph, ~${result.neighbors.tokens} tok)\n${result.neighbors.rendered}\n`;
    }
    if (result.sameFile?.rendered) out += `${result.sameFile.rendered}\n`;
    if (result.siblingLine?.rendered) out += `${result.siblingLine.rendered}\n`;
    if (result.continuation?.rendered) {
      out += `${result.continuation.rendered}\n`;
      if (result.continuation.kind === 'symbol' && result.continuation.code) {
        out += `\`\`\`\n${result.continuation.code}\n\`\`\`\n`;
      }
    }
    if (result.familyManifest?.rendered) out += `${result.familyManifest.rendered}\n`;
  }
  if (results.length === 0) out += '(no matches)\n';
  const regexDialectNote = renderRegexDialectHint(response?.stats?.regexDialectHint);
  if (regexDialectNote) out += `${regexDialectNote}\n`;
  return out;
}

const longCode = Array.from({ length: 18 }, (_, i) => (i === 0 ? "import { a } from './a'" : `  line ${i}`)).join('\n');

function fixtureResponse(overrides = {}) {
  return {
    query: 'where are tokens validated',
    mode: 'hybrid', tokenBudget: 3000, tokensUsed: 812, subMode: 'agent_preview',
    confidence: 'high', confidenceReason: 'clear_margin',
    sufficiencyVerdict: 'yes', sufficiencyReason: 'query_evidence_clear_margin',
    stats: { routing: { mode: 'hybrid', confidence: 0.91 } },
    results: [
      {
        rank: 1, file: 'src/auth.js', startLine: 1, endLine: 18, symbol: 'validate', symbolType: 'function',
        presentation: 'full', expansionKind: 'sandwich', score: 0.91234,
        sandwich: { partKinds: ['signature', 'gold'], elidedHead: 0, elidedTail: 0, elisionMarkers: 0 },
        headerContext: "'use strict'\nimport { a } from './a'",
        code: longCode,
        sameFile: { rendered: '# same file: helper (fn 30-40 below) — ss-read src/auth.js 30 40' },
        continuation: { kind: 'symbol', rendered: '# continues: src/auth.js:20-24 helper', code: 'function helper() {}' },
      },
      // Summary inside the code entry above (every line of it printed): dropped (A2).
      { rank: 2, file: 'src/auth.js', startLine: 4, endLine: 6, symbol: 'inner', symbolType: 'function', presentation: 'summary', score: 0.5, summary: 'src/auth.js:4 — inner (function)' },
      // Stand-alone summary: one line (A2); the summary text restates the header, so it is not repeated.
      { rank: 3, file: 'src/token.js', startLine: 10, endLine: 30, symbol: 'Token', symbolType: 'class', presentation: 'summary', score: 0.4, summary: 'src/token.js:10 — Token (class)' },
      // Identical span to rank 3: dropped (A2).
      { rank: 4, file: 'src/token.js', startLine: 10, endLine: 30, symbol: 'Token', symbolType: 'class', presentation: 'summary', score: 0.3, summary: 'Token holds the claims' },
      // Summary with real text: one line plus the text.
      { rank: 5, file: 'src/claims.js', startLine: 3, endLine: 3, symbol: 'CLAIMS', symbolType: 'const', presentation: 'summary', score: 0.2, summary: 'The list of required claims.', stale: true },
    ],
    ...overrides,
  };
}

// ---- 1. flags ---------------------------------------------------------------------------------
describe('product default vs bench switch (flags)', () => {
  it('default == SS_FIX_A=1 for every switch (ss-search, ss-find, ss-grep, ss-trace)', () => {
    expect(readFixFlags({})).toEqual(readFixFlags({ SS_FIX_A: '1' }));
  });
  it('SWEET_SEARCH_COMPACT_OUTPUT=0 == SS_FIX_A=0 (every switch off: the previous code paths)', () => {
    expect(readFixFlags({ SWEET_SEARCH_COMPACT_OUTPUT: '0' })).toEqual(readFixFlags({ SS_FIX_A: '0' }));
    expect(Object.values(readFixFlags({ SWEET_SEARCH_COMPACT_OUTPUT: '0' })).every((v) => v === false || v === null)).toBe(true);
  });
  it('the wrappers and the daemon share one sufficiency fragment', () => {
    for (const r of [fixtureResponse(), { sufficient: true }, { sufficient: false }, { sufficiencyVerdict: 'unknown' }]) {
      expect(renderSufficiency(r)).toBe(renderSufficiencyFragment(r));
    }
  });
});

// ---- 2. daemon agent text ---------------------------------------------------------------------
describe('daemon agent text (native `sweet-search` from an agent)', () => {
  it('opt-out reproduces the previous renderer byte for byte', () => {
    for (const resp of [
      fixtureResponse(),
      fixtureResponse({ results: [] }),
      fixtureResponse({ confidence: null }),
      fixtureResponse({ stats: { regexDialectHint: { kind: 'lookaround' } } }),
    ]) {
      expect(renderAgentSearchResponse(resp, { compact: false })).toBe(previousRenderAgentSearchResponse(resp));
    }
  });

  it('the daemon env reaches the renderer default, with the ss-* precedence (SS_FIX_A first)', () => {
    const keys = ['SWEET_SEARCH_COMPACT_OUTPUT', 'SS_FIX_A'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const setEnv = (vals) => { for (const k of keys) { if (vals[k] === undefined) delete process.env[k]; else process.env[k] = vals[k]; } };
    const legacy = previousRenderAgentSearchResponse(fixtureResponse());
    const compact = renderAgentSearchResponse(fixtureResponse(), { compact: true });
    try {
      setEnv({ SWEET_SEARCH_COMPACT_OUTPUT: '0' });
      expect(renderAgentSearchResponse(fixtureResponse())).toBe(legacy);
      setEnv({});
      expect(renderAgentSearchResponse(fixtureResponse())).toBe(compact);
      // A legacy bench arm (SS_FIX_A=0) gets the previous text from the daemon too, not only from
      // the ss-* wrappers; an explicit SS_FIX_A=1 wins over the product opt-out.
      setEnv({ SS_FIX_A: '0' });
      expect(renderAgentSearchResponse(fixtureResponse())).toBe(legacy);
      setEnv({ SS_FIX_A: '1', SWEET_SEARCH_COMPACT_OUTPUT: '0' });
      expect(renderAgentSearchResponse(fixtureResponse())).toBe(compact);
    } finally {
      setEnv(prev);
    }
  });

  it('default uses the ss-search compact renderer (same text: no query header in either)', () => {
    const resp = fixtureResponse();
    const gutter = (code, start) => ((lineGutterEnabled() && String(code).split('\n').length >= 15) ? numberCodeLines(code, start || 1) : code);
    // What the ss-search wrapper prints under SS_FIX_A=1 (sufficiency + blocks), with the
    // daemon's own gutter rule. The route trailer is bench instrumentation (stderr) and not part of it.
    const plan = selectEntries(resp.results, { dedupe: 'a2', k: 5 });
    const wrapperShape = renderCompactSufficiency(resp, renderSufficiency(resp))
      + renderFixedBlocks(resp.results, plan, { compact: true, gutter });
    expect(renderAgentSearchResponse(resp, { compact: true })).toBe(wrapperShape);
  });

  it('no query header, no metadata, results grouped by file, the compact sufficient=YES line', () => {
    const text = renderAgentSearchResponse(fixtureResponse(), { compact: true });
    expect(text.startsWith('# sufficient=YES\nsrc/auth.js\n## 1-18 validate\n')).toBe(true);
    for (const gone of ['score=', 'routed=', 'budget=', 'subMode=', '# confidence', 'kind=sandwich', '(full', '(summary', 'results for', '## #']) {
      expect(text).not.toContain(gone);
    }
    // A2: summary rows under their file; the covered and the identical-span summaries are gone.
    expect(text).toContain('\nsrc/token.js\n10-30 Token (class)\n');
    expect(text).not.toContain('inner');
    expect(text).not.toContain('Token holds the claims');
    expect(text).toContain('\nsrc/claims.js\n3 CLAIMS STALE\nThe list of required claims.\n');
    // A7: the import line already in the code is cut from the imports block.
    expect(text).toContain("### imports\n```\n'use strict'\n```\n");
    // Everything else stays.
    expect(text).toContain('# same file: helper');
    expect(text).toContain('# continues: src/auth.js:20-24 helper\n```\nfunction helper() {}\n```\n');
  });

  it('keeps a summary whose lines the code block above elided (A2 covers only printed lines)', () => {
    const resp = fixtureResponse();
    resp.results[0] = { ...resp.results[0], sandwich: { ...resp.results[0].sandwich, elidedHead: 2 } };
    expect(renderAgentSearchResponse(resp, { compact: true })).toContain('\n4-6 inner\n');
  });

  it('prints no sufficient line unless the verdict is YES, and exactly (no results) on zero results', () => {
    expect(renderAgentSearchResponse(fixtureResponse({ sufficiencyVerdict: 'no' }), { compact: true })).not.toContain('sufficient');
    expect(renderAgentSearchResponse(fixtureResponse({ results: [] }), { compact: true })).toBe('(no results)\n');
  });
});

// ---- 3. real wrapper on a real index (opt-in) ------------------------------------------------
const FIXTURE = process.env.SS_BUNDLE_A_FIXTURE || '';
const fixtureReady = !!FIXTURE && existsSync(path.join(FIXTURE, '.sweet-search', 'codebase.db'));

describe.skipIf(!fixtureReady)('real ss-* wrappers on an indexed fixture (SS_BUNDLE_A_FIXTURE)', () => {
  const BIN = path.join(REPO_ROOT, 'eval', 'agent-read-workflows', 'bin');
  const runtime = fixtureReady ? mkdtempSync(path.join(tmpdir(), 'ss-bundle-a-rt-')) : '';
  // The daemon socket and pidfile are keyed by the PROJECT ROOT, not by the runtime dir: with the
  // default paths this test would reuse (and its last step stop) a daemon another session runs on
  // the same fixture. A private socket and pidfile make the daemon this test's own.
  const baseEnv = () => {
    const env = {
      ...process.env,
      SWEET_SEARCH_PROJECT_ROOT: FIXTURE,
      SWEET_SEARCH_RUNTIME_DIR: runtime,
      SWEET_SEARCH_SOCKET_PATH: path.join(runtime, 'd.sock'),
      SWEET_SEARCH_PID_FILE: path.join(runtime, 'd.pid'),
    };
    for (const k of Object.keys(env)) if (k.startsWith('SS_FIX_') || k === 'SWEET_SEARCH_COMPACT_OUTPUT') delete env[k];
    return env;
  };
  const run = (tool, args, extra = {}) => {
    const r = spawnSync(path.join(BIN, tool), args, { cwd: FIXTURE, env: { ...baseEnv(), ...extra }, encoding: 'utf8', timeout: 180000 });
    return { rc: r.status, out: String(r.stdout).replace(/latency=\d+ms/g, 'latency=Nms').replace(/"latencyMs":\d+/g, '"latencyMs":N') };
  };
  const CALLS = [
    ['ss-search', ['how is the request routed']],
    ['ss-find', ['error handling', '--regex', 'function.*rror']],
    ['ss-grep', ['module.exports']],
    ['ss-grep', ['send(']],             // regex error → A5 repair
    ['ss-grep', ['ROUTER']],            // zero case-sensitive hits → A5 case-insensitive retry
    ['ss-grep', ['ZZQQnothingQQZZ']],   // real zero hit
    ['ss-grep', ['functio\\(n)']],      // repair whose literal is absent (A5 literal safety)
    ['ss-trace', ['handle']],
    ['ss-trace', ['render', 'callers']],
  ];

  it.each(CALLS)('%s %j: default == SS_FIX_A=1; opt-out == SS_FIX_A=0', (tool, args) => {
    const product = run(tool, args);
    const bench = run(tool, args, { SS_FIX_A: '1' });
    expect(product).toEqual(bench);
    const optOut = run(tool, args, { SWEET_SEARCH_COMPACT_OUTPUT: '0' });
    const benchOff = run(tool, args, { SS_FIX_A: '0' });
    expect(optOut).toEqual(benchOff);
  }, 600000);

  it('a repaired pattern whose literal text is absent prints zero hits, never a GNU-retry flood', () => {
    // `functio\(n)` was repaired to `functio\(n\)`, which the engine's zero-hit GNU retry searched
    // as `functio(n)`: every `function`, under "searched it as literal text".
    const { out } = run('ss-grep', ['functio\\(n)']);
    expect(out).toMatch(/^# ss-grep: 0 total match\(es\)/);
    expect(out).toContain('(no matches — note: the regex did not parse as written');
  }, 600000);

  it('stops only the daemon this test started', () => {
    spawnSync(process.execPath, [path.join(REPO_ROOT, 'core', 'cli.js'), '--stop'], { cwd: FIXTURE, env: baseEnv(), timeout: 30000 });
    try { rmSync(runtime, { recursive: true, force: true }); } catch { /* best effort */ }
  }, 60000);
});
