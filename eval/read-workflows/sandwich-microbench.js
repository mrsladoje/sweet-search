#!/usr/bin/env node
//
// Symbol-Sandwich Micro-Benchmark
//
// Deterministic A/B comparison of the symbol-sandwich expansion vs the
// previous "bare chunk + entity name" fallback for the case that motivated
// the change: gold chunk lives inside an oversized function/class.
//
// This bench does NOT require an indexed repo — it builds a synthetic
// codebase on disk, constructs synthetic ranked results, and runs
// packageForAgent twice:
//   - sandwich    (default behavior)
//   - no-sandwich (ablation flag — old fallback path)
//
// Metrics tracked per arm:
//   - goldLineRecall      : fraction of gold lines present in the rendered code
//   - signaturePresent    : 1 if the function signature line is in the output
//   - closingPresent      : 1 if the closing brace is in the output
//   - elisionMarkerPresent: 1 if a `// ... (N lines elided)` marker is there
//   - codeTokens          : estimated tokens of returned code
//   - latencyMs           : wall-clock ms for packaging
//
// Usage:
//   node eval/read-workflows/sandwich-microbench.js
//   node eval/read-workflows/sandwich-microbench.js --json
//   node eval/read-workflows/sandwich-microbench.js --iters=10

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { packageForAgent } from '../../core/search/context-expander.js';

// ── argv ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { json: false, iters: 5 };
  for (const a of argv) {
    if (a === '--json') opts.json = true;
    else if (a.startsWith('--iters=')) opts.iters = +a.split('=')[1];
  }
  return opts;
}

// ── synthetic fixture ───────────────────────────────────────────────────────

const GOLD_MARKER_BEGIN = 'GOLD_MARKER: refund branch begins';
const GOLD_MARKER_END = 'GOLD_MARKER: end of refund branch';
const SIGNATURE_TOKEN = 'export function processOrders';
const CLOSING_BRACE_LINE_REGEX = /^\}\s*$/m;
const ELISION_REGEX = /\/\/ \.\.\. \(\d+ lines elided\)/;

function buildFixture() {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'sandwich-bench-'));
  const filename = 'huge-fn.js';

  // 1000-line file. Function body spans 1..1000.
  // Gold region: lines 500..510 (the refund branch).
  const lines = [];
  lines.push(`${SIGNATURE_TOKEN}(input, options) {`); // 1 (signature start)
  lines.push('  const { strict = false } = options || {};'); // 2
  lines.push('  let total = 0;'); // 3
  lines.push('  // pre-validation phase'); // 4
  for (let i = 5; i <= 499; i++) {
    lines.push(`  // filler line ${i} — ${'x'.repeat(20)}`);
  }
  // Gold region 500..510 (11 lines)
  lines.push('  if (input.kind === "refund") {');                  // 500
  lines.push(`    // ${GOLD_MARKER_BEGIN}`);                        // 501
  lines.push('    const refundAmount = computeRefund(input);');    // 502
  lines.push('    if (refundAmount > options.maxRefund) {');       // 503
  lines.push('      throw new RefundLimitExceeded(refundAmount);');// 504
  lines.push('    }');                                              // 505
  lines.push('    total -= refundAmount;');                        // 506
  lines.push('    return { ok: true, total, refunded: true };');   // 507
  lines.push('  }');                                                // 508
  lines.push(`  // ${GOLD_MARKER_END}`);                            // 509
  lines.push('');                                                   // 510
  for (let i = 511; i <= 999; i++) {
    lines.push(`  // filler line ${i} — ${'y'.repeat(20)}`);
  }
  lines.push('}'); // 1000 (closing brace)

  writeFileSync(join(tmpRoot, filename), lines.join('\n'), 'utf8');

  // Gold lines = 500..510 inclusive (11 lines)
  const goldLines = [];
  for (let l = 500; l <= 510; l++) goldLines.push(l);

  return {
    tmpRoot,
    filename,
    goldLines,
    goldStart: 500,
    goldEnd: 510,
    entityStart: 1,
    entityEnd: 1000,
  };
}

function makeCodeGraphRepo(entity) {
  return {
    findEnclosingEntity: () => ({
      name: 'processOrders',
      type: 'function',
      startLine: entity.entityStart,
      endLine: entity.entityEnd,
      parentClass: null,
    }),
    getFileIndexInfo: () => null,
    getDbMtime: () => null,
  };
}

function makeRankedResult(fixture) {
  return [{
    file: fixture.filename,
    startLine: fixture.goldStart,
    endLine: fixture.goldEnd,
    score: 0.95,
    lateInteractionScore: 0.95,
    metadata: {
      file: fixture.filename,
      startLine: fixture.goldStart,
      endLine: fixture.goldEnd,
      name: null,
      type: 'code',
    },
  }];
}

// ── metrics ─────────────────────────────────────────────────────────────────

function scoreOutput(code, fixture) {
  if (!code) {
    return {
      goldLineRecall: 0,
      signaturePresent: 0,
      closingPresent: 0,
      elisionMarkerPresent: 0,
      goldMarkerBeginPresent: 0,
      goldMarkerEndPresent: 0,
    };
  }

  // Count how many of the gold lines made it into the rendered code.
  // We use distinctive content from each gold line as a proxy.
  const goldLineSignals = [
    'if (input.kind === "refund") {',                  // 500
    GOLD_MARKER_BEGIN,                                  // 501
    'const refundAmount = computeRefund(input);',      // 502
    'if (refundAmount > options.maxRefund) {',         // 503
    'throw new RefundLimitExceeded(refundAmount);',    // 504
    'total -= refundAmount;',                           // 506
    'return { ok: true, total, refunded: true };',     // 507
    GOLD_MARKER_END,                                    // 509
  ];
  let hits = 0;
  for (const sig of goldLineSignals) {
    if (code.includes(sig)) hits++;
  }

  return {
    goldLineRecall: hits / goldLineSignals.length,
    signaturePresent: code.includes(SIGNATURE_TOKEN) ? 1 : 0,
    closingPresent: CLOSING_BRACE_LINE_REGEX.test(code) ? 1 : 0,
    elisionMarkerPresent: ELISION_REGEX.test(code) ? 1 : 0,
    goldMarkerBeginPresent: code.includes(GOLD_MARKER_BEGIN) ? 1 : 0,
    goldMarkerEndPresent: code.includes(GOLD_MARKER_END) ? 1 : 0,
  };
}

// ── run one arm ─────────────────────────────────────────────────────────────

function runArm({ name, ablations, fixture, iters, tokenBudget }) {
  const ranked = makeRankedResult(fixture);
  const codeGraphRepo = makeCodeGraphRepo(fixture);
  const stats = { grepMatches: 1, indexedChunks: 1 };

  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    const response = packageForAgent(ranked, stats, {
      query: 'refund branch',
      regex: 'refund',
      format: 'agent_full',
      tokenBudget,
      projectRoot: fixture.tmpRoot,
      codeGraphRepo,
      ablations: new Set(ablations),
    });
    const elapsedMs = performance.now() - t0;
    const r = response.results[0] || {};
    const m = scoreOutput(r.code || '', fixture);
    samples.push({
      ms: elapsedMs,
      codeTokens: r.codeTokens || 0,
      expansionKind: r.expansionKind || null,
      ...m,
    });
  }

  const median = (arr) => {
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };
  const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;

  return {
    arm: name,
    iters,
    expansionKind: samples[0].expansionKind,
    medianLatencyMs: +median(samples.map(s => s.ms)).toFixed(2),
    meanLatencyMs: +mean(samples.map(s => s.ms)).toFixed(2),
    medianCodeTokens: median(samples.map(s => s.codeTokens)),
    goldLineRecall: +mean(samples.map(s => s.goldLineRecall)).toFixed(3),
    signaturePresent: samples[0].signaturePresent,
    closingPresent: samples[0].closingPresent,
    elisionMarkerPresent: samples[0].elisionMarkerPresent,
    goldMarkerBeginPresent: samples[0].goldMarkerBeginPresent,
    goldMarkerEndPresent: samples[0].goldMarkerEndPresent,
  };
}

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fixture = buildFixture();

  try {
    // We test at two budgets:
    //   - 1500 (sandwich fits comfortably)
    //   - 320 (sandwich tight; baseline can't fit gold-with-context either)
    const scenarios = [
      { tokenBudget: 1500, label: 'comfortable' },
      { tokenBudget: 320,  label: 'tight' },
    ];
    const results = [];
    for (const sc of scenarios) {
      const baseline = runArm({
        name: `baseline_no_sandwich_budget=${sc.tokenBudget}`,
        ablations: ['no-sandwich'],
        fixture,
        iters: opts.iters,
        tokenBudget: sc.tokenBudget,
      });
      const sandwich = runArm({
        name: `sandwich_budget=${sc.tokenBudget}`,
        ablations: [],
        fixture,
        iters: opts.iters,
        tokenBudget: sc.tokenBudget,
      });
      results.push({ scenario: sc.label, tokenBudget: sc.tokenBudget, baseline, sandwich });
    }

    if (opts.json) {
      console.log(JSON.stringify({ results }, null, 2));
      return;
    }

    // Pretty print
    console.log('\n=== Symbol-Sandwich Micro-Benchmark ===\n');
    console.log(`Fixture: 1000-line function, gold chunk at lines 500-510`);
    console.log(`Iters per arm: ${opts.iters}\n`);

    for (const r of results) {
      console.log(`── Scenario: ${r.scenario} (tokenBudget=${r.tokenBudget}) ──`);
      const headers = [
        'arm', 'kind', 'codeTokens', 'goldRecall', 'sig', 'close', 'elision', 'medMs',
      ];
      console.log(headers.map(h => h.padStart(22)).join(' '));
      for (const arm of [r.baseline, r.sandwich]) {
        const row = [
          arm.arm,
          arm.expansionKind || '-',
          String(arm.medianCodeTokens),
          arm.goldLineRecall.toFixed(3),
          arm.signaturePresent ? 'Y' : 'N',
          arm.closingPresent ? 'Y' : 'N',
          arm.elisionMarkerPresent ? 'Y' : 'N',
          arm.medianLatencyMs.toFixed(2),
        ];
        console.log(row.map(c => c.padStart(22)).join(' '));
      }
      console.log();

      // Promotion criteria check (per the user's contract)
      const baseline = r.baseline;
      const sandwich = r.sandwich;
      const goldRecallOk = sandwich.goldLineRecall >= baseline.goldLineRecall;
      const tokenOk = sandwich.medianCodeTokens <= baseline.medianCodeTokens * 1.10
                   || sandwich.goldLineRecall > baseline.goldLineRecall;
      const latencyOk = sandwich.medianLatencyMs <= baseline.medianLatencyMs * 1.05
                     || baseline.medianLatencyMs < 1.0; // tolerate jitter at sub-ms
      const sigGain = sandwich.signaturePresent && !baseline.signaturePresent;

      console.log(`  goldLineRecall:   sandwich=${sandwich.goldLineRecall} vs baseline=${baseline.goldLineRecall}  ${goldRecallOk ? 'OK' : 'REGRESSION'}`);
      console.log(`  codeTokens:       sandwich=${sandwich.medianCodeTokens} vs baseline=${baseline.medianCodeTokens}  ${tokenOk ? 'OK' : 'REGRESSION'}`);
      console.log(`  latency:          sandwich=${sandwich.medianLatencyMs}ms vs baseline=${baseline.medianLatencyMs}ms  ${latencyOk ? 'OK' : 'REGRESSION'}`);
      console.log(`  signature added:  ${sigGain ? 'YES (grounding gain)' : 'no change'}`);
      console.log();
    }
  } finally {
    if (fixture.tmpRoot) rmSync(fixture.tmpRoot, { recursive: true, force: true });
  }
}

main();
