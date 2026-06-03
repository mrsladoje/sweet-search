// One-shot DeepSeek-V4-Pro DIRECT-API red-team critique. NEVER OpenRouter.
// Reasoning model => max_tokens >= 4096, text output (not json_object).
import fs from 'node:fs';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) { console.error('DEEPSEEK_API_KEY missing'); process.exit(2); }
const spec = fs.readFileSync(new URL('./_redteam-spec-digest.txt', import.meta.url), 'utf8');

const body = {
  model: 'deepseek-v4-pro',
  messages: [
    { role: 'system', content: 'You are a relentless adversarial reviewer of evaluation metrics. You break metrics for a living. Be concrete, specific, and hostile. No hedging, no summaries. IMPORTANT: keep internal reasoning brief and spend your output budget on the WRITTEN ANSWER — you MUST produce a final written critique (a prioritized list of concrete breaks), not just think.' },
    { role: 'user', content: spec },
  ],
  temperature: 0.4,
  max_tokens: 32000,
};

const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!resp.ok) { console.error('HTTP', resp.status, (await resp.text()).slice(0, 500)); process.exit(1); }
const payload = await resp.json();
const msg = payload?.choices?.[0]?.message ?? {};
const out = msg.content || '';
const reasoning = msg.reasoning_content || '';
fs.writeFileSync(new URL('./_deepseek-pro-critique.txt', import.meta.url), out, 'utf8');
console.error('OK content_len', out.length, 'reasoning_len', reasoning.length, 'finish', payload?.choices?.[0]?.finish_reason, 'usage', JSON.stringify(payload?.usage||{}));
console.log(out.slice(0, 400));
