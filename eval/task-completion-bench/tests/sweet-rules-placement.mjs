// Tests for SWEET_RULES_PLACEMENT (research switch, default OFF = 'file', sweet arm only):
// 'system' moves the sweet rules (M±) out of the project instruction file into the harness
// system prompt, for codex, opencode and Claude Code. Guards:
//   off    — every runner surface (instruction file, codex argv + state dir, opencode config,
//            Claude Code argv) is byte-identical to the pre-switch harness; native never moves.
//   on     — the rules leave the instruction file (frame only, native's bytes) and appear exactly
//            once, byte-identical, appended to the system-prompt text; nothing else changes.
// Where the rules land in the real CLIs' requests was checked by $0 capture (codex 0.146.1,
// opencode 1.18.4, Claude Code 2.1.281, fake models that also launch subagents); these tests
// guard the runner-side inputs those captures were taken from.
//
// Standalone: `node tests/sweet-rules-placement.mjs` — exit 1 on fail.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  resolveSweetRulesPlacement, sweetRulesRowFields, appendSweetRules,
} from '../harness/sweet-rules-placement.mjs';
import {
  FRAME_OPEN, FRAME_CLOSE, codexInstructionFile, codexHarnessTrim, codexHarnessTrimArgs,
  CODEX_HARNESS_TRIM_STATE_FILE, CODEX_HARNESS_TRIM_CONFLICT_SOURCES,
} from '../harness/codex-task-runner.mjs';
import { stockInstructions, STOCK_MODELS } from '../harness/trim/build-codex-instructions.mjs';
import { buildInstructionFile, sweetRulesBlock } from '../harness/agent-runner-shared.mjs';
import {
  opencodeHarnessTrim, opencodeRulesInSystem, opencodeStockPrompt, buildMainOpencodeConfig,
} from '../harness/opencode-task-runner.mjs';
import { OPENCODE_GPT_ORIGINAL } from '../harness/trim/batch-variants.mjs';
import {
  buildClaudeCliArgs, READ_PAGES_TOOL_NOTE, appendRulesToLeanAgentFiles, CLAUDE_RULES_AGENT_FILES,
} from '../harness/claude-code-task-runner.mjs';
import { CLAUDE_SYSTEM_OVERRIDE } from '../../../scripts/install-claude-system-prompt.js';
import {
  installClaudeLeanHarness, CLAUDE_LEAN_AGENT_REL, CLAUDE_LEAN_SUBAGENT_REL, CLAUDE_LEAN_PLAN_REL,
} from '../../../scripts/install-claude-lean-harness.js';

let ok = true;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };
const throws = fn => { try { fn(); return false; } catch { return true; } };
const count = (hay, needle) => hay.split(needle).length - 1;

// The real rules, loaded exactly as run-pilot.mjs loads them.
const MPP = new URL('../../../core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md', import.meta.url);
const mppText = readFileSync(MPP, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const RULES = mppText.trimEnd();
const OFF_ENV = {};

console.log('switch (SWEET_RULES_PLACEMENT, default file):');
for (const v of [undefined, '', ' ', 'file', ' file ']) {
  assert(resolveSweetRulesPlacement({ sweet: true, env: { SWEET_RULES_PLACEMENT: v } }) === 'file', `sweet + ${JSON.stringify(v)} = file`);
}
assert(resolveSweetRulesPlacement({ sweet: true, env: { SWEET_RULES_PLACEMENT: 'system' } }) === 'system', 'sweet + system = system');
for (const v of ['system', 'bogus']) {
  assert(resolveSweetRulesPlacement({ sweet: false, env: { SWEET_RULES_PLACEMENT: v } }) === 'file', `native + ${v} = file, never throws`);
}
assert(throws(() => resolveSweetRulesPlacement({ sweet: true, env: { SWEET_RULES_PLACEMENT: 'System' } })), 'sweet + an unknown value throws');
assert(JSON.stringify(sweetRulesRowFields('file')) === '{}', 'row: nothing stamped when off');
assert(JSON.stringify(sweetRulesRowFields('system')) === '{"sweetRulesPlacement":"system"}', 'row: sweetRulesPlacement=system only when on');
for (const base of ['abc', 'abc\n', 'abc\n\n']) {
  const s = appendSweetRules(base, mppText);
  assert(s.startsWith(base) && s.endsWith(`\n\n${RULES}\n`) && count(s, RULES) === 1,
    `appendSweetRules(${JSON.stringify(base)}): base is an exact prefix, one blank line, rules once, one final newline`);
}

console.log('codex:');
{
  const legacy = sweet => `${FRAME_OPEN}${sweet ? `\n\n${mppText}` : ''}\n\n${FRAME_CLOSE}`;
  assert(codexInstructionFile({ sweet: true, mppText }) === legacy(true), 'off: sweet AGENTS.md block = the pre-switch bytes');
  assert(codexInstructionFile({ sweet: false, mppText }) === legacy(false), 'off: native AGENTS.md block = the pre-switch bytes');
  assert(codexInstructionFile({ sweet: false, mppText, rulesPlacement: 'system' }) === legacy(false), 'native ignores the placement');
  const onFile = codexInstructionFile({ sweet: true, mppText, rulesPlacement: 'system' });
  assert(onFile === legacy(false) && !onFile.includes(RULES), 'on: sweet AGENTS.md = frame only = native bytes');

  const state = mkdtempSync(join(tmpdir(), 'rules-placement-codex-'));
  const off = codexHarnessTrim({ sweet: true, mode: '0', model: 'openai/gpt-5.6-luna' });
  assert(codexHarnessTrimArgs(off, state).length === 0 && readdirSync(state).length === 0,
    'off + trim off: no argv, no state file (byte-identical)');
  assert(codexHarnessTrimArgs(off, state, { rules: null, model: 'openai/gpt-5.6-luna' }).length === 0 && readdirSync(state).length === 0,
    'off + trim off with explicit rules:null: still nothing');
  const file = join(state, CODEX_HARNESS_TRIM_STATE_FILE);
  for (const model of ['openai/gpt-5.6-luna', 'openai/gpt-5.5', 'gpt-5.5']) {
    const args = codexHarnessTrimArgs(off, state, { rules: mppText, model });
    const text = readFileSync(file, 'utf8');
    const stock = stockInstructions(model.replace(/^openai\//, ''));
    assert(args.length === 2 && args[0] === '-c' && args[1] === `model_instructions_file=${JSON.stringify(file)}`,
      `on + trim off (${model}): exactly one -c model_instructions_file, no tool/context keys`);
    assert(text.startsWith(stock) && text.slice(stock.length).trim() === RULES && count(text, RULES) === 1,
      `on + trim off (${model}): file = the model's UNMODIFIED captured base prompt + the rules, once`);
  }
  assert(throws(() => codexHarnessTrimArgs(off, state, { rules: mppText, model: 'openai/gpt-5.6-sol' })),
    'on + trim off refuses a model without a captured base prompt');
  assert(JSON.stringify(STOCK_MODELS) === '["gpt-5.5","gpt-5.6-luna"]', 'stock prompts exist for gpt-5.5 and gpt-5.6-luna');

  const conflict = codexHarnessTrim({ sweet: true, mode: 'conflict', model: 'openai/gpt-5.6-luna' });
  const argsOff = codexHarnessTrimArgs(conflict, state);
  const trimText = readFileSync(file, 'utf8');
  const argsOn = codexHarnessTrimArgs(conflict, state, { rules: mppText, model: 'openai/gpt-5.6-luna' });
  const trimTextOn = readFileSync(file, 'utf8');
  assert(JSON.stringify(argsOff) === JSON.stringify(argsOn), 'on + trim conflict: argv unchanged (same file path, same keys)');
  assert(trimText === readFileSync(CODEX_HARNESS_TRIM_CONFLICT_SOURCES['gpt-5.6-luna'], 'utf8').replace(/^<!--[\s\S]*?-->\n/, ''),
    'off + trim conflict: the instructions file is the trim text alone');
  assert(trimTextOn.startsWith(trimText) && trimTextOn.slice(trimText.length).trim() === RULES,
    'on + trim conflict: the file = the trim text + the rules');
  process.env.CODEX_TRIM_BATCH = 'two';
  try {
    const v3 = codexHarnessTrim({ sweet: true, mode: 'v3', model: 'openai/gpt-5.6-luna' });
    codexHarnessTrimArgs(v3, state);
    const v3Text = readFileSync(file, 'utf8');
    codexHarnessTrimArgs(v3, state, { rules: mppText, model: 'openai/gpt-5.6-luna' });
    const v3On = readFileSync(file, 'utf8');
    assert(v3On.startsWith(v3Text) && v3On.slice(v3Text.length).trim() === RULES, 'on + trim v3 + batch: rules after the batch-edited text');
  } finally { delete process.env.CODEX_TRIM_BATCH; }
  rmSync(state, { recursive: true, force: true });
}

console.log('opencode:');
{
  const legacy = sweet => `${FRAME_OPEN}${sweet ? `\n\n${mppText}` : ''}\n\n${FRAME_CLOSE}`;
  assert(buildInstructionFile({ sweet: true, mppText, env: OFF_ENV }) === legacy(true), 'off: sweet AGENTS.md = the pre-switch bytes');
  assert(buildInstructionFile({ sweet: false, mppText, env: OFF_ENV }) === legacy(false), 'off: native AGENTS.md = the pre-switch bytes');
  const onFile = buildInstructionFile({ sweet: true, mppText, env: OFF_ENV, rulesPlacement: 'system' });
  assert(onFile === legacy(false), 'on: sweet AGENTS.md = frame only = native bytes');
  assert(sweetRulesBlock({ mppText, env: OFF_ENV }) === mppText, 'the rules block = the rules text (no packing treatment)');
  const batchEnv = { SS_PACKING_TREATMENT: 'ss-batch' };
  const withPacking = buildInstructionFile({ sweet: true, mppText, env: batchEnv });
  assert(withPacking === `${FRAME_OPEN}\n\n${sweetRulesBlock({ mppText, env: batchEnv })}\n\n${FRAME_CLOSE}`,
    'with a packing treatment the block that moves is exactly the sweet block of the file');
  assert(buildInstructionFile({ sweet: true, mppText, env: batchEnv, rulesPlacement: 'system' }) === legacy(false),
    'on + packing treatment: the file is still the frame only');

  const stateDir = mkdtempSync(join(tmpdir(), 'rules-placement-oc-'));
  const luna = 'openai/gpt-5.6-luna';
  const off = opencodeHarnessTrim('0', { apiModel: luna, stateDir });
  assert(opencodeRulesInSystem(off, { rules: null, apiModel: luna }) === off, 'off: the trim object is returned untouched');
  assert(JSON.stringify(buildMainOpencodeConfig({ env: {}, trim: opencodeRulesInSystem(off, { rules: null, apiModel: luna }) }))
    === JSON.stringify(buildMainOpencodeConfig({ env: {}, trim: off })), 'off: config byte-identical');
  assert(opencodeStockPrompt('gpt') === readFileSync(OPENCODE_GPT_ORIGINAL, 'utf8'), 'stock gpt prompt = the committed original file');
  for (const name of ['default', 'claude', 'muse', 'explore']) assert(opencodeStockPrompt(name).length > 500, `stock ${name} prompt extracted from its capture (sha-pinned)`);
  assert(throws(() => opencodeStockPrompt('gemini')), 'no stock prompt for an uncaptured family');

  const on = opencodeRulesInSystem(off, { rules: mppText, apiModel: luna });
  const cfg = buildMainOpencodeConfig({ env: {}, trim: on });
  const stock = opencodeStockPrompt('gpt');
  for (const agent of ['build', 'general']) {
    const p = cfg.agent[agent].prompt;
    assert(p.startsWith(stock) && p.slice(stock.length).trim() === RULES, `on + trim off: agent.${agent}.prompt = stock gpt prompt + rules`);
  }
  const ex = cfg.agent.explore.prompt;
  assert(ex.startsWith(opencodeStockPrompt('explore')) && ex.slice(opencodeStockPrompt('explore').length).trim() === RULES,
    'on + trim off: agent.explore.prompt = stock explore prompt + rules');
  const cfgOff = buildMainOpencodeConfig({ env: {}, trim: off });
  const strip = c => JSON.stringify({ ...c, agent: undefined });
  assert(strip(cfg) === strip(cfgOff) && JSON.stringify(cfg.plugin) === '[]' && !cfg.tools,
    'on + trim off: plugin, provider, permission, tools unchanged (only agent prompts added)');
  assert(on.mode === null && JSON.stringify(on.plugins) === '[]', 'on + trim off: trim mode stays null (row harnessTrim unchanged)');

  for (const mode of ['conflict-noglob', 'conflict', 'v3']) {
    const t = opencodeHarnessTrim(mode, { apiModel: luna, stateDir });
    const tOn = opencodeRulesInSystem(t, { rules: mppText, apiModel: luna });
    const a = buildMainOpencodeConfig({ env: {}, trim: t }), b = buildMainOpencodeConfig({ env: {}, trim: tOn });
    assert(b.agent.build.prompt === appendSweetRules(a.agent.build.prompt, mppText)
      && b.agent.general.prompt === appendSweetRules(a.agent.general.prompt, mppText),
      `on + trim ${mode}: build and general prompts = trim prompt + rules`);
    assert(JSON.stringify(b.agent.explore) === JSON.stringify(a.agent.explore) && a.agent.explore.disable === true,
      `on + trim ${mode}: explore stays disabled`);
    assert(JSON.stringify({ ...b, agent: 0 }) === JSON.stringify({ ...a, agent: 0 }) && tOn.mode === t.mode,
      `on + trim ${mode}: plugin, tools and mode unchanged`);
  }
  const t1 = opencodeHarnessTrim('1', { apiModel: luna, stateDir });
  const c1 = buildMainOpencodeConfig({ env: {}, trim: opencodeRulesInSystem(t1, { rules: mppText, apiModel: luna }) });
  assert(c1.agent.general.prompt === appendSweetRules(stock, mppText) && c1.agent.explore.prompt === appendSweetRules(opencodeStockPrompt('explore'), mppText),
    'on + trim 1 (general/explore not set by the trim): they get their stock prompt + rules');
  const grok = opencodeRulesInSystem(opencodeHarnessTrim('0', { apiModel: 'x-ai/grok-4.5', stateDir }), { rules: mppText, apiModel: 'x-ai/grok-4.5' });
  assert(grok.config.agentBuild.prompt === appendSweetRules(opencodeStockPrompt('default'), mppText), 'on + trim off, grok: default-family stock prompt + rules');
  assert(throws(() => opencodeRulesInSystem(off, { rules: mppText, apiModel: 'google/gemini-3-pro' })), 'on refuses a family without a captured prompt');
  rmSync(stateDir, { recursive: true, force: true });
}

console.log('claude code:');
{
  const base = { prompt: 'P', rundir: '/r', claudeModelId: 'm' };
  const legacyArgs = sweet => ['-p', 'P', '--add-dir', '/r',
    '--append-system-prompt', sweet ? `${READ_PAGES_TOOL_NOTE}\n\n${CLAUDE_SYSTEM_OVERRIDE}` : READ_PAGES_TOOL_NOTE,
    '--append-subagent-system-prompt', READ_PAGES_TOOL_NOTE,
    '--model', 'm', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose'];
  for (const sweet of [true, false]) {
    assert(JSON.stringify(buildClaudeCliArgs({ ...base, sweet })) === JSON.stringify(legacyArgs(sweet)), `off: ${sweet ? 'sweet' : 'native'} argv = the pre-switch argv`);
  }
  assert(JSON.stringify(buildClaudeCliArgs({ ...base, sweet: false, systemRules: RULES })) === JSON.stringify(legacyArgs(false)),
    'native ignores systemRules');
  const on = buildClaudeCliArgs({ ...base, sweet: true, systemRules: RULES });
  const main = on[on.indexOf('--append-system-prompt') + 1], sub = on[on.indexOf('--append-subagent-system-prompt') + 1];
  assert(main === `${READ_PAGES_TOOL_NOTE}\n\n${CLAUDE_SYSTEM_OVERRIDE}\n\n${RULES}`, 'on (stock): main append = pages note + override + rules');
  assert(sub === `${READ_PAGES_TOOL_NOTE}\n\n${RULES}`, 'on (stock): subagent append = pages note + rules');
  const drop = a => a.filter((_, i) => i !== a.indexOf('--append-system-prompt') + 1 && i !== a.indexOf('--append-subagent-system-prompt') + 1);
  assert(JSON.stringify(drop(on)) === JSON.stringify(drop(legacyArgs(true))), 'on (stock): every other argv entry unchanged');

  const dir = mkdtempSync(join(tmpdir(), 'rules-placement-cc-'));
  const home = join(dir, 'claude-home');
  mkdirSync(home);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const lean = installClaudeLeanHarness({ projectRoot: dir, appendOverride: false, env: {}, configDir: home, visibleConfigDir: home });
  assert(lean.active === true, 'product: lean harness installs into a throwaway project');
  assert(JSON.stringify(CLAUDE_RULES_AGENT_FILES) === JSON.stringify([CLAUDE_LEAN_AGENT_REL, CLAUDE_LEAN_SUBAGENT_REL, CLAUDE_LEAN_PLAN_REL]),
    'product: the rules go to the main, general-purpose and Plan agent files');
  const before = Object.fromEntries(CLAUDE_RULES_AGENT_FILES.map(rel => [rel, readFileSync(join(dir, rel), 'utf8')]));
  appendRulesToLeanAgentFiles(dir, RULES);
  for (const rel of CLAUDE_RULES_AGENT_FILES) {
    const after = readFileSync(join(dir, rel), 'utf8');
    assert(after.startsWith(before[rel]) && after.slice(before[rel].length).trim() === RULES && count(after, RULES) === 1,
      `product: ${rel} = installed file (frontmatter + body) + rules, once`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// Source-level guard: each runner resolves the switch, stamps the row and only moves the rules
// when it is on. The spawn paths themselves are proven by the $0 captures.
console.log('runner wiring:');
for (const [file, needles] of Object.entries({
  'codex-task-runner.mjs': ['resolveSweetRulesPlacement({ sweet })', "rules: rulesPlacement === 'system' ? mppText : null", '...sweetRulesRowFields(rulesPlacement)',
    "(harnessTrim.mode || rulesPlacement === 'system') ? [CODEX_HARNESS_TRIM_STATE_FILE]"],
  'opencode-task-runner.mjs': ['resolveSweetRulesPlacement({ sweet })', "writeInstructionFile(rundir, 'AGENTS.md', { sweet, mppText, rulesPlacement })",
    'opencodeRulesInSystem(harnessTrim', '...sweetRulesRowFields(rulesPlacement)'],
  'claude-code-task-runner.mjs': ['resolveSweetRulesPlacement({ sweet })', 'if (sweet && !systemRules) {', 'appendRulesToLeanAgentFiles(rundir, systemRules)',
    'systemRules: harnessTrim.installLean ? null : systemRules', '...sweetRulesRowFields(rulesPlacement)'],
})) {
  const src = readFileSync(new URL(`../harness/${file}`, import.meta.url), 'utf8');
  for (const n of needles) assert(src.includes(n), `${file}: ${n}`);
}

console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
