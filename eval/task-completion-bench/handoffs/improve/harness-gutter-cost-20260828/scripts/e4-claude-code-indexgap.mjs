// e4-claude-code-indexgap.mjs — which file EXTENSIONS ever appear as an ss-* RESULT FILE
// (not merely as a string inside another file's body) across all 198 claude-code sweet rollouts?
// ss-search / ss-find headers:  "## #N <path>:<start>-<end> ..."
// ss-grep body lines:           "<path>:<line>: <text>"
// ss-read header:               "# ss-read <path> ("
// ss-semantic span header:      "### <path>:<start>-<end>"
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const forms = ['TAB', 'NONE', 'PIPE'];
const ext = f => { const b = f.split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1) : '(none):' + b; };
const searchExt = {}, grepExt = {}, readExt = {}, semExt = {};
const perTask = {};
for (const form of forms) {
  const runId = P.RUNS[form];
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${runId}/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
  for (const task of [...new Set(rows.map(r => r.taskId))].sort()) {
    perTask[task] ??= { searchFiles: new Set(), grepFiles: new Set(), readFiles: new Set() };
    const ts = P.transcriptsOf(runId, task, 'sweet');
    const byRep = new Map(); for (const t of ts) { const c = byRep.get(t.rep); if (!c || t.size > c.size) byRep.set(t.rep, t); }
    for (const [, t] of byRep) {
      let all = P.parseTranscript(t.file).calls.slice();
      for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
      for (const c of all) {
        if (c.name !== 'Bash') continue;
        const cmd = String(c.input.command || '');
        if (!P.ssToolsIn(cmd).length) continue;
        const res = String(c.result || '');
        for (const m of res.matchAll(/^## #\d+ ([^\s:]+):\d+/gm)) { searchExt[ext(m[1])] = (searchExt[ext(m[1])] || 0) + 1; perTask[task].searchFiles.add(m[1]); }
        for (const m of res.matchAll(/^([\w./@+-]+):(\d+): /gm)) { grepExt[ext(m[1])] = (grepExt[ext(m[1])] || 0) + 1; perTask[task].grepFiles.add(m[1]); }
        for (const m of res.matchAll(/^# ss-read (\S+) \(/gm)) { readExt[ext(m[1])] = (readExt[ext(m[1])] || 0) + 1; perTask[task].readFiles.add(m[1]); }
        for (const m of res.matchAll(/^### ([^\s:]+):\d+-\d+/gm)) { semExt[ext(m[1])] = (semExt[ext(m[1])] || 0) + 1; }
      }
    }
  }
}
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
console.log('SEARCH/FIND result-file extensions:', JSON.stringify(top(searchExt)));
console.log('GREP result-file extensions:', JSON.stringify(top(grepExt)));
console.log('SEMANTIC span-file extensions:', JSON.stringify(top(semExt)));
console.log('READ file extensions:', JSON.stringify(top(readExt)));
for (const t of ['bfgroup__b2-113', 'bfgroup__b2-259']) {
  const p = perTask[t];
  console.log(`\n${t}: distinct files by surface`);
  console.log('  search/find:', [...p.searchFiles].sort().join(' '));
  console.log('  grep       :', [...p.grepFiles].sort().slice(0, 60).join(' '));
  console.log('  read       :', [...p.readFiles].sort().join(' '));
}
