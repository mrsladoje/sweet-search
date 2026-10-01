/**
 * Claude Code lean harness (scripts/install-claude-lean-harness.js): what
 * `sweet-search init` ships (the conflict-only trim, v2), how a v1 install
 * upgrades, and what uninstall takes back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyExactEdits } from '../../scripts/harness-prompts/index.js';

import {
  CLAUDE_LEAN_AGENT_NAME,
  CLAUDE_LEAN_AGENT_REL,
  CLAUDE_LEAN_BASE_PROMPT_BATCH,
  CLAUDE_LEAN_BATCH_LINE,
  CLAUDE_LEAN_EDIT_GIT,
  CLAUDE_LEAN_PROMPT_EDITS,
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
  claudeAutoMemoryDir,
  claudeCanonicalProjectRoot,
  claudeLeanAgentFile,
  claudeLeanContextSection,
  claudeProjectSlug,
  formatClaudeLeanHarnessGuidance,
  installClaudeLeanHarness,
  removeClaudeLeanHarness,
} from '../../scripts/install-claude-lean-harness.js';
import { CLAUDE_SYSTEM_OVERRIDE } from '../../scripts/install-claude-system-prompt.js';
import { getPolicyBody } from '../../scripts/inject-agent-instructions.js';

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
    // The shipped text = the v2.1 prompt with the read6fs edits (one edit is in the context section).
    const promptEdits = CLAUDE_LEAN_PROMPT_EDITS.filter(e => e !== CLAUDE_LEAN_EDIT_GIT);
    expect(main).toContain(applyExactEdits(CLAUDE_LEAN_HARNESS_PROMPT_BATCH, promptEdits));
    expect(main).toContain(CLAUDE_LEAN_EDIT_GIT[1]);
    for (const [from] of CLAUDE_LEAN_PROMPT_EDITS) expect(main).not.toContain(from);
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
    // The runner's form: the v2.1 text, on which it applies its own CC_TRIM_BATCH variant.
    expect(claudeLeanAgentFile({ appendOverride: false, promptEdits: false })).toContain(CLAUDE_LEAN_HARNESS_PROMPT_BATCH);
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

// What a custom main prompt costs in Claude Code 2.1.281 (the # Memory section, the gitStatus
// snapshot, the environment notes), put back in our own words.
describe('memory and session context (v2.1)', () => {
  // Real pairs from $0 captures of stock Claude Code 2.1.281 (cwd -> the slug in its # Memory path).
  // The second is longer than 200 characters, so Claude Code cut it and added a hash.
  const CAPTURED = [
    ['/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/b437d8d1-f05b-4d69-9207-b175ab10cb22/scratchpad/lean3/work-ceUDDB/repo',
      '-private-tmp-claude-501--Users-admin-Projects-sweet-search-private-b437d8d1-f05b-4d69-9207-b175ab10cb22-scratchpad-lean3-work-ceUDDB-repo'],
    ['/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/b437d8d1-f05b-4d69-9207-b175ab10cb22/scratchpad/lean3/work-nZcNlV/we_ird.name v2/deep_dir.with.dots/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      '-private-tmp-claude-501--Users-admin-Projects-sweet-search-private-b437d8d1-f05b-4d69-9207-b175ab10cb22-scratchpad-lean3-work-nZcNlV-we-ird-name-v2-deep-dir-with-dots-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-r8axar'],
  ];
  it('derives the project slug exactly as Claude Code does', () => {
    for (const [path, slug] of CAPTURED) expect(claudeProjectSlug(path)).toBe(slug);
  });

  const cfg = () => join(root, 'cfg');
  const gitInit = dir => {
    mkdirSync(dir, { recursive: true });
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    const g = (...a) => execFileSync('git', a, { cwd: dir, env, stdio: 'ignore' });
    g('init', '-q'); writeFileSync(join(dir, 'a.txt'), 'a\n'); g('add', '.'); g('commit', '-qm', 'init');
    return g;
  };

  it('keys the memory on the main working tree, so linked worktrees share it', () => {
    const main = join(root, 'main_repo');
    const g = gitInit(main);
    g('worktree', 'add', '-q', join(root, 'linked.wt'), '-b', 'feature');
    mkdirSync(join(main, 'sub'));
    const real = realpathSync(main);
    expect(claudeCanonicalProjectRoot(join(root, 'linked.wt'))).toBe(real);
    expect(claudeCanonicalProjectRoot(join(main, 'sub'))).toBe(real);
    expect(claudeAutoMemoryDir({ projectRoot: join(root, 'linked.wt'), configDir: cfg(), env: {} }))
      .toEqual({ dir: `${cfg()}/projects/${claudeProjectSlug(real)}/memory/`, enabled: true });
  });

  it('honours CLAUDE_CONFIG_DIR, then the settings that move or turn off auto memory', () => {
    const real = realpathSync(root);
    const expected = `${cfg()}/projects/${claudeProjectSlug(real)}/memory/`;
    expect(claudeAutoMemoryDir({ projectRoot: root, env: { CLAUDE_CONFIG_DIR: cfg() } }).dir).toBe(expected);
    expect(claudeAutoMemoryDir({ projectRoot: root, configDir: cfg(), visibleConfigDir: '/home/u/.claude', env: {} }).dir)
      .toBe(`/home/u/.claude/projects/${claudeProjectSlug(real)}/memory/`);
    // Claude Code ignores autoMemoryDirectory in the checked-in project settings.
    write('.claude/settings.json', JSON.stringify({ autoMemoryDirectory: '/elsewhere' }));
    expect(claudeAutoMemoryDir({ projectRoot: root, configDir: cfg(), env: {} }).dir).toBe(expected);
    write('.claude/settings.local.json', JSON.stringify({ autoMemoryDirectory: '/mine/mem' }));
    expect(claudeAutoMemoryDir({ projectRoot: root, configDir: cfg(), env: {} }).dir).toBe('/mine/mem/');
    expect(claudeAutoMemoryDir({ projectRoot: root, configDir: cfg(), env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } }).enabled).toBe(false);
    write('cfg/settings.json', JSON.stringify({ autoMemoryEnabled: false }));
    expect(claudeAutoMemoryDir({ projectRoot: root, configDir: cfg(), env: {} }).enabled).toBe(false);
  });

  it('the installed main agent tells the model its memory directory and how to save', () => {
    installClaudeLeanHarness({ projectRoot: root, configDir: cfg(), env: {} });
    const main = read(CLAUDE_LEAN_AGENT_REL);
    const dir = `${cfg()}/projects/${claudeProjectSlug(realpathSync(root))}/memory/`;
    expect(main).toContain(`in \`${dir}\``);
    for (const needle of [
      '# Memory', 'One fact per file', '`name`', '`description`', 'type:', 'user, feedback, project or reference',
      '**Why:**', '**How to apply:**', '[[name]]', '`MEMORY.md`', '- [Title](file.md) — hook',
      'update it instead', 'Delete a memory', 'Do not save what the repository already records',
      'not instructions from the user', 'still exists',
      '# Session context', 'git status --short --branch', 'git log --oneline -5', '/fast',
    ]) expect(main).toContain(needle);
    // Order: base prompt, then the context section, then the routing override.
    expect(main.indexOf(CLAUDE_LEAN_HARNESS_PROMPT_BATCH)).toBeLessThan(main.indexOf('# Memory'));
    expect(main.indexOf('# Session context')).toBeLessThan(main.indexOf(CLAUDE_SYSTEM_OVERRIDE));
  });

  it('says how to find the directory when it could not be computed, and drops memory when it is off', () => {
    const fallback = claudeLeanContextSection({ memoryDir: null });
    expect(fallback).toContain('$CLAUDE_CONFIG_DIR, else ~/.claude');
    expect(fallback).toContain('A MEMORY.md loaded into your context shows its directory');
    const off = claudeLeanContextSection({ memoryDir: '/x/memory/', memoryEnabled: false });
    expect(off).not.toContain('# Memory');
    expect(off).toContain('# Session context');
    write('.claude/settings.json', JSON.stringify({ autoMemoryEnabled: false }));
    installClaudeLeanHarness({ projectRoot: root, configDir: cfg(), env: {} });
    expect(read(CLAUDE_LEAN_AGENT_REL)).not.toContain('# Memory');
  });

  it('is our paraphrase: no search steer and no stock wording', () => {
    const text = claudeLeanContextSection({ memoryDir: '/x/memory/' });
    expect(text).not.toMatch(/dedicated (file|search) tools|\bgrep\b|\bfind\b|\bglob\b|Explore/);
    for (const stock of ['one file holding one fact', 'This directory already exists', 'Link liberally',
      'background context, not user instructions', 'The most recent Claude models']) {
      expect(text).not.toContain(stock);
    }
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
    const mem = claudeAutoMemoryDir({ projectRoot: root });
    // V1b: the product default carries the rules in the main agent (V1b).
    expect(read(CLAUDE_LEAN_AGENT_REL)).toBe(claudeLeanAgentFile({ memoryDir: mem.dir, memoryEnabled: mem.enabled, rules: getPolicyBody('cli') }));
    expect(r.rulesInPrompt).toBe(true);
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

// V1b: the shipped policy rides in the main agent file, ahead of the memory section.
// Every call passes `env` explicitly so the developer's shell cannot flip the switch.
describe('rules in the main agent (V1b)', () => {
  const POLICY = getPolicyBody('cli');
  const ENV = { SS_VARIANT_CC_RULES_IN_PROMPT: '' };
  const install = (extra = {}) => installClaudeLeanHarness({ projectRoot: root, env: ENV, ...extra });
  const count = (text, needle) => text.split(needle).length - 1;

  it('the product default puts the policy in the main agent once, before the memory section', () => {
    const r = install();
    expect(r.active).toBe(true);
    expect(r.rulesInPrompt).toBe(true);
    const main = read(CLAUDE_LEAN_AGENT_REL);
    expect(count(main, POLICY)).toBe(1);
    expect(main.indexOf(POLICY)).toBeLessThan(main.indexOf('# Memory'));
    // After the whole base prompt, before the memory section, and before the override.
    expect(main.indexOf(POLICY)).toBeGreaterThan(main.indexOf('# Doing the work'));
    expect(main.indexOf(POLICY)).toBeLessThan(main.indexOf(CLAUDE_SYSTEM_OVERRIDE));
    expect(main).toContain(`${POLICY}\n\n# Memory\n`);
    expect(manifest().files[CLAUDE_LEAN_AGENT_REL]).toBe(sha(main));
  });

  it('places the policy before the session context when auto memory is off', () => {
    const text = claudeLeanAgentFile({ memoryEnabled: false, rules: POLICY });
    expect(text).not.toContain('# Memory');
    expect(text).toContain(`${POLICY}\n\n# Session context\n`);
  });

  it('the subagent files never carry the policy', () => {
    install();
    expect(read(CLAUDE_LEAN_SUBAGENT_REL)).not.toContain(POLICY);
    expect(read(CLAUDE_LEAN_PLAN_REL)).not.toContain(POLICY);
    expect(read(CLAUDE_LEAN_SUBAGENT_REL)).toBe(`---\nname: general-purpose\ndescription: ${CLAUDE_LEAN_SUBAGENT_DESCRIPTION}\n---\n\n${CLAUDE_LEAN_SUBAGENT_PROMPT}\n`);
  });

  it("'2' and unset install the same bytes; '1' carries the policy too; '0' is the 2.8.2 agent file", () => {
    const files = (env) => {
      const d = join(root, `p${env.SS_VARIANT_CC_RULES_IN_PROMPT ?? 'unset'}`);
      mkdirSync(d);
      const r = installClaudeLeanHarness({ projectRoot: d, env, configDir: join(root, 'cfg') });
      const text = readFileSync(join(d, CLAUDE_LEAN_AGENT_REL), 'utf8');
      return { r, norm: text.split(d.replace(/[^a-zA-Z0-9]/g, '-')).join('<slug>') };
    };
    const unset = files({});
    const two = files({ SS_VARIANT_CC_RULES_IN_PROMPT: '2' });
    const one = files({ SS_VARIANT_CC_RULES_IN_PROMPT: '1' });
    const zero = files({ SS_VARIANT_CC_RULES_IN_PROMPT: '0' });
    expect(two.norm).toBe(unset.norm);
    expect(one.norm).toBe(unset.norm);
    expect([unset.r.rulesInPrompt, two.r.rulesInPrompt, one.r.rulesInPrompt, zero.r.rulesInPrompt]).toEqual([true, true, true, false]);
    expect(zero.norm).not.toContain(POLICY);
    expect(zero.norm).toBe(unset.norm.replace(`${POLICY}\n\n`, ''));
  });

  it('an explicit `rules` wins over the env: a custom text, or none', () => {
    expect(install({ rules: 'CUSTOM RULES\n\n' }).rulesInPrompt).toBe(true);
    expect(read(CLAUDE_LEAN_AGENT_REL)).toContain('CUSTOM RULES\n\n# Memory');
    expect(read(CLAUDE_LEAN_AGENT_REL)).not.toContain(POLICY);
    expect(install({ rules: false }).rulesInPrompt).toBe(false);
    expect(read(CLAUDE_LEAN_AGENT_REL)).not.toContain('CUSTOM RULES');
    expect(install({ rules: 7 }).status).toBe('error');
  });

  it('moves the policy in and out of an owned agent file and keeps the manifest hash in step', () => {
    install({ env: { SS_VARIANT_CC_RULES_IN_PROMPT: '0' } });
    const old = read(CLAUDE_LEAN_AGENT_REL);
    expect(old).not.toContain(POLICY);
    const up = install();
    expect(up.status).toBe('installed');
    expect(up.detail).toContain(CLAUDE_LEAN_AGENT_REL);
    expect(manifest().files[CLAUDE_LEAN_AGENT_REL]).toBe(sha(read(CLAUDE_LEAN_AGENT_REL)));
    expect(install().status).toBe('unchanged');
    install({ env: { SS_VARIANT_CC_RULES_IN_PROMPT: '0' } });
    expect(read(CLAUDE_LEAN_AGENT_REL)).toBe(old);
    expect(manifest().files[CLAUDE_LEAN_AGENT_REL]).toBe(sha(old));
    install();
    expect(removeClaudeLeanHarness({ projectRoot: root }).status).toBe('removed');
    expect(existsSync(join(root, CLAUDE_LEAN_AGENT_REL))).toBe(false);
    expect(existsSync(join(root, CLAUDE_LEAN_MANIFEST_REL))).toBe(false);
  });

  it('never takes the rules when the harness is not the main agent', () => {
    write('.claude/settings.local.json', JSON.stringify({ agent: 'other' }));
    const local = install();
    expect(local.active).toBe(false);
    expect(local.rulesInPrompt).toBe(false);
    expect(read(CLAUDE_LEAN_AGENT_REL)).not.toContain(POLICY);
    rmSync(join(root, '.claude'), { recursive: true, force: true });
    write('.claude/settings.json', JSON.stringify({ agent: 'mine' }));
    expect(install()).toMatchObject({ active: false, rulesInPrompt: false });
    rmSync(join(root, '.claude'), { recursive: true, force: true });
    write(CLAUDE_LEAN_AGENT_REL, '---\nname: sweet-search\n---\nmine\n');
    expect(install()).toMatchObject({ active: false, rulesInPrompt: false });
    expect(read(CLAUDE_LEAN_AGENT_REL)).toBe('---\nname: sweet-search\n---\nmine\n');
  });
});
