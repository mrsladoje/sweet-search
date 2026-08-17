// D18 — the R-1 LIVE A/B, read on its pre-registered proximal metric.
//
// Pre-registered (HANDOFF-SLATE-A-RESIDUE §3.B):
//   METRIC     number of retrieval calls BEFORE THE FIRST EDIT
//   DIRECTION  down
//   KILL LINE  the first-edit call count does not fall, OR total billed input rises on every
//              variation
//
// Cells: r1ab-off (no dossier) / r1ab-map (repo map) / r1ab-map5 (map + top-5 retrieval hits).
// All three on one build, so no comparison crosses a deploy.
//
// GATE 0 IS PART OF THE OUTPUT, not a separate step: `dossierChars` per rollout says whether the
// treatment was actually delivered. A cell whose dossier was empty is INERT and unreadable, and
// printing a null for it would be the accidental-A/A shape the /microsmoke skill exists to stop.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const CELLS = (process.argv[2] || 'r1ab-off,r1ab-map,r1ab-map5').split(',');

const walk = (d, pred, depth = 0, out = []) => {
  if (depth > 10) return out;
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, pred, depth + 1, out); else if (pred(p)) out.push(p); }
  return out;
};
const segments = cmd => String(cmd || '').split(/\s*(?:&&|\|\||[;|\n])\s*/).map(s => s.trim()).filter(Boolean);

function classifySegment(seg) {
  const base = (seg.split(/\s+/)[0] || '').replace(/^.*\//, '');
  if (base === 'ss-read') return 'read';
  if (/^ss-(search|grep|find|semantic|trace)$/.test(base)) return 'search';
  if (/^(cat|head|tail|sed|less|bat)$/.test(base)) return 'read';
  if (/^(rg|grep|ag|ack|find|ls)$/.test(base)) return 'search';
  if (base === 'run_tests') return 'test';
  if (/apply_patch|str_replace/.test(seg)) return 'edit';
  return 'other';
}
// Codex 0.146 wraps the command in a JS snippet; 0.141 in {"command":["bash","-lc",...]}.
// Classifying by first token without unwrapping files every retrieval as 'other'.
function codexCommandOf(p) {
  const raw = String(p.input ?? p.arguments ?? '');
  if (!raw) return '';
  const m = /exec_command\(\s*\{\s*cmd\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
  if (m) return m[1].replace(/\\(["\\nrt])/g, (s, c) => ({ n: '\n', r: '\r', t: '\t' }[c] ?? c));
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j.command)) {
      const a = j.command;
      if (a.length >= 3 && /^(ba)?sh$/.test(a[0]) && /^-[lc]*c$/.test(a[1])) return a.slice(2).join(' ');
      return a.join(' ');
    }
    if (typeof j.cmd === 'string') return j.cmd;
  } catch { /* not JSON */ }
  return raw;
}
function kindsOf(cmd) {
  const out = segments(cmd).map(classifySegment).filter(k => k !== 'other');
  if (!out.length && /apply_patch|<<\s*'?PATCH'?|str_replace/.test(cmd)) out.push('edit');
  return out;
}

function rollouts(cellDir) {
  const out = [];
  const asDir = path.join(cellDir, 'agent-state');
  for (const d of (existsSync(asDir) ? readdirSync(asDir) : [])) {
    for (const f of walk(path.join(asDir, d, 'codex-home', 'sessions'), p => p.endsWith('.jsonl'))) {
      const ev = [];
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const p = o.payload || {}; const ty = p.type || o.type;
        if (ty !== 'function_call' && ty !== 'custom_tool_call') continue;
        ev.push(...kindsOf(codexCommandOf(p)));
      }
      if (ev.length) out.push(ev);
    }
  }
  return out;
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
console.log('=== D18 — R-1 LIVE A/B, pre-registered metric = retrieval calls before the FIRST EDIT ===\n');
const res = [];
for (const c of CELLS) {
  const dir = path.join(R, c);
  if (!existsSync(dir)) { console.log(`-- ${c}: MISSING --\n`); continue; }
  const evs = rollouts(dir);
  const preEdit = [], total = [], noEdit = [];
  for (const ev of evs) {
    const k = ev.findIndex(x => x === 'edit');
    total.push(ev.length);
    if (k < 0) { noEdit.push(1); continue; }
    preEdit.push(ev.slice(0, k).filter(x => x === 'read' || x === 'search').length);
  }
  const rowsF = path.join(dir, 'rows.json');
  const rows = existsSync(rowsF) ? JSON.parse(readFileSync(rowsF, 'utf8')) : [];
  const graded = rows.filter(r => r.resolved !== undefined);
  const brk = rows.reduce((a, r) => a + (r.breakPricedCostUsd ?? r.idealCostUsd ?? 0), 0);
  const doss = rows.map(r => r.r1?.dossierChars ?? 0).filter(x => x > 0);
  const inert = rows.filter(r => r.r1?.inert).length;
  res.push({ c, preEdit, total, rows, graded, brk });
  console.log(`-- ${c} --  ${evs.length} rollout(s)${noEdit.length ? `, ${noEdit.length} never edited` : ''}`);
  console.log(`   SOLVE                    ${graded.filter(r => r.resolved).length}/${graded.length} graded`);
  console.log(`   RETRIEVAL BEFORE 1st EDIT ${mean(preEdit).toFixed(2)} per rollout   <- THE METRIC`);
  console.log(`   total tool calls          ${mean(total).toFixed(1)} per rollout`);
  if (rows.some(r => r.r1)) {
    console.log(`   GATE 0: dossier delivered ${doss.length}/${rows.length} rollouts, ${doss.length ? Math.round(mean(doss)) : 0} chars mean${inert ? `, ${inert} INERT` : ''}`);
    if (!doss.length) console.log('   *** DOSSIER NEVER DELIVERED — this cell is INERT and must not be read as a null ***');
  }
  console.log(`   breakPriced cost          $${brk.toFixed(6)}  (read, never judged)`);
  console.log('');
}
const base = res.find(r => r.c.endsWith('-off'));
if (base) {
  console.log('=== VERDICT against the pre-registered kill line ===');
  console.log(`baseline retrieval-before-first-edit: ${mean(base.preEdit).toFixed(2)} per rollout\n`);
  for (const r of res.filter(x => x !== base)) {
    const d = mean(r.preEdit) - mean(base.preEdit);
    const cost = (r.brk / base.brk - 1) * 100;
    console.log(`  ${r.c.padEnd(12)} metric ${mean(r.preEdit).toFixed(2)} (${d <= 0 ? 'DOWN' : 'UP'} ${Math.abs(d).toFixed(2)})`
      + `  | total input cost ${cost >= 0 ? '+' : ''}${cost.toFixed(1)}%`
      + `  | solve ${r.graded.filter(x => x.resolved).length}/${r.graded.length} vs ${base.graded.filter(x => x.resolved).length}/${base.graded.length}`);
  }
  console.log('\nKILL LINE: the metric fails to fall on every variation, OR billed input rises on every one.');
  console.log('Solve is a veto, but note that two of these three control tasks resolve with an EMPTY patch,');
  console.log('so the solve column carries one informative task, not three.');
}
