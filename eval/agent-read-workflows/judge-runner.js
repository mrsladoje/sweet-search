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
  if (lc.startsWith('llama-') || lc.startsWith('qwen') || lc.startsWith('mistral-') || lc.startsWith('command-')) {
    return { lineage: 'opencode', model: spec };
  }
  throw new RangeError(
    `parseJudgeModelSpec: cannot infer lineage from "${spec}" — use explicit "lineage:model" form ` +
    `(anthropic|openai|google|deepseek|opencode)`,
  );
}

function isKnownLineage(s) {
  return ['anthropic', 'openai', 'google', 'google-api', 'deepseek', 'deepseek-api', 'opencode'].includes(s);
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
  const t0 = Date.now();
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let r;
  try {
    switch (req.lineage) {
      case 'anthropic':    r = await runAnthropic(req); break;
      case 'openai':       r = await runCodex(req, timeoutMs); break;
      case 'google':       r = await runGemini(req, timeoutMs); break;
      case 'google-api':   r = await runGeminiDirect(req, timeoutMs); break;
      case 'deepseek':     r = await runDeepseekViaClaude(req, timeoutMs); break;
      case 'deepseek-api': r = await runDeepseekDirect(req, timeoutMs); break;
      case 'opencode':     r = await runOpencode(req, timeoutMs); break;
      default: throw new Error(`runJudge: unknown lineage ${req.lineage}`);
    }
  } catch (e) {
    return {
      lineage: req.lineage, model: req.model,
      text: '', isError: true, error: e.message || String(e),
      latencyMs: Date.now() - t0,
    };
  }
  return { ...r, lineage: req.lineage, model: req.model, latencyMs: Date.now() - t0 };
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
      return {
        text: '', isError: true, raw: { status: res.status, body: errText.slice(0, 1000), viaHarness: 'raw-api' },
      };
    }
    const json = await res.json();
    return {
      text: parseDeepseekResponse(json),
      isError: false,
      raw: { usage: json.usage, model: json.model, viaHarness: 'raw-api' },
    };
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
      return {
        text: '', isError: true, raw: { status: res.status, body: errText.slice(0, 1000), viaHarness: 'raw-api' },
      };
    }
    const json = await res.json();
    return {
      text: parseGeminiDirectResponse(json),
      isError: false,
      raw: { usage: json.usageMetadata, model: json.modelVersion, viaHarness: 'raw-api' },
    };
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
