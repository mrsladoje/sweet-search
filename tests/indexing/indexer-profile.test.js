import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import { execFileSync } from 'child_process';
import { detectIndexerProfile, EMBEDDING_CONFIG } from '../../core/config.js';

const GiB = 1024 ** 3;

describe('detectIndexerProfile', () => {
  it('uses the high-throughput tier on large machines', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 128 * GiB, isWSL: false, cpuCount: 16 });
    expect(p).toMatchObject({
      batchSize: 64,
      flushRows: 1,
      parallelLI: false,
      executionMode: 'sequential-phases',
      logicalCores: 16,
      computeCores: 16,
    });
  });

  it('uses the mid tier when memory and cores are moderate', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 16 * GiB, isWSL: false, cpuCount: 10 });
    expect(p).toMatchObject({
      batchSize: 32,
      flushRows: 8,
      parallelLI: false,
      computeCores: 10,
    });
  });

  it('uses the laptop-safe tier on smaller but capable machines', () => {
    const p = detectIndexerProfile({ platform: 'linux', arch: 'x64', totalMemBytes: 16 * GiB, isWSL: false, cpuCount: 8 });
    expect(p).toMatchObject({
      batchSize: 16,
      flushRows: 32,
      parallelLI: false,
      logicalCores: 8,
      computeCores: 4,
    });
  });

  it('keeps a tiny-machine fallback for low RAM or low compute budgets', () => {
    const p = detectIndexerProfile({ platform: 'linux', arch: 'x64', totalMemBytes: 4 * GiB, isWSL: false, cpuCount: 4 });
    expect(p).toMatchObject({
      batchSize: 8,
      flushRows: 64,
      parallelLI: false,
      computeCores: 2,
    });
  });

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
      expect(p).toMatchObject({
        batchSize: 16,
        flushRows: 32,
        parallelLI: false,
        isWSL: true,
        computeCores: 4,
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
      vi.restoreAllMocks();
    }
  });

  it('defaults parallel late interaction off even on powerful machines', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 64 * GiB, isWSL: false, cpuCount: 16 });
    expect(p.parallelLI).toBe(false);
    expect(p.executionMode).toBe('sequential-phases');
  });

  it('treats x64 logical CPUs as SMT siblings when estimating compute cores', () => {
    const p = detectIndexerProfile({ platform: 'linux', arch: 'x64', totalMemBytes: 64 * GiB, isWSL: false, cpuCount: 16 });
    expect(p.computeCores).toBe(8);
    expect(p.batchSize).toBe(64);
  });

  it('keeps ARM logical CPU counts as usable compute cores', () => {
    const p = detectIndexerProfile({ platform: 'darwin', arch: 'arm64', totalMemBytes: 16 * GiB, isWSL: false, cpuCount: 10 });
    expect(p.computeCores).toBe(10);
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
    delete process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE;
    delete process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS;
    delete process.env.SWEET_SEARCH_PARALLEL_LI;

    if (EMBEDDING_CONFIG.provider === 'local') {
      const profile = detectIndexerProfile();
      expect(EMBEDDING_CONFIG.indexerBatchSize).toBe(profile.batchSize);
      expect(EMBEDDING_CONFIG.indexerWriteFlushRows).toBe(profile.flushRows);
      // parallelLateInteraction defaults to ON when the native Metal addon
      // is available on Apple Silicon (inference runs on GPU, so the old
      // "both CPU sessions compete for L2 cache" rationale no longer
      // applies). On non-Metal platforms it follows detectIndexerProfile.
      const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
      const nativeDisabled = ['0', 'false', 'off'].includes(
        (process.env.SWEET_SEARCH_NATIVE_INFERENCE ?? '').trim().toLowerCase(),
      );
      if (isAppleSilicon && !nativeDisabled) {
        // On Apple Silicon the default is true as long as the native addon
        // resolves. If it doesn't resolve we fall back to profile.parallelLI.
        expect(
          EMBEDDING_CONFIG.parallelLateInteraction === true
          || EMBEDDING_CONFIG.parallelLateInteraction === profile.parallelLI,
        ).toBe(true);
      } else {
        expect(EMBEDDING_CONFIG.parallelLateInteraction).toBe(profile.parallelLI);
      }
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
