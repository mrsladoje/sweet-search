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
import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import {
  extractRegexLiteralClauses,
  loadSparseGramIndex,
  resolveSparseSymbolMask,
} from '../infrastructure/native-sparse-gram.js';

// =============================================================================
// Ripgrep detection (race-safe: caches the promise, not just the result)
// =============================================================================

let _rgCheckPromise = null;
let _rgBinary = null; // Resolved path to rg binary
let _rgCapabilities = null;

const RIPGREP_CODE_TYPE =
  'code:*.{js,ts,jsx,tsx,py,rs,go,java,c,cpp,h,hpp,cs,rb,php,swift,kt,scala,lua,sh,zig,hs,ml,ex,exs,clj,erl,r,jl,dart,v,nim,cr,d,f90,ada,pas,cob,pl,pm,sql,graphql,proto,yaml,yml,json,toml,xml,html,css,scss,sass,less,svelte,vue,astro,mdx}';
const RIPGREP_MAX_BATCH_FILES = 500;
const RIPGREP_MAX_BATCH_ARG_BYTES = 96 * 1024;
const RIPGREP_CODE_EXTENSIONS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'lua', 'sh', 'zig', 'hs', 'ml',
  'ex', 'exs', 'clj', 'erl', 'r', 'jl', 'dart', 'v', 'nim', 'cr', 'd', 'f90',
  'ada', 'pas', 'cob', 'pl', 'pm', 'sql', 'graphql', 'proto', 'yaml', 'yml',
  'json', 'toml', 'xml', 'html', 'css', 'scss', 'sass', 'less', 'svelte',
  'vue', 'astro', 'mdx',
]);

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
export function _resetRgCache() {
  _rgCheckPromise = null;
  _rgBinary = null;
  _rgCapabilities = null;
}

// =============================================================================
// Ripgrep runner — two-pass file discovery + JSON verification
// =============================================================================

function _getRgCapabilities() {
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

function normalizeSearchPath(searchDir, filePath) {
  if (!filePath) return null;
  const relative = path.isAbsolute(filePath)
    ? path.relative(searchDir, filePath)
    : filePath;
  return relative.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeLiteralClauses(clauses) {
  if (!Array.isArray(clauses)) return [];

  const normalized = [];
  for (const clause of clauses) {
    if (!Array.isArray(clause)) continue;
    const deduped = [];
    for (const literal of clause) {
      if (typeof literal !== 'string') continue;
      const trimmed = literal.trim();
      if (trimmed.length < 3 || deduped.includes(trimmed)) continue;
      deduped.push(trimmed);
    }
    if (deduped.length === 0) continue;
    if (!normalized.some(existing => existing.length === deduped.length && existing.every((value, idx) => value === deduped[idx]))) {
      normalized.push(deduped);
    }
  }

  return normalized;
}

function isRipgrepCodePath(filePath) {
  const ext = path.extname(filePath || '').slice(1).toLowerCase();
  return RIPGREP_CODE_EXTENSIONS.has(ext);
}

function normalizeSearchSymbolType(symbolType) {
  if (typeof symbolType !== 'string') return null;
  const normalized = symbolType.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('function')) return 'function';
  if (normalized.includes('method')) return 'method';
  if (normalized.includes('class')) return 'class';
  if (normalized.includes('import')) return 'import';
  if (
    normalized.includes('type') ||
    normalized.includes('interface') ||
    normalized.includes('enum') ||
    normalized.includes('typedef')
  ) {
    return 'type';
  }
  return 'other';
}

function resolveSearchSymbolFilter(options = {}) {
  return normalizeSearchSymbolType(options.symbolType || options.type || '');
}

function chunkRipgrepFiles(files) {
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
      args.push(...files);
    } else {
      args.push('.');
    }

    const proc = spawn(rgBin, args, {
      cwd: searchDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      env: { ...process.env, ARGV0: 'rg' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`ripgrep failed (code ${code}): ${stderr.slice(0, 200)}`));
        return;
      }

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

async function runRipgrepFilesWithMatches(patterns, searchDir, opts = {}) {
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
  const matched = new Set();
  for (const batch of batches) {
    const batchMatches = await executeRipgrep({
      patterns,
      searchDir,
      files: batch,
      fixedString,
      caseInsensitive,
      globs,
      outputMode: 'files',
      timeout,
      useAnd,
    });
    for (const file of batchMatches) matched.add(file);
  }

  return [...matched];
}

async function runRipgrepJson(regex, searchDir, opts = {}) {
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

function hasCaseInsensitiveRegexFlag(regex) {
  return /\(\?[a-z-]*i[a-z-]*:?/.test(regex);
}

export function extractRequiredLiteralsHeuristic(regex) {
  if (!regex || typeof regex !== 'string') return [];

  let inClass = false;
  let escape = false;
  let current = '';
  const literals = [];

  const pushCurrent = () => {
    if (current.length >= 3) literals.push(current);
    current = '';
  };

  for (const char of regex) {
    if (escape) {
      if (/[\w/-]/.test(char)) {
        current += char;
      } else {
        pushCurrent();
      }
      escape = false;
      continue;
    }

    if (char === '\\') {
      pushCurrent();
      escape = true;
      continue;
    }

    if (inClass) {
      if (char === ']') inClass = false;
      pushCurrent();
      continue;
    }

    if (char === '[') {
      inClass = true;
      pushCurrent();
      continue;
    }

    if (char === '|') {
      return [];
    }

    if (/[.*+?^${}()]/.test(char)) {
      pushCurrent();
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();

  return [...new Set(literals)];
}

export function extractLiteralClausesHeuristic(regex) {
  const literals = extractRequiredLiteralsHeuristic(regex);
  return literals.length > 0 ? [literals] : [];
}

export function extractLiteralClauses(regex, options = {}) {
  if (!regex || typeof regex !== 'string') {
    return { clauses: [], source: 'none' };
  }

  if (!options.forceHeuristic) {
    try {
      const nativeResult = extractRegexLiteralClauses(regex);
      const nativeClauses = normalizeLiteralClauses(nativeResult?.clauses);
      if (nativeClauses.length > 0) {
        return { clauses: nativeClauses, source: 'native' };
      }
    } catch {
      // Fall back to heuristic extraction below.
    }
  }

  const heuristicClauses = extractLiteralClausesHeuristic(regex);
  if (heuristicClauses.length > 0) {
    return { clauses: heuristicClauses, source: 'heuristic' };
  }

  return { clauses: [], source: 'none' };
}

async function runLiteralPrefilter(literals, searchDir, files = null, opts = {}) {
  if (!Array.isArray(literals) || literals.length === 0) {
    return Array.isArray(files) ? [...files] : null;
  }

  const caseInsensitive = opts.caseInsensitive ?? false;
  const timeout = opts.timeout ?? 10000;
  const globs = opts.globs ?? [];
  const { supportsAnd } = _getRgCapabilities();

  if (supportsAnd && literals.length > 1) {
    return runRipgrepFilesWithMatches(literals, searchDir, {
      files,
      fixedString: true,
      caseInsensitive,
      globs,
      timeout,
      useAnd: true,
    });
  }

  let currentFiles = files;
  for (const literal of literals) {
    currentFiles = await runRipgrepFilesWithMatches(literal, searchDir, {
      files: currentFiles,
      fixedString: true,
      caseInsensitive,
      globs,
      timeout,
    });
    if (Array.isArray(currentFiles) && currentFiles.length === 0) {
      break;
    }
  }

  return currentFiles;
}

async function runLiteralPrefilterClauses(clauses, searchDir, files = null, opts = {}) {
  if (!Array.isArray(clauses) || clauses.length === 0) {
    return Array.isArray(files) ? [...files] : null;
  }

  const combined = new Set();
  for (const clause of clauses) {
    if (!Array.isArray(clause) || clause.length === 0) {
      return Array.isArray(files) ? [...files] : null;
    }
    const clauseMatches = await runLiteralPrefilter(clause, searchDir, files, opts);
    if (!Array.isArray(clauseMatches)) {
      return null;
    }
    for (const file of clauseMatches) combined.add(file);
  }

  return [...combined];
}

function ensureSparseGramIndex(searcher, options = {}) {
  if (!searcher) return null;
  if (searcher.sparseGramIndex) return searcher.sparseGramIndex;

  const indexPath = options.sparseGramIndexPath || searcher.sparseGramIndexPath || DB_PATHS.sparseGramIndex;
  const loaded = loadSparseGramIndex(indexPath);
  if (loaded) {
    searcher.sparseGramIndex = loaded;
  }
  return loaded;
}

export function querySparseGramCandidates(searcher, literalClauses, options = {}) {
  const useGramIndex = options.useGramIndex ?? options.gramIndex ?? true;
  if (!useGramIndex) {
    return {
      eligible: false,
      reason: 'disabled',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }
  if (!Array.isArray(literalClauses) || literalClauses.length === 0) {
    return {
      eligible: false,
      reason: 'not_eligible',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }

  try {
    const sparseGramIndex = ensureSparseGramIndex(searcher, options);
    if (!sparseGramIndex) {
      return {
        eligible: false,
        reason: 'not_loaded',
        totalFiles: 0,
        gramsUsed: 0,
        denseGramsTouched: 0,
        sparseGramsTouched: 0,
        candidateFiles: 0,
        files: null,
      };
    }

    const maxCandidateFiles = options.maxGramCandidateFiles ?? 512;
    const maxCandidateRatio = options.maxGramCandidateRatio ?? 0.05;
    const symbolMask = resolveSparseSymbolMask(resolveSearchSymbolFilter(options));
    const combined = new Set();
    let totalFiles = 0;
    let gramsUsed = 0;
    let denseGramsTouched = 0;
    let sparseGramsTouched = 0;

    for (const clause of literalClauses) {
      if (!Array.isArray(clause) || clause.length === 0) {
        return {
          eligible: false,
          reason: 'not_eligible',
          totalFiles,
          gramsUsed,
          denseGramsTouched,
          sparseGramsTouched,
          candidateFiles: 0,
          files: null,
        };
      }
      const result = sparseGramIndex.queryLiterals(
        clause,
        options.maxGramCandidates ?? 0,
        symbolMask || 0
      );
      if (!result?.eligible) {
        return {
          eligible: false,
          reason: 'not_eligible',
          totalFiles: Math.max(totalFiles, result?.totalFiles || 0),
          gramsUsed: gramsUsed + (result?.gramsUsed || 0),
          denseGramsTouched: denseGramsTouched + (result?.denseGramsTouched || 0),
          sparseGramsTouched: sparseGramsTouched + (result?.sparseGramsTouched || 0),
          candidateFiles: Array.isArray(result?.files) ? result.files.length : 0,
          files: null,
        };
      }
      totalFiles = Math.max(totalFiles, result.totalFiles || 0);
      gramsUsed += result.gramsUsed || 0;
      denseGramsTouched += result.denseGramsTouched || 0;
      sparseGramsTouched += result.sparseGramsTouched || 0;
      const clauseFiles = Array.isArray(result.files)
        ? result.files.filter(isRipgrepCodePath)
        : [];
      if (
        clauseFiles.length === 0 ||
        clauseFiles.length > maxCandidateFiles ||
        (result.totalFiles > 0 && (clauseFiles.length / result.totalFiles) > maxCandidateRatio)
      ) {
        return {
          eligible: false,
          reason: 'too_broad',
          totalFiles,
          gramsUsed,
          denseGramsTouched,
          sparseGramsTouched,
          candidateFiles: clauseFiles.length,
          files: null,
        };
      }
      for (const file of clauseFiles) combined.add(file);
    }

    const files = [...combined];
    if (
      files.length === 0 ||
      files.length > maxCandidateFiles ||
      (totalFiles > 0 && (files.length / totalFiles) > maxCandidateRatio)
    ) {
      return {
        eligible: false,
        reason: 'too_broad',
        totalFiles,
        gramsUsed,
        denseGramsTouched,
        sparseGramsTouched,
        candidateFiles: files.length,
        files: null,
      };
    }

    return {
      eligible: true,
      reason: 'ok',
      totalFiles,
      gramsUsed,
      denseGramsTouched,
      sparseGramsTouched,
      candidateFiles: files.length,
      files,
    };
  } catch {
    return {
      eligible: false,
      reason: 'error',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }
}

async function generateRegexMatches(searcher, regex, searchDir, options = {}) {
  const start = performance.now();
  const useLiteralFilter = options.useLiteralFilter ?? options.literalFilter ?? true;
  const caseInsensitive = hasCaseInsensitiveRegexFlag(regex);
  const fixedString = options.fixedString ?? false;
  const globs = options.globs ?? [];
  const literalPlan = useLiteralFilter ? extractLiteralClauses(regex, options) : { clauses: [], source: 'none' };
  const symbolTypeFilter = resolveSearchSymbolFilter(options);
  let searchFiles = null;
  let gramLookupTime = 0;
  let gramLookupResult = null;

  if (literalPlan.clauses.length > 0) {
    const gramStart = performance.now();
    gramLookupResult = querySparseGramCandidates(searcher, literalPlan.clauses, options);
    gramLookupTime = performance.now() - gramStart;
    if (Array.isArray(gramLookupResult?.files)) {
      searchFiles = gramLookupResult.files;
    }
  }

  const candidateFilesBeforeFilter = Array.isArray(searchFiles) ? searchFiles.length : 0;
  let candidateFilesAfterFilter = Array.isArray(searchFiles) ? searchFiles.length : 0;
  let literalFilterTime = 0;
  let filteredFiles = searchFiles;
  const usingGramCandidates = Array.isArray(searchFiles);
  const gramTooBroad = gramLookupResult?.eligible === false && gramLookupResult?.reason === 'too_broad';
  let grepStrategy = 'two_pass';

  // Literal prefilter: run when the gram index didn't already narrow the set.
  // After running, discard the file list if it didn't meaningfully narrow —
  // passing thousands of explicit file paths via batched spawns is far slower
  // than a single `rg .` invocation.
  const literalNarrowMaxFiles = options.literalNarrowMaxFiles ?? 500;
  const literalNarrowMaxRatio = options.literalNarrowMaxRatio ?? 0.15;
  let prefilterDiscarded = false;
  let prefilterDiscardedCount = 0;

  if (literalPlan.clauses.length > 0 && !usingGramCandidates && !gramTooBroad) {
    const literalStart = performance.now();
    filteredFiles = await runLiteralPrefilterClauses(literalPlan.clauses, searchDir, searchFiles, {
      caseInsensitive,
      globs,
    });
    literalFilterTime = performance.now() - literalStart;
    candidateFilesAfterFilter = Array.isArray(filteredFiles) ? filteredFiles.length : candidateFilesAfterFilter;

    if (Array.isArray(filteredFiles)) {
      const totalCorpusFiles = gramLookupResult?.totalFiles || 0;
      const exceedsAbsolute = filteredFiles.length > literalNarrowMaxFiles;
      const exceedsRatio = totalCorpusFiles > 0 && (filteredFiles.length / totalCorpusFiles) > literalNarrowMaxRatio;
      if (exceedsAbsolute || exceedsRatio) {
        prefilterDiscardedCount = filteredFiles.length;
        prefilterDiscarded = true;
        filteredFiles = null;
      }
    }
  }

  const grepStart = performance.now();
  const directJsonThreshold = options.directJsonFileThreshold ?? 2048;
  const shouldUseDirectJson = (
    !Array.isArray(filteredFiles) ||
    filteredFiles.length === 0 ||
    filteredFiles.length > directJsonThreshold
  );

  let matchingFiles = [];
  let indexedMatches = [];
  if (shouldUseDirectJson) {
    if (prefilterDiscarded) {
      grepStrategy = 'direct_json_prefilter_discarded';
    } else if (gramTooBroad) {
      grepStrategy = 'direct_json_gram_too_broad';
    } else {
      grepStrategy = 'direct_json';
    }
    indexedMatches = await runRipgrepJson(regex, searchDir, {
      files: filteredFiles,
      fixedString,
      globs,
    });
    matchingFiles = [...new Set(indexedMatches.map((match) => match.file))];
  } else {
    matchingFiles = await runRipgrepFilesWithMatches(regex, searchDir, {
      files: filteredFiles,
      fixedString,
      globs,
    });
    indexedMatches = matchingFiles.length > 0
      ? await runRipgrepJson(regex, searchDir, {
        files: matchingFiles,
        fixedString,
        globs,
      })
      : [];
  }

  const grepTime = performance.now() - grepStart;
  const totalMatches = indexedMatches.length;

  // Stats: when the prefilter was discarded, report what actually happened —
  // the prefilter ran but its output was too broad to be useful, so grep
  // reverted to a full tree scan. Use null (not 0) to signal "unknown /
  // not applicable" — 0 would silently bias numeric averages downward.
  const effectiveFilesScanned = prefilterDiscarded
    ? null
    : (Array.isArray(filteredFiles) ? filteredFiles.length : null);

  return {
    indexedMatches,
    overlayMatches: [],
    stats: {
      candidateGenTime_ms: Math.round(performance.now() - start),
      grepTime_ms: Math.round(grepTime),
      literalFilterTime_ms: Math.round(literalFilterTime),
      gramLookupTime_ms: Math.round(gramLookupTime),
      filesConsidered: gramLookupResult?.totalFiles ?? (Array.isArray(searchFiles) ? searchFiles.length : 0),
      filesScanned: effectiveFilesScanned,
      filesSkipped: Array.isArray(searchFiles) && Array.isArray(filteredFiles)
        ? Math.max(0, searchFiles.length - filteredFiles.length)
        : 0,
      dirtyOverlayFiles: 0,
      candidateFilesBeforeFilter,
      candidateFilesAfterFilter,
      candidateReductionRatio: candidateFilesBeforeFilter > 0
        ? 1 - (candidateFilesAfterFilter / candidateFilesBeforeFilter)
        : 0,
      literalExtractionHit: literalPlan.clauses.length > 0,
      literalExtractionSource: literalPlan.source,
      gramLookupReason: gramLookupResult?.reason || 'not_run',
      prefilterDiscarded,
      prefilterDiscardedCount,
      denseGramsTouched: gramLookupResult?.denseGramsTouched || 0,
      sparseGramsTouched: gramLookupResult?.sparseGramsTouched || 0,
      gramFalsePositiveRatio: Array.isArray(searchFiles) && searchFiles.length > 0
        ? 1 - (matchingFiles.length / searchFiles.length)
        : 0,
      grepStrategy,
      symbolTypeFilter,
      trackerLastIndex: null,
      grepMatches: totalMatches,
    },
  };
}

/**
 * Run ripgrep with a regex pattern against a directory or explicit file set.
 * Uses --json output to avoid colon-delimiter parsing issues with
 * paths containing colons (Windows, exotic filenames).
 *
 * @param {string} regex - The regex pattern to search for
 * @param {string} searchDir - Directory to search in
 * @param {Object} [opts] - Options
 * @param {number} [opts.maxMatches=0] - Optional post-filter line cap (0 disables)
 * @param {number} [opts.timeout=10000] - Timeout in ms
 * @param {string[]|null} [opts.files=null] - Explicit relative file paths to search
 * @returns {Promise<Array<{file: string, line: number, content: string}>>}
 */
export async function runRipgrep(regex, searchDir, opts = {}) {
  const {
    maxMatches = 0,
    fixedString = false,
    globs = [],
    timeout = 10000,
    files = null,
  } = opts;

  const matches = await runRipgrepJson(regex, searchDir, { files, fixedString, globs, timeout });
  return maxMatches > 0 ? matches.slice(0, maxMatches) : matches;
}

// =============================================================================
// Query enhancement — merge regex tokens into semantic query (ColGrep-style)
// =============================================================================

/**
 * Strip regex metacharacters and extract readable tokens from a pattern.
 * E.g., "class\\s+\\w+" → ["class"], "export async function\\s+\\w+" → ["export", "async", "function"]
 *
 * @param {string} regex
 * @returns {string[]} Readable tokens
 */
export function extractRegexTokens(regex) {
  return regex
    .replace(/\\[sSdDwWbB]/g, ' ')     // \s, \w, \d, \b → space
    .replace(/\\[.*+?^${}()|[\]\\]/g, '') // escaped metacharacters → remove
    .replace(/[.*+?^${}()|[\]\\]/g, ' ') // raw metacharacters → space
    .split(/\s+/)
    .filter(t => t.length > 1)           // drop single chars
    .map(t => t.toLowerCase());
}

/**
 * Merge unique regex tokens into the semantic query.
 * Avoids duplicating tokens already present in the query.
 *
 * @param {string} query - Semantic query
 * @param {string} regex - Regex pattern
 * @returns {string} Enhanced query
 */
export function mergeRegexIntoQuery(query, regex) {
  const regexTokens = extractRegexTokens(regex);
  if (regexTokens.length === 0) return query;

  const queryLower = query.toLowerCase();
  const novel = regexTokens.filter(t => !queryLower.includes(t));
  if (novel.length === 0) return query;

  return `${query} ${novel.join(' ')}`;
}

// =============================================================================
// Chunk location map — maps file:line → chunk IDs
// =============================================================================

/**
 * Build a sorted interval map from late interaction index metadata.
 * Used for O(log n) lookup of which indexed chunk contains a given file:line.
 *
 * @param {import('../ranking/late-interaction-index.js').LateInteractionIndex} liIndex
 * @returns {Map<string, Array<{startLine: number, endLine: number, id: string, type?: string, name?: string}>>}
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
    bucket.push({
      startLine: meta.startLine,
      endLine: meta.endLine,
      id,
      type: meta.type || null,
      name: meta.name || null,
    });
  }

  // Sort each file's intervals by startLine for binary search
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.startLine - b.startLine);
  }

  return map;
}

function findChunkIntervalForLine(intervals, lineNumber) {
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
      return iv;
    }
  }

  return null;
}

/**
 * Binary search for the chunk whose [startLine, endLine] contains `lineNumber`.
 *
 * @param {Array<{startLine: number, endLine: number, id: string}>|undefined} intervals
 * @param {number} lineNumber
 * @returns {string|null} chunk ID or null
 */
export function findChunkForLine(intervals, lineNumber) {
  return findChunkIntervalForLine(intervals, lineNumber)?.id || null;
}

/**
 * Map ripgrep matches to indexed chunk IDs.
 * Returns match counts per chunk (grep density) alongside the ID set.
 *
 * Adjacent chunk inclusion: when a regex matches a line at the boundary
 * of a chunk (within 2 lines of the chunk's start or end), the adjacent
 * chunk is also included as a candidate. This handles the common case
 * where the AST chunker splits a function signature from its body —
 * the regex hits the signature line but the gold chunk is the body.
 *
 * @param {Array<{file: string, line: number, content: string}>} matches
 * @param {Map} locationMap - Output of buildChunkLocationMap
 * @param {Object} [opts]
 * @param {boolean} [opts.includeAdjacent=true] - Include adjacent chunks at boundaries
 * @returns {{ chunkIds: Set<string>, chunkMatchCounts: Map<string, number>, unindexed: Array }}
 */
export function mapMatchesToChunks(matches, locationMap, opts = {}) {
  const includeAdjacent = opts.includeAdjacent ?? true;
  const chunkMatchCounts = new Map();
  const unindexed = [];

  for (const match of matches) {
    const intervals = locationMap.get(match.file);
    if (!intervals) { unindexed.push(match); continue; }

    const id = findChunkForLine(intervals, match.line);
    if (id) {
      chunkMatchCounts.set(id, (chunkMatchCounts.get(id) || 0) + 1);

      // Adjacent chunk inclusion: if the match is near a chunk boundary,
      // also include the next/prev chunk. This catches signature/body splits.
      if (includeAdjacent) {
        const idx = intervals.findIndex(iv => iv.id === id);
        if (idx >= 0) {
          const iv = intervals[idx];
          // If match is within 2 lines of chunk end and there's a next chunk
          if (match.line >= iv.endLine - 1 && idx + 1 < intervals.length) {
            const nextId = intervals[idx + 1].id;
            if (!chunkMatchCounts.has(nextId)) chunkMatchCounts.set(nextId, 0);
          }
          // If match is within 2 lines of chunk start and there's a prev chunk
          if (match.line <= iv.startLine + 1 && idx > 0) {
            const prevId = intervals[idx - 1].id;
            if (!chunkMatchCounts.has(prevId)) chunkMatchCounts.set(prevId, 0);
          }
        }
      }
    } else {
      // Match falls in a gap — check if there's a chunk starting right after
      if (includeAdjacent) {
        for (const iv of intervals) {
          if (iv.startLine > match.line && iv.startLine - match.line <= 3) {
            if (!chunkMatchCounts.has(iv.id)) chunkMatchCounts.set(iv.id, 0);
            break;
          }
        }
      }
      unindexed.push(match);
    }
  }

  return { chunkIds: new Set(chunkMatchCounts.keys()), chunkMatchCounts, unindexed };
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
export function readFileRange(fileCache, filePath, startLine, endLine, projectRoot) {
  try {
    const root = projectRoot || PROJECT_ROOT;
    const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
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

function buildBareGrepResults(matches, options = {}) {
  const {
    projectRoot = PROJECT_ROOT,
    contextLines = 0,
  } = options;

  const fileCache = new Map();

  return matches.map((match, index) => {
    let contextBefore = [];
    let contextAfter = [];

    if (contextLines > 0) {
      const before = readFileRange(fileCache, match.file, Math.max(1, match.line - contextLines), match.line - 1, projectRoot);
      const after = readFileRange(fileCache, match.file, match.line + 1, match.line + contextLines, projectRoot);
      contextBefore = before ? before.split('\n').filter(Boolean) : [];
      contextAfter = after ? after.split('\n').filter(Boolean) : [];
    }

    return {
      id: `grep:${match.file}:${match.line}:${match.column || 1}:${index}`,
      file: match.file,
      line: match.line,
      column: match.column || 1,
      matchText: match.matchText || '',
      content: match.content,
      text: match.content,
      contextBefore,
      contextAfter,
      searchPath: 'grep',
      metadata: {
        file: match.file,
        startLine: match.line,
        endLine: match.line,
      },
    };
  });
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

function getCodebaseChunkTypeMap(searcher) {
  if (!searcher?.codebaseDb) return null;
  if (searcher._codebaseChunkTypeMap) return searcher._codebaseChunkTypeMap;

  const map = new Map();
  const rows = searcher.codebaseDb.prepare('SELECT file_path, metadata FROM vectors').iterate();

  for (const row of rows) {
    try {
      const metadata = JSON.parse(row.metadata || '{}');
      if (
        !row.file_path ||
        metadata.startLine == null ||
        metadata.endLine == null
      ) {
        continue;
      }

      let bucket = map.get(row.file_path);
      if (!bucket) {
        bucket = [];
        map.set(row.file_path, bucket);
      }

      bucket.push({
        startLine: metadata.startLine,
        endLine: metadata.endLine,
        id: row.file_path,
        type: metadata.type || null,
        name: metadata.name || null,
      });
    } catch {
      // Ignore malformed metadata rows.
    }
  }

  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.startLine - b.startLine);
  }

  searcher._codebaseChunkTypeMap = map;
  return map;
}

function filterMatchesBySymbolType(matches, symbolType, searcher) {
  if (!symbolType || !Array.isArray(matches) || matches.length === 0) {
    return matches;
  }

  const locationMap = getCodebaseChunkTypeMap(searcher);
  if (!locationMap) {
    return matches;
  }

  return matches.filter((match) => {
    const interval = findChunkIntervalForLine(locationMap.get(match.file), match.line);
    return normalizeSearchSymbolType(interval?.type) === symbolType;
  });
}

export async function bareGrep(query, routing, options = {}) {
  const regex = options.regex || query;
  const searchDir = this?.projectRoot || options.projectRoot || PROJECT_ROOT;
  const maxMatches = options.maxMatches ?? 0;
  const start = performance.now();
  const symbolType = resolveSearchSymbolFilter(options);

  void routing;

  if (!regex) {
    throw new Error('Bare grep requires a regex or fixed-string pattern.');
  }

  if (!await isRipgrepAvailable()) {
    throw new Error('Bare grep requires ripgrep (rg). Install: brew install ripgrep');
  }

  const candidateResult = await generateRegexMatches(this || {}, regex, searchDir, options);
  let matches = [...candidateResult.indexedMatches, ...candidateResult.overlayMatches];
  matches = filterMatchesBySymbolType(matches, symbolType, this);
  matches.sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    (a.column || 0) - (b.column || 0)
  );

  const totalMatches = matches.length;
  if (maxMatches > 0) {
    matches = matches.slice(0, maxMatches);
  }

  const results = buildBareGrepResults(matches, {
    projectRoot: searchDir,
    contextLines: options.contextLines ?? 0,
  });

  return {
    results,
    stats: {
      path: 'grep',
      regex,
      fixedString: options.fixedString ?? false,
      contextLines: options.contextLines ?? 0,
      totalMatches,
      returnedMatches: results.length,
      candidateGenTime_ms: candidateResult.stats.candidateGenTime_ms,
      grepTime_ms: candidateResult.stats.grepTime_ms,
      literalFilterTime_ms: candidateResult.stats.literalFilterTime_ms,
      gramLookupTime_ms: candidateResult.stats.gramLookupTime_ms,
      filesConsidered: candidateResult.stats.filesConsidered,
      filesScanned: candidateResult.stats.filesScanned,
      filesSkipped: candidateResult.stats.filesSkipped,
      dirtyOverlayFiles: candidateResult.stats.dirtyOverlayFiles,
      candidateFilesBeforeFilter: candidateResult.stats.candidateFilesBeforeFilter,
      candidateFilesAfterFilter: candidateResult.stats.candidateFilesAfterFilter,
      candidateReductionRatio: candidateResult.stats.candidateReductionRatio,
      literalExtractionHit: candidateResult.stats.literalExtractionHit,
      literalExtractionSource: candidateResult.stats.literalExtractionSource,
      denseGramsTouched: candidateResult.stats.denseGramsTouched,
      sparseGramsTouched: candidateResult.stats.sparseGramsTouched,
      gramFalsePositiveRatio: candidateResult.stats.gramFalsePositiveRatio,
      symbolType,
      total_ms: Math.round(performance.now() - start),
    },
  };
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

  // Parallel: candidate generation + query encode
  const { encodeQuery } = await import('../ranking/late-interaction-model.js');
  const searchDir = this.projectRoot || PROJECT_ROOT;

  // Query enhancement: merge regex tokens into the semantic query (ColGrep-style).
  // Strips regex metacharacters and appends unique tokens to give the embedding
  // model structural context alongside the semantic intent.
  const enhanceQuery = options.enhanceQuery ?? true;
  const effectiveQuery = enhanceQuery ? mergeRegexIntoQuery(query, regex) : query;
  log(`Query: "${effectiveQuery}"`);

  const parallelStart = performance.now();
  const [candidateResult, encodedQuery] = await Promise.all([
    generateRegexMatches(this, regex, searchDir, options),
    (async () => {
      const encodeStart = performance.now();
      const tokens = await encodeQuery(effectiveQuery);
      return {
        tokens,
        encodeTime: performance.now() - encodeStart,
      };
    })(),
  ]);
  const parallelTime = performance.now() - parallelStart;
  const grepMatches = candidateResult.indexedMatches;
  const overlayMatches = candidateResult.overlayMatches;
  const queryTokens = encodedQuery.tokens;
  const encodeTime = encodedQuery.encodeTime;
  const totalRawMatches = grepMatches.length + overlayMatches.length;
  log(
    `Parallel phase: ${totalRawMatches} grep matches ` +
    `(${grepMatches.length} indexed, ${overlayMatches.length} overlay), ` +
    `${queryTokens.length} query tokens in ${parallelTime.toFixed(1)}ms`
  );

  if (totalRawMatches === 0) {
    return {
      results: [],
      stats: {
        path: 'pattern',
        regex,
        grepMatches: 0,
        indexedChunks: 0,
        unindexedMatches: 0,
        candidateGenTime_ms: candidateResult.stats.candidateGenTime_ms,
        grepTime_ms: candidateResult.stats.grepTime_ms,
        literalFilterTime_ms: candidateResult.stats.literalFilterTime_ms,
        gramLookupTime_ms: candidateResult.stats.gramLookupTime_ms,
        encodeTime_ms: Math.round(encodeTime),
        filesConsidered: candidateResult.stats.filesConsidered,
        filesScanned: candidateResult.stats.filesScanned,
        filesSkipped: candidateResult.stats.filesSkipped,
        dirtyOverlayFiles: candidateResult.stats.dirtyOverlayFiles,
        candidateFilesBeforeFilter: candidateResult.stats.candidateFilesBeforeFilter,
        candidateFilesAfterFilter: candidateResult.stats.candidateFilesAfterFilter,
        candidateReductionRatio: candidateResult.stats.candidateReductionRatio,
        literalExtractionHit: candidateResult.stats.literalExtractionHit,
        literalExtractionSource: candidateResult.stats.literalExtractionSource,
        gramLookupReason: candidateResult.stats.gramLookupReason,
        denseGramsTouched: candidateResult.stats.denseGramsTouched,
        sparseGramsTouched: candidateResult.stats.sparseGramsTouched,
        gramFalsePositiveRatio: candidateResult.stats.gramFalsePositiveRatio,
        prefilterDiscarded: candidateResult.stats.prefilterDiscarded,
        prefilterDiscardedCount: candidateResult.stats.prefilterDiscardedCount,
        grepStrategy: candidateResult.stats.grepStrategy,
        parallelTime_ms: Math.round(parallelTime),
        total_ms: Math.round(performance.now() - start),
      },
    };
  }

  // Map file:line matches → indexed chunk IDs (with grep density counts)
  const { chunkIds, chunkMatchCounts, unindexed } = mapMatchesToChunks(grepMatches, locationMap);
  const unindexedMatches = [...unindexed, ...overlayMatches];
  log(`Mapped: ${chunkIds.size} indexed chunks, ${unindexedMatches.length} unindexed matches`);

  // Filter to chunks with token embeddings in the LI index
  let available = this.lateInteractionIndex.hasTokens(chunkIds);
  log(`LI index hits: ${available.size}/${chunkIds.size}`);

  // Chunk-level candidate cap: if too many candidates after dedup, keep
  // the ones with highest grep density (most regex matches in the chunk).
  const maxCandidates = options.maxCandidates ?? 0;  // 0 = no cap (best quality); safety valve at caller level
  if (maxCandidates > 0 && available.size > maxCandidates) {
    const sorted = [...available]
      .map(id => ({ id, count: chunkMatchCounts.get(id) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxCandidates);
    available = new Set(sorted.map(s => s.id));
    log(`Candidate cap: ${available.size} (from ${chunkIds.size}, top by grep density)`);
  }

  // MaxSim rerank + grep density blending
  let scored = [];
  let rerankTime = 0;
  if (available.size > 0 && queryTokens.length > 0) {
    const candidates = [...available].map(id => ({ id }));
    const rerankStart = performance.now();
    scored = await this.lateInteractionIndex.scoreWithLateInteraction(queryTokens, candidates);
    rerankTime = performance.now() - rerankStart;

    // Blend grep density: finalScore = maxSimScore * (1 + α * log(matchCount))
    // α controls how much structural match density influences ranking.
    // log-scaled so a chunk with 50 hits doesn't dominate one with 5.
    const GREP_DENSITY_ALPHA = options.grepDensityAlpha ?? 0;
    for (const s of scored) {
      const matchCount = chunkMatchCounts.get(s.id) || 1;
      s.grepDensity = matchCount;
      s.lateInteractionScore = s.lateInteractionScore * (1 + GREP_DENSITY_ALPHA * Math.log(matchCount));
    }
    // Test demotion (ColGrep-style): penalize test file chunks when the query
    // doesn't mention testing. Prevents test files from drowning out implementations.
    const TEST_DEMOTION = options.testDemotion ?? 0.05;
    if (TEST_DEMOTION > 0) {
      const queryLower = query.toLowerCase();
      const queryMentionsTest = /\btest|spec|describe|it\b/.test(queryLower);
      if (!queryMentionsTest) {
        for (const s of scored) {
          const doc = this.lateInteractionIndex.documents.get(s.id);
          const file = doc?.metadata?.file || '';
          const name = doc?.metadata?.name || '';
          if (/test|spec|__test__|\.test\.|\.spec\./.test(file) ||
              /test|spec/i.test(name)) {
            s.lateInteractionScore -= TEST_DEMOTION;
          }
        }
      }
    }

    scored.sort((a, b) => b.lateInteractionScore - a.lateInteractionScore);

    log(`MaxSim rerank: ${scored.length} candidates in ${rerankTime.toFixed(1)}ms`);
  }

  // Build result objects with metadata + file content (per-search file cache)
  const fileCache = new Map();

  const results = scored.slice(0, k).map((s, rank) => {
    const doc = this.lateInteractionIndex.documents.get(s.id);
    const meta = doc?.metadata || {};
    const text = readFileRange(fileCache, meta.file, meta.startLine, meta.endLine, this.projectRoot);

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
  if (remaining > 0 && unindexedMatches.length > 0) {
    const seen = new Set(results.map(r => `${r.file}:${r.startLine}`));
    let added = 0;
    for (const m of unindexedMatches) {
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

  // Expose full candidate pipeline for diagnostic evaluation:
  // - allCandidateIds: every chunk that had LI embeddings (pre-MaxSim)
  // - allMappedChunkIds: every chunk mapped from grep (pre-LI filter)
  const allCandidateIds = [...available];
  const allMappedChunkIds = [...chunkIds];

  return {
    results,
    stats: {
      path: 'pattern',
      regex,
      grepMatches: totalRawMatches,
      indexedChunks: available.size,
      unindexedMatches: unindexedMatches.length,
      maxSimCandidates: scored.length,
      locationMapFiles: locationMap.size,
      candidateGenTime_ms: candidateResult.stats.candidateGenTime_ms,
      grepTime_ms: candidateResult.stats.grepTime_ms,
      literalFilterTime_ms: candidateResult.stats.literalFilterTime_ms,
      gramLookupTime_ms: candidateResult.stats.gramLookupTime_ms,
      encodeTime_ms: Math.round(encodeTime),
      mapTime_ms: Math.round(mapTime),
      parallelTime_ms: Math.round(parallelTime),
      rerankTime_ms: Math.round(rerankTime),
      filesConsidered: candidateResult.stats.filesConsidered,
      filesScanned: candidateResult.stats.filesScanned,
      filesSkipped: candidateResult.stats.filesSkipped,
      dirtyOverlayFiles: candidateResult.stats.dirtyOverlayFiles,
      candidateFilesBeforeFilter: candidateResult.stats.candidateFilesBeforeFilter,
      candidateFilesAfterFilter: candidateResult.stats.candidateFilesAfterFilter,
      candidateReductionRatio: candidateResult.stats.candidateReductionRatio,
      literalExtractionHit: candidateResult.stats.literalExtractionHit,
      literalExtractionSource: candidateResult.stats.literalExtractionSource,
      gramLookupReason: candidateResult.stats.gramLookupReason,
      denseGramsTouched: candidateResult.stats.denseGramsTouched,
      sparseGramsTouched: candidateResult.stats.sparseGramsTouched,
      gramFalsePositiveRatio: candidateResult.stats.gramFalsePositiveRatio,
      prefilterDiscarded: candidateResult.stats.prefilterDiscarded,
      prefilterDiscardedCount: candidateResult.stats.prefilterDiscardedCount,
      grepStrategy: candidateResult.stats.grepStrategy,
      trackerLastIndex: candidateResult.stats.trackerLastIndex,
      total_ms: Math.round(totalTime),
      allCandidateIds,
      allMappedChunkIds,
    },
  };
}
