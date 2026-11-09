/**
 * Token estimation, per-result budget allocation, budget tiers, auto-tier selection and token-cap truncation.
 */

import { safeCall } from './related-rows.js';

/** Approximate token count for a code string (~3.5 chars per token). */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export const DEFAULT_TOKEN_BUDGET = 4000;

export const AGENT_FULL_TOKEN_BUDGET = 8000;

// Stretch budget — opt-in only via subMode 'agent_full_xl'. Gated on top-1
// dominance (>=2× top-2). Default remains compact 4k; this is for the
// "explicit, single dominant answer fits" case only.
export const AGENT_FULL_XL_TOKEN_BUDGET = 12000;

const DEFAULT_PER_RESULT_CAPS = [2000, 800, 400];

/**
 * Adaptive budget allocation.
 *
 * Base split: 60/20/20 (preview) or 40/30/30 (full).
 * Adaptations:
 *   - High retrieval breadth (broad regex / large candidate pool): sharpen top-1 (70/15/15)
 *   - In agent_full: only expand rank 2/3 to full if score gap < 2× from top-1
 *   - Unused top-1 cap is redistributed to top-2/3 when they are distinct
 *
 * Breadth signal generalization (for non-grep retrieval modes):
 *   - colgrep / pattern: uses `grepMatches` (existing behavior)
 *   - lexical / semantic / hybrid: uses `candidatePoolSize` if provided
 *   - falls back to 0 (no sharpening) if neither is set
 *
 * @param {number} totalBudget - Total token budget for all results
 * @param {number} numResults - Number of results
 * @param {string} subMode - 'agent_preview' | 'agent_full' | 'agent_full_xl'
 * @param {object} [context]
 * @param {number} [context.grepMatches] - Number of grep matches (colgrep)
 * @param {number} [context.candidatePoolSize] - Generic candidate pool (lexical/semantic/hybrid)
 * @param {Array<{score: number, file: string}>} [context.results] - Ranked results for score-gap gating
 * @param {'calibrated'|'all'} [context.firstUnit] - SS_FIX_SEARCH_FIRST_UNIT (default off): ranks
 *   past 3 get a FIRST_UNIT_TOKENS preview (signature + a few lines) instead of a summary line —
 *   'calibrated' ranks 4-5 only (dev: P(answer file) 29% / 21%, never shown with code), 'all' every
 *   rank. Rank 1's cap pays for the units only when the budget would otherwise be exceeded.
 * @returns {Array<{ presentation: 'full'|'preview'|'summary', tokenCap: number }>}
 */
export function allocateBudget(totalBudget, numResults, subMode = 'agent_preview', context = {}) {
  const allocations = allocateBudgetShipped(totalBudget, numResults, subMode, context);
  if (context.firstUnit !== 'calibrated' && context.firstUnit !== 'all') return allocations;
  const last = context.firstUnit === 'all' ? numResults : Math.min(numResults, FIRST_UNIT_CALIBRATED_RANKS);
  for (let i = 3; i < last; i++) {
    if (allocations[i].presentation === 'summary') allocations[i] = { presentation: 'preview', tokenCap: FIRST_UNIT_TOKENS, unit: true };
  }
  const over = allocations.reduce((n, a) => n + a.tokenCap, 0) - totalBudget;
  if (over > 0 && allocations[0]) allocations[0] = { ...allocations[0], tokenCap: Math.max(0, allocations[0].tokenCap - over) };
  return allocations;
}

const FIRST_UNIT_TOKENS = 60;

/** Rank 2/3 lose their code preview when top-1's score is at least this multiple of theirs. */
export const POINTER_TAIL_RATIO = 2.5;

const FIRST_UNIT_CALIBRATED_RANKS = 5;

function allocateBudgetShipped(totalBudget, numResults, subMode, context) {
  const allocations = [];
  const isFullMode = subMode === 'agent_full' || subMode === 'agent_full_xl';
  const isXlMode = subMode === 'agent_full_xl';
  // Generalized breadth signal: prefer `grepMatches` for backwards compatibility,
  // fall back to `candidatePoolSize` for non-grep retrieval modes (lexical/semantic/hybrid).
  const breadthHint = context.grepMatches ?? context.candidatePoolSize ?? 0;
  const results = context.results || [];

  // Adaptive split based on retrieval breadth
  let top1Share, top23Share;
  if (breadthHint > 200) {
    // Broad retrieval: sharpen top-1, reduce previews
    top1Share = 0.70;
    top23Share = 0.15;
  } else if (isFullMode) {
    top1Share = 0.40;
    top23Share = 0.30;
  } else {
    top1Share = 0.60;
    top23Share = 0.20;
  }

  // Stretch budget (agent_full_xl): allow per-result caps up to 8000 for top-1
  // when the gate fires (top1 >= 2 * top2). This is opt-in via subMode only.
  const xlPerResultCap = 8000;
  const baselinePerResultCap = DEFAULT_PER_RESULT_CAPS[0]; // 2000
  let xlGateActive = false;
  if (isXlMode && results.length > 0) {
    const top1Score = results[0]?.score || 0;
    const top2Score = results[1]?.score || 0;
    // Gate fires when top-1 dominates: 2× top-2 OR there is no top-2.
    xlGateActive = top1Score > 0 && (top2Score === 0 || top1Score >= 2 * top2Score);
  }
  // Turn-fusion mode (SWEET_SEARCH_FUSE_TOP=1): guarantee top-1 lands as the
  // COMPLETE symbol so the follow-up read turn is redundant. Trades result
  // tokens (bounded below) for a whole saved agent turn (~44k re-sent tokens
  // on bench backbones). Off by default; measured pool: 97.9% of historical
  // search→read pairs survive truncation-level output (TURNFIX results §6).
  const fuseTop = process.env.SWEET_SEARCH_FUSE_TOP === '1';
  const top1HardCap = (xlGateActive || fuseTop) ? xlPerResultCap : baselinePerResultCap;

  for (let i = 0; i < numResults; i++) {
    if (i === 0) {
      let cap = Math.min(Math.floor(totalBudget * top1Share), top1HardCap);
      if (fuseTop) cap = Math.max(cap, 4000);
      allocations.push({ presentation: 'full', tokenCap: cap });
    } else if (i <= 2) {
      // In agent_full: gate full expansion on score gap from top-1.
      // Only expand to full if rank-N is competitive (score >= top-1 / 2).
      const top1Score = results[0]?.score || 0;
      const thisScore = results[i]?.score || 0;
      const isCompetitive = top1Score > 0 && thisScore >= top1Score / 2;

      // Pointer tail (owner decision 2026-10-04, default ON, agent formats): when top-1's score
      // is at least POINTER_TAIL_RATIO x this rank's, rank 2/3 print as one row (path, range,
      // kind, name) instead of a code preview. The agent can ss-read the span. (A second
      // trigger, `sufficient=YES`, was removed the same day: it hid gold ranks 2/3.)
      const pointerTail = context.agentFormat === true
        && top1Score > 0 && thisScore > 0 && top1Score >= POINTER_TAIL_RATIO * thisScore;
      if (pointerTail) {
        allocations.push({ presentation: 'summary', tokenCap: 0 });
      } else if (isFullMode && isCompetitive) {
        const cap = Math.min(Math.floor(totalBudget * top23Share), DEFAULT_PER_RESULT_CAPS[0]);
        allocations.push({ presentation: 'full', tokenCap: cap });
      } else {
        const previewCap = DEFAULT_PER_RESULT_CAPS[i] || DEFAULT_PER_RESULT_CAPS[2];
        const cap = Math.min(Math.floor(totalBudget * top23Share), previewCap);
        allocations.push({ presentation: 'preview', tokenCap: cap });
      }
    } else {
      allocations.push({ presentation: 'summary', tokenCap: 0 });
    }
  }

  return allocations;
}

/**
 * Truncate code to fit within a token cap.
 * Prefers keeping the beginning (signature + first N lines of body).
 * Never truncates mid-statement (looks for clean line breaks).
 *
 * @param {string} code
 * @param {number} tokenCap
 * @returns {{ code: string, truncated: boolean, originalTokens: number }}
 */
export function truncateToTokenCap(code, tokenCap) {
  if (!code) return { code: '', truncated: false, originalTokens: 0 };

  const originalTokens = estimateTokens(code);
  if (tokenCap <= 0) {
    return { code: '', truncated: true, originalTokens };
  }
  if (originalTokens <= tokenCap) {
    return { code, truncated: false, originalTokens };
  }

  // Truncate at approximately the right character count
  const maxChars = Math.floor(tokenCap * 3.5);
  const lines = code.split('\n');
  let charCount = 0;
  let cutLine = 0;

  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i].length + 1; // +1 for newline
    if (charCount >= maxChars) {
      cutLine = i;
      break;
    }
  }

  // Keep at least 1 line (the signature), but only keep 3 if within 2x budget.
  // This prevents tokenBudget:1 from producing 3 lines of code.
  const minLines = estimateTokens(lines.slice(0, 3).join('\n')) <= tokenCap * 2 ? 3 : 1;
  cutLine = Math.max(cutLine, minLines);

  const buildCandidate = (lineCount) => {
    if (lineCount <= 0) return '';
    const truncated = lines.slice(0, lineCount).join('\n');
    const remaining = lines.length - lineCount;
    return remaining > 0
      ? `${truncated}\n// ... (${remaining} more lines)`
      : truncated;
  };

  for (let lineCount = cutLine; lineCount >= minLines; lineCount--) {
    const candidate = buildCandidate(lineCount);
    if (candidate && estimateTokens(candidate) <= tokenCap) {
      return { code: candidate, truncated: true, originalTokens };
    }
  }

  for (let lineCount = Math.min(minLines - 1, lines.length); lineCount >= 1; lineCount--) {
    const withSuffix = buildCandidate(lineCount);
    if (withSuffix && estimateTokens(withSuffix) <= tokenCap) {
      return { code: withSuffix, truncated: true, originalTokens };
    }
  }

  // Not even one line and the cut marker fit: no code (a bare prefix would be a silent cut).
  return { code: '', truncated: true, originalTokens };
}

// Lines right above a definition that belong to it: doc comments, attributes, decorators.
const DEFINITION_LEAD_LINE = /^\s*(?:\/\/|\/\*|\*|#\[|#!\[|@|--)/;

/**
 * Code of an entry that will be cut, started at the definition it is named after: a chunk
 * that opens with the end of the previous function (jj `};  Ok(expression)  }` above
 * `fn resolve_referenced_commits`) printed that tail and was cut before the named function.
 * Agent format only. Returns the code and its new first line (null when unchanged).
 */
export function startAtNamedDefinition(code, expansion, tokenCap, codeGraphRepo, filePath, agentFormat) {
  const unchanged = { code, start: null };
  if (!agentFormat || !code || !expansion?.symbol || !Number.isInteger(expansion.startLine)) return unchanged;
  if (estimateTokens(code) <= tokenCap || typeof codeGraphRepo?.findEntitiesInRange !== 'function') return unchanged;
  const rows = safeCall(() => codeGraphRepo.findEntitiesInRange(filePath, expansion.startLine + 1, expansion.endLine ?? expansion.startLine)) || [];
  const def = rows.find((e) => e.name === expansion.symbol && e.startLine > expansion.startLine);
  if (!def) return unchanged;
  const lines = code.split('\n');
  let lead = def.startLine - expansion.startLine;
  if (lead <= 0 || lead >= lines.length) return unchanged;
  while (lead > 0 && DEFINITION_LEAD_LINE.test(lines[lead - 1])) lead--;
  if (lead <= 0) return unchanged;
  return { code: lines.slice(lead).join('\n'), start: expansion.startLine + lead };
}

/** `lines[0..n)` plus a visible `// ... (N more lines)` marker when lines are left out. */
function prefixWithCutMarker(lines, n) {
  const kept = lines.slice(0, n).join('\n');
  const remaining = lines.length - n;
  return remaining > 0 ? `${kept}\n// ... (${remaining} more lines)` : kept;
}

/**
 * Preview of a code block that fits `tokenCap`: the first lines (signature + the start of the
 * body, at least 3 lines when the cap allows) and, when lines are left out, a
 * `// ... (N more lines)` marker. The marker is part of the fit: a cut is never silent (the
 * previous form clamped the text afterwards and could drop the marker, or skipped it when the
 * kept text happened to contain `...`). Returns '' when not even one line and the marker fit.
 *
 * @param {string} code
 * @param {number} tokenCap
 * @returns {string}
 */
export function compressToPreview(code, tokenCap) {
  if (!code || !(tokenCap > 0)) return '';
  const lines = code.split('\n');
  if (estimateTokens(code) <= tokenCap) return code;
  const maxChars = Math.floor(tokenCap * 3.5);
  let n = 0;
  let chars = 0;
  for (const line of lines) {
    if (n >= 3 && chars + line.length + 1 > maxChars) break;
    chars += line.length + 1;
    n++;
  }
  for (; n >= 1; n--) {
    const candidate = prefixWithCutMarker(lines, n);
    if (estimateTokens(candidate) <= tokenCap) return candidate;
  }
  return '';
}

/**
 * Resolve the effective sub-mode from the format string.
 *
 * EXPLICIT TIERS (caller picks):
 *   'agent_preview' → 'agent_preview' (compact 4k budget)
 *   'agent_full'    → 'agent_full'    (8k budget)
 *   'agent_full_xl' → 'agent_full_xl' (12k budget, opt-in only;
 *                                      falls back to per-result baseline cap
 *                                      at allocation time when the top-1
 *                                      dominance gate fails)
 *
 * AUTO-PICK (default for the bare 'agent' format):
 *   'agent'         → tier chosen by selectAgentBudget(); see that fn.
 *
 * Used as a fallback when caller bypasses the auto-pick path (e.g. unit tests
 * that call resolveSubMode directly). Production code goes through
 * selectAgentBudget(format, signals) which understands auto-pick.
 */
export function resolveSubMode(format) {
  if (format === 'agent_full_xl') return 'agent_full_xl';
  if (format === 'agent_full') return 'agent_full';
  return 'agent_preview'; // 'agent' and 'agent_preview' both map here
}

//
// Picks the agent-mode budget tier (preview 4k / full 8k / xl 12k) from
// post-ranking signals when callers pass the bare format='agent'.
//
// DESIGN PRINCIPLE: 4k is enough for ~99% of queries.
//
// Lost-in-the-middle and RAG-vs-long-context studies (Liu et al., Xu et al.)
// consistently show that smaller, focused context outperforms bigger context
// for retrieval tasks. The preview tier already renders top-1 fully (up to
// 2000 tokens) and gives ranks 2-3 a signature + 5-line snippet — that's
// enough for the agent to either answer or to escalate via an explicit
// `format='agent_full'` re-query. Auto should NOT silently pay an 8k or 12k
// token bill on every borderline query.
//
// When does extra budget STRICTLY beat preview?
//
//   XL: top-1 itself needs >2k tokens. The dominance gate at allocation
//       (allocateBudget L1448-1454) raises top-1's per-result cap from 2k
//       → 8k IFF top-1 >= 2 * top-2. Without the gate, XL caps top-1 at
//       2k anyway — identical to preview for the top-1 case. So XL only
//       pays off when BOTH conditions hold: chunk really is big, AND
//       dominance gate will fire.
//
//   FULL: rank 2/3 need full body (each up to 2000 tokens) instead of a
//         signature + 5 lines. That's only useful when several results
//         are TIGHTLY tied — i.e. when there's no single answer, just a
//         set the agent must compare. A query with moderate dominance
//         (top-1 = 0.9, top-2 = 0.6) doesn't qualify; the agent can read
//         top-1 fully and re-query if needed.
//
// Decision tree (only fires when format='agent'; explicit tiers are pass-thru):
//
//   numResults == 0                                       → preview ('auto_empty')
//   top1Tokens >= 2400 AND (numResults == 1 OR D >= 2.5)  → xl      ('auto_xl_*')
//   numResults >= 10 AND D < 1.05 AND top1Tokens >= 600   → full    ('auto_full_tight_cluster')
//   default                                               → preview ('auto_preview_default')
//
// Thresholds are deliberately tight — designed so XL+FULL combined fire on
// roughly 1-5% of queries. On a fastify spot-check (NL queries with k=10),
// all 6 representative queries land on preview under this rule. Single
// dominant answers stay on preview unless the chunk is genuinely huge
// (200+ lines × 9 tokens/line ≥ 2400). Multi-result clusters need 10+ items
// within 5% of the top score before auto goes to full.
//
// Crucially: dominance answers "is top-1 the answer?", NOT "is top-1 big?".
// We require both signals (and a high-bar threshold on each) before paying
// the XL token cost. Likewise, "many results" alone is not a reason to
// upgrade — the cluster has to be tight (D < 1.05) AND deep (≥ 10 items).
//
// Signals (computeBudgetSignals, all post-ranking — pure):
//   - numResults  : ranked-results length
//   - dominance   : top1.score / top2.score (sentinel 99 for single result)
//   - top1Tokens  : estimated tokens of top-1 chunk (lineCount * 9, the
//                   same per-line conversion the rest of the packager uses).
//                   Equals 0 when start/end lines are unavailable — those
//                   results stay on preview.
//
// `breadth` (grepMatches / candidatePoolSize) and `entropy` are still
// computed and surfaced in `budgetSignals` for diagnostics, but neither
// drives the decision: a broad pool is not a reason to give top-1 more
// space, and small-N entropy is dominated by the 1/log(n) denominator and
// stops being a reliable distribution-width signal.

// Preview-tier budget: 3000 (was 4000 until 2026-06-11). The 4-model budget
// sweep (DeepSeek/MiMo/GPT-5.5-codex/Opus-CC, 12 dev probes, paired vs 4k)
// found 3k keeps every accuracy/usefulness metric flat-to-up with zero
// call-compensation, and cuts realized cost −11–15% on the flagship cells.
// Below 3k, flagship models re-buy the trimmed context with extra calls
// (Opus calls Δ: 3k −0.08 → 2.8k +0.33 → 2.5k +0.67 → 2k +0.83), erasing
// the savings — 3k is the floor. SWEET_SEARCH_PREVIEW_BUDGET overrides for
// experiments; full/xl escalation tiers are unchanged.
const PREVIEW_TIER_BUDGET = Number(process.env.SWEET_SEARCH_PREVIEW_BUDGET || '') || 3000;

const BUDGET_TIERS = {
  preview: { subMode: 'agent_preview', budget: PREVIEW_TIER_BUDGET },
  full:    { subMode: 'agent_full',    budget: 8000 },
  xl:      { subMode: 'agent_full_xl', budget: 12000 },
};

/**
 * Compute auto-pick signals from ranked results + searchStats.
 * Pure: does not look at file content or call into expensive code paths.
 *
 * @param {Array} rankedResults - Results after ranking pipeline (PRE-packaging)
 * @param {object} searchStats - Stats from the retrieval pipeline
 * @returns {{
 *   numResults: number, breadth: number, dominance: number,
 *   entropy: number, top1Tokens: number, top1LineCount: number
 * }}
 */
export function computeBudgetSignals(rankedResults, searchStats = {}) {
  const numResults = Array.isArray(rankedResults) ? rankedResults.length : 0;
  if (numResults === 0) {
    return { numResults: 0, breadth: 0, dominance: 0, entropy: 0, top1Tokens: 0, top1LineCount: 0 };
  }

  // Use whichever score field the ranker emitted. Pattern (colgrep) emits
  // `lateInteractionScore`; hybrid/semantic/lexical emit `score`. Keep both
  // paths working without renaming.
  const scores = rankedResults
    .map(r => Number(r?.score ?? r?.lateInteractionScore ?? 0))
    .filter(s => Number.isFinite(s) && s > 0);

  // Top-1 size proxy — derived from the chunk's start/end lines. Uses the
  // same 9 tokens/line conversion the rest of the packager applies (see
  // expandToSymbol / renderCode in structural-context.js). Returns 0 when
  // either bound is missing, in which case the auto-pick falls back to the
  // preview branch instead of guessing.
  const top1 = rankedResults[0] || {};
  const top1Start = top1.metadata?.startLine ?? top1.startLine ?? null;
  const top1End = top1.metadata?.endLine ?? top1.endLine ?? null;
  const top1LineCount = (top1Start != null && top1End != null && top1End >= top1Start)
    ? (top1End - top1Start + 1)
    : 0;
  const top1Tokens = top1LineCount * 9;

  if (scores.length === 0) {
    return { numResults, breadth: 0, dominance: 0, entropy: 0, top1Tokens, top1LineCount };
  }

  const topScore = scores[0];
  const secondScore = scores[1] ?? 0;
  // Sentinel "very high" dominance when there's only one positive-score result
  // — keeps single-answer queries on the preview path.
  const dominance = secondScore > 0 ? topScore / secondScore : 99;

  // Normalised Shannon entropy — KEPT FOR DIAGNOSTIC OUTPUT only. Not used
  // by selectAgentBudget after the small-N flaw was identified (2-result
  // entropy is forced into [0.7, 1.0] by the 1/log(n) denominator).
  let entropy = 0;
  if (scores.length > 1) {
    const sum = scores.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      let H = 0;
      for (const s of scores) {
        const p = s / sum;
        if (p > 0) H -= p * Math.log(p);
      }
      entropy = H / Math.log(scores.length);
    }
  }

  // Breadth — KEPT FOR DIAGNOSTIC OUTPUT only. Not used by tier selection
  // (broad candidate pools aren't a reason to give top-1 more tokens; only
  // top-1 actually being big is). `allocateBudget` still uses breadth for
  // its within-tier top-1-share sharpening (its job, not ours).
  const breadth = Number(
    searchStats?.grepMatches
    ?? searchStats?.candidatePoolSize
    ?? 0
  ) || 0;

  return { numResults, breadth, dominance, entropy, top1Tokens, top1LineCount };
}

/**
 * Pick the agent-mode tier for a request.
 *
 * Explicit tier formats (agent_preview / agent_full / agent_full_xl) are
 * pass-through. The bare 'agent' format triggers the auto-pick decision
 * tree using the signals above.
 *
 * Format-gating note: all return values keep `format='agent_*'` semantics,
 * so the `_isAgentFormat` ranking flag (file-kind-ranking.js:1443) remains
 * TRUE regardless of which tier we land on. Ranking is unchanged.
 *
 * @param {string} format - 'agent' | 'agent_preview' | 'agent_full' | 'agent_full_xl'
 * @param {object} signals - From computeBudgetSignals()
 * @param {object} [opts]
 * @param {number} [opts.explicitBudget] - Caller-supplied tokenBudget; if set,
 *   bypass auto-pick and infer the tier from the value (matches trace's
 *   selectBudget contract).
 * @returns {{ tier: 'preview'|'full'|'xl', subMode: string, tokenBudget: number, reason: string }}
 */
export function selectAgentBudget(format, signals, opts = {}) {
  // Explicit numeric budget always wins. Pass the value through unchanged
  // (callers that pass tiny budgets — e.g. `tokenBudget: 1` for hard-ceiling
  // tests — expect the packager to honour them as a strict cap). We only
  // clamp the value used for tier inference, so the subMode label stays sane.
  if (opts.explicitBudget != null && Number.isFinite(opts.explicitBudget)) {
    const n = Math.floor(opts.explicitBudget);
    const tierBound = Math.max(1000, Math.min(16000, n));
    const tier = tierBound >= 11000 ? 'xl' : tierBound >= 7000 ? 'full' : 'preview';
    return { tier, subMode: BUDGET_TIERS[tier].subMode, tokenBudget: n, reason: 'explicit_budget' };
  }

  // Explicit tier flags — caller is asking for a specific budget.
  if (format === 'agent_preview') {
    return { tier: 'preview', ...BUDGET_TIERS.preview, tokenBudget: BUDGET_TIERS.preview.budget, reason: 'explicit_preview' };
  }
  if (format === 'agent_full') {
    return { tier: 'full', ...BUDGET_TIERS.full, tokenBudget: BUDGET_TIERS.full.budget, reason: 'explicit_full' };
  }
  if (format === 'agent_full_xl') {
    return { tier: 'xl', ...BUDGET_TIERS.xl, tokenBudget: BUDGET_TIERS.xl.budget, reason: 'explicit_xl' };
  }

  // Auto-pick: format === 'agent' (or anything unrecognised — defensive).
  // Design target: preview fires on ~99% of queries; XL+FULL combined ~1-5%.
  const { numResults, dominance, top1Tokens } = signals || {};
  const N = Number(numResults) || 0;
  const D = Number.isFinite(dominance) ? dominance : 0;
  const T1 = Number(top1Tokens) || 0;

  const pick = (tier, reason) => ({
    tier,
    subMode: BUDGET_TIERS[tier].subMode,
    tokenBudget: BUDGET_TIERS[tier].budget,
    reason,
  });

  // Tight thresholds. Both upgrade paths require strong, hard-to-fake signals.
  //   XL_TOP1_TOKENS = ~267 lines × 9 t/line. Below this, top-1's render fits
  //                    inside the 2000-token per-result preview cap and XL
  //                    adds no usable budget.
  //   XL_DOMINANCE   = 2.5×. We need the dominance gate to FIRE at
  //                    allocation time (allocateBudget L1448-1454 needs
  //                    top1 ≥ 2 × top2); we add headroom (2.5 vs 2.0) so
  //                    we don't pick XL on borderline cases that the gate
  //                    might miss.
  //   FULL_MIN_N     = 10 results. Fewer than this and the agent can
  //                    re-read rank 2 (which is shown as a preview anyway).
  //                    N is the FINAL <= k list (final-k.js), so FULL can
  //                    only fire for k >= 10. Before the final-k cut, graph
  //                    expansion inflated N and FULL fired on 273/2456 (11%)
  //                    r282 ss-search calls (82% of them at k < 10; none
  //                    asked for --full); within the same task+cell those runs
  //                    scored -1.6pp (95% CI -3.6..+0.2) at ~2x tokens. No
  //                    accuracy case for keeping FULL at k=5 — kept as is.
  //   FULL_MAX_DOM   = 1.05. Strictly tied cluster — top-1 is at most 5%
  //                    ahead of top-2. Anything wider and the agent
  //                    can treat top-1 as the answer.
  //   FULL_MIN_TOP1  = 600 t (~67 lines). If top-1 is tiny, ranks 2-3
  //                    being expanded buys nothing — preview's signature
  //                    already shows everything.
  const XL_TOP1_TOKENS = 2400;
  const XL_DOMINANCE = 2.5;
  const FULL_MIN_N = 10;
  const FULL_MAX_DOM = 1.05;
  const FULL_MIN_TOP1 = 600;

  if (N === 0) return pick('preview', 'auto_empty');

  // XL path: huge top-1 that dominates. Single-result counts as "dominates"
  // (no top-2 to compete). Both branches gate on T1 >= XL_TOP1_TOKENS so we
  // never pick XL when extra space would go unused.
  if (T1 >= XL_TOP1_TOKENS) {
    if (N === 1) return pick('xl', 'auto_xl_single_huge');
    if (D >= XL_DOMINANCE) return pick('xl', 'auto_xl_dominant_huge_top1');
  }

  // FULL path: tightly-clustered multi-result set with non-trivial chunks.
  // All three conditions must hold — comparison-shaped queries with many
  // tied alternatives are the narrow profile where rank 2/3 full bodies
  // pay off. Single dominant answers and small clusters stay on preview.
  if (N >= FULL_MIN_N && D < FULL_MAX_DOM && T1 >= FULL_MIN_TOP1) {
    return pick('full', 'auto_full_tight_cluster');
  }

  // PREVIEW: default for ~99% of queries. The agent can always escalate
  // to full or xl with an explicit format flag if the answer needs more.
  return pick('preview', 'auto_preview_default');
}
