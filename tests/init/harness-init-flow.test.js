/**
 * `sweet-search init` / `uninstall` end to end for the three harnesses (real CLI, temp project,
 * temp HOME): default = Claude Code only, --codex = Codex only, --opencode = opencode only, and
 * --claude adds Claude Code to the others. Rules go per project and never into AGENTS.md /
 * CLAUDE.md; an old AGENTS.md block is migrated away (for Codex only once the project is trusted);
 * uninstall leaves no sweet-search file, key or rule behind.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANONICAL_POLICY_BODY, MARKER_BEGIN, MARKER_END } from '../../scripts/inject-agent-instructions.js';
import {
  CODEX_CONFIG_REL, CODEX_INSTRUCTIONS_REL, CODEX_MANIFEST_REL,
} from '../../scripts/install-codex-harness.js';
import {
  OPENCODE_CONFIG_REL, OPENCODE_PLUGIN_REL, OPENCODE_PROMPT_REL, OPENCODE_RULES_REL,
} from '../../scripts/install-opencode-harness.js';
import { codexInstructions, opencodePrompt } from '../../scripts/harness-prompts/index.js';
import { CLAUDE_LEAN_AGENT_REL } from '../../scripts/install-claude-lean-harness.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'core', 'cli.js');

let proj;
let home;
beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'ss-harness-flow-'));
  home = mkdtempSync(join(tmpdir(), 'ss-harness-home-'));
  writeFileSync(join(proj, 'package.json'), '{}');
});
afterEach(() => {
  for (const d of [proj, home]) rmSync(d, { recursive: true, force: true });
});

const exists = rel => existsSync(join(proj, rel));
const read = rel => readFileSync(join(proj, rel), 'utf8');
function run(args, { status = 0 } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: proj, encoding: 'utf8', timeout: 90_000,
    env: {
      ...process.env, HOME: home, CODEX_HOME: join(home, '.codex'), XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local', 'share'),
      SWEET_SEARCH_RUNTIME_DIR: join(home, 'runtime'),
    },
  });
  expect(r.status, `${args.join(' ')} failed: ${r.stderr}`).toBe(status);
  return r;
}
// Trust the temp project in the temp Codex config, spelled as written plus a trailing slash
// (init matches it after resolving symlinks and dropping the slash).
function trustCodexProject() {
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), `model = "m"\n\n[projects.${JSON.stringify(`${proj}/`)}]\ntrust_level = "trusted"\n`);
}
const init = (...flags) => run(['init', '--profile=core', '--skip-prewarm-hook', '--skip-cuda', ...flags]);
const uninstall = () => run(['uninstall', '--force']);
const OLD_BLOCK = `${MARKER_BEGIN}\nold policy\n${MARKER_END}\n`;

describe('init: per-project rules, never AGENTS.md / CLAUDE.md', () => {
  it('default = Claude Code only', () => {
    init();
    expect(exists('.claude/rules/sweet-search.md')).toBe(true);
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(true);
    for (const rel of ['AGENTS.md', 'CLAUDE.md', '.codex', '.opencode', 'opencode.json']) expect(exists(rel)).toBe(false);
  });

  it('--codex writes the .codex layer only: no .claude/, no AGENTS.md', () => {
    const r = init('--codex');
    expect(read(CODEX_INSTRUCTIONS_REL)).toBe(codexInstructions());
    const cfg = read(CODEX_CONFIG_REL);
    expect(cfg).toContain('model_instructions_file = "sweet-search-instructions.md"');
    expect(cfg).toContain(CANONICAL_POLICY_BODY.split('\n')[0]);
    // --skip-prewarm-hook: no hook, so no [features] hooks flag either.
    expect(cfg).not.toMatch(/^hooks = true$/m);
    for (const rel of ['.claude', '.opencode', 'AGENTS.md', 'CLAUDE.md']) expect(exists(rel), rel).toBe(false);
    // Untrusted project (no entry in the temp Codex config): a specific warning.
    expect(r.stderr).toContain('this project is not trusted yet, so Codex ignores .codex/config.toml');
    expect(r.stderr).toContain('trust_level = "trusted"');
    // The global Codex config is never written.
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);
  });

  it('--codex in a trusted project says so, and never writes the Codex user config', () => {
    trustCodexProject();
    const before = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    const r = init('--codex');
    expect(r.stderr).toContain('this project is trusted, so Codex loads .codex/config.toml');
    expect(r.stderr).not.toContain('not trusted yet');
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toBe(before);
  });

  it('--opencode writes the .opencode layer only: no .claude/', () => {
    init('--opencode');
    for (const rel of ['.claude', '.codex']) expect(exists(rel), rel).toBe(false);
  });

  it('--codex --opencode sets up both and no .claude/', () => {
    init('--codex', '--opencode');
    expect(exists(CODEX_CONFIG_REL)).toBe(true);
    expect(exists(OPENCODE_CONFIG_REL)).toBe(true);
    expect(exists('.claude')).toBe(false);
  });

  it('--claude --codex sets up Claude Code and Codex', () => {
    init('--claude', '--codex');
    expect(exists('.claude/rules/sweet-search.md')).toBe(true);
    expect(exists(CLAUDE_LEAN_AGENT_REL)).toBe(true);
    expect(exists(CODEX_CONFIG_REL)).toBe(true);
    expect(exists('.opencode')).toBe(false);
  });

  it('--claude --no-claude is rejected before any write', () => {
    const r = run(['init', '--profile=core', '--claude', '--no-claude', '--codex'], { status: 1 });
    expect(r.stderr).toContain('--claude and --no-claude');
    for (const rel of ['.claude', '.codex', '.sweet-search']) expect(exists(rel), rel).toBe(false);
  });

  it('--opencode writes the .opencode layer and no AGENTS.md or root opencode.json', () => {
    init('--opencode');
    expect(read(OPENCODE_PROMPT_REL)).toBe(opencodePrompt());
    expect(read(OPENCODE_RULES_REL)).toBe(`${CANONICAL_POLICY_BODY.trimEnd()}\n`);
    expect(exists(OPENCODE_PLUGIN_REL)).toBe(true);
    expect(JSON.parse(read(OPENCODE_CONFIG_REL)).instructions).toEqual([OPENCODE_RULES_REL]);
    for (const rel of ['AGENTS.md', 'CLAUDE.md', 'opencode.json']) expect(exists(rel)).toBe(false);
    expect(existsSync(join(home, '.config', 'opencode'))).toBe(false);
  });

  it('--codex --agents still writes AGENTS.md for users who ask for it', () => {
    init('--codex', '--agents');
    expect(read('AGENTS.md')).toContain(MARKER_BEGIN);
  });

  it('re-running init is safe (no change on the second run)', () => {
    init('--codex', '--opencode');
    const snap = () => [CODEX_CONFIG_REL, CODEX_INSTRUCTIONS_REL, CODEX_MANIFEST_REL, OPENCODE_CONFIG_REL, OPENCODE_PROMPT_REL].map(read);
    const before = snap();
    const r = init('--codex', '--opencode');
    expect(snap()).toEqual(before);
    expect(r.stderr).toContain('Codex harness: unchanged');
    expect(r.stderr).toContain('opencode harness: unchanged');
  });
});

describe('migration of an old AGENTS.md block', () => {
  for (const flag of ['--codex', '--opencode']) {
    it(`${flag}: strips the block and keeps the user's text`, () => {
      if (flag === '--codex') trustCodexProject();
      writeFileSync(join(proj, 'AGENTS.md'), `${OLD_BLOCK}\n# My notes\nkeep me\n`);
      init(flag);
      const text = read('AGENTS.md');
      expect(text).not.toContain(MARKER_BEGIN);
      expect(text).toContain('keep me');
    });

    it(`${flag}: deletes an AGENTS.md that held only the block`, () => {
      if (flag === '--codex') trustCodexProject();
      writeFileSync(join(proj, 'AGENTS.md'), OLD_BLOCK);
      init(flag);
      expect(exists('AGENTS.md')).toBe(false);
    });
  }

  for (const flags of [['--codex'], ['--codex', '--opencode']]) {
    it(`${flags.join(' ')} in an untrusted Codex project keeps the block until the project is trusted`, () => {
      writeFileSync(join(proj, 'AGENTS.md'), OLD_BLOCK);
      const r = init(...flags);
      expect(read('AGENTS.md')).toBe(OLD_BLOCK);
      expect(r.stderr).toContain('AGENTS.md: kept the old sweet-search block');
      expect(r.stderr).toContain('not trusted yet');
      // Once trusted, the next init strips it.
      trustCodexProject();
      init(...flags);
      expect(exists('AGENTS.md')).toBe(false);
    });
  }

  it('plain init (Claude only) leaves AGENTS.md alone', () => {
    writeFileSync(join(proj, 'AGENTS.md'), OLD_BLOCK);
    init();
    expect(read('AGENTS.md')).toBe(OLD_BLOCK);
  });
});

describe('uninstall restores the harness defaults', () => {
  it('removes every file and key init wrote for all three harnesses', () => {
    init('--codex', '--opencode');
    uninstall();
    for (const rel of ['.codex', '.opencode', 'AGENTS.md', 'CLAUDE.md', 'opencode.json', '.claude/rules', '.claude/agents', '.sweet-search']) {
      expect(exists(rel), rel).toBe(false);
    }
    // Idempotent.
    uninstall();
  });

  it('keeps user content in shared files and restores them byte for byte', () => {
    const codexUser = 'model = "gpt-5.5"\n';
    const ocUser = { model: 'x/y' };
    mkdirSync(join(proj, '.codex'));
    mkdirSync(join(proj, '.opencode'));
    writeFileSync(join(proj, CODEX_CONFIG_REL), codexUser);
    writeFileSync(join(proj, OPENCODE_CONFIG_REL), JSON.stringify(ocUser, null, 2) + '\n');
    init('--codex', '--opencode');
    uninstall();
    expect(read(CODEX_CONFIG_REL)).toBe(codexUser);
    expect(JSON.parse(read(OPENCODE_CONFIG_REL))).toEqual(ocUser);
    expect(readdirSync(join(proj, '.codex'))).toEqual(['config.toml']);
    expect(readdirSync(join(proj, '.opencode'))).toEqual(['opencode.json']);
  });

  it('removes the .claude/ paths a default init created, and keeps a .claude/ the user had', () => {
    init();
    uninstall();
    expect(exists('.claude'), readdirSync(proj).join(',')).toBe(false);

    mkdirSync(join(proj, '.claude', 'skills', 'mine'), { recursive: true });
    init();
    uninstall();
    // The user's .claude/ and .claude/skills/ stay; what init created inside them goes.
    expect(readdirSync(join(proj, '.claude'))).toEqual(['skills']);
    expect(readdirSync(join(proj, '.claude', 'skills'))).toEqual(['mine']);
  });

  it('adopts a config.toml an older init wrote (only the hooks flag) and removes it on uninstall', () => {
    mkdirSync(join(proj, '.codex'));
    writeFileSync(join(proj, CODEX_CONFIG_REL), '[features]\nhooks = true\n');
    init('--codex');
    expect(read(CODEX_CONFIG_REL)).not.toMatch(/^hooks = true$/m); // no hook here, so no flag
    uninstall();
    expect(exists('.codex')).toBe(false);
  });

  it('keeps a hand-edited shipped file and says so', () => {
    init('--codex');
    writeFileSync(join(proj, CODEX_INSTRUCTIONS_REL), 'mine\n');
    const r = uninstall();
    expect(r.stdout).toMatch(/Kept: \.codex\/sweet-search-instructions\.md/);
    expect(read(CODEX_INSTRUCTIONS_REL)).toBe('mine\n');
    // The config init created held only our keys, so it goes.
    expect(exists(CODEX_CONFIG_REL)).toBe(false);
  });
});
