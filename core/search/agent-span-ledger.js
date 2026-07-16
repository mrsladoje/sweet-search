/**
 * Agent shown-span receipts.
 *
 * The ledger is deliberately ephemeral: one bounded in-memory instance lives
 * in the per-project daemon. Clients without a trustworthy session id or a
 * reachable daemon receive the original full output (fail open).
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { extractQueryEvidence } from './query-sufficiency.js';

export const SHOWN_SPAN_TRAILER_ENV = 'SWEET_SEARCH_SHOWN_SPAN_TRAILER';
export const EXACT_REREAD_OMISSION_ENV = 'SWEET_SEARCH_EXACT_REREAD_OMISSION';
export const RECEIPT_TTL_CALLS = 30;
export const OMISSION_WINDOW_CALLS = RECEIPT_TTL_CALLS;
export const RECEIPTS_PER_SESSION = 64;
export const MAX_LEDGER_SESSIONS = 32;
export const QUERY_ANCHORS_PER_SESSION = 128;
export const QUERY_SUBTOKENS_PER_SESSION = 64;

const MAX_SESSION_ID_CHARS = 256;
const MAX_RECEIPT_PATH_CHARS = 4096;
const MAX_SPANS_PER_CALL = 20;
const MAX_LINE_DIGESTS_PER_RECEIPT = 256;
const LINE_DIGEST_BYTES = 32;
const SHA256_RE = /^[a-f0-9]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_QUERY_CONTEXT_CHARS = 2000;

export function flagEnabled(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function flagEnabledByDefault(value) {
  return !['0', 'false', 'off', 'no'].includes(String(value ?? '').trim().toLowerCase());
}

export function shownSpanTrailerEnabled(env = process.env) {
  return flagEnabledByDefault(env?.[SHOWN_SPAN_TRAILER_ENV]);
}

export function exactRereadOmissionEnabled(env = process.env) {
  return flagEnabledByDefault(env?.[EXACT_REREAD_OMISSION_ENV]);
}

export function validAgentSessionId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SESSION_ID_CHARS
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function resolveAgentSessionId(explicit, env = process.env) {
  const candidates = [
    explicit,
    env?.SWEET_SEARCH_SESSION_ID,
    env?.CODEX_THREAD_ID,
    env?.CLAUDE_SESSION_ID,
  ];
  return candidates.find(validAgentSessionId) || null;
}

function sourceLines(text) {
  if (typeof text !== 'string') return null;
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

/** Hash source-line evidence while ignoring only the formatter-added final EOL. */
export function hashShownText(text) {
  const lines = sourceLines(text);
  if (!lines) return null;
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

/** SHA-256-per-line evidence for byte-proving a coordinate-contained reread. */
export function hashShownLines(text) {
  const lines = sourceLines(text);
  if (!lines || lines.length > MAX_LINE_DIGESTS_PER_RECEIPT) return null;
  const digests = lines.map((line) => createHash('sha256').update(line, 'utf8').digest());
  return Buffer.concat(digests).toString('base64');
}

export function normalizeSpanFile(file, projectRoot = process.cwd()) {
  if (typeof file !== 'string' || file.length === 0) return null;
  const root = path.resolve(projectRoot || process.cwd());
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute).replace(/\\/g, '/');
  if (relative && !relative.startsWith('../') && !path.isAbsolute(relative)) return relative;
  if (relative === '') return '.';
  return absolute.replace(/\\/g, '/');
}

function completeAgentResultSpan(result, projectRoot) {
  if (result?.presentation !== 'full' || typeof result.code !== 'string' || !result.code) return null;
  if (result.expansionKind === 'sandwich' || result.sandwich) return null;
  const startLine = Number(result.startLine);
  const endLine = Number(result.endLine);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) return null;

  // Full packs are sometimes budget-truncated. Only a body with exactly the
  // advertised source-line count is eligible for a receipt.
  const lineCount = result.code.replace(/\r?\n$/, '').split('\n').length;
  if (lineCount !== (endLine - startLine + 1)) return null;

  const file = normalizeSpanFile(result.file, projectRoot);
  const hash = hashShownText(result.code);
  const lineHashes = hashShownLines(result.code);
  const receipt = file && hash
    ? { file, startLine, endLine, hash, ...(lineHashes ? { lineHashes } : {}) }
    : null;
  return validSpanReceipt(receipt) ? receipt : null;
}

function completeAgentContinuationSpan(result, projectRoot) {
  const continuation = result?.continuation;
  if (continuation?.kind !== 'symbol' || typeof continuation.code !== 'string' || !continuation.code) return null;
  return completeAgentResultSpan({
    file: continuation.file,
    startLine: continuation.startLine,
    endLine: continuation.endLine,
    presentation: 'full',
    code: continuation.code,
  }, projectRoot);
}

export function collectAgentShownSpans(results, { projectRoot } = {}) {
  if (!Array.isArray(results)) return [];
  return results
    .flatMap((result) => [
      completeAgentResultSpan(result, projectRoot),
      completeAgentContinuationSpan(result, projectRoot),
    ])
    .filter(Boolean)
    .slice(0, MAX_SPANS_PER_CALL);
}

export function collectReadShownSpans(results, { projectRoot } = {}) {
  const files = Array.isArray(results?.files) ? results.files : [];
  return files.flatMap((result, resultIndex) => {
    if (!result?.ok || typeof result.text !== 'string') return [];
    const file = normalizeSpanFile(result.absolutePath || result.file, projectRoot);
    const startLine = result.range?.startLine ?? 1;
    const endLine = result.range?.endLine ?? result.totalLines;
    if (!Number.isInteger(startLine)
        || !Number.isInteger(endLine)
        || startLine < 1
        || endLine < startLine) return [];
    const lines = sourceLines(result.text);
    if (!lines || lines.length !== endLine - startLine + 1) return [];
    const hash = hashShownText(result.text);
    const lineHashes = hashShownLines(result.text);
    if (!file || !hash) return [];
    const receipt = {
      file,
      startLine,
      endLine,
      hash,
      resultIndex,
      ...(lineHashes ? { lineHashes } : {}),
    };
    return validSpanReceipt(receipt) ? [receipt] : [];
  }).slice(0, MAX_SPANS_PER_CALL);
}

export function collectSemanticShownSpans(result, { projectRoot } = {}) {
  if (!result?.ok || !Array.isArray(result.spans)) return [];
  const file = normalizeSpanFile(result.file, projectRoot);
  if (!file) return [];
  return result.spans.flatMap((span) => {
    if (span?.truncated === true
        || typeof span?.text !== 'string'
        || !Number.isInteger(span.startLine)
        || !Number.isInteger(span.endLine)
        || span.startLine < 1
        || span.endLine < span.startLine) return [];
    const lines = sourceLines(span.text);
    if (!lines || lines.length !== span.endLine - span.startLine + 1) return [];
    const hash = hashShownText(span?.text);
    const lineHashes = hashShownLines(span?.text);
    if (!hash) return [];
    const receipt = {
      file,
      startLine: span.startLine,
      endLine: span.endLine,
      hash,
      ...(lineHashes ? { lineHashes } : {}),
    };
    return validSpanReceipt(receipt) ? [receipt] : [];
  }).slice(0, MAX_SPANS_PER_CALL);
}

export function renderShownFullTrailer(spans) {
  if (!Array.isArray(spans) || spans.length === 0) return '';
  const grouped = new Map();
  for (const span of spans) {
    if (!span?.file || !Number.isInteger(span.startLine) || !Number.isInteger(span.endLine)) continue;
    if (!grouped.has(span.file)) grouped.set(span.file, []);
    grouped.get(span.file).push(`${span.startLine}-${span.endLine}`);
  }
  if (grouped.size === 0) return '';
  return `shown-full: ${[...grouped].map(([file, ranges]) => `${file}:${ranges.join(',')}`).join('; ')}`;
}

export function renderReadOmission(result, { surface = 'cli' } = {}) {
  const omitted = result?.omitted;
  if (!omitted) return '';
  const shownAt = `${omitted.file}:${omitted.startLine}-${omitted.endLine}`;
  const age = omitted.callsAgo;
  const plural = age === 1 ? '' : 's';
  let override;
  if (surface === 'mcp') {
    override = 'force=true';
  } else {
    override = '--force';
  }
  return `[unchanged reread omitted; these exact source lines were already shown ${age} sweet-search call${plural} ago within ${shownAt}. Continue from that copy. ONLY if the prior copy is unavailable, repeat this same path/range with ${override}; this one-use override applies only to this omission.]`;
}

export function applyReadOmissionDecisions(results, decisions) {
  if (!Array.isArray(results?.files) || !Array.isArray(decisions)) return results;
  for (let i = 0; i < results.files.length; i++) {
    const decision = decisions[i];
    if (!decision?.omit) continue;
    results.files[i].text = '';
    results.files[i].omitted = {
      file: decision.previous.file,
      startLine: decision.previous.startLine,
      endLine: decision.previous.endLine,
      callsAgo: decision.callsAgo,
    };
  }
  return results;
}

export function validSpanReceipt(span) {
  if (!(span
    && typeof span.file === 'string'
    && span.file.length > 0
    && span.file.length <= MAX_RECEIPT_PATH_CHARS
    && Number.isInteger(span.startLine)
    && Number.isInteger(span.endLine)
    && span.startLine >= 1
    && span.endLine >= span.startLine
    && SHA256_RE.test(span.hash))) return false;
  if (span.lineHashes == null) return true;
  if (typeof span.lineHashes !== 'string' || !BASE64_RE.test(span.lineHashes)) return false;
  const bytes = Buffer.from(span.lineHashes, 'base64');
  return bytes.length > 0
    && bytes.length <= MAX_LINE_DIGESTS_PER_RECEIPT * LINE_DIGEST_BYTES
    && bytes.length % LINE_DIGEST_BYTES === 0
    && bytes.length / LINE_DIGEST_BYTES === span.endLine - span.startLine + 1;
}

function receiptKey(span) {
  return `${span.file}\u0000${span.startLine}\u0000${span.endLine}\u0000${span.hash}`;
}

function storedReceipt(span, call) {
  return {
    file: span.file,
    startLine: span.startLine,
    endLine: span.endLine,
    hash: span.hash,
    lineDigests: span.lineHashes ? Buffer.from(span.lineHashes, 'base64') : null,
    shownAtCall: call,
  };
}

function receiptProvesSpan(receipt, span) {
  if (receipt.file !== span.file) return false;
  if (receipt.startLine === span.startLine
      && receipt.endLine === span.endLine
      && receipt.hash === span.hash) return true;
  if (!receipt.lineDigests || !span.lineHashes) return false;
  if (receipt.startLine > span.startLine || receipt.endLine < span.endLine) return false;

  const requested = Buffer.from(span.lineHashes, 'base64');
  const offset = (span.startLine - receipt.startLine) * LINE_DIGEST_BYTES;
  const end = offset + requested.length;
  return end <= receipt.lineDigests.length
    && receipt.lineDigests.subarray(offset, end).equals(requested);
}

function publicReceipt(receipt) {
  return {
    file: receipt.file,
    startLine: receipt.startLine,
    endLine: receipt.endLine,
  };
}

function emptyQueryContext() {
  return { anchors: new Map(), subtokens: [] };
}

export class AgentSpanLedger {
  constructor({
    ttlCalls = RECEIPT_TTL_CALLS,
    omissionWindowCalls = OMISSION_WINDOW_CALLS,
    receiptsPerSession = RECEIPTS_PER_SESSION,
    maxSessions = MAX_LEDGER_SESSIONS,
  } = {}) {
    this.ttlCalls = ttlCalls;
    this.omissionWindowCalls = Math.min(omissionWindowCalls, ttlCalls);
    this.receiptsPerSession = receiptsPerSession;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
  }

  _touchSession(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        call: 0,
        receipts: new Map(),
        overrides: new Map(),
        queryContext: emptyQueryContext(),
      };
    } else {
      if (!session.overrides) session.overrides = new Map();
      if (!session.queryContext) session.queryContext = emptyQueryContext();
      this.sessions.delete(sessionId);
    }
    this.sessions.set(sessionId, session);
    while (this.sessions.size > this.maxSessions) {
      this.sessions.delete(this.sessions.keys().next().value);
    }
    return session;
  }

  beginCall(sessionId) {
    if (!validAgentSessionId(sessionId)) return null;
    const session = this._touchSession(sessionId);
    session.call += 1;
    for (const [key, receipt] of session.receipts) {
      if (session.call - receipt.shownAtCall > this.ttlCalls) session.receipts.delete(key);
    }
    for (const [key, override] of session.overrides) {
      if (session.call - override.omittedAtCall > this.omissionWindowCalls) session.overrides.delete(key);
    }
    return session.call;
  }

  rememberQueryAtCall(sessionId, call, query, regex = '') {
    const session = this.sessions.get(sessionId);
    if (!session || !Number.isInteger(call) || call < 1 || call > session.call) return false;
    const boundedQuery = typeof query === 'string' && query.length <= MAX_QUERY_CONTEXT_CHARS
      ? query : '';
    const boundedRegex = typeof regex === 'string' && regex.length <= MAX_QUERY_CONTEXT_CHARS
      ? regex : '';
    if (!boundedQuery && !boundedRegex) return false;

    const evidence = extractQueryEvidence(boundedQuery, boundedRegex);
    for (const anchor of evidence.anchors) {
      session.queryContext.anchors.delete(anchor);
      session.queryContext.anchors.set(anchor, call);
      while (session.queryContext.anchors.size > QUERY_ANCHORS_PER_SESSION) {
        session.queryContext.anchors.delete(session.queryContext.anchors.keys().next().value);
      }
    }
    session.queryContext.subtokens = [...evidence.subtokens].slice(0, QUERY_SUBTOKENS_PER_SESSION);
    return true;
  }

  queryEvidence(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session?.queryContext) return null;
    for (const [anchor, rememberedAtCall] of session.queryContext.anchors) {
      if (session.call - rememberedAtCall > this.ttlCalls) {
        session.queryContext.anchors.delete(anchor);
      }
    }
    const anchors = [...session.queryContext.anchors.keys()];
    const subtokens = [...session.queryContext.subtokens];
    return anchors.length > 0 || subtokens.length > 0 ? { anchors, subtokens } : null;
  }

  observeAtCall(sessionId, call, spans) {
    const session = this.sessions.get(sessionId);
    if (!session || !Number.isInteger(call) || call < 1 || call > session.call) return false;
    if (session.call - call > this.ttlCalls) return false;
    for (const span of (Array.isArray(spans) ? spans : []).filter(validSpanReceipt).slice(0, MAX_SPANS_PER_CALL)) {
      const key = receiptKey(span);
      const existing = session.receipts.get(key);
      if (existing && existing.shownAtCall > call) continue;
      session.overrides.delete(key);
      session.receipts.delete(key);
      session.receipts.set(key, storedReceipt(span, call));
      while (session.receipts.size > this.receiptsPerSession) {
        session.receipts.delete(session.receipts.keys().next().value);
      }
    }
    return true;
  }

  decideAndObserveAtCall(sessionId, call, spans, { force = false } = {}) {
    const session = this.sessions.get(sessionId);
    const validSpans = (Array.isArray(spans) ? spans : []).slice(0, MAX_SPANS_PER_CALL);
    if (!session || !Number.isInteger(call) || call < 1 || call > session.call) {
      return validSpans.map(() => ({ omit: false }));
    }

    const decisions = validSpans.map((span) => {
      if (!validSpanReceipt(span)) return { omit: false };
      const key = receiptKey(span);
      const pendingOverride = session.overrides.get(key);
      if (force && pendingOverride && call - pendingOverride.omittedAtCall <= this.omissionWindowCalls) {
        session.overrides.delete(key);
        return { omit: false };
      }
      let previous = null;
      for (const candidate of [...session.receipts.values()].reverse()) {
        const age = call - candidate.shownAtCall;
        if (age <= 0 || age > this.omissionWindowCalls) continue;
        if (receiptProvesSpan(candidate, span)) {
          previous = candidate;
          break;
        }
      }
      const callsAgo = previous ? call - previous.shownAtCall : null;
      if (!(previous && callsAgo > 0 && callsAgo <= this.omissionWindowCalls)) return { omit: false };
      session.overrides.set(key, { omittedAtCall: call });
      while (session.overrides.size > this.receiptsPerSession) {
        session.overrides.delete(session.overrides.keys().next().value);
      }
      return { omit: true, callsAgo, previous: publicReceipt(previous) };
    });
    this.observeAtCall(sessionId, call, validSpans.filter((_, index) => !decisions[index]?.omit));
    return decisions;
  }

  reset(sessionId) {
    if (!validAgentSessionId(sessionId)) return false;
    return this.sessions.delete(sessionId);
  }

  clear() {
    this.sessions.clear();
  }

  stats() {
    let receipts = 0;
    for (const session of this.sessions.values()) receipts += session.receipts.size;
    return { sessions: this.sessions.size, receipts };
  }
}
