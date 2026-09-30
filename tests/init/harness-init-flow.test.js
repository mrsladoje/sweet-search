/**
 * `sweet-search init` / `uninstall` end to end for the three harnesses (real CLI, temp project,
 * temp HOME): default = Claude Code, --codex = Codex, --opencode = opencode. Rules go per project
 * and never into AGENTS.md / CLAUDE.md; an old AGENTS.md block is migrated away; uninstall leaves
 * no sweet-search file, key or rule behind.
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
function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: proj, encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex'), XDG_CONFIG_HOME: join(home, '.config') },
  });
  expect(r.status, `${args.join(' ')} failed: ${r.stderr}`).toBe(0);
  return r;
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

  it('--codex writes the .codex layer and no AGENTS.md', () => {
    const r = init('--codex');
    expect(read(CODEX_INSTRUCTIONS_REL)).toBe(codexInstructions());
    const cfg = read(CODEX_CONFIG_REL);
    expect(cfg).toContain('model_instructions_file = "sweet-search-instructions.md"');
    expect(cfg).toContain(CANONICAL_POLICY_BODY.split('\n')[0]);
    expect(cfg).toMatch(/^hooks = true$/m);
    expect(exists('AGENTS.md')).toBe(false);
    expect(exists('CLAUDE.md')).toBe(false);
    expect(r.stderr).toContain('trust');
    // The global Codex config is never written.
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);
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
      writeFileSync(join(proj, 'AGENTS.md'), `${OLD_BLOCK}\n# My notes\nkeep me\n`);
      init(flag);
      const text = read('AGENTS.md');
      expect(text).not.toContain(MARKER_BEGIN);
      expect(text).toContain('keep me');
    });

    it(`${flag}: deletes an AGENTS.md that held only the block`, () => {
      writeFileSync(join(proj, 'AGENTS.md'), OLD_BLOCK);
      init(flag);
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
