// e4-claude-code-toolhealth.mjs — tool-health scan over EVERY sweet rollout on claude-code
// (fp-claudecode-{tab,none,pipe}-20260826, 66 rollouts each = 198). Read-only; JSON on stdout.
//
// Exit codes are read from claude-code's own "Exit code N" prefix on a Bash tool result [C];
// the ss-* markers are read from eval/agent-read-workflows/bin/_ss-helpers.mjs [C].
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';

const BASE = P.ROOT + '/results';
const forms = ['TAB', 'NONE', 'PIPE'];
const rowsOf = id => JSON.parse(fs.readFileSync(`${BASE}/${id}/rows.json`, 'utf8'));

const MARK = {
  noMatches:     /^\(no matches\)$/m,
  readErr:       /\[ss-read\] error: [^\n]*/,
  readInvalid:   /\[ss-read\] (invalid (start|end) line|"[^"]*" looks like a flag)[^\n]*/,
  readCountNote: /\[ss-read\] note: interpreted [^\n]*/,
  usageErr:      /(^Usage: ss-[a-z]+|\[ss\] unrecognised option|\[ss\] \d+ argument\(s\) not consumed)/m,
  crash:         /\[ss-\*\] crash: [^\n]*/,
  serverErr:     /\[ss-search\] (server error|warm server is not ready)[^\n]*/,
  repoIso:       /\[ss-search\] repo isolation violation[^\n]*/,
  semanticErr:   /\[ss-semantic\] error: [^\n]*/,
  noIndex:       /\[ss-\*\] no Sweet Search index[^\n]*/,
  traceNoTarget: /<<SS_TRACE_META>>[^\n]*"sufficient":false/,
  modelNoise:    /^(BinaryHNSW: |LateInteraction: |\[LateInteraction\]|SQLite |\[warm\])/m,
  timedOut:      /(Command timed out after|Command was killed)/,
  exitCode:      /^Exit code (\d+)/,
  traceLatency:  /"latencyMs":(\d+)/,
  ssSearchHdr:   /^# ss-search: routed=(\S+) conf=(\S+) budget=(\d+) used=(\d+) results=(\d+)/m,
  ssGrepHdr:     /^# ss-grep: (\d+) total match/m,
};
const NATIVE_CMD = /(^|[\s;&|(])(grep|rg|egrep|fgrep|find|cat|sed|head|tail|awk|nl)(\s|$)/;
const NATIVE_TOOL = new Set(['Read', 'Grep', 'Glob']);

const D = {};
function defect(key, rid, sample) {
  D[key] ??= { count: 0, rollouts: new Set(), examples: [] };
  D[key].count++; D[key].rollouts.add(rid);
  if (D[key].examples.length < 6) D[key].examples.push({ rid, ...sample });
}
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

const out = { perForm: {}, rollouts: [], exitCodeHist: {}, defects: {} };
for (const form of forms) {
  const runId = P.RUNS[form];
  const rows = rowsOf(runId).filter(r => r.arm === 'sweet');
  const solvedBy = new Map(rows.map(r => [`${r.taskId}/r${r.rep}`, !!r.resolved]));
  const F = out.perForm[form] = {
    rollouts: 0, allCalls: 0, bashCalls: 0, ssCalls: 0, ssBashCalls: 0,
    byTool: {}, byToolEmpty: {}, errByClass: {}, exitCodes: {},
    nativeRetrievalCalls: 0, nativeAfterSS_any: 0, nativeAfterSS_immediate: 0,
    traceLatencyMs: [], noiseCalls: 0, timeouts: 0,
    ssSearchUsedTokens: [], ssGrepZero: 0,
  };
  const tasks = [...new Set(rows.map(r => r.taskId))].sort();
  for (const task of tasks) {
    const ts = P.transcriptsOf(runId, task, 'sweet');
    const byRep = new Map();
    for (const t of ts) { const c = byRep.get(t.rep); if (!c || t.size > c.size) byRep.set(t.rep, t); }
    for (const [rep, t] of [...byRep.entries()].sort((a, b) => a[0] - b[0])) {
      const rid = `${form}/${task}/r${rep}`;
      const solved = solvedBy.get(`${task}/r${rep}`);
      const main = P.parseTranscript(t.file);
      let all = main.calls.slice();
      for (const sf of t.sub) all = all.concat(P.parseTranscript(sf).calls);
      F.rollouts++; F.allCalls += all.length;
      const R = { rid, form, task, rep, solved, calls: all.length, ssCalls: 0, byTool: {}, empty: 0, errs: {}, nativeAfterSS: 0 };
      let lastSSIdx = -99; const lastSSFiles = new Set(); const seenSSFiles = new Set();
      all.forEach((c, i) => {
        const isBash = c.name === 'Bash';
        if (isBash) F.bashCalls++;
        const cmd = isBash ? String(c.input.command || '') : '';
        const hits = isBash ? P.ssToolsIn(cmd) : [];
        const res = String(c.result || '');
        const ecm = res.match(MARK.exitCode);
        const ec = ecm ? Number(ecm[1]) : 0;
        if (hits.length) {
          F.ssBashCalls++;
          for (const tool of hits) { F.ssCalls++; R.ssCalls++; bump(F.byTool, tool); bump(R.byTool, tool); }
          const primary = hits[0], chained = hits.length > 1;
          bump(F.exitCodes, String(ec)); bump(out.exitCodeHist, String(ec));
          const note = (k, m) => { bump(F.errByClass, k); bump(R.errs, k); defect(k, rid, { tool: primary, chained, exit: ec, cmd: cmd.slice(0, 220), out: m ? String(m).slice(0, 300) : res.slice(0, 300) }); };
          if (MARK.noMatches.test(res)) { bump(F.byToolEmpty, primary); R.empty++; note('empty result: (no matches)', '(no matches)'); }
          if (MARK.crash.test(res))       note('ss-* crash (exit 1) — underlying engine error surfaced raw', res.match(MARK.crash)[0]);
          if (MARK.usageErr.test(res))    note('ss-* usage error (exit 2) — argument form rejected', res.split('\n').filter(l => /^\[ss\]|^Usage: ss-/.test(l)).slice(0, 3).join(' | '));
          if (MARK.readErr.test(res))     note('ss-read error (exit 1) — path not readable', res.match(MARK.readErr)[0]);
          if (MARK.readInvalid.test(res)) note('ss-read invalid line args (exit 2)', res.match(MARK.readInvalid)[0]);
          if (MARK.readCountNote.test(res)) note('ss-read start+count misuse (auto-recovered, exit 0)', res.match(MARK.readCountNote)[0]);
          if (MARK.serverErr.test(res))   note('ss-search warm-server unavailable (exit 1)', res.match(MARK.serverErr)[0]);
          if (MARK.repoIso.test(res))     note('ss-search repo-isolation refusal (exit 3)', res.match(MARK.repoIso)[0]);
          if (MARK.semanticErr.test(res)) note('ss-semantic error (exit 1)', res.match(MARK.semanticErr)[0]);
          if (MARK.noIndex.test(res))     note('no sweet-search index (exit 2)', res.match(MARK.noIndex)[0]);
          if (MARK.traceNoTarget.test(res)) note('ss-trace symbol not found (exit 1)', res.match(MARK.traceNoTarget)[0]);
          if (MARK.modelNoise.test(res))  { F.noiseCalls++; note('engine stderr leaked into agent output (model-load chatter)', res.split('\n').filter(l => MARK.modelNoise.test(l)).slice(0, 3).join(' | ')); }
          if (MARK.timedOut.test(res))    { F.timeouts++; note('harness killed the ss-* call (timeout)', res.match(MARK.timedOut)[0]); }
          if (ec === 127)                 note('command not found (exit 127)', res.slice(0, 200));
          const lat = res.match(MARK.traceLatency); if (lat) F.traceLatencyMs.push(Number(lat[1]));
          const sh = res.match(MARK.ssSearchHdr); if (sh) F.ssSearchUsedTokens.push(Number(sh[4]));
          const gh = res.match(MARK.ssGrepHdr); if (gh && Number(gh[1]) === 0) F.ssGrepZero++;
          for (const m of res.matchAll(/(^|[\s#*`(])([\w./@+-]+\/[\w.@+-]+\.[A-Za-z0-9_]+)(?=[:\s`)\],]|$)/gm)) { seenSSFiles.add(m[2]); lastSSFiles.add(m[2]); }
          for (const m of res.matchAll(/^# ss-read (\S+)/gm)) { seenSSFiles.add(m[1]); lastSSFiles.add(m[1]); }
          lastSSIdx = i;
        } else if ((isBash && NATIVE_CMD.test(cmd)) || NATIVE_TOOL.has(c.name)) {
          const target = isBash ? cmd : JSON.stringify(c.input);
          F.nativeRetrievalCalls++;
          const anyHit = [...seenSSFiles].find(f => f.length > 6 && target.includes(f));
          const immHit = (i - lastSSIdx <= 3) && [...lastSSFiles].find(f => f.length > 6 && target.includes(f));
          if (anyHit) { F.nativeAfterSS_any++; R.nativeAfterSS++; defect('native re-read of a file an ss-* call already returned', rid, { file: anyHit, cmd: (isBash ? cmd : c.name + ' ' + target).slice(0, 220) }); }
          if (immHit) F.nativeAfterSS_immediate++;
        }
      });
      out.rollouts.push(R);
    }
  }
}
out.defects = Object.fromEntries(Object.entries(D).map(([k, v]) => [k, { count: v.count, rollouts: v.rollouts.size, ridList: [...v.rollouts].slice(0, 40), examples: v.examples }]));
console.log(JSON.stringify(out, null, 1));
