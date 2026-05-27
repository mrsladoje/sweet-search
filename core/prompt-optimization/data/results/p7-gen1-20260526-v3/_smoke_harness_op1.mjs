#!/usr/bin/env node
/**
 * Live wiring smoke for callMutatorHarness + runOpWithRetry against the real
 * opencode + google/gemini-3.1-pro-preview path. Runs OP-1 reflective on the
 * round-5 joint_best with retry-until-success (cap 3) and validates the result
 * through the same §3.2.1 token validator the production loop uses.
 *
 * Pass criterion: accepted=true within the retry cap, with a valid mutation.
 * On accept, also verify token preservation matches the source exactly.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callMutatorHarness } from '../../../sweep/op-harness-caller.mjs';
import { runReflectiveRewrite, runOpWithRetry } from '../../../sweep/gepa-mutate.mjs';
import { topFailures } from '../../../sweep/gepa-scoring.mjs';
import { extractTokens } from '../../../sweep/token-validator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = __dirname;
const PROBES_FILE = resolve(RUN_DIR, '../../p7-dev-probes.json');

const pc = JSON.parse(readFileSync(resolve(RUN_DIR, 'pareto-current.json'), 'utf8'));
const bankLines = readFileSync(resolve(RUN_DIR, 'prompt-bank.jsonl'), 'utf8').trim().split('\n');
const promptByHash = Object.fromEntries(
  bankLines.map((l) => JSON.parse(l)).filter((r) => r._kind === 'prompt').map((r) => [r.hash, r.text]),
);
const probesDoc = JSON.parse(readFileSync(PROBES_FILE, 'utf8'));
const probeMap = new Map(probesDoc.probes.map((p) => [p.id, p]));

const JOINT_BEST_HASH = '0xe9c1421a31a50f5a';
const jointBest = pc.front.find((m) => m.hash === JOINT_BEST_HASH);
const candidatePrompt = promptByHash[JOINT_BEST_HASH];

let failures = topFailures({ candidate: jointBest, probes: probesDoc.probes, limit: 5 });
if (failures.length === 0) {
  const sorted = Object.entries(jointBest.scores).map(([pid, s]) => ({ pid, s })).sort((a, b) => a.s - b.s).slice(0, 5);
  for (const { pid } of sorted) {
    const p = probeMap.get(pid);
    const d = jointBest.detail?.[pid];
    const worse = d ? (d.sonnet.score <= d.gpt5_5.score ? 'sonnet' : 'gpt5_5') : 'sonnet';
    const traj = d?.[worse]?.traj || { toolCalls: [], answer: '' };
    failures.push({
      probeId: pid, stratum: p?.stratum, repo: p?.repo, query: p?.query,
      jointScore: jointBest.scores[pid], target: worse,
      toolCalls: traj.toolCalls, answer: traj.answer,
      expectedFiles: p?.expectedFiles ?? [],
    });
  }
}

console.error(`SMOKE: callMutatorHarness + runOpWithRetry on OP-1 reflective`);
console.error(`  joint_best: ${jointBest.id}  finalScore=${jointBest.finalScore.toFixed(4)}`);
console.error(`  failures: ${failures.length}`);

const t0 = Date.now();
const res = await runOpWithRetry(
  (cm) => runReflectiveRewrite({ candidate: candidatePrompt, failures, callModel: cm }),
  callMutatorHarness,
  { maxAttempts: 3 },
);
const wall = ((Date.now() - t0) / 1000).toFixed(1);

console.error(`\n${'='.repeat(60)}`);
console.error(`Result: ${res.accepted ? 'ACCEPTED' : 'REJECTED'}`);
console.error(`Attempts: ${res.attempts}`);
console.error(`Total wall: ${wall}s`);
console.error(`Prior failures (intermediate): ${res.priorFailures.length}`);
for (const pf of res.priorFailures) {
  const reasons = (pf.rejection?.failures ?? []).map((f) => `${f.reason}${f.token ? ':' + f.token : ''}`).join(',') || pf.rejection?.reason;
  console.error(`  attempt ${pf.attempt}: ${reasons}`);
}

if (res.accepted) {
  console.error(`\nMutation chars: ${res.mutated.length} (source ${candidatePrompt.length}, Δ ${res.mutated.length - candidatePrompt.length})`);
  const srcTokens = extractTokens(candidatePrompt);
  const mutTokens = extractTokens(res.mutated);
  const tokensMatch = srcTokens.size === mutTokens.size && [...srcTokens.entries()].every(([k, v]) => mutTokens.get(k) === v);
  console.error(`Token preservation: ${tokensMatch ? 'PERFECT' : 'BROKEN'}`);
  console.error(`\nFirst 600 chars of mutation:`);
  console.error(res.mutated.slice(0, 600));
  console.error(`\n... last 400 chars:`);
  console.error(res.mutated.slice(-400));
  if (!tokensMatch) process.exit(1);
} else {
  console.error(`\nFinal rejection: ${JSON.stringify(res.rejection).slice(0, 500)}`);
  process.exit(1);
}
