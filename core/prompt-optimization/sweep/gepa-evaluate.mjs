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
import { IN_DISTRIBUTION, OOD_DISTRIBUTION } from './author-probes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// ─── repo path resolution (single source of truth: author-probes IN_DISTRIBUTION) ─
//
// The 5 P6 anchors live under eval/repos/<repo>; the 5 SHA-locked ast-tester
// language repos live under eval/ast-tester-probes/_repos/<language>. A naive
// path.join(reposDir, probe.repo) ONLY finds the anchors — the ast-tester repos
// (highway/garnet/gson/kotlinx.coroutines/sinatra) would resolve to nonexistent
// eval/repos/<repo> dirs, so every cpp/csharp/java/kotlin/ruby probe (~50% of the
// dev/heldout/vault sets) would run with a bad cwd and the ss-* shims would
// exit(2) "no index" → silent ~0 scores → corrupted GEPA signal. Mirrors
// p7-deepseek-flash-baseline.mjs:repoCwdFor (same IN_DISTRIBUTION source).
const ALL_REPO_ENTRIES = [...IN_DISTRIBUTION, ...OOD_DISTRIBUTION];
const REPO_PATH_BY_KEY = new Map(
  ALL_REPO_ENTRIES.map((x) => [`${x.language}:${x.repo}`, path.resolve(REPO_ROOT, x.path)]),
);
const REPO_PATH_BY_NAME = new Map(
  ALL_REPO_ENTRIES.map((x) => [x.repo, path.resolve(REPO_ROOT, x.path)]),
);

/**
 * Resolve a probe's on-disk repo cwd. Prefers the IN_DISTRIBUTION map (which
 * carries the ast-tester paths keyed by language:repo, then by repo); falls back
 * to <reposDir>/<repo> for any repo not in the map (custom / future repos).
 *
 * @param {{repo:string, language?:string}} probe
 * @param {{reposDir:string}} opts
 * @returns {string} absolute repo cwd
 */
export function resolveRepoCwd(probe, { reposDir } = {}) {
  if (!probe || typeof probe.repo !== 'string') {
    throw new TypeError('resolveRepoCwd: probe.repo string required');
  }
  if (probe.language && REPO_PATH_BY_KEY.has(`${probe.language}:${probe.repo}`)) {
    return REPO_PATH_BY_KEY.get(`${probe.language}:${probe.repo}`);
  }
  if (REPO_PATH_BY_NAME.has(probe.repo)) {
    return REPO_PATH_BY_NAME.get(probe.repo);
  }
  return path.join(reposDir ?? path.join(REPO_ROOT, 'eval', 'repos'), probe.repo);
}

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
    `report which file(s) and symbol(s) answer it and how. Stay within ${probe.max_turns} tool calls.`
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
 * runClaudeAgent contract (tool-call capture + final text). Verified against
 * codex-cli 0.132 (thread/turn/item event schema); `parseCodexAgentStream` is
 * pinned by a fixture test so a future codex schema shift fails loudly.
 */
export async function runCodexAgent({ prompt, systemAppend, model, cwd, sweetSearchBinDir, reasoningEffort = 'low', timeoutMs = 240000 }) {
  const { spawn } = await import('node:child_process');
  const merged = systemAppend ? `[SYSTEM]\n${systemAppend}\n\n[USER]\n${prompt}` : prompt;
  // codex has no "gpt-5.5-instant" SKU (it exits 1 / turn.failed); the valid
  // GPT-5.5 model is "gpt-5.5". Honor §2.1's non-reasoning "instant" intent with
  // the lowest reasoning effort codex accepts ("low"; "minimal" is rejected),
  // overriding the user's config default (e.g. xhigh). Verified vs codex-cli 0.132.
  const codexModel = (!model || /instant/i.test(model)) ? 'gpt-5.5' : model;
  const args = [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    '--json',
    '-c', `model_reasoning_effort="${reasoningEffort}"`,
    '-m', codexModel,
    merged,
  ];
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

  const { toolCalls, answer, usage } = parseCodexAgentStream(r.stdout);
  return {
    toolCalls,
    finalResultText: answer,
    finalAssistantText: answer,
    usage,
    modelUsed: codexModel,
    wallMs: Date.now() - t0,
    isError: r.exitCode !== 0 || r.timedOut,
    exitCode: r.exitCode,
  };
}

/**
 * Parse codex `exec --json` JSONL. codex-cli 0.132 schema: thread.* / turn.* /
 * item.{started,completed}. Tool calls = completed `command_execution` items;
 * the final answer = the last `agent_message` item's text; usage = turn.completed.
 * (Pre-0.132 the code looked for function_call/tool_call types that never exist
 * in this build — that returned 0 tool calls + empty answer. B1, 2026-05-22.)
 */
export function parseCodexAgentStream(stdout) {
  const toolCalls = [];
  let answer = '';
  let usage = null;
  if (!stdout) return { toolCalls, answer, usage };
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type === 'item.completed' && ev.item) {
      const it = ev.item;
      if (it.type === 'command_execution') {
        toolCalls.push({ name: it.command || 'command', input: { command: it.command, exit_code: it.exit_code } });
      } else if (it.type === 'agent_message' && typeof it.text === 'string' && it.text) {
        answer = it.text; // last agent_message wins
      }
    } else if (ev.type === 'turn.completed' && ev.usage) {
      usage = ev.usage; // { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
    }
  }
  return { toolCalls, answer, usage };
}

// ─── the default real evaluateCandidate factory ─────────────────────────────

// Tool-use classification (§3.7.1 evidence-adequacy + §4.5 native-fallback
// contamination). Claude wraps ss-* in Bash, so the Anthropic tool NAME is
// 'Bash'/'Read' and the real command lives in tc.input.command; Codex sets
// tc.name to the full command string. We MUST inspect both name and command —
// the prior `SS_TOOL_RE.test(tc.name)` test silently scored every Claude
// Bash-wrapped ss-* call as "no evidence" (and rewarded Claude's NATIVE Read).
const SS_TOOL_RE = /\bss-(search|find|semantic|trace|grep|read)\b/i;
const NATIVE_SEARCH_RE = /\b(rg|ripgrep|grep|egrep|fgrep|ag|ack)\b/i;
const NATIVE_READ_RE = /\b(cat|head|tail|less|more|nl)\b/i;

/**
 * Classify an agent's tool calls into sweet-search vs native-search vs
 * native-read use. Robust to both runner shapes (Claude: name='Bash'/'Read',
 * command in input.command; Codex: name=command string). An ss-* call (incl.
 * ss-grep / ss-read) is NEVER counted as native — the ss guard wins first.
 *
 * @param {Array<{name?:string, input?:{command?:string}}>} toolCalls
 * @returns {{ ss: boolean, nativeSearch: boolean, nativeRead: boolean }}
 */
export function classifyToolUse(toolCalls) {
  let ss = false;
  let nativeSearch = false;
  let nativeRead = false;
  for (const tc of Array.isArray(toolCalls) ? toolCalls : []) {
    const name = typeof tc?.name === 'string' ? tc.name : '';
    const cmd = typeof tc?.input?.command === 'string' ? tc.input.command : '';
    const hay = `${name} ${cmd}`;
    if (SS_TOOL_RE.test(hay)) { ss = true; continue; } // ss-grep/ss-read are NOT native
    if (NATIVE_SEARCH_RE.test(hay)) nativeSearch = true;
    if (name === 'Read' || NATIVE_READ_RE.test(hay)) nativeRead = true;
  }
  return { ss, nativeSearch, nativeRead };
}

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
    const repoCwd = resolveRepoCwd(probe, { reposDir });
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
      // codex-cli 0.132 turn.completed exposes usage (input/cached/output/reasoning).
      const u = run.usage || null;
      agentUsage = {
        model_id: run.modelUsed || models.gpt5_5,
        api_path: 'codex-exec',
        temperature: null,
        input_tokens: typeof u?.input_tokens === 'number' ? u.input_tokens : null,
        output_tokens: typeof u?.output_tokens === 'number' ? u.output_tokens : null,
        cache_read_tokens: typeof u?.cached_input_tokens === 'number' ? u.cached_input_tokens : null,
        retry_count: typeof run.retryCount === 'number' ? run.retryCount : null,
      };
    }

    const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
    const finalText = run.finalResultText || run.finalAssistantText || '';
    const { score, judges } = await judgePanelScore({
      probe, answer: finalText, panel: judgePanel, runJudgeFn, judgeBucket,
    });

    // Classify tool use from name + command so Bash-wrapped ss-* (the Claude
    // path) is correctly credited as evidence, and native grep/read is measured
    // separately for the §4.5 native-fallback contamination penalty.
    const toolUse = classifyToolUse(calls);

    return {
      score,
      toolCalls: calls.length,
      finalAnswerEmitted: finalText.trim().length > 0,
      // Any retrieval/read evidence (ss OR native) — drives the evidence-adequacy
      // penalty (a final answer with NO tool evidence is the reward-hack we punish).
      usedReadOrGrep: toolUse.ss || toolUse.nativeSearch || toolUse.nativeRead,
      usedSweetSearch: toolUse.ss,
      usedNativeSearch: toolUse.nativeSearch,
      usedNativeRead: toolUse.nativeRead,
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

// ─── OOD language-transfer gate replay runner (§3.5.1) ──────────────────────

/**
 * Build a per-target replay runner for the OOD language-transfer gate
 * (p7-ood-gate.runOodGate). Replays the winning prompt on each OOD probe via the
 * injected `evaluate` (default = makeRealEvaluateCandidate's evaluateCandidate)
 * and returns the `{ perProbe: [{ language, probeId, score }] }` shape runOodGate
 * expects. Sequential per-probe so each target stream stays naturally
 * rate-limited; the two production-target streams run concurrently inside
 * runOodGate. probe.language MUST match the OOD_LANGUAGES casing so the
 * per-language scorecard buckets correctly.
 *
 * @param {{ evaluate: Function, target: 'sonnet'|'gpt5_5' }} args
 * @returns {(winnerPrompt:string, probes:object[])=>Promise<{perProbe:object[]}>}
 */
export function makeOodReplayRunner({ evaluate, target }) {
  if (typeof evaluate !== 'function') throw new TypeError('makeOodReplayRunner: evaluate must be a function');
  if (target !== 'sonnet' && target !== 'gpt5_5') {
    throw new RangeError(`makeOodReplayRunner: target must be 'sonnet'|'gpt5_5' (got ${target})`);
  }
  return async function replayOod(winnerPrompt, probes) {
    const perProbe = [];
    for (const probe of probes) {
      const r = await evaluate({ promptText: winnerPrompt, probe, target });
      perProbe.push({ language: probe.language, probeId: probe.id, score: r.score });
    }
    return { perProbe };
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
