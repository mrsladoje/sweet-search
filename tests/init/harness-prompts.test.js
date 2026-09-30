/**
 * The shipped harness prompts are byte-identical to the benchmark arms they came from, so the
 * product and the task-completion bench cannot drift:
 *   Claude Code  CC_HARNESS_TRIM=product + CC_TRIM_BATCH=read6fs   (install-claude-lean-harness.js)
 *   Codex        CODEX_HARNESS_TRIM=conflict + CODEX_TRIM_BATCH=yt3batch2   (harness-prompts/)
 *   opencode     OC_HARNESS_TRIM=conflict3+todo3eff3k                        (harness-prompts/)
 * The bench generators are imported from eval/task-completion-bench/harness/.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CLAUDE_LEAN_AGENT_REL, claudeLeanAgentFile, installClaudeLeanHarness,
} from '../../scripts/install-claude-lean-harness.js';
import { CLAUDE_SYSTEM_OVERRIDE } from '../../scripts/install-claude-system-prompt.js';
import {
  CODEX_INSTRUCTIONS_SOURCE, HARNESS_PROMPTS_DIR, OPENCODE_GPT_ORIGINAL, OPENCODE_TOOL_EDITS,
  OPENCODE_TRIM_PLUGIN_SOURCE, applyExactEdits, codexInstructions, opencodePrompt,
} from '../../scripts/harness-prompts/index.js';
import { applyClaudeBatch } from '../../eval/task-completion-bench/harness/trim/batch-variants.mjs';
import {
  codexHarnessTrim, codexHarnessTrimArgs, CODEX_HARNESS_TRIM_STATE_FILE,
} from '../../eval/task-completion-bench/harness/codex-task-runner.mjs';
import {
  opencodeHarnessTrim, OPENCODE_TRIM_PLUGIN,
} from '../../eval/task-completion-bench/harness/opencode-task-runner.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ss-harness-prompts-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const withoutOverride = text => {
  const tail = `\n\n${CLAUDE_SYSTEM_OVERRIDE}\n`;
  expect(text.endsWith(tail)).toBe(true);
  return `${text.slice(0, -tail.length)}\n`;
};

describe('Claude Code: shipped main agent = bench product + read6fs', () => {
  it('the agent file text equals the bench read6fs body, modulo the override section', () => {
    for (const memoryEnabled of [true, false]) {
      const opts = { memoryDir: '/cfg/projects/-x/memory/', memoryEnabled };
      const bench = applyClaudeBatch(claudeLeanAgentFile({ ...opts, appendOverride: false, promptEdits: false }), 'read6fs');
      const product = claudeLeanAgentFile({ ...opts, appendOverride: true });
      expect(withoutOverride(product)).toBe(bench);
      // And the product's own benchmark form (no override) is the same bytes.
      expect(claudeLeanAgentFile({ ...opts, appendOverride: false })).toBe(bench);
    }
  });

  it('the installed file equals the bench runner install + read6fs, modulo the override', () => {
    const env = {};
    const a = join(dir, 'product');
    const b = join(dir, 'bench');
    installClaudeLeanHarness({ projectRoot: a, configDir: join(dir, 'cfg'), env });
    installClaudeLeanHarness({ projectRoot: b, appendOverride: false, promptEdits: false, configDir: join(dir, 'cfg'), env });
    const product = readFileSync(join(a, CLAUDE_LEAN_AGENT_REL), 'utf8');
    const bench = applyClaudeBatch(readFileSync(join(b, CLAUDE_LEAN_AGENT_REL), 'utf8'), 'read6fs');
    // Only the memory path differs (it names each project's own directory).
    const norm = t => t.replace(/projects\/[^/`]+\/memory\//, 'projects/<slug>/memory/');
    expect(norm(withoutOverride(product))).toBe(norm(bench));
  });
});

describe('Codex: shipped instructions = bench conflict + yt3batch2', () => {
  let saved;
  beforeEach(() => { saved = process.env.CODEX_TRIM_BATCH; process.env.CODEX_TRIM_BATCH = 'yt3batch2'; });
  afterEach(() => { if (saved === undefined) delete process.env.CODEX_TRIM_BATCH; else process.env.CODEX_TRIM_BATCH = saved; });

  it('codexInstructions() is byte-identical to the file the bench runner writes', () => {
    const trim = codexHarnessTrim({ sweet: true, mode: 'conflict', model: 'openai/gpt-5.6-luna' });
    expect(trim.batch).toBe('yt3batch2');
    expect(trim.source).toBe(CODEX_INSTRUCTIONS_SOURCE);
    const args = codexHarnessTrimArgs(trim, dir, { model: 'openai/gpt-5.6-luna' });
    expect(args.slice(0, 2)).toEqual(['-c', `model_instructions_file=${JSON.stringify(join(dir, CODEX_HARNESS_TRIM_STATE_FILE))}`]);
    expect(codexInstructions()).toBe(readFileSync(join(dir, CODEX_HARNESS_TRIM_STATE_FILE), 'utf8'));
  });

  it('the licence header is stripped and the stock search steer is gone', () => {
    const text = codexInstructions();
    expect(text.startsWith('<!--')).toBe(false);
    expect(text.startsWith('You are Codex')).toBe(true);
    expect(text).not.toContain('reach first for `rg`');
    expect(text).toContain('// @exec: {"yield_time_ms": 600000}');
  });
});

describe('opencode: shipped prompt and tool edits = bench conflict3+todo3eff3k', () => {
  it('the prompt, tool edits, disabled grep/explore and plugin are the bench arm', () => {
    const t = opencodeHarnessTrim('conflict3+todo3eff3k', { apiModel: 'openai/gpt-5.6-luna', stateDir: dir });
    expect(opencodePrompt()).toBe(t.config.agentBuild.prompt);
    expect(opencodePrompt()).toBe(t.config.agents.general.prompt);
    expect(JSON.stringify(t.config.plugin[0][1].edits)).toBe(JSON.stringify(OPENCODE_TOOL_EDITS));
    expect(t.config.tools).toEqual({ grep: false });
    expect(t.config.agents.explore).toEqual({ disable: true });
    expect(t.files[OPENCODE_TRIM_PLUGIN]).toBe(readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8'));
  });

  it('the prompt drops only the Glob/Grep steer and "especially file reads", and adds our lines', () => {
    const original = readFileSync(OPENCODE_GPT_ORIGINAL, 'utf8');
    const prompt = opencodePrompt();
    expect(prompt).not.toContain('prefer using Glob and Grep tools');
    expect(prompt).not.toContain('especially file reads');
    expect(prompt).toContain('Send todowrite as a parallel call');
    expect(prompt).toContain('- Work efficiently:');
    expect(prompt.endsWith('\n')).toBe(true);
    expect(original.length - prompt.length).toBeLessThan(0);
  });
});

describe('applyExactEdits', () => {
  it('fails loudly when a find is missing or ambiguous', () => {
    expect(() => applyExactEdits('a b', [['c', 'd']])).toThrow(/not found exactly once/);
    expect(() => applyExactEdits('a a', [['a', 'd']])).toThrow(/not found exactly once/);
    expect(applyExactEdits('a $ b', [['$', '$&$1']])).toBe('a $&$1 b');
  });

  it('ships its third-party notices', () => {
    for (const f of ['NOTICE.md', 'LICENSE-Apache-2.0.txt']) expect(existsSync(join(HARNESS_PROMPTS_DIR, f))).toBe(true);
  });
});

// Golden pins. The bench imports the same constants, so a parity test alone cannot catch an
// accidental edit to them; these hashes can. Change a pin only together with a new benchmark run
// of the changed text.
describe('golden pins of the shipped texts (sha256)', () => {
  const sha = t => createHash('sha256').update(t).digest('hex');
  it('Codex base instructions', () => {
    expect(sha(codexInstructions())).toBe('7e282d1b96ac8cd02e0572386a436915078b25c8f1b2e03a45e3f2a84f5e6e50');
  });
  it('opencode build/general prompt', () => {
    expect(sha(opencodePrompt())).toBe('94c23a556525d4e35ae42f2448439559dd61fee37557a4da93f0ff18e0fbe34e');
  });
  it('opencode tool-description edits (JSON)', () => {
    expect(sha(JSON.stringify(OPENCODE_TOOL_EDITS))).toBe('bb647d23c66f3112f4322bd454ecd1f5c7186136b04a3c7c1a51ca64f93144c9');
  });
  it("Claude Code main agent file (memoryDir '/m/', no override)", () => {
    expect(sha(claudeLeanAgentFile({ appendOverride: false, memoryDir: '/m/' })))
      .toBe('11446e95a164c2fb04892e3db505d2ccec2c7489979392938c51482b9dba48fe');
  });
});
