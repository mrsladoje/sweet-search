#!/usr/bin/env node
// r3 draft verification (ambiguity + gold correctness), before the split.
//   node r3/verify-drafts.mjs [repo …]      → r3/verify/<repo>.json + summary
// Two disjoint verifier models (not the drafter's family, not a Claude model):
//   gemini-3.8-flash (Google direct) and z-ai/glm-5.3 (OpenRouter).
// Each gets the question + the FULL TEXT of the gold files (no gold symbols/facts shown for the
// answer part), answers with files + symbols, then judges each gold fact as supported / not.
// Keep rule (fixed before running): for a positive question BOTH verifiers must (a) name at least
// half of the gold symbols (case-insensitive, last path segment) and (b) mark every gold fact
// supported. Negatives are not verifiable from gold files; they pass through to the Opus audit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = '/Users/admin/Projects/sweet-search-private';
const repos = JSON.parse(fs.readFileSync(path.join(HERE, 'repos.json'), 'utf8'));
const only = process.argv.slice(2);
const OUT = path.join(HERE, 'verify'); fs.mkdirSync(OUT, { recursive: true });
const MAX_CHARS = 90000;
let spend = 0;

async function gemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  for (let a = 0; a < 4; a++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }) });
    if (r.ok) { const j = await r.json(); const u = j.usageMetadata || {}; spend += ((u.promptTokenCount || 0) * 0.75 + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * 3.75) / 1e6; return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''; }
    await new Promise(res => setTimeout(res, 3000 * (a + 1)));
  }
  throw new Error('gemini failed');
}
async function glm(prompt) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, body: JSON.stringify({ model: process.env.R3_VERIFIER2 || 'z-ai/glm-5.3', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, temperature: 0, usage: { include: true } }) });
    if (r.ok) { const j = await r.json(); spend += j.usage?.cost || 0; return j.choices?.[0]?.message?.content || ''; }
    await new Promise(res => setTimeout(res, 3000 * (a + 1)));
  }
  throw new Error('glm failed');
}
const parse = t => { try { return JSON.parse(String(t).replace(/^```(json)?|```$/g, '').trim()); } catch { const m = String(t).match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } } };
const norm = s => String(s).toLowerCase().split(/::|\.|#|\//).pop().replace(/[()]/g, '').trim();

function promptFor(repo, p, files) {
  const body = files.map(f => `===== FILE: ${f.path} =====\n${f.text}`).join('\n\n');
  return `You are checking a code-search benchmark question against the source files of the ${repo.language} repository "${repo.repo}".
The files below are the ones the benchmark author considers relevant. Some may be only partly relevant.

QUESTION: ${p.query}

Task 1: Answer the question from these files: which file path(s) and symbol(s) (functions, methods, classes, types) answer it? Name only what is needed.
Task 2: For each numbered CLAIM, say whether the code shown supports it exactly ("supported"), partly or not at all ("unsupported"). Be strict.
${p.expectedFacts.map((c, i) => `CLAIM ${i + 1}: ${c}`).join('\n')}
Task 3: Is the question ambiguous — could a careful engineer reasonably give a DIFFERENT answer elsewhere in the code? (true/false + one sentence)

Reply with JSON only: {"files": ["..."], "symbols": ["..."], "claims": ["supported"|"unsupported", ...], "ambiguous": false, "why": "..."}

${body}`;
}

for (const repo of repos.filter(r => !only.length || only.includes(r.repo))) {
  const draftPath = path.join(HERE, 'drafts', `${repo.repo}.json`);
  if (!fs.existsSync(draftPath)) { console.log(`${repo.repo}: no draft yet`); continue; }
  const probes = JSON.parse(fs.readFileSync(draftPath, 'utf8')).probes;
  const outPath = path.join(OUT, `${repo.repo}.json`);
  const done = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  const root = path.join(MAIN, repo.dir);
  // re-verify entries where a verifier call errored or returned unparsable JSON (not a verdict)
  const errored = x => x && !x.negative && [x.gemini, x.glm].some(v => v && v.ok === false && /unparsable|failed/.test(String(v.why || '')));
  const work = probes.filter(p => !done[p.id] || errored(done[p.id]));
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < work.length) {
      const p = work[i++];
      if (p.expectedNoMatch) { done[p.id] = { id: p.id, negative: true, keep: 'audit' }; continue; }
      const missing = p.expectedFiles.filter(f => !fs.existsSync(path.join(root, f)));
      if (missing.length) { done[p.id] = { id: p.id, keep: false, reason: `missing gold file(s): ${missing.join(', ')}` }; continue; }
      let budget = MAX_CHARS;
      const files = p.expectedFiles.map(f => { const t = fs.readFileSync(path.join(root, f), 'utf8'); const x = t.slice(0, Math.max(4000, Math.floor(budget / p.expectedFiles.length))); return { path: f, text: x }; });
      const pr = promptFor(repo, p, files);
      const [g, z] = await Promise.all([gemini(pr).then(parse).catch(e => ({ error: e.message })), glm(pr).then(parse).catch(e => ({ error: e.message }))]);
      const judge = v => {
        if (!v || v.error) return { ok: false, why: v?.error || 'unparsable' };
        const named = new Set((v.symbols || []).map(norm));
        const hit = p.expectedSymbols.filter(s => named.has(norm(s)) || [...named].some(n => n.includes(norm(s)) || norm(s).includes(n) && n.length > 3)).length;
        const symOk = hit >= Math.ceil(p.expectedSymbols.length / 2);
        const claims = v.claims || [];
        const factsOk = claims.length >= p.expectedFacts.length && claims.slice(0, p.expectedFacts.length).every(c => /^supported/i.test(String(c)));
        return { ok: symOk && factsOk && !v.ambiguous, symHit: `${hit}/${p.expectedSymbols.length}`, factsOk, ambiguous: !!v.ambiguous, symbols: v.symbols, claims, why: v.why };
      };
      const G = judge(g), Z = judge(z);
      done[p.id] = { id: p.id, keep: G.ok && Z.ok, gemini: G, glm: Z };
      fs.writeFileSync(outPath, JSON.stringify(done, null, 1));
    }
  }));
  fs.writeFileSync(outPath, JSON.stringify(done, null, 1));
  const vals = Object.values(done);
  console.log(`${repo.repo}: ${vals.length} checked, keep ${vals.filter(v => v.keep === true).length}, negatives→audit ${vals.filter(v => v.negative).length}, drop ${vals.filter(v => v.keep === false).length}  (spend so far ~$${spend.toFixed(3)})`);
}
