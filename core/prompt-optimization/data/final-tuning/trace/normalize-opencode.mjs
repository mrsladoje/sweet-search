#!/usr/bin/env node
/**
 * normalize-opencode — r282 opencode cells -> request-level trace (SCHEMA.md).
 *
 *   node core/prompt-optimization/data/final-tuning/trace/normalize-opencode.mjs <cell>
 *   cells: oc-dsflash41 | oc-sol61-high
 *   options: --sessions <dir>   (default ~/.ss-eval/r282)   session root, read-only
 *            --results <dir>    (default <private checkout>/core/prompt-optimization/data/results)
 *            --out <dir>        (default <worktree>/core/prompt-optimization/data/results/final-tuning-trace)
 *            --quiet
 *
 * Sources (all read-only): runs.jsonl, captures/, ~/.ss-eval/r282/<cell>/oc-data-{native,sweet}/opencode.db.
 * Each opencode.db (+ -wal/-shm) is COPIED to a temp dir and the copy is opened read-only, so the live
 * store is never opened for writing.
 *
 * One request = one assistant message = one step (step-start ... step-finish). Tokens come from the
 * step-finish part, the same numbers the runner's parseOpencodeStream read from the stdout stream.
 * Cost uses the runner's own price table and per-turn formula (ideal-cost.mjs costFromTurns), so the
 * sums reconcile with runs.jsonl costRealizedUsd.
 *
 * Token convention (same as the Codex convention in SCHEMA.md):
 *   tok.out       = step-finish tokens.output + tokens.reasoning   (billed completion tokens; runner basis)
 *   tok.reasoning = step-finish tokens.reasoning                    (a COUNT reported by the provider, subset of out)
 *   tok.outVisible= step-finish tokens.output                       (extra field: out without reasoning)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');                     // worktree root
const PRIVATE = '/Users/admin/Projects/sweet-search-private';         // main checkout (runs.jsonl live here)
const H = path.join(WT, 'eval/task-completion-bench/harness');
const { priceFor, costFromTurns } = await import(path.join(H, 'ideal-cost.mjs'));
const { resolveRepoCwd } = await import(path.join(WT, 'core/prompt-optimization/sweep/gepa-evaluate.mjs'));

const CELLS = {
  'oc-dsflash41': { model: 'deepseek/deepseek-flash', price: 'deepseek/deepseek-flash', reasoningText: true },
  'oc-sol61-high': { model: 'openai/gpt-6.1-sol', price: 'openai/gpt-6.1-sol', reasoningText: false },
};
const SETS = [
  ['vault', 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'],
  ['heldout', 'core/prompt-optimization/data/frozen/p7-heldout-probes.json'],
  ['ood', 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json'],
];

// ---- tool naming (FINAL_TUNING.md 2.2) ---------------------------------------------------------------
const SS_TOOLS = new Set(['ss-search', 'ss-grep', 'ss-find', 'ss-read', 'ss-semantic', 'ss-trace', 'ss-batch']);
const WRAPPERS = new Set(['timeout', 'env', 'time', 'nohup', 'command', 'exec', 'nice', 'stdbuf', 'builtin']);
function splitWords(s) {                     // shell-ish word split: quotes kept out of the words
  const out = []; let cur = ''; let q = null; let has = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; else if (ch === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has || cur) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch; has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}
/** First command word of ONE simple command: skips `cd X &&`, env assignments, timeout N, env, etc. */
function firstCommandWord(segment) {
  let words = splitWords(segment.trim().replace(/^[({]+\s*/, ''));
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue; }                     // VAR=value
    if (w === 'cd' || w === 'pushd') { return null; }                              // handled by the caller (skip the segment)
    if (WRAPPERS.has(w)) {
      i++;
      if (w === 'timeout') { while (i < words.length && (/^-/.test(words[i]) || /^\d+[smhd]?$/.test(words[i]))) i++; }
      else if (w === 'env') { while (i < words.length && (/^-/.test(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) i++; }
      continue;
    }
    return path.basename(w.replace(/[;&|)}]+$/, ''));                              // BASENAME, never a substring match
  }
  return null;
}
/** Split a shell line into simple commands at && || ; | and newlines (quote-aware). */
function simpleCommands(cmd) {
  const segs = []; let cur = ''; let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { cur += ch; if (ch === q) q = null; else if (ch === '\\' && q === '"') cur += cmd[++i] ?? ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '&' && cmd[i + 1] === '&') { segs.push(cur); cur = ''; i++; continue; }
    if (ch === '|' && cmd[i + 1] === '|') { segs.push(cur); cur = ''; i++; continue; }
    if (ch === ';' || ch === '\n' || ch === '|') { segs.push(cur); cur = ''; continue; }
    if (ch === '>' && cmd[i - 1] === '2') { cur += ch; continue; }
    cur += ch;
  }
  segs.push(cur);
  return segs.map(s => s.trim()).filter(Boolean);
}
function classifyShell(cmd) {
  const segs = simpleCommands(String(cmd || ''));
  const words = [];
  for (const s of segs) {
    if (/^(cd|pushd)\s/.test(s)) continue;                   // `cd X && real-command`
    const w = firstCommandWord(s);
    if (w) words.push(w);
  }
  const first = words[0] || null;
  const ss = words.filter(w => SS_TOOLS.has(w));
  const pipeline = segs.length > 1 || /[|]|&&|;/.test(String(cmd || ''));
  if (first && SS_TOOLS.has(first)) return { tool: first, sub: 'shell', ssAll: ss, pipeline };
  if (ss.length) return { tool: ss[0], sub: 'shell', ssAll: ss, pipeline };        // e.g. `ls x && ss-search ...`
  return { tool: 'bash', sub: first, ssAll: [], pipeline };
}
function argTextOf(tool, input) {
  if (!input || typeof input !== 'object') return String(input ?? '');
  if (typeof input.command === 'string') return input.command;
  const parts = [];
  for (const [k, v] of Object.entries(input)) parts.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return parts.join(' ');
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n) : s);

// ---- helpers --------------------------------------------------------------------------------------------
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const sum = a => a.reduce((x, y) => x + y, 0);
function openCopy(dbPath, tmpRoot) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  for (const ext of ['', '-wal', '-shm']) {
    const src = dbPath + ext;
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpRoot, `opencode.db${ext}`));
  }
  return new Database(path.join(tmpRoot, 'opencode.db'), { readonly: true });
}
function loadProbes() {
  const byId = new Map();
  for (const [set, rel] of SETS) {
    const raw = JSON.parse(fs.readFileSync(path.join(PRIVATE, rel), 'utf8'));
    for (const p of (Array.isArray(raw) ? raw : raw.probes)) byId.set(p.id, { ...p, _set: set });
  }
  return byId;
}
const cloneOf = (cell, probe) => path.join(os.homedir(), '.ss-eval/r282-repos', cell, path.relative(WT, resolveRepoCwd(probe, {})).replace(/[\\/]/g, '__'));

// ---- session -> requests --------------------------------------------------------------------------------
function readSession(db, sess, PRICE, cfg) {
  const msgs = db.prepare('select id, time_created, data from message where session_id=? order by time_created, id').all(sess.id)
    .map(m => ({ id: m.id, created: m.time_created, ...JSON.parse(m.data) }));
  const parts = db.prepare('select id, message_id, time_created, data from part where session_id=? order by id').all(sess.id);
  const byMsg = new Map();
  for (const p of parts) { let a = byMsg.get(p.message_id); if (!a) byMsg.set(p.message_id, a = []); a.push({ id: p.id, ...JSON.parse(p.data) }); }
  const firstUser = msgs.find(m => m.role === 'user');
  const userText = (byMsg.get(firstUser?.id) || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
  const requests = []; const incomplete = []; let answer = '';
  for (const m of msgs) {
    if (m.role !== 'assistant') continue;
    const ps = byMsg.get(m.id) || [];
    const fin = ps.find(p => p.type === 'step-finish');
    if (!fin) { incomplete.push(m.id); continue; }
    const tk = fin.tokens || {}; const cache = tk.cache || {};
    const uncached = tk.input || 0, cr = cache.read || 0, cw = cache.write || 0;
    const reasoning = tk.reasoning || 0, outVisible = tk.output || 0;
    const turn = { in: uncached + cr + cw, cached: cr, cacheWrite: cw, out: outVisible + reasoning };   // = runner's parseOpencodeStream
    const costUsd = costFromTurns([turn], PRICE).realFromTurnsUsd;
    const texts = ps.filter(p => p.type === 'text' && typeof p.text === 'string');
    for (const t of texts) if (t.text.trim()) answer = t.text;                                            // runner: last non-empty text event
    const reas = ps.filter(p => p.type === 'reasoning');
    const reasoningChars = sum(reas.map(p => (p.text || '').length));
    const calls = [];
    for (const p of ps) {
      if (p.type !== 'tool') continue;
      const st = p.state || {};
      const input = st.input ?? {};
      const isErr = st.status === 'error';
      const resultText = isErr ? String(st.error ?? '') : (typeof st.output === 'string' ? st.output : JSON.stringify(st.output ?? ''));
      let tool = p.tool, sub = null, extra = {};
      if (String(p.tool).toLowerCase() === 'bash' || String(p.tool).toLowerCase() === 'shell') {
        const c = classifyShell(input.command ?? input.cmd);
        tool = c.tool; sub = c.sub;
        if (c.pipeline) extra.pipeline = true;
        if (c.ssAll.length > 1) extra.ssAll = c.ssAll;
        if (c.tool === 'bash') extra.nativeVia = 'bash';
        extra.harnessTool = p.tool;
      }
      const argFull = argTextOf(p.tool, input);
      calls.push({
        callId: String(p.callID ?? p.id),
        tool, sub,
        argChars: JSON.stringify(input).length,
        argText: trunc(argFull, 2000),
        resultChars: resultText.length,
        resultTokensEst: Math.ceil(resultText.length / 4),
        resultText,
        isError: isErr,
        status: st.status ?? null,
        ...extra,
      });
    }
    requests.push({
      cell: cfg.cell, arm: cfg.arm, id: cfg.id, set: cfg.set, lang: cfg.lang, stratum: cfg.stratum,
      sessionId: sess.id, thread: 'main', req: requests.length,
      model: `${m.providerID}/${m.modelID}`,
      tok: { inUncached: uncached, cacheRead: cr, cacheWrite: cw, inTotal: uncached + cr + cw, out: outVisible + reasoning, reasoning: tk.reasoning == null ? null : reasoning, outVisible },
      costUsd,
      textOutChars: sum(texts.map(p => p.text.length)),
      thinkingChars: reasoningChars,
      reasoningText: cfg.reasoningText ? (reas.length ? reas.map(p => p.text || '').join('\n') : '') : null,
      calls,
      finish: m.finish ?? fin.reason ?? null,
      t0: m.time?.created ?? null, t1: m.time?.completed ?? null,
      costOpencodeUsd: typeof fin.cost === 'number' ? fin.cost : null,
    });
  }
  return { requests, incomplete, userText, answer, nTool: sum(requests.map(r => r.calls.length)) };
}

// ---- main ---------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
const CELL = argv.find(a => !a.startsWith('--') && CELLS[a]);
if (!CELL) { console.error(`usage: normalize-opencode.mjs <${Object.keys(CELLS).join('|')}> [--sessions dir] [--results dir] [--out dir]`); process.exit(2); }
const cfgCell = CELLS[CELL];
const QUIET = argv.includes('--quiet');
const SESS_ROOT = flag('--sessions', path.join(os.homedir(), '.ss-eval/r282'));
const RESULTS = flag('--results', path.join(PRIVATE, 'core/prompt-optimization/data/results'));
const OUT_DIR = flag('--out', path.join(WT, 'core/prompt-optimization/data/results/final-tuning-trace'));
const PRICE = priceFor(cfgCell.price);
const log = (...a) => { if (!QUIET) console.log(...a); };

const rows = readJsonl(path.join(RESULTS, `r282-${CELL}`, 'runs.jsonl'));
const probes = loadProbes();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ft-${CELL}-`));
const errors = [];                                                     // join / parse errors (hard)
const traceLines = [];
const rollouts = [];
const claimedSessions = new Map();                                     // `${arm}|${sessionId}` -> row id

for (const arm of ['native', 'sweet']) {
  const dbPath = path.join(SESS_ROOT, CELL, `oc-data-${arm}`, 'opencode.db');
  const db = openCopy(dbPath, path.join(tmp, arm));
  const sessions = db.prepare('select id, directory, parent_id, time_created, time_updated from session order by time_created').all();
  const parsed = new Map();                                            // sessionId -> first user text
  const firstUserText = db.prepare(`select group_concat(json_extract(p.data,'$.text'), char(10)) t from part p join message m on m.id=p.message_id
     where m.session_id=? and json_extract(m.data,'$.role')='user' and json_extract(p.data,'$.type')='text' group by m.id order by m.time_created limit 1`);
  for (const s of sessions) parsed.set(s.id, firstUserText.get(s.id)?.t ?? '');
  const armRows = rows.filter(r => r.arm === arm);
  for (const row of armRows) {
    const probe = probes.get(row.id);
    if (!probe) { errors.push(`${arm}|${row.id}: probe not found`); continue; }
    const dir = cloneOf(CELL, probe);
    // JOIN KEY: arm (= which DB) + clone path + question text in the first user message. The user text is
    // wrapped in quotes with inner quotes backslash-escaped, so match on the exact tail `Question: <query>` + optional quote.
    const q = probe.query;
    const cands = sessions.filter(s => {
      if (s.directory !== dir) return false;
      const t = parsed.get(s.id) || '';
      const i = t.lastIndexOf('Question: ');
      if (i < 0) return false;
      const tail = t.slice(i + 'Question: '.length).replace(/"$/, '').replace(/\\"/g, '"');
      return tail === q;
    });
    if (cands.length !== 1) { errors.push(`${arm}|${row.id}: joins ${cands.length} sessions`); continue; }
    const sess = cands[0];
    const ck = `${arm}|${sess.id}`;
    if (claimedSessions.has(ck)) { errors.push(`${arm}|${row.id}: session ${sess.id} already claimed by ${claimedSessions.get(ck)}`); continue; }
    claimedSessions.set(ck, row.id);
    const cfg = { cell: CELL, arm, id: row.id, set: row.set, lang: row.lang, stratum: row.stratum, reasoningText: cfgCell.reasoningText };
    const s = readSession(db, sess, PRICE, cfg);
    const reqs = s.requests;
    for (const r of reqs) traceLines.push(JSON.stringify(r));
    const costSum = sum(reqs.map(r => r.costUsd));
    const runnerCost = row.costRealizedUsd;
    const userChars = s.userText.length;
    const req0 = reqs[0];
    const prefixTokens = req0 ? Math.max(0, req0.tok.inTotal - Math.ceil(userChars / 4)) : null;
    const summary = {
      type: 'rollout', cell: CELL, arm, id: row.id, set: row.set, lang: row.lang, stratum: row.stratum,
      sessionId: sess.id, requests: reqs.length, turns: reqs.length, calls: s.nTool,
      costUsdSum: +costSum.toFixed(6), runnerCostUsd: runnerCost,
      reconDiffPct: runnerCost ? +(((costSum - runnerCost) / runnerCost) * 100).toFixed(4) : null,
      prefixTokens,
      prefixMethod: 'req0.tok.inTotal minus ceil(userMessageChars/4); user message = frame + question (first user text part, includes the wrapping quotes). The store does not hold the request body, so this is an estimate (+-20 tokens).',
      req0InTotal: req0?.tok.inTotal ?? null, req0CacheRead: req0?.tok.cacheRead ?? null, userMsgChars: userChars,
      answer: s.answer,
      // join / consistency evidence
      runnerTurns: row.usage?.turns ?? null, runnerCalls: row.calls ?? null,
      wallMs: row.wallMs ?? null, sessionSpanMs: sess.time_updated - sess.time_created,
      incompleteAssistantMessages: s.incomplete.length, parentId: sess.parent_id ?? null, directory: sess.directory,
      costNaiveRunnerUsd: row.costNaiveUsd ?? null,
    };
    rollouts.push(summary);
    traceLines.push(JSON.stringify(summary));
  }
  // orphan sessions: in the store but claimed by no runner row
  for (const s of sessions) if (!claimedSessions.has(`${arm}|${s.id}`)) errors.push(`${arm}: session ${s.id} (${s.directory}) joins no runner row`);
  db.close();
}
fs.rmSync(tmp, { recursive: true, force: true });

// ---- validation ---------------------------------------------------------------------------------------
const joinOk = errors.length === 0 && rollouts.length === rows.length;
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const diffs = rollouts.map(r => r.reconDiffPct).filter(Number.isFinite);
const within = t => diffs.filter(d => Math.abs(d) <= t).length;
const pooled = { traceSum: sum(rollouts.map(r => r.costUsdSum)), runnerSum: sum(rollouts.map(r => r.runnerCostUsd || 0)) };
pooled.diffPct = ((pooled.traceSum - pooled.runnerSum) / pooled.runnerSum) * 100;
const byArm = {};
for (const arm of ['native', 'sweet']) {
  const rs = rollouts.filter(r => r.arm === arm);
  byArm[arm] = { n: rs.length, traceSum: sum(rs.map(r => r.costUsdSum)), runnerSum: sum(rs.map(r => r.runnerCostUsd || 0)) };
  byArm[arm].diffPct = ((byArm[arm].traceSum - byArm[arm].runnerSum) / byArm[arm].runnerSum) * 100;
}
const validation = {
  cell: CELL, runnerRows: rows.length, rolloutsJoined: rollouts.length, joinErrors: errors,
  joinOk,
  turnsMatchRunner: rollouts.filter(r => r.turns === r.runnerTurns).length,
  callsMatchRunner: rollouts.filter(r => r.calls === r.runnerCalls).length,
  incompleteAssistantMessages: sum(rollouts.map(r => r.incompleteAssistantMessages)),
  subagentSessions: rollouts.filter(r => r.parentId).length,
  recon: {
    n: diffs.length, within2pct: within(2), within2pctShare: diffs.length ? within(2) / diffs.length : null, within0_1pct: within(0.1),
    min: Math.min(...diffs), p50: pct(diffs, 0.5), p95: pct(diffs.map(Math.abs), 0.95), maxAbs: Math.max(...diffs.map(Math.abs)),
    pooled, byArm,
  },
  wallVsSessionSpan: { // sanity: runner wallMs includes process start-up, so it should be >= session span
    wallLtSpan: rollouts.filter(r => r.wallMs != null && r.wallMs + 50 < r.sessionSpanMs).length,
    medianGapMs: pct(rollouts.map(r => r.wallMs - r.sessionSpanMs), 0.5),
  },
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `${CELL}.trace.jsonl`), traceLines.join('\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, `${CELL}.validation.json`), JSON.stringify(validation, null, 2) + '\n');
log(`${CELL}: ${rollouts.length}/${rows.length} rollouts joined, ${traceLines.length - rollouts.length} request records -> ${path.join(OUT_DIR, `${CELL}.trace.jsonl`)}`);
log(`join errors: ${errors.length}${errors.length ? '\n  ' + errors.slice(0, 20).join('\n  ') : ''}`);
log(`turns==runner ${validation.turnsMatchRunner}/${rollouts.length}  calls==runner ${validation.callsMatchRunner}/${rollouts.length}  incomplete assistant msgs ${validation.incompleteAssistantMessages}  subagent sessions ${validation.subagentSessions}`);
log(`recon |diff|<=2%: ${validation.recon.within2pct}/${diffs.length}  maxAbs ${validation.recon.maxAbs.toFixed(3)}%  pooled ${pooled.diffPct.toFixed(4)}%  native ${byArm.native.diffPct.toFixed(4)}%  sweet ${byArm.sweet.diffPct.toFixed(4)}%`);
if (!joinOk) process.exitCode = 1;
