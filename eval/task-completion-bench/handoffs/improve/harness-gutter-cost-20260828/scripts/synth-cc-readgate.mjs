// synth-cc-readgate.mjs — does claude-code's Edit precondition ("File has not been read yet.
// Read it first before writing to it.") force a native Read of every file the sweet arm edits?
// Read-only over fp-claudecode-{tab,none,pipe}-20260826. Largest transcript per rep (trap 5).
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';

const BASE = P.ROOT + '/results';
const cells = [
  { form: 'native', runId: P.RUNS.TAB, arm: 'native' },
  { form: 'TAB', runId: P.RUNS.TAB, arm: 'sweet' },
  { form: 'NONE', runId: P.RUNS.NONE, arm: 'sweet' },
  { form: 'PIPE', runId: P.RUNS.PIPE, arm: 'sweet' },
];
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const rowsOf = id => JSON.parse(fs.readFileSync(`${BASE}/${id}/rows.json`, 'utf8'));
const ssReadPaths = (cmd) => {
  const out = [];
  const re = /ss-read\s+(?:--force\s+)?(?:--\S+\s+)*([^\s;&|'"`]+)/g;
  let m; while ((m = re.exec(String(cmd || '')))) out.push(m[1]);
  return out;
};
const norm = (p, cwd) => {
  if (!p) return p;
  if (p.startsWith('/')) return p;
  return cwd ? `${cwd.replace(/\/$/, '')}/${p}` : p;
};

const out = {};
for (const c of cells) {
  const rows = rowsOf(c.runId).filter(r => r.arm === c.arm);
  const tasks = [...new Set(rows.map(r => r.taskId))].sort();
  const S = out[c.form] = {
    rollouts: 0, edits: 0, editCalls: { Edit: 0, Write: 0, MultiEdit: 0, NotebookEdit: 0 },
    editsWithPriorRead: 0, editsWithoutPriorRead: 0,
    editsWithoutPriorReadButPriorSsRead: 0,
    gateErrors: 0, staleErrors: 0, gateErrorFiles: 0,
    reads: 0, readsOfLaterEditedFiles: 0, readsAfterSsReadSameFile: 0,
    distinctEditedFiles: 0, distinctReadFiles: 0,
    firstEditPrecededByReadSameTurnWindow: 0,
    examples: [], gateExamples: [],
  };
  for (const task of tasks) {
    const ts = P.transcriptsOf(c.runId, task, c.arm);
    const byRep = new Map();
    for (const t of ts) { const x = byRep.get(t.rep); if (!x || t.size > x.size) byRep.set(t.rep, t); }
    for (const [rep, t] of byRep) {
      S.rollouts++;
      const { calls } = P.parseTranscript(t.file);
      // cwd guess from the first absolute path we see
      let cwd = null;
      for (const k of calls) { const fp = k.input?.file_path; if (fp && /^\/root\/\.ss-eval\/runs\/r\d+-\d+/.test(fp)) { cwd = fp.match(/^\/root\/\.ss-eval\/runs\/r\d+-\d+/)[0]; break; } }
      const readSet = new Set(); const ssReadSet = new Set();
      const editedFiles = new Set(); const readFiles = new Set();
      const readEvents = [];
      for (const k of calls) {
        const res = String(k.result || '');
        if (k.name === 'Read') {
          const fp = norm(k.input?.file_path, cwd);
          S.reads++; readSet.add(fp); readFiles.add(fp);
          readEvents.push({ fp, afterSs: ssReadSet.has(fp) });
          if (ssReadSet.has(fp)) S.readsAfterSsReadSameFile++;
          continue;
        }
        if (k.name === 'Bash') {
          for (const p of ssReadPaths(k.input?.command)) ssReadSet.add(norm(p, cwd));
          if (/has not been read yet/i.test(res)) { S.gateErrors++; }
          continue;
        }
        if (EDIT_TOOLS.has(k.name)) {
          const fp = norm(k.input?.file_path || k.input?.notebook_path, cwd);
          S.edits++; S.editCalls[k.name] = (S.editCalls[k.name] || 0) + 1; editedFiles.add(fp);
          if (readSet.has(fp)) S.editsWithPriorRead++;
          else {
            S.editsWithoutPriorRead++;
            if (ssReadSet.has(fp)) S.editsWithoutPriorReadButPriorSsRead++;
            if (S.examples.length < 8) S.examples.push({ task, rep, tool: k.name, file: fp, resultHead: res.slice(0, 160) });
          }
          if (/has not been read yet/i.test(res)) {
            S.gateErrors++;
            if (S.gateExamples.length < 8) S.gateExamples.push({ task, rep, tool: k.name, file: fp, priorSsRead: ssReadSet.has(fp), resultHead: res.slice(0, 200) });
          }
          if (/modified since read/i.test(res)) S.staleErrors++;
        }
      }
      for (const e of readEvents) if (editedFiles.has(e.fp)) S.readsOfLaterEditedFiles++;
      S.distinctEditedFiles += editedFiles.size; S.distinctReadFiles += readFiles.size;
    }
  }
  const r = S.rollouts || 1;
  S.perRollout = {
    reads: +(S.reads / r).toFixed(2), edits: +(S.edits / r).toFixed(2),
    distinctEditedFiles: +(S.distinctEditedFiles / r).toFixed(2),
    readsOfLaterEditedFiles: +(S.readsOfLaterEditedFiles / r).toFixed(2),
    readsAfterSsReadSameFile: +(S.readsAfterSsReadSameFile / r).toFixed(2),
  };
  S.shareEditsWithPriorRead = +(S.editsWithPriorRead / Math.max(1, S.edits)).toFixed(3);
  S.shareReadsServingAnEdit = +(S.readsOfLaterEditedFiles / Math.max(1, S.reads)).toFixed(3);
}
console.log(JSON.stringify(out, null, 1));
