/**
 * Model Registry — known model artifacts with HuggingFace IDs, file paths,
 * sizes, and SHA256 content checksums.
 *
 * Only models with active runtime paths in the current full-profile search.
 * Checksums are LFS content SHA256 from the HuggingFace API.
 * Small non-LFS files (tokenizer.json, config.json) omit sha256 — they are
 * integrity-checked by git and verified by size only.
 *
 * Use scripts/verify-model-registry.js to regenerate/verify checksums.
 */

export const MODEL_REGISTRY = {
  'lateon-code': {
    hfId: 'lightonai/LateOn-Code',
    profile: 'full',
    description: 'Late interaction model (INT8, 128d)',
    files: [
      { path: 'model_int8.onnx', sizeBytes: 150008364, sha256: 'a62a88b4e3ebb76e8bc5f0263d17b773c667d27bc73c5120e3131048dd1554ef' },
      { path: '1_Dense/model.safetensors', sizeBytes: 393304, sha256: '22ea6a53cad3ed034934b5db7a214a0bcc28ff4cc440babea44029989e4bbcca' },
      { path: 'tokenizer.json', sizeBytes: 3583847, sha256: null },
      { path: 'tokenizer_config.json', sizeBytes: 21372, sha256: null },
      { path: 'special_tokens_map.json', sizeBytes: 581, sha256: null },
      { path: 'config.json', sizeBytes: 1208, sha256: null },
    ],
  },

  'lateon-code-edge': {
    hfId: 'lightonai/LateOn-Code-edge',
    profile: 'full',
    description: 'Late interaction edge model (FP32, 48d)',
    files: [
      { path: 'model.onnx', sizeBytes: 67970609, sha256: 'ac5a92a685512b163c3c591438f518379309d2a98c4818a9c6e2986f789dc8ef' },
      { path: '1_Dense/model.safetensors', sizeBytes: 524376, sha256: '9efb17fcb2106cd8fcb01d57a9cd9c997a487ad20630ec8e44ce3f9d89efe0a7' },
      { path: '2_Dense/model.safetensors', sizeBytes: 98392, sha256: 'a7a388138b3c4bb1a81c8c3bcb9de123f1e652b9e9464a72707ca19ee86a26b1' },
      { path: 'tokenizer.json', sizeBytes: 3583847, sha256: null },
      { path: 'tokenizer_config.json', sizeBytes: 21373, sha256: null },
      { path: 'special_tokens_map.json', sizeBytes: 581, sha256: null },
      { path: 'config.json', sizeBytes: 1252, sha256: null },
    ],
  },

  'gte-reranker-modernbert-base': {
    hfId: 'Alibaba-NLP/gte-reranker-modernbert-base',
    profile: 'full',
    description: 'Local reranker (INT8 quantized) — opt-in',
    // Disabled by default since commit 43a61eb (2026-04-22): measured
    // MRR-neutral on gencodesearchnet (82.15% with vs without) at 3x
    // latency cost. init should NOT fetch this 143 MB model unless
    // the user explicitly opts in via SWEET_SEARCH_ENABLE_LOCAL_RERANKER=1.
    // Infrastructure (local-reranker.js, this registry entry) remains
    // intact so the CE can be swapped back in without re-adding code.
    optIn: {
      envVars: ['SWEET_SEARCH_ENABLE_LOCAL_RERANKER'],
      reason: 'Local cross-encoder reranker — disabled by default (MRR-neutral at 3x latency, see commit 43a61eb)',
    },
    files: [
      { path: 'onnx/model_quantized.onnx', sizeBytes: 150871837, sha256: 'ecc6a0ae67cee3d898167802383112d9185ca9250e07bd5d1fa65019b050179d' },
      { path: 'tokenizer.json', sizeBytes: 3583499, sha256: null },
      { path: 'tokenizer_config.json', sizeBytes: 21031, sha256: null },
      { path: 'special_tokens_map.json', sizeBytes: 694, sha256: null },
      { path: 'config.json', sizeBytes: 1333, sha256: null },
    ],
  },

  'coderankembed-int8': {
    hfId: 'mrsladoje/CodeRankEmbed-onnx-int8',
    profile: 'full',
    description: 'Local embedding model (INT8 quantized, 768d)',
    files: [
      // SHA256 updated 2026-04-23: re-quantized with `reduce_range=True`
      // to fix AVX2-only INT8 kernel overflow on pre-VNNI x86 CPUs
      // (notably AMD Zen 3 EPYC). Size unchanged — reduce_range only
      // affects weight *values*, not storage format. See HF model card
      // for full details: https://huggingface.co/mrsladoje/CodeRankEmbed-onnx-int8
      { path: 'onnx/model.onnx', sizeBytes: 138619279, sha256: '4eae31d09b1843103a1ebd5e2b2e24b5a5cad441a33906b35b12b1e2ed91d1db' },
      { path: 'tokenizer.json', sizeBytes: 711649, sha256: null },
      { path: 'tokenizer_config.json', sizeBytes: 1447, sha256: null },
      { path: 'special_tokens_map.json', sizeBytes: 695, sha256: null },
      { path: 'config.json', sizeBytes: 1371, sha256: null },
      { path: 'vocab.txt', sizeBytes: 231508, sha256: null },
    ],
  },

  'coderankembed-fp32': {
    hfId: 'nomic-ai/CodeRankEmbed',
    profile: 'full',
    description: 'Local embedding model (FP32 safetensors, 768d) for native inference',
    files: [
      { path: 'model.safetensors', sizeBytes: 546938168, sha256: '827529bcd58aef0d9082e66eeff7e7d53a02f62bd005f841a26b3d3e2fb17ebe' },
      { path: 'config.json', sizeBytes: 1525, sha256: null },
    ],
  },

  'lateon-code-fp32': {
    hfId: 'lightonai/LateOn-Code',
    profile: 'full',
    description: 'Late interaction model (FP32 safetensors, backbone 768d) for native inference',
    files: [
      { path: 'model.safetensors', sizeBytes: 596076280, sha256: '45c40bb4ba6b45f0c66b2deb3d27dd06efc3af23c78c8093b8cad2af61c683b2' },
      { path: '1_Dense/model.safetensors', sizeBytes: 393304, sha256: '22ea6a53cad3ed034934b5db7a214a0bcc28ff4cc440babea44029989e4bbcca' },
      { path: 'config.json', sizeBytes: 1208, sha256: null },
    ],
  },

  'lateon-code-edge-fp32': {
    hfId: 'lightonai/LateOn-Code-edge',
    profile: 'full',
    description: 'Late interaction edge model (FP32 safetensors, backbone 256d, 2-stage projection) for native inference',
    files: [
      { path: 'model.safetensors', sizeBytes: 67195976, sha256: '7ffc36b8ff71367249cd5220dbdd4bdbe177bc0e305b2e978a8b598bd8296f04' },
      { path: '1_Dense/model.safetensors', sizeBytes: 524376, sha256: '9efb17fcb2106cd8fcb01d57a9cd9c997a487ad20630ec8e44ce3f9d89efe0a7' },
      { path: '2_Dense/model.safetensors', sizeBytes: 98392, sha256: 'a7a388138b3c4bb1a81c8c3bcb9de123f1e652b9e9464a72707ca19ee86a26b1' },
      { path: 'config.json', sizeBytes: 1252, sha256: null },
    ],
  },

  'ms-marco-tinybert': {
    hfId: 'Xenova/ms-marco-TinyBERT-L-2-v2',
    profile: 'full',
    description: 'FlashRank cross-encoder reranker (quantized, ~4.3MB) — opt-in',
    // Disabled by default since commits 43a61eb + d92a5a7 (2026-04-22):
    // the MaxSim+CE cascade is no longer active in the default config
    // (CASCADE_CONFIG.enabled=false, shadowMode=false). init should not
    // fetch this model unless the user explicitly opts into cascade or
    // shadow mode.
    optIn: {
      envVars: ['SWEET_SEARCH_CASCADE_ENABLED', 'SWEET_SEARCH_CASCADE_SHADOW'],
      reason: 'FlashRank cross-encoder for MaxSim+CE cascade — disabled by default (see commits 43a61eb, d92a5a7)',
    },
    files: [
      { path: 'onnx/model_quantized.onnx', sizeBytes: 4496298, sha256: '026c2ec3257cd351696e45bbd6040bb83cf818ba89059b4344bd6350138b62ce' },
      { path: 'tokenizer.json', sizeBytes: 711396, sha256: null },
      { path: 'tokenizer_config.json', sizeBytes: 1242, sha256: null },
      { path: 'special_tokens_map.json', sizeBytes: 125, sha256: null },
      { path: 'config.json', sizeBytes: 824, sha256: null },
      { path: 'vocab.txt', sizeBytes: 231508, sha256: null },
    ],
  },

  'all-minilm-l6-v2': {
    hfId: 'Xenova/all-MiniLM-L6-v2',
    profile: 'full',
    description: 'Semantic cache embedding model (quantized, ~23MB)',
    files: [
      { path: 'onnx/model_quantized.onnx', sizeBytes: 22972370, sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' },
      { path: 'tokenizer.json', sizeBytes: 711661, sha256: null },
      { path: 'tokenizer_config.json', sizeBytes: 366, sha256: null },
      { path: 'special_tokens_map.json', sizeBytes: 125, sha256: null },
      { path: 'config.json', sizeBytes: 650, sha256: null },
      { path: 'vocab.txt', sizeBytes: 231508, sha256: null },
    ],
  },
};

/**
 * Get registry entry by key. Returns null if not found.
 */
export function getModelEntry(key) {
  return MODEL_REGISTRY[key] || null;
}

/**
 * Truthy env-flag parser. Matches the conventions used across the codebase:
 *   "1" / "true" / "on" / "yes" (case-insensitive) → true
 *   anything else / unset                           → false
 */
function isEnvTruthy(name) {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/**
 * Check whether an opt-in model should be included given the current
 * environment. Opt-in entries declare a list of env vars; if ANY is
 * truthy, the model is pulled in. Entries without `optIn` are always
 * considered enabled (standard models).
 */
export function isModelEnabled(entry) {
  if (!entry?.optIn) return true;
  const vars = entry.optIn.envVars ?? [];
  return vars.some((v) => isEnvTruthy(v));
}

/**
 * Get all model keys for a given profile, excluding opt-in models
 * whose enabling env vars are unset.
 *
 * Currently-skipped-by-default models (since 2026-04-22 ranking refactor):
 *   - gte-reranker-modernbert-base  — needs SWEET_SEARCH_ENABLE_LOCAL_RERANKER=1
 *   - ms-marco-tinybert             — needs SWEET_SEARCH_CASCADE_ENABLED=1
 *                                      or SWEET_SEARCH_CASCADE_SHADOW=1
 *
 * This matches the runtime behavior: the ranking config defaults to
 * these rerankers OFF, so init shouldn't fetch their ~155 MB of weights
 * for no reason. The models stay in the registry (with SHA256 and size)
 * so flipping the opt-in env var on any host fetches them on the next init.
 */
export function getModelsForProfile(profile) {
  return Object.entries(MODEL_REGISTRY)
    .filter(([, entry]) => {
      const inProfile = entry.profile === profile || profile === 'offline-max';
      if (!inProfile) return false;
      return isModelEnabled(entry);
    })
    .map(([key]) => key);
}

/**
 * Get the keys of models currently SKIPPED by `getModelsForProfile(profile)`
 * because their opt-in env vars aren't set. Used by init to print a
 * one-line summary so users know optional models exist without being
 * surprised they weren't installed.
 */
export function getSkippedOptInModels(profile) {
  return Object.entries(MODEL_REGISTRY)
    .filter(([, entry]) => {
      const inProfile = entry.profile === profile || profile === 'offline-max';
      return inProfile && entry.optIn && !isModelEnabled(entry);
    })
    .map(([key, entry]) => ({
      key,
      envVars: entry.optIn.envVars,
      reason: entry.optIn.reason,
    }));
}
