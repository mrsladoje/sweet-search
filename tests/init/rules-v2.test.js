/**
 * Rules v2 (scripts/harness-prompts/rules-v2.js): SS_FIX_RULES_V2 reaches every builder the product
 * and the benchmarks use; each v2 text differs from v1 only by the intended lines; =0 is the pre-v2
 * text byte for byte (the golden v1 hashes live in harness-prompts.test.js and below).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CLAUDE_LEAN_AGENT_REL, claudeLeanAgentFile, installClaudeLeanHarness,
} from '../../scripts/install-claude-lean-harness.js';
import {
  CLAUDE_SYSTEM_OVERRIDE, CLAUDE_SYSTEM_OVERRIDE_V2, claudeSystemOverride,
} from '../../scripts/install-claude-system-prompt.js';
import { getPolicyBody } from '../../scripts/inject-agent-instructions.js';
import {
  CLAUDE_RULES_POINTER, CLAUDE_RULES_POINTER_V1, claudeRulesPointer, writeClaudeRules,
} from '../../scripts/write-claude-rules.js';
import {
  HARNESS_PROMPTS_DIR, OPENCODE_TOOL_EDITS, OPENCODE_TOOL_EDITS_V1, codexInstructions, opencodePrompt, opencodeToolEdits,
} from '../../scripts/harness-prompts/index.js';
import {
  CLAUDE_FIND_LINE, CLAUDE_OVERRIDE_V2_SENTENCE, OPENCODE_GLOB_BULLET,
  RULES_V2_FILE_NAMES_LINE, RULES_V2_GREP_FLAGS_LINE, rulesV2Enabled,
} from '../../scripts/harness-prompts/rules-v2.js';
import { opencodePluginEntry } from '../../scripts/install-opencode-harness.js';
import { buildClaudeCliArgs } from '../../eval/task-completion-bench/harness/claude-code-task-runner.mjs';
import {
  codexHarnessTrim, codexHarnessTrimArgs, CODEX_HARNESS_TRIM_STATE_FILE,
} from '../../eval/task-completion-bench/harness/codex-task-runner.mjs';
import { opencodeArmHarnessTrim } from '../../eval/task-completion-bench/harness/opencode-task-runner.mjs';
import { sweetRulesRowFields } from '../../eval/task-completion-bench/harness/sweet-rules-placement.mjs';

const V1 = { SS_FIX_RULES_V2: '0' };
const sha = t => createHash('sha256').update(t).digest('hex');
const lineDiff = (a, b) => {
  const A = a.split('\n'), B = b.split('\n');
  return { removed: A.filter(l => !B.includes(l)), added: B.filter(l => !A.includes(l)) };
};

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ss-rules-v2-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('switch', () => {
  it('only "0" turns it off', () => {
    expect(rulesV2Enabled({})).toBe(true);
    expect(rulesV2Enabled({ SS_FIX_RULES_V2: '1' })).toBe(true);
    expect(rulesV2Enabled({ SS_FIX_RULES_V2: ' 0 ' })).toBe(false);
  });
});

describe('policy (all harnesses)', () => {
  it('golden: v2 body and the pre-v2 body', () => {
    expect(sha(getPolicyBody('cli', {}))).toBe('1a336e4d8b29fa40aacb8e99280a99fc7c5847f7cc79dba4392be9b8306e1258');
    expect(sha(getPolicyBody('cli', V1))).toBe('77230e7ae4272b8bf8507b5642d497ed2559f8f5c91e63f3a7e5584f26305e72');
  });

  it('v2 = v1 + the flag line + the file-name line, find/ls unbanned, the full-line statement', () => {
    const v1 = getPolicyBody('cli', V1), v2 = getPolicyBody('cli', {});
    const d = lineDiff(v1, v2);
    expect(d.added).toContain(RULES_V2_GREP_FLAGS_LINE);
    expect(d.added).toContain(RULES_V2_FILE_NAMES_LINE);
    expect(d.removed).toHaveLength(3);
    expect(d.added).toHaveLength(5);
    expect(v2).not.toContain('file:line only');
    expect(v2).toContain('`ss-grep` prints the path of each file once, then its hits as `line:<full line>`');
    expect(v2).not.toMatch(/`find`\/`ls`|`grep`\/`find`/);
    expect(v2).toContain('Reach for raw `grep`/`cat` or the native reader');
    expect(v2).toContain('read what you find with `ss-read`, not `cat`. The `ss-*` tools search file contents.');
    // breadth first: the flag line leads with the exclude glob and says to start broad
    expect(RULES_V2_GREP_FLAGS_LINE).toMatch(/^- `ss-grep` flags when needed: `-g '!<glob>'` excludes paths/);
    expect(RULES_V2_GREP_FLAGS_LINE).toContain('Start broad; scope only after a broad grep shows where.');
    expect(v2).toContain('`ls <dir>` (one directory; never `ls -R` or an unfiltered `find .`/`rg --files`)');
    expect(v1).toContain('`ss-grep` is file:line only');
  });

  it('the MCP policy is not touched by the switch', () => {
    expect(getPolicyBody('mcp', V1)).toBe(getPolicyBody('mcp', {}));
  });

  it('every flag on the rules line is an ss-grep flag today (GREP_USAGE)', () => {
    const helpers = readFileSync(join(HARNESS_PROMPTS_DIR, '../../eval/agent-read-workflows/bin/_ss-helpers.mjs'), 'utf8');
    const usage = helpers.slice(helpers.indexOf('const GREP_USAGE'), helpers.indexOf('async function cmdGrep'));
    for (const f of ['-i', '-w', '--in <path>', '-g', "-g '!", '-A N', '-B N', '-C N']) expect(usage).toContain(f);
  });
});

describe('Codex', () => {
  // The v2 draft's `rg --files -g` harness line made Sol hunt for AGENTS.md (micro-smoke 2026-10-02);
  // the default keeps the pre-v2 Codex prompt, so only the rules change for Codex.
  it('the harness prompt is the pre-v2 text, whatever the switch', () => {
    expect(sha(codexInstructions())).toBe('7e282d1b96ac8cd02e0572386a436915078b25c8f1b2e03a45e3f2a84f5e6e50');
    expect(codexInstructions()).not.toContain('rg --files');
  });
});

describe('opencode', () => {
  it('prompt: v2 adds only the Glob half of the removed bullet', () => {
    expect(lineDiff(opencodePrompt(V1), opencodePrompt({}))).toEqual({ removed: [], added: [OPENCODE_GLOB_BULLET.trimEnd()] });
    expect(opencodePrompt({})).not.toContain('Glob and Grep');
  });

  it('tool edits: v2 drops `find` from the bash avoid-list and "(NOT find or ls)"; nothing else changes', () => {
    expect(opencodeToolEdits(V1)).toBe(OPENCODE_TOOL_EDITS_V1);
    expect(opencodeToolEdits({})).toBe(OPENCODE_TOOL_EDITS);
    for (const k of ['read', 'task', 'glob']) expect(OPENCODE_TOOL_EDITS[k]).toBe(OPENCODE_TOOL_EDITS_V1[k]);
    const v2 = OPENCODE_TOOL_EDITS.bash.map(([, to]) => to).join('\n');
    expect(v2).not.toContain('`find`');
    expect(v2).not.toContain('NOT find or ls');
    expect(v2).toContain('    - File search: Use Glob\n');
    // the v2 bash edits leave the same stock text untouched apart from these two spots
    const stock = '  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:\n    - File search: Use Glob (NOT find or ls)\n    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n    - Edit files: Use Edit (NOT sed/awk)\n';
    const apply = edits => edits.reduce((t, [from, to]) => (t.includes(from) ? t.replace(from, to) : t), stock);
    expect(apply(OPENCODE_TOOL_EDITS.bash)).toBe('  - Avoid using Bash with the `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:\n    - File search: Use Glob\n    - Edit files: Use Edit (NOT sed/awk)\n');
    expect(apply(OPENCODE_TOOL_EDITS_V1.bash)).toContain('Avoid using Bash with the `find`, `sed`');
  });

  it('init plugin entry follows the switch', () => {
    expect(opencodePluginEntry({})[1].edits).toBe(OPENCODE_TOOL_EDITS);
    expect(opencodePluginEntry(V1)[1].edits).toBe(OPENCODE_TOOL_EDITS_V1);
  });
});

describe('Claude Code', () => {
  it('agent file: v2 adds the `find` line and the override exemption; =0 is the pre-v2 file', () => {
    const v1 = claudeLeanAgentFile({ memoryDir: '/m/', rulesV2: false });
    const v2 = claudeLeanAgentFile({ memoryDir: '/m/' });
    expect(lineDiff(v1, v2)).toEqual({ removed: [CLAUDE_SYSTEM_OVERRIDE], added: [CLAUDE_FIND_LINE, CLAUDE_SYSTEM_OVERRIDE_V2] });
    expect(CLAUDE_SYSTEM_OVERRIDE_V2).toBe(`${CLAUDE_SYSTEM_OVERRIDE} ${CLAUDE_OVERRIDE_V2_SENTENCE}`);
    expect(sha(claudeLeanAgentFile({ memoryDir: '/m/', rules: getPolicyBody('cli', V1), rulesV2: false })))
      .toBe('f09e7ef96b13ab23e72a265a50eeb2601352ee5432e6d30b9ede3fe35a9e96d7');
  });

  it('the override exempts file-name search under v2 only', () => {
    expect(claudeSystemOverride({})).toContain('Finding files by name');
    expect(claudeSystemOverride(V1)).toBe(CLAUDE_SYSTEM_OVERRIDE);
  });

  it('pointer: v2 drops only `find`', () => {
    expect(claudeRulesPointer({})).toBe(CLAUDE_RULES_POINTER);
    expect(claudeRulesPointer(V1)).toBe(CLAUDE_RULES_POINTER_V1);
    expect(sha(CLAUDE_RULES_POINTER_V1)).toBe('2523ba9ac086973443f4122c5a459124487c8be1d42fc7578c8aea413fe11d4c');
    expect(CLAUDE_RULES_POINTER_V1.replace('`grep`/`find`/`cat`', '`grep`/`cat`')).toBe(CLAUDE_RULES_POINTER);
  });

  it('installClaudeLeanHarness and writeClaudeRules follow `env`', () => {
    const inst = (name, env) => {
      const d = join(dir, name);
      installClaudeLeanHarness({ projectRoot: d, configDir: join(dir, 'cfg'), env });
      writeClaudeRules({ projectRoot: d, layout: 'pointer', env });
      return { agent: readFileSync(join(d, CLAUDE_LEAN_AGENT_REL), 'utf8'), rules: readFileSync(join(d, '.claude/rules/sweet-search.md'), 'utf8') };
    };
    const on = inst('on', {}), off = inst('off', V1);
    const norm = t => t.replace(/`[^`]*\/projects\/[^/`]+\/memory\/`/, '`<memory>/`');
    expect(norm(off.agent)).toBe(norm(claudeLeanAgentFile({ memoryDir: '/m/projects/x/memory/', rules: getPolicyBody('cli', V1), rulesV2: false })));
    expect(norm(on.agent)).toBe(norm(claudeLeanAgentFile({ memoryDir: '/m/projects/x/memory/', rules: getPolicyBody('cli', {}) })));
    expect(on.rules.trimEnd().endsWith(CLAUDE_RULES_POINTER)).toBe(true);
    expect(off.rules.trimEnd().endsWith(CLAUDE_RULES_POINTER_V1)).toBe(true);
  });

  it('a non-CLI (MCP) policy gets no v2 additions in the agent file', () => {
    const d = join(dir, 'mcp');
    installClaudeLeanHarness({ projectRoot: d, configDir: join(dir, 'cfg'), env: {}, variant: 'mcp' });
    const agent = readFileSync(join(d, CLAUDE_LEAN_AGENT_REL), 'utf8');
    expect(agent).toContain(getPolicyBody('mcp'));
    expect(agent).not.toContain(CLAUDE_FIND_LINE);
    expect(agent).not.toContain(CLAUDE_OVERRIDE_V2_SENTENCE);
  });

  it('task bench: the appended override follows the switch', () => {
    const arg = env => {
      const a = buildClaudeCliArgs({ rundir: '/r', sweet: true, claudeModelId: 'm', env });
      return a[a.indexOf('--append-system-prompt') + 1];
    };
    expect(arg({})).toContain(CLAUDE_SYSTEM_OVERRIDE_V2);
    expect(arg(V1)).toContain(CLAUDE_SYSTEM_OVERRIDE);
    expect(arg(V1)).not.toContain(CLAUDE_OVERRIDE_V2_SENTENCE);
  });
});

describe('benchmarks', () => {
  it('Codex and opencode arms follow their own env, byte-equal to the shipped texts', () => {
    for (const env of [{}, V1]) {
      const sub = join(dir, env.SS_FIX_RULES_V2 ? 'v1' : 'v2');
      mkdirSync(sub, { recursive: true });
      const trim = codexHarnessTrim({ sweet: true, model: 'openai/gpt-6.1-sol', env });
      codexHarnessTrimArgs(trim, sub, { model: 'openai/gpt-6.1-sol' });
      expect(readFileSync(join(sub, CODEX_HARNESS_TRIM_STATE_FILE), 'utf8')).toBe(codexInstructions());
      const oc = opencodeArmHarnessTrim({ sweet: true, env, apiModel: 'openai/gpt-6.1-sol', stateDir: sub });
      expect(oc.config.agentBuild.prompt).toBe(opencodePrompt(env));
      expect(oc.config.agents.general.prompt).toBe(opencodePrompt(env));
      expect(JSON.stringify(oc.config.plugin[0][1].edits)).toBe(JSON.stringify(opencodeToolEdits(env)));
    }
  });

  it('task-bench rows record the switch on sweet rows', () => {
    expect(sweetRulesRowFields('file', { sweet: true, env: {} }).rulesV2).toBe(1);
    expect(sweetRulesRowFields('file', { sweet: true, env: V1 }).rulesV2).toBe(0);
    expect(sweetRulesRowFields('file', { sweet: false, env: V1 })).toEqual({});
  });
});
