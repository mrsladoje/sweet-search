/**
 * Pattern Search Module — ColGrep-style hybrid regex + semantic ranking.
 *
 * Pipeline:
 *   1. parallel(ripgrep scan, encodeQuery)
 *   2. Map file:line matches → indexed chunk IDs via interval map
 *   3. MaxSim rerank using pre-indexed late interaction token embeddings
 *   4. Assemble results with file content
 *
 * Extracted module — functions using `this` are wired onto SweetSearch.prototype.
 *
 * References: docs/COLGREP_PLAN.md
 */

import { spawn, execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './config.js';

// =============================================================================
// Ripgrep detection (race-safe: caches the promise, not just the result)
// =============================================================================

let _rgCheckPromise = null;
let _rgBinary = null; // Resolved path to rg binary

/**
 * Find the ripgrep binary. Tries:
 *   1. 'rg' on PATH (direct spawn)
 *   2. Known multicall binary locations (Claude Code embeds rg)
 *   3. Common install paths (/opt/homebrew/bin/rg, /usr/local/bin/rg)
 *
 * Caches the result. Returns the binary path or null.
 */
function _findRg() {
  if (_rgBinary !== null) return _rgBinary || null;

  const candidates = [
    'rg', // Direct PATH
  ];

  // Claude Code multicall binary: ARGV0=rg makes it act as ripgrep
  const claudeBin = path.join(
    process.env.HOME || '', '.local', 'share', 'claude', 'versions',
    process.env.CLAUDE_VERSION || '2.1.81'
  );
  if (existsSync(claudeBin)) candidates.push(claudeBin);

  // Common homebrew / system paths
  candidates.push('/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg');

  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'pipe', timeout: 3000, env: { ...process.env, ARGV0: 'rg' } });
      _rgBinary = bin;
      return bin;
    } catch {
      // Try next
    }
  }

  _rgBinary = '';
  return null;
}

/**
 * Check if ripgrep (rg) is installed and available.
 * Concurrent callers share a single probe — no duplicate spawns.
 */
export function isRipgrepAvailable() {
  if (_rgCheckPromise) return _rgCheckPromise;
  _rgCheckPromise = Promise.resolve(_findRg() !== null);
  return _rgCheckPromise;
}

/** Reset cached availability (for testing). */
export function _resetRgCache() { _rgCheckPromise = null; _rgBinary = null; }

// =============================================================================
// Ripgrep runner — uses --json for reliable parsing, global match cap
// =============================================================================

/**
 * Run ripgrep with a regex pattern against a directory.
 * Uses --json output to avoid colon-delimiter parsing issues with
 * paths containing colons (Windows, exotic filenames).
 * Enforces a global match cap via line counting (--max-count is per-file).
 *
 * @param {string} regex - The regex pattern to search for
 * @param {string} searchDir - Directory to search in
 * @param {Object} [opts] - Options
 * @param {number} [opts.maxMatches=1000] - Global maximum number of matching lines (0 disables the cap)
 * @param {number} [opts.timeout=10000] - Timeout in ms
 * @returns {Promise<Array<{file: string, line: number, content: string}>>}
 */
export async function runRipgrep(regex, searchDir, opts = {}) {
  const { maxMatches = 1000, timeout = 10000 } = opts;

  const rgBin = _findRg();
  if (!rgBin) {
    throw new Error('ripgrep (rg) not found. Install: brew install ripgrep');
  }

  return new Promise((resolve, reject) => {
    const args = [
      '--json',
      '--type-add', 'code:*.{js,ts,jsx,tsx,py,rs,go,java,c,cpp,h,hpp,cs,rb,php,swift,kt,scala,lua,sh,zig,hs,ml,ex,exs,clj,erl,r,jl,dart,v,nim,cr,d,f90,ada,pas,cob,pl,pm,sql,graphql,proto,yaml,yml,json,toml,xml,html,css,scss,sass,less,svelte,vue,astro,mdx}',
      '--type', 'code',
      regex,
      searchDir,
    ];

    // For multicall binaries (e.g. Claude Code), ARGV0=rg tells it to act as ripgrep
    const proc = spawn(rgBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      env: { ...process.env, ARGV0: 'rg' },
    });

    const matches = [];
    let remainder = '';
    let killed = false;

    proc.stdout.on('data', (chunk) => {
      if (killed) return;

      // Stream-parse JSON lines, enforcing global match cap
      remainder += chunk;
      let nlIdx;
      while ((nlIdx = remainder.indexOf('\n')) !== -1) {
        const line = remainder.slice(0, nlIdx);
        remainder = remainder.slice(nlIdx + 1);

        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'match') {
            const filePath = obj.data?.path?.text;
            const lineNumber = obj.data?.line_number;
            const text = obj.data?.lines?.text?.trimEnd();
            if (filePath && lineNumber != null) {
              const file = path.isAbsolute(filePath)
                ? path.relative(searchDir, filePath)
                : filePath;
              matches.push({ file, line: lineNumber, content: text || '' });
            }

            if (maxMatches > 0 && matches.length >= maxMatches) {
              killed = true;
              proc.kill('SIGTERM');
              return;
            }
          }
        } catch {
          // Malformed JSON line — skip
        }
      }
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      // ripgrep returns 1 for "no matches", null/SIGTERM when we killed it
      if (killed || code === null || code === 0 || code === 1) {
        resolve(matches);
        return;
      }
      reject(new Error(`ripgrep failed (code ${code}): ${stderr.slice(0, 200)}`));
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('ripgrep (rg) not found. Install: brew install ripgrep'));
      } else {
        reject(err);
      }
    });
  });
}

// =============================================================================
// Chunk location map — maps file:line → chunk IDs
// =============================================================================

/**
 * Build a sorted interval map from late interaction index metadata.
 * Used for O(log n) lookup of which indexed chunk contains a given file:line.
 *
 * @param {import('./late-interaction-index.js').LateInteractionIndex} liIndex
 * @returns {Map<string, Array<{startLine: number, endLine: number, id: string}>>}
 */
export function buildChunkLocationMap(liIndex) {
  const map = new Map();

  for (const [id, doc] of liIndex.documents) {
    const meta = doc.metadata;
    if (!meta?.file || meta.startLine == null || meta.endLine == null) continue;

    let bucket = map.get(meta.file);
    if (!bucket) {
      bucket = [];
      map.set(meta.file, bucket);
    }
    bucket.push({ startLine: meta.startLine, endLine: meta.endLine, id });
  }

  // Sort each file's intervals by startLine for binary search
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.startLine - b.startLine);
  }

  return map;
}

/**
 * Binary search for the chunk whose [startLine, endLine] contains `lineNumber`.
 *
 * @param {Array<{startLine: number, endLine: number, id: string}>|undefined} intervals
 * @param {number} lineNumber
 * @returns {string|null} chunk ID or null
 */
export function findChunkForLine(intervals, lineNumber) {
  if (!intervals || intervals.length === 0) return null;

  let lo = 0;
  let hi = intervals.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const iv = intervals[mid];

    if (lineNumber < iv.startLine) {
      hi = mid - 1;
    } else if (lineNumber > iv.endLine) {
      lo = mid + 1;
    } else {
      return iv.id;
    }
  }

  return null;
}

/**
 * Map ripgrep matches to indexed chunk IDs.
 *
 * @param {Array<{file: string, line: number, content: string}>} matches
 * @param {Map} locationMap - Output of buildChunkLocationMap
 * @returns {{ chunkIds: Set<string>, unindexed: Array }}
 */
export function mapMatchesToChunks(matches, locationMap) {
  const chunkIds = new Set();
  const unindexed = [];

  for (const match of matches) {
    const intervals = locationMap.get(match.file);
    if (intervals) {
      const id = findChunkForLine(intervals, match.line);
      if (id) {
        chunkIds.add(id);
      } else {
        unindexed.push(match);
      }
    } else {
      unindexed.push(match);
    }
  }

  return { chunkIds, unindexed };
}

// =============================================================================
// File content loader (per-search cache to avoid re-reading the same file)
// =============================================================================

/**
 * Read a range of lines from a file (1-indexed, inclusive).
 * Uses a per-search fileCache to avoid re-reading the same file for
 * multiple results.
 *
 * @param {Map<string, string[]>} fileCache - Map<absPath, lines[]>
 * @param {string} filePath - Relative or absolute path
 * @param {number} startLine - 1-indexed start
 * @param {number} endLine - 1-indexed end (inclusive)
 * @returns {string|null}
 */
export function readFileRange(fileCache, filePath, startLine, endLine) {
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
    let lines = fileCache.get(abs);
    if (!lines) {
      lines = readFileSync(abs, 'utf-8').split('\n');
      fileCache.set(abs, lines);
    }
    return lines.slice((startLine || 1) - 1, endLine || startLine).join('\n');
  } catch {
    return null;
  }
}

// =============================================================================
// Lazy chunk location map initialization (wired onto SweetSearch.prototype)
// =============================================================================

/**
 * Get or build the chunk location map. Cached on this._chunkLocationMap.
 * Rebuilds only when the LI index document count changes (re-index).
 */
export function getChunkLocationMap() {
  const currentSize = this.lateInteractionIndex.documents.size;
  if (this._chunkLocationMap && this._chunkLocationMapSize === currentSize) {
    return this._chunkLocationMap;
  }
  this._chunkLocationMap = buildChunkLocationMap(this.lateInteractionIndex);
  this._chunkLocationMapSize = currentSize;
  return this._chunkLocationMap;
}

// =============================================================================
// Pattern search orchestrator (wired onto SweetSearch.prototype)
// =============================================================================

/**
 * Pattern search: regex candidate generation + MaxSim semantic ranking.
 *
 * Uses `this` — must be wired onto SweetSearch.prototype.
 *
 * @param {string} query - Semantic query for ranking
 * @param {Object} routing - Routing info (unused for pattern, kept for interface parity)
 * @param {Object} options - Search options
 * @param {string} options.regex - Regex pattern for candidate generation (required)
 * @param {number} [options.k=10] - Number of results
 * @returns {Promise<{results: Array, stats: Object}>}
 */
export async function patternSearch(query, routing, options = {}) {
  const {
    regex,
    k = 10,
  } = options;

  if (!regex) {
    throw new Error('Pattern search requires a regex. Use --regex or -e to specify one.');
  }

  const start = performance.now();
  const log = this.verbose ? (...args) => console.error('[Pattern]', ...args) : () => {};

  // Check cheap local prerequisites first, then async external ones
  if (!this.hasLateInteractionIndex) {
    throw new Error('Pattern search requires a late interaction index. Re-index with late interaction enabled.');
  }

  if (!await isRipgrepAvailable()) {
    throw new Error('Pattern search requires ripgrep (rg). Install: brew install ripgrep');
  }

  await this.lateInteractionIndex.init();

  // Get cached chunk location map (built once, reused across queries)
  const mapStart = performance.now();
  const locationMap = this.getChunkLocationMap();
  const mapTime = performance.now() - mapStart;
  if (this.lateInteractionIndex.documents.size > 0 && locationMap.size === 0) {
    throw new Error(
      'Pattern search requires a late interaction index with line spans. Re-index with late interaction enabled.'
    );
  }
  log(`Chunk location map: ${locationMap.size} files in ${mapTime.toFixed(1)}ms`);

  // Parallel: ripgrep scan + query encode
  const { encodeQuery } = await import('./late-interaction-model.js');
  const searchDir = PROJECT_ROOT;

  const parallelStart = performance.now();
  const [grepMatches, queryTokens] = await Promise.all([
    runRipgrep(regex, searchDir),
    encodeQuery(query),
  ]);
  const parallelTime = performance.now() - parallelStart;
  log(`Parallel phase: ${grepMatches.length} grep matches, ${queryTokens.length} query tokens in ${parallelTime.toFixed(1)}ms`);

  if (grepMatches.length === 0) {
    return {
      results: [],
      stats: {
        path: 'pattern',
        regex,
        grepMatches: 0,
        indexedChunks: 0,
        unindexedMatches: 0,
        parallelTime_ms: Math.round(parallelTime),
        total_ms: Math.round(performance.now() - start),
      },
    };
  }

  // Map file:line matches → indexed chunk IDs
  const { chunkIds, unindexed } = mapMatchesToChunks(grepMatches, locationMap);
  log(`Mapped: ${chunkIds.size} indexed chunks, ${unindexed.length} unindexed matches`);

  // Filter to chunks with token embeddings in the LI index
  const available = this.lateInteractionIndex.hasTokens(chunkIds);
  log(`LI index hits: ${available.size}/${chunkIds.size}`);

  // MaxSim rerank
  let scored = [];
  let rerankTime = 0;
  if (available.size > 0 && queryTokens.length > 0) {
    const candidates = [...available].map(id => ({ id }));
    const rerankStart = performance.now();
    scored = await this.lateInteractionIndex.scoreWithLateInteraction(queryTokens, candidates);
    rerankTime = performance.now() - rerankStart;
    log(`MaxSim rerank: ${scored.length} candidates in ${rerankTime.toFixed(1)}ms`);
  }

  // Build result objects with metadata + file content (per-search file cache)
  const fileCache = new Map();

  const results = scored.slice(0, k).map((s, rank) => {
    const doc = this.lateInteractionIndex.documents.get(s.id);
    const meta = doc?.metadata || {};
    const text = readFileRange(fileCache, meta.file, meta.startLine, meta.endLine);

    return {
      id: s.id,
      file: meta.file || '',
      name: meta.name || null,
      type: meta.type || 'code',
      startLine: meta.startLine || null,
      endLine: meta.endLine || null,
      text: text || '',
      content: text || '',
      score: s.lateInteractionScore,
      lateInteractionScore: s.lateInteractionScore,
      rank: rank + 1,
      indexed: true,
      searchPath: 'pattern',
      metadata: meta,
    };
  });

  // Append unindexed matches at the bottom (lazy fallback — Plan Phase 3)
  const remaining = Math.max(0, k - results.length);
  if (remaining > 0 && unindexed.length > 0) {
    const seen = new Set(results.map(r => `${r.file}:${r.startLine}`));
    let added = 0;
    for (const m of unindexed) {
      if (added >= remaining) break;
      const key = `${m.file}:${m.line}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        id: `unindexed:${m.file}:${m.line}`,
        file: m.file,
        name: null,
        type: 'code',
        startLine: m.line,
        endLine: m.line,
        text: m.content,
        content: m.content,
        score: 0,
        lateInteractionScore: 0,
        rank: results.length + 1,
        indexed: false,
        searchPath: 'pattern',
        metadata: { file: m.file, startLine: m.line, endLine: m.line },
      });
      added++;
    }
  }

  const totalTime = performance.now() - start;

  return {
    results,
    stats: {
      path: 'pattern',
      regex,
      grepMatches: grepMatches.length,
      indexedChunks: available.size,
      unindexedMatches: unindexed.length,
      maxSimCandidates: scored.length,
      locationMapFiles: locationMap.size,
      mapTime_ms: Math.round(mapTime),
      parallelTime_ms: Math.round(parallelTime),
      rerankTime_ms: Math.round(rerankTime),
      total_ms: Math.round(totalTime),
    },
  };
}
