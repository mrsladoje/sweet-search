#!/usr/bin/env node
/**
 * Lean Claude Code vault batch runner — MANUAL, concurrency=1, clean wall-time.
 *
 * Each invocation runs the NEXT 5 vault probes as native×5 THEN M++×5, via Claude Code /
 * Opus-4.8-xhigh on the Claude Max subscription, with:
 *   - MCPs OFF                (--strict-mcp-config --mcp-config '{"mcpServers":{}}')
 *   - user hooks OFF          (--setting-sources project; probe repos have no project settings)
 *   - global + project CLAUDE.md moved aside for the batch so ONLY the injected policy loads
 *   - one run at a time (serial) → wall-time is contention-free
 * A cursor (cc-vault-state.json) persists so "the next 5" advances across runs;
 * 12 batches = 1 rep of all 60, 12 more = rep 2.
 *
 *   unset ANTHROPIC_API_KEY && node scripts/cc-batch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runClaudeAgent } from '../eval/agent-read-workflows/claude-runner.js';
import { resolveRepoCwd, buildAgentUserPrompt, classifyToolUse, judgePanelScore, JUDGE_PANEL } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE_POLICY = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, and reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;

const BATCH = Number(process.env.BATCH_SIZE || 5);
const THINK = process.env.THINK || '31999';            // Opus xhigh-equivalent thinking budget
const MODEL = process.env.MODEL || 'claude-opus-4-8';
const LEAN = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'project'];

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probes = Array.isArray(vault) ? vault : (vault.probes || []);
const RESULTS = path.join(REPO, 'core/prompt-optimization/data/results');
const STATE = path.join(RESULTS, 'cc-vault-state.json');
const GLOBAL_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md');
const PROJECT_MD = path.join(REPO, 'CLAUDE.md');
const BAK = '.ccbak';
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// CLAUDE.md suppression — move aside; restore is idempotent and crash-recoverable.
const suppressMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); };
const restoreMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); };
restoreMd(); // recover any leftover backup from a previously-crashed batch

const PR = { inPerM: 15, outPerM: 75 }; // Opus standard tier (verify) — cache-naive
const tin = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
const naive = (u) => (!u ? null : (tin(u) / 1e6) * PR.inPerM + ((u.output_tokens || 0) / 1e6) * PR.outPerM);

// Prewarm a repo's ss-* server (load embedding model + HNSW index ONCE, OFF the clock) so
// measured M++ wall-times reflect warm per-query latency, not a cold model+index load. Native
// (grep) has no model to load, so prewarming is what keeps the wall-time comparison fair.
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
  let score = null; try { ({ score } = await judgePanelScore({ probe, answer: text, panel: JUDGE_PANEL })); } catch { score = null; }
  const u = run.usage || null;
  return { id: probe.id, lang: probe.language, stratum: probe.stratum, rep, mode, model: MODEL, score, calls: calls.length, ss: !!tu.ss, nativeGrep: !!tu.nativeSearch, nativeRead: !!tu.nativeRead, wallMs: run.wallMs ?? null, usage: u, costUsd: naive(u), harnessCostUsd: run.totalCostUsd ?? null, exitCode: run.exitCode, timedOut: !!run.timedOut };
}

const append = (mode, rows) => { const d = path.join(RESULTS, mode === 'mpp' ? 'cc-vault-mpp' : 'cc-vault-native'); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, 'rows.json'); const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; fs.writeFileSync(f, JSON.stringify(prev.concat(rows), null, 2)); };

(async () => {
  delete process.env.ANTHROPIC_API_KEY; // force Claude Max subscription (OAuth), not API key
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { rep: 1, offset: 0 };
  if (state.offset >= probes.length) { state.rep += 1; state.offset = 0; }
  const batch = probes.slice(state.offset, state.offset + BATCH);
  console.error(`\n=== cc-batch: rep ${state.rep}, probes ${state.offset + 1}-${state.offset + batch.length}/${probes.length} | Opus-${MODEL} xhigh, conc=1, MCP off, hooks off, CLAUDE.md suppressed ===`);
  console.error('  ' + batch.map((p) => `${p.id}(${p.language})`).join(', '));
  const out = { native: [], mpp: [] };
  try {
    suppressMd();
    const repoCwds = [...new Set(batch.map((p) => resolveRepoCwd(p, {})))];
    console.error(`  prewarming ${repoCwds.length} ss-* server(s) (model+index, off the clock)...`);
    for (const cwd of repoCwds) prewarm(cwd);
    for (const mode of ['native', 'mpp']) {
      for (const probe of batch) {
        const row = await runOne(probe, mode, state.rep);
        out[mode].push(row);
        console.error(`  [${mode.padEnd(6)}] ${row.id.padEnd(15)} score=${row.score} calls=${String(row.calls).padEnd(2)} ss=${row.ss} ${row.wallMs != null ? (row.wallMs / 1000).toFixed(0) + 's' : '?'}${row.costUsd != null ? ' $' + row.costUsd.toFixed(3) : ''} exit=${row.exitCode}${row.timedOut ? ' TIMEOUT' : ''}`);
      }
    }
  } finally { restoreMd(); }
  append('native', out.native); append('mpp', out.mpp);
  state.offset += batch.length; fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  const sm = (rows, f) => mean(rows.map(f));
  console.log(`\n--- BATCH DONE (rep ${state.rep}, ${state.offset}/${probes.length} probes this rep) ---`);
  for (const [lbl, rows] of [['native', out.native], ['M++   ', out.mpp]]) {
    console.log(`  ${lbl}: acc=${sm(rows, (x) => x.score || 0).toFixed(3)} calls=${sm(rows, (x) => x.calls).toFixed(1)} wall=${sm(rows, (x) => (x.wallMs || 0) / 1000).toFixed(0)}s ss=${(100 * rows.filter((x) => x.ss).length / Math.max(1, rows.length)).toFixed(0)}% naive$=${sm(rows, (x) => x.costUsd || 0).toFixed(3)}${rows.some((x) => x.exitCode !== 0 || x.timedOut) ? '  ⚠ ERRORS' : ''}`);
  }
  const wN = sm(out.native, (x) => (x.wallMs || 0) / 1000), wM = sm(out.mpp, (x) => (x.wallMs || 0) / 1000);
  const cN = sm(out.native, (x) => x.calls), cM = sm(out.mpp, (x) => x.calls);
  console.log(`  → M++ vs native (this batch): calls ${cM.toFixed(1)} vs ${cN.toFixed(1)}; wall ${wM.toFixed(0)}s vs ${wN.toFixed(0)}s (${wM <= wN ? (100 * (1 - wM / Math.max(1e-9, wN))).toFixed(0) + '% FASTER' : (100 * (wM / wN - 1)).toFixed(0) + '% slower'})`);
  const wrap = state.offset >= probes.length;
  console.log(`  NEXT: rep ${wrap ? state.rep + 1 : state.rep}, probes ${wrap ? 1 : state.offset + 1}-${wrap ? Math.min(BATCH, probes.length) : Math.min(state.offset + BATCH, probes.length)} — say "next".`);
})();
