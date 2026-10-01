/**
 * Wiring of the ss-* output fixes (eval/agent-read-workflows/bin/_ss-helpers.mjs).
 *
 * The wrapper cannot be imported (it runs on import and needs a warm daemon), so the parts it
 * wires are tested here through the same functions it calls:
 *   - the fixed renderer, against VERBATIM copies of the original ss-search / ss-find loops
 *     (non-compact mode must print the original bytes);
 *   - the A3 ledger protocol, through the real client payload builder and the real daemon
 *     handler (buildAgentSpanDaemonResponse), with the same call order as the wrapper;
 *   - the A5 regex repair, A7 imports dedupe, the compact sufficiency line, the A4 alternatives.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ALREADY_SHOWN_MAX_RECORD_CHARS,
  ALREADY_SHOWN_WINDOW_CALLS,
  alreadyShownSessionId,
  alternativesAfterSwitch,
  decideAlreadyShown,
  dedupeImports,
  printedSpanCandidates,
  readFixFlags,
  readSpansForAlreadyShown,
  renderAlreadyShownLine,
  renderCompactSufficiency,
  renderFixedBlocks,
  repairRegexBranches,
  resultsForOriginalLedger,
  rustRegexLooksValid,
  selectEntries,
  splitTopLevelAlternation,
} from '../../core/search/agent-output-fixes.js';
import {
  AgentSpanLedger,
  collectAgentShownSpans,
  collectReadShownSpans,
  renderReadOmission,
} from '../../core/search/agent-span-ledger.js';
import { buildAgentSpanRequestPayload } from '../../core/search/agent-span-client.js';
import { buildAgentSpanDaemonResponse } from '../../core/search/search-server.js';

const ROOT = '/repo';
const gutter = (code, startLine) => code.split('\n').map((l, i) => `${startLine + i}\t${l}`).join('\n');

// ---- verbatim copies of the original loops (final-tuning, switches off) ------------------

function originalSearchLoop(results, { DEDUPE = false } = {}) {
  let out = '';
  const w = (t) => { out += t; };
  const seenSpans = [];
  for (const r of results || []) {
    if (DEDUPE) {
      const covered = seenSpans.some(x => x.file === r.file && ((r.startLine >= x.start && r.endLine <= x.end) || (r.symbol && x.symbol === r.symbol)));
      seenSpans.push({ file: r.file, start: r.startLine, end: r.endLine, symbol: r.symbol || null });
      if (covered && r.presentation === 'summary') continue;
    }
    const sym = r.symbol ? ` [${r.symbolType || 'code'}: ${r.symbol}]` : '';
    const kind = r.expansionKind ? ` kind=${r.expansionKind}` : '';
    const stale = r.stale ? ' STALE' : '';
    w(`\n## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym} (${r.presentation}${kind}${stale}) score=${(r.score || 0).toFixed(3)}\n`);
    if (r.headerContext) w(`### imports\n\`\`\`\n${r.headerContext}\n\`\`\`\n`);
    if (r.code) {
      w(`\`\`\`\n${gutter(r.code, r.startLine)}\n\`\`\`\n`);
    } else if (r.summary && !(DEDUPE && /^\S+:\d+ — .+ \([^)]*\)$/.test(String(r.summary).trim()))) {
      w(`${r.summary}\n`);
    }
    if (r.neighbors && r.neighbors.rendered) w(`### related (1-hop graph, ~${r.neighbors.tokens} tok)\n${r.neighbors.rendered}\n`);
    if (r.sameFile && r.sameFile.rendered) w(`${r.sameFile.rendered}\n`);
    if (r.siblingLine?.rendered) w(`${r.siblingLine.rendered}\n`);
    if (r.continuation?.rendered) {
      w(`${r.continuation.rendered}\n`);
      if (r.continuation.kind === 'symbol' && r.continuation.code) w(`\`\`\`\n${r.continuation.code}\n\`\`\`\n`);
    }
    if (r.familyManifest?.rendered) w(`${r.familyManifest.rendered}\n`);
  }
  if (!results || results.length === 0) w('(no matches)\n');
  return out;
}

function originalFindLoop(results) {
  let out = '';
  const w = (t) => { out += t; };
  for (const r of results || []) {
    const sym = r.symbol ? ` [${r.symbolType || 'code'}: ${r.symbol}]` : '';
    const kind = r.expansionKind ? ` kind=${r.expansionKind}` : '';
    const stale = r.stale ? ' STALE' : '';
    w(`\n## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym} (${r.presentation}${kind}${stale}) score=${(r.score || 0).toFixed(3)}\n`);
    if (r.headerContext) w(`### imports\n\`\`\`\n${r.headerContext}\n\`\`\`\n`);
    if (r.code) w(`\`\`\`\n${gutter(r.code, r.startLine)}\n\`\`\`\n`);
    else if (r.summary) w(`${r.summary}\n`);
    if (r.neighbors && r.neighbors.rendered) w(`### related (1-hop graph, ~${r.neighbors.tokens} tok)\n${r.neighbors.rendered}\n`);
    if (r.sameFile && r.sameFile.rendered) w(`${r.sameFile.rendered}\n`);
    if (r.siblingLine?.rendered) w(`${r.siblingLine.rendered}\n`);
    if (r.continuation?.rendered) {
      w(`${r.continuation.rendered}\n`);
      if (r.continuation.kind === 'symbol' && r.continuation.code) w(`\`\`\`\n${r.continuation.code}\n\`\`\`\n`);
    }
    if (r.familyManifest?.rendered) w(`${r.familyManifest.rendered}\n`);
  }
  if (!results || results.length === 0) w('(no matches)\n');
  return out;
}

// The wrapper's plan (planFixedResults) for given switches.
function plan(results, flags, { k = 5, find = false, DEDUPE = false } = {}) {
  return selectEntries(results, {
    dedupe: flags.compact ? 'a2' : (DEDUPE && !find ? 'v3' : false),
    onePerFile: !find && flags.onePerFile,
    summaryCap: flags.summaryCap,
    k,
  });
}

const lines = (from, n) => Array.from({ length: n }, (_, i) => `line ${from + i}`).join('\n');

function fixture() {
  return [
    {
      rank: 1, file: 'a.go', startLine: 1, endLine: 6, symbol: 'Run', symbolType: 'function',
      presentation: 'full', expansionKind: 'full', score: 0.91, code: 'package a\nimport "fmt"\nfunc Run() {\n  fmt.Println()\n  x()\n}',
      headerContext: 'package a\nimport "fmt"',
      neighbors: { rendered: 'x() b.go:3', tokens: 12 },
      sameFile: { rendered: 'same file: Stop (l.40)' },
      siblingLine: { rendered: 'siblings: RunAll' },
      continuation: { rendered: '# continues at b.go:3-8', kind: 'symbol', file: 'b.go', startLine: 3, endLine: 8, code: lines(3, 6) },
      familyManifest: { rendered: 'family: Run, RunAll' },
    },
    { rank: 2, file: 'a.go', startLine: 2, endLine: 4, symbol: 'Run', symbolType: 'function', presentation: 'summary', score: 0.5, summary: 'a.go:2 — Run (function)', stale: true },
    { rank: 3, file: 'c.go', startLine: 10, endLine: 20, symbol: 'Other', symbolType: 'method', presentation: 'summary', score: 0.4, summary: 'c.go:10 handles other things' },
    { rank: 4, file: 'd.go', startLine: 5, endLine: 9, symbol: 'Prev', symbolType: 'function', presentation: 'preview', expansionKind: 'window', score: 0.3, code: 'prev\n...' },
  ];
}

describe('fixed renderer, non-compact (A3 alone, B switches): the original bytes', () => {
  const none = readFixFlags({ SS_FIX_A: '0' });
  it('ss-find: identical to the original loop', () => {
    for (const results of [fixture(), [], fixture().slice(1)]) {
      const p = plan(results, none, { find: true, k: 6 });
      expect(renderFixedBlocks(results, p, { compact: false, gutter })).toBe(originalFindLoop(results));
    }
  });

  it('ss-search: identical to the original loop, with and without SS_VARIANT_SEARCH_DEDUPE', () => {
    for (const DEDUPE of [false, true]) {
      for (const results of [fixture(), [], fixture().slice(1)]) {
        const p = plan(results, none, { DEDUPE });
        expect(renderFixedBlocks(results, p, { compact: false, dropRestatingSummary: DEDUPE, gutter }))
          .toBe(originalSearchLoop(results, { DEDUPE }));
      }
    }
  });

  it('ss-find ignores SS_VARIANT_SEARCH_DEDUPE (2.8.2 line restored in fff75887)', () => {
    const results = fixture();
    const p = plan(results, none, { find: true, DEDUPE: true });
    expect(renderFixedBlocks(results, p, { compact: false, dropRestatingSummary: false, gutter })).toBe(originalFindLoop(results));
  });

  it('an A3 omission changes only the omitted code block', () => {
    const results = fixture();
    const p = plan(results, none, { find: true });
    const out = renderFixedBlocks(results, p, { compact: false, omitted: new Set(['0:result']), gutter });
    expect(out).toBe(originalFindLoop(results).replace(
      `\`\`\`\n${gutter(results[0].code, 1)}\n\`\`\`\n`,
      '(lines 1-6 already shown above — re-read: ss-read a.go 1 6)\n'));
  });
});

describe('fixed renderer, compact (SS_FIX_A)', () => {
  const a = readFixFlags({ SS_FIX_A: '1' });
  it('A1 headers, A2 one-line summaries and dedupe, A7 imports dedupe', () => {
    const results = fixture();
    const out = renderFixedBlocks(results, plan(results, a), { compact: true, gutter });
    expect(out.startsWith('## #1 a.go:1-6 [function: Run]\n')).toBe(true);
    expect(out).not.toContain('score=');
    expect(out).not.toContain('(full');
    // A7: the imports are the first lines of the code block: no imports block.
    expect(out).not.toContain('### imports');
    // A2: rank 2 is inside rank 1's code: dropped. Rank 3 keeps its extra text on line 2.
    expect(out).not.toContain('a.go:2-4');
    expect(out).toContain('\nc.go:10-20 Other (method)\nc.go:10 handles other things\n');
    expect(out).toContain('## #4 d.go:5-9 [function: Prev]\n');
  });

  it('A3 line names the continuation file and the re-read command', () => {
    const results = fixture();
    const out = renderFixedBlocks(results, plan(results, a), { compact: true, omitted: new Set(['0:continuation']), gutter });
    expect(out).toContain('# continues at b.go:3-8\n(lines 3-8 already shown above — re-read: ss-read b.go 3 8)\n');
    expect(renderAlreadyShownLine('dir with space/x.go', 1, 2)).toBe('(lines 1-2 already shown above — re-read: ss-read "dir with space/x.go" 1 2)');
  });

  it('keeps the imports block when the code is omitted or does not show it', () => {
    const results = fixture();
    const omitted = renderFixedBlocks(results, plan(results, a), { compact: true, omitted: new Set(['0:result']), gutter });
    expect(omitted).toContain('### imports\n```\npackage a\nimport "fmt"\n```\n');
  });
});

describe('dedupeImports (A7)', () => {
  it('drops the block when the code shows all of it, cuts a shared tail, and never edits the middle', () => {
    expect(dedupeImports('package a\nimport "fmt"', 'package a\nimport "fmt"\n\nfunc A() {}')).toBe('');
    expect(dedupeImports('import os\nimport sys\nimport re', 'import re\ndef f(): pass')).toBe('import os\nimport sys');
    const partial = 'import (\n  "fmt"\n  "os"\n)';
    expect(dedupeImports(partial, 'func A() {\n  "os"\n}')).toBe(partial);
    expect(dedupeImports('import a', 'x = 1')).toBe('import a');
    // A shared tail made only of punctuation is not a reason to cut.
    expect(dedupeImports('import (\n  "fmt"\n)', ')\nfunc A() {}')).toBe('import (\n  "fmt"\n)');
  });
});

describe('compact sufficiency line (A1, owner decision)', () => {
  it('prints only YES, only with a confidence verdict, and SS_FIX_DROP_SUFFICIENCY removes it', () => {
    expect(renderCompactSufficiency({ confidence: 'high' }, ' sufficient=YES (margin)')).toBe('# sufficient=YES\n');
    expect(renderCompactSufficiency({ confidence: 'low' }, ' sufficient=unknown (x)')).toBe('');
    expect(renderCompactSufficiency({ confidence: 'low' }, ' sufficient=no')).toBe('');
    expect(renderCompactSufficiency({}, ' sufficient=YES')).toBe('');
    expect(renderCompactSufficiency({ confidence: 'high' }, ' sufficient=YES', { drop: true })).toBe('');
  });
});

// ---- A3 ledger protocol through the real client + daemon handler ----------------------

function daemon() {
  const ledger = new AgentSpanLedger();
  const send = async (input) => {
    const payload = buildAgentSpanRequestPayload(input);
    if (!payload) return null;
    const r = buildAgentSpanDaemonResponse(payload, { isUnixSocket: true, ledger });
    return r.status === 200 ? JSON.parse(r.body) : null;
  };
  return { ledger, send };
}

function codeResult(file, startLine, n, rank = 1, extra = {}) {
  return { rank, file, startLine, endLine: startLine + n - 1, presentation: 'full', code: lines(startLine, n), symbol: `S${startLine}`, ...extra };
}

/**
 * One ss-search / ss-find call, in the wrapper's order: plan → ORIGINAL observe (unchanged call,
 * spans of resultsForOriginalLedger) → A3 decision (own namespace). Returns the rendered blocks.
 */
async function searchCall(d, results, { flags, originalSession = null, threadKey = null, find = false, query = 'q' }) {
  const a3Session = flags.alreadyShown ? alreadyShownSessionId(threadKey) : null;
  const renderFix = flags.compact || flags.summaryCap != null || (!find && flags.onePerFile) || !!a3Session;
  const p = renderFix ? plan(results, flags, { find }) : null;
  const shownSpans = collectAgentShownSpans(resultsForOriginalLedger(results, p), { projectRoot: ROOT });
  if (originalSession) await d.send({ operation: 'observe', spans: shownSpans, sessionId: originalSession, query });
  const omitted = a3Session
    ? await decideAlreadyShown({ send: d.send, sessionId: a3Session, candidates: printedSpanCandidates(results, p, { projectRoot: ROOT }) })
    : new Set();
  return renderFix ? renderFixedBlocks(results, p, { compact: flags.compact, omitted, gutter }) : originalSearchLoop(results);
}

/** One ss-read call, in the wrapper's order; returns what ss-read prints (omission or body). */
async function readCall(d, file, startLine, n, { flags, originalSession = null, threadKey = null }) {
  const r = { ok: true, file, text: lines(startLine, n), range: { startLine, endLine: startLine + n - 1 } };
  const batch = { files: [r] };
  const spans = collectReadShownSpans(batch, { projectRoot: ROOT });
  const resp = originalSession ? await d.send({ operation: 'read', spans, sessionId: originalSession }) : null;
  if (resp?.ok) {
    resp.decisions.forEach((dec, i) => {
      if (dec?.omit) batch.files[i].omitted = { ...dec.previous, callsAgo: dec.callsAgo };
    });
  }
  const printed = renderReadOmission(batch.files[0], { surface: 'ss-read' }) || `BODY ${file}:${startLine}`;
  const a3Session = flags.alreadyShown ? alreadyShownSessionId(threadKey) : null;
  if (a3Session) {
    await d.send({ operation: 'observe', spans: readSpansForAlreadyShown(spans, resp?.decisions, printed.length), sessionId: a3Session });
  }
  return { printed, queryEvidence: resp?.queryEvidence ?? null };
}

describe('A3 ledger wiring', () => {
  const off = readFixFlags({ SS_FIX_A: '0' });
  const a3 = readFixFlags({ SS_FIX_A: '0', SS_FIX_ALREADY_SHOWN: '1' });
  const a3b2 = readFixFlags({ SS_FIX_A: '0', SS_FIX_ALREADY_SHOWN: '1', SS_FIX_ONE_PER_FILE: '1' });
  const block = () => [codeResult('a.go', 10, 31)];

  it('uses its own namespace, never the original session id', () => {
    expect(alreadyShownSessionId('thr-1')).toBe('a3:thr-1');
    expect(alreadyShownSessionId(null)).toBeNull();
    expect(alreadyShownSessionId('x'.repeat(255))).toBeNull(); // would exceed the 256-char id limit
  });

  it('M1: Codex ss-read prints byte-identical text with A3 on and off', async () => {
    const run = async (flags) => {
      const d = daemon();
      const opts = { flags, originalSession: 'thr-1', threadKey: 'thr-1' };
      await searchCall(d, block(), opts);                    // ss-search shows a.go:10-40
      await searchCall(d, block(), { ...opts, find: true }); // ss-find, same block
      return readCall(d, 'a.go', 10, 31, opts);              // ss-read a.go 10 40
    };
    const before = await run(off);
    const after = await run(a3);
    expect(after).toEqual(before);
    expect(before.printed).toContain('already shown 1 sweet-search call ago');
  });

  it('M1: the find call that A3 omits still refreshes the ORIGINAL ledger as before', async () => {
    const d = daemon();
    const opts = { flags: a3, originalSession: 'thr-1', threadKey: 'thr-1' };
    await searchCall(d, block(), opts);
    const find = await searchCall(d, block(), { ...opts, find: true });
    expect(find).toContain('(lines 10-40 already shown above — re-read: ss-read a.go 10 40)');
    expect(d.ledger.sessions.get('thr-1').call).toBe(2);
    expect(d.ledger.sessions.get('a3:thr-1').call).toBe(2);
  });

  it('H2: a block hidden by one-per-file is recorded in neither ledger', async () => {
    const d = daemon();
    const opts = { flags: a3b2, originalSession: 'thr-1', threadKey: 'thr-1' };
    const hiddenBlock = codeResult('a.go', 50, 31, 2);
    const first = await searchCall(d, [codeResult('a.go', 10, 5), hiddenBlock], opts);
    expect(first).toContain('also in this file: S50 (l.50-80)');
    // The same block comes back as rank 1 of another call: it prints in full.
    const second = await searchCall(d, [{ ...hiddenBlock, rank: 1 }], opts);
    expect(second).not.toContain('already shown');
    expect(second).toContain('50\tline 50');
    // And a Codex ss-read of the hidden block one call before the second search was not omitted.
    const d2 = daemon();
    await searchCall(d2, [codeResult('a.go', 10, 5), hiddenBlock], opts);
    const read = await readCall(d2, 'a.go', 50, 31, opts);
    expect(read.printed).toBe('BODY a.go:50');
  });

  it('records nothing for a summary-only entry and nothing beyond the -k cap', () => {
    const results = [codeResult('a.go', 1, 3, 1), codeResult('b.go', 1, 3, 2), codeResult('c.go', 1, 3, 3)];
    const p = selectEntries(results, { summaryCap: 5, k: 2 });
    expect(printedSpanCandidates(results, p, { projectRoot: ROOT }).map((c) => c.resultIndex)).toEqual([0, 1]);
    expect(resultsForOriginalLedger(results, p).map((r) => r.file)).toEqual(['a.go', 'b.go']);
    // Nothing hidden: the original ledger gets the very same list object.
    const all = selectEntries(results, {});
    expect(resultsForOriginalLedger(results, all)).toBe(results);
    expect(resultsForOriginalLedger(results, null)).toBe(results);
  });

  it('omits only within the window; an older copy prints again and is re-recorded', async () => {
    const d = daemon();
    const opts = { flags: a3, threadKey: 'cc-1' }; // Claude Code: no original key
    await searchCall(d, block(), opts);
    for (let i = 0; i < ALREADY_SHOWN_WINDOW_CALLS; i++) await searchCall(d, [codeResult(`f${i}.go`, 1, 3)], opts);
    const late = await searchCall(d, block(), opts);       // 9 calls ago: prints
    expect(late).not.toContain('already shown');
    const next = await searchCall(d, block(), opts);       // re-recorded: omitted now
    expect(next).toContain('already shown above');
  });

  it('Claude Code / opencode: ss-read records into the A3 namespace; its own output is unchanged', async () => {
    const d = daemon();
    const opts = { flags: a3, threadKey: 'cc-1' };
    const read = await readCall(d, 'a.go', 10, 31, opts);
    expect(read).toEqual({ printed: 'BODY a.go:10', queryEvidence: null });
    const search = await searchCall(d, block(), opts);
    expect(search).toContain('(lines 10-40 already shown above — re-read: ss-read a.go 10 40)');
    expect([...d.ledger.sessions.keys()]).toEqual(['a3:cc-1']);
  });

  it('a second thread key sees nothing; the parent / subagent limit is a shared key', async () => {
    const d = daemon();
    await searchCall(d, block(), { flags: a3, threadKey: 'cc-1' });
    expect(await searchCall(d, block(), { flags: a3, threadKey: 'cc-2' })).not.toContain('already shown');
    // Same key (a Claude Code subagent inherits CLAUDE_CODE_SESSION_ID): the ledger cannot tell.
    expect(await searchCall(d, block(), { flags: a3, threadKey: 'cc-1' })).toContain('already shown');
  });

  it('fails open without a daemon reply', async () => {
    const omitted = await decideAlreadyShown({
      send: async () => null, sessionId: 'a3:x', candidates: printedSpanCandidates(block(), selectEntries(block()), { projectRoot: ROOT }),
    });
    expect(omitted.size).toBe(0);
    expect((await decideAlreadyShown({ send: null, sessionId: 'a3:x', candidates: [] })).size).toBe(0);
  });

  it('ss-read records only what it printed, and nothing that may be cut', () => {
    const spans = [{ file: 'a.go' }, { file: 'b.go' }];
    expect(readSpansForAlreadyShown(spans, [{ omit: true }, { omit: false }], 100)).toEqual([{ file: 'b.go' }]);
    expect(readSpansForAlreadyShown(spans, null, 100)).toEqual(spans);
    expect(readSpansForAlreadyShown(spans, null, ALREADY_SHOWN_MAX_RECORD_CHARS + 1)).toEqual([]);
  });
});

// ---- A5 regex repair ---------------------------------------------------------------------

describe('A5 regex repair keeps alternatives', () => {
  it('splits on top-level | and the GNU \\| only', () => {
    expect(splitTopLevelAlternation('a|b(c|d)|[x|y]')).toEqual(['a', 'b(c|d)', '[x|y]']);
    expect(splitTopLevelAlternation('type T\\|Transform(data')).toEqual(['type T', 'Transform(data']);
    expect(splitTopLevelAlternation('func(')).toEqual(['func(']);
  });

  it('approximates the Rust parser', () => {
    expect(rustRegexLooksValid('foo\\(bar')).toBe(true);
    expect(rustRegexLooksValid('(?i)foo')).toBe(true);
    expect(rustRegexLooksValid('a{2,3}')).toBe(true);
    expect(rustRegexLooksValid('func(')).toBe(false);
    expect(rustRegexLooksValid("Command '{}' exited")).toBe(false);
    expect(rustRegexLooksValid('foo(?=bar)')).toBe(false);
    expect(rustRegexLooksValid('(a)\\1')).toBe(false);
  });

  it('repairs only the broken alternative of the recorded failure shapes', () => {
    expect(repairRegexBranches("pipe_notebook|Command '{}' exited|had no output|stderr"))
      .toEqual({ pattern: "pipe_notebook|Command '\\{\\}' exited|had no output|stderr", wholeLiteral: false, repairedBranches: 1 });
    expect(repairRegexBranches('type Transformation\\|Transform(data').pattern).toBe('type Transformation|Transform\\(data');
    expect(repairRegexBranches('runModeSetup\\({\\|runModeTransition\\({').pattern).toBe('runModeSetup\\(\\{|runModeTransition\\(\\{');
  });

  it('a single broken pattern is still searched as literal text', () => {
    expect(repairRegexBranches('func(')).toEqual({ pattern: 'func\\(', wholeLiteral: true, repairedBranches: 1 });
    expect(repairRegexBranches('options(\'').pattern).toBe("options\\('");
    // Look-around is not Rust syntax: literal text.
    expect(repairRegexBranches('foo(?=bar)').pattern).toBe('foo\\(\\?=bar\\)');
  });

  it('a `|` inside an unclosed group stays inside it (never a new top-level alternative)', () => {
    // `app.(get|post` used to become `app.\(get|post`, which matches every `post` in the repo.
    // The pipe stays literal as `[|]` (a `\|` would trigger the GNU-alternation dialect hint).
    expect(repairRegexBranches('app.(get|post').pattern).toBe('app.\\(get[|]post');
    expect(repairRegexBranches('a(b|c(d|e)').pattern).toBe('a\\(b[|]c(d|e)');
    expect(repairRegexBranches('x(y|z|w').pattern).toBe('x\\(y[|]z[|]w');
    // A closed group is untouched; only top-level alternatives split.
    expect(repairRegexBranches('ok(a|b)|bad(').pattern).toBe('ok(a|b)|bad\\(');
    for (const raw of ['app.(get|post', 'a(b|c(d|e)', 'x(y|z|w']) {
      expect(rustRegexLooksValid(repairRegexBranches(raw).pattern), raw).toBe(true);
    }
  });

  it('every repaired pattern parses', () => {
    for (const raw of ["pipe_notebook|Command '{}' exited|had no output|stderr", 'a(|b', 'x{|y}', '*foo|bar', 'f(a[|b']) {
      expect(rustRegexLooksValid(repairRegexBranches(raw).pattern), raw).toBe(true);
    }
  });
});

describe('A4 alternatives after the switch to the non-test definition', () => {
  it('names the test definition and drops the chosen one', () => {
    const original = {
      target: { name: 'Do', type: 'method', filePath: 'mock/do_test.go', startLine: 3 },
      disambiguation: [{ name: 'Do', type: 'method', file: 'do.go', startLine: 10 }, { name: 'Do', type: 'method', file: 'x.go', startLine: 1 }],
    };
    expect(alternativesAfterSwitch(original, 'do.go', 10)).toEqual([
      { name: 'Do', type: 'method', file: 'mock/do_test.go', startLine: 3 },
      { name: 'Do', type: 'method', file: 'x.go', startLine: 1 },
    ]);
  });
});

describe('wrapper source checks', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../../eval/agent-read-workflows/bin/_ss-helpers.mjs'), 'utf8');

  it('the ss-trace usage text has no bracketed or piped mode-word form', () => {
    const usage = src.slice(src.indexOf('const TRACE_USAGE ='), src.indexOf('async function cmdTrace'));
    expect(usage).toContain("ss-trace <symbol> callers --in <defining file>");
    expect(usage).not.toMatch(/'[^']*callers\|callees[^']*'/);
    expect(usage).not.toMatch(/'[^']*\[callers[^']*'/);
  });

  it('A3 never writes to the original ledger and no old switch name is left', () => {
    expect(src).not.toMatch(/FIX\.bundleA/);
    expect(src).not.toMatch(/THREAD_KEY/);
    // recordAgentToolCall (the original ledger) has no sessionId override.
    const rec = src.slice(src.indexOf('async function recordAgentToolCall'), src.indexOf('// Entry plan for the fixed'));
    expect(rec).toContain('sessionId: AGENT_SESSION_ID');
    expect(rec).not.toMatch(/sessionId\s*=/);
  });
});
