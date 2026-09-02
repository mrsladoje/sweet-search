// e3-editfail.mjs — print the BYTES of every sweet-arm edit failure classified 'other'
// (status=error with no recognised harness error string), per harness/form. The opencode
// NONE cell shows 7 of these against TAB's 0, and a count is not evidence without them.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const REPAIR = new Set(readFileSync('/root/fresh-run/repair-tasks.txt', 'utf8').trim().split('\n').filter(Boolean));
const WANT_H = process.argv[2] || 'opencode';
const WANT_F = process.argv[3] || null;

const RUNS = {
  opencode: { tab: ['fp-opencode-tab-20260826', 'rp-oc-tab-20260827'], none: ['fp-opencode-none-20260826', 'rp-oc-none-20260827'], pipe: ['fp-opencode-pipe-20260826', 'rp-oc-pipe-20260827'] },
  codex: { tab: ['fp-codex-tab-20260826'], none: ['fp-codex-none-20260826'], pipe: ['fp-codex-pipe-20260826'] },
  'claude-code': { tab: ['fp-claudecode-tab-20260826'], none: ['fp-claudecode-none-20260826'], pipe: ['fp-claudecode-pipe-20260826'] },
};
function walk(d, pred, out = [], depth = 0) {
  if (depth > 9) return out;
  let e; try { e = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = join(d, x.name); if (x.isDirectory()) walk(p, pred, out, depth + 1); else if (pred(p)) out.push(p); }
  return out;
}
function opencodeCalls(f) {
  const seen = new Map(), order = [];
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    const t = l.trim(); if (!t || t[0] !== '{') continue;
    let ev; try { ev = JSON.parse(t); } catch { continue; }
    const p = ev.part || ev; if (!(ev.type === 'tool_use' || (p.tool && (p.state || p.callID)))) continue;
    const st = p.state || {}; const id = String(p.callID || `l${order.length}`);
    if (!seen.has(id)) order.push(id);
    seen.set(id, { tool: p.tool, input: st.input, out: String(st.output ?? ''), status: st.status });
  }
  return order.map(i => seen.get(i));
}
const known = ['Failed to find context', 'Failed to find expected lines', 'Unexpected line found',
  'apply_patch verification failed', 'String to replace not found', 'No changes to make', 'InputValidationError'];

for (const [form, runs] of Object.entries(RUNS[WANT_H])) {
  if (WANT_F && form !== WANT_F) continue;
  let n = 0;
  for (const run of runs) {
    const base = join(R, run, 'agent-state');
    if (!existsSync(base)) continue;
    for (const cell of readdirSync(base)) {
      if (!cell.endsWith('-sweet')) continue;
      const task = cell.replace(/-sweet$/, '');
      const isRp = run.startsWith('rp-');
      if (isRp !== REPAIR.has(task)) continue;
      for (const f of walk(join(base, cell), p => p.endsWith('attempt-1.stdout.ndjson'))) {
        for (const c of opencodeCalls(f)) {
          if (!['apply_patch', 'edit', 'write', 'patch'].includes(c.tool)) continue;
          const failed = c.status === 'error' || known.some(k => (c.out || '').includes(k));
          if (!failed) continue;
          const cls = known.find(k => (c.out || '').includes(k)) || 'OTHER(status=error only)';
          n++;
          console.log(`\n### ${WANT_H}/${form} ${task} ${f.split('/').slice(-2)[0]}  tool=${c.tool} class=${cls}`);
          console.log('  OUTPUT BYTES:', JSON.stringify(String(c.out).slice(0, 700)));
          const pt = c.input?.patchText || c.input?.oldString || '';
          console.log('  PATCH HEAD  :', JSON.stringify(String(pt).slice(0, 400)));
        }
      }
    }
  }
  console.log(`\n== ${WANT_H}/${form}: ${n} failed edit calls ==`);
}
