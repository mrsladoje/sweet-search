/**
 * Per-harness line-number gutter form (2026-09-02; family layer, four inferred
 * harnesses and the colon fallback 2026-09-22).
 *
 * The delimiter is not a solve lever (every form lands within 3 of 66 rollouts
 * on every harness), so the form is chosen per harness on CORRECTNESS and COST,
 * as a property of the harness's edit-tool matcher family:
 *   exact    → N<TAB>  a carried delimiter is rejected loudly, so the cheapest form
 *   tolerant → N:      a carried tab is absorbed and written; a colon cannot be indentation
 *   clipped  → none    tolerant AND output-clipped (codex): the gutter is pure cost
 * Measured: claude-code tab, opencode colon, codex none. Inferred from source:
 * cursor colon, pi tab, devin tab, grok-build arrow (its read tool's own prefix),
 * deepseek-harness colon (plugin-selected matcher). Unknown → colon.
 * These tests lock the mapping, the detection order (explicit env → measured
 * markers → ancestry → inferred markers → default), the macOS cache that keeps
 * the hot path spawn-free, and the round-trip under every form.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  GUTTER_FORMS,
  MATCHER_FAMILY_FORM,
  HARNESS_PROFILE,
  HARNESS_DEFAULT_FORM,
  DEFAULT_FAMILY,
  DEFAULT_FORM,
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
    expect(HARNESS_DEFAULT_FORM).toEqual({
      'claude-code': 'tab', opencode: 'colon', codex: 'none', cursor: 'colon',
      pi: 'tab', devin: 'tab', 'grok-build': 'arrow', 'deepseek-harness': 'colon',
    });
    expect(GUTTER_FORMS).toEqual({ tab: '\t', pipe: '| ', colon: ':', arrow: '→', none: '' });
  });

  it('is derived from the matcher family, with only format-match overrides', () => {
    expect(MATCHER_FAMILY_FORM).toEqual({ exact: 'tab', tolerant: 'colon', clipped: 'none' });
    for (const [harness, profile] of Object.entries(HARNESS_PROFILE)) {
      expect(profile.family in MATCHER_FAMILY_FORM, `${harness} family`).toBe(true);
      const form = HARNESS_DEFAULT_FORM[harness];
      expect(form in GUTTER_FORMS, `${harness} form`).toBe(true);
      // Safety envelope per family: a tolerant matcher never gets tab (silent tab carry),
      // a clipped harness never pays for a gutter, an exact matcher always keeps numbers.
      if (profile.family === 'tolerant') expect(form, harness).not.toBe('tab');
      if (profile.family === 'clipped') expect(form, harness).toBe('none');
      if (profile.family === 'exact') expect(form, harness).not.toBe('none');
      if (!profile.form) expect(form, harness).toBe(MATCHER_FAMILY_FORM[profile.family]);
    }
    // The one override: grok-build renders the prefix its own read tool prints.
    expect(HARNESS_PROFILE['grok-build']).toEqual({ family: 'exact', form: 'arrow' });
  });

  it('assumes an unknown harness is tolerant, so the fallback is colon and never tab', () => {
    expect(DEFAULT_FAMILY).toBe('tolerant');
    expect(DEFAULT_FORM).toBe('colon');
    expect(DEFAULT_FORM).not.toBe('tab');
  });
});

// The three bench-measured harnesses are the optimised ones. Their form AND their
// detection chain must stay byte-identical across every extension of the table.
describe('the measured harnesses are locked', () => {
  it('keep their forms', () => {
    expect(HARNESS_DEFAULT_FORM['claude-code']).toBe('tab');
    expect(HARNESS_DEFAULT_FORM.codex).toBe('none');
    expect(HARNESS_DEFAULT_FORM.opencode).toBe('colon');
  });

  it('resolve from their own markers before anything else, even with inferred markers present', () => {
    const leaked = { PI_CODING_AGENT: 'true', GROK_AGENT: '1', DSH_SHELL: '1' };
    const noWalk = () => { throw new Error('must not walk'); };
    expect(resolveGutterForm({ ...leaked, CLAUDECODE: '1' }, { ancestry: noWalk })).toMatchObject({ form: 'tab', harness: 'claude-code', source: 'env-marker' });
    expect(resolveGutterForm({ ...leaked, CODEX_SANDBOX_NETWORK_DISABLED: '1' }, { ancestry: noWalk })).toMatchObject({ form: 'none', harness: 'codex', source: 'env-marker' });
    expect(resolveGutterForm({ ...leaked, OPENCODE: '1' }, { ancestry: noWalk })).toMatchObject({ form: 'colon', harness: 'opencode', source: 'env-marker' });
  });

  it('resolve from ancestry before any inferred marker (a leaked marker cannot pre-empt the nearest harness)', () => {
    const leaked = { PI_CODING_AGENT: 'true', GROK_AGENT: '1', DSH_SESSION_ID: 's1' };
    expect(resolveGutterForm(leaked, { ancestry: () => 'codex' })).toMatchObject({ form: 'none', harness: 'codex', source: 'ancestry' });
    expect(resolveGutterForm(leaked, { ancestry: () => 'opencode' })).toMatchObject({ form: 'colon', harness: 'opencode', source: 'ancestry' });
    expect(resolveGutterForm(leaked, { ancestry: () => 'claude-code' })).toMatchObject({ form: 'tab', harness: 'claude-code', source: 'ancestry' });
  });

  it('classify their binaries exactly as before', () => {
    expect(classifyProcess({ args: '/Users/x/.local/bin/claude -p hi' })).toBe('claude-code');
    expect(classifyProcess({ args: 'claude --dangerously-skip-permissions' })).toBe('claude-code');
    expect(classifyProcess({ args: '/opt/homebrew/bin/codex exec --json' })).toBe('codex');
    expect(classifyProcess({ args: '/Users/x/.opencode/bin/opencode run task' })).toBe('opencode');
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
    for (const args of ['/bin/bash -c ss-read x', 'node _ss-helpers.mjs read', '/usr/bin/nsenter', 'ghostty', '/sbin/launchd', 'zsh -l', 'python3 codex_tools.py', 'node', 'node --inspect server.js', 'pip install x', 'grokd', '/usr/bin/pinentry']) {
      expect(classifyProcess({ args }), args).toBe(null);
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

  it('splits the measured markers (primary tier) from the inferred ones (fallback tier)', () => {
    expect(detectHarnessFromEnv({ CLAUDECODE: '1' }, { tier: 'primary' })).toBe('claude-code');
    expect(detectHarnessFromEnv({ CLAUDECODE: '1' }, { tier: 'fallback' })).toBe(null);
    expect(detectHarnessFromEnv({ PI_CODING_AGENT: 'true' }, { tier: 'primary' })).toBe(null);
    expect(detectHarnessFromEnv({ PI_CODING_AGENT: 'true' }, { tier: 'fallback' })).toBe('pi');
    // 'all' is primary first: a measured marker wins over a leaked inferred one.
    expect(detectHarnessFromEnv({ PI_CODING_AGENT: 'true', CLAUDECODE: '1' })).toBe('claude-code');
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
    writeFileSync(file, JSON.stringify({ v: 1, harness: 'zed', pid: 5, ts: Date.now() }));
    expect(readHarnessCache(file, { isAlive: () => true })).toBe(null);
    writeFileSync(file, JSON.stringify({ v: 1, harness: 'codex', pid: 1, ts: Date.now() }));
    expect(readHarnessCache(file, { isAlive: () => true })).toBe(null);
    expect(readHarnessCache(path.join(dir, 'missing.json'))).toBe(null);
  });

  it('accepts every registered harness, including the inferred ones', () => {
    const file = path.join(dir, 'h.json');
    for (const harness of Object.keys(HARNESS_DEFAULT_FORM)) {
      writeHarnessCache(file, { harness, pid: 4242, now: 1000 });
      expect(readHarnessCache(file, { now: 2000, isAlive: () => true })).toMatchObject({ harness });
    }
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
  it('accepts the five forms case-insensitively and treats auto/unknown as detect', () => {
    expect(normalizeForm('TAB')).toBe('tab');
    expect(normalizeForm(' none ')).toBe('none');
    expect(normalizeForm('colon')).toBe('colon');
    expect(normalizeForm('pipe')).toBe('pipe');
    expect(normalizeForm('arrow')).toBe('arrow');
    expect(normalizeForm('auto')).toBe(null);
    expect(normalizeForm('')).toBe(null);
    expect(normalizeForm(undefined)).toBe(null);
    expect(normalizeForm('padded')).toBe(null);
  });

  it('pins the historical "linenums"/"numbers" spellings to tab, not to the fallback', () => {
    expect(normalizeForm('linenums')).toBe('tab');
    expect(normalizeForm('numbers')).toBe('tab');
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

  it('falls back to ancestry, then to the inferred markers, then to colon', () => {
    expect(resolveGutterForm({}, { ancestry: () => 'opencode' })).toMatchObject({ form: 'colon', harness: 'opencode', source: 'ancestry' });
    expect(resolveGutterForm({}, { ancestry: () => 'codex' })).toMatchObject({ form: 'none', harness: 'codex', source: 'ancestry' });
    expect(resolveGutterForm({ GROK_AGENT: '1' }, { ancestry: noAncestry })).toMatchObject({ form: 'arrow', harness: 'grok-build', source: 'env-marker' });
    expect(resolveGutterForm({}, { ancestry: noAncestry })).toEqual({ form: 'colon', delimiter: ':', harness: null, source: 'default' });
  });

  it('an undetected harness never gets tab', () => {
    expect(resolveGutterForm({ AI_AGENT: 'something-new_1-0_agent' }, { ancestry: noAncestry }).form).not.toBe('tab');
    expect(resolveGutterForm({}, { ancestry: noAncestry }).form).toBe('colon');
  });

  it('SS_READ_GUTTER=auto means detect, not the fallback', () => {
    expect(resolveGutterForm({ SS_READ_GUTTER: 'auto' }, { ancestry: () => 'opencode' }).form).toBe('colon');
    expect(resolveGutterForm({ SS_READ_GUTTER: 'auto' }, { ancestry: () => 'claude-code' }).form).toBe('tab');
  });

  it('maps every harness to its decided form', () => {
    for (const [harness, form] of Object.entries(HARNESS_DEFAULT_FORM)) {
      expect(resolveGutterForm({}, { ancestry: () => harness }), harness).toMatchObject({ form, delimiter: GUTTER_FORMS[form], harness, source: 'ancestry' });
    }
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
    for (const d of ['\t', '| ', ':', '→']) {
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

  it('form arrow renders N→ with no injected space, and a source arrow survives the round trip', () => {
    process.env.SS_READ_GUTTER = 'arrow';
    const src = 'a\n\tb\n  x → y\n';
    const out = numberCodeLines(src, 9);
    expect(out).toBe('9→a\n10→\tb\n11→  x → y\n');
    expect(lineGutterEnabled()).toBe(true);
    expect(stripCodeLineNumbers(out)).toBe(src);
  });

  it('the default renderer follows the resolved form', () => {
    process.env.SS_READ_GUTTER = 'tab';
    expect(numberCodeLines('x', 3)).toBe('3\tx');
  });
});

// Cursor: its edit is a two-model fuzzy APPLY, so it belongs to the tolerant-matcher
// family (opencode/codex) where a stray delimiter is absorbed rather than rejected.
// Colon, never tab. See the decision block at the top of gutter-form.js.
describe('cursor', () => {
  it('uses colon, the tolerant-matcher form, never tab', () => {
    expect(HARNESS_PROFILE.cursor.family).toBe('tolerant');
    expect(HARNESS_DEFAULT_FORM.cursor).toBe('colon');
    expect(GUTTER_FORMS[HARNESS_DEFAULT_FORM.cursor]).toBe(':');
  });

  it('classifies the agent CLI but NOT the bare IDE binary', () => {
    expect(classifyProcess({ args: '/usr/local/bin/cursor-agent --print "fix it"' })).toBe('cursor');
    expect(classifyProcess({ args: 'node /p/node_modules/@cursor/cli/dist/index.js' })).toBe('cursor');
    expect(classifyProcess({ args: '/opt/homebrew/bin/cursor-agent' })).toBe('cursor');
    // the IDE is not a harness for our tools
    expect(classifyProcess({ args: '/Applications/Cursor.app/Contents/MacOS/cursor' })).toBe(null);
  });

  it('detects cursor from its env markers', () => {
    expect(detectHarnessFromEnv({ CURSOR_AGENT: '1' })).toBe('cursor');
    expect(detectHarnessFromEnv({ CURSOR_TRACE_ID: 'abc123' })).toBe('cursor');
    expect(detectHarnessFromEnv({ CURSOR_AGENT: '0' })).toBe(null);
    expect(detectHarnessFromEnv({})).toBe(null);
  });
});

// Pi: exact indexOf first, then one fuzzy pass that only trims trailing whitespace and
// folds typography; leading whitespace is preserved, so a carried gutter fails loudly.
// Exact family → tab. Its read tool prints no line numbers (no native prefix to match).
describe('pi', () => {
  it('is an exact-anchor harness and gets tab', () => {
    expect(HARNESS_PROFILE.pi).toEqual({ family: 'exact' });
    expect(HARNESS_DEFAULT_FORM.pi).toBe('tab');
  });

  it('classifies the npm bin behind its node shebang, the resolved entry point, and a bare binary', () => {
    expect(classifyProcess({ args: 'node /opt/homebrew/bin/pi' })).toBe('pi');
    expect(classifyProcess({ args: 'node /Users/x/.pi/agent/npm/bin/pi -p "fix it"' })).toBe('pi');
    expect(classifyProcess({ args: 'node --enable-source-maps /opt/homebrew/bin/pi' })).toBe('pi');
    expect(classifyProcess({ args: 'node /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js' })).toBe('pi');
    expect(classifyProcess({ args: 'bun /x/pi-coding-agent/dist/bundle/cli.js' })).toBe('pi');
    expect(classifyProcess({ args: '/usr/local/bin/pi' })).toBe('pi');
    // not pi: other node scripts, pip, pinentry
    expect(classifyProcess({ args: 'node /x/bin/pi.js' })).toBe(null);
    expect(classifyProcess({ args: 'node /x/pilot' })).toBe(null);
    expect(classifyProcess({ args: '/usr/bin/pip3 install x' })).toBe(null);
  });

  it('detects pi from PI_CODING_AGENT, in the fallback tier only', () => {
    expect(detectHarnessFromEnv({ PI_CODING_AGENT: 'true' })).toBe('pi');
    expect(detectHarnessFromEnv({ PI_CODING_AGENT: 'true' }, { tier: 'primary' })).toBe(null);
    expect(detectHarnessFromEnv({ PI_CODING_AGENT: 'false' })).toBe(null);
    // Claude Code also sets AI_AGENT (to "claude-code_<version>_agent"); the generic
    // variable is never a pi signal on its own.
    expect(detectHarnessFromEnv({ AI_AGENT: 'claude-code_2-1-278_agent' })).toBe(null);
    expect(detectHarnessFromEnv({ AI_AGENT: 'pi' })).toBe(null);
  });

  it('resolves to tab from ancestry or, failing that, from its marker', () => {
    expect(resolveGutterForm({}, { ancestry: () => 'pi' })).toMatchObject({ form: 'tab', harness: 'pi', source: 'ancestry' });
    expect(resolveGutterForm({ PI_CODING_AGENT: 'true', AI_AGENT: 'pi' }, { ancestry: () => null })).toMatchObject({ form: 'tab', harness: 'pi', source: 'env-marker' });
  });
});

// Devin CLI: "Performs exact string replacements in files"; its Read prompt names the
// prefix as "spaces + line number + tab" — the claude-code shape. Exact family → tab.
// It sets no marker for its shells, so ancestry is the only signal.
describe('devin', () => {
  it('is an exact-anchor harness and gets tab', () => {
    expect(HARNESS_PROFILE.devin).toEqual({ family: 'exact' });
    expect(HARNESS_DEFAULT_FORM.devin).toBe('tab');
  });

  it('classifies the native binary and nothing that merely contains the name', () => {
    expect(classifyProcess({ args: '/Users/x/.local/bin/devin -p "fix it"' })).toBe('devin');
    expect(classifyProcess({ args: '/Users/x/.local/share/devin/cli/_versions/current/bin/devin acp' })).toBe('devin');
    expect(classifyProcess({ comm: 'devin', args: '' })).toBe('devin');
    expect(classifyProcess({ args: '/usr/bin/devinfo' })).toBe(null);
    expect(classifyProcess({ args: 'node /x/devin-cli/index.js' })).toBe(null);
  });

  it('has no env marker: DEVIN_* are configuration inputs, not session markers', () => {
    expect(detectHarnessFromEnv({ DEVIN_MODEL: 'opus', DEVIN_SANDBOX: '1', DEVIN_API_TOKEN: 'x' })).toBe(null);
  });

  it('resolves to tab from ancestry', () => {
    expect(resolveGutterForm({}, { ancestry: () => 'devin' })).toMatchObject({ form: 'tab', harness: 'devin', source: 'ancestry' });
  });
});

// Grok Build: default search_replace is exact (the Unicode-confusable fallback is off
// by default and never folds a leading digit or tab), and its own read_file anchors
// lines as `LINE_NUMBER→`, which its edit prompt tells the model to strip. Exact
// family with the arrow as the format-match override.
describe('grok-build', () => {
  it('is an exact-anchor harness with the arrow override', () => {
    expect(HARNESS_PROFILE['grok-build']).toEqual({ family: 'exact', form: 'arrow' });
    expect(HARNESS_DEFAULT_FORM['grok-build']).toBe('arrow');
    expect(GUTTER_FORMS.arrow).toBe('→');
  });

  it('classifies the installed name and the cargo binary name', () => {
    expect(classifyProcess({ args: '/Users/x/.grok/bin/grok' })).toBe('grok-build');
    expect(classifyProcess({ args: '/Users/x/.grok/bin/grok --no-ask-user "fix it"' })).toBe('grok-build');
    expect(classifyProcess({ args: '/x/target/release/xai-grok-pager' })).toBe('grok-build');
    expect(classifyProcess({ comm: 'grok', args: '' })).toBe('grok-build');
    expect(classifyProcess({ args: '/usr/bin/grokd' })).toBe(null);
  });

  it('detects grok-build from the marker it forces into every agent terminal, and from its MCP marker', () => {
    expect(detectHarnessFromEnv({ GROK_AGENT: '1' })).toBe('grok-build');
    expect(detectHarnessFromEnv({ GROK_SESSION_ID: 'abc' })).toBe('grok-build');
    expect(detectHarnessFromEnv({ GROK_AGENT: '1' }, { tier: 'primary' })).toBe(null);
    expect(detectHarnessFromEnv({ GROK_AGENT: '0' })).toBe(null);
    // GROK_HOME is user config, not a session marker.
    expect(detectHarnessFromEnv({ GROK_HOME: '/x/.grok' })).toBe(null);
  });

  it('resolves to the arrow form', () => {
    expect(resolveGutterForm({}, { ancestry: () => 'grok-build' })).toMatchObject({ form: 'arrow', delimiter: '→', harness: 'grok-build', source: 'ancestry' });
    expect(resolveGutterForm({ GROK_AGENT: '1' }, { ancestry: () => null })).toMatchObject({ form: 'arrow', harness: 'grok-build', source: 'env-marker' });
  });

  it('a GROK_AGENT leaked from dotfiles cannot pre-empt a real harness in the tree', () => {
    expect(resolveGutterForm({ GROK_AGENT: '1' }, { ancestry: () => 'codex' })).toMatchObject({ form: 'none', harness: 'codex' });
    expect(resolveGutterForm({ GROK_AGENT: '1' }, { ancestry: () => 'opencode' })).toMatchObject({ form: 'colon', harness: 'opencode' });
  });
});

// DeepSeek Harness: the bundled str_replace_editor is exact, but the matcher is
// plugin-selected (patch-apply, hashline), so the form is the tolerant-safe colon.
describe('deepseek-harness', () => {
  it('is treated as tolerant (plugin-selected matcher) and gets colon', () => {
    expect(HARNESS_PROFILE['deepseek-harness']).toEqual({ family: 'tolerant' });
    expect(HARNESS_DEFAULT_FORM['deepseek-harness']).toBe('colon');
  });

  it('classifies the npm bin behind its node shebang and the package entry point', () => {
    expect(classifyProcess({ args: 'node /opt/homebrew/bin/dsh' })).toBe('deepseek-harness');
    expect(classifyProcess({ args: 'node /x/.npm/_npx/abc/node_modules/@deepseek-ai/dsh/lib/bin.js web' })).toBe('deepseek-harness');
    expect(classifyProcess({ args: '/usr/local/bin/dsh --profile sdk-minimal' })).toBe('deepseek-harness');
    expect(classifyProcess({ args: 'node /x/dshell.js' })).toBe(null);
  });

  it('detects dsh from the DSH_* facts it rebuilds for every shell call, in the fallback tier', () => {
    expect(detectHarnessFromEnv({ DSH_SHELL: '1' })).toBe('deepseek-harness');
    expect(detectHarnessFromEnv({ DSH_SESSION_ID: 'sess' })).toBe('deepseek-harness');
    expect(detectHarnessFromEnv({ DSH_SHELL: '1' }, { tier: 'primary' })).toBe(null);
    // DSH_HOME is user config, not a session marker.
    expect(detectHarnessFromEnv({ DSH_HOME: '/x/.dsh' })).toBe(null);
  });

  it('a claude-code or codex sub-agent driven by dsh keeps its own form', () => {
    expect(resolveGutterForm({ DSH_SHELL: '1', CLAUDECODE: '1' }, { ancestry: () => { throw new Error('must not walk'); } })).toMatchObject({ form: 'tab', harness: 'claude-code' });
    expect(resolveGutterForm({ DSH_SHELL: '1' }, { ancestry: () => 'codex' })).toMatchObject({ form: 'none', harness: 'codex' });
    expect(resolveGutterForm({ DSH_SHELL: '1' }, { ancestry: () => null })).toMatchObject({ form: 'colon', harness: 'deepseek-harness', source: 'env-marker' });
  });
});
