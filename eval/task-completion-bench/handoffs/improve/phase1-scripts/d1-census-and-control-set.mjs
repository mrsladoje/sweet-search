// DOCTRINE §2 — the $0 pre-flight census, and §5's fixed control set.
// Read-only over rows.json. Scores from `resolved` ONLY (report.json is not authoritative).
// No model is invoked. Writes nothing outside /tmp.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = [
  ['sb-codex-20260811', 'codex'],
  ['sb-opencode-20260811', 'opencode'],
  ['sb-claudecode-20260811', 'claude'],
  ['screen-v3-20260812', 'claude-screen-v3'],
];

const load = r => {
  const j = JSON.parse(readFileSync(path.join(RESULTS, r, 'rows.json'), 'utf8'));
  return Array.isArray(j) ? j : (j.rows || []);
};

console.log('=== ROLLOUT CENSUS (denominator for every tier judgement) ===\n');
let sbTotal = 0, allTotal = 0;
const all = new Map();
for (const [run, h] of RUNS) {
  const rows = load(run);
  all.set(run, rows);
  const arms = {};
  for (const r of rows) arms[r.arm] = (arms[r.arm] || 0) + 1;
  const tasks = new Set(rows.map(r => r.taskId)).size;
  const reps = new Set(rows.map(r => r.rep)).size;
  console.log(`${run.padEnd(24)} harness=${h.padEnd(17)} rollouts=${String(rows.length).padStart(3)}  tasks=${tasks}  reps=${reps}  ${JSON.stringify(arms)}`);
  allTotal += rows.length;
  if (run.startsWith('sb-')) sbTotal += rows.length;
}
console.log(`\n  three matched sb-* runs : ${sbTotal} rollouts   <- the "204" the doctrine cites`);
console.log(`  including screen-v3     : ${allTotal} rollouts`);

// ---------------------------------------------------------------------------
// §5 control set: tasks that resolve 2 of 2 reps. Per harness, per arm.
// ---------------------------------------------------------------------------
console.log('\n\n=== CONTROL SET (doctrine §5) — tasks resolving 2 of 2 reps ===\n');

const controlByRun = {};
for (const [run, h] of RUNS) {
  const rows = all.get(run);
  const byTaskArm = new Map();
  for (const r of rows) {
    const k = `${r.taskId}|${r.arm}`;
    if (!byTaskArm.has(k)) byTaskArm.set(k, []);
    byTaskArm.get(k).push(r.resolved === true);
  }
  const stat = arm => {
    const solid = [], flip = [], never = [];
    for (const [k, v] of byTaskArm) {
      if (!k.endsWith('|' + arm)) continue;
      const task = k.split('|')[0];
      const n = v.filter(Boolean).length;
      if (n === v.length && v.length >= 2) solid.push(task);
      else if (n > 0) flip.push(task);
      else never.push(task);
    }
    return { solid: solid.sort(), flip: flip.sort(), never: never.sort() };
  };
  const s = stat('sweet'), n = stat('native');
  controlByRun[run] = { harness: h, sweet: s, native: n };
  const resolvedReps = arm => rows.filter(r => r.arm === arm && r.resolved === true).length;
  const totalReps = arm => rows.filter(r => r.arm === arm).length;
  console.log(`-- ${run} (${h}) --`);
  console.log(`   resolved-rep rate   sweet ${resolvedReps('sweet')}/${totalReps('sweet')}   native ${resolvedReps('native')}/${totalReps('native')}`);
  console.log(`   sweet   2/2 = ${String(s.solid.length).padStart(2)}   1/2 = ${String(s.flip.length).padStart(2)}   0/2 = ${String(s.never.length).padStart(2)}`);
  console.log(`   native  2/2 = ${String(n.solid.length).padStart(2)}   1/2 = ${String(n.flip.length).padStart(2)}   0/2 = ${String(n.never.length).padStart(2)}`);
  console.log(`   sweet CONTROL: ${s.solid.join(', ') || '(none)'}`);
  console.log(`   sweet UNSTABLE (invisible to a non-inferiority check): ${s.flip.join(', ') || '(none)'}\n`);
}

// The portable control set: solid in the sweet arm on ALL THREE matched sb-* harnesses.
const three = ['sb-codex-20260811', 'sb-opencode-20260811', 'sb-claudecode-20260811'];
const inter = three
  .map(r => new Set(controlByRun[r].sweet.solid))
  .reduce((a, b) => new Set([...a].filter(x => b.has(x))));
const union = new Set(three.flatMap(r => controlByRun[r].sweet.solid));
console.log('=== THE FIXED CONTROL SET ===\n');
console.log(`Cross-harness core (sweet 2/2 on ALL of codex, opencode, claude) — ${inter.size} tasks:`);
for (const t of [...inter].sort()) console.log(`   ${t}`);
console.log(`\nUnion (sweet 2/2 on at least one harness) — ${union.size} tasks`);

// Also: does any control task solve 2/2 in BOTH arms? Those are the strongest controls,
// because a regression cannot be blamed on arm-specific instability.
const bothArms = [...inter].filter(t =>
  three.every(r => controlByRun[r].native.solid.includes(t)));
console.log(`\nStrongest controls (2/2 in BOTH arms on all three harnesses) — ${bothArms.length} tasks:`);
for (const t of bothArms.sort()) console.log(`   ${t}`);

writeFileSync('/tmp/doctrine-control-set.json',
  JSON.stringify({ controlByRun, crossHarnessCore: [...inter].sort(), bothArms: bothArms.sort() }, null, 2));
console.log('\nwrote /tmp/doctrine-control-set.json');
