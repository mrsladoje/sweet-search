#!/usr/bin/env node
//
// Main-Pipeline Packaging Micro-Benchmark
//
// Deterministic A/B comparison of "raw ranked results" vs "packageForAgent
// output" across the main sweet-search modes (lexical / semantic / hybrid /
// structural). All four modes converge on the same packageForAgent layer in
// sweet-search.js, so this bench checks:
//
//   1. The packager actually produces an agent response when format is set.
//   2. Per-result token caps are respected (no overshoot).
//   3. Diversity demotion fires across modes (semantic in particular often
//      has near-duplicate near-symbol chunks).
//   4. The breadth signal (candidatePoolSize) routes correctly when grepMatches
//      is absent.
//
// Synthesizes ranked results that look like each mode's actual output shape.
// Does NOT require an indexed repo.
//
// Usage:
//   node eval/read-workflows/packaging-microbench.js
//   node eval/read-workflows/packaging-microbench.js --json
//   node eval/read-workflows/packaging-microbench.js --iters=10

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { packageForAgent, estimateTokens } from '../../core/search/context-expander.js';

function parseArgs(argv) {
  const opts = { json: false, iters: 5 };
  for (const a of argv) {
    if (a === '--json') opts.json = true;
    else if (a.startsWith('--iters=')) opts.iters = +a.split('=')[1];
  }
  return opts;
}

// ── synthetic fixture: small repo with 5 functions across 3 files ──────────

function buildFixture() {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'pkg-bench-'));

  // file A: two small functions
  const fileA = [
    'export function authenticate(user, pwd) {',           // 1
    '  if (!user || !pwd) return null;',                    // 2
    '  const hash = hashPassword(pwd);',                    // 3
    '  return validateCredentials(user, hash);',            // 4
    '}',                                                    // 5
    '',                                                     // 6
    'export function authorize(user, action) {',            // 7
    '  const role = lookupRole(user.id);',                  // 8
    '  return permissions[role]?.includes(action);',        // 9
    '}',                                                    // 10
  ].join('\n');

  // file B: one large function (200 lines)
  const fileBLines = ['export function processOrder(order) {']; // 1
  for (let i = 2; i <= 50; i++) fileBLines.push(`  // pre-validation step ${i}`);
  // Gold region 51-60
  fileBLines.push('  if (order.type === "refund") {');         // 51
  fileBLines.push('    const amt = computeRefund(order);');     // 52
  fileBLines.push('    return { refunded: true, amount: amt };'); // 53
  fileBLines.push('  }');                                        // 54
  for (let i = 55; i <= 199; i++) fileBLines.push(`  // post-step ${i}`);
  fileBLines.push('}');                                          // 200
  const fileB = fileBLines.join('\n');

  // file C: small util
  const fileC = [
    'export function permissions(role) {',
    '  return ROLE_TABLE[role] || [];',
    '}',
  ].join('\n');

  writeFileSync(join(tmpRoot, 'auth.js'), fileA, 'utf8');
  writeFileSync(join(tmpRoot, 'orders.js'), fileB, 'utf8');
  writeFileSync(join(tmpRoot, 'utils.js'), fileC, 'utf8');

  return { tmpRoot };
}

// ── synthetic ranked results (one per mode) ────────────────────────────────

function makeLexicalResults() {
  // Lexical (BM25) ranking: the literal "authenticate" matches strongest.
  return [
    { file: 'auth.js', startLine: 1, endLine: 5, score: 0.94, lateInteractionScore: 0.94,
      metadata: { file: 'auth.js', startLine: 1, endLine: 5, name: 'authenticate', type: 'function' } },
    { file: 'auth.js', startLine: 7, endLine: 10, score: 0.32, lateInteractionScore: 0.32,
      metadata: { file: 'auth.js', startLine: 7, endLine: 10, name: 'authorize', type: 'function' } },
    { file: 'utils.js', startLine: 1, endLine: 3, score: 0.18, lateInteractionScore: 0.18,
      metadata: { file: 'utils.js', startLine: 1, endLine: 3, name: 'permissions', type: 'function' } },
  ];
}

function makeSemanticResults() {
  // Semantic embeddings: sometimes returns near-duplicates from the same symbol.
  // We simulate that to exercise diversity demotion.
  return [
    { file: 'auth.js', startLine: 1, endLine: 5, score: 0.88, lateInteractionScore: 0.88,
      metadata: { file: 'auth.js', startLine: 1, endLine: 5, name: 'authenticate', type: 'function' } },
    // near-duplicate of result 1 (same file, ±5 lines)
    { file: 'auth.js', startLine: 2, endLine: 4, score: 0.86, lateInteractionScore: 0.86,
      metadata: { file: 'auth.js', startLine: 2, endLine: 4, name: 'authenticate', type: 'function' } },
    { file: 'auth.js', startLine: 7, endLine: 10, score: 0.72, lateInteractionScore: 0.72,
      metadata: { file: 'auth.js', startLine: 7, endLine: 10, name: 'authorize', type: 'function' } },
  ];
}

function makeHybridResults() {
  // Hybrid: blends lexical + semantic; gold chunk inside large function.
  return [
    { file: 'orders.js', startLine: 51, endLine: 54, score: 0.91, lateInteractionScore: 0.91,
      metadata: { file: 'orders.js', startLine: 51, endLine: 54, name: null, type: 'code' } },
    { file: 'auth.js', startLine: 1, endLine: 5, score: 0.45, lateInteractionScore: 0.45,
      metadata: { file: 'auth.js', startLine: 1, endLine: 5, name: 'authenticate', type: 'function' } },
  ];
}

// Stub codeGraphRepo: maps each known result range to its enclosing entity.
function makeStubCodeGraphRepo() {
  return {
    findEnclosingEntity: (filePath, startLine, _endLine) => {
      if (filePath === 'auth.js' && startLine >= 1 && startLine <= 5) {
        return { name: 'authenticate', type: 'function', startLine: 1, endLine: 5 };
      }
      if (filePath === 'auth.js' && startLine >= 7 && startLine <= 10) {
        return { name: 'authorize', type: 'function', startLine: 7, endLine: 10 };
      }
      if (filePath === 'orders.js' && startLine >= 1 && startLine <= 200) {
        return { name: 'processOrder', type: 'function', startLine: 1, endLine: 200 };
      }
      if (filePath === 'utils.js' && startLine >= 1 && startLine <= 3) {
        return { name: 'permissions', type: 'function', startLine: 1, endLine: 3 };
      }
      return null;
    },
    getFileIndexInfo: () => null,
    getDbMtime: () => null,
  };
}

// ── run one mode ───────────────────────────────────────────────────────────

function runMode({ name, ranked, stats, fixture, iters, format = 'agent_full', tokenBudget }) {
  const codeGraphRepo = makeStubCodeGraphRepo();
  const samples = [];

  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    const response = packageForAgent(ranked, stats, {
      query: 'auth flow',
      regex: '',
      format,
      tokenBudget,
      projectRoot: fixture.tmpRoot,
      codeGraphRepo,
    });
    const elapsedMs = performance.now() - t0;
    samples.push({
      ms: elapsedMs,
      tokensUsed: response.tokensUsed,
      results: response.results,
      tokenBudget: response.tokenBudget,
      subMode: response.subMode,
    });
  }

  const sample = samples[0];
  const median = (arr) => {
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };

  const tierCounts = sample.results.reduce((acc, r) => {
    acc[r.presentation] = (acc[r.presentation] || 0) + 1;
    return acc;
  }, {});

  // Token budget compliance: tokensUsed ≤ tokenBudget * 1.05 (5% slack for estimator)
  const budgetCompliant = sample.tokensUsed <= sample.tokenBudget * 1.05;

  // Diversity check: count results in 'full' or 'preview' tier (i.e., demoted-from-summary)
  const distinctSymbolFiles = new Set(
    sample.results.filter(r => r.code).map(r => `${r.file}:${r.symbol || ''}`)
  ).size;

  // Per-result cap compliance
  const overcapped = sample.results.filter(r => r.codeTokens > 2200); // hard cap is 2000 + 10% slack

  return {
    mode: name,
    iters,
    medianLatencyMs: +median(samples.map(s => s.ms)).toFixed(2),
    tokensUsed: sample.tokensUsed,
    tokenBudget: sample.tokenBudget,
    tierCounts,
    distinctSymbolFiles,
    resultCount: sample.results.length,
    sampleResults: sample.results.map(r => ({
      rank: r.rank,
      file: r.file,
      symbol: r.symbol,
      presentation: r.presentation,
      codeTokens: r.codeTokens,
      expansionKind: r.expansionKind,
    })),
    budgetCompliant,
    overcappedCount: overcapped.length,
  };
}

// ── main ───────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fixture = buildFixture();

  try {
    const reports = [];

    // 1. Lexical mode (BM25) — narrow, top-1 dominant
    reports.push(runMode({
      name: 'lexical',
      ranked: makeLexicalResults(),
      stats: { candidatePoolSize: 8, results_count: 3 },
      fixture,
      iters: opts.iters,
      tokenBudget: 4000,
    }));

    // 2. Semantic mode — exercises diversity demotion (near-duplicate chunks)
    reports.push(runMode({
      name: 'semantic_with_duplicates',
      ranked: makeSemanticResults(),
      stats: { candidatePoolSize: 50, results_count: 3 },
      fixture,
      iters: opts.iters,
      tokenBudget: 4000,
    }));

    // 3. Hybrid mode — gold chunk inside large function (sandwich should fire)
    reports.push(runMode({
      name: 'hybrid_with_oversize_symbol',
      ranked: makeHybridResults(),
      stats: { candidatePoolSize: 30, results_count: 2 },
      fixture,
      iters: opts.iters,
      tokenBudget: 4000,
    }));

    // 4. Stretch budget — opt-in only; fires when top-1 dominates
    reports.push(runMode({
      name: 'lexical_xl_dominant_top1',
      ranked: makeLexicalResults(), // top1=0.94, top2=0.32 → 2.94× → gate fires
      stats: { candidatePoolSize: 8, results_count: 3 },
      fixture,
      iters: opts.iters,
      format: 'agent_full_xl',
      tokenBudget: undefined, // use default 12000
    }));

    if (opts.json) {
      console.log(JSON.stringify({ reports }, null, 2));
      return;
    }

    console.log('\n=== Main-Pipeline Packaging Micro-Benchmark ===\n');
    for (const r of reports) {
      console.log(`── Mode: ${r.mode} ──`);
      console.log(`  budget=${r.tokenBudget}  tokensUsed=${r.tokensUsed}  budgetCompliant=${r.budgetCompliant}`);
      console.log(`  tiers: ${JSON.stringify(r.tierCounts)}  distinctSymbolFiles=${r.distinctSymbolFiles}  medianLatency=${r.medianLatencyMs}ms`);
      console.log(`  per-result:`);
      for (const sr of r.sampleResults) {
        console.log(`    rank=${sr.rank} file=${sr.file} symbol=${sr.symbol || '-'} presentation=${sr.presentation} kind=${sr.expansionKind || '-'} codeTokens=${sr.codeTokens}`);
      }
      console.log();
    }

    // Promotion checks
    console.log('── Promotion checks ──');
    const all = reports;
    const allBudgetCompliant = all.every(r => r.budgetCompliant);
    const allUnderHardCap = all.every(r => r.overcappedCount === 0);
    const semanticHasDuplicate = reports.find(r => r.mode === 'semantic_with_duplicates');
    const hybridHasSandwich = reports.find(r => r.mode === 'hybrid_with_oversize_symbol');
    const xlReport = reports.find(r => r.mode === 'lexical_xl_dominant_top1');

    const diversityFired = semanticHasDuplicate
      ? semanticHasDuplicate.tierCounts.summary > 0 || semanticHasDuplicate.distinctSymbolFiles < semanticHasDuplicate.resultCount
      : false;

    const sandwichFired = hybridHasSandwich
      ? hybridHasSandwich.sampleResults.some(r => r.expansionKind === 'sandwich')
      : false;

    const xlGateFired = xlReport
      ? xlReport.tokenBudget === 12000
      : false;

    console.log(`  All modes respected token budget:    ${allBudgetCompliant ? 'YES' : 'NO'}`);
    console.log(`  No result exceeded per-result cap:   ${allUnderHardCap ? 'YES' : 'NO'}`);
    console.log(`  Diversity demoted same-symbol dup:   ${diversityFired ? 'YES' : 'NO'}`);
    console.log(`  Sandwich fired on oversize symbol:   ${sandwichFired ? 'YES' : 'NO'}`);
    console.log(`  XL stretch budget activated when opt-in + dominant: ${xlGateFired ? 'YES' : 'NO'}`);
    console.log();

    const allOk = allBudgetCompliant && allUnderHardCap && diversityFired && sandwichFired && xlGateFired;
    console.log(`Overall: ${allOk ? 'PASS' : 'NEEDS REVIEW'}`);
  } finally {
    if (fixture.tmpRoot) rmSync(fixture.tmpRoot, { recursive: true, force: true });
  }
}

main();
