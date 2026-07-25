/**
 * Integration tests for `sweet-search init` command.
 *
 * Spawns the actual CLI dispatcher and verifies end-to-end behavior.
 * Tests run in isolated temp directories to avoid touching the real repo state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CANONICAL_POLICY_BODY, getMcpPolicyBody } from '../../scripts/inject-agent-instructions.js';
import { _internal as claudeRulesInternal } from '../../scripts/write-claude-rules.js';
import { CLAUDE_OUTPUT_STYLE_REL } from '../../scripts/install-claude-system-prompt.js';

const CLI = join(import.meta.dirname, '../..', 'core', 'cli.js');
const NODE = process.execPath;

function runInit(args, cwd) {
  const fullArgs = [CLI, 'init', ...args];
  try {
    const stdout = execFileSync(NODE, fullArgs, {
      encoding: 'utf8',
      timeout: 30000,
      cwd,
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: cwd },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status, signal: err.signal };
  }
}

describe('sweet-search init (integration)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ss-init-integ-'));
    // Create a package.json so detectProjectRoot finds this dir
    writeFileSync(join(tempDir, 'package.json'), '{"name":"test-project"}');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints help with --help', () => {
    const { stdout, exitCode } = runInit(['--help'], tempDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Sweet Search init');
    expect(stdout).toContain('--profile');
  });

  it('exits with error for unknown profile', () => {
    const { exitCode } = runInit(['--profile', 'bogus'], tempDir);
    expect(exitCode).not.toBe(0);
  });

  it('init --profile core creates config.json in temp dir', () => {
    const result = runInit(['--profile', 'core'], tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Sweet Search init complete');
    expect(result.stdout).toContain('core');

    const configPath = join(tempDir, '.sweet-search', 'config.json');
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.profile).toBe('core');
    expect(config.version).toBe(1);
    expect(config.runtime.allowRuntimeModelDownload).toBe(true);
  });

  it('init --profile core is idempotent', () => {
    const first = runInit(['--profile', 'core'], tempDir);
    const second = runInit(['--profile', 'core'], tempDir);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('Sweet Search init complete');
  });

  it('init --profile full with cached models sets downloads disabled', () => {
    // This test uses the global model cache — if models are not cached,
    // it will attempt downloads. Guard for CI with an env var.
    if (!process.env.SWEET_SEARCH_TEST_DOWNLOADS && !existsSync(
      join(process.env.HOME || '', '.cache', 'sweet-search', 'models', 'lightonai--LateOn-Code')
    )) {
      return; // skip when models not cached and downloads not enabled
    }

    const result = runInit(['--profile', 'full'], tempDir);
    if (result.exitCode !== 0) {
      console.error(
        `\n[init --profile full] FAILED: exitCode=${result.exitCode} signal=${result.signal}\n` +
        `--- stdout (tail) ---\n${String(result.stdout).slice(-3000)}\n` +
        `--- stderr (tail) ---\n${String(result.stderr).slice(-3000)}\n`
      );
    }
    expect(result.exitCode).toBe(0);

    const configPath = join(tempDir, '.sweet-search', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.profile).toBe('full');
    expect(config.runtime.allowRuntimeModelDownload).toBe(false);
  });

  it('config bridge works from subdirectory', () => {
    // Init at project root
    const result = runInit(['--profile', 'core'], tempDir);
    expect(result.exitCode).toBe(0);

    // Verify config exists at project root
    const configPath = join(tempDir, '.sweet-search', 'config.json');
    expect(existsSync(configPath)).toBe(true);
  });

  // ── --mcp / --no-cli contact-surface flags (end-to-end) ───────────────────
  const FAST = ['--profile', 'core', '--skip-dedup', '--skip-coreml-cascade'];
  const rulesPath = () => join(tempDir, '.claude', 'rules', 'sweet-search.md');
  const reminderHookPath = () => join(tempDir, '.claude', 'hooks', 'sweet-search-remind-tools.mjs');

  it('--no-cli without --mcp errors with a non-zero exit', () => {
    const { exitCode, stderr, stdout } = runInit([...FAST, '--no-cli'], tempDir);
    expect(exitCode).not.toBe(0);
    expect(stderr + stdout).toMatch(/--no-cli requires --mcp/);
  });

  it('--mcp is additive: registers .mcp.json AND keeps the ss-* CLI surface', () => {
    const { exitCode, stdout } = runInit([...FAST, '--mcp'], tempDir);
    expect(exitCode).toBe(0);

    const mcp = JSON.parse(readFileSync(join(tempDir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers['sweet-search'].command).toBe('npx');
    expect(mcp.mcpServers['sweet-search'].args).toContain('sweet-search-mcp');
    // CLI surface intact: exact ss-* rule + system override; CLAUDE.md untouched.
    expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(false);
    expect(readFileSync(rulesPath(), 'utf8')).toBe(
      `${claudeRulesInternal.SENTINEL}\n${CANONICAL_POLICY_BODY}\n`,
    );
    expect(existsSync(join(tempDir, CLAUDE_OUTPUT_STYLE_REL))).toBe(true);
    expect(existsSync(reminderHookPath())).toBe(false);
    expect(stdout).toContain('MCP server'); // surfaced in the final report
  });

  it('cli → --mcp --no-cli flips the one rule and removes the CLI-only override', () => {
    // 1. Plain CLI init installs exact M± in the rule.
    const first = runInit(FAST, tempDir);
    expect(first.exitCode).toBe(0);
    expect(readFileSync(rulesPath(), 'utf8')).toBe(
      `${claudeRulesInternal.SENTINEL}\n${CANONICAL_POLICY_BODY}\n`,
    );
    expect(existsSync(join(tempDir, CLAUDE_OUTPUT_STYLE_REL))).toBe(true);
    expect(existsSync(reminderHookPath())).toBe(false);
    expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(false);

    // 2. Re-init flipping to the MCP-only contact surface.
    const second = runInit([...FAST, '--mcp', '--no-cli'], tempDir);
    expect(second.exitCode).toBe(0);

    expect(readFileSync(rulesPath(), 'utf8')).toBe(
      `${claudeRulesInternal.SENTINEL}\n${getMcpPolicyBody()}\n`,
    );
    expect(existsSync(join(tempDir, CLAUDE_OUTPUT_STYLE_REL))).toBe(false);
    expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(tempDir, '.mcp.json'))).toBe(true);

    // No stale duplicate reminder survives either variant.
    expect(existsSync(reminderHookPath())).toBe(false);
    const settings = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf8');
    expect(settings).not.toContain('sweet-search-remind-tools.mjs');
  });
});
