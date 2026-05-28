/**
 * Phase 7 - GEPA screening-probe selection.
 *
 * The old screen used `probeSet.slice(0, N)`, which made the first eight probes
 * act as a language-biased mini benchmark. This module picks a deterministic,
 * mixed screen set across strata and languages while preserving resume safety.
 */

import { DEFAULTS, STRATA, hashContent } from './p7-shared.mjs';

function stableKey(probe, seed, round, index) {
  const h = hashContent([
    seed,
    round,
    probe?.id ?? '',
    probe?.language ?? '',
    probe?.stratum ?? '',
    index,
  ].join('|'));
  return Number.parseInt(h.slice(2, 10), 16);
}

function languageKey(probe) {
  return String(probe?.language ?? probe?.repo ?? 'unknown').toLowerCase();
}

function uniqueIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids || []) {
    const s = String(id).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Select a representative screen subset.
 *
 * @param {object} args
 * @param {object[]} args.probeSet
 * @param {number} [args.count]
 * @param {number} [args.round]
 * @param {number} [args.seed]
 * @param {string[]} [args.explicitIds] optional diagnostic/problem-probe screen
 */
export function selectScreenProbes({
  probeSet,
  count = DEFAULTS.screenProbes,
  round = 1,
  seed = 42,
  explicitIds = [],
} = {}) {
  if (!Array.isArray(probeSet)) throw new TypeError('selectScreenProbes: probeSet must be an array');
  const n = Math.max(0, Math.min(Number.isInteger(count) ? count : DEFAULTS.screenProbes, probeSet.length));
  if (n === 0) return [];

  const ids = uniqueIds(explicitIds);
  if (ids.length > 0) {
    const byId = new Map(probeSet.map((p) => [p.id, p]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new Error(`selectScreenProbes: unknown explicit probe id(s): ${missing.join(', ')}`);
    }
    return ids.slice(0, n).map((id) => byId.get(id));
  }

  if (n >= probeSet.length) return probeSet.slice();

  const ordered = probeSet
    .map((probe, index) => ({ probe, index, key: stableKey(probe, seed, round, index) }))
    .sort((a, b) => (a.key - b.key) || (a.index - b.index))
    .map((x) => x.probe);

  const presentStrata = new Set(ordered.map((p) => p.stratum));
  const stratumOrder = [
    ...STRATA.filter((s) => presentStrata.has(s)),
    ...[...presentStrata].filter((s) => !STRATA.includes(s)).sort(),
  ];
  const groups = new Map(stratumOrder.map((s) => [s, ordered.filter((p) => p.stratum === s)]));

  const selected = [];
  const selectedIds = new Set();
  const selectedLanguages = new Set();
  const take = (probe) => {
    selected.push(probe);
    selectedIds.add(probe.id);
    selectedLanguages.add(languageKey(probe));
  };

  while (selected.length < n) {
    let progressed = false;
    for (const stratum of stratumOrder) {
      if (selected.length >= n) break;
      const group = groups.get(stratum) || [];
      let pick = group.find((p) => !selectedIds.has(p.id) && !selectedLanguages.has(languageKey(p)));
      if (!pick) pick = group.find((p) => !selectedIds.has(p.id));
      if (!pick) continue;
      take(pick);
      progressed = true;
    }
    if (!progressed) break;
  }

  for (const probe of ordered) {
    if (selected.length >= n) break;
    if (!selectedIds.has(probe.id)) take(probe);
  }

  return selected;
}
