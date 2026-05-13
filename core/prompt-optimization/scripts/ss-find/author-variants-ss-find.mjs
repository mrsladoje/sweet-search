#!/usr/bin/env node
/**
 * author-variants-ss-find.mjs — produce 7 Q-cell semantic-query variants
 * per AST-tester gold for the ss-find sweep (PHASE6_REDO §12.1).
 *
 * The ss-find shape grid is 7 R-cells (deterministic, see r-templates.mjs)
 * × 7 Q-cells (LLM-authored, this script). The grading at sweep time runs
 * all 49 (R, Q) combinations per gold to measure interaction effects.
 *
 * This script only authors the Q-axis — same DeepSeek V4-Flash + validator
 * + log-mirror scaffolding as `author-variants.mjs` (ss-search). The Q-cells
 * are calibrated for `ss-find`'s complementary "describe what you want" role
 * after the regex has already constrained the candidate pool:
 *
 *   Q1: empty / minimal               — does any NL query beat none? (≤ 1 token)
 *   Q2: very-short keyword phrase     — 2-4 tokens, NO symbol, domain-shaped
 *   Q3: short imperative + symbol     — 4-8 tokens, IMPERATIVE, contains symbol
 *   Q4: short interrogative + symbol  — 4-8 tokens, INTERROGATIVE, contains symbol
 *   Q5: medium descriptive (no symbol) — 9-15 tokens, declarative, behavior-focused
 *   Q6: medium behavioral imperative   — 9-15 tokens, imperative, "show / find /..."
 *   Q7: long-NL narrative              — ≥ 16 tokens, verbose context
 *
 * Doc-positive golds are SKIPPED — ss-find isn't designed for license/README.
 *
 * Output: core/prompt-optimization/data/query-shapes/ss-find/variants/<lang>-<gold>-Q<i>.json
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDeepSeekClient, DEFAULT_MODEL } from '../deepseek-client.mjs';
import {
  whitespaceTokenCount, queryLexicalTokens, longestCommonSubstringLen,
  sharesStem, symbolSubTokens,
} from '../validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/variants');

const SCHEMA_VERSION = 1;
const MAX_RETRIES = 2;
const DEFAULT_SEED = 42;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 4096;

// ─── Q-cell metadata ──────────────────────────────────────────────────────

export const Q_CELLS = Object.freeze(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7']);

export const Q_LABELS = Object.freeze({
  Q1: 'single-keyword+recycled-from-symbol',
  Q2: 'very-short+no-symbol+keyword-phrase',
  Q3: 'short+with-symbol+imperative',
  Q4: 'short+with-symbol+interrogative',
  Q5: 'medium+without-symbol+descriptive',
  Q6: 'medium+behavioral-imperative',
  Q7: 'long-NL+narrative',
});

// Length tiers (whitespace-split tokens, NOT BPE).
export const Q_LENGTH_RULES = Object.freeze({
  Q1: { min: 1, max: 1 }, // exactly 1 token — single regex-token recycled
  Q2: { min: 2, max: 4 },
  Q3: { min: 4, max: 8 },
  Q4: { min: 4, max: 8 },
  Q5: { min: 9, max: 15 },
  Q6: { min: 9, max: 15 },
  Q7: { min: 16, max: null },
});

export const Q_WITH_SYMBOL = Object.freeze(new Set(['Q3', 'Q4']));
export const Q_WITHOUT_SYMBOL = Object.freeze(new Set(['Q2', 'Q5', 'Q6', 'Q7']));
// Q1 is the empty-query control — symbol-presence is undefined.

function framingRule(cell) {
  switch (cell) {
    case 'Q1': return 'a single domain keyword (one token, NO whitespace) recycled from the symbol or its sub-tokens';
    case 'Q2': return 'noun phrase / keyword cluster (no leading verb)';
    case 'Q3': return 'imperative ("find X", "show Y")';
    case 'Q4': return 'interrogative ("how does X work", "where is X defined")';
    case 'Q5': return 'declarative behaviour-focused phrase';
    case 'Q6': return 'imperative behavioural ("show every place that …", "find the helper that …")';
    case 'Q7': return 'long verbose first-person or descriptive narrative';
    default: return '';
  }
}

function densityRule(cell) {
  if (cell === 'Q5' || cell === 'Q7') return 'low (generic English terms; lean on the regex for anchoring)';
  return 'high (domain-specific keywords) — the regex already anchors the symbol, you set the semantic context';
}

function symbolRuleQ(cell, sym) {
  if (cell === 'Q1') return `MUST be a single token (no whitespace). Pick a single domain keyword: the symbol itself "${sym}", one of its sub-tokens (e.g., "package" for "detect_package_root"), or one closely-related identifier from the source snippet.`;
  if (Q_WITH_SYMBOL.has(cell)) return `MUST contain "${sym}" verbatim, case-sensitive`;
  if (Q_WITHOUT_SYMBOL.has(cell)) return `MUST NOT contain "${sym}" (case-insensitive substring) AND must not contain its sub-token stems`;
  return '';
}

function lengthRuleQ(cell) {
  const r = Q_LENGTH_RULES[cell];
  if (r.min === 1 && r.max === 1) return 'exactly 1 token (whitespace-split) — single domain keyword';
  if (r.max == null) return `≥ ${r.min} tokens (whitespace-split)`;
  return `${r.min}-${r.max} tokens (whitespace-split)`;
}

function symbolStemForbidden(input) {
  if (!input?.expectedSymbol) return [];
  const out = new Set();
  for (const sub of symbolSubTokens(input.expectedSymbol)) {
    if (sub.length < 4) continue;
    out.add(sub);
  }
  return [...out];
}

// ─── prompt template ──────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a probe-variant author for an information-retrieval benchmark.
Specifically, you are designing the SEMANTIC-QUERY half of an ss-find query.
ss-find takes BOTH a regex anchor (which we generate separately) AND a
natural-language semantic query, which is used to re-rank ripgrep matches
via a MaxSim late-interaction model.

Your job here is to produce ONE semantic query matching the given shape cell.

Hard constraints (the variant is REJECTED if violated):
  - Token count must fall in the cell's range (whitespace-split, NOT BPE).
  - For with-symbol cells (Q3, Q4): the query MUST contain the symbol verbatim,
    case-sensitive.
  - For without-symbol cells (Q2, Q5, Q6, Q7): the query MUST NOT contain the
    symbol (case-insensitive substring) AND must not contain any sub-token
    stem of the symbol. Example: if the symbol is "detect_package_root", the
    query MUST NOT contain "detect", "package", "root", "packages", "rooted",
    or anything sharing a ≥ 5-character anchored prefix/suffix with those stems.
    Re-phrase with synonyms ("topmost folder" instead of "package root",
    "ancestor directories" instead of "parent packages").
  - For Q1 (single-keyword cell): output EXACTLY ONE token (no whitespace).
    Pick the most descriptive single keyword: the symbol itself, one of its
    sub-tokens (e.g., "package" for "detect_package_root"), or one closely-
    related identifier from the source snippet. Goal: measure whether a
    minimal one-word semantic hint moves the ranker.

Output: a single JSON object with keys \`query\` (string, possibly empty for Q1)
and \`rationale\` (string). No prose outside the JSON object. No markdown fences.`;

export function buildUserPrompt(input, cell) {
  const sym = input.expectedSymbol ?? '(no expected symbol)';
  const forbidden = symbolStemForbidden(input);
  const snippet = input.sourceSnippet?.text ?? '';
  return `gold:
  file: ${input.expectedFile}
  symbol: ${sym}
  symbolType: ${input.expectedSymbolType ?? '(none)'}
  language: ${input.canonicalLanguage ?? input.language}
  description: ${input.goldNotes ?? ''}
source (the symbol's definition + leading doc):
\`\`\`
${snippet}
\`\`\`
shape: ${cell} (${Q_LABELS[cell]})
shape rules:
  - length: ${lengthRuleQ(cell)}
  - symbol presence: ${symbolRuleQ(cell, sym)}
  - framing: ${framingRule(cell)}
  - density: ${densityRule(cell)}
  - symbol-stem forbidden tokens (Q2/Q5/Q6/Q7 only — re-phrase with synonyms): ${forbidden.length ? forbidden.join(', ') : '(none)'}

Produce the variant now.`;
}

// ─── validator (Q-specific — relaxed for Q1 empty case) ──────────────────

export function validateQVariant(parsed, cell, input) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, check: '1-schema', reason: 'output is not a JSON object' };
  }
  if (typeof parsed.query !== 'string') {
    return { ok: false, check: '1-schema', reason: 'missing or non-string `query` field' };
  }
  const cellRule = Q_LENGTH_RULES[cell];
  if (!cellRule) return { ok: false, check: '1-schema', reason: `unknown cell ${cell}` };

  const query = parsed.query;
  const n = whitespaceTokenCount(query);
  if (cellRule.min != null && n < cellRule.min) {
    return { ok: false, check: '2-length', reason: `query has ${n} tokens; cell ${cell} requires ≥ ${cellRule.min}` };
  }
  if (cellRule.max != null && n > cellRule.max) {
    return { ok: false, check: '2-length', reason: `query has ${n} tokens; cell ${cell} requires ≤ ${cellRule.max}` };
  }
  // Q1: single-keyword cell — the whole point is to recycle a token from
  // the symbol or source. Skip symbol-presence + symbol-leak + stem-leak
  // checks. The length tier (exactly 1 token) is the binding constraint.
  if (cell === 'Q1') return { ok: true };

  const sym = input?.expectedSymbol ?? null;
  const lower = query.toLowerCase();
  if (sym && Q_WITH_SYMBOL.has(cell)) {
    if (!query.includes(sym)) {
      return { ok: false, check: '3-symbol-presence', reason: `cell ${cell} requires verbatim symbol "${sym}"` };
    }
  }
  if (sym && Q_WITHOUT_SYMBOL.has(cell)) {
    if (lower.includes(sym.toLowerCase())) {
      return { ok: false, check: '4-symbol-leak', reason: `cell ${cell} forbids "${sym}" (case-insensitive)` };
    }
    // Sub-token stem leak (same rule as the ss-search validator §5.3 check 5b).
    const subs = symbolSubTokens(sym).filter((s) => s.length >= 4);
    if (subs.length > 0) {
      for (const qt of queryLexicalTokens(query)) {
        if (qt.length < 4) continue;
        for (const sub of subs) {
          if (longestCommonSubstringLen(qt, sub) < 5) continue;
          if (sharesStem(qt, sub)) {
            return {
              ok: false, check: '5b-query-stem-leak',
              reason: `query token "${qt}" leaks symbol stem "${sub}"`,
            };
          }
        }
      }
    }
  }
  return { ok: true };
}

// ─── orchestration ────────────────────────────────────────────────────────

function tryParseJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function rePromptPrefix(prev, reason) {
  return `Your previous attempt ${JSON.stringify(prev)} was rejected because: ${reason}. ` +
    `Produce a corrected variant respecting all hard constraints.\n\n`;
}

export async function authorOneQVariant({ client, input, cell, seed = DEFAULT_SEED, temperature = DEFAULT_TEMPERATURE, maxTokens = DEFAULT_MAX_TOKENS }) {
  let userPrompt = buildUserPrompt(input, cell);
  let lastQuery = null;
  let lastReason = null;
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    attempt++;
    const full = (attempt === 1 || !lastQuery)
      ? userPrompt
      : rePromptPrefix(lastQuery, lastReason) + userPrompt;
    const { content } = await client.chat({
      systemPrompt: SYSTEM_PROMPT, userPrompt: full,
      seed, temperature, maxTokens,
    });
    const parsed = tryParseJson(content);
    if (!parsed) {
      lastQuery = '<unparseable>';
      lastReason = 'response was not valid JSON';
      continue;
    }
    const verdict = validateQVariant(parsed, cell, input);
    if (verdict.ok) return { ok: true, attempt, parsed, rawContent: content };
    lastQuery = parsed.query ?? '<missing>';
    lastReason = verdict.reason ?? verdict.check;
  }
  return { ok: false, attempt, lastQuery, lastReason };
}

// ─── runner ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    lang: null, id: null, cell: null, dryRun: false, resume: false,
    concurrency: 20, preflight: false, verbose: false, logPath: undefined,
  };
  for (const arg of argv) {
    if (arg.startsWith('--lang=')) out.lang = arg.slice('--lang='.length);
    else if (arg.startsWith('--id=')) out.id = arg.slice('--id='.length);
    else if (arg.startsWith('--cell=')) out.cell = arg.slice('--cell='.length);
    else if (arg.startsWith('--concurrency=')) out.concurrency = parseInt(arg.slice('--concurrency='.length), 10);
    else if (arg.startsWith('--log=')) out.logPath = arg.slice('--log='.length);
    else if (arg === '--no-log') out.logPath = null;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--resume') out.resume = true;
    else if (arg === '--preflight') out.preflight = true;
    else if (arg === '--verbose' || arg === '-v') out.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: author-variants-ss-find.mjs [--lang=...] [--id=...] [--cell=Q1..Q7] [--concurrency=N] [--resume] [--dry-run] [--preflight] [--verbose] [--log=<path>|--no-log]\n');
      process.exit(0);
    } else {
      process.stderr.write(`author-variants-ss-find: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function attachStdoutLogger(logPath) {
  if (!logPath) return null;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `\n=== author-variants-ss-find run @ ${new Date().toISOString()} (pid ${process.pid}) ===\n`);
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    try { fs.writeSync(fd, typeof chunk === 'string' ? chunk : chunk.toString()); } catch { /* ignore */ }
    return orig(chunk, ...rest);
  };
  return fd;
}

function listInputs() {
  if (!fs.existsSync(INPUTS_DIR)) return [];
  return fs.readdirSync(INPUTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => path.join(INPUTS_DIR, n));
}

function variantOutPath(input, cell) {
  return path.join(VARIANTS_DIR, `${input.language}-${input.goldId}-${cell}.json`);
}

function writeVariant({ input, cell, parsed, attempt }) {
  fs.mkdirSync(VARIANTS_DIR, { recursive: true });
  const outPath = variantOutPath(input, cell);
  const record = {
    schemaVersion: SCHEMA_VERSION,
    tool: 'ss-find',
    axis: 'Q',
    goldId: input.goldId,
    language: input.language,
    family: input.family,
    cell,
    cellLabel: Q_LABELS[cell],
    query: parsed.query,
    rationale: parsed.rationale ?? null,
    tokenCount: whitespaceTokenCount(parsed.query),
    authoringModel: DEFAULT_MODEL,
    authoringSeed: DEFAULT_SEED,
    authoringTemperature: DEFAULT_TEMPERATURE,
    authoringAttempt: attempt,
    validatorVerdict: 'pass',
    outputSha256: crypto.createHash('sha256').update(String(parsed.query)).digest('hex'),
    authoredAt: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n');
  return outPath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const defaultLog = path.join(VARIANTS_DIR, '_progress.log');
  const logPath = opts.logPath === undefined ? defaultLog : opts.logPath;
  attachStdoutLogger(logPath);
  if (logPath) process.stdout.write(`author-variants-ss-find: mirroring stdout to ${path.relative(REPO_ROOT, logPath)} (tail -f to watch)\n`);

  if (opts.preflight) {
    const client = createDeepSeekClient({ concurrency: 1 });
    try {
      const { models } = await client.preflightModels();
      process.stdout.write(`preflight ok: ${models.length} models accessible (${DEFAULT_MODEL} present)\n`);
      process.exit(0);
    } catch (err) {
      process.stderr.write(`preflight FAILED: ${err.message}\n`);
      process.exit(1);
    }
  }

  const inputs = listInputs().map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
  if (inputs.length === 0) {
    process.stderr.write(`author-variants-ss-find: no inputs in ${INPUTS_DIR}. Run preprocess.mjs first.\n`);
    process.exit(2);
  }
  // ss-find skips doc-positive golds (no code-symbol regex anchor possible).
  const eligibleInputs = inputs.filter((i) => i.goldClass === 'ast-tester');

  const tasks = [];
  for (const input of eligibleInputs) {
    if (opts.lang && input.language !== opts.lang) continue;
    if (opts.id && input.goldId !== opts.id) continue;
    for (const cell of Q_CELLS) {
      if (opts.cell && cell !== opts.cell) continue;
      if (opts.resume && fs.existsSync(variantOutPath(input, cell))) continue;
      tasks.push({ input, cell });
    }
  }

  process.stdout.write(`author-variants-ss-find: ${tasks.length} (input, cell) tasks to author\n`);

  if (opts.dryRun) {
    for (const { input, cell } of tasks.slice(0, 3)) {
      process.stdout.write(`\n--- DRY-RUN ${input.goldId} ${cell} ---\n`);
      process.stdout.write(buildUserPrompt(input, cell).slice(0, 600) + '...\n');
    }
    process.exit(0);
  }

  const client = createDeepSeekClient({ concurrency: opts.concurrency });
  const stats = { ok: 0, fail: 0, retried: 0, byCell: {}, errors: [] };
  const start = Date.now();
  const total = tasks.length;
  function fmtDur(ms) { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; }
  function emitProgress() {
    const done = stats.ok + stats.fail;
    const wall = Date.now() - start;
    const pct = total > 0 ? (done / total) * 100 : 0;
    const rate = done > 0 ? wall / done : 0;
    const eta = (done > 0 && done < total) ? rate * (total - done) : 0;
    process.stdout.write(`  [progress] ${String(done).padStart(4)}/${total} (${pct.toFixed(1).padStart(5)}%) ok=${String(stats.ok).padStart(4)} fail=${String(stats.fail).padStart(3)} retried=${String(stats.retried).padStart(3)} wall=${fmtDur(wall).padStart(6)} eta=${eta > 0 ? fmtDur(eta).padStart(6) : '    --'}\n`);
  }
  const progressTimer = setInterval(emitProgress, 5_000);

  const promises = tasks.map((task) =>
    authorOneQVariant({ client, input: task.input, cell: task.cell })
      .then((result) => {
        if (result.ok) {
          writeVariant({ input: task.input, cell: task.cell, parsed: result.parsed, attempt: result.attempt });
          stats.ok++;
          if (result.attempt > 1) stats.retried++;
          stats.byCell[task.cell] = (stats.byCell[task.cell] || 0) + 1;
          if (opts.verbose) process.stdout.write(`  ✓ ${task.input.goldId} ${task.cell} (attempt ${result.attempt})\n`);
        } else {
          stats.fail++;
          stats.errors.push({ goldId: task.input.goldId, cell: task.cell, attempt: result.attempt, reason: result.lastReason, lastQuery: result.lastQuery });
          process.stdout.write(`  ✗ ${task.input.goldId} ${task.cell}: ${result.lastReason}\n`);
        }
      })
      .catch((err) => {
        stats.fail++;
        stats.errors.push({ goldId: task.input.goldId, cell: task.cell, attempt: -1, reason: `THROWN: ${err.message}` });
        process.stdout.write(`  ✗ ${task.input.goldId} ${task.cell}: thrown ${err.message}\n`);
      }),
  );
  await Promise.all(promises);
  clearInterval(progressTimer);
  emitProgress();
  process.stdout.write(`\nauthor-variants-ss-find: ok=${stats.ok} fail=${stats.fail} retried=${stats.retried} wall=${((Date.now() - start) / 1000).toFixed(1)}s\n  by cell: ${JSON.stringify(stats.byCell)}\n`);
  if (stats.errors.length > 0) {
    fs.mkdirSync(VARIANTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(VARIANTS_DIR, '_failures.json'), JSON.stringify({ generatedAt: new Date().toISOString(), failures: stats.errors }, null, 2));
    process.stdout.write(`  failure log: ${path.relative(REPO_ROOT, path.join(VARIANTS_DIR, '_failures.json'))}\n`);
  }
}

const isMainModule = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => { process.stderr.write(`author-variants-ss-find: fatal ${err.stack || err.message}\n`); process.exit(1); });
}
