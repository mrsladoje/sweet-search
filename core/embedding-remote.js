/**
 * Embedding Remote - Circuit breaker, compression, HTTP pooling, and API clients.
 * Extracted from embedding-service.js for file size compliance (<500 lines).
 */

import { gzipSync, gunzipSync, brotliDecompressSync } from 'zlib';
import { EMBEDDING_PROVIDERS } from './config.js';

// =============================================================================
// CIRCUIT BREAKER FOR API STABILITY
// =============================================================================

export const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED',  // CLOSED (normal), OPEN (blocking), HALF_OPEN (testing)

  FAILURE_THRESHOLD: 5,
  COOLDOWN_MS: 60000,
  SUCCESS_TO_CLOSE: 2,
  successCount: 0,

  /** Check if request is allowed through the circuit */
  canRequest() {
    const now = Date.now();
    if (this.state === 'CLOSED') return { allowed: true };

    if (this.state === 'OPEN') {
      if (now - this.lastFailure > this.COOLDOWN_MS) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log('[embedding-service] Circuit breaker entering HALF_OPEN state');
        return { allowed: true };
      }
      return { allowed: false, reason: `Circuit OPEN - retry in ${Math.ceil((this.COOLDOWN_MS - (now - this.lastFailure)) / 1000)}s` };
    }

    return { allowed: true };
  },

  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.SUCCESS_TO_CLOSE) {
        this.state = 'CLOSED';
        this.failures = 0;
        console.log('[embedding-service] Circuit breaker CLOSED - API recovered');
      }
    } else {
      this.failures = 0;
    }
  },

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      console.log('[embedding-service] Circuit breaker re-OPENED - recovery failed');
    } else if (this.failures >= this.FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      console.error(`[embedding-service] Circuit breaker OPENED after ${this.failures} consecutive failures`);
    }
  },

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure,
      cooldownRemaining: this.state === 'OPEN'
        ? Math.max(0, this.COOLDOWN_MS - (Date.now() - this.lastFailure))
        : 0
    };
  }
};

// =============================================================================
// V2b: REQUEST/RESPONSE COMPRESSION
// =============================================================================

export const _providerCompressionSupport = new Map();

export function providerSupportsRequestCompression(provider) {
  return _providerCompressionSupport.get(provider) !== false;
}

export function markProviderNoCompression(provider) {
  _providerCompressionSupport.set(provider, false);
}

/**
 * Quick check if data looks like JSON (starts with '{' or '[' after whitespace).
 */
export function looksLikeJson(data) {
  const u8 = new Uint8Array(
    data instanceof Buffer
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data
  );
  if (u8.length === 0) return false;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    if (c === 0x20 || c === 0x0A || c === 0x0D || c === 0x09) continue;
    return c === 0x7B || c === 0x5B; // '{' or '['
  }
  return false;
}

/**
 * Parse a potentially compressed API response.
 */
export async function parseCompressedResponse({ body, statusCode, headers: resHeaders }) {
  if (statusCode !== 200) {
    const error = await body.text();
    throw new Error(`API error: ${statusCode} - ${error}`);
  }

  const encoding = resHeaders?.['content-encoding'];
  let responseData = await body.arrayBuffer();

  if (encoding && !looksLikeJson(responseData)) {
    try {
      if (encoding === 'gzip') {
        responseData = gunzipSync(Buffer.from(responseData));
      } else if (encoding === 'br') {
        responseData = brotliDecompressSync(Buffer.from(responseData));
      }
    } catch {
      // Decompression failed - data was likely already decompressed by undici
    }
  }

  const text = typeof responseData === 'string'
    ? responseData
    : Buffer.isBuffer(responseData)
      ? responseData.toString('utf8')
      : new TextDecoder().decode(responseData);
  return JSON.parse(text);
}

/**
 * V2b: Make an API request with optional gzip request compression.
 */
export async function compressedApiRequest(pool, provider, apiPath, requestBody, apiKey) {
  const jsonBody = JSON.stringify(requestBody);

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip, br',
  };

  let body = jsonBody;
  if (providerSupportsRequestCompression(provider)) {
    try {
      const compressed = gzipSync(Buffer.from(jsonBody));
      if (compressed.length < jsonBody.length * 0.9) {
        headers['Content-Encoding'] = 'gzip';
        body = compressed;
      }
    } catch {
      // gzip failed - send uncompressed
    }
  }

  const response = await pool.request({
    path: apiPath,
    method: 'POST',
    headers,
    body,
  });

  if ((response.statusCode === 415 || response.statusCode === 400) && headers['Content-Encoding']) {
    try { await response.body.text(); } catch { /* best-effort drain */ }

    markProviderNoCompression(provider);
    delete headers['Content-Encoding'];
    const retryResponse = await pool.request({
      path: apiPath,
      method: 'POST',
      headers,
      body: jsonBody,
    });
    return parseCompressedResponse(retryResponse);
  }

  return parseCompressedResponse(response);
}

// =============================================================================
// RATE LIMITER
// =============================================================================

export class RateLimiter {
  constructor(requestsPerMinute, tokensPerMinute = Infinity) {
    this.requestsPerMinute = requestsPerMinute;
    this.tokensPerMinute = tokensPerMinute;
    this.requestTimestamps = [];
    this.tokenTimestamps = [];
  }

  async waitForSlot(tokenCount = 0) {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    this.tokenTimestamps = this.tokenTimestamps.filter(t => t.time > oneMinuteAgo);

    if (this.requestTimestamps.length >= this.requestsPerMinute) {
      const oldestRequest = this.requestTimestamps[0];
      const waitTime = oldestRequest + 60000 - now;
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    const currentTokens = this.tokenTimestamps.reduce((sum, t) => sum + t.tokens, 0);
    if (currentTokens + tokenCount > this.tokensPerMinute) {
      const waitTime = 60000 - (now - this.tokenTimestamps[0]?.time || 0);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.requestTimestamps.push(Date.now());
    if (tokenCount > 0) {
      this.tokenTimestamps.push({ time: Date.now(), tokens: tokenCount });
    }
  }
}

// =============================================================================
// TIME-WINDOW RATE LIMITER (V2: concurrent-safe for Promise.all)
// =============================================================================

export class TimeWindowRateLimiter {
  constructor(maxRPM, options = {}) {
    this.windowMs = 60_000;
    this.maxInWindow = maxRPM;
    this.timestamps = [];

    this.secondWindowMs = 1_000;
    this.maxPerSecond = options.maxPerSecond ?? (Math.floor(maxRPM / 60) + 1);
    this.secondTimestamps = [];

    this._mutex = Promise.resolve();
  }

  async acquire() {
    const prev = this._mutex;
    let releaseMutex;
    this._mutex = new Promise(resolve => { releaseMutex = resolve; });
    await prev;

    try {
      while (this._atMinuteCapacity() || this._atSecondCapacity()) {
        const waitMs = this._nextWaitMs();
        await new Promise(r => setTimeout(r, waitMs));
        this._pruneWindows();
      }

      const now = Date.now();
      this.timestamps.push(now);
      this.secondTimestamps.push(now);
    } finally {
      releaseMutex();
    }
  }

  _atMinuteCapacity() {
    this._pruneWindows();
    return this.timestamps.length >= this.maxInWindow;
  }

  _atSecondCapacity() {
    this._pruneWindows();
    return this.secondTimestamps.length >= this.maxPerSecond;
  }

  _nextWaitMs() {
    const now = Date.now();
    const minuteWait = this.timestamps.length > 0
      ? Math.max(1, this.windowMs - (now - this.timestamps[0]))
      : 1;
    const secondWait = this.secondTimestamps.length > 0
      ? Math.max(1, this.secondWindowMs - (now - this.secondTimestamps[0]))
      : 1;
    return Math.min(minuteWait, secondWait);
  }

  _pruneWindows() {
    const now = Date.now();
    const minuteCutoff = now - this.windowMs;
    const secondCutoff = now - this.secondWindowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < minuteCutoff) {
      this.timestamps.shift();
    }
    while (this.secondTimestamps.length > 0 && this.secondTimestamps[0] < secondCutoff) {
      this.secondTimestamps.shift();
    }
  }
}

// =============================================================================
// REMOTE API CLIENTS (with HTTP/2 and connection pooling)
// =============================================================================

let undiciPool = null;

export async function getUndiciPool() {
  if (undiciPool) return undiciPool;

  try {
    const { Pool } = await import('undici');
    undiciPool = new Pool('https://api.voyageai.com', {
      connections: 10,
      pipelining: 1,
      keepAliveTimeout: 30000,
      keepAliveMaxTimeout: 60000,
    });
    return undiciPool;
  } catch {
    return null;
  }
}

let httpsAgent = null;

export async function getHttpsAgent() {
  if (httpsAgent) return httpsAgent;

  try {
    const https = await import('https');
    httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 10,
      maxFreeSockets: 5,
      timeout: 30000,
      freeSocketTimeout: 15000,
    });
    return httpsAgent;
  } catch {
    return undefined;
  }
}

export async function callVoyageAPI(texts, config, options = {}) {
  const {
    inputType = 'document',
    outputDtype = 'float',
    outputDimension = config.dimensions.full,
  } = options;

  const requestBody = {
    model: config.model,
    input: texts,
    input_type: inputType,
    output_dimension: outputDimension,
  };

  if (outputDtype !== 'float') {
    requestBody.output_dtype = outputDtype;
  }

  const pool = await getUndiciPool();
  if (pool) {
    try {
      const data = await compressedApiRequest(pool, 'voyage', '/v1/embeddings', requestBody, config.apiKey);
      return data.data.map(d => d.embedding);
    } catch (err) {
      if (!err.message.includes('API error')) {
        console.warn('[HTTP/2] Falling back to fetch:', err.message);
      } else {
        throw err;
      }
    }
  }

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'gzip, br',
    },
    body: JSON.stringify(requestBody),
  };

  const response = await fetch(config.endpoint, fetchOptions);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

export async function callMistralAPI(texts, config, options = {}) {
  const { outputDimension } = options;

  const requestBody = {
    model: config.model,
    input: texts,
  };

  if (outputDimension) {
    requestBody.dimensions = outputDimension;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, br',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

export async function callJinaAPI(texts, config, options = {}) {
  const {
    task = 'retrieval.passage',
    outputDimension,
  } = options;

  const requestBody = {
    model: config.model,
    input: texts,
    task,
  };

  if (outputDimension) {
    requestBody.dimensions = outputDimension;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, br',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jina API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

// =============================================================================
// RATE LIMITER SINGLETONS
// =============================================================================

export const rateLimiters = {
  voyage: new RateLimiter(
    EMBEDDING_PROVIDERS.voyage.rateLimit?.requestsPerMinute || 300,
    EMBEDDING_PROVIDERS.voyage.rateLimit?.tokensPerMinute || 1000000
  ),
  mistral: new RateLimiter(EMBEDDING_PROVIDERS.mistral.rateLimit?.requestsPerMinute || 100),
  jina: new RateLimiter(EMBEDDING_PROVIDERS.jina.rateLimit?.requestsPerMinute || 500),
};

export const timeWindowLimiters = {
  voyage: new TimeWindowRateLimiter(
    EMBEDDING_PROVIDERS.voyage.rateLimit?.requestsPerMinute || 300
  ),
  mistral: new TimeWindowRateLimiter(
    EMBEDDING_PROVIDERS.mistral.rateLimit?.requestsPerMinute || 100
  ),
  jina: new TimeWindowRateLimiter(
    EMBEDDING_PROVIDERS.jina.rateLimit?.requestsPerMinute || 500
  ),
};
