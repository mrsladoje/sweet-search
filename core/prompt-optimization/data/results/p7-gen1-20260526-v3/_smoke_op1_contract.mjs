#!/usr/bin/env node
/**
 * Out-of-loop live smoke for the OP-1 reflective TOKEN PRESERVATION CONTRACT
 * (Task 1 verification gate (c)).
 *
 * Loads T2's prompt from the gen-1-v3 prompt bank (hash 0x73a322f332b34c9b),
 * pulls T2's 5 worst-joint probes from the same trajectory, and calls
 * runReflectiveRewrite against the REAL Kimi K2.6 reflector three times.
 *
 * Pass criterion: ALL 3 runs must end with `accepted: true` and no
 * `multiplicity-changed` failure in rejection.failures.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runReflectiveRewrite, buildTokenContract } from '../../../sweep/gepa-mutate.mjs';
import { runJudge } from '../../../../../eval/agent-read-workflows/judge-runner.js';
import { withMutatorCallDefaults } from '../../../sweep/gepa-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = __dirname;
const PROBES_FILE = path.join(__dirname, '../../p7-dev-probes.json');

const T2_HASH = '0x73a322f332b34c9b';

function loadPromptBank() {
  const lines = readFileSync(path.join(RESULTS_DIR, 'prompt-bank.jsonl'), 'utf8').trim().split('\n');
  return lines.map((l) => JSON.parse(l));
}

function loadTrajectory() {
  const lines = readFileSync(path.join(RESULTS_DIR, 'gepa-trajectory.jsonl'), 'utf8').trim().split('\n');
  return lines.map((l) => JSON.parse(l));
}

function pickT2WorstProbes() {
  const traj = loadTrajectory();
  const seeds = traj.filter((e) => e._kind === 'seed' && e.mutation_hash === T2_HASH);
  if (seeds.length === 0) throw new Error('No seed events found for T2');

  // Group by probe_id, collect per-target scores
  const byProbe = new Map();
  for (const s of seeds) {
    const cur = byProbe.get(s.probe_id) || {};
    cur[s.target] = s.score;
    byProbe.set(s.probe_id, cur);
  }

  const probesDoc = JSON.parse(readFileSync(PROBES_FILE, 'utf8'));
  const probeMap = new Map(probesDoc.probes.map((p) => [p.id, p]));

  const ranked = [...byProbe.entries()]
    .map(([probeId, scores]) => {
      const sonnet = Number(scores.sonnet ?? 0);
      const gpt5_5 = Number(scores.gpt5_5 ?? 0);
      const joint = Math.min(sonnet, gpt5_5);
      const probe = probeMap.get(probeId);
      return { probeId, sonnet, gpt5_5, joint, probe };
    })
    .filter((r) => r.probe)
    .sort((a, b) => a.joint - b.joint);

  return ranked.slice(0, 5).map((r) => ({
    probeId: r.probeId,
    stratum: r.probe.stratum,
    repo: r.probe.repo,
    jointScore: Number(r.joint.toFixed(3)),
    query: r.probe.query,
    toolCalls: [],
    answer: '(trajectory not retained; agent answer placeholder)',
    expectedFiles: r.probe.expectedFiles || [],
  }));
}

async function main() {
  const bank = loadPromptBank();
  const t2 = bank.find((e) => e._kind === 'prompt' && e.hash === T2_HASH);
  if (!t2) throw new Error(`T2 (${T2_HASH}) not found in prompt-bank.jsonl`);
  const candidate = t2.text;

  const failures = pickT2WorstProbes();
  console.log(`Loaded T2 (${T2_HASH}) — ${candidate.length} chars`);
  console.log(`5 worst-joint probes for T2:`);
  for (const f of failures) {
    console.log(`  ${f.probeId.padEnd(12)} joint=${f.jointScore}  stratum=${f.stratum}  repo=${f.repo}`);
  }

  const contract = buildTokenContract(candidate);
  console.log('\nTOKEN PRESERVATION CONTRACT preview:');
  console.log(contract.trim().split('\n').slice(0, 12).map((l) => '  ' + l).join('\n'));

  const callModel = (req) => runJudge(withMutatorCallDefaults(req));

  const results = [];
  for (let i = 1; i <= 3; i++) {
    process.stdout.write(`\nRun ${i}/3 — calling Kimi K2.6 reflector ... `);
    const t0 = Date.now();
    const res = await runReflectiveRewrite({ candidate, failures, callModel });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const status = res.accepted ? 'ACCEPTED' : 'REJECTED';
    console.log(`${status} (${dt}s)`);
    if (!res.accepted) {
      console.log('  rejection.failures:', JSON.stringify(res.rejection?.failures ?? res.rejection));
    } else {
      console.log(`  mutated length: ${res.mutated.length} chars`);
    }
    results.push({ run: i, accepted: !!res.accepted, rejection: res.rejection ?? null, wall_s: Number(dt) });
  }

  const passed = results.filter((r) => r.accepted).length;
  const multiplicityChanged = results.filter(
    (r) => !r.accepted && (r.rejection?.failures ?? []).some((f) => f.reason === 'multiplicity-changed'),
  ).length;

  console.log('\n=== SMOKE SUMMARY ===');
  console.log(`accepted:                 ${passed}/3`);
  console.log(`multiplicity-changed:     ${multiplicityChanged}/3`);
  console.log(`pass criterion (3/3):     ${passed === 3 ? 'PASS' : 'FAIL'}`);
  if (passed !== 3) process.exit(1);
}

main().catch((e) => { console.error('SMOKE ERROR:', e?.stack ?? e); process.exit(2); });
