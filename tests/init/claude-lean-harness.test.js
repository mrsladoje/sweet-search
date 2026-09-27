/**
 * Claude Code lean harness (scripts/install-claude-lean-harness.js): what
 * `sweet-search init` ships (the conflict-only trim, v2), how a v1 install
 * upgrades, and what uninstall takes back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CLAUDE_LEAN_AGENT_NAME,
  CLAUDE_LEAN_AGENT_REL,
  CLAUDE_LEAN_BASE_PROMPT_BATCH,
  CLAUDE_LEAN_BATCH_LINE,
  CLAUDE_LEAN_DENY,
  CLAUDE_LEAN_ENV,
  CLAUDE_LEAN_HARNESS_DENY,
  CLAUDE_LEAN_HARNESS_ENV,
  CLAUDE_LEAN_HARNESS_PROMPT,
  CLAUDE_LEAN_HARNESS_PROMPT_BATCH,
  CLAUDE_LEAN_MANIFEST_REL,
  CLAUDE_LEAN_PLAN_PROMPT,
  CLAUDE_LEAN_PLAN_REL,
  CLAUDE_LEAN_SUBAGENT_DESCRIPTION,
  CLAUDE_LEAN_SUBAGENT_PROMPT,
  CLAUDE_LEAN_SUBAGENT_REL,
  claudeLeanAgentFile,
  formatClaudeLeanHarnessGuidance,
  installClaudeLeanHarness,
  removeClaudeLeanHarness,
} from '../../scripts/install-claude-lean-harness.js';
import { CLAUDE_SYSTEM_OVERRIDE } from '../../scripts/install-claude-system-prompt.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sweet-search-lean-test-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const read = rel => readFileSync(join(root, rel), 'utf8');
const settings = () => JSON.parse(read('.claude/settings.json'));
const manifest = () => JSON.parse(read(CLAUDE_LEAN_MANIFEST_REL));
const write = (rel, text) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const sha = s => createHash('sha256').update(s).digest('hex');

// Tools a user relies on that the v1 harness denied. v2 must leave every one available.
const RESTORED_TOOLS = [
  'WebSearch', 'WebFetch', 'Skill', 'NotebookEdit', 'EnterWorktree', 'ExitWorktree', 'TaskStop',
  'SendMessage', 'ListAgents', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup',
  'RemoteTrigger', 'Workflow', 'ReportFindings', 'Agent(statusline-setup)', 'Agent(Plan)',
];

describe('v2 prompt text', () => {
  it('drops the conflicting search steer and keeps the user-relevant guidance', () => {
    const p = CLAUDE_LEAN_HARNESS_PROMPT;
    expect(p).not.toMatch(/dedicated (file|search) tools|Prefer dedicated tools/i);
    expect(p).not.toMatch(/\bgrep\b|\bfind\b|\bglob\b|Explore/);
    for (const needle of [
      'authorized security', // security policy
      'hard to undo', // confirm before hard-to-reverse / outward-facing actions
      'outside service', // publishing to external services
      'denied tool call', // denied tool calls
      'Hooks', // hook output
      'system-reminder', // system reminders
      'GitHub-flavored markdown',
      '`file_path:line_number`',
      'they/them',
      'summarized automatically', // compaction awareness
      'Do not wrap up early',
      'change files only when the user asks', // request-type discipline
      'recommend one option', // recommend, don't survey
      'surrounding code',
      'Report what really happened',
      'Skill tool',
    ]) expect(p).toContain(needle);
  });

  it('the batching line does not push edits made with shell scripts', () => {
    expect(CLAUDE_LEAN_BATCH_LINE).not.toMatch(/script/);
    expect(CLAUDE_LEAN_BATCH_LINE).toContain('Make file changes with Edit or Write');
    expect(CLAUDE_LEAN_HARNESS_PROMPT_BATCH.endsWith(CLAUDE_LEAN_BATCH_LINE)).toBe(true);
  });

  it('v1 texts the benchmark imports are unchanged', () => {
    expect(CLAUDE_LEAN_BASE_PROMPT_BATCH).toContain('an edit made with a short script');
    expect(CLAUDE_LEAN_DENY).toContain('WebSearch');
    expect(CLAUDE_LEAN_ENV.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });

  it('the Plan prompt defers search to the project rules and stays read-only', () => {
    expect(CLAUDE_LEAN_PLAN_PROMPT).toContain('as the project rules say');
    expect(CLAUDE_LEAN_PLAN_PROMPT).toContain('Do not change any file');
  });
});

describe('installClaudeLeanHarness', () => {
  it('installs the main agent, both subagents, the agent selection, deny list and env', () => {
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.status).toBe('installed');
    expect(r.active).toBe(true);
    const main = read(CLAUDE_LEAN_AGENT_REL);
    expect(main).toContain(`name: ${CLAUDE_LEAN_AGENT_NAME}`);
    expect(main).toContain(CLAUDE_LEAN_HARNESS_PROMPT_BATCH);
    expect(main).toContain(CLAUDE_SYSTEM_OVERRIDE);
    const sub = read(CLAUDE_LEAN_SUBAGENT_REL);
    expect(sub).toContain('name: general-purpose');
    expect(sub).toContain(CLAUDE_LEAN_SUBAGENT_PROMPT);
    const plan = read(CLAUDE_LEAN_PLAN_REL);
    expect(plan).toMatch(/^---\nname: Plan\n/);
    expect(plan).toContain('disallowedTools: Agent, ExitPlanMode, Edit, Write, NotebookEdit');
    expect(plan).toContain(CLAUDE_LEAN_PLAN_PROMPT);
    const s = settings();
    expect(s.agent).toBe(CLAUDE_LEAN_AGENT_NAME);
    expect(s.permissions.deny).toEqual([...CLAUDE_LEAN_HARNESS_DENY]);
    for (const tool of ['Agent', 'Bash', 'Edit', 'Read', 'Write', ...RESTORED_TOOLS]) {
      expect(s.permissions.deny).not.toContain(tool);
    }
    expect(s.env).toEqual({ ...CLAUDE_LEAN_HARNESS_ENV });
    expect(s.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
    expect(s.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS).toBeUndefined();
    expect(manifest().version).toBe(2);
    expect(Object.keys(manifest().files).sort()).toEqual(
      [CLAUDE_LEAN_AGENT_REL, CLAUDE_LEAN_PLAN_REL, CLAUDE_LEAN_SUBAGENT_REL].sort(),
    );
  });

  it('the benchmark form omits the override (the runner appends it itself)', () => {
    expect(claudeLeanAgentFile({ appendOverride: false })).not.toContain(CLAUDE_SYSTEM_OVERRIDE);
    expect(claudeLeanAgentFile({ appendOverride: false })).toContain(CLAUDE_LEAN_HARNESS_PROMPT_BATCH);
  });

  it('is idempotent', () => {
    expect(installClaudeLeanHarness({ projectRoot: root }).status).toBe('installed');
    const before = read('.claude/settings.json');
    const beforeManifest = read(CLAUDE_LEAN_MANIFEST_REL);
    expect(installClaudeLeanHarness({ projectRoot: root }).status).toBe('unchanged');
    expect(read('.claude/settings.json')).toBe(before);
    expect(read(CLAUDE_LEAN_MANIFEST_REL)).toBe(beforeManifest);
  });

  it('merges into existing settings and keeps the user entries', () => {
    write('.claude/settings.json', JSON.stringify({
      permissions: { deny: ['Bash(rm -rf:*)', 'Agent(Explore)'] },
      env: { FOO: 'bar', CLAUDE_CODE_THRIFTY_SONIC: '1' },
      hooks: { SessionStart: [] },
    }));
    installClaudeLeanHarness({ projectRoot: root });
    const s = settings();
    expect(s.permissions.deny).toContain('Bash(rm -rf:*)');
    expect(s.permissions.deny.filter(e => e === 'Agent(Explore)')).toHaveLength(1);
    // A pre-existing entry is the user's: never recorded as ours.
    expect(manifest().addedDeny).not.toContain('Agent(Explore)');
    expect(s.env.FOO).toBe('bar');
    // A value the user set wins.
    expect(s.env.CLAUDE_CODE_THRIFTY_SONIC).toBe('1');
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

  it('keeps a user-authored Plan agent and warns', () => {
    write(CLAUDE_LEAN_PLAN_REL, '---\nname: Plan\n---\nmine\n');
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.active).toBe(true);
    expect(r.warning).toMatch(/Plan\.md is user-authored/);
    expect(read(CLAUDE_LEAN_PLAN_REL)).toBe('---\nname: Plan\n---\nmine\n');
    expect(manifest().files[CLAUDE_LEAN_PLAN_REL]).toBeUndefined();
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

describe('upgrade from a v1 install', () => {
  // Exactly what the v1 installer left behind, built from the v1 texts it used.
  const V1_AGENT = `---\nname: ${CLAUDE_LEAN_AGENT_NAME}\ndescription: sweet-search lean harness (main session)\n---\n\n${CLAUDE_LEAN_BASE_PROMPT_BATCH}\n\n${CLAUDE_SYSTEM_OVERRIDE}\n`;
  const V1_SUB = `---\nname: general-purpose\ndescription: ${CLAUDE_LEAN_SUBAGENT_DESCRIPTION}\n---\n\n${CLAUDE_LEAN_SUBAGENT_PROMPT}\n`;
  const USER_SETTINGS = {
    // WebFetch was the user's own deny before v1 ran, so v1 did not record it.
    permissions: { deny: ['Bash(rm -rf:*)', 'WebFetch'] },
    env: { FOO: 'bar' },
    hooks: { SessionStart: [] },
  };
  const installV1 = ({ envOverrides = {} } = {}) => {
    write(CLAUDE_LEAN_AGENT_REL, V1_AGENT);
    write(CLAUDE_LEAN_SUBAGENT_REL, V1_SUB);
    const v1Added = CLAUDE_LEAN_DENY.filter(e => !USER_SETTINGS.permissions.deny.includes(e));
    write('.claude/settings.json', JSON.stringify({
      ...USER_SETTINGS,
      agent: CLAUDE_LEAN_AGENT_NAME,
      permissions: { deny: [...USER_SETTINGS.permissions.deny, ...v1Added] },
      env: { ...USER_SETTINGS.env, ...CLAUDE_LEAN_ENV, ...envOverrides },
    }));
    write(CLAUDE_LEAN_MANIFEST_REL, JSON.stringify({
      version: 1,
      files: { [CLAUDE_LEAN_AGENT_REL]: sha(V1_AGENT), [CLAUDE_LEAN_SUBAGENT_REL]: sha(V1_SUB) },
      addedDeny: v1Added,
      addedEnv: { ...CLAUDE_LEAN_ENV },
      setAgent: true,
    }));
  };

  it('rewrites the owned files, adds Plan, and drops the deny and env entries v1 added', () => {
    installV1();
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.status).toBe('installed');
    expect(r.active).toBe(true);
    expect(read(CLAUDE_LEAN_AGENT_REL)).toBe(claudeLeanAgentFile());
    expect(read(CLAUDE_LEAN_SUBAGENT_REL)).toBe(V1_SUB);
    expect(existsSync(join(root, CLAUDE_LEAN_PLAN_REL))).toBe(true);
    const s = settings();
    expect(s.agent).toBe(CLAUDE_LEAN_AGENT_NAME);
    // User entries stay (WebFetch included); v1's extra entries go; v2's stay.
    expect([...s.permissions.deny].sort()).toEqual(
      ['Bash(rm -rf:*)', 'WebFetch', ...CLAUDE_LEAN_HARNESS_DENY].sort(),
    );
    expect(s.env).toEqual({ FOO: 'bar', ...CLAUDE_LEAN_HARNESS_ENV });
    expect(s.hooks).toEqual({ SessionStart: [] });
    const m = manifest();
    expect(m.version).toBe(2);
    expect([...m.addedDeny].sort()).toEqual([...CLAUDE_LEAN_HARNESS_DENY].sort());
    expect(m.addedEnv).toEqual({ ...CLAUDE_LEAN_HARNESS_ENV });
    expect(m.files[CLAUDE_LEAN_AGENT_REL]).toBe(sha(read(CLAUDE_LEAN_AGENT_REL)));
    expect(r.detail).toMatch(/removed \d+ deny entries/);
    expect(r.detail).toMatch(/CLAUDE_CODE_DISABLE_AUTO_MEMORY/);
  });

  it('is idempotent after the upgrade and uninstall restores the user settings exactly', () => {
    installV1();
    installClaudeLeanHarness({ projectRoot: root });
    expect(installClaudeLeanHarness({ projectRoot: root }).status).toBe('unchanged');
    expect(removeClaudeLeanHarness({ projectRoot: root }).status).toBe('removed');
    expect(settings()).toEqual(USER_SETTINGS);
    for (const rel of [CLAUDE_LEAN_AGENT_REL, CLAUDE_LEAN_SUBAGENT_REL, CLAUDE_LEAN_PLAN_REL, CLAUDE_LEAN_MANIFEST_REL]) {
      expect(existsSync(join(root, rel))).toBe(false);
    }
  });

  it('keeps a v1 env value the user changed, and uninstall keeps it too', () => {
    installV1({ envOverrides: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' } });
    installClaudeLeanHarness({ projectRoot: root });
    expect(settings().env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('0');
    expect(settings().env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS).toBeUndefined();
    expect(manifest().addedEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
    removeClaudeLeanHarness({ projectRoot: root });
    expect(settings().env).toEqual({ FOO: 'bar', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' });
  });

  it('keeps a v1 main agent file the user edited (harness not active)', () => {
    installV1();
    write(CLAUDE_LEAN_AGENT_REL, 'my edits\n');
    const r = installClaudeLeanHarness({ projectRoot: root });
    expect(r.active).toBe(false);
    expect(read(CLAUDE_LEAN_AGENT_REL)).toBe('my edits\n');
  });

  it('removes an unchanged file an earlier version shipped and this one does not', () => {
    installClaudeLeanHarness({ projectRoot: root });
    const oldRel = '.claude/agents/retired.md';
    write(oldRel, 'retired\n');
    const m = manifest();
    m.files[oldRel] = sha('retired\n');
    write(CLAUDE_LEAN_MANIFEST_REL, JSON.stringify(m));
    expect(installClaudeLeanHarness({ projectRoot: root }).status).toBe('installed');
    expect(existsSync(join(root, oldRel))).toBe(false);
    expect(manifest().files[oldRel]).toBeUndefined();
  });

  it('keeps a retired file the user edited, and forgets ownership of it', () => {
    installClaudeLeanHarness({ projectRoot: root });
    const oldRel = '.claude/agents/retired.md';
    write(oldRel, 'user edit\n');
    const m = manifest();
    m.files[oldRel] = sha('retired\n');
    write(CLAUDE_LEAN_MANIFEST_REL, JSON.stringify(m));
    installClaudeLeanHarness({ projectRoot: root });
    expect(read(oldRel)).toBe('user edit\n');
    expect(manifest().files[oldRel]).toBeUndefined();
  });
});

describe('formatClaudeLeanHarnessGuidance', () => {
  it('says what changes and how to opt out, and no longer claims plan mode is off', () => {
    const text = formatClaudeLeanHarnessGuidance({ status: 'installed', active: true });
    expect(text).toContain('conflicts with the sweet-search rules');
    expect(text).toContain('--no-lean-harness');
    expect(text).toContain('plan mode and web access stay');
    expect(text.trim().split('\n')).toHaveLength(2);
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
    expect(existsSync(join(root, CLAUDE_LEAN_PLAN_REL))).toBe(false);
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
    s.env.CLAUDE_CODE_THRIFTY_SONIC = '1';
    write('.claude/settings.json', JSON.stringify(s));
    removeClaudeLeanHarness({ projectRoot: root });
    expect(settings().env).toEqual({ CLAUDE_CODE_THRIFTY_SONIC: '1' });
  });

  it('reports not-found without a manifest', () => {
    expect(removeClaudeLeanHarness({ projectRoot: root }).status).toBe('not-found');
  });
});
