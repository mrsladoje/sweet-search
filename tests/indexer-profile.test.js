import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import { detectIndexerProfile, EMBEDDING_CONFIG } from '../core/config.js';

const GB = 1_000_000_000;
const GiB = 1024 ** 3;

describe('detectIndexerProfile', () => {
  // --- Apple Silicon tiers ---

  it('high-memory Apple Silicon: batch=64, flush=1', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 128 * GiB, isWSL: false });
    expect(p).toEqual({ batchSize: 64, flushRows: 1 });
  });

  it('mid-memory Apple Silicon: batch=32, flush=8', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 16 * GiB, isWSL: false });
    expect(p).toEqual({ batchSize: 32, flushRows: 8 });
  });

  it('low-memory Apple Silicon: batch=16, flush=32', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 8 * GiB, isWSL: false });
    expect(p).toEqual({ batchSize: 16, flushRows: 32 });
  });

  // --- Realistic os.totalmem() values (OS reserves ~0.5-1 GB) ---

  it('real 16GB Mac (~15.6 GiB reported) lands in mid-memory tier', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 15.6 * GiB, isWSL: false });
    expect(p).toEqual({ batchSize: 32, flushRows: 8 });
  });

  it('real 32GB Mac (~31.3 GiB reported) lands in high-memory tier', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 31.3 * GiB, isWSL: false });
    expect(p).toEqual({ batchSize: 64, flushRows: 1 });
  });

  // --- x86 / WSL / Windows fallbacks ---

  it('Intel Mac falls back to conservative defaults', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'x64', totalMemBytes: 32 * GiB, isWSL: false });
    expect(p).toEqual({ batchSize: 1, flushRows: 128 });
  });

  it('WSL falls back to conservative defaults', () => {
    const p = detectIndexerProfile({ platform: 'linux', arch: 'x64', totalMemBytes: 16 * GiB, isWSL: true });
    expect(p).toEqual({ batchSize: 1, flushRows: 128 });
  });

  it('Windows falls back to conservative defaults', () => {
    const p = detectIndexerProfile({ platform: 'win32', arch: 'x64', totalMemBytes: 16 * GiB, isWSL: false });
    expect(p).toEqual({ batchSize: 1, flushRows: 128 });
  });

  it('Linux x64 falls back to conservative defaults', () => {
    const p = detectIndexerProfile({ platform: 'linux', arch: 'x64', totalMemBytes: 64 * GiB, isWSL: false });
    expect(p).toEqual({ batchSize: 1, flushRows: 128 });
  });

  // --- WSL detection via os.release() ---

  it('detects WSL from os.release() when no overrides given', () => {
    vi.spyOn(os, 'release').mockReturnValue('5.15.153.1-microsoft-standard-WSL2');
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GiB);

    const origPlatform = process.platform;
    const origArch = process.arch;
    try {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
      delete process.env.WSL_DISTRO_NAME;

      const p = detectIndexerProfile();
      expect(p).toEqual({ batchSize: 1, flushRows: 128 });
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
      vi.restoreAllMocks();
    }
  });

  // --- Boundary: 29 GB threshold ---

  it('28.9 GB lands in mid-memory tier', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 28.9 * GB, isWSL: false });
    expect(p).toEqual({ batchSize: 32, flushRows: 8 });
  });

  it('29 GB lands in high-memory tier', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 29 * GB, isWSL: false });
    expect(p).toEqual({ batchSize: 64, flushRows: 1 });
  });
});

describe('EMBEDDING_CONFIG getters respect env overrides', () => {
  afterEach(() => {
    delete process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE;
    delete process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS;
  });

  it('env var overrides indexerBatchSize regardless of platform', () => {
    process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE = '4';
    expect(EMBEDDING_CONFIG.indexerBatchSize).toBe(4);
  });

  it('env var overrides indexerWriteFlushRows regardless of platform', () => {
    process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS = '256';
    expect(EMBEDDING_CONFIG.indexerWriteFlushRows).toBe(256);
  });
});

describe('EMBEDDING_CONFIG getters use detected profile for local provider', () => {
  afterEach(() => {
    delete process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE;
    delete process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS;
  });

  it('getters return platform-detected values when no env override is set', () => {
    // On this machine (darwin arm64, local provider), getters should
    // return detected profile values, not the old hardcoded defaults.
    delete process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE;
    delete process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS;

    if (EMBEDDING_CONFIG.provider === 'local') {
      const profile = detectIndexerProfile();
      expect(EMBEDDING_CONFIG.indexerBatchSize).toBe(profile.batchSize);
      expect(EMBEDDING_CONFIG.indexerWriteFlushRows).toBe(profile.flushRows);
    }
  });

  it('env var overrides detected profile even on Apple Silicon', () => {
    process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE = '7';
    process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS = '42';

    expect(EMBEDDING_CONFIG.indexerBatchSize).toBe(7);
    expect(EMBEDDING_CONFIG.indexerWriteFlushRows).toBe(42);
  });
});
