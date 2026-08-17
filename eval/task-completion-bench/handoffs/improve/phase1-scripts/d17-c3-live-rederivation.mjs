// D17 — the C-3 LIVE A/B, read on the pre-registered proximal metric.
//
// Pre-registered before the run (HANDOFF-SLATE-A-RESIDUE §3.A):
//   METRIC     count of facts re-derived after the boundary that were present before it
//   DIRECTION  down
//   KILL LINE  any control task drops below 2/2, OR the count does not fall on any variation,
//              OR v5 matches the best reset variation
//
// THE BOUNDARY IS COMPARABLE ACROSS CELLS BY CONSTRUCTION:
//   off  the first edit call — the diagnosis/apply split, same cut gate4's replay used.
//   v1   the phase-2 session. Phase 1 was told not to edit, so its end IS the diagnosis/apply
//        split; the context is DELETED across it.
//   v5   the phase-2 session, same split, context RETAINED (`codex exec resume`).
//
// So v1 vs v5 isolates context deletion, and both against `off` measure the topology change.
// Cost is read but NEVER judged: the $0 surface (d15) bounds the whole lever below the
// instrument's ~10% resolution, so a cost number here would be noise wearing a decimal point.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const CELLS = (process.argv[2] || 'c3ab-off,c3ab-v1,c3ab-v5').split(',');

const walk = (d, pred, depth = 0, out = []) => {
  if (depth > 10) return out;
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, pred, depth + 1, out); else if (pred(p)) out.push(p); }
  return out;
};
const segments = cmd => String(cmd || '').split(/\s*(?:&&|\|\||[;|\n])\s*/).map(s => s.trim()).filter(Boolean);

function classifySegment(seg) {
  const first = seg.split(/\s+/)[0] || '';
  const base = first.replace(/^.*\//, '');
  const rest = seg.slice(first.length).trim();
  const argOf = () => {
    for (const tk of rest.split(/\s+/)) {
      if (!tk || tk.startsWith('-')) continue;
      return tk.replace(/^['"]|['"]$/g, '').replace(/:\d+(-\d+)?$/, '');
    }
    return null;
  };
  const queryOf = () => rest.replace(/(^|\s)-{1,2}[\w-]+(=\S+)?/g, ' ').replace(/['"]/g, ' ')
    .trim().toLowerCase().replace(/\s+/g, ' ') || null;
  if (base === 'ss-read') return { kind: 'read', target: argOf() };
  if (/^ss-(search|grep|find|semantic|trace)$/.test(base)) return { kind: 'search', target: queryOf() };
  if (/^(cat|head|tail|sed|less|bat)$/.test(base)) return { kind: 'read', target: argOf() };
  if (/^(rg|grep|ag|ack|find|ls)$/.test(base)) return { kind: 'search', target: queryOf() };
  if (base === 'run_tests') return { kind: 'test', target: null };
  if (/apply_patch|str_replace/.test(seg)) return { kind: 'edit', target: argOf() };
  return { kind: 'other', target: null };
}
// Codex encodes the shell command differently across CLI versions, and getting this wrong
// silently under-counts the codex leg to near zero:
//   0.146  custom_tool_call name="exec", input = a JS snippet:
//            const r = await tools.exec_command({cmd:"ss-grep \"x\" -k 20","workdir":...})
//   0.141  function_call, arguments = {"command":["bash","-lc","<cmd>"]}
// Both are reduced to the bare shell command here. A parser that classifies by first token
// would otherwise see `const` or `bash` and file every retrieval as 'other'.
function codexCommandOf(p) {
  const raw = String(p.input ?? p.arguments ?? '');
  if (!raw) return '';
  const m = /exec_command\(\s*\{\s*cmd\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
  if (m) return m[1].replace(/\\(["\\nrt])/g, (s, c) => ({ n: '\n', r: '\r', t: '\t' }[c] ?? c));
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j.command)) {
      const a = j.command;
      // strip a `bash -lc` / `sh -c` wrapper so the first token is the real binary
      if (a.length >= 3 && /^(ba)?sh$/.test(a[0]) && /^-[lc]*c$/.test(a[1])) return a.slice(2).join(' ');
      return a.join(' ');
    }
    if (typeof j.cmd === 'string') return j.cmd;
  } catch { /* not JSON */ }
  return raw;
}

function eventsFromCommand(cmd) {
  const out = [];
  for (const seg of segments(cmd)) { const c = classifySegment(seg); if (c.kind !== 'other') out.push(c); }
  if (!out.length && /apply_patch|<<\s*'?PATCH'?|str_replace/.test(cmd)) out.push({ kind: 'edit', target: null });
  return out;
}
function eventsOfSession(f) {
  const ev = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    const p = o.payload || {}; const ty = p.type || o.type;
    if (ty !== 'function_call' && ty !== 'custom_tool_call') continue;
    ev.push(...eventsFromCommand(codexCommandOf(p)));
  }
  return ev;
}

/** One rollout = one agent-state cell dir; its session files in time order = its phases. */
function rollouts(cellDir) {
  const out = [];
  const asDir = path.join(cellDir, 'agent-state');
  for (const d of (existsSync(asDir) ? readdirSync(asDir) : [])) {
    const files = walk(path.join(asDir, d, 'codex-home', 'sessions'), p => p.endsWith('.jsonl'))
      .map(p => ({ p, m: statSync(p).mtimeMs })).sort((a, b) => a.m - b.m).map(x => x.p);
    if (!files.length) continue;
    // Reps share <task>-<arm>. Codex names each session file by start time, so a two-phase rep
    // is an ADJACENT pair. Group into consecutive pairs when the cell is a two-phase cell;
    // otherwise every file is its own rollout.
    out.push({ cell: d, files });
  }
  return out;
}

function score(cellDir, twoPhase) {
  const m = { rollouts: 0, pre: 0, post: 0, red: 0, perRollout: [], phase1Calls: [], phase2Calls: [], skipped: 0 };
  for (const r of rollouts(cellDir)) {
    const groups = [];
    if (twoPhase) { for (let i = 0; i + 1 < r.files.length; i += 2) groups.push([r.files[i], r.files[i + 1]]); }
    else for (const f of r.files) groups.push([f]);
    for (const g of groups) {
      let preEv, postEv;
      if (g.length === 2) { preEv = eventsOfSession(g[0]); postEv = eventsOfSession(g[1]); }
      else {
        const ev = eventsOfSession(g[0]);
        const k = ev.findIndex(e => e.kind === 'edit');
        if (k < 1 || k >= ev.length - 1) { m.skipped++; continue; }
        preEv = ev.slice(0, k); postEv = ev.slice(k);
      }
      const pre = new Set();
      let preN = 0;
      for (const e of preEv) if (e.kind === 'read' || e.kind === 'search') { preN++; if (e.target) pre.add(`${e.kind}:${e.target}`); }
      let postN = 0, red = 0;
      for (const e of postEv) {
        if (e.kind !== 'read' && e.kind !== 'search') continue;
        postN++; if (e.target && pre.has(`${e.kind}:${e.target}`)) red++;
      }
      m.rollouts++; m.pre += preN; m.post += postN; m.red += red;
      m.perRollout.push(red); m.phase1Calls.push(preEv.length); m.phase2Calls.push(postEv.length);
    }
  }
  return m;
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : 'n/a';

console.log('=== D17 — C-3 LIVE A/B on the pre-registered proximal metric ===\n');
const results = [];
for (const c of CELLS) {
  const dir = path.join(R, c);
  if (!existsSync(dir)) { console.log(`-- ${c}: MISSING --`); continue; }
  const twoPhase = /-(v1|v5)$/.test(c);
  const m = score(dir, twoPhase);
  const rowsF = path.join(dir, 'rows.json');
  const rows = existsSync(rowsF) ? JSON.parse(readFileSync(rowsF, 'utf8')) : [];
  const solved = rows.filter(r => r.resolved).length;
  const brk = rows.reduce((a, r) => a + (r.breakPricedCostUsd ?? r.idealCostUsd ?? 0), 0);
  const inert = rows.filter(r => r.c3 && (r.c3.inert || r.c3.fallback)).length;
  results.push({ c, m, solved, n: rows.length, brk, inert, rows });
  console.log(`-- ${c} --  ${m.rollouts} scored rollout(s)${m.skipped ? `, ${m.skipped} unexposed` : ''}`);
  console.log(`   SOLVE            ${solved}/${rows.length} resolved`);
  console.log(`   RE-DERIVED       ${m.red}  = ${pct(m.red, m.post)} of post-boundary retrieval   ${mean(m.perRollout).toFixed(2)} per rollout   <- THE METRIC`);
  console.log(`   retrieval        pre ${m.pre}  post ${m.post}`);
  console.log(`   calls            diagnosis ${mean(m.phase1Calls).toFixed(1)}   apply ${mean(m.phase2Calls).toFixed(1)}   total ${(mean(m.phase1Calls) + mean(m.phase2Calls)).toFixed(1)}`);
  if (twoPhase) console.log(`   trigger          ${rows.filter(r => r.c3?.handoffFromFile).length}/${rows.length} wrote a handoff file, ${inert} inert/fallback  <- Gate 0: a cell that never fired is UNREADABLE`);
  console.log(`   cost (read only) breakPriced $${brk.toFixed(6)}`);
  console.log('');
}

const base = results.find(r => r.c.endsWith('-off'));
if (base) {
  console.log('=== VERDICT against the pre-registered kill line ===');
  for (const r of results.filter(x => x !== base)) {
    const dm = mean(r.m.perRollout) - mean(base.m.perRollout);
    const solveDrop = r.solved < base.solved;
    console.log(`  ${r.c}: re-derivation ${mean(base.m.perRollout).toFixed(2)} -> ${mean(r.m.perRollout).toFixed(2)} per rollout (${dm <= 0 ? 'DOWN' : 'UP'} ${Math.abs(dm).toFixed(2)})`
      + `  |  solve ${base.solved}/${base.n} -> ${r.solved}/${r.n}${solveDrop ? '  *** CONTROL BROKEN — KILL ***' : ''}`);
  }
  const v1 = results.find(x => x.c.endsWith('-v1')), v5 = results.find(x => x.c.endsWith('-v5'));
  if (v1 && v5) {
    const d = mean(v1.m.perRollout) - mean(v5.m.perRollout);
    console.log(`\n  v1 (context DELETED) vs v5 (context KEPT): ${mean(v1.m.perRollout).toFixed(2)} vs ${mean(v5.m.perRollout).toFixed(2)}`);
    console.log(`  ${Math.abs(d) < 0.2 ? '  -> v5 MATCHES v1: the benefit, if any, is the structured summary and NOT the deletion.\n     Under the kill line that makes C-3 a prompt/format change, not a topology change.'
      : d < 0 ? '  -> deletion helps beyond the summary' : '  -> deletion HURTS relative to keeping the context'}`);
  }
}
