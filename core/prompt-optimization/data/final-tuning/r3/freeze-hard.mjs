#!/usr/bin/env node
// r3-hard freeze: collect audited hard questions (A = 6 old repos, B = 5 new repos), split 50/50
// dev / held-out stratified by (repo, stratum) with seed 42, pick the 20-question difficulty PILOT
// from dev only (it stays in dev), write r3/r3-hard-probes.json + r3/MANIFEST-HARD.json (sha256).
// Held-out rows: aggregates only, run once at the end. The original r3 split (MANIFEST.json) is untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const groups = [['A', 'repos.json', 'hard-drafts'], ['B', 'repos-b.json', 'hard-drafts-b']];
const all = [];
for (const [grp, reposFile, draftsDir] of groups) {
  for (const r of JSON.parse(fs.readFileSync(path.join(HERE, reposFile), 'utf8'))) {
    const auditPath = path.join(HERE, 'hard-audit', `${r.repo}.json`);
    if (!fs.existsSync(auditPath)) throw new Error(`missing audit ${auditPath}`);
    const a = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    // closed-book screen applied centrally (auditors may have run before it covered their repo):
    // a question the screen solved is dropped unless the auditor hardened it.
    const cbPath = path.join(HERE, draftsDir, 'closed-book.json');
    const cb = fs.existsSync(cbPath) ? JSON.parse(fs.readFileSync(cbPath, 'utf8')) : {};
    const hardened = new Set(a.hardened || []);
    const keep = new Set(a.keep.filter(id => !(cb[id]?.drop && !hardened.has(id))));
    const unscreened = a.keep.filter(id => !cb[id] && !JSON.parse(fs.readFileSync(path.join(HERE, draftsDir, `${r.repo}.json`), 'utf8')).probes.find(p => p.id === id)?.expectedNoMatch).length;
    if (unscreened) console.error(`WARN ${r.repo}: ${unscreened} kept question(s) without a closed-book result`);
    const drafts = JSON.parse(fs.readFileSync(path.join(HERE, draftsDir, `${r.repo}.json`), 'utf8')).probes;
    for (const p of drafts) if (keep.has(p.id)) all.push({ ...p, ...(a.fixes?.[p.id] || {}), repo: `r3-${r.repo}`, repoSha: r.sha, language: p.language || r.language, group: grp });
  }
}
function split(items, frac, seed) {
  const rnd = mulberry32(seed); const g = new Map();
  for (const p of [...items].sort((x, y) => x.id.localeCompare(y.id))) { const k = `${p.repo}|${p.stratum}`; if (!g.has(k)) g.set(k, []); g.get(k).push({ p, r: rnd() }); }
  const A = [], B = []; let carry = 0;
  for (const k of [...g.keys()].sort()) { const v = g.get(k).sort((x, y) => x.r - y.r); const want = v.length * frac + carry; const n = Math.round(want); carry = want - n; v.forEach((x, i) => (i < n ? A : B).push(x.p)); }
  return [A, B];
}
const [held, dev] = split(all, 0.5, 42);
const rnd = mulberry32(4242);
const pilot = new Set([...dev].map(p => ({ id: p.id, r: rnd() })).sort((x, y) => x.r - y.r).slice(0, 20).map(x => x.id));
const probes = [...held.map(p => ({ ...p, set: 'heldout' })), ...dev.map(p => ({ ...p, set: 'dev', ...(pilot.has(p.id) ? { pilot: true } : {}) }))].sort((x, y) => x.id.localeCompare(y.id));
const file = path.join(HERE, 'r3-hard-probes.json');
fs.writeFileSync(file, JSON.stringify({ version: 'r3-hard-2026-10-01', seed: 42, probes }, null, 1) + '\n');
const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const count = (xs, f) => xs.reduce((m, x) => (m[f(x)] = (m[f(x)] || 0) + 1, m), {});
const manifest = { frozenAt: new Date().toISOString(), file: 'r3/r3-hard-probes.json', sha256: sha, seed: 42,
  n: { total: probes.length, heldout: held.length, dev: dev.length, pilot: pilot.size },
  byGroup: { heldout: count(held, p => p.group), dev: count(dev, p => p.group) }, byRepo: count(probes, p => p.repo), byStratum: count(probes, p => p.stratum),
  ids: { heldout: held.map(p => p.id).sort(), dev: dev.map(p => p.id).sort(), pilot: [...pilot].sort() } };
fs.writeFileSync(path.join(HERE, 'MANIFEST-HARD.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ sha256: sha, n: manifest.n, byGroup: manifest.byGroup, byStratum: manifest.byStratum }, null, 1));
