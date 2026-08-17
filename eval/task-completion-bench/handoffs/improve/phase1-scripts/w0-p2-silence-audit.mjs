#!/usr/bin/env node
// SLATE-B W0 gate — P2: IS THE QUIET REAL?
//
// The specificity result only counts if the audit is quiet because there was nothing
// to report, not because the extractor died. 36 of 78 admissible sweet cells derived
// zero stems. P2's own text predicts some of that ("additive Dart changes would not
// trigger a replaced-stem audit"), so the question is which cells are additive and
// which are the extractor failing silently.
//
// The split that settles it, per cell:
//   removed=0            -> purely additive patch. Correct silence, by construction.
//   removed>0, stems=0   -> the patch DID replace something and the audit said nothing.
//                           Every one of these is listed with its removed lines so the
//                           rejection can be judged by eye rather than assumed benign.
//
// Usage: node w0-p2-silence-audit.mjs   ($0)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePatch, deriveStems, trimmedSpan, meaningfulStem, similarity, norm } from './w0-p2-residue-replay.mjs';

// Why a removed line produced no stem. Three reasons, and only one of them is a defect:
//   KEPT      — the replacement re-uses the text, so there is nothing to chase. Correct.
//   ABSORBED  — the added line is a superset of the removed one (the agent EXTENDED the
//               expression rather than replacing it). Nothing was displaced. Correct.
//   REJECTED  — a real span was derived and the meaningfulness filter dropped it. This
//               is the only category that can hide a missed twin, so it is printed with
//               the span so the judgement is visible instead of assumed.
function silenceReason(rem, hunkAdded, allAddedNorm) {
  const n = norm(rem);
  if (allAddedNorm.some(a => a.includes(n))) return { reason: 'ABSORBED', span: n };
  // MUST be the replay's own similarity. A first cut used whitespace-split words here
  // and picked a different replacement line, which manufactured two phantom
  // "should-have-fired" verdicts against a replay that was behaving correctly. A
  // diagnostic that does not share the pipeline it audits invents its own bugs.
  let best = null, bestS = 0;
  for (const add of hunkAdded) {
    const s = similarity(rem, add);
    if (s > bestS) { bestS = s; best = add; }
  }
  const span = (best && bestS >= 0.34) ? trimmedSpan(rem, best) : rem;
  if (!span) return { reason: 'ABSORBED', span: '' };
  if (allAddedNorm.some(a => a.includes(norm(span)))) return { reason: 'KEPT', span: norm(span) };
  if (!meaningfulStem(span)) return { reason: 'REJECTED', span: norm(span) };
  return { reason: 'SHOULD-HAVE-FIRED', span: norm(span) };
}

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const RUNS = ['sb-codex-20260811', 'sb-opencode-20260811', 'sb-claudecode-20260811'];
const BLOCKED = new Set(Object.keys(JSON.parse(
  readFileSync(path.join(BENCH, 'harness/task-blocklist.json'), 'utf8')).tasks));

const cells = [];
for (const run of RUNS) {
  for (const [rep, sub] of [[0, ''], [1, 'rep-1/']]) {
    let patches; try { patches = JSON.parse(readFileSync(path.join(RESULTS, run, 'sweet', sub + 'patches.json'), 'utf8')); } catch { continue; }
    for (const rec of Object.values(patches)) {
      if (BLOCKED.has(rec.instance_id) || !rec.patch) continue;
      const files = parsePatch(rec.patch);
      const removed = files.flatMap(f => f.removed).filter(l => norm(l));
      const stems = deriveStems(files);
      const allAddedNorm = files.flatMap(f => f.added.map(norm)).filter(Boolean);
      const reasons = [];
      for (const f of files)
        for (const h of f.hunks)
          for (const rem of h.removed.filter(l => norm(l)))
            reasons.push({ line: rem, ...silenceReason(rem, h.added, allAddedNorm) });
      cells.push({ run, rep, id: rec.instance_id, harness: run.split('-')[1],
        removed: removed.length, stems: stems.span.length, removedLines: removed, reasons });
    }
  }
}

const additive = cells.filter(c => c.removed === 0);
const silent = cells.filter(c => c.removed > 0 && c.stems === 0);
const speaking = cells.filter(c => c.stems > 0);

console.log('P2 silence audit — admissible sweet cells\n');
console.log(`total                     ${cells.length}`);
console.log(`purely additive (removed=0) ${additive.length}   <- correct silence by construction`);
console.log(`replaced but SILENT         ${silent.length}   <- must be justified line by line`);
console.log(`produced stems              ${speaking.length}`);

console.log('\n=== additive cells (nothing to audit) ===');
for (const c of additive) console.log(`  ${c.harness.padEnd(11)} rep${c.rep} ${c.id}`);

console.log('\n=== replaced-but-silent cells, one reason per removed line ===');
const tally = {};
for (const c of silent) {
  console.log(`\n  ${c.harness} rep${c.rep} ${c.id}   (${c.removed} removed line(s))`);
  for (const { line, reason, span } of c.reasons.slice(0, 12)) {
    tally[reason] = (tally[reason] || 0) + 1;
    console.log(`      [${reason.padEnd(17)}] - ${norm(line).slice(0, 100)}`);
    if (reason === 'REJECTED' || reason === 'SHOULD-HAVE-FIRED')
      console.log(`      ${''.padEnd(19)}   span kept: ${JSON.stringify(span.slice(0, 100))}`);
  }
  if (c.reasons.length > 12) console.log(`      ... ${c.reasons.length - 12} more`);
}
console.log('\n=== silence reason tally over every removed line in a silent cell ===');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`);
console.log('\n  ABSORBED/KEPT are correct silence. REJECTED is the only category that could');
console.log('  hide a missed twin; SHOULD-HAVE-FIRED would be an outright bug.');
