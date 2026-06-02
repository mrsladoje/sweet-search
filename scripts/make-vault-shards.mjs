#!/usr/bin/env node
// Split the 60-vault into K repo-disjoint shards (no two shards touch the same repo, so
// concurrent runs never race on a repo's AGENTS.md) and emit scripts/run-vault-codex.sh:
// K shards run concurrently, each does MODE=mpp then MODE=native at REPS reps via Codex+OpenRouter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRepoCwd } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = Number(process.env.K || 4);
const REPS = Number(process.env.REPS || 3);
const V = 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json';
const probes = JSON.parse(fs.readFileSync(path.join(REPO, V), 'utf8'));

const byRepo = new Map();
for (const p of probes) { const cwd = resolveRepoCwd(p, {}); if (!byRepo.has(cwd)) byRepo.set(cwd, []); byRepo.get(cwd).push(p.id); }
const repos = [...byRepo.entries()].sort((a, b) => b[1].length - a[1].length); // largest repo first
const shards = Array.from({ length: K }, () => ({ ids: [], n: 0, repos: 0 }));
for (const [, ids] of repos) { const s = shards.reduce((m, x) => (x.n < m.n ? x : m), shards[0]); s.ids.push(...ids); s.n += ids.length; s.repos++; } // least-loaded shard

console.error(`${probes.length} probes, ${repos.length} repos → ${K} repo-disjoint shards, ${REPS} reps × {mpp,native}:`);
shards.forEach((s, i) => console.error(`  s${i + 1}: ${s.n} probes / ${s.repos} repos → ${s.n * REPS * 2} runs`));

const L = [
  '#!/bin/zsh',
  `cd ${REPO}`,
  `V=${V}`,
  'run_shard(){ local ids=$1 s=$2;',
  `  PROBES=$V PROVIDER=openrouter IDS=$ids HARNESS=codex MODEL=gpt-5.5 REASON=high MODE=mpp REPS=${REPS} RUN=vault-cdx-mpp-$s node scripts/inharness-sniff.mjs;`,
  `  PROBES=$V PROVIDER=openrouter IDS=$ids HARNESS=codex MODEL=gpt-5.5 REASON=high MODE=native REPS=${REPS} RUN=vault-cdx-native-$s node scripts/inharness-sniff.mjs; }`,
];
shards.forEach((s, i) => L.push(`run_shard "${s.ids.join(',')}" s${i + 1} &`));
L.push('wait', 'echo VAULT_ALL_SHARDS_DONE');
fs.writeFileSync(path.join(REPO, 'scripts/run-vault-codex.sh'), L.join('\n') + '\n');
console.error(`\nwrote scripts/run-vault-codex.sh — total ${probes.length * REPS * 2} runs`);
