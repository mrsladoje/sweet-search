import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, getModelEntry, getModelsForProfile } from '../../core/infrastructure/model-registry.js';

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
});
