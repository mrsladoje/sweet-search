#!/usr/bin/env node
// r3 freeze: collect the audited questions, split dev / held-out, write the manifest with sha256.
//   node r3/freeze-split.mjs            (reads r3/audit/<repo>.json = { keep: [ids], fixes: {id: {…fields}}, dropped })
// Split (fixed before any agent run): stratified by (repo, stratum), seed 42; held-out = the first
// ceil(share × n) of each shuffled stratum with share chosen so that held-out ≥ 100; the rest = dev.
// Dev is further split train/validation 60/40 by the same method (seed 42) for Phase 6.
// After this runs, held-out rows may be seen ONLY as aggregates (CLAUDE.md methodology).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const repos0 = JSON.parse(fs.readFileSync(path.join(HERE, 'repos.json'), 'utf8'));
const audited = { keep: [], fixes: {} };
for (const r of repos0) {
  const a = JSON.parse(fs.readFileSync(path.join(HERE, 'audit', `${r.repo}.json`), 'utf8'));
  audited.keep.push(...a.keep); Object.assign(audited.fixes, a.fixes || {});
}
const keep = new Set(audited.keep);
const repos = JSON.parse(fs.readFileSync(path.join(HERE, 'repos.json'), 'utf8'));
const all = [];
for (const r of repos) {
  const d = JSON.parse(fs.readFileSync(path.join(HERE, 'drafts', `${r.repo}.json`), 'utf8'));
  for (const p of d.probes) if (keep.has(p.id)) all.push({ ...p, ...(audited.fixes?.[p.id] || {}), repo: `r3-${r.repo}`, repoSha: r.sha });
}
const HELDOUT_MIN = 100;
const share = Math.min(0.75, Math.max(0.55, HELDOUT_MIN / all.length + 0.02));
function split(items, frac, seed) {
  const rnd = mulberry32(seed); const groups = new Map();
  for (const p of [...items].sort((a, b) => a.id.localeCompare(b.id))) { const k = `${p.repo}|${p.stratum}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ p, r: rnd() }); }
  const A = [], B = []; let carry = 0;
  for (const k of [...groups.keys()].sort()) {
    const g = groups.get(k).sort((x, y) => x.r - y.r);
    const want = g.length * frac + carry; const nA = Math.round(want); carry = want - nA;
    g.forEach((x, i) => (i < nA ? A : B).push(x.p));
  }
  return [A, B];
}
const [held, dev] = split(all, share, 42);
const [devTrain, devVal] = split(dev, 0.6, 42);
const probes = [
  ...held.map(p => ({ ...p, set: 'heldout' })),
  ...devTrain.map(p => ({ ...p, set: 'dev', devSplit: 'train' })),
  ...devVal.map(p => ({ ...p, set: 'dev', devSplit: 'validation' })),
].sort((a, b) => a.id.localeCompare(b.id));
const file = path.join(HERE, 'r3-probes.json');
fs.writeFileSync(file, JSON.stringify({ version: 'r3-2026-10-01', seed: 42, heldoutShare: share, probes }, null, 1) + '\n');
const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const count = (xs, f) => xs.reduce((m, x) => (m[f(x)] = (m[f(x)] || 0) + 1, m), {});
const manifest = {
  frozenAt: new Date().toISOString(), file: 'r3/r3-probes.json', sha256: sha, seed: 42,
  n: { total: probes.length, heldout: held.length, dev: dev.length, devTrain: devTrain.length, devValidation: devVal.length },
  byRepo: count(probes, p => p.repo), byStratum: count(probes, p => p.stratum),
  heldoutByStratum: count(held, p => p.stratum),
  repos: repos.map(r => ({ repo: `r3-${r.repo}`, sha: r.sha, url: r.url })),
  ids: { heldout: held.map(p => p.id).sort(), devTrain: devTrain.map(p => p.id).sort(), devValidation: devVal.map(p => p.id).sort() },
};
fs.writeFileSync(path.join(HERE, 'MANIFEST.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ sha256: sha, n: manifest.n, byStratum: manifest.byStratum }, null, 1));
