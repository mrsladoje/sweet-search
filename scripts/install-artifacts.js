/**
 * The one list of what `sweet-search init` leaves in a project, read by `sweet-search uninstall`.
 *
 * One entry per artifact: how to remove it, how to say it in the uninstall plan and in the
 * removal report, and which of the harness paths it creates. `init` keeps its own call sequence
 * (its calls depend on its flags) and reads this module for the created-paths record.
 *
 * The dry-run plan and the removal run print the same artifacts in two different orders, so each
 * entry carries two ranks: `planRank` for the plan, `runRank` for the run. The Codex SessionStart
 * hook is removed before the Codex harness so that an emptied `.codex/` directory goes too.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { INIT_DATA_DIR_NAME } from '../core/infrastructure/init-config.js';
import { removeAgentInstructions } from './inject-agent-instructions.js';
import { removeClaudeRules } from './write-claude-rules.js';
import { removeClaudeSystemPrompt } from './install-claude-system-prompt.js';
import { removeClaudeLeanHarness } from './install-claude-lean-harness.js';
import { removeMcpServer } from './install-mcp-server.js';
import { removeCodexHarness } from './install-codex-harness.js';
import { removeOpencodeHarness } from './install-opencode-harness.js';
import { removeToolEnforcement } from './install-tool-enforcement.js';
import { removeCodexSessionStartHook, removePrewarmSessionStartHook } from './hook-entries.js';

export const DATA_DIR_NAME = INIT_DATA_DIR_NAME;

/**
 * Remove `.claude/skills/sweet-index/` (the `/sweet-index` skill init installs). Only that subtree:
 * `.claude/` and `.claude/skills/` stay untouched even if they are empty afterwards, because the
 * user may add other skills/hooks/settings there over time and we don't own that root.
 *
 * Returns `{ status, detail, skillPath? }`:
 *   not-found  — directory absent (nothing to do)
 *   removed    — rm -rf on the sweet-index/ subtree succeeded
 *   dry-run    — found the directory but skipped the delete
 *   error      — rm failed (permissions, etc.); uninstall continues
 */
export function removeSweetIndexSkill(projectRoot, { dryRun = false } = {}) {
  const skillDir = join(projectRoot, '.claude', 'skills', 'sweet-index');
  if (!existsSync(skillDir)) {
    return { status: 'not-found', detail: 'no .claude/skills/sweet-index/' };
  }
  if (dryRun) {
    return { status: 'dry-run', detail: skillDir, skillPath: skillDir };
  }
  try {
    rmSync(skillDir, { recursive: true, force: true });
    return { status: 'removed', detail: skillDir, skillPath: skillDir };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

// What the removal run prints for one result: `{ text, count }` events, `count` being the tally
// the line adds to ('removed' or 'kept').
function reportStatus(result, { ok = ['removed'], label, keptWhen = [] }) {
  if (ok.includes(result.status)) {
    return [{ text: `  Removed: ${label}${result.detail ? ` (${result.detail})` : ''}`, count: 'removed' }];
  }
  if (keptWhen.includes(result.status)) {
    return [{ text: `  Kept: ${label} — ${result.detail}`, count: 'kept' }];
  }
  if (result.status === 'error') {
    return [{ text: `  Failed to remove ${label}: ${result.detail}`, count: 'kept' }];
  }
  return [];
}

const keptLines = (result) => (result.kept ?? []).map((k) => ({ text: `  Kept: ${k}`, count: 'kept' }));

/**
 * Every artifact init may leave in a project, in install order (the order of the union of
 * `creates` is the order of TRACKED_CREATED_PATHS).
 *
 *   remove(projectRoot, { dryRun })  the remover, normalised to `{ status, detail, ... }`
 *   planLabel(result)                the plan line, used when a dry run answers 'dry-run'
 *   report(result)                   the removal run's output events
 *   creates                          the tracked paths the installer may create
 *   planRank, runRank                position in the plan / in the removal run
 */
export const PROJECT_ARTIFACTS = Object.freeze([
  {
    id: 'prewarm-hook',
    remove: removePrewarmSessionStartHook,
    planLabel: () => 'daemon-prewarm SessionStart hook in .claude/settings.json',
    report: (result) => reportStatus(result, { label: 'daemon-prewarm SessionStart hook' }),
    creates: ['.claude', '.claude/settings.json'],
    planRank: 1,
    runRank: 2,
  },
  {
    id: 'sweet-index-skill',
    remove: removeSweetIndexSkill,
    planLabel: () => '/sweet-index skill (.claude/skills/sweet-index/)',
    report: (result) => reportStatus(result, { label: '/sweet-index skill' }),
    creates: ['.claude', '.claude/skills'],
    planRank: 2,
    runRank: 1,
  },
  {
    id: 'claude-rules',
    remove: (projectRoot, { dryRun } = {}) => ({ status: removeClaudeRules({ projectRoot, dryRun }) }),
    planLabel: () => '.claude/rules/sweet-search.md',
    report: (result) => {
      if (result.status === 'removed') return [{ text: '  Removed: .claude/rules/sweet-search.md', count: 'removed' }];
      if (result.status === 'preserved-user-file') {
        return [{ text: '  Kept: .claude/rules/sweet-search.md — no sweet-search sentinel (user-edited)', count: 'kept' }];
      }
      return [];
    },
    creates: ['.claude', '.claude/rules'],
    planRank: 4,
    runRank: 7,
  },
  {
    id: 'claude-lean-harness',
    remove: (projectRoot, { dryRun } = {}) => removeClaudeLeanHarness({ projectRoot, dryRun }),
    planLabel: (result) => `Claude lean harness (${result.detail})`,
    report: (result) => reportStatus(result, { label: 'Claude lean harness' }),
    creates: ['.claude', '.claude/agents'],
    planRank: 6,
    runRank: 9,
  },
  {
    id: 'claude-system-prompt',
    remove: (projectRoot, { dryRun } = {}) => removeClaudeSystemPrompt({ projectRoot, dryRun }),
    planLabel: (result) => `Claude system-prompt output style (${result.detail})`,
    report: (result) => {
      const events = reportStatus(result, { label: 'Claude system-prompt output style' });
      if (result.status === 'not-found' && result.detail === 'output style is user-authored') {
        events.push({ text: '  Kept: Claude output style — no sweet-search sentinel (user-authored)', count: 'kept' });
      }
      return events;
    },
    creates: ['.claude', '.claude/output-styles'],
    planRank: 5,
    runRank: 8,
  },
  {
    id: 'tool-enforcement',
    remove: (projectRoot, { dryRun } = {}) => removeToolEnforcement({ projectRoot, dryRun }),
    planLabel: (result) => `tool-enforcement strict mode (${result.detail})`,
    report: (result) => reportStatus(result, { label: 'tool-enforcement' }),
    creates: ['.claude/settings.json'],
    planRank: 7,
    runRank: 10,
  },
  {
    id: 'agent-instructions',
    remove: (projectRoot, { dryRun } = {}) => {
      const result = removeAgentInstructions({ projectRoot, dryRun });
      const harnesses = result.harnesses ?? {};
      const targets = Object.entries(harnesses).filter(([, v]) => v === 'dry-run').map(([k]) => k);
      return { status: targets.length > 0 ? 'dry-run' : 'none', detail: targets.join(', '), harnesses };
    },
    planLabel: (result) => `agent-instruction marker blocks (${result.detail})`,
    report: (result) => {
      const events = [];
      for (const [harness, status] of Object.entries(result.harnesses)) {
        if (status === 'removed') {
          events.push({ text: `  Removed: ${harness} agent-instruction block`, count: 'removed' });
        } else if (status === 'file-deleted') {
          events.push({ text: `  Removed: ${harness} agent-instruction file (wholly sweet-search-managed)`, count: 'removed' });
        }
      }
      return events;
    },
    creates: ['.cursor', '.cursor/rules'],
    planRank: 3,
    runRank: 6,
  },
  {
    id: 'codex-session-hook',
    remove: removeCodexSessionStartHook,
    planLabel: () => 'Codex SessionStart hook (.codex/hooks.json)',
    report: (result) => reportStatus(result, { label: 'Codex SessionStart hook' }),
    creates: [],
    planRank: 8,
    runRank: 3,
  },
  {
    id: 'codex-harness',
    remove: (projectRoot, { dryRun } = {}) => removeCodexHarness({ projectRoot, dryRun }),
    planLabel: (result) => `Codex harness (${result.detail})`,
    // Only what the Codex harness manifest records as added and unchanged since (the config.toml
    // hooks flag only when init added it).
    report: (result) => [...reportStatus(result, { label: 'Codex harness' }), ...keptLines(result)],
    creates: [],
    planRank: 9,
    runRank: 4,
  },
  {
    id: 'opencode-harness',
    remove: (projectRoot, { dryRun } = {}) => removeOpencodeHarness({ projectRoot, dryRun }),
    planLabel: (result) => `opencode harness (${result.detail})`,
    report: (result) => [...reportStatus(result, { label: 'opencode harness' }), ...keptLines(result)],
    creates: [],
    planRank: 10,
    runRank: 5,
  },
  {
    id: 'mcp-server',
    remove: (projectRoot, { dryRun } = {}) => ({ status: removeMcpServer({ projectRoot, dryRun }) }),
    planLabel: () => 'MCP server registration (.mcp.json — mcpServers.sweet-search)',
    report: (result) => {
      if (result.status === 'removed') {
        return [{ text: '  Removed: MCP server registration (.mcp.json — mcpServers.sweet-search)', count: 'removed' }];
      }
      if (result.status === 'file-deleted') {
        return [{ text: '  Removed: .mcp.json (wholly sweet-search-managed)', count: 'removed' }];
      }
      return [];
    },
    creates: [],
    planRank: 11,
    runRank: 11,
  },
]);

/** The artifacts in the order of the dry-run plan. */
export const artifactsInPlanOrder = () => [...PROJECT_ARTIFACTS].sort((a, b) => a.planRank - b.planRank);

/** The artifacts in the order of the removal run. */
export const artifactsInRunOrder = () => [...PROJECT_ARTIFACTS].sort((a, b) => a.runRank - b.runRank);

// ---------------------------------------------------------------------------
// Paths init created (so uninstall can remove what is left of them)
// ---------------------------------------------------------------------------

// Harness paths init may create. Recorded in .sweet-search/created-paths.json only
// when THIS init created them (absent before, present after), so uninstall never
// removes a directory or settings file the user had.
export const CREATED_PATHS_FILE = 'created-paths.json';
export const TRACKED_CREATED_PATHS = Object.freeze([...new Set(PROJECT_ARTIFACTS.flatMap((a) => a.creates))]);

/** The tracked paths that exist now. */
export function snapshotTrackedPaths(projectRoot) {
  return new Set(TRACKED_CREATED_PATHS.filter((rel) => existsSync(join(projectRoot, rel))));
}

/** The paths recorded by earlier inits. */
export function readCreatedPaths(projectRoot) {
  try {
    const list = JSON.parse(readFileSync(join(projectRoot, DATA_DIR_NAME, CREATED_PATHS_FILE), 'utf-8'));
    return Array.isArray(list) ? list.filter((rel) => TRACKED_CREATED_PATHS.includes(rel)) : [];
  } catch {
    return [];
  }
}

/** Add the tracked paths that did not exist in `before` and exist now to the record. */
export function recordCreatedPaths(projectRoot, before) {
  try {
    const created = new Set(readCreatedPaths(projectRoot));
    for (const rel of snapshotTrackedPaths(projectRoot)) if (!before.has(rel)) created.add(rel);
    if (created.size === 0) return;
    const list = TRACKED_CREATED_PATHS.filter((rel) => created.has(rel));
    writeFileSync(join(projectRoot, DATA_DIR_NAME, CREATED_PATHS_FILE), JSON.stringify(list, null, 2) + '\n', 'utf-8');
  } catch { /* best-effort — uninstall then keeps what it cannot prove init created */ }
}
