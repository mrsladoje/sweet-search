/**
 * Agent-only relevance ordering for the ss-read unread-symbol trailer.
 *
 * The caller supplies symbols already loaded from the selected file's index.
 * This module only reallocates the existing five display slots; it performs no
 * I/O and never changes the total symbol count represented by "+N more".
 */

import { containsToken, informativeSubtokens } from './query-sufficiency.js';

function normalizeEvidence(queryEvidence) {
  const anchors = Array.isArray(queryEvidence?.anchors)
    ? queryEvidence.anchors.filter((value) => typeof value === 'string' && value.length >= 3)
    : [];
  const subtokens = new Set(
    Array.isArray(queryEvidence?.subtokens)
      ? queryEvidence.subtokens.filter((value) => typeof value === 'string' && value.length >= 3)
      : [],
  );
  return { anchors, subtokens };
}

function relevance(symbol, evidence) {
  const name = String(symbol?.symbol || '');
  const lower = name.toLowerCase();
  let exactAnchor = 0;
  let containedAnchor = 0;

  for (const anchor of evidence.anchors) {
    const anchorLower = anchor.toLowerCase();
    if (lower === anchorLower) {
      exactAnchor = Math.max(exactAnchor, anchor.length);
      continue;
    }
    const caseSensitive = /[A-Z]/.test(anchor);
    if (containsToken(name, anchor, { caseSensitive }) || lower.includes(anchorLower)) {
      containedAnchor = Math.max(containedAnchor, anchor.length);
    }
  }

  const symbolTerms = informativeSubtokens(name);
  let subtokenMatches = 0;
  for (const term of evidence.subtokens) {
    if (symbolTerms.has(term)) subtokenMatches++;
  }

  return {
    matched: exactAnchor > 0 || containedAnchor > 0 || subtokenMatches > 0,
    exactAnchor,
    containedAnchor,
    subtokenMatches,
  };
}

/**
 * Select the fixed-size unread-symbol trailer list by query relevance.
 * Stable position order is preserved for ties and when no symbol matches.
 */
export function selectUnreadSymbols(symbols, queryEvidence, maxSymbols = 5) {
  const candidates = Array.isArray(symbols) ? symbols : [];
  const limit = Math.max(0, maxSymbols | 0);
  if (candidates.length <= limit) {
    return { symbols: candidates.slice(), moreCount: 0 };
  }

  const evidence = normalizeEvidence(queryEvidence);
  if (evidence.anchors.length === 0 && evidence.subtokens.size === 0) {
    return {
      symbols: candidates.slice(0, limit),
      moreCount: candidates.length - limit,
    };
  }

  const ranked = candidates.map((symbol, index) => ({
    symbol,
    index,
    ...relevance(symbol, evidence),
  }));
  ranked.sort((a, b) =>
    Number(b.matched) - Number(a.matched)
    || b.exactAnchor - a.exactAnchor
    || b.containedAnchor - a.containedAnchor
    || b.subtokenMatches - a.subtokenMatches
    || a.index - b.index);

  return {
    symbols: ranked.slice(0, limit).map((entry) => entry.symbol),
    moreCount: candidates.length - limit,
  };
}
