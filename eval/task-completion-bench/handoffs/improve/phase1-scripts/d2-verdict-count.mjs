// D2 acceptance instrument — count run_tests verdicts on a LIVE rollout, per harness.
//
// Preflight is NOT acceptance: it validates that a gold grade transfers under the current
// config and never executes the generated shim. The only thing that catches a shim that
// cannot start is a live rollout, so this reads what the agent actually received.
//
// TWO MEASUREMENT HAZARDS, both handled here rather than left to `grep -c`:
//
//  1. THE BANNER CONTAINS THE MARKER. D2's running banner quotes the verdict marker
//     verbatim ('a completed run always ends with a line beginning "[run_tests verdict]
//     status="'). A naive grep therefore counts every banner as a verdict and would score
//     the broken build as passing. A real verdict starts a LINE; the banner's copy is
//     preceded by a quote. Both are counted separately below.
//  2. STREAMS REPEAT. opencode's NDJSON emits an updated tool part more than once, so the
//     same verdict appears 2-3 times for one call. Raw occurrence counts are therefore NOT
//     call counts. The authoritative per-call figure is the runner's own row telemetry
//     (rtLaunched / rtVerdicts / rtNoVerdict / rtEndedUnverified), which rt-inflight.mjs
//     computes from FULL tool-result text; this script's greps are the independent check
//     that the telemetry is not lying, plus the ERR_MODULE_NOT_FOUND tripwire.
//
// Usage: node d2-verdict-count.mjs <results-dir> [<results-dir> ...]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const MARKER = '[run_tests verdict] status=';
const BANNER = '[run_tests] RUNNING —';
const MODERR = 'ERR_MODULE_NOT_FOUND';

/** Occurrences of the verdict marker that begin a line — raw newline or a JSON-escaped one. */
export function countVerdictLines(text) {
  let n = 0;
  for (let i = text.indexOf(MARKER); i >= 0; i = text.indexOf(MARKER, i + 1)) {
    const before = text.slice(Math.max(0, i - 2), i);
    if (i === 0 || before.endsWith('\n') || before.endsWith('\\n')) n++;
  }
  return n;
}
/** Occurrences preceded by a quote — the banner quoting the marker, never a result. */
export function countBannerQuotes(text) {
  let n = 0;
  for (let i = text.indexOf(MARKER); i >= 0; i = text.indexOf(MARKER, i + 1)) {
    const before = text.slice(Math.max(0, i - 2), i);
    if (before.endsWith('"') || before.endsWith('\\"')) n++;
  }
  return n;
}

const TRACE_HINTS = [/attempt-\d+\.stdout\.ndjson$/, /\.jsonl$/, /\.ndjson$/, /\.json$/, /\.log$/, /\.txt$/];
function traceFiles(dir) {
  const out = [];
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (st.size > 400 * 1024 * 1024) continue;
      if (TRACE_HINTS.some(r => r.test(n))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('usage: node d2-verdict-count.mjs <results-dir> ...'); process.exit(2); }

const report = [];
for (const dir of dirs) {
  let rows = [];
  const rowsPath = path.join(dir, 'rows.json');
  if (existsSync(rowsPath)) { try { rows = JSON.parse(readFileSync(rowsPath, 'utf8')); } catch { rows = []; } }
  if (!Array.isArray(rows)) rows = [];

  let verdictLines = 0, bannerQuotes = 0, banners = 0, modErrs = 0, files = 0;
  const errSamples = [];
  for (const f of traceFiles(dir)) {
    let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
    if (!t.includes('run_tests') && !t.includes(MODERR)) continue;
    files++;
    verdictLines += countVerdictLines(t);
    bannerQuotes += countBannerQuotes(t);
    banners += t.split(BANNER).length - 1;
    const e = t.split(MODERR).length - 1;
    modErrs += e;
    if (e && errSamples.length < 3) {
      const i = t.indexOf(MODERR);
      errSamples.push(t.slice(Math.max(0, i - 60), i + 200).replace(/\s+/g, ' '));
    }
  }
  report.push({
    dir: path.basename(dir), files,
    rows: rows.map(r => ({
      taskId: r.taskId, arm: r.arm, harness: r.harness ?? null, resolved: r.resolved ?? null,
      rtLaunched: r.rtLaunched ?? null, rtVerdicts: r.rtVerdicts ?? null,
      rtNoVerdict: r.rtNoVerdict ?? null, rtEndedUnverified: r.rtEndedUnverified ?? null,
      calls: r.calls ?? null, status: r.status ?? r.error ?? null,
    })),
    verdictLines, bannerQuotes, banners, modErrs, errSamples,
  });
}

for (const r of report) {
  console.log(`\n=== ${r.dir} — ${r.files} trace file(s) mentioning run_tests ===`);
  for (const row of r.rows) {
    const tele = row.rtLaunched === null
      ? 'rt telemetry ABSENT (pre-D2 runner)'
      : `rtLaunched=${row.rtLaunched} rtVerdicts=${row.rtVerdicts} rtNoVerdict=${row.rtNoVerdict} rtEndedUnverified=${row.rtEndedUnverified}`;
    console.log(`  ${String(row.taskId).padEnd(38)} ${String(row.arm).padEnd(7)} calls=${String(row.calls).padEnd(4)} resolved=${String(row.resolved).padEnd(6)} ${tele}`);
  }
  console.log(`  verdict LINES (real results)      : ${r.verdictLines}`);
  console.log(`  banner quotes of the marker       : ${r.bannerQuotes}   (never a result)`);
  console.log(`  running banners emitted           : ${r.banners}`);
  console.log(`  ERR_MODULE_NOT_FOUND occurrences  : ${r.modErrs}`);
  for (const s of r.errSamples) console.log(`    ! ${s}`);
}
console.log('\n' + JSON.stringify(report.map(r => ({
  dir: r.dir, verdictLines: r.verdictLines, banners: r.banners, modErrs: r.modErrs, rows: r.rows,
})), null, 1));
