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
 *   A. default (`init`)  — CLAUDE.md only + .claude/ ecosystem + reminder
 *   B. strict + multi-harness (`init --enforce-tools --agents --gemini --cursor`)
 *      — full surface including Grep deny, Read hint hook, AGENTS.md,
 *      GEMINI.md symlink, cursor rule.
 *
 * Plan reference: §10 (init flow steps 11-17), P5 ("uninstall cleanup
 * for all init-owned instruction/settings mutations").
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  it('init creates CLAUDE.md + .claude/ ecosystem + reminder hook', () => {
    const r = runCli(COMMON_INIT_ARGS);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);

    // Harness file
    expect(exists('CLAUDE.md')).toBe(true);
    // No opt-in harness files
    expect(exists('AGENTS.md')).toBe(false);
    expect(exists('GEMINI.md')).toBe(false);
    expect(exists('.cursor/rules/sweet-search.mdc')).toBe(false);

    // .claude/ ecosystem
    expect(exists('.claude/rules/sweet-search.md')).toBe(true);
    expect(exists('.claude/hooks/index-maintainer.mjs')).toBe(true);
    expect(exists('.claude/skills/sweet-index/SKILL.md')).toBe(true);
    // P2: prompt reminder
    expect(exists('.claude/hooks/sweet-search-remind-tools.mjs')).toBe(true);
    const settings = readJson('.claude/settings.json');
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
    // P3: tool enforcement NOT installed without --enforce-tools
    expect(exists('.claude/hooks/sweet-search-intercept-read.mjs')).toBe(false);
    expect(settings.permissions).toBeUndefined();
    expect(settings.hooks.PreToolUse).toBeUndefined();
  });

  it('uninstall removes everything sweet-search-managed', () => {
    runCli(COMMON_INIT_ARGS);
    // Add user prose under the CLAUDE.md marker — must survive uninstall.
    writeFileSync(
      join(tmpRoot, 'CLAUDE.md'),
      readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf8') + '\n# my note\nKeep me.\n',
    );

    const r = runCli(['uninstall', '--force', '--keep-models']);
    expect(r.code, `uninstall failed: ${r.stderr}`).toBe(0);

    // .sweet-search/ gone
    expect(exists('.sweet-search')).toBe(false);
    // .claude/ artifacts gone
    expect(exists('.claude/rules/sweet-search.md')).toBe(false);
    expect(exists('.claude/hooks/index-maintainer.mjs')).toBe(false);
    expect(exists('.claude/skills/sweet-index')).toBe(false);
    expect(exists('.claude/hooks/sweet-search-remind-tools.mjs')).toBe(false);
    // settings.json may exist as `{}` after entries are stripped.
    if (exists('.claude/settings.json')) {
      expect(readJson('.claude/settings.json')).toEqual({});
    }
    // CLAUDE.md preserved with user prose; sweet-search marker stripped.
    expect(exists('CLAUDE.md')).toBe(true);
    const claude = readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf8');
    expect(claude).not.toContain('sweet-search:agent-instructions:begin');
    expect(claude).toContain('Keep me.');
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
    expect(exists('CLAUDE.md')).toBe(true);
    expect(exists('AGENTS.md')).toBe(true);
    expect(exists('GEMINI.md')).toBe(true);
    expect(exists('.cursor/rules/sweet-search.mdc')).toBe(true);

    // P3 enforcement landed
    expect(exists('.claude/hooks/sweet-search-intercept-read.mjs')).toBe(true);
    const settings = readJson('.claude/settings.json');
    expect(settings.permissions.deny).toContain('Grep');
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Read');
    // P2 still on
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
  });

  it('uninstall removes the full surface + enforcement + symlinks', () => {
    runCli(FULL_ARGS);
    const r = runCli(['uninstall', '--force', '--keep-models']);
    expect(r.code, `uninstall failed: ${r.stderr}`).toBe(0);

    // All harness files gone (CLAUDE.md was wholly managed → deleted; AGENTS.md
    // was an import shim → deleted; GEMINI.md was a symlink → unlinked; cursor
    // file was wholly managed → deleted).
    expect(exists('AGENTS.md')).toBe(false);
    expect(exists('GEMINI.md')).toBe(false);
    expect(exists('.cursor/rules/sweet-search.mdc')).toBe(false);
    // CLAUDE.md is wholly managed in this scenario (no user content added) →
    // file is deleted.
    expect(exists('CLAUDE.md')).toBe(false);

    // Enforcement gone
    expect(exists('.claude/hooks/sweet-search-intercept-read.mjs')).toBe(false);
    expect(exists('.claude/hooks/sweet-search-remind-tools.mjs')).toBe(false);
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
