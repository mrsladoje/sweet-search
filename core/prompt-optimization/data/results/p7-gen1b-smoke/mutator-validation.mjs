#!/usr/bin/env node
// Targeted mutator-only validation: replaces the abandoned full Stage-1 smoke
// with three direct calls to the real opencode + gemini-3.1-pro-preview
// harness, each exercising one integration path the unit tests cannot reach.
//
// Why this exists: the full Stage-1 smoke would have spent $20-40 to exercise
// these same three paths once each via the GEPA loop. The seed-ablation phase
// proved nothing new beyond "the evaluator works", which the partial run had
// already shown after 5 minutes. This script bypasses the loop and tests
// only what we actually care about: does the REAL gemini mutator produce
// output that survives the validators we added in Stage 0?
//
// Three probes:
//   1) OP-3 persona-pivot mode-b: does gemini, given the tightened "header
//      MUST contain Query signal" instruction, produce a router-table whose
//      header passes the new `router-table-header-missing` gate?
//   2) OP-1 reflective on inefficiency: does gemini handle the new
//      topInefficiencies() row shape and produce a token-preserving rewrite?
//   3) OP-5 pruner on OP-3 output: does gemini's pruner preserve the
//      canonical router table byte-identical (M11 protection)?
//
// Cost: ~3 gemini calls × $0.30-0.60 each = ~$1-2. Wall ~3-9 min.
// No GEPA loop. No real evaluator. No judge calls. Just the mutator path.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { callMutatorHarness } from '../../../sweep/op-harness-caller.mjs';
import { runPersonaPivot } from '../../../sweep/op-persona-pivot.mjs';
import { runReflectiveRewrite } from '../../../sweep/gepa-mutate.mjs';
import { runPruner, extractProtectedBlocks } from '../../../sweep/op-pruner.mjs';
import { topInefficiencies } from '../../../sweep/gepa-scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const PARETO_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/results/p7-gen1-20260526-v3/pareto-current.json');
const PROBES_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/p7-dev-probes.json');
const OUT_PATH = path.join(__dirname, 'mutator-validation.result.json');

function header(label) { console.log(`\n${'═'.repeat(70)}\n${label}\n${'═'.repeat(70)}`); }
function ok(s) { console.log('  ✓', s); }
function warn(s) { console.log('  ⚠', s); }
function fail(s) { console.log('  ✗', s); }

async function main() {
  console.log('[mutator-validation] loading joint-best + probes + inefficiency data ...');
  const pareto = JSON.parse(await fs.readFile(PARETO_PATH, 'utf8'));
  const probesDoc = JSON.parse(await fs.readFile(PROBES_PATH, 'utf8'));
  const probes = Array.isArray(probesDoc) ? probesDoc : probesDoc.probes;

  const jointBest = pareto.front.find((m) => m.hash === '0xb44adf7c5563cd99');
  if (!jointBest) throw new Error('joint-best 0xb44adf7c5563cd99 not in pareto-current.json front');
  if (!jointBest.prompt || jointBest.prompt.length === 0) throw new Error('joint-best prompt is empty');
  console.log(`[mutator-validation] joint-best loaded: ${jointBest.prompt.length} chars, scores: ${Object.keys(jointBest.scores || {}).length} probes`);

  const inefficiencies = topInefficiencies({ candidate: jointBest, probes, limit: 5 });
  console.log(`[mutator-validation] topInefficiencies surfaced ${inefficiencies.length} rows`);
  if (inefficiencies.length === 0) {
    warn('joint-best has no probes below the 0.6 desirability threshold — using synthetic inefficiency for OP-1');
  } else {
    const w = inefficiencies[0];
    console.log(`[mutator-validation] worst inefficiency: ${w.probeId} target=${w.target} overall=${w.nativeRelativeOverall?.toFixed(3)} calls=${w.calls} vs native=${w.nativeCalls} tokens=${w.tokens} vs native=${w.nativeTokens}`);
  }

  const results = {
    timestamp: new Date().toISOString(),
    harness_model: 'google/gemini-3.1-pro-preview',
    joint_best_hash: jointBest.hash,
    probes: [],
  };

  // ─── Probe 1: OP-3 mode-b ─────────────────────────────────────────────
  header('PROBE 1 — OP-3 persona-pivot mode-b (router-table header)');
  const t1 = Date.now();
  const r1 = await runPersonaPivot({ candidate: jointBest.prompt, round: 1, callModel: callMutatorHarness });
  const w1 = Date.now() - t1;
  const r1Summary = {
    name: 'OP-3 mode-b',
    wall_ms: w1,
    mode: r1.mode,
    accepted: r1.accepted,
    generator: r1.generator,
    rejection: r1.rejection ? { reason: r1.rejection.reason, op: r1.rejection.op, failure_count: r1.rejection.failures?.length ?? 0 } : null,
    output_chars: r1.mutated?.length ?? 0,
    contains_canonical_router_table: false,
    protected_blocks_extracted: 0,
  };
  if (r1.accepted) {
    const blocks = extractProtectedBlocks(r1.mutated);
    r1Summary.protected_blocks_extracted = blocks.length;
    r1Summary.contains_canonical_router_table = blocks.some((b) => /\|\s*Query signal\s*\|/i.test(b) && /\|\s*First call\s*\|/i.test(b));
    ok(`mode=${r1.mode}, accepted in ${w1}ms (${r1.mutated.length} chars)`);
    if (r1Summary.contains_canonical_router_table) ok(`canonical-header router table present (${blocks.length} protected blocks)`);
    else fail(`accepted but NO canonical router-table header detected — validator bug?`);
  } else {
    fail(`REJECTED in ${w1}ms: reason=${r1.rejection?.reason} op=${r1.rejection?.op}`);
    if (r1.rejection?.failures) for (const f of r1.rejection.failures) console.log(`    - ${f.reason}: ${f.detail ?? ''}`);
  }
  results.probes.push({ ...r1Summary, mutated: r1.mutated?.slice(0, 4000) ?? null });

  // ─── Probe 2: OP-1 reflective on inefficiency-shape rows ─────────────
  header('PROBE 2 — OP-1 reflective on topInefficiencies() rows');
  // Use a real inefficiency row if available, else synthesize one matching the
  // shape topInefficiencies() returns.
  const failures = inefficiencies.length > 0 ? inefficiencies.slice(0, 3) : [{
    probeId: 'synthetic-001',
    stratum: 'multi-file-flow',
    repo: 'gin',
    query: 'How does the router dispatch HTTP methods to handlers?',
    jointScore: 1,
    target: 'sonnet',
    toolCalls: [{ name: 'ss-search' }, { name: 'ss-search' }, { name: 'ss-read' }],
    answer: '(simulated agent answer)',
    nativeRelativeOverall: 0.22,
    desirability: { accuracy: 1, calls: 0.18, tokens: 0.25, overall: 0.22 },
    calls: 11,
    nativeCalls: 3,
    tokens: 8200,
    nativeTokens: 1300,
  }];
  const t2 = Date.now();
  const r2 = await runReflectiveRewrite({ candidate: jointBest.prompt, failures, callModel: callMutatorHarness });
  const w2 = Date.now() - t2;
  const r2Summary = {
    name: 'OP-1 reflective',
    wall_ms: w2,
    accepted: r2.accepted,
    rejection: r2.rejection ? { reason: r2.rejection.reason, op: r2.rejection.op, failure_count: r2.rejection.failures?.length ?? 0 } : null,
    output_chars: r2.mutated?.length ?? 0,
    inefficiency_row_used: failures[0].probeId,
    inefficiency_synthetic: inefficiencies.length === 0,
  };
  if (r2.accepted) {
    ok(`accepted in ${w2}ms (${r2.mutated.length} chars; parent had ${jointBest.prompt.length})`);
    if (r2.mutated === jointBest.prompt) warn('output is byte-identical to input — no actual rewrite produced');
  } else {
    fail(`REJECTED in ${w2}ms: reason=${r2.rejection?.reason} op=${r2.rejection?.op}`);
    if (r2.rejection?.failures) for (const f of r2.rejection.failures.slice(0, 5)) console.log(`    - ${f.reason}: ${f.detail ?? ''}`);
  }
  results.probes.push({ ...r2Summary, mutated: r2.mutated?.slice(0, 4000) ?? null });

  // ─── Probe 3: OP-5 pruner on a router-table candidate ────────────────
  // Prefer to test the cooperation chain — if probe 1 produced a candidate
  // with a canonical router table, use that. Otherwise fall back to a
  // hand-crafted candidate with a known canonical table embedded.
  header('PROBE 3 — OP-5 pruner protecting a router table (byte-identical)');
  const op3Output = r1.accepted ? r1.mutated : null;
  const op3HasTable = op3Output && extractProtectedBlocks(op3Output).some((b) => /Query signal/i.test(b));
  const prunerInput = op3HasTable ? op3Output : (
    `# Sweet-search agent guide\n\nYou are a code-search agent. Always prefer indexed sweet-search tools over raw grep when possible. The router below is the canonical dispatch table; do not deviate.\n\n## Router\n\n` +
    `| Query signal | First call | Follow-up | Stop condition |\n` +
    `|---|---|---|---|\n` +
    `| Literal anchor | [[ss-grep]] | inspect the hit | One hit is enough |\n` +
    `| Known symbol | [[ss-find]] | confirm the definition | Once the symbol is clear |\n` +
    `| Unknown prose | [[ss-search]] | narrow the span | Once the span answers |\n` +
    `| Multi-file flow | [[ss-trace]] | follow callers | One complete path |\n\n` +
    `## Output\n\nReport the file(s), symbol(s), and the evidence. For absence, report the anchors you checked and answer [[no-match]]. Avoid restating the question; be brief and precise.`
  );
  const inputTable = extractProtectedBlocks(prunerInput).filter((b) => /Query signal/i.test(b))[0];
  console.log(`[mutator-validation] pruner input source: ${op3HasTable ? 'OP-3 output (real chain)' : 'hand-crafted fixture'} (${prunerInput.length} chars)`);

  const t3 = Date.now();
  const r3 = await runPruner({ candidate: prunerInput, callModel: callMutatorHarness });
  const w3 = Date.now() - t3;
  const r3Summary = {
    name: 'OP-5 pruner',
    input_source: op3HasTable ? 'op3-output' : 'fixture',
    input_chars: prunerInput.length,
    wall_ms: w3,
    accepted: r3.accepted,
    skipped: r3.skipped ?? false,
    rejection: r3.rejection ? { reason: r3.rejection.reason, op: r3.rejection.op, failure_count: r3.rejection.failures?.length ?? 0 } : null,
    output_chars: r3.mutated?.length ?? 0,
    table_survived_byte_identical: false,
  };
  if (r3.accepted) {
    const outputTables = extractProtectedBlocks(r3.mutated).filter((b) => /Query signal/i.test(b));
    r3Summary.table_survived_byte_identical = outputTables.length > 0 && r3.mutated.includes(inputTable);
    ok(`accepted in ${w3}ms (${r3.mutated.length} chars; input ${prunerInput.length})`);
    if (r3Summary.table_survived_byte_identical) ok('router table survived byte-identical');
    else fail('router table was altered or removed despite acceptance — pruner bug?');
  } else if (r3.skipped) {
    warn(`pruner returned PRUNER_SKIP (minimal/no prose to prune)`);
  } else {
    fail(`REJECTED in ${w3}ms: reason=${r3.rejection?.reason} op=${r3.rejection?.op}`);
    if (r3.rejection?.failures) for (const f of r3.rejection.failures.slice(0, 5)) console.log(`    - ${f.reason}: ${(f.block || f.detail || '').slice(0, 200)}`);
  }
  results.probes.push({ ...r3Summary, mutated: r3.mutated?.slice(0, 4000) ?? null });

  // ─── Persist ─────────────────────────────────────────────────────────
  header('SUMMARY');
  for (const p of results.probes) {
    const flag = p.accepted ? '✓' : '✗';
    console.log(`  ${flag} ${p.name.padEnd(20)} accepted=${p.accepted} wall=${p.wall_ms}ms` +
      (p.rejection ? ` reason=${p.rejection.reason}` : ''));
  }
  await fs.writeFile(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nResult JSON written to: ${OUT_PATH}`);
}

main().catch((e) => {
  console.error('[mutator-validation] FATAL:', e?.stack || e?.message || e);
  process.exit(1);
});
