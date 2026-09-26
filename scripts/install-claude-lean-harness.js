/**
 * Install the sweet-search lean harness for Claude Code (project scope).
 *
 * Claude Code's own system prompt and tool set carry text that contradicts the
 * sweet-search rules ("Prefer the dedicated file/search tools", search-delegation
 * subagents, the bypass-mode "search with grep and find" steer) and cost tokens on
 * every request. The task benchmark measured a trimmed harness ("max-batch") on the
 * sweet arm: equal solves, lower cost. This module ships that harness as plain
 * project files, so a user types nothing extra:
 *
 *   .claude/agents/sweet-search.md     main-session agent; its body REPLACES Claude
 *                                      Code's base system prompt (settings `agent`)
 *   .claude/agents/general-purpose.md  replaces the built-in catch-all subagent, so
 *                                      every subagent runs the trimmed prompt; the
 *                                      rules reach it through the project rules file
 *   .claude/settings.json              `agent`, `permissions.deny` (unused tools and
 *                                      search-delegation subagent types) and `env`
 *
 * Verified by request capture on Claude Code 2.1.281: with these files the first
 * request is byte-identical to the benchmarked `--system-prompt` / `--agents` /
 * `--disallowedTools` form (DIAG / FINDINGS in the harness-prompt-trim handoff).
 *
 * Ownership: `.claude/sweet-search-harness.json` records exactly what this module
 * added (files by content hash, deny entries, env keys, the `agent` selection), so
 * uninstall removes only those and never a user's own setting or file.
 */

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { CLAUDE_SYSTEM_OVERRIDE } from './install-claude-system-prompt.js';

export const CLAUDE_LEAN_AGENT_NAME = 'sweet-search';
export const CLAUDE_LEAN_AGENT_REL = '.claude/agents/sweet-search.md';
export const CLAUDE_LEAN_SUBAGENT_REL = '.claude/agents/general-purpose.md';
export const CLAUDE_LEAN_MANIFEST_REL = '.claude/sweet-search-harness.json';
const SETTINGS_REL = '.claude/settings.json';
const LOCAL_SETTINGS_REL = '.claude/settings.local.json';

// Base prompt: our own text, not Anthropic's. It says nothing about search or reading,
// so the rules file decides how the agent searches.
export const CLAUDE_LEAN_BASE_PROMPT = [
  "You are a coding agent. You work in the user's repository through the tools provided.",
  '',
  '- Do the task with the tools: run commands with Bash, change files with Edit or Write. Tool calls that do not depend on each other can go in parallel in one response.',
  '- Write code that matches the surrounding code: its naming, idiom and comment density.',
  '- Before you delete or overwrite anything, look at it first. Do not commit, push or rewrite git history unless the task asks for it.',
  '- Say what really happened: show the output of a failing test, name any step you did not do, and call a change finished only after you checked it.',
  '- When you have enough information to act, act.',
].join('\n');

// The shipped form ("max-batch"): without Claude Code's bypass-mode editing text, the agent
// splits an edit, its check and the test run into separate calls; this line recombines them.
export const CLAUDE_LEAN_BASE_PROMPT_BATCH = `${CLAUDE_LEAN_BASE_PROMPT}
- Combine dependent shell steps into one Bash call where you can, for example an edit made with a short script together with the command that checks it.`;

export const CLAUDE_LEAN_SUBAGENT_DESCRIPTION =
  'Agent for a self-contained part of the task that you want done in a separate context.';
export const CLAUDE_LEAN_SUBAGENT_PROMPT = [
  "You are a coding agent working as a subagent: another agent launched you with one task in the user's repository.",
  '',
  '- Do the task with the tools: run commands with Bash, change files with Edit or Write. Tool calls that do not depend on each other can go in parallel in one response.',
  '- Before you delete or overwrite anything, look at it first. Do not commit, push or rewrite git history.',
  '- Your final message is all the launching agent sees: state what you found and what you changed, and name any step you did not do.',
].join('\n');

// Tools a coding task does not use, plus the subagent types whose listing steers search into
// delegation. Agent, Bash, Edit, Read and Write stay.
export const CLAUDE_LEAN_DENY_TOOLS = Object.freeze([
  'SendMessage', 'Workflow', 'ScheduleWakeup', 'CronCreate', 'EnterWorktree', 'ExitWorktree',
  'ReportFindings', 'Skill', 'NotebookEdit', 'ListAgents', 'WebSearch', 'WebFetch', 'TaskStop',
  'CronDelete', 'CronList',
  // Subscription (OAuth) route only. Left in, it alone keeps ToolSearch in the request.
  'RemoteTrigger',
]);
export const CLAUDE_LEAN_DENY_AGENT_TYPES = Object.freeze([
  'Agent(Explore)', 'Agent(statusline-setup)', 'Agent(Plan)', 'Agent(claude)',
  // The main-session agent must not also be offered as a subagent type.
  `Agent(${CLAUDE_LEAN_AGENT_NAME})`,
]);
export const CLAUDE_LEAN_DENY = Object.freeze([...CLAUDE_LEAN_DENY_TOOLS, ...CLAUDE_LEAN_DENY_AGENT_TYPES]);

// Claude Code env switches (measured on the real request shape):
//   THRIFTY_SONIC=0           bash-first steer off (bypass/auto permission modes only). Internal.
//   DISABLE_AUTO_MEMORY=1     the # Memory section; = settings autoMemoryEnabled:false.
//   DISABLE_GIT_INSTRUCTIONS=1  gitStatus + git sections; = includeGitInstructions:false.
//   TOTAL_TOKENS_REMINDER=off the token-budget block after every tool result. Internal.
//   PARCHMENT_FERN=1          Edit stops claiming a prior Read is required (false in the
//                             working dir; it pushes the Read tool the rules discourage). Internal.
// Internal variables: an unknown variable is ignored, so a Claude Code release that drops one
// loses only that saving. Re-verify by capture on each new Claude Code release.
export const CLAUDE_LEAN_ENV = Object.freeze({
  CLAUDE_CODE_THRIFTY_SONIC: '0',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '1',
  CLAUDE_CODE_TOTAL_TOKENS_REMINDER: 'off',
  CLAUDE_CODE_PARCHMENT_FERN: '1',
});

/**
 * Main-agent file. `appendOverride` puts the sweet-search routing override after the base
 * prompt (the product); the benchmark passes the override through its own
 * `--append-system-prompt` instead and sets it false.
 */
export function claudeLeanAgentFile({ appendOverride = true } = {}) {
  const body = appendOverride
    ? `${CLAUDE_LEAN_BASE_PROMPT_BATCH}\n\n${CLAUDE_SYSTEM_OVERRIDE}`
    : CLAUDE_LEAN_BASE_PROMPT_BATCH;
  return `---\nname: ${CLAUDE_LEAN_AGENT_NAME}\ndescription: sweet-search lean harness (main session)\n---\n\n${body}\n`;
}

export function claudeLeanSubagentFile() {
  return `---\nname: general-purpose\ndescription: ${CLAUDE_LEAN_SUBAGENT_DESCRIPTION}\n---\n\n${CLAUDE_LEAN_SUBAGENT_PROMPT}\n`;
}

const sha = s => createHash('sha256').update(s).digest('hex');

function readJson(path, label) {
  if (!existsSync(path)) return { value: {}, exists: false };
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `existing ${label} must contain a JSON object` };
    }
    return { value, exists: true };
  } catch (err) {
    return { error: `existing ${label} is not valid JSON: ${err.message}` };
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.sweet-search.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/**
 * A file is ours when the manifest recorded the hash of what we wrote and the file still
 * has that content. A file that exists with any other content is the user's.
 */
function fileState(projectRoot, rel, manifest) {
  const path = join(projectRoot, rel);
  if (!existsSync(path)) return 'absent';
  const recorded = manifest?.files?.[rel];
  return recorded && sha(readFileSync(path, 'utf8')) === recorded ? 'ours' : 'user';
}

/**
 * Install (or refresh) the lean harness. Idempotent. Never throws.
 *
 * @returns {{status: string, detail: string, active: boolean|null, warning?: string}}
 *   status in { installed, unchanged, preserved-existing, error }. `active` is true when
 *   Claude Code will start the main session with the sweet-search agent.
 */
export function installClaudeLeanHarness({ projectRoot, appendOverride = true } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'install-claude-lean-harness: projectRoot is required', active: null };
  const settingsPath = join(projectRoot, SETTINGS_REL);
  const manifestPath = join(projectRoot, CLAUDE_LEAN_MANIFEST_REL);
  const settingsRead = readJson(settingsPath, SETTINGS_REL);
  if (settingsRead.error) return { status: 'error', detail: settingsRead.error, active: null };
  const manifestRead = readJson(manifestPath, CLAUDE_LEAN_MANIFEST_REL);
  const manifest = manifestRead.error ? {} : manifestRead.value;
  const settings = settingsRead.value;

  // A user who selected another main agent keeps it.
  if (settings.agent !== undefined && settings.agent !== CLAUDE_LEAN_AGENT_NAME) {
    return {
      status: 'preserved-existing', active: false,
      detail: `preserved project agent=${JSON.stringify(settings.agent)}`,
      warning: `${SETTINGS_REL} selects the agent ${JSON.stringify(settings.agent)}, so the sweet-search lean harness is not active.`,
    };
  }
  if (fileState(projectRoot, CLAUDE_LEAN_AGENT_REL, manifest) === 'user') {
    return {
      status: 'preserved-existing', active: false,
      detail: `${CLAUDE_LEAN_AGENT_REL} is user-authored; preserved`,
      warning: `${CLAUDE_LEAN_AGENT_REL} is user-authored, so the sweet-search lean harness is not active. Move or rename it, then rerun init.`,
    };
  }

  const next = {
    version: 1,
    files: { ...(manifest.files || {}) },
    addedDeny: [...(manifest.addedDeny || [])],
    addedEnv: { ...(manifest.addedEnv || {}) },
    setAgent: Boolean(manifest.setAgent),
  };
  const changes = [];
  const warnings = [];

  const writeOwned = (rel, content) => {
    const state = fileState(projectRoot, rel, manifest);
    if (state === 'user') return 'user';
    const path = join(projectRoot, rel);
    if (state === 'ours' && readFileSync(path, 'utf8') === content) return 'unchanged';
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    next.files[rel] = sha(content);
    changes.push(rel);
    return 'written';
  };

  try {
    writeOwned(CLAUDE_LEAN_AGENT_REL, claudeLeanAgentFile({ appendOverride }));
    if (writeOwned(CLAUDE_LEAN_SUBAGENT_REL, claudeLeanSubagentFile()) === 'user') {
      warnings.push(`${CLAUDE_LEAN_SUBAGENT_REL} is user-authored and was kept; subagents run its prompt.`);
    }

    let settingsChanged = false;
    if (settings.agent !== CLAUDE_LEAN_AGENT_NAME) {
      settings.agent = CLAUDE_LEAN_AGENT_NAME;
      next.setAgent = true;
      settingsChanged = true;
    }
    settings.permissions ??= {};
    const deny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
    for (const entry of CLAUDE_LEAN_DENY) {
      if (!deny.includes(entry)) {
        deny.push(entry);
        if (!next.addedDeny.includes(entry)) next.addedDeny.push(entry);
        settingsChanged = true;
      }
    }
    settings.permissions.deny = deny;
    settings.env ??= {};
    for (const [key, value] of Object.entries(CLAUDE_LEAN_ENV)) {
      if (settings.env[key] === undefined) {
        settings.env[key] = value;
        next.addedEnv[key] = value;
        settingsChanged = true;
      }
    }
    if (settingsChanged) {
      writeJson(settingsPath, settings);
      changes.push(`${SETTINGS_REL} (agent, permissions.deny, env)`);
    }
    if (changes.length || !manifestRead.exists) writeJson(manifestPath, next);
  } catch (err) {
    return { status: 'error', detail: err.message, active: null };
  }

  // settings.local.json has higher priority than the project settings.
  const local = readJson(join(projectRoot, LOCAL_SETTINGS_REL), LOCAL_SETTINGS_REL);
  if (!local.error && local.value.agent !== undefined && local.value.agent !== CLAUDE_LEAN_AGENT_NAME) {
    return {
      status: 'preserved-existing', active: false,
      detail: `installed; ${LOCAL_SETTINGS_REL} selects agent=${JSON.stringify(local.value.agent)}`,
      warning: `${LOCAL_SETTINGS_REL} selects the agent ${JSON.stringify(local.value.agent)}, which overrides the sweet-search lean harness.`,
    };
  }
  const result = {
    status: changes.length ? 'installed' : 'unchanged',
    detail: changes.length ? changes.join('; ') : 'lean harness already installed',
    active: true,
  };
  if (warnings.length) result.warning = warnings.join(' ');
  return result;
}

/** User-facing guidance printed by init. */
export function formatClaudeLeanHarnessGuidance(report) {
  if (!report || report.status === 'error') return '';
  if (report.active === true) {
    return (
      '[init] Claude Code: installed the sweet-search lean harness (a shorter system prompt, '
      + 'unused tools off: web search/fetch, skills, notebooks, plan mode, worktrees, auto memory). '
      + 'Start a new session. `sweet-search uninstall` restores the defaults.\n'
      + (report.warning ? `[init] Note: ${report.warning}\n` : '')
    );
  }
  return report.warning ? `[init] WARNING: ${report.warning}\n` : '';
}

/**
 * Reverse `installClaudeLeanHarness`: remove only what the manifest says we added and the
 * user did not change since.
 *
 * @returns {{status: string, detail: string}} status in { removed, not-found, dry-run, error }
 */
export function removeClaudeLeanHarness({ projectRoot, dryRun = false } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'remove-claude-lean-harness: projectRoot is required' };
  const manifestPath = join(projectRoot, CLAUDE_LEAN_MANIFEST_REL);
  const manifestRead = readJson(manifestPath, CLAUDE_LEAN_MANIFEST_REL);
  if (manifestRead.error) return { status: 'error', detail: manifestRead.error };
  if (!manifestRead.exists) return { status: 'not-found', detail: 'no lean harness manifest' };
  const manifest = manifestRead.value;
  const settingsPath = join(projectRoot, SETTINGS_REL);
  const settingsRead = readJson(settingsPath, SETTINGS_REL);
  if (settingsRead.error) return { status: 'error', detail: settingsRead.error };
  const settings = settingsRead.value;

  const ownedFiles = Object.keys(manifest.files || {})
    .filter(rel => fileState(projectRoot, rel, manifest) === 'ours');
  const parts = [...ownedFiles];
  if (manifest.setAgent && settings.agent === CLAUDE_LEAN_AGENT_NAME) parts.push('agent selection');
  if ((manifest.addedDeny || []).length) parts.push('deny entries');
  if (Object.keys(manifest.addedEnv || {}).length) parts.push('env');
  if (dryRun) return { status: 'dry-run', detail: parts.join(' + ') || 'manifest only' };

  try {
    if (settingsRead.exists) {
      if (manifest.setAgent && settings.agent === CLAUDE_LEAN_AGENT_NAME) delete settings.agent;
      if (Array.isArray(settings.permissions?.deny)) {
        const added = new Set(manifest.addedDeny || []);
        settings.permissions.deny = settings.permissions.deny.filter(e => !added.has(e));
        if (!settings.permissions.deny.length) delete settings.permissions.deny;
        if (!Object.keys(settings.permissions).length) delete settings.permissions;
      }
      if (settings.env && typeof settings.env === 'object') {
        for (const [key, value] of Object.entries(manifest.addedEnv || {})) {
          if (settings.env[key] === value) delete settings.env[key];
        }
        if (!Object.keys(settings.env).length) delete settings.env;
      }
      writeJson(settingsPath, settings);
    }
    for (const rel of ownedFiles) {
      const path = join(projectRoot, rel);
      unlinkSync(path);
      try { rmdirSync(dirname(path)); } catch { /* keep a non-empty directory */ }
    }
    unlinkSync(manifestPath);
    return { status: 'removed', detail: parts.join(' + ') || 'manifest only' };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}
