/**
 * Context Expander — transforms ranked pattern search results into
 * self-contained agent context packages.
 *
 * The ranking pipeline is identical between benchmark and agent modes.
 * This module is a post-ranking presentation layer only.
 *
 * Phases:
 *   1. Basic code loading (readFileRange on ranked results)
 *   2. Symbol-complete expansion (code graph entity lookup via CodeGraphRepository)
 *   3. Token budget management (per-result caps, presentation tiers)
 *   4. Header context (minimal imports for top-1)
 *   5. Confidence signals (score gaps, recall, regex selectivity, sufficiency)
 *
 * DDD: All database access goes through infrastructure repositories.
 * This module never queries SQLite directly.
 *
 * References: docs/USEFUL_ANSWER_COLGREP_PLAN.md
 */

import { readFileRange } from './search-pattern-chunks.js';
import { statSync } from 'fs';
import path from 'path';

// =============================================================================
// Token estimation (character-based, no tokenizer on the hot path)
// =============================================================================

/** Approximate token count for a code string (~3.5 chars per token). */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

// =============================================================================
// Default budget configuration
// =============================================================================

const DEFAULT_TOKEN_BUDGET = 4000;
const AGENT_FULL_TOKEN_BUDGET = 8000;
const DEFAULT_PER_RESULT_CAPS = [2000, 800, 400]; // rank 1, 2, 3+
const MAX_HEADER_TOKENS = 200;

// Language keywords to exclude from identifier extraction
const LANG_KEYWORDS = new Set([
  // JS/TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class',
  'extends', 'import', 'export', 'from', 'default', 'async', 'await',
  'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'void',
  'delete', 'in', 'of', 'true', 'false', 'null', 'undefined', 'yield',
  'super', 'static', 'get', 'set', 'with', 'debugger',
  // Go
  'func', 'type', 'struct', 'interface', 'map', 'chan', 'range', 'defer',
  'select', 'go', 'package', 'nil', 'error', 'string', 'int', 'bool',
  // Python
  'def', 'self', 'cls', 'lambda', 'pass', 'raise', 'with', 'as', 'is',
  'not', 'and', 'or', 'from', 'None', 'True', 'False', 'nonlocal', 'global',
  // Rust
  'fn', 'let', 'mut', 'pub', 'use', 'mod', 'crate', 'impl', 'trait',
  'where', 'enum', 'match', 'loop', 'move', 'ref', 'unsafe', 'dyn',
  'Some', 'None', 'Ok', 'Err', 'self', 'Self',
]);

/** Infer language from file extension. */
function inferLanguage(filePath) {
  if (!filePath) return 'unknown';
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
    '.go': 'go',
    '.py': 'python',
    '.rs': 'rust',
    '.java': 'java', '.kt': 'kotlin',
    '.rb': 'ruby', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
  };
  return map[ext] || 'unknown';
}

// =============================================================================
// Symbol-complete expansion (Phase 2)
// =============================================================================

/**
 * Find the enclosing entity for a given file:line range.
 *
 * DDD compliant: delegates to CodeGraphRepository infrastructure method.
 * Never queries SQLite directly.
 *
 * @param {import('../infrastructure/code-graph-repository.js').CodeGraphRepository} codeGraphRepo
 * @param {string} filePath - Relative file path
 * @param {number} startLine - Chunk start line
 * @param {number} endLine - Chunk end line
 * @returns {{ name: string, type: string, startLine: number, endLine: number, parentClass: string|null }|null}
 */
export function findEnclosingEntity(codeGraphRepo, filePath, startLine, endLine) {
  if (!codeGraphRepo) return null;
  try {
    return codeGraphRepo.findEnclosingEntity(filePath, startLine, endLine);
  } catch {
    return null;
  }
}

/**
 * Expand a result to symbol-complete boundaries.
 *
 * Decision tree (from plan §4.1):
 *   1. Is chunk already a complete symbol? → return as-is
 *   2. Look up enclosing entity in code graph → expand to entity boundaries
 *   3. Merge contiguous sibling chunks → stop at next symbol boundary
 *   4. Fall back: return chunk as-is
 *
 * @param {object} result - Ranked result with file, startLine, endLine, metadata
 * @param {object} opts
 * @param {object} opts.codeGraphRepo - CodeGraphRepository instance
 * @param {Map} opts.locationMap - Chunk location map (file → sorted intervals)
 * @param {Map} opts.fileCache - Shared file cache for readFileRange
 * @param {string} opts.projectRoot
 * @param {number} opts.tokenCap - Max tokens for this result
 * @returns {{ startLine: number, endLine: number, expanded: boolean, expandedFrom: string|null, symbol: string|null, symbolType: string|null }}
 */
export function expandToSymbol(result, opts) {
  const { codeGraphRepo, locationMap, tokenCap } = opts;
  const meta = result.metadata || {};
  const origStart = meta.startLine || result.startLine;
  const origEnd = meta.endLine || result.endLine;
  const origRange = `${origStart}-${origEnd}`;
  const chunkLines = (origEnd - origStart) + 1;

  // Check if chunk already looks like a complete symbol
  // (has a name/type and is > 10 lines — not just a signature fragment)
  if (meta.name && chunkLines > 10) {
    return {
      startLine: origStart,
      endLine: origEnd,
      expanded: false,
      expandedFrom: null,
      symbol: meta.name,
      symbolType: meta.type || null,
    };
  }

  // Try code graph entity lookup (via repository — DDD compliant)
  const filePath = meta.file || result.file;
  const entity = findEnclosingEntity(codeGraphRepo, filePath, origStart, origEnd);
  if (entity) {
    const entityLines = (entity.endLine - entity.startLine) + 1;
    const entityTokens = entityLines * 10; // rough estimate: ~10 tokens/line

    // Only expand if it fits within the token cap
    if (entityTokens <= tokenCap) {
      return {
        startLine: entity.startLine,
        endLine: entity.endLine,
        expanded: true,
        expandedFrom: origRange,
        symbol: entity.name,
        symbolType: entity.type,
      };
    }
    // Entity too large — still use its name but keep original range
    return {
      startLine: origStart,
      endLine: origEnd,
      expanded: false,
      expandedFrom: null,
      symbol: entity.name,
      symbolType: entity.type,
    };
  }

  // Try sibling chunk merge (contiguous chunks in the same file)
  const intervals = locationMap?.get(filePath);
  if (intervals && intervals.length > 1) {
    const merged = mergeSiblingChunks(intervals, origStart, origEnd, tokenCap);
    if (merged) {
      return {
        startLine: merged.startLine,
        endLine: merged.endLine,
        expanded: true,
        expandedFrom: origRange,
        symbol: meta.name || null,
        symbolType: meta.type || null,
      };
    }
  }

  // Syntax-aware fallback: expand to enclosing block using brace/indent analysis.
  // This catches cases where the code graph has no entity but the file is readable.
  const { fileCache, projectRoot } = opts;
  const syntaxExpanded = expandBySyntax(
    fileCache, filePath, origStart, origEnd, tokenCap, projectRoot
  );
  if (syntaxExpanded) {
    return {
      startLine: syntaxExpanded.startLine,
      endLine: syntaxExpanded.endLine,
      expanded: true,
      expandedFrom: origRange,
      symbol: meta.name || null,
      symbolType: meta.type || null,
    };
  }

  // Fallback: return as-is
  return {
    startLine: origStart,
    endLine: origEnd,
    expanded: false,
    expandedFrom: null,
    symbol: meta.name || null,
    symbolType: meta.type || null,
  };
}

/**
 * Merge contiguous sibling chunks around the target range.
 * Stops at the next non-contiguous gap or when token cap would be exceeded.
 */
function mergeSiblingChunks(intervals, startLine, endLine, tokenCap) {
  // Find the interval that contains our startLine
  let targetIdx = -1;
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i].startLine <= startLine && intervals[i].endLine >= startLine) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1) return null;

  let mergedStart = intervals[targetIdx].startLine;
  let mergedEnd = intervals[targetIdx].endLine;
  const GAP_THRESHOLD = 3; // max gap lines between "contiguous" chunks

  // Expand backward
  for (let i = targetIdx - 1; i >= 0; i--) {
    const gap = mergedStart - intervals[i].endLine;
    if (gap > GAP_THRESHOLD) break;
    const newLines = (mergedEnd - intervals[i].startLine) + 1;
    if (newLines * 10 > tokenCap) break;
    mergedStart = intervals[i].startLine;
  }

  // Expand forward
  for (let i = targetIdx + 1; i < intervals.length; i++) {
    const gap = intervals[i].startLine - mergedEnd;
    if (gap > GAP_THRESHOLD) break;
    const newLines = (intervals[i].endLine - mergedStart) + 1;
    if (newLines * 10 > tokenCap) break;
    mergedEnd = intervals[i].endLine;
  }

  // Only return if we actually expanded
  if (mergedStart === intervals[targetIdx].startLine &&
      mergedEnd === intervals[targetIdx].endLine) {
    return null;
  }

  return { startLine: mergedStart, endLine: mergedEnd };
}

// =============================================================================
// Syntax-aware expansion fallback (per-language block detection)
// =============================================================================

/**
 * Expand to the enclosing syntactic block using brace/indent analysis.
 *
 * Language strategies:
 *   - Brace languages (JS/TS/Go/Rust/Java/C): scan up for unmatched '{', down for matching '}'
 *   - Python: scan up for dedent to lower indent level, down to where indent returns
 *
 * Only fires when code graph entity lookup AND sibling merge both fail.
 * Returns null if no meaningful expansion is found.
 */
export function expandBySyntax(fileCache, filePath, startLine, endLine, tokenCap, projectRoot) {
  // Read a generous window around the chunk (up to ±100 lines)
  const windowStart = Math.max(1, startLine - 100);
  const windowEnd = endLine + 100;
  const raw = readFileRange(fileCache, filePath, windowStart, windowEnd, projectRoot);
  if (!raw) return null;

  const lines = raw.split('\n');
  // Convert absolute line numbers to 0-based window offsets
  const chunkStartIdx = startLine - windowStart;
  const chunkEndIdx = endLine - windowStart;
  if (chunkStartIdx < 0 || chunkEndIdx >= lines.length) return null;

  const lang = inferLanguage(filePath);
  const isPython = lang === 'python';

  let blockStart, blockEnd;

  if (isPython) {
    // Python: find enclosing def/class by scanning up for lower indent
    const chunkIndent = getIndentLevel(lines[chunkStartIdx]);
    blockStart = chunkStartIdx;
    for (let i = chunkStartIdx - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const indent = getIndentLevel(line);
      if (indent < chunkIndent && /^\s*(def |class |async def )/.test(line)) {
        blockStart = i;
        break;
      }
    }
    // Scan down: continue while indent >= block body indent
    const bodyIndent = blockStart < chunkStartIdx ? getIndentLevel(lines[blockStart]) + 1 : chunkIndent;
    blockEnd = chunkEndIdx;
    for (let i = chunkEndIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') { blockEnd = i; continue; }
      if (getIndentLevel(line) < bodyIndent) break;
      blockEnd = i;
    }
  } else {
    // Brace languages: scan up for unmatched '{', down for matching '}'
    let braceDepth = 0;
    blockStart = chunkStartIdx;

    // Count braces within the chunk first
    for (let i = chunkStartIdx; i <= chunkEndIdx && i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
      }
    }

    // Find the enclosing function/class by scanning upward for a signature pattern.
    // This is more robust than pure brace-counting, which can be confused by
    // inner blocks (if/for/switch) that also use braces.
    {
      for (let i = chunkStartIdx - 1; i >= 0; i--) {
        const line = lines[i];
        if (/^\s*(func |function |class |impl |export (default |async )?function|export (default )?class|pub (fn |struct |enum |impl )|type \w+ struct|async function )/.test(line)) {
          blockStart = i;
          break;
        }
      }
    }

    // Scan downward for the matching closing brace
    let depth = 0;
    blockEnd = chunkEndIdx;
    for (let i = blockStart; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth <= 0 && i >= chunkEndIdx) {
        blockEnd = i;
        break;
      }
    }
  }

  // Convert back to absolute line numbers
  const expandedStart = windowStart + blockStart;
  const expandedEnd = windowStart + blockEnd;

  // Only expand if we actually found something bigger than the original
  if (expandedStart >= startLine && expandedEnd <= endLine) return null;

  // Check token budget
  const expandedLines = expandedEnd - expandedStart + 1;
  if (expandedLines * 10 > tokenCap) return null;

  return { startLine: expandedStart, endLine: expandedEnd };
}

/** Get Python indent level (number of leading spaces, tabs=4). */
function getIndentLevel(line) {
  let indent = 0;
  for (const ch of line) {
    if (ch === ' ') indent++;
    else if (ch === '\t') indent += 4;
    else break;
  }
  return indent;
}

// =============================================================================
// Staleness detection (Fix #2)
// =============================================================================

/**
 * Check whether a file has been modified since it was last indexed.
 *
 * Uses CodeGraphRepository public methods only (no private field access).
 * Caches the db mtime per search (same for all results) to avoid repeated syscalls.
 *
 * @param {string} filePath - Relative file path
 * @param {string} projectRoot - Project root
 * @param {object} codeGraphRepo - CodeGraphRepository instance
 * @param {{ dbMtime: Date|null|undefined }} cache - Shared cache for db mtime across results
 * @returns {{ stale: boolean, indexedAt: string|null }}
 */
export function checkStaleness(filePath, projectRoot, codeGraphRepo, cache = {}) {
  try {
    // Get index info from the code graph repository
    const indexInfo = codeGraphRepo?.getFileIndexInfo(filePath);

    // If stale_since is set in the code graph, the file is definitively stale
    if (indexInfo?.staleSince) {
      return { stale: true, indexedAt: null };
    }

    // Check file mtime against the index database mtime (via public method)
    // Cache the db mtime — it's the same for all results in one search.
    if (cache.dbMtime === undefined) {
      cache.dbMtime = codeGraphRepo?.getDbMtime?.() ?? null;
    }

    if (!cache.dbMtime) {
      return { stale: false, indexedAt: null };
    }

    const indexedAt = cache.dbMtime.toISOString();
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
    const fileStat = statSync(absPath, { throwIfNoEntry: false });
    if (!fileStat) {
      return { stale: false, indexedAt };
    }

    const stale = fileStat.mtimeMs > cache.dbMtime.getTime();
    return { stale, indexedAt };
  } catch {
    return { stale: false, indexedAt: null };
  }
}

// =============================================================================
// Header context extraction (Phase 4) — Fix #5: broader identifier matching
// =============================================================================

/**
 * Extract import lines from file header, language-aware.
 *
 * Handles:
 *   - JS/TS: import/require/export statements
 *   - Go: import (...) blocks and single imports
 *   - Python: import/from statements
 *   - Rust: use declarations
 */
function extractImportLines(headerText, lang) {
  const lines = headerText.split('\n');

  if (lang === 'go') {
    // Go: capture `import (...)` block contents and single `import "..."`
    const result = [];
    let inBlock = false;
    for (const line of lines) {
      if (/^\s*import\s*\(/.test(line)) { inBlock = true; continue; }
      if (inBlock) {
        if (/^\s*\)/.test(line)) { inBlock = false; continue; }
        if (line.trim()) result.push(line);
      } else if (/^\s*import\s+"/.test(line)) {
        result.push(line);
      }
    }
    return result;
  }

  if (lang === 'python') {
    return lines.filter(line =>
      /^\s*(import\s+\w|from\s+\w)/.test(line)
    );
  }

  if (lang === 'rust') {
    return lines.filter(line =>
      /^\s*(use\s+|pub\s+use\s+|extern\s+crate\s+)/.test(line)
    );
  }

  // JS/TS/default
  return lines.filter(line =>
    /^\s*(import\s|const\s+\{.*\}\s*=\s*require|from\s+['"]|export\s+\{)/.test(line)
  );
}

/**
 * Extract minimal header context for the top-1 result.
 * Language-aware: parses Go import blocks, Python from/import, Rust use declarations.
 *
 * @param {string} code - The result code block
 * @param {Map} fileCache - Shared file cache
 * @param {string} filePath - File path (relative)
 * @param {string} projectRoot
 * @returns {{ headerContext: string|null, headerTokens: number }}
 */
export function extractHeaderContext(code, fileCache, filePath, projectRoot) {
  if (!code || !filePath) return { headerContext: null, headerTokens: 0 };

  try {
    // Read the first 50 lines (import region) of the file
    const headerText = readFileRange(fileCache, filePath, 1, 50, projectRoot);
    if (!headerText) return { headerContext: null, headerTokens: 0 };

    const lang = inferLanguage(filePath);
    const importLines = extractImportLines(headerText, lang);

    if (importLines.length === 0) return { headerContext: null, headerTokens: 0 };

    // Extract identifiers from the code block — broad matching
    const rawMatches = code.match(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g) || [];
    const codeIdentifiers = new Set(
      rawMatches.filter(id => !LANG_KEYWORDS.has(id))
    );

    // Keep only imports that reference identifiers found in the code
    const relevantImports = importLines.filter(line =>
      [...codeIdentifiers].some(id => line.includes(id))
    );

    if (relevantImports.length === 0) return { headerContext: null, headerTokens: 0 };

    const headerContext = relevantImports.join('\n');
    const headerTokens = estimateTokens(headerContext);

    // Enforce max header tokens — trim at line boundaries
    if (headerTokens > MAX_HEADER_TOKENS) {
      const hdrLines = headerContext.split('\n');
      let trimmed = '';
      for (const line of hdrLines) {
        if (estimateTokens(trimmed + '\n' + line) > MAX_HEADER_TOKENS) break;
        trimmed += (trimmed ? '\n' : '') + line;
      }
      return {
        headerContext: trimmed || hdrLines[0],
        headerTokens: estimateTokens(trimmed || hdrLines[0]),
      };
    }

    return { headerContext, headerTokens };
  } catch {
    return { headerContext: null, headerTokens: 0 };
  }
}

// =============================================================================
// Confidence signals (Phase 5) — Fix #4: regex selectivity, Fix #7: sufficiency
// =============================================================================

/**
 * Compute confidence level from score distribution, search stats, and regex selectivity.
 *
 * Thresholds (from plan §5):
 *   - high: top-1 score > 2× top-2
 *   - medium: top-1 and top-2 within 20%
 *   - low: many ties or low candidate recall
 *
 * Fix #4: Also factors in regex selectivity (few grep matches = higher confidence).
 *
 * @param {Array<{score: number}>} results - Ranked results
 * @param {object} stats - Search stats (grepMatches, indexedChunks)
 * @returns {{ confidence: 'high'|'medium'|'low', confidenceReason: string }}
 */
export function computeConfidence(results, stats) {
  if (!results || results.length === 0) {
    return { confidence: 'low', confidenceReason: 'no_results' };
  }

  if (results.length === 1) {
    return { confidence: 'high', confidenceReason: 'single_result' };
  }

  const top1 = results[0].score;
  const top2 = results[1].score;

  if (top2 === 0) {
    return { confidence: 'high', confidenceReason: 'clear_winner' };
  }

  const ratio = top1 / top2;

  // Check for low candidate recall (few grep matches relative to index)
  const grepMatches = stats?.grepMatches || 0;
  const indexedChunks = stats?.indexedChunks || 0;
  if (grepMatches > 0 && indexedChunks === 0) {
    return { confidence: 'low', confidenceReason: 'no_indexed_candidates' };
  }

  // Base confidence from score gap
  let confidence;
  let confidenceReason;

  if (ratio > 2.0) {
    confidence = 'high';
    confidenceReason = 'clear_winner';
  } else if (ratio <= 1.2) {
    // top-1 and top-2 within 20% — ambiguous, agent may want both
    confidence = 'medium';
    confidenceReason = 'close_top2';
  } else {
    // ratio between 1.2 and 2.0 — moderate separation
    confidence = 'medium';
    confidenceReason = 'moderate_gap';
  }

  // Many candidates with similar scores → low
  if (results.length >= 5 && confidence !== 'high') {
    const top5scores = results.slice(0, 5).map(r => r.score);
    const range = top5scores[0] - top5scores[4];
    if (range < top5scores[0] * 0.3) {
      confidence = 'low';
      confidenceReason = 'many_candidates';
    }
  }

  // Fix #4: Regex selectivity adjustment
  // Low match count = selective regex = more likely correct
  if (grepMatches > 0 && grepMatches <= 10 && confidence === 'medium') {
    confidence = 'high';
    confidenceReason = 'selective_regex';
  }
  // High match count = broad regex = less reliable ranking
  if (grepMatches > 200 && confidence === 'high' && confidenceReason !== 'clear_winner') {
    confidence = 'medium';
    confidenceReason = 'broad_regex';
  }

  return { confidence, confidenceReason };
}

/**
 * Compute sufficiency signal — does the returned context likely contain
 * enough information to answer the query? (Fix #7, plan §5)
 *
 * Signals:
 *   (a) Expanded region contains a complete symbol (not truncated)
 *   (b) Header context resolves all referenced imports
 *   (c) Score gap suggests the match is specific, not generic
 *
 * @param {object} topResult - The top-1 agent result
 * @param {{ confidence: string }} confidenceInfo - Confidence computation result
 * @returns {{ sufficient: boolean, reasons: string[] }}
 */
export function computeSufficiency(topResult, confidenceInfo) {
  const reasons = [];

  // (a) Is the result a complete symbol (not truncated)?
  const isComplete = topResult.symbol &&
    topResult.presentation === 'full' &&
    !topResult.code?.includes('// ... (');
  if (isComplete) {
    reasons.push('complete_symbol');
  }

  // (b) Does header context exist (imports resolved)?
  if (topResult.headerContext) {
    reasons.push('header_resolved');
  }

  // (c) Is the confidence high (specific match)?
  if (confidenceInfo.confidence === 'high') {
    reasons.push('high_confidence');
  }

  const sufficient = reasons.length >= 2;
  return { sufficient, reasons };
}

// =============================================================================
// Token budget allocation (Phase 3) — Fix #3: agent_preview / agent_full
// =============================================================================

/**
 * Adaptive budget allocation.
 *
 * Base split: 60/20/20 (preview) or 40/30/30 (full).
 * Adaptations:
 *   - When grepMatches > 200 (broad regex): concentrate on top-1 (70/15/15)
 *   - In agent_full: only expand rank 2/3 to full if score gap < 2× from top-1
 *   - Unused top-1 cap is redistributed to top-2/3 when they are distinct
 *
 * @param {number} totalBudget - Total token budget for all results
 * @param {number} numResults - Number of results
 * @param {string} subMode - 'agent_preview' | 'agent_full'
 * @param {object} [context] - Search context for adaptive decisions
 * @param {number} [context.grepMatches] - Number of grep matches (broad vs selective)
 * @param {Array<{score: number, file: string}>} [context.results] - Ranked results for score-gap gating
 * @returns {Array<{ presentation: 'full'|'preview'|'summary', tokenCap: number }>}
 */
export function allocateBudget(totalBudget, numResults, subMode = 'agent_preview', context = {}) {
  const allocations = [];
  const isFullMode = subMode === 'agent_full';
  const grepMatches = context.grepMatches || 0;
  const results = context.results || [];

  // Adaptive split based on regex breadth
  let top1Share, top23Share;
  if (grepMatches > 200) {
    // Broad regex: sharpen top-1, reduce previews
    top1Share = 0.70;
    top23Share = 0.15;
  } else if (isFullMode) {
    top1Share = 0.40;
    top23Share = 0.30;
  } else {
    top1Share = 0.60;
    top23Share = 0.20;
  }

  for (let i = 0; i < numResults; i++) {
    if (i === 0) {
      const cap = Math.min(Math.floor(totalBudget * top1Share), DEFAULT_PER_RESULT_CAPS[0]);
      allocations.push({ presentation: 'full', tokenCap: cap });
    } else if (i <= 2) {
      // In agent_full: gate full expansion on score gap from top-1.
      // Only expand to full if rank-N is competitive (score >= top-1 / 2).
      const top1Score = results[0]?.score || 0;
      const thisScore = results[i]?.score || 0;
      const isCompetitive = top1Score > 0 && thisScore >= top1Score / 2;

      if (isFullMode && isCompetitive) {
        const cap = Math.min(Math.floor(totalBudget * top23Share), DEFAULT_PER_RESULT_CAPS[0]);
        allocations.push({ presentation: 'full', tokenCap: cap });
      } else {
        const previewCap = DEFAULT_PER_RESULT_CAPS[i] || DEFAULT_PER_RESULT_CAPS[2];
        const cap = Math.min(Math.floor(totalBudget * top23Share), previewCap);
        allocations.push({ presentation: 'preview', tokenCap: cap });
      }
    } else {
      allocations.push({ presentation: 'summary', tokenCap: 0 });
    }
  }

  return allocations;
}

/**
 * Truncate code to fit within a token cap.
 * Prefers keeping the beginning (signature + first N lines of body).
 * Never truncates mid-statement (looks for clean line breaks).
 *
 * @param {string} code
 * @param {number} tokenCap
 * @returns {{ code: string, truncated: boolean, originalTokens: number }}
 */
export function truncateToTokenCap(code, tokenCap) {
  if (!code) return { code: '', truncated: false, originalTokens: 0 };

  const originalTokens = estimateTokens(code);
  if (originalTokens <= tokenCap) {
    return { code, truncated: false, originalTokens };
  }

  // Truncate at approximately the right character count
  const maxChars = Math.floor(tokenCap * 3.5);
  const lines = code.split('\n');
  let charCount = 0;
  let cutLine = 0;

  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i].length + 1; // +1 for newline
    if (charCount >= maxChars) {
      cutLine = i;
      break;
    }
  }

  // Keep at least 1 line (the signature), but only keep 3 if within 2x budget.
  // This prevents tokenBudget:1 from producing 3 lines of code.
  const minLines = estimateTokens(lines.slice(0, 3).join('\n')) <= tokenCap * 2 ? 3 : 1;
  cutLine = Math.max(cutLine, minLines);

  const truncated = lines.slice(0, cutLine).join('\n');
  const remaining = lines.length - cutLine;
  return {
    code: `${truncated}\n// ... (${remaining} more lines)`,
    truncated: true,
    originalTokens,
  };
}

/**
 * Create a compressed preview of a code block.
 * Shows signature + first few lines of body.
 */
function compressToPreview(code, tokenCap) {
  if (!code) return '';

  const lines = code.split('\n');
  if (lines.length <= 5) return code;

  // Keep first 5 lines + ellipsis
  const maxChars = Math.floor(tokenCap * 3.5);
  let preview = '';
  let lineCount = 0;

  for (const line of lines) {
    if (preview.length + line.length + 1 > maxChars && lineCount > 2) break;
    preview += (preview ? '\n' : '') + line;
    lineCount++;
  }

  if (lineCount < lines.length) {
    // Replace function/method bodies with { ... }
    preview = preview.replace(/\{[^}]*$/s, '{ ... }');
    if (!preview.includes('...')) {
      preview += '\n// ... (' + (lines.length - lineCount) + ' more lines)';
    }
  }

  return preview;
}

// =============================================================================
// Main packaging function — assembles agent mode results
// =============================================================================

/**
 * Resolve the effective sub-mode from the format string.
 * 'agent' → 'agent_preview' (default), 'agent_preview', 'agent_full'.
 */
function resolveSubMode(format) {
  if (format === 'agent_full') return 'agent_full';
  return 'agent_preview'; // 'agent' and 'agent_preview' both map here
}

/**
 * Package ranked results into agent-mode context blocks.
 *
 * Takes the ranked results from patternSearch (same order, same IDs)
 * and transforms them into self-contained code packages with:
 *   - Loaded code content
 *   - Symbol-complete expansion (via CodeGraphRepository)
 *   - Token budget management
 *   - Header context (top-1 only)
 *   - Confidence + sufficiency signals
 *   - Staleness metadata
 *
 * @param {Array} rankedResults - Results from patternSearch ranking pipeline
 * @param {object} searchStats - Stats from the search pipeline
 * @param {object} opts
 * @param {string} opts.query - Original search query
 * @param {string} opts.regex - Regex pattern used
 * @param {string} [opts.format='agent'] - 'agent' | 'agent_preview' | 'agent_full'
 * @param {number} [opts.tokenBudget] - Total token budget (default depends on sub-mode)
 * @param {object} [opts.codeGraphRepo] - CodeGraphRepository for entity lookup (DDD)
 * @param {Map} [opts.locationMap] - Chunk location map
 * @param {string} [opts.projectRoot] - Project root path
 * @returns {object} Agent mode response
 */
export function packageForAgent(rankedResults, searchStats, opts) {
  const {
    query,
    regex,
    format: formatOpt = 'agent',
    codeGraphRepo = null,
    locationMap = null,
    projectRoot,
  } = opts;

  const subMode = resolveSubMode(formatOpt);
  const defaultBudget = subMode === 'agent_full' ? AGENT_FULL_TOKEN_BUDGET : DEFAULT_TOKEN_BUDGET;
  const tokenBudget = opts.tokenBudget ?? defaultBudget;

  const start = performance.now();
  const fileCache = new Map();

  // Diversity: demote results that cluster in same file+region as a higher-ranked result.
  // This prevents wasting preview/full budget on near-duplicate chunks from the same symbol.
  const diversityDemotions = new Set();
  for (let i = 0; i < Math.min(rankedResults.length, 5); i++) {
    const ri = rankedResults[i];
    const fi = ri.metadata?.file || ri.file;
    const si = ri.metadata?.startLine || ri.startLine;
    const ei = ri.metadata?.endLine || ri.endLine;
    for (let j = i + 1; j < Math.min(rankedResults.length, 5); j++) {
      if (diversityDemotions.has(j)) continue;
      const rj = rankedResults[j];
      const fj = rj.metadata?.file || rj.file;
      if (fi !== fj) continue;
      const sj = rj.metadata?.startLine || rj.startLine;
      const ej = rj.metadata?.endLine || rj.endLine;
      // Overlap: lines intersect or are within 10 lines of each other
      if (sj <= ei + 10 && ej >= si - 10) {
        diversityDemotions.add(j);
      }
    }
  }

  // Allocate budget per result — adaptive based on regex breadth and score gaps
  const allocations = allocateBudget(tokenBudget, rankedResults.length, subMode, {
    grepMatches: searchStats?.grepMatches || 0,
    results: rankedResults,
  });

  // Compute confidence from ranked results (Fix #4: regex selectivity included)
  const confidenceInfo = computeConfidence(rankedResults, searchStats);

  // Shared staleness cache — db mtime is the same for all results in one search.
  // Avoids repeated statSync calls (Fix D: perf).
  const stalenessCache = {};

  let tokensUsed = 0;
  const agentResults = [];

  for (let i = 0; i < rankedResults.length; i++) {
    const result = rankedResults[i];
    const allocation = allocations[i] || { presentation: 'summary', tokenCap: 0 };
    const meta = result.metadata || {};
    const filePath = meta.file || result.file;

    // Enforce global budget + diversity: demote to summary if budget exhausted
    // or result overlaps with a higher-ranked result in the same file region
    const budgetExhausted = tokensUsed >= tokenBudget;
    const diversityDemoted = diversityDemotions.has(i);

    if (allocation.presentation === 'summary' || budgetExhausted || diversityDemoted) {
      // One-line summary only — no code
      agentResults.push({
        rank: i + 1,
        file: filePath,
        startLine: meta.startLine || result.startLine,
        endLine: meta.endLine || result.endLine,
        symbol: meta.name || result.name || null,
        symbolType: meta.type || result.type || null,
        score: result.score || result.lateInteractionScore || 0,
        expanded: false,
        presentation: 'summary',
        stale: false,
        indexedAt: null,
        summary: `${filePath}:${meta.startLine || result.startLine} — ${meta.name || 'code block'}${meta.type ? ' (' + meta.type + ')' : ''}`,
        code: null,
        codeTokens: 0,
      });
      continue;
    }

    // Phase 2: Symbol-complete expansion (via repository — Fix #1)
    const expansion = expandToSymbol(result, {
      codeGraphRepo,
      locationMap,
      fileCache,
      projectRoot,
      tokenCap: allocation.tokenCap,
    });

    // Phase 1: Load code via readFileRange
    let code = readFileRange(
      fileCache,
      filePath,
      expansion.startLine,
      expansion.endLine,
      projectRoot
    );

    if (!code) {
      // Fallback: try with ±20 lines padding (plan §13, step 3)
      code = readFileRange(
        fileCache,
        filePath,
        Math.max(1, (meta.startLine || result.startLine) - 20),
        (meta.endLine || result.endLine) + 20,
        projectRoot
      );
    }

    // Fix #2: Staleness detection (uses shared cache for db mtime)
    const { stale, indexedAt } = checkStaleness(filePath, projectRoot, codeGraphRepo, stalenessCache);

    if (!code) {
      // Final fallback: metadata only
      agentResults.push({
        rank: i + 1,
        file: filePath,
        startLine: meta.startLine || result.startLine,
        endLine: meta.endLine || result.endLine,
        symbol: expansion.symbol,
        symbolType: expansion.symbolType,
        score: result.score || result.lateInteractionScore || 0,
        expanded: false,
        expandedFrom: null,
        presentation: allocation.presentation,
        stale,
        indexedAt,
        fallbackReason: 'file_read_failed',
        code: null,
        codeTokens: 0,
      });
      continue;
    }

    // Phase 3: Token budget — truncate or compress
    let codeTokens;
    if (allocation.presentation === 'full') {
      const truncResult = truncateToTokenCap(code, allocation.tokenCap);
      code = truncResult.code;
      codeTokens = estimateTokens(code);
    } else {
      // Preview mode — compress to signature + snippet
      code = compressToPreview(code, allocation.tokenCap);
      codeTokens = estimateTokens(code);
    }

    tokensUsed += codeTokens;

    const agentResult = {
      rank: i + 1,
      file: filePath,
      startLine: expansion.startLine,
      endLine: expansion.endLine,
      symbol: expansion.symbol,
      symbolType: expansion.symbolType,
      score: result.score || result.lateInteractionScore || 0,
      expanded: expansion.expanded,
      expandedFrom: expansion.expandedFrom,
      presentation: allocation.presentation,
      stale,
      indexedAt,
      code,
      codeTokens,
    };

    // Phase 4: Header context (top-1 only)
    if (i === 0) {
      const { headerContext, headerTokens } = extractHeaderContext(
        code, fileCache, filePath, projectRoot
      );
      if (headerContext) {
        agentResult.headerContext = headerContext;
        agentResult.headerTokens = headerTokens;
        tokensUsed += headerTokens;
      }
    }

    agentResults.push(agentResult);
  }

  const packagingMs = Math.round(performance.now() - start);

  // Fix #7: Sufficiency signal for top-1 result
  let sufficient = false;
  let sufficiencyReasons = [];
  if (agentResults.length > 0 && agentResults[0].code) {
    const sufficiency = computeSufficiency(agentResults[0], confidenceInfo);
    sufficient = sufficiency.sufficient;
    sufficiencyReasons = sufficiency.reasons;
  }

  return {
    query,
    regex,
    mode: 'pattern',
    totalResults: rankedResults.length,
    latencyMs: searchStats?.total_ms || 0,
    packagingMs,

    format: 'agent',
    subMode,
    tokenBudget,
    tokensUsed,
    confidence: confidenceInfo.confidence,
    confidenceReason: confidenceInfo.confidenceReason,
    sufficient,
    sufficiencyReasons,

    results: agentResults,
  };
}
