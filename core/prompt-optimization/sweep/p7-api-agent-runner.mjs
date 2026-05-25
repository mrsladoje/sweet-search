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

export function buildAnthropicAgentPayload({ model, systemPrompt, messages, maxTokens = 4096 }) {
  return {
    model: model || 'claude-sonnet-4-6',
    system: [{ type: 'text', text: apiAgentSystem(systemPrompt), cache_control: EPHEMERAL }],
    messages: withRollingCache(messages),
    max_tokens: maxTokens,
    temperature: 0,
    tools: [BASH_TOOL, READ_TOOL],
    tool_choice: { type: 'auto' },
  };
}

export function resolveOpenRouterAgentModel(model) {
  if (!model || /instant/i.test(model) || model === 'gpt-5.5') return OPENROUTER_SLUGS['openai-api'];
  return model.includes('/') ? model : `openai/${model}`;
}

export function buildOpenRouterAgentPayload({ model, systemPrompt, messages, maxTokens = 4096 }) {
  return {
    model: resolveOpenRouterAgentModel(model),
    messages: [{ role: 'system', content: apiAgentSystem(systemPrompt) }, ...messages],
    temperature: 0,
    max_tokens: maxTokens,
    stream: false,
    tools: openAITools(),
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: 'minimal' },
  };
}

export async function runAnthropicApiAgent(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('runAnthropicApiAgent: ANTHROPIC_API_KEY not set');
  const started = Date.now();
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, max_input_tokens: 0 };
  const messages = [{ role: 'user', content: req.prompt }];
  const toolCalls = [];
  let finalText = '';
  let isError = false;
  let stderrPreview = '';

  for (let round = 0; round < maxRounds(req); round++) {
    const body = buildAnthropicAgentPayload({ model: req.model, systemPrompt: req.systemAppend, messages });
    const r = await postAnthropic({ apiKey, body, timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    addAnthropicUsage(usage, r.json?.usage);
    if (r.error) { isError = true; stderrPreview = r.error; break; }

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
      const out = await executeTool(tc, req);
      results.push({ type: 'tool_result', tool_use_id: use.id, is_error: out.isError, content: out.content });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    toolCalls,
    finalResultText: finalText,
    finalAssistantText: finalText,
    usage,
    modelUsed: req.model || 'claude-sonnet-4-6',
    apiPath: 'anthropic-messages-api',
    wallMs: Date.now() - started,
    isError,
    exitCode: isError ? 1 : 0,
    timedOut: false,
    stderrPreview,
  };
}

export async function runOpenRouterApiAgent(req) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('runOpenRouterApiAgent: OPENROUTER_API_KEY not set');
  const started = Date.now();
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, max_input_tokens: 0 };
  const messages = [{ role: 'user', content: req.prompt }];
  const toolCalls = [];
  let finalText = '';
  let isError = false;
  let stderrPreview = '';
  let emptyTurns = 0;

  for (let round = 0; round < maxRounds(req); round++) {
    const body = buildOpenRouterAgentPayload({ model: req.model, systemPrompt: req.systemAppend, messages });
    const r = await postOpenRouter({ apiKey, body, timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    addOpenAIUsage(usage, r.json?.usage);
    if (r.error) { isError = true; stderrPreview = r.error; break; }

    const msg = r.json.choices?.[0]?.message || {};
    if (typeof msg.content === 'string' && msg.content) finalText = msg.content;
    const uses = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (uses.length === 0) {
      if (finalText) break;
      if (emptyTurns === 0) {
        emptyTurns++;
        messages.push({ role: 'user', content: toolCalls.length > 0 ? 'No final answer was emitted. Based on the tool results above, answer the original task now. If the checks found no relevant match, say no match found and name the checks run.' : 'No tool call or final answer was emitted. Use the available Bash/Read tools to investigate the original task, then answer with cited files and facts.' });
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
      const out = await executeTool(tc, req);
      messages.push({ role: 'tool', tool_call_id: use.id, content: out.content });
    }
  }

  return {
    toolCalls,
    finalResultText: finalText,
    finalAssistantText: finalText,
    usage,
    modelUsed: resolveOpenRouterAgentModel(req.model),
    apiPath: 'openrouter-chat-completions',
    wallMs: Date.now() - started,
    isError,
    exitCode: isError ? 1 : 0,
    timedOut: false,
    stderrPreview,
  };
}

async function postAnthropic({ apiKey, body, timeoutMs }) {
  const fetchFn = _apiAgentInternal.fetch || globalThis.fetch;
  const res = await postJson('https://api.anthropic.com/v1/messages', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, body, timeoutMs, fetchFn);
  return res;
}

async function postOpenRouter({ apiKey, body, timeoutMs }) {
  const fetchFn = _apiAgentInternal.fetch || globalThis.fetch;
  const base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const headers = {};
  if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_NAME) headers['X-Title'] = process.env.OPENROUTER_APP_NAME;
  return postJson(`${base}/chat/completions`, { ...headers, Authorization: `Bearer ${apiKey}` }, body, timeoutMs, fetchFn);
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
      return { error: `HTTP ${res.status}: ${text.slice(0, 1000)}`, json: null };
    }
    return { error: null, json: await res.json() };
  } catch (e) {
    return { error: e?.message || String(e), json: null };
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
  const env = { ...process.env, SWEET_SEARCH_PROJECT_ROOT: req.cwd };
  if (req.sweetSearchBinDir) env.PATH = [req.sweetSearchBinDir, env.PATH].filter(Boolean).join(':');
  const run = await spawnCapture('/bin/zsh', ['-lc', command], { cwd: req.cwd, env, timeoutMs: req.toolTimeoutMs ?? TOOL_TIMEOUT_MS });
  const content = [`exit ${run.exitCode}`, run.stdout, run.stderr && `stderr:\n${run.stderr}`].filter(Boolean).join('\n');
  return { isError: run.exitCode !== 0 || run.timedOut, content: truncate(content, MAX_TOOL_OUTPUT_CHARS) };
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
    const limit = Math.min(300, Math.max(1, Number.parseInt(input?.limit ?? 200, 10) || 200));
    const out = lines.slice(start - 1, start - 1 + limit).map((line, i) => `${start + i}\t${line}`).join('\n');
    return { isError: false, content: truncate(out, MAX_TOOL_OUTPUT_CHARS) };
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
