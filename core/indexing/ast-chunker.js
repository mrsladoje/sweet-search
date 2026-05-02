/**
 * AST-based semantic code chunking
 *
 * Extracts meaningful code chunks (classes, methods, functions, components)
 * with contextual information for AgentDB storage and semantic search.
 *
 * Note: Requires tree-sitter and language grammars to be installed.
 * Falls back to line-based chunking if tree-sitter is unavailable.
 */

import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { detectProjectBoundary } from '../infrastructure/project-detector.js';
import { getLanguageByPath } from '../infrastructure/language-patterns.js';
import { DocumentChunker } from './document-chunker.js';

const MAX_CHUNK_SIZE = 2000;
const MIN_CONTENT_LENGTH = 30;
const MAX_PEEK_LINES = 3;
const DEFAULT_MAX_REGEX_LINE_LENGTH = 4000;

/**
 * Strip a trailing `_<hex>` slug from a path's final basename, before
 * its extension. Used by the Java family (Java/PHP/C#/Kotlin/Scala)
 * per the v6.2 language-conditioned policy.
 *
 *   javascript/Semantic-UI/Table_366c13.js -> javascript/Semantic-UI/Table.js
 *   src/Button.tsx (no slug) -> src/Button.tsx (unchanged)
 *
 * Exported for reuse in chunk-builder.js (document chunks) and tests.
 */
export function normalizePathSlug(relativePath) {
  if (!relativePath) return relativePath;
  return relativePath.replace(/_[0-9a-f]{6,}(\.[a-zA-Z0-9]+)$/, '$1');
}

// Languages that share Java's slug-stripped-path li_text policy.
// (At LI input routing time these will all be sent to chunk.li_text;
// see LI_TEXT_LANGUAGES in core/indexing/indexer-ann.js, which imports
// this set so the policy stays consistent in one place.)
export const JAVA_FAMILY = new Set([
  'java', 'php',
  'csharp', 'c#',
  'kotlin', 'scala',
]);

/**
 * Per-language path-line strategy for late-interaction MaxSim input.
 *
 *   - Python: no path line (at 97% MRR ceiling; path duplicated funcname).
 *   - Java family (Java, PHP, C#, Kotlin, Scala): slug-stripped path.
 *   - Everything else: full path. (For JS family, Ruby, Go, C/C++/Rust
 *     and unknown languages, the LI input router in indexer-ann.js
 *     bypasses li_text entirely and reads chunk.embedding_text directly,
 *     so this branch only matters as a fallback if those routes ever
 *     fail to find embedding_text.)
 */
function pathLineForLi(relativePath, language) {
  if (!relativePath) return null;
  if (language === 'python') return null;
  if (JAVA_FAMILY.has(language)) {
    return `# ${normalizePathSlug(relativePath)}`;
  }
  return `# ${relativePath}`;
}

/**
 * Build `li_text` — the text fed to lateon-code MaxSim reranking.
 *
 * v6.2 (2026-05): language-conditioned path strategy. All languages
 * share the same `# Parent / # symbol / # Language` label-shaped
 * headers and differ only in how (or whether) the path comment is
 * included. See pathLineForLi() docstring for the per-language map.
 *
 * Why language-conditioned vs uniform: per-language ablation showed
 * uniform policies always regress at least one language (greedy
 * regresses Python; v4 no-path regresses Ruby below baseline; v5
 * slug-strip-uniform hurts JS). The v6.2 split — Python skips the
 * path, Java family slug-strips, JS family / Ruby / Go / fallback get
 * the full enriched embedding_text — is the empirical pareto front.
 *
 * The actual routing of `li_text` vs `embedding_text` lives in
 * core/indexing/indexer-ann.js (`pickLiInput`).
 */
function buildLiText({ content, relativePath, language, chunkType, symbol, hierarchyInfo }) {
  const trimmed = content.trim();
  const lines = [];

  const pathLine = pathLineForLi(relativePath, language);
  if (pathLine) lines.push(pathLine);

  if (hierarchyInfo?.parentSymbol) {
    lines.push(`# Parent: ${hierarchyInfo.parentType} ${hierarchyInfo.parentSymbol}`);
  }
  if (symbol && symbol !== 'unknown') {
    lines.push(`# ${chunkType}: ${symbol}`);
  }
  if (language && language !== 'text') {
    lines.push(`# Language: ${language}`);
  }
  lines.push(trimmed);

  return lines.join('\n').slice(0, 2000);
}

/**
 * AST-like semantic code chunker supporting 35+ languages.
 * Uses regex boundary patterns from core/language-patterns.js registry.
 * Three parsing strategies: brace-based, indent-based, end-keyword.
 */
export class ASTChunker {
  constructor(options) {
    this.projectRoot = options?.projectRoot || process.cwd();
    this.warnOnPatternDrop = options?.warnOnPatternDrop || false;
    this.maxRegexLineLength = options?.maxRegexLineLength || DEFAULT_MAX_REGEX_LINE_LENGTH;
    this._useTreeSitter = options?.useTreeSitter !== false; // enabled by default
    this.debugCounters = {
      emptyCapture: {
        boundary: 0,
      },
      skippedLongLines: 0,
      byLanguage: {},
      byPattern: {},
    };
  }

  async parseFile(filePath, content) {
    // Dispatch document files (markdown, plaintext) to DocumentChunker
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.md' || ext === '.mdx' || ext === '.rst' || ext === '.txt') {
      if (!this._docChunker) {
        this._docChunker = new DocumentChunker({ projectRoot: this.projectRoot });
      }
      return this._docChunker.parseFile(filePath, content);
    }

    const langInfo = getLanguageByPath(filePath);
    if (!langInfo || !langInfo.chunker) {
      return this.parseGenericFile(filePath, content);
    }

    // Try tree-sitter WASM first for supported languages
    if (this._useTreeSitter) {
      try {
        const tsChunks = await this._parseWithTreeSitter(filePath, content, langInfo);
        if (tsChunks) return tsChunks;
      } catch {
        // Tree-sitter failed silently, fall back to regex
      }
    }

    // Fallback: regex-based parsing
    const { id: language, chunker: patterns, indentBased, endKeyword, comment, blockKeywords } = langInfo;

    const multiLine = !!langInfo.multiLinePatterns;

    if (indentBased) {
      return this.parseIndentBasedFile(filePath, content, language, patterns, multiLine);
    }
    if (endKeyword) {
      return this.parseEndKeywordFile(filePath, content, language, patterns, endKeyword, blockKeywords, multiLine);
    }
    return this.parseBraceBasedFile(filePath, content, language, patterns, comment, multiLine);
  }

  /** Attempt tree-sitter WASM parse, returns chunks array or null */
  async _parseWithTreeSitter(filePath, content, langInfo) {
    const { getTreeSitterProvider } = await import('../infrastructure/tree-sitter-provider.js');
    const provider = getTreeSitterProvider();

    if (!await provider.isAvailable()) return null;
    if (!provider.hasLanguage(langInfo.id)) return null;

    const tsChunks = await provider.parseFileToChunks(content, langInfo.id);
    if (!tsChunks || tsChunks.length === 0) return null;

    return tsChunks.map(chunk =>
      this.buildChunk(
        chunk.text, filePath, langInfo.id, chunk.type, chunk.name,
        chunk.startLine, chunk.endLine,
        {
          chunkId: chunk.chunkId,
          parentChunkId: chunk.parentChunkId,
          parentSymbol: chunk.parentSymbol,
          parentType: chunk.parentType,
        }
      )
    );
  }

  parseBraceBasedFile(filePath, content, language, patterns, comment, multiLine) {
    const chunks = [];
    const lines = content.split('\n');
    const hasTemplateInterpolation = (language === 'javascript');

    let currentChunk = null;
    let braceDepth = 0;
    let chunkStart = 0;
    const stripState = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = this._stripNonCode(line, stripState, comment, hasTemplateInterpolation);

      braceDepth += (stripped.match(/{/g) || []).length;
      braceDepth -= (stripped.match(/}/g) || []).length;

      const { name: matched, type: matchType, joinedLines } = this._matchBoundary(line, patterns, language, lines, i, multiLine);

      if ((matched && currentChunk) || (braceDepth === 0 && currentChunk)) {
        const chunkContent = lines.slice(chunkStart, i + 1).join('\n');
        if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
          chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i));
        }
        currentChunk = null;
        chunkStart = i;
      }

      if (matched) {
        currentChunk = { type: matchType, name: matched };
        chunkStart = i;
        // Skip lines consumed by cross-line joining so they aren't double-processed
        if (joinedLines > 0) {
          // Count braces on the skipped lines to keep depth accurate
          for (let s = 1; s <= joinedLines; s++) {
            const skippedStripped = this._stripNonCode(lines[i + s], stripState, comment, hasTemplateInterpolation);
            braceDepth += (skippedStripped.match(/{/g) || []).length;
            braceDepth -= (skippedStripped.match(/}/g) || []).length;
          }
          i += joinedLines;
        }
      }
    }

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return this._splitOversizedRegexChunks(chunks, filePath, language, patterns, comment);
  }

  parseIndentBasedFile(filePath, content, language, patterns, multiLine) {
    const chunks = [];
    const lines = content.split('\n');

    let currentChunk = null;
    let chunkStart = 0;
    let chunkIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#')) continue; // skip blank/comment lines

      const indent = line.length - trimmed.length;

      // If we're inside a chunk and hit a line at the same or lesser indent, close
      if (currentChunk && indent <= chunkIndent && i > chunkStart) {
        const chunkContent = lines.slice(chunkStart, i).join('\n');
        if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
          chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
        }
        currentChunk = null;
        chunkStart = i;
      }

      const { name: matched, type: matchType, joinedLines } = this._matchBoundary(line, patterns, language, lines, i, multiLine);

      if (matched) {
        // Close prior chunk if any non-empty content
        if (currentChunk && chunkStart < i) {
          const chunkContent = lines.slice(chunkStart, i).join('\n');
          if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
          }
        }
        currentChunk = { type: matchType, name: matched };
        chunkStart = i;
        chunkIndent = indent;
        // Skip lines consumed by cross-line joining so they aren't double-processed
        if (joinedLines > 0) {
          i += joinedLines;
        }
      }
    }

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return this._splitOversizedRegexChunks(chunks, filePath, language, patterns, null);
  }

  parseEndKeywordFile(filePath, content, language, patterns, endKeyword, blockKeywords, multiLine) {
    const chunks = [];
    const lines = content.split('\n');
    const endRe = new RegExp(`^\\s*${endKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    // Build regex to detect non-boundary block-start keywords (if/case/while etc.)
    // These increment depth but don't start new chunks
    const blockStartRe = blockKeywords?.length
      ? new RegExp(`^\\s*(?:${blockKeywords.join('|')})\\b`)
      : null;

    let currentChunk = null;
    let depth = 0;
    let chunkStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const { name: matched, type: matchType, joinedLines } = this._matchBoundary(line, patterns, language, lines, i, multiLine);

      if (matched) {
        if (currentChunk && depth === 0) {
          const chunkContent = lines.slice(chunkStart, i).join('\n');
          if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
          }
        }
        if (!currentChunk || depth === 0) {
          currentChunk = { type: matchType, name: matched };
          chunkStart = i;
        }
        depth++;
        // Skip lines consumed by cross-line joining so they aren't double-processed
        if (joinedLines > 0) {
          i += joinedLines;
        }
      } else if (blockStartRe && blockStartRe.test(line)) {
        // Non-boundary block opener (if/case/while etc.) — track depth
        depth++;
      }

      if (endRe.test(line) && depth > 0) {
        depth--;
        if (depth === 0 && currentChunk) {
          const chunkContent = lines.slice(chunkStart, i + 1).join('\n');
          if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i));
          }
          currentChunk = null;
          chunkStart = i + 1;
        }
      }
    }

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return this._splitOversizedRegexChunks(chunks, filePath, language, patterns, null);
  }

  /**
   * Match a line against boundary patterns. Optionally joins continuation lines
   * (up to 3 ahead) when the line ends with `(`, `,`, or `\` and the language
   * opts in via `multiLinePatterns`.
   *
   * @param {string} line - Current source line
   * @param {object} patterns - Chunker boundary patterns
   * @param {string} language - Language ID
   * @param {string[]|null} [lines] - Full lines array (enables cross-line matching)
   * @param {number|null} [lineIndex] - Current index into lines
   * @param {boolean} [multiLine] - Whether cross-line matching is enabled for this language
   * @returns {{ name: string|null, type: string|null, joinedLines?: number }}
   */
  _matchBoundary(line, patterns, language, lines, lineIndex, multiLine) {
    const trimmed = line.trimStart();
    if (trimmed.length > this.maxRegexLineLength) {
      this._recordLongLineSkip(language, trimmed.length);
      return { name: null, type: null };
    }

    // Cross-line joining: if enabled and line ends with continuation char
    if (multiLine && lines && lineIndex != null) {
      const trimmedEnd = line.trimEnd();
      const lastChar = trimmedEnd[trimmedEnd.length - 1];
      if (lastChar === '(' || lastChar === ',' || lastChar === '\\') {
        const maxPeek = Math.min(MAX_PEEK_LINES, lines.length - lineIndex - 1);
        if (maxPeek > 0) {
          let joined = line;
          for (let p = 1; p <= maxPeek; p++) {
            joined += ' ' + lines[lineIndex + p].trim();
          }
          const joinedTrimmed = joined.trimStart();
          if (joinedTrimmed.length <= this.maxRegexLineLength) {
            for (const [type, pattern] of Object.entries(patterns)) {
              const match = joinedTrimmed.match(pattern);
              if (match && match[1]) {
                return { name: match[1], type, joinedLines: maxPeek };
              }
            }
          }
        }
      }
    }

    // Single-line match (original behavior)
    for (const [type, pattern] of Object.entries(patterns)) {
      const match = trimmed.match(pattern);
      if (match) {
        if (!match[1]) {
          this._recordEmptyCapture(language, type, trimmed);
          continue;
        }
        return { name: match[1], type };
      }
    }
    return { name: null, type: null };
  }

  _recordEmptyCapture(language, patternType, line) {
    this.debugCounters.emptyCapture.boundary += 1;
    if (!this.debugCounters.byLanguage[language]) {
      this.debugCounters.byLanguage[language] = { boundary: 0, skippedLongLines: 0 };
    }
    this.debugCounters.byLanguage[language].boundary += 1;

    const key = `${language}:boundary:${patternType}`;
    this.debugCounters.byPattern[key] = (this.debugCounters.byPattern[key] || 0) + 1;

    if (this.warnOnPatternDrop && this.debugCounters.byPattern[key] <= 3) {
      console.warn(`[ast-chunker] Empty capture dropped for ${key}: ${line.slice(0, 120)}`);
    }
  }

  _recordLongLineSkip(language, lineLength) {
    this.debugCounters.skippedLongLines += 1;
    if (!this.debugCounters.byLanguage[language]) {
      this.debugCounters.byLanguage[language] = { boundary: 0, skippedLongLines: 0 };
    }
    this.debugCounters.byLanguage[language].skippedLongLines += 1;
    if (this.warnOnPatternDrop && this.debugCounters.byLanguage[language].skippedLongLines <= 3) {
      console.warn(`[ast-chunker] Skipping boundary regex on long line (${lineLength} chars) for ${language}`);
    }
  }

  getDebugCounters() {
    const byLanguage = {};
    for (const [language, counts] of Object.entries(this.debugCounters.byLanguage)) {
      byLanguage[language] = { ...counts };
    }
    return {
      emptyCapture: { ...this.debugCounters.emptyCapture },
      skippedLongLines: this.debugCounters.skippedLongLines,
      byLanguage,
      byPattern: { ...this.debugCounters.byPattern },
    };
  }

  _stripNonCode(line, state, comment, hasTemplateInterpolation) {
    let result = '';
    const lineComment = comment?.line || null;
    const blockOpen = comment?.block?.[0] || null;
    const blockClose = comment?.block?.[1] || null;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      // In block comment → scan for block-close delimiter
      if (state.inBlockComment) {
        if (blockClose && line.startsWith(blockClose, i)) {
          state.inBlockComment = false;
          i += blockClose.length - 1;
        }
        continue;
      }

      // In template/raw literal body
      if (state.inTemplateLiteral) {
        if (hasTemplateInterpolation && ch === '\\') {
          i++;
          continue;
        }
        if (hasTemplateInterpolation && ch === '$' && i + 1 < line.length && line[i + 1] === '{') {
          state.interpolationDepth = 1;
          state.inTemplateLiteral = false;
          i++;
          continue;
        }
        if (ch === '`') {
          state.inTemplateLiteral = false;
          continue;
        }
        continue;
      }

      // Code mode

      // Block comment open
      if (blockOpen && line.startsWith(blockOpen, i)) {
        state.inBlockComment = true;
        i += blockOpen.length - 1;
        continue;
      }

      // Line comment
      if (lineComment && line.startsWith(lineComment, i)) {
        break;
      }

      // Double-quoted string
      if (ch === '"') {
        for (i++; i < line.length; i++) {
          if (line[i] === '\\') { i++; continue; }
          if (line[i] === '"') break;
        }
        continue;
      }

      // Single-quoted string
      if (ch === "'") {
        for (i++; i < line.length; i++) {
          if (line[i] === '\\') { i++; continue; }
          if (line[i] === "'") break;
        }
        continue;
      }

      // Backtick string
      if (ch === '`') {
        state.inTemplateLiteral = true;
        continue;
      }

      // Closing brace in template interpolation
      if (ch === '}' && state.interpolationDepth > 0) {
        state.interpolationDepth--;
        if (state.interpolationDepth === 0) {
          state.inTemplateLiteral = true;
          continue;
        }
        result += ch;
        continue;
      }

      // Opening brace in template interpolation
      if (ch === '{' && state.interpolationDepth > 0) {
        state.interpolationDepth++;
      }

      result += ch;
    }

    return result;
  }

  _pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk) {
    if (chunkStart < lines.length) {
      const chunkContent = lines.slice(chunkStart).join('\n');
      if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
        chunks.push(this.buildChunk(
          chunkContent, filePath, language,
          currentChunk?.type || 'code',
          currentChunk?.name || 'unknown',
          chunkStart, lines.length - 1
        ));
      }
    }
  }

  /**
   * Post-process regex-produced chunks: split oversized ones at depth boundaries.
   * Approximates cAST recursive split for the regex fallback tier.
   *
   * @param {Array} chunks - Chunks from brace/indent/end-keyword parsing
   * @param {string} filePath - Source file path
   * @param {string} language - Language ID
   * @param {object} patterns - Chunker boundary patterns for sub-boundary detection
   * @param {object} comment - Comment syntax config
   * @returns {Array} Chunks with oversized ones split and parent_chunk_id linked
   */
  _splitOversizedRegexChunks(chunks, filePath, language, patterns, comment) {
    const result = [];
    let parentCounter = 0;

    for (const chunk of chunks) {
      if (chunk.content.length <= MAX_CHUNK_SIZE) {
        result.push(chunk);
        continue;
      }

      // Oversized chunk: attempt to split at sub-boundary points
      parentCounter++;
      const parentId = `rx-p${parentCounter}`;
      const parentSymbol = chunk.metadata.symbol;
      const parentType = chunk.metadata.chunk_type;
      const lineStart = chunk.metadata.line_start - 1; // back to 0-indexed

      const subChunks = this._splitAtSubBoundaries(
        chunk.content, filePath, language, patterns, comment,
        lineStart, parentId, parentSymbol, parentType
      );

      if (subChunks.length > 1) {
        result.push(...subChunks);
      } else {
        // Couldn't split further — emit as-is
        result.push(chunk);
      }
    }

    return result;
  }

  /**
   * Split oversized content at sub-boundary points (brace depth transitions,
   * boundary pattern matches within the chunk).
   */
  _splitAtSubBoundaries(content, filePath, language, patterns, comment, lineOffset, parentId, parentSymbol, parentType) {
    const lines = content.split('\n');
    const subChunks = [];
    const hierarchyInfo = {
      parentChunkId: parentId,
      parentSymbol,
      parentType,
    };

    let segStart = 0;
    let segSize = 0;
    let childCounter = 0;
    let braceDepth = 0;
    const stripState = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const hasTemplateInterpolation = (language === 'javascript');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineSize = line.length + 1; // +1 for newline
      const stripped = this._stripNonCode(line, stripState, comment, hasTemplateInterpolation);

      braceDepth += (stripped.match(/{/g) || []).length;
      braceDepth -= (stripped.match(/}/g) || []).length;

      // Check if this line is a sub-boundary (a new construct starting at depth >= 1)
      const { name: matched, type: matchType } = this._matchBoundary(line, patterns, language, lines, i, false);
      const isSubBoundary = matched && i > segStart;

      // Split condition: at a sub-boundary, or accumulated segment exceeds max
      if ((isSubBoundary || (segSize + lineSize > MAX_CHUNK_SIZE && segSize > 0)) && i > segStart) {
        const segContent = lines.slice(segStart, i).join('\n');
        if (segContent.trim().length > MIN_CONTENT_LENGTH) {
          childCounter++;
          subChunks.push(this.buildChunk(
            segContent, filePath, language,
            subChunks.length === 0 ? parentType || 'code' : (matchType || 'code'),
            subChunks.length === 0 ? parentSymbol : (matched || 'unknown'),
            lineOffset + segStart, lineOffset + i - 1,
            { ...hierarchyInfo, chunkId: `${parentId}-${childCounter}` }
          ));
        }
        segStart = i;
        segSize = 0;
      }

      segSize += lineSize;
    }

    // Flush remaining
    if (segStart < lines.length) {
      const segContent = lines.slice(segStart).join('\n');
      if (segContent.trim().length > MIN_CONTENT_LENGTH) {
        childCounter++;
        subChunks.push(this.buildChunk(
          segContent, filePath, language,
          'code', 'unknown',
          lineOffset + segStart, lineOffset + lines.length - 1,
          { ...hierarchyInfo, chunkId: `${parentId}-${childCounter}` }
        ));
      }
    }

    return subChunks;
  }

  parseGenericFile(filePath, content) {
    const lines = content.split('\n');
    const chunks = [];
    const CHUNK_SIZE = 50;
    const OVERLAP = 10;

    let start = 0;
    while (start < lines.length) {
      const end = Math.min(start + CHUNK_SIZE, lines.length);
      const chunkContent = lines.slice(start, end).join('\n');

      if (chunkContent.trim().length > 20) {
        chunks.push(this.buildChunk(chunkContent, filePath, 'text', 'code', 'unknown', start, end - 1));
      }

      start = end - OVERLAP;
      if (start >= lines.length - OVERLAP) break;
    }

    return chunks;
  }

  buildChunk(content, filePath, language, chunkType, symbol, lineStart, lineEnd, hierarchyInfo) {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const relativePath = this.projectRoot ? path.relative(this.projectRoot, filePath) : filePath;

    // Build contextualized embedding text (rich context for bi-encoder)
    const embeddingParts = [];
    embeddingParts.push(`# ${relativePath}`);
    if (hierarchyInfo?.parentSymbol) {
      embeddingParts.push(`# Parent: ${hierarchyInfo.parentType} ${hierarchyInfo.parentSymbol}`);
    }
    if (symbol && symbol !== 'unknown') {
      embeddingParts.push(`# ${chunkType}: ${symbol}`);
    }
    if (language && language !== 'text') {
      embeddingParts.push(`# Language: ${language}`);
    }
    embeddingParts.push(content.trim());

    // Build LI text via the v6.2 builder (language-conditioned path
    // policy). See buildLiText() docstring for rationale.
    const li_text = buildLiText({
      content,
      relativePath,
      language,
      chunkType,
      symbol,
      hierarchyInfo,
    });

    const metadata = {
      type: 'codebase',
      file: path.basename(filePath),
      path: relativePath,
      language,
      chunk_type: chunkType,
      symbol,
      line_start: lineStart + 1,
      line_end: lineEnd + 1,
      hash,
    };

    // Hierarchical chunk linking (cAST parent/child)
    if (hierarchyInfo?.chunkId) {
      metadata.chunk_id = hierarchyInfo.chunkId;
    }
    if (hierarchyInfo?.parentChunkId) {
      metadata.parent_chunk_id = hierarchyInfo.parentChunkId;
    }
    if (hierarchyInfo?.parentSymbol) {
      metadata.parent_symbol = hierarchyInfo.parentSymbol;
      metadata.parent_type = hierarchyInfo.parentType;
    }

    return {
      text: content.trim(),
      content: content.trim(),
      embedding_text: embeddingParts.join('\n').slice(0, 2000),
      li_text,
      metadata,
      tags: ['codebase', language, this.inferProjectTag(filePath)]
    };
  }

  /**
   * Enrich a chunk's embedding_text with scope chain and import information.
   * Called after initial chunking when scope info is available.
   */
  static enrichEmbeddingText(chunk, scopeChain, imports) {
    const parts = [];
    parts.push(`# ${chunk.metadata.path}`);

    if (scopeChain && scopeChain.length > 0) {
      parts.push(`# Scope: ${scopeChain.join(' > ')}`);
    } else if (chunk.metadata.parent_symbol) {
      // Preserve cAST parent context when no scope chain from code graph
      parts.push(`# Parent: ${chunk.metadata.parent_type} ${chunk.metadata.parent_symbol}`);
    }

    if (chunk.metadata.symbol && chunk.metadata.symbol !== 'unknown') {
      parts.push(`# Defines: ${chunk.metadata.chunk_type} ${chunk.metadata.symbol}`);
    }

    if (imports && imports.length > 0) {
      parts.push(`# Uses: ${imports.slice(0, 5).join(', ')}`);
    }

    if (chunk.metadata.language && chunk.metadata.language !== 'text') {
      parts.push(`# Language: ${chunk.metadata.language}`);
    }

    parts.push(chunk.content);
    chunk.embedding_text = parts.join('\n').slice(0, 2000);
    return chunk;
  }

  inferProjectTag(filePath) {
    const { name } = detectProjectBoundary(filePath, this.projectRoot || process.cwd());
    return name;
  }

  async parseFiles(filePaths) {
    const allChunks = [];

    for (const filePath of filePaths) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const chunks = await this.parseFile(filePath, content);
        allChunks.push(...chunks.flat());
      } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error.message);
      }
    }

    return allChunks;
  }
}

