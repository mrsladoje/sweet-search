/**
 * Span dedupe for the final result list.
 *
 * The index splits a long symbol into sub-chunks (dgraph movePredicate:
 * 140-157, 140-196, 196-240, 240-251) and every sub-chunk carries the
 * enclosing symbol span (140-251) as its display span. When several
 * sub-chunks match a query, the list holds the same span several times. The
 * agent packager shows that span once with code and the copies as summary
 * lines, so each copy wastes one of the caller's k slots (r3h-dgraph-23 at
 * -k 6: three of six slots were movePredicate).
 *
 * dedupeIdenticalSpans() keeps one result per (file, start, end) display span.
 * It runs above the final-k cut (search-postprocess.js shapeFinalList), so
 * freed slots refill from the next candidates. It is not a ranking signal: it
 * removes copies of a span that is already in the list, so it can only move
 * later results up. Agent formats only: the agent packager renders a result
 * from its display span, so copies print the same lines; other formats print
 * each chunk's own text, which differs between copies.
 *
 * Containment (a span strictly inside an earlier span) is NOT dropped here:
 * whether the outer span shows the inner lines depends on the packager's tier
 * and token cap (a 400-line class shows as a sandwich or a one-line summary,
 * and the inner method's pointer is then the more specific answer). The
 * output layer (Bundle A, A2) drops a summary whose lines an earlier code
 * entry printed; that stays the safety net for printed overlap.
 */

function spanFile(r) {
  return r?.metadata?.file || r?.file || r?.file_path || r?.path || '';
}

/**
 * The span the packager widens from: metadata wins over the top-level fields
 * (same precedence as packageForAgent / expandToSymbol).
 * @returns {{ file: string, start: number, end: number }|null}
 */
export function displaySpan(r) {
  const file = spanFile(r);
  const start = Number(r?.metadata?.startLine || r?.startLine);
  const end = Number(r?.metadata?.endLine || r?.endLine);
  if (!file || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { file, start, end };
}

function spanKey(span) {
  return `${span.file}\0${span.start}\0${span.end}`;
}

/**
 * Seed-pool cut that counts DISTINCT display spans, not results.
 *
 * Takes results in rank order until k distinct spans are in; a copy of a span
 * already taken stays in (up to `maxCopies` copies in total) instead of
 * costing a slot. The copies are kept on purpose: each sub-chunk carries its
 * own late-interaction tokens, and the best-matching sub-chunk is often not
 * the one with the best hybrid score (r3h-dgraph-23: the 240-251 sub-chunk
 * scores 0.468 after MaxSim, the hybrid-best 196-240 one only 0.419). The
 * final dedupe (dedupeIdenticalSpans, after rescoring) keeps the best copy.
 *
 * @param {Array} results ranked list
 * @param {number} k distinct spans wanted
 * @param {{ maxCopies?: number }} [opts] default k
 * @returns {Array} new array (or the input sliced to k when nothing repeats)
 */
export function takeDistinctSpans(results, k, { maxCopies = k } = {}) {
  if (!Array.isArray(results) || !(k > 0)) return Array.isArray(results) ? results.slice(0, Math.max(0, k)) : results;
  const keys = new Set();
  const out = [];
  let distinct = 0;
  let copies = 0;
  for (const r of results) {
    const span = displaySpan(r);
    const key = span ? spanKey(span) : null;
    if (key && keys.has(key)) {
      if (copies < maxCopies) { out.push(r); copies++; }
      continue;
    }
    if (distinct >= k) break;
    out.push(r);
    distinct++;
    if (key) keys.add(key);
  }
  return out;
}

/**
 * Keep the first (best-ranked) result per identical display span.
 *
 * The kept entry stays at the position of the best-ranked copy. When that copy
 * is a graph-expanded neighbour and a direct retrieval hit with the same span
 * exists, the direct hit's object takes the slot (it carries the matched
 * chunk id, LI tokens and hybrid provenance); its score becomes the best
 * score of the group. `dedupedHits` on the kept entry counts the dropped
 * copies (several matching sub-chunks are evidence the caller may want).
 *
 * @param {Array} results ranked list (best first)
 * @returns {{ results: Array, dropped: number }} same array when nothing dropped
 */
export function dedupeIdenticalSpans(results) {
  if (!Array.isArray(results) || results.length < 2) return { results, dropped: 0 };
  const groups = new Map(); // key -> { slot, members: [] }
  const slots = [];
  for (const r of results) {
    const span = displaySpan(r);
    if (!span) { slots.push({ members: [r] }); continue; }
    const key = spanKey(span);
    const group = groups.get(key);
    if (group) { group.members.push(r); continue; }
    const fresh = { members: [r] };
    groups.set(key, fresh);
    slots.push(fresh);
  }
  if (slots.length === results.length) return { results, dropped: 0 };

  const out = slots.map(({ members }) => {
    if (members.length === 1) return members[0];
    const first = members[0];
    const direct = first.is_expanded ? members.find(m => !m.is_expanded) : null;
    const rep = direct || first;
    const bestScore = Math.max(...members.map(m => (Number.isFinite(m.score) ? m.score : -Infinity)));
    const kept = { ...rep, dedupedHits: (rep.dedupedHits || 0) + members.length - 1 };
    if (Number.isFinite(bestScore) && bestScore !== rep.score) kept.score = bestScore;
    return kept;
  });
  return { results: out, dropped: results.length - out.length };
}
