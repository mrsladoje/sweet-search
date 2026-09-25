#!/usr/bin/env node
// $0 capture of the opencode request AS THE BENCH RUNNER BUILDS IT (sweet or native arm).
// No model is called: the openrouter provider's baseURL points at capture_proxy.py, which
// saves the POST body and answers 400. Throwaway HOME/XDG dirs and a fake key keep the
// operator's opencode install, config and login out of it.
//
//   python3 capture_proxy.py 18821 <outdir> &
//   node capture_oc_runner.mjs --out <outdir> --model x-ai/grok-4.5 [--arm sweet|native]
//        [--trim 0|1] [--bin <opencode 1.18.4>] [--port 18821]
//
// The config is the runner's own (buildMainOpencodeConfig + opencodeHarnessTrim, the same
// calls runOpencodeTask makes); the capture only adds provider.options.baseURL. The trim's
// state files are written into a stand-in runner state dir exactly as the runner writes them.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '../../../../../..');
const HARNESS = join(ROOT, 'eval/task-completion-bench/harness');
const oc = await import(join(HARNESS, 'opencode-task-runner.mjs'));
const { writeInstructionFile, issuePrompt } = await import(join(HARNESS, 'agent-runner-shared.mjs'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const arm = opt('arm', 'sweet');
const model = opt('model', 'x-ai/grok-4.5');
const port = opt('port', '18821');
const bin = opt('bin');
const outDir = opt('out');
if (!outDir || !bin) throw new Error('--out and --bin required');

const MPP = join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
const mppText = readFileSync(MPP, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const sweet = arm === 'sweet';

const work = mkdtempSync(join(tmpdir(), 'oc-capture-'));
const rundir = join(work, 'repo');
const home = join(work, 'home');
const stateDir = join(work, 'runner-state');
for (const d of [rundir, home, stateDir]) mkdirSync(d);
writeFileSync(join(rundir, 'main.py'), 'def add(a, b):\n    return a + b\n');
execFileSync('git', ['init', '-q'], { cwd: rundir });
execFileSync('git', ['-c', 'user.email=c@c', '-c', 'user.name=c', 'add', '.'], { cwd: rundir });
execFileSync('git', ['-c', 'user.email=c@c', '-c', 'user.name=c', 'commit', '-qm', 'init'], { cwd: rundir });
writeInstructionFile(rundir, 'AGENTS.md', { sweet, mppText });

// Same calls as runOpencodeTask: trim resolved from the switch (sweet arm only), files
// written into the state dir, config built from both.
const trim = oc.opencodeHarnessTrim(sweet ? opt('trim', '0') : '0', { apiModel: model, stateDir });
for (const [name, text] of Object.entries(trim.files)) writeFileSync(join(stateDir, name), text);
const config = oc.buildMainOpencodeConfig({ env: {}, trim });
config.provider.openrouter.options.baseURL = `http://127.0.0.1:${port}/v1`;
const ocConfig = join(stateDir, 'opencode.json');
writeFileSync(ocConfig, JSON.stringify(config));

// --unjailed: the Mac (SS_ISOLATION=0) runner shape — the operator's REAL $HOME and
// ~/.cache/opencode, with the runner's own opencodeUnjailedEnv private dirs. Proves nothing
// from the operator's opencode/Claude config reaches the request and the session DB lands in
// ocData. Default: a throwaway HOME with every XDG dir inside it.
const unjailed = argv.includes('--unjailed');
const ocData = join(work, 'opencode-data');
mkdirSync(ocData);
const homeEnv = unjailed
  ? { HOME: process.env.HOME, ...oc.opencodeUnjailedEnv({ root: join(work, 'opencode-home'), ocData }) }
  : { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'),
    XDG_CACHE_HOME: join(home, '.cache'), XDG_STATE_HOME: join(home, '.local/state') };
const env = {
    ...homeEnv, PATH: `${join(bin, '..')}:/usr/bin:/bin`,
    OPENROUTER_API_KEY: 'sk-or-capture-dummy',
    OPENCODE_CONFIG: ocConfig,
    OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: String((2 * 300 + 120 + 60) * 1000),
    SS_READ_GUTTER: 'colon',
};
// The runner's preflight: the resolved config must list exactly the runner's own plugins.
const dbg = spawnSync(bin, ['debug', 'config'], { cwd: rundir, env, encoding: 'utf8', timeout: 60000 });
let preflight;
try {
  const clean = String(dbg.stdout).replace(/\u001b\[[0-9;]*m/g, '');
  const resolved = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
  preflight = { plugin: resolved.plugin, tools: resolved.tools,
    ok: oc.validateMainOpencodePreflight({ version: '1.18.4', resolved, plugins: trim.plugins }) };
} catch (error) { preflight = { error: error.message, stderr: String(dbg.stderr).slice(0, 300) }; }
writeFileSync(join(outDir, 'preflight.json'), JSON.stringify(preflight, null, 2));

const prompt = issuePrompt('The add function should also accept a third optional argument c.');
const args = ['run', '--format', 'json', '--agent', 'build', '--auto', '--model', `openrouter/${model}`, '--dir', rundir, prompt];
const r = spawnSync(bin, args, { cwd: rundir, env, encoding: 'utf8', timeout: 90000 });
console.error(`exit=${r.status} stderr=${String(r.stderr).slice(0, 300)}`);
const report = join(stateDir, oc.OPENCODE_TRIM_REPORT);
if (existsSync(report)) writeFileSync(join(outDir, 'trim-report.json'), readFileSync(report));
writeFileSync(join(outDir, 'config.json'), JSON.stringify({ ...config, provider: '<capture>' }, null, 2));
writeFileSync(join(outDir, 'stdout.ndjson'), String(r.stdout));
if (unjailed) {
  const paths = spawnSync(bin, ['debug', 'paths'], { cwd: rundir, env, encoding: 'utf8', timeout: 60000 });
  writeFileSync(join(outDir, 'unjailed-check.json'), JSON.stringify({
    debugPaths: String(paths.stdout).replaceAll(work, '<work>').replaceAll(process.env.HOME, '~'),
    ocData: readdirSync(ocData),
  }, null, 2));
}
if (argv.includes("--keep")) console.error(`kept ${work}`); else rmSync(work, { recursive: true, force: true });
console.log(readdirSync(outDir).join('\n'));
