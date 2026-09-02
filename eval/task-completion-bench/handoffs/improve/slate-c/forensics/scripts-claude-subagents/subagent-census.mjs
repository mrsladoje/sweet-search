#!/usr/bin/env node
// subagent-census.mjs — $0 forensics over claude-code subagent transcripts (slate C, "claude-subagents").
//
//   node subagent-census.mjs <runId> <out.json>
//
// Runs ON THE EVIDENCE BOX (read-only under results/). Reuses the ledger's own request
// grouping (claude-code-accounting.mjs: one served request = many records sharing message.id;
// the usage-bearing record wins) and the ledger's price/cost functions (ideal-cost.mjs), so every
// dollar here is on the same footing as rows.json. Block-level dedupe for tool calls (e4 parser rule).
//
// Per subagent transcript it records: tools used (ss-* via Bash vs Read/Grep/Glob vs raw shell),
// request count, first-request token size, cost (recorded + imputed for zero-usage requests), whether
// the tool guide text is visible anywhere in its context, the delegation record from the parent
// (subagent_type, model, isolation, prompt prefix, parent-side totalTokens/toolStats).
// Per main transcript: first N calls, index of the first Agent call, requests, cost.
import fs from 'node:fs';
import path from 'node:path';
import { transcriptMetricsFromFile } from '/root/sweet-search-private/eval/task-completion-bench/harness/claude-code-accounting.mjs';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const ROOT = '/root/sweet-search-private/eval/task-completion-bench/results';
const [runId = 'fp-claudecode-tab-20260826', outPath = `/tmp/wf-slatec/claude-subagents/census-${runId}.json`] = process.argv.slice(2);
const FIRST_N = 8;

const walk = (d, out = []) => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, out) : out.push(p); } return out; };
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, runId, 'rows.json'), 'utf8'));
let price; try { price = priceFor(rows[0].model); } catch { price = { in: 0.10, cache: 0.01, out: 0.60 }; }

// ---- tool-guide markers (from core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md and
// scripts/install-claude-system-prompt.js) — presence of ANY of these in a subagent's visible context
// means the guide (or its pointer) reached it through a user-visible channel.
const GUIDE_MARKERS = {
  guideTitle: /code search tool guide/i,
  guideRule: /Open with the cheapest tool for what you hold/i,
  guideDelegate: /Any sub-agent you delegate to must use these/i,
  guideToolsHdr: /## Tools \(search commands, invoked via Bash\)/,
  overridePointer: /MUST follow the sweet-search guidance in `?\.claude\/rules\/sweet-search\.md/i,
  rulesPath: /\.claude\/rules\/sweet-search\.md/,
};
const SS_RE = /(^|[\s;&|(`'"\/])(ss-(search|grep|find|read|semantic|trace|batch|files|edit))(\s|$)/g;
const ABS_SS_RE = /\/[^\s'"]*\/bin\/ss-(search|grep|find|read|semantic|trace|batch)/;
// tool-hunting: looking for the ss-* binaries themselves. NOTE the bench rundir path contains `.ss-eval`, so a
// bare `ss-` substring is NOT a safe marker (it matched ordinary `find /root/.ss-eval/...` commands in the native arm).
const HUNT_RE = /(command -v ss-|which ss-|type ss-|-name ['"]?ss-(\*|search|grep|find|read|semantic|trace)|agent-read-workflows\/bin\/?(\s|$|;|\))|ls [^\n]*\/(usr\/local\/bin|usr\/bin)\/?(\s|$))/;
const HELP_RE = /ss-(search|grep|find|read|semantic|trace)\s+(--help|-h)(\s|$)/;
const RAW_SHELL_RE = /(^|[\s;&|(])(grep|rg|egrep|fgrep|find|cat|sed|head|tail|awk|nl|ls|tree|wc)(\s|$)/;
const GIT_RE = /(^|[\s;&|(])git(\s|$)/;
const TEST_RE = /(^|[\s;&|(])(run_tests|npm test|pytest|go test|cargo test|dotnet test|mix test|jest|mocha|vitest|make test)(\s|$)/;

function classifyBash(cmd) {
  const s = String(cmd || '');
  const ss = []; let m; SS_RE.lastIndex = 0;
  while ((m = SS_RE.exec(s))) ss.push(m[2]);
  const abs = ABS_SS_RE.test(s);
  if (abs) { const mm = s.match(/\/bin\/(ss-[a-z]+)/g) || []; for (const x of mm) ss.push(x.replace('/bin/', '')); }
  const help = HELP_RE.test(s) || (abs && /--help|\s-h(\s|$)/.test(s));
  const hunt = HUNT_RE.test(s);
  const test = TEST_RE.test(s);
  const git = GIT_RE.test(s);
  const raw = RAW_SHELL_RE.test(s) && !ss.length && !hunt;
  let bucket = 'other';
  if (test) bucket = 'test';
  else if (hunt) bucket = 'ss-hunt';
  else if (help) bucket = 'ss-help';
  else if (ss.length) bucket = 'ss';
  else if (git) bucket = 'git';
  else if (raw) bucket = 'raw-shell';
  return { bucket, ss: [...new Set(ss)], absPath: abs, help, hunt };
}

// Parse a transcript into ordered requests (grouped by message.id, first-seen order), each with its
// blocks and usage (usage-bearing record wins — same rule as the ledger). Also collect user-side records.
function parse(file) {
  const recs = jl(file);
  const order = []; const byId = new Map();
  const userRecs = []; let firstUser = null; let cwd = null; let version = null;
  for (const r of recs) {
    if (!cwd && r.cwd) cwd = r.cwd; if (!version && r.version) version = r.version;
    const m = r.message;
    if (r.type === 'user' || (m && m.role === 'user')) { userRecs.push(r); if (!firstUser) firstUser = r; }
    if (r.attachment) userRecs.push(r);
    if (!m || m.role !== 'assistant' || !m.id) continue;
    let g = byId.get(m.id);
    if (!g) { g = { id: m.id, blocks: [], toolUseIds: new Set(), usage: null, best: -1, model: m.model, ts: r.timestamp }; byId.set(m.id, g); order.push(m.id); }
    for (const b of (m.content || [])) {
      if (b.type === 'tool_use' && b.id) { if (g.toolUseIds.has(b.id)) continue; g.toolUseIds.add(b.id); }
      g.blocks.push(b);
    }
    const u = m.usage; if (!u) continue;
    const cached = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    const inp = (u.input_tokens || 0) + cached + cw, out = u.output_tokens || 0;
    if (inp + out > g.best) { g.best = inp + out; g.usage = { in: inp, cached, cacheWrite: cw, out, input_tokens: u.input_tokens || 0 }; }
  }
  // tool results (user-side), keyed by tool_use_id; toolUseResult objects with agentId
  const results = new Map(); const agentResults = [];
  for (const r of userRecs) {
    const m = r.message;
    if (m && Array.isArray(m.content)) for (const b of m.content) {
      if (b.type === 'tool_result' && !results.has(b.tool_use_id)) {
        const c = b.content; const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : JSON.stringify(c ?? '');
        results.set(b.tool_use_id, { text: txt, isError: !!b.is_error });
      }
    }
    if (r.toolUseResult && (r.toolUseResult.agentId || r.toolUseResult.agentType)) agentResults.push({ ts: r.timestamp, ...r.toolUseResult, content: undefined, contentChars: JSON.stringify(r.toolUseResult.content ?? '').length });
  }
  const requests = order.map((id, i) => { const g = byId.get(id); return { i, id: g.id, usage: g.usage, blocks: g.blocks, model: g.model, ts: g.ts }; });
  const calls = [];
  for (const rq of requests) for (const b of rq.blocks) if (b.type === 'tool_use') {
    const res = results.get(b.id) || null;
    calls.push({ req: rq.i, id: b.id, name: b.name, input: b.input || {}, result: res ? res.text : null, isError: res ? res.isError : null });
  }
  return { recs, requests, calls, userRecs, firstUser, cwd, version, agentResults };
}

function usageTurns(requests) { return requests.filter(r => r.usage && (r.usage.in || r.usage.out)).map(r => r.usage); }

// Impute zero-usage requests from neighbours (the ledger refuses to; we label it [I]).
function imputedTurns(requests) {
  const T = requests.map(r => r.usage && (r.usage.in || r.usage.out) ? { ...r.usage } : null);
  const outs = T.filter(Boolean).map(t => t.out).sort((a, b) => a - b); const medOut = outs.length ? outs[Math.floor(outs.length / 2)] : 0;
  for (let i = 0; i < T.length; i++) if (!T[i]) {
    let p = i - 1; while (p >= 0 && !T[p]) p--; let n = i + 1; while (n < T.length && !T[n]) n++;
    const pin = p >= 0 ? T[p].in : null, nin = n < T.length ? T[n].in : null;
    const inp = pin != null && nin != null ? Math.round((pin + nin) / 2) : (pin ?? nin ?? 0);
    T[i] = { in: inp, cached: Math.max(0, inp - 500), cacheWrite: 0, out: medOut, imputed: true };
  }
  return T;
}

function guideScan(p) {
  const hits = {}; const where = {};
  const scan = (txt, loc) => { for (const [k, re] of Object.entries(GUIDE_MARKERS)) if (re.test(txt)) { hits[k] = (hits[k] || 0) + 1; (where[k] ??= new Set()).add(loc); } };
  for (const r of p.userRecs) {
    const m = r.message;
    if (m) { const c = m.content; scan(typeof c === 'string' ? c : JSON.stringify(c), r === p.firstUser ? 'delegation-prompt' : 'tool-result-or-user'); }
    if (r.attachment) scan(JSON.stringify(r.attachment), 'attachment:' + (r.attachment.type || '?'));
  }
  return { hits, where: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, [...v]])) };
}

function toolProfile(calls) {
  const byName = {}; const bash = { ss: 0, 'ss-help': 0, 'ss-hunt': 0, 'raw-shell': 0, git: 0, test: 0, other: 0 };
  const ssTools = {}; let ssAbsPath = 0, ssBare = 0, pagesErr = 0, ssErr = 0, ssNoIndex = 0, cmdNotFound = 0;
  let firstSSCall = null, firstSSReq = null, firstRawShell = null;
  const ssFailReqSet = new Set(), ssOkReqSet = new Set();
  const seq = [];
  calls.forEach((c, idx) => {
    byName[c.name] = (byName[c.name] || 0) + 1;
    let tag = c.name;
    if (c.name === 'Bash') {
      const k = classifyBash(c.input.command);
      bash[k.bucket]++; tag = `Bash:${k.bucket}`;
      if (k.bucket === 'ss') { for (const t of k.ss) ssTools[t] = (ssTools[t] || 0) + 1; if (k.absPath) ssAbsPath++; else ssBare++; if (firstSSCall == null) { firstSSCall = idx; firstSSReq = c.req; } tag += ':' + k.ss.join('+'); }
      if (k.bucket === 'raw-shell' && firstRawShell == null) firstRawShell = idx;
      const res = String(c.result || '');
      if (k.ss.length && /\[ss-\*\] no Sweet Search index/.test(res)) ssNoIndex++;
      if (k.ss.length && /^Exit code [1-9]/m.test(res)) { ssErr++; ssFailReqSet.add(c.req); } else if (k.ss.length) ssOkReqSet.add(c.req);
      if (/command not found/.test(res)) cmdNotFound++;
    }
    if (c.name === 'Read' && /Invalid pages parameter/.test(String(c.result || ''))) pagesErr++;
    seq.push(tag);
  });
  for (const r of ssOkReqSet) ssFailReqSet.delete(r);   // a request is 'failed' only if every ss-* call in it failed
  return { byName, bash, ssTools, ssAbsPath, ssBare, pagesErr, ssErr, ssNoIndex, cmdNotFound, firstSSCall, firstSSReq, firstRawShell, seq, ssFailReqs: [...ssFailReqSet] };
}

function briefInput(c) {
  const i = c.input || {};
  if (c.name === 'Bash') return String(i.command || '').replace(/\s+/g, ' ').slice(0, 140);
  if (c.name === 'Agent' || c.name === 'Task') return `${i.subagent_type || '?'}/${i.model || 'inherit'}/${i.isolation || 'none'}${i.run_in_background ? '/bg' : ''}: ${String(i.description || i.prompt || '').slice(0, 90)}`;
  if (i.file_path) return `${path.basename(i.file_path)}${i.offset != null ? ` @${i.offset}+${i.limit ?? ''}` : ''}`;
  if (i.pattern) return `${i.pattern}${i.path ? ' in ' + path.basename(i.path) : ''}`.slice(0, 120);
  return JSON.stringify(i).slice(0, 120);
}

const out = { runId, price, cells: [] };
const state = path.join(ROOT, runId, 'agent-state');
for (const cell of fs.readdirSync(state).sort()) {
  const mm = cell.match(/^(.*)-(native|sweet)$/); if (!mm) continue;
  const [, task, arm] = mm;
  const all = walk(path.join(state, cell)).filter(f => f.endsWith('.jsonl') && f.includes('/claude-home/projects/'));
  const mains = all.filter(f => !f.includes('/subagents/'));
  for (const mf of mains) {
    const slug = mf.match(/-root--ss-eval-runs-(r(\d+)-\d+)/); const rep = slug ? Number(slug[2]) : null;
    const sid = path.basename(mf, '.jsonl');
    const subFiles = all.filter(f => f.includes(`/${sid}/subagents/`)).sort();
    const P = parse(mf);
    const row = rows.find(r => r.taskId === task && r.arm === arm && r.rep === rep) || null;
    const turns = usageTurns(P.requests);
    const cost = costFromTurns(turns, price);
    const agentCalls = P.calls.filter(c => c.name === 'Agent' || c.name === 'Task');
    const firstAgentIdx = P.calls.findIndex(c => c.name === 'Agent' || c.name === 'Task');
    const main = {
      file: mf.replace(ROOT + '/', ''), sessionId: sid, rep, version: P.version, cwd: P.cwd,
      row: row ? { resolved: row.resolved, calls: row.calls, ss: row.ss, sidechainTurns: row.sidechainTurns, costRealizedUsd: row.costRealizedUsd, idealCostUsd: row.idealCostUsd, sidechainAccountingComplete: row.sidechainAccountingComplete } : null,
      requests: P.requests.length, usageRequests: turns.length,
      firstRequestIn: turns[0]?.in ?? null, firstRequestBreakdown: turns[0] ? { input: turns[0].input_tokens, cached: turns[0].cached, cacheWrite: turns[0].cacheWrite } : null,
      idealCostUsd: +cost.idealUsd.toFixed(6), realFromTurnsUsd: +cost.realFromTurnsUsd.toFixed(6),
      totalIn: turns.reduce((a, t) => a + t.in, 0), totalOut: turns.reduce((a, t) => a + t.out, 0),
      calls: P.calls.length, tools: toolProfile(P.calls),
      firstCalls: P.calls.slice(0, FIRST_N).map((c, i) => ({ i, req: c.req, name: c.name, brief: briefInput(c) })),
      firstAgentIdx, callsBeforeFirstAgent: firstAgentIdx >= 0 ? P.calls.slice(0, firstAgentIdx).map(c => c.name === 'Bash' ? `Bash:${classifyBash(c.input.command).bucket}` : c.name) : null,
      agentCalls: agentCalls.map(c => ({ id: c.id, req: c.req, callIdx: P.calls.indexOf(c), subagent_type: c.input.subagent_type, model: c.input.model, isolation: c.input.isolation, run_in_background: !!c.input.run_in_background, description: c.input.description, promptChars: String(c.input.prompt || '').length, promptPrefix: String(c.input.prompt || '').slice(0, 220), promptMentionsSS: /ss-(search|grep|find|read|semantic|trace|\*)/.test(String(c.input.prompt || '')), promptSaysVerbatimGuide: /system prompt verbatim|tool guide|sweet-search\.md/i.test(String(c.input.prompt || '')) })),
      agentResults: P.agentResults,
      subagents: [],
    };
    for (const sf of subFiles) {
      const S = parse(sf);
      const agentId = path.basename(sf, '.jsonl').replace(/^agent-/, '');
      const st = usageTurns(S.requests);
      const sc = costFromTurns(st, price);
      const it = imputedTurns(S.requests); const ic = costFromTurns(it, price);
      const ledger = transcriptMetricsFromFile(sf);
      const link = main.agentResults.find(a => a.agentId === agentId) || null;
      const firstPrompt = S.firstUser?.message?.content; const promptTxt = typeof firstPrompt === 'string' ? firstPrompt : JSON.stringify(firstPrompt ?? '');
      const call = agentCalls.find(c => String(c.input.prompt || '') === promptTxt) || (link ? agentCalls.find(c => String(c.input.prompt || '') === String(link.prompt || '')) : null) || null;
      const tp = toolProfile(S.calls);
      // requests up to and including the one that issued the first successful-looking ss-* call
      const preSSReqs = tp.firstSSReq != null ? tp.firstSSReq : null;
      const preSSCost = preSSReqs != null ? costFromTurns(it.slice(0, preSSReqs), price).idealUsd : null;
      // ideal cost of the requests whose every ss-* call failed (syntax guessing without the guide)
      let ssFailCost = 0; { let prev = 0; it.forEach((t, i) => { const newIn = Math.max(0, t.in - prev); const c = (newIn * price.in + (t.in - newIn) * price.cache + t.out * price.out) / 1e6; if (tp.ssFailReqs.includes(i)) ssFailCost += c; prev = t.in; }); }
      main.subagents.push({
        file: sf.replace(ROOT + '/', ''), agentId, cwd: S.cwd, inWorktree: /\/\.claude\/worktrees\//.test(String(S.cwd || '')),
        agentType: link?.agentType || call?.input.subagent_type || null, requestedModel: call?.input.model || null, resolvedModel: link?.resolvedModel || S.requests[0]?.model || null,
        isolation: call?.input.isolation || null, background: !!(call?.input.run_in_background),
        promptChars: promptTxt.length, promptPrefix: promptTxt.slice(0, 220), promptMentionsSS: /ss-(search|grep|find|read|semantic|trace|\*)/.test(promptTxt),
        requests: S.requests.length, usageRequests: st.length, zeroUsageRequests: S.requests.length - st.length,
        ledgerAssistantMessages: ledger.assistantMessages, ledgerUsageMessages: ledger.usageMessages, ledgerComplete: ledger.instrumentationComplete,
        firstRequestIn: st[0]?.in ?? null, firstRequestBreakdown: st[0] ? { input: st[0].input_tokens, cached: st[0].cached, cacheWrite: st[0].cacheWrite } : null, firstRequestIsFirst: !!(S.requests[0]?.usage && S.requests[0].usage.in),
        totalIn: st.reduce((a, t) => a + t.in, 0), totalOut: st.reduce((a, t) => a + t.out, 0), maxIn: Math.max(0, ...st.map(t => t.in)),
        idealCostUsd: +sc.idealUsd.toFixed(6), realFromTurnsUsd: +sc.realFromTurnsUsd.toFixed(6),
        imputedIdealCostUsd: +ic.idealUsd.toFixed(6), imputedRealUsd: +ic.realFromTurnsUsd.toFixed(6),
        parentTotalTokens: link?.totalTokens ?? null, parentUsage: link?.usage ? { input: link.usage.input_tokens, cw: link.usage.cache_creation_input_tokens, cr: link.usage.cache_read_input_tokens, out: link.usage.output_tokens } : null, parentToolStats: link?.toolStats || null, parentToolUseCount: link?.totalToolUseCount ?? null, parentStatus: link?.status || null, parentDurationMs: link?.totalDurationMs ?? null,
        calls: S.calls.length, tools: tp, preSSRequests: preSSReqs, preSSIdealCostUsd: preSSCost != null ? +preSSCost.toFixed(6) : null, ssFailRequests: tp.ssFailReqs.length, ssFailIdealCostUsd: +ssFailCost.toFixed(6),
        guide: guideScan(S),
        sendMessage: S.calls.filter(c => c.name === 'SendMessage').length,
      });
    }
    out.cells.push({ task, arm, ...main });
  }
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`wrote ${outPath}: ${out.cells.length} main transcripts, ${out.cells.reduce((a, c) => a + c.subagents.length, 0)} subagent transcripts`);
