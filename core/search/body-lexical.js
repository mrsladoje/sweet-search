/**
 * Body-text lexical channel for hybrid search (agent formats only).
 *
 * Reads `chunk_text_fts` (core/indexing/chunk-text-fts.js): BM25 over the
 * text of the same chunks the semantic channel ranks. It reaches text that
 * lives inside code — error messages, log lines, string constants, config
 * keys — which the entity BM25 channel (names, signatures, doc comments)
 * never indexes.
 *
 * Modes (SWEET_SEARCH_BODY_LEXICAL, comma or '+' separated):
 *   pin   exact-string guaranteed slot. When the query's text occurs in the
 *         body of at most PIN_MAX non-test chunks (see retrieveBodyLexical
 *         for the match rule), those chunks enter the seed list first and
 *         stay ahead of the rerank (later file-kind and content demotions
 *         still apply to them).
 *   pool  the top POOL_N body BM25 hits join the seed list after the k fused
 *         seeds, so the late-interaction rerank scores them with the rest.
 *   rrf   the body BM25 list is fused into the hybrid list by weighted RRF
 *         before the seed cut.
 *   off   nothing.
 *
 * Format gating (CLAUDE.md "Ranking Signal Format-Gating"): only agent
 * formats ever reach this channel; non-agent search is byte-identical.
 */

import { buildChunkTextQueries, CHUNK_TEXT_FTS_WEIGHTS } from '../indexing/chunk-text-fts.js';
import { detectFileKind } from '../ranking/file-kind-ranking.js';

const AGENT_FORMATS = new Set(['agent', 'agent_preview', 'agent_full', 'agent_full_xl']);

export const DEFAULT_BODY_LEXICAL_MODE = 'pin';
export const PIN_MIN_WORDS = 3;
export const PIN_MAX = 3;
export const PIN_MIN_COVERAGE = 0.8;
export const PIN_CANDIDATES = 30;
export const POOL_N = 10;
export const RRF_K = 60;

function hasAblation(ablations, name) {
  return ablations instanceof Set
    ? ablations.has(name)
    : Array.isArray(ablations) && ablations.includes(name);
}

function envInt(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function envFloat(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Resolved channel settings for one search, or null when the channel is off
 * for it (non-agent format, ablation 'no-body-lexical', or mode 'off').
 */
export function bodyLexicalSettings(options = {}, env = process.env) {
  if (!AGENT_FORMATS.has(options.format)) return null;
  if (hasAblation(options.ablations, 'no-body-lexical')) return null;
  const raw = String(options.bodyLexical ?? env.SWEET_SEARCH_BODY_LEXICAL ?? DEFAULT_BODY_LEXICAL_MODE).toLowerCase();
  const modes = new Set(raw.split(/[,+\s]+/).filter((m) => m === 'pin' || m === 'pool' || m === 'rrf'));
  if (modes.size === 0) return null;
  return {
    pin: modes.has('pin'),
    pool: modes.has('pool'),
    rrf: modes.has('rrf'),
    pinMinWords: envInt(env, 'SWEET_SEARCH_BODY_PIN_MIN_WORDS', PIN_MIN_WORDS, 1, 50),
    pinMax: envInt(env, 'SWEET_SEARCH_BODY_PIN_MAX', PIN_MAX, 1, 20),
    pinMinCoverage: envFloat(env, 'SWEET_SEARCH_BODY_PIN_MIN_COVERAGE', PIN_MIN_COVERAGE, 0, 1),
    poolN: envInt(env, 'SWEET_SEARCH_BODY_POOL_N', POOL_N, 1, 100),
    rrfWeight: envFloat(env, 'SWEET_SEARCH_BODY_RRF_WEIGHT', 0.5, 0, 4),
    weights: [
      envFloat(env, 'SWEET_SEARCH_BODY_W_BODY', CHUNK_TEXT_FTS_WEIGHTS.body, 0, 100),
      envFloat(env, 'SWEET_SEARCH_BODY_W_SUBTOKENS', CHUNK_TEXT_FTS_WEIGHTS.subtokens, 0, 100),
    ],
  };
}

function toResult(row, searchPath) {
  let metadata = {};
  try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch { metadata = {}; }
  if (!metadata.file && row.file_path) metadata.file = row.file_path;
  return { id: row.id, score: row.score, bodyScore: row.score, metadata, searchPath };
}

/** Lowercase letter/digit words, the unit the alignment compares. */
export function textWords(text) {
  return (String(text || '').match(/[\p{L}\p{N}]+/gu) || []).map((w) => w.toLowerCase());
}

/**
 * Longest in-order alignment of the query words inside a chunk's words, with
 * small gaps on both sides: up to MAX_DOC_GAP chunk words between two matched
 * words (a format verb such as %s, or a quoted value, in the code) and up to
 * MAX_QUERY_GAP skipped query words (a runtime value pasted into the query).
 * Returns the number of query words matched.
 */
export const MAX_DOC_GAP = 3;
export const MAX_QUERY_GAP = 2;
export function alignedQueryWords(queryWords, docWords) {
  const n = queryWords.length;
  const m = docWords.length;
  if (n === 0 || m === 0) return 0;
  const positions = new Map();
  for (let j = 0; j < m; j++) {
    const w = docWords[j];
    if (!positions.has(w)) positions.set(w, []);
    positions.get(w).push(j);
  }
  // best[i]: doc position -> longest chain ending at query word i there.
  const best = new Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    best[i] = new Map();
    const at = positions.get(queryWords[i]);
    if (!at) continue;
    for (const j of at) {
      let len = 1;
      for (let pi = Math.max(0, i - 1 - MAX_QUERY_GAP); pi < i; pi++) {
        for (const [pj, plen] of best[pi]) {
          if (pj < j && j - pj - 1 <= MAX_DOC_GAP && plen + 1 > len) len = plen + 1;
        }
      }
      best[i].set(j, len);
      if (len > top) top = len;
    }
  }
  return top;
}

const KIND_ORDER = { implementation: 0, types: 1, ancillary: 2, examples: 3, docs: 4, tests: 5 };

/** One code token of two or more words joined by _ . - or : ("time_utc", "test.foo"). */
const CODE_TOKEN_RE = /^[\p{L}\p{N}]+(?:[_.:-]+[\p{L}\p{N}]+)+$/u;

/**
 * Run the channel's queries.
 *
 * Pin (exact string). A query that is one code token (CODE_TOKEN_RE) matches
 * the chunks whose text holds that token verbatim, case-insensitively; a
 * looser word match would hit every `time.UTC` for "time_utc". Otherwise
 * candidates are the top body-BM25 hits for the query's words, and a
 * candidate is an exact match when its text holds at least
 * PIN_MIN_COVERAGE of the query's words in order (small gaps allowed, see
 * alignedQueryWords) and at least PIN_MIN_WORDS words. The pin fires only
 * when the exact matches are specific: at most PIN_MAX of them outside
 * tests/docs/examples. When any of those match, only they are pinned (the
 * code that emits a message, not the tests that quote it); otherwise the
 * tests/docs/examples are. Pins are ordered by file kind, then by words
 * matched, then by BM25.
 * @returns {{ pins: Array, hits: Array, stats: object }}
 */
export function retrieveBodyLexical(codebaseRepo, query, settings) {
  const stats = { pinFired: false, pinCandidates: 0, hits: 0 };
  if (!codebaseRepo || typeof codebaseRepo.searchChunkText !== 'function' || !settings) {
    return { pins: [], hits: [], stats };
  }
  const q = buildChunkTextQueries(query);
  const token = String(query || '').trim();
  let exact = null;
  if (settings.pin && q.phrase && q.words.length >= 2 && CODE_TOKEN_RE.test(token)) {
    const lower = token.toLowerCase();
    exact = codebaseRepo.searchChunkText(q.phrase, PIN_CANDIDATES, { weights: settings.weights, withText: true })
      .filter((row) => String(row.text || '').toLowerCase().includes(lower))
      .map((row) => ({ row, matched: q.words.length, kind: detectFileKind(row.file_path) }));
  } else if (settings.pin && q.or && q.words.length >= settings.pinMinWords) {
    const rows = codebaseRepo.searchChunkText(q.or, PIN_CANDIDATES, { weights: settings.weights, withText: true });
    const need = Math.max(settings.pinMinWords, Math.ceil(settings.pinMinCoverage * q.words.length));
    exact = [];
    for (const row of rows) {
      const matched = alignedQueryWords(q.words, textWords(row.text));
      if (matched >= need) exact.push({ row, matched, kind: detectFileKind(row.file_path) });
    }
  }
  let pins = [];
  if (exact) {
    stats.pinCandidates = exact.length;
    const primary = exact.filter((e) => e.kind === 'implementation' || e.kind === 'types' || e.kind === 'ancillary');
    if (exact.length > 0 && primary.length <= settings.pinMax) {
      // Tests/docs/examples that quote the text are pinned only when no
      // implementation chunk holds it: a pin outranks every unpinned result.
      const pinnable = primary.length > 0 ? primary : exact;
      pinnable.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
        || (b.matched - a.matched)
        || (b.row.score - a.row.score));
      pins = pinnable.slice(0, settings.pinMax).map((e) => {
        const { text: _text, ...row } = e.row;
        return { ...toResult(row, 'body-pin'), bodyMatchedWords: e.matched };
      });
      stats.pinFired = true;
    }
  }
  let hits = [];
  if ((settings.pool || settings.rrf) && q.or) {
    const limit = settings.rrf ? 50 : settings.poolN;
    hits = codebaseRepo.searchChunkText(q.or, limit, { weights: settings.weights })
      .map((row) => toResult(row, 'body-lexical'));
    stats.hits = hits.length;
  }
  return { pins, hits, stats };
}

/**
 * Weighted RRF of the hybrid list with the body BM25 list. Scores are
 * rescaled into the hybrid list's own score range so later multiplicative
 * stages (boosts, demotions) see the same magnitudes.
 */
export function fuseBodyRRF(fused, hits, weight = 0.5, k = RRF_K) {
  if (!Array.isArray(hits) || hits.length === 0) return fused;
  const key = (r) => String(r.id ?? `${r.file ?? r.metadata?.file}:${r.startLine ?? r.metadata?.startLine}`);
  const acc = new Map();
  fused.forEach((r, i) => acc.set(key(r), { result: r, rrf: 1 / (k + i + 1) }));
  hits.forEach((r, i) => {
    const id = key(r);
    const entry = acc.get(id);
    if (entry) {
      entry.rrf += weight / (k + i + 1);
      entry.result = { ...entry.result, bodyScore: r.bodyScore, sources: [...(entry.result.sources || []), 'body'] };
    } else {
      acc.set(id, { result: { ...r, sources: ['body'] }, rrf: weight / (k + i + 1) });
    }
  });
  const ranked = [...acc.values()].sort((a, b) => b.rrf - a.rrf);
  const top = typeof fused[0]?.score === 'number' && fused[0].score > 0 ? fused[0].score : 1;
  const maxRrf = ranked[0]?.rrf || 1;
  return ranked.map(({ result, rrf }) => ({ ...result, score: top * (rrf / maxRrf), bodyRrf: rrf }));
}

/**
 * Seed list with the channel applied: pins first, then the fused seeds up to
 * k, then (pool) body hits not already present.
 */
export function composeSeeds(diversified, k, pins, poolHits) {
  const pinIds = new Set(pins.map((p) => p.id));
  const rest = diversified.filter((r) => !pinIds.has(r.id));
  const topScore = Math.max(0, ...diversified.slice(0, 1).map((r) => (typeof r.score === 'number' ? r.score : 0)));
  const pinned = pins.map((p, i) => {
    const existing = diversified.find((r) => r.id === p.id);
    return {
      ...(existing || p),
      score: topScore + (pins.length - i) * 1e-6,
      _bodyPin: i + 1,
      searchPath: existing?.searchPath || p.searchPath,
    };
  });
  const seeds = [...pinned, ...rest.slice(0, Math.max(0, k - pinned.length))];
  if (Array.isArray(poolHits) && poolHits.length > 0) {
    const ids = new Set(seeds.map((r) => r.id));
    const floor = Math.min(...seeds.map((r) => (typeof r.score === 'number' ? r.score : 0)), topScore);
    for (const hit of poolHits) {
      if (ids.has(hit.id)) continue;
      ids.add(hit.id);
      // Below every fused seed: without a rerank they stay behind the seeds.
      seeds.push({ ...hit, score: floor * 0.5, _bodyPool: true });
    }
  }
  return seeds;
}

/**
 * After the rerank: pinned results go back to the front, in pin order, with a
 * score just above the best, so later multiplicative demotions decide.
 */
export function refrontPins(results) {
  if (!Array.isArray(results) || !results.some((r) => r?._bodyPin)) return results;
  const pinned = results.filter((r) => r._bodyPin).sort((a, b) => a._bodyPin - b._bodyPin);
  const rest = results.filter((r) => !r._bodyPin);
  const top = Math.max(0, ...rest.map((r) => (typeof r.score === 'number' ? r.score : 0)));
  return [
    ...pinned.map((r, i) => ({ ...r, score: top + (pinned.length - i) * 1e-6 })),
    ...rest,
  ];
}
