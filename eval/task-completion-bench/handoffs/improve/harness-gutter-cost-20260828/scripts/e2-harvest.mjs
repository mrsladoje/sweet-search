#!/usr/bin/env node
// e2-harvest.mjs — rebuild every rollout's cost from its OWN transcript and decompose it.
// Read-only. Writes JSON to stdout / --out.
//
// Price vector: openai/gpt-5.6-luna on OpenRouter — $0.10/M new input, $0.01/M cached
// re-sent input, $0.60/M output incl. reasoning (eval/.../harness/ideal-cost.mjs MODEL_PRICES).
import fs from 'node:fs';
import path from 'node:path';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const ROOT = '/root/sweet-search-private/eval/task-completion-bench';
const PRICE = { in: 0.10, cache: 0.01, out: 0.60 };

const RUNS = [
  // epoch C — fresh pool, 22 tasks x 3 reps
  { run: 'fp-codex-tab-20260826',       harness: 'codex',       epoch: 'C', form: 'tab'  },
  { run: 'fp-codex-none-20260826',      harness: 'codex',       epoch: 'C', form: 'none' },
  { run: 'fp-codex-pipe-20260826',      harness: 'codex',       epoch: 'C', form: 'pipe' },
  { run: 'fp-opencode-tab-20260826',    harness: 'opencode',    epoch: 'C', form: 'tab'  },
  { run: 'fp-opencode-none-20260826',   harness: 'opencode',    epoch: 'C', form: 'none' },
  { run: 'fp-opencode-pipe-20260826',   harness: 'opencode',    epoch: 'C', form: 'pipe' },
  { run: 'rp-oc-tab-20260827',          harness: 'opencode',    epoch: 'C', form: 'tab',  repair: true },
  { run: 'rp-oc-none-20260827',         harness: 'opencode',    epoch: 'C', form: 'none', repair: true },
  { run: 'rp-oc-pipe-20260827',         harness: 'opencode',    epoch: 'C', form: 'pipe', repair: true },
  { run: 'fp-claudecode-tab-20260826',  harness: 'claude-code', epoch: 'C', form: 'tab'  },
  { run: 'fp-claudecode-none-20260826', harness: 'claude-code', epoch: 'C', form: 'none' },
  { run: 'fp-claudecode-pipe-20260826', harness: 'claude-code', epoch: 'C', form: 'pipe' },
  // epoch B — post-fix rebaseline, 13 tasks x 3 reps
  { run: 'rb-codex-20260825',           harness: 'codex',       epoch: 'B', form: 'tab' },
  { run: 'rb-opencode-20260824',        harness: 'opencode',    epoch: 'B', form: 'tab' },
  { run: 'rb-claudecode-20260824',      harness: 'claude-code', epoch: 'B', form: 'tab' },
  // epoch A — pre gutter-fix, 17 tasks x 2 reps
  { run: 'sb-codex-20260811',           harness: 'codex',       epoch: 'A', form: 'pipe' },
  { run: 'sb-opencode-20260811',        harness: 'opencode',    epoch: 'A', form: 'pipe' },
  { run: 'sb-claudecode-20260811',      harness: 'claude-code', epoch: 'A', form: 'pipe' },
];

// ---------- pricing ----------
function priceTurns(turns, { cacheWritePremium }) {
  let ingest = 0, resident = 0, output = 0, realized = 0, breakPriced = 0;
  let prevIn = 0, tokIn = 0, tokNewIn = 0, tokResent = 0, tokCached = 0, tokCw = 0, tokOut = 0;
  let cacheMissTurns = 0, ctxIntegral = 0;
  for (const tu of turns) {
    const IN = Number(tu.in) || 0, cached = Number(tu.cached) || 0;
    const cw = Math.max(0, Math.min(Number(tu.cacheWrite) || 0, IN - cached));
    const out = Number(tu.out) || 0;
    const newIn = Math.max(0, IN - prevIn);
    const resent = IN - newIn;
    ingest += newIn * PRICE.in / 1e6;
    resident += resent * PRICE.cache / 1e6;
    output += out * PRICE.out / 1e6;
    realized += cacheWritePremium
      ? ((IN - cached - cw) * PRICE.in + cw * PRICE.in * 1.25 + cached * PRICE.cache + out * PRICE.out) / 1e6
      : ((IN - cached) * PRICE.in + cached * PRICE.cache + out * PRICE.out) / 1e6;
    const cacheable = IN < prevIn ? 0 : Math.min(prevIn, IN);
    breakPriced += ((IN - cacheable) * PRICE.in + cacheable * PRICE.cache + out * PRICE.out) / 1e6;
    // cache-miss event: the provider re-billed a prefix it had already been sent
    if (prevIn > 0 && cached < 0.5 * prevIn) cacheMissTurns++;
    tokIn += IN; tokNewIn += newIn; tokResent += resent; tokCached += cached; tokCw += cw; tokOut += out;
    ctxIntegral += IN;
    prevIn = IN;
  }
  return { ingestUsd: ingest, residentUsd: resident, outputUsd: output,
    idealUsd: ingest + resident + output, realizedUsd: realized, breakPricedUsd: breakPriced,
    tokIn, tokNewIn, tokResent, tokCached, tokCacheWrite: tokCw, tokOut,
    cacheMissTurns, ctxIntegral,
    firstTurnIn: turns.length ? (Number(turns[0].in) || 0) : 0,
    lastTurnIn: turns.length ? (Number(turns[turns.length - 1].in) || 0) : 0,
    cacheHitRatio: tokIn ? tokCached / tokIn : 0,
    turns: turns.length };
}

// ---------- tool-family classification ----------
const SS_TOOLS = ['ss-search', 'ss-semantic', 'ss-trace', 'ss-grep', 'ss-find', 'ss-read', 'ss-files', 'ss-edit'];
function familiesOfCmd(cmd) {
  const c = String(cmd || '');
  const fams = [];
  for (const t of SS_TOOLS) {
    const re = new RegExp(`(^|[;&|(\\n\`$]|\\s)${t}\\b`);
    if (re.test(c)) fams.push(t);
  }
  if (/(^|[;&|(\n`$]|\s)run_tests\b/.test(c)) fams.push('run_tests');
  if (/apply_patch/.test(c)) fams.push('edit');
  if (/(^|[;&|(\n`$]|\s)(sed|cat|nl|head|tail|less|more)\b/.test(c)) fams.push('nativeRead');
  if (/(^|[;&|(\n`$]|\s)(grep|rg|ag|ack|find|fd|ls|glob)\b/.test(c)) fams.push('nativeGrep');
  if (/(^|[;&|(\n`$]|\s)git\b/.test(c)) fams.push('git');
  return fams;
}
function primaryFamily(fams) {
  for (const t of SS_TOOLS) if (fams.includes(t)) return t;
  if (fams.includes('edit')) return 'edit';
  if (fams.includes('run_tests')) return 'run_tests';
  if (fams.includes('nativeRead')) return 'nativeRead';
  if (fams.includes('nativeGrep')) return 'nativeGrep';
  if (fams.includes('git')) return 'git';
  return 'other';
}
const EDIT_FAIL_RE = /Failed to find context|Failed to find expected lines|Unexpected line found in update hunk|apply_patch verification failed|String to replace not found in file|Found \d+ matches of the string to replace|Invalid patch|patch does not apply/i;

// ---------- codex ----------
function parseCodex(file) {
  const turns = [], calls = [];
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const pend = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload || {};
    const t = p.type || o.type;
    if (t === 'token_count' && p.info?.last_token_usage) {
      const u = p.info.last_token_usage;
      turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
        cacheWrite: u.cache_write_input_tokens || 0,
        out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
        reasoning: u.reasoning_output_tokens || 0 });
    } else if (t === 'function_call' || t === 'custom_tool_call') {
      let cmd = '', name = p.name || 'tool';
      if (t === 'function_call') {
        try { const a = JSON.parse(p.arguments || '{}'); cmd = a.cmd ?? a.command ?? p.arguments; }
        catch { cmd = String(p.arguments || ''); }
      } else { cmd = String(p.input || ''); }
      const rec = { name, cmd: String(cmd), outBytes: 0, outTokens: null, wallSec: null, err: false, poll: name === 'write_stdin' };
      calls.push(rec);
      if (p.call_id) pend.set(p.call_id, rec);
    } else if (t === 'function_call_output' || t === 'custom_tool_call_output') {
      const rec = p.call_id && pend.get(p.call_id);
      const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output || '');
      if (rec) {
        rec.outBytes = Buffer.byteLength(out, 'utf8');
        const mt = out.match(/Original token count:\s*(\d+)/); if (mt) rec.outTokens = Number(mt[1]);
        const mw = out.match(/Wall time:\s*([\d.]+) seconds/); if (mw) rec.wallSec = Number(mw[1]);
        rec.err = EDIT_FAIL_RE.test(out) || /Process exited with code [1-9]/.test(out);
        rec.editFail = EDIT_FAIL_RE.test(out);
        rec.truncated = /truncated output \(original token count/.test(out);
      }
    }
  }
  return { turns, calls };
}

// ---------- opencode ----------
function parseOpencode(files) {
  const turns = [], calls = [];
  for (const file of files) {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const byId = new Map(); const order = [];
    for (const line of text.split('\n')) {
      const tl = line.trim();
      if (!tl || tl[0] !== '{') continue;
      let ev; try { ev = JSON.parse(tl); } catch { continue; }
      const p = ev.part || ev.properties?.part || ev;
      const type = ev.type || p.type;
      if (type === 'tool_use' || type === 'tool' || (p && p.tool && (p.state || p.callID || p.callId))) {
        const st = p.state || {};
        const inp = st.input || p.input || {};
        const out = st.output || p.output || '';
        const id = String(p.callID || p.callId || st.callID || `l${order.length}`);
        if (!byId.has(id)) order.push(id);
        const cmd = inp.command || inp.filePath || inp.path || inp.pattern || inp.query || inp.patchText || JSON.stringify(inp).slice(0, 400);
        let wallSec = null;
        if (st.time && st.time.start && st.time.end) wallSec = (st.time.end - st.time.start) / 1000;
        byId.set(id, { name: p.tool || 'tool', cmd: String(cmd),
          outBytes: Buffer.byteLength(typeof out === 'string' ? out : JSON.stringify(out || ''), 'utf8'),
          outTokens: null, wallSec,
          err: st.status === 'error',
          editFail: (p.tool === 'apply_patch' || p.tool === 'edit') && (st.status === 'error' || EDIT_FAIL_RE.test(String(out))),
          poll: false, truncated: false, isEditTool: p.tool === 'apply_patch' || p.tool === 'edit' || p.tool === 'write' });
      } else if (type === 'step_finish' || type === 'step-finish') {
        const tk = p.tokens || {}; const cache = tk.cache || {};
        const cRead = cache.read || 0, cWrite = cache.write || 0;
        turns.push({ in: (tk.input || 0) + cRead + cWrite, cached: cRead, cacheWrite: 0,
          out: (tk.output || 0) + (tk.reasoning || 0), reasoning: tk.reasoning || 0 });
      }
    }
    for (const id of order) calls.push(byId.get(id));
  }
  return { turns, calls };
}

// ---------- claude-code ----------
function parseClaude(file) {
  const turns = [], calls = [];
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const order = [], byId = new Map();
  const results = new Map();           // tool_use_id -> {bytes, err}
  for (const line of text.split('\n')) {
    const tl = line.trim(); if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    const m = ev.message; if (!m) continue;
    if (m.role === 'user') {
      const content = Array.isArray(m.content) ? m.content : [];
      for (const b of content) {
        if (b.type !== 'tool_result') continue;
        let s = '';
        if (typeof b.content === 'string') s = b.content;
        else if (Array.isArray(b.content)) s = b.content.map(x => (typeof x === 'string' ? x : (x?.text || ''))).join('');
        results.set(b.tool_use_id, { bytes: Buffer.byteLength(s, 'utf8'), err: !!b.is_error, text: s.slice(0, 4000) });
      }
      continue;
    }
    if (m.role !== 'assistant' || !m.id) continue;
    let g = byId.get(m.id);
    if (!g) { g = { blocks: [], usage: null, best: -1, ids: new Set() }; byId.set(m.id, g); order.push(m.id); }
    for (const b of (m.content || [])) {
      if (b.type === 'tool_use' && b.id) { if (g.ids.has(b.id)) continue; g.ids.add(b.id); }
      g.blocks.push(b);
    }
    const u = m.usage; if (!u) continue;
    const cached = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    const IN = (u.input_tokens || 0) + cached + cw;
    const out = u.output_tokens || 0;
    if (IN + out > g.best) { g.best = IN + out; g.usage = { in: IN, cached, cacheWrite: cw, out, reasoning: 0 }; }
  }
  for (const id of order) {
    const g = byId.get(id);
    for (const b of g.blocks) {
      if (b.type !== 'tool_use') continue;
      const inp = b.input || {};
      const cmd = inp.command || inp.file_path || inp.filePath || inp.pattern || inp.query || inp.old_string || JSON.stringify(inp).slice(0, 400);
      const res = results.get(b.id) || { bytes: 0, err: false, text: '' };
      calls.push({ name: b.name, cmd: String(cmd), outBytes: res.bytes, outTokens: null, wallSec: null,
        err: res.err, editFail: (b.name === 'Edit' || b.name === 'MultiEdit' || b.name === 'Write')
          && (res.err || EDIT_FAIL_RE.test(res.text)),
        poll: false, truncated: /lines truncated/.test(res.text),
        isEditTool: b.name === 'Edit' || b.name === 'MultiEdit' || b.name === 'Write',
        isDelegate: b.name === 'Task' || b.name === 'Agent' });
    }
    if (g.usage && (g.usage.in || g.usage.out)) turns.push(g.usage);
  }
  return { turns, calls };
}

// ---------- locate transcripts ----------
function claudeCell(runDir, taskId, arm, rep, rowUsage) {
  const base = path.join(runDir, 'agent-state', `${taskId}-${arm}`, 'claude-home', 'projects');
  let dirs = []; try { dirs = fs.readdirSync(base); } catch { return null; }
  const want = dirs.filter(d => { const m = d.match(/(?:^|-)r(\d+)-+\d+$/); return m && Number(m[1]) === rep; });
  const cands = [];
  for (const d of want) {
    const p = path.join(base, d);
    for (const f of fs.readdirSync(p)) {
      if (!f.endsWith('.jsonl')) continue;
      const sid = f.slice(0, -6);
      const subDir = path.join(p, sid, 'subagents');
      let subs = []; try { subs = fs.readdirSync(subDir).filter(x => x.endsWith('.jsonl')).map(x => path.join(subDir, x)); } catch {}
      cands.push({ main: path.join(p, f), subs });
    }
  }
  if (!cands.length) return null;
  if (cands.length === 1) return { ...cands[0], extra: 0, extraUsd: 0 };
  // More transcripts than reps in this cell: the pilot invoked the agent twice for this
  // rep. The row's own `usage` aggregate identifies WHICH invocation it graded and priced;
  // pick that one (exact), and report the abandoned attempt's spend separately.
  const scored = cands.map(c => {
    const pr = parseClaude(c.main);
    const agg = (pr ? pr.turns : []).reduce((a, t) => ({
      out: a.out + (t.out || 0), cr: a.cr + (t.cached || 0), cw: a.cw + (t.cacheWrite || 0) }),
      { out: 0, cr: 0, cw: 0 });
    return { c, agg, cost: pr ? priceTurns(pr.turns, { cacheWritePremium: true }).realizedUsd : 0 };
  });
  let best = scored[0];
  if (want.length && rowUsage) {
    let bd = Infinity;
    for (const s of scored) {
      const d = Math.abs(s.agg.out - (rowUsage.output_tokens || 0))
        + Math.abs(s.agg.cr - (rowUsage.cache_read_input_tokens || 0)) / 100;
      if (d < bd) { bd = d; best = s; }
    }
  } else { for (const s of scored) if (s.cost > best.cost) best = s; }
  const extraUsd = scored.reduce((a, s) => a + (s === best ? 0 : s.cost), 0);
  return { ...best.c, extra: scored.length - 1, extraUsd };
}

function codexFiles(row, runDir) {
  if (row.rolloutFile && fs.existsSync(row.rolloutFile)) return [row.rolloutFile];
  // fall back: scan the cell for a rollout whose cwd matches r<rep>-
  const base = path.join(runDir, 'agent-state', `${row.taskId}-${row.arm}`, 'codex-home', 'sessions');
  const out = [];
  const walk = d => { let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of e) { const p = path.join(d, x.name); if (x.isDirectory()) walk(p); else if (x.name.endsWith('.jsonl')) out.push(p); } };
  walk(base);
  const hits = out.filter(f => {
    try { const first = fs.readFileSync(f, 'utf8').split('\n', 1)[0];
      const m = first.match(/"cwd"\s*:\s*"([^"]*)"/); return m && new RegExp(`runs/r${row.rep}-`).test(m[1]); } catch { return false; }
  });
  return hits;
}

function opencodeFiles(row) {
  const atts = row.openCodeRawAttempts || [];
  const files = [];
  for (const a of atts) {
    if (!a || !a.stdout) continue;
    const p = path.isAbsolute(a.stdout) ? a.stdout : path.join(ROOT, a.stdout);
    if (fs.existsSync(p)) files.push(p);
  }
  return files;
}

// ---------- main ----------
const out = [];
const problems = [];
for (const cfg of RUNS) {
  const runDir = path.join(R, cfg.run);
  let rows; try { rows = JSON.parse(fs.readFileSync(path.join(runDir, 'rows.json'), 'utf8')); }
  catch (e) { problems.push(`${cfg.run}: no rows.json`); continue; }
  for (const row of rows) {
    const rec = { epoch: cfg.epoch, run: cfg.run, harness: cfg.harness, repair: !!cfg.repair,
      form: row.arm === 'native' ? 'native' : cfg.form, arm: row.arm,
      taskId: row.taskId, rep: row.rep, resolved: row.resolved === true, f2pFrac: row.f2pFrac ?? null,
      rowCalls: row.calls ?? null, rowCostRealized: row.costRealizedUsd ?? null,
      rowIdeal: row.idealCostUsd ?? null, rowBreak: row.breakPricedCostUsd ?? null,
      rowRealizedMainOnly: row.costRealizedMainOnlyUsd ?? null,
      rowSidechain: row.costSidechainUsd ?? null, rowSidechainCount: row.sidechainCount ?? null,
      rowStepsToFirstEdit: row.stepsToFirstEdit ?? null, patchHunks: row.patchHunks ?? null,
      exitReason: row.exitReason || null };
    let parsed = null, subs = [], cwPremium = false, transcript = null;
    if (cfg.harness === 'codex') {
      const fl = codexFiles(row, runDir);
      transcript = fl[0] || null;
      parsed = fl.length ? parseCodex(fl[0]) : null;
      if (fl.length > 1) rec.extraTranscripts = fl.length - 1;
    } else if (cfg.harness === 'opencode') {
      const fl = opencodeFiles(row);
      transcript = fl[0] || null;
      parsed = fl.length ? parseOpencode(fl) : null;
      rec.attempts = fl.length;
    } else {
      const cell = claudeCell(runDir, row.taskId, row.arm, row.rep, row.usage);
      cwPremium = true;
      if (cell) { transcript = cell.main; parsed = parseClaude(cell.main); subs = cell.subs; rec.abandonedAttempts = cell.extra || 0; rec.abandonedUsd = cell.extraUsd || 0; }
    }
    if (!parsed || !parsed.turns.length) { rec.ok = false; problems.push(`${cfg.run} ${row.taskId} ${row.arm} rep${row.rep}: no turns`); out.push(rec); continue; }
    rec.ok = true; rec.transcript = transcript;
    Object.assign(rec, priceTurns(parsed.turns, { cacheWritePremium: cwPremium }));
    rec.turnIn = parsed.turns.map(t => t.in);
    rec.turnOut = parsed.turns.map(t => t.out);
    rec.turnCached = parsed.turns.map(t => t.cached);
    // sidechain
    let sc = { usd: 0, turns: 0, files: subs.length, noUsage: 0 };
    for (const s of subs) {
      const pr = parseClaude(s); if (!pr) continue;
      const c = priceTurns(pr.turns, { cacheWritePremium: true });
      sc.usd += c.realizedUsd; sc.turns += c.turns;
    }
    rec.sidechainUsd = sc.usd; rec.sidechainTurns = sc.turns; rec.sidechainFiles = sc.files;
    rec.totalUsd = rec.realizedUsd + sc.usd;
    // tool families
    const fam = {}, famB = {}, famTok = {};
    let toolBytes = 0, editCalls = 0, editFails = 0, pollCalls = 0, pollBytes = 0, truncCalls = 0;
    let firstEdit = null, delegates = 0, wallSum = 0, wallN = 0, ssWall = 0, ssWallN = 0;
    parsed.calls.forEach((c, i) => {
      if (!c) return;
      let f;
      if (cfg.harness === 'codex') {
        if (c.name === 'update_plan') f = 'plan';
        else if (c.name === 'write_stdin') f = 'poll';
        else f = primaryFamily(familiesOfCmd(c.cmd));
      } else if (cfg.harness === 'opencode') {
        if (c.name === 'bash') f = primaryFamily(familiesOfCmd(c.cmd));
        else if (c.name === 'read') f = 'nativeRead';
        else if (['grep', 'glob', 'list'].includes(c.name)) f = 'nativeGrep';
        else if (c.isEditTool) f = 'edit';
        else if (c.name === 'todowrite' || c.name === 'todoread') f = 'plan';
        else if (c.name === 'task') f = 'delegate';
        else f = 'other';
      } else {
        if (c.name === 'Bash' || c.name === 'BashOutput') f = primaryFamily(familiesOfCmd(c.cmd));
        else if (c.name === 'Read' || c.name === 'NotebookRead') f = 'nativeRead';
        else if (['Grep', 'Glob', 'LS'].includes(c.name)) f = 'nativeGrep';
        else if (c.isEditTool) f = 'edit';
        else if (['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskView', 'TodoRead'].includes(c.name)) f = 'plan';
        else if (c.isDelegate) f = 'delegate';
        else f = 'other';
      }
      fam[f] = (fam[f] || 0) + 1;
      famB[f] = (famB[f] || 0) + (c.outBytes || 0);
      if (c.outTokens != null) famTok[f] = (famTok[f] || 0) + c.outTokens;
      toolBytes += c.outBytes || 0;
      if (c.truncated) truncCalls++;
      if (f === 'poll') { pollCalls++; pollBytes += c.outBytes || 0; }
      if (f === 'edit' || c.isEditTool) { editCalls++; if (firstEdit === null && !c.editFail) firstEdit = i; }
      if (c.editFail) editFails++;
      if (f === 'delegate') delegates++;
      if (c.wallSec != null) { wallSum += c.wallSec; wallN++; if (f.startsWith('ss-')) { ssWall += c.wallSec; ssWallN++; } }
    });
    rec.calls = parsed.calls.length;
    rec.famCalls = fam; rec.famBytes = famB; rec.famTokens = famTok;
    rec.toolBytes = toolBytes; rec.editCalls = editCalls; rec.editFails = editFails;
    rec.pollCalls = pollCalls; rec.pollBytes = pollBytes; rec.truncCalls = truncCalls;
    rec.firstEditIdx = firstEdit; rec.callsAfterFirstEdit = firstEdit == null ? null : parsed.calls.length - firstEdit - 1;
    rec.delegates = delegates;
    rec.wallSum = wallN ? wallSum : null; rec.wallN = wallN; rec.ssWall = ssWallN ? ssWall : null; rec.ssWallN = ssWallN;
    out.push(rec);
  }
  process.stderr.write(`done ${cfg.run} (${rows.length} rows)\n`);
}
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const payload = { price: PRICE, generated: new Date().toISOString(), problems, rollouts: out };
if (outFile) fs.writeFileSync(outFile, JSON.stringify(payload));
else process.stdout.write(JSON.stringify(payload));
process.stderr.write(`rollouts=${out.length} problems=${problems.length}\n`);
