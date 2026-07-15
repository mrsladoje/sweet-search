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
import { computeSufficiencyVerdict } from './query-sufficiency.js';
import { applyAgentPackCompletion, shownSourceEndLine } from './agent-pack-completion.js';
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
// Stretch budget — opt-in only via subMode 'agent_full_xl'. Gated on top-1
// dominance (>=2× top-2). Default remains compact 4k; this is for the
// "explicit, single dominant answer fits" case only.
const AGENT_FULL_XL_TOKEN_BUDGET = 12000;
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
 * Decision tree:
 *   1. Is chunk already a complete symbol? → return chunk
 *   2. Look up enclosing entity:
 *      a. fits in cap → expand to entity boundaries (kind: 'full')
 *      b. too large → build symbol sandwich (kind: 'sandwich')
 *      c. sandwich infeasible → bare chunk with entity name (kind: 'chunk')
 *   3. Merge contiguous sibling chunks → stop at next symbol boundary
 *   4. Syntax-aware brace/indent expansion (kind: 'syntax')
 *   5. Fall back: chunk as-is (kind: 'chunk')
 *
 * @param {object} result - Ranked result with file, startLine, endLine, metadata
 * @param {object} opts
 * @param {object} opts.codeGraphRepo - CodeGraphRepository instance
 * @param {Map} opts.locationMap - Chunk location map (file → sorted intervals)
 * @param {Map} opts.fileCache - Shared file cache for readFileRange
 * @param {string} opts.projectRoot
 * @param {number} opts.tokenCap - Max tokens for this result
 * @returns {{
 *   startLine: number,
 *   endLine: number,
 *   expanded: boolean,
 *   expandedFrom: string|null,
 *   symbol: string|null,
 *   symbolType: string|null,
 *   kind: 'full'|'sandwich'|'syntax'|'chunk',
 *   sandwich?: { parts: Array<{kind:'signature'|'gold'|'closing', startLine:number, endLine:number}>, elidedHead:number, elidedTail:number, elisionMarkers:number }
 * }}
 */
export function expandToSymbol(result, opts) {
  const { codeGraphRepo, locationMap, tokenCap } = opts;
  const meta = result.metadata || {};
  const origStart = meta.startLine || result.startLine;
  const origEnd = meta.endLine || result.endLine;
  const origRange = `${origStart}-${origEnd}`;
  const chunkLines = (origEnd - origStart) + 1;


  // Check if chunk already looks like a complete symbol
  // (has a name/type and is > 10 lines — not just a signature fragment).
  // Even when no expansion is needed we still:
  //   (1) look up the enclosing entity so callers (graph-neighbour
  //       reservation) can attach edges to it.
  //   (2) absorb leading trivia (Rust /// + #[...], JSDoc, Python decorators)
  //       so the agent sees attribute-driven semantics like #[non_exhaustive]
  //       that the judge keeps asking for.
  if (meta.name && chunkLines > 10) {
    const filePath0 = meta.file || result.file;
    // Try strict enclosing-range first; fall back to a single-line query at
    // origStart when the chunk overshoots the entity by trailing lines (a
    // common chunker artefact — observed on gin handleHTTPRequest where
    // chunk=690-762 but entity=690-760, leaving the strict query empty).
    let ent0 = findEnclosingEntity(codeGraphRepo, filePath0, origStart, origEnd);
    if (!ent0) ent0 = findEnclosingEntity(codeGraphRepo, filePath0, origStart, origStart);
    let triviaStart0 = origStart;
    if (opts.fileCache && !opts.ablations?.has('no-leading-trivia') && origStart > 1) {
      const lang0 = inferLanguage(filePath0);
      const candidate = expandLeadingTrivia(filePath0, origStart, opts.fileCache, opts.projectRoot, lang0);
      // Only commit when the absorbed trivia fits the cap (10 tok/line est).
      const newLines = (origEnd - candidate) + 1;
      if (newLines * 10 <= tokenCap) triviaStart0 = candidate;
    }
    return {
      startLine: triviaStart0,
      endLine: origEnd,
      expanded: triviaStart0 < origStart,
      expandedFrom: triviaStart0 < origStart ? origRange : null,
      symbol: meta.name,
      symbolType: meta.type || null,
      entityId: ent0?.id || null,
      kind: 'chunk',
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
      // Absorb leading trivia (doc comments, decorators, attributes) above
      // the entity. This recovers context the judge keeps asking for —
      // ripgrep `#[non_exhaustive]`, JSDoc, Rust /// docs, Python decorators.
      const lang = inferLanguage(filePath);
      const triviaStart = (opts.fileCache && !opts.ablations?.has('no-leading-trivia'))
        ? expandLeadingTrivia(filePath, entity.startLine, opts.fileCache, opts.projectRoot, lang)
        : entity.startLine;
      const startWithTrivia = Math.max(1, Math.min(triviaStart, entity.startLine));
      // Re-check budget with trivia included; fall back to symbol-only if it overflows.
      const expandedLines = (entity.endLine - startWithTrivia) + 1;
      const fits = expandedLines * 10 <= tokenCap;
      return {
        startLine: fits ? startWithTrivia : entity.startLine,
        endLine: entity.endLine,
        expanded: true,
        expandedFrom: origRange,
        symbol: entity.name,
        symbolType: entity.type,
        entityId: entity.id || null,
        kind: 'full',
      };
    }
    // Entity too large for full expansion. Try a "symbol sandwich":
    // signature + elision marker + gold chunk + elision marker + closing brace.
    // Goal: preserve gold evidence + ground the agent in the enclosing symbol
    // without dumping the whole function (which causes context rot).
    if (!opts.ablations?.has('no-sandwich')) {
      const sandwich = buildSandwichExpansion(entity, origStart, origEnd, tokenCap);
      if (sandwich) {
        return {
          startLine: entity.startLine,
          endLine: entity.endLine,
          expanded: true,
          expandedFrom: origRange,
          symbol: entity.name,
          symbolType: entity.type,
          entityId: entity.id || null,
          kind: 'sandwich',
          sandwich,
        };
      }
    }
    // Sandwich infeasible (cap too tight). Fall back to bare chunk + entity name.
    return {
      startLine: origStart,
      endLine: origEnd,
      expanded: false,
      expandedFrom: null,
      symbol: entity.name,
      symbolType: entity.type,
      entityId: entity.id || null,
      kind: 'chunk',
    };
  }

  // F5 (2026-05-07): when no enclosing entity exists for the chunk, fall back
  // to the FIRST entity that starts within the chunk range. This catches cases
  // like fastify lib/reply.js:64-225 where the chunk spans the Reply function
  // (64-76) plus prototype methods later — no single entity contains the chunk,
  // but Reply is the topmost identifier and matches the gold ("send" / "Reply"
  // / "buildReply"). Only applies in fallback path where meta.name is also null.
  let firstContained = null;
  if (codeGraphRepo && typeof codeGraphRepo.findFirstEntityInRange === 'function' && !meta.name) {
    try {
      firstContained = codeGraphRepo.findFirstEntityInRange(filePath, origStart, origEnd);
    } catch { firstContained = null; }
  }

  // Try sibling chunk merge (contiguous chunks in the same file)
  const intervals = locationMap?.get(filePath);
  if (intervals && intervals.length > 1) {
    const merged = mergeSiblingChunks(intervals, origStart, origEnd, tokenCap);
    if (merged) {
      // F5: when the merged range spans a previously-unseen entity, label it.
      let mergedFirstContained = firstContained;
      if (!meta.name && !mergedFirstContained && codeGraphRepo
          && typeof codeGraphRepo.findFirstEntityInRange === 'function') {
        try {
          mergedFirstContained = codeGraphRepo.findFirstEntityInRange(filePath, merged.startLine, merged.endLine);
        } catch { /* keep original firstContained */ }
      }
      return {
        startLine: merged.startLine,
        endLine: merged.endLine,
        expanded: true,
        expandedFrom: origRange,
        symbol: meta.name || mergedFirstContained?.name || null,
        symbolType: meta.type || mergedFirstContained?.type || null,
        kind: 'syntax',
      };
    }
  }

  // Syntax-aware fallback: expand to enclosing block using brace/indent analysis.
  // This catches cases where the code graph has no entity but the file is readable.
  // Skipped when 'no-syntax-expansion' ablation is active.
  if (opts.ablations?.has('no-syntax-expansion')) {
    return {
      startLine: origStart, endLine: origEnd,
      expanded: false, expandedFrom: null,
      symbol: meta.name || null, symbolType: meta.type || null,
      kind: 'chunk',
    };
  }
  const { fileCache, projectRoot } = opts;
  const syntaxExpanded = expandBySyntax(
    fileCache, filePath, origStart, origEnd, tokenCap, projectRoot
  );
  if (syntaxExpanded) {
    // F5: when syntax expansion enlarges the range, the new range may contain
    // entities the raw chunk didn't. Re-lookup the first contained entity in
    // the expanded range so chunks like fastify lib/reply.js:139-192 (no
    // entities) → 64-225 (contains Reply at 64-76) get a meaningful symbol.
    let syntaxFirstContained = firstContained;
    if (!meta.name && !syntaxFirstContained && codeGraphRepo
        && typeof codeGraphRepo.findFirstEntityInRange === 'function') {
      try {
        syntaxFirstContained = codeGraphRepo.findFirstEntityInRange(filePath, syntaxExpanded.startLine, syntaxExpanded.endLine);
      } catch { /* keep firstContained */ }
    }
    return {
      startLine: syntaxExpanded.startLine,
      endLine: syntaxExpanded.endLine,
      expanded: true,
      expandedFrom: origRange,
      symbol: meta.name || syntaxFirstContained?.name || null,
      symbolType: meta.type || syntaxFirstContained?.type || null,
      kind: 'syntax',
    };
  }

  // Fallback: return as-is
  return {
    startLine: origStart,
    endLine: origEnd,
    expanded: false,
    expandedFrom: null,
    symbol: meta.name || firstContained?.name || null,
    symbolType: meta.type || firstContained?.type || null,
    kind: 'chunk',
  };
}

/**
 * Build a "symbol sandwich" expansion when the enclosing entity is too large
 * to fit in the token cap as a whole.
 *
 * The sandwich preserves:
 *   - the gold/matched chunk verbatim (the actual evidence — never dropped)
 *   - the function/class signature (small, high-leverage anchor)
 *   - the closing brace line (cheap, helps the agent know the symbol bounds)
 * separated by explicit `// ... (N lines elided) ...` markers.
 *
 * Sizing uses a conservative ~10-tokens-per-line estimate (matches the rest
 * of the file). If even bare gold doesn't fit, returns null so the caller
 * falls back to the bare-chunk path. If the signature+gold+closing doesn't
 * fit, drops closing first, then signature.
 *
 * @param {{ name:string, type:string, startLine:number, endLine:number }} entity
 * @param {number} origStart - gold chunk start line
 * @param {number} origEnd - gold chunk end line
 * @param {number} tokenCap - hard cap for the assembled sandwich
 * @returns {{ parts: Array, elidedHead:number, elidedTail:number, elisionMarkers:number }|null}
 */
function buildSandwichExpansion(entity, origStart, origEnd, tokenCap) {
  const SIG_MAX_LINES = 4;        // signature window
  const ELISION_TOKENS = 10;      // approx cost of one `// ... (N lines elided) ...` line
  const TOKENS_PER_LINE = 10;     // pessimistic estimate, matches `entityTokens` heuristic above

  // Signature: from entity.startLine up to min(SIG_MAX_LINES, just before gold)
  const sigStart = entity.startLine;
  const sigEndCandidate = Math.min(entity.startLine + SIG_MAX_LINES - 1, origStart - 1);
  const hasSignatureCandidate = sigEndCandidate >= sigStart && origStart > entity.startLine;
  const sigEnd = hasSignatureCandidate ? sigEndCandidate : null;
  const sigLines = sigEnd != null ? (sigEnd - sigStart + 1) : 0;

  // Gold: original chunk
  const goldLines = origEnd - origStart + 1;

  // Closing: just the last line of the entity, only if it's strictly after gold
  const closeLineCandidate = entity.endLine > origEnd ? entity.endLine : null;
  const closingLines = closeLineCandidate != null ? 1 : 0;

  // Elisions (gaps between parts). Only emit a marker if there's actually a gap.
  const headElidedAll = sigEnd != null && origStart > sigEnd + 1 ? origStart - sigEnd - 1 : 0;
  const tailElidedAll = closeLineCandidate != null && closeLineCandidate > origEnd + 1
    ? closeLineCandidate - origEnd - 1
    : 0;

  // Token estimates
  const goldTokens = goldLines * TOKENS_PER_LINE;
  if (goldTokens > tokenCap) {
    // Even gold alone doesn't fit. Caller will fall back to bare-chunk + truncate.
    return null;
  }

  const sigTokens = sigLines * TOKENS_PER_LINE;
  const closingTokens = closingLines * TOKENS_PER_LINE;

  // Decide which optional parts to include, in priority order:
  // 1. Always include gold.
  // 2. Include signature if it fits (signature is the biggest grounding win).
  // 3. Include closing if it fits (cheap).
  let includeSignature = sigEnd != null;
  let includeClosing = closeLineCandidate != null;

  function totalTokens() {
    let t = goldTokens;
    let elisions = 0;
    if (includeSignature) {
      t += sigTokens;
      if (headElidedAll > 0) elisions++;
    }
    if (includeClosing) {
      t += closingTokens;
      if (tailElidedAll > 0) elisions++;
    }
    return t + elisions * ELISION_TOKENS;
  }

  if (totalTokens() > tokenCap && includeClosing) {
    includeClosing = false;
  }
  if (totalTokens() > tokenCap && includeSignature) {
    includeSignature = false;
  }

  // If neither signature nor closing fits, sandwich gives no value over bare chunk.
  if (!includeSignature && !includeClosing) {
    return null;
  }

  const parts = [];
  if (includeSignature) {
    parts.push({ kind: 'signature', startLine: sigStart, endLine: sigEnd });
  }
  parts.push({ kind: 'gold', startLine: origStart, endLine: origEnd });
  if (includeClosing) {
    parts.push({ kind: 'closing', startLine: closeLineCandidate, endLine: closeLineCandidate });
  }

  const elidedHead = includeSignature && headElidedAll > 0 ? headElidedAll : 0;
  const elidedTail = includeClosing && tailElidedAll > 0 ? tailElidedAll : 0;
  const elisionMarkers = (elidedHead > 0 ? 1 : 0) + (elidedTail > 0 ? 1 : 0);

  return { parts, elidedHead, elidedTail, elisionMarkers };
}

/**
 * Render a sandwich expansion into a single code string with elision markers.
 * Reads each part from the file cache and joins them with explicit
 * `// ... (N lines elided) ...` markers between non-contiguous parts.
 *
 * Returns '' if no part can be read (caller falls back to chunk path).
 */
function assembleSandwichCode(fileCache, filePath, sandwich, projectRoot) {
  if (!sandwich || !sandwich.parts || sandwich.parts.length === 0) return '';
  const out = [];
  let prevEnd = null;
  for (const part of sandwich.parts) {
    const text = readFileRange(fileCache, filePath, part.startLine, part.endLine, projectRoot);
    if (!text) continue;
    if (prevEnd != null) {
      const gap = part.startLine - prevEnd - 1;
      if (gap > 0) out.push(`// ... (${gap} lines elided) ...`);
    }
    out.push(text);
    prevEnd = part.endLine;
  }
  return out.join('\n');
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

/**
 * Walk upward from `baseStartLine` to absorb leading trivia (doc comments,
 * attributes, decorators) that document the symbol. This recovers context
 * the judge keeps asking for: ripgrep `#[non_exhaustive]`, JSDoc above
 * the function, Python decorators, Rust `///` and `//!` doc lines.
 *
 * Caps at 30 lines back so we never blow the budget on accidentally
 * absorbing a previous symbol's body. Returns the adjusted startLine
 * (never less than 1, never above baseStartLine).
 *
 * @param {string} filePath
 * @param {number} baseStartLine
 * @param {Map} fileCache
 * @param {string} projectRoot
 * @param {string} lang
 * @returns {number}
 */
export function expandLeadingTrivia(filePath, baseStartLine, fileCache, projectRoot, lang) {
  if (!filePath || !baseStartLine || baseStartLine <= 1) return baseStartLine;
  const windowStart = Math.max(1, baseStartLine - 30);
  const text = readFileRange(fileCache, filePath, windowStart, baseStartLine - 1, projectRoot);
  if (!text) return baseStartLine;
  const lines = text.split('\n');

  // Walk lines BACKWARDS, classifying each:
  //   - trivia line (doc / attr / decorator)  → mark as the new topmost
  //   - blank line                            → tolerated INSIDE a doc run,
  //                                              but not absorbed (the blank
  //                                              above the topmost trivia
  //                                              row stays attached to the
  //                                              prior code, not the symbol)
  //   - anything else (code / punct / close)  → stop
  let topmostTrivia = baseStartLine;   // 1-based absolute, only moves on trivia
  for (let idx = lines.length - 1; idx >= 0; idx--) {
    const raw = lines[idx];
    const ln = windowStart + idx;
    if (ln >= baseStartLine) continue;
    const trimmed = raw.trim();
    if (trimmed === '') {
      // Tolerate blank gaps inside the doc run but DO NOT include them: the
      // returned line is always the topmost actual trivia row.
      continue;
    }
    let isTrivia = false;
    if (lang === 'rust') {
      // /// and //! doc comments, #[attr] / #![attr], block comments,
      // // regular comments adjacent to a doc run.
      isTrivia = /^(\/\/[!/]?|\/\*\*?|\*\/?|\*\s|#\!?\[)/.test(trimmed);
    } else if (lang === 'go') {
      isTrivia = /^\/\//.test(trimmed);
    } else if (lang === 'python') {
      // Decorators, comments, and raw docstring lines (rare directly above def)
      isTrivia = /^@\w/.test(trimmed) || /^#/.test(trimmed)
        || /^['"]{3}/.test(trimmed);
    } else {
      // JS/TS/Java/C-style: //, /** ... */, *, decorators (TS @Decorator)
      isTrivia = /^(\/\/|\/\*\*?|\*\/?|\*\s|@\w)/.test(trimmed);
    }
    if (!isTrivia) break;
    topmostTrivia = ln;
  }
  return topmostTrivia;
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
 * Handles multi-line constructs that the previous line-by-line filter
 * dropped on the floor (the dominant cause of "missing alias" judge
 * complaints, e.g. fastify uses
 *   const { kSchemaParams: paramsSchema, ... } = require('./symbols')
 * spanning 5+ lines — the body uses `paramsSchema`, but only the multi-line
 * form maps it back to `kSchemaParams`):
 *
 *   - JS/TS: ES `import { a, b } from 'x'` (multi-line)
 *           `const { a, b } = require('x')` (multi-line, with `kKey: alias`)
 *           `export { ... } from '...'`
 *   - Go: `import (...)` blocks (with aliases like `alias "path"`)
 *   - Python: `import x` / `from x import (a, b, c)` (multi-line with parens)
 *   - Rust: `use foo::{bar, baz}` (multi-line grouped) + `pub use` + extern crate
 *
 * Output is one logical statement per array entry; multi-line statements
 * are joined with a space so the consumer (header rendering, identifier
 * scan) sees a single string per import.
 */
function extractImportLines(headerText, lang) {
  const lines = headerText.split('\n');

  // ── Generic multi-line statement collector ───────────────────────────────
  // Walk lines, accumulate balanced bracket levels for each "starter" we
  // recognise, emit when the statement closes. Falls back to single-line
  // emission for languages where a statement ends at EOL.
  const out = [];

  if (lang === 'go') {
    // Go: capture `import (...)` block contents (each line) and single `import "..."`
    let inBlock = false;
    for (const line of lines) {
      if (/^\s*import\s*\(/.test(line)) { inBlock = true; continue; }
      if (inBlock) {
        if (/^\s*\)/.test(line)) { inBlock = false; continue; }
        if (line.trim()) out.push(line.trimEnd());
      } else if (/^\s*import\s+(\w+\s+)?"/.test(line)) {
        out.push(line.trimEnd());
      }
    }
    return out;
  }

  if (lang === 'python') {
    // Python: `import x`, `from x import y`, `from x import (a, b, ...)`
    // multi-line via parens or trailing backslash.
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*(import\s+\w|from\s+[.\w]+\s+import)/.test(line)) {
        let stmt = line.trimEnd();
        // Continue while line ends with backslash or has unbalanced (
        const opens = () => (stmt.match(/\(/g) || []).length;
        const closes = () => (stmt.match(/\)/g) || []).length;
        const continued = () => /\\\s*$/.test(stmt) || opens() > closes();
        while (continued() && i + 1 < lines.length) {
          stmt = stmt.replace(/\\\s*$/, '').trimEnd() + ' ' + lines[++i].trim();
        }
        out.push(stmt);
      }
      i++;
    }
    return out;
  }

  if (lang === 'rust') {
    // Rust: `use foo::{bar, baz}` (possibly multi-line via { ... });
    // also `pub use ...;` and `extern crate ...;` (single line).
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*(pub\s+)?use\s+/.test(line) || /^\s*extern\s+crate\s+/.test(line)) {
        let stmt = line.trimEnd();
        // Continue until we see the terminating `;`
        while (!/;\s*(\/\/.*)?$/.test(stmt) && i + 1 < lines.length) {
          stmt += ' ' + lines[++i].trim();
        }
        out.push(stmt);
      }
      i++;
    }
    return out;
  }

  // JS/TS/default — handle multi-line ES imports and CommonJS destructured requires.
  // Examples we want to capture as ONE logical line:
  //   import {
  //     foo,
  //     bar as baz,
  //   } from 'mod'
  //   const {
  //     kSchemaParams: paramsSchema,
  //     kSchemaBody: bodySchema,
  //   } = require('./symbols')
  //   const x = require('./y')
  //   export { a, b } from './x'
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const isStartES = /^\s*(import|export)\s/.test(line);
    // CJS detector: start at any line that begins a const/let/var declaration.
    // We accumulate continuation lines until brackets balance, THEN filter to
    // only keep statements that prove themselves to be import-like (contain
    // `require(...)` or destructured-assignment from a bracketed expression).
    const isStartCJS = /^\s*(const|let|var)\s+/.test(line)
      && (/\brequire\s*\(/.test(line) || /\{[^}]*$/.test(line));
    if (isStartES || isStartCJS) {
      let stmt = line.trimEnd();
      const opens = () => (stmt.match(/[{(]/g) || []).length;
      const closes = () => (stmt.match(/[})]/g) || []).length;
      // Continue while open brackets exceed closes OR statement ends with comma
      // (suggests a continuation line for object / list).
      while ((opens() > closes() || /,\s*(\/\/.*)?$/.test(stmt))
             && i + 1 < lines.length) {
        stmt += ' ' + lines[++i].trim();
        if (opens() === closes() && /;\s*$/.test(stmt)) break;
      }
      // Only keep statements that look like imports (drop unrelated
      // const/let assignments that happened to span lines).
      if (/\b(import|require\s*\(|from\s+['"]|export\s*\{)/.test(stmt)) {
        out.push(stmt);
      }
    }
    i++;
  }
  return out;
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

/**
 * Hard-cap a multi-line text block to a token budget by dropping trailing lines.
 * Used after formatting steps that may otherwise overshoot the remaining budget.
 *
 * @param {string} text
 * @param {number} tokenCap
 * @returns {string}
 */
function clampTextToTokenCap(text, tokenCap) {
  if (!text || tokenCap <= 0) return '';
  if (estimateTokens(text) <= tokenCap) return text;

  const lines = text.split('\n');
  while (lines.length > 0) {
    lines.pop();
    const candidate = lines.join('\n');
    if (candidate && estimateTokens(candidate) <= tokenCap) {
      return candidate;
    }
  }

  return '';
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
 * Identifiers that look like external references the body uses but does
 * NOT define. We treat anything matching `\b[A-Za-z_][A-Za-z0-9_]{2,}\b`
 * (≥3 chars), excluding language keywords and the symbol's own name.
 * Returns a Set, lower-cased keys plus the original case for diagnostics.
 */
function extractCodeIdentifiers(code, ownSymbolName) {
  const out = new Set();
  if (!code) return out;
  const matches = code.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
  const ownLower = (ownSymbolName || '').toLowerCase();
  for (const id of matches) {
    if (LANG_KEYWORDS.has(id)) continue;
    if (id.toLowerCase() === ownLower) continue;
    // Drop pure numerics and trivially-short tokens already filtered.
    out.add(id);
  }
  return out;
}

/**
 * Decide whether the body's referenced identifiers are all locally
 * resolvable from headerContext + neighbours + the body itself
 * (i.e. the symbol introduces or imports them all). Used by the
 * stricter `computeSufficiency` rule.
 *
 * Identifiers count as resolved when they are:
 *   - mentioned in `headerContext` (any kind of import/require line)
 *   - mentioned in `neighborsRendered` (callees/imports we surfaced)
 *   - declared inside `code` itself (e.g. const x = ..., function x ...,
 *     parameters in the symbol signature) — detected as identifiers that
 *     appear in lvalue positions (`const X`, `let X`, `function X`,
 *     `class X`, function parameters)
 */
function unresolvedExternalRefs(code, ownSymbolName, headerContext, neighborsRendered) {
  const externals = extractCodeIdentifiers(code, ownSymbolName);
  if (!externals.size) return new Set();
  const resolvedHaystack = (headerContext || '') + '\n' + (neighborsRendered || '');
  // Approximate "declared locally in this code block": any identifier that
  // appears in an lvalue-ish position. We only need a rough check, false
  // positives here just mean "looks self-contained" (which is fine).
  const localDecls = new Set();
  const lvalueRe = /\b(?:const|let|var|function|class|fn|def|struct|enum|trait|impl|type|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = lvalueRe.exec(code))) localDecls.add(m[1]);
  // Function-parameter approximation: capture top-of-block `(...)` after the symbol name.
  const sigRe = new RegExp(`\\b${(ownSymbolName || '').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\(([^)]*)\\)`);
  if (ownSymbolName) {
    const sig = code.match(sigRe);
    if (sig) {
      for (const part of sig[1].split(/[,\s]+/)) {
        const id = part.replace(/[:=\[\]?<>]/g, '').replace(/\.\.\./, '').trim();
        if (id) localDecls.add(id);
      }
    }
  }
  const unresolved = new Set();
  for (const id of externals) {
    if (localDecls.has(id)) continue;
    if (resolvedHaystack.includes(id)) continue;
    unresolved.add(id);
  }
  return unresolved;
}

/**
 * Compute sufficiency signal — does the returned context likely contain
 * enough information to answer the query?
 *
 * Tightened rule (May 2026 — addresses the dominant agent-bench loss
 * pattern): a complete symbol on its own is NOT sufficient. We also
 * require either (a) the symbol's external references are resolved
 * (header imports + 1-hop graph neighbours), or (b) the symbol is
 * provably self-contained (no unresolved external identifiers).
 *
 * Reasons emitted (independent signals, kept for diagnostics):
 *   - complete_symbol     : top-1 is a full, non-truncated symbol
 *   - header_resolved     : top-1 has resolved import/header context
 *   - neighbors_present   : the package surfaced ≥1 1-hop graph neighbour
 *   - self_contained_strict: every external identifier in the body is
 *                            either declared locally, in headerContext,
 *                            or in the surfaced neighbours list
 *   - high_confidence     : score gap puts top-1 well ahead of top-2
 *
 * Query-conditioned rule (July 2026 — full200 bench forensics showed the
 * structural rule mislabels systemically: `confidence=low sufficient=YES`
 * was the modal trailer, 156×, and reasons were structural in ~all cases):
 * the verdict is now 3-valued and REQUIRES positive query-match evidence
 * in top-1 (see core/search/query-sufficiency.js):
 *
 *   yes     := strong query evidence (exact anchor hit or high subtoken
 *              overlap) AND (confidence=high OR (confidence=medium AND
 *              structural resolution))
 *   no      := no results, or a query with real anchors finding nothing
 *              in top-1 (confirmed absence)
 *   unknown := everything ambiguous (incl. the old structural-only YES,
 *              now reported as reason=well_formed_only)
 *
 * Structural facts (complete_symbol / header_resolved / neighbors_present /
 * self_contained_strict) are kept as diagnostic reasons and as the
 * resolution gate for medium-confidence YES — they can no longer produce
 * YES on their own. `sufficient` (boolean) stays = (verdict === 'yes') for
 * every structured consumer (MCP zod schema, bench counters).
 *
 * @param {object} topResult
 * @param {{ confidence: string }} confidenceInfo
 * @param {{ query?: string, regex?: string, lowerResults?: object[] }} [queryContext]
 * @returns {{ sufficient: boolean, verdict: 'yes'|'no'|'unknown',
 *             sufficiencyReason: string, reasons: string[],
 *             unresolvedExternalCount: number, evidence: object|null }}
 */
export function computeSufficiency(topResult, confidenceInfo, queryContext = {}) {
  const reasons = [];

  const isComplete = !!(topResult.symbol &&
    topResult.presentation === 'full' &&
    !topResult.code?.includes('// ... ('));
  if (isComplete) reasons.push('complete_symbol');

  const hasHeader = !!topResult.headerContext;
  if (hasHeader) reasons.push('header_resolved');

  const hasNeighbors = !!(topResult.neighbors && topResult.neighbors.count > 0);
  if (hasNeighbors) reasons.push('neighbors_present');

  // Strict self-containment: only fires if the body has zero unresolved
  // external identifiers (after considering header + neighbours + locals).
  let unresolvedCount = 0;
  if (isComplete && topResult.code) {
    const unresolved = unresolvedExternalRefs(
      topResult.code,
      topResult.symbol,
      topResult.headerContext || '',
      topResult.neighbors?.rendered || ''
    );
    unresolvedCount = unresolved.size;
    if (unresolvedCount === 0) reasons.push('self_contained_strict');
  }

  if (confidenceInfo?.confidence === 'high') reasons.push('high_confidence');

  const hasResolution = hasHeader || hasNeighbors || reasons.includes('self_contained_strict');

  // Query-conditioned verdict: structural facts are the resolution gate,
  // never the whole answer. See query-sufficiency.js for the fusion rule.
  const { verdict, reason: sufficiencyReason, evidence } = computeSufficiencyVerdict({
    topResult,
    confidenceInfo,
    query: queryContext.query || '',
    regex: queryContext.regex || '',
    structural: { isComplete, hasResolution },
    lowerResults: queryContext.lowerResults || [],
  });

  if (evidence?.exactHit) reasons.push('query_literal_matched');
  else if (evidence?.strength === 'strong') reasons.push('query_token_overlap');
  else if (evidence?.strength === 'none') reasons.push('no_query_evidence');

  return {
    sufficient: verdict === 'yes',
    verdict,
    sufficiencyReason,
    reasons,
    unresolvedExternalCount: unresolvedCount,
    evidence,
  };
}

// =============================================================================
// Graph-neighbour reservation (Phase 6) — 1-hop neighbours for top-1
// =============================================================================

/**
 * Extract identifier candidates from a code body that look like type names
 * (struct / interface / class / enum / trait / type). Used by the
 * graph-neighbour tier to find type definitions that the relationships
 * table didn't capture as explicit edges (the canonical failure case is
 * gin:http-dispatch — `methodTree` is an unexported Go struct referenced
 * via a field-of-field, never as a direct relationship edge).
 *
 * Heuristic: any token ≥3 chars containing at least one uppercase AND at
 * least one lowercase letter (Pascal/camelCase). This captures both
 * exported types (`Engine`, `Context`, `ErrorKind`) and unexported Go
 * types (`methodTree`, `nodeType`). It deliberately rejects:
 *   - all-uppercase SCREAMING_SNAKE_CASE constants
 *   - all-lowercase variables / function names
 *   - language keywords
 *   - the symbol's own name
 *
 * False positives (e.g. method names in camelCase) are cheap because the
 * downstream SQL lookup ALSO filters by entity type, so a camelCase
 * function name won't match a struct/interface/class entity.
 *
 * @param {string} code
 * @param {string|null} ownName - the symbol's own name, excluded from results
 * @returns {string[]}
 */
function extractTypeCandidates(code, ownName) {
  if (!code) return [];
  const matches = code.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
  const own = (ownName || '').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const id of matches) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (LANG_KEYWORDS.has(id)) continue;
    if (id.toLowerCase() === own) continue;
    // Require BOTH upper and lower (Pascal/camelCase). Filters out
    // SCREAMING_SNAKE constants AND all-lowercase variables. A pure
    // single-word lowercase token like `trees` is rejected — most
    // unexported Go types are camelCase like `methodTree` and survive.
    if (!/[A-Z]/.test(id)) continue;
    if (!/[a-z]/.test(id)) continue;
    out.push(id);
  }
  // Cap the candidate list — DB lookup is bounded but we still pay query cost.
  return out.slice(0, 32);
}

/**
 * Render a one-hop graph-neighbour tier for the top-1 result. This addresses
 * the dominant loss pattern in the agent benchmark: ss-search returned a
 * tight, "complete" symbol, the agent stopped at one tool call, and the
 * judge then complained the answer didn't surface CALLERS, IMPORTED
 * SYMBOLS, or HELPER FUNCTIONS that the chunk plainly references.
 *
 * The renderer:
 *   - asks the code graph for outgoing relationships (calls / imports / uses /
 *     extends / implements / overrides / throws) from top-1's entity,
 *   - asks for incoming callers / users (top-K by weight),
 *   - dedupes anything whose target file:line range overlaps a result that
 *     is already in the ranked pack (no point spending budget on a row the
 *     agent already sees),
 *   - groups by edge family and renders compact one-liners that include the
 *     target's `file:line` so the agent can cite the neighbour directly,
 *   - hard-caps the rendered text at `tokenCap`. The result is fully
 *     elidable — when the cap is 0, the function returns null.
 *
 * @param {object} opts
 * @param {object} opts.codeGraphRepo - CodeGraphRepository instance
 * @param {object} opts.entity        - { id, filePath, startLine, endLine, name, type }
 * @param {Set<string>} opts.skipKeys - "file|startLine|endLine" of results already in the pack
 * @param {number} opts.tokenCap      - max tokens for the rendered tier
 * @param {string} [opts.body]        - top-1 code body, used to discover
 *   referenced TYPE names (struct/interface/class/...) that the
 *   relationships table doesn't capture as explicit edges
 * @returns {{ rendered: string, count: number, tokens: number,
 *             outgoingCount: number, incomingCount: number,
 *             typeRefCount: number }|null}
 */
export function renderGraphNeighbors(opts) {
  const { codeGraphRepo, entity, skipKeys, tokenCap = 0, body = '' } = opts;
  if (!codeGraphRepo || !entity || !entity.id || tokenCap <= 0) return null;

  const OUT_TYPES = ['imports', 'calls', 'uses', 'extends', 'implements', 'overrides', 'throws'];
  const IN_TYPES = ['calls', 'uses', 'extends', 'implements'];
  // typeAlias is what Go's graph extractor stores for struct/interface/type
  // declarations; the others cover JS/TS/Java/Rust/Python conventions.
  const TYPE_KINDS = ['struct', 'class', 'interface', 'enum', 'trait', 'type', 'typeAlias'];

  let outgoing = [];
  let incoming = [];
  let typeRefs = [];
  try { outgoing = codeGraphRepo.getOutgoingRelationships(entity.id, { types: OUT_TYPES, limit: 16 }) || []; }
  catch { outgoing = []; }
  try { incoming = codeGraphRepo.getIncomingRelationships(entity.id, { types: IN_TYPES, limit: 8 }) || []; }
  catch { incoming = []; }

  // Type-reference discovery: extract identifiers from the body and ask the
  // graph for entities of struct/interface/class/enum/trait/type/typeAlias
  // with that name. This recovers the case the relationships table misses —
  // e.g. a Go method whose receiver field has type `methodTrees []methodTree`
  // never gets a 'calls/imports/uses' edge to `methodTree`, yet the agent
  // needs that type's defining file:line to give a correct answer
  // (gin:http-dispatch was the canonical failure).
  //
  // Dedup uses range-based skipKeys (NOT excludeFile) — same-file types
  // matter when top-1 is a method and the receiver struct lives next to
  // it (e.g. Engine in gin.go vs handleHTTPRequest in gin.go).
  if (body && typeof codeGraphRepo.findEntitiesByNames === 'function') {
    try {
      const ids = extractTypeCandidates(body, entity.name);
      if (ids.length) {
        typeRefs = codeGraphRepo.findEntitiesByNames(ids, {
          types: TYPE_KINDS,
          limit: 8,
        }) || [];
      }
    } catch { typeRefs = []; }
  }

  if (outgoing.length === 0 && incoming.length === 0 && typeRefs.length === 0) return null;

  // Group by edge family for stable rendering. Each row is a one-liner.
  // Format:
  //   - imports paramsSchema → lib/symbols.js:14 [Symbol]
  //   - calls validateParam → lib/validation.js:118-144 [function]
  //   - caller handleRequest → lib/handle-request.js:88-104 [function]
  //   - imports module './x' (unresolved)
  const ownKey = `${entity.filePath}|${entity.startLine}|${entity.endLine}`;
  const seen = new Set([ownKey, ...(skipKeys || [])]);

  const formatLineRange = (a, b) => (a && b && b > a) ? `${a}-${b}` : `${a || '?'}`;

  const lines = [];
  // OUTGOING — group resolved targets first, then unresolved imports
  const grouped = new Map();
  for (const r of outgoing) {
    const fam = r.type;
    if (!grouped.has(fam)) grouped.set(fam, []);
    grouped.get(fam).push(r);
  }
  // Render order: imports, calls, uses, extends, implements, overrides, throws
  for (const fam of OUT_TYPES) {
    const rows = grouped.get(fam) || [];
    for (const r of rows) {
      let rendered;
      if (r.target && r.target.filePath) {
        const k = `${r.target.filePath}|${r.target.startLine}|${r.target.endLine}`;
        if (seen.has(k)) continue;          // already in the pack — skip
        seen.add(k);
        const range = formatLineRange(r.target.startLine, r.target.endLine);
        rendered = `- ${fam} ${r.target.name} → ${r.target.filePath}:${range} [${r.target.type}]`;
      } else if (r.fullImportPath) {
        rendered = `- ${fam} ${r.targetName} ← '${r.fullImportPath}' (unresolved)`;
      } else if (r.targetName && r.contextLine) {
        rendered = `- ${fam} ${r.targetName} (referenced at line ${r.contextLine})`;
      } else if (r.targetName) {
        rendered = `- ${fam} ${r.targetName}`;
      } else {
        continue;
      }
      lines.push(rendered);
    }
  }
  // INCOMING — flag as "caller" or "user"
  for (const r of incoming) {
    const s = r.source;
    if (!s) continue;
    const k = `${s.filePath}|${s.startLine}|${s.endLine}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const range = formatLineRange(s.startLine, s.endLine);
    const kind = r.type === 'calls' ? 'caller' : (r.type === 'uses' ? 'user' : r.type);
    lines.push(`- ${kind} ${s.name} ← ${s.filePath}:${range} [${s.type}]`);
  }

  // TYPE-REFERENCES — entities discovered by name from the body. Renders as
  // "type" prefix to disambiguate from the relationship-driven rows above.
  // Same dedup against skipKeys.
  for (const t of typeRefs) {
    const k = `${t.filePath}|${t.startLine}|${t.endLine}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const range = formatLineRange(t.startLine, t.endLine);
    lines.push(`- type ${t.name} → ${t.filePath}:${range} [${t.type}]`);
  }

  if (lines.length === 0) return null;

  // Hard-cap to tokenCap. Drop tail lines until it fits.
  let combined = lines.join('\n');
  while (estimateTokens(combined) > tokenCap && lines.length > 1) {
    lines.pop();
    combined = lines.join('\n');
  }
  if (estimateTokens(combined) > tokenCap) return null;

  return {
    rendered: combined,
    count: lines.length,
    tokens: estimateTokens(combined),
    outgoingCount: outgoing.length,
    incomingCount: incoming.length,
    typeRefCount: typeRefs.length,
  };
}

// =============================================================================
// Token budget allocation (Phase 3) — Fix #3: agent_preview / agent_full
// =============================================================================

/**
 * Adaptive budget allocation.
 *
 * Base split: 60/20/20 (preview) or 40/30/30 (full).
 * Adaptations:
 *   - High retrieval breadth (broad regex / large candidate pool): sharpen top-1 (70/15/15)
 *   - In agent_full: only expand rank 2/3 to full if score gap < 2× from top-1
 *   - Unused top-1 cap is redistributed to top-2/3 when they are distinct
 *
 * Breadth signal generalization (for non-grep retrieval modes):
 *   - colgrep / pattern: uses `grepMatches` (existing behavior)
 *   - lexical / semantic / hybrid: uses `candidatePoolSize` if provided
 *   - falls back to 0 (no sharpening) if neither is set
 *
 * @param {number} totalBudget - Total token budget for all results
 * @param {number} numResults - Number of results
 * @param {string} subMode - 'agent_preview' | 'agent_full' | 'agent_full_xl'
 * @param {object} [context]
 * @param {number} [context.grepMatches] - Number of grep matches (colgrep)
 * @param {number} [context.candidatePoolSize] - Generic candidate pool (lexical/semantic/hybrid)
 * @param {Array<{score: number, file: string}>} [context.results] - Ranked results for score-gap gating
 * @returns {Array<{ presentation: 'full'|'preview'|'summary', tokenCap: number }>}
 */
export function allocateBudget(totalBudget, numResults, subMode = 'agent_preview', context = {}) {
  const allocations = [];
  const isFullMode = subMode === 'agent_full' || subMode === 'agent_full_xl';
  const isXlMode = subMode === 'agent_full_xl';
  // Generalized breadth signal: prefer `grepMatches` for backwards compatibility,
  // fall back to `candidatePoolSize` for non-grep retrieval modes (lexical/semantic/hybrid).
  const breadthHint = context.grepMatches ?? context.candidatePoolSize ?? 0;
  const results = context.results || [];

  // Adaptive split based on retrieval breadth
  let top1Share, top23Share;
  if (breadthHint > 200) {
    // Broad retrieval: sharpen top-1, reduce previews
    top1Share = 0.70;
    top23Share = 0.15;
  } else if (isFullMode) {
    top1Share = 0.40;
    top23Share = 0.30;
  } else {
    top1Share = 0.60;
    top23Share = 0.20;
  }

  // Stretch budget (agent_full_xl): allow per-result caps up to 8000 for top-1
  // when the gate fires (top1 >= 2 * top2). This is opt-in via subMode only.
  const xlPerResultCap = 8000;
  const baselinePerResultCap = DEFAULT_PER_RESULT_CAPS[0]; // 2000
  let xlGateActive = false;
  if (isXlMode && results.length > 0) {
    const top1Score = results[0]?.score || 0;
    const top2Score = results[1]?.score || 0;
    // Gate fires when top-1 dominates: 2× top-2 OR there is no top-2.
    xlGateActive = top1Score > 0 && (top2Score === 0 || top1Score >= 2 * top2Score);
  }
  const top1HardCap = xlGateActive ? xlPerResultCap : baselinePerResultCap;

  for (let i = 0; i < numResults; i++) {
    if (i === 0) {
      const cap = Math.min(Math.floor(totalBudget * top1Share), top1HardCap);
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
  if (tokenCap <= 0) {
    return { code: '', truncated: true, originalTokens };
  }
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

  const buildCandidate = (lineCount) => {
    if (lineCount <= 0) return '';
    const truncated = lines.slice(0, lineCount).join('\n');
    const remaining = lines.length - lineCount;
    return remaining > 0
      ? `${truncated}\n// ... (${remaining} more lines)`
      : truncated;
  };

  for (let lineCount = cutLine; lineCount >= minLines; lineCount--) {
    const candidate = buildCandidate(lineCount);
    if (candidate && estimateTokens(candidate) <= tokenCap) {
      return { code: candidate, truncated: true, originalTokens };
    }
  }

  for (let lineCount = Math.min(minLines - 1, lines.length); lineCount >= 1; lineCount--) {
    const withSuffix = buildCandidate(lineCount);
    if (withSuffix && estimateTokens(withSuffix) <= tokenCap) {
      return { code: withSuffix, truncated: true, originalTokens };
    }

    const bare = lines.slice(0, lineCount).join('\n');
    if (bare && estimateTokens(bare) <= tokenCap) {
      return { code: bare, truncated: true, originalTokens };
    }
  }

  return { code: '', truncated: true, originalTokens };
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
 *
 * EXPLICIT TIERS (caller picks):
 *   'agent_preview' → 'agent_preview' (compact 4k budget)
 *   'agent_full'    → 'agent_full'    (8k budget)
 *   'agent_full_xl' → 'agent_full_xl' (12k budget, opt-in only;
 *                                      falls back to per-result baseline cap
 *                                      at allocation time when the top-1
 *                                      dominance gate fails)
 *
 * AUTO-PICK (default for the bare 'agent' format):
 *   'agent'         → tier chosen by selectAgentBudget(); see that fn.
 *
 * Used as a fallback when caller bypasses the auto-pick path (e.g. unit tests
 * that call resolveSubMode directly). Production code goes through
 * selectAgentBudget(format, signals) which understands auto-pick.
 */
function resolveSubMode(format) {
  if (format === 'agent_full_xl') return 'agent_full_xl';
  if (format === 'agent_full') return 'agent_full';
  return 'agent_preview'; // 'agent' and 'agent_preview' both map here
}

// =============================================================================
// Auto-tier selection — selectAgentBudget
// =============================================================================
//
// Picks the agent-mode budget tier (preview 4k / full 8k / xl 12k) from
// post-ranking signals when callers pass the bare format='agent'.
//
// DESIGN PRINCIPLE: 4k is enough for ~99% of queries.
//
// Lost-in-the-middle and RAG-vs-long-context studies (Liu et al., Xu et al.)
// consistently show that smaller, focused context outperforms bigger context
// for retrieval tasks. The preview tier already renders top-1 fully (up to
// 2000 tokens) and gives ranks 2-3 a signature + 5-line snippet — that's
// enough for the agent to either answer or to escalate via an explicit
// `format='agent_full'` re-query. Auto should NOT silently pay an 8k or 12k
// token bill on every borderline query.
//
// When does extra budget STRICTLY beat preview?
//
//   XL: top-1 itself needs >2k tokens. The dominance gate at allocation
//       (allocateBudget L1448-1454) raises top-1's per-result cap from 2k
//       → 8k IFF top-1 >= 2 * top-2. Without the gate, XL caps top-1 at
//       2k anyway — identical to preview for the top-1 case. So XL only
//       pays off when BOTH conditions hold: chunk really is big, AND
//       dominance gate will fire.
//
//   FULL: rank 2/3 need full body (each up to 2000 tokens) instead of a
//         signature + 5 lines. That's only useful when several results
//         are TIGHTLY tied — i.e. when there's no single answer, just a
//         set the agent must compare. A query with moderate dominance
//         (top-1 = 0.9, top-2 = 0.6) doesn't qualify; the agent can read
//         top-1 fully and re-query if needed.
//
// Decision tree (only fires when format='agent'; explicit tiers are pass-thru):
//
//   numResults == 0                                       → preview ('auto_empty')
//   top1Tokens >= 2400 AND (numResults == 1 OR D >= 2.5)  → xl      ('auto_xl_*')
//   numResults >= 10 AND D < 1.05 AND top1Tokens >= 600   → full    ('auto_full_tight_cluster')
//   default                                               → preview ('auto_preview_default')
//
// Thresholds are deliberately tight — designed so XL+FULL combined fire on
// roughly 1-5% of queries. On a fastify spot-check (NL queries with k=10),
// all 6 representative queries land on preview under this rule. Single
// dominant answers stay on preview unless the chunk is genuinely huge
// (200+ lines × 9 tokens/line ≥ 2400). Multi-result clusters need 10+ items
// within 5% of the top score before auto goes to full.
//
// Crucially: dominance answers "is top-1 the answer?", NOT "is top-1 big?".
// We require both signals (and a high-bar threshold on each) before paying
// the XL token cost. Likewise, "many results" alone is not a reason to
// upgrade — the cluster has to be tight (D < 1.05) AND deep (≥ 10 items).
//
// Signals (computeBudgetSignals, all post-ranking — pure):
//   - numResults  : ranked-results length
//   - dominance   : top1.score / top2.score (sentinel 99 for single result)
//   - top1Tokens  : estimated tokens of top-1 chunk (lineCount * 9, the
//                   same per-line conversion the rest of the packager uses).
//                   Equals 0 when start/end lines are unavailable — those
//                   results stay on preview.
//
// `breadth` (grepMatches / candidatePoolSize) and `entropy` are still
// computed and surfaced in `budgetSignals` for diagnostics, but neither
// drives the decision: a broad pool is not a reason to give top-1 more
// space, and small-N entropy is dominated by the 1/log(n) denominator and
// stops being a reliable distribution-width signal.

// Preview-tier budget: 3000 (was 4000 until 2026-06-11). The 4-model budget
// sweep (DeepSeek/MiMo/GPT-5.5-codex/Opus-CC, 12 dev probes, paired vs 4k)
// found 3k keeps every accuracy/usefulness metric flat-to-up with zero
// call-compensation, and cuts realized cost −11–15% on the flagship cells.
// Below 3k, flagship models re-buy the trimmed context with extra calls
// (Opus calls Δ: 3k −0.08 → 2.8k +0.33 → 2.5k +0.67 → 2k +0.83), erasing
// the savings — 3k is the floor. SWEET_SEARCH_PREVIEW_BUDGET overrides for
// experiments; full/xl escalation tiers are unchanged.
const PREVIEW_TIER_BUDGET = Number(process.env.SWEET_SEARCH_PREVIEW_BUDGET || '') || 3000;
const BUDGET_TIERS = {
  preview: { subMode: 'agent_preview', budget: PREVIEW_TIER_BUDGET },
  full:    { subMode: 'agent_full',    budget: 8000 },
  xl:      { subMode: 'agent_full_xl', budget: 12000 },
};

/**
 * Compute auto-pick signals from ranked results + searchStats.
 * Pure: does not look at file content or call into expensive code paths.
 *
 * @param {Array} rankedResults - Results after ranking pipeline (PRE-packaging)
 * @param {object} searchStats - Stats from the retrieval pipeline
 * @returns {{
 *   numResults: number, breadth: number, dominance: number,
 *   entropy: number, top1Tokens: number, top1LineCount: number
 * }}
 */
export function computeBudgetSignals(rankedResults, searchStats = {}) {
  const numResults = Array.isArray(rankedResults) ? rankedResults.length : 0;
  if (numResults === 0) {
    return { numResults: 0, breadth: 0, dominance: 0, entropy: 0, top1Tokens: 0, top1LineCount: 0 };
  }

  // Use whichever score field the ranker emitted. Pattern (colgrep) emits
  // `lateInteractionScore`; hybrid/semantic/lexical emit `score`. Keep both
  // paths working without renaming.
  const scores = rankedResults
    .map(r => Number(r?.score ?? r?.lateInteractionScore ?? 0))
    .filter(s => Number.isFinite(s) && s > 0);

  // Top-1 size proxy — derived from the chunk's start/end lines. Uses the
  // same 9 tokens/line conversion the rest of the packager applies (see
  // expandToSymbol / renderCode in structural-context.js). Returns 0 when
  // either bound is missing, in which case the auto-pick falls back to the
  // preview branch instead of guessing.
  const top1 = rankedResults[0] || {};
  const top1Start = top1.metadata?.startLine ?? top1.startLine ?? null;
  const top1End = top1.metadata?.endLine ?? top1.endLine ?? null;
  const top1LineCount = (top1Start != null && top1End != null && top1End >= top1Start)
    ? (top1End - top1Start + 1)
    : 0;
  const top1Tokens = top1LineCount * 9;

  if (scores.length === 0) {
    return { numResults, breadth: 0, dominance: 0, entropy: 0, top1Tokens, top1LineCount };
  }

  const topScore = scores[0];
  const secondScore = scores[1] ?? 0;
  // Sentinel "very high" dominance when there's only one positive-score result
  // — keeps single-answer queries on the preview path.
  const dominance = secondScore > 0 ? topScore / secondScore : 99;

  // Normalised Shannon entropy — KEPT FOR DIAGNOSTIC OUTPUT only. Not used
  // by selectAgentBudget after the small-N flaw was identified (2-result
  // entropy is forced into [0.7, 1.0] by the 1/log(n) denominator).
  let entropy = 0;
  if (scores.length > 1) {
    const sum = scores.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      let H = 0;
      for (const s of scores) {
        const p = s / sum;
        if (p > 0) H -= p * Math.log(p);
      }
      entropy = H / Math.log(scores.length);
    }
  }

  // Breadth — KEPT FOR DIAGNOSTIC OUTPUT only. Not used by tier selection
  // (broad candidate pools aren't a reason to give top-1 more tokens; only
  // top-1 actually being big is). `allocateBudget` still uses breadth for
  // its within-tier top-1-share sharpening (its job, not ours).
  const breadth = Number(
    searchStats?.grepMatches
    ?? searchStats?.candidatePoolSize
    ?? 0
  ) || 0;

  return { numResults, breadth, dominance, entropy, top1Tokens, top1LineCount };
}

/**
 * Pick the agent-mode tier for a request.
 *
 * Explicit tier formats (agent_preview / agent_full / agent_full_xl) are
 * pass-through. The bare 'agent' format triggers the auto-pick decision
 * tree using the signals above.
 *
 * Format-gating note: all return values keep `format='agent_*'` semantics,
 * so the `_isAgentFormat` ranking flag (file-kind-ranking.js:1443) remains
 * TRUE regardless of which tier we land on. Ranking is unchanged.
 *
 * @param {string} format - 'agent' | 'agent_preview' | 'agent_full' | 'agent_full_xl'
 * @param {object} signals - From computeBudgetSignals()
 * @param {object} [opts]
 * @param {number} [opts.explicitBudget] - Caller-supplied tokenBudget; if set,
 *   bypass auto-pick and infer the tier from the value (matches trace's
 *   selectBudget contract).
 * @returns {{ tier: 'preview'|'full'|'xl', subMode: string, tokenBudget: number, reason: string }}
 */
export function selectAgentBudget(format, signals, opts = {}) {
  // Explicit numeric budget always wins. Pass the value through unchanged
  // (callers that pass tiny budgets — e.g. `tokenBudget: 1` for hard-ceiling
  // tests — expect the packager to honour them as a strict cap). We only
  // clamp the value used for tier inference, so the subMode label stays sane.
  if (opts.explicitBudget != null && Number.isFinite(opts.explicitBudget)) {
    const n = Math.floor(opts.explicitBudget);
    const tierBound = Math.max(1000, Math.min(16000, n));
    const tier = tierBound >= 11000 ? 'xl' : tierBound >= 7000 ? 'full' : 'preview';
    return { tier, subMode: BUDGET_TIERS[tier].subMode, tokenBudget: n, reason: 'explicit_budget' };
  }

  // Explicit tier flags — caller is asking for a specific budget.
  if (format === 'agent_preview') {
    return { tier: 'preview', ...BUDGET_TIERS.preview, tokenBudget: BUDGET_TIERS.preview.budget, reason: 'explicit_preview' };
  }
  if (format === 'agent_full') {
    return { tier: 'full', ...BUDGET_TIERS.full, tokenBudget: BUDGET_TIERS.full.budget, reason: 'explicit_full' };
  }
  if (format === 'agent_full_xl') {
    return { tier: 'xl', ...BUDGET_TIERS.xl, tokenBudget: BUDGET_TIERS.xl.budget, reason: 'explicit_xl' };
  }

  // Auto-pick: format === 'agent' (or anything unrecognised — defensive).
  // Design target: preview fires on ~99% of queries; XL+FULL combined ~1-5%.
  const { numResults, dominance, top1Tokens } = signals || {};
  const N = Number(numResults) || 0;
  const D = Number.isFinite(dominance) ? dominance : 0;
  const T1 = Number(top1Tokens) || 0;

  const pick = (tier, reason) => ({
    tier,
    subMode: BUDGET_TIERS[tier].subMode,
    tokenBudget: BUDGET_TIERS[tier].budget,
    reason,
  });

  // Tight thresholds. Both upgrade paths require strong, hard-to-fake signals.
  //   XL_TOP1_TOKENS = ~267 lines × 9 t/line. Below this, top-1's render fits
  //                    inside the 2000-token per-result preview cap and XL
  //                    adds no usable budget.
  //   XL_DOMINANCE   = 2.5×. We need the dominance gate to FIRE at
  //                    allocation time (allocateBudget L1448-1454 needs
  //                    top1 ≥ 2 × top2); we add headroom (2.5 vs 2.0) so
  //                    we don't pick XL on borderline cases that the gate
  //                    might miss.
  //   FULL_MIN_N     = 10 results. Fewer than this and the agent can
  //                    re-read rank 2 (which is shown as a preview anyway).
  //   FULL_MAX_DOM   = 1.05. Strictly tied cluster — top-1 is at most 5%
  //                    ahead of top-2. Anything wider and the agent
  //                    can treat top-1 as the answer.
  //   FULL_MIN_TOP1  = 600 t (~67 lines). If top-1 is tiny, ranks 2-3
  //                    being expanded buys nothing — preview's signature
  //                    already shows everything.
  const XL_TOP1_TOKENS = 2400;
  const XL_DOMINANCE = 2.5;
  const FULL_MIN_N = 10;
  const FULL_MAX_DOM = 1.05;
  const FULL_MIN_TOP1 = 600;

  if (N === 0) return pick('preview', 'auto_empty');

  // XL path: huge top-1 that dominates. Single-result counts as "dominates"
  // (no top-2 to compete). Both branches gate on T1 >= XL_TOP1_TOKENS so we
  // never pick XL when extra space would go unused.
  if (T1 >= XL_TOP1_TOKENS) {
    if (N === 1) return pick('xl', 'auto_xl_single_huge');
    if (D >= XL_DOMINANCE) return pick('xl', 'auto_xl_dominant_huge_top1');
  }

  // FULL path: tightly-clustered multi-result set with non-trivial chunks.
  // All three conditions must hold — comparison-shaped queries with many
  // tied alternatives are the narrow profile where rank 2/3 full bodies
  // pay off. Single dominant answers and small clusters stay on preview.
  if (N >= FULL_MIN_N && D < FULL_MAX_DOM && T1 >= FULL_MIN_TOP1) {
    return pick('full', 'auto_full_tight_cluster');
  }

  // PREVIEW: default for ~99% of queries. The agent can always escalate
  // to full or xl with an explicit format flag if the answer needs more.
  return pick('preview', 'auto_preview_default');
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
 * @param {Set<string>} [opts.ablations] - Feature ablations for A/B testing:
 *   'no-syntax-expansion', 'no-header', 'no-diversity', 'no-adaptive-budget'
 * @returns {object} Agent mode response
 */
/**
 * Same-file span map (2026-07, within-file blind-spot fix). When the top-1
 * pack entry is a WINDOWED view of a file (kind chunk/sandwich/syntax — not
 * a fully-shown symbol) and the sufficiency verdict is not a clear YES, one
 * compact line names the sibling symbols immediately above/below the shown
 * window so the agent can sweep the fix surface instead of leaving the file
 * (the fhir/sushi-1175 miss shape: right file, bug 30 lines above the
 * window). Names+kinds+lines only — never bodies; ~25-45 tokens.
 *
 * @param {{ file:string, startLine:number, endLine:number }} top - top-1 agent result
 * @param {{ above:Array, below:Array }} adjacent - findAdjacentEntities() result
 * @returns {{ rendered:string, tokens:number, neighbors:Array }|null}
 */
export function buildSameFileMap(top, adjacent) {
  const above = adjacent?.above || [];
  const below = adjacent?.below || [];
  if (above.length === 0 && below.length === 0) return null;
  const shortType = t => (t === 'function' ? 'fn' : (t || 'sym'));
  const fmt = (e, pos) => `${e.name} (${shortType(e.type)} ${e.startLine}-${e.endLine} ${pos})`;
  const neighbors = [
    ...above.map(e => ({ ...e, position: 'above' })),
    ...below.map(e => ({ ...e, position: 'below' })),
  ];
  const parts = [
    ...above.map(e => fmt(e, 'above')),
    ...below.map(e => fmt(e, 'below')),
  ];
  // Placeholder-style drill-in hint (the v2.6.13 `ss-grep "<regex>" --in
  // <file>` convention, which agents demonstrably follow) — embedding the
  // live query costs ~25-30 tokens per pack for no extra signal.
  const rendered = `# same file: ${parts.join(' · ')} — sweep: ss-semantic ${top.file} "<query>"`;
  return { rendered, tokens: estimateTokens(rendered), neighbors };
}

export function packageForAgent(rankedResults, searchStats, opts) {
  const {
    query,
    regex,
    mode: modeOpt = null,
    format: formatOpt = 'agent',
    codeGraphRepo = null,
    locationMap = null,
    projectRoot,
    _isAgentFormat = false,
  } = opts;
  const ablations = opts.ablations || new Set();

  // Auto-tier selection: pick preview / full / xl based on score-distribution
  // signals when format='agent'. Explicit format=='agent_preview|full|full_xl'
  // and explicit numeric tokenBudget remain as overrides. Mirrors trace's
  // adaptive selectBudget (core/graph/structural-context.js:37). See
  // selectAgentBudget() above for the decision tree.
  //
  // Disabled by 'no-auto-budget' ablation — falls back to the legacy
  // resolveSubMode mapping (which treats 'agent' as 'agent_preview').
  let subMode, tokenBudget, budgetReason, budgetSignals;
  if (ablations.has('no-auto-budget')) {
    subMode = resolveSubMode(formatOpt);
    const defaultBudget = subMode === 'agent_full_xl' ? AGENT_FULL_XL_TOKEN_BUDGET
      : subMode === 'agent_full' ? AGENT_FULL_TOKEN_BUDGET
      : DEFAULT_TOKEN_BUDGET;
    tokenBudget = opts.tokenBudget ?? defaultBudget;
    budgetReason = 'ablation_no_auto_budget';
    budgetSignals = null;
  } else {
    budgetSignals = computeBudgetSignals(rankedResults, searchStats);
    const pick = selectAgentBudget(formatOpt, budgetSignals, {
      explicitBudget: opts.tokenBudget,
    });
    subMode = pick.subMode;
    tokenBudget = pick.tokenBudget;
    budgetReason = pick.reason;
  }

  const start = performance.now();
  const fileCache = new Map();

  // Locality clustering: pull up to two non-overlapping companion results
  // from the SAME file as top-1 (when their score is competitive, ≥ top-1/3)
  // ahead of unrelated higher-scoring distractors. This addresses the
  // dominant agent-bench loss pattern where the right helper symbol existed
  // in the ranked list at rank 4 but got demoted to summary because a
  // tangential file scored slightly higher. Top-1 is never moved.
  // Disabled by 'no-locality-cluster' ablation.
  let workingResults = rankedResults;
  if (!ablations.has('no-locality-cluster') && rankedResults.length >= 3) {
    const top = rankedResults[0];
    const topFile = top?.metadata?.file || top?.file;
    const topScore = top?.score || top?.lateInteractionScore || 0;
    if (topFile && topScore > 0) {
      const sameFile = [];
      const other = [];
      for (let i = 1; i < rankedResults.length; i++) {
        const r = rankedResults[i];
        const f = r.metadata?.file || r.file;
        const s = r.score || r.lateInteractionScore || 0;
        // Don't pull up overlapping same-file ranges (those are diversity dups).
        const ts = top.metadata?.startLine || top.startLine;
        const te = top.metadata?.endLine || top.endLine;
        const rs = r.metadata?.startLine || r.startLine;
        const re = r.metadata?.endLine || r.endLine;
        const overlapsTop = (rs != null && re != null && ts != null && te != null)
          && rs <= te + 10 && re >= ts - 10;
        if (f === topFile && s >= topScore / 3 && !overlapsTop) sameFile.push(r);
        else other.push(r);
      }
      // Promote up to 2 companion results into ranks 2 and 3, push the
      // rest behind. We deliberately keep `score` untouched so callers
      // can still inspect the original ranking signal.
      workingResults = [top, ...sameFile.slice(0, 2), ...other, ...sameFile.slice(2)]
        .map((r, idx) => ({ ...r, rank: idx + 1 }));
    }
  }

  // Diversity: demote results that cluster in same file+region as a higher-ranked result.
  // Skipped when 'no-diversity' ablation is active.
  // This prevents wasting preview/full budget on near-duplicate chunks from the same symbol.
  const diversityDemotions = new Set();
  if (ablations.has('no-diversity')) { /* skip diversity check */ }
  else for (let i = 0; i < Math.min(workingResults.length, 5); i++) {
    const ri = workingResults[i];
    const fi = ri.metadata?.file || ri.file;
    const si = ri.metadata?.startLine || ri.startLine;
    const ei = ri.metadata?.endLine || ri.endLine;
    for (let j = i + 1; j < Math.min(workingResults.length, 5); j++) {
      if (diversityDemotions.has(j)) continue;
      const rj = workingResults[j];
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
  // When 'no-adaptive-budget' ablation is active, use fixed splits (no context param)
  const budgetContext = ablations.has('no-adaptive-budget')
    ? {}
    : {
        ...(searchStats?.grepMatches != null ? { grepMatches: searchStats.grepMatches } : {}),
        ...(searchStats?.candidatePoolSize != null ? { candidatePoolSize: searchStats.candidatePoolSize } : {}),
        results: workingResults,
      };
  const allocations = allocateBudget(tokenBudget, workingResults.length, subMode, budgetContext);

  // Compute confidence from ranked results (Fix #4: regex selectivity included)
  const confidenceInfo = computeConfidence(workingResults, searchStats);

  // Shared staleness cache — db mtime is the same for all results in one search.
  // Avoids repeated statSync calls (Fix D: perf).
  const stalenessCache = {};

  let tokensUsed = 0;
  const agentResults = [];

  for (let i = 0; i < workingResults.length; i++) {
    const result = workingResults[i];
    const allocation = allocations[i] || { presentation: 'summary', tokenCap: 0 };
    const meta = result.metadata || {};
    const filePath = meta.file || result.file;
    const remainingBudget = Math.max(0, tokenBudget - tokensUsed);

    // Enforce global budget + diversity: demote to summary if budget exhausted
    // or result overlaps with a higher-ranked result in the same file region
    const budgetExhausted = remainingBudget <= 0;
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
      tokenCap: Math.min(allocation.tokenCap, remainingBudget),
      ablations,
    });

    // Phase 1: Load code via readFileRange.
    // For sandwich expansions, assemble from parts with explicit elision markers
    // so the gold chunk is preserved even when the enclosing entity is huge.
    let code;
    if (expansion.kind === 'sandwich' && expansion.sandwich) {
      code = assembleSandwichCode(fileCache, filePath, expansion.sandwich, projectRoot);
    } else {
      code = readFileRange(
        fileCache,
        filePath,
        expansion.startLine,
        expansion.endLine,
        projectRoot
      );
    }

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
    const resultTokenCap = Math.min(allocation.tokenCap, remainingBudget);
    let codeTokens;
    let boundaryTruncated = false;
    if (resultTokenCap <= 0) {
      code = '';
      codeTokens = 0;
    } else if (expansion.kind === 'sandwich') {
      // Sandwich is pre-sized via 10-tokens/line estimate. If actual content
      // happens to overshoot (very long lines), do NOT call truncateToTokenCap
      // here — that truncates from the start and would drop the gold tail.
      // Instead, fall back to gold-only chunk + truncate (agent keeps the
      // evidence; loses signature, but not the match itself).
      codeTokens = estimateTokens(code);
      if (codeTokens > resultTokenCap) {
        const goldStart = meta.startLine || result.startLine;
        const goldEnd = meta.endLine || result.endLine;
        const goldOnly = readFileRange(fileCache, filePath, goldStart, goldEnd, projectRoot) || '';
        const trunc = truncateToTokenCap(goldOnly, resultTokenCap);
        code = trunc.code;
        codeTokens = estimateTokens(code);
      }
    } else if (allocation.presentation === 'full') {
      const truncResult = truncateToTokenCap(code, resultTokenCap);
      code = truncResult.code;
      codeTokens = estimateTokens(code);
      boundaryTruncated = truncResult.truncated;
    } else {
      // Preview mode — compress to signature + snippet
      code = compressToPreview(code, resultTokenCap);
      code = clampTextToTokenCap(code, resultTokenCap);
      codeTokens = estimateTokens(code);
    }

    if (!code || codeTokens <= 0) {
      agentResults.push({
        rank: i + 1,
        file: filePath,
        startLine: meta.startLine || result.startLine,
        endLine: meta.endLine || result.endLine,
        symbol: expansion.symbol,
        symbolType: expansion.symbolType,
        score: result.score || result.lateInteractionScore || 0,
        expanded: false,
        presentation: 'summary',
        stale,
        indexedAt,
        summary: `${filePath}:${meta.startLine || result.startLine} — ${expansion.symbol || meta.name || 'code block'}${(expansion.symbolType || meta.type) ? ' (' + (expansion.symbolType || meta.type) + ')' : ''}`,
        code: null,
        codeTokens: 0,
      });
      continue;
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
      expansionKind: expansion.kind || null,
      ...(expansion.kind === 'sandwich' && expansion.sandwich
        ? {
            sandwich: {
              partKinds: expansion.sandwich.parts.map(p => p.kind),
              elidedHead: expansion.sandwich.elidedHead,
              elidedTail: expansion.sandwich.elidedTail,
              elisionMarkers: expansion.sandwich.elisionMarkers,
            },
          }
        : {}),
      presentation: allocation.presentation,
      stale,
      indexedAt,
      code,
      codeTokens,
      ...(_isAgentFormat === true
        && allocation.presentation === 'full'
        && expansion.kind !== 'sandwich'
        ? {
            shownStartLine: expansion.startLine,
            shownEndLine: shownSourceEndLine(expansion.startLine, code, boundaryTruncated),
            ...(boundaryTruncated ? { boundaryTruncated: true } : {}),
          }
        : {}),
    };

    // Phase 4: Header context (top-1 only). Skipped by 'no-header' ablation.
    if (i === 0 && !ablations.has('no-header')) {
      const remainingHeaderBudget = Math.min(
        MAX_HEADER_TOKENS,
        Math.max(0, tokenBudget - tokensUsed)
      );
      const { headerContext } = extractHeaderContext(
        code, fileCache, filePath, projectRoot
      );
      if (headerContext && remainingHeaderBudget > 0) {
        const trimmedHeader = clampTextToTokenCap(headerContext, remainingHeaderBudget);
        const trimmedHeaderTokens = estimateTokens(trimmedHeader);
        if (trimmedHeader && trimmedHeaderTokens > 0) {
          agentResult.headerContext = trimmedHeader;
          agentResult.headerTokens = trimmedHeaderTokens;
          tokensUsed += trimmedHeaderTokens;
        }
      }
    }

    // Phase 6: Graph-neighbour reservation (top-1 only). The pack reserves
    // up to 20% of the budget (capped at 1000 tokens, floored at 600 when
    // the budget allows) for a dedicated 1-hop neighbours tier. Surfaced
    // as `agentResult.neighbors`; rendered for the agent by the CLI shim.
    // Disabled by 'no-graph-neighbors' ablation. Always opt-OUT, never
    // model-specific — the rendering is plain text.
    if (i === 0
        && !ablations.has('no-graph-neighbors')
        && expansion.entityId
        && codeGraphRepo) {
      // Reserve fraction depends on subMode but never above 20% / 1000 toks.
      // Stretches the floor for full+xl so the top-1 actually gets useful
      // neighbour evidence even when the chunk consumed most of the budget.
      const reserveFraction = subMode === 'agent_full_xl' ? 0.20
        : subMode === 'agent_full' ? 0.18
        : 0.15;
      const headroom = Math.max(0, tokenBudget - tokensUsed);
      const desired = Math.min(1000, Math.floor(tokenBudget * reserveFraction));
      const tokenCap = Math.min(headroom, desired);
      if (tokenCap >= 80) {
        // Build skip set from ALL ranked locations that will be shown
        // with code (full / preview tiers). Summary-tier rows are not
        // skipped — they convey no code and the neighbour tier still
        // adds value (edge type + direction). This avoids the
        // pathological case (validation-pipeline) where every caller is
        // already in the pack as a summary row, leaving the agent with
        // file:line refs but no edge attribution.
        const skipKeys = new Set();
        for (let j = 0; j < workingResults.length; j++) {
          const tier = allocations[j]?.presentation;
          if (tier !== 'full' && tier !== 'preview') continue;
          const r = workingResults[j];
          const f = r.metadata?.file || r.file;
          const s = r.metadata?.startLine || r.startLine;
          const e = r.metadata?.endLine || r.endLine;
          if (f && s != null && e != null) {
            skipKeys.add(`${f}|${s}|${e}`);
          }
        }
        skipKeys.add(`${filePath}|${expansion.startLine}|${expansion.endLine}`);
        const neighbours = renderGraphNeighbors({
          codeGraphRepo,
          entity: {
            id: expansion.entityId,
            filePath,
            startLine: expansion.startLine,
            endLine: expansion.endLine,
            name: expansion.symbol,
            type: expansion.symbolType,
          },
          skipKeys,
          tokenCap,
          // Pass the loaded code so the neighbour tier can also surface
          // referenced TYPE definitions (struct/enum/...) discovered by
          // name from the body — fills the gap left by relationship-only
          // edges (e.g. Go method receiver fields with custom types).
          body: code,
        });
        if (neighbours) {
          agentResult.neighbors = neighbours;
          tokensUsed += neighbours.tokens;
        }
      }
    }

    agentResults.push(agentResult);
  }

  const packagingMs = Math.round(performance.now() - start);

  // Sufficiency signal for top-1. Query-conditioned since 2026-07: the
  // 3-valued verdict requires positive query-match evidence; structural
  // packaging facts remain as reasons + the medium-confidence resolution
  // gate. Runs for summary-only top-1 too (verdict can be 'no'/'unknown'
  // there; never 'yes' without code).
  let sufficient = false;
  let sufficiencyVerdict = 'no';
  let sufficiencyReason = 'no_results';
  let sufficiencyReasons = [];
  let unresolvedExternalCount = 0;
  if (agentResults.length > 0) {
    const sufficiency = computeSufficiency(agentResults[0], confidenceInfo, {
      query,
      regex,
      // Code-bearing lower ranks (full/preview) — soften a false 'no' when
      // the pack's answer sits below top-1; never used to grant YES.
      lowerResults: agentResults.slice(1, 4).filter(r => r.code),
    });
    sufficient = sufficiency.sufficient;
    sufficiencyVerdict = sufficiency.verdict;
    sufficiencyReason = sufficiency.sufficiencyReason;
    sufficiencyReasons = sufficiency.reasons;
    unresolvedExternalCount = sufficiency.unresolvedExternalCount || 0;
  }

  // Phase 7: same-file span map (top-1 only). Emitted ONLY when the verdict
  // is not a clear YES (composes with the query-conditioned verdict: the map
  // supplies the "where to look next" exactly when the engine says "keep
  // looking") AND top-1 is a windowed view (kind != 'full' — fully-shown
  // symbols stay byte-identical) AND the line fits the remaining tier
  // budget (dropped on overflow, never a truncated pack). Its tokens are
  // counted inside tokensUsed. Disabled by 'no-same-file-map' ablation.
  if (!ablations.has('no-same-file-map')
      && agentResults.length > 0
      && sufficiencyVerdict !== 'yes'
      && codeGraphRepo
      && typeof codeGraphRepo.findAdjacentEntities === 'function') {
    const top = agentResults[0];
    const windowed = top.code
      && top.presentation !== 'summary'
      && top.expansionKind
      && top.expansionKind !== 'full'
      && top.file
      && Number.isFinite(top.startLine)
      && Number.isFinite(top.endLine);
    if (windowed) {
      let adjacent = null;
      try {
        adjacent = codeGraphRepo.findAdjacentEntities(top.file, top.startLine, top.endLine, { perSide: 2 });
      } catch { adjacent = null; }
      // Don't name neighbors whose code is ALREADY visible in the pack —
      // locality clustering pulls same-file companions to ranks 2-3; a map
      // entry for a shown span is pure noise.
      if (adjacent) {
        const shownSameFile = agentResults.filter(r =>
          r !== top && r.code && r.file === top.file
          && Number.isFinite(r.startLine) && Number.isFinite(r.endLine));
        const overlapsShown = e => shownSameFile.some(r =>
          e.startLine <= r.endLine && e.endLine >= r.startLine);
        adjacent = {
          above: adjacent.above.filter(e => !overlapsShown(e)),
          below: adjacent.below.filter(e => !overlapsShown(e)),
        };
      }
      const map = adjacent ? buildSameFileMap(top, adjacent) : null;
      if (map && map.tokens <= Math.max(0, tokenBudget - tokensUsed)) {
        top.sameFile = map;
        tokensUsed += map.tokens;
      }
    }
  }

  if (_isAgentFormat === true) {
    const completion = applyAgentPackCompletion({
      results: agentResults,
      query,
      regex,
      codeGraphRepo,
      fileCache,
      projectRoot,
      tokensUsed,
      tokenBudget,
      estimateTokens,
      isAgentFormat: _isAgentFormat,
    });
    tokensUsed = completion.tokensUsed;
  }

  return {
    query,
    regex,
    mode: modeOpt || searchStats?.path || 'pattern',
    totalResults: workingResults.length,
    latencyMs: searchStats?.total_ms || 0,
    packagingMs,

    format: 'agent',
    subMode,
    tokenBudget,
    budgetReason,
    budgetSignals,
    tokensUsed,
    confidence: confidenceInfo.confidence,
    confidenceReason: confidenceInfo.confidenceReason,
    sufficient,
    sufficiencyVerdict,
    sufficiencyReason,
    sufficiencyReasons,
    unresolvedExternalCount,

    results: agentResults,
  };
}
