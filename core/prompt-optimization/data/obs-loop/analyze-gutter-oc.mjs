#!/usr/bin/env node
// analyze-gutter-oc.mjs <manifest> [--detail] — per-rollout read of the opencode ss-read gutter smoke (gutter-smoke-oc.sh):
// A = SS_READ_GUTTER=colon (shipped, `N:code`), B = none. Opencode port of analyze-gutter.mjs.
// Sources per rollout: results/<run>/rows.json (resolved, idealCostUsd, idealTurns, calls) and the retained opencode stream
// results/<run>/agent-state/<task>-sweet/opencode-retained/session-*/attempt-N.stdout.ndjson (newest session, last attempt).
// Tool events: {type:'tool_use', part:{type:'tool', tool, state:{status, input, output|error}}}; tools: bash, read, apply_patch, edit, write, glob, todowrite.
// Columns:
//   req      model requests (idealTurns)      calls    tool calls
//   ssR      ss-read invocations              ssRg     ss-read results that carry an `N:` gutter (exposure: A > 0, B must be 0)
//   ssG      ss-grep invocations              lnP      native line-number probes: grep/rg -n, cat -n, nl, awk NR (heuristic; opencode's own `read` tool is always numbered and is not counted)
//   sedR     native `sed -n 'a,bp'` reads     rd       native opencode `read` tool calls
//   ed       apply_patch/edit/write calls     bEd      edits through bash (sed -i, heredoc, python write)
//   edF      failed apply_patch/edit/write    nf       of which "Failed to find expected lines" / "oldString not found" (anchor failures)
//   leak     patch/old-string lines that carry a gutter prefix (`12:code`, `12: code`)
// --detail also prints every ss-read command (with the gutter verdict of its result) and every failed edit with its error text.
import fs from 'node:fs';
import path from 'node:path';

const manifest = process.argv[2];
const DETAIL = process.argv.includes('--detail');
if (!manifest || !fs.existsSync(manifest)) { console.error('usage: analyze-gutter-oc.mjs <results/gso-<stamp>.manifest> [--detail]'); process.exit(2); }
const RES = path.dirname(manifest);
const legs = fs.readFileSync(manifest, 'utf8').split('\n').filter(Boolean).map(l => {
  const [run, a, r] = l.split(' '); return { run, arm: a.slice(4), rep: r.slice(4) };
});
const count = (s, re) => (s.match(re) || []).length;
const GUT = /^[ -]?\d+: ?\S/;   // a numbered code line: `12:code` or `12: code` (patch context/removed lines may carry one leading space or '-')

function events(run, task) {
  const base = path.join(RES, run, 'agent-state', `${task}-sweet`, 'opencode-retained');
  if (!fs.existsSync(base)) return [];
  const sess = fs.readdirSync(base).filter(d => d.startsWith('session-')).sort();   // epoch ms in the name: newest last (a degenerate re-run is a new session)
  if (!sess.length) return [];
  const dir = path.join(base, sess[sess.length - 1]);
  const atts = fs.readdirSync(dir).filter(f => /^attempt-\d+\.stdout\.ndjson$/.test(f)).sort();   // the last attempt is the scored one
  if (!atts.length) return [];
  return fs.readFileSync(path.join(dir, atts[atts.length - 1]), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const editText = i => [i.patchText, i.oldString, i.newString, i.content].filter(Boolean).join('\n');

function analyze(leg, row) {
  const m = { req: row.idealTurns, calls: row.calls, ssR: 0, ssRg: 0, ssG: 0, lnP: 0, sedR: 0, rd: 0, ed: 0, bEd: 0, edF: 0, nf: 0, leak: 0 };
  const detail = [];
  for (const o of events(leg.run, row.taskId)) {
    const p = o.part; if (o.type !== 'tool_use' || p?.type !== 'tool') continue;
    const st = p.state || {}, inp = st.input || {}, out = String(st.output ?? '');
    if (p.tool === 'bash') {
      const cmd = String(inp.command || '');
      const nR = count(cmd, /\bss-read\b/g);
      m.ssR += nR; m.ssG += count(cmd, /\bss-grep\b/g);
      m.lnP += count(cmd, /\b(?:grep|rg)\b[^|;&\n]*\s-[A-Za-z]*n[A-Za-z]*\b/g) + count(cmd, /\bcat\s+-n\b/g) + count(cmd, /(?:^|[|;&]\s*)nl\b/g) + count(cmd, /\bawk\b[^|;&\n]*\bNR\b/g);
      m.sedR += count(cmd, /\bsed\s+-n\s+['"]?\d+,\d+p/g);
      m.bEd += count(cmd, /\bsed\s+-i\b|\bperl\s+-[a-z]*i|\bcat\s*>{1,2}|\btee\s|open\([^)]*['"][wa]['"]|write_text\(/g);
      if (nR) {
        const g = /^# ss-read |^ss-read /m.test(out) && /^\d+:/m.test(out);   // ss-read prints its header then `N:code`
        if (g) m.ssRg++;
        detail.push(`  ss-read[gutter=${g ? 'Y' : 'n'}] ${cmd.replace(/\s+/g, ' ').slice(0, 220)}`);
      }
    } else if (p.tool === 'read') m.rd++;
    else if (['apply_patch', 'edit', 'write', 'multiedit'].includes(p.tool)) {
      m.ed++;
      for (const l of editText(inp).split('\n')) if (!l.startsWith('+') && GUT.test(l)) m.leak++;
      if (st.status !== 'completed') {
        m.edF++;
        const err = String(st.error ?? out);
        if (/Failed to find expected lines|oldString (?:not found|was not found)|not found in/i.test(err)) m.nf++;
        detail.push(`  FAILED ${p.tool}: ${err.replace(/\s+/g, ' ').slice(0, 260)}\n    input: ${editText(inp).replace(/\n/g, '\\n').slice(0, 500)}`);
      }
    }
  }
  return { m, detail };
}

const out = [];
for (const leg of legs) {
  const f = path.join(RES, leg.run, 'rows.json');
  if (!fs.existsSync(f)) { console.log(`${leg.run} (arm ${leg.arm}): no rows.json yet`); continue; }
  for (const row of JSON.parse(fs.readFileSync(f, 'utf8'))) out.push({ leg, row, ...analyze(leg, row) });
}
const K = ['req', 'calls', 'ssR', 'ssRg', 'ssG', 'lnP', 'sedR', 'rd', 'ed', 'bEd', 'edF', 'nf', 'leak'];
const pad = (s, n) => String(s ?? '-').padStart(n);
console.log(`gutter smoke (opencode) ${path.basename(manifest)}: ${out.length} rollouts (A = SS_READ_GUTTER=colon, B = none)\n`);
console.log(`${'task'.padEnd(36)} arm rep  ${'run'.padEnd(22)} solved  ideal$ ` + K.map(k => pad(k, 6)).join(''));
const sorted = out.sort((x, y) => x.row.taskId.localeCompare(y.row.taskId) || x.leg.arm.localeCompare(y.leg.arm) || x.leg.rep - y.leg.rep);
for (const { leg, row, m } of sorted) {
  const flag = (!row.calls ? '  ZERO-CALL (infra)' : row.exitReason !== 'model_stopped' ? `  exit=${row.exitReason}` : '') + (row.degenReran ? '  RERUN (first attempt degenerate)' : '');
  console.log(`${row.taskId.padEnd(36)} ${leg.arm}   ${leg.rep}    ${leg.run.padEnd(22)} ${pad(row.resolved ? 'yes' : 'no', 6)} ${pad((row.idealCostUsd ?? NaN).toFixed(3), 7)} ` + K.map(k => pad(m[k], 6)).join('') + flag);
}
console.log('\nper arm (sums; ideal$ and req are means):');
for (const arm of ['A', 'B']) {
  const xs = out.filter(o => o.leg.arm === arm); if (!xs.length) continue;
  const sum = k => xs.reduce((a, o) => a + (Number(o.m[k]) || 0), 0);
  const cost = xs.reduce((a, o) => a + (o.row.idealCostUsd || 0), 0) / xs.length;
  console.log(`  ${arm}: n=${xs.length} solved=${xs.filter(o => o.row.resolved).length} ideal$=${cost.toFixed(3)} req=${(sum('req') / xs.length).toFixed(1)} ` + K.filter(k => k !== 'req').map(k => `${k}=${sum(k)}`).join(' '));
}
const a = out.filter(o => o.leg.arm === 'A'), b = out.filter(o => o.leg.arm === 'B');
const ga = a.reduce((s, o) => s + o.m.ssRg, 0), gb = b.reduce((s, o) => s + o.m.ssRg, 0);
console.log(`\nexposure check: gutter-bearing ss-read results A=${ga} (must be > 0 when A read >= 15 lines) B=${gb} (must be 0)${gb ? '  *** B SAW A GUTTER: treatment did not apply ***' : ''}`);
if (DETAIL) for (const { leg, row, detail } of sorted) { console.log(`\n== ${row.taskId} arm ${leg.arm} rep ${leg.rep} (${leg.run})`); detail.forEach(d => console.log(d)); }
console.log(`\ndev-tuned micro-smoke data: read solve flips and failure counts, not cost (n = ${a.length} A, ${b.length} B). Never publish.`);
