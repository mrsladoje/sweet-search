#!/usr/bin/env node
// r3-hard2 (DEV ONLY) selection: keep candidates where the native Claude Code + Opus 5.5 selection run
// (tag r3x-sel-op-nat, one rollout each) used >= MIN_CALLS tool calls. Later comparisons use FRESH
// rollouts only (the selection rollouts are never scored again), against regression to the mean.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIN_CALLS = Number(process.env.MIN_CALLS || 6);
const runs = path.join(HERE, '../../results/r282-cc-opus55-medium-r3x-sel-op-nat/runs.jsonl');
const calls = Object.fromEntries(fs.readFileSync(runs, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r.calls]));
const cand = JSON.parse(fs.readFileSync(path.join(HERE, 'hard2-candidates.json'), 'utf8')).probes;
const keep = cand.filter(p => (calls[p.id] ?? 0) >= MIN_CALLS).map(p => ({ ...p, selectionCalls: calls[p.id] }));
const file = path.join(HERE, 'hard2-probes.json');
fs.writeFileSync(file, JSON.stringify({ version: 'r3-hard2-2026-10-01', devOnly: true, selection: { run: 'r3x-sel-op-nat', minCalls: MIN_CALLS, candidates: cand.length }, probes: keep }, null, 1) + '\n');
console.log(`${keep.length}/${cand.length} kept (native calls >= ${MIN_CALLS}); sha256 ${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`);
