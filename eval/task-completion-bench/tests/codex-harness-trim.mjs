// Tests for the Codex harness trim switch (CODEX_HARNESS_TRIM, 2026-09-25,
// handoffs/improve/harness-prompt-trim). The switch is research-only and default OFF:
// OFF must add nothing to the argv or the runner state dir (held-out legs stay
// reproducible), native must never get it, and the edited instructions must still match
// their reviewed build from the $0 capture.
//
// Standalone: `node tests/codex-harness-trim.mjs` — exit 1 on fail.
import {
  codexHarnessTrim, codexHarnessTrimArgs, codexBenchConfigToml, buildPrivateHome, PRIVATE_HOME_LINKS,
  CODEX_HARNESS_TRIM_CONFIG,
  CODEX_HARNESS_TRIM_SOURCES, CODEX_HARNESS_TRIM_STATE_FILE, CODEX_HARNESS_TRIM_V3_SOURCES,
} from '../harness/codex-task-runner.mjs';
import { buildInstructions, headerFor, sourceFor } from '../harness/trim/build-codex-instructions.mjs';
import { mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let ok = true;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const STATE = mkdtempSync(join(tmpdir(), 'codex-trim-test-'));

console.log('harness trim switch (CODEX_HARNESS_TRIM, default OFF):');
for (const off of [undefined, '', '0', ' 0 ']) {
  const t = codexHarnessTrim({ sweet: true, mode: off });
  const args = codexHarnessTrimArgs(t, STATE);
  assert(t.mode === null && args.length === 0 && readdirSync(STATE).length === 0,
    `sweet + ${JSON.stringify(off)} adds no argv and writes nothing (byte-identical to the held-out legs)`);
}
for (const mode of ['1', 'yes', 'tools']) {
  const t = codexHarnessTrim({ sweet: false, mode });
  assert(t.mode === null && codexHarnessTrimArgs(t, STATE).length === 0 && readdirSync(STATE).length === 0,
    `native + ${JSON.stringify(mode)} never gets the trim and never throws`);
}
assert(throws(() => codexHarnessTrim({ sweet: true, mode: 'yes' })),
  'sweet + an unknown value throws instead of silently running untrimmed');
assert(throws(() => codexHarnessTrim({ sweet: true, mode: '1', model: 'openai/gpt-5.6-sol' })),
  'sweet + 1 refuses a model whose base prompt was not captured and edited');
assert(codexHarnessTrim({ sweet: true, mode: '1', model: 'openai/gpt-5.6-luna' }).source === CODEX_HARNESS_TRIM_SOURCES['gpt-5.6-luna'],
  'sweet + 1 on gpt-5.6-luna picks the luna edit');
assert(!throws(() => codexHarnessTrim({ sweet: true, mode: '1', model: 'gpt-5.5' })),
  'sweet + 1 accepts the subscription model id (bare gpt-5.5)');

const on = codexHarnessTrim({ sweet: true, mode: '1' });
const args = codexHarnessTrimArgs(on, STATE);
const file = join(STATE, CODEX_HARNESS_TRIM_STATE_FILE);
assert(on.mode === 'instructions+tools', 'sweet + 1 records mode instructions+tools');
assert(args.length === 2 * (1 + CODEX_HARNESS_TRIM_CONFIG.length) && args.every((a, i) => i % 2 ? true : a === '-c'),
  'sweet + 1 emits only -c pairs');
assert(args[1] === `model_instructions_file=${JSON.stringify(file)}`,
  'the instructions file is the runner-state copy (bound into the jail at the same path)');
assert(JSON.stringify(args.slice(2).filter((_, i) => i % 2)) === JSON.stringify([
  'web_search="disabled"', 'features.goals=false',
  'tools.experimental_request_user_input.enabled=false', 'skills.include_instructions=false',
  'include_permissions_instructions=false', 'include_environment_context=false', 'tools.update_plan.enabled=false',
]), 'sweet + 1 sends exactly the seven capture-verified tool/context keys');
assert(!args.join(' ').includes('multi_agent'), 'sweet + 1 keeps delegation (no multi_agent key; tool_search stays)');
assert(!args.join(' ').match(/exec_command|write_stdin|apply_patch|shell_tool|unified_exec|code_mode/),
  'no key touches exec_command, write_stdin, apply_patch or the code-mode exec tool');

const sent = readFileSync(file, 'utf8');
const source = readFileSync(CODEX_HARNESS_TRIM_SOURCES['gpt-5.5'], 'utf8');
assert(source.startsWith(headerFor('gpt-5.5')) && sent === source.slice(headerFor('gpt-5.5').length),
  'the model gets the edited text with the license header stripped, nothing else');
assert(!sent.includes('<!--') && sent.startsWith('You are Codex, a coding agent based on GPT-5.'),
  'no notice text reaches the model');
const KEEP = ['Use `apply_patch` for', 'Never use destructive commands like `git reset --hard`'];
for (const model of Object.keys(CODEX_HARNESS_TRIM_SOURCES)) {
  const text = readFileSync(CODEX_HARNESS_TRIM_SOURCES[model], 'utf8');
  const body = text.slice(headerFor(model).length);
  assert(text.startsWith(headerFor(model)) && body === buildInstructions(model, sourceFor(model)),
    `${model}: the committed file equals the reviewed deletion build of the 0.146.1 capture`);
  for (const s of ['reach first for `rg`', 'file reads such as', '`rg --files`', 'Skills', '# Personality', 'Formatting rules', 'Frontend', 'Visualizations',
    'may send', 'checklist', 'test coverage scale', 'longer than 60 seconds', 'Diagnose:', 'babysit']) {
    assert(!body.includes(s), `${model}: steering/unused text removed: ${s}`);
  }
  for (const s of KEEP) assert(body.includes(s), `${model}: coding rule kept: ${s}`);
}
for (const s of ['NEVER revert existing changes you did not make', 'Do not stop at analysis or half-finished fixes',
  'If you weren\'t able to do something, for example run tests, you tell the user.',
  'You parallelize tool calls whenever you can. You use `multi_tool_use.parallel`']) {
  assert(sent.includes(s), `gpt-5.5: coding rule kept: ${s.slice(0, 50)}`);
}
const luna = readFileSync(CODEX_HARNESS_TRIM_SOURCES['gpt-5.6-luna'], 'utf8');
for (const s of ['you preserve them, ignore unrelated edits', 'Change or build: implement the requested change',
  'Never run commands such as `rm -rf $HOME`', 'prefer parallelization over sequential tool calls']) {
  assert(luna.includes(s), `gpt-5.6-luna: coding rule kept: ${s.slice(0, 50)}`);
}

console.log('\nmode v3 (first edition + zero-risk cuts, luna only):');
{
  const S3 = mkdtempSync(join(tmpdir(), 'codex-trim-v3-test-'));
  const v3 = codexHarnessTrim({ sweet: true, mode: 'v3', model: 'openai/gpt-5.6-luna' });
  const a3 = codexHarnessTrimArgs(v3, S3);
  assert(v3.mode === 'instructions-v3+tools-v3' && v3.source === CODEX_HARNESS_TRIM_V3_SOURCES['gpt-5.6-luna'],
    'sweet + v3 on luna picks the v3 edit and records its own mode');
  assert(throws(() => codexHarnessTrim({ sweet: true, mode: 'v3', model: 'gpt-5.5' })), 'sweet + v3 refuses gpt-5.5 (no v3 edit)');
  assert(codexHarnessTrim({ sweet: false, mode: 'v3', model: 'openai/gpt-5.6-luna' }).mode === null, 'native + v3 never gets the trim');
  assert(JSON.stringify(a3.slice(2).filter((_, i) => i % 2)) === JSON.stringify([
    'web_search="disabled"', 'features.goals=false',
    'tools.experimental_request_user_input.enabled=false', 'skills.include_instructions=false',
  ]), 'sweet + v3 sends only the first-edition keys (permissions, environment context and update_plan stay)');
  const text = readFileSync(CODEX_HARNESS_TRIM_V3_SOURCES['gpt-5.6-luna'], 'utf8');
  const body = text.slice(headerFor('gpt-5.6-luna-v3').length);
  assert(text.startsWith(headerFor('gpt-5.6-luna-v3')) && body === buildInstructions('gpt-5.6-luna-v3', sourceFor('gpt-5.6-luna-v3')),
    'v3: the committed file equals the reviewed deletion build of the 0.146.1 capture');
  assert(readFileSync(join(S3, CODEX_HARNESS_TRIM_STATE_FILE), 'utf8') === body, 'v3: the model gets the edit with the header stripped');
  for (const s of ['reach first for `rg`', 'Skills', '# Personality', 'Formatting rules', 'Visualizations', 'may send',
    'longer than 60 seconds', 'Never praise your plan']) assert(!body.includes(s), `v3: removed: ${s}`);
  for (const s of ['Diagnose:', 'babysit', 'exhaust safe in-scope checks and alternatives', 'clarifying questions or objections',
    'start with a message in the `commentary` channel', 'Change or build: implement the requested change',
    'Never run commands such as `rm -rf $HOME`', 'Use `apply_patch` for'])
    assert(body.includes(s), `v3: kept: ${s.slice(0, 50)}`);
  assert(body.split('Never repurpose `$HOME`').length === 2, 'v3: the $HOME rule appears once (duplicate removed)');
  rmSync(S3, { recursive: true, force: true });
}

console.log('\nunjailed bench-owned CODEX_HOME config:');
const cfg = codexBenchConfigToml('https://openrouter.ai/api/v1');
assert(cfg === '[model_providers.openrouter]\nname = "OpenRouter"\nbase_url = "https://openrouter.ai/api/v1"\n'
  + 'env_key = "OPENROUTER_API_KEY"\nwire_api = "responses"\n\n[features]\nsuppress_unstable_features_warning = true\n',
  'the config is the box provider definition, byte for byte');
assert(!/mcp_servers|profile|auth|projects/.test(cfg), 'no MCP servers, profiles, auth or project entries');
const PH = mkdtempSync(join(tmpdir(), 'codex-private-home-test-'));
buildPrivateHome(PH, { realHome: '/real/home', codexHome: '/state/codex-home' });
buildPrivateHome(PH, { realHome: '/real/home', codexHome: '/state/codex-home' });   // idempotent on a retry
assert(JSON.stringify(PRIVATE_HOME_LINKS) === JSON.stringify(['.gitconfig', '.local/bin', '.cache/sweet-search'])
    && PRIVATE_HOME_LINKS.every(rel => readlinkSync(join(PH, rel)) === join('/real/home', rel)),
  'private HOME links exactly the jail whitelist (.gitconfig, .local/bin, .cache/sweet-search) to the real home');
assert(readlinkSync(join(PH, '.codex')) === '/state/codex-home', 'private HOME/.codex is the per-rollout codexHome');
assert(!readdirSync(PH).includes('.agents'), 'no ~/.agents in the private HOME (operator skills stay out)');
rmSync(PH, { recursive: true, force: true });
rmSync(STATE, { recursive: true, force: true });

console.log(ok ? '\nall codex harness-trim tests passed' : '\nFAILED');
process.exit(ok ? 0 : 1);
