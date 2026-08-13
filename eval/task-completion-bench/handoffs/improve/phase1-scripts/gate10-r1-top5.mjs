// GATE 10 (cont.) — R-1 localization clause, measured as an UPPER BOUND at $0.
// The gate wants: rebuild the index, run the ISSUE TEXT as a query, require the eventual
// first-edit file in the top five for a strong majority of solved rollouts.
// A turn-0 dossier can only use the RAW ISSUE TEXT (no model). The retained rollouts already
// contain something strictly stronger: the agent's FIRST retrieval call, whose query was
// written by the model after reading the issue. If that model-refined query does not put the
// first-edit file in its top five, a raw-issue-text query cannot do better. So this measures
// an upper bound on the dossier's hit rate without rebuilding a single index.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811', screen: 'screen-v3-20260812' };
const RETRIEVAL = /\bss-(search|grep|find|semantic|batch)\b/;

function files(root) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 10) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (/\.(jsonl|ndjson)$/.test(e.name)) out.push(p); } };
  walk(root);
  return out.filter(p => !p.includes('/subagents/'));
}
const base = p => String(p || '').split('/').filter(Boolean).pop();

function steps(harness, file) {
  const out = [];
  const txt = readFileSync(file, 'utf8');
  if (harness === 'codex') {
    let cur = null;
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      const p = o.payload || {}; const ty = p.type || o.type;
      if (ty === 'function_call' || ty === 'custom_tool_call') { cur = { cmd: String(p.input ?? p.arguments ?? ''), out: '' }; out.push(cur); }
      else if ((ty === 'function_call_output' || ty === 'custom_tool_call_output') && cur) {
        cur.out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output); cur = null;
      }
    }
  } else if (harness === 'opencode') {
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      if (o.type !== 'tool_use') continue;
      const st = o.part?.state || {};
      out.push({ cmd: JSON.stringify(st.input || {}), out: String(st.output || ''), tool: o.part?.tool });
    }
  } else {
    const byId = new Map();
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type === 'tool_use') { const s = { cmd: JSON.stringify(b.input || {}), out: '', tool: b.name }; byId.set(b.id, s); out.push(s); }
        if (b.type === 'tool_result') { const s = byId.get(b.tool_use_id); if (!s) continue;
          s.out = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : ''; }
      }
    }
  }
  return out;
}

/** Ordered distinct file paths named in a retrieval result. */
function resultFiles(text) {
  const out = [];
  // Codex wraps tool output in a JSON envelope, so real newlines arrive as the two
  // characters \ and n. Un-escape before matching or every path after the first is missed.
  const flat = String(text || '').replace(/\\r\\n|\\n|\\t/g, '\n');
  const re = /(?:^|[\s"'`(\[])((?:[\w.@+-]+\/)+[\w.+-]+\.[A-Za-z0-9]{1,6})(?::\d+)?/gm;
  for (const m of flat.matchAll(re)) {
    const f = base(m[1]);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

const EDIT = /apply_patch|\*\*\* (Begin Patch|Update File|Add File)|"tool":"(edit|write|patch)"/i;
const rows = [];
for (const [harness, run] of Object.entries(RUNS)) {
  const rr = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
  for (const r of rr) {
    if (r.arm !== 'sweet') continue;
    const cell = path.join(RESULTS, run, 'agent-state', `${r.taskId}-${r.arm}`);
    if (!existsSync(cell)) continue;
    for (const f of files(cell)) {
      if (harness === 'claude' || harness === 'screen') {
        const slug = f.split('/claude-home/projects/')[1]?.split('/')[0] || '';
        const m = /--r(\d+)--\d+$/.exec(slug); if (m && +m[1] !== r.rep) continue;
      }
      const S = steps(harness === 'screen' ? 'claude' : harness, f);
      if (!S.length) continue;
      let editFile = null;
      for (const s of S) {
        const isEdit = (s.tool && /^(Edit|MultiEdit|Write|edit|write|patch)$/i.test(s.tool)) || EDIT.test(s.cmd);
        if (!isEdit) continue;
        const m = /"file_path"\s*:\s*"([^"]+)"|\*\*\* (?:Update|Add) File: ([^\n"\\]+)|"filePath"\s*:\s*"([^"]+)"/.exec(s.cmd);
        const fp = m ? (m[1] || m[2] || m[3]) : null;
        if (fp) { editFile = base(fp); break; }
      }
      if (!editFile) continue;
      const first = S.find(s => RETRIEVAL.test(s.cmd) && s.out);
      if (!first) { rows.push({ harness, task: r.taskId, rep: r.rep, resolved: !!r.resolved, rank: null, note: 'no-retrieval-call' }); break; }
      const list = resultFiles(first.out);
      const idx = list.indexOf(editFile);
      rows.push({ harness, task: r.taskId, rep: r.rep, resolved: !!r.resolved,
        rank: idx < 0 ? null : idx + 1, nResults: list.length, editFile });
      break;
    }
  }
}

const scored = rows.filter(r => !r.note);
const solved = scored.filter(r => r.resolved);
const pct = (a, b) => `${a}/${b} = ${(a / Math.max(1, b) * 100).toFixed(0)}%`;
console.log('=== R-1 localization upper bound: first-edit file inside the FIRST retrieval call\'s results ===\n');
console.log(`sweet rollouts with a first-edit file and a retrieval call: ${scored.length} (solved ${solved.length})`);
console.log(`no retrieval call at all: ${rows.filter(r => r.note).length}`);
for (const [label, set] of [['ALL', scored], ['SOLVED', solved]]) {
  const top1 = set.filter(r => r.rank === 1).length;
  const top5 = set.filter(r => r.rank && r.rank <= 5).length;
  const top10 = set.filter(r => r.rank && r.rank <= 10).length;
  const miss = set.filter(r => r.rank == null).length;
  console.log(`\n${label}: top1 ${pct(top1, set.length)} | TOP5 ${pct(top5, set.length)} | top10 ${pct(top10, set.length)} | absent ${pct(miss, set.length)}`);
}
console.log('\nper-harness, solved only, top-5 hit rate:');
for (const h of Object.keys(RUNS)) {
  const s = solved.filter(r => r.harness === h);
  if (!s.length) { console.log(`  ${h}: none`); continue; }
  console.log(`  ${h.padEnd(9)} ${pct(s.filter(r => r.rank && r.rank <= 5).length, s.length)}`);
}
console.log('\nmisses (solved rollouts where the first retrieval call never named the edited file):');
for (const r of solved.filter(x => x.rank == null)) console.log(`  ${r.harness.padEnd(9)} ${r.task.padEnd(44)} r${r.rep}  edited ${r.editFile}  (results listed ${r.nResults} files)`);
