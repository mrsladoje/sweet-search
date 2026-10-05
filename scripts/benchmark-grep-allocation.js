#!/usr/bin/env node

/**
 * ss-grep line-allocation microbenchmark (grep-output-shaping.js)
 *
 * Times the agent grep shaping step, old rule vs new rule, on synthetic
 * (file,line)-sorted match lists (the engine sorts before shaping, so the sort
 * is outside the timed region for both):
 *
 *   old  applyGrepFileDiversity (first maxFiles in path order)
 *        + renderGrepBody (round robin in path order)          SS_FIX_GREP_ALLOC=0
 *   new  applyGrepFileDiversity order:'weight' (streaming top-maxFiles by
 *        sqrt(hits) x prior) + renderGrepBody alloc:'weight' (Sainte-Laguë)
 *
 * Arguments are what ss-grep passes: perFileCap = min(k, 100), maxFiles = k.
 * Before every timed call each match gets a fresh copy of its path string, as
 * the engine gives every match its own string (normalizeSearchPath per match),
 * so no call reuses work V8 cached on an earlier string object. Old and new run
 * in alternating blocks; each figure is the median per-call time in
 * microseconds over all timed calls.
 *
 * Usage:
 *   node scripts/benchmark-grep-allocation.js [--json] [--budget-ms N]
 */

import { performance } from 'perf_hooks';
import { applyGrepFileDiversity, renderGrepBody } from '../core/search/grep-output-shaping.js';

const FILE_COUNTS = [20, 100, 1000, 50000];
const KS = [8, 20, 30, 100];
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const budgetIdx = args.indexOf('--budget-ms');
const BUDGET_MS = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) : 400;

// Deterministic PRNG (mulberry32), seed 42.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hits per file: heavy tail like real grep output (most files 1 hit, a few dense). */
function drawHits(r) {
  const u = r();
  if (u < 0.55) return 1;
  if (u < 0.80) return 2 + Math.floor(r() * 3);
  if (u < 0.95) return 5 + Math.floor(r() * 15);
  return 20 + Math.floor(r() * 180);
}

/** File path: ~70% source, ~20% test, ~10% vendored. */
function drawPath(r, i) {
  const u = r();
  const dir = `pkg/mod${i % 97}`;
  if (u < 0.70) return `${dir}/file${i}.go`;
  if (u < 0.90) return `${dir}/file${i}_test.go`;
  return `vendor/github.com/x/y${i % 13}/file${i}.go`;
}

function buildMatches(fileSpecs) {
  fileSpecs.sort((a, b) => a.file.localeCompare(b.file));
  const matches = [];
  for (const { file, hits } of fileSpecs) {
    for (let line = 1; line <= hits; line++) {
      matches.push({ file, line: line * 7, column: 1, matchText: `func Export${line}(ctx context.Context) error {` });
    }
  }
  return matches;
}

function randomCase(F) {
  const r = rng(42 + F);
  const specs = [];
  for (let i = 0; i < F; i++) specs.push({ file: drawPath(r, i), hits: drawHits(r) });
  return buildMatches(specs);
}

/** 1 file with 5,000 hits (late in the alphabet) + 10,000 files with 1 hit. */
function skewedCase() {
  const specs = [{ file: 'zz/worker/export.go', hits: 5000 }];
  for (let i = 0; i < 10000; i++) specs.push({ file: `pkg/mod${i % 97}/file${i}.go`, hits: 1 });
  return buildMatches(specs);
}

function oldRule(matches, k) {
  const { kept, fileSummary } = applyGrepFileDiversity(matches, { perFileCap: Math.min(k, 100), maxFiles: k });
  return renderGrepBody(kept, fileSummary, k);
}

function newRule(matches, k) {
  const { kept, fileSummary } = applyGrepFileDiversity(matches, { perFileCap: Math.min(k, 100), maxFiles: k, order: 'weight' });
  return renderGrepBody(kept, fileSummary, k, { alloc: 'weight' });
}

let sink = 0;

/** Give every match a fresh copy of its path string (outside the timed region). */
function freshPaths(matches) {
  for (const m of matches) m.file = Buffer.from(m.file).toString();
}

function timeBlock(fn, matches, k, iters, out) {
  for (let i = 0; i < iters; i++) {
    freshPaths(matches);
    const t0 = performance.now();
    const body = fn(matches, k);
    out.push(performance.now() - t0);
    sink += body.lines.length;
  }
}

function median(xs) {
  const s = Float64Array.from(xs).sort();
  return s[s.length >> 1];
}

function bench(label, matches, k) {
  // Warm up both paths so the JIT has compiled them before timing.
  for (let i = 0; i < 200; i++) { oldRule(matches, k); newRule(matches, k); }
  const probe = performance.now();
  oldRule(matches, k); newRule(matches, k);
  const perPair = Math.max(performance.now() - probe, 0.001);
  const iters = Math.max(30, Math.min(10000, Math.floor(BUDGET_MS / perPair)));
  const block = Math.max(5, Math.floor(iters / 10));
  const oldT = []; const newT = [];
  for (let done = 0; done < iters; done += block) {
    timeBlock(oldRule, matches, k, block, oldT);
    timeBlock(newRule, matches, k, block, newT);
  }
  const files = new Set(matches.map(m => m.file)).size;
  return {
    label, files, matches: matches.length, k, calls: oldT.length,
    oldUs: median(oldT) * 1000, newUs: median(newT) * 1000,
  };
}

const rows = [];
for (const F of FILE_COUNTS) {
  const matches = randomCase(F);
  for (const k of KS) rows.push(bench(`F=${F}`, matches, k));
}
const skew = skewedCase();
for (const k of KS) rows.push(bench('skewed 1x5000 + 10000x1', skew, k));

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (x) => x.toFixed(1).padStart(9);
  console.log(`${pad('case', 26)}${pad('files', 8)}${pad('matches', 9)}${pad('k', 5)}${pad('calls', 7)}  old µs    new µs   new/old`);
  for (const r of rows) {
    console.log(`${pad(r.label, 26)}${pad(r.files, 8)}${pad(r.matches, 9)}${pad(r.k, 5)}${pad(r.calls, 7)}${num(r.oldUs)} ${num(r.newUs)}   ${(r.newUs / r.oldUs).toFixed(2)}`);
  }
}
if (sink < 0) console.log(sink);
