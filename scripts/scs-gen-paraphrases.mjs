#!/usr/bin/env node
/**
 * SCS §3.6 step 1 — generate multi-family paraphrases of the winner (M++/Mpp.md).
 * Each is a SEMANTICALLY-EQUIVALENT rewrite from a DISTINCT model family (anti
 * single-lab-paraphrase-bias, GPT-5.5 review §C2). Validates every paraphrase
 * preserves the 7 tool tokens. Writes Mpp-<label>.md into the candidates dir.
 * (The deterministic-structural + manual paraphrases are authored separately.)
 *
 *   WANT=4 node scripts/scs-gen-paraphrases.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMutatorCallDefaults } from '../core/prompt-optimization/sweep/gepa-cli.mjs';
import { stripOuterFence } from '../core/prompt-optimization/sweep/token-validator.mjs';
const { runJudge } = await import('../eval/agent-read-workflows/judge-runner.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAND = path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates');
const MPP = fs.readFileSync(path.join(CAND, 'Mpp.md'), 'utf8');
const callModel = (req) => runJudge(withMutatorCallDefaults(req));

const SYS = `You are paraphrasing a system prompt for a code-search agent. Rewrite the prompt below so it is SEMANTICALLY EQUIVALENT: preserve every routing rule, stopping rule, and instruction, and keep these tool names verbatim — ss-search, ss-find, ss-grep, ss-semantic, ss-trace, ss-read — and the literal answer token no-match. You may freely vary wording, sentence structure, section ordering, and format (prose <-> bullets <-> compact table). Do NOT add, remove, or change any rule or its meaning. Output ONLY the rewritten prompt — no preamble, no commentary, no code fences.`;

const TOKENS = ['ss-search', 'ss-find', 'ss-grep', 'ss-semantic', 'ss-trace', 'ss-read', 'no-match'];
const validate = (t) => {
  const miss = TOKENS.filter((x) => !t.includes(x));
  const wc = t.split(/\s+/).filter(Boolean).length;
  const refusal = /^\s*(I (cannot|can't|am unable|'m sorry|will not))/i.test(t);
  return { ok: miss.length === 0 && wc >= 350 && wc <= 1500 && !refusal, miss, wc, refusal };
};

// distinct families first; extras are fallbacks if a model string errors
const FAMILIES = [
  { lineage: 'anthropic-api', model: 'claude-sonnet-4-6', label: 'sonnet' },
  { lineage: 'openai-api', model: 'gpt-5.5-instant', label: 'gpt' },
  { lineage: 'google-api', model: 'gemini-3.1-flash-lite', label: 'gemini' },
  { lineage: 'moonshot', model: 'kimi-k2.6', label: 'kimi' },
  { lineage: 'deepseek-api', model: 'deepseek-v4-flash', label: 'deepseek' },
  { lineage: 'minimax', model: 'abab6.5s-chat', label: 'minimax' },
];

const want = Number(process.env.WANT || 4);
const got = [];
for (const f of FAMILIES) {
  if (got.length >= want) break;
  process.stderr.write(`paraphrase via ${f.label.padEnd(9)} (${f.lineage}/${f.model})... `);
  let r;
  try {
    r = await callModel({ lineage: f.lineage, model: f.model, systemPrompt: SYS, userPrompt: MPP, maxTokens: 4000, timeoutMs: 120000 });
  } catch (e) { console.error('THREW', e?.message || e); continue; }
  if (!r || r.isError) { console.error('isError:', String(r?.text).slice(0, 90)); continue; }
  const t = stripOuterFence(String(r.text || '').trim());
  const v = validate(t);
  if (!v.ok) { console.error('INVALID', JSON.stringify(v)); continue; }
  fs.writeFileSync(path.join(CAND, `Mpp-${f.label}.md`), t.endsWith('\n') ? t : t + '\n');
  got.push(f.label);
  console.error(`OK -> Mpp-${f.label}.md (${v.wc} words)`);
}
console.log('\nGenerated model paraphrases:', got.join(', ') || '(none)', `[${got.length}/${want}]`);
