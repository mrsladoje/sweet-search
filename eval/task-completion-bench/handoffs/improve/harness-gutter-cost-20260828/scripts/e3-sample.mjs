// e3-sample.mjs — dump one ss-read + one ss-search tool result per (harness, form)
// so the gutter form actually delivered in epoch C is READ, not assumed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';

function walk(dir, pred, out = [], depth = 0) {
  if (depth > 8) return out;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out, depth + 1);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// ---- per-harness call extraction ------------------------------------------
function codexCalls(file) {
  const calls = [];
  const pending = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload || {}; const t = p.type || o.type;
    if (t === 'function_call' || t === 'custom_tool_call') {
      let cmd = '';
      if (t === 'function_call') { try { cmd = JSON.parse(p.arguments || '{}').cmd || ''; } catch { cmd = p.arguments || ''; } }
      else cmd = p.input || '';
      pending.set(p.call_id, Array.isArray(cmd) ? cmd.join(' ') : String(cmd));
    } else if (t === 'function_call_output' || t === 'custom_tool_call_output') {
      const cmd = pending.get(p.call_id) || '';
      let out = p.output;
      if (typeof out === 'object' && out) out = out.content ?? JSON.stringify(out);
      calls.push({ cmd, out: String(out ?? '') });
    }
  }
  return calls;
}

function opencodeCalls(file) {
  const calls = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'tool_use') continue;
    const st = o.part?.state || {};
    calls.push({ cmd: JSON.stringify(st.input || {}), tool: o.part?.tool, out: String(st.output ?? '') });
  }
  return calls;
}

function claudeCalls(file) {
  const calls = [];
  const uses = new Map();
  const results = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const tr = line.trim(); if (!tr || tr[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tr); } catch { continue; }
    const m = ev.message; if (!m) continue;
    for (const b of (m.content || [])) {
      if (b.type === 'tool_use' && b.id) uses.set(b.id, { name: b.name, input: b.input });
      if (b.type === 'tool_result' && b.tool_use_id) {
        let c = b.content;
        if (Array.isArray(c)) c = c.map(x => (typeof x === 'string' ? x : x?.text || '')).join('\n');
        results.set(b.tool_use_id, String(c ?? ''));
      }
    }
  }
  for (const [id, u] of uses) calls.push({ cmd: JSON.stringify(u.input || {}), tool: u.name, out: results.get(id) || '' });
  return calls;
}

const HARNESS = {
  codex: { runs: { tab: 'fp-codex-tab-20260826', none: 'fp-codex-none-20260826', pipe: 'fp-codex-pipe-20260826' }, find: d => walk(d, p => /rollout-.*\.jsonl$/.test(p)), parse: codexCalls },
  opencode: { runs: { tab: 'fp-opencode-tab-20260826', none: 'fp-opencode-none-20260826', pipe: 'fp-opencode-pipe-20260826' }, find: d => walk(d, p => p.endsWith('attempt-1.stdout.ndjson')), parse: opencodeCalls },
  'claude-code': { runs: { tab: 'fp-claudecode-tab-20260826', none: 'fp-claudecode-none-20260826', pipe: 'fp-claudecode-pipe-20260826' }, find: d => walk(d, p => /\/projects\/[^/]+\/[0-9a-f-]{36}\.jsonl$/.test(p)), parse: claudeCalls },
};

const want = process.argv[2] || 'ss-read';
for (const [h, cfg] of Object.entries(HARNESS)) {
  for (const [form, run] of Object.entries(cfg.runs)) {
    const base = join(R, run, 'agent-state');
    let cells; try { cells = readdirSync(base).filter(d => d.endsWith('-sweet')); } catch { continue; }
    let shown = 0;
    for (const cell of cells) {
      if (shown) break;
      for (const f of cfg.find(join(base, cell))) {
        if (shown) break;
        for (const c of cfg.parse(f)) {
          const s = (c.cmd || '') + ' ' + (c.tool || '');
          if (!s.includes(want)) continue;
          if (!c.out || c.out.length < 400) continue;
          console.log(`\n########## ${h} / ${form} / ${cell} ##########`);
          console.log('CMD:', JSON.stringify(c.cmd).slice(0, 300));
          console.log('OUT (first 1200 bytes, JSON-escaped):');
          console.log(JSON.stringify(c.out.slice(0, 1200)));
          shown = 1; break;
        }
      }
    }
    if (!shown) console.log(`\n########## ${h} / ${form}: NO ${want} SAMPLE FOUND ##########`);
  }
}
