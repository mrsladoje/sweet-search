// e4-claude-code-stopcensus.mjs — across all 264 claude-code rollouts (native + 3 sweet forms):
// empty patches, zero-edit rollouts, run_tests discipline, exit reasons, condenser state_summary stops.
import fs from 'node:fs';
import path from 'node:path';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const CELLS = [['native', P.RUNS.TAB, 'native'], ['TAB', P.RUNS.TAB, 'sweet'], ['NONE', P.RUNS.NONE, 'sweet'], ['PIPE', P.RUNS.PIPE, 'sweet']];
const repDir = (runId, arm, rep) => rep === 0 ? `${BASE}/${runId}/${arm}` : `${BASE}/${runId}/${arm}/rep-${rep}`;
const out = { perForm: {}, emptyPatchRollouts: [], stateSummaryStops: [], noVerdict: [] };
for (const [form, runId, arm] of CELLS) {
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${runId}/rows.json`, 'utf8')).filter(r => r.arm === arm);
  const F = out.perForm[form] = { n: 0, emptyPatch: 0, zeroEdit: 0, rtEndedUnverified: 0, exitReasons: {}, stateSummaryStop: 0, solved: 0 };
  const patchCache = {};
  for (const r of rows) {
    F.n++; if (r.resolved) F.solved++;
    F.exitReasons[r.exitReason] = (F.exitReasons[r.exitReason] || 0) + 1;
    if (r.rtEndedUnverified) { F.rtEndedUnverified++; out.noVerdict.push(`${form}/${r.taskId}/r${r.rep}`); }
    const key = `${runId}|${arm}|${r.rep}`;
    if (!patchCache[key]) { try { patchCache[key] = JSON.parse(fs.readFileSync(path.join(repDir(runId, arm, r.rep), 'patches.json'), 'utf8')); } catch { patchCache[key] = {}; } }
    const hit = Object.values(patchCache[key]).find(x => x.instance_id === r.taskId);
    const patch = hit ? String(hit.patch || '') : '';
    if (!patch.trim()) { F.emptyPatch++; out.emptyPatchRollouts.push({ rid: `${form}/${r.taskId}/r${r.rep}`, calls: r.calls, edits: r.toolCounts?.edit, exitReason: r.exitReason, resolved: !!r.resolved }); }
    if (!(r.toolCounts?.edit > 0)) F.zeroEdit++;
    // condenser state_summary as the LAST assistant text
    const ts = P.transcriptsOf(runId, r.taskId, arm).filter(t => t.rep === r.rep);
    for (const t of ts) {
      const ev = P.parseTranscript(t.file).events;
      const texts = ev.filter(e => e.k === 'text' && e.role === 'assistant' && e.text.trim());
      const last = texts[texts.length - 1];
      if (last && /<state_summary>/.test(last.text)) { F.stateSummaryStop++; out.stateSummaryStops.push({ rid: `${form}/${r.taskId}/r${r.rep}`, calls: r.calls, resolved: !!r.resolved, tail: last.text.slice(0, 200) }); }
    }
  }
}
console.log(JSON.stringify(out, null, 1));
