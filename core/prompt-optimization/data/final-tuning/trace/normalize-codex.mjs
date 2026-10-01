#!/usr/bin/env node
/**
 * normalize-codex.mjs — r282 Codex cell -> trace.jsonl (schema: SCHEMA.md in this folder).
 *
 *   node core/prompt-optimization/data/final-tuning/trace/normalize-codex.mjs codex-sol61-high
 *
 * READ-ONLY on every source (runs.jsonl, captures, ~/.ss-eval/r282/<cell>/codex-home/sessions).
 * Writes only <worktree>/core/prompt-optimization/data/results/final-tuning-trace/<cell>.trace.jsonl
 * (+ <cell>.validation.json). No network, no LLM call, no harness CLI is started.
 *
 * Source facts (Codex 0.159.2 rollout-*.jsonl, verified 2026-10-01 on all 260 sessions of the cell):
 *  - One model REQUEST = one `token_usage_record` line (has response_id + per-request `usage`).
 *    It equals the `token_count` event's last_token_usage (cross-checked: same count, same values).
 *    The assistant items of request n (message / reasoning / custom_tool_call) sit between record
 *    n-1 and record n. Tool results (custom_tool_call_output) belong to the NEXT request's input.
 *  - Tools: the model calls ONE custom tool `exec` (code mode). Its JS source holds 1..3
 *    `tools.exec_command({cmd:"..."})` calls. The runner counted `CommandExecution` item_completed
 *    events (one per exec_command) as "calls"; this script emits the same units.
 *  - usage.input_tokens INCLUDES cached_input_tokens; output_tokens INCLUDES reasoning_output_tokens.
 *  - Cost: same formula and price table as scripts/retrieval-bench-282.mjs runCodex():
 *      ((in - cached) * P.in + cached * P.cache + out * P.out) / 1e6   (no cache-write premium).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..'); // worktree root
const MAIN = '/Users/admin/Projects/sweet-search-private';
const { priceFor } = await import(path.join(WT, 'eval/task-completion-bench/harness/ideal-cost.mjs'));
// Same repo resolution as the runner (gepa-evaluate.resolveRepoCwd): language:repo -> path in author-probes.
const { IN_DISTRIBUTION, OOD_DISTRIBUTION } = await import(path.join(WT, 'core/prompt-optimization/sweep/author-probes.mjs'));
const REPO_PATH_BY_KEY = new Map([...IN_DISTRIBUTION, ...OOD_DISTRIBUTION].map((x) => [`${x.language}:${x.repo}`, path.resolve(WT, x.path)]));
const REPO_PATH_BY_NAME = new Map([...IN_DISTRIBUTION, ...OOD_DISTRIBUTION].map((x) => [x.repo, path.resolve(WT, x.path)]));
const origOf = (p) => REPO_PATH_BY_KEY.get(`${p.language}:${p.repo}`) || REPO_PATH_BY_NAME.get(p.repo) || path.join(WT, 'eval', 'repos', p.repo);

const CELL = process.argv[2] || 'codex-sol61-high';
const PRICE_KEY = { 'codex-sol61-high': 'openai/gpt-6.1-sol' }[CELL];
if (!PRICE_KEY) { console.error(`normalize-codex: unsupported cell ${CELL}`); process.exit(2); }
const PRICE = priceFor(PRICE_KEY);
const SRC_RESULTS = path.join(MAIN, 'core/prompt-optimization/data/results', `r282-${CELL}`);
const SESSIONS = path.join(os.homedir(), '.ss-eval/r282', CELL, 'codex-home/sessions');
const CLONE_ROOT = path.join(os.homedir(), '.ss-eval/r282-repos', CELL);
const cloneOf = (orig) => path.join(CLONE_ROOT, path.relative(WT, orig).replace(/[\\/]/g, '__'));
const OUT_DIR = path.join(WT, 'core/prompt-optimization/data/results/final-tuning-trace');
const OUT = path.join(OUT_DIR, `${CELL}.trace.jsonl`);

const cost = (inTot, cached, out) => ((inTot - cached) * PRICE.in + cached * PRICE.cache + out * PRICE.out) / 1e6;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ─── shell command parsing (tool naming rules, SCHEMA.md) ─────────────────────────────────────
function unwrapShell(cmd) {
  let c = String(cmd || '').trim();
  const m = c.match(/^(?:\S*\/)?(?:ba|z|da|k|fi)?sh\s+-[a-z]*c\s+([\s\S]*)$/);
  if (m) {
    let inner = m[1].trim(); const q = inner[0];
    if ((q === "'" || q === '"') && inner[inner.length - 1] === q) {
      inner = inner.slice(1, -1);
      if (q === "'") inner = inner.replace(/'\\''/g, "'");
    }
    c = inner.trim();
  }
  return c;
}
/** Split on unquoted ; && || and newlines. A single | stays inside the part. */
function splitChain(s) {
  const parts = []; let cur = '', quote = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
      if (ch === quote) quote = '';
      cur += ch; continue;
    }
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    const two = s.slice(i, i + 2);
    if (ch === ';' || ch === '\n' || two === '&&' || two === '||') {
      if (cur.trim()) parts.push(cur.trim()); cur = '';
      if (two === '&&' || two === '||') i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
/** First command WORD of one chain part, after env assignments / timeout / env / command / time / nohup. */
function firstWord(part) {
  let w = part.trim().split(/\s+/);
  for (let guard = 0; guard < 12 && w.length; guard++) {
    const t = w[0];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { w.shift(); continue; }           // FOO=bar
    if (/^(?:\S*\/)?(env|command|time|nohup|exec)$/.test(t)) { w.shift(); continue; }
    if (/^(?:\S*\/)?timeout$/.test(t)) {                                        // timeout [opts] DURATION
      w.shift();
      while (w.length && /^-/.test(w[0])) { const o = w.shift(); if (/^-[sk]$/.test(o)) w.shift(); }
      if (w.length && /^[0-9.]+[smhd]?$/.test(w[0])) w.shift();
      continue;
    }
    break;
  }
  if (!w.length) return '';
  return path.basename(w[0].replace(/^['"]|['"]$/g, ''));
}
const SS_TOOL = /^ss[-_](search|grep|find|read|semantic|trace|batch)$/;
/** -> { tool, sub, chain } ; chain = first word of every part of a chained command. */
function classifyCmd(cmd) {
  const inner = unwrapShell(cmd);
  const parts = splitChain(inner);
  const words = parts.map(firstWord).filter(Boolean);
  // skip leading `cd <dir>` / `pwd` parts (the real command follows)
  let i = 0; while (i < words.length - 1 && (words[i] === 'cd' || words[i] === 'pwd')) i++;
  const first = words[i] || '';
  const norm = (w) => w.replace('_', '-');
  if (SS_TOOL.test(first)) return { tool: norm(first), sub: 'shell', chain: words };
  return { tool: 'exec_command', sub: first || null, chain: words };
}

// ─── JS source of an `exec` cell: the cmd strings of its tools.exec_command calls ─────────────
function decodeJsString(lit) {
  const q = lit[0]; const body = lit.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') { out += ch; continue; }
    const n = body[++i];
    if (n === 'n') out += '\n'; else if (n === 't') out += '\t'; else if (n === 'r') out += '\r';
    else if (n === 'u') { out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16)); i += 4; }
    else if (n === 'x') { out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16)); i += 2; }
    else if (n === '\n') { /* line continuation */ }
    else out += n;
  }
  return out;
}
function cmdsFromSource(src) {
  const out = []; const re = /\bcmd\s*:\s*/g; let m;
  while ((m = re.exec(src))) {
    const q = src[re.lastIndex];
    if (q !== '"' && q !== "'" && q !== '`') continue;
    let j = re.lastIndex + 1;
    while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
    out.push(decodeJsString(src.slice(re.lastIndex, j + 1)));
    re.lastIndex = j + 1;
  }
  return out;
}

// ─── one rollout file -> { meta, requests[], cells[] } ────────────────────────────────────────
function findOutputObjs(o, acc = []) {
  if (o && typeof o === 'object') {
    if ('output' in o && 'original_token_count' in o) acc.push(o); else for (const v of Object.values(o)) findOutputObjs(v, acc);
  }
  return acc;
}
function parseRollout(file) {
  const L = readLines(file);
  const meta = L.find((o) => o.type === 'session_meta').payload;
  const tctx = L.find((o) => o.type === 'turn_context')?.payload || {};
  const devTexts = L.filter((o) => o.payload?.type === 'message' && o.payload.role === 'developer').map((o) => o.payload.content.map((c) => c.text).join('\n'));
  const userMsg = L.find((o) => o.payload?.type === 'message' && o.payload.role === 'user' && /^You are answering a question about the code/.test(o.payload.content?.[0]?.text || ''));
  const userText = userMsg ? userMsg.payload.content.map((c) => c.text).join('\n') : '';
  const requests = []; const cells = new Map(); const anomalies = [];
  let pending = { textOut: 0, thinking: 0, encChars: 0, reasoningItems: 0, cells: [], phases: [], finalText: null };
  let prevTs = null; let taskComplete = null;
  for (const o of L) {
    const p = o.payload || {};
    if (o.type === 'response_item') {
      if (p.type === 'message' && p.role === 'assistant') {
        const t = (p.content || []).map((c) => c.text || '').join('');
        pending.textOut += t.length; pending.phases.push(p.phase || '');
        if (p.phase === 'final_answer') pending.finalText = t;
      } else if (p.type === 'reasoning') {
        pending.reasoningItems++; pending.encChars += (p.encrypted_content || '').length;
        pending.thinking += (p.summary || []).map((s) => s.text || '').join('').length;
      } else if (p.type === 'custom_tool_call') {
        const cell = { callId: p.call_id, name: p.name, src: p.input, srcCmds: cmdsFromSource(p.input), ces: [], outParts: null, hdr: '', req: null };
        cells.set(p.call_id, cell); pending.cells.push(cell);
      } else if (p.type === 'custom_tool_call_output') {
        const cell = cells.get(p.call_id);
        if (!cell) { anomalies.push(`output without call ${p.call_id}`); continue; }
        cell.hdr = p.output?.[0]?.text || ''; cell.outParts = (p.output || []).slice(1).map((x) => x.text || '');
      } else if (!['message'].includes(p.type)) anomalies.push(`unhandled response_item ${p.type}`);
    } else if (o.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'CommandExecution') {
      // attach to the open cell (no output yet) whose source holds this command; else the earliest open cell
      const cmd = Array.isArray(p.item.command) ? p.item.command[p.item.command.length - 1] : String(p.item.command || '');
      const open = [...cells.values()].filter((c) => !c.outParts);
      let cell = open.find((c) => c.srcCmds.includes(cmd) && c.ces.filter((e) => e.cmd === cmd).length < c.srcCmds.filter((s) => s === cmd).length)
        || open.find((c) => c.ces.length < Math.max(1, c.srcCmds.length)) || open[0];
      if (!cell) { anomalies.push('CommandExecution without open cell'); continue; }
      cell.ces.push({ cmd, item: p.item });
    } else if (o.type === 'token_usage_record') {
      const u = p.usage || {};
      const req = {
        respId: p.response_id, ts: o.timestamp,
        dtMs: prevTs == null ? null : Date.parse(o.timestamp) - prevTs,
        inTotal: u.input_tokens || 0, cached: u.cached_input_tokens || 0, cacheWrite: u.cache_write_input_tokens || 0,
        out: u.output_tokens || 0, reasoning: u.reasoning_output_tokens ?? null, cumIn: p.turn_token_usage?.input_tokens ?? null,
        textOut: pending.textOut, thinking: pending.thinking, encChars: pending.encChars, reasoningItems: pending.reasoningItems,
        cells: pending.cells, phases: pending.phases, finalText: pending.finalText,
      };
      for (const c of pending.cells) c.req = requests.length;
      requests.push(req); prevTs = Date.parse(o.timestamp);
      pending = { textOut: 0, thinking: 0, encChars: 0, reasoningItems: 0, cells: [], phases: [], finalText: null };
    } else if (o.type === 'event_msg' && p.type === 'task_complete') taskComplete = p;
  }
  if (pending.textOut || pending.cells.length || pending.reasoningItems) anomalies.push('assistant items after the last token_usage_record');
  // per-request token_count cross-check
  const tc = L.filter((o) => o.type === 'event_msg' && o.payload?.type === 'token_count' && o.payload.info?.last_token_usage).map((o) => o.payload.info.last_token_usage);
  const tcMatch = tc.length === requests.length && tc.every((u, i) => u.input_tokens === requests[i].inTotal && u.cached_input_tokens === requests[i].cached && u.output_tokens === requests[i].out);
  const finalTotal = [...L].reverse().find((o) => o.type === 'event_msg' && o.payload?.type === 'token_count')?.payload.info.total_token_usage || null;
  return { meta, tctx, devTexts, userText, requests, cells, anomalies, tcMatch, finalTotal, taskComplete, lastTs: L[L.length - 1].timestamp };
}

// ─── calls of a request ───────────────────────────────────────────────────────────────────────
function callsOfRequest(req) {
  const calls = [];
  for (const cell of req.cells) {
    // slots in SOURCE order; bind each command-execution event to the first unbound slot with the same cmd
    const slots = cell.srcCmds.length ? cell.srcCmds.map((cmd) => ({ cmd, ce: null })) : cell.ces.map((e) => ({ cmd: e.cmd, ce: null }));
    const free = cell.ces.slice();
    for (const s of slots) { const k = free.findIndex((e) => e.cmd === s.cmd); if (k >= 0) s.ce = free.splice(k, 1)[0]; }
    for (const s of slots) if (!s.ce && free.length) s.ce = free.shift();
    for (const e of free) slots.push({ cmd: e.cmd, ce: e }); // events beyond the parsed source
    // model-visible output per slot: JSON parts in source order when counts agree
    const parts = cell.outParts || [];
    const parsedJson = parts.map((t) => { try { return JSON.parse(t); } catch { return null; } });
    const perSlot = (parts.length === slots.length && parsedJson.every(Boolean)) ? parts.map((t, i) => ({ visibleChars: t.length, reported: findOutputObjs(parsedJson[i])[0]?.original_token_count ?? null })) : null;
    const single = slots.length === 1;
    slots.forEach((s, i) => {
      const item = s.ce?.item;
      const res = item ? (typeof item.aggregated_output === 'string' ? item.aggregated_output : '') : '';
      const cls = classifyCmd(s.cmd);
      const vis = single ? { visibleChars: parts.reduce((a, t) => a + t.length, 0), reported: findOutputObjs(parsedJson[0] || {})[0]?.original_token_count ?? null } : (perSlot ? perSlot[i] : { visibleChars: null, reported: null });
      calls.push({
        callId: slots.length > 1 ? `${cell.callId}#${i}` : cell.callId,
        tool: cls.tool, sub: cls.sub,
        argChars: s.cmd.length, argText: s.cmd.slice(0, 2000),
        resultChars: res.length, resultTokensEst: Math.ceil(res.length / 4), resultText: res,
        isError: item ? (item.exit_code ?? 0) !== 0 : true,
        // additive fields
        exitCode: item ? (item.exit_code ?? null) : null,
        chain: cls.chain.length > 1 ? cls.chain : undefined,
        visibleChars: vis.visibleChars, reportedResultTokens: vis.reported,
        cellCalls: slots.length, noExecEvent: item ? undefined : true,
      });
    });
  }
  return calls;
}

// ─── main ─────────────────────────────────────────────────────────────────────────────────────
const walk = (d, acc = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, acc) : /rollout-.*\.jsonl$/.test(e.name) && acc.push(p); } return acc; };
const rows = fs.readFileSync(path.join(SRC_RESULTS, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const probes = new Map();
for (const f of ['p7-vault-probes-v60.json', 'p7-heldout-probes.json', 'p7-langtransfer-probes.json']) {
  const raw = JSON.parse(fs.readFileSync(path.join(WT, 'core/prompt-optimization/data/frozen', f), 'utf8'));
  for (const p of (Array.isArray(raw) ? raw : raw.probes)) probes.set(p.id, p);
}
const sessionFiles = walk(SESSIONS).sort();
const sessions = sessionFiles.map((file) => {
  const r = parseRollout(file);
  const qm = r.userText.match(/\n\nQuestion: ([\s\S]*)$/);
  const isSweet = r.devTexts.some((t) => /Sweet-search — code search tool guide/.test(t));
  return { file, ...r, question: qm ? qm[1].trim() : null, arm: isSweet ? 'sweet' : 'native', baseHash: sha(r.meta.base_instructions?.text || ''), cwd: r.meta.cwd, sessionId: r.meta.id };
});

// join: runner row -> sessions with the same arm + question text (+ clone path consistent with the probe repo)
const report = { cell: CELL, sessions: sessions.length, rows: rows.length, joinErrors: [], anomalies: [], armGroups: {} };
for (const s of sessions) { const k = `${s.arm}|base=${s.baseHash}`; report.armGroups[k] = (report.armGroups[k] || 0) + 1; }
const byKey = new Map();
for (const s of sessions) { const k = `${s.arm}\u0000${s.question}`; (byKey.get(k) || byKey.set(k, []).get(k)).push(s); }
const used = new Set(); const joined = [];
for (const row of rows) {
  const probe = probes.get(row.id);
  if (!probe) { report.joinErrors.push(`${row.arm}/${row.id}: unknown probe`); continue; }
  const cand = (byKey.get(`${row.arm}\u0000${probe.query.trim()}`) || []).filter((s) => s.cwd === cloneOf(origOf(probe)));
  if (cand.length !== 1) { report.joinErrors.push(`${row.arm}/${row.id}: ${cand.length} sessions`); continue; }
  if (used.has(cand[0].file)) { report.joinErrors.push(`${row.arm}/${row.id}: session already used`); continue; }
  used.add(cand[0].file); joined.push({ row, probe, s: cand[0] });
}
report.unjoinedSessions = sessions.filter((s) => !used.has(s.file)).length;

// prefix size: req-0 input minus the user message (frame + question), the latter estimated at 4 chars/token
// (about 280 tokens; error +-40 tokens = 0.3% of the prefix). The tool definitions are not stored in the
// rollout, so this number includes them: prefix = system prompt + tool definitions + developer messages
// (skills list, multi-agent blocks, sweet rules) + environment_context.
const USER_CHARS_PER_TOKEN = 4;

fs.mkdirSync(OUT_DIR, { recursive: true });
const outLines = []; const recon = [];
joined.sort((a, b) => (a.row.arm + a.row.id).localeCompare(b.row.arm + b.row.id));
for (const { row, probe, s } of joined) {
  const base = { cell: CELL, arm: row.arm, id: row.id, set: row.set, lang: row.lang, stratum: row.stratum };
  let cum = { in: 0, cached: 0, out: 0 }; let sumCost = 0, nCalls = 0;
  const model = s.tctx.model || row.model;
  s.requests.forEach((q, i) => {
    const calls = callsOfRequest(q);
    nCalls += calls.length;
    const c = cost(q.inTotal, q.cached, q.out); sumCost += c;
    cum.in += q.inTotal; cum.cached += q.cached; cum.out += q.out;
    const prev = s.requests[i - 1];
    outLines.push(JSON.stringify({
      ...base, sessionId: s.sessionId, thread: 'main', req: i, model,
      tok: { inUncached: q.inTotal - q.cached - q.cacheWrite, cacheRead: q.cached, cacheWrite: q.cacheWrite, inTotal: q.inTotal, out: q.out, reasoning: q.reasoning },
      costUsd: c, textOutChars: q.textOut, thinkingChars: q.thinking, reasoningText: null, calls,
      x: { respId: q.respId, ts: q.ts, dtMs: q.dtMs, ctxGrowth: prev ? q.inTotal - prev.inTotal : null, reasoningItems: q.reasoningItems, reasoningEncChars: q.encChars, phases: q.phases, final: i === s.requests.length - 1 },
    }));
  });
  const last = s.requests[s.requests.length - 1];
  const prefixTokens = Math.round(s.requests[0].inTotal - s.userText.length / USER_CHARS_PER_TOKEN);
  const answer = last?.finalText ?? null;
  const diff = row.costRealizedUsd ? (sumCost - row.costRealizedUsd) / row.costRealizedUsd * 100 : null;
  const u = row.usage || {};
  const usageMatch = cum.in === u.input_tokens && cum.cached === u.cached_input_tokens && cum.out === u.output_tokens;
  recon.push({ arm: row.arm, id: row.id, diff, usageMatch });
  const capFile = path.join(SRC_RESULTS, 'captures', `${row.arm}.${row.id}.json`);
  let capAnswerMatch = null, capCalls = null, capCharsMatch = null;
  try {
    const cap = JSON.parse(fs.readFileSync(capFile, 'utf8')); capAnswerMatch = (cap.answer || '').trim() === (answer || '').trim(); capCalls = cap.calls.length;
    // the capture lists calls in stream (completion) order, this trace in source order: compare as multisets
    const mine = s.requests.flatMap((q) => callsOfRequest(q)).map((c) => c.resultChars).sort((a, b) => a - b).join(',');
    capCharsMatch = cap.calls.map((c) => c.textChars).sort((a, b) => a - b).join(',') === mine;
  } catch { /* no capture */ }
  outLines.push(JSON.stringify({
    type: 'rollout', ...base, sessionId: s.sessionId, requests: s.requests.length, turns: s.requests.length, calls: nCalls,
    costUsdSum: sumCost, runnerCostUsd: row.costRealizedUsd, reconDiffPct: diff, prefixTokens,
    prefixMethod: 'req0.inTotal - ceil(userMessageChars/4); includes tool definitions, developer messages and environment_context',
    answer, // additive fields below
    file: path.relative(SESSIONS, s.file), runnerCalls: row.calls, runnerCallsMatch: row.calls === nCalls, captureCalls: capCalls,
    usageTotals: { in: cum.in, cached: cum.cached, out: cum.out }, runnerUsage: { in: u.input_tokens, cached: u.cached_input_tokens, out: u.output_tokens }, usageMatch,
    tokenCountMatch: s.tcMatch, cumulativeMatch: s.finalTotal ? (s.finalTotal.input_tokens === cum.in && s.finalTotal.cached_input_tokens === cum.cached && s.finalTotal.output_tokens === cum.out) : null,
    captureAnswerMatch: capAnswerMatch, captureTextCharsMatch: capCharsMatch, sessionWallMs: s.taskComplete?.duration_ms ?? null, runnerWallMs: row.wallMs,
    score: row.score, anomalies: s.anomalies.length ? s.anomalies : undefined,
  }));
  if (s.anomalies.length) report.anomalies.push(`${row.arm}/${row.id}: ${s.anomalies.join('; ')}`);
}
fs.writeFileSync(OUT, outLines.join('\n') + '\n');

// validation summary
const within = (r, t) => r.diff != null && Math.abs(r.diff) <= t;
const pct = (n, d) => `${n}/${d} (${(n / d * 100).toFixed(1)}%)`;
const diffs = recon.map((r) => r.diff).filter((x) => x != null).sort((a, b) => a - b);
report.join = { rows: rows.length, joinedExactlyOne: joined.length, errors: report.joinErrors.length, unjoinedSessions: report.unjoinedSessions };
report.recon = {
  within2pct: pct(recon.filter((r) => within(r, 2)).length, recon.length),
  within0_01pct: pct(recon.filter((r) => within(r, 0.01)).length, recon.length),
  minPct: diffs[0], maxPct: diffs[diffs.length - 1],
  usageMatchAll: recon.every((r) => r.usageMatch),
};
const tot = outLines.map((l) => JSON.parse(l)).filter((r) => r.type === 'rollout');
const sumTrace = tot.reduce((a, r) => a + r.costUsdSum, 0), sumRunner = tot.reduce((a, r) => a + r.runnerCostUsd, 0);
report.recon.pooledDiffPct = (sumTrace - sumRunner) / sumRunner * 100;
report.recon.pooled = { traceUsd: sumTrace, runnerUsd: sumRunner };
report.checks = {
  tokenCountMatchAll: tot.every((r) => r.tokenCountMatch), cumulativeMatchAll: tot.every((r) => r.cumulativeMatch),
  callsMatchRunner: pct(tot.filter((r) => r.runnerCallsMatch).length, tot.length), captureAnswerMatch: pct(tot.filter((r) => r.captureAnswerMatch).length, tot.length), captureTextCharsMatch: pct(tot.filter((r) => r.captureTextCharsMatch).length, tot.length),
  noExecEventCalls: outLines.filter((l) => l.includes('"noExecEvent":true')).length,
};
fs.writeFileSync(path.join(OUT_DIR, `${CELL}.validation.json`), JSON.stringify(report, null, 2));
console.error(JSON.stringify(report, null, 2));
console.error(`wrote ${OUT} (${outLines.length} lines)`);
if (report.joinErrors.length || joined.length !== rows.length) process.exit(1);
