/**
 * §5.7 adversarial counter-probe generalization gate.
 *
 * Two layers:
 *  1. runCounterProbeGate unit logic — maximin aggregation, the drop ratio, and
 *     the generalised / borderline / overfit thresholds (DEFAULTS.counterProbe*),
 *     plus input/runner-result validation.
 *  2. End-to-end wiring over the REAL frozen counter-probe set
 *     (p7-adversarial-counter-probes.json) + the production replay runner
 *     (makeOodReplayRunner), with ONLY the LLM `evaluate` stubbed — guards that
 *     the shipped set is schema-valid, is a faithful "-cp" rewrite of dev gold,
 *     and flows through the gate with no null/NaN buckets.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCounterProbeGate } from '../../../core/prompt-optimization/sweep/p7-counter-probe-gate.mjs';
import { DEFAULTS, validateProbes } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';
import { makeOodReplayRunner } from '../../../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CP = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'core/prompt-optimization/data/frozen/p7-adversarial-counter-probes.json'), 'utf8'),
).probes;
const DEV = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'),
).probes;

// runner returning a fixed mean over `n` probes
const stubRun = (score, n = 2) => async () => ({ perProbe: Array.from({ length: n }, () => ({ score })) });
const stubScore = (score) => async () => ({ score });
const PROBES = [{ id: 'a' }, { id: 'b' }];

describe('runCounterProbeGate — scoring & thresholds', () => {
  it('GENERALISED: small drop (≤0.15) ⇒ pass, generalised', async () => {
    const r = await runCounterProbeGate({
      winnerPrompt: 'W', counterProbes: PROBES, devScore: 0.8,
      runSonnet: stubRun(0.75), runGpt5_5: stubRun(0.75),
    });
    expect(r.counterMaximin).toBeCloseTo(0.75, 6);
    expect(r.drop).toBeCloseTo((0.8 - 0.75) / 0.8, 6); // 0.0625
    expect(r.generalised).toBe(true);
    expect(r.borderline).toBe(false);
    expect(r.overfit).toBe(false);
    expect(r.pass).toBe(true);
  });

  it('BORDERLINE: 0.15 < drop ≤ 0.25 ⇒ pass but not generalised', async () => {
    const r = await runCounterProbeGate({
      winnerPrompt: 'W', counterProbes: PROBES, devScore: 0.8,
      runSonnet: stubRun(0.64), runGpt5_5: stubRun(0.64), // drop = 0.20
    });
    expect(r.drop).toBeCloseTo(0.2, 6);
    expect(r.generalised).toBe(false);
    expect(r.borderline).toBe(true);
    expect(r.overfit).toBe(false);
    expect(r.pass).toBe(true);
  });

  it('OVERFIT: drop > 0.25 ⇒ gate FAILS', async () => {
    const r = await runCounterProbeGate({
      winnerPrompt: 'W', counterProbes: PROBES, devScore: 0.8,
      runSonnet: stubRun(0.5), runGpt5_5: stubRun(0.5), // drop = 0.375
    });
    expect(r.drop).toBeCloseTo(0.375, 6);
    expect(r.overfit).toBe(true);
    expect(r.borderline).toBe(false);
    expect(r.pass).toBe(false);
  });

  it('counterMaximin is the MIN of the two target means (Maximin)', async () => {
    const r = await runCounterProbeGate({
      winnerPrompt: 'W', counterProbes: PROBES, devScore: 0.9,
      runSonnet: stubRun(0.7), runGpt5_5: stubRun(0.5),
    });
    expect(r.counter_sonnet).toBeCloseTo(0.7, 6);
    expect(r.counter_gpt5_5).toBeCloseTo(0.5, 6);
    expect(r.counterMaximin).toBeCloseTo(0.5, 6); // min → the weaker target gates
    expect(r.pass).toBe(false); // drop = (0.9-0.5)/0.9 ≈ 0.444 > 0.25
  });

  it('overfit threshold is EXCLUSIVE: drop exactly 0.25 ⇒ NOT overfit ⇒ pass', async () => {
    // 0.25 == DEFAULTS.counterProbeOverfitDrop is binary-exact; maximin 0.75, dev 1.
    expect(DEFAULTS.counterProbeOverfitDrop).toBe(0.25);
    const r = await runCounterProbeGate({
      winnerPrompt: 'W', counterProbes: PROBES, devScore: 1,
      runSonnet: stubRun(0.75), runGpt5_5: stubRun(0.75), // drop = 0.25 exactly
    });
    expect(r.drop).toBe(0.25);
    expect(r.overfit).toBe(false); // > is strict, so the boundary still passes
    expect(r.borderline).toBe(true); // 0.15 < 0.25, not generalised either
    expect(r.pass).toBe(true);
  });

  it('a drop just past the overfit threshold (0.375) fails the gate', async () => {
    const r = await runCounterProbeGate({
      winnerPrompt: 'W', counterProbes: PROBES, devScore: 1,
      runSonnet: stubRun(0.625), runGpt5_5: stubRun(0.625), // drop = 0.375 > 0.25
    });
    expect(r.drop).toBe(0.375);
    expect(r.overfit).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('a drop comfortably inside the generalize band (0.125) ⇒ generalised', async () => {
    const r = await runCounterProbeGate({
      winnerPrompt: 'W', counterProbes: PROBES, devScore: 1,
      runSonnet: stubRun(0.875), runGpt5_5: stubRun(0.875), // drop = 0.125 ≤ 0.15
    });
    expect(r.drop).toBe(0.125);
    expect(r.generalised).toBe(true);
    expect(r.pass).toBe(true);
  });
});

describe('runCounterProbeGate — input & runner-result validation', () => {
  const ok = { winnerPrompt: 'W', counterProbes: PROBES, devScore: 0.8, runSonnet: stubRun(0.7), runGpt5_5: stubRun(0.7) };
  it('rejects an empty winnerPrompt', async () => {
    await expect(runCounterProbeGate({ ...ok, winnerPrompt: '' })).rejects.toThrow(TypeError);
  });
  it('rejects an empty counterProbes array', async () => {
    await expect(runCounterProbeGate({ ...ok, counterProbes: [] })).rejects.toThrow(TypeError);
  });
  it('rejects a non-positive devScore', async () => {
    await expect(runCounterProbeGate({ ...ok, devScore: 0 })).rejects.toThrow(TypeError);
    await expect(runCounterProbeGate({ ...ok, devScore: -0.1 })).rejects.toThrow(TypeError);
  });
  it('rejects non-function runners', async () => {
    await expect(runCounterProbeGate({ ...ok, runSonnet: null })).rejects.toThrow(TypeError);
  });
  it('rejects a runner that does not return {perProbe:[...]}', async () => {
    await expect(runCounterProbeGate({ ...ok, runSonnet: async () => ({}) })).rejects.toThrow(TypeError);
  });
  it('rejects a non-finite per-probe score', async () => {
    await expect(
      runCounterProbeGate({ ...ok, runSonnet: async () => ({ perProbe: [{ score: NaN }] }) }),
    ).rejects.toThrow(TypeError);
  });
});

describe('frozen counter-probe set — integrity & wiring', () => {
  const devById = new Map(DEV.map((p) => [p.id, p]));
  const CARRY = ['repo', 'language', 'stratum', 'expectedFiles', 'expectedSymbols', 'expectedFacts'];

  it('contains 10 probes — one "-cp" rewrite per in-distribution language', () => {
    expect(CP).toHaveLength(10);
    expect(new Set(CP.map((p) => p.language)).size).toBe(10);
  });

  it('every counter-probe is schema-valid and tagged adversarial-counter', () => {
    const v = validateProbes(CP);
    expect(v.ok, JSON.stringify(v.errors)).toBe(true);
    for (const cp of CP) expect(cp.tier).toBe('adversarial-counter');
  });

  it('each id is <source>-cp and carries the SOURCE dev gold byte-for-byte', () => {
    for (const cp of CP) {
      expect(cp.id).toBe(`${cp.source_probe_id}-cp`);
      const src = devById.get(cp.source_probe_id);
      expect(src, `source ${cp.source_probe_id} missing from dev set`).toBeTruthy();
      for (const k of CARRY) expect(cp[k], `${cp.id} gold "${k}" drifted`).toEqual(src[k]);
    }
  });

  it('NO query leaks an expectedSymbol verbatim (hostile-surface invariant)', () => {
    for (const cp of CP) {
      const q = cp.query.toLowerCase();
      for (const sym of cp.expectedSymbols ?? []) {
        expect(q.includes(String(sym).toLowerCase()), `${cp.id} leaks "${sym}"`).toBe(false);
      }
    }
  });

  it('flows through the gate end-to-end via makeOodReplayRunner with no null/NaN', async () => {
    const r = await runCounterProbeGate({
      winnerPrompt: 'WINNER',
      counterProbes: CP,
      devScore: 0.8,
      runSonnet: makeOodReplayRunner({ evaluate: stubScore(0.72), target: 'sonnet' }),
      runGpt5_5: makeOodReplayRunner({ evaluate: stubScore(0.72), target: 'gpt5_5' }),
    });
    expect(Number.isFinite(r.counterMaximin)).toBe(true);
    expect(r.counterMaximin).toBeCloseTo(0.72, 5);
    expect(Number.isFinite(r.drop)).toBe(true);
    expect(typeof r.pass).toBe('boolean');
    expect(r.pass).toBe(true); // drop = (0.8-0.72)/0.8 = 0.1 ≤ 0.15
  });
});
