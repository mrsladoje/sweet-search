/**
 * gepa-cli parseArgs — smoke-trim flags (--smoke-probes / --smoke-variants).
 * Importing gepa-cli.mjs is side-effect-free: the auto-invoke guard at the
 * bottom only fires when `import.meta.url === file://${process.argv[1]}` —
 * which is FALSE when imported from a test (process.argv[1] is the vitest
 * runner). Both `node gepa.mjs ...` and `node gepa-cli.mjs ...` invoke
 * mainCli; tests do not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertSeedsVerified, parseArgs, withMutatorCallDefaults } from '../../../core/prompt-optimization/sweep/gepa-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEPA_CLI_PATH = path.resolve(__dirname, '../../../core/prompt-optimization/sweep/gepa-cli.mjs');

describe('gepa-cli parseArgs — smoke-trim flags', () => {
  it('parses --smoke-probes and --smoke-variants as integers', () => {
    const o = parseArgs([
      '--dry-run', '--real', '--rounds', '1',
      '--smoke-probes', '1', '--smoke-variants', '1',
    ]);
    expect(o.dryRun).toBe(true);
    expect(o.real).toBe(true);
    expect(o.rounds).toBe(1);
    expect(o.smokeProbes).toBe(1);
    expect(o.smokeVariants).toBe(1);
  });

  it('leaves the trim flags undefined when not passed (full 5×2 matrix)', () => {
    const o = parseArgs(['--dry-run', '--real']);
    expect(o.smokeProbes).toBeUndefined();
    expect(o.smokeVariants).toBeUndefined();
  });

  it('parses the native-baseline file path for real GEPA scoring', () => {
    const o = parseArgs(['--probes', 'dev.json', '--native-baseline', 'native.json']);
    expect(o.probesFile).toBe('dev.json');
    expect(o.nativeBaselineFile).toBe('native.json');
  });

  it('parses the paid-run agent provider override', () => {
    const o = parseArgs(['--probes', 'dev.json', '--agent-provider', 'api']);
    expect(o.agentProvider).toBe('api');
    expect(() => parseArgs(['--agent-provider', 'subscription'])).toThrow(/unknown --agent-provider/);
  });

  it('parses --concurrency (agent-pool size) and validates it', () => {
    expect(parseArgs(['--probes', 'dev.json', '--concurrency', '10']).concurrency).toBe(10);
    expect(parseArgs(['--probes', 'dev.json']).concurrency).toBeUndefined(); // defaults to 1 downstream
    expect(() => parseArgs(['--concurrency', '0'])).toThrow(/--concurrency must be a positive integer/);
    expect(() => parseArgs(['--concurrency', 'lots'])).toThrow(/--concurrency must be a positive integer/);
  });

  it('parses --skip-finalize (bypass winner-only ship gates)', () => {
    expect(parseArgs(['--probes', 'dev.json', '--skip-finalize']).skipFinalize).toBe(true);
    expect(parseArgs(['--probes', 'dev.json']).skipFinalize).toBeUndefined();
  });

  it('parses restart/customization flags without starting a run', () => {
    const o = parseArgs([
      '--probes', 'dev.json',
      '--variants-dir', 'core/prompt-optimization/data/p7-variant-restarts/p7-gen1b-normalized',
      '--screen-probe-ids', 'cpp-004,ruby-008,kotlin-009',
    ]);
    expect(o.variantsDir).toMatch(/p7-gen1b-normalized/);
    expect(o.screenProbeIds).toEqual(['cpp-004', 'ruby-008', 'kotlin-009']);
    expect(() => parseArgs(['--screen-probe-ids', ',,,'])).toThrow(/screen-probe-ids/);
  });
});

describe('withMutatorCallDefaults — Kimi reasoning timeout (B2)', () => {
  it('adds a generous timeout + maxTokens for moonshot mutator calls', () => {
    const r = withMutatorCallDefaults({ lineage: 'moonshot', model: 'kimi-k2.6', systemPrompt: 's', userPrompt: 'u' });
    expect(r.timeoutMs).toBeGreaterThanOrEqual(240000);
    expect(r.maxTokens).toBeGreaterThanOrEqual(8192);
    expect(r.lineage).toBe('moonshot');
  });

  it('leaves non-moonshot calls untouched (judges keep the fast default)', () => {
    const req = { lineage: 'anthropic-api', model: 'claude-sonnet-4-6' };
    expect(withMutatorCallDefaults(req)).toBe(req);
  });

  it('lets explicit per-call timeout/maxTokens win over the defaults', () => {
    const r = withMutatorCallDefaults({ lineage: 'moonshot', timeoutMs: 1000, maxTokens: 100 });
    expect(r.timeoutMs).toBe(1000);
    expect(r.maxTokens).toBe(100);
  });
});

// ─── D3 round-0 ablation gate ─────────────────────────────────────────────
describe('assertSeedsVerified (D3 round-0 ablation gate)', () => {
  it('passes when no variant carries the unverified tag', () => {
    const variants = [
      { id: 'T1', frontMatter: { expected_weaknesses: ['something-else'] } },
      { id: 'T2', frontMatter: { expected_weaknesses: [] } },
      { id: 'T3', frontMatter: {} },
      { id: 'T4' }, // no frontMatter at all
    ];
    expect(assertSeedsVerified({ variants })).toEqual({ ok: true });
  });

  it('FAILS when any variant carries `unverified-until-round-0-ablation`', () => {
    const variants = [
      { id: 'T1', frontMatter: { expected_weaknesses: ['something-else'] } },
      { id: 'T2', frontMatter: { source_id: 'pruner-placeholder-joint-best', expected_weaknesses: ['unverified-until-round-0-ablation', 'no-live-op5-validation'] } },
      { id: 'T3', frontMatter: { expected_weaknesses: ['unverified-until-round-0-ablation'] } },
    ];
    const r = assertSeedsVerified({ variants });
    expect(r.ok).toBe(false);
    expect(r.unverified.map((v) => v.id)).toEqual(['T2', 'T3']);
  });

  it('PASSES when `allowUnverified: true` even if unverified variants are present (--allow-unverified-seeds override)', () => {
    const variants = [{ id: 'T1', frontMatter: { expected_weaknesses: ['unverified-until-round-0-ablation'] } }];
    expect(assertSeedsVerified({ variants, allowUnverified: true })).toEqual({ ok: true });
  });

  it('handles missing/empty variants array', () => {
    expect(assertSeedsVerified({ variants: undefined })).toEqual({ ok: true });
    expect(assertSeedsVerified({ variants: [] })).toEqual({ ok: true });
    expect(assertSeedsVerified({})).toEqual({ ok: true });
  });

  it('parseArgs picks up --allow-unverified-seeds as boolean true', () => {
    const o = parseArgs(['--probes', 'x.json', '--allow-unverified-seeds']);
    expect(o.allowUnverifiedSeeds).toBe(true);
  });

  it('parseArgs leaves allowUnverifiedSeeds undefined when flag is absent (gate active by default)', () => {
    const o = parseArgs(['--probes', 'x.json']);
    expect(o.allowUnverifiedSeeds).toBeUndefined();
  });
});

// ─── D1 regression: `node gepa-cli.mjs ...` must auto-invoke mainCli ──────
// Defect D1 (commit 218a840): gepa-cli.mjs originally had no auto-invoke
// guard, so `node gepa-cli.mjs ...` imported the module and exited 0 with
// no work done — the same name as `node gepa.mjs ...` but a silent no-op.
// This pinned check fails fast if the guard is ever removed.
describe('gepa-cli auto-invoke guard (D1 regression)', () => {
  it('the file ends with an `import.meta.url === file://${process.argv[1]}` guard that calls mainCli', () => {
    const src = readFileSync(GEPA_CLI_PATH, 'utf8');
    expect(src).toMatch(/if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/);
    // Guard must actually call mainCli (not just be a placeholder).
    const guardSection = src.split('if (import.meta.url === `file://${process.argv[1]}`)')[1] || '';
    expect(guardSection).toMatch(/mainCli\s*\(/);
    // Guard must handle errors so a thrown promise doesn't terminate the
    // node process with an unhandled-rejection warning + zero exit code.
    expect(guardSection).toMatch(/\.catch\(/);
    expect(guardSection).toMatch(/process\.exit\(1\)/);
  });
});
