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

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runClaudeAgent } from '../../../eval/agent-read-workflows/claude-runner.js';
import { runJudge, _internal as judgeInternal } from '../../../eval/agent-read-workflows/judge-runner.js';
import { hashContent } from './p7-shared.mjs';
import { estimateTokens } from './variant-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Thrown by `judgePanelScore` (B6) when EVERY panelist errors after the
 * judge-runner's internal retries are exhausted. A 0 here would be
 * indistinguishable from a real unanimous-wrong verdict and would silently
 * corrupt maximin / Pareto selection on a $470 run — so we fail loudly and let
 * `scoreCandidateOnProbes` propagate, keeping the run resumable. Carries the
 * per-judge errors for forensic logging.
 */
export class AllJudgesFailedError extends Error {
  /** @param {Array<{model:string,lineage:string,error:string}>} judgeErrors */
  constructor(judgeErrors = []) {
    super(`all ${judgeErrors.length} judge(s) failed after retries`);
    this.name = 'AllJudgesFailedError';
    this.judgeErrors = judgeErrors;
  }
}

/**
 * Normalize a runJudge result's provider-specific `raw.usage` into the canonical
 * `{ input_tokens, output_tokens }` pair (null where unavailable). Handles:
 *   - deepseek / openai-compatible: { prompt_tokens, completion_tokens }
 *   - gemini:                       usageMetadata { promptTokenCount, candidatesTokenCount }
 *   - anthropic:                    { input_tokens, output_tokens }
 *
 * @param {object} usage  — result.raw.usage (any of the shapes above) or null
 * @returns {{ input_tokens: number|null, output_tokens: number|null }}
 */
export function normalizeJudgeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { input_tokens: null, output_tokens: null };
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // anthropic-style takes priority (explicit input_tokens/output_tokens).
  if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
    return { input_tokens: num(usage.input_tokens), output_tokens: num(usage.output_tokens) };
  }
  // deepseek / openai-compatible chat-completions usage.
  if (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) {
    return { input_tokens: num(usage.prompt_tokens), output_tokens: num(usage.completion_tokens) };
  }
  // gemini usageMetadata.
  if (usage.promptTokenCount !== undefined || usage.candidatesTokenCount !== undefined) {
    return { input_tokens: num(usage.promptTokenCount), output_tokens: num(usage.candidatesTokenCount) };
  }
  return { input_tokens: null, output_tokens: null };
}

/**
 * Best-effort `git rev-parse HEAD` for a repo dir, memoized per-dir in a module
 * Map (CC1 `repo_commit`). Returns null on any failure (not a git repo, git
 * unavailable, etc.) — the metadata is forensic, never load-bearing.
 */
const _repoCommitCache = new Map();
export function repoCommitFor(repoCwd) {
  if (typeof repoCwd !== 'string' || repoCwd.length === 0) return null;
  if (_repoCommitCache.has(repoCwd)) return _repoCommitCache.get(repoCwd);
  let commit = null;
  try {
    commit = execFileSync('git', ['-C', repoCwd, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    commit = null;
  }
  _repoCommitCache.set(repoCwd, commit);
  return commit;
}

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

/**
 * Median of the panel judges' scores (robust to one judge outlier/failure),
 * plus the per-judge usage metadata the CONFIRM-event writer needs (CC1).
 *
 * Returns `{ score, judges }`:
 *   - `score`  — median of the valid (non-errored) verdicts in [0,1]
 *   - `judges` — one normalized entry per panelist:
 *       { model, lineage, input_tokens, output_tokens, retry_count, isError }
 *     (token fields normalized from the provider-specific raw.usage shapes via
 *     `normalizeJudgeUsage`; null where unavailable).
 *
 * B6: when EVERY panelist errors (after runJudge's internal 429/5xx/empty-200
 * retries), this THROWS `AllJudgesFailedError` rather than coercing the score to
 * 0. A 0 is indistinguishable from a real unanimous-wrong verdict and would
 * corrupt maximin / Pareto selection; `scoreCandidateOnProbes` propagates the
 * throw so a $470 run fails loudly and stays resumable.
 *
 * CC3 (optional seam): if `judgeBucket` is provided, `await judgeBucket.acquire`
 * is called before each runJudge call. Default undefined = ungated (runJudge's
 * retry wrapper already absorbs transient judge 429s).
 *
 * @returns {Promise<{ score: number, judges: object[] }>}
 */
export async function judgePanelScore({ probe, answer, panel = JUDGE_PANEL, runJudgeFn = runJudge, judgeBucket }) {
  const userPrompt = buildJudgeUserPrompt({ probe, answer });
  const results = await Promise.all(
    panel.map(async ({ lineage, model }) => {
      if (judgeBucket && typeof judgeBucket.acquire === 'function') {
        await judgeBucket.acquire({ target: `${lineage}:${model}` });
      }
      const r = await runJudgeFn({ lineage, model, systemPrompt: JUDGE_SYSTEM_PROMPT, userPrompt });
      const usage = normalizeJudgeUsage(r.raw?.usage);
      return {
        lineage,
        model,
        score: r.isError ? null : parseJudgeScore(r.text),
        isError: !!r.isError,
        error: r.isError ? (r.error || 'judge-error') : undefined,
        retryCount: typeof r.retryCount === 'number' ? r.retryCount : null,
        usage,
      };
    }),
  );

  const judges = results.map((j) => ({
    model: j.model,
    lineage: j.lineage,
    input_tokens: j.usage.input_tokens,
    output_tokens: j.usage.output_tokens,
    retry_count: j.retryCount,
    isError: j.isError,
  }));

  const valid = results.filter((j) => typeof j.score === 'number').map((j) => j.score);
  if (valid.length === 0) {
    throw new AllJudgesFailedError(
      results.map((j) => ({ model: j.model, lineage: j.lineage, error: j.error || 'judge-error' })),
    );
  }
  valid.sort((a, b) => a - b);
  const mid = Math.floor(valid.length / 2);
  const score = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  return { score, judges };
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
 * @param {{acquire:Function}} [opts.judgeBucket] — optional judge-call gate (CC3)
 * @param {number} [opts.timeoutMs]
 */
export function makeRealEvaluateCandidate({
  repoRoot = REPO_ROOT,
  reposDir = path.join(REPO_ROOT, 'eval', 'repos'),
  sweetSearchBinDir = path.join(REPO_ROOT, 'eval', 'agent-read-workflows', 'bin'),
  models = { sonnet: 'claude-sonnet-4-6', gpt5_5: 'gpt-5.5-instant' },
  judgePanel = JUDGE_PANEL,
  runJudgeFn = runJudge,
  judgeBucket,
  timeoutMs = 240000,
} = {}) {
  return async function evaluateCandidate({ promptText, probe, target }) {
    const repoCwd = path.join(reposDir, probe.repo);
    let run;
    let agentUsage;
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
      // claude-runner surfaces the Anthropic result-event usage at run.usage
      // ({input_tokens, output_tokens, cache_read_input_tokens, ...}) + retryCount.
      const u = run.usage || null;
      agentUsage = {
        model_id: models.sonnet,
        api_path: 'claude-cli',
        temperature: null, // CLI default; not overridden
        input_tokens: typeof u?.input_tokens === 'number' ? u.input_tokens : null,
        output_tokens: typeof u?.output_tokens === 'number' ? u.output_tokens : null,
        cache_read_tokens: typeof u?.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : null,
        retry_count: typeof run.retryCount === 'number' ? run.retryCount : null,
      };
    } else {
      run = await runCodexAgent({
        prompt: buildAgentUserPrompt(probe),
        systemAppend: promptText,
        model: models.gpt5_5,
        cwd: repoCwd,
        sweetSearchBinDir,
        timeoutMs,
      });
      // codex-exec surfaces no usage → token fields null.
      agentUsage = {
        model_id: models.gpt5_5,
        api_path: 'codex-exec',
        temperature: null,
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        retry_count: typeof run.retryCount === 'number' ? run.retryCount : null,
      };
    }

    const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
    const finalText = run.finalResultText || run.finalAssistantText || '';
    const { score, judges } = await judgePanelScore({
      probe, answer: finalText, panel: judgePanel, runJudgeFn, judgeBucket,
    });

    return {
      score,
      toolCalls: calls.length,
      finalAnswerEmitted: finalText.trim().length > 0,
      usedReadOrGrep: calls.some((tc) => SS_TOOL_RE.test(tc.name || '')),
      trajectory: { toolCalls: calls.map((t) => ({ name: t.name, input: t.input })), answer: finalText.slice(0, 2000) },
      wallMs: run.wallMs ?? 0,
      // CC1 — real run-metadata + token usage threaded out for the CONFIRM event
      // (B2) and the token-bucket reconcile (M3). Lands in detail[pid][target].usage.
      usage: {
        agent: agentUsage,
        judges,
        repo_commit: repoCommitFor(repoCwd),
        probe_hash: hashContent(`${probe.id}|${probe.query}`),
        token_count_prompt: estimateTokens(promptText),
      },
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
