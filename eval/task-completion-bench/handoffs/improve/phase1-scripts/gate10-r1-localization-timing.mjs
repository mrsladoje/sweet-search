// GATE 10 — R-1 "Turn-0 retrieval dossier".
// Bar (SLATE-A-UBER §6 R-1): "rebuild DEV indexes without model calls, replay issue-text
// search, and require the eventual first-edit file in top five for a strong majority of solved
// rollouts. Price the injected dossier through every later turn. REJECT if the same
// localization is already achieved in ONE MODEL TURN or if irrelevant context increases total
// billed mass."
//
// The reject clause is the cheapest and it is decisive, so it runs first: in each rollout,
// how many model turns pass before the file the agent eventually EDITS first appears in a tool
// result? If localization already lands on turn 1, a turn-0 dossier buys nothing.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811', screen: 'screen-v3-20260812' };

function files(root) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 10) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (/\.(jsonl|ndjson)$/.test(e.name)) out.push(p); } };
  walk(root);
  return out.filter(p => !p.includes('/subagents/'));
}
const basename = p => String(p || '').split('/').filter(Boolean).pop();

/** Ordered model turns; each carries the tool calls it issued and the results it then saw. */
function timeline(harness, file) {
  const steps = [];   // {calls:[{name,input}], resultText}
  const txt = readFileSync(file, 'utf8');
  if (harness === 'codex') {
    let cur = null;
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      const p = o.payload || {}; const ty = p.type || o.type;
      if (ty === 'function_call' || ty === 'custom_tool_call') {
        cur = { cmd: String(p.input ?? p.arguments ?? ''), out: '' };
        steps.push(cur);
      } else if ((ty === 'function_call_output' || ty === 'custom_tool_call_output') && cur) {
        cur.out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output);
        cur = null;
      }
    }
  } else if (harness === 'opencode') {
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      if (o.type !== 'tool_use') continue;
      const st = o.part?.state || {};
      steps.push({ cmd: JSON.stringify(st.input || {}), out: String(st.output || ''), tool: o.part?.tool });
    }
  } else {
    const byId = new Map();
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type === 'tool_use') { const s = { cmd: JSON.stringify(b.input || {}), out: '', tool: b.name }; byId.set(b.id, s); steps.push(s); }
        if (b.type === 'tool_result') {
          const s = byId.get(b.tool_use_id); if (!s) continue;
          s.out = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
        }
      }
    }
  }
  return steps;
}

const EDIT = /apply_patch|\*\*\* (Begin Patch|Update File|Add File)|"tool":"(edit|write|patch)"/i;
const rowsOut = [];
for (const [harness, run] of Object.entries(RUNS)) {
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
  for (const r of rows) {
    const cell = path.join(RESULTS, run, 'agent-state', `${r.taskId}-${r.arm}`);
    if (!existsSync(cell)) continue;
    for (const f of files(cell)) {
      if (harness === 'claude' || harness === 'screen') {
        const slug = f.split('/claude-home/projects/')[1]?.split('/')[0] || '';
        const m = /--r(\d+)--\d+$/.exec(slug); if (m && +m[1] !== r.rep) continue;
      }
      const steps = timeline(harness === 'screen' ? 'claude' : harness, f);
      if (!steps.length) continue;
      // the first file the rollout EDITED
      let editIdx = -1, editFile = null;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const isEdit = (s.tool && /^(Edit|MultiEdit|Write|NotebookEdit|edit|write|patch)$/i.test(s.tool)) || EDIT.test(s.cmd);
        if (!isEdit) continue;
        const m = /"file_path"\s*:\s*"([^"]+)"|\*\*\* (?:Update|Add) File: ([^\n"\\]+)|"filePath"\s*:\s*"([^"]+)"/.exec(s.cmd);
        const fp = m ? (m[1] || m[2] || m[3]) : null;
        if (fp) { editIdx = i; editFile = basename(fp); break; }
      }
      if (!editFile) continue;
      // first step whose OUTPUT mentions that file
      let firstSeen = -1;
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].out && steps[i].out.includes(editFile)) { firstSeen = i; break; }
      }
      rowsOut.push({ harness, task: r.taskId, arm: r.arm, rep: r.rep, resolved: !!r.resolved,
        steps: steps.length, editIdx, firstSeen, editFile });
      break;
    }
  }
}

console.log('=== R-1 reject clause: how many tool steps before the eventual first-edit file appears in a result? ===\n');
for (const arm of ['sweet', 'native']) {
  const rs = rowsOut.filter(x => x.arm === arm && x.firstSeen >= 0);
  const solved = rs.filter(x => x.resolved);
  const hist = new Map();
  for (const x of rs) { const k = x.firstSeen === 0 ? '1st call' : x.firstSeen === 1 ? '2nd call' : x.firstSeen <= 3 ? '3rd-4th' : '5th+'; hist.set(k, (hist.get(k) || 0) + 1); }
  const med = a => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  console.log(`${arm}: rollouts with a located first-edit file ${rs.length} (solved ${solved.length})`);
  console.log(`   first appearance of that file, by tool-call index: ${[...hist].sort().map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`   median call index of first appearance: all ${med(rs.map(x => x.firstSeen))}, solved ${med(solved.map(x => x.firstSeen))}`);
  console.log(`   fraction located on the FIRST tool call: all ${(rs.filter(x => x.firstSeen === 0).length / rs.length * 100).toFixed(0)}%, solved ${(solved.filter(x => x.firstSeen === 0).length / Math.max(1, solved.length) * 100).toFixed(0)}%`);
  console.log(`   fraction located within the FIRST TWO tool calls: all ${(rs.filter(x => x.firstSeen <= 1).length / rs.length * 100).toFixed(0)}%, solved ${(solved.filter(x => x.firstSeen <= 1).length / Math.max(1, solved.length) * 100).toFixed(0)}%`);
}
console.log('\nper-harness, sweet arm, solved rollouts only:');
for (const h of Object.keys(RUNS)) {
  const rs = rowsOut.filter(x => x.harness === h && x.arm === 'sweet' && x.resolved && x.firstSeen >= 0);
  if (!rs.length) { console.log(`  ${h}: none`); continue; }
  console.log(`  ${h.padEnd(9)} n=${rs.length}  first-call ${rs.filter(x => x.firstSeen === 0).length}  within-two ${rs.filter(x => x.firstSeen <= 1).length}`);
}
