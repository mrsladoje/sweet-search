/**
 * Late-interaction search-rerank policy resolver.
 *
 * Pure function — no I/O. The two product concepts (LI indexing model vs
 * search-side LI rerank policy) are separate. This resolver computes the
 * effective search-side state from explicit user choices, env vars,
 * persisted init config, and the on-disk LI index manifest.
 *
 * The on-disk manifest is the source of truth: if the user (or auto)
 * asks for rerank ON but the loaded index is missing, mismatched, or
 * built with an edge model that's known to underperform as a reranker
 * on benchmarked corpora, the resolver downgrades or warns accordingly.
 *
 * Bench evidence backing the auto rules (gencodesearchnet, 2026-05-03):
 *   standard `lateon-code` + LI on  : 85.57 % MRR  ← auto resolves ON
 *   edge `lateon-code-edge` + LI on : 80.65 % MRR  ← auto resolves OFF
 *   edge      + LI off              : 82.91 % MRR  (best edge config)
 *   standard  + LI off              : 82.91 % MRR  (index-independent floor)
 * See docs/BENCH_TODO.md "Phase 3 — Honest sweep before v2.5.0 (post-fix re-run)".
 */

// ---------------------------------------------------------------------------
// Public model identifiers — kept in lockstep with
// `core/infrastructure/config/ranking.js::LATE_INTERACTION_CONFIG.models`.
// ---------------------------------------------------------------------------

export const LI_MODEL_STANDARD = 'lateon-code';
export const LI_MODEL_EDGE = 'lateon-code-edge';
export const LI_MODEL_NONE = 'none';

export const VALID_LI_MODELS = Object.freeze([
  LI_MODEL_STANDARD,
  LI_MODEL_EDGE,
  LI_MODEL_NONE,
]);

export const VALID_RERANK_POLICIES = Object.freeze(['auto', 'on', 'off']);

// ---------------------------------------------------------------------------
// Env-var coercion (same shape as other env opt-outs in the repo —
// SWEET_SEARCH_COREML_CASCADE, SWEET_SEARCH_NATIVE_INFERENCE, etc.)
// ---------------------------------------------------------------------------

function isEnvOff(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

function isEnvOn(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve effective search-side LI rerank state.
 *
 * @param {object} input
 * @param {object} [input.persisted]               - parsed `.sweet-search/config.json`
 * @param {string} [input.persisted.liModel]       - 'lateon-code' | 'lateon-code-edge' | 'none'
 * @param {string} [input.persisted.searchReranking] - 'auto' | 'on' | 'off'
 * @param {object} [input.indexManifest]           - loaded LI index header
 * @param {string} [input.indexManifest.modelId]   - id baked into the SSLX header
 * @param {number} [input.indexManifest.tokenDim]  - per-token dimension
 * @param {boolean} [input.indexManifest.modelMismatch] - true when loaded
 *   modelId disagrees with the active config model
 * @param {boolean} [input.indexManifest.exists]   - false when no index file on disk
 * @param {object} [input.env]                     - env-var snapshot (defaults to process.env)
 * @param {boolean} [input.optionOverride]         - explicit per-call override from caller
 *   (search-time options.useLateInteraction). If a boolean, it short-circuits the
 *   resolver and wins over everything else.
 * @param {string} [input.activeConfigModel]       - LATE_INTERACTION_CONFIG.model fallback
 *   (used when the index hasn't been loaded yet so we can still emit a sensible
 *   default — preserves back-compat with the pre-Phase-4 behaviour).
 *
 * @returns {{
 *   effective: boolean,
 *   policy: 'auto'|'on'|'off',
 *   reason: string,
 *   warning?: string
 * }}
 */
export function resolveSearchRerankPolicy(input = {}) {
  const env = input.env ?? process.env;
  const persisted = input.persisted ?? {};
  const manifest = input.indexManifest ?? null;
  const declaredPolicy = normalizePolicy(persisted.searchReranking);

  // 1. Per-call explicit override (existing API, highest precedence).
  if (typeof input.optionOverride === 'boolean') {
    return {
      effective: input.optionOverride,
      policy: declaredPolicy,
      reason: `per-call override (${input.optionOverride ? 'on' : 'off'})`,
    };
  }

  // 2. Env-var hard kill switch — opt-out for benchmarks / scripts that
  //    must defeat any persisted policy. Mirrors SWEET_SEARCH_COREML_CASCADE=0.
  if (isEnvOff(env.SWEET_SEARCH_LI_RERANK)) {
    return {
      effective: false,
      policy: declaredPolicy,
      reason: 'SWEET_SEARCH_LI_RERANK=0 (env opt-out)',
    };
  }
  if (isEnvOn(env.SWEET_SEARCH_LI_RERANK)) {
    // Env-on still goes through the safety check below — we never silently
    // rerank with a missing or mismatched index.
    if (!manifestUsable(manifest)) {
      return {
        effective: false,
        policy: declaredPolicy,
        reason: 'SWEET_SEARCH_LI_RERANK=1 but no usable LI index',
        warning: manifestUnusableReason(manifest),
      };
    }
    return {
      effective: true,
      policy: declaredPolicy,
      reason: 'SWEET_SEARCH_LI_RERANK=1 (env opt-in)',
      ...(isEdgeManifest(manifest) ? { warning: edgeOnWarning() } : {}),
    };
  }

  // 3. Persisted explicit ON / OFF (init wizard / --search-reranking).
  if (declaredPolicy === 'off') {
    return {
      effective: false,
      policy: 'off',
      reason: 'persisted searchReranking=off',
    };
  }
  if (declaredPolicy === 'on') {
    if (!manifestUsable(manifest)) {
      return {
        effective: false,
        policy: 'on',
        reason: 'persisted searchReranking=on but no usable LI index',
        warning: manifestUnusableReason(manifest),
      };
    }
    return {
      effective: true,
      policy: 'on',
      reason: 'persisted searchReranking=on',
      ...(isEdgeManifest(manifest) ? { warning: edgeOnWarning() } : {}),
    };
  }

  // 4. Auto (the default): consult the index manifest.
  //    - missing/mismatched → off (with diagnostic)
  //    - edge modelId       → off (Phase 3 shows edge LI rerank is net-negative)
  //    - any standard model → on
  if (manifest != null && (manifest.exists === false)) {
    return {
      effective: false,
      policy: 'auto',
      reason: 'auto: no LI index on disk',
    };
  }
  if (manifest != null && manifest.modelMismatch === true) {
    return {
      effective: false,
      policy: 'auto',
      reason: `auto: LI index model mismatch (header=${manifest.modelId ?? '?'})`,
    };
  }
  if (manifest != null && isEdgeManifest(manifest)) {
    return {
      effective: false,
      policy: 'auto',
      reason: `auto: edge LI index (${manifest.modelId}) — search rerank disabled by default (see Phase 3 bench)`,
    };
  }
  if (manifest != null && manifest.modelId) {
    return {
      effective: true,
      policy: 'auto',
      reason: `auto: standard LI index (${manifest.modelId})`,
    };
  }

  // 5. Fallback — manifest not yet loaded (early call path) OR no manifest
  //    info at all. Defer to the active config model so existing flows that
  //    constructed SweetSearch before init() still get the historical
  //    behaviour. Edge model active → off; anything else → on.
  if (input.activeConfigModel === LI_MODEL_EDGE) {
    return {
      effective: false,
      policy: 'auto',
      reason: 'auto: edge LI active in config (manifest not yet loaded)',
    };
  }
  return {
    effective: true,
    policy: 'auto',
    reason: 'auto: standard LI active in config (manifest not yet loaded)',
  };
}

// ---------------------------------------------------------------------------
// Helpers (also exported for test reuse)
// ---------------------------------------------------------------------------

export function normalizePolicy(value) {
  if (typeof value !== 'string') return 'auto';
  const v = value.trim().toLowerCase();
  return VALID_RERANK_POLICIES.includes(v) ? v : 'auto';
}

export function normalizeLiModel(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return VALID_LI_MODELS.includes(v) ? v : null;
}

export function isEdgeManifest(manifest) {
  return !!manifest && manifest.modelId === LI_MODEL_EDGE;
}

export function manifestUsable(manifest) {
  if (manifest == null) return false;
  if (manifest.exists === false) return false;
  if (manifest.modelMismatch === true) return false;
  if (!manifest.modelId) return false;
  return true;
}

function manifestUnusableReason(manifest) {
  if (manifest == null) return 'no LI index manifest';
  if (manifest.exists === false) return 'no LI index file on disk';
  if (manifest.modelMismatch === true) {
    return `LI index built with ${manifest.modelId ?? '?'} but config says otherwise — re-index to fix`;
  }
  if (!manifest.modelId) return 'LI index manifest missing modelId';
  return 'unusable LI index manifest';
}

function edgeOnWarning() {
  return (
    'Edge LI search reranking benchmarked below no-rerank search on '
    + 'gencodesearchnet (80.65% vs 82.91% MRR). The recommended edge '
    + 'setup is search reranking off — edge LI tokens still power '
    + 'read-semantic and ColGrep without participating in search rerank.'
  );
}

// ---------------------------------------------------------------------------
// Init-side hardware-aware default
// ---------------------------------------------------------------------------

/**
 * Recommend an LI model + rerank policy from a hardware capability snapshot.
 * Pure function — caller passes in detectHardwareCapability() output.
 *
 * Conservative: accuracy-first by default. Only recommends edge when the
 * machine is clearly RAM- or disk-constrained.
 *
 * @param {object} hw - shape returned by detectHardwareCapability()
 * @returns {{ liModel: string, searchReranking: 'auto', reason: string }}
 */
export function recommendInitDefaults(hw = {}) {
  const ramGB = Number(hw.totalMemGB ?? 0);
  // Constrained heuristic (intentionally narrow — "accuracy-first unless
  // hardware/disk clearly indicates constrained mode" per Phase 4 brief):
  //   - RAM ≤ 8 GB                                  → edge
  //   - Apple Silicon M1/M2 (older ANE)             → edge candidate
  //   - everything else                              → standard
  // The bench shows standard LI is the accuracy default; only flip when
  // the constrained signal is unambiguous.
  const isLowRam = ramGB > 0 && ramGB <= 8;
  const isOlderApple =
    hw.appleSilicon && typeof hw.appleSilicon === 'object'
      ? Number(hw.appleSilicon.generation ?? hw.appleSilicon.gen ?? 99) <= 2
      : false;

  if (isLowRam) {
    return {
      liModel: LI_MODEL_EDGE,
      searchReranking: 'auto',
      reason: `constrained: RAM=${ramGB} GB (≤8) — edge LI for indexing, search rerank auto-disables on edge per Phase 3 bench`,
    };
  }
  if (isOlderApple && ramGB > 0 && ramGB <= 16) {
    return {
      liModel: LI_MODEL_EDGE,
      searchReranking: 'auto',
      reason: `constrained: M1/M2 + RAM=${ramGB} GB — edge LI recommended for indexing speed + disk savings`,
    };
  }
  return {
    liModel: LI_MODEL_STANDARD,
    searchReranking: 'auto',
    reason: ramGB > 0
      ? `capable: RAM=${ramGB} GB — standard LI (accuracy default at 85.57% MRR on gencodesearchnet)`
      : 'capable (default): standard LI (accuracy default)',
  };
}
