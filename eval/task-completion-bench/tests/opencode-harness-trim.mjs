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
  OPENCODE_TRIM_PLUGIN, OPENCODE_TRIM_REPORT, opencodeUnjailedEnv,
} from '../harness/opencode-task-runner.mjs';
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
  const t = opencodeArmHarnessTrim({ sweet: false, env: { OC_HARNESS_TRIM: '1' }, apiModel: model, stateDir: STATE });
  assert(t.mode === null && JSON.stringify(buildMainOpencodeConfig({ env: {}, trim: t })) === PRE_TRIM_CONFIG,
    `native + OC_HARNESS_TRIM=1 on ${model}: full opencode config`);
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
}
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
for (const [mode, model] of [['yes', 'x-ai/grok-4.5'], ['2', 'x-ai/grok-4.5'], ['tools', 'x-ai/grok-4.5'],
  ['1', 'google/gemini-3.8-pro'], ['1', 'openai/gpt-5.3-codex'], ['1', 'moonshotai/kimi-k3']]) {
  let err = null;
  try { opencodeHarnessTrim(mode, { apiModel: model, stateDir: STATE }); } catch (e) { err = e; }
  assert(err !== null, `OC_HARNESS_TRIM=${mode} on ${model} throws instead of running half-trimmed`);
}

console.log('\nplugin edits only descriptions, and reports them:');
const { default: plugin } = await import(join(BENCH, 'harness/trim', OPENCODE_TRIM_PLUGIN));
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

rmSync(STATE, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
