// One-shot Gemini-3.1-pro red-team critique via the direct REST API (gemini-api-key auth).
import fs from 'node:fs';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY missing'); process.exit(2); }
const spec = fs.readFileSync(new URL('./_redteam-spec-digest.txt', import.meta.url), 'utf8');
const model = 'gemini-3.1-pro-preview';

const body = {
  systemInstruction: { parts: [{ text: 'You are a relentless adversarial reviewer of evaluation metrics. You break metrics for a living. Be concrete, specific, and hostile. No hedging, no summaries. Construct real adversarial example outputs.' }] },
  contents: [{ role: 'user', parts: [{ text: spec }] }],
  generationConfig: { temperature: 0.5, maxOutputTokens: 16384 },
};

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
if (!resp.ok) { console.error('HTTP', resp.status, (await resp.text()).slice(0, 800)); process.exit(1); }
const payload = await resp.json();
const cand = payload?.candidates?.[0];
const parts = cand?.content?.parts || [];
const out = parts.map(p => p.text || '').join('');
fs.writeFileSync(new URL('./_gemini-pro-critique.txt', import.meta.url), out, 'utf8');
console.error('OK len', out.length, 'finish', cand?.finishReason, 'usage', JSON.stringify(payload?.usageMetadata||{}));
console.log(out.slice(0, 400));
