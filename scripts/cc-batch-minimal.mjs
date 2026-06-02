#!/usr/bin/env node
/**
 * MINIMAL-HARNESS Claude Code vault batch runner — a bare-API PROXY on the subscription.
 *
 * Same as cc-batch.mjs (Opus-4.8-xhigh, subscription, conc=1, prewarm, MCP/hooks off,
 * CLAUDE.md suppressed) EXCEPT the harness is stripped to a naive agent:
 *   - tools cut to Bash + Read only        (--tools Bash Read) → no native Grep/Glob/Edit;
 *     native arm is forced to `bash grep`/`cat` like a hand-rolled agent
 *   - policy injected as the system prompt  (--system-prompt, not CLAUDE.md) + trimmed
 *     (--exclude-dynamic-system-prompt-sections) → only an irreducible ~1-sentence Claude
 *     Agent SDK base remains. NOT literally bare-API (SDK base + Claude's tool defs differ),
 *     so label results "minimal-harness", a bare-API proxy.
 * Tests the inverse-efficiency law with Opus held constant, harness richness as the only
 * variable: full Claude Code gave M++ −18% calls; here native loses its Grep crutch, so M++
 * should win MORE. Separate cc-vault-min-* state/dirs (does not touch the full-CC vault data).
 *
 *   unset ANTHROPIC_API_KEY && node scripts/cc-batch-minimal.mjs
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
const THINK = process.env.THINK || '31999';
const MODEL = process.env.MODEL || 'claude-opus-4-8';
// Minimal harness: lean flags + restrict tools to Bash+Read + trim the dynamic prompt sections.
const LEAN_MIN = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'project', '--tools', 'Bash', 'Read', '--exclude-dynamic-system-prompt-sections'];

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probes = Array.isArray(vault) ? vault : (vault.probes || []);
const RESULTS = path.join(REPO, 'core/prompt-optimization/data/results');
const STATE = path.join(RESULTS, 'cc-vault-min-state.json');
const GLOBAL_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md');
const PROJECT_MD = path.join(REPO, 'CLAUDE.md');
const BAK = '.ccbak';
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// CLAUDE.md is still loaded as MEMORY regardless of --system-prompt, so suppress it (move aside)
// to keep the harness minimal. Restore is idempotent + crash-recoverable.
const suppressMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); };
const restoreMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); };
restoreMd();

const PR = { inPerM: 15, outPerM: 75 };
const tin = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
const naive = (u) => (!u ? null : (tin(u) / 1e6) * PR.inPerM + ((u.output_tokens || 0) / 1e6) * PR.outPerM);

function prewarm(cwd) {
  const env = { ...process.env, PATH: [SS_BIN, process.env.PATH].filter(Boolean).join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd };
  try { spawnSync('ss-search', ['warmup', '-k', '1'], { cwd, env, timeout: 180000, stdio: 'ignore' }); } catch { /* */ }
}

// Reap leaked ss-* servers + index-maintainers between batches. They accumulate (one per repo,
// never self-clean) and the maintainers poll/reconcile in a loop → CPU saturates and runs stall
// into timeouts (18 servers + 18 maintainers piled up and pushed one run to a 602s timeout).
// Reaping at each batch boundary keeps at most one batch's repos warm. Safe: matches only ss-* daemons.
function reapServers() {
  try { spawnSync('pkill', ['-f', 'core/cli\\.js'], { stdio: 'ignore' }); } catch { /* */ }
  try { spawnSync('pkill', ['-9', '-f', 'index-maintainer\\.mjs'], { stdio: 'ignore' }); } catch { /* */ }
}

async function runOne(probe, mode, rep) {
  const cwd = resolveRepoCwd(probe, {});
  const policy = mode === 'mpp' ? MPP : NATIVE_POLICY;
  process.env.MAX_THINKING_TOKENS = THINK;
  // policy goes in --system-prompt (replaces the user instructions); tools cut to Bash+Read.
  const run = await runClaudeAgent({ model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: '', cwd, projectRoot: cwd, extraPathEntries: mode === 'mpp' ? [SS_BIN] : [], addDirs: [cwd], extraArgs: [...LEAN_MIN, '--system-prompt', policy], timeoutMs: 180000 });
  const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
  const text = run.finalResultText || run.finalAssistantText || '';
  const tu = classifyToolUse(calls);
  let score = null; try { ({ score } = await judgePanelScore({ probe, answer: text, panel: JUDGE_PANEL })); } catch { score = null; }
  const u = run.usage || null;
  return { id: probe.id, lang: probe.language, stratum: probe.stratum, rep, mode, model: MODEL, harness: 'minimal', score, calls: calls.length, ss: !!tu.ss, nativeGrep: !!tu.nativeSearch, nativeRead: !!tu.nativeRead, wallMs: run.wallMs ?? null, usage: u, costUsd: naive(u), harnessCostUsd: run.totalCostUsd ?? null, exitCode: run.exitCode, timedOut: !!run.timedOut };
}

const append = (mode, rows) => { const d = path.join(RESULTS, mode === 'mpp' ? 'cc-vault-min-mpp' : 'cc-vault-min-native'); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, 'rows.json'); const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; fs.writeFileSync(f, JSON.stringify(prev.concat(rows), null, 2)); };

(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { rep: 1, offset: 0 };
  if (state.offset >= probes.length) { state.rep += 1; state.offset = 0; }
  const batch = probes.slice(state.offset, state.offset + BATCH);
  console.error(`\n=== cc-batch-MINIMAL: rep ${state.rep}, probes ${state.offset + 1}-${state.offset + batch.length}/${probes.length} | Opus-${MODEL} xhigh, conc=1, tools=Bash+Read, policy via --system-prompt, MCP/hooks/CLAUDE.md off ===`);
  console.error('  ' + batch.map((p) => `${p.id}(${p.language})`).join(', '));
  const out = { native: [], mpp: [] };
  try {
    suppressMd();
    reapServers(); // clear prior batches' leaked servers/maintainers before warming this batch's repos
    const repoCwds = [...new Set(batch.map((p) => resolveRepoCwd(p, {})))];
    console.error(`  prewarming ${repoCwds.length} ss-* server(s)...`);
    for (const cwd of repoCwds) prewarm(cwd);
    for (const mode of ['native', 'mpp']) {
      for (const probe of batch) {
        const row = await runOne(probe, mode, state.rep);
        out[mode].push(row);
        console.error(`  [${mode.padEnd(6)}] ${row.id.padEnd(15)} score=${row.score} calls=${String(row.calls).padEnd(2)} ss=${row.ss} nGrep=${row.nativeGrep} ${row.wallMs != null ? (row.wallMs / 1000).toFixed(0) + 's' : '?'}${row.costUsd != null ? ' $' + row.costUsd.toFixed(3) : ''} exit=${row.exitCode}${row.timedOut ? ' TIMEOUT' : ''}`);
      }
    }
  } finally { restoreMd(); reapServers(); }
  append('native', out.native); append('mpp', out.mpp);
  state.offset += batch.length; fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  const sm = (rows, f) => mean(rows.map(f));
  console.log(`\n--- MINIMAL BATCH DONE (rep ${state.rep}, ${state.offset}/${probes.length} probes this rep) ---`);
  for (const [lbl, rows] of [['native', out.native], ['M++   ', out.mpp]]) {
    console.log(`  ${lbl}: acc=${sm(rows, (x) => x.score || 0).toFixed(3)} calls=${sm(rows, (x) => x.calls).toFixed(1)} wall=${sm(rows, (x) => (x.wallMs || 0) / 1000).toFixed(0)}s ss=${(100 * rows.filter((x) => x.ss).length / Math.max(1, rows.length)).toFixed(0)}% nGrep=${(100 * rows.filter((x) => x.nativeGrep).length / Math.max(1, rows.length)).toFixed(0)}% naive$=${sm(rows, (x) => x.costUsd || 0).toFixed(3)}${rows.some((x) => x.exitCode !== 0 || x.timedOut) ? '  ⚠ ERRORS' : ''}`);
  }
  const cN = sm(out.native, (x) => x.calls), cM = sm(out.mpp, (x) => x.calls);
  console.log(`  → M++ vs native (this batch): calls ${cM.toFixed(1)} vs ${cN.toFixed(1)} (${cM <= cN ? (100 * (1 - cM / Math.max(1e-9, cN))).toFixed(0) + '% fewer' : '+' + (100 * (cM / cN - 1)).toFixed(0) + '%'})`);
  const wrap = state.offset >= probes.length;
  console.log(`  NEXT: rep ${wrap ? state.rep + 1 : state.rep}, probes ${wrap ? 1 : state.offset + 1}-${wrap ? Math.min(BATCH, probes.length) : Math.min(state.offset + BATCH, probes.length)}.`);
})();
