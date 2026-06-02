#!/usr/bin/env node
/**
 * Discipline-safe judge validation for the bare-API × DeepSeek cell.
 * Runs DeepSeek-V4-Pro (native + M++, HIGH reasoning) on DEV probes (per-query inspectable;
 * never touches the vault), captures the FULL answer text + toolCalls, then scores it with each
 * of the 3 panel judges INDIVIDUALLY (exposing per-judge score + reasoning the median hides).
 * Answers the question: is DeepSeek's low vault accuracy genuine wrong-answers, or the judge
 * under-crediting its answer format? Prints answer vs expected{Files,Symbols,Facts} side by side.
 *   IDS=go-005,csharp-004 node scripts/validate-judge-deepseek.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runOpenRouterApiAgent } from '../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';
import { resolveRepoCwd, buildAgentUserPrompt, buildJudgeUserPrompt, parseJudgeScore, JUDGE_SYSTEM_PROMPT, JUDGE_PANEL } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runJudge } from '../eval/agent-read-workflows/judge-runner.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;
const MODEL = process.env.MODEL || 'deepseek/deepseek-v4-pro';
const MAXTOK = Number(process.env.MAXTOK || 16000);
const REASONING = process.env.REASONING || 'high';
const IDS = (process.env.IDS || 'go-005,csharp-004').split(',');

const dev = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const byId = new Map((Array.isArray(dev) ? dev : dev.probes).map((p) => [p.id, p]));
const prewarm = (cwd) => { try { spawnSync('ss-search', ['warmup', '-k', '1'], { cwd, env: { ...process.env, PATH: [SS_BIN, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd }, timeout: 180000, stdio: 'ignore' }); } catch {} };
const ssUsed = (calls) => calls.some((c) => /\bss-(search|find|semantic|trace|grep|read)\b/.test(typeof c?.input?.command === 'string' ? c.input.command : (c?.input?.file_path || '')));

async function judgeEach(probe, answer) {
  const userPrompt = buildJudgeUserPrompt({ probe, answer });
  const rows = [];
  for (const { lineage, model } of JUDGE_PANEL) {
    let score = null, text = '', err = null;
    try { const r = await runJudge({ lineage, model, systemPrompt: JUDGE_SYSTEM_PROMPT, userPrompt }); score = r.isError ? null : parseJudgeScore(r.text); text = r.text || ''; if (r.isError) err = r.error || 'judge-error'; }
    catch (e) { err = e.message; }
    rows.push({ model, score, text, err });
  }
  const valid = rows.filter((r) => typeof r.score === 'number').map((r) => r.score).sort((a, b) => a - b);
  const median = valid.length ? (valid.length % 2 ? valid[Math.floor(valid.length / 2)] : (valid[valid.length / 2 - 1] + valid[valid.length / 2]) / 2) : null;
  return { rows, median };
}

(async () => {
  for (const id of IDS) {
    const probe = byId.get(id);
    if (!probe) { console.log(`\n### ${id}: NOT a dev probe — skipping (discipline: dev-only inspection)`); continue; }
    const cwd = resolveRepoCwd(probe, {});
    console.log(`\n${'='.repeat(90)}\n### ${id} (${probe.language}, ${probe.repo}, ${probe.stratum})\nQUERY: ${probe.query}`);
    console.log(`EXPECTED files=${JSON.stringify(probe.expectedFiles)} symbols=${JSON.stringify(probe.expectedSymbols)}`);
    console.log(`EXPECTED facts: ${(probe.expectedFacts || []).join(' | ')}`);
    prewarm(cwd);
    for (const mode of ['native', 'mpp']) {
      let run;
      try { run = await runOpenRouterApiAgent({ model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: mode === 'mpp' ? MPP : NATIVE, cwd, sweetSearchBinDir: mode === 'mpp' ? SS_BIN : undefined, allowSweetSearch: mode === 'mpp', maxToolCalls: probe.max_turns || 12, reasoningEffort: REASONING, maxTokens: MAXTOK, maxReadLines: 2000, maxToolOutputChars: 64000, timeoutMs: 300000 }); }
      catch (e) { console.log(`\n[${mode}] AGENT ERROR: ${e.message}`); continue; }
      const calls = run.toolCalls || [];
      const answer = run.finalResultText || '';
      const { rows, median } = await judgeEach(probe, answer);
      console.log(`\n┌── [${mode.toUpperCase()}] calls=${calls.length} ss=${ssUsed(calls)} exit=${run.exitCode} usage=${JSON.stringify(run.usage)} isError=${run.isError} timedOut=${run.timedOut} → MEDIAN SCORE = ${median}`);
      console.log(`│ ANSWER (${answer.length} chars):\n${answer.split('\n').map((l) => '│   ' + l).join('\n').slice(0, 2200)}`);
      console.log(`│ PER-JUDGE:`);
      for (const r of rows) console.log(`│   ${r.model.padEnd(22)} score=${r.score}${r.err ? ' ERR:' + r.err : ''}  reason: ${(r.text || '').replace(/\s+/g, ' ').slice(0, 320)}`);
      console.log('└' + '─'.repeat(88));
    }
  }
})();
