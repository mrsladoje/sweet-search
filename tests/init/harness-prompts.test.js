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
import { CLAUDE_SYSTEM_OVERRIDE_V2 } from '../../scripts/install-claude-system-prompt.js';
import { getPolicyBody } from '../../scripts/inject-agent-instructions.js';
import { CLAUDE_RULES_POINTER, CLAUDE_RULES_POINTER_V1, claudeRulesPointer } from '../../scripts/write-claude-rules.js';
import {
  CODEX_INSTRUCTIONS_SOURCE, HARNESS_PROMPTS_DIR, OPENCODE_GPT_ORIGINAL, OPENCODE_TOOL_EDITS, OPENCODE_TOOL_EDITS_V1,
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
  const tail = `\n\n${CLAUDE_SYSTEM_OVERRIDE_V2}\n`;   // rules v2 default (rules-v2.test.js covers =0)
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

// V1b: the shipped main agent carries the rules. It must be the benchmarked
// SS_VARIANT_CC_RULES_IN_PROMPT=2 file, and the switch value '2' must equal the default.
describe('Claude Code: V1b agent file = the benchmarked SS_VARIANT_CC_RULES_IN_PROMPT=2 arm', () => {
  const POLICY = getPolicyBody('cli');
  const norm = t => t.replace(/projects\/[^/`]+\/memory\//, 'projects/<slug>/memory/');
  const install = (name, opts) => {
    const d = join(dir, name);
    installClaudeLeanHarness({ projectRoot: d, configDir: join(dir, 'cfg'), ...opts });
    return readFileSync(join(d, CLAUDE_LEAN_AGENT_REL), 'utf8');
  };

  it('product default = bench runner install (explicit rules = its mppText) + read6fs, modulo the override', () => {
    const product = install('product', { env: {} });
    const runner = applyClaudeBatch(install('runner', {
      appendOverride: false, promptEdits: false, env: {}, rules: `${POLICY}\n`,
    }), 'read6fs');
    expect(norm(withoutOverride(product))).toBe(norm(runner));
    expect(product.split(POLICY)).toHaveLength(2);
  });

  it("the switch value '2' installs the default bytes; '0' installs the 2.8.2 bytes", () => {
    const unset = install('unset', { env: {} });
    const two = install('two', { env: { SS_VARIANT_CC_RULES_IN_PROMPT: '2' } });
    const zero = install('zero', { env: { SS_VARIANT_CC_RULES_IN_PROMPT: '0' } });
    const plain = install('plain', { env: {}, rules: false });
    expect(norm(two)).toBe(norm(unset));
    expect(norm(zero)).toBe(norm(plain));
    expect(zero).not.toContain(POLICY);
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
// of the changed text. The v1 pins (SS_FIX_RULES_V2=0) are the pre-rules-v2 shipped texts and
// must never change: they prove the A/B baseline arm is the old text byte for byte.
describe('golden pins of the shipped texts (sha256)', () => {
  const sha = t => createHash('sha256').update(t).digest('hex');
  const V1 = { SS_FIX_RULES_V2: '0' };
  it('Codex base instructions (not touched by the rules switch)', () => {
    expect(sha(codexInstructions())).toBe('7e282d1b96ac8cd02e0572386a436915078b25c8f1b2e03a45e3f2a84f5e6e50');
  });
  it('opencode build/general prompt (v2 default; v1 = pre-v2 bytes)', () => {
    expect(sha(opencodePrompt())).toBe('39bcc13bae718d53b8a21ccfcf965747f3367a6de71edd16aabfa513438fe2ce');
    expect(sha(opencodePrompt(V1))).toBe('94c23a556525d4e35ae42f2448439559dd61fee37557a4da93f0ff18e0fbe34e');
  });
  it('opencode tool-description edits (JSON) (v2 default; v1 = pre-v2 bytes)', () => {
    expect(sha(JSON.stringify(OPENCODE_TOOL_EDITS))).toBe('4800b77becd4af6b0b2c51a75cb83b935d5c407a14c6754d2695f7882a281011');
    expect(sha(JSON.stringify(OPENCODE_TOOL_EDITS_V1))).toBe('bb647d23c66f3112f4322bd454ecd1f5c7186136b04a3c7c1a51ca64f93144c9');
  });
  it('CLI policy body (v2 default; v1 = pre-v2 bytes)', () => {
    expect(sha(getPolicyBody('cli'))).toBe('01ea3cc63516fe77246f34e81c57081131658d873362806d76f79b9654e3531a');
    expect(sha(getPolicyBody('cli', {}))).toBe(sha(getPolicyBody('cli')));
    expect(sha(getPolicyBody('cli', V1))).toBe('77230e7ae4272b8bf8507b5642d497ed2559f8f5c91e63f3a7e5584f26305e72');
  });
  it("Claude Code main agent file (memoryDir '/m/', no override)", () => {
    expect(sha(claudeLeanAgentFile({ appendOverride: false, memoryDir: '/m/' })))
      .toBe('1098a6ada32026e87d4ebd9dd42aaa936f9f61202bafc35f97551bdd8208331d');
    expect(sha(claudeLeanAgentFile({ appendOverride: false, memoryDir: '/m/', rulesV2: false })))
      .toBe('11446e95a164c2fb04892e3db505d2ccec2c7489979392938c51482b9dba48fe');
  });
  // V1b pins (v1): computed from the benchmarked reference implementation (branch final-tuning,
  // claudeLeanAgentFile({ rulesInPrompt: true }) and its CLAUDE_RULES_POINTER).
  it("Claude Code V1b main agent file (memoryDir '/m/', no override)", () => {
    expect(sha(claudeLeanAgentFile({ appendOverride: false, memoryDir: '/m/', rules: getPolicyBody('cli') })))
      .toBe('30c48b2c4d380ce6a829885769eb9a71d1f6a7c3a0d52c2409a67609d5aacbde');
    expect(sha(claudeLeanAgentFile({ appendOverride: false, memoryDir: '/m/', rules: getPolicyBody('cli', V1), rulesV2: false })))
      .toBe('5d238cab2d26025019bcad16cb09ef2f4cfe88468f464d280e366904bca1ae61');
  });
  it("Claude Code V1b main agent file as shipped (memoryDir '/m/', with the override)", () => {
    expect(sha(claudeLeanAgentFile({ memoryDir: '/m/', rules: getPolicyBody('cli') })))
      .toBe('1c32a955c1995bbce4776eec1ef5eeb70c11c6f2197cd1f943617d6672385eea');
    expect(sha(claudeLeanAgentFile({ memoryDir: '/m/', rules: getPolicyBody('cli', V1), rulesV2: false })))
      .toBe('f09e7ef96b13ab23e72a265a50eeb2601352ee5432e6d30b9ede3fe35a9e96d7');
  });
  it('Claude Code V1b pointer rule text', () => {
    expect(sha(CLAUDE_RULES_POINTER)).toBe('1dc6488c388109a496f3bb634a1f28647fc19bf64db6a9c3ccbc74b8f893f329');
    expect(claudeRulesPointer({})).toBe(CLAUDE_RULES_POINTER);
    expect(sha(claudeRulesPointer(V1))).toBe('2523ba9ac086973443f4122c5a459124487c8be1d42fc7578c8aea413fe11d4c');
    expect(CLAUDE_RULES_POINTER_V1).toBe(claudeRulesPointer(V1));
  });
});
