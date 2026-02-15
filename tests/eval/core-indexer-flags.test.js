import { describe, it, expect, afterEach } from 'vitest';
import { parseArgs } from '../../core/index-codebase-v21.js';

describe('parseArgs (index-codebase-v21)', () => {
  const savedEnv = process.env.SWEET_SEARCH_SQLITE_FAST_MODE;

  afterEach(() => {
    // Restore env after each test
    if (savedEnv === undefined) {
      delete process.env.SWEET_SEARCH_SQLITE_FAST_MODE;
    } else {
      process.env.SWEET_SEARCH_SQLITE_FAST_MODE = savedEnv;
    }
  });

  it('defaults have noColbert=false and sqliteFastMode=false', () => {
    delete process.env.SWEET_SEARCH_SQLITE_FAST_MODE;
    const result = parseArgs([]);

    expect(result.noColbert).toBe(false);
    expect(result.sqliteFastMode).toBe(false);
  });

  it('--no-colbert sets noColbert=true', () => {
    const result = parseArgs(['--no-colbert']);
    expect(result.noColbert).toBe(true);
  });

  it('--sqlite-fast sets sqliteFastMode=true', () => {
    const result = parseArgs(['--sqlite-fast']);
    expect(result.sqliteFastMode).toBe(true);
  });

  it('preserves existing flags', () => {
    const result = parseArgs(['--full', '--quiet']);

    expect(result.fullReindex).toBe(true);
    expect(result.quiet).toBe(true);
    expect(result.noColbert).toBe(false);
    expect(result.sqliteFastMode).toBe(false);
  });

  it('multiple new flags together', () => {
    const result = parseArgs(['--no-colbert', '--sqlite-fast']);

    expect(result.noColbert).toBe(true);
    expect(result.sqliteFastMode).toBe(true);
  });

  it('sqliteFastMode respects SWEET_SEARCH_SQLITE_FAST_MODE env var', () => {
    process.env.SWEET_SEARCH_SQLITE_FAST_MODE = '1';
    const result = parseArgs([]);

    expect(result.sqliteFastMode).toBe(true);
  });

  it('sqliteFastMode is false when env var is not 1', () => {
    process.env.SWEET_SEARCH_SQLITE_FAST_MODE = '0';
    const result = parseArgs([]);

    expect(result.sqliteFastMode).toBe(false);
  });

  it('all flags from argv are parsed', () => {
    const result = parseArgs([
      '--dry-run', '--graph-only', '--vectors-only', '--full',
      '--stats', '--resolve-only', '--skip-summary-regen',
      '--files-from-stdin', '--quiet', '--force-artifacts',
      '--no-colbert', '--sqlite-fast',
    ]);

    expect(result.dryRun).toBe(true);
    expect(result.graphOnly).toBe(true);
    expect(result.vectorsOnly).toBe(true);
    expect(result.fullReindex).toBe(true);
    expect(result.showStats).toBe(true);
    expect(result.resolveOnly).toBe(true);
    expect(result.skipSummaryRegen).toBe(true);
    expect(result.filesFromStdin).toBe(true);
    expect(result.quiet).toBe(true);
    expect(result.forceArtifacts).toBe(true);
    expect(result.noColbert).toBe(true);
    expect(result.sqliteFastMode).toBe(true);
  });

  it('uses process.argv when no argument is passed', () => {
    // parseArgs(undefined) reads process.argv.slice(2)
    // We can't easily control process.argv in a test, but we can verify
    // it doesn't throw when called without arguments
    const result = parseArgs();
    expect(result).toBeDefined();
    expect(typeof result.noColbert).toBe('boolean');
  });
});
