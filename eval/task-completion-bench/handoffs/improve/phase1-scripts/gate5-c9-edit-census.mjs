// GATE 5 — C-9 re-census. C-9's evidence base was "the 20 observed failed edits" on the
// PRE-C-1 run. C-1 shipped and removed the whitespace-carry class. Establish the post-C-1
// failed-edit population, classified, before evaluating the >=90% addressability bar.
// Read-only, over the MAIN transcripts of a claude-code run.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUN = process.argv[2] || 'screen-v3-20260812';
const root = path.join(RESULTS, RUN, 'agent-state');

function transcripts(r) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith('.jsonl')) out.push(p); } };
  walk(r);
  return out.filter(p => p.includes('/claude-home/projects/'));
}

const CLASSES = [
  [/String to replace not found|old_string.*not found|not found in file/i, 'anchor-not-found'],
  [/Found (\d+) matches of the string to replace|not unique|multiple/i, 'anchor-ambiguous'],
  [/has not been read yet|Read the file first|must read/i, 'unread-file'],
  [/File does not exist|no such file|ENOENT/i, 'wrong-path'],
  [/File has been modified|modified since read|changed since/i, 'stale-file'],
  [/Invalid pages parameter/i, 'pages-parameter'],
  [/EISDIR|is a directory/i, 'is-directory'],
  [/String to replace and new string are exactly the same|no changes/i, 'no-op-edit'],
];
const classify = t => (CLASSES.find(([re]) => re.test(t)) || [null, 'other'])[1];

const byArm = { native: new Map(), sweet: new Map() };
const editErrors = [];
let toolResults = 0, errorResults = 0;
const editCalls = { native: 0, sweet: 0 };

for (const f of transcripts(root)) {
  if (f.includes('/subagents/')) continue;
  const cell = f.slice(root.length + 1).split('/')[0];
  const arm = cell.endsWith('-native') ? 'native' : 'sweet';
  const task = cell.replace(/-(native|sweet)$/, '');
  const nameById = new Map();
  const lines = readFileSync(f, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let e; try { e = JSON.parse(t); } catch { continue; }
    for (const b of (e.message?.content || [])) {
      if (b.type === 'tool_use') {
        nameById.set(b.id, { name: b.name, input: b.input });
        if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) editCalls[arm]++;
      }
      if (b.type === 'tool_result') {
        toolResults++;
        const txt = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
        if (!b.is_error && !/^Error|error:/i.test(txt)) continue;
        errorResults++;
        const call = nameById.get(b.tool_use_id) || {};
        const cls = classify(txt);
        const key = `${call.name || '?'}:${cls}`;
        byArm[arm].set(key, (byArm[arm].get(key) || 0) + 1);
        if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(call.name || '')) {
          editErrors.push({ task, arm, tool: call.name, cls,
            file: call.input?.file_path, msg: txt.slice(0, 150).replace(/\n/g, ' '),
            oldStr: (call.input?.old_string || '').slice(0, 90).replace(/\n/g, '\\n') });
        }
      }
    }
  }
}

console.log(`=== ${RUN}: tool results ${toolResults}, error results ${errorResults} ===`);
console.log(`Edit-family calls: native ${editCalls.native}, sweet ${editCalls.sweet}\n`);
for (const arm of ['native', 'sweet']) {
  console.log(`-- ${arm} error classes --`);
  for (const [k, v] of [...byArm[arm]].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
}
console.log(`\n=== EDIT-FAMILY FAILURES: ${editErrors.length} total ===`);
const byCls = new Map();
for (const e of editErrors) {
  const k = `${e.arm}/${e.cls}`;
  byCls.set(k, (byCls.get(k) || 0) + 1);
}
for (const [k, v] of [...byCls].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log('\ndetail:');
for (const e of editErrors) {
  console.log(`  ${e.arm.padEnd(6)} ${e.cls.padEnd(18)} ${e.tool.padEnd(9)} ${String(e.file || '').split('/').slice(-2).join('/')} | old="${e.oldStr}" | ${e.msg}`);
}
