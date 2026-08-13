// Is the "usage-zeroed subagent transcript" actually a first-record-wins dedup artifact?
// The transcript writes ONE RECORD PER CONTENT BLOCK, all sharing message.id. The current
// reader keeps the first record per id and takes its usage. If a later record for the same
// id carries the real usage, the request is silently dropped.
//
// Classify every message id:  A = first record zeroed, a later record has usage (RECOVERABLE)
//                             B = every record for the id is zeroed (GENUINELY ABSENT)
//                             ok = first record already has usage
// Read-only. Runs over main transcripts AND subagent transcripts.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['screen-v3-20260812', 'sb-claudecode-20260811'];

function allTranscripts(stateRoot) {
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
  walk(stateRoot);
  return out.filter(p => p.includes('/claude-home/projects/'));
}

const tot = (u) => ({
  in: (u?.input_tokens || 0) + (u?.cache_read_input_tokens || 0) + (u?.cache_creation_input_tokens || 0),
  out: u?.output_tokens || 0,
});

for (const RUN of RUNS) {
  const stateRoot = path.join(RESULTS, RUN, 'agent-state');
  if (!existsSync(stateRoot)) { console.log(`${RUN}: no agent-state`); continue; }
  const files = allTranscripts(stateRoot);
  const agg = {
    main: { files: 0, ids: 0, ok: 0, A: 0, B: 0, firstIn: 0, firstOut: 0, bestIn: 0, bestOut: 0 },
    side: { files: 0, ids: 0, ok: 0, A: 0, B: 0, firstIn: 0, firstOut: 0, bestIn: 0, bestOut: 0 },
  };
  const perFile = [];
  for (const f of files) {
    const isSide = f.includes('/subagents/');
    const bucket = isSide ? agg.side : agg.main;
    bucket.files++;
    const byId = new Map();
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      const m = e.message;
      if (!m || m.role !== 'assistant' || !m.id) continue;
      if (!byId.has(m.id)) byId.set(m.id, []);
      byId.get(m.id).push(m.usage || null);
    }
    let ok = 0, A = 0, B = 0;
    for (const [, usages] of byId) {
      bucket.ids++;
      const first = tot(usages[0]);
      // best = the record with the largest (in+out); ties keep the first
      let best = first;
      for (const u of usages) { const c = tot(u); if (c.in + c.out > best.in + best.out) best = c; }
      bucket.firstIn += first.in; bucket.firstOut += first.out;
      bucket.bestIn += best.in; bucket.bestOut += best.out;
      if (first.in || first.out) ok++;
      else if (best.in || best.out) A++;
      else B++;
    }
    bucket.ok += ok; bucket.A += A; bucket.B += B;
    if (A || B) perFile.push({ f: f.slice(stateRoot.length + 1), isSide, ids: byId.size, ok, A, B });
  }
  console.log(`\n===== ${RUN} =====`);
  for (const k of ['main', 'side']) {
    const b = agg[k];
    console.log(`${k}: files=${b.files} requests=${b.ids} | firstRecordHasUsage=${b.ok} recoverable(A)=${b.A} absent(B)=${b.B}`);
    console.log(`      tokens by first-record rule: in=${b.firstIn} out=${b.firstOut}`);
    console.log(`      tokens by best-record rule : in=${b.bestIn} out=${b.bestOut}   (+${b.firstIn ? ((b.bestIn / b.firstIn - 1) * 100).toFixed(1) : '-'}% in, +${b.firstOut ? ((b.bestOut / b.firstOut - 1) * 100).toFixed(1) : '-'}% out)`);
  }
  console.log(`files with any A or B: ${perFile.length}`);
  for (const p of perFile.slice(0, 40)) {
    console.log(`  ${p.isSide ? 'SIDE' : 'MAIN'} ids=${String(p.ids).padStart(3)} ok=${String(p.ok).padStart(3)} A=${String(p.A).padStart(3)} B=${String(p.B).padStart(3)}  ${p.f.split('/')[0]}`);
  }
  if (perFile.length > 40) console.log(`  ... ${perFile.length - 40} more`);
}
