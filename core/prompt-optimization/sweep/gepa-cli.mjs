/**
 * Phase 7 — GEPA CLI entry (§7.3, §7.4, §7.5).
 *
 * Split out of gepa.mjs to keep that file under the 500-line project limit.
 * Invoked by gepa.mjs's `import.meta.url` guard:
 *   node core/prompt-optimization/sweep/gepa.mjs --dry-run --rounds 1
 *
 * Flags:
 *   --run <id>          run id (results/<id>/…)            [default: p7-v1]
 *   --dry-run           offline smoke: smoke probes + T1/T2 + 1 round + stubs
 *   --real              (with --dry-run) use the real harness instead of stubs
 *   --resume            resume from the persisted checkpoint (§7.4)
 *   --rounds N          override max rounds
 *   --variants-dir DIR  override the T_i variants directory
 *   --probes FILE       dev-probes JSON for a real run (required for non-dry)
 *   --skip-preflight    skip the §7.5 pre-flight gate (NOT recommended)
 */

import { readFileSync } from 'node:fs';

import { DEFAULTS } from './p7-shared.mjs';
import { appendFsynced, trajectoryPath } from './p7-persist.mjs';
import {
  runGepa,
  normalizeVariant,
  makeDryRunEvaluate,
  makeDryRunCallModel,
  SMOKE_PROBES_PATH,
} from './gepa.mjs';

export function parseArgs(argv) {
  const o = { run: 'p7-v1', resume: false, dryRun: false, real: false, skipPreflight: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.run = argv[++i];
    else if (a === '--resume') o.resume = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--real') o.real = true;
    else if (a === '--skip-preflight') o.skipPreflight = true;
    else if (a === '--rounds') o.rounds = Number.parseInt(argv[++i], 10);
    else if (a === '--variants-dir') o.variantsDir = argv[++i];
    else if (a === '--probes') o.probesFile = argv[++i];
  }
  return o;
}

function reportResult(label, result) {
  console.log(`\n${label}: ${result.rounds} round(s), front=${result.front.length}, stopped=${result.stoppedReason}`);
  console.log(`winner: ${result.winner?.id ?? '(none)'} final=${result.winner?.finalScore?.toFixed?.(3) ?? 'n/a'}`);
}

export async function mainCli(rawArgv = process.argv.slice(2)) {
  const o = parseArgs(rawArgv);

  // ── dry-run: fully offline by default ──
  if (o.dryRun) {
    const { loadVariant } = await import('./variant-loader.mjs');
    const probes = JSON.parse(readFileSync(SMOKE_PROBES_PATH, 'utf8')).probes;
    const variants = ['T1', 'T2'].map((id) => normalizeVariant(loadVariant(id)));
    let evaluateCandidate = makeDryRunEvaluate();
    let callModel = makeDryRunCallModel();
    if (o.real) {
      const { makeRealEvaluateCandidate } = await import('./gepa-evaluate.mjs');
      const { runJudge } = await import('../../../eval/agent-read-workflows/judge-runner.js');
      evaluateCandidate = makeRealEvaluateCandidate();
      callModel = (req) => runJudge(req);
    }
    const result = await runGepa({
      runId: o.run === 'p7-v1' ? 'p7-dry' : o.run,
      variants,
      devProbes: probes,
      rotationPool: [],
      evaluateCandidate,
      callModel,
      maxRounds: o.rounds ?? 1,
      patience: DEFAULTS.patienceRounds,
      resume: o.resume,
    });
    reportResult('DRY-RUN complete', result);
    return result;
  }

  // ── real run: pre-flight gate first (§7.5) ──
  if (!o.skipPreflight) {
    const { runPreflight } = await import('./p7-preflight.mjs');
    const pf = await runPreflight({ run: o.run });
    if (!pf.ok) {
      console.error('Pre-flight FAILED — fix errors before running. (--skip-preflight overrides, NOT recommended.)');
      for (const c of pf.checks.filter((x) => !x.ok)) console.error(`  [FAIL] ${c.name}: ${c.message}`);
      process.exit(1);
    }
  }

  if (!o.probesFile) {
    console.error('Real run requires --probes <dev-probes.json>. (Want a smoke? use --dry-run.)');
    process.exit(1);
  }

  const { loadAllVariants } = await import('./variant-loader.mjs');
  const { makeRealEvaluateCandidate } = await import('./gepa-evaluate.mjs');
  const { runJudge } = await import('../../../eval/agent-read-workflows/judge-runner.js');
  const { createTokenBucket, RATE_LIMITS } = await import('./p7-token-bucket.mjs');

  const probesDoc = JSON.parse(readFileSync(o.probesFile, 'utf8'));
  const devProbes = probesDoc.probes ?? probesDoc;
  const variants = loadAllVariants().map(normalizeVariant);

  // TPM-aware token buckets per target (§7.7); defaults to Tier 2.
  const onThrottle = (ev) => appendFsynced(trajectoryPath(o.run), ev);
  const bucket = {
    sonnet: createTokenBucket({ ...RATE_LIMITS.anthropic_sonnet_4_6[2], onThrottle }),
    gpt5_5: createTokenBucket({ rpm: RATE_LIMITS.openai_gpt5_5[2].rpm, itpm: RATE_LIMITS.openai_gpt5_5[2].tpm, onThrottle }),
  };

  const result = await runGepa({
    runId: o.run,
    variants,
    devProbes,
    rotationPool: probesDoc.rotationPool ?? [],
    evaluateCandidate: makeRealEvaluateCandidate(),
    callModel: (req) => runJudge(req),
    maxRounds: o.rounds ?? DEFAULTS.maxRounds,
    resume: o.resume,
    bucket,
  });
  reportResult('GEPA complete', result);
  return result;
}
