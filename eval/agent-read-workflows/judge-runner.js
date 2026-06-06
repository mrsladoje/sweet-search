// Cross-lineage judge dispatcher for the §11.6 disjoint-family panel.
//
// Each panel slot has a `lineage` (anthropic / openai / google / deepseek /
// opencode-generic). This module dispatches a single PRP judge call to the
// right runtime and returns a normalized { text, isError, raw, latencyMs }
// shape so callers (track-b.mjs / runIaaProbes) don't care which lineage
// they're talking to.
//
// Harness parity: every lineage routes through a real CLI runtime so all
// judges see the same level of harness framing. This matters for §11.6 —
// a raw-API judge would miss the agent-frame system prompt that CLI
// runtimes inject by default and would be asymmetric vs the others.
//
//   - anthropic / claude:  claude CLI                                (alias `dsp` = --dangerously-skip-permissions)
//   - openai / codex:      codex exec                                (alias `dcodex` = --dangerously-bypass-approvals-and-sandbox)
//   - google / gemini:     gemini -p                                 (headless / non-TTY)
//   - opencode:            opencode run                              (non-interactive subcommand)
//   - deepseek:            claude CLI with ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
//                          + ANTHROPIC_AUTH_TOKEN=$DEEPSEEK_API_KEY  (matches DeepSeek's own
//                          "Integrate with Claude Code" recommendation; gives DS the same
//                          harness framing as the Anthropic adapter)
//   - deepseek-api:        raw HTTP POST to OpenAI-compatible endpoint (escape hatch
//                          for budget-controlled or framework-free A/B tests)
//
// Cost / latency: judge calls here are short prompts → short replies, so
// timeouts default to 90s and we don't stream. The caller is responsible
// for budgeting (see track-b.mjs:estimateCost).
//
// Tests: spawn / fetch are wrapped in injectable seams (`_internal.spawn`,
// `_internal.fetch`) so unit tests can run without the real CLIs.

import { spawn as nodeSpawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 90000;

// ─── shared retry/backoff (CC3 / B5 / M6) ────────────────────────────────────
//
// Modeled on core/prompt-optimization/scripts/deepseek-client.mjs
// (classifyResponse + BACKOFF_LADDER_MS). Every direct-API runner returns a
// normalized {isError, raw:{status}} shape on a non-2xx; the runJudge wrapper
// below classifies that result and retries with this ladder:
//   429            → retry, backoff honoring Retry-After (cap at ladder)
//   5xx            → retry once (then surface the error)
//   empty-text-200 → retry (DeepSeek/reasoning gotcha, M6)
//   4xx (non-429)  → fatal, no retry
const BACKOFF_LADDER_MS = [1000, 2000, 4000, 8000, 16000];
const MAX_SERVER_RETRIES = 1;       // 5xx → one retry, matching deepseek-client
const MAX_RATE_LIMIT_RETRIES = BACKOFF_LADDER_MS.length; // bounded for judges (one-shot judging)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pure HTTP-status disposition (mirrors deepseek-client.classifyResponse).
 *   ok | retry-rate-limit | retry-server | fatal
 */
export function classifyResponseStatus(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'retry-rate-limit';
  if (status >= 500 && status < 600) return 'retry-server';
  return 'fatal';
}

/**
 * Post-parse classifier (M6): a successful HTTP 200 whose parsed assistant
 * text is empty is the reasoning-model gotcha (whole budget consumed by the
 * reasoning trace; see project_deepseek_max_tokens_reasoning). Treat it as a
 * RETRYABLE error so the runJudge wrapper re-issues the call. A non-empty 200
 * passes straight through as success.
 *
 * @param {string} text   — parsed assistant text
 * @param {object} raw    — provider-specific raw metadata (usage, model, …)
 * @returns {{text:string, isError:boolean, error?:string, raw:object}}
 */
function classifyEmptyText200(text, raw) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { text: '', isError: true, error: 'empty-text-200', raw };
  }
  return { text, isError: false, raw };
}

/**
 * Decide retry disposition for a runner RESULT (not a raw HTTP response).
 * Direct runners surface non-2xx as {isError:true, raw:{status}} and the M6
 * empty-200 case as {isError:true, error:'empty-text-200'}. Returns one of:
 *   'ok' | 'retry-rate-limit' | 'retry-server' | 'retry-empty' | 'fatal'
 * Errors with no recognizable status (network/abort/timeout/missing-key) are
 * treated as 'fatal' — those are either non-transient config errors or already
 * one-shot-retried inside the runner's AbortController path.
 */
function classifyRunnerResult(r) {
  if (!r || !r.isError) return 'ok';
  if (r.error === 'empty-text-200') return 'retry-empty';
  const status = r.raw && typeof r.raw.status === 'number' ? r.raw.status : undefined;
  if (status === undefined) return 'fatal';
  const disp = classifyResponseStatus(status);
  return disp === 'ok' ? 'fatal' : disp; // a non-2xx that classifies 'ok' shouldn't happen
}

/**
 * Read the `Retry-After` header off a fetch Response (defensive: `headers`
 * may be absent in test fakes). Returns the raw header value or undefined.
 */
function readRetryAfter(res) {
  try {
    return res && res.headers && typeof res.headers.get === 'function'
      ? (res.headers.get('retry-after') ?? undefined)
      : undefined;
  } catch { return undefined; }
}

/** Parse a Retry-After header (seconds or HTTP-date) into ms, or null. */
function retryAfterMs(raw) {
  const ra = raw && raw.retryAfter;
  if (ra == null) return null;
  const secs = Number(ra);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(ra);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

/**
 * Resolve a `--judge-models` token into { lineage, model }.
 *
 * Two accepted forms:
 *   1. Explicit `lineage:model`           e.g. `anthropic:claude-sonnet-4-6`
 *   2. Bare model with prefix heuristic   e.g. `gpt-5.5`, `gemini-3-1-pro`
 *
 * Heuristic prefixes (case-insensitive):
 *   - claude-, sonnet, opus, haiku        → anthropic
 *   - gpt-, o1-, o3-, codex               → openai (codex CLI)
 *   - gemini-                             → google
 *   - deepseek-, ds-                      → deepseek
 *   - llama-, qwen-, mistral-, command-   → opencode (generic via opencode run)
 *
 * Throws on unresolvable bare tokens — explicit form is the safe default.
 */
export function parseJudgeModelSpec(spec) {
  if (typeof spec !== 'string' || spec.length === 0) {
    throw new TypeError('parseJudgeModelSpec: non-empty string required');
  }
  if (spec.includes(':')) {
    const [lineage, ...rest] = spec.split(':');
    const model = rest.join(':');
    if (!isKnownLineage(lineage)) {
      throw new RangeError(`parseJudgeModelSpec: unknown lineage "${lineage}" in "${spec}"`);
    }
    if (!model) throw new RangeError(`parseJudgeModelSpec: missing model after ":" in "${spec}"`);
    return { lineage, model };
  }
  const lc = spec.toLowerCase();
  if (lc.startsWith('claude-') || lc === 'sonnet' || lc === 'opus' || lc === 'haiku' || lc.startsWith('sonnet-') || lc.startsWith('opus-') || lc.startsWith('haiku-')) {
    return { lineage: 'anthropic', model: spec };
  }
  if (lc.startsWith('gpt-') || lc.startsWith('o1-') || lc.startsWith('o3-') || lc.startsWith('o4-') || lc.startsWith('codex')) {
    return { lineage: 'openai', model: spec };
  }
  if (lc.startsWith('gemini-') || lc === 'flash' || lc === 'pro') {
    return { lineage: 'google', model: spec };
  }
  if (lc.startsWith('deepseek-') || lc.startsWith('ds-')) {
    return { lineage: 'deepseek', model: spec };
  }
  if (lc.startsWith('kimi') || lc.startsWith('moonshot')) {
    return { lineage: 'moonshot', model: spec };
  }
  if (lc.startsWith('minimax') || lc.startsWith('abab')) {
    return { lineage: 'minimax', model: spec };
  }
  if (lc.startsWith('mimo')) {
    return { lineage: 'mimo', model: spec };
  }
  if (lc.startsWith('qwen')) {
    return { lineage: 'qwen', model: spec };
  }
  if (lc.startsWith('llama-') || lc.startsWith('mistral-') || lc.startsWith('command-')) {
    return { lineage: 'opencode', model: spec };
  }
  throw new RangeError(
    `parseJudgeModelSpec: cannot infer lineage from "${spec}" — use explicit "lineage:model" form ` +
    `(anthropic|anthropic-api|openai|openai-api|google|google-api|deepseek|deepseek-api|` +
    `opencode|moonshot|minimax|mimo|qwen|dashscope)`,
  );
}

function isKnownLineage(s) {
  return [
    'anthropic', 'anthropic-api',
    'openai', 'openai-api',
    'google', 'google-api',
    'deepseek', 'deepseek-api',
    'opencode',
    'moonshot', 'minimax', 'mimo', 'qwen', 'dashscope',
  ].includes(s);
}

// ─── normalized adapter contract ─────────────────────────────────────────

/**
 * @typedef {object} JudgeRunResult
 * @property {string}  text       — the model's reply (final assistant text)
 * @property {boolean} isError    — true on non-zero exit / API error / timeout
 * @property {number}  latencyMs
 * @property {string}  lineage
 * @property {string}  model
 * @property {string} [error]     — short reason when isError
 * @property {object} [raw]       — provider-specific raw response (parsed JSON)
 */

/**
 * @param {object} req
 * @param {string} req.lineage     — one of {anthropic, openai, google, deepseek, opencode}
 * @param {string} req.model       — provider model id
 * @param {string} req.systemPrompt
 * @param {string} req.userPrompt
 * @param {number} [req.timeoutMs=90000]
 * @returns {Promise<JudgeRunResult>}
 */
export async function runJudge(req) {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Dispatch a single attempt, measuring its OWN latency so a retried call
  // reports the latency of the attempt that actually returned.
  async function dispatch() {
    const t0 = Date.now();
    let r;
    try {
      switch (req.lineage) {
        case 'anthropic':     r = await runAnthropic(req); break;
        case 'anthropic-api': r = await runAnthropicDirect(req, timeoutMs); break;
        case 'openai':        r = await runCodex(req, timeoutMs); break;
        case 'openai-api':    r = await runOpenAIDirect(req, timeoutMs); break;
        case 'google':        r = await runGemini(req, timeoutMs); break;
        case 'google-api':    r = await runGeminiDirect(req, timeoutMs); break;
        case 'deepseek':      r = await runDeepseekViaClaude(req, timeoutMs); break;
        case 'deepseek-api':  r = await runDeepseekDirect(req, timeoutMs); break;
        case 'opencode':      r = await runOpencode(req, timeoutMs); break;
        case 'moonshot':      r = await runMoonshotDirect(req, timeoutMs); break;
        case 'minimax':       r = await runMiniMaxDirect(req, timeoutMs); break;
        case 'mimo':          r = await runMiMoDirect(req, timeoutMs); break;
        case 'qwen':          // fall-through: qwen and dashscope share the runner
        case 'dashscope':     r = await runQwenDirect(req, timeoutMs); break;
        default: throw new Error(`runJudge: unknown lineage ${req.lineage}`);
      }
    } catch (e) {
      return {
        text: '', isError: true, error: e.message || String(e),
        latencyMs: Date.now() - t0,
      };
    }
    return { ...r, latencyMs: Date.now() - t0 };
  }

  // CC3/B5/M6: shared retry/backoff wrapper. ALL callers (the disjoint-family
  // judge panel AND gepa-mutate's callModel) benefit. Classification mirrors
  // deepseek-client: 429 → backoff ladder honoring Retry-After; 5xx → one
  // retry; empty-text-200 → retry; 4xx (non-429) and unrecognized errors →
  // fatal (no retry). retryCount is surfaced on the result + result.raw.
  const sleepFn = _internal.sleep || sleep;
  let retryCount = 0;
  let rateLimitTries = 0;
  let serverTries = 0;
  let emptyTries = 0;
  let r;
  // Bounded loop: the only paths that `continue` are the retryable ones, each
  // guarded by its own try-counter, so this terminates.
  while (true) {
    r = await dispatch();
    const disp = classifyRunnerResult(r);
    if (disp === 'ok' || disp === 'fatal') break;

    if (disp === 'retry-rate-limit') {
      if (rateLimitTries >= MAX_RATE_LIMIT_RETRIES) break;
      const ladderIdx = Math.min(rateLimitTries, BACKOFF_LADDER_MS.length - 1);
      const headerMs = retryAfterMs(r.raw);
      const delay = headerMs != null ? headerMs : BACKOFF_LADDER_MS[ladderIdx];
      rateLimitTries++; retryCount++;
      await sleepFn(delay);
      continue;
    }
    if (disp === 'retry-server') {
      if (serverTries >= MAX_SERVER_RETRIES) break;
      serverTries++; retryCount++;
      await sleepFn(BACKOFF_LADDER_MS[0]);
      continue;
    }
    if (disp === 'retry-empty') {
      // empty-text-200: bound by the rate-limit budget so a model stuck in
      // reasoning-only mode can't loop forever.
      if (emptyTries >= MAX_RATE_LIMIT_RETRIES) break;
      emptyTries++; retryCount++;
      await sleepFn(BACKOFF_LADDER_MS[Math.min(emptyTries - 1, BACKOFF_LADDER_MS.length - 1)]);
      continue;
    }
    break;
  }

  return {
    ...r,
    lineage: req.lineage,
    model: req.model,
    retryCount,
    raw: { ...(r.raw || {}), retryCount },
  };
}

// ─── anthropic (claude-runner.js wrapper) ─────────────────────────────────

async function runAnthropic({ model, systemPrompt, userPrompt, timeoutMs }) {
  // Reuse the existing claude-runner for parity with how the agent runs.
  // We import lazily so the module loads without claude-runner side effects
  // when only non-Anthropic adapters are needed.
  const { runClaudeAgent } = await import('./claude-runner.js');
  const run = await runClaudeAgent({
    prompt: userPrompt,
    systemAppend: systemPrompt,
    model,
    cwd: process.cwd(),
    allowedTools: [],
    disallowedTools: ['Bash', 'Read', 'Edit', 'Write'],
    addDirs: [],
    timeoutMs,
  });
  return {
    text: run.finalResultText || run.finalAssistantText || '',
    isError: !!run.isError || !!run.timedOut,
    raw: { usage: run.usage, totalCostUsd: run.totalCostUsd, exitCode: run.exitCode },
  };
}

// ─── openai / codex CLI ──────────────────────────────────────────────────
//
// codex exec "<query>" runs headless. Yolo via
//   --dangerously-bypass-approvals-and-sandbox   (matches `dcodex` alias)
// JSON output with --json (machine-parseable line stream).
// Model select with -m / --model.
//
// The judge needs no tools — we pass `--full-auto` only when we want the
// model to read; for pure-LLM judging we keep tools off and forbid edits.

async function runCodex({ model, systemPrompt, userPrompt }, timeoutMs) {
  // Codex doesn't surface a system prompt cleanly in headless mode, so we
  // merge system+user into a single prompt with explicit role markers.
  const prompt = systemPrompt
    ? `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`
    : userPrompt;
  const args = [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    '--json',
  ];
  if (model) args.push('-m', model);
  args.push(prompt);
  const r = await spawnCapture('codex', args, { timeoutMs });
  return {
    text: parseCodexOutput(r.stdout),
    isError: r.exitCode !== 0 || r.timedOut,
    raw: { stdoutTail: r.stdout.slice(-2000), exitCode: r.exitCode },
  };
}

/**
 * Codex --json emits a stream of JSONL events, terminated by an
 * `assistant_message` or `final_response` event whose `content` (or
 * `message`/`text`) carries the reply. We pull the LAST text-bearing
 * event's text content; non-JSON noise is skipped silently.
 */
export function parseCodexOutput(stdout) {
  if (!stdout) return '';
  let last = '';
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    // Try a handful of plausible payload shapes — codex's JSONL schema has
    // shifted across versions. Order matters: prefer the most-final field.
    const candidate =
      ev.text ||
      ev.message ||
      ev.content ||
      ev.assistant_message ||
      ev.final_response ||
      (ev.delta && ev.delta.text) ||
      '';
    if (typeof candidate === 'string' && candidate.length > 0) last = candidate;
    else if (Array.isArray(candidate)) {
      // content-blocks form (anthropic-like)
      const t2 = candidate
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text).join('');
      if (t2) last = t2;
    }
  }
  return last;
}

// ─── google / gemini CLI ─────────────────────────────────────────────────
//
// gemini -p "<prompt>" --output-format json
// Model select with -m / --model.

async function runGemini({ model, systemPrompt, userPrompt }, timeoutMs) {
  const prompt = systemPrompt
    ? `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`
    : userPrompt;
  const args = ['-p', prompt, '--output-format', 'json'];
  if (model) args.push('-m', model);
  const r = await spawnCapture('gemini', args, { timeoutMs });
  return {
    text: parseGeminiOutput(r.stdout),
    isError: r.exitCode !== 0 || r.timedOut,
    raw: { stdoutTail: r.stdout.slice(-2000), exitCode: r.exitCode },
  };
}

/**
 * gemini --output-format json emits a single JSON object: { response: ..., stats: ... }.
 * A streaming variant emits JSONL. We try single-object first, fall back to
 * the last `result` / `response` line.
 */
export function parseGeminiOutput(stdout) {
  if (!stdout) return '';
  // Single-object form
  try {
    const obj = JSON.parse(stdout);
    if (typeof obj.response === 'string') return obj.response;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.candidates) && obj.candidates[0]?.content?.parts) {
      return obj.candidates[0].content.parts.map((p) => p.text || '').join('');
    }
  } catch { /* fall through to JSONL parse */ }
  // JSONL streaming form
  let last = '';
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try {
      const ev = JSON.parse(t);
      const cand = ev.response || ev.text || (ev.delta && ev.delta.text) || '';
      if (typeof cand === 'string' && cand) last = cand;
    } catch { /* skip */ }
  }
  return last;
}

// ─── deepseek via claude-CLI harness (parity-preserving default) ─────────
//
// DeepSeek's own integration guide (api-docs.deepseek.com) recommends
// running through the claude CLI by setting ANTHROPIC_BASE_URL to DS's
// Anthropic-compatible endpoint. This gives DS the SAME runtime harness
// (system prompt, retry, output normalization, audit hooks) as the
// anthropic adapter — the disjoint-family comparison is then over the
// model itself, not over runtime asymmetries.
//
// Env vars set per DeepSeek's guide (https://api-docs.deepseek.com/guides/coding_agents):
//   ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
//   ANTHROPIC_AUTH_TOKEN=<DEEPSEEK_API_KEY>
//   ANTHROPIC_MODEL=<deepseek-v4-pro|deepseek-v4-flash>

async function runDeepseekViaClaude({ model, systemPrompt, userPrompt, timeoutMs }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('runDeepseekViaClaude: DEEPSEEK_API_KEY not set in environment');
  }
  // Spawn `claude` directly with redirected env. We can't go through
  // claude-runner.js as-is because it inherits process.env; we shell out
  // to claude with our own env block here. This keeps the CLI parity
  // (same flags, same agent frame) while the API target is DeepSeek.
  const args = [
    '-p', userPrompt,
    '--model', model || 'deepseek-v4-pro',
    '--output-format', 'json',
    '--no-session-persistence',
    '--dangerously-skip-permissions',
    '--append-system-prompt', systemPrompt || '',
    '--disallowed-tools', 'Bash Read Edit Write',
  ];
  const dsEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_MODEL: model || 'deepseek-v4-pro',
    // Claude Code respects these to map alias names → DS models.
    ANTHROPIC_DEFAULT_OPUS_MODEL: model || 'deepseek-v4-pro',
    ANTHROPIC_DEFAULT_SONNET_MODEL: model || 'deepseek-v4-pro',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
  };
  const r = await spawnCapture('claude', args, { timeoutMs, env: dsEnv });
  return {
    text: parseClaudeJsonOutput(r.stdout),
    isError: r.exitCode !== 0 || r.timedOut,
    raw: { stdoutTail: r.stdout.slice(-2000), exitCode: r.exitCode, viaHarness: 'claude-cli' },
  };
}

/**
 * `claude --output-format json` emits a single JSON envelope with
 * `result` (final text) + `usage`. JSONL streaming form is also possible
 * with `--output-format stream-json`; we only need the single envelope here.
 */
export function parseClaudeJsonOutput(stdout) {
  if (!stdout) return '';
  try {
    const obj = JSON.parse(stdout);
    if (typeof obj.result === 'string') return obj.result;
    if (typeof obj.text === 'string') return obj.text;
  } catch { /* fall through */ }
  // stream-json fallback: last assistant text block
  let last = '';
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try {
      const ev = JSON.parse(t);
      if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
        const txt = ev.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (txt) last = txt;
      } else if (ev.type === 'result' && typeof ev.result === 'string') {
        last = ev.result;
      }
    } catch { /* */ }
  }
  return last;
}

// ─── deepseek raw API (escape hatch) ─────────────────────────────────────

async function runDeepseekDirect({ model, systemPrompt, userPrompt }, timeoutMs) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('runDeepseekDirect: DEEPSEEK_API_KEY not set in environment');
  }
  const body = buildDeepseekPayload({ model, systemPrompt, userPrompt });
  const fetchFn = _internal.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('runDeepseekDirect: global fetch unavailable (Node 18+ required)');
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // Surface status + Retry-After so the runJudge retry wrapper (CC3/B5)
      // can classify (429/5xx/4xx) and honor backoff timing.
      return {
        text: '', isError: true,
        raw: { status: res.status, retryAfter: readRetryAfter(res), body: errText.slice(0, 1000), viaHarness: 'raw-api' },
      };
    }
    const json = await res.json();
    // M6: a successful 200 whose parsed text is empty is the DeepSeek /
    // reasoning-model gotcha (whole budget spent on the reasoning trace,
    // see project_deepseek_max_tokens_reasoning). Classify it as a RETRYABLE
    // error so the runJudge retry wrapper re-issues the call.
    return classifyEmptyText200(parseDeepseekResponse(json), {
      usage: json.usage, model: json.model, viaHarness: 'raw-api',
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Pure builder for the DeepSeek chat-completions payload. Exported for
 * unit tests so the wire format is pinned.
 */
export function buildDeepseekPayload({ model, systemPrompt, userPrompt }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  return {
    model: model || 'deepseek-v4-pro',
    messages,
    temperature: 0,        // judging is deterministic
    // DeepSeek V4 Flash defaults to reasoning mode and can consume 1024
    // tokens entirely on the reasoning trace, leaving 0 for the JSON answer.
    // 4096 leaves comfortable headroom for both reasoning + the small JSON
    // verdict we ask for. Output cost is negligible at $0.28/1M.
    max_tokens: 4096,
    stream: false,
  };
}

/** Pull the assistant text out of a DeepSeek chat-completions response. */
export function parseDeepseekResponse(json) {
  if (!json || !Array.isArray(json.choices) || json.choices.length === 0) return '';
  const c = json.choices[0];
  if (typeof c.message?.content === 'string') return c.message.content;
  return '';
}

// ─── google direct (raw HTTPS, bypass gemini CLI) ─────────────────────────
//
// For pure-judging (no tool use, no workspace context) the gemini CLI's
// startup overhead, internal retries and rate-limit thrash are all wasted
// effort. Direct API gives us:
//   - 5-10× lower per-call latency (15-30s vs 90-160s through CLI)
//   - no subprocess overhead (higher safe concurrency)
//   - cleaner error semantics (HTTP status codes vs log parsing)
// We still keep the CLI path (`google` lineage) for AGENT-style flows that
// need workspace/tools — judges should use `google-api`.

async function runGeminiDirect({ model, systemPrompt, userPrompt }, timeoutMs) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('runGeminiDirect: GEMINI_API_KEY not set in environment');
  }
  const fetchFn = _internal.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('runGeminiDirect: global fetch unavailable (Node 18+ required)');
  }
  const body = buildGeminiPayload({ systemPrompt, userPrompt });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // Surface status + Retry-After so the runJudge retry wrapper (CC3/B5)
      // can classify (429/5xx/4xx) and honor backoff timing.
      return {
        text: '', isError: true,
        raw: { status: res.status, retryAfter: readRetryAfter(res), body: errText.slice(0, 1000), viaHarness: 'raw-api' },
      };
    }
    const json = await res.json();
    return classifyEmptyText200(parseGeminiDirectResponse(json), {
      usage: json.usageMetadata, model: json.modelVersion, viaHarness: 'raw-api',
    });
  } catch (e) {
    return {
      text: '', isError: true, error: e.message || String(e),
      raw: { viaHarness: 'raw-api', aborted: ctrl.signal.aborted },
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Pure builder for the Gemini generateContent payload. Exported for
 * unit tests so the wire format is pinned. temperature=0 + maxOutputTokens=1024
 * matches buildDeepseekPayload for cross-lineage consistency.
 */
export function buildGeminiPayload({ systemPrompt, userPrompt }) {
  const payload = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024 },
  };
  if (systemPrompt) {
    payload.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  return payload;
}

/** Pull the assistant text out of a Gemini generateContent response. */
export function parseGeminiDirectResponse(json) {
  if (!json || !Array.isArray(json.candidates) || json.candidates.length === 0) return '';
  const cand = json.candidates[0];
  if (Array.isArray(cand.content?.parts)) {
    return cand.content.parts.map((p) => p.text || '').join('');
  }
  return '';
}

// ─── Anthropic Messages API (raw HTTPS, direct path) ─────────────────────
//
// For stateless / budget-controlled judging that does not need the claude CLI
// harness. Mirrors the same rationale as `deepseek-api` / `google-api`:
// lower per-call latency, cleaner HTTP error codes, no subprocess overhead.
//
// §3.5.2 thinking support: pass `thinking` (integer budget_tokens) to enable
// extended thinking mode for any claude-3-7+ model.
//
// Env: ANTHROPIC_API_KEY

async function runAnthropicDirect({ model, systemPrompt, userPrompt, maxTokens, temperature, thinking }, timeoutMs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('runAnthropicDirect: ANTHROPIC_API_KEY not set in environment');
  }
  const fetchFn = _internal.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('runAnthropicDirect: global fetch unavailable (Node 18+ required)');
  }
  const body = buildAnthropicPayload({ model, systemPrompt, userPrompt, maxTokens, temperature, thinking });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        text: '', isError: true,
        raw: { status: res.status, body: errText.slice(0, 1000), viaHarness: 'raw-api' },
      };
    }
    const json = await res.json();
    return classifyEmptyText200(parseAnthropicResponse(json), {
      usage: json.usage, model: json.model, viaHarness: 'raw-api',
    });
  } catch (e) {
    return {
      text: '', isError: true, error: e.message || String(e),
      raw: { viaHarness: 'raw-api', aborted: ctrl.signal.aborted },
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Pure builder for the Anthropic Messages API payload. Exported for unit tests
 * so the wire format is pinned.
 *
 * Extended-thinking constraints (§3.5.2 reasoning-mode HOMP uses budget_tokens:8000):
 * the Anthropic API rejects (400) a `thinking`-enabled request unless
 *   1. `temperature` is 1 — extended thinking is incompatible with temperature /
 *      top_p / top_k modification, and
 *   2. `max_tokens` is strictly greater than `thinking.budget_tokens` (the
 *      visible answer needs room *after* the thinking trace).
 * When `thinking` is set we therefore force temperature→1 and lift max_tokens
 * above the budget (keeping the caller's `maxTokens` as post-thinking headroom).
 * Without these guards a `{thinking:8000}` call with the default temperature=0 /
 * max_tokens=4096 is a guaranteed 400.
 *
 * @param {object} opts
 * @param {string} [opts.model]        — defaults to 'claude-sonnet-4-6'
 * @param {string} [opts.systemPrompt] — mapped to top-level `system` key
 * @param {string}  opts.userPrompt
 * @param {number} [opts.maxTokens=4096] — answer budget; when thinking is on this
 *                                         is headroom *above* budget_tokens
 * @param {number} [opts.temperature=0] — forced to 1 when thinking is enabled
 * @param {number} [opts.thinking]     — if set: adds thinking:{type:'enabled',budget_tokens} (§3.5.2)
 */
export function buildAnthropicPayload({ model, systemPrompt, userPrompt, maxTokens = 4096, temperature = 0, thinking } = {}) {
  const body = {
    model: model || 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: maxTokens,
    temperature,
  };
  // Cache the (reused) system prompt as an ephemeral block — paraphraser /
  // TARE / SCS / reasoning-HOMP batches reissue the same system across many
  // stateless calls within the 5-min TTL. The unique userPrompt stays uncached.
  if (systemPrompt) body.system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  if (thinking != null) {
    body.thinking = { type: 'enabled', budget_tokens: thinking };
    body.temperature = 1;                       // constraint (1) — required by the API
    if (body.max_tokens <= thinking) {          // constraint (2) — answer needs room after the trace
      body.max_tokens = thinking + maxTokens;
    }
  }
  return body;
}

/**
 * Pull the assistant text out of an Anthropic Messages API response.
 * Content is an array of content blocks; concat text blocks, ignore thinking
 * blocks and any other block types.
 */
export function parseAnthropicResponse(json) {
  if (!json || !Array.isArray(json.content) || json.content.length === 0) return '';
  return json.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

// ─── shared OpenAI-compatible runner ─────────────────────────────────────────
//
// All OpenAI-compatible providers (openai-api, moonshot, minimax, mimo, qwen)
// share this single HTTP implementation. Per-provider runners resolve their
// key + baseUrl + optional chatPath override and delegate here.
//
// `chatPath` defaults to '/chat/completions'; MiniMax overrides to
// '/text/chatcompletion_v2' (same OpenAI response shape, different path).
//
// `extraBody` is merged into the JSON body last — use it for provider
// extensions such as `reasoning_effort` (OpenAI o-series) or `temperature`
// overrides.

/**
 * @param {object} opts
 * @param {string}  opts.baseUrl
 * @param {string}  opts.apiKey
 * @param {string}  opts.model
 * @param {string} [opts.systemPrompt]
 * @param {string}  opts.userPrompt
 * @param {number} [opts.temperature=0]
 * @param {number} [opts.maxTokens=4096]
 * @param {object} [opts.extraBody]    — merged into payload (provider extensions)
 * @param {string} [opts.chatPath='/chat/completions']
 * @param {boolean} [opts.useCompletionTokens=false] — M7/§3.5.2 reasoning-class
 *        calls: build the payload with `max_completion_tokens` (NOT max_tokens)
 *        and temperature:1 (reasoning models reject max_tokens / temperature:0).
 * @param {number} [timeoutMs]
 * @returns {Promise<{text:string, isError:boolean, raw:object, latencyMs:number}>}
 */
async function runOpenAICompatible(
  { baseUrl, apiKey, model, systemPrompt, userPrompt, temperature = 0, maxTokens = 4096, extraBody, chatPath = '/chat/completions', useCompletionTokens = false },
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const fetchFn = _internal.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('runOpenAICompatible: global fetch unavailable (Node 18+ required)');
  }
  const payload = useCompletionTokens
    ? buildOpenAIReasoningPayload({ model, systemPrompt, userPrompt, maxCompletionTokens: maxTokens })
    : buildOpenAIPayload({ model, systemPrompt, userPrompt, temperature, maxTokens });
  const body = extraBody ? { ...payload, ...extraBody } : payload;
  const url = `${baseUrl}${chatPath}`;
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // Surface status + Retry-After so the runJudge retry wrapper (CC3/B5)
      // can classify (429/5xx/4xx) and honor backoff timing.
      return {
        text: '', isError: true,
        raw: { status: res.status, retryAfter: readRetryAfter(res), body: errText.slice(0, 1000), viaHarness: 'raw-api' },
        latencyMs: Date.now() - t0,
      };
    }
    const json = await res.json();
    return {
      ...classifyEmptyText200(parseOpenAIResponse(json), {
        usage: json.usage, model: json.model, viaHarness: 'raw-api',
      }),
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      text: '', isError: true, error: e.message || String(e),
      raw: { viaHarness: 'raw-api', aborted: ctrl.signal.aborted },
      latencyMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pure builder for the OpenAI Chat Completions payload. Exported as the pinned
 * wire format used by all OpenAI-compatible runners (deepseek-api borrows the
 * same shape independently). temperature=0 for deterministic judging;
 * max_tokens=4096 matches buildDeepseekPayload.
 *
 * @param {object} opts
 * @param {string} [opts.model]          — defaults to 'gpt-4.1'
 * @param {string} [opts.systemPrompt]
 * @param {string}  opts.userPrompt
 * @param {number} [opts.temperature=0]
 * @param {number} [opts.maxTokens=4096]
 */
export function buildOpenAIPayload({ model, systemPrompt, userPrompt, temperature = 0, maxTokens = 4096 } = {}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  return {
    model: model || 'gpt-4.1',
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
}

/**
 * Sibling builder for reasoning-class OpenAI Chat Completions calls
 * (M7 / §3.5.2 reasoning-mode HOMP). Reasoning models (gpt-5.5-reasoning,
 * o-series) REJECT `max_tokens` + `temperature:0`: they require
 * `max_completion_tokens` and `temperature:1`. This builder emits exactly
 * that shape and deliberately OMITS `max_tokens`, so a malformed reasoning
 * call (the M7 bug) cannot slip through.
 *
 * `buildOpenAIPayload` is left untouched for the many non-reasoning callers
 * that import it.
 *
 * @param {object} opts
 * @param {string} [opts.model]
 * @param {string} [opts.systemPrompt]
 * @param {string}  opts.userPrompt
 * @param {number} [opts.maxCompletionTokens=4096]
 */
export function buildOpenAIReasoningPayload({ model, systemPrompt, userPrompt, maxCompletionTokens = 4096 } = {}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  return {
    model: model || 'gpt-4.1',
    messages,
    temperature: 1,                       // reasoning models require temperature:1
    max_completion_tokens: maxCompletionTokens, // NOT max_tokens
    stream: false,
  };
}

/** Pull the assistant text out of an OpenAI Chat Completions response. */
export function parseOpenAIResponse(json) {
  if (!json || !Array.isArray(json.choices) || json.choices.length === 0) return '';
  const c = json.choices[0];
  if (typeof c.message?.content === 'string') return c.message.content;
  return '';
}

// ─── OpenRouter single-key consolidation ─────────────────────────────────────
//
// When OPENROUTER_API_KEY is set, the OpenAI-compatible target/judge/HOMP
// lineages route through OpenRouter with ONE key, the model id rewritten to the
// OpenRouter slug. This lets a single key drive GPT-5.5, Kimi, MiniMax, MiMo and
// Qwen. Anthropic (Sonnet target — production parity), Gemini (no OpenRouter
// embeddings endpoint; SCS needs the direct API) and DeepSeek keep their direct
// paths. When OPENROUTER_API_KEY is unset every runner uses its direct endpoint
// exactly as before, so existing behaviour + tests are unchanged.
//
// NOTE (§3.6 reproducibility): OpenRouter may route open-weight models to a
// sub-provider whose quantisation/backend can vary. Fine for smoke + dev
// iteration; for the published HOMP (MiMo/Qwen) and judge numbers, pin the
// provider (provider.order + allow_fallbacks:false) or use the direct keys.
export const OPENROUTER_SLUGS = Object.freeze({
  'openai-api': 'openai/gpt-5.5',
  moonshot: 'moonshotai/kimi-k2.6',
  minimax: 'minimax/minimax-m2.7',
  mimo: 'xiaomi/mimo-v2.5-pro',
  qwen: 'qwen/qwen3.6-plus',
  dashscope: 'qwen/qwen3.6-plus',
});

/**
 * Resolve OpenRouter routing for a lineage when OPENROUTER_API_KEY is set.
 * @param {string} lineage
 * @returns {{apiKey:string, baseUrl:string, model:string, chatPath:string}|null}
 */
function resolveOpenRouter(lineage) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = OPENROUTER_SLUGS[lineage];
  if (!model) return null;
  // Optional provider pin: OPENROUTER_PROVIDER_<LINEAGE>=mara[,fireworks] → forces that
  // provider order with allow_fallbacks:false (reproducibility + a chosen fast provider).
  const pin = process.env[`OPENROUTER_PROVIDER_${lineage.toUpperCase()}`];
  return {
    apiKey,
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    model,
    chatPath: '/chat/completions',
    provider: pin ? { order: pin.split(',').map((s) => s.trim()), allow_fallbacks: false } : undefined,
  };
}

// ─── OpenAI Chat Completions (raw HTTPS, direct path) ────────────────────────
//
// `openai-api` lineage: stateless/batch judging without the codex CLI harness.
// Supports `reasoning_effort` for o1/o3-series models (passed via `extraBody`).
//
// Env: OPENAI_API_KEY

async function runOpenAIDirect({ model, systemPrompt, userPrompt, maxTokens, temperature, reasoningEffort, useCompletionTokens }, timeoutMs) {
  // OpenRouter single-key mode (preferred when set), else OPENAI_API_KEY direct.
  // OPENAI_BASE_URL still lets you point OpenAI-direct at a custom proxy.
  const or = resolveOpenRouter('openai-api');
  const apiKey = or?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('runOpenAIDirect: OPENAI_API_KEY not set in environment (or set OPENROUTER_API_KEY for OpenRouter routing)');
  }
  // OpenRouter has no gpt-5.5-instant SKU; approximate the non-reasoning target
  // by forcing minimal reasoning — UNLESS the caller explicitly requested
  // reasoning (M7/§3.5.2 reasoning-mode HOMP). reasoningEffort still wins.
  const orReasoningMin = or && !useCompletionTokens && !reasoningEffort
    ? { reasoning: { effort: 'minimal' } }
    : undefined;
  return runOpenAICompatible(
    {
      baseUrl: or?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      apiKey,
      model: or?.model ?? model,
      systemPrompt, userPrompt,
      temperature: temperature ?? 0,
      maxTokens: maxTokens ?? 4096,
      // M7/§3.5.2: when reasoning-class, switch to max_completion_tokens +
      // temperature:1. `reasoningEffort` is the o-series provider extension.
      useCompletionTokens: useCompletionTokens === true,
      extraBody: reasoningEffort ? { reasoning_effort: reasoningEffort } : orReasoningMin,
    },
    timeoutMs,
  );
}

// ─── Moonshot AI / Kimi (OpenAI-compatible) ───────────────────────────────────
//
// `moonshot` lineage. kimi- prefix heuristic routes here automatically.
// Default model: kimi-k2.6 (Kimi K2.6).
//
// Env: MOONSHOT_API_KEY

async function runMoonshotDirect({ model, systemPrompt, userPrompt, maxTokens, temperature }, timeoutMs) {
  const or = resolveOpenRouter('moonshot');
  const apiKey = or?.apiKey ?? process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    throw new Error('runMoonshotDirect: MOONSHOT_API_KEY not set in environment (or set OPENROUTER_API_KEY for OpenRouter routing)');
  }
  return runOpenAICompatible(
    {
      baseUrl: or?.baseUrl ?? 'https://api.moonshot.ai/v1',
      apiKey,
      model: or?.model ?? model ?? 'kimi-k2.6',
      systemPrompt, userPrompt,
      temperature: temperature ?? 0,
      maxTokens: maxTokens ?? 4096,
    },
    timeoutMs,
  );
}

// ─── MiniMax (OpenAI chat shape, non-standard path) ───────────────────────────
//
// `minimax` lineage. abab- prefix heuristic routes here automatically.
// Non-standard path: /text/chatcompletion_v2 (OpenAI response shape preserved).
// Default model: abab6.5s-chat (M2.7 family).
//
// Env: MINIMAX_API_KEY

async function runMiniMaxDirect({ model, systemPrompt, userPrompt, maxTokens, temperature }, timeoutMs) {
  const or = resolveOpenRouter('minimax');
  const apiKey = or?.apiKey ?? process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error('runMiniMaxDirect: MINIMAX_API_KEY not set in environment (or set OPENROUTER_API_KEY for OpenRouter routing)');
  }
  return runOpenAICompatible(
    {
      baseUrl: or?.baseUrl ?? 'https://api.minimax.io/v1',
      apiKey,
      model: or?.model ?? model ?? 'abab6.5s-chat',
      systemPrompt, userPrompt,
      temperature: temperature ?? 0,
      maxTokens: maxTokens ?? 4096,
      // MiniMax-direct uses a non-standard path; OpenRouter uses the standard one.
      chatPath: or?.chatPath ?? '/text/chatcompletion_v2',
      extraBody: or?.provider ? { provider: or.provider } : undefined,
    },
    timeoutMs,
  );
}

// ─── Xiaomi MiMo (OpenAI-compatible) ─────────────────────────────────────────
//
// `mimo` lineage. Key resolution (first-wins):
//   1. MIMO_API_KEY  → MiMo direct endpoint (https://api.mimo.ai/v1)
//   2. TOGETHER_API_KEY → Together.AI (https://api.together.xyz/v1)
//      with model mapped to MiMo's Together slug.
//
// Default model (MIMO_API_KEY path):   MiMo-V2.5-Pro
// Default model (TOGETHER_API_KEY path): xiaomi/MiMo-7B-RL-v2.5
//
// Env: MIMO_API_KEY (preferred) or TOGETHER_API_KEY (fallback)

async function runMiMoDirect({ model, systemPrompt, userPrompt, maxTokens, temperature }, timeoutMs) {
  const or = resolveOpenRouter('mimo');
  if (or) {
    return runOpenAICompatible(
      {
        baseUrl: or.baseUrl, apiKey: or.apiKey, model: or.model,
        systemPrompt, userPrompt,
        temperature: temperature ?? 0,
        maxTokens: maxTokens ?? 4096,
      },
      timeoutMs,
    );
  }
  const mimoKey = process.env.MIMO_API_KEY;
  const togetherKey = process.env.TOGETHER_API_KEY;
  if (!mimoKey && !togetherKey) {
    throw new Error('runMiMoDirect: set MIMO_API_KEY (direct) or TOGETHER_API_KEY (Together fallback) — or OPENROUTER_API_KEY for OpenRouter routing');
  }
  const apiKey = mimoKey || togetherKey;
  const baseUrl = mimoKey ? 'https://api.mimo.ai/v1' : 'https://api.together.xyz/v1';
  const defaultModel = mimoKey ? 'MiMo-V2.5-Pro' : 'xiaomi/MiMo-7B-RL-v2.5';
  return runOpenAICompatible(
    {
      baseUrl, apiKey,
      model: model || defaultModel,
      systemPrompt, userPrompt,
      temperature: temperature ?? 0,
      maxTokens: maxTokens ?? 4096,
    },
    timeoutMs,
  );
}

// ─── Qwen / DashScope (OpenAI-compatible) ─────────────────────────────────────
//
// `qwen` / `dashscope` lineage. qwen- prefix heuristic routes here.
// Key resolution (first-wins):
//   1. DASHSCOPE_API_KEY → Alibaba DashScope international endpoint
//   2. TOGETHER_API_KEY  → Together.AI (fallback)
//
// Note: §12 q5 uses the opencode CLI for the HOMP-B *agent* path.
// This runner is the stateless/DashScope path for direct judge calls.
//
// Default model (DASHSCOPE_API_KEY path): qwen3.6-plus
// Default model (TOGETHER_API_KEY path):  Qwen/Qwen2.5-72B-Instruct
//
// Env: DASHSCOPE_API_KEY (preferred) or TOGETHER_API_KEY (fallback)

async function runQwenDirect({ model, systemPrompt, userPrompt, maxTokens, temperature }, timeoutMs) {
  const or = resolveOpenRouter('qwen');
  if (or) {
    return runOpenAICompatible(
      {
        baseUrl: or.baseUrl, apiKey: or.apiKey, model: or.model,
        systemPrompt, userPrompt,
        temperature: temperature ?? 0,
        maxTokens: maxTokens ?? 4096,
      },
      timeoutMs,
    );
  }
  const dashscope = process.env.DASHSCOPE_API_KEY;
  const together = process.env.TOGETHER_API_KEY;
  if (!dashscope && !together) {
    throw new Error('runQwenDirect: set DASHSCOPE_API_KEY (DashScope) or TOGETHER_API_KEY (Together fallback) — or OPENROUTER_API_KEY for OpenRouter routing');
  }
  const apiKey = dashscope || together;
  const baseUrl = dashscope
    ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
    : 'https://api.together.xyz/v1';
  const defaultModel = dashscope ? 'qwen3.6-plus' : 'Qwen/Qwen2.5-72B-Instruct';
  return runOpenAICompatible(
    {
      baseUrl, apiKey,
      model: model || defaultModel,
      systemPrompt, userPrompt,
      temperature: temperature ?? 0,
      maxTokens: maxTokens ?? 4096,
    },
    timeoutMs,
  );
}

// ─── google / gemini CLI (agent mode) ─────────────────────────────────────
//
// gemini -p "<prompt>" --output-format json --model <model>
// For agent use (tool-accessible mode), we pass the system prompt and all
// sweet-search tool registrations. The gemini CLI supports -sandbox false
// and tool registrations similar to the claude CLI's --allowed-tools.

export async function runGeminiAgent(req) {
  const prompt = req.systemAppend
    ? `[SYSTEM]\n${req.systemAppend}\n\n[USER]\n${req.prompt}`
    : req.prompt;
  // gemini CLI flag set differs from claude CLI:
  //   - --sandbox is a boolean flag (no value)
  //   - --disallowed-tools does NOT exist; rely on --approval-mode + audit
  //   - --add-dir does NOT exist; use --include-directories <path,path>
  //   - --approval-mode yolo auto-approves tool calls (required headless)
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--model', req.model || 'gemini-3-flash-preview',
    '--approval-mode', 'yolo',
  ];
  if (req.allowedTools && req.allowedTools.length) {
    args.push('--allowed-tools', req.allowedTools.join(','));
  }
  if (req.addDirs && req.addDirs.length) {
    args.push('--include-directories', req.addDirs.join(','));
  }
  const env = { ...process.env };
  if (req.extraPathEntries && req.extraPathEntries.length) {
    env.PATH = [...req.extraPathEntries, env.PATH].filter(Boolean).join(':');
  }
  if (req.projectRoot) {
    env.SWEET_SEARCH_PROJECT_ROOT = req.projectRoot;
  }
  const timeoutMs = req.timeoutMs ?? 240000;
  const r = await spawnCapture('gemini', args, { timeoutMs, env, cwd: req.cwd });
  const parsed = parseStreamJsonOutput(r.stdout);
  return {
    cmd: ['gemini', ...redactGeminiArgs(args)].join(' '),
    cwd: req.cwd,
    exitCode: r.exitCode,
    spawnError: r.spawnError,
    timedOut: r.timedOut,
    wallMs: r.wallMs || 0,
    stderrPreview: (r.stderr || '').slice(0, 4000),
    rawByteLen: (r.stdout || '').length,
    ...parsed,
  };
}

function redactGeminiArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '-p' || a === '--prompt') && args[i + 1]) {
      out.push(a, `<${args[i + 1].length}-char prompt>`);
      i++;
    } else {
      out.push(a);
    }
  }
  return out;
}

function parseStreamJsonOutput(stdout) {
  if (!stdout) return { finalResultText: '', finalAssistantText: '', toolCalls: [], toolResults: [], isError: true };
  let lastAssistantText = '';
  let finalResultText = '';
  const toolCalls = [];
  const toolResults = [];
  let isError = false;

  // Try single JSON envelope first
  try {
    const obj = JSON.parse(stdout);
    if (typeof obj.result === 'string') finalResultText = obj.result;
    if (typeof obj.text === 'string') finalAssistantText = obj.text;
    if (typeof obj.response === 'string') finalResultText = obj.response;
    if (obj.isError) isError = true;
    return { finalResultText, finalAssistantText, toolCalls, toolResults, isError, resultEvent: obj };
  } catch { /* fall through to JSONL */ }

  // Try JSONL streaming form
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try {
      const ev = JSON.parse(t);
      if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
        for (const block of ev.message.content) {
          if (block.type === 'text') lastAssistantText += block.text || '';
          else if (block.type === 'tool_use') toolCalls.push(block);
        }
      } else if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
        for (const block of ev.message.content) {
          if (block.type === 'tool_result') toolResults.push(block);
        }
      } else if (ev.type === 'result') {
        if (typeof ev.result === 'string') finalResultText = ev.result;
        if (ev.isError) isError = true;
      } else if (typeof ev.text === 'string' && ev.text) lastAssistantText = ev.text;
      else if (typeof ev.response === 'string' && ev.response) finalResultText = ev.response;
    } catch { /* skip */ }
  }
  if (!finalResultText && lastAssistantText) finalResultText = lastAssistantText;
  return { finalResultText, finalAssistantText: lastAssistantText, toolCalls, toolResults, isError };
}

// ─── opencode (generic provider/model fallback) ─────────────────────────
//
// opencode run "<prompt>" --model <provider>/<model>
// Non-interactive; defaults to plain stdout. We also try `--format json`
// and parse defensively.

async function runOpencode({ model, systemPrompt, userPrompt }, timeoutMs) {
  const prompt = systemPrompt
    ? `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`
    : userPrompt;
  const args = ['run'];
  if (model) args.push('--model', model);
  // --format json is supported by recent opencode builds; if not, the JSON
  // parse falls through and we use raw stdout (still parseable text).
  args.push('--format', 'json');
  args.push(prompt);
  const r = await spawnCapture('opencode', args, { timeoutMs });
  return {
    text: parseOpencodeOutput(r.stdout),
    isError: r.exitCode !== 0 || r.timedOut,
    raw: { stdoutTail: r.stdout.slice(-2000), exitCode: r.exitCode },
  };
}

/**
 * opencode run --format json emits either a single envelope or JSONL.
 * Defensive: try JSON object → JSONL events → raw stdout.
 */
export function parseOpencodeOutput(stdout) {
  if (!stdout) return '';
  // Single envelope
  try {
    const obj = JSON.parse(stdout);
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.response === 'string') return obj.response;
    if (typeof obj.message === 'string') return obj.message;
    if (Array.isArray(obj.messages) && obj.messages.length > 0) {
      const last = obj.messages[obj.messages.length - 1];
      if (typeof last.content === 'string') return last.content;
    }
  } catch { /* */ }
  // JSONL
  let last = '';
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try {
      const ev = JSON.parse(t);
      const cand = ev.text || ev.message || ev.content || (ev.delta && ev.delta.text) || '';
      if (typeof cand === 'string' && cand) last = cand;
    } catch { /* */ }
  }
  if (last) return last;
  // Raw stdout fallback
  return stdout.trim();
}

// ─── subprocess helper (injectable for tests) ────────────────────────────

export const _internal = {
  spawn: nodeSpawn,
  fetch: globalThis.fetch,
  // Injectable sleep so the runJudge retry/backoff wrapper (CC3/B5/M6) does
  // not actually wait during unit tests.
  sleep,
};

async function spawnCapture(cmd, args, { timeoutMs, env = process.env, cwd } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const spawnOpts = { env, stdio: ['ignore', 'pipe', 'pipe'] };
    if (cwd) spawnOpts.cwd = cwd;
    const proc = _internal.spawn(cmd, args, spawnOpts);
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch { /* */ }
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* */ } }, 2000).unref();
    }, timeoutMs ?? DEFAULT_TIMEOUT_MS);
    proc.stdout?.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr?.on('data', (d) => { stderr += d.toString('utf8'); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + '\n' + err.message, exitCode: -1, timedOut, spawnError: err.message });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0, timedOut });
    });
  });
}
