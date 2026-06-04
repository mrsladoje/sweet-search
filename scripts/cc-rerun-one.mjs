#!/usr/bin/env node
/**
 * Surgical single-probe re-runner for the Claude Code vault cells — mirrors cc-batch.mjs
 * `runOne` VERBATIM (same lean args, M++/native policy as CLAUDE.md, prewarm, 3-panel judge,
 * family-keyed pricing, subscription auth) and REPLACES the one matching row in
 * cc-vault${SUFFIX}-${MODE}/rows.json in place. For recovering a row that died to a harness
 * stall (e.g. laptop sleep → SIGTERM timeout), NOT for re-rolling a legitimately-scored run.
 *
 *   PROBE_ID=scala-v60-03 MODE=mpp MODEL=claude-sonnet-4-6 THINK=10000 SUFFIX=-sonnet-med \
 *     node scripts/cc-rerun-one.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runClaudeAgent } from '../eval/agent-read-workflows/claude-runner.js';
import { resolveRepoCwd, buildAgentUserPrompt, classifyToolUse, judgePanelScore, JUDGE_PANEL } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { buildArmResponse, normalizeClaudeCalls, scoreUsdInline, persistCapture } from '../core/prompt-optimization/sweep/usd-capture.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE_POLICY = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, and reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;

const PROBE_ID = process.env.PROBE_ID;
const MODE = process.env.MODE || 'mpp';
const THINK = process.env.THINK || '10000';
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';
const REP = process.env.REP ? Number(process.env.REP) : null; // null = match any rep
if (!PROBE_ID) { console.error('PROBE_ID env required'); process.exit(2); }
const FAMILY = /opus/i.test(MODEL) ? 'opus' : /sonnet/i.test(MODEL) ? 'sonnet' : /haiku/i.test(MODEL) ? 'haiku' : 'other';
const SUFFIX = process.env.SUFFIX ?? (FAMILY === 'opus' ? '' : `-${FAMILY}`);
const LEAN = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'project'];

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probes = Array.isArray(vault) ? vault : (vault.probes || []);
const probe = probes.find((p) => p.id === PROBE_ID);
if (!probe) { console.error(`probe ${PROBE_ID} not in vault`); process.exit(2); }
const RESULTS = path.join(REPO, 'core/prompt-optimization/data/results');
const GLOBAL_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md');
const PROJECT_MD = path.join(REPO, 'CLAUDE.md');
const BAK = '.ccbak';
const suppressMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); };
const restoreMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); };
restoreMd();

const PR = ({ opus: { inPerM: 15, outPerM: 75 }, sonnet: { inPerM: 3, outPerM: 15 }, haiku: { inPerM: 1, outPerM: 5 } }[FAMILY]) || { inPerM: 15, outPerM: 75 };
const tin = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
const naive = (u) => (!u ? null : (tin(u) / 1e6) * PR.inPerM + ((u.output_tokens || 0) / 1e6) * PR.outPerM);

function prewarm(cwd) {
  const env = { ...process.env, PATH: [SS_BIN, process.env.PATH].filter(Boolean).join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd };
  try { spawnSync('ss-search', ['warmup', '-k', '1'], { cwd, env, timeout: 180000, stdio: 'ignore' }); } catch { /* */ }
}

async function runOne(probe, mode, rep) {
  const cwd = resolveRepoCwd(probe, {});
  const md = path.join(cwd, 'CLAUDE.md');
  const had = fs.existsSync(md); const bak = had ? fs.readFileSync(md) : null;
  fs.writeFileSync(md, mode === 'mpp' ? MPP : NATIVE_POLICY);
  process.env.MAX_THINKING_TOKENS = THINK;
  let run;
  try {
    run = await runClaudeAgent({ model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: '', cwd, projectRoot: cwd, extraPathEntries: mode === 'mpp' ? [SS_BIN] : [], addDirs: [cwd], extraArgs: LEAN, timeoutMs: 600000 });
  } finally { if (had) fs.writeFileSync(md, bak); else { try { fs.unlinkSync(md); } catch { /* */ } } }
  const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
  const text = run.finalResultText || run.finalAssistantText || '';
  const tu = classifyToolUse(calls);
  const arm = mode === 'mpp' ? 'ss' : 'native';
  const normCalls = normalizeClaudeCalls(calls, run.toolResults);
  const rawResponse = buildArmResponse(normCalls, arm);
  persistCapture(path.join(RESULTS, `cc-vault${SUFFIX}-captures`), { probeId: probe.id, arm, rep, model: MODEL, harness: 'claude-code', rawResponse, finalAnswer: text, toolCalls: normCalls });
  const [score, usd] = await Promise.all([
    judgePanelScore({ probe, answer: text, panel: JUDGE_PANEL }).then((x) => x.score).catch(() => null),
    scoreUsdInline(probe, rawResponse, arm),
  ]);
  const u = run.usage || null;
  return { id: probe.id, lang: probe.language, stratum: probe.stratum, rep, mode, model: MODEL, harness: 'claude-code', score, ...usd, rawLen: rawResponse.length, calls: calls.length, ss: !!tu.ss, nativeGrep: !!tu.nativeSearch, nativeRead: !!tu.nativeRead, wallMs: run.wallMs ?? null, usage: u, costUsd: naive(u), harnessCostUsd: run.totalCostUsd ?? null, exitCode: run.exitCode, timedOut: !!run.timedOut };
}

(async () => {
  delete process.env.ANTHROPIC_API_KEY; // subscription OAuth, not API key
  const dir = path.join(RESULTS, `cc-vault${SUFFIX}-${MODE === 'mpp' ? 'mpp' : 'native'}`);
  const f = path.join(dir, 'rows.json');
  const rows = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  const matches = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.id === PROBE_ID && r.mode === MODE && (REP == null || r.rep === REP));
  if (matches.length !== 1) { console.error(`expected exactly 1 matching row, found ${matches.length} (id=${PROBE_ID} mode=${MODE} rep=${REP ?? 'any'}). Refusing to guess.`); process.exit(2); }
  const { r: old, i: idx } = matches[0];
  console.error(`OLD row: id=${old.id} mode=${old.mode} rep=${old.rep} score=${old.score} exit=${old.exitCode} timedOut=${old.timedOut} wall=${Math.round((old.wallMs || 0) / 1000)}s`);
  if (!(old.timedOut || old.exitCode !== 0 || old.score == null) && process.env.FORCE !== '1') {
    console.error('OLD row looks VALID (not a stall). Set FORCE=1 to overwrite a good row. Refusing.'); process.exit(3);
  }

  const cwd = resolveRepoCwd(probe, {});
  try {
    suppressMd();
    spawnSync('pkill', ['-f', 'core/cli\\.js'], { stdio: 'ignore' });
    spawnSync('pkill', ['-9', '-f', 'index-maintainer\\.mjs'], { stdio: 'ignore' });
    console.error(`prewarming ${cwd} ...`);
    prewarm(cwd);
    console.error(`re-running ${PROBE_ID} ${MODE} via Claude Code (${MODEL} think=${THINK}) ...`);
    const row = await runOne(probe, MODE, old.rep);
    console.error(`NEW row: score=${row.score} calls=${row.calls} ss=${row.ss} wall=${Math.round((row.wallMs || 0) / 1000)}s naive$=${row.costUsd != null ? row.costUsd.toFixed(3) : '?'} exit=${row.exitCode} timedOut=${row.timedOut}`);
    if (row.timedOut || row.exitCode !== 0 || row.score == null) {
      console.error('NEW row ALSO failed — leaving the file UNCHANGED so nothing is corrupted.'); process.exit(4);
    }
    rows[idx] = row;
    fs.writeFileSync(f, JSON.stringify(rows, null, 2));
    console.error(`REPLACED row ${idx} in ${path.relative(REPO, f)}.`);
  } finally { restoreMd(); spawnSync('pkill', ['-f', 'core/cli\\.js'], { stdio: 'ignore' }); spawnSync('pkill', ['-9', '-f', 'index-maintainer\\.mjs'], { stdio: 'ignore' }); }
})();
