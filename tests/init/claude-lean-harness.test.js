/**
 * Claude Code lean harness (scripts/install-claude-lean-harness.js): what
 * `sweet-search init` ships so Claude Code runs the benchmarked "max-batch"
 * harness with no extra flags, and what uninstall takes back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CLAUDE_LEAN_AGENT_NAME,
  CLAUDE_LEAN_AGENT_REL,
  CLAUDE_LEAN_BASE_PROMPT_BATCH,
  CLAUDE_LEAN_DENY,
  CLAUDE_LEAN_ENV,
  CLAUDE_LEAN_MANIFEST_REL,
  CLAUDE_LEAN_SUBAGENT_PROMPT,
  CLAUDE_LEAN_SUBAGENT_REL,
  claudeLeanAgentFile,
  installClaudeLeanHarness,
  removeClaudeLeanHarness,
} from '../../scripts/install-claude-lean-harness.js';
import { CLAUDE_SYSTEM_OVERRIDE } from '../../scripts/install-claude-system-prompt.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sweet-search-lean-test-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const read = rel => readFileSync(join(root, rel), 'utf8');
const settings = () => JSON.parse(read('.claude/settings.json'));
const write = (rel, text) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};

describe('installClaudeLeanHarness', () => {
  it('installs the main agent, the subagent, the agent selection, deny list and env', () => {
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.status).toBe('installed');
    expect(r.active).toBe(true);
    const main = read(CLAUDE_LEAN_AGENT_REL);
    expect(main).toContain(`name: ${CLAUDE_LEAN_AGENT_NAME}`);
    expect(main).toContain(CLAUDE_LEAN_BASE_PROMPT_BATCH);
    expect(main).toContain(CLAUDE_SYSTEM_OVERRIDE);
    const sub = read(CLAUDE_LEAN_SUBAGENT_REL);
    expect(sub).toContain('name: general-purpose');
    expect(sub).toContain(CLAUDE_LEAN_SUBAGENT_PROMPT);
    const s = settings();
    expect(s.agent).toBe(CLAUDE_LEAN_AGENT_NAME);
    for (const entry of CLAUDE_LEAN_DENY) expect(s.permissions.deny).toContain(entry);
    // The tools a coding session needs are never denied.
    for (const tool of ['Agent', 'Bash', 'Edit', 'Read', 'Write']) expect(s.permissions.deny).not.toContain(tool);
    expect(s.env).toMatchObject(CLAUDE_LEAN_ENV);
    expect(existsSync(join(root, CLAUDE_LEAN_MANIFEST_REL))).toBe(true);
  });

  it('the benchmark form omits the override (the runner appends it itself)', () => {
    expect(claudeLeanAgentFile({ appendOverride: false })).not.toContain(CLAUDE_SYSTEM_OVERRIDE);
    expect(claudeLeanAgentFile({ appendOverride: false })).toContain(CLAUDE_LEAN_BASE_PROMPT_BATCH);
  });

  it('is idempotent', () => {
    expect(installClaudeLeanHarness({ projectRoot: root }).status).toBe('installed');
    const before = read('.claude/settings.json');
    expect(installClaudeLeanHarness({ projectRoot: root }).status).toBe('unchanged');
    expect(read('.claude/settings.json')).toBe(before);
  });

  it('merges into existing settings and keeps the user entries', () => {
    write('.claude/settings.json', JSON.stringify({
      permissions: { deny: ['Bash(rm -rf:*)', 'WebFetch'] },
      env: { FOO: 'bar', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' },
      hooks: { SessionStart: [] },
    }));
    installClaudeLeanHarness({ projectRoot: root });
    const s = settings();
    expect(s.permissions.deny).toContain('Bash(rm -rf:*)');
    expect(s.permissions.deny.filter(e => e === 'WebFetch')).toHaveLength(1);
    expect(s.env.FOO).toBe('bar');
    // A value the user set wins.
    expect(s.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('0');
    expect(s.hooks).toEqual({ SessionStart: [] });
  });

  it('keeps a user-selected main agent and reports the harness as not active', () => {
    write('.claude/settings.json', JSON.stringify({ agent: 'my-agent' }));
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.status).toBe('preserved-existing');
    expect(r.active).toBe(false);
    expect(settings().agent).toBe('my-agent');
    expect(existsSync(join(root, CLAUDE_LEAN_AGENT_REL))).toBe(false);
  });

  it('keeps a user-authored main agent file', () => {
    write(CLAUDE_LEAN_AGENT_REL, '---\nname: sweet-search\n---\nmine\n');
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.active).toBe(false);
    expect(read(CLAUDE_LEAN_AGENT_REL)).toBe('---\nname: sweet-search\n---\nmine\n');
  });

  it('keeps a user-authored general-purpose agent and warns', () => {
    write(CLAUDE_LEAN_SUBAGENT_REL, '---\nname: general-purpose\n---\nmine\n');
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.active).toBe(true);
    expect(r.warning).toMatch(/general-purpose/);
    expect(read(CLAUDE_LEAN_SUBAGENT_REL)).toBe('---\nname: general-purpose\n---\nmine\n');
  });

  it('warns when settings.local.json selects another agent', () => {
    write('.claude/settings.local.json', JSON.stringify({ agent: 'other' }));
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.active).toBe(false);
    expect(r.warning).toMatch(/settings\.local\.json/);
  });

  it('refuses to touch invalid settings JSON', () => {
    write('.claude/settings.json', '{not json');
    expect(installClaudeLeanHarness({ projectRoot: root }).status).toBe('error');
    expect(read('.claude/settings.json')).toBe('{not json');
  });
});

describe('removeClaudeLeanHarness', () => {
  it('removes exactly what install added', () => {
    write('.claude/settings.json', JSON.stringify({ permissions: { deny: ['WebFetch'] }, env: { FOO: 'bar' } }));
    installClaudeLeanHarness({ projectRoot: root });
    expect(removeClaudeLeanHarness({ projectRoot: root, dryRun: true }).status).toBe('dry-run');
    expect(existsSync(join(root, CLAUDE_LEAN_AGENT_REL))).toBe(true);
    expect(removeClaudeLeanHarness({ projectRoot: root }).status).toBe('removed');
    expect(settings()).toEqual({ permissions: { deny: ['WebFetch'] }, env: { FOO: 'bar' } });
    expect(existsSync(join(root, CLAUDE_LEAN_AGENT_REL))).toBe(false);
    expect(existsSync(join(root, CLAUDE_LEAN_SUBAGENT_REL))).toBe(false);
    expect(existsSync(join(root, CLAUDE_LEAN_MANIFEST_REL))).toBe(false);
  });

  it('keeps an agent file the user edited after install', () => {
    installClaudeLeanHarness({ projectRoot: root });
    write(CLAUDE_LEAN_SUBAGENT_REL, 'edited\n');
    removeClaudeLeanHarness({ projectRoot: root });
    expect(read(CLAUDE_LEAN_SUBAGENT_REL)).toBe('edited\n');
    expect(existsSync(join(root, CLAUDE_LEAN_AGENT_REL))).toBe(false);
  });

  it('keeps an env value the user changed after install', () => {
    installClaudeLeanHarness({ projectRoot: root });
    const s = settings();
    s.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0';
    write('.claude/settings.json', JSON.stringify(s));
    removeClaudeLeanHarness({ projectRoot: root });
    expect(settings().env).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' });
  });

  it('reports not-found without a manifest', () => {
    expect(removeClaudeLeanHarness({ projectRoot: root }).status).toBe('not-found');
  });
});
