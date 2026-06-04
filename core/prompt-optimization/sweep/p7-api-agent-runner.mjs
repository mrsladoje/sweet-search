import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { OPENROUTER_SLUGS } from '../../../eval/agent-read-workflows/judge-runner.js';

// Tool-call ceiling + timeouts are intentionally GENEROUS and env-configurable.
// They are runaway/hang guards only — NOT behavioural caps. Trajectory length is
// shaped by the evolved system prompt and PUNISHED by the calls-desirability term
// (weight 0.25), never truncated to a tight budget. Under LI/embedding contention
// a single ss-* tool call (and the whole run) can legitimately take many minutes;
// killing those would corrupt the accuracy signal. Set any *_TIMEOUT_MS env to 0
// to disable that timeout entirely (a hung lane then blocks the run — only do this
// when babysitting). `envInt` accepts 0; falls back to the default otherwise.
function envInt(name, dflt) {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
export const AGENT_TOOL_CALL_CAP = envInt('P7_AGENT_TOOL_CALL_CAP', 40);
const DEFAULT_TIMEOUT_MS = envInt('P7_AGENT_HTTP_TIMEOUT_MS', 1_800_000); // 30 min per model call
const TOOL_TIMEOUT_MS = envInt('P7_AGENT_TOOL_TIMEOUT_MS', 1_800_000);    // 30 min per tool exec
const MAX_TOOL_OUTPUT_CHARS = 12000;

export const _apiAgentInternal = {
  fetch: globalThis.fetch,
  spawn: nodeSpawn,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const BASH_TOOL = {
  name: 'Bash',
  description: 'Run one focused, read-only shell command in the repository. Prefer rg, grep, find, ls, sed -n, nl, cat, head, tail, wc, sort, and uniq. Network and file-modifying commands are blocked.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The read-only shell command to run.' },
    },
    required: ['command'],
    additionalProperties: false,
  },
};

const READ_TOOL = {
  name: 'Read',
  description: 'Read a focused slice of a text file from the repository. Use this after search results identify a likely file.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file, relative to the repository root.' },
      offset: { type: 'integer', description: '1-based starting line number.', minimum: 1 },
      limit: { type: 'integer', description: 'Maximum number of lines to read.', minimum: 1, maximum: 300 },
    },
    required: ['file_path'],
    additionalProperties: false,
  },
};

function apiAgentSystem(systemAppend) {
  return [
    systemAppend || '',
    'Tool interface: use Bash for focused read-only shell searches and Read for focused file slices. Do not modify files or use network access.',
  ].filter(Boolean).join('\n\n');
}

function openAITools() {
  return [BASH_TOOL, READ_TOOL].map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

const EPHEMERAL = Object.freeze({ type: 'ephemeral' });

// Anthropic prompt caching for the multi-turn tool loop. The cache prefix is
// ordered tools → system → messages, so a single breakpoint on `system` caches
// the static tools+system prefix, and a *rolling* breakpoint on the final
// content block caches the whole conversation prefix turn-over-turn (this is
// where the savings live — tool outputs up to MAX_TOOL_OUTPUT_CHARS are re-sent
// every turn). OpenRouter/OpenAI cache automatically and need no markers.
//
// We clone the message list rather than mutating the caller's growing array, so
// stale breakpoints can never accumulate past Anthropic's 4-breakpoint limit:
// every request carries exactly two (system + the current last block).
export function withRollingCache(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const out = messages.slice();
  const lastIdx = out.length - 1;
  const last = out[lastIdx];
  let content = last.content;
  if (typeof content === 'string') content = [{ type: 'text', text: content }];
  else if (Array.isArray(content)) content = content.slice();
  else return messages;
  if (content.length === 0) return messages;
  content[content.length - 1] = { ...content[content.length - 1], cache_control: EPHEMERAL };
  out[lastIdx] = { ...last, content };
  return out;
}

export function buildAnthropicAgentPayload({ model, systemPrompt, messages, maxTokens = 4096, thinkingBudget = 0 }) {
  const payload = {
    model: model || 'claude-sonnet-4-6',
    system: [{ type: 'text', text: apiAgentSystem(systemPrompt), cache_control: EPHEMERAL }],
    messages: withRollingCache(messages),
    max_tokens: maxTokens,
    temperature: 0,
    tools: [BASH_TOOL, READ_TOOL],
    tool_choice: { type: 'auto' },
  };
  if (thinkingBudget > 0) {
    // Extended thinking: requires temperature=1, and thinking tokens count toward max_tokens,
    // so max_tokens must exceed the budget (leave room for the answer afterwards).
    payload.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    payload.temperature = 1;
    if (payload.max_tokens <= thinkingBudget) payload.max_tokens = thinkingBudget + 4096;
  }
  return payload;
}

export function resolveOpenRouterAgentModel(model, provider = 'openrouter') {
  // DeepSeek direct API: strip the OpenRouter 'deepseek/' prefix → bare model id (e.g. deepseek-v4-pro).
  if (provider === 'deepseek') return String(model || 'deepseek-v4-pro').replace(/^deepseek\//, '');
  if (!model || /instant/i.test(model) || model === 'gpt-5.5') return OPENROUTER_SLUGS['openai-api'];
  return model.includes('/') ? model : `openai/${model}`;
}

export function buildOpenRouterAgentPayload({ model, systemPrompt, messages, maxTokens = 4096, reasoningEffort = 'minimal', toolChoice = 'auto', provider = 'openrouter' }) {
  const payload = {
    model: resolveOpenRouterAgentModel(model, provider),
    messages: [{ role: 'system', content: apiAgentSystem(systemPrompt) }, ...messages],
    temperature: 0,
    max_tokens: maxTokens,
    stream: false,
  };
  // Reasoning param differs by API: OpenRouter normalizes `reasoning:{effort}`; the DeepSeek direct
  // API (OpenAI-compatible) takes a top-level `reasoning_effort`.
  if (provider === 'deepseek') payload.reasoning_effort = reasoningEffort;
  else payload.reasoning = { effort: reasoningEffort };
  // toolChoice:'none' = force a final text answer. We OMIT the tools array entirely rather than
  // sending a soft tool_choice:'none' — DeepSeek-class models ignore the soft form and keep
  // emitting (rejected) tool calls; with no tools defined the model must emit content.
  if (toolChoice !== 'none') {
    payload.tools = openAITools();
    payload.tool_choice = toolChoice;
    payload.parallel_tool_calls = false;
  }
  return payload;
}

// ─── Trajectory circuit-breaker (opt-in) ───────────────────────────────────────
// Kills the no-match / hand-crawl SPIRAL without truncating productive long
// trajectories. Keys on PATHOLOGY, never raw call count:
//   1. duplicate (tool,input) → short-circuit: a re-run of an identical read-only
//      probe cannot return new info (the repo is static within a trajectory), so
//      we skip execution and reply with a nudge to change approach / conclude.
//   2. `emptyStopThreshold` consecutive empty-ish results → force the model to
//      answer now. A productive multi-file trace makes DIFFERENT calls returning
//      CONTENT, so it trips neither rule → accuracy preserved.
// Opt-in via `req.breaker` or `P7_BREAKER=1`; default OFF → byte-identical to the
// pre-breaker runner, so frozen baselines stay reproducible.
const BREAKER_EMPTY_STOP = envInt('P7_BREAKER_EMPTY_STOP', 5);
// Max raw-shell / native-Read ESCAPES tolerated in a sweet-search run before the
// hand-crawl spiral is force-stopped. Empirically separated (2026-05-31 capture):
// productive multi-file traces escape ≤7; the no-match decoy spirals escape 18–36.
// 10 leaves margin above the productive max yet halts the spiral by ~call 15.
const BREAKER_RAW_ESCAPE_BUDGET = envInt('P7_BREAKER_RAW_ESCAPE', 10);

// Mirrors the ss-* detection in validateBashCommand: a Bash command that invokes a
// sweet-search tool is a TOOL CALL; anything else (raw find/grep/cat/ls) is an escape.
const SS_CMD_RE = /(^|[\s;&|(])(?:sweet-search|ss-(?:search|find|semantic|trace|grep|read))\b/i;
export function isSweetSearchCommand(command) { return SS_CMD_RE.test(String(command || '')); }

// In a sweet-search run (ss-* available), an index ESCAPE is the native Read tool or
// any Bash command that is NOT an ss-* invocation. (Native baselines have no ss-*, so
// the caller passes ssAvailable=false and escapes are never counted.)
function isEscapeCall(tc) {
  if (tc?.name === 'Read') return true;
  if (tc?.name === 'Bash') return !isSweetSearchCommand(tc.input?.command);
  return false;
}

export function breakerFingerprint(tc) {
  if (tc?.name === 'Bash') return `Bash|${String(tc.input?.command || '').trim().replace(/\s+/g, ' ')}`;
  if (tc?.name === 'Read') {
    const p = String(tc.input?.file_path || tc.input?.path || '').trim();
    return `Read|${p}|${tc.input?.offset ?? ''}|${tc.input?.limit ?? ''}`;
  }
  return `${tc?.name}|${JSON.stringify(tc?.input || {})}`;
}

// Conservative empty-detection: only CLEAR negatives (error exit, empty body, or
// explicit no-match phrasing). A short but non-empty hit (e.g. one file:line) is
// NOT empty — we under-fire rather than risk cutting a productive trace.
export function isEmptyToolResult(out) {
  if (!out) return true;
  if (out.isError) return true; // grep exit 1, blocked command, timeout
  const body = String(out.content || '').replace(/^exit\s+-?\d+\s*\n?/, '').trim();
  if (body.length === 0) return true;
  if (/\b(no matches?|no results?|0 (results?|matches?|hits?)|not found|no relevant (hits?|matches?|results?))\b/i.test(body)) return true;
  return false;
}

const BREAKER_FORCE_MSG = 'Search halted: repeated or empty probes are not yielding new information. Give your final answer NOW from the evidence already gathered — name the file(s) and symbol(s), or, if every relevant probe came back empty, conclude no match found and name the checks you ran. Do not call any more tools.';

export function makeTrajectoryGuard({
  emptyStopThreshold = BREAKER_EMPTY_STOP,
  rawEscapeBudget = BREAKER_RAW_ESCAPE_BUDGET,
  ssAvailable = true,
} = {}) {
  const seen = new Map(); // fingerprint -> first call index (0-based tIndex)
  let consecutiveEmpty = 0;
  let duplicates = 0;
  let shortCircuits = 0;
  let rawEscapes = 0;
  let forced = false;
  return {
    // Consult BEFORE executing a tool call. → { action:'execute'|'short-circuit'|'force-stop', content? }
    inspect(tc) {
      if (forced) { shortCircuits++; return { action: 'force-stop', content: BREAKER_FORCE_MSG }; }
      // (3) raw-shell escape budget — the PRIMARY catch for the index→raw-shell spiral.
      // Only when ss-* tools are available; native baselines legitimately use raw shell.
      if (ssAvailable && isEscapeCall(tc)) {
        rawEscapes++;
        if (rawEscapes > rawEscapeBudget) {
          forced = true; shortCircuits++;
          return { action: 'force-stop', content: BREAKER_FORCE_MSG };
        }
      }
      // (1) exact-duplicate short-circuit — a re-run of an identical read-only probe.
      const fp = breakerFingerprint(tc);
      if (seen.has(fp)) {
        duplicates++; shortCircuits++; consecutiveEmpty++; // a duplicate yields no new info → spiral pressure
        if (consecutiveEmpty >= emptyStopThreshold) forced = true;
        return { action: 'short-circuit', content: `DUPLICATE of call #${seen.get(fp) + 1}: identical probe, result unchanged. Do not repeat it — change approach, or conclude per the absence rule if probes have come back empty.` };
      }
      seen.set(fp, tc.tIndex);
      return { action: 'execute' };
    },
    // Record the result of a REAL execution (skip for short-circuited calls).
    // (2) consecutive-empty hard-stop — catches all-empty spirals that evade (1)/(3).
    observe(out) {
      if (isEmptyToolResult(out)) consecutiveEmpty++; else consecutiveEmpty = 0;
      if (consecutiveEmpty >= emptyStopThreshold) forced = true;
    },
    stats() { return { duplicates, shortCircuits, rawEscapes, consecutiveEmpty, forced, emptyStopThreshold, rawEscapeBudget, ssAvailable }; },
  };
}

export async function runAnthropicApiAgent(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('runAnthropicApiAgent: ANTHROPIC_API_KEY not set');
  const started = Date.now();
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, max_input_tokens: 0 };
  const messages = [{ role: 'user', content: req.prompt }];
  const toolCalls = [];
  const guard = (req.breaker ?? process.env.P7_BREAKER === '1') ? makeTrajectoryGuard({ ssAvailable: !!req.allowSweetSearch }) : null;
  let finalText = '';
  let isError = false;
  let stderrPreview = '';
  let retryCount = 0;
  let timedOut = false;

  for (let round = 0; round < maxRounds(req); round++) {
    const body = buildAnthropicAgentPayload({ model: req.model, systemPrompt: req.systemAppend, messages, maxTokens: req.maxTokens, thinkingBudget: req.thinkingBudget });
    const r = await postAnthropic({ apiKey, body, timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    retryCount += r.retryCount || 0;
    addAnthropicUsage(usage, r.json?.usage);
    if (r.error) { isError = true; stderrPreview = r.error; timedOut = r.status === 'timeout'; break; }

    const content = Array.isArray(r.json.content) ? r.json.content : [];
    const text = content.filter((b) => b.type === 'text').map((b) => b.text || '').join('');
    const uses = content.filter((b) => b.type === 'tool_use');
    if (text) finalText = text;
    if (uses.length === 0) break;
    messages.push({ role: 'assistant', content });
    const results = [];
    for (const use of uses) {
      if (toolCalls.length >= (req.maxToolCalls ?? AGENT_TOOL_CALL_CAP)) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'tool call limit reached' });
        continue;
      }
      const tc = { id: use.id, name: use.name, input: use.input || {}, tIndex: toolCalls.length };
      toolCalls.push(tc);
      if (guard) {
        const g = guard.inspect(tc);
        if (g.action !== 'execute') {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: false, content: g.content });
          continue;
        }
      }
      const out = await executeTool(tc, req);
      guard?.observe(out);
      // Opt-in verbatim tool-RESULT capture (metric-forge USD scores the tool
      // RESPONSES, not the final answer). Default off → byte-identical frozen
      // baselines. Attached to the tc so it rides out on `toolCalls`.
      if (req.captureToolResults) tc.result = { isError: out.isError, content: out.content };
      results.push({ type: 'tool_result', tool_use_id: use.id, is_error: out.isError, content: out.content });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    toolCalls,
    breaker: guard ? guard.stats() : null,
    finalResultText: finalText,
    finalAssistantText: finalText,
    usage,
    modelUsed: req.model || 'claude-sonnet-4-6',
    apiPath: 'anthropic-messages-api',
    wallMs: Date.now() - started,
    isError,
    exitCode: isError ? 1 : 0,
    timedOut,
    retryCount,
    stderrPreview,
  };
}

export async function runOpenRouterApiAgent(req) {
  // DeepSeek must go via its OWN API (cheaper than OpenRouter's markup) — auto-route any deepseek
  // model to the direct provider unless the caller overrides req.provider.
  const provider = req.provider || (/(^|\/)deepseek/i.test(String(req.model || '')) ? 'deepseek' : 'openrouter');
  const apiKeyEnv = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENROUTER_API_KEY';
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) throw new Error(`runOpenRouterApiAgent: ${apiKeyEnv} not set`);
  const started = Date.now();
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, max_input_tokens: 0 };
  const messages = [{ role: 'user', content: req.prompt }];
  const toolCalls = [];
  const guard = (req.breaker ?? process.env.P7_BREAKER === '1') ? makeTrajectoryGuard({ ssAvailable: !!req.allowSweetSearch }) : null;
  let finalText = '';
  let isError = false;
  let stderrPreview = '';
  let emptyTurns = 0;
  let emptyRetries = 0;
  let retryCount = 0;
  let timedOut = false;
  let forcedAnswerInjected = false;

  for (let round = 0; round < maxRounds(req); round++) {
    // Once the tool budget is exhausted, FORCE a final answer instead of relying on the model to
    // volunteer one. DeepSeek-class models ignore a soft tool_choice:'none' and keep emitting
    // (rejected) tool calls or go silent → finalText empty/truncated → judged ~0. So we (a) inject
    // an explicit "answer now" turn and (b) omit the tools array (no tools → must emit text).
    const capReached = toolCalls.length >= (req.maxToolCalls ?? AGENT_TOOL_CALL_CAP);
    if (capReached && !forcedAnswerInjected) {
      messages.push({ role: 'user', content: 'You have used all available tool calls. Do not request more tools. Write your final answer now from the evidence gathered above — cite the relevant files, symbols, and facts. If no relevant match was found, say "no match found" and name what you checked.' });
      forcedAnswerInjected = true;
    }
    const body = buildOpenRouterAgentPayload({ model: req.model, systemPrompt: req.systemAppend, messages, reasoningEffort: req.reasoningEffort, maxTokens: req.maxTokens, toolChoice: capReached ? 'none' : 'auto', provider });
    const r = await postOpenRouter({ apiKey, body, timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS, provider });
    retryCount += r.retryCount || 0;
    addOpenAIUsage(usage, r.json?.usage);
    if (r.error) { isError = true; stderrPreview = r.error; timedOut = r.status === 'timeout'; break; }

    const msg = r.json.choices?.[0]?.message || {};
    if (typeof msg.content === 'string' && msg.content) finalText = msg.content;
    const uses = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    // Transient empty completion: DeepSeek occasionally returns no content + no tool calls with
    // finish_reason 'stop' (proven recoverable on a fresh roll — it asymmetrically zeroed native runs).
    // Re-POST the SAME request a few times before the nudge/error path; round-- keeps these retries
    // off the round budget. Skip finish_reason 'length' (genuine truncation — a re-roll won't help).
    const finishReason = r.json.choices?.[0]?.finish_reason;
    if (uses.length === 0 && !(typeof msg.content === 'string' && msg.content.trim()) && finishReason !== 'length' && emptyRetries < 3) {
      emptyRetries++; round--; continue;
    }
    if (uses.length === 0) {
      // DeepSeek-class models, when forced off tools but not yet ready to answer, sometimes emit
      // their NATIVE tool-call markup (DSML / <|tool_calls|> / invoke name=) as plain text. That is a
      // failed search, not an answer — don't let it stand; re-prompt for prose only (allow 2 nudges).
      const markup = finalText && looksLikeToolMarkup(finalText);
      if (finalText && !markup) break;
      if (emptyTurns < 2) {
        emptyTurns++;
        if (markup) finalText = '';
        messages.push({ role: 'user', content: markup
          ? 'Do NOT emit tool-call syntax, function calls, or markup of any kind. Respond with a plain prose answer ONLY, based on the evidence already gathered. If you could not determine the answer, write "no match found" and list what you checked.'
          : (toolCalls.length > 0 ? 'No final answer was emitted. Based on the tool results above, answer the original task now. If the checks found no relevant match, say no match found and name the checks run.' : 'No tool call or final answer was emitted. Use the available Bash/Read tools to investigate the original task, then answer with cited files and facts.') });
        continue;
      }
      isError = true;
      stderrPreview = `empty assistant message after ${toolCalls.length} tool call(s)`;
      break;
    }
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: uses });
    for (const use of uses) {
      const name = use.function?.name || use.name;
      const input = parseJsonArgs(use.function?.arguments);
      const tc = { id: use.id, name, input, tIndex: toolCalls.length };
      if (toolCalls.length >= (req.maxToolCalls ?? AGENT_TOOL_CALL_CAP)) {
        messages.push({ role: 'tool', tool_call_id: use.id, content: 'tool call limit reached' });
        continue;
      }
      toolCalls.push(tc);
      if (guard) {
        const g = guard.inspect(tc);
        if (g.action !== 'execute') {
          messages.push({ role: 'tool', tool_call_id: use.id, content: g.content });
          continue;
        }
      }
      const out = await executeTool(tc, req);
      guard?.observe(out);
      if (req.captureToolResults) tc.result = { isError: out.isError, content: out.content };
      messages.push({ role: 'tool', tool_call_id: use.id, content: out.content });
    }
  }

  return {
    toolCalls,
    breaker: guard ? guard.stats() : null,
    finalResultText: finalText,
    finalAssistantText: finalText,
    usage,
    modelUsed: resolveOpenRouterAgentModel(req.model, provider),
    apiPath: provider === 'deepseek' ? 'deepseek-chat-completions' : 'openrouter-chat-completions',
    wallMs: Date.now() - started,
    isError,
    exitCode: isError ? 1 : 0,
    timedOut,
    retryCount,
    stderrPreview,
  };
}

// ─── transient-error retry for the paid agent HTTP calls ─────────────────────
//
// The agent loop is the expensive surface (~1330 runs/gen-1). A transient 429,
// 5xx, or network blip MUST NOT silently become an empty answer (→ judged ~0 →
// contaminated probe score / mis-shaped Pareto front). The judges already retry
// (judge-runner.js classifyResponseStatus); the agent runners did not. This
// mirrors that ladder:
//   429            → retry, honoring Retry-After (capped), bounded by the ladder
//   5xx / network  → retry (bounded by AGENT_MAX_SERVER_RETRIES)
//   4xx (non-429)  → fatal, no retry (config error — retrying can't help)
//   our timeout    → fatal, no retry (the AbortController already waited the full
//                    P7_AGENT_HTTP_TIMEOUT_MS; a retry just re-waits 30 min)
const AGENT_BACKOFF_LADDER_MS = [1000, 2000, 4000, 8000, 16000];
const AGENT_MAX_RATE_LIMIT_RETRIES = AGENT_BACKOFF_LADDER_MS.length;
const AGENT_MAX_SERVER_RETRIES = 2;
const RETRY_AFTER_CAP_MS = 60_000;

/** Pure disposition for an ERRORED postJson result's `status`. */
export function classifyAgentStatus(status) {
  if (status === 429) return 'retry-rate-limit';
  if (typeof status === 'number' && status >= 500 && status < 600) return 'retry-server';
  if (status === 'network') return 'retry-server';
  return 'fatal'; // 4xx, our 'timeout' abort, or anything unrecognized
}

function backoffMs(n) {
  return AGENT_BACKOFF_LADDER_MS[Math.min(n, AGENT_BACKOFF_LADDER_MS.length - 1)];
}

function readRetryAfter(res) {
  try {
    return res && res.headers && typeof res.headers.get === 'function'
      ? (res.headers.get('retry-after') ?? undefined)
      : undefined;
  } catch { return undefined; }
}

/** Parse a Retry-After header (seconds or HTTP-date) into ms, or null. */
function retryAfterMs(raw) {
  if (raw == null) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

/**
 * POST with bounded retry on transient failures. Returns the same shape as
 * postJson plus `retryCount` (number of retries spent; 0 on first-try success
 * or a fatal first response).
 */
async function postJsonWithRetry(url, headers, body, timeoutMs, fetchFn) {
  const sleep = _apiAgentInternal.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let rateRetries = 0;
  let serverRetries = 0;
  let attempts = 0;
  for (;;) {
    const res = await postJson(url, headers, body, timeoutMs, fetchFn);
    if (!res.error) return { ...res, retryCount: attempts };
    const disp = classifyAgentStatus(res.status);
    if (disp === 'retry-rate-limit' && rateRetries < AGENT_MAX_RATE_LIMIT_RETRIES) {
      const ra = retryAfterMs(res.retryAfter);
      const wait = ra != null ? Math.min(ra, RETRY_AFTER_CAP_MS) : backoffMs(rateRetries);
      rateRetries += 1; attempts += 1;
      await sleep(wait);
      continue;
    }
    if (disp === 'retry-server' && serverRetries < AGENT_MAX_SERVER_RETRIES) {
      await sleep(backoffMs(serverRetries));
      serverRetries += 1; attempts += 1;
      continue;
    }
    return { ...res, retryCount: attempts };
  }
}

async function postAnthropic({ apiKey, body, timeoutMs }) {
  const fetchFn = _apiAgentInternal.fetch || globalThis.fetch;
  return postJsonWithRetry('https://api.anthropic.com/v1/messages', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, body, timeoutMs, fetchFn);
}

async function postOpenRouter({ apiKey, body, timeoutMs, provider = 'openrouter' }) {
  const fetchFn = _apiAgentInternal.fetch || globalThis.fetch;
  const base = provider === 'deepseek'
    ? (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1')
    : (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1');
  const headers = {};
  if (provider !== 'deepseek') {
    if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
    if (process.env.OPENROUTER_APP_NAME) headers['X-Title'] = process.env.OPENROUTER_APP_NAME;
  }
  return postJsonWithRetry(`${base}/chat/completions`, { ...headers, Authorization: `Bearer ${apiKey}` }, body, timeoutMs, fetchFn);
}

async function postJson(url, headers, body, timeoutMs, fetchFn) {
  if (typeof fetchFn !== 'function') throw new Error('API agent runner requires fetch');
  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}: ${text.slice(0, 1000)}`, json: null, status: res.status, retryAfter: readRetryAfter(res) };
    }
    return { error: null, json: await res.json(), status: res.status };
  } catch (e) {
    // Our own AbortController timeout fires AbortError; treat that as fatal (a
    // retry would just re-wait the full timeout). Any other throw is a transient
    // network fault (ECONNRESET / "fetch failed") and is retryable.
    const status = e?.name === 'AbortError' ? 'timeout' : 'network';
    return { error: e?.message || String(e), json: null, status };
  } finally {
    clearTimeout(timer);
  }
}

async function executeTool(tc, req) {
  if (tc.name === 'Read') return readTool(tc.input, req);
  if (tc.name === 'Bash') return bashTool(tc.input, req);
  return { isError: true, content: `unknown tool: ${tc.name}` };
}

async function bashTool(input, req) {
  const command = String(input?.command || '').trim();
  const validation = validateBashCommand(command, { allowSweetSearch: !!req.allowSweetSearch });
  if (!validation.ok) return { isError: true, content: validation.message };
  const esc = bashEscapesRepo(command, req.cwd);
  if (esc) return { isError: true, content: `blocked: command reaches outside the task repository (${esc}). Search only within the current repo — use relative paths.` };
  const env = { ...process.env, SWEET_SEARCH_PROJECT_ROOT: req.cwd };
  if (req.sweetSearchBinDir) env.PATH = [req.sweetSearchBinDir, env.PATH].filter(Boolean).join(':');
  const run = await spawnCapture('/bin/zsh', ['-lc', command], { cwd: req.cwd, env, timeoutMs: req.toolTimeoutMs ?? TOOL_TIMEOUT_MS });
  const content = [`exit ${run.exitCode}`, run.stdout, run.stderr && `stderr:\n${run.stderr}`].filter(Boolean).join('\n');
  return { isError: run.exitCode !== 0 || run.timedOut, content: truncate(content, req.maxToolOutputChars ?? MAX_TOOL_OUTPUT_CHARS) };
}

function readTool(input, req) {
  const rel = String(input?.file_path || input?.path || '').trim();
  if (!rel) return { isError: true, content: 'file_path is required' };
  const resolved = path.resolve(req.cwd, rel);
  if (!isInside(req.cwd, resolved)) return { isError: true, content: 'path escapes repository root' };
  if (!req.allowSweetSearch && hasSweetSearchPath(resolved)) return { isError: true, content: '.sweet-search reads are blocked' };
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { isError: true, content: 'path is not a file' };
    const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
    const start = Math.max(1, Number.parseInt(input?.offset ?? 1, 10) || 1);
    // Read budget is per-request so the native baseline can match real harnesses (Claude Code reads
    // ~2000 lines/call). Defaults preserved (300-line cap, 200 default) so GEPA stays byte-identical;
    // the vault runners opt into real-agent parity via req.maxReadLines / req.maxToolOutputChars.
    const cap = Math.max(1, req.maxReadLines ?? 300);
    const defaultLimit = req.maxReadLines ? cap : 200;
    const limit = Math.min(cap, Math.max(1, Number.parseInt(input?.limit ?? defaultLimit, 10) || defaultLimit));
    const out = lines.slice(start - 1, start - 1 + limit).map((line, i) => `${start + i}\t${line}`).join('\n');
    return { isError: false, content: truncate(out, req.maxToolOutputChars ?? MAX_TOOL_OUTPUT_CHARS) };
  } catch (e) {
    return { isError: true, content: e?.message || String(e) };
  }
}

export function validateBashCommand(command, { allowSweetSearch = false } = {}) {
  if (!command) return { ok: false, message: 'empty command blocked' };
  if (!allowSweetSearch && /(^|[\s;&|])(?:sweet-search|ss-(search|find|semantic|trace|grep|read))\b/i.test(command)) {
    return { ok: false, message: 'sweet-search commands are blocked for native baseline runs' };
  }
  if (!allowSweetSearch && commandReadsSweetSearch(command)) {
    return { ok: false, message: '.sweet-search reads are blocked for native baseline runs' };
  }
  const withoutStderrNull = command.replace(/\s+2>\/dev\/null/g, '');
  if (/(^|[^<])>>?/.test(withoutStderrNull) || /<<\w*/.test(command)) {
    return { ok: false, message: 'shell redirection/heredoc is blocked' };
  }
  const denied = /\b(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|sudo|curl|wget|ssh|scp|rsync)\b|\bgit\s+(reset|checkout|clean|commit|push|pull|fetch|merge|rebase)\b|\bnpm\s+(install|publish)\b|\b(pnpm|yarn)\s+(install|add|publish)\b|\bsed\s+-i\b|\bperl\s+-pi\b/i;
  if (denied.test(command)) return { ok: false, message: 'write, network, or destructive command blocked' };
  return { ok: true, message: 'ok' };
}

function commandReadsSweetSearch(command) {
  const withoutExcludes = command
    .replace(/(["'])!\/?\.sweet-search\/\*\*\1/g, '')
    .replace(/!\/?\.sweet-search\/\*\*/g, '');
  return /(^|[\s"'`/])\.sweet-search(\/|$)/.test(withoutExcludes) || /\/\.sweet-search(\/|$)/.test(withoutExcludes);
}

// Eval-integrity guard: the probe repos are nested inside the eval project, so a Bash `cd` /
// absolute-path / `../` could reach our gold-answer/spec files or grep the whole project tree
// (a leak + a perf confound — observed once in a thin harness). readTool already scopes Read;
// this scopes Bash. Returns the offending token (→ block) or null. Repo-scoped agents never
// legitimately need to leave their repo, so this only ever blocks escapes, not real searches.
const ESCAPE_ANSWER_RE = /(gold\/|data\/frozen|data\/results|p7-vault-probes|p7-heldout|p7-dev-probes|prompt-optimization\/data)/;
export function bashEscapesRepo(command, cwd) {
  if (!cwd || !command) return null;
  if (ESCAPE_ANSWER_RE.test(command)) return 'answer/spec files';
  for (const m of command.matchAll(/\/[^\s;&|)'"`]*sweet-search-private[^\s;&|)'"`]*/g)) {
    if (!isInside(cwd, m[0])) return m[0];
  }
  for (const m of command.matchAll(/\b(?:cd|pushd)\s+([^\s;&|]+)/g)) {
    const t = m[1].replace(/^["']|["']$/g, '');
    if (t && !isInside(cwd, path.resolve(cwd, t))) return `cd ${t}`;
  }
  for (const m of command.matchAll(/(?:^|\s)(\.\.\/[^\s;&|]*)/g)) {
    if (!isInside(cwd, path.resolve(cwd, m[1]))) return m[1];
  }
  return null;
}

function maxRounds(req) {
  return Math.max(1, (req.maxToolCalls ?? AGENT_TOOL_CALL_CAP) + 2);
}

export function addAnthropicUsage(total, usage) {
  if (!usage) return;
  const input = num(usage.input_tokens);
  total.input_tokens += input;
  total.output_tokens += num(usage.output_tokens);
  total.provider_cache_read_input_tokens = (total.provider_cache_read_input_tokens ?? 0) + num(usage.cache_read_input_tokens);
  // First-occurrence (cache-write) tokens — excluded from input_tokens by the
  // API. The rolling cache routes the bulk of unique input here; sum it so the
  // work-token metric reflects real work, not just output (see agentTokenCount).
  total.cache_creation_input_tokens = (total.cache_creation_input_tokens ?? 0) + num(usage.cache_creation_input_tokens);
  total.max_input_tokens = Math.max(total.max_input_tokens ?? 0, input);
  total.cache_read_input_tokens = Math.max(total.provider_cache_read_input_tokens, total.input_tokens - total.max_input_tokens);
}

export function addOpenAIUsage(total, usage) {
  if (!usage) return;
  const input = num(usage.input_tokens ?? usage.prompt_tokens);
  total.input_tokens += input;
  total.output_tokens += num(usage.output_tokens ?? usage.completion_tokens);
  total.provider_cached_input_tokens = (total.provider_cached_input_tokens ?? 0) + openAICachedTokens(usage);
  total.max_input_tokens = Math.max(total.max_input_tokens ?? 0, input);
  total.cached_input_tokens = Math.max(total.provider_cached_input_tokens, total.input_tokens - total.max_input_tokens);
}

function openAICachedTokens(usage) {
  return num(
    usage.cached_input_tokens ??
    usage.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens,
  );
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseJsonArgs(s) {
  if (!s || typeof s !== 'string') return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function isInside(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function hasSweetSearchPath(file) {
  return file.split(path.sep).includes('.sweet-search');
}

// Detects a model emitting its native tool-call markup as TEXT content (a failed search leaking
// through, not a real answer): DeepSeek DSML, <|tool_calls|>, antml-style `invoke name=`, etc.
function looksLikeToolMarkup(text) {
  if (!text) return false;
  const head = text.slice(0, 800);
  return /DSML|invoke\s+name=|tool▁calls|<\|tool_calls\|>|<function_calls>|<\|python_tag\|>/i.test(head);
}

function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max)}\n[truncated]` : s;
}

async function spawnCapture(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const proc = _apiAgentInternal.spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch { /* noop */ }
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* noop */ } }, 1000).unref();
    }, timeoutMs) : null;
    proc.stdout?.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr?.on('data', (d) => { stderr += d.toString('utf8'); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${err.message}`, exitCode: -1, timedOut });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0, timedOut });
    });
  });
}
