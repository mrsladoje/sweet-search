#!/usr/bin/env node
/**
 * heldout-aggregate.mjs — milestone aggregate-only held-out check.
 *
 * Per CLAUDE.md / BEIR/CoIR methodology: NEVER inspect held-out per-query
 * during dev work. Aggregate metrics ONLY, at milestones. This script
 * does exactly that and nothing else — it filters the v6 sweep JSONL to
 * held-out golds, applies the family-best-shape slice, and prints aggregate
 * counts per family. No per-query output anywhere.
 *
 * Also reports dev counts side-by-side for cross-check (we already know
 * those from the dev-set audit; reprinting here is harmless).
 *
 * For diff against v1 (pre-session baseline), pass the v1 track via env:
 *   V1_TRACK=path/to/track-a-phase6-redo-ss-semantic-v1.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SPLITS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const V6_TRACK = process.env.V6_TRACK
  ? path.resolve(REPO_ROOT, process.env.V6_TRACK)
  : path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-a-phase6-redo-ss-semantic-v6.jsonl');
const V1_TRACK = process.env.V1_TRACK
  ? path.resolve(REPO_ROOT, process.env.V1_TRACK)
  : path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-a-phase6-redo-ss-semantic-v1.jsonl');
const BEHAV_V5_TRACK = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-behavioural-stage05-v5.jsonl');

const FAMILY_OF_LANG = {
  java: 'OO-monolithic', csharp: 'OO-monolithic', kotlin: 'OO-monolithic', scala: 'OO-monolithic',
  rust: 'Systems-modular-terse', go: 'Systems-modular-terse',
  c: 'C-family', cpp: 'C-family', zig: 'C-family',
  javascript: 'JS-mobile', typescript: 'JS-mobile', 'typescript-lib': 'JS-mobile', dart: 'JS-mobile',
  python: 'Scripting-dynamic', ruby: 'Scripting-dynamic', php: 'Scripting-dynamic', lua: 'Scripting-dynamic', elixir: 'Scripting-dynamic',
};
const bestShape = (fam) => fam === 'C-family' ? 'V2' : 'V1';

function loadJsonl(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('{')).map(JSON.parse);
}

function loadSplits() {
  const m = JSON.parse(fs.readFileSync(SPLITS_PATH, 'utf8'));
  const dev = new Set(), held = new Set();
  for (const [, s] of Object.entries(m.perLanguage)) {
    for (const id of s.dev || []) dev.add(id);
    for (const id of s.heldout || []) held.add(id);
  }
  return { dev, held };
}

function tallyByFamily(rows, splitSet) {
  // For each gold, take the family-best-shape row. Tally per family.
  const bestRows = [];
  for (const r of rows) {
    if (!splitSet.has(r.goldId)) continue;
    const fam = r.family || FAMILY_OF_LANG[r.language];
    if (!fam) continue;
    if (r.shape !== bestShape(fam)) continue;
    bestRows.push({ ...r, family: fam });
  }
  const byFam = {};
  let total = { n: 0, PASS: 0, PARTIAL: 0, FAIL: 0, sumTop1Iou: 0 };
  for (const r of bestRows) {
    if (!byFam[r.family]) byFam[r.family] = { n: 0, PASS: 0, PARTIAL: 0, FAIL: 0, sumTop1Iou: 0 };
    byFam[r.family].n++;
    byFam[r.family][r.verdict]++;
    byFam[r.family].sumTop1Iou += r.top1_iou || 0;
    total.n++;
    total[r.verdict]++;
    total.sumTop1Iou += r.top1_iou || 0;
  }
  return { total, byFam, bestRows };
}

function fmtRow(label, t) {
  const pct = (n) => t.n > 0 ? `${(n / t.n * 100).toFixed(1)}%` : '0.0%';
  const meanIou = t.n > 0 ? (t.sumTop1Iou / t.n).toFixed(3) : '0.000';
  return `${label.padEnd(28)} n=${String(t.n).padStart(2)}  PASS=${String(t.PASS).padStart(2)} (${pct(t.PASS).padStart(6)})  PART=${String(t.PARTIAL).padStart(2)} (${pct(t.PARTIAL).padStart(6)})  FAIL=${String(t.FAIL).padStart(2)} (${pct(t.FAIL).padStart(6)})  meanTop1IoU=${meanIou}`;
}

function dump(label, tally) {
  console.log(`\n=== ${label} ===`);
  console.log(fmtRow('OVERALL', tally.total));
  for (const [fam, t] of Object.entries(tally.byFam).sort()) {
    console.log(fmtRow('  ' + fam, t));
  }
}

function main() {
  const v6 = loadJsonl(V6_TRACK);
  const v1 = loadJsonl(V1_TRACK);
  const behavV5 = loadJsonl(BEHAV_V5_TRACK);
  if (!v6) { console.error('v6 track not found:', V6_TRACK); process.exit(2); }

  const { dev, held } = loadSplits();

  // DEV (already known, reprinted for cross-check)
  const v6Dev = tallyByFamily(v6, dev);
  dump('v6 DEV  (post Fix 1A + Fix 2 + Fix 3)', v6Dev);

  // HELD-OUT (the milestone metric)
  const v6Held = tallyByFamily(v6, held);
  dump('v6 HELD-OUT  (aggregate-only — per-query inspection FORBIDDEN)', v6Held);

  if (v1) {
    const v1Dev = tallyByFamily(v1, dev);
    const v1Held = tallyByFamily(v1, held);
    console.log('\n=== DELTAS vs v1 baseline ===');
    function deltaRow(label, t1, t2) {
      const dP = t2.PASS - t1.PASS;
      const dPa = t2.PARTIAL - t1.PARTIAL;
      const dF = t2.FAIL - t1.FAIL;
      const dIou = (t2.sumTop1Iou / Math.max(1, t2.n)) - (t1.sumTop1Iou / Math.max(1, t1.n));
      const sign = (x) => x > 0 ? `+${x}` : `${x}`;
      console.log(`${label.padEnd(28)} ΔPASS=${sign(dP).padStart(3)}  ΔPART=${sign(dPa).padStart(3)}  ΔFAIL=${sign(dF).padStart(3)}  ΔmeanTop1IoU=${dIou >= 0 ? '+' : ''}${dIou.toFixed(3)}`);
    }
    deltaRow('DEV       v6 vs v1', v1Dev.total, v6Dev.total);
    deltaRow('HELD-OUT  v6 vs v1', v1Held.total, v6Held.total);
    console.log('\nPer-family held-out delta:');
    for (const fam of Object.keys(v1Held.byFam).sort()) {
      const t1 = v1Held.byFam[fam] || { n: 0, PASS: 0, PARTIAL: 0, FAIL: 0, sumTop1Iou: 0 };
      const t2 = v6Held.byFam[fam] || { n: 0, PASS: 0, PARTIAL: 0, FAIL: 0, sumTop1Iou: 0 };
      deltaRow('  ' + fam, t1, t2);
    }
  }

  // Behavioural held-out aggregate (if available)
  if (behavV5) {
    const behavHeld = tallyByFamily(
      behavV5.map((r) => ({ ...r, shape: bestShape(r.family || FAMILY_OF_LANG[r.language]) })),
      held,
    );
    dump('behavioural HELD-OUT (track-behavioural-stage05-v5, aggregate-only)', behavHeld);
  }

  console.log('\n[discipline] per-query held-out failure listing INTENTIONALLY OMITTED per CLAUDE.md BEIR methodology.');
}

main();
