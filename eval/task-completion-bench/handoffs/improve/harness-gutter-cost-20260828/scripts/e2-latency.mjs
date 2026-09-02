// e2-latency.mjs — recorded per-call wall time by tool family (codex envelope; opencode state.time).
import fs from 'node:fs';
import { load, cellRows, mean } from './e2-cells.mjs';
const d = load(); const R = d.rollouts;
const SS = ['ss-search', 'ss-semantic', 'ss-trace', 'ss-grep', 'ss-find', 'ss-read'];
function fam(cmd, name) {
  const c = String(cmd || '');
  for (const t of SS) if (new RegExp(`(^|[;&|(\\n\`$]|\\s)${t}\\b`).test(c)) return t;
  if (/(^|[;&|(\n`$]|\s)run_tests\b/.test(c)) return 'run_tests';
  if (/apply_patch/.test(c)) return 'edit';
  if (name === 'write_stdin') return 'poll';
  if (/(^|[;&|(\n`$]|\s)(sed|cat|nl|head|tail)\b/.test(c)) return 'nativeRead';
  if (/(^|[;&|(\n`$]|\s)(grep|rg|ag|find|fd|ls)\b/.test(c)) return 'nativeGrep';
  return 'other';
}
for (const cell of [{ epoch: 'C', harness: 'codex', form: 'tab' }, { epoch: 'C', harness: 'codex', form: 'native' }]) {
  const rs = cellRows(R, cell);
  const agg = {};
  for (const rec of rs) {
    let t; try { t = fs.readFileSync(rec.transcript, 'utf8'); } catch { continue; }
    const pend = new Map();
    for (const l of t.split('\n')) {
      if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
      const p = o.payload || {}; const ty = p.type;
      if (ty === 'function_call') { let cmd = ''; try { cmd = JSON.parse(p.arguments || '{}').cmd || ''; } catch {} pend.set(p.call_id, { cmd, name: p.name }); }
      else if (ty === 'function_call_output') {
        const c = pend.get(p.call_id); if (!c) continue;
        const out = String(p.output || '');
        const mw = out.match(/Wall time:\s*([\d.]+) seconds/); if (!mw) continue;
        const f = fam(c.cmd, c.name);
        const a = agg[f] = agg[f] || { n: 0, s: 0, mx: 0 };
        a.n++; a.s += Number(mw[1]); a.mx = Math.max(a.mx, Number(mw[1]));
      }
    }
  }
  console.log(`--- codex ${cell.form} (n=${rs.length} rollouts) recorded wall time per call ---`);
  for (const [f, a] of Object.entries(agg).sort((x, y) => y[1].s - x[1].s))
    console.log(`${f}\tcalls ${a.n}\tmean ${(a.s / a.n).toFixed(3)}s\tmax ${a.mx.toFixed(1)}s\ttotal ${(a.s / rs.length).toFixed(1)}s/rollout`);
}
const oc = cellRows(R, { epoch: 'C', harness: 'opencode', form: 'tab' });
console.log(`\nopencode wall time recorded on ${oc.filter(r => r.wallN > 0).length}/${oc.length} rollouts (state.time present)`);
const cc = cellRows(R, { epoch: 'C', harness: 'claude-code', form: 'tab' });
console.log(`claude-code wall time recorded on ${cc.filter(r => r.wallN > 0).length}/${cc.length} rollouts`);
