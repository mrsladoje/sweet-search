// Tests for the opencode harness trim (OC_HARNESS_TRIM, default OFF) — 2026-09-25.
//
// The switch removes the parts of opencode 1.18.4's OWN request that contradict the ss-*
// rules or that a headless task never uses: the model-family prompt is replaced by an
// edited copy (harness/trim/), glob/grep/skill are disabled, and a local plugin deletes
// the contradicting passages from the bash and read tool DESCRIPTIONS. It must be inert
// when off (held-out legs stay byte-identical) and never touch the native arm.
// The request-level proof is the $0 capture in handoffs/improve/harness-prompt-trim/.
//
// Standalone: `node tests/opencode-harness-trim.mjs` — exit 1 on fail.
import {
  buildMainOpencodeConfig, opencodeHarnessTrim, opencodeArmHarnessTrim, opencodePromptFamily,
  validateMainOpencodePreflight, OPENCODE_TRIM_DISABLED_TOOLS, OPENCODE_TRIM_TOOL_EDITS,
  OPENCODE_TRIM_MAX_DISABLED_TOOLS, OPENCODE_TRIM_MAX_TOOL_EDITS, OPENCODE_TRIM_V3_TOOL_EDITS,
  OPENCODE_TRIM_PLUGIN, OPENCODE_TRIM_REPORT, opencodeUnjailedEnv, runOpencodePreflight,
  OPENCODE_CONFLICT_TOOL_EDITS, OPENCODE_CONFLICT_NOGLOB_TOOL_EDITS, OPENCODE_CONFLICT_PROMPT_BULLET,
  OPENCODE_CONFLICT2_TOOL_EDITS, OPENCODE_CONFLICT3_TOOL_EDITS,
} from '../harness/opencode-task-runner.mjs';
import {
  OPENCODE_TRIM_PLUGIN_SOURCE, OPENCODE_TOOL_EDITS as SHIPPED_TOOL_EDITS, opencodePrompt as shippedOpencodePrompt,
} from '../../../scripts/harness-prompts/index.js';
import { OPENCODE_GPT_ORIGINAL, EFFICIENCY_LINE, opencodeBatchPrompt, opencodeBatchToolEdits } from '../harness/trim/batch-variants.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

let ok = true;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };
const BENCH = fileURLToPath(new URL('..', import.meta.url));
const CAPTURES = join(BENCH, 'handoffs/improve/harness-prompt-trim/captures');
const STATE = join(tmpdir(), `oc-trim-test-${process.pid}`);
mkdirSync(STATE, { recursive: true });

// The generated config as it was before the switch existed (HEAD 00ef0e9), byte for byte.
const PRE_TRIM_CONFIG = '{"$schema":"https://opencode.ai/config.json","plugin":[],"provider":{"openrouter":{"options":{"apiKey":"{env:OPENROUTER_API_KEY}"}}},"permission":{"bash":"allow","edit":"allow","write":"allow","read":"allow","webfetch":"deny","websearch":"deny"}}';

console.log('switch OFF adds nothing:');
for (const off of [undefined, '', '0', ' 0 ']) {
  const t = opencodeHarnessTrim(off, { apiModel: 'x-ai/grok-4.5', stateDir: STATE });
  assert(t.mode === null && !Object.keys(t.config).length && !Object.keys(t.files).length
      && !t.plugins.length && !t.stateEntries.length, `trim ${JSON.stringify(off)} is inert`);
  assert(JSON.stringify(buildMainOpencodeConfig({ env: {}, trim: t })) === PRE_TRIM_CONFIG,
    `trim ${JSON.stringify(off)}: config byte-identical to the pre-trim harness`);
}
assert(JSON.stringify(buildMainOpencodeConfig({ env: {} })) === PRE_TRIM_CONFIG, 'no trim argument: config byte-identical');
const capped = buildMainOpencodeConfig({ env: { SS_HARD_TURN_CAP: '40' }, trim: opencodeHarnessTrim('0') });
assert(JSON.stringify(capped) === PRE_TRIM_CONFIG.slice(0, -1) + ',"agent":{"build":{"maxSteps":40}}}',
  'off + hard turn cap: config byte-identical to the pre-trim capped config');

console.log('\nnative arm is never trimmed:');
for (const model of ['x-ai/grok-4.5', 'meta/muse-spark-1.1', 'openai/gpt-5.1', 'anthropic/claude-sonnet-5']) {
  for (const mode of ['1', 'max']) {
    const t = opencodeArmHarnessTrim({ sweet: false, env: { OC_HARNESS_TRIM: mode }, apiModel: model, stateDir: STATE });
    assert(t.mode === null && JSON.stringify(buildMainOpencodeConfig({ env: {}, trim: t })) === PRE_TRIM_CONFIG,
      `native + OC_HARNESS_TRIM=${mode} on ${model}: full opencode config`);
  }
}
assert(opencodeArmHarnessTrim({ sweet: true, env: {}, apiModel: 'x-ai/grok-4.5', stateDir: STATE }).mode === null,
  'sweet with the switch unset: off');

console.log('\nsweet + OC_HARNESS_TRIM=1:');
const FAMILIES = { 'x-ai/grok-4.5': 'default', 'meta/muse-spark-1.1': 'muse', 'openai/gpt-5.1': 'gpt', 'anthropic/claude-sonnet-5': 'claude' };
for (const [model, family] of Object.entries(FAMILIES)) {
  assert(opencodePromptFamily(model) === family, `${model} → ${family} prompt (mirrors opencode's own choice)`);
  const t = opencodeArmHarnessTrim({ sweet: true, env: { OC_HARNESS_TRIM: '1' }, apiModel: model, stateDir: STATE });
  const cfg = buildMainOpencodeConfig({ env: {}, trim: t });
  const prompt = readFileSync(join(BENCH, `harness/trim/opencode-1.18.4-prompt-${family}.txt`), 'utf8');
  assert(t.mode === `prompt:${family}+tools+tooldesc` && cfg.agent.build.prompt === prompt,
    `${family}: agent.build.prompt is the trimmed copy`, t.mode);
  assert(JSON.stringify(Object.keys(cfg.tools)) === JSON.stringify(OPENCODE_TRIM_DISABLED_TOOLS)
      && Object.values(cfg.tools).every(v => v === false), `${family}: glob, grep and skill disabled`);
  assert(cfg.plugin.length === 1 && cfg.plugin[0][0] === `file://${join(STATE, OPENCODE_TRIM_PLUGIN)}`
      && cfg.plugin[0][1].report === join(STATE, OPENCODE_TRIM_REPORT), `${family}: plugin and report live in the runner state dir`);
  assert(!/\{(env|file):/.test(prompt), `${family}: prompt has no opencode {env:}/{file:} substitution markers`);
  assert(!cfg.agent.general && !cfg.agent.explore, `${family}: round 1 leaves the subagents alone`);
}

console.log('\nsweet + OC_HARNESS_TRIM=max:');
const explorePrompt = readFileSync(join(BENCH, 'harness/trim/opencode-1.18.4-prompt-explore-max.txt'), 'utf8');
for (const [model, family] of Object.entries(FAMILIES)) {
  const t = opencodeArmHarnessTrim({ sweet: true, env: { OC_HARNESS_TRIM: 'max' }, apiModel: model, stateDir: STATE });
  const cfg = buildMainOpencodeConfig({ env: {}, trim: t });
  const prompt = readFileSync(join(BENCH, `harness/trim/opencode-1.18.4-prompt-${family}-max.txt`), 'utf8');
  assert(t.mode === `max:prompt:${family}+subagents+tools+tooldesc` && cfg.agent.build.prompt === prompt,
    `${family}: agent.build.prompt is the max copy`, t.mode);
  assert(cfg.agent.general.prompt === prompt && cfg.agent.explore.prompt === explorePrompt
      && Object.keys(cfg.agent).join() === 'build,general,explore',
    `${family}: general gets the build prompt, explore its edited prompt, nothing else`);
  assert(JSON.stringify(Object.keys(cfg.tools)) === JSON.stringify(OPENCODE_TRIM_MAX_DISABLED_TOOLS)
      && Object.values(cfg.tools).every(v => v === false), `${family}: glob, grep, skill and todowrite disabled`);
  assert(cfg.plugin[0][1].edits === OPENCODE_TRIM_MAX_TOOL_EDITS, `${family}: plugin gets the max edits`);
  for (const gone of ['TodoWrite', 'ask one short question', 'stop and ask the user', 'commentary', 'extensively',
    'Glob', 'Grep', 'Code References', 'Check the README']) {
    if (prompt.includes(gone)) assert(false, `${family}: "${gone}" removed`);
  }
  assert(/NEVER revert|Only use tools|apply_patch|Edit for editing/.test(prompt) && /Persist until|Implement the solution|NEVER create files/.test(prompt),
    `${family}: max keeps the coding rules`);
}
assert(!/Use Glob|Use Grep/.test(explorePrompt) && explorePrompt.includes('Use Read when you know'), 'explore: only the Glob/Grep lines go');
assert(OPENCODE_TRIM_MAX_DISABLED_TOOLS.includes('todowrite')
    && !OPENCODE_TRIM_MAX_DISABLED_TOOLS.some(n => ['bash', 'read', 'edit', 'write', 'apply_patch', 'task'].includes(n)),
  'max: todowrite off; bash, read, edit, write, apply_patch and task stay enabled');
const capMax = buildMainOpencodeConfig({ env: { SS_HARD_TURN_CAP: '40' }, trim: opencodeHarnessTrim('max', { apiModel: 'openai/gpt-5.6-luna', stateDir: STATE }) });
assert(capMax.agent.build.maxSteps === 40 && !capMax.agent.general.maxSteps, 'max keeps the hard turn cap on build only');

const t1 = opencodeHarnessTrim('1', { apiModel: 'x-ai/grok-4.5', stateDir: STATE });
assert(!OPENCODE_TRIM_DISABLED_TOOLS.some(n => ['bash', 'read', 'edit', 'write', 'apply_patch', 'todowrite', 'task'].includes(n)),
  'bash, read, edit, write, apply_patch, todowrite and task stay enabled');
const capTrim = buildMainOpencodeConfig({ env: { SS_HARD_TURN_CAP: '40' }, trim: t1 });
assert(capTrim.agent.build.maxSteps === 40 && typeof capTrim.agent.build.prompt === 'string', 'trim keeps the hard turn cap');
assert(validateMainOpencodePreflight({ version: '1.18.4', resolved: { plugin: t1.plugins }, plugins: t1.plugins }),
  'preflight accepts exactly the runner-configured trim plugin');
let ambient = null;
try { validateMainOpencodePreflight({ version: '1.18.4', resolved: { plugin: [...t1.plugins, 'evil'] }, plugins: t1.plugins }); } catch (e) { ambient = e; }
assert(ambient !== null, 'preflight still rejects any extra (ambient) plugin');
let ambientOff = null;
try { validateMainOpencodePreflight({ version: '1.18.4', resolved: { plugin: t1.plugins } }); } catch (e) { ambientOff = e; }
assert(ambientOff !== null, 'preflight with the switch off rejects the trim plugin (plugins default to [])');

console.log('\nbad values throw:');
for (const [mode, model] of [['yes', 'x-ai/grok-4.5'], ['2', 'x-ai/grok-4.5'], ['tools', 'x-ai/grok-4.5'], ['MAX', 'x-ai/grok-4.5'], ['V3', 'x-ai/grok-4.5'], ['v3', 'openai/gpt-5.3-codex'],
  ['1', 'google/gemini-3.8-pro'], ['1', 'openai/gpt-5.3-codex'], ['1', 'moonshotai/kimi-k3'], ['max', 'openai/gpt-5.3-codex']]) {
  let err = null;
  try { opencodeHarnessTrim(mode, { apiModel: model, stateDir: STATE }); } catch (e) { err = e; }
  assert(err !== null, `OC_HARNESS_TRIM=${mode} on ${model} throws instead of running half-trimmed`);
}

console.log('\nplugin edits only descriptions, and reports them:');
const { default: plugin } = await import(OPENCODE_TRIM_PLUGIN_SOURCE); // shipped by init (scripts/harness-prompts/)
const reportPath = join(STATE, OPENCODE_TRIM_REPORT);
const hooks = await plugin({}, { edits: OPENCODE_TRIM_TOOL_EDITS, report: reportPath });
const offBody = JSON.parse(readFileSync(join(CAPTURES, 'opencode-1.18.4-request-sweet-trim-off-default.json'), 'utf8'));
const tool = name => offBody.tools.find(x => x.function.name === name).function;
for (const name of ['bash', 'read', 'edit', 'task']) {
  const params = { marker: name };
  const out = { description: tool(name).description, parameters: params, jsonSchema: undefined };
  await hooks['tool.definition']({ toolID: name }, out);
  assert(out.parameters === params, `${name}: parameters object untouched`);
  if (name === 'edit') assert(out.description === tool(name).description, `${name}: description untouched`);
  if (name === 'task') {
    assert(!/Glob tool|Grep tool/.test(out.description) && out.description.includes('use the Read tool instead of the Task tool')
        && out.description.includes('- explore:') && out.description.length === tool(name).description.length - 139,
      'task: only the pointers to the disabled glob/grep tools go; delegation text and agent list stay',
      String(tool(name).description.length - out.description.length));
  }
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert(report.bash.applied === 4 && !report.bash.missing.length && report.read.applied === 2 && !report.read.missing.length
    && report.task.applied === 2 && !report.task.missing.length,
  'every edit applies to the captured 1.18.4 descriptions', JSON.stringify(report));
const bashOut = { description: tool('bash').description };
await hooks['tool.definition']({ toolID: 'bash' }, bashOut);
for (const gone of ['DO NOT use it for file operations', 'Use Grep (NOT grep or rg)', 'Use Read (NOT cat/head/tail)', '`find`, `grep`, `cat`', 'or Grep to search']) {
  assert(!bashOut.description.includes(gone), `bash: "${gone}" removed`);
}
for (const kept of ['Edit files: Use Edit (NOT sed/awk)', '# Git and GitHub', 'Only commit, amend, push', 'workdir', 'will be truncated']) {
  assert(bashOut.description.includes(kept), `bash: "${kept}" kept`);
}
const drifted = { description: 'some other bash text' };
await hooks['tool.definition']({ toolID: 'bash' }, drifted);
assert(JSON.parse(readFileSync(reportPath, 'utf8')).bash.missing.length === 4, 'a drifted description is reported as missing edits');


console.log('\nv3 (round 1 + general gets the trimmed prompt + explore disabled + v3 edits):');
for (const [model, family] of [['openai/gpt-5.6-luna', 'gpt'], ['x-ai/grok-4.5', 'default'], ['anthropic/claude-opus-5.5', 'claude']]) {
  const t = opencodeHarnessTrim('v3', { apiModel: model, stateDir: STATE });
  const cfg = buildMainOpencodeConfig({ env: {}, trim: t });
  const round1 = readFileSync(join(BENCH, 'harness/trim', `opencode-1.18.4-prompt-${family}.txt`), 'utf8');
  assert(t.mode === `v3:prompt:${family}+general+noexplore+tools+tooldesc` && cfg.agent.build.prompt === round1,
    `${family}: v3 build prompt is the round-1 prompt, byte for byte`);
  assert(cfg.agent.general.prompt === round1 && JSON.stringify(cfg.agent.explore) === '{"disable":true}',
    `${family}: general gets the same trimmed prompt; explore is disabled`);
  assert(JSON.stringify(Object.keys(cfg.tools)) === JSON.stringify(OPENCODE_TRIM_DISABLED_TOOLS) && !('todowrite' in cfg.tools),
    `${family}: v3 disables glob/grep/skill only (todowrite and task stay)`);
  assert(cfg.plugin[0][1].edits === OPENCODE_TRIM_V3_TOOL_EDITS, `${family}: plugin gets the v3 edits`);
}
const capV3 = buildMainOpencodeConfig({ env: { SS_HARD_TURN_CAP: '40' }, trim: opencodeHarnessTrim('v3', { apiModel: 'openai/gpt-5.6-luna', stateDir: STATE }) });
assert(capV3.agent.build.maxSteps === 40 && !capV3.agent.general.maxSteps, 'v3 keeps the hard turn cap on build only');
const v3Hooks = await plugin({}, { edits: OPENCODE_TRIM_V3_TOOL_EDITS, report: join(STATE, 'v3-report.json') });
const v3Out = {};
for (const name of ['bash', 'read', 'task']) {
  v3Out[name] = { description: tool(name).description, parameters: { marker: name } };
  await v3Hooks['tool.definition']({ toolID: name }, v3Out[name]);
}
const v3Report = JSON.parse(readFileSync(join(STATE, 'v3-report.json'), 'utf8'));
assert(Object.entries(OPENCODE_TRIM_V3_TOOL_EDITS).every(([name, list]) => v3Report[name]?.applied === list.length && !v3Report[name].missing.length),
  'every v3 edit applies to the captured 1.18.4 descriptions', JSON.stringify(v3Report));
assert(v3Out.bash.description === bashOut.description, 'v3 bash description = round-1 bash description');
assert(v3Out.task.description.includes('If you are searching for a specific class definition like "class Foo", search for it directly instead')
    && !/Glob tool|Grep tool|used proactively|not visible to the user/.test(v3Out.task.description) && v3Out.task.description.includes('- general:'),
  'v3 task: the class-Foo deterrent stays (no disabled tool named); proactive and visibility notes go');
assert(!v3Out.read.description.includes('image files and PDFs') && !/grep tool|glob tool/.test(v3Out.read.description), 'v3 read: image note and glob/grep pointers go');

console.log('\nmax plugin edits:');
const maxReportPath = join(STATE, 'max-report.json');
const maxHooks = await plugin({}, { edits: OPENCODE_TRIM_MAX_TOOL_EDITS, report: maxReportPath });
const maxOut = {};
for (const name of ['bash', 'read', 'edit', 'write', 'task']) {
  const params = { marker: name };
  maxOut[name] = { description: tool(name).description, parameters: params };
  await maxHooks['tool.definition']({ toolID: name }, maxOut[name]);
  assert(maxOut[name].parameters === params, `max ${name}: parameters object untouched`);
}
const maxReport = JSON.parse(readFileSync(maxReportPath, 'utf8'));
assert(Object.entries(OPENCODE_TRIM_MAX_TOOL_EDITS).every(([name, list]) => maxReport[name]?.applied === list.length && !maxReport[name].missing.length),
  'every max edit applies to the captured 1.18.4 descriptions', JSON.stringify(maxReport));
for (const gone of ['DO NOT use it for file operations', 'Use Grep (NOT grep or rg)', 'Edit files: Use Edit', '# Git and GitHub',
  'git push', 'Directory Verification', '<good-example>']) {
  assert(!maxOut.bash.description.includes(gone), `max bash: "${gone}" removed`);
}
for (const kept of ['workdir', 'will be truncated', 'timeout', 'multiple bash tool calls in a single message', "Use ';' only"]) {
  assert(maxOut.bash.description.includes(kept), `max bash: "${kept}" kept`);
}
assert(!/must use your `Read` tool|MUST use the Read tool first/.test(maxOut.edit.description + maxOut.write.description)
    && maxOut.edit.description.includes('oldString'), 'max edit/write: only the Read-first claim goes');
assert(!maxOut.task.description.includes('not visible to the user') && maxOut.task.description.includes('task_id'),
  'max task: user-visibility and proactive notes go; resume and delegation text stay');

console.log('\nconflict-only trims (conflict, conflict-noglob) and <base>+<variant> combos:');
{
  // LCS line diff: what an edit removed and added, line by line.
  const lineDiff = (a, b) => {
    const A = a.split('\n'), B = b.split('\n');
    const L = Array.from({ length: A.length + 1 }, () => new Int32Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const removed = [], added = [];
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) removed.push(A[i++]); else added.push(B[j++]);
    }
    return { removed: [...removed, ...A.slice(i)], added: [...added, ...B.slice(j)] };
  };
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const LUNA = 'openai/gpt-5.6-luna';
  const original = readFileSync(OPENCODE_GPT_ORIGINAL, 'utf8');
  const gptBody = JSON.parse(readFileSync(join(CAPTURES, 'opencode-1.18.4-request-sweet-trim-off-gpt.json'), 'utf8'));
  const gtool = name => gptBody.tools.find(x => x.function.name === name).function.description;

  for (const off of [undefined, '', '0']) {
    const t = opencodeArmHarnessTrim({ sweet: true, env: { OC_HARNESS_TRIM: off }, apiModel: LUNA, stateDir: STATE });
    assert(JSON.stringify(buildMainOpencodeConfig({ env: {}, trim: t })) === PRE_TRIM_CONFIG, `luna, switch ${JSON.stringify(off)}: config byte-identical`);
  }
  for (const mode of ['conflict', 'conflict-noglob', 'conflict+todo2', 'untrimmed+todo2']) {
    const t = opencodeArmHarnessTrim({ sweet: false, env: { OC_HARNESS_TRIM: mode }, apiModel: LUNA, stateDir: STATE });
    assert(t.mode === null && JSON.stringify(buildMainOpencodeConfig({ env: {}, trim: t })) === PRE_TRIM_CONFIG, `native + ${mode}: full opencode config`);
  }

  const conflictPrompt = original.replace(OPENCODE_CONFLICT_PROMPT_BULLET, '');
  assert(same(lineDiff(original, conflictPrompt), { removed: [OPENCODE_CONFLICT_PROMPT_BULLET.trimEnd()], added: [] }),
    'conflict prompt: line diff v the untrimmed gpt prompt = only the "prefer using Glob and Grep" bullet');
  for (const kept of ['## Special user requests', 'asking for the time', 'for a "review"', '## Frontend tasks', '## Formatting rules', '## Response channels', 'Parallelize tool calls whenever possible'])
    assert(conflictPrompt.includes(kept), `conflict prompt keeps: ${kept}`);

  for (const [mode, noglob] of [['conflict', false], ['conflict-noglob', true]]) {
    const t = opencodeHarnessTrim(mode, { apiModel: LUNA, stateDir: STATE });
    const cfg = buildMainOpencodeConfig({ env: {}, trim: t });
    assert(t.mode === `${mode}:prompt:gpt+general+noexplore+${noglob ? 'noglob+' : ''}nogrep+tooldesc`, `${mode}: mode label`, t.mode);
    assert(cfg.agent.build.prompt === conflictPrompt && cfg.agent.general.prompt === conflictPrompt && same(cfg.agent.explore, { disable: true })
        && Object.keys(cfg.agent).join() === 'build,general,explore', `${mode}: build and general get the conflict prompt; explore disabled`);
    assert(same(cfg.tools, noglob ? { glob: false, grep: false } : { grep: false }), `${mode}: disables ${noglob ? 'glob and grep' : 'grep only (glob, skill, todowrite, task stay)'}`);
    assert(cfg.plugin.length === 1 && same(cfg.plugin[0][1].edits, noglob ? OPENCODE_CONFLICT_NOGLOB_TOOL_EDITS : OPENCODE_CONFLICT_TOOL_EDITS)
        && same(t.stateEntries, [OPENCODE_TRIM_PLUGIN, OPENCODE_TRIM_REPORT]), `${mode}: plugin with the ${mode} edits; report recorded like the other modes`);
    const capped = buildMainOpencodeConfig({ env: { SS_HARD_TURN_CAP: '40' }, trim: t });
    assert(capped.agent.build.maxSteps === 40 && !capped.agent.general.maxSteps, `${mode}: hard turn cap on build only`);
  }

  // Tool descriptions: run the plugin on the captured 1.18.4 gpt-family descriptions and list the diff.
  const truncLine = gtool('bash').split('\n').find(l => l.includes(' or Grep to search the full content'));
  const EXPECT = {
    conflict: {
      bash: {
        removed: [
          'IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.', '',
          truncLine,
          '  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:',
          '    - Content search: Use Grep (NOT grep or rg)', '    - Read files: Use Read (NOT cat/head/tail)'],
        added: [
          truncLine.replace(' or Grep to search the full content', ''),
          '  - Avoid using Bash with the `find`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:'],
      },
      read: { removed: ['- Use the grep tool to find specific content in large files or files with long lines.'], added: [] },
      task: { removed: ['- If you are searching for a specific class definition like "class Foo", use the Grep tool instead, to find the match more quickly'],
        added: ['- If you are searching for a specific class definition like "class Foo", search for it directly instead, to find the match more quickly'] },
      glob: { removed: ['- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead'], added: [] },
    },
  };
  EXPECT['conflict-noglob'] = {
    bash: {
      removed: [...EXPECT.conflict.bash.removed.slice(0, 4), '    - File search: Use Glob (NOT find or ls)', ...EXPECT.conflict.bash.removed.slice(4)],
      added: [EXPECT.conflict.bash.added[0], '  - Avoid using Bash with the `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:'],
    },
    read: { removed: [...EXPECT.conflict.read.removed, '- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.'], added: [] },
    task: {
      removed: ['- If you want to read a specific file path, use the Read or Glob tool instead of the Task tool, to find the match more quickly', ...EXPECT.conflict.task.removed],
      added: ['- If you want to read a specific file path, use the Read tool instead of the Task tool, to find the match more quickly', ...EXPECT.conflict.task.added],
    },
  };
  for (const [mode, edits] of [['conflict', OPENCODE_CONFLICT_TOOL_EDITS], ['conflict-noglob', OPENCODE_CONFLICT_NOGLOB_TOOL_EDITS]]) {
    const rp = join(STATE, `${mode}-report.json`);
    const hooks = await plugin({}, { edits, report: rp });
    const out = {};
    for (const name of ['bash', 'read', 'task', 'glob', 'apply_patch', 'todowrite', 'skill']) {
      out[name] = { description: gtool(name), parameters: { marker: name } };
      await hooks['tool.definition']({ toolID: name }, out[name]);
    }
    const rep = JSON.parse(readFileSync(rp, 'utf8'));
    assert(Object.entries(edits).every(([name, list]) => rep[name]?.applied === list.length && !rep[name].missing.length)
        && same(Object.keys(rep).sort(), Object.keys(edits).sort()), `${mode}: every edit applies to the captured gpt descriptions; nothing else is touched`, JSON.stringify(rep));
    for (const name of Object.keys(EXPECT[mode]))
      assert(same(lineDiff(gtool(name), out[name].description), EXPECT[mode][name]), `${mode} ${name}: line diff v the original is exactly the intended category-A text`,
        JSON.stringify(lineDiff(gtool(name), out[name].description)));
    for (const name of ['apply_patch', 'todowrite', 'skill', ...(mode === 'conflict-noglob' ? ['glob'] : [])])
      assert(out[name].description === gtool(name), `${mode} ${name}: description untouched`);
    assert(out.read.description.includes('image files and PDFs'), `${mode} read keeps: image files and PDFs`);
    for (const kept of ['not visible to the user', 'used proactively', '- explore:', '- general:']) assert(out.task.description.includes(kept), `${mode} task keeps: ${kept}`);
    for (const kept of ['# Git and GitHub', 'Edit files: Use Edit (NOT sed/awk)', 'workdir', ...(mode === 'conflict' ? ['File search: Use Glob (NOT find or ls)'] : [])])
      assert(out.bash.description.includes(kept), `${mode} bash keeps: ${kept}`);
  }

  // Combos: <base>+<variant>.
  const combo = m => opencodeHarnessTrim(m, { apiModel: LUNA, stateDir: STATE });
  for (const [m, variant] of [['conflict+todoall', 'todoall'], ['conflict+todo2', 'todo2'], ['conflict+todo2eff', 'todo2eff'], ['conflict-noglob+todo2', 'todo2']]) {
    const t = combo(m);
    const cfg = buildMainOpencodeConfig({ env: {}, trim: t });
    const base = m.startsWith('conflict-noglob') ? OPENCODE_CONFLICT_NOGLOB_TOOL_EDITS : OPENCODE_CONFLICT_TOOL_EDITS;
    assert(cfg.agent.build.prompt === opencodeBatchPrompt(variant, conflictPrompt) && cfg.agent.general.prompt === cfg.agent.build.prompt,
      `${m}: prompt = conflict prompt with the ${variant} line`);
    assert(same(cfg.plugin[0][1].edits, { ...base, ...opencodeBatchToolEdits(variant) }) && same(cfg.tools, combo(m.split('+')[0]).config.tools)
        && same(cfg.agent.explore, { disable: true }), `${m}: base tools/edits + the variant's todowrite edit`);
    assert(t.mode.startsWith(`${m}:prompt:gpt+general+noexplore+`), `${m}: mode label`, t.mode);
  }
  const u = combo('untrimmed+todoall'), b = opencodeHarnessTrim('batch-todoall', { apiModel: LUNA, stateDir: STATE });
  assert(same(u.config, b.config) && same(u.files, b.files) && same(u.plugins, b.plugins) && u.mode === 'untrimmed+todoall:prompt:gpt+general+tooldesc',
    'untrimmed+todoall = batch-todoall (the current champion), only the mode label differs');
  const u2 = combo('untrimmed+todo2');
  assert(u2.config.agentBuild.prompt === opencodeBatchPrompt('todo2') && !u2.config.tools && !u2.config.agents.explore,
    'untrimmed+todo2: the untrimmed prompt with the todo2 line; no tool or subagent change');
  const TODO2 = '- Send todowrite as a parallel call in the same turn as your next tool call, never as a turn of its own. Mark a step in_progress in the call that starts it, and completed in the call that starts the next one.';
  assert(same(lineDiff(original, opencodeBatchPrompt('todo2')), { removed: [], added: [TODO2] }), 'todo2 prompt: exactly one line added to the untrimmed prompt');
  assert(same(lineDiff(original, opencodeBatchPrompt('todo2eff')), { removed: [], added: [TODO2, EFFICIENCY_LINE] }), 'todo2eff prompt: the todo2 line and the efficiency line added');
  const tdHooks = await plugin({}, { edits: opencodeBatchToolEdits('todo2'), report: join(STATE, 'todo2-report.json') });
  const td = { description: gtool('todowrite') };
  await tdHooks['tool.definition']({ toolID: 'todowrite' }, td);
  assert(!td.description.includes('When in doubt, use it.') && td.description.includes("Update status in real time; don't batch completions")
      && JSON.parse(readFileSync(join(STATE, 'todo2-report.json'), 'utf8')).todowrite.applied === 1,
    'todo2 todowrite: "When in doubt, use it." removed; "Update status in real time" kept');
  for (const [m, model] of [['untrimmed', LUNA], ['conflict+nope', LUNA], ['conflict+todo2+todoall', LUNA], ['conflict+todoallfit', LUNA],
    ['Conflict', LUNA], ['conflict', 'x-ai/grok-4.5'], ['conflict-noglob', 'anthropic/claude-sonnet-5'], ['untrimmed+todo2', 'x-ai/grok-4.5']]) {
    let err = null;
    try { opencodeHarnessTrim(m, { apiModel: model, stateDir: STATE }); } catch (e) { err = e; }
    assert(err !== null, `OC_HARNESS_TRIM=${m} on ${model} throws`);
  }
}

console.log('\ntrimmed prompts are the reproducible build of the captured originals:');
const build = spawnSync('python3', [join(BENCH, 'handoffs/improve/harness-prompt-trim/scripts/build_oc_trim_prompts.py'), '--check'], { encoding: 'utf8' });
assert(build.status === 0, 'build_oc_trim_prompts.py --check passes', build.stderr || build.stdout);
for (const family of Object.values(FAMILIES)) {
  const text = readFileSync(join(BENCH, `harness/trim/opencode-1.18.4-prompt-${family}.txt`), 'utf8');
  for (const gone of ['use the Task tool instead of running search', 'prefer to use the Task tool', 'prefer using Glob and Grep',
    'Read for reading files instead of cat', 'Reserve bash tools exclusively', 'uses grep and glob search tools', 'WebFetch']) {
    if (text.includes(gone)) assert(false, `${family}: "${gone}" removed`);
  }
  assert(/NEVER commit|NEVER revert|Only use tools|Code References|apply_patch/.test(text), `${family}: steering removed, coding rules kept`);
}
assert(existsSync(join(BENCH, 'harness/trim/NOTICE-opencode.md')), 'MIT notice for the opencode copies is present');
assert(existsSync(join(CAPTURES, 'opencode-1.18.4-request-sweet-trim-off-explore-subagent.json')), 'explore original is captured');

// Unjailed (SS_ISOLATION=0, the Mac): no $HOME mask, so opencode must get private dirs or it
// reads the operator's ~/.config/opencode, ~/.claude, ~/.agents and writes its DB outside
// ocData. Request-level proof: captures/*-gpt-luna-unjailed.json.
console.log('\nunjailed private opencode dirs:');
const ocData = join(STATE, 'opencode-data');
mkdirSync(ocData, { recursive: true });
const uenv = opencodeUnjailedEnv({ root: join(STATE, 'opencode-home'), ocData });
assert(JSON.stringify(Object.keys(uenv).sort()) === JSON.stringify(['OPENCODE_TEST_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']),
  'sets config, data, state and opencode-home dirs only (HOME and the cache stay the operator\'s)', Object.keys(uenv).join(','));
assert(Object.values(uenv).every(dir => dir.startsWith(join(STATE, 'opencode-home')) && existsSync(dir)),
  'every dir is private to the rollout and exists');
assert(realpathSync(join(uenv.XDG_DATA_HOME, 'opencode')) === realpathSync(ocData), 'data/opencode resolves to ocData (session DB lands where the cost reader looks)');
assert(!readdirSync(join(uenv.XDG_CONFIG_HOME)).length && !readdirSync(uenv.OPENCODE_TEST_HOME).length, 'config and home dirs start empty');
assert(JSON.stringify(opencodeUnjailedEnv({ root: join(STATE, 'opencode-home'), ocData })) === JSON.stringify(uenv), 'idempotent (a start retry reuses the same dirs)');

console.log('\npreflight retry (2026-09-29 INFRA defect):');
{
  const CFG = JSON.stringify({ plugin: [] });
  // Scripted spawn: each call pops the next outcome for its subcommand.
  const fake = script => {
    const calls = [];
    const spawn = async (bin, args, opts) => {
      calls.push({ args: args.join(' '), timeoutMs: opts.timeoutMs });
      const key = args[0] === '--version' ? 'version' : 'config';
      return script[key].shift() ?? { stdout: '', stderr: 'script exhausted', exitCode: 1, timedOut: false };
    };
    return { spawn, calls };
  };
  const okRun = (stdout) => ({ stdout, stderr: '', exitCode: 0, timedOut: false });
  const quiet = { sleep: async () => {}, log: () => {} };

  const f1 = fake({ version: [okRun('1.18.4'), okRun('1.18.4')], config: [{ stdout: '', stderr: 'installing plugin…', exitCode: 0, timedOut: true }, okRun(CFG)] });
  const r1 = await runOpencodePreflight({ spawn: f1.spawn, cwd: STATE, env: {}, plugins: [], ...quiet });
  assert(r1.attempts === 2 && f1.calls.length === 4, 'transient debug-config timeout is retried once and then passes', JSON.stringify(f1.calls));
  assert(/attempt 1: debug config: exit=0 timedOut/.test(r1.processFailures[0]) && /installing plugin/.test(r1.processFailures[0]),
    'first-attempt process detail (exit, timeout, stderr tail) is kept on the result', r1.processFailures.join());
  assert(f1.calls.every(c => c.timeoutMs >= 120000), 'per-process timeout is at least 120 s (was 30 s)');

  const f2 = fake({ version: [{ stdout: '', stderr: 'bus error', exitCode: 1, timedOut: false, signal: 'SIGBUS' }, okRun('1.18.4')], config: [okRun(CFG)] });
  const r2 = await runOpencodePreflight({ spawn: f2.spawn, cwd: STATE, env: {}, plugins: [], ...quiet });
  assert(r2.attempts === 2 && f2.calls.length === 3, 'a failed --version skips debug config and is retried');

  const f3 = fake({ version: [okRun('1.18.4'), okRun('1.18.4')], config: [{ stdout: '', stderr: 'boom', exitCode: 3, timedOut: false }, { stdout: '', stderr: 'boom again', exitCode: 3, timedOut: false }] });
  let e3 = null;
  try { await runOpencodePreflight({ spawn: f3.spawn, cwd: STATE, env: {}, plugins: [], ...quiet }); } catch (e) { e3 = e; }
  assert(e3 && /^OpenCode preflight process failed \(attempt 1: debug config: exit=3.*attempt 2: debug config: exit=3.*boom again/.test(e3.message)
    && f3.calls.length === 4, 'bounded: two process failures still fail, with exit code and stderr tail in the message', e3?.message);

  const f4 = fake({ version: [okRun('1.18.4'), okRun('1.18.4')], config: [okRun(JSON.stringify({ plugin: ['evil'] })), okRun(CFG)] });
  let e4 = null;
  try { await runOpencodePreflight({ spawn: f4.spawn, cwd: STATE, env: {}, plugins: [], ...quiet }); } catch (e) { e4 = e; }
  assert(e4 && /ambient OpenCode plugin/.test(e4.message) && f4.calls.length === 2, 'a real config mismatch (ambient plugin) fails at once, never retried', e4?.message);

  const f5 = fake({ version: [okRun('1.17.0'), okRun('1.18.4')], config: [okRun(CFG), okRun(CFG)] });
  let e5 = null;
  try { await runOpencodePreflight({ spawn: f5.spawn, cwd: STATE, env: {}, plugins: [], ...quiet }); } catch (e) { e5 = e; }
  assert(e5 && /pinned OpenCode/.test(e5.message) && f5.calls.length === 2, 'a wrong opencode version fails at once, never retried', e5?.message);

  const f6 = fake({ version: [okRun('1.18.4')], config: [okRun('not json at all')] });
  let e6 = null;
  try { await runOpencodePreflight({ spawn: f6.spawn, cwd: STATE, env: {}, plugins: [], ...quiet }); } catch (e) { e6 = e; }
  assert(e6 && /did not return JSON/.test(e6.message) && f6.calls.length === 2, 'non-JSON debug config (exit 0) fails at once, never retried', e6?.message);
}

console.log('\nshipped by `sweet-search init --opencode` = conflict3+todo3eff3k (single source):');
{
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const t = opencodeHarnessTrim('conflict3+todo3eff3k', { apiModel: 'openai/gpt-5.6-luna', stateDir: STATE });
  assert(t.config.agentBuild.prompt === shippedOpencodePrompt() && t.config.agents.general.prompt === shippedOpencodePrompt(),
    'the shipped prompt is byte-identical to the bench arm (build + general)');
  assert(same(t.config.plugin[0][1].edits, SHIPPED_TOOL_EDITS) && same(t.config.tools, { grep: false })
      && same(t.config.agents.explore, { disable: true }),
    'the shipped tool edits, grep off and explore off are the bench arm');
  assert(OPENCODE_CONFLICT3_TOOL_EDITS === SHIPPED_TOOL_EDITS
      && same(SHIPPED_TOOL_EDITS, { bash: OPENCODE_CONFLICT2_TOOL_EDITS.bash, read: OPENCODE_CONFLICT2_TOOL_EDITS.read,
        task: OPENCODE_CONFLICT2_TOOL_EDITS.task, glob: OPENCODE_CONFLICT2_TOOL_EDITS.glob }),
    "conflict3's tool edits = conflict2's bash/read/task/glob edits (defined once, in the product)");
  assert(t.files[OPENCODE_TRIM_PLUGIN] === readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8'),
    'the bench copies the shipped plugin file into the state dir');
}

rmSync(STATE, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
