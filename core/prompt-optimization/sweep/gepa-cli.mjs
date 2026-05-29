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
 *   --screen-probe-ids CSV  explicit screen probe ids for diagnostic reruns
 *   --probes FILE       dev-probes JSON for a real run (required for non-dry)
 *   --native-baseline FILE  native rg+Read baseline JSON for relative scoring
 *   --agent-provider api|cli  real GEPA agent runtime [api for real, cli for --dry-run --real]
 *   --smoke-probes N    (with --dry-run) cap smoke probes to the first N
 *   --smoke-variants N  (with --dry-run) cap seed variants to the first N (≤2)
 *   --concurrency N     bounded # of agent trajectories in flight (any target); default 1
 *   --skip-finalize     skip the post-convergence winner-only ship gates (e.g. one-generation runs)
 *   --skip-preflight    skip the §7.5 pre-flight gate (NOT recommended)
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS } from './p7-shared.mjs';
import { assertNativeBaselineCoverage } from './eas.mjs';
import { appendFsynced, trajectoryPath } from './p7-persist.mjs';
import {
  runGepa,
  normalizeVariant,
  makeDryRunEvaluate,
  makeDryRunCallModel,
  SMOKE_PROBES_PATH,
} from './gepa.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Frozen §3.5.1 OOD language-transfer probe set (loaded if not bundled in --probes). */
const OOD_PROBES_FILE = path.join(__dirname, '../data/frozen/p7-langtransfer-probes.json');
/** Frozen §5.7 adversarial counter-probe set (loaded if not bundled in --probes). */
const COUNTER_PROBES_FILE = path.join(__dirname, '../data/frozen/p7-adversarial-counter-probes.json');

/**
 * Mutator calls to Kimi K2.6 (moonshot) run heavy reasoning on large reflective /
 * crossover prompts that routinely exceed the 90s judge default (≈60s even on a
 * small prompt) → timeout → "model-error" (B2, smoke 2026-05-22). Give moonshot
 * mutator calls a generous timeout + token headroom; judges keep the fast
 * default. Explicit per-call timeoutMs/maxTokens still win (spread last).
 */
export const MOONSHOT_MUTATOR_TIMEOUT_MS = 300000;
export const MOONSHOT_MUTATOR_MAX_TOKENS = 8192;
export function withMutatorCallDefaults(req) {
  if (req && req.lineage === 'moonshot') {
    return { timeoutMs: MOONSHOT_MUTATOR_TIMEOUT_MS, maxTokens: MOONSHOT_MUTATOR_MAX_TOKENS, ...req };
  }
  return req;
}

/**
 * Round-0 ablation gate (D3). Inspect a loaded variant slate and refuse to
 * launch evolutionary rounds if any variant is tagged
 * `unverified-until-round-0-ablation` in its frontMatter
 * `expected_weaknesses` — those variants must first land a measured
 * finalScore via a round-0 ablation per PHASE7.md §4.6.1. The caller can
 * pass `allowUnverified: true` to bypass the gate (the `--allow-unverified-seeds`
 * CLI flag), which is only safe when a round-0 measurement was performed
 * out-of-band.
 *
 * @param {object} args
 * @param {object[]} args.variants  pre-normalize loader output (carries frontMatter)
 * @param {boolean} [args.allowUnverified=false]
 * @returns {{ ok: true } | { ok: false, unverified: object[] }}
 */
export function assertSeedsVerified({ variants, allowUnverified = false } = {}) {
  if (allowUnverified) return { ok: true };
  const unverified = (Array.isArray(variants) ? variants : []).filter((v) => {
    const ew = v?.frontMatter?.expected_weaknesses;
    return Array.isArray(ew) && ew.includes('unverified-until-round-0-ablation');
  });
  return unverified.length === 0 ? { ok: true } : { ok: false, unverified };
}

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
    else if (a === '--screen-probe-ids') o.screenProbeIds = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--probes') o.probesFile = argv[++i];
    else if (a === '--native-baseline') o.nativeBaselineFile = argv[++i];
    else if (a === '--agent-provider') o.agentProvider = argv[++i];
    else if (a === '--smoke-probes') o.smokeProbes = Number.parseInt(argv[++i], 10);
    else if (a === '--smoke-variants') o.smokeVariants = Number.parseInt(argv[++i], 10);
    else if (a === '--concurrency') o.concurrency = Number.parseInt(argv[++i], 10);
    else if (a === '--repeats') o.repeats = Number.parseInt(argv[++i], 10);
    else if (a === '--initial-front') o.initialFrontFile = argv[++i];
    else if (a === '--skip-finalize') o.skipFinalize = true;
    else if (a === '--allow-unverified-seeds') o.allowUnverifiedSeeds = true;
  }
  if (o.agentProvider && !['api', 'cli'].includes(o.agentProvider)) {
    throw new Error(`unknown --agent-provider ${o.agentProvider}`);
  }
  if (o.concurrency !== undefined && (!Number.isInteger(o.concurrency) || o.concurrency < 1)) {
    throw new Error('--concurrency must be a positive integer');
  }
  if (o.repeats !== undefined && (!Number.isInteger(o.repeats) || o.repeats < 1)) {
    throw new Error('--repeats must be a positive integer');
  }
  if (o.initialFrontFile !== undefined && !existsSync(o.initialFrontFile)) {
    throw new Error(`--initial-front file not found: ${o.initialFrontFile}`);
  }
  if (o.screenProbeIds !== undefined && o.screenProbeIds.length === 0) {
    throw new Error('--screen-probe-ids must contain at least one id');
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
    const { loadVariant, loadVariantsFromDir } = await import('./variant-loader.mjs');
    let probes = JSON.parse(readFileSync(SMOKE_PROBES_PATH, 'utf8')).probes;
    // --smoke-probes/--smoke-variants trim the matrix for a cheap real smoke
    // (e.g. 1×1×2-targets ≈ $0.30 vs the full 5×2).
    if (Number.isInteger(o.smokeProbes) && o.smokeProbes > 0) probes = probes.slice(0, o.smokeProbes);
    let variants;
    if (o.variantsDir) {
      variants = loadVariantsFromDir(o.variantsDir).slice(0, Number.isInteger(o.smokeVariants) && o.smokeVariants > 0 ? o.smokeVariants : 2).map(normalizeVariant);
    } else {
      let variantIds = ['T1', 'T2'];
      if (Number.isInteger(o.smokeVariants) && o.smokeVariants > 0) variantIds = variantIds.slice(0, o.smokeVariants);
      variants = variantIds.map((id) => normalizeVariant(loadVariant(id)));
    }
    let evaluateCandidate = makeDryRunEvaluate();
    let callModel = makeDryRunCallModel();
    if (o.real) {
      const { makeRealEvaluateCandidate } = await import('./gepa-evaluate.mjs');
      const { runJudge } = await import('../../../eval/agent-read-workflows/judge-runner.js');
      evaluateCandidate = makeRealEvaluateCandidate({ agentProvider: o.agentProvider ?? 'cli' });
      callModel = (req) => runJudge(withMutatorCallDefaults(req));
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
      concurrency: o.concurrency ?? 1,
      repeats: o.repeats ?? DEFAULTS.repeats,
      screenProbeIds: o.screenProbeIds ?? [],
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

  const { loadAllVariants, loadVariantsFromDir } = await import('./variant-loader.mjs');
  const { makeRealEvaluateCandidate } = await import('./gepa-evaluate.mjs');
  const { runJudge } = await import('../../../eval/agent-read-workflows/judge-runner.js');
  const { callMutatorHarness } = await import('./op-harness-caller.mjs');
  const { createTokenBucket, RATE_LIMITS } = await import('./p7-token-bucket.mjs');

  const probesDoc = JSON.parse(readFileSync(o.probesFile, 'utf8'));
  const devProbes = probesDoc.probes ?? probesDoc;
  const rotationPool = probesDoc.rotationPool ?? [];
  const loadedVariants = o.variantsDir ? loadVariantsFromDir(o.variantsDir) : loadAllVariants();
  // D3: round-0 ablation gate. If the slate contains any variant tagged
  // `unverified-until-round-0-ablation` (e.g. the pruner-placeholder, or any
  // hand seed admitted via gepa-restart-scaffold), refuse to launch
  // evolutionary rounds until the operator confirms (via flag) that a
  // round-0 measurement has been done. See PHASE7.md §4.6.1.
  const guard = assertSeedsVerified({ variants: loadedVariants, allowUnverified: !!o.allowUnverifiedSeeds });
  if (!guard.ok) {
    console.error('ERROR: launch refused — slate contains unverified seeds without a round-0 ablation.');
    console.error('See PHASE7.md §4.6.1 for the round-0 ablation gate protocol.');
    console.error('Unverified seeds in slate:');
    for (const v of guard.unverified) console.error(`  - ${v.id}: source_id=${v.frontMatter?.source_id ?? '?'}`);
    console.error('');
    console.error('To override (NOT recommended; only safe if you have a round-0 measurement out-of-band): pass --allow-unverified-seeds.');
    process.exit(1);
  }
  const variants = loadedVariants.map(normalizeVariant);
  let nativeBaselineByTarget = null;
  if (o.nativeBaselineFile) {
    nativeBaselineByTarget = assertNativeBaselineCoverage({
      baselineByTarget: JSON.parse(readFileSync(o.nativeBaselineFile, 'utf8')),
      probes: [...devProbes, ...rotationPool],
    });
  }

  // TPM-aware token buckets per target (§7.7); defaults to Tier 2.
  const onThrottle = (ev) => appendFsynced(trajectoryPath(o.run), ev);
  const bucket = {
    sonnet: createTokenBucket({ ...RATE_LIMITS.anthropic_sonnet_4_6[2], onThrottle }),
    gpt5_5: createTokenBucket({ rpm: RATE_LIMITS.openai_gpt5_5[2].rpm, itpm: RATE_LIMITS.openai_gpt5_5[2].tpm, onThrottle }),
  };

  // M2: on --resume a fresh in-memory bucket believes it has full budget and
  // would burst max_concurrent immediately → the §7.7 Tier-1 "429-storm minute
  // one" (the interrupted run may still have in-flight tokens against the
  // provider's rolling window). Pessimistically prime each bucket so the first
  // post-resume acquire is throttled for ~one WINDOW_MS cooldown.
  if (o.resume) {
    bucket.sonnet.primeForResume();
    bucket.gpt5_5.primeForResume();
  }

  const result = await runGepa({
    runId: o.run,
    variants,
    devProbes,
    rotationPool,
    evaluateCandidate: makeRealEvaluateCandidate({ agentProvider: o.agentProvider ?? 'api' }),
    callModel: (req) => runJudge(withMutatorCallDefaults(req)),
    // Mutator path (OP-1..OP-5): route through opencode + gemini-3.1-pro-preview
    // so each operator call has tool-using access to the repo (Read, Grep, Bash)
    // and can self-investigate scoring/EAS/Pareto/trajectory data before
    // producing its mutation. TARE adversarial paraphrasing keeps `callModel`
    // (direct-API) for cost — paraphrases are short and don't benefit from
    // agentic context-gathering.
    mutatorCallModel: callMutatorHarness,
    maxRounds: o.rounds ?? DEFAULTS.maxRounds,
    resume: o.resume,
    bucket,
    nativeBaselineByTarget,
    concurrency: o.concurrency ?? 1,
    repeats: o.repeats ?? DEFAULTS.repeats,
    // Pre-scored seed front (skips the round-0 ablation). Used to reuse an
    // already-measured seed front (e.g. the gen-1b rescore + 1 fresh rep merged
    // to 2 reps) instead of re-ablating from scratch.
    initialFront: o.initialFrontFile ? JSON.parse(readFileSync(o.initialFrontFile, 'utf8')) : undefined,
    screenProbeIds: o.screenProbeIds ?? [],
  });
  reportResult('GEPA complete', result);

  // ── §4 winner-selection finalize (CC2/M13/M7) ──
  // Runs the post-convergence ship gates IN ORDER + once-only Vault open. Only
  // attempted on a real run with a winner; the gate runners are constructed from
  // the real harness here (reasoning adapters via M7). Skipped (with a notice)
  // when the gate probe sets are not yet authored — the run still produces its
  // trajectory + checkpoint, and finalize can be re-run later. `--skip-finalize`
  // bypasses it entirely (e.g. running a single generation to inspect, with no
  // end-of-run winner-only gate spend).
  if (result.winner && !o.skipFinalize) {
    try {
      await runFinalizeStage({ runId: o.run, winner: result.winner, probesDoc, runJudge, agentProvider: o.agentProvider ?? 'api' });
    } catch (e) {
      console.error('finalize: skipped —', e?.message || e);
    }
  }
  return result;
}

/**
 * Construct the real injected gate runners and invoke finalizeRun (CC2/M13/M7).
 * Loads the frozen gate probe sets if present; if a required set is missing the
 * corresponding gate is simply not run (finalizeRun treats absent runners/probes
 * as not-applicable). The reasoning adapters (M7) are built from the real
 * judge-runner reasoning payloads via makeReasoningAdapters.
 */
async function runFinalizeStage({ runId, winner, probesDoc, runJudge, agentProvider = 'api' }) {
  const { finalizeRun, makeReasoningAdapters } = await import('./gepa-finalize.mjs');
  const { runOodGate } = await import('./p7-ood-gate.mjs');
  const { runCounterProbeGate } = await import('./p7-counter-probe-gate.mjs');
  const { trajectoryPath, RESULTS_DIR } = await import('./p7-persist.mjs');

  const heldoutProbes = probesDoc.heldoutProbes ?? [];
  // OOD probes (§3.5.1): prefer the run's probesDoc; otherwise load the frozen,
  // pre-registered language-transfer set (40 probes / 8 OOD languages).
  let oodProbes = probesDoc.oodProbes ?? [];
  if (oodProbes.length === 0 && existsSync(OOD_PROBES_FILE)) {
    const oodDoc = JSON.parse(readFileSync(OOD_PROBES_FILE, 'utf8'));
    oodProbes = oodDoc.probes ?? oodDoc;
  }
  // Counter-probes (§5.7): prefer probesDoc; otherwise load the frozen set.
  let counterProbes = probesDoc.counterProbes ?? [];
  if (counterProbes.length === 0 && existsSync(COUNTER_PROBES_FILE)) {
    const cpDoc = JSON.parse(readFileSync(COUNTER_PROBES_FILE, 'utf8'));
    counterProbes = cpDoc.probes ?? cpDoc;
  }
  const vaultProbes = probesDoc.vaultProbes ?? [];
  const scsProbes = probesDoc.scsProbes ?? [];

  // M7 reasoning adapters wired through the real reasoning payloads.
  const reasoningAdapters = makeReasoningAdapters({ runJudge });

  // OOD gate (§3.5.1): replay the winner on each OOD probe per PRODUCTION target
  // via the real harness (resolveRepoCwd now maps the 8 ast-tester OOD repos).
  // Gate decision = Sonnet + GPT-5.5; MiMo is reported-only and intentionally
  // left unwired here (optional runMimo, non-gating). Each per-target stream is
  // sequential per-probe, so the two concurrent streams stay rate-limited.
  const { makeRealEvaluateCandidate, makeOodReplayRunner } = await import('./gepa-evaluate.mjs');
  const evaluateOod = makeRealEvaluateCandidate({ agentProvider });
  const runOod = oodProbes.length > 0
    ? async ({ winnerPrompt, oodProbes: probes }) => runOodGate({
        winnerPrompt,
        oodProbes: probes,
        runSonnet: makeOodReplayRunner({ evaluate: evaluateOod, target: 'sonnet' }),
        runGpt5_5: makeOodReplayRunner({ evaluate: evaluateOod, target: 'gpt5_5' }),
      })
    : undefined;

  // §5.7 counter-probe gate: same replay machinery; compares the winner's
  // counter-probe maximin to its dev taskScore (fails only on >25% overfit drop).
  const runCounterProbe = counterProbes.length > 0
    ? async ({ winnerPrompt, counterProbes: probes, devScore }) => runCounterProbeGate({
        winnerPrompt,
        counterProbes: probes,
        devScore,
        runSonnet: makeOodReplayRunner({ evaluate: evaluateOod, target: 'sonnet' }),
        runGpt5_5: makeOodReplayRunner({ evaluate: evaluateOod, target: 'gpt5_5' }),
      })
    : undefined;

  return finalizeRun({
    runId,
    winner,
    heldoutProbes,
    scsProbes,
    oodProbes,
    counterProbes,
    vaultProbes,
    reasoningAdapters,
    runOod,
    runCounterProbe,
    heldoutFinalScore: winner.finalScore,
    paths: { trajectory: trajectoryPath(runId), gateDir: RESULTS_DIR(runId) },
  });
}

// ─── auto-invoke guard ─────────────────────────────────────────────────────
// `node core/prompt-optimization/sweep/gepa-cli.mjs ...` should behave the
// same as `node core/prompt-optimization/sweep/gepa.mjs ...` (which delegates
// here). Without this guard the file is imported and exited silently with
// no work done — the failure mode that ate ~$2 of confused diagnosis during
// the Stage 1 smoke launch (defect D1, commit 218a840).
if (import.meta.url === `file://${process.argv[1]}`) {
  mainCli(process.argv.slice(2)).catch((e) => {
    console.error('gepa-cli: fatal —', e?.stack || e?.message || e);
    process.exit(1);
  });
}
