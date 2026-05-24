/**
 * End-to-end wiring test for the §3.5.1 OOD language-transfer gate using the REAL
 * frozen probe set (p7-langtransfer-probes.json) + the production replay runner
 * (makeOodReplayRunner), with ONLY the LLM `evaluate` stubbed.
 *
 * Primary guard: the per-language scorecard casing contract. runOodGate buckets
 * on `probe.language` and iterates OOD_LANGUAGES (capitalized). If a probe's
 * `language` casing drifts from OOD_LANGUAGES, every per-language entry silently
 * goes null while the aggregate gate still "works" — a subtle regression this
 * test fails loudly on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOodGate, REGEX_FALLBACK_LANGUAGES } from '../../../core/prompt-optimization/sweep/p7-ood-gate.mjs';
import { makeOodReplayRunner } from '../../../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { OOD_LANGUAGES } from '../../../core/prompt-optimization/sweep/author-probes.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OOD = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json'), 'utf8'),
).probes;

const stubScore = (score) => async () => ({ score });
const stubByLang = (fn) => async ({ probe }) => ({ score: fn(probe) });

describe('OOD gate wiring — frozen probes + makeOodReplayRunner', () => {
  it('frozen probe languages exactly match the OOD_LANGUAGES scorecard catalog (casing)', () => {
    const langs = new Set(OOD.map((p) => p.language));
    for (const l of OOD_LANGUAGES) expect(langs.has(l), `frozen set missing language "${l}"`).toBe(true);
    expect(langs.size).toBe(OOD_LANGUAGES.length);
  });

  it('makeOodReplayRunner produces the {perProbe:[{language,score}]} shape runOodGate expects', async () => {
    const run = makeOodReplayRunner({ evaluate: stubScore(0.7), target: 'sonnet' });
    const r = await run('WINNER', OOD.slice(0, 5));
    expect(r.perProbe).toHaveLength(5);
    expect(r.perProbe[0]).toHaveProperty('language');
    expect(r.perProbe[0]).toHaveProperty('probeId');
    expect(typeof r.perProbe[0].score).toBe('number');
  });

  it('makeOodReplayRunner rejects a bad target', () => {
    expect(() => makeOodReplayRunner({ evaluate: stubScore(0.7), target: 'mimo' })).toThrow(RangeError);
    expect(() => makeOodReplayRunner({ evaluate: null, target: 'sonnet' })).toThrow(TypeError);
  });

  it('full gate over the frozen set populates ALL 8 languages — no null buckets (casing regression guard)', async () => {
    const result = await runOodGate({
      winnerPrompt: 'WINNER',
      oodProbes: OOD,
      runSonnet: makeOodReplayRunner({ evaluate: stubScore(0.7), target: 'sonnet' }),
      runGpt5_5: makeOodReplayRunner({ evaluate: stubScore(0.7), target: 'gpt5_5' }),
    });
    expect(result.pass).toBe(true);
    expect(result.maximin_sonnet).toBeCloseTo(0.7, 5);
    expect(result.maximin_gpt).toBeCloseTo(0.7, 5);
    for (const l of OOD_LANGUAGES) {
      expect(result.perLanguage[l], `no scorecard entry for ${l}`).toBeTruthy();
      expect(result.perLanguage[l].languageMaximin, `${l} bucket is null (casing regression)`).not.toBeNull();
      expect(result.perLanguage[l].probeCount).toBe(5);
      expect(result.perLanguage[l].pass).toBe(true);
    }
    // regex-fallback tagging tracks REGEX_FALLBACK_LANGUAGES
    for (const l of REGEX_FALLBACK_LANGUAGES) expect(result.perLanguage[l].regexFallback).toBe(true);
    for (const l of ['C', 'PHP', 'Swift']) expect(result.perLanguage[l].regexFallback).toBe(false);
  });

  it('a weak language (< 0.4) is flagged per-language while the aggregate gate still computes', async () => {
    const evaluate = stubByLang((p) => (p.language === 'Swift' ? 0.3 : 0.7));
    const result = await runOodGate({
      winnerPrompt: 'WINNER',
      oodProbes: OOD,
      runSonnet: makeOodReplayRunner({ evaluate, target: 'sonnet' }),
      runGpt5_5: makeOodReplayRunner({ evaluate, target: 'gpt5_5' }),
    });
    expect(result.perLanguage.Swift.weakSpot).toBe(true);
    expect(result.weakSpots).toContain('Swift');
    expect(result.perLanguage.C.weakSpot).toBe(false);
  });

  it('fails the gate when a production target falls below 0.55 aggregate', async () => {
    const result = await runOodGate({
      winnerPrompt: 'WINNER',
      oodProbes: OOD,
      runSonnet: makeOodReplayRunner({ evaluate: stubScore(0.7), target: 'sonnet' }),
      runGpt5_5: makeOodReplayRunner({ evaluate: stubScore(0.4), target: 'gpt5_5' }),
    });
    expect(result.pass).toBe(false);
  });
});
