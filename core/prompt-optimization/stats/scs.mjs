/**
 * Semantic Consistency Score (SCS) — §3.6 Post-convergence robustness.
 *
 * Implements the three-component SCS metric from ParaConsist (2026):
 *   AC  — Answer Consistency
 *   SS  — Semantic Similarity (cosine of output embeddings)
 *   LS  — Length Stability
 *   SCS — harmonic mean(AC, SS, LS)
 *
 * Correctness-weighted SCS (per GPT-5.5 review §C3) collapses SCS when the
 * prompt consistently gives the same WRONG answer. Ship gate:
 *   cwSCS ≥ DEFAULTS.scsShipGate  AND
 *   minParaphraseAccuracy ≥ DEFAULTS.minParaphraseAccuracy
 *
 * NOTE: do NOT import eval/agent-read-workflows/embeddings.js — cosine is
 * implemented locally here; the GEPA driver supplies precomputed vectors or
 * an injected embed fn.
 *
 * Plan reference: docs/PHASE7.md §3.6.
 */

import { DEFAULTS } from '../sweep/p7-shared.mjs';

// ─── local cosine similarity ───────────────────────────────────────────────

/**
 * Cosine similarity between two numeric vectors.
 * Returns 0 if either vector has zero norm.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} value in [-1, 1]
 */
export function cosine(a, b) {
  if (a.length !== b.length) {
    throw new RangeError(`cosine: vector length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── normalisation helper ─────────────────────────────────────────────────

function normalizeAnswer(s) {
  return String(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

// ─── answer consistency ───────────────────────────────────────────────────

/**
 * Answer Consistency (AC).
 *
 * For each probe, check whether the LARGEST agreement cluster among the N
 * prompt answers reaches ≥ ceil(5/7 × N) members (= 5 of 7 at N=7, the §3.6
 * threshold). AC = fraction of probes that pass.
 *
 * We compute the largest cluster directly — for each candidate answer, count
 * how many answers agree with it under `answersAgree`, and take the max. This
 * is correct for ANY agreement relation, including a non-transitive semantic
 * `answersAgree` (e.g. "answers agree if cosine > 0.9" for free-text agent
 * answers). Determining a "modal" head by exact-match and then counting
 * agreement against it would mis-size the cluster under such relations.
 *
 * @param {object} args
 * @param {string[][]} args.perProbeAnswers   — outer: probes; inner: N=7 answer strings
 * @param {(a:string, b:string)=>boolean} [args.answersAgree]
 *   — injectable agreement predicate over NORMALISED answers; defaults to
 *     exact-match. Inputs are normalised (lowercased, whitespace-collapsed)
 *     before being handed to this fn.
 * @returns {number} AC in [0, 1]
 */
export function answerConsistency({ perProbeAnswers, answersAgree }) {
  if (!Array.isArray(perProbeAnswers) || perProbeAnswers.length === 0) {
    throw new TypeError('scs.answerConsistency: perProbeAnswers must be a non-empty array');
  }
  // Inputs are pre-normalised below, so the default predicate is plain equality.
  const agree = answersAgree || ((a, b) => a === b);
  let agreeingProbes = 0;
  for (const answers of perProbeAnswers) {
    const N = answers.length;
    if (N === 0) continue;
    const threshold = Math.ceil((5 / 7) * N);
    const norm = answers.map(normalizeAnswer);
    // Largest agreement cluster: max over candidates of how many answers
    // (including itself) agree with that candidate.
    let largestCluster = 0;
    for (let i = 0; i < N; i++) {
      let cluster = 0;
      for (let j = 0; j < N; j++) {
        if (agree(norm[i], norm[j])) cluster++;
      }
      if (cluster > largestCluster) largestCluster = cluster;
    }
    if (largestCluster >= threshold) agreeingProbes++;
  }
  return agreeingProbes / perProbeAnswers.length;
}

// ─── semantic similarity ──────────────────────────────────────────────────

/**
 * Semantic Similarity (SS).
 *
 * For each probe, compute the mean pairwise cosine of the N embedding
 * vectors, then average over probes.
 *
 * @param {object} args
 * @param {number[][][]} args.perProbeEmbeddings — outer: probes; inner: N vectors
 * @returns {number} SS in [0, 1] (typically; can be negative with adversarial vectors)
 */
export function semanticSimilarity({ perProbeEmbeddings }) {
  if (!Array.isArray(perProbeEmbeddings) || perProbeEmbeddings.length === 0) {
    throw new TypeError('scs.semanticSimilarity: perProbeEmbeddings must be a non-empty array');
  }
  let probeSum = 0;
  for (const vecs of perProbeEmbeddings) {
    const N = vecs.length;
    if (N <= 1) {
      probeSum += 1; // single vector is trivially consistent with itself
      continue;
    }
    let pairSum = 0;
    let pairCount = 0;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        pairSum += cosine(vecs[i], vecs[j]);
        pairCount++;
      }
    }
    probeSum += pairCount > 0 ? pairSum / pairCount : 1;
  }
  return probeSum / perProbeEmbeddings.length;
}

// ─── length stability ─────────────────────────────────────────────────────

/**
 * Length Stability (LS).
 *
 * For each probe: `1 - stddev(tokenCounts) / mean(tokenCounts)`, averaged
 * over probes. Guards against mean=0 (returns 0 for that probe).
 * Uses population stddev (divide by N).
 *
 * @param {object} args
 * @param {number[][]} args.perProbeTokenCounts — outer: probes; inner: N token counts
 * @returns {number} LS in (-∞, 1]; expected to be close to 1 for stable outputs
 */
export function lengthStability({ perProbeTokenCounts }) {
  if (!Array.isArray(perProbeTokenCounts) || perProbeTokenCounts.length === 0) {
    throw new TypeError('scs.lengthStability: perProbeTokenCounts must be a non-empty array');
  }
  let probeSum = 0;
  for (const counts of perProbeTokenCounts) {
    const N = counts.length;
    if (N === 0) { probeSum += 0; continue; }
    const mean = counts.reduce((s, x) => s + x, 0) / N;
    if (mean === 0) { probeSum += 0; continue; }
    const variance = counts.reduce((s, x) => s + (x - mean) ** 2, 0) / N;
    const stddev = Math.sqrt(variance);
    probeSum += 1 - stddev / mean;
  }
  return probeSum / perProbeTokenCounts.length;
}

// ─── SCS (harmonic mean) ──────────────────────────────────────────────────

/**
 * SCS = harmonic mean(AC, SS, LS).
 * Any zero component collapses the harmonic mean to 0 (guarded).
 *
 * @param {object} args
 * @param {number} args.ac
 * @param {number} args.ss
 * @param {number} args.ls
 * @returns {number}
 */
export function scs({ ac, ss, ls }) {
  if (ac <= 0 || ss <= 0 || ls <= 0) return 0;
  return 3 / (1 / ac + 1 / ss + 1 / ls);
}

// ─── correctness-weighted SCS ─────────────────────────────────────────────

/**
 * cwSCS = SCS × minParaphraseAccuracy.
 *
 * Per GPT-5.5 review §C3 — anti-stable-wrongness: a prompt that consistently
 * gives the same WRONG answer scores high on naive SCS; correctness-weighting
 * collapses it.
 *
 * @param {object} args
 * @param {number} args.scs
 * @param {number} args.minParaphraseAccuracy — lowest paraphrase accuracy in [0,1]
 * @returns {number}
 */
export function correctnessWeightedScs({ scs: scsVal, minParaphraseAccuracy }) {
  return scsVal * minParaphraseAccuracy;
}

// ─── ship gate ────────────────────────────────────────────────────────────

/**
 * Ship gate: cwSCS ≥ DEFAULTS.scsShipGate AND
 *            minParaphraseAccuracy ≥ DEFAULTS.minParaphraseAccuracy.
 *
 * @param {object} args
 * @param {number} args.cwSCS
 * @param {number} args.minParaphraseAccuracy
 * @returns {boolean}
 */
export function shipGate({ cwSCS, minParaphraseAccuracy }) {
  return cwSCS >= DEFAULTS.scsShipGate && minParaphraseAccuracy >= DEFAULTS.minParaphraseAccuracy;
}

// ─── async orchestrator ────────────────────────────────────────────────────

/**
 * computeScsReport — full SCS pipeline orchestrator.
 *
 * Runs all prompts × probes through evaluate(), collects answers +
 * token counts + correctness flags, embeds all answers, then computes
 * AC / SS / LS / SCS / cwSCS.
 *
 * @param {object} args
 * @param {object[]} args.probes   — probe records (must have .id)
 * @param {string[]} args.prompts  — N prompt texts (winner + paraphrases)
 * @param {(promptText:string, probe:object) => Promise<{answer:string, tokenCount:number, correct:boolean}>} args.evaluate
 *   — runs one (prompt, probe) pair; injectable for testing
 * @param {(texts:string[]) => Promise<number[][]>} args.embed
 *   — embeds a batch of answer strings; injectable for testing
 * @returns {Promise<{ac:number, ss:number, ls:number, scs:number, cwSCS:number, minParaphraseAccuracy:number, pass:boolean}>}
 */
export async function computeScsReport({ probes, prompts, evaluate, embed }) {
  if (!Array.isArray(probes) || probes.length === 0) {
    throw new TypeError('computeScsReport: probes must be a non-empty array');
  }
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new TypeError('computeScsReport: prompts must be a non-empty array');
  }
  if (typeof evaluate !== 'function') {
    throw new TypeError('computeScsReport: evaluate must be a function');
  }
  if (typeof embed !== 'function') {
    throw new TypeError('computeScsReport: embed must be a function');
  }

  const N = prompts.length;
  const nProbes = probes.length;

  // results[probeIdx][promptIdx] = {answer, tokenCount, correct}
  const results = Array.from({ length: nProbes }, () => Array(N));
  for (let pi = 0; pi < nProbes; pi++) {
    for (let qi = 0; qi < N; qi++) {
      results[pi][qi] = await evaluate(prompts[qi], probes[pi]);
    }
  }

  // Embed all answers in one batch call
  const allAnswers = results.flatMap((probeResults) => probeResults.map((r) => r.answer));
  const allVectors = await embed(allAnswers);

  // Reshape into perProbeEmbeddings[nProbes][N]
  const perProbeEmbeddings = Array.from({ length: nProbes }, (_, pi) =>
    Array.from({ length: N }, (__, qi) => allVectors[pi * N + qi]),
  );

  // perProbeAnswers[nProbes][N]
  const perProbeAnswers = results.map((probeResults) => probeResults.map((r) => r.answer));

  // perProbeTokenCounts[nProbes][N]
  const perProbeTokenCounts = results.map((probeResults) =>
    probeResults.map((r) => r.tokenCount),
  );

  const ac = answerConsistency({ perProbeAnswers });
  const ss = semanticSimilarity({ perProbeEmbeddings });
  const ls = lengthStability({ perProbeTokenCounts });
  const scsVal = scs({ ac, ss, ls });

  // min_paraphrase_accuracy: for each prompt variant, compute accuracy across all probes,
  // then take the minimum across variants (§3.6: "lowest-accuracy paraphrase's correctness-on-gold")
  const perPromptAccuracies = Array.from({ length: N }, (_, qi) => {
    const correct = results.filter((probeResults) => probeResults[qi].correct).length;
    return correct / nProbes;
  });
  const minParaphraseAccuracy = Math.min(...perPromptAccuracies);

  const cwSCS = correctnessWeightedScs({ scs: scsVal, minParaphraseAccuracy });
  const pass = shipGate({ cwSCS, minParaphraseAccuracy });

  return { ac, ss, ls, scs: scsVal, cwSCS, minParaphraseAccuracy, pass };
}
