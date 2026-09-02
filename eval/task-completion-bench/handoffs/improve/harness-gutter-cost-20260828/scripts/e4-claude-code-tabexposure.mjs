// e4-claude-code-tabexposure.mjs — how much of what ss-read delivered is TAB-indented code?
// A tab-indented file under the N<TAB> gutter is the condition in which the model cannot tell
// the delimiter from the file's own first indent level.
// Also: per-rollout counts of native Read re-reads of an ss-read span, and Read-immediately-before-Edit.
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const CELLS = [['native', P.RUNS.TAB, 'native'], ['TAB', P.RUNS.TAB, 'sweet'], ['NONE', P.RUNS.NONE, 'sweet'], ['PIPE', P.RUNS.PIPE, 'sweet']];
const out = { perForm: {}, perTaskTabShare: {} };
for (const [form, runId, arm] of CELLS) {
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${runId}/rows.json`, 'utf8')).filter(r => r.arm === arm);
  const F = out.perForm[form] = {
    rollouts: 0, ssReadLines: 0, ssReadTabIndentLines: 0,
    rolloutsWithNativeRereadOfSSSpan: 0, nativeRereads: 0,
    editsWithNativeReadImmediatelyBefore: 0, edits: 0,
    nativeReadTabLines: 0, nativeReadLines: 0,
  };
  for (const task of [...new Set(rows.map(r => r.taskId))].sort()) {
    out.perTaskTabShare[task] ??= { lines: 0, tab: 0 };
    for (const rep of [0, 1, 2]) {
      const ts = P.transcriptsOf(runId, task, arm).filter(t => t.rep === rep);
      for (const t of ts) {
        F.rollouts++;
        let all = P.parseTranscript(t.file).calls.slice();
        for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
        const ssSpans = new Map(); let reread = 0;
        all.forEach((c, i) => {
          const isBash = c.name === 'Bash';
          const cmd = isBash ? String(c.input.command || '') : '';
          const res = String(c.result || '');
          if (isBash && /ss-read/.test(cmd)) {
            // body lines of an ss-read block
            for (const m of res.matchAll(/^\s*\d+([\t|:])(.*)$/gm)) {
              F.ssReadLines++; out.perTaskTabShare[task].lines++;
              // for TAB the delimiter IS a tab: content begins with a tab iff the 2nd char after the number is a tab
              const body = m[2];
              if (form === 'TAB' ? /^\t/.test(body) : /^\t/.test(body.replace(/^ /, ''))) { F.ssReadTabIndentLines++; out.perTaskTabShare[task].tab++; }
            }
            for (const m of res.matchAll(/^# ss-read (\S+) \(lines (\d+)-(\d+)/gm)) ssSpans.set(m[1], [Number(m[2]), Number(m[3])]);
            for (const m of res.matchAll(/^# ss-read (\S+) \((\d+) lines\)/gm)) ssSpans.set(m[1], [1, Number(m[2])]);
          }
          if (c.name === 'Read') {
            for (const m of res.matchAll(/^\s*\d+\t(.*)$/gm)) { F.nativeReadLines++; if (/^\t/.test(m[1])) F.nativeReadTabLines++; }
            const fp = String(c.input.file_path || '');
            if ([...ssSpans.keys()].some(f => fp.endsWith('/' + f) || fp.endsWith(f))) { reread++; F.nativeRereads++; }
          }
          if (c.name === 'Edit' || c.name === 'MultiEdit') {
            F.edits++;
            const prev = all[i - 1];
            if (prev && prev.name === 'Read' && String(prev.input.file_path || '') === String(c.input.file_path || '')) F.editsWithNativeReadImmediatelyBefore++;
          }
        });
        if (reread > 0) F.rolloutsWithNativeRereadOfSSSpan++;
      }
    }
  }
}
console.log(JSON.stringify(out, null, 1));
