/**
 * Unit tests for `scripts/inject-agent-instructions.js` and
 * `scripts/write-claude-rules.js`. Plan reference: P1 (§4A, §4B, §10).
 *
 * Claude Code gets the verbatim policy through its auto-loaded project rule;
 * CLAUDE.md stays untouched. AGENTS.md directly carries the same policy for
 * Codex/OpenCode. Gemini may share AGENTS.md; Cursor inlines the body.
 *
 * Each test runs in an isolated tmpdir so the project root is never touched.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, lstatSync, readlinkSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ALL_HARNESSES,
  AGENTS_FILE,
  CLAUDE_FILE,
  CURSOR_FILE,
  GEMINI_FILE,
  MARKER_BEGIN,
  MARKER_END,
  CANONICAL_POLICY_BODY,
  injectAgentInstructions,
  removeAgentInstructions,
} from '../../scripts/inject-agent-instructions.js';
import {
  CLAUDE_RULES_REL,
  removeClaudeRules,
  writeClaudeRules,
  _internal as claudeRulesInternal,
} from '../../scripts/write-claude-rules.js';
import {
  CLAUDE_OUTPUT_STYLE_NAME,
  CLAUDE_OUTPUT_STYLE_REL,
  CLAUDE_LOCAL_SETTINGS_REL,
  CLAUDE_SETTINGS_REL,
  CLAUDE_SYSTEM_OVERRIDE,
  formatClaudeSystemPromptGuidance,
  installClaudeSystemPrompt,
  removeClaudeSystemPrompt,
  _internal as claudeSystemPromptInternal,
} from '../../scripts/install-claude-system-prompt.js';
import { parseInitArgs, resolveActiveHarnesses } from '../../scripts/init.js';

let tmpRoot;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sweet-search-init-test-'));
});
afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

const read = (rel) => readFileSync(join(tmpRoot, rel), 'utf8');
const exists = (rel) => existsSync(join(tmpRoot, rel));

describe('injectAgentInstructions — fresh install (rule-only Claude)', () => {
  it('leaves CLAUDE.md absent and writes direct non-Claude policy surfaces', () => {
    const r = injectAgentInstructions({ projectRoot: tmpRoot });
    expect(r.canonical).toBe('agents');
    expect(r.harnesses['claude-code']).toBe('untouched');
    expect(r.harnesses.agents).toBe('created');
    expect(r.harnesses.gemini).toBe('created');
    expect(r.harnesses.cursor).toBe('created');
    expect(exists(CLAUDE_FILE)).toBe(false);

    // AGENTS.md directly carries the full policy for Codex/OpenCode.
    const agents = read(AGENTS_FILE);
    expect(agents).toContain(MARKER_BEGIN);
    expect(agents).toContain(MARKER_END);
    expect(agents).toContain('Sweet-search indexes the working tree');
    expect(agents).toContain('trust the top ranked result outright');
    expect(agents).toContain('a fix covering only the first matching site is not done');
    expect(agents).not.toContain('@CLAUDE.md');

    // GEMINI.md shares the direct AGENTS.md policy.
    const stat = lstatSync(join(tmpRoot, GEMINI_FILE));
    expect(stat.isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(tmpRoot, GEMINI_FILE))).toBe(AGENTS_FILE);

    // Cursor rule has frontmatter + canonical body inside marker.
    const cursor = read(CURSOR_FILE);
    expect(cursor).toMatch(/^---\n[\s\S]+?\n---\n/);
    expect(cursor).toContain('alwaysApply: false');
    expect(cursor).toContain('Sweet-search indexes the working tree');
  });

  it('keeps AGENTS.md canonical when Claude Code is disabled', () => {
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['agents', 'gemini', 'cursor'],
    });
    expect(r.canonical).toBe('agents');
    expect(r.harnesses['claude-code']).toBeUndefined();
    expect(exists(CLAUDE_FILE)).toBe(false);

    // AGENTS.md contains the full policy body.
    const agents = read(AGENTS_FILE);
    expect(agents).toContain('Sweet-search indexes the working tree');
    expect(agents).not.toContain('@CLAUDE.md');

    // GEMINI.md symlinks to AGENTS.md.
    expect(readlinkSync(join(tmpRoot, GEMINI_FILE))).toBe(AGENTS_FILE);
  });

  it('respects opt-in subset (no --agents → no AGENTS.md)', () => {
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'gemini', 'cursor'],
    });
    expect(r.canonical).toBe('gemini');
    expect(r.harnesses['claude-code']).toBe('untouched');
    expect(r.harnesses.agents).toBeUndefined();
    expect(exists(CLAUDE_FILE)).toBe(false);
    expect(exists(AGENTS_FILE)).toBe(false);
    expect(exists(GEMINI_FILE)).toBe(true);
    expect(lstatSync(join(tmpRoot, GEMINI_FILE)).isSymbolicLink()).toBe(false);
    expect(read(GEMINI_FILE)).toContain('Sweet-search indexes the working tree');
    expect(exists(CURSOR_FILE)).toBe(true);
  });

  it('uses an AGENTS.md import when Gemini symlinks are disabled', () => {
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'agents', 'gemini'],
      useSymlinks: false,
    });
    expect(r.harnesses.gemini).toBe('created');
    const stat = lstatSync(join(tmpRoot, GEMINI_FILE));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(read(GEMINI_FILE)).toContain('@AGENTS.md');
    expect(read(GEMINI_FILE)).not.toContain('@CLAUDE.md');
  });

  it('returns empty report when no harnesses are enabled', () => {
    const r = injectAgentInstructions({ projectRoot: tmpRoot, harnesses: [] });
    expect(r.harnesses).toEqual({});
    expect(r.canonical).toBeNull();
    expect(exists(CLAUDE_FILE)).toBe(false);
    expect(exists(AGENTS_FILE)).toBe(false);
  });

  it('throws on missing projectRoot', () => {
    expect(() => injectAgentInstructions({})).toThrow(/projectRoot is required/);
  });
});

describe('injectAgentInstructions — idempotent rewrite', () => {
  it('rewrites AGENTS.md idempotently without marker duplication', () => {
    injectAgentInstructions({ projectRoot: tmpRoot });
    const after1 = read(AGENTS_FILE);

    const r2 = injectAgentInstructions({ projectRoot: tmpRoot });
    expect(r2.harnesses['claude-code']).toBe('untouched');
    expect(r2.harnesses.agents).toBe('unchanged');
    expect(read(AGENTS_FILE)).toBe(after1);
    expect(exists(CLAUDE_FILE)).toBe(false);

    // Single marker pair only — re-running never duplicates.
    const begins = (after1.match(new RegExp(escapeRegex(MARKER_BEGIN), 'g')) ?? []).length;
    const ends = (after1.match(new RegExp(escapeRegex(MARKER_END), 'g')) ?? []).length;
    expect(begins).toBe(1);
    expect(ends).toBe(1);
  });

  it('leaves a user-authored CLAUDE.md byte-identical', () => {
    const original = '# My project\n\nUser-authored content.\n';
    writeFileSync(join(tmpRoot, CLAUDE_FILE), original);
    const r = injectAgentInstructions({ projectRoot: tmpRoot, harnesses: ['claude-code'] });
    expect(r.harnesses['claude-code']).toBe('untouched');
    expect(read(CLAUDE_FILE)).toBe(original);
  });

  it('migrates the legacy managed CLAUDE.md block while preserving user prose', () => {
    writeFileSync(
      join(tmpRoot, CLAUDE_FILE),
      `${MARKER_BEGIN}\nlegacy sweet-search policy\n${MARKER_END}\n\n# Project Claude rules\nKeep me.\n`,
    );
    const r = injectAgentInstructions({ projectRoot: tmpRoot, harnesses: ['claude-code'] });
    expect(r.harnesses['claude-code']).toBe('legacy-block-removed');
    const text = read(CLAUDE_FILE);
    expect(text).not.toContain(MARKER_BEGIN);
    expect(text).not.toContain('legacy sweet-search policy');
    expect(text).toContain('# Project Claude rules');
    expect(text).toContain('Keep me.');
  });
});

describe('injectAgentInstructions — symlink edge cases', () => {
  it('prepends the direct policy when GEMINI.md already exists as a regular file', () => {
    writeFileSync(join(tmpRoot, GEMINI_FILE), '# Existing Gemini config\n');
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'gemini'],
    });
    expect(r.harnesses.gemini).toBe('prepended');
    const stat = lstatSync(join(tmpRoot, GEMINI_FILE));
    expect(stat.isSymbolicLink()).toBe(false);
    const text = read(GEMINI_FILE);
    expect(text).toContain('Existing Gemini config');
    expect(text).toContain(MARKER_BEGIN);
    expect(text).toContain('Sweet-search indexes the working tree');
    expect(text).not.toContain('@CLAUDE.md');
  });

  it('detects an already-correct AGENTS.md symlink as no-op', () => {
    injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'agents', 'gemini'],
    });
    const r2 = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'agents', 'gemini'],
    });
    expect(r2.harnesses.gemini).toBe('already-correct');
  });

  it('migrates an old GEMINI.md → CLAUDE.md symlink to AGENTS.md', () => {
    writeFileSync(join(tmpRoot, CLAUDE_FILE), '# user Claude instructions\n');
    symlinkSync(CLAUDE_FILE, join(tmpRoot, GEMINI_FILE));
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'agents', 'gemini'],
    });
    expect(r.harnesses.gemini).toBe('created');
    expect(readlinkSync(join(tmpRoot, GEMINI_FILE))).toBe(AGENTS_FILE);
    expect(read(CLAUDE_FILE)).toBe('# user Claude instructions\n');
  });
});

describe('removeAgentInstructions', () => {
  it('removes non-Claude managed surfaces without creating CLAUDE.md', () => {
    injectAgentInstructions({ projectRoot: tmpRoot });

    const r = removeAgentInstructions({ projectRoot: tmpRoot });
    expect(r.harnesses['claude-code']).toBe('not-found');
    expect(r.harnesses.agents).toBe('file-deleted');
    expect(r.harnesses.gemini).toBe('removed');
    expect(r.harnesses.cursor).toBe('file-deleted');

    expect(exists(CLAUDE_FILE)).toBe(false);
    expect(exists(AGENTS_FILE)).toBe(false);
    expect(exists(GEMINI_FILE)).toBe(false);
    expect(exists(CURSOR_FILE)).toBe(false);
  });

  it('removes a legacy managed CLAUDE.md block and preserves user prose', () => {
    writeFileSync(
      join(tmpRoot, CLAUDE_FILE),
      `${MARKER_BEGIN}\nlegacy\n${MARKER_END}\n\n# My note\nKeep me.\n`,
    );
    const r = removeAgentInstructions({ projectRoot: tmpRoot });
    expect(r.harnesses['claude-code']).toBe('removed');
    const claude = read(CLAUDE_FILE);
    expect(claude).not.toContain(MARKER_BEGIN);
    expect(claude).toContain('Keep me.');
  });

  it('dry-run reports without modifying anything', () => {
    injectAgentInstructions({ projectRoot: tmpRoot });
    const before = read(AGENTS_FILE);
    const r = removeAgentInstructions({ projectRoot: tmpRoot, dryRun: true });
    expect(r.harnesses['claude-code']).toBe('not-found');
    expect(r.harnesses.agents).toBe('dry-run');
    expect(r.harnesses.gemini).toBe('dry-run');
    expect(r.harnesses.cursor).toBe('dry-run');
    expect(read(AGENTS_FILE)).toBe(before);
  });

  it('preserves user-customised cursor file (no marker → no removal)', () => {
    mkdirSync(join(tmpRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, CURSOR_FILE), '---\ndescription: Mine\n---\n\nbody\n');
    const r = removeAgentInstructions({ projectRoot: tmpRoot });
    expect(r.harnesses.cursor).toBe('not-our-symlink');
    expect(exists(CURSOR_FILE)).toBe(true);
  });

  it('preserves a user-created GEMINI.md symlink that does not point at our canonical', () => {
    writeFileSync(join(tmpRoot, 'OTHER.md'), 'other');
    symlinkSync('OTHER.md', join(tmpRoot, GEMINI_FILE));
    const r = removeAgentInstructions({ projectRoot: tmpRoot });
    expect(r.harnesses.gemini).toBe('not-found');
    expect(lstatSync(join(tmpRoot, GEMINI_FILE)).isSymbolicLink()).toBe(true);
  });

  it('removes GEMINI.md symlink that points at AGENTS.md (claude-disabled install)', () => {
    injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['agents', 'gemini'],
    });
    expect(readlinkSync(join(tmpRoot, GEMINI_FILE))).toBe(AGENTS_FILE);
    const r = removeAgentInstructions({ projectRoot: tmpRoot });
    expect(r.harnesses.gemini).toBe('removed');
    expect(exists(GEMINI_FILE)).toBe(false);
  });

  it('throws on missing projectRoot', () => {
    expect(() => removeAgentInstructions({})).toThrow(/projectRoot is required/);
  });
});

describe('writeClaudeRules / removeClaudeRules', () => {
  it('creates an ownership comment plus the verbatim M± body only', () => {
    expect(writeClaudeRules({ projectRoot: tmpRoot })).toBe('created');
    const text = read(CLAUDE_RULES_REL);
    expect(text).toBe(`${claudeRulesInternal.SENTINEL}\n${CANONICAL_POLICY_BODY}\n`);
    expect(text).not.toContain('These supplement the canonical');
    expect(text).not.toContain('Use native `Grep` only for trivial');
    expect(text).not.toContain('You are resolving a real software issue');
    expect(text).not.toContain('=== TASK COMPLETION');
  });

  it('is idempotent: re-running with unchanged content reports unchanged', () => {
    writeClaudeRules({ projectRoot: tmpRoot });
    expect(writeClaudeRules({ projectRoot: tmpRoot })).toBe('unchanged');
  });

  it('preserves user-authored .claude/rules/sweet-search.md', () => {
    mkdirSync(join(tmpRoot, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, CLAUDE_RULES_REL), '# My rules\nNo sentinel.\n');
    expect(writeClaudeRules({ projectRoot: tmpRoot })).toBe('preserved-user-file');
    expect(read(CLAUDE_RULES_REL)).toBe('# My rules\nNo sentinel.\n');
  });

  it('upgrades the legacy hand-authored managed rule to verbatim M±', () => {
    mkdirSync(join(tmpRoot, '.claude', 'rules'), { recursive: true });
    writeFileSync(
      join(tmpRoot, CLAUDE_RULES_REL),
      `${claudeRulesInternal.LEGACY_SENTINEL}\nlegacy contradictory guidance\n`,
    );
    expect(writeClaudeRules({ projectRoot: tmpRoot })).toBe('updated');
    expect(read(CLAUDE_RULES_REL)).toBe(
      `${claudeRulesInternal.SENTINEL}\n${CANONICAL_POLICY_BODY}\n`,
    );
  });

  it('removeClaudeRules deletes only sentinel-tagged files', () => {
    writeClaudeRules({ projectRoot: tmpRoot });
    expect(removeClaudeRules({ projectRoot: tmpRoot, dryRun: true })).toBe('dry-run');
    expect(removeClaudeRules({ projectRoot: tmpRoot })).toBe('removed');
    expect(exists(CLAUDE_RULES_REL)).toBe(false);
  });

  it('removeClaudeRules preserves files without our sentinel', () => {
    mkdirSync(join(tmpRoot, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(tmpRoot, CLAUDE_RULES_REL), '# Mine\n');
    expect(removeClaudeRules({ projectRoot: tmpRoot })).toBe('preserved-user-file');
    expect(exists(CLAUDE_RULES_REL)).toBe(true);
  });

  it('throws on missing projectRoot', () => {
    expect(() => writeClaudeRules({})).toThrow(/projectRoot is required/);
    expect(() => removeClaudeRules({})).toThrow(/projectRoot is required/);
  });
});

describe('installClaudeSystemPrompt / removeClaudeSystemPrompt', () => {
  it('installs the exact compact override at system-prompt priority without benchmark framing', () => {
    const result = installClaudeSystemPrompt({ projectRoot: tmpRoot });
    expect(result.status).toBe('installed');

    const style = read(CLAUDE_OUTPUT_STYLE_REL);
    expect(style).toContain('keep-coding-instructions: true');
    expect(style).toContain(claudeSystemPromptInternal.SENTINEL);
    expect(style).toContain(CLAUDE_SYSTEM_OVERRIDE);
    expect(CLAUDE_SYSTEM_OVERRIDE).toContain('`.claude/rules/sweet-search.md`');
    expect(CLAUDE_SYSTEM_OVERRIDE).not.toContain('guidance in CLAUDE.md');
    expect(style).not.toContain('You are resolving a real software issue');
    expect(style).not.toContain('=== TASK COMPLETION');

    const settings = JSON.parse(read(CLAUDE_SETTINGS_REL));
    expect(settings.outputStyle).toBe(CLAUDE_OUTPUT_STYLE_NAME);
  });

  it('is idempotent and preserves unrelated Claude settings', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(tmpRoot, CLAUDE_SETTINGS_REL),
      JSON.stringify({ permissions: { allow: ['Bash(ss-*:*)'] } }, null, 2) + '\n',
    );

    expect(installClaudeSystemPrompt({ projectRoot: tmpRoot }).status).toBe('installed');
    expect(installClaudeSystemPrompt({ projectRoot: tmpRoot }).status).toBe('unchanged');
    expect(JSON.parse(read(CLAUDE_SETTINGS_REL))).toEqual({
      permissions: { allow: ['Bash(ss-*:*)'] },
      outputStyle: CLAUDE_OUTPUT_STYLE_NAME,
    });
  });

  it('preserves an existing selected output style instead of replacing it', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(tmpRoot, CLAUDE_SETTINGS_REL),
      JSON.stringify({ outputStyle: 'Explanatory', theme: 'dark' }, null, 2) + '\n',
    );

    const result = installClaudeSystemPrompt({ projectRoot: tmpRoot });
    expect(result.status).toBe('preserved-existing');
    expect(result.active).toBe(false);
    expect(result.warning).toContain(CLAUDE_SETTINGS_REL);
    // Install the style even though it is not selected, so users can switch
    // to it directly from Claude Code's `/config` picker.
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(JSON.parse(read(CLAUDE_SETTINGS_REL))).toEqual({
      outputStyle: 'Explanatory',
      theme: 'dark',
    });
  });

  it('detects a higher-priority settings.local.json output-style override', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(tmpRoot, CLAUDE_LOCAL_SETTINGS_REL),
      JSON.stringify({ outputStyle: 'Learning', theme: 'dark' }, null, 2) + '\n',
    );

    const result = installClaudeSystemPrompt({ projectRoot: tmpRoot });
    expect(result.status).toBe('preserved-existing');
    expect(result.active).toBe(false);
    expect(result.warning).toContain(CLAUDE_LOCAL_SETTINGS_REL);
    expect(result.warning).toContain('"Learning"');
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(JSON.parse(read(CLAUDE_SETTINGS_REL)).outputStyle).toBe(
      CLAUDE_OUTPUT_STYLE_NAME,
    );
    expect(JSON.parse(read(CLAUDE_LOCAL_SETTINGS_REL))).toEqual({
      outputStyle: 'Learning',
      theme: 'dark',
    });
  });

  it('warns when settings.local.json is invalid without leaving a partial install', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(join(tmpRoot, CLAUDE_LOCAL_SETTINGS_REL), '{not json');

    const result = installClaudeSystemPrompt({ projectRoot: tmpRoot });
    expect(result.status).toBe('installed');
    expect(result.active).toBeNull();
    expect(result.warning).toContain('is not valid JSON');
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(JSON.parse(read(CLAUDE_SETTINGS_REL)).outputStyle).toBe(
      CLAUDE_OUTPUT_STYLE_NAME,
    );
  });

  it('refuses invalid settings without leaving a partial style', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(join(tmpRoot, CLAUDE_SETTINGS_REL), '{not json');

    const result = installClaudeSystemPrompt({ projectRoot: tmpRoot });
    expect(result.status).toBe('error');
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(false);
  });

  it('dry-runs, then removes only the owned style and setting', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(tmpRoot, CLAUDE_SETTINGS_REL),
      JSON.stringify({ theme: 'dark' }, null, 2) + '\n',
    );
    installClaudeSystemPrompt({ projectRoot: tmpRoot });

    expect(removeClaudeSystemPrompt({ projectRoot: tmpRoot, dryRun: true }).status).toBe('dry-run');
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(true);
    expect(removeClaudeSystemPrompt({ projectRoot: tmpRoot }).status).toBe('removed');
    expect(exists(CLAUDE_OUTPUT_STYLE_REL)).toBe(false);
    expect(JSON.parse(read(CLAUDE_SETTINGS_REL))).toEqual({ theme: 'dark' });
  });

  it('preserves a user-authored style at the same path and its selection', () => {
    mkdirSync(join(tmpRoot, '.claude', 'output-styles'), { recursive: true });
    writeFileSync(join(tmpRoot, CLAUDE_OUTPUT_STYLE_REL), '# My style\n');
    writeFileSync(
      join(tmpRoot, CLAUDE_SETTINGS_REL),
      JSON.stringify({ outputStyle: CLAUDE_OUTPUT_STYLE_NAME }, null, 2) + '\n',
    );

    expect(installClaudeSystemPrompt({ projectRoot: tmpRoot }).status).toBe('preserved-existing');
    expect(removeClaudeSystemPrompt({ projectRoot: tmpRoot }).status).toBe('not-found');
    expect(read(CLAUDE_OUTPUT_STYLE_REL)).toBe('# My style\n');
    expect(JSON.parse(read(CLAUDE_SETTINGS_REL)).outputStyle).toBe(CLAUDE_OUTPUT_STYLE_NAME);
  });

  it('formats prominent activation and conflict guidance', () => {
    const active = formatClaudeSystemPromptGuidance({ status: 'installed', active: true });
    expect(active).toContain('activated the `sweet-search` output style');
    expect(active).toContain('new session or run `/clear`');
    expect(active).toContain('Keep this style selected');

    const conflict = formatClaudeSystemPromptGuidance({
      status: 'preserved-existing',
      active: false,
      conflict: 'selection',
      warning: `${CLAUDE_LOCAL_SETTINGS_REL} currently selects "Learning".`,
    });
    expect(conflict).toContain('WARNING');
    expect(conflict).toContain(
      'system-prompt routing is not active because another output style overrides it',
    );
    expect(conflict).toContain('Select `sweet-search` under `/config`');
  });
});

describe('parseInitArgs — opt-in defaults + universal --no-claude', () => {
  it('default: only claude-code is active', () => {
    const args = parseInitArgs([]);
    expect(args.skipAgentInstructions).toBe(false);
    expect(args.symlinkInstructionFiles).toBe(true);
    expect(args.noClaude).toBe(false);
    expect([...args.optInHarnesses]).toEqual([]);
    expect(resolveActiveHarnesses(args)).toEqual(['claude-code']);
  });

  it('--agents adds AGENTS.md on top of claude-code', () => {
    const args = parseInitArgs(['--agents']);
    expect([...args.optInHarnesses]).toEqual(['agents']);
    expect(resolveActiveHarnesses(args)).toEqual(['claude-code', 'agents']);
  });

  it('--gemini --cursor stacks both on top of claude-code', () => {
    const args = parseInitArgs(['--gemini', '--cursor']);
    expect([...args.optInHarnesses].sort()).toEqual(['cursor', 'gemini']);
    expect(resolveActiveHarnesses(args)).toEqual(['claude-code', 'gemini', 'cursor']);
  });

  it('--no-claude alone leaves the active set empty', () => {
    const args = parseInitArgs(['--no-claude']);
    expect(args.noClaude).toBe(true);
    expect(resolveActiveHarnesses(args)).toEqual([]);
  });

  it('--no-claude --agents makes AGENTS.md the canonical fallback', () => {
    const args = parseInitArgs(['--no-claude', '--agents']);
    expect(args.noClaude).toBe(true);
    expect([...args.optInHarnesses]).toEqual(['agents']);
    expect(resolveActiveHarnesses(args)).toEqual(['agents']);
  });

  it('--no-agent-instructions sets the umbrella flag', () => {
    const args = parseInitArgs(['--no-agent-instructions']);
    expect(args.skipAgentInstructions).toBe(true);
  });

  it('--no-symlink-instruction-files toggles symlinks off', () => {
    const args = parseInitArgs(['--no-symlink-instruction-files']);
    expect(args.symlinkInstructionFiles).toBe(false);
  });
});

describe('ALL_HARNESSES export', () => {
  it('contains the four documented harnesses with claude-code first', () => {
    expect(ALL_HARNESSES).toEqual(['claude-code', 'agents', 'gemini', 'cursor']);
  });
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
