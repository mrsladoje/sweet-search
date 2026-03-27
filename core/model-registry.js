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
    description: 'Local reranker (INT8 quantized)',
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
      { path: 'onnx/model.onnx', sizeBytes: 138619279, sha256: 'd44183a39a3e27bc2ef80aebeba48e8065556f2911c12211ab9f6ed94f2f26ee' },
      { path: 'tokenizer.json', sizeBytes: 711649, sha256: null },
      { path: 'tokenizer_config.json', sizeBytes: 1447, sha256: null },
      { path: 'special_tokens_map.json', sizeBytes: 695, sha256: null },
      { path: 'config.json', sizeBytes: 1371, sha256: null },
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
 * Get all model keys for a given profile.
 */
export function getModelsForProfile(profile) {
  return Object.entries(MODEL_REGISTRY)
    .filter(([, entry]) => entry.profile === profile || profile === 'offline-max')
    .map(([key]) => key);
}
