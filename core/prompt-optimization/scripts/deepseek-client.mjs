/**
 * Thin async HTTP client for DeepSeek's OpenAI-compatible Chat Completions
 * endpoint, scoped to the PHASE6_REDO variant-authoring use case.
 *
 * Spec: docs/PHASE6_REDO.md §5.5.4. Stateless calls only — per user memory
 * `feedback_direct_api_for_stateless_calls`, this is the fast path for
 * batch generation (50-100× faster than routing through a Claude Code
 * harness). DeepSeek's non-reasoning `deepseek-chat` model is the V4-Flash
 * surface; the reasoning variant (`deepseek-reasoner`) is explicitly NOT
 * used here — per user memory `project_deepseek_max_tokens_reasoning` the
 * reasoning endpoint silently returns empty text when max_tokens < 4096
 * and templated variant authoring does not benefit from chain-of-thought.
 *
 * Usage:
 *   import { createDeepSeekClient } from './deepseek-client.mjs';
 *   const client = createDeepSeekClient({ apiKey, concurrency: 20 });
 *   const { content, attempts, rawResponse } =
 *     await client.chat({ systemPrompt, userPrompt });
 *
 * Errors:
 *   - 429 → exponential backoff 1→2→4→8→16s cap, retried indefinitely
 *           until success (per §5.5.4: "no fail-fast")
 *   - 5xx → 1 retry after 2s, then thrown
 *   - 4xx (non-429) → thrown immediately with status + body
 *   - network / abort → 1 retry, then thrown
 *
 * No global state — multiple clients can coexist with independent
 * concurrency semaphores (useful if you ever want to mix model names).
 */

import pLimit from 'p-limit';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
// PHASE6_REDO.md §5.5.4 originally documented `deepseek-chat` as the
// non-reasoning V4-Flash model id. As of the 2026-05-13 preflight, DeepSeek
// renamed the model to `deepseek-v4-flash`; `deepseek-v4-pro` is the
// reasoning variant (per user memory `project_deepseek_max_tokens_reasoning`,
// DO NOT use for stateless probe authoring — non-reasoning is what we want).
const DEFAULT_MODEL = 'deepseek-v4-flash';
const BACKOFF_LADDER_MS = [1000, 2000, 4000, 8000, 16000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the request body — kept as a pure function so it's easy to unit-test
 * against the §5.5.4 surface.
 */
export function buildChatCompletionBody({
  model = DEFAULT_MODEL,
  systemPrompt,
  userPrompt,
  temperature = 0.3,
  seed = 42,
  // ≥ 4096 per user memory `project_deepseek_max_tokens_reasoning`:
  // `deepseek-v4-flash` silently emits reasoning_content that consumes the
  // budget; max_tokens < 4096 produces empty `content`. Callers can
  // override but should not go lower than this default.
  maxTokens = 4096,
  responseFormat = { type: 'json_object' },
}) {
  if (!userPrompt) throw new Error('deepseek-client: userPrompt is required');
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  return {
    model,
    messages,
    temperature,
    seed,
    max_tokens: maxTokens,
    response_format: responseFormat,
  };
}

/**
 * Decide retry/backoff disposition from an HTTP response. Pure — exported
 * so it can be unit-tested without a live server.
 */
export function classifyResponse(status) {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 429) return { kind: 'retry-rate-limit' };
  if (status >= 500 && status < 600) return { kind: 'retry-server' };
  return { kind: 'fatal' };
}

/**
 * Create a client with a bounded concurrency semaphore. `fetchFn` is
 * injectable for tests; defaults to global fetch().
 */
export function createDeepSeekClient({
  apiKey = process.env.DEEPSEEK_API_KEY,
  baseUrl = DEFAULT_BASE_URL,
  model = DEFAULT_MODEL,
  concurrency = 20,
  fetchFn = globalThis.fetch,
  sleepFn = sleep,
  maxRateLimitRetries = Infinity,
  maxServerRetries = 1,
} = {}) {
  if (!apiKey) {
    throw new Error('deepseek-client: DEEPSEEK_API_KEY missing (pass `apiKey` or set env)');
  }
  if (typeof fetchFn !== 'function') {
    throw new Error('deepseek-client: fetch is not available — Node 18+ or pass `fetchFn`');
  }
  const limit = pLimit(concurrency);

  async function doFetch(body) {
    const resp = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return resp;
  }

  async function chat({
    systemPrompt,
    userPrompt,
    temperature,
    seed,
    maxTokens,
    responseFormat,
  } = {}) {
    return limit(async () => {
      const body = buildChatCompletionBody({
        model,
        systemPrompt,
        userPrompt,
        temperature,
        seed,
        maxTokens,
        responseFormat,
      });
      let attempts = 0;
      let rateLimitTries = 0;
      let serverTries = 0;
      while (true) {
        attempts++;
        let resp;
        try {
          resp = await doFetch(body);
        } catch (err) {
          // Network error / abort. Treat as server-side retry, one shot.
          if (serverTries < maxServerRetries) {
            serverTries++;
            await sleepFn(2000);
            continue;
          }
          throw err;
        }
        const verdict = classifyResponse(resp.status);
        if (verdict.kind === 'ok') {
          const payload = await resp.json();
          const content = payload?.choices?.[0]?.message?.content ?? null;
          return { content, attempts, rawResponse: payload };
        }
        if (verdict.kind === 'retry-rate-limit') {
          if (rateLimitTries >= maxRateLimitRetries) {
            throw new Error(`deepseek-client: rate-limit cap exhausted after ${rateLimitTries} retries`);
          }
          const ladderIdx = Math.min(rateLimitTries, BACKOFF_LADDER_MS.length - 1);
          const delay = BACKOFF_LADDER_MS[ladderIdx];
          rateLimitTries++;
          // Drain the body so the connection can return to the pool cleanly.
          try { await resp.text(); } catch { /* ignore */ }
          await sleepFn(delay);
          continue;
        }
        if (verdict.kind === 'retry-server') {
          if (serverTries >= maxServerRetries) {
            const text = await resp.text().catch(() => '<no body>');
            throw new Error(`deepseek-client: ${resp.status} after ${serverTries} retries — ${text.slice(0, 200)}`);
          }
          serverTries++;
          try { await resp.text(); } catch { /* ignore */ }
          await sleepFn(2000);
          continue;
        }
        // Fatal 4xx — non-retryable. Include the body for diagnostics.
        const text = await resp.text().catch(() => '<no body>');
        throw new Error(`deepseek-client: ${resp.status} (fatal) — ${text.slice(0, 400)}`);
      }
    });
  }

  /**
   * Preflight per §5.5.4: confirm `deepseek-chat` (or whatever model was
   * configured) is in the account's accessible model list. Returns the list
   * of model ids on success; throws on missing-model so the caller can stop
   * before burning 12-20 min of wall time on a renamed model.
   */
  async function preflightModels({ required = [model] } = {}) {
    const resp = await fetchFn(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '<no body>');
      throw new Error(`deepseek-client: preflight /models returned ${resp.status} — ${text.slice(0, 200)}`);
    }
    const payload = await resp.json();
    const ids = (payload?.data ?? []).map((d) => d.id);
    const missing = required.filter((r) => !ids.includes(r));
    if (missing.length > 0) {
      throw new Error(
        `deepseek-client: required model(s) [${missing.join(', ')}] not in /models list. ` +
          `Update the model field before any sweep. Got: ${ids.join(', ')}`,
      );
    }
    return { models: ids };
  }

  return { chat, preflightModels, concurrency, model, baseUrl };
}

export { DEFAULT_MODEL, DEFAULT_BASE_URL, BACKOFF_LADDER_MS };
