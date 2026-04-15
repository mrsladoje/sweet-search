/**
 * Decompression-bomb guard tests for `extractVariantTarball` (2026-04-15).
 *
 * The cascade tarballs are fetched from an HF repo, verified against a
 * SHA256 pinned in `coreml-cascade.json`, and then extracted via
 * `tar -xzf`. The SHA256 check validates the COMPRESSED bytes — it does
 * not bound the extracted size. A malicious tarball (requires an HF repo
 * compromise, which is the H2 security finding) with a high compression
 * ratio could fill the disk before the "exactly one top-level entry"
 * check runs.
 *
 * The `auditTarballExtractedSize` pre-flight reads the tarball's
 * `tar -tzvf` listing, sums the declared sizes, and refuses to extract
 * if the total exceeds `maxExtractBytes`. This test exercises both the
 * happy path (legitimate content under the cap) and the rejection path
 * (a tarball that would exceed the cap).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { _testInternals } from '../../core/infrastructure/coreml-cascade.js';

const { auditTarballExtractedSize, extractVariantTarball } = _testInternals;

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cascade-tarball-'));
}

function makeTarball(srcDir, outPath) {
  const result = spawnSync(
    'tar',
    ['-czf', outPath, '-C', path.dirname(srcDir), path.basename(srcDir)],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (result.status !== 0) {
    throw new Error(`test helper tar failed: ${result.stderr?.toString()}`);
  }
}

describe('cascade tarball decompression-bomb guard', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkTmp();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('auditTarballExtractedSize returns total declared size for a legitimate tarball', async () => {
    const srcDir = path.join(tmpDir, 'fake.mlpackage');
    await fs.mkdir(srcDir, { recursive: true });
    // Two files of known size
    await fs.writeFile(path.join(srcDir, 'Manifest.json'), 'x'.repeat(1024));
    await fs.mkdir(path.join(srcDir, 'Data'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'Data', 'weights.bin'), 'y'.repeat(4096));

    const tarballPath = path.join(tmpDir, 'fake.tar.gz');
    makeTarball(srcDir, tarballPath);

    // Total declared size should be at least 1024 + 4096 = 5120 bytes
    const total = auditTarballExtractedSize(tarballPath, 100 * 1024 * 1024);
    expect(total).toBeGreaterThanOrEqual(5120);
  });

  it('throws when declared extracted size exceeds the cap', async () => {
    const srcDir = path.join(tmpDir, 'big.mlpackage');
    await fs.mkdir(srcDir, { recursive: true });
    // 100 KB content — use a repetitive pattern so gzip compresses it heavily
    await fs.writeFile(path.join(srcDir, 'data.bin'), 'A'.repeat(100 * 1024));

    const tarballPath = path.join(tmpDir, 'big.tar.gz');
    makeTarball(srcDir, tarballPath);

    // Cap at 50 KB — below the ~100 KB declared size
    expect(() => auditTarballExtractedSize(tarballPath, 50 * 1024)).toThrow(
      /decompression bomb guard/
    );
  });

  it('extractVariantTarball refuses a tarball that exceeds maxExtractBytes', async () => {
    const srcDir = path.join(tmpDir, 'bomb.mlpackage');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'Manifest.json'), 'm');
    await fs.mkdir(path.join(srcDir, 'Data'), { recursive: true });
    // Highly-compressible 500 KB payload (zeros compress to ~kB)
    await fs.writeFile(
      path.join(srcDir, 'Data', 'payload.bin'),
      Buffer.alloc(500 * 1024)
    );

    const tarballPath = path.join(tmpDir, 'bomb.tar.gz');
    makeTarball(srcDir, tarballPath);

    const extractTarget = path.join(tmpDir, 'target.mlpackage');

    // Cap at 100 KB — below the 500 KB declared size.
    expect(() =>
      extractVariantTarball(tarballPath, extractTarget, { maxExtractBytes: 100 * 1024 })
    ).toThrow(/decompression bomb guard/);

    // The target must NOT exist — we rejected before any tar -xzf ran.
    expect(existsSync(extractTarget)).toBe(false);
  });

  it('extractVariantTarball happy path still works with a generous cap', async () => {
    const srcDir = path.join(tmpDir, 'legit.mlpackage');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'Manifest.json'), '{"ok":true}');
    await fs.mkdir(path.join(srcDir, 'Data'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'Data', 'tiny.bin'), 'hello');

    const tarballPath = path.join(tmpDir, 'legit.tar.gz');
    makeTarball(srcDir, tarballPath);

    const extractTarget = path.join(tmpDir, 'target.mlpackage');

    extractVariantTarball(tarballPath, extractTarget, {
      maxExtractBytes: 100 * 1024 * 1024, // 100 MB — far above real content
    });

    expect(existsSync(extractTarget)).toBe(true);
    expect(existsSync(path.join(extractTarget, 'Manifest.json'))).toBe(true);
    expect(existsSync(path.join(extractTarget, 'Data', 'tiny.bin'))).toBe(true);
  });

  it('auditTarballExtractedSize throws on malformed tarball', async () => {
    const bogus = path.join(tmpDir, 'bogus.tar.gz');
    await fs.writeFile(bogus, 'not a real tarball');
    expect(() => auditTarballExtractedSize(bogus, 1024 * 1024)).toThrow(
      /tar -tzvf/
    );
  });

  it('refuses tarballs that exceed maxEntries (entry-count DoS guard)', async () => {
    // The entry-count cap blocks the "millions of tiny entries" DoS variant
    // where the listing output overflows spawnSync's buffer and the size
    // audit silently becomes a no-op.
    //
    // Production default: maxEntries=10_000 (~50× largest real .mlpackage).
    // Test uses maxEntries=5 + a small tarball to exercise the cap cheaply.
    // Without the injectable parameter we'd need to create 10k+ files on
    // disk, which flakes under parallel test-runner contention.
    const srcDir = path.join(tmpDir, 'many.mlpackage');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(path.join(srcDir, 'Data'), { recursive: true });
    for (let i = 0; i < 20; i++) {
      await fs.writeFile(path.join(srcDir, 'Data', `f${i}`), '');
    }

    const tarballPath = path.join(tmpDir, 'many.tar.gz');
    makeTarball(srcDir, tarballPath);

    // ~22 entries in the tarball (20 files + 2 dirs). maxEntries=5 → reject.
    expect(() =>
      auditTarballExtractedSize(tarballPath, 10 * 1024 * 1024 * 1024, 5)
    ).toThrow(/too many entries/);

    // Default maxEntries=10_000 accepts the same tarball.
    expect(() =>
      auditTarballExtractedSize(tarballPath, 10 * 1024 * 1024 * 1024)
    ).not.toThrow();
  });
});
