/**
 * Tests for the `--mcp` / `--no-cli` contact-surface flags and their wiring:
 *   - parseInitArgs / validateInitArgs (flag parsing + the --no-cli⇒--mcp rule)
 *   - installMcpServer / removeMcpServer (.mcp.json additive + idempotent)
 *   - injectAgentInstructions({ variant: 'mcp' }) (MCP-tool prompt variant)
 *
 * Each test runs in an isolated tmpdir so the project root is never touched.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseInitArgs, validateInitArgs } from '../../scripts/init.js';
import {
  MCP_CONFIG_FILE,
  MCP_SERVER_KEY,
  buildServerEntry,
  installMcpServer,
  removeMcpServer,
} from '../../scripts/install-mcp-server.js';
import {
  CLAUDE_FILE,
  MARKER_BEGIN,
  injectAgentInstructions,
} from '../../scripts/inject-agent-instructions.js';

let tmpRoot;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sweet-search-mcp-test-'));
});
afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

const readJson = (rel) => JSON.parse(readFileSync(join(tmpRoot, rel), 'utf8'));
const read = (rel) => readFileSync(join(tmpRoot, rel), 'utf8');
const exists = (rel) => existsSync(join(tmpRoot, rel));

describe('parseInitArgs — --mcp / --no-cli', () => {
  it('defaults both flags off', () => {
    const args = parseInitArgs([]);
    expect(args.mcp).toBe(false);
    expect(args.noCli).toBe(false);
  });

  it('--mcp sets mcp=true (additive — does not imply --no-cli)', () => {
    const args = parseInitArgs(['--mcp']);
    expect(args.mcp).toBe(true);
    expect(args.noCli).toBe(false);
  });

  it('--mcp --no-cli sets both', () => {
    const args = parseInitArgs(['--mcp', '--no-cli']);
    expect(args.mcp).toBe(true);
    expect(args.noCli).toBe(true);
  });
});

describe('validateInitArgs — --no-cli requires --mcp', () => {
  it('accepts default (neither flag)', () => {
    expect(validateInitArgs(parseInitArgs([])).ok).toBe(true);
  });
  it('accepts --mcp alone', () => {
    expect(validateInitArgs(parseInitArgs(['--mcp'])).ok).toBe(true);
  });
  it('accepts --mcp --no-cli', () => {
    expect(validateInitArgs(parseInitArgs(['--mcp', '--no-cli'])).ok).toBe(true);
  });
  it('rejects --no-cli without --mcp with an actionable message', () => {
    const v = validateInitArgs(parseInitArgs(['--no-cli']));
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/--no-cli requires --mcp/);
  });
});

describe('installMcpServer — .mcp.json registration', () => {
  it('creates .mcp.json with the sweet-search server entry pinned to projectRoot', () => {
    const r = installMcpServer({ projectRoot: tmpRoot });
    expect(r.status).toBe('created');
    expect(exists(MCP_CONFIG_FILE)).toBe(true);

    const cfg = readJson(MCP_CONFIG_FILE);
    expect(cfg.mcpServers[MCP_SERVER_KEY]).toEqual(buildServerEntry({ projectRoot: tmpRoot }));
    expect(cfg.mcpServers[MCP_SERVER_KEY].command).toBe('npx');
    expect(cfg.mcpServers[MCP_SERVER_KEY].args).toContain('sweet-search-mcp');
    expect(cfg.mcpServers[MCP_SERVER_KEY].args).toContain(tmpRoot);
  });

  it('is idempotent — second run is unchanged', () => {
    installMcpServer({ projectRoot: tmpRoot });
    const before = read(MCP_CONFIG_FILE);
    const r2 = installMcpServer({ projectRoot: tmpRoot });
    expect(r2.status).toBe('unchanged');
    expect(read(MCP_CONFIG_FILE)).toBe(before);
  });

  it('preserves a pre-existing foreign server (additive merge)', () => {
    writeFileSync(
      join(tmpRoot, MCP_CONFIG_FILE),
      JSON.stringify({ mcpServers: { other: { command: 'node', args: ['x.js'] } } }, null, 2) + '\n',
    );
    const r = installMcpServer({ projectRoot: tmpRoot });
    expect(r.status).toBe('added');
    const cfg = readJson(MCP_CONFIG_FILE);
    expect(cfg.mcpServers.other).toEqual({ command: 'node', args: ['x.js'] });
    expect(cfg.mcpServers[MCP_SERVER_KEY]).toBeDefined();
  });

  it('rewrites a stale sweet-search entry (updated)', () => {
    writeFileSync(
      join(tmpRoot, MCP_CONFIG_FILE),
      JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: { command: 'old', args: [] } } }, null, 2) + '\n',
    );
    const r = installMcpServer({ projectRoot: tmpRoot });
    expect(r.status).toBe('updated');
    expect(readJson(MCP_CONFIG_FILE).mcpServers[MCP_SERVER_KEY]).toEqual(
      buildServerEntry({ projectRoot: tmpRoot }),
    );
  });

  it('refuses to clobber an unparseable .mcp.json (error, file untouched)', () => {
    writeFileSync(join(tmpRoot, MCP_CONFIG_FILE), '{ not valid json');
    const r = installMcpServer({ projectRoot: tmpRoot });
    expect(r.status).toBe('error');
    expect(read(MCP_CONFIG_FILE)).toBe('{ not valid json');
  });

  it('throws on missing projectRoot', () => {
    expect(() => installMcpServer({})).toThrow(/projectRoot is required/);
  });
});

describe('removeMcpServer — round-trip', () => {
  it('deletes a wholly-managed .mcp.json', () => {
    installMcpServer({ projectRoot: tmpRoot });
    expect(removeMcpServer({ projectRoot: tmpRoot })).toBe('file-deleted');
    expect(exists(MCP_CONFIG_FILE)).toBe(false);
  });

  it('removes only our entry, preserving foreign servers', () => {
    writeFileSync(
      join(tmpRoot, MCP_CONFIG_FILE),
      JSON.stringify({ mcpServers: { other: { command: 'node', args: ['x.js'] } } }, null, 2) + '\n',
    );
    installMcpServer({ projectRoot: tmpRoot });
    expect(removeMcpServer({ projectRoot: tmpRoot })).toBe('removed');
    const cfg = readJson(MCP_CONFIG_FILE);
    expect(cfg.mcpServers.other).toBeDefined();
    expect(cfg.mcpServers[MCP_SERVER_KEY]).toBeUndefined();
  });

  it('dry-run reports without modifying', () => {
    installMcpServer({ projectRoot: tmpRoot });
    const before = read(MCP_CONFIG_FILE);
    expect(removeMcpServer({ projectRoot: tmpRoot, dryRun: true })).toBe('dry-run');
    expect(read(MCP_CONFIG_FILE)).toBe(before);
  });

  it('not-found when absent', () => {
    expect(removeMcpServer({ projectRoot: tmpRoot })).toBe('not-found');
  });
});

describe('injectAgentInstructions — MCP variant (--no-cli)', () => {
  it('injects the MCP-tool prompt body, not the ss-* CLI one', () => {
    const r = injectAgentInstructions({ projectRoot: tmpRoot, variant: 'mcp' });
    expect(r.variant).toBe('mcp');
    expect(r.canonical).toBe('claude-code');

    const claude = read(CLAUDE_FILE);
    expect(claude).toContain(MARKER_BEGIN);
    // Shared opener + strategy core (ported verbatim from the CLI champion).
    expect(claude).toContain('Sweet-search indexes the working tree');
    expect(claude).toContain('trust the top ranked result outright');
    expect(claude).toContain('<state_summary>');
    // MCP-specific mechanics: unified `search`, retargeted anti-scan discipline.
    expect(claude).toContain('hybrid code search');
    expect(claude).toContain('native Grep/Read');

    // Must NOT carry the ss-* CLI surface or the CLI-only rules import.
    expect(claude).not.toContain('invoke via Bash');
    expect(claude).not.toContain('ss-grep');
    expect(claude).not.toContain('@.claude/rules/sweet-search.md');
  });

  it('default (cli) variant is unchanged — keeps ss-* + the rules import', () => {
    const r = injectAgentInstructions({ projectRoot: tmpRoot }); // variant defaults to 'cli'
    expect(r.variant).toBe('cli');
    const claude = read(CLAUDE_FILE);
    expect(claude).toContain('ss-grep');
    expect(claude).toContain('@.claude/rules/sweet-search.md');
    expect(claude).not.toContain('hybrid code search');
  });

  it('cli→mcp→cli re-init flips the marker body cleanly (single marker; import only in cli)', () => {
    const countMarkers = (s) => s.split(MARKER_BEGIN).length - 1;

    injectAgentInstructions({ projectRoot: tmpRoot }); // cli
    injectAgentInstructions({ projectRoot: tmpRoot, variant: 'mcp' }); // flip → mcp
    let claude = read(CLAUDE_FILE);
    expect(countMarkers(claude)).toBe(1);
    expect(claude).toContain('hybrid code search');
    expect(claude).not.toContain('ss-grep');
    expect(claude).not.toContain('@.claude/rules/sweet-search.md');

    injectAgentInstructions({ projectRoot: tmpRoot }); // flip back → cli
    claude = read(CLAUDE_FILE);
    expect(countMarkers(claude)).toBe(1);
    expect(claude).toContain('ss-grep');
    expect(claude).toContain('@.claude/rules/sweet-search.md');
    expect(claude).not.toContain('hybrid code search');
  });

  it('AGENTS.md canonical (claude disabled) carries the MCP body under variant mcp', () => {
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['agents', 'gemini', 'cursor'],
      variant: 'mcp',
    });
    expect(r.canonical).toBe('agents');
    const agents = readFileSync(join(tmpRoot, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('hybrid code search'); // MCP body, not the CLI one
    expect(agents).not.toContain('ss-grep');
  });
});
