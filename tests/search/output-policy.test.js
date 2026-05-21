/**
 * Output-decoration policy unit tests.
 *
 * Pure decision logic — TTY, env, and /dev/tty probing are all injected, so
 * these tests never touch the real terminal.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectOutputPolicy,
  detectAgentEnv,
  createDecorationWriter,
} from '../../core/search/output-policy.js';
import { printStyledHeader, emitToolIdentity } from '../../core/search/cli-decoration.js';
import { formatReadResults } from '../../core/search/search-read.js';

const ESC = '\x1b';
const BANNER_GLYPH = '█';

describe('detectOutputPolicy', () => {
  it('TTY + no NO_COLOR + no agent env -> full decoration on stdout', () => {
    const p = detectOutputPolicy({ isTTY: true, env: {} });
    expect(p.mode).toBe('human-terminal');
    expect(p.decorationStream).toBe('stdout');
    expect(p.resultStream).toBe('stdout');
    expect(p.bannerEnabled).toBe(true);
    expect(p.colorEnabled).toBe(true);
    expect(p.animationEnabled).toBe(true);
    expect(p.machineReadable).toBe(false);
  });

  it('--json -> decoration disabled even in a TTY', () => {
    const p = detectOutputPolicy({ json: true, isTTY: true, env: {} });
    expect(p.mode).toBe('machine-readable');
    expect(p.machineReadable).toBe(true);
    expect(p.bannerEnabled).toBe(false);
    expect(p.colorEnabled).toBe(false);
    expect(p.animationEnabled).toBe(false);
    expect(p.decorationStream).toBeNull();
  });

  it('--format=plain -> banner/color/animation off, results still text', () => {
    const p = detectOutputPolicy({ format: 'plain', isTTY: true, env: {} });
    expect(p.bannerEnabled).toBe(false);
    expect(p.colorEnabled).toBe(false);
    expect(p.animationEnabled).toBe(false);
    expect(p.machineReadable).toBe(false);
    expect(p.resultStream).toBe('stdout');
  });

  it('--no-banner -> banner off but color may remain', () => {
    const p = detectOutputPolicy({ noBanner: true, isTTY: true, env: {} });
    expect(p.bannerEnabled).toBe(false);
    expect(p.colorEnabled).toBe(true);
  });

  it('NO_COLOR -> ANSI/color disabled, banner kept', () => {
    const p = detectOutputPolicy({ isTTY: true, env: { NO_COLOR: '1' } });
    expect(p.colorEnabled).toBe(false);
    expect(p.bannerEnabled).toBe(true);
  });

  it('empty NO_COLOR value does NOT disable color (per convention)', () => {
    const p = detectOutputPolicy({ isTTY: true, env: { NO_COLOR: '' } });
    expect(p.colorEnabled).toBe(true);
  });

  it('non-TTY + no Claude marker -> captured plain', () => {
    const p = detectOutputPolicy({ isTTY: false, env: {}, probeTty: () => null });
    expect(p.mode).toBe('captured-plain');
    expect(p.decorationStream).toBeNull();
    expect(p.bannerEnabled).toBe(false);
    expect(p.colorEnabled).toBe(false);
    expect(p.reason).toBe('captured-no-claude');
  });

  it('Claude Code env + separately writable /dev/tty -> tty side-channel, stdout plain', () => {
    const p = detectOutputPolicy({
      isTTY: false,
      env: { CLAUDECODE: '1' },
      probeTty: () => '/dev/tty',
    });
    expect(p.mode).toBe('claude-tty-sidechannel');
    expect(p.decorationStream).toBe('tty');
    expect(p.ttyPath).toBe('/dev/tty');
    expect(p.bannerEnabled).toBe(true);
    expect(p.resultStream).toBe('stdout');
    expect(p.reason).toBe('claude-code-tty');
  });

  it('captured pipe with writable /dev/tty but NO Claude marker -> plain (no side-channel)', () => {
    // A merely-writable /dev/tty is not trusted without positive Claude
    // detection: a PTY-capturing harness would route those bytes into capture.
    const probeTty = vi.fn(() => '/dev/tty');
    const p = detectOutputPolicy({ isTTY: false, env: {}, probeTty });
    expect(p.mode).toBe('captured-plain');
    expect(p.decorationStream).toBeNull();
    expect(p.bannerEnabled).toBe(false);
    expect(p.reason).toBe('captured-no-claude');
    expect(probeTty).not.toHaveBeenCalled(); // probe only consulted for Claude
  });

  it('Claude marker but /dev/tty not writable -> plain', () => {
    const p = detectOutputPolicy({
      isTTY: false,
      env: { CLAUDECODE: '1' },
      probeTty: () => null,
    });
    expect(p.mode).toBe('captured-plain');
    expect(p.bannerEnabled).toBe(false);
    expect(p.reason).toBe('claude-no-tty');
  });

  it('SWEET_SEARCH_DECORATION=never suppresses decoration even in a TTY', () => {
    const p = detectOutputPolicy({ isTTY: true, env: { SWEET_SEARCH_DECORATION: 'never' } });
    expect(p.bannerEnabled).toBe(false);
    expect(p.decorationStream).toBeNull();
    expect(p.reason).toBe('decoration-never');
  });

  it('SWEET_SEARCH_DECORATION=always decorates on stdout even when captured', () => {
    const p = detectOutputPolicy({
      isTTY: false,
      env: { SWEET_SEARCH_DECORATION: 'always', CODEX_SANDBOX: '1' },
      probeTty: () => null,
    });
    expect(p.mode).toBe('human-terminal');
    expect(p.decorationStream).toBe('stdout');
    expect(p.bannerEnabled).toBe(true);
    expect(p.reason).toBe('decoration-always');
  });

  it('--json still wins over DECORATION=always', () => {
    const p = detectOutputPolicy({
      json: true,
      env: { SWEET_SEARCH_DECORATION: 'always' },
    });
    expect(p.machineReadable).toBe(true);
    expect(p.bannerEnabled).toBe(false);
  });

  it('CODEX_* env -> decoration suppressed even if /dev/tty is writable', () => {
    const p = detectOutputPolicy({
      isTTY: false,
      env: { CODEX_SANDBOX: 'seatbelt' },
      probeTty: () => '/dev/tty',
    });
    expect(p.mode).toBe('captured-plain');
    expect(p.decorationStream).toBeNull();
    expect(p.bannerEnabled).toBe(false);
    expect(p.reason).toBe('codex-detected');
  });

  it('CODEX_* env suppresses decoration even when isTTY is true (defensive)', () => {
    const p = detectOutputPolicy({ isTTY: true, env: { CODEX_API_KEY: 'x' } });
    expect(p.decorationStream).toBeNull();
    expect(p.bannerEnabled).toBe(false);
    expect(p.reason).toBe('codex-detected');
  });

  it('other-agent marker (CURSOR_*) suppresses decoration', () => {
    const p = detectOutputPolicy({ isTTY: true, env: { CURSOR_TRACE_ID: 'abc' } });
    expect(p.bannerEnabled).toBe(false);
    expect(p.decorationStream).toBeNull();
    expect(p.reason).toBe('agent-detected');
  });

  it('never routes decoration to stderr', () => {
    for (const env of [{}, { CLAUDECODE: '1' }, { CODEX_SANDBOX: '1' }]) {
      for (const isTTY of [true, false]) {
        const p = detectOutputPolicy({ isTTY, env, probeTty: () => '/dev/tty' });
        expect(['stdout', 'tty', null]).toContain(p.decorationStream);
      }
    }
  });
});

describe('detectAgentEnv', () => {
  it('detects codex via CODEX_ prefix', () => {
    expect(detectAgentEnv({ CODEX_SANDBOX: '1' }).codex).toBe(true);
    expect(detectAgentEnv({}).codex).toBe(false);
  });
  it('detects Claude Code via CLAUDECODE', () => {
    expect(detectAgentEnv({ CLAUDECODE: '1' }).claudeCode).toBe(true);
    expect(detectAgentEnv({ CLAUDECODE: '0' }).claudeCode).toBe(false);
  });
  it('detects other agents via CURSOR_ prefix', () => {
    expect(detectAgentEnv({ CURSOR_TRACE_ID: 'x' }).otherAgent).toBe(true);
  });
});

describe('createDecorationWriter', () => {
  it('stdout target writes newline-terminated lines to the injected stream', () => {
    const lines = [];
    const stdout = { write: (s) => lines.push(s) };
    const w = createDecorationWriter({ decorationStream: 'stdout' }, { stdout });
    w.write('hello');
    w.close();
    expect(lines).toEqual(['hello\n']);
  });

  it('tty target writes via injected fd and closes it', () => {
    const writes = [];
    let closed = false;
    const w = createDecorationWriter(
      { decorationStream: 'tty', ttyPath: '/dev/tty' },
      {
        openTty: () => 7,
        writeSync: (fd, s) => writes.push([fd, s]),
        closeSync: () => { closed = true; },
      },
    );
    w.write('banner');
    w.close();
    expect(writes).toEqual([[7, 'banner\n']]);
    expect(closed).toBe(true);
  });

  it('tty target degrades to a no-op when the tty cannot be opened', () => {
    const w = createDecorationWriter(
      { decorationStream: 'tty', ttyPath: '/dev/tty' },
      { openTty: () => { throw new Error('ENXIO'); } },
    );
    expect(() => { w.write('x'); w.close(); }).not.toThrow();
  });

  it('null target is a no-op', () => {
    const w = createDecorationWriter({ decorationStream: null });
    expect(() => { w.write('x'); w.close(); }).not.toThrow();
  });
});

describe('decoration rendering respects color policy', () => {
  it('colorless style produces a banner with no ANSI escapes', () => {
    const lines = [];
    const plainStyle = {
      colors: {
        darkest: {}, darker: {}, dark: {}, lightDark: {}, lightestDark: {},
        border: {}, white: {},
      },
      fg: () => '',
      bg: () => '',
      reset: '',
      bold: '',
      lerp: () => ({}),
      colorMode: 'none',
      headerStyle: 'zones',
    };
    printStyledHeader('myquery', { write: (l = '') => lines.push(l), style: plainStyle });
    const out = lines.join('\n');
    expect(out).not.toContain(ESC);
    expect(out).toContain(BANNER_GLYPH); // pixel art still rendered
    expect(out).toContain('myquery');
  });
});

describe('emitToolIdentity (read / trace / read-semantic identity line)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes a branded line naming the tool when policy allows decoration on stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const policy = {
      decorationStream: 'stdout',
      bannerEnabled: true,
      colorEnabled: false,
    };
    emitToolIdentity(policy, 'read', 'src/a.js');
    const out = spy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('sweet-search');
    expect(out).toContain('read');
    expect(out).toContain('src/a.js');
    expect(out).not.toContain(ESC); // colorEnabled:false -> no ANSI
  });

  it('is a no-op when the policy disables the banner (captured/agent)', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    emitToolIdentity({ decorationStream: null, bannerEnabled: false, colorEnabled: false }, 'trace', 'foo');
    expect(spy).not.toHaveBeenCalled();
  });

  it('names each of the read/trace/semantic tools', () => {
    for (const tool of ['read', 'trace', 'read-semantic']) {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      emitToolIdentity({ decorationStream: 'stdout', bannerEnabled: true, colorEnabled: false }, tool, '');
      const out = spy.mock.calls.map((c) => c[0]).join('');
      expect(out).toContain(tool);
      spy.mockRestore();
    }
  });
});

describe('MCP read path stays decoration-free', () => {
  it('formatReadResults("agent") emits no ANSI escapes or banner glyphs', () => {
    const results = {
      files: [{ ok: true, file: 'a.js', text: 'const x = 1;', totalLines: 1, language: 'js' }],
      totalMs: 1,
    };
    const out = formatReadResults(results, 'agent');
    expect(out).not.toContain(ESC);
    expect(out).not.toContain(BANNER_GLYPH);
  });
});
