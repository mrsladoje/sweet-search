import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import { execFileSync } from 'child_process';
import { detectIndexerProfile, EMBEDDING_CONFIG } from '../../core/config.js';

const GB = 1_000_000_000;
const GiB = 1024 ** 3;

describe('detectIndexerProfile', () => {
  // --- Apple Silicon tiers ---

  it('high-memory Apple Silicon: batch=64, flush=1, parallelLI=true', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 128 * GiB, isWSL: false, cpuCount: 16 });
    expect(p).toEqual({ batchSize: 64, flushRows: 1, parallelLI: true });
  });

  it('mid-memory Apple Silicon: batch=32, flush=8, parallelLI=true', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 16 * GiB, isWSL: false, cpuCount: 10 });
    expect(p).toEqual({ batchSize: 32, flushRows: 8, parallelLI: true });
  });

  it('low-memory Apple Silicon: batch=16, flush=32, parallelLI=false', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 8 * GiB, isWSL: false, cpuCount: 8 });
    expect(p).toEqual({ batchSize: 16, flushRows: 32, parallelLI: false });
  });

  // --- Realistic os.totalmem() values (OS reserves ~0.5-1 GB) ---

  it('real 16GB Mac (~15.6 GiB reported) lands in mid-memory tier', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 15.6 * GiB, isWSL: false, cpuCount: 10 });
    expect(p).toEqual({ batchSize: 32, flushRows: 8, parallelLI: true });
  });

  it('real 32GB Mac (~31.3 GiB reported) lands in high-memory tier', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 31.3 * GiB, isWSL: false, cpuCount: 12 });
    expect(p).toEqual({ batchSize: 64, flushRows: 1, parallelLI: true });
  });

  // --- x86 / WSL / Windows fallbacks ---

  it('Intel Mac falls back to conservative defaults', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'x64', totalMemBytes: 32 * GiB, isWSL: false, cpuCount: 8 });
    expect(p).toEqual({ batchSize: 1, flushRows: 128, parallelLI: false });
  });

  it('WSL falls back to conservative defaults', () => {
    const p = detectIndexerProfile({ platform: 'linux', arch: 'x64', totalMemBytes: 16 * GiB, isWSL: true, cpuCount: 8 });
    expect(p).toEqual({ batchSize: 1, flushRows: 128, parallelLI: false });
  });

  it('Windows falls back to conservative defaults', () => {
    const p = detectIndexerProfile({ platform: 'win32', arch: 'x64', totalMemBytes: 16 * GiB, isWSL: false, cpuCount: 8 });
    expect(p).toEqual({ batchSize: 1, flushRows: 128, parallelLI: false });
  });

  it('Linux x64 falls back to conservative defaults', () => {
    const p = detectIndexerProfile({ platform: 'linux', arch: 'x64', totalMemBytes: 64 * GiB, isWSL: false, cpuCount: 16 });
    expect(p).toEqual({ batchSize: 1, flushRows: 128, parallelLI: false });
  });

  // --- WSL detection via os.release() ---

  it('detects WSL from os.release() when no overrides given', () => {
    vi.spyOn(os, 'release').mockReturnValue('5.15.153.1-microsoft-standard-WSL2');
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GiB);
    vi.spyOn(os, 'cpus').mockReturnValue(new Array(8));

    const origPlatform = process.platform;
    const origArch = process.arch;
    try {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
      delete process.env.WSL_DISTRO_NAME;

      const p = detectIndexerProfile();
      expect(p).toEqual({ batchSize: 1, flushRows: 128, parallelLI: false });
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
      vi.restoreAllMocks();
    }
  });

  // --- Boundary: 29 GB threshold ---

  it('28.9 GB lands in mid-memory tier', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 28.9 * GB, isWSL: false, cpuCount: 10 });
    expect(p).toEqual({ batchSize: 32, flushRows: 8, parallelLI: true });
  });

  it('29 GB lands in high-memory tier', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 29 * GB, isWSL: false, cpuCount: 10 });
    expect(p).toEqual({ batchSize: 64, flushRows: 1, parallelLI: true });
  });

  // --- parallelLI thresholds ---

  it('parallelLI=false when memory is below 14 GB', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 13 * GB, isWSL: false, cpuCount: 16 });
    expect(p.parallelLI).toBe(false);
  });

  it('parallelLI=false when CPU count is below 8', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 32 * GiB, isWSL: false, cpuCount: 4 });
    expect(p.parallelLI).toBe(false);
  });

  it('parallelLI=true at boundary (14 GB, 8 cores)', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 14 * GB, isWSL: false, cpuCount: 8 });
    expect(p.parallelLI).toBe(true);
  });

  it('parallelLI defaults to Apple Silicon profile only', () => {
    const linux = detectIndexerProfile({ platform: 'linux', arch: 'x64', totalMemBytes: 32 * GiB, isWSL: false, cpuCount: 16 });
    const mac = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 32 * GiB, isWSL: false, cpuCount: 16 });
    expect(linux.parallelLI).toBe(false);
    expect(mac.parallelLI).toBe(true);
  });
});

describe('EMBEDDING_CONFIG getters respect env overrides', () => {
  it('defaults to the local embedding provider', () => {
    expect(EMBEDDING_CONFIG.provider).toBe('local');
  });

  afterEach(() => {
    delete process.env.USE_REMOTE_EMBEDDING;
    delete process.env.SWEET_SEARCH_PROVIDER;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE;
    delete process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS;
    delete process.env.SWEET_SEARCH_PARALLEL_LI;
  });

  it('env var overrides indexerBatchSize regardless of platform', () => {
    process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE = '4';
    expect(EMBEDDING_CONFIG.indexerBatchSize).toBe(4);
  });

  it('env var overrides indexerWriteFlushRows regardless of platform', () => {
    process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS = '256';
    expect(EMBEDDING_CONFIG.indexerWriteFlushRows).toBe(256);
  });

  it('SWEET_SEARCH_PARALLEL_LI=0 forces parallelLateInteraction off', () => {
    process.env.SWEET_SEARCH_PARALLEL_LI = '0';
    expect(EMBEDDING_CONFIG.parallelLateInteraction).toBe(false);
  });

  it('SWEET_SEARCH_PARALLEL_LI=1 forces parallelLateInteraction on', () => {
    process.env.SWEET_SEARCH_PARALLEL_LI = '1';
    expect(EMBEDDING_CONFIG.parallelLateInteraction).toBe(true);
  });

  it('keeps local as the default even when a remote provider is requested without USE_REMOTE_EMBEDDING', () => {
    const script = `
      import('./core/infrastructure/config/embedding.js').then((m) => {
        process.stdout.write(JSON.stringify({
          provider: m.EMBEDDING_CONFIG.provider,
          isRemote: m.EMBEDDING_CONFIG.isRemote
        }));
      });
    `;
    const stdout = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SWEET_SEARCH_PROVIDER: 'voyage',
        USE_REMOTE_EMBEDDING: '0',
        VOYAGEAI_API_KEY: 'test-key',
      },
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.provider).toBe('local');
    expect(parsed.isRemote).toBe(false);
  });

  it('allows remote provider selection when USE_REMOTE_EMBEDDING is enabled', () => {
    const script = `
      import('./core/infrastructure/config/embedding.js').then((m) => {
        process.stdout.write(JSON.stringify({
          provider: m.EMBEDDING_CONFIG.provider,
          isRemote: m.EMBEDDING_CONFIG.isRemote
        }));
      });
    `;
    const stdout = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SWEET_SEARCH_PROVIDER: 'voyage',
        USE_REMOTE_EMBEDDING: '1',
        VOYAGEAI_API_KEY: 'test-key',
      },
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.provider).toBe('voyage');
    expect(parsed.isRemote).toBe(true);
  });
});

describe('EMBEDDING_CONFIG getters use detected profile for local provider', () => {
  afterEach(() => {
    delete process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE;
    delete process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS;
    delete process.env.SWEET_SEARCH_PARALLEL_LI;
  });

  it('getters return platform-detected values when no env override is set', () => {
    // On this machine (darwin arm64, local provider), getters should
    // return detected profile values, not the old hardcoded defaults.
    delete process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE;
    delete process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS;
    delete process.env.SWEET_SEARCH_PARALLEL_LI;

    if (EMBEDDING_CONFIG.provider === 'local') {
      const profile = detectIndexerProfile();
      expect(EMBEDDING_CONFIG.indexerBatchSize).toBe(profile.batchSize);
      expect(EMBEDDING_CONFIG.indexerWriteFlushRows).toBe(profile.flushRows);
      expect(EMBEDDING_CONFIG.parallelLateInteraction).toBe(profile.parallelLI);
    }
  });

  it('env var overrides detected profile even on Apple Silicon', () => {
    process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE = '7';
    process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS = '42';
    process.env.SWEET_SEARCH_PARALLEL_LI = '0';

    expect(EMBEDDING_CONFIG.indexerBatchSize).toBe(7);
    expect(EMBEDDING_CONFIG.indexerWriteFlushRows).toBe(42);
    expect(EMBEDDING_CONFIG.parallelLateInteraction).toBe(false);
  });
});
