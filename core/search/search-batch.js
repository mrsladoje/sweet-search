import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { readFiles } from './search-read.js';
import { readSemantic } from './search-read-semantic.js';
import { traceSymbol } from './search-trace.js';

export const SEARCH_BATCH_VERSION = 1;
export const SEARCH_BATCH_DEFAULT_MAX_CHARS = 16_000;
export const SEARCH_BATCH_MIN_MAX_CHARS = 1024;
export const SEARCH_BATCH_MAX_MAX_CHARS = 64_000;
const TOOLS = new Set(['search', 'grep', 'find', 'read', 'semantic', 'trace']);
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const INDEX_TOOLS = new Set(['search', 'grep', 'find', 'semantic', 'trace']);
const CONCURRENT_SAFE_TOOLS = new Set(['read']);
export class SearchBatchValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SearchBatchValidationError';
    this.status = status;
  }
}
function invalid(message, status = 400) {
  throw new SearchBatchValidationError(message, status);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactFields(value, allowed, label) {
  if (!isRecord(value)) invalid(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) invalid(`${label} has unknown field: ${unknown[0]}`);
}
function stringArg(value, name, { max, optional = false } = {}) {
  if (value == null && optional) return undefined;
  if (typeof value !== 'string' || value.length === 0) invalid(`${name} must be a non-empty string`);
  if (value.includes('\0')) invalid(`${name} must not contain NUL`);
  if (value.length > max) invalid(`${name} must be at most ${max} characters`);
  return value;
}
function integerArg(value, name, min, max, { optional = false } = {}) {
  if (value == null && optional) return undefined;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    invalid(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
function numberArg(value, name, min, max, { optional = false } = {}) {
  if (value == null && optional) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(`${name} must be a number from ${min} to ${max}`);
  }
  return value;
}
function booleanArg(value, name, { optional = false } = {}) {
  if (value == null && optional) return undefined;
  if (typeof value !== 'boolean') invalid(`${name} must be a boolean`);
  return value;
}
function rejectReferences(value, operationIds, label) {
  const referenceKeys = new Set(['ref', '$ref', 'fromOperation', 'from_operation']);
  if (typeof value === 'string') {
    if (/\$\{[^}]*\}|\{\{[\s\S]*?\}\}/.test(value)) invalid(`${label} contains a placeholder or result reference`);
    for (const id of operationIds) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reference = new RegExp(`\\$${escaped}(?=$|[.\\[:{_\\-0-9])`);
      if (reference.test(value)) invalid(`${label} references operation ${id}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectReferences(entry, operationIds, `${label}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (referenceKeys.has(key)) invalid(`${label} has reference-shaped field: ${key}`);
    rejectReferences(entry, operationIds, `${label}.${key}`);
  }
}
function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function canonicalDaemonRoot(root) {
  const resolved = path.resolve(root || process.cwd());
  try { return realpathSync.native(resolved); }
  catch { invalid('daemon project root is unavailable', 500); }
}
function canonicalRequestRoot(root) {
  stringArg(root, 'projectRoot', { max: 8192 });
  if (!path.isAbsolute(root)) invalid('projectRoot must be an absolute canonical path');
  let canonical;
  try {
    canonical = realpathSync.native(root);
    if (!statSync(canonical).isDirectory()) invalid('projectRoot must be a directory');
  } catch (err) {
    if (err instanceof SearchBatchValidationError) throw err;
    invalid('projectRoot must exist');
  }
  if (root !== canonical) invalid('projectRoot must be canonical');
  return canonical;
}
function safeRelativePath(root, value, name) {
  const raw = stringArg(value, name, { max: 8192 });
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw)) invalid(`${name} must be relative`);
  if (raw.split(/[\\/]/).includes('..')) invalid(`${name} must not contain traversal`);
  const absolute = path.resolve(root, raw);
  if (!withinRoot(root, absolute)) invalid(`${name} escapes projectRoot`);

  let probe = absolute;
  while (!existsSync(probe) && probe !== root) probe = path.dirname(probe);
  let canonicalProbe;
  try { canonicalProbe = realpathSync.native(probe); }
  catch { invalid(`${name} has an invalid filesystem path`); }
  if (!withinRoot(root, canonicalProbe)) invalid(`${name} resolves outside projectRoot`);

  if (existsSync(absolute)) {
    const canonicalTarget = realpathSync.native(absolute);
    if (!withinRoot(root, canonicalTarget)) invalid(`${name} resolves outside projectRoot`);
  }
  const normalized = path.relative(root, absolute);
  return normalized === '' ? '.' : normalized.split(path.sep).join('/');
}
function validateArgs(tool, args, root) {
  const label = `${tool}.args`;
  switch (tool) {
    case 'search': {
      exactFields(args, ['query', 'k', 'mode'], label);
      const query = stringArg(args.query, `${label}.query`, { max: 2000 });
      const k = integerArg(args.k, `${label}.k`, 1, 20, { optional: true });
      const mode = args.mode ?? 'auto';
      if (!['auto', 'lexical', 'semantic', 'hybrid'].includes(mode)) invalid(`${label}.mode is invalid`);
      return { query, ...(k && { k }), mode };
    }
    case 'grep': {
      exactFields(args, ['pattern', 'in', 'k', 'contextLines', 'fixedString'], label);
      const pattern = stringArg(args.pattern, `${label}.pattern`, { max: 4096 });
      const inPath = args.in == null ? undefined : safeRelativePath(root, args.in, `${label}.in`);
      const k = integerArg(args.k, `${label}.k`, 1, 20, { optional: true });
      const contextLines = integerArg(args.contextLines, `${label}.contextLines`, 0, 20, { optional: true });
      const fixedString = booleanArg(args.fixedString, `${label}.fixedString`, { optional: true });
      return { pattern, ...(inPath && { in: inPath }), ...(k && { k }), ...(contextLines != null && { contextLines }), ...(fixedString != null && { fixedString }) };
    }
    case 'find': {
      exactFields(args, ['query', 'regex', 'in', 'k'], label);
      const query = stringArg(args.query, `${label}.query`, { max: 2000 });
      const regex = stringArg(args.regex, `${label}.regex`, { max: 4096 });
      const inPath = args.in == null ? undefined : safeRelativePath(root, args.in, `${label}.in`);
      const k = integerArg(args.k, `${label}.k`, 1, 20, { optional: true });
      return { query, regex, ...(inPath && { in: inPath }), ...(k && { k }) };
    }
    case 'read': {
      exactFields(args, ['path', 'startLine', 'endLine'], label);
      const file = safeRelativePath(root, args.path, `${label}.path`);
      const startLine = integerArg(args.startLine, `${label}.startLine`, 1, 1_000_000, { optional: true });
      const endLine = integerArg(args.endLine, `${label}.endLine`, 1, 1_000_000, { optional: true });
      if (endLine != null && startLine == null) invalid(`${label}.endLine requires startLine`);
      if (startLine != null && endLine != null && endLine < startLine) invalid(`${label}.endLine must be >= startLine`);
      return { path: file, ...(startLine && { startLine }), ...(endLine && { endLine }) };
    }
    case 'semantic': {
      exactFields(args, ['path', 'query', 'topK', 'threshold', 'contextLines'], label);
      const file = safeRelativePath(root, args.path, `${label}.path`);
      const query = stringArg(args.query, `${label}.query`, { max: 2000 });
      const topK = integerArg(args.topK, `${label}.topK`, 1, 20, { optional: true });
      const threshold = numberArg(args.threshold, `${label}.threshold`, 0, 1, { optional: true });
      const contextLines = integerArg(args.contextLines, `${label}.contextLines`, 0, 20, { optional: true });
      return { path: file, query, ...(topK && { topK }), ...(threshold != null && { threshold }), ...(contextLines != null && { contextLines }) };
    }
    case 'trace': {
      exactFields(args, ['symbol', 'file', 'hint', 'depth', 'budget'], label);
      const symbol = stringArg(args.symbol, `${label}.symbol`, { max: 256 });
      const file = args.file == null ? undefined : safeRelativePath(root, args.file, `${label}.file`);
      const hint = stringArg(args.hint, `${label}.hint`, { max: 2000, optional: true });
      const depth = integerArg(args.depth, `${label}.depth`, 1, 4, { optional: true });
      const budget = integerArg(args.budget, `${label}.budget`, 1000, 16000, { optional: true });
      return { symbol, ...(file && { file }), ...(hint && { hint }), ...(depth && { depth }), ...(budget && { budget }) };
    }
    default:
      invalid(`unsupported tool: ${tool}`);
  }
}
export function validateSearchBatchRequest(payload, { daemonProjectRoot } = {}) {
  exactFields(payload, ['version', 'projectRoot', 'operations', 'maxChars'], 'request');
  if (payload.version !== SEARCH_BATCH_VERSION) invalid(`version must equal ${SEARCH_BATCH_VERSION}`);
  const projectRoot = canonicalRequestRoot(payload.projectRoot);
  const daemonRoot = canonicalDaemonRoot(daemonProjectRoot);
  if (projectRoot !== daemonRoot) invalid('Daemon project root mismatch', 409);
  if (!Array.isArray(payload.operations) || payload.operations.length < 2 || payload.operations.length > 3) {
    invalid('operations must contain exactly 2 or 3 entries');
  }
  const ids = payload.operations.map((operation, index) => {
    exactFields(operation, ['id', 'tool', 'args'], `operations[${index}]`);
    if (typeof operation.id !== 'string' || !ID_RE.test(operation.id)) invalid(`operations[${index}].id is invalid`);
    if (!TOOLS.has(operation.tool)) invalid(`operations[${index}].tool is invalid`);
    return operation.id;
  });
  if (new Set(ids).size !== ids.length) invalid('operation ids must be unique');
  const operations = payload.operations.map((operation, index) => {
    rejectReferences(operation.args, ids, `operations[${index}].args`);
    return { id: operation.id, tool: operation.tool, args: validateArgs(operation.tool, operation.args, projectRoot) };
  });
  const maxChars = payload.maxChars == null
    ? SEARCH_BATCH_DEFAULT_MAX_CHARS
    : integerArg(payload.maxChars, 'maxChars', SEARCH_BATCH_MIN_MAX_CHARS, SEARCH_BATCH_MAX_MAX_CHARS);
  return { version: SEARCH_BATCH_VERSION, projectRoot, maxChars, operations };
}
export function searchBatchRequiresServerReady(plan) {
  return plan.operations.some(({ tool }) => INDEX_TOOLS.has(tool));
}

const DEFAULT_ADAPTERS = {
  search: (args, { searcher }) => searcher.search(args.query, { k: args.k ?? 10, mode: args.mode, format: 'agent' }),
  grep: (args, { searcher }) => searcher.search(args.pattern, {
    k: args.k ?? 20, mode: 'grep', regex: args.pattern, maxMatches: args.k ?? 20,
    contextLines: args.contextLines ?? 0, fixedString: args.fixedString ?? false,
    ...(args.in && { fileFilter: args.in }), expand: false, rerank: false,
  }),
  find: (args, { searcher }) => searcher.search(args.query, {
    k: args.k ?? 10, mode: 'pattern', regex: args.regex, format: 'agent',
    ...(args.in && { fileFilter: args.in }),
  }),
  read: (args, { projectRoot }) => readFiles([args], { projectRoot, includeMetadata: true }),
  semantic: (args, { projectRoot, searcher }) => readSemantic({
    ...args, projectRoot,
    _lateInteractionIndex: searcher?.lateInteractionIndex || undefined,
  }),
  trace: (args, { projectRoot }) => traceSymbol(args.symbol, {
    projectRoot, filePath: args.file, queryHint: args.hint || '',
    maxDepth: args.depth ?? 3, tokenBudget: args.budget ?? null,
  }),
};

function resultFile(root, value) {
  const raw = value?.file || value?.file_path || value?.filePath || value?.metadata?.file;
  if (typeof raw !== 'string' || !raw) return null;
  let absolute = path.resolve(root, raw);
  if (!withinRoot(root, absolute)) return null;
  if (existsSync(absolute)) {
    try { absolute = realpathSync.native(absolute); }
    catch { return null; }
    if (!withinRoot(root, absolute)) return null;
  }
  return path.relative(root, absolute).split(path.sep).join('/') || '.';
}

function positiveLine(value, fallback = 1) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function makeSpan(root, value, rank, textOverride) {
  const file = resultFile(root, value);
  if (!file) return null;
  const line = positiveLine(value.line, 1);
  const before = Array.isArray(value.contextBefore) ? value.contextBefore.length : 0;
  const after = Array.isArray(value.contextAfter) ? value.contextAfter.length : 0;
  const startLine = positiveLine(value.startLine ?? value.start_line, Math.max(1, line - before));
  const endLine = Math.max(startLine, positiveLine(value.endLine ?? value.end_line, line + after));
  const text = textOverride ?? value.code ?? value.text ?? value.content ?? value.summary ?? value.signature ?? '';
  return {
    file, startLine, endLine, rank,
    ...(value.symbol || value.name || value.metadata?.name ? { symbol: value.symbol || value.name || value.metadata.name } : {}),
    ...(value.symbolType || value.type || value.metadata?.type ? { type: value.symbolType || value.type || value.metadata.type } : {}),
    text: String(text || ''),
  };
}

function normalizeAdapterResult(operation, value, projectRoot) {
  const { id, tool } = operation;
  if (tool === 'read') {
    const file = value?.files?.[0];
    if (!file?.ok) return { id, tool, status: 'error', message: file?.error || 'read failed', spans: [] };
    const span = makeSpan(projectRoot, {
      ...file, file: file.file, startLine: file.range?.startLine || 1,
      endLine: file.range?.endLine || file.totalLines || 1,
    }, 1, file.text);
    return { id, tool, status: 'ok', spans: span ? [span] : [], sourceTruncated: false };
  }
  if (tool === 'semantic') {
    if (value?.ok === false) return { id, tool, status: 'error', message: value.reason || value.error || 'semantic read failed', spans: [] };
    const spans = (value?.spans || []).map((span, index) => makeSpan(projectRoot, { ...span, file: value.file }, index + 1, span.text)).filter(Boolean);
    return { id, tool, status: spans.length ? 'ok' : 'no_match', spans, sourceTruncated: value?.truncated === true };
  }
  if (tool === 'trace') {
    if (!value?.target) return { id, tool, status: 'no_match', message: 'symbol not found', spans: [] };
    const candidates = [
      { ...value.target, file: value.target.filePath },
      ...(value.sections?.callers?.items || []),
      ...(value.sections?.callees?.items || []),
    ];
    const spans = candidates.map((item, index) => makeSpan(projectRoot, item, index + 1, item.code || item.summary)).filter(Boolean);
    const impact = (value.sections?.impact?.paths || []).map((entry) => entry.path).filter(Boolean);
    return { id, tool, status: 'ok', spans, auxText: impact.length ? `impact paths:\n${impact.join('\n')}` : '' };
  }

  const results = Array.isArray(value?.results) ? value.results : [];
  const spans = results.map((result, index) => {
    const grepText = tool === 'grep'
      ? [...(result.contextBefore || []), result.content || result.text || '', ...(result.contextAfter || [])].join('\n')
      : undefined;
    return makeSpan(projectRoot, result, index + 1, grepText);
  }).filter(Boolean);
  return {
    id, tool, status: spans.length ? 'ok' : 'no_match', spans,
    sourceTruncated: value?.truncated === true || value?.budget?.truncated === true,
  };
}

function operationError(operation, error) {
  const message = String(error?.message || error || 'operation failed').replace(/[\r\n]+/g, ' ').slice(0, 1000);
  return { id: operation.id, tool: operation.tool, status: 'error', message, spans: [] };
}

async function executeOne(operation, context, adapters) {
  const adapter = adapters[operation.tool];
  if (typeof adapter !== 'function') throw new Error(`adapter unavailable for ${operation.tool}`);
  const value = await adapter(operation.args, context);
  return normalizeAdapterResult(operation, value, context.projectRoot);
}

export async function runSearchBatchOperations(plan, { searcher, adapters = {} } = {}) {
  const resolvedAdapters = { ...DEFAULT_ADAPTERS, ...adapters };
  const context = { projectRoot: plan.projectRoot, searcher };
  const raw = new Array(plan.operations.length);
  const safeIndexes = plan.operations.map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => CONCURRENT_SAFE_TOOLS.has(operation.tool));
  const safePromise = Promise.allSettled(safeIndexes.map(({ operation }) => executeOne(operation, context, resolvedAdapters)));

  for (let index = 0; index < plan.operations.length; index++) {
    const operation = plan.operations[index];
    if (CONCURRENT_SAFE_TOOLS.has(operation.tool)) continue;
    try { raw[index] = await executeOne(operation, context, resolvedAdapters); }
    catch (err) { raw[index] = operationError(operation, err); }
  }
  const safeSettled = await safePromise;
  safeSettled.forEach((settled, resultIndex) => {
    const { operation, index } = safeIndexes[resultIndex];
    raw[index] = settled.status === 'fulfilled' ? settled.value : operationError(operation, settled.reason);
  });
  return raw;
}

function publicSpan(span) {
  return {
    file: span.file, startLine: span.startLine, endLine: span.endLine, rank: span.rank,
    ...(span.symbol ? { symbol: span.symbol } : {}),
    ...(span.type ? { type: span.type } : {}),
  };
}

function spanCoveredBy(candidate, kept) {
  return candidate.file === kept.file
    && candidate.startLine >= kept.startLine
    && candidate.endLine <= kept.endLine;
}

export function allocateSearchBatchChars(lengths, maxChars) {
  if (!Array.isArray(lengths) || lengths.length < 2 || lengths.length > 3
      || lengths.some((length) => !Number.isSafeInteger(length) || length < 0)) invalid('lengths must contain 2 or 3 non-negative integers');
  integerArg(maxChars, 'maxChars', SEARCH_BATCH_MIN_MAX_CHARS, SEARCH_BATCH_MAX_MAX_CHARS);
  const floorChars = Math.max(1, Math.min(2048, Math.floor(maxChars / lengths.length)));
  const allocations = lengths.map((length) => Math.min(length, floorChars));
  let remaining = maxChars - allocations.reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    const active = lengths.map((length, index) => ({ length, index })).filter(({ length, index }) => length > allocations[index]);
    if (!active.length) break;
    const share = Math.max(1, Math.floor(remaining / active.length));
    for (const { length, index } of active) {
      const added = Math.min(length - allocations[index], share, remaining);
      allocations[index] += added;
      remaining -= added;
      if (remaining === 0) break;
    }
  }
  return { floorChars, allocations };
}

function renderSegments(raw, spans, status) {
  const segments = [{ kind: 'text', text: `[${raw.id}] tool=${raw.tool} status=${status}\n${raw.message ? `${raw.message}\n` : ''}` }];
  for (const span of spans) {
    const symbol = span.symbol ? ` symbol=${span.symbol}` : '';
    const type = span.type ? ` type=${span.type}` : '';
    segments.push({
      kind: 'span', span,
      text: `[span rank=${span.rank} ${span.file}:${span.startLine}-${span.endLine}${symbol}${type}]\n${span.text || '(metadata-only span)'}\n`,
    });
  }
  if (raw.auxText) segments.push({ kind: 'text', text: `${raw.auxText}\n` });
  if (!spans.length && raw.status === 'ok') segments.push({ kind: 'text', text: '(all ranked spans omitted as duplicates)\n' });
  return segments;
}

function clipSegments(segments, cap) {
  let output = '';
  const omitted = [];
  for (const segment of segments) {
    const available = cap - output.length;
    if (available <= 0) {
      if (segment.kind === 'span') omitted.push({ ...publicSpan(segment.span), reason: 'budget' });
      continue;
    }
    if (segment.text.length <= available) {
      output += segment.text;
      continue;
    }
    output += segment.text.slice(0, available);
    if (segment.kind === 'span') omitted.push({ ...publicSpan(segment.span), reason: 'budget', partial: true });
  }
  return { output, omitted };
}

export function packageSearchBatchResults(rawResults, { maxChars = SEARCH_BATCH_DEFAULT_MAX_CHARS } = {}) {
  integerArg(maxChars, 'maxChars', SEARCH_BATCH_MIN_MAX_CHARS, SEARCH_BATCH_MAX_MAX_CHARS);
  if (!Array.isArray(rawResults) || rawResults.length < 2 || rawResults.length > 3) invalid('rawResults must contain 2 or 3 operations');
  const keptByOperation = rawResults.map(() => []);
  const duplicateByOperation = rawResults.map(() => []);
  const kept = [];
  const candidates = rawResults.flatMap((raw, operationIndex) => (raw.spans || []).map((span) => ({ span, operationIndex, operationId: raw.id })))
    .sort((left, right) => left.span.rank - right.span.rank || left.operationIndex - right.operationIndex);
  for (const candidate of candidates) {
    const duplicate = kept.find((entry) => spanCoveredBy(candidate.span, entry.span));
    if (duplicate) {
      duplicateByOperation[candidate.operationIndex].push({
        ...publicSpan(candidate.span), reason: 'duplicate',
        duplicateOf: { operationId: duplicate.operationId, rank: duplicate.span.rank },
      });
    } else {
      kept.push(candidate);
      keptByOperation[candidate.operationIndex].push(candidate.span);
    }
  }

  const buildLayout = (statuses) => {
    const segmentLists = rawResults.map((raw, index) => renderSegments(raw, keptByOperation[index], statuses[index]));
    const lengths = segmentLists.map((segments) => segments.reduce((sum, segment) => sum + segment.text.length, 0));
    const allocation = allocateSearchBatchChars(lengths, maxChars);
    return {
      segmentLists, lengths, ...allocation,
      budgetFlags: lengths.map((length, index) => length > allocation.allocations[index]),
    };
  };
  let statuses = rawResults.map((raw) => raw.status === 'ok' && raw.sourceTruncated === true ? 'truncated' : raw.status);
  let layout;
  for (let pass = 0; pass <= rawResults.length; pass++) {
    layout = buildLayout(statuses);
    const next = rawResults.map((raw, index) => raw.status === 'ok'
      && (raw.sourceTruncated === true || layout.budgetFlags[index]) ? 'truncated' : raw.status);
    if (next.every((status, index) => status === statuses[index])) break;
    statuses = next;
  }
  const budgetTruncated = layout.budgetFlags.some(Boolean);
  const operations = rawResults.map((raw, index) => {
    const clipped = clipSegments(layout.segmentLists[index], layout.allocations[index]);
    const omittedSpans = [...duplicateByOperation[index], ...clipped.omitted];
    const truncatedByBudget = layout.budgetFlags[index];
    const truncated = truncatedByBudget || raw.sourceTruncated === true;
    return {
      id: raw.id,
      tool: raw.tool,
      status: statuses[index],
      truncated,
      output: clipped.output,
      meta: {
        spans: (raw.spans || []).map(publicSpan),
        omittedSpans,
        sourceSpanCount: (raw.spans || []).length,
        emittedSpanCount: keptByOperation[index].length - clipped.omitted.length,
        duplicateSpanCount: duplicateByOperation[index].length,
        budgetOmittedSpanCount: clipped.omitted.length,
        sourceTruncated: raw.sourceTruncated === true,
        floorChars: layout.floorChars,
        allocatedChars: layout.allocations[index],
        fullOutputChars: layout.lengths[index],
        outputChars: clipped.output.length,
      },
    };
  });
  const usedChars = operations.reduce((sum, operation) => sum + operation.output.length, 0);
  return {
    version: SEARCH_BATCH_VERSION,
    operationCount: operations.length,
    sharedBudget: { maxChars, usedChars, truncated: budgetTruncated },
    dedup: {
      strategy: 'post-ranking-contained-span-v1',
      inputSpanCount: candidates.length,
      keptSpanCount: kept.length,
      duplicateSpanCount: candidates.length - kept.length,
    },
    operations,
  };
}

export async function executeSearchBatch(payload, { daemonProjectRoot, searcher, adapters = {} } = {}) {
  const plan = validateSearchBatchRequest(payload, { daemonProjectRoot });
  const rawResults = await runSearchBatchOperations(plan, { searcher, adapters });
  return packageSearchBatchResults(rawResults, { maxChars: plan.maxChars });
}
