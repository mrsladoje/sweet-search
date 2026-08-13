#!/usr/bin/env node
/**
 * pick-newmodule-slate — choose a blind rotation slate for the obligation-graph gate.
 *
 * WHY THIS EXISTS. The gate asks whether the required *shape* of a change can be derived
 * from an issue and a base tree — including work that authors code which does not exist yet.
 * Testing that needs at least one task whose accepted patch adds a new source module. But
 * knowing which tasks those are requires reading gold, and reading gold is exactly what the
 * deriving session must not do.
 *
 * So the roles are split. THIS SCRIPT IS CONTAMINATED BY DESIGN: it reads gold, classifies,
 * and writes two files.
 *
 *   round2/SLATE-PUBLIC.json    instance_id, repo, base_commit, language. Safe for the deriver.
 *   picker/SEALED-labels.json   the classification and the reason. NOT safe. Opened only at reveal.
 *
 * The public slate is a MIXTURE — some tasks add new source modules and some do not, in a
 * seeded shuffle. That matters: a slate where every task adds a module would tell the deriver
 * the answer just by existing. The mixture is why the deriver can be handed a list at all.
 *
 * Usage:  node pick-newmodule-slate.mjs [--n-with 2] [--n-without 2] [--seed 20260813]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE, '..', '..', '..');           // eval/task-completion-bench
const DEV_RET = join(BENCH, 'select', '.cache', 'tasks_full_heldout.json');
const ROTATE20 = join(BENCH, 'select', 'tasks_luna_rotate20.json');

// Tasks already burned as rotation subjects, or contaminated by being discussed in
// handoffs/improve/. rotate20 is excluded wholesale by file below.
const ALREADY_USED = new Set([
  'holoviews__holoviews-6534',
  'pennylaneai__pennylane-3651',
]);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

// ---------------------------------------------------------------- diff parsing

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|scala|rb|php|swift|c|h|cc|cpp|hpp|cs|ex|exs|dart|clj|jl|m|mm|r|sh)$/i;

// A path is NOT a source module if it is a test, a fixture, a doc, or build/config noise.
const NON_SOURCE = new RegExp([
  '(^|/)(tests?|spec|specs|__tests__|__mocks__|testdata|fixtures?|examples?|samples?)(/|$)',
  '(^|/)(docs?|documentation|website|site)(/|$)',
  '[._-](test|spec)\\.[a-z]+$',
  '^test_|_test\\.[a-z]+$',
  '(^|/)(CHANGELOG|README|LICENSE|NOTICE)',
  '\\.(md|rst|txt|json|ya?ml|toml|lock|cfg|ini|xml|snap)$',
].join('|'), 'i');

/** Every path the patch CREATES (as opposed to modifies or deletes). */
export function createdPaths(patch) {
  const out = [];
  const lines = String(patch || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('diff --git ')) continue;
    // look ahead within this file's header for a `new file mode` marker
    let isNew = false, plusPath = null;
    for (let j = i + 1; j < lines.length && !lines[j].startsWith('diff --git '); j++) {
      if (lines[j].startsWith('new file mode')) isNew = true;
      if (lines[j].startsWith('+++ ')) {
        plusPath = lines[j].slice(4).trim().replace(/^b\//, '');
        break;
      }
      if (lines[j].startsWith('@@')) break;
    }
    if (isNew && plusPath && plusPath !== '/dev/null') out.push(plusPath);
  }
  return out;
}

/** Created paths that are genuine source modules, not tests/docs/config. */
export function newSourceModules(patch) {
  return createdPaths(patch).filter(p => SOURCE_EXT.test(p) && !NON_SOURCE.test(p));
}

/** Rough count of distinct existing files the patch modifies — used only to avoid extremes. */
function modifiedFileCount(patch) {
  return new Set(String(patch || '').split('\n')
    .filter(l => l.startsWith('diff --git '))
    .map(l => l.split(' ').pop())).size;
}

// ---------------------------------------------------------------- deterministic shuffle

// mulberry32 — seeded so a rerun with the same seed reproduces the slate exactly.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, rand) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ---------------------------------------------------------------- main

function main() {
  const nWith = parseInt(arg('n-with', '2'), 10);
  const nWithout = parseInt(arg('n-without', '2'), 10);
  const seed = parseInt(arg('seed', '20260813'), 10);

  const pool = JSON.parse(readFileSync(DEV_RET, 'utf8'));
  const tasks = Array.isArray(pool) ? pool : Object.values(pool)[0];

  const rot = JSON.parse(readFileSync(ROTATE20, 'utf8'));
  const rotIds = new Set((Array.isArray(rot) ? rot : Object.values(rot)[0]).map(t => t.instance_id));

  const excluded = { rotate20: 0, alreadyUsed: 0, emptyIssue: 0, noPatch: 0, extreme: 0 };
  const eligible = [];

  for (const t of tasks) {
    if (rotIds.has(t.instance_id)) { excluded.rotate20++; continue; }
    if (ALREADY_USED.has(t.instance_id)) { excluded.alreadyUsed++; continue; }
    if (!t.problem_statement || t.problem_statement.trim().length < 200) { excluded.emptyIssue++; continue; }
    if (!t.patch || t.patch.length < 50) { excluded.noPatch++; continue; }
    const mods = modifiedFileCount(t.patch);
    if (mods > 25) { excluded.extreme++; continue; }   // sprawling refactors are a different test
    eligible.push(t);
  }

  const withNew = [], withoutNew = [];
  for (const t of eligible) {
    const mods = newSourceModules(t.patch);
    (mods.length > 0 ? withNew : withoutNew).push({ t, mods });
  }

  const rand = rng(seed);
  const pickW = shuffle(withNew, rand).slice(0, nWith);
  const pickO = shuffle(withoutNew, rand).slice(0, nWithout);
  const slate = shuffle([...pickW, ...pickO], rand);

  const pub = slate.map(({ t }) => ({
    instance_id: t.instance_id,
    repo: t.repo,
    base_commit: t.base_commit,
    language: t.language,
  }));

  const sealed = {
    WARNING: 'SEALED. Contains the answer to the blinded gate. Open only after every lock file is hashed.',
    seed, generated_from: 'select/.cache/tasks_full_heldout.json (DEV-RET)',
    pool_size: tasks.length, eligible: eligible.length, excluded,
    class_counts: { adds_new_source_module: withNew.length, does_not: withoutNew.length },
    labels: slate.map(({ t, mods }) => ({
      instance_id: t.instance_id,
      adds_new_source_module: mods.length > 0,
      new_source_modules: mods,
      created_paths_all: createdPaths(t.patch),
      modified_file_count: modifiedFileCount(t.patch),
    })),
  };

  const outPub = join(HERE, '..', 'round2', 'SLATE-PUBLIC.json');
  mkdirSync(dirname(outPub), { recursive: true });
  writeFileSync(outPub, JSON.stringify(pub, null, 2) + '\n');
  writeFileSync(join(HERE, 'SEALED-labels.json'), JSON.stringify(sealed, null, 2) + '\n');

  // The issue text lives in the same file as gold, so the deriver must never open that file.
  // Extract the statements alone into the clean zone.
  const issues = slate.map(({ t }) => ({
    instance_id: t.instance_id,
    repo: t.repo,
    base_commit: t.base_commit,
    language: t.language,
    problem_statement: t.problem_statement,
  }));
  writeFileSync(join(HERE, '..', 'round2', 'ISSUES.json'), JSON.stringify(issues, null, 2) + '\n');

  // Console output must stay safe: counts only, never which task is in which class.
  console.log(`pool ${tasks.length} → eligible ${eligible.length}`);
  console.log(`excluded: ${JSON.stringify(excluded)}`);
  console.log(`classes: adds-new-module ${withNew.length}, does-not ${withoutNew.length}`);
  console.log(`slate: ${pub.length} tasks (${nWith} + ${nWithout}, shuffled, seed ${seed})`);
  console.log(`wrote round2/SLATE-PUBLIC.json  and  picker/SEALED-labels.json`);
}

if (process.argv[1] && process.argv[1].endsWith('pick-newmodule-slate.mjs')) main();
