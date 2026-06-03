#!/usr/bin/env node
/**
 * DeepSeek direct-API preflight for the task-bench agent loop.
 * Confirms (cheaply, 1 call): key works, model is accessible, and
 * OpenAI-style function/tool-calling returns a tool_call we can parse.
 * This de-risks the whole pilot agent loop before we build it.
 *
 * Usage: node eval/task-completion-bench/env/deepseek-preflight.mjs [model]
 *   model defaults to deepseek-v4-flash (cheap). Try deepseek-v4-pro for reasoning.
 */
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) { console.error('FAIL: DEEPSEEK_API_KEY not in env'); process.exit(1); }

const model = process.argv[2] || 'deepseek-v4-flash';
const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

const tools = [{
  type: 'function',
  function: {
    name: 'run_bash',
    description: 'Run a read-only shell command in the repo to explore code.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'the shell command' } },
      required: ['command'],
    },
  },
}];

const body = {
  model,
  messages: [
    { role: 'system', content: 'You are a coding agent. To inspect the repo, call run_bash. Always use the tool before answering.' },
    { role: 'user', content: 'Find where the function `parseConfig` is defined in this repository. Use the tool.' },
  ],
  tools,
  tool_choice: 'auto',
  temperature: 0,
  max_tokens: 4096,
};

const t0 = Date.now();
const resp = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const ms = Date.now() - t0;
if (!resp.ok) {
  const txt = await resp.text().catch(() => '<no body>');
  console.error(`FAIL: ${resp.status} — ${txt.slice(0, 300)}`);
  process.exit(1);
}
const payload = await resp.json();
const msg = payload?.choices?.[0]?.message ?? {};
const toolCalls = msg.tool_calls ?? [];
const usage = payload?.usage ?? {};
console.log(`OK model=${payload.model || model} latency=${ms}ms finish=${payload?.choices?.[0]?.finish_reason}`);
console.log(`tool_calls=${toolCalls.length}`);
for (const tc of toolCalls) {
  console.log(`  → ${tc.function?.name}(${tc.function?.arguments})`);
}
console.log(`usage: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} ` +
  `cache_hit=${usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? '?'} ` +
  `reasoning=${usage.completion_tokens_details?.reasoning_tokens ?? 0}`);
console.log(`content_present=${!!(msg.content && msg.content.trim())}`);
if (toolCalls.length === 0) { console.error('WARN: no tool_calls — function-calling may need a nudge or different model'); process.exit(2); }
console.log('PREFLIGHT PASS: DeepSeek function-calling works for the agent loop');
