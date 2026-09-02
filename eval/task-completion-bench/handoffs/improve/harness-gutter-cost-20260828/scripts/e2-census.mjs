// e2-census.mjs — per-tool-family output census straight from the transcripts:
// bytes/call, code lines delivered, and how many of those lines carry a line-number gutter.
// Answers H2 (native's per-call read size) and H11 (the newly-numbered search surfaces).
import fs from 'node:fs';
import { load, cellRows, mean } from './e2-cells.mjs';

const d = load();
const R = d.rollouts;
const GUT = /^\s*\d+(\t|\| |: )/;
const CODEISH = /[;{}()=]|^\s*(def|function|class|import|from|const|let|var|public|private|if|for|while|return)\b/;

function callsOf(rec) {
  // re-parse the transcript for this rollout, returning [{fam, bytes, text}]
  const out = [];
  const push = (fam, text) => out.push({ fam, bytes: Buffer.byteLength(text || '', 'utf8'), text: text || '' });
  if (rec.harness === 'codex') {
    let t; try { t = fs.readFileSync(rec.transcript, 'utf8'); } catch { return out; }
    const pend = new Map();
    for (const l of t.split('\n')) {
      if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
      const p = o.payload || {}; const ty = p.type || o.type;
      if (ty === 'function_call' || ty === 'custom_tool_call') {
        let cmd = '';
        if (ty === 'function_call') { try { cmd = JSON.parse(p.arguments || '{}').cmd || ''; } catch { cmd = ''; } }
        else cmd = String(p.input || '');
        pend.set(p.call_id, { name: p.name, cmd });
      } else if (ty === 'function_call_output' || ty === 'custom_tool_call_output') {
        const c = pend.get(p.call_id); if (!c) continue;
        push(famOf('codex', c.name, c.cmd), typeof p.output === 'string' ? p.output : JSON.stringify(p.output || ''));
      }
    }
  } else if (rec.harness === 'opencode') {
    let t; try { t = fs.readFileSync(rec.transcript, 'utf8'); } catch { return out; }
    for (const l of t.split('\n')) {
      const tl = l.trim(); if (!tl || tl[0] !== '{') continue;
      let ev; try { ev = JSON.parse(tl); } catch { continue; }
      const p = ev.part || ev.properties?.part || ev; const ty = ev.type || p.type;
      if (!(ty === 'tool_use' || (p && p.tool && p.state))) continue;
      const st = p.state || {}; const inp = st.input || {};
      const o = st.output || '';
      push(famOf('opencode', p.tool, inp.command || ''), typeof o === 'string' ? o : JSON.stringify(o || ''));
    }
  } else {
    let t; try { t = fs.readFileSync(rec.transcript, 'utf8'); } catch { return out; }
    const names = new Map(); const res = [];
    for (const l of t.split('\n')) {
      const tl = l.trim(); if (!tl || tl[0] !== '{') continue;
      let ev; try { ev = JSON.parse(tl); } catch { continue; }
      const m = ev.message; if (!m) continue;
      if (m.role === 'assistant') {
        for (const b of (m.content || [])) if (b.type === 'tool_use' && b.id && !names.has(b.id))
          names.set(b.id, famOf('claude-code', b.name, (b.input && (b.input.command || '')) || ''));
      } else if (m.role === 'user' && Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type !== 'tool_result') continue;
          let s = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.map(x => (typeof x === 'string' ? x : (x?.text || ''))).join('') : '';
          res.push([b.tool_use_id, s]);
        }
      }
    }
    for (const [id, s] of res) push(names.get(id) || 'other', s);
  }
  return out;
}
const SS = ['ss-search', 'ss-semantic', 'ss-trace', 'ss-grep', 'ss-find', 'ss-read'];
function famOf(harness, name, cmd) {
  const c = String(cmd || '');
  for (const t of SS) if (new RegExp(`(^|[;&|(\\n\`$]|\\s)${t}\\b`).test(c)) return t;
  if (/(^|[;&|(\n`$]|\s)run_tests\b/.test(c)) return 'run_tests';
  if (/apply_patch/.test(c)) return 'edit';
  if (harness === 'codex') {
    if (name === 'update_plan') return 'plan';
    if (name === 'write_stdin') return 'poll';
    if (/(^|[;&|(\n`$]|\s)(sed|cat|nl|head|tail)\b/.test(c)) return 'nativeRead';
    if (/(^|[;&|(\n`$]|\s)(grep|rg|ag|find|fd|ls)\b/.test(c)) return 'nativeGrep';
    if (/(^|[;&|(\n`$]|\s)git\b/.test(c)) return 'git';
    return 'other';
  }
  if (harness === 'opencode') {
    if (name === 'read') return 'nativeRead';
    if (['grep', 'glob', 'list'].includes(name)) return 'nativeGrep';
    if (['apply_patch', 'edit', 'write'].includes(name)) return 'edit';
    if (name === 'todowrite' || name === 'todoread') return 'plan';
    if (name === 'task') return 'delegate';
    if (name === 'bash') {
      if (/(^|[;&|(\n`$]|\s)(sed|cat|nl|head|tail)\b/.test(c)) return 'nativeRead';
      if (/(^|[;&|(\n`$]|\s)(grep|rg|ag|find|fd|ls)\b/.test(c)) return 'nativeGrep';
      if (/(^|[;&|(\n`$]|\s)git\b/.test(c)) return 'git';
    }
    return 'other';
  }
  if (['Read', 'NotebookRead'].includes(name)) return 'nativeRead';
  if (['Grep', 'Glob', 'LS'].includes(name)) return 'nativeGrep';
  if (['Edit', 'MultiEdit', 'Write'].includes(name)) return 'edit';
  if (['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskView'].includes(name)) return 'plan';
  if (['Task', 'Agent'].includes(name)) return 'delegate';
  if (name === 'Bash' || name === 'BashOutput') {
    if (/(^|[;&|(\n`$]|\s)(sed|cat|nl|head|tail)\b/.test(c)) return 'nativeRead';
    if (/(^|[;&|(\n`$]|\s)(grep|rg|ag|find|fd|ls)\b/.test(c)) return 'nativeGrep';
    if (/(^|[;&|(\n`$]|\s)git\b/.test(c)) return 'git';
  }
  return 'other';
}

const cells = [];
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, form] of [['A', 'pipe'], ['A', 'native'], ['B', 'tab'], ['B', 'native'],
    ['C', 'tab'], ['C', 'none'], ['C', 'pipe'], ['C', 'native']])
    cells.push({ harness, epoch, form });

const rowsOut = [];
for (const cell of cells) {
  const rs = cellRows(R, cell); if (!rs.length) continue;
  const agg = {};
  let gutLines = 0, rawLines = 0, gutLinesSearch = 0, rawLinesSearch = 0;
  for (const rec of rs) {
    for (const c of callsOf(rec)) {
      const a = agg[c.fam] = agg[c.fam] || { calls: 0, bytes: 0, lines: 0, gut: 0 };
      a.calls++; a.bytes += c.bytes;
      // count code-ish lines and gutter share inside fenced blocks
      let inFence = false;
      for (const ln of c.text.split('\n')) {
        if (/^\s*```/.test(ln)) { inFence = !inFence; continue; }
        if (!inFence) continue;
        a.lines++;
        const g = GUT.test(ln);
        if (g) a.gut++;
        if (['ss-search', 'ss-find', 'ss-semantic'].includes(c.fam)) { if (g) gutLinesSearch++; else rawLinesSearch++; }
        if (c.fam.startsWith('ss-')) { if (g) gutLines++; else rawLines++; }
      }
    }
  }
  rowsOut.push({ ...cell, n: rs.length, agg, gutLines, rawLines, gutLinesSearch, rawLinesSearch });
}
console.log('=== per-rollout tool-output by family: calls / bytes / bytes-per-call ===');
const fams = ['ss-read', 'ss-search', 'ss-find', 'ss-grep', 'ss-semantic', 'ss-trace',
  'nativeRead', 'nativeGrep', 'run_tests', 'edit', 'git', 'plan', 'poll', 'delegate', 'other'];
console.log(['harness', 'epoch', 'form', 'n', ...fams.map(f => f + '.c/B/BpC')].join('\t'));
for (const r of rowsOut) {
  const cols = fams.map(f => { const a = r.agg[f]; if (!a || !a.calls) return '-';
    return `${(a.calls / r.n).toFixed(2)}/${(a.bytes / r.n).toFixed(0)}/${(a.bytes / a.calls).toFixed(0)}`; });
  console.log([r.harness, r.epoch, r.form, r.n, ...cols].join('\t'));
}
console.log('\n=== gutter census on ss-* fenced code lines (per cell totals) ===');
console.log(['harness', 'epoch', 'form', 'n', 'ss_all_gut', 'ss_all_raw', 'rawShare%', 'search_gut', 'search_raw', 'searchRawShare%'].join('\t'));
for (const r of rowsOut) {
  if (r.form === 'native') continue;
  const t = r.gutLines + r.rawLines, ts = r.gutLinesSearch + r.rawLinesSearch;
  console.log([r.harness, r.epoch, r.form, r.n, r.gutLines, r.rawLines, t ? (r.rawLines / t * 100).toFixed(1) : '-',
    r.gutLinesSearch, r.rawLinesSearch, ts ? (r.rawLinesSearch / ts * 100).toFixed(1) : '-'].join('\t'));
}
fs.writeFileSync('/tmp/fp-inv/e2/census.json', JSON.stringify(rowsOut));
