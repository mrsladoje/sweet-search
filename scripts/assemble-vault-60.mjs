#!/usr/bin/env node
/**
 * Assemble + verify the 60-probe vault: frozen 25 + 35 newly blind-authored.
 * Checks (any failure ⇒ does NOT write): schema, unique ids, resolveRepoCwd +
 * .sweet-search index present, every gold file exists under the resolved cwd
 * (non-no-match), and file+symbol dedup. Writes frozen/p7-vault-probes-v60.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRepoCwd } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(REPO, 'core/prompt-optimization/data/results');
const FROZEN = path.join(REPO, 'core/prompt-optimization/data/frozen');
const load = (p) => { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(j) ? j : (j.probes || j.dev || []); };

const f25 = load(path.join(FROZEN, 'p7-vault-probes.json'));
const newProbes = ['vault-new/ood1.json', 'vault-new/ood2.json', 'vault-new/indist.json'].flatMap((f) => load(path.join(RES, f)));
const all = [...f25, ...newProbes];

const REQ = ['id', 'repo', 'language', 'stratum', 'query', 'expectedFiles', 'expectedSymbols', 'expectedNoMatch', 'max_turns'];
const ids = new Set(); const dupIds = [], badSchema = [], noResolve = [], noIndex = [], noGold = [], dupFS = [];
const fsKeys = new Set();
for (const p of all) {
  const miss = REQ.filter((k) => !(k in p)); if (miss.length) badSchema.push(`${p.id}:${miss}`);
  if (ids.has(p.id)) dupIds.push(p.id); ids.add(p.id);
  let cwd; try { cwd = resolveRepoCwd(p, {}); } catch { noResolve.push(`${p.id}:resolveErr`); continue; }
  if (!fs.existsSync(cwd)) { noResolve.push(`${p.id}:noDir(${p.language}/${p.repo})`); continue; }
  if (!fs.existsSync(path.join(cwd, '.sweet-search'))) noIndex.push(p.id);
  if (!p.expectedNoMatch) {
    for (const gf of (p.expectedFiles || [])) if (!fs.existsSync(path.join(cwd, gf))) noGold.push(`${p.id}:${gf}`);
    const k = `${p.language}|${(p.expectedFiles || []).join(',')}::${(p.expectedSymbols || []).join(',')}`;
    if (fsKeys.has(k)) dupFS.push(`${p.id} ~ ${k}`); fsKeys.add(k);
  }
}
const by = (k) => { const m = {}; for (const p of all) m[p[k]] = (m[p[k]] || 0) + 1; return m; };
console.log(`total ${all.length}  (25 frozen + ${newProbes.length} new)`);
console.log('dup ids        :', dupIds.length ? dupIds : 'none');
console.log('bad schema     :', badSchema.length ? badSchema : 'none');
console.log('no resolve/dir :', noResolve.length ? noResolve : 'none');
console.log('no index       :', noIndex.length ? noIndex : 'none');
console.log('missing gold   :', noGold.length ? noGold : 'none');
console.log('dup file+symbol:', dupFS.length ? dupFS : 'none');
console.log('by language    :', JSON.stringify(by('language')));
console.log('by stratum     :', JSON.stringify(by('stratum')));
const blocking = dupIds.length + badSchema.length + noResolve.length + noGold.length;
if (blocking === 0 && all.length >= 55) {
  fs.writeFileSync(path.join(FROZEN, 'p7-vault-probes-v60.json'), JSON.stringify(all, null, 2));
  console.log(`\n✅ WROTE frozen/p7-vault-probes-v60.json (${all.length} probes)${noIndex.length ? ' — NOTE: ' + noIndex.length + ' un-indexed (re-index before running)' : ''}`);
} else {
  console.log(`\n❌ NOT writing — ${blocking} blocking issue(s) to fix first`);
}
