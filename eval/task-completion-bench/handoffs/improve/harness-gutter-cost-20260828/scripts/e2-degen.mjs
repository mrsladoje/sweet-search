// e2-degen.mjs — degeneration re-runs: how many, which arm, and what the DISCARDED
// first attempt cost (money spent that no published column carries).
import fs from 'node:fs';
import path from 'node:path';
const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = ['fp-codex-tab-20260826', 'fp-codex-none-20260826', 'fp-codex-pipe-20260826',
  'fp-opencode-tab-20260826', 'fp-opencode-none-20260826', 'fp-opencode-pipe-20260826',
  'rp-oc-tab-20260827', 'rp-oc-none-20260827', 'rp-oc-pipe-20260827',
  'fp-claudecode-tab-20260826', 'fp-claudecode-none-20260826', 'fp-claudecode-pipe-20260826',
  'rb-codex-20260825', 'rb-opencode-20260824', 'rb-claudecode-20260824',
  'sb-codex-20260811', 'sb-opencode-20260811', 'sb-claudecode-20260811'];
console.log(['run', 'arm', 'degenReran', 'shimReran', 'startRetried', 'rows'].join('\t'));
for (const run of RUNS) {
  let rows; try { rows = JSON.parse(fs.readFileSync(path.join(R, run, 'rows.json'), 'utf8')); } catch { continue; }
  for (const arm of ['sweet', 'native']) {
    const a = rows.filter(r => r.arm === arm); if (!a.length) continue;
    console.log([run, arm, a.filter(r => r.degenReran).length, a.filter(r => r.shimReran).length,
      a.filter(r => r.startRetried).length, a.length].join('\t'));
  }
}
// codex: does a re-run leave a second rollout jsonl in the cell?
console.log('\ncodex cells whose transcript count exceeds the reps recorded:');
for (const run of ['fp-codex-tab-20260826', 'fp-codex-none-20260826', 'fp-codex-pipe-20260826']) {
  const rows = JSON.parse(fs.readFileSync(path.join(R, run, 'rows.json'), 'utf8'));
  const cells = {};
  for (const r of rows) (cells[`${r.taskId}-${r.arm}`] = cells[`${r.taskId}-${r.arm}`] || []).push(r);
  for (const [cell, rs] of Object.entries(cells)) {
    const base = path.join(R, run, 'agent-state', cell, 'codex-home', 'sessions');
    const files = [];
    const walk = dd => { let es; try { es = fs.readdirSync(dd, { withFileTypes: true }); } catch { return; }
      for (const e of es) { const p = path.join(dd, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) files.push(p); } };
    walk(base);
    if (files.length > rs.length) {
      const kept = new Set(rs.map(r => r.rolloutFile));
      const extra = files.filter(f => !kept.has(f));
      let usd = 0;
      for (const f of extra) {
        let prevIn = 0;
        for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
          if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
          const p = o.payload || {};
          if (p.type !== 'token_count' || !p.info?.last_token_usage) continue;
          const u = p.info.last_token_usage;
          const IN = u.input_tokens || 0, cached = u.cached_input_tokens || 0;
          usd += ((IN - cached) * 0.10 + cached * 0.01 + ((u.output_tokens || 0) + (u.reasoning_output_tokens || 0)) * 0.60) / 1e6;
          prevIn = IN;
        }
      }
      console.log(`${run}\t${cell}\treps=${rs.length}\ttranscripts=${files.length}\tdiscarded $${usd.toFixed(6)}\tdegenReran=${rs.filter(r => r.degenReran).length}`);
    }
  }
}
