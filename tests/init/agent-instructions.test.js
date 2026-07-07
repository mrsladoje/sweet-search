/**
 * Unit tests for `scripts/inject-agent-instructions.js` and
 * `scripts/write-claude-rules.js`. Plan reference: P1 (§4A, §4B, §10).
 *
 * Canonical source: CLAUDE.md when claude-code is enabled (default), else
 * AGENTS.md. Other harnesses get @import / symlink shims to the canonical.
 * (This diverges from plan §3.3 which framed AGENTS.md as canonical — see
 * the inject-agent-instructions.js header for rationale.)
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
  injectAgentInstructions,
  removeAgentInstructions,
} from '../../scripts/inject-agent-instructions.js';
import {
  CLAUDE_RULES_REL,
  removeClaudeRules,
  writeClaudeRules,
  _internal as claudeRulesInternal,
} from '../../scripts/write-claude-rules.js';
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

describe('injectAgentInstructions — fresh install (claude-code canonical)', () => {
  it('writes CLAUDE.md (canonical) + AGENTS.md import + GEMINI.md symlink + cursor rule', () => {
    const r = injectAgentInstructions({ projectRoot: tmpRoot });
    expect(r.canonical).toBe('claude-code');
    expect(r.harnesses['claude-code']).toBe('created');
    expect(r.harnesses.agents).toBe('created');
    expect(r.harnesses.gemini).toBe('created');
    expect(r.harnesses.cursor).toBe('created');

    // CLAUDE.md is canonical: contains the full policy body + the .claude/rules import.
    const claude = read(CLAUDE_FILE);
    expect(claude).toContain(MARKER_BEGIN);
    expect(claude).toContain(MARKER_END);
    expect(claude).toContain('Sweet-search indexes the working tree'); // M++ body
    expect(claude).toContain('trust the top ranked result outright'); // M+++++ verdict-gated stop discipline
    expect(claude).toContain('@.claude/rules/sweet-search.md');

    // AGENTS.md is a thin import shim → CLAUDE.md.
    const agents = read(AGENTS_FILE);
    expect(agents).toContain('@CLAUDE.md');
    expect(agents).not.toContain('Sweet-search indexes the working tree');

    // GEMINI.md is a symlink → CLAUDE.md (relative).
    const stat = lstatSync(join(tmpRoot, GEMINI_FILE));
    expect(stat.isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(tmpRoot, GEMINI_FILE))).toBe(CLAUDE_FILE);

    // Cursor rule has frontmatter + canonical body inside marker.
    const cursor = read(CURSOR_FILE);
    expect(cursor).toMatch(/^---\n[\s\S]+?\n---\n/);
    expect(cursor).toContain('alwaysApply: false');
    expect(cursor).toContain('Sweet-search indexes the working tree');
  });

  it('falls back to AGENTS.md canonical when --no-claude-code', () => {
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['agents', 'gemini', 'cursor'],
    });
    expect(r.canonical).toBe('agents');
    expect(r.harnesses['claude-code']).toBeUndefined();
    expect(exists(CLAUDE_FILE)).toBe(false);

    // AGENTS.md now contains the full policy body.
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
    expect(r.canonical).toBe('claude-code');
    expect(r.harnesses['claude-code']).toBe('created');
    expect(r.harnesses.agents).toBeUndefined();
    expect(exists(AGENTS_FILE)).toBe(false);
    expect(exists(GEMINI_FILE)).toBe(true);
    expect(exists(CURSOR_FILE)).toBe(true);
  });

  it('falls back to copy when --no-symlink-instruction-files', () => {
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'gemini'],
      useSymlinks: false,
    });
    expect(r.harnesses.gemini).toBe('created');
    const stat = lstatSync(join(tmpRoot, GEMINI_FILE));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(read(GEMINI_FILE)).toContain('@CLAUDE.md');
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
  it('replaces marker block on second invocation (no duplication)', () => {
    injectAgentInstructions({ projectRoot: tmpRoot });
    const after1 = read(CLAUDE_FILE);

    const r2 = injectAgentInstructions({ projectRoot: tmpRoot });
    expect(r2.harnesses['claude-code']).toBe('unchanged');
    expect(read(CLAUDE_FILE)).toBe(after1);

    // Single marker pair only — re-running never duplicates.
    const begins = (after1.match(new RegExp(escapeRegex(MARKER_BEGIN), 'g')) ?? []).length;
    const ends = (after1.match(new RegExp(escapeRegex(MARKER_END), 'g')) ?? []).length;
    expect(begins).toBe(1);
    expect(ends).toBe(1);
  });

  it('prepends marker block when CLAUDE.md exists without marker', () => {
    writeFileSync(join(tmpRoot, CLAUDE_FILE), '# My project\n\nUser-authored content.\n');
    const r = injectAgentInstructions({ projectRoot: tmpRoot, harnesses: ['claude-code'] });
    expect(r.harnesses['claude-code']).toBe('prepended');
    const text = read(CLAUDE_FILE);
    expect(text.indexOf(MARKER_BEGIN)).toBeLessThan(text.indexOf('# My project'));
    expect(text).toContain('User-authored content.');
  });

  it('preserves user content outside marker on rewrite', () => {
    writeFileSync(join(tmpRoot, CLAUDE_FILE), '# Project Claude rules\n\nKeep me.\n');
    injectAgentInstructions({ projectRoot: tmpRoot, harnesses: ['claude-code'] });
    const text = read(CLAUDE_FILE);
    expect(text).toContain('Keep me.');
    expect(text).toContain('Sweet-search indexes the working tree');

    // Re-run: user content still intact, no duplicated marker.
    injectAgentInstructions({ projectRoot: tmpRoot, harnesses: ['claude-code'] });
    const text2 = read(CLAUDE_FILE);
    expect(text2).toContain('Keep me.');
    const begins = (text2.match(new RegExp(escapeRegex(MARKER_BEGIN), 'g')) ?? []).length;
    expect(begins).toBe(1);
  });
});

describe('injectAgentInstructions — symlink edge cases', () => {
  it('falls back to marker injection when GEMINI.md already exists as a regular file', () => {
    writeFileSync(join(tmpRoot, GEMINI_FILE), '# Existing Gemini config\n');
    const r = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'gemini'],
    });
    expect(r.harnesses.gemini).toBe('fell-back-to-copy');
    const stat = lstatSync(join(tmpRoot, GEMINI_FILE));
    expect(stat.isSymbolicLink()).toBe(false);
    const text = read(GEMINI_FILE);
    expect(text).toContain('Existing Gemini config');
    expect(text).toContain(MARKER_BEGIN);
    expect(text).toContain('@CLAUDE.md');
  });

  it('detects an already-correct symlink as no-op', () => {
    injectAgentInstructions({ projectRoot: tmpRoot, harnesses: ['claude-code', 'gemini'] });
    const r2 = injectAgentInstructions({
      projectRoot: tmpRoot,
      harnesses: ['claude-code', 'gemini'],
    });
    expect(r2.harnesses.gemini).toBe('already-correct');
  });
});

describe('removeAgentInstructions', () => {
  it('strips marker blocks across all four files (round-trip)', () => {
    injectAgentInstructions({ projectRoot: tmpRoot });

    // Add user prose under the CLAUDE.md marker — must survive uninstall.
    const claudePath = join(tmpRoot, CLAUDE_FILE);
    writeFileSync(claudePath, readFileSync(claudePath, 'utf8') + '\n# My note\nKeep me.\n');

    const r = removeAgentInstructions({ projectRoot: tmpRoot });
    expect(r.harnesses['claude-code']).toBe('removed'); // user note kept
    expect(r.harnesses.agents).toBe('file-deleted');     // wholly managed (just an import)
    expect(r.harnesses.gemini).toBe('removed');          // symlink removed
    expect(r.harnesses.cursor).toBe('file-deleted');     // wholly managed (frontmatter is ours)

    expect(exists(AGENTS_FILE)).toBe(false);
    expect(exists(GEMINI_FILE)).toBe(false);
    expect(exists(CURSOR_FILE)).toBe(false);
    const claude = read(CLAUDE_FILE);
    expect(claude).not.toContain(MARKER_BEGIN);
    expect(claude).toContain('Keep me.');
  });

  it('dry-run reports without modifying anything', () => {
    injectAgentInstructions({ projectRoot: tmpRoot });
    const before = read(CLAUDE_FILE);
    const r = removeAgentInstructions({ projectRoot: tmpRoot, dryRun: true });
    expect(r.harnesses['claude-code']).toBe('dry-run');
    expect(r.harnesses.agents).toBe('dry-run');
    expect(r.harnesses.gemini).toBe('dry-run');
    expect(r.harnesses.cursor).toBe('dry-run');
    expect(read(CLAUDE_FILE)).toBe(before);
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
  it('creates the rules file with sentinel header', () => {
    expect(writeClaudeRules({ projectRoot: tmpRoot })).toBe('created');
    const text = read(CLAUDE_RULES_REL);
    expect(text).toContain(claudeRulesInternal.SENTINEL);
    expect(text).toContain('Sweet Search');
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
