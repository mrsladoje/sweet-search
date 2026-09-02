// e4-claude-code-silentblind.mjs — how often did an ss-* call answer "(no matches)" for a path
// that demonstrably EXISTS (because some ss-read in the same rollout rendered it, or a bash
// command later read it successfully)?  That is the index-blindness signature: the tool reports
// absence of matches where the truth is absence of INDEX.
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const forms = ['TAB', 'NONE', 'PIPE'];
const res = { total: 0, scopedEmpty: 0, scopedEmptyOnProvenFile: 0, ex: [], byTask: {} };
for (const form of forms) {
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${P.RUNS[form]}/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
  for (const task of [...new Set(rows.map(r => r.taskId))].sort()) {
    const ts = P.transcriptsOf(P.RUNS[form], task, 'sweet');
    const byRep = new Map(); for (const t of ts) { const c = byRep.get(t.rep); if (!c || t.size > c.size) byRep.set(t.rep, t); }
    for (const [rep, t] of byRep) {
      const rid = `${form}/${task}/r${rep}`;
      let all = P.parseTranscript(t.file).calls.slice();
      for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
      // every path proven to exist in this rollout: ss-read rendered it, or Read returned content
      const proven = new Set();
      for (const c of all) {
        const r = String(c.result || '');
        for (const m of r.matchAll(/^# ss-read (\S+) \(/gm)) proven.add(m[1]);
        if (c.name === 'Read' && !/tool_use_error|does not exist/.test(r)) { const fp = String(c.input.file_path || ''); if (fp) proven.add(fp.split('/').slice(-1)[0]), proven.add(fp); }
      }
      for (const c of all) {
        if (c.name !== 'Bash') continue;
        const cmd = String(c.input.command || '');
        if (!P.ssToolsIn(cmd).length) continue;
        const r = String(c.result || '');
        if (!/^\(no matches\)$/m.test(r)) continue;
        res.total++;
        const scopes = [...cmd.matchAll(/--in\s+(\S+)/g)].map(m => m[1].replace(/^["']|["']$/g, ''));
        if (!scopes.length) continue;
        res.scopedEmpty++;
        const hit = scopes.find(s => [...proven].some(p => p === s || p.endsWith('/' + s) || s.endsWith('/' + p) || s.split('/').pop() === p.split('/').pop()));
        if (hit) {
          res.scopedEmptyOnProvenFile++;
          res.byTask[task] = (res.byTask[task] || 0) + 1;
          if (res.ex.length < 10) res.ex.push({ rid, scope: hit, cmd: cmd.replace(/\s+/g, ' ').slice(0, 170) });
        }
      }
    }
  }
}
console.log(JSON.stringify(res, null, 1));
