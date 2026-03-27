import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeFileHash, isCacheValid, fetchModelFile } from '../core/model-fetcher.js';
import { MODEL_DELIVERY_CONFIG } from '../core/config.js';

async function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sweet-search-fetcher-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('model-fetcher', () => {
  describe('computeFileHash', () => {
    it('computes correct SHA256 for known content', async () => {
      await withTmpDir(async (dir) => {
        const file = join(dir, 'test.txt');
        writeFileSync(file, 'hello world');
        const hash = await computeFileHash(file);
        // echo -n "hello world" | shasum -a 256
        expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
      });
    });
  });

  describe('isCacheValid', () => {
    it('returns false for missing file', async () => {
      expect(await isCacheValid('/tmp/nonexistent-sweet-search-test', null, null)).toBe(false);
    });

    it('returns false for empty file', async () => {
      await withTmpDir(async (dir) => {
        const file = join(dir, 'empty');
        writeFileSync(file, '');
        expect(await isCacheValid(file, null, null)).toBe(false);
      });
    });

    it('returns true for file with matching size', async () => {
      await withTmpDir(async (dir) => {
        const file = join(dir, 'data');
        writeFileSync(file, 'abc');
        expect(await isCacheValid(file, 3, null)).toBe(true);
      });
    });

    it('returns false for file with wrong size', async () => {
      await withTmpDir(async (dir) => {
        const file = join(dir, 'data');
        writeFileSync(file, 'abc');
        expect(await isCacheValid(file, 999, null)).toBe(false);
      });
    });

    it('returns true for file with matching checksum', async () => {
      await withTmpDir(async (dir) => {
        const file = join(dir, 'data');
        writeFileSync(file, 'hello world');
        expect(await isCacheValid(file, 11, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')).toBe(true);
      });
    });

    it('returns false for file with wrong checksum', async () => {
      await withTmpDir(async (dir) => {
        const file = join(dir, 'data');
        writeFileSync(file, 'hello world');
        expect(await isCacheValid(file, 11, '0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
      });
    });
  });

  describe('fetchModelFile', () => {
    let originalAllowDownload;

    afterEach(() => {
      // Restore original config
      if (originalAllowDownload !== undefined) {
        MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload = originalAllowDownload;
        originalAllowDownload = undefined;
      }
    });

    it('returns cached file without downloading when cache is valid', async () => {
      await withTmpDir(async (dir) => {
        // Pre-populate a cached file
        const filePath = join(dir, 'model.onnx');
        writeFileSync(filePath, 'fake-model-data');
        const result = await fetchModelFile('test/repo', 'model.onnx', dir, {
          expectedSize: 15,
        });
        expect(result).toBe(filePath);
      });
    });

    it('throws when allowRuntimeModelDownload=false and file is missing', async () => {
      originalAllowDownload = MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload;
      MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload = false;

      await withTmpDir(async (dir) => {
        await expect(
          fetchModelFile('test/repo', 'missing.onnx', dir)
        ).rejects.toThrow('Runtime model downloads are disabled');
      });
    });

    it('error message includes sweet-search init when download blocked', async () => {
      originalAllowDownload = MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload;
      MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload = false;

      await withTmpDir(async (dir) => {
        await expect(
          fetchModelFile('test/repo', 'missing.onnx', dir)
        ).rejects.toThrow('sweet-search init');
      });
    });

    it('preserves directory structure in cache path', async () => {
      await withTmpDir(async (dir) => {
        // Pre-populate with nested path
        const nestedDir = join(dir, 'onnx');
        const { mkdirSync } = await import('fs');
        mkdirSync(nestedDir, { recursive: true });
        writeFileSync(join(nestedDir, 'model.onnx'), 'data');

        const result = await fetchModelFile('test/repo', 'onnx/model.onnx', dir, {
          expectedSize: 4,
        });
        // Should preserve onnx/ subdirectory, not flatten to onnx--model.onnx
        expect(result).toBe(join(dir, 'onnx', 'model.onnx'));
      });
    });
  });
});
