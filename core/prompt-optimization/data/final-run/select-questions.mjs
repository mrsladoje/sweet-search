#!/usr/bin/env node
// Freeze the PLAN.md §7.1 question set for the final before/after/native comparison.
//
//   node core/prompt-optimization/data/final-run/select-questions.mjs           # write questions.json
//   node core/prompt-optimization/data/final-run/select-questions.mjs --check   # re-derive, compare ids, exit 1 on a difference
//
// DEV ONLY. Pools are taken from the frozen manifests, never from the probe files' own fields alone:
//   easy = r3 DEV (MANIFEST.json ids.devTrain + ids.devValidation, 60 questions, 6 repos)
//   hard = r3-hard DEV (MANIFEST-HARD.json ids.dev, 97 questions, 11 repos)
// minus the 11 micro-smoke ids (obs-loop/smoke-ids.txt) that the obs loop tuned on.
// Every chosen probe must also carry set === 'dev' in its own file; the script aborts otherwise.
//
// Quotas (seed 42, mulberry32):
//   easy: 12 = 2 per stratum + 1 extra for 2 strata drawn by the seed; exactly 2 per repo (6 repos)
//   hard: 18 = 3 per stratum (6 strata); every repo 1 or 2 times (11 repos)
// Method: shuffle the pool, fill greedily under the stratum quota and the repo cap, accept the first
// draw that meets every quota and repo floor. Deterministic for a fixed seed and fixed source files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..');
const R3 = path.join(DATA, 'final-tuning/r3');
const SEED = 42;
const OUT = path.join(HERE, 'questions.json');
const CHECK = process.argv.includes('--check');

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const count = (arr, k) => arr.reduce((m, p) => (m[p[k]] = (m[p[k]] || 0) + 1, m), {});

const SMOKE_FILE = path.join(DATA, 'obs-loop/smoke-ids.txt');
const SMOKE = new Set(fs.readFileSync(SMOKE_FILE, 'utf8').trim().split(',').map(s => s.trim()).filter(Boolean));

const EASY_FILE = path.join(R3, 'r3-probes.json'), EASY_MAN = path.join(R3, 'MANIFEST.json');
const HARD_FILE = path.join(R3, 'r3-hard-probes.json'), HARD_MAN = path.join(R3, 'MANIFEST-HARD.json');
const easyMan = readJson(EASY_MAN), hardMan = readJson(HARD_MAN);
// The manifests pin the probe files' bytes; refuse to select from a file that changed after freezing.
for (const [f, m] of [[EASY_FILE, easyMan], [HARD_FILE, hardMan]]) {
  if (sha256(f) !== m.sha256) throw new Error(`${path.relative(DATA, f)}: sha256 differs from its manifest — the frozen file changed`);
}
const easyDevIds = new Set([...easyMan.ids.devTrain, ...easyMan.ids.devValidation]);
const hardDevIds = new Set(hardMan.ids.dev);
const heldout = new Set([...easyMan.ids.heldout, ...hardMan.ids.heldout]);

function pool(file, devIds) {
  const probes = readJson(file).probes;
  const out = probes.filter(p => devIds.has(p.id) && !SMOKE.has(p.id));
  for (const p of out) {
    if (p.set !== 'dev' || heldout.has(p.id)) throw new Error(`${p.id}: not a DEV probe (set=${p.set}) — refusing`);
  }
  return out;
}

function draw(name, candidates, { quota, repoMin, repoMax, maxAttempts = 200000 }) {
  const repos = [...new Set(candidates.map(p => p.repo))].sort();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const q = typeof quota === 'function' ? quota() : quota;
    const byS = {}, byR = {}, chosen = [];
    for (const p of shuffle(candidates)) {
      if ((byS[p.stratum] || 0) >= (q[p.stratum] || 0)) continue;
      if ((byR[p.repo] || 0) >= repoMax) continue;
      chosen.push(p); byS[p.stratum] = (byS[p.stratum] || 0) + 1; byR[p.repo] = (byR[p.repo] || 0) + 1;
    }
    const quotaOk = Object.entries(q).every(([s, n]) => (byS[s] || 0) === n);
    const repoOk = repos.every(r => (byR[r] || 0) >= repoMin);
    if (quotaOk && repoOk) return { chosen: chosen.sort((a, b) => a.id.localeCompare(b.id)), attempt, quota: q };
  }
  throw new Error(`${name}: no draw met the quotas in ${maxAttempts} attempts`);
}

const easyPool = pool(EASY_FILE, easyDevIds);
const hardPool = pool(HARD_FILE, hardDevIds);
const EASY_STRATA = ['multi-hop', 'concept', 'enforcement', 'locate-explain', 'negative'];
const HARD_STRATA = ['chain', 'completeness', 'decoy', 'cross-layer', 'condition', 'negative-decoy'];
for (const s of Object.keys(count(easyPool, 'stratum'))) if (!EASY_STRATA.includes(s)) throw new Error(`unknown easy stratum ${s}`);
for (const s of Object.keys(count(hardPool, 'stratum'))) if (!HARD_STRATA.includes(s)) throw new Error(`unknown hard stratum ${s}`);

// easy: which two strata get the third question is part of the seeded draw.
const easyQuota = () => { const extra = new Set(shuffle(EASY_STRATA).slice(0, 2)); return Object.fromEntries(EASY_STRATA.map(s => [s, extra.has(s) ? 3 : 2])); };
const easy = draw('easy', easyPool, { quota: easyQuota, repoMin: 2, repoMax: 2 });
const hard = draw('hard', hardPool, { quota: Object.fromEntries(HARD_STRATA.map(s => [s, 3])), repoMin: 1, repoMax: 2 });

const tag = (tier) => (p) => ({ ...p, sourceSet: p.set, set: tier, tier });
const probes = [...easy.chosen.map(tag('easy')), ...hard.chosen.map(tag('hard'))];
const ids = { easy: easy.chosen.map(p => p.id), hard: hard.chosen.map(p => p.id) };

if (CHECK) {
  const prev = readJson(OUT);
  const same = JSON.stringify(prev.ids) === JSON.stringify(ids);
  console.log(same ? 'OK: questions.json matches a fresh draw' : `MISMATCH:\n  file  ${JSON.stringify(prev.ids)}\n  fresh ${JSON.stringify(ids)}`);
  process.exit(same ? 0 : 1);
}

const rel = (f) => path.relative(path.resolve(DATA, '../../..'), f);
const out = {
  version: 'final-run-2026-10-03',
  purpose: 'PLAN.md §7.1 — frozen question set for the final before/after/native comparison (DEV only, no held-out)',
  frozenAt: new Date().toISOString(),
  seed: SEED,
  method: 'mulberry32(42); seeded shuffle + greedy fill under stratum quotas and a per-repo cap; first draw meeting every quota and repo floor (select-questions.mjs)',
  sources: {
    easy: { file: rel(EASY_FILE), sha256: sha256(EASY_FILE), manifest: rel(EASY_MAN), pool: 'ids.devTrain + ids.devValidation', poolSize: easyDevIds.size, afterSmokeExclusion: easyPool.length, drawAttempt: easy.attempt, quota: easy.quota, repoPerRepo: 2 },
    hard: { file: rel(HARD_FILE), sha256: sha256(HARD_FILE), manifest: rel(HARD_MAN), pool: 'ids.dev', poolSize: hardDevIds.size, afterSmokeExclusion: hardPool.length, drawAttempt: hard.attempt, quota: hard.quota, repoPerRepo: '1-2' },
    excludedSmokeIds: { file: rel(SMOKE_FILE), ids: [...SMOKE] },
  },
  n: { easy: ids.easy.length, hard: ids.hard.length, total: probes.length },
  byStratum: { easy: count(easy.chosen, 'stratum'), hard: count(hard.chosen, 'stratum') },
  byRepo: { easy: count(easy.chosen, 'repo'), hard: count(hard.chosen, 'repo'), all: count(probes, 'repo') },
  noMatchQuestions: probes.filter(p => p.expectedNoMatch).map(p => p.id),
  ids,
  // Bench input: `--probes <this file>`. `set` = tier (the bootstrap stratum); the source split is in `sourceSet`.
  probes,
};
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${rel(OUT)}: easy ${ids.easy.length} (attempt ${easy.attempt}), hard ${ids.hard.length} (attempt ${hard.attempt})`);
console.log('easy strata', out.byStratum.easy, '\nhard strata', out.byStratum.hard, '\nrepos', out.byRepo.all);
