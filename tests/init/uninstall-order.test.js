/**
 * Pins the order of the per-repo lines `sweet-search uninstall` prints: the dry-run plan
 * (`planProjectUninstall`) and the "Removed:" lines of the run (`executeProjectUninstall`)
 * list the same artifacts in two different orders. Runs the real CLI on a repo set up
 * with every init artifact.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'core', 'cli.js');

let tmpRoot;
let home;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sweet-search-uninstall-order-'));
  home = mkdtempSync(join(tmpdir(), 'sweet-search-uninstall-order-home-'));
  writeFileSync(join(tmpRoot, 'package.json'), '{}');
});
afterEach(() => {
  for (const dir of [tmpRoot, home]) if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function runCli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpRoot,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function installEverything() {
  const r = runCli([
    'init', '--skip-models', '--skip-cuda', '--claude', '--codex', '--opencode', '--mcp',
    '--agents', '--gemini', '--cursor', '--enforce-tools',
  ]);
  expect(r.code, `init failed: ${r.stderr}`).toBe(0);
}

describe('uninstall output order', () => {
  it('dry-run plan lists the artifacts in plan order', () => {
    installEverything();
    const r = runCli(['uninstall', '--dry-run']);
    expect(r.code).toBe(0);
    const lines = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Sweet Search') && !l.startsWith('Repo:') && !l.startsWith('Dry run'));
    expect(lines.map((l) => l.replace(/ \(.*$/s, '').replace(/ — .*$/s, ''))).toEqual([
      '.sweet-search/',
      'daemon-prewarm SessionStart hook in .claude/settings.json',
      '/sweet-index skill',
      'agent-instruction marker blocks',
      '.claude/rules/sweet-search.md',
      'Claude lean harness',
      'tool-enforcement strict mode',
      'Codex SessionStart hook',
      'Codex harness',
      'opencode harness',
      'MCP server registration',
    ]);
  });

  it('the run reports removals in run order', () => {
    installEverything();
    const r = runCli(['uninstall', '--force']);
    expect(r.code, r.stderr).toBe(0);
    const removed = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('Removed:'));
    expect(removed.map((l) => l.replace(/ \(.*$/s, '').replace(/ — .*$/s, ''))).toEqual([
      'Removed: .sweet-search/',
      'Removed: /sweet-index skill',
      'Removed: daemon-prewarm SessionStart hook',
      'Removed: Codex SessionStart hook',
      'Removed: Codex harness',
      'Removed: opencode harness',
      'Removed: agents agent-instruction file',
      'Removed: gemini agent-instruction block',
      'Removed: cursor agent-instruction file',
      'Removed: .claude/rules/sweet-search.md',
      'Removed: Claude lean harness',
      'Removed: tool-enforcement',
      'Removed: .mcp.json',
      'Removed: now-empty paths init created',
    ]);
  });
});
