/** Unix-socket adapter for the daemon-owned agent shown-span ledger. */

import http from 'node:http';
import { projectSocketPath } from './server-identity.js';
import { resolveAgentSessionId } from './agent-span-ledger.js';

const MAX_BODY_BYTES = 64 * 1024;

export function buildAgentSpanRequestPayload({
  operation,
  spans = [],
  force = false,
  sessionId,
  query,
  regex,
} = {}) {
  const resolvedSessionId = resolveAgentSessionId(sessionId);
  if (!resolvedSessionId) return null;
  const boundedQuery = typeof query === 'string' && query.length <= 2000 ? query : undefined;
  const boundedRegex = typeof regex === 'string' && regex.length <= 2000 ? regex : undefined;
  return {
    operation,
    sessionId: resolvedSessionId,
    force: force === true,
    spans: Array.isArray(spans) ? spans.slice(0, 20).map((span) => ({ ...span })) : [],
    ...(boundedQuery ? { query: boundedQuery } : {}),
    ...(boundedRegex ? { regex: boundedRegex } : {}),
  };
}

function serializeBoundedPayload(payload) {
  let body = JSON.stringify(payload);
  if (Buffer.byteLength(body) <= MAX_BODY_BYTES) return body;

  // Preserve containment evidence for as many receipts as possible. Remove
  // the largest per-line digest packs first until the local request fits.
  const candidates = payload.spans
    .map((span, index) => ({
      index,
      bytes: typeof span?.lineHashes === 'string' ? Buffer.byteLength(span.lineHashes) : 0,
    }))
    .filter(({ bytes }) => bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.index - b.index);
  for (const { index } of candidates) {
    delete payload.spans[index].lineHashes;
    body = JSON.stringify(payload);
    if (Buffer.byteLength(body) <= MAX_BODY_BYTES) return body;
  }
  return Buffer.byteLength(body) <= MAX_BODY_BYTES ? body : null;
}

export async function sendAgentSpanOperation(input, { timeoutMs = 500 } = {}) {
  const payload = buildAgentSpanRequestPayload(input);
  if (!payload) return null;
  const body = serializeBoundedPayload(payload);
  if (!body) return null;

  return new Promise((resolve) => {
    const req = http.request({
      socketPath: projectSocketPath(),
      path: '/agent-spans',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let response = '';
      let responseBytes = 0;
      res.on('data', (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes <= MAX_BODY_BYTES) response += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200 || responseBytes > MAX_BODY_BYTES) {
          resolve(null);
          return;
        }
        try { resolve(JSON.parse(response)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.end(body);
  });
}
