#!/usr/bin/env node
// Vault-readiness gate (NOT a smoke — a correctness check before the one-shot run on the
// sealed vault). Every probe must resolve to an existing, git-scoped, sweet-search-indexed
// repo, with NO stray AGENTS.md / CLAUDE.md in the ancestor chain (the Codex/Claude walk-up
// confound). Also emits the repo grouping so the run can be sharded repo-disjoint (no two
// concurrent runs writing the same repo's AGENTS.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRepoCwd } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probes = Array.isArray(vault) ? vault : (vault.probes || []);

const noResolve = [], noGit = [], noIndex = [], stray = [];
const repoToIds = new Map();
const byLang = {};
// Model Codex/Claude's ACTUAL walk: read instruction files from cwd UP TO (and including)
// the nearest .git workspace root, then stop. So a repo with its own .git is scoped to itself.
const scopeChain = (child) => { const out = []; let d = child; while (true) { out.push(d); if (fs.existsSync(path.join(d, '.git')) || d === path.dirname(d)) break; d = path.dirname(d); } return out; };
for (const p of probes) {
  byLang[p.language] = (byLang[p.language] || 0) + 1;
  let cwd; try { cwd = resolveRepoCwd(p, {}); } catch { noResolve.push(p.id); continue; }
  if (!fs.existsSync(cwd)) { noResolve.push(p.id + ':noDir'); continue; }
  if (!repoToIds.has(cwd)) repoToIds.set(cwd, []);
  repoToIds.get(cwd).push(p.id);
  if (!fs.existsSync(path.join(cwd, '.git'))) noGit.push(p.id + ' (' + path.relative(REPO, cwd) + ')');
  if (!fs.existsSync(path.join(cwd, '.sweet-search'))) noIndex.push(p.id + ' (' + path.relative(REPO, cwd) + ')');
  // stray AGENTS.md within the Codex scope (cwd up to nearest .git). Codex reads AGENTS.md
  // (not CLAUDE.md); a self-scoped repo never reaches our project-root AGENTS.md.
  for (const a of scopeChain(cwd)) {
    if (fs.existsSync(path.join(a, 'AGENTS.md'))) stray.push(p.id + ' → ' + (path.relative(REPO, a) || '.') + '/AGENTS.md');
  }
}
const globals = [path.join(process.env.HOME || '', 'AGENTS.md'), path.join(process.env.HOME || '', '.codex', 'AGENTS.md')].filter((g) => fs.existsSync(g));
console.log('vault probes :', probes.length);
console.log('by language  :', JSON.stringify(byLang));
console.log('distinct repos:', repoToIds.size);
console.log('no resolve/dir:', noResolve.length ? noResolve : 'none');
console.log('NO .git (walk-up scope risk):', noGit.length ? noGit : 'none');
console.log('NOT indexed (.sweet-search missing):', noIndex.length ? noIndex : 'none');
console.log('STRAY AGENTS.md within Codex scope (CONFOUND):', stray.length ? stray : 'none');
console.log('GLOBAL AGENTS.md (read by Codex regardless of repo):', globals.length ? globals : 'none');
console.log('\nrepo → #probes (sort desc; for repo-disjoint sharding):');
for (const [cwd, ids] of [...repoToIds.entries()].sort((a, b) => b[1].length - a[1].length)) console.log('  ' + path.relative(REPO, cwd).padEnd(52) + ids.length);
const blocking = noResolve.length + noIndex.length + stray.length;
console.log('\n' + (blocking === 0 ? '✅ VAULT READY' : '❌ ' + blocking + ' blocking issue(s) — fix before the one-shot run'));
