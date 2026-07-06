/**
 * Query-conditioned sufficiency evidence (2026-07).
 *
 * Answers ONE question, cheaply: does the top-1 packaged hit contain
 * positive evidence that it matches what the QUERY asked for? This is the
 * signal the structural sufficiency rule (complete_symbol / header_resolved /
 * neighbors_present) never looked at — a perfectly well-formed function that
 * has nothing to do with the query must not earn `sufficient=YES`.
 *
 * Literature anchor: Sufficient Context (Joren et al., ICLR 2025) — a naive
 * lexical answer-presence check alone reaches F1 0.81 / precision 0.87 on
 * sufficiency; fusing it (AND, not weighted sum) with an independent
 * confidence signal is the high-precision pattern. See
 * eval/task-completion-bench/analysis/sufficiency-redesign-2026-07-06.md.
 *
 * Constraints honoured here:
 *  - engine-local, query-time only: pure string work over the already-
 *    retrieved top-1 (haystack capped), no I/O, no LLM, sub-millisecond;
 *  - only ever invoked from packageForAgent (agent formats) — NL/GCSN
 *    ranking paths never reach this module;
 *  - identifier-SHAPE heuristics, not capture-filtering stopword lists
 *    (CLAUDE.md rule): the only stopword set below is a stable ~30-entry
 *    English query-tokenization list.
 */

// Query-tokenization stopwords (standard English IR practice — the "OK to
// keep" category). Filters function words from the subtoken-overlap signal;
// never used to filter identifier captures.
const EVIDENCE_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'can', 'could', 'did', 'do', 'does', 'for',
  'from', 'how', 'in', 'into', 'is', 'it', 'its', 'not', 'of', 'on', 'or',
  'should', 'that', 'the', 'this', 'to', 'was', 'were', 'what', 'when',
  'where', 'which', 'with',
]);

function envFloat(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

// Thresholds are parameterized (env-overridable for offline calibration
// sweeps) — tuned on the task-level dev split of the full200 replay, never
// hand-picked against held-out. See the design note for the discipline.
export function sufficiencyThresholds() {
  return {
    overlapStrong: envFloat('SS_SUFF_OVERLAP_STRONG', 0.6),
    overlapNone: envFloat('SS_SUFF_OVERLAP_NONE', 0.2),
    minInformativeSubtokens: 2,
    haystackCap: 32768,
  };
}

const WORD_CHAR = /[A-Za-z0-9_$]/;

function isWordChar(ch) {
  return ch != null && WORD_CHAR.test(ch);
}

/**
 * Word-boundary substring check without compiling a regex per token.
 * A match counts only when the char before and after the occurrence are
 * not identifier chars ("Chunker" must not match inside "ChunkerParams"
 * unless the query token IS ChunkerParams).
 */
export function containsToken(haystack, token, { caseSensitive = true } = {}) {
  if (!haystack || !token) return false;
  const hay = caseSensitive ? haystack : haystack.toLowerCase();
  const needle = caseSensitive ? token : token.toLowerCase();
  let from = 0;
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) return false;
    const before = idx > 0 ? hay[idx - 1] : null;
    const after = idx + needle.length < hay.length ? hay[idx + needle.length] : null;
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = idx + 1;
  }
  return false;
}

/**
 * Identifier-shape heuristic (shape, not a word list): a token reads as a
 * code identifier when it carries structure natural language words don't —
 * camelCase humps, underscores/$, digits mixed into letters, dotted/pathy
 * compounds, or ALL_CAPS constants. Pure lowercase single words ("parse",
 * "config") are NOT identifier-shaped; they flow into the softer
 * subtoken-overlap signal instead.
 */
export function looksLikeIdentifierToken(token) {
  if (!token || token.length < 3) return false;
  if (/[_$]/.test(token)) return true;
  if (/[a-z][A-Z]/.test(token)) return true;                      // camelCase hump
  if (/[A-Za-z]\d|\d[A-Za-z]/.test(token)) return true;           // letters+digits
  if (/[.:/\\-]/.test(token) && /[A-Za-z]{2,}/.test(token)) return true; // dotted/pathy
  if (/^[A-Z][A-Z0-9]{2,}$/.test(token)) return true;             // SCREAMING caps
  if (/^[A-Z][a-z]+[A-Z]/.test(token)) return true;               // PascalCase
  return false;
}

/**
 * Pull literal runs out of a user regex (ss-find / ss-grep patterns):
 * unescape metachar escapes, drop anchors, split on regex syntax, keep
 * word-ish runs of length ≥ 3. "\\bChunkerParams\\b" → ["ChunkerParams"].
 */
export function regexLiteralRuns(regexSource) {
  if (!regexSource) return [];
  const unescaped = String(regexSource)
    .replace(/\\[bBdDsSwWAZz]/g, ' ')       // char-class/anchor escapes → separator
    .replace(/\\([^A-Za-z0-9])/g, '$1');    // \. \( … → literal char
  const runs = unescaped.split(/[\^$.|?*+()[\]{}<>=!,\s]+/);
  const out = [];
  for (const run of runs) {
    const trimmed = run.replace(/^[-:/\\]+|[-:/\\]+$/g, '');
    if (trimmed.length >= 3 && /[A-Za-z]/.test(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Split text into normalized informative subtokens: identifier chunks are
 * split on case humps / non-alnum, lowercased, stopword- and length-filtered.
 * Single-pass character scanner — this runs over the top-1 haystack on every
 * agent-format search, so it must stay well under a millisecond at 32KB.
 */
export function informativeSubtokens(text) {
  const out = new Set();
  if (!text) return out;
  const s = String(text);
  const n = s.length;
  let start = -1;        // current subtoken start
  let hasAlpha = false;  // subtoken contains a letter (pure digits dropped)
  const flush = (end) => {
    if (start === -1) return;
    if (hasAlpha && end - start >= 3) {
      const norm = s.slice(start, end).toLowerCase();
      if (!EVIDENCE_STOPWORDS.has(norm)) out.add(norm);
    }
    start = -1;
    hasAlpha = false;
  };
  let prevLower = false; // previous char was a lowercase letter or digit
  let prevUpper = false; // previous char was uppercase
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const isLower = c >= 97 && c <= 122;
    const isUpper = c >= 65 && c <= 90;
    const isDigit = c >= 48 && c <= 57;
    if (isLower || isUpper || isDigit) {
      // camelCase hump: aB starts a new subtoken; ABc splits before the 'Bc'.
      if (start !== -1 && isUpper && prevLower) {
        flush(i);
      } else if (start !== -1 && isLower && prevUpper && i - start >= 2) {
        const split = i - 1; // "HTTPServer" → "http" + "server"
        if (split - start >= 3) {
          const norm = s.slice(start, split).toLowerCase();
          if (!EVIDENCE_STOPWORDS.has(norm)) out.add(norm);
        }
        start = split;
        hasAlpha = true;
      }
      if (start === -1) { start = i; hasAlpha = false; }
      if (isLower || isUpper) hasAlpha = true;
      prevLower = isLower || isDigit;
      prevUpper = isUpper;
    } else {
      flush(i);
      prevLower = false;
      prevUpper = false;
    }
  }
  flush(n);
  return out;
}

/**
 * Extract the query's evidence anchors.
 *
 * @param {string} query   natural-language or symbol query
 * @param {string} [regex] optional user regex (ss-find)
 * @returns {{ anchors: string[], subtokens: Set<string> }}
 *   anchors: exact-match candidates (quoted literals, identifier-shaped
 *   tokens, regex literal runs) — checked verbatim with word boundaries;
 *   subtokens: normalized informative subtokens for the overlap signal.
 */
export function extractQueryEvidence(query, regex) {
  const q = String(query || '');
  const anchors = [];
  const seen = new Set();
  const push = (tok) => {
    if (tok && tok.length >= 3 && !seen.has(tok)) { seen.add(tok); anchors.push(tok); }
  };

  // Quoted literals (error strings, config keys) — strongest anchors.
  const quoteRe = /"([^"\n]{3,120})"|'([^'\n]{3,120})'|`([^`\n]{3,120})`/g;
  let m;
  while ((m = quoteRe.exec(q)) !== null) push(m[1] || m[2] || m[3]);

  // Identifier-shaped tokens from the query text.
  for (const raw of q.split(/[\s,;()"'`]+/)) {
    const tok = raw.replace(/^[^A-Za-z0-9_$]+|[^A-Za-z0-9_$)]+$/g, '');
    if (looksLikeIdentifierToken(tok)) push(tok);
  }

  // Literal runs from the regex (the exact thing the caller greps for).
  for (const run of regexLiteralRuns(regex)) push(run);

  return { anchors, subtokens: informativeSubtokens(q) };
}

/**
 * Assess query-match evidence in the top-1 packaged result.
 *
 * @param {string} query
 * @param {string} regex
 * @param {object} topResult  packaged agent result (symbol, file, code,
 *                            headerContext, summary)
 * @returns {{ strength: 'strong'|'partial'|'none', exactHit: boolean,
 *             matchedAnchor: string|null, overlap: number,
 *             informativeCount: number }}
 */
export function assessQueryEvidence(query, regex, topResult) {
  const t = sufficiencyThresholds();
  const { anchors, subtokens } = extractQueryEvidence(query, regex);

  const haystackParts = [
    topResult?.symbol || '',
    topResult?.file || '',
    topResult?.headerContext || '',
    topResult?.summary || '',
    topResult?.code || '',
  ];
  const haystack = haystackParts.join('\n').slice(0, t.haystackCap);

  let exactHit = false;
  let matchedAnchor = null;
  for (const anchor of anchors) {
    // Case-sensitive when the anchor carries case information; boundary-
    // checked either way so "Chunker" can't match inside "ChunkerParams".
    const caseSensitive = /[A-Z]/.test(anchor);
    if (containsToken(haystack, anchor, { caseSensitive })) {
      exactHit = true;
      matchedAnchor = anchor;
      break;
    }
  }

  const informativeCount = subtokens.size;
  let overlap = 0;
  if (informativeCount > 0) {
    const hayTokens = informativeSubtokens(haystack);
    let matched = 0;
    for (const tok of subtokens) if (hayTokens.has(tok)) matched++;
    overlap = matched / informativeCount;
  }

  let strength = 'partial';
  if (exactHit || (overlap >= t.overlapStrong && informativeCount >= t.minInformativeSubtokens)) {
    strength = 'strong';
  } else if (informativeCount >= t.minInformativeSubtokens && overlap <= t.overlapNone) {
    // Only a query with enough informative tokens can CONFIRM absence —
    // a 1-token NL query never earns a discouraging 'none'.
    strength = 'none';
  }

  return { strength, exactHit, matchedAnchor, overlap, informativeCount };
}

/**
 * Fuse query-match evidence with the engine's confidence bucket and the
 * structural packaging facts into a 3-valued verdict.
 *
 * Rule (design note §2; stricter-YES direction):
 *   - YES requires strong evidence AND (confidence=high, or confidence=medium
 *     with resolved structural context). Packaging alone can never say YES;
 *     confidence=low can never say YES.
 *   - 'no' is reserved for confirmed absence (no results, or a query with
 *     real anchors/subtokens finding nothing in top-1). The borg-style
 *     false-no — literal present with a clear margin — becomes YES.
 *   - everything ambiguous is 'unknown', never a false binary.
 *
 * @param {object} args
 * @param {object|null} args.topResult
 * @param {{confidence: string}|null} args.confidenceInfo
 * @param {string} args.query
 * @param {string} [args.regex]
 * @param {{isComplete: boolean, hasResolution: boolean}} args.structural
 * @param {object[]} [args.lowerResults] code-bearing results below top-1
 *   (full/preview tiers) — consulted ONLY to soften a would-be 'no': when
 *   the pack's answer sits at rank 2-3, a flat 'no' would falsely push the
 *   agent away from a pack that contains it. YES stays top-1-strict.
 * @returns {{ verdict: 'yes'|'no'|'unknown', reason: string,
 *             evidence: object|null }}
 */
export function computeSufficiencyVerdict({ topResult, confidenceInfo, query, regex, structural, lowerResults = [] }) {
  if (!topResult) {
    return { verdict: 'no', reason: 'no_results', evidence: null };
  }

  const evidence = assessQueryEvidence(query, regex, topResult);
  const conf = confidenceInfo?.confidence || 'low';
  const structuralOk = !!(structural?.isComplete && structural?.hasResolution);

  if (evidence.strength === 'none') {
    for (const r of lowerResults) {
      if (!r || (!r.code && !r.symbol)) continue;
      const lower = assessQueryEvidence(query, regex, r);
      if (lower.strength === 'strong') {
        return { verdict: 'unknown', reason: 'evidence_below_top1', evidence };
      }
    }
    return { verdict: 'no', reason: 'no_query_evidence', evidence };
  }

  if (!topResult.code) {
    // Summary-only top-1: the agent holds no code to answer from.
    return { verdict: 'unknown', reason: 'top_summary_only', evidence };
  }

  if (evidence.strength === 'strong') {
    if (conf === 'high') {
      return { verdict: 'yes', reason: evidence.exactHit ? 'query_evidence_clear_margin' : 'query_overlap_clear_margin', evidence };
    }
    if (conf === 'medium') {
      // Dev-split calibration (full200 replay): gating medium on structural
      // resolution cost recall (0.35 vs 0.41) for no precision gain (0.706
      // vs 0.700) — strong evidence + a medium margin is enough. Low never
      // reaches yes: re-admitting low+exactHit dropped precision to 0.61.
      return { verdict: 'yes', reason: 'query_evidence_moderate_margin', evidence };
    }
    return { verdict: 'unknown', reason: 'evidence_without_margin', evidence };
  }

  // Partial evidence — the old structural-YES shape lands here.
  return {
    verdict: 'unknown',
    reason: structuralOk ? 'well_formed_only' : 'partial_query_evidence',
    evidence,
  };
}
