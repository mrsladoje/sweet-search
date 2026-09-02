/**
 * Per-harness line-number gutter form (2026-09-02).
 *
 * The delimiter is not a solve lever (every form lands within 3 of 66 rollouts
 * on every harness), so the form is chosen per harness on CORRECTNESS and COST:
 *   claude-code → N<TAB>  (exact-string Edit; matches the format its Edit prompt names)
 *   opencode    → N:      (four-pass seek never leaks a delimiter, but N<TAB> silently
 *                          carried an extra tab into tab-indented files; colon cannot)
 *   codex       → none    (same seek, same carry, ~2,500-token output cap: pure cost)
 * These tests lock the mapping, the detection order (explicit env → env markers →
 * ancestry → default), the macOS cache that keeps the hot path spawn-free, and the
 * round-trip under every form.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  GUTTER_FORMS,
  HARNESS_DEFAULT_FORM,
  CACHE_MAX_AGE_MS,
  classifyProcess,
  detectHarnessFromEnv,
  detectHarnessFromAncestry,
  findHarnessAncestor,
  detectHarnessCached,
  harnessCachePath,
  readHarnessCache,
  writeHarnessCache,
  normalizeForm,
  resolveGutterForm,
  _resetGutterFormForTests,
} from '../../core/search/gutter-form.js';
import { numberCodeLines, stripCodeLineNumbers, lineGutterEnabled } from '../../core/search/search-read.js';

// A fake process table: pid → { ppid, args, comm }.
const table = (rows) => (pid) => rows[pid] || null;

describe('harness → form mapping', () => {
  it('is exactly the decided table', () => {
    expect(HARNESS_DEFAULT_FORM).toEqual({ 'claude-code': 'tab', opencode: 'colon', codex: 'none' });
    expect(GUTTER_FORMS).toEqual({ tab: '\t', pipe: '| ', colon: ':', none: '' });
  });
});

describe('classifyProcess', () => {
  it('recognises the three harness binaries by basename', () => {
    expect(classifyProcess({ args: '/Users/x/.local/bin/claude -p hi' })).toBe('claude-code');
    expect(classifyProcess({ args: '/opt/homebrew/bin/codex exec --json' })).toBe('codex');
    expect(classifyProcess({ args: '/Users/x/.opencode/bin/opencode run task' })).toBe('opencode');
  });

  it('recognises the npm entry points and platform binaries', () => {
    expect(classifyProcess({ args: 'node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js' })).toBe('claude-code');
    expect(classifyProcess({ args: 'node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js exec' })).toBe('codex');
    expect(classifyProcess({ args: '/x/vendor/aarch64-apple-darwin/bin/codex-aarch64-apple-darwin' })).toBe('codex');
    expect(classifyProcess({ args: 'node /x/node_modules/opencode-ai/bin/opencode' })).toBe('opencode');
  });

  it('falls back to the kernel comm name when cmdline is empty', () => {
    expect(classifyProcess({ comm: 'codex', args: '' })).toBe('codex');
  });

  it('does not match shells, node, or unrelated binaries', () => {
    for (const args of ['/bin/bash -c ss-read x', 'node _ss-helpers.mjs read', '/usr/bin/nsenter', 'ghostty', '/sbin/launchd', 'zsh -l', 'python3 codex_tools.py']) {
      expect(classifyProcess({ args })).toBe(null);
    }
  });
});

describe('detectHarnessFromEnv', () => {
  it('reads the markers each harness sets for its subprocesses', () => {
    expect(detectHarnessFromEnv({ CLAUDECODE: '1' })).toBe('claude-code');
    expect(detectHarnessFromEnv({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe('claude-code');
    expect(detectHarnessFromEnv({ CODEX_SANDBOX_NETWORK_DISABLED: '1' })).toBe('codex');
    expect(detectHarnessFromEnv({ CODEX_SANDBOX: 'seatbelt' })).toBe('codex');
    expect(detectHarnessFromEnv({ OPENCODE: '1' })).toBe('opencode');
  });

  it('ignores falsy markers and CODEX_HOME-style user config', () => {
    expect(detectHarnessFromEnv({ CLAUDECODE: '0', OPENCODE: 'false', CODEX_HOME: '/x' })).toBe(null);
    expect(detectHarnessFromEnv({})).toBe(null);
  });
});

describe('findHarnessAncestor / detectHarnessFromAncestry', () => {
  // 50 node wrapper ← 40 bash ← 30 codex ← 20 zsh (inside a claude session) ← 10 claude ← 1
  const nested = {
    50: { ppid: 40, args: 'node _ss-helpers.mjs read src/a.js' },
    40: { ppid: 30, args: '/bin/bash -c "ss-read src/a.js"' },
    30: { ppid: 20, args: '/opt/homebrew/bin/codex exec --json' },
    20: { ppid: 10, args: '/bin/zsh' },
    10: { ppid: 1, args: '/Users/x/.local/bin/claude' },
  };

  it('finds the NEAREST harness, its pid, and skips the wrapper itself', () => {
    expect(findHarnessAncestor({ pid: 50, readProcess: table(nested) })).toEqual({ harness: 'codex', pid: 30, top: 30 });
    expect(detectHarnessFromAncestry({ pid: 50, readProcess: table(nested) })).toBe('codex');
  });

  it('reports the highest ancestor reached when no harness is found', () => {
    const rows = { 50: { ppid: 40, args: 'node x.mjs' }, 40: { ppid: 30, args: 'zsh' }, 30: { ppid: 1, args: 'ghostty' } };
    expect(findHarnessAncestor({ pid: 50, readProcess: table(rows) })).toEqual({ harness: null, pid: null, top: 30 });
  });

  it('never classifies the starting process as its own harness', () => {
    const rows = { 50: { ppid: 1, args: '/opt/homebrew/bin/codex exec' } };
    expect(detectHarnessFromAncestry({ pid: 50, readProcess: table(rows) })).toBe(null);
  });

  it('is bounded: stops at the depth cap, at pid 1, and on a cycle', () => {
    const deep = {};
    for (let p = 100; p > 1; p--) deep[p] = { ppid: p - 1, args: 'sh' };
    deep[2] = { ppid: 1, args: '/opt/homebrew/bin/codex' };
    expect(detectHarnessFromAncestry({ pid: 100, readProcess: table(deep), maxDepth: 12 })).toBe(null);
    expect(detectHarnessFromAncestry({ pid: 100, readProcess: table(deep), maxDepth: 200 })).toBe('codex');
    const cycle = { 5: { ppid: 6, args: 'sh' }, 6: { ppid: 5, args: 'sh' } };
    expect(detectHarnessFromAncestry({ pid: 5, readProcess: table(cycle) })).toBe(null);
  });

  it('returns null, never throws, when the process table is unreadable', () => {
    expect(detectHarnessFromAncestry({ pid: 7, readProcess: () => { throw new Error('EACCES'); } })).toBe(null);
  });
});

describe('macOS harness cache', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'ss-gutter-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is keyed per user and project root', () => {
    const a = harnessCachePath({ SWEET_SEARCH_PROJECT_ROOT: '/repo/a' }, dir);
    const b = harnessCachePath({ SWEET_SEARCH_PROJECT_ROOT: '/repo/b' }, dir);
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(dir);
    expect(harnessCachePath({ SWEET_SEARCH_PROJECT_ROOT: '/repo/a' }, dir)).toBe(a);
  });

  it('round-trips an entry and validates liveness and age', () => {
    const file = path.join(dir, 'h.json');
    writeHarnessCache(file, { harness: 'codex', pid: 4242, now: 1000 });
    expect(readHarnessCache(file, { now: 2000, isAlive: () => true })).toEqual({ v: 1, harness: 'codex', pid: 4242, ts: 1000 });
    expect(readHarnessCache(file, { now: 2000, isAlive: () => false })).toBe(null);
    expect(readHarnessCache(file, { now: 1000 + CACHE_MAX_AGE_MS + 1, isAlive: () => true })).toBe(null);
    expect(readHarnessCache(file, { now: 500, isAlive: () => true })).toBe(null); // clock went backwards
  });

  it('rejects garbage, unknown harnesses, and pid 1', () => {
    const file = path.join(dir, 'h.json');
    writeFileSync(file, 'not json');
    expect(readHarnessCache(file, { isAlive: () => true })).toBe(null);
    writeFileSync(file, JSON.stringify({ v: 1, harness: 'cursor', pid: 5, ts: Date.now() }));
    expect(readHarnessCache(file, { isAlive: () => true })).toBe(null);
    writeFileSync(file, JSON.stringify({ v: 1, harness: 'codex', pid: 1, ts: Date.now() }));
    expect(readHarnessCache(file, { isAlive: () => true })).toBe(null);
    expect(readHarnessCache(path.join(dir, 'missing.json'))).toBe(null);
  });

  it('caches a negative result against the top ancestor too', () => {
    const file = path.join(dir, 'h.json');
    writeHarnessCache(file, { harness: null, pid: 77, now: 1000 });
    expect(readHarnessCache(file, { now: 2000, isAlive: () => true })).toMatchObject({ harness: null, pid: 77 });
  });

  it('detectHarnessCached walks once, then answers from the cache while the harness lives', () => {
    const file = path.join(dir, 'h.json');
    const rows = { 50: { ppid: 40, args: 'node w.mjs' }, 40: { ppid: 30, args: 'bash -c x' }, 30: { ppid: 1, args: '/x/opencode' } };
    let walks = 0;
    const readProcess = (pid) => { walks++; return rows[pid] || null; };
    const opts = { platform: 'darwin', file, isAlive: () => true };
    expect(detectHarnessCached({ ...opts, readProcess: (p) => readProcess(p === process.pid ? 50 : p) })).toBe('opencode');
    const after = walks;
    expect(after).toBeGreaterThan(0);
    expect(existsSync(file)).toBe(true);
    expect(detectHarnessCached({ ...opts, readProcess })).toBe('opencode');
    expect(walks).toBe(after); // no second walk
    // Harness gone → the cache is ignored and the tree is walked again.
    expect(detectHarnessCached({ ...opts, isAlive: () => false, readProcess: () => null })).toBe(null);
  });

  it('bypasses the cache on Linux, where /proc is exact and free', () => {
    const file = path.join(dir, 'h.json');
    writeHarnessCache(file, { harness: 'codex', pid: 4242 });
    const rows = { [process.pid]: { ppid: 1, args: 'node' } };
    expect(detectHarnessCached({ platform: 'linux', file, readProcess: table(rows), isAlive: () => true })).toBe(null);
  });
});

describe('normalizeForm', () => {
  it('accepts the four forms case-insensitively and treats auto/unknown as detect', () => {
    expect(normalizeForm('TAB')).toBe('tab');
    expect(normalizeForm(' none ')).toBe('none');
    expect(normalizeForm('colon')).toBe('colon');
    expect(normalizeForm('pipe')).toBe('pipe');
    expect(normalizeForm('auto')).toBe(null);
    expect(normalizeForm('')).toBe(null);
    expect(normalizeForm(undefined)).toBe(null);
    expect(normalizeForm('padded')).toBe(null);
  });
});

describe('resolveGutterForm (pure, injected env)', () => {
  const noAncestry = () => null;

  it('explicit SS_READ_GUTTER wins over every detector and costs nothing', () => {
    const r = resolveGutterForm({ SS_READ_GUTTER: 'colon', CLAUDECODE: '1' }, { ancestry: () => { throw new Error('must not walk'); } });
    expect(r).toEqual({ form: 'colon', delimiter: ':', harness: null, source: 'env-override' });
  });

  it('env markers are consulted before the ancestry walk (free path first)', () => {
    const r = resolveGutterForm({ CLAUDECODE: '1' }, { ancestry: () => { throw new Error('must not walk'); } });
    expect(r).toMatchObject({ form: 'tab', harness: 'claude-code', source: 'env-marker' });
  });

  it('falls back to ancestry, then to tab', () => {
    expect(resolveGutterForm({}, { ancestry: () => 'opencode' })).toMatchObject({ form: 'colon', harness: 'opencode', source: 'ancestry' });
    expect(resolveGutterForm({}, { ancestry: () => 'codex' })).toMatchObject({ form: 'none', harness: 'codex', source: 'ancestry' });
    expect(resolveGutterForm({}, { ancestry: noAncestry })).toEqual({ form: 'tab', delimiter: '\t', harness: null, source: 'default' });
  });

  it('SS_READ_GUTTER=auto means detect, not tab', () => {
    expect(resolveGutterForm({ SS_READ_GUTTER: 'auto' }, { ancestry: () => 'opencode' }).form).toBe('colon');
  });

  it('maps every harness to its decided form', () => {
    expect(resolveGutterForm({}, { ancestry: () => 'claude-code' }).form).toBe('tab');
    expect(resolveGutterForm({}, { ancestry: () => 'opencode' }).form).toBe('colon');
    expect(resolveGutterForm({}, { ancestry: () => 'codex' }).form).toBe('none');
  });
});

describe('resolveGutterForm (real process env)', () => {
  let saved;
  beforeEach(() => { saved = process.env.SS_READ_GUTTER; _resetGutterFormForTests(); });
  afterEach(() => {
    if (saved === undefined) delete process.env.SS_READ_GUTTER; else process.env.SS_READ_GUTTER = saved;
    _resetGutterFormForTests();
  });

  it('memoises and exports the decision into process.env for children', () => {
    delete process.env.SS_READ_GUTTER;
    const savedMarker = process.env.CLAUDECODE;
    delete process.env.CLAUDECODE;
    const savedEntry = process.env.CLAUDE_CODE_ENTRYPOINT;
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
    try {
      const first = resolveGutterForm(process.env, { ancestry: () => 'opencode' });
      expect(first.form).toBe('colon');
      expect(process.env.SS_READ_GUTTER).toBe('colon');
      // A second call with a different (fake) ancestry returns the memoised answer.
      expect(resolveGutterForm(process.env, { ancestry: () => 'codex' }).form).toBe('colon');
    } finally {
      if (savedMarker !== undefined) process.env.CLAUDECODE = savedMarker;
      if (savedEntry !== undefined) process.env.CLAUDE_CODE_ENTRYPOINT = savedEntry;
    }
  });

  it('does not overwrite an explicit env value', () => {
    process.env.SS_READ_GUTTER = 'pipe';
    expect(resolveGutterForm(process.env, { ancestry: () => 'codex' }).form).toBe('pipe');
    expect(process.env.SS_READ_GUTTER).toBe('pipe');
  });
});

describe('rendering under every form', () => {
  const SRC = 'a\n\tb\n  c:d\n';
  let saved;
  beforeEach(() => { saved = process.env.SS_READ_GUTTER; _resetGutterFormForTests(); });
  afterEach(() => {
    if (saved === undefined) delete process.env.SS_READ_GUTTER; else process.env.SS_READ_GUTTER = saved;
    _resetGutterFormForTests();
  });

  it('round-trips exactly with an explicit delimiter', () => {
    for (const d of ['\t', '| ', ':']) {
      const rendered = numberCodeLines(SRC, 9, d);
      expect(rendered.split('\n')[0]).toBe(`9${d}a`);
      expect(stripCodeLineNumbers(rendered, d)).toBe(SRC);
    }
  });

  it('form none leaves the source untouched and turns the gutter gate off', () => {
    process.env.SS_READ_GUTTER = 'none';
    expect(numberCodeLines(SRC, 9)).toBe(SRC);
    expect(stripCodeLineNumbers(SRC)).toBe(SRC);
    expect(lineGutterEnabled()).toBe(false);
    expect(lineGutterEnabled({ lineNumbers: true })).toBe(true); // explicit caller opt-in still wins
  });

  it('form colon renders N: with no injected space (the N| defect cannot recur)', () => {
    process.env.SS_READ_GUTTER = 'colon';
    const out = numberCodeLines(SRC, 9);
    expect(out).toBe('9:a\n10:\tb\n11:  c:d\n');
    expect(lineGutterEnabled()).toBe(true);
    // Only the FIRST colon is the gutter, so a source line containing ':' survives.
    expect(stripCodeLineNumbers(out)).toBe(SRC);
  });

  it('the default renderer follows the resolved form', () => {
    process.env.SS_READ_GUTTER = 'tab';
    expect(numberCodeLines('x', 3)).toBe('3\tx');
  });
});
