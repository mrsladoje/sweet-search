/**
 * Unit tests for the individual §7.5 pre-flight checks
 * (core/prompt-optimization/sweep/p7-preflight-checks.mjs).
 *
 * Every check is exercised through its injectable seams (no real network /
 * process / filesystem access): pass, fail, skip-when-not-injected, and the
 * tier gating + "not yet authored — run gated" messaging for probes/variants.
 * The runPreflight orchestrator + CLI facade are tested in p7-preflight.test.js.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';

import {
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
} from '../../../core/prompt-optimization/sweep/p7-preflight-checks.mjs';

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

/** In-memory fs double honouring { existsSync, readFileSync, writeFileSync }. */
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

/** Route exec(cmd) → response by substring; Error values are thrown. */
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

/** fetch double returning fixed headers/body. */
function mockFetch({ headers = {}, ok = true, body = {} } = {}) {
  return async () => ({
    ok,
    headers: { get: (k) => (k in headers ? headers[k] : null) },
    json: async () => body,
  });
}

// ─── checkApiKeys ───────────────────────────────────────────────────────────────

describe('checkApiKeys', () => {
  it('passes when all keys present and ≥10 chars', () => {
    expect(checkApiKeys(FULL_KEYS).ok).toBe(true);
  });

  it('fails when a required key is missing', () => {
    const { ANTHROPIC_API_KEY, ...rest } = FULL_KEYS;
    const r = checkApiKeys(rest);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('ANTHROPIC_API_KEY');
  });

  it('fails when a key is too short', () => {
    const r = checkApiKeys({ ...FULL_KEYS, OPENAI_API_KEY: 'short' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('OPENAI_API_KEY');
  });

  it('accepts TOGETHER_API_KEY as the MiMo fallback', () => {
    const { MIMO_API_KEY, ...rest } = FULL_KEYS;
    expect(checkApiKeys({ ...rest, TOGETHER_API_KEY: 'tog-0123456789' }).ok).toBe(true);
  });

  it('fails when neither MIMO nor TOGETHER is set', () => {
    const { MIMO_API_KEY, ...rest } = FULL_KEYS;
    const r = checkApiKeys(rest);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('MIMO_API_KEY');
  });
});

// ─── smokeLineages ──────────────────────────────────────────────────────────────

describe('smokeLineages', () => {
  it('skips (ok) when runJudge is not provided', async () => {
    const r = await smokeLineages({});
    expect(r.ok).toBe(true);
    expect(r.message).toContain('skipped');
  });

  it('passes when every lineage returns non-empty text', async () => {
    const runJudge = async () => ({ isError: false, text: 'OK' });
    expect((await smokeLineages({ runJudge })).ok).toBe(true);
  });

  it('fails when a lineage returns an error', async () => {
    const runJudge = async ({ lineage }) =>
      lineage === 'deepseek' ? { isError: true, error: 'boom' } : { isError: false, text: 'OK' };
    const r = await smokeLineages({ runJudge });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('deepseek');
  });

  it('fails when runJudge throws', async () => {
    const runJudge = async () => { throw new Error('network down'); };
    const r = await smokeLineages({ runJudge });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('network down');
  });
});

// ─── checkOpenAITier ────────────────────────────────────────────────────────────

describe('checkOpenAITier', () => {
  it('fails when OPENAI_API_KEY is unset', async () => {
    expect((await checkOpenAITier({ env: {} })).ok).toBe(false);
  });

  it('passes Tier 2 (rpm header ≥ 5000)', async () => {
    const fetchFn = mockFetch({ headers: { 'x-ratelimit-limit-requests': '5000' } });
    const r = await checkOpenAITier({ fetchFn, env: FULL_KEYS });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Tier 2');
  });

  it('fails Tier 1 without the bypass flag', async () => {
    const fetchFn = mockFetch({ headers: { 'x-ratelimit-limit-requests': '500' } });
    const r = await checkOpenAITier({ fetchFn, env: FULL_KEYS, allowTier1: false });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('--allow-tier-1-gpt5');
  });

  it('passes Tier 1 when allowTier1 is set', async () => {
    const fetchFn = mockFetch({ headers: { 'x-ratelimit-limit-requests': '500' } });
    expect((await checkOpenAITier({ fetchFn, env: FULL_KEYS, allowTier1: true })).ok).toBe(true);
  });

  it('cannot verify without fetchFn → gated unless bypassed', async () => {
    expect((await checkOpenAITier({ env: FULL_KEYS, allowTier1: false })).ok).toBe(false);
    expect((await checkOpenAITier({ env: FULL_KEYS, allowTier1: true })).ok).toBe(true);
  });
});

// ─── checkAnthropicTier ─────────────────────────────────────────────────────────

describe('checkAnthropicTier', () => {
  it('fails when ANTHROPIC_API_KEY is unset', async () => {
    expect((await checkAnthropicTier({ env: {} })).ok).toBe(false);
  });

  it('passes Tier 2 (rpm header ≥ 1000)', async () => {
    const fetchFn = mockFetch({ headers: { 'anthropic-ratelimit-requests-limit': '1000' } });
    const r = await checkAnthropicTier({ fetchFn, env: FULL_KEYS });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Tier 2');
  });

  it('fails Tier 1 without bypass', async () => {
    const fetchFn = mockFetch({ headers: { 'anthropic-ratelimit-requests-limit': '50' } });
    const r = await checkAnthropicTier({ fetchFn, env: FULL_KEYS, allowTier1: false });
    expect(r.ok).toBe(false);
  });
});

// ─── tokenBucketSelfTest ────────────────────────────────────────────────────────

describe('tokenBucketSelfTest', () => {
  it('verifies TPM throttling fires across 100 fake calls', async () => {
    const r = await tokenBucketSelfTest();
    expect(r.ok).toBe(true);
    expect(r.message).toContain('throttling');
  });
});

// ─── checkEmbeddingApi ──────────────────────────────────────────────────────────

describe('checkEmbeddingApi', () => {
  // Contract: runGeminiEmbedding2({ texts: [...] }) → { vectors, isError, ... }
  const embedder = (impl) => {
    const calls = [];
    const fn = async (arg) => { calls.push(arg); return impl(arg); };
    fn.calls = calls;
    return fn;
  };

  it('skips (ok) when runGeminiEmbedding2 not injected', async () => {
    expect((await checkEmbeddingApi({})).ok).toBe(true);
  });

  it('calls with { texts: [...] } and passes on a 768-dim vectors[0]', async () => {
    const runGeminiEmbedding2 = embedder(() => ({ vectors: [new Array(768).fill(0.1)], isError: false }));
    expect((await checkEmbeddingApi({ runGeminiEmbedding2 })).ok).toBe(true);
    // Locks the pinned signature: object with a texts array, not a bare string.
    expect(runGeminiEmbedding2.calls[0]).toEqual({ texts: ['test'] });
  });

  it('fails on a wrong-dim vectors[0]', async () => {
    const runGeminiEmbedding2 = embedder(() => ({ vectors: [new Array(512).fill(0.1)], isError: false }));
    const r = await checkEmbeddingApi({ runGeminiEmbedding2 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('768');
  });

  it('fails when the result reports isError', async () => {
    const runGeminiEmbedding2 = embedder(() => ({ vectors: null, isError: true, error: 'quota exceeded' }));
    const r = await checkEmbeddingApi({ runGeminiEmbedding2 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('quota exceeded');
  });

  it('fails when the embedding call throws', async () => {
    const runGeminiEmbedding2 = async () => { throw new Error('network'); };
    expect((await checkEmbeddingApi({ runGeminiEmbedding2 })).ok).toBe(false);
  });
});

// ─── checkGeminiAuth ────────────────────────────────────────────────────────────

describe('checkGeminiAuth', () => {
  const home = '/fake/home';
  const settingsPath = path.join(home, '.gemini', 'settings.json');

  it('fails when settings.json is missing', () => {
    const r = checkGeminiAuth({ fs: mockFs({}), home });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not found');
  });

  it('passes when selectedType is gemini-api-key', () => {
    const fs = mockFs({ [settingsPath]: JSON.stringify({ selectedType: 'gemini-api-key' }) });
    expect(checkGeminiAuth({ fs, home }).ok).toBe(true);
  });

  it('fails when selectedType is wrong and autoFix is off', () => {
    const fs = mockFs({ [settingsPath]: JSON.stringify({ selectedType: 'oauth-personal' }) });
    const r = checkGeminiAuth({ fs, home, autoFix: false });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('oauth-personal');
  });

  it('auto-fixes (with backup) when autoFix is on', () => {
    const fs = mockFs({ [settingsPath]: JSON.stringify({ selectedType: 'oauth-personal' }) });
    const r = checkGeminiAuth({ fs, home, autoFix: true });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Auto-fixed');
    expect(fs._written[settingsPath + '.bak']).toBeDefined();
    expect(JSON.parse(fs._written[settingsPath]).selectedType).toBe('gemini-api-key');
  });

  it('fails on corrupt JSON', () => {
    const fs = mockFs({ [settingsPath]: '{not json' });
    expect(checkGeminiAuth({ fs, home }).ok).toBe(false);
  });
});

// ─── checkOrphans ───────────────────────────────────────────────────────────────

describe('checkOrphans', () => {
  it('skips (ok) without exec', async () => {
    expect((await checkOrphans({})).ok).toBe(true);
  });

  it('passes at ≤5 processes', async () => {
    const exec = makeExec([['pgrep', { stdout: '3\n' }]]);
    expect((await checkOrphans({ exec })).ok).toBe(true);
  });

  it('fails above 5 processes', async () => {
    const exec = makeExec([['pgrep', { stdout: '9\n' }]]);
    const r = await checkOrphans({ exec });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('9 orphan');
  });

  it('treats a pgrep no-match (throw) as ok', async () => {
    const exec = makeExec([['pgrep', new Error('exit 1')]]);
    expect((await checkOrphans({ exec })).ok).toBe(true);
  });
});

// ─── checkDiskSpace ─────────────────────────────────────────────────────────────

describe('checkDiskSpace', () => {
  const df = (availKB) =>
    `Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk1 999999999 1 ${availKB} 1% /`;

  it('skips (ok) without exec', async () => {
    expect((await checkDiskSpace({})).ok).toBe(true);
  });

  it('passes with ≥5 GB free', async () => {
    const exec = makeExec([['df', { stdout: df(10 * 1_048_576) }]]);
    expect((await checkDiskSpace({ exec })).ok).toBe(true);
  });

  it('fails with <5 GB free', async () => {
    const exec = makeExec([['df', { stdout: df(1 * 1_048_576) }]]);
    const r = await checkDiskSpace({ exec });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Need ≥5');
  });
});

// ─── checkGitClean ──────────────────────────────────────────────────────────────

describe('checkGitClean', () => {
  it('skips (ok) without exec', async () => {
    expect((await checkGitClean({})).ok).toBe(true);
  });

  it('passes with ≤2 modified files', async () => {
    const exec = makeExec([['git status', { stdout: ' M a.js\n M b.js\n' }]]);
    expect((await checkGitClean({ exec })).ok).toBe(true);
  });

  it('fails with >2 modified files', async () => {
    const exec = makeExec([['git status', { stdout: ' M a\n M b\n M c\n M d\n' }]]);
    expect((await checkGitClean({ exec })).ok).toBe(false);
  });
});

// ─── checkPreregTag ─────────────────────────────────────────────────────────────

describe('checkPreregTag', () => {
  it('skips (ok) without exec', async () => {
    expect((await checkPreregTag({})).ok).toBe(true);
  });

  it('passes when prereg/p7-v1 points at HEAD', async () => {
    const exec = makeExec([
      ['rev-list', { stdout: 'abc1234\n' }],
      ['rev-parse', { stdout: 'abc1234\n' }],
    ]);
    expect((await checkPreregTag({ exec })).ok).toBe(true);
  });

  it('fails when the tag is missing (no bypass)', async () => {
    const exec = makeExec([
      ['rev-list', { stdout: '\n' }],
      ['rev-parse', { stdout: 'abc1234\n' }],
    ]);
    const r = await checkPreregTag({ exec, allowNoPrereg: false });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('--allow-no-prereg');
  });

  it('bypasses a missing tag with --allow-no-prereg', async () => {
    const exec = makeExec([
      ['rev-list', { stdout: '\n' }],
      ['rev-parse', { stdout: 'abc1234\n' }],
    ]);
    expect((await checkPreregTag({ exec, allowNoPrereg: true })).ok).toBe(true);
  });

  it('fails when the tag does not point at HEAD', async () => {
    const exec = makeExec([
      ['rev-list', { stdout: 'aaaaaaa\n' }],
      ['rev-parse', { stdout: 'bbbbbbb\n' }],
    ]);
    expect((await checkPreregTag({ exec, allowNoPrereg: false })).ok).toBe(false);
  });
});

// ─── checkProbeSets ─────────────────────────────────────────────────────────────

describe('checkProbeSets', () => {
  const dataDir = '/fake/data';

  // The three originally-checked files (dev / held-out / vault).
  const ORIGINAL_THREE = {
    [path.join(dataDir, 'p7-dev-probes.json')]: '[]',
    [path.join(dataDir, 'frozen', 'p7-heldout-probes.json')]: '[]',
    [path.join(dataDir, 'frozen', 'p7-vault-probes.json')]: '[]',
  };

  // The full prereg manifest (PHASE7.md:866): all six probe-set files.
  const ALL_SIX = {
    ...ORIGINAL_THREE,
    [path.join(dataDir, 'frozen', 'p7-langtransfer-probes.json')]: '[]',
    [path.join(dataDir, 'p7-rotation-pool.json')]: '[]',
    [path.join(dataDir, 'frozen', 'p7-adversarial-counter-probes.json')]: '[]',
  };

  it('passes when all six prereg-manifest probe sets exist', () => {
    expect(checkProbeSets({ fs: mockFs(ALL_SIX), dataDir }).ok).toBe(true);
  });

  it('reports "not yet authored — run gated" when missing', () => {
    const r = checkProbeSets({ fs: mockFs({}), dataDir });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not yet authored');
    expect(r.message).toContain('p7-dev-probes.json');
  });

  // M10 regression: with ONLY the original three present, the run must still be
  // gated because the langtransfer / rotation / counter sets (prereg manifest,
  // PHASE7.md:866) are absent — otherwise a run passes pre-flight and then
  // crashes/skips the §3.5.1 OOD gate.
  it('gates when only the original three exist and lists the three newly-required missing files', () => {
    const r = checkProbeSets({ fs: mockFs(ORIGINAL_THREE), dataDir });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('frozen/p7-langtransfer-probes.json');
    expect(r.message).toContain('p7-rotation-pool.json');
    expect(r.message).toContain('frozen/p7-adversarial-counter-probes.json');
    // The original three are present, so they must NOT be reported as missing.
    expect(r.message).not.toContain('p7-dev-probes.json');
    expect(r.message).not.toContain('p7-heldout-probes.json');
    expect(r.message).not.toContain('p7-vault-probes.json');
  });
});

// ─── checkVariantSlate ──────────────────────────────────────────────────────────

describe('checkVariantSlate', () => {
  const dataDir = '/fake/data';
  const variantsDir = path.join(dataDir, 'p7-variants');
  const validFm = '---\nid: T\nstrategy: hybrid\n---\nbody text';

  function slate(count, overrides = {}) {
    const files = {};
    for (let i = 1; i <= count; i++) {
      files[path.join(variantsDir, `T${i}.md`)] = validFm;
    }
    return mockFs({ ...files, ...overrides });
  }

  it('passes when T1..T15 all exist with valid front-matter', () => {
    const r = checkVariantSlate({ fs: slate(15), dataDir });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('15');
  });

  it('reports "not yet authored — run gated" when variants are missing', () => {
    const r = checkVariantSlate({ fs: slate(10), dataDir });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not yet authored');
    expect(r.message).toContain('T11.md');
  });

  it('flags a file missing a closing front-matter delimiter', () => {
    const overrides = { [path.join(variantsDir, 'T1.md')]: '---\nid: T1\nno closing delimiter' };
    const r = checkVariantSlate({ fs: slate(15, overrides), dataDir });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('front-matter');
    expect(r.message).toContain('T1.md');
  });
});

// ─── checkDecisionLog ───────────────────────────────────────────────────────────

describe('checkDecisionLog', () => {
  const dataDir = '/fake/data';
  it('passes when p7-decisions.md exists', () => {
    const fs = mockFs({ [path.join(dataDir, 'p7-decisions.md')]: '# Decisions' });
    expect(checkDecisionLog({ fs, dataDir }).ok).toBe(true);
  });
  it('fails when p7-decisions.md is missing', () => {
    expect(checkDecisionLog({ fs: mockFs({}), dataDir }).ok).toBe(false);
  });
});
