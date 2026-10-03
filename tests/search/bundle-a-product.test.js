/**
 * Bundle A (A1, A2, A7, A4, A5) in the product: the shipped ss-* tools are
 * eval/agent-read-workflows/bin/ss-* (package.json "files"), and the daemon's agent text uses the
 * same renderer. What is pinned here:
 *   1. The wrappers and the daemon share one sufficiency fragment.
 *   2. The daemon's agent text (`sweet-search "<q>"` from an agent, renderAgentSearchResponse) is
 *      the ss-* compact renderer with the `sweet-search` tool name.
 *   3. (opt-in, SS_BUNDLE_A_FIXTURE=<indexed repo>) the real ss-grep regex repair on a real index.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  renderCompactHeader,
  renderCompactSufficiency,
  renderFixedBlocks,
  renderSufficiencyFragment,
  selectEntries,
} from '../../core/search/agent-output-fixes.js';
import { renderSufficiency } from '../../eval/agent-read-workflows/bin/_ss-argparse.mjs';
import { renderAgentSearchResponse } from '../../core/search/search-server.js';
import { lineGutterEnabled, numberCodeLines } from '../../core/search/search-read.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
describe('sufficiency fragment', () => {
  it('the wrappers and the daemon share one sufficiency fragment', () => {
    for (const r of [fixtureResponse(), { sufficient: true }, { sufficient: false }, { sufficiencyVerdict: 'unknown' }]) {
      expect(renderSufficiency(r)).toBe(renderSufficiencyFragment(r));
    }
  });
});

// ---- 2. daemon agent text ---------------------------------------------------------------------
describe('daemon agent text (native `sweet-search` from an agent)', () => {
  it('uses the ss-search compact renderer (header renamed, same body)', () => {
    const resp = fixtureResponse();
    const gutter = (code, start) => ((lineGutterEnabled() && String(code).split('\n').length >= 15) ? numberCodeLines(code, start || 1) : code);
    // What the ss-search wrapper prints (header + sufficiency + blocks), with the daemon's own
    // gutter rule. The route trailer is bench instrumentation (stderr) and not part of it.
    const plan = selectEntries(resp.results);
    const wrapperShape = renderCompactHeader('ss-search', plan.entries.length, resp.query)
      + renderCompactSufficiency(resp, renderSufficiency(resp))
      + renderFixedBlocks(resp.results, plan, { gutter });
    const text = renderAgentSearchResponse(resp);
    expect(text).toBe(wrapperShape.replace(/^# ss-search:/, '# sweet-search:'));
  });

  it('drops the A1 metadata and keeps one header plus the compact sufficient=YES line', () => {
    const text = renderAgentSearchResponse(fixtureResponse());
    // 5 results in, 2 covered summaries dropped by A2: the header counts the 3 printed entries.
    expect(text.startsWith('# sweet-search: 3 results for "where are tokens validated"\n# sufficient=YES\n')).toBe(true);
    for (const gone of ['score=', 'routed=', 'budget=', 'subMode=', '# confidence', 'kind=sandwich', '(full', '(summary']) {
      expect(text).not.toContain(gone);
    }
    // A2: summary entries on one line; the covered and the identical-span summaries are gone.
    expect(text).toContain('src/token.js:10-30 Token (class)\n');
    expect(text).not.toContain('inner');
    expect(text).not.toContain('Token holds the claims');
    expect(text).toContain('src/claims.js:3 CLAIMS (const) STALE\nThe list of required claims.\n');
    // A7: the import line already in the code is cut from the imports block.
    expect(text).toContain("### imports\n```\n'use strict'\n```\n");
    // Everything else stays.
    expect(text).toContain('# same file: helper');
    expect(text).toContain('# continues: src/auth.js:20-24 helper\n```\nfunction helper() {}\n```\n');
  });

  it('keeps a summary whose lines the code block above elided (A2 covers only printed lines)', () => {
    const resp = fixtureResponse();
    resp.results[0] = { ...resp.results[0], sandwich: { ...resp.results[0].sandwich, elidedHead: 2 } };
    expect(renderAgentSearchResponse(resp)).toContain('src/auth.js:4-6 inner (function)\n');
  });

  it('prints no sufficient line unless the verdict is YES, and (no matches) on zero results', () => {
    expect(renderAgentSearchResponse(fixtureResponse({ sufficiencyVerdict: 'no' }))).not.toContain('sufficient');
    expect(renderAgentSearchResponse(fixtureResponse({ results: [] })))
      .toBe('# sweet-search: 0 results for "where are tokens validated"\n# sufficient=YES\n(no matches)\n');
  });
});

// ---- 3. real wrapper on a real index (opt-in) ------------------------------------------------
const FIXTURE = process.env.SS_BUNDLE_A_FIXTURE || '';
const fixtureReady = !!FIXTURE && existsSync(path.join(FIXTURE, '.sweet-search', 'codebase.db'));

describe.skipIf(!fixtureReady)('real ss-grep on an indexed fixture (SS_BUNDLE_A_FIXTURE)', () => {
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
    for (const k of Object.keys(env)) if (k.startsWith('SS_FIX_') || k.startsWith('SS_VARIANT_')) delete env[k];
    return env;
  };
  const run = (tool, args, extra = {}) => {
    const r = spawnSync(path.join(BIN, tool), args, { cwd: FIXTURE, env: { ...baseEnv(), ...extra }, encoding: 'utf8', timeout: 180000 });
    return { rc: r.status, out: String(r.stdout).replace(/latency=\d+ms/g, 'latency=Nms').replace(/"latencyMs":\d+/g, '"latencyMs":N') };
  };
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
