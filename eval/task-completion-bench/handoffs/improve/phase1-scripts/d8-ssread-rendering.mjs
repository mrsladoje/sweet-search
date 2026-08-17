// Pull the RAW ss-read output that the agent saw for the failing region, byte-escaped,
// and compare it to the file on disk. This decides whether ss-read's rendering is what
// added the extra leading space.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const GOLDEN = '/root/.ss-eval/golden';
const RUN = 'sb-claudecode-20260811';
const TASK = 'dart-lang__http-1114';
const root = path.join(RESULTS, RUN, 'agent-state', `${TASK}-sweet`);

const transcripts = r => {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith('.jsonl')) out.push(p); }
  };
  walk(r);
  return out.filter(p => p.includes('/claude-home/projects/') && !p.includes('/subagents/'));
};

const byId = new Map();
const outs = [];
for (const f of transcripts(root)) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let e; try { e = JSON.parse(t); } catch { continue; }
    for (const b of (e.message?.content || [])) {
      if (b.type === 'tool_use') byId.set(b.id, { name: b.name, input: b.input });
      if (b.type === 'tool_result') {
        const call = byId.get(b.tool_use_id); if (!call) continue;
        const txt = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
        const cmd = String(call.input?.command || '');
        if (call.name === 'Bash' && /\bss-read\b/.test(cmd)) outs.push({ via: 'ss-read', cmd, txt });
        else if (call.name === 'Read') outs.push({ via: 'native-Read', cmd: String(call.input?.file_path || ''), txt });
      }
    }
  }
}

console.log(`=== reader outputs in ${TASK} sweet: ${outs.length} ===\n`);
for (const o of outs) console.log(`  ${o.via.padEnd(12)} ${o.cmd.slice(0, 110)}`);

// find the one that shows base_response.dart around the constructor
const target = 'this.headers = const {},';
console.log(`\n=== every rendering containing ${JSON.stringify(target)} ===`);
for (const o of outs) {
  if (!o.txt.includes(target.trim())) continue;
  console.log(`\n--- via ${o.via} :: ${o.cmd.slice(0, 100)} ---`);
  const ls = o.txt.split('\n');
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].includes('this.headers = const {}')) continue;
    for (let k = Math.max(0, i - 4); k <= Math.min(ls.length - 1, i + 3); k++) {
      console.log(`   ${String(k).padStart(3)} ${JSON.stringify(ls[k])}`);
    }
    break;
  }
}

const goldenDirs = readdirSync(GOLDEN);
const g = goldenDirs.find(d => d.endsWith('@5c75da6e084145b27c046827b89d518e30c19048'));
const abs = path.join(GOLDEN, g, 'lib/src/base_response.dart');
console.log(`\n=== the file ON DISK (${existsSync(abs) ? 'found' : 'MISSING'}) ===`);
if (existsSync(abs)) {
  const ls = readFileSync(abs, 'utf8').split('\n');
  for (let i = 54; i < 66; i++) console.log(`   ${String(i + 1).padStart(3)} ${JSON.stringify(ls[i])}`);
}
