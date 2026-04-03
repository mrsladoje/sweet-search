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
import { existsSync, readdirSync } from 'fs';
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
  return relative.replace(/\\/g, '/').replace(/^\.\//, '');
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
    ];

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
      if (code !== 0 && code !== 1) {
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
    });
  }

  const batches = chunkRipgrepFiles(files);
  for (const batch of batches) {
    const batchMatches = await executeRipgrep({
      patterns: [regex],
      searchDir,
      files: batch,
      fixedString,
      globs,
      outputMode: 'json',
      timeout,
    });
    allMatches.push(...batchMatches);
  }
  return allMatches;
}
