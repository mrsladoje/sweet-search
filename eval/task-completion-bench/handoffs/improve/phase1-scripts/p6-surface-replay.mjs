#!/usr/bin/env node
// W0 gate — P6's $0 falsifier: replay the behavioural certificate against every recorded
// CodeceptJS patch. Executes W0-P6-PREREGISTRATION.md, committed before this file existed.
//
// Trees are materialized with `git archive` into a temp dir and deleted; the goldens are
// never written to. The gold patch is applied ONLY as the final target, to confirm the
// certificate is satisfiable — the same use the P3 gate made of it.
//
// No agent, no grading, no model spend.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const GOLDEN = process.env.GOLDEN || '/root/.ss-eval/golden';
const SCRIPTS = process.env.SCRIPTS || path.join(BENCH, 'handoffs/improve/phase1-scripts');
const RUNS = (process.env.RUNS || 'sb-codex-20260811,sb-opencode-20260811,sb-claudecode-20260811').split(',');
const TASK = 'codeception__codeceptjs-367';
const OUT = process.env.OUT || '/root/w0-p6-certificate.json';

const specs = JSON.parse(readFileSync(path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json'), 'utf8'));
const spec = specs.find(t => t.instance_id === TASK);
if (!spec) { console.error(`no spec for ${TASK}`); process.exit(2); }
const sh = (cmd, opts = {}) => execFileSync('sh', ['-c', cmd], { encoding: 'utf8', timeout: 300000, ...opts });

function materialise() {
  const g = path.join(GOLDEN, spec.repo.replace('/', '__') + '@' + spec.base_commit);
  if (!existsSync(g)) throw new Error(`no golden checkout for ${TASK}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'p6-'));
  sh(`git -C ${JSON.stringify(g)} archive HEAD | tar -x -C ${JSON.stringify(dir)}`, { stdio: 'ignore' });
  return dir;
}
function applyPatch(dir, patch) {
  if (!patch || !patch.trim()) return { applied: true, note: 'empty patch' };
  writeFileSync(path.join(dir, '.p6.patch'), patch.endsWith('\n') ? patch : patch + '\n');
  for (const p of ['-p1', '-p0']) {
    try { sh(`cd ${JSON.stringify(dir)} && git apply ${p} .p6.patch`, { stdio: 'pipe' }); return { applied: true, note: `git apply ${p}` }; }
    catch { /* next */ }
  }
  try { sh(`cd ${JSON.stringify(dir)} && patch -p1 --batch --forward < .p6.patch`, { stdio: 'pipe' }); return { applied: true, note: 'patch -p1' }; }
  catch (e) { return { applied: false, note: String(e.message).slice(0, 160) }; }
}

/** The two colour-only modules the 2016 tree imports, stubbed — no network, no resolution. */
function stubDeps(dir) {
  mkdirSync(path.join(dir, 'node_modules/chalk'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules/chalk/package.json'), '{"name":"chalk","version":"0.0.0-p6-stub","main":"index.js"}');
  writeFileSync(path.join(dir, 'node_modules/chalk/index.js'), 'const id=(s)=>s;const mk=()=>new Proxy(id,{get:()=>mk()});module.exports=mk();\n');
  mkdirSync(path.join(dir, 'node_modules/mocha/lib/reporters'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules/mocha/package.json'), '{"name":"mocha","version":"0.0.0-p6-stub","main":"index.js"}');
  writeFileSync(path.join(dir, 'node_modules/mocha/index.js'), 'module.exports={};\n');
  writeFileSync(path.join(dir, 'node_modules/mocha/lib/reporters/base.js'),
    'module.exports={symbols:{ok:"ok",err:"err",dot:".",comma:",",bang:"!"},color:(t,s)=>s,useColors:false};\n');
}

function certify(dir) {
  stubDeps(dir);
  cpSync(path.join(SCRIPTS, 'p6-surface-certificate.js'), path.join(dir, 'p6_cert.js'));
  let raw = '';
  try { raw = sh(`cd ${JSON.stringify(dir)} && REPO=${JSON.stringify(dir)} timeout 120 node p6_cert.js 2>&1`, { stdio: 'pipe' }); }
  catch (e) { raw = String(e.stdout || '') + String(e.stderr || ''); }
  const m = raw.match(/@@P6CERT@@(.*)/);
  if (!m) return { ok: false, error: raw.slice(-400) };
  try { return JSON.parse(m[1]); } catch { return { ok: false, error: 'unparseable certificate' }; }
}

function recordedPatches() {
  const out = [];
  for (const run of RUNS) {
    for (const [rep, sub] of [[0, ''], [1, 'rep-1/']]) {
      for (const arm of ['native', 'sweet']) {
        const f = path.join(RESULTS, run, arm, sub + 'patches.json');
        if (!existsSync(f)) continue;
        const rec = Object.values(JSON.parse(readFileSync(f, 'utf8'))).find(r => r.instance_id === TASK);
        if (!rec) continue;
        const rowsRaw = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
        const list = Array.isArray(rowsRaw) ? rowsRaw : rowsRaw.rows;
        const row = list.find(x => x.taskId === TASK && x.arm === arm && x.rep === rep);
        out.push({ label: `${run.split('-')[1]}/${arm}/r${rep}`, resolved: !!row?.resolved, patch: rec.patch || '' });
      }
    }
  }
  return out;
}

// ---- P6-4 KILL CHECK: is the public name derivable without grader-only facts? ----
function derivability() {
  const dir = materialise();
  try {
    // Where does the name occur in the BASE tree, excluding tests?
    let hits = '';
    try { hits = sh(`cd ${JSON.stringify(dir)} && grep -rn "\\bsay\\b" --include=*.js lib bin docs 2>/dev/null | head -40`, { stdio: 'pipe' }); }
    catch { hits = ''; }
    const lines = hits.trim().split('\n').filter(Boolean);
    const inGold = /(^|\n)\+.*\bsay\b/.test(String(spec.patch || ''));
    return {
      baseOccurrences: lines.length,
      baseSamples: lines.slice(0, 8),
      publicOutputPrimitive: lines.some(l => /lib\/output\.js/.test(l)),
      alsoIntroducedByGold: inGold,
    };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const targets = [
  { label: 'BASE (no patch)', resolved: null, patch: '' },
  ...recordedPatches(),
  { label: 'GOLD (reference fix)', resolved: true, patch: spec.patch },
];

const rows = [];
for (const t of targets) {
  let dir;
  try {
    dir = materialise();
    const ap = applyPatch(dir, t.patch);
    const cert = ap.applied ? certify(dir) : { ok: false, error: 'patch did not apply: ' + ap.note };
    rows.push({ label: t.label, resolved: t.resolved, apply: ap.note, cert });
  } catch (e) {
    rows.push({ label: t.label, resolved: t.resolved, apply: 'error', cert: { ok: false, error: e.message } });
  } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
}

// ---- the certificate's own verdict, from the certificate alone ----
// `say` on the actor, enumerable, deferred into the recorder, silent at call time.
function surfaceVerdict(cert) {
  if (!cert || !cert.ok) return { verdict: 'ERROR', why: (cert && cert.error || '').slice(0, 120) };
  const s = cert.perName.say || {};
  if (!s.present) return { verdict: 'FAIL', why: 'say is not on the actor at all' };
  if (s.enumerable !== true) return { verdict: 'FAIL', why: 'say is on the actor but NOT enumerable' };
  if (s.deferred !== true) return { verdict: 'FAIL', why: 'say does not queue into the recorder' };
  if (s.immediateBytes > 0) return { verdict: 'FAIL', why: `say printed ${s.immediateBytes} bytes at call time instead of deferring` };
  return { verdict: 'PASS', why: 'say: on the actor, enumerable, queued, silent at call time' };
}

const w = (s, n) => String(s).padEnd(n);
console.log(`${'='.repeat(96)}\nP6 BEHAVIOURAL CERTIFICATE — ${TASK}\n`);
console.log(w('target', 26) + w('resolved', 10) + w('surface', 9) + 'say / comment / remark  (present · enumerable · deferred · bytes-at-call)');
for (const r of rows) {
  const v = surfaceVerdict(r.cert);
  const fmt = (n) => {
    const x = r.cert && r.cert.perName && r.cert.perName[n];
    if (!x) return `${n}=?`;
    if (!x.present) return `${n}=absent`;
    return `${n}=[enum:${x.enumerable} defer:${x.deferred} bytes:${x.immediateBytes}]`;
  };
  console.log(w(r.label, 26) + w(String(r.resolved), 10) + w(v.verdict, 9)
    + (r.cert && r.cert.ok ? ['say', 'comment', 'remark'].map(fmt).join('  ') : `ERROR ${v.why}`));
  r.surface = v;
}

const cells = rows.filter(r => !/^BASE|^GOLD/.test(r.label));
const base = rows.find(r => r.label.startsWith('BASE'));
const gold = rows.find(r => r.label.startsWith('GOLD'));

console.log(`\n${'-'.repeat(96)}\nPRE-REGISTERED PREDICTIONS\n`);
// P6-1: at least one recorded patch installs the aliases NON-enumerably, and the certificate
// reports present && !enumerable.
const nonEnum = cells.filter(r => r.cert?.ok && ['say', 'comment', 'remark']
  .some(n => r.cert.perName[n]?.present && r.cert.perName[n]?.enumerable === false));
console.log(`P6-1 non-enumerable aliases observed as present-but-not-enumerable : ${nonEnum.length} cell(s)`);
for (const r of nonEnum) console.log(`       ${r.label} resolved=${r.resolved}`);
// P6-2: a patch that put `comment` on the Helper BASE class leaves it absent from the actor.
const helperOnly = cells.filter(r => r.cert?.ok && r.cert.perName.comment?.present === false
  && /class Helper|lib\/helper\.js/.test('') === false);
const commentAbsent = cells.filter(r => r.cert?.ok && r.cert.perName.comment?.present === false);
console.log(`P6-2 comment absent from the actor                                 : ${commentAbsent.length}/${cells.filter(r => r.cert?.ok).length} evaluable cell(s)`);
// P6-3: gold is enumerable + queued + silent.
console.log(`P6-3 the reference fix passes the surface check                    : ${gold?.surface?.verdict === 'PASS' ? 'YES' : 'NO — ' + (gold?.surface?.why || '?')}`);
console.log(`     the unfixed base tree fails it                               : ${base?.surface?.verdict !== 'PASS' ? 'YES' : 'NO — base already passes, the check is vacuous'}`);
// P6-4: agreement with the grader.
const evaluable = cells.filter(r => r.surface.verdict !== 'ERROR');
const agree = evaluable.filter(r => (r.surface.verdict === 'PASS') === !!r.resolved);
console.log(`P6-4 certificate agrees with the grader                           : ${agree.length}/${evaluable.length} evaluable cell(s)`);
for (const r of evaluable.filter(x => (x.surface.verdict === 'PASS') !== !!x.resolved)) {
  console.log(`       DISAGREES ${w(r.label, 24)} surface=${r.surface.verdict} resolved=${r.resolved} — ${r.surface.why}`);
}

console.log(`\n${'-'.repeat(96)}\nKILL CONDITION — can the public name be derived without grader-only facts?\n`);
const d = derivability();
console.log(`  occurrences of "say" in the BASE tree (lib/bin/docs, no tests)  : ${d.baseOccurrences}`);
console.log(`  present as a public output primitive in lib/output.js           : ${d.publicOutputPrimitive}`);
for (const s of d.baseSamples) console.log(`      ${s.slice(0, 110)}`);
console.log(`\n  KILL FIRES: ${d.baseOccurrences === 0 ? 'YES — the name exists only in gold' : 'no — the name is in the base tree'}`);

writeFileSync(OUT, JSON.stringify({ task: TASK, rows: rows.map(r => ({ ...r, cert: r.cert })), derivability: d }, null, 2));
console.log(`\nwrote ${OUT}`);
