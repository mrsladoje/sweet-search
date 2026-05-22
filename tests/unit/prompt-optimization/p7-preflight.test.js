/**
 * Unit tests for the runPreflight orchestrator + facade
 * (core/prompt-optimization/sweep/p7-preflight.mjs).
 *
 * The 14 individual §7.5 checks are tested in p7-preflight-checks.test.js.
 * Here we cover: the orchestrator wiring (all-green aggregate, snapshot shape,
 * "not yet authored — run gated" gating, --allow-tier-1-gpt5 plumbing) and
 * that the preflight facade re-exports every check fn.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';

import {
  runPreflight,
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
} from '../../../core/prompt-optimization/sweep/p7-preflight.mjs';

// ─── test doubles ──────────────────────────────────────────────────────────────

const FULL_KEYS = {
  ANTHROPIC_API_KEY: 'sk-ant-0123456789',
  OPENAI_API_KEY: 'sk-openai-0123456789',
  DEEPSEEK_API_KEY: 'sk-deepseek-0123456789',
  GEMINI_API_KEY: 'gem-0123456789',
  MOONSHOT_API_KEY: 'sk-moon-0123456789',
  MINIMAX_API_KEY: 'sk-mini-0123456789',
  MIMO_API_KEY: 'sk-mimo-0123456789',
};

function mockFs(initial = {}) {
  const files = { ...initial };
  const written = {};
  const all = () => ({ ...files, ...written });
  return {
    existsSync: (p) => p in files || p in written,
    readFileSync: (p) => {
      const f = all();
      if (p in f) return f[p];
      throw new Error(`ENOENT: ${p}`);
    },
    writeFileSync: (p, content) => { written[p] = content; },
    _written: written,
  };
}

function makeExec(routes) {
  return async (cmd) => {
    for (const [pattern, resp] of routes) {
      if (cmd.includes(pattern)) {
        if (resp instanceof Error) throw resp;
        return typeof resp === 'function' ? resp(cmd) : resp;
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

function mockFetch({ headers = {}, ok = true, body = {} } = {}) {
  return async () => ({
    ok,
    headers: { get: (k) => (k in headers ? headers[k] : null) },
    json: async () => body,
  });
}

// ─── facade re-exports ───────────────────────────────────────────────────────────

describe('p7-preflight facade', () => {
  it('re-exports every §7.5 check fn', () => {
    for (const fn of [
      checkApiKeys, smokeLineages, checkOpenAITier, checkAnthropicTier,
      tokenBucketSelfTest, checkEmbeddingApi, checkGeminiAuth, checkOrphans,
      checkDiskSpace, checkGitClean, checkPreregTag, checkProbeSets,
      checkVariantSlate, checkDecisionLog,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });
});

// ─── runPreflight orchestrator ──────────────────────────────────────────────────

describe('runPreflight', () => {
  const home = '/fake/home';
  const dataDir = '/fake/data';

  function greenFs() {
    const files = {
      [path.join(home, '.gemini', 'settings.json')]: JSON.stringify({ selectedType: 'gemini-api-key' }),
      // Full prereg manifest (PHASE7.md:866) — all six probe-set files.
      [path.join(dataDir, 'p7-dev-probes.json')]: '[]',
      [path.join(dataDir, 'frozen', 'p7-heldout-probes.json')]: '[]',
      [path.join(dataDir, 'frozen', 'p7-vault-probes.json')]: '[]',
      [path.join(dataDir, 'frozen', 'p7-langtransfer-probes.json')]: '[]',
      [path.join(dataDir, 'p7-rotation-pool.json')]: '[]',
      [path.join(dataDir, 'frozen', 'p7-adversarial-counter-probes.json')]: '[]',
      [path.join(dataDir, 'p7-decisions.md')]: '# Decisions',
    };
    for (let i = 1; i <= 15; i++) {
      files[path.join(dataDir, 'p7-variants', `T${i}.md`)] = '---\nid: T\n---\nbody';
    }
    return mockFs(files);
  }

  const greenExec = makeExec([
    ['pgrep', { stdout: '1\n' }],
    ['df', { stdout: 'H 1 1 ' + (10 * 1_048_576) + ' 1% /\n' }],
    ['git status', { stdout: '' }],
    ['rev-list', { stdout: 'abc1234\n' }],
    ['rev-parse', { stdout: 'abc1234\n' }],
  ]);

  const greenFetch = mockFetch({
    headers: {
      'x-ratelimit-limit-requests': '5000',
      'anthropic-ratelimit-requests-limit': '1000',
    },
  });

  const greenSmoke = {
    runJudge: async () => ({ isError: false, text: 'OK' }),
    runGeminiEmbedding2: async () => ({ vectors: [new Array(768).fill(0)], isError: false }),
  };

  it('returns a fully-passing aggregate when everything is wired green', async () => {
    const result = await runPreflight({
      run: 'p7-v1',
      env: FULL_KEYS,
      smoke: greenSmoke,
      fetchFn: greenFetch,
      exec: greenExec,
      fs: greenFs(),
      home,
      dataDir,
    });
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(14);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it('snapshot carries run id, timestamp, and per-check results', async () => {
    const result = await runPreflight({
      run: 'p7-test', env: FULL_KEYS, smoke: greenSmoke,
      fetchFn: greenFetch, exec: greenExec, fs: greenFs(), home, dataDir,
    });
    expect(result.snapshot.run).toBe('p7-test');
    expect(typeof result.snapshot.timestamp).toBe('string');
    expect(result.snapshot.checks).toHaveLength(14);
  });

  it('gates the run with "not yet authored" when probes + variants are absent', async () => {
    const result = await runPreflight({
      run: 'p7-v1',
      env: FULL_KEYS,
      smoke: greenSmoke,
      fetchFn: greenFetch,
      exec: greenExec,
      // gemini settings + decision log present, but no probes/variants
      fs: mockFs({
        [path.join(home, '.gemini', 'settings.json')]: JSON.stringify({ selectedType: 'gemini-api-key' }),
        [path.join(dataDir, 'p7-decisions.md')]: '# Decisions',
      }),
      home,
      dataDir,
    });
    expect(result.ok).toBe(false);
    const probeCheck = result.checks.find((c) => c.name === 'probe-sets');
    const variantCheck = result.checks.find((c) => c.name === 'variant-slate');
    expect(probeCheck.ok).toBe(false);
    expect(probeCheck.message).toContain('not yet authored');
    expect(variantCheck.ok).toBe(false);
    expect(variantCheck.message).toContain('not yet authored');
  });

  it('honours --allow-tier-1-gpt5 by passing it to the OpenAI tier check', async () => {
    const tier1Fetch = mockFetch({
      headers: {
        'x-ratelimit-limit-requests': '500',          // OpenAI Tier 1
        'anthropic-ratelimit-requests-limit': '1000', // Anthropic Tier 2
      },
    });
    const gated = await runPreflight({
      env: FULL_KEYS, smoke: greenSmoke, fetchFn: tier1Fetch,
      exec: greenExec, fs: greenFs(), home, dataDir, allowTier1Gpt5: false,
    });
    expect(gated.checks.find((c) => c.name === 'openai-tier').ok).toBe(false);

    const bypassed = await runPreflight({
      env: FULL_KEYS, smoke: greenSmoke, fetchFn: tier1Fetch,
      exec: greenExec, fs: greenFs(), home, dataDir, allowTier1Gpt5: true,
    });
    expect(bypassed.checks.find((c) => c.name === 'openai-tier').ok).toBe(true);
  });

  // m13 regression: the Anthropic Tier-1 escape hatch must be plumbed from
  // runPreflight → checkAnthropicTier so a transient Anthropic outage / Tier-1
  // result can be bypassed by the operator (mirrors --allow-tier-1-gpt5).
  it('honours --allow-tier-1 (Anthropic) by passing it to the Anthropic tier check', async () => {
    const tier1Fetch = mockFetch({
      headers: {
        'x-ratelimit-limit-requests': '5000',       // OpenAI Tier 2
        'anthropic-ratelimit-requests-limit': '50',  // Anthropic Tier 1
      },
    });
    const gated = await runPreflight({
      env: FULL_KEYS, smoke: greenSmoke, fetchFn: tier1Fetch,
      exec: greenExec, fs: greenFs(), home, dataDir, allowTier1: false,
    });
    expect(gated.checks.find((c) => c.name === 'anthropic-tier').ok).toBe(false);

    const bypassed = await runPreflight({
      env: FULL_KEYS, smoke: greenSmoke, fetchFn: tier1Fetch,
      exec: greenExec, fs: greenFs(), home, dataDir, allowTier1: true,
    });
    expect(bypassed.checks.find((c) => c.name === 'anthropic-tier').ok).toBe(true);
  });
});
