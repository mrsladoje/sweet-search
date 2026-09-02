// r2 — measure the FIXED preamble each harness sends: base instructions + tool schemas.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
function walk(d, pred, out = [], depth = 0) {
  if (depth > 9) return out;
  let e; try { e = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = path.join(d, x.name);
    if (x.isDirectory()) walk(p, pred, out, depth + 1); else if (pred(p, x.name)) out.push(p); }
  return out;
}
const R = '/root/sweet-search-private/eval/task-completion-bench/results';
// ---- codex ----
const cRoot = path.join(R, 'fp-codex-tab-20260826', 'agent-state');
for (const arm of ['sweet', 'native']) {
  const cell = readdirSync(cRoot).find(d => d.endsWith(`-${arm}`));
  const f = walk(path.join(cRoot, cell), (p, n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))[0];
  const line1 = readFileSync(f, 'utf8').split('\n')[0];
  const o = JSON.parse(line1);
  const p = o.payload || o;
  const bi = p.payload?.base_instructions ?? p.base_instructions ?? JSON.stringify(p).match(/"base_instructions":"((?:[^"\\]|\\.)*)"/)?.[1];
  console.log(`## codex ${arm}`);
  console.log(`   session_meta line bytes = ${Buffer.byteLength(line1)}`);
  console.log(`   base_instructions bytes = ${bi ? Buffer.byteLength(bi) : 'n/a'}`);
  const keys = Object.keys(p.payload || p);
  console.log(`   session_meta keys: ${keys.join(', ')}`);
  if (bi) console.log(`   base_instructions head: ${JSON.stringify(bi.slice(0, 200))}`);
  // count records by payload.type across whole file
  const counts = {};
  for (const l of readFileSync(f, 'utf8').split('\n')) { if (!l) continue; let x; try { x = JSON.parse(l); } catch { continue; }
    const t = (x.payload?.type) || x.type; counts[t] = (counts[t] || 0) + 1; }
  console.log(`   record types: ${JSON.stringify(counts)}`);
  console.log(`   file: ${f}`);
}
