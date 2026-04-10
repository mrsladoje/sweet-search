import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';

// Mock fs (for readFileSync, existsSync, mkdirSync used by the module)
vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => JSON.stringify({ version: '1.20.0' })),
  };
});

const {
  getOnnxRuntimeVersion,
  getOptimizedGraphPath,
  buildSessionOptions,
  warnIfGraphNotMaterialized,
} = await import('../../core/infrastructure/index.js');

const { existsSync, readFileSync } = await import('fs');

describe('onnx-session-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ version: '1.20.0' }));
  });

  describe('getOnnxRuntimeVersion', () => {
    it('returns version string from onnxruntime-node package.json', () => {
      const version = getOnnxRuntimeVersion();
      expect(typeof version).toBe('string');
      expect(version).toBe('1.20.0');
    });

    it('returns "unknown" when package.json is missing', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      expect(getOnnxRuntimeVersion()).toBe('unknown');
    });
  });

  describe('getOptimizedGraphPath', () => {
    it('produces deterministic path with hash', () => {
      const path1 = getOptimizedGraphPath('model-a:dtype', 'flashrank');
      const path2 = getOptimizedGraphPath('model-a:dtype', 'flashrank');
      expect(path1).toBe(path2);
    });

    it('varies by modelId', () => {
      const path1 = getOptimizedGraphPath('model-a', 'flashrank');
      const path2 = getOptimizedGraphPath('model-b', 'flashrank');
      expect(path1).not.toBe(path2);
    });

    it('varies by suffix', () => {
      const path1 = getOptimizedGraphPath('model-a', 'flashrank');
      const path2 = getOptimizedGraphPath('model-a', 'local-reranker');
      expect(path1).not.toBe(path2);
    });

    it('includes ORT version in filename', () => {
      const result = getOptimizedGraphPath('model-a', 'flashrank');
      expect(result).toContain('ort1.20.0');
    });

    it('uses homedir cache path', () => {
      const result = getOptimizedGraphPath('model-a', 'flashrank');
      expect(result).toContain(path.join(os.homedir(), '.cache', 'sweet-search'));
    });
  });

  describe('buildSessionOptions', () => {
    it('sets correct thread counts based on CPU cores', () => {
      const opts = buildSessionOptions('model', 'test');
      // intraOpNumThreads uses bestIntraOpThreads() — verify it's a positive integer
      expect(opts.intraOpNumThreads).toBeGreaterThan(0);
      expect(opts.intraOpNumThreads).toBeLessThanOrEqual(os.cpus().length);
      expect(opts.interOpNumThreads).toBe(1);
    });

    it('sets all expected fields', () => {
      const opts = buildSessionOptions('model', 'test');
      expect(opts.graphOptimizationLevel).toBe('all');
      expect(opts.executionMode).toBe('parallel');
      expect(opts.enableCpuMemArena).toBe(true);
      expect(opts.enableMemPattern).toBe(true);
      expect(typeof opts.optimizedModelFilePath).toBe('string');
    });
  });

  describe('warnIfGraphNotMaterialized', () => {
    it('warns when file missing', () => {
      existsSync.mockReturnValue(false);
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      warnIfGraphNotMaterialized('FlashRank', { optimizedModelFilePath: '/tmp/test.onnx' });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('FlashRank'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('/tmp/test.onnx'));
      spy.mockRestore();
    });

    it('stays silent when file present', () => {
      existsSync.mockReturnValue(true);
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      warnIfGraphNotMaterialized('FlashRank', { optimizedModelFilePath: '/tmp/test.onnx' });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
