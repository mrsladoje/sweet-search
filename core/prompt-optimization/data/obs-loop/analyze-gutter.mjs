#!/usr/bin/env node
// analyze-gutter.mjs <manifest> — per-rollout read of the ss-read gutter smoke (gutter-smoke.sh): A = SS_READ_GUTTER=tab, B = none.
// Sources per rollout: results/<run>/rows.json (resolved, idealCostUsd, idealTurns, calls) and the main-session Claude transcript
// results/<run>/agent-state/<task>-sweet/claude-home/projects/*/*.jsonl (tool inputs, error texts; subagent files skipped).
// Columns:
//   req      model requests (idealTurns)          calls   tool calls
//   ssR      ss-read invocations                  ssRg    ss-read results that carry an `N<TAB>` gutter (exposure: A > 0, B must be 0)
//   ssG      ss-grep invocations                  lnP     native line-number probes: grep/rg with -n, cat -n, nl, awk NR (heuristic)
//   sedR     native `sed -n 'a,bp'` range reads   ed      Edit/MultiEdit/Write calls     bEd  edits through Bash (sed -i, heredoc, python write)
//   edF      failed Edit/MultiEdit/Write          nf      of which "String to replace not found"
//   unread   "File has not been read yet" errors  leak    old_string lines that carry a gutter prefix (`12<TAB>`, `12: `, `12| `)
//   ws       not-found anchors that match the base file once ONE leading whitespace char per line is removed or added (whitespace
//            carry/drop; checked against the golden base file, so an anchor on text the agent wrote earlier is missed: heuristic)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const manifest = process.argv[2];
if (!manifest || !fs.existsSync(manifest)) { console.error('usage: analyze-gutter.mjs <results/gs-<stamp>.manifest>'); process.exit(2); }
const RES = path.dirname(manifest);
const GOLDEN = path.join(os.homedir(), '.ss-eval/golden');
const specs = new Map(JSON.parse(fs.readFileSync(path.join(RES, 'gs-specs.json'), 'utf8')).map(s => [s.instance_id, s]));
const legs = fs.readFileSync(manifest, 'utf8').split('\n').filter(Boolean).map(l => {
  const [run, a, r] = l.split(' '); return { run, arm: a.slice(4), rep: r.slice(4) };
});

const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b.text || '').join('\n') : '';
const count = (s, re) => (s.match(re) || []).length;
function transcript(run, task) {
  const base = path.join(RES, run, 'agent-state', `${task}-sweet`, 'claude-home', 'projects');
  if (!fs.existsSync(base)) return [];
  const files = [];
  for (const d of fs.readdirSync(base)) {
    const dir = path.join(base, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) files.push(path.join(dir, f));   // top level only: subagents/ is a subdir
  }
  files.sort((x, y) => fs.statSync(x).mtimeMs - fs.statSync(y).mtimeMs);
  return files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
}
function goldenText(task, filePath) {
  const s = specs.get(task); if (!s || !filePath) return null;
  const rel = filePath.replace(/^.*?\/\.ss-eval\/runs\/[^/]+\//, '');
  const p = path.join(GOLDEN, `${s.repo.replace('/', '__')}@${s.base_commit}`, rel);
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
const shiftWs = (s, dir) => s.split('\n').map(l => !l.trim() ? l : dir < 0 ? l.replace(/^[\t ]/, '') : (/^\t/.test(l) ? '\t' : /^ /.test(l) ? ' ' : '') + l).join('\n');

function analyze(leg, row) {
  const m = { req: row.idealTurns, calls: row.calls, ssR: 0, ssRg: 0, ssG: 0, lnP: 0, sedR: 0, ed: 0, bEd: 0, edF: 0, nf: 0, unread: 0, leak: 0, ws: 0 };
  const uses = new Map();
  for (const o of transcript(leg.run, row.taskId)) {
    const c = o.message?.content; if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'tool_use') {
        uses.set(b.id, b);
        const inp = b.input || {};
        if (b.name === 'Bash') {
          const cmd = String(inp.command || '');
          m.ssR += count(cmd, /\bss-read\b/g); m.ssG += count(cmd, /\bss-grep\b/g);
          m.lnP += count(cmd, /\b(?:grep|rg)\b[^|;&\n]*\s-[A-Za-z]*n[A-Za-z]*\b/g) + count(cmd, /\bcat\s+-n\b/g) + count(cmd, /(?:^|[|;&]\s*)nl\b/g) + count(cmd, /\bawk\b[^|;&\n]*\bNR\b/g);
          m.sedR += count(cmd, /\bsed\s+-n\s+['"]?\d+,\d+p/g);
          m.bEd += count(cmd, /\bsed\s+-i\b|\bperl\s+-[a-z]*i|\bcat\s*>{1,2}|\btee\s|open\([^)]*['"][wa]['"]|write_text\(/g);
        } else if (['Edit', 'MultiEdit', 'Write'].includes(b.name)) {
          m.ed++;
          const olds = b.name === 'MultiEdit' ? (inp.edits || []).map(e => e.old_string || '') : [inp.old_string || ''];
          for (const s of olds) m.leak += count(s, /^\d+(?:\t|: |\| )/gm);
        }
      } else if (b.type === 'tool_result') {
        const u = uses.get(b.tool_use_id); if (!u) continue;
        const t = textOf(b.content);
        if (u.name === 'Bash' && /\bss-read\b/.test(String(u.input?.command || '')) && /^# ss-read /m.test(t) && /^\d+\t/m.test(t)) m.ssRg++;
        if (b.is_error && ['Edit', 'MultiEdit', 'Write'].includes(u.name)) {
          m.edF++;
          if (/String to replace not found/i.test(t)) {
            m.nf++;
            const g = goldenText(row.taskId, u.input?.file_path);
            const olds = u.name === 'MultiEdit' ? (u.input.edits || []).map(e => e.old_string || '') : [u.input?.old_string || ''];
            if (g && olds.some(s => s && !g.includes(s) && (g.includes(shiftWs(s, -1)) || g.includes(shiftWs(s, 1))))) m.ws++;
          }
        }
        if (/has not been read yet/i.test(t)) m.unread++;
      }
    }
  }
  return m;
}

const out = [];
for (const leg of legs) {
  const f = path.join(RES, leg.run, 'rows.json');
  if (!fs.existsSync(f)) { console.log(`${leg.run} (arm ${leg.arm}): no rows.json yet`); continue; }
  for (const row of JSON.parse(fs.readFileSync(f, 'utf8'))) out.push({ leg, row, m: analyze(leg, row) });
}
const K = ['req', 'calls', 'ssR', 'ssRg', 'ssG', 'lnP', 'sedR', 'ed', 'bEd', 'edF', 'nf', 'unread', 'leak', 'ws'];
const pad = (s, n) => String(s ?? '-').padStart(n);
console.log(`gutter smoke ${path.basename(manifest)}: ${out.length} rollouts (A = SS_READ_GUTTER=tab, B = none)\n`);
console.log(`${'task'.padEnd(36)} arm rep  ${'run'.padEnd(22)} solved  ideal$ ` + K.map(k => pad(k, 7)).join(''));
for (const { leg, row, m } of out.sort((x, y) => x.row.taskId.localeCompare(y.row.taskId) || x.leg.arm.localeCompare(y.leg.arm) || x.leg.rep - y.leg.rep)) {
  const flag = !row.calls ? '  ZERO-CALL (infra)' : row.exitReason !== 'model_stopped' ? `  exit=${row.exitReason}` : '';
  console.log(`${row.taskId.padEnd(36)} ${leg.arm}   ${leg.rep}    ${leg.run.padEnd(22)} ${pad(row.resolved ? 'yes' : 'no', 6)} ${pad((row.idealCostUsd ?? NaN).toFixed(3), 7)} ` + K.map(k => pad(m[k], 7)).join('') + flag);
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
console.log(`dev-tuned micro-smoke data: read solve flips and failure counts, not cost (n = ${a.length} A, ${b.length} B). Never publish.`);
