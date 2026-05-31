/**
 * Unit tests for the OPT-IN trajectory circuit-breaker
 * (core/prompt-optimization/sweep/p7-api-agent-runner.mjs).
 *
 * Pure-function coverage: fingerprinting, conservative empty-detection, the
 * duplicate short-circuit, the consecutive-empty hard-stop, and the safety
 * property that a PRODUCTIVE trajectory (distinct calls returning content) trips
 * neither rule. NO network, NO real agents. $0.
 */

import { describe, expect, it } from 'vitest';
import {
  breakerFingerprint,
  isEmptyToolResult,
  isSweetSearchCommand,
  makeTrajectoryGuard,
} from '../../../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';

const bash = (command, tIndex = 0) => ({ name: 'Bash', input: { command }, tIndex });
const read = (file_path, offset, limit, tIndex = 0) => ({ name: 'Read', input: { file_path, offset, limit }, tIndex });
const ok = (content) => ({ isError: false, content });
const err = (content = 'exit 1') => ({ isError: true, content });

describe('breakerFingerprint', () => {
  it('normalizes Bash whitespace so trivially-reformatted repeats collide', () => {
    expect(breakerFingerprint(bash('ss-grep  "foo"   -k 10'))).toBe(breakerFingerprint(bash('ss-grep "foo" -k 10')));
  });
  it('distinguishes genuinely different commands', () => {
    expect(breakerFingerprint(bash('ss-search "a"'))).not.toBe(breakerFingerprint(bash('ss-search "b"')));
  });
  it('keys Read on path + offset + limit', () => {
    expect(breakerFingerprint(read('a.js', 1, 200))).toBe(breakerFingerprint(read('a.js', 1, 200)));
    expect(breakerFingerprint(read('a.js', 1, 200))).not.toBe(breakerFingerprint(read('a.js', 50, 200)));
  });
});

describe('isEmptyToolResult (conservative — only CLEAR negatives)', () => {
  it('treats error exit (grep no-match) as empty', () => {
    expect(isEmptyToolResult(err('exit 1'))).toBe(true);
  });
  it('treats an empty/whitespace body as empty', () => {
    expect(isEmptyToolResult(ok('exit 0\n'))).toBe(true);
    expect(isEmptyToolResult(ok('exit 0\n   '))).toBe(true);
  });
  it('treats explicit no-match phrasing as empty', () => {
    expect(isEmptyToolResult(ok('exit 0\nNo results found'))).toBe(true);
    expect(isEmptyToolResult(ok('exit 0\n0 matches'))).toBe(true);
  });
  it('does NOT treat a short but real file:line hit as empty (no false positive)', () => {
    expect(isEmptyToolResult(ok('exit 0\nsrc/foo.rs:42:    fn foo() {'))).toBe(false);
  });
  it('does NOT treat substantive content as empty', () => {
    expect(isEmptyToolResult(ok('exit 0\n' + 'x'.repeat(500)))).toBe(false);
  });
});

describe('makeTrajectoryGuard — duplicate short-circuit', () => {
  it('executes a fresh call and short-circuits an exact repeat, citing the first index', () => {
    const g = makeTrajectoryGuard();
    expect(g.inspect(bash('find . -name x', 0)).action).toBe('execute');
    const dup = g.inspect(bash('find . -name x', 1));
    expect(dup.action).toBe('short-circuit');
    expect(dup.content).toMatch(/DUPLICATE of call #1/);
    expect(g.stats().duplicates).toBe(1);
  });

  it('does not short-circuit distinct calls', () => {
    const g = makeTrajectoryGuard();
    expect(g.inspect(bash('ss-search "a"', 0)).action).toBe('execute');
    expect(g.inspect(bash('ss-search "b"', 1)).action).toBe('execute');
    expect(g.stats().duplicates).toBe(0);
  });
});

describe('makeTrajectoryGuard — consecutive-empty hard-stop', () => {
  it('forces a stop after `emptyStopThreshold` consecutive empty results', () => {
    const g = makeTrajectoryGuard({ emptyStopThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      expect(g.inspect(bash(`ss-search "q${i}"`, i)).action).toBe('execute');
      g.observe(err()); // empty
    }
    expect(g.stats().forced).toBe(true);
    // any subsequent call is force-stopped, regardless of novelty
    expect(g.inspect(bash('ss-search "new"', 3)).action).toBe('force-stop');
  });

  it('a non-empty result RESETS the empty streak (productive progress)', () => {
    const g = makeTrajectoryGuard({ emptyStopThreshold: 3 });
    g.inspect(bash('a', 0)); g.observe(err());
    g.inspect(bash('b', 1)); g.observe(err());
    g.inspect(bash('c', 2)); g.observe(ok('exit 0\nreal content here')); // reset
    g.inspect(bash('d', 3)); g.observe(err());
    expect(g.stats().forced).toBe(false);
    expect(g.stats().consecutiveEmpty).toBe(1);
  });

  it('duplicates also build spiral pressure toward the hard-stop', () => {
    const g = makeTrajectoryGuard({ emptyStopThreshold: 3 });
    g.inspect(bash('find . -name x', 0)); // execute, seeds the fingerprint
    g.inspect(bash('find . -name x', 1)); // dup → empty++ =1
    g.inspect(bash('find . -name x', 2)); // dup → 2
    g.inspect(bash('find . -name x', 3)); // dup → 3 → forced
    expect(g.stats().forced).toBe(true);
  });
});

describe('makeTrajectoryGuard — SAFETY: a productive trajectory trips nothing', () => {
  it('distinct calls returning content never short-circuit or force-stop', () => {
    const g = makeTrajectoryGuard({ emptyStopThreshold: 5 });
    // a realistic 8-hop multi-file trace: every hop distinct, every hop returns content
    const hops = [
      'ss-search "request parsing entry"',
      'ss-read libs/server/RespServerSession.cs',
      'ss-trace TryConsumeMessages callees',
      'ss-semantic libs/server/RespServerSession.cs "ProcessMessages"',
      'ss-search "ParseCommand RESP"',
      'ss-read libs/server/Parser/RespCommand.cs',
      'ss-grep "ParseCommand"',
      'ss-read libs/server/Parser/RespCommand.cs 2800 60',
    ];
    hops.forEach((c, i) => {
      expect(g.inspect(bash(c, i)).action).toBe('execute');
      g.observe(ok(`exit 0\nfound: ${c} → real content`));
    });
    const s = g.stats();
    expect(s.forced).toBe(false);
    expect(s.duplicates).toBe(0);
    expect(s.shortCircuits).toBe(0);
  });

  it('simulated no-match decoy spiral (repeated empty finds via duplicates) IS broken', () => {
    const g = makeTrajectoryGuard({ emptyStopThreshold: 5 });
    // two real ss-* probes (empty), then the hand-crawl spiral of identical finds
    g.inspect(bash('ss-search "virtual threads loom"', 0)); g.observe(err());
    g.inspect(bash('ss-grep "VirtualThread"', 1)); g.observe(err());
    let shortCircuited = 0;
    for (let i = 2; i < 12; i++) {
      const r = g.inspect(bash('find /repo/kotlin -type f', i));
      if (r.action !== 'execute') shortCircuited++;
    }
    expect(shortCircuited).toBeGreaterThan(0);
    expect(g.stats().forced).toBe(true); // spiral halted well before the 40-cap
  });
});

describe('makeTrajectoryGuard — raw-shell escape budget (mechanism 3, the real spiral catch)', () => {
  it('classifies ss-* Bash as a tool call; raw find/grep as an escape', () => {
    expect(isSweetSearchCommand('ss-grep "foo"')).toBe(true);
    expect(isSweetSearchCommand('ss-read libs/x.cs 10 40')).toBe(true);
    expect(isSweetSearchCommand('find /repo -name "*.kt" | xargs grep foo')).toBe(false);
    expect(isSweetSearchCommand('cat /repo/x.kt')).toBe(false);
  });

  it('force-stops a NEAR-duplicate raw-shell spiral that exact-dup detection MISSES', () => {
    // This is the real kotlin-009 signature: every find varies the pattern, so
    // mechanism (1) never fires — mechanism (3) is what saves us.
    const g = makeTrajectoryGuard({ rawEscapeBudget: 10, ssAvailable: true });
    let forcedAt = null;
    for (let i = 0; i < 20; i++) {
      const r = g.inspect(bash(`find /repo/kotlin -name "*.kt" | xargs grep -rn "pattern${i}"`, i));
      if (r.action === 'force-stop' && forcedAt === null) forcedAt = i + 1;
    }
    expect(g.stats().duplicates).toBe(0); // none are exact duplicates
    expect(g.stats().rawEscapes).toBeGreaterThan(10);
    expect(forcedAt).toBe(11); // halted at the 11th escape (~budget+1), not the 40-cap
  });

  it('does NOT fire on a productive multi-file trace whose escapes stay ≤ budget (safety)', () => {
    // Mirrors A's worst real productive case (cpp-004 = 7 escapes among ss-* calls).
    const g = makeTrajectoryGuard({ rawEscapeBudget: 10, ssAvailable: true });
    const calls = [
      'ss-search "dispatch entry"', 'ss-read a.cc', 'cat hdr.h', 'ss-grep "GetVectorBytes"',
      'cat impl.cc', 'ss-read b.cc', 'grep -n foo c.cc', 'ss-semantic d.cc "z"',
      'sed -n 1,40p e.cc', 'ss-grep "w"', 'head -20 f.cc', 'ss-read g.cc', 'ss-search "v"',
    ]; // 6 raw escapes (cat,cat,grep,sed,head) interleaved with ss-* — under budget
    calls.forEach((c, i) => {
      const r = g.inspect(bash(c, i));
      g.observe(ok('exit 0\nreal content'));
      expect(r.action).toBe('execute');
    });
    expect(g.stats().forced).toBe(false);
    expect(g.stats().rawEscapes).toBeLessThanOrEqual(10);
  });

  it('ssAvailable=false (native baseline) NEVER counts raw shell as an escape', () => {
    const g = makeTrajectoryGuard({ rawEscapeBudget: 10, ssAvailable: false });
    for (let i = 0; i < 20; i++) g.inspect(bash(`find /repo -name "*.rs" | xargs grep "p${i}"`, i));
    expect(g.stats().rawEscapes).toBe(0);
    expect(g.stats().forced).toBe(false);
  });
});
