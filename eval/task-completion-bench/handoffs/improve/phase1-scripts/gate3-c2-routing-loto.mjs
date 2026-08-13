// GATE 3 — C-2 "Selective Superset: native-first, sweet-on-demand".
// Bar (SLATE-A-UBER §5 C-2): "build a pre-edit feature table from retained traces, lock a
// simple rule, and evaluate leave-one-task-and-repo-out. Kill unless it beats native in BOTH
// task solve AND resolved reps on EVERY harness while remaining cheaper with sidechains
// included."
//
// TURN-0 router: the arm is chosen before the rollout, from issue text + repo topology only.
// Task identity is never a feature. Mid-rollout switching has no counterfactual in retained
// data, so it is not evaluated and not claimed.
//
// Cost: claude uses the REPAIRED sidechain-inclusive ideal (MID band, /tmp/rows-sidechain-
// repaired-sb.json); codex and opencode have no delegated transcripts, so main-only is
// already inclusive there.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const GOLDEN = '/root/.ss-eval/golden';
const TASKS = '/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_luna_rotate20.json';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811' };
const YARP = 'dotnet__yarp-2825';   // PHASE-0: grading gate fails gold 4/8 — carries no solve

const raw = JSON.parse(readFileSync(TASKS, 'utf8'));
const taskArr = Array.isArray(raw) ? raw : (raw.tasks || Object.values(raw)[0]);
// METADATA ONLY — `patch`, `test_patch`, FAIL_TO_PASS and PASS_TO_PASS are never read.
const META = new Map(taskArr.map(t => [t.instance_id,
  { repo: t.repo, base: t.base_commit, lang: t.language, statement: String(t.problem_statement || '') }]));

const goldenDirs = readdirSync(GOLDEN);
const statCache = new Map();
function repoStats(id) {
  if (statCache.has(id)) return statCache.get(id);
  const m = META.get(id);
  const hit = m && goldenDirs.find(d => d.endsWith(`@${m.base}`));
  let files = 0, bytes = 0, srcFiles = 0;
  if (hit) {
    const walk = (d, depth = 0) => {
      if (depth > 10) return;
      let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else { files++; if (/\.(js|ts|py|ex|dart|php|R|lua|swift|cs|ml|java|cpp|hpp|h|go|rb)$/.test(e.name)) srcFiles++;
          try { bytes += readFileSync(p).length; } catch { /* */ } }
      }
    };
    walk(path.join(GOLDEN, hit));
  }
  const v = { files, bytes, srcFiles };
  statCache.set(id, v);
  return v;
}

let sideMap = new Map();
try {
  const s = JSON.parse(readFileSync('/tmp/rows-sidechain-repaired-sb.json', 'utf8'));
  sideMap = new Map(s.map(r => [`${r.taskId}|${r.arm}|${r.rep}`, r]));
} catch { console.log('WARN: no repaired sidechain file; claude falls back to main-only'); }

const cells = [];
for (const [harness, run] of Object.entries(RUNS)) {
  for (const r of JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'))) {
    let cost = r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0;
    if (harness === 'claude') {
      const s = sideMap.get(`${r.taskId}|${r.arm}|${r.rep}`);
      if (s && s.inclusiveIdeal_mid != null) cost = s.inclusiveIdeal_mid;
    }
    cells.push({ harness, task: r.taskId, arm: r.arm, rep: r.rep, cost, resolved: !!r.resolved });
  }
}

// per (harness, task, arm): mean cost, resolved reps
const agg = new Map();
for (const c of cells) {
  const k = `${c.harness}|${c.task}|${c.arm}`;
  const a = agg.get(k) || { cost: 0, n: 0, res: 0 };
  a.cost += c.cost; a.n++; if (c.resolved) a.res++;
  agg.set(k, a);
}
const get = (h, t, a) => { const x = agg.get(`${h}|${t}|${a}`); return x ? { cost: x.cost / x.n, res: x.res, reps: x.n } : null; };
const TASKS_LIST = [...new Set(cells.map(c => c.task))].filter(t => t !== YARP).sort();

// ---- features (pre-run only) ----
function features(t) {
  const m = META.get(t) || { statement: '', lang: '' };
  const s = m.statement;
  const rs = repoStats(t);
  return {
    stmtChars: s.length,
    stmtLines: s.split('\n').length,
    hasCode: /```|    \S/.test(s) ? 1 : 0,
    hasLink: /https?:\/\//.test(s) ? 1 : 0,
    hasTrace: /Traceback|at .*\(.*:\d+\)|Exception|Error:/.test(s) ? 1 : 0,
    mentionsTest: /\btest|spec\b/i.test(s) ? 1 : 0,
    mentionsFile: /\.[a-z]{1,4}\b/.test(s) ? 1 : 0,
    isEmpty: s.trim().length === 0 ? 1 : 0,
    repoFiles: rs.files,
    repoSrcFiles: rs.srcFiles,
    repoMB: +(rs.bytes / 1e6).toFixed(2),
  };
}
const F = new Map(TASKS_LIST.map(t => [t, features(t)]));
const FEATS = Object.keys(F.get(TASKS_LIST[0]));

// ---- rule family: one feature, one threshold, one direction ----
// rule(t) -> 'sweet' | 'native'
function makeRule(feat, thr, dir) {
  return t => ((F.get(t)[feat] >= thr) === (dir === 1) ? 'sweet' : 'native');
}
function scoreArmChoice(h, t, arm) {
  const a = get(h, t, arm);
  return a ? { cost: a.cost, res: a.res, solved: a.res > 0 ? 1 : 0 } : { cost: 0, res: 0, solved: 0 };
}
// training objective: maximise resolved reps, then minimise cost, summed over the 3 harnesses
function trainScore(rule, tasks) {
  let res = 0, cost = 0;
  for (const h of Object.keys(RUNS)) for (const t of tasks) {
    const s = scoreArmChoice(h, t, rule(t)); res += s.res; cost += s.cost;
  }
  return { res, cost };
}
const candidates = [];
for (const f of FEATS) {
  const vals = [...new Set(TASKS_LIST.map(t => F.get(t)[f]))].sort((a, b) => a - b);
  for (const v of vals) for (const d of [1, -1]) candidates.push({ f, v, d, rule: makeRule(f, v, d) });
}
console.log(`tasks ${TASKS_LIST.length} (yarp held out) | features ${FEATS.length} | candidate rules ${candidates.length}`);

// ---- leave-one-task-and-repo-out ----
const picks = new Map();
for (const held of TASKS_LIST) {
  const train = TASKS_LIST.filter(t => t !== held);
  let best = null;
  for (const c of candidates) {
    const s = trainScore(c.rule, train);
    if (!best || s.res > best.s.res || (s.res === best.s.res && s.cost < best.s.cost)) best = { c, s };
  }
  picks.set(held, { arm: best.c.rule(held), rule: `${best.c.f}${best.c.d === 1 ? '>=' : '<'}${best.c.v}` });
}
console.log('\nLOTO picks:');
for (const t of TASKS_LIST) console.log(`  ${t.padEnd(44)} -> ${picks.get(t).arm.padEnd(6)}  (rule ${picks.get(t).rule})`);

console.log('\n=== C-2 gate result, per harness ===');
console.log('harness   | native cost  solve reps | sweet cost  solve reps | LOTO cost  solve reps | oracle cost solve reps');
let pass = true;
for (const h of Object.keys(RUNS)) {
  const acc = { native: { c: 0, s: 0, r: 0 }, sweet: { c: 0, s: 0, r: 0 }, loto: { c: 0, s: 0, r: 0 }, oracle: { c: 0, s: 0, r: 0 } };
  for (const t of TASKS_LIST) {
    for (const arm of ['native', 'sweet']) {
      const s = scoreArmChoice(h, t, arm); acc[arm].c += s.cost; acc[arm].s += s.solved; acc[arm].r += s.res;
    }
    const lp = scoreArmChoice(h, t, picks.get(t).arm);
    acc.loto.c += lp.cost; acc.loto.s += lp.solved; acc.loto.r += lp.res;
    const n = get(h, t, 'native'), w = get(h, t, 'sweet');
    const better = (w.res > n.res) || (w.res === n.res && w.cost < n.cost) ? 'sweet' : 'native';
    const op = scoreArmChoice(h, t, better);
    acc.oracle.c += op.cost; acc.oracle.s += op.solved; acc.oracle.r += op.res;
  }
  const f = a => `$${a.c.toFixed(6)} ${String(a.s).padStart(2)}/${TASKS_LIST.length} ${String(a.r).padStart(2)}`;
  console.log(`${h.padEnd(9)} | ${f(acc.native)} | ${f(acc.sweet)} | ${f(acc.loto)} | ${f(acc.oracle)}`);
  const beatsSolve = acc.loto.s > acc.native.s && acc.loto.r > acc.native.r;
  const cheaper = acc.loto.c < acc.native.c;
  console.log(`          -> LOTO vs native: solve ${acc.loto.s}>${acc.native.s}? ${acc.loto.s > acc.native.s} | reps ${acc.loto.r}>${acc.native.r}? ${acc.loto.r > acc.native.r} | cost ${((acc.loto.c / acc.native.c - 1) * 100).toFixed(1)}% ${cheaper ? '(cheaper)' : '(NOT cheaper)'}  => ${beatsSolve && cheaper ? 'PASS' : 'FAIL'}`);
  if (!(beatsSolve && cheaper)) pass = false;
}
console.log(`\nC-2 GATE: ${pass ? 'PASS' : 'FAIL'} (needs strictly more task solves AND more resolved reps than native on EVERY harness, while cheaper)`);

// ---------------------------------------------------------------------------
// Robustness: a richer rule family and per-harness rule selection. If the kill
// survives a more expressive router, it is not an artefact of the rule family.
// ---------------------------------------------------------------------------
const pairRules = [];
for (let i = 0; i < FEATS.length; i++) for (let j = i + 1; j < FEATS.length; j++) {
  const fi = FEATS[i], fj = FEATS[j];
  const vi = [...new Set(TASKS_LIST.map(t => F.get(t)[fi]))].sort((a, b) => a - b);
  const vj = [...new Set(TASKS_LIST.map(t => F.get(t)[fj]))].sort((a, b) => a - b);
  for (const a of vi) for (const b of vj) for (const da of [1, -1]) for (const db of [1, -1]) {
    pairRules.push({ label: `${fi}${da === 1 ? '>=' : '<'}${a} AND ${fj}${db === 1 ? '>=' : '<'}${b}`,
      rule: t => (((F.get(t)[fi] >= a) === (da === 1)) && ((F.get(t)[fj] >= b) === (db === 1))) ? 'sweet' : 'native' });
  }
}
const richFamily = candidates.map(c => ({ label: `${c.f}${c.d === 1 ? '>=' : '<'}${c.v}`, rule: c.rule })).concat(pairRules);
console.log(`\n=== robustness: per-harness rules, family size ${richFamily.length} ===`);
let anyPass = false;
for (const h of Object.keys(RUNS)) {
  const acc = { native: { c: 0, s: 0, r: 0 }, loto: { c: 0, s: 0, r: 0 } };
  const used = new Map();
  for (const held of TASKS_LIST) {
    const train = TASKS_LIST.filter(t => t !== held);
    let best = null;
    for (const c of richFamily) {
      let res = 0, cost = 0;
      for (const t of train) { const s = scoreArmChoice(h, t, c.rule(t)); res += s.res; cost += s.cost; }
      if (!best || res > best.res || (res === best.res && cost < best.cost)) best = { c, res, cost };
    }
    used.set(held, best.c.label);
    const s = scoreArmChoice(h, held, best.c.rule(held));
    acc.loto.c += s.cost; acc.loto.s += s.solved; acc.loto.r += s.res;
    const n = scoreArmChoice(h, held, 'native');
    acc.native.c += n.cost; acc.native.s += n.solved; acc.native.r += n.res;
  }
  const ok = acc.loto.s > acc.native.s && acc.loto.r > acc.native.r && acc.loto.c < acc.native.c;
  if (ok) anyPass = true;
  console.log(`${h.padEnd(9)} native $${acc.native.c.toFixed(6)} ${acc.native.s}/${TASKS_LIST.length} reps ${acc.native.r}  ->  LOTO $${acc.loto.c.toFixed(6)} ${acc.loto.s}/${TASKS_LIST.length} reps ${acc.loto.r}  (${((acc.loto.c / acc.native.c - 1) * 100).toFixed(1)}%)  ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(`richer family verdict: ${anyPass ? 'at least one harness passes' : 'FAIL on every harness'}`);
