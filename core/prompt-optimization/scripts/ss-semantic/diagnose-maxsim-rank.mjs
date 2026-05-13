#!/usr/bin/env node
/**
 * diagnose-maxsim-rank.mjs — for each v6 dev FAIL, run readSemantic with
 * verbose=true and report:
 *   - the rank of the chunk that overlaps the gold (in pre-merge top-K)
 *   - that chunk's maxsim score and rank among maxsim-only ordering
 *
 * Goal: see whether the right chunk would have been rescued by widening
 * the candidate pool to include top-maxsim chunks, vs whether it's
 * dropped even earlier (out of the LI-scored set entirely).
 *
 * Note: requires temporarily raising topK so the diagnostic surface
 * shows what's available, separate from what the v6 audit (topK=5)
 * sees.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');

const TARGETS = [
  { lang: 'c', goldId: 'C-005' },
  { lang: 'cpp', goldId: 'CPP-002' },
  { lang: 'cpp', goldId: 'CPP-003' },
  { lang: 'dart', goldId: 'DR-008' },
  { lang: 'lua', goldId: 'LU-003' },
  { lang: 'lua', goldId: 'LU-004' },
  { lang: 'python', goldId: 'PY-004' },
  { lang: 'python', goldId: 'PY-006' },
  { lang: 'zig', goldId: 'ZG-001' },
  { lang: 'zig', goldId: 'ZG-004' },
  { lang: 'zig', goldId: 'ZG-005' },
];

const FAMILY_OF_LANG = {
  java: 'OO-monolithic', csharp: 'OO-monolithic', kotlin: 'OO-monolithic', scala: 'OO-monolithic',
  rust: 'Systems-modular-terse', go: 'Systems-modular-terse',
  c: 'C-family', cpp: 'C-family', zig: 'C-family',
  javascript: 'JS-mobile', typescript: 'JS-mobile', 'typescript-lib': 'JS-mobile', dart: 'JS-mobile',
  python: 'Scripting-dynamic', ruby: 'Scripting-dynamic', php: 'Scripting-dynamic', lua: 'Scripting-dynamic', elixir: 'Scripting-dynamic',
};
const BEST_SHAPE = (fam) => fam === 'C-family' ? 'V2' : 'V1';

function loadReposManifest() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const m = new Map();
  for (const e of raw.repos || []) m.set(e.key || e.language, e);
  return m;
}

async function orchestrate() {
  const reposMap = loadReposManifest();
  console.log('goldId      lang        goldRange  query                                  finalRank/of  fusedRank   maxsimRank  maxsimScore  fusedScore  chunkSym');
  console.log('-'.repeat(180));
  for (const t of TARGETS) {
    const repoEntry = reposMap.get(t.lang);
    if (!repoEntry) continue;
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    const res = spawnSync(process.argv[0], [process.argv[1], '--child', t.lang, t.goldId], {
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot, SS_MS_CHILD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      console.error(`  child ${t.lang}-${t.goldId} exited ${res.status}: ${res.stderr.toString().slice(0, 200)}`);
      continue;
    }
    process.stdout.write(res.stdout.toString());
  }
}

async function child(lang, goldId) {
  const input = JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, `${lang}-${goldId}.json`), 'utf8'));
  const fam = input.family || FAMILY_OF_LANG[lang];
  const shape = BEST_SHAPE(fam);
  const variant = JSON.parse(fs.readFileSync(path.join(VARIANTS_DIR, `${lang}-${goldId}-${shape}.json`), 'utf8'));
  const { readSemantic } = await import('../../../search/search-read-semantic.js');
  // Use a large topK to see the FULL candidate pool, then identify
  // where the gold-overlapping chunk ranks.
  const resp = await readSemantic({
    path: input.expectedFile,
    query: variant.query,
    projectRoot: process.env.SWEET_SEARCH_PROJECT_ROOT,
    topK: 100,
    verbose: true,
  });
  const gold = input.containingChunk;
  const all = resp.signals?.preMergeRanked ?? [];
  // Identify gold-overlapping chunks
  const isGold = (c) => c.startLine <= gold.endLine && c.endLine >= gold.startLine;
  // Note: preMergeRanked is sorted by final score after Fix 2 demotion
  const goldChunks = all.map((c, i) => ({ ...c, finalRank: i + 1 })).filter(isGold);
  // Re-sort all by maxsim to derive maxsim rank
  const byMaxsim = [...all].sort((a, b) => (b.signals.maxsim ?? -Infinity) - (a.signals.maxsim ?? -Infinity));
  const maxsimRank = new Map();
  byMaxsim.forEach((c, i) => maxsimRank.set(`${c.startLine}-${c.endLine}`, i + 1));
  // Re-sort all by fused
  const byFused = [...all].sort((a, b) => (b.signals.fused ?? 0) - (a.signals.fused ?? 0));
  const fusedRank = new Map();
  byFused.forEach((c, i) => fusedRank.set(`${c.startLine}-${c.endLine}`, i + 1));
  const totalN = all.length;
  for (const c of goldChunks) {
    const key = `${c.startLine}-${c.endLine}`;
    const fr = fusedRank.get(key);
    const mr = maxsimRank.get(key);
    const m = c.signals.maxsim;
    const fz = c.signals.fused;
    const q = variant.query.length > 38 ? variant.query.slice(0, 35) + '...' : variant.query;
    console.log(
      `${goldId.padEnd(11)} ${lang.padEnd(12)} ${(gold.startLine + '-' + gold.endLine).padEnd(10)} ${q.padEnd(38)} ${String(c.finalRank).padStart(3)}/${String(totalN).padEnd(3)}     ${String(fr).padStart(3)}/${String(totalN).padEnd(3)}    ${String(mr).padStart(3)}/${String(totalN).padEnd(3)}    ${(m == null ? '   - ' : m.toFixed(3))}        ${fz.toFixed(4)}      ${c.symbol || '(null)'}`,
    );
  }
}

async function main() {
  if (process.env.SS_MS_CHILD === '1' && process.argv[2] === '--child') {
    await child(process.argv[3], process.argv[4]);
  } else {
    await orchestrate();
  }
}

main().catch((err) => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });
