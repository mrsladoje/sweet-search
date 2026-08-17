#!/usr/bin/env node
// SLATE-B W0 gate — P3 falsifier 1: RUN THE FROZEN WITNESSES.
//
// The three witnesses were authored from issue text, base source and recorded visible
// output, and committed at 96686fa BEFORE this script existed. Nothing here edits them.
//
// Each witness is run against:
//   BASE      the golden tree with no patch. The witness MUST reject it — a witness that
//             passes on the unfixed tree is not testing the requested behaviour at all,
//             and this is the check that stops a vacuous witness from scoring well.
//   <cell>    every recorded model patch, all arms and reps. P3 requires rejection of
//             every WRONG patch; a patch whose cell resolved is not wrong, so accepting
//             it is the correct answer there.
//   GOLD      the reference patch. Read only now, after the freeze, and only to confirm
//             the witness is satisfiable. If a witness rejects gold it is over-specified
//             and its rejections prove nothing.
//
// Trees are materialised with `git archive` into a temp dir and deleted. The goldens are
// never written to. No agent runs, no grading, no model spend.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const GOLDEN = process.env.GOLDEN || '/root/.ss-eval/golden';
const WIT = process.env.WIT || path.join(BENCH, 'handoffs/improve/phase1-scripts/witnesses');
const RUNS = ['sb-codex-20260811', 'sb-opencode-20260811', 'sb-claudecode-20260811'];
const OUT = process.env.OUT || '/root/w0-p3-witness.json';

const specs = JSON.parse(readFileSync(path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json'), 'utf8'));
const specOf = new Map(specs.map(t => [t.instance_id, t]));
const sh = (cmd, opts = {}) => execFileSync('sh', ['-c', cmd], { encoding: 'utf8', timeout: 600000, ...opts });

function materialise(taskId) {
  const s = specOf.get(taskId);
  const g = path.join(GOLDEN, s.repo.replace('/', '__') + '@' + s.base_commit);
  if (!existsSync(g)) throw new Error(`no golden checkout for ${taskId}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'p3w-'));
  sh(`git -C ${JSON.stringify(g)} archive HEAD | tar -x -C ${JSON.stringify(dir)}`, { stdio: 'ignore' });
  return dir;
}

function applyPatch(dir, patch) {
  if (!patch || !patch.trim()) return { applied: true, note: 'empty patch' };
  const pf = path.join(dir, '.w0p3.patch');
  writeFileSync(pf, patch.endsWith('\n') ? patch : patch + '\n');
  for (const p of ['-p1', '-p0']) {
    try { sh(`cd ${JSON.stringify(dir)} && git apply ${p} .w0p3.patch`, { stdio: 'pipe' }); return { applied: true, note: `git apply ${p}` }; }
    catch { /* try the next strip level */ }
  }
  try { sh(`cd ${JSON.stringify(dir)} && patch -p1 --batch --forward < .w0p3.patch`, { stdio: 'pipe' }); return { applied: true, note: 'patch -p1' }; }
  catch (e) { return { applied: false, note: String(e.message).split('\n')[0] }; }
}

// --------------------------------------------------------------------- runners
// Each returns {verdict: 'ACCEPT'|'REJECT'|'ERROR', detail}

function runDashbitco(dir) {
  cpSync(path.join(WIT, 'dashbitco_integer_witness_test.exs'), path.join(dir, 'test/w0_p3_witness_test.exs'));
  // `mix test` is unusable here: the project declares ex_doc, so mix tries to resolve
  // dependencies, asks to install Hex, and dies with the network off. Compiling lib/
  // straight with elixirc and driving ExUnit by hand keeps the run hermetic and offline.
  writeFileSync(path.join(dir, 'w0_p3_run.exs'),
    'ExUnit.start(autorun: false)\n'
    + 'Code.require_file("test/w0_p3_witness_test.exs")\n'
    + 'res = ExUnit.run()\n'
    + 'IO.puts("W0P3-RESULT failures=#{res.failures} total=#{res.total}")\n'
    + 'System.halt(if(res.failures == 0, do: 0, else: 1))\n');
  const cmd = `docker run --rm --network none -v ${JSON.stringify(dir)}:/src -w /src -e HOME=/tmp `
    + `elixir:1.14-alpine sh -c 'mkdir -p /tmp/ebin && elixirc -o /tmp/ebin $(find lib -name "*.ex") `
    + `&& elixir -pa /tmp/ebin w0_p3_run.exs' 2>&1`;
  let out;
  try { out = sh(cmd, { stdio: 'pipe' }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const m = /W0P3-RESULT failures=(\d+) total=(\d+)/.exec(out);
  if (m) return { verdict: m[1] === '0' ? 'ACCEPT' : 'REJECT', detail: `${m[1]}/${m[2]} failed | ` + summarise(out) };
  // A patch that will not compile has not delivered the behaviour, so it is a rejection
  // by the witness rather than a broken harness. Anything else is an honest ERROR.
  if (/\*\* \(|error:|Compilation error/.test(out)) return { verdict: 'REJECT', detail: 'does not compile | ' + summarise(out) };
  return { verdict: 'ERROR', detail: summarise(out) };
}

function runCodeception(dir) {
  // Two colour-only modules the 2016 tree imports; stubbed so the witness needs no
  // network and no dependency resolution.
  mkdirSync(path.join(dir, 'node_modules/chalk'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules/chalk/package.json'), '{"name":"chalk","version":"0.0.0-w0p3-stub","main":"index.js"}');
  writeFileSync(path.join(dir, 'node_modules/chalk/index.js'),
    'const id=(s)=>s;const mk=()=>new Proxy(id,{get:()=>mk()});module.exports=mk();\n');
  mkdirSync(path.join(dir, 'node_modules/mocha/lib/reporters'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules/mocha/package.json'), '{"name":"mocha","version":"0.0.0-w0p3-stub","main":"index.js"}');
  writeFileSync(path.join(dir, 'node_modules/mocha/index.js'), 'module.exports={};\n');
  writeFileSync(path.join(dir, 'node_modules/mocha/lib/reporters/base.js'),
    'module.exports={symbols:{ok:"ok",err:"err",dot:".",comma:",",bang:"!"},color:(t,s)=>s,useColors:false};\n');
  cpSync(path.join(WIT, 'codeception_comment_witness.js'), path.join(dir, 'w0_p3_witness.js'));
  try {
    const out = sh(`cd ${JSON.stringify(dir)} && REPO=${JSON.stringify(dir)} timeout 120 node w0_p3_witness.js 2>&1`, { stdio: 'pipe' });
    return { verdict: /WITNESS ACCEPT/.test(out) ? 'ACCEPT' : 'REJECT', detail: summarise(out) };
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    if (/WITNESS REJECT/.test(out)) return { verdict: 'REJECT', detail: summarise(out) };
    return { verdict: 'ERROR', detail: summarise(out || e.message) };
  }
}

function runAkinsho(dir) {
  cpSync(path.join(WIT, 'akinsho_offset_witness.lua'), path.join(dir, 'w0_p3_witness.lua'));
  const target = 'lua/bufferline/offset.lua';
  if (!existsSync(path.join(dir, target))) return { verdict: 'ERROR', detail: 'offset.lua missing from the tree' };
  try {
    const out = sh(`docker run --rm --network none -v ${JSON.stringify(dir)}:/src -w /src `
      + `nickblah/lua:5.1-luarocks-alpine sh -c "lua w0_p3_witness.lua ${target} 2>&1"`, { stdio: 'pipe' });
    return { verdict: /WITNESS ACCEPT/.test(out) ? 'ACCEPT' : 'REJECT', detail: summarise(out) };
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    if (/WITNESS REJECT/.test(out)) return { verdict: 'REJECT', detail: summarise(out) };
    return { verdict: 'ERROR', detail: summarise(out || e.message) };
  }
}

const summarise = (s) => String(s).split('\n').filter(l =>
  /PASS |FAIL |WITNESS |failures?|Error|error:|\d+\)/.test(l)).slice(0, 14).join(' | ').slice(0, 1200);

const TASKS = {
  'dashbitco__nimble_options-43': runDashbitco,
  'codeception__codeceptjs-367': runCodeception,
  'akinsho__nvim-bufferline.lua-173': runAkinsho,
};

// ------------------------------------------------------------------- the patches
function recordedPatches(taskId) {
  const out = [];
  for (const run of RUNS) {
    for (const [rep, sub] of [[0, ''], [1, 'rep-1/']]) {
      for (const arm of ['native', 'sweet']) {
        const f = path.join(RESULTS, run, arm, sub + 'patches.json');
        if (!existsSync(f)) continue;
        const rec = Object.values(JSON.parse(readFileSync(f, 'utf8'))).find(r => r.instance_id === taskId);
        if (!rec) continue;
        const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
        const list = Array.isArray(rows) ? rows : rows.rows;
        const row = list.find(x => x.taskId === taskId && x.arm === arm && x.rep === rep);
        out.push({
          label: `${run.split('-')[1]}/${arm}/r${rep}`,
          resolved: !!row?.resolved,
          patch: rec.patch || '',
        });
      }
    }
  }
  return out;
}

const report = [];
for (const [taskId, runner] of Object.entries(TASKS)) {
  console.log(`\n${'='.repeat(78)}\n${taskId}`);
  const rows = [];
  const targets = [{ label: 'BASE (no patch)', resolved: null, patch: '' },
                   ...recordedPatches(taskId),
                   { label: 'GOLD (reference fix)', resolved: true, patch: specOf.get(taskId).patch }];
  for (const t of targets) {
    let dir;
    try {
      dir = materialise(taskId);
      const ap = applyPatch(dir, t.patch);
      const res = ap.applied ? runner(dir) : { verdict: 'ERROR', detail: 'patch did not apply: ' + ap.note };
      rows.push({ ...t, patch: undefined, ...res, apply: ap.note });
      console.log(`  ${res.verdict.padEnd(7)} ${t.label.padEnd(24)} resolved=${String(t.resolved).padEnd(5)} ${res.detail.slice(0, 150)}`);
    } catch (e) {
      rows.push({ ...t, patch: undefined, verdict: 'ERROR', detail: e.message });
      console.log(`  ERROR   ${t.label} — ${e.message}`);
    } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
  }
  report.push({ taskId, rows });
}

writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\n${'='.repeat(78)}\nFALSIFIER 1 SCORECARD\n`);
for (const { taskId, rows } of report) {
  const base = rows.find(r => r.label.startsWith('BASE'));
  const gold = rows.find(r => r.label.startsWith('GOLD'));
  const cells = rows.filter(r => !r.label.startsWith('BASE') && !r.label.startsWith('GOLD'));
  const wrong = cells.filter(r => !r.resolved);
  const right = cells.filter(r => r.resolved);
  console.log(`  ${taskId}`);
  console.log(`    rejects the unfixed base tree:  ${base?.verdict === 'REJECT' ? 'yes' : 'NO (' + base?.verdict + ')'}`);
  console.log(`    accepts the reference fix:      ${gold?.verdict === 'ACCEPT' ? 'yes' : 'NO (' + gold?.verdict + ')'}`);
  console.log(`    rejects every WRONG patch:      ${wrong.filter(r => r.verdict === 'REJECT').length}/${wrong.length}`);
  console.log(`    accepts patches that resolved:  ${right.filter(r => r.verdict === 'ACCEPT').length}/${right.length}`);
  const errs = rows.filter(r => r.verdict === 'ERROR');
  if (errs.length) console.log(`    could not be evaluated:         ${errs.length} (${errs.map(e => e.label).join(', ')})`);
}
console.log(`\nwrote ${OUT}`);
