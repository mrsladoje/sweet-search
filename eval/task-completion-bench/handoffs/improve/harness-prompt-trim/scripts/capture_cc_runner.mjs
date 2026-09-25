#!/usr/bin/env node
// $0 capture of the Claude Code request AS THE BENCH RUNNER BUILDS IT (sweet or native arm).
// No model is called: ANTHROPIC_BASE_URL points at capture_proxy.py, which saves the POST
// body and answers 400. A throwaway CLAUDE_CONFIG_DIR and a fake key keep the owner's login
// out of it.
//
//   python3 capture_proxy.py 18777 <outdir>/<variant> &
//   node capture_cc_runner.mjs --variant <name> --out <outdir> [--bin <claude>] [--arm sweet|native]
//
// Variants: shipped | deny15 | steer | trim | style-nocoding | exclude-dynamic
// --real-home: HOME is the operator's real home and CLAUDE_CONFIG_DIR a private dir — the
//   unjailed (Mac) runner shape; proves the operator's ~/.claude does not leak in.
// --env '<json object of extra env>'  --extra '<json array of extra CLI args>'  --project-settings '<json>' probe other mechanisms.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '../../../../../..');
const HARNESS = join(ROOT, 'eval/task-completion-bench/harness');
const { buildClaudeCliArgs, claudeHarnessTrim, excludeAncestorClaudeMd } = await import(join(HARNESS, 'claude-code-task-runner.mjs'));
const { writeInstructionFile, issuePrompt } = await import(join(HARNESS, 'agent-runner-shared.mjs'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const variant = opt('variant', 'shipped');
const arm = opt('arm', 'sweet');
const port = opt('port', '18777');
const bin = opt('bin', join(process.env.HOME, '.local/share/claude/versions/2.1.281'));
const outDir = opt('out');
if (!outDir) throw new Error('--out required');

const MPP = join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
const mppText = readFileSync(MPP, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const sweet = arm === 'sweet';

// A tiny git repo carrying exactly the files the runner injects.
// --rundir-parent <dir>: put the repo where the real runs put it (e.g. ~/.ss-eval/runs) so the
// ancestor CLAUDE.md walk sees what a Mac rollout sees; --exclude-ancestors applies the runner fix.
const work = mkdtempSync(join(opt('rundir-parent', tmpdir()), 'cc-capture-'));
const rundir = join(work, 'repo');
const home = join(work, 'home');
mkdirSync(rundir); mkdirSync(home);
writeFileSync(join(rundir, 'main.py'), 'def add(a, b):\n    return a + b\n');
execFileSync('git', ['init', '-q'], { cwd: rundir });
execFileSync('git', ['-c', 'user.email=c@c', '-c', 'user.name=c', 'add', '.'], { cwd: rundir });
execFileSync('git', ['-c', 'user.email=c@c', '-c', 'user.name=c', 'commit', '-qm', 'init'], { cwd: rundir });
writeInstructionFile(rundir, 'CLAUDE.md', { sweet: false, mppText });
if (sweet) {
  mkdirSync(join(rundir, '.claude/rules'), { recursive: true });
  writeFileSync(join(rundir, '.claude/rules/sweet-search.md'), `${mppText.trimEnd()}\n`);
}

const prompt = issuePrompt('The add function should also accept a third optional argument c.');
let args = buildClaudeCliArgs({ prompt, rundir, sweet, claudeModelId: 'claude-opus-5-5', effort: 'medium' });
// The runner's own trim switch, exactly as CC_HARNESS_TRIM applies it.
const trim = claudeHarnessTrim({ trim: '1', deny15: 'tools', steer: 'steer', max: 'max', lean: 'lean' }[variant] ?? '0');
args = [...args, ...trim.args];
if (variant === 'exclude-dynamic') args.push('--exclude-dynamic-system-prompt-sections');
const extra = opt('extra');
if (extra) args.push(...JSON.parse(extra));
const projectSettings = opt('project-settings');
const perm = opt('perm');
if (perm) args[args.indexOf('bypassPermissions')] = perm;
if (variant === 'style-nocoding') {
  mkdirSync(join(rundir, '.claude/output-styles'), { recursive: true });
  writeFileSync(join(rundir, '.claude/output-styles/probe.md'),
    '---\nname: probe\ndescription: probe\nkeep-coding-instructions: false\n---\n\nPROBE-STYLE-BODY\n');
  writeFileSync(join(rundir, '.claude/settings.json'), JSON.stringify({ outputStyle: 'probe' }, null, 2));
}
if (projectSettings) {
  mkdirSync(join(rundir, '.claude'), { recursive: true });
  writeFileSync(join(rundir, '.claude/settings.json'), projectSettings);
}

const realHome = argv.includes('--real-home');
if (argv.includes('--exclude-ancestors')) {
  mkdirSync(join(home, '.claude'), { recursive: true });
  excludeAncestorClaudeMd(join(home, '.claude', 'settings.json'), rundir);
}
const r = spawnSync(bin, args, {
  cwd: rundir,
  env: {
    HOME: realHome ? process.env.HOME : home, PATH: '/usr/bin:/bin', CLAUDE_CONFIG_DIR: join(home, '.claude'),
    ...trim.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    // --oauth: the subscription route the Opus legs use (CLAUDE_CODE_OAUTH_TOKEN), which
    // changes the request (tool list, cache TTL). Dummy values only; the proxy answers 400.
    ...(argv.includes('--oauth') ? { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-capture-dummy' } : { ANTHROPIC_API_KEY: 'sk-ant-capture-dummy' }),
    IS_SANDBOX: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    SS_READ_GUTTER: 'tab',
    ...JSON.parse(opt('env', '{}')),
  },
  encoding: 'utf8', timeout: 60000,
});
console.error(`exit=${r.status} stderr=${String(r.stderr).slice(0, 200)}`);
writeFileSync(join(outDir, 'args.json'), JSON.stringify(args.map(a => a === prompt ? '<prompt>' : a), null, 2));
rmSync(work, { recursive: true, force: true });
console.log(readdirSync(outDir).join('\n'));
