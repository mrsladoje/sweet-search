import { describe, it, expect, afterEach } from 'vitest';
import { parseArgs } from '../../core/indexing/index-codebase-v21.js';

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

  it('defaults have noLateInteraction=false and sqliteFastMode=false', () => {
    delete process.env.SWEET_SEARCH_SQLITE_FAST_MODE;
    const result = parseArgs([]);

    expect(result.noLateInteraction).toBe(false);
    expect(result.sqliteFastMode).toBe(false);
  });

  it('--no-late-interaction sets noLateInteraction=true', () => {
    const result = parseArgs(['--no-late-interaction']);
    expect(result.noLateInteraction).toBe(true);
  });

  it('--sqlite-fast sets sqliteFastMode=true', () => {
    const result = parseArgs(['--sqlite-fast']);
    expect(result.sqliteFastMode).toBe(true);
  });

  it('preserves existing flags', () => {
    const result = parseArgs(['--full', '--quiet']);

    expect(result.fullReindex).toBe(true);
    expect(result.quiet).toBe(true);
    expect(result.noLateInteraction).toBe(false);
    expect(result.sqliteFastMode).toBe(false);
  });

  it('multiple new flags together', () => {
    const result = parseArgs(['--no-late-interaction', '--sqlite-fast']);

    expect(result.noLateInteraction).toBe(true);
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
      '--no-late-interaction', '--sqlite-fast',
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
    expect(result.noLateInteraction).toBe(true);
    expect(result.sqliteFastMode).toBe(true);
  });

  it('--late-interaction-model=lateon-code-edge sets lateInteractionModel', () => {
    const result = parseArgs(['--late-interaction-model=lateon-code-edge']);
    expect(result.lateInteractionModel).toBe('lateon-code-edge');
  });

  it('--late-interaction-model default is null', () => {
    const result = parseArgs([]);
    expect(result.lateInteractionModel).toBeNull();
  });

  it('--late-interaction-pool=2 sets lateInteractionPool', () => {
    const result = parseArgs(['--late-interaction-pool=2']);
    expect(result.lateInteractionPool).toBe(2);
  });

  it('lateInteractionPool defaults to 1', () => {
    const result = parseArgs([]);
    expect(result.lateInteractionPool).toBe(1);
  });

  it('--late-interaction-skiplist=extended sets lateInteractionExtendedSkiplist', () => {
    const result = parseArgs(['--late-interaction-skiplist=extended']);
    expect(result.lateInteractionExtendedSkiplist).toBe(true);
  });

  it('lateInteractionExtendedSkiplist defaults to false', () => {
    const result = parseArgs([]);
    expect(result.lateInteractionExtendedSkiplist).toBe(false);
  });

  it('uses process.argv when no argument is passed', () => {
    // parseArgs(undefined) reads process.argv.slice(2)
    // We can't easily control process.argv in a test, but we can verify
    // it doesn't throw when called without arguments
    const result = parseArgs();
    expect(result).toBeDefined();
    expect(typeof result.noLateInteraction).toBe('boolean');
  });
});
