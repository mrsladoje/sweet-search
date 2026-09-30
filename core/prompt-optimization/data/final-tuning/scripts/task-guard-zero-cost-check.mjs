#!/usr/bin/env node
// $0 check for the task-bench wiring of SS_VARIANT_CC_RULES_IN_PROMPT (final-tuning V1).
// No model call, no docker run, no network: a FAKE `claude` on PATH records what the real task
// runner (runClaudeCodeTask, sweet arm, product lean harness) installed into the run dir and in
// the private Claude home, then exits.
//
// Three cases, same run dir path and run id in each (the memory path inside the agent file
// depends on them):
//   head-off   the runner as committed at HEAD (the unmodified code), switch unset
//   mod-off    the runner in the working tree, switch unset
//   mod-on     the runner in the working tree, SS_VARIANT_CC_RULES_IN_PROMPT=1
// PASS = head-off == mod-off byte for byte (files + argv + relevant env), and mod-on differs only
// as designed: no .claude/rules/sweet-search.md, and the main agent file carries the rules once.
//
//   node core/prompt-optimization/data/final-tuning/scripts/task-guard-zero-cost-check.mjs
// Run from the worktree. Needs no ss-* daemon and does not touch the Claude subscription token
// (a dummy token value is set so no real credentials file is read).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, chmodSync, copyFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const HARNESS = path.join(ROOT, 'eval/task-completion-bench/harness');
const RUNNER_REL = 'eval/task-completion-bench/harness/claude-code-task-runner.mjs';
const RUN_ID = 'zc-check';
const TASK_ID = 'zmap__zlint-299';

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p));
  }
  return out.sort();
}

// ---------------------------------------------------------------- child: one case
async function child() {
  const [, , , runnerPath, workDir, dumpDir] = process.argv;
  const { runClaudeCodeTask } = await import(pathToFileURL(runnerPath).href);
  const mppText = readFileSync(path.join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  const specs = JSON.parse(readFileSync(process.env.ZC_SPECS, 'utf8'));
  const t = (Array.isArray(specs) ? specs : specs.tasks).find(x => x.instance_id === TASK_ID);
  const rundir = path.join(workDir, 'rundir');
  rmSync(rundir, { recursive: true, force: true });
  mkdirSync(rundir, { recursive: true });
  writeFileSync(path.join(rundir, 'README.md'), 'fixture\n');
  for (const c of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-qm', 'base']]) execFileSync('git', c, { cwd: rundir });
  let row = null; let err = null;
  try {
    row = await runClaudeCodeTask({ id: TASK_ID, repoCheckout: rundir, problem_statement: 'fixture issue' }, {
      arm: 'sweet', apiModel: 'claude-opus-5-5', provider: 'anthropic', reasoning: 'medium',
      ssBinDir: undefined, mppText, image: t.image_name, t, perCallTimeoutMs: 30000,
    });
  } catch (e) { err = String(e.message || e).slice(0, 300); }
  // What `sweet-search init` would install for the same state (promptEdits = the shipped read6fs text,
  // same config dir and run dir), so the parent can compare the bench's agent file with the product's.
  try {
    const { installClaudeLeanHarness } = await import(pathToFileURL(path.join(ROOT, 'scripts/install-claude-lean-harness.js')).href);
    const { rolloutStateDir } = await import(pathToFileURL(path.join(HARNESS, 'agent-jail.mjs')).href);
    rmSync(path.join(rundir, '.claude'), { recursive: true, force: true });
    const home = rolloutStateDir(`${TASK_ID}-sweet`, 'claude-home');
    const res = installClaudeLeanHarness({ projectRoot: rundir, appendOverride: false, promptEdits: true, env: { ...process.env }, configDir: home, visibleConfigDir: home });
    if (res.active !== true) throw new Error(`product install not active: ${res.status} ${res.detail}`);
    copyFileSync(path.join(rundir, '.claude/agents/sweet-search.md'), path.join(dumpDir, 'product-agent.md'));
  } catch (e) { writeFileSync(path.join(dumpDir, 'product-agent.err'), String(e.message || e)); }
  writeFileSync(path.join(dumpDir, 'row-keys.json'), JSON.stringify({ err, keys: row ? Object.keys(row).sort() : null, ccRulesInPrompt: row?.ccRulesInPrompt ?? null, sweetRulesPlacement: row?.sweetRulesPlacement ?? null, harnessTrim: row?.harnessTrim ?? null }, null, 1));
}

// ---------------------------------------------------------------- parent
function runCase(name, runnerPath, switchValue, tmp, fakeBin, specs) {
  const dump = path.join(tmp, `dump-${name}`);
  const work = path.join(tmp, 'work'); // same path in every case: the agent file embeds the run dir slug
  mkdirSync(dump, { recursive: true }); mkdirSync(work, { recursive: true });
  rmSync(path.join(ROOT, 'eval/task-completion-bench/results', RUN_ID), { recursive: true, force: true });
  const env = { ...process.env };
  for (const k of ['SS_VARIANT_CC_RULES_IN_PROMPT', 'CC_HARNESS_TRIM', 'CC_TRIM_BATCH', 'SWEET_RULES_PLACEMENT', 'CC_PRODUCT_STEER', 'CC_PRODUCT_TOKREM', 'CC_PRODUCT_SKILLDESC', 'CC_PRODUCT_HOOKPLUG']) delete env[k];
  if (switchValue != null) env.SS_VARIANT_CC_RULES_IN_PROMPT = switchValue;
  Object.assign(env, {
    PATH: `${fakeBin}:${process.env.PATH}`, ZC_DUMP: dump, ZC_SPECS: specs, RUN_ID,
    SS_ISOLATION: '0', CLAUDE_CODE_OAUTH_TOKEN: 'dummy-not-a-token', NO_IMAGE_GC: '1',
  });
  delete env.ANTHROPIC_API_KEY;
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', runnerPath, work, dump], { env, encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) { console.error(`[${name}] child failed rc=${r.status}\n${r.stderr.slice(0, 800)}`); process.exit(2); }
  return dump;
}

// The operator's env reaches the agent (buildAgentEnv spreads process.env, as it does for every other
// CC_* bench switch), so the switch itself shows in env.txt when on. That line is the only expected
// env difference; drop it before comparing.
function readAll(dump) {
  const out = {};
  for (const rel of walk(dump)) if (rel.startsWith('call1/')) out[rel] = readFileSync(path.join(dump, rel), 'utf8');
  if (out['call1/env.txt'] !== undefined) out['call1/env.txt'] = out['call1/env.txt'].split('\n').filter(l => !l.startsWith('SS_VARIANT_CC_RULES_IN_PROMPT=')).join('\n');
  return out;
}

function main() {
  const specs = process.env.ZC_SPECS || '/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/results/confirm10/specs.json';
  if (!existsSync(specs)) { console.error(`no specs file ${specs} (set ZC_SPECS)`); process.exit(2); }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'zc-check-'));
  const fakeBin = path.join(tmp, 'fakebin'); mkdirSync(fakeBin);
  writeFileSync(path.join(fakeBin, 'claude'), `#!/bin/bash
D="$ZC_DUMP"; n=1; while [ -d "$D/call$n" ]; do n=$((n+1)); done
C="$D/call$n"; mkdir -p "$C"
[ "$1" = "--version" ] && { echo "2.1.281 (Claude Code)"; exit 0; }
cp -R .claude "$C/.claude" 2>/dev/null
cp CLAUDE.md "$C/CLAUDE.md" 2>/dev/null
[ -n "$CLAUDE_CONFIG_DIR" ] && cp "$CLAUDE_CONFIG_DIR/settings.json" "$C/home-settings.json" 2>/dev/null
for a in "$@"; do printf '%s\\n--ARG--\\n' "$a"; done > "$C/argv.txt"
env | grep -E '^(CLAUDE_CODE_(DISABLE|ENABLE|THRIFTY|TOTAL|SIMPLE)|CLAUDE_AUTOCOMPACT|DISABLE_|IS_SANDBOX|ENABLE_|SS_READ_GUTTER|SS_VARIANT|CC_)' | sort > "$C/env.txt"
cat >/dev/null
echo '{"type":"result","subtype":"success","is_error":false,"result":"fake","num_turns":0,"usage":{"input_tokens":0,"output_tokens":0}}'
`);
  chmodSync(path.join(fakeBin, 'claude'), 0o755);
  const headRunner = path.join(HARNESS, '.cc-runner-head-tmp.mjs');
  try {
    writeFileSync(headRunner, execFileSync('git', ['show', `HEAD:${RUNNER_REL}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }));
    const modRunner = path.join(ROOT, RUNNER_REL);
    const cases = {
      'head-off': runCase('head-off', headRunner, null, tmp, fakeBin, specs),
      'mod-off': runCase('mod-off', modRunner, null, tmp, fakeBin, specs),
      'mod-on': runCase('mod-on', modRunner, '1', tmp, fakeBin, specs),
    };
    const d = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, readAll(v)]));
    const rowInfo = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, JSON.parse(readFileSync(path.join(v, 'row-keys.json'), 'utf8'))]));
    let ok = true;
    const check = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!cond) ok = false; };

    const files = Object.keys(d['head-off']);
    check('fake claude was called and dumped files', files.length > 5, `${files.length} files in call1`);
    check('agent file present in head-off', 'call1/.claude/agents/sweet-search.md' in d['head-off']);
    check('rules file present in head-off (file placement)', 'call1/.claude/rules/sweet-search.md' in d['head-off']);

    const same = JSON.stringify(Object.keys(d['head-off'])) === JSON.stringify(Object.keys(d['mod-off']))
      && Object.keys(d['head-off']).every(k => d['head-off'][k] === d['mod-off'][k]);
    check('OFF: committed runner == working-tree runner, every installed file + argv + env byte-identical', same, `${files.length} files`);
    const diffs = Object.keys({ ...d['head-off'], ...d['mod-off'] }).filter(k => d['head-off'][k] !== d['mod-off'][k]);
    if (diffs.length) console.log(`       differing: ${diffs.join(', ')}`);
    check('OFF: row stamps unchanged (no ccRulesInPrompt key)', !rowInfo['mod-off'].keys?.includes('ccRulesInPrompt') && JSON.stringify(rowInfo['head-off'].keys) === JSON.stringify(rowInfo['mod-off'].keys), `row=${rowInfo['mod-off'].keys ? 'built' : 'not built: ' + rowInfo['mod-off'].err}`);

    const on = d['mod-on']; const off = d['mod-off'];
    const onOnly = Object.keys(on).filter(k => !(k in off)); const offOnly = Object.keys(off).filter(k => !(k in on));
    const changed = Object.keys(on).filter(k => k in off && on[k] !== off[k]);
    check('ON: only the rules file is removed', JSON.stringify(offOnly) === JSON.stringify(['call1/.claude/rules/sweet-search.md']) && onOnly.length === 0, `removed=${offOnly.join(',')} added=${onOnly.join(',') || '-'}`);
    check('ON: changed files are the main agent file and the harness manifest only', JSON.stringify(changed.sort()) === JSON.stringify(['call1/.claude/agents/sweet-search.md', 'call1/.claude/sweet-search-harness.json']), `changed=${changed.join(',')}`);
    const rules = readFileSync(path.join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trimEnd();
    const agentOn = on['call1/.claude/agents/sweet-search.md']; const agentOff = off['call1/.claude/agents/sweet-search.md'];
    check('ON: main agent file contains the rules text exactly once', agentOn.split(rules).length === 2);
    check('OFF: main agent file contains no rules text', !agentOff.includes(rules.slice(0, 200)));
    check('ON: agent file minus the rules block == OFF agent file (rest unchanged)', agentOn.replace(`${rules}\n\n`, '') === agentOff);
    check('ON: general-purpose + Plan agent files unchanged (they do NOT carry the rules)', on['call1/.claude/agents/general-purpose.md'] === off['call1/.claude/agents/general-purpose.md'] && on['call1/.claude/agents/Plan.md'] === off['call1/.claude/agents/Plan.md']);
    check('ON: CLAUDE.md (frame) identical', on['call1/CLAUDE.md'] === off['call1/CLAUDE.md']);
    check('ON: argv + env + settings identical', ['call1/argv.txt', 'call1/env.txt', 'call1/.claude/settings.json', 'call1/home-settings.json'].every(k => on[k] === off[k]));
    check('ON: rules text placed before the memory/session context section', agentOn.indexOf(rules) > 0 && agentOn.indexOf(rules) < agentOn.indexOf('# Session context'));
    check('ON: row stamped ccRulesInPrompt=true', rowInfo['mod-on'].ccRulesInPrompt === true || rowInfo['mod-on'].keys === null, rowInfo['mod-on'].keys ? '' : `row not built (${rowInfo['mod-on'].err}); stamp not checked`);
    const prod = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, existsSync(path.join(v, 'product-agent.md')) ? readFileSync(path.join(v, 'product-agent.md'), 'utf8') : null]));
    check('OFF: bench agent file == what the product installer writes (promptEdits true, switch unset)', prod['mod-off'] !== null && prod['mod-off'] === off['call1/.claude/agents/sweet-search.md'], prod['mod-off'] === null ? readFileSync(path.join(cases['mod-off'], 'product-agent.err'), 'utf8') : '');
    check('ON: bench agent file == what the product installer writes with the switch on', prod['mod-on'] !== null && prod['mod-on'] === agentOn, prod['mod-on'] === null ? readFileSync(path.join(cases['mod-on'], 'product-agent.err'), 'utf8') : '');
    console.log(`\nagent file bytes: off=${agentOff.length} on=${agentOn.length} (+${agentOn.length - agentOff.length}); rules file bytes off=${off['call1/.claude/rules/sweet-search.md'].length}`);
    console.log(`kept: ${tmp}`);
    console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL');
    process.exitCode = ok ? 0 : 1;
  } finally {
    rmSync(headRunner, { force: true });
    rmSync(path.join(ROOT, 'eval/task-completion-bench/results', RUN_ID), { recursive: true, force: true });
  }
}

if (process.argv[2] === '--child') await child(); else main();
