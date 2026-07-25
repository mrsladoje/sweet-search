/**
 * Holistic init → uninstall lifecycle integration test (P5).
 *
 * Spawns the real CLI (`node core/cli.js init` / `... uninstall`) in an
 * isolated tmp project root and verifies:
 *   1. init creates every documented artifact across .claude/, the harness
 *      instruction files, and .sweet-search/.
 *   2. uninstall removes every sweet-search-managed artifact while leaving
 *      user-authored content intact.
 *
 * Two scenarios:
 *   A. default (`init`)  — Claude project rule + output style; no CLAUDE.md
 *   B. strict + multi-harness (`init --enforce-tools --agents --gemini --cursor`)
 *      — full surface including opt-in Grep deny/Read hint, AGENTS.md,
 *      GEMINI.md symlink, cursor rule.
 *
 * Plan reference: §10 (init flow steps 11-17), P5 ("uninstall cleanup
 * for all init-owned instruction/settings mutations").
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE_OUTPUT_STYLE_NAME,
  CLAUDE_OUTPUT_STYLE_REL,
  CLAUDE_SYSTEM_OVERRIDE,
} from '../../scripts/install-claude-system-prompt.js';
import {
  CANONICAL_POLICY_BODY,
  MARKER_BEGIN,
  MARKER_END,
  getMcpPolicyBody,
} from '../../scripts/inject-agent-instructions.js';
import {
  CLAUDE_RULES_REL,
  _internal as claudeRulesInternal,
} from '../../scripts/write-claude-rules.js';
import { installPromptReminderHook } from '../../scripts/install-prompt-reminders.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'core', 'cli.js');

let tmpRoot;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sweet-search-lifecycle-'));
  // Minimal package.json so detectProjectRoot() picks tmpRoot.
  writeFileSync(join(tmpRoot, 'package.json'), '{}');
});
afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

const exists = (rel) => existsSync(join(tmpRoot, rel));
const readJson = (rel) => JSON.parse(readFileSync(join(tmpRoot, rel), 'utf8'));

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpRoot,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const COMMON_INIT_ARGS = [
  'init',
  '--profile=core',
  '--skip-prewarm-hook', // SessionStart entry adds noise; tested separately
  '--skip-cuda',
];

describe('lifecycle: default init → uninstall (Scenario A)', () => {
  it('init leaves CLAUDE.md absent and installs the exact Claude rule + override', () => {
    const r = runCli(COMMON_INIT_ARGS);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(r.stderr).toContain('activated the `sweet-search` output style');
    expect(r.stderr).toContain('Start a new session or run `/clear`');
    expect(r.stderr).toContain('Keep this style selected');

    // Claude Code auto-loads the project rule; init never touches CLAUDE.md.
    expect(exists('CLAUDE.md')).toBe(false);
    // No opt-in harness files
    expect(exists('AGENTS.md')).toBe(false);
    expect(exists('GEMINI.md')).toBe(false);
    expect(exists('.cursor/rules/sweet-search.mdc')).toBe(false);

    // .claude/ ecosystem
    expect(exists(CLAUDE_RULES_REL)).toBe(true);
    expect(readFileSync(join(tmpRoot, CLAUDE_RULES_REL), 'utf8')).toBe(
      `${claudeRulesInternal.SENTINEL}\n${CANONICAL_POLICY_BODY}\n`,
    );
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(readFileSync(join(tmpRoot, CLAUDE_OUTPUT_STYLE_REL), 'utf8')).toContain(
      CLAUDE_SYSTEM_OVERRIDE,
    );
    expect(exists('.claude/hooks/index-maintainer.mjs')).toBe(true);
    expect(exists('.claude/skills/sweet-index/SKILL.md')).toBe(true);
    // No duplicate hand-authored UserPromptSubmit guidance.
    expect(exists('.claude/hooks/sweet-search-remind-tools.mjs')).toBe(false);
    const settings = readJson('.claude/settings.json');
    expect(settings.outputStyle).toBe(CLAUDE_OUTPUT_STYLE_NAME);
    expect(settings.hooks?.UserPromptSubmit).toBeUndefined();
    // P3: tool enforcement NOT installed without --enforce-tools
    expect(exists('.claude/hooks/sweet-search-intercept-read.mjs')).toBe(false);
    expect(settings.permissions).toBeUndefined();
    expect(settings.hooks?.PreToolUse).toBeUndefined();
  });

  it('installs the style but warns when settings.local.json overrides it', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(tmpRoot, '.claude', 'settings.local.json'),
      JSON.stringify({ outputStyle: 'Explanatory' }, null, 2) + '\n',
    );

    const r = runCli(COMMON_INIT_ARGS);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(readJson('.claude/settings.json').outputStyle).toBe(
      CLAUDE_OUTPUT_STYLE_NAME,
    );
    expect(readJson('.claude/settings.local.json').outputStyle).toBe('Explanatory');
    expect(r.stderr).toContain('WARNING');
    expect(r.stderr).toContain(
      'system-prompt routing is not active because another output style overrides it',
    );
    expect(r.stderr).toContain('Select `sweet-search` under `/config`');
  });

  it('uninstall removes everything sweet-search-managed', () => {
    const userClaude = '# my project instructions\nKeep me.\n';
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), userClaude);
    runCli(COMMON_INIT_ARGS);
    expect(readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf8')).toBe(userClaude);

    const r = runCli(['uninstall', '--force', '--keep-models']);
    expect(r.code, `uninstall failed: ${r.stderr}`).toBe(0);

    // .sweet-search/ gone
    expect(exists('.sweet-search')).toBe(false);
    // .claude/ artifacts gone
    expect(exists('.claude/rules/sweet-search.md')).toBe(false);
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(false);
    expect(exists('.claude/hooks/index-maintainer.mjs')).toBe(false);
    expect(exists('.claude/skills/sweet-index')).toBe(false);
    expect(exists('.claude/hooks/sweet-search-remind-tools.mjs')).toBe(false);
    // settings.json may exist as `{}` after entries are stripped.
    if (exists('.claude/settings.json')) {
      expect(readJson('.claude/settings.json')).toEqual({});
    }
    // CLAUDE.md was never modified.
    expect(exists('CLAUDE.md')).toBe(true);
    expect(readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf8')).toBe(userClaude);
  });
});

describe('lifecycle: upgrade from the legacy Claude layout', () => {
  it('moves policy out of CLAUDE.md, replaces the old rule, and removes the reminder', () => {
    writeFileSync(
      join(tmpRoot, 'CLAUDE.md'),
      `${MARKER_BEGIN}\nlegacy managed policy\n${MARKER_END}\n\n# User rules\nKeep me.\n`,
    );
    mkdirSync(join(tmpRoot, '.claude', 'rules'), { recursive: true });
    writeFileSync(
      join(tmpRoot, CLAUDE_RULES_REL),
      `${claudeRulesInternal.LEGACY_SENTINEL}\nlegacy contradictory rule\n`,
    );
    expect(installPromptReminderHook({
      projectRoot: tmpRoot,
      packageRoot: REPO_ROOT,
    }).status).toBe('registered');

    const result = runCli(COMMON_INIT_ARGS);
    expect(result.code, `init failed: ${result.stderr}`).toBe(0);

    expect(readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf8')).toBe('# User rules\nKeep me.\n');
    expect(readFileSync(join(tmpRoot, CLAUDE_RULES_REL), 'utf8')).toBe(
      `${claudeRulesInternal.SENTINEL}\n${CANONICAL_POLICY_BODY}\n`,
    );
    expect(exists('.claude/hooks/sweet-search-remind-tools.mjs')).toBe(false);
    expect(readJson('.claude/settings.json').hooks?.UserPromptSubmit).toBeUndefined();
  });
});

describe('lifecycle: full surface init → uninstall (Scenario B)', () => {
  const FULL_ARGS = [
    ...COMMON_INIT_ARGS,
    '--enforce-tools',
    '--agents',
    '--gemini',
    '--cursor',
  ];

  it('init creates the full surface across all four harnesses + enforcement', () => {
    const r = runCli(FULL_ARGS);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);

    // Harness files
    expect(exists('CLAUDE.md')).toBe(false);
    expect(exists('AGENTS.md')).toBe(true);
    expect(exists('GEMINI.md')).toBe(true);
    expect(exists('.cursor/rules/sweet-search.mdc')).toBe(true);
    const agents = readFileSync(join(tmpRoot, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Sweet-search indexes the working tree');
    expect(agents).not.toContain('@CLAUDE.md');

    // P3 enforcement landed
    expect(exists('.claude/hooks/sweet-search-intercept-read.mjs')).toBe(true);
    const settings = readJson('.claude/settings.json');
    expect(settings.outputStyle).toBe(CLAUDE_OUTPUT_STYLE_NAME);
    expect(settings.permissions.deny).toContain('Grep');
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Read');
    expect(settings.hooks.UserPromptSubmit).toBeUndefined();
  });

  it('uninstall removes the full surface + enforcement + symlinks', () => {
    runCli(FULL_ARGS);
    const r = runCli(['uninstall', '--force', '--keep-models']);
    expect(r.code, `uninstall failed: ${r.stderr}`).toBe(0);

    // All managed harness files gone; CLAUDE.md was never created.
    expect(exists('AGENTS.md')).toBe(false);
    expect(exists('GEMINI.md')).toBe(false);
    expect(exists('.cursor/rules/sweet-search.mdc')).toBe(false);
    expect(exists('CLAUDE.md')).toBe(false);

    // Enforcement gone
    expect(exists('.claude/hooks/sweet-search-intercept-read.mjs')).toBe(false);
    expect(exists('.claude/hooks/sweet-search-remind-tools.mjs')).toBe(false);
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(false);
    if (exists('.claude/settings.json')) {
      expect(readJson('.claude/settings.json')).toEqual({});
    }
  });
});

describe('lifecycle: --no-claude (universal gate)', () => {
  it('init writes nothing under .claude/', () => {
    const r = runCli([...COMMON_INIT_ARGS, '--no-claude']);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(exists('.claude')).toBe(false);
    expect(exists('CLAUDE.md')).toBe(false);
  });

  it('init --no-claude --agents writes only AGENTS.md as canonical', () => {
    const r = runCli([...COMMON_INIT_ARGS, '--no-claude', '--agents']);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(exists('.claude')).toBe(false);
    expect(exists('CLAUDE.md')).toBe(false);
    expect(exists('AGENTS.md')).toBe(true);
    const agents = readFileSync(join(tmpRoot, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Sweet-search indexes the working tree'); // M++ body
    // No @CLAUDE.md import shim — AGENTS.md is the canonical body.
    expect(agents).not.toContain('@CLAUDE.md');
  });
});

describe('lifecycle: Claude CLI → MCP-only contact surface', () => {
  it('removes the CLI override and swaps the same rule file to the MCP body', () => {
    const cli = runCli(COMMON_INIT_ARGS);
    expect(cli.code, `CLI init failed: ${cli.stderr}`).toBe(0);
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(readFileSync(join(tmpRoot, CLAUDE_RULES_REL), 'utf8')).toBe(
      `${claudeRulesInternal.SENTINEL}\n${CANONICAL_POLICY_BODY}\n`,
    );

    const mcp = runCli([...COMMON_INIT_ARGS, '--mcp', '--no-cli']);
    expect(mcp.code, `MCP re-init failed: ${mcp.stderr}`).toBe(0);
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(false);
    expect(readJson('.claude/settings.json').outputStyle).toBeUndefined();
    expect(readFileSync(join(tmpRoot, CLAUDE_RULES_REL), 'utf8')).toBe(
      `${claudeRulesInternal.SENTINEL}\n${getMcpPolicyBody()}\n`,
    );
    expect(exists('CLAUDE.md')).toBe(false);
  });
});
