/**
 * gold-tripwire — flag submitted patches that are (near-)verbatim copies of the gold
 * patch (PLAN.md §6 lever P0, item 6).
 *
 * The held-out forensics found agents that had ALREADY obtained the answer — from the
 * task-spec cache, a golden checkout of a later commit, a jsDelivr tag scan, or
 * `git show <fix-sha>` inside the grading image — and then transcribed it. Those
 * rollouts graded as clean solves: nothing in the pipeline compares what was submitted
 * against what was known. §5.2 makes the cost of that blindness concrete — native's
 * 83% gold-hunk coverage was read as a capability result when "83% is substantially
 * what copying gold looks like".
 *
 * This is a DETECTOR OF LAST RESORT, deliberately downstream of the jail. If the
 * isolation works, it should never fire; if it fires, either a vector is still open or
 * the task is one where the natural fix genuinely IS the gold text. Both readings need
 * a human, so the tripwire flags and reports — it never silently voids a row.
 *
 * Similarity is measured on CHANGED LINES, not diff text: hunk headers, context lines
 * and file ordering differ freely between an honest patch and a copied one, while the
 * set of inserted/deleted code lines is what actually got copied.
 */

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Inserted/deleted payload lines of a unified diff, whitespace-normalized. */
export function changedLines(patch) {
  const add = new Set(), del = new Set();
  for (const line of String(patch || '').split('\n')) {
    if (/^\+\+\+ |^--- /.test(line)) continue;                 // file headers, not payload
    if (line.startsWith('+')) { const t = norm(line.slice(1)); if (t) add.add(t); }
    else if (line.startsWith('-')) { const t = norm(line.slice(1)); if (t) del.add(t); }
  }
  return { add, del };
}

const jaccardish = (goldSet, predSet) => {
  if (!goldSet.size) return null;
  let hit = 0;
  for (const l of goldSet) if (predSet.has(l)) hit++;
  return hit / goldSet.size;
};

/**
 * @returns {{coverage:number|null, precision:number|null, score:number|null,
 *            goldLines:number, predLines:number, flagged:boolean, reason:string}}
 * coverage  — fraction of gold's changed lines that appear in the prediction
 * precision — fraction of the prediction's changed lines that came from gold
 * score     — min(coverage, precision): high only when the patch is BOTH complete
 *             and free of independent work. A correct-but-independently-written fix
 *             overlaps on a few lines; a transcription overlaps on nearly all of them
 *             in both directions.
 */
export function goldSimilarity(predPatch, goldPatch, { threshold = 0.95, minGoldLines = 3 } = {}) {
  const g = changedLines(goldPatch), p = changedLines(predPatch);
  const goldAll = new Set([...g.add, ...g.del]);
  const predAll = new Set([...p.add, ...p.del]);
  const out = { coverage: null, precision: null, score: null, goldLines: goldAll.size, predLines: predAll.size, flagged: false, reason: '' };
  if (!goldAll.size || !predAll.size) { out.reason = 'empty patch'; return out; }
  if (goldAll.size < minGoldLines) { out.reason = `gold too small (${goldAll.size} lines) to distinguish copying from convergence`; return out; }
  out.coverage = jaccardish(goldAll, predAll);
  out.precision = jaccardish(predAll, goldAll);
  out.score = Math.min(out.coverage, out.precision);
  out.flagged = out.score >= threshold;
  if (out.flagged) out.reason = `patch is ${(out.score * 100).toFixed(1)}% identical to gold (coverage ${(out.coverage * 100).toFixed(0)}%, precision ${(out.precision * 100).toFixed(0)}%)`;
  return out;
}

/**
 * Score a whole arm's predictions. `goldFor(instance_id)` returns the gold patch text.
 * Never throws: a tripwire failure must not take down a graded run.
 */
export function scanPredictions(preds, goldFor, opts = {}) {
  const rows = [];
  for (const p of preds || []) {
    try {
      const gold = goldFor(p.instance_id);
      if (!gold) continue;
      const sim = goldSimilarity(p.model_patch, gold, opts);
      rows.push({ instance_id: p.instance_id, arm: p.model_name_or_path, ...sim });
    } catch { /* one bad row must not abort the scan */ }
  }
  return { rows, flagged: rows.filter(r => r.flagged) };
}
