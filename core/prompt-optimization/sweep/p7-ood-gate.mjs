/**
 * Out-of-distribution (OOD) language-transfer gate — §3.5.1.
 *
 * POST-CONVERGENCE, WINNER-ONLY. This gate NEVER runs inside the GEPA
 * optimization loop (that would let the loop overfit to working around a
 * chunker bug on the OOD languages). After GEPA converges and a single
 * unified winning prompt is selected, the winner is replayed over the
 * 40-probe OOD language-transfer set (5 probes each on 8 languages NOT in
 * the in-distribution pool: C, Dart, Elixir, Lua, PHP, Scala, Swift, Zig).
 *
 * Targets (§3.5.1):
 *   - Sonnet 4.6           — production target, GATES
 *   - GPT-5.5-instant      — production target, GATES (anti-Sonnet-bias, §B2)
 *   - MiMo-V2.5-Pro        — HOMP class A, REPORTED ONLY (does NOT gate)
 *
 * MiMo's role: §3.5.1 specifies the winner is "run on HOMP class A
 * (MiMo-V2.5-Pro) AND BOTH production targets", but the pass criterion is
 * "aggregate Maximin ≥ 0.55 across the 40 OOD probes on BOTH Sonnet AND
 * GPT-5.5". MiMo is therefore an additional cross-family *robustness /
 * transfer* signal whose per-language + aggregate Maximin are recorded for
 * the scorecard, but it is NOT a gate target — only the two production
 * targets decide pass/fail. `runMimo` is consequently OPTIONAL: when
 * supplied its numbers populate `perLanguage[lang].maximin.mimo`,
 * `maximin_mimo`, and per-language weak-spot reasoning context, but the gate
 * boolean is computed solely from the production targets.
 *
 * Gate (§3.5.1, §3.7.1 step 10):
 *   pass iff BOTH production targets' aggregate Maximin ≥ DEFAULTS.oodMaximinGate
 *   (0.55), i.e. min(maximin_sonnet, maximin_gpt) ≥ 0.55 with each individually
 *   ≥ 0.55.
 *
 * Per-language scorecard: any single language whose aggregate Maximin
 * (min across production targets, for that language) is below
 * DEFAULTS.oodPerLanguageWeakSpot (0.4) is flagged a documented weak spot →
 * ship-with-caveat for that language. The 5 chunker-confound languages
 * (Dart, Elixir, Lua, Scala, Zig — no tree-sitter grammar, regex-fallback
 * chunker) are tagged `regexFallback:true` so a weak spot there can be
 * attributed to chunker-path quality rather than prompt brittleness.
 *
 * "Maximin" terminology: per-target per-language aggregate Maximin is the
 * mean of that target's per-probe scores within the language; the gate then
 * takes the worst (min) production target — consistent with the §3.7.1
 * worst-target Maximin framing applied per-target then min-across-targets.
 *
 * The runners are INJECTED so this module has no hard network dependency;
 * tests supply deterministic stubs. Mirrors the p7-reasoning-homp.mjs
 * injected-runner / no-network / fully-unit-testable pattern.
 *
 * Plan reference: docs/PHASE7.md §3.5.1.
 */

import { DEFAULTS } from './p7-shared.mjs';
import { OOD_LANGUAGES } from './author-probes.mjs';

/**
 * The 5 OOD languages with NO tree-sitter grammar — they use the
 * regex-fallback chunker (§3.5.1 chunker-path confound). Tagged on the
 * scorecard so a miss can be attributed to chunker-path quality, not prompt
 * brittleness.
 */
export const REGEX_FALLBACK_LANGUAGES = Object.freeze(['Dart', 'Elixir', 'Lua', 'Scala', 'Zig']);

/** Frozen lookup set for O(1) regex-fallback membership tests. */
const REGEX_FALLBACK_SET = new Set(REGEX_FALLBACK_LANGUAGES);

/**
 * Mean of a numeric array. Returns null for an empty array (no probes for a
 * language under a target → no aggregate to compute).
 * @param {number[]} xs
 * @returns {number|null}
 */
function mean(xs) {
  if (!xs || xs.length === 0) return null;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/**
 * Validate a runner result and bucket its per-probe scores by language.
 *
 * @param {string} label — runner name, for error messages
 * @param {{perProbe: {language:string, score:number, probeId?:string}[]}} result
 * @returns {Map<string, number[]>} language → list of scores
 */
function bucketByLanguage(label, result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.perProbe)) {
    throw new TypeError(`runOodGate: ${label} must resolve to { perProbe: Array }`);
  }
  const byLang = new Map();
  for (let i = 0; i < result.perProbe.length; i++) {
    const r = result.perProbe[i];
    if (!r || typeof r !== 'object') {
      throw new TypeError(`runOodGate: ${label} perProbe[${i}] must be an object`);
    }
    if (typeof r.language !== 'string' || r.language.length === 0) {
      throw new TypeError(`runOodGate: ${label} perProbe[${i}].language must be a non-empty string`);
    }
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) {
      throw new TypeError(`runOodGate: ${label} perProbe[${i}].score must be a finite number`);
    }
    if (!byLang.has(r.language)) byLang.set(r.language, []);
    byLang.get(r.language).push(r.score);
  }
  return byLang;
}

/**
 * @typedef {object} OodRunnerResult
 * @property {{language:string, score:number, probeId?:string}[]} perProbe
 *   — one entry per OOD probe the runner evaluated. `language` MUST be one of
 *     the §3.5.1 OOD languages (matched case-sensitively against OOD_LANGUAGES).
 *     `score` is the judge-panel correctness in [0,1] for that probe under the
 *     runner's target. `probeId` is optional (forensic only). The gate buckets
 *     these by language and aggregates with the mean to get a per-target,
 *     per-language Maximin.
 */

/**
 * @typedef {object} OodLanguageScore
 * @property {{sonnet:(number|null), gpt5_5:(number|null), mimo?:(number|null)}} maximin
 *   — per-target aggregate Maximin (mean of per-probe scores) for this language.
 *     `null` if the corresponding runner returned no probes for the language.
 *     `mimo` is present only when a `runMimo` runner was supplied.
 * @property {number|null} languageMaximin
 *   — min across the PRODUCTION targets (sonnet, gpt5_5) for this language;
 *     this is what the per-language weak-spot threshold is applied to.
 * @property {boolean} pass         — languageMaximin ≥ DEFAULTS.oodMaximinGate
 * @property {boolean} weakSpot     — languageMaximin < DEFAULTS.oodPerLanguageWeakSpot
 * @property {boolean} regexFallback — true for Dart/Elixir/Lua/Scala/Zig
 * @property {number}  probeCount   — number of probes seen for this language (max across targets)
 */

/**
 * @typedef {object} OodGateResult
 * @property {Object<string, OodLanguageScore>} perLanguage — scorecard keyed by OOD language
 * @property {number} maximin_sonnet — aggregate Maximin over ALL OOD probes, Sonnet
 * @property {number} maximin_gpt    — aggregate Maximin over ALL OOD probes, GPT-5.5
 * @property {number} [maximin_mimo] — aggregate Maximin over ALL OOD probes, MiMo (if runMimo supplied)
 * @property {string[]} weakSpots    — OOD languages flagged as documented weak spots
 * @property {boolean} pass          — min(maximin_sonnet, maximin_gpt) ≥ gate, both individually ≥ gate
 */

/**
 * Run the §3.5.1 OOD language-transfer gate.
 *
 * Each injected runner takes `(winnerPrompt, oodProbes)` and resolves to a
 * per-probe score breakdown (`{ perProbe: [{ language, score, probeId? }] }`).
 * The gate buckets those scores by language, computes per-target per-language
 * aggregate Maximin (mean), derives per-language Maximin (min across production
 * targets), and gates the overall run on both production targets' OOD-wide
 * aggregate Maximin.
 *
 * @param {object} args
 * @param {string}   args.winnerPrompt — the unified winning system prompt text
 * @param {object[]} args.oodProbes    — the 40 OOD language-transfer probe records
 *   (5 each × 8 languages); passed verbatim to each runner.
 * @param {(prompt:string, probes:object[]) => Promise<OodRunnerResult>} args.runSonnet
 *   — runs the winner under Sonnet 4.6 over the OOD probes (production target, GATES).
 * @param {(prompt:string, probes:object[]) => Promise<OodRunnerResult>} args.runGpt5_5
 *   — runs the winner under GPT-5.5-instant over the OOD probes (production target, GATES).
 * @param {(prompt:string, probes:object[]) => Promise<OodRunnerResult>} [args.runMimo]
 *   — OPTIONAL. Runs the winner under MiMo-V2.5-Pro (HOMP class A). Reported in
 *     the scorecard + `maximin_mimo`; does NOT participate in the gate decision.
 * @param {string[]} [args.languages] — OOD language catalog to score against;
 *   defaults to OOD_LANGUAGES. Every language listed gets a scorecard entry even
 *   if a runner returned no probes for it (its per-target Maximin will be null).
 * @returns {Promise<OodGateResult>}
 */
export async function runOodGate({
  winnerPrompt,
  oodProbes,
  runSonnet,
  runGpt5_5,
  runMimo,
  languages = OOD_LANGUAGES,
}) {
  // ── input validation (mirrors p7-reasoning-homp.mjs) ────────────────────
  if (typeof winnerPrompt !== 'string' || winnerPrompt.length === 0) {
    throw new TypeError('runOodGate: winnerPrompt must be a non-empty string');
  }
  if (!Array.isArray(oodProbes) || oodProbes.length === 0) {
    throw new TypeError('runOodGate: oodProbes must be a non-empty array');
  }
  if (typeof runSonnet !== 'function') {
    throw new TypeError('runOodGate: runSonnet must be a function');
  }
  if (typeof runGpt5_5 !== 'function') {
    throw new TypeError('runOodGate: runGpt5_5 must be a function');
  }
  if (runMimo !== undefined && typeof runMimo !== 'function') {
    throw new TypeError('runOodGate: runMimo must be a function when provided');
  }
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new TypeError('runOodGate: languages must be a non-empty array');
  }

  const haveMimo = typeof runMimo === 'function';

  // ── replay the winner on each target (no-network: injected runners) ─────
  const runs = [runSonnet(winnerPrompt, oodProbes), runGpt5_5(winnerPrompt, oodProbes)];
  if (haveMimo) runs.push(runMimo(winnerPrompt, oodProbes));
  const settled = await Promise.all(runs);

  const sonnetByLang = bucketByLanguage('runSonnet', settled[0]);
  const gptByLang = bucketByLanguage('runGpt5_5', settled[1]);
  const mimoByLang = haveMimo ? bucketByLanguage('runMimo', settled[2]) : null;

  // ── per-language scorecard ──────────────────────────────────────────────
  /** @type {Object<string, OodLanguageScore>} */
  const perLanguage = {};
  const weakSpots = [];

  for (const lang of languages) {
    const sonnetAgg = mean(sonnetByLang.get(lang));
    const gptAgg = mean(gptByLang.get(lang));
    const mimoAgg = haveMimo ? mean(mimoByLang.get(lang)) : undefined;

    // Per-language Maximin = worst PRODUCTION target. If either production
    // target lacks probes for this language, languageMaximin is null and the
    // language neither passes nor flags as a weak spot (insufficient data).
    const languageMaximin =
      sonnetAgg === null || gptAgg === null ? null : Math.min(sonnetAgg, gptAgg);

    const langPass = languageMaximin !== null && languageMaximin >= DEFAULTS.oodMaximinGate;
    const weakSpot = languageMaximin !== null && languageMaximin < DEFAULTS.oodPerLanguageWeakSpot;
    if (weakSpot) weakSpots.push(lang);

    const probeCount = Math.max(
      (sonnetByLang.get(lang) || []).length,
      (gptByLang.get(lang) || []).length,
      haveMimo ? (mimoByLang.get(lang) || []).length : 0,
    );

    const maximin = { sonnet: sonnetAgg, gpt5_5: gptAgg };
    if (haveMimo) maximin.mimo = mimoAgg;

    perLanguage[lang] = {
      maximin,
      languageMaximin,
      pass: langPass,
      weakSpot,
      regexFallback: REGEX_FALLBACK_SET.has(lang),
      probeCount,
    };
  }

  // ── OOD-wide aggregate Maximin per target (mean over ALL probes) ────────
  const allScores = (byLang) => {
    const out = [];
    for (const scores of byLang.values()) out.push(...scores);
    return out;
  };
  const maximin_sonnet = mean(allScores(sonnetByLang)) ?? 0;
  const maximin_gpt = mean(allScores(gptByLang)) ?? 0;
  const maximin_mimo = haveMimo ? (mean(allScores(mimoByLang)) ?? 0) : undefined;

  // ── gate: BOTH production targets ≥ 0.55 ────────────────────────────────
  const sonnetGate = maximin_sonnet >= DEFAULTS.oodMaximinGate;
  const gptGate = maximin_gpt >= DEFAULTS.oodMaximinGate;
  const pass = sonnetGate && gptGate;

  /** @type {OodGateResult} */
  const result = {
    perLanguage,
    maximin_sonnet,
    maximin_gpt,
    weakSpots,
    pass,
  };
  if (haveMimo) result.maximin_mimo = maximin_mimo;
  return result;
}
