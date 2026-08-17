// C-4 A/B — DEEP TRACE ANALYSIS.
//
// The cost delta cannot resolve anything at this n. What CAN be resolved is whether the
// agent BEHAVES differently, because behaviour is counted per tool call, not per rollout,
// so there are 10-100x more observations. This measures the mechanism end to end:
//
//   Layer 1  DELIVERY   did ss-read serve whole files instead of spans?          (must move)
//   Layer 2  RE-READ    did the agent stop going back to a file it already had?  (the causal claim)
//   Layer 3  THRASH     fewer read->read chains, more read->edit transitions?
//   Layer 4  EDITS      did edits land more often on the first attempt?
//   Layer 5  SHAPE      calls to first edit, total calls, tool mix
//
// Layer 2 is the load-bearing one: C-4 claims its saving comes from REMOVED re-reads. If
// delivery moves but re-reads do not, the mechanism is not doing what the replay assumed.
//
// Read-only over retained transcripts. No model.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const PREFIX = process.argv[2] || 'c4b';
const HARNESSES = process.argv[3] ? process.argv[3].split(',') : ['codex', 'opencode', 'claudecode'];

const walk = (d, pred, depth = 0, out = []) => {
  if (depth > 10) return out;
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, pred, depth + 1, out); else if (pred(p)) out.push(p); }
  return out;
};

function parseSsRead(cmd) {
  if (!/\bss-read\b/.test(cmd)) return null;
  const m = /\bss-read\b([^\n|;&]*)/.exec(cmd); if (!m) return null;
  const toks = m[1].trim().split(/\s+/).filter(Boolean);
  let file = null, a = null, b = null;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.startsWith('-')) continue;
    const c = /^(.*?):(\d+)-(\d+)$/.exec(tk);
    if (c) { file = file || c[1]; a = +c[2]; b = +c[3]; continue; }
    if (!file) { file = tk.replace(/^['"]|['"]$/g, ''); continue; }
    if (/^\d+$/.test(tk)) { if (a == null) a = +tk; else if (b == null) b = +tk; }
  }
  if (a != null && b == null) b = a;                 // wrapper: one arg == single line
  return file ? { file, a, b } : null;
}

/** Extract an ordered tool-call stream per rollout: {tool, file?, span?, ok?, servedWhole?} */
function streamCodex(cellDir) {
  const out = [];
  const asDir = path.join(cellDir, 'agent-state');
  for (const d of (existsSync(asDir) ? readdirSync(asDir) : [])) {
    // EVERY session file is one rollout. Reps share the <task>-<arm> directory, so taking
    // only the longest transcript silently analyses 1 rep in 3.
    for (const f of walk(path.join(asDir, d, 'codex-home', 'sessions'), p => p.endsWith('.jsonl'))) {
      const ev = []; const byCall = new Map();
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const p = o.payload || {}; const ty = p.type || o.type;
        if (ty === 'function_call' || ty === 'custom_tool_call') {
          const cmd = String(p.input ?? p.arguments ?? '') + ' ' + String(p.name ?? '');
          const tool = /\bss-read\b/.test(cmd) ? 'ss-read'
            : /\bss-search\b/.test(cmd) ? 'ss-search' : /\bss-grep\b/.test(cmd) ? 'ss-grep'
              : /\bss-find\b/.test(cmd) ? 'ss-find' : /\bss-trace\b/.test(cmd) ? 'ss-trace'
                : /apply_patch|str_replace/.test(cmd) ? 'edit' : /run_tests/.test(cmd) ? 'test' : 'other';
          const rd = parseSsRead(cmd);
          const e = { tool, file: rd?.file || null, a: rd?.a ?? null, b: rd?.b ?? null };
          ev.push(e); if (p.call_id) byCall.set(p.call_id, e);
        } else if (ty === 'function_call_output' || ty === 'custom_tool_call_output') {
          // codex `output` is EITHER a string OR an array of {type:'input_text', text}.
          const raw = p.output ?? p.result ?? '';
          const txt = Array.isArray(raw) ? raw.map(x => x?.text ?? '').join('\n') : String(raw);
          const e = byCall.get(p.call_id); if (!e) continue;
          e.ok = !/error|failed|not found|no such/i.test(txt.slice(0, 200));
          const m = txt.match(/\(lines (\d+)-(\d+) of (\d+)\)/);
          if (m) { e.servedWhole = (+m[1] === 1 && +m[2] === +m[3]); e.totalLines = +m[3]; }
        }
      }
      if (ev.length) out.push({ cell: d, ev });
    }
  }
  return out;
}

function streamOpencode(cellDir) {
  const out = [];
  for (const d of (existsSync(path.join(cellDir, 'agent-state')) ? readdirSync(path.join(cellDir, 'agent-state')) : [])) {
    const files = walk(path.join(cellDir, 'agent-state', d, 'opencode-retained'), p => p.endsWith('attempt-1.stdout.ndjson'));
    for (const f of files) {
      const ev = [];
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        if (o.type !== 'tool_use') continue;
        const part = o.part || {}; const inp = part.state?.input || {};
        const outTxt = String(part.state?.output ?? '');
        const cmd = String(inp.command || '');
        let tool = part.tool;
        if (part.tool === 'bash') {
          tool = /\bss-read\b/.test(cmd) ? 'ss-read' : /\bss-search\b/.test(cmd) ? 'ss-search'
            : /\bss-grep\b/.test(cmd) ? 'ss-grep' : /\bss-find\b/.test(cmd) ? 'ss-find'
              : /\bss-trace\b/.test(cmd) ? 'ss-trace' : /run_tests/.test(cmd) ? 'test' : 'bash';
        } else if (/^(edit|write|patch|multiedit|apply_patch|str_replace)/i.test(part.tool)) tool = 'edit';
        const rd = parseSsRead(cmd);
        const e = { tool, file: rd?.file || inp.filePath || null, a: rd?.a ?? null, b: rd?.b ?? null };
        e.ok = !/error|failed|not found|String to replace/i.test(outTxt.slice(0, 200));
        const m = outTxt.match(/\(lines (\d+)-(\d+) of (\d+)\)/);
        if (m) { e.servedWhole = (+m[1] === 1 && +m[2] === +m[3]); e.totalLines = +m[3]; }
        ev.push(e);
      }
      if (ev.length) out.push({ cell: d, ev });
    }
  }
  return out;
}

function streamClaude(cellDir) {
  const out = [];
  for (const d of (existsSync(path.join(cellDir, 'agent-state')) ? readdirSync(path.join(cellDir, 'agent-state')) : [])) {
    const files = walk(path.join(cellDir, 'agent-state', d, 'claude-home', 'projects'), p => p.endsWith('.jsonl'))
      .filter(p => !p.includes('/subagents/'));
    for (const f of files) {
      const ev = []; const byId = new Map();
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        for (const b of (o.message?.content || [])) {
          if (b.type === 'tool_use') {
            const cmd = String(b.input?.command || '');
            let tool = b.name;
            if (b.name === 'Bash') {
              tool = /\bss-read\b/.test(cmd) ? 'ss-read' : /\bss-search\b/.test(cmd) ? 'ss-search'
                : /\bss-grep\b/.test(cmd) ? 'ss-grep' : /\bss-find\b/.test(cmd) ? 'ss-find'
                  : /\bss-trace\b/.test(cmd) ? 'ss-trace' : /run_tests/.test(cmd) ? 'test' : 'bash';
            } else if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) tool = 'edit';
            else if (b.name === 'Read') tool = 'native-read';
            const rd = parseSsRead(cmd);
            const e = { tool, file: rd?.file || b.input?.file_path || null, a: rd?.a ?? null, b: rd?.b ?? null };
            ev.push(e); byId.set(b.id, e);
          }
          if (b.type === 'tool_result') {
            const e = byId.get(b.tool_use_id); if (!e) continue;
            const txt = typeof b.content === 'string' ? b.content
              : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
            e.ok = !(b.is_error || /^Error|String to replace not found/i.test(txt));
            const m = txt.match(/\(lines (\d+)-(\d+) of (\d+)\)/);
            if (m) { e.servedWhole = (+m[1] === 1 && +m[2] === +m[3]); e.totalLines = +m[3]; }
          }
        }
      }
      if (ev.length) out.push({ cell: d, ev });
    }
  }
  return out;
}

const STREAM = { codex: streamCodex, opencode: streamOpencode, claudecode: streamClaude };

/** All five behavioural layers for one cell. */
function measure(streams) {
  const m = {
    rollouts: streams.length, reads: 0, wholeServed: 0, spanServed: 0,
    rereads: 0, distinctFilesRead: 0, readReadChains: 0, readEditChains: 0,
    edits: 0, editFail: 0, firstEditAt: [], totalCalls: 0, tools: {},
    revisits: [],           // per rollout: how many files were read 2+ times
  };
  for (const s of streams) {
    const seen = new Map(); let firstEdit = null;
    for (let i = 0; i < s.ev.length; i++) {
      const e = s.ev[i];
      m.totalCalls++; m.tools[e.tool] = (m.tools[e.tool] || 0) + 1;
      if (e.tool === 'ss-read' || e.tool === 'native-read') {
        m.reads++;
        if (e.servedWhole === true) m.wholeServed++; else if (e.servedWhole === false) m.spanServed++;
        if (e.file) {
          const n = (seen.get(e.file) || 0) + 1; seen.set(e.file, n);
          if (n > 1) m.rereads++;
        }
        const nx = s.ev[i + 1];
        if (nx && (nx.tool === 'ss-read' || nx.tool === 'native-read')) m.readReadChains++;
        if (nx && nx.tool === 'edit') m.readEditChains++;
      }
      if (e.tool === 'edit') { m.edits++; if (e.ok === false) m.editFail++; if (firstEdit == null) firstEdit = i + 1; }
    }
    m.distinctFilesRead += seen.size;
    m.revisits.push([...seen.values()].filter(v => v > 1).length);
    if (firstEdit != null) m.firstEditAt.push(firstEdit);
  }
  return m;
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '  n/a';
const arrow = (on, off, lowerBetter = true) => {
  if (off === 0 && on === 0) return '  =';
  const d = on - off;
  if (Math.abs(d) < 1e-9) return '  =';
  const good = lowerBetter ? d < 0 : d > 0;
  return good ? ' ->GOOD' : ' ->WORSE';
};

console.log('=== C-4 DEEP TRACE A/B — five behavioural layers ===\n');
for (const h of HARNESSES) {
  const onDir = path.join(R, `${PREFIX}-${h}-on`), offDir = path.join(R, `${PREFIX}-${h}-off`);
  if (!existsSync(onDir) || !existsSync(offDir)) { console.log(`-- ${h}: cells missing --\n`); continue; }
  const on = measure(STREAM[h](onDir)), off = measure(STREAM[h](offDir));
  if (!on.rollouts || !off.rollouts) { console.log(`-- ${h}: no retained transcripts (on=${on.rollouts} off=${off.rollouts}) --\n`); continue; }
  console.log(`-- ${h} --  rollouts ${on.rollouts} on / ${off.rollouts} off`);
  console.log('   LAYER 1 DELIVERY  — did ss-read serve whole files?');
  console.log(`      whole-file served     ${String(on.wholeServed).padStart(4)} / ${String(off.wholeServed).padStart(4)}   (${pct(on.wholeServed, on.wholeServed + on.spanServed)} vs ${pct(off.wholeServed, off.wholeServed + off.spanServed)})${arrow(-on.wholeServed, -off.wholeServed)}`);
  console.log('   LAYER 2 RE-READ   — the causal claim: fewer returns to a file already held');
  console.log(`      re-reads              ${String(on.rereads).padStart(4)} / ${String(off.rereads).padStart(4)}   per rollout ${(on.rereads / on.rollouts).toFixed(2)} vs ${(off.rereads / off.rollouts).toFixed(2)}${arrow(on.rereads / on.rollouts, off.rereads / off.rollouts)}`);
  console.log(`      files revisited 2+x   ${mean(on.revisits).toFixed(2)} vs ${mean(off.revisits).toFixed(2)} per rollout${arrow(mean(on.revisits), mean(off.revisits))}`);
  console.log('   LAYER 3 THRASH    — read->read chains vs read->edit transitions');
  console.log(`      read->read            ${String(on.readReadChains).padStart(4)} / ${String(off.readReadChains).padStart(4)}   per rollout ${(on.readReadChains / on.rollouts).toFixed(2)} vs ${(off.readReadChains / off.rollouts).toFixed(2)}${arrow(on.readReadChains / on.rollouts, off.readReadChains / off.rollouts)}`);
  console.log(`      read->edit            ${String(on.readEditChains).padStart(4)} / ${String(off.readEditChains).padStart(4)}   per rollout ${(on.readEditChains / on.rollouts).toFixed(2)} vs ${(off.readEditChains / off.rollouts).toFixed(2)}${arrow(on.readEditChains / on.rollouts, off.readEditChains / off.rollouts, false)}`);
  console.log('   LAYER 4 EDITS     — do edits land first time?');
  console.log(`      edit failures         ${String(on.editFail).padStart(4)} / ${String(off.editFail).padStart(4)}   of ${on.edits} vs ${off.edits} edits (${pct(on.editFail, on.edits)} vs ${pct(off.editFail, off.edits)})${arrow(on.editFail / Math.max(1, on.edits), off.editFail / Math.max(1, off.edits))}`);
  console.log('   LAYER 5 SHAPE     — orientation cost');
  console.log(`      calls to first edit   ${mean(on.firstEditAt).toFixed(1)} vs ${mean(off.firstEditAt).toFixed(1)}${arrow(mean(on.firstEditAt), mean(off.firstEditAt))}`);
  console.log(`      total calls/rollout   ${(on.totalCalls / on.rollouts).toFixed(1)} vs ${(off.totalCalls / off.rollouts).toFixed(1)}${arrow(on.totalCalls / on.rollouts, off.totalCalls / off.rollouts)}`);
  console.log(`      reads/rollout         ${(on.reads / on.rollouts).toFixed(1)} vs ${(off.reads / off.rollouts).toFixed(1)}${arrow(on.reads / on.rollouts, off.reads / off.rollouts)}`);
  const mix = m => Object.entries(m.tools).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}=${(v / m.rollouts).toFixed(1)}`).join(' ');
  console.log(`      tool mix on           ${mix(on)}`);
  console.log(`      tool mix off          ${mix(off)}`);
  console.log('');
}
console.log('READ ORDER: Layer 1 must move or the cell is inert. Layer 2 is the mechanism.');
console.log('Layers 3-5 are consequences and are the ones that would show a DISTRACTION cost.');
