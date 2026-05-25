/**
 * Phase 7 — Pre-flight individual checks (§7.5).
 *
 * Each §7.5 checklist item is a SEPARATE exported function with injectable
 * seams (env / fetchFn / exec / fs) so it is unit-testable without real
 * network, process, or filesystem access. The orchestrator that sequences
 * them and the CLI entry point live in `p7-preflight.mjs`.
 *
 * `DEFAULT_DATA_DIR` (= core/prompt-optimization/data) is exported so the
 * orchestrator shares the same default as the file-existence checks.
 */

import fsActual from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTokenBucket } from './p7-token-bucket.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = path.resolve(__dirname, '../data');

/**
 * Verify all required API keys are present and ≥10 chars.
 * MIMO_API_KEY accepts TOGETHER_API_KEY as a fallback (for MiMo/Qwen hosting).
 */
export function checkApiKeys(env) {
  // OpenRouter single-key mode satisfies the OpenAI-compatible providers
  // (GPT-5.5, Kimi, MiniMax, MiMo, Qwen). Anthropic (Sonnet target), DeepSeek
  // and Gemini (embeddings — no OpenRouter endpoint) always need direct keys.
  const hasOR = !!(env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY.length >= 10);
  const alwaysDirect = ['ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY'];
  const orCovered = ['OPENAI_API_KEY', 'MOONSHOT_API_KEY', 'MINIMAX_API_KEY'];
  const required = hasOR ? alwaysDirect : [...alwaysDirect, ...orCovered];
  const missing = required.filter((k) => !env[k] || env[k].length < 10);
  const mimoOk =
    hasOR ||
    (env.MIMO_API_KEY && env.MIMO_API_KEY.length >= 10) ||
    (env.TOGETHER_API_KEY && env.TOGETHER_API_KEY.length >= 10);

  const msgs = [];
  if (missing.length > 0) msgs.push(`Missing/short API keys: ${missing.join(', ')}`);
  if (!mimoOk) msgs.push('MIMO_API_KEY (or TOGETHER_API_KEY fallback, or OPENROUTER_API_KEY) not set or too short');

  if (msgs.length > 0) return { ok: false, message: msgs.join('; ') };
  return { ok: true, message: hasOR ? 'All required keys present (OpenRouter single-key mode)' : 'All API keys present and ≥10 chars' };
}

/**
 * Smoke-test each judge lineage by running a short "say hi" call through the
 * injectable `runJudge`.  If `runJudge` is absent, skip with a warning.
 */
export async function smokeLineages({ runJudge } = {}) {
  if (typeof runJudge !== 'function') {
    return { ok: true, message: 'Lineage smoke skipped (runJudge not provided)' };
  }
  const lineages = [
    { lineage: 'deepseek', model: 'deepseek-v4-flash' },
    { lineage: 'google-api', model: 'gemini-3.1-flash-lite' },
  ];
  const failures = [];
  for (const { lineage, model } of lineages) {
    try {
      const r = await runJudge({
        lineage, model,
        systemPrompt: 'You are a test assistant.',
        userPrompt: 'Reply with the single word: OK',
        timeoutMs: 30_000,
      });
      if (r.isError || !r.text) failures.push(`${lineage}: ${r.error || 'empty response'}`);
    } catch (e) {
      failures.push(`${lineage}: ${e.message}`);
    }
  }
  if (failures.length > 0) return { ok: false, message: `Lineage smoke failures: ${failures.join('; ')}` };
  return { ok: true, message: 'All lineage smokes passed' };
}

/**
 * Check OpenAI API tier ≥ 2.
 * Attempts a minimal authenticated request; infers tier from response or RPM headers.
 * Returns ok:false + recommendation to pay $50 if tier < 2, unless allowTier1 is set.
 */
export async function checkOpenAITier({ fetchFn, env, allowTier1 = false } = {}) {
  // OpenRouter single-key mode: GPT-5.5 is served via OpenRouter's pooled
  // capacity, which has no per-account OpenAI usage-tier gate. The tier check
  // is therefore not applicable — skip it.
  if (env && env.OPENROUTER_API_KEY && !env.OPENAI_API_KEY) {
    return { ok: true, message: 'GPT-5.5 routed via OpenRouter; OpenAI per-account tier gate N/A' };
  }
  const apiKey = env && env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, message: 'OPENAI_API_KEY not set' };

  if (typeof fetchFn !== 'function') {
    return {
      ok: allowTier1,
      message: `Cannot verify OpenAI tier (no fetchFn).${!allowTier1 ? ' Use --allow-tier-1-gpt5 to bypass.' : ''}`,
    };
  }

  try {
    const resp = await fetchFn('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    // Infer tier from rate-limit headers if present
    const rpmLimit = parseInt(resp.headers.get?.('x-ratelimit-limit-requests') || '0', 10);
    let tier = 1;
    if (rpmLimit >= 5000) tier = 2;
    if (rpmLimit >= 10000) tier = 4;

    // Also accept explicit tier in body (future-proofing)
    if (resp.ok) {
      try {
        const body = await resp.json();
        if (typeof body.tier === 'number') tier = body.tier;
      } catch { /* ignore parse errors */ }
    }

    if (tier < 2 && !allowTier1) {
      return {
        ok: false,
        message:
          `OpenAI Tier ${tier} detected. Wall-time will be ~6× longer at Tier 1 (30K TPM ceiling). ` +
          `Pay $50 to upgrade to Tier 2 or pass --allow-tier-1-gpt5.`,
      };
    }
    return { ok: true, message: `OpenAI Tier ${tier}+ confirmed` };
  } catch (e) {
    const msg = `OpenAI tier check failed: ${e.message}.${!allowTier1 ? ' Use --allow-tier-1-gpt5 to bypass.' : ''}`;
    return { ok: allowTier1, message: msg };
  }
}

/**
 * Check Anthropic API tier ≥ 2.
 * Infers tier from the anthropic-ratelimit-requests-limit response header.
 *
 * NOTE: tier must be read from the Messages API. `GET /v1/models` carries NO
 * `anthropic-ratelimit-*` headers, so probing it reads 0 and misreports Tier 1
 * for every account (verified 2026-05-26: a real Tier-2 key whose
 * /v1/messages response shows requests-limit=1000 got flagged Tier 1). We send
 * a minimal 1-token `POST /v1/messages` (≈$0.00001) to read the real limits;
 * the headers are returned even on a 429, so the inference is robust.
 */
export async function checkAnthropicTier({ fetchFn, env, allowTier1 = false } = {}) {
  const apiKey = env && env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: 'ANTHROPIC_API_KEY not set' };

  if (typeof fetchFn !== 'function') {
    return {
      ok: allowTier1,
      message: `Cannot verify Anthropic tier (no fetchFn).${!allowTier1 ? ' Use --allow-tier-1 to bypass.' : ''}`,
    };
  }

  try {
    const resp = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    // Anthropic rate-limit headers: anthropic-ratelimit-requests-limit
    const rpmLimit = parseInt(
      resp.headers.get?.('anthropic-ratelimit-requests-limit') || '0', 10,
    );
    let tier = 1;
    if (rpmLimit >= 1000) tier = 2;
    if (rpmLimit >= 2000) tier = 3;
    if (rpmLimit >= 4000) tier = 4;

    if (tier < 2 && !allowTier1) {
      return {
        ok: false,
        message:
          `Anthropic Tier ${tier} detected. Tier 1 throughput is too constrained for a 20-round run. ` +
          `Spend $40 + 7 days to reach Tier 2.`,
      };
    }
    return { ok: true, message: `Anthropic Tier ${tier}+ confirmed` };
  } catch (e) {
    return {
      ok: allowTier1,
      message: `Anthropic tier check failed: ${e.message}`,
    };
  }
}

/**
 * Token-bucket self-test: feed 100 fake calls through a bucket with tight
 * TPM limits and verify that throttling actually fires (not just RPM-gated).
 */
export async function tokenBucketSelfTest() {
  let fakeNow = 0;
  let throttled = false;

  const bucket = createTokenBucket({
    rpm: 1_000,
    itpm: 1_000,  // very tight: 1000 tokens/min
    estIn: 200,   // 200 tokens/call → 5 calls/min max from TPM
    now: () => fakeNow,
    onThrottle: () => { throttled = true; },
  });
  bucket._setSleep(async (ms) => { fakeNow += ms; });

  for (let i = 0; i < 100; i++) {
    await bucket.acquire({ inTokens: 200 });
  }

  if (!throttled) {
    return {
      ok: false,
      message: 'Token-bucket self-test FAILED: TPM throttling did not trigger over 100 fake calls',
    };
  }
  return {
    ok: true,
    message: 'Token-bucket self-test passed: TPM throttling verified across 100 fake calls',
  };
}

/**
 * Smoke-test the Gemini Embedding 2 API.  Expects a 768-dim vector back.
 * `runGeminiEmbedding2` is injectable; skip if not provided.
 *
 * Contract (owned by eval/agent-read-workflows/embeddings.js):
 *   runGeminiEmbedding2({ texts: [...] }, timeoutMs?) → { vectors, isError, error?, ... }
 * where `vectors` is one row per input text. We embed a single probe text and
 * assert `vectors[0]` is the expected 768-dim row.
 */
export async function checkEmbeddingApi({ runGeminiEmbedding2 } = {}) {
  if (typeof runGeminiEmbedding2 !== 'function') {
    return { ok: true, message: 'Embedding API check skipped (no runGeminiEmbedding2 injected)' };
  }
  try {
    const result = await runGeminiEmbedding2({ texts: ['test'] });
    if (!result || result.isError) {
      return { ok: false, message: `Embedding API smoke failed: ${(result && result.error) || 'isError'}` };
    }
    const { vectors } = result;
    const dim = Array.isArray(vectors) && Array.isArray(vectors[0]) ? vectors[0].length : null;
    if (dim !== 768) {
      return {
        ok: false,
        message: `Embedding API returned wrong shape: expected vectors[0] of dim 768, got ${dim === null ? typeof vectors : dim}`,
      };
    }
    return { ok: true, message: 'Gemini Embedding 2 returned 768-dim vector' };
  } catch (e) {
    return { ok: false, message: `Embedding API smoke failed: ${e.message}` };
  }
}

/**
 * Verify ~/.gemini/settings.json has selectedType === 'gemini-api-key'.
 * If wrong, optionally auto-fix (backup then patch) when autoFix=true.
 */
export function checkGeminiAuth({ fs: fsArg = fsActual, home = os.homedir(), autoFix = false } = {}) {
  const settingsPath = path.join(home, '.gemini', 'settings.json');
  if (!fsArg.existsSync(settingsPath)) {
    return {
      ok: false,
      message: `~/.gemini/settings.json not found. Run \`gemini\` once to generate it, then set selectedType to "gemini-api-key".`,
    };
  }

  let settings;
  try {
    settings = JSON.parse(fsArg.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    return { ok: false, message: `Failed to parse ~/.gemini/settings.json: ${e.message}` };
  }

  if (settings.selectedType === 'gemini-api-key') {
    return { ok: true, message: 'Gemini auth is gemini-api-key ✓' };
  }

  const current = settings.selectedType || '(unset)';
  if (!autoFix) {
    return {
      ok: false,
      message:
        `~/.gemini/settings.json has selectedType="${current}" instead of "gemini-api-key". ` +
        `OAuth blocks GA models. Fix manually or re-run with --auto-fix-gemini-auth.`,
    };
  }

  // Auto-fix: backup + patch
  try {
    const backupPath = settingsPath + '.bak';
    fsArg.writeFileSync(backupPath, JSON.stringify(settings, null, 2), 'utf8');
    settings.selectedType = 'gemini-api-key';
    fsArg.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return {
      ok: true,
      message: `Auto-fixed: selectedType changed from "${current}" to "gemini-api-key". Backup at ${backupPath}.`,
    };
  } catch (e) {
    return { ok: false, message: `Auto-fix failed: ${e.message}` };
  }
}

/**
 * Check for orphan processes that would compete for resources.
 * Pass criterion: ≤5 matching processes.
 */
export async function checkOrphans({ exec } = {}) {
  if (typeof exec !== 'function') {
    return { ok: true, message: 'Orphan check skipped (no exec injected)' };
  }
  try {
    const r = await exec('pgrep -c -f "track-b|gepa|aqe-mcp|_ss-helpers"');
    const count = parseInt((r.stdout || '0').trim(), 10);
    if (count > 5) {
      return {
        ok: false,
        message:
          `${count} orphan processes detected (pgrep: track-b|gepa|aqe-mcp|_ss-helpers). ` +
          `Clean them up before starting a run (see memory/project_aqe_mcp_orphans.md).`,
      };
    }
    return { ok: true, message: `Orphan processes: ${count} (≤5, OK)` };
  } catch {
    // pgrep exits 1 when no matches — that's fine
    return { ok: true, message: 'No orphan processes detected' };
  }
}

/**
 * Check that there are ≥5 GB free under the results directory.
 */
export async function checkDiskSpace({ exec, dataDir = DEFAULT_DATA_DIR } = {}) {
  if (typeof exec !== 'function') {
    return { ok: true, message: 'Disk space check skipped (no exec injected)' };
  }
  try {
    const r = await exec(`df -k "${dataDir}"`);
    const lines = (r.stdout || '').split('\n').filter(Boolean);
    // df output: Filesystem 1K-blocks Used Available Use% Mountpoint
    const last = lines[lines.length - 1];
    const parts = last.split(/\s+/);
    const availableKB = parseInt(parts[3] || '0', 10);
    const availableGB = availableKB / 1_048_576;
    if (availableGB < 5) {
      return {
        ok: false,
        message: `Only ${availableGB.toFixed(1)} GB free under ${dataDir}. Need ≥5 GB.`,
      };
    }
    return { ok: true, message: `Disk space: ${availableGB.toFixed(1)} GB free` };
  } catch (e) {
    return { ok: false, message: `Disk space check failed: ${e.message}` };
  }
}

/**
 * Warn if the git working tree is too dirty (>2 modified files).
 * P7 produces some uncommitted run artifacts — 2 is normal headroom.
 */
export async function checkGitClean({ exec } = {}) {
  if (typeof exec !== 'function') {
    return { ok: true, message: 'Git-clean check skipped (no exec injected)' };
  }
  try {
    const r = await exec('git status --short');
    const lines = (r.stdout || '').split('\n').filter((l) => l.trim().length > 0);
    if (lines.length > 2) {
      return {
        ok: false,
        message: `Git tree has ${lines.length} modified files (>2). Commit or stash before running.`,
      };
    }
    return { ok: true, message: `Git tree: ${lines.length} modified file(s) (≤2, OK)` };
  } catch (e) {
    return { ok: false, message: `Git-clean check failed: ${e.message}` };
  }
}

/**
 * Verify that the pre-registration tag `prereg/p7-v1` exists and points to HEAD.
 */
export async function checkPreregTag({ exec, allowNoPrereg = false } = {}) {
  if (typeof exec !== 'function') {
    return { ok: true, message: 'Prereg tag check skipped (no exec injected)' };
  }
  try {
    const tagR = await exec('git rev-list -n 1 prereg/p7-v1 2>/dev/null');
    const headR = await exec('git rev-parse HEAD');
    const tagHash = (tagR.stdout || '').trim();
    const headHash = (headR.stdout || '').trim();
    if (!tagHash) {
      if (allowNoPrereg) return { ok: true, message: 'Prereg tag missing — bypassed via --allow-no-prereg' };
      return {
        ok: false,
        message: 'Pre-registration tag prereg/p7-v1 not found. Tag HEAD before running or pass --allow-no-prereg.',
      };
    }
    if (tagHash !== headHash) {
      if (allowNoPrereg) return { ok: true, message: `Prereg tag at ${tagHash.slice(0,7)} ≠ HEAD — bypassed` };
      return {
        ok: false,
        message: `prereg/p7-v1 (${tagHash.slice(0,7)}) does not point to HEAD (${headHash.slice(0,7)}). Pass --allow-no-prereg to bypass.`,
      };
    }
    return { ok: true, message: `prereg/p7-v1 → HEAD (${headHash.slice(0,7)})` };
  } catch (e) {
    return {
      ok: allowNoPrereg,
      message: `Prereg tag check failed: ${e.message}${!allowNoPrereg ? '. Use --allow-no-prereg.' : ''}`,
    };
  }
}

/**
 * Verify the required probe set files exist.
 *
 * These are the full prereg manifest (§ PHASE7.md:866): dev/held-out/vault plus
 * the language-transfer (OOD §3.5.1), rotation-pool (§5.3 mid-run rotation), and
 * adversarial-counter (§5.7) sets. They are authored separately — failing here
 * means "not yet authored". Without the OOD/rotation/counter files a run could
 * pass pre-flight, then crash or silently skip the §3.5.1 OOD gate.
 */
export function checkProbeSets({ fs: fsArg = fsActual, dataDir = DEFAULT_DATA_DIR } = {}) {
  const required = [
    { name: 'p7-dev-probes.json',                       abs: path.join(dataDir, 'p7-dev-probes.json') },
    { name: 'frozen/p7-heldout-probes.json',            abs: path.join(dataDir, 'frozen', 'p7-heldout-probes.json') },
    { name: 'frozen/p7-vault-probes.json',              abs: path.join(dataDir, 'frozen', 'p7-vault-probes.json') },
    { name: 'frozen/p7-langtransfer-probes.json',       abs: path.join(dataDir, 'frozen', 'p7-langtransfer-probes.json') },
    { name: 'p7-rotation-pool.json',                    abs: path.join(dataDir, 'p7-rotation-pool.json') },
    { name: 'frozen/p7-adversarial-counter-probes.json', abs: path.join(dataDir, 'frozen', 'p7-adversarial-counter-probes.json') },
  ];
  const missing = required.filter((f) => !fsArg.existsSync(f.abs)).map((f) => f.name);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Probe sets not yet authored — run gated. Missing: ${missing.join(', ')}. Author probes first (see §7.2).`,
    };
  }
  return { ok: true, message: 'All probe sets present' };
}

/**
 * Verify T1.md … T15.md exist in p7-variants/ with valid YAML front-matter.
 * Valid front-matter = an opening `---` line plus a closing `---` delimiter.
 */
export function checkVariantSlate({ fs: fsArg = fsActual, dataDir = DEFAULT_DATA_DIR } = {}) {
  const variantsDir = path.join(dataDir, 'p7-variants');
  const expected = Array.from({ length: 15 }, (_, i) => `T${i + 1}.md`);
  const missing = [];
  const invalidFrontmatter = [];

  for (const name of expected) {
    const abs = path.join(variantsDir, name);
    if (!fsArg.existsSync(abs)) {
      missing.push(name);
      continue;
    }
    try {
      const content = fsArg.readFileSync(abs, 'utf8');
      // Valid front-matter = an opening `---` line followed by a closing
      // `---` delimiter line (a complete YAML block), not merely a leading `---`.
      const lines = content.split('\n');
      const opens = lines[0].trim() === '---';
      const closes = opens && lines.slice(1).some((l) => l.trim() === '---');
      if (!opens || !closes) invalidFrontmatter.push(name);
    } catch (e) {
      invalidFrontmatter.push(`${name} (read error: ${e.message})`);
    }
  }

  const msgs = [];
  if (missing.length > 0) {
    msgs.push(`Variant slate not yet authored — run gated. Missing variants: ${missing.join(', ')}`);
  }
  if (invalidFrontmatter.length > 0) {
    msgs.push(`Invalid/missing YAML front-matter: ${invalidFrontmatter.join(', ')}`);
  }
  if (msgs.length > 0) return { ok: false, message: msgs.join('; ') };
  return { ok: true, message: `All 15 variant files present with valid front-matter` };
}

/**
 * Check that the decision log file exists (headers only is fine — empty body
 * means no decisions yet, which is normal at the start of a run).
 */
export function checkDecisionLog({ fs: fsArg = fsActual, dataDir = DEFAULT_DATA_DIR } = {}) {
  const p = path.join(dataDir, 'p7-decisions.md');
  if (!fsArg.existsSync(p)) {
    return {
      ok: false,
      message: 'p7-decisions.md not found. Create it with at least the header before running.',
    };
  }
  return { ok: true, message: 'p7-decisions.md exists' };
}
