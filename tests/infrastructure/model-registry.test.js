import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, getModelEntry, getModelsForProfile, isNativeAcceleratedModel } from '../../core/infrastructure/model-registry.js';

describe('model-registry', () => {
  it('every model has required fields', () => {
    for (const [key, entry] of Object.entries(MODEL_REGISTRY)) {
      expect(entry.hfId, `${key} missing hfId`).toBeTruthy();
      expect(entry.profile, `${key} missing profile`).toBeTruthy();
      expect(Array.isArray(entry.files), `${key} files is not an array`).toBe(true);
      expect(entry.files.length, `${key} has no files`).toBeGreaterThan(0);
    }
  });

  it('every file entry has path and sizeBytes', () => {
    for (const [key, entry] of Object.entries(MODEL_REGISTRY)) {
      for (const file of entry.files) {
        expect(file.path, `${key} file missing path`).toBeTruthy();
        expect(typeof file.sizeBytes, `${key}/${file.path} sizeBytes is not a number`).toBe('number');
        expect(file.sizeBytes, `${key}/${file.path} sizeBytes is zero`).toBeGreaterThan(0);
      }
    }
  });

  it('LFS files (ONNX models, safetensors) have sha256 checksums', () => {
    const lfsExtensions = ['.onnx', '.safetensors'];
    for (const [key, entry] of Object.entries(MODEL_REGISTRY)) {
      for (const file of entry.files) {
        if (lfsExtensions.some(ext => file.path.endsWith(ext))) {
          expect(file.sha256, `${key}/${file.path} missing sha256`).toBeTruthy();
          expect(file.sha256.length, `${key}/${file.path} sha256 wrong length`).toBe(64);
        }
      }
    }
  });

  it('getModelEntry returns entry or null', () => {
    expect(getModelEntry('lateon-code')).toBeTruthy();
    expect(getModelEntry('nonexistent')).toBeNull();
  });

  it('getModelsForProfile returns core full-profile models by default', () => {
    // Clear any opt-in env vars so we see the real default
    const saved = {
      local: process.env.SWEET_SEARCH_ENABLE_LOCAL_RERANKER,
      cascade: process.env.SWEET_SEARCH_CASCADE_ENABLED,
      shadow: process.env.SWEET_SEARCH_CASCADE_SHADOW,
    };
    delete process.env.SWEET_SEARCH_ENABLE_LOCAL_RERANKER;
    delete process.env.SWEET_SEARCH_CASCADE_ENABLED;
    delete process.env.SWEET_SEARCH_CASCADE_SHADOW;
    try {
      const full = getModelsForProfile('full');
      expect(full).toContain('lateon-code');
      expect(full).toContain('coderankembed-int8');
      expect(full).toContain('coderankembed-fp32');
      expect(full).toContain('lateon-code-fp32');
      expect(full).toContain('lateon-code-edge');
      expect(full).toContain('all-minilm-l6-v2');
      // Opt-in rerankers MUST be excluded by default (disabled since
      // commit 43a61eb — MRR-neutral at 3× latency cost).
      expect(full).not.toContain('gte-reranker-modernbert-base');
      expect(full).not.toContain('ms-marco-tinybert');
    } finally {
      if (saved.local !== undefined) process.env.SWEET_SEARCH_ENABLE_LOCAL_RERANKER = saved.local;
      if (saved.cascade !== undefined) process.env.SWEET_SEARCH_CASCADE_ENABLED = saved.cascade;
      if (saved.shadow !== undefined) process.env.SWEET_SEARCH_CASCADE_SHADOW = saved.shadow;
    }
  });

  it('getModelsForProfile includes opt-in rerankers when env flags are set', () => {
    const savedLocal = process.env.SWEET_SEARCH_ENABLE_LOCAL_RERANKER;
    const savedCascade = process.env.SWEET_SEARCH_CASCADE_ENABLED;
    process.env.SWEET_SEARCH_ENABLE_LOCAL_RERANKER = '1';
    process.env.SWEET_SEARCH_CASCADE_ENABLED = 'true';
    try {
      const full = getModelsForProfile('full');
      expect(full).toContain('gte-reranker-modernbert-base');
      expect(full).toContain('ms-marco-tinybert');
    } finally {
      if (savedLocal === undefined) delete process.env.SWEET_SEARCH_ENABLE_LOCAL_RERANKER;
      else process.env.SWEET_SEARCH_ENABLE_LOCAL_RERANKER = savedLocal;
      if (savedCascade === undefined) delete process.env.SWEET_SEARCH_CASCADE_ENABLED;
      else process.env.SWEET_SEARCH_CASCADE_ENABLED = savedCascade;
    }
  });

  it('registry still includes opt-in rerankers even when skipped by default', () => {
    // The entries stay in the registry so `fetchModel(key)` works when
    // a user explicitly opts in — only `getModelsForProfile` filters.
    expect(MODEL_REGISTRY['ms-marco-tinybert']).toBeDefined();
    expect(MODEL_REGISTRY['ms-marco-tinybert'].hfId).toBe('Xenova/ms-marco-TinyBERT-L-2-v2');
    expect(MODEL_REGISTRY['gte-reranker-modernbert-base']).toBeDefined();
    expect(MODEL_REGISTRY['all-minilm-l6-v2']).toBeDefined();
    expect(MODEL_REGISTRY['all-minilm-l6-v2'].hfId).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('lateon-code-edge-fp32 entry is well-formed for native edge inference', () => {
    // The native (Metal/CoreML/CUDA) loader fetches this entry when
    // SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge. It MUST
    // ship the FP32 safetensors backbone + both projection stages.
    const entry = MODEL_REGISTRY['lateon-code-edge-fp32'];
    expect(entry).toBeDefined();
    expect(entry.hfId).toBe('lightonai/LateOn-Code-edge');
    expect(entry.profile).toBe('full');

    const paths = entry.files.map(f => f.path);
    expect(paths).toContain('model.safetensors');         // FP32 backbone
    expect(paths).toContain('1_Dense/model.safetensors'); // first projection stage
    expect(paths).toContain('2_Dense/model.safetensors'); // second projection stage
    expect(paths).toContain('config.json');

    // Every safetensors entry must have a SHA — without it, `fetchModel`
    // would skip checksum verification and a corrupt download could
    // ship to a user undetected. The non-LFS config.json is allowed to
    // omit sha256 (caught by the broader test above).
    for (const f of entry.files) {
      if (f.path.endsWith('.safetensors')) {
        expect(f.sha256, `lateon-code-edge-fp32 ${f.path} missing sha256`).toBeTruthy();
      }
    }
  });

  // ── Native-accelerated classification (CPU-only fetch gating) ──

  it('marks exactly the native FP32 safetensors as nativeAccelerated', () => {
    // Loaded only by the candle/native accelerated path (Metal/CoreML/CUDA);
    // CPU-only hosts skip these at init.
    expect(isNativeAcceleratedModel('coderankembed-fp32')).toBe(true);
    expect(isNativeAcceleratedModel('lateon-code-fp32')).toBe(true);
    expect(isNativeAcceleratedModel('lateon-code-edge-fp32')).toBe(true);
  });

  it('does NOT mark ORT / query / cache / reranker models as nativeAccelerated', () => {
    expect(isNativeAcceleratedModel('coderankembed-int8')).toBe(false);
    expect(isNativeAcceleratedModel('lateon-code')).toBe(false);
    expect(isNativeAcceleratedModel('lateon-code-edge')).toBe(false);
    expect(isNativeAcceleratedModel('all-minilm-l6-v2')).toBe(false);
    expect(isNativeAcceleratedModel('gte-reranker-modernbert-base')).toBe(false);
    expect(isNativeAcceleratedModel('ms-marco-tinybert')).toBe(false);
  });

  it('returns false for unknown / missing keys', () => {
    expect(isNativeAcceleratedModel('nonexistent')).toBe(false);
    expect(isNativeAcceleratedModel(undefined)).toBe(false);
  });

  it('nativeAccelerated keys are exactly the *-fp32 safetensors family', () => {
    // Guards against a future FP32 entry being added without the marker,
    // which would re-introduce the CPU-only over-fetch bug.
    const marked = Object.keys(MODEL_REGISTRY).filter((k) => isNativeAcceleratedModel(k));
    expect(marked.sort()).toEqual(
      ['coderankembed-fp32', 'lateon-code-edge-fp32', 'lateon-code-fp32'].sort(),
    );
  });
});
