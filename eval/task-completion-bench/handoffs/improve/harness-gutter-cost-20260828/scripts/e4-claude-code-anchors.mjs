// e4-claude-code-anchors.mjs — indentation forensics on every FAILED claude-code Edit
// across the 198 sweet rollouts + the 66 native rollouts.
// For each "String to replace not found" failure we take the first non-empty line of
// old_string, strip its leading whitespace, and look for a line with the same trimmed
// content in EVERY earlier tool output of the same transcript. The delta between the
// attempted indent and the shown indent is the +1-carry signature from
// GUTTER-MECHANISM-INVESTIGATION §4.1.
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const rowsOf = id => JSON.parse(fs.readFileSync(`${BASE}/${id}/rows.json`, 'utf8'));
const CELLS = [
  ['TAB', P.RUNS.TAB, 'sweet'], ['NONE', P.RUNS.NONE, 'sweet'],
  ['PIPE', P.RUNS.PIPE, 'sweet'], ['native', P.RUNS.TAB, 'native'],
];
const stripGutter = (line) => line
  .replace(/^\s*(\d+)\t/, '')          // N<TAB>
  .replace(/^\s*(\d+)\|\s?/, '')        // N|  (pipe)
  .replace(/^\s*(\d+):\s?/, '')         // N:  (opencode form, harmless here)
  .replace(/^\s*(\d+)\s\s+/, '');       // padded cat -n
const out = { perForm: {}, cases: [] };
for (const [form, runId, arm] of CELLS) {
  const rows = rowsOf(runId).filter(r => r.arm === arm);
  const F = out.perForm[form] = { edits: 0, notFound: 0, located: 0, deltas: {}, unlocated: 0, rolloutsWithNotFound: new Set() };
  const tasks = [...new Set(rows.map(r => r.taskId))].sort();
  for (const task of tasks) {
    const ts = P.transcriptsOf(runId, task, arm);
    const byRep = new Map(); for (const t of ts) { const c = byRep.get(t.rep); if (!c || t.size > c.size) byRep.set(t.rep, t); }
    for (const [rep, t] of [...byRep.entries()].sort((a, b) => a[0] - b[0])) {
      const rid = `${form}/${task}/r${rep}`;
      let all = P.parseTranscript(t.file).calls.slice();
      for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
      // index of shown lines: trimmed content -> [indent widths], newest last
      const shown = new Map();
      all.forEach((c, i) => {
        const res = String(c.result || '');
        if (c.name === 'Edit' || c.name === 'MultiEdit') {
          F.edits++;
          if (/String to replace not found/.test(res)) {
            F.notFound++; F.rolloutsWithNotFound.add(rid);
            const first = String(c.input.old_string || '').split('\n').find(l => l.trim().length > 3);
            if (first) {
              const key = first.trim();
              const attemptedIndent = first.length - first.trimStart().length;
              const cand = shown.get(key);
              if (cand && cand.length) {
                F.located++;
                const shownIndent = cand[cand.length - 1];
                const d = attemptedIndent - shownIndent;
                F.deltas[d] = (F.deltas[d] || 0) + 1;
                out.cases.push({ rid, delta: d, attemptedIndent, shownIndent, file: String(c.input.file_path || '').split('/').slice(-1)[0], line: key.slice(0, 90) });
              } else F.unlocated++;
            } else F.unlocated++;
          }
        }
        // record every line this output showed (after removing any gutter)
        if (res && res.length < 400000) {
          for (const raw of res.split('\n')) {
            const l = stripGutter(raw);
            const k = l.trim();
            if (k.length > 3) { const arrr = shown.get(k) || []; arrr.push(l.length - l.trimStart().length); if (arrr.length > 4) arrr.shift(); shown.set(k, arrr); }
          }
        }
      });
    }
  }
  F.rolloutsWithNotFound = F.rolloutsWithNotFound.size;
}
console.log(JSON.stringify(out, null, 1));
