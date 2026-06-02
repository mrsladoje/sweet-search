#!/usr/bin/env node
// 2x2 cell: bare-API harness × DeepSeek-V4-Pro. Isolates the MODEL (does DeepSeek follow the
// ss-* redirect in a hand-rolled API agent loop, vs the ~40% it showed in opencode?). Policy via
// systemAppend (the bare-API system prompt). Captures ss-engagement + escape. Routes DeepSeek via
// OpenRouter (OPENROUTER_API_KEY) — note: bare-API default reasoning (not "max"); ss-following is the signal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOpenRouterApiAgent } from '../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';
import { resolveRepoCwd, buildAgentUserPrompt } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;
const MODEL = process.env.MODEL || 'deepseek/deepseek-v4-pro';
const IDS = (process.env.IDS || 'java-007,go-002,cpp-006,python-004,csharp-002').split(',');
const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const byId = new Map((Array.isArray(vault) ? vault : vault.probes).map((p) => [p.id, p]));

const ABS = /\/Users\/admin\/Projects\/sweet-search-private[^\s"'`)]*/g;
const ANSWER = /(gold\/|data\/frozen|data\/results|p7-vault-probes|p7-heldout|p7-dev-probes|prompt-optimization\/data)/;
const cmdText = (c) => (typeof c?.input?.command === 'string' ? c.input.command : (c?.input?.file_path || JSON.stringify(c?.input || {})));
function analyze(calls, cwd) {
  let escape = 0, leak = 0;
  for (const c of calls) { const t = cmdText(c);
    if (ANSWER.test(t)) { leak++; continue; }
    let esc = false; for (const p of (t.match(ABS) || [])) if (!p.startsWith(cwd)) esc = true;
    const cd = t.match(/\bcd\s+(\/[^\s;&|]+)/); if (cd && !cd[1].startsWith(cwd)) esc = true;
    if (esc) escape++;
  }
  return { escape, leak };
}
const ssUsed = (calls) => calls.some((c) => /\bss-(search|find|semantic|trace|grep|read)\b/.test(cmdText(c)));

(async () => {
  console.error(`bare-API smoke: model=${MODEL} ids=${IDS.join(',')}`);
  for (const id of IDS) {
    const probe = byId.get(id); if (!probe) { console.error('no probe', id); continue; }
    const cwd = resolveRepoCwd(probe, {});
    for (const mode of ['native', 'mpp']) {
      let run;
      try {
        run = await runOpenRouterApiAgent({ model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: mode === 'mpp' ? MPP : NATIVE, cwd, sweetSearchBinDir: mode === 'mpp' ? SS_BIN : undefined, allowSweetSearch: mode === 'mpp', maxToolCalls: probe.max_turns || 12, timeoutMs: 300000 });
      } catch (e) { console.error(`[${mode}] ${id} ERROR ${e.message}`); continue; }
      const calls = run.toolCalls || [];
      const a = analyze(calls, cwd);
      console.error(`[${mode.padEnd(6)}] ${id.padEnd(11)} calls=${calls.length} ss=${ssUsed(calls)} ${(run.wallMs / 1000).toFixed(0)}s exit=${run.exitCode} escape=${a.escape} leak=${a.leak}${run.isError ? ' ERR:' + (run.stderrPreview || '').slice(0, 100) : ''}`);
    }
  }
})();
