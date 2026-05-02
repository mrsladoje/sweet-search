// Quality + efficiency metrics for the read-workflows benchmark.
//
// All metrics are deterministic — no LLM judge in the default path.

export function expandLineRanges(ranges) {
  const set = new Set();
  for (const [a, b] of ranges || []) {
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}

/**
 * Per-task quality metrics.
 *   gold = task.gold
 *   result.returnedContext = [{ file, lines: Set<number>, text }]
 */
export function scoreTaskResult(task, result) {
  const goldFiles = task.gold?.files || {};
  const goldFileSet = new Set(Object.keys(goldFiles));
  const returnedFileSet = new Set(result.returnedContext.map(r => r.file));

  const fileTP = [...returnedFileSet].filter(f => goldFileSet.has(f)).length;
  const fileRecall = goldFileSet.size === 0 ? (returnedFileSet.size === 0 ? 1 : 0)
    : fileTP / goldFileSet.size;
  const falsePositiveFiles = [...returnedFileSet].filter(f => !goldFileSet.has(f));

  // Per-file line metrics (only counted on gold files).
  let goldLineTotal = 0;
  let goldLineHit = 0;
  let returnedLineTotal = 0;
  let returnedLineOnGold = 0;
  let returnedLineOnGoldFiles = 0;
  const perFile = {};
  // Track returned lines on both gold and non-gold files.
  for (const r of result.returnedContext) {
    returnedLineTotal += r.lines.size;
    if (goldFiles[r.file]) {
      returnedLineOnGoldFiles += r.lines.size;
    }
  }
  for (const [file, info] of Object.entries(goldFiles)) {
    const goldLines = expandLineRanges(info.lineRanges);
    goldLineTotal += goldLines.size;
    const returned = result.returnedContext.find(r => r.file === file);
    const returnedLines = returned?.lines || new Set();
    let hit = 0;
    for (const ln of goldLines) if (returnedLines.has(ln)) hit++;
    goldLineHit += hit;
    returnedLineOnGold += hit;
    perFile[file] = {
      goldLines: goldLines.size,
      returnedLines: returnedLines.size,
      hit,
      recall: goldLines.size === 0 ? 1 : hit / goldLines.size,
      precision: returnedLines.size === 0 ? (goldLines.size === 0 ? 1 : 0) : hit / returnedLines.size,
    };
  }
  const goldLineRecall = goldLineTotal === 0 ? (returnedLineTotal === 0 ? 1 : 0)
    : goldLineHit / goldLineTotal;
  const returnedLinePrecision = returnedLineTotal === 0
    ? (goldLineTotal === 0 ? 1 : 0)
    : returnedLineOnGold / returnedLineTotal;

  // Symbol recall — substring presence in any returned text.
  let goldSymbolTotal = 0;
  let goldSymbolHit = 0;
  for (const [file, info] of Object.entries(goldFiles)) {
    for (const sym of info.symbols || []) {
      goldSymbolTotal += 1;
      const returned = result.returnedContext.find(r => r.file === file);
      if (returned && returned.text.includes(sym)) goldSymbolHit += 1;
    }
  }
  const symbolRecall = goldSymbolTotal === 0 ? 1 : goldSymbolHit / goldSymbolTotal;

  // Overfetch ratio — only meaningful when there is gold to compare against.
  // Defined as returnedLines (across gold files) / goldLines. Lower is better.
  // For tasks with empty gold (no_match_fallback), report returnedLineTotal as
  // the absolute overfetch in lines (and Infinity if nonzero, 0 if zero).
  let overfetchRatio;
  if (goldLineTotal === 0) {
    overfetchRatio = returnedLineTotal === 0 ? 0 : Infinity;
  } else {
    overfetchRatio = returnedLineOnGoldFiles / goldLineTotal;
  }

  // Answerability buckets.
  let answerability;
  if (goldFileSet.size === 0) {
    // For no-match tasks: full success means we returned nothing.
    answerability = returnedLineTotal === 0 ? 'full' : 'failure';
  } else if (fileRecall === 1 && goldLineRecall >= 0.99) {
    answerability = 'full';
  } else if (fileTP > 0 || goldLineHit > 0) {
    answerability = 'partial';
  } else {
    answerability = 'failure';
  }

  // success@budget — true if `full` AND token budget respected.
  const successAtBudget = answerability === 'full'
    && result.approxTokens <= task.maxBudgetTokens;

  return {
    fileRecall,
    fileTP,
    falsePositiveFiles,
    goldLineRecall,
    returnedLinePrecision,
    symbolRecall,
    overfetchRatio,
    answerability,
    successAtBudget,
    perFile,
    returnedLineTotal,
    goldLineTotal,
  };
}

// ---------------------------------------------------------------------------
// Aggregate helpers
// ---------------------------------------------------------------------------

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
