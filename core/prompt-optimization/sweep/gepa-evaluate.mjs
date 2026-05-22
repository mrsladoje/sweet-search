/**
 * Phase 7 — the agent-evaluation seam (the crux of the GEPA loop).
 *
 * `makeRealEvaluateCandidate` returns the DEFAULT `evaluateCandidate`
 * implementation that the live run uses. It is INJECTABLE: unit tests and
 * `--dry-run` pass a deterministic stub instead, so neither needs network.
 *
 * Contract (honored by both the real impl and any stub):
 *   evaluateCandidate({ promptText, probe, target }) → {
 *     score,               // 3-judge-panel correctness in [0,1]
 *     toolCalls,           // integer count (EAS call-window math)
 *     finalAnswerEmitted,  // bool
 *     usedReadOrGrep,      // bool — any read/grep/trace/search tool call
 *     trajectory,          // { toolCalls:[{name,input}], answer } (OP-2 input)
 *     wallMs,
 *   }
 *
 * Real wiring (do NOT reinvent — reuse the P6 harness):
 *   - target 'sonnet' → claude-runner.runClaudeAgent (sweet-search tools on PATH)
 *   - target 'gpt5_5' → codex exec agent (GPT-5.5-INSTANT tier, non-reasoning)
 *   - correctness    → 3-judge panel via judge-runner.runJudge:
 *       deepseek-v4-flash (deepseek-api) + gemini-3.1-flash-lite (google-api)
 *       + minimax m2.7 (minimax)
 *
 * INTEGRATION CAVEATS honored here (task #8 notes):
 *   - The in-loop gpt5_5 target is GPT-5.5-**instant** (non-reasoning) run via
 *     the codex CLI — it does NOT touch the temp=0 shared OpenAI builder, so the
 *     "reasoning runner needs temperature=1 + max_completion_tokens" caveat does
 *     not apply to this path. The reasoning-class gate is p7-reasoning-homp.mjs;
 *     `buildGpt5ReasoningPayload` below is the ONLY reasoning builder and obeys
 *     temperature=1 + max_completion_tokens (never reuse buildOpenAIPayload for it).
 *   - Judges run at temperature=0 (deterministic), the correct setting for
 *     scoring — not the reasoning path.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runClaudeAgent } from '../../../eval/agent-read-workflows/claude-runner.js';
import { runJudge, _internal as judgeInternal } from '../../../eval/agent-read-workflows/judge-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** sweet-search tool names exposed to the agent (kept as Bash-shim CLI calls). */
export const SWEET_SEARCH_TOOLS = ['Bash', 'Read'];

/** Default 3-judge correctness panel (§3.1 step 3 / §7.4 judge_panel). */
export const JUDGE_PANEL = Object.freeze([
  { lineage: 'deepseek-api', model: 'deepseek-v4-flash' },
  { lineage: 'google-api', model: 'gemini-3.1-flash-lite' },
  { lineage: 'minimax', model: 'abab6.5s-chat' }, // MiniMax M2.7 family
]);

// ─── agent user-prompt + judge prompt builders ──────────────────────────────

/** The task handed to the agent. The candidate prompt is the SYSTEM prompt. */
export function buildAgentUserPrompt(probe) {
  return (
    `Task: ${probe.query}\n\n` +
    `Use the sweet-search tools to locate the answer in this repository, then ` +
    `respond in the requested agent format. Stay within ${probe.max_turns} tool calls.`
  );
}

export const JUDGE_SYSTEM_PROMPT =
  'You are a strict grader for an agentic code-search answer. Given the user ' +
  'query, the gold expectations (expected files / symbols / facts, or an ' +
  'expected no-match), and the agent answer, score correctness in [0,1]. ' +
  'Reward answers that cite the expected files/symbols and state the expected ' +
  'facts; penalize hallucinated or unsupported claims. For an expected ' +
  'no-match, reward a correct "no match found" conclusion. Respond with ONLY a ' +
  'JSON object: {"score": <0..1>, "reason": "<one sentence>"}.';

export function buildJudgeUserPrompt({ probe, answer }) {
  const gold = probe.expectedNoMatch
    ? 'EXPECTED: no match exists in this repository.'
    : `EXPECTED FILES: ${JSON.stringify(probe.expectedFiles ?? [])}\n` +
      `EXPECTED SYMBOLS: ${JSON.stringify(probe.expectedSymbols ?? [])}\n` +
      `EXPECTED FACTS: ${JSON.stringify(probe.expectedFacts ?? [])}`;
  return `## Query\n${probe.query}\n\n## Gold\n${gold}\n\n## Agent answer\n${answer || '(empty)'}\n\nScore:`;
}

/** Parse a {"score": x} JSON verdict out of a judge reply; clamp to [0,1]. */
export function parseJudgeScore(text) {
  if (typeof text !== 'string' || !text) return null;
  const fenced = [...text.matchAll(/\{[^{}]*"score"[^{}]*\}/g)];
  for (let i = fenced.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(fenced[i][0]);
      if (typeof obj.score === 'number' && Number.isFinite(obj.score)) {
        return Math.min(1, Math.max(0, obj.score));
      }
    } catch { /* try previous */ }
  }
  const m = text.match(/"?score"?\s*[:=]\s*(0?\.\d+|1(?:\.0+)?|0)/i);
  if (m) return Math.min(1, Math.max(0, Number.parseFloat(m[1])));
  return null;
}

/** Median of the panel judges' scores (robust to one judge outlier/failure). */
export async function judgePanelScore({ probe, answer, panel = JUDGE_PANEL, runJudgeFn = runJudge }) {
  const userPrompt = buildJudgeUserPrompt({ probe, answer });
  const verdicts = await Promise.all(
    panel.map(async ({ lineage, model }) => {
      const r = await runJudgeFn({ lineage, model, systemPrompt: JUDGE_SYSTEM_PROMPT, userPrompt });
      return r.isError ? null : parseJudgeScore(r.text);
    }),
  );
  const valid = verdicts.filter((v) => typeof v === 'number');
  if (valid.length === 0) return 0;
  valid.sort((a, b) => a - b);
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

// ─── codex agent (GPT-5.5-instant) ──────────────────────────────────────────

/**
 * Minimal codex-exec agent runner for the gpt5_5 target. Mirrors the
 * runClaudeAgent contract (tool-call capture + final text). Codex's --json
 * event schema has shifted across versions; the parser is defensive but you
 * MUST verify it against the live codex build before the real run.
 */
export async function runCodexAgent({ prompt, systemAppend, model, cwd, sweetSearchBinDir, timeoutMs = 240000 }) {
  const { spawn } = await import('node:child_process');
  const merged = systemAppend ? `[SYSTEM]\n${systemAppend}\n\n[USER]\n${prompt}` : prompt;
  const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json'];
  if (model) args.push('-m', model);
  args.push(merged);
  const env = { ...process.env };
  if (sweetSearchBinDir) env.PATH = [sweetSearchBinDir, env.PATH].filter(Boolean).join(':');
  if (cwd) env.SWEET_SEARCH_PROJECT_ROOT = cwd;

  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const proc = spawn('codex', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch { /* */ }
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* */ } }, 2000).unref();
    }, timeoutMs);
    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ stdout, stderr: stderr + err.message, exitCode: -1, timedOut }); });
    proc.on('exit', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 0, timedOut }); });
  });

  const { toolCalls, answer } = parseCodexAgentStream(r.stdout);
  return {
    toolCalls,
    finalResultText: answer,
    finalAssistantText: answer,
    wallMs: Date.now() - t0,
    isError: r.exitCode !== 0 || r.timedOut,
    exitCode: r.exitCode,
  };
}

/** Parse codex --json JSONL for tool calls + the final assistant text. */
export function parseCodexAgentStream(stdout) {
  const toolCalls = [];
  let answer = '';
  if (!stdout) return { toolCalls, answer };
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    const type = ev.type || ev.msg?.type;
    if (type && /function_call|tool_call|command|exec/i.test(type)) {
      toolCalls.push({ name: ev.name || ev.tool || ev.command || 'tool', input: ev.arguments || ev.input || ev.command || {} });
    }
    const cand = ev.text || ev.message || ev.content || ev.assistant_message || ev.final_response || (ev.delta && ev.delta.text) || '';
    if (typeof cand === 'string' && cand) answer = cand;
    else if (Array.isArray(cand)) {
      const txt = cand.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
      if (txt) answer = txt;
    }
  }
  return { toolCalls, answer };
}

// ─── the default real evaluateCandidate factory ─────────────────────────────

const SS_TOOL_RE = /ss-(read|grep|trace|semantic|find|search)|\bRead\b|\bGrep\b/i;

/**
 * Build the live `evaluateCandidate`. The returned function is what the loop
 * calls per (candidate, probe, target). Token-bucket gating is handled by the
 * caller (gepa.mjs threads `bucket` into scoreCandidateOnProbes).
 *
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]          — repo root (default: this repo)
 * @param {string} [opts.reposDir]          — where probe repos live (default eval/repos)
 * @param {string} [opts.sweetSearchBinDir] — dir to prepend to PATH for the ss-* shim
 * @param {{sonnet:string,gpt5_5:string}} [opts.models]
 * @param {Array<{lineage,model}>} [opts.judgePanel]
 * @param {Function} [opts.runJudgeFn]      — override for tests
 * @param {number} [opts.timeoutMs]
 */
export function makeRealEvaluateCandidate({
  repoRoot = REPO_ROOT,
  reposDir = path.join(REPO_ROOT, 'eval', 'repos'),
  sweetSearchBinDir = path.join(REPO_ROOT, 'eval', 'agent-read-workflows', 'bin'),
  models = { sonnet: 'claude-sonnet-4-6', gpt5_5: 'gpt-5.5-instant' },
  judgePanel = JUDGE_PANEL,
  runJudgeFn = runJudge,
  timeoutMs = 240000,
} = {}) {
  return async function evaluateCandidate({ promptText, probe, target }) {
    const repoCwd = path.join(reposDir, probe.repo);
    let run;
    if (target === 'sonnet') {
      run = await runClaudeAgent({
        prompt: buildAgentUserPrompt(probe),
        systemAppend: promptText,
        model: models.sonnet,
        cwd: repoCwd,
        allowedTools: SWEET_SEARCH_TOOLS,
        addDirs: [repoCwd],
        extraPathEntries: [sweetSearchBinDir],
        projectRoot: repoCwd,
        timeoutMs,
      });
    } else {
      run = await runCodexAgent({
        prompt: buildAgentUserPrompt(probe),
        systemAppend: promptText,
        model: models.gpt5_5,
        cwd: repoCwd,
        sweetSearchBinDir,
        timeoutMs,
      });
    }

    const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
    const finalText = run.finalResultText || run.finalAssistantText || '';
    const score = await judgePanelScore({ probe, answer: finalText, panel: judgePanel, runJudgeFn });

    return {
      score,
      toolCalls: calls.length,
      finalAnswerEmitted: finalText.trim().length > 0,
      usedReadOrGrep: calls.some((tc) => SS_TOOL_RE.test(tc.name || '')),
      trajectory: { toolCalls: calls.map((t) => ({ name: t.name, input: t.input })), answer: finalText.slice(0, 2000) },
      wallMs: run.wallMs ?? 0,
    };
  };
}

// ─── reasoning-class payload (caveat-honoring; NOT used by the in-loop path) ──

/**
 * Reasoning-class GPT-5.5 payload builder. Honors task #8 caveat: the reasoning
 * tier requires temperature=1 + max_completion_tokens — NEVER reuse the temp=0
 * `buildOpenAIPayload` for it. The in-loop target uses instant/codex, so this is
 * only for any reasoning-mode replay (cf. §3.5.2 / p7-reasoning-homp.mjs).
 */
export function buildGpt5ReasoningPayload({ model = 'gpt-5.5', systemPrompt, userPrompt, maxCompletionTokens = 8000 }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  return {
    model,
    messages,
    temperature: 1, // reasoning class: temperature MUST be 1
    max_completion_tokens: maxCompletionTokens, // NOT max_tokens
    stream: false,
  };
}

export const _internal = { judgeInternal };
