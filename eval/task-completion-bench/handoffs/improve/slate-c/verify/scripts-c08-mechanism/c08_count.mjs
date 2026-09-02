// c08-mechanism re-derivation: per subagent transcript, count deduped tool_use blocks by name,
// Bash commands that invoke ss-* (bare vs absolute path), ss-* non-zero exits, --help, hunts.
// Also list parent Agent call inputs (subagent_type, isolation, model) per arm.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '/root/sweet-search-private/eval/task-completion-bench/results';
const run = process.argv[2] || 'fp-claudecode-tab-20260826';
const walk = (d, out = []) => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, out) : out.push(p); } return out; };
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const SS_RE = /(^|[\s;&|(`'"\/])ss-(search|grep|find|read|semantic|trace|batch)(\s|$)/;
const ABS_RE = /\/bin\/ss-(search|grep|find|read|semantic|trace|batch)/;
const state = path.join(ROOT, run, 'agent-state');
const launches = { native: {}, sweet: {} }; const iso = { native: {}, sweet: {} };
const perSub = [];
for (const cell of fs.readdirSync(state).sort()) {
  const mm = cell.match(/^(.*)-(native|sweet)$/); if (!mm) continue; const [, task, arm] = mm;
  const files = walk(path.join(state, cell)).filter(f => f.endsWith('.jsonl') && f.includes('/claude-home/projects/'));
  for (const f of files) {
    const recs = jl(f);
    const isSub = f.includes('/subagents/');
    const seen = new Set(); const byName = {}; let bashSS = 0, bashSSabs = 0, bashSSbare = 0, ssFail = 0, help = 0, hunt = 0, bashTotal = 0;
    const results = new Map();
    for (const r of recs) { const m = r.message; if (!m || !Array.isArray(m.content)) continue; for (const b of m.content) if (b.type === 'tool_result' && !results.has(b.tool_use_id)) { const c = b.content; results.set(b.tool_use_id, typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : ''); } }
    for (const r of recs) {
      const m = r.message; if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b.type !== 'tool_use' || !b.id || seen.has(b.id)) continue; seen.add(b.id);
        byName[b.name] = (byName[b.name] || 0) + 1;
        if (!isSub && b.name === 'Agent') { const t = b.input?.subagent_type || '?'; launches[arm][t] = (launches[arm][t] || 0) + 1; const k = String(b.input?.isolation ?? 'unset'); iso[arm][k] = (iso[arm][k] || 0) + 1; }
        if (b.name === 'Bash') {
          bashTotal++; const cmd = String(b.input?.command || '');
          const abs = ABS_RE.test(cmd); const bare = SS_RE.test(cmd) && !abs;
          if (abs || bare) { bashSS++; if (abs) bashSSabs++; else bashSSbare++; const res = String(results.get(b.id) || ''); if (/^Exit code [1-9]/m.test(res)) ssFail++; }
          if (/ss-[a-z]+\s+(--help|-h)(\s|$)/.test(cmd)) help++;
          if (/(command -v ss-|which ss-|type ss-|-name ['"]?ss-)/.test(cmd)) hunt++;
        }
      }
    }
    if (isSub) {
      const id = path.basename(f, '.jsonl');
      let type = '?';
      // find the parent's Agent call whose toolUseResult.agentId matches
      const parent = f.replace(/\/subagents\/agent-[^/]+\.jsonl$/, '.jsonl');
      try { for (const r of jl(parent)) { if (r.toolUseResult && r.toolUseResult.agentId && ('agent-' + r.toolUseResult.agentId) === id) { type = r.toolUseResult.agentType || type; } } } catch {}
      if (type === '?') { try { for (const r of jl(parent)) { const m = r.message; if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue; } } catch {} }
      perSub.push({ arm, task, id, type, bashTotal, bashSS, bashSSabs, bashSSbare, ssFail, help, hunt, Read: byName.Read || 0, Grep: byName.Grep || 0, Glob: byName.Glob || 0, Agent: byName.Agent || 0 });
    }
  }
}
console.log('run', run);
console.log('Agent launches by arm/subagent_type (deduped tool_use blocks in main transcripts):', JSON.stringify(launches));
console.log('Agent isolation param by arm:', JSON.stringify(iso));
console.log('\nSubagent transcripts:');
for (const s of perSub.sort((a, b) => a.arm.localeCompare(b.arm) || a.task.localeCompare(b.task))) console.log(JSON.stringify(s));
const sw = perSub.filter(s => s.arm === 'sweet');
console.log('\nsweet subagents n=', sw.length, 'bashSS range', Math.min(...sw.map(s => s.bashSS)), '-', Math.max(...sw.map(s => s.bashSS)), 'bashTotal range', Math.min(...sw.map(s => s.bashTotal)), '-', Math.max(...sw.map(s => s.bashTotal)));
const ex = sw.filter(s => s.type === 'Explore'); const gp = sw.filter(s => s.type !== 'Explore');
const sum = (a, k) => a.reduce((x, y) => x + y[k], 0);
console.log('sweet Explore: n', ex.length, 'ss calls', sum(ex, 'bashSS'), 'abs', sum(ex, 'bashSSabs'), 'bare', sum(ex, 'bashSSbare'), 'fails', sum(ex, 'ssFail'), 'help', sum(ex, 'help'), 'hunt', sum(ex, 'hunt'), 'Read', sum(ex, 'Read'), 'Grep', sum(ex, 'Grep'), 'Glob', sum(ex, 'Glob'));
console.log('sweet non-Explore: n', gp.length, 'ss calls', sum(gp, 'bashSS'), 'abs', sum(gp, 'bashSSabs'), 'bare', sum(gp, 'bashSSbare'), 'fails', sum(gp, 'ssFail'), 'help', sum(gp, 'help'), 'hunt', sum(gp, 'hunt'), 'Read', sum(gp, 'Read'));
const nat = perSub.filter(s => s.arm === 'native');
console.log('native subagents n=', nat.length, 'Bash total', sum(nat, 'bashTotal'), 'Read', sum(nat, 'Read'), 'Grep', sum(nat, 'Grep'), 'Glob', sum(nat, 'Glob'), 'types', JSON.stringify(nat.reduce((a, s) => (a[s.type] = (a[s.type] || 0) + 1, a), {})));
