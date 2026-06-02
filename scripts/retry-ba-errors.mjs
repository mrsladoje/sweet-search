#!/usr/bin/env node
/**
 * Characterize the bare-API native exit=1 rows: transient (empty completions / infra → retry recovers)
 * vs persistent (genuine native give-up). Re-runs NATIVE only on the given vault probe ids, REPS times,
 * with the same corrected-runner config as ba-batch. Prints id/rep/exit/calls/score ONLY — no answer text
 * (held-out discipline: aggregate/score, never per-query vault answers).
 *   IDS=python-004,csharp-v60-01,javascript-v60-01,python-v60-01 REPS=2 node scripts/retry-ba-errors.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runOpenRouterApiAgent } from '../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';
import { resolveRepoCwd, buildAgentUserPrompt, judgePanelScore, JUDGE_PANEL } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const NATIVE = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;
const MODEL = process.env.MODEL || 'deepseek/deepseek-v4-pro';
const REPS = Number(process.env.REPS || 2);
const IDS = (process.env.IDS || '').split(',').filter(Boolean);
const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const byId = new Map((Array.isArray(vault) ? vault : vault.probes).map((p) => [p.id, p]));
const prewarm = (cwd) => { try { spawnSync('ss-search', ['warmup', '-k', '1'], { cwd, env: { ...process.env, PATH: [SS_BIN, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd }, timeout: 180000, stdio: 'ignore' }); } catch {} };

(async () => {
  console.log(`retry NATIVE: ${IDS.join(',')} x${REPS} reps | ${MODEL}`);
  for (const id of IDS) {
    const probe = byId.get(id);
    if (!probe) { console.log(`  ${id}: NOT in vault`); continue; }
    const cwd = resolveRepoCwd(probe, {});
    prewarm(cwd);
    for (let rep = 1; rep <= REPS; rep++) {
      let run, score = null;
      try { run = await runOpenRouterApiAgent({ model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: NATIVE, cwd, allowSweetSearch: false, maxToolCalls: probe.max_turns || 12, reasoningEffort: 'high', maxTokens: 32000, maxReadLines: 2000, maxToolOutputChars: 64000, timeoutMs: 300000 }); }
      catch (e) { console.log(`  ${id.padEnd(20)} rep${rep} AGENT-THROW ${e.message}`); continue; }
      const empty = !(run.finalResultText || '').trim();
      try { ({ score } = await judgePanelScore({ probe, answer: run.finalResultText || '', panel: JUDGE_PANEL })); } catch { score = null; }
      console.log(`  ${id.padEnd(20)} rep${rep} exit=${run.exitCode} calls=${(run.toolCalls||[]).length} answerLen=${(run.finalResultText||'').length} empty=${empty} score=${score} ${run.stderrPreview ? 'stderr:'+run.stderrPreview.slice(0,50) : ''}`);
    }
  }
})();
