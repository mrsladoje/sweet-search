/**
 * Phase 7 — Pre-flight checklist orchestrator + CLI (§7.5).
 *
 * `runPreflight` sequences every §7.5 check (each defined in
 * `p7-preflight-checks.mjs`) with injectable seams so the whole checklist is
 * unit-testable without real network / process / filesystem access. The CLI
 * entry point (`node p7-preflight.mjs --run p7-v1`) prints a table, persists a
 * snapshot (§9: results/<run>/preflight-snapshot.json), and exits 0 only when
 * all checks pass.
 *
 * Injectable params to runPreflight:
 *   env         — environment variables (default process.env)
 *   smoke       — object of injected smoke callables ({ runJudge,
 *                 runGeminiEmbedding2 }) or null to skip the network smokes
 *   fetchFn     — fetch-compatible fn for HTTP tier checks
 *   exec        — async fn(cmd) → { stdout, stderr, exitCode }
 *   fs          — object with { existsSync, readFileSync, writeFileSync }
 *   home        — home directory path (default os.homedir())
 *   dataDir     — path to core/prompt-optimization/data/ (default computed)
 *   allowTier1Gpt5  — suppress OpenAI Tier-1 hard-block
 *   allowNoPrereg   — suppress missing-tag hard-block
 */

import fsActual from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RESULTS_DIR, atomicWriteJSON } from './p7-persist.mjs';
import {
  DEFAULT_DATA_DIR,
  checkApiKeys,
  smokeLineages,
  checkOpenAITier,
  checkAnthropicTier,
  tokenBucketSelfTest,
  checkEmbeddingApi,
  checkGeminiAuth,
  checkOrphans,
  checkDiskSpace,
  checkGitClean,
  checkPreregTag,
  checkProbeSets,
  checkVariantSlate,
  checkDecisionLog,
} from './p7-preflight-checks.mjs';

// Re-export every individual check so call sites + tests can import them from
// the preflight facade (each is a SEPARATE exported fn per §7.5).
export {
  DEFAULT_DATA_DIR,
  checkApiKeys,
  smokeLineages,
  checkOpenAITier,
  checkAnthropicTier,
  tokenBucketSelfTest,
  checkEmbeddingApi,
  checkGeminiAuth,
  checkOrphans,
  checkDiskSpace,
  checkGitClean,
  checkPreregTag,
  checkProbeSets,
  checkVariantSlate,
  checkDecisionLog,
};

// ─── orchestrator ────────────────────────────────────────────────────────────

/**
 * Run all pre-flight checks, returning an aggregate result.
 *
 * @param {{
 *   run?: string,
 *   env?: object,
 *   smoke?: object,
 *   fetchFn?: Function,
 *   exec?: Function,
 *   fs?: object,
 *   home?: string,
 *   dataDir?: string,
 *   allowTier1Gpt5?: boolean,
 *   allowNoPrereg?: boolean,
 * }} opts
 * @returns {Promise<{ ok: boolean, checks: Array<{name:string,ok:boolean,message:string}>, snapshot: object }>}
 */
export async function runPreflight({
  run = 'p7-v1',
  env = process.env,
  smoke = null,
  fetchFn = globalThis.fetch,
  exec = null,
  fs: fsArg = fsActual,
  home = os.homedir(),
  dataDir = DEFAULT_DATA_DIR,
  allowTier1Gpt5 = false,
  allowNoPrereg = false,
} = {}) {
  const checks = [];

  const add = (name, result) => checks.push({ name, ok: result.ok, message: result.message });

  // 1. API keys
  add('api-keys', checkApiKeys(env));

  // 2. Lineage smoke (skipped if smoke.runJudge not provided)
  add('lineage-smoke', await smokeLineages(smoke || {}));

  // 3. OpenAI tier
  add('openai-tier', await checkOpenAITier({ fetchFn, env, allowTier1: allowTier1Gpt5 }));

  // 4. Anthropic tier
  add('anthropic-tier', await checkAnthropicTier({ fetchFn, env }));

  // 5. Token-bucket self-test
  add('token-bucket-self-test', await tokenBucketSelfTest());

  // 6. Embedding API smoke (injectable; skip if not provided in smoke object)
  add('embedding-api', await checkEmbeddingApi(smoke || {}));

  // 7. Gemini auth
  add('gemini-auth', checkGeminiAuth({ fs: fsArg, home }));

  // 8. Orphan processes
  add('orphan-processes', await checkOrphans({ exec }));

  // 9. Disk space
  add('disk-space', await checkDiskSpace({ exec, dataDir }));

  // 10. Git clean
  add('git-clean', await checkGitClean({ exec }));

  // 11. Pre-reg tag
  add('prereg-tag', await checkPreregTag({ exec, allowNoPrereg }));

  // 12. Probe sets (will fail until authored)
  add('probe-sets', checkProbeSets({ fs: fsArg, dataDir }));

  // 13. Variant slate (will fail until authored)
  add('variant-slate', checkVariantSlate({ fs: fsArg, dataDir }));

  // 14. Decision log
  add('decision-log', checkDecisionLog({ fs: fsArg, dataDir }));

  const ok = checks.every((c) => c.ok);
  const snapshot = { run, timestamp: new Date().toISOString(), checks };

  return { ok, checks, snapshot };
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const run = args.find((a, i) => args[i - 1] === '--run') || 'p7-v1';
  const allowTier1Gpt5 = args.includes('--allow-tier-1-gpt5');
  const allowNoPrereg = args.includes('--allow-no-prereg');

  const defaultExec = async (cmd) => {
    const { execSync } = await import('node:child_process');
    try {
      const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.status ?? 1 };
    }
  };

  const result = await runPreflight({
    run,
    allowTier1Gpt5,
    allowNoPrereg,
    exec: defaultExec,
  });

  const COL_W = 30;
  console.log('\nPhase 7 pre-flight checks\n');
  console.log(`${'Check'.padEnd(COL_W)} ${'Status'.padEnd(8)} Message`);
  console.log('-'.repeat(80));
  for (const c of result.checks) {
    const status = c.ok ? '  OK  ' : ' FAIL ';
    console.log(`${c.name.padEnd(COL_W)} [${status}] ${c.message}`);
  }
  console.log('-'.repeat(80));
  const passed = result.checks.filter((c) => c.ok).length;
  console.log(`\n${passed}/${result.checks.length} checks passed\n`);

  // Persist the snapshot (§9: results/<run>/preflight-snapshot.json) for
  // forensics — written on both pass and fail.
  try {
    const snapshotPath = path.join(RESULTS_DIR(run), 'preflight-snapshot.json');
    atomicWriteJSON(snapshotPath, result.snapshot);
    console.log(`Snapshot written to ${snapshotPath}\n`);
  } catch (e) {
    console.error(`Warning: failed to write preflight snapshot: ${e.message}`);
  }

  if (!result.ok) {
    console.error('Pre-flight FAILED — fix the above errors before starting the run.');
    process.exit(1);
  }
  console.log('Pre-flight PASSED — ready to run.');
  process.exit(0);
}
