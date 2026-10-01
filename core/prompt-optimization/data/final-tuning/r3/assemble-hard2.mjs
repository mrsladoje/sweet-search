#!/usr/bin/env node
// r3-hard2 (DEV ONLY): collect r3/hard2-drafts/*.json into r3/hard2-candidates.json for the native
// SELECTION run. Selection keeps the questions where native needs the most calls; every comparison
// afterwards uses FRESH rollouts (never the selection rollouts), so the selection does not favour sweet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const repos = [...JSON.parse(fs.readFileSync(path.join(HERE, 'repos.json'), 'utf8')), ...JSON.parse(fs.readFileSync(path.join(HERE, 'repos-b.json'), 'utf8'))];
const dir = path.join(HERE, 'hard2-drafts');
const probes = [];
for (const r of repos) {
  const f = path.join(dir, `${r.repo}.json`);
  if (!fs.existsSync(f)) { console.error(`MISSING ${r.repo}`); continue; }
  for (const p of JSON.parse(fs.readFileSync(f, 'utf8')).probes) {
    probes.push({ ...p, repo: `r3-${r.repo}`, repoSha: r.sha, language: p.language || r.language, set: 'dev', tier: 'r3-hard2', expectedNoMatch: false });
  }
}
const ids = probes.map(p => p.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) throw new Error(`duplicate ids ${dup}`);
const bad = probes.filter(p => !p.query || !p.expectedFiles?.length || !p.expectedFacts?.length || !p.stratum);
if (bad.length) console.error(`INCOMPLETE ${bad.map(p => p.id)}`);
fs.writeFileSync(path.join(HERE, 'hard2-candidates.json'), JSON.stringify({ version: 'r3-hard2-candidates-2026-10-01', probes }, null, 1) + '\n');
console.log(`${probes.length} candidates from ${new Set(probes.map(p => p.repo)).size} repos → r3/hard2-candidates.json`);
