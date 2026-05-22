// Gemini Embedding 2 client for Phase 7 OOD / language-transfer evaluation.
//
// Uses the Gemini REST API directly (no CLI subprocess) for lower latency
// and cleaner error semantics. Supports both single embedContent and batched
// batchEmbedContents requests with automatic chunking. Includes a pure
// cosineSimilarity helper with mismatch/zero-norm guards.
//
// Plan references: docs/PHASE7.md §2.2, §7.7, §14.
//
// Env: GEMINI_API_KEY (preferred) or GOOGLE_API_KEY (fallback)
//
// Injectable seam: set `_internal.fetch` to a mock in tests — the module
// never touches globalThis.fetch directly, always resolving through the seam.

const DEFAULT_EMBED_TIMEOUT_MS = 60_000;

/**
 * Injectable fetch seam. Set to a vi.fn() in tests to avoid network calls.
 * Resolved to globalThis.fetch at call time when null.
 * @type {{ fetch: ((url: string, init?: RequestInit) => Promise<Response>) | null }}
 */
export const _internal = {
  fetch: null,
};

// ─── main entry point ────────────────────────────────────────────────────────

/**
 * Embed one or more texts using Gemini Embedding 2.
 *
 * Single text  → `:embedContent`       (one round-trip)
 * Multiple texts → `:batchEmbedContents` (chunked into groups of `batch`)
 *
 * @param {object}   opts
 * @param {string[]} opts.texts   — non-empty array of strings to embed
 * @param {string}  [opts.model='gemini-embedding-2-preview']
 * @param {number}  [opts.dim=768]   — outputDimensionality passed to the API
 * @param {number}  [opts.batch=100] — max texts per batchEmbedContents call
 * @param {number}  [timeoutMs=60000]
 * @returns {Promise<{vectors:number[][], isError:boolean, raw:object, latencyMs:number}>}
 */
export async function runGeminiEmbedding2(
  { texts, model = 'gemini-embedding-2-preview', dim = 768, batch = 100 },
  timeoutMs = DEFAULT_EMBED_TIMEOUT_MS,
) {
  const t0 = Date.now();

  // ── key resolution ──────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      vectors: [], isError: true,
      raw: { error: 'GEMINI_API_KEY or GOOGLE_API_KEY not set in environment' },
      latencyMs: Date.now() - t0,
    };
  }

  // ── argument validation ──────────────────────────────────────────────────
  if (!Array.isArray(texts) || texts.length === 0) {
    return {
      vectors: [], isError: true,
      raw: { error: 'texts must be a non-empty array' },
      latencyMs: Date.now() - t0,
    };
  }

  // ── fetch seam resolution ────────────────────────────────────────────────
  const fetchFn = _internal.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      vectors: [], isError: true,
      raw: { error: 'global fetch unavailable (Node 18+ required)' },
      latencyMs: Date.now() - t0,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    // ── single text: embedContent ──────────────────────────────────────────
    if (texts.length === 1) {
      const body = buildEmbedPayload({ texts, model, dim, single: true });
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          vectors: [], isError: true,
          raw: { status: res.status, body: errText.slice(0, 1000) },
          latencyMs: Date.now() - t0,
        };
      }
      const json = await res.json();
      return {
        vectors: parseEmbedResponse(json, true),
        isError: false,
        raw: { model: json.model || model, single: true },
        latencyMs: Date.now() - t0,
      };
    }

    // ── multiple texts: batchEmbedContents (chunked) ───────────────────────
    const allVectors = [];
    let batchCount = 0;
    for (let i = 0; i < texts.length; i += batch) {
      const chunk = texts.slice(i, i + batch);
      const body = buildEmbedPayload({ texts: chunk, model, dim, single: false });
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(model)}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          vectors: [], isError: true,
          raw: {
            status: res.status,
            body: errText.slice(0, 1000),
            batchIndex: batchCount,
            partialCount: allVectors.length,
          },
          latencyMs: Date.now() - t0,
        };
      }
      const json = await res.json();
      const batchVecs = parseEmbedResponse(json, false);
      allVectors.push(...batchVecs);
      batchCount++;
    }

    return {
      vectors: allVectors,
      isError: false,
      raw: { model, batches: batchCount },
      latencyMs: Date.now() - t0,
    };

  } catch (e) {
    return {
      vectors: [], isError: true,
      raw: { error: e.message || String(e), aborted: ctrl.signal.aborted },
      latencyMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── pure builders + parsers (pinned wire format) ────────────────────────────

/**
 * Pure builder for the Gemini embedContent / batchEmbedContents payload.
 * Exported for unit tests so the wire format is pinned and can be asserted
 * without invoking the network.
 *
 * @param {object}   opts
 * @param {string[]} opts.texts
 * @param {string}   opts.model
 * @param {number}   opts.dim
 * @param {boolean}  opts.single — true → embedContent shape; false → batchEmbedContents
 */
export function buildEmbedPayload({ texts, model, dim, single }) {
  if (single) {
    // embedContent: a single EmbedContentRequest body
    return {
      model: `models/${model}`,
      content: { parts: [{ text: texts[0] }] },
      outputDimensionality: dim,
    };
  }
  // batchEmbedContents: array of EmbedContentRequest objects
  return {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: dim,
    })),
  };
}

/**
 * Parse an embedContent (single=true) or batchEmbedContents (single=false)
 * response into number[][]. Returns empty arrays for missing/malformed entries
 * rather than throwing.
 *
 * @param {object}  json
 * @param {boolean} single
 * @returns {number[][]}
 */
export function parseEmbedResponse(json, single) {
  if (single) {
    // embedContent response: { embedding: { values: number[] } }
    if (json && Array.isArray(json.embedding?.values)) {
      return [json.embedding.values];
    }
    return [];
  }
  // batchEmbedContents response: { embeddings: [{ values: number[] }, ...] }
  if (!json || !Array.isArray(json.embeddings)) return [];
  return json.embeddings.map((e) => (e && Array.isArray(e.values) ? e.values : []));
}

// ─── cosine similarity ────────────────────────────────────────────────────────

/**
 * Cosine similarity between two equal-length numeric vectors.
 *
 * Guard conditions (all return 0 to avoid NaN):
 *   - Either argument is not an Array
 *   - Length mismatch
 *   - Zero-length arrays
 *   - Either vector has zero L2-norm
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} cosine similarity in [-1, 1], or 0 on guard conditions
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
