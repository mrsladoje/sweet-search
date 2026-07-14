/**
 * Tests for the `init --codex` wiring: the Codex CLI SessionStart hook
 * (.codex/hooks.json), the canonical `[features] hooks = true` feature-flag
 * editor for config.toml (which also migrates the deprecated `codex_hooks`),
 * and the uninstall counterpart. `init --codex` is the complete normal Codex
 * setup; the only remaining manual step is `/hooks` trust.
 *
 * Mirrors tests/init/prewarm-hook.test.js (the Claude prewarm equivalent):
 *   - merge is non-destructive (preserves other events/entries)
 *   - idempotent re-install updates in place (no duplicate)
 *   - filename-based marker detection (the shared launcher filename)
 *   - refuses to write a machine-specific absolute path
 *   - feature-flag editor is comment-preserving + append-if-absent
 *   - uninstall removes only the sweet-search-owned entry
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INIT_CLI = join(REPO_ROOT, 'scripts', 'init.js');

import {
  registerCodexSessionStartHook,
  ensureCodexHooksFeatureFlag,
  formatCodexSetupGuidance,
  CODEX_HOOKS_FILENAME,
  PREWARM_HOOK_FILENAME,
} from '../../scripts/init.js';
import { removeCodexSessionStartHook } from '../../scripts/uninstall.js';

let projectRoot;
let packageRoot;
let externalRoot;
let hooksPath;

function readHooks() {
  return JSON.parse(readFileSync(hooksPath, 'utf-8'));
}

function seedHookScript(pkgRoot) {
  const hookDir = join(pkgRoot, 'core', 'search');
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(join(hookDir, PREWARM_HOOK_FILENAME), '// test fixture', 'utf-8');
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-codex-proj-'));
  packageRoot = join(projectRoot, 'node_modules', 'sweet-search');
  seedHookScript(packageRoot);
  externalRoot = mkdtempSync(join(tmpdir(), 'ss-codex-ext-'));
  seedHookScript(externalRoot);
  hooksPath = join(projectRoot, '.codex', CODEX_HOOKS_FILENAME);
});

afterEach(() => {
  for (const d of [projectRoot, externalRoot]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// registerCodexSessionStartHook
// ---------------------------------------------------------------------------

describe('registerCodexSessionStartHook', () => {
  it('creates .codex/hooks.json with a SessionStart entry when none exists', () => {
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });

    expect(result.status).toBe('registered');
    expect(result.detail).toContain('added');

    const doc = readHooks();
    expect(doc.hooks.SessionStart).toHaveLength(1);
    const group = doc.hooks.SessionStart[0];
    expect(group.matcher).toBe('startup|resume|clear|compact');
    const handler = group.hooks[0];
    expect(handler.type).toBe('command');
    expect(handler.command).toContain(PREWARM_HOOK_FILENAME);
    expect(handler.command).toContain('--agent-session-hook');
    expect(typeof handler.timeout).toBe('number');
    // Resolves from the git root (not a bare relative path) per the Codex
    // docs, and invokes node.
    expect(handler.command).toContain('git rev-parse --show-toplevel');
    expect(handler.command).toContain('node ');
    // No shell-comment marker trick.
    expect(handler.command).not.toContain('#');
  });

  it('is idempotent: re-running updates in place, never duplicates', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });

    expect(result.status).toBe('registered');
    expect(result.detail).toContain('updated');
    expect(readHooks().hooks.SessionStart).toHaveLength(1);
  });

  it('preserves pre-existing SessionStart entries and other events from other tools', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo other-session-start' }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'echo done' }] },
        ],
      },
    }, null, 2), 'utf-8');

    registerCodexSessionStartHook({ projectRoot, packageRoot });

    const doc = readHooks();
    expect(doc.hooks.SessionStart).toHaveLength(2);
    expect(doc.hooks.SessionStart[0].hooks[0].command).toContain('other-session-start');
    expect(doc.hooks.SessionStart[1].hooks[0].command).toContain(PREWARM_HOOK_FILENAME);
    // Sibling event untouched.
    expect(doc.hooks.Stop).toHaveLength(1);
    expect(doc.hooks.Stop[0].hooks[0].command).toContain('done');
  });

  it('short-circuits when skipped=true and does not touch the file', () => {
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot, skipped: true });
    expect(result.status).toBe('skipped');
    expect(existsSync(hooksPath)).toBe(false);
  });

  it('returns error when existing hooks.json is not valid JSON', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(hooksPath, '{ not json', 'utf-8');

    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });
    expect(result.status).toBe('error');
    expect(result.detail).toContain('JSON');
  });

  it('returns error when the hook script is missing from packageRoot', () => {
    rmSync(join(packageRoot, 'core', 'search', PREWARM_HOOK_FILENAME));

    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });
    expect(result.status).toBe('error');
    expect(result.detail).toContain('missing');
  });

  it('refuses to write an absolute path when the package lives outside projectRoot', () => {
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot: externalRoot });
    expect(result.status).toBe('skipped');
    expect(result.detail).toMatch(/outside projectRoot|hoisted|linked/i);
    expect(existsSync(hooksPath)).toBe(false);
  });

  it('writes a relative node_modules/ path in a realistic install layout', () => {
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });
    expect(result.status).toBe('registered');
    expect(result.hookPath.startsWith('node_modules/')).toBe(true);
    expect(result.hookPath).not.toMatch(/^\//);
    expect(result.hookPath).not.toContain('..');
  });
});

// ---------------------------------------------------------------------------
// ensureCodexHooksFeatureFlag
// ---------------------------------------------------------------------------

describe('ensureCodexHooksFeatureFlag', () => {
  let configPath;

  beforeEach(() => {
    configPath = join(projectRoot, '.codex', 'config.toml');
  });

  it('creates config.toml with the canonical [features] hooks = true when absent and create=true', () => {
    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('created');
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toMatch(/\[features\]/);
    expect(text).toMatch(/^hooks\s*=\s*true/m);
    // Never writes the deprecated key as the primary flag.
    expect(text).not.toMatch(/codex_hooks/);
  });

  it('reports absent without writing when the file is missing and create=false', () => {
    const result = ensureCodexHooksFeatureFlag(configPath, { create: false });
    expect(result.status).toBe('absent');
    expect(existsSync(configPath)).toBe(false);
  });

  it('is a no-op when the canonical hooks = true is already present', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    const original = '# my config\n[features]\nhooks = true\n';
    writeFileSync(configPath, original, 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('already');
    expect(readFileSync(configPath, 'utf-8')).toBe(original);
  });

  it('migrates a deprecated codex_hooks = true to the canonical hooks = true', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(configPath, '[features]\ncodex_hooks = true\n', 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('migrated');
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toMatch(/^hooks\s*=\s*true/m);
    expect(text).not.toMatch(/codex_hooks/);
  });

  it('migrates codex_hooks without corrupting surrounding comments', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(
      configPath,
      '# top comment\n[features]\ncodex_hooks = true # keep this inline note\nweb_search = true\n',
      'utf-8',
    );

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('migrated');
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toContain('# top comment');
    expect(text).toContain('# keep this inline note');   // inline comment preserved
    expect(text).toContain('web_search = true');         // sibling key preserved
    expect(text).toMatch(/^hooks\s*=\s*true # keep this inline note$/m);
    expect(text).not.toMatch(/codex_hooks/);
  });

  it('strips a deprecated codex_hooks line when canonical hooks = true is already set', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(configPath, '[features]\nhooks = true\ncodex_hooks = true\n', 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('migrated');
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toMatch(/^hooks\s*=\s*true/m);
    expect(text).not.toMatch(/codex_hooks/);
  });

  it('leaves an explicit non-true canonical value alone (no duplicate key)', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    const original = '[features]\nhooks = false\n';
    writeFileSync(configPath, original, 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('present-other');
    expect(readFileSync(configPath, 'utf-8')).toBe(original);
  });

  it('inserts under an existing [features] table, preserving comments and other keys', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(configPath, '# top comment\n[features]\nweb_search = true # inline comment\n', 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('added');
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toContain('# top comment');
    expect(text).toContain('web_search = true # inline comment');
    expect(text).toMatch(/\[features\]\s*\nhooks = true/);
    expect(text).not.toMatch(/codex_hooks/);
  });

  it('appends a new [features] block when none exists, preserving prior content', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    const original = '# header comment\nmodel = "gpt-5"\n\n[tui]\nnotifications = true\n';
    writeFileSync(configPath, original, 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('added');
    const text = readFileSync(configPath, 'utf-8');
    expect(text.startsWith(original)).toBe(true);          // prior content intact
    expect(text).toContain('# header comment');
    expect(text).toMatch(/\[features\]\nhooks = true/);
    expect(text).not.toMatch(/codex_hooks/);
  });
});

// ---------------------------------------------------------------------------
// removeCodexSessionStartHook
// ---------------------------------------------------------------------------

describe('removeCodexSessionStartHook', () => {
  it('returns not-found when .codex/hooks.json does not exist', () => {
    expect(removeCodexSessionStartHook(projectRoot).status).toBe('not-found');
  });

  it('returns not-found when no entry matches the marker filename', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo other' }] }] },
    }), 'utf-8');

    const result = removeCodexSessionStartHook(projectRoot);
    expect(result.status).toBe('not-found');
    expect(readHooks().hooks.SessionStart).toHaveLength(1);
  });

  it('removes only the sweet-search-owned entry, preserving the rest', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    // Add a foreign entry alongside ours.
    const doc = readHooks();
    doc.hooks.SessionStart.unshift({ hooks: [{ type: 'command', command: 'echo other' }] });
    doc.hooks.Stop = [{ hooks: [{ type: 'command', command: 'echo done' }] }];
    writeFileSync(hooksPath, JSON.stringify(doc, null, 2), 'utf-8');

    const result = removeCodexSessionStartHook(projectRoot);
    expect(result.status).toBe('removed');

    const after = readHooks();
    expect(after.hooks.SessionStart).toHaveLength(1);
    expect(after.hooks.SessionStart[0].hooks[0].command).toContain('other');
    expect(after.hooks.Stop).toHaveLength(1); // sibling event untouched
  });

  it('deletes the file when our entry was the only content', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    expect(existsSync(hooksPath)).toBe(true);

    const result = removeCodexSessionStartHook(projectRoot);
    expect(result.status).toBe('removed');
    expect(existsSync(hooksPath)).toBe(false);
  });

  it('dry-run reports the entry exists but does not write', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    const before = readFileSync(hooksPath, 'utf-8');

    const result = removeCodexSessionStartHook(projectRoot, { dryRun: true });
    expect(result.status).toBe('dry-run');
    expect(readFileSync(hooksPath, 'utf-8')).toBe(before);
  });

  it('returns error when hooks.json is not valid JSON', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(hooksPath, 'not json at all', 'utf-8');

    expect(removeCodexSessionStartHook(projectRoot).status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('register + remove round-trip', () => {
  it('restores .codex/ to its pre-registration state (file deleted) when ours was the only entry', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    removeCodexSessionStartHook(projectRoot);
    expect(existsSync(hooksPath)).toBe(false);
  });

  it('leaves foreign entries intact after a register+remove cycle', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    const foreign = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } };
    writeFileSync(hooksPath, JSON.stringify(foreign, null, 2), 'utf-8');

    registerCodexSessionStartHook({ projectRoot, packageRoot });
    removeCodexSessionStartHook(projectRoot);

    const after = readHooks();
    expect(after.hooks.SessionStart).toHaveLength(1);
    expect(after.hooks.SessionStart[0].hooks[0].command).toContain('other');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: `init --codex` writes the canonical flag + names it in output
// ---------------------------------------------------------------------------

describe('init --codex (end-to-end flag wiring)', () => {
  let home;
  let proj;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ss-codex-home-'));
    proj = mkdtempSync(join(tmpdir(), 'ss-codex-e2e-'));
    writeFileSync(join(proj, 'package.json'), '{"name":"tmp","version":"1.0.0"}\n', 'utf-8');
  });

  afterEach(() => {
    for (const d of [home, proj]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('writes [features] hooks = true to project + global config and names hooks (not codex_hooks) in output', () => {
    // HOME is redirected to a temp dir so the global-flag write never touches
    // the real ~/.codex. --profile core avoids any model downloads.
    const r = spawnSync(
      process.execPath,
      [INIT_CLI, '--codex', '--codex-enable-global-hooks', '--profile', 'core'],
      { cwd: proj, env: { ...process.env, HOME: home }, encoding: 'utf-8', timeout: 60_000 },
    );
    expect(r.status).toBe(0);

    // Project flag.
    const projCfg = readFileSync(join(proj, '.codex', 'config.toml'), 'utf-8');
    expect(projCfg).toMatch(/^hooks\s*=\s*true/m);
    expect(projCfg).not.toMatch(/codex_hooks/);

    // Global flag (in the redirected HOME, not the real one).
    const globalCfg = readFileSync(join(home, '.codex', 'config.toml'), 'utf-8');
    expect(globalCfg).toMatch(/^hooks\s*=\s*true/m);
    expect(globalCfg).not.toMatch(/codex_hooks/);

    // Init output names the canonical flag, never the deprecated one.
    expect(r.stderr).toContain('[features] hooks');
    expect(r.stderr).not.toMatch(/codex_hooks\s*=\s*true/);
  });

  it('init --codex alone enables the project flag, never writes the global config, and never pushes --codex-enable-global-hooks or .mcp.json', () => {
    // No --codex-enable-global-hooks: the normal path must be self-sufficient.
    // (In this harness the CLI runs from the repo, so the hook script lives
    // outside the temp project and hook *registration* is skipped — the project
    // config flag write and the output wording are exercised regardless. The
    // registered-hook success message is covered by formatCodexSetupGuidance
    // unit tests and the packed-install smoke.)
    const r = spawnSync(
      process.execPath,
      [INIT_CLI, '--codex', '--profile', 'core'],
      { cwd: proj, env: { ...process.env, HOME: home }, encoding: 'utf-8', timeout: 60_000 },
    );
    expect(r.status).toBe(0);

    // Project feature flag is the canonical one, never the deprecated key.
    const projCfg = readFileSync(join(proj, '.codex', 'config.toml'), 'utf-8');
    expect(projCfg).toMatch(/^hooks\s*=\s*true/m);
    expect(projCfg).not.toMatch(/codex_hooks/);

    // No global config write without the explicit legacy flag.
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);

    // Output names the canonical flag and never pushes the legacy global flag or
    // the deprecated key for the normal path.
    expect(r.stderr).toContain('[features] hooks');
    expect(r.stderr).not.toContain('--codex-enable-global-hooks');
    expect(r.stderr).not.toMatch(/codex_hooks\s*=\s*true/);

    // init --codex never creates an MCP config.
    expect(existsSync(join(proj, '.mcp.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatCodexSetupGuidance — the registered-hook UX message (pure)
// ---------------------------------------------------------------------------

describe('formatCodexSetupGuidance', () => {
  it('returns null when the hook was not registered (skipped / error)', () => {
    expect(formatCodexSetupGuidance({ hookStatus: 'skipped', projectFlagStatus: 'created' })).toBeNull();
    expect(formatCodexSetupGuidance({ hookStatus: 'error', projectFlagStatus: 'created' })).toBeNull();
  });

  for (const status of ['created', 'added', 'already', 'migrated']) {
    it(`frames /hooks as the only manual step when the project flag is '${status}'`, () => {
      const msg = formatCodexSetupGuidance({ hookStatus: 'registered', projectFlagStatus: status });
      expect(msg).toBeTypeOf('string');
      // The canonical flag is reported as already enabled by init.
      expect(msg).toContain('[features] hooks = true');
      // The only remaining manual step is /hooks trust.
      expect(msg).toContain('/hooks');
      // Never instructs the user to pass the legacy global flag for the normal path.
      expect(msg).not.toContain('--codex-enable-global-hooks');
      // Never names the deprecated key.
      expect(msg).not.toMatch(/codex_hooks/);
      // Surfaces the durable, hook-independent guarantee + MCP-optional so users
      // don't think the hook is load-bearing.
      expect(msg).toMatch(/first use/i);
      expect(msg).toMatch(/MCP is optional/i);
      // Notes the codex exec caveat.
      expect(msg).toContain('codex exec');
    });
  }

  it("tells the user to set hooks = true when the project config explicitly disabled it ('present-other')", () => {
    const msg = formatCodexSetupGuidance({ hookStatus: 'registered', projectFlagStatus: 'present-other' });
    expect(msg).toContain('hooks = true');
    expect(msg).toContain('/hooks');
    expect(msg).not.toContain('--codex-enable-global-hooks');
    expect(msg).not.toMatch(/codex_hooks/);
  });

  it('reports the failure status and still points at /hooks for any other flag status', () => {
    const msg = formatCodexSetupGuidance({ hookStatus: 'registered', projectFlagStatus: 'error' });
    expect(msg).toContain('error');
    expect(msg).toContain('/hooks');
    expect(msg).not.toContain('--codex-enable-global-hooks');
  });
});

// ---------------------------------------------------------------------------
// Docs consistency with current Codex behavior
// ---------------------------------------------------------------------------

describe('docs/PREHEATING.md Codex section', () => {
  it('documents the canonical flag, /hooks trust, and codex --enable hooks', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs', 'PREHEATING.md'), 'utf-8');
    expect(doc).toMatch(/hooks = true/);
    expect(doc).toContain('/hooks');
    expect(doc).toContain('codex --enable hooks');
    // Never presents the deprecated flag as the value to set.
    expect(doc).not.toMatch(/codex_hooks\s*=\s*true/);
  });

  it('frames init --codex as the normal setup and names the durable, hook-independent guarantee', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs', 'PREHEATING.md'), 'utf-8');
    // init --codex is the complete normal setup.
    expect(doc).toMatch(/init\s+--codex/);
    expect(doc).toMatch(/complete normal setup/i);
    // The durable guarantee is the CLI/warm-server first-use launcher, not hooks.
    expect(doc).toMatch(/first[- ]use/i);
    // `codex exec` does not prove SessionStart behaviour.
    expect(doc).toContain('codex exec');
    // MCP remains optional / unrelated to default indexing.
    expect(doc).toMatch(/MCP/);
  });
});
