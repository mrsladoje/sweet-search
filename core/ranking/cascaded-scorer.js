/**
 * Cascaded Scorer (Section 26 — Semantic Pipeline Restructuring)
 *
 * Streamlined scoring cascade: MaxSim → confidence gate → conditional cross-encoder.
 * Runs after graph expansion so expanded entities also get real scores.
 *
 * Designed as a standalone module with explicit dependency injection —
 * no `this` binding, no prototype wiring, fully testable in isolation.
 */

/**
 * Determine whether the MaxSim score distribution is confident enough to skip
 * the cross-encoder. Uses multiple cheap signals for better discrimination
 * than margin alone.
 *
 * @param {number[]} scores - MaxSim scores (higher = better)
 * @param {number} marginThreshold - Gap threshold for primary signal
 * @param {Object} [context] - Optional context signals
 * @param {boolean} [context.lexicalConfident] - Lexical path was confident
 * @param {number} [context.withTokens] - How many candidates had LI tokens
 * @param {number} [context.totalCandidates] - Total candidate count
 * @returns {{ decisive: boolean, reason: string, signals: Object }}
 */
export function isDecisive(scores, marginThreshold = 0.08, context = {}) {
  if (!scores || scores.length < 2) {
    return { decisive: true, reason: 'single_candidate', signals: {} };
  }

  const sorted = [...scores].sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];

  // Signal 1: Margin (primary) — large gap = clear winner
  const marginDecisive = gap > marginThreshold;

  // Signal 2: Top-K flatness — low std = model can't discriminate
  const topK = sorted.slice(0, Math.min(10, sorted.length));
  const mean = topK.reduce((a, b) => a + b, 0) / topK.length;
  const std = Math.sqrt(topK.reduce((s, v) => s + (v - mean) ** 2, 0) / topK.length);
  const flat = std < 0.02;

  // Signal 3: Lexical confidence — if lexical path was already confident, skip CE
  const lexicalConfident = context.lexicalConfident || false;

  // Signal 4: Token coverage — if most candidates lack LI tokens, CE is more valuable
  const lowCoverage = context.withTokens !== undefined
    && context.totalCandidates > 0
    && (context.withTokens / context.totalCandidates) < 0.5;

  const signals = { gap, std, flat, marginDecisive, lexicalConfident, lowCoverage };

  // Decision logic:
  // - Lexical confident → always decisive (skip CE)
  // - Large margin AND not flat → decisive
  // - Flat scores → NOT decisive (CE needed for discrimination)
  // - Low token coverage → NOT decisive (MaxSim had limited signal)
  if (lexicalConfident) {
    return { decisive: true, reason: 'lexical_confident', signals };
  }
  if (lowCoverage) {
    return { decisive: false, reason: 'low_coverage', signals };
  }
  if (marginDecisive && !flat) {
    return { decisive: true, reason: `clear_winner (gap=${gap.toFixed(3)})`, signals };
  }
  if (flat) {
    return { decisive: false, reason: `flat_scores (std=${std.toFixed(4)})`, signals };
  }
  if (!marginDecisive) {
    return { decisive: false, reason: 'ambiguous', signals };
  }

  return { decisive: true, reason: `margin_ok (gap=${gap.toFixed(3)})`, signals };
}

/**
 * Compute adaptive K for CE candidate selection.
 * Finds the largest score gap in the top-K_max as a natural cluster boundary.
 * - Clear cluster boundary → send the top cluster (fewer candidates)
 * - Flat scores (no significant gap) → send kMax (CE needs to see more)
 *
 * @param {number[]} scores - Sorted MaxSim scores (descending)
 * @param {number} kMax - Maximum candidates to send (cap)
 * @param {number} kMin - Minimum candidates to send (floor)
 * @returns {number}
 */
export function computeAdaptiveK(scores, kMax = 20, kMin = 3) {
  if (scores.length <= kMin) return scores.length;

  const limit = Math.min(scores.length - 1, kMax);

  // Find the largest gap and the overall score range
  let maxGap = -1;
  let cutoff = limit;

  for (let i = 0; i < limit; i++) {
    const gap = scores[i] - scores[i + 1];
    if (gap > maxGap) {
      maxGap = gap;
      cutoff = i + 1;
    }
  }

  // If the largest gap is insignificant (flat scores), send kMax.
  // MaxSim can't discriminate → CE needs maximum context.
  const range = scores[0] - scores[limit];
  if (range < 0.01 || maxGap < 0.005) {
    return Math.min(kMax, scores.length);
  }

  return Math.max(kMin, Math.min(cutoff, kMax));
}

/**
 * Partition candidates into those with pre-indexed LI tokens and those without.
 *
 * @param {Array} candidates
 * @param {Object|null} liIndex - LateInteractionIndex or null
 * @returns {{ withTokens: Array, withoutTokens: Array }}
 */
function partitionByTokenAvailability(candidates, liIndex) {
  if (!liIndex) {
    return { withTokens: [], withoutTokens: [...candidates] };
  }
  // Graph-expanded candidates have entity_id-based public ids that don't
  // match LI-indexed chunk ids; they carry the resolved chunk id under
  // _liChunkId. Honour it so expanded candidates can participate in MaxSim.
  const lookupId = (c) => c._liChunkId || c.id || c.entity_id;
  const available = liIndex.hasTokens(candidates.map(lookupId));
  const withTokens = [];
  const withoutTokens = [];
  for (const c of candidates) {
    (available.has(lookupId(c)) ? withTokens : withoutTokens).push(c);
  }
  return { withTokens, withoutTokens };
}

function stripInternalFields(candidate) {
  const { _unscored, ...rest } = candidate;
  return rest;
}

function extractCeScore(r) {
  return r.localRerankerScore ?? r.jinaScore ?? r.voyageScore ?? r.flashRankScore ?? 0;
}

/**
 * Cascaded scoring: MaxSim → confidence gate → conditional cross-encoder.
 *
 * @param {string} query - Search query
 * @param {Array} candidates - Candidates with optional pre-indexed LI tokens
 * @param {Object} options
 * @param {Object|null} options.lateInteractionIndex - LI index for MaxSim, or null for CE-only
 * @param {Object} options.crossEncoder - Reranker instance with rerankDirect()
 * @param {number} [options.ceTopK=20] - K_max for adaptive-K candidate selection
 * @param {number} [options.gateThreshold=0.08] - MaxSim score gap for decisive classification
 * @param {boolean} [options.forceFullCrossEncoder=false] - Bypass gate, CE on all
 * @param {boolean} [options.shadowMode=false] - Log gate/CE decisions without changing ranking
 * @param {boolean} [options.lexicalConfident=false] - Whether lexical path was confident
 * @param {Function} options.loadDocumentContent - Async fn to load full text for CE
 * @returns {Promise<{results: Array, stats: Object}>}
 */
export async function cascadedScore(query, candidates, options = {}) {
  const {
    lateInteractionIndex = null,
    crossEncoder,
    ceTopK = 20,
    gateThreshold = 0.08,
    forceFullCrossEncoder = false,
    shadowMode = false,
    lexicalConfident = false,
    loadDocumentContent,
  } = options;

  const stats = {
    totalCandidates: candidates.length,
    withTokens: 0,
    withoutTokens: 0,
    decisive: false,
    gateReason: null,
    gateSignals: null,
    ceInvoked: false,
    ceProvider: null,
    ceCandidates: 0,
    ceTokens: 0,
    adaptiveK: null,
  };

  if (!candidates || candidates.length === 0) {
    return { results: [], stats };
  }

  // Single candidate — decisive by default
  if (candidates.length === 1) {
    stats.decisive = true;
    stats.gateReason = 'single_candidate';
    return { results: [...candidates], stats };
  }

  // Step 1: Partition candidates by LI token availability
  const { withTokens, withoutTokens } = partitionByTokenAvailability(
    candidates, lateInteractionIndex,
  );
  stats.withTokens = withTokens.length;
  stats.withoutTokens = withoutTokens.length;

  // Step 2: If no LI index, all go to CE (CE-only fallback)
  if (!lateInteractionIndex) {
    stats.gateReason = 'no_li_index';
    return runCrossEncoder(query, candidates, candidates, stats, {
      crossEncoder, ceTopK: candidates.length, loadDocumentContent, forceFullCrossEncoder,
    });
  }

  if (withTokens.length === 0) {
    stats.gateReason = 'no_scored_candidates';
    return runCrossEncoder(query, candidates, candidates, stats, {
      crossEncoder, ceTopK: candidates.length, loadDocumentContent, forceFullCrossEncoder,
    });
  }

  // Step 3: Score candidates that have LI tokens via MaxSim
  let scoredWithTokens = withTokens;
  if (withTokens.length > 0) {
    try {
      const { encodeQuery } = await import('./late-interaction-model.js');
      const queryTokens = await encodeQuery(query);

      if (queryTokens && queryTokens.length > 0) {
        scoredWithTokens = await lateInteractionIndex.scoreWithLateInteraction(
          queryTokens, withTokens,
        );
      }
    } catch (err) {
      // MaxSim encoding failed — treat all as unscored, fall to CE
      stats.gateReason = `maxsim_error: ${err.message}`;
      const allCandidates = [...withTokens, ...withoutTokens];
      return runCrossEncoder(query, allCandidates, allCandidates, stats, {
        crossEncoder, ceTopK: Math.min(ceTopK, allCandidates.length),
        loadDocumentContent, forceFullCrossEncoder,
      });
    }
  }

  // Step 4: Score assignment + margin gate
  for (const c of scoredWithTokens) {
    c.preLateInteractionScore = c.score ?? c.int8Score ?? 0;
    const liScore = c.lateInteractionScore;
    c.score = Number.isFinite(liScore) ? liScore : (c.preLateInteractionScore || 0);
  }
  scoredWithTokens.sort((a, b) => b.score - a.score);

  const maxsimScores = scoredWithTokens.map(c => c.score);
  const { decisive, reason, signals } = isDecisive(maxsimScores, gateThreshold, {
    lexicalConfident,
    withTokens: stats.withTokens,
    totalCandidates: stats.totalCandidates,
  });
  stats.decisive = decisive;
  stats.gateReason = reason;
  stats.gateSignals = signals;

  const allRanked = [...scoredWithTokens, ...withoutTokens];

  // Shadow mode: compute CE in shadow, log results, return MaxSim ranking unchanged
  if (shadowMode && !forceFullCrossEncoder) {
    try {
      const adaptiveK = computeAdaptiveK(maxsimScores, ceTopK);
      const ceCandidates = allRanked.slice(0, adaptiveK);
      const shadowCeResult = await runCrossEncoder(query, allRanked, ceCandidates, { ...stats }, {
        crossEncoder, ceTopK: adaptiveK, loadDocumentContent, forceFullCrossEncoder: false,
      });

      const ceTop1 = shadowCeResult.results[0]?.id || shadowCeResult.results[0]?.entity_id;
      const maxsimTop1 = allRanked[0]?.id || allRanked[0]?.entity_id;
      const ceTop3Set = new Set(shadowCeResult.results.slice(0, 3).map(r => r.id || r.entity_id));
      const maxsimTop3Set = new Set(allRanked.slice(0, 3).map(r => r.id || r.entity_id));
      const top3Diff = [...ceTop3Set].filter(id => !maxsimTop3Set.has(id)).length > 0;

      console.log(JSON.stringify({
        shadow_cascade: true,
        gap: signals.gap,
        topKStd: signals.std,
        flat: signals.flat,
        adaptiveK,
        decisive,
        gateReason: reason,
        ceChangedTop1: ceTop1 !== maxsimTop1,
        ceChangedTop3: top3Diff,
        ceLatencyMs: shadowCeResult.stats.ceLatencyMs,
        queryLength: query.length,
      }));
    } catch (err) {
      console.log(JSON.stringify({
        shadow_cascade: true,
        shadow_error: err.message,
        decisive,
        gateReason: reason,
      }));
    }

    // Return pure MaxSim ranking unchanged (shadow does not affect results)
    stats.gateReason = `shadow:${reason}`;
    return { results: allRanked, stats };
  }

  // Normal path: decisive → return MaxSim ranking (skip CE)
  if (decisive && !forceFullCrossEncoder) {
    return { results: allRanked, stats };
  }

  // forceFullCrossEncoder: send ALL candidates to CE (bypass adaptive-K)
  if (forceFullCrossEncoder) {
    return runCrossEncoder(query, allRanked, allRanked, stats, {
      crossEncoder, ceTopK: allRanked.length, loadDocumentContent, forceFullCrossEncoder,
    });
  }

  // CE rescue with adaptive-K
  const adaptiveK = computeAdaptiveK(maxsimScores, ceTopK);
  stats.adaptiveK = adaptiveK;
  const ceCandidates = allRanked.slice(0, adaptiveK);
  return runCrossEncoder(query, allRanked, ceCandidates, stats, {
    crossEncoder, ceTopK: adaptiveK, loadDocumentContent, forceFullCrossEncoder,
  });
}

/**
 * Run cross-encoder on selected candidates, merge results back into the full list.
 */
async function runCrossEncoder(query, allRanked, ceCandidates, stats, options) {
  const { crossEncoder, loadDocumentContent } = options;

  stats.ceInvoked = true;
  stats.ceCandidates = ceCandidates.length;

  try {
    const documents = await loadDocumentContent(ceCandidates, query);
    const ceResult = await crossEncoder.rerankDirect(query, documents, ceCandidates.length);

    stats.ceProvider = ceResult.model || 'unknown';
    stats.ceTokens = Math.ceil(query.length / 4) + (ceCandidates.length * 150);
    stats.ceLatencyMs = ceResult.latency_ms;

    // Build a map from CE result originalIndex → CE score
    const ceScoreMap = new Map();
    for (const r of ceResult.results) {
      const origCandidate = ceCandidates[r.originalIndex];
      if (origCandidate) {
        const id = origCandidate.id || origCandidate.entity_id;
        const ceScore = extractCeScore(r);
        ceScoreMap.set(id, ceScore);
      }
    }

    // Merge: CE reranks WITHIN its window, non-CE candidates keep their MaxSim positions.
    // CE-scored candidates are sorted by ceScore and placed back into the top-K slots.
    // Candidates outside the CE window stay in their original MaxSim order below.
    const ceWindow = ceCandidates.length;
    const ceScoredList = [];
    for (const r of ceResult.results) {
      const origCandidate = ceCandidates[r.originalIndex];
      if (origCandidate) {
        ceScoredList.push({
          ...stripInternalFields(origCandidate),
          ceScore: extractCeScore(r),
          preCeScore: origCandidate.lateInteractionScore,
          score: extractCeScore(r),
        });
      }
    }
    // CE results are already sorted by score descending from rerankDirect
    const nonCeCandidates = allRanked.slice(ceWindow);
    const merged = [...ceScoredList, ...nonCeCandidates];

    return { results: merged, stats };
  } catch (err) {
    // CE failed — fall back to MaxSim order (or input order if no MaxSim)
    stats.ceInvoked = false;
    stats.ceError = err.message;
    stats.gateReason = `ce_error: ${err.message}`;
    return { results: allRanked.map(stripInternalFields), stats };
  }
}
