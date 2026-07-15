/**
 * Agent-facing grep output shaping: k-budget file-level diversity.
 *
 * Root cause (task bench, rstudio-education__gradethis-161): bareGrep returns
 * matches sorted alphabetically by file and the agent wrapper printed the
 * first k grouped by file — so one flooded early-alphabet file could consume
 * the entire k budget and structurally hide every other matching file, with
 * no signal that elision happened.
 *
 * These helpers are pure and option-gated: only the ss-grep agent wrapper
 * enables them. The human-facing grep product shape and all NL ranking paths
 * are untouched (no scoring — file order stays the engine's deterministic
 * sorted order; raw match count is deliberately never used as a sort key).
 */

/**
 * True when a match's repo-relative path is the drill-in target. Accepts the
 * exact relative path as printed in grep output, a path with a leading "./",
 * or a suffix (basename or trailing path segments) so agents can paste any
 * reasonable spelling of the file they saw.
 *
 * @param {string} file - repo-relative match path (as emitted by the engine)
 * @param {string} filter - user-supplied --in value
 */
export function matchesGrepFileFilter(file, filter) {
  if (!file || !filter) return false;
  const f = String(filter).replace(/^\.\//, '').replace(/\\/g, '/');
  const target = String(file).replace(/\\/g, '/');
  return target === f || target.endsWith(`/${f}`);
}

/**
 * Streaming per-file diversification of a (file,line)-sorted match list.
 * Keeps at most `perFileCap` matches per file and at most `maxFiles` distinct
 * files; everything beyond is COUNTED but never stored, so memory is bounded
 * by perFileCap*maxFiles regardless of total match count.
 *
 * PRECONDITION: matches must be grouped by file (bareGrep sorts by
 * (file, line, column) before calling) — the walk uses a single per-file
 * cursor precisely so no map proportional to distinct-file count is built.
 *
 * @param {Array<{file: string}>} matches - sorted by (file, line)
 * @param {{perFileCap: number, maxFiles?: number, hiddenSampleSize?: number}} opts
 * @returns {{kept: Array, fileSummary: {
 *   files: Array<{file: string, total: number, kept: number}>,
 *   hiddenFileCount: number, hiddenMatchCount: number,
 *   hiddenSample: Array<{file: string, total: number}>,
 * }}}
 */
export function applyGrepFileDiversity(matches, opts = {}) {
  const perFileCap = Math.max(1, opts.perFileCap | 0);
  const maxFiles = opts.maxFiles > 0 ? (opts.maxFiles | 0) : Infinity;
  const hiddenSampleSize = opts.hiddenSampleSize ?? 3;

  const kept = [];
  const files = [];            // [{file, total, kept}] in first-appearance (sorted) order
  const hiddenSample = [];     // first few hidden files, name + total
  let hiddenFileCount = 0;
  let hiddenMatchCount = 0;

  let current = null;
  for (const m of matches) {
    if (!current || current.file !== m.file) {
      if (files.length < maxFiles) {
        current = { file: m.file, total: 0, kept: 0 };
        files.push(current);
      } else {
        current = { file: m.file, total: 0, kept: -1 }; // hidden file: count only
        hiddenFileCount++;
        if (hiddenSample.length < hiddenSampleSize) {
          hiddenSample.push(current);
        }
      }
    }
    current.total++;
    if (current.kept >= 0 && current.kept < perFileCap) {
      kept.push(m);
      current.kept++;
    } else if (current.kept < 0) {
      hiddenMatchCount++;
    }
  }

  return {
    kept,
    fileSummary: {
      files,
      hiddenFileCount,
      hiddenMatchCount,
      hiddenSample: hiddenSample.map(h => ({ file: h.file, total: h.total })),
    },
  };
}

/**
 * Breadth-first budget allocation: round-robin one line per file per round,
 * in the given (deterministic) file order, until `budget` lines are allocated
 * or every file's available matches are exhausted. Flooding is structurally
 * impossible — file A gets its (r+1)-th line only after every other file got
 * its r-th — while few-files queries keep full depth (deep rounds fill just
 * like the old flat output).
 *
 * @param {number[]} counts - available (fetched) matches per file
 * @param {number} budget - total lines to allocate (k)
 * @returns {number[]} allocation per file, same order as counts
 */
export function allocateGrepBudget(counts, budget) {
  const alloc = counts.map(() => 0);
  let remaining = Math.max(0, budget | 0);
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (let i = 0; i < counts.length && remaining > 0; i++) {
      if (alloc[i] < counts[i]) {
        alloc[i]++;
        remaining--;
        progressed = true;
      }
    }
  }
  return alloc;
}

/**
 * Render the diversified agent grep body: matches grouped per file (research:
 * contiguous per-file blocks read better than interleaving) with allocation
 * decided breadth-first, and a visible inline `(+N more in this file)` marker
 * on the last shown line of every truncated file — elision is never silent
 * and costs no extra lines.
 *
 * @param {Array<{file: string, line: number, matchText?: string}>} kept -
 *   diversified matches in engine order (grouped by file)
 * @param {{files: Array<{file, total, kept}>, hiddenFileCount, hiddenMatchCount,
 *          hiddenSample: Array<{file, total}>}} fileSummary
 * @param {number} k - body line budget
 * @returns {{lines: string[], shownMatches: number, matchedFileCount: number,
 *            truncatedFileCount: number, hiddenLine: string|null}}
 */
export function renderGrepBody(kept, fileSummary, k) {
  const groups = new Map();
  for (const m of kept) {
    if (!groups.has(m.file)) groups.set(m.file, []);
    groups.get(m.file).push(m);
  }
  const totals = new Map(fileSummary.files.map(f => [f.file, f.total]));
  const ordered = [...groups.entries()];
  const alloc = allocateGrepBudget(ordered.map(([, ms]) => ms.length), k);

  const lines = [];
  let shownMatches = 0;
  let truncatedFileCount = 0;
  const unallocated = []; // fetched files that got zero budget (more files than k)
  ordered.forEach(([file, ms], i) => {
    if (alloc[i] === 0) {
      unallocated.push({ file, total: totals.get(file) ?? ms.length });
      return;
    }
    const total = totals.get(file) ?? ms.length;
    for (let j = 0; j < alloc[i]; j++) {
      const m = ms[j];
      const text = (m.matchText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      let line = `${file}:${m.line}: ${text}`;
      if (j === alloc[i] - 1 && total > alloc[i]) {
        line += ` (+${total - alloc[i]} more in this file)`;
        truncatedFileCount++;
      }
      lines.push(line);
      shownMatches++;
    }
  });

  // Files that matched but got no body line at all (more matching files than
  // budget, or clipped by the engine's maxFiles fetch bound): one honest tail
  // line naming the first few so the agent can jump straight to them.
  const hiddenFiles = unallocated.length + fileSummary.hiddenFileCount;
  const hiddenMatches = unallocated.reduce((a, f) => a + f.total, 0) + fileSummary.hiddenMatchCount;
  let hiddenLine = null;
  if (hiddenFiles > 0) {
    const sample = [...unallocated.map(f => f.file), ...fileSummary.hiddenSample.map(f => f.file)]
      .slice(0, 3);
    hiddenLine = `# +${hiddenFiles} more file(s) with ${hiddenMatches} match(es)` +
      (sample.length ? ` — e.g. ${sample.join(', ')}` : '') +
      `; narrow the regex, raise -k, or drill in with --in <file>`;
  }

  return {
    lines,
    shownMatches,
    matchedFileCount: fileSummary.files.length + fileSummary.hiddenFileCount,
    truncatedFileCount,
    hiddenLine,
  };
}

/**
 * Replace the lowest-ranked complete grep lines with an indexed family
 * manifest, but only when those lines fully fund the manifest's estimated
 * tokens. The input is never mutated and an underfunded manifest is omitted.
 */
export function reallocateGrepTailForManifest(lines, manifest, estimateTokens = (text) => (
  text ? Math.ceil(text.length / 3.5) : 0
)) {
  if (!Array.isArray(lines) || !manifest?.rendered || lines.length === 0) {
    return { lines, familyManifest: null, removedLineCount: 0 };
  }
  const required = estimateTokens(`${manifest.rendered}\n`);
  let reclaimed = 0;
  let keep = lines.length;
  while (keep > 0 && reclaimed < required) {
    keep--;
    reclaimed += estimateTokens(`${lines[keep]}\n`);
  }
  if (reclaimed < required) {
    return { lines, familyManifest: null, removedLineCount: 0 };
  }
  return {
    lines: lines.slice(0, keep),
    familyManifest: { ...manifest, tokens: required },
    removedLineCount: lines.length - keep,
  };
}
