// e3-validate.mjs — does the transcript reconstruction agree with rows.json where
// rows.json is trustworthy (codex, opencode)? And how many cells hold extra transcripts?
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const rec = readFileSync('/tmp/fp-inv/e3/rollouts.ndjson', 'utf8').trim().split('\n').map(JSON.parse);

const RUNS = {
  'fp-codex-tab-20260826': 1, 'fp-codex-none-20260826': 1, 'fp-codex-pipe-20260826': 1,
  'fp-opencode-tab-20260826': 1, 'fp-opencode-none-20260826': 1, 'fp-opencode-pipe-20260826': 1,
  'rp-oc-tab-20260827': 1, 'rp-oc-none-20260827': 1, 'rp-oc-pipe-20260827': 1,
  'fp-claudecode-tab-20260826': 1, 'fp-claudecode-none-20260826': 1, 'fp-claudecode-pipe-20260826': 1,
};
const rowsBy = {};
for (const run of Object.keys(RUNS)) {
  let rows; try { rows = JSON.parse(readFileSync(join(R, run, 'rows.json'), 'utf8')); } catch { continue; }
  rowsBy[run] = rows;
  const ungraded = rows.filter(r => r.resolved == null).length;
  const byArm = {};
  for (const r of rows) { byArm[r.arm] = (byArm[r.arm] || 0) + 1; }
  console.log(run.padEnd(30), 'rows=' + rows.length, JSON.stringify(byArm), 'ungraded=' + ungraded,
    'solved=' + rows.filter(r => r.resolved).length);
}

// cell transcript counts
const extra = {};
for (const r of rec) { const k = `${r.run}|${r.task}|${r.arm}`; extra[k] = r.transcriptsInCell; }
const hist = {};
for (const v of Object.values(extra)) hist[v] = (hist[v] || 0) + 1;
console.log('\ntranscripts-per-cell histogram:', JSON.stringify(hist));

// cost agreement, per run/arm, reconstruction vs rows.json sum
console.log('\nrun/arm  reconstructed-real  rows-costRealized  ratio  (claude uses mainOnly)');
for (const run of Object.keys(rowsBy)) {
  const rows = rowsBy[run];
  const arms = [...new Set(rows.map(r => r.arm))];
  for (const arm of arms) {
    const mine = rec.filter(r => r.run === run && r.arm === arm);
    if (!mine.length) continue;
    const mineSum = mine.reduce((s, r) => s + r.realUsd, 0);
    const rr = rows.filter(r => r.arm === arm);
    const col = run.includes('claudecode') ? 'costRealizedMainOnlyUsd' : 'costRealizedUsd';
    const rowSum = rr.reduce((s, r) => s + (r[col] || 0), 0);
    const nullN = rr.filter(r => r[col] == null).length;
    console.log(`${run}/${arm}`.padEnd(38), mineSum.toFixed(6).padStart(10), rowSum.toFixed(6).padStart(10),
      (mineSum / (rowSum || 1)).toFixed(4), ' n_mine=' + mine.length, ' n_rows=' + rr.length, ' nulls=' + nullN);
  }
}
