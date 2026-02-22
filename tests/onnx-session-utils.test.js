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
  loadModelWithSessionOptions,
  warnIfGraphNotMaterialized,
} = await import('../core/onnx-session-utils.js');

const { existsSync, readFileSync } = await import('fs');

describe('onnx-session-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSync.mockReturnValue(JSON.stringify({ version: '1.20.0' }));
  });

  describe('getOnnxRuntimeVersion', () => {
    it('returns version string from onnxruntime-node package.json', () => {
      const version = getOnnxRuntimeVersion();
      expect(typeof version).toBe('string');
      expect(version).toBe('1.20.0');
    });

    it('returns "unknown" when package.json is missing', () => {
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
      const cores = os.cpus().length;
      const expected = Math.min(8, Math.max(2, Math.ceil(cores / 2)));
      const opts = buildSessionOptions('model', 'test');
      expect(opts.intraOpNumThreads).toBe(expected);
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

  describe('loadModelWithSessionOptions', () => {
    it('tries candidates in order and returns first success', async () => {
      const loader = vi.fn(async (opts) => {
        if (opts.session_options) return 'loaded-with-session_options';
        throw new Error('wrong shape');
      });
      const result = await loadModelWithSessionOptions(loader, { quantized: true }, { graphOpt: 'all' });
      expect(result).toBe('loaded-with-session_options');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('falls through to second candidate on first error', async () => {
      const loader = vi.fn(async (opts) => {
        if (opts.session_options) throw new Error('old API');
        if (opts.sessionOptions) return 'loaded-with-sessionOptions';
        throw new Error('nope');
      });
      const result = await loadModelWithSessionOptions(loader, { quantized: true }, { graphOpt: 'all' });
      expect(result).toBe('loaded-with-sessionOptions');
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('falls through to bare options on all errors', async () => {
      const loader = vi.fn(async (opts) => {
        if (opts.session_options || opts.sessionOptions) throw new Error('no session opts');
        return 'loaded-bare';
      });
      const result = await loadModelWithSessionOptions(loader, { quantized: true }, { graphOpt: 'all' });
      expect(result).toBe('loaded-bare');
      expect(loader).toHaveBeenCalledTimes(3);
    });

    it('throws on all-fail', async () => {
      const loader = vi.fn(async () => { throw new Error('always fails'); });
      await expect(loadModelWithSessionOptions(loader, {}, {})).rejects.toThrow('always fails');
      expect(loader).toHaveBeenCalledTimes(3);
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
