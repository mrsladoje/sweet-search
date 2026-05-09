/**
 * Track A worker — runs in a child process bound to ONE repo.
 *
 * The driver (track-a.mjs) spawns this with cwd = eval/repos/<repo> and env
 * SWEET_SEARCH_PROJECT_ROOT pointing at the same path. We import sweet-search
 * modules lazily AFTER reading the env so DB_PATHS resolves against the right
 * repo.
 *
 * The worker reads a JSON payload `{ tuples: [...] }` from stdin (one batch),
 * runs each tuple through the appropriate tool, scores deterministically,
 * emits one JSONL record per tuple to stdout, and a final `# summary: {...}`
 * line.
 *
 * Plan reference: §7.4 Track A (deterministic per-tool sweep), §7.6 four-gate
 * promotion.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const opts = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const o = { runId: null, repo: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') o.runId = argv[++i];
    else if (argv[i] === '--repo') o.repo = argv[++i];
    else if (argv[i] === '--dry-run') o.dryRun = true;
  }
  return o;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ─── scoring helpers ──────────────────────────────────────────────────────

function fileMatches(actual, expectedAnyOf) {
  if (!actual) return false;
  if (!expectedAnyOf || expectedAnyOf.length === 0) return null;        // n/a
  // match by suffix or basename (gold paths are repo-relative; tool may
  // return repo-relative or absolute under .sweet-search namespace)
  const actNorm = String(actual).replace(/\\/g, '/');
  for (const exp of expectedAnyOf) {
    const e = String(exp).replace(/\\/g, '/');
    if (actNorm === e) return true;
    if (actNorm.endsWith('/' + e)) return true;
    if (actNorm.endsWith(e)) return true;
    const eBase = path.basename(e);
    const aBase = path.basename(actNorm);
    if (eBase === aBase) return true;
  }
  return false;
}

function symbolMatches(actual, expectedAnyOf) {
  if (!expectedAnyOf || expectedAnyOf.length === 0) return null;
  if (!actual) return false;
  return expectedAnyOf.some((s) => String(s) === String(actual));
}

function lineOverlap(actualStart, actualEnd, expectedRangesByFile, file) {
  const ranges = expectedRangesByFile?.[file];
  if (!ranges || !Number.isFinite(actualStart) || !Number.isFinite(actualEnd)) return null;
  // ranges is an array of [start, end] pairs (per existing tasks.js schema).
  // Compute Jaccard-like overlap of the result span with the union of ranges.
  let bestOverlap = 0;
  for (const [s, e] of ranges) {
    const inter = Math.max(0, Math.min(actualEnd, e) - Math.max(actualStart, s) + 1);
    const union = Math.max(actualEnd, e) - Math.min(actualStart, s) + 1;
    if (union > 0) bestOverlap = Math.max(bestOverlap, inter / union);
  }
  return bestOverlap;
}

function recallAtK(results, expectedFilesAnyOf, K) {
  if (!expectedFilesAnyOf || expectedFilesAnyOf.length === 0) return null;
  const top = results.slice(0, K);
  for (const r of top) {
    if (fileMatches(r.file, expectedFilesAnyOf)) return 1;
  }
  return 0;
}

function approxTokens(s) {
  if (!s) return 0;
  return Math.max(1, Math.ceil(String(s).length / 4));
}

// ─── tool callers ─────────────────────────────────────────────────────────

let _ss = null;
async function getSweetSearch() {
  if (_ss) return _ss;
  const PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT;
  if (!PROJECT_ROOT || !existsSync(path.join(PROJECT_ROOT, '.sweet-search/codebase.db'))) {
    throw new Error(
      `track-a-worker: SWEET_SEARCH_PROJECT_ROOT=${PROJECT_ROOT} missing .sweet-search index`
    );
  }
  const { SweetSearch } = await import(path.join(REPO_ROOT, 'core/search/sweet-search.js'));
  _ss = new SweetSearch({ projectRoot: PROJECT_ROOT });
  await _ss.init();
  return _ss;
}

async function callSsSearch(tuple) {
  const t0 = Date.now();
  const ss = await getSweetSearch();
  // SweetSearch.search(query, options) — 2-arg signature; options.k (not topK).
  // Agent format triggers packageForAgent → returns { results, tokenBudget, ... }.
  const r = await ss.search(tuple.query, { k: 5, mode: 'auto', format: 'agent' });
  const latency_ms = Date.now() - t0;
  const results = (r.results || []).map((x) => ({
    file: x.file,
    startLine: x.startLine,
    endLine: x.endLine,
    symbol: x.symbol ?? null,
    code: x.code ?? '',
  }));
  return { results, latency_ms, raw: { tokensUsed: r.tokensUsed, subMode: r.subMode } };
}

async function callSsFind(tuple) {
  const t0 = Date.now();
  const ss = await getSweetSearch();
  if (!ss.hasLateInteractionIndex) {
    return { results: [], latency_ms: Date.now() - t0, raw: { fallback: 'no-LI' } };
  }
  // patternSearch(query, routing, options) — 3-arg signature; routing=null is OK.
  const r = await ss.patternSearch(tuple.query, null, {
    regex: tuple.regex || `\\b\\w+\\b`,
    k: 6,
    format: 'benchmark',
  });
  const latency_ms = Date.now() - t0;
  const results = (r.results || []).map((x) => ({
    file: x.file,
    startLine: x.startLine,
    endLine: x.endLine,
    symbol: x.name ?? null,
    code: x.text ?? '',
  }));
  return { results, latency_ms, raw: {} };
}

async function callSsSemantic(tuple) {
  const t0 = Date.now();
  // ss-semantic is single-file; the "expected file" is the gold file. If no
  // file is in the gold, ss-semantic isn't a meaningful comparison — emit a
  // sentinel record.
  const file = tuple.expectedFiles?.[0];
  if (!file) {
    return { results: [], latency_ms: Date.now() - t0, raw: { skipped: 'no-gold-file' } };
  }
  const PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT;
  const { readSemantic } = await import(path.join(REPO_ROOT, 'core/search/search-read-semantic.js'));
  const r = await readSemantic({
    path: file,
    query: tuple.query,
    projectRoot: PROJECT_ROOT,
    maxTokens: 800,
  });
  const latency_ms = Date.now() - t0;
  if (!r || !r.ok) return { results: [], latency_ms, raw: { error: r?.error || 'unknown' } };
  // ss-semantic returns spans within the file. Map to a single result with
  // the file + best span.
  const spans = r.spans || [];
  if (spans.length === 0) return { results: [], latency_ms, raw: {} };
  const top = spans[0];
  return {
    results: [
      {
        file,
        startLine: top.startLine ?? null,
        endLine: top.endLine ?? null,
        // span shape is { symbols: [...], types: [...], text, ... }
        symbol: Array.isArray(top.symbols) ? (top.symbols[0] ?? null) : (top.symbol ?? null),
        code: top.text ?? '',
      },
    ],
    latency_ms,
    raw: { nSpans: spans.length },
  };
}

async function callStructural(tuple) {
  // Structural mode is meaningful only when the gold has a primary symbol —
  // structuralSearch needs (structuralType, targetEntity) to dispatch into
  // graphSearch.{findCallers,findCallees,findImplementations,findImpact}.
  // Without a symbol, parseStructuralQuery() returns null and the search
  // path falls back to hybridSearchV2 — defeating the whole point of
  // measuring "structural mode". Skip those tuples with a sentinel record.
  const t0 = Date.now();
  const sym = tuple.expectedSymbols?.[0];
  if (!sym) {
    return { results: [], latency_ms: Date.now() - t0, raw: { skipped: 'no-gold-symbol' } };
  }
  // Inject a relationship verb keyed on the gold's stratum so
  // parseStructuralQuery() picks up the right structuralType. We call with
  // mode='auto' so the router itself routes to structural — that's what an
  // agent would experience after being instructed "phrase as 'callers of X'".
  let q = tuple.query;
  let usedRelationshipVerb = null;
  switch (tuple.qshape_stratum) {
    case 'multi-file-flow':  q = `callers of ${sym}`;          usedRelationshipVerb = 'callers'; break;
    case 'structural':       q = `implementations of ${sym}`;  usedRelationshipVerb = 'implementations'; break;
    case 'behavioral':       q = `what does ${sym} call`;      usedRelationshipVerb = 'callees'; break;
    case 'literal-lookup':   q = `where is ${sym} called`;     usedRelationshipVerb = 'callers'; break;
    default: /* leave as-is */ break;
  }
  const ss = await getSweetSearch();
  const r = await ss.search(q, { k: 5, mode: 'auto', format: 'agent' });
  const latency_ms = Date.now() - t0;
  const results = (r.results || []).map((x) => ({
    file: x.file,
    startLine: x.startLine,
    endLine: x.endLine,
    symbol: x.symbol ?? null,
    code: x.code ?? '',
  }));
  return {
    results,
    latency_ms,
    raw: {
      tokensUsed: r.tokensUsed,
      subMode: r.subMode,
      routedMode: r.stats?.routing?.mode,
      usedRelationshipVerb,
      structuralQuery: q,
    },
  };
}

const TOOL_CALLERS = {
  'ss-search': callSsSearch,
  'ss-find': callSsFind,
  'ss-semantic': callSsSemantic,
  structural: callStructural,
};

// ─── score one tuple ──────────────────────────────────────────────────────

async function scoreTuple(tuple) {
  if (opts.dryRun) {
    return {
      goldId: tuple.goldId,
      variantId: tuple.variantId,
      tool: tuple.tool,
      shape: tuple.shape,
      stratum: tuple.qshape_stratum,
      query: tuple.query,
      regex: tuple.regex,
      expected: { files: tuple.expectedFiles, symbols: tuple.expectedSymbols },
      metrics: null,
      dryRun: true,
    };
  }
  const caller = TOOL_CALLERS[tuple.tool];
  if (!caller) throw new Error(`unknown tool ${tuple.tool}`);
  let toolOut, error = null;
  try {
    toolOut = await caller(tuple);
  } catch (e) {
    error = e.message || String(e);
    toolOut = { results: [], latency_ms: 0, raw: {} };
  }
  const fr1 = recallAtK(toolOut.results, tuple.expectedFiles, 1);
  const fr3 = recallAtK(toolOut.results, tuple.expectedFiles, 3);
  const fr5 = recallAtK(toolOut.results, tuple.expectedFiles, 5);
  const sr1 = (() => {
    const top = toolOut.results[0];
    return symbolMatches(top?.symbol, tuple.expectedSymbols);
  })();
  // gold_line_overlap on top-1 if file matches
  const lo = (() => {
    const top = toolOut.results[0];
    if (!top || !fileMatches(top.file, tuple.expectedFiles)) return null;
    // Find which expected file matched
    const matchedFile = tuple.expectedFiles.find((f) => fileMatches(top.file, [f]));
    return lineOverlap(top.startLine, top.endLine, tuple.expectedLineRanges, matchedFile);
  })();
  const tokens = toolOut.results.reduce((s, r) => s + approxTokens(r.code), 0);
  const followUp = (() => {
    if (fr1 == null || fr3 == null) return null;
    if (fr1 === 1) return 0;
    if (fr3 === 1) return 1;
    return 2; // not in top-3
  })();

  return {
    goldId: tuple.goldId,
    variantId: tuple.variantId,
    tool: tuple.tool,
    shape: tuple.shape,
    isBaseline: tuple.isBaseline,
    stratum: tuple.qshape_stratum,
    query: tuple.query,
    regex: tuple.regex,
    expected: { files: tuple.expectedFiles, symbols: tuple.expectedSymbols },
    rawTopK: toolOut.results.slice(0, 5).map((r) => ({
      file: r.file,
      startLine: r.startLine,
      endLine: r.endLine,
      symbol: r.symbol,
      tokens: approxTokens(r.code),
    })),
    metrics: {
      file_recall_at_1: fr1,
      file_recall_at_3: fr3,
      file_recall_at_5: fr5,
      symbol_recall_at_1: sr1,
      gold_line_overlap: lo,
      tokens_returned: tokens,
      follow_up_reads: followUp,
      latency_ms: toolOut.latency_ms,
    },
    error,
  };
}

// ─── summary ──────────────────────────────────────────────────────────────

function summariseRepo(records) {
  const cells = new Map();
  for (const r of records) {
    if (!r.metrics) continue;
    const k = `${r.tool}|${r.shape}`;
    if (!cells.has(k)) cells.set(k, { tool: r.tool, shape: r.shape, n: 0, fr1: 0 });
    const c = cells.get(k);
    c.n += 1;
    c.fr1 += r.metrics.file_recall_at_1 || 0;
  }
  return {
    nRecords: records.length,
    cells: [...cells.values()].map((c) => ({
      tool: c.tool,
      shape: c.shape,
      n: c.n,
      fr1: c.fr1 / c.n,
    })),
  };
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  if (!opts.runId || !opts.repo) {
    process.stderr.write('track-a-worker: --run and --repo required\n');
    process.exit(2);
  }
  const stdinText = await readStdin();
  const payload = JSON.parse(stdinText);
  const tuples = payload.tuples;
  if (!Array.isArray(tuples)) {
    process.stderr.write('track-a-worker: stdin payload must be { tuples: [...] }\n');
    process.exit(2);
  }
  const records = [];
  for (const t of tuples) {
    const rec = await scoreTuple(t);
    rec._repo = opts.repo;
    rec._runId = opts.runId;
    records.push(rec);
    process.stdout.write(JSON.stringify(rec) + '\n');
  }
  const summary = summariseRepo(records);
  process.stdout.write(`# summary: ${JSON.stringify(summary)}\n`);
}

main().catch((err) => {
  process.stderr.write(`track-a-worker: ${err.stack || err.message}\n`);
  process.exit(1);
});
