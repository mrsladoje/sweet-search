// cc-readgate-census.mjs — across EVERY rollout of a claude-code run: which Edit/Write calls
// targeted a file with no prior native Read in the session (only an ss-read, a shell cat, or
// nothing), and what the read-before-edit gate would have cost on a gated model, priced with
// this run's own per-request numbers. Read-only. Transcripts matched to rows by replayed cost.
//   node cc-readgate-census.mjs [--run fp-claudecode-tab-20260826] [--out DIR]
import fs from 'node:fs';
import path from 'node:path';
import * as P from './cc-parse.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const RUN = flag('run', 'fp-claudecode-tab-20260826');
const OUT = flag('out', '/tmp/wf-slatec/claude-main-thread/out');
fs.mkdirSync(OUT, { recursive: true });
const rows = P.rowsOf(RUN);
const tasks = [...new Set(rows.map(r => r.taskId))].sort();
const f6 = x => (Math.round(x * 1e6) / 1e6).toFixed(6);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const GOLDEN = '/root/.ss-eval/golden';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const isNewFileWrite = (res) => /File created successfully/i.test(String(res || ''));
const CAT_RE = /(^|[\s;&|(])(cat|sed|head|tail|nl|less|more|bat)\s+(?:-[\w=,'"]+\s+)*([^\s;&|'"`<>-][^\s;&|'"`<>]*)/g;
const catPaths = (cmd) => { const o = []; let m; const re = new RegExp(CAT_RE.source, 'g'); while ((m = re.exec(String(cmd || '')))) o.push(m[3]); return o; };

// golden lookup for a task's file (fallback estimator for the Read result size)
const goldenDirs = fs.existsSync(GOLDEN) ? fs.readdirSync(GOLDEN) : [];
function goldenBytes(repo, rel) {
  if (!repo || !rel || typeof rel !== 'string') return null;
  const pre = String(repo || '').replace('/', '__') + '@';
  for (const d of goldenDirs.filter(x => x.toLowerCase().startsWith(pre.toLowerCase()))) {
    const f = path.join(GOLDEN, d, rel);
    try { const st = fs.statSync(f); if (st.isFile()) { const txt = fs.readFileSync(f, 'latin1'); const lines = txt.split('\n').length; return { bytes: st.size, lines, golden: d }; } } catch {}
  }
  return null;
}

const events = []; const rollouts = []; const nativeReadBytesByTaskRel = new Map(); const readReqOut = []; const bptSamples = [];
for (const task of tasks) {
  for (const arm of ['native', 'sweet']) {
    for (const m of P.matchCell(RUN, task, arm, rows)) {
      const parsed = m.transcript.parsed; const R = parsed.requests; const T = R.length; const cwd = parsed.cwd;
      const rel = (fp) => cwd && fp && fp.startsWith(cwd) ? fp.slice(cwd.length + 1) : fp;
      // subagent Read paths with timestamps (claude-code gives each subagent its own read state; we report both ways)
      const subReads = [];
      for (const sf of m.transcript.sub) { for (const r of P.parseRequests(sf).requests) for (const c of r.calls) if (c.name === 'Read' && !c.isError) subReads.push({ fp: P.normPath(c.input.file_path, cwd), ts: r.ts }); }
      const readState = new Set(); const ssReadSet = new Set(); const catSet = new Set(); const firstEditSeen = new Set(); const subReadSet = new Set();
      let edits = 0, editsNoPriorRead = 0, editsNoPriorReadButSsRead = 0, gateErrs = 0, readsAfterSsRead = 0, reads = 0;
      for (const r of R) {
        const next = R[r.idx + 1];
        for (const c of r.calls) {
          if (c.name === 'Bash') {
            const cmd = c.input.command || '';
            const ssErr = P.classifySsError(c.result);
            for (const p of P.ssReadPaths(cmd)) if (ssErr !== 'read-error') ssReadSet.add(P.normPath(p, cwd));
            for (const p of catPaths(cmd)) catSet.add(P.normPath(p, cwd));
            if (/has not been read yet/i.test(String(c.result || ''))) gateErrs++;
            continue;
          }
          if (c.name === 'Read') {
            const fp = P.normPath(c.input.file_path, cwd); reads++;
            if (ssReadSet.has(fp)) readsAfterSsRead++;
            if (!c.isError && !/<tool_use_error>/.test(String(c.result || ''))) {
              readState.add(fp);
              if (arm === 'native') { const key = `${task}|${rel(fp)}`; if (!nativeReadBytesByTaskRel.has(key)) nativeReadBytesByTaskRel.set(key, []); nativeReadBytesByTaskRel.get(key).push(c.resultBytes); }
              // bytes-per-token sample: single-Read request, next request's ingest minus this request's own output
              if (r.calls.length === 1 && next && c.resultBytes > 1500) { const tok = next.ingest - r.usage.out - Math.round(r.userTextBytes / 4); if (tok > 100) bptSamples.push(c.resultBytes / tok); }
              if (r.calls.length === 1) readReqOut.push(r.usage.out);
            }
            continue;
          }
          if (EDIT_TOOLS.has(c.name)) {
            const rawFp = c.input.file_path || c.input.notebook_path;
            if (!rawFp) { edits++; events.push({ task, arm, rep: m.row.rep, k: r.idx, T, tool: c.name, rel: '(no file_path: malformed call)', exists: null, errCls: P.classifyEditError(c.result) || 'malformed-json', firstEditOfFile: false, priorReadMain: true, priorReadSub: false, priorSsRead: false, priorCat: false, requestReal: r.realUsd, prefix: r.usage.totalIn, out: r.usage.out, remaining: 0 }); continue; }
            const fp = P.normPath(rawFp, cwd);
            const errCls = c.isError ? (P.classifyEditError(c.result) || 'other-error') : P.classifyEditError(c.result);
            if (/has not been read yet/i.test(String(c.result || ''))) gateErrs++;
            const newFile = c.name === 'Write' && isNewFileWrite(c.result);
            const exists = c.name === 'Write' ? (newFile ? false : (errCls === 'wrong-path' ? null : true)) : (errCls === 'wrong-path' ? false : true);
            for (const sr of subReads) if (sr.ts && r.ts && sr.ts < r.ts) subReadSet.add(sr.fp);
            const priorRead = readState.has(fp);
            edits++;
            if (!priorRead) { editsNoPriorRead++; if (ssReadSet.has(fp)) editsNoPriorReadButSsRead++; }
            const first = !firstEditSeen.has(fp); firstEditSeen.add(fp);
            events.push({ task, arm, rep: m.row.rep, k: r.idx, T, remaining: Math.max(0, T - r.idx - 1), tool: c.name, rel: rel(fp), exists, newFile, errCls, firstEditOfFile: first,
              priorReadMain: priorRead, priorReadSub: subReadSet.has(fp), priorSsRead: ssReadSet.has(fp), priorCat: catSet.has(fp),
              requestReal: r.realUsd, prefix: r.usage.totalIn, out: r.usage.out, editOutChars: String(c.input.old_string || '').length + String(c.input.new_string || c.input.content || '').length });
            if (!errCls) readState.add(fp); // a successful Edit/Write refreshes the file's read state
            continue;
          }
        }
      }
      rollouts.push({ task, arm, rep: m.row.rep, matchedByCost: m.matchedByCost, T, real: parsed.totalReal, rowReal: m.row.costRealizedMainOnlyUsd ?? m.row.costRealizedUsd, edits, editsNoPriorRead, editsNoPriorReadButSsRead, gateErrs, reads, readsAfterSsRead, repo: m.row.repo, resolved: m.row.resolved });
    }
  }
}
const BPT = median(bptSamples) || 3.9;
const READ_REQ_OUT = median(readReqOut) || 80;
console.log(`run=${RUN} rollouts=${rollouts.length} matchedByCost=${rollouts.filter(r => r.matchedByCost).length} (unmatched: ${rollouts.filter(r => !r.matchedByCost).map(r => `${r.task}/${r.arm}/r${r.rep}`).join(', ') || 'none'})`);
console.log(`bytes-per-token from ${bptSamples.length} native single-Read requests: median ${BPT.toFixed(2)} (p25 ${[...bptSamples].sort((a, b) => a - b)[Math.floor(bptSamples.length / 4)]?.toFixed(2)}, p75 ${[...bptSamples].sort((a, b) => a - b)[Math.floor(3 * bptSamples.length / 4)]?.toFixed(2)})`);
console.log(`output tokens of a single-Read request: median ${READ_REQ_OUT} (n=${readReqOut.length})`);

// ---------- per-arm census ----------
const GATED_MODEL_SET_2_1_218 = ['claude-opus-4-6', 'claude-haiku-4-5', 'claude-opus-4-5', 'claude-opus-4-1', 'claude-opus-4-0', 'claude-sonnet-4-5', 'claude-sonnet-4-0', 'claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku'];
const summary = {};
for (const arm of ['native', 'sweet']) {
  const rs = rollouts.filter(r => r.arm === arm); const ev = events.filter(e => e.arm === arm);
  const cellReal = rs.reduce((a, r) => a + r.real, 0); const cellReq = rs.reduce((a, r) => a + r.T, 0);
  const meanReq = cellReal / cellReq;
  // per-edit-call view (reproduces the 08-28 census unit)
  const perCall = { edits: ev.length, byTool: {}, noPriorRead: ev.filter(e => !e.priorReadMain).length, noPriorReadButSsRead: ev.filter(e => !e.priorReadMain && e.priorSsRead).length, noPriorReadButCat: ev.filter(e => !e.priorReadMain && !e.priorSsRead && e.priorCat).length, noPriorReadNothing: ev.filter(e => !e.priorReadMain && !e.priorSsRead && !e.priorCat).length, noPriorReadButSubRead: ev.filter(e => !e.priorReadMain && e.priorReadSub).length, gateErrorsObserved: rs.reduce((a, r) => a + r.gateErrs, 0) };
  for (const e of ev) perCall.byTool[e.tool] = (perCall.byTool[e.tool] || 0) + 1;
  // per (rollout,file) first-edit view — the unit the gate fires on
  const firsts = ev.filter(e => e.firstEditOfFile);
  const gatedEdit = firsts.filter(e => e.tool !== 'Write' && e.exists !== false && !e.priorReadMain);           // Edit gate (model-gated)
  const gatedWrite = firsts.filter(e => e.tool === 'Write' && e.exists === true && !e.priorReadMain);           // Write gate (flag-gated, all models)
  // price the counterfactual per gated file
  let taxImmediate = 0, taxLifetime = 0, taxSimple = 0, readTokSum = 0, readSrc = { native: 0, golden: 0, median: 0 };
  const allNativeReadBytes = [...nativeReadBytesByTaskRel.values()].flat();
  const medianReadBytes = median(allNativeReadBytes);
  for (const e of [...gatedEdit, ...gatedWrite]) {
    let bytes = null; const key = `${e.task}|${e.rel}`;
    if (nativeReadBytesByTaskRel.has(key)) { bytes = mean(nativeReadBytesByTaskRel.get(key)); readSrc.native++; }
    else { const g = goldenBytes(rs.find(r => r.task === e.task)?.repo, e.rel); if (g) { const shown = Math.min(g.lines, 2000); bytes = g.bytes * (shown / Math.max(1, g.lines)) + shown * 6; readSrc.golden++; } else { bytes = medianReadBytes; readSrc.median++; } }
    const readTok = bytes / BPT; readTokSum += readTok; e.readTok = Math.round(readTok);
    const A_out = e.out, prefixA = e.prefix, outB = READ_REQ_OUT;
    // request B (Read): re-sent prefix incl. A's output and the ~15-token error, small output
    const reqB = (P.PRICE.cacheRead * (prefixA + A_out + 15) + P.PRICE.out * outB) / 1e6;
    // request C (re-issued Edit): ingests the Read result, re-sends everything, emits the same payload
    const reqC = (P.PRICE.cacheWrite * readTok + P.PRICE.cacheRead * (prefixA + A_out + 15 + outB) + P.PRICE.out * A_out) / 1e6;
    const imm = reqB + reqC;
    const life = imm + (P.PRICE.cacheRead * (readTok + A_out + outB + 15) * e.remaining) / 1e6;
    e.taxImmediate = imm; e.taxLifetime = life; e.taxSimple = 2 * meanReq;
    taxImmediate += imm; taxLifetime += life; taxSimple += 2 * meanReq;
  }
  const n = rs.length;
  summary[arm] = { rollouts: n, requests: cellReq, cellRealMainOnly: cellReal, meanRequestUsd: meanReq, perCall,
    firstEdits: firsts.length, firstEditsWithoutPriorRead: firsts.filter(e => !e.priorReadMain).length,
    gatedEditFiles: gatedEdit.length, gatedWriteFiles: gatedWrite.length, gatedFilesPerRollout: (gatedEdit.length + gatedWrite.length) / n,
    rolloutsWithAnyGatedFile: new Set([...gatedEdit, ...gatedWrite].map(e => `${e.task}|${e.rep}`)).size,
    gatedEditFilesWithSsRead: gatedEdit.filter(e => e.priorSsRead).length, gatedEditFilesWithCatOnly: gatedEdit.filter(e => !e.priorSsRead && e.priorCat).length, gatedEditFilesWithNothing: gatedEdit.filter(e => !e.priorSsRead && !e.priorCat).length,
    readTokMean: (gatedEdit.length + gatedWrite.length) ? readTokSum / (gatedEdit.length + gatedWrite.length) : 0, readSizeSource: readSrc,
    tax: { immediateTotal: taxImmediate, lifetimeTotal: taxLifetime, simpleTotal: taxSimple, immediatePerRollout: taxImmediate / n, lifetimePerRollout: taxLifetime / n, simplePerRollout: taxSimple / n, immediatePctOfArm: 100 * taxImmediate / cellReal, lifetimePctOfArm: 100 * taxLifetime / cellReal, simplePctOfArm: 100 * taxSimple / cellReal },
    readsAfterSsRead: rs.reduce((a, r) => a + r.readsAfterSsRead, 0), reads: rs.reduce((a, r) => a + r.reads, 0) };
}
console.log(JSON.stringify({ run: RUN, BPT, READ_REQ_OUT, gatedModelSet_2_1_218: GATED_MODEL_SET_2_1_218, summary }, null, 1));
fs.writeFileSync(path.join(OUT, `readgate-census-${RUN}.json`), JSON.stringify({ run: RUN, BPT, READ_REQ_OUT, summary, rollouts, events }, null, 1));
console.log(`wrote ${OUT}/readgate-census-${RUN}.json`);
