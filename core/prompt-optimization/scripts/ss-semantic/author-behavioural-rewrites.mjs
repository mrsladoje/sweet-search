#!/usr/bin/env node
/**
 * author-behavioural-rewrites.mjs — Stage 0.5 of ss-semantic Phase 6 v2.
 *
 * Authors a parallel "behavioural-query" benchmark alongside the existing
 * symbol-anchored ast-tester golds. Each rewrite expresses the same intent
 * as the original probe without leaking the symbol name, so we can measure
 * ss-semantic's usefulness for the way agents actually query (broader
 * behavioural NL, not "find symbol X").
 *
 * Pipeline (mirrors author-variants.mjs but with a different system prompt
 * and validator wiring — see probe-rewrite-system-prompt.md for spec):
 *
 *   1. Stratified sample 30-50 ast-tester golds across families (seed=42).
 *   2. For each, build user prompt from (file, symbol, containingChunk.text,
 *      goldNotes).
 *   3. Call DeepSeek V4-Flash (non-reasoning, seed=42, temperature=0.3,
 *      max_tokens=4096, json_object).
 *   4. Validate via: schema → length [4,15] → V5 symbol-leak rules
 *      (validator.mjs:validateVariant) → behavioural-verb regex.
 *   5. Re-prompt on validator failure (max 2 retries; matches §5.5.5 surface).
 *   6. Write per-language to eval/ast-tester-probes/gold-behavioral/<lang>.json.
 *
 * Per CLAUDE.md / handoff:
 *   - Disjoint-author chain: rewrites are DeepSeek (not Claude/Sonnet),
 *     matching the variant-authoring chain.
 *   - Hard budget cap: ~$0.02 expected for 39 rewrites. Safety cap at $5.
 *   - Stratified seed=42 honoured for both sampling AND DeepSeek seed.
 *   - Dev/held-out split inherited from splits/manifest.json.
 *
 * Usage:
 *   node author-behavioural-rewrites.mjs                       # full sweep
 *   node author-behavioural-rewrites.mjs --dry-run             # print prompts, no API
 *   node author-behavioural-rewrites.mjs --resume              # skip already-written rewrites
 *   node author-behavioural-rewrites.mjs --target-per-family=6 # override sample size
 *   node author-behavioural-rewrites.mjs --preflight           # confirm model id
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDeepSeekClient } from '../deepseek-client.mjs';
import {
  validateVariant, whitespaceTokenCount,
  pathTokens as splitPathTokens, symbolSubTokens,
  detectPathTokenLeak, detectQueryStemLeak,
} from '../validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const OUT_DIR = path.join(REPO_ROOT, 'eval/ast-tester-probes/gold-behavioral');
const SPLITS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');

const SCHEMA_VERSION = 1;
const SEED = 42;
const TEMPERATURE = 0.3;
const MAX_TOKENS = 4096;
const MAX_RETRIES = 2;

// Per-family sample targets (see probe-rewrite-system-prompt.md):
//   OO-monolithic: 8, Systems-modular-terse: 6, C-family: 7, JS-mobile: 8,
//   Scripting-dynamic: 10. Total: 39.
const DEFAULT_PER_FAMILY = {
  'OO-monolithic': 8,
  'Systems-modular-terse': 6,
  'C-family': 7,
  'JS-mobile': 8,
  'Scripting-dynamic': 10,
};

const BEHAVIOURAL_VERB_RE = /\b(find|show|locate|where|how|trace|identify|return|handle|process|build|parse|render|open|send|read|write|dispatch|resolve|convert|extract|emit|register|wait|track|cancel|join|encode|decode|authenticate|validate|serialize|persist|drain|cache|invalidate|listen|broadcast|notify|inspect)\b/i;

// ─── system prompt (verbatim from probe-rewrite-system-prompt.md) ──────────

export const SYSTEM_PROMPT = `You are rewriting a code-search probe into a behavioural query. The original probe is symbol-anchored ("find function X"); your job is to express the SAME intent as a natural-language question about behaviour ("find the bit that does Y") so we can measure whether the search tool is actually useful for the way agents query in practice.

You will see:
  - file path
  - expected symbol name (the thing the original probe was looking for)
  - the source code of that symbol (its actual body, including signature and doc comments)
  - a human-authored description of what the symbol does ("goldNotes")

Produce ONE rewritten query that captures the same intent without naming the symbol.

Hard constraints (query is REJECTED if violated):

1. Length: 4 to 15 whitespace-split tokens.

2. Must NOT contain the expected symbol verbatim (case-insensitive substring). If the symbol is "redisConnectWithOptions", queries like "redisConnect" or "ConnectWithOptions" are also rejected — no sub-string of the symbol of length ≥ 5 chars may appear.

3. Must NOT contain any symbol sub-token stem (≥ 5-char shared prefix or suffix with any symbol sub-token after splitting on underscores AND camelCase). Example: if the symbol is "redisConnectWithOptions", the sub-tokens are ["redis", "connect", "with", "options"]. Forbidden query words include "redis", "redisreader", "connection", "connecting", "options", "optional", "withhold". Re-phrase with synonyms.

4. Must contain at least one behavioural verb or interrogative: find / show / locate / where / how / trace / identify / return / handle / process / build / parse / render / open / send / read / write / dispatch / resolve / convert / extract / emit / register / wait / track / cancel / join / encode / decode / authenticate / validate / serialize / persist / drain / cache / invalidate / listen / broadcast / notify / inspect.

5. Must contain at least one domain-relevant content word drawn from the symbol's actual behaviour (NOT the symbol name or path). The point: the rewrite should be lexically anchored on what the code DOES, not on what it's CALLED.

6. Must read like a real agent query, not a textbook prose paraphrase. Prefer short imperative or how/where forms over long declarative subordinate-clause constructions. "find the function that handles the retry backoff loop" is good. "How is the architecture of the retry subsystem organized to satisfy the requirement of bounded latency under failure conditions" is bad.

If the symbol is genuinely impossible to rewrite without leaking (e.g., trivial generic names like "Reader" or "Convert" where no synonym exists that isn't itself the symbol), return:

  {"rewrittenQuery": null, "rationale": "behavioural rewrite infeasible: <one sentence why>"}

Otherwise return:

  {"rewrittenQuery": "<the query>", "rationale": "<one sentence on what behaviour the query captures>"}

No prose outside the JSON object. No markdown fences.`;

function buildUserPrompt(input) {
  const sym = input.expectedSymbol ?? '(unknown)';
  // Prefer containingChunk.text (real symbol body) over sourceSnippet (which
  // can be "fallback-head" file-header text for golds where the code-graph
  // lookup returned no candidate). The rewrite needs the real behaviour.
  const body = input.containingChunk?.text ?? input.sourceSnippet?.text ?? '';
  return `gold:
  file: ${input.expectedFile}
  symbol: ${sym}
  symbolType: ${input.expectedSymbolType ?? '(none)'}
  language: ${input.canonicalLanguage ?? input.language}
  description: ${input.goldNotes ?? ''}
source (the symbol body — may also include leading doc comments):
\`\`\`
${body}
\`\`\`

Produce the behavioural rewrite now.`;
}

function tryParseJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ─── validator wrapper ────────────────────────────────────────────────────

/**
 * Validate a parsed model emit against the behavioural-rewrite rules.
 * Returns {ok, reason, check}.
 *
 * Direct leak checks (NOT via validateVariant) because validateVariant
 * short-circuits on length tier — V5 requires 9-15 tokens, but behavioural
 * rewrites are 4-15, so any 4-8-token rewrite would skip the leak checks.
 * We use the validator's exported helpers (symbolSubTokens, detectPathTokenLeak,
 * detectQueryStemLeak) directly so leak rules are independent of length.
 */
export function validateBehaviouralRewrite(parsed, input) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, check: 'schema', reason: 'output is not a JSON object' };
  }
  // Infeasible path is a valid emit.
  if (parsed.rewrittenQuery === null) {
    if (typeof parsed.rationale !== 'string') {
      return { ok: false, check: 'schema', reason: 'infeasible emit needs `rationale`' };
    }
    return { ok: true, infeasible: true, rationale: parsed.rationale };
  }
  if (typeof parsed.rewrittenQuery !== 'string' || parsed.rewrittenQuery.trim().length === 0) {
    return { ok: false, check: 'schema', reason: 'missing or empty `rewrittenQuery`' };
  }
  const query = parsed.rewrittenQuery.trim();

  // Length [4, 15] — distinct from any V_i tier; enforced here.
  const n = whitespaceTokenCount(query);
  if (n < 4 || n > 15) {
    return { ok: false, check: 'length', reason: `length ${n} not in [4,15]` };
  }

  const queryLower = query.toLowerCase();

  // Check 4 — symbol must NOT appear verbatim (case-insensitive substring).
  const sym = input?.expectedSymbol ?? null;
  const symAnyOf = input?.expectedSymbolAnyOf?.length ? input.expectedSymbolAnyOf : (sym ? [sym] : []);
  for (const s of symAnyOf) {
    if (queryLower.includes(s.toLowerCase())) {
      return { ok: false, check: 'symbol-verbatim', reason: `query contains symbol "${s}" (case-insensitive substring)` };
    }
  }

  // Check 5 — path-token leak.
  // Check 5b — query-stem leak (catches "cancellation" vs "cancel" — was the
  // bug in the first sweep that let KT-001 through).
  if (symAnyOf.length > 0) {
    const symSubsSet = new Set();
    for (const s of symAnyOf) for (const sub of symbolSubTokens(s)) symSubsSet.add(sub);
    const symSubs = [...symSubsSet];
    const tokens = input?.pathTokens?.length
      ? input.pathTokens.map((t) => String(t).toLowerCase())
      : splitPathTokens(input?.expectedFile);
    for (const pt of tokens) {
      if (!queryLower.includes(pt)) continue;
      const leakSub = detectPathTokenLeak(pt, symSubs);
      if (leakSub) {
        return { ok: false, check: 'path-leak', reason: `path token "${pt}" leaks symbol stem "${leakSub}"` };
      }
    }
    const qLeak = detectQueryStemLeak(query, symSubs);
    if (qLeak) {
      return {
        ok: false,
        check: 'query-stem-leak',
        reason: `query token "${qLeak.queryToken}" leaks symbol sub-token "${qLeak.subToken}"`,
      };
    }
  }

  // Behavioural-verb regex.
  if (!BEHAVIOURAL_VERB_RE.test(query)) {
    return { ok: false, check: 'behavioural-verb', reason: 'no behavioural verb / interrogative present' };
  }

  return { ok: true, infeasible: false };
}

// ─── orchestration ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { dryRun: false, resume: false, preflight: false, targetPerFamily: null, verbose: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--resume') out.resume = true;
    else if (a === '--preflight') out.preflight = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a.startsWith('--target-per-family=')) out.targetPerFamily = parseInt(a.slice('--target-per-family='.length), 10);
    else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: author-behavioural-rewrites.mjs [--dry-run] [--resume] [--preflight] [--target-per-family=N] [--verbose]\n');
      process.exit(0);
    } else {
      process.stderr.write(`author-behavioural-rewrites: unknown arg "${a}"\n`);
      process.exit(2);
    }
  }
  return out;
}

// Mulberry32 PRNG — deterministic with seed=42 for stratified sampling.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadAllInputs() {
  if (!fs.existsSync(INPUTS_DIR)) return [];
  return fs.readdirSync(INPUTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, n), 'utf8')))
    .filter((i) => i.goldClass === 'ast-tester');
}

function sampleStratified(inputs, perFamily, rng) {
  const byFamily = new Map();
  for (const i of inputs) {
    if (!byFamily.has(i.family)) byFamily.set(i.family, []);
    byFamily.get(i.family).push(i);
  }
  const picked = [];
  for (const [family, target] of Object.entries(perFamily)) {
    const pool = byFamily.get(family) ?? [];
    if (pool.length === 0) continue;
    const shuffled = shuffleInPlace([...pool], rng);
    picked.push(...shuffled.slice(0, target));
  }
  return picked;
}

async function authorOneRewrite({ client, input }) {
  let userPrompt = buildUserPrompt(input);
  let lastQuery = null;
  let lastReason = null;
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    attempt++;
    const fullPrompt = (attempt === 1 || !lastQuery)
      ? userPrompt
      : `Your previous attempt ${JSON.stringify(lastQuery)} was rejected because: ${lastReason}. Produce a corrected rewrite respecting all hard constraints.\n\n${userPrompt}`;
    const { content } = await client.chat({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: fullPrompt,
      seed: SEED,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    });
    const parsed = tryParseJson(content);
    if (!parsed) {
      lastQuery = '<unparseable>';
      lastReason = 'response was not valid JSON';
      continue;
    }
    const v = validateBehaviouralRewrite(parsed, input);
    if (v.ok) {
      return { ok: true, attempt, parsed, validator: v };
    }
    lastQuery = parsed.rewrittenQuery ?? '<missing>';
    lastReason = v.reason ?? v.check ?? 'unknown';
  }
  return { ok: false, attempt, lastQuery, lastReason };
}

function writePerLanguageOutputs(rewritesByLang) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary = { total: 0, infeasible: 0, byLang: {} };
  for (const [lang, rewrites] of rewritesByLang.entries()) {
    const out = {
      schemaVersion: SCHEMA_VERSION,
      description: 'Behavioural rewrites of ast-tester probes — Stage 0.5 parallel benchmark',
      createdAt: new Date().toISOString(),
      rewriteModel: 'deepseek-v4-flash',
      rewriteSeed: SEED,
      rewriteTemperature: TEMPERATURE,
      language: lang,
      rewrites,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${lang}.json`), JSON.stringify(out, null, 2));
    summary.total += rewrites.length;
    summary.infeasible += rewrites.filter((r) => r.infeasible).length;
    summary.byLang[lang] = { n: rewrites.length, infeasible: rewrites.filter((r) => r.infeasible).length };
  }
  return summary;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey && !opts.dryRun && !opts.preflight) {
    process.stderr.write('DEEPSEEK_API_KEY env var required (unless --dry-run / --preflight)\n');
    process.exit(2);
  }

  const client = (apiKey || opts.preflight)
    ? createDeepSeekClient({ apiKey, concurrency: 8 })
    : null;

  if (opts.preflight) {
    try {
      const { models } = await client.preflightModels({ required: ['deepseek-v4-flash'] });
      process.stdout.write(`preflight: ${models.length} models present; deepseek-v4-flash confirmed\n`);
      process.exit(0);
    } catch (err) {
      process.stderr.write(`preflight failed: ${err.message}\n`);
      process.exit(1);
    }
  }

  const perFamily = opts.targetPerFamily
    ? Object.fromEntries(Object.keys(DEFAULT_PER_FAMILY).map((k) => [k, opts.targetPerFamily]))
    : DEFAULT_PER_FAMILY;

  const allInputs = loadAllInputs();
  if (allInputs.length === 0) {
    process.stderr.write('no ast-tester inputs — run preprocess.mjs first\n');
    process.exit(2);
  }

  const rng = mulberry32(SEED);
  const picked = sampleStratified(allInputs, perFamily, rng);
  process.stdout.write(`stratified sample: ${picked.length} golds across ${Object.keys(perFamily).length} families\n`);
  const byFam = {};
  for (const i of picked) { byFam[i.family] = (byFam[i.family] ?? 0) + 1; }
  for (const [f, n] of Object.entries(byFam)) process.stdout.write(`  ${f.padEnd(22)} n=${n}\n`);

  if (opts.dryRun) {
    process.stdout.write('\n--- DRY RUN; first 3 prompts ---\n');
    for (const i of picked.slice(0, 3)) {
      process.stdout.write(`\n--- ${i.language}-${i.goldId} ---\n`);
      process.stdout.write(buildUserPrompt(i));
      process.stdout.write('\n');
    }
    process.exit(0);
  }

  // Author concurrent — DeepSeek client has its own p-limit semaphore.
  const start = Date.now();
  const rewritesByLang = new Map();
  let okCount = 0, infeasCount = 0, failCount = 0, costEstimate = 0;
  const tasks = picked.map((input) => (async () => {
    // Resume guard: skip if this rewrite already on disk.
    if (opts.resume) {
      const existing = path.join(OUT_DIR, `${input.language}.json`);
      if (fs.existsSync(existing)) {
        const f = JSON.parse(fs.readFileSync(existing, 'utf8'));
        if (f.rewrites?.some((r) => r.rewrittenFrom === input.goldId)) {
          process.stdout.write(`  ⊘ skip ${input.language}-${input.goldId} (resume)\n`);
          return;
        }
      }
    }
    const res = await authorOneRewrite({ client, input });
    if (!res.ok) {
      failCount++;
      process.stdout.write(`  ✗ ${input.language}-${input.goldId}: ${res.lastReason} (attempts=${res.attempt})\n`);
      return;
    }
    const isInfeasible = !!res.validator.infeasible;
    if (isInfeasible) infeasCount++; else okCount++;
    const rewrittenQuery = isInfeasible ? null : res.parsed.rewrittenQuery.trim();
    const sha = rewrittenQuery ? crypto.createHash('sha256').update(rewrittenQuery).digest('hex') : null;
    const rewriteRow = {
      id: `${input.goldId}-B`,
      rewrittenFrom: input.goldId,
      rewrittenQuery,
      infeasible: isInfeasible,
      rationale: res.parsed.rationale ?? '',
      validatorVerdict: 'pass',
      authoringAttempt: res.attempt,
      outputSha256: sha,
      expectedFile: input.expectedFile,
      expectedSymbol: input.expectedSymbol,
      family: input.family,
      containingChunk: input.containingChunk
        ? { startLine: input.containingChunk.startLine, endLine: input.containingChunk.endLine }
        : null,
      authoredAt: new Date().toISOString(),
    };
    if (!rewritesByLang.has(input.language)) rewritesByLang.set(input.language, []);
    rewritesByLang.get(input.language).push(rewriteRow);
    const tag = isInfeasible ? '⊘' : '✓';
    process.stdout.write(`  ${tag} ${input.language}-${input.goldId}: ${isInfeasible ? '[infeasible] ' : ''}${rewrittenQuery ?? '(null)'}\n`);
  })());

  await Promise.all(tasks);

  const summary = writePerLanguageOutputs(rewritesByLang);
  const wallSec = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(`\nbehavioural-rewrites: ok=${okCount} infeasible=${infeasCount} failed=${failCount} wall=${wallSec}s\n`);
  process.stdout.write(`  output: ${path.relative(REPO_ROOT, OUT_DIR)}/<lang>.json (${rewritesByLang.size} languages)\n`);
}

// Only run main() when this file is executed directly. Importing the module
// (e.g. from an audit script) must not trigger a sweep.
const isMainModule = typeof process !== 'undefined'
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });
}
