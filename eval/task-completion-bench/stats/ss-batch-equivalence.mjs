#!/usr/bin/env node
/** Offline DEV-only packaging-equivalence gate for the typed ss-batch primitive. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  packageSearchBatchResults,
  runSearchBatchOperations,
} from '../../../core/search/search-batch.js';
import { renderSearchBatchCliResult } from '../../../core/search/search-batch-format.js';
import { estimateTokens } from '../../../core/search/context-expander.js';

export const EQUIVALENCE_SEED = 20260731;
export const EQUIVALENCE_BUDGETS = Object.freeze([6000, 8000, 10000, 12000, 16000, 20000, 24000]);
const BOOTSTRAP_ITERATIONS = 10_000;
const RECALL_MARGIN = -0.01;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPOS = Object.freeze(['fastify', 'flask', 'gin', 'ripgrep']);
export const DEV_SOURCES = Object.freeze(Object.fromEntries(REPOS.map((repo) => [repo, Object.freeze({
  queryFile: path.join(ROOT, 'eval', 'data', `pattern-benchmark-${repo}`, 'queries.jsonl'),
  projectRoot: path.join(ROOT, 'eval', 'repos', repo),
})])));

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cohortHash(seed, ids) {
  return digest(JSON.stringify({ seed, ids }));
}

export function assertCohortManifest(cohort, expectedSha256) {
  if (!cohort || !Array.isArray(cohort.rows) || !Array.isArray(cohort.ids)) {
    throw new Error('cohort manifest is incomplete');
  }
  const ids = cohort.rows.map((row) => `${row.repo}:${row.query_id}`);
  const actual = cohortHash(cohort.seed, ids);
  if (cohort.n !== ids.length || JSON.stringify(cohort.ids) !== JSON.stringify(ids)
      || cohort.sha256 !== actual) throw new Error('cohort manifest does not match its rows');
  if (!/^[a-f0-9]{64}$/.test(String(expectedSha256 || ''))) {
    throw new Error('--expect-cohort-sha is required before retrieval');
  }
  if (actual !== expectedSha256) throw new Error(`cohort sha256 mismatch: ${actual}`);
  return actual;
}

/** Repo-stratified deterministic sampling; no retrieval or index access occurs here. */
export function selectDevCohort(rowsByRepo, { perRepo = 25, seed = EQUIVALENCE_SEED } = {}) {
  if (!Number.isSafeInteger(perRepo) || perRepo < 1) throw new Error('perRepo must be a positive integer');
  if (!Number.isSafeInteger(seed)) throw new Error('seed must be an integer');
  const selected = [];
  const perRepoCounts = {};
  for (const repo of Object.keys(rowsByRepo || {}).sort()) {
    if (!Array.isArray(rowsByRepo[repo])) throw new Error(`${repo} rows must be an array`);
    const seen = new Set();
    const dev = rowsByRepo[repo].filter((row) => row?.split === 'dev').map((row) => {
      if (row.repo !== repo || typeof row.query_id !== 'string' || !row.query_id) {
        throw new Error(`${repo} has an invalid query identity`);
      }
      if (seen.has(row.query_id)) throw new Error(`${repo} has duplicate query_id ${row.query_id}`);
      seen.add(row.query_id);
      return { row, score: digest(`${seed}\0${repo}\0${row.query_id}`) };
    }).sort((a, b) => a.score.localeCompare(b.score) || a.row.query_id.localeCompare(b.row.query_id));
    if (!dev.length) throw new Error(`${repo} has no DEV rows`);
    const chosen = dev.slice(0, Math.min(perRepo, dev.length)).map(({ row }) => row);
    perRepoCounts[repo] = chosen.length;
    selected.push(...chosen);
  }
  if (!selected.length) throw new Error('cohort has no rows');
  const rows = selected.sort((a, b) => a.repo.localeCompare(b.repo) || a.query_id.localeCompare(b.query_id));
  const ids = rows.map((row) => `${row.repo}:${row.query_id}`);
  return { seed, n: rows.length, perRepo: perRepoCounts, ids, sha256: cohortHash(seed, ids), rows };
}

function parseJsonl(file) {
  if (!existsSync(file)) throw new Error(`query source missing: ${file}`);
  return readFileSync(file, 'utf8').split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch (err) { throw new Error(`invalid JSON at ${file}:${index + 1}: ${err.message}`); }
  });
}

export function loadDefaultCohort() {
  const rows = Object.fromEntries(REPOS.map((repo) => [repo, parseJsonl(DEV_SOURCES[repo].queryFile)]));
  return selectDevCohort(rows);
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function quantile(values, probability) {
  if (!values.length) throw new Error('quantile requires values');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * probability) - 1)];
}

export function pairedBootstrapLowerBound(deltas, {
  seed = EQUIVALENCE_SEED, iterations = BOOTSTRAP_ITERATIONS,
} = {}) {
  if (!Array.isArray(deltas) || !deltas.length || deltas.some((value) => !Number.isFinite(value))) {
    throw new Error('paired bootstrap requires finite task deltas');
  }
  if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error('iterations must be positive');
  const random = lcg(seed);
  const means = new Array(iterations);
  for (let iteration = 0; iteration < iterations; iteration++) {
    let sum = 0;
    for (let draw = 0; draw < deltas.length; draw++) sum += deltas[Math.floor(random() * deltas.length)];
    means[iteration] = sum / deltas.length;
  }
  return quantile(means, 0.05);
}

function normalizedFile(file) {
  return String(file || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function parseGoldSpan(value) {
  const match = String(value || '').match(/^(.+):(\d+)-(\d+)(?::\d+)?$/);
  if (!match) return null;
  return { file: normalizedFile(match[1]), startLine: Number(match[2]), endLine: Number(match[3]) };
}

function goldFor(query) {
  const files = new Set((query?.relevant_files || []).map(normalizedFile).filter(Boolean));
  const candidates = query?.relevant_chunks?.length ? query.relevant_chunks : query?.relevant_chunk_ids;
  const spans = (candidates || []).map(parseGoldSpan).filter(Boolean);
  for (const span of spans) files.add(span.file);
  if (!files.size || !spans.length) throw new Error(`${query?.query_id || '<unknown>'} lacks file/span gold`);
  return { files, spans };
}

function overlaps(left, right) {
  return normalizedFile(left.file) === normalizedFile(right.file)
    && Number(left.startLine) <= right.endLine && Number(left.endLine) >= right.startLine;
}

function identity(span) {
  return [normalizedFile(span.file), span.startLine, span.endLine, span.rank, span.symbol || ''].join('\0');
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function take(map, key) {
  const count = map.get(key) || 0;
  if (!count) return false;
  map.set(key, count - 1);
  return true;
}

function packedSpansAndAccounts(packed) {
  const emitted = [];
  const accounts = new Map();
  for (let operationIndex = 0; operationIndex < (packed?.operations || []).length; operationIndex++) {
    const operation = packed.operations[operationIndex];
    const omitted = new Map();
    const validOmitted = new Map();
    for (const span of operation.meta?.omittedSpans || []) {
      increment(omitted, identity(span));
      if (typeof span.reason === 'string' && span.reason) increment(validOmitted, identity(span));
    }
    for (const span of operation.meta?.spans || []) {
      const key = identity(span);
      if (!take(omitted, key)) {
        emitted.push({ ...span, operationIndex });
        increment(accounts, `${operation.id}\0${key}`);
      }
    }
    for (const [key, count] of validOmitted) {
      for (let index = 0; index < count; index++) increment(accounts, `${operation.id}\0${key}`);
    }
  }
  return { emitted, accounts };
}

function recallFiles(files, spans) {
  const surfaced = new Set(spans.map((span) => normalizedFile(span.file)));
  return [...files].filter((file) => surfaced.has(file)).length / files.size;
}

function recallSpans(goldSpans, spans) {
  return goldSpans.filter((gold) => spans.some((span) => overlaps(span, gold))).length / goldSpans.length;
}

function duplicateStats(spans) {
  const kept = [];
  let duplicates = 0;
  const ranked = [...spans].sort((a, b) => Number(a.rank) - Number(b.rank)
    || Number(a.operationIndex) - Number(b.operationIndex));
  for (const span of ranked) {
    const covered = kept.some((prior) => normalizedFile(span.file) === normalizedFile(prior.file)
      && span.startLine >= prior.startLine && span.endLine <= prior.endLine);
    if (covered) duplicates++;
    else kept.push(span);
  }
  return { spans: spans.length, duplicates };
}

function serialUnionText(rawResults) {
  let output = '';
  for (const raw of rawResults) {
    const status = raw.status === 'ok' && raw.sourceTruncated === true ? 'truncated' : raw.status;
    output += `[${raw.id}] tool=${raw.tool} status=${status}\n${raw.message ? `${raw.message}\n` : ''}`;
    for (const span of raw.spans || []) {
      const symbol = span.symbol ? ` symbol=${span.symbol}` : '';
      const type = span.type ? ` type=${span.type}` : '';
      output += `[span rank=${span.rank} ${span.file}:${span.startLine}-${span.endLine}${symbol}${type}]\n${span.text || '(metadata-only span)'}\n`;
    }
    if (raw.auxText) output += `${raw.auxText}\n`;
    if (!(raw.spans || []).length && raw.status === 'ok') {
      output += '(all ranked spans omitted as duplicates)\n';
    }
  }
  return output;
}

export function evaluateTaskPacking(task, packed) {
  if (!Array.isArray(task?.rawResults) || ![2, 3].includes(task.rawResults.length)) {
    throw new Error(`${task?.id || '<unknown>'} rawResults must contain 2-3 operations`);
  }
  const gold = goldFor(task.query);
  const serialSpans = task.rawResults.flatMap((raw, operationIndex) =>
    (raw.spans || []).map((span) => ({ ...span, operationIndex, operationId: raw.id })));
  const { emitted, accounts } = packedSpansAndAccounts(packed);
  const relevant = serialSpans.filter((span) => gold.spans.some((target) => overlaps(span, target)));
  let unaccounted = 0;
  for (const span of relevant) {
    if (!take(accounts, `${span.operationId}\0${identity(span)}`)) unaccounted++;
  }
  const serialDuplicates = duplicateStats(serialSpans);
  const packedDuplicates = duplicateStats(emitted);
  const serialText = serialUnionText(task.rawResults);
  const packedText = renderSearchBatchCliResult(packed);
  return {
    id: task.id,
    operationCount: task.rawResults.length,
    executionErrors: task.rawResults.filter((raw) => raw.status === 'error').length,
    serialFileRecall: recallFiles(gold.files, serialSpans),
    packedFileRecall: recallFiles(gold.files, emitted),
    serialSpanRecall: recallSpans(gold.spans, serialSpans),
    packedSpanRecall: recallSpans(gold.spans, emitted),
    relevantSerialSpanCount: relevant.length,
    unaccountedRelevantSerialSpans: unaccounted,
    serialTokens: estimateTokens(serialText),
    packedTokens: estimateTokens(packedText),
    serialChars: serialText.length,
    packedChars: packedText.length,
    serialSpanCount: serialDuplicates.spans,
    serialDuplicateCount: serialDuplicates.duplicates,
    packedSpanCount: packedDuplicates.spans,
    packedDuplicateCount: packedDuplicates.duplicates,
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateBudget(tasks, budget, {
  seed = EQUIVALENCE_SEED, bootstrapIterations = BOOTSTRAP_ITERATIONS,
} = {}) {
  if (!Array.isArray(tasks) || !tasks.length) throw new Error('budget evaluation requires tasks');
  const rows = tasks.map((task) => evaluateTaskPacking(
    task, packageSearchBatchResults(task.rawResults, { maxChars: budget }),
  ));
  const fileDeltas = rows.map((row) => row.packedFileRecall - row.serialFileRecall);
  const spanDeltas = rows.map((row) => row.packedSpanRecall - row.serialSpanRecall);
  const fileLower95 = pairedBootstrapLowerBound(fileDeltas, { seed, iterations: bootstrapIterations });
  const spanLower95 = pairedBootstrapLowerBound(spanDeltas, { seed, iterations: bootstrapIterations });
  const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
  const operations = total('operationCount');
  const serialDuplicateRate = total('serialDuplicateCount') / (total('serialSpanCount') || 1);
  const packedDuplicateRate = total('packedDuplicateCount') / (total('packedSpanCount') || 1);
  const serialTokensPerOperation = total('serialTokens') / operations;
  const packedTokensPerOperation = total('packedTokens') / operations;
  const serialP95Tokens = quantile(rows.map((row) => row.serialTokens), 0.95);
  const packedP95Tokens = quantile(rows.map((row) => row.packedTokens), 0.95);
  const serialCharsPerOperation = total('serialChars') / operations;
  const packedCharsPerOperation = total('packedChars') / operations;
  const serialP95Chars = quantile(rows.map((row) => row.serialChars), 0.95);
  const packedP95Chars = quantile(rows.map((row) => row.packedChars), 0.95);
  const unaccounted = total('unaccountedRelevantSerialSpans');
  const executionErrors = total('executionErrors');
  const failureReasons = [];
  if (executionErrors) failureReasons.push(`${executionErrors} raw operation errors`);
  if (fileLower95 < RECALL_MARGIN) failureReasons.push(`target-file recall lower95 ${fileLower95} < ${RECALL_MARGIN}`);
  if (spanLower95 < RECALL_MARGIN) failureReasons.push(`target-span recall lower95 ${spanLower95} < ${RECALL_MARGIN}`);
  if (unaccounted) failureReasons.push(`${unaccounted} relevant serial spans neither emitted nor omitted`);
  if (packedP95Tokens > serialP95Tokens) failureReasons.push('p95 packed tokens exceed serial union');
  if (packedTokensPerOperation > serialTokensPerOperation) failureReasons.push('packed tokens/op exceed serial');
  if (packedDuplicateRate > serialDuplicateRate) failureReasons.push('packed duplicate-span rate exceeds serial');
  return {
    budget, pass: failureReasons.length === 0, failureReasons, n: rows.length,
    recall: {
      file: { serial: mean(rows.map((row) => row.serialFileRecall)), packed: mean(rows.map((row) => row.packedFileRecall)), delta: mean(fileDeltas), lower95: fileLower95 },
      span: { serial: mean(rows.map((row) => row.serialSpanRecall)), packed: mean(rows.map((row) => row.packedSpanRecall)), delta: mean(spanDeltas), lower95: spanLower95 },
    },
    relevantSpanAccounting: { surfaced: total('relevantSerialSpanCount'), unaccounted },
    tokens: { serialP95: serialP95Tokens, packedP95: packedP95Tokens, serialPerOperation: serialTokensPerOperation, packedPerOperation: packedTokensPerOperation },
    chars: { serialP95: serialP95Chars, packedP95: packedP95Chars, serialPerOperation: serialCharsPerOperation, packedPerOperation: packedCharsPerOperation },
    duplicateSpanRate: { serial: serialDuplicateRate, packed: packedDuplicateRate },
    executionErrors,
  };
}

export function evaluateBudgetSweep(tasks, {
  budgets = EQUIVALENCE_BUDGETS, seed = EQUIVALENCE_SEED,
  bootstrapIterations = BOOTSTRAP_ITERATIONS,
} = {}) {
  const ordered = [...new Set(budgets)].sort((a, b) => a - b);
  if (!ordered.length || ordered.some((budget) => !Number.isSafeInteger(budget))) {
    throw new Error('budgets must be non-empty integers');
  }
  const results = ordered.map((budget) => evaluateBudget(tasks, budget, { seed, bootstrapIterations }));
  const selected = results.find((result) => result.pass);
  return {
    verdict: selected ? 'PASS' : 'FAIL', seed, n: tasks.length,
    selectedBudget: selected?.budget ?? null,
    method: {
      bootstrap: 'task-paired-one-sided', confidence: 0.95,
      bootstrapIterations, recallMargin: RECALL_MARGIN,
      tokenEstimator: 'context-expander estimateTokens',
      packedRenderer: 'renderSearchBatchCliResult', charsAreDiagnosticOnly: true,
    },
    budgets: results,
  };
}

function operationsFor(query) {
  if (typeof query?.semantic_query !== 'string' || !query.semantic_query
      || typeof query.regex !== 'string' || !query.regex) {
    throw new Error(`${query?.query_id || '<unknown>'} lacks search inputs`);
  }
  goldFor(query);
  return [
    { id: 'search', tool: 'search', args: { query: query.semantic_query, k: 20, mode: 'hybrid' } },
    { id: 'pattern', tool: 'find', args: { query: query.semantic_query, regex: query.regex, k: 20 } },
  ];
}

async function createSearcher(source) {
  if (!existsSync(source.projectRoot) || !existsSync(path.join(source.projectRoot, '.sweet-search'))) {
    throw new Error(`DEV repo or index missing: ${source.projectRoot}`);
  }
  const projectRoot = realpathSync.native(source.projectRoot);
  const index = path.join(projectRoot, '.sweet-search');
  const { SweetSearch } = await import('../../../core/search/sweet-search.js');
  const searcher = new SweetSearch({
    projectRoot,
    graphDbPath: path.join(index, 'code-graph.db'),
    codebaseDbPath: path.join(index, 'codebase.db'),
    hnswPath: path.join(index, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(index, 'codebase-binary-hnsw.idx'),
    sparseGramIndexPath: path.join(index, 'codebase-sparse-grams.idx'),
    lateInteractionOptions: { indexPath: path.join(index, 'codebase-late-interaction.db') },
    verbose: false,
  });
  await searcher.init();
  return searcher;
}

export async function runEquivalenceGate({
  cohort = loadDefaultCohort(), searcherFactory = createSearcher, expectedCohortSha256,
} = {}) {
  assertCohortManifest(cohort, expectedCohortSha256);
  const tasks = [];
  for (const repo of REPOS) {
    const source = DEV_SOURCES[repo];
    const rows = cohort.rows.filter((row) => row.repo === repo);
    let searcher;
    try {
      searcher = await searcherFactory(source);
      for (const query of rows) {
        const plan = { projectRoot: realpathSync.native(source.projectRoot), operations: operationsFor(query) };
        const rawResults = await runSearchBatchOperations(plan, { searcher });
        tasks.push({ id: `${repo}:${query.query_id}`, repo, query, rawResults });
      }
    } finally {
      await searcher?.close?.();
    }
  }
  if (tasks.length !== cohort.n) throw new Error(`executed ${tasks.length}/${cohort.n} cohort tasks`);
  const sweep = evaluateBudgetSweep(tasks);
  return {
    ...sweep,
    cohort: {
      seed: cohort.seed, n: cohort.n, perRepo: cohort.perRepo,
      ids: cohort.ids, sha256: cohort.sha256,
    },
  };
}

function parseArgs(argv) {
  let cohortOnly = false;
  let expectedCohortSha256 = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--cohort-only') cohortOnly = true;
    else if (arg === '--expect-cohort-sha') expectedCohortSha256 = argv[++index];
    else if (arg !== '--json') throw new Error(`unknown option: ${arg}`);
  }
  if (cohortOnly && expectedCohortSha256) throw new Error('--cohort-only does not accept an expected hash');
  return { cohortOnly, expectedCohortSha256 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const cohort = loadDefaultCohort();
    if (options.cohortOnly) {
      const { rows: _rows, ...manifest } = cohort;
      console.log(JSON.stringify({ mode: 'cohort-only', ...manifest }, null, 2));
    } else {
      const report = await runEquivalenceGate({
        cohort, expectedCohortSha256: options.expectedCohortSha256,
      });
      console.log(JSON.stringify(report, null, 2));
      if (report.verdict !== 'PASS') process.exitCode = 1;
    }
  } catch (err) {
    console.log(JSON.stringify({ verdict: 'INVALID — not adjudicated', error: String(err.message || err) }, null, 2));
    process.exitCode = 1;
  }
}
