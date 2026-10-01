#!/usr/bin/env node
// r3-hard easy filter, step 1 (closed book): a model sees ONLY the repo name + the question (no code,
// no tools) and must name the file path(s) + symbol(s). A question it answers (≥ half of the gold
// files by basename AND ≥ half of the gold symbols) is too easy / memorised → dropped before the split.
// This selects AGAINST easiness with non-product models (HARD-QUESTION-RESEARCH.md §1–2), never on
// sweet-search results. Two models, a question is dropped if EITHER solves it.
//   node r3/closed-book-filter.mjs <drafts-dir>   → <drafts-dir>/closed-book.json
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2]);
const out = path.join(dir, 'closed-book.json');
const done = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
const MODELS = [['openrouter', 'deepseek/deepseek-v4.1-flash'], ['openrouter', 'openai/gpt-6-luna']];
async function ask(model, prompt) {
  for (let a = 0; a < 4; a++) {
    let r;
    try {
      r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' } }), signal: AbortSignal.timeout(180000) });
    } catch { await new Promise(res => setTimeout(res, 3000 * (a + 1))); continue; }   // network error → retry
    if (r.ok) { const j = await r.json(); try { return JSON.parse(j.choices[0].message.content.replace(/^```(json)?|```$/g, '')); } catch { return null; } }
    await new Promise(res => setTimeout(res, 2000 * (a + 1)));
  }
  return null;
}
const base = s => String(s).split('/').pop().toLowerCase();
const sym = s => String(s).toLowerCase().split(/::|\.|#/).pop();
const probes = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'closed-book.json').flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).probes || []);
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < probes.length) {
    const p = probes[i++]; if (done[p.id] || p.expectedNoMatch) continue;
    const prompt = `Without looking at any code, answer from memory. Repository: "${p.repo}" (${p.language}).\nQuestion: ${p.query}\nReply JSON only: {"files": ["path/to/file", ...], "symbols": ["Name", ...]}`;
    const res = {};
    for (const [, m] of MODELS) {
      const a = await ask(m, prompt);
      const files = new Set((a?.files || []).map(base)), syms = new Set((a?.symbols || []).map(sym));
      const fHit = p.expectedFiles.filter(f => files.has(base(f))).length, sHit = p.expectedSymbols.filter(s => syms.has(sym(s))).length;
      res[m] = { fHit: `${fHit}/${p.expectedFiles.length}`, sHit: `${sHit}/${p.expectedSymbols.length}`, solved: fHit >= Math.ceil(p.expectedFiles.length / 2) && sHit >= Math.ceil(p.expectedSymbols.length / 2) };
    }
    done[p.id] = { ...res, drop: Object.values(res).some(x => x.solved) };
    fs.writeFileSync(out, JSON.stringify(done, null, 1));
  }
}));
const v = Object.values(done);
console.log(`${dir}: checked ${v.length}, dropped (closed-book solvable) ${v.filter(x => x.drop).length}`);
