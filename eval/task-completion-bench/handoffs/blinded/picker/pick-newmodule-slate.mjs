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
 *                                       [--round round2] [--force]
 *
 * ROUND SAFETY (added 2026-08-13, round 3). A rerun used to overwrite `round2/SLATE-PUBLIC.json`
 * and `picker/SEALED-labels.json` in place, which would destroy the audit trail of how an
 * already-scored round was drawn. Two guards now:
 *   --round <dir>  writes the public slate into blinded/<dir>/ and seals labels to
 *                  picker/SEALED-labels-<dir>.json (round2 keeps its historical filename);
 *   refuse to clobber an existing SLATE-PUBLIC.json unless --force is passed.
 * Every task drawn in ANY previous round is excluded automatically by reading the public
 * slates that already exist, so a new round can never re-draw a burned task.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE, '..', '..', '..');           // eval/task-completion-bench
const DEV_RET = join(BENCH, 'select', '.cache', 'tasks_full_heldout.json');
const ROTATE20 = join(BENCH, 'select', 'tasks_luna_rotate20.json');
const BLINDED = join(HERE, '..');

// Round 1's subjects, which predate the public-slate file. Later rounds are picked up
// automatically from their SLATE-PUBLIC.json — see previouslyDrawn().
const ALREADY_USED = new Set([
  'holoviews__holoviews-6534',
  'pennylaneai__pennylane-3651',
]);

// BURNED BY ANOTHER PROGRAMME (found 2026-08-13 by the round-3 leak sweep, and the fourth
// blinding channel this project has found). Excluding rotate20 and the previous obligation
// rounds is not enough: 98 of the 200 development-pool tasks were also run as turnfix cohort
// subjects, so rollouts, trajectories, analysis documents and memory files exist that name what
// their fix was. The first round-3 draw put three of them on the slate. A task any planning
// document discusses was already out of scope; this is the file that says which those are.
const TURNFIX_MANIFEST = join(BENCH, 'select', 'MANIFEST_turnfix_cohorts.json');

// NO BASE TREE, NO GATE. A task whose base commit cannot be checked out cannot be derived
// against. Worse, `golden-build.mjs` does not check that its `git checkout <sha>` succeeded, so
// an unreachable base commit silently yields a golden holding the DEFAULT BRANCH — a post-fix
// tree that would hand a blinded gate its own answer. Verified cases are recorded in this file.
const UNMATERIALISABLE = join(HERE, 'UNMATERIALISABLE.json');

// DISCUSSED IN A PROSE DOCUMENT (found 2026-08-13, one draw after the turnfix channel). A
// forensics write-up named a slate task AND the exact new packages its hidden test imports —
// which is the very obligation this gate asks the deriver to predict. "Every task any planning
// document discusses" was already out of scope; this is the scan that finds them.
//
// Bare INVENTORY files are not discussion: `run-history-instance-ids.txt` lists every id ever
// run and `HELDOUT2_EXCLUDED_REPOS.json` lists the whole pool, so counting them would exclude
// all 200 tasks and leak nothing about any of them. Prose is the discriminating signal.
const DOC_ROOT = BENCH;
const INVENTORY_ONLY = /run-history-instance-ids\.txt$|HELDOUT2_EXCLUDED_REPOS\.json$|MANIFEST[^/]*\.json$|SLATE-PUBLIC\.json$|ISSUES\.json$|SEALED-labels[^/]*\.json$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'results', '.index-cache', '.venv-grade', '.agentic-qe', '.cache', 'env', 'tasks', 'corpus', 'repos', 'round3']);

/** instance_id -> [documents that discuss it in prose] */
function discussedInDocs(ids) {
  const out = new Map();
  const walk = (dir) => {
    let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name)); continue; }
      if (!/\.(md|txt)$/i.test(e.name)) continue;
      const p = join(dir, e.name);
      if (INVENTORY_ONLY.test(p)) continue;
      let txt; try { txt = readFileSync(p, 'utf8'); } catch { continue; }
      for (const id of ids) if (txt.includes(id)) { if (!out.has(id)) out.set(id, []); out.get(id).push(p); }
    }
  };
  walk(DOC_ROOT);
  return out;
}

/** Every instance_id anywhere inside a manifest, at any nesting depth. */
function idsIn(file) {
  const out = new Set();
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch { return out; }
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    else if (typeof o === 'string' && /__.+-\d+$/.test(o)) out.add(o);
  };
  walk(doc);
  return out;
}

/** Every instance_id drawn in a previous round, from the public slates on disk. */
function previouslyDrawn() {
  const ids = new Set();
  let dirs = [];
  try { dirs = readdirSync(BLINDED, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return ids; }
  for (const d of dirs) {
    const p = join(BLINDED, d, 'SLATE-PUBLIC.json');
    if (!existsSync(p)) continue;
    try { for (const t of JSON.parse(readFileSync(p, 'utf8'))) if (t?.instance_id) ids.add(t.instance_id); } catch { /* unreadable slate is not a licence to re-draw */ }
  }
  return ids;
}

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
  const round = arg('round', 'round2');
  const poolFile = arg('pool', DEV_RET);
  const force = process.argv.includes('--force');

  const outPub = join(BLINDED, round, 'SLATE-PUBLIC.json');
  if (existsSync(outPub) && !force) {
    console.error(`refusing to overwrite ${outPub} — it is the audit trail of a drawn round.`);
    console.error('pass a different --round, or --force if you really mean to redraw it.');
    process.exit(1);
  }

  const pool = JSON.parse(readFileSync(poolFile, 'utf8'));
  const tasks = Array.isArray(pool) ? pool : Object.values(pool)[0];

  const rot = JSON.parse(readFileSync(ROTATE20, 'utf8'));
  const rotIds = new Set((Array.isArray(rot) ? rot : Object.values(rot)[0]).map(t => t.instance_id));
  const burned = previouslyDrawn();
  const turnfix = idsIn(TURNFIX_MANIFEST);
  const discussed = discussedInDocs(new Set(tasks.map(t => t.instance_id)));
  let unbuildable = new Set();
  try {
    unbuildable = new Set(JSON.parse(readFileSync(UNMATERIALISABLE, 'utf8')).unmaterialisable.map(x => x.instance_id));
  } catch { /* absent file means nothing has been ruled out yet */ }
  // A REPOSITORY whose layout has already been discussed in prose, or derived on in a previous
  // round, gives a head start on exactly what this gate scores: owning package and dependency
  // direction. Sibling tasks in such a repo are excluded even when the task itself is untouched.
  const burnedRepos = new Set();
  for (const t of tasks) if (discussed.has(t.instance_id) && t.repo) burnedRepos.add(String(t.repo).toLowerCase());
  for (const d of readdirSync(BLINDED, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name)) {
    const p = join(BLINDED, d, 'SLATE-PUBLIC.json');
    if (!existsSync(p)) continue;
    try { for (const t of JSON.parse(readFileSync(p, 'utf8'))) if (t?.repo) burnedRepos.add(String(t.repo).toLowerCase()); } catch { /* */ }
  }

  const excluded = { rotate20: 0, alreadyUsed: 0, previousRounds: 0, turnfixCohort: 0, discussed: 0, burnedRepo: 0, noBaseTree: 0, emptyIssue: 0, noPatch: 0, extreme: 0 };
  const eligible = [];

  for (const t of tasks) {
    if (rotIds.has(t.instance_id)) { excluded.rotate20++; continue; }
    if (ALREADY_USED.has(t.instance_id)) { excluded.alreadyUsed++; continue; }
    if (burned.has(t.instance_id)) { excluded.previousRounds++; continue; }
    if (turnfix.has(t.instance_id)) { excluded.turnfixCohort++; continue; }
    if (discussed.has(t.instance_id)) { excluded.discussed++; continue; }
    if (burnedRepos.has(String(t.repo || '').toLowerCase())) { excluded.burnedRepo++; continue; }
    if (unbuildable.has(t.instance_id)) { excluded.noBaseTree++; continue; }
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

  // A short slate must never be produced silently: a round drawn with fewer
  // new-module tasks than pre-registered is a WEAKER test, and that has to be a decision
  // somebody takes on purpose, not a slice() that happened to run out of candidates.
  if (withNew.length < nWith || withoutNew.length < nWithout) {
    console.error(`cannot fill the requested slate: asked for ${nWith} with a new source module and ${nWithout} without;`);
    console.error(`the eligible pool has ${withNew.length} and ${withoutNew.length} after exclusions ${JSON.stringify(excluded)}.`);
    console.error('Either lower --n-with / --n-without ON PURPOSE and record the deviation, or draw from a fresh pool.');
    process.exit(2);
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
    seed, generated_from: poolFile,
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

  mkdirSync(dirname(outPub), { recursive: true });
  writeFileSync(outPub, JSON.stringify(pub, null, 2) + '\n');
  const sealedPath = join(HERE, round === 'round2' ? 'SEALED-labels.json' : `SEALED-labels-${round}.json`);
  writeFileSync(sealedPath, JSON.stringify(sealed, null, 2) + '\n');

  // The issue text lives in the same file as gold, so the deriver must never open that file.
  // Extract the statements alone into the clean zone.
  const issues = slate.map(({ t }) => ({
    instance_id: t.instance_id,
    repo: t.repo,
    base_commit: t.base_commit,
    language: t.language,
    problem_statement: t.problem_statement,
  }));
  writeFileSync(join(BLINDED, round, 'ISSUES.json'), JSON.stringify(issues, null, 2) + '\n');

  // Console output must stay safe: counts only, never which task is in which class.
  console.log(`pool ${tasks.length} → eligible ${eligible.length}`);
  console.log(`excluded: ${JSON.stringify(excluded)}`);
  console.log(`classes: adds-new-module ${withNew.length}, does-not ${withoutNew.length}`);
  console.log(`slate: ${pub.length} tasks (${nWith} + ${nWithout}, shuffled, seed ${seed})`);
  console.log(`wrote ${round}/SLATE-PUBLIC.json, ${round}/ISSUES.json and ${sealedPath.split('/').pop()}`);
}

if (process.argv[1] && process.argv[1].endsWith('pick-newmodule-slate.mjs')) main();
