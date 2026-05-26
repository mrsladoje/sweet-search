// T8-r1-reflective MANUAL experiment: T8 body + Gemini Deep Think's 3 anti-looping
// rules injected as a new section. Full screen+confirm pipeline via buildCandidate.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../../..');

// ── 1. Construct the candidate prompt: T8 body + Gemini's anti-looping rules ──
const T8_TEXT = readFileSync(resolve(REPO_ROOT, 'core/prompt-optimization/data/p7-variants/T8.md'), 'utf8');
const t8Match = T8_TEXT.match(/^\s*---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
const T8_BODY = t8Match ? t8Match[1] : T8_TEXT;

const ANTI_LOOPING_SECTION = `
## Language-Specific Disambiguation (Anti-Looping)
When the default routing produces tool loops on specific ecosystems, override with these structural moves. Each rule prefers a structural tool ([[ss-trace]] / [[ss-find]]) over linear reads, with a hard cap on follow-on calls.

### JS / TS (anti import-tracing bloat)
Do not manually trace imports or generic prop names file-by-file with [[ss-read]] / [[ss-search]]. If a symbol is imported, jump straight to its definition with [[ss-trace]] <symbol>, or [[ss-find]] with an export-anchored regex (e.g. \`\\bexport\\s+(?:default|const|function|class)\\s+<symbol>\\b\`). Stop once the primary component/function logic is found — do not chase barrel files or re-exports beyond one hop.

### C# / Java (anti interface ping-pong)
If [[ss-search]] returns an interface or abstract-class definition, do NOT search the generic method name to find implementations. Use [[ss-trace]] <InterfaceName> or [[ss-trace]] <MethodName> to structurally locate concrete implementations in one call. Avoid [[ss-grep]] for generic verbs (\`get*\`, \`handle*\`, \`process*\`) that flood with false positives.

### C / C++ (anti header-scan bloat)
On locating a header (\`.h\`/\`.hpp\`), do not [[ss-read]] it to find the implementation. Use [[ss-find]] with a scope-resolution regex (e.g. \`\\b<Class>::<Method>\\b\`) or [[ss-trace]] <Symbol> to jump directly to the \`.cpp\`. Read the header only to confirm signature shape after the implementation is found.

### Hard stopping condition
Across all three rules: if you have made 3+ tool calls on a single probe without progress, output a \`<state_summary>\` block and either change tool family OR conclude [[no-match]]. Do not continue the same approach.
`;

const NEW_PROMPT = T8_BODY.trimEnd() + '\n\n' + ANTI_LOOPING_SECTION.trim() + '\n';
const NEW_TOKEN_EST = Math.ceil(NEW_PROMPT.length / 4);
console.log(`[t8r1] prompt length: ${NEW_PROMPT.length} chars (~${NEW_TOKEN_EST} tokens)`);
console.log(`[t8r1] T8 was ${T8_BODY.length} chars (~${Math.ceil(T8_BODY.length/4)} tokens)`);
console.log(`[t8r1] added: ${ANTI_LOOPING_SECTION.length} chars (~${Math.ceil(ANTI_LOOPING_SECTION.length/4)} tokens)`);

// ── 2. Validator sanity check (informational only) ──
const { validateMutation } = await import(resolve(REPO_ROOT, 'core/prompt-optimization/sweep/token-validator.mjs'));
const v = validateMutation({ source: T8_BODY, mutated: NEW_PROMPT, op: 'manual-reflective' });
console.log(`[t8r1] validator: ok=${v.ok}; failures=${JSON.stringify(v.failures)}`);
console.log('[t8r1] (multiplicity-changed expected for manual edit — proceeding anyway)');

// Save prompt for posterity
const RUN_DIR = __dirname;
mkdirSync(`${RUN_DIR}/t8r1`, { recursive: true });
writeFileSync(`${RUN_DIR}/t8r1/prompt.md`, NEW_PROMPT);
writeFileSync(`${RUN_DIR}/t8r1/validator.json`, JSON.stringify(v, null, 2));

// ── 3. Wire up evaluator (same as gen-1) ──
process.chdir(REPO_ROOT);
const { makeRealEvaluateCandidate } = await import(resolve(REPO_ROOT, 'core/prompt-optimization/sweep/gepa-evaluate.mjs'));
const { buildCandidate } = await import(resolve(REPO_ROOT, 'core/prompt-optimization/sweep/gepa-scoring.mjs'));
const { assertNativeBaselineCoverage } = await import(resolve(REPO_ROOT, 'core/prompt-optimization/sweep/eas.mjs'));
const { createTokenBucket, RATE_LIMITS } = await import(resolve(REPO_ROOT, 'core/prompt-optimization/sweep/p7-token-bucket.mjs'));

const probesDoc = JSON.parse(readFileSync(resolve(REPO_ROOT, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const devProbes = probesDoc.probes ?? probesDoc;
console.log(`[t8r1] loaded ${devProbes.length} probes`);

const nativeBl = JSON.parse(readFileSync(resolve(REPO_ROOT, 'core/prompt-optimization/data/p7-native-baseline-dev-3panel.json'), 'utf8'));
const nativeBaselineByTarget = assertNativeBaselineCoverage({ baselineByTarget: nativeBl, probes: devProbes });
console.log('[t8r1] native baseline coverage OK');

const evaluateCandidate = makeRealEvaluateCandidate({ agentProvider: 'api' });
const bucket = {
  sonnet: createTokenBucket({ ...RATE_LIMITS.anthropic_sonnet_4_6[2], onThrottle: () => {} }),
  gpt5_5: createTokenBucket({ rpm: RATE_LIMITS.openai_gpt5_5[2].rpm, itpm: RATE_LIMITS.openai_gpt5_5[2].tpm, onThrottle: () => {} }),
};

// ── 4. Run the full screen + confirm via buildCandidate (40 probes × 2 targets) ──
console.log(`[t8r1] STARTING evaluation: 40 probes × 2 targets = 80 agent runs at concurrency=6`);
console.log(`[t8r1] start time: ${new Date().toISOString()}`);
const startMs = Date.now();

let completed = 0;
const totalUnits = devProbes.length * 2;
const wrappedEvaluate = async (args) => {
  const result = await evaluateCandidate(args);
  completed += 1;
  if (completed % 10 === 0 || completed === totalUnits) {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    console.log(`[t8r1] progress: ${completed}/${totalUnits} after ${elapsed}s`);
  }
  return result;
};

try {
  const cand = await buildCandidate({
    id: 'T8-r1-reflective-manual',
    prompt: NEW_PROMPT,
    sourceOp: 'manual-reflective',
    parentHash: '0xb3c6ec8dbb69defa', // T8's hash
    probes: devProbes,
    weights: devProbes.map(() => 1.0),
    evaluateCandidate: wrappedEvaluate,
    bucket,
    nativeBaselineByTarget,
    concurrency: 6,
  });

  const wallSec = ((Date.now() - startMs) / 1000).toFixed(0);
  const T2R1_FINAL = 0.398;
  const T2R1_TASK = 0.99375;
  const T8_BASELINE_FINAL = 'unknown';

  const report = {
    id: cand.id,
    hash: cand.hash,
    parentHash: cand.parentHash,
    score_sonnet: cand.score_sonnet,
    score_gpt5_5: cand.score_gpt5_5,
    taskScore: cand.taskScore,
    efficiencyFactor: cand.efficiencyFactor,
    lengthPenalty: cand.lengthPenalty,
    finalScore: cand.finalScore,
    nativeRelative: cand.nativeRelative,
    tokenCount: cand.tokenCount,
    sharpnessScore: cand.sharpnessScore,
    comparison: {
      vs_T2_r1_reflective: {
        finalScore_delta: (cand.finalScore - T2R1_FINAL).toFixed(4),
        finalScore_pct: `${((cand.finalScore / T2R1_FINAL - 1) * 100).toFixed(1)}%`,
        taskScore_delta: (cand.taskScore - T2R1_TASK).toFixed(4),
        winner: cand.finalScore > T2R1_FINAL ? 'T8-r1-reflective-manual' : 'T2-r1-reflective',
      },
      gemini_prediction: 'finalScore > 0.60 likely',
      gemini_prediction_met: cand.finalScore > 0.60,
    },
    wall_seconds: parseInt(wallSec),
    completed_at: new Date().toISOString(),
  };

  writeFileSync(`${RUN_DIR}/t8r1/result.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${RUN_DIR}/t8r1/candidate.json`, JSON.stringify({
    id: cand.id, hash: cand.hash, prompt: cand.prompt, tokenCount: cand.tokenCount,
    scores: cand.scores, detail: cand.detail,
    score_sonnet: cand.score_sonnet, score_gpt5_5: cand.score_gpt5_5,
    taskScore: cand.taskScore, efficiencyFactor: cand.efficiencyFactor,
    lengthPenalty: cand.lengthPenalty, finalScore: cand.finalScore,
    nativeRelative: cand.nativeRelative,
  }, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('  T8-r1-reflective-manual — RESULT');
  console.log('='.repeat(60));
  console.log(JSON.stringify(report, null, 2));
  console.log('\nSaved: ' + `${RUN_DIR}/t8r1/result.json`);
} catch (err) {
  console.error(`[t8r1] FAILED: ${err.message}`);
  console.error(err.stack);
  writeFileSync(`${RUN_DIR}/t8r1/error.json`, JSON.stringify({ message: err.message, stack: err.stack, completed_at: new Date().toISOString() }, null, 2));
  process.exit(1);
}
