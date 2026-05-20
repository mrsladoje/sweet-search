/**
 * Ripgrep Integration Module — binary discovery, capability detection, and execution.
 *
 * Handles finding the ripgrep binary (including Claude Code's embedded multicall
 * binary), detecting --and support, ARG_MAX-safe file batching, and the three
 * core spawn wrappers: executeRipgrep (JSON), runRipgrepFilesWithMatches
 * (files-with-matches), and runRipgrepJson (JSON output).
 *
 * Split from search-pattern.js for the 500-line-limit rule.
 */

import { spawn, execFileSync } from 'child_process';
import { existsSync, realpathSync, readdirSync } from 'fs';
import { StringDecoder } from 'string_decoder';
import path from 'path';
import { RIPGREP_CODE_TYPE_GLOB } from '../infrastructure/constants.js';

// =============================================================================
// Module-level state — ripgrep binary cache and capabilities
// =============================================================================

let _rgCheckPromise = null;
let _rgBinary = null; // Resolved path to rg binary
let _rgCapabilities = null;

const RIPGREP_CODE_TYPE = RIPGREP_CODE_TYPE_GLOB;
const RIPGREP_MAX_BATCH_FILES = 500;
const RIPGREP_MAX_BATCH_ARG_BYTES = 96 * 1024;

// =============================================================================
// Ripgrep detection (race-safe: caches the promise, not just the result)
// =============================================================================

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
  const claudeVersionsDir = path.join(
    process.env.HOME || '', '.local', 'share', 'claude', 'versions'
  );
  // Enumerate available versions instead of hardcoding a specific version
  if (process.env.CLAUDE_VERSION) {
    const versionedBin = path.join(claudeVersionsDir, process.env.CLAUDE_VERSION);
    if (existsSync(versionedBin)) candidates.push(versionedBin);
  } else if (existsSync(claudeVersionsDir)) {
    try {
      const entries = readdirSync(claudeVersionsDir).sort().reverse();
      if (entries.length > 0) {
        candidates.push(path.join(claudeVersionsDir, entries[0]));
      }
    } catch { /* versions dir unreadable */ }
  }

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
export function _resetRgCache() {
  _rgCheckPromise = null;
  _rgBinary = null;
  _rgCapabilities = null;
}

// =============================================================================
// Ripgrep capability detection
// =============================================================================

export function _getRgCapabilities() {
  const rgBin = _findRg();
  if (!rgBin) {
    throw new Error('ripgrep (rg) not found. Install: brew install ripgrep');
  }

  if (_rgCapabilities) return _rgCapabilities;

  try {
    const help = execFileSync(rgBin, ['--help'], {
      stdio: 'pipe',
      timeout: 3000,
      env: { ...process.env, ARGV0: 'rg' },
    }).toString('utf-8');
    _rgCapabilities = {
      supportsAnd: /\s--and\b/.test(help),
    };
  } catch {
    _rgCapabilities = { supportsAnd: false };
  }

  return _rgCapabilities;
}

// =============================================================================
// Path normalization and file batching
// =============================================================================

export function normalizeSearchPath(searchDir, filePath) {
  if (!filePath) return null;
  const relative = path.isAbsolute(filePath)
    ? path.relative(searchDir, filePath)
    : filePath;
  const normalized = normalizeRelativeSearchPath(relative);
  if (normalized) return normalized;
  if (path.isAbsolute(filePath)) {
    try {
      const realRelative = path.relative(
        realpathSync.native(searchDir),
        realpathSync.native(filePath),
      );
      return normalizeRelativeSearchPath(realRelative);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeRelativeSearchPath(relative) {
  const normalized = relative.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return null;
  }
  return normalized;
}

export function chunkRipgrepFiles(files) {
  const batches = [];
  let current = [];
  let currentBytes = 0;

  for (const file of files) {
    const fileBytes = Buffer.byteLength(file) + 1;
    const wouldOverflow =
      current.length >= RIPGREP_MAX_BATCH_FILES ||
      currentBytes + fileBytes > RIPGREP_MAX_BATCH_ARG_BYTES;

    if (wouldOverflow && current.length > 0) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(file);
    currentBytes += fileBytes;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

// =============================================================================
// Ripgrep runner — core spawn wrappers
// =============================================================================

async function executeRipgrep({
  patterns,
  searchDir,
  files = null,
  fixedString = false,
  caseInsensitive = false,
  globs = [],
  outputMode = 'json',
  timeout = 10000,
  useAnd = false,
  maxCount = 0,
  lightweightParse = false,
}) {
  const rgBin = _findRg();
  if (!rgBin) {
    throw new Error('ripgrep (rg) not found. Install: brew install ripgrep');
  }

  const effectivePatterns = Array.isArray(patterns) ? patterns.filter(Boolean) : [patterns].filter(Boolean);
  if (effectivePatterns.length === 0) {
    return outputMode === 'json' ? [] : [];
  }

  return new Promise((resolve, reject) => {
    const args = [
      outputMode === 'json' ? '--json' : '--files-with-matches',
      '--type-add', RIPGREP_CODE_TYPE,
      '--type', 'code',
      // Suppress I/O error messages (e.g. a candidate file deleted during the
      // reconcile window). ripgrep still exits 2 on such errors but stderr
      // stays empty; pattern-syntax errors still surface on stderr.
      '--no-messages',
    ];

    if (maxCount > 0) args.push('--max-count', String(maxCount));
    if (caseInsensitive) args.push('-i');
    for (const glob of globs) {
      if (glob) args.push('--glob', glob);
    }

    if (useAnd && effectivePatterns.length > 1) {
      args.push(fixedString ? '-F' : effectivePatterns[0]);
      if (fixedString) args.push(effectivePatterns[0]);
      for (const pattern of effectivePatterns.slice(1)) {
        args.push('--and');
        if (fixedString) args.push('-F');
        args.push(pattern);
      }
    } else {
      if (fixedString) args.push('-F');
      args.push(effectivePatterns[0]);
    }

    if (Array.isArray(files) && files.length > 0) {
      args.push('--', ...files);
    } else {
      args.push('.');
    }

    const proc = spawn(rgBin, args, {
      cwd: searchDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      env: { ...process.env, ARGV0: 'rg' },
    });

    const stdoutChunks = [];
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdoutChunks.push(chunk); });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('close', (code) => {
      // code 2 with empty stderr = benign I/O error (a candidate file vanished
      // mid-flight under concurrent reconcile); use whatever matched rather
      // than failing the whole query. Real errors (bad regex) keep stderr.
      const benignIoError = code === 2 && stderr.trim() === '';
      if (code !== 0 && code !== 1 && !benignIoError) {
        reject(new Error(`ripgrep failed (code ${code}): ${stderr.slice(0, 200)}`));
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');

      if (outputMode === 'files') {
        const matches = stdout
          .split('\n')
          .map(line => normalizeSearchPath(searchDir, line.trim()))
          .filter(Boolean);
        resolve(matches);
        return;
      }

      const matches = [];
      if (lightweightParse) {
        // Fast path: extract only file + line using indexOf (no JSON.parse).
        // For patternSearch, mapMatchesToChunks only reads .file and .line —
        // skipping JSON.parse saves ~22ms on 20K-match queries (30ms→8ms parse).
        // rg --json key order is stable (serde derive): path.text then line_number.
        const PATH_MARKER = '"path":{"text":"';
        const PATH_MARKER_LEN = PATH_MARKER.length;
        const LN_MARKER = '"line_number":';
        const LN_MARKER_LEN = LN_MARKER.length;
        const MATCH_PREFIX = '{"type":"match"';
        const pathCache = new Map();

        let pos = 0;
        while (pos < stdout.length) {
          const nl = stdout.indexOf('\n', pos);
          const end = nl === -1 ? stdout.length : nl;

          if (end - pos > 40 && stdout.startsWith(MATCH_PREFIX, pos)) {
            const pathIdx = stdout.indexOf(PATH_MARKER, pos + 15);
            if (pathIdx !== -1 && pathIdx < end) {
              const pathStart = pathIdx + PATH_MARKER_LEN;
              const pathEnd = stdout.indexOf('"', pathStart);
              if (pathEnd !== -1 && pathEnd < end) {
                const lnIdx = stdout.indexOf(LN_MARKER, pathEnd);
                if (lnIdx !== -1 && lnIdx < end) {
                  const lnStart = lnIdx + LN_MARKER_LEN;
                  let lnEnd = lnStart;
                  while (lnEnd < end && stdout.charCodeAt(lnEnd) >= 48 && stdout.charCodeAt(lnEnd) <= 57) lnEnd++;
                  if (lnEnd > lnStart) {
                    const rawPath = stdout.substring(pathStart, pathEnd);
                    let file = pathCache.get(rawPath);
                    if (file === undefined) {
                      file = normalizeSearchPath(searchDir, rawPath);
                      pathCache.set(rawPath, file);
                    }
                    if (file) matches.push({ file, line: parseInt(stdout.substring(lnStart, lnEnd), 10) });
                  }
                }
              }
            }
          }
          pos = nl === -1 ? stdout.length : nl + 1;
        }
      } else {
        for (const line of stdout.split('\n')) {
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type !== 'match') continue;
            const file = normalizeSearchPath(searchDir, obj.data?.path?.text);
            const lineNumber = obj.data?.line_number;
            const text = obj.data?.lines?.text?.trimEnd() || '';
            const firstSubmatch = obj.data?.submatches?.[0];
            const column = typeof firstSubmatch?.start === 'number' ? firstSubmatch.start + 1 : null;
            const matchText = firstSubmatch?.match?.text || '';
            if (file && lineNumber != null) {
              matches.push({ file, line: lineNumber, column, matchText, content: text });
            }
          } catch {
            // Skip malformed lines.
          }
        }
      }
      resolve(matches);
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
// Streaming ripgrep JSON — incremental line-by-line parse with early-exit
// =============================================================================

/**
 * Streaming ripgrep JSON executor. Parses rg --json output line-by-line as it
 * arrives on stdout, avoiding the Buffer.concat + toString + split overhead of
 * executeRipgrep. Supports --max-count and an onMatch callback that can kill
 * the rg process for early exit.
 *
 * Uses StringDecoder for correct multi-byte UTF-8 handling across chunk
 * boundaries.
 */
async function executeRipgrepStreaming({
  patterns,
  searchDir,
  files = null,
  fixedString = false,
  caseInsensitive = false,
  globs = [],
  timeout = 10000,
  useAnd = false,
  maxCount = 0,
  onMatch = null,
}) {
  const rgBin = _findRg();
  if (!rgBin) {
    throw new Error('ripgrep (rg) not found. Install: brew install ripgrep');
  }

  const effectivePatterns = Array.isArray(patterns)
    ? patterns.filter(Boolean)
    : [patterns].filter(Boolean);
  if (effectivePatterns.length === 0) return [];

  return new Promise((resolve, reject) => {
    const args = [
      '--json',
      '--type-add', RIPGREP_CODE_TYPE,
      '--type', 'code',
      // Suppress I/O error messages (e.g. a candidate file deleted during the
      // reconcile window). ripgrep still exits 2 on such errors but stderr
      // stays empty; pattern-syntax errors still surface on stderr.
      '--no-messages',
    ];

    if (maxCount > 0) args.push('--max-count', String(maxCount));
    if (caseInsensitive) args.push('-i');
    for (const glob of globs) {
      if (glob) args.push('--glob', glob);
    }

    if (useAnd && effectivePatterns.length > 1) {
      args.push(fixedString ? '-F' : effectivePatterns[0]);
      if (fixedString) args.push(effectivePatterns[0]);
      for (const pattern of effectivePatterns.slice(1)) {
        args.push('--and');
        if (fixedString) args.push('-F');
        args.push(pattern);
      }
    } else {
      if (fixedString) args.push('-F');
      args.push(effectivePatterns[0]);
    }

    if (Array.isArray(files) && files.length > 0) {
      args.push('--', ...files);
    } else {
      args.push('.');
    }

    const proc = spawn(rgBin, args, {
      cwd: searchDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      env: { ...process.env, ARGV0: 'rg' },
    });

    const matches = [];
    let killed = false;
    const decoder = new StringDecoder('utf-8');
    let partial = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      if (killed) return;

      partial += decoder.write(chunk);
      const lines = partial.split('\n');
      partial = lines.pop() || '';

      for (const line of lines) {
        if (!line || killed) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type !== 'match') continue;
          const file = normalizeSearchPath(searchDir, obj.data?.path?.text);
          const lineNumber = obj.data?.line_number;
          const text = obj.data?.lines?.text?.trimEnd() || '';
          const firstSubmatch = obj.data?.submatches?.[0];
          const column = typeof firstSubmatch?.start === 'number'
            ? firstSubmatch.start + 1
            : null;
          const matchText = firstSubmatch?.match?.text || '';
          if (file && lineNumber != null) {
            const match = { file, line: lineNumber, column, matchText, content: text };
            matches.push(match);
            if (onMatch && onMatch(match) === false) {
              killed = true;
              proc.kill('SIGTERM');
              return;
            }
          }
        } catch {
          // Skip malformed lines.
        }
      }
    });

    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('close', (code) => {
      if (!killed) {
        // Flush decoder and process any remaining partial line
        partial += decoder.end();
        if (partial) {
          try {
            const obj = JSON.parse(partial);
            if (obj.type === 'match') {
              const file = normalizeSearchPath(searchDir, obj.data?.path?.text);
              const lineNumber = obj.data?.line_number;
              const text = obj.data?.lines?.text?.trimEnd() || '';
              const firstSubmatch = obj.data?.submatches?.[0];
              const column = typeof firstSubmatch?.start === 'number'
                ? firstSubmatch.start + 1
                : null;
              const matchText = firstSubmatch?.match?.text || '';
              if (file && lineNumber != null) {
                matches.push({ file, line: lineNumber, column, matchText, content: text });
              }
            }
          } catch { /* ignore */ }
        }
      }

      // code 2 with empty stderr = benign I/O error (a candidate file vanished
      // mid-flight under concurrent reconcile); resolve with what matched.
      const benignIoError = code === 2 && stderr.trim() === '';
      if (killed || code === 0 || code === 1 || benignIoError) {
        resolve(matches);
        return;
      }
      reject(new Error(`ripgrep failed (code ${code}): ${stderr.slice(0, 200)}`));
    });

    proc.on('error', (err) => {
      if (killed) {
        resolve(matches);
      } else if (err.code === 'ENOENT') {
        reject(new Error('ripgrep (rg) not found. Install: brew install ripgrep'));
      } else {
        reject(err);
      }
    });
  });
}

export async function runRipgrepFilesWithMatches(patterns, searchDir, opts = {}) {
  const {
    files = null,
    fixedString = false,
    caseInsensitive = false,
    globs = [],
    timeout = 10000,
    useAnd = false,
  } = opts;

  if (Array.isArray(files) && files.length === 0) return [];

  if (!Array.isArray(files)) {
    return executeRipgrep({
      patterns,
      searchDir,
      files: null,
      fixedString,
      caseInsensitive,
      globs,
      outputMode: 'files',
      timeout,
      useAnd,
    });
  }

  const batches = chunkRipgrepFiles(files);
  const batchResults = await Promise.all(batches.map(batch =>
    executeRipgrep({
      patterns,
      searchDir,
      files: batch,
      fixedString,
      caseInsensitive,
      globs,
      outputMode: 'files',
      timeout,
      useAnd,
    })
  ));
  const matched = new Set();
  for (const batchMatches of batchResults) {
    for (const file of batchMatches) matched.add(file);
  }

  return [...matched];
}

export async function runRipgrepJson(regex, searchDir, opts = {}) {
  const {
    files = null,
    fixedString = false,
    globs = [],
    timeout = 10000,
    lightweightParse = false,
  } = opts;

  if (Array.isArray(files) && files.length === 0) return [];

  const allMatches = [];
  if (!Array.isArray(files)) {
    return executeRipgrep({
      patterns: [regex],
      searchDir,
      files: null,
      fixedString,
      globs,
      outputMode: 'json',
      timeout,
      lightweightParse,
    });
  }

  const batches = chunkRipgrepFiles(files);
  const batchResults = await Promise.all(batches.map(batch =>
    executeRipgrep({
      patterns: [regex],
      searchDir,
      files: batch,
      fixedString,
      globs,
      outputMode: 'json',
      timeout,
      lightweightParse,
    })
  ));
  for (const batchMatches of batchResults) {
    allMatches.push(...batchMatches);
  }
  return allMatches;
}

// =============================================================================
// Streaming ripgrep JSON — parallel batches with early-exit support
// =============================================================================

/**
 * Streaming variant of runRipgrepJson. Parses rg output incrementally and
 * supports an onMatch callback for early-exit. Batches run in parallel
 * (unlike the original sequential loop in runRipgrepJson).
 *
 * @param {string} regex - Regex pattern
 * @param {string} searchDir - Directory to search
 * @param {Object} opts
 * @param {string[]|null} opts.files - Explicit file list
 * @param {boolean} opts.fixedString - Use -F mode
 * @param {string[]} opts.globs - Glob filters
 * @param {number} opts.timeout - Spawn timeout
 * @param {number} opts.maxCount - --max-count per file (0 = unlimited)
 * @param {function|null} opts.onMatch - Per-match callback; return false to kill rg
 * @returns {Promise<Array<{file, line, column, matchText, content}>>}
 */
export async function runRipgrepJsonStreaming(regex, searchDir, opts = {}) {
  const {
    files = null,
    fixedString = false,
    globs = [],
    timeout = 10000,
    maxCount = 0,
    onMatch = null,
  } = opts;

  if (Array.isArray(files) && files.length === 0) return [];

  if (!Array.isArray(files)) {
    return executeRipgrepStreaming({
      patterns: [regex],
      searchDir,
      files: null,
      fixedString,
      globs,
      timeout,
      maxCount,
      onMatch,
    });
  }

  const batches = chunkRipgrepFiles(files);

  // Shared stop flag: when one batch triggers early-exit, stop all batches.
  let stopped = false;
  const sharedOnMatch = onMatch ? (match) => {
    if (stopped) return false;
    const result = onMatch(match);
    if (result === false) {
      stopped = true;
      return false;
    }
    return result;
  } : null;

  const batchResults = await Promise.all(batches.map(batch =>
    executeRipgrepStreaming({
      patterns: [regex],
      searchDir,
      files: batch,
      fixedString,
      globs,
      timeout,
      maxCount,
      onMatch: sharedOnMatch,
    })
  ));

  const allMatches = [];
  for (const batchMatches of batchResults) {
    allMatches.push(...batchMatches);
  }
  return allMatches;
}
