// The transcript writes ONE RECORD PER CONTENT BLOCK, sharing message.id. The reader
// dedups by id and keeps the FIRST record only. Question: how much assistant content does
// that discard, in MAIN transcripts? retainedOutputChars feeds the degeneration detector
// (billed/retained ratio), so a systematic under-count would inflate every ratio.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUN = process.argv[2] || 'screen-v3-20260812';
const stateRoot = path.join(RESULTS, RUN, 'agent-state');

function transcripts(root) {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out.filter(p => p.includes('/claude-home/projects/'));
}

const chars = (b) => (typeof b.text === 'string' ? b.text.length : 0)
  + (typeof b.thinking === 'string' ? b.thinking.length : 0)
  + (b.type === 'tool_use' ? Object.values(b.input || {}).filter(v => typeof v === 'string').reduce((a, v) => a + v.length, 0) : 0);

const agg = { main: { recs: 0, ids: 0, firstChars: 0, allChars: 0, redactedBlobs: 0, redactedChars: 0 },
              side: { recs: 0, ids: 0, firstChars: 0, allChars: 0, redactedBlobs: 0, redactedChars: 0 } };
const perCell = [];
for (const f of transcripts(stateRoot)) {
  const isSide = f.includes('/subagents/');
  const b = isSide ? agg.side : agg.main;
  const byId = new Map();
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let e; try { e = JSON.parse(t); } catch { continue; }
    const m = e.message;
    if (!m || m.role !== 'assistant' || !m.id) continue;
    if (!byId.has(m.id)) byId.set(m.id, []);
    byId.get(m.id).push(m.content || []);
  }
  let first = 0, all = 0, recs = 0;
  for (const [, recList] of byId) {
    recs += recList.length;
    first += (recList[0] || []).reduce((a, x) => a + chars(x), 0);
    for (const r of recList) for (const x of r) {
      all += chars(x);
      if (x.type === 'redacted_thinking') { b.redactedBlobs++; b.redactedChars += (x.data || '').length; }
    }
  }
  b.recs += recs; b.ids += byId.size; b.firstChars += first; b.allChars += all;
  if (!isSide) perCell.push({ cell: f.slice(stateRoot.length + 1).split('/')[0], ids: byId.size, recs, first, all });
}

for (const k of ['main', 'side']) {
  const b = agg[k];
  console.log(`${RUN} ${k}: requests=${b.ids} records=${b.recs} (${(b.recs / (b.ids || 1)).toFixed(2)} records/request)`);
  console.log(`   assistant chars, first-record-only: ${b.firstChars}`);
  console.log(`   assistant chars, all records      : ${b.allChars}  (${b.firstChars ? ((b.allChars / b.firstChars - 1) * 100).toFixed(1) : '-'}% more)`);
  console.log(`   redacted_thinking blobs: ${b.redactedBlobs}, blob chars ${b.redactedChars}`);
}
console.log('\nper-cell (main) worst 10 by ratio:');
perCell.sort((a, b) => (b.all / (b.first || 1)) - (a.all / (a.first || 1)));
for (const c of perCell.slice(0, 10)) console.log(`  ${c.cell.padEnd(48)} ids=${c.ids} recs=${c.recs} first=${c.first} all=${c.all} x${(c.all / (c.first || 1)).toFixed(2)}`);
