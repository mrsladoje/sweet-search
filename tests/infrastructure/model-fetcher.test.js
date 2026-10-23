import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeFileHash, isCacheValid, fetchModelFile, createProgressLine } from '../../core/infrastructure/model-fetcher.js';
import { MODEL_DELIVERY_CONFIG } from '../../core/config.js';

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

    it('offline mode still returns a valid cached file', async () => {
      const prev = process.env.SWEET_SEARCH_OFFLINE;
      process.env.SWEET_SEARCH_OFFLINE = '1';
      try {
        await withTmpDir(async (dir) => {
          const filePath = join(dir, 'model.onnx');
          writeFileSync(filePath, 'fake-model-data');
          const result = await fetchModelFile('test/repo', 'model.onnx', dir, {
            expectedSize: 15,
          });
          expect(result).toBe(filePath);
        });
      } finally {
        if (prev === undefined) delete process.env.SWEET_SEARCH_OFFLINE;
        else process.env.SWEET_SEARCH_OFFLINE = prev;
      }
    });

    it('offline mode fails fast on a missing file even when downloads are allowed', async () => {
      const prev = process.env.SWEET_SEARCH_OFFLINE;
      process.env.SWEET_SEARCH_OFFLINE = '1';
      originalAllowDownload = MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload;
      MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload = true;
      try {
        await withTmpDir(async (dir) => {
          await expect(
            fetchModelFile('test/repo', 'missing.onnx', dir)
          ).rejects.toThrow('SWEET_SEARCH_OFFLINE');
        });
      } finally {
        if (prev === undefined) delete process.env.SWEET_SEARCH_OFFLINE;
        else process.env.SWEET_SEARCH_OFFLINE = prev;
      }
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

describe('model cache write errors', () => {
  it('turns an unwritable cache into a message that names the fix', async () => {
    const { modelCacheWriteError } = await import('../../core/infrastructure/model-fetcher.js');
    const cause = Object.assign(new Error("EPERM: operation not permitted, mkdir '/x'"), { code: 'EPERM' });
    const err = modelCacheWriteError(cause, '/home/u/.cache/sweet-search/models');
    expect(err.message).toMatch(/Cannot write the model cache at \/home\/u\/\.cache\/sweet-search\/models \(EPERM\)/);
    expect(err.message).toMatch(/SWEET_SEARCH_MODEL_CACHE/);
    expect(err.code).toBe('EPERM');
    expect(err.cause).toBe(cause);
  });

  it('passes other errors through unchanged', async () => {
    const { modelCacheWriteError } = await import('../../core/infrastructure/model-fetcher.js');
    const other = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    expect(modelCacheWriteError(other, '/c')).toBe(other);
  });
});

describe('ORT graph cache directory', () => {
  it('falls back to the temp dir when ~/.cache cannot be written', async () => {
    const { getOrtGraphCacheDir, _resetOrtGraphCacheDir } = await import('../../core/infrastructure/onnx-session-utils.js');
    _resetOrtGraphCacheDir();
    const made = [];
    const mkdir = (dir) => {
      if (dir.startsWith('/home/u')) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      made.push(dir);
    };
    expect(getOrtGraphCacheDir({ homeDir: '/home/u', tmpDir: '/tmp/x', mkdir })).toBe('/tmp/x/sweet-search-cache');
    expect(made).toEqual(['/tmp/x/sweet-search-cache']);
    _resetOrtGraphCacheDir();
  });

  it('rethrows errors that are not about permissions', async () => {
    const { getOrtGraphCacheDir, _resetOrtGraphCacheDir } = await import('../../core/infrastructure/onnx-session-utils.js');
    _resetOrtGraphCacheDir();
    const mkdir = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    expect(() => getOrtGraphCacheDir({ homeDir: '/home/u', tmpDir: '/tmp/x', mkdir })).toThrow('disk full');
    _resetOrtGraphCacheDir();
  });
});

// A local stand-in for the HuggingFace resolve endpoint. `handler(req, res, body)`
// decides each response; serveRange() answers a normal or Range request.
async function withServer(handler, fn) {
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function serveRange(req, res, body) {
  const match = /bytes=(\d+)-/.exec(req.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  res.writeHead(match ? 206 : 200, { 'content-length': body.length - start });
  res.end(body.subarray(start));
}

describe('fetchModelFile downloads', () => {
  const body = Buffer.alloc(256 * 1024, 7);
  const sha256 = createHash('sha256').update(body).digest('hex');

  afterEach(() => vi.restoreAllMocks());

  it('downloads, verifies and renames the file', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await withTmpDir(async (dir) => {
      await withServer((req, res) => serveRange(req, res, body), async (endpoint) => {
        const path = await fetchModelFile('test/repo', 'model.bin', dir, {
          sha256, expectedSize: body.length, hfEndpoint: endpoint, allowDownload: true,
        });
        expect(readFileSync(path).equals(body)).toBe(true);
        expect(existsSync(`${path}.tmp`)).toBe(false);
      });
    });
  });

  it('aborts a stalled transfer and resumes from the bytes on disk', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const ranges = [];
    let requests = 0;
    const handler = (req, res) => {
      ranges.push(req.headers.range || null);
      if (++requests === 1) {
        // Send the first half, then go silent without closing the socket.
        res.writeHead(200, { 'content-length': body.length });
        res.write(body.subarray(0, body.length / 2));
        return;
      }
      serveRange(req, res, body);
    };
    await withTmpDir(async (dir) => {
      await withServer(handler, async (endpoint) => {
        const path = await fetchModelFile('test/repo', 'model.bin', dir, {
          sha256, expectedSize: body.length, hfEndpoint: endpoint, allowDownload: true,
          stallTimeoutMs: 300,
        });
        expect(readFileSync(path).equals(body)).toBe(true);
      });
    });
    expect(ranges).toEqual([null, `bytes=${body.length / 2}-`]);
  });

  it('keeps the partial file after the last failed attempt', async () => {
    const writes = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { writes.push(String(s)); return true; });
    await withTmpDir(async (dir) => {
      writeFileSync(join(dir, 'model.bin.tmp'), body.subarray(0, 1024));
      await withServer((req, res) => { res.writeHead(503); res.end(); }, async (endpoint) => {
        await expect(fetchModelFile('test/repo', 'model.bin', dir, {
          sha256, expectedSize: body.length, hfEndpoint: endpoint, allowDownload: true,
        })).rejects.toThrow(/after 3 attempts: HTTP 503.*kept; run `sweet-search init` again to resume/);
      });
      expect(readFileSync(join(dir, 'model.bin.tmp')).length).toBe(1024);
    });
  }, 15000);
});

describe('createProgressLine', () => {
  function fakeStream(isTTY) {
    const out = [];
    return { out, stream: { isTTY, write: (s) => { out.push(s); return true; } } };
  }

  it('redraws one line in place on a terminal', () => {
    const { out, stream } = fakeStream(true);
    let t = 0;
    const line = createProgressLine('[ModelFetcher] Downloading a.bin from x/y...', { stream, now: () => t });
    for (let i = 1; i <= 10; i++) {
      t = i * 1000;
      line.update(i * 1024 * 1024, 10 * 1024 * 1024);
    }
    line.finish('10.0 MB');
    const text = out.join('');
    // One newline only, at the very end: every redraw returns to column 0.
    expect(text.indexOf('\n')).toBe(text.length - 1);
    expect(out.filter((s) => s.startsWith('\r')).length).toBe(11);
    expect(out[5]).toBe('\r[ModelFetcher] Downloading a.bin from x/y... 5.0 / 10.0 MB (50%), 0.8 MB/s, 7 s left\x1b[K');
  });

  it('limits redraws to one per 200 ms', () => {
    const { out, stream } = fakeStream(true);
    let t = 0;
    const line = createProgressLine('L', { stream, now: () => t });
    for (let i = 1; i <= 100; i++) {
      t = i * 10;
      line.update(i, 100);
    }
    expect(out.length).toBe(1 + 5);
  });

  it('prints the label and final size only when not a terminal', () => {
    const { out, stream } = fakeStream(false);
    const line = createProgressLine('L', { stream });
    line.update(1, 2);
    line.update(2, 2);
    line.finish('0.0 MB');
    expect(out).toEqual(['L', ' 0.0 MB\n']);
  });
});
