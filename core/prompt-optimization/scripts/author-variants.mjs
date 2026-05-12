#!/usr/bin/env node
/**
 * author-variants.mjs — produce variants/<lang>-<probe-id>-<shape>.json per
 * docs/PHASE6_REDO.md §5.2 + §5.5.3 + §5.5.5.
 *
 * Pipeline (per spec §5.2):
 *   for each input in inputs/*.json:
 *     for each shape in input.eligibleShapes:
 *       prompt = build_prompt(input, shape)
 *       variant = await deepseek_direct(prompt, response_format={type:'json_object'},
 *                                       seed=42, temperature=0.3)
 *       parsed = JSON.parse(variant)
 *       schemaValidator(parsed)
 *       validator(parsed, shape, input)
 *       on validator failure → re-prompt with stricter instruction (max 2 retries)
 *       outputSha256 = sha256(parsed.query)
 *       write variants/<lang>-<gold.id>-<shape>.json
 *
 * Usage:
 *   node author-variants.mjs                       # all eligible (input × shape)
 *   node author-variants.mjs --lang=rust           # one language
 *   node author-variants.mjs --id=RS-001           # one gold
 *   node author-variants.mjs --shape=V2            # one shape
 *   node author-variants.mjs --dry-run             # print prompts, no API
 *   node author-variants.mjs --concurrency=20      # default 20 (§5.2)
 *   node author-variants.mjs --resume              # skip variants already on disk
 *   node author-variants.mjs --preflight           # only run preflightModels and exit
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDeepSeekClient, DEFAULT_MODEL } from './deepseek-client.mjs';
import { validateVariant, LENGTH_RULES, WITH_SYMBOL_CELLS, PATH_STOPWORDS } from './validator.mjs';
import { pathTokens as splitPathTokens, symbolSubTokens, detectPathTokenLeak } from './validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants');

const SCHEMA_VERSION = 2;
const MAX_RETRIES = 2; // §5.2: max 2 retries; persistent failures logged
const DEFAULT_SEED = 42;
const DEFAULT_TEMPERATURE = 0.3;
// PHASE6_REDO.md §5.5.4 originally pinned max_tokens=512 because we don't
// need chain-of-thought. As of 2026-05-13, DeepSeek's `deepseek-v4-flash`
// silently emits `reasoning_content` even when called without a reasoning
// field — and those reasoning tokens consume `max_tokens` before any
// visible content is written. Per user memory
// `project_deepseek_max_tokens_reasoning`: ≥ 4096 is required, otherwise the
// `content` field returns empty / truncated. The first spot-check on rust
// (2026-05-13) saw ~46% of calls fail with "response was not valid JSON"
// at max_tokens=512 — every failure came back with empty content while the
// reasoning_content slot was populated.
const DEFAULT_MAX_TOKENS = 4096;

// ─── shape labels (mirror docs/PHASE6_REDO.md §5 table) ───────────────────

const SHAPE_LABELS = Object.freeze({
  V1: 'very-short+with-symbol+narrow-regex+imperative+high-density',
  V2: 'short+with-symbol+narrow-regex+interrogative+high-density',
  V3: 'short+without-symbol+medium-regex+declarative+high-density',
  V4: 'medium+with-symbol+medium-regex+interrogative+high-density',
  V5: 'medium+without-symbol+broad-regex+interrogative+low-density',
  V6: 'long-NL+without-symbol+broad-regex+interrogative+low-density',
  V7: 'medium+with-symbol+narrow-regex+declarative+high-density',
});

function lengthRuleString(shape) {
  const { min, max } = LENGTH_RULES[shape];
  if (min != null && max != null) return `${min}-${max} tokens (whitespace-split)`;
  if (min != null) return `≥ ${min} tokens (whitespace-split)`;
  if (max != null) return `≤ ${max} tokens (whitespace-split)`;
  return 'no bound';
}

function framingRule(shape) {
  if (shape === 'V1') return 'imperative ("find X", "show Y")';
  if (shape === 'V3' || shape === 'V7') return 'declarative noun-phrase ("X that does Y", no leading verb)';
  return 'interrogative ("how does X work", "where is X defined")';
}

function densityRule(shape) {
  if (shape === 'V5' || shape === 'V6') return 'low (generic English terms; avoid repo-specific identifiers)';
  return 'high (multiple domain-specific identifiers)';
}

function symbolRule(shape, sym) {
  if (WITH_SYMBOL_CELLS.has(shape)) {
    return `MUST contain the symbol "${sym}" verbatim, case-sensitive`;
  }
  return (
    `MUST NOT contain "${sym}" (case-insensitive substring) AND must not contain ` +
    `path tokens OR query tokens that lexically overlap with any symbol sub-token stem`
  );
}

/**
 * Sub-tokens of the symbol the model must AVOID as standalone query words
 * in V3/V5/V6 (§5.3 check 5b). Filters out tiny tokens (< 4 chars) and
 * common stopwords so the model gets a tight, actionable list rather than
 * being told to dodge "is"/"to"/etc.
 */
function symbolStemForbiddenTokens(input) {
  if (!input?.expectedSymbol && !input?.expectedSymbolAnyOf?.length) return [];
  const anyOf = input.expectedSymbolAnyOf?.length
    ? input.expectedSymbolAnyOf
    : [input.expectedSymbol];
  const out = new Set();
  for (const sym of anyOf) {
    for (const sub of symbolSubTokens(sym)) {
      if (sub.length < 4) continue;
      if (PATH_STOPWORDS.has(sub)) continue;
      out.add(sub);
    }
  }
  return [...out];
}

/**
 * Build the list of path tokens that would trigger a leak per §5.3 check 5.
 * Surfaced into the prompt so the model can avoid them up front.
 */
function leakForbiddenTokens(input) {
  if (!input?.expectedSymbol) return [];
  const symSubs = symbolSubTokens(input.expectedSymbol);
  const tokens = input.pathTokens?.length
    ? input.pathTokens.map((t) => String(t).toLowerCase())
    : splitPathTokens(input.expectedFile);
  const out = [];
  for (const pt of tokens) {
    if (detectPathTokenLeak(pt, symSubs)) out.push(pt);
  }
  return out;
}

// ─── prompt templates (§5.5.5 verbatim) ───────────────────────────────────

export const SYSTEM_PROMPT = `You are a probe-variant author for an information-retrieval benchmark.
Given a code symbol from a real repository and a target shape cell, produce one
natural-language query that exercises the specified shape.

Hard constraints (the variant is REJECTED if violated):
  - Token count must fall in the cell's range (whitespace-split, NOT BPE).
  - For with-symbol cells (V1, V2, V4, V7): the query MUST contain the symbol verbatim,
    case-sensitive.
  - For without-symbol cells (V3, V5, V6): the query MUST NOT contain the symbol
    (case-insensitive substring) AND MUST NOT contain any sub-token stem of the symbol.
    Sub-tokens are the underscore-separated pieces of the symbol name. Example:
    if the symbol is "detect_package_root", the query MUST NOT contain "detect",
    "package", "root", "packages", "rooted", or any other word that shares a
    ≥ 5-character anchored prefix or suffix with one of those sub-tokens. Re-phrase
    the user's intent using synonyms ("topmost folder" instead of "package root",
    "ancestor directories" instead of "parent packages", etc).

Output: a single JSON object with keys \`query\` (string) and \`rationale\` (string).
No prose outside the JSON object. No markdown fences.`;

export function buildUserPrompt(input, shape) {
  const sym = input.expectedSymbol ?? '(no expected symbol; doc-positive gold)';
  const forbiddenPath = leakForbiddenTokens(input);
  const forbiddenStems = symbolStemForbiddenTokens(input);
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
shape: ${shape} (${SHAPE_LABELS[shape]})
shape rules:
  - length: ${lengthRuleString(shape)}
  - symbol presence: ${symbolRule(shape, sym)}
  - framing: ${framingRule(shape)}
  - density: ${densityRule(shape)}
  - path-leak forbidden tokens: ${forbiddenPath.length ? forbiddenPath.join(', ') : '(none)'}
  - symbol-stem forbidden tokens (V3/V5/V6 only — re-phrase with synonyms): ${forbiddenStems.length ? forbiddenStems.join(', ') : '(none)'}

Produce the variant now.`;
}

/**
 * Re-prompt prefix per §5.5.5. Used when the validator rejects on retry.
 */
function rePromptPrefix(prevQuery, reason) {
  return `Your previous attempt ${JSON.stringify(prevQuery)} was rejected because: ${reason}. ` +
    `Produce a corrected variant respecting all hard constraints.\n\n`;
}

// ─── single-variant authoring loop ────────────────────────────────────────

function tryParseJson(text) {
  if (typeof text !== 'string') return null;
  // DeepSeek's response_format:'json_object' is supposed to return a pure
  // JSON object, but in practice models sometimes wrap it. Be defensive.
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* try fallbacks below */ }
  // Find the first balanced JSON object substring.
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function authorOneVariant({
  client, input, shape, seed = DEFAULT_SEED, temperature = DEFAULT_TEMPERATURE, maxTokens = DEFAULT_MAX_TOKENS,
}) {
  let userPrompt = buildUserPrompt(input, shape);
  let lastQuery = null;
  let lastReason = null;
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    attempt++;
    const fullPrompt = (attempt === 1 || !lastQuery)
      ? userPrompt
      : rePromptPrefix(lastQuery, lastReason) + userPrompt;
    const { content } = await client.chat({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: fullPrompt,
      seed,
      temperature,
      maxTokens,
    });
    const parsed = tryParseJson(content);
    if (!parsed) {
      lastQuery = '<unparseable>';
      lastReason = 'response was not valid JSON';
      continue;
    }
    const verdict = validateVariant(parsed, shape, input);
    if (verdict.ok) {
      return {
        ok: true,
        attempt,
        parsed,
        rawContent: content,
      };
    }
    lastQuery = parsed.query ?? '<missing>';
    lastReason = verdict.reason ?? verdict.check ?? 'unknown';
  }
  return {
    ok: false,
    attempt,
    lastQuery,
    lastReason,
  };
}

// ─── orchestration ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    lang: null, id: null, shape: null, dryRun: false, resume: false,
    concurrency: 20, preflight: false, verbose: false, logPath: undefined,
  };
  for (const arg of argv) {
    if (arg.startsWith('--lang=')) out.lang = arg.slice('--lang='.length);
    else if (arg.startsWith('--id=')) out.id = arg.slice('--id='.length);
    else if (arg.startsWith('--shape=')) out.shape = arg.slice('--shape='.length);
    else if (arg.startsWith('--concurrency=')) out.concurrency = parseInt(arg.slice('--concurrency='.length), 10);
    else if (arg.startsWith('--log=')) out.logPath = arg.slice('--log='.length);
    else if (arg === '--no-log') out.logPath = null;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--resume') out.resume = true;
    else if (arg === '--preflight') out.preflight = true;
    else if (arg === '--verbose' || arg === '-v') out.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: author-variants.mjs [--lang=...] [--id=...] [--shape=V1..V7] [--concurrency=N] [--resume] [--dry-run] [--preflight] [--verbose] [--log=<path> | --no-log]\n');
      process.exit(0);
    } else {
      process.stderr.write(`author-variants: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

/**
 * Mirror process.stdout.write to a log file so backgrounded / piped runs
 * are still tail-followable from another terminal. The override is process-
 * lifetime — restored at shutdown is unnecessary (the script exits anyway).
 *
 * Each write is line-flushed to the file (fs.writeSync on a fd opened with
 * 'a') so `tail -f` sees data immediately, NOT only at process exit.
 */
function attachStdoutLogger(logPath) {
  if (!logPath) return null;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  const startBanner = `\n=== author-variants run @ ${new Date().toISOString()} (pid ${process.pid}) ===\n`;
  fs.writeSync(fd, startBanner);
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    try { fs.writeSync(fd, typeof chunk === 'string' ? chunk : chunk.toString()); } catch { /* ignore */ }
    return origWrite(chunk, ...rest);
  };
  return fd;
}

function listInputs() {
  if (!fs.existsSync(INPUTS_DIR)) return [];
  return fs.readdirSync(INPUTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => path.join(INPUTS_DIR, n));
}

function loadInput(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function variantOutPath(input, shape) {
  const filename = `${input.language}-${input.goldId}-${shape}.json`;
  return path.join(VARIANTS_DIR, filename);
}

function whitespaceTokens(s) {
  return String(s ?? '').trim().split(/\s+/u).filter(Boolean).length;
}

function writeVariant({ input, shape, parsed, attempt, dryRun }) {
  if (dryRun) return null;
  fs.mkdirSync(VARIANTS_DIR, { recursive: true });
  const outPath = variantOutPath(input, shape);
  const record = {
    schemaVersion: SCHEMA_VERSION,
    goldId: input.goldId,
    language: input.language,
    family: input.family,
    shape,
    shapeLabel: SHAPE_LABELS[shape],
    query: parsed.query,
    rationale: parsed.rationale ?? null,
    tokenCount: whitespaceTokens(parsed.query),
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

  // Attach a log mirror BEFORE any stdout write so the file captures the
  // banner + task count + progress + per-task lines. Default location lives
  // alongside the authored variants; `--no-log` disables; `--log=<path>`
  // overrides. Tail-follow from another terminal:
  //   tail -f core/prompt-optimization/data/query-shapes/variants/_progress.log
  const defaultLog = path.join(VARIANTS_DIR, '_progress.log');
  const logPath = opts.logPath === undefined ? defaultLog : opts.logPath;
  attachStdoutLogger(logPath);
  if (logPath) {
    process.stdout.write(`author-variants: mirroring stdout to ${path.relative(REPO_ROOT, logPath)} (tail -f to watch)\n`);
  }

  // Preflight-only mode: confirm the configured DeepSeek model is in the account's model list (§5.5.4)
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

  const inputFiles = listInputs();
  if (inputFiles.length === 0) {
    process.stderr.write(`author-variants: no inputs in ${INPUTS_DIR}. Run preprocess.mjs first.\n`);
    process.exit(2);
  }

  // Enumerate (input, shape) tasks.
  const tasks = [];
  for (const f of inputFiles) {
    const input = loadInput(f);
    if (opts.lang && input.language !== opts.lang) continue;
    if (opts.id && input.goldId !== opts.id) continue;
    for (const shape of input.eligibleShapes) {
      if (opts.shape && shape !== opts.shape) continue;
      if (opts.resume && fs.existsSync(variantOutPath(input, shape))) continue;
      tasks.push({ input, shape });
    }
  }

  process.stdout.write(`author-variants: ${tasks.length} (input, shape) tasks to author\n`);

  if (opts.dryRun) {
    for (const { input, shape } of tasks.slice(0, 5)) {
      process.stdout.write(`\n--- DRY-RUN ${input.goldId} ${shape} ---\n`);
      process.stdout.write(buildUserPrompt(input, shape).slice(0, 600) + '...\n');
    }
    process.stdout.write(`\n(dry-run: ${tasks.length} tasks total; only first 5 shown)\n`);
    process.exit(0);
  }

  const client = createDeepSeekClient({ concurrency: opts.concurrency });

  // p-limit semaphore lives inside the client. Issuing all promises at once
  // is the §5.2 pattern — the semaphore caps in-flight at `concurrency`.
  const stats = { ok: 0, fail: 0, retried: 0, byShape: {}, errors: [] };
  const start = Date.now();
  const total = tasks.length;

  // Periodic progress reporter. Heartbeats every PROGRESS_INTERVAL_MS even
  // when no task is completing — that way the user knows the process is
  // alive during rate-limit backoff windows.
  const PROGRESS_INTERVAL_MS = 5_000;
  const progressTimer = setInterval(() => emitProgress(), PROGRESS_INTERVAL_MS);

  function pad(s, n) { return String(s).padStart(n, ' '); }
  function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m${pad(sec, 2)}s`;
  }
  function emitProgress() {
    const done = stats.ok + stats.fail;
    const wall = Date.now() - start;
    const pct = total > 0 ? (done / total) * 100 : 0;
    const rate = done > 0 ? wall / done : 0; // ms per completion
    const etaMs = done > 0 && done < total ? rate * (total - done) : 0;
    process.stdout.write(
      `  [progress] ${pad(done, 4)}/${total} (${pct.toFixed(1).padStart(5, ' ')}%) ` +
        `ok=${pad(stats.ok, 4)} fail=${pad(stats.fail, 3)} retried=${pad(stats.retried, 3)} ` +
        `wall=${formatDuration(wall).padStart(6, ' ')} ` +
        `eta=${etaMs > 0 ? formatDuration(etaMs).padStart(6, ' ') : '    --'}\n`,
    );
  }

  const promises = tasks.map((task) =>
    authorOneVariant({ client, input: task.input, shape: task.shape })
      .then((result) => {
        if (result.ok) {
          writeVariant({
            input: task.input,
            shape: task.shape,
            parsed: result.parsed,
            attempt: result.attempt,
            dryRun: false,
          });
          stats.ok++;
          if (result.attempt > 1) stats.retried++;
          stats.byShape[task.shape] = (stats.byShape[task.shape] || 0) + 1;
          if (opts.verbose) process.stdout.write(`  ✓ ${task.input.goldId} ${task.shape} (attempt ${result.attempt})\n`);
        } else {
          stats.fail++;
          stats.errors.push({
            goldId: task.input.goldId,
            shape: task.shape,
            attempt: result.attempt,
            reason: result.lastReason,
            lastQuery: result.lastQuery,
          });
          // Failures always print, even in non-verbose mode — they are
          // actionable signal during a long run.
          process.stdout.write(`  ✗ ${task.input.goldId} ${task.shape}: ${result.lastReason}\n`);
        }
      })
      .catch((err) => {
        stats.fail++;
        stats.errors.push({
          goldId: task.input.goldId,
          shape: task.shape,
          attempt: -1,
          reason: `THROWN: ${err.message}`,
        });
        process.stdout.write(`  ✗ ${task.input.goldId} ${task.shape}: thrown ${err.message}\n`);
      }),
  );
  await Promise.all(promises);
  clearInterval(progressTimer);
  emitProgress(); // final flush
  const wallSec = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(
    `\nauthor-variants: ok=${stats.ok} fail=${stats.fail} retried=${stats.retried} wall=${wallSec}s\n` +
      `  by shape: ${JSON.stringify(stats.byShape)}\n`,
  );
  if (stats.errors.length > 0) {
    // Persist the failure log alongside the variants so the §13 step-5 spot
    // check and any subsequent human-author fallback (§14 risk 5) can use it.
    fs.mkdirSync(VARIANTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(VARIANTS_DIR, '_failures.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), failures: stats.errors }, null, 2),
    );
    process.stdout.write(`  failure log: ${path.relative(REPO_ROOT, path.join(VARIANTS_DIR, '_failures.json'))}\n`);
  }
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`author-variants: fatal ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
