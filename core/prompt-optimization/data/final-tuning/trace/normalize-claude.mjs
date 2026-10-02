#!/usr/bin/env node
/**
 * normalize-claude — r282 Claude Code cells -> one trace record per model REQUEST (SCHEMA.md).
 *
 *   node core/prompt-optimization/data/final-tuning/trace/normalize-claude.mjs <cell> [--out <file>] [--quiet]
 *   cells: cc-opus55-medium | cc-sonnet55-high
 *
 * READ-ONLY on every source:
 *   rows      <private checkout>/core/prompt-optimization/data/results/r282-<cell>/runs.jsonl
 *   sessions  ~/.ss-eval/r282/<cell>/claude-home-{native,sweet}/projects/<encoded cwd>/<sessionId>.jsonl
 *             (+ <sessionId>/subagents/*.jsonl when a rollout delegated; r282 had none)
 * Output (gitignored folder): core/prompt-optimization/data/results/final-tuning-trace/<cell>.trace.jsonl
 *
 * Request = one unique assistant message.id. Claude Code writes one JSONL record per content block,
 * all with the same message.id; the usage-bearing record wins (identical to
 * claude-code-accounting.mjs transcriptMetricsFromFile, which this file is reconciled against).
 * Cost = the runner's own formula (ideal-cost.mjs costFromTurns "real" column, cache write 1.25x).
 * Extra fields beyond SCHEMA.md are additive (see EXTRA below); none replaces a schema field.
 *
 * JOIN (every runner row must join exactly one session, else exit 1):
 *   arm = claude-home-<arm>; the first user message must end with "\n\nQuestion: <probe.query>"
 *   (queries are unique across the 130 probes); the session cwd must equal the clone path the runner
 *   derived (~/.ss-eval/r282-repos/<cell>/<repo path relative to the repo root with / -> __).
 *   Independent checks, reported not assumed: tool-call count == row.calls, and the reconstructed
 *   rawResponse length == row.rawLen (proves the parsing equals the runner's parsing).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyShellCommand } from '../../../../../eval/task-completion-bench/harness/shell-command-kind.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');                     // worktree root
const PRIVATE = '/Users/admin/Projects/sweet-search-private';           // read-only source of rows
const EVAL = path.join(os.homedir(), '.ss-eval');
const H = path.join(REPO, 'eval/task-completion-bench/harness');

const { priceFor } = await import(path.join(H, 'ideal-cost.mjs'));
const { transcriptMetricsFromFile } = await import(path.join(H, 'claude-code-accounting.mjs'));
const { resolveRepoCwd } = await import(path.join(REPO, 'core/prompt-optimization/sweep/gepa-evaluate.mjs'));

const CELLS = {
  'cc-sonnet55-high': { model: 'claude-sonnet-5-5', price: 'claude-sonnet-5-5' },
  'cc-opus55-medium': { model: 'claude-opus-5-5', price: 'claude-opus-5-5' },
};
const SETS = [
  ['vault', 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'],
  ['heldout', 'core/prompt-optimization/data/frozen/p7-heldout-probes.json'],
  ['ood', 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json'],
];

// ---- tool naming (FINAL_TUNING.md 2.2): basename of the executable, never a substring ------------
const SS_TOOLS = new Set(['ss-search', 'ss-read', 'ss-grep', 'ss-find', 'ss-semantic', 'ss-trace', 'ss-batch']);
const PREFIX_WORDS = new Set(['timeout', 'time', 'env', 'nice', 'command', 'exec', 'builtin', 'stdbuf']);

/** Split a shell command into pipeline/chain segments (quote-aware enough for first words). */
function segments(cmd) {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q && cmd[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ((c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|')) { out.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '|' || c === '\n' || c === '&') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
/** First command word of one segment after env assignments, `timeout N`, `(`, `!`, etc. -> basename. */
function firstWord(seg) {
  let s = seg.replace(/^[({!\s]+/, '');
  for (let guard = 0; guard < 12 && s; guard++) {
    const asg = /^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s*/.exec(s);
    if (asg) { s = s.slice(asg[0].length); continue; }
    const m = /^("[^"]*"|'[^']*'|\S+)\s*/.exec(s);
    if (!m) return null;
    const w = m[1].replace(/^["']|["']$/g, '');
    if (PREFIX_WORDS.has(w)) {
      s = s.slice(m[0].length);
      // skip option/duration arguments of the prefix word (timeout 20, env -i, nice -n 5)
      for (let k = 0; k < 4; k++) { const a = /^(-\S+|\d+[smhd]?)\s*/.exec(s); if (a) s = s.slice(a[0].length); else break; }
      continue;
    }
    return path.basename(w);
  }
  return null;
}
function classifyBash(cmd) {
  const segs = segments(cmd);
  const words = segs.map(firstWord).filter(Boolean);
  // `cd x && ...` : cd is a prefix, the tool is what follows; first non-cd word is the "sub".
  const real = words.filter(w => w !== 'cd');
  const ss = real.find(w => SS_TOOLS.has(w)) || null;
  const pipelined = segs.length > 1;
  if (ss) return { tool: ss, sub: 'shell', words, pipelined };
  return { tool: 'Bash', sub: real[0] || words[0] || null, words, pipelined };
}

/** The runner's own classifyToolUse/classifyShell (claude-code-task-runner.mjs, not exported) — copied
 *  verbatim so each call carries the bucket that decided whether its output reached rawResponse.
 *  Rows with captureVersion >= 2 were bucketed by shell-command-kind.mjs (an ss-* tool after
 *  `cd …;` is ss); older rows by the prefix-only rule below. */
function runnerKind(name, input, captureVersion = 1) {
  const shell = captureVersion >= 2 ? (cmd) => classifyShellCommand(cmd).kind : (cmd) => {
    const c = String(cmd || '').trim();
    if (/^run_tests\b/.test(c)) return 'test';
    if (/^(ss[-_](search|grep|find|read|semantic|trace)|sweet-search)\b/.test(c)) return 'ss';
    if (/\bapply_patch\b/.test(c)) return 'edit';
    if (/^(rg|grep|ag|ack|git grep)\b/.test(c) || /\| *(grep|rg)\b/.test(c)) return 'nativeGrep';
    if (/^(cat|head|tail|nl|bat|less)\b/.test(c) || /^sed\s+(-n|')/.test(c)) return 'nativeRead';
    return 'bash';
  };
  switch (name) {
    case 'Bash': return { kind: shell(input?.command), command: input?.command || '' };
    case 'Grep': case 'Glob': return { kind: 'nativeGrep', command: `${name} ${JSON.stringify(input?.pattern ?? input?.query ?? '')}` };
    case 'Read': case 'NotebookRead': return { kind: 'nativeRead', command: `Read ${input?.file_path || input?.path || ''}` };
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return { kind: 'edit', command: `${name} ${input?.file_path || ''}` };
    default: return { kind: 'bash', command: `${name} ${JSON.stringify(input || {}).slice(0, 160)}` };
  }
}
/** responseFor() of retrieval-bench-282.mjs: which call outputs reach rawResponse (feeds `content`). */
function inRaw(kind, sweet, text) {
  if (!text || !text.trim() || kind === 'edit') return false;
  return sweet ? (kind === 'ss' || kind === 'nativeRead') : true;
}

// ---- transcript parsing ----------------------------------------------------------------------------
const textOfResult = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(x => x?.text || '').join('') : '');

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    try { out.push(JSON.parse(t)); } catch { /* torn line */ }
  }
  return out;
}

/** One thread (main or a subagent transcript) -> ordered requests with calls + results attached. */
function parseThread(file) {
  const events = readJsonl(file);
  const byId = new Map(); const order = [];
  const results = new Map();
  let ctx = { systemPromptChars: 0, attachmentChars: {}, instructionFiles: [] };
  let firstUser = null; let cwd = null; let sessionId = null; let tsFirst = null; let tsLast = null;
  for (const e of events) {
    if (e.timestamp) { tsFirst ??= e.timestamp; tsLast = e.timestamp; }
    if (!sessionId && e.sessionId) sessionId = e.sessionId;
    if (!cwd && e.cwd) cwd = e.cwd;
    const m = e.message;
    if (e.type === 'user' && m && firstUser == null && typeof m.content === 'string' && !e.isMeta) firstUser = m.content;
    if (e.type === 'user' && m && Array.isArray(m.content)) {
      if (firstUser == null) { const t = m.content.map(b => b?.text || '').join(''); if (t.trim()) firstUser = t; }
      for (const b of m.content) if (b.type === 'tool_result') results.set(b.tool_use_id, { text: textOfResult(b.content), isError: !!b.is_error });
    }
    if (e.type === 'attachment' && e.attachment) {
      const a = e.attachment; const r = typeof e.rendered === 'string' ? e.rendered : JSON.stringify(e.rendered || '');
      if (a.type === 'prompt_snapshot') {
        const n = (a.systemPrompt || []).reduce((s, x) => s + String(x).length, 0);
        if (n) ctx.systemPromptChars = n;
      } else if (a.type === 'instructions') {
        ctx.instructionFiles = (a.files || []).map(f => ({ path: f.path, chars: (f.content || '').length }));
        ctx.attachmentChars.instructions = (ctx.attachmentChars.instructions || 0) + r.length;
      } else if (a.type !== 'total_tokens_reminder') ctx.attachmentChars[a.type] = (ctx.attachmentChars[a.type] || 0) + r.length;
      else ctx.attachmentChars.total_tokens_reminder = (ctx.attachmentChars.total_tokens_reminder || 0) + r.length;
    }
    if (e.type === 'assistant' && m?.id) {
      let g = byId.get(m.id);
      if (!g) { g = { id: m.id, model: m.model, requestId: e.requestId, ts: e.timestamp, tsEnd: e.timestamp, blocks: [], usage: null, best: -1, seenTool: new Set(), stop: null }; byId.set(m.id, g); order.push(m.id); }
      g.tsEnd = e.timestamp || g.tsEnd;
      if (m.stop_reason) g.stop = m.stop_reason;
      for (const b of m.content || []) {
        if (b.type === 'tool_use' && b.id) { if (g.seenTool.has(b.id)) continue; g.seenTool.add(b.id); }
        g.blocks.push(b);
      }
      const u = m.usage;
      if (u) {
        const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
        const inp = (u.input_tokens || 0) + cr + cw, out = u.output_tokens || 0;
        if (inp + out > g.best) {
          g.best = inp + out;
          g.usage = {
            inUncached: u.input_tokens || 0, cacheRead: cr, cacheWrite: cw, out,
            cw1h: u.cache_creation?.ephemeral_1h_input_tokens ?? null, cw5m: u.cache_creation?.ephemeral_5m_input_tokens ?? null,
            thinkingTokens: u.output_tokens_details && 'thinking_tokens' in u.output_tokens_details ? (u.output_tokens_details.thinking_tokens || 0) : null,
          };
        }
      }
    }
  }
  return { order, byId, results, ctx, firstUser, cwd, sessionId, tsFirst, tsLast };
}

function buildRequests({ thread, parsed, meta, price, sweet }) {
  const recs = []; let idx = 0;
  for (const id of parsed.order) {
    const g = parsed.byId.get(id);
    const u = g.usage || { inUncached: 0, cacheRead: 0, cacheWrite: 0, out: 0, cw1h: null, cw5m: null, thinkingTokens: null };
    const inTotal = u.inUncached + u.cacheRead + u.cacheWrite;
    const cw = Math.max(0, Math.min(u.cacheWrite, inTotal - u.cacheRead));
    const costUsd = (inTotal || u.out) ? ((inTotal - u.cacheRead - cw) * price.in + cw * price.in * 1.25 + u.cacheRead * price.cache + u.out * price.out) / 1e6 : 0;
    let textOutChars = 0, thinkingChars = 0, thinkingBlocks = 0; const calls = [];
    for (const b of g.blocks) {
      if (b.type === 'text' && typeof b.text === 'string') textOutChars += b.text.length;
      else if (b.type === 'thinking' || b.type === 'redacted_thinking') { thinkingBlocks++; if (typeof b.thinking === 'string') thinkingChars += b.thinking.length; }
      else if (b.type === 'tool_use') {
        const input = b.input || {};
        const argTextFull = b.name === 'Bash' ? String(input.command ?? '') : JSON.stringify(input);
        const rk = runnerKind(b.name, input, meta.captureVersion);
        const r = parsed.results.get(b.id);
        const resultText = r ? r.text : '';
        const cls = b.name === 'Bash' ? classifyBash(argTextFull) : null;
        calls.push({
          callId: b.id,
          tool: cls ? cls.tool : b.name,
          sub: cls ? cls.sub : null,
          argChars: argTextFull.length,
          argText: argTextFull.length > 2000 ? argTextFull.slice(0, 2000) : argTextFull,
          resultChars: resultText.length,
          resultTokensEst: Math.ceil(resultText.length / 4),
          resultText,
          isError: r ? r.isError : null,
          // EXTRA (additive)
          rawTool: b.name,
          pipelined: cls ? cls.pipelined : false,
          runnerKind: rk.kind,
          inRawResponse: inRaw(rk.kind, sweet, resultText),
          resultMissing: !r,
        });
      }
    }
    recs.push({
      cell: meta.cell, arm: meta.arm, id: meta.id, set: meta.set, lang: meta.lang, stratum: meta.stratum,
      sessionId: meta.sessionId, thread, req: idx++, model: g.model,
      tok: { inUncached: u.inUncached, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, inTotal, out: u.out, reasoning: u.thinkingTokens,
        cacheWrite1h: u.cw1h, cacheWrite5m: u.cw5m },
      costUsd: +costUsd.toFixed(8),
      textOutChars, thinkingChars, reasoningText: null,
      calls,
      // EXTRA (additive)
      thinkingBlocks, requestId: g.requestId, ts: g.ts, tsEnd: g.tsEnd, stopReason: g.stop, usageMissing: !g.usage || (!inTotal && !u.out),
    });
  }
  return recs;
}

// ---- main ------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const cell = argv.find(a => !a.startsWith('--'));
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const quiet = argv.includes('--quiet');
if (!CELLS[cell]) { console.error(`usage: normalize-claude.mjs <${Object.keys(CELLS).join('|')}>`); process.exit(2); }
const CELL = CELLS[cell]; const PRICE = priceFor(CELL.price);
const OUT = flag('--out') || path.join(REPO, 'core/prompt-optimization/data/results/final-tuning-trace', `${cell}.trace.jsonl`);

const rows = fs.readFileSync(path.join(PRIVATE, 'core/prompt-optimization/data/results', `r282-${cell}`, 'runs.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));
const probes = new Map();
for (const [set, rel] of SETS) {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
  for (const p of (Array.isArray(raw) ? raw : raw.probes)) probes.set(p.id, { ...p, _set: set });
}

// session index per arm
const sessionsByArm = { native: [], sweet: [] };
for (const arm of Object.keys(sessionsByArm)) {
  const root = path.join(EVAL, 'r282', cell, `claude-home-${arm}`, 'projects');
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(root, d.name))) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(root, d.name, f);
      const parsed = parseThread(file);
      sessionsByArm[arm].push({ file, dir: d.name, parsed });
    }
  }
}

const errors = []; const out = []; const summaries = [];
const reconDiffs = [];
const checks = { callsEqual: 0, callsDiff: 0, rawLenEqual: 0, rawLenDiff: 0, cwdOk: 0, cwdBad: 0, turnsVsTranscript: 0, turnsDiff: 0, sidechainFiles: 0, usageMissingReq: 0 };
const cloneRoot = path.join(EVAL, 'r282-repos', cell);

for (const row of rows) {
  const probe = probes.get(row.id);
  if (!probe) { errors.push(`${row.arm}|${row.id}: no probe`); continue; }
  const tail = `\n\nQuestion: ${probe.query}`;
  const cands = sessionsByArm[row.arm].filter(s => typeof s.parsed.firstUser === 'string' && s.parsed.firstUser.endsWith(tail));
  if (cands.length !== 1) { errors.push(`${row.arm}|${row.id}: joined ${cands.length} sessions`); continue; }
  const s = cands[0]; const P = s.parsed;
  // expected cwd: clone root + repo path relative to the repo root, '/' -> '__'
  const orig = resolveRepoCwd(probe, {});
  const relFromRepo = path.relative(REPO, orig).replace(/[\\/]/g, '__');
  if (P.cwd === path.join(cloneRoot, relFromRepo)) checks.cwdOk++; else { checks.cwdBad++; errors.push(`${row.arm}|${row.id}: cwd ${P.cwd} != ${path.join(cloneRoot, relFromRepo)}`); }

  const meta = { cell, arm: row.arm, id: row.id, set: row.set, lang: row.lang, stratum: row.stratum, sessionId: P.sessionId, captureVersion: row.captureVersion ?? 1 };
  const sweet = row.arm === 'sweet';
  const reqs = buildRequests({ thread: 'main', parsed: P, meta, price: PRICE, sweet });
  let allReqs = [...reqs];
  // sidechains (subagent transcripts) — none in r282, handled for completeness
  const subDir = path.join(path.dirname(s.file), P.sessionId, 'subagents');
  let sideN = 0;
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).filter(x => x.endsWith('.jsonl')).sort()) {
      const sp = parseThread(path.join(subDir, f)); checks.sidechainFiles++;
      allReqs = allReqs.concat(buildRequests({ thread: `side:${sideN++}`, parsed: sp, meta, price: PRICE, sweet }));
    }
  }
  checks.usageMissingReq += allReqs.filter(r => r.usageMissing).length;

  // reconciliation against the runner's cost (and its own transcript reader)
  const costSum = allReqs.reduce((a, r) => a + r.costUsd, 0);
  const runnerCost = row.costRealizedUsd;
  const diffPct = runnerCost ? (costSum - runnerCost) / runnerCost * 100 : null;
  reconDiffs.push({ arm: row.arm, id: row.id, diffPct, costSum, runnerCost });
  const tm = transcriptMetricsFromFile(s.file);
  if (tm.turns.length === reqs.filter(r => !r.usageMissing).length) checks.turnsVsTranscript++; else checks.turnsDiff++;

  const callsAll = allReqs.flatMap(r => r.calls);
  const mainCalls = reqs.flatMap(r => r.calls);
  // runner counted main-thread tool_use blocks only (parseClaudeStream over the stream = main thread)
  if (mainCalls.length === row.calls) checks.callsEqual++; else checks.callsDiff++;
  // rebuild rawResponse length exactly as responseFor() does (untruncated commands, same buckets)
  const rawLen = (() => {
    const blocks = [];
    for (const id of P.order) for (const b of P.byId.get(id).blocks) {
      if (b.type !== 'tool_use') continue;
      const { kind, command } = runnerKind(b.name, b.input || {}, meta.captureVersion);
      const r = P.results.get(b.id); const text = r ? r.text : '';
      if (!inRaw(kind, sweet, text)) continue;
      blocks.push(sweet ? (kind === 'ss' ? text : `${command}\n${text}`) : `$ ${command}\n${text}`);
    }
    return blocks.join('\n\n').length;
  })();
  if (rawLen === row.rawLen) checks.rawLenEqual++; else checks.rawLenDiff++;

  const first = reqs[0];
  const promptChars = P.firstUser.length;
  const prefixTokens = first ? first.tok.inTotal - Math.ceil(promptChars / 4) : null;
  const rollout = {
    type: 'rollout', cell, arm: row.arm, id: row.id, sessionId: P.sessionId,
    requests: allReqs.length, turns: allReqs.length, turnsMain: reqs.length, sidechains: sideN,
    calls: callsAll.length, costUsdSum: +costSum.toFixed(6), runnerCostUsd: runnerCost, reconDiffPct: diffPct == null ? null : +diffPct.toFixed(4),
    prefixTokens,
    // EXTRA
    prefixMethod: 'req0 inTotal - ceil(firstUserMessageChars/4); includes system prompt + tool definitions + <system-reminder> context blocks (skills, agents, deferred tools, env, rules file)',
    firstUserChars: promptChars,
    req0: first ? { inUncached: first.tok.inUncached, cacheRead: first.tok.cacheRead, cacheWrite: first.tok.cacheWrite, inTotal: first.tok.inTotal } : null,
    ctx: P.ctx,
    cwd: P.cwd, sessionFile: s.file, tsStart: P.tsFirst, tsEnd: P.tsLast,
    set: row.set, lang: row.lang, stratum: row.stratum,
    wallMs: row.wallMs, runnerCalls: row.calls, runnerRawLen: row.rawLen, rawLenRebuilt: rawLen,
    runnerNaiveUsd: row.costNaiveUsd ?? null, costSource: row.costSource,
    score: row.score ?? null, content: row.content ?? null, contentNoD3: row.content_noD3 ?? null, grounding: row.grounding ?? null, purityRatio: row.purity_ratio ?? null, USD_noC: row.USD_noC ?? null, toolKinds: row.toolKinds, runnerUsage: row.usage ? { in: row.usage.input_tokens, cw: row.usage.cache_creation_input_tokens, cr: row.usage.cache_read_input_tokens, out: row.usage.output_tokens } : null,
  };
  // final answer text = last text block of the main thread
  let answer = '';
  for (const id of P.order) for (const b of P.byId.get(id).blocks) if (b.type === 'text' && b.text?.trim()) answer = b.text;
  rollout.answer = answer;
  out.push(...allReqs); summaries.push(rollout);
}
// ---- write -----------------------------------------------------------------------------------------
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const byKey = (r) => `${r.arm}|${r.id}`;
const grouped = new Map();
for (const r of out) { const k = byKey(r); if (!grouped.has(k)) grouped.set(k, []); grouped.get(k).push(r); }
const fd = fs.openSync(OUT, 'w');
for (const s of summaries) {
  for (const r of grouped.get(byKey(s)) || []) fs.writeSync(fd, JSON.stringify(r) + '\n');
  fs.writeSync(fd, JSON.stringify(s) + '\n');
}
fs.closeSync(fd);

// ---- validation report -----------------------------------------------------------------------------
const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
const lines = [];
lines.push(`# ${cell}: rows ${rows.length}, joined ${summaries.length}, join errors ${errors.length}`);
lines.push(`requests ${out.length}, rollout summaries ${summaries.length}, sidechain transcripts ${checks.sidechainFiles}, requests without usage ${checks.usageMissingReq}`);
lines.push(`cwd == runner clone path: ${checks.cwdOk}/${checks.cwdOk + checks.cwdBad}`);
lines.push(`tool-call count == runner row.calls: ${checks.callsEqual}/${checks.callsEqual + checks.callsDiff}`);
lines.push(`rebuilt rawResponse length == runner rawLen: ${checks.rawLenEqual}/${checks.rawLenEqual + checks.rawLenDiff}`);
lines.push(`request count == runner transcript reader turns: ${checks.turnsVsTranscript}/${checks.turnsVsTranscript + checks.turnsDiff}`);
for (const arm of ['native', 'sweet', 'all']) {
  const d = reconDiffs.filter(x => (arm === 'all' || x.arm === arm) && x.diffPct != null);
  const within = d.filter(x => Math.abs(x.diffPct) <= 2).length;
  const sum = d.reduce((a, x) => a + x.costSum, 0), rsum = d.reduce((a, x) => a + x.runnerCost, 0);
  const ad = d.map(x => Math.abs(x.diffPct));
  lines.push(`recon ${arm}: n=${d.length} |diff|<=2%: ${within} (${(100 * within / d.length).toFixed(1)}%)  max|diff| ${Math.max(...ad).toFixed(4)}%  p50 ${pct(ad, .5).toFixed(4)}%  p95 ${pct(ad, .95).toFixed(4)}%  pooled diff ${((sum - rsum) / rsum * 100).toFixed(4)}%  (sum ${sum.toFixed(4)} vs runner ${rsum.toFixed(4)})`);
}
if (errors.length) lines.push('ERRORS:\n  ' + errors.slice(0, 40).join('\n  '));
if (!quiet) console.log(lines.join('\n')); else console.log(lines.slice(0, 2).join('\n'));
console.error(`wrote ${OUT}`);
process.exit(errors.length ? 1 : 0);
