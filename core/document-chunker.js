/**
 * Document Chunker — SOTA chunking for Markdown, Plain Text, and PDF
 *
 * Implements structure-aware splitting strategies based on 2025-2026 research:
 * - Markdown: heading-aware hierarchical splitting with frontmatter, code block,
 *   table, and list preservation
 * - Plain Text: recursive character splitting with paragraph/sentence detection
 *   and configurable overlap
 *
 * All chunkers return the same data structure as ASTChunker.buildChunk() for
 * seamless integration with the indexing pipeline.
 */

import { createHash } from 'crypto';
import path from 'path';
import { detectProjectBoundary } from './project-detector.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_CHUNK_SIZE = 2000;  // chars — matches ast-chunker.js
const MIN_CHUNK_SIZE = 30;    // chars — matches ast-chunker.js threshold

/** Default config for markdown chunker */
const MD_DEFAULTS = {
  maxChunkSize: MAX_CHUNK_SIZE,
  minChunkSize: MIN_CHUNK_SIZE,
  overlapLines: 2,
};

/** Default config for plain text chunker */
const TXT_DEFAULTS = {
  maxChunkSize: MAX_CHUNK_SIZE,
  minChunkSize: MIN_CHUNK_SIZE,
  overlapFraction: 0.15,       // 15% overlap
};

/**
 * RST underline characters for header detection (order doesn't matter —
 * RST assigns levels by order of first appearance in the document).
 * Valid characters: = - ` : . ' " ~ ^ _ * + #
 */
const RST_UNDERLINE_CHARS = new Set('=-`:\'.\"~^_*+#'.split(''));

/** Separator hierarchy for recursive splitting (priority order) */
const SEPARATOR_HIERARCHY = [
  '\n\n',                        // paragraph breaks
  '\n',                          // line breaks
  /(?<=[.!?])\s+/,              // sentence endings
  /(?<=[;])\s+/,                // clause boundaries
  /(?<=[,])\s+/,                // phrase boundaries
  ' ',                           // word boundaries
];

// =============================================================================
// SHARED UTILITIES
// =============================================================================

/**
 * Generate a SHA-256 hash prefix for deduplication.
 * @param {string} content
 * @returns {string} First 16 hex chars
 */
function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Build a chunk object matching ASTChunker.buildChunk() shape.
 *
 * Uses detectProjectBoundary for the project tag, matching ASTChunker.inferProjectTag().
 */
function buildDocChunk(content, filePath, language, chunkType, symbol, lineStart, lineEnd, projectRoot, extraMeta = {}) {
  const trimmed = content.trim();
  const hash = hashContent(trimmed);
  const relativePath = projectRoot ? path.relative(projectRoot, filePath) : filePath;
  const { name: projectTag } = detectProjectBoundary(filePath, projectRoot || process.cwd());

  return {
    text: trimmed,
    content: trimmed,
    metadata: {
      type: 'document',
      file: path.basename(filePath),
      path: relativePath,
      language,
      chunk_type: chunkType,
      symbol,
      line_start: lineStart + 1,    // 1-indexed
      line_end: lineEnd,
      hash,
      ...extraMeta,
    },
    tags: ['document', language, projectTag],
  };
}

/**
 * Recursively split text using a separator hierarchy.
 * Tries the highest-priority separator first; if any resulting piece
 * still exceeds maxSize, recurse with the next separator.
 *
 * @param {string} text
 * @param {number} maxSize
 * @param {number} [sepIdx=0] - Current index in SEPARATOR_HIERARCHY
 * @returns {string[]}
 */
function recursiveSplit(text, maxSize, sepIdx = 0) {
  if (text.length <= maxSize) return [text];
  if (sepIdx >= SEPARATOR_HIERARCHY.length) {
    // Last resort: hard split at maxSize
    const pieces = [];
    for (let i = 0; i < text.length; i += maxSize) {
      pieces.push(text.slice(i, i + maxSize));
    }
    return pieces;
  }

  const sep = SEPARATOR_HIERARCHY[sepIdx];
  let parts;

  if (sep instanceof RegExp) {
    // Split on regex but keep delimiters at end of preceding part
    parts = [];
    let lastIdx = 0;
    const globalRe = new RegExp(sep.source, 'g');
    let m;
    while ((m = globalRe.exec(text)) !== null) {
      // Include the match in the preceding part
      parts.push(text.slice(lastIdx, m.index + m[0].length));
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) {
      parts.push(text.slice(lastIdx));
    }
  } else {
    parts = text.split(sep);
    // Re-join with separator (except last)
    parts = parts.map((p, i) => i < parts.length - 1 ? p + sep : p);
  }

  // Filter empty
  parts = parts.filter(p => p.length > 0);

  // If we couldn't split (only one piece), try next separator
  if (parts.length <= 1) {
    return recursiveSplit(text, maxSize, sepIdx + 1);
  }

  // Merge small consecutive parts, then recurse on oversized ones
  const merged = [];
  let buffer = '';

  for (const part of parts) {
    if (buffer.length + part.length <= maxSize) {
      buffer += part;
    } else {
      if (buffer.length > 0) merged.push(buffer);
      buffer = part;
    }
  }
  if (buffer.length > 0) merged.push(buffer);

  // Recurse on any oversized pieces
  const result = [];
  for (const piece of merged) {
    if (piece.length > maxSize) {
      result.push(...recursiveSplit(piece, maxSize, sepIdx + 1));
    } else {
      result.push(piece);
    }
  }

  return result;
}

// =============================================================================
// MARKDOWN CHUNKER
// =============================================================================

/**
 * SOTA Markdown chunker with heading-aware hierarchical splitting.
 *
 * Pipeline:
 * 1. Extract YAML frontmatter → metadata
 * 2. Identify atomic blocks (code fences, tables) → mark as no-split zones
 * 3. Split on header boundaries (# through ######)
 * 4. For each section: if size <= maxChunkSize emit as one chunk,
 *    else recursive split (paragraph → sentence → word)
 * 5. Never split inside code blocks or tables
 * 6. Attach metadata: header_hierarchy, frontmatter, content_type
 */
export class MarkdownChunker {
  constructor(options = {}) {
    this.maxChunkSize = options.maxChunkSize || MD_DEFAULTS.maxChunkSize;
    this.minChunkSize = options.minChunkSize || MD_DEFAULTS.minChunkSize;
    this.overlapLines = options.overlapLines ?? MD_DEFAULTS.overlapLines;
    this.projectRoot = options.projectRoot || process.cwd();
  }

  /**
   * Parse a markdown or RST file into semantically meaningful chunks.
   *
   * RST support: detects underline-style headers (Title\n====) used in
   * reStructuredText. RST assigns heading levels by order of first
   * appearance of the underline character, not by character type.
   *
   * Limitations:
   * - Frontmatter parser handles key: value, [arrays], and quoted strings
   *   but not nested objects, multiline values, or typed scalars.
   * - Indented code blocks (4-space) are not detected as atomic blocks;
   *   only fenced code blocks (```) are preserved.
   *
   * @param {string} filePath
   * @param {string} content
   * @returns {Array<object>} Chunk objects compatible with ASTChunker output
   */
  parseFile(filePath, content) {
    if (!content || content.trim().length < this.minChunkSize) return [];

    const ext = path.extname(filePath).toLowerCase();
    const isRst = ext === '.rst';
    const language = isRst ? 'rst' : 'markdown';

    // Phase 1: Extract frontmatter (RST doesn't typically have YAML frontmatter)
    const { frontmatter, body } = isRst
      ? { frontmatter: null, body: content }
      : this._extractFrontmatter(content);

    // Phase 2: Parse into sections by headers
    const sections = isRst ? this._splitByRstHeaders(body) : this._splitByHeaders(body);

    // Phase 3: Build chunks from sections
    const chunks = [];
    const bodyStartLine = frontmatter ? content.indexOf(body) : 0;
    const bodyLineOffset = content.slice(0, bodyStartLine).split('\n').length - 1;

    for (const section of sections) {
      const sectionChunks = this._chunkSection(
        section, filePath, bodyLineOffset, frontmatter, language,
      );
      chunks.push(...sectionChunks);
    }

    return chunks;
  }

  /**
   * Extract YAML frontmatter from markdown content.
   */
  _extractFrontmatter(content) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!fmMatch) return { frontmatter: null, body: content };

    const rawYaml = fmMatch[1];
    const frontmatter = {};

    // Simple YAML parser (key: value pairs)
    for (const line of rawYaml.split('\n')) {
      const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
      if (kvMatch) {
        let value = kvMatch[2].trim();
        // Handle array syntax [a, b, c]
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        }
        // Strip quotes
        else if ((value.startsWith('"') && value.endsWith('"')) ||
                 (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        frontmatter[kvMatch[1]] = value;
      }
    }

    const body = content.slice(fmMatch[0].length);
    return { frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : null, body };
  }

  /**
   * Split markdown body into sections by header boundaries.
   * Each section includes its header line and all content until the next
   * same-or-higher-level header.
   *
   * @returns {Array<{level: number, title: string, hierarchy: object, content: string, lineStart: number, lineEnd: number}>}
   */
  _splitByHeaders(body) {
    const lines = body.split('\n');
    const sections = [];
    const headerStack = {};  // level → title mapping for hierarchy

    let currentSection = null;
    let sectionStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headerMatch) {
        // Close previous section
        if (currentSection !== null || i > 0) {
          const sectionContent = lines.slice(sectionStart, i).join('\n');
          sections.push({
            ...currentSection || { level: 0, title: '', hierarchy: {} },
            content: sectionContent,
            lineStart: sectionStart,
            lineEnd: i - 1,
          });
        }

        const level = headerMatch[1].length;
        const title = headerMatch[2].trim();

        // Update header stack: clear all deeper levels
        for (let l = level; l <= 6; l++) {
          delete headerStack[l];
        }
        headerStack[level] = title;

        // Build hierarchy snapshot
        const hierarchy = {};
        for (let l = 1; l <= 6; l++) {
          if (headerStack[l]) hierarchy[`h${l}`] = headerStack[l];
        }

        currentSection = { level, title, hierarchy };
        sectionStart = i;
      }
    }

    // Push final section
    const finalContent = lines.slice(sectionStart).join('\n');
    if (finalContent.trim().length > 0) {
      sections.push({
        ...currentSection || { level: 0, title: '', hierarchy: {} },
        content: finalContent,
        lineStart: sectionStart,
        lineEnd: lines.length - 1,
      });
    }

    return sections;
  }

  /**
   * Split RST body into sections by underline-style headers.
   *
   * RST headers: a line of text followed by a line of repeated underline
   * characters (=, -, ~, ^, etc.) at least as long as the text.
   * Optionally, an overline of the same character precedes the title.
   * Level is determined by order of first appearance, not character type.
   *
   * @returns {Array<{level: number, title: string, hierarchy: object, content: string, lineStart: number, lineEnd: number}>}
   */
  _splitByRstHeaders(body) {
    const lines = body.split('\n');
    const sections = [];
    const charToLevel = {};    // maps underline char → level number
    let nextLevel = 1;
    const headerStack = {};    // level → title

    // First pass: find all header positions
    const headerPositions = [];  // [{lineIdx, title, level}]

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
      const prevLine = i > 0 ? lines[i - 1] : null;

      if (!nextLine) continue;

      // Check if nextLine is an underline: all same RST char, length >= title
      const titleCandidate = line.trim();
      if (titleCandidate.length === 0) continue;

      if (this._isRstUnderline(nextLine, titleCandidate.length)) {
        const underlineChar = nextLine.trim()[0];

        // Check for overline (optional): prevLine is same underline
        const hasOverline = prevLine !== null &&
          this._isRstUnderline(prevLine, titleCandidate.length) &&
          prevLine.trim()[0] === underlineChar;

        // Assign level by order of first appearance
        const levelKey = hasOverline ? `over_${underlineChar}` : underlineChar;
        if (!(levelKey in charToLevel)) {
          charToLevel[levelKey] = nextLevel++;
        }
        const level = charToLevel[levelKey];

        const headerLineIdx = hasOverline ? i - 1 : i;
        headerPositions.push({
          lineIdx: headerLineIdx,
          title: titleCandidate,
          level,
          // The header block spans: headerLineIdx to i+1 (title + underline)
          headerEndIdx: i + 1,
        });

        // Skip the underline line
        i++;
      }
    }

    // Second pass: build sections from header positions
    let sectionStart = 0;
    let currentSection = null;

    for (const hp of headerPositions) {
      // Close previous section
      if (hp.lineIdx > sectionStart || currentSection !== null) {
        const sectionContent = lines.slice(sectionStart, hp.lineIdx).join('\n');
        if (sectionContent.trim().length > 0 || currentSection !== null) {
          sections.push({
            ...currentSection || { level: 0, title: '', hierarchy: {} },
            content: sectionContent,
            lineStart: sectionStart,
            lineEnd: hp.lineIdx - 1,
          });
        }
      }

      // Update header stack
      for (let l = hp.level; l <= 6; l++) {
        delete headerStack[l];
      }
      headerStack[hp.level] = hp.title;

      const hierarchy = {};
      for (let l = 1; l <= 6; l++) {
        if (headerStack[l]) hierarchy[`h${l}`] = headerStack[l];
      }

      currentSection = { level: hp.level, title: hp.title, hierarchy };
      sectionStart = hp.lineIdx;
    }

    // Final section
    const finalContent = lines.slice(sectionStart).join('\n');
    if (finalContent.trim().length > 0) {
      sections.push({
        ...currentSection || { level: 0, title: '', hierarchy: {} },
        content: finalContent,
        lineStart: sectionStart,
        lineEnd: lines.length - 1,
      });
    }

    return sections;
  }

  /**
   * Check if a line is a valid RST underline/overline.
   * Must consist entirely of a single repeated RST adornment character
   * and be at least as long as the title.
   */
  _isRstUnderline(line, minLength) {
    const trimmed = line.trim();
    if (trimmed.length < minLength || trimmed.length < 2) return false;
    const ch = trimmed[0];
    if (!RST_UNDERLINE_CHARS.has(ch)) return false;
    // All characters must be the same
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i] !== ch) return false;
    }
    return true;
  }

  /**
   * Chunk a single markdown/RST section.
   * Preserves code blocks and tables as atomic units.
   */
  _chunkSection(section, filePath, bodyLineOffset, frontmatter, language = 'markdown') {
    const { content, title, hierarchy, lineStart, lineEnd } = section;
    const trimmed = content.trim();

    if (trimmed.length < this.minChunkSize) return [];

    // Detect content type
    const containsCode = /```[\s\S]*?```/.test(trimmed);
    const containsTable = /\|.+\|/.test(trimmed) && /\|[\s-:]+\|/.test(trimmed);
    const contentType = containsCode ? 'code' : containsTable ? 'table' : 'prose';

    // Build extra metadata
    const extraMeta = {
      header_hierarchy: hierarchy,
      content_type: contentType,
      contains_code: containsCode,
      contains_table: containsTable,
    };
    if (frontmatter) extraMeta.frontmatter = frontmatter;

    const absLineStart = bodyLineOffset + lineStart;
    const absLineEnd = bodyLineOffset + lineEnd;

    // If section fits in one chunk, emit directly
    if (trimmed.length <= this.maxChunkSize) {
      return [buildDocChunk(
        trimmed, filePath, language, 'section',
        title || 'untitled',
        absLineStart, absLineEnd + 1,
        this.projectRoot, extraMeta,
      )];
    }

    // Section too large — split while preserving atomic blocks
    return this._splitLargeSection(
      trimmed, filePath, title, hierarchy, frontmatter,
      absLineStart, absLineEnd, extraMeta, language,
    );
  }

  /**
   * Split an oversized section while respecting atomic blocks
   * (code fences, tables).
   */
  _splitLargeSection(content, filePath, title, hierarchy, frontmatter, lineStart, lineEnd, extraMeta, language = 'markdown') {
    const chunks = [];
    const blocks = this._identifyAtomicBlocks(content);
    const totalLines = content.split('\n').length;

    // Process blocks: emit atomic blocks whole, recursively split prose
    for (const block of blocks) {
      if (block.type === 'code' || block.type === 'table') {
        // Atomic block — emit as single chunk even if oversized
        if (block.content.trim().length >= this.minChunkSize) {
          const blockLineStart = lineStart + block.relLineStart;
          const blockLineEnd = lineStart + block.relLineEnd;
          chunks.push(buildDocChunk(
            block.content, filePath, language,
            block.type === 'code' ? 'code_block' : 'table',
            title || 'untitled',
            blockLineStart, blockLineEnd + 1,
            this.projectRoot,
            { ...extraMeta, content_type: block.type },
          ));
        }
      } else {
        // Prose — recursive split
        const proseChunks = recursiveSplit(block.content, this.maxChunkSize);
        let runningLine = lineStart + block.relLineStart;

        for (const piece of proseChunks) {
          if (piece.trim().length < this.minChunkSize) continue;
          const pieceLines = piece.split('\n').length;
          chunks.push(buildDocChunk(
            piece, filePath, language, 'section',
            title || 'untitled',
            runningLine, runningLine + pieceLines,
            this.projectRoot, extraMeta,
          ));
          runningLine += pieceLines;
        }
      }
    }

    return chunks;
  }

  /**
   * Identify atomic (no-split) blocks within markdown content.
   * Returns an array of {type, content, relLineStart, relLineEnd} objects.
   */
  _identifyAtomicBlocks(content) {
    const lines = content.split('\n');
    const blocks = [];
    let currentProse = [];
    let proseStart = 0;
    let inCodeBlock = false;
    let codeBlockStart = 0;
    let codeBlockLines = [];
    let inTable = false;
    let tableStart = 0;
    let tableLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code fence toggle
      if (line.trimStart().startsWith('```')) {
        if (!inCodeBlock) {
          // Flush prose
          if (currentProse.length > 0) {
            blocks.push({
              type: 'prose',
              content: currentProse.join('\n'),
              relLineStart: proseStart,
              relLineEnd: i - 1,
            });
            currentProse = [];
          }
          inCodeBlock = true;
          codeBlockStart = i;
          codeBlockLines = [line];
        } else {
          codeBlockLines.push(line);
          blocks.push({
            type: 'code',
            content: codeBlockLines.join('\n'),
            relLineStart: codeBlockStart,
            relLineEnd: i,
          });
          inCodeBlock = false;
          codeBlockLines = [];
          proseStart = i + 1;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      // Table detection
      const isTableLine = /^\|.+\|/.test(line.trim());
      if (isTableLine) {
        if (!inTable) {
          // Flush prose before table
          if (currentProse.length > 0) {
            blocks.push({
              type: 'prose',
              content: currentProse.join('\n'),
              relLineStart: proseStart,
              relLineEnd: i - 1,
            });
            currentProse = [];
          }
          inTable = true;
          tableStart = i;
          tableLines = [];
        }
        tableLines.push(line);
        continue;
      }

      // End of table
      if (inTable) {
        blocks.push({
          type: 'table',
          content: tableLines.join('\n'),
          relLineStart: tableStart,
          relLineEnd: i - 1,
        });
        inTable = false;
        tableLines = [];
        proseStart = i;
      }

      // Regular prose
      if (currentProse.length === 0) proseStart = i;
      currentProse.push(line);
    }

    // Flush remaining
    if (inCodeBlock && codeBlockLines.length > 0) {
      // Unclosed code block — treat as code anyway
      blocks.push({
        type: 'code',
        content: codeBlockLines.join('\n'),
        relLineStart: codeBlockStart,
        relLineEnd: lines.length - 1,
      });
    } else if (inTable && tableLines.length > 0) {
      blocks.push({
        type: 'table',
        content: tableLines.join('\n'),
        relLineStart: tableStart,
        relLineEnd: lines.length - 1,
      });
    }

    if (currentProse.length > 0) {
      blocks.push({
        type: 'prose',
        content: currentProse.join('\n'),
        relLineStart: proseStart,
        relLineEnd: lines.length - 1,
      });
    }

    return blocks;
  }
}

// =============================================================================
// PLAIN TEXT CHUNKER
// =============================================================================

/**
 * Recursive character-based text chunker with paragraph awareness.
 *
 * Pipeline:
 * 1. Detect paragraph boundaries (double newlines)
 * 2. Apply recursive splitting with separator hierarchy
 * 3. Apply configurable overlap
 * 4. Attach metadata: chunk_index, start_char, end_char
 */
export class PlainTextChunker {
  constructor(options = {}) {
    this.maxChunkSize = options.maxChunkSize || TXT_DEFAULTS.maxChunkSize;
    this.minChunkSize = options.minChunkSize || TXT_DEFAULTS.minChunkSize;
    this.overlapFraction = options.overlapFraction ?? TXT_DEFAULTS.overlapFraction;
    this.projectRoot = options.projectRoot || process.cwd();
  }

  /**
   * Parse a plain text file into chunks.
   *
   * @param {string} filePath
   * @param {string} content
   * @returns {Array<object>} Chunk objects compatible with ASTChunker output
   */
  parseFile(filePath, content) {
    if (!content || content.trim().length < this.minChunkSize) return [];

    // Step 1: Recursive split using separator hierarchy
    const rawPieces = recursiveSplit(content, this.maxChunkSize);

    // Step 2: Apply overlap between consecutive chunks
    const pieces = this._applyOverlap(rawPieces);

    // Step 3: Build chunk objects with positional metadata
    const chunks = [];
    let charOffset = 0;

    // Track lines for line_start/line_end
    const lines = content.split('\n');
    let lineIdx = 0;
    let charInLine = 0;

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const trimmed = piece.trim();
      if (trimmed.length < this.minChunkSize) continue;

      // Find line positions in original content
      const startChar = content.indexOf(piece, charOffset);
      const actualStart = startChar >= 0 ? startChar : charOffset;
      const endChar = actualStart + piece.length;

      const startLine = content.slice(0, actualStart).split('\n').length - 1;
      const endLine = content.slice(0, endChar).split('\n').length - 1;

      chunks.push(buildDocChunk(
        piece, filePath, 'plaintext', 'paragraph',
        `chunk_${i + 1}`,
        startLine, endLine + 1,
        this.projectRoot,
        {
          chunk_index: i,
          total_chunks: pieces.length,
          start_char: actualStart,
          end_char: endChar,
        },
      ));

      charOffset = actualStart + piece.length;
    }

    return chunks;
  }

  /**
   * Apply sliding window overlap between consecutive chunks.
   */
  _applyOverlap(pieces) {
    if (pieces.length <= 1 || this.overlapFraction <= 0) return pieces;

    const result = [];

    for (let i = 0; i < pieces.length; i++) {
      let piece = pieces[i];

      // Prepend overlap from previous chunk
      if (i > 0) {
        const prevPiece = pieces[i - 1];
        const overlapChars = Math.floor(prevPiece.length * this.overlapFraction);
        if (overlapChars > 0) {
          const overlap = prevPiece.slice(-overlapChars);
          piece = overlap + piece;
          // Trim to max if overlap made it too large
          if (piece.length > this.maxChunkSize) {
            piece = piece.slice(0, this.maxChunkSize);
          }
        }
      }

      result.push(piece);
    }

    return result;
  }
}

// =============================================================================
// DOCUMENT CHUNKER FACADE
// =============================================================================

/**
 * Facade that dispatches to the appropriate chunker based on file extension.
 * Drop-in replacement for ASTChunker.parseGenericFile for document files.
 */
export class DocumentChunker {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.markdown = new MarkdownChunker({ ...options, projectRoot: this.projectRoot });
    this.plaintext = new PlainTextChunker({ ...options, projectRoot: this.projectRoot });
  }

  /**
   * Parse a document file into chunks.
   *
   * @param {string} filePath
   * @param {string} content
   * @returns {Array<object>}
   */
  parseFile(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.md':
      case '.mdx':
      case '.rst':
        // MarkdownChunker handles both Markdown (#-headers) and RST
        // (underline-style headers) via internal dispatch on extension.
        return this.markdown.parseFile(filePath, content);

      case '.txt':
        return this.plaintext.parseFile(filePath, content);

      default:
        // Fallback: treat as plain text
        return this.plaintext.parseFile(filePath, content);
    }
  }
}

export { recursiveSplit, buildDocChunk, hashContent };
