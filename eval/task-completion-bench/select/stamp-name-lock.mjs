#!/usr/bin/env node
// RECRUITMENT STEP — measure the name-lock census over a task pool and STAMP each record.
//
// WHY THIS RUNS HERE AND NOT IN run-pilot. Deciding that an identifier was "invented" needs
// three things a run-time gate must not have: the reference patch, the hidden test patch, and
// a materialized base tree. All three are legitimately in scope at recruitment, before the
// seeded draw. So the measurement happens once, here, and writes a `name_locked` boolean into
// the record. Everything downstream — select/task_gates.py and harness/task-gates.mjs — reads
// that boolean, which keeps those gates metadata-only and outcome-blind like the other rules.
//
// UNSTAMPED IS NOT CLEAN. A task whose base tree is not materialized is reported as `missing`
// and is left unstamped, and both gates treat an absent field as not-yet-measured rather than
// as a pass. Silently stamping `false` for a checkout we could not read would be the exact
// shape of error this whole programme exists to avoid.
//
// Usage:
//   node stamp-name-lock.mjs --tasks <full-specs.json> [--golden <dir>] [--out <file>] [--report-only]
//
// Model spend: $0. It reads files.
import { readFileSync, writeFileSync } from 'node:fs';
import { nameLockCensus, goldenDirFor, nameLockFor, baseVocabulary } from './name-lock.mjs';
import { existsSync } from 'node:fs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const tasksPath = arg('tasks');
if (!tasksPath) { console.error('usage: node stamp-name-lock.mjs --tasks <file> [--golden <dir>] [--out <file>] [--report-only]'); process.exit(2); }
const goldenRoot = arg('golden', process.env.GOLDEN || '/root/.ss-eval/golden');
const outPath = arg('out', tasksPath);

const tasks = JSON.parse(readFileSync(tasksPath, 'utf8'));
const census = nameLockCensus(tasks, goldenRoot);

const w = (s, n) => String(s).padEnd(n);
console.log(w('task', 46) + w('lang', 10) + w('locked', 8) + 'identifiers the hidden test needs and the base tree never mentions');
for (const r of census.rows) {
  if (r.missing) { console.log(w(r.id, 46) + w(r.lang || '', 10) + w('?', 8) + 'base tree not materialized — NOT stamped'); continue; }
  console.log(w(r.id, 46) + w(r.lang || '', 10) + w(r.nameLocked ? 'YES' : '-', 8) + r.locked.slice(0, 8).join(' '));
}

console.log(`\ntasks in pool                          ${census.rows.length}`);
console.log(`examined (base tree available)         ${census.examined}`);
console.log(`NOT examined (unstamped, not clean)    ${census.missing}`);
const pct = census.examined ? ((100 * census.locked) / census.examined).toFixed(1) : '0.0';
console.log(`name-locked (naming lotteries)         ${census.locked}  (${pct}% of examined)`);
if (census.locked) {
  console.log('\nthese tasks measure a coin flip. No analyzer, index, ranking change or certificate');
  console.log('can win them, and their contribution to any ceiling arithmetic is fiction:');
  for (const r of census.rows.filter(x => !x.missing && x.nameLocked)) {
    console.log(`  ${w(r.id, 44)} ${r.locked.slice(0, 6).join(' ')}${r.relImports.length ? `   [module path too: ${r.relImports.join(' ')}]` : ''}`);
  }
}

if (flag('report-only')) process.exit(0);

const byId = new Map(census.rows.map(r => [r.id, r]));
let stamped = 0;
for (const t of tasks) {
  const r = byId.get(t.instance_id);
  if (!r || r.missing) continue;                       // absent checkout => leave unstamped
  t.name_locked = r.nameLocked;
  t.name_locked_identifiers = r.locked;
  stamped++;
}
writeFileSync(outPath, JSON.stringify(tasks, null, 1));
console.log(`\nstamped ${stamped}/${tasks.length} records → ${outPath}`);
console.log(`${census.missing} left unstamped; the selection gate treats those as not-yet-measured, never clean.`);
