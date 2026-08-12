#!/usr/bin/env node
// reprice-claude-sidechains.mjs — D-2 repair for an ALREADY-COMPLETED claude-code run.
//
// The adapter priced only the main session, because Claude Code writes each delegated
// subagent's conversation to <session-id>/subagents/agent-*.jsonl rather than into the main
// transcript, and its aggregate `result` usage excludes them too. Every delegated request was
// billed by the provider and recorded at zero. Native delegates far more than sweet on this
// bench, so the omission moves the Claude cost comparison in sweet's favour.
//
// This recomputes each row's cost from the RETAINED per-rollout state under
// results/<run>/agent-state/<task>-<arm>/claude-home/projects/, using the same shared cost
// math as the live adapter (ideal-cost.mjs), and emits a corrected rows file plus a
// reproduction check: main-only cost recomputed here must match the recorded row, or the
// derivation is not trustworthy and nothing may be published from it.
//
// Usage: node reprice-claude-sidechains.mjs <results/<run>> [--out <file>] [--tol 0.005]
// Writes: <run>/rows-sidechain-inclusive.json  and prints a per-arm summary.
// Never mutates rows.json.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from './ideal-cost.mjs';
import { turnsFromTranscriptFile } from './claude-code-task-runner.mjs';

const args = process.argv.slice(2);
const RUN = args.find(a => !a.startsWith('--'));
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const TOL = +arg('tol', 0.005);            // 0.5% reproduction tolerance (D-2 acceptance bar)
if (!RUN) { console.error('usage: reprice-claude-sidechains.mjs <results/<run>> [--out f] [--tol 0.005]'); process.exit(2); }

const rows = JSON.parse(readFileSync(path.join(RUN, 'rows.json'), 'utf8'));
const stateRoot = path.join(RUN, 'agent-state');

// Project-dir slug encodes the rundir, and the rundir encodes task, arm and rep:
//   -root--ss-eval-runs-<task-slug>--<arm>--r<rep>--<n>
const repOfSlug = slug => { const m = /--r(\d+)--\d+$/.exec(slug); return m ? +m[1] : null; };

/** Every session in one rollout's claude-home: main turns + per-subagent turn sets. */
function sessionsFor(taskId, arm, rep) {
  const projects = path.join(stateRoot, `${taskId}-${arm}`, 'claude-home', 'projects');
  if (!existsSync(projects)) return [];
  const out = [];
  for (const slug of readdirSync(projects)) {
    if (repOfSlug(slug) !== rep) continue;
    const dir = path.join(projects, slug);
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const sid = e.name.replace(/\.jsonl$/, '');
      const main = turnsFromTranscriptFile(path.join(dir, e.name));
      const subDir = path.join(dir, sid, 'subagents');
      const sides = [];
      if (existsSync(subDir)) {
        for (const s of readdirSync(subDir).filter(n => n.endsWith('.jsonl')).sort()) {
          const t = turnsFromTranscriptFile(path.join(subDir, s));
          if (t.length) sides.push({ name: s, turns: t });
        }
      }
      if (main.length || sides.length) out.push({ sid, slug, main, sides });
    }
  }
  return out;
}

const summary = { run: path.basename(RUN), tol: TOL, rows: rows.length, matched: 0, noState: [], mismatched: [], withSidechains: 0 };
const outRows = [];
for (const r of rows) {
  const row = { ...r };
  const price = priceFor(r.model);
  const sessions = sessionsFor(r.taskId, r.arm, r.rep);
  if (!sessions.length) {
    summary.noState.push(`${r.taskId}/${r.arm}/r${r.rep}`);
    row.sidechainRepriced = false;
    outRows.push(row);
    continue;
  }
  // A rollout with a 0-call start failure was relaunched, leaving two sessions. The recorded
  // row carries the SUPERSEDING attempt only, so pick the session whose main-only cost
  // reproduces it; ties and single sessions pick the largest, which is the real attempt.
  const priced = sessions.map(s => ({
    ...s,
    mainReal: costFromTurns(s.main, price).realFromTurnsUsd,
    sideCosts: s.sides.map(x => costFromTurns(x.turns, price)),
  }));
  const recorded = r.costRealizedUsd ?? 0;
  priced.sort((a, b) => Math.abs(a.mainReal - recorded) - Math.abs(b.mainReal - recorded));
  const pick = priced[0];

  const mainCost = costFromTurns(pick.main, price);
  const sideReal = pick.sideCosts.reduce((a, c) => a + c.realFromTurnsUsd, 0);
  const sideIdeal = pick.sideCosts.reduce((a, c) => a + c.idealUsd, 0);
  const sideBreak = pick.sideCosts.reduce((a, c) => a + c.breakPricedUsd, 0);
  const sideTurns = pick.sides.reduce((a, s) => a + s.turns.length, 0);

  // Reproduction check: main-only must land within tolerance of the published row.
  const drift = recorded ? Math.abs(mainCost.realFromTurnsUsd - recorded) / recorded : 0;
  if (drift > TOL) summary.mismatched.push({ cell: `${r.taskId}/${r.arm}/r${r.rep}`, recorded, recomputedMainOnly: +mainCost.realFromTurnsUsd.toFixed(6), drift: +(drift * 100).toFixed(2) });
  else summary.matched++;
  if (pick.sides.length) summary.withSidechains++;

  row.sidechainRepriced = true;
  row.sidechainCount = pick.sides.length;
  row.sidechainTurns = sideTurns;
  row.costRealizedMainOnlyUsd = r.costRealizedUsd;
  row.idealCostMainOnlyUsd = r.idealCostUsd;
  row.breakPricedCostMainOnlyUsd = r.breakPricedCostUsd;
  row.costSidechainUsd = +sideReal.toFixed(6);
  row.costRealizedUsd = +(mainCost.realFromTurnsUsd + sideReal).toFixed(6);
  row.idealCostUsd = +(mainCost.idealUsd + sideIdeal).toFixed(6);
  row.realFromTurnsUsd = row.costRealizedUsd;
  row.breakPricedCostUsd = +(mainCost.breakPricedUsd + sideBreak).toFixed(6);
  row.mainOnlyRecomputedUsd = +mainCost.realFromTurnsUsd.toFixed(6);
  outRows.push(row);
}

const OUT = arg('out', path.join(RUN, 'rows-sidechain-inclusive.json'));
writeFileSync(OUT, JSON.stringify(outRows, null, 2));

const sum = (rs, f) => rs.reduce((a, x) => a + (x[f] || 0), 0);
console.log(`\n=== D-2 sidechain repricing: ${summary.run} ===`);
console.log(`rows ${summary.rows} | main-only reproduced within ${(TOL * 100).toFixed(1)}%: ${summary.matched}/${summary.rows} | rows with sidechains: ${summary.withSidechains}`);
if (summary.noState.length) console.log(`  NO RETAINED STATE (${summary.noState.length}): ${summary.noState.join(', ')}`);
if (summary.mismatched.length) {
  console.log(`  *** ${summary.mismatched.length} ROW(S) DID NOT REPRODUCE — derivation untrustworthy, do not publish: ***`);
  for (const m of summary.mismatched) console.log(`    ${m.cell}: recorded $${m.recorded} vs recomputed main-only $${m.recomputedMainOnly} (${m.drift}%)`);
}
for (const arm of ['native', 'sweet']) {
  const rs = outRows.filter(x => x.arm === arm);
  const cells = rs.filter(x => (x.sidechainCount || 0) > 0).length;
  console.log(`  ${arm}: main-only $${sum(rs, 'costRealizedMainOnlyUsd').toFixed(6)}  + sidechain $${sum(rs, 'costSidechainUsd').toFixed(6)}  = inclusive $${sum(rs, 'costRealizedUsd').toFixed(6)}   (${cells} row(s) delegated)`);
}
console.log(`\nwrote ${OUT}\n`);
