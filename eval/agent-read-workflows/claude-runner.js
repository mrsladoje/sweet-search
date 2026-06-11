// Spawn `claude -p` in headless mode, capture the full stream-json event log,
// and parse out: tool calls (with full input), final assistant text, usage
// tokens, cost, errors. Returns a structured run record for downstream
// scoring + audit.
//
// CLI version checked: 2.1.126 (no --max-turns flag exists, so we enforce a
// wall-clock timeout instead and ask the model in-prompt to stay under N
// tool calls). See repo `claude --help` for the live flag surface.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {Object} req
 * @param {string} req.prompt          User prompt (the task)
 * @param {string} req.systemAppend    Text appended to default system prompt
 * @param {string} req.model           e.g. 'haiku'
 * @param {string} req.cwd             Working directory (the repo)
 * @param {string[]} [req.allowedTools]
 * @param {string[]} [req.disallowedTools]
 * @param {string[]} [req.addDirs]     Extra --add-dir entries (e.g. for sweet-search CLI access)
 * @param {number} [req.timeoutMs=180000]
 * @param {string} [req.logPath]       If set, dump raw stream-json to this path
 * @returns {Promise<Object>}
 */
export async function runClaudeAgent(req) {
  const parsedAttempts = Number.parseInt(req.maxAttempts || 1, 10);
  const maxAttempts = Number.isFinite(parsedAttempts) ? Math.max(1, Math.min(3, parsedAttempts)) : 1;
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const run = await runClaudeAgentOnce(req);
    attempts.push({
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      isError: run.isError,
      wallMs: run.wallMs,
      rawByteLen: run.rawByteLen,
      finalPreview: String(run.finalResultText || run.finalAssistantText || '').slice(0, 160),
      stderrPreview: String(run.stderrPreview || '').slice(0, 160),
    });
    if (!isTransientRunFailure(run) || attempt === maxAttempts) {
      return { ...run, attempts: attempt, retryCount: attempt - 1, attemptSummaries: attempts };
    }
    await new Promise(resolve => setTimeout(resolve, 750 * attempt));
  }
}

async function runClaudeAgentOnce(req) {
  const args = [
    '-p', req.prompt,
    '--model', req.model,
    '--output-format', 'stream-json',
    '--verbose',                                // required for stream-json
    '--no-session-persistence',
    '--dangerously-skip-permissions',           // headless: cannot prompt for permission
    '--append-system-prompt', req.systemAppend,
  ];
  if (req.allowedTools && req.allowedTools.length) {
    args.push('--allowed-tools', req.allowedTools.join(' '));
  }
  if (req.disallowedTools && req.disallowedTools.length) {
    args.push('--disallowed-tools', req.disallowedTools.join(' '));
  }
  if (req.addDirs && req.addDirs.length) {
    for (const d of req.addDirs) args.push('--add-dir', d);
  }
  // Pass-through for lean-run flags (e.g. --strict-mcp-config --mcp-config '{"mcpServers":{}}'
  // --setting-sources project) so callers can disable MCP servers + user hooks.
  if (req.extraArgs && req.extraArgs.length) args.push(...req.extraArgs);

  // Prepend the bench's bin/ shim to PATH so spawned agents can call
  // `sweet-search ...` without a global install. The shim execs node on
  // core/cli.js. Native-mode policy still forbids any sweet-search use, so
  // making the binary discoverable here doesn't bias native runs.
  const env = { ...process.env };
  // Force OAuth/subscription auth for the SPAWNED agent only, without touching
  // the caller's env (in-process judge calls still need ANTHROPIC_API_KEY).
  if (req.stripApiKey) delete env.ANTHROPIC_API_KEY;
  if (req.extraPathEntries && req.extraPathEntries.length) {
    env.PATH = [...req.extraPathEntries, env.PATH].filter(Boolean).join(':');
  }
  // Propagate the bench's repo identity into the spawned claude env so that
  // ss-search calls inside the agent loop see the same projectRoot the bench
  // warmed the daemon for. This belts-and-suspenders the cwd-based default.
  if (req.projectRoot) {
    env.SWEET_SEARCH_PROJECT_ROOT = req.projectRoot;
  }

  const t0 = Date.now();
  const proc = spawn('claude', args, {
    cwd: req.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill('SIGTERM'); } catch { /* */ }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* */ } }, 2000).unref();
  }, req.timeoutMs ?? 180000);

  proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
  proc.stderr.on('data', d => { stderr += d.toString('utf8'); });

  const exitInfo = await new Promise((resolve) => {
    proc.on('exit', (code, signal) => resolve({ code, signal }));
    proc.on('error', err => resolve({ code: -1, signal: null, spawnError: err.message }));
  });
  clearTimeout(timer);
  const wallMs = Date.now() - t0;

  if (req.logPath) {
    try { writeFileSync(req.logPath, stdout); } catch { /* */ }
  }

  const parsed = parseStreamJson(stdout);
  return {
    cmd: ['claude', ...redactArgs(args)].join(' '),
    cwd: req.cwd,
    exitCode: exitInfo.code,
    signal: exitInfo.signal,
    spawnError: exitInfo.spawnError,
    timedOut,
    wallMs,
    stderrPreview: stderr.slice(0, 4000),
    rawByteLen: stdout.length,
    ...parsed,
  };
}

function isTransientRunFailure(run) {
  const text = `${run.finalResultText || ''}\n${run.finalAssistantText || ''}\n${run.stderrPreview || ''}`;
  if (run.timedOut || run.spawnError) return true;
  if (!run.resultEvent && !run.finalResultText && !run.finalAssistantText) return true;
  return /API Error:\s*(Overloaded|Rate limit|Timeout)|temporarily unavailable|ETIMEDOUT|ECONNRESET/i.test(text);
}

// Hide multi-line system-prompt content in command logs (keeps artifacts readable).
function redactArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--append-system-prompt' || a === '--system-prompt') && args[i + 1]) {
      out.push(a, `<${args[i + 1].length}-char policy text>`);
      i++;
    } else if (a === '-p' && args[i + 1]) {
      out.push(a, `<${args[i + 1].length}-char prompt>`);
      i++;
    } else {
      out.push(a);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// stream-json parsing
// ---------------------------------------------------------------------------

/**
 * stream-json events Claude Code emits (CLI 2.1.x):
 *   - { type: 'system', subtype: 'init', tools, permissionMode, model, ... }
 *   - { type: 'user', message: { content: [{type:'tool_result', ...}] } }
 *   - { type: 'assistant', message: { content: [{type:'text'|'tool_use', ...}], usage } }
 *   - { type: 'result', subtype, total_cost_usd, usage, result, num_turns, ... }
 *
 * We pull:
 *   - all tool_use blocks (name, input, id) in chronological order
 *   - all tool_result blocks (id, content text, is_error) so we can size them
 *   - the final assistant text concat (last assistant message)
 *   - the result event (usage, cost, success/error subtype)
 */
function parseStreamJson(stdout) {
  const events = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); }
    catch { /* malformed line — skip */ }
  }

  const toolCalls = [];
  const toolResults = [];
  let lastAssistantText = '';
  let resultEvent = null;
  let initEvent = null;
  let assistantMessageCount = 0;
  let totalAssistantTextChars = 0;

  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      initEvent = ev;
    } else if (ev.type === 'assistant' && ev.message?.content) {
      assistantMessageCount++;
      let textBuf = '';
      for (const block of ev.message.content) {
        if (block.type === 'text') {
          textBuf += block.text || '';
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input,
            tIndex: toolCalls.length,
          });
        }
      }
      if (textBuf) {
        totalAssistantTextChars += textBuf.length;
        lastAssistantText = textBuf;
      }
    } else if (ev.type === 'user' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result') {
          let chars = 0;
          let text = '';
          if (typeof block.content === 'string') {
            text = block.content;
            chars = text.length;
          } else if (Array.isArray(block.content)) {
            for (const c of block.content) {
              if (typeof c.text === 'string') {
                text += c.text;
                chars += c.text.length;
              }
            }
          }
          // Parse <<SS_ROUTE_META>>{...} trailer emitted by ss-search.
          // Captures: query, queryHash, queryLen, routedMode, routeConfidence,
          // routeMethod, routerLatency_us, tokenBudget, tokensUsed, subMode,
          // resultCount, tierCounts, sandwichCount, repo-isolation fields.
          let routeMeta = null;
          const m = text.match(/<<SS_ROUTE_META>>(\{[^\n]*\})/);
          if (m) {
            try { routeMeta = JSON.parse(m[1]); } catch { /* malformed — skip */ }
          }
          let traceMeta = null;
          const tm = text.match(/<<SS_TRACE_META>>(\{[^\n]*\})/);
          if (tm) {
            try { traceMeta = JSON.parse(tm[1]); } catch { /* malformed — skip */ }
          }
          toolResults.push({
            id: block.tool_use_id,
            text, // the raw tool-result bytes the agent saw — needed to build the USD rawResponse
            isError: !!block.is_error,
            chars,
            ...(routeMeta ? { routeMeta } : {}),
            ...(traceMeta ? { traceMeta } : {}),
          });
        }
      }
    } else if (ev.type === 'result') {
      resultEvent = ev;
    }
  }

  const usage = resultEvent?.usage || null;
  const totalCostUsd = resultEvent?.total_cost_usd ?? null;
  const finalResultText = resultEvent?.result || lastAssistantText;
  const numTurns = resultEvent?.num_turns ?? null;
  const isError = !!resultEvent?.is_error || resultEvent?.subtype === 'error';

  return {
    events,
    initEvent,
    toolCalls,
    toolResults,
    assistantMessageCount,
    totalAssistantTextChars,
    finalAssistantText: lastAssistantText,
    finalResultText,
    resultEvent,
    usage,
    totalCostUsd,
    numTurns,
    isError,
  };
}

// ---------------------------------------------------------------------------
// Final-answer JSON extraction
// ---------------------------------------------------------------------------

/**
 * Extract the strict-JSON answer block we asked for.
 * Tries (1) fenced ```json block at end, (2) any fenced json block, (3) the
 * largest top-level {...} substring that parses. Returns the parsed object
 * with `_prose` set to the prose preamble (the text outside the JSON block,
 * which often contains substantive facts the worker explained in English).
 * Falls back to { _parseError, _raw } when no JSON block parses.
 */
export function extractAnswerJson(text) {
  if (!text) return { _parseError: 'empty answer text', _raw: '' };

  // 1) trailing fenced ```json block
  const fencedAll = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)];
  for (let i = fencedAll.length - 1; i >= 0; i--) {
    const m = fencedAll[i];
    const body = m[1];
    try {
      const parsed = JSON.parse(body);
      // Capture the prose that precedes the parsed JSON block so metric
      // scoring can include it in the haystack. The agent often narrates
      // the answer in prose and then summarises into JSON; without this
      // we'd silently drop those prose facts on the floor.
      const prose = (text.slice(0, m.index) || '').trim();
      if (prose && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsed._prose = prose;
      }
      return parsed;
    } catch { /* try next */ }
  }

  // 2) the largest balanced {...} substring
  const candidates = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') {
        depth--;
        if (depth === 0) { candidates.push([i, j]); break; }
      }
    }
  }
  candidates.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  for (const [a, b] of candidates) {
    try {
      const parsed = JSON.parse(text.slice(a, b + 1));
      const prose = (text.slice(0, a) || '').trim();
      if (prose && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsed._prose = prose;
      }
      return parsed;
    }
    catch { /* try next */ }
  }

  return { _parseError: 'no JSON block parseable', _raw: text };
}

// ---------------------------------------------------------------------------
// Helper for callers that only want the answer + a compact run summary
// ---------------------------------------------------------------------------

export function summariseRun(run) {
  const answer = extractAnswerJson(run.finalResultText || run.finalAssistantText);
  const toolUseChars = run.toolResults.reduce((acc, r) => acc + r.chars, 0);

  // Aggregate ss-search route metadata across all ss-search tool calls in this run.
  // - routeMetas: every parsed payload (in tool-call order, full per-call detail
  //               including query/queryHash/routeMethod/routerLatency_us)
  // - routedModeCounts: how many calls routed to each mode
  // - routeMethodCounts: how many calls came from each decision source
  //   (file_pattern / wasm_catboost / wasm_rejected / fallback_error / forced / ...)
  // - routerLatencySamples_us: per-call router decision latency, in microseconds
  // - aggregate: { totalTokenBudget, totalTokensUsed, sandwichCount, callCount }
  const routeMetas = run.toolResults
    .map(r => r.routeMeta)
    .filter(Boolean);
  const traceMetas = run.toolResults
    .map(r => r.traceMeta)
    .filter(Boolean);
  const routedModeCounts = {};
  const routeMethodCounts = {};
  const routerLatencySamples_us = [];
  let routeAggregate = null;
  if (routeMetas.length) {
    let totalBudget = 0, totalUsed = 0, sandwichCount = 0;
    for (const m of routeMetas) {
      const mode = m.routedMode || 'unknown';
      routedModeCounts[mode] = (routedModeCounts[mode] || 0) + 1;
      const method = m.routeMethod || 'unknown';
      routeMethodCounts[method] = (routeMethodCounts[method] || 0) + 1;
      if (typeof m.routerLatency_us === 'number') {
        routerLatencySamples_us.push(m.routerLatency_us);
      }
      totalBudget += +m.tokenBudget || 0;
      totalUsed += +m.tokensUsed || 0;
      sandwichCount += +m.sandwichCount || 0;
    }
    routeAggregate = {
      callCount: routeMetas.length,
      totalTokenBudget: totalBudget,
      totalTokensUsed: totalUsed,
      sandwichCount,
      routedModeCounts,
      routeMethodCounts,
      routerLatencySamples_us,
    };
  }

  return {
    wallMs: run.wallMs,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    isError: run.isError,
    attempts: run.attempts || 1,
    retryCount: run.retryCount || 0,
    numTurns: run.numTurns,
    toolCallCount: run.toolCalls.length,
    toolOutputChars: toolUseChars,
    approxToolOutputTokens: Math.ceil(toolUseChars / 4),
    assistantMessageCount: run.assistantMessageCount,
    answerChars: (run.finalResultText || '').length,
    approxAnswerTokens: Math.ceil((run.finalResultText || '').length / 4),
    usage: run.usage,
    totalCostUsd: run.totalCostUsd,
    answer,
    answerParseError: answer?._parseError || null,
    routeMetas,           // raw per-call payloads
    routeAggregate,       // null when no ss-search calls were made
    traceMetas,
    traceAggregate: traceMetas.length ? {
      callCount: traceMetas.length,
      totalTokenBudget: traceMetas.reduce((acc, m) => acc + (+m.tokenBudget || 0), 0),
      totalTokensUsed: traceMetas.reduce((acc, m) => acc + (+m.tokensUsed || 0), 0),
      callers: traceMetas.reduce((acc, m) => acc + (+m.callers || 0), 0),
      callees: traceMetas.reduce((acc, m) => acc + (+m.callees || 0), 0),
      impactPaths: traceMetas.reduce((acc, m) => acc + (+m.impactPaths || 0), 0),
    } : null,
  };
}

// Convenience for callers that want a printable view of the tool sequence.
export function formatToolTrace(run, max = 20) {
  return run.toolCalls.slice(0, max).map((tc, i) => {
    const inp = tc.input || {};
    let summary;
    if (tc.name === 'Bash') summary = `Bash: ${(inp.command || '').slice(0, 120)}`;
    else if (tc.name === 'Read') summary = `Read: ${inp.file_path || ''}${inp.offset ? ` @${inp.offset}` : ''}${inp.limit ? `+${inp.limit}` : ''}`;
    else summary = `${tc.name}: ${JSON.stringify(inp).slice(0, 120)}`;
    return `  ${i + 1}. ${summary}`;
  }).join('\n');
}

// Tiny helper for tests/dry-run callers.
export function buildClaudeArgs(req) {
  // Mirror the live spawn(...) call but return the arg list for inspection
  // without running anything. Used by --dry-run.
  const args = [
    '-p', req.prompt,
    '--model', req.model,
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--dangerously-skip-permissions',
    '--append-system-prompt', req.systemAppend,
  ];
  if (req.allowedTools?.length) args.push('--allowed-tools', req.allowedTools.join(' '));
  if (req.disallowedTools?.length) args.push('--disallowed-tools', req.disallowedTools.join(' '));
  for (const d of (req.addDirs || [])) args.push('--add-dir', d);
  return args;
}

export const _internal = { parseStreamJson, isTransientRunFailure };
