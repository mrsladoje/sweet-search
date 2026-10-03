/**
 * ss-semantic budget enforcement with exact displayed ranges (SS_FIX_SEMANTIC_RANGES) and,
 * optionally, an excerpt around the best chunk of an over-budget span (SS_FIX_SEMANTIC_PICK).
 * SS_FIX_SEMANTIC_RANGES is DEFAULT ON in ss-semantic since 2026-10-03 (0 = legacy); PICK stays off.
 * Without them search-read-semantic.js keeps its own budget code unchanged.
 *
 * The defect this fixes: when the top merged span exceeds the budget, the shipped code keeps
 * its first maxChars characters (possibly mid-line) and still reports the merged range, so the
 * `### file:start-end` header claims lines that were never printed.
 *
 * A cut span here:
 *   - holds whole lines only, and startLine/endLine are exactly the printed lines;
 *   - keeps truncated: true, plus exactRange: true and the merged span's fullStartLine /
 *     fullEndLine, so the printer can name what was left out on either side;
 *   - when not even its first line fits (minified code), holds that line's first maxChars
 *     characters and partialLine: { line, shownChars, totalChars }. A partial line is never
 *     a fully displayed range (the ledger must skip it).
 */

function lineEndOffset(fileText, lineOffsets, line) {
  return line < lineOffsets.length ? lineOffsets[line] : fileText.length;
}

/** Characters of lines a..b (1-based, inclusive) as they sit on disk, newlines included. */
export function rangeChars(fileText, lineOffsets, a, b) {
  return lineEndOffset(fileText, lineOffsets, b) - lineOffsets[a - 1];
}

/**
 * Lines that really exist. The reader's totalLines (and so a padded span's endLine) counts the
 * empty string after a final newline as one more line; a header must not name it.
 */
export function realLineCount(fileText, lineOffsets) {
  const n = lineOffsets.length;
  return n > 1 && lineOffsets[n - 1] === fileText.length ? n - 1 : n;
}

/** Line offsets of a text: offsets[i] is where 1-based line i + 1 starts. */
export function buildLineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  if (offsets.length > 1 && offsets[offsets.length - 1] === text.length) offsets.pop();
  return offsets;
}

/**
 * The longest whole-line prefix of lines from..to that fits maxChars; when none fits, the
 * first maxChars characters of line `from` as a partial line.
 *
 * @returns {{startLine: number, endLine: number, text: string, partialLine?: object}}
 */
export function cutToWholeLines(fileText, lineOffsets, from, to, maxChars) {
  let end = from - 1;
  while (end < to && rangeChars(fileText, lineOffsets, from, end + 1) <= maxChars) end++;
  const startByte = lineOffsets[from - 1];
  if (end >= from) {
    return { startLine: from, endLine: end, text: fileText.slice(startByte, lineEndOffset(fileText, lineOffsets, end)) };
  }
  const line = fileText.slice(startByte, lineEndOffset(fileText, lineOffsets, from)).replace(/\r?\n$/, '');
  return {
    startLine: from,
    endLine: from,
    text: line.slice(0, Math.max(0, maxChars)),
    partialLine: { line: from, shownChars: Math.min(line.length, Math.max(0, maxChars)), totalChars: line.length },
  };
}

/**
 * SS_FIX_SEMANTIC_PICK: the excerpt of an over-budget merged span. Start at its highest-scoring
 * chunk, widen to the next chunks by score while the hull still fits, then spend what is left
 * on whole lines toward the span's head, then toward its end; one contiguous range.
 *
 * @param {{startLine: number, endLine: number}} span - merged span
 * @param {Array<{startLine: number, endLine: number, score: number}>} parts - its padded chunks
 * @returns {{from: number, to: number}}
 */
export function pickExcerptRange(span, parts, fileText, lineOffsets, maxChars) {
  const inside = parts
    .filter(p => p.startLine >= span.startLine && p.endLine <= span.endLine)
    .sort((a, b) => b.score - a.score || a.startLine - b.startLine);
  if (inside.length === 0) return { from: span.startLine, to: span.endLine };
  let from = inside[0].startLine;
  let to = inside[0].endLine;
  if (rangeChars(fileText, lineOffsets, from, to) > maxChars) return { from, to };
  for (const p of inside.slice(1)) {
    const a = Math.min(from, p.startLine);
    const b = Math.max(to, p.endLine);
    if (rangeChars(fileText, lineOffsets, a, b) <= maxChars) { from = a; to = b; }
  }
  while (from > span.startLine && rangeChars(fileText, lineOffsets, from - 1, to) <= maxChars) from--;
  while (to < span.endLine && rangeChars(fileText, lineOffsets, from, to + 1) <= maxChars) to++;
  return { from, to };
}

/**
 * Greedy by score as the shipped _enforceCharBudget: spans that fit whole are kept whole; the
 * top span, when it alone exceeds the budget, is cut to exact whole lines (from its head, or
 * from its best chunk under `pick`). Line order is restored at the end.
 *
 * @param {Array<object>} spans - merged spans ({startLine, endLine, score, ...})
 * @param {string} fileText
 * @param {number[]} lineOffsets
 * @param {number} maxChars
 * @param {{pick?: boolean, parts?: Array<object>}} [opts] - parts = padded pre-merge chunks
 */
export function enforceExactCharBudget(spans, fileText, lineOffsets, maxChars, opts = {}) {
  const last = realLineCount(fileText, lineOffsets);
  const clamp = s => ({ ...s, startLine: Math.min(s.startLine, last), endLine: Math.min(s.endLine, last) });
  const ranked = spans.map(clamp).sort((a, b) => b.score - a.score);
  const parts = (opts.parts || []).map(clamp);
  const kept = [];
  let used = 0;
  for (const span of ranked) {
    const cost = rangeChars(fileText, lineOffsets, span.startLine, span.endLine);
    if (kept.length === 0 && cost > maxChars) {
      const { from, to } = opts.pick
        ? pickExcerptRange(span, parts, fileText, lineOffsets, maxChars)
        : { from: span.startLine, to: span.endLine };
      const cut = cutToWholeLines(fileText, lineOffsets, from, to, maxChars);
      kept.push({
        ...span,
        ...cut,
        fullStartLine: span.startLine,
        fullEndLine: span.endLine,
        truncated: true,
        exactRange: true,
      });
      used += cut.text.length;
      break;
    }
    if (used + cost > maxChars) continue;
    kept.push({ ...span, text: fileText.slice(lineOffsets[span.startLine - 1], lineEndOffset(fileText, lineOffsets, span.endLine)) });
    used += cost;
  }
  kept.sort((a, b) => a.startLine - b.startLine);
  return { spans: kept, charsUsed: used };
}

/** A whole-file fallback span under exact ranges (the shipped one cuts mid-line). */
export function exactFallbackSpan(text, totalLines, maxChars) {
  const base = { score: 0, symbols: [], types: [], chunkIds: [] };
  const offsets = buildLineOffsets(text);
  const last = Math.max(1, Math.min(totalLines, realLineCount(text, offsets)));
  if (text.length <= maxChars) return { ...base, startLine: 1, endLine: last, text };
  const cut = cutToWholeLines(text, offsets, 1, last, maxChars);
  return { ...base, ...cut, fullStartLine: 1, fullEndLine: last, truncated: true, exactRange: true };
}

/**
 * The lines an ss-semantic printer adds around a cut span: what was left out before and after
 * the printed range, as runnable ss-read commands, and the partial-line note.
 *
 * @param {string} file
 * @param {object} span
 * @returns {{before: string[], after: string[]}}
 */
export function omittedRangeLines(file, span) {
  const before = [];
  const after = [];
  if (span?.exactRange !== true) return { before, after };
  const notShown = (a, b) => `# not shown: lines ${a}-${b} — ss-read ${file} ${a} ${b}`;
  if (span.fullStartLine < span.startLine) before.push(notShown(span.fullStartLine, span.startLine - 1));
  if (span.partialLine) {
    const p = span.partialLine;
    after.push(`(line ${p.line} truncated: ${p.shownChars} of ${p.totalChars} characters)`);
  }
  if (span.fullEndLine > span.endLine) after.push(notShown(span.endLine + 1, span.fullEndLine));
  return { before, after };
}
