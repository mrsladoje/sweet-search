// e4-claude-code-localisation.mjs — for every rollout of the named tasks (all four arms),
// decide whether the GOLD file(s) were (a) surfaced by any tool output, (b) read, (c) edited.
// Separates "not-localised" from "wrong-fix" and attributes retrieval credit.
import fs from 'node:fs';
import path from 'node:path';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const T = JSON.parse(fs.readFileSync('/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json', 'utf8'));
const specs = Array.isArray(T) ? T : (T.tasks || Object.values(T));
const CELLS = [['native', P.RUNS.TAB, 'native'], ['TAB', P.RUNS.TAB, 'sweet'], ['NONE', P.RUNS.NONE, 'sweet'], ['PIPE', P.RUNS.PIPE, 'sweet']];
const repDir = (runId, arm, rep) => rep === 0 ? `${BASE}/${runId}/${arm}` : `${BASE}/${runId}/${arm}/rep-${rep}`;
const tasks = process.argv.slice(2);
const out = [];
for (const task of tasks) {
  const spec = specs.find(s => s.instance_id === task);
  const goldFiles = [...String(spec.patch).matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]).filter(f => !/^CHANGES\/|\.d\.ts(\.map)?$/.test(f));
  for (const [form, runId, arm] of CELLS) {
    const rows = JSON.parse(fs.readFileSync(`${BASE}/${runId}/rows.json`, 'utf8'));
    for (const rep of [0, 1, 2]) {
      const row = rows.find(r => r.taskId === task && r.arm === arm && r.rep === rep);
      const ts = P.transcriptsOf(runId, task, arm).filter(t => t.rep === rep);
      let surfacedBy = new Set(), readBy = new Set(), edited = new Set(), firstSurfaceCall = null;
      let calls = 0, ssCalls = 0, editFails = 0;
      for (const t of ts) {
        let all = P.parseTranscript(t.file).calls.slice();
        for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
        calls += all.length;
        all.forEach((c, i) => {
          const isBash = c.name === 'Bash';
          const cmd = isBash ? String(c.input.command || '') : '';
          const res = String(c.result || '');
          const hits = isBash ? P.ssToolsIn(cmd) : [];
          if (hits.length) ssCalls++;
          for (const g of goldFiles) {
            if (res.includes(g)) { const src = hits.length ? hits.join('+') : (isBash ? 'bash' : c.name); surfacedBy.add(src); if (firstSurfaceCall === null) firstSurfaceCall = `${i}:${src}`; }
            if ((isBash && cmd.includes(g)) || (c.name === 'Read' && String(c.input.file_path || '').includes(g))) {
              readBy.add(hits.length ? hits.join('+') : (isBash ? 'bash' : c.name));
            }
            if ((c.name === 'Edit' || c.name === 'MultiEdit') && String(c.input.file_path || '').includes(g)) edited.add(g);
          }
          if ((c.name === 'Edit' || c.name === 'MultiEdit') && /String to replace not found|Found \d+ matches of the string|No changes to make|InputValidationError/.test(res)) editFails++;
        });
      }
      let patchFiles = [];
      try {
        const p = JSON.parse(fs.readFileSync(path.join(repDir(runId, arm, rep), 'patches.json'), 'utf8'));
        const hit = Object.values(p).find(x => x.instance_id === task);
        patchFiles = hit ? [...String(hit.patch || '').matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]) : [];
      } catch {}
      out.push({
        task, form, rep, resolved: !!row?.resolved, f2p: row?.f2pFrac, calls, ssCalls, editFails,
        goldFiles, surfacedBy: [...surfacedBy], firstSurfaceCall, readBy: [...readBy], goldEdited: [...edited],
        patchFiles, emptyPatch: patchFiles.length === 0, exitReason: row?.exitReason,
        stepsToFirstEdit: row?.stepsToFirstEdit, sidechain: row?.sidechainCount,
      });
    }
  }
}
console.log(JSON.stringify(out, null, 1));
