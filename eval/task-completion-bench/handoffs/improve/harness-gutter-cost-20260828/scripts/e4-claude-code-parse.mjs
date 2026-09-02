// e4-claude-code-parse.mjs — shared claude-code trace parser for the fresh-pool runs.
// Read-only. Dedupe by BLOCK (tool_use.id / tool_result.tool_use_id), never by record.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = '/root/sweet-search-private/eval/task-completion-bench';
export const RUNS = {
  TAB:  'fp-claudecode-tab-20260826',
  NONE: 'fp-claudecode-none-20260826',
  PIPE: 'fp-claudecode-pipe-20260826',
};
export const walk = (d, out = []) => {
  let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, out) : out.push(p); }
  return out;
};
export const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Return [{rep, file, sub:[files]}] for a cell.
export function transcriptsOf(runId, task, arm) {
  const cell = path.join(ROOT, 'results', runId, 'agent-state', `${task}-${arm}`);
  if (!fs.existsSync(cell)) return [];
  const all = walk(cell).filter(f => f.endsWith('.jsonl') && f.includes('/claude-home/projects/'));
  const mains = all.filter(f => !f.includes('/subagents/'));
  return mains.map(f => {
    const m = f.match(/-root--ss-eval-runs-r(\d+)-\d+/);
    const rep = m ? Number(m[1]) : null;
    const sid = path.basename(f, '.jsonl');
    const sub = all.filter(x => x.includes(`/${sid}/subagents/`));
    return { rep, file: f, sub, size: fs.statSync(f).size };
  }).sort((a, b) => (a.rep - b.rep) || a.file.localeCompare(b.file));
}

// Parse one transcript file into an ordered event list.
export function parseTranscript(file) {
  const seen = new Set(); const seenUsage = new Set();
  const events = []; const usage = [];
  for (const d of jl(file)) {
    const m = d.message; if (!m) continue;
    const rid = d.requestId || m.id;
    const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
    for (const b of blocks) {
      const key = b.type === 'tool_use' ? `tu:${b.id}`
        : b.type === 'tool_result' ? `tr:${b.tool_use_id}`
        : `${b.type}:${String(b.text ?? b.thinking ?? '').slice(0, 160)}`;
      if (seen.has(key)) continue; seen.add(key);
      if (b.type === 'tool_use') events.push({ k: 'call', id: b.id, name: b.name, input: b.input || {} });
      else if (b.type === 'tool_result') {
        const c = b.content;
        const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || JSON.stringify(x)).join('\n') : JSON.stringify(c ?? '');
        events.push({ k: 'result', id: b.tool_use_id, isError: !!b.is_error, text: txt });
      } else if (b.type === 'text') events.push({ k: 'text', role: m.role, text: String(b.text ?? '') });
      else if (b.type === 'thinking') events.push({ k: 'think', text: String(b.thinking ?? '') });
    }
    if (m.usage && rid && !seenUsage.has(rid)) { seenUsage.add(rid); usage.push(m.usage); }
  }
  // pair calls with results
  const byId = new Map();
  for (const e of events) if (e.k === 'call') byId.set(e.id, { ...e, result: null, isError: false });
  for (const e of events) if (e.k === 'result' && byId.has(e.id)) { const c = byId.get(e.id); c.result = e.text; c.isError = e.isError; }
  return { events, usage, calls: [...byId.values()] };
}

// classify a Bash command into the ss-* tool it invokes (or null)
export const SS_TOOLS = ['ss-search', 'ss-semantic', 'ss-grep', 'ss-find', 'ss-trace', 'ss-read', 'ss-files', 'ss-edit'];
export function ssToolsIn(cmd) {
  const s = String(cmd || '');
  const hits = [];
  // match at a word boundary; the wrappers are invoked bare on PATH
  for (const t of SS_TOOLS) {
    const re = new RegExp(`(^|[\\s;&|(\`'"])${t}(\\s|$)`, 'g');
    let m; while ((m = re.exec(s))) hits.push({ tool: t, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.tool);
}
