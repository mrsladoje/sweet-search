#!/usr/bin/env node
// Build the HELD-OUT question set for the final held-out run: every r3 held-out question.
//
//   node core/prompt-optimization/data/final-run/select-heldout.mjs           # write questions-heldout.json
//   node core/prompt-optimization/data/final-run/select-heldout.mjs --check   # re-derive, compare ids, exit 1 on a difference
//
// No draw: the set is fixed by the frozen manifests (seed 42 splits, r3-PREREG.md):
//   easy = r3 held-out (MANIFEST.json ids.heldout, 103 questions, 6 repos)
//   hard = r3-hard held-out (MANIFEST-HARD.json ids.heldout, 97 questions, 11 repos)
// Every probe must carry set === 'heldout' in its own file; the script aborts otherwise.
// HELD-OUT: aggregates only. This script prints counts, never a question.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..');
const R3 = path.join(DATA, 'final-tuning/r3');
const OUT = path.join(HERE, 'questions-heldout.json');
const CHECK = process.argv.includes('--check');

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const count = (arr, k) => arr.reduce((m, p) => (m[p[k]] = (m[p[k]] || 0) + 1, m), {});

const SOURCES = [
  ['easy', path.join(R3, 'r3-probes.json'), path.join(R3, 'MANIFEST.json')],
  ['hard', path.join(R3, 'r3-hard-probes.json'), path.join(R3, 'MANIFEST-HARD.json')],
];
const probes = [];
const sources = {};
for (const [tier, file, manFile] of SOURCES) {
  const man = readJson(manFile);
  // The manifests pin the probe files' bytes; refuse to select from a file that changed after freezing.
  if (sha256(file) !== man.sha256) throw new Error(`${path.relative(DATA, file)}: sha256 differs from its manifest — the frozen file changed`);
  const ids = new Set(man.ids.heldout);
  const chosen = readJson(file).probes.filter(p => ids.has(p.id));
  if (chosen.length !== ids.size) throw new Error(`${tier}: ${chosen.length} probes found for ${ids.size} held-out ids`);
  for (const p of chosen) if (p.set !== 'heldout') throw new Error(`${p.id}: not a HELD-OUT probe (set=${p.set}) — refusing`);
  // `set` = tier (the bootstrap stratum); the source split is in `sourceSet`, as in questions.json.
  probes.push(...chosen.map(p => ({ ...p, sourceSet: p.set, set: tier, tier })));
  sources[tier] = { file: path.relative(DATA, file), sha256: man.sha256, manifest: path.relative(DATA, manFile), n: chosen.length };
}
probes.sort((a, b) => (a.tier === b.tier ? a.id.localeCompare(b.id) : a.tier === 'easy' ? -1 : 1));

if (CHECK) {
  const have = readJson(OUT);
  const want = probes.map(p => p.id).join(',');
  if (have.probes.map(p => p.id).join(',') !== want) { console.error('questions-heldout.json: ids differ from the manifests'); process.exit(1); }
  console.log(`questions-heldout.json OK (${probes.length} held-out questions)`);
  process.exit(0);
}

const out = {
  version: 'heldout-run-2026-10-05',
  purpose: 'Final HELD-OUT retrieval run: every r3 held-out question (easy 103 + hard 97). Aggregates only — never inspect per question.',
  frozenAt: new Date().toISOString(),
  seed: 42,
  method: 'all ids.heldout of MANIFEST.json and MANIFEST-HARD.json (seed-42 stratified splits, r3-PREREG.md); no draw',
  sources,
  n: { total: probes.length, easy: sources.easy.n, hard: sources.hard.n },
  byStratum: count(probes, 'stratum'),
  byRepo: count(probes, 'repo'),
  ids: { easy: probes.filter(p => p.tier === 'easy').map(p => p.id), hard: probes.filter(p => p.tier === 'hard').map(p => p.id) },
  probes,
};
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${probes.length} questions (easy ${out.n.easy}, hard ${out.n.hard}), ${Object.keys(out.byRepo).length} repos`);
