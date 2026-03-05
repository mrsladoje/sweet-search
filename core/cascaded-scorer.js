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
 * Determine whether the MaxSim score distribution is decisive enough to skip
 * the cross-encoder. A gap > threshold between #1 and #2 means a clear winner.
 *
 * IMPORTANT: Tight clusters (all scores within a narrow band) are NOT decisive.
 * Clustered MaxSim scores mean the model cannot discriminate — this is exactly
 * when the cross-encoder's full attention is most likely to reorder results.
 *
 * @param {number[]} scores - MaxSim scores (higher = better)
 * @param {number} threshold - Gap required for decisive classification
 * @returns {{ decisive: boolean, reason: string }}
 */
export function isDecisive(scores, threshold = 0.12) {
  if (!scores || scores.length < 2) {
    return { decisive: true, reason: 'single_candidate' };
  }
  const sorted = [...scores].sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];
  if (gap > threshold) {
    return { decisive: true, reason: `clear_winner (gap=${gap.toFixed(3)})` };
  }
  return { decisive: false, reason: 'ambiguous' };
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
  const available = liIndex.hasTokens(candidates.map(c => c.id || c.entity_id));
  const withTokens = [];
  const withoutTokens = [];
  for (const c of candidates) {
    (available.has(c.id || c.entity_id) ? withTokens : withoutTokens).push(c);
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
 * @param {number} [options.ceTopK=8] - Max candidates to send to cross-encoder
 * @param {number} [options.gateThreshold=0.12] - MaxSim score gap for decisive classification
 * @param {boolean} [options.forceFullCrossEncoder=false] - Bypass gate, CE on all
 * @param {Function} options.loadDocumentContent - Async fn to load full text for CE
 * @returns {Promise<{results: Array, stats: Object}>}
 */
export async function cascadedScore(query, candidates, options = {}) {
  const {
    lateInteractionIndex = null,
    crossEncoder,
    ceTopK = 8,
    gateThreshold = 0.12,
    forceFullCrossEncoder = false,
    loadDocumentContent,
  } = options;

  const stats = {
    totalCandidates: candidates.length,
    withTokens: 0,
    withoutTokens: 0,
    decisive: false,
    gateReason: null,
    ceInvoked: false,
    ceProvider: null,
    ceCandidates: 0,
    ceTokens: 0,
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

  // Step 4: Confidence gate on MaxSim scores
  const maxSimScores = scoredWithTokens.map(c => c.lateInteractionScore ?? 0);
  const gateResult = isDecisive(maxSimScores, gateThreshold);
  stats.decisive = gateResult.decisive;
  stats.gateReason = gateResult.reason;

  // Step 5: Merge scored + unscored
  // Unscored go at bottom with a sentinel score lower than any real MaxSim score
  const unscoredWithSentinel = withoutTokens.map(c => ({
    ...c,
    lateInteractionScore: -Infinity,
    _unscored: true,
  }));
  const allRanked = [...scoredWithTokens, ...unscoredWithSentinel];

  // Step 6: If decisive AND no unscored AND not forcing CE → done
  if (gateResult.decisive && withoutTokens.length === 0 && !forceFullCrossEncoder) {
    return { results: allRanked, stats };
  }

  // Step 7: CE needed — select candidates
  // forceFullCrossEncoder → ALL scored go to CE (no ceTopK limit)
  // normal → top ceTopK from scored + ALL unscored
  const ceCandidatesFromScored = forceFullCrossEncoder
    ? scoredWithTokens
    : scoredWithTokens.slice(0, ceTopK);
  const ceCandidates = [...ceCandidatesFromScored, ...withoutTokens];

  return runCrossEncoder(query, allRanked, ceCandidates, stats, {
    crossEncoder, ceTopK, loadDocumentContent, forceFullCrossEncoder,
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
    const documents = await loadDocumentContent(ceCandidates);
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

    // Merge CE scores into candidates: CE score overrides MaxSim for reranked candidates
    const merged = allRanked.map(c => {
      const id = c.id || c.entity_id;
      const ceScore = ceScoreMap.get(id);
      if (ceScore !== undefined) {
        return {
          ...stripInternalFields(c),
          ceScore,
          preCeScore: c.lateInteractionScore,
          score: ceScore,
        };
      }
      return c;
    });

    // Sort: CE-scored first (by ceScore), then MaxSim-scored (by lateInteractionScore),
    // then unscored at bottom
    merged.sort((a, b) => {
      const aHasCe = a.ceScore !== undefined;
      const bHasCe = b.ceScore !== undefined;
      if (aHasCe && bHasCe) return b.ceScore - a.ceScore;
      if (aHasCe && !bHasCe) return -1;
      if (!aHasCe && bHasCe) return 1;
      // Both without CE: sort by lateInteractionScore (unscored = -Infinity)
      return (b.lateInteractionScore ?? 0) - (a.lateInteractionScore ?? 0);
    });

    return { results: merged, stats };
  } catch (err) {
    // CE failed — fall back to MaxSim order (or input order if no MaxSim)
    stats.ceInvoked = false;
    stats.ceError = err.message;
    stats.gateReason = `ce_error: ${err.message}`;
    return { results: allRanked.map(stripInternalFields), stats };
  }
}
