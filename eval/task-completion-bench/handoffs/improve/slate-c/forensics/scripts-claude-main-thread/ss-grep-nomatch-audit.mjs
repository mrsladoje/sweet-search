// ss-grep-nomatch-audit.mjs — every single-invocation `ss-grep` call in a claude-code sweet run
// that answered "(no matches)" is replayed as `grep -E` over the task's golden checkout with the
// same pattern, flags and --in scope. Classes: scope-missing (the --in path does not exist in the
// golden), true-negative (grep finds nothing either), false-negative-candidate (grep finds lines).
// Also a histogram of `[ss-*] crash:` messages. Read-only; the goldens are only read by grep.
//   node ss-grep-nomatch-audit.mjs [--run fp-claudecode-tab-20260826] [--out DIR]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as P from './cc-parse.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const RUN = flag('run', 'fp-claudecode-tab-20260826');
const OUT = flag('out', '/tmp/wf-slatec/claude-main-thread/out');
const GOLDEN = '/root/.ss-eval/golden';
const rows = P.rowsOf(RUN);
const tasks = [...new Set(rows.map(r => r.taskId))].sort();
const goldenDirs = fs.readdirSync(GOLDEN);
const goldensFor = (repo) => { const pre = String(repo || '').replace('/', '__').toLowerCase() + '@'; return goldenDirs.filter(d => d.toLowerCase().startsWith(pre)).map(d => path.join(GOLDEN, d)); };

// parse a single ss-grep invocation: pattern = first quoted token after ss-grep, flags, --in scopes
function parseSsGrep(cmd) {
  const s = String(cmd || '').trim();
  if (/(&&|\|\||;|\|)/.test(s.replace(/"[^"]*"|'[^']*'/g, 'Q'))) return null;           // chained or piped
  const m = s.match(/^ss-grep\s+(.*)$/); if (!m) return null;
  const toks = []; const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g; let t;
  while ((t = re.exec(m[1]))) toks.push(t[1] !== undefined ? t[1].replace(/\\"/g, '"') : t[2] !== undefined ? t[2] : t[3]);
  const out = { pattern: null, inPaths: [], ignoreCase: false, word: false, fixed: false, k: null, positional: [] };
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i];
    if (x === '--in') { out.inPaths.push(toks[++i]); continue; }
    if (x === '-k') { out.k = toks[++i]; continue; }
    if (x === '-i' || x === '--ignore-case') { out.ignoreCase = true; continue; }
    if (x === '-w' || x === '--word-regexp') { out.word = true; continue; }
    if (x === '-F' || x === '--fixed-strings') { out.fixed = true; continue; }
    if (x.startsWith('-') && x.length > 1 && out.pattern !== null) continue;
    if (out.pattern === null) out.pattern = x; else out.positional.push(x);
  }
  return out.pattern === null ? null : out;
}
const EXCL = ['--exclude-dir=.git', '--exclude-dir=node_modules', '--exclude-dir=.sweet-search', '--exclude-dir=dist', '--exclude-dir=build', '--exclude-dir=vendor', '-I'];
function grepGolden(golden, g) {
  const args = ['-r', '-n', g.fixed ? '-F' : '-E', ...EXCL];
  if (g.ignoreCase) args.push('-i'); if (g.word) args.push('-w');
  args.push('--', g.pattern);
  const scopes = g.inPaths.length ? g.inPaths : ['.'];
  const missing = scopes.filter(sc => !fs.existsSync(path.join(golden, sc)));
  if (missing.length === scopes.length) return { scopeMissing: missing, lines: 0, files: [] };
  const present = scopes.filter(sc => fs.existsSync(path.join(golden, sc)));
  let outp = '';
  try { outp = execFileSync('grep', [...args, ...present], { cwd: golden, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { if (e.status === 1) outp = ''; else if (e.status === 2) return { scopeMissing: missing, lines: -1, files: [], grepError: String(e.stderr || e.message).slice(0, 200) }; else outp = String(e.stdout || ''); }
  const lines = outp ? outp.split('\n').filter(Boolean) : [];
  const files = [...new Set(lines.map(l => l.split(':')[0]))];
  return { scopeMissing: missing, lines: lines.length, files: files.slice(0, 12), sample: lines.slice(0, 3).map(l => l.slice(0, 160)) };
}

const audit = []; const crashes = {}; let ssGrepCalls = 0, ssGrepSingle = 0, noMatch = 0;
for (const task of tasks) {
  const repo = rows.find(r => r.taskId === task)?.repo; const goldens = goldensFor(repo);
  for (const m of P.matchCell(RUN, task, 'sweet', rows)) {
    for (const r of m.transcript.parsed.requests) for (const c of r.calls) {
      if (c.name !== 'Bash') continue;
      const cmd = String(c.input.command || ''); const res = String(c.result || '');
      const ss = P.ssToolsIn(cmd); if (!ss.length) continue;
      const crash = res.match(/\[ss-\*\] crash: ([^\n]{0,140})/);
      if (crash) { const key = crash[1].replace(/\/root\/[^\s)]+/g, '<path>').replace(/\d+/g, 'N'); crashes[key] ??= { n: 0, tasks: new Set(), tools: new Set(), example: cmd.slice(0, 140) }; crashes[key].n++; crashes[key].tasks.add(task); crashes[key].tools.add(ss[0]); }
      if (ss[0] !== 'ss-grep') continue;
      ssGrepCalls++;
      const g = parseSsGrep(cmd); if (!g) continue; ssGrepSingle++;
      const zero = /^\(no matches\)$/m.test(res) || /^# ss-grep: 0 total match/m.test(res);
      if (!zero) continue; noMatch++;
      const bre = /\\\||\\\(|\\\)|\\\{|\\\+|\\\?/.test(g.pattern);
      const posix = /\[\[:/.test(g.pattern);
      const rec = { task, rep: m.row.rep, k: r.idx, cmd: cmd.slice(0, 160), pattern: g.pattern, inPaths: g.inPaths, flags: { i: g.ignoreCase, w: g.word, F: g.fixed }, bre, posix, dialectHintShown: /regex note:|dialect/i.test(res), golden: null, verdict: null, grep: null, nextReal: (m.transcript.parsed.requests[r.idx + 1] || {}).realUsd || 0 };
      if (!goldens.length) { rec.verdict = 'no-golden'; audit.push(rec); continue; }
      // prefer the golden where the scope exists; else the first
      let pick = null, best = null;
      for (const gd of goldens) { const gr = grepGolden(gd, g); if (!pick || (best.scopeMissing.length && !gr.scopeMissing.length)) { pick = gd; best = gr; } }
      rec.golden = path.basename(pick); rec.grep = best;
      rec.verdict = best.lines === -1 ? 'grep-error' : best.scopeMissing.length && best.scopeMissing.length === (g.inPaths.length || 1) ? 'scope-missing' : best.lines > 0 ? 'false-negative-candidate' : 'true-negative';
      audit.push(rec);
    }
  }
}
const byVerdict = {}; for (const a of audit) { byVerdict[a.verdict] ??= { n: 0, nextReal: 0, bre: 0, posix: 0 }; byVerdict[a.verdict].n++; byVerdict[a.verdict].nextReal += a.nextReal; if (a.bre) byVerdict[a.verdict].bre++; if (a.posix) byVerdict[a.verdict].posix++; }
console.log(JSON.stringify({ run: RUN, sweetRollouts: rows.filter(r => r.arm === 'sweet').length, ssGrepCalls, ssGrepSingleInvocation: ssGrepSingle, zeroMatchAnswers: noMatch, byVerdict, crashes: Object.fromEntries(Object.entries(crashes).map(([k, v]) => [k, { n: v.n, tasks: [...v.tasks], tools: [...v.tools], example: v.example }])) }, null, 1));
console.log('\n--- false-negative candidates ---');
for (const a of audit.filter(a => a.verdict === 'false-negative-candidate')) console.log(`${a.task} r${a.rep} k=${a.k} | ${a.cmd} | bre=${a.bre} hint=${a.dialectHintShown} | grep: ${a.grep.lines} lines in ${a.grep.files.length}+ files [${a.grep.files.slice(0, 4).join(', ')}] | e.g. ${JSON.stringify(a.grep.sample?.[0] || '')}`);
console.log('\n--- scope-missing ---');
for (const a of audit.filter(a => a.verdict === 'scope-missing')) console.log(`${a.task} r${a.rep} k=${a.k} | ${a.cmd} | missing: ${a.grep.scopeMissing.join(', ')}`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `ss-grep-nomatch-audit-${RUN}.json`), JSON.stringify({ run: RUN, ssGrepCalls, ssGrepSingle, noMatch, byVerdict, crashes: Object.fromEntries(Object.entries(crashes).map(([k, v]) => [k, { n: v.n, tasks: [...v.tasks], tools: [...v.tools], example: v.example }])), audit }, null, 1));
