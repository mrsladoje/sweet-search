#!/usr/bin/env node
/**
 * GEN-3 SEED ABLATION — scores the diverse gen-3 seed set on the full 40 dev probes
 * (3 reps × both targets) and assembles the initial Pareto front for a later
 * `gepa.mjs --initial-front` launch. STOPS here (no evolution / no round 1).
 *
 * Seed set (post-screen): {A champion, B first-call, C result-thrift, T2 perfect-acc
 * anchor}. R/N/D dropped (screen accuracy regression / no-go). A/B/C are re-ablated
 * here with FULL candidate-object capture (the operators read per-probe detail +
 * nativeRelative.breakdown); T2's full object is reused from the gen-2 front.
 *
 *   node scripts/ablate-gen3-seeds.mjs           # A,B,C fresh (3-rep) + T2 reused
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidate } from '../core/prompt-optimization/sweep/gepa-scoring.mjs';
import { makeRealEvaluateCandidate } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPS = 3;
const CONC = 6;
const FRESH = ['A', 'B', 'C']; // re-ablated; T2 reused from gen-2 front
const OUT = path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-initial-front.json');

const probesRaw = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const probes = Array.isArray(probesRaw) ? probesRaw : (probesRaw.probes || probesRaw.dev || []);
const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-native-baseline-dev-3panel.json'), 'utf8'));
const evaluateCandidate = makeRealEvaluateCandidate({ agentProvider: 'api' });
const promptFor = (k) => fs.readFileSync(path.join(REPO, `core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/${k}.md`), 'utf8');

const members = [];
for (const id of FRESH) {
  console.error(`\n=== ablating ${id}: ${probes.length} probes × 2 targets × ${REPS} reps (conc ${CONC}) ===`);
  const cand = await buildCandidate({
    id, prompt: promptFor(id), sourceOp: 'gen3-seed', parentHash: null,
    probes, weights: probes.map(() => 1), evaluateCandidate,
    nativeBaselineByTarget: baseline, concurrency: CONC, repeats: REPS,
  });
  members.push(cand);
  console.error(`${id}: finalScore=${cand.finalScore.toFixed(4)} taskScore=${cand.taskScore.toFixed(4)} cost$=${(cand.costUsd ?? 0).toFixed(4)} (sonnet ${cand.score_sonnet.toFixed(3)}/gpt ${cand.score_gpt5_5.toFixed(3)})`);
}

// Reuse T2's full object (perfect-accuracy anchor) from the gen-2 front.
const gen2 = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen2-initial-front.json'), 'utf8'));
const t2 = gen2.find((x) => x.id === 'T2');
if (t2) { members.push(t2); console.error(`\nT2 (reused, gen-2 2-rep object): finalScore=${t2.finalScore.toFixed(4)} taskScore=${(t2.taskScore ?? 0).toFixed(4)} cost$=${(t2.costUsd ?? 0).toFixed(4)}`); }

// ── diversity gate: pairwise word-set Jaccard (report; flag near-duplicates) ──
const wordSet = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
const jac = (a, b) => { const A = wordSet(a); const B = wordSet(b); let inter = 0; for (const w of A) if (B.has(w)) inter++; return inter / (A.size + B.size - inter); };
console.error('\n── diversity matrix (word-Jaccard; >0.85 = near-duplicate) ──');
const ids = members.map((m) => m.id);
console.error('       ' + ids.map((i) => i.padStart(6)).join(''));
for (let i = 0; i < members.length; i++) {
  const row = members.map((m, j) => (j <= i ? '     -' : jac(members[i].prompt, m.prompt).toFixed(2).padStart(6))).join('');
  console.error(`${ids[i].padStart(6)} ${row}`);
}

fs.writeFileSync(OUT, JSON.stringify(members, null, 2));
console.error(`\nwrote ${members.length}-member gen-3 initial front → ${OUT}`);
console.error('STOP: seed ablation complete. Round 1 NOT started (per instruction).');
