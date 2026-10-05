/**
 * One recorded ss-grep call rendered under one arm, with the PRODUCTION functions: the engine's
 * file selection (applyGrepFileDiversity), its line-class stamping (stampGrepLineClasses) and
 * the tool's body renderer (renderGrepBody). Only the match list comes from the collector
 * (`rg -n`), so the replay differs from the real tool only in what the fidelity check measures.
 */

import { applyGrepFileDiversity, renderGrepBody } from '../../core/search/grep-output-shaping.js';
import { stampGrepLineClasses } from '../../core/search/grep-line-classes.js';
import { symbolKey, wordIn } from './lib.mjs';

/** The engine's sorted match list. Files above the stored line cap get count-only placeholders. */
export function matchList(byFile) {
  const out = [];
  for (const file of Object.keys(byFile).sort((a, b) => a.localeCompare(b))) {
    const { total, lines } = byFile[file];
    for (const [line, text] of lines) out.push({ file, line, column: 1, matchText: text, content: text });
    for (let i = lines.length; i < total; i++) out.push({ file, line: 1e9 + i, column: 1, matchText: '', content: '' });
  }
  return out;
}

/** Gold evidence of a call: answer-symbol spans in answer files with at least one match inside. */
export function callTargets(call, byFile, spansOfRepo) {
  const keys = new Set(call.goldSymbols.map(symbolKey));
  const targets = [];
  for (const file of call.goldFiles) {
    const f = byFile[file];
    if (!f) continue;
    for (const [start, end, name] of spansOfRepo[file] || []) {
      if (!keys.has(name)) continue;
      const inside = f.lines.filter(([ln]) => ln >= start && ln <= end);
      if (!inside.length) continue;
      const declLines = f.lines.filter(([ln, text]) => ln >= start && ln <= start + 3 && wordIn(name, text)).map(([ln]) => ln);
      targets.push({ file, start, end, name, declLines });
    }
  }
  return targets;
}

/**
 * @param {object} call - collected call ({k, flags, ...})
 * @param {Array<object>} matches - matchList(...) of the call's grep (never mutated)
 * @param {object} arm - prereg arm
 * @param {{spans: object, stale: Set<string>}} index - the repo's entity spans and stale files
 * @returns {{lines: string[], rows: Array, hiddenLine: string|null}}
 */
export function renderArm(call, matches, arm, index) {
  const k = call.k;
  const perFileCap = Math.min(k, 100);
  if (!arm.alloc) {
    const { kept, fileSummary } = applyGrepFileDiversity(matches, { perFileCap, maxFiles: k });
    return renderGrepBody(kept, fileSummary, k);
  }
  const weight = arm.weight === 'sat2' ? 'sat2' : undefined;
  const sel = applyGrepFileDiversity(matches, { perFileCap, maxFiles: k, order: 'weight', ...(weight ? { weight } : {}) });
  const kept = sel.kept.map(m => ({ ...m }));
  // the engine stamps only in agent format, which ss-grep -F is not
  if (arm.lines && !call.flags.F) {
    stampGrepLineClasses(kept, {
      entitiesInFile: file => (index.spans[file] || []).map(([startLine, endLine, name]) => ({ startLine, endLine, name })),
      isFresh: file => !index.stale.has(file),
    });
  }
  return renderGrepBody(kept, sel.fileSummary, k, {
    alloc: 'weight',
    ...(weight ? { weight } : {}),
    ...(arm.rule && arm.rule !== 'sl' ? { rule: arm.rule } : {}),
    ...(arm.lines ? { lineClasses: true } : {}),
  });
}
