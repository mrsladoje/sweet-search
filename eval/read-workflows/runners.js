// Real workflow runners — read-workflows benchmark.
//
//   native-rg-read           : spawn rg + fs.readFile (Claude Code default)
//   sweet-grep-read          : SweetSearch.bareGrep (indexed grep, gram
//                              prefilter) + sweet-search read for the
//                              symbol-bounded line ranges of overlapping
//                              chunks (chunks are pulled from the per-file
//                              chunk metadata stored in vectors.db)
//   sweet-grep-read-semantic : SweetSearch.patternSearch (ColGrep — regex
//                              candidates re-ranked by MaxSim) for discovery,
//                              then sweet-search read-semantic on each top-K
//                              file using the natural-language semantic_query
//
// Each runner returns:
//   { mode, taskId,
//     discovery: { ms, hits, chars, returnedFiles[], stats? },
//     reads:     { ms, count, totalChars },
//     totalMs, totalChars, approxTokens,
//     returnedContext: [{ file, lines: Set<number>, text }],
//     fellBack?, liRan? }

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const APPROX_CHARS_PER_TOKEN = 4;
const NATIVE_READ_LINE_CAP = 2000;
const SWEET_TOPK = 10;

// ---------------------------------------------------------------------------
// Shared: rg subprocess (used by native discovery)
// ---------------------------------------------------------------------------

function runNativeRg(pattern, dir) {
  const t0 = performance.now();
  const out = spawnSync('rg', ['--json', '-m', '500', pattern, '.'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15000,
  });
  const ms = +(performance.now() - t0).toFixed(2);
  const matches = [];
  if (!out.stdout) return { matches, ms, errored: out.status !== 0 && out.status !== 1 };
  for (const line of out.stdout.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'match') continue;
    const file = (obj.data?.path?.text || '').replace(/^\.\//, '');
    const lineNo = obj.data?.line_number;
    const text = obj.data?.lines?.text || '';
    if (file && lineNo) matches.push({ file, line: lineNo, text });
  }
  return { matches, ms, errored: false };
}

async function nativeReadWholeFile(absPath) {
  const t0 = performance.now();
  const text = await fs.readFile(absPath, 'utf8');
  const lines = text.split('\n');
  const cap = Math.min(lines.length, NATIVE_READ_LINE_CAP);
  const capped = lines.length > NATIVE_READ_LINE_CAP ? lines.slice(0, cap).join('\n') : text;
  return {
    text: capped, startLine: 1, endLine: cap, totalLines: lines.length,
    ms: +(performance.now() - t0).toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Mode 1: native-rg-read
// ---------------------------------------------------------------------------

export async function runNativeRgRead(task, ctx) {
  const t0 = performance.now();
  const rg = runNativeRg(task.queryRegex, ctx.repoDir);
  // Native agents typically only follow up on the top-K most relevant matches;
  // a strict "rg → Read every hit file" would obliterate the token budget on
  // common patterns like `function\s+\w+`. We mirror Claude Code's typical
  // behaviour: Read at most the first SWEET_TOPK distinct files seen.
  const matchedFiles = [...new Set(rg.matches.map(m => m.file))].slice(0, SWEET_TOPK);

  const reads = [];
  let readMs = 0;
  for (const rel of matchedFiles) {
    const abs = path.join(ctx.repoDir, rel);
    let r;
    try { r = await nativeReadWholeFile(abs); }
    catch { continue; }
    readMs += r.ms;
    const lineSet = new Set();
    for (let i = r.startLine; i <= r.endLine; i++) lineSet.add(i);
    reads.push({ file: rel, lines: lineSet, text: r.text });
  }

  const totalMs = +(performance.now() - t0).toFixed(2);
  const discoveryChars = rg.matches.reduce((acc, m) => acc + m.text.length + m.file.length + 8, 0);
  const readChars = reads.reduce((acc, r) => acc + r.text.length, 0);
  const totalChars = discoveryChars + readChars;
  return {
    mode: 'native-rg-read', taskId: task.id,
    discovery: { ms: rg.ms, hits: rg.matches.length, chars: discoveryChars, returnedFiles: matchedFiles, totalRgFiles: new Set(rg.matches.map(m => m.file)).size },
    reads: { ms: +readMs.toFixed(2), count: reads.length, totalChars: readChars },
    totalMs, totalChars, approxTokens: Math.ceil(totalChars / APPROX_CHARS_PER_TOKEN),
    returnedContext: reads,
    fellBack: false, liRan: false,
  };
}

// ---------------------------------------------------------------------------
// Mode 2: sweet-grep-read (real SweetSearch.bareGrep + sweet-search read)
// ---------------------------------------------------------------------------

export async function runSweetGrepRead(task, ctx) {
  const t0 = performance.now();

  const tDisc0 = performance.now();
  const bareGrepResult = await ctx.searcher.bareGrep(task.queryRegex, null, {
    regex: task.queryRegex,
    maxMatches: 500,
    contextLines: 0,
  });
  const discoveryMs = +(performance.now() - tDisc0).toFixed(2);

  // bareGrep returns one result per matched line. The indexed-grep advantage
  // is chunk metadata: we expand each match to its containing chunk and rank
  // chunks by hit density (more matches in a chunk = stronger evidence).
  // Then we read the top-K chunks via sweet-search read on the symbol-bounded
  // range. This mirrors how an agent using indexed grep would prioritise.
  const byFile = new Map();
  for (const r of bareGrepResult.results) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r.line);
  }

  // Build (chunk, hitCount) tuples across all files, then take top-K chunks.
  const chunkHits = []; // [{ file, chunk, hits, lineSet }]
  const filesWithoutChunks = new Set();
  for (const [file, lines] of byFile) {
    const chunks = await loadChunksForFile(ctx, file);
    if (chunks.length === 0) { filesWithoutChunks.add(file); continue; }
    const perChunk = new Map();
    for (const ln of lines) {
      for (const c of chunks) {
        if (c.startLine <= ln && c.endLine >= ln) {
          const e = perChunk.get(c.id) || { chunk: c, hits: 0 };
          e.hits += 1;
          perChunk.set(c.id, e);
          break;
        }
      }
    }
    for (const { chunk, hits } of perChunk.values()) {
      chunkHits.push({ file, chunk, hits });
    }
  }
  // Rank: more hits first; tiebreak by smaller chunks (more focused).
  chunkHits.sort((a, b) =>
    b.hits - a.hits ||
    (a.chunk.endLine - a.chunk.startLine) - (b.chunk.endLine - b.chunk.startLine)
  );
  const topChunks = chunkHits.slice(0, SWEET_TOPK);

  const { readFile: sweetReadFile } = await import('../../core/search/search-read.js');

  const reads = [];
  let readMs = 0;
  for (const { file, chunk } of topChunks) {
    let r;
    try {
      r = await sweetReadFile({
        path: file, projectRoot: ctx.repoDir,
        startLine: chunk.startLine, endLine: chunk.endLine,
      });
    } catch { continue; }
    readMs += r.timings?.totalMs || 0;
    const lineSet = new Set();
    for (let i = chunk.startLine; i <= chunk.endLine; i++) lineSet.add(i);
    reads.push({ file, lines: lineSet, text: r.text || '' });
  }
  // For files with no chunk metadata, do at most ONE capped fallback read so
  // an unindexed file is not invisible to the workflow.
  for (const file of [...filesWithoutChunks].slice(0, Math.max(0, SWEET_TOPK - reads.length))) {
    let r;
    try { r = await sweetReadFile({ path: file, projectRoot: ctx.repoDir }); }
    catch { continue; }
    readMs += r.timings?.totalMs || 0;
    const cap = Math.min(r.totalLines || 0, NATIVE_READ_LINE_CAP);
    const lineSet = new Set();
    for (let i = 1; i <= cap; i++) lineSet.add(i);
    reads.push({ file, lines: lineSet, text: r.text || '' });
  }
  const orderedFiles = [...new Set(reads.map(r => r.file))];

  const totalMs = +(performance.now() - t0).toFixed(2);
  const discoveryChars = bareGrepResult.results.reduce((acc, r) => acc + (r.matchText || '').length + (r.file || '').length + 8, 0);
  const readChars = reads.reduce((acc, r) => acc + r.text.length, 0);
  const totalChars = discoveryChars + readChars;
  return {
    mode: 'sweet-grep-read', taskId: task.id,
    discovery: {
      ms: discoveryMs,
      hits: bareGrepResult.results.length,
      chars: discoveryChars,
      returnedFiles: orderedFiles,
      stats: pickStats(bareGrepResult.stats),
    },
    reads: { ms: +readMs.toFixed(2), count: reads.length, totalChars: readChars },
    totalMs, totalChars, approxTokens: Math.ceil(totalChars / APPROX_CHARS_PER_TOKEN),
    returnedContext: reads,
    fellBack: false, liRan: false,
  };
}

// ---------------------------------------------------------------------------
// Mode 3: sweet-grep-read-semantic (real SweetSearch.patternSearch + read-semantic)
// ---------------------------------------------------------------------------

export async function runSweetGrepReadSemantic(task, ctx) {
  const t0 = performance.now();

  // Discovery = ColGrep (patternSearch). Returns chunks ranked by MaxSim over
  // the regex candidate pool. The "semantic_query" is the natural-language
  // intent; the regex constrains the candidate set.
  const tDisc0 = performance.now();
  let psResult;
  try {
    psResult = await ctx.searcher.patternSearch(task.question, null, {
      regex: task.queryRegex,
      k: SWEET_TOPK,
      format: 'benchmark',  // get raw chunk records (not the agent-mode wrapper)
    });
  } catch (err) {
    // patternSearch hard-requires a late-interaction index; if missing, surface clearly.
    return {
      mode: 'sweet-grep-read-semantic', taskId: task.id, error: `patternSearch failed: ${err.message}`,
      discovery: { ms: 0, hits: 0, chars: 0, returnedFiles: [] },
      reads: { ms: 0, count: 0, totalChars: 0 },
      totalMs: 0, totalChars: 0, approxTokens: 0,
      returnedContext: [], fellBack: false, liRan: false,
    };
  }
  const discoveryMs = +(performance.now() - tDisc0).toFixed(2);

  const orderedFiles = [...new Set(psResult.results.map(r => r.file))].slice(0, SWEET_TOPK);

  const { readSemantic } = await import('../../core/search/search-read-semantic.js');

  const reads = [];
  let readMs = 0;
  let fellBackAny = false;
  let liRanAny = false;
  // Budget per file scaled so the sum across files fits the task budget.
  const perFileBudgetTokens = Math.max(80, Math.floor(task.maxBudgetTokens / Math.max(1, orderedFiles.length)));
  for (const file of orderedFiles) {
    let r;
    try {
      r = await readSemantic({
        path: file, projectRoot: ctx.repoDir,
        query: task.question,
        maxChars: perFileBudgetTokens * APPROX_CHARS_PER_TOKEN,
        verbose: true,
      });
    } catch { continue; }
    readMs += r.timings?.totalMs || 0;
    if (r.fellBack) fellBackAny = true;
    if (r.signals?.liRan) liRanAny = true;
    const lineSet = new Set();
    let text = '';
    for (const span of r.spans || []) {
      for (let i = span.startLine; i <= span.endLine; i++) lineSet.add(i);
      text += span.text || '';
    }
    reads.push({ file, lines: lineSet, text });
  }

  const totalMs = +(performance.now() - t0).toFixed(2);
  const discoveryChars = psResult.results.reduce((acc, r) => acc + (r.text || '').length + (r.file || '').length + 8, 0);
  const readChars = reads.reduce((acc, r) => acc + r.text.length, 0);
  // Discovery already returns chunk text; we DO NOT double-count it in the
  // returned context (those chunks are not in returnedContext lines/text).
  // We only count read chars in returned context for token efficiency.
  const totalChars = discoveryChars + readChars;
  return {
    mode: 'sweet-grep-read-semantic', taskId: task.id,
    discovery: {
      ms: discoveryMs,
      hits: psResult.results.length,
      chars: discoveryChars,
      returnedFiles: orderedFiles,
      stats: pickStats(psResult.stats),
    },
    reads: { ms: +readMs.toFixed(2), count: reads.length, totalChars: readChars },
    totalMs, totalChars, approxTokens: Math.ceil(totalChars / APPROX_CHARS_PER_TOKEN),
    returnedContext: reads,
    fellBack: fellBackAny, liRan: liRanAny,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickStats(stats) {
  if (!stats) return null;
  // Keep only fields useful for post-hoc review; drop heavy arrays.
  const keep = ['path', 'totalMatches', 'returnedMatches', 'grepTime_ms',
    'gramLookupTime_ms', 'filesConsidered', 'filesScanned', 'filesSkipped',
    'candidateFilesBeforeFilter', 'candidateFilesAfterFilter',
    'candidateReductionRatio', 'denseGramsTouched', 'sparseGramsTouched',
    'gramFalsePositiveRatio', 'grepStrategy', 'plannerRoute', 'gramSelectivity',
    'nativeGrepUsed', 'rerankTime_ms', 'maxSimCandidates', 'indexedChunks',
    'unindexedMatches', 'total_ms'];
  const out = {};
  for (const k of keep) if (stats[k] !== undefined) out[k] = stats[k];
  return out;
}

const _chunksByFileCache = new Map();
async function loadChunksForFile(ctx, file) {
  const key = `${ctx.repoDir}::${file}`;
  if (_chunksByFileCache.has(key)) return _chunksByFileCache.get(key);
  const { CodebaseRepository } = await import('../../core/infrastructure/codebase-repository.js');
  if (!ctx._codebaseRepo) ctx._codebaseRepo = new CodebaseRepository(path.join(ctx.repoDir, '.sweet-search', 'codebase.db'));
  const rows = ctx._codebaseRepo.getChunksByFilePath(file);
  const chunks = rows.map(row => {
    let meta = {};
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); } catch { /* */ }
    return {
      id: row.id,
      symbol: meta.name ?? meta.symbol ?? null,
      type: meta.type ?? meta.chunk_type ?? null,
      startLine: meta.startLine ?? meta.line_start ?? null,
      endLine: meta.endLine ?? meta.line_end ?? null,
    };
  }).filter(c => c.startLine != null && c.endLine != null);
  chunks.sort((a, b) => a.startLine - b.startLine);
  _chunksByFileCache.set(key, chunks);
  return chunks;
}

function pickOverlappingChunks(chunks, hitLines) {
  // Pick every chunk that contains at least one rg hit. Dedup by chunk id.
  const seen = new Set();
  const out = [];
  for (const line of hitLines) {
    for (const c of chunks) {
      if (c.startLine <= line && c.endLine >= line) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  return out;
}

export const RUNNERS = {
  'native-rg-read': runNativeRgRead,
  'sweet-grep-read': runSweetGrepRead,
  'sweet-grep-read-semantic': runSweetGrepReadSemantic,
};
