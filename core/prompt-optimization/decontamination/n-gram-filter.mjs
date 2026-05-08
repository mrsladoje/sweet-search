/**
 * Exact-substring n-gram contamination filter.
 *
 * Layer 1 of the three-layer protocol in §11.1: catches surface-form
 * contamination where a probe's gold answer or query verbatim appears in
 * a known pretraining dump. 50-character window is the BEIR / SWE-Rebench
 * convention — short enough to catch identifier-heavy code lines, long
 * enough to avoid noise from generic English fragments.
 *
 * The filter is pure (no I/O, no external deps). Caller supplies the
 * corpus shards (each shard a string). Run against Pile / RefinedWeb /
 * RedPajama dumps where licenses permit.
 *
 * Returns one record per probe with the first hit's location (shard idx +
 * window start) for auditability. Probes with at least one hit are flagged
 * for the `data/contaminated/` set.
 *
 * @param {object} args
 * @param {Array<{ id: string, needle: string }>} args.probes
 *   `needle` is whatever string we're checking for memorisation —
 *   typically the gold answer body or the verbatim query.
 * @param {string[]} args.corpus  — pretraining-dump shards as raw text
 * @param {number}  [args.windowChars=50]
 * @returns {{
 *   flagged: Array<{ id: string, hit: { shardIndex: number, start: number, window: string } }>,
 *   clean:   string[],
 *   stats: { probesChecked: number, probesFlagged: number, windowChars: number },
 * }}
 */
export function nGramDecontaminate({ probes, corpus, windowChars = 50 }) {
  if (!Array.isArray(probes)) throw new TypeError('n-gram-filter: probes must be an array');
  if (!Array.isArray(corpus)) throw new TypeError('n-gram-filter: corpus must be an array');
  if (!Number.isInteger(windowChars) || windowChars < 8) {
    throw new RangeError('n-gram-filter: windowChars must be an integer >= 8');
  }

  const flagged = [];
  const clean = [];

  for (const probe of probes) {
    if (!probe || typeof probe.id !== 'string' || typeof probe.needle !== 'string') {
      throw new TypeError('n-gram-filter: each probe needs string id + needle');
    }
    const needle = probe.needle;
    if (needle.length < windowChars) {
      // Short needles can't form a window-length n-gram by definition.
      clean.push(probe.id);
      continue;
    }

    let hit = null;
    outer: for (let s = 0; s < corpus.length; s++) {
      const shard = corpus[s];
      if (typeof shard !== 'string' || shard.length < windowChars) continue;
      // Slide the window across the needle and check each window in the shard.
      for (let w = 0; w + windowChars <= needle.length; w++) {
        const window = needle.slice(w, w + windowChars);
        const start = shard.indexOf(window);
        if (start !== -1) {
          hit = { shardIndex: s, start, window };
          break outer;
        }
      }
    }
    if (hit) flagged.push({ id: probe.id, hit });
    else clean.push(probe.id);
  }

  return {
    flagged,
    clean,
    stats: {
      probesChecked: probes.length,
      probesFlagged: flagged.length,
      windowChars,
    },
  };
}
