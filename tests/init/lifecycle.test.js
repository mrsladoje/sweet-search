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
 *   A. default (`init`)  — lean harness whose main agent carries the rules, the pointer
 *      project rule ("V1b"); no CLAUDE.md
 *   B. strict + multi-harness (`init --enforce-tools --agents --gemini --cursor`)
 *      — full surface including opt-in Grep deny/Read hint, AGENTS.md,
 *      GEMINI.md symlink, cursor rule.
 *
 * Plan reference: §10 (init flow steps 11-17), P5 ("uninstall cleanup
 * for all init-owned instruction/settings mutations").
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  CLAUDE_LEAN_AGENT_NAME,
  CLAUDE_LEAN_AGENT_REL,
  CLAUDE_LEAN_HARNESS_DENY,
  CLAUDE_LEAN_MANIFEST_REL,
  CLAUDE_LEAN_PLAN_REL,
  CLAUDE_LEAN_SUBAGENT_REL,
} from '../../scripts/install-claude-lean-harness.js';
import {
  CANONICAL_POLICY_BODY,
  MARKER_BEGIN,
  MARKER_END,
  getMcpPolicyBody,
} from '../../scripts/inject-agent-instructions.js';
import {
  CLAUDE_RULES_POINTER,
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

// Hermetic: the rules-layout switch never leaks in from the developer's shell; a test that
// needs it passes it in `env`.
function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpRoot,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, SS_VARIANT_CC_RULES_IN_PROMPT: '', ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const readText = (rel) => readFileSync(join(tmpRoot, rel), 'utf8');
const FULL_RULE = `${claudeRulesInternal.SENTINEL}\n${CANONICAL_POLICY_BODY}\n`;
const POINTER_RULE = `${claudeRulesInternal.SENTINEL}\n${CLAUDE_RULES_POINTER}\n`;
const timesIn = (text, needle) => text.split(needle).length - 1;
// V1b: the main agent carries the policy exactly once, ahead of its memory section.
function expectRulesInAgent() {
  const agent = readText(CLAUDE_LEAN_AGENT_REL);
  expect(timesIn(agent, CANONICAL_POLICY_BODY)).toBe(1);
  expect(agent.indexOf(CANONICAL_POLICY_BODY)).toBeLessThan(agent.indexOf('# Session context'));
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
    expect(r.stderr).toContain('installed the sweet-search lean harness');
    expect(r.stderr).toContain('Start a new session');
    // The message names what changes and the opt-out; it no longer claims plan mode is off.
    expect(r.stderr).toContain('conflicts with the sweet-search rules');
    expect(r.stderr).toContain('--no-lean-harness');
    expect(r.stderr).not.toMatch(/unused tools off|plan mode, worktrees/);

    // Claude Code auto-loads the project rule; init never touches CLAUDE.md.
    expect(exists('CLAUDE.md')).toBe(false);
    // No opt-in harness files
    expect(exists('AGENTS.md')).toBe(false);
    expect(exists('GEMINI.md')).toBe(false);
    expect(exists('.cursor/rules/sweet-search.mdc')).toBe(false);

    // .claude/ ecosystem. V1b: the policy rides in the lean main agent (the system
    // prompt); the project rule is the short pointer.
    expect(exists(CLAUDE_RULES_REL)).toBe(true);
    expect(readText(CLAUDE_RULES_REL)).toBe(POINTER_RULE);
    expectRulesInAgent();
    expect(r.stderr).toContain('[init] Claude rules: created [pointer;');
    // The lean harness carries the override in the main-agent prompt; the output
    // style would only repeat it, so it is not installed.
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(false);
    expect(readFileSync(join(tmpRoot, CLAUDE_LEAN_AGENT_REL), 'utf8')).toContain(
      CLAUDE_SYSTEM_OVERRIDE,
    );
    expect(exists(CLAUDE_LEAN_SUBAGENT_REL)).toBe(true);
    expect(exists(CLAUDE_LEAN_PLAN_REL)).toBe(true);
    expect(exists('.claude/hooks/index-maintainer.mjs')).toBe(true);
    expect(exists('.claude/skills/sweet-index/SKILL.md')).toBe(true);
    // No duplicate hand-authored UserPromptSubmit guidance.
    expect(exists('.claude/hooks/sweet-search-remind-tools.mjs')).toBe(false);
    const settings = readJson('.claude/settings.json');
    expect(settings.outputStyle).toBeUndefined();
    expect(settings.agent).toBe(CLAUDE_LEAN_AGENT_NAME);
    expect(settings.hooks?.UserPromptSubmit).toBeUndefined();
    // P3: tool enforcement NOT installed without --enforce-tools (the lean
    // harness denies only search-delegation subagent types, never Grep).
    expect(exists('.claude/hooks/sweet-search-intercept-read.mjs')).toBe(false);
    expect(settings.permissions.deny).toEqual([...CLAUDE_LEAN_HARNESS_DENY]);
    expect(settings.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
    expect(settings.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS).toBeUndefined();
    expect(settings.hooks?.PreToolUse).toBeUndefined();
  });

  it('falls back to the output style and warns when settings.local.json selects another agent', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(tmpRoot, '.claude', 'settings.local.json'),
      JSON.stringify({ agent: 'my-agent' }, null, 2) + '\n',
    );

    const r = runCli(COMMON_INIT_ARGS);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(readJson('.claude/settings.local.json').agent).toBe('my-agent');
    expect(r.stderr).toContain('WARNING');
    expect(r.stderr).toContain('overrides the sweet-search lean harness');
    // The override still reaches the system prompt through the output style.
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(readJson('.claude/settings.json').outputStyle).toBe(
      CLAUDE_OUTPUT_STYLE_NAME,
    );
    // The lean agent is not the main prompt, so it must not take the rules: full rule file.
    expect(readText(CLAUDE_RULES_REL)).toBe(FULL_RULE);
    expect(readText(CLAUDE_LEAN_AGENT_REL)).not.toContain(CANONICAL_POLICY_BODY);
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
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_SUBAGENT_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_PLAN_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_MANIFEST_REL)).toBe(false);
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

describe('lifecycle: --no-lean-harness opt-out', () => {
  it('installs only the rules and the output style', () => {
    const r = runCli([...COMMON_INIT_ARGS, '--no-lean-harness']);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(exists(CLAUDE_RULES_REL)).toBe(true);
    expect(readText(CLAUDE_RULES_REL)).toBe(FULL_RULE);
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_PLAN_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_MANIFEST_REL)).toBe(false);
    const settings = readJson('.claude/settings.json');
    expect(settings.outputStyle).toBe(CLAUDE_OUTPUT_STYLE_NAME);
    expect(settings.agent).toBeUndefined();
    expect(settings.permissions?.deny ?? []).toEqual([]);
    expect(r.stderr).not.toContain('installed the sweet-search lean harness');
  });

  it('removes a lean harness that an earlier init installed', () => {
    expect(runCli(COMMON_INIT_ARGS).code).toBe(0);
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(true);
    const r = runCli([...COMMON_INIT_ARGS, '--no-lean-harness']);
    expect(r.code, `re-init failed: ${r.stderr}`).toBe(0);
    expect(r.stderr).toContain('lean harness removed (--no-lean-harness)');
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_SUBAGENT_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_PLAN_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_MANIFEST_REL)).toBe(false);
    const settings = readJson('.claude/settings.json');
    expect(settings.agent).toBeUndefined();
    expect(settings.env).toBeUndefined();
    expect(settings.outputStyle).toBe(CLAUDE_OUTPUT_STYLE_NAME);
    // The agent file that carried the rules is gone, so the rule file carries them again.
    expect(readText(CLAUDE_RULES_REL)).toBe(FULL_RULE);
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
    expect(readText(CLAUDE_RULES_REL)).toBe(POINTER_RULE);
    expectRulesInAgent();
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
    expect(settings.agent).toBe(CLAUDE_LEAN_AGENT_NAME);
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
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(false);
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
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(true);
    expect(readText(CLAUDE_RULES_REL)).toBe(POINTER_RULE);

    const mcp = runCli([...COMMON_INIT_ARGS, '--mcp', '--no-cli']);
    expect(mcp.code, `MCP re-init failed: ${mcp.stderr}`).toBe(0);
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(false);
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(false);
    expect(readJson('.claude/settings.json').outputStyle).toBeUndefined();
    expect(readJson('.claude/settings.json').agent).toBeUndefined();
    expect(readFileSync(join(tmpRoot, CLAUDE_RULES_REL), 'utf8')).toBe(
      `${claudeRulesInternal.SENTINEL}\n${getMcpPolicyBody()}\n`,
    );
    expect(exists('CLAUDE.md')).toBe(false);
  });
});

// V1b: with the lean harness active, the policy rides in the main agent file and the
// project rule is a pointer. Every other state keeps the full rule file (2.8.2 layout).
describe('lifecycle: V1b rules placement', () => {
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  const CLAUDE_FILES = [CLAUDE_RULES_REL, CLAUDE_LEAN_AGENT_REL, CLAUDE_LEAN_SUBAGENT_REL, CLAUDE_LEAN_PLAN_REL, CLAUDE_LEAN_MANIFEST_REL, '.claude/settings.json'];
  const snapshot = () => Object.fromEntries(CLAUDE_FILES.map((rel) => [rel, exists(rel) ? readText(rel) : null]));
  const OPT_OUT = { SS_VARIANT_CC_RULES_IN_PROMPT: '0' };

  it('the opt-out installs the 2.8.2 layout: full rule file, agent file without the rules', () => {
    const r = runCli(COMMON_INIT_ARGS, OPT_OUT);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(readText(CLAUDE_RULES_REL)).toBe(FULL_RULE);
    expect(readText(CLAUDE_LEAN_AGENT_REL)).not.toContain(CANONICAL_POLICY_BODY);
    expect(r.stderr).not.toContain('[pointer;');
  });

  it('upgrades a 2.8.2 install in place, keeps the manifest consistent, and re-init is a no-op', () => {
    expect(runCli(COMMON_INIT_ARGS, OPT_OUT).code).toBe(0);   // the 2.8.2 layout
    const before = snapshot();
    const up = runCli(COMMON_INIT_ARGS);
    expect(up.code, `upgrade failed: ${up.stderr}`).toBe(0);
    expect(up.stderr).toContain('[init] Claude rules: updated [pointer;');
    const after = snapshot();
    expect(after[CLAUDE_RULES_REL]).toBe(POINTER_RULE);
    expectRulesInAgent();
    // Only the rule file, the main agent and the manifest hash change.
    expect(after[CLAUDE_LEAN_SUBAGENT_REL]).toBe(before[CLAUDE_LEAN_SUBAGENT_REL]);
    expect(after[CLAUDE_LEAN_PLAN_REL]).toBe(before[CLAUDE_LEAN_PLAN_REL]);
    expect(after['.claude/settings.json']).toBe(before['.claude/settings.json']);
    expect(after[CLAUDE_LEAN_AGENT_REL].replace(`${CANONICAL_POLICY_BODY}\n\n`, '')).toBe(before[CLAUDE_LEAN_AGENT_REL]);
    const m = readJson(CLAUDE_LEAN_MANIFEST_REL);
    for (const rel of [CLAUDE_LEAN_AGENT_REL, CLAUDE_LEAN_SUBAGENT_REL, CLAUDE_LEAN_PLAN_REL]) {
      expect(m.files[rel]).toBe(sha(readText(rel)));
    }
    // Idempotent: a third run changes no byte and reports the rule as unchanged.
    const again = runCli(COMMON_INIT_ARGS);
    expect(again.code).toBe(0);
    expect(again.stderr).toContain('[init] Claude rules: unchanged [pointer;');
    expect(snapshot()).toEqual(after);
  });

  it('the opt-out after an upgrade restores the exact 2.8.2 layout', () => {
    expect(runCli(COMMON_INIT_ARGS, OPT_OUT).code).toBe(0);
    const old = snapshot();
    expect(runCli(COMMON_INIT_ARGS).code).toBe(0);
    expect(runCli(COMMON_INIT_ARGS, OPT_OUT).code).toBe(0);
    expect(snapshot()).toEqual(old);
  });

  it('keeps a user-authored rule file untouched; the agent still carries the rules', () => {
    const mine = '# My sweet-search rules\nNo sentinel.\n';
    mkdirSync(join(tmpRoot, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, CLAUDE_RULES_REL), mine);
    const r = runCli(COMMON_INIT_ARGS);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(readText(CLAUDE_RULES_REL)).toBe(mine);
    expect(r.stderr).toContain('[init] Claude rules: preserved-user-file [pointer;');
    expect(r.stderr).toContain('is user-authored and was kept');
    expectRulesInAgent();
    const u = runCli(['uninstall', '--force', '--keep-models']);
    expect(u.code, `uninstall failed: ${u.stderr}`).toBe(0);
    expect(readText(CLAUDE_RULES_REL)).toBe(mine);
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(false);
  });

  it('a user-selected main agent keeps the full rule file and gets no lean agent file', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(join(tmpRoot, '.claude', 'settings.json'), JSON.stringify({ agent: 'my-agent' }));
    const r = runCli(COMMON_INIT_ARGS);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(readText(CLAUDE_RULES_REL)).toBe(FULL_RULE);
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(false);
  });

  it('a user-edited lean agent file (harness not active) keeps the full rule file', () => {
    expect(runCli(COMMON_INIT_ARGS).code).toBe(0);
    const edited = `${readText(CLAUDE_LEAN_AGENT_REL)}\nmy addition\n`;
    writeFileSync(join(tmpRoot, CLAUDE_LEAN_AGENT_REL), edited);
    const r = runCli(COMMON_INIT_ARGS);
    expect(r.code, `re-init failed: ${r.stderr}`).toBe(0);
    expect(readText(CLAUDE_LEAN_AGENT_REL)).toBe(edited);
    expect(readText(CLAUDE_RULES_REL)).toBe(FULL_RULE);
  });

  it('an unknown switch value warns and installs the default', () => {
    const r = runCli(COMMON_INIT_ARGS, { SS_VARIANT_CC_RULES_IN_PROMPT: 'yes' });
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);
    expect(r.stderr).toContain('SS_VARIANT_CC_RULES_IN_PROMPT=yes is not 0, 1 or 2');
    expect(readText(CLAUDE_RULES_REL)).toBe(POINTER_RULE);
    expectRulesInAgent();
  });

  it('uninstall after an upgrade leaves no Claude Code file behind', () => {
    expect(runCli(COMMON_INIT_ARGS, OPT_OUT).code).toBe(0);
    expect(runCli(COMMON_INIT_ARGS).code).toBe(0);
    const u = runCli(['uninstall', '--force', '--keep-models']);
    expect(u.code, `uninstall failed: ${u.stderr}`).toBe(0);
    for (const rel of CLAUDE_FILES) {
      if (rel === '.claude/settings.json' && exists(rel)) expect(readJson(rel)).toEqual({});
      else expect(exists(rel), rel).toBe(false);
    }
    expect(exists('.claude/rules')).toBe(false);
    expect(exists('.claude/agents')).toBe(false);
  });
});
