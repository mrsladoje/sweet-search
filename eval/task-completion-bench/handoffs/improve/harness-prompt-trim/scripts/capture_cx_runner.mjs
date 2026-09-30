#!/usr/bin/env node
// $0 capture of the codex exec request AS THE BENCH RUNNER BUILDS IT (sweet or native arm).
// No model is called: the bench's openrouter provider (codexBenchConfigToml, Responses API)
// points at capture_proxy.py, which saves the POST body and answers 400. A throwaway HOME and
// CODEX_HOME and a fake key keep the operator's ~/.codex (config, auth, AGENTS.md, skills) out.
//
//   python3 capture_proxy.py 18841 <outdir> &
//   node capture_cx_runner.mjs --out <outdir> --bin <codex 0.146.1> [--port 18841]
//        [--model openai/gpt-5.6-luna] [--arm sweet|native] [--trim 0|conflict|v3|1|default]
//        [--batch <CODEX_TRIM_BATCH>] [--placement file|system|config|default]
// `default` = the switch unset, as on a run that sets nothing: the product default since
// 2026-09-30 (conflict + yt3batch2, rules in developer_instructions). Without the flags the
// capture keeps its old meaning (trim 0, placement file).
//
// The argv is the runner's own (runCodexTask, unjailed, OpenRouter): codexInstructionFile into
// AGENTS.md, codexHarnessTrimArgs + codexRulesConfigArgs, the prompt on stdin (`exec -`).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '../../../../../..');
const HARNESS = join(ROOT, 'eval/task-completion-bench/harness');
const cx = await import(join(HARNESS, 'codex-task-runner.mjs'));
const { resolveSweetRulesPlacement } = await import(join(HARNESS, 'sweet-rules-placement.mjs'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const arm = opt('arm', 'sweet');
const apiModel = opt('model', 'openai/gpt-5.6-luna');
const port = opt('port', '18841');
const bin = opt('bin');
const outDir = opt('out');
if (!outDir || !bin) throw new Error('--out and --bin required');
const sweet = arm === 'sweet';

const MPP = join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
const mppText = readFileSync(MPP, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const placementOpt = opt('placement', 'file');
const placement = resolveSweetRulesPlacement({ sweet, harness: 'codex',
  env: placementOpt === 'default' ? {} : { SWEET_RULES_PLACEMENT: placementOpt } });

const work = mkdtempSync(join(tmpdir(), 'cx-capture-'));
const rundir = join(work, 'repo');
const home = join(work, 'home');
const codexHome = join(work, 'codex-home');
const stateDir = join(work, 'runner-state');
for (const d of [rundir, home, codexHome, stateDir]) mkdirSync(d);
writeFileSync(join(rundir, 'main.py'), 'def add(a, b):\n    return a + b\n');
execFileSync('git', ['init', '-q'], { cwd: rundir });
execFileSync('git', ['-c', 'user.email=c@c', '-c', 'user.name=c', 'add', '.'], { cwd: rundir });
execFileSync('git', ['-c', 'user.email=c@c', '-c', 'user.name=c', 'commit', '-qm', 'init'], { cwd: rundir });
writeFileSync(join(codexHome, 'config.toml'), cx.codexBenchConfigToml(`http://127.0.0.1:${port}/v1`));
appendFileSync(join(rundir, 'AGENTS.md'), `\n\n${cx.codexInstructionFile({ sweet, mppText, rulesPlacement: placement })}\n`);

// Same calls as runCodexTask (trim resolved from the switches, sweet arm only).
const batch = opt('batch', '');
if (batch) process.env.CODEX_TRIM_BATCH = batch; else delete process.env.CODEX_TRIM_BATCH;
const trimOpt = opt('trim', '0');
const trim = cx.codexHarnessTrim({ sweet, mode: trimOpt === 'default' ? undefined : trimOpt, model: apiModel });
const trimArgs = [...cx.codexHarnessTrimArgs(trim, stateDir, { rules: placement === 'system' ? mppText : null, model: apiModel }),
  ...cx.codexRulesConfigArgs(placement === 'config' ? mppText : null)];
const codexModel = apiModel.includes('/') ? apiModel : `openai/${apiModel}`;
const baseArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json',
  '-c', 'model_reasoning_effort="medium"', '-c', 'model_provider="openrouter"', ...trimArgs, '-m', codexModel, '-C', rundir];
const prompt = '=== ISSUE ===\nThe add function should also accept a third optional argument c.';
const inv = cx.codexPromptInvocation(baseArgs, prompt);
const env = { HOME: home, CODEX_HOME: codexHome, PATH: '/usr/bin:/bin', OPENROUTER_API_KEY: 'sk-or-capture-dummy' };
const r = spawnSync(bin, inv.argv, { cwd: rundir, env, encoding: 'utf8', timeout: 120000, input: inv.stdinText });
console.error(`exit=${r.status} stderr=${String(r.stderr).slice(0, 300)}`);

const scrub = s => String(s).replaceAll(work, '<work>').replaceAll(process.env.HOME, '~');
writeFileSync(join(outDir, 'argv.json'), scrub(JSON.stringify(inv.argv.map(a => (a.length > 400 ? `${a.slice(0, 200)}…<${a.length} chars>` : a)), null, 2)));
writeFileSync(join(outDir, 'stdout.ndjson'), scrub(r.stdout));
writeFileSync(join(outDir, 'rundir-status.txt'), execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: rundir, encoding: 'utf8' }));
writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ arm, model: apiModel, trim: trim.mode, trimOrigin: trim.origin ?? null, batch: trim.batch || null, placement,
  stateDirFiles: readdirSync(stateDir).sort() }, null, 2));
if (argv.includes('--keep')) console.error(`kept ${work}`); else rmSync(work, { recursive: true, force: true });
console.log(readdirSync(outDir).join('\n'));
