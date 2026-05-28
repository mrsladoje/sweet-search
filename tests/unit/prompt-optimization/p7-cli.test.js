/**
 * gepa-cli parseArgs — smoke-trim flags (--smoke-probes / --smoke-variants).
 * Importing gepa-cli.mjs is side-effect-free: the run guard lives in gepa.mjs.
 */
import { describe, it, expect } from 'vitest';

import { parseArgs, withMutatorCallDefaults } from '../../../core/prompt-optimization/sweep/gepa-cli.mjs';

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
