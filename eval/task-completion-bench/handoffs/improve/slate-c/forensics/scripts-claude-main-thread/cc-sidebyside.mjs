// cc-sidebyside.mjs — request-by-request side-by-side of native vs sweet on the claude-code
// task-cells where NEITHER arm delegated (fp-claudecode-tab-20260826), with a lifetime cost
// attribution of every request to the purpose of the call it made.
// Read-only over results/. Outputs go to OUT (default /tmp/wf-slatec/claude-main-thread/out).
//   node cc-sidebyside.mjs [--run fp-claudecode-tab-20260826] [--out DIR]
import fs from 'node:fs';
import path from 'node:path';
import * as P from './cc-parse.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const RUN = flag('run', 'fp-claudecode-tab-20260826');
const OUT = flag('out', '/tmp/wf-slatec/claude-main-thread/out');
fs.mkdirSync(OUT, { recursive: true });
const rows = P.rowsOf(RUN);
const tasks = [...new Set(rows.map(r => r.taskId))].sort();
const f6 = x => (Math.round(x * 1e6) / 1e6).toFixed(6);
const pct = (a, b) => b ? `${(100 * (a - b) / b).toFixed(1)}%` : 'n/a';
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// ---------- 0. verify the no-delegation task set (transcript files AND Task/Agent tool calls) ----------
const deleg = {};
for (const task of tasks) {
  for (const arm of ['native', 'sweet']) {
    const ts = P.transcriptsOf(RUN, task, arm);
    let subFiles = 0, taskCalls = 0, mains = ts.length;
    for (const t of ts) {
      subFiles += t.sub.length;
      const pr = P.parseRequests(t.file);
      for (const r of pr.requests) for (const c of r.calls) if (c.name === 'Task' || c.name === 'Agent') taskCalls++;
    }
    deleg[`${task}|${arm}`] = { mains, subFiles, taskCalls };
  }
}
const cleanTasks = tasks.filter(t => ['native', 'sweet'].every(a => deleg[`${t}|${a}`].subFiles === 0 && deleg[`${t}|${a}`].taskCalls === 0));
console.log(`run=${RUN} tasks=${tasks.length}`);
console.log(`tasks with NO delegation in either arm (0 subagent transcripts AND 0 Task/Agent calls): ${cleanTasks.length}`);
for (const t of cleanTasks) console.log(`  ${t}  native=${JSON.stringify(deleg[`${t}|native`])} sweet=${JSON.stringify(deleg[`${t}|sweet`])}`);
const nearMiss = tasks.filter(t => !cleanTasks.includes(t) && ['native', 'sweet'].some(a => deleg[`${t}|${a}`].subFiles === 0 && deleg[`${t}|${a}`].taskCalls === 0));
console.log(`tasks where exactly one arm delegated: ${nearMiss.length} -> ${nearMiss.map(t => `${t}(${['native', 'sweet'].filter(a => deleg[`${t}|${a}`].subFiles > 0 || deleg[`${t}|${a}`].taskCalls > 0).join('/')} delegated)`).join(', ')}`);

// ---------- 1. per-rollout timelines and lifetime attribution ----------
const CLASS_OF = (purpose) => {
  if (/^(other|meta):(TaskCreate|TaskUpdate|TaskList|TaskGet|TodoWrite)$/.test(purpose)) return 'tasklist';
  if (purpose.startsWith('meta:')) return 'meta';
  if (purpose.includes('+')) return 'multi';
  return purpose;
};
function analyse(parsed, isSweet) {
  const R = parsed.requests; const T = R.length;
  const cwd = parsed.cwd;
  const ssReadSet = new Set(); const readSet = new Set(); const editedSet = new Set();
  let lastEditIdx = -1;
  const timeline = []; const byClass = {}; const flags = { readAfterSsRead: [], readAfterRead: [], editFailed: [], ssFailed: [], rewrites: 0, stateSummaries: 0 };
  const add = (cls, k, v) => { byClass[cls] ??= { n: 0, out: 0, resultBytes: 0, ingestCaused: 0, ownOutIngest: 0, real: 0, idealDirect: 0, lifetime: 0 }; byClass[cls][k] += v; };
  for (const r of R) {
    const k = r.idx; const isLast = k === T - 1;
    const purpose = P.purposeOf(r, isLast); const cls = CLASS_OF(purpose);
    const next = R[k + 1];
    const ingestCaused = next ? next.ingest : 0;
    const ownOut = Math.min(r.usage.out, ingestCaused);
    const remaining = Math.max(0, T - k - 2);
    const lifetime = (ingestCaused * P.PRICE_IDEAL.newIn + ingestCaused * remaining * P.PRICE_IDEAL.resident + r.usage.out * P.PRICE_IDEAL.out) / 1e6;
    add(cls, 'n', 1); add(cls, 'out', r.usage.out); add(cls, 'resultBytes', r.resultBytes); add(cls, 'ingestCaused', ingestCaused); add(cls, 'ownOutIngest', ownOut);
    add(cls, 'real', r.realUsd); add(cls, 'idealDirect', r.idealUsd); add(cls, 'lifetime', lifetime);
    if (r.rewrite) flags.rewrites++;
    if (r.textLen && /<state_summary>/.test(r.calls.map(c => JSON.stringify(c.input)).join('') + '')) flags.stateSummaries++;
    const details = [];
    for (const c of r.calls) {
      let d = c.name;
      if (c.name === 'Bash') {
        const cmd = String(c.input.command || '').replace(/\s+/g, ' ');
        d = `Bash[${P.bashCategory(cmd)}] ${cmd.slice(0, 90)}${cmd.length > 90 ? '…' : ''}`;
        const ssErr = P.classifySsError(c.result);
        if (P.ssToolsIn(cmd).length && ssErr) { flags.ssFailed.push({ k, cls: ssErr, cmd: cmd.slice(0, 120), nextReal: next ? next.realUsd : 0 }); d += ` !${ssErr}`; }
        for (const p of P.ssReadPaths(cmd)) if (!ssErr || ssErr === 'no-matches') ssReadSet.add(P.normPath(p, cwd));
        if (/<state_summary>/.test(String(c.result || ''))) flags.stateSummaries++;
      } else if (c.name === 'Read') {
        const fp = P.normPath(c.input.file_path, cwd); const rel = cwd && fp.startsWith(cwd) ? fp.slice(cwd.length + 1) : fp;
        d = `Read ${rel}${c.input.offset ? ` @${c.input.offset}+${c.input.limit || ''}` : ''}`;
        if (ssReadSet.has(fp)) { flags.readAfterSsRead.push({ k, rel, real: r.realUsd, resultBytes: c.resultBytes }); d += ' !after-ss-read'; }
        if (readSet.has(fp)) { flags.readAfterRead.push({ k, rel, real: r.realUsd }); d += ' !re-read'; }
        if (!c.isError) readSet.add(fp);
      } else if (c.name === 'Grep' || c.name === 'Glob') {
        d = `${c.name} ${String(c.input.pattern || '').slice(0, 50)}${c.input.path ? ` in ${String(c.input.path).replace(cwd || '', '.')}` : ''}`;
      } else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name)) {
        const fp = P.normPath(c.input.file_path || c.input.notebook_path, cwd); const rel = cwd && fp && fp.startsWith(cwd) ? fp.slice(cwd.length + 1) : fp;
        const err = c.isError ? (P.classifyEditError(c.result) || 'other-error') : P.classifyEditError(c.result);
        d = `${c.name} ${rel} old=${String(c.input.old_string || '').length}c new=${String(c.input.new_string || c.input.content || '').length}c${err ? ` !${err}` : ''}`;
        if (err) flags.editFailed.push({ k, rel, cls: err, real: r.realUsd, out: r.usage.out, nextReal: next ? next.realUsd : 0, nextIsRetry: !!(next && next.calls.some(x => ['Edit', 'Write', 'MultiEdit'].includes(x.name) && P.normPath(x.input.file_path, cwd) === fp)) });
        else { lastEditIdx = k; editedSet.add(fp); }
      } else d = `${c.name} ${JSON.stringify(c.input).slice(0, 60)}`;
      details.push(d);
    }
    if (!r.calls.length) details.push(isLast ? `final text ${r.textLen}c` : `text ${r.textLen}c`);
    timeline.push({ k, purpose, cls, calls: r.calls.length, detail: details.join(' | '), resultBytes: r.resultBytes, userTextBytes: r.userTextBytes, ingest: r.ingest, prefix: r.resident, totalIn: r.usage.totalIn, cw: r.usage.cw, cr: r.usage.cr, out: r.usage.out, textLen: r.textLen, thinkingLen: r.thinkingLen, real: r.realUsd, ideal: r.idealUsd, lifetime, ingestCaused, remaining });
  }
  // verification tail = requests after the last successful edit
  const tail = R.filter(r => r.idx > lastEditIdx);
  const tailByClass = {};
  for (const r of tail) { const cls = CLASS_OF(P.purposeOf(r, r.idx === T - 1)); tailByClass[cls] = (tailByClass[cls] || 0) + 1; }
  const preamble = R.length ? R[0].ingest : 0;
  const totals = {
    requests: T, real: parsed.totalReal, ideal: parsed.totalIdeal, surcharge: parsed.totalReal - parsed.totalIdeal,
    ingest: R.reduce((a, r) => a + r.ingest, 0), resident: R.reduce((a, r) => a + r.resident, 0), out: R.reduce((a, r) => a + r.usage.out, 0),
    cw: R.reduce((a, r) => a + r.usage.cw, 0), cr: R.reduce((a, r) => a + r.usage.cr, 0), inUncached: R.reduce((a, r) => a + r.usage.inUncached, 0),
    resultBytes: R.reduce((a, r) => a + r.resultBytes, 0), userTextBytes: R.reduce((a, r) => a + r.userTextBytes, 0),
    visibleOutChars: R.reduce((a, r) => a + r.textLen + r.thinkingLen + r.toolInputChars, 0),
    preambleTokens: preamble, preambleLifetime: (preamble * P.PRICE_IDEAL.newIn + preamble * (T - 1) * P.PRICE_IDEAL.resident) / 1e6,
    lastEditIdx, tailRequests: tail.length, tailReal: tail.reduce((a, r) => a + r.realUsd, 0), tailByClass,
    maxContext: Math.max(...R.map(r => r.usage.totalIn)),
  };
  // identity check: sum of per-class lifetime + preamble lifetime == ideal total
  totals.lifetimeSum = Object.values(byClass).reduce((a, c) => a + c.lifetime, 0) + totals.preambleLifetime;
  totals.lifetimeIdentityResidual = totals.lifetimeSum - totals.ideal;
  return { timeline, byClass, flags, totals };
}

const cells = {}; const per = [];
const focus = cleanTasks;
for (const task of focus) {
  for (const arm of ['native', 'sweet']) {
    const matched = P.matchCell(RUN, task, arm, rows);
    for (const m of matched) {
      const a = analyse(m.transcript.parsed, arm === 'sweet');
      per.push({ task, arm, rep: m.row.rep, matchedByCost: m.matchedByCost, costDelta: m.costDelta, rowReal: m.row.costRealizedMainOnlyUsd ?? m.row.costRealizedUsd, resolved: m.row.resolved, calls: m.row.calls, file: m.transcript.file, version: m.transcript.parsed.version, ...a });
    }
  }
}
console.log(`\nrollouts analysed=${per.length} matchedByCost=${per.filter(p => p.matchedByCost).length} unmatched=${per.filter(p => !p.matchedByCost).map(p => `${p.task}/${p.arm}/r${p.rep}(Δ$${f6(p.costDelta)})`).join(', ') || 'none'}`);
console.log(`ideal identity residual (max abs over rollouts) = $${Math.max(...per.map(p => Math.abs(p.totals.lifetimeIdentityResidual))).toExponential(2)}`);
console.log(`claude-code versions seen: ${[...new Set(per.map(p => p.version))].join(', ')}`);

// ---------- 2. per-task and pooled aggregates ----------
const CLASSES = ['ss-search', 'ss-read', 'ss-mixed', 'Read', 'Grep', 'Glob', 'shell-retrieval', 'edit', 'edit-failed', 'test', 'exec', 'git', 'bash-other', 'tasklist', 'meta', 'multi', 'text-only', 'final-answer'];
function aggregate(list) {
  const n = list.length || 1;
  const sum = (f) => list.reduce((a, p) => a + f(p), 0) / n;
  const out = { n: list.length, requests: sum(p => p.totals.requests), real: sum(p => p.totals.real), ideal: sum(p => p.totals.ideal), surcharge: sum(p => p.totals.surcharge),
    ingest: sum(p => p.totals.ingest), resident: sum(p => p.totals.resident), out: sum(p => p.totals.out), resultBytes: sum(p => p.totals.resultBytes),
    preambleTokens: sum(p => p.totals.preambleTokens), preambleLifetime: sum(p => p.totals.preambleLifetime), tailRequests: sum(p => p.totals.tailRequests), tailReal: sum(p => p.totals.tailReal),
    visibleOutChars: sum(p => p.totals.visibleOutChars), maxContext: Math.max(...list.map(p => p.totals.maxContext)),
    toolCalls: sum(p => p.timeline.reduce((a, t) => a + (t.calls || 0), 0)), multiCallRequests: sum(p => p.timeline.filter(t => (t.calls || 0) > 1).length),
    readAfterSsRead: sum(p => p.flags.readAfterSsRead.length), readAfterSsReadReal: sum(p => p.flags.readAfterSsRead.reduce((a, x) => a + x.real, 0)),
    readAfterRead: sum(p => p.flags.readAfterRead.length),
    editFailed: sum(p => p.flags.editFailed.length), editFailedReal: sum(p => p.flags.editFailed.reduce((a, x) => a + x.real, 0)), editFailedRetryReal: sum(p => p.flags.editFailed.reduce((a, x) => a + (x.nextIsRetry ? x.nextReal : 0), 0)),
    ssFailed: sum(p => p.flags.ssFailed.length), ssFailedNextReal: sum(p => p.flags.ssFailed.reduce((a, x) => a + x.nextReal, 0)),
    byClass: {} };
  for (const c of CLASSES) {
    out.byClass[c] = { n: sum(p => p.byClass[c]?.n || 0), out: sum(p => p.byClass[c]?.out || 0), resultBytes: sum(p => p.byClass[c]?.resultBytes || 0), ingestCaused: sum(p => p.byClass[c]?.ingestCaused || 0), real: sum(p => p.byClass[c]?.real || 0), lifetime: sum(p => p.byClass[c]?.lifetime || 0) };
  }
  return out;
}
const agg = { perTask: {}, pooled: {} };
for (const task of focus) { agg.perTask[task] = {}; for (const arm of ['native', 'sweet']) agg.perTask[task][arm] = aggregate(per.filter(p => p.task === task && p.arm === arm)); }
for (const arm of ['native', 'sweet']) agg.pooled[arm] = aggregate(per.filter(p => p.arm === arm));
// def1 (task-level means) as in p1-conventions: mean over tasks of per-task means
const def1 = (f) => { const S = focus.map(t => f(agg.perTask[t].sweet)), N = focus.map(t => f(agg.perTask[t].native)); return { sweet: mean(S), native: mean(N), delta: mean(S) - mean(N), pct: 100 * (mean(S) - mean(N)) / mean(N) }; };

const L = [];
L.push(`\n=== A. HEADLINE on the ${focus.length} no-delegation tasks (per-rollout means; def1 = mean of per-task means) ===`);
for (const [lbl, f] of [['realized $ (main-only)', a => a.real], ['ideal $', a => a.ideal], ['cache-write surcharge $', a => a.surcharge], ['requests', a => a.requests], ['ingest tokens', a => a.ingest], ['resident (re-sent) tokens', a => a.resident], ['output tokens', a => a.out], ['tool-result bytes', a => a.resultBytes], ['preamble tokens (turn-1 input)', a => a.preambleTokens], ['preamble lifetime $', a => a.preambleLifetime], ['verification-tail requests', a => a.tailRequests], ['verification-tail $', a => a.tailReal]]) {
  const d = def1(f);
  L.push(`  ${lbl.padEnd(34)} native=${typeof d.native === 'number' && d.native < 1 ? f6(d.native) : d.native.toFixed(1)}  sweet=${d.sweet < 1 ? f6(d.sweet) : d.sweet.toFixed(1)}  Δ=${d.delta < 1 && d.delta > -1 ? f6(d.delta) : d.delta.toFixed(1)} (${d.pct.toFixed(1)}%)`);
}
L.push(`  tool calls per request: native ${(agg.pooled.native.toolCalls / agg.pooled.native.requests).toFixed(2)} (${agg.pooled.native.multiCallRequests.toFixed(2)} multi-call requests/rollout) | sweet ${(agg.pooled.sweet.toolCalls / agg.pooled.sweet.requests).toFixed(2)} (${agg.pooled.sweet.multiCallRequests.toFixed(2)})`);
L.push(`\n=== B. PER TASK (mean per rollout, 3 reps each; solved = resolved rows) ===`);
for (const task of focus) {
  const n = agg.perTask[task].native, s = agg.perTask[task].sweet;
  const solved = (arm) => per.filter(p => p.task === task && p.arm === arm && p.resolved).length;
  L.push(`  ${task}: native $${f6(n.real)} (${n.requests.toFixed(1)} req, ${n.out.toFixed(0)} out, ${(n.resultBytes / 1e3).toFixed(1)} kB in, solved ${solved('native')}/3) | sweet $${f6(s.real)} (${s.requests.toFixed(1)} req, ${s.out.toFixed(0)} out, ${(s.resultBytes / 1e3).toFixed(1)} kB in, solved ${solved('sweet')}/3) | Δ ${pct(s.real, n.real)}`);
  for (const p of per.filter(p => p.task === task).sort((a, b) => a.rep - b.rep || a.arm.localeCompare(b.arm))) L.push(`      r${p.rep} ${p.arm.padEnd(6)} $${f6(p.totals.real)} req=${p.totals.requests} out=${p.totals.out} ingest=${p.totals.ingest} resident=${p.totals.resident} maxCtx=${p.totals.maxContext} editsFailed=${p.flags.editFailed.length} readAfterSsRead=${p.flags.readAfterSsRead.length} ssFailed=${p.flags.ssFailed.length} tail=${p.totals.tailRequests}req/$${f6(p.totals.tailReal)} resolved=${p.resolved}`);
}
L.push(`\n=== C. LIFETIME-ATTRIBUTED IDEAL COST BY REQUEST CLASS (mean per rollout; class = what the request called; cost = its output + the ingest it caused + that ingest re-sent for the rest of the rollout) ===`);
L.push(`  ${'class'.padEnd(16)} ${'nat n'.padStart(6)} ${'nat $'.padStart(10)} ${'swt n'.padStart(6)} ${'swt $'.padStart(10)} ${'Δ$'.padStart(10)}  ${'nat kB'.padStart(7)} ${'swt kB'.padStart(7)}  ${'nat out'.padStart(7)} ${'swt out'.padStart(7)}`);
let sumD = 0;
for (const c of CLASSES) {
  const n = agg.pooled.native.byClass[c], s = agg.pooled.sweet.byClass[c];
  if (!n.n && !s.n) continue;
  sumD += s.lifetime - n.lifetime;
  L.push(`  ${c.padEnd(16)} ${n.n.toFixed(2).padStart(6)} ${f6(n.lifetime).padStart(10)} ${s.n.toFixed(2).padStart(6)} ${f6(s.lifetime).padStart(10)} ${f6(s.lifetime - n.lifetime).padStart(10)}  ${(n.resultBytes / 1e3).toFixed(1).padStart(7)} ${(s.resultBytes / 1e3).toFixed(1).padStart(7)}  ${n.out.toFixed(0).padStart(7)} ${s.out.toFixed(0).padStart(7)}`);
}
L.push(`  ${'preamble'.padEnd(16)} ${''.padStart(6)} ${f6(agg.pooled.native.preambleLifetime).padStart(10)} ${''.padStart(6)} ${f6(agg.pooled.sweet.preambleLifetime).padStart(10)} ${f6(agg.pooled.sweet.preambleLifetime - agg.pooled.native.preambleLifetime).padStart(10)}  (turn-1 tokens ${agg.pooled.native.preambleTokens.toFixed(0)} vs ${agg.pooled.sweet.preambleTokens.toFixed(0)})`);
sumD += agg.pooled.sweet.preambleLifetime - agg.pooled.native.preambleLifetime;
L.push(`  sum of class deltas = $${f6(sumD)} ; ideal Δ (pooled per rollout) = $${f6(agg.pooled.sweet.ideal - agg.pooled.native.ideal)} ; realized Δ = $${f6(agg.pooled.sweet.real - agg.pooled.native.real)} ; surcharge Δ = $${f6(agg.pooled.sweet.surcharge - agg.pooled.native.surcharge)}`);
L.push(`\n=== D. NAMED MECHANISMS (mean per rollout, pooled over the ${focus.length} tasks) ===`);
for (const arm of ['native', 'sweet']) {
  const a = agg.pooled[arm];
  L.push(`  ${arm}: Read-after-ss-read ${a.readAfterSsRead.toFixed(2)}/rollout ($${f6(a.readAfterSsReadReal)} direct) | re-Read same file ${a.readAfterRead.toFixed(2)} | failed edits ${a.editFailed.toFixed(2)} ($${f6(a.editFailedReal)} failed request + $${f6(a.editFailedRetryReal)} immediate retry) | ss failures ${a.ssFailed.toFixed(2)} ($${f6(a.ssFailedNextReal)} next request) | tail ${a.tailRequests.toFixed(2)} req $${f6(a.tailReal)} | output ${a.out.toFixed(0)} tok of which visible chars ${a.visibleOutChars.toFixed(0)} (≈${(a.visibleOutChars / 4).toFixed(0)} tok) → hidden reasoning ≈ ${Math.max(0, a.out - a.visibleOutChars / 4).toFixed(0)} tok`);
}
console.log(L.join('\n'));

// ---------- 3. write outputs ----------
fs.writeFileSync(path.join(OUT, 'sidebyside.json'), JSON.stringify({ run: RUN, cleanTasks, nearMiss, deleg, per: per.map(p => ({ ...p, timeline: p.timeline })), agg }, null, 1));
fs.writeFileSync(path.join(OUT, 'sidebyside-summary.txt'), L.join('\n') + '\n');
// full timelines, markdown
const M = [];
M.push(`# Request-by-request timelines — ${RUN}, no-delegation task-cells\n`);
M.push(`Columns: k = request index; class = purpose of the call; in-B = tool-result bytes returned to the model by this request's call(s); ingest = new input tokens billed on THIS request (they were produced by the previous request's result and output); prefix = re-sent tokens; out = output tokens (visible + hidden reasoning); $real = realized price of this request at the run's vector ($0.10 new / $0.125 cache-write / $0.01 cache-read / $0.60 out per M).\n`);
for (const task of focus) {
  M.push(`\n## ${task}\n`);
  for (const rep of [0, 1, 2]) {
    for (const arm of ['native', 'sweet']) {
      const p = per.find(x => x.task === task && x.arm === arm && x.rep === rep); if (!p) continue;
      M.push(`\n### ${arm} rep ${rep} — ${p.totals.requests} requests, $${f6(p.totals.real)} realized ($${f6(p.totals.ideal)} ideal), ${p.totals.out} output tokens, ${(p.totals.resultBytes / 1e3).toFixed(1)} kB tool results, resolved=${p.resolved}, matchedByCost=${p.matchedByCost}\n`);
      M.push(`| k | class | call | in-B | ingest | prefix | out | $real |`);
      M.push(`|---:|---|---|---:|---:|---:|---:|---:|`);
      for (const t of p.timeline) M.push(`| ${t.k} | ${t.cls} | ${t.detail.replace(/\|/g, '\\|')} | ${t.resultBytes} | ${t.ingest} | ${t.prefix} | ${t.out} | ${f6(t.real)} |`);
    }
  }
}
fs.writeFileSync(path.join(OUT, 'timelines.md'), M.join('\n') + '\n');
console.log(`\nwrote ${OUT}/sidebyside.json, sidebyside-summary.txt, timelines.md`);
