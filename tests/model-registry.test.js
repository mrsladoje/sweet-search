import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, getModelEntry, getModelsForProfile } from '../core/model-registry.js';

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

  it('getModelsForProfile returns full-profile models', () => {
    const full = getModelsForProfile('full');
    expect(full).toContain('lateon-code');
    expect(full).toContain('gte-reranker-modernbert-base');
    expect(full).toContain('coderankembed-int8');
  });

  it('does not include flashrank/tinybert', () => {
    expect(MODEL_REGISTRY['ms-marco-tinybert']).toBeUndefined();
  });
});
